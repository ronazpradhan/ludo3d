// The word judge: runs the ZIPA phone recogniser on this phone to check whether a take says the same words
// as the sound. It loads in the background (70 MB the first time, cached after) and is optional: if it isn't
// ready or fails, a take is scored on how it sounds alone.
import { useSyncExternalStore } from 'react';
import { type Phones, wordsScore } from '../../../shared/phones';
import { clipAudio, type PlayableClip } from './audio';

// Keep in step with mimic/scripts/fetch-zipa.mjs.
const ZIPA_REV = 'dfe87c97';
const BASE = import.meta.env.BASE_URL;

export type JudgeRequest = { type: 'load'; modelUrl: string } | { type: 'phones'; id: number; samples: Float32Array; rate: number };
export type JudgeReply =
  | { type: 'progress'; progress: number }
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'phones'; id: number; result?: Phones; error?: string };

export interface JudgeState {
  status: 'off' | 'loading' | 'ready' | 'failed';
  /** download progress, 0..1 */
  progress: number;
}

let state: JudgeState = { status: 'off', progress: 0 };
const subs = new Set<() => void>();
const set = (s: Partial<JudgeState>) => {
  state = { ...state, ...s };
  for (const f of subs) f();
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (p: Phones | null) => void>();
const references = new Map<string, Promise<Phones | null>>();

/** Starts loading the judge (once). Safe to call often. */
export function loadJudge(): void {
  if (worker || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return;
  try {
    worker = new Worker(new URL('./judge.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return set({ status: 'failed' });
  }
  set({ status: 'loading' });
  worker.onmessage = (e: MessageEvent<JudgeReply>) => {
    const m = e.data;
    if (m.type === 'progress') set({ progress: m.progress });
    else if (m.type === 'ready') set({ status: 'ready', progress: 1 });
    else if (m.type === 'failed') set({ status: 'failed' });
    else {
      pending.get(m.id)?.(m.result ?? null);
      pending.delete(m.id);
    }
  };
  worker.onerror = () => set({ status: 'failed' });
  worker.postMessage({ type: 'load', modelUrl: `${BASE}zipa/${ZIPA_REV}/model.int8.onnx` } satisfies JudgeRequest);
}

function phonesOf(samples: Float32Array, rate: number): Promise<Phones | null> {
  if (!worker || state.status === 'failed') return Promise.resolve(null);
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    // Copy: the clip's samples stay in use for playback.
    worker!.postMessage({ type: 'phones', id, samples: samples.slice(), rate } satisfies JudgeRequest);
  });
}

/** Works out the round's sound's phones ahead of time, while everyone listens. */
export function prepareReference(clip: PlayableClip): Promise<Phones | null> {
  let p = references.get(clip.id);
  if (!p) {
    p = clipAudio(clip).then(a => phonesOf(a.samples, a.rate));
    references.set(clip.id, p);
  }
  return p;
}

const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);

/**
 * How well a take (RECORDING_RATE mono PCM) says the sound's words, 0..1; null when the sound has no words,
 * or the judge isn't ready in time (then the take is scored on how it sounds alone).
 */
export async function judgeWords(clip: PlayableClip, pcm: Int16Array, rate: number, timeoutMs: number): Promise<number | null> {
  if (state.status !== 'ready') return null;
  const take = Float32Array.from(pcm, v => v / 32768);
  const [ref, mine] = await within(Promise.all([prepareReference(clip), phonesOf(take, rate)]), timeoutMs) ?? [null, null];
  return ref && mine ? wordsScore(ref, mine) : null;
}

export function useJudge(): JudgeState {
  return useSyncExternalStore(
    f => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}
