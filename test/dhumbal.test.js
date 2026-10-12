// Dhumbal: rules, turn flow, Jhyap scoring, hidden cards, anti-cheat, reshuffle, timeouts, fairness.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const cards = require('../games/common/cards');
const rules = require('../games/dhumbal/rules');
const engine = require('../games/dhumbal/engine');
const { createDhumbalServer } = require('../games/dhumbal/rooms');

const T0 = 1e12, mv = (g, p, m) => engine.applyMove(g, p, m, { now: T0 + 1000 });
function game(n = 3, hands, open) {
  const ps = 'abcde'.slice(0, n).split('');
  const g = engine.createGame({ players: ps, dealerIndex: n - 1, now: T0 });   // 'a' plays first
  if (hands) Object.assign(g.hands, hands);
  if (open) { g.pile = [[open]]; g.pickable = [open]; }
  return g;
}
const cardsIn = (o, out = new Set()) => { if (typeof o === 'string') { if (cards.isCard(o)) out.add(o); } else if (o && typeof o === 'object') for (const v of Object.values(o)) cardsIn(v, out); return out; };

test('card points and what can be thrown', () => {
  assert.strictEqual(rules.total(['AH', '10S', 'JD', 'QC', 'KH']), 1 + 10 + 11 + 12 + 13);
  assert.strictEqual(rules.throwKind(['7H']), 'single');
  assert.strictEqual(rules.throwKind(['7H', '7S']), 'set');
  assert.strictEqual(rules.throwKind(['7H', '7S', '7D']), 'set');
  assert.strictEqual(rules.throwKind(['5H', '6H', '7H']), 'run');
  assert.strictEqual(rules.throwKind(['7H', '5H', '6H']), 'run');      // any order
  assert.strictEqual(rules.throwKind(['AH', '2H', '3H']), 'run');      // ace low
  assert.strictEqual(rules.throwKind(['QH', 'KH', 'AH']), null);       // ace high off by default
  assert.strictEqual(rules.throwKind(['5H', '6S', '7H']), null);       // mixed suits
  assert.strictEqual(rules.throwKind(['5H', '6H']), null);             // runs need 3
  assert.strictEqual(rules.throwKind(['5H', '7H', '8H']), null);       // gap
  assert.strictEqual(rules.throwKind(['7H', '7H']), null);             // same card twice
  assert.strictEqual(rules.throwKind([]), null);
});

test('deal: 5 cards each, one open card, everything accounted for', () => {
  for (let n = 2; n <= 5; n++) {
    const g = game(n), all = [...g.players.flatMap(p => g.hands[p]), ...g.stock, ...g.pile.flat()];
    for (const p of g.players) assert.strictEqual(g.hands[p].length, 5);
    assert.strictEqual(all.length, 52); assert.strictEqual(new Set(all).size, 52);
  }
});

test('a turn: throw first, then draw (deck or the previous throw); then the next player', () => {
  const g = game(3, { a: ['7H', '7S', '2C', 'KD', '9S'] }, '4D');
  assert.strictEqual(mv(g, 'a', { type: 'draw', source: 'stock' }).error, 'WRONG_PHASE');   // must throw first
  assert.ok(mv(g, 'a', { type: 'throw', cards: ['7H', '7S'] }).ok);
  assert.strictEqual(mv(g, 'a', { type: 'throw', cards: ['2C'] }).error, 'WRONG_PHASE');
  assert.ok(mv(g, 'a', { type: 'draw', source: 'pile', card: '4D' }).ok);                  // took the open card
  assert.deepStrictEqual(g.hands.a.sort(), ['2C', '4D', '9S', 'KD'].sort());
  assert.strictEqual(g.current, 'b');
  assert.deepStrictEqual(g.pickable.sort(), ['7H', '7S']);                                 // b may take one of a's 7s
});

