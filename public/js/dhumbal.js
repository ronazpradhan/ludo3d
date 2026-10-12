// Dhumbal client: draws whatever state the server sends and sends the player's intents.
// No game logic and never trusted: the server owns the deck, every hand, whose turn it is and the score.
// Points are play money with no real-world value.
(() => {
const $ = id => document.getElementById(id);
const P = 'dh:', SKEY = 'dhumbal.session', LINK = location.origin + location.pathname + '#room=';
const COLORS = ['#fbc916', '#22c55e', '#ef4444', '#3b82f6', '#a855f7'];
const AV = ['🦊', '🐼', '🐯', '🐸', '🐵', '🦁', '🐨', '🐰', '🐧', '🐙', '🦄', '🐻', '🐶', '🐱', '🐮', '🐷', '🐲', '🦉'];
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' }, SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const VAL = { A: 1, J: 11, Q: 12, K: 13 }, val = c => VAL[c.slice(0, -1)] || +c.slice(0, -1);   // label only; the server counts
const ERR = {
  NAME_REQUIRED: 'Enter your name first', ROOM_NOT_FOUND: 'Room not found', ROOM_FULL: 'That room is full (5 players)',
  IN_PROGRESS: 'A game is being played — join when it ends', NOT_HOST: 'Only the host can do that', NOT_READY: 'Waiting for everyone to be ready',
  NOT_ENOUGH_PLAYERS: 'Need at least 2 players', PLAYER_OFFLINE: 'Someone is offline', NOT_YOUR_TURN: "It's not your turn",
  WRONG_PHASE: 'Throw first, then draw', NOT_OWNED: "That card isn't in your hand", BAD_THROW: 'Throw one card, a set (same rank) or a run (3+ in a row, same suit)',
  NOT_PICKABLE: "You can only take a card the previous player threw", TOO_MANY_POINTS: 'Jhyap needs 10 points or less',
  GAME_NOT_RUNNING: 'This game is over', RATE_LIMIT: 'Slow down a little', SERVER_FULL: 'Server is busy, try again soon',
  SERVER_ERROR: 'Something went wrong', BAD_REQUEST: "That move wasn't valid", NO_CARDS: 'No cards left to draw',
};
const net = window.claude && window.claude.raw;

let S = null, me = null, pending = null, kicked = false, wantResume = true, watching = false;
let lastEvId = null, deadlineAt = 0, turnKey = '', sel = new Set(), drag = null, noClick = false;
// animation state: cards on their way somewhere stay invisible in their final spot until the flying copy lands
let deal = null, incoming = new Set(), hideMine = new Set(), myRects = {};

// ---------- helpers ----------
const toast = t => { const e = $('toast'); e.textContent = t; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 2600); };
const rid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); };
const tabStore = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} }, del: k => { try { sessionStorage.removeItem(k); } catch (e) {} } };
const parseSess = raw => { try { const s = JSON.parse(raw || 'null'); return s && /^[A-Z0-9]{5}$/.test(s.code) && typeof s.token == 'string' && Date.now() - s.t < 12 * 36e5 ? s : null; } catch (e) { return null; } };
const tabSess = () => parseSess(tabStore.get(SKEY)), anySess = () => parseSess(store.get(SKEY));
const saveSess = (code, token) => { const v = JSON.stringify({ code, token, t: Date.now() }); tabStore.set(SKEY, v); store.set(SKEY, v); };
const clearSess = () => { const own = tabSess(), any = anySess(); tabStore.del(SKEY); if (!own || (any && any.token === own.token)) store.del(SKEY); };
const send = o => { if (!net || !net.send(o)) toast('Offline · reconnecting…'); };
const nameOf = pid => pid === me ? 'You' : (S && S.room.names[pid]) || 'Player';
const colorOf = pid => { const i = S ? Object.keys(S.room.names).indexOf(pid) : 0; return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const avatarOf = pid => { let h = 7; for (const ch of String(pid || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AV[h % AV.length]; };
const pts = n => (n > 0 ? '+' : '') + n;
async function copy(t) { try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); try { document.execCommand('copy'); } catch (e2) {} a.remove(); } toast('Copied!'); }
function show(id, on) { $(id).style.display = on ? 'flex' : 'none'; }
const buzz = ms => { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (e) {} };
function cardEl(c, tag = 'div') {
  const e = document.createElement(tag), r = c.slice(0, -1), s = c.slice(-1);
  e.className = 'pc' + (s == 'H' || s == 'D' ? ' red' : ''); e.setAttribute('aria-label', r + ' of ' + SUIT_NAME[s]);
  e.innerHTML = '<span class="r"></span><span class="s1"></span><span class="s2"></span>';
  e.querySelector('.r').textContent = r; e.querySelector('.s1').textContent = SUIT[s]; e.querySelector('.s2').textContent = SUIT[s];
  if (tag == 'button') e.type = 'button';
  return e;
}
const flipIn = (el, delay = 0) => el.animate([{ transform: 'rotateY(90deg)' }, { transform: 'none' }], { duration: 260, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });

// ---------- networking ----------
function act(move) {
  const g = S && S.game; if (!g || pending) return;
  pending = rid(); render();
  send({ t: P + 'act', v: g.version, aid: pending, move });
  setTimeout(() => { if (pending) { pending = null; send({ t: P + 'sync' }); render(); } }, 4000);
}
function onMsg(m) {
  if (m.t == 'welcome') {
    $('onl').textContent = ''; $('bCreate').disabled = $('bJoin').disabled = false;
    const own = tabSess(), other = anySess();
    if (own && wantResume && !kicked) send({ t: P + 'resume', code: own.code, token: own.token });
    else if (other && !S) showResume(other);
    watching = false; setWatch(!S); return;
  }
  if (!m.t.startsWith(P)) return;
  const t = m.t.slice(P.length);
  if (t == 'rooms') return renderRooms(Array.isArray(m.rooms) ? m.rooms : []);
  if (t == 'joined') { me = m.pid; saveSess(m.code, m.token); kicked = false; wantResume = true; try { history.replaceState(null, '', location.pathname); } catch (e) {} if (m.resumed) toast('Back at the table'); }
  else if (t == 'state') {
    const prevVer = S && S.game && S.game.version;
    S = m; me = m.you;
    if (pending && (!S.game || S.game.version !== prevVer)) pending = null;
    if (S.game) { deadlineAt = Date.now() + S.game.timeLeft; const h = S.game.you ? S.game.you.hand : []; sel = new Set([...sel].filter(c => h.includes(c))); }
    render();
  } else if (t == 'err') {
    if (m.code == 'SESSION_EXPIRED') { clearSess(); S = null; render(); toast('That room is no longer available'); return; }
    if (m.code == 'STALE') return;
    pending = null; toast(ERR[m.code] || 'Error: ' + m.code); buzz([30, 40, 30]); render();
  } else if (t == 'kicked') { kicked = true; S = null; render(); toast('This room was opened in another tab'); tabStore.del(SKEY); const s = anySess(); if (s) showResume(s); }
  else if (t == 'left') { S = null; render(); }
}

// ---------- rendering ----------
function render() {
  const st = S ? S.room.status : 'none';
  show('landing', !S); setWatch(!S); show('lobby', st == 'lobby');
  $('jtable').style.visibility = S && S.game ? 'visible' : 'hidden';
  if (!S) { lastEvId = null; return; }
  if (st == 'lobby') renderLobby();
  const fresh = takeFresh(); prepare(fresh);
  if (S.game) renderTable();
  play(fresh);
}

function renderLobby() {
  const R = S.room, L = $('lseats'), host = R.hostPid === me, mine = R.players.find(p => p.pid === me);
  $('rcode').textContent = R.code; L.textContent = '';
  R.players.forEach(p => {
    const b = document.createElement('div'); b.className = 'seat' + (p.connected ? '' : ' off'); b.style.setProperty('--c', colorOf(p.pid));
    const i = document.createElement('i'), n = document.createElement('span'), e = document.createElement('em');
    i.className = 'av'; i.textContent = avatarOf(p.pid); n.textContent = p.pid === me ? p.name + ' (you)' : p.name;
    if (p.pid === R.hostPid) { const h = document.createElement('small'); h.className = 'host'; h.textContent = '👑 host'; n.append(h); }
    e.textContent = !p.connected ? 'Offline' : p.pid === R.hostPid ? 'Host' : p.ready ? 'Ready ✓' : 'Not ready';
    b.append(i, n, e); L.append(b);
  });
  for (let k = R.players.length; k < R.minPlayers; k++) { const b = document.createElement('div'); b.className = 'seat off'; b.innerHTML = '<i></i><span>Waiting for a player…</span>'; L.append(b); }
  $('lvis').classList.toggle('ro', !host);
  $('lvis').querySelectorAll('button').forEach(b => { const v = b.dataset.l == '1'; b.classList.toggle('on', v === !!R.listed); b.disabled = !host;
    b.onclick = () => { if (host && v !== !!R.listed) { sfx.tick(); send({ t: P + 'opts', listed: v }); toast(v ? 'Public — anyone can see this room' : 'Friends only — join with the code'); } }; });
  $('lready').style.display = host ? 'none' : ''; $('lready').classList.toggle('on', !!(mine && mine.ready));
  $('lready').textContent = mine && mine.ready ? 'Ready ✓ (tap to undo)' : "I'm ready";
  const others = R.players.filter(p => p.pid !== R.hostPid), canStart = R.players.length >= R.minPlayers && others.every(p => p.ready && p.connected);
  $('lstart').style.display = host ? '' : 'none'; $('lstart').disabled = !canStart;
  $('lnote').textContent = host ? (R.players.length < R.minPlayers ? 'Share the code — 2 to 5 players' : canStart ? 'Everyone is ready!' : 'Waiting for everyone to be ready…') : 'Waiting for the host to start…';
}

function renderTable() {
  const g = S.game, R = S.room, you = g.you, over = g.status == 'over', o = you ? you.options : {};
  const myTurn = !over && g.current === me, ptsOf = pid => (R.players.find(p => p.pid === pid) || {}).points || 0;
  $('rinfo').textContent = `Game ${R.gameNo} · Jhyap at ${g.showMax} points or less`;
  // seats round the table (everyone but me)
  const felt = $('seats'); felt.textContent = '';
  const order = g.players.map(p => p.pid), at = Math.max(0, order.indexOf(me));
  const others = g.players.slice(at).concat(g.players.slice(0, at)).filter(p => p.pid !== me);
  others.forEach((p, i) => {
    const a = Math.PI + (i + 1) / (others.length + 1) * Math.PI, x = 50 + 44 * Math.cos(a), y = 58 + 42 * Math.sin(a);
    const d = document.createElement('div'); d.className = 'st' + (g.current === p.pid && !over ? ' on' : '') + (!p.active ? ' packed' : '') + (over && g.result && g.result.winner === p.pid ? ' win' : '');
    d.dataset.pid = p.pid; d.style.left = x + '%'; d.style.top = y + '%'; d.style.setProperty('--c', colorOf(p.pid));
    const av = document.createElement('div'); av.className = 'av'; av.textContent = avatarOf(p.pid);
    const nm = document.createElement('b'); nm.textContent = nameOf(p.pid);
    const fan = document.createElement('div'); fan.className = 'fan'; for (let k = 0, n = deal ? deal.seats[p.pid] || 0 : p.cards; k < n; k++) fan.append(document.createElement('span'));
    const pt = document.createElement('div'); pt.className = 'pts'; pt.textContent = pts(ptsOf(p.pid)) + ' pts';
    d.append(av, nm, fan, pt);
    if (p.pid === g.dealer) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'dealer'; d.append(t); }
    felt.append(d);
  });
  // deck + the throw you may pick from
  const drawPhase = myTurn && g.phase == 'draw' && !pending;
  $('stock').className = 'pc down' + (g.stockCount > 1 ? ' stack' : '') + (drawPhase ? ' can' : '');
  $('stockN').textContent = 'Deck · ' + g.stockCount;
  const T = $('throws'); T.textContent = '';
  const showCards = drawPhase ? g.pickable : (g.pileTop[g.pileTop.length - 1] || []);
  showCards.forEach(c => {
    const e = cardEl(c, drawPhase ? 'button' : 'div'); e.dataset.card = c; if (incoming.has(c)) e.classList.add('incoming');
    if (drawPhase && o.pick.includes(c)) { e.classList.add('pick'); e.onclick = () => { sfx.tick(); act({ type: 'draw', source: 'pile', card: c }); }; }
    T.append(e);
  });
  const lt = g.lastThrow;
  $('throwN').textContent = drawPhase ? (g.turn === 1 ? 'Take the open card' : `Take one of ${nameOf(prevOf(g))}'s cards`) : lt ? `${nameOf(lt.pid)} threw ${lt.kind == 'set' ? 'a set' : lt.kind == 'run' ? 'a run' : ''}`.trim() : 'Open card';
  // me
  $('mypts').textContent = you ? `Your hand: ${you.total} point${you.total == 1 ? '' : 's'}` : 'Watching';
  $('mystate').textContent = you ? pts(ptsOf(me)) + ' pts' : '';
  $('jhyap').style.display = myTurn && o.show && !pending ? 'block' : 'none';
  const H = $('hand'), prev = new Map([...H.querySelectorAll('.pc')].map(e => [e.dataset.card, e.getBoundingClientRect()])); H.textContent = '';
  if (you) you.hand.forEach((c, idx) => {
    const e = cardEl(c, 'button'); e.dataset.card = c; if (sel.has(c)) e.classList.add('sel');
    if (hideMine.has(c) || (deal && idx >= deal.mine)) e.classList.add('undealt');
    const v = document.createElement('span'); v.className = 'pv'; v.textContent = val(c); e.append(v);
    e.onclick = () => { if (noClick || deal) return; sel.has(c) ? sel.delete(c) : sel.add(c); sfx.tick(); render(); };
    e.onpointerdown = ev => beginDrag(ev, c, e);
    H.append(e);
  });
  H.querySelectorAll('.pc').forEach(e => { const p = prev.get(e.dataset.card); if (!p) return; const r = e.getBoundingClientRect(), dx = p.left - r.left, dy = p.top - r.top;
    if (Math.abs(dx) + Math.abs(dy) > 1) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }); });
  // hint + throw button
  const hint = $('hint'); hint.textContent = '';
  if (over) hint.textContent = '';
  else if (!myTurn) hint.textContent = `${nameOf(g.current)}'s turn…`;
  else if (g.phase == 'throw') {
    if (sel.size) { const b = document.createElement('button'); b.className = 'go'; b.id = 'throwBtn'; b.textContent = `Throw ${sel.size} card${sel.size > 1 ? 's' : ''}`; b.onclick = throwSel; hint.append(b, document.createTextNode(' or drag them up'));
    } else hint.textContent = o.show ? 'Call Jhyap — or pick cards to throw: one card, a set or a run' : 'Pick cards to throw: one card, a set (same rank) or a run (3+ in a row, same suit)';
  } else hint.textContent = 'Now take a card: tap the deck or one of the thrown cards';
  renderReveal(g, R);
  const tk = g.turn + ':' + g.current + ':' + g.phase;
  if (tk !== turnKey) { turnKey = tk; if (myTurn && g.phase == 'throw') { sfx.chime(); buzz(20); } }
}
const prevOf = g => { const a = g.players.filter(p => p.active).map(p => p.pid), i = a.indexOf(g.current); return a[(i - 1 + a.length) % a.length]; };
function throwSel() {
  if (!sel.size || pending || deal) return; const cs = [...sel]; sel.clear();
  myRects = {}; cs.forEach(c => { const e = $('hand').querySelector('[data-card="' + c + '"]'); if (e) myRects[c] = e.getBoundingClientRect(); });
  sfx.tick(); act({ type: 'throw', cards: cs });
}
$('jhyap').onclick = () => { if (!pending) { sfx.chime(); buzz([20, 40, 20]); act({ type: 'show' }); } };
$('stock').onclick = () => { const g = S && S.game; if (g && g.current === me && g.phase == 'draw') { sfx.tick(); act({ type: 'draw', source: 'stock' }); } };

