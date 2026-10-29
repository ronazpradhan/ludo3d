// End to end over real Socket.IO connections: an HTTP server with Mimic attached and independent clients.
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_RECORDING_BYTES, POINTS, SOCKET_PATH } from '../shared/constants';
import type { ClientToServerEvents, JoinedRoom, RoomSnapshot, ServerToClientEvents } from '../shared/types';
import { attachMimic, type MimicHandle } from '../server/index';
import { clips, imitate, library, pcmOf, silence, specOf } from './helpers';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { latest?: RoomSnapshot; inbox: string[] };
type AnyRes = { ok: boolean; code?: string; message?: string; [k: string]: unknown };

let server: http.Server;
let mimic: MimicHandle;
let url: string;
const clients: Client[] = [];
const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimic-client-'));

beforeAll(async () => {
  fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>Mimic test</title>');
  server = http.createServer((req, res) => {
    if (!mimic.handle(req, res)) res.writeHead(404).end();
  });
  mimic = attachMimic(server, {
    clientDir,
    library,
    timing: { listenMs: 100, recordMs: 2500, resultsMs: 200 },
    limits: { create: [3, 60_000], createIp: [500, 60_000], join: [50, 60_000], joinIp: [500, 60_000], take: [30, 10_000] },
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  while (clients.length) clients.pop()!.disconnect();
});

afterAll(async () => {
  await mimic.close();
  await new Promise(r => server.close(r));
  fs.rmSync(clientDir, { recursive: true, force: true });
});

/** A connected client that remembers every event it receives and its latest snapshot. */
function client(extraHeaders?: Record<string, string>): Promise<Client> {
  const c = connect(url, { path: SOCKET_PATH, transports: ['websocket'], forceNew: true, reconnection: false, ...(extraHeaders ? { extraHeaders } : {}) }) as Client;
  c.inbox = [];
  c.onAny((event: string, ...args: unknown[]) => c.inbox.push(`${event} ${JSON.stringify(args)}`));
  c.on('room_state', s => (c.latest = s));
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once('connect', () => resolve(c));
    c.once('connect_error', reject);
  });
}

function call(c: Client, event: string, ...args: unknown[]): Promise<AnyRes> {
  return new Promise(resolve => (c.emit as (e: string, ...a: unknown[]) => void)(event, ...args, resolve));
}

/** Resolves with the next room_state matching `pred` (or the latest one already received). */
function stateWhere(c: Client, pred: (s: RoomSnapshot) => boolean, ms = 5000): Promise<RoomSnapshot> {
  if (c.latest && pred(c.latest)) return Promise.resolve(c.latest);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      c.off('room_state', on);
      reject(new Error('timed out waiting for room state'));
    }, ms);
    const on = (s: RoomSnapshot) => {
      if (!pred(s)) return;
      clearTimeout(t);
      c.off('room_state', on);
      resolve(s);
    };
    c.on('room_state', on);
  });
}

async function setupRoom(n: number, settings: Record<string, unknown> = { rounds: 5 }) {
  const players = await Promise.all(Array.from({ length: n }, () => client()));
  const host = players[0]!;
  const created = (await call(host, 'create_room', { nickname: 'Player1', avatar: 'fox' })) as AnyRes & JoinedRoom;
  expect(created.ok).toBe(true);
  const joined: (AnyRes & JoinedRoom)[] = [created];
  for (let i = 1; i < n; i++) {
    const r = (await call(players[i]!, 'join_room', { nickname: `Player${i + 1}`, avatar: 'owl', code: created.code.toLowerCase() })) as AnyRes & JoinedRoom;
    expect(r.ok).toBe(true);
    joined.push(r);
  }
  await stateWhere(host, s => s.players.length === n && s.players.every(p => p.connected));
  if (Object.keys(settings).length) expect((await call(host, 'update_settings', settings)).ok).toBe(true);
  return { players, joined, code: created.code, idOf: (i: number) => joined[i]!.playerId };
}

