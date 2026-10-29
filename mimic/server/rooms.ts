// All Mimic rooms, in memory. Creates rooms with unguessable codes, issues and checks session tokens,
// and sweeps away players who stay disconnected and rooms that are empty or too old.
// A server restart forgets everything here: players then get ROOM_NOT_FOUND and start a new room.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/constants';
import type { Clip, JoinedRoom, ProfileInput } from '../shared/types';
import { type Clock, DEFAULT_TIMING, fail, type Player, realClock, type Result, Room, type RoomListener, type Timing } from './game-engine';

export interface ManagerOptions {
  clock?: Clock;
  timing?: Timing;
  /** How long a disconnected player keeps their seat. */
  graceMs?: number;
  /** How long an away host keeps the host role before it moves to someone who is here. */
  hostHandoffMs?: number;
  /** Hard cap on a room's age. */
  maxRoomAgeMs?: number;
  /** A room with no activity for this long is closed. */
  idleMs?: number;
  maxRooms?: number;
  /** Test hook: forces the sequence of room codes tried. */
  codeSource?: () => string;
}

export interface ManagerListener extends RoomListener {
  closed(room: Room, reason: 'expired' | 'empty'): void;
  removed(room: Room, player: Player): void;
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function randomRoomCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return s;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly clock: Clock;
  private readonly opts: Required<Omit<ManagerOptions, 'clock' | 'codeSource' | 'timing'>>;
  private readonly codeSource: () => string;
  private readonly timing: Timing;

  constructor(
    private readonly clips: Clip[],
    private readonly listener: ManagerListener,
    options: ManagerOptions = {},
  ) {
    this.clock = options.clock ?? realClock;
    this.codeSource = options.codeSource ?? randomRoomCode;
    this.timing = options.timing ?? DEFAULT_TIMING;
    this.opts = {
      graceMs: options.graceMs ?? 90_000,
      hostHandoffMs: options.hostHandoffMs ?? 20_000,
      maxRoomAgeMs: options.maxRoomAgeMs ?? 8 * 3600_000,
      idleMs: options.idleMs ?? 45 * 60_000,
      maxRooms: options.maxRooms ?? 2000,
    };
  }

  private newCode(): string | null {
    for (let i = 0; i < 50; i++) {
      const code = this.codeSource();
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  private newPlayer(profile: ProfileInput): { player: Omit<Player, 'connected' | 'disconnectedAt' | 'score' | 'socketId'>; token: string } {
    const token = randomBytes(24).toString('base64url');
    return { player: { id: randomBytes(9).toString('base64url'), nickname: profile.nickname, avatar: profile.avatar, tokenHash: hashToken(token) }, token };
  }

  createRoom(profile: ProfileInput): Result<{ room: Room; joined: JoinedRoom }> {
    if (this.rooms.size >= this.opts.maxRooms) return fail('SERVER_BUSY', 'Too many rooms right now. Try again in a bit.');
    const code = this.newCode();
    if (!code) return fail('SERVER_BUSY', 'Could not make a room code. Try again.');
    const room = new Room(code, this.clips, this.listener, this.clock, this.timing);
    this.rooms.set(code, room);
    const { player, token } = this.newPlayer(profile);
    const added = room.addPlayer(player);
    if (!added.ok) {
      this.rooms.delete(code);
      return added;
    }
    return { ok: true, room, joined: { code, playerId: player.id, token } };
  }

  joinRoom(code: string, profile: ProfileInput): Result<{ room: Room; joined: JoinedRoom }> {
    const room = this.rooms.get(code);
    if (!room || room.isClosed) return fail('ROOM_NOT_FOUND', 'No room with that code. Check the code, or the room may have closed.');
    const { player, token } = this.newPlayer(profile);
    const added = room.addPlayer(player);
    if (!added.ok) return added;
    return { ok: true, room, joined: { code, playerId: player.id, token } };
  }

  /** Finds the player a session token belongs to. Tokens are compared as hashes, in constant time. */
  resume(code: string, token: string): Result<{ room: Room; player: Player }> {
    const room = this.rooms.get(code);
    if (!room || room.isClosed) return fail('ROOM_NOT_FOUND', 'That room no longer exists. The server may have restarted. Start or join a new room.');
    const want = Buffer.from(hashToken(token), 'hex');
    for (const p of room.players.values()) {
      const have = Buffer.from(p.tokenHash, 'hex');
      if (have.length === want.length && timingSafeEqual(have, want)) return { ok: true, room, player: p };
    }
    return fail('SESSION_INVALID', 'Your seat in that room has expired. Join again with the room code.');
  }

  leave(room: Room, playerId: string): void {
    room.removePlayer(playerId);
    if (room.players.size === 0) this.drop(room, 'empty');
  }

  private drop(room: Room, reason: 'expired' | 'empty'): void {
    room.close();
    if (this.rooms.get(room.code) === room) this.rooms.delete(room.code);
    this.listener.closed(room, reason);
  }

  /** Runs every few seconds: removes long-gone players and closes empty, idle or very old rooms. */
  sweep(): void {
    const now = this.clock.now();
    for (const room of [...this.rooms.values()]) {
      if (now - room.createdAt > this.opts.maxRoomAgeMs || now - room.lastActivity > this.opts.idleMs) {
        this.drop(room, 'expired');
        continue;
      }
      for (const p of [...room.players.values()]) {
        if (!p.connected && p.disconnectedAt !== null && now - p.disconnectedAt > this.opts.graceMs) {
          room.removePlayer(p.id);
          this.listener.removed(room, p);
        }
      }
      if (room.players.size === 0) {
        this.drop(room, 'empty');
        continue;
      }
      room.handOffHostIfAway(now, this.opts.hostHandoffMs);
    }
  }
}
