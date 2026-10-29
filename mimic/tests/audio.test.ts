// The similarity scorer and the clip library.
import { describe, expect, it } from 'vitest';
import { CATEGORIES, DIFFICULTIES, RECORDING_RATE } from '../shared/constants';
import { floatToInt16, int16ToFloat, resample } from '../shared/dsp';
import { type ClipSpec, clipDuration, renderClip, type Wave } from '../shared/synth';
import { makeReference, scoreImitation } from '../server/audio-score';
import { eligibleClips, maxTakeSec, MIN_CLIPS, pickClip, referenceFor, validateClips } from '../server/sounds';
import { clips, imitate } from './helpers';

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

describe('similarity scoring', () => {
  for (const [name, spec] of Object.entries(samples)) {
    it(`${name}: a good copy (other voice, an octave lower, slower, noisy room) scores high`, () => {
      expect(score(spec, imitate(spec))).toBeGreaterThanOrEqual(80);
    });
    it(`${name}: a sloppy copy still scores decently`, () => {
      expect(score(spec, imitate(spec, 0.6, 1.4, 'saw', 0.08))).toBeGreaterThanOrEqual(60);
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
  it(`has at least ${MIN_CLIPS} valid clips covering every category and difficulty`, () => {
    expect(clips.length).toBeGreaterThanOrEqual(MIN_CLIPS);
    for (const c of CATEGORIES) for (const d of DIFFICULTIES) expect(clips.some(x => x.category === c && x.difficulty === d)).toBe(true);
  });

  it('only has clips a person can copy: short, and each one scores well against a good copy of itself', () => {
    let low = 0;
    for (const c of clips) {
      expect(clipDuration(c)).toBeLessThanOrEqual(4);
      expect(maxTakeSec(c)).toBeLessThanOrEqual(6);
      if (scoreImitation(referenceFor(c), imitate(c, 0.75, 1.1), R).score < 60) low++;
    }
    expect(low / clips.length).toBeLessThan(0.1);
  });

  it('fails loudly on a broken library', () => {
    const base = clips.map(c => ({ ...c }));
    expect(() => validateClips(base.slice(0, 10))).toThrow(/at least/);
    expect(() => validateClips([...base, { ...base[0]! }])).toThrow(/duplicate id/);
    expect(() => validateClips([...base.slice(1), { ...base[0]!, category: 'nope' }])).toThrow(/invalid/);
    expect(() => validateClips([...base.slice(1), { ...base[0]!, events: [{ t: 0, d: 9, wave: 'sine', f: 440 }] }])).toThrow();
  });

  it('only repeats a clip after the whole pool has been used', () => {
    const pool = eligibleClips(clips, { categories: ['fx'], difficulty: 'hard' });
    const used = new Set<string>();
    const first = new Set(pool.map(() => pickClip(pool, used).id));
    expect(first.size).toBe(pool.length);
    const again = pickClip(pool, used);
    expect(pool.some(c => c.id === again.id)).toBe(true);
  });
});
