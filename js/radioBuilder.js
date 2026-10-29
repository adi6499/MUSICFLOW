// ============================================================================
// MUSICFLOW — YOUTUBE MUSIC RADIO BUILDER ENGINE (Step 5)
// Multi-artist seed selection, variety tuning, mood filtering, and radio generation.
// ============================================================================

const RadioBuilder = (() => {
  const selectedArtists = new Set();
  let currentVariety = 'familiar'; // 'familiar' | 'blend' | 'discover'
  let currentMood = 'all'; // 'all' | 'chill' | 'upbeat' | 'party'

  // Seed artists for the picker. Pictures come from the music catalog (no stock photos);
  // a monogram disc shows until the real picture arrives, and results are cached per session.
  const POPULAR_ARTISTS = ['Arijit Singh', 'The Weeknd', 'Post Malone', 'Dua Lipa', 'Shreya Ghoshal',
    'Taylor Swift', 'Pritam', 'Ed Sheeran', 'Billie Eilish'].map(name => ({ name }));
  const artistImageCache = new Map();

  function artistDomId(name) { return 'radio-art-' + name.replace(/[^a-zA-Z0-9]/g, ''); }

  async function loadArtistPicture(name) {
    if (artistImageCache.has(name)) return artistImageCache.get(name);
    let url = '';
    try {
      if (typeof API !== 'undefined' && typeof API.searchArtists === 'function') {
        const res = await API.searchArtists(name, 1, 3);
        const hit = (Array.isArray(res) ? res : []).find(a => String(a && (a.name || a.title) || '').toLowerCase() === name.toLowerCase()) || (Array.isArray(res) ? res[0] : null);
        const img = hit && typeof API.getImageUrl === 'function' ? API.getImageUrl(hit) : (hit && hit.image) || '';
        if (img && !/logo\.png$/.test(String(img))) url = String(img);
      }
    } catch (_) {}
    artistImageCache.set(name, url);
    return url;
  }

  function hydrateArtistPictures() {
    POPULAR_ARTISTS.forEach(a => {
      loadArtistPicture(a.name).then(url => {
        if (!url) return;
        const item = document.getElementById(artistDomId(a.name));
        const img = item && item.querySelector('img');
        const mono = item && item.querySelector('.radio-artist-mono');
        if (!img) return;
        img.onload = () => { img.style.display = ''; if (mono) mono.style.display = 'none'; };
        img.src = url;
      });
    });
  }

  function open() {
    selectedArtists.clear();
    const grid = document.getElementById('radio-artist-grid');
    const label = document.getElementById('radio-builder-step-label');

    if (label) label.textContent = 'Select up to 10 artists (0 selected)';
    if (grid) {
      grid.innerHTML = POPULAR_ARTISTS.map(a => `
        <div class="radio-artist-item" id="${artistDomId(a.name)}" onclick="RadioBuilder.toggleArtist('${a.name}')">
          <div class="radio-artist-mono" aria-hidden="true">${a.name.trim().charAt(0).toUpperCase()}</div>
          <img src="" alt="${a.name}" style="display:none;" onerror="this.style.display='none'">
          <span>${a.name}</span>
        </div>
      `).join('');
      hydrateArtistPictures();
    }

    if (typeof App !== 'undefined' && App.openBottomSheet) {
      App.openBottomSheet('sheet-radio-builder');
    }
  }

  function toggleArtist(artistName) {
    if (selectedArtists.has(artistName)) {
      selectedArtists.delete(artistName);
    } else {
      if (selectedArtists.size >= 10) {
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast('You can select up to 10 artists');
        }
        return;
      }
      selectedArtists.add(artistName);
    }

    const safeId = `radio-art-${artistName.replace(/[^a-zA-Z0-9]/g, '')}`;
    const el = document.getElementById(safeId);
    if (el) {
      el.classList.toggle('selected', selectedArtists.has(artistName));
    }

    const label = document.getElementById('radio-builder-step-label');
    if (label) {
      label.textContent = `Select up to 10 artists (${selectedArtists.size} selected)`;
    }
  }

  function setVariety(variety) {
    currentVariety = variety;
    document.querySelectorAll('[data-variety]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.variety === variety);
    });
  }

  function setMood(mood) {
    currentMood = mood;
    document.querySelectorAll('[data-mood]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mood === mood);
    });
  }

  async function launch() {
    if (selectedArtists.size === 0) {
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Please select at least 1 artist');
      }
      return;
    }

    if (typeof App !== 'undefined' && App.closeBottomSheet) {
      App.closeBottomSheet('sheet-radio-builder');
    }
    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast(`Starting custom radio for ${Array.from(selectedArtists).join(', ')}...`);
    }

    const artists = Array.from(selectedArtists);

    try {
      let tracks = [];
      if (typeof Station !== 'undefined' && Station.build) {
        // One station per chosen artist, interleaved so the mix really alternates
        const per = Math.max(8, Math.ceil(30 / artists.length));
        const lists = await Promise.all(artists.map(a => Station.build({ artistName: a }, { size: per, mode: 'artist' }).catch(() => [])));
        const seen = new Set();
        for (let i = 0; i < per; i++) {
          for (const l of lists) {
            const s = l[i];
            if (s && !seen.has(String(s.id))) { seen.add(String(s.id)); tracks.push(s); }
          }
        }
        if (currentMood !== 'all' && tracks.length > 10) {
          const moodWords = { chill: /chill|lofi|acoustic|slow|soft|unplugged|love|romantic/i, upbeat: /dance|party|remix|edm|beat|hit|bhangra|club/i, party: /party|dance|club|remix|dj|bass|bhangra/i };
          const re = moodWords[currentMood];
          if (re) tracks.sort((a, b) => (re.test(String(b.name) + ' ' + String(b.album)) ? 1 : 0) - (re.test(String(a.name) + ' ' + String(a.album)) ? 1 : 0));
        }
      }
      if (tracks.length === 0 && typeof API !== 'undefined' && API.searchSongs) {
        tracks = await API.searchSongs(`${artists.join(' ')} radio`, 1, 20, { lite: true });
      }

      if (tracks && tracks.length > 0) {
        if (typeof Player !== 'undefined' && Player.playTrack) {
          Player.playTrack(tracks[0], tracks);
        }
        if (typeof App !== 'undefined' && App.expandFullPlayer) {
          App.expandFullPlayer();
        }
      }
    } catch (err) {
      console.warn('[RadioBuilder] Launch failed:', err.message);
    }
  }

  /**
   * One-tap station (Radio tab): a single artist, or a genre with its own search query.
   */
  async function quickStation(name, query) {
    const label = String(name || '').trim();
    if (!label) return;
    if (typeof UI !== 'undefined' && UI.showToast) UI.showToast(`Starting ${label} Radio…`);
    try {
      let tracks = [];
      if (typeof Station !== 'undefined' && Station.build) {
        tracks = query
          ? await Station.build({ query, name: label }, { size: 30, mode: 'genre' })
          : await Station.build({ artistName: label }, { size: 30, mode: 'artist' });
      }
      if ((!tracks || tracks.length < 5) && typeof API !== 'undefined' && API.searchSongs) {
        tracks = await API.searchSongs(query || label, 1, 25, { lite: true });
      }
      if (tracks && tracks.length > 0) {
        if (typeof Station !== 'undefined' && Station.markQueued) Station.markQueued(tracks);
        if (typeof Player !== 'undefined' && Player.playTrack) Player.playTrack(tracks[0], tracks);
        if (typeof App !== 'undefined' && App.expandFullPlayer) App.expandFullPlayer();
      } else if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast(`Could not start ${label} Radio right now`);
      }
    } catch (err) {
      console.warn('[RadioBuilder] quickStation failed:', err.message);
    }
  }

  return {
    open,
    quickStation,
    toggleArtist,
    setVariety,
    setMood,
    launch,
    getSelectedArtists: () => Array.from(selectedArtists),
    getVariety: () => currentVariety,
    getMood: () => currentMood
  };
})();

if (typeof window !== 'undefined') {
  window.RadioBuilder = RadioBuilder;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RadioBuilder;
}
