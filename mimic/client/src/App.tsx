import { ConnectionBanner, Logo, MuteButton, Toast } from './components/bits';
import { useMimic, useStore } from './hooks/useMimic';
import { Final } from './pages/Final';
import { Game } from './pages/Game';
import { Home } from './pages/Home';
import { Lobby } from './pages/Lobby';

const inviteCode = new URLSearchParams(location.search).get('room') ?? '';

export function App() {
  const store = useStore();
  const { me, room, ended, restoring } = useMimic();

  let screen;
  if (ended) {
    const text = {
      replaced: 'You opened this game in another tab or device, so this one stepped aside.',
      closed: 'This room has closed.',
      lost: 'That room no longer exists. The server may have restarted — start a new room and share the new code.',
    }[ended];
    screen = (
      <div className="center-card card" role="alert">
        <Logo size="sm" />
        <p>{text}</p>
        <button type="button" className="btn btn--primary" onClick={() => (ended === 'replaced' ? location.reload() : store.reset())}>
          {ended === 'replaced' ? 'Use this tab instead' : 'Back to start'}
        </button>
      </div>
    );
  } else if (restoring || (me && !room)) {
    screen = (
      <div className="center-card" role="status">
        <span className="spinner spinner--big" aria-hidden="true" />
        <p>Getting you back into the room…</p>
      </div>
    );
  } else if (!me || !room) {
    screen = <Home inviteCode={inviteCode} />;
  } else {
    screen = (
      <>
        <header className="topbar">
          <Logo size="sm" />
          <span className="topbar__code mono" aria-label="Room code">{room.code}</span>
          <div className="topbar__right">
            <MuteButton />
            {room.phase === 'lobby' && (
              <button type="button" className="btn btn--text btn--sm" onClick={() => void store.leave()}>Leave</button>
            )}
            {(room.phase === 'listen' || room.phase === 'record' || room.phase === 'results') && (
              <button
                type="button"
                className="btn btn--text btn--sm"
                onClick={() => {
                  if (confirm('Leave this match? Your score will be lost.')) void store.leave();
                }}
              >
                Leave
              </button>
            )}
          </div>
        </header>
        {room.phase === 'lobby' ? <Lobby room={room} /> : room.phase === 'finished' ? <Final room={room} /> : <Game room={room} />}
      </>
    );
  }

  return (
    <div className="app">
      <ConnectionBanner />
      <main className="app__main">{screen}</main>
      <Toast />
    </div>
  );
}
