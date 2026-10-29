// Turns a clip description into audio samples. The browser uses it to play the clip and the server uses it
// to score imitations, so both hear exactly the same sound. Pure math, no Web Audio.

export type Wave = 'sine' | 'triangle' | 'square' | 'saw' | 'noise';

export interface ClipEvent {
  /** start, seconds */
  t: number;
  /** length, seconds */
  d: number;
  wave: Wave;
  /** start frequency in Hz (ignored for noise) */
  f?: number;
  /** end frequency in Hz; the pitch glides from f to f2 */
  f2?: number;
  /** loudness 0..1 */
  a?: number;
  /** vibrato: [rate Hz, depth semitones] */
  vib?: [number, number];
}

export interface ClipSpec {
  events: ClipEvent[];
}

export function clipDuration(spec: ClipSpec): number {
  return spec.events.reduce((m, e) => Math.max(m, e.t + e.d), 0);
}

/** Small deterministic PRNG so noise sounds the same everywhere. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

export function renderClip(spec: ClipSpec, sampleRate: number): Float32Array {
  const total = Math.ceil((clipDuration(spec) + 0.05) * sampleRate);
  const out = new Float32Array(total);
  spec.events.forEach((e, idx) => {
    const start = Math.floor(e.t * sampleRate);
    const n = Math.max(1, Math.floor(e.d * sampleRate));
    const amp = e.a ?? 0.8;
    const attack = Math.min(0.012, e.d / 4) * sampleRate;
    const release = Math.min(e.wave === 'noise' ? 0.06 : 0.04, e.d / 3) * sampleRate;
    const f0 = e.f ?? 440;
    const f1 = e.f2 ?? f0;
    const noise = rng(idx * 7919 + 17);
    let phase = 0;
    let lp = 0;
    for (let i = 0; i < n && start + i < total; i++) {
      const k = i / n;
      let env = 1;
      if (i < attack) env = i / attack;
      else if (i > n - release) env = Math.max(0, (n - i) / release);
      if (e.wave === 'noise') env *= Math.exp(-3 * k); // claps and taps decay
      let s: number;
      if (e.wave === 'noise') {
        lp += 0.35 * (noise() - lp); // a little low-pass so it sounds like a clap, not hiss
        s = lp * 2.2;
      } else {
        let f = f0 * Math.pow(f1 / f0, k);
        if (e.vib) f *= Math.pow(2, (e.vib[1] * Math.sin(2 * Math.PI * e.vib[0] * (i / sampleRate))) / 12);
        phase += f / sampleRate;
        phase -= Math.floor(phase);
        switch (e.wave) {
          case 'sine':
            s = Math.sin(2 * Math.PI * phase);
            break;
          case 'triangle':
            s = 1 - 4 * Math.abs(phase - 0.5);
            break;
          case 'square':
            s = (phase < 0.5 ? 1 : -1) * 0.6;
            break;
          default:
            s = (2 * phase - 1) * 0.6;
        }
      }
      out[start + i]! += s * env * amp;
    }
  });
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i]! *= 0.8 / peak;
  return out;
}
