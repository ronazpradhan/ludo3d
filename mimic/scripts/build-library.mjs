// Builds Mimic's sound library into dist/mimic (runs as part of `npm run build`).
//
//   mimic/sounds/sources.json         categories (name, emoji, hint) and their sounds on myinstants.com;
//                                     refresh with scripts/fetch-myinstants.mjs. The audio is downloaded here,
//                                     at build time, into mimic/sounds/.cache (never committed).
//   mimic/sounds/<category>/*.mp3     extra sounds of your own (.mp3 or .wav), one folder per category; the file
//                                     name is the sound's name. An optional category.json in the folder sets
//                                     { "label", "emoji", "hint" }. A folder named like an existing category
//                                     (e.g. memes) adds to it.
//
// Each recording is decoded, mixed to mono, trimmed of silence at both ends, capped at MAX_SEC and
// normalised. The server scores against a 12 kHz copy (library/refs/<id>.pcm); browsers play a 22 kHz WAV
// (client/sounds/<id>.wav), so everyone hears exactly the processed clip the scores are based on.
// A category shows up in the game only once it has at least one sound.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_SEC = 6;
/** Shorter than this is too quick for anyone to copy fairly. */
export const MIN_SEC = 0.6;
const SCORE_RATE = 12_000;
const PLAY_RATE = 22_050;
const AUDIO = /\.(mp3|wav)$/i;

function resample(x, from, to) {
  if (from === to) return x;
  const ratio = from / to;
  let src = x;
  if (ratio > 1) {
    const w = Math.max(1, Math.round(ratio));
    src = new Float32Array(x.length);
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i];
      if (i >= w) acc -= x[i - w];
      src[i] = acc / Math.min(i + 1, w);
    }
  }
  const out = new Float32Array(Math.floor(x.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? src[j] ?? 0) * f;
  }
  return out;
}

/** 16-bit, 24-bit, 32-bit int or 32-bit float PCM WAV -> { channels, rate }. */
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let p = 12;
  let fmt = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), ch: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data' && fmt) {
      const { ch, bits, format } = fmt;
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (bytes * ch));
      const channels = Array.from({ length: ch }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < ch; c++) {
          const o = body + (i * ch + c) * bytes;
          let v;
          if (format === 3 && bits === 32) v = buf.readFloatLE(o);
          else if (bits === 16) v = buf.readInt16LE(o) / 32768;
          else if (bits === 24) v = buf.readIntLE(o, 3) / 8388608;
          else if (bits === 32) v = buf.readInt32LE(o) / 2147483648;
          else if (bits === 8) v = (buf.readUInt8(o) - 128) / 128;
          else throw new Error(`unsupported WAV: ${bits}-bit`);
          channels[c][i] = v;
        }
      return { channels, rate: fmt.rate };
    }
    p = body + size + (size % 2);
  }
  throw new Error('WAV has no audio data');
}

async function decodeMp3(buf) {
  const { MPEGDecoder } = await import('mpg123-decoder');
  const d = new MPEGDecoder();
  await d.ready;
  try {
    const { channelData, sampleRate } = d.decode(new Uint8Array(buf));
    if (!channelData.length || !channelData[0].length) throw new Error('no audio decoded');
    return { channels: channelData, rate: sampleRate };
  } finally {
    d.free();
  }
}

function writeWav(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

/** Mono, silence trimmed at both ends, at most MAX_SEC, peak at 0.9. */
function prepare({ channels, rate }) {
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
  let peak = 0;
  for (const v of mono) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-4) throw new Error('the file is silent');
  const gate = peak * 0.03;
  let a = 0;
  while (a < n && Math.abs(mono[a]) < gate) a++;
  let b = n - 1;
  while (b > a && Math.abs(mono[b]) < gate) b--;
  a = Math.max(0, a - Math.round(rate * 0.02));
  b = Math.min(n, b + Math.round(rate * 0.05), a + Math.round(rate * MAX_SEC));
  const cut = mono.slice(a, b);
  for (let i = 0; i < cut.length; i++) cut[i] = (cut[i] / peak) * 0.9;
  return { samples: cut, rate, trimmed: (n - (b - a)) / rate > MAX_SEC };
}

