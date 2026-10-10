// Ludo 3D: board, pawns, dice, camera, game rules and the main game loop.
// Two boards with the same rules: the classic 4-player cross, and a 6-arm board for 5-6 players.
const C=[0xfbc916,0x22c55e,0xef4444,0x3b82f6,0xf97316,0xa855f7],CN=['Yellow','Green','Red','Blue','Orange','Purple'],CS=['#fbc916','#22c55e','#ef4444','#3b82f6','#f97316','#a855f7'];
const path=[],seg=(c,r,dc,dr,n)=>{for(let i=0;i<n;i++)path.push([c+dc*i,r+dr*i])};
seg(1,6,1,0,5);seg(6,5,0,-1,6);seg(7,0,1,0,2);seg(8,1,0,1,5);seg(9,6,1,0,6);seg(14,7,0,1,2);seg(13,8,-1,0,5);seg(8,9,0,1,6);seg(7,14,-1,0,2);seg(6,13,0,-1,5);seg(5,8,-1,0,6);seg(0,7,0,-1,2);
const LN=[[1,7,1,0],[7,1,0,1],[13,7,-1,0],[7,13,0,-1]],START=[0,13,26,39],SAFE=new Set([0,8,13,21,26,34,39,47]);
const YD=[];const YB=[[0,0],[9,0],[9,9],[0,9]],SL=[[1.5,1.5],[3.5,1.5],[1.5,3.5],[3.5,3.5]],DIR=[[-1,0],[0,-1],[1,0],[0,1]],BY=.14;
// The active board. Classic: 52 track cells, home lane after 50, finish at 56.
// 6-arm: 6 x 13 = 78 track cells, home lane after 76, finish at 82. Everything else is the same rule set.
let NP=4,TRACK=52,TMAX=50,FIN=56,STARTS=START,SAFES=SAFE;
const abs=(pl,p)=>(STARTS[pl]+p)%TRACK;
// ---- 6-arm board: each arm is 3 cells wide and 6 long, like an arm of the classic cross.
// Per arm the track runs out along one side, across the tip, and back in along the other side (13 cells).
// A player's home lane is the middle column of their arm; their yard sits between their arm and the next.
const HX={R0:1.5/Math.tan(Math.PI/6),YARD:7.7};   // R0: arms touch at the centre hexagon
const hAng=k=>-Math.PI/2+k*Math.PI/3;
const hPt=(k,c,r)=>{const a=hAng(k),ux=Math.cos(a),uz=Math.sin(a),d=HX.R0+.5+r;return[ux*d-uz*c,uz*d+ux*c]};
const hTrack=[];for(let k=0;k<6;k++){for(let r=0;r<6;r++)hTrack.push(hPt(k,-1,r));hTrack.push(hPt(k,0,5));for(let r=5;r>=0;r--)hTrack.push(hPt(k,1,r))}
const HSTART=[0,1,2,3,4,5].map(k=>k*13+8),HSAFE=new Set(HSTART.flatMap(s=>[s,(s+8)%78]));
const yardDir=p=>hAng(p)+Math.PI/6;
function yardSlot(p,i){const a=yardDir(p),ux=Math.cos(a),uz=Math.sin(a),cx=ux*HX.YARD,cz=uz*HX.YARD,s=i%2?.75:-.75,t=i<2?-.75:.75;return[cx+ux*t-uz*s,cz+uz*t+ux*s]}
// world (x,z) of pawn i of player pl at progress p, on whichever board is active
function cellW(pl,i,p){
 if(NP==4){const c=cellRC(pl,i,p);return[c[0]-7,c[1]-7]}
 if(p<0)return yardSlot(pl,i);
 if(p<=TMAX)return hTrack[abs(pl,p)];
 if(p<FIN)return hPt(pl,0,4-(p-TMAX-1));
 const a=hAng(pl),ux=Math.cos(a),uz=Math.sin(a),d=HX.R0*.5,c=(i-1.5)*.32;return[ux*d-uz*c,uz*d+ux*c]}
function cellRC(pl,i,p){if(p<0)return[SL[i][0]+YB[pl][0],SL[i][1]+YB[pl][1]];
 if(p<=50)return path[abs(pl,p)];const L=LN[pl];if(p<56)return[L[0]+L[2]*(p-51),L[1]+L[3]*(p-51)];
 const d=DIR[pl];return[7+d[0]*1.1-d[1]*(i-1.5)*.3,7+d[1]*1.1+d[0]*(i-1.5)*.3]}
