// Fairness: the shuffle, the deal and the choice of who starts must have no built-in bias.
// These are statistical tests with a false-alarm rate of about one in a million per check
// (chi-square at p = 1e-6). They check for UNBIASED randomness, not equal results:
// natural streaks are expected and allowed.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const cards = require('../games/jutpatti/cards');
const engine = require('../games/jutpatti/engine');
const { harness, botMove } = require('./helpers/jp-harness');

// Wilson-Hilferty approximation of the chi-square critical value for one-sided p ~= 1e-6.
const crit = df => df * Math.pow(1 - 2 / (9 * df) + 4.753 * Math.sqrt(2 / (9 * df)), 3);
const chi2 = (obs, exp) => obs.reduce((s, o, i) => s + (o - exp[i]) ** 2 / exp[i], 0);
function assertUniform(counts, label) {
  const total = counts.reduce((a, b) => a + b, 0), exp = counts.map(() => total / counts.length);
  const x = chi2(counts, exp), c = crit(counts.length - 1);
  assert.ok(x < c, `${label}: chi2=${x.toFixed(1)} >= ${c.toFixed(1)} counts=${counts.join(',')}`);
}

test('Fisher-Yates: all 24 orderings of 4 items are equally likely', () => {
  const N = 240000, perms = new Map();
  for (let i = 0; i < N; i++) { const k = cards.shuffle(['a', 'b', 'c', 'd']).join(''); perms.set(k, (perms.get(k) || 0) + 1); }
  assert.strictEqual(perms.size, 24);
  assertUniform([...perms.values()], 'permutations');
});

test('the uniformity check is not vacuous: it catches a classic biased shuffle', () => {
  // naive "swap with any position" shuffle - a well-known bias
  const naive = a => { for (let i = 0; i < a.length; i++) { const j = crypto.randomInt(a.length); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const perms = new Map();
  for (let i = 0; i < 240000; i++) { const k = naive(['a', 'b', 'c', 'd']).join(''); perms.set(k, (perms.get(k) || 0) + 1); }
  assert.throws(() => assertUniform([...perms.values()], 'naive'));
});

test('every card is equally likely to land in every seat (and as the shown card)', () => {
  const N = 20000, P = ['s0', 's1', 's2', 's3'], H = 7;
  const seat = P.map(() => Object.fromEntries(cards.ALL.map(c => [c, 0]))), shown = Object.fromEntries(cards.ALL.map(c => [c, 0]));
  for (let i = 0; i < N; i++) {
    const g = engine.createGame({ players: P, handSize: H, dealerIndex: 0 });
    P.forEach((p, k) => g.hands[p].forEach(c => seat[k][c]++));
    shown[g.shown]++;
  }
  seat.forEach((m, k) => assertUniform(Object.values(m), 'seat ' + k));
  assertUniform(Object.values(shown), 'shown card');
  // jokers in hand: no seat gets more on average
  const jokersPerSeat = P.map(() => 0);
  for (let i = 0; i < N; i++) {
    const g = engine.createGame({ players: P, handSize: H, dealerIndex: 0 });
    P.forEach((p, k) => { jokersPerSeat[k] += g.hands[p].filter(c => c.slice(0, -1) === g.jokerRank).length; });
  }
  assertUniform(jokersPerSeat, 'jokers per seat');
});

test('dealing depends only on seat position, never on player ids or names', () => {
  const seq = Array.from({ length: 60 }, () => crypto.randomInt(1e9));
  const det = () => { let i = 0; return n => seq[i++ % seq.length] % n; };
  const a = engine.createGame({ players: ['a', 'b', 'c'], handSize: 7, dealerIndex: 1, randInt: det() });
  const b = engine.createGame({ players: ['host', 'zz-cheater', '0000'], handSize: 7, dealerIndex: 1, randInt: det() });
  assert.deepStrictEqual(Object.values(a.hands), Object.values(b.hands));
});

test('the first dealer (and so the first player) is chosen uniformly; the host gets no edge', () => {
  const N = 6000, firstIsHost = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const h = harness(), host = h.client(); host.msg({ t: 'jp:create', name: 'Host' });
    const code = host.last('jp:joined').code;
    for (let k = 1; k < 3; k++) { const c = h.client(); c.msg({ t: 'jp:join', code, name: 'P' + k }); c.msg({ t: 'jp:ready', ready: true }); }
    host.msg({ t: 'jp:start' });
    const room = h.srv.rooms.get(code);
    firstIsHost[room.game.players.indexOf(room.game.current)]++;
  }
  assertUniform(firstIsHost, 'starting seat');
});

test('large simulation: no seat wins more often than chance allows', () => {
  // 4 identical bots, dealer chosen with the same secure randomness the server uses.
  const N = 20000, P = ['s0', 's1', 's2', 's3'], wins = [0, 0, 0, 0];
  let noWinner = 0;
  for (let i = 0; i < N; i++) {
    const g = engine.createGame({ players: P, handSize: 7, dealerIndex: crypto.randomInt(P.length) });
    while (g.status === 'playing') { const pid = g.current; engine.applyMove(g, pid, botMove({ game: engine.viewFor(g, pid) })); }
    if (g.winner) wins[P.indexOf(g.winner)]++; else noWinner++;
  }
  assert.ok(noWinner < N * 0.05, 'too many unfinished games: ' + noWinner);
  assertUniform(wins, 'wins per seat');
});
