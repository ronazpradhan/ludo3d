// The server must reject anything a modified browser could send.
const test = require('node:test');
const assert = require('node:assert');
const cards = require('../games/jutpatti/cards');
const { harness, startedRoom, botMove } = require('./helpers/jp-harness');

const cardsIn = (o, out = new Set()) => { if (typeof o === 'string') { if (cards.isCard(o)) out.add(o); } else if (o && typeof o === 'object') for (const v of Object.values(o)) cardsIn(v, out); return out; };
const whoseTurn = r => r.socks.find(s => s.state().you === r.room.game.current);
const notTurn = r => r.socks.find(s => s.state().you !== r.room.game.current);

test('lobby: create, join, ready, start; non-host cannot start; late joiners refused', () => {
  const h = harness();
  const a = h.client(), b = h.client(), x = h.client();
  a.msg({ t: 'jp:create', name: 'Ann' });
  const code = a.last('jp:joined').code;
  assert.strictEqual(a.state().room.gameType, 'jutpatti');
  b.msg({ t: 'jp:join', code, name: 'Bob' });
  b.msg({ t: 'jp:start' }); assert.strictEqual(b.lastErr(), 'NOT_HOST');
  a.msg({ t: 'jp:start' }); assert.strictEqual(a.lastErr(), 'NOT_READY');
  b.msg({ t: 'jp:ready', ready: true });
  a.msg({ t: 'jp:start' });
  assert.strictEqual(a.state().room.status, 'playing');
  x.msg({ t: 'jp:join', code, name: 'Late' }); assert.strictEqual(x.lastErr(), 'IN_PROGRESS');
  x.msg({ t: 'jp:join', code: 'ZZZZZ', name: 'Nope' }); assert.strictEqual(x.lastErr(), 'ROOM_NOT_FOUND');
});

test('room holds at most 6 players', () => {
  const h = harness(), a = h.client(); a.msg({ t: 'jp:create', name: 'A' });
  const code = a.last('jp:joined').code;
  for (let i = 0; i < 5; i++) h.client().msg({ t: 'jp:join', code, name: 'P' + i });
  const c = h.client(); c.msg({ t: 'jp:join', code, name: 'Seven' });
  assert.strictEqual(c.lastErr(), 'ROOM_FULL');
});

test('players only ever receive their own cards', () => {
  const r = startedRoom(4);
  // Every card that has ever been face up (shown card, discards, the winner's hand) is public knowledge.
  // We check after every single action, so every discard passes through this set.
  const pub = new Set();
  const check = () => {
    const g = r.room.game;
    [g.shown, ...g.discard, ...(g.winningHand || [])].forEach(c => pub.add(c));
    for (const ws of r.socks) {
      for (const m of ws.inbox.slice(ws.checked || 0)) {   // only messages sent since the last check
        if (m.t !== 'jp:state' || !m.game) continue;
        const mine = new Set(g.hands[m.you]);
        for (const c of cardsIn(m)) assert.ok(mine.has(c) || pub.has(c), m.you + ' was sent ' + c);
      }
      ws.checked = ws.inbox.length;
    }
  };
  check();
  for (let k = 0; k < 300 && r.room.status === 'playing'; k++) { const s = whoseTurn(r); s.act(botMove(s.state())); check(); }
});

test('acting out of turn is rejected', () => {
  const r = startedRoom(3), s = notTurn(r), v = r.room.game.version;
  s.act({ type: 'draw', source: 'stock' });
  assert.strictEqual(s.lastErr(), 'NOT_YOUR_TURN');
  assert.strictEqual(r.room.game.version, v);
});

test("sending another player's id does not let you act for them", () => {
  const r = startedRoom(3), turn = whoseTurn(r), s = notTurn(r), v = r.room.game.version;
  const victim = turn.state().you;
  s.act({ type: 'draw', source: 'stock', pid: victim }, { pid: victim, you: victim, from: victim });
  assert.strictEqual(s.lastErr(), 'NOT_YOUR_TURN');
  assert.strictEqual(r.room.game.version, v);
});

test("discarding a card you don't own (or a made-up card) is rejected", () => {
  const r = startedRoom(3), s = whoseTurn(r), me = s.state().you;
  s.act({ type: 'draw', source: 'stock' });
  const g = r.room.game, other = g.players.find(p => p !== me), theirs = g.hands[other][0], stockCard = g.stock[0];
  for (const card of [theirs, stockCard, 'ZZ', '1S', '7h', '', null, 7, { id: '7H' }]) {
    s.clear(); s.msg({ t: 'jp:act', v: g.version, aid: 'c' + String(card), move: { type: 'discard', card } });
    assert.ok(['NOT_OWNED', 'BAD_REQUEST'].includes(s.lastErr()), String(card) + ' -> ' + s.lastErr() + ' status=' + g.status);
  }
  assert.ok(g.hands[other].includes(theirs));
});

