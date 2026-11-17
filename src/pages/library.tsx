// Library: liked songs, your playlists, history, and things you saved or follow.

import { useState } from 'preact/hooks';
import {
  ArrowDownToLine, ChartNoAxesColumn, Clock, Download, Heart, History as HistoryIcon, Link2, ListEnd, ListMusic, Pencil, Plus, Search as SearchIcon, Share2, Trash2, X,
} from 'lucide-preact';
import type { LocalPlaylist, Track } from '../lib/types';
import {
  clearHistory, createPlaylist, deletePlaylist, following, history, hydrated, liked, playlists, renamePlaylist,
  restorePlaylist, saved, shows,
} from '../lib/library';
import { isApp } from '../lib/native';
import * as offline from '../lib/offline';
import * as player from '../lib/player';
import { back, go, route, to } from '../lib/router';
import { toast } from '../lib/toast';
import { ago, cx, img, isIOS, isStandalone, longTime, plain, plural } from '../lib/util';
import { Art, Empty, Link, SkeletonRows, TopBar } from '../ui/bits';
import { ItemShelf, Section } from '../ui/cards';
import { TrackList, TrackRow } from '../ui/rows';
import { openConfirm, openPrompt } from '../ui/sheet';
import { openSheet } from '../ui/state';
import { shareLink } from '../ui/actions';
import { ListActions } from './collection';

/** Cover for a personal playlist: a 2×2 of its first four different covers. */
export function Mosaic(props: { tracks: Track[]; class?: string; size?: 150 | 500 }) {
  const seen = new Set<string>();
  const pics: string[] = [];
  for (const t of props.tracks) {
    if (t.image && !seen.has(t.image)) { seen.add(t.image); pics.push(t.image); }
    if (pics.length === 4) break;
  }
  if (pics.length < 4) return <Art src={pics[0]} class={props.class} size={props.size ?? 150} />;
  return (
    <span class={cx('art mosaic', props.class)}>
      {pics.map((p) => {
        const remote = img(p, 150);
        const kept = offline.offlineArt(remote);
        return <img key={p} src={kept && !offline.online.value ? kept : remote} alt="" loading="lazy" decoding="async" draggable={false} />;
      })}
    </span>
  );
}

function newPlaylist(): void {
  openPrompt({
    title: 'New playlist',
    placeholder: 'Give it a name',
    action: 'Create',
    onSubmit: (name) => { const pl = createPlaylist(name); go(to.localPlaylist(pl.id)); },
  });
}

