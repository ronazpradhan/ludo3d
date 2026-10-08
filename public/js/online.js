// Ludo 3D online: rooms, lobby, chat, soundboard UI, and rejoin/reconnect.
// ---------- online
const esc=x=>String(x).replace(/[<>&"]/g,'').slice(0,20),CODES='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',LINK=location.origin+location.pathname+'#room=';
let net=null,lob=null,owner=[],me=Math.random().toString(36).slice(2,10),host=true,names=['','','',''],roomCode='',nick='',lastDec=[],ls=[0,0,0,0],lo=[null,null,null,null],ln=['','','',''],unread=0,chatOpen=false,dn=0,offs=[],lt=0,gotL=0,tries=0,begun=null,restoring=false,syncRes=null,leaving=false,svT=0,trapped=false;
const inbox={},waiters={};
const SKEY='ludo3d.session',TAB=(()=>{try{let t=sessionStorage.getItem('ludo3d.tab');if(!t){t=Math.random().toString(36).slice(2,10);sessionStorage.setItem('ludo3d.tab',t)}return t}catch(e){return 'x'}})();
$('nick').value=store.get('ludo3d.nick')||'';
const toast=t=>{const e=$('toast');e.textContent=t;e.classList.remove('on');void e.offsetWidth;e.classList.add('on');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('on'),2400)};
const getNick=()=>{nick=esc($('nick').value.trim());if(nick)store.set('ludo3d.nick',nick);return nick},reqNick=()=>{const i=$('nick');if(getNick()){i.classList.remove('bad');return true}toast('Enter your name first');i.classList.remove('bad');void i.offsetWidth;i.classList.add('bad');clearTimeout(i._b);i._b=setTimeout(()=>i.classList.remove('bad'),1200);i.focus();return false};let pend='';$('nick').addEventListener('input',()=>{$('nick').classList.remove('bad');$('toast').classList.remove('on')});
async function copy(t){try{await navigator.clipboard.writeText(t)}catch(e){const a=document.createElement('textarea');a.value=t;document.body.append(a);a.select();try{document.execCommand('copy')}catch(e2){}a.remove()}toast('Copied!')}
function put(m){inbox[m.n]=m;saveSoon();const w=waiters[m.n];if(w){delete waiters[m.n];w(m)}}
function dec(n,o){o.n=n;o.g=gameNo;put(o);if(net){lastDec=[...lastDec,o].slice(-4);net.emit('g',o)}}
function take(n,c,fb){return new Promise(r=>{if(inbox[n])return r(inbox[n]);waiters[n]=r;
 // host: if the seat's player left, ran out of time, or is already covered by a bot, the bot plays this move
 if(net&&host&&seats[c]==1&&owner[c]!==me){const t0=Date.now(),iv=setInterval(()=>{if(inbox[n]||!started){clearInterval(iv);return}
  const gone=!net.peers().some(p=>p.presence&&p.presence.id===owner[c]),late=Date.now()-t0>TURN_MS+EXTRA_MS+1500;
  if(botFor[c]&&Date.now()-t0<600)return;   // bot moves at a CPU-like pace
  if(botFor[c]||gone||late){clearInterval(iv);if(!botFor[c])setBot(c,true);dec(n,fb())}},300)}})}
// ---------- bot takeover / "I'm back" ----------
let backWait=[],backAt=0;
const waitBack=()=>new Promise(r=>backWait.push(r));
function applyBot(c,on){if(!(c>=0&&c<4)||seats[c]!=1||!!botFor[c]===!!on)return;botFor[c]=!!on;ui();updBotBar();
 const t=on?'🤖 Bot joined the game for '+PN(c):PN(c)+' is back! 👋';addChat('',t,0,1);toast(t);if(on&&owner[c]===me){sfx.chime();try{if(navigator.vibrate&&(!navigator.userActivation||navigator.userActivation.hasBeenActive))navigator.vibrate([60,60,60])}catch(e){}}}
function setBot(c,on){applyBot(c,on);if(net)net.emit('bot',{g:gameNo,c,on:!!on})}
function updBotBar(){const b=$('botbar');if(!b)return;const s=net?owner.indexOf(me):-1;b.style.display=s>=0&&botFor[s]&&started&&!ended?'flex':'none'}
function iAmBack(){const s=net?owner.indexOf(me):-1;if(s<0||!botFor[s])return;backAt=Date.now();setBot(s,false);backWait.splice(0).forEach(f=>f())}
setInterval(()=>{if(net&&started)lastDec.forEach(o=>net.emit('g',o));if(net&&started&&host)net.emit('bots',{g:gameNo,b:botFor})},2500);
function addChat(who,txt,col,sys){const d=document.createElement('div');d.className='cm'+(sys?' sys':'');if(!sys){const b=document.createElement('b');b.textContent=who;b.style.color=col||'#fff';d.append(b)}d.append(document.createTextNode((sys?'':' ')+txt));$('clog').append(d);$('clog').scrollTop=1e9;if(!sys&&chatHidden()){unread++;$('cbadge').textContent=unread;floatMsg(who,txt,col)}}
// floating chat: new messages pop up over the board (like a live stream) while the chat panel is closed
function floatMsg(who,txt,col){const f=$('float');if(!f)return;const d=document.createElement('div');d.className='fm';const b=document.createElement('b');b.textContent=who;b.style.color=col||'#fff';d.append(b,document.createTextNode(' '+txt));f.append(d);while(f.children.length>3)f.firstChild.remove();setTimeout(()=>{d.classList.add('out');setTimeout(()=>d.remove(),500)},6000)}
function sendChat(){const t=$('ctext').value.trim().slice(0,200);if(!t||!net)return;$('ctext').value='';const s=lo.indexOf(me);addChat(nick,t,CS[s],0);net.emit('chat',{u:nick,t,s})}
(()=>{const E='😀😂🤣😍😎🥳😅😭😡🤔🙌👏👍👎🙏💪🔥🎉🎲🏆👑💀😱🤯😏😴🤝❤️💔🍀✨😈🫡😬🥲'.match(/\p{Extended_Pictographic}\uFE0F?/gu),P=$('emo'),G=$('egrid'),I=$('ctext');
 E.forEach(e=>{const b=document.createElement('button');b.type='button';b.textContent=e;b.onclick=()=>{const a=I.selectionStart??I.value.length,z=I.selectionEnd??a;I.value=(I.value.slice(0,a)+e+I.value.slice(z)).slice(0,200);I.selectionStart=I.selectionEnd=Math.min(200,a+e.length)};G.append(b)});

 {const mb=document.createElement('button');mb.type='button';mb.className='mute';const paint=()=>{mb.textContent=boardOn?'🔔 Soundboard on · tap to mute':'🔕 Soundboard muted · tap to unmute';mb.classList.toggle('off',!boardOn)};mb.onclick=()=>{boardOn=!boardOn;store.set('ludo3d.board',boardOn?'1':'0');paint()};paint();$('sgrid').append(mb)}
 AUDIO.board.forEach((x,i)=>{const b=document.createElement('button');b.type='button';b.textContent=x.label;if(!x.src)b.className='empty';
  b.onclick=()=>{if(!x.src){toast('Empty slot — add an audio file first');return}if(!boardOn){toast('Soundboard is muted — tap the 🔕 button to unmute');return}if(Date.now()-lastSnd<1500)return;lastSnd=Date.now();playBoard(i);if(net)net.emit('snd',{i,u:nick})};$('sgrid').append(b)});
 QUICK.forEach(w=>{const b=document.createElement('button');b.type='button';b.textContent=w;b.onclick=()=>{I.value=w;sendChat();P.classList.remove('on')};$('wgrid').append(b)});
 P.querySelectorAll('.etabs button').forEach(b=>b.onclick=()=>{P.querySelectorAll('.etabs button').forEach(x=>x.classList.toggle('on',x==b));const t=b.dataset.t;$('sgrid').classList.toggle('on',t=='s');$('wgrid').classList.toggle('on',t=='w');G.classList.toggle('off',t!='e')});
 $('ebtn').onclick=()=>P.classList.toggle('on');$('csend').addEventListener('click',()=>P.classList.remove('on'))})();
let lastSnd=0;
function renderRooms(){const L=$('rooms');L.textContent='';if(!lob)return;const a=lob.peers().filter(p=>!p.isMe&&p.presence&&/^[A-Z0-9]{5}$/.test(p.presence.lr||''));if(a.length)L.append(Object.assign(document.createElement('div'),{className:'sub',textContent:'Open rooms',style:'margin:14px 0 0'}));
 a.forEach(p=>{const d=document.createElement('div');d.className='rm';const s=document.createElement('span');s.textContent=esc(p.presence.hn||'Player')+"'s room · "+(+p.presence.pc||1)+'/4';const b=document.createElement('button');b.className='pill';b.textContent='Join';b.onclick=()=>joinRoom(p.presence.lr);d.append(s,b);L.append(d)})}
(async()=>{try{lob=window.claude?await claude.use('room'):null}catch(e){}
 const o=$('onl');if(!lob){o.textContent='Online play is unavailable right now. Try reloading.';return}
 o.textContent=claude.online()?'':'Offline - retrying...';$('bCreate').disabled=$('bJoin').disabled=false;lob.onPeers(renderRooms);
 const q=(new URLSearchParams(location.search).get('room')||(location.hash.match(/room=([A-Za-z0-9]{5})/)||[])[1]||'').toUpperCase(),inv=/^[A-Z0-9]{5}$/.test(q),ss=loadSess();
 if(ss&&(!inv||q===ss.code)){if(ss.tab===TAB||ss.auto){toast('Rejoining room '+ss.code+'...');rejoin(ss)}else showResume(ss)}
 else if(inv){pend=q;$('code').value=q;toast('Enter your name to join room '+q);$('nick').focus();$('nick').onkeydown=e=>{if(e.key=='Enter'&&pend)joinRoom(pend)}}})();
function bc(){if(!host||!net)return;net.emit('lobby',{c:roomCode,h:me,ls,lo,ln});renderLobby();saveSoon();lob.presence({lr:started?null:roomCode,hn:nick,pc:ls.filter(x=>x==1||x==2).length})}
// a new player who didn't pick a seat sits opposite the first player, so a 2-player game is played from opposite corners
function autoSeat(){const oc=[0,1,2,3].filter(i=>ls[i]==1||ls[i]==2);if(oc.length==1&&ls[(oc[0]+2)%4]==0)return(oc[0]+2)%4;return ls.indexOf(0)}
function oppose(){const oc=[0,1,2,3].filter(i=>ls[i]==1||ls[i]==2);if(oc.length!=2||oc[1]-oc[0]==2)return;const b=oc[1],to=(oc[0]+2)%4;ls[to]=ls[b];lo[to]=lo[b];ln[to]=ln[b];ls[b]=0;lo[b]=null;ln[b]=''}
function claimSeat(id,nk,seat){const cur=lo.indexOf(id);if(seat<0){if(cur>=0)return;seat=autoSeat()}if(!(seat>=0&&seat<4)||ls[seat]!=0)return;if(cur>=0){ls[cur]=0;lo[cur]=null;ln[cur]=''}ls[seat]=1;lo[seat]=id;ln[seat]=nk;bc()}
function renderLobby(){const S=$('lseats');S.textContent='';ls.forEach((s,i)=>{const b=document.createElement('button');b.className='seat'+(s==0||s==3?' off':'');b.style.setProperty('--c',CS[i]);const d=document.createElement('i'),n=document.createElement('span'),e=document.createElement('em');n.textContent=CN[i];if(s==1||s==2){d.className='av';d.textContent=s==2?'🤖':avatarFor(lo[i])}
  e.textContent=s==1?(lo[i]===me?'You':ln[i]||'Player'):s==2?'CPU':s==3?'Closed':'Sit here';b.append(d,n,e);
  b.onclick=()=>{sfx.tick();if(s==0){if(host)claimSeat(me,nick,i);else net.emit('claim',{id:me,nick,seat:i})}else if(host&&s!=1){ls[i]=s==2?3:0;bc()}};
  if(host&&s==0){const g=document.createElement('button');g.className='pill';g.textContent='+ CPU';g.onclick=ev=>{ev.stopPropagation();sfx.tick();ls[i]=2;bc()};b.append(g)}
  S.append(b)});
 const cnt=ls.filter(x=>x==1||x==2).length;$('lstart').style.display=host?'':'none';$('lstart').disabled=cnt<2;$('lnote').textContent=host?'Share the code or invite link — friends join with one tap':'Waiting for the host to start…';$('cinfo').textContent=' · '+ls.filter(x=>x==1).length+' online'}
function begin(a,b,c){if(started)return;clearInterval(lt);begun={ls:[...a],lo:[...b],ln:[...c]};seats=a.map(x=>x==1?1:x==2?2:0);owner=b;names=c.map(esc);$('lobby').style.display='none';if(host)lob.presence({lr:null});trapBack();startGame();saveSoon()}
async function joinRoom(code,create,resume){if(!lob||net)return;if(!reqNick())return;roomCode=code;host=!!create;leaving=false;$('landing').style.display='none';
 try{net=await lob.join('ludo-'+code.toLowerCase())}catch(e){toast('Could not open the room');$('landing').style.display='flex';return}
 const rg=resume&&resume.game;
 document.body.classList.add('online');if(!rg)$('lobby').style.display='flex';$('rcode').textContent=code;$('clog').textContent='';addChat('','Room '+code,0,1);ls=[0,0,0,0];lo=[null,null,null,null];ln=['','','',''];gotL=0;tries=0;net.presence({id:me});trapBack();
 {const Lb=resume&&resume.lobby;if(host&&Lb&&Array.isArray(Lb.ls)&&Lb.ls.length==4&&Array.isArray(Lb.lo)&&Array.isArray(Lb.ln)){   // host coming back keeps CPU/closed seats, friends re-sit by themselves
  ls=Lb.ls.map((x,i)=>x==1&&Lb.lo[i]!==me?0:x|0);lo=Lb.lo.map((x,i)=>ls[i]==1&&x?String(x).slice(0,12):null);ln=Lb.ln.map((x,i)=>ls[i]==1?esc(x):'')}}
 offs=[net.on('lobby',m=>{const d=m.data;if(host||m.sameTab||!d||d.c!==code||!Array.isArray(d.ls))return;ls=d.ls.map(x=>x|0);lo=d.lo.map(x=>x?String(x).slice(0,12):null);ln=d.ln.map(esc);gotL=1;renderLobby()}),
 net.on('claim',m=>{const d=m.data;if(host&&!m.sameTab&&d)claimSeat(String(d.id).slice(0,12),esc(d.nick||'Player'),+d.seat)}),
 net.on('start',m=>{const d=m.data;if(!host&&!m.sameTab&&d&&Array.isArray(d.ls))begin(d.ls,d.lo,d.ln)}),
 net.on('again',m=>{const d=m.data;if(d&&(d.g|0)===gameNo+1){if(ended)restartGame();else againPend=true}}),
 net.on('snd',m=>{const d=m.data;if(d&&!m.sameTab&&Date.now()-lastSnd>800){lastSnd=Date.now();playBoard(d.i|0,true,esc(d.u||''))}}),
 net.on('bot',m=>{const d=m.data;if(!m.sameTab&&d&&(d.g|0)===gameNo)applyBot(d.c|0,!!d.on)}),
 net.on('bots',m=>{const d=m.data;if(host||m.sameTab||!d||(d.g|0)!==gameNo||!Array.isArray(d.b))return;const s=owner.indexOf(me);d.b.forEach((x,i)=>{if(i===s&&Date.now()-backAt<5000)return;applyBot(i,!!x)})}),
 net.on('chat',m=>{const d=m.data;if(!m.sameTab&&d)addChat(esc(d.u||'?'),String(d.t||'').slice(0,200),CS[d.s],0)}),
 net.on('g',m=>{const d=m.data;if(!m.sameTab&&d&&Number.isInteger(d.n)&&(d.g|0)===gameNo&&((d.k=='r'&&d.v>=1&&d.v<=6)||(d.k=='p'&&d.i>=0&&d.i<4)))put({k:d.k,v:d.v|0,i:d.i|0,n:d.n})}),
 net.onPeers(ch=>{ch.joined.forEach(p=>{if(!p.isMe&&p.presence&&p.presence.id&&!started)addChat('','A player joined',0,1)});ch.left.forEach(p=>{const id=p.presence&&p.presence.id,s=lo.indexOf(id);if(id&&s>=0){addChat('',(ln[s]||'A player')+' left',0,1);if(!started&&host){ls[s]=0;lo[s]=null;ln[s]='';bc()}}})})];
 offs.push(net.on('sync',m=>{const d=m.data;if(!d||!started||restoring)return;const g=d.g|0;if(g>gameNo){requestSync();return}const l=logStr();if(g<gameNo||l.length>(d.n|0))net.emit('log',{g:gameNo,l})}),
  net.on('log',m=>{const d=m.data;if(!d||typeof d.l!='string'||!/^[1-6a-d_]{0,6000}$/.test(d.l))return;const g=d.g|0;
   if(restoring){if(g>gameNo){gameNo=g;wipeInbox()}if(g==gameNo)applyLog(d.l,true);if(syncRes){const r=syncRes;syncRes=null;r()}return}
   if(!started)return;if(g==gameNo){if(applyLog(d.l,false))hardResync(d.l,g)}else if(g>gameNo)hardResync(d.l,g)}));
 if(rg){resumeGame(rg);return}
 if(host){claimSeat(me,nick,-1);bc()}else net.emit('claim',{id:me,nick,seat:-1});
 lt=setInterval(()=>{if(started)return;if(host)bc();else{if(!gotL&&++tries>5){toast('Room not found');leaveRoom();return}if(lo.indexOf(me)<0)net.emit('claim',{id:me,nick,seat:-1})}},1500)}
function leaveRoom(){leaving=true;trapped=false;store.del(SKEY);if(started){location.reload();return}clearInterval(lt);offs.forEach(f=>f());if(net)net.leave();net=null;if(lob)lob.presence({lr:null});document.body.classList.remove('online');$('lobby').style.display='none';$('landing').style.display='flex'}
$('bQuick').onclick=()=>{if(!reqNick())return;sfx.tick();$('landing').style.display='none';$('menu').style.display='flex'};
$('mback').onclick=()=>{$('menu').style.display='none';$('landing').style.display='flex'};
$('bCreate').onclick=()=>{sfx.tick();let c='';for(let i=0;i<5;i++)c+=CODES[Math.random()*CODES.length|0];joinRoom(c,true)};
$('bJoin').onclick=()=>{const c=$('code').value.trim().toUpperCase();if(/^[A-Z0-9]{5}$/.test(c))joinRoom(c);else toast('Enter the 5-character code')};
$('cCode').onclick=()=>copy(roomCode);$('cLink').onclick=()=>copy(LINK+roomCode);$('lleave').onclick=leaveRoom;
$('again').onclick=()=>{if(!ended)return;if(net)net.emit('again',{g:gameNo+1});restartGame()};
$('home').onclick=()=>$('qyes').onclick();
$('qbtn').onclick=()=>$('qconf').style.display='flex';$('qno').onclick=()=>$('qconf').style.display='none';$('qyes').onclick=()=>{leaving=true;store.del(SKEY);try{if(net)net.leave()}catch(e){}try{const u=new URL(location.href);u.searchParams.delete('room');u.hash='';location.replace(u.toString())}catch(e){location.reload()}};
$('lstart').onclick=()=>{if(ls.filter(x=>x==1||x==2).length<2)return;oppose();bc();const d={ls,lo,ln};for(let i=0;i<6;i++)setTimeout(()=>net&&net.emit('start',d),i*1200);begin(ls,lo,ln)};
$('csend').onclick=sendChat;
$('botback').onclick=iAmBack;$('stage').addEventListener('pointerdown',iAmBack);$('ctext').onkeydown=e=>{if(e.key=='Enter')sendChat()};
// chat: ✕ closes it (side panel on desktop, slide-over on phones), 💬 button brings it back
const chatHidden=()=>innerWidth<900?!chatOpen:document.body.classList.contains('chat-off');
function setChat(open){if(innerWidth<900){chatOpen=open;$('chat').classList.toggle('open',open)}else document.body.classList.toggle('chat-off',!open);if(open){unread=0;$('cbadge').textContent='';$('float').textContent=''}}
$('ctog').onclick=()=>setChat(chatHidden());$('cclose').onclick=()=>setChat(false);
// ---------- rejoin: remember the room + every dice/pick decision in this browser ----------
// The game is deterministic: same decisions in = same board out. So saving the decision log is enough
// to rebuild the exact position after a reload / back button / dropped connection.
function logStr(){let s='',mx=-1;for(const k in inbox)if(+k>mx)mx=+k;for(let i=0;i<=mx;i++){const m=inbox[i];s+=!m?'_':m.k=='r'?String(m.v):'abcd'[m.i]}return s}
function known(){let i=0;while(inbox[i])i++;return i}
function wipeInbox(){Object.keys(inbox).forEach(k=>delete inbox[k])}
// merge a decision log; force=true lets the incoming log overwrite. Returns true if it disagrees with what we have.
function applyLog(l,force){let bad=false;for(let i=0;i<l.length;i++){const ch=l[i];let o=null;if(ch>='1'&&ch<='6')o={k:'r',v:+ch,i:0};else if(ch>='a'&&ch<='d')o={k:'p',v:0,i:ch.charCodeAt(0)-97};if(!o)continue;
  const cur=inbox[i];if(!cur)put({...o,n:i,g:gameNo});else if(cur.k!=o.k||(o.k=='r'?cur.v!=o.v:cur.i!=o.i)){if(force)inbox[i]={...o,n:i,g:gameNo};else bad=true}}return bad}
function requestSync(){if(net)net.emit('sync',{g:gameNo,n:known()})}
function saveNow(){clearTimeout(svT);if(!net||!roomCode||leaving||restoring||ended)return;
 const s={code:roomCode,nick,me,host,tab:TAB,t:Date.now()};if(started&&begun)s.game={no:gameNo,b:begun,log:logStr()};else s.lobby={ls,lo,ln};store.set(SKEY,JSON.stringify(s))}
function saveSoon(){clearTimeout(svT);svT=setTimeout(saveNow,300)}
const forgetSession=()=>store.del(SKEY);
addEventListener('pagehide',saveNow);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveNow()});
function loadSess(){let s;try{s=JSON.parse(store.get(SKEY)||'null')}catch(e){return null}
 if(!s||typeof s!='object'||!/^[A-Z0-9]{5}$/.test(s.code||'')||Date.now()-(+s.t||0)>12*36e5)return null;
 s.me=String(s.me||'').slice(0,12);s.nick=esc(s.nick||'');if(!s.me||!s.nick)return null;s.host=!!s.host;
 const g=s.game;if(g){if(g.b&&Array.isArray(g.b.ls)&&g.b.ls.length==4&&Array.isArray(g.b.lo)&&g.b.lo.length==4&&Array.isArray(g.b.ln)&&g.b.ln.length==4&&typeof g.log=='string'&&/^[1-6a-d_]{0,6000}$/.test(g.log))g.no=g.no|0;else s.game=null}
 return s}
