import { describe, expect, it } from 'vitest';
import { ROOM_CODE_PATTERN } from '../shared/constants';
import { RateLimiter } from '../server/rate-limit';
import { type ManagerListener, randomRoomCode, RoomManager } from '../server/rooms';
import { FakeClock, library, Recorder } from './helpers';

function manager(opts: ConstructorParameters<typeof RoomManager>[2] = {}) {
  const clock = new FakeClock();
  const rec = new Recorder();
  const closed: string[] = [];
  const listener: ManagerListener = { state: rec.state, closed: r => void closed.push(r.code), removed: () => undefined };
  const m = new RoomManager(library, listener, { clock, graceMs: 60_000, hostHandoffMs: 20_000, ...opts });
  return { m, clock, rec, closed };
}
const fox = { nickname: 'Fox', avatar: 'fox' as const };

describe('room codes', () => {
  it('are six characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const c = randomRoomCode();
      expect(c).toMatch(ROOM_CODE_PATTERN);
      expect(c).not.toMatch(/[O0I1L]/);
    }
  });
  it('never reuse a code that is in use', () => {
    const codes = ['AAAAAA', 'AAAAAA', 'AAAAAA', 'BBBBBB'];
    const { m } = manager({ codeSource: () => codes.shift() ?? 'CCCCCC' });
    const a = m.createRoom(fox);
    const b = m.createRoom(fox);
    expect(a.ok && a.room.code).toBe('AAAAAA');
    expect(b.ok && b.room.code).toBe('BBBBBB');
  });
  it('gives up cleanly if no free code can be found', () => {
    const { m } = manager({ codeSource: () => 'AAAAAA' });
    m.createRoom(fox);
    expect(m.createRoom(fox)).toMatchObject({ ok: false, code: 'SERVER_BUSY' });
  });
});

describe('joining and sessions', () => {
  it('joins by code and rejects unknown codes', () => {
    const { m } = manager();
    const a = m.createRoom(fox);
    if (!a.ok) throw new Error();
    expect(m.joinRoom(a.room.code, { nickname: 'Owl', avatar: 'owl' })).toMatchObject({ ok: true });
    expect(m.joinRoom('ZZZZZZ', { nickname: 'Owl', avatar: 'owl' })).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });
  it('issues server-side ids and unguessable tokens, stored only as hashes', () => {
    const { m } = manager();
    const a = m.createRoom(fox);
    if (!a.ok) throw new Error();
    const p = a.room.players.get(a.joined.playerId)!;
    expect(a.joined.token.length).toBeGreaterThanOrEqual(32);
    expect(p.tokenHash).not.toContain(a.joined.token);
    expect(JSON.stringify(a.room.snapshot())).not.toContain(a.joined.token);
    expect(JSON.stringify(a.room.snapshot())).not.toContain(p.tokenHash);
  });
  it('resumes with the right token only', () => {
    const { m } = manager();
    const a = m.createRoom(fox);
    if (!a.ok) throw new Error();
    expect(m.resume(a.room.code, a.joined.token)).toMatchObject({ ok: true, player: { id: a.joined.playerId } });
    expect(m.resume(a.room.code, 'x'.repeat(32))).toMatchObject({ ok: false, code: 'SESSION_INVALID' });
    expect(m.resume('ZZZZZZ', a.joined.token)).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });
});

describe('cleanup', () => {
  it('removes a player who stays away past the grace period, and the room once empty', () => {
    const { m, clock, closed } = manager();
    const a = m.createRoom(fox);
    if (!a.ok) throw new Error();
    const b = m.joinRoom(a.room.code, { nickname: 'Owl', avatar: 'owl' });
    if (!b.ok) throw new Error();
    a.room.setConnected(a.joined.playerId, 's1');
    a.room.setConnected(b.joined.playerId, 's2');
    a.room.setConnected(b.joined.playerId, null);
    clock.advance(59_000);
    m.sweep();
    expect(a.room.players.has(b.joined.playerId)).toBe(true);
    clock.advance(2000);
    m.sweep();
    expect(a.room.players.has(b.joined.playerId)).toBe(false);
    a.room.setConnected(a.joined.playerId, null);
    clock.advance(61_000);
    m.sweep();
    expect(m.rooms.size).toBe(0);
    expect(closed).toEqual([a.room.code]);
  });
  it('deletes a room immediately when the last player leaves', () => {
    const { m } = manager();
    const a = m.createRoom(fox);
    if (!a.ok) throw new Error();
    m.leave(a.room, a.joined.playerId);
    expect(m.rooms.size).toBe(0);
    expect(m.joinRoom(a.room.code, fox)).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });
  it('closes rooms that are too old or idle', () => {
    const { m, clock, closed } = manager({ maxRoomAgeMs: 3600_000, idleMs: 600_000 });
    const a = m.createRoom(fox);
    if (!a.ok) throw new Error();
    a.room.setConnected(a.joined.playerId, 's1');
    clock.advance(600_001);
    m.sweep();
    expect(closed).toEqual([a.room.code]);
    expect(a.room.isClosed).toBe(true);
  });
  it('hands the host role on when the host is away for a while', () => {
    const { m, clock } = manager();
    const a = m.createRoom(fox);
    if (!a.ok) throw new Error();
    const b = m.joinRoom(a.room.code, { nickname: 'Owl', avatar: 'owl' });
    if (!b.ok) throw new Error();
    a.room.setConnected(a.joined.playerId, 's1');
    a.room.setConnected(b.joined.playerId, 's2');
    a.room.setConnected(a.joined.playerId, null);
    clock.advance(10_000);
    m.sweep();
    expect(a.room.hostId).toBe(a.joined.playerId);
    clock.advance(11_000);
    m.sweep();
    expect(a.room.hostId).toBe(b.joined.playerId);
  });
});

describe('public rooms', () => {
  it('lists only public rooms, joinable ones first, and never private ones', () => {
    const { m } = manager();
    const pub = m.createRoom(fox);
    const priv = m.createRoom({ nickname: 'Owl', avatar: 'owl' });
    if (!pub.ok || !priv.ok) throw new Error();
    pub.room.setConnected(pub.joined.playerId, 's1');
    priv.room.setConnected(priv.joined.playerId, 's2');
    expect(m.openRooms()).toEqual([]);
    expect(pub.room.updateSettings(pub.joined.playerId, { visibility: 'public' })).toEqual({ ok: true });
    expect(m.openRooms()).toEqual([{ code: pub.room.code, host: { nickname: 'Fox', avatar: 'fox' }, players: 1, maxPlayers: 10, playing: false }]);
    // A public room whose players have all dropped isn't advertised.
    pub.room.setConnected(pub.joined.playerId, null);
    expect(m.openRooms()).toEqual([]);
  });
});

describe('rate limiter', () => {
  it('allows `limit` hits per window per key', () => {
    const r = new RateLimiter(3, 1000);
    expect([r.take('a', 0), r.take('a', 1), r.take('a', 2), r.take('a', 3)]).toEqual([true, true, true, false]);
    expect(r.take('b', 3)).toBe(true);
    expect(r.take('a', 1001)).toBe(true);
  });
});
