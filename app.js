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
  if (e.data === P.PLAYING)  { S.playing = true;  updateBtn(); startLoop(); }
  if (e.data === P.PAUSED || e.data === P.BUFFERING) { S.playing = false; updateBtn(); }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
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
  const n=$('nav-'+name);  if(n) n.classList.add('active');
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
function playTrack(t) {
  if(!t||!S.ytReady) return;
  S.current=t; S.ytPlayer.loadVideoById(t.id); S.playing=true;
  updateNP(); updateBtn(); addRecent(t); highlightQ();
}
function updateNP() {
  const t=S.current; if(!t) return;
  $('np-title').textContent=t.title; $('np-artist').textContent=t.artist;
  $('np-thumb').innerHTML=t.thumb?`<img src="${t.thumb}" alt="">`:'♪';
  $('btn-like-player').classList.toggle('liked',S.liked.some(l=>l.id===t.id));
  document.title=`${t.title} — NexoMusic`;
}
function updateBtn(){ $('icon-play').classList.toggle('hidden',S.playing); $('icon-pause').classList.toggle('hidden',!S.playing); }
$('btn-play-pause').addEventListener('click',()=>{ if(!S.ytReady) return; S.playing?S.ytPlayer.pauseVideo():S.ytPlayer.playVideo(); });
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
function startLoop() {
  clearInterval(loopId);
  loopId=setInterval(()=>{
    if(!S.ytReady||!S.playing) return;
    const cur=S.ytPlayer.getCurrentTime()||0, dur=S.ytPlayer.getDuration()||0;
    if(!dur) return;
    const pct=(cur/dur)*100;
    $('progress-fill').style.width=pct+'%'; $('progress-thumb').style.left=pct+'%';
    $('time-current').textContent=fmt(cur); $('time-total').textContent=fmt(dur);
  },500);
}
$('progress-bar').addEventListener('click',e=>{
  const r=$('progress-bar').getBoundingClientRect();
  if(S.ytReady) S.ytPlayer.seekTo(((e.clientX-r.left)/r.width)*(S.ytPlayer.getDuration()||0));
});

// ── Volume ────────────────────────────────────────────────────────────────────
function ytVol(v) {
  S.volume=Math.max(0,Math.min(100,v)); if(S.ytReady) S.ytPlayer.setVolume(S.volume);
  $('volume-fill').style.width=S.volume+'%'; $('volume-thumb').style.left=S.volume+'%';
}
$('volume-bar').addEventListener('click',e=>{ const r=$('volume-bar').getBoundingClientRect(); ytVol(((e.clientX-r.left)/r.width)*100); });
$('btn-mute').addEventListener('click',()=>{
  S.muted=!S.muted; S.ytReady&&(S.muted?S.ytPlayer.mute():S.ytPlayer.unMute());
  $('icon-volume').classList.toggle('hidden',S.muted); $('icon-muted').classList.toggle('hidden',!S.muted);
});

// ── Like ──────────────────────────────────────────────────────────────────────
function toggleLike(t, btn) {
  const idx=S.liked.findIndex(l=>l.id===t.id);
  idx>-1?S.liked.splice(idx,1):S.liked.unshift(t);
  save(); $('liked-count').textContent=`${S.liked.length} songs`;
  if(btn) btn.classList.toggle('liked',idx===-1);
  if(S.current?.id===t.id) $('btn-like-player').classList.toggle('liked',idx===-1);
  toast(idx>-1?'Removed from Liked':'Added to Liked ❤');
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
  if (!currentUser) {
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
      toast('Error creating account', true); 
      $('btn-auth-submit').textContent = 'Sign Up'; 
      $('btn-auth-submit').disabled = false; 
      return; 
    }
    
    currentUser = { email };
    toast('Account created!');
  } else {
    const { data: u, error } = await window.sb.from('profiles').select('*').eq('email', email).eq('password', pass).maybeSingle();
    if (!u || error) { 
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

// ── Boot ──────────────────────────────────────────────────────────────────────
initAuth();
