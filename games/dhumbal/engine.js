// Dhumbal engine: one game (deal) - pure state + moves. No sockets, rooms or UI in here.
// The state lives ONLY on the server; clients get viewFor(), which shows your own cards, the public
// throw pile and card COUNTS for everyone else - until a Jhyap, when every hand is revealed.
const cards = require('../common/cards');
const rules = require('./rules');

function createGame({ players, dealerIndex, config = rules.CONFIG, randInt = cards.secureInt, now = Date.now() }) {
  const n = players.length;
  if (n < config.minPlayers || n > config.maxPlayers || new Set(players).size !== n) throw new Error('bad player list');
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= n) throw new Error('bad dealer');
  const deck = cards.shuffle(cards.newDeck(), randInt);   // fresh deck + fresh shuffle every game
  const hands = Object.fromEntries(players.map(p => [p, []]));
  for (let k = 0; k < config.handSize; k++) for (let i = 1; i <= n; i++) hands[players[(dealerIndex + i) % n]].push(deck.pop());
  const open = deck.pop();
  return {
    config, players: players.slice(), active: players.slice(), hands, stock: deck,
    pile: [[open]],          // throws, oldest first; the last one is what the current player may pick from
    pickable: [open],        // cards the current player may take (the previous throw)
    dealer: players[dealerIndex], current: players[(dealerIndex + 1) % n],
    phase: 'throw', status: 'playing', turn: 1, version: 1, deadline: now + config.turnSeconds * 1000,
    lastThrow: null, lastDraw: null, result: null,
  };
}

const nextOf = (s, p) => { const o = s.players, n = o.length; let i = o.indexOf(p); for (let k = 0; k < n; k++) { i = (i + 1) % n; if (s.active.includes(o[i])) return o[i]; } return null; };

function options(s, pid) {
  const o = { throw: false, draw: false, show: false, pick: [] };
  if (s.status !== 'playing' || s.current !== pid) return o;
  if (s.phase === 'throw') { o.throw = true; o.show = rules.total(s.hands[pid], s.config) <= s.config.showMax; }
  else { o.draw = true; o.pick = pickableCards(s); }
  return o;
}
function pickableCards(s) {
  const p = s.pickable || [];
  if (s.config.pickAnyFromLastThrow || p.length <= 2) return p.slice();
  return [p[0], p[p.length - 1]];   // only the ends of a run / set
}

function end(s, result, events) {
  s.status = 'over'; s.phase = 'over'; s.result = result;
  events.push({ type: 'GAME_ENDED', winner: result.winner, reason: result.reason });
}

// JHYAP: compare everyone's totals and work out who pays whom (play money)
function showdown(s, caller, events) {
  const totals = Object.fromEntries(s.active.map(p => [p, rules.total(s.hands[p], s.config)]));
  const mine = totals[caller], others = s.active.filter(p => p !== caller);
  const beaters = others.filter(p => totals[p] <= mine);
  const pay = Object.fromEntries(s.active.map(p => [p, 0]));
  let winner, reason;
  if (!beaters.length) {   // caller has the lowest hand: everyone pays the caller their own total
    winner = caller; reason = 'jhyap';
    for (const p of others) { pay[p] -= totals[p]; pay[caller] += totals[p]; }
  } else {                 // caught: the lowest other hand wins (first after the caller on a tie); caller pays everyone's totals
    const low = Math.min(...beaters.map(p => totals[p]));
    let p = caller; do { p = nextOf(s, p); } while (!(beaters.includes(p) && totals[p] === low));
    winner = p; reason = 'caught';
    const sum = s.active.reduce((a, q) => a + totals[q], 0);
    pay[caller] -= sum; pay[winner] += sum;
  }
  events.push({ type: 'JHYAP', pid: caller, total: mine });
  end(s, { winner, reason, caller, totals, pay, hands: Object.fromEntries(s.active.map(p => [p, s.hands[p].slice()])) }, events);
}

function advance(s, now, events) {
  s.pickable = s.pile[s.pile.length - 1].slice();   // the next player may pick from the throw just made
  s.current = nextOf(s, s.current); s.phase = 'throw'; s.turn++; s.deadline = now + s.config.turnSeconds * 1000;
  events.push({ type: 'TURN_CHANGED', pid: s.current, turn: s.turn });
}