export function Library() {
  const lists = playlists.value;
  const likes = liked.value.length;
  const empty = !lists.length && !saved.value.length && !following.value.length && !shows.value.length;
  return (
    <div class="page page-in">
      <header class="page-head"><h1 class="display">Library</h1></header>

      <div class="lib-tiles" style={{ marginTop: 14 }}>
        <Link to={to.library('liked')} class="lib-tile">
          <Heart size={24} />
          <div><b>Liked songs</b><span>{plural(likes, 'song')}</span></div>
        </Link>
        {offline.supported && (
          <Link to={to.library('downloads')} class="lib-tile">
            <ArrowDownToLine size={24} />
            <div><b>Downloads</b><span>{offline.downloads.value.length ? `${plural(offline.downloads.value.length, 'song')} · ${offline.megabytes(offline.totalBytes.value)}` : 'Play without internet'}</span></div>
          </Link>
        )}
        <Link to={to.library('history')} class="lib-tile">
          <HistoryIcon size={24} />
          <div><b>History</b><span>What you played</span></div>
        </Link>
        <button class="lib-tile" onClick={newPlaylist}>
          <Plus size={24} />
          <div><b>New playlist</b><span>Start a collection</span></div>
        </button>
        <Link to={to.importer()} class="lib-tile">
          <Download size={24} />
          <div><b>Import</b><span>From YouTube Music</span></div>
        </Link>
        <Link to={to.stats()} class="lib-tile">
          <ChartNoAxesColumn size={24} />
          <div><b>Your listening</b><span>Your week and top songs</span></div>
        </Link>
      </div>

      {lists.length > 0 && (
        <Section title="Your playlists">
          <div class="rows">
            {lists.map((p) => (
              <Link key={p.id} to={to.localPlaylist(p.id)} class="row">
                <Mosaic tracks={p.tracks} />
                <div class="row-text">
                  <div class="row-title clip">{p.name}</div>
                  <div class="row-sub clip">{plural(p.tracks.length, 'song')}</div>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}
      {saved.value.length > 0 && <Section title="Saved albums and playlists"><ItemShelf items={saved.value} /></Section>}
      {following.value.length > 0 && <Section title="Artists you follow"><ItemShelf items={following.value} small /></Section>}
      {shows.value.length > 0 && <Section title="Podcasts you follow"><ItemShelf items={shows.value} small /></Section>}

      {empty && hydrated.value && (
        <Empty icon={<ListMusic size={26} strokeWidth={1.6} />} title="Your library starts here" text="Like a song, save an album or follow an artist, and you'll find it here." />
      )}
    </div>
  );
}

export function LikedPage() {
  const all = liked.value;
  const [filter, setFilter] = useState('');
  const f = plain(filter);
  const list = f ? all.filter((t) => plain(t.title + ' ' + t.artist + ' ' + (t.album || '')).includes(f)) : all;
  return (
    <div class="page page-narrow page-in">
      <TopBar title="Liked songs" threshold={110} />
      <header class="page-head">
        <h1 class="display">Liked songs</h1>
        <p class="muted">{plural(all.length, 'song')}{all.length ? ' · ' + longTime(all.reduce((s, t) => s + (t.duration || 0), 0)) : ''}</p>
        {all.length > 0 && <div style={{ marginTop: 2 }}><ListActions tracks={list} from="Liked songs" /></div>}
      </header>
      {!hydrated.value && <SkeletonRows />}
      {hydrated.value && !all.length && (
        <Empty icon={<Heart size={26} strokeWidth={1.6} />} title="No liked songs yet" text="Tap the heart on any song and it will be kept here.">
          <Link to={to.search()} class="btn quiet"><SearchIcon size={17} /> Find music</Link>
        </Empty>
      )}
      {all.length > 12 && (
        <div class="search-box" style={{ margin: '18px 0 8px', height: 44 }}>
          <SearchIcon size={18} />
          <input type="search" value={filter} placeholder="Find in liked songs" aria-label="Find in liked songs" autocomplete="off" spellcheck={false}
            onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
          {filter && <button class="icon-btn sm" aria-label="Clear" onClick={() => setFilter('')}><X size={17} /></button>}
        </div>
      )}
      {all.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {list.length ? <TrackList tracks={list} from="Liked songs" /> : <Empty title="No match" text={`Nothing in your liked songs matches “${filter}”.`} />}
        </div>
      )}
    </div>
  );
}

export function DownloadsPage() {
  const list = offline.downloads.value;
  const tracks = list.map((d) => d.t);
  const total = offline.totalBytes.value;
  const busy = offline.busyCount.value;
  const parts = Object.values(offline.percent.value);
  const clear = () => openConfirm({
    title: 'Remove all downloads?',
    text: `This frees ${offline.megabytes(total)} on this device. Your liked songs and playlists stay, and everything still plays when you are online.`,
    action: 'Remove all',
    danger: true,
    onConfirm: () => { void offline.removeAll(); toast('All downloads removed'); },
  });
  return (
    <div class="page page-narrow page-in">
      <TopBar title="Downloads" threshold={110}>
        {list.length > 0 && <button class="btn quiet small" onClick={clear}>Remove all</button>}
      </TopBar>
      <header class="page-head">
        <h1 class="display">Downloads</h1>
        <p class="muted">{list.length ? `${plural(list.length, 'song')} · ${offline.megabytes(total)} on this device` : 'Songs you download play without internet.'}</p>
        {list.length > 0 && <div style={{ marginTop: 2 }}><ListActions tracks={tracks} from="Downloads" noDownload /></div>}
      </header>

      {busy > 0 && (
        <div class="set-card dl-card">
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{offline.online.value ? `Downloading ${plural(busy, 'song')}` : `${plural(busy, 'song')} waiting for internet`}</b>
            <div class="meter" style={{ marginTop: 10 }}><i style={{ transform: `scaleX(${parts.length ? Math.max(0.03, parts.reduce((a, b) => a + b, 0) / parts.length) : 0.03})` }} /></div>
          </div>
          <button class="btn quiet small" onClick={() => { offline.stopAll(); toast('Stopped'); }}>Stop</button>
        </div>
      )}

      {!offline.supported && (
        <Empty icon={<ArrowDownToLine size={26} strokeWidth={1.6} />} title="Downloads aren't available here" text="This browser window doesn't allow files to be kept (private windows often don't). Open Music Flow in a normal window." />
      )}
      {offline.supported && offline.ready.value && !list.length && !busy && (
        <Empty icon={<ArrowDownToLine size={26} strokeWidth={1.6} />} title="Nothing downloaded yet" text="Open an album, a playlist or your liked songs and tap the download arrow. For one song, use its ⋯ menu.">
          <Link to={to.library('liked')} class="btn quiet"><Heart size={17} /> Liked songs</Link>
        </Empty>
      )}
      <div class="rows" style={{ marginTop: 14 }}>
        {list.map((d, i) => (
          <TrackRow key={d.t.id} track={d.t} list={tracks} index={i} from="Downloads" sub={`${offline.megabytes(d.size)} · ${d.t.artist}`} />
        ))}
      </div>
      {list.length > 0 && isIOS && !isStandalone && !isApp && (
        <p class="small faint" style={{ padding: '16px 4px 0' }}>
          On iPhone, add Music Flow to your Home Screen (Share, then Add to Home Screen). Safari may clear the downloads of a website that hasn't been opened for a week; on the Home Screen they are kept.
        </p>
      )}
    </div>
  );
}

export function HistoryPage() {
  const plays = history.value;
  const tracks = plays.map((p) => p.t);
  const clear = () => openConfirm({
    title: 'Clear history?',
    text: 'This forgets what you have played on this device. Liked songs and playlists stay.',
    action: 'Clear history',
    danger: true,
    onConfirm: () => { clearHistory(); toast('History cleared'); },
  });
  return (
    <div class="page page-narrow page-in">
      <TopBar title="History" threshold={90}>
        {plays.length > 0 && <button class="btn quiet small" onClick={clear}>Clear</button>}
      </TopBar>
      <header class="page-head">
        <h1 class="display">History</h1>
        <p class="muted">Kept only on this device.</p>
      </header>
      {!hydrated.value && <SkeletonRows />}
      {hydrated.value && !plays.length && (
        <Empty icon={<Clock size={26} strokeWidth={1.6} />} title="Nothing played yet" text="Songs and episodes you play will be listed here." />
      )}
      <div class="rows" style={{ marginTop: 14 }}>
        {plays.map((p, i) => (
          <TrackRow key={p.t.id} track={p.t} list={tracks} index={i} from="History" sub={`${p.t.artist} · ${ago(p.at)}`} />
        ))}
      </div>
    </div>
  );
}

function openPlaylistMenu(p: LocalPlaylist): void {
  openSheet((close) => {
    const act = (fn: () => void) => () => { close(); fn(); };
    return (
      <>
        <div class="sheet-title clip">{p.name}</div>
        <div class="sheet-body">
          <button class="menu-item" onClick={() => openPrompt({ title: 'Rename playlist', initial: p.name, action: 'Save', onSubmit: (name) => renamePlaylist(p.id, name) })}>
            <Pencil size={20} /><span>Rename</span>
          </button>
          <button class="menu-item" disabled={!p.tracks.length} onClick={act(() => { const n = player.addToQueue(p.tracks); toast(n ? `Added ${plural(n, 'song')} to the queue` : 'Already in the queue'); })}>
            <ListEnd size={20} /><span>Add to queue</span>
          </button>
          <button class="menu-item" disabled={!p.tracks.length} onClick={act(() => {
            const text = `${p.name}\n\n` + p.tracks.map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`).join('\n');
            if (navigator.share) void navigator.share({ title: p.name, text }).catch(() => { /* cancelled */ });
            else void navigator.clipboard.writeText(text).then(() => toast('Song list copied'), () => toast("Couldn't copy from this browser."));
          })}>
            <Share2 size={20} /><span>Share song list</span>
          </button>
          <button class="menu-item" disabled={!p.tracks.some((t) => t.kind === 'song')} onClick={act(() => {
            const ids = p.tracks.filter((t) => t.kind === 'song').map((t) => t.id);
            if (ids.length > 150) toast('Only the first 150 songs fit in a link.');
            void shareLink(p.name, to.shared(p.name, ids.slice(0, 150)));
          })}>
            <Link2 size={20} /><span>Share as a link</span><span class="menu-end">Opens in Music Flow</span>
          </button>
          <div class="menu-sep" />
          <button class="menu-item danger" onClick={act(() => {
            const gone = deletePlaylist(p.id);
            back();
            if (gone) toast(`Deleted ${gone.name}`, { label: 'Undo', run: () => restorePlaylist(gone) });
          })}>
            <Trash2 size={20} /><span>Delete playlist</span>
          </button>
        </div>
      </>
    );
  });
}

export function LocalPlaylistPage() {
  const id = route.value.parts[1] || '';
  const p = playlists.value.find((x) => x.id === id);
  if (!hydrated.value) return <div class="page page-narrow"><TopBar /><SkeletonRows /></div>;
  if (!p) {
    return (
      <div class="page page-narrow page-in">
        <TopBar />
        <Empty title="Playlist not found" text="It may have been deleted."><Link to={to.library()} class="btn quiet">Back to Library</Link></Empty>
      </div>
    );
  }
  const seconds = p.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  return (
    <div class="page page-narrow page-in">
      <TopBar title={p.name} threshold={260} />
      <div class="hero">
        <Mosaic tracks={p.tracks} size={500} />
        <div class="hero-text">
          <div class="label">Your playlist</div>
          <h1 class="title" style={{ marginTop: 6 }}>{p.name}</h1>
          <div class="hero-meta faint">{[plural(p.tracks.length, 'song'), seconds ? longTime(seconds) : ''].filter(Boolean).join(' · ')}</div>
          <ListActions tracks={p.tracks} from={p.name} onMore={() => openPlaylistMenu(p)} />
        </div>
      </div>
      <div style={{ marginTop: 26 }}>
        {p.tracks.length ? (
          <TrackList tracks={p.tracks} from={p.name} playlistId={p.id} />
        ) : (
          <Empty icon={<ListMusic size={26} strokeWidth={1.6} />} title="Nothing here yet" text="On any song, open the ⋯ menu and choose “Add to playlist”.">
            <Link to={to.search()} class="btn quiet"><SearchIcon size={17} /> Find songs</Link>
          </Empty>
        )}
      </div>
    </div>
  );
}
