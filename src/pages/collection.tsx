// An album or a catalog playlist: cover, a few actions, and the songs.

import { ArrowDownToLine, CircleCheck, Ellipsis, Heart, ListEnd, ListPlus, ListStart, Play, Share2, Shuffle } from 'lucide-preact';
import type { Album, Playlist, Track } from '../lib/types';
import { getAlbum, getPlaylist, keys } from '../lib/api';
import { isSaved, toggleSaved } from '../lib/library';
import * as offline from '../lib/offline';
import * as player from '../lib/player';
import { route, to } from '../lib/router';
import { toast } from '../lib/toast';
import { buzz } from '../lib/haptics';
import { cx, firstArtist, longTime, plural } from '../lib/util';
import { share, startDownload } from '../ui/actions';
import { Art, Empty, Failed, Link, SkeletonHero, SkeletonRows, Spinner, TopBar } from '../ui/bits';
import { useQuery } from '../ui/hooks';
import { TrackList } from '../ui/rows';
import { openAddToPlaylist, openConfirm } from '../ui/sheet';
import { openSheet } from '../ui/state';

function total(tracks: Track[]): string {
  const seconds = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  return seconds ? longTime(seconds) : '';
}

/** One button for a whole list: download it, see that it is on its way, or (once it is all here) remove it. */
function DownloadButton(props: { tracks: Track[] }) {
  if (!offline.supported) return null;
  const songs = props.tracks.filter((t) => t.kind === 'song');
  if (!songs.length) return null;
  const have = songs.filter((t) => offline.isDownloaded(t.id)).length;
  const moving = offline.active.value;
  const coming = songs.some((t) => t.id in moving);
  const all = have === songs.length;
  const tap = () => {
    if (coming) { toast(`Downloading: ${have} of ${songs.length} done.`); return; }
    if (!all) { startDownload(songs); return; }
    openConfirm({
      title: songs.length === 1 ? 'Remove this download?' : `Remove these ${songs.length} downloads?`,
      text: 'They stay in your library and still play when you are online.',
      action: 'Remove',
      danger: true,
      onConfirm: () => { void offline.remove(songs.map((t) => t.id)); toast('Removed from this device'); },
    });
  };
  return (
    <button class={cx('icon-btn dl-btn', all && 'on')} onClick={tap} aria-label={all ? 'Downloaded. Tap to remove from this device.' : coming ? 'Downloading' : 'Download to play without internet'}>
      {coming ? <Spinner size={21} /> : all ? <CircleCheck size={22} /> : <ArrowDownToLine size={22} />}
    </button>
  );
}

/** Play / Shuffle / save / more — shared by albums, playlists and the person's own lists. */
export function ListActions(props: {
  tracks: Track[];
  from: string;
  saved?: boolean;
  onSave?: () => void;
  onMore?: () => void;
  /** Leave out the download button (the Downloads screen itself). */
  noDownload?: boolean;
}) {
  const none = !props.tracks.length;
  return (
    <div class="hero-actions">
      <button class="btn" disabled={none} onClick={() => { buzz('tap'); player.shuffle.value = false; player.playTracks(props.tracks, 0, props.from); }}>
        <Play size={18} fill="currentColor" /> Play
      </button>
      <button class="btn quiet" disabled={none} onClick={() => { buzz('tap'); player.playShuffled(props.tracks, props.from); }}>
        <Shuffle size={18} /> Shuffle
      </button>
      {/* The small buttons stay together: on a narrow phone they drop to a row of their own instead of one straggler. */}
      <div class="hero-icons">
        {!props.noDownload && <DownloadButton tracks={props.tracks} />}
        {props.onSave && (
          <button class={cx('icon-btn heart', props.saved && 'on')} onClick={props.onSave} aria-label={props.saved ? 'Remove from library' : 'Save to library'} aria-pressed={props.saved}>
            <Heart size={22} />
          </button>
        )}
        {props.onMore && <button class="icon-btn" onClick={props.onMore} aria-label="More options"><Ellipsis size={22} /></button>}
      </div>
    </div>
  );
}

