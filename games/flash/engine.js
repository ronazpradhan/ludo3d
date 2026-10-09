// Flash engine: one game (deal) - pure state + moves. No sockets, rooms or UI in here.
// The state lives ONLY on the server; clients get viewFor(), which hides every card a player
// may not see (including their OWN cards until they choose to look at them).
const cards = require('../common/cards');
const rules = require('./rules');

// players: ids in seat order (all can pay the boot). chips: { pid: amount } before the boot.
function createGame({ players, chips, dealerIndex, config = rules.CONFIG, randInt = cards.secureInt, now = Date.now() }) {
  const n = players.length;
  if (n < config.minPlayers || n > config.maxPlayers || new Set(players).size !== n) throw new Error('bad player list');
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= n) throw new Error('bad dealer');
  if (players.some(p => !(chips[p] >= config.boot))) throw new Error('player cannot pay the boot');

  const deck = cards.shuffle(cards.newDeck(), randInt);   // fresh deck + fresh shuffle every game
  const hands = Object.fromEntries(players.map(p => [p, []]));
  for (let k = 0; k < 3; k++) for (let i = 1; i <= n; i++) hands[players[(dealerIndex + i) % n]].push(deck.pop());

  const s = {
    config, players: players.slice(), hands,
    chips: Object.fromEntries(players.map(p => [p, chips[p]])), invested: Object.fromEntries(players.map(p => [p, 0])),
    packed: [], seen: Object.fromEntries(players.map(p => [p, false])),
    pot: 0, stake: config.boot, dealer: players[dealerIndex], current: players[(dealerIndex + 1) % n],
    status: 'playing', turn: 1, version: 1, deadline: now + config.turnSeconds * 1000,
    pending: null, lastAction: null, result: null, sideReveals: [],
  };
  for (const p of players) pay(s, p, config.boot);   // everyone puts in the boot
  return s;
}

// ---------- helpers ----------
const isIn = (s, p) => s.players.includes(p) && !s.packed.includes(p);
const activeList = s => s.players.filter(p => !s.packed.includes(p));
function stepActive(s, from, dir) {
  const n = s.players.length; let i = s.players.indexOf(from);
  for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (!s.packed.includes(s.players[i])) return s.players[i]; }
  return null;
}
const nextActive = (s, p) => stepActive(s, p, 1), prevActive = (s, p) => stepActive(s, p, -1);
function pay(s, p, amount) { s.chips[p] -= amount; s.invested[p] += amount; s.pot += amount; }

// What `pid` may do right now (also sent to that player so the UI only shows real options).
function options(s, pid) {
  const o = { see: false, pack: false, chaal: [], show: null, sideShow: null, reply: false };
  if (s.status !== 'playing' || !isIn(s, pid)) return o;
  const cfg = s.config, seen = s.seen[pid], chips = s.chips[pid], active = activeList(s);
  o.see = !seen;   // you can look at your cards any time
  if (s.pending) { o.reply = s.pending.to === pid; return o; }
  if (s.current !== pid) return o;
  o.pack = true;
  o.chaal = (seen ? cfg.seenMultipliers : cfg.blindMultipliers).map(mult => ({ mult, amount: s.stake * mult })).filter(c => c.amount <= chips);
  if (active.length === 2) {
    const other = active.find(p => p !== pid);
    // blind: costs the stake; seen: 2x the stake and only against a seen player (unless config allows)
    const cost = !seen ? s.stake : (s.seen[other] || cfg.seenCanShowBlind) ? s.stake * 2 : null;
    // house rule: if you can't cover the show you may still show with everything you have left
    if (cost != null) o.show = { cost: Math.min(cost, chips), allIn: chips < cost };
  } else if (cfg.sideShow && seen && active.length >= 3) {
    const prev = prevActive(s, pid), cost = s.stake * 2;
    if (s.seen[prev] && cost <= chips) o.sideShow = { cost, to: prev };
  }
  return o;
}

