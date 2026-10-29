import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS, LISTEN_LEAD_MS, LISTEN_TAIL_MS, MAX_PLAYERS, POINTS, UPLOAD_GRACE_MS } from '../shared/constants';
import { DEFAULT_TIMING } from '../server/game-engine';
import { roundPoints } from '../server/scoring';
import { makeRoom, pcmOf, silence, TIMING } from './helpers';

const ROUND = TIMING.listenMs! + TIMING.recordMs! + TIMING.resultsMs;

describe('points', () => {
  it('pays the similarity score, plus a bonus for the best take', () => {
    const r = roundPoints([
      { playerId: 'a', score: 80, verdict: 'ok', hasAudio: true },
      { playerId: 'b', score: 60, verdict: 'ok', hasAudio: true },
      { playerId: 'c', score: 0, verdict: 'none', hasAudio: false },
    ]);
    expect(r.map(t => [t.playerId, t.points, t.best])).toEqual([
      ['a', 80 + POINTS.bestTakeBonus, true],
      ['b', 60, false],
      ['c', 0, false],
    ]);
  });
  it('shares the bonus on a tie and gives none when everyone scored 0', () => {
    expect(roundPoints([{ playerId: 'a', score: 70, verdict: 'ok', hasAudio: true }, { playerId: 'b', score: 70, verdict: 'ok', hasAudio: true }]).every(t => t.best)).toBe(true);
    expect(roundPoints([{ playerId: 'a', score: 0, verdict: 'silent', hasAudio: true }]).some(t => t.best)).toBe(false);
  });
});

