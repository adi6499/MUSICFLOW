// Home: a greeting, where you left off, moods, and what's new.

import { useState } from 'preact/hooks';
import { Settings as Cog } from 'lucide-preact';
import type { HomeSection, Track } from '../lib/types';
import { getHome, homeKey, keys, searchSongs } from '../lib/api';
import { dedupeSongs } from '../lib/normalize';
import { history, mostPlayed, setSetting, settings, topArtistNames } from '../lib/library';
import * as offline from '../lib/offline';
import * as player from '../lib/player';
import { route, to } from '../lib/router';
import { cx, greeting, isIOS, isStandalone, plain } from '../lib/util';
import { isApp } from '../lib/native';
import { MOODS, playMood } from '../ui/actions';
import { Art, Failed, Link, SkeletonShelf, Spinner, TopBar } from '../ui/bits';
import { ItemGrid, ItemShelf, Section } from '../ui/cards';
import { useQuery } from '../ui/hooks';
import { isWide } from '../ui/state';
import { MadeForYou, NewFromFollowed } from './mixes';

export const LANGUAGES: Array<[string, string]> = [
  ['hindi', 'Hindi'], ['english', 'English'], ['punjabi', 'Punjabi'], ['marathi', 'Marathi'], ['gujarati', 'Gujarati'],
  ['tamil', 'Tamil'], ['telugu', 'Telugu'], ['bengali', 'Bengali'], ['kannada', 'Kannada'], ['malayalam', 'Malayalam'],
  ['bhojpuri', 'Bhojpuri'], ['haryanvi', 'Haryanvi'], ['rajasthani', 'Rajasthani'], ['urdu', 'Urdu'], ['odia', 'Odia'], ['assamese', 'Assamese'],
];

export function LanguageChips() {
  const chosen = settings.value.languages;
  const flip = (code: string) => {
    const next = chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code];
    if (next.length) setSetting('languages', next);
  };
  return (
    <div class="chips">
      {LANGUAGES.map(([code, name]) => (
        <button key={code} class={cx('chip', chosen.includes(code) && 'on')} aria-pressed={chosen.includes(code)} onClick={() => flip(code)}>{name}</button>
      ))}
    </div>
  );
}

function Welcome() {
  return (
    <section class="section">
      <div class="set-card" style={{ padding: '18px 16px 16px' }}>
        <h2 class="title" style={{ fontSize: 23 }}>Welcome to Sukoon</h2>
        <p class="muted" style={{ margin: '6px 0 16px', fontSize: 14.5 }}>Which languages do you listen to? You can change this any time in Settings.</p>
        <LanguageChips />
        <button class="btn" style={{ marginTop: 18 }} onClick={() => setSetting('welcomed', true)}>Done</button>
      </div>
    </section>
  );
}

/**
 * iPhone only, shown once: Safari is fine, but from the Home Screen the app
 * opens full screen, keeps its library for good, and is one tap away.
 */
function HomeScreenTip() {
  return (
    <section class="section" style={{ marginTop: 18 }}>
      <div class="set-card" style={{ padding: '16px 16px 14px' }}>
        <b style={{ fontSize: 15.5, fontWeight: 500 }}>Add Sukoon to your Home Screen</b>
        <p class="muted" style={{ margin: '6px 0 12px', fontSize: 14 }}>
          Tap the Share button below, then <b style={{ fontWeight: 500 }}>Add to Home Screen</b>. Sukoon then opens full screen like an app and your liked songs and playlists are kept safely.
        </p>
        <button class="btn quiet small" onClick={() => setSetting('homeTipSeen', true)}>Got it</button>
      </div>
    </section>
  );
}

const HUES: Record<string, number> = {
  calm: 200, focus: 232, sleep: 262, romance: 345, rain: 186, retro: 36, energy: 14, drive: 150, devotional: 46, sufi: 292,
};

export function Moods(props: { limit?: number }) {
  const [busy, setBusy] = useState('');
  const [all, setAll] = useState(false);
  const list = props.limit && !all ? MOODS.slice(0, props.limit) : MOODS;
  const start = async (key: string) => {
    if (busy) return;
    const mood = MOODS.find((m) => m.key === key)!;
    setBusy(key);
    await playMood(mood);
    setBusy('');
  };
  return (
    <>
      <div class="moods">
        {list.map((m) => (
          <button key={m.key} class="mood" style={{ '--h': HUES[m.key] ?? 220 }} onClick={() => void start(m.key)} aria-busy={busy === m.key}>
            {busy === m.key && <span class="mood-busy"><Spinner size={18} /></span>}
            <b>{m.name}</b>
            <span>{m.line}</span>
          </button>
        ))}
      </div>
      {props.limit && props.limit < MOODS.length && !all && (
        <button class="btn quiet small" style={{ marginTop: 12 }} onClick={() => setAll(true)}>More moods</button>
      )}
    </>
  );
}

