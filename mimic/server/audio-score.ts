// How close is an imitation to the original sound? Runs on the server only, so the score can't be faked by
// a modified browser sending a number. Both sounds go through the same feature extraction:
//   voice tone   what it sounds like: vowels, hiss, scream, buzz (MFCCs, the standard speech-recognition features)
//   rhythm       loudness over time and where the beats/syllables fall
//   melody       pitch going up and down (key- and octave-independent), for sounds with a clear pitch
//   length       how long the sound lasts
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
  /** share of the active part that is quiet: high for claps and knocks, low for a held scream */
  quietRatio: number;
  /** seconds between the first and last loud moment */
  activeSec: number;
  peakDb: number;
  /** seconds that stand clearly above the room's background noise (a voice right at the mic does; hiss doesn't) */
  loudSec: number;
  /** voice tone per point: 12 mel-cepstral coefficients, mean-normalised (so mic and volume don't matter) */
  mfcc: number[][];
}

export type Verdict = 'ok' | 'silent' | 'replay';

export interface Scored {
  score: number; // 0..100
  verdict: Verdict;
  /** each 0..1; melody is null for sounds without a clear pitch */
  parts: { tone: number; rhythm: number; melody: number | null; length: number };
}

// ---------- voice tone (MFCC) ----------
const NFFT = 512;
const MEL_BANDS = 26;
const CEPS = 12;
const HANN = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1);
/** Triangular mel filters from 80 Hz to 5.5 kHz, as [first bin, weights]. */
const MEL: [number, Float32Array][] = (() => {
  const lo = hzToMel(80);
  const hi = hzToMel(5500);
  const edges = Array.from({ length: MEL_BANDS + 2 }, (_, i) => Math.floor(((NFFT + 1) * melToHz(lo + ((hi - lo) * i) / (MEL_BANDS + 1))) / SCORE_RATE));
  return Array.from({ length: MEL_BANDS }, (_, m) => {
    const [a, b, c] = [edges[m]!, edges[m + 1]!, edges[m + 2]!];
    const w = new Float32Array(c - a + 1);
    for (let k = a; k <= c; k++) w[k - a] = k <= b ? (k - a) / Math.max(1, b - a) : (c - k) / Math.max(1, c - b);
    return [a, w] as [number, Float32Array];
  });
})();
const DCT = Array.from({ length: CEPS }, (_, k) => Float32Array.from({ length: MEL_BANDS }, (_, n) => Math.cos((Math.PI * (k + 1) * (n + 0.5)) / MEL_BANDS)));

/** Power spectrum of one windowed frame (in-place radix-2 FFT). */
function powerSpectrum(x: Float32Array, start: number): Float32Array {
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  for (let i = 0; i < FRAME; i++) re[i] = (x[start + i] ?? 0) * HANN[i]!;
  for (let i = 1, j = 0; i < NFFT; i++) {
    let bit = NFFT >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= NFFT; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < NFFT; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a]! += tr;
        im[a]! += ti;
      }
  }
  const p = new Float32Array(NFFT / 2 + 1);
  for (let k = 0; k <= NFFT / 2; k++) p[k] = re[k]! * re[k]! + im[k]! * im[k]!;
  return p;
}

function mfccOf(x: Float32Array, start: number): number[] {
  const p = powerSpectrum(x, start);
  const logMel = MEL.map(([a, w]) => {
    let e = 0;
    for (let k = 0; k < w.length; k++) e += (p[a + k] ?? 0) * w[k]!;
    return Math.log(e + 1e-9);
  });
  return DCT.map(row => row.reduce((sum, c, n) => sum + c * logMel[n]!, 0));
}

/** Averages a list of vectors down to `n` evenly spaced points. */
function stretchVec(xs: number[][], n: number): number[][] {
  if (!xs.length) return [];
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i * xs.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * xs.length) / n));
    const out = new Array<number>(CEPS).fill(0);
    for (let j = a; j < b; j++) for (let k = 0; k < CEPS; k++) out[k]! += xs[j]![k]! / (b - a);
    return out;
  });
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

/** How far above the room's noise a sound must be to count as someone making it. The mic's auto-gain turns
 * silence into loud hiss, and a voice from across the room only just clears the noise; a real attempt at
 * the mic is 25+ dB over it. */
const LOUD_OVER_NOISE_DB = 16;
/** A take needs at least this much clear sound to be scored at all: a couple of claps is enough, a hiss never is. */
const MIN_LOUD_SEC = 0.08;

/** A sound that fills the whole take at an even level (a held note, a siren) has no quiet moment to measure the
 * room against. It counts when it has a clear pitch: the hiss of an auto-gain mic in a silent room has none. */
