// Builds mimic/sounds/sources.json: Mimic's categories and, for each, a list of sounds on myinstants.com
// (name + mp3 link). Only links are stored in the repo; `npm run build` downloads the audio itself.
// Run: node mimic/scripts/fetch-myinstants.mjs   (re-run to refresh the lists)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://www.myinstants.com';
const PER_CATEGORY = 40;

// Each category pulls from one or more myinstants pages, in order, until it has PER_CATEGORY sounds.
const CATEGORIES = [
  { id: 'nepal-trending', label: 'Nepal trending', emoji: '📈', hint: 'Copy what’s trending in Nepal', pages: ['/en/index/np/'] },
  { id: 'nepali', label: 'Nepali', emoji: '🏔️', hint: 'Say it exactly like the clip', pages: ['/en/search/?name=nepal', '/en/search/?name=nepal%20police', '/en/search/?name=nepali'] },
  { id: 'indian-memes', label: 'Indian memes', emoji: '🛺', hint: 'Copy the desi meme', pages: ['/en/index/in/', '/en/search/?name=indian'] },
  { id: 'cid', label: 'CID', emoji: '🕵️', hint: 'Daya, darwaza tod do', pages: ['/en/search/?name=cid'] },
  { id: 'bollywood', label: 'Bollywood', emoji: '🎬', hint: 'Deliver the dialogue', pages: ['/en/search/?name=bollywood', '/en/search/?name=hindi'] },
  { id: 'memes', label: 'Memes', emoji: '😂', hint: 'Copy the meme sound', pages: ['/en/categories/memes/'] },
  { id: 'reactions', label: 'Reactions', emoji: '😱', hint: 'React exactly like that', pages: ['/en/categories/reactions/'] },
  { id: 'viral', label: 'Viral', emoji: '🔥', hint: 'Copy the viral sound', pages: ['/en/categories/viral/'] },
  { id: 'tiktok', label: 'TikTok trends', emoji: '🎵', hint: 'Copy the trend', pages: ['/en/categories/tiktok%20trends/'] },
  { id: 'anime', label: 'Anime', emoji: '🍥', hint: 'Copy the anime line', pages: ['/en/categories/anime%20&%20manga/'] },
  { id: 'games', label: 'Games', emoji: '🎮', hint: 'Copy the game sound', pages: ['/en/categories/games/'] },
  { id: 'movies', label: 'Movies', emoji: '🍿', hint: 'Copy the movie line', pages: ['/en/categories/movies/'] },
  { id: 'sound-effects', label: 'Sound effects', emoji: '💥', hint: 'Make the noise with your voice', pages: ['/en/categories/sound%20effects/'] },
];

const BUTTON = /onclick="play\('(\/media\/sounds\/[^']+\.mp3)'[^"]*"\s+title="Play ([^"]+?) sound"/g;
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
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
      } catch (e) {
        console.log(`  ${cat.id}: ${e.message}`);
        break;
      }
      if (!found.length) break;
      for (const s of found) {
        if (seen.has(s.url)) continue;
        seen.add(s.url);
        sounds.push(s);
        if (sounds.length >= PER_CATEGORY) break outer;
      }
      await sleep(400);
    }
  }
  const { pages: _pages, ...meta } = cat;
  out.push({ ...meta, sounds });
  console.log(`${cat.label}: ${sounds.length}`);
}
writeFileSync(fileURLToPath(new URL('../sounds/sources.json', import.meta.url)), JSON.stringify(out, null, 1) + '\n');
