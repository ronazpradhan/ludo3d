import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_HINTS, CATEGORY_LABELS, LISTEN_GAP_MS, LISTEN_LEAD_MS, RESULTS_MS, scoreLabel } from '../../../shared/constants';
import { clipDuration } from '../../../shared/synth';
import type { PublicPlayer, RoomSnapshot, TakeResult } from '../../../shared/types';
import { Avatar, Countdown, Scoreboard } from '../components/bits';
import { useCountdown, useMimic, useStore } from '../hooks/useMimic';
import { type MicState, openMic, playClip, playPcm, type Recording, record, stopPlayback, unlock } from '../lib/audio';
import { roundKey } from '../lib/store';

function Difficulty({ d }: { d: 'easy' | 'medium' | 'hard' }) {
  const n = { easy: 1, medium: 2, hard: 3 }[d];
  return (
    <span className={`diff diff--${d}`} aria-label={`${d} difficulty`}>
      {[1, 2, 3].map(i => <i key={i} className={i <= n ? 'on' : ''} />)}
      <span>{d}</span>
    </span>
  );
}

export function Game({ room }: { room: RoomSnapshot }) {
  const { me } = useMimic();
  const round = room.round;
  const byId = useMemo(() => new Map(room.players.map(p => [p.id, p])), [room.players]);
  if (!round) return null;
  return (
    <div className="game">
      <header className="game__head">
        <span className="eyebrow">Round {round.number} of {round.total}</span>
        <span className="pill">{CATEGORY_LABELS[round.clip.category]}</span>
        <Difficulty d={round.clip.difficulty} />
      </header>
      <div className="game__body">
        <div className="game__main">
          {room.phase === 'listen' && <Listen room={room} />}
          {room.phase === 'record' && <RecordStage room={room} />}
          {room.phase === 'results' && <Results room={room} byId={byId} />}
        </div>
        <aside className="card game__side" aria-label="Scoreboard">
          <h2 className="side-h">Scores</h2>
          <Scoreboard players={room.players} hostId={room.hostId} meId={me?.playerId} done={round.submittedIds} />
        </aside>
      </div>
    </div>
  );
}

/** Plays the clip twice on the server's schedule so everyone hears it at the same moment. */
function Listen({ room }: { room: RoomSnapshot }) {
  const store = useStore();
  const round = room.round!;
  const [blocked, setBlocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const dur = clipDuration(round.clip);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void unlock().then(ok => {
      if (cancelled) return;
      if (!ok) return setBlocked(true);
      const at = (ms: number) => Math.max(0, round.phaseStartedAt + ms - store.serverNow());
      for (const ms of [LISTEN_LEAD_MS, LISTEN_LEAD_MS + dur * 1000 + LISTEN_GAP_MS]) {
        const delay = at(ms);
        if (delay === 0 && ms > LISTEN_LEAD_MS) continue; // joined late: skip a repeat that's already over
        timers.push(
          setTimeout(() => {
            setPlaying(true);
            void playClip(round.clip.id, round.clip).then(() => !cancelled && setPlaying(false));
          }, delay),
        );
      }
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      stopPlayback();
    };
  }, [round.clip, round.phaseStartedAt, dur, store]);

  return (
    <section className="card stage stage--listen" aria-live="polite">
      <div className={'speaker' + (playing ? ' is-playing' : '')} aria-hidden="true">
        <span /><span /><span />🔊
      </div>
      <p className="stage__big">Listen carefully…</p>
      <p className="muted">{CATEGORY_HINTS[round.clip.category]}. It plays twice, then you record.</p>
      <Countdown endsAt={round.phaseEndsAt} totalMs={round.phaseEndsAt - round.phaseStartedAt} size={84} label="Recording starts in" />
      {blocked && (
        <button type="button" className="btn btn--primary" onClick={() => void unlock().then(ok => ok && (setBlocked(false), void playClip(round.clip.id, round.clip)))}>
          🔈 Tap to turn on sound
        </button>
      )}
    </section>
  );
}

