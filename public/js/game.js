// Ludo 3D: board, pawns, dice, camera, game rules and the main game loop.
const C=[0xfbc916,0x22c55e,0xef4444,0x3b82f6],CN=['Yellow','Green','Red','Blue'],CS=['#fbc916','#22c55e','#ef4444','#3b82f6'];
const path=[],seg=(c,r,dc,dr,n)=>{for(let i=0;i<n;i++)path.push([c+dc*i,r+dr*i])};
seg(1,6,1,0,5);seg(6,5,0,-1,6);seg(7,0,1,0,2);seg(8,1,0,1,5);seg(9,6,1,0,6);seg(14,7,0,1,2);seg(13,8,-1,0,5);seg(8,9,0,1,6);seg(7,14,-1,0,2);seg(6,13,0,-1,5);seg(5,8,-1,0,6);seg(0,7,0,-1,2);
const LN=[[1,7,1,0],[7,1,0,1],[13,7,-1,0],[7,13,0,-1]],START=[0,13,26,39],SAFE=new Set([0,8,13,21,26,34,39,47]);
const YD=[];const YB=[[0,0],[9,0],[9,9],[0,9]],SL=[[1.5,1.5],[3.5,1.5],[1.5,3.5],[3.5,3.5]],DIR=[[-1,0],[0,-1],[1,0],[0,1]],BY=.14;
const abs=(pl,p)=>(START[pl]+p)%52;
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
const box=(w,h,d,col,x,y,z,sh=true)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial({color:col}));m.position.set(x,y,z);m.receiveShadow=true;m.castShadow=sh;m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),LM));S.add(m);return m};
box(16.4,.2,16.4,0x2a1f4d,0,-.1,0);box(15.1,.02,15.1,0xe4e1ec,0,.01,0,false);
for(let p=0;p<4;p++){const[bx,by]=YB[p];YD[p]=box(6,.1,6,C[p],bx+2.5-7,.05,by+2.5-7,false);box(4,.02,4,new THREE.Color(C[p]).multiplyScalar(.42).getHex(),bx+2.5-7,.11,by+2.5-7,false);
 for(let i=0;i<4;i++){const m=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.02,28),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.45}));m.position.set(SL[i][0]+bx-7,.13,SL[i][1]+by-7);m.receiveShadow=true;S.add(m);{const rg=new THREE.Mesh(new THREE.RingGeometry(.5,.6,40),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.55,side:THREE.DoubleSide}));rg.rotation.x=-Math.PI/2;rg.position.set(m.position.x,.145,m.position.z);S.add(rg)}}}
const stS=new THREE.Shape();for(let k=0;k<10;k++){const a=k*Math.PI/5+Math.PI/2,rr=k%2?.15:.34;k?stS.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):stS.moveTo(Math.cos(a)*rr,Math.sin(a)*rr)}stS.closePath();const star=new THREE.ShapeGeometry(stS),starM=new THREE.MeshBasicMaterial({color:0xffffff});
path.forEach((c,i)=>{let col=SAFE.has(i)?0xd5d0e3:0xffffff;START.forEach((s,p)=>{if(s==i)col=C[p]});box(.94,.1,.94,col,c[0]-7,.05,c[1]-7,false);
 if(SAFE.has(i)){const s=new THREE.Mesh(star,starM);s.rotation.x=-Math.PI/2;s.position.set(c[0]-7,.108,c[1]-7);S.add(s)}});
LN.forEach((L,p)=>{for(let k=0;k<5;k++)box(.94,.1,.94,C[p],L[0]+L[2]*k-7,.05,L[1]+L[3]*k-7,false)});
[[[-1.5,-1.5],[-1.5,1.5]],[[-1.5,-1.5],[1.5,-1.5]],[[1.5,-1.5],[1.5,1.5]],[[-1.5,1.5],[1.5,1.5]]].forEach((v,p)=>{
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([v[0][0],.11,v[0][1],v[1][0],.11,v[1][1],0,.11,0],3));g.setAttribute('normal',new THREE.Float32BufferAttribute([0,1,0,0,1,0,0,1,0],3));
 S.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:C[p],side:THREE.DoubleSide})));S.add(new THREE.LineLoop(g,new THREE.LineBasicMaterial({color:0})))});
