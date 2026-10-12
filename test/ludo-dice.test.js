// Ludo online dice: the server rolls, keeps the move order, and can't be talked into a number.
const test = require('node:test');
const assert = require('node:assert');
const { createLudoDice } = require('../games/ludo/dice');

const R = 'ludo-abcde';
const roll = (d, n, g = 0, v) => d.handle(R, 'g', { k: 'r', n, g, v });
const pick = (d, n, i, g = 0) => d.handle(R, 'g', { k: 'p', n, g, i });

test('the client cannot choose its roll; repeats return the same value to everyone', () => {
  const d = createLudoDice({ randInt: () => 3 });
  const [o] = roll(d, 0, 0, 6);
  assert.deepStrictEqual(o, { to: 'all', topic: 'g', data: { k: 'r', v: 3, n: 0, g: 0 } });
  assert.deepStrictEqual(roll(d, 0, 0, 6)[0].data.v, 3);   // asking again can't re-roll
});

test('decisions are kept in order: no skipping ahead, conflicting picks lose to the first', () => {
  const d = createLudoDice({ randInt: () => 6 });
  roll(d, 0);
  assert.strictEqual(roll(d, 2)[0].topic, 'log');          // n=1 not decided yet: can't peek at a later roll
  assert.strictEqual(pick(d, 1, 2)[0].to, 'all');
  const [c] = pick(d, 1, 3);                                // someone else claims a different pawn for the same step
  assert.deepStrictEqual(c, { to: 'me', topic: 'log', data: { g: 0, l: '6c' } });
  assert.strictEqual(pick(d, 2, 9).length, 0);              // bad pawn index ignored
  assert.deepStrictEqual(d.handle(R, 'sync', { g: 0 })[0].data, { g: 0, l: '6c' });
});

test('play again starts a fresh log; stale and far-future games are refused', () => {
  const d = createLudoDice({ randInt: () => 2 });
  roll(d, 0); roll(d, 1);
  assert.strictEqual(roll(d, 0, 5).length, 0);              // jumping games ahead
  assert.strictEqual(roll(d, 0, 1)[0].data.g, 1);           // next game
  assert.strictEqual(roll(d, 2, 0)[0].topic, 'log');        // old game: told where we are
  assert.deepStrictEqual(d.handle(R, 'sync', { g: 0 })[0].data, { g: 1, l: '2' });
});

test('seeding a log is only allowed right after a server restart, and only into an empty room', () => {
  let t = 0; const d = createLudoDice({ now: () => t });
  assert.strictEqual(d.handle(R, 'seed', { g: 0, l: '6a6b' })[0].data.l, '6a6b');
  assert.strictEqual(d.handle(R, 'seed', { g: 0, l: '666666' }).length, 0);   // already has a log
  t = 10 * 60e3;
  assert.strictEqual(d.handle('ludo-zzzzz', 'seed', { g: 0, l: '666' }).length, 0);   // long after boot
});

test('rolls are uniform 1-6 (chi-square over 60,000 server rolls)', () => {
  const d = createLudoDice(), c = [0, 0, 0, 0, 0, 0], N = 60000;
  for (let i = 0; i < N; i++) { const room = 'ludo-' + (i / 5000 | 0); const n = i % 5000; c[d.handle(room, 'g', { k: 'r', n, g: 0 })[0].data.v - 1]++; }
  const e = N / 6, chi = c.reduce((s, x) => s + (x - e) ** 2 / e, 0);
  assert.ok(chi < 20.5, 'chi-square ' + chi + ' counts ' + c);   // p ~ 0.001 for 5 degrees of freedom
});
