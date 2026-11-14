// The full-screen player. Slides up over everything; on phones it can be
// dragged down to close. It shows the cover, or the lyrics, or the queue.

import type { TargetedPointerEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  ChevronDown, Ellipsis, Heart, ListMusic, MicVocal, Moon, Pause, Play, Repeat, Repeat1, RotateCcw, RotateCw,
  Shuffle, SkipBack, SkipForward, SlidersHorizontal,
} from 'lucide-preact';
import type { LyricLine, Track } from '../lib/types';
import { tintOf, type Tint } from '../lib/color';
import * as eq from '../lib/eq';
import { isLiked, settings } from '../lib/library';
import { getLyrics, lineAt } from '../lib/lyrics';
import * as player from '../lib/player';
import { isOpen } from '../lib/router';
import { clock, cx, tick } from '../lib/util';
import { goAlbum, goArtist, like } from '../ui/actions';
import { Art, Empty, Spinner } from '../ui/bits';
import { useQuery } from '../ui/hooks';
import { TrackRow } from '../ui/rows';
import { openSleep, openSpeed, openTrackMenu } from '../ui/sheet';
import { openSound } from '../ui/sound';
import { Seek } from '../ui/slider';
import { closePlayer, isWide, npPanel, themeNow } from '../ui/state';

export function NowPlaying() {
  const t = player.current.value;
  const open = isOpen('player');
  const [mounted, setMounted] = useState(open);
  const [tint, setTint] = useState<Tint | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; dy: number; on: boolean; id: number } | null>(null);
  const swallow = useRef(false);
  const wantTint = settings.value.tint;
  const image = t?.image || '';

  // Keep the contents alive while the sheet slides away, then drop them.
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const id = setTimeout(() => setMounted(false), 520);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!wantTint || !image) { setTint(null); return; }
    let alive = true;
    void tintOf(image).then((c) => { if (alive) setTint(c); });
    return () => { alive = false; };
  }, [image, wantTint]);

  useEffect(() => {
    document.documentElement.classList.toggle('locked', open);
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isOpen('sheet')) closePlayer(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  if (!t) return null;

  // Drag down to close (touch only). A drag never starts on sliders or scrolling lists.
  const down = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || !open) return;
    const target = e.target as HTMLElement;
    if (target.closest('.seek, .vslider, .panel-scroll, input')) return;
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), dy: 0, on: false, id: e.pointerId };
  };
  const move = (e: TargetedPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y;
    const dx = e.clientX - d.x;
    if (!d.on) {
      if (dy > 9 && dy > Math.abs(dx) * 1.2) {
        d.on = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        el.classList.add('dragging');
      } else if (Math.abs(dx) > 14 || dy < -14) {
        drag.current = null;
        return;
      } else return;
    }
    d.dy = Math.max(0, dy);
    el.style.transform = `translateY(${d.dy}px)`;
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    const el = ref.current;
    if (!d || !el || !d.on) return;
    swallow.current = true;
    setTimeout(() => { swallow.current = false; }, 60);
    el.classList.remove('dragging');
    el.style.transform = '';
    const speed = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 130 || (d.dy > 40 && speed > 0.55)) closePlayer();
  };
  // A drag that ended on a button must not also press it.
  const clickCapture = (e: Event) => {
    if (swallow.current) { e.stopPropagation(); e.preventDefault(); swallow.current = false; }
  };

  const dark = themeNow.value === 'dark';
  const bg = tint ? (dark ? `hsl(${tint.h} ${Math.round(tint.s * 0.34)}% 13%)` : `hsl(${tint.h} ${Math.round(tint.s * 0.44)}% 89%)`) : undefined;

  return (
    <div
      ref={ref}
      class={cx('np', open && 'in')}
      style={bg ? { '--np-bg': bg } : undefined}
      role="dialog"
      aria-label="Now playing"
      aria-hidden={!open}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClickCapture={clickCapture}
    >
      {mounted && <Inner t={t} />}
    </div>
  );
}

