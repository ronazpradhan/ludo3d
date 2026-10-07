// Jutpatti rooms: server-authoritative multiplayer on top of server.js's WebSocket connection.
// Messages use the 'jp:' prefix so they never mix with the Ludo relay.
//
// Identity: on create/join the server issues a public player id (pid) and a secret token.
// The socket is then bound to that player; every action is taken AS the bound player, so a
// client cannot act for someone else by sending another id. The token lets a refreshed or
// reconnected browser take its seat back.
const crypto = require('crypto');
const engine = require('./engine');
const rules = require('./rules');
const cards = require('./cards');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', CODE_RE = /^[A-Z0-9]{5}$/, TOKEN_RE = /^[a-f0-9]{48}$/;
const LOBBY_GRACE_MS = 45e3;     // a disconnected player is removed from a lobby after this
const GAME_GRACE_MS = 120e3;     // ...and from a running game after this (their cards go back to the stock)
const EMPTY_ROOM_MS = 10 * 60e3; // a room with nobody connected is deleted after this
const MAX_ROOMS = 2000, HISTORY = 40;

const cleanName = x => String(x ?? '').replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, 14);

function defaultLog(e) {
  if (process.env.JUTPATTI_LOG !== '0') console.log(JSON.stringify({ ts: new Date().toISOString(), game: 'jutpatti', ...e }));
}

