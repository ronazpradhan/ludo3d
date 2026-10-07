// Deck + shuffle + deal integrity.
const test = require('node:test');
const assert = require('node:assert');
const cards = require('../games/jutpatti/cards');
const engine = require('../games/jutpatti/engine');
const rules = require('../games/jutpatti/rules');

test('deck has exactly 52 unique cards: 4 suits x 13 ranks', () => {
  const d = cards.newDeck();
  assert.strictEqual(d.length, 52);
  assert.strictEqual(new Set(d).size, 52);
  for (const s of ['S', 'H', 'D', 'C']) for (const r of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) assert.ok(d.includes(r + s), 'missing ' + r + s);
});

test('newDeck returns a fresh copy each time', () => {
  const a = cards.newDeck(); a.pop();
  assert.strictEqual(cards.newDeck().length, 52);
});

test('shuffle preserves every card (no loss, no duplicates)', () => {
  for (let i = 0; i < 200; i++) {
    const s = cards.shuffle(cards.newDeck());
    assert.strictEqual(s.length, 52);
    assert.deepStrictEqual([...s].sort(), cards.newDeck().sort());
  }
});

test('every shuffle is new (1000 shuffles, all different)', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(cards.shuffle(cards.newDeck()).join(','));
  assert.strictEqual(seen.size, 1000);
});

test('every game gets its own fresh shuffle', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const g = engine.createGame({ players: ['a', 'b', 'c'], handSize: 7, dealerIndex: 0 });
    seen.add(JSON.stringify([g.hands, g.shown, g.stock]));
  }
  assert.strictEqual(seen.size, 300);
});

test('the shuffle never uses Math.random', () => {
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random used'); };
  try { cards.shuffle(cards.newDeck()); engine.createGame({ players: ['a', 'b'], handSize: 7, dealerIndex: 1 }); }
  finally { Math.random = orig; }
});

test('dealing preserves the total card count for every player count and hand size', () => {
  for (let n = 2; n <= 6; n++) for (const h of rules.CONFIG.handSizes) {
    if (!rules.validHandSize(h, n)) continue;
    const players = Array.from({ length: n }, (_, i) => 'p' + i);
    const g = engine.createGame({ players, handSize: h, dealerIndex: n - 1 });
    const all = [...players.flatMap(p => g.hands[p]), g.shown, ...g.stock, ...g.discard];
    assert.strictEqual(all.length, 52);
    assert.strictEqual(new Set(all).size, 52);
    for (const p of players) assert.strictEqual(g.hands[p].length, h);
  }
});

test('hand sizes that do not fit the deck are refused', () => {
  assert.strictEqual(rules.validHandSize(9, 6), false);   // 54 + 2 > 52
  assert.strictEqual(rules.validHandSize(7, 6), true);
  assert.strictEqual(rules.validHandSize(8, 2), false);   // must be odd + listed
  assert.throws(() => engine.createGame({ players: ['a', 'b', 'c', 'd', 'e', 'f'], handSize: 9, dealerIndex: 0 }));
});