export function openListMenu(title: string, tracks: Track[], sharePath?: string): void {
  openSheet((close) => {
    const act = (fn: () => void) => () => { close(); fn(); };
    return (
      <>
        <div class="sheet-title clip">{title}</div>
        <div class="sheet-body">
          <button class="menu-item" onClick={act(() => { for (const t of tracks.slice().reverse()) player.playNext(t); toast('Playing next'); })}>
            <ListStart size={20} /><span>Play next</span>
          </button>
          <button class="menu-item" onClick={act(() => { const n = player.addToQueue(tracks); toast(n ? `Added ${plural(n, 'song')} to the queue` : 'Already in the queue'); })}>
            <ListEnd size={20} /><span>Add to queue</span>
          </button>
          <button class="menu-item" onClick={() => openAddToPlaylist(tracks)}>
            <ListPlus size={20} /><span>Add all to a playlist</span>
          </button>
          {sharePath && (
            <button class="menu-item" onClick={act(() => void share(title, sharePath))}>
              <Share2 size={20} /><span>Share</span>
            </button>
          )}
        </div>
      </>
    );
  });
}

export function AlbumPage() {
  const id = route.value.parts[0] || '';
  const q = useQuery<Album>(id ? keys.album(id) : null, (signal) => getAlbum(id, signal), { ttl: 6 * 60 * 60 * 1000 });
  const a = q.data;
  const saved = a ? isSaved(a) : false;
  const save = () => {
    if (!a) return;
    const now = toggleSaved({ type: 'album', id: a.id, title: a.title, artist: a.artist, image: a.image, year: a.year, songCount: a.songCount });
    buzz(now ? 'like' : 'tap');
    toast(now ? 'Saved to your library' : 'Removed from your library');
  };
  const lead = a ? firstArtist(a.artist) : '';
  const meta = a ? [a.year, plural(a.songs.length, 'song'), total(a.songs)].filter(Boolean).join(' · ') : '';
  return (
    <div class="page page-narrow page-in">
      <TopBar title={a?.title} threshold={260} />
      {q.loading && (<><SkeletonHero /><div style={{ marginTop: 28 }}><SkeletonRows count={8} /></div></>)}
      {q.error && !a && <Failed error={q.error} retry={q.reload} />}
      {a && (
        <>
          <div class="hero">
            <Art src={a.image} size={500} eager />
            <div class="hero-text">
              <div class="label">Album</div>
              <h1 class="title" style={{ marginTop: 6 }}>{a.title}</h1>
              <div class="hero-meta">
                {lead ? <Link to={to.artistNamed(lead)} class="muted">{a.artist}</Link> : a.artist}
              </div>
              <div class="hero-meta faint" style={{ marginTop: 3 }}>{meta}</div>
              <ListActions tracks={a.songs} from={a.title} saved={saved} onSave={save} onMore={() => openListMenu(a.title, a.songs, to.album(a.id))} />
            </div>
          </div>
          <div style={{ marginTop: 26 }}>
            {a.songs.length ? <TrackList tracks={a.songs} from={a.title} numbered /> : <Empty title="No songs here" text="This album has no playable songs right now." />}
          </div>
        </>
      )}
    </div>
  );
}

export function PlaylistPage() {
  const id = route.value.parts[0] || '';
  const q = useQuery<Playlist>(id ? keys.playlist(id) : null, (signal) => getPlaylist(id, signal), { ttl: 60 * 60 * 1000 });
  const p = q.data;
  const saved = p ? isSaved(p) : false;
  const save = () => {
    if (!p) return;
    const now = toggleSaved({ type: 'playlist', id: p.id, title: p.title, subtitle: p.subtitle, image: p.image, songCount: p.songCount });
    buzz(now ? 'like' : 'tap');
    toast(now ? 'Saved to your library' : 'Removed from your library');
  };
  const meta = p ? [plural(p.songs.length, 'song'), total(p.songs)].filter(Boolean).join(' · ') : '';
  return (
    <div class="page page-narrow page-in">
      <TopBar title={p?.title} threshold={260} />
      {q.loading && (<><SkeletonHero /><div style={{ marginTop: 28 }}><SkeletonRows count={8} /></div></>)}
      {q.error && !p && <Failed error={q.error} retry={q.reload} />}
      {p && (
        <>
          <div class="hero">
            <Art src={p.image} size={500} eager />
            <div class="hero-text">
              <div class="label">Playlist</div>
              <h1 class="title" style={{ marginTop: 6 }}>{p.title}</h1>
              <div class="hero-meta faint">{meta}</div>
              <ListActions tracks={p.songs} from={p.title} saved={saved} onSave={save} onMore={() => openListMenu(p.title, p.songs, to.playlist(p.id))} />
            </div>
          </div>
          <div style={{ marginTop: 26 }}>
            {p.songs.length ? <TrackList tracks={p.songs} from={p.title} /> : <Empty title="No songs here" text="This playlist has no playable songs right now." />}
          </div>
        </>
      )}
    </div>
  );
}
