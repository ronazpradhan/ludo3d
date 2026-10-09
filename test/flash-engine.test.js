// Flash engine: betting rules, show, side show, timeouts, chip accounting, hidden cards.
const test = require('node:test');
const assert = require('node:assert');
const engine = require('../games/flash/engine');
const rules = require('../games/flash/rules');
const cards = require('../games/common/cards');

const T0 = 1e12;
// players a,b,c...; dealer is the last one, so 'a' acts first. Hands can be fixed for the test.
function game(n = 3, hands, chips = 1000, cfg = rules.CONFIG) {
  const ps = 'abcdef'.slice(0, n).split('');
  const g = engine.createGame({ players: ps, chips: Object.fromEntries(ps.map(p => [p, chips])), dealerIndex: n - 1, config: cfg, now: T0 });
  if (hands) Object.assign(g.hands, hands);
  return g;
}
const mv = (g, p, m) => engine.applyMove(g, p, m, { now: T0 + 1000 });
const total = g => Object.values(g.chips).reduce((a, b) => a + b, 0) + g.pot;
const cardsIn = (o, out = new Set()) => { if (typeof o === 'string') { if (cards.isCard(o)) out.add(o); } else if (o && typeof o === 'object') for (const v of Object.values(o)) cardsIn(v, out); return out; };

test('deal: 3 cards each, boot paid, everyone blind, stake = boot', () => {
  const g = game(4);
  for (const p of g.players) { assert.strictEqual(g.hands[p].length, 3); assert.strictEqual(g.chips[p], 990); assert.strictEqual(g.seen[p], false); }
  assert.strictEqual(g.pot, 40); assert.strictEqual(g.stake, 10); assert.strictEqual(g.current, 'a');
  assert.strictEqual(new Set(Object.values(g.hands).flat()).size, 12);
});

test('blind bets 1x/2x the stake, seen bets 2x/4x; the stake follows the rules', () => {
  const g = game(3);
  assert.ok(mv(g, 'a', { type: 'chaal', mult: 2 }).ok);           // blind 2x: pays 20, stake 20
  assert.strictEqual(g.stake, 20); assert.strictEqual(g.chips.a, 970);
  assert.strictEqual(mv(g, 'b', { type: 'chaal', mult: 4 }).error, 'ILLEGAL_MOVE');   // blind can't bet 4x
  assert.ok(mv(g, 'b', { type: 'see' }).ok);
  assert.strictEqual(mv(g, 'b', { type: 'chaal', mult: 1 }).error, 'ILLEGAL_MOVE');   // seen must bet at least 2x
  assert.ok(mv(g, 'b', { type: 'chaal', mult: 2 }).ok);           // seen 2x of 20 = 40, stake stays 20
  assert.strictEqual(g.stake, 20); assert.strictEqual(g.chips.b, 950);
  assert.ok(mv(g, 'c', { type: 'chaal', mult: 1 }).ok);           // blind 1x = 20
  assert.strictEqual(g.chips.c, 970); assert.strictEqual(g.current, 'a');
  assert.strictEqual(total(g), 3000);
});

test('out of turn, packed players, unknown moves and fake amounts are refused', () => {
  const g = game(3), before = JSON.stringify(g);
  assert.strictEqual(mv(g, 'b', { type: 'chaal', mult: 1 }).error, 'NOT_YOUR_TURN');
  assert.strictEqual(mv(g, 'a', { type: 'chaal', mult: 3 }).error, 'ILLEGAL_MOVE');
  assert.strictEqual(mv(g, 'a', { type: 'chaal', mult: '1' }).error, 'BAD_REQUEST');
  assert.strictEqual(mv(g, 'a', { type: 'chaal', amount: 999999 }).error, 'BAD_REQUEST');
  assert.strictEqual(mv(g, 'a', { type: 'win' }).error, 'BAD_REQUEST');
  assert.strictEqual(mv(g, 'z', { type: 'pack' }).error, 'NOT_IN_GAME');
  assert.strictEqual(mv(g, 'a', { type: 'show' }).error, 'ILLEGAL_MOVE');        // 3 players: no show
  assert.strictEqual(JSON.stringify(g), before);
  mv(g, 'a', { type: 'pack' });
  assert.strictEqual(mv(g, 'a', { type: 'see' }).error, 'PACKED');
});

