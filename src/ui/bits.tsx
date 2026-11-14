// Small shared pieces: artwork, links, the sticky top bar, loading and empty states.

import type { ComponentChildren, TargetedMouseEvent } from 'preact';
import { ArrowLeft, CloudOff, LoaderCircle, Music2, RotateCw } from 'lucide-preact';
import { back, go } from '../lib/router';
import { cx, img } from '../lib/util';
import { useScrolled } from './hooks';

export function Art(props: {
  src?: string;
  /** Which stored size to fetch. Rows use 150 (sharp on dense screens); heroes use 500. */
  size?: 50 | 150 | 500;
  round?: boolean;
  class?: string;
  eager?: boolean;
  alt?: string;
  children?: ComponentChildren;
}) {
  const url = img(props.src, props.size ?? 150);
  return (
    <span class={cx('art', props.round && 'round', props.class)}>
      <span class="art-fallback" aria-hidden="true"><Music2 size={22} strokeWidth={1.6} /></span>
      {url && (
        <img
          key={url}
          src={url}
          alt={props.alt ?? ''}
          loading={props.eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={(e) => (e.currentTarget as HTMLImageElement).classList.add('ready')}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {props.children}
    </span>
  );
}

/** A link that changes screen without reloading. Still a real link, so "open in new tab" works. */
export function Link(props: { to: string; class?: string; children?: ComponentChildren; label?: string; onClick?: () => void }) {
  const click = (e: TargetedMouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    props.onClick?.();
    go(props.to);
  };
  return (
    <a href={'#' + props.to} class={props.class} aria-label={props.label} onClick={click} draggable={false}>
      {props.children}
    </a>
  );
}

/** Sticky bar for inner screens. The title fades in once the big heading has scrolled away. */
export function TopBar(props: { title?: string; children?: ComponentChildren; threshold?: number }) {
  const stuck = useScrolled(props.threshold ?? 120);
  return (
    <div class={cx('topbar', stuck && 'stuck')}>
      <button class="icon-btn" onClick={back} aria-label="Back"><ArrowLeft size={22} /></button>
      {props.title ? <div class="topbar-title clip">{props.title}</div> : <div class="spacer" />}
      {props.children}
    </div>
  );
}

export function Spinner(props: { size?: number }) {
  return <LoaderCircle class="spin" size={props.size ?? 20} aria-label="Loading" />;
}

export function Empty(props: { icon?: ComponentChildren; title: string; text?: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      {props.icon && <div class="empty-ico">{props.icon}</div>}
      <h3>{props.title}</h3>
      {props.text && <p>{props.text}</p>}
      {props.children}
    </div>
  );
}

export function Failed(props: { error: Error; retry: () => void }) {
  return (
    <Empty icon={<CloudOff size={26} strokeWidth={1.6} />} title="That didn't load" text={props.error.message}>
      <button class="btn quiet" onClick={props.retry}><RotateCw size={17} /> Try again</button>
    </Empty>
  );
}

export function SkeletonRows(props: { count?: number }) {
  return (
    <div class="rows" aria-hidden="true">
      {Array.from({ length: props.count ?? 6 }, (_, i) => (
        <div class="row" key={i} style={{ pointerEvents: 'none' }}>
          <span class="art skel" style={{ width: 48 }} />
          <div class="row-text">
            <div class="skel line" style={{ width: `${46 + ((i * 17) % 34)}%` }} />
            <div class="skel line" style={{ width: `${24 + ((i * 11) % 22)}%`, marginTop: 9, height: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonShelf(props: { count?: number; small?: boolean }) {
  return (
    <div class="shelf-wrap" aria-hidden="true">
      <div class={cx('shelf', props.small && 'small')} style={{ overflow: 'hidden' }}>
        {Array.from({ length: props.count ?? 6 }, (_, i) => (
          <div key={i}>
            <div class="skel" style={{ aspectRatio: '1', borderRadius: 13 }} />
            <div class="skel line" style={{ width: '78%', marginTop: 11 }} />
            <div class="skel line" style={{ width: '48%', marginTop: 8, height: 10 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div class="hero" aria-hidden="true">
      <span class="art skel" />
      <div class="hero-text" style={{ width: 'min(100%, 340px)' }}>
        <div class="skel line" style={{ height: 30, width: '82%', margin: '0 auto 14px' }} />
        <div class="skel line" style={{ width: '52%', margin: '0 auto' }} />
      </div>
    </div>
  );
}
