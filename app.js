// ── API helpers ──────────────────────────────────────────────────────────────
const API_BASE = 'https://nexumusic.onrender.com';

async function apiFetch(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  queue: [], queueIdx: -1,
  liked: [], playlists: [], recent: [],
  shuffle: false, repeat: false,
  volume: 80, muted: false,
  playing: false, current: null,
  view: 'home', currentPl: null, ctxTrack: null,
  ytPlayer: null, ytReady: false,
};

// ── YouTube IFrame ────────────────────────────────────────────────────────────
window.onYouTubeIframeAPIReady = () => {
  S.ytPlayer = new YT.Player('yt-player', {
    height: '1', width: '1',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0 },
    events: {
      onReady: () => { S.ytReady = true; ytVol(S.volume); },
      onStateChange: onYT,
    },
  });
};
function onYT(e) {
  const P = YT.PlayerState;
  if (e.data === P.ENDED)    { S.repeat ? S.ytPlayer.seekTo(0) : nextTrack(); }
  if (e.data === P.PLAYING)  { 
    S.playing = true;  updateBtn(); startLoop(); 
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
      updateMediaPosition();
    }
    bgAudio.play().catch(()=>{});
  }
  if (e.data === P.PAUSED || e.data === P.BUFFERING) { 
    S.playing = false; updateBtn(); 
    if (e.data === P.PAUSED && 'mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  }
}

function updateMediaPosition() {
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try {
      let dur=0, cur=0;
      if (isOfflineMode) { dur = offAudio.duration||0; cur = offAudio.currentTime||0; }
      else if (S.ytReady) { dur = S.ytPlayer.getDuration()||0; cur = S.ytPlayer.getCurrentTime()||0; }
      if (dur > 0) navigator.mediaSession.setPositionState({ duration: dur, playbackRate: 1, position: cur });
    } catch(e) {}
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const bgAudio = $('bg-audio');
const offAudio = $('offline-audio');
let isOfflineMode = false;

offAudio.addEventListener('ended', () => { S.repeat ? offAudio.play() : nextTrack(); });
offAudio.addEventListener('play', () => { 
  S.playing = true; updateBtn(); startLoop(); 
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  updateMediaPosition(); 
  bgAudio.play().catch(()=>{}); 
});
offAudio.addEventListener('pause', () => { 
  S.playing = false; updateBtn(); 
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  if(typeof savePlaybackState === 'function') savePlaybackState();
});

const DB_NAME = 'NexoOfflineDB', DB_VER = 1;
let offlineDB;
function initOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore('tracks', { keyPath: 'id' });
    req.onsuccess = e => { offlineDB = e.target.result; resolve(); };
    req.onerror = e => reject(e);
  });
}
async function saveOfflineAudio(id, blob) {
  if(!offlineDB) await initOfflineDB();
  const tx = offlineDB.transaction('tracks', 'readwrite');
  tx.objectStore('tracks').put({ id, blob });
}
async function getOfflineAudio(id) {
  if(!offlineDB) await initOfflineDB();
  return new Promise(resolve => {
    const req = offlineDB.transaction('tracks', 'readonly').objectStore('tracks').get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => resolve(null);
  });
}
async function deleteOfflineAudio(id) {
  if(!offlineDB) await initOfflineDB();
  const tx = offlineDB.transaction('tracks', 'readwrite');
  tx.objectStore('tracks').delete(id);
}

const fmt = s => { s=Math.floor(s||0); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
function decH(str) { const t=document.createElement('textarea'); t.innerHTML=str; return t.value; }
function thumbHTML(t) { return t.thumb ? `<img src="${t.thumb}" alt="" loading="lazy">` : '♪'; }
function toast(msg) {
  const el=$('toast'); el.textContent=msg; el.classList.remove('hidden');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add('hidden'),2500);
}
async function save() {
  if (!currentUser || !window.sb) return;
  try {
    await window.sb.from('profiles').update({
      liked: S.liked,
      playlists: S.playlists,
      recent: S.recent
    }).eq('email', currentUser.email);
  } catch(e) { console.error('Save error', e); }
}

