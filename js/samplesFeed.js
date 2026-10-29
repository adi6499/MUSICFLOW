// ============================================================================
// MUSICFLOW — YOUTUBE MUSIC SAMPLES DISCOVERY ENGINE (Step 4)
// Fullscreen vertical short-form music discovery feed with seamless audio
// preview, action rail (Like, Add, Share), and one-tap Full Player transition.
// ============================================================================

const SamplesFeed = (() => {
  let isInitialized = false;
  let sampleTracks = [];
  let currentActiveIndex = 0;
  let activeAudioEl = null;

  const DEFAULT_SAMPLES = [
    {
      id: 'sample_1',
      providerId: 'NJAv_7lHUIU',
      name: 'Kesariya',
      artists: 'Arijit Singh, Pritam',
      primaryArtist: 'Arijit Singh',
      image: 'assets/logo.png',
      duration: 268
    },
    {
      id: 'sample_2',
      providerId: 'ApXoWvfEYVU',
      name: 'Sunflower',
      artists: 'Post Malone, Swae Lee',
      primaryArtist: 'Post Malone',
      image: 'assets/logo.png',
      duration: 158
    },
    {
      id: 'sample_3',
      providerId: '4NRXx6U8ABQ',
      name: 'Blinding Lights',
      artists: 'The Weeknd',
      primaryArtist: 'The Weeknd',
      image: 'assets/logo.png',
      duration: 200
    },
    {
      id: 'sample_4',
      providerId: 'kJQP7kiw5Fk',
      name: 'Despacito',
      artists: 'Luis Fonsi, Daddy Yankee',
      primaryArtist: 'Luis Fonsi',
      image: 'assets/logo.png',
      duration: 228
    }
  ];

  async function fetchSamples() {
    try {
      if (typeof API !== 'undefined' && typeof API.searchSongs === 'function') {
        const apiRes = await API.searchSongs('Top Hits', 1, 10);
        if (apiRes && apiRes.length > 0) {
          return apiRes;
        }
      }
    } catch (_) {}
    return DEFAULT_SAMPLES;
  }

  async function init() {
    const container = document.getElementById('samples-reel-container');
    if (!container) return;

    if (!isInitialized || sampleTracks.length === 0) {
      container.innerHTML = `
        <div class="samples-loading-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#fff; gap:12px;">
          <div class="spinner-material" style="width:32px; height:32px; border:3px solid rgba(255,255,255,0.2); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
          <span style="font-size:13px; font-weight:600;">Loading Samples...</span>
        </div>
      `;

      sampleTracks = await fetchSamples();
      render();
      setupObserver();
      isInitialized = true;
    }
  }

  function render() {
    const container = document.getElementById('samples-reel-container');
    if (!container || sampleTracks.length === 0) return;

    container.innerHTML = sampleTracks.map((t, idx) => `
      <div class="sample-card" data-sample-index="${idx}" id="sample-card-${idx}">
        <img class="sample-bg-img" src="${t.image || 'assets/logo.png'}" alt="" onerror="this.src='assets/logo.png'">
        <div class="sample-gradient-overlay"></div>
        <div class="sample-content">
          <div class="sample-info">
            <h3 class="sample-song-title">${t.name}</h3>
            <p class="sample-artist-name">${t.artists || t.primaryArtist || 'Unknown Artist'}</p>
            <button class="sample-play-btn" onclick="SamplesFeed.playFullSong(${idx})">
              <span class="material-symbols-outlined fill-icon" style="font-size:18px;">play_arrow</span>
              <span>Play full song</span>
            </button>
          </div>
          <div class="sample-actions-rail">
            <button class="sample-action-btn" id="btn-sample-like-${idx}" onclick="SamplesFeed.toggleLike(${idx})" aria-label="Like">
              <span class="material-symbols-outlined">thumb_up</span>
              <span class="sample-action-label">Like</span>
            </button>
            <button class="sample-action-btn" onclick="SamplesFeed.addToPlaylist(${idx})" aria-label="Save">
              <span class="material-symbols-outlined">playlist_add</span>
              <span class="sample-action-label">Save</span>
            </button>
            <button class="sample-action-btn" onclick="SamplesFeed.shareSample(${idx})" aria-label="Share">
              <span class="material-symbols-outlined">share</span>
              <span class="sample-action-label">Share</span>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function setupObserver() {
    if (typeof IntersectionObserver === 'undefined') return;
    const cards = document.querySelectorAll('.sample-card');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const idx = parseInt(entry.target.dataset.sampleIndex, 10);
          if (!isNaN(idx)) {
            currentActiveIndex = idx;
          }
        }
      });
    }, { threshold: 0.6 });

    cards.forEach(c => observer.observe(c));
  }

  function playFullSong(index) {
    const track = sampleTracks[index];
    if (!track) return;
    if (typeof Player !== 'undefined' && Player.playTrack) {
      Player.playTrack(track, sampleTracks);
    }
    if (typeof App !== 'undefined' && App.expandFullPlayer) {
      App.expandFullPlayer();
    }
  }

  function toggleLike(index) {
    const track = sampleTracks[index];
    if (!track) return;
    if (typeof Storage !== 'undefined' && Storage.toggleFavorite) {
      const isFav = Storage.toggleFavorite(track);
      const btn = document.getElementById(`btn-sample-like-${index}`);
      if (btn) {
        btn.classList.toggle('active', isFav);
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) {
          icon.style.color = isFav ? 'var(--accent)' : '#FFFFFF';
          icon.style.fontVariationSettings = isFav ? "'FILL' 1" : "'FILL' 0";
        }
      }
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast(isFav ? 'Added to Liked Music' : 'Removed from Liked Music');
      }
    }
  }

  function addToPlaylist(index) {
    const track = sampleTracks[index];
    if (!track) return;
    if (typeof App !== 'undefined' && App.openAddToPlaylistModal) {
      App.openAddToPlaylistModal(track);
    }
  }

  function shareSample(index) {
    const track = sampleTracks[index];
    if (!track) return;
    const title = track.name;
    const artist = track.artists || track.primaryArtist || '';
    if (navigator.share) {
      navigator.share({ title, text: `Listen to ${title} by ${artist} on MusicFlow Samples`, url: window.location.href }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${title} - ${artist}`);
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('Sample link copied to clipboard!');
      }
    }
  }

  return {
    init,
    render,
    playFullSong,
    toggleLike,
    addToPlaylist,
    shareSample,
    getSampleTracks: () => [...sampleTracks]
  };
})();

if (typeof window !== 'undefined') {
  window.SamplesFeed = SamplesFeed;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SamplesFeed;
}
