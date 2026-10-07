// Test harness: drives the Jutpatti room server with fake sockets (no network needed).
const { createJutpattiServer } = require('../../games/jutpatti/rooms');
const rules = require('../../games/jutpatti/rules');

function harness(opts = {}) {
  let t = 1e12;
  const srv = createJutpattiServer({ send: (ws, o) => ws.inbox.push(JSON.parse(JSON.stringify(o))), now: () => t, log: () => {}, ...opts });
  const client = () => {
    const ws = { inbox: [] };
    ws.msg = m => { t += 50; srv.handle(ws, m); };   // a human-ish pace, so the rate limit doesn't trip
    ws.burst = m => srv.handle(ws, m);              // no time passes: for flooding tests
    ws.last = type => { for (let i = ws.inbox.length - 1; i >= 0; i--) if (ws.inbox[i].t === type) return ws.inbox[i]; return null; };
    ws.state = () => ws.last('jp:state');
    ws.errs = () => ws.inbox.filter(m => m.t === 'jp:err').map(m => m.code);
    ws.lastErr = () => { const e = ws.last('jp:err'); return e && e.code; };
    ws.clear = () => { ws.inbox.length = 0; };
    ws.act = (move, extra = {}) => { const g = ws.state().game; ws.msg({ t: 'jp:act', v: g.version, aid: Math.random().toString(36).slice(2), move, ...extra }); };
    return ws;
  };
  return { srv, client, advance: ms => { t += ms; } };
}

// Creates a room with n players, everyone ready, game started. Returns sockets in seat order.
// Retries until the first player's stock draw does not instantly win, so tests can count on a discard phase.
function startedRoom(n = 3) {
  for (;;) {
    const r = startedRoomOnce(n), g = r.room.game;
    if (!rules.isWinningHand([...g.hands[g.current], g.stock[g.stock.length - 1]], g.jokerRank)) return r;
  }
}
function startedRoomOnce(n, h = harness()) {
  const host = h.client(); host.msg({ t: 'jp:create', name: 'P0' });
  const code = host.last('jp:joined').code, socks = [host];
  for (let i = 1; i < n; i++) { const c = h.client(); c.msg({ t: 'jp:join', code, name: 'P' + i }); c.msg({ t: 'jp:ready', ready: true }); socks.push(c); }
  host.msg({ t: 'jp:start' });
  return { ...h, code, socks, room: h.srv.rooms.get(code) };
}

// Simple bot: take the discard if it pairs an unpaired card, else the stock; throw a random unpaired non-joker.
function botMove(view, rnd = Math.random) {
  const g = view.game, y = g.you;
  if (g.phase === 'draw') {
    const d = g.discardTop, canD = y.validMoves.some(m => m.source === 'discard'), canS = y.validMoves.some(m => m.source === 'stock');
    const helps = d && (d.slice(0, -1) === g.jokerRank || y.singles.some(c => c.slice(0, -1) === d.slice(0, -1)));
    return (helps && canD) || !canS ? { type: 'draw', source: 'discard' } : { type: 'draw', source: 'stock' };
  }
  const pool = y.singles.filter(c => c.slice(0, -1) !== g.jokerRank);
  const choice = pool.length ? pool : y.hand;
  return { type: 'discard', card: choice[Math.floor(rnd() * choice.length)] };
}

module.exports = { harness, startedRoom, botMove };
