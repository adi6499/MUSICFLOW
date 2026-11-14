// An artist: popular songs, albums, and a one-tap radio.

import { Play, Radio, UserCheck, UserPlus } from 'lucide-preact';
import type { Artist, ArtistRef, Track } from '../lib/types';
import { findArtist, getArtist, keys, searchSongs } from '../lib/api';
import { isFollowing, toggleFollow } from '../lib/library';
import * as player from '../lib/player';
import { route } from '../lib/router';
import { toast } from '../lib/toast';
import { cx, shuffled, tick } from '../lib/util';
import { Art, Empty, Failed, SkeletonHero, SkeletonRows, TopBar } from '../ui/bits';
import { ItemShelf, Section } from '../ui/cards';
import { useQuery } from '../ui/hooks';
import { TrackList } from '../ui/rows';

export function ArtistPage() {
  const raw = route.value.parts[0] || '';
  // "~Name" means we were sent here by name (from a song) and must look the artist up first.
  const byName = raw[0] === '~' ? raw.slice(1) : '';
  const found = useQuery<ArtistRef | null>(byName ? keys.artistByName(byName) : null, (signal) => findArtist(byName, signal), { ttl: 6 * 60 * 60 * 1000 });
  const id = byName ? found.data?.id || '' : raw;
  const q = useQuery<Artist>(id ? keys.artist(id) : null, (signal) => getArtist(id, signal), { ttl: 6 * 60 * 60 * 1000 });
  const a = q.data;
  const name = a?.name || byName;
  // The artist page lists only ten songs; search adds more by the same name.
  const more = useQuery<Track[]>(name ? keys.songs(name, 1, 30) : null, (signal) => searchSongs(name, 1, 30, signal));

  const loading = (byName && found.loading) || (!!id && q.loading);
  const missing = byName && !found.loading && !found.data && !found.error;
  const error = found.error || q.error;

  const top = a?.topSongs || [];
  const topIds = new Set(top.map((t) => t.id));
  const extra = (more.data || []).filter((t) => !topIds.has(t.id));
  const all = [...top, ...extra];
  const following = a ? isFollowing(a.id) : false;

  const follow = () => {
    if (!a) return;
    const now = toggleFollow(a);
    tick(now ? 12 : 6);
    toast(now ? `Following ${a.name}` : `Unfollowed ${a.name}`);
  };

  return (
    <div class="page page-narrow page-in">
      <TopBar title={name} threshold={240} />
      {loading && (<><SkeletonHero /><div style={{ marginTop: 28 }}><SkeletonRows count={6} /></div></>)}
      {!loading && error && !a && <Failed error={error} retry={() => { found.reload(); q.reload(); }} />}
      {missing && <Empty title="Artist not found" text={`We couldn't find a page for “${byName}”.`} />}
      {a && (
        <>
          <div class="hero">
            <Art src={a.image} size={500} round eager />
            <div class="hero-text">
              <div class="label">Artist</div>
              <h1 class="display" style={{ marginTop: 6 }}>{a.name}</h1>
              <div class="hero-actions">
                <button class="btn" disabled={!all.length} onClick={() => { tick(); player.shuffle.value = false; player.playTracks(all, 0, a.name); }}>
                  <Play size={18} fill="currentColor" /> Play
                </button>
                <button class="btn quiet" disabled={!all.length} onClick={() => { tick(); player.shuffle.value = false; player.playTracks(shuffled(all), 0, `${a.name} radio`); }}>
                  <Radio size={18} /> Radio
                </button>
                <button class={cx('btn outline', following && 'on')} onClick={follow} aria-pressed={following}>
                  {following ? <UserCheck size={18} /> : <UserPlus size={18} />} {following ? 'Following' : 'Follow'}
                </button>
              </div>
            </div>
          </div>

          {top.length > 0 && (
            <Section title="Popular">
              <TrackList tracks={all} from={a.name} limit={top.length} />
            </Section>
          )}
          {a.albums.length > 0 && (
            <Section title="Albums"><ItemShelf items={a.albums} /></Section>
          )}
          {extra.length > 0 && (
            <Section title="More songs">
              <div class="rows">
                <TrackList tracks={extra} from={a.name} />
              </div>
            </Section>
          )}
          {!top.length && !extra.length && !more.loading && <Empty title="Nothing to play yet" text="We couldn't find songs for this artist right now." />}
        </>
      )}
    </div>
  );
}
