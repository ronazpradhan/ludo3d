import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { MimicStore, State } from '../lib/store';
import { isMuted, onMuteChange } from '../lib/sound';

export const StoreContext = createContext<MimicStore | null>(null);

export function useStore(): MimicStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreContext missing');
  return s;
}

export function useMimic(): State {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Milliseconds left until a server-clock deadline, refreshed a few times a second. */
export function useCountdown(endsAt: number | null | undefined): number {
  const store = useStore();
  const calc = () => (endsAt ? Math.max(0, endsAt - store.serverNow()) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!endsAt) return;
    const t = setInterval(() => setLeft(calc()), 200);
    return () => clearInterval(t);
  }, [endsAt, store]);
  return left;
}

export function useMuted(): boolean {
  return useSyncExternalStore(onMuteChange, isMuted);
}

