// Listening stats: how much you listened this week, your streak, and what you
// played most. Everything is counted on this device; nothing is sent anywhere.

import { Flame, Share2 } from 'lucide-preact';
import { hydrated } from '../lib/library';
import { computeStats, type Stats } from '../lib/mixes';
import { buzz } from '../lib/haptics';
import { isApp } from '../lib/native';
import { to } from '../lib/router';
import { toast } from '../lib/toast';
import { cx, plural } from '../lib/util';
import { Art, Empty, Link, SkeletonRows, TopBar } from '../ui/bits';
import { Section } from '../ui/cards';
import { TrackRow } from '../ui/rows';

/** 5400 → "1 hr 30 min"; 40 → "under a minute". */
function spoken(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return seconds > 0 ? 'under a minute' : '0 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

function summary(s: Stats): string {
  const lines = [`My week on Music Flow: ${spoken(s.weekSeconds)}, ${plural(s.weekPlays, 'song')}.`];
  if (s.topArtists.length) lines.push('Top artists: ' + s.topArtists.slice(0, 3).map((a) => a.name).join(', ') + '.');
  if (s.topSongs.length) lines.push('On repeat: ' + s.topSongs.slice(0, 3).map((x) => x.track.title).join(', ') + '.');
  return lines.join('\n');
}

/** A picture of the week, drawn in the colours of the theme in use. Words only, so it works everywhere. */
export function drawCard(s: Stats): HTMLCanvasElement {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = color('--bg', '#f4f1ea');
  const ink = color('--ink', '#1c1a17');
  const soft = color('--ink-2', '#6b665e');
  const accent = color('--accent', '#4b57b8');
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const font = (weight: number, size: number) => { x.font = `${weight} ${size}px Ubuntu, system-ui, sans-serif`; };
  const fit = (text: string, max: number): string => {
    if (x.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  };
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic';
  const L = 96;

  x.fillStyle = accent;
  font(700, 34);
  x.fillText('MY WEEK ON MUSIC FLOW', L, 150);

  x.fillStyle = ink;
  font(700, 132);
  x.fillText(fit(spoken(s.weekSeconds), W - L * 2), L, 310);
  x.fillStyle = soft;
  font(500, 44);
  x.fillText(`${plural(s.weekPlays, 'song')}${s.streak > 1 ? `  ·  ${s.streak} days in a row` : ''}`, L, 384);

  // The seven days as plain bars.
  const top = 470;
  const tall = 190;
  const gap = 26;
  const wide = (W - L * 2 - gap * 6) / 7;
  const most = Math.max(60, ...s.days.map((d) => d.seconds));
  s.days.forEach((d, i) => {
    const h = Math.max(10, (d.seconds / most) * tall);
    const left = L + i * (wide + gap);
    x.fillStyle = d.today ? accent : ink;
    x.globalAlpha = d.today ? 1 : d.seconds > 0 ? 0.78 : 0.14;
    x.beginPath();
    x.roundRect(left, top + tall - h, wide, h, 14);
    x.fill();
    x.globalAlpha = 1;
    x.fillStyle = soft;
    font(500, 30);
    x.textAlign = 'center';
    x.fillText(d.label, left + wide / 2, top + tall + 48);
    x.textAlign = 'left';
  });

  let y = 806;
  const block = (title: string, rows: string[]) => {
    if (!rows.length) return;
    x.fillStyle = soft;
    font(700, 30);
    x.fillText(title, L, y);
    y += 60;
    rows.forEach((row, i) => {
      x.fillStyle = accent;
      font(700, 44);
      x.fillText(String(i + 1), L, y);
      x.fillStyle = ink;
      font(500, 46);
      x.fillText(fit(row, W - L * 2 - 70), L + 64, y);
      y += 64;
    });
    y += 30;
  };
  block('TOP ARTISTS', s.topArtists.slice(0, 3).map((a) => a.name));
  block('ON REPEAT', s.topSongs.slice(0, 3).map((t) => t.track.title));

  return c;
}

async function shareWeek(s: Stats): Promise<void> {
  buzz('tap');
  const text = summary(s);
  try {
    // Make sure the lettering is ready before drawing with it.
    await (document as Document & { fonts?: { load: (f: string) => Promise<unknown> } }).fonts?.load('700 40px Ubuntu');
    const canvas = drawCard(s);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (blob) {
      const file = new File([blob], 'my-week-on-music-flow.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My week on Music Flow', text });
        return;
      }
      if (!isApp) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('Picture saved to your downloads');
        return;
      }
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied, ready to paste');
  } catch {
    toast("Couldn't share from here.");
  }
}

export function StatsPage() {
  if (!hydrated.value) return <div class="page page-narrow"><TopBar /><SkeletonRows /></div>;
  const s = computeStats();
  const most = Math.max(60, ...s.days.map((d) => d.seconds));
  const nothing = !s.totalPlays && !s.weekSeconds;
  const songs = s.topSongs.map((x) => x.track);

  return (
    <div class="page page-narrow page-in">
      <TopBar title="Your listening" threshold={90} />
      <header class="page-head">
        <h1 class="display">Your listening</h1>
        <p class="muted">Counted on this device only.</p>
      </header>

      {nothing ? (
        <Empty title="Nothing to count yet" text="Play some music and come back: your week will take shape here.">
          <Link to={to.home()} class="btn quiet">Find something to play</Link>
        </Empty>
      ) : (
        <>
          <section class="section" style={{ marginTop: 18 }}>
            <div class="set-card stat-card">
              <div class="label">This week</div>
              <div class="stat-big">{spoken(s.weekSeconds)}</div>
              <div class="stat-sub">
                {plural(s.weekPlays, 'song')}
                {s.streak > 1 && <span class="stat-streak"><Flame size={15} /> {s.streak} days in a row</span>}
              </div>
              <div class="bars" role="img" aria-label={'Listening per day: ' + s.days.map((d) => `${d.label} ${spoken(d.seconds)}`).join(', ')}>
                {s.days.map((d) => (
                  <div key={d.key} class={cx('bar-col', d.today && 'today')}>
                    <div class="bar-track"><i class={cx(!d.seconds && 'none')} style={{ transform: `scaleY(${Math.max(0.04, d.seconds / most)})` }} /></div>
                    <span>{d.label}</span>
                  </div>
                ))}
              </div>
              <button class="btn quiet small" style={{ marginTop: 16 }} onClick={() => void shareWeek(s)}><Share2 size={16} /> Share my week</button>
            </div>
          </section>

          {s.topArtists.length > 0 && (
            <Section title="Your top artists">
              <div class="rows">
                {s.topArtists.map((a, i) => (
                  <Link key={a.name} to={to.artistNamed(a.name)} class="row">
                    <span class="row-num">{i + 1}</span>
                    <Art src={a.image} round />
                    <div class="row-text">
                      <div class="row-title clip">{a.name}</div>
                      <div class="row-sub clip">{plural(a.plays, 'play')}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {songs.length > 0 && (
            <Section title="Your top songs">
              <div class="rows">
                {s.topSongs.map((x, i) => (
                  <TrackRow key={x.track.id} track={x.track} list={songs} index={i} from="Your top songs" sub={`${plural(x.plays, 'play')} · ${x.track.artist}`} />
                ))}
              </div>
            </Section>
          )}

          <p class="small faint" style={{ padding: '18px 4px 0' }}>
            {plural(s.totalPlays, 'song')} played here in all. Minutes per day are counted from this version onwards.
          </p>
        </>
      )}
    </div>
  );
}
