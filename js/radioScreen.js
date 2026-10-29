// ============================================================================
// MUSICFLOW — RADIO TAB
// Apple-Music-style Radio screen: a hero station card, stations built from the
// artists you actually listen to, popular artist stations, genre stations and a
// link to Samples. Every station starts a radio through RadioBuilder.
// ============================================================================

const RadioScreen = (() => {
  const POPULAR = ['Arijit Singh', 'The Weeknd', 'Taylor Swift', 'Shreya Ghoshal', 'Ed Sheeran', 'Pritam', 'Dua Lipa', 'Billie Eilish'];

  const GENRES = [
    { name: 'Bollywood', query: 'bollywood hits', color: '#E94057', icon: 'local_fire_department' },
    { name: 'Pop', query: 'pop hits', color: '#FF2D55', icon: 'music_note' },
    { name: 'Hip-Hop', query: 'hip hop rap hits', color: '#F5A623', icon: 'headphones' },
    { name: 'Lo-Fi & Chill', query: 'lofi chill beats', color: '#6C5CE7', icon: 'spa' },
    { name: 'Punjabi', query: 'punjabi hits', color: '#F7971E', icon: 'bolt' },
    { name: 'Romantic', query: 'romantic love songs', color: '#EE0979', icon: 'favorite' },
    { name: 'Rock', query: 'rock classics', color: '#4E4376', icon: 'album' },
    { name: 'Dance / EDM', query: 'edm dance hits', color: '#0083B0', icon: 'equalizer' }
  ];

  const pictureCache = new Map();
  let rendered = false;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function jsStr(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  async function artistPicture(name) {
    if (pictureCache.has(name)) return pictureCache.get(name);
    let url = '';
    try {
      if (typeof API !== 'undefined' && typeof API.searchArtists === 'function') {
        const res = await API.searchArtists(name, 1, 3);
        const list = Array.isArray(res) ? res : [];
        const hit = list.find(a => String(a && (a.name || a.title) || '').toLowerCase() === name.toLowerCase()) || list[0];
        const img = hit && typeof API.getImageUrl === 'function' ? API.getImageUrl(hit) : (hit && hit.image) || '';
        if (img && !/logo\.png$/.test(String(img))) url = String(img);
      }
    } catch (_) {}
    pictureCache.set(name, url);
    return url;
  }

  // Artists you listen to most (from history + favourites), for "Your Stations"
  function topListenedArtists(limit = 6) {
    const counts = new Map();
    const bump = (name, w) => {
      const n = String(name || '').split(',')[0].trim();
      if (!n || /unknown/i.test(n)) return;
      counts.set(n, (counts.get(n) || 0) + w);
    };
    try {
      const hist = (typeof Storage !== 'undefined' && Storage.getHistory) ? (Storage.getHistory() || []) : [];
      hist.slice(0, 120).forEach(t => bump(t.primaryArtist || t.primaryArtists || t.artists || t.artist, 1));
      const favs = (typeof Storage !== 'undefined' && Storage.getFavorites) ? (Storage.getFavorites() || []) : [];
      favs.forEach(t => bump(t.primaryArtist || t.primaryArtists || t.artists || t.artist, 2));
    } catch (_) {}
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(e => e[0]);
  }

  function stationCard(name, sub) {
    const initial = esc(name.trim().charAt(0).toUpperCase());
    return `
      <button class="radio-station" data-artist="${esc(name)}" onclick="RadioScreen.playArtist('${jsStr(name)}')">
        <span class="radio-station-art">
          <span class="radio-station-mono">${initial}</span>
          <img alt="" src="" style="display:none;" onerror="this.style.display='none'">
        </span>
        <span class="radio-station-name">${esc(name)}</span>
        <span class="radio-station-sub">${esc(sub)}</span>
      </button>`;
  }

  function hydratePictures(container) {
    container.querySelectorAll('.radio-station[data-artist]').forEach(el => {
      const name = el.getAttribute('data-artist');
      artistPicture(name).then(url => {
        if (!url) return;
        const img = el.querySelector('img');
        const mono = el.querySelector('.radio-station-mono');
        if (!img) return;
        img.onload = () => { img.style.display = ''; if (mono) mono.style.display = 'none'; };
        img.src = url;
      });
    });
  }

  function render() {
    const root = document.getElementById('radio-screen-body');
    if (!root) return;

    const yours = topListenedArtists(6);
    const popular = POPULAR.filter(p => !yours.some(y => y.toLowerCase() === p.toLowerCase())).slice(0, 8);

    root.innerHTML = `
      <section class="radio-hero" onclick="RadioBuilder.open()">
        <div class="radio-hero-art" aria-hidden="true">
          <span class="material-symbols-outlined">graphic_eq</span>
        </div>
        <div class="radio-hero-text">
          <span class="radio-hero-eyebrow">MusicFlow Radio</span>
          <h2 class="radio-hero-title">Create a station</h2>
          <p class="radio-hero-sub">Pick your favourite artists and tune a radio that plays only what you like.</p>
        </div>
        <span class="radio-hero-play"><span class="material-symbols-outlined fill-icon">play_arrow</span></span>
      </section>

      ${yours.length ? `
      <section class="shelf-section">
        <div class="shelf-header"><div><h2 class="shelf-title">Your Stations</h2></div></div>
        <div class="radio-station-row">${yours.map(a => stationCard(a, 'For you')).join('')}</div>
      </section>` : ''}

      <section class="shelf-section">
        <div class="shelf-header"><div><h2 class="shelf-title">Artist Stations</h2></div></div>
        <div class="radio-station-row">${popular.map(a => stationCard(a, 'Station')).join('')}</div>
      </section>

      <section class="shelf-section">
        <div class="shelf-header"><div><h2 class="shelf-title">Genre Stations</h2></div></div>
        <div class="radio-genre-list">
          ${GENRES.map(g => `
            <button class="radio-genre-row" onclick="RadioScreen.playGenre('${jsStr(g.name)}')">
              <span class="radio-genre-icon" style="background:${g.color};"><span class="material-symbols-outlined fill-icon">${g.icon}</span></span>
              <span class="radio-genre-text"><span class="radio-genre-name">${esc(g.name)}</span><span class="radio-genre-sub">${esc(g.name)} Radio</span></span>
              <span class="material-symbols-outlined radio-genre-play">play_circle</span>
            </button>`).join('')}
        </div>
      </section>

      <section class="shelf-section">
        <div class="shelf-header"><div><h2 class="shelf-title">Discover</h2></div></div>
        <button class="radio-samples-card" onclick="App.navigate('samples')">
          <span class="radio-samples-icon"><span class="material-symbols-outlined fill-icon">play_circle</span></span>
          <span class="radio-samples-text"><span class="radio-samples-title">Samples</span><span class="radio-samples-sub">Swipe through short previews of new music</span></span>
          <span class="material-symbols-outlined radio-genre-chev">chevron_right</span>
        </button>
      </section>`;

    hydratePictures(root);
    rendered = true;
  }

  function playArtist(name) {
    if (typeof RadioBuilder !== 'undefined' && typeof RadioBuilder.quickStation === 'function') {
      RadioBuilder.quickStation(name);
    }
  }

  function playGenre(name) {
    const g = GENRES.find(x => x.name === name);
    if (typeof RadioBuilder !== 'undefined' && typeof RadioBuilder.quickStation === 'function') {
      RadioBuilder.quickStation(name, g ? g.query : `${name} hits`);
    }
  }

  return { render, playArtist, playGenre, isRendered: () => rendered };
})();

if (typeof window !== 'undefined') {
  window.RadioScreen = RadioScreen;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RadioScreen;
}
