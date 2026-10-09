// Flash rooms: the shared room server (games/common/room-server.js) + Flash's rules.
// A ROUND is CONFIG.gamesPerRound games. Everyone starts a round with CONFIG.startingChips play-money
// chips, which carry over between that round's games and reset when the next round starts.
// Messages use the 'fl:' prefix.
const { createRoomServer } = require('../common/room-server');
const cards = require('../common/cards');
const engine = require('./engine');
const rules = require('./rules');

function defaultLog(e) {
  if (process.env.FLASH_LOG !== '0') console.log(JSON.stringify({ ts: new Date().toISOString(), game: 'flash', ...e }));
}

function makeAdapter(cfg, now) {
  const canPlay = (room, pid) => (room.chips[pid] || 0) >= cfg.boot;

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

  function standings(room) {
    return room.players.map(p => ({ pid: p.pid, chips: room.chips[p.pid] || 0 })).sort((a, b) => b.chips - a.chips);
  }

  // after every change: settle a finished game, then either schedule the next one or end the round
  function afterChange(room, { record }) {
    const g = room.game;
    if (!g || g.status !== 'over' || room.settled || room.status !== 'playing') return;
    room.settled = true;
    for (const pid of g.players) if (room.chips[pid] != null) room.chips[pid] = g.chips[pid];
    const left = room.players.filter(p => canPlay(room, p.pid)).length;
    if (room.gameInRound >= cfg.gamesPerRound || left < cfg.minPlayers) {
      room.status = 'over';
      const st = standings(room), top = st.length ? st[0].chips : 0;
      for (const s of st) if (s.chips === top) room.scores[s.pid] = (room.scores[s.pid] || 0) + 1;   // round wins
      record(room, { type: 'ROUND_OVER', round: room.round, standings: st });
    } else room.nextAt = now() + cfg.nextGameSeconds * 1000;
  }

  return {
    gameType: 'flash',
    minPlayers: cfg.minPlayers,
    maxPlayers: cfg.maxPlayers,
    init(room) { room.chips = {}; room.round = 0; room.gameInRound = 0; room.nextAt = null; room.lastDealer = null; room.settled = true; },
    roomInfo: room => ({ round: room.round, gameInRound: room.gameInRound, gamesPerRound: cfg.gamesPerRound,
      startingChips: cfg.startingChips, boot: cfg.boot, nextIn: room.nextAt ? Math.max(0, room.nextAt - now()) : null }),
    playerInfo: (room, p) => ({ chips: room.chips[p.pid] ?? null }),
    canStart: () => null,
    start(room, ctx) {
      if (room.status !== 'playing') {   // a new round: everyone gets fresh chips
        room.round++; room.gameInRound = 0; room.lastDealer = null; room.chips = {};
        for (const p of room.players) room.chips[p.pid] = cfg.startingChips;
        ctx.record(room, { type: 'ROUND_STARTED', round: room.round, chips: cfg.startingChips });
      }
      deal(room, ctx);
    },
    parseMove: mv => ({ type: mv.type, mult: mv.mult, accept: mv.accept }),
    act: (room, pid, move) => engine.applyMove(room.game, pid, move, { now: now() }),
    leave(room, pid) { const ev = room.game ? engine.removePlayer(room.game, pid, now()) : []; delete room.chips[pid]; return ev; },
    view: (room, pid) => engine.viewFor(room.game, pid, now()),
    afterChange,
    // runs every second: the turn clock, and starting the next game after the pause
    tick(room, ctx) {
      if (room.status !== 'playing' || !room.game) return false;
      if (room.game.status === 'playing') {
        const ev = engine.timeout(room.game, now());
        if (!ev.length) return false;
        for (const e of ev) ctx.record(room, e);
        afterChange(room, ctx);
        return true;
      }
      if (room.nextAt && now() >= room.nextAt) { room.nextAt = null; ctx.startGame(room); }
      return false;
    },
  };
}

function createFlashServer({ send, now = Date.now, log = defaultLog, randInt = cards.secureInt, config = rules.CONFIG } = {}) {
  return createRoomServer({ prefix: 'fl:', adapter: makeAdapter(config, now), send, now, log, randInt });
}

module.exports = { createFlashServer };
