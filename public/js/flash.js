// Flash client: draws whatever state the server sends and sends the player's intents.
// No game logic and never trusted: the server owns the deck, every hand (yours too, until you
// look), the chips, whose turn it is and who wins. Chips are play money with no real value.
(() => {
const $ = id => document.getElementById(id);
const P = 'fl:', SKEY = 'flash.session', LINK = location.origin + location.pathname + '#room=';
const COLORS = ['#fbc916', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f97316'];
const AV = ['🦊', '🐼', '🐯', '🐸', '🐵', '🦁', '🐨', '🐰', '🐧', '🐙', '🦄', '🐻', '🐶', '🐱', '🐮', '🐷', '🐲', '🦉'];
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' }, SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const ERR = {
  NAME_REQUIRED: 'Enter your name first', ROOM_NOT_FOUND: 'Room not found', ROOM_FULL: 'That room is full (6 players)',
  IN_PROGRESS: 'A round is being played — join when it ends', NOT_HOST: 'Only the host can do that', NOT_READY: 'Waiting for everyone to be ready',
  NOT_ENOUGH_PLAYERS: 'Need at least 2 players', PLAYER_OFFLINE: 'Someone is offline', NOT_YOUR_TURN: "It's not your turn",
  ILLEGAL_MOVE: "You can't do that now", NOT_ENOUGH_CHIPS: 'Not enough chips', PACKED: 'You packed this game', WAITING: 'Waiting for the side show answer',
  GAME_NOT_RUNNING: 'This game is over', RATE_LIMIT: 'Slow down a little', SERVER_FULL: 'Server is busy, try again soon',
  BAD_OPTION: 'That option is not available', SERVER_ERROR: 'Something went wrong', BAD_REQUEST: "That move wasn't valid",
  BAD_AMOUNT: 'Pick one of the amounts', BORROW_LIMIT: "That's more than you can still borrow this round", LENDER_LIMIT: "They can't lend that much",
  ALREADY_ASKED: 'You already asked someone — wait for their answer', ASK_A_PLAYER_FIRST: 'Ask a player first — the bank helps if they say no',
  ROUND_NOT_RUNNING: 'Sapati is only during a round',
};
const net = window.claude && window.claude.raw;

let S = null, me = null, pending = null, kicked = false, wantResume = true, watching = false;
let lastEvId = null, lastStatus = '', deadlineAt = 0, turnKey = '', wasSeen = false, lastGameNo = null;
let endShown = false, endTimer = 0;
const ROUND_END_DELAY = 5000;   // ms the last game's result stays on the table before the round results

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
const rs = n => 'Rs ' + (n ?? 0).toLocaleString('en-IN');
async function copy(t) { try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); try { document.execCommand('copy'); } catch (e2) {} a.remove(); } toast('Copied!'); }
function show(id, on) { $(id).style.display = on ? 'flex' : 'none'; }
const seatEl = pid => document.querySelector('.st[data-pid="' + pid + '"]');
const placeOf = pid => (pid === me ? $('hand') : seatEl(pid) || $('pot')).getBoundingClientRect();