// After a Jhyap: every hand face up with its points and who pays whom, so everyone can check it.
let revealKey = '';
function renderReveal(g, R) {
  const X = $('reveal'), r = g.result;
  if (g.status != 'over' || !r) { X.textContent = ''; revealKey = ''; return; }
  const mine = R.players.find(p => p.pid === me), key = R.gameNo + ':' + (mine && mine.ready);
  if (key === revealKey) return; revealKey = key; X.textContent = '';
  const t = document.createElement('div'); t.className = 'rt';
  t.textContent = r.reason == 'jhyap' ? `${nameOf(r.caller)} called Jhyap and ${r.caller === me ? 'win' : 'wins'}!` : r.reason == 'caught' ? `${nameOf(r.caller)} called Jhyap — but ${nameOf(r.winner)} ${r.winner === me ? 'have' : 'has'} as low or lower!` : 'Game over';
  X.append(t);
  const row = document.createElement('div'); row.className = 'rv'; X.append(row);
  Object.keys(r.hands || {}).forEach((pid, i) => {
    const box = document.createElement('div'); box.className = 'rh ' + (pid === r.winner ? 'win' : 'lose'); box.style.setProperty('--c', colorOf(pid));
    const who = document.createElement('b'); who.textContent = avatarOf(pid) + ' ' + nameOf(pid) + (pid === r.caller ? ' · Jhyap' : '');
    const cs = document.createElement('div'); cs.className = 'cs'; r.hands[pid].forEach((c, k) => { const e = cardEl(c); flipIn(e, 150 + i * 200 + k * 70); cs.append(e); });
    const tot = document.createElement('span'); tot.className = 'tot'; tot.textContent = r.totals[pid] + ' pts';
    const pay = document.createElement('span'); const d = r.pay[pid] || 0; pay.className = 'pay ' + (d > 0 ? 'plus' : d < 0 ? 'minus' : ''); pay.textContent = d ? pts(d) : '±0';
    box.append(who, cs, tot, pay); row.append(box);
  });
  const ag = document.createElement('div'); ag.className = 'again';
  const nb = document.createElement('button'); nb.className = 'go'; nb.style.width = 'auto'; nb.style.padding = '11px 24px';
  nb.textContent = mine && mine.ready ? 'Waiting for others… (tap to cancel)' : 'Next game';
  nb.onclick = () => { sfx.tick(); send({ t: P + 'ready', ready: !(mine && mine.ready) }); };
  const lb = document.createElement('button'); lb.className = 'pill'; lb.textContent = 'Leave'; lb.onclick = leave;
  ag.append(nb, lb); X.append(ag);
  const tbl = document.createElement('div'); tbl.className = 'rnote';
  tbl.textContent = 'Points so far: ' + R.players.slice().sort((a, b) => b.points - a.points).map(p => `${p.name} ${pts(p.points)}`).join(' · ');
  X.append(tbl);
}

