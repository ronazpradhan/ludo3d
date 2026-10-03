// Ludo 3D: serves the game and relays realtime messages between players.
// No database: rooms live in memory and disappear when everyone leaves.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const page = () => fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(page());
});

const wss = new WebSocketServer({ server, maxPayload: 32 * 1024 });
const rooms = new Map(); // room name -> Map(clientId -> { ws, presence })
const NAME = /^[\w*-]{1,40}$/, MAX_ROOM = 12, MAX_ROOMS_PER_CLIENT = 4;

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
function snapshot(name) {
  const r = rooms.get(name); if (!r) return;
  const peers = [...r].map(([id, c]) => ({ id, presence: c.presence }));
  for (const c of r.values()) send(c.ws, { t: 'peers', room: name, peers });
}
function leave(ws, name) {
  const r = rooms.get(name); if (!r || !r.has(ws.id)) return;
  r.delete(ws.id); ws.rooms.delete(name);
  if (r.size === 0) rooms.delete(name); else snapshot(name);
}

wss.on('connection', ws => {
  ws.id = crypto.randomBytes(4).toString('hex');
  ws.rooms = new Set(); ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { t: 'welcome', id: ws.id });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.room !== 'string' || !NAME.test(m.room)) return;
    if (m.t === 'join') {
      if (ws.rooms.has(m.room) || ws.rooms.size >= MAX_ROOMS_PER_CLIENT) return;
      let r = rooms.get(m.room); if (!r) rooms.set(m.room, r = new Map());
      if (r.size >= MAX_ROOM && m.room !== '*') return send(ws, { t: 'full', room: m.room });
      r.set(ws.id, { ws, presence: {} }); ws.rooms.add(m.room); snapshot(m.room);
    } else if (m.t === 'leave') {
      leave(ws, m.room);
    } else if (m.t === 'pres') {
      const c = rooms.get(m.room)?.get(ws.id);
      if (!c || JSON.stringify(m.p || {}).length > 600) return;
      c.presence = m.p || {}; snapshot(m.room);
    } else if (m.t === 'emit') {
      const r = rooms.get(m.room);
      if (!r || !r.has(ws.id) || typeof m.topic !== 'string' || m.topic.length > 20) return;
      const out = JSON.stringify({ t: 'ev', room: m.room, topic: m.topic, data: m.data, from: ws.id });
      for (const [id, c] of r) if (id !== ws.id && c.ws.readyState === 1) c.ws.send(out);
    }
  });
  ws.on('close', () => { for (const n of [...ws.rooms]) leave(ws, n); });
});

// Drop dead connections and keep idle ones alive through proxies.
setInterval(() => wss.clients.forEach(ws => {
  if (!ws.alive) return ws.terminate();
  ws.alive = false; ws.ping();
}), 25000);

server.listen(process.env.PORT || 3000, () => console.log('Ludo running on port ' + (process.env.PORT || 3000)));
