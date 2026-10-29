import { RECORDING_RATE } from '../shared/constants';
import { floatToInt16 } from '../shared/dsp';
import { type ClipSpec, renderClip, type Wave } from '../shared/synth';
import type { RoomSnapshot } from '../shared/types';
import type { Clock, RoomListener, Timing } from '../server/game-engine';
import { Room } from '../server/game-engine';
import { loadLibrary } from '../server/sounds';

/** Manual clock: timers only fire when the test advances time. */
export class FakeClock implements Clock {
  t = 1_000_000;
  private seq = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown): void => {
    this.timers = this.timers.filter(x => x.id !== h);
  };
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

export class Recorder implements RoomListener {
  states: RoomSnapshot[] = [];
  state = (room: Room): void => void this.states.push(room.snapshot());
}

/** The built-in synthesized library (tests never need a build). */
export const library = loadLibrary();
export const clips = library.clips;
export const TIMING: Timing = { listenMs: 5000, recordMs: 20_000, resultsMs: 8000 };

/** A human-ish copy of a clip: other timbre, transposed, slower, sloppy timing, background noise. */
export function imitate(spec: ClipSpec, shift = 0.5, stretch = 1.15, wave: Wave = 'sine', jitter = 0.03): Float32Array {
  let k = 1;
  const events = spec.events.map(e => {
    k = (k * 7 + 3) % 11;
    const j = ((k / 11) * 2 - 1) * jitter;
    return {
      ...e,
      t: Math.max(0, e.t * stretch + j),
      d: e.d * stretch,
      wave: e.wave === 'noise' ? e.wave : wave,
      ...(e.f ? { f: e.f * shift } : {}),
      ...(e.f2 ? { f2: e.f2 * shift } : {}),
      vib: [5, 0.3] as [number, number],
    };
  });
  const R = RECORDING_RATE;
  const pad = Math.floor(0.3 * R);
  const s = renderClip({ events }, R);
  const out = new Float32Array(s.length + 2 * pad);
  out.set(s, pad);
  let seed = 3;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = out[i]! * 0.7 + ((seed / 0x7fffffff) * 2 - 1) * 0.03;
  }
  return out;
}

export const pcmOf = (x: Float32Array): Int16Array => floatToInt16(x);
export const silence = (sec: number): Int16Array => new Int16Array(Math.floor(sec * RECORDING_RATE));

/** A room with `n` connected players p1..pn (p1 is host). */
export function makeRoom(n: number, timing: Timing = TIMING) {
  const clock = new FakeClock();
  const rec = new Recorder();
  const room = new Room('ABCDEF', library, rec, clock, timing);
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `p${i}`;
    const r = room.addPlayer({ id, nickname: `Player ${i}`, avatar: 'fox', tokenHash: 'x' });
    if (!r.ok) throw new Error(r.message);
    room.setConnected(id, `sock-${i}`);
    ids.push(id);
  }
  const clip = () => clips.find(c => c.id === room.snapshot().round!.clip.id)!;
  const goodTake = () => pcmOf(imitate({ events: clip().events! }));
  const score = (id: string): number => room.players.get(id)!.score;
  /** Start the match and move into the record phase of round 1. */
  const startRecording = () => {
    const r = room.start('p1');
    if (!r.ok) throw new Error(r.message);
    clock.advance(timing.listenMs!);
  };
  return { room, clock, rec, ids, clip, goodTake, score, startRecording };
}
