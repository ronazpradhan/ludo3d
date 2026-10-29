// Short UI sound effects (no audio files to download) and the mute switch, remembered per browser.
// The mute switch also silences the round's clip and take playback (see audio.ts).
import { audioContext } from './audio';
import { loadMuted, saveMuted } from './session';

type Note = [freq: number, at: number, dur: number, type?: OscillatorType, gain?: number];

let muted = loadMuted();
const listeners = new Set<() => void>();

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  const ctx = audioContext(); // one context for the whole app, so a single tap unlocks everything
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function play(notes: Note[]): void {
  if (muted) return;
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.01;
  for (const [freq, at, dur, type = 'triangle', gain = 0.12] of notes) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(gain, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(a.destination);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.05);
  }
}

export const sounds = {
  recordGo: () => play([[660, 0, 0.08, 'sine'], [880, 0.09, 0.12, 'sine']]),
  submitted: () => play([[880, 0, 0.1, 'sine', 0.15], [1318, 0.08, 0.2, 'sine', 0.12]]),
  reveal: () => play([[330, 0, 0.18], [415, 0.12, 0.18], [494, 0.24, 0.35]]),
  victory: () => play([[523, 0, 0.15], [659, 0.15, 0.15], [784, 0.3, 0.15], [1046, 0.45, 0.5, 'square', 0.08]]),
};

/** Call from a click so browsers allow audio later. */
export const unlockAudio = (): void => void audio();

export const isMuted = (): boolean => muted;
export function setMuted(m: boolean): void {
  muted = m;
  saveMuted(m);
  listeners.forEach(f => f());
}
export function onMuteChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
