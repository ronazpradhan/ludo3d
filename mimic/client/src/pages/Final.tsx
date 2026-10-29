import { MIN_PLAYERS } from '../../../shared/constants';
import type { RoomSnapshot } from '../../../shared/types';
import { Avatar, Scoreboard } from '../components/bits';
import { useMimic, useStore } from '../hooks/useMimic';

export function Final({ room }: { room: RoomSnapshot }) {
  const store = useStore();
  const { me, busy } = useMimic();
  const ranked = [...room.players].sort((a, b) => b.score - a.score);
  const isHost = me?.playerId === room.hostId;
  const connected = room.players.filter(p => p.connected).length;
  const top = ranked.slice(0, 3);
  const podium = [top[1], top[0], top[2]]; // 2nd, 1st, 3rd
  const host = room.players.find(p => p.id === room.hostId);
  const best = ranked[0]?.score ?? 0;
  const winners = ranked.filter(p => p.score === best);

  return (
    <div className="final">
      <section className="card final__hero" aria-live="polite">
        <span className="eyebrow">Match over</span>
        <h1 className="final__title">{winners.length > 1 ? "It's a tie!" : `${winners[0]?.nickname ?? 'Nobody'} wins!`}</h1>
        <div className="podium" aria-label="Podium">
          {podium.map((p, i) =>
            p ? (
              <div key={p.id} className={`podium__spot podium__spot--${[2, 1, 3][i]}`}>
                <Avatar id={p.avatar} size={i === 1 ? 72 : 56} />
                <span className="podium__name">{p.nickname}</span>
                <span className="podium__pts">{p.score}</span>
                <div className="podium__block"><span>{[2, 1, 3][i]}</span></div>
              </div>
            ) : (
              <div key={'none' + i} className="podium__spot podium__spot--none" />
            ),
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="side-h">Final rankings</h2>
        <Scoreboard players={room.players} hostId={room.hostId} meId={me?.playerId} />
      </section>

      <div className="final__actions">
        {isHost ? (
          <>
            <button type="button" className="btn btn--primary btn--big" disabled={busy || connected < MIN_PLAYERS} onClick={() => void store.rematch()}>
              {connected < MIN_PLAYERS ? `Rematch needs ${MIN_PLAYERS} players` : 'Rematch'}
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void store.backToLobby()}>Change settings</button>
          </>
        ) : (
          <p className="waiting" role="status">
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>Waiting for {host?.nickname ?? 'the host'} to start a rematch
          </p>
        )}
        <button type="button" className="btn btn--text" onClick={() => void store.leave()}>Leave room</button>
      </div>
    </div>
  );
}