// ── YouTube scraper result → track ───────────────────────────────────────────
function toTrack(item) {
  return {
    id:       item.videoId || '',
    title:    decH(item.title || ''),
    artist:   decH(item.author || ''),
    thumb:    item.thumbnail || '',
    duration: item.lengthSeconds > 0 ? fmt(item.lengthSeconds) : '',
  };
}

// ── Views ─────────────────────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const v=$('view-'+name); if(v) v.classList.add('active');
  document.querySelectorAll('.nav-item[data-view="'+name+'"]').forEach(n=>n.classList.add('active'));
  S.view = name;
}
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    const v = el.dataset.view;
    showView(v);
    if (v==='liked')   renderLiked();
    if (v==='library') renderLibrary();
    if (v==='search')  { $('search-input').focus(); showEmpty(); }
  });
});
$('btn-back').addEventListener('click', ()=>history.back());
$('btn-forward').addEventListener('click', ()=>history.forward());

// ── Greeting ──────────────────────────────────────────────────────────────────
function greet() {
  const h=new Date().getHours();
  $('greeting-time').textContent = h<12?'Morning':h<18?'Afternoon':'Evening';
}

// ── Search ────────────────────────────────────────────────────────────────────
let dbt;
const si=$('search-input'), bc=$('btn-clear-search');
si.addEventListener('input', () => {
  const q=si.value.trim(); bc.classList.toggle('hidden',!q);
  if(!q){showEmpty();return;}
  clearTimeout(dbt); dbt=setTimeout(()=>doSearch(q),450);
  if(S.view!=='search') showView('search');
});
si.addEventListener('focus', ()=>{ if(S.view!=='search') showView('search'); if(!si.value) showEmpty(); });
bc.addEventListener('click', ()=>{ si.value=''; bc.classList.add('hidden'); showEmpty(); });

function showEmpty() {
  $('search-results').innerHTML=''; $('search-loading').classList.add('hidden');
  $('search-empty').classList.remove('hidden'); $('results-count').textContent='';
}

