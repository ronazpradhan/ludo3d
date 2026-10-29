import type { AVATARS, CATEGORIES, DIFFICULTIES, DIFFICULTY_SETTINGS, ROUND_OPTIONS } from './constants';
import type { ClipEvent } from './synth';

export type Avatar = (typeof AVATARS)[number];
export type Category = (typeof CATEGORIES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type DifficultySetting = (typeof DIFFICULTY_SETTINGS)[number];

export interface Clip {
  id: string;
  name: string;
  category: Category;
  difficulty: Difficulty;
  events: ClipEvent[];
}

export interface RoomSettings {
  rounds: (typeof ROUND_OPTIONS)[number];
  categories: Category[];
  difficulty: DifficultySetting;
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
  clip: { id: string; category: Category; difficulty: Difficulty; events: ClipEvent[] };
  /** Server epoch ms when the current phase began / ends. */
  phaseStartedAt: number;
  phaseEndsAt: number;
  /** Longest take the server accepts this round, in seconds. */
  maxTakeSec: number;
  submittedIds: string[];
}

export type Verdict = 'ok' | 'silent' | 'replay' | 'none';

export interface TakeResult {
  playerId: string;
  score: number;
  verdict: Verdict;
  points: number;
  best: boolean;
  /** Whether a recording can be played back. */
  hasAudio: boolean;
}

export interface RoundResult {
  number: number;
  clip: { id: string; name: string; category: Category; difficulty: Difficulty };
  takes: TakeResult[];
}

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: PublicPlayer[];
  settings: RoomSettings;
  round: PublicRound | null;
  lastResult: RoundResult | null;
  matchNumber: number;
  /** Server clock when this snapshot was sent; lets clients line up their countdowns. */
  serverNow: number;
}

export interface TakeFeedback {
  score: number;
  verdict: Verdict;
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