function createJutpattiServer({ send, now = Date.now, log = defaultLog, randInt = cards.secureInt } = {}) {
  const rooms = new Map();

  // ---------- helpers ----------
  const err = (ws, code, extra) => send(ws, { t: 'jp:err', code, ...extra });
  const findPlayer = (room, pid) => room.players.find(p => p.pid === pid);

  function newCode() {
    for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; if (!rooms.has(c)) return c; }
  }

  // Public event log: written to the server log and kept (last HISTORY) for players to see.
  // Callers only pass public data; stock-drawn cards never reach here (engine events omit them).
  function record(room, e) {
    const entry = { ...e, id: room.seq = (room.seq || 0) + 1, at: now() };   // id: lets clients animate each event once
    room.history.push(entry); if (room.history.length > HISTORY) room.history.shift();
    log({ room: room.code, gameNo: room.gameNo, ...e });
  }

  function roomView(room, pid) {
    return {
      t: 'jp:state', you: pid,
      room: {
        code: room.code, gameType: room.gameType, hostPid: room.hostPid, status: room.status,
        handSize: room.handSize, gameNo: room.gameNo,
        handSizes: rules.CONFIG.handSizes.filter(h => rules.validHandSize(h, Math.max(2, room.players.length))),
        minPlayers: rules.CONFIG.minPlayers, maxPlayers: rules.CONFIG.maxPlayers,
        players: room.players.map(p => ({ pid: p.pid, name: p.name, ready: p.ready, connected: p.connected, score: room.scores[p.pid] || 0 })),
        names: room.names, history: room.history,
      },
      game: room.game ? engine.viewFor(room.game, pid) : null,
    };
  }

  // Every player gets their own sanitized view; nobody ever receives another player's hand.
  function broadcast(room) { for (const p of room.players) if (p.ws) send(p.ws, roomView(room, p.pid)); }

  function bind(ws, room, p) {
    if (p.ws && p.ws !== ws) { send(p.ws, { t: 'jp:kicked', reason: 'opened elsewhere' }); p.ws.jp = null; }
    if (ws.jp && (ws.jp.code !== room.code || ws.jp.pid !== p.pid)) unbind(ws);
    p.ws = ws; p.connected = true; p.lastSeen = now(); ws.jp = { code: room.code, pid: p.pid };
  }
  function unbind(ws) {
    const b = ws.jp; ws.jp = null; if (!b) return;
    const room = rooms.get(b.code), p = room && findPlayer(room, b.pid);
    if (p && p.ws === ws) { p.ws = null; p.connected = false; p.lastSeen = now(); broadcast(room); }
  }

  function addPlayer(room, name) {
    const p = { pid: crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(24).toString('hex'),
      name, ready: false, connected: false, ws: null, lastSeen: now(), aids: [] };
    room.players.push(p); room.names[p.pid] = name;
    if (!rules.validHandSize(room.handSize, room.players.length))
      room.handSize = Math.max(...rules.CONFIG.handSizes.filter(h => rules.validHandSize(h, room.players.length)));
    return p;
  }

  function removePlayer(room, p, why) {
    room.players = room.players.filter(x => x !== p);
    if (p.ws) { p.ws.jp = null; p.ws = null; }
    record(room, { type: 'PLAYER_LEFT', pid: p.pid, why });
    if (room.game && room.status === 'playing') {
      for (const e of engine.removePlayer(room.game, p.pid, randInt)) if (e.type !== 'PLAYER_LEFT') record(room, e);
      afterMove(room);
    }
    if (!room.players.length) { rooms.delete(room.code); log({ room: room.code, type: 'ROOM_CLOSED' }); return; }
    if (room.hostPid === p.pid) room.hostPid = room.players[0].pid;   // host role only controls start/hand size
    broadcast(room);
  }

  function startGame(room) {
    const n = room.players.length;
    // Dealer: random for the first game, then rotates. Uses the OS CSPRNG, never ids/names/order/time.
    const dealerIndex = room.lastDealerIdx == null || room.lastRoster !== n ? randInt(n) : (room.lastDealerIdx + 1) % n;
    room.lastDealerIdx = dealerIndex; room.lastRoster = n;
    room.game = engine.createGame({ players: room.players.map(p => p.pid), handSize: room.handSize, dealerIndex, randInt });
    room.gameNo++; room.status = 'playing';
    for (const p of room.players) { p.ready = false; p.aids = []; }
    const g = room.game;
    record(room, { type: 'GAME_STARTED', players: g.players, dealer: g.dealer, handSize: g.handSize });
    record(room, { type: 'CARDS_DEALT', counts: g.players.map(x => g.hands[x].length), shown: g.shown, jokerRank: g.jokerRank });
    record(room, { type: 'TURN_CHANGED', pid: g.current, turn: g.turn });
    broadcast(room);
  }

  function afterMove(room) {
    const g = room.game;
    if (g && g.status === 'over' && room.status === 'playing') {
      room.status = 'over';
      if (g.winner) room.scores[g.winner] = (room.scores[g.winner] || 0) + rules.CONFIG.pointsPerWin;
    }
  }

  // ---------- message handlers ----------
  const H = {
    'jp:create'(ws, m) {
      const name = cleanName(m.name); if (!name) return err(ws, 'NAME_REQUIRED');
      if (rooms.size >= MAX_ROOMS) return err(ws, 'SERVER_FULL');
      const room = { code: newCode(), gameType: 'jutpatti', players: [], names: {}, hostPid: null, status: 'lobby',
        handSize: rules.CONFIG.defaultHandSize, game: null, gameNo: 0, scores: {}, history: [], lastDealerIdx: null, emptySince: null };
      rooms.set(room.code, room);
      const p = addPlayer(room, name); room.hostPid = p.pid; bind(ws, room, p);
      record(room, { type: 'ROOM_CREATED', pid: p.pid });
      send(ws, { t: 'jp:joined', code: room.code, pid: p.pid, token: p.token });
      broadcast(room);
    },
    'jp:join'(ws, m) {
      const name = cleanName(m.name); if (!name) return err(ws, 'NAME_REQUIRED');
      const code = String(m.code || '').toUpperCase(), room = CODE_RE.test(code) && rooms.get(code);
      if (!room) return err(ws, 'ROOM_NOT_FOUND');
      if (room.status === 'playing') return err(ws, 'IN_PROGRESS');
      if (room.players.length >= rules.CONFIG.maxPlayers) return err(ws, 'ROOM_FULL');
      const p = addPlayer(room, name); bind(ws, room, p);
      if (room.status === 'over') p.ready = false;
      record(room, { type: 'PLAYER_JOINED', pid: p.pid });
      send(ws, { t: 'jp:joined', code: room.code, pid: p.pid, token: p.token });
      broadcast(room);
    },
    'jp:resume'(ws, m) {
      const room = rooms.get(String(m.code || '').toUpperCase());
      const tok = String(m.token || ''), p = room && TOKEN_RE.test(tok) && room.players.find(x => x.token.length === tok.length && crypto.timingSafeEqual(Buffer.from(x.token), Buffer.from(tok)));
      if (!p) return err(ws, 'SESSION_EXPIRED');
      bind(ws, room, p);
      send(ws, { t: 'jp:joined', code: room.code, pid: p.pid, token: p.token, resumed: true });
      broadcast(room);
    },
    'jp:sync'(ws) { const b = bound(ws); if (b) send(ws, roomView(b.room, b.p.pid)); },
    'jp:leave'(ws) { const b = bound(ws); if (b) { removePlayer(b.room, b.p, 'left'); send(ws, { t: 'jp:left' }); } },
    'jp:ready'(ws, m) {
      const b = bound(ws); if (!b) return err(ws, 'NOT_IN_ROOM');
      const { room, p } = b;
      if (room.status === 'playing') return err(ws, 'IN_PROGRESS');
      p.ready = !!m.ready; broadcast(room);
      // Rematch: once everyone at the table asks for it, the next game starts by itself.
      if (room.status === 'over' && room.players.length >= rules.CONFIG.minPlayers && room.players.every(x => x.ready)) startGame(room);
    },
    'jp:opts'(ws, m) {
      const b = bound(ws); if (!b) return err(ws, 'NOT_IN_ROOM');
      if (b.room.hostPid !== b.p.pid) return err(ws, 'NOT_HOST');
      if (b.room.status === 'playing') return err(ws, 'IN_PROGRESS');
      const h = Number(m.handSize);
      if (!rules.validHandSize(h, Math.max(2, b.room.players.length))) return err(ws, 'BAD_OPTION');
      b.room.handSize = h; for (const p of b.room.players) p.ready = false;   // settings changed: everyone re-confirms
      broadcast(b.room);
    },
    'jp:start'(ws) {
      const b = bound(ws); if (!b) return err(ws, 'NOT_IN_ROOM');
      const { room, p } = b;
      if (room.hostPid !== p.pid) return err(ws, 'NOT_HOST');
      if (room.status === 'playing') return err(ws, 'IN_PROGRESS');
      if (room.players.length < rules.CONFIG.minPlayers) return err(ws, 'NOT_ENOUGH_PLAYERS');
      if (!room.players.every(x => x.ready || x === p)) return err(ws, 'NOT_READY');
      if (!room.players.every(x => x.connected)) return err(ws, 'PLAYER_OFFLINE');
      if (!rules.validHandSize(room.handSize, room.players.length)) return err(ws, 'BAD_OPTION');
      startGame(room);
    },
    'jp:act'(ws, m) {
      // 1. sender is a player in this room (identity comes from the socket, never from the message)
      const b = bound(ws); if (!b) return err(ws, 'NOT_IN_ROOM');
      const { room, p } = b, g = room.game;
      // 2. game is running
      if (!g || room.status !== 'playing') return err(ws, 'GAME_NOT_RUNNING');
      // 6. duplicate / replayed / stale messages: each action carries a fresh id and the state version it was made on
      const aid = typeof m.aid === 'string' && m.aid.length <= 32 ? m.aid : null;
      if (!aid) return err(ws, 'BAD_REQUEST');
      if (p.aids.includes(aid)) return send(ws, roomView(room, p.pid));          // duplicate: ignore, resend truth
      if (m.v !== g.version) { err(ws, 'STALE'); return send(ws, roomView(room, p.pid)); }
      // 3-5. turn, ownership and legality are checked by the rule engine against server state
      const move = m.move && typeof m.move === 'object' ? { type: m.move.type, source: m.move.source, card: m.move.card } : null;
      const r = engine.applyMove(g, p.pid, move, randInt);
      if (!r.ok) { log({ room: room.code, gameNo: room.gameNo, type: 'MOVE_REJECTED', pid: p.pid, error: r.error }); err(ws, r.error); return send(ws, roomView(room, p.pid)); }
      p.aids.push(aid); if (p.aids.length > 50) p.aids.shift();
      for (const e of r.events) record(room, e);
      afterMove(room);
      broadcast(room);
    },
  };

  function bound(ws) {
    const b = ws.jp, room = b && rooms.get(b.code), p = room && findPlayer(room, b.pid);
    return p && p.ws === ws ? { room, p } : null;
  }

  // Simple per-connection rate limit so a script can't flood the server.
  function allow(ws) {
    const t = now(), r = ws.jpRate || (ws.jpRate = { t, n: 0 });
    if (t - r.t > 1000) { r.t = t; r.n = 0; }
    return ++r.n <= 25;
  }

  function handle(ws, m) {
    const h = Object.prototype.hasOwnProperty.call(H, m.t) && H[m.t];
    if (!h) return;
    if (!allow(ws)) return err(ws, 'RATE_LIMIT');
    try { h(ws, m); } catch (e) { log({ type: 'ERROR', msg: String(e && e.message) }); err(ws, 'SERVER_ERROR'); }
  }

  function disconnect(ws) { unbind(ws); }

  // Drop players who stayed away too long, and empty rooms.
  function sweep() {
    const t = now();
    for (const room of [...rooms.values()]) {
      for (const p of [...room.players]) {
        if (p.connected) continue;
        const grace = room.status === 'playing' ? GAME_GRACE_MS : LOBBY_GRACE_MS;
        if (t - p.lastSeen > grace && rooms.has(room.code)) removePlayer(room, p, 'timeout');
      }
      if (!rooms.has(room.code)) continue;
      if (room.players.some(p => p.connected)) room.emptySince = null;
      else if (room.emptySince == null) room.emptySince = t;
      else if (t - room.emptySince > EMPTY_ROOM_MS) { rooms.delete(room.code); log({ room: room.code, type: 'ROOM_CLOSED' }); }
    }
  }

  return { handle, disconnect, sweep, rooms };
}

module.exports = { createJutpattiServer };
