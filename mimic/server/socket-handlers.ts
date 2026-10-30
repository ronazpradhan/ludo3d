// Socket.IO wiring: validates every event, rate-limits it, checks the socket really owns the seat it
// acts for, then hands it to the room. Identity comes only from socket.data, which only the server writes.

import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import { MAX_RECORDING_BYTES } from '../shared/constants';
import type { ClientToServerEvents, ErrorCode, ServerToClientEvents, SocketData } from '../shared/types';
import type { Player, Result, Room } from './game-engine';
import { log } from './log';
import { RateLimiter } from './rate-limit';
import { type ManagerOptions, RoomManager } from './rooms';
import type { Library } from './sounds';
import { firstIssue, GetTakeSchema, JoinSchema, ProfileSchema, ResumeSchema, SettingsSchema } from './validation';

export type MimicServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type MimicSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface HandlerOptions extends ManagerOptions {
  sweepMs?: number;
  limits?: Partial<Record<LimitName, [limit: number, windowMs: number]>>;
}

type LimitName = 'take' | 'fetch' | 'create' | 'createIp' | 'join' | 'joinIp' | 'any';

const channel = (code: string): string => `room:${code}`;

type Reply = (res: { ok: true } | { ok: false; code: ErrorCode; message: string } | Record<string, unknown>) => void;
const noop: Reply = () => undefined;
function safeAck(ack: unknown): Reply {
  return typeof ack === 'function' ? (ack as Reply) : noop;
}
const refuse = (reply: Reply, code: ErrorCode, message: string): void => reply({ ok: false, code, message });

/** A take arrives as binary 16-bit PCM (a Buffer in Node). Anything else, odd-sized or too big is refused. */
function toPcm(payload: unknown): Int16Array | null {
  let bytes: Uint8Array | null = null;
  if (payload instanceof ArrayBuffer) bytes = new Uint8Array(payload);
  else if (ArrayBuffer.isView(payload)) bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength % 2 !== 0 || bytes.byteLength > MAX_RECORDING_BYTES) return null;
  const copy = new Uint8Array(bytes); // own, aligned memory
  return new Int16Array(copy.buffer, 0, copy.byteLength / 2);
}

