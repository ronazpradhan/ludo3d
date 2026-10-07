// Jutpatti client: draws whatever state the server sends and sends the player's intents.
// It has NO game logic and is never trusted: the server owns the deck, hands, turns, legal
// moves and the winner. This browser only ever receives its own cards.
(() => {
const $ = id => document.getElementById(id);
const SKEY = 'jutpatti.session', LINK = location.origin + location.pathname + '#room=';
const COLORS = ['#fbc916', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f97316'];
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' }, SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const ERR = {
  NAME_REQUIRED: 'Enter your name first', ROOM_NOT_FOUND: 'Room not found', ROOM_FULL: 'That room is full (6 players)',
  IN_PROGRESS: 'That game has already started', NOT_HOST: 'Only the host can do that', NOT_READY: 'Waiting for everyone to be ready',
  NOT_ENOUGH_PLAYERS: 'Need at least 2 players', PLAYER_OFFLINE: 'Someone is offline', NOT_YOUR_TURN: "It's not your turn",
  ILLEGAL_MOVE: "You can't do that now", NOT_OWNED: "That card isn't in your hand", WRONG_PHASE: "You can't do that now",
  GAME_NOT_RUNNING: 'The game is not running', RATE_LIMIT: 'Slow down a little', SERVER_FULL: 'Server is busy, try again soon',
  BAD_OPTION: 'That option is not available', SERVER_ERROR: 'Something went wrong',
};
const net = window.claude && window.claude.raw;

let S = null, me = null, sel = null, pending = null, kicked = false, wantResume = true;
let lastTurnKey = '', lastHistLen = 0, lastStatus = '';

// ---------- small helpers ----------
const toast = t => { const e = $('toast'); e.textContent = t; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 2400); };
const rid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); };
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
async function copy(t) { try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.append(a); a.select(); try { document.execCommand('copy'); } catch (e2) {} a.remove(); } toast('Copied!'); }
function show(id, on) { $(id).style.display = on ? 'flex' : 'none'; }

function cardEl(c, tag = 'div') {
  const e = document.createElement(tag), r = c.slice(0, -1), s = c.slice(-1), g = S && S.game;
  e.className = 'pc' + (s == 'H' || s == 'D' ? ' red' : '') + (g && r === g.jokerRank ? ' joker' : '');
  e.setAttribute('aria-label', r + ' of ' + SUIT_NAME[s] + (g && r === g.jokerRank ? ' (Joker)' : ''));
  e.innerHTML = '<span class="r"></span><span class="s1"></span><span class="s2"></span>';
  e.querySelector('.r').textContent = r; e.querySelector('.s1').textContent = SUIT[s]; e.querySelector('.s2').textContent = SUIT[s];
  if (tag == 'button') e.type = 'button';
  return e;
}
function setCard(el, c, cls) { el.className = 'pc ' + (cls || ''); el.innerHTML = ''; el.removeAttribute('aria-label'); if (c) { const n = cardEl(c); el.className = n.className + (cls ? ' ' + cls : ''); el.innerHTML = n.innerHTML; el.setAttribute('aria-label', n.getAttribute('aria-label')); } }

// ---------- networking ----------
function act(move) {
  const g = S && S.game; if (!g || pending) return;
  pending = rid(); render();
  send({ t: 'jp:act', v: g.version, aid: pending, move });
  setTimeout(() => { if (pending) { pending = null; send({ t: 'jp:sync' }); render(); } }, 4000);   // never get stuck
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
    if (pending && (!S.game || S.game.version !== prevVer)) pending = null;
    if (sel && !(S.game && S.game.you && S.game.you.hand.includes(sel))) sel = null;
    render();
  } else if (m.t == 'jp:err') {
    if (m.code == 'SESSION_EXPIRED') { clearSess(); S = null; render(); toast('That room is no longer available'); return; }
    if (m.code == 'STALE') return;   // the fresh state follows right after
    pending = null; toast(ERR[m.code] || 'Error: ' + m.code); render();
  } else if (m.t == 'jp:kicked') {
    kicked = true; S = null; render(); toast('This room was opened in another tab'); tabStore.del(SKEY); const s = anySess(); if (s) showResume(s);
  } else if (m.t == 'jp:left') { S = null; render(); }
}

