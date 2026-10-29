import type { AVATARS, ROUND_OPTIONS, VISIBILITY } from './constants';
import type { ClipEvent } from './synth';

export type Avatar = (typeof AVATARS)[number];
export type Category = string;
export type Visibility = (typeof VISIBILITY)[number];

export interface CategoryInfo {
  id: Category;
  label: string;
  emoji: string;
  hint: string;
  /** how many sounds it has */
  count: number;
}

/** A sound to copy: either synthesized from `events`, or a recording at `audio` (a path under /mimic/). */
export interface Clip {
  id: string;
  name: string;
  category: Category;
  duration: number;
  events?: ClipEvent[];
  audio?: string;
}

export interface RoomSettings {
  rounds: (typeof ROUND_OPTIONS)[number];
  categories: Category[];
  visibility: Visibility;
}

/** A public room as listed on the home screen. */
export interface OpenRoom {
  code: string;
  host: { nickname: string; avatar: Avatar };
  players: number;
  maxPlayers: number;
  playing: boolean;
}

export type RoomPhase = 'lobby' | 'listen' | 'record' | 'results' | 'finished';

export interface PublicPlayer {
  id: string;
  nickname: string;
  avatar: Avatar;
  connected: boolean;
  score: number;
}

export interface PublicRound {
  number: number;
  total: number;
  /** What to play. The clip's name stays hidden until the results. */
  clip: Omit<Clip, 'name'>;
  /** Server epoch ms when the current phase began / ends. */
  phaseStartedAt: number;
  phaseEndsAt: number;
  /** Longest take the server accepts this round, in seconds. */
  maxTakeSec: number;
  submittedIds: string[];
}

export type Verdict = 'ok' | 'silent' | 'replay' | 'none';

/** What a score is made of, each 0-100: how it sounds, its rhythm, its pitch line (null if the sound has none), its length. */
export interface ScoreParts {
  tone: number;
  rhythm: number;
  melody: number | null;
  length: number;
}

export interface TakeResult {
  playerId: string;
  score: number;
  verdict: Verdict;
  points: number;
  best: boolean;
  /** Whether a recording can be played back. */
  hasAudio: boolean;
  parts: ScoreParts | null;
}

/** One step of the results show: play this player's take (`ms` long, 0 if none), then reveal their score. */
export interface PlaybackStep {
  playerId: string;
  /** when the take starts playing, ms after the results began */
  at: number;
  ms: number;
}

export interface RoundResult {
  number: number;
  clip: { id: string; name: string; category: Category };
  takes: TakeResult[];
  /** Worst take first, best last. */
  playlist: PlaybackStep[];
}

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: PublicPlayer[];
  settings: RoomSettings;
  /** Every category in the sound library, for the settings. */
  categories: CategoryInfo[];
  round: PublicRound | null;
  lastResult: RoundResult | null;
  matchNumber: number;
  /** Server clock when this snapshot was sent; lets clients line up their countdowns. */
  serverNow: number;
}

export interface TakeFeedback {
  score: number;
  verdict: Verdict;
  parts: ScoreParts | null;
}

export type ErrorCode =
  | 'BAD_INPUT'
  | 'RATE_LIMITED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NAME_TAKEN'
  | 'MATCH_IN_PROGRESS'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'NOT_ENOUGH_PLAYERS'
  | 'WRONG_PHASE'
  | 'ALREADY_SUBMITTED'
  | 'SESSION_INVALID'
  | 'SERVER_BUSY';

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string }) => void;

export interface JoinedRoom {
  code: string;
  playerId: string;
  /** Secret for rejoining after a reload or dropped connection. Only ever sent to its owner. */
  token: string;
}

export interface ProfileInput {
  nickname: string;
  avatar: Avatar;
}

export interface ClientToServerEvents {
  create_room: (p: ProfileInput, ack: Ack<JoinedRoom>) => void;
  join_room: (p: ProfileInput & { code: string }, ack: Ack<JoinedRoom>) => void;
  resume_session: (p: { code: string; token: string }, ack: Ack<JoinedRoom>) => void;
  leave_room: (ack?: Ack) => void;
  update_settings: (p: Partial<RoomSettings>, ack?: Ack) => void;
  start_game: (ack?: Ack) => void;
  /** 16-bit little-endian mono PCM at RECORDING_RATE. */
  submit_take: (pcm: ArrayBuffer, ack?: Ack<TakeFeedback>) => void;
  /** During the results: someone's take from this round, as 16-bit PCM. */
  get_take: (p: { playerId: string }, ack: Ack<{ pcm: ArrayBuffer }>) => void;
  request_rematch: (ack?: Ack) => void;
  back_to_lobby: (ack?: Ack) => void;
  sync_clock: (ack: (serverNow: number) => void) => void;
  list_rooms: (ack: Ack<{ rooms: OpenRoom[] }>) => void;
}

export interface ServerToClientEvents {
  room_state: (s: RoomSnapshot) => void;
  /** Another tab or device took over this player's seat. */
  session_replaced: () => void;
  room_closed: (reason: 'removed' | 'expired' | 'empty') => void;
  error_message: (e: { code: ErrorCode; message: string }) => void;
}

export interface SocketData {
  playerId?: string;
  roomCode?: string;
  ip: string;
}
