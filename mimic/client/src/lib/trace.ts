// Live pitch and loudness of the player's voice while recording, for drawing on the audiograph.
// Only for display: the server does the real scoring from the full take.
import { RECORDING_RATE } from '../../../shared/constants';
import { resample } from '../../../shared/dsp';

export interface TracePoint {
  /** seconds since recording started */
  t: number;
  /** loudness 0..1 */
  level: number;
  /** pitch in semitones from A4, or null if not clearly pitched */
  semis: number | null;
}

const BLOCK = 480; // 40 ms at RECORDING_RATE
const MIN_LAG = Math.floor(RECORDING_RATE / 1100);
const MAX_LAG = Math.ceil(RECORDING_RATE / 70);

function pitchOf(x: Float32Array): number | null {
  const w = x.length - MAX_LAG;
  let energy = 0;
  for (let i = 0; i < w; i++) energy += x[i]! * x[i]!;
  if (energy < 1e-4) return null;
  let best = 0;
  let bestLag = 0;
  for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
    let ab = 0;
    let bb = 0;
    for (let i = 0; i < w; i++) {
      ab += x[i]! * x[i + lag]!;
      bb += x[i + lag]! * x[i + lag]!;
    }
    const r = ab / Math.sqrt(energy * bb + 1e-12);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return best > 0.75 ? RECORDING_RATE / bestLag : null;
}

export class LiveTrace {
  private raw: number[] = [];
  private buf: number[] = [];
  private seconds = 0;
  readonly points: TracePoint[] = [];

  push(samples: Float32Array, rate: number): boolean {
    for (const v of samples) this.raw.push(v);
    // Resample in ~40 ms batches so chunk edges don't matter much.
    const batch = Math.round(rate * 0.04);
    let added = false;
    while (this.raw.length >= batch) {
      const part = resample(Float32Array.from(this.raw.splice(0, batch)), rate, RECORDING_RATE);
      for (const v of part) this.buf.push(v);
      while (this.buf.length >= BLOCK) {
        const block = Float32Array.from(this.buf.splice(0, BLOCK));
        let sum = 0;
        for (const v of block) sum += v * v;
        const rms = Math.sqrt(sum / BLOCK);
        const level = Math.min(1, rms * 6);
        const f = level > 0.05 ? pitchOf(block) : null;
        this.points.push({ t: this.seconds, level, semis: f ? 12 * Math.log2(f / 440) : null });
        this.seconds += BLOCK / RECORDING_RATE;
        added = true;
      }
    }
    return added;
  }
}
