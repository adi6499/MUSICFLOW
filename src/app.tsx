// The frame around every screen: navigation, the player, and the pieces that
// slide over the page.

import { computed, effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { Home as HomeIcon, Library as LibraryIcon, Mic, Plus, Search as SearchIcon, Settings as Cog } from 'lucide-preact';
import { playlists, settings, createPlaylist } from './lib/library';
import { setTheme } from './lib/native';
import * as player from './lib/player';
import { cssVars, paletteFor } from './lib/themes';
import { go, isOpen, route, to } from './lib/router';
import { dismiss, toasts } from './lib/toast';
import { cx } from './lib/util';
import { AlbumPage, PlaylistPage } from './pages/collection';
import { ArtistPage } from './pages/artist';
import { Home, SectionPage } from './pages/home';
import { Importer } from './pages/importer';
import { HistoryPage, Library, LikedPage, LocalPlaylistPage } from './pages/library';
import { Podcasts, ShowPage } from './pages/podcasts';
import { Search } from './pages/search';
import { SettingsPage } from './pages/settings';
import { Bar, Mini } from './player/dock';
import { NowPlaying } from './player/nowplaying';
import { Empty, Link } from './ui/bits';
import { canGlass, useLens } from './ui/glass';
import { openPrompt, SheetHost } from './ui/sheet';
import { isWide, themeNow } from './ui/state';

type Tab = 'home' | 'search' | 'library' | 'podcasts';
let lastTab: Tab = 'home';

/** Which tab a screen belongs to. Albums, artists and playlists stay under the tab you came from. */
function tabFor(name: string): Tab {
  if (name === '' || name === 'section') lastTab = 'home';
  else if (name === 'search') lastTab = 'search';
  else if (name === 'library' || name === 'import') lastTab = 'library';
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
  useLens(ref, 30);
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
      break;
    case 'album': return <AlbumPage />;
    case 'playlist': return <PlaylistPage />;
    case 'artist': return <ArtistPage />;
    case 'section': return <SectionPage />;
    case 'podcasts': return <Podcasts />;
    case 'show': return <ShowPage />;
    case 'settings': return <SettingsPage />;
    case 'import': return <Importer />;
  }
  return (
    <div class="page page-in">
      <Empty title="This page doesn't exist" text="The link may be old or mistyped.">
        <Link to={to.home()} class="btn quiet">Go to Home</Link>
      </Empty>
    </div>
  );
}

export function App() {
  const r = route.value;
  const wide = isWide.value;
  const has = !!player.current.value;
  const active = tabFor(r.name);

  useEffect(() => {
    document.documentElement.classList.toggle('has-player', has);
  }, [has]);

  return (
    <div class="app">
      {wide && <Side active={active} />}
      <main class="main">
        {/* The key makes each screen start fresh; the search text is not part of it, so typing never resets the box. */}
        <Screen key={r.name + '/' + r.parts.join('/')} />
      </main>
      {has && (wide ? <Bar /> : <Mini />)}
      {!wide && <Tabs active={active} />}
      <NowPlaying />
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

  effect(() => {
    if (settings.value.glass && canGlass) root.dataset.glass = '1';
    else delete root.dataset.glass;
  });

  effect(() => {
    if (settings.value.calmMotion) root.dataset.calm = '1';
    else delete root.dataset.calm;
  });

  // The browser tab shows what is playing.
  effect(() => {
    const t = player.current.value;
    document.title = t && player.playing.value ? `${t.title} · ${t.artist}` : 'Sukoon';
  });

  // Keyboard: Space plays/pauses, Shift+arrows change song, "/" jumps to search.
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'switch')) return;
      if (!player.current.value) return;
      e.preventDefault();
      player.toggle();
    } else if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); void player.next(); }
    else if (e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); player.prev(); }
    else if (e.key === '/' && !isOpen('sheet')) {
      e.preventDefault();
      go(to.search());
      setTimeout(() => document.querySelector<HTMLInputElement>('.search-box input')?.focus(), 80);
    }
  });
}