/** A good copy of the round's clip, as the bytes a browser would send. */
function goodTake(s: RoomSnapshot): Buffer {
  const clip = clips.find(c => c.id === s.round!.clip.id)!;
  const pcm = pcmOf(imitate(specOf(clip.id)));
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}
const bytes = (pcm: Int16Array): Buffer => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);

describe('HTTP', () => {
  it('serves /health, the app, and an SPA fallback that leaves missing files as 404', async () => {
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });
    expect((await fetch(`${url}/mimic/`)).status).toBe(200);
    expect(await (await fetch(`${url}/mimic/r/ABCDEF`)).text()).toContain('Mimic test');
    expect((await fetch(`${url}/mimic/assets/missing.js`)).status).toBe(404);
    const redirect = await fetch(`${url}/mimic`, { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/mimic/');
  });
});

describe('lobby over sockets', () => {
  it('enforces host-only start and the two-player minimum', async () => {
    const solo = await setupRoom(1);
    expect(await call(solo.players[0]!, 'start_game')).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
    const { players } = await setupRoom(2);
    expect(await call(players[1]!, 'start_game')).toMatchObject({ ok: false, code: 'NOT_HOST' });
  });

  it('caps a room at ten players', async () => {
    const { code } = await setupRoom(10, {});
    const late = await client();
    expect(await call(late, 'join_room', { nickname: 'Late', avatar: 'bee', code })).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it('rejects duplicate nicknames and unknown rooms', async () => {
    const { code } = await setupRoom(1, {});
    const p = await client();
    expect(await call(p, 'join_room', { nickname: 'PLAYER1', avatar: 'bee', code })).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
    expect(await call(p, 'join_room', { nickname: 'Zed', avatar: 'bee', code: 'ZZZZZZ' })).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });

  it('rejects malformed payloads', async () => {
    const bad = [
      ['create_room', { nickname: 'Bob', avatar: 'unicorn' }],
      ['create_room', { nickname: '', avatar: 'fox' }],
      ['create_room', { nickname: 'x'.repeat(40), avatar: 'fox' }],
      ['create_room', { nickname: 'Bob', avatar: 'fox', score: 9999 }],
      ['create_room', 'not an object'],
      ['join_room', { nickname: 'Bob', avatar: 'fox', code: 'O0I1L0' }],
      ['resume_session', { code: 'ABCDEF', token: '../../etc' }],
    ] as const;
    // A fresh socket each time, so the per-socket create limit doesn't answer first.
    for (const [event, payload] of bad) expect(await call(await client(), event, payload)).toMatchObject({ ok: false, code: 'BAD_INPUT' });

    const { players } = await setupRoom(2, {});
    const host = players[0]!;
    for (const s of [{ rounds: 3 }, { rounds: 7 }, { recordSeconds: 25 }, { categories: ['nope'] }, { difficulty: 'impossible' }, { hostId: 'me' }])
      expect(await call(host, 'update_settings', s)).toMatchObject({ ok: false, code: 'BAD_INPUT' });
  });

  it('rate-limits room creation', async () => {
    const p = await client();
    const results = [];
    for (let i = 0; i < 4; i++) {
      const r = await call(p, 'create_room', { nickname: `Spam${i}`, avatar: 'fox' });
      results.push(r.ok ? 'ok' : r.code);
      if (r.ok) await call(p, 'leave_room');
    }
    expect(results).toEqual(['ok', 'ok', 'ok', 'RATE_LIMITED']);
  });

  it('hands the host role on when the host leaves, and deletes the room when everyone has left', async () => {
    const { players, code, idOf } = await setupRoom(3, {});
    await call(players[0]!, 'leave_room');
    const s = await stateWhere(players[1]!, x => x.players.length === 2);
    expect(s.hostId).toBe(idOf(1));
    await call(players[1]!, 'leave_room');
    await call(players[2]!, 'leave_room');
    expect(mimic.manager.rooms.has(code)).toBe(false);
  });

  it('refuses sockets from foreign origins', async () => {
    await expect(client({ origin: 'https://evil.example' })).rejects.toBeTruthy();
    clients.pop();
  });
});

describe('public rooms', () => {
  it('shows public rooms to anyone, and anyone can join one by its listing', async () => {
    const { players, code } = await setupRoom(1, {});
    const visitor = await client();
    const before = (await call(visitor, 'list_rooms')) as AnyRes & { rooms: { code: string }[] };
    expect(before.rooms.some(r => r.code === code)).toBe(false);
    expect(await call(players[0]!, 'update_settings', { visibility: 'public' })).toEqual({ ok: true });
    const after = (await call(visitor, 'list_rooms')) as AnyRes & { rooms: { code: string; host: { nickname: string } }[] };
    expect(after.rooms.find(r => r.code === code)).toMatchObject({ host: { nickname: 'Player1' } });
    expect(await call(visitor, 'join_room', { nickname: 'Visitor', avatar: 'bee', code })).toMatchObject({ ok: true });
  });
});

describe('a full match with independent clients', () => {
  it('scores takes on the server, shares them only in the results, and finishes', async () => {
    const { players, idOf } = await setupRoom(3);
    expect(await call(players[0]!, 'start_game')).toEqual({ ok: true });

    for (let round = 1; round <= 5; round++) {
      const listen = await stateWhere(players[0]!, s => s.phase === 'listen' && s.round?.number === round);
      // No take before recording opens, and the clip's name isn't public yet.
      expect(await call(players[0]!, 'submit_take', goodTake(listen))).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
      const clipName = clips.find(c => c.id === listen.round!.clip.id)!.name;
      expect(players[1]!.inbox.filter(l => l.includes(`"number":${round},`)).join('').includes(`"name":"${clipName}"`)).toBe(false);

      const rec = await stateWhere(players[0]!, s => s.phase === 'record' && s.round?.number === round);
      const good = await call(players[0]!, 'submit_take', goodTake(rec));
      expect(good).toMatchObject({ ok: true });
      expect(good.score as number).toBeGreaterThanOrEqual(55);
      expect(await call(players[0]!, 'submit_take', goodTake(rec))).toMatchObject({ ok: false, code: 'ALREADY_SUBMITTED' });
      expect(await call(players[1]!, 'submit_take', bytes(silence(1.5)))).toMatchObject({ ok: true, score: 0, verdict: 'silent' });
      expect(await call(players[2]!, 'get_take', { playerId: idOf(0) })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
      await call(players[2]!, 'submit_take', bytes(silence(1)));

      // Everyone sent a take: the round ends early with the best take getting the bonus.
      const res = await stateWhere(players[2]!, s => s.phase === 'results' && s.lastResult?.number === round);
      expect(res.lastResult!.clip.name).toBe(clipName);
      expect(res.lastResult!.takes[0]).toMatchObject({ playerId: idOf(0), best: true, points: (good.score as number) + POINTS.bestTakeBonus });
      // Takes can be played back now, as the same bytes that were sent.
      const fetched = await call(players[1]!, 'get_take', { playerId: idOf(0) });
      expect(fetched.ok).toBe(true);
      expect(Buffer.from(fetched.pcm as ArrayBuffer).equals(goodTake(rec))).toBe(true);
    }
    const done = await stateWhere(players[0]!, s => s.phase === 'finished');
    expect(done.players.find(p => p.id === idOf(0))!.score).toBeGreaterThan(5 * (55 + POINTS.bestTakeBonus));
    // Recordings never travel in public room updates.
    for (const p of players) for (const line of p.inbox) if (line.startsWith('room_state')) expect(line.length).toBeLessThan(20_000);

    expect(await call(players[1]!, 'request_rematch')).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(await call(players[0]!, 'request_rematch')).toEqual({ ok: true });
    const again = await stateWhere(players[0]!, s => s.matchNumber === 2 && s.phase === 'listen');
    expect(again.players.every(p => p.score === 0)).toBe(true);
  }, 30_000);

  it('ends the round on the server deadline when not everyone sends a take', async () => {
    const { players } = await setupRoom(2);
    await call(players[0]!, 'start_game');
    const rec = await stateWhere(players[0]!, s => s.phase === 'record');
    await call(players[0]!, 'submit_take', goodTake(rec));
    const res = await stateWhere(players[0]!, s => s.phase === 'results');
    expect(res.serverNow).toBeGreaterThanOrEqual(rec.round!.phaseEndsAt - 5);
    expect(res.lastResult!.takes.find(t => t.playerId !== res.lastResult!.takes[0]!.playerId)).toMatchObject({ verdict: 'none', points: 0 });
  });

  it('refuses takes that are not PCM, too big, or too fast', async () => {
    const { players } = await setupRoom(2);
    await call(players[0]!, 'start_game');
    await stateWhere(players[0]!, s => s.phase === 'record');
    const p = players[1]!;
    expect(await call(p, 'submit_take', 'hello')).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await call(p, 'submit_take', Buffer.alloc(3))).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await call(p, 'submit_take', Buffer.alloc(MAX_RECORDING_BYTES + 2))).toMatchObject({ ok: false });
    expect(await call(p, 'submit_take', Buffer.alloc(2000))).toMatchObject({ ok: false, code: 'BAD_INPUT' }); // too short
    const codes: string[] = [];
    for (let i = 0; i < 40; i++) codes.push((await call(p, 'submit_take', Buffer.alloc(2))).code ?? 'ok');
    expect(codes).toContain('RATE_LIMITED');
  });
});

describe('reconnection', () => {
  it('restores a seat with the session token after a dropped connection', async () => {
    const { players, joined, code } = await setupRoom(3, {});
    players[1]!.disconnect();
    await stateWhere(players[0]!, x => x.players.some(p => p.id === joined[1]!.playerId && !p.connected));
    const back = await client();
    expect(await call(back, 'resume_session', { code, token: joined[1]!.token })).toMatchObject({ ok: true, playerId: joined[1]!.playerId });
    await stateWhere(players[0]!, x => x.players.every(p => p.connected));
  });

  it('a second tab with the same token replaces the first', async () => {
    const { players, joined, code } = await setupRoom(3, {});
    const kicked = new Promise<void>(res => players[1]!.once('session_replaced', () => res()));
    const other = await client();
    expect(await call(other, 'resume_session', { code, token: joined[1]!.token })).toMatchObject({ ok: true });
    await kicked;
    // The replaced socket can no longer act for the seat.
    expect(await call(players[1]!, 'leave_room')).toEqual({ ok: true });
    expect(mimic.manager.rooms.get(code)!.players.has(joined[1]!.playerId)).toBe(true);
  });

  it('rejects a forged or stale token and reports a vanished room clearly', async () => {
    const { code } = await setupRoom(1, {});
    const p = await client();
    expect(await call(p, 'resume_session', { code, token: 'A'.repeat(32) })).toMatchObject({ ok: false, code: 'SESSION_INVALID' });
    expect(await call(p, 'resume_session', { code: 'ZZZZZZ', token: 'A'.repeat(32) })).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });

  it('acts only for the seat bound to the socket, never one named in the payload', async () => {
    const { players, idOf } = await setupRoom(2, {});
    // A non-host naming the host's id gets nowhere: identity comes from the socket, not the payload.
    expect(await call(players[1]!, 'start_game', { playerId: idOf(0) })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    const stranger = await client();
    expect(await call(stranger, 'start_game')).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' });
    expect(await call(stranger, 'submit_take', Buffer.alloc(4000))).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' });
    expect(await call(stranger, 'get_take', { playerId: idOf(0) })).toMatchObject({ ok: false, code: 'NOT_IN_ROOM' });
  });
});
