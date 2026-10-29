// The similarity scorer and the clip library.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MAX_TAKE_SEC, RECORDING_RATE } from '../shared/constants';
import { floatToInt16, int16ToFloat, resample } from '../shared/dsp';
import { type ClipSpec, renderClip, type Wave } from '../shared/synth';
import { buildLibrary } from '../scripts/build-library.mjs';
import type { CategoryInfo, Clip } from '../shared/types';
import { makeReference, scoreImitation } from '../server/audio-score';
import { eligibleClips, maxTakeSec, MIN_CLIPS, pickClip, referenceFor, validateLibrary } from '../server/sounds';
import { clips, imitate, library, specOf } from './helpers';

const R = RECORDING_RATE;
const notes = (fs: number[], gap = 0.28): ClipSpec => ({ events: fs.map((f, i) => ({ t: i * gap, d: gap - 0.03, wave: 'triangle' as Wave, f })) });
const claps = (ts: number[]): ClipSpec => ({ events: ts.map(t => ({ t, d: 0.11, wave: 'noise' as Wave })) });
const samples: Record<string, ClipSpec> = {
  melody: notes([392, 440, 494, 523, 494]),
  melody2: notes([523, 392, 330, 262], 0.3),
  siren: { events: [{ t: 0, d: 0.6, wave: 'sine', f: 400, f2: 800 }, { t: 0.6, d: 0.6, wave: 'sine', f: 800, f2: 400 }] },
  rhythm: claps([0, 0.25, 0.5, 1.0, 1.25]),
  rhythm2: claps([0, 0.5, 0.65, 0.8, 1.3]),
  boing: { events: [{ t: 0, d: 0.6, wave: 'square', f: 600, f2: 150, vib: [8, 0.5] }] },
};
const ref = (spec: ClipSpec) => makeReference(renderClip(spec, 44100), 44100);
const score = (spec: ClipSpec, take: Float32Array) => scoreImitation(ref(spec), take, R).score;

// These copies change the timbre completely (a sine "voice" copying a square-wave beep), which the voice-tone
// part rightly notices, so the bars are lower than for a person copying a real clip.
describe('similarity scoring', () => {
  for (const [name, spec] of Object.entries(samples)) {
    it(`${name}: a good copy (other voice, an octave lower, slower, noisy room) scores high`, () => {
      expect(score(spec, imitate(spec))).toBeGreaterThanOrEqual(50);
    });
    it(`${name}: a sloppy copy still scores decently`, () => {
      expect(score(spec, imitate(spec, 0.6, 1.4, 'saw', 0.08))).toBeGreaterThanOrEqual(35);
    });
  }

  it('scores a different sound well below a good copy', () => {
    for (const [name, spec] of Object.entries(samples)) {
      const good = score(spec, imitate(spec));
      for (const [other, o] of Object.entries(samples)) if (other !== name) expect(score(spec, imitate(o)), `${other} as ${name}`).toBeLessThanOrEqual(good - 25);
    }
  });

  it('tells two different rhythms apart', () => {
    expect(score(samples.rhythm!, imitate(samples.rhythm2!))).toBeLessThan(50);
  });

  it('is calibrated per sound: a clean copy of any sound scores high, an unrelated hum low', () => {
    for (const [name, spec] of Object.entries(samples)) {
      const clean = renderClip(spec, R * 1.05).map(v => v * 0.7); // same sound, a bit lower and quieter
      const hum = Float32Array.from({ length: R * 1.5 }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 140 * i) / R));
      expect(score(spec, clean), name).toBeGreaterThanOrEqual(80);
      expect(score(spec, hum), name).toBeLessThanOrEqual(35);
    }
  });

  it('gives a far-off attempt a low score, not 0', () => {
    const s = score(samples.melody!, imitate(samples.rhythm!));
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(40);
  });

  it('gives silence 0 and flags it', () => {
    expect(scoreImitation(ref(samples.melody!), new Float32Array(R * 2), R)).toMatchObject({ score: 0, verdict: 'silent' });
  });

  it('refuses the original clip played back as a take', () => {
    for (const k of ['melody', 'siren', 'boing'])
      expect(scoreImitation(ref(samples[k]!), renderClip(samples[k]!, R), R)).toMatchObject({ score: 0, verdict: 'replay' });
  });

  it('is unaffected by the 16-bit PCM round trip the network uses', () => {
    const take = imitate(samples.melody!);
    expect(Math.abs(score(samples.melody!, int16ToFloat(floatToInt16(take))) - score(samples.melody!, take))).toBeLessThanOrEqual(1);
  });

  it('resamples to the right length', () => {
    expect(resample(new Float32Array(48_000), 48_000, R).length).toBe(R);
    expect(resample(new Float32Array(44_100), 44_100, R).length).toBe(R);
  });
});

