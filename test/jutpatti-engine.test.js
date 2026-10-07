// Rule engine: jokers, pairing, turn flow, validation, hidden information.
const test = require('node:test');
const assert = require('node:assert');
const cards = require('../games/jutpatti/cards');
const engine = require('../games/jutpatti/engine');
const rules = require('../games/jutpatti/rules');

// collects every card id that appears anywhere inside an object
function cardsIn(o, out = new Set()) {
  if (typeof o === 'string') { if (cards.isCard(o)) out.add(o); }
  else if (o && typeof o === 'object') for (const v of Object.values(o)) cardsIn(v, out);
  return out;
}

// A small hand-built state so tests control every card.
function fixed({ hands, stock = ['2C', '3C', '4C'], discard = [], shown = '5H', current = 'a' }) {
  const g = engine.createGame({ players: Object.keys(hands), handSize: 5, dealerIndex: Object.keys(hands).length - 1 });
  Object.assign(g, { hands, stock, discard, shown, jokerRank: rules.jokerRankFor(shown), current, phase: 'draw' });
  return g;
}

test('joker is one rank above the shown card, wrapping K->A->2', () => {
  assert.strictEqual(rules.jokerRankFor('5H'), '6');
  assert.strictEqual(rules.jokerRankFor('10S'), 'J');
  assert.strictEqual(rules.jokerRankFor('KD'), 'A');
  assert.strictEqual(rules.jokerRankFor('AC'), '2');
});

test('pairing: same rank pairs, jokers pair with anything', () => {
  assert.ok(rules.isWinningHand(['7H', '7S', 'QD', 'QC'], '6'));
  assert.ok(!rules.isWinningHand(['7H', '7S', 'QD', 'KC'], '6'));
  assert.ok(rules.isWinningHand(['7H', '6S', 'QD', 'QC'], '6'));          // joker + 7
  assert.ok(rules.isWinningHand(['6H', '6S', 'QD', 'QC'], '6'));          // joker + joker
  assert.ok(rules.isWinningHand(['7H', '7S', '7D', '6C'], '6'));          // three 7s + joker
  assert.ok(!rules.isWinningHand(['7H', '7S', '7D', '8C'], '6'));
  assert.ok(rules.isWinningHand(['7H', '7S', '7D', '7C'], '6'));          // two pairs of 7s
  assert.ok(!rules.isWinningHand([], '6'));
  assert.strictEqual(rules.unpairedCount(['7H', 'QD', 'KC', '6S'], '6'), 2);
});

test('a normal turn: draw, then discard, then the next player', () => {
  const g = fixed({ hands: { a: ['7H', '8S', '9D', '10C', 'JH'], b: ['2H', '3S', '4D', 'QC', 'KH'] } });
  assert.deepStrictEqual(engine.getValidMoves(g, 'b'), []);
  let r = engine.applyMove(g, 'a', { type: 'draw', source: 'stock' });
  assert.ok(r.ok); assert.strictEqual(g.phase, 'discard'); assert.strictEqual(g.hands.a.length, 6);
  assert.ok(!r.events.some(e => e.card), 'stock draw must not reveal the card in public events');
  r = engine.applyMove(g, 'a', { type: 'discard', card: '8S' });
  assert.ok(r.ok); assert.strictEqual(g.current, 'b'); assert.strictEqual(g.phase, 'draw');
  assert.deepStrictEqual(g.discard, ['8S']);
  r = engine.applyMove(g, 'b', { type: 'draw', source: 'discard' });
  assert.ok(r.ok); assert.ok(g.hands.b.includes('8S'));
});

