// The sing-along screen: the words, large, one line at a time, lighting up as
// they are sung. The screen stays awake while it is open, and "Sing along"
// lowers the original singer so you can take over.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ChevronDown, MicVocal, SkipBack, SkipForward } from 'lucide-preact';
import type { LyricLine, Track } from '../lib/types';
import * as eq from '../lib/eq';
import { buzz } from '../lib/haptics';
import { settings } from '../lib/library';
import { getLyrics, lineAt } from '../lib/lyrics';
import * as player from '../lib/player';
import { isOpen } from '../lib/router';
import { toast } from '../lib/toast';
import { clock, cx } from '../lib/util';
import { Empty, PlayPause, Spinner } from '../ui/bits';
import { useQuery } from '../ui/hooks';
import { Seek } from '../ui/slider';
import { closeKaraoke, coverBg } from '../ui/state';

const DAY = 24 * 60 * 60 * 1000;

export function Karaoke() {
  const t = player.current.value;
  const open = isOpen('karaoke');
  const [mounted, setMounted] = useState(open);

  // Keep the contents alive while the screen fades away, then drop them.
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const id = setTimeout(() => setMounted(false), 380);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      // Leaving the screen always gives the singer back.
      player.setSingAlong(false);
      return;
    }
    // Keep the screen on, like a video would.
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const hold = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (kind: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (!wl || document.visibilityState !== 'visible') return;
        const got = await wl.request('screen');
        if (alive) lock = got; else void got.release();
      } catch { /* not allowed right now; the screen simply follows its usual timer */ }
    };
    void hold();
    const seen = () => { if (document.visibilityState === 'visible') void hold(); };
    document.addEventListener('visibilitychange', seen);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isOpen('sheet')) { e.stopPropagation(); closeKaraoke(); }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', seen);
      window.removeEventListener('keydown', key, true);
      try { void lock?.release(); } catch { /* already released */ }
    };
  }, [open]);

  if (!t) return null;
  const bg = coverBg.value;
  return (
    <div class={cx('kara', open && 'in')} style={bg ? { '--np-bg': bg } : undefined} role="dialog" aria-label="Sing along" aria-hidden={!open}>
      {mounted && <Stage t={t} />}
    </div>
  );
}

function Stage(props: { t: Track }) {
  const t = props.t;
  const song = t.kind === 'song';
  const q = useQuery(song ? 'lyrics:' + t.id : null, (signal) => getLyrics(t, signal), { ttl: DAY });
  const singing = player.singAlong.value;

  const flip = () => {
    buzz('select');
    const on = !singing;
    player.setSingAlong(on);
    if (on) toast("The singer is turned down. It works on most songs, not all.", undefined, 4200);
  };

  let body;
  if (!song) body = <Empty icon={<MicVocal size={26} strokeWidth={1.6} />} title="Words are for songs" text="Podcasts don't have lyrics." />;
  else if (q.loading) body = <div class="empty"><Spinner size={26} /><p>Finding the words…</p></div>;
  else if (q.error) body = <Empty title="Couldn't load the words" text="Check your internet and try again."><button class="btn quiet small" onClick={q.reload}>Try again</button></Empty>;
  else if (!q.data) body = <Empty icon={<MicVocal size={26} strokeWidth={1.6} />} title="No words for this one" text="We couldn't find the lyrics to this song." />;
  else if (q.data.synced) body = <Lines key={t.id} lines={q.data.synced} />;
  else body = <div class="kara-plain" dir="auto">{q.data.plain}</div>;

  return (
    <>
      <div class="kara-top">
        <button class="icon-btn" onClick={closeKaraoke} aria-label="Close"><ChevronDown size={26} /></button>
        <div class="kara-what">
          <b class="clip">{t.title}</b>
          <span class="clip">{t.artist}</span>
        </div>
        {song && eq.supported ? (
          <button class={cx('kara-sing', singing && 'on')} onClick={flip} aria-pressed={singing}>
            <MicVocal size={17} /> Sing along
          </button>
        ) : <span style={{ width: 44 }} />}
      </div>

      <div class="kara-stage">{body}</div>

      <div class="kara-foot">
        <KaraSeek />
        <div class="kara-ctrl">
          <button class="icon-btn" onClick={() => { buzz('tap'); player.prev(); }} aria-label="Previous"><SkipBack size={26} fill="currentColor" /></button>
          <button class="play-btn" style={{ width: 58, height: 58 }} onClick={() => { buzz('tap'); player.toggle(); }} aria-label={player.playing.value ? 'Pause' : 'Play'}>
            <PlayPause size={26} />
          </button>
          <button class="icon-btn" onClick={() => { buzz('tap'); void player.next(); }} aria-label="Next"><SkipForward size={26} fill="currentColor" /></button>
        </div>
      </div>
    </>
  );
}