// tokens
const pawnG=(()=>{const V=THREE.Vector2,sp=new THREE.SplineCurve([[.34,.17],[.27,.27],[.2,.42],[.15,.58],[.13,.7]].map(a=>new V(...a))).getPoints(22),
 pts=[[0,0],[.4,0],[.46,.03],[.47,.09],[.43,.15]].map(a=>new V(...a)).concat(sp,[[.2,.72],[.31,.76],[.33,.83],[.27,.89],[.17,.9],[0,.9]].map(a=>new V(...a)));return new THREE.LatheGeometry(pts,56)})(),headG=new THREE.SphereGeometry(.31,40,28),ringG=new THREE.TorusGeometry(.5,.06,8,28);
const sc=new THREE.Mesh(new THREE.PlaneGeometry(15.6,15.6),new THREE.ShadowMaterial({opacity:.32}));sc.rotation.x=-Math.PI/2;sc.position.y=.145;sc.receiveShadow=true;S.add(sc);
const T=[],ALL=[];
for(let p=0;p<4;p++){T[p]=[];for(let i=0;i<4;i++){const g=new THREE.Group(),m=new THREE.Mesh(pawnG,new THREE.MeshPhysicalMaterial({color:C[p],roughness:.22,metalness:.1,clearcoat:1,clearcoatRoughness:.08,envMapIntensity:.5,emissive:C[p],emissiveIntensity:0}));m.castShadow=true;m.scale.setScalar(.6);const hd=new THREE.Mesh(headG,m.material);hd.position.y=1.06;hd.castShadow=true;m.add(hd);{const om=new THREE.MeshBasicMaterial({color:0x14142b,side:THREE.BackSide}),o1=new THREE.Mesh(pawnG,om),o2=new THREE.Mesh(headG,om);o1.scale.setScalar(1.1);o2.scale.setScalar(1.1);o1.raycast=o2.raycast=()=>{};m.add(o1);hd.add(o2)}
 const ring=new THREE.Mesh(ringG,new THREE.MeshBasicMaterial({color:0xffffff}));ring.rotation.x=Math.PI/2;ring.position.y=.04;ring.visible=false;g.add(m,ring);
 const t={pl:p,i,p:-1,g,m,ring};m.userData.t=t;hd.userData.t=t;g.visible=false;S.add(g);T[p].push(t);ALL.push(t)}}
const wv=t=>{const c=cellRC(t.pl,t.i,t.p);return new THREE.Vector3(c[0]-7,t.p<0?BY:.1,c[1]-7)};
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
const $=id=>document.getElementById(id),rollBtn=$('roll');
function say(t){const m=$('msg');m.textContent=t;m.classList.remove('pop');void m.offsetWidth;m.classList.add('pop')}
const pct=c=>Math.round(T[c].reduce((a,t)=>a+(t.p<0?0:t.p),0)/224*100),cardTxt=c=>rank.includes(c)?['🥇','🥈','🥉'][rank.indexOf(c)]||'✔':pct(c)+'%';
function ui(){const box=$('cards'),vp=((3-Math.round(sph.taz/(Math.PI/2)))%4+4)%4,ord=[(vp+1)%4,(vp+2)%4,vp,(vp+3)%4],sig=ord.map(c=>c+':'+seats[c]).join();   // cards sit where each colour is on screen: me bottom-left, then clockwise
 const cell=c=>seats[c]?`<div class="card glass ${c==active?'on':''}" style="--c:${CS[c]};--p:${pct(c)}%"><i></i><b>${PN(c)}</b><small>${seats[c]==2?'CPU':net?(owner[c]===me?'You':''):'You'}</small><span>${cardTxt(c)}</span><em class="cp${caps[c]?'':' z'}">⚔${caps[c]}</em></div>`:'<div class="card ph"></div>';
 if(box.dataset.sig===sig&&box.children.length==4){ord.forEach((c,k)=>{if(!seats[c])return;const d=box.children[k];d.classList.toggle('on',c==active);d.querySelector('b').textContent=PN(c);d.querySelector('span').textContent=cardTxt(c);d.style.setProperty('--p',pct(c)+'%');
  const e=d.querySelector('.cp'),t='⚔'+caps[c];if(e.textContent!==t){e.textContent=t;e.classList.toggle('z',!caps[c]);e.classList.remove('bump');void e.offsetWidth;e.classList.add('bump')}})}
 else{box.dataset.sig=sig;box.innerHTML=ord.map(cell).join('')}}
