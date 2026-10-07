// End to end: boots the real server.js and talks to it over real WebSockets.
// Checks the Ludo relay still behaves exactly as before, and Jutpatti works alongside it.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 3900 + Math.floor(Math.random() * 90);
let proc;

test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), JUTPATTI_LOG: '0' }, stdio: 'pipe' });
  await new Promise((res, rej) => { proc.stdout.on('data', d => { if (/running on port/.test(d)) res(); }); proc.on('exit', c => rej(new Error('server exited ' + c))); });
});
test.after(() => proc && proc.kill());

const get = p => new Promise((res, rej) => http.get(`http://localhost:${PORT}${p}`, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b, type: r.headers['content-type'] })); }).on('error', rej));

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`), inbox = [], waiters = [];
  ws.on('message', d => { const m = JSON.parse(d); inbox.push(m); for (const w of waiters.slice()) if (w.f(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } });
  const c = {
    ws, inbox,
    open: () => new Promise(r => ws.on('open', r)),
    send: o => ws.send(JSON.stringify(o)),
    wait: (f, ms = 3000) => new Promise((res, rej) => { const hit = inbox.find(f); if (hit) return res(hit); const w = { f, res }; waiters.push(w); setTimeout(() => rej(new Error('timeout waiting')), ms); }),
    next: (f, ms = 3000) => new Promise((res, rej) => { const w = { f, res }; waiters.push(w); setTimeout(() => rej(new Error('timeout waiting')), ms); }),
  };
  return c;
}

test('static pages are served: game picker, Ludo, Jutpatti', async () => {
  const idx = await get('/');
  assert.strictEqual(idx.status, 200);
  assert.ok(idx.body.includes('ludo.html') && idx.body.includes('jutpatti.html'));
  for (const p of ['/ludo.html', '/jutpatti.html', '/js/game.js', '/js/online.js', '/js/realtime.js', '/js/jutpatti.js', '/css/jutpatti.css', '/img/jutpatti.svg']) {
    const r = await get(p); assert.strictEqual(r.status, 200, p);
  }
  assert.strictEqual((await get('/healthz')).body, 'ok');
  // server-side game code is never served to browsers
  const leak = await get('/../games/jutpatti/engine.js');
  assert.ok(!leak.body.includes('createGame'));
});

test('Ludo relay: join, presence, peers and emit work as before', async () => {
  const a = client(), b = client(); await Promise.all([a.open(), b.open()]);
  const wa = await a.wait(m => m.t === 'welcome'), wb = await b.wait(m => m.t === 'welcome');
  a.send({ t: 'join', room: 'ludo-tst01' });
  await a.wait(m => m.t === 'peers' && m.peers.length === 1);
  b.send({ t: 'join', room: 'ludo-tst01' });
  await a.wait(m => m.t === 'peers' && m.peers.length === 2);
  a.send({ t: 'pres', room: 'ludo-tst01', p: { id: 'me1' } });
  await b.wait(m => m.t === 'peers' && m.peers.some(p => p.id === wa.id && p.presence.id === 'me1'));
  a.send({ t: 'emit', room: 'ludo-tst01', topic: 'g', data: { k: 'r', v: 6, n: 0, g: 0 } });
  const ev = await b.wait(m => m.t === 'ev');
  assert.deepStrictEqual(ev, { t: 'ev', room: 'ludo-tst01', topic: 'g', data: { k: 'r', v: 6, n: 0, g: 0 }, from: wa.id });
  a.send({ t: 'ping' }); await a.wait(m => m.t === 'pong');
  b.send({ t: 'leave', room: 'ludo-tst01' });
  await a.next(m => m.t === 'peers' && m.peers.length === 1);
  assert.ok(wb.id);
  a.ws.close(); b.ws.close();
});

test('Jutpatti over real sockets: room, private hands, turns, reconnect', async () => {
  const a = client(), b = client(); await Promise.all([a.open(), b.open()]);
  a.send({ t: 'jp:create', name: 'Ann' });
  const ja = await a.wait(m => m.t === 'jp:joined');
  b.send({ t: 'jp:join', code: ja.code, name: 'Bob' });
  await b.wait(m => m.t === 'jp:joined');
  b.send({ t: 'jp:ready', ready: true });
  await a.wait(m => m.t === 'jp:state' && m.room.players.length === 2 && m.room.players[1].ready);
  a.send({ t: 'jp:start' });
  const sa = await a.wait(m => m.t === 'jp:state' && m.game), sb = await b.wait(m => m.t === 'jp:state' && m.game);
  assert.strictEqual(sa.room.gameType, 'jutpatti');
  assert.strictEqual(sa.game.you.hand.length, 7);
  assert.strictEqual(sb.game.you.hand.length, 7);
  assert.ok(!sa.game.you.hand.some(c => sb.game.you.hand.includes(c)));
  assert.ok(!JSON.stringify(sa).includes('"hands":') && !JSON.stringify(sa).includes('"stock":'), 'raw server state leaked');
  for (const c of sb.game.you.hand) assert.ok(!JSON.stringify(sa).includes('"' + c + '"'), 'Ann was sent Bob\'s ' + c);
  // whoever's turn it is draws; the other one is refused
  const [turn, other, st] = sa.game.current === ja.pid ? [a, b, sa] : [b, a, sb];
  other.send({ t: 'jp:act', v: st.game.version, aid: 'x1', move: { type: 'draw', source: 'stock' } });
  assert.strictEqual((await other.wait(m => m.t === 'jp:err')).code, 'NOT_YOUR_TURN');
  turn.send({ t: 'jp:act', v: st.game.version, aid: 'x2', move: { type: 'draw', source: 'stock' } });
  const after = await turn.next(m => m.t === 'jp:state' && m.game.version === st.game.version + 1);
  assert.ok(after.game.phase === 'discard' || after.game.status === 'over');
  // reconnect: drop Ann's socket, come back with the token
  const tok = ja.token; a.ws.close();
  await b.wait(m => m.t === 'jp:state' && m.room.players.some(p => p.pid === ja.pid && !p.connected));
  const a2 = client(); await a2.open();
  a2.send({ t: 'jp:resume', code: ja.code, token: tok });
  const back = await a2.wait(m => m.t === 'jp:state');
  assert.strictEqual(back.you, ja.pid);
  assert.ok(back.game.you.hand.length >= 7);
  a2.ws.close(); b.ws.close();
});
