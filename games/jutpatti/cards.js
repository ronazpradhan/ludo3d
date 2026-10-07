// Jutpatti: standard 52-card deck and a cryptographically secure shuffle.
// Cards are short strings: rank + suit, e.g. '7H', '10S', 'QD', 'AC'.
const crypto = require('crypto');

const SUITS = ['S', 'H', 'D', 'C'];   // spades, hearts, diamonds, clubs
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const ALL = Object.freeze(SUITS.flatMap(s => RANKS.map(r => r + s)));
const CARD_SET = new Set(ALL);

const newDeck = () => ALL.slice();
const isCard = c => typeof c === 'string' && CARD_SET.has(c);
const rankOf = c => c.slice(0, -1);
const suitOf = c => c.slice(-1);

// Uniform integer in [0, n). crypto.randomInt uses rejection sampling, so there is no modulo bias.
// No seed of any kind: the OS CSPRNG is the only source of randomness.
const secureInt = n => crypto.randomInt(n);

// Fisher-Yates (Durstenfeld) shuffle, in place. randInt is injectable ONLY so tests can use a
// deterministic source; production code never passes one.
function shuffle(arr, randInt = secureInt) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

module.exports = { SUITS, RANKS, ALL, newDeck, isCard, rankOf, suitOf, secureInt, shuffle };
