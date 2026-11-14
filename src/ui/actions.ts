// Things a tap can do, shared by rows, cards, menus and the player.

import type { Item, Track } from '../lib/types';
import { getAlbum, getArtist, getPlaylist } from '../lib/api';
import { toggleLike } from '../lib/library';
import * as player from '../lib/player';
import { go, to } from '../lib/router';
import { MOODS, moodTracks, stationFrom, type Mood } from '../lib/station';
import { settings } from '../lib/library';
import { toast } from '../lib/toast';
import { firstArtist, tick } from '../lib/util';
import { isApp } from '../lib/native';

export function isTrack(item: Item): item is Track {
  return !('type' in item);
}

/** Start playing whatever this is. */
export async function playItem(item: Item): Promise<void> {
  try {
    if (isTrack(item)) { player.playTracks([item], 0, 'Song'); return; }
    if (item.type === 'album') {
      const album = await getAlbum(item.id);
      if (!album.songs.length) throw new Error('empty');
      player.playTracks(album.songs, 0, album.title);
    } else if (item.type === 'playlist') {
      const list = await getPlaylist(item.id);
      if (!list.songs.length) throw new Error('empty');
      player.playTracks(list.songs, 0, list.title);
    } else if (item.type === 'artist') {
      const artist = await getArtist(item.id);
      if (!artist.topSongs.length) throw new Error('empty');
      player.playTracks(artist.topSongs, 0, artist.name);
    } else {
      go(to.show(item.id));
    }
  } catch {
    toast("Couldn't start that. Please try again.");
  }
}

export function openItem(item: Item): void {
  if (isTrack(item)) { void playItem(item); return; }
  if (item.type === 'album') go(to.album(item.id));
  else if (item.type === 'playlist') go(to.playlist(item.id));
  else if (item.type === 'artist') go(to.artist(item.id));
  else go(to.show(item.id));
}

export function like(track: Track): void {
  const now = toggleLike(track);
  tick(now ? 12 : 6);
  toast(now ? 'Added to Liked songs' : 'Removed from Liked songs', now ? undefined : { label: 'Undo', run: () => { toggleLike(track); } });
}

export async function startRadio(track: Track): Promise<void> {
  toast(`Starting radio from “${track.title}”…`);
  try {
    const list = await stationFrom(track);
    player.playTracks(list, 0, `${track.title} radio`);
  } catch {
    player.playTracks([track], 0, 'Song');
  }
}

let moodBusy = '';
/** Start a mood. Returns false when one is already being prepared. */
export async function playMood(mood: Mood): Promise<boolean> {
  if (moodBusy) return false;
  moodBusy = mood.key;
  try {
    const tracks = await moodTracks(mood, settings.value.languages);
    if (!tracks.length) throw new Error('empty');
    player.playTracks(tracks, 0, mood.name);
    return true;
  } catch {
    toast("Couldn't start that mood. Please try again.");
    return true;
  } finally {
    moodBusy = '';
  }
}
export { MOODS };

export function goArtist(track: Track): void {
  const name = firstArtist(track.artist);
  if (name) go(to.artistNamed(name));
}

export function goAlbum(track: Track): void {
  if (track.kind === 'episode' && track.showId) go(to.show(track.showId));
  else if (track.albumId) go(to.album(track.albumId));
}

/** Share a link to a screen, using the phone's share sheet where there is one. */
export async function share(title: string, path: string): Promise<void> {
  // Inside the Android app the page address is internal, so share words only.
  const url = isApp ? '' : `${location.origin}${location.pathname}#${path}`;
  const data: ShareData = url ? { title, text: title, url } : { title, text: title };
  try {
    if (navigator.share) { await navigator.share(data); return; }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url || title);
    toast(url ? 'Link copied' : 'Copied');
  } catch {
    toast("Couldn't share from this browser.");
  }
}

export function shareTrack(track: Track): void {
  const title = `${track.title} — ${track.artist}`;
  if (track.kind === 'episode' && track.showId) void share(title, to.show(track.showId));
  else if (track.albumId) void share(title, to.album(track.albumId));
  else void share(title, to.search(`${track.title} ${firstArtist(track.artist)}`));
}
