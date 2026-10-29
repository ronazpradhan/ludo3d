// Generates mimic/sounds/synth.json: the original, synthesized clips players imitate.
// Run: node mimic/scripts/build-sounds.mjs   (output is committed; re-run after editing this file)
// Real recordings go in mimic/sounds/<category>/ instead; see build-library.mjs.
// Every clip is made from tones, glides and claps a person can copy by humming, whistling or clapping.
// Pitches stay in a comfortable range (about 200-700 Hz); scoring ignores key and octave anyway.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../sounds/synth.json', import.meta.url));
const hz = midi => +(440 * 2 ** ((midi - 69) / 12)).toFixed(2);
const r3 = x => +x.toFixed(3);

// Seeded PRNG so the library is the same every time it's built.
let seed = 20261029;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = xs => xs[Math.floor(rand() * xs.length)];

const clips = [];
const counters = {};
function add(category, difficulty, name, events) {
  const n = (counters[category] = (counters[category] ?? 0) + 1);
  // The difficulty only shapes how busy a clip is; it isn't stored or shown.
  clips.push({ id: `${category}-${String(n).padStart(3, '0')}`, name, category, events: events.map(e => ({ ...e, t: r3(e.t), d: r3(e.d) })) });
}

// ---------- melodies: hum or whistle it ----------
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
const melodyNames = ['Little climb', 'Bouncy hum', 'Sleepy tune', 'Happy hop', 'Wobbly walk', 'Up the stairs', 'Down the hill', 'Question tune', 'Lullaby bit', 'March step', 'Zig-zag', 'Echo tune', 'Sunny hum', 'Rainy hum', 'Short jingle'];
const melodyPlan = { easy: [3, 3, 0.36], medium: [4, 5, 0.3], hard: [6, 8, 0.24] };
for (const difficulty of ['easy', 'medium', 'hard']) {
  const [minN, maxN, beat] = melodyPlan[difficulty];
  for (let k = 0; k < 15; k++) {
    const scale = rand() < 0.7 ? MAJOR : MINOR;
    const root = 57 + Math.floor(rand() * 8); // A3..E4
    const n = minN + Math.floor(rand() * (maxN - minN + 1));
    let deg = Math.floor(rand() * 4);
    let t = 0;
    const events = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const step = pick(difficulty === 'easy' ? [-1, 1, 2, -2] : [-3, -2, -1, 1, 2, 3, 4]);
        deg = Math.max(0, Math.min(scale.length - 1, deg + step));
        if (events.length && hz(root + scale[deg]) === events[events.length - 1].f) deg = Math.min(scale.length - 1, deg + 1);
      }
      const len = difficulty === 'hard' ? pick([beat, beat, beat * 2]) : i === n - 1 ? beat * 1.6 : beat;
      events.push({ t, d: len * 0.9, wave: 'triangle', f: hz(root + scale[deg]) });
      t += len;
    }
    add('melody', difficulty, `${melodyNames[k]}`, events);
  }
}