function Inner(props: { t: Track }) {
  const t = props.t;
  const wide = isWide.value;
  const panel = npPanel.value;
  const from = player.playingFrom.value;
  const liked = isLiked(t.id);
  const song = t.kind === 'song';
  const onStage = !wide && panel !== 'art';

  return (
    <>
      <div class="np-top">
        <button class="icon-btn" onClick={closePlayer} aria-label="Close player"><ChevronDown size={26} /></button>
        <div class="np-from">
          {from && (
            <>
              <span class="label">Playing from</span>
              <b class="clip">{from}</b>
            </>
          )}
        </div>
        <button class="icon-btn" onClick={() => openTrackMenu(t)} aria-label="More options"><Ellipsis size={24} /></button>
      </div>

      <div class="np-body">
        <div class="np-left">
          <div class="np-stage">
            {onStage ? (
              panel === 'lyrics' && song ? <LyricsPanel key={'l' + t.id} t={t} /> : <QueuePanel />
            ) : (
              <div class="np-art-wrap" key={t.id}>
                <Art src={t.image} size={500} eager class={cx('np-art', !player.playing.value && 'paused')} alt="" />
              </div>
            )}
          </div>

          <div class="np-info">
            <div key={t.id} class="mini-swap">
              <div class="np-title clip-2">{t.title}</div>
              <div class="np-artist clip">
                <button onClick={() => (song ? goArtist(t) : goAlbum(t))}>{t.artist}</button>
              </div>
            </div>
            {song && (
              <button class={cx('icon-btn heart', liked && 'on')} onClick={() => like(t)} aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked}>
                <Heart size={26} />
              </button>
            )}
          </div>

          <NpSeek />
          <Controls song={song} />
          <Tools t={t} wide={wide} />
        </div>

        {wide && (
          <div class="np-side">
            {panel === 'lyrics' && song ? <LyricsPanel key={'l' + t.id} t={t} /> : <QueuePanel />}
          </div>
        )}
      </div>
    </>
  );
}

function NpSeek() {
  const [scrub, setScrub] = useState<number | null>(null);
  const real = player.position.value;
  const d = player.duration.value;
  const pos = scrub ?? real;
  return (
    <div class="np-seek">
      <Seek class="fat" value={real} max={d} buffered={player.bufferedTo.value} onSeek={player.seek} onScrub={setScrub} label="Seek" text={clock} />
      <div class="np-times">
        <span>{clock(pos)}</span>
        <span>{d > 0 ? '−' + clock(Math.max(0, d - pos)) : ''}</span>
      </div>
    </div>
  );
}