// ---------- three
const cv=document.getElementById('cv'),R=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});
R.setPixelRatio(Math.min(devicePixelRatio,2));R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;
const S=new THREE.Scene(),cam=new THREE.PerspectiveCamera(28,1,.1,300);
S.add(new THREE.HemisphereLight(0xffffff,0x445577,.36));
const sun=new THREE.DirectionalLight(0xffffff,.65);sun.position.set(6,16,9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:1,far:40});S.add(sun);
{const pm=new THREE.PMREMGenerator(R),es=new THREE.Scene();es.add(new THREE.Mesh(new THREE.SphereGeometry(10,32,16),new THREE.MeshBasicMaterial({side:THREE.BackSide,color:0x6a78a8})));
[[0xffffff,6,8,4],[0xffe2b0,-8,5,-6],[0x9ab8ff,0,-3,9],[0xffffff,-6,7,6]].forEach(l=>{const m=new THREE.Mesh(new THREE.SphereGeometry(2.2,16,8),new THREE.MeshBasicMaterial({color:l[0]}));m.position.set(l[1],l[2],l[3]);es.add(m)});S.environment=pm.fromScene(es,.03).texture}
const glow=new THREE.PointLight(0xffffff,.8,14);glow.position.set(0,3,0);S.add(glow);
const LM=new THREE.LineBasicMaterial({color:0x000000,transparent:true,opacity:.16});
let BP=S;   // where board meshes are added
const box=(w,h,d,col,x,y,z,sh=true)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial({color:col}));m.position.set(x,y,z);m.receiveShadow=true;m.castShadow=sh;m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),LM));BP.add(m);return m};
const classicG=new THREE.Group();S.add(classicG);BP=classicG;
box(16.4,.2,16.4,0x2a1f4d,0,-.1,0);box(15.1,.02,15.1,0xe4e1ec,0,.01,0,false);
for(let p=0;p<4;p++){const[bx,by]=YB[p];YD[p]=box(6,.1,6,C[p],bx+2.5-7,.05,by+2.5-7,false);box(4,.02,4,new THREE.Color(C[p]).multiplyScalar(.42).getHex(),bx+2.5-7,.11,by+2.5-7,false);
 for(let i=0;i<4;i++){const m=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.02,28),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.45}));m.position.set(SL[i][0]+bx-7,.13,SL[i][1]+by-7);m.receiveShadow=true;BP.add(m);{const rg=new THREE.Mesh(new THREE.RingGeometry(.5,.6,40),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.55,side:THREE.DoubleSide}));rg.rotation.x=-Math.PI/2;rg.position.set(m.position.x,.145,m.position.z);BP.add(rg)}}}
const stS=new THREE.Shape();for(let k=0;k<10;k++){const a=k*Math.PI/5+Math.PI/2,rr=k%2?.15:.34;k?stS.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):stS.moveTo(Math.cos(a)*rr,Math.sin(a)*rr)}stS.closePath();const star=new THREE.ShapeGeometry(stS),starM=new THREE.MeshBasicMaterial({color:0xffffff});
path.forEach((c,i)=>{let col=SAFE.has(i)?0xd5d0e3:0xffffff;START.forEach((s,p)=>{if(s==i)col=C[p]});box(.94,.1,.94,col,c[0]-7,.05,c[1]-7,false);
 if(SAFE.has(i)){const s=new THREE.Mesh(star,starM);s.rotation.x=-Math.PI/2;s.position.set(c[0]-7,.108,c[1]-7);BP.add(s)}});
LN.forEach((L,p)=>{for(let k=0;k<5;k++)box(.94,.1,.94,C[p],L[0]+L[2]*k-7,.05,L[1]+L[3]*k-7,false)});
[[[-1.5,-1.5],[-1.5,1.5]],[[-1.5,-1.5],[1.5,-1.5]],[[1.5,-1.5],[1.5,1.5]],[[-1.5,1.5],[1.5,1.5]]].forEach((v,p)=>{
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([v[0][0],.11,v[0][1],v[1][0],.11,v[1][1],0,.11,0],3));g.setAttribute('normal',new THREE.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));
 BP.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:C[p],side:THREE.DoubleSide})));BP.add(new THREE.LineLoop(g,new THREE.LineBasicMaterial({color:0})))});
BP=S;
// ---- the 6-arm board (built the first time it's needed)
let hexG=null;const YD6=[];
function buildHex(){if(hexG)return;hexG=new THREE.Group();S.add(hexG);BP=hexG;
 const hexM=(r,h,y,col)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,6),new THREE.MeshBasicMaterial({color:col}));m.rotation.y=Math.PI/6;m.position.y=y;m.receiveShadow=true;m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),LM));hexG.add(m);return m};
 hexM(11,.2,-.1,0x2a1f4d);hexM(10.6,.02,.01,0xe4e1ec);
 const tile=(x,z,a,col)=>{const m=box(.94,.1,.94,col,x,.05,z,false);m.rotation.y=-a;return m};
 hTrack.forEach((c,i)=>{let col=HSAFE.has(i)?0xd5d0e3:0xffffff;HSTART.forEach((s,p)=>{if(s==i)col=C[p]});tile(c[0],c[1],hAng(Math.floor(i/13)),col);
  if(HSAFE.has(i)){const s=new THREE.Mesh(star,starM);s.rotation.x=-Math.PI/2;s.position.set(c[0],.108,c[1]);hexG.add(s)}});
 for(let p=0;p<6;p++){for(let r=0;r<5;r++){const c=hPt(p,0,r);tile(c[0],c[1],hAng(p),C[p])}
  const a=yardDir(p),cx=Math.cos(a)*HX.YARD,cz=Math.sin(a)*HX.YARD,disc=(r,y,col)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.1,48),new THREE.MeshBasicMaterial({color:col}));m.position.set(cx,y,cz);hexG.add(m);return m};
  YD6[p]=disc(2.2,.05,C[p]);disc(1.7,.07,new THREE.Color(C[p]).multiplyScalar(.42).getHex());
  for(let i=0;i<4;i++){const q=yardSlot(p,i),m=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.02,28),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.45}));m.position.set(q[0],.13,q[1]);hexG.add(m);
   const rg=new THREE.Mesh(new THREE.RingGeometry(.5,.6,40),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.55,side:THREE.DoubleSide}));rg.rotation.x=-Math.PI/2;rg.position.set(q[0],.145,q[1]);hexG.add(rg)}
  // centre: one coloured triangle per arm
  const u=[Math.cos(hAng(p)),Math.sin(hAng(p))],v=[-u[1],u[0]],R=HX.R0,g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([u[0]*R-v[0]*1.5,.11,u[1]*R-v[1]*1.5,u[0]*R+v[0]*1.5,.11,u[1]*R+v[1]*1.5,0,.11,0],3));g.setAttribute('normal',new THREE.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));
  hexG.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:C[p],side:THREE.DoubleSide})));hexG.add(new THREE.LineLoop(g,new THREE.LineBasicMaterial({color:0})))}
 BP=S}
