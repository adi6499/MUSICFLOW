// ==========================================================================
// MUSICFLOW — MAIN APPLICATION CONTROLLER (MainActivity.kt Replica)
// ==========================================================================

const App = (() => {
  let activeTab = 'home';
  let activeSongForMenu = null;
  let activeArtistData = null;
  let homeFeedData = null;
  let currentArtistSongs = [];
  let currentDetailSongs = [];
  let searchDebounceTimer = null;
  let searchRequestId = 0;
  let searchAbortController = null;
  let audioContext = null;
  let activeSoundscapeNode = null;
  let currentSoundscape = null;
  let tempSelectedLanguages = [];
  let isNewReleasesExpanded = false;
  let isArtistTracksExpanded = false;

  // Library 2.0 State
  let activeLibraryTab = 'playlists';
  let librarySearchQuery = '';
  let librarySortMode = 'recent';
  let selectedMenuSong = null;
  let selectedMenuPlaylistId = null;

  // Global In-Memory Track Registry for instant O(1) playback
  const trackRegistry = new Map();

  function registerTrack(track) {
    if (!track || !track.id) return;
    trackRegistry.set(String(track.id), track);
  }

  function registerTracks(tracks) {
    if (!Array.isArray(tracks)) return;
    tracks.forEach(registerTrack);
  }

  function getRegisteredTrack(songId) {
    if (!songId) return null;
    return trackRegistry.get(String(songId)) || null;
  }
  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let editingPlaylistId = null;
  let localUploadedSongs = [];

  async function init() {
    const getNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = getNow();
    console.log('[PERF] app start');
    try { fixIosViewportGap(); } catch (_) {}
    try { showScreenDiagnostics(); } catch (_) {}

    if (typeof ThemeManager !== 'undefined') {
      ThemeManager.apply();
    }

    // 1. Initialize Player core immediately
    Player.init();

    // 2. Setup listeners and apply local preferences
    setupPlayerEventListeners();
    setupDOMEventListeners();
    applyPreferences();

    // 3. Render immediate UI shell from local data / cache (P0)
    UI.renderHomeGreeting();
    showWelcomeIfFirstLaunch();
    try { showIosFullscreenHint(); } catch (_) {}
    renderAccentSetting();
    try {
      const titleObserver = new MutationObserver(() => {
        const active = document.querySelector('.screen.active');
        if (!active) return;
        const id = active.id.replace('screen-', '');
        if (id === 'detail') {
          const tag = (document.getElementById('detail-source-tag') || {}).textContent || '';
          FL_TITLES.detail = /playlist/i.test(tag) ? 'Playlist' : 'Album';
        }
        setTopbarTitle(id);
      });
      document.querySelectorAll('.screen').forEach(s => titleObserver.observe(s, { attributes: true, attributeFilter: ['class'] }));
    } catch (_) {}
    try { if (typeof ApiConfig !== 'undefined' && !ApiConfig.isNativeApp()) { const r = document.getElementById('settings-get-app-row'); if (r) r.style.display = 'flex'; } } catch (_) {}
    initTimeOfDayMoodChips();
    UI.renderRecentSearchChips();
    UI.renderLibraryTab('playlists');
    renderLibraryRecent();
    console.log(`[PERF] shell rendered in ${(getNow() - t0).toFixed(1)}ms`);

    // 4. Restore last session in paused state immediately (0ms synchronous)
    try {
      const last = Storage.restoreSession();
      if (last && last.queue && last.queue.length > 0) {
        Player.setQueue(last.queue, last.currentIndex || 0, false);
        Player.pause();
      }
    } catch (_) {}
    console.log(`[PERF] local state restored in ${(getNow() - t0).toFixed(1)}ms`);

    // 5. Hide blocking loader immediately so user has interactive UI
    showLoader(false);
    console.log(`[PERF] startup complete in ${(getNow() - t0).toFixed(1)}ms`);

    // 6. Asynchronously trigger Home Feed (Stale-While-Revalidate will render cache first, then update)
    loadHomeFeed();

    // 7. Initialize background services asynchronously (using requestIdleCallback / setTimeout)
    const runBackgroundInit = () => {
      if (typeof OfflineManager !== 'undefined') {
        OfflineManager.init();
        OfflineManager.on('networkChange', (state) => {
          if (state === 'ONLINE') {
            UI.showToast('Back online 🌐');
            loadHomeFeed();
          } else {
            UI.showToast('You are offline ✈️');
            loadHomeFeed();
          }
        });
      }

      if (typeof SmartDownloadManager !== 'undefined') {
        SmartDownloadManager.init();
      }

      if (typeof AudioOutputManager !== 'undefined' && AudioOutputManager.init) {
        AudioOutputManager.init();
      }
      try { setupEndlessHomeFeed(); } catch (_) {}
      try { renderRailPlaylists(); } catch (_) {}

      if (typeof UpdateManager !== 'undefined' && UpdateManager.init) {
        UpdateManager.init();
        UpdateManager.on('stateChange', (state) => {
          if (typeof UI !== 'undefined' && UI.renderAboutSettings) {
            UI.renderAboutSettings(state);
          }
        });
        if (typeof UI !== 'undefined' && UI.renderAboutSettings) {
          UI.renderAboutSettings(UpdateManager.getState());
        }
      }
    };

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(runBackgroundInit, { timeout: 1000 });
    } else {
      setTimeout(runBackgroundInit, 50);
    }
  }

  function applyPreferences() {
    // 1. Performance Mode (Auto, 120 FPS Ultra, 60 FPS Smooth, 30 FPS Saver)
    if (typeof PerformanceManager !== 'undefined' && typeof PerformanceManager.apply === 'function') {
      PerformanceManager.apply();
    } else if (typeof Storage !== 'undefined' && typeof Storage.getPerformanceMode === 'function') {
      const mode = Storage.getPerformanceMode();
      document.body.classList.toggle('perf-lite', mode === '30fps' || mode === 'lite');
    }

    // 2. Ambient Glow
    const glow = (typeof Storage !== 'undefined' && typeof Storage.getAmbientLighting === 'function')
      ? Storage.getAmbientLighting()
      : true;
    const bg = document.getElementById('dynamic-bg');
    if (bg) bg.style.display = glow ? 'block' : 'none';

    // 3. User Avatar
    const avatar = Storage.getUserAvatar();
    const homeAvatar = document.getElementById('home-user-avatar');
    if (homeAvatar) homeAvatar.src = avatar;

    // 4. Smart Downloads & Offline Settings (Phase 9.3)
    if (typeof Storage !== 'undefined' && Storage.getSmartDownloadsSettings) {
      const smartSettings = Storage.getSmartDownloadsSettings();
      const smartSwitch = document.getElementById('settings-smart-dl-switch');
      if (smartSwitch) smartSwitch.checked = !!smartSettings.enabled;
      const wifiSwitch = document.getElementById('settings-wifi-only-switch');
      if (wifiSwitch) wifiSwitch.checked = smartSettings.wifiOnly !== false;
      const likesSwitch = document.getElementById('settings-auto-likes-switch');
      if (likesSwitch) likesSwitch.checked = !!smartSettings.autoDownloadLikes;

      const storageLimitVal = document.getElementById('settings-storage-limit-val');
      const storageLimitSub = document.getElementById('settings-storage-limit-sub');
      if (storageLimitVal) storageLimitVal.textContent = `${(smartSettings.storageLimitMb / 1024).toFixed(0)} GB`;
      if (storageLimitSub) storageLimitSub.textContent = `${smartSettings.storageLimitMb} MB max storage limit`;

      const cleanupVal = document.getElementById('settings-cleanup-val');
      const cleanupSub = document.getElementById('settings-cleanup-sub');
      if (cleanupVal) cleanupVal.textContent = smartSettings.autoCleanupPolicy === 'never' ? 'Never' : (smartSettings.autoCleanupPolicy === 'older_30_days' ? '30 Days' : (smartSettings.autoCleanupPolicy === 'older_90_days' ? '90 Days' : 'Least Played'));
      if (cleanupSub) cleanupSub.textContent = smartSettings.autoCleanupPolicy === 'never' ? 'Never remove downloads' : `Policy: ${smartSettings.autoCleanupPolicy}`;
    }
  }

  function showLoader(show) {
    const loader = document.getElementById('app-loader');
    if (loader) loader.classList.toggle('active', show);
  }

  // ==========================================================================
  // HOME FEED LOADER
  // ==========================================================================
  // --------------------------------------------------------------------------
  // Home hero: the first Top Pick with artwork, written on the picture, "Play Now"
  // --------------------------------------------------------------------------
  let homeHeroSong = null;
  const bigArt = (url) => String(url || '').replace(/(150x150|50x50)(?=\.[a-z]+($|\?))/i, '500x500');

  function renderHomeHero(items) {
    const section = document.getElementById('home-hero-section');
    if (!section) return;
    const song = (Array.isArray(items) ? items : []).find(s => s && s.id && s.image && !/logo\.png$/i.test(String(s.image)));
    if (!song) { section.style.display = 'none'; return; }
    homeHeroSong = song;
    const art = document.getElementById('home-hero-art');
    const title = document.getElementById('home-hero-title');
    const artist = document.getElementById('home-hero-artist');
    if (art) { art.src = bigArt(song.image); art.alt = song.name || ''; }
    if (title) title.textContent = song.name || song.title || 'Now trending';
    if (artist) artist.textContent = song.artists || song.primaryArtist || '';
    section.style.display = 'block';
  }

  function playHeroSong() {
    if (!homeHeroSong) return;
    if (typeof App !== 'undefined' && typeof App.playSongWithQueue === 'function') App.playSongWithQueue(homeHeroSong.id);
  }

  // --------------------------------------------------------------------------
  // Welcome: shown once, on the first launch
  // --------------------------------------------------------------------------
  const WELCOME_KEY = 'mf_welcomed';

  function showWelcomeIfFirstLaunch() {
    try { if (localStorage.getItem(WELCOME_KEY)) return; } catch (_) { return; }
    const el = document.getElementById('welcome-screen');
    if (el) el.style.display = 'flex';
  }

  function fillWelcomeArt(items) {
    const covers = document.querySelectorAll('#welcome-screen .welcome-cover');
    if (!covers.length) return;
    const withArt = (Array.isArray(items) ? items : []).filter(s => s && s.image && !/logo\.png$/i.test(String(s.image))).slice(0, 3);
    withArt.forEach((s, i) => { if (covers[i]) covers[i].src = bigArt(s.image); });
  }

  function dismissWelcome() {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch (_) {}
    const el = document.getElementById('welcome-screen');
    if (!el) return;
    el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    el.style.opacity = '0';
    el.style.transform = 'scale(1.02)';
    setTimeout(() => { el.style.display = 'none'; }, 320);
  }

  async function loadHomeFeed() {
    try {
      if (typeof HomeDataLayer !== 'undefined') {
        HomeDataLayer.loadHome((data, isCache) => {
          if (!data || !data.sections) return;
          homeFeedData = data;

          let hasTopAlbums = false;
          data.sections.forEach(sec => {
            if (Array.isArray(sec.items)) {
              registerTracks(sec.items);
            }
            if (sec.id === 'continue_listening') {
              UI.renderContinueListening(sec.items);
              UI.renderListenAgain(sec.items);
            } else if (sec.id === 'quick_picks') {
              UI.renderQuickPicks(sec.items);
              UI.renderRecommendedTracks(sec.items.slice(0, 8));
              renderHomeHero(sec.items);
              fillWelcomeArt(sec.items);
            } else if (sec.id === 'made_for_you') {
              UI.renderMadeForYou(sec.items);
            } else if (sec.id === 'because_you_listened') {
              const seedTitle = sec.seedTrack?.primaryArtist || sec.seedTrack?.artists || sec.seedTrack?.name || '';
              UI.renderBecauseYouListened(seedTitle, sec.items);
            } else if (sec.id === 'favorite_artists') {
              UI.renderFavoriteArtists(sec.items);
            } else if (sec.id === 'discover_new') {
              UI.renderDiscoverNew(sec.items);
            } else if (sec.id === 'new_releases') {
              UI.renderNewReleases(sec.items, isNewReleasesExpanded);
            } else if (sec.id === 'trending_charts') {
              UI.renderTrendingCharts(sec.items);
            } else if (sec.id === 'top_albums') {
              hasTopAlbums = true;
              UI.renderAlbums(sec.items);
            }
          });
          if (!hasTopAlbums) {
            UI.renderAlbums([]);
          }
        });
        return;
      }

      const languages = Storage.getLanguages();
      homeFeedData = await API.getHomeFeed(languages);

      const quickPicks = (homeFeedData?.quickPicks || []).map(API.normalizeSong);
      const trendingSongs = (homeFeedData?.trending?.songs || []).map(API.normalizeSong);
      const charts = homeFeedData?.charts || [];
      const albums = homeFeedData?.albums || [];

      // Quick picks
      if (quickPicks.length > 0) {
        UI.renderQuickPicks(quickPicks.slice(0, 16));
        renderHomeHero(quickPicks);
        fillWelcomeArt(quickPicks);
        UI.renderRecommendedTracks(quickPicks.slice(0, 8));
        UI.renderNewReleases(trendingSongs.length > 0 ? trendingSongs : quickPicks, isNewReleasesExpanded);
      }
      if (charts.length > 0) UI.renderTrendingCharts(charts);
      UI.renderAlbums(albums);
    } catch (e) {
      console.warn('[App] Failed to load home feed:', e);
    }
  }

  async function toggleAllNewReleases() {
    isNewReleasesExpanded = !isNewReleasesExpanded;
    let songs = (UI && UI._cachedNewReleases && UI._cachedNewReleases.length > 0)
      ? [...UI._cachedNewReleases]
      : [...(homeFeedData?.trending?.songs || homeFeedData?.quickPicks || [])];

    // If expanding and list has fewer than 15 songs, dynamically fetch 25+ fresh releases
    if (isNewReleasesExpanded && songs.length < 15 && typeof API !== 'undefined' && typeof API.searchSongs === 'function') {
      try {
        const langs = (typeof Storage !== 'undefined' && typeof Storage.getLanguages === 'function') ? (Storage.getLanguages() || ['hindi']) : ['hindi'];
        const primaryLang = String(langs[0] || 'hindi');
        const capLang = primaryLang.charAt(0).toUpperCase() + primaryLang.slice(1);
        const moreSongs = await API.searchSongs(`Latest New ${capLang} Songs 2025`, 1, 25);
        if (Array.isArray(moreSongs) && moreSongs.length > 0) {
          const seen = new Set(songs.map(s => String(s.id)));
          for (const ms of moreSongs) {
            const norm = (typeof API.normalizeSong === 'function') ? API.normalizeSong(ms) : ms;
            if (norm && norm.id && !seen.has(String(norm.id))) {
              seen.add(String(norm.id));
              songs.push(norm);
            }
          }
        }
      } catch (err) {
        console.warn('[App] Dynamic new releases fetch warning:', err);
      }
    }

    UI.renderNewReleases(songs, isNewReleasesExpanded);
  }

  // ==========================================================================
  // PLAYER EVENT LISTENERS
  // ==========================================================================
  function setupPlayerEventListeners() {
    Player.on('trackChange', (song) => {
      UI.updatePlayerBar(song);
      if (typeof Lyrics !== 'undefined' && Lyrics.loadLyricsForTrack) {
        Lyrics.loadLyricsForTrack(song);
      }
      renderDrawerQueue();
      if (currentDrawerTab === 'related') {
        renderDrawerRelated();
      }
    });

    Player.on('stateChange', ({ isPlaying, state, error }) => {
      UI.updatePlaybackState(isPlaying, state);
      if (state === 'ERROR' && error) {
        UI.showToast(`Unable to play track: ${error.message || 'Error occurred'}`);
      }
    });

    Player.on('timeUpdate', ({ currentTime, duration }) => {
      UI.updatePlaybackProgress(currentTime, duration);
      if (typeof Lyrics !== 'undefined' && Lyrics.updateTime) {
        Lyrics.updateTime(currentTime);
      }
    });

    Player.on('queueChange', (queue) => {
      const idx = (typeof Player.getCurrentIndex === 'function') ? Player.getCurrentIndex() : queue.findIndex(s => s.id === Player.getCurrentTrack()?.id);
      UI.renderQueueSheet(queue, idx);
      renderDrawerQueue();
    });

    Player.on('shuffleChange', (isShuffle) => {
      UI.updateShuffleState(isShuffle);
    });

    Player.on('repeatChange', (repeatMode) => {
      UI.updateRepeatState(repeatMode);
    });

    // Sleep Timer Engine Events
    Player.on('sleepTimerChange', (timerState) => {
      UI.updateSleepTimerUI(timerState);
    });

    Player.on('sleepTimerTick', (timerState) => {
      UI.updateSleepTimerUI(timerState);
    });

    Player.on('sleepTimerExpired', () => {
      UI.updateSleepTimerUI(typeof Player !== 'undefined' && Player.getSleepTimerState ? Player.getSleepTimerState() : { active: false });
      UI.showToast('🌙 Sleep timer ended — playback stopped');
    });

    // DownloadManager Events (Observable Download Queue)
    if (typeof DownloadManager !== 'undefined') {
      DownloadManager.on('statusChange', () => {
        if (activeLibraryTab === 'downloads') {
          UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
        }
        const cur = Player.getCurrentTrack();
        if (cur) UI.updatePlayerBar(cur);
      });

      DownloadManager.on('completed', (task) => {
        UI.showToast(`Downloaded "${task.name}" for Offline Playback 🎵`);
        if (activeLibraryTab === 'downloads') {
          UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
        }
        const cur = Player.getCurrentTrack();
        if (cur) UI.updatePlayerBar(cur);
      });

      DownloadManager.on('failed', (task) => {
        UI.showToast(`Download failed for "${task.name}": ${task.error?.message || 'Error'}`);
        if (activeLibraryTab === 'downloads') {
          UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
        }
      });
    }
  }

  // ==========================================================================
  // DOM EVENT LISTENERS & NAVIGATION
  // ==========================================================================
  function setupDOMEventListeners() {
    // 1. Custom Interactive Seek Bar & 3D Player Deck
    initSeekBar();
    initPlayer3DDeckGesture();

    // 2. Mood Chips Bar
    const moodContainer = document.getElementById('mood-chips-container');
    if (moodContainer) {
      moodContainer.addEventListener('click', async (e) => {
        const chip = e.target.closest('.mood-chip');
        if (!chip) return;

        triggerHaptic(10);
        moodContainer.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const mood = chip.dataset.mood;
        const label = chip.dataset.label || mood;
        showLoader(true);
        try {
          // Curated, multi-query suggestions per mood. A single "<mood> Music" search returns
          // generic "study music" filler; these pull real songs and drop the filler.
          // Real artists and known catalogue names per mood, not generic descriptors
          // ("lofi instrumental beats" only returns filler tracks literally named that).
          const MOOD_QUERIES = {
            Focus: ['Ludovico Einaudi', 'Prateek Kuhad', 'Anuv Jain', 'Hans Zimmer', 'Bollywood lofi flip'],
            Relax: ['Arijit Singh unplugged', 'Prateek Kuhad', 'Ed Sheeran', 'Atif Aslam', 'Lofi Bollywood'],
            Energize: ['Badshah', 'Diljit Dosanjh', 'Dua Lipa', 'Yo Yo Honey Singh', 'The Weeknd'],
            Workout: ['Eminem', 'Divine', 'Sidhu Moose Wala', 'David Guetta', 'Imagine Dragons'],
            Commute: ['Top Hits', 'Arijit Singh', 'Pritam', 'Taylor Swift', 'AP Dhillon'],
            Party: ['Badshah party', 'Diljit Dosanjh', 'Calvin Harris', 'Nucleya', 'Jass Manak'],
            Romance: ['Arijit Singh romantic', 'Jubin Nautiyal', 'Atif Aslam', 'Lana Del Rey', 'Vishal Mishra'],
            Sleep: ['Prateek Kuhad', 'Ludovico Einaudi', 'Cigarettes After Sex', 'Anuv Jain', 'Lofi Bollywood']
          };
          const JUNK = /study music|music therapy|alpha brain|binaural|white noise|brain waves|8d audio|meditation music|focus music|sleep music|rain sounds|nature sounds/i;
          // Filler "artists" that only publish generic background audio
          const FILLER_ARTIST = /lounge|sleep|study|relax|meditation|collection|zone|guru|vibe|sounds|music$|^music|instrumental|ambient|therapy|spa|yoga|noise|tokyo|hiphop guru|cafe|café/i;
          let songs = [];
          if (mood === 'All') {
            songs = await API.searchSongs('Top Hits', 1, 20);
          } else {
            const base = MOOD_QUERIES[mood] || [`${label.replace(/[^a-zA-Z\s]/g, '').trim()} hits`];
            let langs = [];
            try { langs = (typeof Storage !== 'undefined' && Storage.getLanguages) ? (Storage.getLanguages() || []) : []; } catch (_) {}
            const queries = langs[0] ? [...base, `${langs[0]} ${base[0]}`] : base;
            const batches = await Promise.all(queries.map(q => API.searchSongs(q, 1, 12).catch(() => [])));
            const seen = new Set();
            const maxLen = Math.max(...batches.map(b => (Array.isArray(b) ? b.length : 0)), 0);
            for (let i = 0; i < maxLen; i++) {            // interleave sources for variety
              for (const b of batches) {
                const s = Array.isArray(b) ? b[i] : null;
                if (!s || !s.id || seen.has(s.id)) continue;
                const nm = String(s.name || s.title || '');
                const ar = String(s.primaryArtists || s.artists || s.primaryArtist || '');
                if (JUNK.test(nm) || JUNK.test(ar) || !ar.trim() || Number(s.duration || 0) > 900) continue;
                if (FILLER_ARTIST.test(ar) || nm.trim().toLowerCase() === String(queries[0] || '').toLowerCase()) continue;
                seen.add(s.id);
                songs.push(s);
              }
            }
            if (typeof TrackDeduplicator !== 'undefined' && TrackDeduplicator.deduplicate) songs = TrackDeduplicator.deduplicate(songs);
            songs = songs.slice(0, 20);
          }
          if (typeof RecommendationEngine !== 'undefined' && typeof RecommendationEngine.getSimilarTracks === 'function' && mood !== 'All') {
            const current = (typeof Player !== 'undefined') ? Player.getCurrentTrack() : null;
            if (current) {
              const ranked = RecommendationEngine.getSimilarTracks(current, songs, 16);
              if (Array.isArray(ranked) && ranked.length > 0) {
                songs = ranked.map(r => r.song || r);
              }
            }
          }
          UI.renderQuickPicks(songs);
        } catch (_) {}
        showLoader(false);
      });
    }

    // 3. Quick Picks "Play All"
    const playAllQuick = document.getElementById('btn-quick-picks-play-all');
    if (playAllQuick) {
      playAllQuick.addEventListener('click', () => {
        const items = document.querySelectorAll('.quick-pick-item');
        if (items.length > 0) items[0].click();
      });
    }

    // 4. Daily Mix Cards
    document.getElementById('card-mix-supermix')?.addEventListener('click', () => playMix('Arijit Singh Supermix'));
    document.getElementById('card-mix-phonk')?.addEventListener('click', () => playMix('Phonk Drift Workout'));
    document.getElementById('card-mix-lofi')?.addEventListener('click', () => playMix('Lo-Fi Chill Beats'));

    // 5. Search Bar Input & Autocomplete (Instant Native Responsiveness)
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('btn-search-clear');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const rawVal = searchInput.value;
        const q = rawVal.trim();
        if (searchClear) searchClear.style.display = rawVal.length > 0 ? 'flex' : 'none';

        if (!q) {
          clearTimeout(searchDebounceTimer);
          searchRequestId++; // Invalidate any pending search request
          if (searchAbortController) {
            try { searchAbortController.abort(); } catch (_) {}
            searchAbortController = null;
          }
          const hub = document.getElementById('search-discovery-hub');
          const results = document.getElementById('search-results-container');
          if (hub) hub.style.display = 'block';
          if (results) results.style.display = 'none';
          return;
        }

        clearTimeout(searchDebounceTimer);
        if (q.length < 2) return;               // one letter is never a useful query
        searchDebounceTimer = setTimeout(() => {
          performSearch(q, searchCurrentCategory, false);
        }, 300);
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(searchDebounceTimer);
          const q = searchInput.value.trim();
          if (q) performSearch(q, searchCurrentCategory, true);
        }
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', () => {
        clearTimeout(searchDebounceTimer);
        searchRequestId++;
        if (searchAbortController) {
          try { searchAbortController.abort(); } catch (_) {}
          searchAbortController = null;
        }
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        searchClear.style.display = 'none';
        const hub = document.getElementById('search-discovery-hub');
        const results = document.getElementById('search-results-container');
        if (hub) hub.style.display = 'block';
        if (results) results.style.display = 'none';
      });
    }

    // 6. Search Filter Category Chips
    const searchCatContainer = document.getElementById('search-category-chips');
    if (searchCatContainer) {
      searchCatContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.search-cat-chip');
        if (!chip) return;
        searchCatContainer.querySelectorAll('.search-cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const q = searchInput ? searchInput.value.trim() : '';
        if (q) performSearch(q, chip.dataset.cat);
      });
    }

    // 7. Clear search history
    document.getElementById('btn-clear-search-history')?.addEventListener('click', () => {
      clearSearchData();
    });

    // 8. Library Tabs Bar
    const libTabsContainer = document.getElementById('library-tabs-bar');
    if (libTabsContainer) {
      libTabsContainer.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.lib-tab-btn');
        if (!tabBtn) return;
        openLibraryTab(tabBtn.dataset.tab);
      });
    }

    // Library Search Bar Toggle & Live Input
    const libSearchToggle = document.getElementById('btn-lib-search-toggle');
    const libSearchWrap = document.getElementById('lib-search-bar-wrap');
    const libSearchInput = document.getElementById('lib-search-input');
    const libSearchClear = document.getElementById('btn-lib-search-clear');
    if (libSearchToggle && libSearchWrap) {
      libSearchToggle.addEventListener('click', () => {
        const isHidden = libSearchWrap.style.display === 'none';
        libSearchWrap.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && libSearchInput) libSearchInput.focus();
      });
    }
    if (libSearchInput) {
      libSearchInput.addEventListener('input', (e) => {
        librarySearchQuery = e.target.value;
        if (libSearchClear) libSearchClear.style.display = librarySearchQuery ? 'inline-flex' : 'none';
        UI.renderLibraryTab(activeLibraryTab, librarySearchQuery, librarySortMode);
      });
    }
    if (libSearchClear && libSearchInput) {
      libSearchClear.addEventListener('click', () => {
        libSearchInput.value = '';
        librarySearchQuery = '';
        libSearchClear.style.display = 'none';
        UI.renderLibraryTab(activeLibraryTab, librarySearchQuery, librarySortMode);
      });
    }

    // 9. Create Playlist Button
    document.getElementById('btn-create-playlist')?.addEventListener('click', openCreatePlaylistModal);

    // Song Action Sheet Listeners
    document.getElementById('btn-song-act-play')?.addEventListener('click', () => {
      if (selectedMenuSong) {
        Player.setQueue([selectedMenuSong], 0);
        expandFullPlayer();
      }
      closeSongMenu();
    });
    document.getElementById('btn-song-act-radio')?.addEventListener('click', () => {
      if (selectedMenuSong) {
        startRadio(selectedMenuSong);
      }
      closeSongMenu();
    });
    document.getElementById('btn-song-act-play-next')?.addEventListener('click', () => {
      if (selectedMenuSong) Player.insertNext(selectedMenuSong);
      closeSongMenu();
    });
    document.getElementById('btn-song-act-queue')?.addEventListener('click', () => {
      if (selectedMenuSong) Player.addToQueue(selectedMenuSong);
      closeSongMenu();
    });
    document.getElementById('btn-song-act-fav')?.addEventListener('click', () => {
      if (selectedMenuSong) {
        Storage.toggleFavorite(selectedMenuSong);
        UI.renderLibraryTab(activeLibraryTab, librarySearchQuery, librarySortMode);
      }
      closeSongMenu();
    });
    document.getElementById('btn-song-act-add-pl')?.addEventListener('click', () => {
      const song = selectedMenuSong;
      closeSongMenu();
      if (song) openAddToPlaylistModal(song);
    });
    document.getElementById('btn-song-act-download')?.addEventListener('click', () => {
      if (selectedMenuSong) {
        downloadTrack(selectedMenuSong);
        Storage.addDownload(selectedMenuSong);
        UI.renderLibraryTab(activeLibraryTab, librarySearchQuery, librarySortMode);
      }
      closeSongMenu();
    });
    document.getElementById('btn-song-act-artist')?.addEventListener('click', () => {
      const artist = selectedMenuSong?.artists || selectedMenuSong?.primaryArtist;
      closeSongMenu();
      if (artist) openArtist(artist);
    });
    document.getElementById('btn-song-act-remove-pl')?.addEventListener('click', () => {
      if (selectedMenuPlaylistId && selectedMenuSong) {
        Storage.removeFromPlaylist(selectedMenuPlaylistId, selectedMenuSong.id);
        UI.renderLibraryTab(activeLibraryTab, librarySearchQuery, librarySortMode);
      }
      closeSongMenu();
    });

    // Playlist Action Sheet Listeners
    document.getElementById('btn-pl-act-play')?.addEventListener('click', () => {
      if (selectedMenuPlaylistId) playCustomPlaylist(selectedMenuPlaylistId);
      closePlaylistMenu();
    });
    document.getElementById('btn-pl-act-shuffle')?.addEventListener('click', () => {
      if (selectedMenuPlaylistId) shuffleCustomPlaylist(selectedMenuPlaylistId);
      closePlaylistMenu();
    });
    document.getElementById('btn-pl-act-play-next')?.addEventListener('click', () => {
      if (selectedMenuPlaylistId) playNextPlaylist(selectedMenuPlaylistId);
      closePlaylistMenu();
    });
    document.getElementById('btn-pl-act-queue')?.addEventListener('click', () => {
      if (selectedMenuPlaylistId) addPlaylistToQueue(selectedMenuPlaylistId);
      closePlaylistMenu();
    });
    document.getElementById('btn-pl-act-edit')?.addEventListener('click', () => {
      const plId = selectedMenuPlaylistId;
      closePlaylistMenu();
      if (plId) openEditPlaylistModal(plId);
    });
    document.getElementById('btn-pl-act-duplicate')?.addEventListener('click', () => {
      if (selectedMenuPlaylistId) duplicateCustomPlaylist(selectedMenuPlaylistId);
      closePlaylistMenu();
    });
    document.getElementById('btn-pl-act-delete')?.addEventListener('click', () => {
      if (selectedMenuPlaylistId) deleteCustomPlaylist(selectedMenuPlaylistId);
      closePlaylistMenu();
    });

    // 10. Settings & Profile Triggers (Both top button & avatar)
    document.getElementById('btn-open-settings')?.addEventListener('click', openSettings);
    document.getElementById('btn-user-profile')?.addEventListener('click', openProfile);

    // 11. Artist Screen Menu Trigger
    document.getElementById('btn-artist-menu')?.addEventListener('click', openArtistMenu);

    // 12. Artist Genre Pills Bar (All, Top Hits, Romantic, Melody, etc.)
    const artistGenreContainer = document.getElementById('artist-genre-pills');
    if (artistGenreContainer) {
      artistGenreContainer.addEventListener('click', async (e) => {
        const pill = e.target.closest('.artist-genre-pill');
        if (!pill) return;
        artistGenreContainer.querySelectorAll('.artist-genre-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        const genre = pill.dataset.genre || pill.textContent.trim();
        const artistName = activeArtistData?.name || document.getElementById('artist-main-name')?.textContent || '';
        if (!artistName) return;

        showLoader(true);
        try {
          const query = genre === 'All' ? artistName : `${artistName} ${genre}`;
          currentArtistSongs = await API.getArtistSongs(query, 25);
          isArtistTracksExpanded = false;
          UI.renderArtistTopTracks(currentArtistSongs, false);
        } catch (_) {}
        showLoader(false);
      });
    }

    // 13. Full Player Favorite Toggle
    document.getElementById('btn-player-favorite')?.addEventListener('click', () => {
      toggleFavoriteCurrent();
    });

    // 14. Keyboard Shortcuts for Playback
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        Player.togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const cur = Player.getState().position;
        Player.seek(Math.max(0, cur - 5));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const cur = Player.getState().position;
        Player.seek(cur + 5);
      } else if (e.key === 'n' || e.key === 'N') {
        animateToNext();
      } else if (e.key === 'p' || e.key === 'P') {
        animateToPrevious();
      } else if (e.key === 'l' || e.key === 'L') {
        toggleFavoriteCurrent();
      } else if (e.key === 'Escape') {
        const fullPlayer = document.getElementById('full-player');
        if (fullPlayer && fullPlayer.classList.contains('expanded')) {
          collapseFullPlayer();
        } else {
          document.querySelectorAll('.bottom-sheet-backdrop.active, .dialog-backdrop.active').forEach(el => {
            el.classList.remove('active');
          });
        }
      }
    });

    // 15. Full-player drag gestures live in js/motion.js (interactive, velocity-aware)
  }

  // ==========================================================================
  // 3D TINDER/APPLE MUSIC-STYLE SWIPE PLAYER (Deck Physics & Gesture Engine)
  // ==========================================================================
  const PlayerSwipeState = {
    IDLE: 'IDLE',
    DRAGGING: 'DRAGGING',
    COMMITTING_NEXT: 'COMMITTING_NEXT',
    COMMITTING_PREV: 'COMMITTING_PREV',
    READY: 'READY'
  };

  let playerSwipeState = PlayerSwipeState.READY;
  let isCardTransitioning = false;

  function transitionToNext() {
    if (isCardTransitioning) return;

    const queue = (typeof Player !== 'undefined' && Player.getQueue) ? Player.getQueue() : [];
    if (queue.length === 0) {
      if (typeof Player !== 'undefined' && Player.next) Player.next();
      return;
    }

    const curIdx = (typeof Player !== 'undefined' && Player.getCurrentIndex) ? Player.getCurrentIndex() : 0;
    const repeatMode = (typeof Player !== 'undefined' && Player.getRepeatMode) ? Player.getRepeatMode() : 'OFF';

    if (repeatMode === 'ONE') {
      Player.next();
      return;
    }

    const frontCard = document.getElementById('player-deck-front') || document.getElementById('player-art-card');
    const nextCard = document.getElementById('player-deck-next') || document.getElementById('player-deck-back-1');

    isCardTransitioning = true;
    playerSwipeState = PlayerSwipeState.COMMITTING_NEXT;

    if (frontCard) {
      frontCard.classList.remove('dragging', 'springing');
      frontCard.classList.add('committing');
      frontCard.style.transform = 'translate3d(-120%, 0, 0) rotate(-14deg)';
      frontCard.style.opacity = '0';
    }
    if (nextCard) {
      nextCard.style.display = 'block';
      nextCard.classList.remove('dragging', 'springing');
      nextCard.classList.add('committing');
      nextCard.style.transform = 'translate3d(0, 0, 0) scale(1) rotate(0deg)';
      nextCard.style.opacity = '1';
      nextCard.style.filter = 'brightness(1)';
    }

    setTimeout(() => {
      Player.next();
      setTimeout(() => {
        if (typeof UI !== 'undefined' && UI.renderPlayer3DDeck && Player.getCurrentTrack) {
          UI.renderPlayer3DDeck(Player.getCurrentTrack());
        }
        isCardTransitioning = false;
        playerSwipeState = PlayerSwipeState.READY;
      }, 60);
    }, 180);
  }

  function transitionToPrevious() {
    if (isCardTransitioning) return;

    const queue = (typeof Player !== 'undefined' && Player.getQueue) ? Player.getQueue() : [];
    if (queue.length === 0) {
      if (typeof Player !== 'undefined' && Player.previous) Player.previous();
      return;
    }

    const audio = (typeof Player !== 'undefined' && Player.getAudioElement) ? Player.getAudioElement() : null;
    if (audio && audio.currentTime > 3.0) {
      Player.previous();
      return;
    }

    const frontCard = document.getElementById('player-deck-front') || document.getElementById('player-art-card');
    const prevCard = document.getElementById('player-deck-prev');

    isCardTransitioning = true;
    playerSwipeState = PlayerSwipeState.COMMITTING_PREV;

    if (frontCard) {
      frontCard.classList.remove('dragging', 'springing');
      frontCard.classList.add('committing');
      frontCard.style.transform = 'translate3d(120%, 0, 0) rotate(14deg)';
      frontCard.style.opacity = '0';
    }
    if (prevCard) {
      prevCard.style.display = 'block';
      prevCard.classList.remove('dragging', 'springing');
      prevCard.classList.add('committing');
      prevCard.style.transform = 'translate3d(0, 0, 0) scale(1) rotate(0deg)';
      prevCard.style.opacity = '1';
      prevCard.style.filter = 'brightness(1)';
    }

    setTimeout(() => {
      Player.previous();
      setTimeout(() => {
        if (typeof UI !== 'undefined' && UI.renderPlayer3DDeck && Player.getCurrentTrack) {
          UI.renderPlayer3DDeck(Player.getCurrentTrack());
        }
        isCardTransitioning = false;
        playerSwipeState = PlayerSwipeState.READY;
      }, 60);
    }, 180);
  }

  function animateToNext() {
    return (typeof transitionToNext === 'function') ? transitionToNext() : (typeof Player !== 'undefined' && Player.next ? Player.next() : undefined);
  }

  function animateToPrevious() {
    return (typeof transitionToPrevious === 'function') ? transitionToPrevious() : (typeof Player !== 'undefined' && Player.previous ? Player.previous() : undefined);
  }

  function initPlayer3DDeckGesture() {
    const deckContainer = document.getElementById('player-3d-deck-container');
    if (!deckContainer || deckContainer._hasDeckGesture) return;
    deckContainer._hasDeckGesture = true;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let lastX = 0;
    let lastTime = 0;
    let velocityX = 0;
    let deltaX = 0;
    let deltaY = 0;
    let isDragging = false;
    let isSwiping = false;
    let animationFrame = null;

    const getFrontCard = () => document.getElementById('player-deck-front') || document.getElementById('player-art-card');
    const getNextCard = () => document.getElementById('player-deck-next') || document.getElementById('player-deck-back-1');
    const getPrevCard = () => document.getElementById('player-deck-prev');

    // Subtle 3D Pointer Tilt on Hover (Non-touch desktop devices)
    function onPointerHover(e) {
      if (isDragging || isSwiping || isCardTransitioning || (e.pointerType === 'touch')) return;
      const rect = deckContainer.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      const tiltX = -y * 8;
      const tiltY = x * 8;
      const front = getFrontCard();
      if (front && !isDragging && playerSwipeState === PlayerSwipeState.READY) {
        front.style.transform = `perspective(1000px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) scale(1.015)`;
      }
    }

    function onPointerHoverLeave() {
      const front = getFrontCard();
      if (front && !isDragging && !isCardTransitioning && playerSwipeState === PlayerSwipeState.READY) {
        front.style.transform = 'translate3d(0, 0, 0) scale(1) rotateX(0deg) rotateY(0deg) rotate(0deg)';
      }
    }

    function onPointerDown(e) {
      if (isCardTransitioning || playerSwipeState !== PlayerSwipeState.READY) return;
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a') || e.target.closest('.player-progress-wrap')) return;

      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;

      startX = clientX;
      startY = clientY;
      lastX = clientX;
      startTime = Date.now();
      lastTime = startTime;
      velocityX = 0;
      deltaX = 0;
      deltaY = 0;
      isDragging = true;
      isSwiping = false;
      playerSwipeState = PlayerSwipeState.DRAGGING;

      const front = getFrontCard();
      const nextC = getNextCard();
      const prevC = getPrevCard();

      if (front) {
        front.classList.remove('springing', 'committing');
        front.classList.add('dragging');
      }
      if (nextC) {
        nextC.classList.remove('springing', 'committing');
        nextC.classList.add('dragging');
      }
      if (prevC) {
        prevC.classList.remove('springing', 'committing');
        prevC.classList.add('dragging');
      }
    }

    function onPointerMove(e) {
      if (!isDragging || isCardTransitioning || playerSwipeState !== PlayerSwipeState.DRAGGING) return;
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      const clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;

      deltaX = clientX - startX;
      deltaY = clientY - startY;

      const now = Date.now();
      const dt = now - lastTime;
      if (dt > 8) {
        velocityX = (clientX - lastX) / dt;
        lastX = clientX;
        lastTime = now;
      }

      if (!isSwiping) {
        // Vertical gesture protection: If movement is primarily vertical, cancel card drag to allow pull-down collapse
        if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) {
          isDragging = false;
          playerSwipeState = PlayerSwipeState.READY;
          const front = getFrontCard();
          if (front) front.classList.remove('dragging');
          return;
        }
        if (Math.abs(deltaX) > 8 && Math.abs(deltaX) >= Math.abs(deltaY)) {
          isSwiping = true;
        }
      }

      if (isSwiping) {
        if (e.cancelable) e.preventDefault();
        if (animationFrame) cancelAnimationFrame(animationFrame);

        animationFrame = requestAnimationFrame(() => {
          const front = getFrontCard();
          const nextC = getNextCard();
          const prevC = getPrevCard();

          if (front) {
            const rot = Math.max(-15, Math.min(15, deltaX * 0.045));
            const vertParallax = deltaY * 0.08;
            front.style.transform = `translate3d(${deltaX}px, ${vertParallax}px, 0) rotate(${rot}deg)`;
          }

          // Dragging Left -> Next card scales up into foreground
          if (deltaX < 0) {
            const progress = Math.min(1, Math.abs(deltaX) / 180);
            const scale = 0.92 + (0.08 * progress);
            const ty = -10 + (10 * progress);
            const tz = -30 + (30 * progress);
            const r = 1.5 - (1.5 * progress);

            if (nextC) {
              nextC.style.display = 'block';
              nextC.style.transform = `translate3d(0, ${ty}px, ${tz}px) scale(${scale}) rotate(${r}deg)`;
              nextC.style.opacity = String(0.75 + (0.25 * progress));
              nextC.style.filter = `brightness(${0.85 + (0.15 * progress)})`;
            }
            if (prevC) {
              prevC.style.transform = 'translate3d(0, -10px, -30px) scale(0.92) rotate(-1.5deg)';
              prevC.style.opacity = '0.75';
            }
          }
          // Dragging Right -> Previous card scales up into foreground
          else if (deltaX > 0) {
            const progress = Math.min(1, deltaX / 180);
            const scale = 0.92 + (0.08 * progress);
            const ty = -10 + (10 * progress);
            const tz = -30 + (30 * progress);
            const r = -1.5 + (1.5 * progress);

            if (prevC) {
              prevC.style.display = 'block';
              prevC.style.transform = `translate3d(0, ${ty}px, ${tz}px) scale(${scale}) rotate(${r}deg)`;
              prevC.style.opacity = String(0.75 + (0.25 * progress));
              prevC.style.filter = `brightness(${0.85 + (0.15 * progress)})`;
            }
            if (nextC) {
              nextC.style.transform = 'translate3d(0, -10px, -30px) scale(0.92) rotate(1.5deg)';
              nextC.style.opacity = '0.75';
            }
          }
        });
      }
    }

    function onPointerUp() {
      if (!isDragging) return;
      isDragging = false;

      const front = getFrontCard();
      const nextC = getNextCard();
      const prevC = getPrevCard();

      if (front) front.classList.remove('dragging');
      if (nextC) nextC.classList.remove('dragging');
      if (prevC) prevC.classList.remove('dragging');

      // Tapping the card without swiping: no side effects
      if (!isSwiping) {
        playerSwipeState = PlayerSwipeState.READY;
        return;
      }
      isSwiping = false;

      const cardWidth = front ? (front.offsetWidth || 300) : 300;
      const distanceThreshold = Math.max(60, cardWidth * 0.25);
      const SWIPE_THRESHOLD = distanceThreshold;
      const isFastFlick = Math.abs(velocityX) > 0.45;

      // Swipe Left -> Next Track (delegates to Player.next())
      if (deltaX < -SWIPE_THRESHOLD || (deltaX < -30 && velocityX < -0.45)) {
        transitionToNext();
      }
      // Swipe Right -> Previous Track (delegates to Player.previous())
      else if (deltaX > SWIPE_THRESHOLD || (deltaX > 30 && velocityX > 0.45)) {
        transitionToPrevious();
      }
      // Cancelled Swipe -> Spring smoothly back to center without changing audio/queue
      else {
        if (front) {
          front.classList.add('springing');
          front.style.transform = 'translate3d(0, 0, 0) scale(1) rotate(0deg)';
          front.style.opacity = '1';
          front.style.filter = 'brightness(1)';
        }
        if (nextC) {
          nextC.classList.add('springing');
          nextC.style.transform = 'translate3d(0, -10px, -30px) scale(0.92) rotate(1.5deg)';
          nextC.style.opacity = '0.75';
          nextC.style.filter = 'brightness(0.85)';
        }
        if (prevC) {
          prevC.classList.add('springing');
          prevC.style.transform = 'translate3d(0, -10px, -30px) scale(0.92) rotate(-1.5deg)';
          prevC.style.opacity = '0.75';
          prevC.style.filter = 'brightness(0.85)';
        }

        setTimeout(() => {
          if (front) front.classList.remove('springing');
          if (nextC) nextC.classList.remove('springing');
          if (prevC) prevC.classList.remove('springing');
          playerSwipeState = PlayerSwipeState.READY;
        }, 350);
      }
    }

    deckContainer.addEventListener('mousemove', onPointerHover);
    deckContainer.addEventListener('mouseleave', onPointerHoverLeave);

    deckContainer.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove, { passive: false });
    window.addEventListener('mouseup', onPointerUp);

    deckContainer.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);

    window._animateToNext = transitionToNext;
    window._animateToPrevious = transitionToPrevious;
  }

  function navigateToArtist(artist) {
    if (!artist) return;
    let artistName = '';
    if (typeof artist === 'string') {
      artistName = artist.trim();
    } else if (typeof artist === 'object') {
      artistName = (artist.name || artist.title || '').trim();
    }
    if (!artistName || artistName.toLowerCase() === 'unknown artist') return;

    if (typeof collapseFullPlayer === 'function') {
      collapseFullPlayer();
    }
    openArtist(artistName);
  }

  // Queue Drag & Drop Reordering Support
  let draggedQueueIndex = -1;

  function handleQueueDragStart(e, index) {
    draggedQueueIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleQueueDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }

  function handleQueueDrop(e, targetIndex) {
    e.preventDefault();
    if (draggedQueueIndex >= 0 && targetIndex >= 0 && draggedQueueIndex !== targetIndex) {
      Player.reorderQueue(draggedQueueIndex, targetIndex);
    }
    draggedQueueIndex = -1;
  }

  function removeTrackFromQueue(index) {
    if (typeof Player !== 'undefined' && Player.removeFromQueue) {
      Player.removeFromQueue(index);
    }
  }

  // ==========================================================================
  // AUTHORITATIVE NAVIGATION ROUTER & BACK GESTURE ENGINE
  // ==========================================================================
  function resetScrollToTop() {
    // Only the scrollers that can actually be scrolled: every extra scrollTo() forces a layout.
    const main = document.getElementById('main-scroll-container');
    if (main && main.scrollTop) main.scrollTop = 0;
    const active = document.querySelector('.screen.active');
    if (active && active.scrollTop) active.scrollTop = 0;
    const detailScreen = document.getElementById('screen-detail');
    if (detailScreen && detailScreen.scrollTop) detailScreen.scrollTop = 0;
  }

  const navHistory = [{ screen: 'home', state: null, timestamp: Date.now() }];
  const MAX_HISTORY_LENGTH = 35;

  function pushHistory(screen, state = null) {
    if (!screen) return;
    const current = navHistory[navHistory.length - 1];
    // Prevent duplicate consecutive history entries (Part 8 tab reselection & Part 49)
    if (current && current.screen === screen && JSON.stringify(current.state) === JSON.stringify(state)) {
      return;
    }
    navHistory.push({ screen, state, timestamp: Date.now() });
    if (navHistory.length > MAX_HISTORY_LENGTH) {
      navHistory.shift();
    }
  }

  // Fluent shell: the navigation rail is an overlay on phones
  const FL_TITLES = { home: 'Explore', explore: 'Browse', radio: 'Radio', search: 'Search', library: 'Collection', samples: 'Samples', detail: 'Album', artist: 'Artist', genre: 'Genre' };
  function toggleRail() { document.body.classList.toggle('rail-open'); }
  function closeRail() { document.body.classList.remove('rail-open'); }
  // Panorama header on the phone: the page title with the next page's title peeking in (Xbox Music)
  const PIVOT_ORDER = ['home', 'explore', 'radio', 'library'];
  function setTopbarTitle(screen) {
    const el = document.getElementById('fl-topbar-title');
    if (el && FL_TITLES[screen]) el.textContent = FL_TITLES[screen];
    const next = document.getElementById('fl-pivot-next');
    if (next) {
      const i = PIVOT_ORDER.indexOf(screen);
      const nextScreen = i >= 0 ? PIVOT_ORDER[(i + 1) % PIVOT_ORDER.length] : '';
      next.textContent = nextScreen ? FL_TITLES[nextScreen] : '';
      next.dataset.target = nextScreen;
      next.style.display = nextScreen ? '' : 'none';
    }
  }
  // Left pane (Xbox Music): the user's playlists under "+ new playlist", and the search box
  function renderRailPlaylists() {
    const host = document.getElementById('rail-playlists');
    if (!host) return;
    let pls = [];
    try { pls = (typeof Storage !== 'undefined' && Storage.getPlaylists) ? (Storage.getPlaylists() || []) : []; } catch (_) { pls = []; }
    const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const html = pls.slice(0, 14).map(pl => `<button class="nav-extra rail-playlist" onclick="App.openPlaylist('${esc(pl.id)}')" title="${esc(pl.name)}"><span class="material-symbols-outlined nav-icon">queue_music</span><span class="nav-label">${esc(pl.name)}</span></button>`).join('');
    if (host._mfHtml === html) return;
    host._mfHtml = html;
    host.innerHTML = html;
  }
  function railSearch(ev) {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    const box = document.getElementById('rail-search-input');
    const q = box ? box.value.trim() : '';
    navigate('search');
    if (q) {
      const inp = document.getElementById('search-input');
      if (inp) inp.value = q;
      try { performSearch(q, 'All', true); } catch (_) {}
    }
    return false;
  }
  function navigatePivotNext() {
    const next = document.getElementById('fl-pivot-next');
    const target = next && next.dataset.target;
    if (target) navigate(target);
  }

  // iPhone in the Safari browser view keeps Safari's status bar and bottom bar; only an installed
  // (Add to Home Screen) app fills the screen. Say so once.
  const IOS_HINT_KEY = 'mf_ios_hint_dismissed';
  function showIosFullscreenHint() {
    const ua = navigator.userAgent || '';
    const isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let standalone = window.navigator.standalone === true;
    try { standalone = standalone || window.matchMedia('(display-mode: standalone)').matches; } catch (_) {}
    const native = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.isNativeApp === 'function') ? ApiConfig.isNativeApp() : false;
    if (!isIos || standalone || native) return;
    // Safari keeps its own bars; the hint comes back once a day until the app is opened from the home screen.
    try { const t = Number(localStorage.getItem(IOS_HINT_KEY) || 0); if (t && Date.now() - t < 24 * 3600 * 1000) return; } catch (_) {}
    const el = document.getElementById('ios-fullscreen-hint');
    if (el) el.style.display = 'flex';
  }
  function dismissIosHint() {
    try { localStorage.setItem(IOS_HINT_KEY, String(Date.now())); } catch (_) {}
    const el = document.getElementById('ios-fullscreen-hint');
    if (el) el.style.display = 'none';
  }

  // ---- iPhone home-screen app: the real screen vs. the layout viewport ---------------------------
  // WebKit can lay the page out in a viewport that is shorter than the screen by the status bar while it still
  // draws from the top edge; the strip at the bottom is that difference. It is measured here into --ios-gap and
  // the phone layer stretches the fixed layers by it. Only an installed (standalone) app on an iPhone/iPad qualifies.
  function isIosDevice() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function fixIosViewportGap() {
    if (!isIosDevice() || window.navigator.standalone !== true) return;
    const apply = () => {
      const landscape = window.innerWidth > window.innerHeight;
      const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
      let gap = Math.round(full - window.innerHeight);
      if (!(gap > 0 && gap < 120)) gap = 0;
      document.documentElement.style.setProperty('--ios-gap', gap + 'px');
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', () => setTimeout(apply, 350));
  }
  // Open the app with ?diag=1 to see the numbers behind the layout (for screenshots from a real phone).
  function showScreenDiagnostics() {
    if (!/[?&#]diag=1/.test(location.search + location.hash)) return;
    const el = document.createElement('pre');
    el.id = 'screen-diag';
    el.style.cssText = 'position:fixed;left:8px;right:8px;top:50%;transform:translateY(-50%);z-index:100000;background:#107C10;color:#fff;font:12px/1.5 monospace;padding:12px;white-space:pre-wrap;border:2px solid #fff;margin:0;';
    const rect = (sel) => { const e = document.querySelector(sel); if (!e) return '-'; const b = e.getBoundingClientRect(); return `${Math.round(b.top)}..${Math.round(b.bottom)} (h ${Math.round(b.height)})`; };
    const render = () => {
      const cs = getComputedStyle(document.documentElement);
      const vv = window.visualViewport;
      el.textContent = [
        'standalone ' + window.navigator.standalone + '   displayMode ' + (window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'),
        'inner ' + window.innerWidth + 'x' + window.innerHeight + '   screen ' + screen.width + 'x' + screen.height,
        'client ' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight + '   visual ' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) + ' @' + Math.round(vv.offsetTop) : '-'),
        'safe-top ' + cs.getPropertyValue('--safe-top').trim() + '   safe-bottom ' + cs.getPropertyValue('--safe-bottom').trim() + '   ios-gap ' + (cs.getPropertyValue('--ios-gap').trim() || '0px'),
        'app ' + rect('.app-container') + '   main ' + rect('#main-scroll-container'),
        'topbar ' + rect('#fl-topbar') + '   mini ' + rect('#mini-player'),
        'ua ' + String(navigator.userAgent).slice(0, 110)
      ].join('\n');
    };
    document.body.appendChild(el);
    render();
    setInterval(render, 1000);
  }

  function openDownloadPage() {
    try { window.open('download/', '_blank'); } catch (_) { window.location.href = 'download/'; }
  }

  function setAccent(hex) {
    if (typeof ThemeManager !== 'undefined' && ThemeManager.setTheme) ThemeManager.setTheme(hex);
    renderAccentSetting();
  }

  function renderAccentSetting() {
    const cur = (typeof ThemeManager !== 'undefined' && ThemeManager.getTheme) ? String(ThemeManager.getTheme().color || '').toUpperCase() : '';
    document.querySelectorAll('.accent-swatch').forEach(b => b.classList.toggle('active', String(b.dataset.accent || '').toUpperCase() === cur));
  }

  function navigate(targetScreen, addToHistory = true, state = null) {
    if (!targetScreen) return;
    closeRail();
    setTopbarTitle(targetScreen);
    try { renderRailPlaylists(); } catch (_) {}
    // Re-tapping the current tab scrolls it back to the top (Apple Music behaviour)
    const tabScreenShowing = !!document.getElementById(`screen-${targetScreen}`)?.classList.contains('active');
    if (addToHistory && targetScreen === activeTab && tabScreenShowing && ['home', 'explore', 'radio', 'library', 'search'].includes(targetScreen)
        && !document.body.classList.contains('lib-section-open')) {
      if (typeof Motion !== 'undefined' && Motion.scrollToTop) Motion.scrollToTop(); else resetScrollToTop();
      return;
    }
    if (addToHistory) {
      pushHistory(targetScreen, state);
    }
    activeTab = targetScreen;

    // Update Bottom Nav Tab Highlights
    document.querySelectorAll('.floating-bottom-nav .nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.target === targetScreen);
    });

    // Switch Visible Screen
    document.querySelectorAll('.screen').forEach(scr => {
      scr.classList.remove('active');
    });

    const activeEl = document.getElementById(`screen-${targetScreen}`);
    if (activeEl) {
      activeEl.classList.add('active');
    }
    resetScrollToTop();
    try { window.dispatchEvent(new CustomEvent('mf_screen_change', { detail: { screen: targetScreen } })); } catch (_) {}

    // Refresh contents if needed
    if (targetScreen === 'library') {
      if (addToHistory) closeLibrarySection(true);   // tab tap lands on the Library root
      const activeLibTab = document.querySelector('.lib-tab-btn.active')?.dataset.tab || 'playlists';
      UI.renderLibraryTab(activeLibTab);
      renderLibraryRecent();
    } else if (targetScreen === 'radio') {
      if (typeof RadioScreen !== 'undefined') { try { RadioScreen.render(); } catch (e) { console.warn('[Radio] render failed:', e.message); } }
    } else if (targetScreen === 'explore') {
      loadExplore();
    } else if (targetScreen === 'samples') {
      if (typeof SamplesFeed !== 'undefined' && typeof SamplesFeed.init === 'function') {
        SamplesFeed.init();
      }
    }
  }

  function restoreScreen(screen, state) {
    if (screen === 'artist' && state && state.artistName) {
      openArtist(state.artistName, false);
    } else if (screen === 'genre' && state && state.genreName) {
      openGenre(state.genreName, false);
    } else if (screen === 'album' && state) {
      openAlbum(state.albumId, state.albumTitle, state.artistName, false);
    } else if (screen === 'detail' && state) {
      if (state.type === 'playlist' && state.playlistId) {
        openPlaylist(state.playlistId, state.playlistTitle, false);
      } else if (state.playlistId) {
        const customPl = (typeof Storage !== 'undefined' && Storage.getPlaylistById) ? Storage.getPlaylistById(state.playlistId) : null;
        if (customPl) openCustomPlaylist(state.playlistId, false);
        else openPlaylist(state.playlistId, state.playlistTitle, false);
      }
      else if (state.albumId) openAlbum(state.albumId, state.albumTitle, state.artistName, false);
      else if (state.item) openAlbum(state.item, '', '', false);
      else navigate('library', false);
    } else {
      navigate(screen, false);
    }
  }

  function handleBack() {
    // 1. Keyboard / Text Input Dismissal (Priority 1)
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      document.activeElement.blur();
      return true;
    }

    // 2. Open Modal Dialogs (Priority 2)
    const openModals = [
      'modal-create-playlist',
      'modal-add-to-playlist',
      'dialog-language-picker',
      'dialog-playlist-picker',
      'dialog-quality',
      'dialog-storage-limit',
      'dialog-auto-cleanup'
    ];
    for (const modalId of openModals) {
      const el = document.getElementById(modalId);
      if (el) {
        const isVisible = (el.classList.contains('active') || el.style.display === 'flex' || el.style.display === 'block');
        if (isVisible) {
          if (modalId === 'modal-create-playlist') closeCreatePlaylistModal();
          else if (modalId === 'modal-add-to-playlist') closeAddToPlaylistModal();
          else closeDialog(modalId);
          return true;
        }
      }
    }

    // 2.5 YouTube Music Player Sliding Drawer (Priority 2.5)
    const playerDrawer = document.getElementById('player-sliding-drawer');
    if (playerDrawer && playerDrawer.classList.contains('expanded')) {
      collapsePlayerDrawer();
      return true;
    }

    // 3. Open Bottom Sheets (Priority 3)
    const openSheets = [
      'sheet-lyric-actions',
      'sheet-comments',
      'sheet-audio-output',
      'sheet-song-menu',
      'sheet-artist-menu',
      'sheet-equalizer',
      'sheet-sleep-timer',
      'sheet-storage-cleanup',
      'sheet-queue',
      'sheet-settings'
    ];
    for (const sheetId of openSheets) {
      const el = document.getElementById(sheetId);
      if (el && el.classList.contains('active')) {
        closeBottomSheet(sheetId);
        return true;
      }
    }

    // 4. Live Synced Lyrics Overlay inside Player (Priority 4)
    const lyricsView = document.getElementById('player-lyrics-view');
    if (lyricsView && lyricsView.style.display === 'flex') {
      toggleLyricsView();
      return true;
    }

    // 5. Full Player Sheet Dismissal (Priority 5)
    const fullPlayer = document.getElementById('full-player');
    if (fullPlayer && fullPlayer.classList.contains('expanded')) {
      collapseFullPlayer();
      return true;
    }

    // 5.5 Library section (Playlists / Artists / …) goes back to the Library root first
    if (activeTab === 'library' && document.body.classList.contains('lib-section-open')) {
      closeLibrarySection();
      return true;
    }

    // 6. Navigation History Stack Unwind (Priority 6 & 7)
    if (navHistory.length > 1) {
      navHistory.pop(); // Remove current top
      const prev = navHistory[navHistory.length - 1];
      if (prev) {
        restoreScreen(prev.screen, prev.state);
        return true;
      }
    }

    // 7. If currently on a non-home screen with empty history, return to Home
    if (activeTab !== 'home') {
      navigate('home', false);
      return true;
    }

    // 8. At Root Home Screen with no overlays -> Return false (Signals Android OS to exit/minimize)
    return false;
  }

  function goBack() {
    return handleBack();
  }

  // ==========================================================================
  // EXPLORE & GENRE NAVIGATION (Phase 7)
  // ==========================================================================
  let activeGenreData = null;

  async function loadExplore() {
    initSwipeDiscovery();
    if (typeof ExploreDataLayer !== 'undefined') {
      try {
        ExploreDataLayer.loadExplore((data, isCache) => {
          if (data) {
            UI.renderExploreFeed(data);
          }
        });
      } catch (e) {
        console.warn('[App] Explore feed load error:', e);
      }
    }
  }

  async function openGenre(genreName, addToHistory = true) {
    if (!genreName) return;
    if (addToHistory) {
      pushHistory('genre', { genreName });
    }
    showLoader(true);
    try {
      if (typeof ExploreDataLayer !== 'undefined') {
        const genreData = await ExploreDataLayer.getGenreDetails(genreName);
        activeGenreData = genreData;
        UI.renderGenrePage(genreData);
        navigate('genre', false);
      } else {
        searchCategory(genreName);
      }
    } catch (e) {
      console.warn('[App] Failed to open genre:', e);
      searchCategory(genreName);
    } finally {
      showLoader(false);
    }
  }

  function playAllGenreSongs() {
    if (!activeGenreData || !activeGenreData.songs || activeGenreData.songs.length === 0) return;
    Player.setQueue(activeGenreData.songs, 0);
    Player.play();
  }

  async function startGenreRadio() {
    if (!activeGenreData || !activeGenreData.songs || activeGenreData.songs.length === 0) return;
    const seedSong = activeGenreData.songs[0];
    if (typeof RecommendationEngine !== 'undefined') {
      try {
        const radioQueue = await RecommendationEngine.buildRadioQueue(seedSong, activeGenreData.songs);
        Player.setQueue(radioQueue, 0);
        Player.play();
        UI.showToast(`Starting ${activeGenreData.title} Radio`);
      } catch (_) {
        Player.setQueue(activeGenreData.songs, 0);
        Player.play();
      }
    } else {
      Player.setQueue(activeGenreData.songs, 0);
      Player.play();
    }
  }

  // ==========================================================================
  // ARTIST PROFILE SCREEN
  // ==========================================================================
  async function openArtist(artistNameOrId, addToHistory = true) {
    if (!artistNameOrId) return;
    showLoader(true);

    try {
      const artistData = await API.getArtistDetails(artistNameOrId);
      let name = (artistData?.name || artistData?.title || '').split(';')[0].split(',')[0].trim();

      // If name is still numeric or empty, resolve cleanly
      if (!name || /^[0-9]+$/.test(name)) {
        if (!/^[0-9]+$/.test(String(artistNameOrId).trim())) {
          name = String(artistNameOrId).trim();
        } else {
          name = Player.getCurrentTrack()?.primaryArtist || 'Top Artist';
        }
      }

      if (addToHistory) {
        pushHistory('artist', { artistName: name });
      }

      activeArtistData = { ...(artistData || {}), name };

      const heroImg = document.getElementById('artist-hero-img');
      const heroName = document.getElementById('artist-hero-name');
      const mainName = document.getElementById('artist-main-name');
      const navTitle = document.getElementById('artist-top-nav-title');
      const listenersText = document.getElementById('artist-listeners-text');

      const img = API.getImageUrl(activeArtistData);

      if (heroImg) heroImg.src = img;
      if (heroName) heroName.textContent = name.toUpperCase();
      if (mainName) mainName.textContent = name;
      if (navTitle) navTitle.textContent = name;
      if (listenersText) {
        const rawCount = String(artistData?.fanCount || artistData?.playCount || '3234900');
        const numCount = parseInt(rawCount.replace(/[^0-9]/g, ''), 10) || 3234900;
        listenersText.textContent = `${numCount.toLocaleString()} listeners per month`;
      }

      // Reset Genre Pills to 'All'
      const pillsContainer = document.getElementById('artist-genre-pills');
      if (pillsContainer) {
        pillsContainer.querySelectorAll('.artist-genre-pill').forEach((p, idx) => {
          p.classList.toggle('active', idx === 0);
        });
      }

      // Fetch Top Songs with Strict Primary Artist Attribution
      currentArtistPage = 1;
      isArtistTracksExpanded = false;
      const cleanNameLower = name.toLowerCase().trim();
      const rawSongs = await API.getArtistSongs(name, 1, 30);
      currentArtistSongs = (rawSongs || []).filter(s => {
        if (!s || !s.name) return false;
        const art = (s.primaryArtist || s.artists || '').toLowerCase();
        return art.includes(cleanNameLower);
      });
      if (currentArtistSongs.length === 0 && rawSongs && rawSongs.length > 0) {
        currentArtistSongs = rawSongs;
      }
      UI.renderArtistTopTracks(currentArtistSongs, false);

      // Wire Artist Category Pills
      const genrePills = document.querySelectorAll('#artist-genre-pills .artist-genre-pill');
      genrePills.forEach(pill => {
        pill.classList.toggle('active', pill.dataset.genre === 'All');
        pill.onclick = () => filterArtistCategory(pill.dataset.genre || pill.textContent.trim());
      });

      // Hook Genuine Latest Release Card
      const recentSection = document.getElementById('artist-recent-section');
      const recentImg = document.getElementById('artist-recent-img');
      const recentTitle = document.getElementById('artist-recent-title');
      const recentSub = document.getElementById('artist-recent-sub');
      const recentCard = document.getElementById('artist-recent-card');

      if (currentArtistSongs.length > 0) {
        // Sort copy by year to identify latest release
        const sortedByYear = [...currentArtistSongs].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
        const latestTrack = sortedByYear[0] || currentArtistSongs[0];
        if (recentSection) recentSection.style.display = 'block';
        if (recentImg) recentImg.src = latestTrack.image || img;
        if (recentTitle) recentTitle.textContent = latestTrack.name;
        if (recentSub) recentSub.textContent = `${latestTrack.year || '2024'} • Latest Release • ${name}`;
        if (recentCard) recentCard.onclick = () => playSongWithQueue(latestTrack.id);
      }

      // Fetch & Render Albums and EPs Section
      const albumsSection = document.getElementById('artist-albums-section');
      const albumsContainer = document.getElementById('artist-albums-container');
      if (albumsSection && albumsContainer) {
        const albums = await API.searchAlbums(name, 1, 10).catch(() => []);
        if (albums && albums.length > 0) {
          albumsSection.style.display = 'block';
          albumsContainer.innerHTML = albums.map(alb => `
            <div class="music-square-card" onclick="App.openAlbum('${alb.id}', '${(alb.title || alb.name || 'Album').replace(/'/g, "\\'")}', '${name.replace(/'/g, "\\'")}')">
              <div class="square-card-art-wrap">
                <img src="${API.getImageUrl(alb)}" onerror="this.src='assets/logo.png'" alt="${alb.title || alb.name}">
                <div class="square-card-play-overlay"><span class="material-symbols-outlined fill-icon" style="font-size:20px;">play_arrow</span></div>
              </div>
              <div class="square-card-title">${alb.title || alb.name}</div>
              <div class="square-card-sub">${alb.year || 'Album'} • ${name}</div>
            </div>
          `).join('');
        } else {
          albumsSection.style.display = 'none';
        }
      }

      // Hook "Best of Artist" and "Artist Radio" playlist cards
      const plTitle1 = document.getElementById('artist-pl-title-1');
      const plTitle2 = document.getElementById('artist-pl-title-2');
      const plCard1 = document.getElementById('artist-pl-best');
      const plCard2 = document.getElementById('artist-pl-radio');

      if (plTitle1) plTitle1.textContent = `Best of ${name}`;
      if (plTitle2) plTitle2.textContent = `${name} Radio`;
      if (plCard1) plCard1.onclick = () => {
        if (currentArtistSongs.length > 0) {
          Player.setQueue(currentArtistSongs, 0);
          expandFullPlayer();
        }
      };
      if (plCard2) plCard2.onclick = () => startArtistRadio();

      // Fetch & Render Similar Artists
      const similarContainer = document.getElementById('artist-similar-container');
      if (similarContainer) {
        const artistQuery = (name || '').split(' ')[0] || 'Arijit';
        const simRes = await API.searchArtists(artistQuery, 1, 8);
        const filteredSim = (simRes || []).filter(a => (a.name || a.title || '').toLowerCase() !== name.toLowerCase());

        if (filteredSim.length > 0) {
          similarContainer.innerHTML = filteredSim.map(sim => `
            <div class="similar-artist-item" onclick="App.openArtist('${(sim.name || sim.title || '').replace(/'/g, "\\'")}')">
              <img class="similar-artist-avatar" src="${API.getImageUrl(sim)}" onerror="this.src='assets/logo.png'" alt="${sim.name || sim.title}">
              <span class="similar-artist-name">${sim.name || sim.title}</span>
            </div>
          `).join('');
        } else {
          const defaultPeers = [
            { name: 'Arijit Singh', img: 'https://c.saavncdn.com/artists/Arijit_Singh_002_20230323062147_500x500.jpg' },
            { name: 'Shreya Ghoshal', img: 'https://c.saavncdn.com/artists/Shreya_Ghoshal_004_20230323062147_500x500.jpg' },
            { name: 'Pritam', img: 'https://c.saavncdn.com/artists/Pritam_003_20230323062147_500x500.jpg' },
            { name: 'Diljit Dosanjh', img: 'https://c.saavncdn.com/artists/Diljit_Dosanjh_004_20221014163908_500x500.jpg' },
            { name: 'Atif Aslam', img: 'https://c.saavncdn.com/artists/Atif_Aslam_500x500.jpg' },
            { name: 'Badshah', img: 'https://c.saavncdn.com/artists/Badshah_005_20230609081822_500x500.jpg' }
          ];
          similarContainer.innerHTML = defaultPeers.map(p => `
            <div class="similar-artist-item" onclick="App.openArtist('${p.name}')">
              <img class="similar-artist-avatar" src="${p.img}" onerror="this.src='assets/logo.png'" alt="${p.name}">
              <span class="similar-artist-name">${p.name}</span>
            </div>
          `).join('');
        }
      }

      // Hook Artist Play All
      const playAllBtn = document.getElementById('btn-artist-play-all');
      if (playAllBtn) {
        playAllBtn.onclick = () => {
          if (currentArtistSongs.length > 0) {
            Player.setQueue(currentArtistSongs, 0);
            expandFullPlayer();
          }
        };
      }

      // Switch to Artist Screen
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('screen-artist')?.classList.add('active');

    } catch (err) {
      console.error('[App] openArtist error:', err);
    }
    showLoader(false);
  }

  function showRadioToast(message) {
    const toast = document.getElementById('radio-toast');
    const toastText = document.getElementById('radio-toast-text');
    if (!toast) return;
    if (toastText) toastText.textContent = message;

    toast.style.display = 'flex';
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.style.display = 'none';
      }, 350);
    }, 2800);
  }

  let currentRadioSessionId = 0;

  async function startRadio(songOrArtist) {
    const radioSessionId = ++currentRadioSessionId;
    let seedSong = null;
    let artistName = '';

    if (songOrArtist && typeof songOrArtist === 'object') {
      seedSong = songOrArtist;
      artistName = seedSong.primaryArtist || (typeof seedSong.artists === 'string' ? seedSong.artists.split(/[,;&/]/)[0].trim() : '') || seedSong.name || '';
    } else if (typeof songOrArtist === 'string' && songOrArtist.trim()) {
      artistName = songOrArtist.trim();
      const cur = Player.getCurrentTrack();
      if (cur && (cur.primaryArtist === artistName || (cur.artists && cur.artists.includes(artistName)))) {
        seedSong = cur;
      }
    } else {
      seedSong = Player.getCurrentTrack();
      if (seedSong) {
        artistName = seedSong.primaryArtist || (typeof seedSong.artists === 'string' ? seedSong.artists.split(/[,;&/]/)[0].trim() : '') || '';
      }
    }

    if (!artistName || artistName === 'undefined' || artistName === 'Artist' || artistName === 'Track') {
      const mainNameEl = document.getElementById('artist-main-name');
      const topTitleEl = document.getElementById('artist-top-nav-title');
      if (mainNameEl && mainNameEl.textContent && mainNameEl.textContent !== 'Artist Name' && mainNameEl.textContent !== 'undefined') {
        artistName = mainNameEl.textContent.trim();
      } else if (topTitleEl && topTitleEl.textContent && topTitleEl.textContent !== 'Artist' && topTitleEl.textContent !== 'undefined') {
        artistName = topTitleEl.textContent.trim();
      } else {
        artistName = Player.getCurrentTrack()?.primaryArtist || 'Top 50 Hits';
      }
    }

    artistName = API.decodeHtml(String(artistName || '')).split(';')[0].split(',')[0].trim();
    if (!artistName || artistName === 'undefined') artistName = 'Top 50 Hits';

    const radioTitle = seedSong ? `${seedSong.name} Radio` : `${artistName} Radio`;
    showRadioToast(`📻 Starting ${radioTitle}...`);

    showLoader(true);

    try {
      // MusicFlow Station builds the whole radio (language-matched, de-duplicated, non-repeating)
      let rankedRecommendations = [];
      try {
        rankedRecommendations = seedSong
          ? await Station.build(seedSong, { size: 30, mode: 'song' })
          : (artistName === 'Top 50 Hits'
            ? await Station.build({ query: 'top hits', name: 'Top Hits' }, { size: 30, mode: 'genre' })
            : await Station.build({ artistName }, { size: 30, mode: 'artist' }));
      } catch (e) {
        console.warn('[Radio] station failed:', e.message);
      }

      // Verify Session ID to prevent race conditions
      if (radioSessionId !== currentRadioSessionId) {
        console.log(`[Radio] Stale session #${radioSessionId} discarded in favor of #${currentRadioSessionId}`);
        showLoader(false);
        return;
      }

      if (!seedSong && rankedRecommendations.length > 0) {
        seedSong = rankedRecommendations.shift();
      }

      if (!seedSong) {
        UI.showToast(`Couldn't find songs for ${artistName} Radio`);
        showLoader(false);
        return;
      }
      if (typeof Station !== 'undefined' && Station.markQueued) Station.markQueued(rankedRecommendations);

      if (rankedRecommendations.length > 0) {
        // Update context titles in Full Player
        const contextTag = document.getElementById('player-context-tag');
        const contextTitle = document.getElementById('player-context-title');
        if (contextTag) contextTag.textContent = seedSong ? 'Song radio' : 'Artist radio';
        if (contextTitle) contextTitle.textContent = radioTitle;

        // Populate Player Queue with current track + all recommendations
        Player.startRadioQueue(seedSong, rankedRecommendations);
        UI.showToast(`Started Radio for ${seedSong.name} 📻`);
      } else {
        UI.showToast(`Couldn't find more songs for ${seedSong.name} Radio`);
      }
    } catch (e) {
      console.error('[Radio] startRadio error:', e);
      UI.showToast(`Couldn't find more songs for Radio`);
    }
    showLoader(false);
  }

  function startArtistRadio() {
    let name = activeArtistData?.name || activeArtistData?.title || '';
    if (!name || name === 'undefined' || name === 'Artist') {
      const mainNameEl = document.getElementById('artist-main-name');
      const topTitleEl = document.getElementById('artist-top-nav-title');
      name = (mainNameEl && mainNameEl.textContent !== 'Artist Name' ? mainNameEl.textContent.trim() : '') || 
             (topTitleEl && topTitleEl.textContent !== 'Artist' ? topTitleEl.textContent.trim() : '') || '';
    }
    if (!name || name === 'undefined') {
      name = Player.getCurrentTrack()?.primaryArtist || 'Top 50 Hits';
    }
    startRadio(name);
  }

  function toggleFollowArtist() {
    const artist = activeArtistData;
    const name = artist?.name || 'Artist';
    const followIcon = document.getElementById('artist-follow-icon');
    const isFollowed = followIcon?.textContent === 'thumb_up';
    if (followIcon) {
      followIcon.textContent = isFollowed ? 'thumb_up_off_alt' : 'thumb_up';
      followIcon.classList.toggle('fill-icon', !isFollowed);
    }
    UI.showToast(isFollowed ? `Unfollowed ${name}` : `Followed ${name}!`);
  }

  function filterArtistCategory(category) {
    const pills = document.querySelectorAll('#artist-genre-pills .artist-genre-pill');
    pills.forEach(p => p.classList.toggle('active', (p.dataset.genre || p.textContent.trim()) === category));

    if (!category || category === 'All') {
      UI.renderArtistTopTracks(currentArtistSongs, isArtistTracksExpanded);
      return;
    }

    const catLower = category.toLowerCase();
    const filtered = currentArtistSongs.filter(song => {
      const title = (song.name || song.title || '').toLowerCase();
      const album = (song.album || '').toLowerCase();

      if (catLower === 'top hits') {
        return true;
      }
      if (catLower === 'romantic') {
        return title.includes('love') || title.includes('tum') || title.includes('dil') || title.includes('ishq') || title.includes('romantic') || album.includes('romantic') || title.includes('tera') || title.includes('meri');
      }
      if (catLower === 'melody') {
        return title.includes('sufi') || title.includes('acoustic') || title.includes('unplugged') || title.includes('slow') || title.includes('melody') || album.includes('melody');
      }
      if (catLower.includes('90s')) {
        const yr = parseInt(song.year, 10);
        return (yr >= 1990 && yr <= 1999) || title.includes('90s') || album.includes('90s');
      }
      if (catLower === 'duets') {
        return (song.artists || '').includes(',') || (song.artists || '').includes('&') || title.includes('feat') || title.includes('duet');
      }
      return title.includes(catLower) || album.includes(catLower);
    });

    UI.renderArtistTopTracks(filtered.length > 0 ? filtered : currentArtistSongs.slice(0, 5), true);
  }

  let currentArtistPage = 1;

  function toggleAllArtistTracks() {
    isArtistTracksExpanded = !isArtistTracksExpanded;
    UI.renderArtistTopTracks(currentArtistSongs, isArtistTracksExpanded);
  }

  async function loadMoreArtistSongs() {
    const artist = activeArtistData;
    const name = artist?.name || document.getElementById('artist-main-name')?.textContent;
    if (!name) return;

    currentArtistPage++;
    showLoader(true);
    try {
      const moreSongs = await API.getArtistSongs(name, currentArtistPage, 25);
      if (moreSongs && moreSongs.length > 0) {
        currentArtistSongs.push(...moreSongs);
        isArtistTracksExpanded = true;
        UI.renderArtistTopTracks(currentArtistSongs, true);
      } else {
        UI.showToast('No more songs found for this artist.');
      }
    } catch (e) {
      console.error('[Artist] loadMore error:', e);
    }
    showLoader(false);
  }

  function openArtistMenu() {
    const artist = activeArtistData;
    const name = artist?.name || artist?.title || document.getElementById('artist-main-name')?.textContent || 'Artist';
    const img = API.getImageUrl(artist) || document.getElementById('artist-hero-img')?.src || 'assets/logo.png';

    const menuImg = document.getElementById('sheet-artist-menu-img');
    const menuTitle = document.getElementById('sheet-artist-menu-title');

    if (menuImg) menuImg.src = img;
    if (menuTitle) menuTitle.textContent = name;

    openBottomSheet('sheet-artist-menu');
  }

  function artistMenuAction(action) {
    const artist = activeArtistData;
    const name = artist?.name || artist?.title || 'Artist';
    closeBottomSheet('sheet-artist-menu');

    switch (action) {
      case 'start-radio':
        playMix(`${name} Radio Hits`);
        break;
      case 'follow':
        UI.showToast(`Followed ${name}!`);
        break;
      case 'share':
        if (navigator.share) {
          navigator.share({ title: name, text: `Check out ${name} on MusicFlow`, url: window.location.href });
        } else {
          navigator.clipboard.writeText(`${name} on MusicFlow`);
          UI.showToast('Artist profile link copied!');
        }
        break;
    }
  }

  let currentSearchResults = [];
  let searchCurrentPage = 1;
  let searchCurrentQuery = '';
  let searchCurrentCategory = 'All';

  // ==========================================================================
  // SEARCH DISPATCHER (Fluid Non-Blocking & Stale-Protected)
  // ==========================================================================
  async function performSearch(query, category = 'All', saveToHistory = false) {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) return;

    const thisReqId = ++searchRequestId;

    if (searchAbortController) {
      try { searchAbortController.abort(); } catch (_) {}
      searchAbortController = null;
    }
    searchAbortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    searchCurrentQuery = cleanQuery;
    searchCurrentCategory = category;
    searchCurrentPage = 1;

    if (saveToHistory) {
      Storage.addSearchHistory(cleanQuery);
      UI.renderRecentSearchChips();
    }

    const isOffline = (typeof OfflineManager !== 'undefined')
      ? OfflineManager.isOffline()
      : (typeof navigator !== 'undefined' && !navigator.onLine);

    if (isOffline) {
      // Offline Search mode
      const offlineRes = (typeof SearchEngine !== 'undefined' && SearchEngine.searchOffline)
        ? SearchEngine.searchOffline(cleanQuery)
        : (typeof OfflineManager !== 'undefined' ? OfflineManager.searchOffline(cleanQuery) : { songs: [], artists: [], albums: [], playlists: [] });

      if (thisReqId !== searchRequestId) return;

      currentSearchResults = offlineRes.songs || [];
      UI.renderSearchResults({
        songs: { results: currentSearchResults },
        artists: { results: offlineRes.artists || [] },
        albums: { results: offlineRes.albums || [] },
        playlists: { results: offlineRes.playlists || [] }
      }, category);
      return;
    }

    try {
      const results = await API.searchAll(cleanQuery, { signal: searchAbortController ? searchAbortController.signal : undefined });

      // Stale request guard: if user continued typing or cancelled, discard this result
      if (thisReqId !== searchRequestId) return;
      const activeVal = document.getElementById('search-input')?.value.trim();
      if (activeVal && activeVal !== cleanQuery) return;

      currentSearchResults = results?.songs?.results?.map(API.normalizeSong) || [];
      UI.renderSearchResults(results, category);
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.message === 'The operation was aborted')) {
        return; // Normal aborted request
      }
      if (thisReqId !== searchRequestId) return;

      console.warn('[App] Online search failed, attempting offline catalog fallback:', e);
      const offlineRes = (typeof SearchEngine !== 'undefined' && SearchEngine.searchOffline)
        ? SearchEngine.searchOffline(cleanQuery)
        : (typeof OfflineManager !== 'undefined' ? OfflineManager.searchOffline(cleanQuery) : { songs: [], artists: [], albums: [], playlists: [] });

      if (thisReqId !== searchRequestId) return;
      currentSearchResults = offlineRes.songs || [];
      UI.renderSearchResults({
        songs: { results: currentSearchResults },
        artists: { results: offlineRes.artists || [] },
        albums: { results: offlineRes.albums || [] },
        playlists: { results: offlineRes.playlists || [] }
      }, category);
    }
  }

  function filterSearchCategory(category) {
    const searchCatContainer = document.getElementById('search-category-chips');
    if (searchCatContainer) {
      searchCatContainer.querySelectorAll('.search-cat-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.cat === category);
      });
    }
    const q = document.getElementById('search-input')?.value.trim() || searchCurrentQuery;
    if (q) performSearch(q, category, false);
  }

  let loadingMoreSearch = false;
  async function loadMoreSearchSongs() {
    const q = searchCurrentQuery || document.getElementById('search-input')?.value.trim();
    if (!q || loadingMoreSearch) return;
    loadingMoreSearch = true;
    showLoader(true);
    const fresh = [];
    try {
      // The catalog repeats the same recording across many albums: keep paging until 10 genuinely new songs.
      for (let i = 0; i < 4 && fresh.length < 10; i++) {
        searchCurrentPage++;
        const more = await API.searchSongs(q, searchCurrentPage, 30, { lite: true });
        if (!more || more.length === 0) break;
        const novel = (typeof TrackDeduplicator !== 'undefined' && TrackDeduplicator.dedupeAgainst)
          ? TrackDeduplicator.dedupeAgainst([...currentSearchResults, ...fresh], more, q)
          : more.filter(s => !currentSearchResults.some(c => String(c.id) === String(s.id)));
        fresh.push(...novel);
        if (more.length < 30) break;
      }
      if (fresh.length > 0) {
        const startIdx = currentSearchResults.length;
        currentSearchResults.push(...fresh);
        UI.appendSearchSongs(fresh, startIdx);
      } else {
        UI.showToast('No more songs for this search');
        const btn = document.getElementById('btn-search-show-more');
        if (btn) btn.style.display = 'none';
      }
    } catch (e) {
      console.error('[Search] loadMore error:', e);
    }
    showLoader(false);
    loadingMoreSearch = false;
  }

  function setSearchQuery(term) {
    const searchInput = document.getElementById('search-input');
    navigate('search');
    if (searchInput) {
      searchInput.value = term;
      performSearch(term, 'All', true);
    }
  }

  function searchCategory(cat) {
    setSearchQuery(cat);
  }

  function clearSearchData() {
    Storage.clearSearchHistory();
    UI.renderRecentSearchChips();
  }

  // Voice Search (Web Speech API Parity)
  let voiceRecognition = null;
  function startVoiceSearch() {
    const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
    if (!SpeechRecognition) {
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Voice search is not supported in this browser');
      }
      return;
    }

    try {
      if (voiceRecognition) {
        voiceRecognition.abort();
      }
      const recognition = new SpeechRecognition();
      voiceRecognition = recognition;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      const voiceBtn = document.getElementById('btn-search-voice');
      if (voiceBtn) voiceBtn.classList.add('recording');
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Listening... Speak now');
      }

      recognition.onresult = (event) => {
        if (event.results && event.results[0] && event.results[0][0]) {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            setSearchQuery(transcript);
          }
        }
      };

      recognition.onerror = (err) => {
        console.warn('[VoiceSearch] Error:', err);
        if (typeof UI !== 'undefined' && UI.showToast) {
          UI.showToast('Could not recognize voice. Try again.');
        }
        if (voiceBtn) voiceBtn.classList.remove('recording');
      };

      recognition.onend = () => {
        if (voiceBtn) voiceBtn.classList.remove('recording');
      };

      recognition.start();
    } catch (e) {
      console.warn('[VoiceSearch] Start failed:', e);
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Voice search error: ' + (e.message || 'Permission denied'));
      }
    }
  }

  // Radio Builder Integration (Step 5)
  function openRadioBuilder() {
    if (typeof RadioBuilder !== 'undefined' && RadioBuilder.open) {
      RadioBuilder.open();
    } else {
      openBottomSheet('sheet-radio-builder');
    }
  }

  function setRadioVariety(variety) {
    if (typeof RadioBuilder !== 'undefined' && RadioBuilder.setVariety) {
      RadioBuilder.setVariety(variety);
    }
  }

  function setRadioMood(mood) {
    if (typeof RadioBuilder !== 'undefined' && RadioBuilder.setMood) {
      RadioBuilder.setMood(mood);
    }
  }

  function launchCustomRadio() {
    if (typeof RadioBuilder !== 'undefined' && RadioBuilder.launch) {
      RadioBuilder.launch();
    }
  }

  // ==========================================================================
  // PLAYBACK & SEAMLESS RADIO DISPATCHERS
  // ==========================================================================
  function playSongFromSearch(index) {
    if (currentSearchResults.length > 0 && index >= 0 && index < currentSearchResults.length) {
      const clicked = currentSearchResults[index];
      if (searchCurrentQuery) {
        Storage.addSearchHistory(searchCurrentQuery);
        UI.renderRecentSearchChips();
      }
      if (clicked) {
        clicked.isPlayable = true;
        if (!clicked.audioUrl && typeof API !== 'undefined' && API.getDownloadUrl) {
          const direct = API.getDownloadUrl(clicked);
          if (direct) {
            clicked.audioUrl = direct;
            clicked.streamUrl = direct;
          }
        }
      }
      try {
        console.log(`[Analytics] Search Interaction: query="${searchCurrentQuery}", clicked="${clicked?.name}", artist="${clicked?.artists}", pos=${index}`);
      } catch (_) {}
      Player.setQueue(currentSearchResults, index);
      expandFullPlayer();
    }
  }

  // ==========================================================================
  // ENDLESS HOME SUGGESTIONS
  // When the listener scrolls near the bottom of Home, another shelf is built
  // from their own taste: seeds rotate through recently played, liked and
  // quick-pick artists; similar-song and artist-hit lookups fill the shelf;
  // anything already on screen or recently played is skipped.
  // ==========================================================================
  const endlessFeed = { shelves: 0, loading: false, seedIndex: 0, shownIds: new Set(), usedArtists: new Set(), maxShelves: 12 };

  function endlessCollectShownIds() {
    const ids = endlessFeed.shownIds;
    try {
      document.querySelectorAll('#home-feed-sections [onclick*="playSongWithQueue"]').forEach(el => {
        const m = /playSongWithQueue\('([^']+)'\)/.exec(el.getAttribute('onclick') || '');
        if (m) ids.add(m[1]);
      });
    } catch (_) {}
    return ids;
  }

  function endlessSeeds() {
    const seeds = [];
    const push = (s, why) => {
      if (!s) return;
      const artist = (typeof DataNormalizer !== 'undefined' && DataNormalizer.getPrimaryArtist)
        ? DataNormalizer.getPrimaryArtist(s)
        : String(s.primaryArtist || s.artists || '').split(/[,;&/•+]/)[0].trim();
      if (!artist || /^(unknown|various)/i.test(artist)) return;
      if (seeds.some(x => x.artist.toLowerCase() === artist.toLowerCase())) return;
      if (endlessFeed.usedArtists.has(artist.toLowerCase())) return;   // one shelf per artist
      seeds.push({ song: s, artist, why });
    };
    try { (Storage.getHistory() || []).slice(0, 12).forEach(s => push(s, 'played')); } catch (_) {}
    try { (Storage.getFavorites() || []).slice(0, 12).forEach(s => push(s, 'liked')); } catch (_) {}
    try { ((homeFeedData && homeFeedData.quickPicks) || []).slice(0, 12).forEach(s => push(s, 'picks')); } catch (_) {}
    try { ((homeFeedData && homeFeedData.trendingNow) || []).slice(0, 8).forEach(s => push(s, 'trending')); } catch (_) {}
    return seeds;
  }

  async function loadMoreHomeSuggestions() {
    if (endlessFeed.loading || endlessFeed.shelves >= endlessFeed.maxShelves) return;
    const host = document.getElementById('home-feed-sections');
    const homeScreen = document.getElementById('screen-home');
    if (!host || !homeScreen || !homeScreen.classList.contains('active')) return;
    const seeds = endlessSeeds();
    if (!seeds.length) return;

    endlessFeed.loading = true;
    const seed = seeds[endlessFeed.seedIndex % seeds.length];
    endlessFeed.seedIndex++;
    endlessFeed.usedArtists.add(seed.artist.toLowerCase());
    const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

    const placeholder = document.createElement('section');
    placeholder.className = 'shelf-section endless-shelf';
    placeholder.innerHTML = `
      <div class="shelf-header"><div><h2 class="shelf-title">More like ${seed.artist}</h2></div></div>
      <div class="cards-horizontal-shelf"><div class="loading-shimmer-card" style="width:152px;height:152px;border-radius:10px;"></div><div class="loading-shimmer-card" style="width:152px;height:152px;border-radius:10px;"></div></div>`;
    host.appendChild(placeholder);

    try {
      let pool = [];
      if (seed.song && seed.song.id && typeof API !== 'undefined' && API.getSimilarSongs) {
        try { const sim = await withTimeout(API.getSimilarSongs(seed.song.id, 20), 10000); if (Array.isArray(sim)) pool.push(...sim); } catch (_) {}
      }
      if (pool.length < 12 && typeof API !== 'undefined' && API.searchSongs) {
        try { const hits = await withTimeout(API.searchSongs(`${seed.artist} hits`, 1, 20), 10000); if (Array.isArray(hits)) pool.push(...hits); } catch (_) {}
      }
      const TD = (typeof TrackDeduplicator !== 'undefined') ? TrackDeduplicator : null;
      if (TD && TD.deduplicate) pool = TD.deduplicate(pool);

      const shown = endlessCollectShownIds();
      let recentIds = new Set();
      try { recentIds = new Set((Storage.getHistory() || []).slice(0, 30).map(s => String(s.id))); } catch (_) {}
      const items = pool.filter(s => s && s.id && !shown.has(String(s.id)) && !recentIds.has(String(s.id))).slice(0, 12);

      if (items.length < 4) {
        placeholder.remove();
        endlessFeed.loading = false;
        if (endlessFeed.seedIndex < seeds.length * 2) return loadMoreHomeSuggestions();
        return;
      }

      registerTracks(items);
      if (homeFeedData) {
        if (!Array.isArray(homeFeedData.sections)) homeFeedData.sections = [];
        homeFeedData.sections.push({ id: `endless_${endlessFeed.shelves}`, title: `More like ${seed.artist}`, items });
      }
      items.forEach(s => endlessFeed.shownIds.add(String(s.id)));

      const whyText = seed.why === 'played' ? `Because you played ${seed.song.name || seed.artist}`
        : seed.why === 'liked' ? `Because you liked ${seed.song.name || seed.artist}`
        : `More like ${seed.artist}`;
      placeholder.innerHTML = `
        <div class="shelf-header">
          <div>
            <span class="shelf-tag">FOR YOU</span>
            <h2 class="shelf-title">${whyText.length > 34 ? `More like ${seed.artist}` : whyText}</h2>
          </div>
        </div>
        <div class="cards-horizontal-shelf">
          ${items.map(song => `
          <div class="music-square-card" onclick="App.playSongWithQueue('${song.id}')">
            <div class="square-card-art-wrap">
              <img src="${(typeof API !== 'undefined' && API.getImageUrl) ? API.getImageUrl(song) : (song.image || 'assets/logo.png')}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="">
              <div class="square-card-play-overlay"><span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span></div>
            </div>
            <div class="square-card-title">${(typeof DataNormalizer !== 'undefined' && DataNormalizer.getTrackTitle) ? DataNormalizer.getTrackTitle(song) : (song.name || '')}</div>
            <div class="square-card-sub">${(typeof DataNormalizer !== 'undefined' && DataNormalizer.getArtistString) ? DataNormalizer.getArtistString(song) : (song.primaryArtists || song.artists || '')}</div>
          </div>`).join('')}
        </div>`;
      endlessFeed.shelves++;
    } catch (e) {
      console.warn('[Home] endless suggestions notice:', e.message);
      placeholder.remove();
    } finally {
      endlessFeed.loading = false;
    }
  }

  function setupEndlessHomeFeed() {
    const scroller = document.getElementById('main-scroll-container');
    if (!scroller || scroller._endlessWired) return;
    scroller._endlessWired = true;
    let ticking = false;
    scroller.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        if (remaining < 900) loadMoreHomeSuggestions();
      });
    }, { passive: true });
  }

  function playSongWithQueue(songId) {
    if (!songId) return;
    const strId = String(songId);
    let song = trackRegistry.get(strId);
    let contextQueue = null;

    if (!song && homeFeedData) {
      if (Array.isArray(homeFeedData.sections)) {
        for (const sec of homeFeedData.sections) {
          if (Array.isArray(sec.items)) {
            const match = sec.items.find(s => String(s.id) === strId);
            if (match) {
              song = match;
              contextQueue = sec.items;
              registerTracks(sec.items);
              break;
            }
          }
        }
      }
      if (!song) {
        const allHome = [
          ...(homeFeedData.listenAgain || []),
          ...(homeFeedData.quickPicks || []),
          ...(homeFeedData.trending?.songs || []),
          ...(homeFeedData.trendingNow || []),
          ...(homeFeedData.topSongs || [])
        ];
        song = allHome.find(s => String(s.id) === strId);
        if (song) {
          contextQueue = allHome;
          registerTracks(allHome);
        }
      }
    }

    if (!song && typeof Storage !== 'undefined') {
      const recents = Storage.getHistory() || [];
      const favs = Storage.getFavorites() || [];
      const downloads = (typeof Storage.getDownloads === 'function') ? (Storage.getDownloads() || []) : [];
      const allLocal = [...recents, ...favs, ...downloads];
      song = allLocal.find(s => String(s.id) === strId);
      if (song) {
        contextQueue = recents.length > 1 ? recents : [song];
        registerTrack(song);
      }
    }

    if (song) {
      registerTrack(song);
      song.isPlayable = true;
      Player.playSong(song, contextQueue || [song]);
      expandFullPlayer();
      return;
    }

    // Fallback: fetch details from API
    API.getSongDetails(strId).then(details => {
      if (details && details.length > 0) {
        registerTracks(details);
        Player.playSong(details[0], details);
      } else {
        const placeholder = { id: strId, name: 'Song', provider: 'jiosaavn' };
        Player.playSong(placeholder, [placeholder]);
      }
      expandFullPlayer();
    }).catch(() => {
      const placeholder = { id: strId, name: 'Song', provider: 'jiosaavn' };
      Player.playSong(placeholder, [placeholder]);
      expandFullPlayer();
    });
  }

  function playSongFromArtistList(index) {
    if (currentArtistSongs.length > 0 && index >= 0 && index < currentArtistSongs.length) {
      Player.setQueue(currentArtistSongs, index);
      expandFullPlayer();
    }
  }

  function playSongFromFavs(index) {
    const favs = Storage.getFavorites();
    if (favs.length > 0 && index >= 0 && index < favs.length) {
      Player.setQueue(favs, index);
      expandFullPlayer();
    }
  }

  async function playMix(query) {
    showLoader(true);
    try {
      const songs = await API.searchSongs(query, 1, 24);
      if (songs.length > 0) {
        Player.setQueue(songs, 0);
        expandFullPlayer();
      }
    } catch (_) {}
    showLoader(false);
  }



  // ==========================================================================
  // CUSTOM HIGH-PRECISION SEEK INTERACTION ENGINE (Design 1 Replica)
  // ==========================================================================
  function initSeekBar() {
    const seekBar = document.getElementById('player-seek-bar');
    const seekTrack = document.getElementById('player-seek-track');
    const seekFill = document.getElementById('player-seek-fill');
    const seekThumb = document.getElementById('player-seek-thumb');
    const curTimeEl = document.getElementById('player-time-current');

    if (!seekBar) return;
    if (seekBar._isSeekInitialized) return;
    seekBar._isSeekInitialized = true;

    let isPointerDown = false;
    let seekSafetyTimer = null;

    function getProgressFromCoord(clientX) {
      const targetEl = seekTrack || seekBar;
      const rect = targetEl.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const rawProgress = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(1, rawProgress));
    }

    let lastTickBucket = -1;
    function updateVisualSeek(progress) {
      const pct = (progress * 100).toFixed(2);
      if (isPointerDown) {
        const bucket = Math.floor(progress * 10);
        if (bucket !== lastTickBucket) { lastTickBucket = bucket; triggerHaptic(5); }
      } else {
        lastTickBucket = -1;
      }
      if (seekFill) seekFill.style.width = `${pct}%`;
      if (seekThumb) seekThumb.style.left = `${pct}%`;

      const duration = (typeof Player !== 'undefined' && Player.getDuration) ? Player.getDuration() : 0;
      if (curTimeEl && duration > 0) {
        curTimeEl.textContent = (typeof UI !== 'undefined' && UI.formatTime) ? UI.formatTime(progress * duration) : `${Math.floor(progress * duration / 60)}:${String(Math.floor(progress * duration % 60)).padStart(2, '0')}`;
      }
      seekBar.setAttribute('aria-valuenow', String(Math.round(pct)));
      if (typeof UI !== 'undefined' && UI.WavyProgressBar) {
        UI.WavyProgressBar.setProgress(parseFloat(pct), isPointerDown);
      }
    }

    function onPointerDown(e) {
      isPointerDown = true;
      window._isUserSeeking = true;
      seekBar.classList.add('seeking');
      if (seekSafetyTimer) clearTimeout(seekSafetyTimer);

      try {
        if (e.pointerId !== undefined && seekBar.setPointerCapture) {
          seekBar.setPointerCapture(e.pointerId);
        }
      } catch (_) {}

      const clientX = (e.clientX !== undefined && e.clientX !== 0) ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const progress = getProgressFromCoord(clientX);
      updateVisualSeek(progress);
    }

    function onPointerMove(e) {
      if (!isPointerDown) return;
      if (e.cancelable) e.preventDefault();
      const clientX = (e.clientX !== undefined && e.clientX !== 0) ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const progress = getProgressFromCoord(clientX);
      updateVisualSeek(progress);
    }

    function onPointerUp(e) {
      if (!isPointerDown && !window._isUserSeeking) return;
      isPointerDown = false;
      seekBar.classList.remove('seeking');

      try {
        if (e.pointerId !== undefined && seekBar.releasePointerCapture) {
          seekBar.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}

      const clientX = (e.clientX !== undefined && e.clientX !== 0)
        ? e.clientX
        : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0));
      const progress = getProgressFromCoord(clientX);
      updateVisualSeek(progress);

      const duration = (typeof Player !== 'undefined' && Player.getDuration) ? Player.getDuration() : 0;
      if (duration > 0 && typeof Player !== 'undefined' && Player.seek) {
        const targetSeconds = progress * duration;
        Player.seek(targetSeconds);
      }

      if (seekSafetyTimer) clearTimeout(seekSafetyTimer);
      seekSafetyTimer = setTimeout(() => {
        window._isUserSeeking = false;
      }, 50);
    }

    // Pointer Events (Desktop Mouse + Touch + iOS WKWebView)
    seekBar.addEventListener('pointerdown', onPointerDown, { passive: false });
    seekBar.addEventListener('pointermove', onPointerMove, { passive: false });
    seekBar.addEventListener('pointerup', onPointerUp);
    seekBar.addEventListener('pointercancel', onPointerUp);

    // Native Touch Events for iOS WebKit & Mobile Browsers
    seekBar.addEventListener('touchstart', onPointerDown, { passive: false });
    seekBar.addEventListener('touchmove', onPointerMove, { passive: false });
    seekBar.addEventListener('touchend', onPointerUp);
    seekBar.addEventListener('touchcancel', onPointerUp);

    // Global Safety Window Release Listeners
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);
  }

  // ==========================================================================
  // SINGLE AUTHORITATIVE LIKE / FAVORITES SYSTEM
  // ==========================================================================
  let isTogglingFavorite = false;
  async function toggleFavoriteCurrent() {
    if (isTogglingFavorite) return;
    isTogglingFavorite = true;

    try {
      const song = Player.getCurrentTrack();
      if (!song || !song.id) {
        isTogglingFavorite = false;
        return;
      }

      const isFav = Storage.toggleFavorite(song);
      UI.updatePlayerBar(song);

      const heartIcon = document.getElementById('player-heart-icon');
      if (heartIcon && isFav) {
        heartIcon.classList.remove('heart-pop');
        void heartIcon.offsetWidth;
        heartIcon.classList.add('heart-pop');
      }

      UI.showToast(isFav ? 'Added to Favorites ❤️' : 'Removed from Favorites');

      if (isFav && typeof SmartDownloadManager !== 'undefined' && SmartDownloadManager.handleLikeEvent) {
        SmartDownloadManager.handleLikeEvent(song);
      }

      if (activeLibraryTab === 'liked' || activeLibraryTab === 'playlists') {
        UI.renderLibraryTab(activeLibraryTab, librarySearchQuery, librarySortMode);
      }
    } catch (err) {
      console.warn('[App] toggleFavoriteCurrent error:', err);
    } finally {
      setTimeout(() => {
        isTogglingFavorite = false;
      }, 100);
    }
  }

  function openCurrentSongMenu() {
    const cur = Player.getCurrentTrack();
    if (cur && cur.id) {
      openSongMenu(cur.id);
    } else {
      UI.showToast('No track currently playing.');
    }
  }

  function openAudioOutputSheet() {
    if (typeof AudioOutputManager !== 'undefined') {
      AudioOutputManager.refreshDevices().then(() => {
        AudioOutputManager.renderOutputSheet();
        openBottomSheet('sheet-audio-output');
      }).catch(() => {
        openBottomSheet('sheet-audio-output');
      });
    } else {
      openBottomSheet('sheet-audio-output');
    }
  }

  function openCastOutputDialog() {
    openAudioOutputSheet();
  }

  // ==========================================================================
  // DIRECT AUDIO DOWNLOAD (NATIVE IN-BROWSER / IN-APP BLOB SAVE)
  // ==========================================================================
  // ==========================================================================
  // DIRECT AUDIO DOWNLOAD & QUALITY SELECTION (PHONE DOWNLOAD FOLDER SUPPORT)
  // ==========================================================================
  let pendingDownloadTrack = null;
  let selectedDownloadDialogQuality = '320kbps';

  async function downloadCurrentTrack() {
    const song = Player.getCurrentTrack();
    if (!song) {
      UI.showToast('No track currently playing.');
      return;
    }
    await requestDownloadTrack(song);
  }

  async function requestDownloadTrack(song) {
    if (!song) return;

    // Deduplication check
    if (typeof DownloadManager !== 'undefined') {
      const status = DownloadManager.getStatus(song.id);
      if (status === 'COMPLETED') {
        UI.showToast(`"${song.name}" is already downloaded in your library ⬇️`);
        return;
      }
    }

    const shouldAsk = (typeof DownloadManager !== 'undefined' && DownloadManager.shouldAskDownloadQuality) 
      ? DownloadManager.shouldAskDownloadQuality() 
      : true;

    if (shouldAsk) {
      openDownloadQualityDialog(song);
    } else {
      const defaultQuality = (typeof DownloadManager !== 'undefined' && DownloadManager.getDownloadQuality) 
        ? DownloadManager.getDownloadQuality() 
        : '320kbps';
      await startDownloadWithQuality(song, defaultQuality);
    }
  }

  function openDownloadQualityDialog(song) {
    if (!song) return;
    pendingDownloadTrack = song;
    selectedDownloadDialogQuality = (typeof DownloadManager !== 'undefined' && DownloadManager.getDownloadQuality) 
      ? DownloadManager.getDownloadQuality() 
      : '320kbps';

    const artEl = document.getElementById('dl-dialog-track-art');
    const titleEl = document.getElementById('dl-dialog-track-title');
    const artistEl = document.getElementById('dl-dialog-track-artist');
    const rememberBox = document.getElementById('dl-dialog-remember-choice');

    if (artEl) artEl.src = song.image || 'assets/logo.png';
    if (titleEl) titleEl.textContent = song.name || 'Song Title';
    if (artistEl) artistEl.textContent = song.artists || song.artist || 'Unknown Artist';
    if (rememberBox) rememberBox.checked = false;

    updateDownloadDialogQualityCards(selectedDownloadDialogQuality);
    openDialog('dialog-download-quality');
  }

  function selectDownloadDialogQuality(quality) {
    selectedDownloadDialogQuality = quality || '320kbps';
    updateDownloadDialogQualityCards(selectedDownloadDialogQuality);
  }

  function updateDownloadDialogQualityCards(quality) {
    const cards = document.querySelectorAll('.download-quality-card');
    cards.forEach(card => {
      const q = card.dataset.quality;
      card.classList.toggle('active', q === quality);
    });
  }

  function closeDownloadQualityDialog() {
    closeDialog('dialog-download-quality');
    pendingDownloadTrack = null;
  }

  async function confirmDownloadQualityDialog() {
    const song = pendingDownloadTrack;
    const quality = selectedDownloadDialogQuality || '320kbps';
    const rememberBox = document.getElementById('dl-dialog-remember-choice');

    if (rememberBox && rememberBox.checked && typeof DownloadManager !== 'undefined') {
      DownloadManager.setDownloadQuality(quality);
      DownloadManager.setAskDownloadQuality(false);
      UI.renderSettingsSheet();
    }

    closeDownloadQualityDialog();

    if (song) {
      await startDownloadWithQuality(song, quality);
    }
  }

  async function startDownloadWithQuality(song, quality) {
    if (!song) return;

    // 1. If inside native Android WebView, trigger Android system DownloadManager directly
    if (window.AndroidMediaBridge && typeof window.AndroidMediaBridge.downloadTrackToPhone === 'function') {
      try {
        let streamUrl = song.streamUrl || song.downloadUrl || '';
        if (!streamUrl && typeof API !== 'undefined' && API.getStreamUrl) {
          streamUrl = await API.getStreamUrl(song.id);
        }
        if (streamUrl) {
          window.AndroidMediaBridge.downloadTrackToPhone(
            song.name || 'Song',
            song.artists || song.artist || 'Artist',
            song.album || '',
            streamUrl,
            song.image || '',
            quality
          );
        }
      } catch (bridgeErr) {
        console.warn('[App] Native Android download error:', bridgeErr);
      }
    }

    // 2. Enqueue in web DownloadManager for IndexedDB offline store & browser file export
    if (typeof DownloadManager !== 'undefined') {
      DownloadManager.enqueue(song, { quality, priority: 'explicit' });
      UI.showToast(`Downloading "${song.name}" (${quality}) to phone's Download folder ⬇️`);
    } else {
      UI.showToast(`Started download for "${song.name}" (${quality})`);
    }
  }

  function openDownloadQualitySettingsDialog() {
    const curSong = Player.getCurrentTrack() || { id: 'sample', name: 'Default Download Preset', artists: 'All Songs', image: 'assets/logo.png' };
    openDownloadQualityDialog(curSong);
  }

  function toggleSaveToPhoneFolder(enabled) {
    if (typeof DownloadManager !== 'undefined') {
      DownloadManager.setSaveToPhoneFolder(enabled);
    }
    UI.showToast(enabled ? 'Downloads will be saved to phone\'s Download folder' : 'Downloads saved in-app only');
    UI.renderSettingsSheet();
  }

  async function downloadTrack(song) {
    await requestDownloadTrack(song);
  }

  // ==========================================================================
  // FULL PLAYER & LYRICS EXPANSION (Single Header System)
  // ==========================================================================
  function expandFullPlayer() {
    const sheet = document.getElementById('full-player');
    if (sheet) sheet.classList.add('expanded');
    UI.updateShuffleState(Player.getIsShuffle());
    UI.updateRepeatState(Player.getRepeatMode());
    const cur = Player.getCurrentTrack();
    if (cur) UI.updatePlayerBar(cur);
    if (typeof UI !== 'undefined' && UI.WavyProgressBar) {
      const isPlaying = (typeof Player !== 'undefined') && ((typeof Player.isPlaying === 'function' && Player.isPlaying()) || (typeof Player.getIsPlaying === 'function' && Player.getIsPlaying()));
      UI.WavyProgressBar.setPlaying(isPlaying);
      const pos = (typeof Player !== 'undefined' && typeof Player.getPosition === 'function') ? Player.getPosition() : 0;
      const dur = (typeof Player !== 'undefined' && typeof Player.getDuration === 'function') ? Player.getDuration() : 0;
      if (dur > 0) {
        UI.WavyProgressBar.setProgress((pos / dur) * 100, false);
      } else {
        UI.WavyProgressBar.draw();
      }
    }
  }

  function collapseFullPlayer() {
    const sheet = document.getElementById('full-player');
    if (sheet) {
      sheet.classList.remove('expanded');
      sheet.style.transform = '';
    }
    const drawer = document.getElementById('player-sliding-drawer');
    if (drawer && drawer.classList.contains('expanded')) {
      collapsePlayerDrawer();
    }
  }

  function handlePlayerBack() {
    const drawer = document.getElementById('player-sliding-drawer');
    if (drawer && drawer.classList.contains('expanded')) {
      collapsePlayerDrawer();
      return;
    }
    const lyricsView = document.getElementById('player-lyrics-view');
    if (lyricsView && lyricsView.style.display === 'flex') {
      toggleLyricsView();
    } else {
      collapseFullPlayer();
    }
  }

  function handlePlayerRightAction() {
    const lyricsView = document.getElementById('player-lyrics-view');
    if (lyricsView && lyricsView.style.display === 'flex') {
      openEqualizer();
    } else {
      openCurrentSongMenu();
    }
  }

  function toggleLyricsView() {
    const artView = document.getElementById('player-art-view');
    const lyricsView = document.getElementById('player-lyrics-view');
    const toggleBtn = document.getElementById('btn-toggle-lyrics');
    const backIcon = document.getElementById('player-back-icon');
    const rightIcon = document.getElementById('player-right-icon');
    const contextTag = document.getElementById('player-context-tag');
    const contextTitle = document.getElementById('player-context-title');

    if (!artView || !lyricsView) return;
    const isLyricsActive = lyricsView.style.display === 'flex';

    if (isLyricsActive) {
      lyricsView.style.display = 'none';
      artView.style.display = 'flex';
      toggleBtn?.classList.remove('active');
      if (backIcon) backIcon.textContent = 'keyboard_arrow_down';
      if (rightIcon) rightIcon.textContent = 'more_vert';
      if (contextTag) contextTag.textContent = 'Playing from';
      if (contextTitle) {
        const alb = Player.getCurrentTrack()?.album;
        contextTitle.textContent = (alb && alb.trim().length > 1 && /[a-zA-Z0-9]/.test(alb)) ? alb.trim() : (Player.getCurrentTrack()?.name || 'Top Hits');
      }
    } else {
      artView.style.display = 'none';
      lyricsView.style.display = 'flex';
      toggleBtn?.classList.add('active');
      if (backIcon) backIcon.textContent = 'arrow_back';
      if (rightIcon) rightIcon.textContent = 'equalizer';
      if (contextTag) contextTag.textContent = 'SYNCHRONIZED';
      if (contextTitle) contextTitle.textContent = 'Live Lyrics';

      // Immediately sync and center current karaoke lyric line
      if (typeof Lyrics !== 'undefined' && typeof Lyrics.updateTime === 'function') {
        const curPos = (typeof Player !== 'undefined' && typeof Player.getPosition === 'function') ? Player.getPosition() : 0;
        Lyrics.updateTime(curPos, true);
      }
    }
  }

  // ==========================================================================
  // PROCEDURAL WEB AUDIO SOUNDSCAPES
  // ==========================================================================
  function toggleSoundscape(soundType) {
    if (currentSoundscape === soundType) {
      stopSoundscape();
      return;
    }
    stopSoundscape();
    currentSoundscape = soundType;

    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      const bufferSize = audioContext.sampleRate * 3;
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = audioContext.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const filter = audioContext.createBiquadFilter();
      if (soundType === 'rain') {
        filter.type = 'lowpass';
        filter.frequency.value = 800;
      } else if (soundType === 'waves') {
        filter.type = 'bandpass';
        filter.frequency.value = 400;
        filter.Q.value = 1.2;
      } else {
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
      }

      const gain = audioContext.createGain();
      gain.gain.value = 0.15;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioContext.destination);

      noise.start();
      activeSoundscapeNode = { source: noise, gain };

      document.querySelectorAll('.soundscape-card').forEach(c => {
        c.classList.toggle('active', c.dataset.sound === soundType);
      });
    } catch (e) {
      console.warn('[Soundscape] error:', e);
    }
  }

  function stopSoundscape() {
    if (activeSoundscapeNode) {
      try {
        activeSoundscapeNode.source.stop();
        activeSoundscapeNode.source.disconnect();
      } catch (_) {}
      activeSoundscapeNode = null;
    }
    currentSoundscape = null;
    document.querySelectorAll('.soundscape-card').forEach(c => c.classList.remove('active'));
  }

  // ==========================================================================
  // MODALS & SHEETS DISPATCHERS
  // ==========================================================================
  let wasSettingsOpenBeforeDialog = false;

  function openBottomSheet(sheetId) {
    document.querySelectorAll('.bottom-sheet-backdrop.active').forEach(sheet => {
      if (sheet.id !== sheetId) {
        sheet.classList.remove('active');
      }
    });
    const el = document.getElementById(sheetId);
    if (el) {
      el.classList.add('active');
      if (sheetId === 'sheet-settings') {
        if (typeof PerformanceManager !== 'undefined' && typeof PerformanceManager.apply === 'function') {
          PerformanceManager.apply();
        }
        if (typeof UpdateManager !== 'undefined' && typeof UI !== 'undefined' && UI.renderAboutSettings) {
          UI.renderAboutSettings(UpdateManager.getState());
        }
      }
    }
  }

  function closeBottomSheet(sheetId) {
    const el = document.getElementById(sheetId);
    if (el) el.classList.remove('active');
  }

  function openDialog(dialogId) {
    const el = document.getElementById(dialogId);
    if (el) el.classList.add('active');
  }

  function closeDialog(dialogId) {
    const el = document.getElementById(dialogId);
    if (el) el.classList.remove('active');
    if (wasSettingsOpenBeforeDialog) {
      wasSettingsOpenBeforeDialog = false;
      openBottomSheet('sheet-settings');
    }
  }

  async function openCurrentSongMenu() {
    const current = (typeof Player !== 'undefined' && Player.getCurrentTrack) ? Player.getCurrentTrack() : null;
    if (!current) return;
    openSongMenu(current);
  }

  async function openSongMenu(songOrId, context = '') {
    let song = (typeof songOrId === 'object' && songOrId !== null) ? songOrId : null;
    if (!song && typeof songOrId === 'string') {
      const q = (typeof Player !== 'undefined' && Player.getQueue) ? Player.getQueue() : [];
      song = q.find(s => String(s.id) === String(songOrId)) ||
             (typeof Storage !== 'undefined' && Storage.getFavorites ? Storage.getFavorites().find(s => String(s.id) === String(songOrId)) : null) ||
             (typeof Storage !== 'undefined' && Storage.getHistory ? Storage.getHistory().find(s => String(s.id) === String(songOrId)) : null) ||
             (typeof Storage !== 'undefined' && Storage.getDownloads ? Storage.getDownloads().find(s => String(s.id) === String(songOrId)) : null) ||
             (typeof Player !== 'undefined' && Player.getCurrentTrack ? Player.getCurrentTrack() : null);

      if (!song && typeof API !== 'undefined' && API.getSongDetails) {
        try {
          const details = await API.getSongDetails(songOrId);
          if (details && details.length > 0) song = details[0];
        } catch (_) {}
      }
    }
    if (!song) return;

    if (typeof DataNormalizer !== 'undefined' && DataNormalizer.normalizeTrack) {
      song = DataNormalizer.normalizeTrack(song);
    }

    activeSongForMenu = song;
    selectedMenuSong = song;
    selectedMenuPlaylistId = (typeof context === 'string' && context.startsWith('pl_')) ? context : null;

    const name = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getTrackTitle(song) : (song.name || 'Song');
    const artists = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getArtistString(song) : (song.artists || 'Artist');
    const image = song.image || song.artwork || song.albumArt || 'assets/logo.png';
    const isFav = (typeof Storage !== 'undefined' && Storage.isFavorite) ? Storage.isFavorite(song.id || song) : false;

    // Populate Sheet 1 (#sheet-song-menu)
    const imgEl = document.getElementById('sheet-song-img');
    const titleEl = document.getElementById('sheet-song-title');
    const artistEl = document.getElementById('sheet-song-artist');
    const likeIconEl = document.getElementById('sheet-like-icon');
    const likeLabelEl = document.getElementById('sheet-like-label');

    if (imgEl) imgEl.src = image;
    if (titleEl) titleEl.textContent = name;
    if (artistEl) artistEl.textContent = artists;
    if (likeIconEl) likeIconEl.textContent = isFav ? 'favorite' : 'favorite_border';
    if (likeLabelEl) likeLabelEl.textContent = isFav ? 'Unlike' : 'Like';

    // Populate Sheet 2 (#sheet-song-actions)
    const titleEl2 = document.getElementById('song-action-title');
    const subEl2 = document.getElementById('song-action-sub');
    const artEl2 = document.getElementById('song-action-img');
    const favIcon2 = document.getElementById('song-act-fav-icon');
    const favText2 = document.getElementById('song-act-fav-text');
    const removePlBtn2 = document.getElementById('btn-song-act-remove-pl');

    if (titleEl2) titleEl2.textContent = name;
    if (subEl2) subEl2.textContent = artists;
    if (artEl2) artEl2.src = image;
    if (favIcon2) {
      favIcon2.textContent = isFav ? 'favorite' : 'favorite_border';
      favIcon2.style.color = isFav ? 'var(--accent)' : '';
    }
    if (favText2) favText2.textContent = isFav ? 'Unlike' : 'Favorite';
    if (removePlBtn2) removePlBtn2.style.display = selectedMenuPlaylistId ? 'flex' : 'none';

    openBottomSheet('sheet-song-menu');
  }

  async function openHomeSongMenu(songId) {
    return openSongMenu(songId, 'home');
  }

  function sheetAction(action) {
    const song = activeSongForMenu;
    closeBottomSheet('sheet-song-menu');
    if (!song) return;

    switch (action) {
      case 'sleep-timer':
        openSleepTimerDialog();
        break;
      case 'ambient':
        if (typeof AmbientScreen !== 'undefined' && AmbientScreen.open) AmbientScreen.open();
        break;
      case 'play-next':
        Player.playNext(song);
        break;
      case 'add-queue':
        Player.appendToQueue(song);
        break;
      case 'start-radio':
        startRadio(song);
        break;
      case 'download':
        downloadTrack(song);
        break;
      case 'go-artist':
        collapseFullPlayer();
        openArtistActionForSong(song);
        break;
      case 'go-album':
        collapseFullPlayer();
        openAlbum(song.albumId || song.album, song.album, song.primaryArtist || song.artists);
        break;
      case 'add-playlist':
        openPlaylistPicker(song);
        break;
      case 'open-equalizer':
        openEqualizer();
        break;
      case 'toggle-like':
        Storage.toggleFavorite(song);
        if (Player.getCurrentTrack()?.id === song.id) UI.updatePlayerBar(song);
        break;
      case 'share':
        if (navigator.share) {
          navigator.share({ title: song.name, text: `Listen to ${song.name} by ${song.artists} on MusicFlow`, url: window.location.href });
        } else {
          navigator.clipboard.writeText(`${song.name} by ${song.artists}`);
          UI.showToast('Song info copied to clipboard!');
        }
        break;
    }
  }

  function openArtistActionForSong(song) {
    if (!song) return;
    const artists = (typeof DataNormalizer !== 'undefined' && DataNormalizer.getLegitimateMusicArtists)
      ? DataNormalizer.getLegitimateMusicArtists(song)
      : [{ id: 'artist', name: song.primaryArtist || song.artists || 'Artist' }];

    if (artists.length <= 1) {
      const art = artists[0] || { name: song.primaryArtist || song.artists || 'Artist' };
      openArtist(art.name, art.providerId || art.id);
    } else {
      if (typeof UI !== 'undefined' && UI.renderArtistPicker) {
        UI.renderArtistPicker(artists, song);
      }
      openBottomSheet('sheet-artist-picker');
    }
  }

  function selectArtistFromPicker(name, id) {
    closeBottomSheet('sheet-artist-picker');
    if (name) {
      openArtist(name, id || name);
    }
  }

  // ==========================================================================
  // APPEARANCE & THEME PICKER (ThemeManager)
  // ==========================================================================
  function openThemeDialog() {
    if (document.getElementById('sheet-settings')?.classList.contains('active')) {
      wasSettingsOpenBeforeDialog = true;
      closeBottomSheet('sheet-settings');
    } else {
      wasSettingsOpenBeforeDialog = false;
    }
    UI.renderThemePicker();
    openDialog('dialog-theme-picker');
  }

  function closeThemeDialog() {
    closeDialog('dialog-theme-picker');
    UI.renderSettingsSheet();
  }

  function selectThemePreset(presetId) {
    if (typeof ThemeManager !== 'undefined') {
      ThemeManager.setTheme(presetId);
    }
    UI.renderThemePicker();
    UI.renderSettingsSheet();
  }

  function setCustomThemeColor(hexColor) {
    if (typeof ThemeManager !== 'undefined') {
      ThemeManager.setAccentColor(hexColor);
    }
    UI.renderThemePreview(ThemeManager?.getTheme());
    UI.renderSettingsSheet();
  }

  function resetTheme() {
    if (typeof ThemeManager !== 'undefined') {
      ThemeManager.reset();
    }
    UI.renderThemePicker();
    UI.renderSettingsSheet();
    UI.showToast('Theme reset to MusicFlow Red');
  }

  function selectThemeStyle(style) {
    if (typeof ThemeManager !== 'undefined') {
      ThemeManager.setThemeStyle(style);
    }
    UI.renderThemePicker();
    UI.renderSettingsSheet();

    if (style === 'pulse') {
      UI.showToast('Theme: Pulse (Electric Yellow)');
    } else if (style === 'apple') {
      UI.showToast('Theme: Apple Music (Rich Dark)');
    } else if (style === 'normal') {
      UI.showToast('Theme: Classic Glass (Normal AMOLED)');
    } else if (style === 'neumorphic-light') {
      UI.showToast('Theme: Neumorphic Light Soft 3D');
    } else {
      UI.showToast('Theme: Neumorphic Dark Soft 3D');
    }
  }

  function toggleNeumorphism(enabled) {
    if (typeof ThemeManager !== 'undefined') {
      ThemeManager.toggleNeumorphism(enabled);
    }
    UI.renderThemePicker();
    UI.renderSettingsSheet();

    const isNeu = (typeof ThemeManager !== 'undefined' && ThemeManager.isNeumorphic) ? ThemeManager.isNeumorphic() : enabled;
    if (isNeu) {
      const mode = (typeof ThemeManager !== 'undefined') ? ThemeManager.getThemeStyle() : 'neumorphic-dark';
      UI.showToast(mode === 'neumorphic-light' ? 'Neumorphic Light Enabled' : 'Neumorphic Dark Enabled');
    } else {
      UI.showToast('Classic Glass Restored');
    }
  }

  // ==========================================================================
  // MUSIC LANGUAGES PICKER (Immediate Live Reflection)
  // ==========================================================================
  function openLanguagesDialog() {
    if (document.getElementById('sheet-settings')?.classList.contains('active')) {
      wasSettingsOpenBeforeDialog = true;
      closeBottomSheet('sheet-settings');
    } else {
      wasSettingsOpenBeforeDialog = false;
    }
    tempSelectedLanguages = [...Storage.getLanguages()];
    UI.renderLanguagesPicker(tempSelectedLanguages);
    openDialog('dialog-language-picker');
  }

  function toggleLanguageSelection(langKey, isChecked) {
    if (!langKey) return;
    const cleanKey = String(langKey).toLowerCase().trim();
    if (typeof isChecked === 'boolean') {
      if (isChecked) {
        if (!tempSelectedLanguages.includes(cleanKey)) tempSelectedLanguages.push(cleanKey);
      } else {
        if (tempSelectedLanguages.length > 1) {
          tempSelectedLanguages = tempSelectedLanguages.filter(l => l !== cleanKey);
        }
      }
    } else {
      if (tempSelectedLanguages.includes(cleanKey)) {
        if (tempSelectedLanguages.length > 1) {
          tempSelectedLanguages = tempSelectedLanguages.filter(l => l !== cleanKey);
        }
      } else {
        tempSelectedLanguages.push(cleanKey);
      }
    }
    // Reflect immediately in Storage & UI
    Storage.setLanguages(tempSelectedLanguages);
    UI.renderLanguagesPicker(tempSelectedLanguages);
    UI.renderSettingsSheet();
    // Live update home feed in background
    loadHomeFeed();
  }

  async function saveLanguagesAndRefresh() {
    Storage.setLanguages(tempSelectedLanguages);
    closeDialog('dialog-language-picker');
    UI.renderSettingsSheet();
    showLoader(true);
    await loadHomeFeed();
    showLoader(false);
  }

  // ==========================================================================
  // PLAYLIST MODAL PICKER
  // ==========================================================================
  function openPlaylistPicker(song) {
    activeSongForMenu = song || Player.getCurrentTrack();
    UI.renderPlaylistPicker(Storage.getPlaylists(), activeSongForMenu);
    openDialog('dialog-playlist-picker');
  }

  function promptCreatePlaylistAndAdd() {
    UI.showPromptModal({
      title: 'New Playlist',
      placeholder: 'Enter playlist name...',
      confirmText: 'Create & Add',
      onConfirm: (name) => {
        if (name && activeSongForMenu) {
          const pl = Storage.createPlaylist(name);
          Storage.addSongToPlaylist(pl.id, activeSongForMenu);
          closeDialog('dialog-playlist-picker');
          UI.showToast(`Added "${activeSongForMenu.name}" to "${name}"`);
        }
      }
    });
  }

  
  // ==========================================================================
  // AUDIO EFFECTS & EQUALIZER 2.0 (EqualizerScreen.kt in Android)
  // ==========================================================================
  let _currentEqPresetCategory = 'standard';

  function setPresetCategory(category) {
    _currentEqPresetCategory = category;
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function getPresetCategory() {
    return _currentEqPresetCategory;
  }

  function openEqualizer() {
    if (document.getElementById('sheet-settings')?.classList.contains('active')) {
      wasSettingsOpenBeforeDialog = true;
      closeBottomSheet('sheet-settings');
    } else {
      wasSettingsOpenBeforeDialog = false;
    }
    const fx = Storage.getAudioEffects();
    if (fx && fx.preset && typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.getProPresetNames) {
      if (AudioEffectsEngine.getProPresetNames().includes(fx.preset)) {
        _currentEqPresetCategory = 'pro';
      }
    }
    UI.renderEqualizerUI(fx);
    openBottomSheet('sheet-equalizer');
  }

  function closeEqualizer() {
    closeBottomSheet('sheet-equalizer');
    if (wasSettingsOpenBeforeDialog) {
      wasSettingsOpenBeforeDialog = false;
      openBottomSheet('sheet-settings');
    }
  }

  function toggleEq(enabled) {
    Player.setEqEnabled(enabled);
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function selectEqPreset(presetName) {
    if (presetName !== 'Flat') {
      Player.setEqEnabled(true);
    }
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.getProPresetNames) {
      if (AudioEffectsEngine.getProPresetNames().includes(presetName)) {
        _currentEqPresetCategory = 'pro';
      }
    }
    Player.setEqPreset(presetName);
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function setSpatialLevel(level) {
    if (level !== 'OFF') {
      Player.setEqEnabled(true);
    }
    Player.setSpatial(level);
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function updateEqBand(index, value) {
    const val = parseFloat(value);
    if (val !== 0) {
      Player.setEqEnabled(true);
    }
    Player.setEqBand(index, val);
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function updateBassBoost(value) {
    const val = parseFloat(value);
    if (val > 0) {
      Player.setEqEnabled(true);
    }
    Player.setBassBoost(val);
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function updateTrebleBoost(value) {
    const val = parseFloat(value);
    if (val !== 0) {
      Player.setEqEnabled(true);
    }
    Player.setTrebleBoost(val);
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function updateVocalBoost(value) {
    const val = parseFloat(value);
    if (val > 0) {
      Player.setEqEnabled(true);
    }
    Player.setVocalBoost(val);
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function updateVirtualizer(value) {
    const val = parseFloat(value);
    Player.setVirtualizerStrength(val);
  }

  function toggleNormalization(enabled) {
    Player.setNormalization(enabled);
    UI.renderEqualizerUI(Storage.getAudioEffects());
  }

  function selectCrossfade(seconds) {
    Player.setCrossfade(parseInt(seconds, 10));
  }

  function promptSaveCustomPreset() {
    UI.showPromptModal({
      title: 'Save Preset',
      placeholder: 'Enter preset name...',
      confirmText: 'Save Preset',
      onConfirm: (name) => {
        if (name && name.trim()) {
          const cleanName = name.trim().slice(0, 30);
          if (typeof AudioEffectsEngine !== 'undefined') {
            AudioEffectsEngine.saveCustomPreset(cleanName);
          }
          UI.renderEqualizerUI(Storage.getAudioEffects());
          UI.showToast(`Saved preset "${cleanName}"`);
        }
      }
    });
  }

  function deleteCustomPreset(name) {
    UI.showConfirmModal({
      title: 'Delete Preset?',
      message: `Delete custom preset "${name}"?`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: () => {
        if (typeof AudioEffectsEngine !== 'undefined') {
          AudioEffectsEngine.deleteCustomPreset(name);
        }
        UI.renderEqualizerUI(Storage.getAudioEffects());
        UI.showToast(`Deleted preset "${name}"`);
      }
    });
  }

  function resetAudioEffects() {
    Player.resetAudioEffects();
    UI.renderEqualizerUI(Storage.getAudioEffects());
    UI.showToast('Audio effects reset to defaults (OFF)');
  }

  // ==========================================================================
  // SLEEP TIMER
  // ==========================================================================
  function openSleepTimerDialog() {
    if (document.getElementById('sheet-settings')?.classList.contains('active')) {
      wasSettingsOpenBeforeDialog = true;
      closeBottomSheet('sheet-settings');
    } else {
      wasSettingsOpenBeforeDialog = false;
    }
    const state = (typeof Player !== 'undefined' && Player.getSleepTimerState) ? Player.getSleepTimerState() : { active: false };
    UI.renderSleepTimerDialog(state);
    openDialog('dialog-sleep-timer');
  }

  function setSleepPreset(option) {
    closeDialog('dialog-sleep-timer');
    const state = Player.setSleepTimer(option);
    if (state.active) {
      if (state.mode === 'end_of_track') {
        UI.showToast('🌙 Sleep timer set for end of current song');
      } else {
        UI.showToast(`🌙 Sleep timer set for ${state.durationMinutes} minutes`);
      }
    } else {
      UI.showToast('Sleep timer turned off');
    }
    UI.updateSleepTimerUI(state);
  }

  function addSleepMinutes(extraMins) {
    const state = Player.addSleepTimerMinutes(extraMins || 15);
    UI.renderSleepTimerDialog(state);
    UI.updateSleepTimerUI(state);
    UI.showToast(`+${extraMins || 15} min added to sleep timer`);
  }

  function cancelSleepTimer() {
    closeDialog('dialog-sleep-timer');
    const state = Player.setSleepTimer(0);
    UI.updateSleepTimerUI(state);
    UI.showToast('Sleep timer cancelled');
  }

  function onCustomSleepInput(val) {
    const valEl = document.getElementById('sleep-custom-val');
    if (valEl) valEl.textContent = `${val} min`;
  }

  function setCustomSleepTimer() {
    const slider = document.getElementById('sleep-custom-slider');
    const mins = parseInt(slider?.value || '45', 10);
    if (isNaN(mins) || mins < 5 || mins > 180) {
      UI.showToast('Please select between 5 and 180 minutes');
      return;
    }
    setSleepPreset(mins);
  }

  // ==========================================================================
  // QUEUE MANAGEMENT
  // ==========================================================================
  function openQueueSheet() {
    UI.renderQueueSheet(Player.getQueue(), Player.getQueue().findIndex(s => s.id === Player.getCurrentTrack()?.id));
    openBottomSheet('sheet-queue');
  }

  // ==========================================================================
  // YOUTUBE MUSIC SIGNATURE PLAYER ENHANCEMENTS (Step 2)
  // ==========================================================================
  let currentPlayerMode = 'song';
  let currentDrawerTab = 'queue'; // 'queue' | 'lyrics' | 'related'
  let isAutoplayEnabled = true;

  function setPlayerMode(mode) {
    currentPlayerMode = 'song';
  }

  function dislikeCurrentTrack() {
    const current = (typeof Player !== 'undefined' && Player.getCurrentTrack) ? Player.getCurrentTrack() : null;
    if (!current) return;
    try {
      if (typeof Storage !== 'undefined' && Storage.recordSkip) {
        Storage.recordSkip(current);
      }
    } catch (_) {}
    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast('Got it, won’t play this again');
    }
    animateToNext();
  }

  function shareCurrentTrack() {
    const current = (typeof Player !== 'undefined' && Player.getCurrentTrack) ? Player.getCurrentTrack() : null;
    if (!current) return;
    const title = current.name || 'Song';
    const artist = current.artists || current.primaryArtist || '';
    if (navigator.share) {
      navigator.share({ title, text: `Listen to ${title} by ${artist} on MusicFlow`, url: window.location.href }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${title} - ${artist} (MusicFlow)`);
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Song link copied to clipboard!');
      }
    }
  }

  function toggleAutoplay(enabled) {
    isAutoplayEnabled = !!enabled;
    const sw = document.getElementById('autoplay-switch');
    if (sw) sw.checked = isAutoplayEnabled;
    try {
      localStorage.setItem('ytm_autoplay_enabled', isAutoplayEnabled ? '1' : '0');
    } catch (_) {}
    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast(isAutoplayEnabled ? 'Autoplay on: Similar tracks will play next' : 'Autoplay off');
    }
  }

  function collapsePlayerDrawer() {
    const drawer = document.getElementById('player-sliding-drawer');
    const backdrop = document.getElementById('player-drawer-backdrop');
    if (drawer) drawer.classList.remove('expanded');
    if (backdrop) backdrop.classList.remove('active');
  }

  function openPlayerDrawer() {
    const drawer = document.getElementById('player-sliding-drawer');
    const backdrop = document.getElementById('player-drawer-backdrop');
    if (drawer) drawer.classList.add('expanded');
    if (backdrop) backdrop.classList.add('active');
    initDrawerGestures();
  }

  function triggerHaptic(ms = 10) {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(ms);
      }
    } catch (_) {}
  }

  function initTimeOfDayMoodChips() {
    const container = document.getElementById('mood-chips-container');
    if (!container) return;

    const hour = new Date().getHours();
    let timeMoods = [];

    if (hour >= 5 && hour < 12) {
      // Morning
      timeMoods = [
        { label: 'All', mood: 'All' },
        { label: '☕ Morning Coffee', mood: 'Relax' },
        { label: '⚡ Energize', mood: 'Energize' },
        { label: '🚗 Commute', mood: 'Commute' },
        { label: '✨ Chill Hits', mood: 'Relax' },
        { label: '🏋️ Workout', mood: 'Workout' }
      ];
    } else if (hour >= 12 && hour < 17) {
      // Afternoon
      timeMoods = [
        { label: 'All', mood: 'All' },
        { label: '🎯 Deep Focus', mood: 'Focus' },
        { label: '🎧 Lo-Fi Beats', mood: 'Relax' },
        { label: '⚡ Energize', mood: 'Energize' },
        { label: '✨ Chill Hits', mood: 'Relax' },
        { label: '🚗 Commute', mood: 'Commute' }
      ];
    } else if (hour >= 17 && hour < 22) {
      // Evening
      timeMoods = [
        { label: 'All', mood: 'All' },
        { label: '🏋️ Workout', mood: 'Workout' },
        { label: '🎉 Party', mood: 'Party' },
        { label: '🌆 Evening Unwind', mood: 'Relax' },
        { label: '❤️ Romance', mood: 'Romance' },
        { label: '⚡ Energize', mood: 'Energize' }
      ];
    } else {
      // Late Night
      timeMoods = [
        { label: 'All', mood: 'All' },
        { label: '🌙 Late Night', mood: 'Relax' },
        { label: '🌧️ Lo-Fi & Rain', mood: 'Relax' },
        { label: '💤 Sleep & Peace', mood: 'Sleep' },
        { label: '✨ Chill Hits', mood: 'Relax' },
        { label: '🎯 Focus', mood: 'Focus' }
      ];
    }

    container.innerHTML = timeMoods.map((m, idx) => `
      <button class="mood-chip ${idx === 0 ? 'active' : ''}" data-mood="${m.mood}" data-label="${m.label}">${m.label}</button>
    `).join('');
  }

  async function startSongRadio(targetSong = null) {
    const song = targetSong || (typeof Player !== 'undefined' ? Player.getCurrentTrack() : null);
    if (!song) {
      if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Play a song to start radio');
      return;
    }
    triggerHaptic(15);
    return startRadio(song);
  }

  function initDrawerGestures() {
    const drawer = document.getElementById('player-sliding-drawer');
    if (!drawer || drawer._gesturesInit) return;
    drawer._gesturesInit = true;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    let startTime = 0;

    drawer.addEventListener('touchstart', (e) => {
      const handle = e.target.closest('.drawer-drag-bar') || e.target.closest('.drawer-tabs-nav');
      if (handle && drawer.classList.contains('expanded')) {
        startY = e.touches[0].clientY;
        currentY = startY;
        startTime = Date.now();
        isDragging = true;
        drawer.style.transition = 'none';
      }
    }, { passive: true });

    drawer.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const deltaY = Math.max(0, currentY - startY);
      drawer.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    }, { passive: true });

    drawer.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      drawer.style.transition = 'transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1), height 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)';
      const deltaY = currentY - startY;
      const endY = currentY;
      const elapsed = Date.now() - startTime;
      const velocity = deltaY / Math.max(1, elapsed); // px per ms

      if (endY - startY > 40 || deltaY > 70 || velocity > 0.45) {
        drawer.style.transform = '';
        collapsePlayerDrawer();
        triggerHaptic(12);
      } else {
        drawer.style.transform = 'translate3d(0, 0, 0)';
        setTimeout(() => { if (!drawer.classList.contains('expanded')) drawer.style.transform = ''; }, 350);
      }
    }, { passive: true });
  }

  function togglePlayerDrawer() {
    const drawer = document.getElementById('player-sliding-drawer');
    if (!drawer) return;
    if (drawer.classList.contains('expanded')) {
      collapsePlayerDrawer();
    } else {
      openPlayerDrawer();
      switchDrawerTab(currentDrawerTab);
    }
  }

  function switchDrawerTab(tab) {
    const drawer = document.getElementById('player-sliding-drawer');
    // If tapping the already active tab while expanded, collapse drawer
    if (drawer && drawer.classList.contains('expanded') && currentDrawerTab === tab) {
      collapsePlayerDrawer();
      return;
    }

    currentDrawerTab = tab;
    openPlayerDrawer();

    ['queue', 'lyrics', 'related'].forEach(t => {
      const btn = document.getElementById(`drawer-tab-${t}`);
      const pane = document.getElementById(`drawer-pane-${t}`);
      if (btn) btn.classList.toggle('active', t === tab);
      if (pane) pane.classList.toggle('active', t === tab);
    });

    if (tab === 'queue') {
      renderDrawerQueue();
    } else if (tab === 'lyrics') {
      renderDrawerLyrics();
    } else if (tab === 'related') {
      renderDrawerRelated();
    }
  }

  function renderDrawerQueue() {
    const container = document.getElementById('drawer-queue-tracks-container');
    if (!container || typeof Player === 'undefined') return;
    const q = Player.getQueue();
    const curr = Player.getCurrentTrack();
    const currIdx = Player.getCurrentIndex();

    if (q.length === 0) {
      container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:20px 0; font-size:13px;">Queue is empty</p>';
      return;
    }

    container.innerHTML = q.map((t, idx) => {
      const isCur = idx === currIdx;
      return `
        <div class="queue-swipe-wrap"><div class="queue-track-item ${isCur ? 'active' : ''}" data-queue-index="${idx}" onclick="Player.playTrackAtIndex(${idx})" style="display:flex !important; flex-direction:row !important; align-items:center !important; gap:12px !important; padding:8px 10px !important; border-radius:10px !important; cursor:pointer !important; width:100% !important; box-sizing:border-box !important;">
          <span class="queue-track-num" style="width:20px; font-size:12px; font-weight:700; color:var(--text-secondary); text-align:center; flex-shrink:0; display:flex; align-items:center; justify-content:center;">${isCur ? '<span class="material-symbols-outlined fill-icon" style="color:var(--accent); font-size:16px;">volume_up</span>' : (idx + 1)}</span>
          <img class="queue-track-thumb" src="${API.thumb(t.image || 'assets/logo.png')}" alt="" style="width:44px !important; height:44px !important; min-width:44px !important; max-width:44px !important; border-radius:6px !important; object-fit:cover !important; flex-shrink:0 !important; background:#222;" onerror="this.src='assets/logo.png'">
          <div class="queue-track-meta" style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">
            <span class="queue-track-title ${isCur ? 'active-text' : ''}" style="font-size:13.5px; font-weight:600; color:${isCur ? 'var(--accent)' : '#FFFFFF'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${escapeHtml(t.name || t.title || 'Unknown Title')}</span>
            <span class="queue-track-artist" style="font-size:11.5px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">${escapeHtml(t.artists || t.primaryArtist || 'Unknown Artist')}</span>
          </div>
          <button class="queue-track-del" onclick="event.stopPropagation(); Player.removeFromQueue(${idx}); App.renderDrawerQueue();" aria-label="Remove" style="background:transparent; border:none; color:rgba(255,255,255,0.4); cursor:pointer; padding:6px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <span class="material-symbols-outlined" style="font-size:18px;">close</span>
          </button>
        </div></div>
      `;
    }).join('');
  }

  async function renderDrawerLyrics() {
    if (typeof Lyrics !== 'undefined') {
      const curPos = (typeof Player !== 'undefined' && typeof Player.getPosition === 'function') ? Player.getPosition() : 0;
      Lyrics.updateTime(curPos, true);
    }
  }

  let currentDrawerRelatedList = [];

  function playRelatedTrack(idx) {
    if (!currentDrawerRelatedList || !currentDrawerRelatedList[idx]) return;
    const track = currentDrawerRelatedList[idx];
    if (typeof Player !== 'undefined') {
      if (typeof Player.setQueue === 'function') {
        Player.setQueue([...currentDrawerRelatedList], idx, true, { source: 'related', title: 'Related Mix' });
        if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
          UI.showToast(`Playing related songs: ${track.name || track.title || 'Track'}`);
        }
        if (typeof setPlayerContext === 'function') {
          setPlayerContext('RELATED MIX', track.artists || track.primaryArtist || 'Similar Tracks');
        }
      } else if (typeof Player.playSong === 'function') {
        Player.playSong(track);
      } else if (typeof Player.playTrack === 'function') {
        Player.playTrack(track);
      }
    }
  }

  function playAllRelated() {
    if (!currentDrawerRelatedList || currentDrawerRelatedList.length === 0) {
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast('No related songs available yet');
      }
      return;
    }
    const first = currentDrawerRelatedList[0];
    if (typeof Player !== 'undefined' && typeof Player.setQueue === 'function') {
      Player.setQueue([...currentDrawerRelatedList], 0, true, { source: 'related', title: 'Related Mix' });
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast(`Playing related mix (${currentDrawerRelatedList.length} tracks)`);
      }
      if (typeof setPlayerContext === 'function' && first) {
        setPlayerContext('RELATED MIX', first.artists || first.primaryArtist || 'Similar Tracks');
      }
    }
  }

  function queueAllRelated() {
    if (!currentDrawerRelatedList || currentDrawerRelatedList.length === 0) {
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast('No related songs to add');
      }
      return;
    }
    if (typeof Player !== 'undefined' && typeof Player.appendToQueue === 'function') {
      currentDrawerRelatedList.forEach(t => Player.appendToQueue(t));
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast(`Added ${currentDrawerRelatedList.length} related tracks to queue`);
      }
    }
  }

  function queueRelatedTrackNext(idx, ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    if (!currentDrawerRelatedList || !currentDrawerRelatedList[idx]) return;
    const track = currentDrawerRelatedList[idx];
    if (typeof Player !== 'undefined' && typeof Player.insertNext === 'function') {
      Player.insertNext(track);
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast(`Playing next: ${track.name || track.title || 'Track'}`);
      }
    }
  }

  function queueRelatedTrackEnd(idx, ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    if (!currentDrawerRelatedList || !currentDrawerRelatedList[idx]) return;
    const track = currentDrawerRelatedList[idx];
    if (typeof Player !== 'undefined' && typeof Player.appendToQueue === 'function') {
      Player.appendToQueue(track);
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast(`Added to queue: ${track.name || track.title || 'Track'}`);
      }
    }
  }

  async function renderDrawerRelated() {
    const container = document.getElementById('drawer-related-tracks');
    if (!container) return;

    // Resilient current track resolution: check player, queue, history, and library
    let current = (typeof Player !== 'undefined' && Player.getCurrentTrack && Player.getCurrentTrack())
      || (typeof Player !== 'undefined' && Player.getQueue && Player.getQueue()[Player.getCurrentIndex ? Player.getCurrentIndex() : 0])
      || (typeof Player !== 'undefined' && Player.getQueue && Player.getQueue()[0])
      || (typeof Storage !== 'undefined' && Storage.getHistory && Storage.getHistory()[0])
      || null;

    if (!current) {
      const allSongs = (typeof Storage !== 'undefined' && Storage.getAllSongs) ? Storage.getAllSongs() : [];
      if (allSongs.length > 0) {
        current = allSongs[0];
      }
    }

    if (!current) {
      container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:16px 0; font-size:13px;">Discovering recommendations...</p>';
      return;
    }

    container.innerHTML = `
      <div class="loading-shimmer-card" style="height:56px; border-radius:12px; margin-bottom:8px;"></div>
      <div class="loading-shimmer-card" style="height:56px; border-radius:12px; margin-bottom:8px;"></div>
    `;

    try {
      let related = [];
      const trackTitle = current.name || current.title || '';
      const artistName = current.artists || current.primaryArtist || '';
      const primaryArtist = API.decodeHtml(String(artistName || '')).split(/[,;&/•+]/)[0].trim();
      let vid = current.providerId || current.id || '';
      if (typeof vid === 'string' && vid.startsWith('yt_')) vid = vid.replace('yt_', '');
      const isYtId = typeof vid === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(vid);
      const queryVid = isYtId ? vid : '';

      // Build deduplication sets from currently playing track and full queue
      const currentQueue = (typeof Player !== 'undefined' && Player.getQueue) ? Player.getQueue() : [];
      const queuedIds = new Set();
      const queuedTitles = new Set();

      const normalizeStr = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      if (current) {
        if (current.id) queuedIds.add(String(current.id).toLowerCase());
        if (current.providerId) queuedIds.add(String(current.providerId).toLowerCase());
        if (current.videoId) queuedIds.add(String(current.videoId).toLowerCase());
        const t = normalizeStr(current.name || current.title);
        if (t) queuedTitles.add(t);
      }

      for (const qItem of currentQueue) {
        if (!qItem) continue;
        if (qItem.id) queuedIds.add(String(qItem.id).toLowerCase());
        if (qItem.providerId) queuedIds.add(String(qItem.providerId).toLowerCase());
        if (qItem.videoId) queuedIds.add(String(qItem.videoId).toLowerCase());
        const t = normalizeStr(qItem.name || qItem.title);
        if (t) queuedTitles.add(t);
      }

      const isAlreadyInQueueOrCurrent = (item) => {
        if (!item) return true;
        const itemId = String(item.id || item.videoId || item.providerId || '').toLowerCase();
        if (itemId && queuedIds.has(itemId)) return true;
        const itemTitle = normalizeStr(item.name || item.title);
        if (itemTitle && queuedTitles.has(itemTitle)) return true;
        return false;
      };

      // MusicFlow Station: the same engine that drives autoplay and radio
      try {
        const built = await Station.build(current, { size: 20, excludeSongs: [current, ...currentQueue] });
        related = (built || []).filter(s => !isAlreadyInQueueOrCurrent(s));
      } catch (e) {
        console.warn('[Related] station failed:', e.message);
      }
      if (related.length < 6 && primaryArtist && typeof API !== 'undefined' && API.searchSongs) {
        try {
          const more = await API.searchSongs(primaryArtist, 1, 20, { lite: true });
          (more || []).forEach(s => { if (!isAlreadyInQueueOrCurrent(s) && !related.some(x => String(x.id) === String(s.id))) related.push(s); });
        } catch (_) {}
      }

      // Deduplicate internally
      const seenRelated = new Set();
      related = related.filter(s => {
        const sid = String(s.id || s.videoId || s.providerId || normalizeStr(s.name || s.title));
        if (!sid || seenRelated.has(sid)) return false;
        seenRelated.add(sid);
        return true;
      });

      if (related.length > 0) {
        currentDrawerRelatedList = related.slice(0, 20);
        container.innerHTML = currentDrawerRelatedList.map((t, idx) => `
          <div class="song-row-item" onclick="App.playRelatedTrack(${idx})" style="display:flex; align-items:center; margin-bottom:6px; background:rgba(255,255,255,0.03); border-radius:10px; padding:8px 10px; cursor:pointer; transition:background 0.15s ease;">
            <img class="song-row-thumb" src="${t.image || 'assets/logo.png'}" alt="" style="width:42px; height:42px; min-width:42px; max-width:42px; border-radius:6px; object-fit:cover; margin-right:12px; flex-shrink:0; background:#222;" onerror="this.src='assets/logo.png'">
            <div class="song-row-info" style="flex:1; min-width:0;">
              <span class="song-row-title" style="display:block; font-size:13.5px; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(t.name || t.title || 'Track')}</span>
              <span class="song-row-artist" style="display:block; font-size:11.5px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">${escapeHtml(t.artists || t.primaryArtist || 'Unknown Artist')}</span>
            </div>
            <div class="song-row-actions" style="display:flex; align-items:center; gap:4px; margin-left:8px; flex-shrink:0;">
              <button class="song-action-btn" title="Play Next" onclick="App.queueRelatedTrackNext(${idx}, event)" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; width:34px; height:34px; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:color 0.15s ease, background 0.15s ease;">
                <span class="material-symbols-outlined" style="font-size:20px;">playlist_play</span>
              </button>
              <button class="song-action-btn" title="Add to Queue" onclick="App.queueRelatedTrackEnd(${idx}, event)" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; width:34px; height:34px; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:color 0.15s ease, background 0.15s ease;">
                <span class="material-symbols-outlined" style="font-size:20px;">playlist_add</span>
              </button>
            </div>
          </div>
        `).join('');
      } else {
        currentDrawerRelatedList = [];
        container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:16px 0; font-size:13px;">Discovering more music...</p>';
      }

      // Render Similar Artists shelf
      const artistsShelf = document.getElementById('drawer-related-artists');
      if (artistsShelf) {
        renderDrawerSimilarArtists(artistName, artistsShelf);
      }
    } catch (e) {
      console.warn('[Related] Failed to load:', e.message);
      container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:16px 0; font-size:13px;">Explore more tracks from this artist</p>';
    }
  }

  async function renderDrawerSimilarArtists(artistNameStr, container) {
    if (!container) return;
    const cleanArt = API.decodeHtml(String(artistNameStr || '')).split(/[,;&/•+]/)[0].trim();
    const relatedFromGraph = (typeof RecommendationEngine !== 'undefined' && RecommendationEngine.RELATED_ARTISTS_GRAPH)
      ? (RecommendationEngine.RELATED_ARTISTS_GRAPH[cleanArt.toLowerCase()] || [])
      : [];

    let artistNames = [...new Set([
      ...((artistNameStr || '').split(/[,&/•+]/).map(s => s.trim()).filter(s => s.length > 1)),
      ...relatedFromGraph
    ])];

    if (artistNames.length <= 1 && cleanArt && typeof API !== 'undefined' && API.searchArtists) {
      try {
        const searched = await API.searchArtists(cleanArt, 1, 6);
        if (Array.isArray(searched) && searched.length > 0) {
          artistNames.push(...searched.map(a => a.name || a.title).filter(Boolean));
        }
      } catch (_) {}
    }

    const uniqueNames = [...new Set(artistNames.map(s => s.trim()))].filter(Boolean).slice(0, 8);
    if (uniqueNames.length === 0) {
      container.innerHTML = '<span style="font-size:12px; color:var(--text-secondary); padding:8px 0;">No similar artists available</span>';
      return;
    }

    container.innerHTML = uniqueNames.map(name => `
      <div class="similar-artist-item" onclick="App.navigateToArtist('${escapeHtml(name)}')" style="display:flex; flex-direction:column; align-items:center; width:76px; flex-shrink:0; cursor:pointer; margin-right:12px;">
        <div style="width:60px; height:60px; border-radius:50%; background:rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,0.1); overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.4);">
          <span class="material-symbols-outlined" style="font-size:30px; color:var(--text-secondary);">person</span>
        </div>
        <span style="font-size:11.5px; font-weight:600; color:#FFFFFF; text-align:center; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%;">${escapeHtml(name)}</span>
      </div>
    `).join('');
  }

  async function openCommentsSheet() {
    const sheet = document.getElementById('sheet-comments');
    const container = document.getElementById('comments-list-container');
    const countLabel = document.getElementById('comments-count-label');

    const current = (typeof Player !== 'undefined' && Player.getCurrentTrack) ? Player.getCurrentTrack() : null;
    let vid = current ? (current.providerId || current.id || '') : '';
    if (typeof vid === 'string' && vid.startsWith('yt_')) vid = vid.replace('yt_', '');

    if (countLabel) countLabel.textContent = 'Loading comments...';
    if (container) {
      container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px; padding:20px 0;">
          <div class="loading-shimmer-card" style="height:48px; border-radius:8px;"></div>
          <div class="loading-shimmer-card" style="height:48px; border-radius:8px;"></div>
          <div class="loading-shimmer-card" style="height:48px; border-radius:8px;"></div>
        </div>
      `;
    }
    openBottomSheet('sheet-comments');

    if (!vid) {
      if (countLabel) countLabel.textContent = 'Comments';
      if (container) {
        container.innerHTML = `
          <div style="text-align:center; padding:36px 16px; color:var(--text-secondary);">
            <span class="material-symbols-outlined" style="font-size:36px; margin-bottom:8px; opacity:0.6;">chat_bubble_outline</span>
            <p style="font-size:14px; font-weight:600; margin:0 0 4px 0; color:#fff;">No track playing</p>
            <p style="font-size:12px; margin:0;">Play a track to view real YouTube comments</p>
          </div>
        `;
      }
      return;
    }

    try {
      const res = await fetch(`/api/youtube/comments?videoId=${encodeURIComponent(vid)}`);
      const data = await res.json();

      if (!data.enabled) {
        if (countLabel) countLabel.textContent = 'Off';
        if (container) {
          container.innerHTML = `
            <div style="text-align:center; padding:36px 16px; color:var(--text-secondary);">
              <span class="material-symbols-outlined" style="font-size:36px; margin-bottom:8px; opacity:0.6;">comments_disabled</span>
              <p style="font-size:14px; font-weight:600; margin:0 0 4px 0; color:#fff;">Comments are turned off</p>
              <p style="font-size:12px; margin:0;">${escapeHtml(data.message || 'Comments are turned off for this track by YouTube')}</p>
            </div>
          `;
        }
        return;
      }

      const comments = Array.isArray(data.comments) ? data.comments : [];
      if (countLabel) countLabel.textContent = data.countText || `${comments.length} comments`;

      if (comments.length === 0) {
        if (container) {
          container.innerHTML = `
            <div style="text-align:center; padding:36px 16px; color:var(--text-secondary);">
              <span class="material-symbols-outlined" style="font-size:36px; margin-bottom:8px; opacity:0.6;">chat_bubble_outline</span>
              <p style="font-size:14px; font-weight:600; margin:0 0 4px 0; color:#fff;">No comments yet</p>
              <p style="font-size:12px; margin:0;">Be the first to share your thoughts on this track!</p>
            </div>
          `;
        }
        return;
      }

      if (container) {
        container.innerHTML = comments.map(c => `
          <div class="comment-item">
            <img class="comment-author-avatar" src="${escapeHtml(c.avatar || 'assets/logo.png')}" alt="" onerror="this.src='assets/logo.png'">
            <div class="comment-body">
              <div class="comment-author-line">
                <span class="comment-author-name">${escapeHtml(c.author || 'YouTube User')}</span>
                <span class="comment-time">${escapeHtml(c.time || '')}</span>
              </div>
              <p class="comment-text">${escapeHtml(c.text || '')}</p>
              <div class="comment-likes-row">
                <span class="material-symbols-outlined" style="font-size:14px;">thumb_up</span>
                <span>${escapeHtml(c.likes || '0')}</span>
              </div>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.warn('[Comments] Failed to load real YouTube comments:', err.message);
      if (countLabel) countLabel.textContent = 'Comments';
      if (container) {
        container.innerHTML = `
          <div style="text-align:center; padding:36px 16px; color:var(--text-secondary);">
            <p style="font-size:13px; margin:0 0 8px 0; color:var(--text-secondary);">Unable to load YouTube comments at this time</p>
            <button onclick="App.openCommentsSheet()" style="background:rgba(255,255,255,0.1); border:none; color:#fff; border-radius:16px; padding:6px 14px; font-size:12px; cursor:pointer;">Retry</button>
          </div>
        `;
      }
    }
  }

  function postUserComment() {
    const input = document.getElementById('input-new-comment');
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;

    const container = document.getElementById('comments-list-container');
    if (container) {
      const newCommentEl = document.createElement('div');
      newCommentEl.className = 'comment-item';
      newCommentEl.style.animation = 'fadeIn 0.25s ease';
      newCommentEl.innerHTML = `
        <img class="comment-author-avatar" src="assets/logo.png" alt="" onerror="this.src='assets/logo.png'">
        <div class="comment-body">
          <div class="comment-author-line">
            <span class="comment-author-name">You</span>
            <span class="comment-time">Just now</span>
          </div>
          <p class="comment-text">${escapeHtml(text)}</p>
          <div class="comment-likes-row">
            <span class="material-symbols-outlined fill-icon" style="font-size:14px; color:var(--accent);">thumb_up</span>
            <span>1</span>
          </div>
        </div>
      `;
      container.prepend(newCommentEl);
      container.scrollTop = 0;
    }
    input.value = '';
    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast('Comment posted');
    }
  }

  

  // ==========================================================================
  // SETTINGS & PROFILE
  // ==========================================================================
  function openSettings() {
    document.querySelectorAll('.bottom-sheet-backdrop.active').forEach(s => {
      if (s.id !== 'sheet-settings') s.classList.remove('active');
    });
    UI.renderSettingsSheet();
    openBottomSheet('sheet-settings');
  }

  function openProfile() {
    openSettings();
  }

  function openQualityDialog() {
    if (document.getElementById('sheet-settings')?.classList.contains('active')) {
      wasSettingsOpenBeforeDialog = true;
      closeBottomSheet('sheet-settings');
    } else {
      wasSettingsOpenBeforeDialog = false;
    }
    UI.renderQualityOptions(Storage.getAudioQuality());
    openDialog('dialog-quality');
  }

  function selectQuality(quality) {
    Storage.setAudioQuality(quality);
    closeDialog('dialog-quality');
    
    if (typeof Player !== 'undefined' && typeof Player.updatePlaybackQuality === 'function') {
      Player.updatePlaybackQuality(quality);
    }

    const cur = (typeof Player !== 'undefined' && Player.getCurrentTrack) ? Player.getCurrentTrack() : null;
    if (cur && typeof UI !== 'undefined' && UI.renderPlayer) {
      UI.renderPlayer(cur);
    }
    const badge = document.getElementById('player-quality-badge');
    if (badge) {
      const displayStr = quality === '320kbps' ? '320 KBPS • HI-RES' : quality.toUpperCase().replace('KBPS', ' KBPS');
      badge.textContent = displayStr;
    }
    const setVal = document.getElementById('settings-quality-val');
    if (setVal) {
      const q = String(quality).toLowerCase();
      let qualityLabel = 'Lossless & Studio Master (320 kbps)';
      if (q.includes('320')) qualityLabel = 'Lossless & Studio Master (320 kbps)';
      else if (q.includes('256')) qualityLabel = 'High Fidelity (256 kbps)';
      else if (q.includes('160')) qualityLabel = 'High Quality (160 kbps)';
      else if (q.includes('128')) qualityLabel = 'Standard Quality (128 kbps)';
      else if (q.includes('96')) qualityLabel = 'Data Saver (96 kbps)';
      else if (q.includes('48')) qualityLabel = 'Ultra Data Saver (48 kbps)';
      setVal.textContent = qualityLabel;
    }
    UI.showToast(`Audio quality set to ${quality}`);
  }

  function promptChangeName() {
    UI.showPromptModal({
      title: 'Change Name',
      placeholder: 'Enter your name...',
      defaultValue: Storage.getUserName(),
      onConfirm: (newName) => {
        if (newName) {
          Storage.setUserName(newName);
          UI.renderHomeGreeting();
          const nameVal = document.getElementById('settings-name-val');
          if (nameVal) nameVal.textContent = newName;
          const cardName = document.getElementById('settings-card-name');
          if (cardName) cardName.textContent = newName;
          UI.showToast(`Updated name to "${newName}"`);
        }
      }
    });
  }

  function promptChangeAvatar() {
    UI.showPromptModal({
      title: 'Change Avatar',
      placeholder: 'https://...',
      defaultValue: Storage.getUserAvatar(),
      onConfirm: (newAvatar) => {
        if (newAvatar && newAvatar.trim().startsWith('http')) {
          Storage.setUserAvatar(newAvatar.trim());
          applyPreferences();
          const setImg = document.getElementById('settings-avatar-img');
          if (setImg) setImg.src = newAvatar.trim();
          const cardAvatar = document.getElementById('settings-card-avatar');
          if (cardAvatar) cardAvatar.src = newAvatar.trim();
          const homeAvatar = document.getElementById('home-user-avatar');
          if (homeAvatar) homeAvatar.src = newAvatar.trim();
          UI.showToast('Avatar image updated');
        }
      }
    });
  }

  function cyclePerformanceMode() {
    const nextMode = (typeof PerformanceManager !== 'undefined' && typeof PerformanceManager.cycleMode === 'function')
      ? PerformanceManager.cycleMode()
      : (() => {
          const current = Storage.getPerformanceMode();
          const next = current === 'auto' ? '120fps' : (current === '120fps' ? '60fps' : (current === '60fps' ? '30fps' : 'auto'));
          Storage.setPerformanceMode(next);
          return next;
        })();

    applyPreferences();

    const label = (typeof PerformanceManager !== 'undefined' && typeof PerformanceManager.getDisplayLabel === 'function')
      ? PerformanceManager.getDisplayLabel(nextMode)
      : nextMode;

    const badge = document.getElementById('settings-perf-val');
    if (badge) badge.textContent = label;

    UI.showToast(`Performance: ${label} ⚡`);
  }

  function setPerformanceMode(mode) {
    if (typeof PerformanceManager !== 'undefined' && typeof PerformanceManager.setMode === 'function') {
      PerformanceManager.setMode(mode);
    } else {
      Storage.setPerformanceMode(mode);
    }
    applyPreferences();
    const label = (typeof PerformanceManager !== 'undefined' && typeof PerformanceManager.getDisplayLabel === 'function')
      ? PerformanceManager.getDisplayLabel(mode)
      : mode;
    const badge = document.getElementById('settings-perf-val');
    if (badge) badge.textContent = label;
  }

  function toggleAmbientGlow(enabled) {
    Storage.setAmbientLighting(enabled);
    applyPreferences();
  }

  function clearListeningHistory() {
    UI.showConfirmModal({
      title: 'Clear History?',
      message: 'Clear all listening history? This cannot be undone.',
      confirmText: 'Clear',
      isDestructive: true,
      onConfirm: () => {
        Storage.clearHistory();
        UI.renderLibraryTab('history', librarySearchQuery, librarySortMode);
        loadHomeFeed();
        UI.showToast('Listening history cleared 🧹');
      }
    });
  }

  function openLikedSongs() {
    const favs = Storage.getFavorites();
    if (favs.length > 0) {
      Player.setQueue(favs, 0);
      expandFullPlayer();
    } else {
      UI.showToast('No liked songs in your library yet.');
    }
  }

  function playLikedSongs() {
    const favs = Storage.getFavorites();
    if (favs.length > 0) {
      Player.setQueue(favs, 0);
      expandFullPlayer();
    }
  }

  function shuffleLikedSongs() {
    const favs = Storage.getFavorites();
    if (favs.length > 0) {
      const shuffled = [...favs].sort(() => Math.random() - 0.5);
      Player.setQueue(shuffled, 0);
      expandFullPlayer();
    }
  }

  function playSongFromFavsList(idx) {
    const favs = Storage.getFavorites();
    if (favs.length > 0) {
      Player.setQueue(favs, idx || 0);
      expandFullPlayer();
    }
  }

  function playDownloadedSongs() {
    const dl = Storage.getDownloads();
    if (dl.length > 0) {
      Player.setQueue(dl, 0);
      expandFullPlayer();
    }
  }

  function removeDownloadTrack(songId) {
    Storage.removeDownload(songId);
    UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
  }

  // --- Smart Downloads & Storage Management (Phase 9.3) ---
  function toggleSmartDownloads(enabled) {
    Storage.setSmartDownloadsEnabled(enabled);
    if (enabled && typeof SmartDownloadManager !== 'undefined') {
      SmartDownloadManager.evaluateAndEnqueueSmartDownloads();
      UI.showToast('Smart Downloads enabled ⚡');
    }
    applyPreferences();
    if (activeLibraryTab === 'downloads') {
      UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
    }
  }

  function toggleDownloadWifiOnly(wifiOnly) {
    Storage.setDownloadWifiOnly(wifiOnly);
    applyPreferences();
  }

  function toggleAutoDownloadLikes(enabled) {
    Storage.setAutoDownloadLikesEnabled(enabled);
    if (enabled && typeof SmartDownloadManager !== 'undefined') {
      SmartDownloadManager.evaluateAndEnqueueSmartDownloads();
      UI.showToast('Auto-download for Liked Songs enabled 💖');
    }
    applyPreferences();
  }

  function openStorageLimitDialog() {
    const current = Storage.getDownloadStorageLimitMb();
    UI.showPromptModal({
      title: 'Storage Limit',
      subtitle: 'Set offline limit in MB (e.g. 2048 for 2GB):',
      placeholder: 'MB limit...',
      defaultValue: String(current),
      onConfirm: (input) => {
        if (input && !isNaN(Number(input)) && Number(input) > 0) {
          Storage.setDownloadStorageLimitMb(Number(input));
          applyPreferences();
          if (activeLibraryTab === 'downloads') {
            UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
          }
          UI.showToast(`Storage limit set to ${input} MB`);
        }
      }
    });
  }

  function openAutoCleanupDialog() {
    const currentPolicy = Storage.getAutoCleanupPolicy ? Storage.getAutoCleanupPolicy() : 'never';
    UI.showPromptModal({
      title: 'Auto-Cleanup Policy',
      subtitle: 'Options: never, older_30_days, older_90_days, least_played',
      placeholder: 'Enter policy name...',
      defaultValue: currentPolicy,
      onConfirm: (input) => {
        let policy = 'never';
        if (input === '2' || input === 'older_30_days') policy = 'older_30_days';
        else if (input === '3' || input === 'older_90_days') policy = 'older_90_days';
        else if (input === '4' || input === 'least_played') policy = 'least_played';
        else if (input === '1' || input === 'never') policy = 'never';
        else if (input) policy = input;
        Storage.setAutoCleanupPolicy(policy);
        applyPreferences();
        UI.showToast(`Auto-cleanup policy set to ${policy}`);
      }
    });
  }

  function toggleProtectedDownloadAction(songId) {
    if (!songId) return;
    const isNowProt = Storage.toggleProtectedDownload(songId);
    UI.showToast(isNowProt ? 'Download pinned (Protected from auto-cleanup) 📌' : 'Download unpinned');
    if (activeLibraryTab === 'downloads') {
      UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
    }
  }

  async function openStorageCleanupDialog() {
    if (typeof SmartDownloadManager === 'undefined') return;
    const preview = SmartDownloadManager.previewCleanup('least_played');
    if (preview.willRemoveCount === 0) {
      UI.showToast('No unpinned/unliked downloads to clean up! ✨');
      return;
    }
    UI.showConfirmModal({
      title: 'Clean Storage?',
      message: `Clean up ${preview.willRemoveCount} unpinned tracks (${preview.willRemoveMb} MB)? ${preview.willKeepCount} protected/liked tracks (${preview.willKeepMb} MB) will be preserved.`,
      confirmText: 'Clean Up',
      isDestructive: true,
      onConfirm: async () => {
        const removed = await SmartDownloadManager.executeCleanup(preview.candidatesToRemove);
        UI.showToast(`Cleaned up ${removed} tracks (${preview.willRemoveMb} MB freed) 🧹`);
        UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
      }
    });
  }

  function removeHistoryTrack(songId) {
    Storage.removeHistoryItem(songId);
    UI.renderLibraryTab('history', librarySearchQuery, librarySortMode);
  }

  function startArtistRadioSeed(artistName) {
    startArtistRadio(artistName);
  }

  function unfollowArtistAction(artistId) {
    Storage.unfollowArtist(artistId);
    UI.renderLibraryTab('artists', librarySearchQuery, librarySortMode);
  }

  function handleLocalAudioUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const streamUrl = URL.createObjectURL(file);
      const name = file.name.replace(/\.[^/.]+$/, '');
      localUploadedSongs.push({
        id: `local_${Date.now()}_${i}`,
        name,
        artists: 'Local File',
        streamUrl,
        image: 'assets/logo.png',
        duration: 0,
        isLocal: true
      });
    }
    UI.renderLibraryTab('local', librarySearchQuery, librarySortMode);
  }

  async function playLocalTrack(songId) {
    const localSongs = (typeof Storage !== 'undefined' && typeof Storage.getLocalSongs === 'function')
      ? Storage.getLocalSongs()
      : localUploadedSongs;

    if (!localSongs || localSongs.length === 0) {
      UI.showToast('No local songs in library');
      return;
    }

    const trackIdx = localSongs.findIndex(s => String(s.id) === String(songId));
    if (trackIdx >= 0) {
      const track = localSongs[trackIdx];
      if ((!track.localBlobUrl || !track.streamUrl) && typeof Storage !== 'undefined' && Storage.getLocalAudioUrl) {
        try {
          const freshUrl = await Storage.getLocalAudioUrl(track.id);
          if (freshUrl) {
            track.localBlobUrl = freshUrl;
            track.streamUrl = freshUrl;
          }
        } catch (_) {}
      }
      Player.setQueue(localSongs, trackIdx, true, { source: 'local', title: 'Local Device Music' });
      expandFullPlayer();
    } else {
      UI.showToast('Track not found in library');
    }
  }

  function getLocalSongs() {
    return (typeof Storage !== 'undefined' && typeof Storage.getLocalSongs === 'function')
      ? Storage.getLocalSongs()
      : localUploadedSongs;
  }

  // ==========================================================================
  // LIBRARY (Apple Music style): root rows → section view, plus Recently Played grid
  // ==========================================================================
  const LIBRARY_SECTION_TITLES = {
    playlists: 'Playlists', artists: 'Artists', albums: 'Albums', songs: 'Liked Songs',
    downloads: 'Downloaded', history: 'Recently Played', local: 'Local Files'
  };

  function openLibrarySection(tabName) {
    const tab = tabName || 'playlists';
    const title = document.getElementById('library-section-title');
    if (title) title.textContent = LIBRARY_SECTION_TITLES[tab] || 'Library';
    document.body.classList.add('lib-section-open');
    openLibraryTab(tab);
    resetScrollToTop();
  }

  function closeLibrarySection(silent) {
    const wasOpen = document.body.classList.contains('lib-section-open');
    document.body.classList.remove('lib-section-open');
    if (wasOpen && !silent) {
      renderLibraryRecent();
      resetScrollToTop();
    }
  }

  function renderLibraryRecent() {
    const grid = document.getElementById('library-recent-grid');
    const section = document.getElementById('library-recent-section');
    if (!grid || !section) return;
    try {
      const favs = (Storage.getFavorites && Storage.getFavorites()) || [];
      const downloads = (Storage.getDownloads && Storage.getDownloads()) || [];
      const playlists = (Storage.getPlaylists && Storage.getPlaylists()) || [];
      const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n > 0 ? String(n) : ''; };
      set('lib-count-liked', favs.length);
      set('lib-count-downloads', downloads.length);
      set('lib-count-playlists', playlists.length);

      const history = (Storage.getHistory && Storage.getHistory()) || [];
      const seen = new Set();
      const items = [];
      for (const item of history) {
        if (!item || !item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
        if (items.length >= 6) break;
      }
      if (items.length === 0) { section.style.display = 'none'; grid.innerHTML = ''; return; }
      section.style.display = 'block';
      grid.innerHTML = items.map(item => {
        const title = (typeof DataNormalizer !== 'undefined' && DataNormalizer.getTrackTitle) ? DataNormalizer.getTrackTitle(item) : (item.name || item.title || 'Song');
        const artist = (typeof DataNormalizer !== 'undefined' && DataNormalizer.getArtistString) ? DataNormalizer.getArtistString(item) : (item.artists || item.primaryArtist || '');
        const img = item.image || item.artwork || 'assets/logo.png';
        return `
          <div class="music-square-card" onclick="App.playSongWithQueue('${String(item.id).replace(/'/g, "\\'")}')">
            <div class="square-card-art-wrap"><img src="${img}" alt="" loading="lazy" onerror="this.src='assets/logo.png'" style="width:100%;height:100%;object-fit:cover;"></div>
            <div class="square-card-title">${UI.escapeHtml ? UI.escapeHtml(title) : title}</div>
            <div class="square-card-sub">${UI.escapeHtml ? UI.escapeHtml(artist) : artist}</div>
          </div>`;
      }).join('');
    } catch (e) {
      console.warn('[Library] recent grid failed:', e.message);
    }
  }

  // ==========================================================================
  // LOCK SCREEN SETTINGS (MusicFlow's own controls over the Android lock screen)
  // ==========================================================================
  function lockBridge() {
    return (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.isLockScreenControlsEnabled === 'function')
      ? window.AndroidMediaBridge : null;
  }

  function renderLockScreenSettings() {
    const section = document.getElementById('settings-lockscreen-section');
    if (!section) return;
    const bridge = lockBridge();
    if (!bridge) { section.style.display = 'none'; return; }
    section.style.display = '';
    try {
      const sw = document.getElementById('settings-lockscreen-switch');
      if (sw) sw.checked = !!bridge.isLockScreenControlsEnabled();
      const allowed = typeof bridge.canDrawOverlays === 'function' ? !!bridge.canDrawOverlays() : true;
      const val = document.getElementById('settings-lockscreen-overlay-val');
      const sub = document.getElementById('settings-lockscreen-overlay-sub');
      if (val) val.textContent = allowed ? 'Allowed' : 'Not allowed';
      if (sub) sub.textContent = allowed ? 'MusicFlow can show its lock screen on every phone' : 'Tap to allow. Needed on some phones when the app is closed';
    } catch (e) {
      console.warn('[LockScreen] settings render failed:', e.message);
    }
  }

  function toggleLockScreenControls(enabled) {
    const bridge = lockBridge();
    if (!bridge) return;
    try { bridge.setLockScreenControlsEnabled(!!enabled); } catch (_) {}
    UI.showToast(enabled ? 'MusicFlow lock screen on' : 'MusicFlow lock screen off');
  }

  function requestLockScreenOverlay() {
    const bridge = lockBridge();
    if (!bridge || typeof bridge.requestOverlayPermission !== 'function') return;
    try { bridge.requestOverlayPermission(); } catch (_) {}
    setTimeout(renderLockScreenSettings, 1500);
  }

  function previewLockScreen() {
    const bridge = lockBridge();
    if (!bridge || typeof bridge.previewLockScreen !== 'function') {
      if (typeof AmbientScreen !== 'undefined' && AmbientScreen.open) { closeBottomSheet('sheet-settings'); AmbientScreen.open(); }
      return;
    }
    const cur = (typeof Player !== 'undefined' && Player.getCurrentTrack) ? Player.getCurrentTrack() : null;
    if (!cur) { UI.showToast('Play a song first to preview the lock screen'); return; }
    try { bridge.previewLockScreen(); } catch (_) {}
  }

  // ==========================================================================
  // APPEARANCE (System / Light / Dark)
  // ==========================================================================
  function renderAppearanceSetting() {
    const mode = (typeof ThemeManager !== 'undefined' && ThemeManager.getAppearance) ? ThemeManager.getAppearance() : 'system';
    document.querySelectorAll('#settings-appearance-seg .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const sub = document.getElementById('settings-appearance-sub');
    if (sub) {
      const resolved = (typeof ThemeManager !== 'undefined' && ThemeManager.getResolvedAppearance) ? ThemeManager.getResolvedAppearance() : 'dark';
      sub.textContent = mode === 'system' ? `Follows your phone (${resolved} now)` : (mode === 'light' ? 'Always light' : 'Always dark');
    }
  }

  function setAppearance(mode) {
    if (typeof ThemeManager !== 'undefined' && ThemeManager.setAppearance) ThemeManager.setAppearance(mode);
    renderAppearanceSetting();
  }

  function openLibraryTab(tabName) {
    activeLibraryTab = tabName || 'playlists';
    const libTabsContainer = document.getElementById('library-tabs-bar');
    if (libTabsContainer) {
      libTabsContainer.querySelectorAll('.lib-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === activeLibraryTab);
      });
    }
    UI.renderLibraryTab(activeLibraryTab, librarySearchQuery, librarySortMode);
  }

  function setLibrarySort(sortMode) {
    librarySortMode = sortMode;
    UI.renderLibraryTab(activeLibraryTab, librarySearchQuery, librarySortMode);
  }

  function openCreatePlaylistModal() {
    editingPlaylistId = null;
    const titleEl = document.getElementById('modal-playlist-editor-title');
    const nameInp = document.getElementById('input-edit-pl-name');
    const descInp = document.getElementById('input-edit-pl-desc');
    if (titleEl) titleEl.textContent = 'Create Playlist';
    if (nameInp) nameInp.value = '';
    if (descInp) descInp.value = '';
    const modal = document.getElementById('modal-create-playlist');
    if (modal) modal.style.display = 'flex';
  }

  function openEditPlaylistModal(playlistId) {
    const pl = Storage.getPlaylists().find(p => p.id === playlistId);
    if (!pl) return;
    editingPlaylistId = playlistId;
    const titleEl = document.getElementById('modal-playlist-editor-title');
    const nameInp = document.getElementById('input-edit-pl-name');
    const descInp = document.getElementById('input-edit-pl-desc');
    if (titleEl) titleEl.textContent = 'Edit Playlist';
    if (nameInp) nameInp.value = pl.name || '';
    if (descInp) descInp.value = pl.description || '';
    const modal = document.getElementById('modal-create-playlist');
    if (modal) modal.style.display = 'flex';
  }

  function closeCreatePlaylistModal() {
    const modal = document.getElementById('modal-create-playlist');
    if (modal) modal.style.display = 'none';
    editingPlaylistId = null;
  }

  function submitPlaylistEditor() {
    const nameInp = document.getElementById('input-edit-pl-name');
    const descInp = document.getElementById('input-edit-pl-desc');
    const name = nameInp ? nameInp.value.trim() : '';
    const desc = descInp ? descInp.value.trim() : '';
    if (!name) {
      UI.showToast('Please enter a playlist name');
      return;
    }
    if (editingPlaylistId) {
      Storage.editPlaylist(editingPlaylistId, { name, description: desc });
      UI.showToast(`Updated "${name}"`);
    } else {
      Storage.createPlaylist(name, desc);
      UI.showToast(`Created playlist "${name}" 🎉`);
    }
    closeCreatePlaylistModal();
    UI.renderLibraryTab('playlists', librarySearchQuery, librarySortMode);
  }

  function openPlaylistMenu(playlistId) {
    const pl = Storage.getPlaylists().find(p => p.id === playlistId);
    if (!pl) return;
    selectedMenuPlaylistId = playlistId;
    const titleEl = document.getElementById('pl-action-title');
    const subEl = document.getElementById('pl-action-sub');
    if (titleEl) titleEl.textContent = pl.name;
    if (subEl) subEl.textContent = `${pl.songs?.length || 0} tracks`;
    const sheet = document.getElementById('sheet-playlist-actions');
    if (sheet) sheet.style.display = 'flex';
  }

  function closePlaylistMenu() {
    const sheet = document.getElementById('sheet-playlist-actions');
    if (sheet) sheet.style.display = 'none';
  }

  let activeDetailPlaylistId = null;
  let draggedPlaylistTrackIndex = -1;

  function playCustomPlaylistTrack(playlistId, trackIndex = 0) {
    const pl = Storage.getPlaylistById(playlistId);
    if (pl && pl.songs && pl.songs.length > 0) {
      const idx = Math.max(0, Math.min(trackIndex, pl.songs.length - 1));
      Player.setQueue(pl.songs, idx, true, {
        source: 'playlist',
        sourceId: playlistId,
        title: pl.name || 'Playlist',
        mode: 'playlist'
      });
      expandFullPlayer();
    } else {
      UI.showToast('Playlist is empty.');
    }
  }

  function playCustomPlaylist(playlistId) {
    playCustomPlaylistTrack(playlistId, 0);
  }

  function shuffleCustomPlaylist(playlistId) {
    const pl = Storage.getPlaylistById(playlistId);
    if (pl && pl.songs && pl.songs.length > 0) {
      Player.setQueue(pl.songs, 0, true, {
        source: 'playlist',
        sourceId: playlistId,
        title: pl.name || 'Playlist',
        mode: 'playlist'
      });
      if (!Player.getIsShuffle()) Player.toggleShuffle();
      expandFullPlayer();
    } else {
      UI.showToast('Playlist is empty.');
    }
  }

  function playNextPlaylist(playlistId) {
    const pl = Storage.getPlaylistById(playlistId);
    if (pl && pl.songs && pl.songs.length > 0) {
      pl.songs.forEach(s => Player.insertNext(s));
      UI.showToast(`Playing ${pl.songs.length} tracks next`);
    }
  }

  function addPlaylistToQueue(playlistId) {
    const pl = Storage.getPlaylistById(playlistId);
    if (pl && pl.songs && pl.songs.length > 0) {
      pl.songs.forEach(s => Player.addToQueue(s));
      UI.showToast(`Added ${pl.songs.length} tracks to queue`);
    }
  }

  function duplicateCustomPlaylist(playlistId) {
    Storage.duplicatePlaylist(playlistId);
    UI.showToast('Playlist duplicated');
    UI.renderLibraryTab('playlists', librarySearchQuery, librarySortMode);
  }

  function deleteCustomPlaylist(playlistId) {
    const pl = Storage.getPlaylistById(playlistId);
    const plName = pl?.name || 'Playlist';
    UI.showConfirmModal({
      title: 'Delete Playlist?',
      message: `"${plName}" will be permanently removed.`,
      confirmText: 'Delete',
      isDestructive: true,
      onConfirm: () => {
        Storage.deletePlaylist(playlistId);
        UI.showToast('Playlist deleted');
        if (activeDetailPlaylistId === playlistId) {
          navigate('library');
        }
        UI.renderLibraryTab('playlists', librarySearchQuery, librarySortMode);
      }
    });
  }


  function closeSongMenu() {
    const sheet = document.getElementById('sheet-song-actions');
    if (sheet) sheet.style.display = 'none';
  }

  function openAddToPlaylistModal(song) {
    if (song) selectedMenuSong = song;
    const modal = document.getElementById('modal-add-to-playlist');
    const container = document.getElementById('modal-playlists-container');
    const pls = Storage.getPlaylists().filter(p => p.id !== 'favorites_pl');
    if (container) {
      if (pls.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:10px 0; font-size:13px;">No custom playlists yet. Create one above!</p>';
      } else {
        container.innerHTML = pls.map(p => `
          <div class="modal-pl-item" onclick="App.addSongToSpecificPlaylist('${p.id}')">
            <span class="material-symbols-outlined" style="color:var(--accent);">queue_music</span>
            <div>
              <div style="font-weight:700; font-size:14px; color:#fff;">${p.name}</div>
              <div style="font-size:11.5px; color:var(--text-secondary);">${p.songs?.length || 0} songs</div>
            </div>
          </div>
        `).join('');
      }
    }
    if (modal) modal.style.display = 'flex';
  }

  function closeAddToPlaylistModal() {
    const modal = document.getElementById('modal-add-to-playlist');
    if (modal) modal.style.display = 'none';
  }

  function createAndAddSongToPlaylist() {
    const input = document.getElementById('input-modal-new-pl-name');
    const name = input ? input.value.trim() : '';
    if (!name) return;
    const newPl = Storage.createPlaylist(name);
    if (selectedMenuSong) {
      Storage.addToPlaylist(newPl.id, selectedMenuSong);
      UI.showToast(`Added to "${newPl.name}"`);
    }
    if (input) input.value = '';
    closeAddToPlaylistModal();
    UI.renderLibraryTab('playlists', librarySearchQuery, librarySortMode);
  }

  function addSongToSpecificPlaylist(playlistId) {
    if (selectedMenuSong) {
      const added = Storage.addToPlaylist(playlistId, selectedMenuSong);
      const pl = Storage.getPlaylistById(playlistId);
      if (added) {
        UI.showToast(`Added to "${pl ? pl.name : 'Playlist'}"`);
      } else {
        UI.showToast('Song is already in this playlist');
      }
    }
    closeAddToPlaylistModal();
    UI.renderLibraryTab('playlists', librarySearchQuery, librarySortMode);
  }

  function openCustomPlaylist(playlistId, addToHistory = true) {
    if (playlistId === 'favorites_pl' || playlistId === 'liked') {
      openLikedSongs();
      return;
    }
    const pl = Storage.getPlaylistById(playlistId);
    if (!pl) return;
    activeDetailPlaylistId = playlistId;

    if (addToHistory) {
      pushHistory('detail', { playlistId });
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const detailScreen = document.getElementById('screen-detail');
    if (detailScreen) detailScreen.classList.add('active');

    resetScrollToTop();
    UI.renderPlaylistDetail(playlistId);
    requestAnimationFrame(() => resetScrollToTop());
  }

  function startPlaylistRadio(playlistId) {
    const pl = Storage.getPlaylistById(playlistId);
    if (pl && pl.songs && pl.songs.length > 0) {
      startArtistRadioSeed(pl.songs[0].artists || pl.songs[0].name);
    } else {
      UI.showToast('Add songs to start playlist radio');
    }
  }

  function filterCurrentPlaylist(query) {
    if (activeDetailPlaylistId) {
      UI.renderPlaylistDetail(activeDetailPlaylistId, query);
    }
  }

  function clearPlaylistSearch() {
    const input = document.getElementById('playlist-detail-search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    filterCurrentPlaylist('');
  }

  function removeTrackFromCustomPlaylist(playlistId, songId) {
    Storage.removeFromPlaylist(playlistId, songId);
    UI.showToast('Removed track from playlist');
    if (activeDetailPlaylistId === playlistId) {
      UI.renderPlaylistDetail(playlistId);
    }
    UI.renderLibraryTab('playlists', librarySearchQuery, librarySortMode);
  }

  function handlePlaylistDragStart(e, idx) {
    draggedPlaylistTrackIndex = idx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    }
  }

  function handlePlaylistDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function handlePlaylistDrop(e, playlistId, targetIdx) {
    e.preventDefault();
    if (draggedPlaylistTrackIndex >= 0 && targetIdx >= 0 && draggedPlaylistTrackIndex !== targetIdx) {
      const pl = Storage.getPlaylistById(playlistId);
      if (pl && Array.isArray(pl.songs)) {
        const reordered = [...pl.songs];
        const [moved] = reordered.splice(draggedPlaylistTrackIndex, 1);
        reordered.splice(targetIdx, 0, moved);
        Storage.reorderPlaylist(playlistId, reordered);
        UI.renderPlaylistDetail(playlistId);
      }
    }
    draggedPlaylistTrackIndex = -1;
  }

  function saveQueueAsPlaylistAction() {
    const queue = Player.getQueue ? Player.getQueue() : [];
    if (!queue || queue.length === 0) {
      UI.showToast('Queue is currently empty');
      return;
    }
    const pl = Storage.saveQueueAsPlaylist(queue);
    if (pl) {
      UI.showToast(`Saved ${queue.length} tracks as "${pl.name}" ✨`);
      UI.renderLibraryTab('playlists', librarySearchQuery, librarySortMode);
    }
  }

  function exportPlaylistAction(playlistId) {
    const jsonStr = Storage.exportPlaylist(playlistId, 'json');
    if (jsonStr) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(jsonStr).then(() => {
          UI.showToast('Copied playlist JSON to clipboard 📋');
        }).catch(() => {
          UI.showToast('Exported playlist JSON');
        });
      } else {
        UI.showToast('Exported playlist JSON');
      }
    }
  }

  // ==========================================================================
  // PHASE 4 — LOCAL MUSIC & OFFLINE ENGINE HELPERS
  // ==========================================================================
  function triggerFolderImport() {
    if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.openMusicFolderPicker === 'function') {
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast('Select a music folder from device storage 📁');
      }
      window.AndroidMediaBridge.openMusicFolderPicker();
      return;
    }
    const isMobile = (typeof navigator !== 'undefined') && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    if (isMobile) {
      // Mobile systems (iOS Files & Android document picker) fallback to file input when bridge is absent
      const fileInput = document.getElementById('local-file-input');
      if (fileInput) fileInput.click();
    } else {
      const input = document.getElementById('local-folder-input');
      if (input) input.click();
    }
  }

  function triggerFilesImport() {
    if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.openAudioFilePicker === 'function') {
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast('Select audio files to import 🎵');
      }
      window.AndroidMediaBridge.openAudioFilePicker();
      return;
    }
    const input = document.getElementById('local-file-input');
    if (input) input.click();
  }

  function scanAllDeviceMusic() {
    if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.scanDeviceMusic === 'function') {
      showLoader(true);
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast('Scanning device for all music tracks... ⚡');
      }
      window.AndroidMediaBridge.scanDeviceMusic();
      return;
    }
    triggerFolderImport();
  }

  async function onAndroidLocalTracksScanned(tracksInput) {
    showLoader(false);
    try {
      let tracks = tracksInput;
      if (typeof tracks === 'string') {
        tracks = JSON.parse(tracks);
      }
      if (!Array.isArray(tracks) || tracks.length === 0) {
        if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
          UI.showToast('No audio files found in selected location');
        }
        return;
      }
      let imported = 0;
      for (const t of tracks) {
        if (!t || !t.id) continue;
        Storage.saveLocalSong(t);
        imported++;
      }
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast(`Imported ${imported} local songs 🎵`);
        UI.renderLibraryTab('local', librarySearchQuery, librarySortMode);
      }
    } catch (e) {
      console.error('[App] onAndroidLocalTracksScanned error:', e);
      if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
        UI.showToast('Failed to process local tracks: ' + (e.message || 'Error'));
      }
    }
  }

  async function handleLocalFilesImport(event) {
    const files = event?.target?.files;
    if (!files || files.length === 0) return;
    showLoader(true);
    let imported = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name)) continue;
      try {
        const meta = (typeof ID3Parser !== 'undefined') ? await ID3Parser.parse(file) : { title: file.name, artist: 'Local Artist' };
        const blobUrl = (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') ? URL.createObjectURL(file) : '';
        const track = {
          id: `loc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          name: meta.title || file.name,
          artists: meta.artist || 'Local Artist',
          album: meta.album || 'Local Music',
          albumArtist: meta.albumArtist || meta.artist || '',
          year: meta.year || '',
          genre: meta.genre || '',
          folderName: 'Device Files',
          image: meta.artwork || 'assets/logo.png',
          duration: 0,
          source: 'LOCAL',
          filename: file.name,
          localBlobUrl: blobUrl,
          streamUrl: blobUrl
        };
        Storage.saveLocalSong(track, file);
        if (typeof AudioFeatureExtractor !== 'undefined' && typeof FeatureStore !== 'undefined') {
          AudioFeatureExtractor.extractFromBlob(file, track).then(features => {
            FeatureStore.saveFeatures(track.id, features);
            FeatureStore.setIndexingState(track.id, FeatureStore.INDEXING_STATE.INDEXED);
          }).catch(() => {});
        }
        imported++;
      } catch (err) {
        console.warn('[LocalImport] file error:', err);
      }
    }
    if (event?.target) event.target.value = '';
    showLoader(false);
    UI.showToast(`Imported ${imported} local tracks 🎵`);
    UI.renderLibraryTab('local', librarySearchQuery, librarySortMode);
  }

  async function handleLocalFolderImport(event) {
    const files = event?.target?.files;
    if (!files || files.length === 0) return;
    showLoader(true);
    let imported = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name)) continue;
      try {
        const meta = (typeof ID3Parser !== 'undefined') ? await ID3Parser.parse(file) : { title: file.name, artist: 'Local Artist' };
        const relPath = file.webkitRelativePath || '';
        const folderName = relPath ? relPath.split('/')[0] : 'Music Folder';
        const blobUrl = (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') ? URL.createObjectURL(file) : '';
        const track = {
          id: `loc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          name: meta.title || file.name,
          artists: meta.artist || 'Local Artist',
          album: meta.album || folderName,
          albumArtist: meta.albumArtist || meta.artist || '',
          year: meta.year || '',
          genre: meta.genre || '',
          folderName: folderName,
          image: meta.artwork || 'assets/logo.png',
          duration: 0,
          source: 'LOCAL',
          filename: file.name,
          localBlobUrl: blobUrl,
          streamUrl: blobUrl
        };
        Storage.saveLocalSong(track, file);
        if (typeof AudioFeatureExtractor !== 'undefined' && typeof FeatureStore !== 'undefined') {
          AudioFeatureExtractor.extractFromBlob(file, track).then(features => {
            FeatureStore.saveFeatures(track.id, features);
            FeatureStore.setIndexingState(track.id, FeatureStore.INDEXING_STATE.INDEXED);
          }).catch(() => {});
        }
        imported++;
      } catch (err) {
        console.warn('[LocalFolderImport] file error:', err);
      }
    }
    if (event?.target) event.target.value = '';
    showLoader(false);
    UI.showToast(`Imported ${imported} songs from folder 📁`);
    UI.renderLibraryTab('local', librarySearchQuery, librarySortMode);
  }

  function setLocalSubTab(subTab) {
    window.currentLocalSubTab = subTab;
    UI.renderLibraryTab('local', librarySearchQuery, librarySortMode);
  }

  function playLocalCollection(id, type) {
    let songs = [];
    if (type === 'album') {
      const albums = Storage.getLocalAlbums();
      const alb = albums.find(a => a.id === id);
      if (alb) songs = alb.songs;
    } else if (type === 'artist') {
      const artists = Storage.getLocalArtists();
      const art = artists.find(a => a.id === id);
      if (art) songs = art.songs;
    } else if (type === 'folder') {
      const folders = Storage.getLocalFolders();
      const fld = folders.find(f => f.id === id);
      if (fld) songs = fld.songs;
    }

    if (songs.length > 0) {
      Player.setQueue(songs, 0, true, { source: 'local', title: 'Local Music' });
      expandFullPlayer();
    } else {
      UI.showToast('No playable songs in this collection.');
    }
  }

  function removeLocalTrackAction(songId) {
    Storage.removeLocalSong(songId);
    UI.showToast('Removed track from local library');
    UI.renderLibraryTab('local', librarySearchQuery, librarySortMode);
  }

  async function clearAllDownloadsAction() {
    UI.showConfirmModal({
      title: 'Clear Downloads?',
      message: 'Clear all downloaded offline music? This will free storage space.',
      confirmText: 'Clear All',
      isDestructive: true,
      onConfirm: async () => {
        if (typeof DownloadManager !== 'undefined') {
          await DownloadManager.clearAllDownloads();
        } else {
          await Storage.clearAllDownloads();
        }
        UI.showToast('Cleared all offline downloads 🧹');
        UI.renderLibraryTab('downloads', librarySearchQuery, librarySortMode);
      }
    });
  }

  function downloadPlaylistAction(playlistId) {
    const pl = Storage.getPlaylists().find(p => p.id === playlistId) || (typeof Storage.getPlaylistById === 'function' ? Storage.getPlaylistById(playlistId) : null);
    if (!pl || !pl.songs || pl.songs.length === 0) {
      UI.showToast('Playlist has no tracks to download.');
      return;
    }
    if (typeof DownloadManager !== 'undefined') {
      DownloadManager.enqueueMultiple(pl.songs);
      UI.showToast(`Queued ${pl.songs.length} tracks for download ⏳`);
    } else {
      pl.songs.forEach(s => downloadTrack(s));
    }
  }

  async function downloadAlbumAction(albumId) {
    let songs = [];
    if (typeof albumId === 'object' && albumId.songs) {
      songs = albumId.songs;
    } else if (typeof API !== 'undefined' && API.getAlbumDetails) {
      const data = await API.getAlbumDetails(albumId);
      if (data && data.songs) songs = data.songs;
    }
    if (songs.length === 0) {
      UI.showToast('Album has no tracks to download.');
      return;
    }
    if (typeof DownloadManager !== 'undefined') {
      DownloadManager.enqueueMultiple(songs);
      UI.showToast(`Queued ${songs.length} album tracks for download ⏳`);
    } else {
      songs.forEach(s => downloadTrack(s));
    }
  }

  function downloadLikedSongsAction() {
    const favs = Storage.getFavorites();
    if (!favs || favs.length === 0) {
      UI.showToast('No liked songs to download.');
      return;
    }
    if (typeof DownloadManager !== 'undefined') {
      DownloadManager.enqueueMultiple(favs);
      UI.showToast(`Queued ${favs.length} liked songs for download ⏳`);
    } else {
      favs.forEach(s => downloadTrack(s));
    }
  }

  let activeDetailAlbumData = null;

  async function openAlbum(albumIdOrName, albumTitle = '', artistName = '', addToHistory = true) {
    if (!albumIdOrName && !albumTitle) return;
    showLoader(true);
    try {
      let albumData = null;
      // 1. Try fetching via API getAlbumDetails if it looks like an ID
      if (albumIdOrName && !/^\s+$/.test(albumIdOrName)) {
        albumData = await API.getAlbumDetails(albumIdOrName).catch(() => null);
      }

      // 2. If getAlbumDetails returned no songs or failed, search songs by album name + artist
      if (!albumData || !albumData.songs || albumData.songs.length === 0) {
        const query = `${albumTitle || albumIdOrName} ${artistName}`.trim();
        const songs = await API.searchSongs(query, 1, 20).catch(() => []);
        if (songs && songs.length > 0) {
          albumData = {
            id: albumIdOrName || `album_${Date.now()}`,
            name: albumTitle || albumIdOrName || songs[0].album || 'Album',
            title: albumTitle || albumIdOrName || songs[0].album || 'Album',
            artist: artistName || songs[0].primaryArtist || songs[0].artists || 'Artist',
            primaryArtist: artistName || songs[0].primaryArtist || songs[0].artists || 'Artist',
            year: songs[0].year || '',
            image: songs[0].image || 'assets/logo.png',
            songs: songs
          };
        }
      }

      if (albumData && albumData.songs && albumData.songs.length > 0) {
        activeDetailAlbumData = albumData;
        if (addToHistory) {
          pushHistory('album', {
            albumId: albumData.id,
            albumTitle: albumData.name || albumData.title,
            artistName: albumData.artist || albumData.primaryArtist
          });
        }

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const detailScreen = document.getElementById('screen-detail');
        if (detailScreen) detailScreen.classList.add('active');

        resetScrollToTop();
        UI.renderAlbumDetail(albumData);
        requestAnimationFrame(() => resetScrollToTop());
      } else {
        UI.showToast(`Could not load album "${albumTitle || albumIdOrName}"`);
      }
    } catch (e) {
      console.error('[App] openAlbum error:', e);
      UI.showToast('Could not load album');
    }
    showLoader(false);
  }

  function playAlbumTrack(index = 0) {
    if (activeDetailAlbumData && Array.isArray(activeDetailAlbumData.songs) && activeDetailAlbumData.songs.length > 0) {
      Player.setQueue(activeDetailAlbumData.songs, index, true);
      expandFullPlayer();
    }
  }

  function shuffleAlbum() {
    if (activeDetailAlbumData && Array.isArray(activeDetailAlbumData.songs) && activeDetailAlbumData.songs.length > 0) {
      Player.setQueue(activeDetailAlbumData.songs, 0, true);
      Player.toggleShuffle();
      expandFullPlayer();
    }
  }

  function startAlbumRadio() {
    if (activeDetailAlbumData && Array.isArray(activeDetailAlbumData.songs) && activeDetailAlbumData.songs.length > 0) {
      startRadio(activeDetailAlbumData.songs[0]);
    } else if (activeDetailAlbumData) {
      startRadio(activeDetailAlbumData.artist || activeDetailAlbumData.name);
    }
  }

  
  function shareAlbumAction() {
    if (!activeDetailAlbumData) return;
    const title = activeDetailAlbumData.name || activeDetailAlbumData.title;
    const artist = activeDetailAlbumData.artist || activeDetailAlbumData.primaryArtist || '';
    if (navigator.share) {
      navigator.share({ title: title, text: `Listen to ${title} by ${artist} on MusicFlow`, url: window.location.href });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${title} by ${artist}`);
      UI.showToast('Album link copied to clipboard!');
    }
  }

  function scrollSearchToTop() {
    const main = document.getElementById('main-scroll-container') || window;
    if (main.scrollTo) {
      main.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      main.scrollTop = 0;
    }
  }

  async function openPlaylist(playlistId, playlistTitle = '', addToHistory = true) {
    if (!playlistId && !playlistTitle) return;
    showLoader(true);
    try {
      // 1. Check if user custom playlist in Storage first
      const customPl = (typeof Storage !== 'undefined' && Storage.getPlaylistById)
        ? Storage.getPlaylistById(playlistId)
        : null;
      if (customPl) {
        showLoader(false);
        return openCustomPlaylist(playlistId, addToHistory);
      }

      // 2. Fetch catalog playlist details from API
      let playlistData = null;
      if (typeof API !== 'undefined' && API.getPlaylistDetails && playlistId) {
        playlistData = await API.getPlaylistDetails(playlistId).catch(() => null);
      }

      // 3. Fallback search by title if API details returned empty or null
      if (!playlistData || !playlistData.songs || playlistData.songs.length === 0) {
        const query = (playlistTitle || playlistId || '').trim();
        if (query && typeof API !== 'undefined' && API.searchSongs) {
          const songs = await API.searchSongs(query, 1, 50).catch(() => []);
          if (songs && songs.length > 0) {
            playlistData = {
              id: playlistId || `pl_${Date.now()}`,
              name: playlistTitle || playlistId,
              title: playlistTitle || playlistId,
              type: 'playlist',
              subtitle: 'MusicFlow',
              image: songs[0].image || 'assets/logo.png',
              songs: songs
            };
          }
        }
      }

      if (playlistData && playlistData.songs && playlistData.songs.length > 0) {
        playlistData.type = 'playlist';
        if (!playlistData.artist && !playlistData.primaryArtist) {
          playlistData.artist = playlistData.subtitle || playlistData.header_desc || 'MusicFlow';
          playlistData.primaryArtist = playlistData.artist;
        }
        activeDetailAlbumData = playlistData;
        activeDetailPlaylistId = playlistData.id;

        if (addToHistory) {
          pushHistory('detail', {
            playlistId: playlistData.id,
            playlistTitle: playlistData.name || playlistData.title,
            type: 'playlist'
          });
        }

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const detailScreen = document.getElementById('screen-detail');
        if (detailScreen) detailScreen.classList.add('active');

        resetScrollToTop();
        UI.renderAlbumDetail(playlistData);
        requestAnimationFrame(() => resetScrollToTop());
      } else {
        UI.showToast(`Could not load playlist "${playlistTitle || playlistId}"`);
      }
    } catch (e) {
      console.error('[App] openPlaylist error:', e);
      UI.showToast('Could not load playlist');
    }
    showLoader(false);
  }

  async function openAlbumOrPlaylist(id, type, title = '', artist = '') {
    if (type === 'album') {
      return openAlbum(id, title, artist);
    }
    return openPlaylist(id, title);
  }

  // ==========================================================================
  // YOUTUBE PLAYLIST IMPORT & CATALOG MATCHING (Phase 6)
  // ==========================================================================
  let activeImportedPlaylist = null;

  function openImportYouTubePlaylistModal() {
    const modal = document.getElementById('modal-import-yt-playlist');
    const input = document.getElementById('input-import-yt-url');
    const loader = document.getElementById('import-yt-loading');
    const results = document.getElementById('import-yt-results');
    const preview = document.getElementById('import-yt-tracks-preview');

    if (input) input.value = '';
    if (loader) loader.style.display = 'none';
    if (results) results.style.display = 'none';
    if (preview) preview.innerHTML = '';
    activeImportedPlaylist = null;

    if (modal) modal.style.display = 'flex';
  }

  function closeImportYouTubePlaylistModal() {
    const modal = document.getElementById('modal-import-yt-playlist');
    if (modal) modal.style.display = 'none';
    activeImportedPlaylist = null;
  }

  async function submitYouTubePlaylistImport() {
    const input = document.getElementById('input-import-yt-url');
    const loader = document.getElementById('import-yt-loading');
    const results = document.getElementById('import-yt-results');
    const preview = document.getElementById('import-yt-tracks-preview');
    const foundEl = document.getElementById('stat-yt-found');
    const matchedEl = document.getElementById('stat-yt-matched');
    const unmatchedEl = document.getElementById('stat-yt-unmatched');
    const saveBtn = document.getElementById('btn-save-imported-pl');

    const url = (input?.value || '').trim();
    if (!url) {
      UI.showToast('Please enter a valid YouTube playlist or track link');
      return;
    }

    if (loader) loader.style.display = 'block';
    if (results) results.style.display = 'none';

    const parsedYt = (typeof DataNormalizer !== 'undefined' && DataNormalizer.parseYouTubeUrl)
      ? DataNormalizer.parseYouTubeUrl(url)
      : null;

    const hasListParam = /[?&]list=([a-zA-Z0-9_-]+)/i.test(url);
    const isSingleTrack = parsedYt && parsedYt.type === 'track' && !hasListParam;
    const endpoint = isSingleTrack ? '/api/providers/ytmusic/import-track' : '/api/providers/ytmusic/import-playlist';
    const fullUrl = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.buildUrl === 'function') ? ApiConfig.buildUrl(endpoint) : endpoint;
    const platform = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.isRunningInIOS === 'function' && ApiConfig.isRunningInIOS())
      ? 'iOS'
      : ((typeof ApiConfig !== 'undefined' && typeof ApiConfig.isRunningInAndroid === 'function' && ApiConfig.isRunningInAndroid()) ? 'Android' : 'Desktop');
    const isIOS = platform === 'iOS';
    const endpointType = (fullUrl.startsWith('http://localhost') || fullUrl.startsWith('http://127.0.0.1')) ? 'local' : 'production';
    const requestStartTime = new Date().toISOString();

    if (isIOS) {
      console.log(`[YT-IMPORT][iOS]\nURL: ${url}\nEndpoint: ${fullUrl}\nMethod: POST\nRequest started: ${requestStartTime}`);
    } else {
      console.log(`[Import] Platform: ${platform} | Provider: YouTube Music | Endpoint: ${endpointType} | Request started`);
    }

    let failureStage = 'INITIALIZATION';

    try {
      let resData = null;
      let lastNetworkError = null;
      let isTimedOut = false;

      const ytm = (typeof YouTubeMusicService !== 'undefined')
        ? YouTubeMusicService
        : (typeof window !== 'undefined' && window.YouTubeMusicService ? window.YouTubeMusicService : null);

      // 1. Primary Engine: Direct YouTube Music Service (with native OkHttp/URLSession bridges)
      failureStage = 'YTM_SERVICE_EXTRACTION';
      if (ytm) {
        try {
          if (isSingleTrack && typeof ytm.importTrack === 'function') {
            resData = await ytm.importTrack(url);
          } else if (typeof ytm.importAndMatchPlaylist === 'function') {
            resData = await ytm.importAndMatchPlaylist(url);
          }
        } catch (adapterErr) {
          lastNetworkError = adapterErr;
          console.warn('[Import] YouTubeMusicService direct extract notice:', adapterErr.message);
        }
      }

      // 2. Secondary Backend Endpoint Fallback (Desktop only — no backend server on iOS/Android)
      if ((!resData || resData.success === false) && !isIOS && platform !== 'Android') {
        failureStage = 'NETWORK_REQUEST';
        try {
          const abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const timeoutTimer = abortController ? setTimeout(() => {
            isTimedOut = true;
            abortController.abort();
          }, 15000) : null;

          const fetchOptions = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ url })
          };
          if (abortController) {
            fetchOptions.signal = abortController.signal;
          }

          const res = await fetch(fullUrl, fetchOptions);
          if (timeoutTimer) clearTimeout(timeoutTimer);

          if (res.ok) {
            const responseText = await res.text();
            if (responseText) {
              try {
                resData = JSON.parse(responseText);
              } catch (_) {}
            }
          }
        } catch (netErr) {
          lastNetworkError = netErr;
        }
      }

      // 3. Error Differentiation & User-Friendly Messaging
      if (!resData || resData.success === false) {
        failureStage = 'ERROR_ANALYSIS';
        let userMessage = "YouTube playlist couldn't be imported right now.";

        if (isTimedOut || (lastNetworkError && (lastNetworkError.name === 'AbortError' || lastNetworkError.name === 'TimeoutError' || String(lastNetworkError.message || '').toLowerCase().includes('timeout')))) {
          userMessage = 'Import service timed out. Please try again.';
        } else if (lastNetworkError && !resData) {
          userMessage = lastNetworkError.message || "Couldn't connect. Check your internet connection and try again.";
        } else if (resData?.code === 'MISSING_URL' || resData?.error?.code === 'MISSING_URL') {
          userMessage = 'Please enter a valid public YouTube playlist or track link.';
        } else if (resData?.totalFound === 0 || resData?.code === 'EMPTY_PLAYLIST' || resData?.error?.code === 'EMPTY_PLAYLIST' || resData?.error?.message?.includes('no accessible tracks')) {
          userMessage = 'Playlist contains no accessible tracks.';
        } else if (resData?.error?.message) {
          userMessage = resData.error.message;
        } else if (typeof resData?.error === 'string') {
          userMessage = resData.error;
        }

        if (isIOS) {
          console.error(`[YT-IMPORT][iOS]\nFailure stage: ${failureStage}\nError: ${userMessage}`);
        } else {
          console.error(`[Import] Failure on ${platform} (${endpointType}):`, userMessage);
        }
        throw new Error(userMessage);
      }

      failureStage = 'TRACK_NORMALIZATION';
      const extractedCount = resData.totalFound !== undefined ? resData.totalFound : (resData.track ? 1 : (resData.allTracks ? resData.allTracks.length : 0));
      const matchedCount = resData.matchedCount !== undefined ? resData.matchedCount : (resData.track ? 1 : (resData.matchedTracks ? resData.matchedTracks.length : 0));
      const unavailableCount = resData.unmatchedCount !== undefined ? resData.unmatchedCount : (resData.unmatchedTracks ? resData.unmatchedTracks.length : 0);

      if (isIOS) {
        console.log(`[YT-IMPORT][iOS]\nTracks extracted: ${extractedCount}\nTracks matched: ${matchedCount}\nTracks unavailable: ${unavailableCount}`);
      } else {
        console.log(`[Import] Tracks extracted: ${extractedCount} | matched: ${matchedCount} | unavailable: ${unavailableCount}`);
      }

      let data = resData;

      if (isSingleTrack && resData.track) {
        const tr = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.normalizeTrack(resData.track) : resData.track;
        if (tr) {
          tr.playbackAvailable = true;
          tr.isPlayable = true;
          registerTrack(tr);
        }
        data = {
          type: 'song',
          isSingleSong: true,
          playlistTitle: tr.name || tr.title,
          image: tr.image || tr.albumArt,
          totalFound: 1,
          matchedCount: 1,
          unmatchedCount: 0,
          matchedTracks: [tr],
          unmatchedTracks: [],
          allTracks: [tr]
        };
      } else if (data && data.allTracks) {
        data.allTracks = data.allTracks.map(t => {
          const norm = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.normalizeTrack(t) : t;
          return norm || t;
        });
        registerTracks(data.allTracks);
      }

      activeImportedPlaylist = data;

      if (loader) loader.style.display = 'none';
      if (results) results.style.display = 'flex';

      if (foundEl) foundEl.textContent = data.totalFound !== undefined ? data.totalFound : (data.allTracks ? data.allTracks.length : 0);
      if (matchedEl) matchedEl.textContent = data.matchedCount !== undefined ? data.matchedCount : (data.matchedTracks ? data.matchedTracks.length : 0);
      if (unmatchedEl) unmatchedEl.textContent = data.unmatchedCount !== undefined ? data.unmatchedCount : 0;

      if (saveBtn) {
        if (data.isSingleSong) {
          saveBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">favorite</span><span>Save to My Music</span>';
        } else {
          saveBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">playlist_add_check</span><span>Save to My Music</span>';
        }
      }

      if (preview) {
        const allTracks = data.allTracks || [];
        preview.innerHTML = allTracks.map((song, idx) => {
          const isMatched = song.playbackAvailable || song.audioUrl || song.streamUrl;
          const artistName = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getArtistString(song) : (song.artists || 'Unknown Artist');
          return `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; background:rgba(255,255,255,0.03);">
              <span style="font-size:11px; color:var(--text-secondary); width:18px;">${idx + 1}</span>
              <img src="${song.image || 'assets/logo.png'}" style="width:32px; height:32px; border-radius:6px; object-fit:cover;" onerror="this.src='assets/logo.png'">
              <div style="flex:1; min-width:0;">
                <div style="font-size:12.5px; font-weight:600; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(song.name || song.title || 'Track')}</div>
                <div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(artistName)}</div>
              </div>
              <span style="font-size:10.5px; font-weight:700; padding:2px 6px; border-radius:6px; background:${isMatched ? 'rgba(0,242,254,0.15)' : 'var(--accent-soft)'}; color:${isMatched ? '#00F2FE' : 'var(--accent)'};">
                ${isMatched ? 'Matched' : 'Unavailable'}
              </span>
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      if (loader) loader.style.display = 'none';
      console.error('[YouTubeImport] Import failed:', err);

      let userMsg = "Couldn't connect. Check your internet connection and try again.";
      if (err.name === 'AbortError' || err.name === 'TimeoutError' || (err.message && err.message.toLowerCase().includes('timeout'))) {
        userMsg = 'Import service timed out. Please try again.';
      } else if (err.message && !err.message.includes('500') && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError') && !err.message.includes('fetch')) {
        userMsg = err.message;
      }
      UI.showToast(userMsg);
    }
  }

  function saveImportedPlaylist() {
    if (!activeImportedPlaylist || !activeImportedPlaylist.allTracks) {
      UI.showToast('No imported track to save.');
      return;
    }

    if (activeImportedPlaylist.isSingleSong || activeImportedPlaylist.type === 'song') {
      const rawSong = activeImportedPlaylist.allTracks[0];
      const song = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.normalizeTrack(rawSong) : rawSong;
      if (song) {
        registerTrack(song);
        Storage.addFavorite(song);
        closeImportYouTubePlaylistModal();
        UI.renderLibraryTab('liked', librarySearchQuery, librarySortMode);
        UI.showToast(`Saved "${song.name}" to My Music 🎵`);
        return;
      }
    }

    const title = activeImportedPlaylist.playlistTitle || 'Imported YouTube Playlist';
    const desc = activeImportedPlaylist.description || `Imported from YouTube Music (${activeImportedPlaylist.matchedCount || activeImportedPlaylist.allTracks.length}/${activeImportedPlaylist.totalFound || activeImportedPlaylist.allTracks.length} matched)`;
    const rawSongs = activeImportedPlaylist.allTracks || [];
    const songs = rawSongs.map(s => (typeof DataNormalizer !== 'undefined' ? DataNormalizer.normalizeTrack(s) : s)).filter(Boolean);

    const cover = (songs[0] && (songs[0].image || songs[0].artwork)) || '';
    const newPl = Storage.createPlaylist(title, desc, cover, songs);
    if (newPl && newPl.id) {
      // Record recommendation imported taste signal
      if (typeof RecommendationEngine !== 'undefined' && RecommendationEngine.recordImportSignal) {
        RecommendationEngine.recordImportSignal(songs);
      }

      closeImportYouTubePlaylistModal();
      UI.renderLibraryTab('playlists', librarySearchQuery, librarySortMode);
      UI.showToast(`Saved "${title}" (${songs.length} tracks) 🎉`);
    } else {
      UI.showToast('Could not save playlist.');
    }
  }

  // ==========================================================================
  // IN-APP UPDATE SYSTEM HANDLERS
  // ==========================================================================
  function showImprovementsPanel() {
    if (typeof UpdateManager !== 'undefined' && typeof UpdateManager.showImprovementsPanel === 'function') {
      UpdateManager.showImprovementsPanel();
    } else if (typeof UI !== 'undefined' && UI.showUpdateDialog) {
      UI.showUpdateDialog({
        title: "MusicFlow What's New",
        latestVersion: '2.7.2',
        releaseNotes: [
          "⚡ 120 FPS Instant Search & 0ms Playback: Eliminated typing lag with AbortSignal request pruning and instant pre-cached audio streams.",
          "✨ Zero-Scroll Playlist & Album Navigation: Opening any playlist or album immediately resets view to top header with smooth animations.",
          "💿 Resilient Discography & Top Albums: Multi-tier fallback ensures album shelves never get stuck loading.",
          "♾️ Infinite Unbroken Radio & Up Next: Automatic dynamic fallback queues guarantee non-stop playback without dead ends.",
          "🎧 3D Spatial Audio & Equalizer v2: Ultra-crisp audio tuning with bass boost and surround virtualization.",
          "🚀 Sideload APK Direct Updates: Instant delivery of new releases and APK downloads with 1-click update."
        ]
      }, false, true);
    }
  }

  function checkUpdatesManual() {
    if (typeof UpdateManager !== 'undefined') {
      UpdateManager.checkForUpdates({ manual: true });
    }
  }

  function openUpdateDownload() {
    if (typeof UpdateManager !== 'undefined') {
      UpdateManager.openUpdate();
    } else {
      window.open('https://adi6499.github.io/MUSICFLOW/', '_blank');
    }
  }

  function openWebsite() {
    if (typeof UpdateManager !== 'undefined' && typeof UpdateManager.openWebsite === 'function') {
      UpdateManager.openWebsite();
    } else {
      window.open('https://adi6499.github.io/MUSICFLOW/', '_blank');
    }
  }

  function openGitHubRelease() {
    // Redirect to official website where Android APK is available instead of GitHub
    openWebsite();
  }

  function dismissUpdateDialog() {
    if (typeof UpdateManager !== 'undefined') {
      UpdateManager.dismissUpdate();
    }
  }

  function dismissUpdateBanner() {
    if (typeof UI !== 'undefined' && UI.hideUpdateBanner) {
      UI.hideUpdateBanner();
    }
  }

  function closeUpdateDialog() {
    if (typeof UpdateManager !== 'undefined') {
      const state = UpdateManager.getState();
      if (state.updateRequired) return;
      UpdateManager.dismissUpdate();
    }
  }

  // ==========================================================================
  // UNIFIED MODAL FORWARDERS & 3D SWIPE DISCOVERY HANDLERS
  // ==========================================================================
  function closeConfirmModal(isConfirmed) {
    if (typeof UI !== 'undefined' && UI.closeConfirmModal) {
      UI.closeConfirmModal(isConfirmed);
    }
  }

  function closePromptModal(val) {
    if (typeof UI !== 'undefined' && UI.closePromptModal) {
      UI.closePromptModal(val);
    }
  }

  function submitPromptModal() {
    if (typeof UI !== 'undefined' && UI.submitPromptModal) {
      UI.submitPromptModal();
    }
  }

  // ==========================================================================
  // ENDLESS 3D DISCOVERY CARD ENGINE (State-Machine Driven & Race-Free)
  // ==========================================================================
  const SwipeState = {
    IDLE: 'IDLE',
    DRAGGING: 'DRAGGING',
    COMMITTING: 'COMMITTING',
    LOADING_NEXT: 'LOADING_NEXT',
    READY: 'READY'
  };

  let swipeSongs = [];
  let swipeCurrentIndex = 0;
  let swipeState = SwipeState.IDLE;
  let isFetchingDiscoveryBatch = false;
  let discoveryActiveMood = 'all';

  async function fetchMoreDiscoveryCards(silent = false) {
    if (isFetchingDiscoveryBatch) return;
    isFetchingDiscoveryBatch = true;
    if (!silent && swipeSongs.length === 0) showLoader(true);

    try {
      let candidatePool = [];
      const userLangs = (typeof Storage !== 'undefined' && Storage.getLanguages) ? Storage.getLanguages() : ['hindi', 'english'];

      if (typeof HomeDataLayer !== 'undefined' && HomeDataLayer.getQuickPicks) {
        const qp = await HomeDataLayer.getQuickPicks();
        if (Array.isArray(qp)) candidatePool.push(...qp);
      }

      if (typeof API !== 'undefined' && API.getHomeFeed) {
        const feed = await API.getHomeFeed(userLangs);
        if (feed?.quickPicks) candidatePool.push(...feed.quickPicks);
        if (feed?.trending?.songs) candidatePool.push(...feed.trending.songs);
      }

      let newBatch = [];
      if (typeof RecommendationEngine !== 'undefined' && RecommendationEngine.getDiscoveryFeed) {
        newBatch = RecommendationEngine.getDiscoveryFeed(candidatePool, {
          mood: discoveryActiveMood,
          selectedLanguages: userLangs,
          limit: 25,
          excludeIds: swipeSongs.map(s => String(s.id))
        });
      } else {
        newBatch = candidatePool.slice(0, 25);
      }

      if (newBatch && newBatch.length > 0) {
        // Append to existing discovery stack preserving current pointer
        swipeSongs = [...swipeSongs, ...newBatch];
        if (typeof UI !== 'undefined' && UI.renderSwipeDiscovery) {
          UI.renderSwipeDiscovery(swipeSongs.slice(swipeCurrentIndex));
        }
        attachSwipeGestures();
      }
    } catch (err) {
      console.warn('[DiscoveryEngine] Batch fetch error:', err);
    } finally {
      isFetchingDiscoveryBatch = false;
      if (!silent) showLoader(false);
      swipeState = SwipeState.READY;
    }
  }

  async function initSwipeDiscovery() {
    if (swipeSongs.length > 0 && swipeCurrentIndex < swipeSongs.length) {
      if (typeof UI !== 'undefined' && UI.renderSwipeDiscovery) {
        UI.renderSwipeDiscovery(swipeSongs.slice(swipeCurrentIndex));
      }
      attachSwipeGestures();
      return;
    }

    await fetchMoreDiscoveryCards(false);
  }

  async function refreshDiscoveryFeed() {
    swipeSongs = [];
    swipeCurrentIndex = 0;
    if (typeof RecommendationEngine !== 'undefined' && RecommendationEngine.resetDiscoverySession) {
      RecommendationEngine.resetDiscoverySession();
    }
    await fetchMoreDiscoveryCards(false);
  }

  function playDiscoveryTrack(song) {
    if (!song) return;
    const remainingQueue = swipeSongs.slice(swipeCurrentIndex);
    Player.setQueue(remainingQueue, 0, true, { source: 'discovery', mode: 'normal' });
  }

  function swipeCardAction(action) {
    if (swipeState === SwipeState.COMMITTING || swipeState === SwipeState.LOADING_NEXT) {
      return; // Ignore inputs during transition commitment
    }

    if (swipeCurrentIndex >= swipeSongs.length) {
      fetchMoreDiscoveryCards(false);
      return;
    }

    swipeState = SwipeState.COMMITTING;
    const currentSong = swipeSongs[swipeCurrentIndex];
    const topCard = document.getElementById('swipe-card-0');
    const nextCard = document.getElementById('swipe-card-1');

    if (action === 'like') {
      Storage.addFavorite(currentSong);
      UI.showToast(`Saved "${currentSong.name || currentSong.title}" to Favorites ❤️`);
      if (topCard) {
        topCard.style.transition = 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.28s ease';
        topCard.style.transform = 'translate3d(120%, 0, 0) rotate(12deg)';
        topCard.style.opacity = '0';
      }
    } else if (action === 'nope') {
      if (topCard) {
        topCard.style.transition = 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.28s ease';
        topCard.style.transform = 'translate3d(-120%, 0, 0) rotate(-12deg)';
        topCard.style.opacity = '0';
      }
    } else if (action === 'play') {
      playDiscoveryTrack(currentSong);
      if (topCard) {
        topCard.style.transition = 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.28s ease';
        topCard.style.transform = 'translate3d(0, -110%, 0) scale(1.03)';
        topCard.style.opacity = '0';
      }
    }

    if (nextCard) {
      nextCard.style.transition = 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.28s ease';
      nextCard.style.transform = 'translate3d(0, 0, 0) scale(1)';
      nextCard.style.opacity = '1';
    }

    setTimeout(() => {
      // Exactly 1 card consumed per completed gesture
      swipeCurrentIndex++;
      swipeState = SwipeState.READY;

      if (typeof UI !== 'undefined' && UI.renderSwipeDiscovery) {
        UI.renderSwipeDiscovery(swipeSongs.slice(swipeCurrentIndex));
      }
      attachSwipeGestures();

      // Silent prefetch when 5 or fewer cards remain ahead in stack
      if (swipeSongs.length - swipeCurrentIndex <= 5) {
        fetchMoreDiscoveryCards(true);
      }
    }, 280);
  }

  function attachSwipeGestures() {
    if (typeof document === 'undefined') return;
    const card = document.getElementById('swipe-card-0');
    if (!card) return;

    let startX = 0, startY = 0, currentX = 0, currentY = 0;
    let isDragging = false;

    const onPointerDown = (e) => {
      if (swipeState === SwipeState.COMMITTING || swipeState === SwipeState.LOADING_NEXT) return;
      isDragging = true;
      swipeState = SwipeState.DRAGGING;
      startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      startY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      card.classList.add('dragging');
      if (card.setPointerCapture && e.pointerId) {
        try { card.setPointerCapture(e.pointerId); } catch (_) {}
      }
    };

    const onPointerMove = (e) => {
      if (!isDragging || swipeState !== SwipeState.DRAGGING) return;
      const x = (e.clientX || (e.touches && e.touches[0].clientX) || 0) - startX;
      const y = (e.clientY || (e.touches && e.touches[0].clientY) || 0) - startY;
      currentX = x;
      currentY = y;

      const rot = Math.max(-15, Math.min(15, (x / 200) * 12));
      card.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`;

      const likeBadge = card.querySelector('.swipe-badge-like');
      const nopeBadge = card.querySelector('.swipe-badge-nope');
      const playBadge = card.querySelector('.swipe-badge-play');

      if (x > 30 && likeBadge) {
        likeBadge.style.opacity = Math.min(1, (x - 30) / 60);
        if (nopeBadge) nopeBadge.style.opacity = 0;
        if (playBadge) playBadge.style.opacity = 0;
      } else if (x < -30 && nopeBadge) {
        nopeBadge.style.opacity = Math.min(1, (-x - 30) / 60);
        if (likeBadge) likeBadge.style.opacity = 0;
        if (playBadge) playBadge.style.opacity = 0;
      } else if (y < -30 && playBadge) {
        playBadge.style.opacity = Math.min(1, (-y - 30) / 60);
        if (likeBadge) likeBadge.style.opacity = 0;
        if (nopeBadge) nopeBadge.style.opacity = 0;
      } else {
        if (likeBadge) likeBadge.style.opacity = 0;
        if (nopeBadge) nopeBadge.style.opacity = 0;
        if (playBadge) playBadge.style.opacity = 0;
      }
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      card.classList.remove('dragging');

      if (currentX > 80) {
        swipeCardAction('like');
      } else if (currentX < -80) {
        swipeCardAction('nope');
      } else if (currentY < -75) {
        swipeCardAction('play');
      } else {
        swipeState = SwipeState.READY;
        card.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        card.style.transform = '';
        const badges = card.querySelectorAll('.swipe-card-badge');
        badges.forEach(b => { b.style.opacity = 0; });
        setTimeout(() => { card.style.transition = ''; }, 200);
      }
      currentX = 0;
      currentY = 0;
    };

    card.onpointerdown = onPointerDown;
    card.onpointermove = onPointerMove;
    card.onpointerup = onPointerUp;
    card.onpointercancel = onPointerUp;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init,
    checkUpdatesManual,
    showImprovementsPanel,
    openUpdateDownload,
    openWebsite,
    openGitHubRelease,
    dismissUpdateDialog,
    dismissUpdateBanner,
    closeUpdateDialog,
    closeConfirmModal,
    closePromptModal,
    submitPromptModal,
    initSwipeDiscovery,
    refreshDiscoveryFeed,
    selectArtistFromPicker,
    swipeCardAction,
    get isUpdateMandatory() {
      return typeof UpdateManager !== 'undefined' ? !!UpdateManager.getState().updateRequired : false;
    },
    navigate,
    goBack,
    openArtist,
    openArtistPage: openArtist,
    openArtistMenu,
    artistMenuAction,
    startArtistRadio,
    filterArtistCategory,
    toggleFollowArtist,
    toggleAllArtistTracks,
    loadMoreArtistSongs,
    toggleAllNewReleases,
    performSearch,
    filterSearchCategory,
    loadMoreSearchSongs,
    loadMoreHomeSuggestions,
    setSearchQuery,
    searchCategory,
    clearSearchData,
    playSongFromSearch,
    playSongWithQueue,
    registerTrack,
    registerTracks,
    getTrack: getRegisteredTrack,
    playSongFromArtistList,
    playSongFromFavs,
    playMix,
    startRadio,
    toggleFavoriteCurrent,
    downloadCurrentTrack,
    downloadTrack,
    openDownloadQualityDialog,
    selectDownloadDialogQuality,
    closeDownloadQualityDialog,
    confirmDownloadQualityDialog,
    openDownloadQualitySettingsDialog,
    toggleSaveToPhoneFolder,
    expandFullPlayer,
    collapseFullPlayer,
    handlePlayerBack,
    handlePlayerRightAction,
    toggleLyricsView,
    toggleSoundscape,
    openBottomSheet,
    closeBottomSheet,
    openDialog,
    closeDialog,
    openSongMenu,
    closeSongMenu,
    openCurrentSongMenu,
    sheetAction,
    openLanguagesDialog,
    toggleLanguageSelection,
    saveLanguagesAndRefresh,
    openPlaylistPicker,
    promptCreatePlaylistAndAdd,
    addSongToSpecificPlaylist,
    openEqualizer,
    closeEqualizer,
    toggleEq,
    selectEqPreset,
    setPresetCategory,
    getPresetCategory,
    setSpatialLevel,
    updateEqBand,
    updateBassBoost,
    updateTrebleBoost,
    updateVocalBoost,
    updateVirtualizer,
    toggleNormalization,
    selectCrossfade,
    promptSaveCustomPreset,
    deleteCustomPreset,
    resetAudioEffects,
    openSleepTimerDialog,
    setSleepPreset,
    openQueueSheet,
    removeTrackFromQueue,
    openSettings,
    openProfile,
    playHeroSong,
    dismissWelcome,
    toggleRail,
    closeRail,
    navigatePivotNext,
    dismissIosHint,
    renderRailPlaylists,
    railSearch,
    setAccent,
    openDownloadPage,
    openQualityDialog,
    selectQuality,
    promptChangeName,
    promptChangeAvatar,
    cyclePerformanceMode,
    setPerformanceMode,
    toggleAmbientGlow,
    clearListeningHistory,
    openLikedSongs,
    playLikedSongs,
    shuffleLikedSongs,
    playSongFromFavsList,
    playDownloadedSongs,
    removeDownloadTrack,
    removeHistoryTrack,
    startArtistRadioSeed,
    unfollowArtistAction,
    handleLocalAudioUpload,
    playLocalTrack,
    getLocalSongs,
    openLibraryTab,
    renderAppearanceSetting,
    setAppearance,
    openLibrarySection,
    closeLibrarySection,
    renderLibraryRecent,
    renderLockScreenSettings,
    toggleLockScreenControls,
    requestLockScreenOverlay,
    previewLockScreen,
    setLibrarySort,
    openCreatePlaylistModal,
    openEditPlaylistModal,
    closeCreatePlaylistModal,
    submitPlaylistEditor,
    openPlaylistMenu,
    closePlaylistMenu,
    playCustomPlaylist,
    shuffleCustomPlaylist,
    playNextPlaylist,
    addPlaylistToQueue,
    duplicateCustomPlaylist,
    deleteCustomPlaylist,
    openAddToPlaylistModal,
    closeAddToPlaylistModal,
    createAndAddSongToPlaylist,
    openCustomPlaylist,
    openPlaylist,
    openAlbum,
    playAlbumTrack,
    shuffleAlbum,
    startAlbumRadio,
    downloadAlbumAction,
    shareAlbumAction,
    resetScrollToTop,
    scrollSearchToTop,
    openAlbumOrPlaylist,
    triggerFolderImport,
    triggerFilesImport,
    scanAllDeviceMusic,
    onAndroidLocalTracksScanned,
    handleLocalFilesImport,
    handleLocalFolderImport,
    setLocalSubTab,
    playLocalCollection,
    removeLocalTrackAction,
    downloadPlaylistAction,
    openGenre,
    playAllGenreSongs,
    startGenreRadio,
    loadExplore,
    handleQueueDragStart,
    handleQueueDragOver,
    handleQueueDrop,
    playCustomPlaylistTrack,
    startPlaylistRadio,
    filterCurrentPlaylist,
    clearPlaylistSearch,
    removeTrackFromCustomPlaylist,
    handlePlaylistDragStart,
    handlePlaylistDragOver,
    handlePlaylistDrop,
    saveQueueAsPlaylistAction,
    exportPlaylistAction,
    downloadLikedSongsAction,
    clearAllDownloadsAction,
    toggleSmartDownloads,
    toggleDownloadWifiOnly,
    toggleAutoDownloadLikes,
    openStorageLimitDialog,
    openAutoCleanupDialog,
    toggleProtectedDownloadAction,
    openStorageCleanupDialog,
    addSleepMinutes,
    cancelSleepTimer,
    onCustomSleepInput,
    setCustomSleepTimer,
    openImportYouTubePlaylistModal,
    closeImportYouTubePlaylistModal,
    submitYouTubePlaylistImport,
    saveImportedPlaylist,
    navigateToArtist,
    openThemeDialog,
    closeThemeDialog,
    selectThemePreset,
    selectThemeStyle,
    toggleNeumorphism,
    transitionToNext,
    transitionToPrevious,
    animateToNext: () => (typeof transitionToNext === 'function' ? transitionToNext() : Player.next()),
    animateToPrevious: () => (typeof transitionToPrevious === 'function' ? transitionToPrevious() : Player.previous()),
    openCurrentSongMenu,
    openSongMenu,
    playAllDetailTracks: () => {
      if (activeDetailPlaylistId && typeof Storage !== 'undefined' && Storage.getPlaylistById && Storage.getPlaylistById(activeDetailPlaylistId)) {
        playCustomPlaylist(activeDetailPlaylistId);
      } else if (activeDetailAlbumData) {
        playAlbumTrack(0);
      }
    },
    shuffleDetailTracks: () => {
      if (activeDetailPlaylistId && typeof Storage !== 'undefined' && Storage.getPlaylistById && Storage.getPlaylistById(activeDetailPlaylistId)) {
        shuffleCustomPlaylist(activeDetailPlaylistId);
      } else if (activeDetailAlbumData) {
        shuffleAlbum();
      }
    },
    downloadDetailPlaylist: () => {
      if (activeDetailPlaylistId && typeof Storage !== 'undefined' && Storage.getPlaylistById && Storage.getPlaylistById(activeDetailPlaylistId)) {
        downloadPlaylistAction(activeDetailPlaylistId);
      } else if (activeDetailAlbumData) {
        downloadAlbumAction(activeDetailAlbumData);
      }
    },
    filterDetailTracks: filterCurrentPlaylist,
    openCastOutputDialog,
    openAudioOutputSheet,
    openOutputSelector: openAudioOutputSheet,
    initSeekBar,
    redrawSeekBarWave: () => {
      if (typeof UI !== 'undefined' && UI.WavyProgressBar) {
        UI.WavyProgressBar.draw();
      }
    },
    initPlayer3DDeckGesture,
    setPlayerMode,
    dislikeCurrentTrack,
    shareCurrentTrack,
    toggleAutoplay,
    togglePlayerDrawer,
    collapsePlayerDrawer,
    openPlayerDrawer,
    switchDrawerTab,
    renderDrawerQueue,
    renderDrawerLyrics,
    renderDrawerRelated,
    playRelatedTrack,
    playAllRelated,
    queueAllRelated,
    queueRelatedTrackNext,
    queueRelatedTrackEnd,
    openCommentsSheet,
    postUserComment,
    startVoiceSearch,
    openRadioBuilder,
    setRadioVariety,
    setRadioMood,
    startSongRadio,
    initTimeOfDayMoodChips,
    triggerHaptic,
    launchCustomRadio,
    getPlayerMode: () => currentPlayerMode,
    getDrawerTab: () => currentDrawerTab,
    isAutoplayEnabled: () => isAutoplayEnabled,
    handleBack,
    pushHistory,
    getNavHistory: () => [...navHistory]
  };
})();

// Export globally on window
if (typeof window !== 'undefined') {
  window.App = App;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = App;
}
