// ============================================================================
// MUSICFLOW — MOTION & INTERACTIONS (Apple Music feel)
//  1. Interactive drag: mini player ↑ opens Now Playing, Now Playing ↓ closes it
//     (follows the finger, velocity-aware, spring settle, tab bar slides away).
//  2. Collapsing Large Titles: 34pt title → inline 17pt glass bar on scroll.
//  3. Kinetic lyrics extras: vocal glow timing, long-press action sheet, "Now" pill.
//  4. Hold-to-scrub on previous / next (2×, then 4× after 2 s).
//  5. Haptics table (tab change, play/pause, like, sheet commit, scrub ticks, menus).
//  6. Queue swipe actions: swipe right = Play next, swipe left = Remove.
//  7. Artwork-tinted shadows on album / playlist covers.
// Pure helpers (decideCommit, velocityOf) are exported for the unit tests.
// ============================================================================

const Motion = (() => {
  const SPRING = 'transform 0.52s cubic-bezier(0.32, 1.25, 0.5, 1)';
  const OPEN_DISTANCE_RATIO = 0.6;      // full drag = 60 % of the viewport height
  const COMMIT_PROGRESS = 0.35;
  const COMMIT_VELOCITY = 0.5;          // px / ms
  const HOLD_MS = 400;
  const LONG_PRESS_MS = 450;

  const haptic = (ms) => {
    try {
      if (typeof App !== 'undefined' && typeof App.triggerHaptic === 'function') App.triggerHaptic(ms);
      else if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
    } catch (_) {}
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = () => {
    try { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  };

  /** Commit when the gesture went far enough OR fast enough. */
  function decideCommit(progress, velocity) {
    return progress >= COMMIT_PROGRESS || velocity >= COMMIT_VELOCITY;
  }

  /** Velocity (px/ms) from the last samples of a gesture, positive in the gesture direction. */
  function velocityOf(samples) {
    if (!samples || samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    let i = samples.length - 2;
    while (i > 0 && last.t - samples[i].t < 60) i--;
    const first = samples[i];
    const dt = Math.max(1, last.t - first.t);
    return (last.d - first.d) / dt;
  }

  // --------------------------------------------------------------------------
  // 1. Interactive Now Playing sheet
  // --------------------------------------------------------------------------
  let sheet, mini, tabBar, artView;
  let suppressMiniClickUntil = 0;

  function sheetParts() {
    sheet = sheet || document.getElementById('full-player');
    mini = mini || document.getElementById('mini-player');
    tabBar = tabBar || document.getElementById('floating-bottom-nav');
    artView = artView || document.getElementById('player-art-view');
    return !!(sheet && mini);
  }

  function setDragVisuals(p) {
    // p: 0 = closed, 1 = fully open
    const vh = window.innerHeight || 800;
    sheet.style.transition = 'none';
    sheet.style.transform = `translate3d(0, ${(1 - p) * vh}px, 0)`;
    if (tabBar) { tabBar.style.transition = 'none'; tabBar.style.transform = `translateY(${p * 110}%)`; }
    mini.style.transition = 'none';
    mini.style.opacity = String(clamp(1 - p / 0.3, 0, 1));
    if (artView) { artView.style.transition = 'none'; artView.style.transform = `scale(${0.8 + 0.2 * p})`; }
  }

  function clearDragVisuals(opening) {
    sheet.style.transition = SPRING;
    sheet.style.transform = '';
    if (tabBar) { tabBar.style.transition = SPRING; tabBar.style.transform = ''; }
    mini.style.transition = 'opacity 0.25s ease';
    mini.style.opacity = '';
    if (artView) { artView.style.transition = ''; artView.style.transform = ''; }
    setTimeout(() => { if (sheet) sheet.style.transition = ''; if (tabBar) tabBar.style.transition = ''; }, 560);
    void opening;
  }

  function setupMiniDrag() {
    if (!sheetParts() || mini._mfDrag) return;
    mini._mfDrag = true;
    let y0 = 0, x0 = 0, dragging = false, samples = [];

    mini.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dragging = false; samples = [{ d: 0, t: performance.now() }];
    }, { passive: true });

    mini.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      const dy = y0 - e.touches[0].clientY;
      const dx = Math.abs(e.touches[0].clientX - x0);
      if (!dragging) {
        if (dy > 8 && dy > dx) { dragging = true; sheet.classList.add('is-dragging'); }
        else return;
      }
      if (e.cancelable) e.preventDefault();
      samples.push({ d: dy, t: performance.now() });
      const p = clamp(dy / ((window.innerHeight || 800) * OPEN_DISTANCE_RATIO), 0, 1);
      setDragVisuals(p);
    }, { passive: false });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('is-dragging');
      const dy = samples[samples.length - 1].d;
      const p = clamp(dy / ((window.innerHeight || 800) * OPEN_DISTANCE_RATIO), 0, 1);
      const v = velocityOf(samples);
      suppressMiniClickUntil = performance.now() + 350;
      if (decideCommit(p, v)) {
        clearDragVisuals(true);
        if (typeof App !== 'undefined' && App.expandFullPlayer) App.expandFullPlayer();
        haptic(10);
      } else {
        clearDragVisuals(false);
      }
    };
    mini.addEventListener('touchend', end, { passive: true });
    mini.addEventListener('touchcancel', end, { passive: true });

    // A drag must not also fire the tap-to-open handler
    mini.addEventListener('click', (e) => {
      if (performance.now() < suppressMiniClickUntil) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }

  function setupSheetDrag() {
    if (!sheetParts() || sheet._mfDrag) return;
    sheet._mfDrag = true;
    let y0 = 0, x0 = 0, dragging = false, samples = [], allowed = false;

    sheet.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || !sheet.classList.contains('expanded')) { allowed = false; return; }
      const t = e.target;
      const drawer = document.getElementById('player-sliding-drawer');
      allowed = !(t.closest && (t.closest('.player-custom-seek-bar') || t.closest('.ytm-player-drawer') || t.closest('.lyrics-scroll-container')))
        && !(drawer && drawer.classList.contains('expanded'));
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dragging = false; samples = [{ d: 0, t: performance.now() }];
    }, { passive: true });

    sheet.addEventListener('touchmove', (e) => {
      if (!allowed || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - y0;
      const dx = Math.abs(e.touches[0].clientX - x0);
      if (!dragging) {
        if (dy > 10 && dy > dx * 1.5) { dragging = true; sheet.classList.add('is-dragging'); }
        else return;
      }
      if (e.cancelable) e.preventDefault();
      samples.push({ d: dy, t: performance.now() });
      sheet.style.transition = 'none';
      sheet.style.transform = `translate3d(0, ${Math.max(0, dy)}px, 0)`;
    }, { passive: false });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('is-dragging');
      const dy = Math.max(0, samples[samples.length - 1].d);
      const p = clamp(dy / ((window.innerHeight || 800) * OPEN_DISTANCE_RATIO), 0, 1);
      const v = velocityOf(samples);
      sheet.style.transition = SPRING;
      if (decideCommit(p, v)) {
        sheet.style.transform = 'translate3d(0, 100%, 0)';
        haptic(10);
        setTimeout(() => {
          if (typeof App !== 'undefined' && App.collapseFullPlayer) App.collapseFullPlayer();
          sheet.style.transition = '';
        }, 500);
      } else {
        sheet.style.transform = '';
        setTimeout(() => { sheet.style.transition = ''; }, 560);
      }
    };
    sheet.addEventListener('touchend', end, { passive: true });
    sheet.addEventListener('touchcancel', end, { passive: true });
  }

  // --------------------------------------------------------------------------
  // 2. Collapsing Large Titles
  // --------------------------------------------------------------------------
  const INLINE_TITLE_SCREENS = { explore: 'New', radio: 'Radio', library: 'Library' };

  function setupCollapsingTitles() {
    const main = document.getElementById('main-scroll-container');
    const bar = document.getElementById('inline-title-bar');
    const text = document.getElementById('inline-title-text');
    if (!main || main._mfCollapse) return;
    main._mfCollapse = true;
    let collapsed = false;
    const update = () => {
      const active = document.querySelector('.screen.active');
      const id = active ? active.id.replace('screen-', '') : 'home';
      const shouldCollapse = main.scrollTop > 40;
      if (shouldCollapse !== collapsed) {
        collapsed = shouldCollapse;
        document.body.classList.toggle('title-collapsed', collapsed);
      }
      if (bar && text) {
        const label = INLINE_TITLE_SCREENS[id];
        const show = collapsed && !!label && !document.body.classList.contains('lib-section-open');
        if (label) text.textContent = label;
        bar.classList.toggle('visible', show);
      }
    };
    main.addEventListener('scroll', update, { passive: true });
    window.addEventListener('mf_screen_change', update);
    update();
  }

  function scrollToTop() {
    const main = document.getElementById('main-scroll-container');
    if (!main) return;
    try { main.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (_) { main.scrollTop = 0; }
  }

  // --------------------------------------------------------------------------
  // 3. Kinetic lyrics: long-press action sheet + "Now" pill
  // --------------------------------------------------------------------------
  let lyricLine = null;

  function setupLyricsInteractions() {
    ['drawer-lyrics-scroll', 'lyrics-scroll-container'].forEach(id => {
      const c = document.getElementById(id);
      if (!c || c._mfLyrics) return;
      c._mfLyrics = true;
      let timer = null, startY = 0, startX = 0;
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      c.addEventListener('touchstart', (e) => {
        const line = e.target.closest && e.target.closest('.lyrics-line[data-time]');
        if (!line || e.touches.length !== 1) return;
        startY = e.touches[0].clientY; startX = e.touches[0].clientX;
        cancel();
        timer = setTimeout(() => { timer = null; openLyricSheet(line); }, LONG_PRESS_MS);
      }, { passive: true });
      c.addEventListener('touchmove', (e) => {
        if (!timer || e.touches.length !== 1) return;
        if (Math.abs(e.touches[0].clientY - startY) > 8 || Math.abs(e.touches[0].clientX - startX) > 8) cancel();
      }, { passive: true });
      c.addEventListener('touchend', cancel, { passive: true });
      c.addEventListener('touchcancel', cancel, { passive: true });
      c.addEventListener('contextmenu', (e) => {
        const line = e.target.closest && e.target.closest('.lyrics-line[data-time]');
        if (line) { e.preventDefault(); openLyricSheet(line); }
      });

      // "Now" pill while the user is reading ahead
      const pane = c.parentElement;
      if (pane && !pane.querySelector('.lyrics-now-pill')) {
        const pill = document.createElement('button');
        pill.className = 'lyrics-now-pill';
        pill.innerHTML = '<span class="material-symbols-outlined fill-icon">play_arrow</span><span>Now</span>';
        pill.addEventListener('click', () => {
          c._userIsScrolling = false;
          const pos = (typeof Player !== 'undefined' && Player.getPosition) ? Player.getPosition() : 0;
          if (typeof Lyrics !== 'undefined' && Lyrics.updateTime) Lyrics.updateTime(pos, true);
          pill.classList.remove('visible');
          haptic(8);
        });
        pane.appendChild(pill);
        let hideTimer = null;
        c.addEventListener('scroll', () => {
          if (!c._userIsScrolling) return;   // programmatic scroll
          pill.classList.add('visible');
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => pill.classList.remove('visible'), 4000);
        }, { passive: true });
      }
    });
  }

  function openLyricSheet(line) {
    if (!line || line.classList.contains('lyrics-breather')) return;   // nothing to copy or share
    lyricLine = line;
    const quote = document.getElementById('lyric-sheet-quote');
    if (quote) quote.textContent = (line.textContent || '').trim();
    haptic(14);
    if (typeof App !== 'undefined' && App.openBottomSheet) App.openBottomSheet('sheet-lyric-actions');
    else { const el = document.getElementById('sheet-lyric-actions'); if (el) el.classList.add('active'); }
  }

  function lyricAction(action) {
    const text = lyricLine ? (lyricLine.textContent || '').trim() : '';
    const time = lyricLine ? parseFloat(lyricLine.dataset.time) : NaN;
    if (typeof App !== 'undefined' && App.closeBottomSheet) App.closeBottomSheet('sheet-lyric-actions');
    const track = (typeof Player !== 'undefined' && Player.getCurrentTrack) ? Player.getCurrentTrack() : null;
    const title = track ? `${track.name || track.title || ''} — ${track.artists || track.primaryArtist || ''}` : '';
    if (action === 'play') {
      if (!isNaN(time) && typeof Player !== 'undefined' && Player.seek) { Player.seek(time); if (Player.play) Player.play(); }
    } else if (action === 'copy') {
      copyText(`"${text}"\n${title}`.trim());
      if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Lyric copied');
    } else if (action === 'share') {
      const payload = { title: 'MusicFlow', text: `"${text}"\n${title}`.trim() };
      if (typeof navigator !== 'undefined' && navigator.share) navigator.share(payload).catch(() => {});
      else { copyText(payload.text); if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Lyric copied — paste it anywhere'); }
    }
  }

  function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return; } } catch (_) {}
    try {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // 4. Hold-to-scrub on previous / next
  // --------------------------------------------------------------------------
  function setupHoldToScrub() {
    [['btn-player-next', 1], ['btn-player-prev', -1]].forEach(([id, dir]) => {
      const btn = document.getElementById(id);
      if (!btn || btn._mfHold) return;
      btn._mfHold = true;
      let holdTimer = null, tick = null, held = false, startedAt = 0;
      const stop = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (tick) { clearInterval(tick); tick = null; }
      };
      const start = () => {
        stop(); held = false;
        holdTimer = setTimeout(() => {
          held = true; startedAt = performance.now(); haptic(10);
          tick = setInterval(() => {
            if (typeof Player === 'undefined' || !Player.seek) return;
            const rate = performance.now() - startedAt > 2000 ? 4 : 2;
            const pos = Player.getPosition ? Player.getPosition() : 0;
            const dur = Player.getDuration ? Player.getDuration() : 0;
            const next = clamp(pos + dir * rate * 0.25, 0, Math.max(0, dur - 0.5));
            Player.seek(next);
          }, 250);
        }, HOLD_MS);
      };
      btn.addEventListener('pointerdown', start);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => btn.addEventListener(ev, stop));
      // After a hold, the release must not skip the track
      btn.addEventListener('click', (e) => { if (held) { held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    });
  }

  // --------------------------------------------------------------------------
  // 5. Haptics
  // --------------------------------------------------------------------------
  function setupHaptics() {
    const on = (sel, ms) => document.querySelectorAll(sel).forEach(el => {
      if (el._mfHaptic) return; el._mfHaptic = true;
      el.addEventListener('click', () => haptic(ms), { passive: true });
    });
    on('.floating-bottom-nav .nav-tab', 8);
    on('#btn-player-play, #btn-mini-play', 14);
    on('#btn-player-favorite, #btn-mini-like', 10);
    on('.utility-btn', 8);
    // Sheets and dialogs: light tap when they commit open
    try {
      const obs = new MutationObserver(muts => {
        muts.forEach(m => {
          if (m.attributeName === 'class' && m.target.classList && m.target.classList.contains('active') && !m.oldValue?.includes('active')) haptic(10);
        });
      });
      document.querySelectorAll('.bottom-sheet-backdrop, .dialog-backdrop').forEach(el => obs.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] }));
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // 6. Queue swipe actions (rows are wrapped by App.renderDrawerQueue)
  // --------------------------------------------------------------------------
  function setupQueueSwipes() {
    const list = document.getElementById('drawer-queue-tracks-container');
    if (!list || list._mfSwipe) return;
    list._mfSwipe = true;
    let row = null, wrap = null, x0 = 0, y0 = 0, dx = 0, horizontal = null;
    const reset = () => { if (row) { row.style.transition = SPRING; row.style.transform = ''; } if (wrap) wrap.classList.remove('swiping-left', 'swiping-right'); row = null; wrap = null; horizontal = null; dx = 0; };
    list.addEventListener('touchstart', (e) => {
      const r = e.target.closest && e.target.closest('.queue-track-item');
      if (!r || e.touches.length !== 1) return;
      row = r; wrap = r.closest('.queue-swipe-wrap'); x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; horizontal = null; dx = 0;
      row.style.transition = 'none';
    }, { passive: true });
    list.addEventListener('touchmove', (e) => {
      if (!row || e.touches.length !== 1) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (horizontal === null) { if (Math.abs(mx) < 6 && Math.abs(my) < 6) return; horizontal = Math.abs(mx) > Math.abs(my) * 1.3; }
      if (!horizontal) return;
      if (e.cancelable) e.preventDefault();
      dx = clamp(mx, -120, 120);
      row.style.transform = `translateX(${dx}px)`;
      if (wrap) { wrap.classList.toggle('swiping-right', dx > 12); wrap.classList.toggle('swiping-left', dx < -12); }
    }, { passive: false });
    const end = () => {
      if (!row) return;
      const idx = parseInt(row.dataset.queueIndex, 10);
      const q = (typeof Player !== 'undefined' && Player.getQueue) ? Player.getQueue() : [];
      if (horizontal && dx > 80 && q[idx]) {
        haptic(12);
        if (Player.playNext) Player.playNext(q[idx]);
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Playing next');
        reset();
        if (typeof App !== 'undefined' && App.renderDrawerQueue) setTimeout(() => App.renderDrawerQueue(), 260);
        return;
      }
      if (horizontal && dx < -80 && !isNaN(idx)) {
        haptic(12);
        row.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        row.style.transform = 'translateX(-110%)'; row.style.opacity = '0';
        const i = idx; row = null; wrap = null;
        setTimeout(() => {
          if (typeof Player !== 'undefined' && Player.removeFromQueue) Player.removeFromQueue(i);
          if (typeof App !== 'undefined' && App.renderDrawerQueue) App.renderDrawerQueue();
        }, 200);
        return;
      }
      reset();
    };
    list.addEventListener('touchend', end, { passive: true });
    list.addEventListener('touchcancel', end, { passive: true });
  }

  // --------------------------------------------------------------------------
  // 7. Artwork-tinted shadow on detail covers
  // --------------------------------------------------------------------------
  function averageColor(img) {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 100) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return null;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function setupTintedShadows() {
    const img = document.getElementById('detail-cover-img');
    const screen = document.getElementById('screen-detail');
    if (!img || !screen || img._mfTint) return;
    img._mfTint = true;
    try { img.crossOrigin = 'anonymous'; } catch (_) {}
    img.addEventListener('load', () => {
      if (/logo\.png$/.test(img.src) || !screen.classList.contains('active')) return;
      const run = () => {
        try {
          const c = averageColor(img);
          if (c) screen.style.setProperty('--detail-tint', `${c[0]}, ${c[1]}, ${c[2]}`);
        } catch (_) { screen.style.removeProperty('--detail-tint'); }
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 800 }); else setTimeout(run, 50);
    });
  }

  // --------------------------------------------------------------------------
  function init() {
    try { setupMiniDrag(); } catch (e) { console.warn('[Motion] mini drag:', e.message); }
    try { setupSheetDrag(); } catch (e) { console.warn('[Motion] sheet drag:', e.message); }
    try { setupCollapsingTitles(); } catch (e) { console.warn('[Motion] titles:', e.message); }
    try { setupLyricsInteractions(); } catch (e) { console.warn('[Motion] lyrics:', e.message); }
    try { setupHoldToScrub(); } catch (e) { console.warn('[Motion] hold:', e.message); }
    try { setupHaptics(); } catch (e) { console.warn('[Motion] haptics:', e.message); }
    try { setupQueueSwipes(); } catch (e) { console.warn('[Motion] queue:', e.message); }
    try { setupTintedShadows(); } catch (e) { console.warn('[Motion] tint:', e.message); }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    else setTimeout(init, 0);
  }

  return { init, decideCommit, velocityOf, scrollToTop, lyricAction, haptic };
})();

if (typeof window !== 'undefined') {
  window.Motion = Motion;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Motion;
}