// switches the active board (4 = classic cross, 6 = six arms for 5-6 players)
function setBoard(n){NP=n==6?6:4;
 if(NP==6){buildHex();TRACK=78;TMAX=76;FIN=82;STARTS=HSTART;SAFES=HSAFE}else{TRACK=52;TMAX=50;FIN=56;STARTS=START;SAFES=SAFE}
 classicG.visible=NP==4;if(hexG)hexG.visible=NP==6;sc.scale.setScalar(NP==6?1.45:1);sph.tr=NP==6?50:39}
// tokens
const pawnG=(()=>{const V=THREE.Vector2,sp=new THREE.SplineCurve([[.34,.17],[.27,.27],[.2,.42],[.15,.58],[.13,.7]].map(a=>new V(...a))).getPoints(22),
 pts=[[0,0],[.4,0],[.46,.03],[.47,.09],[.43,.15]].map(a=>new V(...a)).concat(sp,[[.2,.72],[.31,.76],[.33,.83],[.27,.89],[.17,.9],[0,.9]].map(a=>new V(...a)));return new THREE.LatheGeometry(pts,56)})(),headG=new THREE.SphereGeometry(.31,40,28),ringG=new THREE.TorusGeometry(.5,.06,8,28);
const sc=new THREE.Mesh(new THREE.PlaneGeometry(15.6,15.6),new THREE.ShadowMaterial({opacity:.32}));sc.rotation.x=-Math.PI/2;sc.position.y=.145;sc.receiveShadow=true;S.add(sc);
const T=[],ALL=[];
for(let p=0;p<6;p++){T[p]=[];for(let i=0;i<4;i++){const g=new THREE.Group(),m=new THREE.Mesh(pawnG,new THREE.MeshPhysicalMaterial({color:C[p],roughness:.22,metalness:.1,clearcoat:1,clearcoatRoughness:.08,envMapIntensity:.5,emissive:C[p],emissiveIntensity:0}));m.castShadow=true;m.scale.setScalar(.6);const hd=new THREE.Mesh(headG,m.material);hd.position.y=1.06;hd.castShadow=true;m.add(hd);{const om=new THREE.MeshBasicMaterial({color:0x14142b,side:THREE.BackSide}),o1=new THREE.Mesh(pawnG,om),o2=new THREE.Mesh(headG,om);o1.scale.setScalar(1.1);o2.scale.setScalar(1.1);o1.raycast=o2.raycast=()=>{};m.add(o1);hd.add(o2)}
 const ring=new THREE.Mesh(ringG,new THREE.MeshBasicMaterial({color:0xffffff}));ring.rotation.x=Math.PI/2;ring.position.y=.04;ring.visible=false;g.add(m,ring);
 const t={pl:p,i,p:-1,g,m,ring};m.userData.t=t;hd.userData.t=t;g.visible=false;S.add(g);T[p].push(t);ALL.push(t)}}
const wv=t=>{const c=cellW(t.pl,t.i,t.p);return new THREE.Vector3(c[0],t.p<0?BY:.1,c[1])};
// dice
function face(n){const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#fff';x.beginPath();x.moveTo(26,4);x.arcTo(124,4,124,124,22);x.arcTo(124,124,4,124,22);x.arcTo(4,124,4,4,22);x.arcTo(4,4,124,4,22);x.closePath();x.fill();x.strokeStyle='#cfcfd8';x.lineWidth=4;x.stroke();
 const q={1:[[2,2]],2:[[1,1],[3,3]],3:[[1,1],[2,2],[3,3]],4:[[1,1],[3,1],[1,3],[3,3]],5:[[1,1],[3,1],[2,2],[1,3],[3,3]],6:[[1,1],[3,1],[1,2],[3,2],[1,3],[3,3]]}[n];
 x.fillStyle=n==1?'#e53935':'#1a1a2e';q.forEach(a=>{x.beginPath();x.arc(a[0]*32,a[1]*32,n==1?16:10,0,7);x.fill()});return new THREE.CanvasTexture(c)}
const FT=[1,2,3,4,5,6].map(face),dice=new THREE.Mesh(new THREE.PlaneGeometry(1.25,1.25),new THREE.MeshBasicMaterial({map:FT[0],transparent:true}));dice.rotation.x=-Math.PI/2;dice.position.set(-7,.3,-7);S.add(dice);const dsh=new THREE.Mesh(new THREE.PlaneGeometry(1.3,1.3),new THREE.MeshBasicMaterial({map:FT[1],color:0,transparent:true,opacity:.28}));dsh.rotation.x=-Math.PI/2;dsh.position.y=.2;S.add(dsh);
const E=Math.PI/2,TQ=[0,[0,0,0],[-E,0,0],[0,0,E],[0,0,-E],[E,0,0],[Math.PI,0,0]].map(e=>e?new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)):0);
const fl=new THREE.Mesh(new THREE.CircleGeometry(40,64),new THREE.ShadowMaterial({opacity:.4}));fl.rotation.x=-E;fl.position.y=-.21;fl.receiveShadow=true;S.add(fl);fl.visible=false;
const hc=document.createElement('canvas');hc.width=hc.height=256;{const x=hc.getContext('2d'),g=x.createRadialGradient(128,128,40,128,128,128);g.addColorStop(0,'rgba(255,255,255,.85)');g.addColorStop(.55,'rgba(255,255,255,.18)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,256,256)}
const halo=new THREE.Mesh(new THREE.PlaneGeometry(36,36),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(hc),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.35}));halo.rotation.x=-E;halo.position.y=-.22;S.add(halo);
const sp=new THREE.BufferGeometry(),spa=[];for(let i=0;i<350;i++)spa.push((Math.random()-.5)*50,Math.random()*18-2,(Math.random()-.5)*50);sp.setAttribute('position',new THREE.Float32BufferAttribute(spa,3));
const sparks=new THREE.Points(sp,new THREE.PointsMaterial({size:.12,color:0xaab8ff,transparent:true,opacity:.6,depthWrite:false}));S.add(sparks);sparks.visible=false;
// tween/particles/sound
const tw=[],tween=(d,f,e=k=>k)=>{if(ff){f(e(1));return Promise.resolve()}return new Promise(r=>tw.push({t:0,d,f,e,r}))},sleep=ms=>ff?Promise.resolve():new Promise(r=>setTimeout(r,ms)),ease=k=>k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
const parts=[],pg=new THREE.BoxGeometry(.14,.14,.14);let shake=0;
function burst(x,y,z,cols,n=28,sp=5){if(ff)return;for(let i=0;i<n;i++){const m=new THREE.Mesh(pg,new THREE.MeshBasicMaterial({color:cols[i%cols.length],transparent:true}));m.position.set(x,y,z);S.add(m);
 parts.push({m,v:new THREE.Vector3((Math.random()-.5)*sp,Math.random()*sp+2,(Math.random()-.5)*sp),l:1,r:new THREE.Vector3(Math.random(),Math.random(),Math.random())})}}
