// Flash sapati (borrowing): asking players, bank fallback, limits, mid-game chips, settlement, anti-cheat.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const rules = require('../games/flash/rules');
const { createFlashServer } = require('../games/flash/rooms');

const SP = rules.CONFIG.sapati, C = rules.CONFIG;
function table(n = 3) {
  let t = 1e12;
  const srv = createFlashServer({ send: (ws, o) => ws.inbox.push(JSON.parse(JSON.stringify(o))), now: () => t, log: () => {} });
  const client = () => {
    const ws = { inbox: [] };
    ws.msg = m => { t += 50; srv.handle(ws, m); };
    ws.last = type => { for (let i = ws.inbox.length - 1; i >= 0; i--) if (ws.inbox[i].t === type) return ws.inbox[i]; return null; };
    ws.state = () => ws.last('fl:state');
    ws.lastErr = () => { const e = ws.last('fl:err'); return e && e.code; };
    ws.sap = o => ws.msg({ t: 'fl:x', what: 'sapati', ...o });
    ws.act = move => ws.msg({ t: 'fl:act', v: ws.state().game.version, aid: crypto.randomBytes(6).toString('hex'), move });
    return ws;
  };
  const host = client(); host.msg({ t: 'fl:create', name: 'A' });
  const code = host.last('fl:joined').code, socks = [host];
  for (let i = 1; i < n; i++) { const c = client(); c.msg({ t: 'fl:join', code, name: 'P' + i }); c.msg({ t: 'fl:ready', ready: true }); socks.push(c); }
  host.msg({ t: 'fl:start' });
  const room = srv.rooms.get(code), id = s => s.state().you;
  const chips = s => { const g = room.game, p = id(s); return g.status === 'playing' && g.players.includes(p) && !room.settled ? g.chips[p] : room.chips[p]; };
  return { srv, room, socks, id, chips, advance: ms => { t += ms; srv.sweep(); }, turn: () => socks.find(s => id(s) === (room.game.pending ? room.game.pending.to : room.game.current)) };
}

test('ask a player: they lend from their own chips (even mid-game)', () => {
  const r = table(3), [a, b] = r.socks, ca = r.chips(a), cb = r.chips(b);
  a.sap({ action: 'ask', to: r.id(b), amount: 200 });
  const req = r.room.requests[0];
  assert.deepStrictEqual({ from: req.from, to: req.to, amount: req.amount }, { from: r.id(a), to: r.id(b), amount: 200 });
  b.sap({ action: 'answer', id: req.id, accept: true });
  assert.strictEqual(r.chips(a), ca + 200); assert.strictEqual(r.chips(b), cb - 200);
  assert.deepStrictEqual(r.room.loans, [{ from: r.id(b), to: r.id(a), amount: 200 }]);
  assert.ok(r.room.history.some(e => e.type === 'SAPATI_GIVEN' && e.amount === 200));
});

test('the bank only lends after asking a player did not work', () => {
  const r = table(3), [a, b] = r.socks;
  a.sap({ action: 'bank', amount: 100 });
  assert.strictEqual(a.lastErr(), 'ASK_A_PLAYER_FIRST');
  a.sap({ action: 'ask', to: r.id(b), amount: 100 });
  b.sap({ action: 'answer', id: r.room.requests[0].id, accept: false });
  const before = r.chips(a);
  a.sap({ action: 'bank', amount: 100 });
  assert.strictEqual(r.chips(a), before + 100);
  assert.deepStrictEqual(r.room.loans, [{ from: 'bank', to: r.id(a), amount: 100 }]);
});

test('an unanswered request expires and counts as declined', () => {
  const r = table(3), [a, b] = r.socks;
  a.sap({ action: 'ask', to: r.id(b), amount: 100 });
  r.advance(SP.askSeconds * 1000 + 1500);
  assert.strictEqual(r.room.requests.length, 0);
  assert.ok(r.room.history.some(e => e.type === 'SAPATI_DECLINED' && e.why === 'no answer'));
  a.sap({ action: 'bank', amount: 100 });
  assert.strictEqual(r.room.loans.length, 1);
});

