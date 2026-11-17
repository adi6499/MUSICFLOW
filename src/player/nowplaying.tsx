// The full-screen player. Slides up over everything; on phones it can be
// dragged down to close. It shows the cover, or the lyrics, or the queue.
//
// Things you can do with a finger here:
//   swipe the cover left or right   → next / previous song
//   tap the cover twice             → like the song
//   drag the page down              → close the player
//   drag a queue row by its handle  → change what plays next

import type { TargetedKeyboardEvent, TargetedPointerEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  ChevronDown, Ellipsis, Heart, ListMusic, Maximize2, MicVocal, Moon, Repeat, Repeat1, RotateCcw, RotateCw,
  Shuffle, SkipBack, SkipForward, SlidersHorizontal,
} from 'lucide-preact';
import type { LyricLine, Track } from '../lib/types';
import { tintOf, type Tint } from '../lib/color';
import * as eq from '../lib/eq';
import { isLiked, setSetting, settings } from '../lib/library';
import { getLyrics, lineAt } from '../lib/lyrics';
import * as player from '../lib/player';
import { isOpen } from '../lib/router';
import { buzz } from '../lib/haptics';
import { toast } from '../lib/toast';
import { clamp, clock, cx } from '../lib/util';
import { goAlbum, goArtist, like } from '../ui/actions';
import { Art, Empty, PlayPause, Spinner } from '../ui/bits';
import { useQuery } from '../ui/hooks';
import { TrackRow, type Grip } from '../ui/rows';
import { openSleep, openSpeed, openTrackMenu } from '../ui/sheet';
import { applyMode, openSound } from '../ui/sound';
import { Seek } from '../ui/slider';
import { closePlayer, coverBg, isWide, npPanel, openKaraoke, themeNow } from '../ui/state';
import { Volume } from './dock';

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
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isOpen('sheet') && !isOpen('karaoke')) closePlayer(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  const dark = themeNow.value === 'dark';
  const bg = tint ? (dark ? `hsl(${tint.h} ${Math.round(tint.s * 0.34)}% 13%)` : `hsl(${tint.h} ${Math.round(tint.s * 0.44)}% 89%)`) : undefined;
  // The sing-along screen wears the same colour.
  useEffect(() => { coverBg.value = bg; }, [bg]);

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

  // Once, the first time the big player is opened: point out that the sound can be better.
  useEffect(() => {
    const s = settings.peek();
    if (!eq.supported || s.eqOn || s.soundTipSeen || player.current.value?.kind !== 'song') return;
    const id = setTimeout(() => {
      setSetting('soundTipSeen', true);
      toast('Want richer sound? Try the Sukoon Signature mode.', { label: 'Try it', run: () => { applyMode('Signature'); buzz('done'); } }, 5200);
    }, 4000);
    return () => clearTimeout(id);
  }, []);

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
              <Cover key={t.id} t={t} />
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

// ---------------------------------------------------------------- the cover

/** Which way the last cover left, so the next one can arrive from the other side. */
let arriving: '' | 'left' | 'right' = '';

function Cover(props: { t: Track }) {
  const t = props.t;
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<{ x: number; y: number; id: number; on: boolean; dx: number; at: number } | null>(null);
  const lastTap = useRef(0);
  const [burst, setBurst] = useState(0);
  const [from] = useState(() => { const a = arriving; arriving = ''; return a; });

  const love = () => {
    if (t.kind !== 'song') return;
    if (isLiked(t.id)) buzz('like'); else like(t);
    setBurst((n) => n + 1);
  };

  const down = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    g.current = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, dx: 0, at: performance.now() };
  };
  const move = (e: TargetedPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    const el = ref.current;
    if (!s || !el || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.on) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        s.on = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        el.classList.add('swiping');
      } else if (Math.abs(dy) > 12) {
        g.current = null;
        return;
      } else return;
    }
    s.dx = dx;
    const w = el.offsetWidth || 320;
    el.style.transform = `translate3d(${dx}px, 0, 0) rotate(${(dx / w) * 5}deg)`;
    el.style.opacity = String(1 - Math.min(0.55, Math.abs(dx) / w));
  };
  const up = (e: TargetedPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    g.current = null;
    const el = ref.current;
    if (!s || !el) return;
    if (!s.on) {
      // A tap. Two quick taps like the song.
      if (Math.abs(e.clientX - s.x) < 12 && Math.abs(e.clientY - s.y) < 12) {
        const now = performance.now();
        if (now - lastTap.current < 320) { lastTap.current = 0; love(); } else lastTap.current = now;
      }
      return;
    }
    el.classList.remove('swiping');
    const w = el.offsetWidth || 320;
    const speed = Math.abs(s.dx) / Math.max(1, performance.now() - s.at);
    const far = Math.abs(s.dx) > w * 0.26 || (Math.abs(s.dx) > 34 && speed > 0.5);
    const forward = s.dx < 0;
    const possible = forward || player.index.value > 0;
    if (!far || !possible) {
      el.style.transform = '';
      el.style.opacity = '';
      return;
    }
    buzz('tap');
    el.style.transform = `translate3d(${forward ? -w * 1.05 : w * 1.05}px, 0, 0) rotate(${forward ? -6 : 6}deg)`;
    el.style.opacity = '0';
    arriving = forward ? 'right' : 'left';
    setTimeout(() => { if (forward) void player.next(); else player.jump(player.index.value - 1); }, 140);
    // Nothing further to play (the end of the queue): the cover comes back.
    setTimeout(() => {
      if (ref.current === el) { arriving = ''; el.style.transform = ''; el.style.opacity = ''; }
    }, 900);
  };
  const cancel = () => {
    const s = g.current;
    g.current = null;
    const el = ref.current;
    if (!s || !el || !s.on) return;
    el.classList.remove('swiping');
    el.style.transform = '';
    el.style.opacity = '';
  };

  return (
    <div
      ref={ref}
      class={cx('np-art-wrap', from && 'from-' + from)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      <Art src={t.image} size={500} eager class={cx('np-art', !player.playing.value && 'paused')} alt="" />
      {burst > 0 && <span class="np-burst" key={burst} aria-hidden="true"><Heart size={92} fill="currentColor" strokeWidth={0} /></span>}
    </div>
  );
}