describe('lobby rules', () => {
  it('needs two connected players to start', () => {
    const { room } = makeRoom(1);
    expect(room.start('p1')).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
    const two = makeRoom(2);
    two.room.setConnected('p2', null);
    expect(two.room.start('p1')).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
  });
  it('caps rooms at ten players and rejects duplicate nicknames', () => {
    const { room } = makeRoom(MAX_PLAYERS);
    expect(room.addPlayer({ id: 'x', nickname: 'Extra', avatar: 'owl', tokenHash: 'x' })).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    const small = makeRoom(2);
    expect(small.room.addPlayer({ id: 'x', nickname: 'PLAYER 1', avatar: 'owl', tokenHash: 'x' })).toMatchObject({ ok: false, code: 'NAME_TAKEN' });
  });
  it('only lets the host start or change settings, and locks settings during a match', () => {
    const { room, startRecording } = makeRoom(2);
    expect(room.start('p2')).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(room.updateSettings('p2', { rounds: 5 })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(room.updateSettings('p1', { categories: [] })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(room.updateSettings('p1', { rounds: 5 })).toEqual({ ok: true });
    startRecording();
    expect(room.updateSettings('p1', { rounds: 10 })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    expect(room.addPlayer({ id: 'x', nickname: 'Late', avatar: 'owl', tokenHash: 'x' })).toMatchObject({ ok: false, code: 'MATCH_IN_PROGRESS' });
  });
});

describe('a round', () => {
  it('goes listen -> record -> results, with the clip public but its name hidden until the results', () => {
    const { room, clock, clip } = makeRoom(2);
    room.start('p1');
    const s = room.snapshot();
    expect(s.phase).toBe('listen');
    expect(s.round!.clip.events!.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toContain(`"name":"${clip().name}"`);
    clock.advance(TIMING.listenMs!);
    expect(room.snapshot().phase).toBe('record');
    clock.advance(TIMING.recordMs!);
    const res = room.snapshot();
    expect(res.phase).toBe('results');
    expect(res.lastResult!.clip.name).toBe(clip().name);
  });

  it('only accepts takes while recording, one per player', () => {
    const { room, clock, goodTake } = makeRoom(3);
    room.start('p1');
    expect(room.submitTake('p1', goodTake())).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    clock.advance(TIMING.listenMs!);
    expect(room.submitTake('p1', goodTake())).toMatchObject({ ok: true });
    expect(room.submitTake('p1', goodTake())).toMatchObject({ ok: false, code: 'ALREADY_SUBMITTED' });
    expect(room.snapshot().round!.submittedIds).toEqual(['p1']);
  });

  it('rejects takes that are too short or too long', () => {
    const { room, startRecording } = makeRoom(2);
    startRecording();
    const max = room.snapshot().round!.maxTakeSec;
    expect(room.submitTake('p1', silence(0.1))).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(room.submitTake('p1', silence(max + 1))).toMatchObject({ ok: false, code: 'BAD_INPUT' });
  });

  it('scores a good copy well, and silence as 0', () => {
    const { room, startRecording, goodTake } = makeRoom(2);
    startRecording();
    const good = room.submitTake('p1', goodTake());
    const quiet = room.submitTake('p2', silence(2));
    expect(good.ok && good.feedback.score).toBeGreaterThanOrEqual(60);
    expect(quiet).toMatchObject({ ok: true, feedback: { score: 0, verdict: 'silent' } });
  });

  it('ends early once every connected player has sent a take, and awards points', () => {
    const { room, startRecording, goodTake, score } = makeRoom(2);
    startRecording();
    room.submitTake('p1', goodTake());
    expect(room.snapshot().phase).toBe('record');
    room.submitTake('p2', silence(1));
    const s = room.snapshot();
    expect(s.phase).toBe('results');
    const best = s.lastResult!.takes[0]!;
    expect(best.playerId).toBe('p1');
    expect(best.best).toBe(true);
    expect(score('p1')).toBe(best.score + POINTS.bestTakeBonus);
    expect(score('p2')).toBe(0);
  });

  it('does not wait for players who disconnected', () => {
    const { room, startRecording, goodTake } = makeRoom(3);
    startRecording();
    room.submitTake('p1', goodTake());
    room.submitTake('p2', goodTake());
    room.setConnected('p3', null);
    expect(room.snapshot().phase).toBe('results');
    expect(room.snapshot().lastResult!.takes.find(t => t.playerId === 'p3')).toMatchObject({ verdict: 'none', points: 0 });
  });

  it('shares takes for playback only during that round’s results', () => {
    const { room, clock, startRecording, goodTake } = makeRoom(2);
    startRecording();
    const take = goodTake();
    room.submitTake('p1', take);
    expect(room.takeAudio('p2', 'p1')).toBeNull(); // still recording
    clock.advance(TIMING.recordMs!);
    expect(room.takeAudio('p2', 'p1')).toEqual(take);
    expect(room.takeAudio('stranger', 'p1')).toBeNull();
    clock.advance(TIMING.resultsMs);
    expect(room.takeAudio('p2', 'p1')).toBeNull(); // next round
  });

  it('a timer from an earlier phase cannot end a later round', () => {
    const { room, clock, startRecording, goodTake } = makeRoom(2);
    startRecording();
    room.submitTake('p1', goodTake());
    room.submitTake('p2', goodTake()); // round 1 ends early
    clock.advance(TIMING.resultsMs + TIMING.listenMs!);
    expect(room.snapshot()).toMatchObject({ phase: 'record', round: { number: 2 } });
    clock.advance(TIMING.recordMs! - 1000); // the old round-1 deadline passes in here
    expect(room.snapshot()).toMatchObject({ phase: 'record', round: { number: 2 } });
  });
});

describe('categories and visibility', () => {
  it('rejects unknown categories and an empty choice, and treats "every category" as all', () => {
    const { room } = makeRoom(2);
    expect(room.updateSettings('p1', { categories: ['klingon'] })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(room.updateSettings('p1', { categories: [] })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(room.updateSettings('p1', { categories: room.snapshot().categories.map(c => c.id) })).toEqual({ ok: true });
    expect(room.settings.categories).toEqual([]);
  });
  it('lists the library categories with their sound counts', () => {
    const { room } = makeRoom(2);
    const cats = room.snapshot().categories;
    expect(cats.map(c => c.id)).toEqual(['melody', 'glide', 'rhythm', 'fx']);
    expect(cats.every(c => c.count > 0 && c.label && c.emoji)).toBe(true);
  });
  it('is private until the host makes it public', () => {
    const { room } = makeRoom(2);
    expect(room.listing()).toBeNull();
    expect(room.updateSettings('p2', { visibility: 'public' })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    room.updateSettings('p1', { visibility: 'public' });
    expect(room.listing()).toMatchObject({ code: 'ABCDEF', players: 2, playing: false });
  });
});

describe('fair timing', () => {
  it('plays the sound once, counts down 3 seconds, then gives everyone the same fixed take window', () => {
    const { room, clock, clip } = makeRoom(2, DEFAULT_TIMING);
    room.start('p1');
    const listen = room.snapshot().round!;
    const listenMs = Math.round(LISTEN_LEAD_MS + clip().duration * 1000 + LISTEN_TAIL_MS + COUNTDOWN_MS);
    expect(listen.phaseEndsAt - listen.phaseStartedAt).toBe(listenMs);
    clock.advance(listenMs);
    const rec = room.snapshot().round!;
    expect(room.snapshot().phase).toBe('record');
    expect(rec.maxTakeSec).toBeLessThanOrEqual(clip().duration + 2.1);
    expect(rec.phaseEndsAt - rec.phaseStartedAt).toBe(rec.maxTakeSec * 1000 + UPLOAD_GRACE_MS);
  });
});

describe('a match', () => {
  it('plays the configured number of rounds without repeating a clip, then finishes', () => {
    const { room, clock } = makeRoom(2);
    room.updateSettings('p1', { rounds: 10 });
    room.start('p1');
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const s = room.snapshot();
      expect(s.round).toMatchObject({ number: i + 1, total: 10 });
      expect(seen.has(s.round!.clip.id)).toBe(false);
      seen.add(s.round!.clip.id);
      clock.advance(ROUND);
    }
    expect(room.snapshot().phase).toBe('finished');
  });

  it('only uses clips from the chosen categories', () => {
    const { room, clock } = makeRoom(2);
    expect(room.updateSettings('p1', { categories: ['rhythm', 'fx'], rounds: 5 })).toEqual({ ok: true });
    room.start('p1');
    for (let i = 0; i < 5; i++) {
      expect(['rhythm', 'fx']).toContain(room.snapshot().round!.clip.category);
      clock.advance(ROUND);
    }
  });

  it('hands the host role on when the host leaves, and ends when one player is left', () => {
    const { room, startRecording } = makeRoom(3);
    startRecording();
    room.removePlayer('p1');
    expect(room.hostId).toBe('p2');
    expect(room.snapshot().phase).toBe('record');
    room.removePlayer('p2');
    expect(room.snapshot().phase).toBe('finished');
  });

  it('rematch resets scores; back to lobby resets too', () => {
    const { room, clock, startRecording, goodTake } = makeRoom(2);
    room.updateSettings('p1', { rounds: 5 });
    startRecording();
    room.submitTake('p1', goodTake());
    clock.advance(10 * ROUND);
    expect(room.snapshot().phase).toBe('finished');
    expect(room.snapshot().players.some(p => p.score > 0)).toBe(true);
    expect(room.rematch('p2')).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(room.rematch('p1')).toEqual({ ok: true });
    expect(room.snapshot()).toMatchObject({ phase: 'listen', matchNumber: 2 });
    expect(room.snapshot().players.every(p => p.score === 0)).toBe(true);
    clock.advance(10 * ROUND);
    expect(room.backToLobby('p1')).toEqual({ ok: true });
    expect(room.snapshot().phase).toBe('lobby');
  });

  it('never shows anyone’s recording in public snapshots', () => {
    const { room, rec, startRecording, goodTake } = makeRoom(2);
    startRecording();
    room.submitTake('p1', pcmOf(new Float32Array(12_000).fill(0.123)));
    room.submitTake('p2', goodTake());
    for (const s of rec.states) expect(JSON.stringify(s).length).toBeLessThan(20_000);
  });
});
