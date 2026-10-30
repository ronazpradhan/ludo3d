/// <reference lib="webworker" />
// Runs the ZIPA phone recogniser off the main thread, so the countdown and waveform never stutter.
import * as ort from 'onnxruntime-web/wasm';
import { resample } from '../../../shared/dsp';
import { fbank, FBANK_BINS, FBANK_RATE } from '../../../shared/fbank';
import { decodeCtc } from '../../../shared/phones';
import { RECORDING_RATE } from '../../../shared/constants';
import type { JudgeRequest, JudgeReply } from './judge';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: JudgeReply) => self.postMessage(m);
let session: Promise<ort.InferenceSession> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** The model file, from the browser's cache after the first time (it is 70 MB). */
async function modelBytes(url: string): Promise<Uint8Array> {
  const cache = await caches.open('mimic-judge').catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const bytes = new Uint8Array(total || 71_000_000);
  let loaded = 0;
  let shown = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, loaded);
    loaded += value.length;
    if (total && loaded - shown > total / 50) {
      shown = loaded;
      post({ type: 'progress', progress: loaded / total });
    }
  }
  const out = bytes.subarray(0, loaded);
  await cache?.put(url, new Response(out.slice())).catch(() => {});
  return out;
}

async function load(modelUrl: string): Promise<ort.InferenceSession> {
  ort.env.wasm.numThreads = 1;
  const s = await ort.InferenceSession.create(await modelBytes(modelUrl));
  post({ type: 'ready' });
  return s;
}

async function phones(samples: Float32Array, rate: number) {
  const s = await session!;
  // Everything goes through the game's recording rate first, so a clip and a take lose the same highs.
  const x = resample(rate === RECORDING_RATE ? samples : resample(samples, rate, RECORDING_RATE), RECORDING_RATE, FBANK_RATE);
  const { data, frames } = fbank(x);
  if (frames < 10) return { phones: [], confidence: 0 };
  const out = await s.run({
    x: new ort.Tensor('float32', data, [1, frames, FBANK_BINS]),
    x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
  });
  const lp = out[s.outputNames[0]!]!;
  return decodeCtc(lp.data as Float32Array, lp.dims[1] as number, lp.dims[2] as number);
}

self.onmessage = (e: MessageEvent<JudgeRequest>) => {
  const m = e.data;
  if (m.type === 'load') {
    session ??= load(m.modelUrl);
    session.catch(err => post({ type: 'failed', message: err instanceof Error ? err.message : String(err) }));
    return;
  }
  // One at a time: the model isn't run concurrently.
  queue = queue.then(() =>
    phones(m.samples, m.rate).then(
      result => post({ type: 'phones', id: m.id, result }),
      err => post({ type: 'phones', id: m.id, error: err instanceof Error ? err.message : String(err) }),
    ),
  );
};
