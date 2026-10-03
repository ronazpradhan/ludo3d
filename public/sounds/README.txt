Put your audio files here (mp3, wav, ogg, m4a), for example faaa.mp3.
Then open public/index.html, find the AUDIO block at the top of the script, and set the paths:

  capture: 'sounds/faaa.mp3'                      <- plays when a pawn is captured
  board:   { label: 'Faaa', src: 'sounds/faaa.mp3' }  <- soundboard buttons in chat

Keep files small (under about 200 KB each) so they play instantly on phones.