test('illegal throws and draws are refused and change nothing', () => {
  const g = game(3, { a: ['7H', '7S', '2C', 'KD', '9S'], b: ['3H', '4H', '5H', '6S', '8D'] }, '4D');
  const before = JSON.stringify(g);
  const bad = [
    ['b', { type: 'throw', cards: ['3H'] }, 'NOT_YOUR_TURN'],
    ['a', { type: 'throw', cards: ['3H'] }, 'NOT_OWNED'],                 // b's card
    ['a', { type: 'throw', cards: ['7H', '2C'] }, 'BAD_THROW'],
    ['a', { type: 'throw', cards: ['ZZ'] }, 'BAD_REQUEST'],
    ['a', { type: 'throw', cards: [] }, 'BAD_THROW'],
    ['a', { type: 'throw', cards: '7H' }, 'BAD_REQUEST'],
    ['a', { type: 'show' }, 'TOO_MANY_POINTS'],                           // 7+7+2+13+9 = 38
    ['a', { type: 'win' }, 'BAD_REQUEST'],
    ['z', { type: 'throw', cards: ['7H'] }, 'NOT_IN_GAME'],
  ];
  for (const [p, m, code] of bad) assert.strictEqual(mv(g, p, m).error, code, JSON.stringify(m));
  assert.strictEqual(JSON.stringify(g), before);
  mv(g, 'a', { type: 'throw', cards: ['KD'] });
  assert.strictEqual(mv(g, 'a', { type: 'draw', source: 'pile', card: 'KD' }).error, 'NOT_PICKABLE');   // not your own throw
  assert.strictEqual(mv(g, 'a', { type: 'draw', source: 'pile', card: '3H' }).error, 'NOT_PICKABLE');
});

test('Jhyap: the caller with the lowest hand collects everyone\'s totals', () => {
  const g = game(3, { a: ['AH', '2S', '3D', '2C', 'AS'], b: ['KH', 'QS', '5D', '6C', '7S'], c: ['9H', '9S', '8D', '4C', '3S'] });
  assert.ok(engine.options(g, 'a').show);
  assert.ok(mv(g, 'a', { type: 'show' }).ok);
  const r = g.result;
  assert.strictEqual(r.winner, 'a'); assert.strictEqual(r.reason, 'jhyap');
  assert.deepStrictEqual(r.pay, { a: 43 + 33, b: -43, c: -33 });
  assert.strictEqual(Object.values(r.pay).reduce((x, y) => x + y, 0), 0);
});

test('Jhyap caught: someone with an equal or lower hand wins, and the caller pays everyone\'s totals', () => {
  const g = game(3, { a: ['AH', '2S', '3D', '2C', 'AS'], b: ['AC', 'AD', '2H', '3C', '2D'], c: ['9H', '9S', '8D', '4C', '3S'] });
  mv(g, 'a', { type: 'show' });   // a: 9, b: 9 (tie counts against the caller), c: 33
  const r = g.result;
  assert.strictEqual(r.winner, 'b'); assert.strictEqual(r.reason, 'caught');
  assert.deepStrictEqual(r.pay, { a: -51, b: 51, c: 0 });
});

test('nobody sees other hands (or the deck) until a Jhyap reveals them all', () => {
  const g = game(4);
  for (const p of g.players) {
    const seen = cardsIn(engine.viewFor(g, p, T0)), ok = new Set([...g.hands[p], ...g.pile.flat()]);
    for (const c of seen) assert.ok(ok.has(c), p + ' saw ' + c);
  }
  mv(g, 'a', { type: 'throw', cards: [g.hands.a[0]] }); mv(g, 'a', { type: 'draw', source: 'stock' });
  const drawn = g.lastDraw.card;
  for (const p of ['b', 'c', 'd']) assert.ok(!cardsIn(engine.viewFor(g, p, T0)).has(drawn) || g.pile.flat().includes(drawn));
});

test('the deck is rebuilt from the throw pile when it runs out', () => {
  const g = game(2);
  for (let k = 0; k < 400 && g.status === 'playing'; k++) {
    const p = g.current; mv(g, p, { type: 'throw', cards: [g.hands[p][0]] }); mv(g, p, { type: 'draw', source: 'stock' });
    const all = [...g.players.flatMap(x => g.hands[x]), ...g.stock, ...g.pile.flat()];
    assert.strictEqual(new Set(all).size, 52); assert.strictEqual(all.length, 52);
  }
});