function wave(x,z,col){if(ff)return;const m=new THREE.Mesh(new THREE.RingGeometry(.3,.45,40),new THREE.MeshBasicMaterial({color:col,transparent:true,side:THREE.DoubleSide}));m.rotation.x=-E;m.position.set(x,.2,z);S.add(m);
 tween(.6,k=>{m.scale.setScalar(1+k*6);m.material.opacity=1-k}).then(()=>S.remove(m))}
// camera
const sph={az:0,pol:.07,r:62,taz:0,tpol:.07,tr:39};let aspect=1;
const stg=document.getElementById('stage');function resize(){const w=stg.clientWidth||innerWidth,h=stg.clientHeight||innerHeight;R.setSize(w,h,false);aspect=w/h;cam.aspect=aspect;cam.updateProjectionMatrix()}addEventListener('resize',resize);new ResizeObserver(resize).observe(stg);resize();
let dr=null;cv.addEventListener('pointerdown',e=>{dr={x:e.clientX,y:e.clientY,m:0}});
addEventListener('pointermove',e=>{if(!dr)return;const dx=e.clientX-dr.x,dy=e.clientY-dr.y;dr.m+=Math.abs(dx)+Math.abs(dy);dr.x=e.clientX;dr.y=e.clientY});
addEventListener('pointerup',e=>{if(dr&&dr.m<28)pick(e);dr=null});addEventListener('pointercancel',()=>{dr=null});
cv.addEventListener('wheel',e=>{});
// game state
let seats=[2,2,1,2],active=0,movable=[],pickRes=null,rollRes=null,rank=[],caps=[0,0,0,0],started=false;
// online turns: a player has TURN_MS (+EXTRA_MS) to act, then a bot plays for them until they're back
let botFor=[false,false,false,false],turnT=null;const TURN_MS=15000,EXTRA_MS=5000;
// avatars: a friendly animal per player (picked from their id, so everyone sees the same one), robots for CPUs
const AV=['🦊','🐼','🐯','🐸','🐵','🦁','🐨','🐰','🐧','🐙','🦄','🐻','🐶','🐱','🐮','🐷','🐲','🦉'];
function avatarFor(id){let h=7;for(const ch of String(id||''))h=(h*31+ch.charCodeAt(0))>>>0;return AV[h%AV.length]}
function avatarOf(c){return seats[c]==2?'🤖':avatarFor(net?owner[c]:(nick||'')+c)}
const $=id=>document.getElementById(id),rollBtn=$('roll');
function say(t){const m=$('msg');m.textContent=t;m.classList.remove('pop');void m.offsetWidth;m.classList.add('pop')}
const pct=c=>Math.round(T[c].reduce((a,t)=>a+(t.p<0?0:t.p),0)/(4*FIN)*100),cardTxt=c=>rank.includes(c)?['🥇','🥈','🥉'][rank.indexOf(c)]||'✔':pct(c)+'%';
// Top: one kill counter per colour. Each player's avatar, name and turn ring sit next to their own colour on the board.
function ui(){const box=$('cards'),ks=seats.map((s,c)=>s?c:'').join();
 if(box.dataset.sig!==ks){box.dataset.sig=ks;box.innerHTML=seats.map((s,c)=>s?`<div class="kc" data-c="${c}" style="--c:${CS[c]}"><i></i><span>⚔ ${caps[c]}</span></div>`:'').join('')}
 [...box.children].forEach(d=>{const c=+d.dataset.c,e=d.querySelector('span'),t='⚔ '+caps[c];if(e.textContent!==t){e.textContent=t;d.classList.remove('bump');void d.offsetWidth;d.classList.add('bump')}});
 const tg=$('tags'),sub=c=>rank.includes(c)?['🥇','🥈','🥉'][rank.indexOf(c)]||'✔':botFor[c]&&seats[c]==1?'🤖 bot playing':'',
  sig=seats.map((s,c)=>s?c+avatarOf(c)+PN(c)+sub(c):'').join('|');
 if(tg.dataset.sig!==sig){tg.dataset.sig=sig;tg.innerHTML=seats.map((s,c)=>s?`<div class="tg" data-c="${c}" style="--c:${CS[c]}"><i class="av">${avatarOf(c)}${botFor[c]&&seats[c]==1?'<u>🤖</u>':''}</i><b></b><small></small></div>`:'').join('');
  [...tg.children].forEach(d=>{const c=+d.dataset.c;d.querySelector('b').textContent=PN(c)+(net&&owner[c]===me||!net&&seats[c]==1&&seats.filter(x=>x==1).length==1?' (you)':'');d.querySelector('small').textContent=sub(c)});tagSize=null}
 [...tg.children].forEach(d=>d.classList.toggle('on',started&&+d.dataset.c==active&&!rank.includes(active)))}
