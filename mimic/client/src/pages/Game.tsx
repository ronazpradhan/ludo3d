import { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTDOWN_MS, listenLeadMs, RESULTS_OUTRO_MS, RESULTS_SCORE_MS, scoreLabel } from '../../../shared/constants';
import type { CategoryInfo, PublicPlayer, RoomSnapshot, ScoreParts } from '../../../shared/types';
import { AudioGraph } from '../components/AudioGraph';
import { Avatar, Scoreboard } from '../components/bits';
import { useMimic, useStore } from '../hooks/useMimic';
import { clipAudio, type MicState, openMic, playClip, playPcm, type Recording, record, stopPlayback, unlock } from '../lib/audio';
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

  // Ask for the mic as soon as the round starts, so recording can begin the instant the countdown ends.
  useEffect(() => {
    if (room.phase === 'listen' && mic !== 'ready') void openMic().then(setMic);
  }, [room.phase, mic]);

  if (!round) return null;
  return (
    <div className="game">
      <header className="game__head">
        <span className="eyebrow">Round {round.number} of {round.total}</span>
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
            <h2 className="side-h">Scores</h2>
            <Scoreboard players={room.players} hostId={room.hostId} meId={me?.playerId} done={round.submittedIds} />
          </aside>
        </div>
      )}
    </div>
  );
}

