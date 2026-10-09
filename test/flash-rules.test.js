// Flash hand ranking.
const test = require('node:test');
const assert = require('node:assert');
const rules = require('../games/flash/rules');

const beats = (a, b, cfg) => rules.compare(a, b, cfg) > 0;
const cat = h => rules.evaluate(h).name;

test('categories are recognised', () => {
  assert.strictEqual(cat(['7H', '7S', '7D']), 'Trail');
  assert.strictEqual(cat(['5H', '6H', '7H']), 'Pure sequence');
  assert.strictEqual(cat(['5H', '6S', '7H']), 'Sequence');
  assert.strictEqual(cat(['2H', '9H', 'KH']), 'Color');
  assert.strictEqual(cat(['9H', '9S', 'KD']), 'Pair');
  assert.strictEqual(cat(['2H', '9S', 'KD']), 'High card');
  assert.strictEqual(cat(['QH', 'KS', 'AD']), 'Sequence');
  assert.strictEqual(cat(['KH', 'AS', '2D']), 'High card');   // no wrap-around except A-2-3
});

test('Trail > Pure sequence > Sequence > Color > Pair > High card', () => {
  const ladder = [['2H', '2S', '2D'], ['2H', '3H', '4H'], ['QH', 'KS', 'AD'], ['2C', '7C', '9C'], ['AH', 'AS', 'KD'], ['AH', 'KS', 'JD']];
  for (let i = 0; i < ladder.length - 1; i++) assert.ok(beats(ladder[i], ladder[i + 1]), ladder[i] + ' vs ' + ladder[i + 1]);
  assert.ok(beats(['2H', '2S', '2D'], ['AH', 'KH', 'QH']));   // lowest trail beats best pure sequence
});

test('tie-breaks inside a category', () => {
  assert.ok(beats(['AH', 'AS', 'AD'], ['KH', 'KS', 'KD']));
  assert.ok(beats(['AH', 'KH', 'QH'], ['KS', 'QS', 'JS']));
  assert.ok(beats(['AD', '9D', '3D'], ['AC', '8C', '7C']));   // color: highest card, then next
  assert.ok(beats(['9H', '9S', '3D'], ['8H', '8S', 'AD']));   // pair rank first
  assert.ok(beats(['9H', '9S', 'KD'], ['9C', '9D', 'QH']));   // then the odd card
  assert.ok(beats(['AH', '7S', '3D'], ['KH', 'QS', 'JC'].slice(0, 2).concat('9D')));
  assert.strictEqual(rules.compare(['AH', 'KS', '9D'], ['AS', 'KD', '9C']), 0);   // suits never break ties
});

test('A-2-3 placement is a setting', () => {
  const a23 = ['AH', '2S', '3D'], akq = ['AS', 'KD', 'QC'], kqj = ['KH', 'QS', 'JD'], two34 = ['2H', '3S', '4D'];
  const cfg = mode => ({ ...rules.CONFIG, aceTwoThree: mode });
  assert.ok(beats(akq, a23, cfg('second')) && beats(a23, kqj, cfg('second')));          // default: second best
  assert.ok(beats(two34, a23, cfg('lowest')) && rules.evaluate(a23, cfg('lowest')).name === 'Sequence');
  assert.strictEqual(rules.evaluate(a23, cfg('none')).name, 'High card');
});
