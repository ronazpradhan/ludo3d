import { randomInt } from 'crypto';
import { z } from 'zod';
import { CATEGORIES, DIFFICULTIES, MAX_TAKE_SEC, TAKE_EXTRA_SEC } from '../shared/constants';
import { clipDuration, renderClip } from '../shared/synth';
import type { Clip, RoomSettings } from '../shared/types';
import { makeReference, type Reference, SCORE_RATE } from './audio-score';
import rawSounds from './sounds.json';

export const MIN_CLIPS = 100;
export const MAX_CLIP_SEC = 4;

const EventSchema = z
  .object({
    t: z.number().min(0).max(MAX_CLIP_SEC),
    d: z.number().min(0.03).max(MAX_CLIP_SEC),
    wave: z.enum(['sine', 'triangle', 'square', 'saw', 'noise']),
    f: z.number().min(50).max(2500).optional(),
    f2: z.number().min(50).max(2500).optional(),
    a: z.number().min(0).max(1).optional(),
    vib: z.tuple([z.number().min(0).max(20), z.number().min(0).max(6)]).optional(),
  })
  .strict();

const ClipSchema = z
  .object({
    id: z.string().regex(/^[a-z]+-\d{3}$/),
    name: z.string().min(1).max(40),
    category: z.enum(CATEGORIES),
    difficulty: z.enum(DIFFICULTIES),
    events: z.array(EventSchema).min(1).max(40),
  })
  .strict();

/** Checks the library and throws a readable error if it is broken, so a bad edit fails at startup. */
export function validateClips(data: unknown): Clip[] {
  const parsed = z.array(ClipSchema).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Mimic sounds.json is invalid at [${issue?.path.join('.')}]: ${issue?.message}`);
  }
  const clips = parsed.data;
  if (clips.length < MIN_CLIPS) throw new Error(`Mimic sounds.json has ${clips.length} clips; at least ${MIN_CLIPS} are required`);
  const ids = new Set<string>();
  for (const c of clips) {
    if (ids.has(c.id)) throw new Error(`Mimic sounds.json: duplicate id ${c.id}`);
    ids.add(c.id);
    if (clipDuration(c) > MAX_CLIP_SEC) throw new Error(`Mimic sounds.json: ${c.id} is longer than ${MAX_CLIP_SEC}s`);
    if (c.events.some(e => e.wave !== 'noise' && e.f === undefined)) throw new Error(`Mimic sounds.json: ${c.id} has a tone without a frequency`);
  }
  for (const c of CATEGORIES)
    for (const d of DIFFICULTIES) if (!clips.some(x => x.category === c && x.difficulty === d)) throw new Error(`Mimic sounds.json: no ${d} clips in ${c}`);
  return clips;
}

let cached: Clip[] | null = null;
export function loadClips(): Clip[] {
  if (!cached) cached = validateClips(rawSounds);
  return cached;
}

export function eligibleClips(all: Clip[], settings: Pick<RoomSettings, 'categories' | 'difficulty'>): Clip[] {
  return all.filter(c => settings.categories.includes(c.category) && (settings.difficulty === 'mixed' || c.difficulty === settings.difficulty));
}

/** Random unused clip; once the whole pool has been used it starts over, so repeats only come after that. */
export function pickClip(pool: Clip[], used: Set<string>): Clip {
  if (pool.length === 0) throw new Error('empty clip pool');
  let fresh = pool.filter(c => !used.has(c.id));
  if (fresh.length === 0) {
    for (const c of pool) used.delete(c.id);
    fresh = pool;
  }
  const choice = fresh[randomInt(fresh.length)]!;
  used.add(choice.id);
  return choice;
}

const references = new Map<string, Reference>();
/** The clip rendered and analysed once, then reused for every imitation of it. */
export function referenceFor(clip: Clip): Reference {
  let r = references.get(clip.id);
  if (!r) references.set(clip.id, (r = makeReference(renderClip(clip, SCORE_RATE), SCORE_RATE)));
  return r;
}

export function maxTakeSec(clip: Clip): number {
  return Math.min(MAX_TAKE_SEC, Math.ceil((clipDuration(clip) + TAKE_EXTRA_SEC) * 10) / 10);
}
