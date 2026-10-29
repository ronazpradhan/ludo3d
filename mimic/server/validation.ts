// Shapes of every payload a browser may send. Anything that doesn't match is rejected before it reaches a room.
import { z } from 'zod';
import { AVATARS, CATEGORIES, DIFFICULTY_SETTINGS, NICKNAME_MAX, RECORD_OPTIONS, ROOM_CODE_PATTERN, ROUND_OPTIONS } from '../shared/constants';

const nickname = z
  .string()
  .transform(s => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Pick a nickname.').max(NICKNAME_MAX, `Nicknames are up to ${NICKNAME_MAX} characters.`));

const code = z
  .string()
  .transform(s => s.trim().toUpperCase())
  .pipe(z.string().regex(ROOM_CODE_PATTERN, 'Room codes are 6 letters and numbers.'));

export const ProfileSchema = z.object({ nickname, avatar: z.enum(AVATARS) }).strict();
export const JoinSchema = z.object({ nickname, avatar: z.enum(AVATARS), code }).strict();
export const ResumeSchema = z.object({ code, token: z.string().min(16).max(64).regex(/^[\w-]+$/) }).strict();
export const GetTakeSchema = z.object({ playerId: z.string().min(1).max(32) }).strict();
export const SettingsSchema = z
  .object({
    rounds: z.union(ROUND_OPTIONS.map(n => z.literal(n)) as [z.ZodLiteral<5>, z.ZodLiteral<8>, z.ZodLiteral<10>]),
    recordSeconds: z.union(RECORD_OPTIONS.map(n => z.literal(n)) as [z.ZodLiteral<15>, z.ZodLiteral<25>]),
    categories: z.array(z.enum(CATEGORIES)).min(1).max(CATEGORIES.length),
    difficulty: z.enum(DIFFICULTY_SETTINGS),
  })
  .partial()
  .strict();

/** Readable first problem, for showing to the player. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input.';
}