test('illegal moves are rejected and change nothing', () => {
  const g = fixed({ hands: { a: ['7H', '8S', '9D', '10C', 'JH'], b: ['2H', '3S', '4D', 'QC', 'KH'] } });
  const before = JSON.stringify(g);
  const bad = [
    ['b', { type: 'draw', source: 'stock' }, 'NOT_YOUR_TURN'],
    ['a', { type: 'discard', card: '7H' }, 'WRONG_PHASE'],
    ['a', { type: 'draw', source: 'discard' }, 'ILLEGAL_MOVE'],          // discard pile is empty
    ['a', { type: 'draw', source: 'opponent' }, 'BAD_REQUEST'],
    ['a', { type: 'win' }, 'BAD_REQUEST'],
    ['a', null, 'BAD_REQUEST'],
    ['zz', { type: 'draw', source: 'stock' }, 'NOT_IN_GAME'],
  ];
  for (const [pid, mv, code] of bad) assert.strictEqual(engine.applyMove(g, pid, mv).error, code, JSON.stringify(mv));
  assert.strictEqual(JSON.stringify(g), before);
  engine.applyMove(g, 'a', { type: 'draw', source: 'stock' });
  assert.strictEqual(engine.applyMove(g, 'a', { type: 'discard', card: '2H' }).error, 'NOT_OWNED');   // b's card
  assert.strictEqual(engine.applyMove(g, 'a', { type: 'discard', card: 'XX' }).error, 'BAD_REQUEST');
  assert.strictEqual(engine.applyMove(g, 'a', { type: 'discard', card: ['7H'] }).error, 'BAD_REQUEST');
});

test('completing the pairs does NOT win by itself: the player has to Show', () => {
  const g = fixed({ hands: { a: ['7H', '7S', '9D', '9C', 'KH'], b: ['2H', '3S', '4D', 'QC', 'JH'] }, stock: ['2C', 'KS'] });
  assert.ok(engine.applyMove(g, 'a', { type: 'draw', source: 'stock' }).ok);
  assert.strictEqual(g.status, 'playing'); assert.strictEqual(g.phase, 'discard');
  assert.ok(engine.getValidMoves(g, 'a').some(m => m.type === 'show'));
  const r = engine.applyMove(g, 'a', { type: 'show', pairs: [['7H', '7S'], ['KS', 'KH'], ['9C', '9D']] });
  assert.ok(r.ok);
  assert.strictEqual(g.status, 'over'); assert.strictEqual(g.winner, 'a');
  assert.deepStrictEqual(g.winningPairs, [['7H', '7S'], ['KS', 'KH'], ['9C', '9D']]);   // shown the way the player laid them out
  assert.ok(r.events.some(e => e.type === 'PLAYER_SHOWED') && r.events.some(e => e.type === 'PLAYER_WON'));
  assert.strictEqual(engine.applyMove(g, 'b', { type: 'draw', source: 'stock' }).error, 'GAME_NOT_RUNNING');
});

test('a joker can complete a shown pair', () => {
  const g = fixed({ hands: { a: ['7H', '7S', '9D', '9C', 'KH'], b: ['2H', '3S', '4D', 'QC', 'JH'] }, stock: ['6D'], shown: '5H' });
  engine.applyMove(g, 'a', { type: 'draw', source: 'stock' });
  assert.ok(engine.applyMove(g, 'a', { type: 'show', pairs: [['7H', '7S'], ['9D', '9C'], ['KH', '6D']] }).ok);
  assert.strictEqual(g.winner, 'a');
});

test('a wrong Show is rejected, names the bad pairs, and the game goes on', () => {
  const g = fixed({ hands: { a: ['7H', '7S', '9D', '9C', 'KH'], b: ['2H', '3S', '4D', 'QC', 'JH'] }, stock: ['QS'] });
  engine.applyMove(g, 'a', { type: 'draw', source: 'stock' });   // hand is NOT all pairs now
  const before = JSON.stringify(g);
  const r = engine.applyMove(g, 'a', { type: 'show', pairs: [['7H', '7S'], ['9D', 'KH'], ['9C', 'QS']] });
  assert.strictEqual(r.error, 'INVALID_SHOW'); assert.deepStrictEqual(r.bad, [1, 2]);
  const cheats = [
    [['7H', '7S'], ['9D', '9C'], ['KH', 'KS']],          // KS is not in the hand
    [['7H', '7S'], ['9D', '9C']],                         // leaves cards out
    [['7H', '7S'], ['7H', '7S'], ['9D', '9C']],           // same cards twice
    [['7H', '7H'], ['9D', '9C'], ['KH', 'QS']],           // one card used as both halves
    [['2H', '3S'], ['9D', '9C'], ['KH', 'QS']],           // opponent's cards
  ];
  for (const pairs of cheats) assert.strictEqual(engine.applyMove(g, 'a', { type: 'show', pairs }).error, 'INVALID_SHOW', JSON.stringify(pairs));
  for (const pairs of [null, 'all', [['7H']], [['7H', '7S', '9D']], [[1, 2]], Array(20).fill(['7H', '7S'])])
    assert.strictEqual(engine.applyMove(g, 'a', { type: 'show', pairs }).error, 'BAD_REQUEST', JSON.stringify(pairs));
  assert.strictEqual(JSON.stringify(g), before);
  assert.strictEqual(g.status, 'playing');
});

