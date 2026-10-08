// Jutpatti game engine: pure game state + moves. No sockets, rooms, UI or Ludo code in here.
// The state object lives ONLY on the server. Clients get viewFor(state, pid), which hides
// everything that player is not allowed to see.
const cards = require('./cards');
const rules = require('./rules');

// ---------- setup ----------
// players: player ids in seat/turn order. dealerIndex: chosen by the caller with secure randomness.
function createGame({ players, handSize, dealerIndex, config = rules.CONFIG, randInt = cards.secureInt }) {
  const n = players.length;
  if (n < config.minPlayers || n > config.maxPlayers || new Set(players).size !== n) throw new Error('bad player list');
  if (!rules.validHandSize(handSize, n, config)) throw new Error('bad hand size');
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= n) throw new Error('bad dealer');

  const deck = cards.shuffle(cards.newDeck(), randInt);   // fresh deck + fresh shuffle every game
  const hands = Object.fromEntries(players.map(p => [p, []]));
  // Deal one card at a time, starting with the player after the dealer (same as at a real table).
  for (let k = 0; k < handSize; k++)
    for (let i = 1; i <= n; i++) hands[players[(dealerIndex + i) % n]].push(deck.pop());
  const shown = deck.pop();

  return {
    config, handSize,
    players: players.slice(), active: players.slice(),
    hands, stock: deck, discard: [],
    shown, jokerRank: rules.jokerRankFor(shown, config),
    dealer: players[dealerIndex], current: players[(dealerIndex + 1) % n],
    status: 'playing', phase: 'draw', turn: 1,
    takenFromDiscard: null,   // card taken from the discard pile this turn (public)
    lastDraw: null,           // { pid, source, card } - card is private when source is 'stock'
    winner: null, winningHand: null, winningPairs: null, endReason: null,
    version: 1,
  };
}

// ---------- queries ----------
function nextPlayer(state, from = state.current) {
  const order = state.players, n = order.length;
  let i = order.indexOf(from);
  for (let k = 0; k < n; k++) { i = (i + 1) % n; if (state.active.includes(order[i])) return order[i]; }
  return null;
}

function canDrawStock(s) { return s.stock.length > 0 || (s.config.reshuffleDiscard && s.discard.length > 1); }

function getValidMoves(state, pid) {
  if (state.status !== 'playing' || pid !== state.current) return [];
  if (state.phase === 'draw') {
    const m = [];
    if (state.config.drawSources.includes('stock') && canDrawStock(state)) m.push({ type: 'draw', source: 'stock' });
    if (state.config.drawSources.includes('discard') && state.discard.length) m.push({ type: 'draw', source: 'discard' });
    return m;
  }
  const m = state.hands[pid]
    .filter(c => state.config.allowDiscardTakenCard || c !== state.takenFromDiscard)
    .map(card => ({ type: 'discard', card }));
  if (!state.config.autoWin) m.push({ type: 'show' });   // always offered: the server checks the hand when it's used
  return m;
}

// Checks shape first (the move comes from an untrusted client), then legality. Returns { ok, error }.
function isValidMove(state, pid, move) {
  if (!move || typeof move !== 'object') return { ok: false, error: 'BAD_REQUEST' };
  if (move.type === 'draw' && !['stock', 'discard'].includes(move.source)) return { ok: false, error: 'BAD_REQUEST' };
  if (move.type === 'discard' && !cards.isCard(move.card)) return { ok: false, error: 'BAD_REQUEST' };
  // pairs are optional: just how the player happened to arrange their cards
  if (move.type === 'show' && move.pairs != null && (!Array.isArray(move.pairs) || move.pairs.length > 16 ||
      !move.pairs.every(p => Array.isArray(p) && p.length === 2 && p.every(cards.isCard)))) return { ok: false, error: 'BAD_REQUEST' };
  if (move.type !== 'draw' && move.type !== 'discard' && move.type !== 'show') return { ok: false, error: 'BAD_REQUEST' };
  if (state.status !== 'playing') return { ok: false, error: 'GAME_NOT_RUNNING' };
  if (!state.active.includes(pid)) return { ok: false, error: 'NOT_IN_GAME' };
  if (pid !== state.current) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (move.type === 'draw' && state.phase !== 'draw') return { ok: false, error: 'WRONG_PHASE' };
  if ((move.type === 'discard' || move.type === 'show') && state.phase !== 'discard') return { ok: false, error: 'WRONG_PHASE' };
  if (move.type === 'discard' && !state.hands[pid].includes(move.card)) return { ok: false, error: 'NOT_OWNED' };
  if (move.type === 'show') {
    if (state.config.autoWin) return { ok: false, error: 'ILLEGAL_MOVE' };
    // Whether the cards are laid out in pairs doesn't matter; the whole hand just has to follow the rule.
    return rules.isWinningHand(state.hands[pid], state.jokerRank) ? { ok: true } : { ok: false, error: 'INVALID_SHOW' };
  }
  const legal = getValidMoves(state, pid).some(m => m.type === move.type && m.source === move.source && m.card === move.card);
  return legal ? { ok: true } : { ok: false, error: 'ILLEGAL_MOVE' };
}

const isRoundOver = s => s.status === 'over';
const isGameOver = isRoundOver;   // one deal = one game; scores across games are kept by the room

