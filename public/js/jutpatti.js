// Jutpatti client: draws whatever state the server sends and sends the player's intents.
// It has NO game logic and is never trusted: the server owns the deck, hands, turns, legal
// moves and the winner. This browser only ever receives its own cards.
// How you arrange and pair your cards is yours alone: it lives only in this tab, and the
// server checks your pairs when you press Show.
(() => {
const $ = id => document.getElementById(id);
const SKEY = 'jutpatti.session', LINK = location.origin + location.pathname + '#room=';
const COLORS = ['#fbc916', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f97316'];
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' }, SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const ERR = {
  NAME_REQUIRED: 'Enter your name first', ROOM_NOT_FOUND: 'Room not found', ROOM_FULL: 'That room is full (6 players)',
  IN_PROGRESS: 'That game has already started', NOT_HOST: 'Only the host can do that', NOT_READY: 'Waiting for everyone to be ready',
  NOT_ENOUGH_PLAYERS: 'Need at least 2 players', PLAYER_OFFLINE: 'Someone is offline', NOT_YOUR_TURN: "It's not your turn",
  ILLEGAL_MOVE: "You can't do that now", NOT_OWNED: "That card isn't in your hand", WRONG_PHASE: 'Draw a card first',
  GAME_NOT_RUNNING: 'The game is not running', RATE_LIMIT: 'Slow down a little', SERVER_FULL: 'Server is busy, try again soon',
  BAD_OPTION: 'That option is not available', SERVER_ERROR: 'Something went wrong',
  INVALID_SHOW: "Not all your cards make pairs yet — keep playing", BAD_REQUEST: "That move wasn't valid",
};
const net = window.claude && window.claude.raw;

let S = null, me = null, pending = null, kicked = false, wantResume = true;
let lastTurnKey = '', lastStatus = '', lastEvId = null, lastGameNo = null;
let arr = [], sel = null;   // MY arrangement of my hand: [[card], [card, card], ...]. Only the player pairs cards.
let drag = null, deferred = false, noClick = false, skipMine = false, hideCard = null, flipFrom = null, lastThrown = null;
let deal = null;            // while the deal animation runs: { mine, seats: {pid: n}, total, done }
let badKeys = null, badTimer = 0, endShown = false, endTimer = 0;

// ---------- small helpers ----------
const toast = t => { const e = $('toast'); e.textContent = t; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 2600); };
const rid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); };
// light haptics on phones that support it (browsers only allow it after the player has touched the page)
const buzz = ms => { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (e) {} };
// Seat memory. sessionStorage = this tab's own seat (a refresh rejoins automatically, and two tabs
// never steal each other's seat). localStorage = last seat in this browser, offered as a Rejoin button.
const tabStore = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} }, del: k => { try { sessionStorage.removeItem(k); } catch (e) {} } };
const parseSess = raw => { try { const s = JSON.parse(raw || 'null'); return s && /^[A-Z0-9]{5}$/.test(s.code) && typeof s.token == 'string' && Date.now() - s.t < 12 * 36e5 ? s : null; } catch (e) { return null; } };
const tabSess = () => parseSess(tabStore.get(SKEY)), anySess = () => parseSess(store.get(SKEY));
const saveSess = (code, token) => { const v = JSON.stringify({ code, token, t: Date.now() }); tabStore.set(SKEY, v); store.set(SKEY, v); };
const clearSess = () => { const own = tabSess(), any = anySess(); tabStore.del(SKEY); if (!own || (any && any.token === own.token)) store.del(SKEY); };
const send = o => { if (!net || !net.send(o)) toast('Offline · reconnecting…'); };
const nameOf = pid => pid === me ? 'You' : (S && S.room.names[pid]) || 'Player';
const colorOf = pid => { const i = S ? Object.keys(S.room.names).indexOf(pid) : 0; return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const cardTxt = c => c ? c.slice(0, -1) + SUIT[c.slice(-1)] : '';
const rankPlural = r => ({ J: 'Jacks', Q: 'Queens', K: 'Kings', A: 'Aces' }[r] || r + 's');
const gkey = g => g.join(',');
async function copy(t) { try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); try { document.execCommand('copy'); } catch (e2) {} a.remove(); } toast('Copied!'); }
function show(id, on) { $(id).style.display = on ? 'flex' : 'none'; }
const handEls = () => [...$('hand').querySelectorAll('.pc')];
const seatEl = pid => document.querySelector('.st[data-pid="' + pid + '"]');

function cardEl(c, tag = 'div') {
  const e = document.createElement(tag), r = c.slice(0, -1), s = c.slice(-1), g = S && S.game;
  e.className = 'pc' + (s == 'H' || s == 'D' ? ' red' : '') + (g && r === g.jokerRank ? ' joker' : '');
  e.setAttribute('aria-label', r + ' of ' + SUIT_NAME[s] + (g && r === g.jokerRank ? ' (Joker)' : ''));
  e.innerHTML = '<span class="r"></span><span class="s1"></span><span class="s2"></span>';
  e.querySelector('.r').textContent = r; e.querySelector('.s1').textContent = SUIT[s]; e.querySelector('.s2').textContent = SUIT[s];
  if (tag == 'button') e.type = 'button';
  return e;
}
const backEl = () => { const e = document.createElement('div'); e.className = 'pc down'; return e; };
function setCard(el, c, cls) { el.className = 'pc ' + (cls || ''); el.innerHTML = ''; el.removeAttribute('aria-label'); if (c) { const n = cardEl(c); el.className = n.className + (cls ? ' ' + cls : ''); el.innerHTML = n.innerHTML; el.setAttribute('aria-label', n.getAttribute('aria-label')); } }
const flipIn = (el, delay = 0) => el.animate([{ transform: 'rotateY(90deg) scale(.9)' }, { transform: 'none' }], { duration: 260, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });

