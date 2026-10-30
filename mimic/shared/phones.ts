// Turning the ZIPA phone recogniser's output into phones, and comparing two phone strings.
// ZIPA (Zhu et al., ACL 2025, https://github.com/lingjzhu/zipa) is CC BY 4.0.

/** The model's output vocabulary, in id order (tokens.txt of anyspeech/zipa-small-crctc-500k). */
export const ZIPA_TOKENS =
  '<blk> <sos/eos> <unk> ▁ a b c d e f g h i j k l m n o p q r s t u v w x y z æ ç ð ø ħ ŋ œ ǀ ǁ ǂ ǃ ɐ ɑ ɒ ɓ ɔ ɕ ɖ ɗ ɘ ə ɛ ɜ ɞ ɟ ɠ ɢ ɣ ɤ ɥ ɦ ɧ ɨ ɪ ɬ ɭ ɮ ɯ ɰ ɱ ɲ ɳ ɴ ɵ ɶ ɸ ɹ ɺ ɻ ɽ ɾ ʀ ʁ ʂ ʃ ʄ ʈ ʉ ʊ ʋ ʌ ʍ ʎ ʏ ʐ ʑ ʒ ʔ ʕ ʘ ʙ ʛ ʜ ʝ ʟ ʡ ʢ ʰ ʲ ʷ ʼ ː ˞ ˠ ˤ ̃ ̚ ̥ ̩ ̪ ̴ ̺ β θ χ ᶑ ⱱ'.split(' ');

export interface Phones {
  /** recognised phones, marks such as length and aspiration dropped */
  phones: string[];
  /** how sure the model was of them, 0..1; speech is about 0.5+, noises and music well below */
  confidence: number;
}

// Close sounds share a class, so an accent or a sloppy vowel is a near miss rather than a miss.
const CLASSES = [
  'aɑɐæʌɒɶ', 'eɛəɜɘœøɞɤ', 'iɪyɨʏ', 'oɔɵ', 'uʊɯʉ',
  'rɹɾɻʀʁɽɺ', 'lɭɫʎʟɬɮ', 'nɳɲɴ', 'mɱ', 'ŋ',
  'pɸ', 'bɓβ', 'tʈθ', 'dɖɗᶑð', 'kq', 'gɢɠɡ', 'cɟ',
  'sɕ', 'ʃʂ', 'zʑ', 'ʒʐ', 'fɸ', 'vʋⱱ', 'xχɣ', 'hɦħʜ', 'jʝ', 'wʍɰɥ', 'ʔ',
];
const CLASS = new Map<string, number>();
CLASSES.forEach((c, i) => [...c].forEach(ch => CLASS.has(ch) || CLASS.set(ch, i)));
const VOWEL_CLASSES = 5;
const DROP = new Set(['<blk>', '<sos/eos>', '<unk>', '▁', 'ʰ', 'ʲ', 'ʷ', 'ʼ', 'ː', '˞', 'ˠ', 'ˤ', '̃', '̚', '̥', '̩', '̪', '̴', '̺']);

/** Greedy CTC decoding of the model's log-probabilities (T × V, row-major). */
export function decodeCtc(logProbs: Float32Array, frames: number, vocab: number): Phones {
  const phones: string[] = [];
  let prev = -1;
  let sure = 0;
  let count = 0;
  for (let t = 0; t < frames; t++) {
    const row = t * vocab;
    let best = 0;
    for (let v = 1; v < vocab; v++) if (logProbs[row + v]! > logProbs[row + best]!) best = v;
    if (best !== 0 && best !== prev) {
      const tok = ZIPA_TOKENS[best] ?? '';
      if (!DROP.has(tok)) {
        phones.push(tok);
        sure += Math.exp(logProbs[row + best]!);
        count++;
      }
    }
    prev = best;
  }
  return { phones, confidence: count ? sure / count : 0 };
}

/** Whether a clip has words in it worth comparing (not a fart, a ringtone or a song's backing track). */
export function hasSpeech(p: Phones): boolean {
  return p.phones.length >= 3 && p.confidence >= 0.42;
}

function cost(a: string, b: string): number {
  if (a === b) return 0;
  const ca = CLASS.get(a);
  const cb = CLASS.get(b);
  if (ca !== undefined && ca === cb) return 0.25;
  // A vowel for another vowel is a near miss too (accents move vowels around most).
  if (ca !== undefined && cb !== undefined && ca < VOWEL_CLASSES && cb < VOWEL_CLASSES) return 0.5;
  return 1;
}

/** Repeated phones collapse to one: "siuuuu" and "siu" are the same word said longer. */
const squash = (p: string[]): string[] => p.filter((x, i) => x !== p[i - 1]);

/**
 * How closely a take's phones match the original's, 0..1: a weighted edit distance (accent-tolerant)
 * over the original's length. Saying the right words scores high whatever the voice; other words score low.
 */
export function phoneSimilarity(ref: string[], take: string[]): number {
  const a = squash(ref);
  const b = squash(take);
  if (a.length === 0) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + cost(a[i - 1]!, b[j - 1]!));
    row = next;
  }
  return Math.max(0, 1 - row[b.length]! / Math.max(a.length, b.length));
}

// Everyday phrases that are not any clip's words, as phones: what "saying something else" scores against a
// sound. Each sound is judged against its own baseline, since long sounds share more phones with anything.
const UNRELATED = [
  'hɛloʊhaʊɑɹjuduɪŋ', 'aɪlaɪkbənænəz', 'wʌtɑɹjuduɪŋ', 'oʊmaɪgɑd', 'noʊweɪ', 'lɛtsgoʊ', 'oʊkeɪ', 'bɹoʊ',
  'jɛssəɹ', 'kjahua', 'tikhɛ', 'nəmʌste', 'ɡʊdmɔɹnɪŋ', 'aɪmhʌŋgɹi', 'gɪvmiðəbɔl', 'ðætsnɑtfɛɹ',
].map(s => [...s]);
/** A take this close to the sound's phones counts as saying the words fully: people's accents and the
 * recogniser's slips keep even a perfect line well short of an exact phone match. */
const GOOD = 0.65;

/**
 * The words part of a take's score, 0..1: how much closer the take's phones are to the sound's than everyday
 * talk would be. Null when the sound has no words to say (a fart, a ringtone), so it doesn't count at all.
 */
export function wordsScore(ref: Phones, take: Phones): number | null {
  if (!hasSpeech(ref)) return null;
  const base = UNRELATED.map(u => phoneSimilarity(ref.phones, u)).sort((a, b) => a - b)[UNRELATED.length >> 1]!;
  const v = Math.max(0, Math.min(1, (phoneSimilarity(ref.phones, take.phones) - base) / Math.max(0.2, GOOD - base)));
  // Generous near the top, like the rest of the score: most of the words right is nearly full marks.
  return 1 - Math.pow(1 - v, 1.5);
}