// ---------- glides: sirens, swoops and slides ----------
const glide = (t, d, f, f2, wave = 'sine', extra = {}) => ({ t, d, wave, f, f2, ...extra });
const glides = [
  ['easy', 'Rising whistle', [glide(0, 1.0, 300, 700)]],
  ['easy', 'Falling whistle', [glide(0, 1.2, 750, 250)]],
  ['easy', 'Up and down', [glide(0, 0.6, 300, 650), glide(0.6, 0.6, 650, 300)]],
  ['easy', 'Down and up', [glide(0, 0.6, 600, 280), glide(0.6, 0.6, 280, 600)]],
  ['easy', 'Question?', [glide(0, 0.5, 300, 330), glide(0.5, 0.4, 330, 520)]],
  ['easy', 'Uh-oh', [glide(0, 0.3, 500, 500), glide(0.4, 0.5, 400, 400)]],
  ['easy', 'Yawn', [glide(0, 1.4, 520, 230, 'sine', { a: 0.7 })]],
  ['easy', 'Slide whistle up', [glide(0, 0.7, 260, 680, 'triangle')]],
  ['easy', 'Ding-dong', [glide(0, 0.5, 660, 660, 'sine'), glide(0.55, 0.8, 520, 520, 'sine')]],
  ['easy', 'Hooray', [glide(0, 0.4, 330, 440), glide(0.4, 0.6, 440, 590)]],
  ['medium', 'Siren', [0, 1, 2].map(i => glide(i * 0.6, 0.6, i % 2 ? 700 : 400, i % 2 ? 400 : 700))],
  ['medium', 'Two-tone siren', [0, 1, 2, 3].map(i => glide(i * 0.35, 0.33, i % 2 ? 440 : 587, i % 2 ? 440 : 587, 'square'))],
  ['medium', 'Swoop swoop', [glide(0, 0.4, 300, 700), glide(0.5, 0.4, 300, 700)]],
  ['medium', 'Bird call', [glide(0, 0.25, 600, 750), glide(0.3, 0.25, 600, 750), glide(0.65, 0.5, 750, 500)]],
  ['medium', 'Ghost', [glide(0, 1.6, 350, 520, 'sine', { vib: [5, 1.2] })]],
  ['medium', 'Puppy whine', [glide(0, 0.5, 500, 700), glide(0.55, 0.7, 700, 450)]],
  ['medium', 'Elevator', [glide(0, 0.3, 300, 300), glide(0.3, 0.3, 380, 380), glide(0.6, 0.3, 450, 450), glide(0.9, 0.5, 600, 600)]],
  ['medium', 'Dropping bomb', [glide(0, 1.6, 900, 300, 'sine')]],
  ['medium', 'Wobble', [glide(0, 1.2, 420, 420, 'triangle', { vib: [4, 2.5] })]],
  ['medium', 'Cat stretch', [glide(0, 0.4, 330, 600), glide(0.4, 0.9, 600, 300)]],
  ['hard', 'Fast siren', [0, 1, 2, 3, 4, 5].map(i => glide(i * 0.3, 0.3, i % 2 ? 680 : 380, i % 2 ? 380 : 680))],
  ['hard', 'Roller coaster', [glide(0, 0.8, 300, 650), glide(0.8, 0.3, 650, 280), glide(1.1, 0.5, 280, 520), glide(1.6, 0.6, 520, 250)]],
  ['hard', 'Bird song', [0, 1, 2, 3].map(i => glide(i * 0.22, 0.18, 620, 760)).concat([glide(1.0, 0.6, 760, 480)])],
  ['hard', 'Spooky slide', [glide(0, 0.6, 300, 450, 'sine', { vib: [6, 1] }), glide(0.6, 0.6, 450, 330, 'sine', { vib: [6, 1] }), glide(1.2, 0.9, 330, 600, 'sine', { vib: [6, 1] })]],
  ['hard', 'Ambulance far away', [0, 1, 2, 3, 4].map(i => glide(i * 0.4, 0.38, i % 2 ? 415 : 554, i % 2 ? 415 : 554, 'square', { a: 0.6 }))],
  ['hard', 'Up, up, away', [glide(0, 0.3, 300, 380), glide(0.35, 0.3, 380, 470), glide(0.7, 0.3, 470, 560), glide(1.05, 0.8, 560, 820)]],
  ['hard', 'Sigh then laugh', [glide(0, 0.8, 500, 280)].concat([0, 1, 2, 3].map(i => glide(1.0 + i * 0.18, 0.12, 520, 480)))],
  ['hard', 'Zig-zag siren', [glide(0, 0.3, 350, 600), glide(0.3, 0.2, 600, 450), glide(0.5, 0.3, 450, 700), glide(0.8, 0.2, 700, 500), glide(1.0, 0.6, 500, 300)]],
  ['hard', 'Wolf howl', [glide(0, 0.5, 300, 520), glide(0.5, 1.2, 520, 420, 'sine', { vib: [4, 0.8] })]],
  ['hard', 'Seagull', [0, 1, 2].map(i => glide(i * 0.35, 0.3, 700, 520, 'saw', { a: 0.6 }))],
];
for (const [d, name, events] of glides) add('glide', d, name, events);

// ---------- rhythms: clap or tap it ----------
const clap = t => ({ t, d: 0.11, wave: 'noise' });
const rhythmNames = ['Clap clap', 'Knock knock', 'Gallop', 'Drum roll', 'Footsteps', 'Heartbeat', 'Door knock', 'Rain drops', 'Train', 'Tap dance', 'Woodpecker', 'Marching', 'Ping-pong', 'Typing', 'Hiccups'];
const rhythmPlan = { easy: [3, 4, [0.4, 0.4, 0.8]], medium: [5, 6, [0.25, 0.25, 0.5, 0.75]], hard: [7, 9, [0.15, 0.2, 0.3, 0.45, 0.6]] };
for (const difficulty of ['easy', 'medium', 'hard']) {
  const [minN, maxN, gaps] = rhythmPlan[difficulty];
  const used = new Set();
  for (let k = 0; k < 12; k++) {
    let times;
    do {
      const n = minN + Math.floor(rand() * (maxN - minN + 1));
      times = [0];
      for (let i = 1; i < n; i++) times.push(r3(times[i - 1] + pick(gaps)));
    } while (used.has(times.join()));
    used.add(times.join());
    add('rhythm', difficulty, `${rhythmNames[(k + (difficulty === 'medium' ? 4 : difficulty === 'hard' ? 8 : 0)) % rhythmNames.length]} ${k + 1}`, times.map(clap));
  }
}

