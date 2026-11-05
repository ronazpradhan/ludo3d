// Voice chat for Ludo and the card games: 🎤 mic on/off and 🎧 hear others on/off.
// Audio goes straight between browsers (WebRTC, one link per pair of players). The game server only
// shares who has their mic on and passes the short connection-setup messages along.
// Privacy: the mic is off until you tap 🎤, and nothing connects until someone at the table has a mic on.
function voiceChat(T) {
  if (!window.RTCPeerConnection) return;
  const $ = id => document.getElementById(id);
  const say = t => { if (typeof toast == 'function') toast(t); };
  document.body.insertAdjacentHTML('beforeend',
    '<div id="vcbar"><button id="vcmic" class="glass off" type="button" aria-label="Turn microphone on" aria-pressed="false">' + ICON.micOff + '</button>' +
    '<button id="vcspk" class="glass" type="button" aria-label="Turn voice off" aria-pressed="true"><span class="vci">' + ICON.phones + '</span><b id="vcn"></b></button><div id="vctalk"></div></div>');
  const micBtn = $('vcmic'), spkBtn = $('vcspk'), talk = $('vctalk');
  const pcs = new Map();   // peer id -> { pc, tr, pend, audio, an }
  let mic = false, spk = true, stream = null, busy = false, ctx = null, myAn = null, lastFix = 0;
  let ice = [{ urls: 'stun:stun.l.google.com:19302' }];
  fetch('ice.json').then(r => r.json()).then(j => { if (Array.isArray(j.iceServers) && j.iceServers.length) ice = j.iceServers; }).catch(() => {});

  // ---------- connections ----------
  const wanted = p => mic || p.mic;   // a link is only needed while one of the two is talking
  function make(id, offerer) {
    const pc = new RTCPeerConnection({ iceServers: ice }), c = { pc, tr: null, pend: [], audio: new Audio(), an: null };
    c.audio.autoplay = true; c.audio.setAttribute('playsinline', ''); c.audio.muted = !spk;
    if (offerer) { c.tr = pc.addTransceiver('audio', { direction: 'sendrecv' }); if (stream) c.tr.sender.replaceTrack(stream.getAudioTracks()[0]).catch(() => {}); }
    pc.ontrack = e => { const s = e.streams[0] || new MediaStream([e.track]); c.audio.srcObject = s; c.audio.play().catch(() => {}); c.an = meter(s); };
    pc.onicecandidate = e => { if (e.candidate) T.signal(id, { c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState == 'failed' && pcs.get(id) === c) { close(id); setTimeout(reconcile, 1500); } };
    pcs.set(id, c); return c;
  }
  function close(id) {
    const c = pcs.get(id); if (!c) return; pcs.delete(id);
    try { c.pc.close(); } catch (e) {} c.audio.srcObject = null;
  }
  async function offer(id) {
    const c = make(id, true);
    try { await c.pc.setLocalDescription(await c.pc.createOffer()); T.signal(id, { sdp: c.pc.localDescription.toJSON() }); } catch (e) { close(id); }
  }
  T.onSignal(async (from, d) => {
    if (!d || typeof d != 'object' || !T.members().some(p => p.id === from)) return;
    let c = pcs.get(from);
    try {
      if (d.sdp && d.sdp.type == 'offer') {
        if (c) close(from);
        c = make(from, false);
        await c.pc.setRemoteDescription(d.sdp);
        c.tr = c.pc.getTransceivers()[0]; c.tr.direction = 'sendrecv';
        if (stream) await c.tr.sender.replaceTrack(stream.getAudioTracks()[0]);
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        T.signal(from, { sdp: c.pc.localDescription.toJSON() });
      } else if (d.sdp && d.sdp.type == 'answer' && c && c.pc.signalingState == 'have-local-offer') await c.pc.setRemoteDescription(d.sdp);
      else if (d.c && c) { if (c.pc.remoteDescription) await c.pc.addIceCandidate(d.c); else c.pend.push(d.c); return; }
      if (c && c.pc.remoteDescription) { for (const x of c.pend.splice(0)) c.pc.addIceCandidate(x).catch(() => {}); }
    } catch (e) { if (c) close(from); }
  });

  // Who should I be linked to? The lower id of each pair starts the connection.
  function reconcile() {
    const on = T.active();
    document.body.classList.toggle('vc-on', on);
    if (!on) { for (const id of [...pcs.keys()]) close(id); if (mic) stopMic(); ui(); return; }
    const me = T.myId(); if (!me) return ui();
    if (mic !== T.myMic() && Date.now() - lastFix > 3000) { lastFix = Date.now(); T.setMic(mic); }   // e.g. after a reconnect
    const keep = new Set();
    for (const p of T.members()) if (wanted(p)) { keep.add(p.id); if (!pcs.has(p.id) && me < p.id) offer(p.id); }
    for (const id of [...pcs.keys()]) if (!keep.has(id)) close(id);
    ui();
  }
  T.onChange(reconcile); setInterval(reconcile, 4000);

  // ---------- mic and speaker ----------
  function stopMic() {
    for (const c of pcs.values()) if (c.tr) c.tr.sender.replaceTrack(null).catch(() => {});
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; myAn = null; mic = false; T.setMic(false);
  }
  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return say('Voice needs the https site');
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { return say('Microphone blocked: allow it in your browser settings'); }
    if (!T.active()) { stream.getTracks().forEach(t => t.stop()); stream = null; return; }
    const t = stream.getAudioTracks()[0];
    for (const c of pcs.values()) if (c.tr) c.tr.sender.replaceTrack(t).catch(() => {});
    myAn = meter(stream); mic = true; T.setMic(true);
    if (!spk) setSpk(true);
  }
  function setSpk(on) {
    spk = on;
    for (const c of pcs.values()) { c.audio.muted = !on; if (on) c.audio.play().catch(() => {}); }
  }
  micBtn.onclick = async () => {
    if (busy) return; busy = true; unlock();
    try { if (mic) stopMic(); else await startMic(); } finally { busy = false; reconcile(); }
  };
  spkBtn.onclick = () => { unlock(); setSpk(!spk); if (!spk && mic) stopMic(); reconcile(); };

  // ---------- who's talking ----------
  function unlock() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state == 'suspended') ctx.resume(); } catch (e) {} }
  function meter(s) {
    unlock(); if (!ctx) return null;
    try { const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(s).connect(an); return { an, buf: new Uint8Array(an.fftSize) }; } catch (e) { return null; }
  }
  function level(m) {
    if (!m) return 0; m.an.getByteTimeDomainData(m.buf);
    let s = 0; for (const v of m.buf) { const x = (v - 128) / 128; s += x * x; } return Math.sqrt(s / m.buf.length);
  }
  setInterval(() => {
    if (!T.active()) return;
    micBtn.classList.toggle('live', mic && level(myAn) > 0.03);
    const names = spk ? T.members().filter(p => pcs.has(p.id) && level(pcs.get(p.id).an) > 0.03).map(p => p.name) : [];
    const txt = names.join(', ');
    if (talk.dataset.t !== txt) { talk.dataset.t = txt; talk.innerHTML = txt ? ICON.vol : ''; talk.append(txt); }
  }, 200);

  function ui() {
    if (micBtn.dataset.on !== String(mic)) { micBtn.dataset.on = mic; micBtn.innerHTML = mic ? ICON.mic : ICON.micOff; }
    if (spkBtn.dataset.on !== String(spk)) { spkBtn.dataset.on = spk; spkBtn.querySelector('.vci').innerHTML = spk ? ICON.phones : ICON.phonesOff; }
    micBtn.classList.toggle('off', !mic); micBtn.setAttribute('aria-pressed', mic); micBtn.setAttribute('aria-label', mic ? 'Turn microphone off' : 'Turn microphone on');
    micBtn.title = mic ? 'Mic on: tap to mute' : 'Mic off: tap to talk';
    spkBtn.classList.toggle('off', !spk); spkBtn.setAttribute('aria-pressed', spk); spkBtn.setAttribute('aria-label', spk ? 'Turn voice off' : 'Turn voice on');
    const n = T.active() ? T.members().filter(p => p.mic).length : 0;
    $('vcn').textContent = n || ''; spkBtn.title = (spk ? 'Hearing voice' : 'Voice muted') + (n ? ' · ' + n + ' with mic on' : '');
  }
  ui();
}

