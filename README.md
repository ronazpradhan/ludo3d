# Ludo 3D + Jutpatti

Multiplayer Ludo and Jutpatti. `npm install` then `npm start` (Node 18+). Opens on http://localhost:3000
(game picker). `npm test` runs the test suite.

## Where everything is

```
server.js              web server + realtime relay (rooms live in memory)
package.json
public/
  index.html           page markup only
  css/style.css        all styling
  img/logo.svg         site logo + favicon  (replace with your own SVG, keep the name)
  sounds/
    capture.mp3        plays when a pawn is eliminated  (replace the file to change it)
    faaa.mp3           soundboard button 1
  js/
    config.js          <- YOUR SOUND SETTINGS (edit this one)
    storage.js         localStorage helper
    realtime.js        WebSocket client: auto-reconnect + heartbeat
    audio.js           built-in sounds, file playback, mute switches
    game.js            board, pawns, dice, rules, game loop
    online.js          rooms, lobby, chat, soundboard, rejoin
```
Scripts load in the order above (see the bottom of `ludo.html`).

Jutpatti files:
```
games/jutpatti/
  rules.js             <- JUTPATTI HOUSE RULES (hand sizes, joker rule, draw sources...) - edit this one
  cards.js             52-card deck + crypto-secure Fisher-Yates shuffle
  engine.js            pure game engine: createGame, getValidMoves, isValidMove, applyMove, nextTurn, viewFor
  rooms.js             rooms, lobby, ready/start/rematch, reconnect, anti-cheat checks, event log
public/
  jutpatti.html, css/jutpatti.css, js/jutpatti.js   the table UI (draws server state, sends intents)
test/                  deck, engine, anti-cheat, fairness (statistical) and end-to-end server tests
```

## Change the elimination sound
Either replace `public/sounds/capture.mp3` with your file (same name), or open
`public/js/config.js` and change `capture:` to another path. Set it to `''` to use the built-in synth sound.
Keep files under ~200 KB.

## Soundboard
Slots are listed in `config.js` under `board`. Chat > Sounds tab has a mute button for the soundboard only.
The speaker button in the game is the master mute (everything). Both settings are remembered in the browser.

## Rejoin
While you are in a room the browser saves the room code, your player id and every dice/pick decision
(`localStorage`, key `ludo3d.session`). If you reload, press Back, or lose the connection:
- same tab: you are put straight back into the room and the game is replayed silently to the current position
- other tab / after closing the browser: a "Rejoin" button appears on the home screen
Quitting, leaving, or finishing a game clears the saved session. Sessions expire after 12 hours.
Note: the host runs the CPU players, so a game with CPUs waits while the host is away.

## Jutpatti
Unlike Ludo (where browsers run the game and the server only relays), Jutpatti is **server-authoritative**:
the deck, every hand, the turn order, legal moves and the winner live only on the server. Each browser
receives its own cards and only card *counts* for opponents. Messages use the `jp:` prefix on the same
WebSocket connection Ludo uses. The deck is shuffled with `crypto.randomInt` (no seeds); the first dealer is
random and then rotates. Server event logs are JSON lines tagged `"game":"jutpatti"` (set `JUTPATTI_LOG=0`
to silence them); they never contain a card drawn from the stock.
Rejoin: refreshing the tab puts you straight back in your seat; another tab/browser restart shows a Rejoin
button. A player who stays disconnected for 2 minutes during a game is removed and their cards are shuffled
back into the stock.
