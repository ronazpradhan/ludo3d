// How close is an imitation to the original sound? Runs on the server only, so the score can't be faked by
// a modified browser sending a number. Both sounds go through the same feature extraction:
//   loudness envelope (rhythm), pitch contour (melody, key- and octave-independent), and voicing (tonal vs noisy).
// Contours are compared with dynamic time warping, so being a bit early or late is fine.

import { RECORDING_RATE } from '../shared/constants';
import { resample } from '../shared/dsp';

export const SCORE_RATE = RECORDING_RATE;
const FRAME = 480; // 40 ms
const HOP = 240; // 20 ms
const MIN_F0 = 70;
const MAX_F0 = 1100;
const POINTS = 80; // contour length after time normalisation

export interface Features {
  /** loudness per point, 0..1 */
  env: number[];
  /** pitch per point in semitones, centred on the clip's median; null where there is no clear pitch */
  semis: (number | null)[];
  voicedRatio: number;
  /** note/clap start times, as fractions (0..1) of the active part */
  onsets: number[];
  /** seconds between the first and last loud moment */
  activeSec: number;
  peakDb: number;
}

export type Verdict = 'ok' | 'silent' | 'replay';

export interface Scored {
  score: number; // 0..100
  verdict: Verdict;
  parts: { melody: number | null; rhythm: number; length: number; tone: number };
}

/** YIN pitch estimate for one frame, in Hz, or null if it isn't clearly pitched. */
function yin(x: Float32Array, start: number, rate: number): number | null {
  const tauMin = Math.floor(rate / MAX_F0);
  const tauMax = Math.ceil(rate / MIN_F0);
  const w = FRAME - tauMax;
  if (w < 64) return null;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const diff = x[start + j]! - x[start + j + tau]!;
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  let running = 0;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau]!;
    cmnd[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
  }
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmnd[tau]! < 0.2) {
      while (tau + 1 < tauMax && cmnd[tau + 1]! < cmnd[tau]!) tau++;
      const a = cmnd[tau - 1]!;
      const b = cmnd[tau]!;
      const c = cmnd[tau + 1]!;
      const den = a - 2 * b + c;
      const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
      return rate / (tau + Math.max(-1, Math.min(1, shift)));
    }
  }
  return null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

/** Picks `n` evenly spaced items from a list. */
function stretch<T>(xs: T[], n: number): T[] {
  if (xs.length === 0) return [];
  return Array.from({ length: n }, (_, i) => xs[Math.min(xs.length - 1, Math.floor((i * xs.length) / n))]!);
}

export function extractFeatures(samples: Float32Array, rate: number): Features {
  const x = resample(samples, rate, SCORE_RATE);
  const frames = x.length >= FRAME ? Math.floor((x.length - FRAME) / HOP) + 1 : 0;
  const db: number[] = [];
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let j = 0; j < FRAME; j++) sum += x[i * HOP + j]! ** 2;
    db.push(10 * Math.log10(sum / FRAME + 1e-12));
  }
  const peakDb = db.length ? Math.max(...db) : -120;
  // Loud-enough threshold: below the peak, but clearly above the room's background noise.
  const noiseDb = [...db].sort((a, b) => a - b)[Math.floor(db.length * 0.1)] ?? -120;
  const floor = Math.max(peakDb - 30, Math.min(noiseDb + 10, peakDb - 12), -55);
  const first = db.findIndex(v => v > floor);
  let last = -1;
  for (let i = db.length - 1; i >= 0; i--)
    if (db[i]! > floor) {
      last = i;
      break;
    }
  if (first < 0 || last < first) return { env: [], semis: [], voicedRatio: 0, onsets: [], activeSec: 0, peakDb };

  const env: number[] = [];
  const pitch: (number | null)[] = [];
  const span = Math.max(1, last - first);
  const onsets: number[] = [];
  let quiet = true;
  for (let i = first; i <= last; i++) {
    const rel = db[i]! - peakDb;
    if (quiet && rel > -12) {
      onsets.push((i - first) / span);
      quiet = false;
    } else if (!quiet && rel < -20) quiet = true;
    env.push(Math.pow(10, (db[i]! - peakDb) / 20));
    pitch.push(db[i]! > peakDb - 25 ? yin(x, i * HOP, SCORE_RATE) : null);
  }
  const semisRaw = pitch.map(f => (f ? 12 * Math.log2(f / 440) : null));
  const voiced = semisRaw.filter((s): s is number => s !== null);
  const mid = median(voiced);
  const semis = semisRaw.map(s => (s === null ? null : s - mid));
  // Light smoothing of the envelope so tiny wobbles don't count.
  const smooth = env.map((_, i) => (env[i - 1] ?? env[i]!) * 0.25 + env[i]! * 0.5 + (env[i + 1] ?? env[i]!) * 0.25);
  return {
    env: stretch(smooth, POINTS),
    semis: stretch(semis, POINTS),
    voicedRatio: voiced.length / pitch.length,
    onsets,
    activeSec: ((last - first) * HOP + FRAME) / SCORE_RATE,
    peakDb,
  };
}