function steadyPitched(db: number[], voicedRatio: number): boolean {
  const mid = median(db);
  return voicedRatio >= 0.6 && db.filter(v => Math.abs(v - mid) < 8).length >= 0.9 * db.length;
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
  // The quietest moments: even a take that is sound almost throughout has a breath of quiet at the start or end.
  const quietestDb = [...db].sort((a, b) => a - b)[Math.floor(db.length * 0.03)] ?? -120;
  const floor = Math.max(peakDb - 30, Math.min(noiseDb + 10, peakDb - 12), -55);
  const first = db.findIndex(v => v > floor);
  let last = -1;
  for (let i = db.length - 1; i >= 0; i--)
    if (db[i]! > floor) {
      last = i;
      break;
    }
  if (first < 0 || last < first) return { env: [], semis: [], voicedRatio: 0, onsets: [], quietRatio: 0, activeSec: 0, peakDb, loudSec: 0, mfcc: [] };

  const env: number[] = [];
  const pitch: (number | null)[] = [];
  const ceps: number[][] = [];
  const span = Math.max(1, last - first);
  const onsets: number[] = [];
  // A beat starts when it gets loud and ends when it falls back towards the room's noise.
  const quietDb = Math.max(peakDb - 20, Math.min(floor + 4, peakDb - 10));
  let quiet = true;
  for (let i = first; i <= last; i++) {
    if (quiet && db[i]! > peakDb - 9) {
      onsets.push((i - first) / span);
      quiet = false;
    } else if (!quiet && db[i]! < quietDb) quiet = true;
    env.push(Math.pow(10, (db[i]! - peakDb) / 20));
    pitch.push(db[i]! > peakDb - 25 ? yin(x, i * HOP, SCORE_RATE) : null);
    if (db[i]! > floor) ceps.push(mfccOf(x, i * HOP));
  }
  // Mean-normalise the cepstra so the microphone and room colour don't count, only the shape of the sound.
  const means = new Array<number>(CEPS).fill(0);
  for (const c of ceps) for (let k = 0; k < CEPS; k++) means[k]! += c[k]! / ceps.length;
  const mfcc = stretchVec(
    ceps.map(c => c.map((v, k) => v - means[k]!)),
    POINTS,
  );
  const semisRaw = pitch.map(f => (f ? 12 * Math.log2(f / 440) : null));
  const voiced = semisRaw.filter((s): s is number => s !== null);
  // Centre on the average pitch: a median flips between the notes of a two-tone sound and shifts the whole line.
  const mid = voiced.length ? voiced.reduce((a, b) => a + b, 0) / voiced.length : 0;
  const semis = semisRaw.map(s => (s === null ? null : s - mid));
  // Light smoothing of the envelope so tiny wobbles don't count.
  const smooth = env.map((_, i) => (env[i - 1] ?? env[i]!) * 0.25 + env[i]! * 0.5 + (env[i + 1] ?? env[i]!) * 0.25);
  return {
    env: stretch(smooth, POINTS),
    semis: stretch(semis, POINTS),
    voicedRatio: voiced.length / pitch.length,
    onsets,
    quietRatio: env.filter((_, i) => db[first + i]! < quietDb).length / env.length,
    activeSec: ((last - first) * HOP + FRAME) / SCORE_RATE,
    peakDb,
    loudSec: steadyPitched(db, voiced.length / pitch.length) ? ((last - first) * HOP + FRAME) / SCORE_RATE : (db.filter(v => v > quietestDb + LOUD_OVER_NOISE_DB).length * HOP) / SCORE_RATE,
    mfcc,
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

/** Distance between two cepstral vectors (how different two moments sound). */
function cepDistance(a: number[], b: number[]): number {
  let d = 0;
  for (let k = 0; k < CEPS; k++) d += (a[k]! - b[k]!) ** 2;
  return Math.sqrt(d);
}
export let TONE_SCALE = 45;
export const setToneScale = (v: number): void => void (TONE_SCALE = v);

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
  /** How a clean copy of this exact sound compares (raw 0..1): the "great" mark for this sound. */
  good: number;
  /** How an unrelated hum or babble compares: the "not even close" mark for this sound. */
  bad: number;
}

/** A clean copy of the sound by someone else: a little faster and higher, with a bit of room noise. */
function cleanCopy(x: Float32Array): Float32Array {
  const fast = resample(x, SCORE_RATE * 1.07, SCORE_RATE);
  let seed = 11;
  return fast.map(v => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return v * 0.8 + ((seed / 0x7fffffff) * 2 - 1) * 0.01;
  });
}

