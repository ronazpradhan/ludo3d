// Table chat in the card rooms (shared room server; driven here through Jutpatti).
const test = require('node:test');
const assert = require('node:assert');
const { harness, startedRoom } = require('./helpers/jp-harness');

const chats = ws => ws.inbox.filter(m => m.t === 'jp:chat');

test('a message reaches everyone at the table, sent as the bound player', () => {
  const r = startedRoom(3), [a, b, c] = r.socks;
  a.msg({ t: 'jp:chat', text: '  hello <b>table</b>  ', pid: r.socks[1].state().you, name: 'Faker' });
  for (const s of [a, b, c]) {
    const m = chats(s).pop();
    assert.strictEqual(m.text, 'hello <b>table</b>');   // trimmed; shown as plain text by the client
    assert.strictEqual(m.name, 'P0'); assert.strictEqual(m.pid, a.state().you);   // can't pretend to be someone else
  }
});

test('outsiders, empty and flood messages are refused; long ones are cut to 200', () => {
  const h = harness(), r = startedRoom(2, h), [a, b] = r.socks, out = h.client();
  out.msg({ t: 'jp:chat', text: 'hi' }); assert.strictEqual(out.lastErr(), 'NOT_IN_ROOM');
  a.msg({ t: 'jp:chat', text: '   ' }); assert.strictEqual(chats(b).length, 0);
  a.msg({ t: 'jp:chat', text: 'x'.repeat(500) }); assert.strictEqual(chats(b).pop().text.length, 200);
  a.burst({ t: 'jp:chat', text: 'spam' }); assert.strictEqual(a.lastErr(), 'RATE_LIMIT');
  h.advance(600); a.msg({ t: 'jp:chat', text: 'line\u0000two\nthree' }); assert.strictEqual(chats(b).pop().text, 'line two three');
});

test('someone who reconnects gets the recent chat', () => {
  const h = harness(), r = startedRoom(2, h), [a, b] = r.socks;
  for (let i = 0; i < 35; i++) { h.advance(600); a.msg({ t: 'jp:chat', text: 'm' + i }); }
  const tok = b.last('jp:joined').token, nb = h.client();
  nb.msg({ t: 'jp:resume', code: r.code, token: tok });
  const log = nb.last('jp:chatlog').msgs;
  assert.strictEqual(log.length, 30); assert.strictEqual(log[29].text, 'm34');
  assert.ok(nb.inbox.findIndex(m => m.t === 'jp:chatlog') > nb.inbox.findIndex(m => m.t === 'jp:state'));   // after the state, so names are known
});