// Validates (moves come from untrusted clients) and applies. Events are PUBLIC: no card drawn from the deck.
function applyMove(s, pid, move, { randInt = cards.secureInt, now = Date.now() } = {}) {
  const fail = error => ({ ok: false, error, events: [] });
  if (!move || typeof move !== 'object' || !['throw', 'draw', 'show'].includes(move.type)) return fail('BAD_REQUEST');
  if (move.type === 'throw' && (!Array.isArray(move.cards) || move.cards.length > 13 || !move.cards.every(cards.isCard))) return fail('BAD_REQUEST');
  if (move.type === 'draw' && !(move.source === 'stock' || (move.source === 'pile' && cards.isCard(move.card)))) return fail('BAD_REQUEST');
  if (s.status !== 'playing') return fail('GAME_NOT_RUNNING');
  if (!s.active.includes(pid)) return fail('NOT_IN_GAME');
  if (s.current !== pid) return fail('NOT_YOUR_TURN');
  const hand = s.hands[pid], events = [];

  if (move.type === 'show') {
    if (s.phase !== 'throw') return fail('WRONG_PHASE');
    if (rules.total(hand, s.config) > s.config.showMax) return fail('TOO_MANY_POINTS');
    showdown(s, pid, events);
  } else if (move.type === 'throw') {
    if (s.phase !== 'throw') return fail('WRONG_PHASE');
    if (!move.cards.every(c => hand.includes(c))) return fail('NOT_OWNED');
    const kind = rules.throwKind(move.cards, s.config);
    if (!kind) return fail('BAD_THROW');
    for (const c of move.cards) hand.splice(hand.indexOf(c), 1);
    s.pile.push(move.cards.slice());
    s.lastThrow = { pid, cards: move.cards.slice(), kind };
    s.phase = 'draw';
    events.push({ type: 'THREW', pid, cards: move.cards.slice(), kind });
  } else {
    if (s.phase !== 'draw') return fail('WRONG_PHASE');
    let card;
    if (move.source === 'pile') {
      if (!pickableCards(s).includes(move.card)) return fail('NOT_PICKABLE');
      card = move.card;
      const g = s.pile[s.pile.length - 2] || [];   // the previous player's throw (just under mine)
      const at = g.indexOf(card); if (at >= 0) g.splice(at, 1);
      s.pickable = s.pickable.filter(c => c !== card);
      events.push({ type: 'DREW', pid, source: 'pile', card });
    } else {
      if (!s.stock.length) {   // rebuild the deck from the throw pile, keeping my throw on top
        const keep = s.pile.pop(), rest = s.pile.flat();
        if (!rest.length) return fail('NO_CARDS');
        s.stock = cards.shuffle(rest, randInt); s.pile = [keep];
        events.push({ type: 'DECK_RESHUFFLED', size: s.stock.length });
      }
      card = s.stock.pop();
      events.push({ type: 'DREW', pid, source: 'stock' });
    }
    hand.push(card);
    s.lastDraw = { pid, source: move.source, card };
    s.pile = s.pile.filter(g => g.length);
    advance(s, now, events);
  }
  s.version++;
  return { ok: true, events };
}

// The turn clock ran out: throw the highest card, then draw from the deck.
function timeout(s, now = Date.now(), randInt = cards.secureInt) {
  if (s.status !== 'playing' || now < s.deadline) return [];
  const pid = s.current, events = [];
  if (s.phase === 'throw') {
    const hi = s.hands[pid].slice().sort((a, b) => rules.value(b, s.config) - rules.value(a, s.config))[0];
    events.push(...applyMove(s, pid, { type: 'throw', cards: [hi] }, { randInt, now }).events);
  }
  if (s.status === 'playing' && s.phase === 'draw') events.push(...applyMove(s, pid, { type: 'draw', source: 'stock' }, { randInt, now }).events);
  events.push({ type: 'TIMED_OUT', pid });
  return events;
}

// A player left for good: their cards go back into the deck (re-shuffled). Below 2 players the game ends.
function removePlayer(s, pid, now = Date.now(), randInt = cards.secureInt) {
  if (s.status !== 'playing' || !s.active.includes(pid)) return [];
  const events = [{ type: 'PLAYER_OUT', pid }], wasTurn = s.current === pid;
  const after = nextOf(s, pid);
  s.active = s.active.filter(p => p !== pid);
  s.stock.push(...s.hands[pid]); s.hands[pid] = []; cards.shuffle(s.stock, randInt);
  if (s.active.length < s.config.minPlayers) end(s, { winner: null, reason: 'not-enough-players', pay: {}, totals: {}, hands: {} }, events);
  else if (wasTurn) { s.current = after; s.phase = 'throw'; s.deadline = now + s.config.turnSeconds * 1000; events.push({ type: 'TURN_CHANGED', pid: after, turn: s.turn }); }
  s.version++;
  return events;
}

function viewFor(s, pid, now = Date.now()) {
  const over = s.status === 'over', mine = s.hands[pid];
  return {
    status: s.status, phase: s.phase, version: s.version, turn: s.turn, current: s.current, dealer: s.dealer,
    timeLeft: over ? 0 : Math.max(0, s.deadline - now), turnMs: s.config.turnSeconds * 1000, showMax: s.config.showMax,
    players: s.players.map(p => ({ pid: p, cards: s.hands[p].length, active: s.active.includes(p) })),
    stockCount: s.stock.length, pickable: s.pickable ? s.pickable.slice() : [], pileTop: s.pile.slice(-3).map(g => g.slice()),
    lastThrow: s.lastThrow, lastDraw: s.lastDraw && { pid: s.lastDraw.pid, source: s.lastDraw.source, card: s.lastDraw.source === 'pile' || s.lastDraw.pid === pid ? s.lastDraw.card : null },
    result: s.result,   // at a Jhyap everyone's hand is revealed, so everybody can check the result
    you: mine && s.active.includes(pid) ? { hand: mine.slice(), total: rules.total(mine, s.config), options: options(s, pid) } : null,
  };
}

module.exports = { createGame, options, applyMove, timeout, removePlayer, viewFor };
