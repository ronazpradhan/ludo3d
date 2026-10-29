// Sample helpers used by the browser (to shrink a recording before sending it) and the server (to score it).

/** Linear resampling with a box low-pass when shrinking. Good enough for pitch and loudness. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to;
  let src = x;
  if (ratio > 1) {
    const w = Math.max(1, Math.round(ratio));
    src = new Float32Array(x.length);
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i]!;
      if (i >= w) acc -= x[i - w]!;
      src[i] = acc / Math.min(i + 1, w);
    }
  }
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? src[j] ?? 0) * f;
  }
  return out;
}

export function floatToInt16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767);
  return out;
}

export function int16ToFloat(x: Int16Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i]! / 32768;
  return out;
}
