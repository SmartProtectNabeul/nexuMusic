const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execFile } = require('child_process');

const PORT = 3000;
const DIR  = __dirname;

const BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = path.join(DIR, BIN_NAME);

// ── URL cache + dedup ────────────────────────────────────────────────────────
const urlCache       = new Map(); // id → { url, mimeType, bitrate, expiresAt }
const pendingExtracts = new Map(); // id → Promise  (dedup in-flight requests)
const CACHE_TTL_MS   = 45 * 60 * 1000; // 45 min (YouTube CDN URLs last ~6 h)

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

// Simple GET → parsed JSON helper (used by extractAudioUrl strategies)
function getJSON(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...extraHeaders,
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Invalid JSON from ${u.hostname}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
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

function downloadYtDlp() {
  return new Promise((resolve, reject) => {
    console.log('[ensureYtDlp] Downloading yt-dlp binary from GitHub...');
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${BIN_NAME}`;
    const file = fs.createWriteStream(BIN_PATH);
    
    function get(u) {
      https.get(u, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          get(res.headers.location);
        } else if (res.statusCode === 200) {
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            if (process.platform !== 'win32') {
              fs.chmodSync(BIN_PATH, 0o755);
            }
            console.log('[ensureYtDlp] Download complete.');
            resolve();
          });
        } else {
          reject(new Error(`Failed with status: ${res.statusCode}`));
        }
      }).on('error', (err) => {
        reject(err);
      });
    }
    
    get(url);
  });
}

async function ensureYtDlp() {
  if (fs.existsSync(BIN_PATH)) {
    const stats = fs.statSync(BIN_PATH);
    if (stats.size > 1000) {
      console.log(`[ensureYtDlp] yt-dlp binary verified at: ${BIN_PATH}`);
      return;
    }
    console.warn(`[ensureYtDlp] yt-dlp file is corrupted or too small (${stats.size} bytes). Re-downloading...`);
    try { fs.unlinkSync(BIN_PATH); } catch(e) {}
  }
  await downloadYtDlp();
}

let healthyInvidiousInstances = [];
const BACKUP_INVIDIOUS = [
  'https://inv.thepixora.com',
  'https://invidious.nerdvpn.de',
  'https://invidious.flokinet.to',
  'https://invidious.privacydev.net'
];

async function refreshInvidiousInstances() {
  try {
    console.log('[instances] Fetching fresh Invidious instances list...');
    const list = await getJSON('https://api.invidious.io/instances.json');
    if (!Array.isArray(list)) return;
    const parsed = list
      .map(item => {
        const domain = item[0];
        const stats = item[1];
        return { domain, ...stats };
      })
      .filter(inst => {
        const isHttps = inst.type === 'https';
        const isHealthy = inst.monitor && inst.monitor.enabled === true && inst.monitor.last_status === 200;
        // Skip instances that disable API or have issues
        const isBlacklisted = ['nadeko.net'].some(b => inst.domain.includes(b));
        return isHttps && isHealthy && inst.domain && !isBlacklisted;
      })
      .map(inst => inst.uri || `https://${inst.domain}`);
    if (parsed.length) {
      healthyInvidiousInstances = parsed;
      console.log(`[instances] Loaded ${parsed.length} healthy Invidious instances!`);
    }
  } catch(e) {
    console.warn('[instances] Failed to fetch dynamic instances list:', e.message);
  }
}

async function extractAudioUrlFallback(id) {
  // If we don't have any dynamically loaded instances, try fetching them once!
  if (!healthyInvidiousInstances || !healthyInvidiousInstances.length) {
    await refreshInvidiousInstances();
  }
  
  // Combine dynamically fetched instances with our hardcoded backup instances (deduplicated)
  const instances = [...new Set([...(healthyInvidiousInstances || []), ...BACKUP_INVIDIOUS])];
  console.log(`[extract-fallback] Waterfalling through ${instances.length} active Invidious instances for ID: ${id}`);

  for (const base of instances) {
    try {
      console.log(`[extract-fallback] Querying Invidious instance: ${base}`);
      const data = await getJSON(`${base}/api/v1/videos/${id}?fields=adaptiveFormats`);
      const formats = (data.adaptiveFormats || [])
        .filter(f => f.type?.startsWith('audio/') && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (formats.length) {
        console.log(`[extract-fallback] Invidious SUCCESS via ${base}!`);
        return { url: formats[0].url, mimeType: formats[0].type || 'audio/webm', bitrate: formats[0].bitrate || 128000 };
      }
    } catch(e) {
      console.warn(`[extract-fallback] Instance ${base} failed: ${e.message}`);
    }
  }

  throw new Error('All fallback extraction strategies failed');
}

// ── Shared: extract direct audio CDN URL (cached + deduped) ─────────────────
async function extractAudioUrl(id) {
  // 1. Cache hit — instant return
  const cached = urlCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[extract] Cache HIT for ${id}`);
    return { url: cached.url, mimeType: cached.mimeType, bitrate: cached.bitrate };
  }
  // 2. Dedup — join in-flight extraction instead of spawning another yt-dlp
  if (pendingExtracts.has(id)) {
    console.log(`[extract] Dedup: joining in-flight request for ${id}`);
    return pendingExtracts.get(id);
  }

  await ensureYtDlp();

  const promise = new Promise((resolve, reject) => {
    console.log(`[extract] Running yt-dlp for ${id}...`);
    execFile(
      BIN_PATH,
      ['-f', 'bestaudio', '-g', '--no-playlist', '--no-warnings',
       '--socket-timeout', '8',
       `https://www.youtube.com/watch?v=${id}`],
      { timeout: 22000 },   // built-in execFile timeout — sends SIGTERM
      async (err, stdout) => {
        pendingExtracts.delete(id);
        if (err) {
          console.warn(`[extract] yt-dlp error for ${id}, trying fallback:`, err.message);
          try {
            const fbResult = await extractAudioUrlFallback(id);
            urlCache.set(id, { ...fbResult, expiresAt: Date.now() + CACHE_TTL_MS });
            return resolve(fbResult);
          } catch(fbErr) {
            console.error(`[extract] Fallback also failed for ${id}:`, fbErr.message);
            return reject(new Error('Audio extraction failed'));
          }
        }
        const directUrl = (stdout || '').trim().split('\n')[0];
        if (!directUrl) {
          console.warn(`[extract] No audio URL from yt-dlp for ${id}, trying fallback`);
          try {
            const fbResult = await extractAudioUrlFallback(id);
            urlCache.set(id, { ...fbResult, expiresAt: Date.now() + CACHE_TTL_MS });
            return resolve(fbResult);
          } catch(fbErr) {
            console.error(`[extract] Fallback also failed for ${id}:`, fbErr.message);
            return reject(new Error('No audio URL from yt-dlp or fallbacks'));
          }
        }
        const result = { url: directUrl, mimeType: 'audio/webm', bitrate: 128000 };
        urlCache.set(id, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
        console.log(`[extract] SUCCESS for ${id}`);
        resolve(result);
      }
    );
  });

  pendingExtracts.set(id, promise);
  return promise;
}



// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  // Always allow CORS from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

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

  if (rl.count > 200) { // Max 200 requests per minute per IP
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


  // ── /api/warmup  (pre-extract audio URL into cache, BLOCKS until ready) ──
  if (p === '/api/warmup') {
    const id = u.searchParams.get('id');
    if (!id || !/^[a-zA-Z0-9_-]{6,15}$/.test(id)) return json({ ok: false }, 400);
    // If already cached, respond immediately
    const cached = urlCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return json({ ok: true, cached: true });
    }
    // Otherwise, await extraction so the client knows the URL is ready
    try {
      await extractAudioUrl(id);
      console.log(`[warmup] pre-extracted ${id}`);
      return json({ ok: true, cached: false });
    } catch(e) {
      console.warn(`[warmup] failed for ${id}:`, e.message);
      return json({ ok: false, error: e.message }, 502);
    }
  }

  // ── /api/download ────────────────────────────────────────────────────────
  if (p === '/api/download') {
    const id = u.searchParams.get('id');
    if (!id || !/^[a-zA-Z0-9_-]{6,15}$/.test(id)) return json({ error: 'Invalid id' }, 400);
    try {
      console.log(`[download] ${id}`);
      const fmt = await extractAudioUrl(id);
      console.log(`[download] → ${fmt.mimeType} @ ${fmt.bitrate}bps`);

      // Pipe directly from YouTube's CDN to the client
      https.get(fmt.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com',
        }
      }, audioRes => {
        res.writeHead(200, {
          'Content-Type': fmt.mimeType || 'audio/mp4',
          'Content-Length': audioRes.headers['content-length'] || '',
          'Content-Disposition': `attachment; filename="${id}.m4a"`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        });
        audioRes.pipe(res);
        audioRes.on('error', err => { console.error('[download] pipe error:', err.message); res.end(); });
      }).on('error', err => {
        console.error('[download] CDN fetch error:', err.message);
        if (!res.headersSent) json({ error: 'CDN fetch failed' }, 502);
      });
    } catch(err) {
      console.error('[download] error:', err.message);
      if (!res.headersSent) json({ error: err.message }, 502);
    }
    return;
  }

  // ── /api/stream ──────────────────────────────────────────────────────────
  if (p === '/api/stream') {
    const id = u.searchParams.get('id');
    if (!id || !/^[a-zA-Z0-9_-]{6,15}$/.test(id)) return json({ error: 'Invalid id' }, 400);
    try {
      console.log(`[stream] ${id}`);
      const fmt = await extractAudioUrl(id);
      console.log(`[stream] → piping ${fmt.mimeType} @ ${fmt.bitrate}bps`);

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com',
      };

      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      https.get(fmt.url, { headers }, audioRes => {
        const responseHeaders = {
          'Content-Type': fmt.mimeType || 'audio/webm',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        };

        if (audioRes.headers['content-length']) {
          responseHeaders['Content-Length'] = audioRes.headers['content-length'];
        }
        if (audioRes.headers['content-range']) {
          responseHeaders['Content-Range'] = audioRes.headers['content-range'];
        }

        res.writeHead(audioRes.statusCode || 200, responseHeaders);
        audioRes.pipe(res);
        
        audioRes.on('error', err => {
          console.error('[stream] pipe error:', err.message);
          res.end();
        });
      }).on('error', err => {
        console.error('[stream] CDN fetch error:', err.message);
        if (!res.headersSent) json({ error: 'CDN fetch failed' }, 502);
      });
    } catch(err) {
      console.error('[stream] error:', err.message);
      if (!res.headersSent) json({ error: err.message }, 502);
    }
    return;
  }

  if (p === '/api/log') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { console.log('\n--- BROWSER ERROR ---\n', body, '\n-------------------\n'); res.end(); });
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

server.listen(PORT, async () => {
  const { exec } = require('child_process');
  console.log(`\n🎵 NexoMusic → http://localhost:${PORT}\n`);
  
  // Dynamically fetch and pre-populate invidious list on boot
  refreshInvidiousInstances().catch(()=>{});

  try {
    await ensureYtDlp();
    console.log('[NexoMusic] yt-dlp is ready for extraction!');
  } catch(e) {
    console.error('[NexoMusic] WARNING: Failed to initialize yt-dlp on boot:', e.message);
  }
  
  exec(`start http://localhost:${PORT}`);
});
