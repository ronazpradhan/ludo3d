// What the browser remembers. The tab's own seat lives in sessionStorage so several tabs can be different
// players; the last seat is also copied to localStorage so a closed tab can still rejoin from the home screen.
import type { Avatar, ProfileInput } from '../../../shared/types';
import { AVATARS } from '../../../shared/constants';

export interface Seat {
  code: string;
  playerId: string;
  token: string;
}

const SEAT = 'mimic.seat';
const LAST = 'mimic.last';
const PROFILE = 'mimic.profile';
const MUTED = 'mimic.muted';
const LAST_MAX_AGE = 3 * 3600_000;

function read<T>(store: Storage | undefined, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(store: Storage | undefined, key: string, value: unknown): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: the game still works, it just can't remember */
  }
}
const local = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);
const session = (): Storage | undefined => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);

const isSeat = (s: unknown): s is Seat =>
  !!s && typeof s === 'object' && typeof (s as Seat).code === 'string' && typeof (s as Seat).token === 'string' && typeof (s as Seat).playerId === 'string';

export const tabSeat = (): Seat | null => {
  const s = read<Seat>(session(), SEAT);
  return isSeat(s) ? s : null;
};

export function lastSeat(): Seat | null {
  const s = read<Seat & { savedAt: number }>(local(), LAST);
  if (!isSeat(s) || typeof s.savedAt !== 'number' || Date.now() - s.savedAt > LAST_MAX_AGE) return null;
  return s;
}

export function saveSeat(seat: Seat): void {
  write(session(), SEAT, seat);
  write(local(), LAST, { ...seat, savedAt: Date.now() });
}

export function clearSeat(): void {
  const mine = tabSeat();
  write(session(), SEAT, null);
  const last = lastSeat();
  if (!last || !mine || last.token === mine.token) write(local(), LAST, null);
}

export function forgetLastSeat(): void {
  write(local(), LAST, null);
}

export function loadProfile(): ProfileInput {
  const p = read<ProfileInput>(local(), PROFILE);
  const avatar: Avatar = p && (AVATARS as readonly string[]).includes(p.avatar) ? p.avatar : AVATARS[Math.floor(Math.random() * AVATARS.length)]!;
  return { nickname: typeof p?.nickname === 'string' ? p.nickname : '', avatar };
}

export const saveProfile = (p: ProfileInput): void => write(local(), PROFILE, p);
export const loadMuted = (): boolean => read<boolean>(local(), MUTED) === true;
export const saveMuted = (m: boolean): void => write(local(), MUTED, m);