// ---------- moves ----------
function finish(s, winner, reason, events, shown) {
  s.chips[winner] += s.pot;
  s.result = { winner, reason, pot: s.pot, shown: shown || null };
  s.pot = 0;   // paid out (the result keeps the amount)
  s.status = 'over'; s.pending = null;
  events.push({ type: 'HAND_WON', pid: winner, pot: s.pot, reason });
}
function advance(s, from, now, events) {
  s.current = nextActive(s, from); s.turn++; s.deadline = now + s.config.turnSeconds * 1000;
  events.push({ type: 'TURN_CHANGED', pid: s.current, turn: s.turn });
}
function doPack(s, pid, now, events, why) {
  const wasTurn = s.current === pid && !s.pending;
  s.packed.push(pid);
  events.push({ type: 'PACKED', pid, ...(why ? { why } : {}) });
  const left = activeList(s);
  if (left.length === 1) return finish(s, left[0], 'others-packed', events);
  if (wasTurn) advance(s, pid, now, events);
}

const TYPES = ['see', 'pack', 'chaal', 'show', 'sideshow', 'reply'];

// Validates (the move comes from an untrusted client) and applies. Returns { ok, error?, events }.
// Events are PUBLIC: they never contain a card.
function applyMove(s, pid, move, { now = Date.now() } = {}) {
  const fail = error => ({ ok: false, error, events: [] });
  if (!move || typeof move !== 'object' || !TYPES.includes(move.type)) return fail('BAD_REQUEST');
  if (move.type === 'chaal' && !Number.isInteger(move.mult)) return fail('BAD_REQUEST');
  if (move.type === 'reply' && typeof move.accept !== 'boolean') return fail('BAD_REQUEST');
  if (s.status !== 'playing') return fail('GAME_NOT_RUNNING');
  if (!s.players.includes(pid)) return fail('NOT_IN_GAME');
  if (s.packed.includes(pid)) return fail('PACKED');
  const o = options(s, pid), events = [];

  if (move.type === 'see') {
    if (!o.see) return fail('ILLEGAL_MOVE');
    s.seen[pid] = true; events.push({ type: 'PLAYER_SAW', pid });
  } else if (move.type === 'reply') {
    if (!o.reply) return fail(s.pending ? 'NOT_YOUR_TURN' : 'ILLEGAL_MOVE');
    sideShowAnswer(s, move.accept, now, events);
  } else {
    if (s.pending) return fail(s.pending.from === pid ? 'WAITING' : 'NOT_YOUR_TURN');
    if (s.current !== pid) return fail('NOT_YOUR_TURN');
    if (move.type === 'pack') doPack(s, pid, now, events);
    else if (move.type === 'chaal') {
      const c = o.chaal.find(x => x.mult === move.mult);
      if (!c) return fail((s.seen[pid] ? s.config.seenMultipliers : s.config.blindMultipliers).includes(move.mult) ? 'NOT_ENOUGH_CHIPS' : 'ILLEGAL_MOVE');
      const blind = !s.seen[pid];
      pay(s, pid, c.amount);
      s.stake = blind ? c.amount : c.amount / 2;   // the stake is always kept in "blind" terms
      s.lastAction = { pid, type: 'chaal', amount: c.amount, blind };
      events.push({ type: 'CHAAL', pid, amount: c.amount, blind });
      advance(s, pid, now, events);
    } else if (move.type === 'show') {
      if (!o.show) return fail('ILLEGAL_MOVE');
      const other = activeList(s).find(p => p !== pid);
      pay(s, pid, o.show.cost);
      events.push({ type: 'SHOW', pid, vs: other, cost: o.show.cost });
      // higher hand wins; on a tie the player who asked for the show loses
      const winner = rules.compare(s.hands[pid], s.hands[other], s.config) > 0 ? pid : other;
      finish(s, winner, 'show', events, { [pid]: s.hands[pid].slice(), [other]: s.hands[other].slice() });
    } else if (move.type === 'sideshow') {
      if (!o.sideShow) return fail('ILLEGAL_MOVE');
      pay(s, pid, o.sideShow.cost);   // a seen bet of 2x: the stake stays the same
      s.pending = { from: pid, to: o.sideShow.to, cost: o.sideShow.cost };
      s.deadline = now + s.config.turnSeconds * 1000;
      events.push({ type: 'SIDESHOW_ASKED', pid, to: o.sideShow.to, cost: o.sideShow.cost });
    }
  }
  s.version++;
  return { ok: true, events };
}