// keeps each tag beside its home corner, wherever the camera is looking from
let tagSize=null;const _v=new THREE.Vector3();
function placeTags(){const tg=$('tags');if(!tg||!tg.children.length)return;const W=stg.clientWidth,H=stg.clientHeight,pr=(x,z)=>{_v.set(x,0,z).project(cam);return[(_v.x+1)/2*W,(1-_v.y)/2*H]},o=pr(0,0);
 if(!tagSize)tagSize=[...tg.children].map(d=>[d.offsetWidth,d.offsetHeight]);
 [...tg.children].forEach((d,k)=>{const c=+d.dataset.c,[w,h]=tagSize[k]||[90,60],sx=c==1||c==2?1:-1,sz=c>=2?1:-1,side=W>=H;
  if(NP==6){const a=yardDir(c),p=pr(Math.cos(a)*12,Math.sin(a)*12);const x=Math.max(w/2+6,Math.min(W-w/2-6,p[0])),y=Math.max(h/2+44,Math.min(H-h/2-6,p[1]));d.style.transform=`translate(${(x-w/2).toFixed(1)}px,${(y-h/2).toFixed(1)}px)`;return}
  // the two outer edges of this colour's home square (at its middle); use the one facing the free screen space
  const a=pr(8.2*sx,4.5*sz),b=pr(4.5*sx,8.2*sz),i=side?0:1,p=Math.abs(a[i]-o[i])>Math.abs(b[i]-o[i])?a:b;let x=p[0],y=p[1];
  if(side)x+=Math.sign(x-o[0])*(w/2+8);else y+=Math.sign(y-o[1])*(h/2+8);   // just outside the board: beside it on wide screens, above/below on phones
  x=Math.max(w/2+6,Math.min(W-w/2-6,x));y=Math.max(h/2+44,Math.min(H-h/2-6,y));d.style.transform=`translate(${(x-w/2).toFixed(1)}px,${(y-h/2).toFixed(1)}px)`})}
function drawSeats(){$('seats').innerHTML=seats.map((s,c)=>`<button class="seat ${s?'':'off'}" style="--c:${CS[c]}" onclick="seats[${c}]=(seats[${c}]+1)%3;sfx.tick();drawSeats()"><i></i><span>${CN[c]}</span><em>${['Off','You','CPU'][s]}</em></button>`).join('')}
drawSeats();
$('snd').textContent=snd?'🔊':'🔇';$('snd').onclick=()=>{snd=!snd;store.set('ludo3d.sfx',snd?'1':'0');$('snd').textContent=snd?'🔊':'🔇'};
function startGame(){setBoard(seats.length);caps=seats.map(()=>0);botFor=seats.map(()=>false);turnT=null;sfx.start();if(typeof updBotBar=='function')updBotBar();
 ALL.forEach(t=>{t.g.visible=seats[t.pl]>0;t.g.position.copy(wv(t));t.g.position.y=8;t.g.scale.setScalar(.01)});
 ALL.filter(t=>t.g.visible).forEach((t,k)=>sleep(k*60).then(()=>{beep(300+k*40,.08);tween(.5,k2=>{t.g.position.y=BY+8*(1-k2)*(1-k2);t.g.scale.setScalar(Math.max(.01,k2))},ease)}));
 faceTo(Math.max(0,net?seats.findIndex((x,i)=>x==1&&owner[i]===me):(seats.indexOf(1)>=0?seats.indexOf(1):seats.findIndex(x=>x))),true);started=true;sleep(1400).then(play)}
// players spread round the board as evenly as possible (2 players: opposite corners; 3 on six arms: every other arm)
function spreadPlan(occ,N){const k=occ.length;if(k<2||k>=N)return null;const tg=occ.map((_,j)=>(occ[0]+Math.round(j*N/k))%N);return tg.every((x,j)=>x===occ[j])?null:tg}
function paintSize(){const b=$('bsize');if(b)b.textContent=seats.length==6?'6-player board · tap for 4':'4-player board · tap for 6'}
$('bsize').onclick=()=>{seats=seats.length==4?[...seats,2,2]:seats.slice(0,4);if(!seats.includes(1))seats[0]=1;sfx.tick();drawSeats();paintSize()};paintSize();
$('start').onclick=()=>{if(seats.filter(x=>x).length<2){seats[0]=1;seats[2]=2;drawSeats();return}
 {const oc=seats.map((x,i)=>x?i:-1).filter(i=>i>=0),tg=spreadPlan(oc,seats.length);if(tg){const v=oc.map(i=>seats[i]);oc.forEach(i=>seats[i]=0);tg.forEach((t,j)=>seats[t]=v[j]);drawSeats()}}$('menu').style.display='none';startGame()};

