// Every points rule lives here. A take's similarity (0-100, from audio-score.ts) is its points, and the
// best take of the round gets a bonus (shared on a tie). No take, silence or a replayed clip scores 0.
import { POINTS } from '../shared/constants';
import type { TakeResult, Verdict } from '../shared/types';

export interface Take {
  playerId: string;
  score: number;
  verdict: Verdict;
  hasAudio: boolean;
}

export function roundPoints(takes: Take[]): TakeResult[] {
  const top = Math.max(0, ...takes.map(t => t.score));
  return takes
    .map(t => {
      const best = top > 0 && t.score === top;
      // Copy only public fields: the caller's takes may carry the raw recording.
      return { playerId: t.playerId, score: t.score, verdict: t.verdict, hasAudio: t.hasAudio, best, points: t.score + (best ? POINTS.bestTakeBonus : 0) };
    })
    .sort((a, b) => b.score - a.score);
}