// ---------- my arrangement (lives in this tab only) ----------
const arrKey = () => 'jutpatti.arr.' + S.room.code + '.' + S.room.gameNo;
const saveArr = () => { if (S) tabStore.set(arrKey(), JSON.stringify(arr)); };
function syncArr(hand) {
  if (S.room.gameNo !== lastGameNo) {   // new game (or page just loaded): restore what this tab had, if anything
    lastGameNo = S.room.gameNo; sel = null; let saved = null;
    try { saved = JSON.parse(tabStore.get(arrKey()) || 'null'); } catch (e) {}
    arr = Array.isArray(saved) ? saved.filter(Array.isArray).map(g => g.filter(c => typeof c == 'string').slice(0, 2)) : [];
  }
  const have = new Set(hand);
  arr = arr.map(g => g.filter(c => have.has(c))).filter(g => g.length);   // a pair whose partner left becomes a single
  const placed = new Set(arr.flat());
  hand.forEach(c => { if (!placed.has(c)) arr.push([c]); });             // new cards arrive on the right, unpaired
  saveArr();
}
const allPaired = () => arr.length > 0 && arr.every(g => g.length === 2);

// ---------- networking ----------
function act(move) {
  const g = S && S.game; if (!g || pending) return;
  pending = rid(); render();
  send({ t: 'jp:act', v: g.version, aid: pending, move });
  setTimeout(() => { if (pending) { pending = null; hideCard = null; send({ t: 'jp:sync' }); render(); } }, 4000);   // never get stuck
}

function onMsg(m) {
  if (m.t == 'welcome') {
    $('onl').textContent = ''; $('bCreate').disabled = $('bJoin').disabled = false;
    const own = tabSess(), other = anySess();
    if (own && wantResume && !kicked) send({ t: 'jp:resume', code: own.code, token: own.token });
    else if (other && !S) showResume(other);
    return;
  }
  if (m.t == 'jp:joined') {
    me = m.pid; saveSess(m.code, m.token); kicked = false; wantResume = true;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    if (m.resumed) toast('Back in the room');
  } else if (m.t == 'jp:state') {
    const prevVer = S && S.game && S.game.version;
    S = m; me = m.you;
    if (pending && (!S.game || S.game.version !== prevVer)) { pending = null; hideCard = null; }
    if (S.game && S.game.you) syncArr(S.game.you.hand);
    if (sel && !arr.some(g => g.includes(sel))) sel = null;
    render();
  } else if (m.t == 'jp:err') {
    if (m.code == 'SESSION_EXPIRED') { clearSess(); S = null; render(); toast('That room is no longer available'); return; }
    if (m.code == 'STALE') return;   // the fresh state follows right after
    pending = null; hideCard = null; skipMine = false;
    if (m.code == 'INVALID_SHOW' && Array.isArray(m.bad)) markBad(m.bad);
    toast(ERR[m.code] || 'Error: ' + m.code); buzz([30, 40, 30]); render();
  } else if (m.t == 'jp:kicked') {
    kicked = true; S = null; render(); toast('This room was opened in another tab'); tabStore.del(SKEY); const s = anySess(); if (s) showResume(s);
  } else if (m.t == 'jp:left') { S = null; render(); }
}

// ---------- rendering ----------
function flushRender() { if (deferred) { deferred = false; render(); } }
function render() {
  if (drag && drag.ghost) { deferred = true; return; }   // never rebuild the hand under the player's finger
  const st = S ? S.room.status : 'none';
  if (st != 'over') { endShown = false; clearTimeout(endTimer); }
  else if (!endShown && !endTimer) {   // let everyone see the winning cards on the table before the results
    const live = lastStatus == 'playing' && S.game && S.game.winner;
    if (!live) endShown = true; else endTimer = setTimeout(() => { endTimer = 0; endShown = true; render(); }, 2600);
  }
  show('landing', !S); show('lobby', st == 'lobby'); show('end', st == 'over' && endShown);
  $('jtable').style.visibility = S && S.game ? 'visible' : 'hidden';
  if (!S) { lastStatus = ''; lastEvId = null; return; }
  if (st == 'lobby') renderLobby();
  prepareDeal();
  renderTable();
  animateEvents();   // runs in the lobby too, so the first deal of a room is animated
  if (st == 'over') { renderReveal(); if (endShown) renderEnd(); } else $('reveal').textContent = '';
  if (st == 'playing' && lastStatus != 'playing' && !deal) sfx.start();
  if (st == 'over' && lastStatus == 'playing') { if (S.game && S.game.winner === me) sfx.win(); else sfx.chime(); }
  lastStatus = st;
}