async function doSearch(q) {
  const res=$('search-results'), load=$('search-loading'), emp=$('search-empty');
  res.innerHTML=''; emp.classList.add('hidden'); load.classList.remove('hidden');
  try {
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    load.classList.add('hidden');
    const items = Array.isArray(data) ? data : [];
    if(!items.length){ emp.classList.remove('hidden'); return; }
    const tracks = items.map(toTrack).filter(t=>t.id);
    $('results-count').textContent=`${tracks.length} results`;
    renderList(res, tracks, tracks);
  } catch(err) {
    load.classList.add('hidden');
    res.innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Search failed</h3><p>${err.message}</p></div>`;
  }
}

// ── Track List ────────────────────────────────────────────────────────────────
function renderList(container, tracks, queue) {
  container.innerHTML='';
  tracks.forEach((t,i) => {
    const liked=S.liked.some(l=>l.id===t.id), playing=S.current?.id===t.id;
    const row=document.createElement('div');
    row.className='track-row'+(playing?' playing':'');
    row.innerHTML=`
      <div class="tr-num">${playing?'▶':i+1}</div>
      <div class="tr-thumb">${thumbHTML(t)}</div>
      <div class="tr-info"><div class="tr-title">${t.title}</div><div class="tr-artist">${t.artist}</div></div>
      <div class="tr-right">
        <button class="tr-like${liked?' liked':''}" title="Like">♥</button>
        <span class="tr-duration">${t.duration}</span>
        <button class="tr-more" title="More">⋯</button>
      </div>`;
    row.querySelector('.tr-like').addEventListener('click',e=>{e.stopPropagation();toggleLike(t,row.querySelector('.tr-like'));});
    row.querySelector('.tr-more').addEventListener('click',e=>{e.stopPropagation();showCtx(e,t);});
    row.addEventListener('click',e=>{
      if(e.target.classList.contains('tr-like')||e.target.classList.contains('tr-more'))return;
      playQueue(queue,i);
    });
    container.appendChild(row);
  });
}

// ── Playback ──────────────────────────────────────────────────────────────────
function playQueue(tracks,idx){ S.queue=[...tracks]; S.queueIdx=idx; playTrack(S.queue[idx]); renderQueue(); }
async function playTrack(t) {
  if(!t) return;
  S.current=t;
  isOfflineMode = true;
  if (S.ytReady) S.ytPlayer.pauseVideo();

  const blob = await getOfflineAudio(t.id);
  if (blob) {
    offAudio.src = URL.createObjectURL(blob);
  } else {
    try {
      const streamRes = await fetch(`${API_BASE}/api/stream?id=${t.id}`);
      if (!streamRes.ok) throw new Error('stream fetch failed');
      const streamData = await streamRes.json();
      if (!streamData.url) throw new Error('no url in stream response');
      offAudio.src = streamData.url;
    } catch(e) {
      console.warn('Stream failed, falling back to YouTube IFrame:', e.message);
      isOfflineMode = false;
      if (S.ytReady) { S.ytPlayer.loadVideoById(t.id); S.playing = true; }
      updateNP(); updateBtn(); addRecent(t); highlightQ();
      bgAudio.play().catch(()=>{});
      return;
    }
  }

  offAudio.play().catch(e => { console.error('Play error', e); });
  S.playing = true;
  updateNP(); updateBtn(); addRecent(t); highlightQ();
  bgAudio.play().catch(()=>{});
}

let _audioErrorCount = 0;
offAudio.addEventListener('error', () => {
  _audioErrorCount++;
  if (_audioErrorCount <= 1) {
    toast('Audio unavailable, skipping...');
    setTimeout(nextTrack, 500);
  }
});
offAudio.addEventListener('play', () => { _audioErrorCount = 0; });
function updateNP() {
  const t=S.current; if(!t) return;
  $('np-title').textContent=t.title; $('np-artist').textContent=t.artist;
  $('np-thumb').innerHTML=t.thumb?`<img src="${t.thumb}" alt="">`:'♪';
  $('btn-like-player').classList.toggle('liked',S.liked.some(l=>l.id===t.id));
  document.title=`${t.title} — NexoMusic`;

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      artwork: [{ src: t.thumb || '', sizes: '512x512', type: 'image/jpeg' }]
    });
    navigator.mediaSession.setActionHandler('play', () => { if(isOfflineMode) offAudio.play(); else if(S.ytReady) S.ytPlayer.playVideo(); bgAudio.play().catch(()=>{}); });
    navigator.mediaSession.setActionHandler('pause', () => { if(isOfflineMode) offAudio.pause(); else if(S.ytReady) S.ytPlayer.pauseVideo(); });
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if(d.seekTime !== undefined) { 
        if(isOfflineMode) offAudio.currentTime = d.seekTime;
        else if(S.ytReady) S.ytPlayer.seekTo(d.seekTime); 
        updateMediaPosition(); 
      }
    });
    navigator.mediaSession.setActionHandler('stop', () => {
      if(isOfflineMode) offAudio.pause();
      else if(S.ytReady) S.ytPlayer.pauseVideo();
      if(bgAudio) bgAudio.pause();
      navigator.mediaSession.playbackState = 'none';
      S.playing = false;
      updateBtn();
    });
  }
}
function updateBtn(){ $('icon-play').classList.toggle('hidden',S.playing); $('icon-pause').classList.toggle('hidden',!S.playing); }
$('btn-play-pause').addEventListener('click',()=>{ 
  if(!S.ytReady && !isOfflineMode) return; 
  if (S.playing) { isOfflineMode ? offAudio.pause() : S.ytPlayer.pauseVideo(); }
  else { isOfflineMode ? offAudio.play() : S.ytPlayer.playVideo(); }
});
$('btn-next').addEventListener('click',nextTrack);
$('btn-prev').addEventListener('click',prevTrack);
function nextTrack() {
  if(!S.queue.length) return;
  S.queueIdx=S.shuffle?Math.floor(Math.random()*S.queue.length):(S.queueIdx+1)%S.queue.length;
  playTrack(S.queue[S.queueIdx]);
}
function prevTrack() {
  if(!S.queue.length) return;
  if((S.ytPlayer?.getCurrentTime()||0)>3){S.ytPlayer.seekTo(0);return;}
  S.queueIdx=(S.queueIdx-1+S.queue.length)%S.queue.length;
  playTrack(S.queue[S.queueIdx]);
}
$('btn-shuffle').addEventListener('click',function(){S.shuffle=!S.shuffle;this.classList.toggle('active',S.shuffle);});
$('btn-repeat').addEventListener('click',function(){S.repeat=!S.repeat;this.classList.toggle('active',S.repeat);});

// ── Progress ──────────────────────────────────────────────────────────────────
let loopId;
let isDraggingProgress = false;

function updateProgressUI(pct, cur, dur) {
  $('progress-fill').style.width=pct+'%'; $('progress-thumb').style.left=pct+'%';
  if (cur !== undefined) $('time-current').textContent=fmt(cur);
  if (dur !== undefined) $('time-total').textContent=fmt(dur);
}

function startLoop() {
  clearInterval(loopId);
  loopId=setInterval(()=>{
    if(!S.playing||isDraggingProgress) return;
    let cur = 0, dur = 0;
    if (isOfflineMode) {
      cur = offAudio.currentTime; dur = offAudio.duration;
    } else {
      if(!S.ytReady) return;
      cur=S.ytPlayer.getCurrentTime()||0; dur=S.ytPlayer.getDuration()||0;
    }
    if(!dur) return;
    updateProgressUI((cur/dur)*100, cur, dur);
  }, 100);
}

function handleProgressDrag(e) {
  const r=$('progress-bar').getBoundingClientRect();
  let pct = (e.clientX-r.left)/r.width;
  pct = Math.max(0, Math.min(1, pct));
  const dur = S.ytPlayer?.getDuration()||0;
  updateProgressUI(pct*100, pct*dur, dur);
  return pct;
}

$('progress-bar').addEventListener('pointerdown', e => {
  if (!S.ytReady) return;
  isDraggingProgress = true;
  $('progress-bar').setPointerCapture(e.pointerId);
  handleProgressDrag(e);
});
$('progress-bar').addEventListener('pointermove', e => {
  if (isDraggingProgress) handleProgressDrag(e);
});
$('progress-bar').addEventListener('pointerup', e => {
  if (!isDraggingProgress) return;
  isDraggingProgress = false;
  $('progress-bar').releasePointerCapture(e.pointerId);
  const pct = handleProgressDrag(e);
  if (isOfflineMode) {
    offAudio.currentTime = pct * (offAudio.duration||0);
    setTimeout(updateMediaPosition, 200);
  } else if(S.ytReady) {
    S.ytPlayer.seekTo(pct * (S.ytPlayer.getDuration()||0));
    setTimeout(updateMediaPosition, 200);
  }
});

// ── Volume ────────────────────────────────────────────────────────────────────
let isDraggingVolume = false;

function ytVol(v) {
  S.volume=Math.max(0,Math.min(100,v)); 
  if(S.ytReady) S.ytPlayer.setVolume(S.volume);
  offAudio.volume = S.volume / 100;
  $('volume-fill').style.width=S.volume+'%'; $('volume-thumb').style.left=S.volume+'%';
}

function handleVolumeDrag(e) {
  const r=$('volume-bar').getBoundingClientRect();
  let pct = (e.clientX-r.left)/r.width;
  ytVol(pct * 100);
}

$('volume-bar').addEventListener('pointerdown', e => {
  isDraggingVolume = true;
  $('volume-bar').setPointerCapture(e.pointerId);
  handleVolumeDrag(e);
});
$('volume-bar').addEventListener('pointermove', e => {
  if (isDraggingVolume) handleVolumeDrag(e);
});
$('volume-bar').addEventListener('pointerup', e => {
  if (!isDraggingVolume) return;
  isDraggingVolume = false;
  $('volume-bar').releasePointerCapture(e.pointerId);
  handleVolumeDrag(e);
});

$('btn-mute').addEventListener('click',()=>{
  S.muted=!S.muted; 
  S.ytReady&&(S.muted?S.ytPlayer.mute():S.ytPlayer.unMute());
  offAudio.muted = S.muted;
  $('icon-volume').classList.toggle('hidden',S.muted); $('icon-muted').classList.toggle('hidden',!S.muted);
});

// ── Like ──────────────────────────────────────────────────────────────────────
async function toggleLike(t, btn) {
  const idx=S.liked.findIndex(l=>l.id===t.id);
  if(idx>-1){
    S.liked.splice(idx,1);
    deleteOfflineAudio(t.id);
    toast('Removed from Liked');
  } else {
    S.liked.unshift(t);
    toast('Added to Liked ❤. Downloading...');
    try {
      const res = await fetch(`/api/download?id=${t.id}`);
      if(res.ok) {
        const blob = await res.blob();
        await saveOfflineAudio(t.id, blob);
        toast('Saved for offline listening');
      } else {
        toast('Failed to download', true);
      }
    } catch(e) { console.error('offline err', e); }
  }
  save(); $('liked-count').textContent=`${S.liked.length} songs`;
  if(btn) btn.classList.toggle('liked',idx===-1);
  if(S.current?.id===t.id) $('btn-like-player').classList.toggle('liked',idx===-1);
}
$('btn-like-player').addEventListener('click',()=>{ if(S.current) toggleLike(S.current,null); });

// ── Recent ────────────────────────────────────────────────────────────────────
function addRecent(t){ S.recent=S.recent.filter(r=>r.id!==t.id); S.recent.unshift(t); if(S.recent.length>30)S.recent.length=30; save(); }

// ── Home ──────────────────────────────────────────────────────────────────────
const GENRES=[
  {l:'Top Hits',e:'🔥'},{l:'Chill Vibes',e:'🌊'},{l:'Hip-Hop',e:'🎤'},{l:'Pop',e:'⭐'},
  {l:'R&B Soul',e:'🎷'},{l:'Electronic',e:'🎛️'},{l:'Rock',e:'🎸'},{l:'Jazz',e:'🎹'},
];
function renderHome() {
  greet();
  $('featured-grid').innerHTML=GENRES.map(g=>`<div class="featured-card" data-q="${g.l}"><div class="fc-thumb">${g.e}</div><span>${g.l}</span></div>`).join('');
  $('featured-grid').querySelectorAll('.featured-card').forEach(c=>c.addEventListener('click',()=>{
    si.value=c.dataset.q; bc.classList.remove('hidden'); showView('search'); doSearch(c.dataset.q);
  }));
  renderRecent();
  loadTrending();
}
function renderRecent() {
  const el=$('recent-tracks');
  if(!S.recent.length){el.innerHTML='<p style="color:var(--text-muted);font-size:13px;padding:8px 0">Nothing yet — start searching!</p>';return;}
  el.innerHTML=''; S.recent.slice(0,8).forEach((t,i)=>{ const c=mkCard(t); c.addEventListener('click',()=>playQueue(S.recent,i)); el.appendChild(c); });
}
async function loadTrending() {
  const el=$('trending-tracks'); el.innerHTML='<div class="spinner" style="margin:20px auto"></div>';
  try {
    const data=await apiFetch('/api/trending');
    const arr=Array.isArray(data)?data:[];
    if(!arr.length) throw new Error('empty');
    const tracks=arr.slice(0,8).map(toTrack).filter(t=>t.id);
    el.innerHTML=''; tracks.forEach((t,i)=>{ const c=mkCard(t); c.addEventListener('click',()=>playQueue(tracks,i)); el.appendChild(c); });
  } catch {
    el.innerHTML='<p style="color:var(--text-muted);font-size:13px;padding:8px 0">Could not load trending.</p>';
  }
}
function mkCard(t) {
  const c=document.createElement('div'); c.className='track-card';
  c.innerHTML=`<div class="tc-thumb">${t.thumb?`<img src="${t.thumb}" alt="" loading="lazy">`:'♪'}<div class="tc-play"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div><div class="tc-title">${t.title}</div><div class="tc-artist">${t.artist}</div>`;
  return c;
}

// ── Liked ─────────────────────────────────────────────────────────────────────
function renderLiked() {
  $('liked-count').textContent=`${S.liked.length} songs`;
  const el=$('liked-tracks'),em=$('liked-empty');
  if(!S.liked.length){el.innerHTML='';em.classList.remove('hidden');return;}
  em.classList.add('hidden'); renderList(el,S.liked,S.liked);
}

// ── Library ───────────────────────────────────────────────────────────────────
function renderLibrary(){ renderLibTab(document.querySelector('.lib-tab.active')?.dataset.tab||'playlists'); }
document.querySelectorAll('.lib-tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.lib-tab').forEach(x=>x.classList.remove('active')); t.classList.add('active'); renderLibTab(t.dataset.tab);
}));
function renderLibTab(tab) {
  const el=$('library-content');
  if(tab==='playlists'){
    if(!S.playlists.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🎶</div><h3>No playlists yet</h3><p>Use the + button</p></div>';return;}
    el.innerHTML=S.playlists.map((pl,i)=>`<div class="track-row" data-pl="${i}"><div class="tr-num">${i+1}</div><div class="tr-thumb">🎵</div><div class="tr-info"><div class="tr-title">${pl.name}</div><div class="tr-artist">${pl.tracks.length} songs</div></div><div class="tr-right"></div></div>`).join('');
    el.querySelectorAll('.track-row').forEach(r=>r.addEventListener('click',()=>openPlaylist(+r.dataset.pl)));
  } else {
    if(!S.recent.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🕒</div><h3>Nothing played yet</h3></div>';return;}
    renderList(el,S.recent,S.recent);
  }
}

// ── Playlists ─────────────────────────────────────────────────────────────────
function renderSidebar() {
  $('playlist-list').innerHTML=S.playlists.map((pl,i)=>`<div class="playlist-item ${S.currentPl===i?'active':''}" data-pl="${i}"><div class="pl-icon">🎵</div><div><div class="pl-name">${pl.name}</div><div class="pl-count">${pl.tracks.length} songs</div></div></div>`).join('');
  $('playlist-list').querySelectorAll('.playlist-item').forEach(item=>item.addEventListener('click',()=>openPlaylist(+item.dataset.pl)));
}
function openPlaylist(idx) {
  S.currentPl=idx; const pl=S.playlists[idx];
  $('playlist-header-view').innerHTML=`<div class="phv-cover">🎵</div><div><span class="phv-tag">Playlist</span><h2 class="phv-title">${pl.name}</h2><p class="phv-meta">${pl.tracks.length} songs</p></div>`;
  const el=$('playlist-tracks'),em=$('playlist-empty');
  if(!pl.tracks.length){el.innerHTML='';em.classList.remove('hidden');}else{em.classList.add('hidden');renderList(el,pl.tracks,pl.tracks);}
  showView('playlist'); renderSidebar();
}
$('btn-add-playlist').addEventListener('click',()=>{ $('playlist-modal').classList.remove('hidden'); $('playlist-name-input').value=''; $('playlist-name-input').focus(); });
$('btn-cancel-playlist').addEventListener('click',()=>$('playlist-modal').classList.add('hidden'));
$('btn-create-playlist').addEventListener('click',()=>{
  const name=$('playlist-name-input').value.trim()||`My Playlist #${S.playlists.length+1}`;
  S.playlists.push({name,tracks:[]}); save(); renderSidebar(); $('playlist-modal').classList.add('hidden'); toast(`"${name}" created`);
});
$('playlist-name-input').addEventListener('keydown',e=>{ if(e.key==='Enter')$('btn-create-playlist').click(); });

