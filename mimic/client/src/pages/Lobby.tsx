import { useState } from 'react';
import { CATEGORIES, CATEGORY_LABELS, DIFFICULTY_SETTINGS, MAX_PLAYERS, MIN_PLAYERS, ROUND_OPTIONS } from '../../../shared/constants';
import type { Category, RoomSettings, RoomSnapshot } from '../../../shared/types';
import { PlayerChip } from '../components/bits';
import { MicCheck } from '../components/MicCheck';
import { useMimic, useStore } from '../hooks/useMimic';

const DIFF_LABEL: Record<RoomSettings['difficulty'], string> = { mixed: 'Mixed', easy: 'Easy', medium: 'Medium', hard: 'Hard' };

function Segmented<T extends string | number>({ label, options, value, onChange, disabled, format }: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  disabled: boolean;
  format: (v: T) => string;
}) {
  return (
    <div className="setting">
      <span className="setting__label" id={`seg-${label}`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${label}`}>
        {options.map(o => (
          <button key={String(o)} type="button" role="radio" aria-checked={o === value} disabled={disabled} className={'segmented__opt' + (o === value ? ' is-on' : '')} onClick={() => onChange(o)}>
            {format(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Lobby({ room }: { room: RoomSnapshot }) {
  const store = useStore();
  const { me, busy } = useMimic();
  const [copied, setCopied] = useState(false);
  const isHost = me?.playerId === room.hostId;
  const connected = room.players.filter(p => p.connected).length;
  const s = room.settings;
  const set = (patch: Partial<RoomSettings>) => void store.updateSettings(patch);
  const toggleCat = (c: Category) => {
    const has = s.categories.includes(c);
    if (has && s.categories.length === 1) return store.notify('Keep at least one category.', 'info');
    set({ categories: has ? s.categories.filter(x => x !== c) : [...s.categories, c] });
  };
  const invite = `${location.origin}/mimic/?room=${room.code}`;
  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Play Mimic with me', url: invite });
      else await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      store.notify(`Copy this link: ${invite}`, 'info');
    }
  };
  const host = room.players.find(p => p.id === room.hostId);

  return (
    <div className="lobby">
      <section className="card lobby__code">
        <span className="eyebrow">Room code</span>
        <div className="code mono" aria-label={`Room code ${room.code.split('').join(' ')}`}>
          {room.code.split('').map((ch, i) => <span key={i}>{ch}</span>)}
        </div>
        <button type="button" className="btn btn--lime btn--sm" onClick={() => void copy()}>
          {copied ? 'Link copied ✓' : 'Copy invite link'}
        </button>
      </section>

      <section className="card lobby__players" aria-labelledby="players-h">
        <div className="card__head">
          <h2 id="players-h">Players</h2>
          <span className="muted">{room.players.length}/{MAX_PLAYERS}</span>
        </div>
        <ul className="player-grid">
          {room.players.map(p => (
            <li key={p.id} className="pop-in"><PlayerChip p={p} hostId={room.hostId} meId={me?.playerId} /></li>
          ))}
          {Array.from({ length: Math.max(0, MIN_PLAYERS - room.players.length) }, (_, i) => (
            <li key={'empty' + i} className="chip chip--empty" aria-hidden="true"><span className="avatar avatar--empty" /> waiting…</li>
          ))}
        </ul>
      </section>

      <section className="card lobby__settings" aria-labelledby="settings-h">
        <div className="card__head">
          <h2 id="settings-h">Match settings</h2>
          {!isHost && <span className="muted">Set by {host?.nickname ?? 'the host'}</span>}
        </div>
        <Segmented label="Sounds" options={ROUND_OPTIONS} value={s.rounds} disabled={!isHost} onChange={v => set({ rounds: v })} format={v => `${v}`} />
        <Segmented label="Difficulty" options={DIFFICULTY_SETTINGS} value={s.difficulty} disabled={!isHost} onChange={v => set({ difficulty: v })} format={v => DIFF_LABEL[v]} />
        <div className="setting">
          <span className="setting__label">Categories</span>
          <div className="cats">
            {CATEGORIES.map(c => (
              <button key={c} type="button" aria-pressed={s.categories.includes(c)} disabled={!isHost} className={'cat' + (s.categories.includes(c) ? ' is-on' : '')} onClick={() => toggleCat(c)}>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card lobby__mic" aria-label="Microphone check">
        <MicCheck />
      </section>

      <div className="lobby__actions">
        {isHost ? (
          <button type="button" className="btn btn--primary btn--block btn--big" disabled={busy || connected < MIN_PLAYERS} onClick={() => void store.start()}>
            {connected < MIN_PLAYERS ? `Need ${MIN_PLAYERS} players (${connected}/${MIN_PLAYERS})` : 'Start the match'}
          </button>
        ) : (
          <p className="waiting" role="status">
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
            {connected < MIN_PLAYERS ? `Waiting for more players (${connected}/${MIN_PLAYERS})` : `Waiting for ${host?.nickname ?? 'the host'} to start`}
          </p>
        )}
      </div>
    </div>
  );
}
