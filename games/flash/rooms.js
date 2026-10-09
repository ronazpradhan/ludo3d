// Flash rooms: the shared room server (games/common/room-server.js) + Flash's rules.
// A ROUND is CONFIG.gamesPerRound games. Everyone starts a round with CONFIG.startingChips play-money
// chips, which carry over between that round's games and reset when the next round starts.
// Sapati (borrowing) is tracked per round and settled when the round ends.
// Messages use the 'fl:' prefix.
const { createRoomServer } = require('../common/room-server');
const cards = require('../common/cards');
const engine = require('./engine');
const rules = require('./rules');

function defaultLog(e) {
  if (process.env.FLASH_LOG !== '0') console.log(JSON.stringify({ ts: new Date().toISOString(), game: 'flash', ...e }));
}

function makeAdapter(cfg, now) {
  const SP = cfg.sapati;
  const canPlay = (room, pid) => chipsOf(room, pid) >= cfg.boot;

  // A player's chips live in the running game while they're in it, otherwise on the room.
  const liveIn = (room, pid) => room.game && room.game.status === 'playing' && room.game.players.includes(pid) && !room.settled;
  const chipsOf = (room, pid) => liveIn(room, pid) ? room.game.chips[pid] : room.chips[pid] || 0;
  function addChips(room, pid, d) {
    if (liveIn(room, pid)) { room.game.chips[pid] += d; room.game.version++; }   // version bump: stale actions get refreshed
    else room.chips[pid] = (room.chips[pid] || 0) + d;
  }

  // ---------- sapati ----------
  const borrowed = (room, pid) => room.loans.filter(l => l.to === pid).reduce((a, l) => a + l.amount, 0);
  const lent = (room, pid) => room.loans.filter(l => l.from === pid).reduce((a, l) => a + l.amount, 0);
  const canBorrow = (room, pid) => SP.maxBorrow - borrowed(room, pid);
  const canLend = (room, pid) => Math.max(0, Math.min(chipsOf(room, pid), SP.maxLend - lent(room, pid)));
  // the bank only steps in after asking a player didn't work, or when nobody at the table can lend
  const bankOk = (room, pid) => !SP.bankOnlyAsFallback || room.tried[pid] ||
    !room.players.some(p => p.pid !== pid && p.connected && canLend(room, p.pid) >= SP.step);

  function sapati(room, pid, m) {
    if (!SP.enabled) return { error: 'BAD_REQUEST' };
    if (room.status !== 'playing') return { error: 'ROUND_NOT_RUNNING' };
    const act = m.action, events = [];
    if (act === 'ask' || act === 'bank') {
      const amount = m.amount;
      if (!Number.isInteger(amount) || amount < SP.step || amount % SP.step) return { error: 'BAD_AMOUNT' };
      if (amount > canBorrow(room, pid)) return { error: 'BORROW_LIMIT' };
      if (room.requests.some(r => r.from === pid)) return { error: 'ALREADY_ASKED' };
      if (act === 'bank') {
        if (!bankOk(room, pid)) return { error: 'ASK_A_PLAYER_FIRST' };
        room.loans.push({ from: 'bank', to: pid, amount }); addChips(room, pid, amount);
        events.push({ type: 'SAPATI_GIVEN', pid: 'bank', to: pid, amount });
      } else {
        const to = m.to;
        if (to === pid || !room.players.some(p => p.pid === to)) return { error: 'BAD_REQUEST' };
        if (amount > canLend(room, to)) return { error: 'LENDER_LIMIT' };
        room.requests.push({ id: ++room.reqSeq, from: pid, to, amount, expires: now() + SP.askSeconds * 1000 });
        events.push({ type: 'SAPATI_ASKED', pid, to, amount });
      }
    } else if (act === 'answer') {
      const r = room.requests.find(x => x.id === m.id);
      if (!r || r.to !== pid) return { error: 'BAD_REQUEST' };   // only the asked player can answer
      if (typeof m.accept !== 'boolean') return { error: 'BAD_REQUEST' };
      room.requests = room.requests.filter(x => x !== r);
      // limits are re-checked now: chips may have changed since the request was made
      if (m.accept && r.amount <= canLend(room, pid) && r.amount <= canBorrow(room, r.from)) {
        room.loans.push({ from: pid, to: r.from, amount: r.amount });
        addChips(room, pid, -r.amount); addChips(room, r.from, r.amount);
        events.push({ type: 'SAPATI_GIVEN', pid, to: r.from, amount: r.amount });
      } else {
        room.tried[r.from] = true;
        events.push({ type: 'SAPATI_DECLINED', pid, to: r.from, amount: r.amount, ...(m.accept ? { why: 'limit' } : {}) });
      }
    } else if (act === 'cancel') {
      const before = room.requests.length;
      room.requests = room.requests.filter(x => x.from !== pid);
      if (room.requests.length === before) return { error: 'BAD_REQUEST' };
    } else return { error: 'BAD_REQUEST' };
    return { events };
  }

  // End of round: every borrower pays back from their chips (in the order they borrowed). Whatever they
  // can't cover is subtracted from their final score and credited to the lender, so the winner is the
  // player who really came out on top.
  function settle(room) {
    const final = Object.fromEntries(room.players.map(p => [p.pid, room.chips[p.pid] || 0]));
    const lines = [];
    for (const l of room.loans) {
      const paid = Math.min(l.amount, Math.max(0, room.chips[l.to] || 0)), unpaid = l.amount - paid;
      if (room.chips[l.to] != null) room.chips[l.to] -= paid;
      if (l.from !== 'bank' && room.chips[l.from] != null) room.chips[l.from] += paid;
      if (final[l.to] != null) final[l.to] -= l.amount;
      if (l.from !== 'bank' && final[l.from] != null) final[l.from] += l.amount;
      lines.push({ ...l, paid, unpaid });
    }
    return { final, lines };
  }

  function endRound(room, { record }) {
    room.status = 'over'; room.nextAt = null; room.requests = [];
    const { final, lines } = settle(room);
    room.final = final; room.settlement = lines;
    const st = room.players.map(p => ({ pid: p.pid, chips: room.chips[p.pid] || 0, final: final[p.pid] })).sort((a, b) => b.final - a.final);
    const top = st.length ? st[0].final : 0;
    for (const s of st) if (s.final === top) room.scores[s.pid] = (room.scores[s.pid] || 0) + 1;   // round wins
    if (lines.length) record(room, { type: 'SAPATI_SETTLED', loans: lines.map(l => ({ from: l.from, to: l.to, amount: l.amount, paid: l.paid })) });
    record(room, { type: 'ROUND_OVER', round: room.round, standings: st });
  }

  // deals the next game of the round to everyone who can still pay the boot
  function deal(room, { randInt, record }) {
    room.gameInRound++;
    const ids = room.players.map(p => p.pid).filter(pid => canPlay(room, pid));
    // dealer: random for the round's first game (OS CSPRNG), then the next player who is still in
    let di;
    if (room.lastDealer == null || !room.players.some(p => p.pid === room.lastDealer)) di = randInt(ids.length);
    else { const seat = room.players.map(p => p.pid), from = seat.indexOf(room.lastDealer);
      for (let k = 1; k <= seat.length; k++) { const d = ids.indexOf(seat[(from + k) % seat.length]); if (d >= 0) { di = d; break; } } }
    const g = room.game = engine.createGame({ players: ids, chips: room.chips, dealerIndex: di, config: cfg, randInt, now: now() });
    room.lastDealer = g.dealer; room.settled = false; room.nextAt = null;
    record(room, { type: 'GAME_STARTED', round: room.round, game: room.gameInRound, players: ids, dealer: g.dealer, boot: cfg.boot });
    record(room, { type: 'TURN_CHANGED', pid: g.current, turn: g.turn });
  }

  // after every change: settle a finished game, then schedule the next one or end the round
  function afterChange(room, ctx) {
    const g = room.game;
    if (!g || g.status !== 'over' || room.settled || room.status !== 'playing') return;
    room.settled = true;
    for (const pid of g.players) if (room.chips[pid] != null) room.chips[pid] = g.chips[pid];
    if (room.gameInRound >= cfg.gamesPerRound) endRound(room, ctx);
    else room.nextAt = now() + cfg.nextGameSeconds * 1000;   // a broke player can borrow in the pause
  }

  return {
    gameType: 'flash',
    minPlayers: cfg.minPlayers,
    maxPlayers: cfg.maxPlayers,
    init(room) {
      room.chips = {}; room.round = 0; room.gameInRound = 0; room.nextAt = null; room.lastDealer = null; room.settled = true;
      room.loans = []; room.requests = []; room.tried = {}; room.reqSeq = 0; room.final = null; room.settlement = [];
    },
    roomInfo: room => ({ round: room.round, gameInRound: room.gameInRound, gamesPerRound: cfg.gamesPerRound,
      startingChips: cfg.startingChips, boot: cfg.boot, nextIn: room.nextAt ? Math.max(0, room.nextAt - now()) : null,
      sapati: { enabled: SP.enabled, maxBorrow: SP.maxBorrow, maxLend: SP.maxLend, step: SP.step,
        loans: room.loans, requests: room.requests.map(r => ({ id: r.id, from: r.from, to: r.to, amount: r.amount, left: Math.max(0, r.expires - now()) })),
        settlement: room.status === 'over' ? room.settlement : null } }),
    playerInfo: (room, p) => ({ chips: room.chips[p.pid] ?? null, final: room.status === 'over' && room.final ? room.final[p.pid] : null,
      borrowed: borrowed(room, p.pid), lent: lent(room, p.pid), canBorrow: canBorrow(room, p.pid), canLend: canLend(room, p.pid), bankOk: bankOk(room, p.pid) }),
    canStart: () => null,
    start(room, ctx) {
      if (room.status !== 'playing') {   // a new round: fresh chips, no debts
        room.round++; room.gameInRound = 0; room.lastDealer = null; room.chips = {};
        room.loans = []; room.requests = []; room.tried = {}; room.final = null; room.settlement = [];
        for (const p of room.players) room.chips[p.pid] = cfg.startingChips;
        ctx.record(room, { type: 'ROUND_STARTED', round: room.round, chips: cfg.startingChips });
      }
      deal(room, ctx);
    },
    parseMove: mv => ({ type: mv.type, mult: mv.mult, accept: mv.accept }),
    act: (room, pid, move) => engine.applyMove(room.game, pid, move, { now: now() }),
    custom(room, pid, m) {
      if (m.what === 'sapati') return sapati(room, pid, { action: m.action, to: m.to, amount: m.amount, id: m.id, accept: m.accept });
      return { error: 'BAD_REQUEST' };
    },
    leave(room, pid) {
      const ev = room.game ? engine.removePlayer(room.game, pid, now()) : [];
      room.requests = room.requests.filter(r => r.from !== pid && r.to !== pid);
      delete room.chips[pid];
      return ev;
    },
    view: (room, pid) => engine.viewFor(room.game, pid, now()),
    afterChange,
    // runs every second: the turn clock, unanswered sapati requests, and the next game
    tick(room, ctx) {
      if (room.status !== 'playing' || !room.game) return false;
      let changed = false;
      for (const r of room.requests.filter(x => now() >= x.expires)) {   // no answer = declined
        room.requests = room.requests.filter(x => x !== r); room.tried[r.from] = true; changed = true;
        ctx.record(room, { type: 'SAPATI_DECLINED', pid: r.to, to: r.from, amount: r.amount, why: 'no answer' });
      }
      if (room.game.status === 'playing') {
        const ev = engine.timeout(room.game, now());
        if (ev.length) { for (const e of ev) ctx.record(room, e); afterChange(room, ctx); changed = true; }
      } else if (room.nextAt && now() >= room.nextAt) {
        room.nextAt = null;
        if (room.players.filter(p => canPlay(room, p.pid)).length < cfg.minPlayers) { endRound(room, ctx); return true; }   // not enough players can pay the boot
        ctx.startGame(room);
        return false;   // startGame already sent everyone the new state
      }
      return changed;
    },
  };
}

function createFlashServer({ send, now = Date.now, log = defaultLog, randInt = cards.secureInt, config = rules.CONFIG } = {}) {
  return createRoomServer({ prefix: 'fl:', adapter: makeAdapter(config, now), send, now, log, randInt });
}

module.exports = { createFlashServer };