function KaraSeek() {
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

/** A quiet opening line, so the countdown to the first words has somewhere to live. */
function withLeadIn(lines: LyricLine[]): LyricLine[] {
  return lines.length && lines[0].t > 2.5 ? [{ t: 0, text: '' }, ...lines] : lines;
}

function Lines(props: { lines: LyricLine[] }) {
  const lines = useMemo(() => withLeadIn(props.lines), [props.lines]);
  const at = Math.max(0, lineAt(lines, player.position.value));
  const box = useRef<HTMLDivElement>(null);
  const col = useRef<HTMLDivElement>(null);
  const atRef = useRef(at);
  atRef.current = at;

  // The whole column slides so the line being sung always sits just above the
  // middle. Only `transform` changes, so it stays smooth on any phone.
  const place = () => {
    const b = box.current;
    const c = col.current;
    const now = c?.children[atRef.current] as HTMLElement | undefined;
    if (!b || !c || !now) return;
    const y = now.offsetTop + now.offsetHeight / 2 - b.clientHeight * 0.42;
    c.style.transform = `translate3d(0, ${-Math.round(y)}px, 0)`;
  };
  useLayoutEffect(place, [at, lines]);
  useEffect(() => {
    const b = box.current;
    if (!b || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  // Light the words of the current line one by one. The catalog only knows
  // when each LINE starts, so the words are paced across the line by length.
  useEffect(() => {
    const row = col.current?.children[at] as HTMLElement | undefined;
    if (!row) return;
    const words = Array.from(row.querySelectorAll<HTMLElement>('.kw'));
    const dots = row.querySelector<HTMLElement>('.kdots');
    const line = lines[at];
    const next = lines[at + 1];
    const gap = next ? next.t - line.t : 6;
    const sing = Math.max(0.8, Math.min(gap * 0.94, Math.max(1.8, line.text.length * 0.12)));
    let total = 0;
    const starts = words.map((w) => { const s = total; total += (w.textContent || '').length + 1; return s; });
    let lit = -1;
    let shown = '';
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const time = player.liveTime();
      if (dots) {
        // Three dots count down the last three seconds before the words begin.
        const left = next ? next.t - time : 0;
        const want = left > 3 ? 'wait' : String(Math.max(0, Math.ceil(left)));
        if (want !== shown) { shown = want; dots.dataset.left = want; }
        return;
      }
      const f = (time - line.t) / sing;
      let n = 0;
      while (n < words.length && starts[n] / total <= f) n++;
      if (n !== lit) {
        for (let i = 0; i < words.length; i++) words[i].classList.toggle('sung', i < n);
        lit = n;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [at, lines]);

  const calm = settings.value.calmMotion;
  return (
    <div class="kara-lines" ref={box}>
      <div class={cx('kara-col', calm && 'still')} ref={col}>
        {lines.map((l, i) => {
          const now = i === at;
          const gapAfter = lines[i + 1] ? lines[i + 1].t - l.t : 0;
          return (
            <button
              key={i}
              dir="auto"
              class={cx('kline', now && 'now', i < at && 'past', Math.abs(i - at) === 1 && 'near')}
              tabIndex={now ? 0 : -1}
              onClick={() => { player.seek(l.t); if (!player.playing.value) player.play(); }}
            >
              {!l.text
                ? (now && gapAfter > 3 ? <span class="kdots" data-left="wait"><i /><i /><i /></span> : '♪')
                : now
                  ? l.text.split(/\s+/).filter(Boolean).map((w, n) => <span key={n} class="kw">{w} </span>)
                  : l.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
