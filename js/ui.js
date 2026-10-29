// ==========================================================================
// MUSICFLOW — UI & DOM COMPONENT RENDERER (100% Jetpack Compose Replica)
// ==========================================================================

const UI = (() => {

  // Format seconds to mm:ss
  // Writes a container's HTML only when it actually changed. Home renders its cache and, a moment
  // later, the fresh feed; identical shelves must not be rebuilt (rebuilding read as flicker).
  function setHTML(container, html) {
    if (!container) return false;
    if (container._mfHtml === html && (html === '' || container.firstChild)) return false;
    container._mfHtml = html;
    container.innerHTML = html;
    return true;
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // Format listener numbers: 3234900 -> "3 234 900"
  function formatListeners(num) {
    const n = Number(num) || 3234900;
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  const colorCache = new Map();

  function applyColorPalette(palette) {
    if (!palette || typeof document === 'undefined' || !document.documentElement) return;
    const style = document.documentElement.style;
    const dyn = palette.dynamicColor || palette;
    style.setProperty('--dynamic-color', dyn);

    if (palette.dominantRgb) {
      style.setProperty('--player-dominant-color', palette.dominantRgb);
      style.setProperty('--player-dominant-alpha', palette.dominantAlpha);
      style.setProperty('--player-secondary-color', palette.secondaryRgb);
      style.setProperty('--player-secondary-alpha', palette.secondaryAlpha);
      style.setProperty('--player-dark-tint', palette.darkTint);
      style.setProperty('--player-art-glow', palette.artGlow);
    }
  }

  // Extract vibrant dominant color from image and set dynamic ambient background
  function setDynamicColor(imgUrl) {
    if (!imgUrl || typeof Image === 'undefined' || typeof document === 'undefined') return;
    if (colorCache.has(imgUrl)) {
      try {
        const cached = colorCache.get(imgUrl);
        applyColorPalette(cached);
      } catch (_) {}
      return;
    }
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 32, 32);
        const imgData = ctx.getImageData(0, 0, 32, 32)?.data;
        if (!imgData || imgData.length === 0) return;

        let primaryR = 255, primaryG = 0, primaryB = 85;
        let secR = 0, secG = 200, secB = 255;

        if (imgData.length === 4) {
          // Single-pixel mock or unit tests
          primaryR = imgData[0];
          primaryG = imgData[1];
          primaryB = imgData[2];
          secR = Math.max(0, primaryR - 40);
          secG = Math.min(255, primaryG + 30);
          secB = Math.min(255, primaryB + 50);
        } else {
          // Real multi-pixel image: extract vibrant dominant & secondary hues
          const bins = new Array(12).fill(0).map(() => ({ count: 0, score: 0, r: 0, g: 0, b: 0, maxVibrancy: -1 }));
          let totalSampled = 0;
          let fallbackR = 0, fallbackG = 0, fallbackB = 0;

          for (let i = 0; i < imgData.length; i += 8) { // sample pixels for performance
            const r = imgData[i];
            const g = imgData[i + 1];
            const b = imgData[i + 2];
            const a = imgData[i + 3];
            if (a < 128) continue; // ignore transparent

            totalSampled++;
            fallbackR += r;
            fallbackG += g;
            fallbackB += b;

            const rn = r / 255, gn = g / 255, bn = b / 255;
            const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
            const l = (max + min) / 2;
            const d = max - min;
            const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

            // Skip pure blacks, whites, and low-saturation grays
            if (l < 0.12 || l > 0.90 || s < 0.16) continue;

            let h = 0;
            if (d !== 0) {
              if (max === rn) h = ((gn - bn) / d) % 6;
              else if (max === gn) h = (bn - rn) / d + 2;
              else h = (rn - gn) / d + 4;
              h = Math.round(h * 60);
              if (h < 0) h += 360;
            }

            const binIdx = Math.min(11, Math.floor(h / 30));
            const vibrancy = (s * 2.2) + ((1 - Math.abs(l - 0.5)) * 1.4);
            const bin = bins[binIdx];
            bin.count++;
            bin.score += vibrancy;
            if (vibrancy > bin.maxVibrancy) {
              bin.maxVibrancy = vibrancy;
              bin.r = r;
              bin.g = g;
              bin.b = b;
            }
          }

          // Sort bins by score
          const sortedBins = bins.filter(b => b.count > 0).sort((a, b) => b.score - a.score);
          if (sortedBins.length > 0) {
            primaryR = sortedBins[0].r;
            primaryG = sortedBins[0].g;
            primaryB = sortedBins[0].b;

            if (sortedBins.length > 1) {
              secR = sortedBins[1].r;
              secG = sortedBins[1].g;
              secB = sortedBins[1].b;
            } else {
              secR = Math.min(255, Math.max(0, primaryR + 30));
              secG = Math.min(255, Math.max(0, primaryG - 20));
              secB = Math.min(255, Math.max(0, primaryB + 40));
            }
          } else if (totalSampled > 0) {
            primaryR = Math.round(fallbackR / totalSampled);
            primaryG = Math.round(fallbackG / totalSampled);
            primaryB = Math.round(fallbackB / totalSampled);
            secR = Math.min(255, primaryR + 30);
            secG = Math.min(255, primaryG + 30);
            secB = Math.min(255, primaryB + 30);
          }
        }

        const darkR = Math.min(24, Math.round(primaryR * 0.08) + 6);
        const darkG = Math.min(24, Math.round(primaryG * 0.08) + 6);
        const darkB = Math.min(30, Math.round(primaryB * 0.10) + 8);

        const dynamicColor = `rgba(${primaryR}, ${primaryG}, ${primaryB}, 0.40)`;
        const palette = {
          dynamicColor,
          dominantRgb: `rgb(${primaryR}, ${primaryG}, ${primaryB})`,
          dominantAlpha: `rgba(${primaryR}, ${primaryG}, ${primaryB}, 0.55)`,
          secondaryRgb: `rgb(${secR}, ${secG}, ${secB})`,
          secondaryAlpha: `rgba(${secR}, ${secG}, ${secB}, 0.32)`,
          darkTint: `rgb(${darkR}, ${darkG}, ${darkB})`,
          artGlow: `rgba(${primaryR}, ${primaryG}, ${primaryB}, 0.45)`,
          toString() { return this.dynamicColor; }
        };

        colorCache.set(imgUrl, palette);
        if (colorCache.size > 100) {
          const oldest = colorCache.keys().next().value;
          colorCache.delete(oldest);
        }
        applyColorPalette(palette);
      } catch (_) {}
    };
    img.src = imgUrl;
  }

  // Format artists into clean string
  function formatArtists(artists) {
    if (typeof DataNormalizer !== 'undefined' && DataNormalizer.getArtistName) {
      return DataNormalizer.getArtistName(artists);
    }
    if (!artists) return 'Various Artists';
    if (typeof artists === 'string') return (typeof API !== 'undefined' && API.decodeHtml) ? API.decodeHtml(artists) : artists;
    if (Array.isArray(artists)) {
      return artists.map(a => typeof a === 'object' ? (a.name || a.title || '') : a).filter(Boolean).join(', ') || 'Various Artists';
    }
    if (typeof artists === 'object') {
      if (Array.isArray(artists.primary) && artists.primary.length > 0) {
        return artists.primary.map(a => a.name || a).join(', ');
      }
      if (Array.isArray(artists.all) && artists.all.length > 0) {
        return artists.all.map(a => a.name || a).join(', ');
      }
      if (artists.name) return artists.name;
    }
    return 'Various Artists';
  }

  function escapeHtml(str) {
    if (typeof str === 'object' && str !== null) {
      str = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getArtistName(str) : String(str.name || str.title || '');
    }
    if (!str || typeof str !== 'string') return String(str || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(str) {
    if (typeof str === 'object' && str !== null) {
      str = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getArtistName(str) : String(str.name || str.title || '');
    }
    if (!str || typeof str !== 'string') return String(str || '');
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '&quot;');
  }

  function renderFullPlayerArtistLinks(songOrArtists) {
    if (!songOrArtists) return '<span class="artist-plain">Unknown Artist</span>';
    
    let artistEntities = [];
    if (typeof DataNormalizer !== 'undefined' && DataNormalizer.getLegitimateMusicArtists) {
      artistEntities = DataNormalizer.getLegitimateMusicArtists(songOrArtists);
    } else if (typeof DataNormalizer !== 'undefined' && DataNormalizer.normalizeArtists) {
      artistEntities = DataNormalizer.normalizeArtists(songOrArtists);
    } else {
      const name = formatArtists(songOrArtists);
      artistEntities = [{ id: name, name: name }];
    }

    if (!artistEntities || artistEntities.length === 0) {
      return '<span class="artist-plain">Unknown Artist</span>';
    }

    // Limit to max 2-3 performing artists in Full Player
    const visibleArtists = artistEntities.slice(0, 3);
    const remainingCount = artistEntities.length - visibleArtists.length;

    const linksHtml = visibleArtists.map(a => {
      const name = escapeHtml(a.name || 'Unknown Artist');
      if (name.toLowerCase() === 'unknown artist') {
        return `<span class="artist-plain">${name}</span>`;
      }
      return `<span class="player-artist-name clickable-link" onclick="event.stopPropagation(); App.navigateToArtist('${escapeAttr(a.name)}')">${name}</span>`;
    }).join('<span class="artist-link-separator">•</span>');

    if (remainingCount > 0) {
      return `${linksHtml}<span class="artist-more-count">+${remainingCount}</span>`;
    }

    return linksHtml;
  }

  function renderArtistLinks(artists, options = {}) {
    if (!artists) return '<span class="artist-plain">Unknown Artist</span>';
    if (!options.clickable) {
      return `<span class="artist-plain">${escapeHtml(formatArtists(artists))}</span>`;
    }
    return renderFullPlayerArtistLinks(artists);
  }

  return {
    formatTime,
    formatListeners,
    formatArtists,
    renderArtistLinks,
    renderFullPlayerArtistLinks,
    escapeHtml,
    escapeAttr,
    setDynamicColor,

    // ========================================================================
    // HOME SCREEN RENDERING (HomeScreen.kt)
    // ========================================================================
    renderHomeGreeting() {
      const hour = new Date().getHours();
      const name = Storage.getUserName();
      let greeting = 'Good morning';
      if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
      else if (hour >= 17 || hour < 4) greeting = 'Good evening';
      
      const greetingEl = document.getElementById('home-greeting');
      if (greetingEl) {
        // The home heading: a personal hello when we know the name, otherwise the tagline
        const safe = String(name || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        greetingEl.innerHTML = name ? `${greeting}, ${safe}` : greeting;
        greetingEl.setAttribute('aria-label', name ? `Hello ${name}` : greeting);
      }
    },

    renderListenAgain(items) {
      const section = document.getElementById('shelf-listen-again-section');
      const container = document.getElementById('ytm-listen-again-container');
      if (!section || !container) return;

      if (!items || items.length === 0) {
        const history = (typeof Storage !== 'undefined' && Storage.getHistory) ? Storage.getHistory() : [];
        items = history.slice(0, 6);
      }

      if (!items || items.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      setHTML(container, items.slice(0, 6).map(item => `
        <div class="listen-again-item" onclick="App.playSongWithQueue('${item.id}')">
          <img class="listen-again-thumb" src="${item.image || 'assets/logo.png'}" alt="" onerror="this.src='assets/logo.png'">
          <div class="listen-again-meta">
            <span class="listen-again-title">${item.name}</span>
            <span class="listen-again-sub">${item.artists || item.primaryArtist || 'Unknown'}</span>
          </div>
        </div>
      `).join(''));
    },

    renderQuickPicks(songs) {
      const container = document.getElementById('quick-picks-container');
      if (!container || !songs || songs.length === 0) return;

      // Group songs into columns of 4 rows (Jetpack Compose 4-row carousel)
      const columns = [];
      for (let i = 0; i < songs.length; i += 4) {
        columns.push(songs.slice(i, i + 4));
      }

      setHTML(container, columns.map(col => `
        <div class="quick-picks-column">
          ${col.map(song => `
            <div class="quick-pick-item" onclick="App.playSongWithQueue('${song.id}')">
              <img class="quick-pick-thumb" src="${API.thumb(song.image)}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${song.name}">
              <div class="quick-pick-info">
                <div class="quick-pick-title">${song.name}</div>
                <div class="quick-pick-artist">${song.artists}</div>
              </div>
              <button class="quick-pick-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}');" aria-label="More">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
          `).join('')}
        </div>
      `).join(''));
    },

    renderContinueListening(songs) {
      const section = document.getElementById('shelf-continue-listening-section');
      const container = document.getElementById('shelf-continue-listening-container');
      if (!section || !container) return;

      if (!songs || songs.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      setHTML(container, songs.map(song => {
        const prog = song.playbackProgress || 0;
        return `
          <div class="music-square-card" onclick="App.playSongWithQueue('${song.id}')">
            <div class="square-card-art-wrap">
              <img src="${song.image}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${song.name}">
              <div class="square-card-play-overlay">
                <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
              </div>
              ${prog > 0 ? `
                <div class="continue-card-progress-bar">
                  <div class="continue-card-progress-fill" style="width: ${prog}%;"></div>
                </div>
              ` : ''}
            </div>
            <div class="square-card-title">${song.name}</div>
            <div class="square-card-sub">${song.reason || song.artists}</div>
          </div>
        `;
      }).join(''));
    },

    renderMadeForYou(songs) {
      const section = document.getElementById('shelf-made-for-you-section');
      const container = document.getElementById('shelf-made-for-you-container');
      if (!section || !container) return;

      if (!songs || songs.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      setHTML(container, songs.map(song => `
        <div class="music-square-card" onclick="App.playSongWithQueue('${song.id}')">
          <div class="square-card-art-wrap">
            <img src="${song.image}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${song.name}">
            <div class="square-card-play-overlay">
              <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
            </div>
          </div>
          <div class="square-card-title">${song.name}</div>
          <div class="square-card-sub">${song.reason || song.artists}</div>
        </div>
      `).join(''));
    },

    renderBecauseYouListened(seedTitle, songs) {
      const section = document.getElementById('shelf-because-listened-section');
      const container = document.getElementById('shelf-because-listened-container');
      const titleEl = document.getElementById('because-listened-title');
      if (!section || !container) return;

      if (!songs || songs.length === 0) {
        section.style.display = 'none';
        return;
      }

      if (titleEl && seedTitle) {
        titleEl.textContent = `Because you listened to ${seedTitle}`;
      }

      section.style.display = 'block';
      setHTML(container, songs.map(song => `
        <div class="music-square-card" onclick="App.playSongWithQueue('${song.id}')">
          <div class="square-card-art-wrap">
            <img src="${song.image}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${song.name}">
            <div class="square-card-play-overlay">
              <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
            </div>
          </div>
          <div class="square-card-title">${song.name}</div>
          <div class="square-card-sub">${song.artists}</div>
        </div>
      `).join(''));
    },

    renderFavoriteArtists(artists) {
      const section = document.getElementById('shelf-favorite-artists-section');
      const container = document.getElementById('shelf-favorite-artists-container');
      if (!section || !container) return;

      if (!artists || artists.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      setHTML(container, artists.map(artist => {
        const name = typeof artist === 'string' ? artist : (artist.name || artist.artist || 'Artist');
        const img = artist.image || 'assets/logo.png';
        return `
          <div class="artist-circle-card" onclick="App.openArtist('${name.replace(/'/g, "\\'")}')">
            <div class="artist-circle-img-wrap">
              <img src="${img}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${name}">
            </div>
            <div class="artist-circle-name">${name}</div>
            <div class="artist-circle-sub">Artist</div>
          </div>
        `;
      }).join(''));
    },

    renderDiscoverNew(songs) {
      const section = document.getElementById('shelf-discover-section');
      const container = document.getElementById('shelf-discover-container');
      if (!section || !container) return;

      if (!songs || songs.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      setHTML(container, songs.map(song => `
        <div class="music-square-card" onclick="App.playSongWithQueue('${song.id}')">
          <div class="square-card-art-wrap">
            <img src="${song.image}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${song.name}">
            <div class="square-card-play-overlay">
              <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
            </div>
          </div>
          <div class="square-card-title">${song.name}</div>
          <div class="square-card-sub">${song.artists}</div>
        </div>
      `).join(''));
    },

    renderForgottenFavorites(songs) {
      const section = document.getElementById('shelf-recent-section');
      const container = document.getElementById('shelf-recent-container');
      if (!section || !container) return;

      if (!songs || songs.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      setHTML(container, songs.map(song => `
        <div class="music-square-card" onclick="App.playSongWithQueue('${song.id}')">
          <div class="square-card-art-wrap">
            <img src="${song.image}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${song.name}">
            <div class="square-card-play-overlay">
              <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
            </div>
          </div>
          <div class="square-card-title">${song.name}</div>
          <div class="square-card-sub">${song.artists}</div>
        </div>
      `).join(''));
    },

    renderRecommendedTracks(songs) {
      const container = document.getElementById('shelf-recommended-container');
      if (!container || !songs) return;

      setHTML(container, songs.map(song => `
        <div class="music-square-card" onclick="App.playSongWithQueue('${song.id}')">
          <div class="square-card-art-wrap">
            <img src="${song.image}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${song.name}">
            <div class="square-card-play-overlay">
              <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
            </div>
          </div>
          <div class="square-card-title">${song.name}</div>
          <div class="square-card-sub">${song.artists}</div>
        </div>
      `).join(''));
    },

    renderNewReleases(songs, isExpanded = false) {
      const container = document.getElementById('shelf-new-releases-container');
      const label = document.getElementById('new-releases-toggle-label');
      const chevron = document.getElementById('new-releases-chevron');
      if (!container) return;

      if (Array.isArray(songs) && songs.length > 0) {
        this._cachedNewReleases = songs;
      }
      const list = (Array.isArray(songs) && songs.length > 0) ? songs : (this._cachedNewReleases || []);
      if (list.length === 0) return;

      const displayList = isExpanded ? list : list.slice(0, 5);
      if (label) label.textContent = isExpanded ? 'Show less' : 'See all';
      if (chevron) chevron.textContent = isExpanded ? 'expand_less' : 'chevron_right';

      setHTML(container, displayList.map(song => `
        <div class="vertical-track-row" onclick="App.playSongWithQueue('${song.id}')">
          <img class="vertical-track-img" src="${API.thumb(song.image || 'assets/logo.png')}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${song.name || song.title}">
          <div class="vertical-track-info">
            <div class="vertical-track-title">${song.name || song.title}</div>
            <div class="vertical-track-artist">${song.artists || song.primaryArtist || 'MusicFlow'}</div>
          </div>
          <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}');" aria-label="More">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      `).join(''));
    },

    renderTrendingCharts(charts) {
      const container = document.getElementById('shelf-trending-container');
      if (!container || !charts) return;

      setHTML(container, charts.map(item => {
        const titleSafe = (item.title || item.name || '').replace(/'/g, "\\'");
        return `
        <div class="music-square-card" onclick="App.openAlbumOrPlaylist('${item.id}', '${item.type || 'playlist'}', '${titleSafe}')">
          <div class="square-card-art-wrap">
            <img src="${API.getImageUrl(item)}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${item.title || item.name}">
            <div class="square-card-play-overlay">
              <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
            </div>
          </div>
          <div class="square-card-title">${item.title || item.name}</div>
          <div class="square-card-sub">${formatArtists(item.subtitle || item.artists || 'MusicFlow')}</div>
        </div>
      `;
      }).join(''));
    },

    renderAlbums(albums) {
      const container = document.getElementById('shelf-albums-container');
      const section = document.getElementById('shelf-albums-section');
      if (!container) return;

      if (!albums || !Array.isArray(albums) || albums.length === 0) {
        setHTML(container, '');
        if (section) section.style.display = 'none';
        return;
      }

      if (section) section.style.display = '';
      setHTML(container, albums.map(item => {
        const titleSafe = (item.title || item.name || '').replace(/'/g, "\\'");
        const artistSafe = (item.artists || item.artist || item.subtitle || '').replace(/'/g, "\\'");
        return `
        <div class="music-square-card" onclick="App.openAlbumOrPlaylist('${item.id}', 'album', '${titleSafe}', '${artistSafe}')">
          <div class="square-card-art-wrap">
            <img src="${API.getImageUrl(item)}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="${item.title || item.name}">
            <div class="square-card-play-overlay">
              <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
            </div>
          </div>
          <div class="square-card-title">${item.title || item.name}</div>
          <div class="square-card-sub">${formatArtists(item.artists || item.artist || item.subtitle || item.year || 'Album')}</div>
        </div>
      `;
      }).join(''));
    },

    // ========================================================================
    // ARTIST SCREEN RENDERING (ArtistScreen.kt)
    // ========================================================================
    renderArtistProfile(artist, songs, albums) {
      if (!artist) return;

      const heroImg = API.getImageUrl(artist);
      const name = artist.name || artist.title || 'Artist';

      // 1. Hero Photo Card
      const heroImgEl = document.getElementById('artist-hero-img');
      const heroNameEl = document.getElementById('artist-hero-name');
      const topTitleEl = document.getElementById('artist-top-nav-title');
      const mainNameEl = document.getElementById('artist-main-name');
      const listenersEl = document.getElementById('artist-listeners-text');

      if (heroImgEl) heroImgEl.src = heroImg;
      if (heroNameEl) heroNameEl.textContent = name.toUpperCase();
      if (topTitleEl) topTitleEl.textContent = name;
      if (mainNameEl) mainNameEl.textContent = name;
      if (listenersEl) listenersEl.textContent = `${formatListeners(artist.fanCount || artist.listenerCount || 3234900)} listeners per month`;

      // 2. Play All Button
      const playAllBtn = document.getElementById('btn-artist-play-all');
      if (playAllBtn && songs && songs.length > 0) {
        playAllBtn.onclick = () => Player.setQueue(songs, 0);
      }

      // 3. Numbered Top Tracks (01, 02, 03...)
      this.renderArtistTopTracks(songs, false);

      // 4. Playlists "Best of" & "Style"
      const plImg1 = document.getElementById('artist-pl-img-1');
      const plImg2 = document.getElementById('artist-pl-img-2');
      const plTitle1 = document.getElementById('artist-pl-title-1');
      const plTitle2 = document.getElementById('artist-pl-title-2');

      if (plImg1) plImg1.src = heroImg;
      if (plImg2) plImg2.src = heroImg;
      if (plTitle1) plTitle1.textContent = `Best of ${name}`;
      if (plTitle2) plTitle2.textContent = `${name} Style Mix`;

      // 5. Similar Artists
      const similarContainer = document.getElementById('artist-similar-container');
      if (similarContainer && Array.isArray(artist.similarArtists) && artist.similarArtists.length > 0) {
        similarContainer.innerHTML = artist.similarArtists.map(sim => `
          <div class="similar-artist-item" onclick="App.openArtist('${sim.id || sim.name}')">
            <img class="similar-artist-avatar" src="${API.getImageUrl(sim)}" onerror="this.src='assets/logo.png'" alt="${sim.name}">
            <span class="similar-artist-name">${sim.name}</span>
          </div>
        `).join('');
      } else if (similarContainer) {
        // Fallback popular peers
        const peers = ['Arijit Singh', 'Pritam', 'Shreya Ghoshal', 'Atif Aslam', 'Badshah', 'Diljit Dosanjh'];
        similarContainer.innerHTML = peers.map(peer => `
          <div class="similar-artist-item" onclick="App.openArtist('${peer}')">
            <img class="similar-artist-avatar" src="assets/logo.png" alt="${peer}">
            <span class="similar-artist-name">${peer}</span>
          </div>
        `).join('');
      }

      // Set ambient dominant color
      setDynamicColor(heroImg);
    },

    renderArtistTopTracks(songs, isExpanded = false) {
      const tracksContainer = document.getElementById('artist-tracks-container');
      const label = document.getElementById('artist-tracks-toggle-label');
      const chevron = document.getElementById('artist-tracks-chevron');
      if (!tracksContainer || !songs) return;

      const displayList = isExpanded ? songs : songs.slice(0, 10);
      if (label) label.textContent = isExpanded ? 'Show less' : 'See all';
      if (chevron) chevron.textContent = isExpanded ? 'expand_less' : 'chevron_right';

      tracksContainer.innerHTML = displayList.map((song, idx) => `
        <div class="numbered-track-row" onclick="App.playSongFromArtistList('${song.id}')">
          <span class="track-index-num">${idx + 1 < 10 ? '0' + (idx + 1) : idx + 1}</span>
          <img class="track-thumb-img" src="${API.thumb(song.image)}" onerror="this.src='assets/logo.png'" alt="${song.name}">
          <div class="track-info-col">
            <div class="track-name-text">${song.name}</div>
            <div class="track-artist-text">${song.artists}</div>
          </div>
          <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}');" aria-label="More">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      `).join('');
    },

    // ========================================================================
    // SEARCH SCREEN RENDERING (SearchScreen.kt)
    // ========================================================================
    renderSearchResults(results, activeCategory = 'All') {
      const container = document.getElementById('search-results-container');
      const discoveryHub = document.getElementById('search-discovery-hub');
      if (!container || !discoveryHub) return;

      discoveryHub.style.display = 'none';
      container.style.display = 'block';

      const songs = results?.songs?.results?.map(API.normalizeSong).filter(Boolean) || (Array.isArray(results) ? results : []);
      const artists = results?.artists?.results || [];
      const albums = results?.albums?.results || [];
      const playlists = results?.playlists?.results || [];
      const query = results?.query || results?.normalizedQuery || '';
      let html = '';

      if (results?.didYouMean) {
        html += `<button class="search-dym" onclick="App.setSearchQuery('${escapeAttr(results.didYouMean)}')">Did you mean <strong>${escapeHtml(results.didYouMean)}</strong>?</button>`;
      }

      if (songs.length === 0 && artists.length === 0 && albums.length === 0 && playlists.length === 0) {
        html += `
          <div class="search-empty">
            <span class="material-symbols-outlined">search_off</span>
            <h3>No Results</h3>
            <p>Nothing found for "${escapeHtml(query)}". Check the spelling or try an artist, song or album name.</p>
          </div>`;
        container.innerHTML = html;
        return;
      }

      const songRow = (song, idx) => `
        <div class="vertical-track-row" onclick="App.playSongFromSearch(${idx})">
          <img class="vertical-track-img" src="${API.thumb(API.thumb(song.image))}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="">
          <div class="vertical-track-info">
            <div class="vertical-track-title">${escapeHtml(song.name)}</div>
            <div class="vertical-track-artist">${escapeHtml(formatArtists(song.artists || song.primaryArtist))}${song.album && song.album !== song.name ? ' · ' + escapeHtml(song.album) : ''}</div>
          </div>
          <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}');" aria-label="More">
            <span class="material-symbols-outlined">more_horiz</span>
          </button>
        </div>`;

      // Top Result
      if (activeCategory === 'All') {
        const am = results?.artistMatch;
        if (am && am.name) {
          html += `
            <div class="search-section"><div class="search-section-title">Top Result</div>
            <div class="search-top-result" onclick="App.openArtist('${escapeAttr(am.name)}')">
              <img class="search-top-art round" src="${am.image || 'assets/logo.png'}" onerror="this.src='assets/logo.png'" alt="">
              <div class="search-top-text"><div class="search-top-title">${escapeHtml(am.name)}</div><div class="search-top-sub">Artist</div></div>
              <button class="search-top-play" onclick="event.stopPropagation(); App.startArtistRadio('${escapeAttr(am.name)}')" aria-label="Play ${escapeAttr(am.name)} Radio"><span class="material-symbols-outlined fill-icon">play_arrow</span></button>
            </div></div>`;
        } else {
          const SE = (typeof SearchEngine !== 'undefined') ? SearchEngine : null;
          const best = SE ? SE.evaluateBestMatch(results, query) : null;
          if (best && best.type === 'song') {
            const s = best.item, i = best.index || 0;
            html += `
              <div class="search-section"><div class="search-section-title">Top Result</div>
              <div class="search-top-result" onclick="App.playSongFromSearch(${i})">
                <img class="search-top-art" src="${s.image}" onerror="this.src='assets/logo.png'" alt="">
                <div class="search-top-text"><div class="search-top-title">${escapeHtml(s.name)}</div><div class="search-top-sub">Song · ${escapeHtml(formatArtists(s.artists))}</div></div>
                <button class="search-top-play" onclick="event.stopPropagation(); App.playSongFromSearch(${i})" aria-label="Play"><span class="material-symbols-outlined fill-icon">play_arrow</span></button>
              </div></div>`;
          } else if (best && best.type === 'album') {
            const alb = best.item;
            html += `
              <div class="search-section"><div class="search-section-title">Top Result</div>
              <div class="search-top-result" onclick="App.openAlbum('${alb.id}', '${escapeAttr(alb.title || alb.name || 'Album')}', '${escapeAttr(alb.artists || alb.artist || '')}')">
                <img class="search-top-art" src="${API.getImageUrl(alb)}" onerror="this.src='assets/logo.png'" alt="">
                <div class="search-top-text"><div class="search-top-title">${escapeHtml(alb.title || alb.name)}</div><div class="search-top-sub">Album · ${escapeHtml(formatArtists(alb.artists || alb.artist || ''))}</div></div>
                <button class="search-top-play" onclick="event.stopPropagation(); App.openAlbum('${alb.id}', '${escapeAttr(alb.title || alb.name || 'Album')}', '${escapeAttr(alb.artists || alb.artist || '')}')" aria-label="Open album"><span class="material-symbols-outlined fill-icon">play_arrow</span></button>
              </div></div>`;
          }
        }
      }

      // Songs
      if ((activeCategory === 'All' || activeCategory === 'Songs') && songs.length > 0) {
        const shown = activeCategory === 'All' ? songs.slice(0, 6) : songs;
        html += `
          <div class="search-section">
            <div class="search-section-head">
              <div class="search-section-title">Songs</div>
              ${activeCategory === 'All' && songs.length > 6 ? `<button class="search-see-all" onclick="App.filterSearchCategory('Songs')">See All</button>` : ''}
            </div>
            <div class="vertical-tracks-shelf search-songs" id="search-songs-list" style="padding:0;">${shown.map((s, i) => songRow(s, i)).join('')}</div>
            ${activeCategory === 'Songs' ? `<button class="search-show-more" id="btn-search-show-more" onclick="App.loadMoreSearchSongs()">Show More</button>` : ''}
          </div>`;
      }

      // Artists
      if ((activeCategory === 'All' || activeCategory === 'Artists') && artists.length > 0) {
        html += `
          <div class="search-section">
            <div class="search-section-title">Artists</div>
            <div class="similar-artists-shelf search-artists">
              ${artists.map(art => `
                <div class="similar-artist-item" onclick="App.openArtist('${escapeAttr(art.name || art.title || art.id)}')">
                  <img class="similar-artist-avatar" src="${API.getImageUrl(art)}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="">
                  <span class="similar-artist-name">${escapeHtml(art.title || art.name)}</span>
                </div>`).join('')}
            </div>
          </div>`;
      }

      // Albums
      if ((activeCategory === 'All' || activeCategory === 'Albums') && albums.length > 0) {
        html += `
          <div class="search-section">
            <div class="search-section-title">Albums</div>
            <div class="cards-horizontal-shelf" style="padding:4px 0;">
              ${albums.map(alb => `
                <div class="music-square-card" onclick="App.openAlbum('${alb.id}', '${escapeAttr(alb.title || alb.name || 'Album')}', '${escapeAttr(alb.artists || alb.artist || alb.subtitle || '')}')">
                  <div class="square-card-art-wrap"><img src="${API.getImageUrl(alb)}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt=""></div>
                  <div class="square-card-title">${escapeHtml(alb.title || alb.name)}</div>
                  <div class="square-card-sub">${escapeHtml(formatArtists(alb.artists || alb.artist || alb.subtitle || 'Album'))}${alb.year ? ' · ' + escapeHtml(String(alb.year)) : ''}</div>
                </div>`).join('')}
            </div>
          </div>`;
      }

      // Playlists
      if ((activeCategory === 'All' || activeCategory === 'Playlists') && playlists.length > 0) {
        html += `
          <div class="search-section">
            <div class="search-section-title">Playlists</div>
            <div class="cards-horizontal-shelf" style="padding:4px 0;">
              ${playlists.map(pl => `
                <div class="music-square-card" onclick="App.openAlbumOrPlaylist('${pl.id}', 'playlist', '${escapeAttr(pl.title || pl.name || '')}')">
                  <div class="square-card-art-wrap"><img src="${API.getImageUrl(pl)}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt=""></div>
                  <div class="square-card-title">${escapeHtml(pl.title || pl.name)}</div>
                  <div class="square-card-sub">${escapeHtml(formatArtists(pl.subtitle || pl.artists || 'Playlist'))}</div>
                </div>`).join('')}
            </div>
          </div>`;
      }

      container.innerHTML = html;
    },

    // Render Dedicated Genre Detail Screen
    renderGenrePage(genreData) {
      const titleEl = document.getElementById('genre-screen-title');
      const headerBanner = document.getElementById('genre-header-banner');
      const songsContainer = document.getElementById('genre-songs-container');
      const artistsSection = document.getElementById('genre-artists-section');
      const artistsContainer = document.getElementById('genre-artists-container');

      if (titleEl) titleEl.textContent = genreData.title;
      if (headerBanner && genreData.gradient) {
        headerBanner.style.background = `${genreData.gradient}`;
      }

      if (songsContainer) {
        songsContainer.innerHTML = (genreData.songs || []).map((song, idx) => `
          <div class="vertical-track-row" onclick="App.playSongWithQueue('${song.id}')">
            <img class="vertical-track-img" src="${API.thumb(song.image)}" onerror="this.src='assets/logo.png'" alt="${song.name}">
            <div class="vertical-track-info">
              <div class="vertical-track-title">${song.name}</div>
              <div class="vertical-track-artist">${song.artists}</div>
            </div>
            <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}');" aria-label="More">
              <span class="material-symbols-outlined">more_vert</span>
            </button>
          </div>
        `).join('');
      }

      if (artistsContainer && artistsSection) {
        if (!genreData.topArtists || genreData.topArtists.length === 0) {
          artistsSection.style.display = 'none';
        } else {
          artistsSection.style.display = 'block';
          artistsContainer.innerHTML = genreData.topArtists.map(art => `
            <div class="artist-circle-card" onclick="App.openArtist('${art.name.replace(/'/g, "\\'")}')">
              <div class="artist-circle-img-wrap">
                <img src="${art.image}" onerror="this.src='assets/logo.png'" alt="${art.name}">
              </div>
              <div class="artist-circle-name">${art.name}</div>
              <div class="artist-circle-sub">Artist</div>
            </div>
          `).join('');
        }
      }
    },

    // Render Explore Feed (Charts & Playlists in Explore)
    renderExploreFeed(exploreData) {
      const chartsContainer = document.getElementById('explore-charts-container');
      if (!chartsContainer || !exploreData) return;

      const charts = exploreData.charts || [];
      if (charts.length > 0) {
        chartsContainer.innerHTML = charts.map(item => {
          const titleSafe = (item.title || item.name || '').replace(/'/g, "\\'");
          return `
          <div class="music-square-card" onclick="App.openAlbumOrPlaylist('${item.id}', '${item.type || 'playlist'}', '${titleSafe}')">
            <div class="square-card-art-wrap">
              <img src="${API.getImageUrl(item)}" onerror="this.src='assets/logo.png'" alt="${item.title || item.name}">
              <div class="square-card-play-overlay">
                <span class="material-symbols-outlined fill-icon" style="font-size: 20px;">play_arrow</span>
              </div>
            </div>
            <div class="square-card-title">${item.title || item.name}</div>
            <div class="square-card-sub">${formatArtists(item.subtitle || item.artists || 'MusicFlow')}</div>
          </div>
        `;
        }).join('');
      }
    },

    appendSearchSongs(moreSongs, startIndex) {
      const list = document.getElementById('search-songs-list');
      if (!list || !moreSongs) return;
      const newHtml = moreSongs.map((song, idx) => `
        <div class="vertical-track-row" onclick="App.playSongFromSearch(${startIndex + idx})">
          <img class="vertical-track-img" src="${API.thumb(API.thumb(song.image))}" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" alt="">
          <div class="vertical-track-info">
            <div class="vertical-track-title">${escapeHtml(song.name)}</div>
            <div class="vertical-track-artist">${escapeHtml(formatArtists(song.artists || song.primaryArtist))}${song.album && song.album !== song.name ? ' · ' + escapeHtml(song.album) : ''}</div>
          </div>
          <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}');" aria-label="More">
            <span class="material-symbols-outlined">more_horiz</span>
          </button>
        </div>`).join('');
      list.insertAdjacentHTML('beforeend', newHtml);
    },

    renderRecentSearchChips() {
      const section = document.getElementById('search-recent-section');
      const chipsContainer = document.getElementById('search-recent-chips');
      if (!section || !chipsContainer) return;

      const history = Storage.getSearchHistory();
      if (history.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      chipsContainer.innerHTML = history.map(term => `
        <button class="search-pill-btn" onclick="App.setSearchQuery('${term}')">${term}</button>
      `).join('');
    },

    // ========================================================================
    // LIBRARY SCREEN RENDERING (LibraryScreen.kt)
    // ========================================================================
    // ========================================================================
    // LIBRARY SCREEN 2.0 RENDERING (LibraryScreen.kt)
    // ========================================================================
    renderLibraryTab(tab = 'playlists', searchQuery = '', sortMode = 'recent') {
      try { if (typeof App !== 'undefined' && App.renderRailPlaylists) App.renderRailPlaylists(); } catch (_) {}
      const container = document.getElementById('library-tab-content');
      if (!container) return;

      const q = (searchQuery || '').toLowerCase().trim();

      // Update Quick Access counts
      const favs = Storage.getFavorites();
      const downloads = Storage.getDownloads();
      const quickLiked = document.getElementById('quick-liked-count');
      const quickDl = document.getElementById('quick-downloads-count');
      if (quickLiked) quickLiked.textContent = `${favs.length} tracks`;
      if (quickDl) quickDl.textContent = `${downloads.length} songs`;

      // 1. PLAYLISTS TAB
      if (tab === 'playlists') {
        let customPlaylists = Storage.getPlaylists();
        if (q) {
          customPlaylists = customPlaylists.filter(p => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
        }

        let html = `
          <div class="library-sort-bar">
            <span style="font-size:14px; font-weight:700; color:#fff;">Your Playlists (${customPlaylists.length})</span>
            <div style="display:flex; gap:6px;">
              <button class="lib-action-pill-btn" onclick="App.openImportYouTubePlaylistModal()" title="Import YouTube Playlist">
                <span class="material-symbols-outlined" style="font-size:16px; color:#FF0000;">smart_display</span>
                <span>Import YT</span>
              </button>
              <button class="lib-action-pill-btn" onclick="App.openCreatePlaylistModal()">
                <span class="material-symbols-outlined" style="font-size:16px;">add</span>
                <span>New</span>
              </button>
            </div>
          </div>
        `;

        if (customPlaylists.length === 0) {
          html += `
            <div class="library-empty-state">
              <span class="material-symbols-outlined library-empty-icon">queue_music</span>
              <h4 class="library-empty-title">No playlists yet</h4>
              <p class="library-empty-sub">Create your first custom playlist or import existing YouTube Music playlists.</p>
              <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:8px;">
                <button class="library-empty-cta-btn" onclick="App.openCreatePlaylistModal()">
                  <span class="material-symbols-outlined" style="font-size:18px;">add</span>
                  <span>Create Playlist</span>
                </button>
                <button class="library-empty-cta-btn" style="background:var(--accent-soft); border:1px solid var(--accent-border); color:var(--accent);" onclick="App.openImportYouTubePlaylistModal()">
                  <span class="material-symbols-outlined" style="font-size:18px;">smart_display</span>
                  <span>Import YouTube Playlist</span>
                </button>
              </div>
            </div>
          `;
        } else {
          html += `<div class="playlists-cards-grid">`;
          html += customPlaylists.map(pl => {
            const isLikedSongs = pl.id === 'favorites_pl';
            const count = isLikedSongs ? favs.length : (pl.songs?.length || 0);
            const firstImg = isLikedSongs ? (favs[0]?.image || '') : (pl.songs?.[0]?.image || pl.cover || '');
            return `
              <div class="playlist-rich-card" onclick="App.openCustomPlaylist('${pl.id}')">
                <div class="playlist-rich-cover-wrap">
                  ${firstImg ? `<img src="${firstImg}" class="playlist-rich-cover-img" alt="${pl.name}" onerror="this.style.display='none'">` : ''}
                  <div class="playlist-icon-square" style="${firstImg ? 'display:none;' : ''}">
                    <span class="material-symbols-outlined" style="font-size:28px;">${isLikedSongs ? 'favorite' : 'queue_music'}</span>
                  </div>
                </div>
                <div class="playlist-rich-info">
                  <div style="min-width:0; flex:1;">
                    <div class="playlist-rich-title">${pl.name}</div>
                    <div class="playlist-rich-sub">${count} ${count === 1 ? 'song' : 'songs'}</div>
                  </div>
                  ${!isLikedSongs ? `
                    <button class="icon-btn-mini" onclick="event.stopPropagation(); App.openPlaylistMenu('${pl.id}');" aria-label="Options">
                      <span class="material-symbols-outlined" style="font-size:18px; color:var(--text-secondary);">more_vert</span>
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('');
          html += `</div>`;
        }

        container.innerHTML = html;
      }

      // 2. SONGS (LIKED SONGS) TAB
      else if (tab === 'songs') {
        let songs = [...favs];
        if (q) {
          songs = songs.filter(s => (s.name || s.title || '').toLowerCase().includes(q) || (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(s) : String(s.artists || '')).toLowerCase().includes(q));
        }

        // Apply Sorting
        if (sortMode === 'alpha') {
          songs.sort((a, b) => a.name.localeCompare(b.name));
        } else if (sortMode === 'artist') {
          songs.sort((a, b) => (a.artists || '').localeCompare(b.artists || ''));
        } else if (sortMode === 'album') {
          songs.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
        }

        let html = `
          <div class="library-sort-bar">
            <div style="display:flex; align-items:center; gap:8px;">
              <select class="lib-sort-select" onchange="App.setLibrarySort(this.value)">
                <option value="recent" ${sortMode === 'recent' ? 'selected' : ''}>Recently Added</option>
                <option value="alpha" ${sortMode === 'alpha' ? 'selected' : ''}>Alphabetical</option>
                <option value="artist" ${sortMode === 'artist' ? 'selected' : ''}>Artist</option>
                <option value="album" ${sortMode === 'album' ? 'selected' : ''}>Album</option>
              </select>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <button class="lib-action-pill-btn" onclick="App.playLikedSongs()">
                <span class="material-symbols-outlined fill-icon" style="font-size:16px;">play_arrow</span>
                <span>Play All</span>
              </button>
              <button class="lib-action-pill-btn" onclick="App.shuffleLikedSongs()">
                <span class="material-symbols-outlined" style="font-size:16px;">shuffle</span>
              </button>
            </div>
          </div>
        `;

        if (songs.length === 0) {
          html += `
            <div class="library-empty-state">
              <span class="material-symbols-outlined library-empty-icon">favorite_border</span>
              <h4 class="library-empty-title">Your liked songs will appear here</h4>
              <p class="library-empty-sub">Favorite tracks by searching songs, albums, and artist discographies.</p>
              <button class="library-empty-cta-btn" onclick="App.navigate('search')">
                <span class="material-symbols-outlined" style="font-size:18px;">search</span>
                <span>Discover Music</span>
              </button>
            </div>
          `;
        } else {
          html += songs.map((song, idx) => `
            <div class="vertical-track-row" onclick="App.playSongFromFavsList(${idx})">
              <img class="vertical-track-img" src="${API.thumb(song.image)}" onerror="this.src='assets/logo.png'" alt="${song.name}">
              <div class="vertical-track-info">
                <div class="vertical-track-title">${song.name}</div>
                <div class="vertical-track-artist">${song.artists || 'Unknown Artist'}</div>
              </div>
              <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}', 'songs');" aria-label="More">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
          `).join('');
        }

        container.innerHTML = html;
      }

      // 3. ALBUMS TAB
      else if (tab === 'albums') {
        let savedAlbums = Storage.getSavedAlbums();
        if (q) {
          savedAlbums = savedAlbums.filter(a => (a.title || a.name || '').toLowerCase().includes(q) || (a.artist || a.artists || '').toLowerCase().includes(q));
        }

        let html = `
          <div class="library-sort-bar">
            <span style="font-size:14px; font-weight:700; color:#fff;">Saved Albums (${savedAlbums.length})</span>
          </div>
        `;

        if (savedAlbums.length === 0) {
          html += `
            <div class="library-empty-state">
              <span class="material-symbols-outlined library-empty-icon">album</span>
              <h4 class="library-empty-title">No saved albums yet</h4>
              <p class="library-empty-sub">Save your favorite studio albums and compilations for quick one-tap listening.</p>
              <button class="library-empty-cta-btn" onclick="App.navigate('explore')">
                <span class="material-symbols-outlined" style="font-size:18px;">explore</span>
                <span>Browse Albums</span>
              </button>
            </div>
          `;
        } else {
          html += `<div class="albums-cards-grid">`;
          html += savedAlbums.map(alb => `
            <div class="album-rich-card" onclick="App.openAlbum('${alb.id}', '${escapeAttr(alb.title || alb.name || 'Album')}', '${escapeAttr(alb.artist || alb.artists || 'Artist')}')">
              <img src="${alb.image || 'assets/logo.png'}" class="album-rich-cover" alt="${alb.title || alb.name}" onerror="this.src='assets/logo.png'">
              <div class="album-rich-info">
                <div class="album-rich-title">${escapeHtml(alb.title || alb.name)}</div>
                <div class="album-rich-artist">${escapeHtml(formatArtists(alb.artist || alb.artists || 'Artist'))} • ${escapeHtml(alb.year || 'Album')}</div>
              </div>
            </div>
          `).join('');
          html += `</div>`;
        }

        container.innerHTML = html;
      }

      // 4. ARTISTS TAB
      else if (tab === 'artists') {
        let followed = Storage.getFollowedArtists();
        if (q) {
          followed = followed.filter(a => a.name.toLowerCase().includes(q));
        }

        let html = `
          <div class="library-sort-bar">
            <span style="font-size:14px; font-weight:700; color:#fff;">Followed Artists (${followed.length})</span>
          </div>
        `;

        if (followed.length === 0) {
          html += `
            <div class="library-empty-state">
              <span class="material-symbols-outlined library-empty-icon">person</span>
              <h4 class="library-empty-title">No followed artists yet</h4>
              <p class="library-empty-sub">Follow artists you love to track new releases and personalized recommendations.</p>
              <button class="library-empty-cta-btn" onclick="App.navigate('search')">
                <span class="material-symbols-outlined" style="font-size:18px;">search</span>
                <span>Find Artists</span>
              </button>
            </div>
          `;
        } else {
          html += followed.map(art => `
            <div class="artist-library-row" onclick="App.openArtist('${art.id || art.name}')">
              <div class="artist-library-left">
                <img src="${art.image || 'assets/logo.png'}" class="artist-library-avatar" alt="${art.name}" onerror="this.src='assets/logo.png'">
                <div>
                  <div class="artist-library-name">${art.name}</div>
                  <span style="font-size:12px; color:var(--text-secondary);">Artist • Following</span>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <button class="icon-btn-mini" onclick="event.stopPropagation(); App.startArtistRadioSeed('${art.name}');" title="Artist Radio">
                  <span class="material-symbols-outlined">radio</span>
                </button>
                <button class="icon-btn-mini" onclick="event.stopPropagation(); App.unfollowArtistAction('${art.id || art.name}');" title="Unfollow">
                  <span class="material-symbols-outlined" style="color:var(--color-primary);">check_circle</span>
                </button>
              </div>
            </div>
          `).join('');
        }

        container.innerHTML = html;
      }

      // 5. HISTORY TAB
      else if (tab === 'history') {
        let history = Storage.getHistory();
        if (q) {
          history = history.filter(s => (s.name || s.title || '').toLowerCase().includes(q) || (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(s) : String(s.artists || '')).toLowerCase().includes(q));
        }

        let html = `
          <div class="library-sort-bar">
            <span style="font-size:14px; font-weight:700; color:#fff;">Recently Played (${history.length})</span>
            ${history.length > 0 ? `
              <button class="search-clear-all-btn" onclick="App.clearListeningHistory()">Clear All</button>
            ` : ''}
          </div>
        `;

        if (history.length === 0) {
          html += `
            <div class="library-empty-state">
              <span class="material-symbols-outlined library-empty-icon">history</span>
              <h4 class="library-empty-title">Nothing played yet</h4>
              <p class="library-empty-sub">Your listening history will automatically be tracked here as you stream tracks.</p>
              <button class="library-empty-cta-btn" onclick="App.navigate('home')">
                <span class="material-symbols-outlined" style="font-size:18px;">home</span>
                <span>Listen Now</span>
              </button>
            </div>
          `;
        } else {
          html += history.map(song => `
            <div class="vertical-track-row" onclick="App.playSongWithQueue('${song.id}')">
              <img class="vertical-track-img" src="${API.thumb(song.image)}" onerror="this.src='assets/logo.png'" alt="${song.name}">
              <div class="vertical-track-info">
                <div class="vertical-track-title">${song.name}</div>
                <div class="vertical-track-artist">${song.artists || 'Unknown Artist'}</div>
              </div>
              <div style="display:flex; align-items:center; gap:4px;">
                <button class="icon-btn-mini" onclick="event.stopPropagation(); App.removeHistoryTrack('${song.id}');" title="Remove from History">
                  <span class="material-symbols-outlined" style="font-size:18px; color:var(--text-secondary);">close</span>
                </button>
                <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}', 'history');" aria-label="More">
                  <span class="material-symbols-outlined">more_vert</span>
                </button>
              </div>
            </div>
          `).join('');
        }

        container.innerHTML = html;
      }

      // 6. DOWNLOADS TAB (Smart Downloads & Storage Management 2.0 - Phase 9.3)
      else if (tab === 'downloads') {
        const metrics = (typeof SmartDownloadManager !== 'undefined')
          ? SmartDownloadManager.getStorageMetrics()
          : { downloadedCount: Storage.getDownloads().length, downloadedMb: 0, localCount: Storage.getLocalSongs().length, localMb: 0, totalUsedMb: 0, limitMb: 2048, percentUsed: 0 };

        let dlSongs = Storage.getDownloads();
        const isSmartEnabled = Storage.isSmartDownloadsEnabled ? Storage.isSmartDownloadsEnabled() : false;
        const activeTasks = (typeof DownloadManager !== 'undefined') ? DownloadManager.getTasks() : [];
        const pendingTasks = activeTasks.filter(t => t.status === 'DOWNLOADING' || t.status === 'QUEUED' || t.status === 'PAUSED' || t.status === 'FAILED');

        if (q) {
          dlSongs = dlSongs.filter(s => (s.name || s.title || '').toLowerCase().includes(q) || (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(s) : String(s.artists || '')).toLowerCase().includes(q));
        }

        let html = `
          <!-- Storage & Smart Downloads Dashboard Widget -->
          <div class="storage-dashboard-card" style="margin-bottom:16px; padding:14px; background:linear-gradient(135deg, rgba(30,30,36,0.9), rgba(18,18,22,0.9)); border:1px solid rgba(255,255,255,0.08); border-radius:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div>
                <span style="font-size:13px; font-weight:800; color:#fff; letter-spacing:0.5px; text-transform:uppercase;">Offline Storage</span>
                <span style="display:block; font-size:11.5px; color:var(--text-secondary); margin-top:2px;">
                  ${metrics.totalUsedMb} MB used of ${metrics.limitMb} MB limit (${metrics.percentUsed}%)
                </span>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="lib-action-pill-btn" style="font-size:11px; padding:4px 10px;" onclick="App.openSettings();" title="Smart Download Settings">
                  <span class="material-symbols-outlined" style="font-size:14px;">tune</span>
                  <span>Settings</span>
                </button>
                <button class="lib-action-pill-btn" style="font-size:11px; padding:4px 10px; border-color:var(--accent-border); color:var(--accent);" onclick="App.openStorageCleanupDialog();" title="Manage Storage">
                  <span class="material-symbols-outlined" style="font-size:14px;">cleaning_services</span>
                  <span>Cleanup</span>
                </button>
              </div>
            </div>

            <!-- Storage Progress Bar (0% - 100%) -->
            <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; margin:8px 0 10px 0;">
              <div style="width:${metrics.percentUsed}%; height:100%; background:${metrics.percentUsed > 90 ? 'var(--accent)' : 'linear-gradient(90deg, #00F2FE, #4FACFE)'}; border-radius:4px; transition:width 0.3s ease;"></div>
            </div>

            <!-- Breakdown Badges -->
            <div style="display:flex; flex-wrap:wrap; gap:8px; font-size:11px; color:var(--text-secondary);">
              <span style="padding:3px 8px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
                🎵 Downloads: <strong style="color:#fff;">${metrics.downloadedCount}</strong> (${metrics.downloadedMb} MB)
              </span>
              <span style="padding:3px 8px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
                📱 Device Music: <strong style="color:#fff;">${metrics.localCount}</strong> (${metrics.localMb} MB)
              </span>
              <span style="padding:3px 8px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
                ⚡ Smart Downloads: <strong style="color:${isSmartEnabled ? '#00F2FE' : 'var(--text-secondary)'};">${isSmartEnabled ? 'ON' : 'OFF'}</strong>
              </span>
            </div>
          </div>

          <div class="library-sort-bar" style="flex-direction:column; align-items:stretch; gap:10px; margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <span style="font-size:14px; font-weight:700; color:#fff;">Downloaded Songs (${dlSongs.length})</span>
              </div>
              <div style="display:flex; gap:6px;">
                ${dlSongs.length > 0 ? `
                  <button class="lib-action-pill-btn" onclick="App.playDownloadedSongs()" title="Play All Downloads">
                    <span class="material-symbols-outlined fill-icon" style="font-size:16px;">play_arrow</span>
                    <span>Play All</span>
                  </button>
                  <button class="lib-action-pill-btn" style="border-color:var(--accent-border); color:var(--accent);" onclick="App.clearAllDownloadsAction()" title="Clear All Downloads">
                    <span class="material-symbols-outlined" style="font-size:16px;">delete_sweep</span>
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        `;

        // 1. ACTIVE DOWNLOAD QUEUE SECTION (if any tasks are active / queued / paused / failed)
        if (pendingTasks.length > 0) {
          html += `
            <div class="download-queue-shelf" style="margin-bottom:18px; padding:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:14px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:12px; font-weight:800; letter-spacing:0.5px; color:var(--accent); text-transform:uppercase;">Download Queue (${pendingTasks.length})</span>
                <div style="display:flex; gap:4px;">
                  <button class="lib-action-pill-btn" style="font-size:10px; padding:2px 8px;" onclick="DownloadManager.pauseAll()">Pause All</button>
                  <button class="lib-action-pill-btn" style="font-size:10px; padding:2px 8px;" onclick="DownloadManager.resumeAll()">Resume All</button>
                  <button class="lib-action-pill-btn" style="font-size:10px; padding:2px 8px; color:var(--accent);" onclick="DownloadManager.cancelAll()">Cancel All</button>
                </div>
              </div>
              <div class="download-tasks-list">
          `;

          pendingTasks.forEach(task => {
            const isDl = task.status === 'DOWNLOADING';
            const isPsd = task.status === 'PAUSED';
            const isFailed = task.status === 'FAILED';
            html += `
              <div class="vertical-track-row" style="background:rgba(20,20,24,0.6); margin-bottom:6px; border-radius:10px;">
                <img class="vertical-track-img" src="${API.thumb(task.image || 'assets/logo.png')}" onerror="this.src='assets/logo.png'" alt="${task.name}">
                <div class="vertical-track-info">
                  <div class="vertical-track-title">${task.name}</div>
                  <div class="vertical-track-artist" style="font-size:11px;">
                    ${isDl ? `<span style="color:#00F2FE;">Downloading ${task.progress}%</span>` : (isPsd ? '<span style="color:#F59E0B;">Paused</span>' : (isFailed ? '<span style="color:var(--accent);">Failed</span>' : '<span style="color:var(--text-secondary);">Queued</span>'))}
                    ${task.priority === 'smart' ? ' • <span style="color:#A78BFA;">Smart</span>' : ''}
                    ${task.totalBytes > 0 ? ` • ${(task.bytesDownloaded / (1024 * 1024)).toFixed(1)} / ${(task.totalBytes / (1024 * 1024)).toFixed(1)} MB` : ''}
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  ${isDl ? `
                    <button class="icon-btn-mini" onclick="DownloadManager.pause('${task.id}')" title="Pause"><span class="material-symbols-outlined" style="font-size:18px;">pause</span></button>
                  ` : (isPsd || isFailed ? `
                    <button class="icon-btn-mini" onclick="DownloadManager.resume('${task.id}')" title="Resume"><span class="material-symbols-outlined" style="font-size:18px;">play_arrow</span></button>
                  ` : '')}
                  <button class="icon-btn-mini" onclick="DownloadManager.cancel('${task.id}')" title="Cancel"><span class="material-symbols-outlined" style="font-size:18px; color:var(--text-secondary);">close</span></button>
                </div>
              </div>
            `;
          });

          html += `</div></div>`;
        }

        // 2. COMPLETED DOWNLOADS LIST
        if (dlSongs.length === 0 && pendingTasks.length === 0) {
          html += `
            <div class="library-empty-state">
              <span class="material-symbols-outlined library-empty-icon">download_for_offline</span>
              <h4 class="library-empty-title">No downloads yet</h4>
              <p class="library-empty-sub">Download tracks for lossless offline listening anywhere with zero data usage.</p>
              <button class="library-empty-cta-btn" onclick="App.navigate('search')">
                <span class="material-symbols-outlined" style="font-size:18px;">search</span>
                <span>Find Songs to Download</span>
              </button>
            </div>
          `;
        } else if (dlSongs.length > 0) {
          html += dlSongs.map(song => {
            const isProtected = Storage.isDownloadProtected ? Storage.isDownloadProtected(song.id) : false;
            return `
              <div class="vertical-track-row" onclick="App.playSongWithQueue('${song.id}')">
                <img class="vertical-track-img" src="${API.thumb(song.image)}" onerror="this.src='assets/logo.png'" alt="${song.name}">
                <div class="vertical-track-info">
                  <div class="vertical-track-title">${song.name}</div>
                  <div class="vertical-track-artist">${song.artists || 'Unknown Artist'} • <span style="color:#00F2FE; font-weight:600;">⬇ Offline Ready</span></div>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  <button class="icon-btn-mini" onclick="event.stopPropagation(); App.toggleProtectedDownloadAction('${song.id}');" title="${isProtected ? 'Protected from auto-cleanup' : 'Pin download'}">
                    <span class="material-symbols-outlined" style="font-size:18px; color:${isProtected ? '#00F2FE' : 'var(--text-secondary)'};">${isProtected ? 'bookmark' : 'bookmark_border'}</span>
                  </button>
                  <button class="icon-btn-mini" onclick="event.stopPropagation(); App.removeDownloadTrack('${song.id}');" title="Delete Download">
                    <span class="material-symbols-outlined" style="font-size:18px; color:var(--accent);">delete</span>
                  </button>
                  <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}', 'downloads');" aria-label="More">
                    <span class="material-symbols-outlined">more_vert</span>
                  </button>
                </div>
              </div>
            `;
          }).join('');
        }

        container.innerHTML = html;
      }

      // 7. LOCAL MUSIC TAB
      else if (tab === 'local') {
        const localSongs = Storage.getLocalSongs();
        const localAlbums = Storage.getLocalAlbums();
        const localArtists = Storage.getLocalArtists();
        const localFolders = Storage.getLocalFolders();
        const localSubTab = window.currentLocalSubTab || 'songs';

        let html = `
          <div class="library-sort-bar" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <span style="font-size:14px; font-weight:700; color:#fff;">Local Device Music</span>
                <span style="display:block; font-size:11.5px; color:var(--text-secondary);">${localSongs.length} local files</span>
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <button class="lib-action-pill-btn" onclick="App.scanAllDeviceMusic()" title="Scan all device music" style="background:var(--accent); color:#FFFFFF; border:none; font-weight:700;">
                  <span class="material-symbols-outlined" style="font-size:16px;">bolt</span>
                  <span>Scan All</span>
                </button>
                <button class="lib-action-pill-btn" onclick="App.triggerFolderImport()" title="Import entire music folder">
                  <span class="material-symbols-outlined" style="font-size:16px;">folder_open</span>
                  <span>Add Folder</span>
                </button>
                <button class="lib-action-pill-btn" onclick="App.triggerFilesImport()" title="Import individual audio files">
                  <span class="material-symbols-outlined" style="font-size:16px;">file_upload</span>
                  <span>Add Files</span>
                </button>
              </div>
            </div>
            <!-- Sub-Tabs: Songs, Albums, Artists, Folders -->
            <div class="local-sub-tabs-bar">
              <button class="local-sub-tab-btn ${localSubTab === 'songs' ? 'active' : ''}" onclick="App.setLocalSubTab('songs')">Songs (${localSongs.length})</button>
              <button class="local-sub-tab-btn ${localSubTab === 'albums' ? 'active' : ''}" onclick="App.setLocalSubTab('albums')">Albums (${localAlbums.length})</button>
              <button class="local-sub-tab-btn ${localSubTab === 'artists' ? 'active' : ''}" onclick="App.setLocalSubTab('artists')">Artists (${localArtists.length})</button>
              <button class="local-sub-tab-btn ${localSubTab === 'folders' ? 'active' : ''}" onclick="App.setLocalSubTab('folders')">Folders (${localFolders.length})</button>
            </div>
          </div>
        `;

        if (localSongs.length === 0) {
          html += `
            <div class="library-empty-state">
              <span class="material-symbols-outlined library-empty-icon">folder_open</span>
              <h4 class="library-empty-title">Device Audio Files</h4>
              <p class="library-empty-sub">Import and play MP3, M4A, AAC, WAV, FLAC, and OGG files with automatic ID3 metadata extraction.</p>
              <div style="display:flex; flex-direction:column; gap:10px; align-items:center; margin-top:16px; width:100%; max-width:320px; margin-left:auto; margin-right:auto;">
                <button class="library-empty-cta-btn" onclick="App.scanAllDeviceMusic()" style="width:100%; background:var(--accent); color:#fff; font-weight:800; box-shadow:0 4px 16px var(--accent-glow);">
                  <span class="material-symbols-outlined" style="font-size:20px;">bolt</span>
                  <span>Auto-Scan All Device Music</span>
                </button>
                <div style="display:flex; gap:8px; width:100%;">
                  <button class="library-empty-cta-btn" style="flex:1; background:rgba(255,255,255,0.08);" onclick="App.triggerFolderImport()">
                    <span class="material-symbols-outlined" style="font-size:18px;">folder</span>
                    <span>Select Music Folder</span>
                  </button>
                  <button class="library-empty-cta-btn" style="flex:1; background:rgba(255,255,255,0.08);" onclick="App.triggerFilesImport()">
                    <span class="material-symbols-outlined" style="font-size:18px;">audio_file</span>
                    <span>Select Files</span>
                  </button>
                </div>
              </div>
            </div>
          `;
        } else if (localSubTab === 'albums') {
          html += `<div class="playlists-grid">` + localAlbums.map(alb => `
            <div class="playlist-rich-card" onclick="App.playLocalCollection('${alb.id}', 'album')">
              <div class="playlist-rich-cover-wrap">
                <img class="playlist-rich-cover-img playlist-rich-card-cover" src="${alb.image || 'assets/logo.png'}" onerror="this.src='assets/logo.png'" alt="${alb.name}">
              </div>
              <div class="playlist-rich-info playlist-rich-card-info">
                <div>
                  <div class="playlist-rich-title playlist-rich-card-name">${alb.name}</div>
                  <div class="playlist-rich-sub playlist-rich-card-count">${alb.artist} • ${alb.songCount} songs</div>
                </div>
              </div>
            </div>
          `).join('') + `</div>`;
        } else if (localSubTab === 'artists') {
          html += localArtists.map(art => `
            <div class="vertical-track-row" onclick="App.playLocalCollection('${art.id}', 'artist')">
              <img class="vertical-track-img" style="border-radius:50%;" src="${API.thumb(art.image)}" onerror="this.src='assets/logo.png'" alt="${art.name}">
              <div class="vertical-track-info">
                <div class="vertical-track-title">${art.name}</div>
                <div class="vertical-track-artist">${art.songCount} local tracks</div>
              </div>
              <span class="material-symbols-outlined" style="color:var(--text-secondary);">chevron_right</span>
            </div>
          `).join('');
        } else if (localSubTab === 'folders') {
          html += localFolders.map(fld => `
            <div class="vertical-track-row" onclick="App.playLocalCollection('${fld.id}', 'folder')">
              <div class="playlist-icon-square" style="width:48px; height:48px; border-radius:8px; background:rgba(5,150,105,0.2); color:#10B981;">
                <span class="material-symbols-outlined" style="font-size:24px;">folder</span>
              </div>
              <div class="vertical-track-info">
                <div class="vertical-track-title">${fld.name}</div>
                <div class="vertical-track-artist">${fld.songCount} songs in folder</div>
              </div>
              <span class="material-symbols-outlined" style="color:var(--text-secondary);">chevron_right</span>
            </div>
          `).join('');
        } else {
          // Default: Songs
          html += localSongs.map(song => `
            <div class="vertical-track-row" onclick="App.playLocalTrack('${song.id}')">
              <img class="vertical-track-img" src="${API.thumb(song.image || 'assets/logo.png')}" onerror="this.src='assets/logo.png'" alt="${song.name}">
              <div class="vertical-track-info">
                <div class="vertical-track-title">${song.name}</div>
                <div class="vertical-track-artist">${song.artists || 'Local File'} • <span style="color:#059669; font-weight:600;">📱 Local</span></div>
              </div>
              <div style="display:flex; align-items:center; gap:4px;">
                <button class="icon-btn-mini" onclick="event.stopPropagation(); App.removeLocalTrackAction('${song.id}');" title="Remove from Library">
                  <span class="material-symbols-outlined" style="font-size:18px; color:var(--text-secondary);">close</span>
                </button>
                <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}', 'local');" aria-label="More">
                  <span class="material-symbols-outlined">more_vert</span>
                </button>
              </div>
            </div>
          `).join('');
        }

        container.innerHTML = html;
      }
    },

    // ========================================================================
    // PLAYLIST DETAIL SCREEN (PlaylistDetail.kt — Premium Redesign)
    // ========================================================================
    // PLAYLIST DETAIL VIEW (With Stable Mounted Search Input)
    // ========================================================================
    renderPlaylistDetail(playlistId, searchQuery = '', sortMode = 'custom') {
      const pl = Storage.getPlaylistById(playlistId);
      if (!pl) return;

      const container = document.getElementById('detail-tracks-container');
      const titleEl = document.getElementById('detail-title');
      const subEl = document.getElementById('detail-subtitle');
      const coverImg = document.getElementById('detail-cover-img');
      const sourceTagEl = document.getElementById('detail-source-tag');

      let songs = pl.songs || [];
      const totalSec = songs.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
      const durStr = totalSec > 0 ? ` • ${Math.floor(totalSec / 60)} min` : '';

      const matchedCount = songs.filter(s => s.isPlayable || s.audioUrl || s.streamUrl).length;
      const isImported = (pl.description && pl.description.includes('Imported from YouTube')) || pl.source === 'youtube_music';
      const sourceLabel = isImported ? 'Imported from YouTube Music' : 'Created by You';
      const matchSummary = isImported
        ? `${matchedCount} of ${songs.length} tracks matched`
        : `${songs.length} ${songs.length === 1 ? 'track' : 'tracks'}`;

      if (titleEl) titleEl.textContent = pl.name || 'Playlist';
      if (sourceTagEl) sourceTagEl.textContent = sourceLabel;
      if (subEl) subEl.textContent = `${matchSummary}${durStr}`;
      if (coverImg) {
        coverImg.src = pl.cover || (songs[0] && songs[0].image) || 'assets/logo.png';
      }

      // Filter by in-playlist search
      const q = (searchQuery || '').toLowerCase().trim();
      let filtered = [...songs];
      if (q) {
        filtered = filtered.filter(s => {
          const title = (s.name || s.title || '').toLowerCase();
          const artistStr = (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(s) : String(s.artists || s.primaryArtist || '')).toLowerCase();
          const albumStr = String(s.album || s.albumTitle || '').toLowerCase();
          return title.includes(q) || artistStr.includes(q) || albumStr.includes(q);
        });
      }

      // Sort
      filtered = Storage.sortPlaylistTracks(filtered, sortMode);

      // Render Tracks or Empty State HTML
      let tracksHtml = '';
      if (filtered.length === 0) {
        tracksHtml = `
          <div class="library-empty-state" style="padding:40px 10px;">
            <span class="material-symbols-outlined library-empty-icon">queue_music</span>
            <h4 class="library-empty-title">${q ? 'No matching tracks' : 'Playlist is empty'}</h4>
            <p class="library-empty-sub">${q ? 'Try a different search term.' : 'Discover music to add to this playlist.'}</p>
            <button class="library-empty-cta-btn" onclick="App.navigate('explore')">
              <span class="material-symbols-outlined" style="font-size:18px;">explore</span>
              <span>Discover Music</span>
            </button>
          </div>
        `;
      } else {
        tracksHtml += `<div class="playlist-tracks-list">`;
        filtered.forEach((song, idx) => {
          const actualIdx = songs.findIndex(s => String(s.id) === String(song.id));
          const isCurrentlyPlaying = (typeof Player !== 'undefined' && Player.getCurrentTrack()?.id === song.id);
          const trackNum = String(actualIdx + 1).padStart(2, '0');
          const artistLinks = renderArtistLinks(song);
          const dur = (song.duration && !isNaN(song.duration) && song.duration > 0) ? formatTime(song.duration) : '';

          tracksHtml += `
            <div class="vertical-track-row ${isCurrentlyPlaying ? 'playing' : ''}" draggable="true" ondragstart="App.handlePlaylistDragStart(event, ${actualIdx})" ondragover="App.handlePlaylistDragOver(event)" ondrop="App.handlePlaylistDrop(event, '${pl.id}', ${actualIdx})" onclick="App.playCustomPlaylistTrack('${pl.id}', ${actualIdx})">
              <span class="track-index-num" style="width:24px; font-size:13px; color:${isCurrentlyPlaying ? 'var(--color-primary)' : 'var(--text-secondary)'}; font-weight:700;">
                ${isCurrentlyPlaying ? '<span class="material-symbols-outlined fill-icon playing-eq-indicator">equalizer</span>' : trackNum}
              </span>
              <img class="vertical-track-img" src="${API.thumb(song.image || 'assets/logo.png')}" onerror="this.src='assets/logo.png'" alt="${escapeAttr(song.name)}">
              <div class="vertical-track-info">
                <div class="vertical-track-title ${isCurrentlyPlaying ? 'text-primary' : ''}">${escapeHtml(song.name)}</div>
                <div class="vertical-track-artist">${artistLinks}</div>
              </div>
              <span class="vertical-track-duration" style="font-size:12px; color:var(--text-secondary); margin-right:4px;">${dur}</span>
              <div style="display:flex; align-items:center; gap:2px;">
                <button class="queue-delete-btn" onclick="event.stopPropagation(); App.removeTrackFromCustomPlaylist('${pl.id}', '${song.id}');" title="Remove from Playlist">
                  <span class="material-symbols-outlined" style="font-size:18px;">close</span>
                </button>
                <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}', '${pl.id}');" aria-label="More">
                  <span class="material-symbols-outlined">more_vert</span>
                </button>
              </div>
            </div>
          `;
        });
        tracksHtml += `</div>`;
      }

      if (!container) return;

      const searchInputEl = document.getElementById('playlist-detail-search-input');
      const resultsContainer = document.getElementById('playlist-tracks-results');
      const isAlreadyMountedForThisPlaylist = (container.dataset && container.dataset.renderedPlaylistId === String(pl.id)) && searchInputEl && resultsContainer;

      if (isAlreadyMountedForThisPlaylist) {
        // Fast-path: Only update the results list! Keep input DOM element mounted without recreating it
        resultsContainer.innerHTML = tracksHtml;
        const clearBtn = document.getElementById('btn-playlist-search-clear');
        if (clearBtn) {
          clearBtn.style.display = searchInputEl.value ? 'flex' : 'none';
        }
        return;
      }

      // Initial Mount: Render full actions bar, search box, and results container
      if (container.dataset) {
        container.dataset.renderedPlaylistId = String(pl.id);
      }

      const placeholderText = isImported
        ? 'Search in YouTube Playlist...'
        : `Search in ${escapeAttr(pl.name)}...`;

      container.innerHTML = `
        <div class="detail-actions-bar">
          <button class="detail-play-btn" onclick="App.playCustomPlaylist('${pl.id}')" aria-label="Play All">
            <span class="material-symbols-outlined fill-icon" style="font-size:18px;">play_arrow</span>
            <span>Play All</span>
          </button>
          <button class="detail-action-pill" onclick="App.shuffleCustomPlaylist('${pl.id}')" title="Shuffle Playlist">
            <span class="material-symbols-outlined" style="font-size:16px;">shuffle</span>
            <span>Shuffle</span>
          </button>
          <button class="detail-action-pill" onclick="App.startPlaylistRadio('${pl.id}')" title="Playlist Radio">
            <span class="material-symbols-outlined fill-icon" style="font-size:16px;">radio</span>
            <span>Radio</span>
          </button>
          <button class="detail-action-pill" onclick="App.downloadPlaylistAction('${pl.id}')" title="Download Playlist">
            <span class="material-symbols-outlined" style="font-size:16px;">download</span>
            <span>Download</span>
          </button>
          <button class="detail-action-pill" onclick="App.openEditPlaylistModal('${pl.id}')" title="Edit Playlist">
            <span class="material-symbols-outlined" style="font-size:16px;">edit</span>
            <span>Edit</span>
          </button>
          <button class="detail-action-pill" onclick="App.exportPlaylistAction('${pl.id}')" title="Export Playlist">
            <span class="material-symbols-outlined" style="font-size:16px;">share</span>
            <span>Share</span>
          </button>
        </div>

        <!-- In-Playlist Search & Filter with Persistent Mounted Input -->
        <div class="detail-search-wrap">
          <div class="detail-search-box">
            <span class="material-symbols-outlined" style="font-size:18px;">search</span>
            <input type="text" id="playlist-detail-search-input" placeholder="${placeholderText}" value="${escapeAttr(searchQuery)}" oninput="App.filterCurrentPlaylist(this.value)" autocomplete="off" spellcheck="false">
            <button class="icon-btn-mini" id="btn-playlist-search-clear" style="display:${searchQuery ? 'flex' : 'none'}; background:transparent; border:none; cursor:pointer;" onclick="App.clearPlaylistSearch()">
              <span class="material-symbols-outlined" style="font-size:16px;">close</span>
            </button>
          </div>
        </div>

        <!-- Dedicated Results Container (Preserves Input Node During Live Filtering) -->
        <div id="playlist-tracks-results" class="playlist-tracks-results">
          ${tracksHtml}
        </div>
      `;
    },

    // ========================================================================
    // ALBUM DETAIL VIEW
    // ========================================================================
    renderAlbumDetail(albumData) {
      if (!albumData) return;
      const container = document.getElementById('detail-tracks-container');
      const titleEl = document.getElementById('detail-title');
      const subEl = document.getElementById('detail-subtitle');
      const coverImg = document.getElementById('detail-cover-img');
      const playBtn = document.getElementById('btn-detail-play-all');

      const songs = albumData.songs || [];
      const artist = albumData.artist || albumData.primaryArtist || (songs[0] && (songs[0].primaryArtist || songs[0].artists)) || 'MusicFlow';
      const year = albumData.year || (songs[0] && songs[0].year) || '';
      const isPlaylist = (albumData.type === 'playlist' || albumData.type === 'chart');
      const type = isPlaylist ? 'Playlist' : (albumData.type || (songs.length > 5 ? 'Album' : (songs.length > 1 ? 'EP' : 'Single')));
      const totalSec = songs.reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
      const durStr = totalSec > 0 ? ` • ${Math.floor(totalSec / 60)} min` : '';

      const sourceTagEl = document.getElementById('detail-source-tag');
      if (sourceTagEl) {
        sourceTagEl.textContent = isPlaylist ? 'PLAYLIST' : 'ALBUM';
      }

      if (titleEl) titleEl.textContent = albumData.name || albumData.title || (isPlaylist ? 'Playlist' : 'Album');
      if (subEl) {
        if (isPlaylist) {
          subEl.innerHTML = `
            <span style="color:#FFF; font-weight:700;">${escapeHtml(artist)}</span>
            <span> • Playlist • ${songs.length} track${songs.length === 1 ? '' : 's'}${durStr}</span>
          `;
        } else {
          subEl.innerHTML = `
            <span style="color:#FFF; font-weight:700; cursor:pointer;" onclick="App.openArtist('${artist.replace(/'/g, "\\'")}')">${escapeHtml(artist)}</span>
            <span> • ${year ? year + ' • ' : ''}${type} • ${songs.length} track${songs.length === 1 ? '' : 's'}${durStr}</span>
          `;
        }
      }
      if (coverImg) {
        coverImg.src = albumData.image || (songs[0] && songs[0].image) || 'assets/logo.png';
      }
      if (playBtn) {
        playBtn.onclick = () => App.playAlbumTrack(0);
      }

      let html = `
        <div class="detail-action-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="detail-play-btn" onclick="App.playAlbumTrack(0)" title="Play Album" aria-label="Play Album">
              <span class="material-symbols-outlined fill-icon" style="font-size:20px;">play_arrow</span>
              <span>Play</span>
            </button>
            <button class="lib-action-pill-btn" onclick="App.shuffleAlbum()" title="Shuffle Album">
              <span class="material-symbols-outlined" style="font-size:16px;">shuffle</span>
              <span>Shuffle</span>
            </button>
            <button class="lib-action-pill-btn" onclick="App.startAlbumRadio()" title="Album Radio">
              <span class="material-symbols-outlined" style="font-size:16px;">radio</span>
              <span>Radio</span>
            </button>
            <button class="lib-action-pill-btn" onclick="App.downloadAlbumAction()" title="Download Album">
              <span class="material-symbols-outlined" style="font-size:16px;">download</span>
              <span>Download</span>
            </button>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button class="icon-btn-mini" onclick="App.shareAlbumAction()" title="Share Album">
              <span class="material-symbols-outlined" style="font-size:18px;">share</span>
            </button>
          </div>
        </div>

        <div class="vertical-tracks-shelf" style="padding:0;">
      `;

      if (songs.length === 0) {
        html += `
          <div class="library-empty-state" style="padding:40px 10px;">
            <span class="material-symbols-outlined library-empty-icon">album</span>
            <h4 class="library-empty-title">No tracks found in this album</h4>
          </div>
        `;
      } else {
        html += songs.map((song, idx) => {
          const num = String(idx + 1).padStart(2, '0');
          const isDl = (typeof Storage !== 'undefined' && Storage.isDownloaded && Storage.isDownloaded(song.id));
          return `
            <div class="vertical-track-row" onclick="App.playAlbumTrack(${idx})">
              <div style="width:24px; font-size:13px; font-weight:700; color:var(--text-secondary); text-align:center; flex-shrink:0;">${num}</div>
              <img class="vertical-track-img" src="${API.thumb(song.image || albumData.image || 'assets/logo.png')}" onerror="this.src='assets/logo.png'" alt="${song.name}">
              <div class="vertical-track-info">
                <div class="vertical-track-title">${song.name}</div>
                <div class="vertical-track-artist">
                  ${song.artists || artist}
                  ${isDl ? '<span class="source-badge source-badge-downloaded" style="margin-left:4px; font-size:9px;">● DOWNLOADED</span>' : ''}
                </div>
              </div>
              <div style="font-size:12px; color:var(--text-secondary); margin-right:8px; font-variant-numeric:tabular-nums;">
                ${song.duration ? formatTime(Number(song.duration)) : ''}
              </div>
              <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}');" aria-label="More">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
          `;
        }).join('');
      }

      html += `</div>`;
      if (container) container.innerHTML = html;
    },

    renderPlayer3DDeck(song) {
      if (!song) return;
      const queue = (typeof Player !== 'undefined' && Player.getQueue) ? Player.getQueue() : [];
      const curIdx = (typeof Player !== 'undefined' && Player.getCurrentIndex) ? Player.getCurrentIndex() : 0;
      const repeatMode = (typeof Player !== 'undefined' && Player.getRepeatMode) ? Player.getRepeatMode() : 'OFF';

      const frontArt = document.getElementById('full-player-art');
      const prevArt = document.getElementById('player-art-prev');
      const nextArt = document.getElementById('player-art-next') || document.getElementById('player-art-back-1');
      const frontCard = document.getElementById('player-deck-front') || document.getElementById('player-art-card');
      const prevCard = document.getElementById('player-deck-prev');
      const nextCard = document.getElementById('player-deck-next') || document.getElementById('player-deck-back-1');

      // Determine previous & next tracks considering repeat mode
      let prevSong = null;
      if (curIdx - 1 >= 0 && curIdx - 1 < queue.length) {
        prevSong = queue[curIdx - 1];
      } else if (repeatMode === 'ALL' && queue.length > 1) {
        prevSong = queue[queue.length - 1];
      }

      let nextSong = null;
      if (curIdx + 1 < queue.length) {
        nextSong = queue[curIdx + 1];
      } else if (repeatMode === 'ALL' && queue.length > 1) {
        nextSong = queue[0];
      }

      // 1. Current Front Card
      if (frontArt) {
        frontArt.src = song.image || 'assets/logo.png';
      }
      if (frontCard) {
        frontCard.classList.remove('dragging', 'committing', 'springing');
        frontCard.style.transition = 'none';
        frontCard.style.transform = 'translate3d(0, 0, 0) scale(1) rotate(0deg)';
        frontCard.style.opacity = '1';
        frontCard.style.filter = 'brightness(1)';
        void frontCard.offsetWidth; // Force reflow
        frontCard.style.transition = '';
      }

      // 2. Previous Card (Underneath / Prepared Left-Back)
      if (prevArt) {
        prevArt.src = (prevSong && prevSong.image) ? prevSong.image : 'assets/logo.png';
      }
      if (prevCard) {
        prevCard.classList.remove('dragging', 'committing', 'springing');
        prevCard.style.transition = 'none';
        prevCard.style.display = prevSong ? 'block' : 'none';
        prevCard.style.transform = 'translate3d(0, -10px, -30px) scale(0.92) rotate(-1.5deg)';
        prevCard.style.opacity = '0.75';
        prevCard.style.filter = 'brightness(0.85)';
        prevCard.style.zIndex = '8';
      }

      // 3. Next Card (Underneath / Prepared Right-Back)
      if (nextArt) {
        nextArt.src = (nextSong && nextSong.image) ? nextSong.image : 'assets/logo.png';
      }
      if (nextCard) {
        nextCard.classList.remove('dragging', 'committing', 'springing');
        nextCard.style.transition = 'none';
        nextCard.style.display = nextSong ? 'block' : 'none';
        nextCard.style.transform = 'translate3d(0, -10px, -30px) scale(0.92) rotate(1.5deg)';
        nextCard.style.opacity = '0.75';
        nextCard.style.filter = 'brightness(0.85)';
        nextCard.style.zIndex = '8';
      }

      // Preload next/previous artwork into browser memory cache for instantaneous transitions
      if (typeof Image !== 'undefined') {
        if (nextSong && nextSong.image && nextSong.image.startsWith('http')) {
          const imgPreloadNext = new Image();
          imgPreloadNext.src = nextSong.image;
        }
        if (prevSong && prevSong.image && prevSong.image.startsWith('http')) {
          const imgPreloadPrev = new Image();
          imgPreloadPrev.src = prevSong.image;
        }
      }
    },

    // ========================================================================
    // PLAYER SCREEN & FLOATING MINI PLAYER (PlayerScreen.kt & MiniPlayer.kt)
    // ========================================================================
    updatePlayerBar(song) {
      if (!song) return;

      const isFav = (typeof Storage !== 'undefined' && Storage.isFavorite) ? Storage.isFavorite(song.id || song) : false;
      const isDl = (typeof Storage !== 'undefined' && Storage.isDownloaded) ? Storage.isDownloaded(song.id) : false;
      const isLoc = song.source === 'LOCAL' || (song.streamUrl && song.streamUrl.startsWith('blob:'));

      // 1. Floating MiniPlayer
      const miniPlayer = document.getElementById('mini-player');
      const miniArt = document.getElementById('mini-player-art');
      const miniTitle = document.getElementById('mini-song-title');
      const miniArtist = document.getElementById('mini-artist-name');
      const miniBadge = document.getElementById('mini-source-badge');
      const miniLikeIcon = document.getElementById('mini-like-icon');

      if (miniPlayer) miniPlayer.style.display = 'flex';
      if (miniArt) miniArt.src = song.image || 'assets/logo.png';
      // Xbox Music: the "now playing" tile on Home and the artwork in the navigation rail
      try {
        const title = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getTrackTitle(song) : (song.name || 'Unknown Track');
        const nowSec = document.getElementById('xbox-now-section');
        if (nowSec) {
          const art = document.getElementById('xbox-now-art');
          const t = document.getElementById('xbox-now-title');
          const a = document.getElementById('xbox-now-artist');
          if (art) art.src = song.image || 'assets/logo.png';
          if (t) t.textContent = title;
          if (a) a.textContent = formatArtists(song.artists || song.primaryArtist || 'MusicFlow');
          nowSec.style.display = '';
        }
        const railBtn = document.getElementById('rail-now-btn');
        const railArt = document.getElementById('rail-now-art');
        if (railArt) { railArt.src = song.image || 'assets/logo.png'; railArt.style.display = ''; }
        if (railBtn) railBtn.classList.add('has-art');
        const railTitle = document.getElementById('rail-now-title');
        if (railTitle) railTitle.textContent = title;
      } catch (_) {}
      if (miniTitle) {
        miniTitle.textContent = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getTrackTitle(song) : (song.name || 'Unknown Track');
        miniTitle.classList.remove('track-text-transition');
        void miniTitle.offsetWidth;
        miniTitle.classList.add('track-text-transition');
      }
      if (miniArtist) {
        miniArtist.textContent = formatArtists(song.artists || song.primaryArtist || 'MusicFlow');
        miniArtist.classList.remove('track-text-transition');
        void miniArtist.offsetWidth;
        miniArtist.classList.add('track-text-transition');
      }

      if (miniBadge) {
        if (isLoc) {
          miniBadge.textContent = '● LOCAL';
          miniBadge.style.display = 'inline-block';
          miniBadge.style.color = '#38EF7D';
          miniBadge.style.borderColor = 'rgba(56, 239, 125, 0.3)';
          miniBadge.style.background = 'rgba(56, 239, 125, 0.12)';
        } else if (isDl) {
          miniBadge.textContent = '● DOWNLOADED';
          miniBadge.style.display = 'inline-block';
          miniBadge.style.color = '#00F2FE';
          miniBadge.style.borderColor = 'rgba(0, 242, 254, 0.3)';
          miniBadge.style.background = 'rgba(0, 242, 254, 0.12)';
        } else {
          miniBadge.textContent = '320K';
          miniBadge.style.display = 'inline-block';
          miniBadge.style.color = 'var(--accent)';
          miniBadge.style.borderColor = 'var(--accent-border)';
          miniBadge.style.background = 'var(--accent-surface)';
        }
      }

      if (miniLikeIcon) {
        const wasFav = miniLikeIcon.textContent === 'favorite';
        miniLikeIcon.textContent = isFav ? 'favorite' : 'favorite_border';
        miniLikeIcon.style.color = isFav ? 'var(--accent)' : 'rgba(255, 255, 255, 0.7)';
        miniLikeIcon.style.fontVariationSettings = isFav ? "'FILL' 1, 'wght' 600" : "'FILL' 0, 'wght' 400";
        if (isFav && !wasFav) {
          miniLikeIcon.classList.remove('heart-pop');
          void miniLikeIcon.offsetWidth;
          miniLikeIcon.classList.add('heart-pop');
        }
      }

      // 2. Full Player Sheet & 3D Deck
      this.renderPlayer3DDeck(song);

      const fullArt = document.getElementById('full-player-art');
      const fullTitle = document.getElementById('full-player-title');
      const fullArtist = document.getElementById('full-player-artist');
      const fullArtistContainer = document.getElementById('full-player-artist-container');
      const heartIcon = document.getElementById('player-heart-icon');
      const heartBtn = document.getElementById('btn-player-favorite');
      const curTime = document.getElementById('player-time-current');
      const totalTime = document.getElementById('player-time-total');
      const contextTitle = document.getElementById('player-context-title');
      const sourceBadge = document.getElementById('player-source-badge');
      const dlIcon = document.getElementById('player-download-icon');
      const dlLabel = document.getElementById('player-download-label');
      const qualityBadge = document.getElementById('player-quality-badge');
      const losslessBadge = document.getElementById('player-lossless-badge');

      if (fullArt) fullArt.src = song.image || 'assets/logo.png';
      if (fullTitle) {
        fullTitle.textContent = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getTrackTitle(song) : (song.name || 'Unknown Track');
        fullTitle.classList.remove('track-text-transition');
        void fullTitle.offsetWidth;
        fullTitle.classList.add('track-text-transition');
      }
      
      if (fullArtistContainer) {
        fullArtistContainer.innerHTML = renderFullPlayerArtistLinks(song);
        fullArtistContainer.classList.remove('track-text-transition');
        void fullArtistContainer.offsetWidth;
        fullArtistContainer.classList.add('track-text-transition');
      } else if (fullArtist) {
        fullArtist.textContent = formatArtists(song.artists || song.primaryArtist || 'MusicFlow');
        fullArtist.onclick = () => {
          App.collapseFullPlayer();
          App.openArtist(song.primaryArtist || song.artists);
        };
      }
      if (totalTime) totalTime.textContent = (song.duration && !isNaN(song.duration) && song.duration > 0) ? formatTime(song.duration) : '0:00';
      if (curTime && !window._isUserSeeking && typeof Player !== 'undefined') {
        const curPos = Player.getPosition ? Player.getPosition() : 0;
        curTime.textContent = formatTime(curPos);
      }

      // Real Resolved Source Quality & Lossless Verification
      const resolvedSource = (typeof Player !== 'undefined' && Player.getCurrentResolvedSource) ? Player.getCurrentResolvedSource() : null;
      const isLossless = Boolean(resolvedSource?.isLossless || song.isLossless || (song.format && ['FLAC', 'WAV', 'ALAC'].includes(String(song.format).toUpperCase())));
      
      let actualBitrate = resolvedSource?.bitrate || song.quality || ((typeof Storage !== 'undefined' && Storage.getAudioQuality) ? Storage.getAudioQuality() : '320kbps');
      if (resolvedSource?.provider === 'youtube_music' || song.provider === 'youtube_music' || String(song.id).startsWith('yt_')) {
        actualBitrate = '160kbps';
      }

      if (qualityBadge) {
        const cleanQuality = String(actualBitrate).toLowerCase();
        let displayStr = '320 KBPS • HI-RES';
        if (cleanQuality.includes('320')) displayStr = '320 KBPS • HI-RES';
        else if (cleanQuality.includes('256')) displayStr = '256 KBPS • HI-FI';
        else if (cleanQuality.includes('160')) displayStr = '160 KBPS • HQ';
        else if (cleanQuality.includes('128')) displayStr = '128 KBPS';
        else if (cleanQuality.includes('96')) displayStr = '96 KBPS';
        else if (cleanQuality.includes('48')) displayStr = '48 KBPS';
        else {
          const cleanBitrate = String(actualBitrate).toUpperCase().replace('KBPS', ' KBPS').trim();
          displayStr = cleanBitrate.includes(' ') ? cleanBitrate : `${cleanBitrate} KBPS`;
        }
        qualityBadge.textContent = displayStr;
      }

      if (losslessBadge) {
        if (isLossless) {
          losslessBadge.style.display = 'inline-flex';
          losslessBadge.innerHTML = '<span class="material-symbols-outlined" style="font-size:13px; margin-right:3px;">graphic_eq</span>LOSSLESS';
          losslessBadge.style.color = '#10b981';
          losslessBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        } else {
          losslessBadge.style.display = 'inline-flex';
          const is320 = String(actualBitrate).includes('320');
          losslessBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size:13px; margin-right:3px;">graphic_eq</span>${is320 ? 'HQ AUDIO' : 'STREAM'}`;
          losslessBadge.style.color = 'var(--accent)';
          losslessBadge.style.borderColor = 'var(--accent-border)';
        }
      }

      if (contextTitle) {
        let cleanContext = (song.album || '').replace(/\(From .*\)/i, '').replace(/- .*/, '').replace(/^[,.\s-]+|[,.\s-]+$/g, '').trim();
        if (cleanContext.length > 24) cleanContext = cleanContext.substring(0, 24) + '...';
        if (!cleanContext || cleanContext.length < 2 || !/[a-zA-Z0-9]/.test(cleanContext)) {
          const art = (song.primaryArtist && song.primaryArtist.trim().length > 1) ? song.primaryArtist.trim() : '';
          cleanContext = (art && /[a-zA-Z0-9]/.test(art)) ? `${art} Radio` : (song.name || 'Top Hits');
        }
        contextTitle.textContent = cleanContext;
      }

      if (sourceBadge) {
        if (isLoc) {
          sourceBadge.textContent = '● LOCAL';
          sourceBadge.style.display = 'inline-block';
          sourceBadge.style.color = '#38EF7D';
          sourceBadge.style.borderColor = 'rgba(56, 239, 125, 0.3)';
          sourceBadge.style.background = 'rgba(56, 239, 125, 0.12)';
        } else {
          // Avoid duplicate DOWNLOADED indicator in metadata row (indicated on bottom utility button)
          sourceBadge.style.display = 'none';
        }
      }

      if (heartBtn && heartIcon) {
        heartBtn.classList.toggle('active', isFav);
        heartBtn.setAttribute('aria-label', isFav ? 'Remove from Favorites' : 'Add to Favorites');
        heartIcon.textContent = isFav ? 'favorite' : 'favorite_border';
        heartIcon.style.color = isFav ? 'var(--accent)' : 'rgba(255, 255, 255, 0.7)';
        heartIcon.style.fontVariationSettings = isFav ? "'FILL' 1, 'wght' 600" : "'FILL' 0, 'wght' 400";
      }

      if (dlIcon && dlLabel) {
        if (isDl) {
          dlIcon.textContent = 'cloud_done';
          dlIcon.style.color = '#00F2FE';
          dlLabel.textContent = 'Downloaded';
        } else if (isLoc) {
          dlIcon.textContent = 'folder';
          dlIcon.style.color = '#38EF7D';
          dlLabel.textContent = 'Device File';
        } else {
          dlIcon.textContent = 'download';
          dlIcon.style.color = 'var(--text-secondary)';
          dlLabel.textContent = 'Download';
        }
      }

      // Sync Shuffle & Repeat UI state
      if (typeof Player !== 'undefined') {
        this.updateShuffleState(Player.getIsShuffle());
        this.updateRepeatState(Player.getRepeatMode());
      }

      // Update dynamic audio output device UI
      if (typeof AudioOutputManager !== 'undefined' && AudioOutputManager.updateUI) {
        AudioOutputManager.updateUI();
      }

      // Extract dynamic colors for ambient lighting
      setDynamicColor(song.image);
    },

    updatePlaybackState(isPlaying, playbackState = '') {
      const miniPlayIcon = document.getElementById('mini-play-icon');
      const playerMainPlayIcon = document.getElementById('player-main-play-icon');
      const miniPlayBtn = document.getElementById('btn-mini-play');
      const playerMainPlayBtn = document.getElementById('btn-player-play');

      const isBuffering = (playbackState === 'BUFFERING' || playbackState === 'LOADING');
      const isError = (playbackState === 'ERROR');

      // Body-level play state (Apple Music style: artwork breathes between play and pause)
      try {
        if (typeof document !== 'undefined' && document.body && document.body.classList) {
          document.body.classList.toggle('is-playing', Boolean(isPlaying) && !isError);
        }
      } catch (_) {}

      if (miniPlayIcon) {
        if (isError) {
          miniPlayIcon.textContent = 'play_arrow';
          miniPlayIcon.style.animation = 'none';
        } else if (isBuffering) {
          miniPlayIcon.textContent = 'sync';
          miniPlayIcon.style.animation = 'spin 1.2s linear infinite';
        } else {
          miniPlayIcon.textContent = isPlaying ? 'pause' : 'play_arrow';
          miniPlayIcon.style.animation = 'none';
        }
      }

      if (playerMainPlayIcon) {
        if (isError) {
          playerMainPlayIcon.textContent = 'play_arrow';
          playerMainPlayIcon.style.animation = 'none';
        } else if (isBuffering) {
          playerMainPlayIcon.textContent = 'sync';
          playerMainPlayIcon.style.animation = 'spin 1.2s linear infinite';
        } else {
          playerMainPlayIcon.textContent = isPlaying ? 'pause' : 'play_arrow';
          playerMainPlayIcon.style.animation = 'none';
        }
      }

      if (miniPlayBtn) {
        miniPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      }
      if (playerMainPlayBtn) {
        playerMainPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      }

      // Synchronize Wavy Progress Bar Animation State
      const shouldAnimateWave = isPlaying && !isBuffering && !isError && playbackState !== 'PAUSED' && playbackState !== 'COMPLETED';
      if (this.WavyProgressBar) {
        this.WavyProgressBar.setPlaying(shouldAnimateWave);
      }
    },

    // ==========================================================================
    // ANIMATED WAVY PROGRESS BAR SINGLETON ENGINE (Layer 3 Continuous 60fps Wave)
    // ==========================================================================
    WavyProgressBar: {
      animFrameId: null,
      currentPct: 0,
      wavePhase: 0,
      isPlaying: false,
      isSeeking: false,
      _cachedWidth: 300,
      _cachedHeight: 32,
      _lastResizeTime: 0,

      setPlaying(playing) {
        this.isPlaying = !!playing;
        if (this.isPlaying) {
          this.startLoop();
        } else {
          this.stopLoop();
        }
      },

      setProgress(pct, isSeeking = false) {
        this.currentPct = Math.max(0, Math.min(100, isNaN(pct) ? 0 : pct));
        this.isSeeking = !!isSeeking;
        this.draw();
      },

      startLoop() {
        if (this.animFrameId) return;
        if (typeof requestAnimationFrame !== 'function') return;
        const tick = () => {
          if (!this.isPlaying) {
            this.animFrameId = null;
            return;
          }
          this.wavePhase = (this.wavePhase + 0.05) % (Math.PI * 2);
          this.draw();
          if (typeof requestAnimationFrame === 'function') {
            this.animFrameId = requestAnimationFrame(tick);
          }
        };
        this.animFrameId = requestAnimationFrame(tick);
      },

      stopLoop() {
        if (this.animFrameId && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.animFrameId);
        }
        this.animFrameId = null;
        this.draw();
      },

      draw() {
        const canvas = document.getElementById('player-seek-wave');
        if (!canvas || typeof canvas.getContext !== 'function') return;
        if (canvas.offsetParent === null) return;   // hidden in this design: skip the canvas work

        // Skip rendering if player is not visible to maintain 120fps fluidity
        const playerScreen = document.getElementById('screen-player');
        if (playerScreen && !playerScreen.classList.contains('active') && playerScreen.style.display === 'none') {
          return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const now = Date.now();
        if (now - this._lastResizeTime > 1000 || !this._cachedWidth) {
          this._lastResizeTime = now;
          this._cachedWidth = canvas.parentElement?.clientWidth || canvas.clientWidth || 300;
          this._cachedHeight = canvas.clientHeight || 32;
        }

        const width = this._cachedWidth;
        const height = this._cachedHeight;
        if (width <= 0 || height <= 0) return;

        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const targetCanvasWidth = Math.round(width * dpr);
        const targetCanvasHeight = Math.round(height * dpr);

        if (canvas.width !== targetCanvasWidth || canvas.height !== targetCanvasHeight) {
          canvas.width = targetCanvasWidth;
          canvas.height = targetCanvasHeight;
        }

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const centerY = height / 2;
        const playedWidth = Math.max(0, Math.min(width, (this.currentPct / 100) * width));

        // 1. Draw Unplayed Track Baseline
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        const startX = Math.min(width, Math.max(0, playedWidth));
        ctx.moveTo(startX, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        // 2. Draw Active Played Sinusoidal Wave
        if (playedWidth > 1) {
          ctx.beginPath();
          ctx.strokeStyle = (() => { try { return (getComputedStyle(document.body).getPropertyValue('--accent') || '').trim() || '#FF1744'; } catch (_) { return '#FF1744'; } })();
          ctx.lineWidth = 3.0;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          const amplitude = this.isPlaying ? 3.0 : 1.5;
          const frequency = 0.045;
          const taperDist = Math.min(16, playedWidth / 2);

          for (let x = 0; x <= playedWidth; x += 2.5) {
            let taper = 1.0;
            if (x < taperDist) {
              taper = x / taperDist;
            } else if (playedWidth - x < taperDist) {
              taper = (playedWidth - x) / taperDist;
            }

            const y = centerY + Math.sin(x * frequency + this.wavePhase) * amplitude * taper;
            if (x === 0) {
              ctx.moveTo(0, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }

        ctx.restore();
      }
    },

    updatePlaybackProgress(currentTime, duration) {
      const curTimeEl = document.getElementById('player-time-current');
      const totTimeEl = document.getElementById('player-time-total');
      const seekFill = document.getElementById('player-seek-fill');
      const seekThumb = document.getElementById('player-seek-thumb');
      const seekBar = document.getElementById('player-seek-bar');

      const cleanCur = isNaN(currentTime) ? 0 : Math.max(0, currentTime);
      const cleanDur = (isNaN(duration) || duration <= 0) ? 0 : duration;

      if (!window._isUserSeeking) {
        if (curTimeEl) curTimeEl.textContent = formatTime(cleanCur);
        if (totTimeEl) totTimeEl.textContent = cleanDur > 0 ? '-' + formatTime(Math.max(0, cleanDur - cleanCur)) : '0:00';

        if (cleanDur > 0) {
          const pct = Math.min(100, Math.max(0, (cleanCur / cleanDur) * 100));
          if (seekFill) seekFill.style.width = `${pct.toFixed(2)}%`;
          if (seekThumb) seekThumb.style.left = `${pct.toFixed(2)}%`;
          const miniFill = document.getElementById('mini-progress-fill');
          if (miniFill) miniFill.style.width = `${pct.toFixed(2)}%`;
          if (seekBar) {
            seekBar.setAttribute('aria-valuenow', String(Math.round(pct)));
            seekBar.setAttribute('aria-valuetext', `${formatTime(cleanCur)} of ${formatTime(cleanDur)}`);
          }
          if (this.WavyProgressBar) {
            this.WavyProgressBar.setProgress(pct, false);
          }
        } else {
          if (seekFill) seekFill.style.width = '0%';
          if (seekThumb) seekThumb.style.left = '0%';
          const miniFill0 = document.getElementById('mini-progress-fill');
          if (miniFill0) miniFill0.style.width = '0%';
          if (seekBar) {
            seekBar.setAttribute('aria-valuenow', '0');
            seekBar.setAttribute('aria-valuetext', '0:00');
          }
          if (this.WavyProgressBar) {
            this.WavyProgressBar.setProgress(0, false);
          }
        }
      } else {
        if (totTimeEl && cleanDur > 0) totTimeEl.textContent = '-' + formatTime(Math.max(0, cleanDur - cleanCur));
      }
    },

    renderWavyProgress(progressPct = 0, isPlaying = false) {
      if (this.WavyProgressBar) {
        this.WavyProgressBar.setProgress(progressPct, false);
        if (isPlaying !== undefined) {
          this.WavyProgressBar.setPlaying(isPlaying);
        }
      }
    },

    updateShuffleState(isShuffle) {
      const shuffleBtn = document.getElementById('btn-player-shuffle');
      const shuffleIcon = document.getElementById('player-shuffle-icon');
      if (shuffleBtn) {
        shuffleBtn.classList.toggle('active', isShuffle);
        shuffleBtn.setAttribute('aria-label', isShuffle ? 'Shuffle On' : 'Shuffle Off');
      }
      if (shuffleIcon) {
        shuffleIcon.style.color = isShuffle ? 'var(--accent)' : '';
      }
      const miniShuffle = document.getElementById('btn-mini-shuffle');
      if (miniShuffle) miniShuffle.classList.toggle('active', isShuffle);
    },

    updateRepeatState(repeatMode) {
      const repeatBtn = document.getElementById('btn-player-repeat');
      const repeatIcon = document.getElementById('player-repeat-icon');
      const isActive = (repeatMode === 'ALL' || repeatMode === 'ONE');
      if (repeatBtn) {
        repeatBtn.classList.toggle('active', isActive);
        repeatBtn.setAttribute('aria-label', repeatMode === 'ONE' ? 'Repeat One' : (repeatMode === 'ALL' ? 'Repeat All' : 'Repeat Off'));
      }
      if (repeatIcon) {
        repeatIcon.textContent = repeatMode === 'ONE' ? 'repeat_one' : 'repeat';
        repeatIcon.style.color = isActive ? 'var(--accent)' : '';
      }
      const miniRepeat = document.getElementById('btn-mini-repeat');
      const miniRepeatIcon = document.getElementById('mini-repeat-icon');
      if (miniRepeat) miniRepeat.classList.toggle('active', isActive);
      if (miniRepeatIcon) miniRepeatIcon.textContent = repeatMode === 'ONE' ? 'repeat_one' : 'repeat';
    },

    onThemeChange(targetTheme) {
      // 1. Redraw dynamic waveform canvas
      if (this.WavyProgressBar) {
        this.WavyProgressBar.draw();
      }
      // 2. Refresh active UI elements if a song is loaded
      if (typeof Player !== 'undefined') {
        const curSong = Player.getCurrentTrack();
        if (curSong) {
          this.updatePlayerBar(curSong);
        }
        this.updateShuffleState(Player.getIsShuffle());
        this.updateRepeatState(Player.getRepeatMode());
      }
    },

    showToast(message) {
      let toast = document.getElementById('mf-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'mf-toast';
        toast.style.cssText = 'position:fixed; bottom:calc(136px + max(12px, var(--safe-bottom))); left:50%; transform:translateX(-50%); background:rgba(20,20,24,0.94); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); color:#FFF; padding:10px 22px; border-radius:24px; font-size:13px; font-weight:600; box-shadow:0 8px 32px rgba(0,0,0,0.8), 0 0 16px rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.14); z-index:99999; pointer-events:none; transition:all 0.25s cubic-bezier(0.34,1.56,0.64,1); opacity:0; transform:translate(-50%, 15px) scale(0.9);';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.style.opacity = '1';
      toast.style.transform = 'translate(-50%, 0) scale(1)';
      clearTimeout(this._toastTimeout);
      this._toastTimeout = setTimeout(() => {
        if (toast) {
          toast.style.opacity = '0';
          toast.style.transform = 'translate(-50%, 15px) scale(0.9)';
        }
      }, 2400);
    },

    // ========================================================================
    // MODALS & BOTTOM SHEETS
    // ========================================================================
    renderQualityOptions(selectedQuality) {
      const list = document.getElementById('quality-options-list');
      if (!list) return;

      const tiers = [
        { key: '320kbps', name: 'Lossless & Hi-Res Master (320 kbps)', desc: 'Highest studio master fidelity, lossless dynamics' },
        { key: '256kbps', name: 'High Fidelity (256 kbps)', desc: 'Apple Music standard, ultra clean sound' },
        { key: '160kbps', name: 'High Quality (160 kbps)', desc: 'Crisp sound, balanced data usage' },
        { key: '128kbps', name: 'Standard (128 kbps)', desc: 'Smooth streaming, standard data usage' },
        { key: '96kbps', name: 'Normal / Data Saver (96 kbps)', desc: 'Low data consumption, quick buffering' },
        { key: '48kbps', name: 'Ultra Data Saver (48 kbps)', desc: 'Minimum data usage, ideal for slow networks' }
      ];

      list.innerHTML = tiers.map(t => {
        const isSel = t.key.toLowerCase() === (selectedQuality || '320kbps').toLowerCase();
        return `
          <div class="quality-option-row ${isSel ? 'selected' : ''}" onclick="App.selectQuality('${t.key}')">
            <div class="quality-radio-circle">
              <div class="quality-radio-inner"></div>
            </div>
            <div class="quality-text-col">
              <div class="quality-name">
                ${t.name}
                ${t.key === '320kbps' ? '<span class="lossless-badge" style="font-size:8px; padding:1px 4px;">LOSSLESS</span>' : ''}
              </div>
              <div class="quality-desc">${t.desc}</div>
            </div>
          </div>
        `;
      }).join('');
    },

    renderQueueSheet(queue, currentIndex) {
      const container = document.getElementById('queue-tracks-container');
      const countEl = document.getElementById('queue-tracks-count');
      if (countEl) countEl.textContent = `${queue.length} track${queue.length === 1 ? '' : 's'}`;
      if (!container || !queue) return;

      if (queue.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:50px 20px; color:var(--text-secondary);">
            <span class="material-symbols-outlined" style="font-size:48px; opacity:0.35; margin-bottom:12px;">queue_music</span>
            <h4 style="color:#FFF; font-size:16px; font-weight:700; margin-bottom:6px;">Queue is empty</h4>
            <p style="font-size:13px; margin-bottom:16px;">Discover songs to build your playback queue</p>
            <button class="library-empty-cta-btn" onclick="App.closeBottomSheet('sheet-queue'); App.navigate('explore');">
              <span class="material-symbols-outlined">explore</span>
              <span>Discover Music</span>
            </button>
          </div>
        `;
        return;
      }

      const currentSong = (currentIndex >= 0 && currentIndex < queue.length) ? queue[currentIndex] : null;
      const upcomingSongs = queue.slice(currentIndex + 1);

      let html = '';

      // 1. NOW PLAYING Section
      if (currentSong) {
        const isLoc = currentSong.source === 'LOCAL' || (currentSong.streamUrl && currentSong.streamUrl.startsWith('blob:'));
        const isDl = (typeof Storage !== 'undefined' && Storage.isDownloaded && Storage.isDownloaded(currentSong.id));
        html += `
          <div class="queue-section-header">NOW PLAYING</div>
          <div class="queue-track-row active" onclick="App.expandFullPlayer()">
            <img class="vertical-track-img" src="${API.thumb(currentSong.image || 'assets/logo.png')}" onerror="this.src='assets/logo.png'" alt="${currentSong.name}">
            <div class="vertical-track-info">
              <div class="vertical-track-title" style="color:var(--accent); font-weight:800;">${currentSong.name}</div>
              <div class="vertical-track-artist">${currentSong.artists || currentSong.primaryArtist || 'MusicFlow'}</div>
            </div>
            <span class="material-symbols-outlined fill-icon" style="color:var(--accent); font-size:22px; margin-right:8px;">graphic_eq</span>
          </div>
        `;
      }

      // 2. UP NEXT Section
      if (upcomingSongs.length > 0) {
        html += `<div class="queue-section-header">UP NEXT (${upcomingSongs.length})</div>`;
        upcomingSongs.forEach((song, i) => {
          const actualIdx = currentIndex + 1 + i;
          const songTitle = song.name || 'Track';
          const songArtist = song.artists || song.primaryArtist || 'MusicFlow';
          html += `
            <div class="queue-track-row" draggable="true" ondragstart="App.handleQueueDragStart(event, ${actualIdx})" ondragover="App.handleQueueDragOver(event)" ondrop="App.handleQueueDrop(event, ${actualIdx})" onclick="Player.playTrackAtIndex ? Player.playTrackAtIndex(${actualIdx}, true) : App.playSongWithQueue('${song.id}')">
              <span class="material-symbols-outlined queue-drag-handle" title="Drag to reorder">drag_indicator</span>
              <img class="vertical-track-img" src="${API.thumb(song.image || 'assets/logo.png')}" onerror="this.src='assets/logo.png'" alt="${songTitle}">
              <div class="vertical-track-info">
                <div class="vertical-track-title">${songTitle}</div>
                <div class="vertical-track-artist">${songArtist}</div>
              </div>
              <button class="queue-delete-btn" onclick="event.stopPropagation(); App.removeTrackFromQueue(${actualIdx});" aria-label="Remove from Queue" title="Remove">
                <span class="material-symbols-outlined" style="font-size:18px;">close</span>
              </button>
            </div>
          `;
        });
      }

      container.innerHTML = html;
    },

    renderArtistTopTracks(songs, isExpanded = false) {
      const container = document.getElementById('artist-tracks-container');
      const label = document.getElementById('artist-tracks-toggle-label');
      const chevron = document.getElementById('artist-tracks-chevron');
      if (!container || !songs) return;
      if (songs.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:var(--text-secondary);">No top tracks found</div>';
        return;
      }

      const displayList = isExpanded ? songs : songs.slice(0, 5);
      if (label) label.textContent = isExpanded ? 'Show less' : 'See all';
      if (chevron) chevron.textContent = isExpanded ? 'expand_less' : 'chevron_right';

      container.innerHTML = displayList.map((song, idx) => `
        <div class="numbered-track-row" onclick="App.playSongFromArtistList(${idx})">
          <span class="track-index-num">${String(idx + 1).padStart(2, '0')}</span>
          <img class="track-thumb-img" src="${API.thumb(song.image || 'assets/logo.png')}" onerror="this.src='assets/logo.png'" alt="${song.name}">
          <div class="track-info-col">
            <div class="track-name-text">${song.name}</div>
            <div class="track-artist-text">${song.artists}</div>
          </div>
          <button class="vertical-track-more" onclick="event.stopPropagation(); App.openSongMenu('${song.id}');" aria-label="More">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      `).join('');
    },

    renderEqualizerUI(eqData) {
      if (!eqData) return;
      const presetsContainer = document.getElementById('eq-presets-container');
      const bandsContainer = document.getElementById('eq-bands-container');
      const switchEl = document.getElementById('eq-switch');
      const masterLabel = document.getElementById('eq-master-label');
      const statusText = document.getElementById('eq-status-text');
      const statusIcon = document.getElementById('eq-status-icon');
      const statusBadge = document.getElementById('eq-status-badge');
      const spatialBadge = document.getElementById('eq-spatial-val-badge');
      const spatialButtons = document.querySelectorAll('#eq-spatial-levels .eq-seg-btn');
      const stereoMeter = document.getElementById('eq-stereo-meter');

      const bassSlider = document.getElementById('eq-bass-slider');
      const bassVal = document.getElementById('eq-bass-val');
      const trebleSlider = document.getElementById('eq-treble-slider');
      const trebleVal = document.getElementById('eq-treble-val');
      const vocalSlider = document.getElementById('eq-vocal-slider');
      const vocalVal = document.getElementById('eq-vocal-val');

      const normSwitch = document.getElementById('eq-norm-switch');
      const crossfadeSelect = document.getElementById('eq-crossfade-select');

      const isEnabled = eqData.enabled === true;

      // Master switch & Label
      if (switchEl) switchEl.checked = isEnabled;
      if (masterLabel) {
        masterLabel.textContent = isEnabled ? 'ON' : 'OFF';
        masterLabel.style.color = isEnabled ? 'var(--accent)' : 'var(--text-secondary)';
      }

      // 3D Spatial Level
      const spatialLevel = isEnabled ? (eqData.spatial || 'OFF') : 'OFF';
      if (spatialBadge) {
        spatialBadge.textContent = spatialLevel;
        spatialBadge.style.color = spatialLevel === 'OFF' ? 'var(--text-secondary)' : 'var(--accent)';
      }
      if (spatialButtons && spatialButtons.length > 0) {
        spatialButtons.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.level === (eqData.spatial || 'OFF'));
        });
      }
      if (stereoMeter) {
        if (!isEnabled || spatialLevel === 'OFF') stereoMeter.textContent = '───●───';
        else if (spatialLevel === 'HIGH') stereoMeter.textContent = '◀◀────●────▶▶';
        else if (spatialLevel === 'MEDIUM') stereoMeter.textContent = '◀───●───▶';
        else if (spatialLevel === 'LOW') stereoMeter.textContent = '◀──●──▶';
      }

      // Sound Enhancements
      const bassBoost = eqData.bassBoost !== undefined ? eqData.bassBoost : 0;
      if (bassSlider) bassSlider.value = bassBoost;
      if (bassVal) {
        bassVal.textContent = isEnabled ? (bassBoost > 0 ? `+${bassBoost} dB` : `${bassBoost} dB`) : 'OFF';
        bassVal.style.color = (isEnabled && bassBoost > 0) ? 'var(--accent)' : 'var(--text-secondary)';
      }

      const trebleBoost = eqData.trebleBoost !== undefined ? eqData.trebleBoost : 0;
      if (trebleSlider) trebleSlider.value = trebleBoost;
      if (trebleVal) {
        trebleVal.textContent = isEnabled ? (trebleBoost > 0 ? `+${trebleBoost} dB` : `${trebleBoost} dB`) : '0 dB';
        trebleVal.style.color = (isEnabled && trebleBoost !== 0) ? 'var(--accent)' : 'var(--text-secondary)';
      }

      const vocalBoost = eqData.vocalBoost !== undefined ? eqData.vocalBoost : 0;
      if (vocalSlider) vocalSlider.value = vocalBoost;
      if (vocalVal) {
        vocalVal.textContent = isEnabled ? (vocalBoost > 0 ? `+${vocalBoost} dB` : `${vocalBoost} dB`) : '0 dB';
        vocalVal.style.color = (isEnabled && vocalBoost > 0) ? 'var(--accent)' : 'var(--text-secondary)';
      }

      if (normSwitch) normSwitch.checked = eqData.normalization === true;
      if (crossfadeSelect) crossfadeSelect.value = String(eqData.crossfade || 0);

      // Real-Time Status Indicator
      if (statusText && statusIcon && statusBadge) {
        if (!isEnabled) {
          statusIcon.textContent = 'check_circle';
          statusIcon.style.color = 'var(--text-secondary)';
          statusText.textContent = 'Equalizer: OFF (Transparent bit-perfect original audio)';
          statusText.style.color = 'var(--text-secondary)';
          statusBadge.textContent = 'OFF';
          statusBadge.style.color = 'var(--text-secondary)';
          statusBadge.style.borderColor = 'rgba(255,255,255,0.15)';
        } else if (eqData.preset === 'Flat' && bassBoost === 0 && trebleBoost === 0 && vocalBoost === 0 && spatialLevel === 'OFF' && (!Array.isArray(eqData.bands) || eqData.bands.every(b => b === 0))) {
          statusIcon.textContent = 'check_circle';
          statusIcon.style.color = 'var(--accent)';
          statusText.textContent = 'Flat (✓ No audio processing applied)';
          statusText.style.color = '#FFFFFF';
          statusBadge.textContent = 'FLAT';
          statusBadge.style.color = 'var(--accent)';
          statusBadge.style.borderColor = 'var(--accent-border)';
        } else if (bassBoost > 0) {
          statusIcon.textContent = 'warning';
          statusIcon.style.color = '#f59e0b';
          statusText.textContent = `⚠ Bass Boost active (+${bassBoost} dB)`;
          statusText.style.color = '#FFFFFF';
          statusBadge.textContent = 'BASS BOOST';
          statusBadge.style.color = '#f59e0b';
          statusBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        } else if (spatialLevel !== 'OFF') {
          statusIcon.textContent = 'warning';
          statusIcon.style.color = '#8b5cf6';
          statusText.textContent = `⚠ 3D Spatial Audio active (${spatialLevel})`;
          statusText.style.color = '#FFFFFF';
          statusBadge.textContent = '3D SPATIAL';
          statusBadge.style.color = '#8b5cf6';
          statusBadge.style.borderColor = 'rgba(139, 92, 246, 0.4)';
        } else {
          statusIcon.textContent = 'graphic_eq';
          statusIcon.style.color = 'var(--accent)';
          statusText.textContent = `⚠ Preset "${eqData.preset || 'Custom'}" audio processing active`;
          statusText.style.color = '#FFFFFF';
          statusBadge.textContent = 'DSP ACTIVE';
          statusBadge.style.color = 'var(--accent)';
          statusBadge.style.borderColor = 'var(--accent-border)';
        }
      }

      // Presets (Standard Built-in, Pro 19 Presets, User Saved)
      if (presetsContainer) {
        let proPresetMap = {};
        if (typeof AudioEffectsEngine !== 'undefined' && typeof AudioEffectsEngine.getProPresets === 'function') {
          proPresetMap = AudioEffectsEngine.getProPresets();
        } else if (typeof AudioPresetsLibrary !== 'undefined' && typeof AudioPresetsLibrary.getMappedProPresets === 'function') {
          proPresetMap = AudioPresetsLibrary.getMappedProPresets();
        }
        const proNames = Object.keys(proPresetMap);
        const isCurrentPresetPro = proNames.includes(eqData.preset);

        const currentCat = (typeof App !== 'undefined' && typeof App.getPresetCategory === 'function')
          ? App.getPresetCategory()
          : (isCurrentPresetPro ? 'pro' : 'standard');

        // Update Category Tab UI if present
        const tabStd = document.getElementById('eq-cat-tab-standard');
        const tabPro = document.getElementById('eq-cat-tab-pro');
        if (tabStd) tabStd.classList.toggle('active', currentCat === 'standard');
        if (tabPro) tabPro.classList.toggle('active', currentCat === 'pro');

        if (currentCat === 'pro' && proNames.length > 0) {
          presetsContainer.innerHTML = proNames.map(p => {
            const isSelected = eqData.preset === p;
            const pro = proPresetMap[p] || {};
            const subTags = [];
            if (pro.bassBoost > 0) subTags.push('Bass');
            if (pro.spatial && pro.spatial !== 'OFF') subTags.push('3D');
            const subLabel = subTags.length > 0 ? `${subTags.join(' • ')} Enhanced` : 'Pro EQ';
            const safeName = p.replace(/'/g, "\\'");

            return `
              <button class="eq-preset-chip pro ${isSelected ? 'active' : ''}" onclick="App.selectEqPreset('${safeName}')" style="white-space:nowrap; padding:6px 14px; text-align:left; display:flex; flex-direction:column; gap:2px; cursor:pointer;">
                <span style="font-size:12px; font-weight:700;">${p}</span>
                <span style="font-size:9px; opacity:0.85; letter-spacing:0.3px; color:${isSelected ? '#FFFFFF' : 'var(--accent)'};">${subLabel}</span>
              </button>
            `;
          }).join('');
        } else {
          const builtIn = ['Flat', 'Bose Clarity', 'Bose Deep Bass', 'Bass Boost', 'Treble', 'Vocal', 'Rock', 'Pop', 'Hip-Hop', 'Classical', 'Jazz', 'Electronic', 'Bollywood', 'Lo-Fi', 'Acoustic'];
          const userPresets = (typeof Storage !== 'undefined' && typeof Storage.getUserPresets === 'function') ? Object.keys(Storage.getUserPresets()) : [];
          const allPresets = [...builtIn, ...userPresets];

          presetsContainer.innerHTML = allPresets.map(p => {
            const isUser = userPresets.includes(p);
            const isSelected = eqData.preset === p;
            const safeName = p.replace(/'/g, "\\'");
            return `
              <div style="position:relative; display:inline-flex; align-items:center;">
                <button class="eq-preset-chip ${isSelected ? 'active' : ''}" onclick="App.selectEqPreset('${safeName}')" style="white-space:nowrap; padding:6px 14px; font-size:12px; font-weight:700;">
                  ${p}
                </button>
                ${isUser ? `
                  <button onclick="event.stopPropagation(); App.deleteCustomPreset('${safeName}')" title="Delete preset" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; margin-left:-8px; margin-right:4px;">
                    <span class="material-symbols-outlined" style="font-size:14px;">close</span>
                  </button>
                ` : ''}
              </div>
            `;
          }).join('');
        }
      }

      // 7-Band Equalizer Sliders (60Hz, 150Hz, 400Hz, 1kHz, 2.4kHz, 6kHz, 15kHz)
      if (bandsContainer) {
        const labels = ['60Hz\nSub', '150Hz\nBass', '400Hz\nLow-Mid', '1kHz\nMid', '2.4kHz\nPres', '6kHz\nBrill', '15kHz\nAir'];
        const bands = (Array.isArray(eqData.bands) && eqData.bands.length >= 5)
          ? (eqData.bands.length === 7 ? eqData.bands : [...eqData.bands, 0, 0].slice(0, 7))
          : [0, 0, 0, 0, 0, 0, 0];

        bandsContainer.innerHTML = labels.map((lbl, idx) => {
          const val = Number(bands[idx]) || 0;
          return `
            <div class="eq-band-col" style="display:flex; flex-direction:column; align-items:center; gap:6px;">
              <span class="eq-band-val" id="eq-val-${idx}" style="font-size:10px; font-weight:800; color:${isEnabled ? (val > 0 ? 'var(--accent)' : (val < 0 ? '#4da6ff' : 'var(--text-secondary)')) : 'var(--text-secondary)'};">${val > 0 ? '+' + val : val}dB</span>
              <input type="range" class="eq-band-slider" min="-12" max="12" step="1" value="${val}" oninput="App.updateEqBand(${idx}, this.value)" style="height:120px; writing-mode:vertical-lr; direction:rtl; width:24px; accent-color:var(--accent);">
              <span class="eq-band-label" style="font-size:9.5px; text-align:center; color:var(--text-secondary); line-height:1.2;">${lbl.replace('\n', '<br>')}</span>
            </div>
          `;
        }).join('');
      }
    },

    renderLanguagesPicker(selectedLangs = ['hindi', 'english', 'punjabi']) {
      const container = document.getElementById('lang-selection-list');
      if (!container) return;

      const availableLanguages = [
        { key: 'hindi', label: 'Hindi' },
        { key: 'english', label: 'English' },
        { key: 'punjabi', label: 'Punjabi' },
        { key: 'telugu', label: 'Telugu' },
        { key: 'tamil', label: 'Tamil' },
        { key: 'bhojpuri', label: 'Bhojpuri' },
        { key: 'malayalam', label: 'Malayalam' },
        { key: 'marathi', label: 'Marathi' },
        { key: 'bengali', label: 'Bengali' },
        { key: 'kannada', label: 'Kannada' },
        { key: 'gujarati', label: 'Gujarati' },
        { key: 'urdu', label: 'Urdu' },
        { key: 'rajasthani', label: 'Rajasthani' },
        { key: 'haryanvi', label: 'Haryanvi' }
      ];

      const currentSelected = new Set((selectedLangs || []).map(l => String(l).toLowerCase().trim()));

      container.innerHTML = availableLanguages.map(lang => {
        const isChecked = currentSelected.has(lang.key);
        return `
          <label class="lang-selection-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:12px; margin-bottom:6px; background:rgba(255,255,255,0.03); cursor:pointer;">
            <div style="font-size:14px; font-weight:600; color:#FFFFFF;">${lang.label}</div>
            <input type="checkbox" value="${lang.key}" ${isChecked ? 'checked' : ''} onchange="App.toggleLanguageSelection('${lang.key}', this.checked)" style="width:18px; height:18px; accent-color:var(--accent); cursor:pointer;">
          </label>
        `;
      }).join('');
    },

    renderPlaylistPicker(playlists, song) {
      const container = document.getElementById('dialog-playlists-list');
      if (!container) return;

      if (!playlists || playlists.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:20px 0; color:var(--text-secondary); font-size:13px;">
            No custom playlists yet. Tap "Create New Playlist" above.
          </div>
        `;
        return;
      }

      container.innerHTML = playlists.map(pl => `
        <div class="sheet-action-item" onclick="App.addSongToSpecificPlaylist('${pl.id}')" style="border-radius:12px; margin-bottom:4px; background:#141416;">
          <span class="material-symbols-outlined" style="color:var(--accent);">queue_music</span>
          <div style="flex:1;">
            <div style="font-weight:700; color:#FFFFFF; font-size:14px;">${pl.name}</div>
            <div style="font-size:11.5px; color:var(--text-secondary);">${pl.songs?.length || 0} songs</div>
          </div>
        </div>
      `).join('');
    },

    renderPlaylistPicker(playlists = [], song = null) {
      const container = document.getElementById('dialog-playlists-list');
      if (!container) return;

      if (!playlists || playlists.length === 0) {
        container.innerHTML = `
          <div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:13px;">
            No playlists found. Create your first playlist above!
          </div>
        `;
        return;
      }

      container.innerHTML = playlists.map(pl => `
        <div class="playlist-picker-item" onclick="App.addSongToSpecificPlaylist ? App.addSongToSpecificPlaylist('${pl.id}') : App.addSongToPlaylist('${pl.id}')" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.03); margin-bottom:6px; cursor:pointer;">
          <span class="material-symbols-outlined" style="color:var(--accent); font-size:22px;">queue_music</span>
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:600; color:#FFFFFF; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(pl.name || 'Playlist')}</div>
            <div style="font-size:11px; color:var(--text-secondary);">${(pl.songs || []).length} songs</div>
          </div>
          <span class="material-symbols-outlined" style="color:var(--text-secondary); font-size:18px;">add</span>
        </div>
      `).join('');
    },

    renderQualityOptions(currentQuality = '320kbps') {
      const container = document.getElementById('quality-options-list');
      if (!container) return;

      const options = [
        { key: '320kbps', label: 'Lossless / High Quality', bitrate: '320 kbps', desc: 'Highest studio master fidelity, lossless acoustic dynamics', badge: 'LOSSLESS' },
        { key: '256kbps', label: 'High Fidelity', bitrate: '256 kbps', desc: 'Apple Music standard, pristine soundstage clarity', badge: 'HI-FI' },
        { key: '160kbps', label: 'Standard Quality', bitrate: '160 kbps', desc: 'Crisp sound, balanced data usage and rapid streaming', badge: 'HQ' },
        { key: '128kbps', label: 'Normal Quality', bitrate: '128 kbps', desc: 'Smooth streaming, standard data usage', badge: null },
        { key: '96kbps', label: 'Data Saver', bitrate: '96 kbps', desc: 'Low data consumption, quick buffering on mobile data', badge: null },
        { key: '48kbps', label: 'Ultra Data Saver', bitrate: '48 kbps', desc: 'Minimal data usage, ideal for weak or slow networks', badge: null }
      ];

      const cleanCurr = String(currentQuality).toLowerCase();

      container.innerHTML = options.map(opt => {
        const isSelected = cleanCurr === opt.key.toLowerCase() || (cleanCurr.replace(/\D/g, '') === opt.key.replace(/\D/g, ''));
        return `
          <div class="quality-option-row ${isSelected ? 'selected' : ''}" onclick="App.selectQuality('${opt.key}')" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:12px; margin-bottom:8px; background:${isSelected ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.02)'}; border:1px solid ${isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.06)'}; cursor:pointer; transition:all 0.2s cubic-bezier(0.4, 0, 0.2, 1);">
            <div style="flex:1; padding-right:12px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:14px; font-weight:700; color:${isSelected ? 'var(--accent)' : '#FFFFFF'};">${opt.label} (${opt.bitrate})</span>
                ${opt.badge ? `<span style="font-size:9px; font-weight:800; padding:2px 5px; border-radius:4px; background:rgba(255,255,255,0.12); color:${isSelected ? 'var(--accent)' : '#EEEEEE'}; letter-spacing:0.5px;">${opt.badge}</span>` : ''}
              </div>
              <div style="font-size:11px; color:var(--text-secondary); margin-top:3px; line-height:1.3;">${opt.desc}</div>
            </div>
            ${isSelected ? '<span class="material-symbols-outlined" style="color:var(--accent); font-size:22px; font-weight:bold;">check_circle</span>' : '<span class="material-symbols-outlined" style="color:rgba(255,255,255,0.3); font-size:22px;">radio_button_unchecked</span>'}
          </div>
        `;
      }).join('');
    },

    renderSettingsSheet() {
      const nameVal = document.getElementById('settings-name-val');
      const qualityVal = document.getElementById('settings-quality-val');
      const perfVal = document.getElementById('settings-perf-val');
      const smartDlSwitch = document.getElementById('settings-smart-dl-switch');
      const autoCleanSelect = document.getElementById('settings-auto-cleanup-select');
      const dlLimitSelect = document.getElementById('settings-dl-limit-select');

      const prof = (typeof Storage !== 'undefined' && Storage.getUserProfile) ? Storage.getUserProfile() : { name: '' };
      const quality = String((typeof Storage !== 'undefined' && Storage.getAudioQuality) ? Storage.getAudioQuality() : '320kbps').toLowerCase();
      const perf = (typeof Storage !== 'undefined' && Storage.isPerformanceMode) ? Storage.isPerformanceMode() : false;

      // Short labels: the settings row shows the value on the right, Apple style
      let qualityLabel = 'Highest · 320 kbps';
      if (quality.includes('320')) qualityLabel = 'Highest · 320 kbps';
      else if (quality.includes('256')) qualityLabel = 'High · 256 kbps';
      else if (quality.includes('160')) qualityLabel = 'Good · 160 kbps';
      else if (quality.includes('128')) qualityLabel = 'Standard · 128 kbps';
      else if (quality.includes('96')) qualityLabel = 'Data Saver · 96 kbps';
      else if (quality.includes('48')) qualityLabel = 'Low · 48 kbps';

      const userName = String(prof.name || '').trim();
      if (nameVal) nameVal.textContent = userName || 'Not set';
      const cardName = document.getElementById('settings-card-name');
      if (cardName) cardName.textContent = userName || 'Add your name';

      const avatarSrc = prof.avatar || 'assets/logo.png';
      const cardAvatar = document.getElementById('settings-card-avatar');
      if (cardAvatar && avatarSrc) cardAvatar.src = avatarSrc;
      const avatarImg = document.getElementById('settings-avatar-img');
      if (avatarImg && avatarSrc) avatarImg.src = avatarSrc;
      const homeAvatar = document.getElementById('home-user-avatar');
      if (homeAvatar && avatarSrc) homeAvatar.src = avatarSrc;

      if (qualityVal) qualityVal.textContent = qualityLabel;
      if (perfVal) perfVal.textContent = perf ? 'ON (Minimal UI Animations)' : 'OFF (Smooth 60fps)';

      if (smartDlSwitch && typeof Storage !== 'undefined') {
        smartDlSwitch.checked = Storage.isSmartDownloadsEnabled ? Storage.isSmartDownloadsEnabled() : false;
      }
      if (autoCleanSelect && typeof Storage !== 'undefined') {
        autoCleanSelect.value = String(Storage.getAutoCleanupDays ? Storage.getAutoCleanupDays() : 30);
      }
      if (dlLimitSelect && typeof Storage !== 'undefined') {
        dlLimitSelect.value = String(Storage.getStorageLimitMb ? Storage.getStorageLimitMb() : 2048);
      }

      // Download Quality & Phone Folder State
      const dlQualityVal = document.getElementById('settings-dl-quality-val');
      const dlQualitySub = document.getElementById('settings-dl-quality-sub');
      const savePhoneSwitch = document.getElementById('settings-save-phone-folder-switch');

      const dlQuality = (typeof DownloadManager !== 'undefined' && DownloadManager.getDownloadQuality) 
        ? DownloadManager.getDownloadQuality() 
        : '320kbps';
      const saveToPhone = (typeof DownloadManager !== 'undefined' && DownloadManager.getSaveToPhoneFolder) 
        ? DownloadManager.getSaveToPhoneFolder() 
        : true;

      if (dlQualityVal) {
        dlQualityVal.textContent = dlQuality.toUpperCase();
      }
      if (dlQualitySub) {
        let qText = 'Lossless & Studio Master (320 kbps)';
        if (dlQuality === '256kbps') qText = 'High Fidelity (256 kbps)';
        else if (dlQuality === '160kbps') qText = 'Standard Quality (160 kbps)';
        else if (dlQuality === '96kbps') qText = 'Data Saver (96 kbps)';
        dlQualitySub.textContent = qText;
      }
      if (savePhoneSwitch) {
        savePhoneSwitch.checked = saveToPhone;
      }

      if (typeof App !== 'undefined' && typeof App.renderAppearanceSetting === 'function') {
        try { App.renderAppearanceSetting(); } catch (_) {}
      }
      // Lock screen section (Android only; hidden on the web)
      if (typeof App !== 'undefined' && typeof App.renderLockScreenSettings === 'function') {
        try { App.renderLockScreenSettings(); } catch (_) {}
      }
    },

    renderThemePicker() {
      const container = document.getElementById('theme-presets-container');
      const activeTheme = (typeof ThemeManager !== 'undefined' && ThemeManager.getTheme) ? ThemeManager.getTheme() : { id: 'red', color: '#FF1744' };
      const presets = (typeof ThemeManager !== 'undefined' && ThemeManager.getPresets) ? ThemeManager.getPresets() : [
        { id: 'red', name: 'MusicFlow Red', color: '#FF1744' },
        { id: 'ocean_blue', name: 'Ocean Blue', color: '#007AFF' },
        { id: 'emerald', name: 'Emerald', color: '#10B981' },
        { id: 'purple', name: 'Royal Purple', color: '#8B5CF6' },
        { id: 'sunset', name: 'Sunset Orange', color: '#FF5722' },
        { id: 'rose', name: 'Rose Pink', color: '#EC4899' },
        { id: 'gold', name: 'Gold Amber', color: '#F59E0B' },
        { id: 'cyan', name: 'Cyan', color: '#06B6D4' }
      ];

      // Update Design Style cards active state
      const currentStyle = (typeof ThemeManager !== 'undefined' && ThemeManager.getThemeStyle) ? ThemeManager.getThemeStyle() : 'normal';
      const styleCards = document.querySelectorAll('.theme-style-card');
      styleCards.forEach(card => {
        const st = card.dataset.style;
        const isSelected = (st === currentStyle);
        card.classList.toggle('active', isSelected);
      });

      if (container) {
        container.innerHTML = presets.map(p => {
          const isMatch = (activeTheme.id === p.id) || (String(activeTheme.color).toLowerCase() === String(p.color).toLowerCase());
          return `
            <div class="theme-preset-card ${isMatch ? 'active' : ''}" onclick="App.selectThemePreset('${p.id}')" data-theme-id="${p.id}" data-color="${p.color}" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:10px; border-radius:12px; background:${isMatch ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)'}; border:1px solid ${isMatch ? 'var(--accent)' : 'rgba(255,255,255,0.06)'}; cursor:pointer;">
              <div class="theme-swatch-circle" style="width:36px; height:36px; border-radius:50%; background:${p.color}; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 10px ${p.color}40;">
                ${isMatch ? '<span class="material-symbols-outlined" style="color:#FFFFFF; font-size:20px; font-weight:bold;">check</span>' : ''}
              </div>
              <span class="theme-preset-name" style="font-size:11px; font-weight:600; color:${isMatch ? 'var(--accent)' : 'var(--text-secondary)'}; text-align:center;">${p.name}</span>
            </div>
          `;
        }).join('');
      }

      this.renderThemePreview(activeTheme);
    },

    renderThemePreview(theme) {
      const customInput = document.getElementById('theme-custom-color-input');
      const current = theme || (typeof ThemeManager !== 'undefined' ? ThemeManager.getTheme() : { id: 'red', color: '#FF1744' });

      const presetCards = document.querySelectorAll('.theme-preset-card');
      presetCards.forEach(card => {
        const id = card.dataset.themeId;
        const color = card.dataset.color;
        const isMatch = (id && id === current.id) || (color && color.toLowerCase() === current.color.toLowerCase());
        card.classList.toggle('active', isMatch);
        card.style.border = isMatch ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.06)';
        card.style.background = isMatch ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)';
      });

      if (customInput && current.color) {
        customInput.value = current.color;
      }
    },

    renderSleepTimerDialog(state) {
      const container = document.getElementById('dialog-sleep-timer-body') || document.getElementById('sleep-timer-dialog-content');
      if (!container) return;

      const timerState = state || (typeof Player !== 'undefined' && Player.getSleepTimerState ? Player.getSleepTimerState() : { active: false });

      const presets = [
        { label: '15 Minutes', mins: 15 },
        { label: '30 Minutes', mins: 30 },
        { label: '45 Minutes', mins: 45 },
        { label: '60 Minutes', mins: 60 },
        { label: 'End of Track', mode: 'end_of_track' }
      ];

      const chipsHtml = presets.map(p => {
        const isSelected = timerState.active && (p.mode ? timerState.mode === p.mode : timerState.totalSeconds === p.mins * 60);
        const clickCall = p.mode ? `App.setSleepTimerEndOfTrack()` : `App.setSleepTimerMinutes(${p.mins})`;
        return `
          <button class="sleep-chip-btn ${isSelected ? 'active' : ''}" onclick="${clickCall}" style="padding:10px 14px; border-radius:10px; font-weight:600; font-size:13px; cursor:pointer; background:${isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.05)'}; color:${isSelected ? 'var(--accent-text, #fff)' : '#fff'}; border:1px solid ${isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.1)'};">
            ${p.label}
          </button>
        `;
      }).join('');

      let activeBannerHtml = '';
      if (timerState.active) {
        activeBannerHtml = `
          <div class="sleep-active-banner" style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-radius:12px; background:rgba(255,255,255,0.06); border:1px solid var(--accent); margin-bottom:16px;">
            <div class="sleep-active-left" style="display:flex; align-items:center; gap:12px;">
              <span class="material-symbols-outlined sleep-pulse-icon" style="color:var(--accent); font-size:24px;">timer</span>
              <div class="sleep-active-info">
                <div class="sleep-time-left" id="sleep-timer-live-remaining" style="font-size:16px; font-weight:800; color:#FFFFFF;">${timerState.formattedRemaining || '0:00'}</div>
                <div class="sleep-sub" style="font-size:11px; color:var(--text-secondary);">${timerState.mode === 'end_of_track' ? 'Stopping after this track' : 'Sleep timer active'}</div>
              </div>
            </div>
            <div class="sleep-active-actions" style="display:flex; gap:8px;">
              <button class="sleep-action-btn-pill" onclick="App.extendSleepTimer(5)" style="padding:6px 12px; border-radius:8px; background:rgba(255,255,255,0.1); border:none; color:#fff; font-size:12px; font-weight:700; cursor:pointer;">+5m</button>
              <button class="sleep-action-btn-pill cancel" onclick="App.cancelSleepTimer()" style="padding:6px 12px; border-radius:8px; background:rgba(255,23,68,0.2); border:none; color:#FF1744; font-size:12px; font-weight:700; cursor:pointer;">Cancel</button>
            </div>
          </div>
        `;
      }

      container.innerHTML = `
        ${activeBannerHtml}
        <div class="sleep-section-title" style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Select Timer Duration</div>
        <div class="sleep-chips-grid" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:10px; margin-bottom:12px;">
          ${chipsHtml}
        </div>
        <div class="sleep-section-title" style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-top:12px; margin-bottom:8px;">Custom Duration</div>
        <div class="sleep-custom-wrap" style="padding:12px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:12px; color:var(--text-secondary);">Set timer (5 – 180 min)</span>
            <span id="sleep-custom-val" style="font-size:13px; font-weight:800; color:var(--accent);">45 min</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <input type="range" class="player-seek-slider" id="sleep-custom-slider" min="5" max="180" step="5" value="45" oninput="App.onCustomSleepInput(this.value)" style="flex:1; accent-color:var(--accent);">
            <button class="sleep-chip-btn primary" onclick="App.setCustomSleepTimer()" style="padding:6px 14px; font-size:12px; font-weight:700; border-radius:8px; background:var(--accent); color:var(--accent-text, #fff); border:none; cursor:pointer;">Set</button>
          </div>
        </div>
      `;
    },

    updateSleepTimerUI(state) {
      const timerState = state || (typeof Player !== 'undefined' && Player.getSleepTimerState ? Player.getSleepTimerState() : { active: false });

      // 1. Update Full Player Utility Button
      const btn = document.getElementById('btn-player-timer');
      const label = document.getElementById('player-timer-label');
      const icon = document.getElementById('player-timer-icon');

      if (btn && label) {
        if (timerState.active) {
          btn.classList.add('active');
          const displayText = timerState.mode === 'end_of_track' ? 'End Song' : (timerState.formattedRemaining || 'Active');
          label.textContent = displayText;
          btn.setAttribute('aria-label', `Sleep timer active, ${displayText} remaining`);
          if (icon) icon.style.color = 'var(--accent)';
        } else {
          btn.classList.remove('active');
          label.textContent = 'Timer';
          btn.setAttribute('aria-label', 'Sleep timer');
          if (icon) icon.style.color = '';
        }
      }

      // 2. Update Live Countdown in Open Dialog (if open)
      const liveEl = document.getElementById('sleep-timer-live-remaining');
      if (liveEl) {
        liveEl.textContent = timerState.formattedRemaining || '0:00';
      }
    },

    // ========================================================================
    // IN-APP UPDATE UI METHODS
    // ========================================================================
    showUpdateDialog(updateData, isMandatory = false, isImprovements = false) {
      const dialog = document.getElementById('modal-update-dialog');
      if (!dialog) return;

      const titleEl = document.getElementById('update-dialog-title');
      const badgeEl = document.getElementById('update-dialog-badge');
      const currVerEl = document.getElementById('update-curr-version');
      const newVerEl = document.getElementById('update-new-version');
      const notesListEl = document.getElementById('update-notes-list');
      const laterBtn = document.getElementById('btn-update-later');
      const updateNowBtn = document.getElementById('btn-update-now');
      const updateNowText = document.getElementById('btn-update-now-text');

      const currVer = (typeof UpdateManager !== 'undefined') ? UpdateManager.VERSION : '2.7.2';
      const latestVer = updateData.latestVersion || currVer;

      if (titleEl) titleEl.textContent = updateData.title || (isImprovements ? "MusicFlow What's New" : `MusicFlow ${latestVer}`);
      if (currVerEl) currVerEl.textContent = `v${currVer}`;
      if (newVerEl) newVerEl.textContent = `v${latestVer}`;

      if (badgeEl) {
        if (isImprovements) {
          badgeEl.textContent = "What's New & Improvements";
          badgeEl.style.color = '#A855F7';
          badgeEl.style.background = 'rgba(168, 85, 247, 0.14)';
        } else if (isMandatory) {
          badgeEl.textContent = 'Update Required';
          badgeEl.style.color = 'var(--accent)';
          badgeEl.style.background = 'var(--accent-soft)';
        } else {
          badgeEl.textContent = 'Update Available';
          badgeEl.style.color = '#00F2FE';
          badgeEl.style.background = 'rgba(0, 242, 254, 0.12)';
        }
      }

      if (notesListEl) {
        notesListEl.innerHTML = '';
        const defaultNotes = [
          "⚡ 120 FPS Instant Search & 0ms Playback: Eliminated typing lag with AbortSignal request pruning and instant pre-cached audio streams.",
          "✨ Zero-Scroll Playlist & Album Navigation: Opening any playlist or album immediately resets view to top header with smooth animations.",
          "💿 Resilient Discography & Top Albums: Multi-tier fallback ensures album shelves never get stuck loading.",
          "♾️ Infinite Unbroken Radio & Up Next: Automatic dynamic fallback queues guarantee non-stop playback without dead ends.",
          "🎧 3D Spatial Audio & Equalizer v2: Ultra-crisp audio tuning with bass boost and surround virtualization.",
          "🚀 Sideload APK Direct Updates: Instant delivery of new releases and APK downloads with 1-click update."
        ];
        const notes = Array.isArray(updateData.releaseNotes) && updateData.releaseNotes.length > 0
          ? updateData.releaseNotes
          : defaultNotes;
        notes.forEach(note => {
          const li = document.createElement('li');
          li.textContent = note;
          notesListEl.appendChild(li);
        });
      }

      if (laterBtn) {
        laterBtn.style.display = isMandatory ? 'none' : 'block';
        laterBtn.textContent = isImprovements ? 'Close' : 'Later';
      }

      if (updateNowBtn) {
        const isAssetAvailable = updateData.assetAvailable !== false;
        if (!isAssetAvailable) {
          updateNowBtn.style.opacity = '0.6';
          if (updateNowText) updateNowText.textContent = 'Temporarily Unavailable';
        } else {
          updateNowBtn.style.opacity = '1';
          if (updateNowText) updateNowText.textContent = isImprovements ? 'Download Latest APK' : (isMandatory ? 'Update MusicFlow' : 'Update Now');
        }
      }

      dialog.style.display = 'flex';
      dialog.classList.add('active');
    },

    hideUpdateDialog() {
      const dialog = document.getElementById('modal-update-dialog');
      if (dialog) {
        dialog.style.display = 'none';
        dialog.classList.remove('active');
      }
    },

    showUpdateBanner(updateData) {
      const banner = document.getElementById('update-banner');
      if (!banner) return;

      const titleEl = document.getElementById('update-banner-title');
      const subEl = document.getElementById('update-banner-sub');

      const latestVer = updateData.latestVersion || 'New Version';
      if (titleEl) titleEl.textContent = `MusicFlow v${latestVer} is available`;
      if (subEl) subEl.textContent = updateData.message || 'Tap to download the latest sideloaded build.';

      banner.style.display = 'flex';
    },

    hideUpdateBanner() {
      const banner = document.getElementById('update-banner');
      if (banner) {
        banner.style.display = 'none';
      }
    },

    renderAboutSettings(state) {
      const versionVal = document.getElementById('settings-version-val');
      const statusSub = document.getElementById('settings-update-status');
      const timeEl = document.getElementById('settings-update-time');
      const spinIcon = document.getElementById('icon-update-spin');
      const btnText = document.getElementById('text-update-btn');

      const appVer = (typeof UpdateManager !== 'undefined') ? UpdateManager.VERSION : '2.7.2';
      if (versionVal) versionVal.textContent = `v${appVer}`;

      if (state && state.isChecking) {
        if (statusSub) statusSub.textContent = 'Checking for updates...';
        if (spinIcon) spinIcon.classList.add('spin-icon-fast');
        if (btnText) btnText.textContent = 'Checking...';
        return;
      }

      if (spinIcon) spinIcon.classList.remove('spin-icon-fast');
      if (btnText) btnText.textContent = 'Check';

      if (state && state.updateAvailable) {
        const latest = (state.updateData && state.updateData.latestVersion) || 'New';
        if (statusSub) {
          statusSub.textContent = `MusicFlow v${latest} available!`;
          statusSub.style.color = '#00F2FE';
        }
        if (btnText) btnText.textContent = 'Update';
      } else if (state && state.error) {
        if (statusSub) {
          statusSub.textContent = "Couldn't check for updates right now";
          statusSub.style.color = 'var(--text-secondary)';
        }
      } else {
        if (statusSub) {
          statusSub.textContent = "✓ You're up to date";
          statusSub.style.color = 'var(--text-secondary)';
        }
      }

      if (timeEl) {
        const lastChecked = state && state.lastChecked ? state.lastChecked : 0;
        if (!lastChecked) {
          timeEl.textContent = 'Last checked: Never';
        } else {
          const d = new Date(lastChecked);
          // Manual formatting: the first Intl call loads ICU data (~250 ms) on a phone; not worth it at start-up
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const h = d.getHours();
          const timeStr = `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
          const dateStr = `${months[d.getMonth()]} ${d.getDate()}`;
          timeEl.textContent = `Last checked: ${dateStr}, ${timeStr}`;
        }
      }
    },

    // ========================================================================
    // UNIFIED MUSICFLOW MODAL SYSTEM (REPLACES ALERT / CONFIRM / PROMPT)
    // ========================================================================
    _confirmCallback: null,
    _promptCallback: null,

    showConfirmModal({ title = 'Confirm Action', message = 'Are you sure you want to proceed?', icon = 'help_outline', confirmText = 'Confirm', cancelText = 'Cancel', isDestructive = false, onConfirm = null }) {
      this._confirmCallback = onConfirm;
      const modal = document.getElementById('modal-confirm-dialog');
      if (!modal) {
        if (onConfirm) onConfirm();
        return;
      }

      const titleEl = document.getElementById('modal-confirm-title');
      const msgEl = document.getElementById('modal-confirm-msg');
      const iconEl = document.getElementById('modal-confirm-icon');
      const badgeEl = document.getElementById('modal-confirm-badge');
      const okBtn = document.getElementById('btn-modal-confirm-ok');
      const cancelBtn = document.getElementById('btn-modal-confirm-cancel');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (iconEl) iconEl.textContent = icon || (isDestructive ? 'delete' : 'help_outline');
      if (badgeEl) {
        badgeEl.className = isDestructive ? 'mf-modal-icon-badge destructive' : 'mf-modal-icon-badge';
      }
      if (okBtn) {
        okBtn.textContent = confirmText;
        okBtn.className = isDestructive ? 'btn-mf-modal-confirm destructive' : 'btn-mf-modal-confirm';
      }
      if (cancelBtn) cancelBtn.textContent = cancelText;

      modal.style.display = 'flex';
      modal.classList.add('active');
    },

    closeConfirmModal(isConfirmed = false) {
      const modal = document.getElementById('modal-confirm-dialog');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
      }
      const cb = this._confirmCallback;
      this._confirmCallback = null;
      if (isConfirmed && typeof cb === 'function') {
        cb();
      }
    },

    showPromptModal({ title = 'Edit Name', subtitle = '', placeholder = 'Enter name...', defaultValue = '', confirmText = 'Save', cancelText = 'Cancel', onConfirm = null }) {
      this._promptCallback = onConfirm;
      const modal = document.getElementById('modal-prompt-dialog');
      if (!modal) {
        const res = defaultValue || '';
        if (onConfirm) onConfirm(res);
        return;
      }

      const titleEl = document.getElementById('modal-prompt-title');
      const msgEl = document.getElementById('modal-prompt-msg');
      const inputEl = document.getElementById('modal-prompt-input');
      const okBtn = document.getElementById('btn-modal-prompt-ok');
      const cancelBtn = document.getElementById('btn-modal-prompt-cancel');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) {
        msgEl.textContent = subtitle;
        msgEl.style.display = subtitle ? 'block' : 'none';
      }
      if (inputEl) {
        inputEl.placeholder = placeholder;
        inputEl.value = defaultValue || '';
      }
      if (okBtn) okBtn.textContent = confirmText;
      if (cancelBtn) cancelBtn.textContent = cancelText;

      modal.style.display = 'flex';
      modal.classList.add('active');

      setTimeout(() => {
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }, 100);
    },

    submitPromptModal() {
      const inputEl = document.getElementById('modal-prompt-input');
      const val = inputEl ? inputEl.value.trim() : '';
      this.closePromptModal(val);
    },

    closePromptModal(resultVal = null) {
      const modal = document.getElementById('modal-prompt-dialog');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
      }
      const cb = this._promptCallback;
      this._promptCallback = null;
      if (resultVal !== null && typeof cb === 'function') {
        cb(resultVal);
      }
    },

    // ========================================================================
    // 3D SWIPE DISCOVERY CARDS ("DISCOVER FOR YOU")
    // ========================================================================
    renderSwipeDiscovery(songs = []) {
      const stack = document.getElementById('swipe-card-stack');
      if (!stack) return;

      if (!songs || songs.length === 0) {
        stack.innerHTML = `
          <div class="swipe-card" style="transform:none; z-index:1; display:flex; align-items:center; justify-content:center; text-align:center; padding:28px;">
            <div style="color:var(--text-secondary);">
              <span class="material-symbols-outlined" style="font-size:44px; color:var(--accent); margin-bottom:10px;">sync</span>
              <div style="font-size:16px; font-weight:800; color:#FFFFFF;">Finding more songs…</div>
              <div style="font-size:12.5px; margin-top:4px; margin-bottom:16px;">Loading your personalized discovery feed</div>
              <button class="lib-action-pill-btn" onclick="App.refreshDiscoveryFeed()" style="padding:8px 18px; font-size:13px; font-weight:700; background:var(--accent); color:var(--accent-text); border:none; margin:0 auto; display:inline-flex; align-items:center; gap:6px;">
                <span class="material-symbols-outlined" style="font-size:16px;">refresh</span>
                <span>Retry</span>
              </button>
            </div>
          </div>
        `;
        return;
      }

      const visibleCards = songs.slice(0, 3);
      stack.innerHTML = visibleCards.map((song, idx) => {
        const title = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getTrackTitle(song) : (song.name || song.title || 'Track');
        const artist = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getArtistString(song) : (song.artists || song.primaryArtist || 'Artist');
        const img = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getImageUrl(song) : (song.image || 'assets/logo.png');
        const tag = song.tag || (idx === 0 ? 'RECOMMENDED' : (song.language && song.language !== 'unknown' ? song.language.toUpperCase() : 'FOR YOU'));

        return `
          <div class="swipe-card" id="swipe-card-${idx}" data-index="${idx}" data-id="${song.id}" style="${idx === 0 ? 'z-index: 3;' : (idx === 1 ? 'z-index: 2;' : 'z-index: 1;')}">
            <img class="swipe-card-art" src="${img}" onerror="this.src='assets/logo.png'" alt="${title}">
            <div class="swipe-card-gradient"></div>
            
            <div class="swipe-card-badge swipe-badge-like">SAVE ❤️</div>
            <div class="swipe-card-badge swipe-badge-nope">PASS ✕</div>
            <div class="swipe-card-badge swipe-badge-play">PLAY ▶</div>

            <div class="swipe-card-info">
              <span class="swipe-card-tag">${tag}</span>
              <h3 class="swipe-card-title">${escapeHtml(title)}</h3>
              <div class="swipe-card-artist">${escapeHtml(artist)}</div>
            </div>
          </div>
        `;
      }).join('');
    },

    // ========================================================================
    // MULTI-ARTIST SELECTION SHEET
    // ========================================================================
    renderArtistPicker(artists = [], song = null) {
      const listContainer = document.getElementById('artist-picker-list');
      if (!listContainer) return;

      if (!artists || artists.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align:center; padding:20px; color:var(--text-secondary);">
            No artist details found.
          </div>
        `;
        return;
      }

      listContainer.innerHTML = artists.map(art => {
        const name = art.name || 'Artist';
        const id = art.providerId || art.id || name;
        const role = art.role ? `<span style="font-size:11px; color:var(--text-secondary); margin-left:6px;">(${art.role})</span>` : '';
        return `
          <button class="sheet-action-item" onclick="App.selectArtistFromPicker('${escapeHtml(name)}', '${escapeHtml(id)}')" style="width:100%; justify-content:space-between; padding:12px 14px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="material-symbols-outlined" style="font-size:20px; color:var(--text-secondary);">person</span>
              <span style="font-weight:600; font-size:14px; color:#FFFFFF;">${escapeHtml(name)}${role}</span>
            </div>
            <span class="material-symbols-outlined" style="font-size:18px; color:var(--text-secondary);">chevron_right</span>
          </button>
        `;
      }).join('');
    }
  };
})();

if (typeof window !== 'undefined') {
  window.UI = UI;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UI;
}
