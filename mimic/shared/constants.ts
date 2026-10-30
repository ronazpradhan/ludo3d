// Rules and limits shared by the Mimic server and client. The server is the only one that enforces them;
// the client uses them to draw the right controls.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

// No O/0, I/1 or L so codes are easy to read out loud.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export const NICKNAME_MAX = 16;

/** Recordings travel as 16-bit mono PCM at this rate. */
export const RECORDING_RATE = 12_000;
/** A take may run this much longer than the clip, and never longer than MAX_TAKE_SEC. */
export const TAKE_EXTRA_SEC = 2;
export const MAX_TAKE_SEC = 8;
export const MAX_RECORDING_BYTES = MAX_TAKE_SEC * RECORDING_RATE * 2;

/** Listen phase: 2 seconds of "sound in 2, 1", the clip played once, a pause, then a 3-2-1 countdown. */
export const LISTEN_LEAD_MS = 2000;
export const listenLeadMs = (_clip: { audio?: string }): number => LISTEN_LEAD_MS;
export const LISTEN_TAIL_MS = 400;
/** Longest the round waits for every player to download the sound before it plays for everyone together. */
export const LOAD_MAX_MS = 6000;
export const COUNTDOWN_MS = 3000;
/** Recording starts for everyone at once and runs for the round's take length. This extra time
 *  only covers sending the take to the server; nobody can record longer than the take length. */
export const UPLOAD_GRACE_MS = 8000;
/** How long a phone may spend judging a take's words before sending it without. */
export const WORDS_JUDGE_MS = 5000;
/** Share of the score that comes from saying the right words, for sounds that have words. */
export const WORDS_WEIGHT = 0.35;
/** Results: the answer is shown, then every take is played to everyone, each followed by its score. */
export const RESULTS_INTRO_MS = 1800;
export const RESULTS_SCORE_MS = 1600;
export const RESULTS_OUTRO_MS = 3500;

export const ROUND_OPTIONS = [5, 8, 10] as const;

/** Category ids come from the sound library (folders in mimic/sounds). */
export const CATEGORY_ID = /^[a-z0-9-]{1,40}$/;

export const AVATARS = ['fox', 'panda', 'frog', 'octopus', 'owl', 'tiger', 'monkey', 'penguin', 'turtle', 'bee', 'dino', 'whale'] as const;

export const AVATAR_EMOJI: Record<(typeof AVATARS)[number], string> = {
  fox: '🦊',
  panda: '🐼',
  frog: '🐸',
  octopus: '🐙',
  owl: '🦉',
  tiger: '🐯',
  monkey: '🐵',
  penguin: '🐧',
  turtle: '🐢',
  bee: '🐝',
  dino: '🦖',
  whale: '🐳',
};

export const POINTS = {
  /** Added to the 0-100 similarity score of the best take of the round (shared on a tie). */
  bestTakeBonus: 30,
} as const;

/** Labels for a 0-100 similarity score. */
export function scoreLabel(score: number): string {
  if (score >= 95) return 'Perfect copy!';
  if (score >= 85) return 'Great';
  if (score >= 70) return 'Pretty close';
  if (score >= 45) return 'Kind of';
  return 'Way off';
}

export const VISIBILITY = ['private', 'public'] as const;

/** Defaults for a new room. Categories start empty: the host turns on the ones they want. */
export const DEFAULT_SETTINGS = {
  rounds: 8 as const,
  visibility: 'private' as const,
};

/** Socket.IO lives under the Mimic prefix so it never collides with the other games' WebSocket. */
export const SOCKET_PATH = '/mimic/socket.io';
