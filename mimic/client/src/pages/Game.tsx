import { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTDOWN_MS, RECORDING_RATE, RESULTS_OUTRO_MS, RESULTS_REVEAL_MS, WORDS_JUDGE_MS, listenLeadMs, scoreLabel } from '../../../shared/constants';
import type { CategoryInfo, PublicPlayer, RoomSnapshot, ScoreParts } from '../../../shared/types';
import { AudioGraph } from '../components/AudioGraph';
import { Avatar, Scoreboard } from '../components/bits';
import { useMimic, useStore } from '../hooks/useMimic';
import { clipAudio, type MicState, openMic, playClip, playPcm, type Recording, record, stopPlayback, unlock } from '../lib/audio';
import { judgeWords, loadJudge, prepareReference } from '../lib/judge';
import { sounds } from '../lib/sound';
import { roundKey } from '../lib/store';
import { LiveTrace, type TracePoint } from '../lib/trace';

const categoryOf = (room: RoomSnapshot, id: string): CategoryInfo | undefined => room.categories.find(c => c.id === id);

/** Re-renders every animation frame while `on`, returning the server clock. */
function useServerTime(on: boolean): number {
  const store = useStore();
  const [now, setNow] = useState(() => store.serverNow());
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const tick = () => {
      setNow(store.serverNow());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Animation frames pause while the page isn't being drawn; this keeps the clock moving anyway.
    const backup = setInterval(() => setNow(store.serverNow()), 200);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(backup);
    };
  }, [on, store]);
  return now;
}

const MIC_HELP: Partial<Record<MicState, string>> = {
  denied: 'Your microphone is blocked, so you can’t record this round. Allow it from the lock/mic icon in the address bar.',
  unsupported: 'This browser can’t record here. Use a recent Chrome, Safari or Firefox over https.',
  error: 'Couldn’t open a microphone. Check one is connected and not used by another app.',
};

export function Game({ room }: { room: RoomSnapshot }) {
  const { me } = useMimic();
  const round = room.round;
  const byId = useMemo(() => new Map(room.players.map(p => [p.id, p])), [room.players]);
  const [mic, setMic] = useState<MicState>('unknown');

  // A player who joined mid-way or reloaded still gets the word judge.
  useEffect(() => loadJudge(), []);

  // Ask for the mic as soon as the round starts, so recording can begin the instant the countdown ends.
  useEffect(() => {
    if (room.phase === 'listen' && mic !== 'ready') void openMic().then(setMic);
  }, [room.phase, mic]);

  if (!round) return null;
  return (
    <div className="game">
      <header className="game__head">
        <div className="progress" aria-label={`Round ${round.number} of ${round.total}`}>
          <span className="progress__label">Round {round.number}<span className="muted">/{round.total}</span></span>
          <span className="progress__bar" aria-hidden="true">
            {Array.from({ length: round.total }, (_, i) => (
              <i key={i} className={i < round.number - 1 ? 'is-done' : i === round.number - 1 ? 'is-now' : ''} />
            ))}
          </span>
        </div>
        <ol className="steps" aria-label="This round">
          {(['listen', 'record', 'results'] as const).map((p, i) => (
            <li key={p} className={room.phase === p ? 'is-now' : ['listen', 'record', 'results'].indexOf(room.phase) > i ? 'is-done' : ''}>
              {['👂 Listen', '🎙️ Copy', '🏆 Scores'][i]}
            </li>
          ))}
        </ol>
        <span className="pill">{categoryOf(room, round.clip.category)?.emoji} {categoryOf(room, round.clip.category)?.label ?? round.clip.category}</span>
      </header>
      {room.phase === 'results' ? (
        // The results bring their own leaderboard, so they get the full width.
        <Results room={room} byId={byId} />
      ) : (
        <div className="game__body">
          <div className="game__main">
            {room.phase === 'listen' && <Listen room={room} mic={mic} />}
            {room.phase === 'record' && <RecordStage room={room} mic={mic} setMic={setMic} />}
          </div>
          <aside className="card game__side" aria-label="Scoreboard">
            <h2 className="side-h">Players</h2>
            <Scoreboard players={room.players} hostId={room.hostId} meId={me?.playerId} done={round.submittedIds} />
          </aside>
        </div>
      )}
    </div>
  );
}