/** Plays the clip exactly once, at the same moment for everyone, then counts down 3-2-1. */
function Listen({ room, mic }: { room: RoomSnapshot; mic: MicState }) {
  const store = useStore();
  const round = room.round!;
  const dur = round.clip.duration;
  const playAt = round.phaseStartedAt + listenLeadMs(round.clip);
  const hint = categoryOf(room, round.clip.category)?.hint ?? 'Copy the sound';
  const now = useServerTime(true);
  const [missed, setMissed] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void unlock()
      .then(async ok => {
        if (cancelled) return;
        if (!ok) return setBlocked(true);
        await clipAudio(round.clip); // download/prepare it before its slot
        if (cancelled) return;
        const delay = playAt - store.serverNow();
        // Joined, reloaded or downloaded too late: the sound isn't replayed, that would be unfair.
        if (delay < -250) return setMissed(true);
        timer = setTimeout(() => void playClip(round.clip), Math.max(0, delay));
      })
      .catch(() => !cancelled && setMissed(true));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopPlayback();
    };
  }, [round.clip.id, playAt, store]);

  const t = (now - playAt) / 1000;
  const playing = t >= 0 && t <= dur;
  const countdownLeft = round.phaseEndsAt - now;
  const counting = countdownLeft <= COUNTDOWN_MS;
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
          <span className="eyebrow">{t < 0 ? 'Listen — it plays once' : playing ? 'Listen…' : 'That’s it!'}</span>
          {t < 0 ? (
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
      <AudioGraph clip={round.clip} span={round.clip.duration} at={t < 0 ? 0 : playing ? t : null} label="Shape of the sound" />
      {missed && <p className="mic__help">You missed the sound this time. It doesn’t repeat — follow the graph for this one.</p>}
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

/**
 * Ends a take once the player has made some sound and then gone quiet, so nobody records long silence.
 * The room's own noise is measured in the first moments and the thresholds sit above it.
 */
class VoiceStop {
  private t = 0;
  private floor = Infinity;
  private voiced = 0;
  private quiet = 0;
  push(data: Float32Array, rate: number): boolean {
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / Math.max(1, data.length));
    const dt = data.length / rate;
    this.t += dt;
    if (this.t < 0.3) this.floor = Math.min(this.floor, rms);
    const floor = Number.isFinite(this.floor) ? this.floor : 0;
    if (rms > Math.max(0.02, floor * 3)) {
      this.voiced += dt;
      this.quiet = 0;
    } else if (rms < Math.max(0.012, floor * 1.8)) {
      this.quiet += dt;
    }
    return this.voiced > 0.15 && this.quiet > 0.9;
  }
}

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
    if (pcm.length < 0.2 * 12_000) return setState('missed');
    const fb = await store.submitTake(pcm);
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
    const vad = new VoiceStop();
    recRef.current = await record(
      round.maxTakeSec,
      (data, rate) => {
        if (traceRef.current.push(data, rate)) setTrace([...traceRef.current.points]);
        if (vad.push(data, rate)) void finish();
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
        {mine ? (
          <>
            <span className="eyebrow">Your copy scored</span>
            <p className="big-score">{mine.score}</p>
            <p className="stage__big">{mine.verdict === 'silent' ? 'We couldn’t hear you' : mine.verdict === 'replay' ? 'That sounded like a replay' : scoreLabel(mine.score)}</p>
            {mine.parts && <Parts parts={mine.parts} />}
          </>
        ) : (
          <p className="stage__big">Take sent ✓</p>
        )}
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
          <p className="muted small">It stops by itself when you go quiet. Your voice shows in green.</p>
        </>
      ) : state === 'sending' ? (
        <p className="stage__big">Scoring your copy…</p>
      ) : state === 'missed' || MIC_HELP[mic] ? (
        <p className="stage__big">No take this round</p>
      ) : (
        <p className="stage__big">{mic === 'ready' ? 'Starting…' : 'Waiting for your microphone…'}</p>
      )}
      <AudioGraph clip={round.clip} span={round.clip.duration} at={state === 'recording' ? elapsed : null} trace={trace} label="The sound and your copy" />
      {state === 'recording' && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void finish()}>
          I’m done
        </button>
      )}
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
 * Plays everyone's take to everyone, worst first and best last, revealing each score right after its take.
 * The server sets the timing (the playlist), so every phone plays the same take at the same moment.
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

  if (!res) return null;
  const last = round.number >= round.total;
  const elapsed = now - round.phaseStartedAt;
  const takeOf = new Map(res.takes.map(t => [t.playerId, t]));
  const current = res.playlist.find(s => elapsed < s.at + s.ms + RESULTS_SCORE_MS);
  const allShown = !current;
  const left = round.phaseEndsAt - now;
  const playingNow = current && elapsed >= current.at && elapsed < current.at + current.ms ? current : null;

  return (
    <div className="results">
      <section className="card reveal" aria-live="polite">
        <span className="eyebrow">That was</span>
        <p className="reveal__answer">{res.clip.name}</p>
        <p className="muted small">
          {allShown ? 'Everyone’s been heard!' : playingNow ? `🔊 Playing ${byId.get(playingNow.playerId)?.nickname ?? 'a'}’s take` : 'Listening to everyone’s takes…'}
        </p>
        <ol className="takes">
          {res.playlist.map((step, i) => {
            const t = takeOf.get(step.playerId)!;
            const p = byId.get(step.playerId);
            const state = elapsed < step.at ? 'waiting' : elapsed < step.at + step.ms ? 'playing' : 'shown';
            const shown = state === 'shown';
            return (
              <li
                key={step.playerId}
                className={`take take--${state}` + (step.playerId === me?.playerId ? ' is-me' : '') + (shown && t.best ? ' is-best' : '')}
              >
                <span className="take__rank">{res.playlist.length - i}</span>
                {p && <Avatar id={p.avatar} size={34} />}
                <span className="take__who">
                  {p?.nickname ?? 'Someone'} {shown && t.best && <span className="tag tag--host">best +30</span>}
                  <span className="take__bar" aria-hidden="true">
                    <i style={{ transform: `scaleX(${shown ? t.score / 100 : state === 'playing' ? Math.min(1, (elapsed - step.at) / Math.max(1, step.ms)) : 0})` }} className={state === 'playing' ? 'is-progress' : ''} />
                  </span>
                  {shown && t.parts && <Parts parts={t.parts} compact />}
                  <span className="take__label">
                    {state === 'playing' ? '🔊 Playing…' : !shown ? 'Up next' : t.verdict === 'none' ? 'No take' : t.verdict === 'silent' ? 'Silent' : t.verdict === 'replay' ? 'Replay — not counted' : scoreLabel(t.score)}
                  </span>
                </span>
                <span className="take__score">{shown ? t.score : '?'}</span>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="card">
        <h2 className="side-h">Leaderboard</h2>
        {allShown ? (
          <>
            <Scoreboard players={room.players} hostId={room.hostId} meId={me?.playerId} highlight={new Map(res.takes.map(t => [t.playerId, t.points]))} />
            <div className="next-bar" role="timer" aria-label="Next round">
              <span>{last ? 'Final results in' : 'Next sound in'} {Math.max(0, Math.ceil(left / 1000))}</span>
              <i style={{ transform: `scaleX(${Math.max(0, left / RESULTS_OUTRO_MS)})` }} />
            </div>
          </>
        ) : (
          <p className="muted">Scores update after everyone’s take has played.</p>
        )}
      </section>
    </div>
  );
}
