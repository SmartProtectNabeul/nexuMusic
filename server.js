const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 3000;
const DIR  = __dirname;
const MIME = {
  '.html':'text/html', '.css':'text/css', '.js':'application/javascript',
  '.json':'application/json', '.ico':'image/x-icon', '.png':'image/png',
};

// ── InnerTube config (YouTube's own internal API — no key needed) ─────────────
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CTX = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    hl: 'en', gl: 'US',
  },
};

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240101.00.00',
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Invalid JSON from InnerTube')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Parse helpers ─────────────────────────────────────────────────────────────
function parseDur(str) {
  if (!str) return 0;
  const p = str.split(':').map(Number);
  if (p.length === 2) return p[0]*60 + p[1];
  if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
  return 0;
}
function getText(obj) {
  if (!obj) return '';
  if (obj.simpleText) return obj.simpleText;
  if (obj.runs) return obj.runs.map(r => r.text).join('');
  return '';
}
function videoRendererToTrack(v) {
  if (!v || !v.videoId) return null;
  const thumbs = v.thumbnail?.thumbnails || [];
  const thumb  = thumbs.slice(-1)[0]?.url || '';
  return {
    videoId:       v.videoId,
    title:         getText(v.title),
    author:        getText(v.ownerText || v.shortBylineText),
    thumbnail:     thumb,
    lengthSeconds: parseDur(getText(v.lengthText)),
  };
}

// ── YouTube Search via InnerTube ──────────────────────────────────────────────
async function ytSearch(q) {
  const url = `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`;
  const data = await postJSON(url, {
    context: INNERTUBE_CTX,
    query: q,
    params: 'EgIQAQ%3D%3D', // filter: video type only
  });

  const contents =
    data?.contents
      ?.twoColumnSearchResultsRenderer
      ?.primaryContents
      ?.sectionListRenderer
      ?.contents || [];

  const tracks = [];
  for (const section of contents) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      if (item.videoRenderer) {
        const t = videoRendererToTrack(item.videoRenderer);
        if (t) tracks.push(t);
      }
    }
    if (tracks.length >= 25) break;
  }
  return tracks;
}

// ── YouTube Trending Music (Fallback to search) ───────────────────────────────
async function ytTrending() {
  // InnerTube trending can be flaky for unauthenticated sessions.
  // Instead, just perform a guaranteed search for top hits.
  return await ytSearch('Top Hits Music Playlist 2024');
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "upgrade-insecure-requests");

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (data, code=200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // ── Simple Rate Limiting ─────────────────────────────────────────────────
  const ip = req.socket.remoteAddress;
  if (!global.rateLimit) global.rateLimit = new Map();
  const now = Date.now();
  const rl = global.rateLimit.get(ip) || { count: 0, time: now };
  if (now - rl.time > 60000) { rl.count = 0; rl.time = now; } // Reset every minute
  rl.count++;
  global.rateLimit.set(ip, rl);

  if (rl.count > 50) { // Max 50 requests per minute per IP
    return json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  // ── /api/search?q=... ────────────────────────────────────────────────────
  if (p === '/api/search') {
    const q = u.searchParams.get('q') || '';
    if (!q || q.length > 100) { 
      return json({ error: 'Invalid search query.' }, 400); 
    }
    try {
      console.log(`[search] "${q}"`);
      const results = await ytSearch(q);
      console.log(`[search] → ${results.length} results`);
      json(results);
    } catch (err) {
      console.error('[search] error:', err.message);
      json({ error: err.message }, 500);
    }
    return;
  }

  // ── /api/trending ────────────────────────────────────────────────────────
  if (p === '/api/trending') {
    try {
      console.log('[trending] fetching...');
      const results = await ytTrending();
      console.log(`[trending] → ${results.length} results`);
      json(results);
    } catch (err) {
      console.error('[trending] error:', err.message);
      json({ error: err.message }, 500);
    }
    return;
  }

  // ── Static files ─────────────────────────────────────────────────────────
  const filePath = path.join(DIR, p === '/' ? 'index.html' : p);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const { exec } = require('child_process');
  console.log(`\n🎵 NexoMusic → http://localhost:${PORT}\n`);
  exec(`start http://localhost:${PORT}`);
});