function renderLobby() {
  const R = S.room, L = $('lseats'), host = R.hostPid === me, mine = R.players.find(p => p.pid === me);
  $('rcode').textContent = R.code; L.textContent = '';
  R.players.forEach(p => {
    const b = document.createElement('div'); b.className = 'seat' + (p.connected ? '' : ' off'); b.style.setProperty('--c', colorOf(p.pid));
    const i = document.createElement('i'), n = document.createElement('span'), e = document.createElement('em');
    n.textContent = (p.pid === me ? p.name + ' (you)' : p.name);
    if (p.pid === R.hostPid) { const h = document.createElement('small'); h.className = 'host'; h.textContent = '👑 host'; n.append(h); }
    e.textContent = !p.connected ? 'Offline' : p.pid === R.hostPid ? 'Host' : p.ready ? 'Ready ✓' : 'Not ready';
    b.append(i, n, e); L.append(b);
  });
  for (let k = R.players.length; k < R.minPlayers; k++) { const b = document.createElement('div'); b.className = 'seat off'; b.innerHTML = '<i></i><span>Waiting for a player…</span>'; L.append(b); }
  const H = $('hsize'); H.textContent = 'Cards each: ';
  R.handSizes.forEach(h => { const b = document.createElement('button'); b.className = 'pill' + (h === R.handSize ? ' on' : ''); b.textContent = h; b.disabled = !host;
    b.onclick = () => { if (host && h !== R.handSize) { sfx.tick(); send({ t: 'jp:opts', handSize: h }); } }; H.append(b); });
  $('lready').style.display = host ? 'none' : ''; $('lready').classList.toggle('on', !!(mine && mine.ready));
  $('lready').textContent = mine && mine.ready ? 'Ready ✓ (tap to undo)' : "I'm ready";
  const others = R.players.filter(p => p.pid !== R.hostPid), canStart = R.players.length >= R.minPlayers && others.every(p => p.ready && p.connected);
  $('lstart').style.display = host ? '' : 'none'; $('lstart').disabled = !canStart;
  $('lnote').textContent = host ? (R.players.length < R.minPlayers ? 'Share the code — 2 to 6 players' : canStart ? 'Everyone is ready!' : 'Waiting for everyone to be ready…') : 'Waiting for the host to start…';
}

function renderSeats(g) {
  const felt = $('seats'), R = S.room, conn = Object.fromEntries(R.players.map(p => [p.pid, p.connected]));
  felt.textContent = '';
  const order = g.players.map(p => p.pid), at = Math.max(0, order.indexOf(me));
  const others = g.players.slice(at).concat(g.players.slice(0, at)).filter(p => p.pid !== me);   // turn order, starting after me
  others.forEach((p, i) => {
    const a = Math.PI + (i + 1) / (others.length + 1) * Math.PI, x = 50 + 44 * Math.cos(a), y = 54 + 44 * Math.sin(a);
    const count = deal ? deal.seats[p.pid] || 0 : p.cards;
    const d = document.createElement('div'); d.className = 'st' + (g.current === p.pid && g.status == 'playing' && !deal ? ' on' : '') + (!p.active || conn[p.pid] === false ? ' off' : '');
    d.dataset.pid = p.pid; d.style.left = x + '%'; d.style.top = y + '%'; d.style.setProperty('--c', colorOf(p.pid));
    const nm = document.createElement('b'), dot = document.createElement('i'); nm.append(dot, document.createTextNode(nameOf(p.pid)));
    const fan = document.createElement('div'); fan.className = 'fan'; for (let k = 0; k < Math.min(count, 8); k++) fan.append(document.createElement('span'));
    const badge = document.createElement('em'); badge.className = 'cnt'; badge.textContent = count;
    const info = document.createElement('small'); info.textContent = !p.active ? 'left' : conn[p.pid] === false ? 'offline' : count + ' cards';
    d.append(nm, fan, badge, info);
    if (p.pid === g.dealer) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'dealer'; d.append(t); }
    felt.append(d);
  });
}

