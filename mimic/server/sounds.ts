// The sound library: categories and clips. `npm run build` writes it to dist/mimic/library (see
// scripts/build-library.mjs): the myinstants sounds listed in mimic/sounds/sources.json plus any files
// dropped into mimic/sounds/<category>/.
import { randomInt } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { CATEGORY_ID, MAX_TAKE_SEC, RECORDING_RATE, TAKE_EXTRA_SEC } from '../shared/constants';
import { int16ToFloat } from '../shared/dsp';
import { clipDuration, renderClip } from '../shared/synth';
import type { CategoryInfo, Clip, RoomSettings } from '../shared/types';
import { makeReference, type Reference, SCORE_RATE } from './audio-score';

export const MIN_CLIPS = 10;
export const MAX_CLIP_SEC = 6;

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
    id: z.string().regex(/^[a-z0-9-]{1,90}$/),
    name: z.string().min(1).max(40),
    category: z.string().regex(CATEGORY_ID),
    events: z.array(EventSchema).min(1).max(40).optional(),
    audio: z.string().regex(/^sounds\/[a-z0-9-]+\.wav$/).optional(),
    duration: z.number().positive().max(MAX_CLIP_SEC).optional(),
  })
  .strict();

const CategorySchema = z
  .object({ id: z.string().regex(CATEGORY_ID), label: z.string().min(1).max(30), emoji: z.string().max(16), hint: z.string().max(80), count: z.number().int().optional() })
  .strict();

export interface Library {
  categories: CategoryInfo[];
  clips: Clip[];
  /** 12 kHz samples of each recorded clip, for scoring. */
  recordings: Map<string, Float32Array>;
}

/** Checks the library and throws a readable error if it is broken, so a bad edit fails at startup. */
export function validateLibrary(data: unknown, recordings = new Map<string, Float32Array>()): Library {
  const parsed = z.object({ categories: z.array(CategorySchema), clips: z.array(ClipSchema) }).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Mimic sound library is invalid at [${issue?.path.join('.')}]: ${issue?.message}`);
  }
  const { categories, clips: raw } = parsed.data;
  const ids = new Set<string>();
  const clips: Clip[] = raw.map(c => {
    if (ids.has(c.id)) throw new Error(`Mimic sound library: duplicate id ${c.id}`);
    ids.add(c.id);
    if (!c.events === !c.audio) throw new Error(`Mimic sound library: ${c.id} needs either events or an audio file`);
    if (c.audio && !recordings.has(c.id)) throw new Error(`Mimic sound library: no reference audio for ${c.id}`);
    if (c.events?.some(e => e.wave !== 'noise' && e.f === undefined)) throw new Error(`Mimic sound library: ${c.id} has a tone without a frequency`);
    const duration = c.events ? clipDuration({ events: c.events }) : (c.duration ?? 0);
    if (duration > MAX_CLIP_SEC) throw new Error(`Mimic sound library: ${c.id} is longer than ${MAX_CLIP_SEC}s`);
    return { id: c.id, name: c.name, category: c.category, duration, ...(c.events ? { events: c.events } : { audio: c.audio! }) };
  });
  if (clips.length < MIN_CLIPS) throw new Error(`Mimic sound library has ${clips.length} clips; at least ${MIN_CLIPS} are required`);
  const counts = new Map<string, number>();
  for (const c of clips) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  for (const c of clips) if (!categories.some(k => k.id === c.category)) throw new Error(`Mimic sound library: ${c.id} has unknown category "${c.category}"`);
  const used = categories.filter(k => counts.get(k.id)).map(k => ({ ...k, count: counts.get(k.id)! }));
  return { categories: used, clips, recordings };
}

/** Reads the built library from `dir` (library.json + refs/). */
export function readLibrary(dir: string): Library {
  const file = path.join(dir, 'library.json');
  if (!fs.existsSync(file)) throw new Error(`Mimic has no sound library at ${dir}. Run: npm run build`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { clips?: { id: string; audio?: string }[] };
  const recordings = new Map<string, Float32Array>();
  for (const c of data.clips ?? []) {
    if (!c.audio) continue;
    const buf = fs.readFileSync(path.join(dir, 'refs', `${c.id}.pcm`));
    const copy = new Uint8Array(buf);
    recordings.set(c.id, int16ToFloat(new Int16Array(copy.buffer, 0, copy.byteLength >> 1)));
  }
  return validateLibrary(data, recordings);
}

let cached: Library | null = null;
export function loadLibrary(dir = path.join(__dirname, '..', 'library')): Library {
  if (!cached) cached = readLibrary(dir);
  return cached;
}

/** Clips in the chosen categories; an empty choice means every category. */
export function eligibleClips(all: Clip[], settings: Pick<RoomSettings, 'categories'>): Clip[] {
  return settings.categories.length ? all.filter(c => settings.categories.includes(c.category)) : all;
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
/** The clip analysed once, then reused for every imitation of it. */
export function referenceFor(clip: Clip, lib: Library = loadLibrary()): Reference {
  let r = references.get(clip.id);
  if (!r) {
    const rec = lib.recordings.get(clip.id);
    r = rec ? makeReference(rec, RECORDING_RATE) : makeReference(renderClip({ events: clip.events ?? [] }, SCORE_RATE), SCORE_RATE);
    references.set(clip.id, r);
  }
  return r;
}

export function maxTakeSec(clip: Clip): number {
  return Math.min(MAX_TAKE_SEC, Math.ceil((clip.duration + TAKE_EXTRA_SEC) * 10) / 10);
}
