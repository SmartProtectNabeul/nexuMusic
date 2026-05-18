const fs=require('fs');
const src=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const ids = new Set([...html.matchAll(/id=\"([^\"]+)\"/g)].map(m=>m[1]));
const missingIds = new Set();
const doc = {
  getElementById: (id) => {
    if (!ids.has(id)) missingIds.add(id);
    return {
      addEventListener: ()=>{}, classList: {add:()=>{}, remove:()=>{}, toggle:()=>{}, contains:()=>false},
      style: {}, innerHTML: '', textContent: '', dataset: {}, value: '', src: '', volume: 1, play: async()=>{}, pause: ()=>{}, addTextTrack:()=>{}
    };
  },
  addEventListener: ()=>{}, querySelectorAll: ()=>[], title: ''
};
const win = { addEventListener: ()=>{}, localStorage: { getItem: ()=>null, setItem: ()=>{} }, supabase: { createClient: ()=>({ from: ()=>({ select: ()=>({ eq: ()=>({ single: async ()=>({data:null}), maybeSingle: async ()=>({data:null}) }) }) }) }) }, onYouTubeIframeAPIReady: null };
global.window = win; global.document = doc; global.navigator = { mediaSession: {} }; global.localStorage = win.localStorage; global.YT = { Player: function(){} };
try { eval(src); } catch(e) {}
console.log('Missing IDs:', [...missingIds]);
