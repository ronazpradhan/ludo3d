# Ludo 3D

Multiplayer Ludo. `npm install` then `npm start` (Node 18+). Opens on http://localhost:3000.

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
Scripts load in the order above (see the bottom of `index.html`).

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