// ── Context Menu ──────────────────────────────────────────────────────────────
const ctx=$('context-menu');
function showCtx(e,t) {
  S.ctxTrack=t; e.stopPropagation(); ctx.classList.remove('hidden'); $('ctx-submenu').classList.add('hidden');
  ctx.style.left=Math.min(e.clientX,window.innerWidth-220)+'px';
  ctx.style.top=Math.min(e.clientY,window.innerHeight-220)+'px';
  $('ctx-like').textContent=S.liked.some(l=>l.id===t.id)?'💔 Unlike':'❤ Like';
  const sub=$('ctx-submenu');
  sub.innerHTML=S.playlists.map((pl,i)=>`<div class="ctx-item" data-pl="${i}">${pl.name}</div>`).join('')||'<div class="ctx-item" style="color:var(--text-muted)">No playlists</div>';
  sub.querySelectorAll('[data-pl]').forEach(item=>item.addEventListener('click',()=>{
    const pl=S.playlists[+item.dataset.pl];
    if(!pl.tracks.find(x=>x.id===S.ctxTrack.id)){pl.tracks.push(S.ctxTrack);save();toast(`Added to ${pl.name}`);}
    hideCtx();
  }));
}
function hideCtx(){ ctx.classList.add('hidden'); }
document.addEventListener('click',hideCtx);
$('ctx-add-queue').addEventListener('click',()=>{ if(S.ctxTrack){S.queue.push(S.ctxTrack);renderQueue();toast('Added to queue');} hideCtx(); });
$('ctx-like').addEventListener('click',()=>{ if(S.ctxTrack)toggleLike(S.ctxTrack,null); hideCtx(); });
$('ctx-add-playlist').addEventListener('click',e=>{ e.stopPropagation(); $('ctx-submenu').classList.toggle('hidden'); });
$('ctx-copy-link').addEventListener('click',()=>{ if(S.ctxTrack){navigator.clipboard.writeText(`https://youtu.be/${S.ctxTrack.id}`);toast('Link copied!');} hideCtx(); });