function drawSeats(){$('seats').innerHTML=seats.map((s,c)=>`<button class="seat ${s?'':'off'}" style="--c:${CS[c]}" onclick="seats[${c}]=(seats[${c}]+1)%3;sfx.tick();drawSeats()"><i></i><span>${CN[c]}</span><em>${['Off','You','CPU'][s]}</em></button>`).join('')}
drawSeats();
$('snd').textContent=snd?'🔊':'🔇';$('snd').onclick=()=>{snd=!snd;store.set('ludo3d.sfx',snd?'1':'0');$('snd').textContent=snd?'🔊':'🔇'};
function startGame(){caps=[0,0,0,0];sfx.start();
 ALL.forEach(t=>{t.g.visible=seats[t.pl]>0;t.g.position.copy(wv(t));t.g.position.y=8;t.g.scale.setScalar(.01)});
 ALL.filter(t=>t.g.visible).forEach((t,k)=>sleep(k*60).then(()=>{beep(300+k*40,.08);tween(.5,k2=>{t.g.position.y=BY+8*(1-k2)*(1-k2);t.g.scale.setScalar(Math.max(.01,k2))},ease)}));
 faceTo(Math.max(0,net?seats.findIndex((x,i)=>x==1&&owner[i]===me):(seats.indexOf(1)>=0?seats.indexOf(1):seats.findIndex(x=>x))),true);started=true;sleep(1400).then(play)}
$('start').onclick=()=>{if(seats.filter(x=>x).length<2){seats[0]=1;seats[2]=2;drawSeats();return}$('menu').style.display='none';startGame()};

const can=(t,v)=>t.p<0?v==6:t.p+v<=56;
async function settle(){const m={};ALL.forEach(t=>{if(!t.g.visible)return;const k=t.p<0||t.p==56?'u'+t.pl+t.i:t.p<=50?'c'+abs(t.pl,t.p):'l'+t.pl+t.p;(m[k]=m[k]||[]).push(t)});
 const jobs=[];Object.values(m).forEach(a=>a.forEach((t,j)=>{const b=wv(t),n=a.length;if(n>1){const an=j/n*6.283;b.x+=Math.cos(an)*.25;b.z+=Math.sin(an)*.25}const s=n>1?.78:1,f=t.g.position.clone(),f0=t.g.scale.x;jobs.push(tween(.18,k=>{t.g.position.lerpVectors(f,b,k);t.g.scale.setScalar(f0+(s-f0)*k)},ease))}));await Promise.all(jobs)}
async function hop(t,to,h=.6,d=.16){const a=t.g.position.clone(),b=new THREE.Vector3(to[0]-7,t.p<0?BY:.1,to[1]-7);
 await tween(d,k=>{t.g.position.set(a.x+(b.x-a.x)*k,a.y+(b.y-a.y)*k+Math.sin(k*Math.PI)*h,a.z+(b.z-a.z)*k);t.g.scale.set(1-Math.sin(k*Math.PI)*.1,1+Math.sin(k*Math.PI)*.2,1-Math.sin(k*Math.PI)*.1)});
 t.g.scale.setScalar(1);sfx.step(t.p);!ff&&navigator.vibrate&&navigator.vibrate(6)}
async function moveToken(t,v){let cap=0;
 if(t.p<0){t.p=0;await hop(t,cellRC(t.pl,t.i,0),1.1,.28);sfx.out();wave(t.g.position.x,t.g.position.z,C[t.pl])}
 else for(let s=0;s<v;s++){t.p++;await hop(t,cellRC(t.pl,t.i,t.p))}
 if(t.p<=50&&!SAFE.has(abs(t.pl,t.p))){const a=abs(t.pl,t.p);
  for(const o of ALL){if(o.pl!=t.pl&&o.g.visible&&o.p>=0&&o.p<=50&&abs(o.pl,o.p)==a){cap++;caps[t.pl]++;const q=o.g.position;burst(q.x,.5,q.z,[C[o.pl],0xffffff],34,7);wave(q.x,q.z,C[o.pl]);if(!ff)shake=.5;sfx.faah();
   o.p=-1;ui();const f=q.clone(),b=wv(o);await tween(.4,k=>{o.g.position.lerpVectors(f,b,k);o.g.position.y=.3+Math.sin(k*Math.PI)*3.5;o.g.rotation.y=k*12},ease);o.g.rotation.y=0}}}
 if(t.p==56){const q=t.g.position;burst(q.x,.5,q.z,[C[t.pl],0xffffff,0xffd740],40,6);sfx.home()}
 await settle();return{cap,fin:t.p==56}}