/** Rounds whose sound this page has already played. */
const played = new Set<string>();

/** Plays the clip exactly once, at the same moment for everyone, then counts down 3-2-1. */
function Listen({ room, mic }: { room: RoomSnapshot; mic: MicState }) {
  const store = useStore();
  const round = room.round!;
  const dur = round.clip.duration;
  const playAt = round.phaseStartedAt + listenLeadMs(round.clip);
  const hint = categoryOf(room, round.clip.category)?.hint ?? 'Copy the sound';
  const now = useServerTime(true);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void clipAudio(round.clip) // download it first; the round waits until everyone has it
      .then(async () => {
        if (cancelled) return;
        void prepareReference(round.clip);
        if (round.loading) return store.clipReady(round.number);
        const ok = await unlock();
        if (cancelled) return;
        if (!ok) return setBlocked(true);
        // If it finished downloading late it still plays, right away, so nobody misses the sound. But only
        // once per round: the screen can be shown again (reconnect, re-render) and must not replay it.
        const key = `${room.code}:${roundKey(room)}:${round.clip.id}`;
        if (played.has(key)) return;
        const delay = playAt - store.serverNow();
        timer = setTimeout(() => {
          if (cancelled || played.has(key)) return;
          played.add(key);
          void playClip(round.clip);
        }, Math.max(0, delay));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopPlayback();
    };
  }, [room.code, round.clip.id, round.loading, round.number, playAt, store]);

  const t = (now - playAt) / 1000;
  const playing = t >= 0 && t <= dur;
  const countdownLeft = round.phaseEndsAt - now;
  const counting = !round.loading && countdownLeft <= COUNTDOWN_MS;
  const countNum = counting ? Math.max(1, Math.ceil(countdownLeft / 1000)) : 0;

  // Beep on 3, 2, 1, and a higher beep right before recording starts.
  useEffect(() => {
    if (countNum >= 1 && countNum <= 3) sounds.tick();
  }, [countNum]);
  useEffect(() => {
    const delay = round.phaseEndsAt - 180 - store.serverNow();
    if (delay < 0) return;
    const t = setTimeout(() => sounds.go(), delay);
    return () => clearTimeout(t);
  }, [round.phaseEndsAt, store]);

  return (
    <section className="card stage stage--listen" aria-live="polite">
      {counting ? (
        <>
          <span className="eyebrow">Get ready to copy it</span>
          <span className="count" key={countNum} aria-label={`Recording in ${countNum}`}>
            {countNum}
          </span>
          <p className="muted">Recording starts by itself. {hint}.</p>
        </>
      ) : (
        <>
          <span className="eyebrow">{round.loading ? 'Get ready' : t < 0 ? 'Listen — it plays once' : playing ? 'Listen…' : 'That’s it!'}</span>
          {round.loading ? (
            <p className="stage__big">Loading the sound…</p>
          ) : t < 0 ? (
            <p className="stage__big">
              Sound in{' '}
              <span className="lead-num" key={Math.min(2, Math.ceil(-t))}>
                {Math.max(1, Math.min(Math.round(listenLeadMs(round.clip) / 1000), Math.ceil(-t)))}
              </span>
            </p>
          ) : (
            <p className="stage__big">{playing ? '🔊 Playing' : 'Remember the shape'}</p>
          )}
        </>
      )}
      {/* The playhead waits at the start before the sound, so everyone sees exactly when it begins. */}
      <AudioGraph clip={round.clip} span={round.clip.duration} at={round.loading || t < 0 ? 0 : playing ? t : null} label="Shape of the sound" />
      {blocked && (
        <button type="button" className="btn btn--primary" onClick={() => void unlock().then(ok => ok && setBlocked(false))}>
          🔈 Tap to turn on sound
        </button>
      )}
      {mic !== 'ready' && mic !== 'unknown' && mic !== 'asking' && <p className="mic__help" role="alert">{MIC_HELP[mic]}</p>}
      {mic === 'unknown' && <p className="muted small">Allow the microphone when your browser asks.</p>}
    </section>
  );
}