// ---------- sound effects ----------
const note = (t, d, f, wave = 'triangle', extra = {}) => ({ t, d, wave, f, ...extra });
const fx = [
  ['easy', 'Boing', [glide(0, 0.6, 600, 220, 'square', { vib: [9, 0.6] })]],
  ['easy', 'Laser', [glide(0, 0.35, 900, 250, 'square')]],
  ['easy', 'Beep beep beep', [0, 1, 2].map(i => note(i * 0.3, 0.18, 660, 'square'))],
  ['easy', 'Car horn', [note(0, 0.22, 400, 'square'), note(0.32, 0.45, 400, 'square')]],
  ['easy', 'Owl hoot', [note(0, 0.35, 400, 'sine'), note(0.5, 0.6, 360, 'sine')]],
  ['easy', 'Cuckoo', [note(0, 0.3, 660, 'sine'), note(0.35, 0.45, 523, 'sine')]],
  ['easy', 'Microwave ding', [note(0, 1.0, 1046, 'sine')]],
  ['easy', 'Knock knock', [clap(0), clap(0.25), clap(0.9), clap(1.15)]],
  ['medium', 'Pew pew pew', [0, 1, 2].map(i => glide(i * 0.25, 0.18, 900, 300, 'square'))],
  ['medium', 'Power up', [0, 1, 2, 3, 4].map(i => note(i * 0.12, 0.11, hz(60 + i * 4), 'square'))],
  ['medium', 'Power down', [0, 1, 2, 3, 4].map(i => note(i * 0.15, 0.14, hz(76 - i * 4), 'square'))],
  ['medium', 'Sad trombone', [note(0, 0.35, 392, 'saw'), note(0.4, 0.35, 370, 'saw'), note(0.8, 0.35, 349, 'saw'), note(1.2, 0.9, 330, 'saw', { vib: [5, 0.6] })]],
  ['medium', 'Ta-da!', [note(0, 0.18, 523, 'square'), note(0.22, 0.8, 784, 'square')]],
  ['medium', 'Countdown', [0, 1, 2].map(i => note(i * 0.5, 0.15, 523, 'sine')).concat([note(1.5, 0.6, 1046, 'sine')])],
  ['medium', 'Phone ringing', Array.from({ length: 8 }, (_, i) => note(i * 0.07, 0.065, i % 2 ? 480 : 620, 'sine')).concat(Array.from({ length: 8 }, (_, i) => note(0.9 + i * 0.07, 0.065, i % 2 ? 480 : 620, 'sine')))],
  ['medium', 'Spring', [glide(0, 0.9, 300, 600, 'sine', { vib: [10, 3] })]],
  ['medium', 'Tick tock', [0, 1, 2, 3].map(i => clap(i * 0.45))],
  ['hard', 'Victory fanfare', [note(0, 0.15, 392, 'square'), note(0.17, 0.15, 392, 'square'), note(0.34, 0.15, 392, 'square'), note(0.55, 0.6, 523, 'square')]],
  ['hard', 'Alarm clock', Array.from({ length: 4 }, (_, i) => [note(i * 0.4, 0.08, 880, 'square'), note(i * 0.4 + 0.12, 0.08, 880, 'square')]).flat()],
  ['hard', 'UFO', [glide(0, 2.0, 500, 500, 'sine', { vib: [7, 4] })]],
  ['hard', 'Robot talking', [note(0, 0.15, 300, 'square'), note(0.17, 0.15, 450, 'square'), note(0.34, 0.15, 300, 'square'), note(0.51, 0.3, 380, 'square'), note(0.85, 0.15, 450, 'square'), note(1.02, 0.4, 300, 'square')]],
  ['hard', 'Heartbeat', [0, 1, 2].map(i => [clap(i * 0.8), clap(i * 0.8 + 0.2)]).flat()],
  ['hard', 'Game over', [note(0, 0.25, 494, 'square'), note(0.28, 0.25, 440, 'square'), note(0.56, 0.25, 392, 'square'), glide(0.84, 0.9, 370, 260, 'square')]],
  ['hard', 'Drip drop', [0, 1, 2, 3].map(i => glide(i * 0.35 + (i % 2) * 0.1, 0.1, 500 + i * 60, 900 + i * 60, 'sine'))],
];
for (const [d, name, events] of fx) add('fx', d, name, events);

writeFileSync(out, JSON.stringify(clips, null, 0).replace(/\},\{"id"/g, '},\n{"id"') + '\n');
console.log(`${clips.length} clips ->`, out);
