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

## Ludo online: seats, turn timer and bots
- With two players, the second one is seated opposite the first, and if two players sit side by side
  the host's Start moves one to the opposite corner (1st/3rd or 2nd/4th).
- Every player has an avatar; a ring around the current player's avatar counts down their turn:
  15 seconds, then 5 more (orange). If they still don't move, "🤖 Bot joined the game" is announced and
  the host's browser plays for them (like the CPUs), also when someone disconnects.
- The covered player gets an "I'm back" banner (or taps the board, or rejoins); everyone is told they're back.
- Timings live at the top of the game state in `public/js/game.js` (`TURN_MS`, `EXTRA_MS`).

## Flash (3-card betting, play money)
Server-authoritative like Jutpatti, using the same shared room system (`games/common/room-server.js`).
Chips are **play money with no real-world value**.
```
games/common/room-server.js   rooms, lobby, ready, reconnect, open-rooms list, anti-replay (used by Jutpatti + Flash)
games/common/cards.js         52-card deck + crypto-secure Fisher-Yates shuffle
games/flash/rules.js          <- FLASH HOUSE RULES (chips, games per round, boot, bet multipliers, A-2-3, turn clock)
games/flash/engine.js         one game: boot, blind/seen bets, pack, show, side show, timeouts
games/flash/rooms.js          rounds: 10 games per round, Rs 1000 each at the start of every round
public/flash.html, js/flash.js, css/flash.css
```
- A round is 10 games. Everyone starts each round with Rs 1000; chips carry over between that round's games.
- Blind players' own cards are not sent to their browser until they tap to see them.
- 30-second turn clock (auto-pack), 6-second pause between games. Messages use the `fl:` prefix
  (set `FLASH_LOG=0` to silence its server log).
- **Sapati (borrowing):** during a round, tap 💰 Sapati to borrow from a player; if they say no (or don't answer
  in 20 s, or nobody can lend) the bank lends instead. Limits: borrow up to Rs 500 and lend up to Rs 500 per round,
  in steps of Rs 50. Everything is paid back at the end of the round before the winner is decided; anything a
  borrower can't cover is subtracted from their final and credited to the lender. Settings: `sapati` in
  `games/flash/rules.js`.

## Ludo for 5-6 players
Pick the **6-player board** (vs computer: the board button in the setup; online: the host's board button in the lobby).
It's a six-armed board with the same rules: each colour has an arm (3 x 6 cells), a start square, a safe star,
a 5-cell home lane and a yard; the shared track is 78 squares. Orange and Purple join the classic four colours.
Five players = one seat empty or a CPU. Players are spread out evenly at the start (2: opposite; 3: every other arm).