// ── Queue ─────────────────────────────────────────────────────────────────────
$('btn-queue').addEventListener('click',()=>{
  const p=$('queue-panel'),a=$('app'),show=p.classList.contains('hidden');
  p.classList.toggle('hidden',!show); a.classList.toggle('queue-open',show); if(show) renderQueue();
});
$('btn-close-queue').addEventListener('click',()=>{ $('queue-panel').classList.add('hidden'); $('app').classList.remove('queue-open'); });
function renderQueue() {
  $('queue-list').innerHTML=S.queue.map((t,i)=>`<div class="queue-item${i===S.queueIdx?' active':''}" data-i="${i}"><div class="qi-thumb">${thumbHTML(t)}</div><div class="qi-info"><div class="qi-title">${t.title}</div><div class="qi-artist">${t.artist}</div></div></div>`).join('');
  $('queue-list').querySelectorAll('.queue-item').forEach(item=>item.addEventListener('click',()=>{ S.queueIdx=+item.dataset.i; playTrack(S.queue[S.queueIdx]); renderQueue(); }));
}
function highlightQ(){ $('queue-list').querySelectorAll('.queue-item').forEach((el,i)=>el.classList.toggle('active',i===S.queueIdx)); }

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
  if(e.code==='Space'){e.preventDefault();$('btn-play-pause').click();}
  if(e.code==='ArrowRight') nextTrack();
  if(e.code==='ArrowLeft')  prevTrack();
});

