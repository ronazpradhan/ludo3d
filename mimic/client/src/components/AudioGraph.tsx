// Waveform of the sound (mirrored blue/white bars) in a glowing box, with a red playhead.
// While recording, the player's own loudness is drawn in green over it so they can match the shape.
import { useMemo } from 'react';
import { type ClipEvent, renderClip } from '../../../shared/synth';
import type { TracePoint } from '../lib/trace';

const W = 600;
const H = 160;
const BARS = 220;
const RATE = 8000; // plenty for drawing a loudness shape

interface Props {
  events: ClipEvent[];
  /** seconds shown across the box */
  span: number;
  /** playhead position in seconds, or null for none */
  at: number | null;
  trace?: TracePoint[];
  label: string;
}

export function AudioGraph({ events, span, at, trace, label }: Props) {
  // Peak loudness of the sound in each bar, 0..1.
  const wave = useMemo(() => {
    const s = renderClip({ events }, RATE);
    const per = (span * RATE) / BARS;
    const peaks = Array.from({ length: BARS }, (_, b) => {
      let peak = 0;
      const end = Math.min(s.length, Math.floor((b + 1) * per));
      for (let i = Math.floor(b * per); i < end; i++) peak = Math.max(peak, Math.abs(s[i]!));
      return peak;
    });
    const top = Math.max(...peaks, 1e-6);
    return peaks.map(p => Math.pow(p / top, 0.7)); // lift quiet parts a little so they're visible
  }, [events, span]);

  // A little fixed raggedness per bar so it reads like a real recording, not flat blocks.
  const jag = useMemo(() => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: BARS }, () => [0.82 + r() * 0.18, 0.55 + r() * 0.25, 0.22 + r() * 0.22] as const);
  }, []);

  // The player's loudness, binned the same way.
  const voice = useMemo(() => {
    if (!trace?.length) return null;
    const bins = new Array<number>(BARS).fill(0);
    for (const p of trace) {
      const b = Math.floor((p.t / span) * BARS);
      if (b >= 0 && b < BARS) bins[b] = Math.max(bins[b]!, p.level);
    }
    return bins;
  }, [trace, span]);

  const bw = W / BARS;
  const mid = H / 2;
  const headBar = at === null ? -1 : (at / span) * BARS;

  return (
    <figure className="wave" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true">
        <line x1={0} x2={W} y1={mid} y2={mid} className="wave__axis" />
        {wave.map((v, i) => {
          if (v < 0.02) return null;
          const h = v * (H / 2 - 8);
          const dim = headBar >= 0 && i > headBar ? ' is-ahead' : '';
          const [o, m, n] = jag[i]!;
          return (
            <g key={i} className={'wave__bar' + dim}>
              <rect x={i * bw} width={bw + 0.6} y={mid - h * o} height={h * o * 2} className="wave__outer" />
              <rect x={i * bw} width={bw + 0.6} y={mid - h * m} height={h * m * 2} className="wave__mid" />
              <rect x={i * bw} width={bw + 0.6} y={mid - h * n} height={h * n * 2} className="wave__inner" />
            </g>
          );
        })}
        {voice?.map((v, i) => {
          if (v < 0.02) return null;
          const h = v * (H / 2 - 8);
          return <rect key={'v' + i} x={i * bw + bw * 0.2} width={bw * 0.6} y={mid - h} height={h * 2} rx={1} className="wave__voice" />;
        })}
        {at !== null && <rect x={(at / span) * W - 3} width={6} y={0} height={H} className="wave__head" />}
      </svg>
    </figure>
  );
}