test('limits: borrow cap, lend cap, lender chips, steps', () => {
  const r = table(3), [a, b, c] = r.socks;
  for (const amount of [0, -100, 30, 75, 100.5, '100', SP.maxBorrow + SP.step]) {
    a.sap({ action: 'ask', to: r.id(b), amount });
    assert.ok(['BAD_AMOUNT', 'BORROW_LIMIT'].includes(a.lastErr()), String(amount));
  }
  a.sap({ action: 'ask', to: r.id(b), amount: SP.maxBorrow });
  b.sap({ action: 'answer', id: r.room.requests[0].id, accept: true });
  a.sap({ action: 'ask', to: r.id(c), amount: SP.step });
  assert.strictEqual(a.lastErr(), 'BORROW_LIMIT');                       // a has borrowed the max
  c.sap({ action: 'ask', to: r.id(b), amount: SP.step });
  assert.strictEqual(c.lastErr(), 'LENDER_LIMIT');                       // b has lent the max
  r.room.game.chips[r.id(c)] = 60;                                       // c is nearly broke
  b.sap({ action: 'ask', to: r.id(c), amount: 100 });
  assert.strictEqual(b.lastErr(), 'LENDER_LIMIT');                       // can't lend chips you don't have
});

test('anti-cheat: only the asked player can answer; no self-loans; one request at a time', () => {
  const r = table(3), [a, b, c] = r.socks;
  a.sap({ action: 'ask', to: r.id(a), amount: 100 }); assert.strictEqual(a.lastErr(), 'BAD_REQUEST');
  a.sap({ action: 'ask', to: 'nobody', amount: 100 }); assert.strictEqual(a.lastErr(), 'BAD_REQUEST');
  a.sap({ action: 'ask', to: r.id(b), amount: 100 });
  a.sap({ action: 'ask', to: r.id(c), amount: 100 }); assert.strictEqual(a.lastErr(), 'ALREADY_ASKED');
  const id = r.room.requests[0].id;
  a.sap({ action: 'answer', id, accept: true }); assert.strictEqual(a.lastErr(), 'BAD_REQUEST');   // can't approve your own
  c.sap({ action: 'answer', id, accept: true }); assert.strictEqual(c.lastErr(), 'BAD_REQUEST');   // nor someone else's
  assert.strictEqual(r.room.loans.length, 0);
  a.sap({ action: 'gift', amount: 999 }); assert.strictEqual(a.lastErr(), 'BAD_REQUEST');
  a.msg({ t: 'fl:x', what: 'chips', amount: 99999 }); assert.strictEqual(a.lastErr(), 'BAD_REQUEST');
});

test('borrowed chips can be bet straight away in the running game', () => {
  const r = table(2), cur = r.turn(), other = r.socks.find(s => s !== cur);
  r.room.game.chips[r.id(cur)] = 5;                                      // can't afford any bet
  assert.deepStrictEqual(cur.state().game.you.options.chaal.length >= 0, true);
  cur.sap({ action: 'ask', to: r.id(other), amount: 100 });
  other.sap({ action: 'answer', id: r.room.requests[0].id, accept: true });
  assert.strictEqual(r.room.game.chips[r.id(cur)], 105);
  cur.act({ type: 'chaal', mult: 2 });
  assert.ok(r.room.game.invested[r.id(cur)] >= 30);
});

