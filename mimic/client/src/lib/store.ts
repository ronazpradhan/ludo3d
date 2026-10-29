// The client's single store: the latest room snapshot from the server, this player's own take result and
// connection status. It holds no game rules; it shows what the server says.
import { io, type Socket } from 'socket.io-client';
import { SOCKET_PATH } from '../../../shared/constants';
import type { ClientToServerEvents, ErrorCode, JoinedRoom, OpenRoom, ProfileInput, RoomSettings, RoomSnapshot, ServerToClientEvents, TakeFeedback } from '../../../shared/types';
import { clearSeat, forgetLastSeat, lastSeat, saveProfile, saveSeat, type Seat, tabSeat } from './session';
import { sounds } from './sound';

export type Connection = 'connecting' | 'online' | 'offline';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

export interface State {
  connection: Connection;
  /** True while the first resume attempt after loading is in flight. */
  restoring: boolean;
  me: Seat | null;
  room: RoomSnapshot | null;
  /** My scored take for the current round (`match:round` key). */
  myTake: { key: string; feedback: TakeFeedback } | null;
  /** server clock - local clock, in ms */
  clockOffset: number;
  notice: Notice | null;
  /** A seat saved by a tab that has since closed. */
  rejoinable: Seat | null;
  ended: 'replaced' | 'closed' | 'lost' | null;
  busy: boolean;
}

type Res<T = object> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string };

export const roundKey = (r: RoomSnapshot | null): string => (r?.round ? `${r.matchNumber}:${r.round.number}` : '');

export class MimicStore {
  private state: State;
  private readonly subs = new Set<() => void>();
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private noticeSeq = 0;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(url?: string) {
    const seat = tabSeat();
    this.state = {
      connection: 'connecting',
      restoring: !!seat,
      me: null,
      room: null,
      myTake: null,
      clockOffset: 0,
      notice: null,
      rejoinable: seat ? null : lastSeat(),
      ended: null,
      busy: false,
    };
    this.socket = url ? io(url, { path: SOCKET_PATH }) : io({ path: SOCKET_PATH });
    this.wire();
  }

  // ---------- subscription (for useSyncExternalStore) ----------
  getState = (): State => this.state;
  subscribe = (f: () => void): (() => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };
  private set(patch: Partial<State>): void {
    this.state = { ...this.state, ...patch };
    this.subs.forEach(f => f());
  }

  serverNow(): number {
    return Date.now() + this.state.clockOffset;
  }

  notify(text: string, kind: Notice['kind'] = 'error'): void {
    this.set({ notice: { id: ++this.noticeSeq, kind, text } });
  }
  dismissNotice(): void {
    this.set({ notice: null });
  }

  // ---------- socket ----------
  private wire(): void {
    const s = this.socket;
    s.on('connect', () => {
      this.set({ connection: 'online' });
      this.syncClock();
      this.syncTimer ??= setInterval(() => this.syncClock(), 30_000);
      const seat = this.state.me ?? tabSeat();
      if (seat) void this.resume(seat, true);
    });
    s.on('disconnect', () => this.set({ connection: 'offline' }));
    s.io.on('reconnect_attempt', () => this.set({ connection: 'connecting' }));
    s.on('room_state', snap => this.onRoomState(snap));
    s.on('session_replaced', () => this.set({ me: null, room: null, ended: 'replaced' }));
    s.on('room_closed', reason => {
      clearSeat();
      this.set({ me: null, room: null, ended: 'closed' });
      this.notify(reason === 'expired' ? 'The room closed after a long time without play.' : reason === 'ended' ? 'The host ended the room.' : 'The room was closed.', 'info');
    });
    s.on('error_message', e => this.notify(e.message));
  }

  private onRoomState(snap: RoomSnapshot): void {
    const prev = this.state.room;
    const patch: Partial<State> = { room: snap, clockOffset: this.state.clockOffset || snap.serverNow - Date.now() };
    if (this.state.myTake && this.state.myTake.key !== roundKey(snap)) patch.myTake = null;
    if (prev && prev.phase !== snap.phase) {
      if (snap.phase === 'results') sounds.reveal();
      if (snap.phase === 'finished') sounds.victory();
    }
    this.set(patch);
  }

  private syncClock(): void {
    const t0 = Date.now();
    this.socket.timeout(5000).emit('sync_clock', (err: Error | null, serverNow: number) => {
      if (err || typeof serverNow !== 'number') return;
      this.set({ clockOffset: serverNow - (t0 + Date.now()) / 2 });
    });
  }

