// Jutpatti rooms: the shared room server (games/common/room-server.js) + Jutpatti's rules.
// Messages use the 'jp:' prefix so they never mix with the Ludo relay or other games.
const { createRoomServer } = require('../common/room-server');
const engine = require('./engine');
const rules = require('./rules');
const cards = require('./cards');

function defaultLog(e) {
  if (process.env.JUTPATTI_LOG !== '0') console.log(JSON.stringify({ ts: new Date().toISOString(), game: 'jutpatti', ...e }));
}

const usableSizes = n => rules.CONFIG.handSizes.filter(h => rules.validHandSize(h, Math.max(2, n)));

const adapter = {
  gameType: 'jutpatti',
  minPlayers: rules.CONFIG.minPlayers,
  maxPlayers: rules.CONFIG.maxPlayers,
  init(room) { room.handSize = rules.CONFIG.defaultHandSize; room.lastDealerIdx = null; },
  onJoin(room) {   // more players may not fit the chosen hand size: drop to the largest that fits
    if (!rules.validHandSize(room.handSize, room.players.length)) room.handSize = Math.max(...usableSizes(room.players.length));
  },
  roomInfo: room => ({ handSize: room.handSize, handSizes: usableSizes(room.players.length) }),
  setOpts(room, m) {
    const h = Number(m.handSize);
    if (!rules.validHandSize(h, Math.max(2, room.players.length))) return 'BAD_OPTION';
    room.handSize = h; for (const p of room.players) p.ready = false;   // settings changed: everyone re-confirms
    return null;
  },
  canStart: room => rules.validHandSize(room.handSize, room.players.length) ? null : 'BAD_OPTION',
  start(room, { randInt, record }) {
    const n = room.players.length;
    // Dealer: random for the first game, then rotates. Uses the OS CSPRNG, never ids/names/order/time.
    const dealerIndex = room.lastDealerIdx == null || room.lastRoster !== n ? randInt(n) : (room.lastDealerIdx + 1) % n;
    room.lastDealerIdx = dealerIndex; room.lastRoster = n;
    const g = room.game = engine.createGame({ players: room.players.map(p => p.pid), handSize: room.handSize, dealerIndex, randInt });
    record(room, { type: 'GAME_STARTED', players: g.players, dealer: g.dealer, handSize: g.handSize });
    record(room, { type: 'CARDS_DEALT', counts: g.players.map(x => g.hands[x].length), shown: g.shown, jokerRank: g.jokerRank });
    record(room, { type: 'TURN_CHANGED', pid: g.current, turn: g.turn });
  },
  parseMove: mv => ({ type: mv.type, source: mv.source, card: mv.card, pairs: mv.pairs }),
  act(room, pid, move, { randInt }) {
    const r = engine.applyMove(room.game, pid, move, randInt);
    return { ...r, extra: r.bad && r.bad.length ? { bad: r.bad } : undefined };
  },
  leave: (room, pid, { randInt }) => engine.removePlayer(room.game, pid, randInt).filter(e => e.type !== 'PLAYER_LEFT'),
  view: (room, pid) => engine.viewFor(room.game, pid),
  afterChange(room) {
    const g = room.game;
    if (g && g.status === 'over' && room.status === 'playing') {
      room.status = 'over';
      if (g.winner) room.scores[g.winner] = (room.scores[g.winner] || 0) + rules.CONFIG.pointsPerWin;
    }
  },
};

function createJutpattiServer({ send, now = Date.now, log = defaultLog, randInt = cards.secureInt } = {}) {
  return createRoomServer({ prefix: 'jp:', adapter, send, now, log, randInt });
}

module.exports = { createJutpattiServer };
