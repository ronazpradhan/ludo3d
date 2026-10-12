// Dhumbal rooms: the shared room server (games/common/room-server.js) + Dhumbal's rules.
// Each game is one deal; points (play money) are kept across games until the room closes.
// Messages use the 'dh:' prefix.
const { createRoomServer } = require('../common/room-server');
const cards = require('../common/cards');
const engine = require('./engine');
const rules = require('./rules');

function defaultLog(e) {
  if (process.env.DHUMBAL_LOG !== '0') console.log(JSON.stringify({ ts: new Date().toISOString(), game: 'dhumbal', ...e }));
}

function makeAdapter(cfg, now) {
  function settle(room, { record }) {
    const g = room.game;
    if (!g || g.status !== 'over' || room.status !== 'playing') return;
    room.status = 'over';
    for (const [pid, d] of Object.entries(g.result.pay || {})) room.points[pid] = (room.points[pid] || 0) + d;
    if (g.result.winner) room.scores[g.result.winner] = (room.scores[g.result.winner] || 0) + 1;   // games won
    record(room, { type: 'GAME_RESULT', winner: g.result.winner, reason: g.result.reason, caller: g.result.caller, totals: g.result.totals, pay: g.result.pay });
  }
  return {
    gameType: 'dhumbal',
    minPlayers: cfg.minPlayers,
    maxPlayers: cfg.maxPlayers,
    init(room) { room.points = {}; room.lastDealerIdx = null; },
    roomInfo: () => ({ showMax: cfg.showMax, handSize: cfg.handSize }),
    playerInfo: (room, p) => ({ points: room.points[p.pid] || 0 }),
    start(room, { randInt, record }) {
      const n = room.players.length;
      // dealer: random first (OS CSPRNG), then rotates
      const di = room.lastDealerIdx == null || room.lastRoster !== n ? randInt(n) : (room.lastDealerIdx + 1) % n;
      room.lastDealerIdx = di; room.lastRoster = n;
      const g = room.game = engine.createGame({ players: room.players.map(p => p.pid), dealerIndex: di, config: cfg, randInt, now: now() });
      record(room, { type: 'GAME_STARTED', players: g.players, dealer: g.dealer, open: g.pickable[0] });
      record(room, { type: 'TURN_CHANGED', pid: g.current, turn: g.turn });
    },
    parseMove: mv => ({ type: mv.type, cards: mv.cards, source: mv.source, card: mv.card }),
    act: (room, pid, move, { randInt }) => engine.applyMove(room.game, pid, move, { randInt, now: now() }),
    leave: (room, pid, { randInt }) => engine.removePlayer(room.game, pid, now(), randInt),
    view: (room, pid) => engine.viewFor(room.game, pid, now()),
    afterChange: settle,
    tick(room, ctx) {
      if (room.status !== 'playing' || !room.game || room.game.status !== 'playing') return false;
      const ev = engine.timeout(room.game, now(), ctx.randInt);
      if (!ev.length) return false;
      for (const e of ev) ctx.record(room, e);
      settle(room, ctx);
      return true;
    },
  };
}

function createDhumbalServer({ send, now = Date.now, log = defaultLog, randInt = cards.secureInt, config = rules.CONFIG } = {}) {
  return createRoomServer({ prefix: 'dh:', adapter: makeAdapter(config, now), send, now, log, randInt });
}

module.exports = { createDhumbalServer };
