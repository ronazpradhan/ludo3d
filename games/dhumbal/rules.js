// ====== DHUMBAL (JHYAP) RULES - the one place to change house rules ======
// Defaults follow the commonly published Nepali rules (Bhoos; Pagat's notes on Jhyap/Dhumbal):
//   - 2-5 players, 5 cards each; the next card is turned face up as the first throw
//   - on your turn you THROW first, then DRAW: throw one card, a set (2+ of the same rank) or a run
//     (3+ consecutive cards of one suit); then take the top of the deck or any one card the previous
//     player threw
//   - card points: A=1, 2-10 face value, J=11, Q=12, K=13
//   - JHYAP (show): at the start of your turn, if your hand is worth showMax or less, you may show instead
//     of throwing. Everyone reveals. If nobody else has an equal or lower total, you win and each player
//     pays you their total. Otherwise the lowest of them wins and you pay them everyone's totals combined.
//   - when the deck runs out, the throw pile (except the last throw) is shuffled into a new deck
// Chips/points are play money with no real-world value.
const { RANKS, rankOf, suitOf } = require('../common/cards');

const CONFIG = Object.freeze({
  minPlayers: 2,
  maxPlayers: 5,
  handSize: 5,
  showMax: 10,                    // you may call Jhyap with this many points or fewer (some tables play 5)
  values: Object.freeze({ A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 }),
  minSet: 2,                      // same rank
  minRun: 3,                      // same suit, consecutive
  aceLowInRun: true,              // A-2-3 counts as a run (A is low)
  aceHighInRun: false,            // Q-K-A counts as a run
  pickAnyFromLastThrow: true,     // Nepali rule: any one of the previous player's thrown cards (else only the ends)
  turnSeconds: 30,                // no move in time: throw your highest card and draw from the deck
});

const ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const value = (c, cfg = CONFIG) => cfg.values[rankOf(c)];
const total = (hand, cfg = CONFIG) => hand.reduce((a, c) => a + value(c, cfg), 0);

function isSet(cs, cfg = CONFIG) { return cs.length >= cfg.minSet && cs.every(c => rankOf(c) === rankOf(cs[0])); }

function isRun(cs, cfg = CONFIG) {
  if (cs.length < cfg.minRun || !cs.every(c => suitOf(c) === suitOf(cs[0]))) return false;
  const consecutive = idx => { const v = idx.slice().sort((a, b) => a - b); return v.every((x, i) => i === 0 || x === v[i - 1] + 1); };
  const lo = cs.map(c => ORDER.indexOf(rankOf(c)));                       // A = 0 (low)
  if (cfg.aceLowInRun && consecutive(lo)) return true;
  if (!cs.some(c => rankOf(c) === 'A')) return consecutive(lo);
  if (cfg.aceHighInRun) return consecutive(lo.map(i => i === 0 ? 13 : i));   // A after K
  return false;
}

// What a throw is: 'single' | 'set' | 'run' | null (not allowed)
function throwKind(cs, cfg = CONFIG) {
  if (!Array.isArray(cs) || !cs.length || new Set(cs).size !== cs.length) return null;
  if (cs.length === 1) return 'single';
  if (isSet(cs, cfg)) return 'set';
  if (isRun(cs, cfg)) return 'run';
  return null;
}

module.exports = { CONFIG, ORDER, value, total, isSet, isRun, throwKind };