const can=(t,v)=>t.p<0?v==6:t.p+v<=FIN;
async function settle(){const m={};ALL.forEach(t=>{if(!t.g.visible)return;const k=t.p<0||t.p==FIN?'u'+t.pl+t.i:t.p<=TMAX?'c'+abs(t.pl,t.p):'l'+t.pl+t.p;(m[k]=m[k]||[]).push(t)});
 const jobs=[];Object.values(m).forEach(a=>a.forEach((t,j)=>{const b=wv(t),n=a.length;if(n>1){const an=j/n*6.283;b.x+=Math.cos(an)*.25;b.z+=Math.sin(an)*.25}const s=n>1?.78:1,f=t.g.position.clone(),f0=t.g.scale.x;jobs.push(tween(.18,k=>{t.g.position.lerpVectors(f,b,k);t.g.scale.setScalar(f0+(s-f0)*k)},ease))}));await Promise.all(jobs)}
async function hop(t,to,h=.6,d=.16){const a=t.g.position.clone(),b=new THREE.Vector3(to[0],t.p<0?BY:.1,to[1]);
 await tween(d,k=>{t.g.position.set(a.x+(b.x-a.x)*k,a.y+(b.y-a.y)*k+Math.sin(k*Math.PI)*h,a.z+(b.z-a.z)*k);t.g.scale.set(1-Math.sin(k*Math.PI)*.1,1+Math.sin(k*Math.PI)*.2,1-Math.sin(k*Math.PI)*.1)});
 t.g.scale.setScalar(1);sfx.step(t.p);!ff&&navigator.vibrate&&navigator.vibrate(6)}
async function moveToken(t,v){let cap=0;
 if(t.p<0){t.p=0;await hop(t,cellW(t.pl,t.i,0),1.1,.28);sfx.out();wave(t.g.position.x,t.g.position.z,C[t.pl])}
 else for(let s=0;s<v;s++){t.p++;await hop(t,cellW(t.pl,t.i,t.p))}
 if(t.p<=TMAX&&!SAFES.has(abs(t.pl,t.p))){const a=abs(t.pl,t.p);
  for(const o of ALL){if(o.pl!=t.pl&&o.g.visible&&o.p>=0&&o.p<=TMAX&&abs(o.pl,o.p)==a){cap++;caps[t.pl]++;const q=o.g.position;burst(q.x,.5,q.z,[C[o.pl],0xffffff],34,7);wave(q.x,q.z,C[o.pl]);if(!ff)shake=.5;sfx.faah();
   o.p=-1;ui();const f=q.clone(),b=wv(o);await tween(.4,k=>{o.g.position.lerpVectors(f,b,k);o.g.position.y=.3+Math.sin(k*Math.PI)*3.5;o.g.rotation.y=k*12},ease);o.g.rotation.y=0}}}
 if(t.p==FIN){const q=t.g.position;burst(q.x,.5,q.z,[C[t.pl],0xffffff,0xffd740],40,6);sfx.home()}
 await settle();return{cap,fin:t.p==FIN}}
let gameNo=0,ended=false,againPend=false;
function showEnd(){ended=true;forgetSession();const w=rank[0];$('etitle').textContent=(w!=null?PN(w):'')+' wins!';
 $('ranks').innerHTML=rank.map((i,k)=>`<div class="rk ${k==0?'w':''}" style="--c:${CS[i]};animation-delay:${k*.12}s"><span>${['🥇','🥈','🥉','4️⃣'][k]}</span><i></i><span class="n">${PN(i)}${seats[i]==2?' (CPU)':''}</span><small>${k<seats.filter(x=>x).length&&T[i].every(t=>t.p==FIN)?'Finished':pct(i)+'%'}</small></div>`).join('');
 $('enote').textContent=net?'Rematch starts for everyone in the room':'';$('end').style.display='flex';
 if(!ff)for(let i=0;i<7;i++)setTimeout(()=>burst((Math.random()-.5)*10,6,(Math.random()-.5)*10,[0xff5252,0xffd740,0x69f0ae,0x40c4ff,0xffffff],40,6),i*260);
 if(againPend){againPend=false;setTimeout(restartGame,600)}}
function restartGame(){if(!ended)return;ended=false;$('end').style.display='none';rank=[];dn=0;Object.keys(inbox).forEach(k=>delete inbox[k]);Object.keys(waiters).forEach(k=>delete waiters[k]);lastDec=[];movable=[];gameNo++;
 T.forEach(a=>a.forEach(t=>{t.p=-1;t.ring.visible=false;t.g.rotation.y=0}));startGame()}
function PN(c){if(seats[c]==2)return CN[c];if(net)return names[c]||CN[c];const h=seats.map((x,i)=>x==1?i:-1).filter(i=>i>=0);return (nick||CN[c])+(h.length>1?' '+(h.indexOf(c)+1):'')}
async function rollDice(v){sfx.roll();const T=Math.PI*2,r0=((dice.rotation.z%T)+T+Math.PI)%T-Math.PI,N=6;let last=-1,prev=-1;
 await tween(.75,k=>{const e=1-Math.pow(1-k,3),th=e*N*Math.PI,h=Math.abs(Math.sin(k*Math.PI*2))*Math.pow(1-k,1.2);
  dice.position.y=.3+h*1.5;dice.scale.setScalar(1+h*.25);dice.scale.y*=Math.max(.1,Math.abs(Math.cos(th)));
  dice.rotation.z=(r0+T)*(1-e);
  const n=Math.floor(th/Math.PI+.5);if(n!=last){last=n;let f=n>=N?v-1:Math.random()*6|0;while(f==prev&&n<N)f=Math.random()*6|0;prev=f;dice.material.map=FT[f]}});
 dice.material.map=FT[v-1];dice.rotation.z=0;dice.scale.setScalar(1);dice.position.y=.3;if(v==6){burst(dice.position.x,1,dice.position.z,[0xffd740,0xffffff],20,4);sfx.six()}}
