// How good is search? Run with:  npm run bench:search
//
// Sends a set of real searches to the live servers and checks whether the
// song a person obviously meant comes out first (and whether it is in the top
// three). It runs the exact ranking code the app uses (src/lib/searchrank.ts),
// and, for comparison, the plain "ask the main server and show what it says"
// approach the app used before.
//
// Add a line here whenever a search disappoints; fix the ranking; run again.

import { findSongs } from '../src/lib/searchrank.ts';
import { toTracks } from '../src/lib/normalize.ts';
import { cleanTitle, plain } from '../src/lib/util.ts';

const BASE = { main: 'https://spoton-sigma.vercel.app/api', backup: 'https://jiosaavn-api-sage.vercel.app/api' };

// [what is typed, the title it should find, an artist that must be on it]
const CASES = [
  // Hindi and Punjabi
  ['kesariya', 'Kesariya', 'Arijit Singh'],
  ['tum hi ho', 'Tum Hi Ho', 'Arijit Singh'],
  ['apna bana le', 'Apna Bana Le', 'Arijit Singh'],
  ['chaleya', 'Chaleya', 'Arijit Singh'],
  ['o maahi', 'O Maahi', 'Arijit Singh'],
  ['satranga', 'Satranga', 'Arijit Singh'],
  ['channa mereya', 'Channa Mereya', 'Arijit Singh'],
  ['kal ho naa ho', 'Kal Ho Naa Ho', 'Sonu Nigam'],
  ['tum se hi', 'Tum Se Hi', 'Mohit Chauhan'],
  ['kun faya kun', 'Kun Faya Kun', 'A.R. Rahman'],
  ['raataan lambiyan', 'Raataan Lambiyan', 'Jubin Nautiyal'],
  ['husn', 'Husn', 'Anuv Jain'],
  ['heeriye', 'Heeriye', 'Arijit Singh'],
  // (The Atif Aslam recording is not in the catalog; the most-played version that is should lead.)
  ['dil diyan gallan', 'Dil Diyan Gallan', 'Vishal & Shekhar'],
  ['tujhe dekha to', 'Tujhe Dekha To', 'Kumar Sanu'],
  ['jhoome jo pathaan', 'Jhoome Jo Pathaan', 'Arijit Singh'],
  ['brown munde', 'Brown Munde', 'AP Dhillon'],
  ['excuses', 'Excuses', 'AP Dhillon'],
  ['lutt putt gaya', 'Lutt Putt Gaya', 'Arijit Singh'],
  ['maan meri jaan', 'Maan Meri Jaan', 'King'],
  ['tere vaaste', 'Tere Vaaste', 'Varun Jain'],
  ['ae dil hai mushkil', 'Ae Dil Hai Mushkil', 'Arijit Singh'],
  ['malang sajna', 'Malang Sajna', 'Sachet Tandon'],
  ['tere paas main', 'Tere Paas Main', 'A.R. Rahman'],
  // International
  ['shape of you', 'Shape of You', 'Ed Sheeran'],
  ['perfect ed sheeran', 'Perfect', 'Ed Sheeran'],
  ['blinding lights', 'Blinding Lights', 'The Weeknd'],
  ['starboy', 'Starboy', 'The Weeknd'],
  ['believer', 'Believer', 'Imagine Dragons'],
  ['calm down', 'Calm Down', 'Rema'],
  ['senorita shawn mendes', 'Senorita', 'Shawn Mendes'],
  ['no scrubs tlc', 'No Scrubs', 'TLC'],
  ['despacito', 'Despacito', 'Luis Fonsi'],
  ['faded alan walker', 'Faded', 'Alan Walker'],
  ['let me love you', 'Let Me Love You', 'DJ Snake'],
  ['closer chainsmokers', 'Closer', 'The Chainsmokers'],
  ['levitating', 'Levitating', 'Dua Lipa'],
  ['bad guy', 'bad guy', 'Billie Eilish'],
  ['someone like you', 'Someone Like You', 'Adele'],
  ['counting stars', 'Counting Stars', 'OneRepublic'],
  ['cheap thrills', 'Cheap Thrills', 'Sia'],
  ['fa9la', 'FA9LA', 'Flipperachi'],
  ['thunder imagine dragons', 'Thunder', 'Imagine Dragons'],
  ['see you again', 'See You Again', 'Wiz Khalifa'],
  // Typos, half-typed words, and "title + extra words"
  ['kesaria', 'Kesariya', 'Arijit Singh'],
  ['shap of you', 'Shape of You', 'Ed Sheeran'],
  ['beleiver', 'Believer', 'Imagine Dragons'],
  ['tum hi ho arijit', 'Tum Hi Ho', 'Arijit Singh'],
  ['apna ban', 'Apna Bana Le', 'Arijit Singh'],
  ['blinding lights weeknd', 'Blinding Lights', 'The Weeknd'],
  ['chaleya jawan', 'Chaleya', 'Arijit Singh'],
  ['kesariya brahmastra', 'Kesariya', 'Arijit Singh'],
  ['arijit singh tum hi ho', 'Tum Hi Ho', 'Arijit Singh'],
  ['shape of you ed sheeran', 'Shape of You', 'Ed Sheeran'],
  ['calm down rema selena', 'Calm Down', 'Rema'],
  ['channa merya', 'Channa Mereya', 'Arijit Singh'],
  ['raatan lambiyan', 'Raataan Lambiyan', 'Jubin Nautiyal'],
  ['starboy weeknd daft punk', 'Starboy', 'The Weeknd'],
  ['kal ho na ho', 'Kal Ho Naa Ho', 'Sonu Nigam'],
  // Several songs share the title: the famous one should lead
  ['senorita', 'Senorita', 'Shawn Mendes'],
  ['perfect', 'Perfect', 'Ed Sheeran'],
  ['hawayein', 'Hawayein', 'Arijit Singh'],
  ['zaalima', 'Zaalima', 'Arijit Singh'],
  ['stay', 'Stay', 'Justin Bieber'],
  ['heat waves', 'Heat Waves', 'Glass Animals'],
];