/** The last few different things played, as quick buttons. */
function JumpBackIn() {
  const seen = new Set<string>();
  const recent: Track[] = [];
  for (const p of history.value) {
    if (seen.has(p.t.id)) continue;
    seen.add(p.t.id);
    recent.push(p.t);
    if (recent.length >= 6) break;
  }
  if (recent.length < 2) return null;
  return (
    <section class="section" style={{ marginTop: 18 }}>
      <div class="picks">
        {recent.map((t, i) => (
          <button key={t.id} class={cx('pick', !offline.canPlay(t) && 'away')} onClick={() => player.playTracks(recent, i, 'Recently played')}>
            <Art src={t.image} />
            <span class="clip-2">{t.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** With no internet, what is on the device comes first. */
function OfflineShelf() {
  if (offline.online.value) return null;
  const list = offline.downloads.value;
  if (!list.length) {
    return (
      <section class="section" style={{ marginTop: 18 }}>
        <div class="set-card" style={{ padding: '16px 16px 14px' }}>
          <b style={{ fontSize: 15.5, fontWeight: 500 }}>You're offline</b>
          <p class="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>Nothing is downloaded yet. Next time you're online, tap the download arrow on an album, a playlist or your liked songs, and they'll play here without internet.</p>
        </div>
      </section>
    );
  }
  return (
    <Section title="Your downloads" more={to.library('downloads')}>
      <ItemShelf items={list.slice(0, 16).map((d) => d.t)} small />
    </Section>
  );
}

function MoreFrom(props: { artist: string }) {
  const q = useQuery(keys.songs(props.artist, 1, 20), (signal) => searchSongs(props.artist, 1, 20, signal));
  const want = plain(props.artist);
  const songs = dedupeSongs((q.data || []).filter((t) => plain(t.artist).includes(want)));
  if (songs.length < 4) return null;
  return (
    <Section title={`More from ${props.artist}`} more={to.artistNamed(props.artist)}>
      <ItemShelf items={songs} small />
    </Section>
  );
}

export function Home() {
  const s = settings.value;
  const q = useQuery(homeKey(s.languages), (signal) => getHome(s.languages, signal), { persist: true });
  const favourites = mostPlayed.value;
  const artists = topArtistNames.value.slice(0, 2);
  const wide = isWide.value;

  return (
    <div class="page page-in">
      <header class="page-head" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <h1 class="display" style={{ flex: 1 }}>{greeting()}</h1>
        {!wide && <Link to={to.settings()} class="icon-btn" label="Settings"><Cog size={22} /></Link>}
      </header>

      {!s.welcomed && <Welcome />}
      {s.welcomed && !s.homeTipSeen && isIOS && !isStandalone && !isApp && <HomeScreenTip />}
      <OfflineShelf />
      <JumpBackIn />
      <MadeForYou />

      <Section title="Play a mood">
        <Moods limit={wide ? undefined : 6} />
      </Section>

      <NewFromFollowed />

      {favourites.length >= 4 && (
        <Section title="Your most played">
          <ItemShelf items={favourites} small />
        </Section>
      )}

      {q.loading && (
        <>
          <Section title="Trending now"><SkeletonShelf /></Section>
          <Section title="Top charts"><SkeletonShelf /></Section>
        </>
      )}
      {q.error && !q.data && <Failed error={q.error} retry={q.reload} />}
      {q.data?.map((sec, i) => (
        <div key={sec.key} style={{ display: 'contents' }}>
          <Section title={sec.title} more={sec.items.length > 8 ? to.section(sec.key) : undefined}>
            <ItemShelf items={sec.items.slice(0, 16)} />
          </Section>
          {i === 0 && artists.map((a) => <MoreFrom key={a} artist={a} />)}
        </div>
      ))}
    </div>
  );
}

/** "See all" for one shelf of Home. */
export function SectionPage() {
  const key = route.value.parts[0] || '';
  const langs = settings.value.languages;
  const q = useQuery(homeKey(langs), (signal) => getHome(langs, signal), { persist: true });
  const sec: HomeSection | undefined = q.data?.find((x) => x.key === key);
  return (
    <div class="page page-in">
      <TopBar title={sec?.title} threshold={70} />
      <header class="page-head"><h1 class="title">{sec?.title || 'Browse'}</h1></header>
      <div style={{ marginTop: 16 }}>
        {q.loading && <SkeletonShelf />}
        {q.error && !q.data && <Failed error={q.error} retry={q.reload} />}
        {sec && <ItemGrid items={sec.items} />}
      </div>
    </div>
  );
}
