// One Mimic room: players, settings and the match state machine
//   lobby -> listen -> record -> results -> listen ... -> finished -> (rematch) listen / (back) lobby
// Each round everyone hears the same clip exactly once, then after a 3-2-1 countdown everyone records one take at
// the same moment, for the same length. The server scores every take.
// The room owns the only copy of the game state and its own timers. Node runs each socket event and each
// timer callback to completion before the next one, and nothing in here awaits, so every method below is
// an atomic step for its room. Timers carry a phase token: a timer that fires after its phase has already
// moved on (everyone submitted early, a player left) finds a different token and does nothing.

import {
  COUNTDOWN_MS,
  DEFAULT_SETTINGS,
  LISTEN_TAIL_MS,
  listenLeadMs,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RECORDING_RATE,
  RESULTS_INTRO_MS,
  RESULTS_OUTRO_MS,
  RESULTS_SCORE_MS,
  UPLOAD_GRACE_MS,
} from '../shared/constants';
import { int16ToFloat } from '../shared/dsp';
import type { Avatar, Clip, ErrorCode, OpenRoom, PlaybackStep, PublicPlayer, RoomPhase, RoomSettings, RoomSnapshot, RoundResult, TakeFeedback } from '../shared/types';
import { scoreImitation } from './audio-score';
import { roundPoints, type Take } from './scoring';
import { eligibleClips, type Library, maxTakeSec, pickClip, referenceFor } from './sounds';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string };
export const fail = (code: ErrorCode, message: string): { ok: false; code: ErrorCode; message: string } => ({ ok: false, code, message });

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Phase lengths. Production uses the shared constants; tests shorten them. */
export interface Timing {
  /** Overrides the listen phase length (normally lead-in + the clip once + pause + 3-2-1 countdown). */
  listenMs?: number;
  /** Overrides the record phase length (normally the take length + upload time). */
  recordMs?: number;
  /** Overrides the results length (normally long enough to play every take and show its score). */
  resultsMs?: number;
}
export const DEFAULT_TIMING: Timing = {};

export interface RoomListener {
  /** Public state changed; broadcast a fresh snapshot to everyone in the room. */
  state(room: Room): void;
}

export interface Player {
  id: string;
  nickname: string;
  avatar: Avatar;
  tokenHash: string;
  socketId: string | null;
  connected: boolean;
  disconnectedAt: number | null;
  score: number;
}

interface StoredTake extends Take {
  pcm: Int16Array | null;
}

interface Round {
  number: number;
  clip: Clip;
  maxTakeSec: number;
  phase: 'listen' | 'record' | 'results';
  phaseStartedAt: number;
  phaseEndsAt: number;
  takes: Map<string, StoredTake>;
}

interface Match {
  total: number;
  played: number;
  round: Round | null;
  /** Clips already played this match: a sound never repeats within a game. */
  used: Set<string>;
}

/** Everything about a clip except its name, which is the answer. */
function publicClip(c: Clip): Omit<Clip, 'name'> {
  return { id: c.id, category: c.category, duration: c.duration, ...(c.events ? { events: c.events } : {}), ...(c.audio ? { audio: c.audio } : {}) };
}

export class Room {
  readonly code: string;
  readonly createdAt: number;
  hostId = '';
  readonly players = new Map<string, Player>(); // insertion order = join order
  settings: RoomSettings = { ...DEFAULT_SETTINGS, categories: [] };
  phase: RoomPhase = 'lobby';
  matchNumber = 0;
  lastActivity: number;
  private match: Match | null = null;
  private lastResult: RoundResult | null = null;
  private readonly usedClips = new Set<string>();
  private timer: unknown = null;
  private token = 0;
  private closed = false;

  constructor(
    code: string,
    private readonly lib: Library,
    private readonly listener: RoomListener,
    private readonly clock: Clock = realClock,
    private readonly timing: Timing = DEFAULT_TIMING,
  ) {
    this.code = code;
    this.createdAt = clock.now();
    this.lastActivity = this.createdAt;
  }

