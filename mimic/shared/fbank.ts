// Kaldi-style log mel filterbank features, as lhotse's `Fbank(FbankConfig(num_filters=80, dither=0,
// snip_edges=False))` computes them: the input the ZIPA phone recogniser was trained on.
// 16 kHz mono floats in [-1, 1] → one 80-value row every 10 ms.

export const FBANK_RATE = 16_000;
export const FBANK_BINS = 80;
const WIN = 400; // 25 ms
const HOP = 160; // 10 ms
const NFFT = 512;
const PREEMPH = 0.97;
const LOW_HZ = 20;
const HIGH_HZ = FBANK_RATE / 2 - 400;
const EPS = 1.1920928955078125e-7; // float32 epsilon

const mel = (hz: number) => 1127 * Math.log(1 + hz / 700);

// Povey window: a Hann window raised to 0.85.
const WINDOW = Float64Array.from({ length: WIN }, (_, n) => Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (WIN - 1)), 0.85));

// Triangular mel filters over the FFT bins (the Nyquist bin gets no weight, as in torchaudio).
const FILTERS: { start: number; weights: Float64Array }[] = (() => {
  const lo = mel(LOW_HZ);
  const delta = (mel(HIGH_HZ) - lo) / (FBANK_BINS + 1);
  const binHz = FBANK_RATE / NFFT;
  return Array.from({ length: FBANK_BINS }, (_, m) => {
    const left = lo + m * delta;
    const center = left + delta;
    const right = center + delta;
    const w: number[] = [];
    let start = -1;
    for (let k = 0; k < NFFT / 2; k++) {
      const f = mel(k * binHz);
      const v = Math.max(0, Math.min((f - left) / (center - left), (right - f) / (right - center)));
      if (v > 0) {
        if (start < 0) start = k;
        w[k - start] = v;
      } else if (start >= 0) break;
    }
    return { start: Math.max(0, start), weights: Float64Array.from(w, x => x ?? 0) };
  });
})();

// In-place radix-2 FFT.
const BITREV = (() => {
  const r = new Uint16Array(NFFT);
  for (let i = 0, bits = Math.log2(NFFT); i < NFFT; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    r[i] = y;
  }
  return r;
})();
function fft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < NFFT; i++) {
    const j = BITREV[i]!;
    if (j > i) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= NFFT; size *= 2) {
    const half = size / 2;
    const step = (-2 * Math.PI) / size;
    for (let i = 0; i < NFFT; i += size)
      for (let k = 0; k < half; k++) {
        const c = Math.cos(step * k);
        const s = Math.sin(step * k);
        const a = i + k;
        const b = a + half;
        const tr = re[b]! * c - im[b]! * s;
        const ti = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a]! += tr;
        im[a]! += ti;
      }
  }
}

/** Reflects an index into 0..n-1 without repeating the edge sample (torch's "reflect" padding). */
const reflect = (i: number, n: number): number => {
  const period = 2 * (n - 1);
  let j = Math.abs(i) % period;
  if (j >= n) j = period - j;
  return j;
};

/** Log mel filterbank, frames × 80, row-major. */
export function fbank(x: Float32Array): { data: Float32Array; frames: number } {
  const n = x.length;
  const frames = n < 2 ? 0 : Math.floor((n + HOP / 2) / HOP);
  const data = new Float32Array(frames * FBANK_BINS);
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const frame = new Float64Array(WIN);
  const offset = -Math.floor((WIN - HOP) / 2);
  for (let t = 0; t < frames; t++) {
    let mean = 0;
    for (let i = 0; i < WIN; i++) {
      frame[i] = x[reflect(offset + t * HOP + i, n)]!;
      mean += frame[i]!;
    }
    mean /= WIN;
    for (let i = 0; i < WIN; i++) frame[i]! -= mean;
    for (let i = WIN - 1; i > 0; i--) frame[i]! -= PREEMPH * frame[i - 1]!;
    frame[0]! -= PREEMPH * frame[0]!;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < WIN; i++) re[i] = frame[i]! * WINDOW[i]!;
    fft(re, im);
    for (let m = 0; m < FBANK_BINS; m++) {
      const { start, weights } = FILTERS[m]!;
      let e = 0;
      for (let k = 0; k < weights.length; k++) e += weights[k]! * (re[start + k]! ** 2 + im[start + k]! ** 2);
      data[t * FBANK_BINS + m] = Math.log(Math.max(e, EPS));
    }
  }
  return { data, frames };
}
