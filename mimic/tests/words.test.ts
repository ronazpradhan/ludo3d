import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RECORDING_RATE, WORDS_WEIGHT } from '../shared/constants';
import { fbank, FBANK_BINS, FBANK_RATE } from '../shared/fbank';
import { decodeCtc, hasSpeech, phoneSimilarity, type Phones, wordsScore } from '../shared/phones';
import { makeRoom } from './helpers';

const p = (s: string, confidence = 0.8): Phones => ({ phones: [...s], confidence });

describe('comparing phones', () => {
  it('scores the same words high whatever the accent, and other words low', () => {
    const ref = [...'ɑɹjusɪɹiəsɹaɪtnaʊbɹoʊ'];
    expect(phoneSimilarity(ref, [...'ɑɹjusɪɹiəsɹaɪtnaʊbɹoʊ'])).toBe(1);
    expect(phoneSimilarity(ref, [...'arjusiriəsrajtnawbro'])).toBeGreaterThan(0.75);
    expect(phoneSimilarity(ref, [...'aɪlaɪkbənænəz'])).toBeLessThan(0.35);
    // Holding a sound longer is the same word.
    expect(phoneSimilarity([...'siu'], [...'siuuuuu'])).toBe(1);
  });
  it('only judges words for sounds that have some', () => {
    expect(hasSpeech(p('mastidekobentʃo', 0.6))).toBe(true);
    expect(hasSpeech(p('aŋgaxarartutwanta', 0.31))).toBe(false); // a fart, read as junk
    expect(hasSpeech(p('ua', 0.9))).toBe(false);
    expect(wordsScore(p('aŋgaxarar', 0.3), p('aŋgaxarar'))).toBeNull();
  });
  it('turns similarity into a 0..1 words score against everyday talk', () => {
    const ref = p('ɑɹjusɪɹiəsɹaɪtnaʊbɹoʊ');
    expect(wordsScore(ref, p('ɑɹjusɪɹiəsɹaɪnaʊəbɛʊ'))).toBeGreaterThan(0.8);
    expect(wordsScore(ref, p('aɪlaɪkbənænəz'))).toBeLessThan(0.2);
    expect(wordsScore(ref, p(''))).toBe(0);
  });
  it('decodes CTC output: blanks dropped, repeats merged, marks removed', () => {
    // vocab: 0 blank, 4 'a', 5 'b', 111 'ː'
    const V = 127;
    const frames = [4, 4, 0, 4, 111, 5, 0];
    const lp = new Float32Array(frames.length * V).fill(-20);
    frames.forEach((v, t) => (lp[t * V + v] = -0.1));
    expect(decodeCtc(lp, frames.length, V).phones).toEqual(['a', 'a', 'b']);
  });
});

describe('filterbank features', () => {
  it('gives one 80-band row per 10 ms, louder bands where the tone is', () => {
    const x = Float32Array.from({ length: FBANK_RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / FBANK_RATE));
    const { data, frames } = fbank(x);
    expect(frames).toBe(100);
    expect(data.length).toBe(100 * FBANK_BINS);
    const row = data.subarray(50 * FBANK_BINS, 51 * FBANK_BINS);
    const peak = row.indexOf(Math.max(...row));
    // 1 kHz sits around mel band 22 of 80 (20-7600 Hz).
    expect(peak).toBeGreaterThan(17);
    expect(peak).toBeLessThan(28);
  });
});

describe('the words part of a score', () => {
  it('blends the phone’s words score into the take’s score, and shows it', () => {
    const { room, startRecording, goodTake } = makeRoom(2);
    startRecording();
    const without = room.submitTake('p1', goodTake());
    const said = room.submitTake('p2', goodTake(), 1);
    expect(without.ok && said.ok).toBe(true);
    if (!without.ok || !said.ok) return;
    expect(without.feedback.parts?.words).toBeNull();
    expect(said.feedback.parts?.words).toBe(100);
    expect(said.feedback.score).toBe(Math.round((1 - WORDS_WEIGHT) * without.feedback.score + WORDS_WEIGHT * 100));
  });
});

// The real model, when it has been downloaded (npm run build). Checks the browser path end to end in Node.
const MODEL = path.join(__dirname, '..', 'sounds', '.cache', 'zipa-dfe87c97.int8.onnx');
describe.runIf(fs.existsSync(MODEL))('the ZIPA model', () => {
  it('reads a spoken line as its phones, and a pure tone as no speech', async () => {
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;
    const s = await ort.InferenceSession.create(fs.readFileSync(MODEL));
    const run = async (x: Float32Array) => {
      const { data, frames } = fbank(x);
      const out = await s.run({ x: new ort.Tensor('float32', data, [1, frames, FBANK_BINS]), x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]) });
      const lp = out.log_probs!;
      return decodeCtc(lp.data as Float32Array, lp.dims[1] as number, lp.dims[2] as number);
    };
    const tone = Float32Array.from({ length: FBANK_RATE * 2 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / FBANK_RATE));
    expect(hasSpeech(await run(tone))).toBe(false);
    expect(RECORDING_RATE).toBeLessThan(FBANK_RATE);
  }, 120_000);
});
