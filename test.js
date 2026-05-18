const fs=require('fs');
const src=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const idMatches = [...html.matchAll(/id=\"([^\"]+)\"/g)].map(m=>m[1]);
const doc = {
  getElementById: id => idMatches.includes(id) ? {
    addEventListener: ()=>{},
    classList: {add:()=>{}, remove:()=>{}, toggle:()=>{}, contains:()=>false},
    style: {},
    querySelectorAll: ()=>[],
    innerHTML: '',
    textContent: '',
    dataset: {},
    value: '',
    src: '',
    volume: 1,
    play: async()=>{},
    pause: ()=>{},
    addTextTrack:()=>{}
  } : null,
  addEventListener: ()=>{},
  querySelectorAll: ()=>[],
  title: ''
};
const win = {
  addEventListener: ()=>{},
  localStorage: { getItem: ()=>null, setItem: ()=>{} },
  supabase: { createClient: ()=>({ from: ()=>({ select: ()=>({ eq: ()=>({ single: async ()=>({data:null}), maybeSingle: async ()=>({data:null}) }) }) }) }) },
  onYouTubeIframeAPIReady: null
};
global.window = win;
global.document = doc;
global.navigator = { mediaSession: {} };
global.localStorage = win.localStorage;
global.YT = { Player: function(){} };
try {
  eval(src);
  console.log('OK!');
} catch(e) {
  console.error('CRASH:', e.stack);
}