/** Sounds that have nothing to do with the clip but are as long: a steady hum, and syllable-like babble. */
function unrelated(sec: number): Float32Array[] {
  const n = Math.max(SCORE_RATE * 0.3, Math.round(sec * SCORE_RATE));
  let seed = 5;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const hum = Float32Array.from({ length: n }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 150 * i) / SCORE_RATE + 0.3 * Math.sin((2 * Math.PI * 5 * i) / SCORE_RATE)));
  let lp = 0;
  const babble = Float32Array.from({ length: n }, (_, i) => {
    lp += 0.3 * (noise() - lp);
    const syll = Math.max(0, Math.sin((2 * Math.PI * 4 * i) / SCORE_RATE));
    return lp * syll * 1.5 + 0.25 * syll * Math.sin((2 * Math.PI * 220 * i) / SCORE_RATE);
  });
  return [hum, babble];
}

export function makeReference(samples: Float32Array, rate: number): Reference {
  const s = resample(samples, rate, SCORE_RATE);
  const ref: Reference = { samples: s, features: extractFeatures(s, SCORE_RATE), good: 1, bad: 0 };
  // Calibrate against this very sound, so sounds that are hard to measure (screams, songs with music
  // behind them, tiny pops) don't cost players points: scores land between these two marks.
  const good = compare(ref, extractFeatures(cleanCopy(s), SCORE_RATE)).raw;
  const bads = unrelated(ref.features.activeSec).map(u => compare(ref, extractFeatures(u, SCORE_RATE)).raw);
  const bad = bads.reduce((x, y) => x + y, 0) / bads.length;
  ref.good = Math.max(good, bad + 0.15);
  ref.bad = bad;
  return ref;
}

/** Raw similarity 0..1 and its parts, before calibration. */
function compare(ref: Reference, imi: Features): { raw: number; parts: Scored['parts'] } {
  const r = ref.features;
  const envelope = clamp01(1 - dtw(r.env, imi.env, (a, b) => Math.abs(a - b)) / 0.32);
  // Counting beats only makes sense for sounds with real gaps (claps, knocks), not a held scream that wobbles.
  const beaty = r.voicedRatio < 0.35 && r.onsets.length >= 2 && r.quietRatio >= 0.25;
  const rhythm = beaty ? 0.3 * envelope + 0.7 * onsetMatch(r.onsets, imi.onsets) : envelope;
  // A little slack so a short sound isn't judged "way too long" over a fraction of a second.
  const ratio = (Math.min(r.activeSec, imi.activeSec) + 0.3) / (Math.max(r.activeSec, imi.activeSec) + 0.3);
  const length = clamp01((ratio - 0.35) / 0.5);
  const tone = clamp01(1 - dtw(r.mfcc, imi.mfcc, cepDistance) / TONE_SCALE);
  let melody: number | null = null;
  let raw: number;
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
    raw = 0.35 * tone + 0.25 * rhythm + 0.3 * melody + 0.1 * length;
  } else {
    raw = 0.45 * tone + 0.45 * rhythm + 0.1 * length;
  }
  return { raw, parts: { tone, rhythm, melody, length } };
}

export function scoreImitation(ref: Reference, imitation: Float32Array, rate: number): Scored {
  const imiSamples = resample(imitation, rate, SCORE_RATE);
  const imi = extractFeatures(imiSamples, SCORE_RATE);
  const zero: Scored['parts'] = { tone: 0, rhythm: 0, melody: null, length: 0 };
  if (imi.peakDb < -50 || imi.activeSec < 0.12 || imi.loudSec < MIN_LOUD_SEC) return { score: 0, verdict: 'silent', parts: zero };
  if (looksLikeReplay(ref.samples, imiSamples)) return { score: 0, verdict: 'replay', parts: zero };
  const { raw, parts } = compare(ref, imi);
  return { score: humanScore((raw - ref.bad) / (ref.good - ref.bad)), verdict: 'ok', parts };
}

/**
 * Turns where a take sits between "an unrelated sound" (0) and "a perfect machine copy" (1) into points.
 * No human voice gets close to a machine copy, so the scale is generous at the top: a good human copy
 * (about 0.6-0.8) scores 85-100 and the best ones hit 100, a rough one 55-80, another sound stays under
 * about 30. Every real attempt still earns what it got; nothing is cut to 0 for being far off.
 */
export function humanScore(norm: number): number {
  const s = clamp01((norm - 0.1) / 0.7);
  return Math.max(1, Math.round(100 * (1 - Math.pow(1 - s, 1.6))));
}