type RecState = 'waiting' | 'recording' | 'sending' | 'missed';

/** Records one take automatically, for the same length as everyone else, then sends it. */
function RecordStage({ room, mic, setMic }: { room: RoomSnapshot; mic: MicState; setMic: (m: MicState) => void }) {
  const store = useStore();
  const { me, myTake } = useMimic();
  const round = room.round!;
  const [state, setState] = useState<RecState>('waiting');
  const [trace, setTrace] = useState<TracePoint[]>([]);
  const recRef = useRef<Recording | null>(null);
  const traceRef = useRef(new LiveTrace());
  const startedRef = useRef(false);
  const mine = myTake && myTake.key === roundKey(room) ? myTake.feedback : null;
  const submitted = !!mine || (!!me && round.submittedIds.includes(me.playerId));
  const elapsed = trace.length ? trace[trace.length - 1]!.t : 0;

  const finish = async () => {
    const r = recRef.current;
    recRef.current = null;
    if (!r) return;
    setState('sending');
    const pcm = await r.stop();
    if (pcm.length < 0.2 * RECORDING_RATE) return setState('missed');
    // The word judge on this phone checks the words, if it's ready; otherwise the take goes without.
    const words = await judgeWords(round.clip, pcm, RECORDING_RATE, WORDS_JUDGE_MS).catch(() => null);
    const fb = await store.submitTake(pcm, words);
    if (!fb) setState('missed');
  };

  const begin = async () => {
    if (startedRef.current || submitted) return;
    startedRef.current = true;
    // Recording only counts if it starts right as the countdown ends; a late start would get a shorter window.
    if (store.serverNow() - round.phaseStartedAt > 1500) return setState('missed');
    stopPlayback();
    setState('recording');
    traceRef.current = new LiveTrace();
    recRef.current = await record(
      round.maxTakeSec,
      (data, rate) => {
        if (traceRef.current.push(data, rate)) setTrace([...traceRef.current.points]);
      },
      () => void finish(),
    );
  };

  useEffect(() => {
    if (mic === 'ready') void begin();
    // Starting is one-shot per round; `begin` guards against running twice.
  }, [mic]);

  useEffect(() => () => recRef.current?.cancel(), []);

  const waiting = room.players.filter(p => p.connected && !round.submittedIds.includes(p.id)).length;

  if (submitted) {
    return (
      <section className="card stage stage--done" aria-live="polite">
        <span className="eyebrow">Your copy is in</span>
        <p className="stage__big">Take sent ✓</p>
        <p className="muted small">{mine?.verdict === 'silent' ? 'We couldn’t hear much, though…' : 'Scores are revealed after everyone’s been heard. 🤫'}</p>
        <AudioGraph clip={round.clip} span={round.clip.duration} at={null} trace={trace} label="The sound and your copy" />
        <p className="muted">{waiting > 0 ? `Waiting for ${waiting} more…` : 'Everyone’s done!'}</p>
      </section>
    );
  }

  return (
    <section className={'card stage stage--record' + (state === 'recording' ? ' is-live' : '')} aria-live="polite">
      {state === 'recording' ? (
        <>
          <span className="rec-dot" aria-hidden="true" />
          <p className="stage__big">Recording — copy it!</p>
          <p className="muted small">It records for exactly as long as the sound, the same for everyone. Your voice shows in green.</p>
        </>
      ) : state === 'sending' ? (
        <p className="stage__big">Sending your copy…</p>
      ) : state === 'missed' || MIC_HELP[mic] ? (
        <p className="stage__big">No take this round</p>
      ) : (
        <p className="stage__big">{mic === 'ready' ? 'Starting…' : 'Waiting for your microphone…'}</p>
      )}
      <AudioGraph clip={round.clip} span={round.clip.duration} at={state === 'recording' ? elapsed : null} trace={trace} label="The sound and your copy" />
      {state === 'missed' && <p className="muted">You’ll get the next one. Recording starts on its own after the countdown.</p>}
      {mic !== 'ready' && MIC_HELP[mic] && (
        <>
          <p className="mic__help" role="alert">{MIC_HELP[mic]}</p>
          <button type="button" className="btn btn--lime btn--sm" onClick={() => void openMic().then(setMic)}>
            Try the microphone again
          </button>
        </>
      )}
    </section>
  );
}

