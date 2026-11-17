// Square cards (albums, playlists, artists, podcasts, songs) and the
// sideways-scrolling shelves that hold them.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Play } from 'lucide-preact';
import type { Item } from '../lib/types';
import { canPlay } from '../lib/offline';
import * as player from '../lib/player';
import { to } from '../lib/router';
import { toast } from '../lib/toast';
import { cx, plural } from '../lib/util';
import { isTrack, playItem } from './actions';
import { Art, Link } from './bits';

function describe(item: Item): { title: string; sub: string; href: string | null; round: boolean } {
  if (isTrack(item)) return { title: item.title, sub: item.artist || 'Song', href: null, round: false };
  switch (item.type) {
    case 'album':
      return { title: item.title, sub: [item.artist, item.year].filter(Boolean).join(' · ') || 'Album', href: to.album(item.id), round: false };
    case 'playlist':
      return { title: item.title, sub: item.subtitle || (item.songCount ? plural(item.songCount, 'song') : 'Playlist'), href: to.playlist(item.id), round: false };
    case 'artist':
      return { title: item.name, sub: 'Artist', href: to.artist(item.id), round: true };
    default:
      return { title: item.title, sub: item.author || 'Podcast', href: to.show(item.id), round: false };
  }
}

export function ItemCard(props: { item: Item }) {
  const item = props.item;
  const d = describe(item);
  const song = isTrack(item);
  const cur = player.current.value;
  const on = song && !!cur && cur.id === item.id;
  const away = song && !canPlay(item);
  const art = (
    <Art src={item.image} round={d.round} size={150}>
      {on && <span class={cx('eqbars', player.playing.value && 'live')}><i /><i /><i /></span>}
      {!song && item.type !== 'show' && item.type !== 'artist' && (
        <button
          class="card-play"
          aria-label={`Play ${d.title}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void playItem(item); }}
        >
          <Play size={18} fill="currentColor" />
        </button>
      )}
    </Art>
  );
  const text = (
    <>
      <div class="card-title clip-2">{d.title}</div>
      <div class="card-sub clip">{d.sub}</div>
    </>
  );
  if (d.href) {
    return <Link to={d.href} class={cx('card', d.round && 'center')}>{art}{text}</Link>;
  }
  return (
    <button class={cx('card', away && 'away')} onClick={() => {
      if (away && !on) { toast("You're offline. This one isn't downloaded."); return; }
      if (on) player.toggle(); else void playItem(item);
    }}>
      {art}{text}
    </button>
  );
}

/** A row of cards that scrolls sideways, with arrow buttons for mouse users. */
export function Shelf(props: { children: ComponentChildren; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: true, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const left = el.scrollLeft <= 4;
      const right = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);

  const page = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.82), behavior: 'smooth' });
  };

  return (
    <div class="shelf-wrap">
      <button class="shelf-arrow left" disabled={edge.left} onClick={() => page(-1)} aria-label="Scroll back" tabIndex={-1}><ChevronLeft size={20} /></button>
      <div ref={ref} class={cx('shelf', props.small && 'small')}>{props.children}</div>
      <button class="shelf-arrow right" disabled={edge.right} onClick={() => page(1)} aria-label="Scroll forward" tabIndex={-1}><ChevronRight size={20} /></button>
    </div>
  );
}

export function ItemShelf(props: { items: Item[]; small?: boolean }) {
  return (
    <Shelf small={props.small}>
      {props.items.map((item) => (
        <ItemCard key={(isTrack(item) ? 'song' : item.type) + item.id} item={item} />
      ))}
    </Shelf>
  );
}

export function ItemGrid(props: { items: Item[] }) {
  return (
    <div class="grid">
      {props.items.map((item) => (
        <ItemCard key={(isTrack(item) ? 'song' : item.type) + item.id} item={item} />
      ))}
    </div>
  );
}

export function Section(props: { title: string; more?: string; children: ComponentChildren }) {
  return (
    <section class="section">
      <div class="section-head">
        <h2 class="heading clip">{props.title}</h2>
        {props.more && <Link to={props.more} class="more">See all</Link>}
      </div>
      {props.children}
    </section>
  );
}
