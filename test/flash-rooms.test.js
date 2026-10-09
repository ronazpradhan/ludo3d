// Flash rooms: rounds of 10 games, chips reset per round, turn clock, anti-cheat, fairness.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const cards = require('../games/common/cards');
const engine = require('../games/flash/engine');
const rules = require('../games/flash/rules');
const { createFlashServer } = require('../games/flash/rooms');

function harness() {
  let t = 1e12;
  const srv = createFlashServer({ send: (ws, o) => ws.inbox.push(JSON.parse(JSON.stringify(o))), now: () => t, log: () => {} });
  const client = () => {
    const ws = { inbox: [] };
    ws.msg = m => { t += 50; srv.handle(ws, m); };
    ws.last = type => { for (let i = ws.inbox.length - 1; i >= 0; i--) if (ws.inbox[i].t === type) return ws.inbox[i]; return null; };
    ws.state = () => ws.last('fl:state');
    ws.lastErr = () => { const e = ws.last('fl:err'); return e && e.code; };
    ws.act = (move, extra = {}) => ws.msg({ t: 'fl:act', v: ws.state().game.version, aid: crypto.randomBytes(6).toString('hex'), move, ...extra });
    return ws;
  };
  return { srv, client, advance: ms => { t += ms; srv.sweep(); } };
}
function table(n = 3) {
  const h = harness(), host = h.client(); host.msg({ t: 'fl:create', name: 'P0' });
  const code = host.last('fl:joined').code, socks = [host];
  for (let i = 1; i < n; i++) { const c = h.client(); c.msg({ t: 'fl:join', code, name: 'P' + i }); c.msg({ t: 'fl:ready', ready: true }); socks.push(c); }
  host.msg({ t: 'fl:start' });
  const room = h.srv.rooms.get(code), who = pid => socks.find(s => s.state().you === pid);
  return { ...h, code, socks, room, who, turn: () => who(room.game.pending ? room.game.pending.to : room.game.current) };
}
const cardsIn = (o, out = new Set()) => { if (typeof o === 'string') { if (cards.isCard(o)) out.add(o); } else if (o && typeof o === 'object') for (const v of Object.values(o)) cardsIn(v, out); return out; };
const chipSum = room => Object.values(room.chips).reduce((a, b) => a + b, 0) + (room.game && room.game.status === 'playing' ? room.game.pot : 0);

test('a round is 10 games; chips carry over between games and reset for the next round', () => {
  const r = table(3), C = rules.CONFIG;
  assert.strictEqual(r.room.round, 1);
  for (const p of r.room.players) assert.strictEqual(r.room.chips[p.pid], C.startingChips);
  for (let gameNo = 1; gameNo <= C.gamesPerRound; gameNo++) {
    assert.strictEqual(r.room.gameInRound, gameNo);
    r.turn().act({ type: 'chaal', mult: 2 });   // someone bets, then everyone else packs
    while (r.room.game.status === 'playing') r.turn().act({ type: 'pack' });
    assert.strictEqual(chipSum(r.room), 3 * C.startingChips);   // chips move between players, never appear or vanish
    if (gameNo < C.gamesPerRound) {
      assert.strictEqual(r.room.status, 'playing');
      r.advance(C.nextGameSeconds * 1000 + 10);                  // next game starts by itself after the pause
    }
  }
  assert.strictEqual(r.room.status, 'over');
  assert.ok(r.room.history.some(e => e.type === 'ROUND_OVER'));
  r.socks.forEach(s => s.msg({ t: 'fl:ready', ready: true }));   // everyone taps "next round"
  assert.strictEqual(r.room.round, 2); assert.strictEqual(r.room.gameInRound, 1);
  for (const p of r.room.players) assert.strictEqual(r.room.game.chips[p.pid] + r.room.game.invested[p.pid], C.startingChips);   // fresh chips (minus this game's boot)
});

test('the round ends early if fewer than 2 players can still pay the boot (after the pause, so they could borrow)', () => {
  const r = table(2), broke = r.room.players[1].pid;
  r.room.game.chips[broke] = 0;                      // P1 is out of chips after this game
  while (r.room.game.status === 'playing') { const s = r.turn(); s.act(s.state().you === broke ? { type: 'pack' } : { type: 'pack' }); }
  r.room.chips[broke] = 0;
  assert.strictEqual(r.room.status, 'playing');      // not yet: there's a pause to borrow in
  r.advance(rules.CONFIG.nextGameSeconds * 1000 + 10);
  assert.strictEqual(r.room.status, 'over');
});

test("blind players' cards stay on the server; opponents' cards are never sent", () => {
  const r = table(4);
  for (const s of r.socks) assert.strictEqual(cardsIn(s.state()).size, 0, 'cards sent to a blind player');
  const s0 = r.socks[1]; s0.msg({ t: 'fl:act', v: r.room.game.version, aid: 'see1', move: { type: 'see' } });
  const mine = r.room.game.hands[s0.state().you];
  assert.deepStrictEqual([...cardsIn(s0.state())].sort(), mine.slice().sort());
  for (const s of r.socks) if (s !== s0) assert.strictEqual(cardsIn(s.state()).size, 0);
});