const slug = s =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'sound';

const nameOf = file =>
  path
    .basename(file, path.extname(file))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || 'Sound';

/** Downloads a URL into the cache once; later builds reuse the file. */
async function cached(url, cacheDir) {
  const file = path.join(cacheDir, slug(url.replace(/^https?:\/\/[^/]+/, '')) + path.extname(new URL(url).pathname));
  if (existsSync(file)) return readFileSync(file);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Mimic build)' } });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5_000_000) throw new Error('file too big');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, buf);
  return buf;
}

// The same sound is often uploaded many times under different names (and into different categories), so
// each clip gets a fingerprint: its spectrum, 12 log-spaced bands every 40 ms.
const FP_N = 512;
const FP_HOP = 480;
const FP_BANDS = 12;
const FP_EDGES = Array.from({ length: FP_BANDS + 1 }, (_, i) => Math.round(2 * Math.pow(FP_N / 4, i / FP_BANDS)));
/** Clips this alike (and about as long) are the same sound. Different takes of one catchphrase stay below it. */
const SAME_SOUND = 0.95;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k);
        const s = Math.sin(a * k);
        const p = i + k;
        const q = p + len / 2;
        const tr = re[q] * c - im[q] * s;
        const ti = re[q] * s + im[q] * c;
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
      }
  }
}

function fingerprint(x) {
  const out = [];
  const re = new Float64Array(FP_N);
  const im = new Float64Array(FP_N);
  for (let s = 0; s + FP_N <= x.length; s += FP_HOP) {
    for (let t = 0; t < FP_N; t++) {
      re[t] = x[s + t];
      im[t] = 0;
    }
    fft(re, im);
    for (let b = 0; b < FP_BANDS; b++) {
      let e = 0;
      for (let k = FP_EDGES[b]; k < Math.max(FP_EDGES[b] + 1, FP_EDGES[b + 1]); k++) e += re[k] * re[k] + im[k] * im[k];
      out.push(Math.log10(e + 1e-6));
    }
  }
  return out;
}

/** How alike two fingerprints are, -1..1, allowing them to be up to 3 frames out of step. */
function alike(a, b) {
  let best = -1;
  for (let lag = -3; lag <= 3; lag++) {
    const sh = lag * FP_BANDS;
    let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, k = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + sh;
      if (j < 0 || j >= b.length) continue;
      sa += a[i];
      sb += b[j];
      sab += a[i] * b[j];
      saa += a[i] * a[i];
      sbb += b[j] * b[j];
      k++;
    }
    if (k < FP_BANDS * 5) continue;
    best = Math.max(best, (sab - (sa * sb) / k) / Math.sqrt((saa - (sa * sa) / k) * (sbb - (sb * sb) / k) || 1));
  }
  return best;
}