/** Why a take got its score: how it sounds, its rhythm, its pitch line and its length. */
function Parts({ parts, compact = false }: { parts: ScoreParts; compact?: boolean }) {
  const items: [string, string, number | null][] = [
    ['🗣️', 'Voice', parts.tone],
    ['🥁', 'Rhythm', parts.rhythm],
    ['🎵', 'Pitch', parts.melody],
    ['⏱️', 'Length', parts.length],
    ['💬', 'Words', parts.words ?? null],
  ];
  return (
    <span className={'parts' + (compact ? ' parts--compact' : '')}>
      {items
        .filter(([, , v]) => v !== null)
        .map(([icon, name, v]) => (
          <span key={name} className="part" title={`${name}: ${v}/100`}>
            <span aria-hidden="true">{icon}</span> {compact ? '' : `${name} `}
            <b>{v}</b>
          </span>
        ))}
    </span>
  );
}

/**
 * Plays everyone's take to everyone in a random order with the scores hidden, then a 3-2-1 drumroll, then
 * reveals every score of the round at once. The server sets the timing, so every phone is in step.
 */
function Results({ room, byId }: { room: RoomSnapshot; byId: Map<string, PublicPlayer> }) {
  const store = useStore();
  const { me } = useMimic();
  const res = room.lastResult;
  const round = room.round!;
  const now = useServerTime(true);
  const takes = useRef(new Map<string, Int16Array>());
  const key = `${room.matchNumber}:${res?.number ?? 0}`;

  // Download every take straight away, then play each in its slot.
  useEffect(() => {
    if (!res) return;
    let live = true;
    takes.current = new Map();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const step of res.playlist) {
      if (!step.ms) continue;
      const loaded = store.fetchTake(step.playerId).then(pcm => {
        if (pcm) takes.current.set(step.playerId, pcm);
      });
      const delay = round.phaseStartedAt + step.at - store.serverNow();
      if (delay < -300) continue; // already past (joined late)
      timers.push(
        setTimeout(() => {
          void loaded.then(() => {
            const pcm = takes.current.get(step.playerId);
            if (live && pcm) void playPcm(pcm);
          });
        }, Math.max(0, delay)),
      );
    }
    return () => {
      live = false;
      timers.forEach(clearTimeout);
      stopPlayback();
    };
  }, [key, round.phaseStartedAt, store]);

  const elapsed = now - round.phaseStartedAt;
  const revealAt = res?.revealAt ?? 0;
  const revealed = elapsed >= revealAt;
  // The table keeps the totals from before this round until its scores are revealed.
  const gained = new Map((res?.takes ?? []).filter(t => t.points > 0).map(t => [t.playerId, t.points]));
  const standings = revealed ? room.players : room.players.map(p => ({ ...p, score: p.score - (gained.get(p.id) ?? 0) }));
  const drum = !revealed && elapsed >= revealAt - RESULTS_REVEAL_MS ? Math.max(1, Math.ceil((revealAt - elapsed) / 1000)) : 0;

  // Drumroll beeps on 3, 2, 1, and a higher one as the scores appear.
  useEffect(() => {
    if (drum >= 1 && drum <= 3) sounds.tick();
  }, [drum]);
  const wasRevealed = useRef(revealed);
  useEffect(() => {
    if (revealed && !wasRevealed.current) sounds.go();
    wasRevealed.current = revealed;
  }, [revealed]);

  if (!res) return null;
  const last = round.number >= round.total;
  const takeOf = new Map(res.takes.map(t => [t.playerId, t]));
  const left = round.phaseEndsAt - now;
  const playingNow = res.playlist.find(s => elapsed >= s.at && elapsed < s.at + s.ms) ?? null;
  const allHeard = res.playlist.every(s => elapsed >= s.at + s.ms);

  return (
    <div className="results">
      <section className="card reveal" aria-live="polite">
        <span className="eyebrow">That was</span>
        <p className="reveal__answer">{res.clip.name}</p>
        {drum ? (
          <p className="drumroll" key={drum}>
            Scores in <b>{drum}</b>
          </p>
        ) : (
          <p className="muted small">
            {revealed ? 'Here’s how everyone did!' : playingNow ? `🔊 Playing ${byId.get(playingNow.playerId)?.nickname ?? 'a'}’s take` : allHeard ? 'Everyone’s been heard…' : 'Listening to everyone’s takes…'}
          </p>
        )}
        <ol className={'takes' + (revealed ? ' is-revealed' : '')}>
          {res.playlist.map(step => {
            const t = takeOf.get(step.playerId)!;
            const p = byId.get(step.playerId);
            const state = elapsed < step.at ? 'waiting' : elapsed < step.at + step.ms ? 'playing' : 'heard';
            return (
              <li key={step.playerId} className={`take take--${revealed ? 'shown' : state}` + (step.playerId === me?.playerId ? ' is-me' : '') + (revealed && t.best ? ' is-best' : '')}>
                <span className="take__rank" aria-hidden="true">{state === 'playing' && !revealed ? '🔊' : '🎤'}</span>
                {p && <Avatar id={p.avatar} size={34} />}
                <span className="take__who">
                  {p?.nickname ?? 'Someone'} {revealed && t.best && <span className="tag tag--host">best +30</span>}
                  <span className="take__bar" aria-hidden="true">
                    <i
                      style={{ transform: `scaleX(${revealed ? t.score / 100 : state === 'playing' ? Math.min(1, (elapsed - step.at) / Math.max(1, step.ms)) : state === 'heard' ? 1 : 0})` }}
                      className={revealed ? '' : 'is-progress'}
                    />
                  </span>
                  {revealed && t.parts && <Parts parts={t.parts} compact />}
                  <span className="take__label">
                    {revealed
                      ? t.verdict === 'none' ? 'No take' : t.verdict === 'silent' ? 'Silent' : t.verdict === 'replay' ? 'Replay — not counted' : scoreLabel(t.score)
                      : state === 'playing' ? '🔊 Playing…' : state === 'heard' ? (step.ms ? 'Heard ✓' : 'No take') : 'Up next'}
                  </span>
                </span>
                <span className="take__score">{revealed ? t.score : '?'}</span>
              </li>
            );
          })}
        </ol>
        {revealed && (
          <div className="next-bar" role="timer" aria-label="Next round">
            <span>{last ? 'Final results in' : 'Next sound in'} {Math.max(0, Math.ceil(left / 1000))}</span>
            <i style={{ transform: `scaleX(${Math.max(0, left / RESULTS_OUTRO_MS)})` }} />
          </div>
        )}
      </section>
      <section className="card">
        <h2 className="side-h">Players</h2>
        <Scoreboard players={standings} hostId={room.hostId} meId={me?.playerId} highlight={revealed ? gained : undefined} />
      </section>
    </div>
  );
}