// ---------- rendering ----------
function render() {
  const st = S ? S.room.status : 'none';
  show('landing', !S); show('lobby', st == 'lobby'); show('end', st == 'over');
  $('jtable').style.visibility = S && S.game ? 'visible' : 'hidden';
  if (!S) { lastStatus = ''; return; }
  if (st == 'lobby') renderLobby();
  renderTable();
  if (st == 'over') renderEnd();
  // sounds for things that just happened
  if (st == 'playing' && lastStatus != 'playing') sfx.start();
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

function renderTable() {
  const g = S.game, R = S.room, felt = $('seats'); felt.textContent = '';
  if (!g) { $('hand').textContent = ''; $('jstatus').textContent = ''; return; }
  const you = g.you, myTurn = g.status == 'playing' && g.current === me, conn = Object.fromEntries(R.players.map(p => [p.pid, p.connected]));
  // opponents around the top of the table, in turn order starting after me
  const order = g.players.map(p => p.pid), at = Math.max(0, order.indexOf(me));
  const others = g.players.slice(at).concat(g.players.slice(0, at)).filter(p => p.pid !== me);
  others.forEach((p, i) => {
    const a = Math.PI + (i + 1) / (others.length + 1) * Math.PI, x = 50 + 44 * Math.cos(a), y = 54 + 44 * Math.sin(a);
    const d = document.createElement('div'); d.className = 'st' + (g.current === p.pid && g.status == 'playing' ? ' on' : '') + (!p.active || conn[p.pid] === false ? ' off' : '');
    d.style.left = x + '%'; d.style.top = y + '%'; d.style.setProperty('--c', colorOf(p.pid));
    const nm = document.createElement('b'), dot = document.createElement('i'); nm.append(dot, document.createTextNode(nameOf(p.pid)));
    const fan = document.createElement('div'); fan.className = 'fan'; for (let k = 0; k < Math.min(p.cards, 8); k++) fan.append(document.createElement('span'));
    const info = document.createElement('small'); info.textContent = !p.active ? 'left' : p.cards + ' cards' + (conn[p.pid] === false ? ' · offline' : '');
    d.append(nm, fan, info);
    if (p.pid === g.dealer) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'dealer'; d.append(t); }
    felt.append(d);
  });
  // centre: stock, discard, shown card
  const canStock = myTurn && !pending && you && you.validMoves.some(m => m.source == 'stock');
  const canDisc = myTurn && !pending && you && you.validMoves.some(m => m.source == 'discard');
  $('stock').className = 'pc ' + (g.stockCount || g.discardCount > 1 ? 'down' : 'empty') + (canStock ? ' can' : '');
  $('stockN').textContent = 'Stock · ' + g.stockCount;
  setCard($('disc'), g.discardTop, (g.discardTop ? '' : 'empty') + (canDisc ? ' can' : ''));
  $('discN').textContent = 'Discard · ' + g.discardCount;
  setCard($('shownCard'), g.shown, 'sm');
  $('jokerTxt').textContent = '★ Jokers: ' + rankPlural(g.jokerRank);
  // status line
  const cur = g.current, js = $('jstatus'); let txt;
  if (g.status != 'playing') txt = 'Game over';
  else if (myTurn) txt = g.phase == 'draw' ? 'Your turn · draw from the stock or take the discard' : 'Your turn · pick a card to discard';
  else txt = 'Waiting for ' + nameOf(cur) + (conn[cur] === false ? ' (offline — they have 2 min to return)' : '…');
  js.textContent = txt; js.classList.toggle('me', myTurn);
  const tk = g.turn + ':' + cur; if (tk !== lastTurnKey) { js.classList.remove('pop'); void js.offsetWidth; js.classList.add('pop'); if (myTurn && lastTurnKey) sfx.chime(); lastTurnKey = tk; }
  // my hand (grouped into pairs by the server)
  const H = $('hand'); H.textContent = ''; H.classList.toggle('wait', !myTurn || g.phase != 'discard');
  if (you) {
    const ld = g.lastDraw && g.lastDraw.pid === me && g.status == 'playing' && g.phase == 'discard' ? g.lastDraw.card : null;
    const groups = you.pairs.map(p => ({ cards: p, pair: true })).concat(you.singles.map(c => ({ cards: [c] })));
    groups.forEach(gr => {
      const w = document.createElement('div'); w.className = 'grp' + (gr.pair ? ' pair' : '');
      gr.cards.forEach(c => {
        const e = cardEl(c, 'button'); if (c === sel) e.classList.add('sel'); if (c === ld) e.classList.add('new');
        e.onclick = () => pickCard(c); w.append(e);
      });
      H.append(w);
    });
    $('mylabel').textContent = you.pairs.length + ' pair' + (you.pairs.length == 1 ? '' : 's') + ' · ' + you.singles.length + ' unpaired' + (R.players.length ? ' · score ' + ((R.players.find(p => p.pid === me) || {}).score || 0) : '');
  } else $('mylabel').textContent = 'You are watching this game';
  const canThrow = myTurn && !pending && g.phase == 'discard' && sel && you.validMoves.some(m => m.type == 'discard' && m.card === sel);
  $('aStock').disabled = !canStock; $('aDisc').disabled = !canDisc; $('aThrow').disabled = !canThrow;
  $('aStock').style.display = $('aDisc').style.display = myTurn && g.phase == 'discard' ? 'none' : '';
  $('aThrow').style.display = myTurn && g.phase == 'discard' ? '' : 'none';
  renderLog();
}