async function ask(server, path) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(BASE[server] + path, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

/** What the app did before: the main server's own order. */
async function before(query) {
  try {
    const data = await ask('main', `/search/songs?query=${encodeURIComponent(query)}&page=1&limit=30`);
    return toTracks(data?.results || []);
  } catch {
    return [];
  }
}

function place(list, title, artist) {
  const wantTitle = plain(title);
  const wantArtist = plain(artist);
  return list.findIndex((t) => {
    const got = plain(cleanTitle(t.title));
    return (got === wantTitle || got.startsWith(wantTitle + ' ')) && plain(t.artist).includes(wantArtist);
  });
}

const only = process.argv[2];
const rows = [];
const cases = only ? CASES.filter((c) => c[0].includes(only)) : CASES;
for (let i = 0; i < cases.length; i += 6) {
  const batch = cases.slice(i, i + 6);
  rows.push(...(await Promise.all(batch.map(async ([q, title, artist]) => {
    const t0 = Date.now();
    const [old, now] = await Promise.all([before(q), findSongs(q, ask, ['hindi', 'english']).then((r) => r.songs).catch(() => [])]);
    return { q, want: `${title} — ${artist}`, old: place(old, title, artist), now: place(now, title, artist), ms: Date.now() - t0, top: now[0] ? `${now[0].title} — ${now[0].artist.slice(0, 28)}` : '(nothing)', exists: place(now, title, artist) >= 0 || place(old, title, artist) >= 0 };
  }))));
}

const show = (p) => (p < 0 ? ' — ' : String(p + 1).padStart(2) + ' ');
console.log('\n   before  now   search');
for (const r of rows) {
  const flag = r.now === 0 ? '   ' : r.now > 0 && r.now < 3 ? ' ~ ' : ' ! ';
  console.log(`${flag}  ${show(r.old)}   ${show(r.now)}  ${r.q.padEnd(28)} ${r.now === 0 ? '' : `wanted "${r.want}", top was "${r.top}"`}`);
}
const count = (key, limit) => rows.filter((r) => r[key] >= 0 && r[key] < limit).length;
const n = rows.length;
const pct = (x) => `${x}/${n} (${Math.round((x / n) * 100)}%)`;
console.log(`\nRight song FIRST:      before ${pct(count('old', 1))}   now ${pct(count('now', 1))}`);
console.log(`Right song in top 3:   before ${pct(count('old', 3))}   now ${pct(count('now', 3))}`);
console.log(`Right song found at all: before ${pct(count('old', 99))}   now ${pct(count('now', 99))}`);
console.log(`Typical time per search (both approaches together): ${Math.round(rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(n / 2)])} ms\n`);
