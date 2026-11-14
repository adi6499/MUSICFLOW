// Podcasts: what's popular, search, and a show's episodes.

import { useRef, useState } from 'preact/hooks';
import { Check, Mic, Play, Plus, Search as SearchIcon, X } from 'lucide-preact';
import type { Show, ShowRef, Track } from '../lib/types';
import { episodePos, isShowSaved, shows, toggleShow } from '../lib/library';
import { getShow, searchShows, topShows } from '../lib/podcasts';
import * as player from '../lib/player';
import { route } from '../lib/router';
import { toast } from '../lib/toast';
import { clock, cx, longTime, plural, tick } from '../lib/util';
import { Art, Empty, Failed, SkeletonHero, SkeletonRows, SkeletonShelf, TopBar } from '../ui/bits';
import { ItemGrid, ItemShelf, Section } from '../ui/cards';
import { useDebounced, useQuery } from '../ui/hooks';
import { openTrackMenu } from '../ui/sheet';
import { Ellipsis } from 'lucide-preact';

const HOUR = 60 * 60 * 1000;

export function Podcasts() {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const term = useDebounced(text.trim(), 320);
  const searching = term.length >= 2;
  const top = useQuery<ShowRef[]>('pod:top', (signal) => topShows(signal), { ttl: 6 * HOUR, persist: true });
  const found = useQuery<ShowRef[]>(searching ? 'pod:s:' + term.toLowerCase() : null, (signal) => searchShows(term, signal), { ttl: HOUR });
  const mine = shows.value;

  return (
    <div class="page page-in">
      <header class="page-head"><h1 class="display">Podcasts</h1></header>
      <form class="search-box" role="search" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); input.current?.blur(); }}>
        <SearchIcon size={20} />
        <input ref={input} type="search" value={text} placeholder="Find a podcast" aria-label="Find a podcast" autocomplete="off" spellcheck={false} enterkeyhint="search"
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} />
        {text && <button type="button" class="icon-btn" aria-label="Clear" onClick={() => { setText(''); input.current?.focus(); }}><X size={19} /></button>}
      </form>

      {searching ? (
        <div style={{ marginTop: 24 }}>
          {found.loading && <SkeletonShelf />}
          {found.error && !found.data && <Failed error={found.error} retry={found.reload} />}
          {found.data && (found.data.length ? <ItemGrid items={found.data} /> : <Empty title="No podcasts found" text={`Nothing matches “${term}”.`} />)}
        </div>
      ) : (
        <>
          {mine.length > 0 && <Section title="You follow"><ItemShelf items={mine} small /></Section>}
          <Section title="Popular in India">
            {top.loading && <SkeletonShelf />}
            {top.error && !top.data && <Failed error={top.error} retry={top.reload} />}
            {top.data && <ItemGrid items={top.data} />}
          </Section>
        </>
      )}
    </div>
  );
}

function EpisodeRow(props: { ep: Track; list: Track[]; index: number; from: string }) {
  const ep = props.ep;
  const cur = player.current.value;
  const on = !!cur && cur.id === ep.id;
  const at = episodePos.value[ep.id] || 0;
  const date = ep.date ? new Date(ep.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const left = ep.duration && at > 10 ? Math.max(0, ep.duration - at) : 0;
  const tap = () => { if (on) player.toggle(); else player.playTracks(props.list, props.index, props.from); };
  return (
    <div class={cx('row', on && 'on')} role="button" tabIndex={0} style={{ alignItems: 'flex-start', padding: '12px 8px', containIntrinsicSize: 'auto 96px' }}
      onClick={tap} onKeyDown={(e) => { if (e.key === 'Enter') tap(); }}>
      <div class="row-text">
        <div class="tiny faint">{[date, left ? `${longTime(left)} left` : ep.duration ? longTime(ep.duration) : ''].filter(Boolean).join(' · ')}</div>
        <div class="row-title clip-2" style={{ marginTop: 3 }}>{ep.title}</div>
        {ep.note && <div class="row-sub clip-2" style={{ marginTop: 4 }}>{ep.note}</div>}
      </div>
      <button class="play-btn" style={{ marginTop: 6, width: 38, height: 38 }} aria-label={on && player.playing.value ? 'Pause' : `Play ${ep.title}`}
        onClick={(e) => { e.stopPropagation(); tick(); tap(); }}>
        {on && player.playing.value ? <span class="eqbars live" style={{ position: 'static', background: 'none', padding: 0, height: 14 }}><i style={{ background: 'currentColor' }} /><i style={{ background: 'currentColor' }} /><i style={{ background: 'currentColor' }} /></span> : <Play size={16} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} />}
      </button>
      <button class="icon-btn sm" style={{ marginTop: 6 }} aria-label="More options" onClick={(e) => { e.stopPropagation(); openTrackMenu(ep); }}><Ellipsis size={20} /></button>
    </div>
  );
}

export function ShowPage() {
  const id = route.value.parts[0] || '';
  const q = useQuery<Show>(id ? 'pod:show:' + id : null, (signal) => getShow(id, signal), { ttl: HOUR });
  const s = q.data;
  const following = s ? isShowSaved(s.id) : false;
  const follow = () => {
    if (!s) return;
    const now = toggleShow(s);
    tick(now ? 12 : 6);
    toast(now ? `Following ${s.title}` : `Unfollowed ${s.title}`);
  };
  return (
    <div class="page page-narrow page-in">
      <TopBar title={s?.title} threshold={260} />
      {q.loading && (<><SkeletonHero /><div style={{ marginTop: 28 }}><SkeletonRows count={6} /></div></>)}
      {q.error && !s && <Failed error={q.error} retry={q.reload} />}
      {s && (
        <>
          <div class="hero">
            <Art src={s.image} size={500} eager />
            <div class="hero-text">
              <div class="label">Podcast{s.genre ? ` · ${s.genre}` : ''}</div>
              <h1 class="title" style={{ marginTop: 6 }}>{s.title}</h1>
              <div class="hero-meta">{s.author}</div>
              <div class="hero-actions">
                <button class="btn" disabled={!s.episodes.length} onClick={() => { tick(); player.shuffle.value = false; player.playTracks(s.episodes, 0, s.title); }}>
                  <Play size={18} fill="currentColor" /> Latest episode
                </button>
                <button class={cx('btn outline', following && 'on')} onClick={follow} aria-pressed={following}>
                  {following ? <Check size={18} /> : <Plus size={18} />} {following ? 'Following' : 'Follow'}
                </button>
              </div>
            </div>
          </div>
          <Section title={s.episodes.length ? plural(s.episodes.length, 'recent episode') : 'Episodes'}>
            {s.episodes.length ? (
              <div class="rows">
                {s.episodes.map((ep, i) => <EpisodeRow key={ep.id} ep={ep} list={s.episodes} index={i} from={s.title} />)}
              </div>
            ) : (
              <Empty icon={<Mic size={26} strokeWidth={1.6} />} title="No episodes to play" text="This podcast has no audio episodes available right now." />
            )}
          </Section>
        </>
      )}
    </div>
  );
}
