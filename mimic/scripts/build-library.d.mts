import type { CategoryInfo, Clip } from '../shared/types';

export const MAX_SEC: number;
export const MIN_SEC: number;
export function buildLibrary(opts: {
  soundsDir: string;
  outDir: string;
  publicDir: string;
  cacheDir?: string;
  log?: (msg: string) => void;
}): Promise<{ categories: CategoryInfo[]; clips: Clip[] }>;