test("you can't bet chips you don't have", () => {
  const g = game(2, null, 30);   // 20 left after the boot
  assert.ok(mv(g, 'a', { type: 'chaal', mult: 2 }).ok);           // 20: all of it
  assert.strictEqual(g.chips.a, 0);
  assert.ok(mv(g, 'b', { type: 'chaal', mult: 1 }).ok);           // b matches 20
  assert.deepStrictEqual(engine.options(g, 'a').chaal, []);
  assert.strictEqual(mv(g, 'a', { type: 'chaal', mult: 1 }).error, 'NOT_ENOUGH_CHIPS');
  assert.ok(engine.options(g, 'a').show.allIn);                   // ...but may still show with what's left
});

test('everyone else packs: the last player takes the pot', () => {
  const g = game(3);
  mv(g, 'a', { type: 'pack' }); mv(g, 'b', { type: 'pack' });
  assert.strictEqual(g.status, 'over'); assert.strictEqual(g.result.winner, 'c'); assert.strictEqual(g.result.reason, 'others-packed');
  assert.strictEqual(g.chips.c, 990 + 30); assert.strictEqual(g.pot, 0); assert.strictEqual(total(g), 3000);   // pot paid out
  assert.strictEqual(g.result.shown, null);                       // nobody's cards are revealed
});

test('show: blind pays the stake; higher hand wins; tie goes against the asker', () => {
  let g = game(2, { a: ['2H', '7S', '9D'], b: ['AH', 'AS', '3D'] });
  assert.deepStrictEqual(engine.options(g, 'a').show, { cost: 10, allIn: false });
  assert.ok(mv(g, 'a', { type: 'show' }).ok);
  assert.strictEqual(g.result.winner, 'b'); assert.strictEqual(g.chips.b, 990 + 30);
  assert.deepStrictEqual(Object.keys(g.result.shown).sort(), ['a', 'b']);
  g = game(2, { a: ['AH', 'KS', '9D'], b: ['AS', 'KD', '9C'] });   // identical strength
  mv(g, 'a', { type: 'show' });
  assert.strictEqual(g.result.winner, 'b');
  const v = engine.viewFor(g, 'c-not-playing', T0);   // even someone watching sees both shown hands, and that it was a tie
  assert.strictEqual(v.result.tie, true); assert.strictEqual(v.result.askedBy, 'a');
  assert.deepStrictEqual(v.result.shown.a.hand, ['AH', 'KS', '9D']); assert.deepStrictEqual(v.result.shown.b.hand, ['AS', 'KD', '9C']);
});

test('show: a seen player pays 2x, and cannot call a show on a blind player', () => {
  const g = game(2);
  mv(g, 'a', { type: 'see' });
  assert.strictEqual(engine.options(g, 'a').show, null);
  assert.strictEqual(mv(g, 'a', { type: 'show' }).error, 'ILLEGAL_MOVE');
  mv(g, 'a', { type: 'chaal', mult: 2 }); mv(g, 'b', { type: 'see' });
  assert.deepStrictEqual(engine.options(g, 'b').show, { cost: 20, allIn: false });
});