function NpSeek() {
  const [scrub, setScrub] = useState<number | null>(null);
  const real = player.position.value;
  const d = player.duration.value;
  const pos = scrub ?? real;
  const onScrub = (v: number | null) => {
    if (v !== null && scrub === null) buzz('select');
    setScrub(v);
  };
  return (
    <div class="np-seek">
      {scrub !== null && d > 0 && <span class="seek-bubble" style={{ left: `${clamp(scrub / d, 0, 1) * 100}%` }}>{clock(scrub)}</span>}
      <Seek class="fat" value={real} max={d} buffered={player.bufferedTo.value} onSeek={player.seek} onScrub={onScrub} label="Seek" text={clock} />
      <div class="np-times">
        <span>{clock(pos)}</span>
        <span>{d > 0 ? '−' + clock(Math.max(0, d - pos)) : ''}</span>
      </div>
    </div>
  );
}

function Controls(props: { song: boolean }) {
  const playing = player.playing.value;
  const rep = player.repeat.value;
  const press = (fn: () => void) => () => { buzz('tap'); fn(); };
  return (
    <div class="np-ctrl">
      {props.song ? (
        <button class={cx('icon-btn np-dot dim', player.shuffle.value && 'on')} onClick={press(player.toggleShuffle)} aria-label="Shuffle" aria-pressed={player.shuffle.value}>
          <Shuffle size={22} />
        </button>
      ) : (
        <button class="icon-btn dim" onClick={press(() => player.seekBy(-15))} aria-label="Back 15 seconds"><RotateCcw size={24} /></button>
      )}
      <button class="icon-btn np-skip" onClick={press(player.prev)} aria-label="Previous"><SkipBack size={30} fill="currentColor" /></button>
      <button class="play-btn big" onClick={press(player.toggle)} aria-label={playing ? 'Pause' : 'Play'}>
        <PlayPause size={30} />
      </button>
      <button class="icon-btn np-skip" onClick={press(() => void player.next())} aria-label="Next"><SkipForward size={30} fill="currentColor" /></button>
      {props.song ? (
        <button class={cx('icon-btn np-dot dim', rep !== 'off' && 'on')} onClick={press(player.cycleRepeat)} aria-label={rep === 'one' ? 'Repeating one song' : rep === 'all' ? 'Repeating all' : 'Repeat'}>
          {rep === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
        </button>
      ) : (
        <button class="icon-btn dim" onClick={press(() => player.seekBy(30))} aria-label="Forward 30 seconds"><RotateCw size={24} /></button>
      )}
    </div>
  );
}

function Tools(props: { t: Track; wide: boolean }) {
  const panel = npPanel.value;
  const song = props.t.kind === 'song';
  const left = player.sleepLeft.value;
  const sleeping = player.sleepAt.value !== null;
  const flip = (p: 'lyrics' | 'queue') => {
    buzz('select');
    npPanel.value = panel === p ? (props.wide ? (p === 'lyrics' ? 'queue' : 'lyrics') : 'art') : p;
  };
  return (
    <>
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
      {props.wide && <div class="np-vol"><Volume /></div>}
    </>
  );
}

// ---------------------------------------------------------------- queue

interface Sort {
  from: number;
  to: number;
  y0: number;
  y: number;
  h: number;
  id: number;
  row: HTMLElement;
  box: HTMLElement;
  scroll0: number;
  count: number;
  base: number;
  frame: number;
}

function QueuePanel() {
  const q = player.queue.value;
  const at = player.index.value;
  const cur = q[at];
  const upcoming = q.slice(at + 1, at + 101);
  const count = upcoming.length;
  const list = useRef<HTMLDivElement>(null);
  const sort = useRef<Sort | null>(null);

  const rows = (): HTMLElement[] => (list.current ? (Array.from(list.current.children) as HTMLElement[]) : []);

  // The row under the finger follows it; the rows it passes step aside.
  const update = (d: Sort) => {
    const max = d.count - 1;
    const dy = clamp(d.y - d.y0 + (d.box.scrollTop - d.scroll0), -d.from * d.h, (max - d.from) * d.h);
    d.row.style.transform = `translate3d(0, ${dy}px, 0)`;
    const to = clamp(d.from + Math.round(dy / d.h), 0, max);
    if (to === d.to) return;
    d.to = to;
    buzz('tick');
    rows().forEach((el, n) => {
      if (el === d.row) return;
      let y = 0;
      if (d.from < to && n > d.from && n <= to) y = -d.h;
      else if (d.from > to && n >= to && n < d.from) y = d.h;
      el.style.transform = y ? `translate3d(0, ${y}px, 0)` : '';
    });
  };
  // Holding a row near the top or bottom edge scrolls the list.
  const loop = () => {
    const d = sort.current;
    if (!d) return;
    d.frame = requestAnimationFrame(loop);
    const r = d.box.getBoundingClientRect();
    const edge = 60;
    let step = 0;
    if (d.y < r.top + edge) step = -Math.ceil((r.top + edge - d.y) / 6);
    else if (d.y > r.bottom - edge) step = Math.ceil((d.y - (r.bottom - edge)) / 6);
    if (!step) return;
    const before = d.box.scrollTop;
    d.box.scrollTop = before + clamp(step, -14, 14);
    if (d.box.scrollTop !== before) update(d);
  };
  const drop = () => {
    const d = sort.current;
    sort.current = null;
    if (!d) return;
    cancelAnimationFrame(d.frame);
    list.current?.classList.remove('sorting');
    rows().forEach((el) => { el.style.transform = ''; });
    d.row.classList.remove('lifting');
    // If the song changed mid-drag the rows are no longer the ones that were picked up.
    if (d.to !== d.from && player.index.value + 1 === d.base) {
      player.moveInQueue(d.base + d.from, d.base + d.to);
      buzz('tap');
    }
  };
  const grip = (i: number): Grip => ({
    onPointerDown: (e) => {
      if (sort.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const row = e.currentTarget.closest<HTMLElement>('.row');
      const box = list.current?.closest<HTMLElement>('.panel-scroll');
      if (!row || !box || !list.current) return;
      e.preventDefault();
      e.stopPropagation();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const d: Sort = {
        from: i, to: i, y0: e.clientY, y: e.clientY, h: row.offsetHeight, id: e.pointerId,
        row, box, scroll0: box.scrollTop, count, base: at + 1, frame: 0,
      };
      sort.current = d;
      row.classList.add('lifting');
      list.current.classList.add('sorting');
      buzz('select');
      d.frame = requestAnimationFrame(loop);
    },
    onPointerMove: (e) => {
      const d = sort.current;
      if (!d || e.pointerId !== d.id) return;
      d.y = e.clientY;
      update(d);
    },
    onPointerUp: drop,
    onPointerCancel: drop,
    onKeyDown: (e: TargetedKeyboardEvent<HTMLButtonElement>) => {
      const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
      if (to < 0 || to >= count) return;
      e.preventDefault();
      e.stopPropagation();
      player.moveInQueue(at + 1 + i, at + 1 + to);
      // Keep hold of the same song so it can be moved again.
      setTimeout(() => rows()[to]?.querySelector<HTMLElement>('.row-grip')?.focus(), 30);
    },
  });

  return (
    <div class="np-panel">
      <div class="panel-head">
        <h3>Queue</h3>
        {count > 0 && <button class="btn quiet small" onClick={player.clearUpNext}>Clear</button>}
      </div>
      <div class="panel-scroll">
        {cur && (
          <>
            <div class="label queue-label">Now playing</div>
            <TrackRow track={cur} list={q} index={at} queueIndex={at} onPlay={player.toggle} />
          </>
        )}
        {count > 0 && <div class="label queue-label">Next up</div>}
        <div class="queue-list" ref={list}>
          {upcoming.map((t, i) => (
            <TrackRow key={t.id + ':' + (at + 1 + i)} track={t} list={q} index={at + 1 + i} queueIndex={at + 1 + i} onPlay={() => player.jump(at + 1 + i)} grip={grip(i)} />
          ))}
        </div>
        {!count && (
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
    body = <Synced lines={q.data.synced} />;
  } else {
    body = (
      <div class="panel-scroll">
        <div class="lyrics plain" dir="auto">{q.data.plain}</div>
      </div>
    );
  }
  return (
    <div class="np-panel">
      <div class="panel-head">
        <h3>Lyrics</h3>
        {!!q.data && (
          <button class="btn quiet small" onClick={() => { buzz('select'); openKaraoke(); }}>
            <Maximize2 size={15} /> Sing along
          </button>
        )}
      </div>
      {body}
    </div>
  );
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