describe('clip library', () => {
  it(`has at least ${MIN_CLIPS} valid clips, and every listed category has sounds`, () => {
    expect(clips.length).toBeGreaterThanOrEqual(MIN_CLIPS);
    for (const c of library.categories) expect(clips.filter(x => x.category === c.id).length).toBe(c.count);
  });

  it('only has clips a person can copy: short, and each one scores well against a good copy of itself', () => {
    let low = 0;
    for (const c of clips) {
      expect(c.duration).toBeLessThanOrEqual(4);
      expect(maxTakeSec(c)).toBeLessThanOrEqual(MAX_TAKE_SEC);
      if (scoreImitation(referenceFor(c, library), imitate(specOf(c.id), 0.75, 1.1), R).score < 40) low++;
    }
    expect(low / clips.length).toBeLessThan(0.1);
  }, 120_000); // analyses and calibrates every test sound

  it('fails loudly on a broken library', () => {
    const categories = library.categories;
    const base = clips.map(c => ({ id: c.id, name: c.name, category: c.category, events: specOf(c.id).events }));
    expect(() => validateLibrary({ categories, clips: base.slice(0, MIN_CLIPS - 1) })).toThrow(/at least/);
    expect(() => validateLibrary({ categories, clips: [...base, { ...base[0]! }] })).toThrow(/duplicate id/);
    expect(() => validateLibrary({ categories, clips: [...base.slice(1), { ...base[0]!, category: 'nope' }] })).toThrow(/unknown category/);
    expect(() => validateLibrary({ categories, clips: [...base.slice(1), { ...base[0]!, events: [{ t: 0, d: 9, wave: 'sine', f: 440 }] }] })).toThrow();
    expect(() => validateLibrary({ categories, clips: [...base.slice(1), { id: 'x-1', name: 'X', category: 'fx', audio: 'sounds/x-1.wav', duration: 1 }] })).toThrow(/no reference audio/);
  });

  it('only repeats a clip after the whole pool has been used', () => {
    const pool = eligibleClips(clips, { categories: ['fx'] });
    const used = new Set<string>();
    const first = new Set(pool.map(() => pickClip(pool, used).id));
    expect(first.size).toBe(pool.length);
    const again = pickClip(pool, used);
    expect(pool.some(c => c.id === again.id)).toBe(true);
  });
});

