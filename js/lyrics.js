// ==========================================================================
// MUSICFLOW — LIVE SYNCHRONIZED KARAOKE LYRICS ENGINE (LRCLib & Local)
// High-Precision Real-Time Timestamp Sync, Karaoke Scroll & Seek Alignment
// ==========================================================================

var Lyrics = (function() {
  let parsedLines = [];
  let activeIndex = -1;
  let isPlain = false;
  let userIsScrolling = false;
  let scrollTimeout = null;
  let currentSongId = null;
  let currentRequestId = 0;
  const negativeLyricsCache = new Set();

  // Parses standard & advanced LRC formats:
  // [mm:ss.xx], [mm:ss.xxx], [mm:ss:xx], [m:ss.xx], [offset: +/-ms], multi-timestamps
  function parseLRC(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') return [];

    let globalOffsetSec = 0;
    const offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\]/i);
    if (offsetMatch) {
      globalOffsetSec = parseInt(offsetMatch[1], 10) / 1000.0;
    }

    const lines = lrcText.split('\n');
    const result = [];
    const timeReg = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

    lines.forEach(line => {
      // Ignore metadata tags
      if (/^\[(ti|ar|al|by|length|re|ve|offset):/i.test(line.trim())) return;

      const text = line.replace(timeReg, '').trim();
      let match;
      timeReg.lastIndex = 0;
      let hasTimestamp = false;

      while ((match = timeReg.exec(line)) !== null) {
        hasTimestamp = true;
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const rawMs = match[3] || '0';
        const ms = parseInt(rawMs.padEnd(3, '0').slice(0, 3), 10);
        const timeInSeconds = Math.max(0, (min * 60) + sec + (ms / 1000.0) + globalOffsetSec);

        if (text) {
          result.push({ time: timeInSeconds, text });
        }
      }

      // If plain lyric line without timestamp inside mixed LRC
      if (!hasTimestamp) {
        const cleanText = text.replace(/^\[.*?\]\s*/, '').trim();
        if (cleanText) {
          result.push({ time: 0, text: cleanText });
        }
      }
    });

    return result.sort((a, b) => a.time - b.time);
  }

  function resetLyrics() {
    parsedLines = [];
    activeIndex = -1;
    isPlain = false;
    userIsScrolling = false;
    currentSongId = null;
    currentRequestId++;
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
      scrollTimeout = null;
    }
  }

  function getLyricsContainers() {
    const list = [];
    if (typeof document !== 'undefined') {
      const main = document.getElementById('lyrics-scroll-container');
      const drawer = document.getElementById('drawer-lyrics-scroll');
      if (main) list.push(main);
      if (drawer) list.push(drawer);
    }
    return list;
  }

  async function loadLyricsForTrack(song) {
    const reqId = ++currentRequestId;
    parsedLines = [];
    activeIndex = -1;
    isPlain = false;
    currentSongId = song ? String(song.id || '') : null;

    const containers = getLyricsContainers();
    if (!song) {
      containers.forEach(c => {
        c.innerHTML = '<p class="lyrics-line" style="color:var(--text-secondary); padding:40px 20px; text-align:center;">No track selected.</p>';
      });
      return;
    }

    containers.forEach(c => {
      c.innerHTML = `
        <div class="lyrics-loading-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; text-align:center; color:var(--text-secondary);">
          <span class="material-symbols-outlined spinning" style="font-size:28px; color:var(--player-dominant-color, var(--accent)); margin-bottom:12px;">sync</span>
          <p style="font-size:14px; font-weight:600; color:#fff;">Fetching Synchronized Lyrics...</p>
          <span style="font-size:12px; margin-top:4px; opacity:0.8;">Matching vocal timing</span>
        </div>
      `;
    });

    // 1. Check embedded synchronized lyrics first (Local ID3 tag or cached synced LRC)
    if (song.syncedLyrics && typeof song.syncedLyrics === 'string' && song.syncedLyrics.includes('[')) {
      parsedLines = parseLRC(song.syncedLyrics);
      isPlain = false;
      if (reqId === currentRequestId) {
        renderLyrics(parsedLines, false);
        const curPos = (typeof Player !== 'undefined' && typeof Player.getPosition === 'function') ? Player.getPosition() : 0;
        updateTime(curPos, true);
      }
      return;
    }

    // 2. Check negative cache
    const cacheKey = `${song.id || ''}_${song.name || ''}`;
    if (negativeLyricsCache.has(cacheKey) && !song.lyrics) {
      if (reqId === currentRequestId) {
        containers.forEach(c => {
          c.innerHTML = `
            <div class="lyrics-empty-state" style="padding:60px 20px; text-align:center; color:var(--text-secondary);">
              <span class="material-symbols-outlined" style="font-size:36px; opacity:0.6; margin-bottom:12px;">music_off</span>
              <p style="font-size:14px; font-weight:600; color:#fff;">Lyrics aren't available for this track.</p>
              <span style="font-size:12px; margin-top:4px; display:block;">Enjoy the music!</span>
            </div>
          `;
        });
      }
      return;
    }

    // 3. Resolve track details for LRCLIB lookup
    const trackTitle = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getTrackTitle(song) : (song.name || song.title || '');
    const artistName = (typeof DataNormalizer !== 'undefined')
      ? DataNormalizer.getPrimaryRecordingArtist(song)
      : (song.primaryArtist || song.artists || '');

    try {
      const data = (typeof API !== 'undefined' && API.getLyrics)
        ? await API.getLyrics(trackTitle, artistName, song.duration)
        : null;

      // Discard response if user already switched songs during network roundtrip
      if (reqId !== currentRequestId) return;

      if (data && data.synced) {
        parsedLines = parseLRC(data.synced);
        isPlain = false;
        renderLyrics(parsedLines, false);
        const curPos = (typeof Player !== 'undefined' && typeof Player.getPosition === 'function') ? Player.getPosition() : 0;
        updateTime(curPos, true);
        return;
      }

      // 4. Fallback to LRCLIB plain lyrics or song.lyrics with smart time interpolation
      const plainRaw = (data && data.plain) || song.lyrics || song.syncedLyrics;
      if (plainRaw && typeof plainRaw === 'string' && plainRaw.trim()) {
        const rawLines = plainRaw.split('\n').filter(l => l.trim()).map(text => ({ time: 0, text }));
        const songDur = Number(song.duration) || 180;
        parsedLines = interpolatePlainTimestamps(rawLines, songDur);
        isPlain = false; // Enabled for synced karaoke scroll
        renderLyrics(parsedLines, false);
        const curPos = (typeof Player !== 'undefined' && typeof Player.getPosition === 'function') ? Player.getPosition() : 0;
        updateTime(curPos, true);
        return;
      }

      negativeLyricsCache.add(cacheKey);
      containers.forEach(c => {
        c.innerHTML = `
          <div class="lyrics-empty-state" style="padding:60px 20px; text-align:center; color:var(--text-secondary);">
            <span class="material-symbols-outlined" style="font-size:36px; opacity:0.6; margin-bottom:12px;">music_off</span>
            <p style="font-size:14px; font-weight:600; color:#fff;">Lyrics aren't available for this track.</p>
            <span style="font-size:12px; margin-top:4px; display:block;">Enjoy the music!</span>
          </div>
        `;
      });
    } catch (_) {
      if (reqId === currentRequestId) {
        containers.forEach(c => {
          c.innerHTML = `
            <div class="lyrics-empty-state" style="padding:60px 20px; text-align:center; color:var(--text-secondary);">
              <p style="font-size:14px; font-weight:600; color:#fff;">Lyrics unavailable offline</p>
            </div>
          `;
        });
      }
    }
  }

  function interpolatePlainTimestamps(lines, durationSec = 180) {
    const dur = (durationSec && durationSec > 10) ? durationSec : 180;
    const startSec = 4.0;
    const endSec = Math.max(startSec + 5, dur - 4.0);
    const count = lines.length;
    if (count <= 1) return lines.map(l => ({ ...l, time: 0 }));

    const step = (endSec - startSec) / (count - 1);
    return lines.map((l, idx) => ({
      time: startSec + (idx * step),
      text: l.text
    }));
  }

  /**
   * Instrumental gaps longer than 6 s get a "• • •" breather line (Apple Music style), so the
   * active highlight never sits on a stale lyric during an intro or a solo.
   */
  function augmentWithBreathers(lines, minGap = 6) {
    if (!Array.isArray(lines) || lines.length === 0) return lines || [];
    const out = [];
    const first = lines[0];
    if (first && Number(first.time) > minGap) out.push({ time: 0, text: '• • •', breather: true });
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i];
      out.push(cur);
      const next = lines[i + 1];
      if (next && Number(next.time) - Number(cur.time) > minGap && String(cur.text || '').trim() !== '') {
        out.push({ time: Number(cur.time) + Math.min(4, (Number(next.time) - Number(cur.time)) / 2), text: '• • •', breather: true });
      }
    }
    return out;
  }

  function renderLyrics(lines, plain = false) {
    lines = plain ? (lines || []) : augmentWithBreathers(lines);
    parsedLines = lines || [];
    const containers = getLyricsContainers();
    if (containers.length === 0) return;

    if (!lines || lines.length === 0) {
      containers.forEach(c => {
        c.innerHTML = '<p class="lyrics-line" style="color:var(--text-secondary); padding:40px 20px; text-align:center;">No lyrics available.</p>';
      });
      return;
    }

    const html = lines.map((item, idx) => {
      const next = lines[idx + 1];
      const lineMs = next ? Math.max(600, Math.min(12000, (Number(next.time) - Number(item.time)) * 1000)) : 3000;
      return `
      <p class="lyrics-line ${idx === 0 && !plain ? 'active' : ''}${item.breather ? ' lyrics-breather' : ''}" data-idx="${idx}" data-time="${item.time}" style="--line-ms:${Math.round(lineMs)}ms">
        ${item.text}
      </p>
    `;
    }).join('');

    containers.forEach(container => {
      container.innerHTML = html;

      // Attach scroll tracking per container:
      container.onscroll = () => {
        container._userIsScrolling = true;
        if (container._scrollTimeout) clearTimeout(container._scrollTimeout);
        container._scrollTimeout = setTimeout(() => {
          container._userIsScrolling = false;
        }, 2200);
      };

      // Tap-to-seek on any lyric line
      container.querySelectorAll('.lyrics-line').forEach(el => {
        el.onclick = () => {
          const time = parseFloat(el.dataset.time);
          if (!isNaN(time) && typeof Player !== 'undefined' && Player.seek) {
            Player.seek(time);
            container._userIsScrolling = false;
            updateTime(time, true);
          }
        };
      });
    });
  }

  function updateTime(currentTime, forceScroll = false) {
    if (!parsedLines || parsedLines.length === 0) return;
    const curTime = Number(currentTime) || 0;

    // Find active line with 150ms anticipation for natural karaoke highlight
    let newIndex = -1;
    for (let i = 0; i < parsedLines.length; i++) {
      if (curTime >= parsedLines[i].time - 0.15) {
        newIndex = i;
      } else {
        break;
      }
    }

    if (newIndex !== activeIndex || forceScroll) {
      activeIndex = newIndex;
      const containers = getLyricsContainers();

      containers.forEach(container => {
        const lines = container.querySelectorAll('.lyrics-line');
        lines.forEach((line, idx) => {
          const isCurrent = idx === activeIndex;
          const isPast = activeIndex !== -1 && idx < activeIndex;

          line.classList.toggle('active', isCurrent);
          line.classList.toggle('past', isPast);

          if (isCurrent && (!container._userIsScrolling || forceScroll)) {
            // Center the active line smoothly around the center/lower-middle reading area
            const targetOffset = line.offsetTop - (container.clientHeight * 0.40);
            container.scrollTo({
              top: Math.max(0, targetOffset),
              behavior: forceScroll ? 'auto' : 'smooth'
            });
          }
        });
      });
    }
  }

  function getParsedLines() {
    return parsedLines;
  }

  function getActiveIndex() {
    return activeIndex;
  }

  return {
    parseLRC,
    resetLyrics,
    loadLyricsForTrack,
    renderLyrics,
    updateTime,
    getParsedLines,
    augmentWithBreathers,
    getActiveIndex
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Lyrics;
}