export function registerMimicHandlers(io: MimicServer, lib: Library, options: HandlerOptions = {}): { manager: RoomManager; stop(): void } {
  type Limit = [limit: number, windowMs: number];
  const defaults: Record<LimitName, Limit> = {
    take: [4, 10_000],
    fetch: [40, 10_000],
    create: [3, 60_000],
    createIp: [12, 60_000],
    join: [10, 60_000],
    joinIp: [40, 60_000],
    any: [40, 10_000],
  };
  const L = { ...defaults, ...options.limits };
  const limiters = {
    take: new RateLimiter(...L.take),
    fetch: new RateLimiter(...L.fetch),
    create: new RateLimiter(...L.create),
    createIp: new RateLimiter(...L.createIp),
    join: new RateLimiter(...L.join),
    joinIp: new RateLimiter(...L.joinIp),
    any: new RateLimiter(...L.any),
  };

  const socketsIn = (code: string): MimicSocket[] => {
    const ids = io.sockets.adapter.rooms.get(channel(code));
    return ids ? [...ids].map(id => io.sockets.sockets.get(id)).filter((s): s is MimicSocket => !!s) : [];
  };
  const unbind = (s: MimicSocket): void => {
    if (s.data.roomCode) void s.leave(channel(s.data.roomCode));
    s.data.roomCode = undefined;
    s.data.playerId = undefined;
  };

  const manager: RoomManager = new RoomManager(
    lib,
    {
      state: room => io.to(channel(room.code)).emit('room_state', room.snapshot()),
      closed: (room, reason) => {
        for (const s of socketsIn(room.code)) {
          s.emit('room_closed', reason);
          unbind(s);
        }
        log('room_closed', { room: room.code, reason });
      },
      removed: (room, _player: Player) => log('player_timed_out', { room: room.code, players: room.players.size }),
    },
    options,
  );

  const sweep = setInterval(() => {
    manager.sweep();
    for (const l of Object.values(limiters)) l.prune();
  }, options.sweepMs ?? 5000);
  sweep.unref();

  /** The room and player this socket is currently allowed to act for, or null. */
  function seat(s: MimicSocket): { room: Room; player: Player } | null {
    const { roomCode, playerId } = s.data;
    if (!roomCode || !playerId) return null;
    const room = manager.rooms.get(roomCode);
    const player = room?.players.get(playerId);
    if (!room || !player || player.socketId !== s.id) return null;
    return { room, player };
  }

  /** Points this socket at a seat. An older socket on the same seat (another tab) is kicked off it. */
  function bind(s: MimicSocket, room: Room, player: Player): void {
    const current = seat(s);
    if (current && (current.room !== room || current.player.id !== player.id)) release(s);
    if (player.socketId && player.socketId !== s.id) {
      const old = io.sockets.sockets.get(player.socketId);
      if (old) {
        old.emit('session_replaced');
        unbind(old);
      }
    }
    void s.join(channel(room.code));
    s.data.roomCode = room.code;
    s.data.playerId = player.id;
    room.setConnected(player.id, s.id);
  }

  /** The socket stops acting for its seat but the seat is kept for the grace period. */
  function release(s: MimicSocket): void {
    const current = seat(s);
    unbind(s);
    if (current) current.room.setConnected(current.player.id, null);
  }

  function parse<T>(schema: z.ZodType<T>, payload: unknown, reply: Reply): T | null {
    const r = schema.safeParse(payload);
    if (!r.success) {
      refuse(reply, 'BAD_INPUT', firstIssue(r.error));
      return null;
    }
    return r.data;
  }

  const send = (reply: Reply, r: Result): void => reply(r.ok ? { ok: true } : r);

  io.on('connection', (socket: MimicSocket) => {
    const ip = socket.data.ip || socket.handshake.address;
    const id = socket.id;

    /** Wraps a handler with the general rate limit and a crash guard. */
    const guarded =
      <A extends unknown[]>(name: string, fn: (reply: Reply, ...args: A) => void) =>
      (...args: unknown[]): void => {
        const last = args[args.length - 1];
        const reply = safeAck(last);
        if (!limiters.any.take(id)) return refuse(reply, 'RATE_LIMITED', 'Slow down a little.');
        try {
          fn(reply, ...(args as A));
        } catch (err) {
          log('handler_error', { event: name, error: err instanceof Error ? err.message : String(err) });
          refuse(reply, 'BAD_INPUT', 'Something went wrong.');
        }
      };

    socket.on(
      'create_room',
      guarded('create_room', (reply, payload: unknown) => {
        if (!limiters.create.take(id) || !limiters.createIp.take(ip)) return refuse(reply, 'RATE_LIMITED', 'You are making rooms too fast. Wait a minute.');
        const profile = parse(ProfileSchema, payload, reply);
        if (!profile) return;
        const r = manager.createRoom(profile);
        if (!r.ok) return reply(r);
        reply({ ok: true, ...r.joined });
        bind(socket, r.room, r.room.players.get(r.joined.playerId)!);
        log('room_created', { room: r.room.code, rooms: manager.rooms.size });
      }),
    );

    socket.on(
      'join_room',
      guarded('join_room', (reply, payload: unknown) => {
        if (!limiters.join.take(id) || !limiters.joinIp.take(ip)) return refuse(reply, 'RATE_LIMITED', 'Too many tries. Wait a minute.');
        const p = parse(JoinSchema, payload, reply);
        if (!p) return;
        const r = manager.joinRoom(p.code, { nickname: p.nickname, avatar: p.avatar });
        if (!r.ok) return reply(r);
        reply({ ok: true, ...r.joined });
        bind(socket, r.room, r.room.players.get(r.joined.playerId)!);
        log('player_joined', { room: r.room.code, players: r.room.players.size });
      }),
    );

    socket.on(
      'resume_session',
      guarded('resume_session', (reply, payload: unknown) => {
        if (!limiters.join.take(id) || !limiters.joinIp.take(ip)) return refuse(reply, 'RATE_LIMITED', 'Too many tries. Wait a minute.');
        const p = parse(ResumeSchema, payload, reply);
        if (!p) return;
        const r = manager.resume(p.code, p.token);
        if (!r.ok) return reply(r);
        reply({ ok: true, code: r.room.code, playerId: r.player.id, token: p.token });
        bind(socket, r.room, r.player);
      }),
    );

    socket.on(
      'leave_room',
      guarded('leave_room', (reply, payload: unknown) => {
        const s = seat(socket);
        const end = typeof payload === 'object' && payload !== null && (payload as { end?: unknown }).end === true;
        if (s && end) {
          if (!manager.end(s.room, s.player.id)) return refuse(reply, 'NOT_HOST', 'Only the host can end the room.');
          log('room_ended', { room: s.room.code });
          return reply({ ok: true });
        }
        unbind(socket);
        if (s) {
          manager.leave(s.room, s.player.id);
          log('player_left', { room: s.room.code, players: s.room.players.size });
        }
        reply({ ok: true });
      }),
    );

    socket.on(
      'update_settings',
      guarded('update_settings', (reply, payload: unknown) => {
        const s = seat(socket);
        if (!s) return refuse(reply, 'NOT_IN_ROOM', 'You are not in a room.');
        const patch = parse(SettingsSchema, payload, reply);
        if (!patch) return;
        send(reply, s.room.updateSettings(s.player.id, patch));
      }),
    );

    socket.on(
      'start_game',
      guarded('start_game', reply => {
        const s = seat(socket);
        if (!s) return refuse(reply, 'NOT_IN_ROOM', 'You are not in a room.');
        const r = s.room.start(s.player.id);
        send(reply, r);
        if (r.ok) log('match_started', { room: s.room.code, players: s.room.connectedCount, match: s.room.matchNumber });
      }),
    );

    socket.on(
      'submit_take',
      guarded('submit_take', (reply, payload: unknown, meta: unknown) => {
        if (!limiters.take.take(id)) return refuse(reply, 'RATE_LIMITED', 'Too many recordings. Wait a moment.');
        const s = seat(socket);
        if (!s) return refuse(reply, 'NOT_IN_ROOM', 'You are not in a room.');
        const pcm = toPcm(payload);
        if (!pcm) return refuse(reply, 'BAD_INPUT', 'That recording could not be read.');
        const w = typeof meta === 'object' && meta !== null ? (meta as { words?: unknown }).words : null;
        const words = typeof w === 'number' && Number.isFinite(w) ? Math.max(0, Math.min(1, w)) : null;
        const r = s.room.submitTake(s.player.id, pcm, words);
        reply(r.ok ? { ok: true, ...r.feedback } : r);
      }),
    );

    socket.on(
      'get_take',
      guarded('get_take', (reply, payload: unknown) => {
        if (!limiters.fetch.take(id)) return refuse(reply, 'RATE_LIMITED', 'Slow down a little.');
        const s = seat(socket);
        if (!s) return refuse(reply, 'NOT_IN_ROOM', 'You are not in a room.');
        const p = parse(GetTakeSchema, payload, reply);
        if (!p) return;
        const pcm = s.room.takeAudio(s.player.id, p.playerId);
        if (!pcm) return refuse(reply, 'WRONG_PHASE', 'That recording is not available.');
        reply({ ok: true, pcm: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) });
      }),
    );

    socket.on(
      'request_rematch',
      guarded('request_rematch', reply => {
        const s = seat(socket);
        if (!s) return refuse(reply, 'NOT_IN_ROOM', 'You are not in a room.');
        const r = s.room.rematch(s.player.id);
        send(reply, r);
        if (r.ok) log('match_started', { room: s.room.code, players: s.room.connectedCount, match: s.room.matchNumber });
      }),
    );

    socket.on(
      'back_to_lobby',
      guarded('back_to_lobby', reply => {
        const s = seat(socket);
        if (!s) return refuse(reply, 'NOT_IN_ROOM', 'You are not in a room.');
        send(reply, s.room.backToLobby(s.player.id));
      }),
    );

    socket.on(
      'list_rooms',
      guarded('list_rooms', reply => reply({ ok: true, rooms: manager.openRooms() })),
    );

    socket.on('clip_ready', (payload: unknown) => {
      const round = (payload as { round?: unknown } | null)?.round;
      const s = seat(socket);
      if (s && typeof round === 'number') s.room.clipReady(s.player.id, round);
    });

    // Not rate-limited through `guarded`: clients call it on connect and every so often to line up clocks.
    socket.on('sync_clock', (ack: unknown) => {
      if (typeof ack === 'function') (ack as (n: number) => void)(manager.clock.now());
    });

    socket.on('disconnect', () => {
      release(socket);
      for (const l of Object.values(limiters)) if (l !== limiters.createIp && l !== limiters.joinIp) l.forget(id);
    });
  });

  return {
    manager,
    stop: () => {
      clearInterval(sweep);
      for (const room of manager.rooms.values()) room.close();
    },
  };
}

