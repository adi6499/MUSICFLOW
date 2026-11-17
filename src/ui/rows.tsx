// A song in a list.

import type { ComponentChildren, TargetedKeyboardEvent, TargetedPointerEvent } from 'preact';
import { CircleArrowDown, Ellipsis, GripVertical, Heart } from 'lucide-preact';
import type { Track } from '../lib/types';
import { buzz } from '../lib/haptics';
import { isLiked } from '../lib/library';
import * as offline from '../lib/offline';
import * as player from '../lib/player';
import { toast } from '../lib/toast';
import { clock, cx } from '../lib/util';
import { like } from './actions';
import { Art } from './bits';
import { openTrackMenu } from './sheet';

/** "42%" while a song is on its way to the device. Only this redraws as the number climbs. */
function Coming(props: { id: string }) {
  const p = offline.percent.value[props.id];
  return <span class="dl-pct">{p === undefined ? 'Waiting' : Math.round(p * 100) + '%'}</span>;
}

/** What a queue row's drag handle needs. */
export interface Grip {
  onPointerDown: (e: TargetedPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: TargetedPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: TargetedPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: TargetedPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: TargetedKeyboardEvent<HTMLButtonElement>) => void;
}

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
  /** Queue rows: a handle to drag the row to a new place (replaces the heart). */
  grip?: Grip;
}) {
  const t = props.track;
  const cur = player.current.value;
  const on = !!cur && cur.id === t.id && (props.queueIndex === undefined || props.queueIndex === player.index.value);
  const live = on && player.playing.value;
  const liked = isLiked(t.id);
  const saved = offline.isDownloaded(t.id);
  const coming = t.id in offline.active.value;
  // No internet and not on the device: shown faded, and a tap explains why.
  const away = !offline.canPlay(t);

  const tap = () => {
    if (away && !on) { buzz('warn'); toast("You're offline. This one isn't downloaded."); return; }
    if (props.onPlay) { props.onPlay(); return; }
    if (on) { player.toggle(); return; }
    player.playTracks(props.list, props.index, props.from);
  };
  const stop = (fn: () => void) => (e: Event) => { e.stopPropagation(); fn(); };

  return (
    <div
      class={cx('row', on && 'on', away && 'away')}
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
          {saved && <CircleArrowDown size={13} class="dl-mark" aria-label="Downloaded" />}
          {coming && <Coming id={t.id} />}
          {props.sub ?? t.artist}
        </div>
      </div>
      {t.duration > 0 && <span class="row-time">{clock(t.duration)}</span>}
      {props.grip && (
        <button class="icon-btn sm row-grip" aria-label={`Move ${t.title}. Drag, or use the up and down arrow keys.`} onClick={(e) => e.stopPropagation()} {...props.grip}>
          <GripVertical size={18} />
        </button>
      )}
      {t.kind === 'song' && !props.grip && (
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
