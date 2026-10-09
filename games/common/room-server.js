// Shared, server-authoritative room system for the card games (Jutpatti, Flash).
// Each game plugs in an "adapter" with its rules; this file handles everything else:
// room codes, lobby, ready/start/rematch, identity + reconnect, open-rooms list,
// duplicate/stale/replay protection, rate limiting, timeouts and the public event log.
//
// Identity: on create/join the server issues a public player id (pid) and a secret token.
// The socket is then bound to that player; every action is taken AS the bound player, so a
// client cannot act for someone else by sending another id. The token lets a refreshed or
// reconnected browser take its seat back.
const crypto = require('crypto');
const cards = require('./cards');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', CODE_RE = /^[A-Z0-9]{5}$/, TOKEN_RE = /^[a-f0-9]{48}$/;
const LOBBY_GRACE_MS = 45e3;     // a disconnected player is removed from a lobby after this
const GAME_GRACE_MS = 120e3;     // ...and from a running game after this
const EMPTY_ROOM_MS = 10 * 60e3; // a room with nobody connected is deleted after this
const MAX_ROOMS = 2000, HISTORY = 40;

const cleanName = x => String(x ?? '').replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, 14);

// adapter: { gameType, minPlayers, maxPlayers, init(room, msg), onJoin?(room), roomInfo?(room), playerInfo?(room, p),
//   setOpts?(room, msg) -> errorCode|null, canStart?(room) -> errorCode|null, start(room, ctx),
//   parseMove(raw) -> move|null, act(room, pid, move, ctx) -> {ok, error, extra, events},
//   leave?(room, pid, ctx) -> events, view(room, pid), afterChange?(room, ctx), tick?(room, ctx) }
function createRoomServer({ prefix, adapter: A, send, now = Date.now, log, randInt = cards.secureInt }) {
  const rooms = new Map(), BK = 'room_' + A.gameType, RK = 'rate_' + A.gameType;   // per-game socket binding keys
  const T = s => prefix + s;

  // ---------- helpers ----------
  const err = (ws, code, extra) => send(ws, { t: T('err'), code, ...extra });
  const findPlayer = (room, pid) => room.players.find(p => p.pid === pid);

  function newCode() {
    for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]; if (!rooms.has(c)) return c; }
  }

  // Public event log: written to the server log and kept (last HISTORY) for players to see.
  // Adapters only pass public data here (never hidden cards).
  function record(room, e) {
    const entry = { ...e, id: room.seq = (room.seq || 0) + 1, at: now() };   // id: lets clients animate each event once
    room.history.push(entry); if (room.history.length > HISTORY) room.history.shift();
    log({ room: room.code, gameNo: room.gameNo, ...e });
  }

  function roomView(room, pid) {
    return {
      t: T('state'), you: pid,
      room: {
        code: room.code, gameType: A.gameType, hostPid: room.hostPid, status: room.status,
        gameNo: room.gameNo, listed: room.listed, minPlayers: A.minPlayers, maxPlayers: A.maxPlayers,
        ...(A.roomInfo ? A.roomInfo(room) : {}),
        players: room.players.map(p => ({ pid: p.pid, name: p.name, ready: p.ready, connected: p.connected, score: room.scores[p.pid] || 0, ...(A.playerInfo ? A.playerInfo(room, p) : {}) })),
        names: room.names, history: room.history,
      },
      game: room.game ? A.view(room, pid) : null,
    };
  }

  // Every player gets their own sanitized view; nobody ever receives hidden cards that aren't theirs.
  function broadcast(room) { for (const p of room.players) if (p.ws) send(p.ws, roomView(room, p.pid)); listChanged(); }

  // Open-rooms list for the home screen: rooms waiting for players, unless the host hid theirs.
  const watchers = new Set();
  let listTimer = null;
  function openRooms() {
    const out = [];
    for (const r of rooms.values()) {
      if (r.status !== 'lobby' || !r.listed || r.players.length >= A.maxPlayers || !r.players.some(p => p.connected)) continue;
      out.push({ code: r.code, host: r.names[r.hostPid] || 'Player', players: r.players.length, max: A.maxPlayers });
      if (out.length >= 20) break;
    }
    return out;
  }
  function listChanged() {
    if (listTimer || !watchers.size) return;
    listTimer = setTimeout(() => { listTimer = null; const msg = { t: T('rooms'), rooms: openRooms() }; for (const w of watchers) send(w, msg); }, 100);
    if (listTimer.unref) listTimer.unref();
  }

  function bind(ws, room, p) {
    if (p.ws && p.ws !== ws) { send(p.ws, { t: T('kicked'), reason: 'opened elsewhere' }); p.ws[BK] = null; }
    if (ws[BK] && (ws[BK].code !== room.code || ws[BK].pid !== p.pid)) unbind(ws);
    p.ws = ws; p.connected = true; p.lastSeen = now(); ws[BK] = { code: room.code, pid: p.pid };
  }
  function unbind(ws) {
    const b = ws[BK]; ws[BK] = null; if (!b) return;
    const room = rooms.get(b.code), p = room && findPlayer(room, b.pid);
    if (p && p.ws === ws) { p.ws = null; p.connected = false; p.lastSeen = now(); broadcast(room); }
  }

  function addPlayer(room, name) {
    const p = { pid: crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(24).toString('hex'),
      name, ready: false, connected: false, ws: null, lastSeen: now(), aids: [] };
    room.players.push(p); room.names[p.pid] = name;
    if (A.onJoin) A.onJoin(room, p);
    return p;
  }

  const ctx = { randInt, now, record, broadcast: r => broadcast(r), startGame: r => startGame(r), log };

  function removePlayer(room, p, why) {
    room.players = room.players.filter(x => x !== p);
    if (p.ws) { p.ws[BK] = null; p.ws = null; }
    record(room, { type: 'PLAYER_LEFT', pid: p.pid, why });
    if (room.game && room.status === 'playing' && A.leave) {
      for (const e of A.leave(room, p.pid, ctx)) record(room, e);
      if (A.afterChange) A.afterChange(room, ctx);
    }
    if (!room.players.length) { rooms.delete(room.code); log({ room: room.code, type: 'ROOM_CLOSED' }); listChanged(); return; }
    if (room.hostPid === p.pid) room.hostPid = room.players[0].pid;   // host role only controls start/options
    broadcast(room);
  }

  // Starts a game. The adapter sees the room's previous status, so it can tell a new match from the next deal.
  function startGame(room) {
    room.gameNo++;
    A.start(room, ctx);
    room.status = 'playing';
    for (const p of room.players) { p.ready = false; p.aids = []; }
    broadcast(room);
  }

  // ---------- message handlers ----------
  const H = {
    create(ws, m) {
      const name = cleanName(m.name); if (!name) return err(ws, 'NAME_REQUIRED');
      if (rooms.size >= MAX_ROOMS) return err(ws, 'SERVER_FULL');
      const room = { code: newCode(), gameType: A.gameType, players: [], names: {}, hostPid: null, status: 'lobby',
        game: null, gameNo: 0, scores: {}, history: [], emptySince: null,
        listed: m.listed !== false };   // shown in the open-rooms list unless the host hides it
      A.init(room, m);
      rooms.set(room.code, room);
      const p = addPlayer(room, name); room.hostPid = p.pid; bind(ws, room, p); watchers.delete(ws);
      record(room, { type: 'ROOM_CREATED', pid: p.pid });
      send(ws, { t: T('joined'), code: room.code, pid: p.pid, token: p.token });
      broadcast(room);
    },
    join(ws, m) {
      const name = cleanName(m.name); if (!name) return err(ws, 'NAME_REQUIRED');
      const code = String(m.code || '').toUpperCase(), room = CODE_RE.test(code) && rooms.get(code);
      if (!room) return err(ws, 'ROOM_NOT_FOUND');
      if (room.status === 'playing') return err(ws, 'IN_PROGRESS');
      if (room.players.length >= A.maxPlayers) return err(ws, 'ROOM_FULL');
      const p = addPlayer(room, name); bind(ws, room, p); watchers.delete(ws);
      record(room, { type: 'PLAYER_JOINED', pid: p.pid });
      send(ws, { t: T('joined'), code: room.code, pid: p.pid, token: p.token });
      broadcast(room);
    },
    resume(ws, m) {
      const room = rooms.get(String(m.code || '').toUpperCase());
      const tok = String(m.token || ''), p = room && TOKEN_RE.test(tok) && room.players.find(x => x.token.length === tok.length && crypto.timingSafeEqual(Buffer.from(x.token), Buffer.from(tok)));
      if (!p) return err(ws, 'SESSION_EXPIRED');
      bind(ws, room, p);
      send(ws, { t: T('joined'), code: room.code, pid: p.pid, token: p.token, resumed: true });
      broadcast(room);
    },
    watch(ws, m) {   // the home screen asks for the open-rooms list (and live updates)
      if (m.on === false) return void watchers.delete(ws);
      watchers.add(ws); send(ws, { t: T('rooms'), rooms: openRooms() });
    },
    sync(ws) { const b = bound(ws); if (b) send(ws, roomView(b.room, b.p.pid)); },
    leave(ws) { const b = bound(ws); if (b) { removePlayer(b.room, b.p, 'left'); send(ws, { t: T('left') }); } },
    ready(ws, m) {
      const b = bound(ws); if (!b) return err(ws, 'NOT_IN_ROOM');
      const { room, p } = b;
      if (room.status === 'playing') return err(ws, 'IN_PROGRESS');
      p.ready = !!m.ready; broadcast(room);
      // Rematch: once everyone at the table asks for it, the next game starts by itself.
      if (room.status === 'over' && room.players.length >= A.minPlayers && room.players.every(x => x.ready)) startGame(room);
    },
    opts(ws, m) {
      const b = bound(ws); if (!b) return err(ws, 'NOT_IN_ROOM');
      if (b.room.hostPid !== b.p.pid) return err(ws, 'NOT_HOST');
      if (b.room.status === 'playing') return err(ws, 'IN_PROGRESS');
      if (typeof m.listed === 'boolean') { b.room.listed = m.listed; return broadcast(b.room); }
      const e = A.setOpts ? A.setOpts(b.room, m) : 'BAD_OPTION';
      if (e) return err(ws, e);
      broadcast(b.room);
    },
    start(ws) {
      const b = bound(ws); if (!b) return err(ws, 'NOT_IN_ROOM');
      const { room, p } = b;
      if (room.hostPid !== p.pid) return err(ws, 'NOT_HOST');
      if (room.status === 'playing') return err(ws, 'IN_PROGRESS');
      if (room.players.length < A.minPlayers) return err(ws, 'NOT_ENOUGH_PLAYERS');
      if (!room.players.every(x => x.ready || x === p)) return err(ws, 'NOT_READY');
      if (!room.players.every(x => x.connected)) return err(ws, 'PLAYER_OFFLINE');
      const e = A.canStart && A.canStart(room); if (e) return err(ws, e);
      startGame(room);
    },
    act(ws, m) {
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
      // 3-5. turn, ownership, money and legality are checked by the game's rule engine against server state
      const move = m.move && typeof m.move === 'object' ? A.parseMove(m.move) : null;
      const r = A.act(room, p.pid, move, ctx);
      if (!r.ok) { log({ room: room.code, gameNo: room.gameNo, type: 'MOVE_REJECTED', pid: p.pid, error: r.error }); err(ws, r.error, r.extra); return send(ws, roomView(room, p.pid)); }
      p.aids.push(aid); if (p.aids.length > 50) p.aids.shift();
      for (const e of r.events) record(room, e);
      if (A.afterChange) A.afterChange(room, ctx);
      broadcast(room);
    },
  };

  function bound(ws) {
    const b = ws[BK], room = b && rooms.get(b.code), p = room && findPlayer(room, b.pid);
    return p && p.ws === ws ? { room, p } : null;
  }

  // Simple per-connection rate limit so a script can't flood the server.
  function allow(ws) {
    const t = now(), r = ws[RK] || (ws[RK] = { t, n: 0 });
    if (t - r.t > 1000) { r.t = t; r.n = 0; }
    return ++r.n <= 25;
  }

  function handle(ws, m) {
    const name = typeof m.t === 'string' && m.t.startsWith(prefix) ? m.t.slice(prefix.length) : '';
    const h = Object.prototype.hasOwnProperty.call(H, name) && H[name];
    if (!h) return;
    if (!allow(ws)) return err(ws, 'RATE_LIMIT');
    try { h(ws, m); } catch (e) { log({ type: 'ERROR', msg: String(e && e.message) }); err(ws, 'SERVER_ERROR'); }
  }

  function disconnect(ws) { watchers.delete(ws); unbind(ws); }

  // Drop players who stayed away too long, empty rooms, and let the game run its timers (turn clocks etc.).
  function sweep() {
    const t = now();
    for (const room of [...rooms.values()]) {
      for (const p of [...room.players]) {
        if (p.connected) continue;
        const grace = room.status === 'playing' ? GAME_GRACE_MS : LOBBY_GRACE_MS;
        if (t - p.lastSeen > grace && rooms.has(room.code)) removePlayer(room, p, 'timeout');
      }
      if (!rooms.has(room.code)) continue;
      if (A.tick) { try { if (A.tick(room, ctx)) broadcast(room); } catch (e) { log({ type: 'ERROR', msg: String(e && e.message) }); } }
      if (room.players.some(p => p.connected)) room.emptySince = null;
      else if (room.emptySince == null) room.emptySince = t;
      else if (t - room.emptySince > EMPTY_ROOM_MS) { rooms.delete(room.code); log({ room: room.code, type: 'ROOM_CLOSED' }); listChanged(); }
    }
  }

  return { handle, disconnect, sweep, rooms };
}

module.exports = { createRoomServer, cleanName };
