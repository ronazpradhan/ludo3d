// Builds mimic/sounds/sources.json: Mimic's categories and, for each, a list of sounds (name + mp3 link).
//
// The categories follow soundbuttonslab.com's soundboards (memes, goofy ahh, rizz, Discord, Roblox, Among Us,
// FNAF, Peter Griffin, ...) plus Nepal / India ones. The audio comes from myinstants.com, which allows
// downloading it (soundbuttonslab's robots.txt disallows its sound files for tools). A themed category only
// keeps sounds whose title actually mentions the theme, so "Among Us" is really Among Us.
// Only links are stored; `npm run build` downloads the audio.
// Run: node mimic/scripts/fetch-sounds.mjs   (re-run to refresh the lists)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://www.myinstants.com';
const PER_CATEGORY = 30;

// pages: myinstants pages to read in order. must: a title has to match this to count (themed searches).
const CATEGORIES = [
  { id: 'memes', label: 'Memes', emoji: '😂', hint: 'Copy the meme sound', pages: ['/en/categories/memes/'] },
  { id: 'goofy', label: 'Goofy ahh', emoji: '🤪', hint: 'Go full goofy', pages: ['/en/search/?name=goofy'], must: /goofy|ahh/i },
  { id: 'rizz', label: 'Rizz', emoji: '😏', hint: 'Bring the rizz', pages: ['/en/search/?name=rizz'], must: /rizz/i },
  { id: 'reactions', label: 'Reactions', emoji: '😱', hint: 'React exactly like that', pages: ['/en/categories/reactions/'] },
  { id: 'viral', label: 'Viral', emoji: '🔥', hint: 'Copy the viral sound', pages: ['/en/categories/viral/', '/en/categories/tiktok%20trends/'] },
  { id: 'discord', label: 'Discord', emoji: '🎧', hint: 'Copy the Discord sound', pages: ['/en/search/?name=discord'], must: /discord/i },
  { id: 'roblox', label: 'Roblox', emoji: '🧱', hint: 'Copy the Roblox sound', pages: ['/en/search/?name=roblox'], must: /roblox|oof/i },
  { id: 'among-us', label: 'Among Us', emoji: '🔪', hint: 'Sus. Copy it.', pages: ['/en/search/?name=among%20us', '/en/search/?name=amogus', '/en/search/?name=sus'], must: /among|amogus|sus\b|impostor|imposter/i },
  { id: 'fnaf', label: 'FNAF', emoji: '🐻', hint: 'Copy the jumpscare', pages: ['/en/search/?name=fnaf', '/en/search/?name=freddy'], must: /fnaf|freddy|five nights|foxy|bonnie|chica|springtrap/i },
  { id: 'peter-griffin', label: 'Peter Griffin', emoji: '🍺', hint: 'Do the Peter voice', pages: ['/en/search/?name=peter%20griffin', '/en/search/?name=family%20guy'], must: /peter|griffin|family guy|stewie/i },
  { id: 'spongebob', label: 'SpongeBob', emoji: '🧽', hint: 'Copy the Bikini Bottom sound', pages: ['/en/search/?name=spongebob'], must: /sponge|squidward|patrick|krabs/i },
  { id: 'anime', label: 'Anime', emoji: '🍥', hint: 'Copy the anime line', pages: ['/en/categories/anime%20&%20manga/'] },
  { id: 'games', label: 'Games', emoji: '🎮', hint: 'Copy the game sound', pages: ['/en/categories/games/'] },
  { id: 'movies', label: 'Movies', emoji: '🍿', hint: 'Copy the movie line', pages: ['/en/categories/movies/'] },
  { id: 'farts', label: 'Farts', emoji: '💨', hint: 'You know what to do', pages: ['/en/search/?name=fart'], must: /fart/i },
  { id: 'nepal-trending', label: 'Nepal trending', emoji: '📈', hint: 'Copy what’s trending in Nepal', pages: ['/en/index/np/'] },
  { id: 'nepali', label: 'Nepali', emoji: '🏔️', hint: 'Say it exactly like the clip', pages: ['/en/search/?name=nepal', '/en/search/?name=nepal%20police'] },
  { id: 'indian-memes', label: 'Indian memes', emoji: '🛺', hint: 'Copy the desi meme', pages: ['/en/index/in/', '/en/search/?name=indian'] },
  { id: 'cid', label: 'CID', emoji: '🕵️', hint: 'Daya, darwaza tod do', pages: ['/en/search/?name=cid'] },
  { id: 'bollywood', label: 'Bollywood', emoji: '🎬', hint: 'Deliver the dialogue', pages: ['/en/search/?name=bollywood', '/en/search/?name=hindi'] },
];

const BUTTON = /onclick="play\('(\/media\/sounds\/[^']+\.mp3)'[^"]*"\s+title="Play ([^"]+?) sound"/g;
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Clips titled with slurs are left out everywhere. */
const BLOCKED = /n[\s-]?word|nigg|retard|\bfag/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(path) {
  const res = await fetch(SITE + path, { headers: { 'User-Agent': 'Mozilla/5.0 (Mimic sound list)' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const html = await res.text();
  return [...html.matchAll(BUTTON)].map(m => ({ name: decode(m[2]).trim().slice(0, 40), url: SITE + m[1] }));
}

const seen = new Set();
const out = [];
for (const cat of CATEGORIES) {
  const sounds = [];
  outer: for (const base of cat.pages) {
    for (let p = 1; p <= 4; p++) {
      const path = p === 1 ? base : `${base}${base.includes('?') ? '&' : '?'}page=${p}`;
      let found;
      try {
        found = await page(path);
      } catch {
        break; // no more pages
      }
      if (!found.length) break;
      for (const s of found) {
        if (seen.has(s.url) || BLOCKED.test(s.name) || (cat.must && !cat.must.test(s.name))) continue;
        seen.add(s.url);
        sounds.push(s);
        if (sounds.length >= PER_CATEGORY) break outer;
      }
      await sleep(350);
    }
  }
  const { pages: _p, must: _m, ...meta } = cat;
  out.push({ ...meta, sounds });
  console.log(`${cat.label}: ${sounds.length}`);
}
writeFileSync(fileURLToPath(new URL('../sounds/sources.json', import.meta.url)), JSON.stringify(out, null, 1) + '\n');