function showResume(s){const r=$('resume');r.style.display='flex';$('rtxt').textContent=(s.game?'Game in progress · room ':'Room ')+s.code;$('rgo').onclick=()=>{r.style.display='none';rejoin(s)};$('rno').onclick=()=>{r.style.display='none';forgetSession()}}
async function rejoin(s){if(!lob||net)return;me=s.me;$('nick').value=s.nick;$('resume').style.display='none';await joinRoom(s.code,s.host,s)}
async function resumeGame(g){restoring=true;const b=g.b;ls=b.ls.map(x=>x|0);lo=b.lo.map(x=>x?String(x).slice(0,12):null);ln=b.ln.map(esc);gotL=1;renderLobby();
 gameNo=g.no;wipeInbox();applyLog(g.log,true);addChat('','Reconnecting to the game…',0,1);
 const got=new Promise(r=>syncRes=r);requestSync();await Promise.race([got,new Promise(r=>setTimeout(r,2000))]);syncRes=null;   // ask the others what we missed
 ff=true;setTimeout(()=>{ff=false},4000);begin(ls,lo,ln);restoring=false;saveNow();   // 4s failsafe so silent mode can never get stuck
                                                                             // silent fast replay up to the present
 setTimeout(()=>{if(net)net.emit('log',{g:gameNo,l:logStr()})},1500);toast('Back in the game');
 setTimeout(()=>{const s=owner.indexOf(me);if(net&&s>=0){backAt=Date.now();net.emit('bot',{g:gameNo,c:s,on:false})}},2500)}   // tell everyone I'm back (only announced if a bot was covering me)
function hardResync(l,g){if(!begun)return;const last=+store.get('ludo3d.hr')||0;if(Date.now()-last<15000)return;store.set('ludo3d.hr',String(Date.now()));
 leaving=true;store.set(SKEY,JSON.stringify({code:roomCode,nick,me,host,tab:TAB,t:Date.now(),auto:1,game:{no:g,b:begun,log:l}}));location.reload()}
// connection lost / back: tell the player and catch up on anything missed
addEventListener('net',e=>{if(e.detail=='up'&&$('onl'))$('onl').textContent='';if(!net)return;if(e.detail=='down')toast('Connection lost · reconnecting…');else if(e.detail=='up'){toast('Back online');if(started)requestSync();else if(host)bc()}});
// accidental back button / tab close while in a room
function trapBack(){if(trapped)return;trapped=true;try{history.pushState({ludo:1},'',location.href)}catch(e){}}
addEventListener('popstate',()=>{if(net&&!leaving){try{history.pushState({ludo:1},'',location.href)}catch(e){}toast('Use ✕ or Leave to exit the game')}});
addEventListener('beforeunload',e=>{if(net&&started&&!ended&&!leaving){e.preventDefault();e.returnValue=''}});