function Controls(props: { song: boolean }) {
  const playing = player.playing.value;
  const busy = player.loading.value && playing;
  const rep = player.repeat.value;
  const press = (fn: () => void) => () => { tick(); fn(); };
  return (
    <div class="np-ctrl">
      {props.song ? (
        <button class={cx('icon-btn np-dot dim', player.shuffle.value && 'on')} onClick={press(player.toggleShuffle)} aria-label="Shuffle" aria-pressed={player.shuffle.value}>
          <Shuffle size={22} />
        </button>
      ) : (
        <button class="icon-btn dim" onClick={() => player.seekBy(-15)} aria-label="Back 15 seconds"><RotateCcw size={24} /></button>
      )}
      <button class="icon-btn" onClick={press(player.prev)} aria-label="Previous"><SkipBack size={30} fill="currentColor" /></button>
      <button class="play-btn big" onClick={press(player.toggle)} aria-label={playing ? 'Pause' : 'Play'}>
        {busy ? <Spinner size={30} /> : playing ? <Pause size={30} fill="currentColor" strokeWidth={0} /> : <Play size={30} fill="currentColor" strokeWidth={0} style={{ marginLeft: 4 }} />}
      </button>
      <button class="icon-btn" onClick={press(() => void player.next())} aria-label="Next"><SkipForward size={30} fill="currentColor" /></button>
      {props.song ? (
        <button class={cx('icon-btn np-dot dim', rep !== 'off' && 'on')} onClick={press(player.cycleRepeat)} aria-label={rep === 'one' ? 'Repeating one song' : rep === 'all' ? 'Repeating all' : 'Repeat'}>
          {rep === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
        </button>
      ) : (
        <button class="icon-btn dim" onClick={() => player.seekBy(30)} aria-label="Forward 30 seconds"><RotateCw size={24} /></button>
      )}
    </div>
  );
}

function Tools(props: { t: Track; wide: boolean }) {
  const panel = npPanel.value;
  const song = props.t.kind === 'song';
  const left = player.sleepLeft.value;
  const sleeping = player.sleepAt.value !== null;
  const flip = (p: 'lyrics' | 'queue') => { npPanel.value = panel === p ? (props.wide ? (p === 'lyrics' ? 'queue' : 'lyrics') : 'art') : p; };
  return (
    <div class="np-tools">
      {song ? (
        <button class={cx('icon-btn', panel === 'lyrics' && 'on')} onClick={() => flip('lyrics')} aria-label="Lyrics" aria-pressed={panel === 'lyrics'}><MicVocal size={21} /></button>
      ) : (
        <button class="icon-btn" onClick={openSpeed} aria-label="Playback speed"><span class="tool-text">{settings.value.podcastSpeed}×</span></button>
      )}
      <button class={cx('icon-btn', panel === 'queue' && 'on')} onClick={() => flip('queue')} aria-label="Queue" aria-pressed={panel === 'queue'}><ListMusic size={22} /></button>
      <button class={cx('icon-btn', sleeping && 'on')} onClick={openSleep} aria-label="Sleep timer">
        {left !== null ? <span class="tool-text">{Math.ceil(left / 60)}m</span> : <Moon size={21} />}
      </button>
      {song && eq.supported && (
        <button class={cx('icon-btn', settings.value.eqOn && 'on')} onClick={openSound} aria-label="Sound"><SlidersHorizontal size={21} /></button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- queue

function QueuePanel() {
  const q = player.queue.value;
  const at = player.index.value;
  const cur = q[at];
  const upcoming = q.slice(at + 1, at + 101);
  return (
    <div class="np-panel">
      <div class="panel-head">
        <h3>Queue</h3>
        {upcoming.length > 0 && <button class="btn quiet small" onClick={player.clearUpNext}>Clear</button>}
      </div>
      <div class="panel-scroll">
        {cur && (
          <>
            <div class="label queue-label">Now playing</div>
            <TrackRow track={cur} list={q} index={at} queueIndex={at} onPlay={player.toggle} />
          </>
        )}
        {upcoming.length > 0 && <div class="label queue-label">Next up</div>}
        {upcoming.map((t, i) => (
          <TrackRow key={t.id + ':' + (at + 1 + i)} track={t} list={q} index={at + 1 + i} queueIndex={at + 1 + i} onPlay={() => player.jump(at + 1 + i)} />
        ))}
        {!upcoming.length && (
          <p class="small muted" style={{ padding: '18px 0' }}>
            {settings.value.autoplay && cur?.kind === 'song'
              ? 'Nothing queued. Similar songs will keep playing after this one.'
              : 'Nothing queued after this.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lyrics

const DAY = 24 * 60 * 60 * 1000;

function LyricsPanel(props: { t: Track }) {
  const t = props.t;
  const q = useQuery('lyrics:' + t.id, (signal) => getLyrics(t, signal), { ttl: DAY });
  let body;
  if (q.loading) {
    body = <div class="empty"><Spinner size={24} /><p>Finding the words…</p></div>;
  } else if (q.error) {
    body = <Empty title="Couldn't load lyrics" text="Check your internet and try again."><button class="btn quiet small" onClick={q.reload}>Try again</button></Empty>;
  } else if (!q.data) {
    body = <Empty icon={<MicVocal size={26} strokeWidth={1.6} />} title="No lyrics for this one" text="We couldn't find the words to this song." />;
  } else if (q.data.synced) {
    return <div class="np-panel"><Synced lines={q.data.synced} /></div>;
  } else {
    body = (
      <div class="panel-scroll">
        <div class="lyrics plain" dir="auto">{q.data.plain}</div>
      </div>
    );
  }
  return <div class="np-panel">{body}</div>;
}

function Synced(props: { lines: LyricLine[] }) {
  const lines = props.lines;
  const at = lineAt(lines, player.position.value);
  const box = useRef<HTMLDivElement>(null);
  const touched = useRef(0);

  // Keep the line being sung about a third of the way down, unless the person
  // has just scrolled by hand — then leave them be for a few seconds.
  useEffect(() => {
    const el = box.current;
    if (!el || performance.now() - touched.current < 3500) return;
    const line = el.querySelector<HTMLElement>('.lyric.now') || el.querySelector<HTMLElement>('.lyric');
    if (!line) return;
    const top = Math.max(0, line.offsetTop - el.clientHeight * 0.3);
    el.scrollTo({ top, behavior: settings.value.calmMotion ? 'auto' : 'smooth' });
  }, [at]);

  const mark = () => { touched.current = performance.now(); };
  return (
    <div class="panel-scroll" ref={box} onPointerDown={mark} onWheel={mark} onTouchMove={mark}>
      <div class="lyrics">
        {lines.map((l, i) => (
          <button key={i} dir="auto" class={cx('lyric', i === at && 'now', i < at && 'past')} onClick={() => { touched.current = 0; player.seek(l.t); if (!player.playing.value) player.play(); }}>
            {l.text || '♪'}
          </button>
        ))}
      </div>
    </div>
  );
}