test('anti-cheat: wrong turn, other ids, fake amounts/winners, replays and stale versions are refused', () => {
  const r = table(3), g = r.room.game, cur = r.turn(), other = r.socks.find(s => s !== cur);
  const v = g.version, chipsBefore = JSON.stringify(g.chips);
  other.act({ type: 'chaal', mult: 1 }, { pid: g.current });
  assert.strictEqual(other.lastErr(), 'NOT_YOUR_TURN');
  cur.act({ type: 'chaal', mult: 1, amount: 0 });                       // a made-up amount field is ignored
  assert.strictEqual(g.chips[g.players[0]] <= 990, true);
  cur.msg({ t: 'fl:win' }); cur.msg({ t: 'fl:state', game: { winner: 'me' } }); cur.msg({ t: 'fl:chips', chips: 999999 });
  const msg = { t: 'fl:act', v: g.version, aid: 'dupe', move: { type: 'chaal', mult: 1 } };
  const nxt = r.turn(); nxt.msg(msg); const after = g.version; nxt.msg(msg); nxt.msg({ ...msg, aid: 'dupe2' });
  assert.strictEqual(g.version, after);                                 // applied once
  assert.strictEqual(nxt.lastErr(), 'STALE');
  assert.notStrictEqual(JSON.stringify(g.chips), chipsBefore);
  assert.ok(v < g.version);
  for (const p of g.players) assert.ok(g.chips[p] <= 1000);              // nobody gained chips from fake messages
});

test('the turn clock packs a player who does nothing', () => {
  const r = table(3), first = r.room.game.current;
  r.advance(rules.CONFIG.turnSeconds * 1000 + 1000);
  assert.ok(r.room.game.packed.includes(first));
  assert.ok(r.room.history.some(e => e.type === 'PACKED' && e.pid === first && e.why === 'timeout'));
});

test('a player who leaves mid-game packs; their bet stays in the pot', () => {
  const r = table(3), g = r.room.game, quitter = r.socks[2], qid = quitter.state().you;
  quitter.msg({ t: 'fl:leave' });
  assert.ok(g.packed.includes(qid));
  assert.strictEqual(g.pot, 30);
});

test('fair deal: every card equally likely in every seat; dealer chosen uniformly', () => {
  const crit = df => df * Math.pow(1 - 2 / (9 * df) + 4.753 * Math.sqrt(2 / (9 * df)), 3);
  const uniform = (counts, label) => { const tot = counts.reduce((a, b) => a + b, 0), e = tot / counts.length, x = counts.reduce((s, o) => s + (o - e) ** 2 / e, 0);
    assert.ok(x < crit(counts.length - 1), `${label}: chi2=${x.toFixed(1)}`); };
  const P = ['s0', 's1', 's2', 's3'], seat = P.map(() => Object.fromEntries(cards.ALL.map(c => [c, 0])));
  for (let i = 0; i < 30000; i++) {
    const g = engine.createGame({ players: P, chips: { s0: 100, s1: 100, s2: 100, s3: 100 }, dealerIndex: 0 });
    P.forEach((p, k) => g.hands[p].forEach(c => seat[k][c]++));
  }
  seat.forEach((m, k) => uniform(Object.values(m), 'seat ' + k));
  const firstDealer = [0, 0, 0];
  for (let i = 0; i < 3000; i++) { const r = table(3); firstDealer[r.room.game.players.indexOf(r.room.game.dealer)]++; }
  uniform(firstDealer, 'first dealer');
});

test('large simulation: no seat wins more chips than chance allows', () => {
  // identical random bots; dealer chosen with the same secure randomness the server uses
  const P = ['s0', 's1', 's2', 's3'], wins = [0, 0, 0, 0];
  for (let i = 0; i < 20000; i++) {
    const g = engine.createGame({ players: P, chips: { s0: 1000, s1: 1000, s2: 1000, s3: 1000 }, dealerIndex: crypto.randomInt(4) });
    while (g.status === 'playing') {
      const p = g.pending ? g.pending.to : g.current, o = engine.options(g, p), r = Math.random();
      const m = o.reply ? { type: 'reply', accept: true } : o.see && r < .5 ? { type: 'see' } : o.show ? { type: 'show' }
        : o.chaal.length && r < .8 ? { type: 'chaal', mult: o.chaal[0].mult } : { type: 'pack' };
      engine.applyMove(g, p, m);
    }
    wins[P.indexOf(g.result.winner)]++;
  }
  const tot = wins.reduce((a, b) => a + b, 0), e = tot / 4, x = wins.reduce((s, o) => s + (o - e) ** 2 / e, 0);
  // seat order matters in betting games (who acts first), but the dealer rotates randomly, so no seat should be favoured
  assert.ok(x < 3 * Math.pow(1 - 2 / 27 + 4.753 * Math.sqrt(2 / 27), 3), 'wins per seat ' + wins.join(','));
});
