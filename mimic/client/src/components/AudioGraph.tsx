// Waveform of the sound (mirrored blue/white bars) in a glowing box, with a red playhead.
// While recording, the player's own voice gets a second lane underneath in the same style, so they can
// line their shape up with the sound's.
import { useEffect, useMemo, useState } from 'react';
import type { Clip } from '../../../shared/types';
import { type ClipAudio, clipAudio } from '../lib/audio';
import type { TracePoint } from '../lib/trace';

const W = 600;
const SINGLE_H = 160;
const BARS = 220;

interface Props {
  clip: Omit<Clip, 'name'>;
  /** seconds shown across the box */
  span: number;
  /** playhead position in seconds, or null for none */
  at: number | null;
  trace?: TracePoint[];
  label: string;
}

export function AudioGraph({ clip, span, at, trace, label }: Props) {
  const [audio, setAudio] = useState<ClipAudio | null>(null);
  useEffect(() => {
    let live = true;
    setAudio(null);
    clipAudio(clip).then(a => live && setAudio(a), () => undefined);
    return () => {
      live = false;
    };
    // Only a different clip needs new audio; snapshots hand us a fresh object for the same one.
  }, [clip.id]);

  // Peak loudness of the sound in each bar, 0..1.
  const wave = useMemo(() => {
    if (!audio) return new Array<number>(BARS).fill(0);
    const { samples: s, rate } = audio;
    const per = (span * rate) / BARS;
    const peaks = Array.from({ length: BARS }, (_, b) => {
      let peak = 0;
      const end = Math.min(s.length, Math.floor((b + 1) * per));
      for (let i = Math.floor(b * per); i < end; i += 4) peak = Math.max(peak, Math.abs(s[i]!));
      return peak;
    });
    const top = Math.max(...peaks, 1e-6);
    return peaks.map(p => Math.pow(p / top, 0.7)); // lift quiet parts a little so they're visible
  }, [audio, span]);

  // A little fixed raggedness per bar so it reads like a real recording, not flat blocks.
  const jag = useMemo(() => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: BARS }, () => [0.82 + r() * 0.18, 0.55 + r() * 0.25, 0.22 + r() * 0.22] as const);
  }, []);

  // The player's loudness, binned the same way.
  const voice = useMemo(() => {
    if (!trace?.length) return null;
    const loudest = Math.max(...trace.map(p => p.level), 1e-3);
    const bins = new Array<number>(BARS).fill(0);
    for (const p of trace) {
      const b = Math.floor((p.t / span) * BARS);
      if (b >= 0 && b < BARS) bins[b] = Math.max(bins[b]!, Math.pow(p.level / loudest, 0.7));
    }
    return bins;
  }, [trace, span]);

  const bw = W / BARS;
  const headBar = at === null ? -1 : (at / span) * BARS;
  // With a voice trace the box has two lanes: the sound on top, the player's own voice below it.
  const duo = trace !== undefined;
  const H = duo ? 190 : SINGLE_H;
  const soundMid = duo ? 58 : H / 2;
  const soundHalf = duo ? 52 : H / 2 - 8;
  const voiceMid = 150;
  const voiceHalf = 34;

  const bars = (values: number[], mid: number, half: number, kind: 'sound' | 'voice', dimAfter: number) =>
    values.map((v, i) => {
      if (v < 0.02) return null;
      const h = v * half;
      const [o, m, n] = jag[i]!;
      return (
        <g key={kind + i} className={`wave__bar wave__bar--${kind}` + (dimAfter >= 0 && i > dimAfter ? ' is-ahead' : '')}>
          <rect x={i * bw} width={bw + 0.6} y={mid - h * o} height={h * o * 2} className="wave__outer" />
          <rect x={i * bw} width={bw + 0.6} y={mid - h * m} height={h * m * 2} className="wave__mid" />
          <rect x={i * bw} width={bw + 0.6} y={mid - h * n} height={h * n * 2} className="wave__inner" />
        </g>
      );
    });

  return (
    <figure className={'wave' + (duo ? ' wave--duo' : '')} aria-label={label}>
      {duo && (
        <>
          <span className="wave__tag wave__tag--sound">Sound</span>
          <span className="wave__tag wave__tag--you">You</span>
        </>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true">
        <line x1={0} x2={W} y1={soundMid} y2={soundMid} className="wave__axis" />
        {bars(wave, soundMid, soundHalf, 'sound', duo ? -1 : headBar)}
        {duo && (
          <>
            <line x1={0} x2={W} y1={116} y2={116} className="wave__split" />
            <line x1={0} x2={W} y1={voiceMid} y2={voiceMid} className="wave__axis" />
            {voice && bars(voice, voiceMid, voiceHalf, 'voice', -1)}
          </>
        )}
        {at !== null && <rect x={(at / span) * W - 3} width={6} y={0} height={H} className="wave__head" />}
      </svg>
    </figure>
  );
}
