import { type FormEvent, useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, NICKNAME_MAX, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../../shared/constants';
import type { ProfileInput } from '../../../shared/types';
import { AvatarPicker, Logo, MuteButton } from '../components/bits';
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

  return (
    <div className="home">
      <header className="topbar">
        <a className="back-link" href="/">← All games</a>
        <MuteButton />
      </header>

      <section className="home__hero">
        <Logo size="lg" />
        <p className="home__tagline">Hear it. Copy it. Nail it.</p>
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
    </div>
  );
}