/** Dynamic time warping with a band; returns the mean cost along the best path. */
function dtw<T>(a: T[], b: T[], cost: (x: T, y: T) => number, band = 0.15): number {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 1;
  const w = Math.max(2, Math.ceil(Math.max(n, m) * band));
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const L = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  D[0]![0] = 0;
  for (let i = 1; i <= n; i++) {
    const centre = Math.round((i * m) / n);
    for (let j = Math.max(1, centre - w); j <= Math.min(m, centre + w); j++) {
      const c = cost(a[i - 1]!, b[j - 1]!);
      const opts: [number, number][] = [
        [D[i - 1]![j - 1]!, L[i - 1]![j - 1]!],
        [D[i - 1]![j]!, L[i - 1]![j]!],
        [D[i]![j - 1]!, L[i]![j - 1]!],
      ];
      let best = opts[0]!;
      for (const o of opts) if (o[0] < best[0]) best = o;
      D[i]![j] = best[0] + c;
      L[i]![j] = best[1] + 1;
    }
  }
  const total = D[n]![m]!;
  return Number.isFinite(total) ? total / L[n]![m]! : 1;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Same number of beats in the same places? Each beat is matched to the nearest beat in the other take. */
function onsetMatch(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const nearest = (xs: number[], ys: number[]) => xs.reduce((sum, x) => sum + Math.min(...ys.map(y => Math.abs(x - y))), 0) / xs.length;
  const place = clamp01(1 - (nearest(a, b) + nearest(b, a)) / 2 / 0.07);
  const count = clamp01(1 - (Math.abs(a.length - b.length) / Math.max(a.length, b.length)) * 1.5);
  return place * count;
}

/** A recording that is nearly the original waveform is a replayed clip, not a human. */
function looksLikeReplay(ref: Float32Array, imi: Float32Array): boolean {
  const start = (x: Float32Array) => {
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    return x.findIndex(v => Math.abs(v) > peak * 0.1);
  };
  const a0 = start(ref);
  const b0 = start(imi);
  if (a0 < 0 || b0 < 0) return false;
  const len = Math.min(ref.length - a0, imi.length - b0, SCORE_RATE * 3);
  if (len < SCORE_RATE * 0.2) return false;
  let best = 0;
  for (let lag = -24; lag <= 24; lag++) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < len; i += 2) {
      const a = ref[a0 + i]!;
      const b = imi[b0 + i + lag] ?? 0;
      ab += a * b;
      aa += a * a;
      bb += b * b;
    }
    if (aa > 0 && bb > 0) best = Math.max(best, Math.abs(ab) / Math.sqrt(aa * bb));
  }
  return best > 0.95;
}

export interface Reference {
  features: Features;
  samples: Float32Array; // at SCORE_RATE
}

export function makeReference(samples: Float32Array, rate: number): Reference {
  const s = resample(samples, rate, SCORE_RATE);
  return { samples: s, features: extractFeatures(s, SCORE_RATE) };
}

export function scoreImitation(ref: Reference, imitation: Float32Array, rate: number): Scored {
  const imiSamples = resample(imitation, rate, SCORE_RATE);
  const imi = extractFeatures(imiSamples, SCORE_RATE);
  const zero: Scored['parts'] = { melody: null, rhythm: 0, length: 0, tone: 0 };
  if (imi.peakDb < -50 || imi.activeSec < 0.12) return { score: 0, verdict: 'silent', parts: zero };
  if (looksLikeReplay(ref.samples, imiSamples)) return { score: 0, verdict: 'replay', parts: zero };
  const r = ref.features;

  const envelope = clamp01(1 - dtw(r.env, imi.env, (a, b) => Math.abs(a - b)) / 0.32);
  const rhythm = r.voicedRatio < 0.35 && r.onsets.length >= 2 ? 0.3 * envelope + 0.7 * onsetMatch(r.onsets, imi.onsets) : envelope;
  const ratio = Math.min(r.activeSec, imi.activeSec) / Math.max(r.activeSec, imi.activeSec);
  const length = clamp01((ratio - 0.35) / 0.5);
  const tone = clamp01(1 - Math.abs(r.voicedRatio - imi.voicedRatio) * 1.6);

  let raw: number;
  let melody: number | null = null;
  if (r.voicedRatio >= 0.35) {
    melody = clamp01(
      1 -
        dtw(r.semis, imi.semis, (a, b) => {
          if (a === null && b === null) return 0;
          if (a === null) return 0.3;
          if (b === null) return 0.6;
          let d = Math.abs(a - b);
          d = Math.min(d, Math.abs(d - 12)); // an octave slip in pitch tracking isn't the singer's fault
          return Math.min(d, 6) / 6;
        }) /
          0.42,
    );
    raw = 0.45 * melody + 0.3 * rhythm + 0.15 * length + 0.1 * tone;
  } else {
    raw = 0.8 * rhythm + 0.1 * length + 0.1 * tone;
  }
  // Spread the useful range out: a recognisable copy lands around 60-85, a great one above 90.
  const score = Math.round(100 * Math.pow(clamp01((raw - 0.3) / 0.62), 0.85));
  return { score, verdict: 'ok', parts: { melody, rhythm, length, tone } };
}
