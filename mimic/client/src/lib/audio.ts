// Everything that touches Web Audio: playing the round's clip, playing takes back, and recording the mic.
import { RECORDING_RATE } from '../../../shared/constants';
import { floatToInt16, int16ToFloat, resample } from '../../../shared/dsp';
import { type ClipSpec, renderClip } from '../../../shared/synth';
import { isMuted } from './sound';

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** Browsers start audio suspended until a tap; true once sound can actually play. */
export function audioReady(): boolean {
  return ctx?.state === 'running';
}

export async function unlock(): Promise<boolean> {
  const c = audioContext();
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  return c.state === 'running';
}

let current: AudioBufferSourceNode | null = null;

export function stopPlayback(): void {
  try {
    current?.stop();
  } catch {
    /* already stopped */
  }
  current = null;
}

function playBuffer(samples: Float32Array, rate: number, when = 0): Promise<void> {
  const c = audioContext();
  stopPlayback();
  const buf = c.createBuffer(1, Math.max(1, samples.length), rate);
  buf.getChannelData(0).set(samples);
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.value = isMuted() ? 0 : 1;
  src.connect(gain).connect(c.destination);
  current = src;
  src.start(c.currentTime + Math.max(0, when));
  return new Promise(res => (src.onended = () => res()));
}

export interface ClipAudio {
  samples: Float32Array;
  rate: number;
}
type PlayableClip = { id: string; events?: ClipSpec['events']; audio?: string };

const loaded = new Map<string, Promise<ClipAudio>>();
/**
 * The round's clip as samples: synthesized clips are rendered from their description, recorded ones are
 * downloaded and decoded. Either way it's the exact sound the server scores against. Cached per clip.
 */
export function clipAudio(clip: PlayableClip): Promise<ClipAudio> {
  let p = loaded.get(clip.id);
  if (!p) {
    p = clip.audio
      ? fetch(`${import.meta.env.BASE_URL}${clip.audio}`)
          .then(r => {
            if (!r.ok) throw new Error(`couldn't load the sound (${r.status})`);
            return r.arrayBuffer();
          })
          .then(buf => audioContext().decodeAudioData(buf))
          .then(b => ({ samples: b.getChannelData(0), rate: b.sampleRate }))
      : Promise.resolve({ samples: renderClip({ events: clip.events ?? [] }, audioContext().sampleRate), rate: audioContext().sampleRate });
    p.catch(() => loaded.delete(clip.id)); // let a later call retry
    loaded.set(clip.id, p);
  }
  return p;
}

/** Plays the round's clip once. */
export async function playClip(clip: PlayableClip, delaySec = 0): Promise<void> {
  const a = await clipAudio(clip);
  return playBuffer(a.samples, a.rate, delaySec);
}

export function playPcm(pcm: Int16Array): Promise<void> {
  return playBuffer(int16ToFloat(pcm), RECORDING_RATE);
}

// ---------- microphone ----------

export type MicState = 'unknown' | 'asking' | 'ready' | 'denied' | 'unsupported' | 'error';

let stream: MediaStream | null = null;

export async function openMic(): Promise<MicState> {
  if (stream && stream.getAudioTracks().some(t => t.readyState === 'live')) return 'ready';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    // Raw-ish audio: noise suppression would eat whistles and claps.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    return 'ready';
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error';
  }
}

export interface Recording {
  stop(): Promise<Int16Array>;
  cancel(): void;
}

/**
 * Records the mic for up to `maxSec`. `onData` sees the raw samples as they arrive (for meters and graphs).
 * The result is mono 16-bit PCM at RECORDING_RATE, ready to send.
 */
export async function record(maxSec: number, onData: (samples: Float32Array, rate: number) => void, onAutoStop: () => void): Promise<Recording> {
  if (!stream) throw new Error('mic not open');
  const c = audioContext();
  await unlock();
  const source = c.createMediaStreamSource(stream);
  const chunks: Float32Array[] = [];
  let length = 0;
  const max = Math.floor(maxSec * c.sampleRate);
  let done = false;
  let node: AudioNode;
  const take = (data: Float32Array) => {
    if (done) return;
    const room = max - length;
    const part = data.length > room ? data.subarray(0, room) : data;
    onData(part, c.sampleRate);
    chunks.push(part);
    length += part.length;
    if (length >= max) {
      done = true;
      onAutoStop();
    }
  };
  if (c.audioWorklet) {
    await c.audioWorklet.addModule(`${import.meta.env.BASE_URL}recorder-worklet.js`);
    const w = new AudioWorkletNode(c, 'mimic-recorder');
    w.port.onmessage = e => take(e.data as Float32Array);
    node = w;
  } else {
    // Older Safari: no AudioWorklet.
    const sp = c.createScriptProcessor(2048, 1, 1);
    sp.onaudioprocess = e => take(new Float32Array(e.inputBuffer.getChannelData(0)));
    node = sp;
  }
  const sink = c.createGain();
  sink.gain.value = 0; // keep the graph running without playing the mic out loud
  source.connect(node).connect(sink).connect(c.destination);

  const teardown = () => {
    done = true;
    source.disconnect();
    node.disconnect();
    sink.disconnect();
  };
  return {
    stop: async () => {
      teardown();
      const all = new Float32Array(length);
      let o = 0;
      for (const ch of chunks) {
        all.set(ch, o);
        o += ch.length;
      }
      return floatToInt16(resample(all, c.sampleRate, RECORDING_RATE));
    },
    cancel: teardown,
  };
}