// Card games (Jutpatti, Flash, Dhumbal): the room server knows the seats and relays setup messages.
function cardVoice(P) {
  const raw = window.claude && claude.raw; if (!raw) return;
  let me = null, players = [], on = false, sig = () => {}, chg = () => {};
  raw.on(m => {
    if (typeof m.t != 'string' || !m.t.startsWith(P)) return;
    const t = m.t.slice(P.length);
    if (t == 'state' && m.room) { me = m.you; players = m.room.players || []; on = true; chg(); }
    else if (t == 'left' || t == 'kicked') { on = false; players = []; chg(); }
    else if (t == 'vsig') sig(m.from, m.d);
  });
  voiceChat({
    active: () => on, myId: () => me,
    myMic: () => { const p = players.find(x => x.pid === me); return !!(p && p.mic); },
    members: () => players.filter(p => p.pid !== me && p.connected).map(p => ({ id: p.pid, name: p.name, mic: !!p.mic })),
    setMic: v => raw.send({ t: P + 'vmic', on: !!v }), signal: (to, d) => raw.send({ t: P + 'vsig', to, d }),
    onSignal: f => { sig = f; }, onChange: f => { chg = f; },
  });
}

// Ludo: everyone in the relay room; "mic on" rides on presence, setup messages go to one peer at a time.
function ludoVoice() {
  let cur = null, sig = () => {}, chg = () => {};
  const self = () => cur && cur.peers().find(p => p.isMe);
  const nameOf = id => { const s = typeof lo != 'undefined' ? lo.indexOf(id) : -1; return (s >= 0 && ln[s]) || 'Player'; };
  setInterval(() => {
    const n = typeof net != 'undefined' ? net : null;
    if (n === cur) return; cur = n;
    if (cur) { cur.on('v', m => { if (m.data) sig(m.from, m.data.d); }); cur.onPeers(() => chg()); }
    chg();
  }, 700);
  voiceChat({
    active: () => !!cur, myId: () => { const p = self(); return p && p.id; },
    myMic: () => { const p = self(); return !!(p && p.presence && p.presence.mic); },
    members: () => cur ? cur.peers().filter(p => !p.isMe && p.presence && p.presence.id).map(p => ({ id: p.id, name: nameOf(p.presence.id), mic: !!p.presence.mic })) : [],
    setMic: v => { if (cur) cur.presence({ mic: v ? 1 : 0 }); }, signal: (to, d) => { if (cur) cur.emit('v', { to, d }); },
    onSignal: f => { sig = f; }, onChange: f => { chg = f; },
  });
  const bar = document.getElementById('vcbar'), chat = document.getElementById('ctog');
  if (bar && chat) bar.append(chat);   // chat button joins the voice dock
}
