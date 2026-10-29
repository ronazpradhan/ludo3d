import { useEffect, useRef, useState } from 'react';
import { type MicState, openMic, record } from '../lib/audio';

const HELP: Record<Exclude<MicState, 'ready' | 'asking' | 'unknown'>, string> = {
  denied: 'Microphone is blocked. Click the lock/mic icon in the address bar, allow the microphone, then try again.',
  unsupported: 'This browser can’t use the microphone here. Use a recent Chrome, Safari or Firefox over https.',
  error: 'Couldn’t open a microphone. Check one is plugged in and not used by another app.',
};

/** Asks for the mic and shows a live level meter so players know they're heard before the match. */
export function MicCheck({ compact = false, onReady }: { compact?: boolean; onReady?: () => void }) {
  const [state, setState] = useState<MicState>('unknown');
  const [level, setLevel] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const start = async () => {
    setState('asking');
    const s = await openMic();
    setState(s);
    if (s !== 'ready') return;
    onReady?.();
    // Meter only: record into nothing for a while, just to show the level.
    let stopped = false;
    const rec = await record(600, v => !stopped && setLevel(l => Math.max(v, l * 0.85)), () => undefined);
    stopRef.current = () => {
      stopped = true;
      rec.cancel();
    };
  };

  if (state === 'ready')
    return (
      <div className={'mic mic--ok' + (compact ? ' mic--compact' : '')} role="status">
        <span className="mic__icon" aria-hidden="true">🎙️</span>
        <span className="mic__text">Mic ready — make a noise</span>
        <span className="meter" aria-hidden="true"><i style={{ transform: `scaleX(${level})` }} /></span>
      </div>
    );
  return (
    <div className={'mic' + (compact ? ' mic--compact' : '')}>
      <button type="button" className="btn btn--lime btn--sm" disabled={state === 'asking'} onClick={() => void start()}>
        {state === 'asking' ? 'Waiting for permission…' : '🎙️ Test my mic'}
      </button>
      {state !== 'unknown' && state !== 'asking' && <p className="mic__help" role="alert">{HELP[state]}</p>}
      {state === 'unknown' && !compact && <p className="mic__help muted">You’ll copy sounds with your voice. Your browser will ask to use the microphone.</p>}
    </div>
  );
}