function cardEl(c) {
  const e = document.createElement('div'), r = c.slice(0, -1), s = c.slice(-1);
  e.className = 'pc' + (s == 'H' || s == 'D' ? ' red' : '');
  e.setAttribute('aria-label', r + ' of ' + SUIT_NAME[s]);
  e.innerHTML = '<span class="r"></span><span class="s1"></span><span class="s2"></span>';
  e.querySelector('.r').textContent = r; e.querySelector('.s1').textContent = SUIT[s]; e.querySelector('.s2').textContent = SUIT[s];
  return e;
}
const backEl = () => { const e = document.createElement('div'); e.className = 'pc down'; return e; };
const flipIn = (el, delay = 0) => el.animate([{ transform: 'rotateY(90deg)' }, { transform: 'none' }], { duration: 260, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
function fly(el, from, to, ms = 420, done) {
  el.style.left = from.left + from.width / 2 + 'px'; el.style.top = from.top + from.height / 2 + 'px'; document.body.append(el);
  const tx = to.left + to.width / 2 - (from.left + from.width / 2), ty = to.top + to.height / 2 - (from.top + from.height / 2);
  el.animate([{ transform: 'translate(-50%,-50%) scale(.8)' }, { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1)` }],
    { duration: ms, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }).onfinish = () => { el.remove(); if (done) done(); };
}
const coins = (from, to, n = 4) => { for (let i = 0; i < n; i++) setTimeout(() => { const c = document.createElement('div'); c.className = 'coin'; fly(c, from, to, 480); }, i * 70); };

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
    watching = false; setWatch(!S);
    return;
  }
  if (!m.t.startsWith(P)) return;
  const t = m.t.slice(P.length);
  if (t == 'rooms') return renderRooms(Array.isArray(m.rooms) ? m.rooms : []);
  if (t == 'joined') {
    me = m.pid; saveSess(m.code, m.token); kicked = false; wantResume = true;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    if (m.resumed) toast('Back at the table');
  } else if (t == 'state') {
    const prevVer = S && S.game && S.game.version;
    S = m; me = m.you;
    if (pending && (!S.game || S.game.version !== prevVer)) pending = null;
    if (S.game) deadlineAt = Date.now() + S.game.timeLeft;
    render();
  } else if (t == 'err') {
    if (m.code == 'SESSION_EXPIRED') { clearSess(); S = null; render(); toast('That room is no longer available'); return; }
    if (m.code == 'STALE') return;
    pending = null; toast(ERR[m.code] || 'Error: ' + m.code); render();
  } else if (t == 'kicked') {
    kicked = true; S = null; render(); toast('This room was opened in another tab'); tabStore.del(SKEY); const s = anySess(); if (s) showResume(s);
  } else if (t == 'left') { S = null; render(); }
}

// ---------- rendering ----------
function render() {
  const st = S ? S.room.status : 'none';
  // The round results wait a few seconds after a live round ends, so the 10th game's result (and any
  // Show on the table) can be seen first. Reloading into a finished round shows them straight away.
  if (st != 'over') { endShown = false; clearTimeout(endTimer); endTimer = 0; }
  else if (!endShown && !endTimer) {
    if (lastStatus == 'playing') endTimer = setTimeout(() => { endTimer = 0; endShown = true; render(); }, ROUND_END_DELAY);
    else endShown = true;
  }
  show('landing', !S); setWatch(!S); show('lobby', st == 'lobby'); show('end', st == 'over' && endShown);
  $('jtable').style.visibility = S && S.game ? 'visible' : 'hidden';
  if (!S) { lastStatus = ''; lastEvId = null; return; }
  if (st == 'lobby') renderLobby();
  if (S.game) renderTable();
  renderSapati();
  animateEvents();
  if (st == 'over') renderEnd();
  lastStatus = st;
}

function renderLobby() {
  const R = S.room, L = $('lseats'), host = R.hostPid === me, mine = R.players.find(p => p.pid === me);
  $('rcode').textContent = R.code; L.textContent = '';
  R.players.forEach(p => {
    const b = document.createElement('div'); b.className = 'seat' + (p.connected ? '' : ' off'); b.style.setProperty('--c', colorOf(p.pid));
    const i = document.createElement('i'), n = document.createElement('span'), e = document.createElement('em');
    i.className = 'av'; i.textContent = avatarOf(p.pid);
    n.textContent = p.pid === me ? p.name + ' (you)' : p.name;
    if (p.pid === R.hostPid) { const h = document.createElement('small'); h.className = 'host'; h.textContent = '👑 host'; n.append(h); }
    e.textContent = !p.connected ? 'Offline' : p.pid === R.hostPid ? 'Host' : p.ready ? 'Ready ✓' : 'Not ready';
    b.append(i, n, e); L.append(b);
  });
  for (let k = R.players.length; k < R.minPlayers; k++) { const b = document.createElement('div'); b.className = 'seat off'; b.innerHTML = '<i></i><span>Waiting for a player…</span>'; L.append(b); }
  $('lrules').textContent = `Each round: ${R.gamesPerRound} games · ${rs(R.startingChips)} each · boot ${rs(R.boot)}`;
  $('lvis').classList.toggle('ro', !host);
  $('lvis').querySelectorAll('button').forEach(b => { const v = b.dataset.l == '1'; b.classList.toggle('on', v === !!R.listed); b.disabled = !host;
    b.onclick = () => { if (host && v !== !!R.listed) { sfx.tick(); send({ t: P + 'opts', listed: v }); toast(v ? 'Public — anyone can see this room' : 'Friends only — join with the code'); } }; });
  $('lready').style.display = host ? 'none' : ''; $('lready').classList.toggle('on', !!(mine && mine.ready));
  $('lready').textContent = mine && mine.ready ? 'Ready ✓ (tap to undo)' : "I'm ready";
  const others = R.players.filter(p => p.pid !== R.hostPid), canStart = R.players.length >= R.minPlayers && others.every(p => p.ready && p.connected);
  $('lstart').style.display = host ? '' : 'none'; $('lstart').disabled = !canStart;
  $('lnote').textContent = host ? (R.players.length < R.minPlayers ? 'Share the code — 2 to 6 players' : canStart ? 'Everyone is ready!' : 'Waiting for everyone to be ready…') : 'Waiting for the host to start…';
}

function renderTable() {
  const g = S.game, R = S.room, you = g.you, over = g.status == 'over', res = g.result;
  const myTurn = !over && you && g.current === me && !g.pending;
  $('rinfo').textContent = `Round ${R.round} · Game ${R.gameInRound}/${R.gamesPerRound}` + (R.status == 'over' ? ' · round over · results in a moment' : R.nextIn != null ? ` · next game in ${Math.ceil(R.nextIn / 1000)}s` : '');
  // seats: everyone except me, around the top of the table
  const felt = $('seats'); felt.textContent = '';
  const order = g.players.map(p => p.pid), at = Math.max(0, order.indexOf(me));
  const others = g.players.slice(at).concat(g.players.slice(0, at)).filter(p => p.pid !== me);
  others.forEach((p, i) => {
    const a = Math.PI + (i + 1) / (others.length + 1) * Math.PI, x = 50 + 44 * Math.cos(a), y = 58 + 42 * Math.sin(a);   // kept inside the table
    const d = document.createElement('div'); d.className = 'st' + (g.current === p.pid && !over ? ' on' : '') + (p.packed ? ' packed' : '') + (res && res.winner === p.pid ? ' win' : '');
    d.dataset.pid = p.pid; d.style.left = x + '%'; d.style.top = y + '%'; d.style.setProperty('--c', colorOf(p.pid));
    const av = document.createElement('div'); av.className = 'av'; av.textContent = avatarOf(p.pid);
    const nm = document.createElement('b'); nm.textContent = nameOf(p.pid);
    const ch = document.createElement('div'); ch.className = 'chips'; ch.textContent = rs(p.chips);
    const stt = document.createElement('span'); stt.className = 'state' + (p.packed ? ' packed' : p.seen ? ' seen' : ''); stt.textContent = p.packed ? 'packed' : p.seen ? 'seen' : 'blind';
    const bet = document.createElement('small'); bet.className = 'bet'; bet.textContent = 'in pot ' + rs(p.bet);
    d.append(av, nm, ch, stt, bet);
    const owes = owedBy(p.pid); if (owes) { const o = document.createElement('small'); o.className = 'owe'; o.textContent = '💰 owes ' + rs(owes); d.append(o); }
    // cards I'm allowed to see: shown at a Show, or theirs from my private side show
    const shown = res && res.shown && res.shown[p.pid], side = g.sideShow && g.sideShow.with === p.pid ? g.sideShow : null;
    const hand = shown ? shown.hand : side ? side.theirHand : null;
    if (hand) { const mini = document.createElement('div'); mini.className = 'mini'; hand.forEach(c => mini.append(cardEl(c))); d.append(mini);
      const hn = document.createElement('small'); hn.textContent = shown ? shown.name : side.theirName; d.append(hn); }
    if (p.pid === g.dealer) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'dealer'; d.append(t); }
    felt.append(d);
  });
  // pot + stake
  $('potv').textContent = rs(over && res ? res.pot : g.pot);
  $('stakev').textContent = over ? 'won' : `Blind ${rs(g.stake)} · Seen ${rs(g.stake * 2)}`;
  // banner: result / side show news
  let ban = '';
  if (over && res) {
    ban = (res.winner === me ? 'You win ' : nameOf(res.winner) + ' wins ') + rs(res.pot);
    if (res.reason == 'others-packed') ban += ' · everyone else packed';
    if (res.reason == 'show' && res.shown) ban += ' · ' + Object.entries(res.shown).map(([p, h]) => nameOf(p) + ': ' + h.name).join(' vs ');
  } else if (g.pending) ban = nameOf(g.pending.from) + ' asked ' + (g.pending.to === me ? 'you' : nameOf(g.pending.to)) + ' for a side show…';
  $('banner').textContent = ban;
  renderReveal(g, res);
  // me
  const mp = g.players.find(p => p.pid === me);
  $('mychips').textContent = mp ? rs(mp.chips) : 'Watching';
  const ms = $('mystate'); ms.className = mp && mp.seen ? 'seen' : ''; ms.textContent = !mp ? '' : mp.packed ? 'packed' : mp.seen ? 'seen' : 'blind';
  $('myname').textContent = you && you.handName ? you.handName : '';
  // my 3 cards: face down until I look (the server hasn't even sent them before that)
  const H = $('hand'); H.textContent = ''; H.classList.toggle('blind', !!(you && !you.hand));
  if (you) {
    if (you.hand) you.hand.forEach((c, i) => { const e = cardEl(c); H.append(e); if (!wasSeen) flipIn(e, i * 90); });
    else for (let i = 0; i < 3; i++) { const e = backEl(); e.title = 'Tap to see your cards'; H.append(e); }
    H.onclick = () => { if (you.options.see && !pending) { sfx.tick(); act({ type: 'see' }); } };
    wasSeen = !!you.hand;
  }
  // actions
  const A = $('acts'); A.textContent = '';
  const btn = (cls, label, sub, move) => { const b = document.createElement('button'); b.className = cls; b.innerHTML = label + (sub ? '<small></small>' : ''); if (sub) b.querySelector('small').textContent = sub;
    b.onclick = () => { if (!pending) { sfx.tick(); act(move); } }; A.append(b); return b; };
  if (you && !over && !mp.packed) {
    const o = you.options;
    if (myTurn) {
      btn('pack', 'Pack', null, { type: 'pack' });
      o.chaal.forEach((c, i) => btn(i ? 'raise' : 'bet', i ? 'Raise' : 'Chaal', rs(c.amount), { type: 'chaal', mult: c.mult }));
      if (o.show) btn('show', 'Show', rs(o.show.cost) + (o.show.allIn ? ' · all in' : ''), { type: 'show' });
      if (o.sideShow) btn('raise', 'Side show', rs(o.sideShow.cost) + ' · ' + nameOf(o.sideShow.to), { type: 'sideshow' });
      if (o.see) btn('', 'See cards', null, { type: 'see' });
    } else {
      if (o.see) btn('', 'See cards', null, { type: 'see' });
      const w = document.createElement('button'); w.className = 'wait'; w.disabled = true;
      w.textContent = g.pending ? (g.pending.from === me ? 'Waiting for ' + nameOf(g.pending.to) + '…' : 'Side show in progress…') : nameOf(g.current) + "'s turn…";
      A.append(w);
    }
  }
  // side show request for me
  show('sideq', !!(you && you.options.reply && !over));
  if (you && you.options.reply) {
    $('sqs').textContent = nameOf(g.pending.from) + ' wants to compare cards with you privately. The lower hand packs (on a tie, they pack).';
    $('sqyes').onclick = () => { sfx.tick(); act({ type: 'reply', accept: true }); };
    $('sqno').onclick = () => { sfx.tick(); act({ type: 'reply', accept: false }); };
  }
  // my private side-show result
  if (g.sideShow && g.sideShow.loser && sideToastKey !== g.version + ':' + g.sideShow.with) {
    sideToastKey = g.version + ':' + g.sideShow.with;
    toast('Side show: ' + nameOf(g.sideShow.with) + ' had ' + g.sideShow.theirName + (g.sideShow.loser === me ? ' — you pack' : ' — they pack'));
  }
  const tk = g.turn + ':' + g.current + ':' + (g.pending ? 1 : 0);
  if (tk !== turnKey) { turnKey = tk; if ((myTurn || (you && you.options.reply)) && !over) { sfx.chime(); try { if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(20); } catch (e) {} } }
}
let sideToastKey = '', revealKey = '', sideUntil = 0, sideKey = '';

// Cards laid face up in the middle of the table so everyone can check the result:
// at a Show (both hands, for everyone) and, privately, right after a side show you were in.
function renderReveal(g, res) {
  const R = $('reveal'), shown = res && res.shown;
  // a side show I was part of: show it to me for a few seconds
  const ss = g.sideShow, sk = ss ? g.dealer + ':' + ss.with + ':' + ss.loser : '';
  if (ss && sk !== sideKey) { sideKey = sk; sideUntil = Date.now() + 6000; setTimeout(render, 6100); }
  const side = !shown && ss && g.you && g.you.hand && Date.now() < sideUntil;
  let hands, title, note = '', key;
  if (shown) {
    key = 'show:' + S.room.gameNo;
    hands = Object.entries(shown).map(([pid, h]) => ({ pid, hand: h.hand, name: h.name, win: pid === res.winner }));
    hands.sort((a, b) => (a.pid === res.askedBy ? -1 : 1));   // the player who called the show first
    title = 'Show · ' + nameOf(res.askedBy) + (res.askedBy === me ? ' call' : ' calls') + ' it';
    note = res.tie ? 'Tie — the player who asked for the show loses' : '';
  } else if (side) {
    key = 'side:' + sideKey;
    hands = [{ pid: me, hand: g.you.hand, name: g.you.handName, win: ss.loser !== me }, { pid: ss.with, hand: ss.theirHand, name: ss.theirName, win: ss.loser === me }];
    title = 'Side show · only you two can see this';
    note = (ss.loser === me ? 'You pack' : nameOf(ss.with) + ' packs') + ' · on a tie the asker packs';
  }
  if (!hands) { R.textContent = ''; revealKey = ''; return; }
  if (key === revealKey) return;   // already on the table
  revealKey = key; R.textContent = '';
  const t = document.createElement('div'); t.className = 'rt'; t.textContent = title; R.append(t);
  const row = document.createElement('div'); row.className = 'rv'; R.append(row);
  hands.forEach((h, i) => {
    const box = document.createElement('div'); box.className = 'rh ' + (h.win ? 'win' : 'lose'); box.style.setProperty('--c', colorOf(h.pid));
    const who = document.createElement('b'); who.textContent = avatarOf(h.pid) + ' ' + nameOf(h.pid);
    const cs = document.createElement('div'); cs.className = 'cs';
    h.hand.forEach((c, k) => { const e = cardEl(c); flipIn(e, 200 + i * 350 + k * 110); cs.append(e); });
    const hn = document.createElement('span'); hn.className = 'hn'; hn.textContent = h.name;
    box.append(who, cs, hn);
    if (h.win) { const w = document.createElement('span'); w.className = 'badge'; w.textContent = shown ? '🏆 Wins ' + rs(res.pot) : '✓ Stays in'; box.append(w); }
    row.append(box);
  });
  if (note) { const n = document.createElement('div'); n.className = 'rnote'; n.textContent = note; R.append(n); }
}

function renderEnd() {
  const R = S.room, mine = R.players.find(p => p.pid === me);
  const fin = p => p.final ?? p.chips ?? 0;   // after sapati is paid back
  const st = R.players.slice().sort((a, b) => fin(b) - fin(a)), top = st.length ? fin(st[0]) : 0, winners = st.filter(p => fin(p) === top);
  $('etitle').textContent = winners.length > 1 ? 'Tie for the round!' : (winners[0] && winners[0].pid === me ? 'You win the round! 🎉' : (winners[0] ? winners[0].name + ' wins the round!' : 'Round over'));
  $('esub').textContent = `Round ${R.round} · ${R.gamesPerRound} games · chips reset next round`;
  const K = $('ranks'); K.textContent = '';
  st.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'rk' + (fin(p) === top ? ' w' : ''); d.style.animationDelay = i * .07 + 's'; d.style.setProperty('--c', colorOf(p.pid));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = avatarOf(p.pid) + ' ' + p.name + (p.pid === me ? ' (you)' : '');
    const sp = (p.lent || 0) - (p.borrowed || 0);
    const s = document.createElement('small'); s.textContent = rs(fin(p)) + (sp ? ` (chips ${rs(fin(p) - sp)} ${sp > 0 ? '+' : '−'} sapati ${rs(Math.abs(sp))})` : '') + ' · ' + p.score + ' round' + (p.score == 1 ? '' : 's') + (p.ready ? ' · ready ✓' : '');
    d.append(document.createElement('i'), n, s); K.append(d);
  });
  $('again').textContent = mine && mine.ready ? 'Waiting… (tap to cancel)' : 'Next round';
  const sl = R.sapati && R.sapati.settlement || [];
  $('enote').textContent = (sl.length ? 'Sapati paid back: ' + sl.map(l => `${nameOf(l.to)} → ${l.from === 'bank' ? 'bank' : nameOf(l.from)} ${rs(l.paid)}${l.paid < l.amount ? ' (short ' + rs(l.amount - l.paid) + ')' : ''}`).join(' · ') + '. ' : '') +
    'Everyone starts the next round with ' + rs(R.startingChips) + '. It starts when everyone is ready.';
}

// ---------- sapati (borrowing) ----------
let sapOpen = false, sapAmt = 0;
const owedBy = pid => S && S.room.sapati ? S.room.sapati.loans.filter(l => l.to === pid).reduce((a, l) => a + l.amount, 0) : 0;
const sap = o => send({ t: P + 'x', what: 'sapati', ...o });
function renderSapati() {
  const R = S.room, SP = R.sapati, running = R.status == 'playing', mp = R.players.find(p => p.pid === me);
  $('sapBtn').style.display = SP && SP.enabled && running && mp ? '' : 'none';
  if (!SP || !mp) { show('sap', false); show('sapq', false); return; }
  // a player asking ME to lend
  const q = running && SP.requests.find(r => r.to === me);
  show('sapq', !!q);
  if (q) {
    $('sapqs').textContent = `${nameOf(q.from)} wants to borrow ${rs(q.amount)} from you. They pay it back at the end of the round. (${Math.ceil(q.left / 1000)}s)`;
    $('sapqyes').onclick = () => { sfx.tick(); sap({ action: 'answer', id: q.id, accept: true }); };
    $('sapqno').onclick = () => { sfx.tick(); sap({ action: 'answer', id: q.id, accept: false }); };
  }
  show('sap', sapOpen && running);
  if (!sapOpen || !running) return;
  const left = mp.canBorrow, mine = SP.requests.find(r => r.from === me);
  $('sapme').textContent = `You've borrowed ${rs(mp.borrowed)} of ${rs(SP.maxBorrow)} this round` + (mp.lent ? ` · lent ${rs(mp.lent)}` : '');
  const amts = [50, 100, 200, 300, 500].filter(a => a % SP.step === 0 && a <= left);
  if (!amts.includes(sapAmt)) sapAmt = amts.includes(100) ? 100 : amts[0] || 0;
  const A = $('sapamt'); A.textContent = '';
  if (!amts.length) A.textContent = 'You have reached the borrowing limit for this round.';
  amts.forEach(a => { const b = document.createElement('button'); b.className = 'pill' + (a === sapAmt ? ' on' : ''); b.textContent = rs(a); b.onclick = () => { sapAmt = a; sfx.tick(); renderSapati(); }; A.append(b); });
  const W = $('sapwho'); W.textContent = '';
  if (mine) {
    const d = document.createElement('div'); d.className = 'rm';
    const t = document.createElement('span'); t.textContent = `Waiting for ${nameOf(mine.to)} to answer (${rs(mine.amount)}) · ${Math.ceil(mine.left / 1000)}s`;
    const c = document.createElement('button'); c.className = 'pill'; c.textContent = 'Cancel'; c.onclick = () => sap({ action: 'cancel' });
    d.append(t, c); W.append(d);
  } else R.players.filter(p => p.pid !== me).forEach(p => {
    const d = document.createElement('div'); d.className = 'rm';
    const t = document.createElement('span'); t.textContent = `${avatarOf(p.pid)} ${p.name} · can lend ${rs(p.canLend)}` + (p.connected ? '' : ' · offline');
    const b = document.createElement('button'); b.className = 'pill'; b.textContent = 'Ask';
    b.disabled = !sapAmt || p.canLend < sapAmt || !p.connected;
    b.onclick = () => { sfx.tick(); sap({ action: 'ask', to: p.pid, amount: sapAmt }); };
    d.append(t, b); W.append(d);
  });
  const B = $('sapbank'); B.textContent = '';
  const bb = document.createElement('button'); bb.className = 'go alt'; bb.style.padding = '11px';
  bb.textContent = mp.bankOk ? `Borrow ${rs(sapAmt)} from the bank` : 'Ask a player first — the bank helps if they say no';
  bb.disabled = !mp.bankOk || !sapAmt || !!mine;
  bb.onclick = () => { sfx.tick(); sap({ action: 'bank', amount: sapAmt }); };
  B.append(bb);
  // who owes whom this round
  const D = $('sapdebts'); D.textContent = '';
  if (SP.loans.length) {
    D.append(Object.assign(document.createElement('div'), { className: 'saplbl', textContent: 'Owed this round' }));
    SP.loans.forEach(l => { const d = document.createElement('div'); d.className = 'debt';
      d.textContent = `${nameOf(l.to)} ${l.to === me ? 'owe' : 'owes'} ${l.from === 'bank' ? 'the bank' : l.from === me ? 'you' : nameOf(l.from)} ${rs(l.amount)}`; D.append(d); });
  }
}
$('sapBtn').onclick = () => { sapOpen = true; sfx.tick(); renderSapati(); };
$('sapclose').onclick = () => { sapOpen = false; renderSapati(); };
setInterval(() => { if (S && S.room.sapati && S.room.sapati.requests.length) { S.room.sapati.requests.forEach(r => r.left = Math.max(0, r.left - 1000)); renderSapati(); } }, 1000);

// ---------- animations for what just happened (deal, bets, payouts) ----------
function animateEvents() {
  const h = S.room.history; if (!h.length) return;
  const newest = h[h.length - 1].id;
  if (lastEvId == null || newest < lastEvId || newest - lastEvId > 12) { lastEvId = newest; return; }   // first view / rejoin: don't replay
  const fresh = h.filter(e => e.id > lastEvId); lastEvId = newest;
  fresh.forEach((e, i) => setTimeout(() => play(e), i * 120));
}
function play(e) {
  if (!S || !S.game) return;
  const pot = $('pot').getBoundingClientRect();
  if (e.type == 'GAME_STARTED') {   // deal: 3 cards to everyone, one at a time
    let k = 0; for (let r = 0; r < 3; r++) e.players.forEach(pid => { const d = k++; setTimeout(() => { const c = backEl(); c.classList.add('fly'); c.style.width = '40px'; c.style.height = '56px'; fly(c, pot, placeOf(pid), 320); sfx.tok(0, .05, 240 + d % 4 * 30); }, d * 70); });
    e.players.forEach(pid => coins(placeOf(pid), pot, 1));
  } else if (e.type == 'CHAAL' || e.type == 'SHOW' || e.type == 'SIDESHOW_ASKED') { coins(placeOf(e.pid), pot, e.type == 'CHAAL' && !e.blind ? 4 : 3); sfx.tick(); }
  else if (e.type == 'HAND_WON') { coins(pot, placeOf(e.pid), 8); $('pot').classList.remove('bump'); void $('pot').offsetWidth; $('pot').classList.add('bump'); e.pid === me ? sfx.win() : sfx.chime(); }
  else if (e.type == 'PACKED') sfx.tick();
  else if (e.type == 'SAPATI_GIVEN') { if (e.to === me) { toast(`💰 ${e.pid === 'bank' ? 'The bank' : nameOf(e.pid)} lent you ${rs(e.amount)}`); sfx.chime(); sapOpen = false; render(); }
    else if (e.pid === me) toast(`You lent ${nameOf(e.to)} ${rs(e.amount)}`); }
  else if (e.type == 'SAPATI_DECLINED' && e.to === me) toast(`${nameOf(e.pid)} ${e.why == 'no answer' ? "didn't answer" : 'said no'} — you can ask the bank now`);
  else if (e.type == 'SAPATI_ASKED' && e.to === me) sfx.chime();
}

// turn ring + countdowns (every frame)
(function loop() {
  requestAnimationFrame(loop);
  if (!S || !S.game) return;
  const g = S.game, left = Math.max(0, deadlineAt - Date.now()), t = 1 - left / g.turnMs;
  const on = document.querySelector('.st.on .av'); if (on) { on.style.setProperty('--t', t.toFixed(3)); on.classList.toggle('hurry', left < 8000); }
  if (g.status == 'playing' && g.you && (g.current === me && !g.pending || g.you.options.reply)) {
    const ms = $('mystate'), mp = g.players.find(p => p.pid === me);   // my own countdown
    if (ms && mp) ms.textContent = (mp.seen ? 'seen' : 'blind') + ' · ' + Math.ceil(left / 1000) + 's';
  }
})();
setInterval(() => { if (S && S.room.nextIn != null && S.room.status == 'playing' && S.game && S.game.status == 'over') { S.room.nextIn = Math.max(0, S.room.nextIn - 1000); $('rinfo').textContent = `Round ${S.room.round} · Game ${S.room.gameInRound}/${S.room.gamesPerRound} · next game in ${Math.ceil(S.room.nextIn / 1000)}s`; } }, 1000);

// ---------- open rooms on the home screen ----------
function setWatch(on) { if (on === watching || !net || !net.online()) return; watching = on; send({ t: P + 'watch', on }); }
function renderRooms(list) {
  const L = $('rooms'); L.textContent = '';
  if (!list.length) return;
  L.append(Object.assign(document.createElement('div'), { className: 'sub', textContent: 'Open rooms', style: 'margin:14px 0 0' }));
  list.forEach(r => {
    const d = document.createElement('div'); d.className = 'rm';
    const t = document.createElement('span'); t.textContent = r.host + "'s table · " + r.players + '/' + r.max;
    const b = document.createElement('button'); b.className = 'pill'; b.textContent = 'Join';
    b.onclick = () => { $('code').value = r.code; $('bJoin').onclick(); };
    d.append(t, b); L.append(d);
  });
}

// ---------- lobby / landing ----------
const nickOk = () => { const v = $('nick').value.trim(); if (v) { store.set('ludo3d.nick', v); return v; } toast('Enter your name first'); $('nick').focus(); return null; };
$('nick').value = store.get('ludo3d.nick') || '';
$('bCreate').onclick = () => { const n = nickOk(); if (n) { sfx.tick(); wantResume = true; send({ t: P + 'create', name: n }); } };
$('bJoin').onclick = () => { const n = nickOk(), c = $('code').value.trim().toUpperCase(); if (!n) return; if (!/^[A-Z0-9]{5}$/.test(c)) return toast('Enter the 5-character code'); sfx.tick(); wantResume = true; send({ t: P + 'join', code: c, name: n }); };
$('code').onkeydown = e => { if (e.key == 'Enter') $('bJoin').onclick(); };
$('cCode').onclick = () => copy(S.room.code); $('cLink').onclick = () => copy(LINK + S.room.code);
$('lready').onclick = () => { const p = S.room.players.find(x => x.pid === me); sfx.tick(); send({ t: P + 'ready', ready: !(p && p.ready) }); };
$('lstart').onclick = () => { sfx.tick(); send({ t: P + 'start' }); };
$('again').onclick = () => { const p = S.room.players.find(x => x.pid === me); sfx.tick(); send({ t: P + 'ready', ready: !(p && p.ready) }); };
const leave = () => { send({ t: P + 'leave' }); clearSess(); S = null; show('qconf', false); render(); };
$('lleave').onclick = $('home').onclick = leave;
$('qbtn').onclick = () => show('qconf', true); $('qno').onclick = () => show('qconf', false); $('qyes').onclick = leave;
const paintSnd = () => { $('snd').textContent = snd ? '🔊' : '🔇'; }; paintSnd();
$('snd').onclick = () => { snd = !snd; store.set('ludo3d.sfx', snd ? '1' : '0'); paintSnd(); };
function showResume(s) { const r = $('resume'); r.style.display = 'flex'; $('rtxt').textContent = 'Table ' + s.code;
  $('rgo').onclick = () => { r.style.display = 'none'; kicked = false; wantResume = true; send({ t: P + 'resume', code: s.code, token: s.token }); };
  $('rno').onclick = () => { r.style.display = 'none'; clearSess(); }; }

// ---------- start ----------
const inv = (location.hash.match(/room=([A-Za-z0-9]{5})/) || [])[1];
if (inv) { $('code').value = inv.toUpperCase(); if (!tabSess()) toast('Enter your name to join table ' + inv.toUpperCase()); }
addEventListener('net', e => { if (e.detail == 'down' && S) toast('Connection lost · reconnecting…'); });
render();
if (!net) { $('onl').textContent = 'Online play is unavailable right now. Try reloading.'; return; }
net.on(onMsg);
if (net.online()) onMsg({ t: 'welcome' });
})();