function score(t,v){const n=t.p<0?0:t.p+v;if(n==FIN)return 100;let sc=n/10;
 if(n<=TMAX&&!SAFES.has(abs(t.pl,n))&&ALL.some(o=>o.pl!=t.pl&&o.g.visible&&o.p>=0&&o.p<=TMAX&&abs(o.pl,o.p)==abs(t.pl,n)))sc+=80;
 if(t.p<0)sc+=60;else if(n>TMAX)sc+=40;else if(SAFES.has(abs(t.pl,n)))sc+=30;return sc}
const pickToken=mv=>{movable=mv;mv.forEach(t=>t.ring.visible=true);say('Choose a token');return new Promise(r=>pickRes=r)};
function pick(e){const rc=new THREE.Raycaster(),bb=cv.getBoundingClientRect(),px=e.clientX-bb.left,py=e.clientY-bb.top;rc.setFromCamera(new THREE.Vector2(px/bb.width*2-1,-(py/bb.height)*2+1),cam);
 const dist=w=>{const v=w.clone().project(cam);return Math.hypot((v.x+1)/2*bb.width-px,(1-v.y)/2*bb.height-py)};
 if(pickRes){let t=null;const h=rc.intersectObjects(movable.map(t=>t.m),true)[0];if(h)t=h.object.userData.t;else{let bd=52;movable.forEach(x=>{const d=dist(x.m.getWorldPosition(new THREE.Vector3()));if(d<bd){bd=d;t=x}})}
  if(t){movable.forEach(x=>x.ring.visible=false);movable=[];const r=pickRes;pickRes=null;r(t)}}
 else if(rollRes&&(rc.intersectObject(dice)[0]||dist(dice.position)<64)){const r=rollRes;rollRes=null;r()}}
rollBtn.onclick=()=>{if(rollRes){const r=rollRes;rollRes=null;r()}};
function faceTo(p,snap){const b=NP==6?Math.PI/2-yardDir(p):(3-p)*Math.PI/2;sph.taz=b+Math.round((sph.taz-b)/(2*Math.PI))*2*Math.PI;if(snap)sph.az=sph.taz}
const moveDice=c=>{const x=NP==6?Math.cos(yardDir(c))*4.6:YB[c][0]+(c==1||c==2?5:0)-7,z=NP==6?Math.sin(yardDir(c))*4.6:YB[c][1]+(c>=2?5:0)-7,a=dice.position.clone(),rz=dice.rotation.z;return tween(.34,k=>{dice.position.set(a.x+(x-a.x)*k,.3+Math.sin(k*Math.PI)*.8,a.z+(z-a.z)*k);dice.rotation.z=rz+k*Math.PI*2},ease)};
async function play(){let c=seats.findIndex(s=>s),six=0,pc=-1;const n=seats.filter(s=>s).length;
 while(true){const same=c===pc;pc=c;if(!net&&seats[c]==1)faceTo(c);active=c;ui();glow.color.set(C[c]);halo.material.color.set(C[c]);const cpu=seats[c]==2,prod=cpu?(!net||host):(!net||owner[c]===me);say(same?`${PN(c)} rolls again`:'');if(!same)await moveDice(c);
  const nr=dn++;if(ff&&!inbox[nr])ff=false;let v;if(inbox[nr]&&inbox[nr].k=='r')v=inbox[nr].v|0;
  else if(net&&!cpu)v=(await human(nr,c,async()=>{rollBtn.disabled=false;sfx.chime();say('Tap the dice 🎲');await new Promise(r=>rollRes=r);rollBtn.disabled=true;return{k:'r',v:1+Math.random()*6|0}},()=>({k:'r',v:1+Math.random()*6|0}))).v;
  else if(prod){if(cpu)await sleep(450);else{rollBtn.disabled=false;sfx.chime();say(`${PN(c)} — tap the dice`);await new Promise(r=>rollRes=r);rollBtn.disabled=true}if(inbox[nr]&&inbox[nr].k=='r')v=inbox[nr].v|0;else{v=1+Math.random()*6|0;dec(nr,{k:'r',v})}}else v=(await take(nr,c,()=>({k:'r',v:1+Math.random()*6|0}))).v;
  await rollDice(v);say(`${PN(c)} rolled ${v}`);let extra=v==6;six=v==6?six+1:0;
  if(six==3){say('Three sixes — turn lost!');six=0;extra=false;await sleep(750)}
  else{const mv=T[c].filter(t=>can(t,v));
   if(!mv.length){say(`${PN(c)} has no moves`);extra=false;await sleep(650)}
   else{let t;if(mv.length==1){t=mv[0];await sleep(160)}else{const np=dn++,best=()=>mv.reduce((a,b)=>score(b,v)>score(a,v)?b:a);if(ff&&!inbox[np])ff=false;if(inbox[np]&&inbox[np].k=='p'){t=T[c][inbox[np].i];if(!mv.includes(t))t=best()}
     else if(net&&!cpu){const m=await human(np,c,async()=>{const x=await pickToken(mv);return{k:'p',i:x.i}},()=>({k:'p',i:best().i}));t=T[c][m.i];if(!mv.includes(t))t=best()}
     else if(prod){if(cpu){await sleep(320);t=best()}else t=await pickToken(mv);dec(np,{k:'p',i:t.i})}else{say(`${PN(c)} is choosing…`);const m=await take(np,c,()=>({k:'p',i:best().i}));t=T[c][m.i];if(!mv.includes(t))t=best()}}
    const r=await moveToken(t,v);if(r.cap){extra=true;say('Captured! Bonus roll')}if(r.fin)extra=true;
    if(T[c].every(x=>x.p==FIN)){rank.push(c);extra=false;ui();sfx.win();say(`${PN(c)} finished #${rank.length}!`);if(!ff)for(let i=0;i<5;i++)setTimeout(()=>burst((Math.random()-.5)*8,6,(Math.random()-.5)*8,[0xff5252,0xffd740,0x69f0ae,0x40c4ff,0xffffff],40,6),i*220);await sleep(1400);
     if(rank.length>=n-1){seats.forEach((s,i)=>{if(s&&!rank.includes(i))rank.push(i)});ui();showEnd();return}}}}
  six=extra?six:0;if(!extra||rank.includes(c)){six=0;do{c=(c+1)%seats.length}while(!seats[c]||rank.includes(c))}}}
