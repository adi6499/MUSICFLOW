// ============================================================================
// MUSICFLOW — AMBIENT / LOCK-SCREEN MODE
// A full-screen "lock screen" view inside the app: big clock and date, circular
// artwork, title/artist, progress with times, three large glass transport
// buttons. Tapping the artwork morphs it into a full-bleed wallpaper behind a
// "Music" header; tapping again returns to the clock view. Keeps the screen
// awake while open (Wake Lock API where available) and stays in sync with the
// Player through its events. Purely additive: nothing here is required by playback.
// ============================================================================

const AmbientScreen = (() => {
  let root, bg, timeEl, dateEl, artEl, titleEl, artistEl, fillEl, curEl, totEl, playIcon, likeIcon;
  let clockTimer = null;
  let wakeLock = null;
  let isOpen = false;
  let wired = false;

  function $(id) { return document.getElementById(id); }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function artworkOf(song) {
    if (!song) return 'assets/logo.png';
    try {
      if (typeof API !== 'undefined' && typeof API.getImageUrl === 'function') {
        const u = API.getImageUrl(song);
        if (u) return u;
      }
    } catch (_) {}
    const img = song.image;
    if (Array.isArray(img) && img.length) { const b = img[img.length - 1]; return (b && (b.url || b.link)) || 'assets/logo.png'; }
    if (img && typeof img === 'object') return img.url || img.link || 'assets/logo.png';
    return (typeof img === 'string' && img) ? img : 'assets/logo.png';
  }

  function artistOf(song) {
    if (!song) return '';
    try {
      if (typeof DataNormalizer !== 'undefined' && DataNormalizer.getArtistString) return DataNormalizer.getArtistString(song);
    } catch (_) {}
    return String(song.primaryArtists || song.primaryArtist || song.artists || song.artist || '');
  }

  function titleOf(song) {
    if (!song) return '';
    try {
      if (typeof DataNormalizer !== 'undefined' && DataNormalizer.getTrackTitle) return DataNormalizer.getTrackTitle(song);
    } catch (_) {}
    return String(song.name || song.title || '');
  }

  function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    if (timeEl) timeEl.textContent = `${hh}:${mm}`;
    if (dateEl) {
      let weekday = 'Today';
      try { weekday = now.toLocaleDateString(undefined, { weekday: 'long' }); } catch (_) {}
      dateEl.textContent = `${now.getDate()} ${weekday}`;
    }
  }

  function updateTrack(song) {
    const s = song || ((typeof Player !== 'undefined' && Player.getCurrentTrack) ? Player.getCurrentTrack() : null);
    const art = artworkOf(s);
    if (artEl && artEl.getAttribute('src') !== art) artEl.src = art;
    if (bg) bg.style.backgroundImage = `url("${art.replace(/"/g, '%22')}")`;
    if (titleEl) titleEl.textContent = titleOf(s) || 'Nothing playing';
    if (artistEl) artistEl.textContent = artistOf(s);
    updateLike(s);
  }

  function updateLike(song) {
    if (!likeIcon) return;
    let fav = false;
    try {
      if (song && typeof Storage !== 'undefined') {
        if (typeof Storage.isFavorite === 'function') fav = !!Storage.isFavorite(song.id);
        else if (typeof Storage.getFavorites === 'function') fav = (Storage.getFavorites() || []).some(f => f && String(f.id) === String(song.id));
      }
    } catch (_) {}
    likeIcon.textContent = fav ? 'favorite' : 'favorite_border';
    likeIcon.classList.toggle('is-on', fav);
  }

  function updateState(state) {
    const st = state || ((typeof Player !== 'undefined' && Player.getState) ? Player.getState() : null);
    const playing = !!(st && st.isPlaying);
    if (playIcon) playIcon.textContent = playing ? 'pause' : 'play_arrow';
    if (root) root.classList.toggle('is-playing', playing);
  }

  function updateTime(payload) {
    let cur = 0, dur = 0;
    if (payload && typeof payload.currentTime === 'number') { cur = payload.currentTime; dur = payload.duration || 0; }
    else if (typeof Player !== 'undefined' && Player.getState) { const st = Player.getState(); cur = st.position || 0; dur = st.duration || 0; }
    if (!dur && typeof Player !== 'undefined' && Player.getCurrentTrack) { const t = Player.getCurrentTrack(); if (t && t.duration) dur = Number(t.duration) || 0; }
    const pct = dur > 0 ? Math.max(0, Math.min(100, (cur / dur) * 100)) : 0;
    if (fillEl) fillEl.style.width = `${pct.toFixed(2)}%`;
    if (curEl) curEl.textContent = fmt(cur);
    if (totEl) totEl.textContent = fmt(dur);
  }

  function seekFromEvent(ev) {
    try {
      const bar = $('ambient-progress');
      if (!bar || typeof Player === 'undefined' || !Player.seekPercent) return;
      const r = bar.getBoundingClientRect();
      const x = (ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX) - r.left;
      const pct = Math.max(0, Math.min(100, (x / r.width) * 100));
      Player.seekPercent(pct);
      updateTime();
    } catch (_) {}
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) { wakeLock = null; }
  }

  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); } } catch (_) {}
    wakeLock = null;
  }

  function wire() {
    if (wired) return;
    wired = true;
    root = $('ambient-screen');
    if (!root) return;
    bg = $('ambient-bg'); timeEl = $('ambient-time'); dateEl = $('ambient-date'); artEl = $('ambient-art');
    titleEl = $('ambient-title'); artistEl = $('ambient-artist'); fillEl = $('ambient-progress-fill');
    curEl = $('ambient-time-cur'); totEl = $('ambient-time-total'); playIcon = $('ambient-play-icon'); likeIcon = $('ambient-like-icon');

    if (typeof Player !== 'undefined' && typeof Player.on === 'function') {
      try {
        Player.on('trackChange', (song) => { if (isOpen) updateTrack(song); });
        Player.on('stateChange', (st) => { if (isOpen) { updateState(st); updateLike(st && st.currentTrack); } });
        Player.on('timeUpdate', (p) => { if (isOpen) updateTime(p); });
      } catch (_) {}
    }

    document.addEventListener('keydown', (e) => { if (isOpen && e.key === 'Escape') close(); });
    document.addEventListener('visibilitychange', () => { if (isOpen && !document.hidden) requestWakeLock(); });

    // Swipe down anywhere on the screen (outside the controls) closes it
    let startY = null;
    root.addEventListener('touchstart', (e) => { startY = e.touches && e.touches[0] ? e.touches[0].clientY : null; }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (startY == null) return;
      const endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : startY;
      if (endY - startY > 110 && !e.target.closest('.ambient-controls, .ambient-progress')) close();
      startY = null;
    }, { passive: true });
  }

  function open() {
    wire();
    if (!root) return;
    const hasTrack = (typeof Player !== 'undefined' && Player.getCurrentTrack) ? !!Player.getCurrentTrack() : false;
    if (!hasTrack && typeof UI !== 'undefined' && UI.showToast) { UI.showToast('Play something first'); return; }
    isOpen = true;
    root.classList.remove('expanded');
    root.setAttribute('aria-hidden', 'false');
    updateClock(); updateTrack(); updateState(); updateTime();
    clearInterval(clockTimer);
    clockTimer = setInterval(updateClock, 15000);
    requestAnimationFrame(() => root.classList.add('open'));
    document.body.classList.add('ambient-open');
    requestWakeLock();
  }

  function close() {
    if (!root || !isOpen) return;
    isOpen = false;
    root.classList.remove('open', 'expanded');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ambient-open');
    clearInterval(clockTimer);
    clockTimer = null;
    releaseWakeLock();
  }

  function toggleExpand() {
    if (!root || !isOpen) return;
    root.classList.toggle('expanded');
  }

  function toggle() { isOpen ? close() : open(); }

  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') setTimeout(wire, 300);
    else window.addEventListener('load', () => setTimeout(wire, 300));
  }

  return { open, close, toggle, toggleExpand, seekFromEvent, isOpen: () => isOpen };
})();

if (typeof window !== 'undefined') {
  window.AmbientScreen = AmbientScreen;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AmbientScreen;
}