test('client-supplied hands, state and winners are ignored', () => {
  const r = startedRoom(2), s = whoseTurn(r), me = s.state().you, before = r.room.game.hands[me].slice();
  const fake = ['AH', 'AS', 'KH', 'KS', 'QH', 'QS', 'JH', 'JS'];
  s.act({ type: 'draw', source: 'stock', hand: fake, winner: me }, { state: { winner: me }, hand: fake, game: { status: 'over', winner: me } });
  s.msg({ t: 'jp:win', winner: me }); s.msg({ t: 'jp:state', game: { winner: me } }); s.msg({ t: 'jp:score', pid: me, score: 99 });
  s.msg({ t: 'jp:__proto__' }); s.msg({ t: 'jp:constructor' }); s.msg({ t: 'jp:hasOwnProperty' });
  const g = r.room.game;
  assert.deepStrictEqual(g.hands[me].slice(0, before.length), before);   // only the real drawn card was added
  if (g.status === 'over') assert.ok(require('../games/jutpatti/rules').isWinningHand(g.hands[me], g.jokerRank));
  assert.strictEqual(r.room.scores[me] || 0, g.winner === me ? 1 : 0);
});

test('modified state version (stale/forged turn number) is rejected', () => {
  const r = startedRoom(2), s = whoseTurn(r), v = r.room.game.version;
  for (const bad of [v - 1, v + 1, v + 1000, '1', null, undefined]) {
    s.clear(); s.msg({ t: 'jp:act', v: bad, aid: 'x' + bad, move: { type: 'draw', source: 'stock' } });
    assert.strictEqual(s.lastErr(), 'STALE');
  }
  assert.strictEqual(r.room.game.version, v);
});

test('duplicate and replayed messages are applied at most once', () => {
  const r = startedRoom(2), s = whoseTurn(r), g = r.room.game;
  const msg = { t: 'jp:act', v: g.version, aid: 'dup-1', move: { type: 'draw', source: 'stock' } };
  s.msg(msg); const after = g.version, hand = g.hands[s.state().you].length;
  s.msg(msg); s.msg({ ...msg }); s.msg({ ...msg, aid: 'dup-2' });   // exact duplicate x2, then a replay with a new id (stale version)
  assert.strictEqual(g.version, after);
  assert.strictEqual(g.hands[s.state().you].length, hand);
  assert.strictEqual(s.lastErr(), 'STALE');
});

test('actions need a bound seat; unknown or forged tokens are refused', () => {
  const r = startedRoom(2), stranger = r.client();
  stranger.msg({ t: 'jp:act', v: r.room.game.version, aid: 'a', move: { type: 'draw', source: 'stock' } });
  assert.strictEqual(stranger.lastErr(), 'NOT_IN_ROOM');
  stranger.msg({ t: 'jp:resume', code: r.code, token: 'f'.repeat(48) }); assert.strictEqual(stranger.lastErr(), 'SESSION_EXPIRED');
  stranger.msg({ t: 'jp:resume', code: r.code, token: { length: 48 } }); assert.strictEqual(stranger.lastErr(), 'SESSION_EXPIRED');
  stranger.msg({ t: 'jp:sync' });
  assert.strictEqual(stranger.state(), null);   // never got anyone's view
});

test('reconnect: the token takes the seat back; the old socket is cut off', () => {
  const r = startedRoom(2), s = whoseTurn(r), me = s.state().you, token = r.room.players.find(p => p.pid === me).token;
  r.srv.disconnect(s);
  assert.strictEqual(r.socks.find(x => x !== s).state().room.players.find(p => p.pid === me).connected, false);
  const s2 = r.client(); s2.msg({ t: 'jp:resume', code: r.code, token });
  assert.strictEqual(s2.state().you, me);
  assert.deepStrictEqual(s2.state().game.you.hand.slice().sort(), r.room.game.hands[me].slice().sort());
  s2.act({ type: 'draw', source: 'stock' });
  assert.strictEqual(r.room.game.phase, 'discard');
  // the original (now replaced) socket can no longer act
  s.msg({ t: 'jp:act', v: r.room.game.version, aid: 'old', move: { type: 'discard', card: r.room.game.hands[me][0] } });
  assert.strictEqual(s.lastErr(), 'NOT_IN_ROOM');
});

test('a player who never comes back is removed and the game goes on', () => {
  const r = startedRoom(3), s = whoseTurn(r), me = s.state().you;
  r.srv.disconnect(s);
  r.advance(60e3); r.srv.sweep();
  assert.ok(r.room.game.active.includes(me));     // still inside the grace period
  r.advance(70e3); r.srv.sweep();
  assert.ok(!r.room.game.active.includes(me));
  assert.notStrictEqual(r.room.game.current, me);
  assert.strictEqual(r.room.status, 'playing');
  const all = [...r.room.game.active.flatMap(p => r.room.game.hands[p]), r.room.game.shown, ...r.room.game.stock, ...r.room.game.discard];
  assert.strictEqual(new Set(all).size, 52);
});

