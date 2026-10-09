// ====== FLASH (3-card / Teen Patti style) RULES - the one place to change house rules ======
// Play money only: chips are an in-game score with no real-world value.
//
// Defaults follow the commonly published rules:
//   - everyone pays the boot, then gets 3 cards face down and starts BLIND
//   - "current stake" starts at the boot. A blind player bets 1x or 2x the stake, a seen player 2x or 4x.
//     After a blind bet the stake becomes that bet; after a seen bet it becomes half of it.
//   - pack (fold) any time it's your turn
//   - SHOW: only when two players are left. Blind: costs the stake. Seen: costs 2x the stake, and only
//     if the other player has seen too. Hands are compared; on a tie the player who asked loses.
//   - SIDE SHOW: a seen player asks the previous seen player (3+ players left), paying a seen bet.
//     If accepted, the lower hand packs (tie: the asker packs). Only the two players see the cards.
//   - hand ranking: Trail > Pure sequence > Sequence > Color > Pair > High card
// House rules added for this app (the sources don't cover them): rounds + chip resets, a turn clock,
// and what happens when you can't afford a bet (see canAfford below).
const { RANKS, rankOf, suitOf } = require('../common/cards');

const CONFIG = Object.freeze({
  minPlayers: 2,
  maxPlayers: 6,
  startingChips: 1000,     // everyone starts every ROUND with this much (resets each round)
  gamesPerRound: 10,       // a round is this many games (deals); chips carry over between them
  boot: 10,                // paid by everyone at the start of each game; also the opening stake
  blindMultipliers: [1, 2],
  seenMultipliers: [2, 4],
  sideShow: true,
  seenCanShowBlind: false, // may a seen player call a show against a blind player?
  // A-2-3: 'second' = second-best sequence (just below A-K-Q), 'lowest' = lowest sequence, 'none' = not a sequence
  aceTwoThree: 'second',
  turnSeconds: 30,         // no action in time: pack (or decline a side show)
  nextGameSeconds: 6,      // pause between games so everyone can see the result
  // SAPATI (borrowing). Ask a player first; the bank lends only if that didn't work (declined, no answer,
  // or nobody can lend). Everything is paid back at the END of the round, before the winner is decided:
  // the borrower repays from their chips; whatever they can't cover is subtracted from their final score
  // and credited to the lender.
  sapati: Object.freeze({
    enabled: true,
    maxBorrow: 500,        // most a player may borrow in one round (players + bank together)
    maxLend: 500,          // most a player may lend out in one round
    step: 50,              // amounts go in steps of this
    askSeconds: 20,        // a request not answered in time counts as declined
    bankOnlyAsFallback: true,
  }),
});

const VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));   // 2..14, ace high
const CAT = { HIGH: 1, PAIR: 2, COLOR: 3, SEQUENCE: 4, PURE_SEQUENCE: 5, TRAIL: 6 };
const CAT_NAME = { 1: 'High card', 2: 'Pair', 3: 'Color', 4: 'Sequence', 5: 'Pure sequence', 6: 'Trail' };

// Sequence strength: top card value. A-2-3 is placed by config (13.5 sits between K-Q-J and A-K-Q).
function seqValue(vals, cfg) {
  const [a, b, c] = vals;                       // sorted high to low
  if (a - b === 1 && b - c === 1) return a;
  if (a === 14 && b === 3 && c === 2) return cfg.aceTwoThree === 'second' ? 13.5 : cfg.aceTwoThree === 'lowest' ? 3 : null;
  return null;
}

// Evaluates 3 cards. Returns { cat, key: [...numbers, higher is better], name }.
function evaluate(hand, cfg = CONFIG) {
  const vals = hand.map(c => VAL[rankOf(c)]).sort((x, y) => y - x);
  const flush = new Set(hand.map(suitOf)).size === 1, seq = seqValue(vals, cfg);
  let cat, key;
  if (vals[0] === vals[1] && vals[1] === vals[2]) { cat = CAT.TRAIL; key = [vals[0]]; }
  else if (seq != null && flush) { cat = CAT.PURE_SEQUENCE; key = [seq]; }
  else if (seq != null) { cat = CAT.SEQUENCE; key = [seq]; }
  else if (flush) { cat = CAT.COLOR; key = vals; }
  else if (vals[0] === vals[1] || vals[1] === vals[2]) { const pr = vals[1], kick = vals[0] === vals[1] ? vals[2] : vals[0]; cat = CAT.PAIR; key = [pr, kick]; }
  else { cat = CAT.HIGH; key = vals; }
  return { cat, key, name: CAT_NAME[cat] };
}

// > 0 if a beats b, < 0 if b beats a, 0 if equal (suits never break ties).
function compare(a, b, cfg = CONFIG) {
  const x = evaluate(a, cfg), y = evaluate(b, cfg);
  if (x.cat !== y.cat) return x.cat - y.cat;
  for (let i = 0; i < x.key.length; i++) if (x.key[i] !== y.key[i]) return x.key[i] - y.key[i];
  return 0;
}

module.exports = { CONFIG, CAT, CAT_NAME, evaluate, compare };