// ── Auth & Supabase ───────────────────────────────────────────────────────────
const supabaseUrl = 'https://tzqbecfsgsevayycmgcv.supabase.co';
const supabaseKey = 'sb_publishable_R8HCtLEznIitLNT9_M85TQ_i_uMeoBl';
window.sb = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = JSON.parse(localStorage.getItem('nx_currentUser') || 'null');
const authModal = $('auth-modal');
const authForm = $('auth-form');
let authMode = 'login';

async function loadUserState() {
  if (!currentUser) return;
  try {
    const { data, error } = await window.sb.from('profiles').select('*').eq('email', currentUser.email).single();
    if (data) {
      S.liked = data.liked || [];
      S.playlists = data.playlists || [];
      S.recent = data.recent || [];
    } else {
      S.liked = []; S.playlists = []; S.recent = [];
    }
  } catch(e) { console.error(e); }
}

async function initAuth() {
  if (!currentUser || !currentUser.email) {
    currentUser = null;
    authModal.classList.remove('hidden');
    $('app').style.filter = 'blur(5px)';
    $('player-bar').style.filter = 'blur(5px)';
  } else {
    authModal.classList.add('hidden');
    $('app').style.filter = 'none';
    $('player-bar').style.filter = 'none';
    $('user-avatar').textContent = currentUser.email[0].toUpperCase();
    $('account-email').textContent = currentUser.email;
    await loadUserState();
    renderHome();
    renderSidebar();
    $('liked-count').textContent = `${S.liked.length} songs`;
  }
}