test('play to the end, then rematch when everyone is ready', () => {
  const r = startedRoom(3);
  for (let k = 0; k < 5000 && r.room.status === 'playing'; k++) { const s = whoseTurn(r); s.act(botMove(s.state())); }
  assert.strictEqual(r.room.status, 'over');
  const g = r.room.game;
  if (g.winner) assert.strictEqual(r.room.scores[g.winner], 1);
  r.socks[0].msg({ t: 'jp:act', v: g.version, aid: 'late', move: { type: 'draw', source: 'stock' } });
  assert.strictEqual(r.socks[0].lastErr(), 'GAME_NOT_RUNNING');
  r.socks.forEach(s => s.msg({ t: 'jp:ready', ready: true }));
  assert.strictEqual(r.room.status, 'playing');
  assert.strictEqual(r.room.gameNo, 2);
  assert.notStrictEqual(r.room.game, g);
});

test('message flooding is rate-limited', () => {
  const r = startedRoom(2), s = notTurn(r);
  for (let i = 0; i < 40; i++) s.burst({ t: 'jp:sync' });
  assert.ok(s.errs().includes('RATE_LIMIT'));
});

// A room where it's `s`'s turn, holding a known hand, about to draw `next` from the stock.
function knownHand(hand, next) {
  const r = startedRoom(2), s = whoseTurn(r), me = s.state().you, g = r.room.game;
  g.hands[me] = hand.slice(); g.jokerRank = 'A'; g.stock.push(next); g.version++;
  s.msg({ t: 'jp:sync' }); s.act({ type: 'draw', source: 'stock' });
  const show = move => s.msg({ t: 'jp:act', v: g.version, aid: 'show' + Math.random().toString(36).slice(2, 10), move });
  return { r, s, me, g, show };
}

test('Show over the network: a hand that is not all pairs is refused and the game goes on', () => {
  const { r, s, show } = knownHand(['7H', '7S', '9D', '9C', 'KH', 'QS', 'QD'], '2C');
  show({ type: 'show' });
  assert.strictEqual(s.last('jp:err').code, 'INVALID_SHOW');
  assert.strictEqual(s.last('jp:err').bad, undefined);   // the server doesn't say which cards are unpaired
  assert.strictEqual(r.room.status, 'playing');
});

test('Show over the network: a winning hand wins even if the cards are not arranged in pairs', () => {
  const { r, me, show } = knownHand(['7H', '9D', 'KH', 'QS', '7S', 'QD', '9C'], 'KD');   // pairs scattered around
  show({ type: 'show' });
  assert.strictEqual(r.room.status, 'over');
  assert.strictEqual(r.room.game.winner, me);
  assert.strictEqual(r.room.scores[me], 1);
  const wp = r.room.game.winningPairs;
  assert.strictEqual(wp.length, 4);
  assert.ok(require('../games/jutpatti/rules').checkShow(r.room.game.winningHand, wp, 'A').ok);
});

test("Show over the network: a wrong arrangement doesn't matter if the hand follows the rule", () => {
  const { r, me, show } = knownHand(['7H', '7S', '9D', '9C', 'KH', 'QS', 'QD'], 'KD');
  show({ type: 'show', pairs: [['7H', '9D'], ['7S', '9C'], ['KH', 'KD'], ['QS', 'QD']] });
  assert.strictEqual(r.room.game.winner, me);
  assert.ok(require('../games/jutpatti/rules').checkShow(r.room.game.winningHand, r.room.game.winningPairs, 'A').ok);
});

test("Show over the network: the winner's own arrangement is what everyone sees", () => {
  const { r, show } = knownHand(['7H', '7S', '9D', '9C', 'KH', 'QS', 'QD'], 'KD');
  const mine = [['QD', 'QS'], ['7S', '7H'], ['KD', 'KH'], ['9C', '9D']];
  show({ type: 'show', pairs: mine });
  for (const ws of r.socks) assert.deepStrictEqual(ws.state().game.winningPairs, mine);
});

test('open rooms list: shows rooms waiting for players, hides private, full and started ones', () => {
  const h = harness(), a = h.client(), b = h.client(), watcher = h.client();
  a.msg({ t: 'jp:create', name: 'Ann' }); const code = a.last('jp:joined').code;
  b.msg({ t: 'jp:create', name: 'Ben', listed: false });
  watcher.msg({ t: 'jp:watch' });
  let list = watcher.last('jp:rooms').rooms;
  assert.deepStrictEqual(list, [{ code, host: 'Ann', players: 1, max: 6 }]);   // Ben's private room isn't listed
  assert.ok(!JSON.stringify(list).includes('token') && !JSON.stringify(list).includes('pid'));
  a.msg({ t: 'jp:opts', listed: false }); watcher.msg({ t: 'jp:watch' });
  assert.deepStrictEqual(watcher.last('jp:rooms').rooms, []);
  a.msg({ t: 'jp:opts', listed: true });
  const c = h.client(); c.msg({ t: 'jp:join', code, name: 'Cat' }); c.msg({ t: 'jp:ready', ready: true });
  a.msg({ t: 'jp:start' }); watcher.msg({ t: 'jp:watch' });
  assert.deepStrictEqual(watcher.last('jp:rooms').rooms, []);   // game running: not joinable, not listed
  c.msg({ t: 'jp:opts', listed: false }); assert.strictEqual(c.lastErr(), 'NOT_HOST');
});
