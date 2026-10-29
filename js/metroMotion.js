// ==========================================================================
// MUSICFLOW — METRO MOTION (the Windows 8.1 / Xbox Music feel)
//  • Fly-in: when a page opens, its sections glide in from the right one after
//    another; when a shelf or list fills with content, its tiles do the same.
//  • Tilt: tiles, rows and buttons tilt toward the finger while pressed.
//  • Turnstile: album and artist pages swing in around their left edge.
//  • Artwork crossfade in Now Playing when the song changes.
//  Everything is transform + opacity only, skipped in performance-lite mode and
//  when the phone asks for reduced motion.
// ==========================================================================

const MetroMotion = (() => {
  const EASE = 'cubic-bezier(0.1, 0.9, 0.2, 1)';
  const PAGE_STAGGER_MS = 55;
  const ITEM_STAGGER_MS = 40;
  const MAX_ANIMATED = 14;

  const TILE_SELECTOR = [
    '.music-square-card', '.listen-again-item', '.quick-pick-item', '.vertical-track-row', '.numbered-track-row',
    '.playlist-track-row', '.queue-track-item', '.track-row', '.search-cat-card', '.radio-station', '.radio-genre-row',
    '.daily-mix-card', '.playlist-rich-card', '.album-rich-card', '.artist-recent-card', '.search-top-result',
    '.lib-row', '.nav-tab', '.nav-extra', '.mood-chip', '.lib-tab-btn', '.detail-play-btn', '.detail-action-pill',
    '.sheet-action-item', '.settings-row', '.swipe-card', '.radio-hero', '.best-match-card', '.similar-artist-card',
    '.artist-circle-card', '.search-pill-btn', '.search-cat-chip'
  ].join(',');

  const ITEM_CONTAINERS = [
    '.cards-horizontal-shelf', '.ytm-listen-again-grid', '.quick-picks-carousel', '.quick-picks-column',
    '.vertical-tracks-shelf', '.daily-mixes-shelf', '.search-categories-grid', '.radio-station-row',
    '.radio-genre-list', '.playlists-cards-grid', '.albums-cards-grid', '.lib-recent-grid', '.search-songs',
    '.search-results-area', '.queue-tracks-list', '.detail-tracks-list', '#library-tab-content', '#radio-screen-body',
    '.artist-section-wrap', '.swipe-card-stack', '#drawer-related-tracks', '.library-tab-content', '.search-section'
  ].join(',');

  const seen = new WeakSet();
  let lastPageAnimation = 0;

  function enabled() {
    if (typeof document === 'undefined' || !document.body) return false;
    if (document.body.classList.contains('perf-lite')) return false;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (_) {}
    return true;
  }

  // ---- fly-in ---------------------------------------------------------------
  // Web Animations with fill "backwards": the element's own style never changes, so if the
  // animation is paused (background tab), cancelled or interrupted, the element is simply visible.
  function flyIn(elements, stagger, distance, force) {
    const list = Array.from(elements).filter(el => el && el.nodeType === 1 && (force || !seen.has(el))).slice(0, MAX_ANIMATED);
    if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return 0;
    list.forEach((el, i) => {
      seen.add(el);
      try {
        const delay = i * stagger;
        const anim = el.animate(
          [{ opacity: 0, transform: `translateX(${distance}px)` }, { opacity: 1, transform: 'none' }],
          { duration: 420, delay, easing: EASE, fill: 'backwards' }
        );
        anim.onfinish = () => { try { anim.cancel(); } catch (_) {} };
        setTimeout(() => { try { anim.cancel(); } catch (_) {} }, 420 + delay + 1500);   // belt and braces
      } catch (_) {}
    });
    return list.length;
  }

  function pageSections(screen) {
    const out = [];
    Array.from(screen.children).forEach(child => {
      if (child.matches('.home-feed-sections, .library-tab-content, #radio-screen-body, .explore-section, .search-discovery-hub, .artist-sections')) {
        Array.from(child.children).forEach(c => out.push(c));
      } else {
        out.push(child);
      }
    });
    return out.filter(el => el.offsetParent !== null || el.offsetHeight > 0);
  }

  function animatePage() {
    if (!enabled()) return;
    const screen = document.querySelector('.screen.active');
    if (!screen) return;
    lastPageAnimation = Date.now();
    slideIn(screen, 90, 360);
    flyIn(pageSections(screen), PAGE_STAGGER_MS, 80, true);
  }

  // the Windows 8 page transition: the whole page glides in from the right
  function slideIn(el, distance, duration) {
    if (!el || typeof el.animate !== 'function') return;
    try {
      const anim = el.animate([{ transform: `translateX(${distance}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration, easing: EASE, fill: 'backwards' });
      anim.onfinish = () => { try { anim.cancel(); } catch (_) {} };
      setTimeout(() => { try { anim.cancel(); } catch (_) {} }, duration + 1200);
    } catch (_) {}
  }

  // pivots the user switches by hand always animate (Collection tabs, Radio, detail lists, the drawer panes)
  const PIVOT_CONTAINERS = '#library-tab-content, .library-tab-content, #radio-screen-body, .detail-tracks-list, #drawer-related-tracks, .queue-tracks-list, .artist-section-wrap';
  function pivotRoot(container) {
    return container.closest(PIVOT_CONTAINERS);
  }

  // ---- content arriving later (shelves filling, pivots switching) ----------
  // A shelf flies in the first time it fills. When its content is merely replaced a moment later
  // (Home renders its cache first, then the fresh feed; a pivot is re-rendered) it must NOT fly in
  // again: that re-run read as flicker. Each container therefore animates once, and again only
  // after it has been quiet for a while. Home shelves never re-animate on a refresh.
  const REFILL_QUIET_MS = 20000;
  const containerAnimatedAt = new WeakMap();
  let pending = new Set();
  let flushTimer = null;

  function queueAdded(nodes) {
    nodes.forEach(n => {
      if (n.nodeType !== 1) return;
      const parent = n.parentElement;
      if (!parent || !parent.closest(ITEM_CONTAINERS)) return;
      if (n.matches('.loading-shimmer-card, .loading-shimmer-row, script, style')) return;
      pending.add(n);
    });
    if (pending.size && !flushTimer) flushTimer = setTimeout(flushAdded, 16);
  }

  function flushAdded() {
    flushTimer = null;
    const nodes = Array.from(pending); pending = new Set();
    if (!nodes.length) return;
    const now = Date.now();
    // group by container so each shelf staggers on its own
    const groups = new Map();
    nodes.forEach(el => {
      if (!el.isConnected) return;
      const key = el.parentElement;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    });
    const pageJustAnimated = now - lastPageAnimation < 120;   // items already move with their section
    const pivotsDone = new Set();
    groups.forEach((list, container) => {
      const last = containerAnimatedAt.get(container) || 0;
      const onHome = !!container.closest('#screen-home');
      const pivot = onHome ? null : pivotRoot(container);
      if (pivot && !pageJustAnimated && enabled() && !document.hidden) {
        list.forEach(el => seen.add(el));
        containerAnimatedAt.set(container, now);
        if (!pivotsDone.has(pivot)) {
          pivotsDone.add(pivot);
          slideIn(pivot, 60, 320);
          flyIn(list.filter(el => el.offsetParent !== null), ITEM_STAGGER_MS, 40, true);
        }
        return;
      }
      const refill = last && (onHome || now - last < REFILL_QUIET_MS);
      if (pageJustAnimated || refill || !enabled() || document.hidden) {
        list.forEach(el => seen.add(el));
        if (!last) containerAnimatedAt.set(container, now);
        return;
      }
      const visible = list.filter(el => el.offsetParent !== null);
      containerAnimatedAt.set(container, now);
      if (visible.length) flyIn(visible, ITEM_STAGGER_MS, 60);
    });
  }

  function watchContent() {
    const main = document.getElementById('main-scroll-container') || document.body;
    const drawer = document.getElementById('player-sliding-drawer');
    const obs = new MutationObserver(records => {
      records.forEach(r => { if (r.addedNodes && r.addedNodes.length) queueAdded(r.addedNodes); });
    });
    obs.observe(main, { childList: true, subtree: true });
    if (drawer) obs.observe(drawer, { childList: true, subtree: true });
  }

  // ---- tilt on press ----------------------------------------------------------
  let tilted = null;

  function tiltStart(e) {
    if (!enabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target.closest(TILE_SELECTOR);
    if (!el || el.closest('.is-dragging')) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    const big = r.width > 420;
    const max = big ? 3 : 9;
    el.classList.add('metro-tilting');
    el.style.transform = `perspective(700px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) scale(0.975)`;
    tilted = el;
  }

  function tiltEnd() {
    if (!tilted) return;
    const el = tilted; tilted = null;
    el.style.transform = '';
    setTimeout(() => el.classList.remove('metro-tilting'), 220);
  }

  function watchTilt() {
    document.addEventListener('pointerdown', tiltStart, { passive: true });
    ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, tiltEnd, { passive: true }));
    document.addEventListener('pointerleave', tiltEnd, { passive: true });
    window.addEventListener('blur', tiltEnd);
    document.addEventListener('scroll', tiltEnd, { passive: true, capture: true });
  }

  // ---- Now Playing artwork crossfade -----------------------------------------
  function watchArtwork() {
    const art = document.getElementById('full-player-art');
    if (!art) return;
    const obs = new MutationObserver(() => {
      if (!enabled() || typeof art.animate !== 'function') return;
      try {
        const anim = art.animate([{ opacity: 0.35, transform: 'scale(1.04)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: EASE });
        anim.onfinish = () => { try { anim.cancel(); } catch (_) {} };
      } catch (_) {}
    });
    obs.observe(art, { attributes: true, attributeFilter: ['src'] });
  }

  // ---- setup -----------------------------------------------------------------
  function init() {
    if (typeof window === 'undefined' || !document.body || document.body._metroMotion) return;
    document.body._metroMotion = true;
    // navigate() dispatches this after the new page is active; animate at once (rAF can lag on a throttled tab)
    window.addEventListener('mf_screen_change', () => { try { animatePage(); } catch (_) {} });
    watchContent();
    watchTilt();
    watchArtwork();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      try { (document.getAnimations ? document.getAnimations() : []).forEach(a => { try { a.cancel(); } catch (_) {} }); } catch (_) {}
    });
    setTimeout(animatePage, 0);
  }

  return { init, animatePage, flyIn };
})();

if (typeof window !== 'undefined') {
  window.MetroMotion = MetroMotion;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => MetroMotion.init());
  else MetroMotion.init();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MetroMotion;
}