function renderTable() {
  const g = S.game, R = S.room;
  if (!g) { $('hand').textContent = ''; $('jstatus').textContent = ''; return; }
  const you = g.you, myTurn = g.status == 'playing' && g.current === me && !deal, conn = Object.fromEntries(R.players.map(p => [p.pid, p.connected]));
  renderSeats(g);
  // centre: stock, discard, shown card
  const canStock = canDraw('stock'), canDisc = canDraw('discard');
  $('stock').className = 'pc ' + (g.stockCount || g.discardCount > 1 || deal ? 'down' : 'empty') + (g.stockCount > 1 ? ' stack' : '') + (canStock ? ' can' : '');
  $('stockN').textContent = deal ? 'Dealing…' : 'Stock · ' + g.stockCount;
  setCard($('disc'), g.discardTop, (g.discardTop ? '' : 'empty') + (g.discardCount > 1 ? ' stack' : '') + (canDisc ? ' can' : ''));
  $('disc').style.rotate = g.discardTop ? ((g.discardTop.charCodeAt(0) * 7 + g.discardCount * 13) % 9 - 4) + 'deg' : '';   // a pile, not a grid
  $('discN').textContent = 'Discard · ' + g.discardCount;
  if (deal) { setCard($('shownCard'), null, 'sm down'); $('jokerTxt').textContent = ''; }
  else { setCard($('shownCard'), g.shown, 'sm'); $('jokerTxt').textContent = '★ Jokers: ' + rankPlural(g.jokerRank); }
  // status line
  const cur = g.current, js = $('jstatus'); let txt;
  if (deal) txt = 'Dealing the cards…';
  else if (g.status != 'playing') txt = g.winner ? (g.winner === me ? 'You win! 🎉' : nameOf(g.winner) + ' shows their pairs and wins!') : 'Game over';
  else if (myTurn) txt = g.phase == 'draw' ? 'Your turn · take a card' : 'Your turn · throw a card away';
  else txt = nameOf(cur) + "'s turn" + (conn[cur] === false ? ' · offline, 2 min to return' : '…');
  js.textContent = txt; js.classList.toggle('me', myTurn);
  const tk = g.turn + ':' + cur + ':' + !!deal; if (tk !== lastTurnKey) { js.classList.remove('pop'); void js.offsetWidth; js.classList.add('pop'); if (myTurn && lastTurnKey) { sfx.chime(); buzz(20); } lastTurnKey = tk; }
  renderHand(g, you, myTurn);
  // Show button: available every time you've drawn. The server checks the whole hand, however the cards are arranged.
  const canShow = myTurn && !pending && g.phase == 'discard' && you && you.validMoves.some(m => m.type == 'show');
  $('showBtn').style.display = canShow ? 'block' : 'none';
  $('sortBtn').style.visibility = you && !deal && g.status == 'playing' ? 'visible' : 'hidden';
  $('hint').textContent = deal || !you || g.status != 'playing' ? '' : pending ? '…'
    : !myTurn ? 'Drag a card onto another to pair them · drag along the row to move it'
    : g.phase == 'draw' ? 'Drag a card from the stock or discard pile into your hand'
    : sel ? 'Tap it again — or drag it onto the table — to throw it'
    : 'Throw a card onto the table — or tap Show if all your cards make pairs';
  const pairs = arr.filter(x => x.length == 2).length;
  $('mylabel').textContent = you ? (you.hand.length + ' cards · ' + pairs + ' pair' + (pairs == 1 ? '' : 's') + ' made · ' + ((R.players.find(p => p.pid === me) || {}).score || 0) + ' wins') : 'You are watching this game';
  renderLog();
}