test('Show is only allowed on your turn, after drawing', () => {
  const g = fixed({ hands: { a: ['7H', '7S', '9D', '9C', 'KH'], b: ['2H', '2S', '4D', '4C', 'JH'] } });
  assert.strictEqual(engine.applyMove(g, 'a', { type: 'show', pairs: [['7H', '7S'], ['9D', '9C']] }).error, 'WRONG_PHASE');
  assert.strictEqual(engine.applyMove(g, 'b', { type: 'show', pairs: [['2H', '2S'], ['4D', '4C']] }).error, 'NOT_YOUR_TURN');
});

test('autoWin: true restores the old behaviour (game ends on the winning draw)', () => {
  const g = fixed({ hands: { a: ['7H', '7S', '9D', '9C', 'KH'], b: ['2H', '3S', '4D', 'QC', 'JH'] }, stock: ['KS'] });
  g.config = { ...g.config, autoWin: true };
  engine.applyMove(g, 'a', { type: 'draw', source: 'stock' });
  assert.strictEqual(g.winner, 'a');
});

test('players are not handed a ready-made pairing of their cards', () => {
  const g = engine.createGame({ players: ['a', 'b'], handSize: 7, dealerIndex: 1 });
  const v = engine.viewFor(g, 'a');
  assert.deepStrictEqual(Object.keys(v.you).sort(), ['hand', 'validMoves']);
  assert.deepStrictEqual(v.you.hand, g.hands.a);   // in deal order, untouched
});

test('empty stock is rebuilt from the discard pile, keeping its top card', () => {
  const g = fixed({ hands: { a: ['7H', '8S', '9D', '10C', 'JH'], b: ['2H', '3S', '4D', 'QC', 'KH'] }, stock: [], discard: ['2C', '3C', '4C', '5C'] });
  const r = engine.applyMove(g, 'a', { type: 'draw', source: 'stock' });
  assert.ok(r.ok);
  assert.deepStrictEqual(g.discard, ['5C']);
  assert.strictEqual(g.stock.length, 2);
  assert.strictEqual(g.hands.a.length, 6);
  assert.ok(r.events.some(e => e.type === 'STOCK_RESHUFFLED'));
});

test('a leaving player returns cards to the stock; game ends below 2 players', () => {
  const g = engine.createGame({ players: ['a', 'b', 'c'], handSize: 7, dealerIndex: 2 });   // a starts
  const stock = g.stock.length;
  engine.removePlayer(g, 'a');
  assert.strictEqual(g.stock.length, stock + 7);
  assert.strictEqual(g.current, 'b');
  assert.strictEqual(g.status, 'playing');
  engine.removePlayer(g, 'b');
  assert.strictEqual(g.status, 'over'); assert.strictEqual(g.winner, null);
});

test('viewFor never leaks hidden cards', () => {
  for (let n = 2; n <= 6; n++) {
    const players = Array.from({ length: n }, (_, i) => 'p' + i);
    const g = engine.createGame({ players, handSize: 7, dealerIndex: 0 });
    // play a few turns so there is a discard pile and a private stock draw
    for (let k = 0; k < 6; k++) { const pid = g.current, m = engine.getValidMoves(g, pid); engine.applyMove(g, pid, m[0]); if (g.status !== 'playing') break; }
    for (const pid of players) {
      const v = engine.viewFor(g, pid), seen = cardsIn(v);
      // public: shown card, discard pile, and a card someone visibly picked up from the discard pile
      const pub = new Set([g.shown, ...g.discard, ...(g.winningHand || []), g.takenFromDiscard, g.lastDraw && g.lastDraw.source === 'discard' ? g.lastDraw.card : null]);
      const allowed = new Set([...g.hands[pid], ...pub]);
      for (const c of seen) assert.ok(allowed.has(c), `${pid} can see ${c}`);
      for (const c of g.stock) assert.ok(!seen.has(c), 'stock card leaked');
      for (const o of players) if (o !== pid) for (const c of g.hands[o]) if (!pub.has(c)) assert.ok(!seen.has(c), 'opponent card leaked');
    }
  }
});