$('btn-auth-toggle').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  $('auth-title').textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
  $('btn-auth-submit').textContent = authMode === 'login' ? 'Sign In' : 'Sign Up';
  $('btn-auth-toggle').textContent = authMode === 'login' ? 'Create an account instead' : 'Already have an account? Sign In';
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const pass = $('auth-password').value;
  $('btn-auth-submit').textContent = 'Loading...';
  $('btn-auth-submit').disabled = true;
  
  if (authMode === 'signup') {
    const { data: existing } = await window.sb.from('profiles').select('email').eq('email', email).maybeSingle();
    if (existing) { 
      toast('User already exists', true); 
      $('btn-auth-submit').textContent = 'Sign Up'; 
      $('btn-auth-submit').disabled = false; 
      return; 
    }
    
    const { error } = await window.sb.from('profiles').insert([{ email, password: pass }]);
    if (error) { 
      console.error('Signup Error:', error);
      toast('Error: ' + error.message, true); 
      $('btn-auth-submit').textContent = 'Sign Up'; 
      $('btn-auth-submit').disabled = false; 
      return; 
    }
    
    currentUser = { email };
    toast('Account created!');
  } else {
    const { data: u, error } = await window.sb.from('profiles').select('*').eq('email', email).eq('password', pass).maybeSingle();
    if (error) {
      console.error('Signin Error:', error);
      toast('Error: ' + error.message, true);
      $('btn-auth-submit').textContent = 'Sign In'; 
      $('btn-auth-submit').disabled = false; 
      return;
    }
    if (!u) { 
      toast('Invalid credentials', true); 
      $('btn-auth-submit').textContent = 'Sign In'; 
      $('btn-auth-submit').disabled = false; 
      return; 
    }
    
    currentUser = { email };
    toast('Signed in successfully');
  }
  
  localStorage.setItem('nx_currentUser', JSON.stringify(currentUser));
  $('btn-auth-submit').disabled = false;
  initAuth();
});

