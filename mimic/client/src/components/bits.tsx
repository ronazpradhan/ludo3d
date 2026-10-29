// Small presentational pieces shared by the screens.
import type { ReactNode } from 'react';
import { AVATAR_EMOJI, AVATARS } from '../../../shared/constants';
import type { Avatar as AvatarId, PublicPlayer } from '../../../shared/types';
import { useCountdown, useMimic, useMuted, useStore } from '../hooks/useMimic';
import { setMuted, unlockAudio } from '../lib/sound';

const AVATAR_HUE: Record<AvatarId, number> = {
  fox: 18, panda: 250, frog: 110, octopus: 330, owl: 35, tiger: 28, monkey: 22, penguin: 210, turtle: 150, bee: 48, dino: 130, whale: 200,
};

export function Avatar({ id, size = 48, dim = false }: { id: AvatarId; size?: number; dim?: boolean }) {
  return (
    <span className={'avatar' + (dim ? ' avatar--dim' : '')} style={{ width: size, height: size, fontSize: size * 0.56, ['--h' as string]: AVATAR_HUE[id] }} aria-hidden="true">
      {AVATAR_EMOJI[id]}
    </span>
  );
}

export function AvatarPicker({ value, onChange }: { value: AvatarId; onChange: (a: AvatarId) => void }) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="Avatar">
      {AVATARS.map(a => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={a === value}
          aria-label={a}
          className={'avatar-picker__item' + (a === value ? ' is-on' : '')}
          onClick={() => onChange(a)}
        >
          <Avatar id={a} size={40} />
        </button>
      ))}
    </div>
  );
}

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`logo logo--${size}`}>
      <svg className="logo__mark" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 4c16 0 27 10 27 25 0 17-12 31-27 31S5 46 5 29C5 14 16 4 32 4z" fill="var(--purple)" />
        <path d="M17 24c3-4 8-4 11 0" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" fill="none" />
        <circle cx="44" cy="25" r="5" fill="var(--ink)" />
        <path d="M38 14l11-3" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
        <path d="M20 38c6 10 18 10 25 0z" fill="var(--lime)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <span className="logo__word">mimic</span>
    </span>
  );
}

export function MuteButton() {
  const muted = useMuted();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={muted}
      aria-label={muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off'}
      onClick={() => {
        unlockAudio();
        setMuted(!muted);
      }}
    >
      {muted ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
      )}
    </button>
  );
}

export function ConnectionBanner() {
  const { connection, me } = useMimic();
  if (connection === 'online' || !me) return null;
  return (
    <div className="banner" role="status">
      <span className="spinner" aria-hidden="true" /> {connection === 'offline' ? 'Connection lost. Reconnecting…' : 'Reconnecting…'}
    </div>
  );
}

export function Toast() {
  const { notice } = useMimic();
  const store = useStore();
  if (!notice) return null;
  return (
    <div key={notice.id} className={`toast toast--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      <button type="button" className="toast__x" aria-label="Dismiss" onClick={() => store.dismissNotice()}>
        ×
      </button>
    </div>
  );
}

/** Big ring countdown driven by a server deadline. */
export function Countdown({ endsAt, totalMs, size = 120, label }: { endsAt: number; totalMs: number; size?: number; label: string }) {
  const left = useCountdown(endsAt);
  const secs = Math.ceil(left / 1000);
  const frac = Math.max(0, Math.min(1, left / totalMs));
  const r = 44;
  const c = 2 * Math.PI * r;
  const urgent = secs <= 5;
  return (
    <div className={'countdown' + (urgent ? ' is-urgent' : '')} style={{ width: size, height: size }} role="timer" aria-label={`${label}: ${secs} seconds left`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="countdown__track" />
        <circle cx="50" cy="50" r={r} className="countdown__bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span className="countdown__num" aria-hidden="true">{secs}</span>
    </div>
  );
}

export function PlayerChip({ p, hostId, meId, right }: { p: PublicPlayer; hostId: string; meId?: string | undefined; right?: ReactNode }) {
  return (
    <div className={'chip' + (p.connected ? '' : ' chip--away')}>
      <Avatar id={p.avatar} size={36} dim={!p.connected} />
      <span className="chip__name">
        {p.nickname}
        {p.id === meId && <span className="tag tag--you">you</span>}
        {p.id === hostId && <span className="tag tag--host" title="Host">host</span>}
        {!p.connected && <span className="tag tag--away">away</span>}
      </span>
      {right}
    </div>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** Ranked scores. Your own row is highlighted instead of tagged, so long names still fit. */
export function Scoreboard({ players, meId, highlight, done }: { players: PublicPlayer[]; hostId?: string; meId?: string | undefined; highlight?: Map<string, number>; done?: string[] }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return (
    <ol className="scoreboard" aria-label="Scores">
      {sorted.map((p, i) => (
        <li key={p.id} className={'scoreboard__row' + (p.id === meId ? ' is-me' : '') + (p.connected ? '' : ' is-away')}>
          <span className="scoreboard__rank" aria-label={`Place ${i + 1}`}>{p.score > 0 && i < 3 ? MEDALS[i] : i + 1}</span>
          <Avatar id={p.avatar} size={32} dim={!p.connected} />
          <span className="scoreboard__name">
            {p.nickname}
            {p.id === meId && <span className="sr-only"> (you)</span>}
          </span>
          {done?.includes(p.id) && <span className="done" title="Take sent" aria-label="take sent">✓</span>}
          {highlight?.get(p.id) ? <span className="delta">+{highlight.get(p.id)}</span> : null}
          <span className="scoreboard__pts">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}
