// Voice chat setup on the card-room server: mic flags and point-to-point signalling.
const test = require('node:test');
const assert = require('node:assert');
const { harness, startedRoom } = require('./helpers/jp-harness');

const me = ws => ws.state().you;

test('mic on/off is shared with the table and cleared when a player drops', () => {
  const h = harness(), r = startedRoom(3, h), [a, b] = r.socks;
  a.msg({ t: 'jp:vmic', on: true });
  assert.strictEqual(b.state().room.players.find(p => p.pid === me(a)).mic, true);
  h.srv.disconnect(a);
  assert.strictEqual(b.state().room.players.find(p => p.pid === me(a)).mic, false);
});

test('setup messages reach only the named player, sent as the real sender', () => {
  const h = harness(), r = startedRoom(3, h), [a, b, c] = r.socks, out = h.client();
  a.msg({ t: 'jp:vsig', to: me(b), d: { sdp: { type: 'offer', sdp: 'x' } }, from: me(c) });
  const got = b.last('jp:vsig');
  assert.deepStrictEqual(got, { t: 'jp:vsig', from: me(a), d: { sdp: { type: 'offer', sdp: 'x' } } });
  assert.strictEqual(c.last('jp:vsig'), null);
  out.msg({ t: 'jp:vsig', to: me(b), d: { c: 1 } });                     // not at the table
  a.msg({ t: 'jp:vsig', to: me(b), d: { big: 'x'.repeat(30000) } });      // too big
  a.msg({ t: 'jp:vsig', to: me(a), d: { c: 1 } });                       // to yourself
  assert.strictEqual(b.inbox.filter(m => m.t === 'jp:vsig').length, 1);
  assert.strictEqual(a.last('jp:vsig'), null);
});

test('a burst of setup messages never shows rate-limit errors', () => {
  const r = startedRoom(2), [a, b] = r.socks;
  for (let i = 0; i < 80; i++) a.burst({ t: 'jp:vsig', to: me(b), d: { c: i } });
  assert.ok(!a.errs().includes('RATE_LIMIT'));
  assert.strictEqual(b.inbox.filter(m => m.t === 'jp:vsig').length, 60);
});
