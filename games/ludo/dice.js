// Ludo online: the relay still carries the game, but the server now rolls every die and keeps the
// order of decisions. Clients ask for "roll n" and get the value back from here, so a modified
// browser can't pick its own numbers. Picks (which pawn to move) are recorded in order too, so the
// server's log is the one true record of the game used to resync anyone who drifts.
const crypto = require('crypto');

const MAX_LOG = 6000, SEED_WINDOW_MS = 90 * 1000;
const LOG_RE = /^[1-6a-d]{1,6000}$/;

function createLudoDice({ randInt = (a, b) => crypto.randomInt(a, b), now = Date.now } = {}) {
  const boot = now();
  const games = new Map();   // room -> { g, log: [{ k: 'r', v } | { k: 'p', i }] }
  const enc = e => e.k === 'r' ? String(e.v) : 'abcd'[e.i];
  const logOf = s => ({ g: s.g, l: s.log.map(enc).join('') });
  const ev = (s, n) => ({ ...s.log[n], n, g: s.g });

  // Returns the messages to send: [{ to: 'all' | 'me', topic, data }].
  function handle(room, topic, d) {
    if (!d || typeof d !== 'object' || !Number.isInteger(d.g) || d.g < 0 || d.g > 1e6) return [];
    let s = games.get(room);
    if (topic === 'sync') return [{ to: 'me', topic: 'log', data: s ? logOf(s) : { g: d.g, l: '' } }];

    if (topic === 'seed') {
      // Only right after a server restart, when a game in progress has to be rebuilt from the players' copies.
      if (now() - boot > SEED_WINDOW_MS || (s && s.log.length) || typeof d.l !== 'string' || !LOG_RE.test(d.l)) return [];
      s = { g: d.g, log: [...d.l].map(c => c >= '1' && c <= '6' ? { k: 'r', v: +c } : { k: 'p', i: c.charCodeAt(0) - 97 }) };
      games.set(room, s);
      return [{ to: 'all', topic: 'log', data: logOf(s) }];
    }

    if (topic !== 'g') return [];
    const { n, k } = d;
    if (!Number.isInteger(n) || n < 0 || n >= MAX_LOG || (k !== 'r' && k !== 'p')) return [];
    if (k === 'p' && !(Number.isInteger(d.i) && d.i >= 0 && d.i < 4)) return [];
    if (!s || d.g === s.g + 1) games.set(room, s = { g: d.g, log: [] });   // first game, or "play again"
    else if (d.g !== s.g) return d.g < s.g ? [{ to: 'me', topic: 'log', data: logOf(s) }] : [];

    if (n < s.log.length) {   // already decided: repeat it; a different pick loses to the first one
      const e = s.log[n];
      return e.k === k && (k === 'r' || e.i === d.i) ? [{ to: 'all', topic: 'g', data: ev(s, n) }] : [{ to: 'me', topic: 'log', data: logOf(s) }];
    }
    if (n > s.log.length) return [{ to: 'me', topic: 'log', data: logOf(s) }];   // skipped ahead: show them where we are
    s.log.push(k === 'r' ? { k: 'r', v: randInt(1, 7) } : { k: 'p', i: d.i });
    return [{ to: 'all', topic: 'g', data: ev(s, n) }];
  }

  return { handle, drop: room => games.delete(room), _games: games };
}

module.exports = { createLudoDice };