let gameNo=0,ended=false,againPend=false;
function showEnd(){ended=true;forgetSession();const w=rank[0];$('etitle').textContent=(w!=null?PN(w):'')+' wins!';
 $('ranks').innerHTML=rank.map((i,k)=>`<div class="rk ${k==0?'w':''}" style="--c:${CS[i]};animation-delay:${k*.12}s"><span>${['🥇','🥈','🥉','4️⃣'][k]}</span><i></i><span class="n">${PN(i)}${seats[i]==2?' (CPU)':''}</span><small>${k<seats.filter(x=>x).length&&T[i].every(t=>t.p==56)?'Finished':pct(i)+'%'}</small></div>`).join('');
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
function score(t,v){const n=t.p<0?0:t.p+v;if(n==56)return 100;let sc=n/10;
 if(n<=50&&!SAFE.has(abs(t.pl,n))&&ALL.some(o=>o.pl!=t.pl&&o.g.visible&&o.p>=0&&o.p<=50&&abs(o.pl,o.p)==abs(t.pl,n)))sc+=80;
 if(t.p<0)sc+=60;else if(n>50)sc+=40;else if(SAFE.has(abs(t.pl,n)))sc+=30;return sc}
const pickToken=mv=>{movable=mv;mv.forEach(t=>t.ring.visible=true);say('Choose a token');return new Promise(r=>pickRes=r)};
function pick(e){const rc=new THREE.Raycaster(),bb=cv.getBoundingClientRect(),px=e.clientX-bb.left,py=e.clientY-bb.top;rc.setFromCamera(new THREE.Vector2(px/bb.width*2-1,-(py/bb.height)*2+1),cam);
 const dist=w=>{const v=w.clone().project(cam);return Math.hypot((v.x+1)/2*bb.width-px,(1-v.y)/2*bb.height-py)};
 if(pickRes){let t=null;const h=rc.intersectObjects(movable.map(t=>t.m),true)[0];if(h)t=h.object.userData.t;else{let bd=52;movable.forEach(x=>{const d=dist(x.m.getWorldPosition(new THREE.Vector3()));if(d<bd){bd=d;t=x}})}
  if(t){movable.forEach(x=>x.ring.visible=false);movable=[];const r=pickRes;pickRes=null;r(t)}}
 else if(rollRes&&(rc.intersectObject(dice)[0]||dist(dice.position)<64)){const r=rollRes;rollRes=null;r()}}
rollBtn.onclick=()=>{if(rollRes){const r=rollRes;rollRes=null;r()}};
function faceTo(p,snap){const b=(3-p)*Math.PI/2;sph.taz=b+Math.round((sph.taz-b)/(2*Math.PI))*2*Math.PI;if(snap)sph.az=sph.taz}
const moveDice=c=>{const x=YB[c][0]+(c==1||c==2?5:0)-7,z=YB[c][1]+(c>=2?5:0)-7,a=dice.position.clone(),rz=dice.rotation.z;return tween(.34,k=>{dice.position.set(a.x+(x-a.x)*k,.3+Math.sin(k*Math.PI)*.8,a.z+(z-a.z)*k);dice.rotation.z=rz+k*Math.PI*2},ease)};
async function play(){let c=seats.findIndex(s=>s),six=0,pc=-1;const n=seats.filter(s=>s).length;
 while(true){const same=c===pc;pc=c;if(!net&&seats[c]==1)faceTo(c);active=c;ui();glow.color.set(C[c]);halo.material.color.set(C[c]);const cpu=seats[c]==2,prod=cpu?(!net||host):(!net||owner[c]===me);say(same?`${PN(c)} rolls again`:`${PN(c)}'s turn`);if(!same)await moveDice(c);
  const nr=dn++;if(ff&&!inbox[nr])ff=false;let v;if(inbox[nr]&&inbox[nr].k=='r')v=inbox[nr].v|0;else if(prod){if(cpu)await sleep(450);else{rollBtn.disabled=false;sfx.chime();say(`${PN(c)} — tap the dice`);await new Promise(r=>rollRes=r);rollBtn.disabled=true}if(inbox[nr]&&inbox[nr].k=='r')v=inbox[nr].v|0;else{v=1+Math.random()*6|0;dec(nr,{k:'r',v})}}else v=(await take(nr,c,()=>({k:'r',v:1+Math.random()*6|0}))).v;
  await rollDice(v);say(`${PN(c)} rolled ${v}`);let extra=v==6;six=v==6?six+1:0;
  if(six==3){say('Three sixes — turn lost!');six=0;extra=false;await sleep(750)}
  else{const mv=T[c].filter(t=>can(t,v));
   if(!mv.length){say(`${PN(c)} has no moves`);extra=false;await sleep(650)}
   else{let t;if(mv.length==1){t=mv[0];await sleep(160)}else{const np=dn++,best=()=>mv.reduce((a,b)=>score(b,v)>score(a,v)?b:a);if(ff&&!inbox[np])ff=false;if(inbox[np]&&inbox[np].k=='p'){t=T[c][inbox[np].i];if(!mv.includes(t))t=best()}else if(prod){if(cpu){await sleep(320);t=best()}else t=await pickToken(mv);dec(np,{k:'p',i:t.i})}else{say(`${PN(c)} is choosing…`);const m=await take(np,c,()=>({k:'p',i:best().i}));t=T[c][m.i];if(!mv.includes(t))t=best()}}
    const r=await moveToken(t,v);if(r.cap){extra=true;say('Captured! Bonus roll')}if(r.fin)extra=true;
    if(T[c].every(x=>x.p==56)){rank.push(c);extra=false;ui();sfx.win();say(`${PN(c)} finished #${rank.length}!`);if(!ff)for(let i=0;i<5;i++)setTimeout(()=>burst((Math.random()-.5)*8,6,(Math.random()-.5)*8,[0xff5252,0xffd740,0x69f0ae,0x40c4ff,0xffffff],40,6),i*220);await sleep(1400);
     if(rank.length>=n-1){seats.forEach((s,i)=>{if(s&&!rank.includes(i))rank.push(i)});ui();showEnd();return}}}}
  six=extra?six:0;if(!extra||rank.includes(c)){six=0;do{c=(c+1)%4}while(!seats[c]||rank.includes(c))}}}
// loop
const clk=new THREE.Clock();let tm=0;
(function loop(){requestAnimationFrame(loop);const dt=Math.min(clk.getDelta(),.05);tm+=dt;
 for(let i=tw.length-1;i>=0;i--){const q=tw[i];q.t+=dt;const k=Math.min(1,q.t/q.d);q.f(q.e(k));if(k>=1){tw.splice(i,1);q.r()}}
 for(let i=parts.length-1;i>=0;i--){const p=parts[i];p.v.y-=12*dt;p.m.position.addScaledVector(p.v,dt);p.m.rotation.x+=p.r.x*8*dt;p.m.rotation.y+=p.r.y*8*dt;p.l-=dt*.8;p.m.scale.setScalar(Math.max(p.l,.01));p.m.material.opacity=Math.min(1,p.l*2);
  if(p.l<=0||p.m.position.y<-2){S.remove(p.m);p.m.material.dispose();parts.splice(i,1)}}
 YD.forEach((m,p)=>{const k=(started&&p==active)?1.1+Math.sin(tm*3)*.07:1;m.material.color.set(C[p]).multiplyScalar(k)});sparks.rotation.y+=dt*.02;sparks.position.y=Math.sin(tm*.5)*.4;
 if(rollRes)dice.scale.setScalar(1+Math.abs(Math.sin(tm*5))*.16);
 movable.forEach(t=>{t.g.position.y=(t.p<0?BY:.1)+Math.abs(Math.sin(tm*5))*.3;t.m.material.emissiveIntensity=.3+Math.sin(tm*6)*.25;t.ring.scale.setScalar(1+Math.sin(tm*6)*.12)});
 
 sph.az+=(sph.taz-sph.az)*.16;sph.pol+=(sph.tpol-sph.pol)*.16;sph.r+=(sph.tr-sph.r)*.16;{const sa=Math.sin(sph.az),ca=Math.cos(sph.az);ALL.forEach(t=>{t.m.rotation.set(-1.36,sph.az,0,'YXZ');t.m.position.set(sa*.4,.3,ca*.4)})}shake*=.9;
 const r=sph.r*Math.max(1,.88/aspect),sx=(Math.random()-.5)*shake,sz=(Math.random()-.5)*shake;
 cam.position.set(r*Math.sin(sph.pol)*Math.sin(sph.az)+sx,r*Math.cos(sph.pol),r*Math.sin(sph.pol)*Math.cos(sph.az)+sz);cam.lookAt(0,0,0);
 dsh.position.set(dice.position.x+.08+(dice.position.y-.3)*.3,.2,dice.position.z+.1+(dice.position.y-.3)*.3);dsh.rotation.z=dice.rotation.z;dsh.scale.copy(dice.scale);R.render(S,cam)})();
