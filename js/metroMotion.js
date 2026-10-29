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
  function flyIn(elements, stagger, distance) {
    const list = Array.from(elements).filter(el => el && el.nodeType === 1 && !seen.has(el)).slice(0, MAX_ANIMATED);
    list.forEach((el, i) => {
      seen.add(el);
      el.style.setProperty('--metro-x', `${distance}px`);
      el.style.animation = 'none';
      // restart the animation even if the element already ran it once
      void el.offsetWidth;
      el.style.animation = `metroFlyIn 0.42s ${EASE} ${i * stagger}ms both`;
      el.addEventListener('animationend', () => { el.style.animation = ''; el.style.removeProperty('--metro-x'); }, { once: true });
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
    flyIn(pageSections(screen), PAGE_STAGGER_MS, 80);
  }

  // ---- content arriving later (shelves filling, pivots switching) ----------
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
    if (!enabled() || !nodes.length) return;
    // items inside a page that is itself flying in right now already move with their section
    if (Date.now() - lastPageAnimation < 120) return;
    const visible = nodes.filter(el => el.isConnected && el.offsetParent !== null);
    // group by container so each shelf staggers on its own
    const groups = new Map();
    visible.forEach(el => { const key = el.parentElement; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(el); });
    groups.forEach(list => flyIn(list, ITEM_STAGGER_MS, 60));
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
      if (!enabled()) return;
      art.classList.remove('metro-art-in');
      void art.offsetWidth;
      art.classList.add('metro-art-in');
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