type RecState = 'idle' | 'recording' | 'review' | 'sending';

function RecordStage({ room }: { room: RoomSnapshot }) {
  const store = useStore();
  const { me, myTake, busy } = useMimic();
  const round = room.round!;
  const [mic, setMic] = useState<MicState>('unknown');
  const [state, setState] = useState<RecState>('idle');
  const [level, setLevel] = useState(0);
  const [take, setTake] = useState<Int16Array | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<Recording | null>(null);
  const left = useCountdown(round.phaseEndsAt);
  const mine = myTake && myTake.key === roundKey(room) ? myTake.feedback : null;
  const submitted = !!mine || (!!me && round.submittedIds.includes(me.playerId));

  const stop = async () => {
    const r = recRef.current;
    recRef.current = null;
    if (!r) return;
    const pcm = await r.stop();
    setTake(pcm);
    setState('review');
    setLevel(0);
  };

  const start = async () => {
    stopPlayback();
    const m = await openMic();
    setMic(m);
    if (m !== 'ready') return;
    setTake(null);
    setElapsed(0);
    setState('recording');
    const t0 = performance.now();
    recRef.current = await record(
      round.maxTakeSec,
      v => {
        setLevel(l => Math.max(v, l * 0.8));
        setElapsed((performance.now() - t0) / 1000);
      },
      () => void stop(),
    );
  };

  const send = async () => {
    if (!take) return;
    setState('sending');
    const fb = await store.submitTake(take);
    if (!fb) setState('review');
  };

  // Out of time with a take recorded but not sent: send it rather than lose it.
  useEffect(() => {
    if (left < 1200 && state === 'review' && take && !submitted) void send();
    if (left < 600 && state === 'recording') void stop();
  }, [left < 1200, left < 600]);

  useEffect(() => () => recRef.current?.cancel(), []);

  const waiting = room.players.filter(p => p.connected && !round.submittedIds.includes(p.id)).length;

  if (submitted) {
    return (
      <section className="card stage stage--done" aria-live="polite">
        <Countdown endsAt={round.phaseEndsAt} totalMs={room.settings.recordSeconds * 1000} size={84} label="Time" />
        {mine ? (
          <>
            <span className="eyebrow">Your copy scored</span>
            <p className="big-score">{mine.score}</p>
            <p className="stage__big">{mine.verdict === 'silent' ? 'We couldn’t hear you' : mine.verdict === 'replay' ? 'That sounded like a replay' : scoreLabel(mine.score)}</p>
          </>
        ) : (
          <p className="stage__big">Take sent ✓</p>
        )}
        <p className="muted">{waiting > 0 ? `Waiting for ${waiting} more…` : 'Everyone’s done!'}</p>
      </section>
    );
  }

  return (
    <section className="card stage stage--record">
      <Countdown endsAt={round.phaseEndsAt} totalMs={room.settings.recordSeconds * 1000} size={96} label="Time to record" />
      <p className="stage__big">{state === 'recording' ? 'Recording… copy it!' : state === 'review' ? 'How was that?' : 'Your turn to copy it'}</p>
      <p className="muted">{CATEGORY_HINTS[round.clip.category]} · up to {round.maxTakeSec}s</p>

      {state === 'recording' ? (
        <>
          <span className="meter meter--big" aria-hidden="true"><i style={{ transform: `scaleX(${level})` }} /></span>
          <div className="take-bar" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, elapsed / round.maxTakeSec)})` }} /></div>
          <button type="button" className="rec-btn is-on" onClick={() => void stop()} aria-label="Stop recording"><span /></button>
        </>
      ) : state === 'review' || state === 'sending' ? (
        <div className="review">
          <button type="button" className="btn btn--ghost" disabled={state === 'sending'} onClick={() => take && void playPcm(take)}>▶ Listen back</button>
          <button type="button" className="btn btn--ghost" disabled={state === 'sending'} onClick={() => void playClip(round.clip.id, round.clip)}>▶ Original</button>
          <button type="button" className="btn btn--ghost" disabled={state === 'sending'} onClick={() => void start()}>↺ Try again</button>
          <button type="button" className="btn btn--primary btn--big" disabled={state === 'sending' || busy} onClick={() => void send()}>
            {state === 'sending' ? 'Scoring…' : 'Send my take'}
          </button>
        </div>
      ) : (
        <>
          <button type="button" className="rec-btn" onClick={() => void start()} aria-label="Start recording"><span /></button>
          <button type="button" className="btn btn--text btn--sm" onClick={() => void playClip(round.clip.id, round.clip)}>▶ Hear it again</button>
        </>
      )}

      {mic === 'denied' && <p className="mic__help" role="alert">Microphone is blocked. Allow it from the lock/mic icon in the address bar, then tap record again.</p>}
      {mic === 'unsupported' && <p className="mic__help" role="alert">This browser can’t record here. Use a recent browser over https.</p>}
      {mic === 'error' && <p className="mic__help" role="alert">Couldn’t open a microphone. Is one connected?</p>}
    </section>
  );
}

function Results({ room, byId }: { room: RoomSnapshot; byId: Map<string, PublicPlayer> }) {
  const store = useStore();
  const { me } = useMimic();
  const res = room.lastResult;
  const round = room.round!;
  const left = useCountdown(round.phaseEndsAt);
  const [playing, setPlaying] = useState<string | null>(null);
  if (!res) return null;
  const last = round.number >= round.total;

  const play = async (t: TakeResult) => {
    setPlaying(t.playerId);
    const pcm = await store.fetchTake(t.playerId);
    if (pcm) await playPcm(pcm);
    setPlaying(p => (p === t.playerId ? null : p));
  };

  return (
    <div className="results">
      <section className="card reveal" aria-live="assertive">
        <span className="eyebrow">That was</span>
        <p className="reveal__answer">{res.clip.name}</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void playClip(round.clip.id, round.clip)}>▶ Play original</button>
        <ol className="takes">
          {res.takes.map((t, i) => {
            const p = byId.get(t.playerId);
            return (
              <li key={t.playerId} className={'take' + (t.playerId === me?.playerId ? ' is-me' : '') + (t.best ? ' is-best' : '')}>
                <span className="take__rank">{i + 1}</span>
                {p && <Avatar id={p.avatar} size={34} />}
                <span className="take__who">
                  {p?.nickname ?? 'Someone'} {t.best && <span className="tag tag--host">best +30</span>}
                  <span className="take__bar" aria-hidden="true"><i style={{ transform: `scaleX(${t.score / 100})` }} /></span>
                  <span className="take__label">{t.verdict === 'none' ? 'No take' : t.verdict === 'silent' ? 'Silent' : t.verdict === 'replay' ? 'Replay — not counted' : scoreLabel(t.score)}</span>
                </span>
                <span className="take__score">{t.score}</span>
                {t.hasAudio && (
                  <button type="button" className="icon-btn" aria-label={`Play ${p?.nickname ?? 'this'} take`} disabled={playing !== null} onClick={() => void play(t)}>
                    {playing === t.playerId ? '…' : '▶'}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
      <section className="card">
        <h2 className="side-h">Leaderboard</h2>
        <Scoreboard players={room.players} hostId={room.hostId} meId={me?.playerId} highlight={new Map(res.takes.map(t => [t.playerId, t.points]))} />
        <div className="next-bar" role="timer" aria-label="Next round">
          <span>{last ? 'Final results in' : 'Next sound in'} {Math.ceil(left / 1000)}</span>
          <i style={{ transform: `scaleX(${left / RESULTS_MS})` }} />
        </div>
      </section>
    </div>
  );
}