// ---------- online human decisions: timer, then a bot covers the seat ----------
// Resolves with the decision for step n of seat c. Only ONE client ever produces it:
// the seat's owner while they're playing, otherwise the host (see take() in online.js).
function raceWait(p,ms,n){return new Promise(res=>{let done=false;const fin=v=>{if(done)return;done=true;clearInterval(iv);clearTimeout(to);res(v)};
 const iv=setInterval(()=>{if(inbox[n])fin(null)},150),to=setTimeout(()=>fin(null),ms);Promise.resolve(p).then(fin)})}
function cancelAsk(){rollRes=null;rollBtn.disabled=true;if(pickRes){movable.forEach(x=>x.ring.visible=false);movable=[];pickRes=null}}
async function human(n,c,ask,fb){
 const mine=owner[c]===me;
 if(!mine){if(!ff&&!botFor[c])turnT={c,t0:Date.now()};try{return await take(n,c,fb)}finally{if(turnT&&turnT.c===c)turnT=null}}
 for(;;){
  if(inbox[n])return inbox[n];
  if(!botFor[c]){
   if(!ff)turnT={c,t0:Date.now()};
   const hurry=0;
   const r=await raceWait(ask(),TURN_MS+EXTRA_MS,n);clearTimeout(hurry);turnT=null;
   if(inbox[n])return inbox[n];
   if(r){dec(n,r);return inbox[n]}
   cancelAsk();say('');                     // time's up
   if(!host)return take(n,c,fb);            // the host's bot plays this move
   setBot(c,true);                          // I'm the host: my own bot covers me
  }
  if(host){await sleep(600);if(!inbox[n])dec(n,fb());return inbox[n]}
  await Promise.race([take(n,c,fb),waitBack()]);   // the host's bot plays, unless I come back first
 }
}
// loop
const clk=new THREE.Clock();let tm=0;
(function loop(){requestAnimationFrame(loop);const dt=Math.min(clk.getDelta(),.05);tm+=dt;
 for(let i=tw.length-1;i>=0;i--){const q=tw[i];q.t+=dt;const k=Math.min(1,q.t/q.d);q.f(q.e(k));if(k>=1){tw.splice(i,1);q.r()}}
 for(let i=parts.length-1;i>=0;i--){const p=parts[i];p.v.y-=12*dt;p.m.position.addScaledVector(p.v,dt);p.m.rotation.x+=p.r.x*8*dt;p.m.rotation.y+=p.r.y*8*dt;p.l-=dt*.8;p.m.scale.setScalar(Math.max(p.l,.01));p.m.material.opacity=Math.min(1,p.l*2);
  if(p.l<=0||p.m.position.y<-2){S.remove(p.m);p.m.material.dispose();parts.splice(i,1)}}
 (NP==6?YD6:YD).forEach((m,p)=>{const k=(started&&p==active)?1.1+Math.sin(tm*3)*.07:1;m.material.color.set(C[p]).multiplyScalar(k)});sparks.rotation.y+=dt*.02;sparks.position.y=Math.sin(tm*.5)*.4;
 if(rollRes)dice.scale.setScalar(1+Math.abs(Math.sin(tm*5))*.16);
 placeTags();
 {const av=document.querySelector('#tags .tg.on .av');document.querySelectorAll('#tags .av.timed').forEach(e=>{if(e!==av||!turnT)e.classList.remove('timed','hurry')});
  if(av&&turnT&&turnT.c===active){const el=Date.now()-turnT.t0,hurry=el>TURN_MS;av.classList.add('timed');av.classList.toggle('hurry',hurry);av.style.setProperty('--t',Math.min(1,hurry?(el-TURN_MS)/EXTRA_MS:el/TURN_MS).toFixed(3))}}
 movable.forEach(t=>{t.g.position.y=(t.p<0?BY:.1)+Math.abs(Math.sin(tm*5))*.3;t.m.material.emissiveIntensity=.3+Math.sin(tm*6)*.25;t.ring.scale.setScalar(1+Math.sin(tm*6)*.12)});
 
 sph.az+=(sph.taz-sph.az)*.16;sph.pol+=(sph.tpol-sph.pol)*.16;sph.r+=(sph.tr-sph.r)*.16;{const sa=Math.sin(sph.az),ca=Math.cos(sph.az);ALL.forEach(t=>{t.m.rotation.set(-1.36,sph.az,0,'YXZ');t.m.position.set(sa*.4,.3,ca*.4)})}shake*=.9;
 const r=sph.r*Math.max(1,.88/aspect),sx=(Math.random()-.5)*shake,sz=(Math.random()-.5)*shake;
 cam.position.set(r*Math.sin(sph.pol)*Math.sin(sph.az)+sx,r*Math.cos(sph.pol),r*Math.sin(sph.pol)*Math.cos(sph.az)+sz);cam.lookAt(0,0,0);
 dsh.position.set(dice.position.x+.08+(dice.position.y-.3)*.3,.2,dice.position.z+.1+(dice.position.y-.3)*.3);dsh.rotation.z=dice.rotation.z;dsh.scale.copy(dice.scale);R.render(S,cam)})();
