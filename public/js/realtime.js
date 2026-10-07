// Realtime layer: WebSocket connection to server.js with auto-reconnect and a heartbeat,
// so a bad connection is noticed fast and rooms are re-joined automatically.
// Fires window events 'net' with detail 'down' (lost) / 'up' (reconnected).
(()=>{if(window.claude)return;
let ws=null,id=null,up=false,everUp=false,backoff=500,wait=[],tmr=0,lastRx=0;
const raw=[],nss=new Map(),url=(location.protocol=='https:'?'wss://':'ws://')+location.host;
const send=o=>{if(ws&&ws.readyState==1)ws.send(JSON.stringify(o))};
const fire=d=>{try{window.dispatchEvent(new CustomEvent('net',{detail:d}))}catch(_){}};
function down(){if(up){up=false;fire('down')}}
function connect(){clearTimeout(tmr);let w;try{w=ws=new WebSocket(url)}catch(_){tmr=setTimeout(connect,backoff);return}
 w.onmessage=e=>{if(w!==ws)return;lastRx=Date.now();let m;try{m=JSON.parse(e.data)}catch(_){return}
  if(m.t=='welcome'){id=m.id;backoff=500;const re=everUp;everUp=true;up=true;nss.forEach(n=>n._join());wait.splice(0).forEach(f=>f());if(re)fire('up');raw.slice().forEach(f=>f(m))}
  else if(m.t=='pong'){}
  else if(typeof m.t=='string'&&m.t.startsWith('jp:'))raw.slice().forEach(f=>f(m))   // server-authoritative games (Jutpatti)
  else{const n=nss.get(m.room);if(n)n._msg(m)}};
 w.onclose=()=>{if(w!==ws)return;down();tmr=setTimeout(connect,backoff);backoff=Math.min(backoff*2,8000)}}
function kill(){const w=ws;ws=null;if(w){w.onclose=null;w.onmessage=null;try{w.close()}catch(_){}}down();backoff=500;connect()}
// heartbeat: a silent/dead connection (common on mobile data) is dropped and re-opened
setInterval(()=>{if(up){if(Date.now()-lastRx>15000)kill();else send({t:'ping'})}},5000);
const probe=()=>{if(!up){if(!ws||ws.readyState>1)kill();return}const t=Date.now();send({t:'ping'});setTimeout(()=>{if(up&&lastRx<t)kill()},3000)};
addEventListener('online',probe);document.addEventListener('visibilitychange',()=>{if(!document.hidden)probe()});
function ns(room){const o={pres:{},peers:[],h:{},pl:[]};
 const a={emit:(topic,data)=>send({t:'emit',room,topic,data}),
  on:(topic,fn)=>{(o.h[topic]=o.h[topic]||[]).push(fn);return()=>{o.h[topic]=(o.h[topic]||[]).filter(f=>f!==fn)}},
  presence:p=>{Object.assign(o.pres,p);send({t:'pres',room,p:o.pres})},
  peers:()=>o.peers,
  onPeers:fn=>{o.pl.push(fn);return()=>{o.pl=o.pl.filter(f=>f!==fn)}},
  leave:()=>{send({t:'leave',room});nss.delete(room)},
  _join:()=>{send({t:'join',room});if(Object.keys(o.pres).length)send({t:'pres',room,p:o.pres})},
  _msg:m=>{if(m.t=='peers'){const nw=m.peers.map(p=>({id:p.id,isMe:p.id==id,presence:p.presence||{}})),oi=o.peers.map(p=>p.id),ni=nw.map(p=>p.id),
    joined=nw.filter(p=>!oi.includes(p.id)),left=o.peers.filter(p=>!ni.includes(p.id));o.peers=nw;o.pl.slice().forEach(f=>f({joined,left,peers:nw}))}
   else if(m.t=='ev')(o.h[m.topic]||[]).slice().forEach(f=>f({data:m.data,from:m.from,topic:m.topic}))}};
 nss.set(room,a);a._join();return a}
const ready=()=>new Promise((res,rej)=>{if(up)return res();wait.push(res);setTimeout(()=>rej(new Error('offline')),8000)});
connect();
let lobby;window.claude={online:()=>up,
 // direct messages for server-authoritative games: listeners also get 'welcome' on every (re)connect
 raw:{send:o=>{send(o);return up},on:fn=>{raw.push(fn);return()=>{const i=raw.indexOf(fn);if(i>=0)raw.splice(i,1)}},online:()=>up},use:async n=>{if(n!='room')return null;try{await ready()}catch(_){}
 if(!lobby){lobby=ns('*');lobby.join=async name=>{await ready();return ns(name)}}return lobby}}})();
