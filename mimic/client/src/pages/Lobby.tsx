import { useEffect, useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, ROUND_OPTIONS, VISIBILITY } from '../../../shared/constants';
import type { Category, RoomSettings, RoomSnapshot } from '../../../shared/types';
import { PlayerChip } from '../components/bits';
import { MicCheck } from '../components/MicCheck';
import { useMimic, useStore } from '../hooks/useMimic';
import { loadJudge, useJudge } from '../lib/judge';

const VIS_LABEL: Record<RoomSettings['visibility'], string> = { private: '🔒 Private', public: '🌐 Public' };

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
  // Categories start off; the host turns on the ones they want.
  const all = room.categories.map(c => c.id);
  const chosen = s.categories;
  const toggleCat = (c: Category) => set({ categories: chosen.includes(c) ? chosen.filter(x => x !== c) : [...chosen, c] });
  const soundCount = room.categories.filter(c => chosen.includes(c.id)).reduce((n, c) => n + c.count, 0);
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

  // Fetch the word judge while people gather, so it's ready by the first round.
  useEffect(() => loadJudge(), []);

  return (
    <div className="lobby">
      <section className="card lobby__players" aria-labelledby="players-h">
        <div className="card__head">
          <h2 id="players-h">Players <span className="muted">{room.players.length}/{MAX_PLAYERS}</span></h2>
          <button type="button" className="btn btn--lime btn--sm" onClick={() => void copy()}>
            {copied ? 'Link copied ✓' : '🔗 Invite friends'}
          </button>
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
        <Segmented label="Who can join" options={VISIBILITY} value={s.visibility} disabled={!isHost} onChange={v => set({ visibility: v })} format={v => VIS_LABEL[v]} />
        <p className="setting__note">
          {s.visibility === 'public' ? 'Listed on the home screen: anyone can join without the code.' : 'Only people with the code or invite link can join.'}
        </p>
        <div className="setting">
          <div className="setting__row">
            <span className="setting__label" id="cats-h">Categories · {soundCount} sounds</span>
            {isHost && (
              <span className="setting__quick">
                <button type="button" className="link-btn" disabled={chosen.length === all.length} onClick={() => set({ categories: all })}>All on</button>
                <button type="button" className="link-btn" disabled={chosen.length === 0} onClick={() => set({ categories: [] })}>All off</button>
              </span>
            )}
          </div>
          <ul className="toggles" aria-labelledby="cats-h">
            {room.categories.map(c => {
              const on = chosen.includes(c.id);
              return (
                <li key={c.id}>
                  <label className={'toggle' + (on ? ' is-on' : '') + (!isHost ? ' is-locked' : '')}>
                    <span className="toggle__emoji" aria-hidden="true">{c.emoji}</span>
                    <span className="toggle__text">
                      <span className="toggle__name">{c.label}</span>
                      <span className="toggle__count">{c.count} sounds</span>
                    </span>
                    <input type="checkbox" role="switch" className="switch" checked={on} disabled={!isHost} onChange={() => toggleCat(c.id)} aria-label={c.label} />
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="card lobby__mic" aria-label="Microphone check">
        <MicCheck />
        <JudgeStatus />
      </section>

      <div className="lobby__actions">
        {isHost ? (
          <button type="button" className="btn btn--primary btn--block btn--big" disabled={busy || connected < MIN_PLAYERS || soundCount === 0} onClick={() => void store.start()}>
            {connected < MIN_PLAYERS ? `Need ${MIN_PLAYERS} players (${connected}/${MIN_PLAYERS})` : soundCount === 0 ? 'Turn on a category to start' : 'Start the match'}
          </button>
        ) : (
          <p className="waiting" role="status">
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
            {connected < MIN_PLAYERS ? `Waiting for more players (${connected}/${MIN_PLAYERS})` : soundCount === 0 ? `Waiting for ${host?.nickname ?? 'the host'} to pick categories` : `Waiting for ${host?.nickname ?? 'the host'} to start`}
          </p>
        )}
      </div>
    </div>
  );
}

/** Whether this phone's word judge (the speech model that checks a take says the right words) is ready. */
function JudgeStatus() {
  const j = useJudge();
  const text =
    j.status === 'ready'
      ? 'Word judge ready: copies that say the right words score higher'
      : j.status === 'loading'
        ? `Getting the word judge (one time, 70 MB)… ${Math.round(j.progress * 100)}%`
        : j.status === 'failed'
          ? 'Word judge unavailable on this device: you’re scored on how you sound'
          : '';
  if (!text) return null;
  return (
    <p className={'judge judge--' + j.status} title="Speech model: ZIPA by Zhu et al. (CC BY 4.0)">
      <span aria-hidden="true">{j.status === 'ready' ? '💬' : j.status === 'loading' ? '⏳' : '🔇'}</span> {text}
      {j.status === 'loading' && <span className="judge__bar" style={{ width: `${Math.round(j.progress * 100)}%` }} />}
    </p>
  );
}