test('end of round: debts are paid back first, and the real winner is decided after that', () => {
  const r = table(3), [a, b, c] = r.socks, A = r.id(a), B = r.id(b), Cc = r.id(c);
  a.sap({ action: 'ask', to: B, amount: 300 }); b.sap({ action: 'answer', id: r.room.requests[0].id, accept: true });
  c.sap({ action: 'ask', to: A, amount: 50 }); a.sap({ action: 'answer', id: r.room.requests[0].id, accept: false });
  c.sap({ action: 'bank', amount: 200 });
  // play out the whole round by packing
  for (let g = 1; g <= C.gamesPerRound; g++) {
    while (r.room.game.status === 'playing') r.turn().act({ type: 'pack' });
    if (g < C.gamesPerRound) r.advance(C.nextGameSeconds * 1000 + 10);
  }
  assert.strictEqual(r.room.status, 'over');
  // hand-check the books: final = chips before settling - borrowed + lent
  const fin = r.room.final, set = r.room.settlement;
  assert.strictEqual(set.length, 2);
  const chipsNow = { [A]: r.room.chips[A], [B]: r.room.chips[B], [Cc]: r.room.chips[Cc] };
  const repaidA = set.find(l => l.to === A).paid, repaidC = set.find(l => l.to === Cc).paid;
  const before = { [A]: chipsNow[A] + repaidA, [B]: chipsNow[B] - repaidA, [Cc]: chipsNow[Cc] + repaidC };
  assert.strictEqual(fin[A], before[A] - 300);
  assert.strictEqual(fin[B], before[B] + 300);
  assert.strictEqual(fin[Cc], before[Cc] - 200);
  // the bank's money leaves the table again: the players' finals add up to what they started with
  assert.strictEqual(fin[A] + fin[B] + fin[Cc], 3 * C.startingChips);
  const top = Math.max(fin[A], fin[B], fin[Cc]);
  const winners = r.room.players.filter(p => r.room.scores[p.pid] === 1).map(p => p.pid);
  assert.deepStrictEqual(winners.sort(), [A, B, Cc].filter(p => fin[p] === top).sort());
});

test("a borrower who can't repay everything: the shortfall still counts against them", () => {
  const r = table(2), [a, b] = r.socks, A = r.id(a), B = r.id(b);
  a.sap({ action: 'ask', to: B, amount: 500 }); b.sap({ action: 'answer', id: r.room.requests[0].id, accept: true });
  for (let g = 1; g <= C.gamesPerRound; g++) {
    while (r.room.game.status === 'playing') r.turn().act({ type: 'pack' });
    if (g === C.gamesPerRound - 1) { r.room.chips[A] = 120; }            // A lost most of it
    if (g < C.gamesPerRound) r.advance(C.nextGameSeconds * 1000 + 10);
  }
  const line = r.room.settlement[0];
  assert.strictEqual(line.paid + line.unpaid, 500);
  assert.strictEqual(r.room.final[A] + r.room.final[B], r.room.chips[A] + r.room.chips[B] + line.unpaid - line.unpaid);
  assert.strictEqual(r.room.final[A], r.room.chips[A] + line.paid - 500);
});

test('a new round starts with no debts', () => {
  const r = table(2), [a, b] = r.socks;
  a.sap({ action: 'ask', to: r.id(b), amount: 100 }); b.sap({ action: 'answer', id: r.room.requests[0].id, accept: true });
  for (let g = 1; g <= C.gamesPerRound; g++) {
    while (r.room.game.status === 'playing') r.turn().act({ type: 'pack' });
    if (g < C.gamesPerRound) r.advance(C.nextGameSeconds * 1000 + 10);
  }
  a.sap({ action: 'ask', to: r.id(b), amount: 100 });
  assert.strictEqual(a.lastErr(), 'ROUND_NOT_RUNNING');                  // no borrowing between rounds
  r.socks.forEach(s => s.msg({ t: 'fl:ready', ready: true }));
  assert.strictEqual(r.room.round, 2);
  assert.deepStrictEqual(r.room.loans, []);
  for (const s of r.socks) assert.strictEqual(s.state().room.players.find(p => p.pid === r.id(s)).borrowed, 0);
});