$('user-avatar').addEventListener('click', () => {
  $('account-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (!e.target.closest('#account-menu-container')) {
    const d = $('account-dropdown');
    if (d && !d.classList.contains('hidden')) d.classList.add('hidden');
  }
});

$('btn-logout').addEventListener('click', () => {
  currentUser = null;
  localStorage.removeItem('nx_currentUser');
  S.liked = []; S.playlists = []; S.recent = []; S.queue = [];
  $('search-results').innerHTML = '';
  $('account-dropdown').classList.add('hidden');
  if(S.ytPlayer && S.playing) S.ytPlayer.pauseVideo();
  initAuth();
});

// ── Persistence ───────────────────────────────────────────────────────────────
function savePlaybackState() {
  if (!S.current) return;
  localStorage.setItem('nx_playbackState', JSON.stringify({
    queue: S.queue, queueIdx: S.queueIdx,
    current: S.current, time: offAudio.currentTime || 0, volume: S.volume
  }));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePlaybackState(); });
window.addEventListener('beforeunload', savePlaybackState);
setInterval(savePlaybackState, 5000);

function loadPlaybackState() {
  try {
    const saved = JSON.parse(localStorage.getItem('nx_playbackState'));
    if (!saved || !saved.current) return;

    S.queue = saved.queue || [];
    S.queueIdx = saved.queueIdx || 0;
    S.volume = saved.volume ?? 80;
    ytVol(S.volume);

    S.current = saved.current;
    isOfflineMode = true;
    S.playing = false;

    // Restore UI immediately without audio
    updateNP(); updateBtn(); renderQueue(); highlightQ();

    // Load audio src in background (paused) so seek position is ready when user presses play
    getOfflineAudio(S.current.id).then(async blob => {
      if (blob) {
        offAudio.src = URL.createObjectURL(blob);
      } else {
        try {
          const r = await fetch(`${API_BASE}/api/stream?id=${S.current.id}`);
          const d = await r.json();
          if (d.url) offAudio.src = d.url;
        } catch(e) { /* stay silent — user will trigger play manually */ }
      }
      if (offAudio.src) {
        const onMeta = () => {
          offAudio.currentTime = saved.time || 0;
          updateProgressUI(((saved.time||0)/(offAudio.duration||1))*100, saved.time, offAudio.duration);
          offAudio.removeEventListener('loadedmetadata', onMeta);
        };
        offAudio.addEventListener('loadedmetadata', onMeta);
        // Do NOT call offAudio.play() — let the user press play first
      }
    });
  } catch(e) {}
}

// ── Boot ──────────────────────────────────────────────────────────────────────
initAuth();
loadPlaybackState();
