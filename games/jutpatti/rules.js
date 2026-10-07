// ====== JUTPATTI RULES - the one place to change house rules =========================
// Defaults follow the commonly published rules:
//   - every player is dealt an odd number of cards (5, 7, 9 or 11)
//   - the next card of the deck is turned face up; every card ONE RANK HIGHER is a Joker
//     (e.g. 5 shown -> all 6s are Jokers; K shown -> all Aces; A shown -> all 2s)
//   - a Joker pairs with any card (including another Joker); otherwise a pair is two cards of the same rank
//   - on your turn: take the top card of the stock OR the top card of the discard pile, then
//     discard one card. If after taking a card your whole hand is pairs, you win.
//   - when the stock runs out, the discard pile (except its top card) is shuffled into a new stock
//   - 1 point per game won
// Nothing in the UI or networking code knows these rules; it all comes from here.
const { RANKS, rankOf } = require('./cards');

const CONFIG = Object.freeze({
  minPlayers: 2,
  maxPlayers: 6,
  handSizes: [5, 7, 9, 11],     // choices offered in the lobby (must be odd)
  defaultHandSize: 7,
  jokerOffset: 1,               // joker rank = shown card's rank + this (0 = the shown rank itself)
  drawSources: ['stock', 'discard'],
  allowDiscardTakenCard: true,  // may you throw back the card you just took from the discard pile?
  reshuffleDiscard: true,       // rebuild the stock from the discard pile when the stock is empty
  maxTurns: 600,                // safety net: game ends with no winner after this many turns
  pointsPerWin: 1,
});

// A hand size is usable if every player gets that many cards and the shown card + at least one stock card remain.
function validHandSize(h, players, cfg = CONFIG) {
  return cfg.handSizes.includes(h) && h % 2 === 1 && players * h + 2 <= 52;
}

function jokerRankFor(shown, cfg = CONFIG) {
  return RANKS[(RANKS.indexOf(rankOf(shown)) + cfg.jokerOffset) % RANKS.length];
}

const isJoker = (card, jokerRank) => rankOf(card) === jokerRank;

// Groups a hand into pairs + leftover singles, using Jokers to fill gaps.
// Returns { pairs: [[a,b],...], singles: [...] } with the fewest possible singles.
function groupHand(hand, jokerRank) {
  const jokers = [], byRank = new Map();
  for (const c of hand) {
    if (isJoker(c, jokerRank)) jokers.push(c);
    else { const r = rankOf(c); if (!byRank.has(r)) byRank.set(r, []); byRank.get(r).push(c); }
  }
  const pairs = [], singles = [];
  for (const r of RANKS) {
    const cs = byRank.get(r); if (!cs) continue;
    for (let i = 0; i + 1 < cs.length; i += 2) pairs.push([cs[i], cs[i + 1]]);
    if (cs.length % 2) {
      if (jokers.length) pairs.push([cs[cs.length - 1], jokers.pop()]);
      else singles.push(cs[cs.length - 1]);
    }
  }
  while (jokers.length >= 2) pairs.push([jokers.pop(), jokers.pop()]);
  singles.push(...jokers);
  return { pairs, singles };
}

const unpairedCount = (hand, jokerRank) => groupHand(hand, jokerRank).singles.length;

// A winning hand: non-empty, and every card is in a pair.
const isWinningHand = (hand, jokerRank) => hand.length > 0 && unpairedCount(hand, jokerRank) === 0;

module.exports = { CONFIG, validHandSize, jokerRankFor, isJoker, groupHand, unpairedCount, isWinningHand };