function logLine(e) {
  const n = nameOf(e.pid);
  switch (e.type) {
    case 'GAME_STARTED': return 'New game · ' + nameOf(e.dealer) + (e.dealer === me ? ' deal' : ' deals') + ' ' + e.handSize + ' cards each';
    case 'CARDS_DEALT': return 'Shown card ' + cardTxt(e.shown) + ' · Jokers are ' + rankPlural(e.jokerRank);
    case 'CARD_DRAWN': return e.source == 'stock' ? n + ' drew from the stock' : n + ' took ' + cardTxt(e.card);
    case 'CARD_PLAYED': return n + ' discarded ' + cardTxt(e.card);
    case 'STOCK_RESHUFFLED': return 'Discard pile shuffled into a new stock';
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
  if (h.length !== lastHistLen) { const e = h[h.length - 1]; if (e && e.pid !== me && (e.type == 'CARD_PLAYED' || e.type == 'CARD_DRAWN')) sfx.tick(); lastHistLen = h.length; }
}

function renderEnd() {
  const g = S.game, R = S.room, mine = R.players.find(p => p.pid === me);
  $('etitle').textContent = !g ? 'Game over' : g.winner ? (g.winner === me ? 'You win! 🎉' : nameOf(g.winner) + ' wins!') : 'No winner this time';
  const W = $('whand'); W.textContent = '';
  if (g && g.winningPairs) g.winningPairs.forEach(p => { const w = document.createElement('div'); w.className = 'grp'; p.forEach(c => w.append(cardEl(c))); W.append(w); });
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

// ---------- input ----------
function pickCard(c) {
  const g = S && S.game; if (!g || g.current !== me || g.phase != 'discard' || pending) return;
  if (sel === c) { act({ type: 'discard', card: c }); sel = null; return; }   // second tap on the same card discards it
  sel = c; sfx.tick(); render();
}
$('stock').onclick = $('aStock').onclick = () => { if (!$('aStock').disabled) { sfx.tick(); act({ type: 'draw', source: 'stock' }); } };
$('disc').onclick = $('aDisc').onclick = () => { if (!$('aDisc').disabled) { sfx.tick(); act({ type: 'draw', source: 'discard' }); } };
$('aThrow').onclick = () => { if (sel) { const c = sel; sel = null; act({ type: 'discard', card: c }); } };

const nickOk = () => { const v = $('nick').value.trim(); if (v) { store.set('ludo3d.nick', v); return v; } toast('Enter your name first'); $('nick').focus(); return null; };
$('nick').value = store.get('ludo3d.nick') || '';
$('bCreate').onclick = () => { const n = nickOk(); if (n) { sfx.tick(); wantResume = true; send({ t: 'jp:create', name: n }); } };
$('bJoin').onclick = () => { const n = nickOk(), c = $('code').value.trim().toUpperCase(); if (!n) return; if (!/^[A-Z0-9]{5}$/.test(c)) return toast('Enter the 5-character code'); sfx.tick(); wantResume = true; send({ t: 'jp:join', code: c, name: n }); };
$('code').onkeydown = e => { if (e.key == 'Enter') $('bJoin').onclick(); };
$('cCode').onclick = () => copy(S.room.code); $('cLink').onclick = () => copy(LINK + S.room.code);
$('lready').onclick = () => { const p = S.room.players.find(x => x.pid === me); sfx.tick(); send({ t: 'jp:ready', ready: !(p && p.ready) }); };
$('lstart').onclick = () => { sfx.tick(); send({ t: 'jp:start' }); };
$('again').onclick = () => { const p = S.room.players.find(x => x.pid === me); sfx.tick(); send({ t: 'jp:ready', ready: !(p && p.ready) }); };
const leave = () => { send({ t: 'jp:leave' }); clearSess(); S = null; show('qconf', false); render(); };
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
