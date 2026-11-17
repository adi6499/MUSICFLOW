// The always-there player: a floating pill on phones, a full bar on wide screens.

import type { TargetedPointerEvent } from 'preact';
import { useRef } from 'preact/hooks';
import {
  Heart, ListMusic, Maximize2, MicVocal, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX,
} from 'lucide-preact';
import { isLiked } from '../lib/library';
import * as player from '../lib/player';
import { buzz } from '../lib/haptics';
import { clock, cx } from '../lib/util';
import { goAlbum, goArtist, like } from '../ui/actions';
import { Art, PlayPause } from '../ui/bits';
import { useLens } from '../ui/glass';
import { Seek } from '../ui/slider';
import { openPlayer } from '../ui/state';

function MiniProgress() {
  const d = player.duration.value;
  const r = d > 0 ? Math.min(1, player.position.value / d) : 0;
  return <div class="mini-prog"><i style={{ transform: `scaleX(${r})` }} /></div>;
}

export function Mini() {
  const t = player.current.value;
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const glass = useRef<HTMLDivElement>(null);
  useLens(glass, 'pill');
  if (!t) return null;

  // Tap opens the player. Swipe up opens it too; swipe sideways changes song.
  const down = (e: TargetedPointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const up = (e: TargetedPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (dy < -28 && Math.abs(dy) > Math.abs(dx)) { s.moved = true; openPlayer(); }
    else if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      s.moved = true;
      buzz('tap');
      if (dx < 0) void player.next(); else player.prev();
    }
    if (s.moved) swallow.current = true;
  };
  const swallow = useRef(false);
  const click = () => {
    if (swallow.current) { swallow.current = false; return; }
    openPlayer();
  };
  const stop = (fn: () => void) => (e: Event) => { e.stopPropagation(); fn(); };

  return (
    <div ref={glass} class="mini" role="button" tabIndex={0} aria-label="Open player" onClick={click} onPointerDown={down} onPointerUp={up}
      onKeyDown={(e) => { if (e.key === 'Enter') openPlayer(); }}>
      <Art src={t.image} />
      <div class="mini-text mini-swap" key={t.id}>
        <div class="mini-title clip">{t.title}</div>
        <div class="mini-sub clip">{t.artist}</div>
      </div>
      <button class="play-btn plain" onClick={stop(() => { buzz('tap'); player.toggle(); })} aria-label={player.playing.value ? 'Pause' : 'Play'}>
        <PlayPause size={22} />
      </button>
      <button class="icon-btn" onClick={stop(() => { buzz('tap'); void player.next(); })} aria-label="Next song">
        <SkipForward size={22} fill="currentColor" />
      </button>
      <MiniProgress />
    </div>
  );
}

function BarSeek() {
  const pos = player.position.value;
  const d = player.duration.value;
  return (
    <div class="bar-seek">
      <span>{clock(pos)}</span>
      <Seek value={pos} max={d} buffered={player.bufferedTo.value} onSeek={player.seek} label="Seek" text={clock} />
      <span>{d > 0 ? clock(d) : '–:––'}</span>
    </div>
  );
}

export function Volume() {
  const v = player.volume.value;
  const last = useRef(0.8);
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;
  return (
    <>
      <button class="icon-btn sm" aria-label={v === 0 ? 'Unmute' : 'Mute'} onClick={() => { if (v > 0) { last.current = v; player.setVolume(0); } else player.setVolume(last.current || 0.8); }}>
        <Icon size={19} />
      </button>
      <Seek class="vol" value={v} max={1} step={0.05} onSeek={player.setVolume} onScrub={(x) => { if (x !== null) player.setVolume(x); }} label="Volume" text={(x) => `${Math.round(x * 100)}%`} />
    </>
  );
}

export function Bar() {
  const t = player.current.value;
  if (!t) return null;
  const liked = isLiked(t.id);
  const rep = player.repeat.value;
  return (
    <div class="bar">
      <div class="bar-left">
        <button onClick={() => openPlayer()} aria-label="Open player" style={{ flex: 'none' }}><Art src={t.image} /></button>
        <div style={{ minWidth: 0 }} class="mini-swap" key={t.id}>
          <button class="mini-title clip" style={{ display: 'block', maxWidth: '100%' }} onClick={() => (t.albumId || t.showId ? goAlbum(t) : openPlayer())}>{t.title}</button>
          <button class="mini-sub clip" style={{ display: 'block', maxWidth: '100%' }} onClick={() => (t.kind === 'song' ? goArtist(t) : goAlbum(t))}>{t.artist}</button>
        </div>
        {t.kind === 'song' && (
          <button class={cx('icon-btn sm heart', liked && 'on')} onClick={() => like(t)} aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked}>
            <Heart size={18} />
          </button>
        )}
      </div>
      <div class="bar-mid">
        <div class="bar-ctrl">
          <button class={cx('icon-btn sm', player.shuffle.value && 'on')} onClick={player.toggleShuffle} aria-label="Shuffle" aria-pressed={player.shuffle.value}><Shuffle size={17} /></button>
          <button class="icon-btn sm" onClick={player.prev} aria-label="Previous"><SkipBack size={19} fill="currentColor" /></button>
          <button class="play-btn" onClick={player.toggle} aria-label={player.playing.value ? 'Pause' : 'Play'}><PlayPause size={18} /></button>
          <button class="icon-btn sm" onClick={() => void player.next()} aria-label="Next"><SkipForward size={19} fill="currentColor" /></button>
          <button class={cx('icon-btn sm', rep !== 'off' && 'on')} onClick={player.cycleRepeat} aria-label={rep === 'one' ? 'Repeating one song' : rep === 'all' ? 'Repeating all' : 'Repeat'}>
            {rep === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>
        <BarSeek />
      </div>
      <div class="bar-right">
        {t.kind === 'song' && <button class="icon-btn sm" onClick={() => openPlayer('lyrics')} aria-label="Lyrics"><MicVocal size={18} /></button>}
        <button class="icon-btn sm" onClick={() => openPlayer('queue')} aria-label="Queue"><ListMusic size={19} /></button>
        <Volume />
        <button class="icon-btn sm" onClick={() => openPlayer()} aria-label="Full screen player"><Maximize2 size={17} /></button>
      </div>
    </div>
  );
}
