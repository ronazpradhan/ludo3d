// Audio: built-in synthesized game sounds + file playback (capture sound, soundboard).
let ff=false;   // fast-forward flag: true while a rejoin silently replays old moves

let AC,MG,NB,snd=store.get('ludo3d.sfx')!=='0',boardOn=store.get('ludo3d.board')!=='0';   // snd = master (all sounds), boardOn = soundboard only
function ac(){if(!AC){AC=new(window.AudioContext||window.webkitAudioContext)();const c=AC.createDynamicsCompressor(),g=AC.createGain();g.gain.value=.9;MG=g;g.connect(c);c.connect(AC.destination);NB=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const d=NB.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1}if(AC.state=='suspended')AC.resume();return AC}
function tone(f,t0,d,o={}){if(!snd||ff)return;try{const{ty='sine',v=.15,f2,a=.006}=o,A=ac(),os=A.createOscillator(),g=A.createGain(),t=A.currentTime+t0;os.type=ty;os.frequency.setValueAtTime(f,t);if(f2)os.frequency.exponentialRampToValueAtTime(f2,t+d);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(v,t+a);g.gain.exponentialRampToValueAtTime(.0001,t+d);os.connect(g);g.connect(MG);os.start(t);os.stop(t+d+.05)}catch(e){}}
function noise(t0,d,o={}){if(!snd||ff)return;try{const{f=2000,q=1,ty='bandpass',v=.2}=o,A=ac(),s=A.createBufferSource(),fl=A.createBiquadFilter(),g=A.createGain(),t=A.currentTime+t0;s.buffer=NB;fl.type=ty;fl.frequency.value=f;fl.Q.value=q;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0001,t+d);s.connect(fl);fl.connect(g);g.connect(MG);s.start(t,Math.random()*.5);s.stop(t+d+.02)}catch(e){}}
const beep=(f,d=.1,ty='sine',v=.07)=>tone(f,0,d,{ty,v});
const sfx={
 tok(t,v,f){noise(t,.03,{f:f*6,q:1.5,v:v*.6});tone(f,t,.09,{v:v,f2:f*.55,a:.002})},
 roll(){noise(0,.18,{f:1500,q:.5,v:.035,ty:'highpass'});this.tok(.31,.22,175);this.tok(.46,.09,190);this.tok(.63,.17,165);noise(.63,.07,{f:300,q:.5,v:.08})},
 step(p){tone(520+Math.min(p,50)*8,0,.09,{v:.12,f2:380});noise(0,.03,{f:3000,v:.05})},
 out(){noise(0,.25,{f:1200,v:.1});[660,880,1320].forEach((f,i)=>tone(f,i*.06,.25,{v:.09}))},
 tick(){tone(900,0,.05,{v:.08,f2:700})},
 chime(){tone(784,0,.4,{v:.1});tone(1175,.09,.5,{v:.08})},
 six(){tone(1400,0,.12,{v:.04,f2:1800})},
 start(){tone(392,0,.3,{v:.1});tone(523,.1,.3,{v:.1});tone(784,.2,.5,{v:.1})},
 home(){[523,659,784,1047,1319].forEach((f,i)=>tone(f,i*.08,.5,{v:.1}))},
 win(){[[523,0],[659,.12],[784,.24],[1047,.4],[784,.58],[1047,.7],[1319,.9],[1568,1.1]].forEach(a=>tone(a[0],a[1],.5,{ty:'triangle',v:.12}))},
 faah(){if(!snd||ff)return;const syn=()=>this.faahSynth();if(AUDIO.capture&&playFile(AUDIO.capture,AUDIO.captureVolume??1,syn))return;syn()},
 faahSynth(){try{const A=ac(),t=A.currentTime,o=A.createOscillator(),g=A.createGain(),lf=A.createOscillator(),lg=A.createGain();o.type='sawtooth';o.frequency.setValueAtTime(400,t);o.frequency.exponentialRampToValueAtTime(215,t+1);lf.frequency.value=5.5;lg.gain.value=9;lf.connect(lg);lg.connect(o.frequency);
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.6,t+.07);g.gain.setValueAtTime(.6,t+.55);g.gain.exponentialRampToValueAtTime(.0001,t+1.05);
  [[800,6,3],[1250,8,2.4],[2600,10,1]].forEach(a=>{const b=A.createBiquadFilter(),bg=A.createGain();b.type='bandpass';b.frequency.setValueAtTime(a[0]*1.05,t);b.frequency.linearRampToValueAtTime(a[0]*.92,t+1);b.Q.value=a[1];bg.gain.value=a[2];o.connect(b);b.connect(bg);bg.connect(g)});
  g.connect(MG);o.start(t);lf.start(t);o.stop(t+1.1);lf.stop(t+1.1)}catch(e){}noise(0,.09,{f:5000,ty:'highpass',v:.15});tone(90,0,.4,{v:.5,f2:40})}};

// ---- audio files (capture sound + soundboard) ----
const SFILES={};let unl=0;
const fileEl=src=>SFILES[src]||(SFILES[src]=Object.assign(new Audio(src),{preload:'auto'}));
function playFile(src,vol=1,onfail){if(!src)return false;try{const a=fileEl(src);a.volume=vol;a.currentTime=0;const p=a.play();if(p&&p.catch)p.catch(()=>{if(onfail)onfail()});return true}catch(e){if(onfail)onfail();return false}}
// phones only allow audio after a tap, so unlock everything on the first touch
function unlockAudio(){try{ac()}catch(e){}[AUDIO.capture,...AUDIO.board.map(x=>x.src)].filter(Boolean).forEach(s=>{const a=fileEl(s);a.muted=true;const p=a.play();if(p&&p.then)p.then(()=>{a.pause();a.currentTime=0;a.muted=false}).catch(()=>{a.muted=false});else a.muted=false})}
['pointerdown','keydown'].forEach(ev=>addEventListener(ev,()=>{if(unl)return;unl=1;unlockAudio()},{passive:true}));
function playBoard(i,remote,who){const x=AUDIO.board[i];if(!x||!x.src)return;const hear=snd&&boardOn;if(hear)playFile(x.src);addChat('',(remote?who||'Someone':nick)+' played '+x.label+(hear?'':' (muted)'),0,1)}