// ---------- state changes ----------
function end(state, reason, winner, events, pairs) {
  state.status = 'over'; state.phase = 'over'; state.endReason = reason; state.winner = winner || null;
  if (winner) {
    state.winningHand = state.hands[winner].slice();
    state.winningPairs = pairs || rules.groupHand(state.winningHand, state.jokerRank).pairs;
    events.push({ type: 'PLAYER_WON', pid: winner });
  }
  events.push({ type: 'GAME_ENDED', reason, winner: winner || null });
}

function nextTurn(state, events = []) {
  state.takenFromDiscard = null;
  state.turn++;
  if (state.turn > state.config.maxTurns) { end(state, 'turn-limit', null, events); return events; }
  state.current = nextPlayer(state);
  state.phase = 'draw';
  events.push({ type: 'TURN_CHANGED', pid: state.current, turn: state.turn });
  return events;
}

// Applies a move after validating it. Mutates state. Returns { ok, error?, events }.
// Events are PUBLIC: they never contain a card drawn from the stock.
function applyMove(state, pid, move, randInt = cards.secureInt) {
  const v = isValidMove(state, pid, move);
  if (!v.ok) return { ok: false, error: v.error, bad: v.bad, events: [] };
  const events = [], hand = state.hands[pid];

  if (move.type === 'draw') {
    let card;
    if (move.source === 'stock') {
      if (!state.stock.length) {   // rebuild the stock from the discard pile, keeping its top card
        const top = state.discard.pop();
        state.stock = cards.shuffle(state.discard, randInt);
        state.discard = [top];
        events.push({ type: 'STOCK_RESHUFFLED', size: state.stock.length });
      }
      card = state.stock.pop();
      events.push({ type: 'CARD_DRAWN', pid, source: 'stock' });
    } else {
      card = state.discard.pop();
      state.takenFromDiscard = card;
      events.push({ type: 'CARD_DRAWN', pid, source: 'discard', card });
    }
    hand.push(card);
    state.lastDraw = { pid, source: move.source, card };
    if (state.config.autoWin && rules.isWinningHand(hand, state.jokerRank)) end(state, 'pairs', pid, events);
    else state.phase = 'discard';
  } else if (move.type === 'show') {
    // Show the cards the way the player arranged them if that arrangement is right; otherwise lay them out in pairs.
    events.push({ type: 'PLAYER_SHOWED', pid });
    const own = move.pairs && rules.checkShow(hand, move.pairs, state.jokerRank).ok ? move.pairs.map(p => p.slice()) : null;
    end(state, 'pairs', pid, events, own);
  } else {
    hand.splice(hand.indexOf(move.card), 1);
    state.discard.push(move.card);
    events.push({ type: 'CARD_PLAYED', pid, card: move.card });
    nextTurn(state, events);
  }
  state.version++;
  return { ok: true, events };
}

// A player left for good. Their cards go back into the stock, which is re-shuffled so nobody
// learns where they are. If fewer than 2 players remain, the game ends with no winner.
function removePlayer(state, pid, randInt = cards.secureInt) {
  const events = [];
  if (state.status !== 'playing' || !state.active.includes(pid)) return events;
  const wasCurrent = state.current === pid, after = nextPlayer(state, pid);
  state.active = state.active.filter(p => p !== pid);
  state.stock.push(...state.hands[pid]);
  state.hands[pid] = [];
  cards.shuffle(state.stock, randInt);
  events.push({ type: 'PLAYER_LEFT', pid });
  if (state.active.length < state.config.minPlayers) end(state, 'not-enough-players', null, events);
  else if (wasCurrent) {
    state.current = after; state.phase = 'draw'; state.takenFromDiscard = null;
    events.push({ type: 'TURN_CHANGED', pid: after, turn: state.turn });
  }
  state.version++;
  return events;
}

// ---------- what one player may see ----------
function viewFor(state, pid) {
  const mine = state.hands[pid];
  const v = {
    status: state.status, phase: state.phase, turn: state.turn, version: state.version,
    current: state.current, dealer: state.dealer, handSize: state.handSize,
    shown: state.shown, jokerRank: state.jokerRank,
    stockCount: state.stock.length, discardCount: state.discard.length,
    discardTop: state.discard.length ? state.discard[state.discard.length - 1] : null,
    takenFromDiscard: state.takenFromDiscard,
    players: state.players.map(p => ({ pid: p, cards: state.hands[p].length, active: state.active.includes(p) })),
    winner: state.winner, winningHand: state.winningHand, endReason: state.endReason,
    winningPairs: state.winningPairs,
    lastDraw: null, you: null,
  };
  const ld = state.lastDraw;
  if (ld) v.lastDraw = { pid: ld.pid, source: ld.source, card: ld.source === 'discard' || ld.pid === pid ? ld.card : null };
  // your cards in the order you got them; pairing them up is left to you
  if (mine && state.active.includes(pid)) {
    v.you = { hand: mine.slice(), validMoves: getValidMoves(state, pid) };
    // tells ONLY this player that their own hand is complete, so the Show button can appear by itself
    v.you.canShow = !state.config.autoWin && state.status === 'playing' && state.current === pid && state.phase === 'discard' && rules.isWinningHand(mine, state.jokerRank);
  }
  return v;
}

module.exports = { createGame, getValidMoves, isValidMove, applyMove, nextTurn, nextPlayer, removePlayer, isRoundOver, isGameOver, viewFor };