/** A 16-bit stereo WAV, as a sound editor would save it. */
function wavFile(samples: Float32Array, rate: number): Buffer {
  const data = Buffer.alloc(samples.length * 4);
  samples.forEach((v, i) => {
    const s = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
    data.writeInt16LE(s, i * 4);
    data.writeInt16LE(s, i * 4 + 2);
  });
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe('adding your own recordings', () => {
  it('turns files in a category folder into playable, scoreable sounds', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimic-lib-'));
    const src = path.join(tmp, 'sounds');
    fs.mkdirSync(path.join(src, 'trendy'), { recursive: true });
    fs.mkdirSync(path.join(src, 'hindi'), { recursive: true }); // empty: must not show up
    fs.mkdirSync(path.join(src, 'bollywood songs'), { recursive: true }); // not in categories.json: gets a default entry
    // A category with sounds to download, but no network in tests: its downloads fail and are skipped.
    fs.writeFileSync(path.join(src, 'sources.json'), JSON.stringify([
      { id: 'trendy', label: 'Trending', emoji: '🔥', hint: 'Copy the meme', sounds: [{ name: 'Offline', url: 'http://127.0.0.1:9/nope.mp3' }] },
      { id: 'hindi', label: 'Hindi', emoji: '🇮🇳', hint: 'Say it', sounds: [] },
    ]));
    // Half a second of silence around a tune, like a real clip.
    const tune = renderClip(samples.melody!, 44100);
    const padded = new Float32Array(tune.length + 44100);
    padded.set(tune, 22050);
    fs.writeFileSync(path.join(src, 'trendy', 'Kya Baat Hai.wav'), wavFile(padded, 44100));
    fs.writeFileSync(path.join(src, 'bollywood songs', 'Hum tum.wav'), wavFile(padded, 44100));
    fs.writeFileSync(path.join(src, 'trendy', 'broken.mp3'), Buffer.from('not really an mp3'));
    const logs: string[] = [];

    const out = path.join(tmp, 'library');
    const pub = path.join(tmp, 'client');
    await buildLibrary({ soundsDir: src, outDir: out, publicDir: pub, log: m => logs.push(m) });
    // validateLibrary wants MIN_CLIPS; this tiny library is checked through the build result instead.
    const lib = JSON.parse(fs.readFileSync(path.join(out, 'library.json'), 'utf8')) as { categories: CategoryInfo[]; clips: Clip[] };
    const pcmFile = (id: string) => path.join(out, 'refs', `${id}.pcm`);

    expect(lib.categories.map(c => c.id)).toEqual(['trendy', 'bollywood-songs']);
    expect(lib.categories[0]).toMatchObject({ label: 'Trending', emoji: '🔥', count: 1 });
    expect(logs.some(l => l.includes('Offline'))).toBe(true);
    expect(lib.categories.find(c => c.id === 'bollywood-songs')).toMatchObject({ label: 'Bollywood songs', count: 1 });
    const clip = lib.clips.find(c => c.category === 'trendy')!;
    expect(clip).toMatchObject({ id: 'trendy-kya-baat-hai', name: 'Kya Baat Hai', audio: 'sounds/trendy-kya-baat-hai.wav' });
    // Silence trimmed: about the tune's own length.
    expect(clip.duration).toBeGreaterThan(1.3);
    expect(clip.duration).toBeLessThan(1.6);
    expect(fs.existsSync(path.join(pub, clip.audio!))).toBe(true);
    expect(logs.some(l => l.includes('broken.mp3'))).toBe(true);
    // Scored against the recording: a good copy scores well, silence doesn't.
    const ref = fs.readFileSync(pcmFile(clip.id));
    const refSamples = new Float32Array(ref.length / 2).map((_, i) => ref.readInt16LE(i * 2) / 32768);
    expect(scoreImitation(makeReference(refSamples, R), imitate(samples.melody!), R).score).toBeGreaterThanOrEqual(55);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('silent takes', () => {
  const R = RECORDING_RATE;
  const noise = (sec: number, amp: number, seed = 7) => {
    const out = new Float32Array(Math.floor(sec * R));
    for (let i = 0; i < out.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[i] = ((seed / 0x7fffffff) * 2 - 1) * amp;
    }
    return out;
  };
  const ref = () => referenceFor(clips[0]!, library);

  it('scores hiss from an auto-gain mic as silent, however loud it is', () => {
    for (const amp of [0.01, 0.1, 0.4]) expect(scoreImitation(ref(), noise(4, amp), R).verdict).toBe('silent');
  });
  it('scores a voice from across the room as silent', () => {
    const take = noise(4, 0.05);
    const voice = imitate(specOf(clips[0]!.id));
    for (let i = 0; i < voice.length && i < take.length; i++) take[i]! += voice[i]! * 0.04;
    expect(scoreImitation(ref(), take, R).verdict).toBe('silent');
  });
  it('still scores a real copy in a noisy room', () => {
    for (const c of clips.slice(0, 6)) {
      const voice = imitate(specOf(c.id));
      const take = noise(voice.length / R, 0.04);
      for (let i = 0; i < voice.length; i++) take[i]! += voice[i]!;
      expect(scoreImitation(referenceFor(c, library), take, R).verdict).toBe('ok');
    }
  });
});