function sideShowAnswer(s, accept, now, events) {
  const { from, to } = s.pending; s.pending = null;
  if (!accept) { events.push({ type: 'SIDESHOW_RESULT', pid: from, to, accepted: false }); return advance(s, from, now, events); }
  // lower hand packs; on a tie the asker packs. Only these two players see each other's cards.
  const loser = rules.compare(s.hands[from], s.hands[to], s.config) > 0 ? to : from;
  s.sideReveals.push({ a: from, b: to, hands: { [from]: s.hands[from].slice(), [to]: s.hands[to].slice() }, loser });
  events.push({ type: 'SIDESHOW_RESULT', pid: from, to, accepted: true, loser });
  s.packed.push(loser);
  events.push({ type: 'PACKED', pid: loser, why: 'sideshow' });
  advance(s, from, now, events);   // play continues after the asker (they may have just packed)
}

// The turn clock ran out: decline a pending side show, otherwise the player packs.
function timeout(s, now = Date.now()) {
  const events = [];
  if (s.status !== 'playing' || now < s.deadline) return events;
  if (s.pending) sideShowAnswer(s, false, now, events);
  else doPack(s, s.current, now, events, 'timeout');
  s.version++;
  return events;
}

// A player left the table for good: they pack (their chips in the pot stay in the pot).
function removePlayer(s, pid, now = Date.now()) {
  const events = [];
  if (s.status !== 'playing' || !isIn(s, pid)) return events;
  if (s.pending && (s.pending.to === pid || s.pending.from === pid)) {
    if (s.pending.to === pid) sideShowAnswer(s, false, now, events);
    else { s.pending = null; s.current = pid; }
  }
  doPack(s, pid, now, events, 'left');
  s.version++;
  return events;
}

// ---------- what one player may see ----------
function viewFor(s, pid, now = Date.now()) {
  const inGame = s.players.includes(pid), over = s.status === 'over';
  const v = {
    status: s.status, version: s.version, turn: s.turn, current: s.current, dealer: s.dealer,
    pot: s.pot, stake: s.stake, boot: s.config.boot, timeLeft: over ? 0 : Math.max(0, s.deadline - now), turnMs: s.config.turnSeconds * 1000,
    players: s.players.map(p => ({ pid: p, packed: s.packed.includes(p), seen: s.seen[p], chips: s.chips[p], bet: s.invested[p] })),
    pending: s.pending && { from: s.pending.from, to: s.pending.to, cost: s.pending.cost },
    lastAction: s.lastAction,
    result: s.result && { winner: s.result.winner, reason: s.result.reason, pot: s.result.pot,
      shown: s.result.shown && Object.fromEntries(Object.entries(s.result.shown).map(([p, h]) => [p, { hand: h, name: rules.evaluate(h, s.config).name }])) },
    sideShow: null, you: null,
  };
  // a side show's cards are only for the two players in it
  const sr = [...s.sideReveals].reverse().find(r => r.a === pid || r.b === pid);
  if (sr) { const other = sr.a === pid ? sr.b : sr.a; v.sideShow = { with: other, theirHand: sr.hands[other], theirName: rules.evaluate(sr.hands[other], s.config).name, loser: sr.loser }; }
  if (inGame) {
    // your own cards only once you've looked (or the game is over)
    const look = s.seen[pid] || over, hand = s.hands[pid];
    v.you = { seen: s.seen[pid], hand: look ? hand.slice() : null, handName: look ? rules.evaluate(hand, s.config).name : null, options: options(s, pid) };
  }
  return v;
}

module.exports = { createGame, options, applyMove, timeout, removePlayer, viewFor, activeList, nextActive, prevActive };