// ---------- gesture: drag your selected cards up onto the table to throw them ----------
function beginDrag(e, c, el) {
  const g = S && S.game; if (!g || g.current !== me || g.phase != 'throw' || pending) return;
  drag = { c, el, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
}
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y0, dx = e.clientX - drag.x0;
  if (!drag.moved && Math.hypot(dx, dy) < 10) return;
  if (!drag.moved) { drag.moved = true; if (!sel.has(drag.c)) { sel.add(drag.c); } document.querySelectorAll('#hand .pc.sel').forEach(x => x.style.transition = 'none'); }
  document.querySelectorAll('#hand .pc.sel').forEach(x => { x.style.transform = `translate(${dx}px,${dy}px)`; });
  $('felt').classList.toggle('hot', e.clientY < $('hand').getBoundingClientRect().top - 20);
}, { passive: true });
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null; $('felt').classList.remove('hot');
  if (!d.moved) return;
  noClick = true; setTimeout(() => { noClick = false; }, 50);
  const up = e.type == 'pointerup' && e.clientY < $('hand').getBoundingClientRect().top - 20;
  if (up) throwSel(); else render();
}
addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);

// ---------- animations: deal, throws, draws, Jhyap payouts ----------
// events that happened since the last update (none on first view / rejoin, so nothing is replayed)
function takeFresh() {
  const h = S.room.history; if (!h.length) return [];
  const newest = h[h.length - 1].id;
  if (lastEvId == null || newest < lastEvId || newest - lastEvId > 14) { lastEvId = newest; return []; }
  const fresh = h.filter(e => e.id > lastEvId); lastEvId = newest; return fresh;
}
// before drawing: decide which cards must stay hidden until their flying copy arrives
function prepare(fresh) {
  const g = S.game; if (!g) return;
  for (const e of fresh) {
    if (e.type == 'GAME_STARTED') {
      const n = e.players.length, di = e.players.indexOf(e.dealer), order = [];
      for (let k = 0; k < 5; k++) for (let i = 1; i <= n; i++) order.push(e.players[(di + i) % n]);
      deal = { order, mine: 0, seats: {}, open: e.open }; incoming.add(e.open); sel.clear();
    }
    if (e.type == 'THREW') e.cards.forEach(c => incoming.add(c));
    if (e.type == 'DREW' && e.pid === me) { const c = e.card || (g.lastDraw && g.lastDraw.pid === me && g.lastDraw.card); if (c) hideMine.add(c); }
  }
  if (incoming.size || hideMine.size) { clearTimeout(prepare.t); prepare.t = setTimeout(() => { incoming.clear(); hideMine.clear(); render(); }, 3500); }   // never stay hidden
}
const rectOf = el => el && el.getBoundingClientRect();
const seatRect = pid => pid === me ? rectOf($('hand')) : rectOf(document.querySelector('.st[data-pid="' + pid + '"]')) || rectOf($('center'));
const pileSpot = c => rectOf($('throws').querySelector('[data-card="' + c + '"]')) || rectOf($('throws'));
const handSpot = c => $('hand').querySelector('[data-card="' + c + '"]');
function backEl() { const e = document.createElement('div'); e.className = 'pc down'; return e; }
// a card (or a card back) flies in an arc from one place to another
function fly(card, from, to, o = {}) {
  if (!from || !to) { if (o.done) o.done(); return; }
  const w = $('stock').getBoundingClientRect().width, el = card ? cardEl(card) : backEl();
  el.classList.add('fly'); el.style.width = w + 'px'; el.style.height = w * 1.4 + 'px';
  el.style.left = from.left + from.width / 2 - w / 2 + 'px'; el.style.top = from.top + from.height / 2 - w * .7 + 'px';
  document.body.append(el);
  const tx = to.left + to.width / 2 - (from.left + from.width / 2), ty = to.top + to.height / 2 - (from.top + from.height / 2);
  const end = o.scale != null ? o.scale : Math.max(.5, Math.min(1.5, to.width / w)), spin = o.spin != null ? o.spin : (tx > 0 ? 12 : -12);
  el.animate([{ transform: `scale(${o.grow ? .6 : 1})`, opacity: o.grow ? .7 : 1 },
    { transform: `translate(${tx * .5}px,${ty * .5 - 34}px) scale(1.08) rotate(${spin}deg)`, opacity: 1, offset: .5 },
    { transform: `translate(${tx}px,${ty}px) scale(${end}) rotate(0deg)`, opacity: o.fade ? .2 : 1 }],
    { duration: o.ms || 430, delay: o.delay || 0, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' }).onfinish = () => { el.remove(); if (o.done) o.done(); };
}
const land = el => el && el.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(.96)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
function coins(from, to, n, delay = 0) {
  for (let i = 0; i < n; i++) { const c = document.createElement('div'); c.className = 'coin';
    const f = { left: from.left + from.width / 2 - 11 + (Math.random() - .5) * 30, top: from.top + from.height / 2 - 11, width: 22, height: 22 };
    c.style.left = f.left + 11 + 'px'; c.style.top = f.top + 11 + 'px'; document.body.append(c);
    const tx = to.left + to.width / 2 - f.left - 11, ty = to.top + to.height / 2 - f.top - 11;
    c.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: `translate(calc(-50% + ${tx * .5}px), calc(-50% + ${ty * .5 - 50}px)) scale(1.1)`, opacity: 1, offset: .45 },
      { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(.8)`, opacity: .9 }], { duration: 650, delay: delay + i * 70, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' }).onfinish = () => c.remove(); }
}
function runDeal() {
  const d = deal, stock = rectOf($('stock')), total = d.order.length, step = Math.min(95, 2200 / total);
  d.order.forEach((pid, k) => {
    const mineIdx = d.order.slice(0, k).filter(p => p === me).length;
    const slot = pid === me ? $('hand').querySelectorAll('.pc')[mineIdx] : null;
    fly(null, stock, pid === me ? rectOf(slot) : seatRect(pid), { delay: 300 + k * step, ms: 360, scale: pid === me ? undefined : .5, fade: pid !== me, done: () => {
      if (deal !== d) return;
      if (pid === me) { const el = $('hand').querySelectorAll('.pc')[d.mine++]; if (el) { el.classList.remove('undealt'); flipIn(el); } }
      else { d.seats[pid] = (d.seats[pid] || 0) + 1; const f = document.querySelector('.st[data-pid="' + pid + '"] .fan'); if (f) f.append(document.createElement('span')); }
      if (k % 3 == 0) sfx.tok(0, .05, 230 + (k % 4) * 30);
      if (k === total - 1) setTimeout(() => {   // finally the open card is turned up on the pile
        if (deal !== d) return; deal = null; incoming.delete(d.open); render();
        const e = $('throws').querySelector('[data-card="' + d.open + '"]'); if (e) flipIn(e); sfx.chime();
      }, 380);
    } });
  });
}
function play(fresh) {
  if (!S || !S.game) return;
  let t = 0;
  for (const e of fresh) {
    if (e.type == 'GAME_STARTED' && deal) runDeal();
    else if (e.type == 'THREW') {
      e.cards.forEach((c, k) => {
        const from = e.pid === me && myRects[c] ? myRects[c] : seatRect(e.pid);
        fly(c, from, pileSpot(c), { delay: t + k * 90, grow: e.pid !== me, done: () => { incoming.delete(c); const el = $('throws').querySelector('[data-card="' + c + '"]'); if (el) { el.classList.remove('incoming'); land(el); } } });
      });
      if (e.pid !== me) setTimeout(() => sfx.tick(), t);
      t += 160 + e.cards.length * 90;
    } else if (e.type == 'DREW') {
      const src = e.source == 'stock' ? rectOf($('stock')) : rectOf($('throws'));
      if (e.pid === me) {
        const c = e.card || (S.game.lastDraw && S.game.lastDraw.card), el = c && handSpot(c);
        fly(e.source == 'pile' ? c : null, src, rectOf(el), { delay: t, done: () => { hideMine.delete(c); const x = c && handSpot(c); if (x) { x.classList.remove('undealt'); if (e.source == 'stock') flipIn(x); else land(x); } } });
      } else fly(e.card || null, src, seatRect(e.pid), { delay: t, scale: .5, fade: true, done: () => sfx.tick() });
      t += 200;
    } else if (e.type == 'JHYAP') toast(`${nameOf(e.pid)} called Jhyap with ${e.total} points!`);
    else if (e.type == 'GAME_ENDED') {
      const r = S.game.result;
      if (r && r.winner) {   // the losers' points pour over to the winner
        const to = seatRect(r.winner);
        Object.entries(r.pay || {}).filter(([, d]) => d < 0).forEach(([pid, d], i) => coins(seatRect(pid), to, Math.min(10, 3 + Math.round(-d / 8)), 700 + i * 250));
        const ws = document.querySelector('.st[data-pid="' + r.winner + '"]');
        if (ws) ws.animate([{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.18)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 600, delay: 900 });
      }
      if (e.winner === me) sfx.win(); else sfx.chime();
    } else if (e.type == 'TIMED_OUT' && e.pid === me) toast('Time ran out — your highest card was thrown');
  }
}
(function loop() {
  requestAnimationFrame(loop);
  if (!S || !S.game) return;
  const g = S.game, left = Math.max(0, deadlineAt - Date.now()), on = document.querySelector('.st.on .av');
  if (on) { on.style.setProperty('--t', (1 - left / g.turnMs).toFixed(3)); on.classList.toggle('hurry', left < 8000); }
  if (g.status == 'playing' && g.current === me && g.you) $('mystate').textContent = Math.ceil(left / 1000) + 's';
})();

// ---------- open rooms + lobby / landing ----------
function setWatch(on) { if (on === watching || !net || !net.online()) return; watching = on; send({ t: P + 'watch', on }); }
function renderRooms(list) {
  const L = $('rooms'); L.textContent = ''; if (!list.length) return;
  L.append(Object.assign(document.createElement('div'), { className: 'sub', textContent: 'Open rooms', style: 'margin:14px 0 0' }));
  list.forEach(r => { const d = document.createElement('div'); d.className = 'rm'; const t = document.createElement('span'); t.textContent = r.host + "'s table · " + r.players + '/' + r.max;
    const b = document.createElement('button'); b.className = 'pill'; b.textContent = 'Join'; b.onclick = () => { $('code').value = r.code; $('bJoin').onclick(); }; d.append(t, b); L.append(d); });
}
const nickOk = () => { const v = $('nick').value.trim(); if (v) { store.set('ludo3d.nick', v); return v; } toast('Enter your name first'); $('nick').focus(); return null; };
$('nick').value = store.get('ludo3d.nick') || '';
$('bCreate').onclick = () => { const n = nickOk(); if (n) { sfx.tick(); wantResume = true; send({ t: P + 'create', name: n }); } };
$('bJoin').onclick = () => { const n = nickOk(), c = $('code').value.trim().toUpperCase(); if (!n) return; if (!/^[A-Z0-9]{5}$/.test(c)) return toast('Enter the 5-character code'); sfx.tick(); wantResume = true; send({ t: P + 'join', code: c, name: n }); };
$('code').onkeydown = e => { if (e.key == 'Enter') $('bJoin').onclick(); };
$('cCode').onclick = () => copy(S.room.code); $('cLink').onclick = () => copy(LINK + S.room.code);
$('lready').onclick = () => { const p = S.room.players.find(x => x.pid === me); sfx.tick(); send({ t: P + 'ready', ready: !(p && p.ready) }); };
$('lstart').onclick = () => { sfx.tick(); send({ t: P + 'start' }); };
const leave = () => { send({ t: P + 'leave' }); clearSess(); S = null; show('qconf', false); render(); };
$('lleave').onclick = leave;
$('qbtn').onclick = () => show('qconf', true); $('qno').onclick = () => show('qconf', false); $('qyes').onclick = leave;
const paintSnd = () => { $('snd').textContent = snd ? '🔊' : '🔇'; }; paintSnd();
$('snd').onclick = () => { snd = !snd; store.set('ludo3d.sfx', snd ? '1' : '0'); paintSnd(); };
function showResume(s) { const r = $('resume'); r.style.display = 'flex'; $('rtxt').textContent = 'Table ' + s.code;
  $('rgo').onclick = () => { r.style.display = 'none'; kicked = false; wantResume = true; send({ t: P + 'resume', code: s.code, token: s.token }); };
  $('rno').onclick = () => { r.style.display = 'none'; clearSess(); }; }

const inv = (location.hash.match(/room=([A-Za-z0-9]{5})/) || [])[1];
if (inv) { $('code').value = inv.toUpperCase(); if (!tabSess()) toast('Enter your name to join table ' + inv.toUpperCase()); }
addEventListener('net', e => { if (e.detail == 'down' && S) toast('Connection lost · reconnecting…'); });
render();
if (!net) { $('onl').textContent = 'Online play is unavailable right now. Try reloading.'; return; }
net.on(onMsg);
if (net.online()) onMsg({ t: 'welcome' });
})();