  private call<T>(fn: (done: (res: Res<T>) => void) => void, ms = 8000): Promise<Res<T>> {
    return new Promise(resolve => {
      if (!this.socket.connected) {
        resolve({ ok: false, code: 'SERVER_BUSY', message: 'Not connected. Trying to reconnect…' });
        return;
      }
      let settled = false;
      const t = setTimeout(() => {
        settled = true;
        resolve({ ok: false, code: 'SERVER_BUSY', message: 'The server did not answer. Try again.' });
      }, ms);
      fn(res => {
        if (settled) return;
        clearTimeout(t);
        resolve(res);
      });
    });
  }

  private enter(joined: JoinedRoom): void {
    const seat: Seat = { code: joined.code, playerId: joined.playerId, token: joined.token };
    saveSeat(seat);
    this.set({ me: seat, ended: null, rejoinable: null, restoring: false });
  }

  // ---------- actions ----------
  async createRoom(profile: ProfileInput): Promise<boolean> {
    saveProfile(profile);
    this.set({ busy: true });
    const res = await this.call<JoinedRoom>(done => this.socket.emit('create_room', profile, done));
    this.set({ busy: false });
    if (!res.ok) return this.notify(res.message), false;
    this.enter(res);
    return true;
  }

  async joinRoom(profile: ProfileInput, code: string): Promise<boolean> {
    saveProfile(profile);
    this.set({ busy: true });
    const res = await this.call<JoinedRoom>(done => this.socket.emit('join_room', { ...profile, code }, done));
    this.set({ busy: false });
    if (!res.ok) return this.notify(res.message), false;
    this.enter(res);
    return true;
  }

  async resume(seat: Seat, automatic = false): Promise<void> {
    const res = await this.call<JoinedRoom>(done => this.socket.emit('resume_session', { code: seat.code, token: seat.token }, done));
    if (res.ok) return this.enter(res);
    if (res.code === 'ROOM_NOT_FOUND' || res.code === 'SESSION_INVALID') {
      clearSeat();
      forgetLastSeat();
      this.set({ me: null, room: null, rejoinable: null, restoring: false, ended: automatic && this.state.me ? 'lost' : null });
      this.notify(res.message, 'info');
    } else {
      this.set({ restoring: false });
      if (!automatic) this.notify(res.message);
    }
  }

  /** Leaves the room; the host can `end` it for everyone instead. */
  async leave(end = false): Promise<void> {
    if (this.socket.connected) await this.call(done => this.socket.emit('leave_room', { end }, done));
    clearSeat();
    this.set({ me: null, room: null, myTake: null, ended: null });
  }

  /** Back to the home screen after a terminal state (kicked, room closed). */
  reset(): void {
    this.set({ ended: null, me: null, room: null, rejoinable: lastSeat() });
  }

  async updateSettings(patch: Partial<RoomSettings>): Promise<void> {
    const res = await this.call(done => this.socket.emit('update_settings', patch, done));
    if (!res.ok) this.notify(res.message);
  }

  private async simple(event: 'start_game' | 'request_rematch' | 'back_to_lobby'): Promise<void> {
    this.set({ busy: true });
    const res = await this.call(done => this.socket.emit(event, done));
    this.set({ busy: false });
    if (!res.ok) this.notify(res.message);
  }
  start = (): Promise<void> => this.simple('start_game');
  rematch = (): Promise<void> => this.simple('request_rematch');
  backToLobby = (): Promise<void> => this.simple('back_to_lobby');

  /** Tells the server this round's sound is downloaded, so it can play for everyone together. */
  clipReady(round: number): void {
    this.socket.emit('clip_ready', { round });
  }

  /** Sends my recorded take; the server scores it and answers with my score. */
  async submitTake(pcm: Int16Array): Promise<TakeFeedback | null> {
    const key = roundKey(this.state.room);
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    this.set({ busy: true });
    const res = await this.call<TakeFeedback>(done => this.socket.emit('submit_take', buf, done), 15_000);
    this.set({ busy: false });
    if (!res.ok) {
      this.notify(res.message);
      return null;
    }
    const feedback: TakeFeedback = { score: res.score, verdict: res.verdict, parts: res.parts };
    sounds.submitted();
    this.set({ myTake: { key, feedback } });
    return feedback;
  }

  /** Public rooms for the home screen; null if the server couldn't be asked. */
  async listRooms(): Promise<OpenRoom[] | null> {
    const res = await this.call<{ rooms: OpenRoom[] }>(done => this.socket.emit('list_rooms', done));
    return res.ok ? res.rooms : null;
  }

  async fetchTake(playerId: string): Promise<Int16Array | null> {
    const res = await this.call<{ pcm: ArrayBuffer }>(done => this.socket.emit('get_take', { playerId }, done));
    if (!res.ok) {
      this.notify(res.message, 'info');
      return null;
    }
    const bytes = new Uint8Array(res.pcm);
    const copy = new Uint8Array(bytes); // aligned
    return new Int16Array(copy.buffer, 0, copy.byteLength >> 1);
  }
}