test('turn clock: throws the highest card and draws for the player', () => {
  const g = game(2, { a: ['AH', 'KS', '3D', '2C', '4S'] });
  assert.deepStrictEqual(engine.timeout(g, T0 + 29e3), []);
  engine.timeout(g, T0 + 31e3);
  assert.ok(!g.hands.a.includes('KS')); assert.strictEqual(g.hands.a.length, 5); assert.strictEqual(g.current, 'b');
});

test('rooms: points add up across games; anti-cheat over the socket', () => {
  let t = 1e12;
  const srv = createDhumbalServer({ send: (ws, o) => ws.inbox.push(JSON.parse(JSON.stringify(o))), now: () => t, log: () => {} });
  const cl = () => { const ws = { inbox: [] }; ws.msg = m => { t += 50; srv.handle(ws, m); }; ws.last = k => ws.inbox.filter(m => m.t === k).pop(); ws.st = () => ws.last('dh:state'); ws.err = () => (ws.last('dh:err') || {}).code; return ws; };
  const a = cl(), b = cl(); a.msg({ t: 'dh:create', name: 'A' }); const code = a.last('dh:joined').code;
  b.msg({ t: 'dh:join', code, name: 'B' }); b.msg({ t: 'dh:ready', ready: true }); a.msg({ t: 'dh:start' });
  const room = srv.rooms.get(code), g = room.game, A = a.st().you, B = b.st().you, cur = g.current === A ? a : b, other = cur === a ? b : a;
  // other player's id in the message does nothing; their card is not yours; replays and fake winners ignored
  other.msg({ t: 'dh:act', v: g.version, aid: 'x1', move: { type: 'throw', cards: [g.hands[g.current][0]] }, pid: g.current }); assert.strictEqual(other.err(), 'NOT_YOUR_TURN');
  cur.msg({ t: 'dh:act', v: g.version, aid: 'x2', move: { type: 'throw', cards: [g.hands[other.st().you][0]] } }); assert.strictEqual(cur.err(), 'NOT_OWNED');
  cur.msg({ t: 'dh:win' }); cur.msg({ t: 'dh:act', v: g.version + 3, aid: 'x3', move: { type: 'show' } }); assert.strictEqual(cur.err(), 'STALE');
  for (const s of [a, b]) for (const c of cardsIn(s.st())) assert.ok(g.hands[s.st().you].includes(c) || g.pile.flat().includes(c));
  // force a Jhyap and check the points
  g.hands[g.current] = ['AH', 'AS', '2D', '2C', '3S']; g.hands[other.st().you] = ['KH', 'KS', 'QD', 'QC', 'JS'];
  cur.msg({ t: 'dh:act', v: g.version, aid: 'show', move: { type: 'show' } });
  assert.strictEqual(room.status, 'over');
  assert.strictEqual(room.points[cur.st().you], 61); assert.strictEqual(room.points[other.st().you], -61);
  for (const s of [a, b]) assert.strictEqual(Object.keys(s.st().game.result.hands).length, 2);   // everyone sees every hand at a Jhyap
  a.msg({ t: 'dh:ready', ready: true }); b.msg({ t: 'dh:ready', ready: true });
  assert.strictEqual(room.status, 'playing'); assert.strictEqual(room.gameNo, 2);
  assert.strictEqual(room.points[A] + room.points[B], 0);
});

test('fair deal: every card equally likely in every seat', () => {
  const crit = df => df * Math.pow(1 - 2 / (9 * df) + 4.753 * Math.sqrt(2 / (9 * df)), 3);
  const P = ['s0', 's1', 's2', 's3'], seat = P.map(() => Object.fromEntries(cards.ALL.map(c => [c, 0])));
  for (let i = 0; i < 20000; i++) { const g = engine.createGame({ players: P, dealerIndex: 0 }); P.forEach((p, k) => g.hands[p].forEach(c => seat[k][c]++)); }
  for (const m of seat) { const v = Object.values(m), e = v.reduce((a, b) => a + b, 0) / 52, x = v.reduce((s, o) => s + (o - e) ** 2 / e, 0); assert.ok(x < crit(51), 'chi2 ' + x); }
});
