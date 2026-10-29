import { type FormEvent, useEffect, useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, NICKNAME_MAX, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../../shared/constants';
import type { OpenRoom, ProfileInput } from '../../../shared/types';
import { Avatar, AvatarPicker, Logo, MuteButton } from '../components/bits';
import { useMimic, useStore } from '../hooks/useMimic';
import { loadProfile } from '../lib/session';
import { unlockAudio } from '../lib/sound';

const cleanCode = (s: string): string =>
  s
    .toUpperCase()
    .split('')
    .filter(ch => ROOM_CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, ROOM_CODE_LENGTH);

export function Home({ inviteCode }: { inviteCode: string }) {
  const store = useStore();
  const { busy, connection, rejoinable } = useMimic();
  const [profile, setProfile] = useState<ProfileInput>(loadProfile);
  const [code, setCode] = useState(cleanCode(inviteCode));
  const [nameError, setNameError] = useState('');
  const offline = connection !== 'online';
  const [open, setOpen] = useState<OpenRoom[] | null>(null);

  // Public rooms, refreshed every few seconds while this screen is open.
  useEffect(() => {
    if (offline) return;
    let live = true;
    const load = () => void store.listRooms().then(r => live && r && setOpen(r));
    load();
    const t = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [offline, store]);

  const validProfile = (): ProfileInput | null => {
    const nickname = profile.nickname.replace(/\s+/g, ' ').trim();
    if (!nickname) {
      setNameError('Pick a nickname first.');
      document.getElementById('nick')?.focus();
      return null;
    }
    setNameError('');
    return { ...profile, nickname };
  };

  const create = () => {
    unlockAudio();
    const p = validProfile();
    if (p) void store.createRoom(p);
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    unlockAudio();
    const p = validProfile();
    if (!p) return;
    if (code.length !== ROOM_CODE_LENGTH) return store.notify(`Room codes have ${ROOM_CODE_LENGTH} characters.`);
    void store.joinRoom(p, code);
  };
  const joinOpen = (r: OpenRoom) => {
    unlockAudio();
    const p = validProfile();
    if (p) void store.joinRoom(p, r.code);
  };

  return (
    <div className="home">
      <header className="topbar">
        <a className="back-link" href="/">← All games</a>
        <MuteButton />
      </header>

      <section className="home__hero">
        <Logo size="lg" />
        <p className="home__tagline">Hear it. Copy it. Nail it.</p>
      </section>

      <section className="home__how" aria-label="How to play">
        <ol className="how">
          <li><span className="how__n">1</span><span><b>Everyone hears the same sound</b>: a tune, a siren, a beat or a silly noise.</span></li>
          <li><span className="how__n">2</span><span><b>Copy it into your mic</b>: hum, whistle, clap or make the noise.</span></li>
          <li><span className="how__n">3</span><span><b>The game scores how close you got</b> (0–100). Best copy each round gets a bonus.</span></li>
        </ol>
        <p className="home__fine">{MIN_PLAYERS}–{MAX_PLAYERS} players · microphone needed · no sign-up</p>
      </section>

      <section className="card home__card" aria-label="Play">
        {rejoinable && (
          <div className="rejoin">
            <span>You were in room <b className="mono">{rejoinable.code}</b></span>
            <button type="button" className="btn btn--lime btn--sm" disabled={offline} onClick={() => void store.resume(rejoinable)}>Rejoin</button>
          </div>
        )}
        <label className="field">
          <span className="field__label">Nickname</span>
          <input
            id="nick"
            className="input"
            value={profile.nickname}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            placeholder="What should we call you?"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'nick-err' : undefined}
            onChange={e => setProfile({ ...profile, nickname: e.target.value })}
          />
          {nameError && <span id="nick-err" className="field__error">{nameError}</span>}
        </label>
        <div className="field">
          <span className="field__label" id="avatar-label">Avatar</span>
          <AvatarPicker value={profile.avatar} onChange={avatar => setProfile({ ...profile, avatar })} />
        </div>

        <button type="button" className="btn btn--primary btn--block" disabled={busy || offline} onClick={create}>
          Create a room
        </button>

        <div className="divider"><span>or join friends</span></div>

        <form className="join" onSubmit={join}>
          <label className="sr-only" htmlFor="code">Room code</label>
          <input
            id="code"
            className="input input--code mono"
            value={code}
            placeholder="ROOM CODE"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            onChange={e => setCode(cleanCode(e.target.value))}
          />
          <button type="submit" className="btn btn--ghost" disabled={busy || offline}>Join</button>
        </form>
        {offline && <p className="home__status" role="status"><span className="spinner" aria-hidden="true" /> Connecting to the server…</p>}
      </section>

      <section className="card home__rooms" aria-labelledby="open-h">
        <div className="card__head">
          <h2 id="open-h">Public rooms</h2>
          <span className="live" aria-hidden="true"><i /> live</span>
        </div>
        {open === null ? (
          <p className="muted small"><span className="spinner" aria-hidden="true" /> Looking for rooms…</p>
        ) : open.length === 0 ? (
          <p className="empty">No public rooms right now. Create one and set it to <b>Public</b> so anyone can drop in.</p>
        ) : (
          <ul className="rooms">
            {open.map(r => {
              const full = r.players >= r.maxPlayers;
              return (
                <li key={r.code} className="room">
                  <Avatar id={r.host.avatar} size={40} />
                  <span className="room__info">
                    <span className="room__name">{r.host.nickname}’s room</span>
                    <span className="room__meta">
                      {r.players}/{r.maxPlayers} players · {r.playing ? 'playing now' : 'in the lobby'}
                    </span>
                  </span>
                  <button type="button" className="btn btn--primary btn--sm" disabled={busy || offline || r.playing || full} onClick={() => joinOpen(r)}>
                    {r.playing ? 'Playing' : full ? 'Full' : 'Join'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
