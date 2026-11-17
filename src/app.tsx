// The frame around every screen: navigation, the player, and the pieces that
// slide over the page.

import { computed, effect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { Home as HomeIcon, Library as LibraryIcon, Mic, Plus, Search as SearchIcon, Settings as Cog, WifiOff } from 'lucide-preact';
import { playlists, settings, createPlaylist } from './lib/library';
import { setTheme } from './lib/native';
import * as offline from './lib/offline';
import { perfLevel } from './lib/perf';
import * as player from './lib/player';
import { cssVars, paletteFor } from './lib/themes';
import { back, canGoBack, go, isOpen, route, to } from './lib/router';
import { dismiss, toasts } from './lib/toast';
import { cx, isIOS, isStandalone } from './lib/util';
import { AlbumPage, PlaylistPage } from './pages/collection';
import { ArtistPage } from './pages/artist';
import { Home, SectionPage } from './pages/home';
import { GetAppPage } from './pages/getapp';
import { Importer } from './pages/importer';
import { MixPage } from './pages/mixes';
import { SharedPage } from './pages/shared';
import { StatsPage } from './pages/stats';
import { DownloadsPage, HistoryPage, Library, LikedPage, LocalPlaylistPage } from './pages/library';
import { Podcasts, ShowPage } from './pages/podcasts';
import { Search } from './pages/search';
import { SettingsPage } from './pages/settings';
import { Bar, Mini } from './player/dock';
import { Karaoke } from './player/karaoke';
import { NowPlaying } from './player/nowplaying';
import { Empty, Link } from './ui/bits';
import { canGlass, useLens } from './ui/glass';
import { like } from './ui/actions';
import { openPrompt, openShortcuts, SheetHost } from './ui/sheet';
import { closePlayer, isWide, npPanel, openPlayer, themeNow } from './ui/state';
import { toast } from './lib/toast';

type Tab = 'home' | 'search' | 'library' | 'podcasts';
let lastTab: Tab = 'home';

/** Which tab a screen belongs to. Albums, artists and playlists stay under the tab you came from. */
function tabFor(name: string): Tab {
  if (name === '' || name === 'section' || name === 'mix') lastTab = 'home';
  else if (name === 'search') lastTab = 'search';
  else if (name === 'library' || name === 'import' || name === 'stats' || name === 'shared') lastTab = 'library';
  else if (name === 'podcasts' || name === 'show') lastTab = 'podcasts';
  return lastTab;
}

const TABS: Array<{ tab: Tab; path: string; label: string; icon: typeof HomeIcon }> = [
  { tab: 'home', path: to.home(), label: 'Home', icon: HomeIcon },
  { tab: 'search', path: to.search(), label: 'Search', icon: SearchIcon },
  { tab: 'library', path: to.library(), label: 'Library', icon: LibraryIcon },
  { tab: 'podcasts', path: to.podcasts(), label: 'Podcasts', icon: Mic },
];

function Tabs(props: { active: Tab }) {
  const ref = useRef<HTMLElement>(null);
  useLens(ref, 'pill');
  return (
    <nav ref={ref} class="tabs" aria-label="Main">
      {TABS.map(({ tab, path, label, icon: Icon }) => (
        <Link key={tab} to={path} class={cx('tab', props.active === tab && 'on')}>
          <span class="tab-ico"><Icon size={21} strokeWidth={props.active === tab ? 2.3 : 1.9} /></span>
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Side(props: { active: Tab }) {
  const r = route.value;
  const onPlaylist = r.name === 'library' && r.parts[0] === 'playlist' ? r.parts[1] : '';
  const fresh = () => openPrompt({
    title: 'New playlist',
    placeholder: 'Give it a name',
    action: 'Create',
    onSubmit: (name) => { const pl = createPlaylist(name); go(to.localPlaylist(pl.id)); },
  });
  return (
    <aside class="side">
      <Link to={to.home()} class="brand">Sukoon</Link>
      <nav class="side-list" aria-label="Main">
        {TABS.map(({ tab, path, label, icon: Icon }) => (
          <Link key={tab} to={path} class={cx('side-link', props.active === tab && r.name !== 'settings' && !onPlaylist && 'on')}>
            <Icon size={19} /> {label}
          </Link>
        ))}
        <Link to={to.settings()} class={cx('side-link', r.name === 'settings' && 'on')}><Cog size={19} /> Settings</Link>
      </nav>
      <div class="side-label label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Playlists
        <button class="icon-btn sm" style={{ margin: '-8px -6px' }} onClick={fresh} aria-label="New playlist"><Plus size={17} /></button>
      </div>
      <div class="side-list">
        <Link to={to.library('liked')} class={cx('side-pl clip', r.name === 'library' && r.parts[0] === 'liked' && 'on')}>Liked songs</Link>
        {playlists.value.map((p) => (
          <Link key={p.id} to={to.localPlaylist(p.id)} class={cx('side-pl clip', onPlaylist === p.id && 'on')}>{p.name}</Link>
        ))}
      </div>
    </aside>
  );
}

function Toasts() {
  const list = toasts.value;
  return (
    <div class={cx('toasts', isOpen('player') && 'over-player')} role="status" aria-live="polite">
      {list.map((t) => (
        <div class="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

function Screen() {
  const r = route.value;
  switch (r.name) {
    case '': return <Home />;
    case 'search': return <Search />;
    case 'library':
      if (!r.parts[0]) return <Library />;
      if (r.parts[0] === 'liked') return <LikedPage />;
      if (r.parts[0] === 'history') return <HistoryPage />;
      if (r.parts[0] === 'playlist') return <LocalPlaylistPage />;
      if (r.parts[0] === 'downloads') return <DownloadsPage />;
      break;
    case 'album': return <AlbumPage />;
    case 'playlist': return <PlaylistPage />;
    case 'artist': return <ArtistPage />;
    case 'section': return <SectionPage />;
    case 'podcasts': return <Podcasts />;
    case 'show': return <ShowPage />;
    case 'settings': return <SettingsPage />;
    case 'import': return <Importer />;
    case 'mix': return <MixPage />;
    case 'stats': return <StatsPage />;
    case 'app': return <GetAppPage />;
    case 'shared': return <SharedPage />;
  }
  return (
    <div class="page page-in">
      <Empty title="This page doesn't exist" text="The link may be old or mistyped.">
        <Link to={to.home()} class="btn quiet">Go to Home</Link>
      </Empty>
    </div>
  );
}

// The frame is split into small parts on purpose. Each part redraws only when
// the one thing it shows changes. Before, the whole frame redrew whenever the
// song changed, which meant re-checking every card on the screen for nothing
// and a visible hitch at each song change.

/** Sidebar on wide screens, tab bar on phones. Redraws when the screen or the width changes. */
function Chrome() {
  const active = tabFor(route.value.name);
  return isWide.value ? <Side active={active} /> : <Tabs active={active} />;
}

/** A thin strip across the top while there is no internet. */
function OfflineBar() {
  if (offline.online.value) return null;
  const n = offline.downloads.value.length;
  const there = route.value.name === 'library' && route.value.parts[0] === 'downloads';
  return (
    <div class="offline-bar" role="status">
      <WifiOff size={14} />
      <span>{n ? 'No internet. Your downloads still play.' : 'No internet.'}</span>
      {n > 0 && !there && <Link to={to.library('downloads')}>Open</Link>}
    </div>
  );
}

/** The current screen. Redraws only when the address changes. */
function Main() {
  const r = route.value;
  return (
    <main class="main">
      <OfflineBar />
      {/* The key makes each screen start fresh; the search text is not part of it, so typing never resets the box. */}
      <Screen key={r.name + '/' + r.parts.join('/')} />
    </main>
  );
}

const hasPlayer = computed(() => !!player.current.value);

/** Mini player or desktop bar. Appears once there is something to play. */
function Dock() {
  if (!hasPlayer.value) return null;
  return isWide.value ? <Bar /> : <Mini />;
}

export function App() {
  return (
    <div class="app">
      <Chrome />
      <Main />
      <Dock />
      <NowPlaying />
      <Karaoke />
      <SheetHost />
      <Toasts />
    </div>
  );
}

// ---------------------------------------------------------------- app-wide behaviour (runs once)

if (typeof window !== 'undefined') {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  // Only the three appearance choices matter here; other settings (volume
  // sliders and so on) must not trigger a repaint of every colour.
  const look = computed(() => {
    const s = settings.value;
    return `${s.theme}|${s.lightTheme}|${s.darkTheme}`;
  });
  const paint = () => {
    look.value;
    const s = settings.peek();
    const dark = s.theme === 'dark' || (s.theme === 'auto' && media.matches);
    const palette = paletteFor(dark ? s.darkTheme : s.lightTheme, dark ? 'dark' : 'light');
    root.dataset.theme = palette.kind;
    root.dataset.palette = palette.id;
    const vars = cssVars(palette);
    for (const name in vars) root.style.setProperty(name, vars[name]);
    themeNow.value = palette.kind;
    setTheme(dark, palette.bg);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.bg);
    // Remembered so the very first frame of the next start is already the right colour.
    try { localStorage.setItem('sukoon.paint', JSON.stringify({ dark, bg: palette.bg, ink: palette.ink })); } catch { /* optional */ }
  };
  effect(paint);
  media.addEventListener('change', paint);

  // Glass is drawn when it is switched on, the browser can do it, and this
  // device is keeping up (lib/perf.ts steps it down by itself if not).
  effect(() => {
    const level = perfLevel.value;
    // One number rules the glass: 0 solid … 100 clear (see styles/glass.css).
    const n = settings.value.glassLevel;
    root.style.setProperty('--g', String(n / 100));
    root.style.setProperty('--gp', n + '%');
    if (n >= 5 && canGlass && level < 2) {
      root.dataset.glass = '1';
      root.dataset.glassLevel = n < 55 ? 'frosted' : 'clear';
    } else {
      delete root.dataset.glass;
      delete root.dataset.glassLevel;
    }
    if (level) root.dataset.perf = String(level);
    else delete root.dataset.perf;
  });

  // Room is kept at the top of every screen for the "no internet" strip while it shows.
  effect(() => { root.classList.toggle('is-offline', !offline.online.value); });

  // Room is kept at the bottom of every screen once the player is showing.
  effect(() => { root.classList.toggle('has-player', hasPlayer.value); });

  effect(() => {
    if (settings.value.calmMotion) root.dataset.calm = '1';
    else delete root.dataset.calm;
  });

  // iPhone, opened from the Home Screen: there is no browser Back button and no
  // system swipe-back, so a swipe in from the left edge goes back (or closes
  // whatever is open). In Safari itself the browser already does this.
  if (isIOS && isStandalone) {
    let startX = 0;
    let startY = 0;
    let fromEdge = false;
    window.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      fromEdge = e.touches.length === 1 && t.clientX < 24;
      startX = t.clientX;
      startY = t.clientY;
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      if (!fromEdge) return;
      fromEdge = false;
      const t = e.changedTouches[0];
      if (t.clientX - startX > 70 && Math.abs(t.clientY - startY) < 60 && canGoBack()) back();
    }, { passive: true });
  }

  // The browser tab shows what is playing.
  effect(() => {
    const t = player.current.value;
    document.title = t && player.playing.value ? `${t.title} · ${t.artist}` : 'Sukoon';
  });

  // Keyboard. Space plays and pauses, the arrows move through the song (with
  // Shift: change song), and single letters do the things reached for most.
  // "?" shows the whole list. Nothing here fires while typing in a box.
  let unmuteTo = 0.8;
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const t = player.current.value;
    if (key === ' ' || e.code === 'Space') {
      if (el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'switch')) return;
      if (!t) return;
      e.preventDefault();
      player.toggle();
      return;
    }
    if (isOpen('sheet')) return;
    if (key === '/') {
      e.preventDefault();
      go(to.search());
      setTimeout(() => document.querySelector<HTMLInputElement>('.search-box input')?.focus(), 80);
      return;
    }
    if (key === '?') { e.preventDefault(); openShortcuts(); return; }
    if (!t) return;
    const big = isOpen('player') || isOpen('karaoke');
    const done = () => e.preventDefault();
    switch (key) {
      case 'ArrowRight': done(); if (e.shiftKey) void player.next(); else player.seekBy(5); break;
      case 'ArrowLeft': done(); if (e.shiftKey) player.prev(); else player.seekBy(-5); break;
      // Up and down scroll the page, so they only change the volume while the big player covers it.
      case 'ArrowUp': if (big) { done(); player.setVolume(player.volume.value + 0.05); } break;
      case 'ArrowDown': if (big) { done(); player.setVolume(player.volume.value - 0.05); } break;
      case 'n': done(); void player.next(); break;
      case 'p': done(); player.prev(); break;
      case 'm': {
        done();
        const v = player.volume.value;
        if (v > 0) { unmuteTo = v; player.setVolume(0); toast('Muted'); } else { player.setVolume(unmuteTo || 0.8); toast('Sound on'); }
        break;
      }
      case 'l': if (t.kind === 'song') { done(); like(t); } break;
      case 's': done(); player.toggleShuffle(); toast(player.shuffle.value ? 'Shuffle on' : 'Shuffle off'); break;
      case 'r': {
        done();
        player.cycleRepeat();
        const r = player.repeat.value;
        toast(r === 'one' ? 'Repeating this song' : r === 'all' ? 'Repeating everything' : 'Repeat off');
        break;
      }
      case 'q': done(); if (isOpen('player') && npPanel.value === 'queue') closePlayer(); else openPlayer('queue'); break;
      case 'f': done(); if (isOpen('player')) closePlayer(); else openPlayer(); break;
    }
  });
}