/** Runs `fn` over `items` with at most `n` at a time, keeping the order of results. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export async function buildLibrary({ soundsDir, outDir, publicDir, cacheDir = path.join(soundsDir, '.cache'), log = console.log }) {
  const sourcesFile = path.join(soundsDir, 'sources.json');
  const sources = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, 'utf8')) : [];
  mkdirSync(path.join(outDir, 'refs'), { recursive: true });
  mkdirSync(path.join(publicDir, 'sounds'), { recursive: true });

  const clips = [];
  const ids = new Set();
  const prints = [];
  const metas = sources.map(({ sounds: _s, ...meta }) => meta);
  const known = new Set(metas.map(m => m.id));

  /** Decode, trim, write the scoring and playback copies, and add the clip. */
  const add = (category, name, label, buf, isWav) =>
    (async () => {
      const decoded = isWav ? decodeWav(buf) : await decodeMp3(buf);
      const { samples, rate, trimmed } = prepare(decoded);
      if (samples.length / rate < MIN_SEC) throw new Error(`shorter than ${MIN_SEC}s, too quick to copy`);
      const ref = resample(samples, rate, SCORE_RATE);
      const fp = fingerprint(ref);
      const duration = samples.length / rate;
      const twin = prints.find(p => Math.abs(p.duration - duration) <= 0.4 && alike(p.fp, fp) >= SAME_SOUND);
      if (twin) throw new Error(`the same sound as ${twin.id}`);
      const base = `${category}-${slug(name)}`;
      let id = base;
      for (let k = 2; ids.has(id); k++) id = `${base}-${k}`;
      ids.add(id);
      prints.push({ id, duration, fp });
      const pcm = Buffer.alloc(ref.length * 2);
      for (let i = 0; i < ref.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ref[i])) * 32767), i * 2);
      writeFileSync(path.join(outDir, 'refs', `${id}.pcm`), pcm);
      writeWav(path.join(publicDir, 'sounds', `${id}.wav`), resample(samples, rate, PLAY_RATE), PLAY_RATE);
      clips.push({ id, name: name.slice(0, 40) || 'Sound', category, audio: `sounds/${id}.wav`, duration: +(samples.length / rate).toFixed(3) });
      if (trimmed) log(`  ${label}: longer than ${MAX_SEC}s, only the first ${MAX_SEC}s is used`);
    })().catch(e => log(`  skipped ${label}: ${e.message}`));

  // Your own files dropped into mimic/sounds/<category>/. They go first, so a sound that is also on
  // myinstants stays in your folder and the downloaded copy is the one left out.
  for (const dir of readdirSync(soundsDir).sort()) {
    const full = path.join(soundsDir, dir);
    if (dir.startsWith('.') || !statSync(full).isDirectory()) continue;
    const category = slug(dir);
    if (!known.has(category)) {
      known.add(category);
      // Optional category.json in the folder: { "label": "...", "emoji": "...", "hint": "..." }.
      const metaFile = path.join(full, 'category.json');
      let own = {};
      try {
        if (existsSync(metaFile)) own = JSON.parse(readFileSync(metaFile, 'utf8'));
      } catch (e) {
        log(`  ${dir}/category.json ignored: ${e.message}`);
      }
      const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
      metas.push({
        id: category,
        label: text(own.label, 30) ?? dir.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()),
        emoji: text(own.emoji, 8) ?? '🔊',
        hint: text(own.hint, 60) ?? 'Copy the sound',
      });
    }
    for (const file of readdirSync(full).sort())
      if (AUDIO.test(file)) await add(category, nameOf(file), `${dir}/${file}`, readFileSync(path.join(full, file)), /\.wav$/i.test(file));
  }

  // Sounds listed in sources.json (from myinstants), downloaded at build time.
  for (const cat of sources) {
    const files = await pool(cat.sounds, 6, s => cached(s.url, cacheDir).catch(e => (log(`  skipped ${cat.id}/${s.name}: ${e.message}`), null)));
    for (const [i, s] of cat.sounds.entries()) if (files[i]) await add(cat.id, s.name, `${cat.id}/${s.name}`, files[i], /\.wav$/i.test(s.url));
  }

  const counts = new Map();
  for (const c of clips) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  const categories = metas.filter(m => counts.get(m.id)).map(m => ({ ...m, count: counts.get(m.id) }));
  writeFileSync(path.join(outDir, 'library.json'), JSON.stringify({ categories, clips }));
  return { categories, clips };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { categories, clips } = await buildLibrary({
    soundsDir: path.join(root, 'sounds'),
    outDir: path.join(root, '..', 'dist', 'mimic', 'library'),
    publicDir: path.join(root, '..', 'dist', 'mimic', 'client'),
  });
  console.log(`Mimic library: ${clips.length} sounds in ${categories.length} categories (${categories.map(c => `${c.label} ${c.count}`).join(', ')})`);
}