function renderHand(g, you, myTurn) {
  const H = $('hand'), prev = new Map();
  handEls().forEach(e => prev.set(e.dataset.card, e.getBoundingClientRect()));
  if (flipFrom) { for (const [k, v] of flipFrom) prev.set(k, v); flipFrom = null; }
  H.textContent = ''; H.classList.toggle('wait', !myTurn || g.phase != 'discard');
  if (!you) return;
  const ld = g.lastDraw && g.lastDraw.pid === me && g.status == 'playing' && g.phase == 'discard' ? g.lastDraw.card : null;
  let idx = 0;
  arr.forEach((grp, gi) => {
    const w = document.createElement('div');
    w.className = 'grp' + (grp.length == 2 ? ' pair' : '') + (badKeys && badKeys.has(gkey(grp)) ? ' bad' : '');
    grp.forEach(c => {
      if (c === hideCard) return;   // already thrown, waiting for the server to confirm
      const e = cardEl(c, 'button'); e.dataset.card = c; e.dataset.g = gi;
      if (c === sel) e.classList.add('sel'); if (c === ld) e.classList.add('new');
      if (deal && idx >= deal.mine) e.classList.add('undealt');
      idx++;
      e.onclick = () => pickCard(c); e.onpointerdown = ev => beginDrag(ev, 'hand', c, e);
      w.append(e);
    });
    if (w.children.length) H.append(w);
  });
  layoutHand();
  // FLIP: cards glide from where they were to where they are now
  handEls().forEach(e => {
    const p = prev.get(e.dataset.card); if (!p) return;
    const r = e.getBoundingClientRect(), dx = p.left - r.left, dy = p.top - r.top;
    if (Math.abs(dx) + Math.abs(dy) > 1) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

// One overlapping, gently fanned row that always fits the screen (no wrapping on phones).
function layoutHand() {
  const H = $('hand'), groups = [...H.children], els = handEls(), n = els.length; if (!n) return;
  const cs = getComputedStyle(H), W = H.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 8, gap = 8;
  H.style.setProperty('--gap', gap + 'px');
  const natural = groups.reduce((s, g) => s + g.offsetWidth, 0) + (groups.length - 1) * gap;   // measured, so padding etc. is included
  const squeeze = groups.length > 1 ? Math.max(0, (natural - W) / (groups.length - 1)) : 0;
  H.style.setProperty('--gap', (gap - squeeze).toFixed(1) + 'px');
  const a = Math.min(2.6, 30 / n);
  els.forEach((e, i) => { const k = i - (n - 1) / 2; e.style.rotate = (k * a).toFixed(2) + 'deg'; e.style.translate = '0 ' + (Math.abs(k * a) ** 1.5 * .55).toFixed(1) + 'px'; e.style.zIndex = i + 1; });
}

function markBad(bad) {
  badKeys = new Set(bad.map(i => arr[i] && gkey(arr[i])).filter(Boolean));
  clearTimeout(badTimer); badTimer = setTimeout(() => { badKeys = null; render(); }, 2600);
}

function logLine(e) {
  const n = nameOf(e.pid);
  switch (e.type) {
    case 'GAME_STARTED': return 'New game · ' + nameOf(e.dealer) + (e.dealer === me ? ' deal' : ' deals') + ' ' + e.handSize + ' cards each';
    case 'CARDS_DEALT': return 'Shown card ' + cardTxt(e.shown) + ' · Jokers are ' + rankPlural(e.jokerRank);
    case 'CARD_DRAWN': return e.source == 'stock' ? n + ' drew from the stock' : n + ' took ' + cardTxt(e.card);
    case 'CARD_PLAYED': return n + ' threw ' + cardTxt(e.card);
    case 'STOCK_RESHUFFLED': return 'Discard pile shuffled into a new stock';
    case 'PLAYER_SHOWED': return n + (e.pid === me ? ' show' : ' shows') + ' all pairs';
    case 'PLAYER_WON': return '🏆 ' + n + (e.pid === me ? ' win!' : ' wins!');
    case 'GAME_ENDED': return e.reason == 'turn-limit' ? 'Turn limit reached · no winner' : e.reason == 'not-enough-players' ? 'Not enough players left · no winner' : null;
    case 'PLAYER_JOINED': return n + ' joined';
    case 'PLAYER_LEFT': return n + ' left';
  }
  return null;
}
function renderLog() {
  const h = S.room.history, L = $('jlog'); L.textContent = '';
  h.map(logLine).filter(Boolean).slice(-12).forEach(t => { const d = document.createElement('div'); d.textContent = t; L.append(d); });
  L.scrollTop = 1e9;
}

// The winner lays their pairs face up in the middle of the table.
function renderReveal() {
  const g = S.game, R = $('reveal');
  if (!g || !g.winningPairs) { R.textContent = ''; return; }
  if (R.dataset.game == S.room.gameNo) return;   // already laid out
  R.dataset.game = S.room.gameNo; R.textContent = '';
  const t = document.createElement('div'); t.className = 'rt'; t.textContent = (g.winner === me ? 'Your' : nameOf(g.winner) + "'s") + ' pairs'; R.append(t);
  const row = document.createElement('div'); row.className = 'rrow'; R.append(row);
  g.winningPairs.forEach((p, i) => { const w = document.createElement('div'); w.className = 'grp pair'; p.forEach((c, k) => { const e = cardEl(c); flipIn(e, 150 + (i * 2 + k) * 90); w.append(e); }); row.append(w); });
}

function renderEnd() {
  const g = S.game, R = S.room, mine = R.players.find(p => p.pid === me);
  $('etitle').textContent = !g ? 'Game over' : g.winner ? (g.winner === me ? 'You win! 🎉' : nameOf(g.winner) + ' wins!') : 'No winner this time';
  const W = $('whand');
  if (W.dataset.game != R.gameNo) {
    W.dataset.game = R.gameNo; W.textContent = '';
    if (g && g.winningPairs) g.winningPairs.forEach((p, i) => { const w = document.createElement('div'); w.className = 'grp'; p.forEach((c, k) => { const e = cardEl(c); flipIn(e, (i * 2 + k) * 60); w.append(e); }); W.append(w); });
  }
  const K = $('ranks'); K.textContent = '';
  R.players.slice().sort((a, b) => b.score - a.score).forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'rk' + (g && p.pid === g.winner ? ' w' : ''); d.style.animationDelay = i * .07 + 's'; d.style.setProperty('--c', colorOf(p.pid));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = p.name + (p.pid === me ? ' (you)' : '');
    const s = document.createElement('small'); s.textContent = p.score + ' win' + (p.score == 1 ? '' : 's') + (p.ready ? ' · rematch ✓' : p.connected ? '' : ' · offline');
    d.append(document.createElement('i'), n, s); K.append(d);
  });
  $('again').textContent = mine && mine.ready ? 'Waiting… (tap to cancel)' : 'Rematch';
  $('enote').textContent = R.players.length < R.minPlayers ? 'Waiting for more players to join (code ' + R.code + ')' : 'The next game starts when everyone taps Rematch';
}

// ---------- dealing animation ----------
// Starts when a NEW game begins while you're watching (not when you reload into one).
function prepareDeal() {
  const h = S.room.history; if (deal || lastEvId == null || !S.game || S.room.status != 'playing') return;
  const gs = h.find(e => e.type == 'GAME_STARTED' && e.id > lastEvId);
  if (!gs) return;
  const g = S.game, n = g.players.length, di = g.players.findIndex(p => p.pid === g.dealer), order = [];
  for (let k = 0; k < g.handSize; k++) for (let i = 1; i <= n; i++) order.push(g.players[(di + i) % n].pid);
  deal = { mine: 0, seats: {}, total: order.length, done: 0, order, started: false };
}
function runDeal() {
  if (!deal || deal.started) return;
  deal.started = true;
  const d = deal, step = Math.min(110, 2600 / d.order.length);
  d.order.forEach((pid, k) => setTimeout(() => {
    if (deal !== d) return;
    const from = $('stock').getBoundingClientRect();
    const slot = pid === me ? handEls()[d.order.slice(0, k).filter(p => p === me).length] : seatEl(pid);   // my n-th card goes to the n-th slot
    const to = (slot || $('hand')).getBoundingClientRect();
    fly(null, from, to, { shrink: pid !== me, ms: 330, done: () => {
      if (deal !== d) return;
      if (pid === me) { const el = handEls()[d.mine++]; if (el) { el.classList.remove('undealt'); flipIn(el); } }
      else { d.seats[pid] = (d.seats[pid] || 0) + 1; const s = seatEl(pid); if (s) { s.querySelector('.cnt').textContent = d.seats[pid]; const f = s.querySelector('.fan'); if (f.children.length < 8) f.append(document.createElement('span')); s.querySelector('small').textContent = d.seats[pid] + ' cards'; } }
      if (++d.done === d.total) setTimeout(() => { if (deal !== d) return; deal = null; render(); const sc = $('shownCard'); flipIn(sc); sfx.chime(); }, 300);
    } });
    sfx.tok(0, .05, 240 + (k % 4) * 30);
  }, 250 + k * step));
}

// ---------- other players' moves (and my taps): cards fly between seats and piles ----------
function animateEvents() {
  const h = S.room.history; if (!h.length) return;
  const newest = h[h.length - 1].id;
  if (lastEvId == null || newest < lastEvId || (newest - lastEvId > 10 && !deal)) { lastEvId = newest; return; }   // first view / rejoin: don't replay
  const fresh = h.filter(e => e.id > lastEvId); lastEvId = newest;
  if (deal) { runDeal(); return; }
  fresh.forEach((e, i) => setTimeout(() => flyEvent(e), i * 140));
}
function flyEvent(e) {
  if (!S || !S.game || deal || (e.type != 'CARD_DRAWN' && e.type != 'CARD_PLAYED')) return;
  if (e.pid === me && skipMine) { skipMine = false; return; }   // you already moved this card with your finger
  const toPile = e.type == 'CARD_PLAYED', pile = $(toPile || e.source == 'discard' ? 'disc' : 'stock').getBoundingClientRect();
  const face = toPile || e.source == 'discard' ? e.card : null;
  if (e.pid !== me) {
    const seat = seatEl(e.pid); if (!seat) return;
    const sr = seat.getBoundingClientRect();
    if (toPile) fly(face, sr, pile, { grow: true }); else fly(face, pile, sr, { shrink: true });
    sfx.tick(); return;
  }
  if (toPile) { fly(face, lastThrown || $('hand').getBoundingClientRect(), pile); lastThrown = null; return; }
  // my own tap-draw: the card flies into its slot and flips over
  const card = S.game.lastDraw && S.game.lastDraw.pid === me ? S.game.lastDraw.card : null;
  const el = card && $('hand').querySelector('[data-card="' + card + '"]'); if (!el) return;
  el.style.visibility = 'hidden';
  fly(face, pile, el.getBoundingClientRect(), { done: () => { const x = $('hand').querySelector('[data-card="' + card + '"]'); if (x) { x.style.visibility = ''; if (!face) flipIn(x); } } });
}
function fly(card, from, to, o = {}) {
  const w = $('disc').getBoundingClientRect().width, el = card ? cardEl(card) : backEl();
  el.classList.add('fly'); el.style.width = w + 'px'; el.style.height = w * 1.4 + 'px';
  el.style.left = from.left + from.width / 2 - w / 2 + 'px'; el.style.top = from.top + from.height / 2 - w * .7 + 'px';
  document.body.append(el);
  const tx = to.left + to.width / 2 - (from.left + from.width / 2), ty = to.top + to.height / 2 - (from.top + from.height / 2);
  const sc = Math.max(.6, Math.min(1.4, to.width / w));
  el.animate([{ transform: `scale(${o.grow ? .5 : 1}) rotate(0deg)`, opacity: o.grow ? .5 : 1 },
    { transform: `translate(${tx * .5}px,${ty * .5 - 30}px) scale(1.08) rotate(${tx > 0 ? 8 : -8}deg)`, opacity: 1, offset: .5 },
    { transform: `translate(${tx}px,${ty}px) scale(${o.shrink ? .45 : sc}) rotate(0deg)`, opacity: o.shrink ? .2 : 1 }],
    { duration: o.ms || 420, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }).onfinish = () => { el.remove(); if (o.done) o.done(); };
}

// ---------- input: gestures ----------
// Draw: drag a card from the stock or discard pile down into your hand (or flick it down).
// Throw: drag a card from your hand up onto the table (or flick it up).
// Arrange: drag a card onto another card to pair them; drag along the row to move it; drag out of a pair to split it.
// Taps still work: tap a pile to draw, tap a card to lift it and tap it again to throw it.
// These only send an intent; the server decides whether a move is allowed.
const FLICK = 0.6;   // px per ms: a quick swipe counts even if it doesn't reach the drop zone
const canDraw = src => { const g = S && S.game; return !!(g && !deal && g.status == 'playing' && g.current === me && !pending && g.you && g.you.validMoves.some(m => m.source == src)); };
const canThrow = c => { const g = S && S.game; return !!(g && !deal && g.status == 'playing' && g.current === me && !pending && g.you && g.you.validMoves.some(m => m.type == 'discard' && m.card === c)); };
const handTop = () => $('hand').getBoundingClientRect().top - 24;

function beginDrag(e, kind, card, el) {
  if (drag || deal || (e.pointerType == 'mouse' && e.button !== 0)) return;
  if (kind != 'hand' && !canDraw(kind)) return;   // nothing to pick up from a pile unless you may draw
  drag = { kind, card, el, id: e.pointerId, x0: e.clientX, y0: e.clientY, pts: [[e.clientX, e.clientY, e.timeStamp]], ghost: null, target: null };
}
function startGhost() {
  const r = drag.el.getBoundingClientRect(), g = drag.kind == 'stock' ? backEl() : cardEl(drag.card);
  g.classList.add('ghost'); g.style.left = r.left + 'px'; g.style.top = r.top + 'px';
  const w = drag.el.offsetWidth; g.style.width = w + 'px'; g.style.height = w * 1.4 + 'px';
  document.body.append(g); drag.ghost = g; drag.r = { left: r.left, top: r.top, width: w, height: w * 1.4 };
  if (drag.kind != 'stock') drag.el.classList.add('lift');
  sel = null; drag.el.classList.remove('sel'); buzz(8);
}
// where a hand card would land if dropped here: on a single card (pair), or between groups (move)
function handTarget(x, y) {
  // the card actually visible under the finger (cards overlap and are rotated, so ask the browser)
  const hit = document.elementsFromPoint(x, y).find(e => e.matches && e.matches('#hand .pc') && e.dataset.card !== drag.card);
  if (hit) { const gi = +hit.dataset.g; if (arr[gi] && arr[gi].length === 1) return { pair: gi, el: hit }; }
  const groups = [...$('hand').children]; let ins = groups.length;
  for (let i = 0; i < groups.length; i++) { const r = groups[i].getBoundingClientRect(); if (x < r.left + r.width / 2) { ins = i; break; } }
  return { ins, groups };
}
function showTarget(t) {
  document.querySelectorAll('#hand .pt').forEach(e => e.classList.remove('pt'));
  const c = $('caret'); c.style.display = 'none';
  if (!t) return;
  if (t.pair != null) { t.el.classList.add('pt'); return; }
  const gs = t.groups.filter(g => !g.querySelector('.lift') || g.children.length > 1); if (!gs.length) return;
  const ref = t.groups[Math.min(t.ins, t.groups.length - 1)].getBoundingClientRect(), x = t.ins < t.groups.length ? ref.left - 4 : ref.right + 4;
  c.style.display = 'block'; c.style.left = x + 'px'; c.style.top = ref.top + 'px'; c.style.height = ref.height + 'px';
}
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.ghost) { if (Math.hypot(dx, dy) < 8) return; if (!drag.el.isConnected) { drag = null; return; } startGhost(); }
  drag.pts.push([e.clientX, e.clientY, e.timeStamp]); if (drag.pts.length > 5) drag.pts.shift();
  drag.ghost.style.left = drag.r.left + dx + 'px'; drag.ghost.style.top = drag.r.top + dy + 'px';
  drag.ghost.style.transform = 'rotate(' + Math.max(-12, Math.min(12, dx / 25)) + 'deg) scale(1.1)';
  const ht = handTop(), overTable = e.clientY < ht;
  $('felt').classList.toggle('hot', drag.kind == 'hand' && overTable && canThrow(drag.card));
  $('mine').classList.toggle('hot', drag.kind != 'hand' && !overTable);
  drag.target = drag.kind == 'hand' && !overTable ? handTarget(e.clientX, e.clientY) : null;
  showTarget(drag.target);
}, { passive: true });
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  $('felt').classList.remove('hot'); $('mine').classList.remove('hot'); showTarget(null);
  if (!d.ghost) return flushRender();   // just a tap: the click handler takes it from here
  noClick = true; setTimeout(() => { noClick = false; }, 50);
  const a = d.pts[0], b = d.pts[d.pts.length - 1], vy = (b[1] - a[1]) / Math.max(1, b[2] - a[2]), ht = handTop(), up = e.type == 'pointerup';
  if (d.kind == 'hand' && up && e.clientY >= ht && !(vy < -FLICK)) {   // dropped back in the hand: rearrange
    const gr = d.ghost.getBoundingClientRect(); d.ghost.remove(); d.el.classList.remove('lift');
    if (d.target) { flipFrom = new Map([[d.card, gr]]); moveCard(d.card, d.target); } else flushRender();
    return;
  }
  const aimed = up && (d.kind == 'hand' ? e.clientY < ht || vy < -FLICK : e.clientY >= ht || vy > FLICK);
  const ok = aimed && (d.kind == 'hand' ? canThrow(d.card) : canDraw(d.kind));
  if (ok) {
    const to = (d.kind == 'hand' ? $('disc') : $('hand')).getBoundingClientRect();
    glide(d.ghost, to, d.kind != 'hand');
    skipMine = true; sfx.tick(); buzz(12);
    if (d.kind == 'hand') { hideCard = d.card; act({ type: 'discard', card: d.card }); }
    else act({ type: 'draw', source: d.kind });
  } else {
    glide(d.ghost, d.r, false, () => d.el.classList.remove('lift'));   // snap back
    if (aimed && d.kind == 'hand') { const g = S && S.game; toast(!g || g.current !== me ? 'Wait for your turn' : g.phase == 'draw' ? 'Take a card first' : "You can't do that now"); }
  }
  flushRender();
}
addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);