test('side show: seen asks the previous seen player; the lower hand packs; only the two see cards', () => {
  const g = game(3, { a: ['2H', '7S', '9D'], b: ['KH', 'KS', '3D'], c: ['5C', '6C', '8D'] });
  for (const p of ['a', 'b', 'c']) mv(g, p, { type: 'see' });
  mv(g, 'a', { type: 'chaal', mult: 2 });
  const o = engine.options(g, 'b').sideShow;
  assert.deepStrictEqual(o, { cost: 20, to: 'a' });
  assert.ok(mv(g, 'b', { type: 'sideshow' }).ok);
  assert.strictEqual(mv(g, 'c', { type: 'chaal', mult: 2 }).error, 'NOT_YOUR_TURN');   // waiting for a's answer
  assert.strictEqual(mv(g, 'b', { type: 'reply', accept: true }).error, 'NOT_YOUR_TURN');
  assert.ok(mv(g, 'a', { type: 'reply', accept: true }).ok);
  assert.ok(g.packed.includes('a'));                              // a had the lower hand
  assert.strictEqual(g.current, 'c');
  assert.deepStrictEqual(engine.viewFor(g, 'a', T0).sideShow.theirHand, ['KH', 'KS', '3D']);
  assert.deepStrictEqual(engine.viewFor(g, 'b', T0).sideShow.theirHand, ['2H', '7S', '9D']);
  assert.strictEqual(engine.viewFor(g, 'c', T0).sideShow, null);
  for (const c of [...g.hands.a, ...g.hands.b]) assert.ok(!cardsIn(engine.viewFor(g, 'c', T0)).has(c));
});

test('side show declined: no cards compared, play goes on', () => {
  const g = game(3);
  for (const p of ['a', 'b', 'c']) mv(g, p, { type: 'see' });
  mv(g, 'a', { type: 'chaal', mult: 2 }); mv(g, 'b', { type: 'sideshow' });
  mv(g, 'a', { type: 'reply', accept: false });
  assert.strictEqual(g.packed.length, 0); assert.strictEqual(g.current, 'c');
  assert.strictEqual(engine.viewFor(g, 'b', T0).sideShow, null);
});

test('turn clock: the player packs (or a side show is declined) when time runs out', () => {
  const g = game(3);
  assert.deepStrictEqual(engine.timeout(g, T0 + 29e3), []);
  const ev = engine.timeout(g, T0 + 31e3);
  assert.ok(ev.some(e => e.type === 'PACKED' && e.pid === 'a' && e.why === 'timeout'));
  assert.strictEqual(g.current, 'b');
});

test('blind players never receive their own cards until they look; nobody sees anyone else\'s', () => {
  const g = game(4);
  for (const p of g.players) {
    const v = engine.viewFor(g, p, T0), seen = cardsIn(v);
    assert.strictEqual(seen.size, 0, p + ' was sent cards while blind');
    assert.strictEqual(v.you.hand, null);
  }
  mv(g, 'b', { type: 'see' });
  assert.deepStrictEqual([...cardsIn(engine.viewFor(g, 'b', T0))].sort(), g.hands.b.slice().sort());
  for (const p of ['a', 'c', 'd']) assert.strictEqual(cardsIn(engine.viewFor(g, p, T0)).size, 0);
});

test('chips are never created or destroyed (random play)', () => {
  for (let k = 0; k < 300; k++) {
    const n = 2 + (k % 5), g = game(n), start = total(g);
    for (let step = 0; step < 200 && g.status === 'playing'; step++) {
      const p = g.pending ? g.pending.to : g.current, o = engine.options(g, p), r = Math.random();
      let m;
      if (o.reply) m = { type: 'reply', accept: r < .5 };
      else if (o.see && r < .3) m = { type: 'see' };
      else if (o.show && r < .2) m = { type: 'show' };
      else if (o.sideShow && r < .25) m = { type: 'sideshow' };
      else if (o.chaal.length && r < .85) m = { type: 'chaal', mult: o.chaal[Math.floor(Math.random() * o.chaal.length)].mult };
      else m = { type: 'pack' };
      assert.ok(mv(g, p, m).ok, JSON.stringify(m));
      assert.strictEqual(total(g), start);
      for (const x of g.players) assert.ok(g.chips[x] >= 0);
    }
    assert.strictEqual(g.status, 'over');
    assert.strictEqual(Object.values(g.chips).reduce((a, b) => a + b, 0), start);   // whole pot paid out
  }
});
