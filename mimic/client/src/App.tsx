import { useEffect, useState } from 'react';
import { ConnectionBanner, Logo, MuteButton, Toast } from './components/bits';
import { useMimic, useStore } from './hooks/useMimic';
import { Final } from './pages/Final';
import { Game } from './pages/Game';
import { Home } from './pages/Home';
import { Lobby } from './pages/Lobby';
import type { RoomSnapshot } from '../../shared/types';

const inviteCode = new URLSearchParams(location.search).get('room') ?? '';

export function App() {
  const store = useStore();
  const { me, room, ended, restoring } = useMimic();
  const [leaving, setLeaving] = useState(false);
  const view = ended ? 'ended' : !me || !room ? 'home' : `${room.phase}:${room.round?.number ?? 0}`;

  // A new screen starts at the top; otherwise a phone stays scrolled down where the last one ended.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

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
            <button type="button" className="btn btn--text btn--sm" onClick={() => setLeaving(true)}>Leave</button>
          </div>
        </header>
        {leaving && <LeaveDialog room={room} meId={me.playerId} onClose={() => setLeaving(false)} />}
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

/** Leaving: everyone can just leave; the host chooses between handing the room on and ending it for all. */
function LeaveDialog({ room, meId, onClose }: { room: RoomSnapshot; meId: string; onClose: () => void }) {
  const store = useStore();
  const isHost = room.hostId === meId;
  const others = room.players.filter(p => p.id !== meId);
  const next = others.find(p => p.connected) ?? others[0];
  const inMatch = room.phase !== 'lobby' && room.phase !== 'finished';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="leave-title" onClick={e => e.stopPropagation()}>
        <h2 id="leave-title" className="dialog__title">{isHost ? 'Leave or end the room?' : 'Leave the room?'}</h2>
        <p className="muted">
          {isHost && next
            ? `Leave and ${next.nickname} becomes the host, so the others keep playing. Or end the room and send everyone back to the start.`
            : inMatch
              ? 'Your score in this match will be lost.'
              : 'You can join again with the room code.'}
        </p>
        <div className="dialog__actions">
          {isHost && next && (
            <button type="button" className="btn btn--coral btn--block" onClick={() => void store.leave(true)}>
              End room for everyone
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--block" onClick={() => void store.leave()}>
            {isHost && next ? `Just leave (${next.nickname} hosts)` : 'Leave'}
          </button>
          <button type="button" className="btn btn--text btn--block" onClick={onClose} autoFocus>
            Stay
          </button>
        </div>
      </div>
    </div>
  );
}
