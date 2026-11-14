// A song in a list.

import type { ComponentChildren } from 'preact';
import { Ellipsis, Heart } from 'lucide-preact';
import type { Track } from '../lib/types';
import { isLiked } from '../lib/library';
import * as player from '../lib/player';
import { clock, cx } from '../lib/util';
import { like } from './actions';
import { Art } from './bits';
import { openTrackMenu } from './sheet';

export function TrackRow(props: {
  track: Track;
  /** The list this row belongs to and its place in it: tapping plays the list from here. */
  list: Track[];
  index: number;
  /** Shown in the player as "Playing from …". */
  from?: string;
  /** Show a running number instead of artwork (albums). */
  numbered?: boolean;
  /** Second line override (e.g. "3 hr ago"). */
  sub?: ComponentChildren;
  playlistId?: string;
  /** Replace the default tap (used by the queue to jump). */
  onPlay?: () => void;
  queueIndex?: number;
}) {
  const t = props.track;
  const cur = player.current.value;
  const on = !!cur && cur.id === t.id && (props.queueIndex === undefined || props.queueIndex === player.index.value);
  const live = on && player.playing.value;
  const liked = isLiked(t.id);

  const tap = () => {
    if (props.onPlay) { props.onPlay(); return; }
    if (on) { player.toggle(); return; }
    player.playTracks(props.list, props.index, props.from);
  };
  const stop = (fn: () => void) => (e: Event) => { e.stopPropagation(); fn(); };

  return (
    <div
      class={cx('row', on && 'on')}
      role="button"
      tabIndex={0}
      onClick={tap}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tap(); } }}
      onContextMenu={(e) => { e.preventDefault(); openTrackMenu(t, { playlistId: props.playlistId, queueIndex: props.queueIndex }); }}
    >
      {props.numbered ? (
        <span class="row-num">{on ? <span class={cx('eqbars', live && 'live')} style={{ position: 'static', background: 'none', padding: 0, height: 16, alignItems: 'flex-end' }}><i style={{ background: 'var(--accent)' }} /><i style={{ background: 'var(--accent)' }} /><i style={{ background: 'var(--accent)' }} /></span> : props.index + 1}</span>
      ) : (
        <Art src={t.image}>{on && <span class={cx('eqbars', live && 'live')}><i /><i /><i /></span>}</Art>
      )}
      <div class="row-text">
        <div class="row-title clip">{t.title}</div>
        <div class="row-sub clip">
          {t.explicit && <span class="badge-e">E</span>}
          {props.sub ?? t.artist}
        </div>
      </div>
      {t.duration > 0 && <span class="row-time">{clock(t.duration)}</span>}
      {t.kind === 'song' && (
        <button class={cx('icon-btn sm heart row-like', liked && 'on')} onClick={stop(() => like(t))} aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked}>
          <Heart size={18} />
        </button>
      )}
      <button class="icon-btn sm" onClick={stop(() => openTrackMenu(t, { playlistId: props.playlistId, queueIndex: props.queueIndex }))} aria-label={`More options for ${t.title}`}>
        <Ellipsis size={20} />
      </button>
    </div>
  );
}

export function TrackList(props: { tracks: Track[]; from?: string; numbered?: boolean; playlistId?: string; limit?: number }) {
  const list = props.limit ? props.tracks.slice(0, props.limit) : props.tracks;
  return (
    <div class="rows">
      {list.map((t, i) => (
        <TrackRow key={t.id} track={t} list={props.tracks} index={i} from={props.from} numbered={props.numbered} playlistId={props.playlistId} />
      ))}
    </div>
  );
}