function moveCard(card, t) {
  const gi = arr.findIndex(g => g.includes(card)); if (gi < 0) return render();
  const grp = arr[gi];
  if (t.pair != null) {
    if (t.pair === gi) return render();
    const target = arr[t.pair];
    grp.splice(grp.indexOf(card), 1); target.push(card);
    if (!grp.length) arr.splice(gi, 1);
    sfx.chime();
  } else {
    let ins = t.ins;
    grp.splice(grp.indexOf(card), 1);
    if (!grp.length) { arr.splice(gi, 1); if (gi < ins) ins--; }
    arr.splice(ins, 0, [card]);
    sfx.tick();
  }
  sel = null; saveArr(); buzz(10); render();
}

// moves a fixed-position card to the centre of a target rect, then removes it
function glide(el, to, fade, done) {
  const r = el.getBoundingClientRect(), tx = to.left + to.width / 2 - (r.left + r.width / 2), ty = to.top + to.height / 2 - (r.top + r.height / 2);
  el.animate([{ transform: el.style.transform || 'none', opacity: 1 }, { transform: `translate(${tx}px,${ty}px) scale(${fade ? .7 : 1})`, opacity: fade ? 0 : 1 }],
    { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).onfinish = () => { el.remove(); if (done) done(); };
}

function pickCard(c) {
  if (noClick || deal) return;
  const g = S && S.game; if (!g || g.current !== me || g.phase != 'discard' || pending) return;
  if (sel === c) {   // second tap on the same card throws it
    const el = $('hand').querySelector('[data-card="' + c + '"]'); lastThrown = el && el.getBoundingClientRect();
    sel = null; hideCard = c; act({ type: 'discard', card: c }); return;
  }
  sel = c; sfx.tick(); render();
}
$('stock').onclick = () => { if (!noClick && canDraw('stock')) { sfx.tick(); act({ type: 'draw', source: 'stock' }); } };
$('disc').onclick = () => { if (!noClick && canDraw('discard')) { sfx.tick(); act({ type: 'draw', source: 'discard' }); } };
$('stock').onpointerdown = e => beginDrag(e, 'stock', null, $('stock'));
$('disc').onpointerdown = e => beginDrag(e, 'discard', S && S.game && S.game.discardTop, $('disc'));
// your own pairing (if you made one) is only used to lay the cards out the way you arranged them
$('showBtn').onclick = () => { if (pending) return; sfx.tick(); buzz(15); act(allPaired() ? { type: 'show', pairs: arr.map(g => g.slice()) } : { type: 'show' }); };
$('sortBtn').onclick = () => {   // orders by rank only - it never pairs anything for you
  const jr = S && S.game && S.game.jokerRank, rk = c => c.slice(0, -1) === jr ? 99 : RANK_ORDER.indexOf(c.slice(0, -1));
  arr = arr.slice().sort((a, b) => Math.min(...a.map(rk)) - Math.min(...b.map(rk)));
  sfx.tick(); saveArr(); render();
};
addEventListener('resize', () => { if (S && S.game) layoutHand(); });

// ---------- lobby / landing ----------
const nickOk = () => { const v = $('nick').value.trim(); if (v) { store.set('ludo3d.nick', v); return v; } toast('Enter your name first'); $('nick').focus(); return null; };
$('nick').value = store.get('ludo3d.nick') || '';
$('bCreate').onclick = () => { const n = nickOk(); if (n) { sfx.tick(); wantResume = true; send({ t: 'jp:create', name: n }); } };
$('bJoin').onclick = () => { const n = nickOk(), c = $('code').value.trim().toUpperCase(); if (!n) return; if (!/^[A-Z0-9]{5}$/.test(c)) return toast('Enter the 5-character code'); sfx.tick(); wantResume = true; send({ t: 'jp:join', code: c, name: n }); };
$('code').onkeydown = e => { if (e.key == 'Enter') $('bJoin').onclick(); };
$('cCode').onclick = () => copy(S.room.code); $('cLink').onclick = () => copy(LINK + S.room.code);
$('lready').onclick = () => { const p = S.room.players.find(x => x.pid === me); sfx.tick(); send({ t: 'jp:ready', ready: !(p && p.ready) }); };
$('lstart').onclick = () => { sfx.tick(); send({ t: 'jp:start' }); };
$('again').onclick = () => { const p = S.room.players.find(x => x.pid === me); sfx.tick(); send({ t: 'jp:ready', ready: !(p && p.ready) }); };
const leave = () => { send({ t: 'jp:leave' }); clearSess(); S = null; deal = null; show('qconf', false); render(); };
$('lleave').onclick = $('home').onclick = leave;
$('qbtn').onclick = () => show('qconf', true); $('qno').onclick = () => show('qconf', false); $('qyes').onclick = leave;
const paintSnd = () => { $('snd').textContent = snd ? '🔊' : '🔇'; }; paintSnd();
$('snd').onclick = () => { snd = !snd; store.set('ludo3d.sfx', snd ? '1' : '0'); paintSnd(); };
function showResume(s) { const r = $('resume'); r.style.display = 'flex'; $('rtxt').textContent = 'Room ' + s.code;
  $('rgo').onclick = () => { r.style.display = 'none'; kicked = false; wantResume = true; send({ t: 'jp:resume', code: s.code, token: s.token }); };
  $('rno').onclick = () => { r.style.display = 'none'; clearSess(); }; }

// ---------- start ----------
const inv = (location.hash.match(/room=([A-Za-z0-9]{5})/) || [])[1];
if (inv) { $('code').value = inv.toUpperCase(); if (!tabSess()) toast('Enter your name to join room ' + inv.toUpperCase()); }
addEventListener('net', e => { if (e.detail == 'down' && S) toast('Connection lost · reconnecting…'); });
render();
if (!net) { $('onl').textContent = 'Online play is unavailable right now. Try reloading.'; return; }
net.on(onMsg);
if (net.online()) onMsg({ t: 'welcome' });
})();