  // ---------- players ----------

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  nicknameTaken(nickname: string): boolean {
    const key = nickname.toLocaleLowerCase();
    for (const p of this.players.values()) if (p.nickname.toLocaleLowerCase() === key) return true;
    return false;
  }

  canJoin(nickname: string): Result {
    if (this.phase !== 'lobby' && this.phase !== 'finished') return fail('MATCH_IN_PROGRESS', 'A match is in progress. Join when it ends.');
    if (this.players.size >= MAX_PLAYERS) return fail('ROOM_FULL', `This room is full (${MAX_PLAYERS} players).`);
    if (this.nicknameTaken(nickname)) return fail('NAME_TAKEN', 'Someone in this room already has that nickname.');
    return { ok: true };
  }

  addPlayer(p: Omit<Player, 'connected' | 'disconnectedAt' | 'score' | 'socketId'>): Result {
    const check = this.canJoin(p.nickname);
    if (!check.ok) return check;
    this.players.set(p.id, { ...p, socketId: null, connected: false, disconnectedAt: this.clock.now(), score: 0 });
    if (!this.hostId) this.hostId = p.id;
    this.touch();
    this.listener.state(this);
    return { ok: true };
  }

  setConnected(playerId: string, socketId: string | null): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.socketId = socketId;
    p.connected = socketId !== null;
    p.disconnectedAt = socketId === null ? this.clock.now() : null;
    this.touch();
    if (!p.connected) this.checkEveryoneSubmitted();
    if (!this.closed) this.listener.state(this);
  }

  /** Removes a player for good (left, or away longer than the grace period). */
  removePlayer(playerId: string): void {
    if (!this.players.delete(playerId)) return;
    this.touch();
    if (this.hostId === playerId) this.hostId = this.pickNewHost();
    if (this.players.size === 0) {
      this.close();
      return;
    }
    if (this.match) {
      if (this.players.size < MIN_PLAYERS) return this.finish();
      this.checkEveryoneSubmitted();
    }
    if (!this.closed) this.listener.state(this);
  }

  private pickNewHost(): string {
    let fallback = '';
    for (const p of this.players.values()) {
      if (p.connected) return p.id;
      if (!fallback) fallback = p.id;
    }
    return fallback;
  }

  /** Hands the host role on if the host has been away too long but is still inside the grace period. */
  handOffHostIfAway(now: number, afterMs: number): void {
    const host = this.players.get(this.hostId);
    if (!host || host.connected || host.disconnectedAt === null || now - host.disconnectedAt < afterMs) return;
    const next = this.pickNewHost();
    if (next && next !== this.hostId && this.players.get(next)?.connected) {
      this.hostId = next;
      this.listener.state(this);
    }
  }

  // ---------- settings / start ----------

  updateSettings(by: string, patch: Partial<RoomSettings>): Result {
    if (by !== this.hostId) return fail('NOT_HOST', 'Only the host can change the settings.');
    if (this.phase !== 'lobby' && this.phase !== 'finished') return fail('WRONG_PHASE', 'Settings are locked during a match.');
    const next: RoomSettings = { ...this.settings, ...patch };
    next.categories = [...new Set(next.categories)];
    if (next.categories.some(c => !this.lib.categories.some(k => k.id === c))) return fail('BAD_INPUT', 'That category does not exist.');
    this.settings = next;
    this.touch();
    this.listener.state(this);
    return { ok: true };
  }

  start(by: string): Result {
    if (by !== this.hostId) return fail('NOT_HOST', 'Only the host can start the match.');
    if (this.phase !== 'lobby' && this.phase !== 'finished') return fail('WRONG_PHASE', 'A match is already running.');
    if (this.connectedCount < MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS', `You need at least ${MIN_PLAYERS} connected players.`);
    const pool = eligibleClips(this.lib.clips, this.settings);
    if (pool.length === 0) return fail('BAD_INPUT', 'Turn on at least one category.');
    for (const p of this.players.values()) p.score = 0;
    // Never more rounds than there are different sounds, so nothing repeats.
    this.match = { total: Math.min(this.settings.rounds, pool.length), played: 0, round: null, used: new Set() };
    this.matchNumber++;
    this.lastResult = null;
    this.touch();
    this.nextRound();
    return { ok: true };
  }

  rematch(by: string): Result {
    if (this.phase !== 'finished') return fail('WRONG_PHASE', 'The match has not finished yet.');
    return this.start(by);
  }

  backToLobby(by: string): Result {
    if (by !== this.hostId) return fail('NOT_HOST', 'Only the host can do that.');
    if (this.phase !== 'finished') return fail('WRONG_PHASE', 'The match has not finished yet.');
    for (const p of this.players.values()) p.score = 0;
    this.phase = 'lobby';
    this.lastResult = null;
    this.match = null;
    this.touch();
    this.listener.state(this);
    return { ok: true };
  }

  // ---------- rounds ----------

  private setPhase(r: Round, phase: Round['phase'], ms: number, then: () => void): void {
    const now = this.clock.now();
    r.phase = phase;
    r.phaseStartedAt = now;
    r.phaseEndsAt = now + ms;
    this.phase = phase;
    this.schedule(ms, then);
    this.listener.state(this);
  }

  private nextRound(): void {
    const m = this.match;
    if (!m) return;
    this.clearTimer();
    if (m.played >= m.total || this.players.size < MIN_PLAYERS) return this.finish();
    // Prefer sounds this room hasn't heard in earlier games too; never one already played in this game.
    const pool = eligibleClips(this.lib.clips, this.settings).filter(c => !m.used.has(c.id));
    if (pool.length === 0) return this.finish();
    const clip = pickClip(pool, this.usedClips);
    m.used.add(clip.id);
    referenceFor(clip, this.lib); // analyse and calibrate the sound now, while everyone listens, so scoring is instant
    m.played++;
    const r: Round = { number: m.played, clip, maxTakeSec: maxTakeSec(clip), phase: 'listen', phaseStartedAt: 0, phaseEndsAt: 0, takes: new Map() };
    m.round = r;
    this.lastResult = null;
    const listenMs = this.timing.listenMs ?? Math.round(listenLeadMs(clip) + clip.duration * 1000 + LISTEN_TAIL_MS + COUNTDOWN_MS);
    this.setPhase(r, 'listen', listenMs, () => this.beginRecording());
  }

  private beginRecording(): void {
    const r = this.match?.round;
    if (!r || r.phase !== 'listen') return;
    this.setPhase(r, 'record', this.timing.recordMs ?? r.maxTakeSec * 1000 + UPLOAD_GRACE_MS, () => this.endRound());
  }

  private checkEveryoneSubmitted(): void {
    const r = this.match?.round;
    if (!r || r.phase !== 'record') return;
    const waiting = [...this.players.values()].some(p => p.connected && !r.takes.has(p.id));
    if (!waiting && r.takes.size > 0) this.endRound();
  }

  /** Scores one player's take. Each player gets one take per round. */
  submitTake(by: string, pcm: Int16Array): Result<{ feedback: TakeFeedback }> {
    const r = this.match?.round;
    if (!r || r.phase !== 'record') return fail('WRONG_PHASE', 'Recording is closed right now.');
    if (!this.players.has(by)) return fail('NOT_IN_ROOM', 'You are not in this room.');
    if (r.takes.has(by)) return fail('ALREADY_SUBMITTED', 'You already sent your take for this round.');
    const seconds = pcm.length / RECORDING_RATE;
    if (seconds < 0.2) return fail('BAD_INPUT', 'That recording is too short.');
    if (seconds > r.maxTakeSec + 0.25) return fail('BAD_INPUT', `Takes can be up to ${r.maxTakeSec} seconds this round.`);
    this.touch();
    const scored = scoreImitation(referenceFor(r.clip, this.lib), int16ToFloat(pcm), RECORDING_RATE);
    const pct = (v: number) => Math.round(v * 100);
    const parts = scored.verdict === 'ok' ? { tone: pct(scored.parts.tone), rhythm: pct(scored.parts.rhythm), melody: scored.parts.melody === null ? null : pct(scored.parts.melody), length: pct(scored.parts.length) } : null;
    r.takes.set(by, { playerId: by, score: scored.score, verdict: scored.verdict, hasAudio: true, parts, pcm });
    this.checkEveryoneSubmitted();
    if (r.phase === 'record') this.listener.state(this);
    return { ok: true, feedback: { score: scored.score, verdict: scored.verdict, parts } };
  }

  private endRound(): void {
    const m = this.match;
    const r = m?.round;
    if (!m || !r || r.phase !== 'record') return;
    const takes: Take[] = [];
    for (const p of this.players.values()) takes.push(r.takes.get(p.id) ?? { playerId: p.id, score: 0, verdict: 'none', hasAudio: false, parts: null });
    const results = roundPoints(takes);
    for (const t of results) {
      const p = this.players.get(t.playerId);
      if (p) p.score += t.points;
    }
    // Play every take to everyone, worst first so the best copy comes last, each followed by its score.
    const playlist: PlaybackStep[] = [];
    let at = RESULTS_INTRO_MS;
    for (const t of [...results].reverse()) {
      const pcm = r.takes.get(t.playerId)?.pcm;
      const ms = pcm ? Math.round((pcm.length / RECORDING_RATE) * 1000) : 0;
      playlist.push({ playerId: t.playerId, at, ms });
      at += ms + RESULTS_SCORE_MS;
    }
    this.lastResult = { number: r.number, clip: { id: r.clip.id, name: r.clip.name, category: r.clip.category }, takes: results, playlist };
    this.setPhase(r, 'results', this.timing.resultsMs ?? at + RESULTS_OUTRO_MS, () => this.nextRound());
  }

  /** Someone's recording from the round being shown, for playback during the results. */
  takeAudio(requester: string, playerId: string): Int16Array | null {
    const r = this.match?.round;
    if (!r || r.phase !== 'results' || !this.players.has(requester)) return null;
    return r.takes.get(playerId)?.pcm ?? null;
  }

  private finish(): void {
    this.clearTimer();
    this.match = null; // drops the recordings too
    this.phase = 'finished';
    this.listener.state(this);
  }

  // ---------- timers ----------

  private schedule(ms: number, fn: () => void): void {
    this.clearTimer();
    const token = ++this.token;
    this.timer = this.clock.setTimeout(() => {
      if (this.closed || token !== this.token) return;
      this.timer = null;
      fn();
    }, ms);
  }

  private clearTimer(): void {
    this.token++;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  close(): void {
    this.closed = true;
    this.clearTimer();
    this.match = null;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private touch(): void {
    this.lastActivity = this.clock.now();
  }

  // ---------- views ----------

  /** How this room appears in the public list, or null if it isn't listed. */
  listing(): OpenRoom | null {
    if (this.closed || this.settings.visibility !== 'public' || this.connectedCount === 0) return null;
    const host = this.players.get(this.hostId);
    if (!host) return null;
    return {
      code: this.code,
      host: { nickname: host.nickname, avatar: host.avatar },
      players: this.players.size,
      maxPlayers: MAX_PLAYERS,
      playing: this.phase !== 'lobby' && this.phase !== 'finished',
    };
  }

  /** The same for every viewer: the clip to play, but never its name before the results, and no recordings. */
  snapshot(): RoomSnapshot {
    const players: PublicPlayer[] = [...this.players.values()].map(p => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      connected: p.connected,
      score: p.score,
    }));
    const m = this.match;
    const r = m?.round;
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players,
      settings: { ...this.settings, categories: [...this.settings.categories] },
      categories: this.lib.categories,
      round:
        m && r
          ? {
              number: r.number,
              total: m.total,
              clip: publicClip(r.clip),
              phaseStartedAt: r.phaseStartedAt,
              phaseEndsAt: r.phaseEndsAt,
              maxTakeSec: r.maxTakeSec,
              submittedIds: [...r.takes.keys()],
            }
          : null,
      lastResult: this.phase === 'results' || this.phase === 'finished' ? this.lastResult : null,
      matchNumber: this.matchNumber,
      serverNow: this.clock.now(),
    };
  }
}
