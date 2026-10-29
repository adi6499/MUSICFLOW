// ==========================================================================
// MUSICFLOW — YOUTUBE MUSIC INNERTUBE SERVICE (Server-Side)
// MIT-compliant YouTube Music Innertube API adapter with in-memory caching.
// ==========================================================================

const YTM_BASE_URL = 'https://music.youtube.com/youtubei/v1';

const YTM_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'X-YouTube-Client-Name': '67',
  'X-YouTube-Client-Version': '1.20240101.01.00',
  'Origin': 'https://music.youtube.com',
  'Referer': 'https://music.youtube.com/'
};

const YTM_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240101.01.00',
    hl: 'en',
    gl: 'US'
  }
};

// In-Memory Cache with TTL (5 minutes)
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getFromCache(key) {
  const item = cache.get(key);
  if (item && (Date.now() - item.time < CACHE_TTL_MS)) {
    return item.data;
  }
  return null;
}

function setInCache(key, data) {
  cache.set(key, { data, time: Date.now() });
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// Utility: Clean image URL to high resolution
function getHighResImage(thumbnails) {
  if (!thumbnails || !Array.isArray(thumbnails) || thumbnails.length === 0) {
    return 'assets/logo.png';
  }
  const last = thumbnails[thumbnails.length - 1];
  let url = last?.url || 'assets/logo.png';
  if (url.startsWith('//')) url = 'https:' + url;
  // Upgrade googleusercontent / ytimg size params to 500x500
  url = url.replace(/=w\d+-h\d+.*$/, '=w500-h500-l90-rj');
  return url;
}

// Utility: Parse duration string (e.g. "3:45", "1:02:15") to seconds
function parseDurationSec(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') return 0;
  const parts = durationStr.split(':').map(p => parseInt(p.trim(), 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

// Utility: Extract playlist ID from various URL formats
function extractPlaylistId(input) {
  if (!input) return '';
  const str = String(input).trim();
  const listMatch = str.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  if (listMatch && listMatch[1]) return listMatch[1];
  const browseMatch = str.match(/(?:browse\/|browse_id=)([a-zA-Z0-9_-]+)/i);
  if (browseMatch && browseMatch[1]) return browseMatch[1];
  const playlistPathMatch = str.match(/(?:playlist\/)([a-zA-Z0-9_-]+)/i);
  if (playlistPathMatch && playlistPathMatch[1]) return playlistPathMatch[1];
  if (/^[a-zA-Z0-9_-]+$/.test(str) && (str.startsWith('PL') || str.startsWith('VL') || str.startsWith('OLAK') || str.startsWith('RD') || str.startsWith('MPRE'))) {
    return str;
  }
  if (/^[a-zA-Z0-9_-]+$/.test(str) && str.length > 11) return str;
  return str;
}

// Utility: Extract single Video ID from URL or string
function extractVideoId(input) {
  if (!input) return '';
  const str = String(input).trim();
  const shortMatch = str.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
  if (shortMatch && shortMatch[1]) return shortMatch[1];
  const vMatch = str.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
  if (vMatch && vMatch[1]) return vMatch[1];
  const shortsMatch = str.match(/shorts\/([a-zA-Z0-9_-]{11})/i);
  if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
  const embedMatch = str.match(/embed\/([a-zA-Z0-9_-]{11})/i);
  if (embedMatch && embedMatch[1]) return embedMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(str) && !str.startsWith('VL') && !str.startsWith('PL') && !str.startsWith('RD') && !str.startsWith('OL')) return str;
  return '';
}

const _pendingHttpRequests = {};
if (typeof window !== 'undefined') {
  window._onNativeHttpResponse = function(requestId, response) {
    if (_pendingHttpRequests[requestId]) {
      try {
        if (response && response.base64Data && !response.data) {
          try {
            const binaryStr = atob(response.base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            response.data = new TextDecoder('utf-8').decode(bytes);
          } catch (_) {
            response.data = atob(response.base64Data);
          }
        }
        _pendingHttpRequests[requestId](response);
      } catch (e) {
        console.warn('[YouTubeMusicService] _onNativeHttpResponse error:', e);
        _pendingHttpRequests[requestId](response);
      }
    }
  };
}

/**
 * Cross-platform fetch helper that uses native bridges on iOS/Android to bypass CORS.
 * On desktop, uses standard fetch.
 */
// ---------------------------------------------------------------------------
// Website helper: in a browser (no native bridge) YouTube's endpoints are blocked by CORS, so the
// request is handed to the site's own /api/yt-proxy function (Vercel), which performs it server-side.
// Remembered as unavailable after the first 404 (GitHub Pages, plain static hosts).
// ---------------------------------------------------------------------------
let _webProxyState = null;   // null = unknown, true = works, false = not there
function isPlainBrowser() {
  if (typeof window === 'undefined' || !window.document) return false;
  if (window.AndroidMediaBridge && typeof window.AndroidMediaBridge.executeHttpRequest === 'function') return false;
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeMedia) return false;
  return true;
}
function isProxyableHost(targetUrl) {
  try {
    const h = new URL(targetUrl, window.location.href).hostname;
    if (h === window.location.hostname) return false;
    return /youtube\.com$|ytimg\.com$|invidious|piped|nadeko\.net$|nerdvpn\.de$|artemislena\.eu$|jing\.rocks$|privacyredirect\.com$|yewtu\.be$/i.test(h);
  } catch (_) { return false; }
}
async function webProxyFetchJSON(targetUrl, method, headers, body, timeoutMs) {
  if (!isPlainBrowser() || _webProxyState === false || !isProxyableHost(targetUrl)) return undefined;
  try {
    const res = await fetch('/api/yt-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, method: method || 'GET', headers: headers || {}, body: body || '' }),
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs || 15000) : undefined
    });
    if (res.status === 404 || res.status === 405) { _webProxyState = false; return undefined; }
    const resObj = await res.json().catch(() => null);
    if (!resObj || typeof resObj.data !== 'string') return undefined;
    _webProxyState = true;
    if (!resObj.success) throw new Error(`HTTP ${resObj.status || 500}`);
    return JSON.parse(resObj.data);
  } catch (e) {
    if (_webProxyState === true) throw e;
    return undefined;
  }
}

async function nativeFetchJSON(fetchUrl, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = options.headers || {};
  const body = options.body || '';
  const timeoutMs = options.timeout || 8000;

  // iOS Native URLSession Bridge
  if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.nativeMedia) {
    const msgPayload = {
      action: 'executeHttpRequest',
      url: fetchUrl,
      method: method,
      headers: headers,
      body: body
    };

    try {
      const postPromise = window.webkit.messageHandlers.nativeMedia.postMessage(msgPayload);
      if (postPromise && typeof postPromise.then === 'function') {
        const resObj = await Promise.race([
          postPromise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
        ]);
        if (resObj && resObj.base64Data) {
          const binaryStr = atob(resObj.base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
          return JSON.parse(new TextDecoder('utf-8').decode(bytes));
        } else if (resObj && resObj.data) {
          return typeof resObj.data === 'string' ? JSON.parse(resObj.data) : resObj.data;
        }
      } else {
        // Legacy callback bridge
        const result = await new Promise((resolve, reject) => {
          const reqId = `nf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          const timer = setTimeout(() => { delete _pendingHttpRequests[reqId]; reject(new Error('timeout')); }, timeoutMs);
          _pendingHttpRequests[reqId] = (resObj) => {
            clearTimeout(timer);
            delete _pendingHttpRequests[reqId];
            if (resObj && resObj.success && (resObj.data || resObj.base64Data)) {
              if (resObj.base64Data) {
                try {
                  const bs = atob(resObj.base64Data);
                  const bt = new Uint8Array(bs.length);
                  for (let i = 0; i < bs.length; i++) bt[i] = bs.charCodeAt(i);
                  resolve(JSON.parse(new TextDecoder('utf-8').decode(bt)));
                } catch (_) { resolve(JSON.parse(atob(resObj.base64Data))); }
              } else {
                resolve(typeof resObj.data === 'string' ? JSON.parse(resObj.data) : resObj.data);
              }
            } else {
              reject(new Error(resObj?.error || 'native fetch failed'));
            }
          };
          window.webkit.messageHandlers.nativeMedia.postMessage({ ...msgPayload, requestId: reqId });
        });
        if (result) return result;
      }
    } catch (e) {
      // Fall through to standard fetch
    }
  }

  // Android Native OkHttp Bridge
  if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.executeHttpRequest === 'function') {
    try {
      const resStr = window.AndroidMediaBridge.executeHttpRequest(fetchUrl, method, JSON.stringify(headers), body);
      const resObj = typeof resStr === 'string' ? JSON.parse(resStr) : resStr;
      if (resObj.success && resObj.data) {
        return typeof resObj.data === 'string' ? JSON.parse(resObj.data) : resObj.data;
      }
    } catch (_) {}
  }

  // Website helper (browsers): YouTube and its front-ends go through the site's own function
  const viaProxy = await webProxyFetchJSON(fetchUrl, method, headers, body, timeoutMs);
  if (viaProxy !== undefined) return viaProxy;

  // Standard fetch (Desktop / environments without CORS issues)
  const res = await fetch(fetchUrl, {
    method: method,
    headers: headers,
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs) : undefined
  });
  if (res.ok) return await res.json();
  throw new Error(`HTTP ${res.status}`);
}

/**
 * Execute YouTube Music Innertube API request
 */
async function callInnertube(endpoint, body) {
  const url = `${YTM_BASE_URL}/${endpoint}`;
  const payload = {
    context: YTM_CONTEXT,
    ...body
  };

  // 1. Android Native OkHttp Bridge (bypasses WebView CORS/origin restrictions)
  if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.executeHttpRequest === 'function') {
    try {
      const resStr = window.AndroidMediaBridge.executeHttpRequest(
        url,
        'POST',
        JSON.stringify(YTM_HEADERS),
        JSON.stringify(payload)
      );
      const resObj = JSON.parse(resStr || '{}');
      if (resObj.success && resObj.data) {
        return JSON.parse(resObj.data);
      } else if (resObj.status && resObj.status !== 200) {
        console.warn(`[YouTubeMusicService] Android OkHttp returned status ${resObj.status}`);
      }
    } catch (bridgeErr) {
      console.warn('[YouTubeMusicService] Android bridge fetch fallback:', bridgeErr.message);
    }
  }

  // 2. iOS Native URLSession Bridge (bypasses WKWebView CORS/origin restrictions)
  if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.nativeMedia) {
    try {
      const msgPayload = {
        action: 'executeHttpRequest',
        url: url,
        method: 'POST',
        headers: YTM_HEADERS,
        body: JSON.stringify(payload)
      };

      let nativeResult = null;

      // Check if postMessage returns a Promise (iOS 14+ WKScriptMessageHandlerWithReply)
      const postPromise = window.webkit.messageHandlers.nativeMedia.postMessage(msgPayload);
      if (postPromise && typeof postPromise.then === 'function') {
        const resObj = await Promise.race([
          postPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('iOS native HTTP request timed out')), 15000))
        ]);
        if (resObj && resObj.base64Data) {
          try {
            const binaryStr = atob(resObj.base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            const jsonText = new TextDecoder('utf-8').decode(bytes);
            nativeResult = JSON.parse(jsonText);
          } catch (_) {
            nativeResult = JSON.parse(atob(resObj.base64Data));
          }
        } else if (resObj && resObj.data) {
          nativeResult = typeof resObj.data === 'string' ? JSON.parse(resObj.data) : resObj.data;
        }
      } else {
        // Fallback for older WebKit versions using _onNativeHttpResponse
        nativeResult = await new Promise((resolve, reject) => {
          const reqId = `ytm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          const timer = setTimeout(() => {
            delete _pendingHttpRequests[reqId];
            reject(new Error('iOS native HTTP request timed out'));
          }, 15000);

          _pendingHttpRequests[reqId] = (resObj) => {
            clearTimeout(timer);
            delete _pendingHttpRequests[reqId];
            if (resObj && resObj.success && (resObj.data || resObj.base64Data)) {
              if (resObj.data) {
                try {
                  resolve(typeof resObj.data === 'string' ? JSON.parse(resObj.data) : resObj.data);
                } catch (_) {
                  resolve(resObj.data);
                }
              } else if (resObj.base64Data) {
                try {
                  const binaryStr = atob(resObj.base64Data);
                  const bytes = new Uint8Array(binaryStr.length);
                  for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                  }
                  resolve(JSON.parse(new TextDecoder('utf-8').decode(bytes)));
                } catch (_) {
                  resolve(JSON.parse(atob(resObj.base64Data)));
                }
              }
            } else {
              reject(new Error(resObj?.error || `Native HTTP status ${resObj?.status || 500}`));
            }
          };

          window.webkit.messageHandlers.nativeMedia.postMessage({
            ...msgPayload,
            requestId: reqId
          });
        });
      }

      if (nativeResult) return nativeResult;
    } catch (iosErr) {
      console.warn('[YouTubeMusicService] iOS native bridge notice:', iosErr.message);
    }
  }

  // 3. Desktop / Web Local Dev Server Proxy (bypasses browser CORS on http://localhost:3000)
  if (typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    try {
      const proxyUrl = `/api/proxy/innertube?endpoint=${endpoint}`;
      const proxyRes = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (proxyRes.ok) {
        return await proxyRes.json();
      } else {
        console.warn(`[YouTubeMusicService] Local proxy HTTP ${proxyRes.status} for ${endpoint}`);
        return null;
      }
    } catch (proxyErr) {
      console.warn('[YouTubeMusicService] Local proxy notice:', proxyErr.message);
      return null;
    }
  }

  // 4. Website helper (Vercel function) for browsers
  try {
    const viaProxy = await webProxyFetchJSON(url, 'POST', YTM_HEADERS, JSON.stringify(payload), 15000);
    if (viaProxy !== undefined) return viaProxy;
  } catch (proxyErr) {
    console.warn('[YouTubeMusicService] Website helper notice:', proxyErr.message);
  }

  // In browser context, direct fetch to music.youtube.com triggers CORS violations
  if (typeof window !== 'undefined' && window.document && window.location && window.location.protocol.startsWith('http')) {
    console.warn(`[YouTubeMusicService] Direct browser fetch to ${endpoint} skipped to prevent CORS violations`);
    return null;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: YTM_HEADERS,
    body: JSON.stringify(payload),
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(9000) : undefined
  });

  if (!res.ok) {
    throw new Error(`Innertube HTTP ${res.status} for ${endpoint}`);
  }

  return res.json();
}
/**
 * Recursively extract all playlist and song items from Innertube browse payload
 */
function extractItemsFromBrowseData(data) {
  if (!data) return [];
  const items = [];

  function traverse(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const el of obj) traverse(el);
      return;
    }

    if (obj.musicResponsiveListItemRenderer || obj.playlistVideoRenderer || obj.videoRenderer || obj.compactVideoRenderer || obj.musicTwoRowItemRenderer) {
      items.push(obj);
      return;
    }

    if (obj.musicPlaylistShelfRenderer && Array.isArray(obj.musicPlaylistShelfRenderer.contents)) {
      for (const it of obj.musicPlaylistShelfRenderer.contents) items.push(it);
      return;
    }

    if (obj.playlistVideoListRenderer && Array.isArray(obj.playlistVideoListRenderer.contents)) {
      for (const it of obj.playlistVideoListRenderer.contents) items.push(it);
      return;
    }

    if (obj.musicShelfRenderer && Array.isArray(obj.musicShelfRenderer.contents)) {
      for (const it of obj.musicShelfRenderer.contents) items.push(it);
      return;
    }

    for (const key of Object.keys(obj)) {
      if (key !== 'responseContext' && key !== 'trackingParams') {
        traverse(obj[key]);
      }
    }
  }

  traverse(data);
  return items;
}

/**
 * Parse an item renderer (Song, Video, Artist, Album, Playlist)
 */
function parseMusicItem(item) {
  if (!item) return null;

  // 1. YouTube Music Responsive List Item
  if (item.musicResponsiveListItemRenderer || item.musicCardShelfRenderer) {
    const renderer = item.musicResponsiveListItemRenderer || item.musicCardShelfRenderer;
    const titleRuns = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const title = titleRuns?.[0]?.text || renderer.title?.runs?.[0]?.text || '';
    const videoId = renderer.playlistItemData?.videoId || 
      titleRuns?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
      renderer.navigationEndpoint?.watchEndpoint?.videoId || '';

    const flex1Runs = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
    let artist = '';
    let album = '';
    let duration = '';
    let itemType = 'song';

    const texts = flex1Runs.map(r => r.text).filter(t => t && t !== ' • ' && t !== '•');
    if (texts.length > 0) {
      const firstLower = texts[0].toLowerCase();
      if (firstLower === 'song' || firstLower === 'video' || firstLower === 'artist' || firstLower === 'album' || firstLower === 'playlist') {
        itemType = firstLower;
        artist = texts[1] || '';
        album = texts[2] || '';
        duration = texts[3] || '';
      } else {
        artist = texts[0] || '';
        album = texts[1] || '';
        duration = texts[2] || '';
      }
    }

    const artistRun = flex1Runs.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
    const artistBrowseId = artistRun?.navigationEndpoint?.browseEndpoint?.browseId || '';
    const albumRun = flex1Runs.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'));
    const albumBrowseId = albumRun?.navigationEndpoint?.browseEndpoint?.browseId || '';
    const thumbs = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const image = getHighResImage(thumbs);

    return {
      id: `yt_${videoId || Math.random().toString(36).substring(2, 9)}`,
      videoId: videoId,
      name: title,
      title: title,
      artists: artist || 'YouTube Artist',
      primaryArtist: artist || 'YouTube Artist',
      artistBrowseId: artistBrowseId,
      album: album || title,
      albumBrowseId: albumBrowseId,
      duration: parseDurationSec(duration),
      durationSeconds: parseDurationSec(duration),
      durationText: duration,
      image: image,
      type: itemType,
      provider: 'youtube_music',
      providerId: videoId,
      source: 'youtube_music',
      sourceId: videoId,
      isPlayable: true,
      metadataAvailable: true,
      playbackAvailable: true
    };
  }

  // 2. Standard YouTube Playlist Video Renderer (playlistVideoRenderer / videoRenderer / compactVideoRenderer)
  if (item.playlistVideoRenderer || item.videoRenderer || item.compactVideoRenderer) {
    const renderer = item.playlistVideoRenderer || item.videoRenderer || item.compactVideoRenderer;
    const title = renderer.title?.runs?.[0]?.text || renderer.title?.simpleText || 'YouTube Track';
    const videoId = renderer.videoId || renderer.navigationEndpoint?.watchEndpoint?.videoId || '';
    const artist = renderer.shortBylineText?.runs?.[0]?.text || renderer.ownerText?.runs?.[0]?.text || 'YouTube Artist';
    const duration = renderer.lengthSeconds ? Number(renderer.lengthSeconds) : parseDurationSec(renderer.lengthText?.simpleText || renderer.lengthText?.runs?.[0]?.text || '');
    const thumbs = renderer.thumbnail?.thumbnails;
    const image = getHighResImage(thumbs) || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : 'assets/logo.png');

    return {
      id: `yt_${videoId || Math.random().toString(36).substring(2, 9)}`,
      videoId: videoId,
      name: title,
      title: title,
      artists: artist,
      primaryArtist: artist,
      album: title,
      duration: duration,
      durationSeconds: duration,
      durationText: `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`,
      image: image,
      type: 'song',
      provider: 'youtube_music',
      providerId: videoId,
      source: 'youtube_music',
      sourceId: videoId,
      isPlayable: true,
      metadataAvailable: true,
      playbackAvailable: true
    };
  }

  return null;
}

const YouTubeMusicService = {
  /**
   * Unified Search across YouTube Music catalog
   */
  async search(query, limit = 30) {
    const cleanQ = (query || '').trim();
    if (!cleanQ) return { songs: [], artists: [], albums: [], playlists: [] };

    const cacheKey = `search_${cleanQ}_${limit}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await callInnertube('search', { query: cleanQ });
      const sections = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

      const songs = [];
      const artists = [];
      const albums = [];
      const playlists = [];

      for (const sec of sections) {
        // Direct card shelf (Top result)
        if (sec.musicCardShelfRenderer) {
          const topItem = parseMusicItem({ musicCardShelfRenderer: sec.musicCardShelfRenderer });
          if (topItem && topItem.videoId) songs.push(topItem);
          const shelfContents = sec.musicCardShelfRenderer.contents || [];
          shelfContents.forEach(c => {
            const parsed = parseMusicItem(c);
            if (parsed && parsed.videoId) songs.push(parsed);
          });
        }

        // Section list items
        const itemSec = sec.itemSectionRenderer?.contents?.[0];
        if (itemSec?.musicResponsiveListItemRenderer) {
          const parsed = parseMusicItem(itemSec);
          if (parsed) {
            if (parsed.type === 'artist') artists.push(parsed);
            else if (parsed.type === 'album') albums.push(parsed);
            else if (parsed.type === 'playlist') playlists.push(parsed);
            else if (parsed.videoId) songs.push(parsed);
          }
        }

        if (itemSec?.musicShelfRenderer) {
          const contents = itemSec.musicShelfRenderer.contents || [];
          contents.forEach(c => {
            const parsed = parseMusicItem(c);
            if (parsed && parsed.videoId) songs.push(parsed);
          });
        }
      }

      // Deduplicate songs by videoId
      const uniqueSongs = [];
      const seenVideoIds = new Set();
      for (const s of songs) {
        if (s.videoId && !seenVideoIds.has(s.videoId)) {
          seenVideoIds.add(s.videoId);
          uniqueSongs.push(s);
        }
      }

      const result = {
        songs: uniqueSongs.slice(0, limit),
        artists: artists.slice(0, 10),
        albums: albums.slice(0, 10),
        playlists: playlists.slice(0, 10)
      };

      setInCache(cacheKey, result);
      return result;
    } catch (err) {
      console.warn('[YouTubeMusicService] search failed:', err.message);
      return { songs: [], artists: [], albums: [], playlists: [] };
    }
  },

  /**
   * Get Automix Radio Candidates for a seed track
   */
  async getRadioCandidates(videoId, seedTitle = '', seedArtist = '', limit = 25) {
    let resolvedVideoId = videoId;
    const isValidYTVideoId = typeof resolvedVideoId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(resolvedVideoId);
    if (!isValidYTVideoId) {
      resolvedVideoId = null;
    }

    // If videoId is missing or non-YT, resolve by searching seed title + artist
    if (!resolvedVideoId && (seedTitle || seedArtist)) {
      const searchRes = await this.search(`${seedTitle} ${seedArtist}`.trim(), 3);
      if (searchRes && searchRes.songs && searchRes.songs.length > 0) {
        resolvedVideoId = searchRes.songs[0].videoId;
      }
    }

    if (!resolvedVideoId) {
      // Fallback directly to catalog search for artist/title tracks
      if (seedTitle || seedArtist) {
        try {
          const searchRes = await this.search(`${seedArtist || seedTitle}`.trim(), limit);
          if (searchRes && searchRes.songs && searchRes.songs.length > 0) {
            return { seedVideoId: null, candidates: searchRes.songs.slice(0, limit) };
          }
        } catch (_) {}
      }
      return { candidates: [], resolvedVideoId: null };
    }

    const cacheKey = `radio_${resolvedVideoId}_${limit}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
      // Automix playlist ID format: RDAMVM + videoId
      const data = await callInnertube('next', {
        videoId: resolvedVideoId,
        playlistId: `RDAMVM${resolvedVideoId}`
      });

      const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
      const queueItems = tabs[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || [];

      const candidates = [];
      for (const item of queueItems) {
        const it = item.playlistPanelVideoRenderer || item.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
        if (!it || !it.videoId) continue;

        const title = it.title?.runs?.[0]?.text || '';
        const byline = it.shortBylineText?.runs?.[0]?.text || '';
        const durationStr = it.lengthText?.runs?.[0]?.text || '';
        const thumbs = it.thumbnail?.thumbnails || [];

        candidates.push({
          id: `yt_${it.videoId}`,
          videoId: it.videoId,
          name: title,
          title: title,
          artists: byline,
          primaryArtist: byline.split(/[,&/]/)[0].trim(),
          duration: parseDurationSec(durationStr),
          image: getHighResImage(thumbs),
          provider: 'youtube_music',
          providerId: it.videoId,
          metadataAvailable: true,
          playbackAvailable: false
        });
      }

      // If automix returned empty, fallback to catalog search
      if (candidates.length === 0 && (seedTitle || seedArtist)) {
        const searchFallback = await this.search(`${seedArtist || seedTitle}`.trim(), limit);
        if (searchFallback && searchFallback.songs && searchFallback.songs.length > 0) {
          for (const s of searchFallback.songs) {
            if (s.videoId && s.videoId !== resolvedVideoId) {
              candidates.push(s);
            }
          }
        }
      }

      const result = {
        seedVideoId: resolvedVideoId,
        candidates: candidates.slice(0, limit)
      };

      setInCache(cacheKey, result);
      return result;
    } catch (err) {
      console.warn('[YouTubeMusicService] getRadioCandidates failed:', err.message);
      if (seedTitle || seedArtist) {
        try {
          const searchFallback = await this.search(`${seedArtist || seedTitle}`.trim(), limit);
          if (searchFallback && searchFallback.songs) {
            return { seedVideoId: resolvedVideoId, candidates: searchFallback.songs.slice(0, limit) };
          }
        } catch (_) {}
      }
      return { seedVideoId: resolvedVideoId, candidates: [] };
    }
  },

  /**
   * Get Artist Profile & Discography
   */
  async getArtist(browseId, artistName = '') {
    let targetBrowseId = browseId;
    if (!targetBrowseId && artistName) {
      const searchRes = await this.search(artistName, 5);
      if (searchRes.artists.length > 0 && searchRes.artists[0].artistBrowseId) {
        targetBrowseId = searchRes.artists[0].artistBrowseId;
      }
    }

    if (!targetBrowseId) return { artist: null };

    const cacheKey = `artist_${targetBrowseId}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await callInnertube('browse', { browseId: targetBrowseId });
      const name = data.header?.musicImmersiveHeaderRenderer?.title?.runs?.[0]?.text || artistName || 'Artist';
      const listeners = data.header?.musicImmersiveHeaderRenderer?.description?.runs?.[0]?.text || '';
      const heroThumbs = data.header?.musicImmersiveHeaderRenderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];

      const sections = data.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
      const topSongs = [];
      const albums = [];

      for (const sec of sections) {
        const k = Object.keys(sec)[0];
        const shelf = sec[k];
        const title = (shelf?.title?.runs?.[0]?.text || shelf?.header?.musicHeaderRenderer?.title?.runs?.[0]?.text || '').toLowerCase();

        if (title.includes('song')) {
          const contents = shelf?.contents || [];
          contents.forEach(c => {
            const parsed = parseMusicItem(c);
            if (parsed && parsed.videoId) topSongs.push(parsed);
          });
        } else if (title.includes('album') || title.includes('single')) {
          const items = shelf?.contents || shelf?.items || [];
          items.forEach(c => {
            const parsed = parseMusicItem(c);
            if (parsed) albums.push(parsed);
          });
        }
      }

      const result = {
        artist: {
          id: targetBrowseId,
          name: name,
          image: getHighResImage(heroThumbs),
          listeners: listeners,
          topSongs: topSongs.slice(0, 10),
          albums: albums.slice(0, 10)
        }
      };

      setInCache(cacheKey, result);
      return result;
    } catch (err) {
      console.warn('[YouTubeMusicService] getArtist failed:', err.message);
      return { artist: null };
    }
  },

  /**
   * Get Album Details & Tracklist
   */
  async getAlbum(browseId) {
    if (!browseId) return { album: null };

    const cacheKey = `album_${browseId}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await callInnertube('browse', { browseId });
      const header = data.header?.musicDetailHeaderRenderer;
      const title = header?.title?.runs?.[0]?.text || 'Album';
      const subtitle = header?.subtitle?.runs?.map(r => r.text).join('') || '';
      const thumbs = header?.thumbnail?.croppedMusicThumbnailRenderer?.thumbnail?.thumbnails || [];

      const sec = data.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents?.[0];
      const items = sec?.musicShelfRenderer?.contents || [];
      const songs = items.map(parseMusicItem).filter(Boolean);

      const result = {
        album: {
          id: browseId,
          name: title,
          title: title,
          subtitle: subtitle,
          image: getHighResImage(thumbs),
          songs: songs
        }
      };

      setInCache(cacheKey, result);
      return result;
    } catch (err) {
      console.warn('[YouTubeMusicService] getAlbum failed:', err.message);
      return { album: null };
    }
  },

  /**
   * Get Playlist Details & Tracks
   */
  async getPlaylist(playlistUrlOrId) {
    const rawId = extractPlaylistId(playlistUrlOrId);
    if (!rawId) return { playlist: null };

    const browseId = rawId.startsWith('VL') ? rawId : `VL${rawId}`;
    const cacheKey = `pl_${browseId}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    // Strategy 0: Native Android Bridge (fastest, unblocked OkHttp / InnerTube)
    if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.resolveYouTubePlaylist === 'function') {
      try {
        const nativeResult = await new Promise((resolve) => {
          const callbackId = 'yt_pl_' + rawId + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
          const timeout = setTimeout(() => {
            if (window.__ytPlaylistCallbacks) delete window.__ytPlaylistCallbacks[callbackId];
            resolve(null);
          }, 15000);

          if (!window.__ytPlaylistCallbacks) window.__ytPlaylistCallbacks = {};
          window.__ytPlaylistCallbacks[callbackId] = (data) => {
            clearTimeout(timeout);
            delete window.__ytPlaylistCallbacks[callbackId];
            resolve(data);
          };

          window.__onYtPlaylistResolved = (cbId, data) => {
            if (window.__ytPlaylistCallbacks && window.__ytPlaylistCallbacks[cbId]) {
              window.__ytPlaylistCallbacks[cbId](data);
            }
          };

          window.AndroidMediaBridge.resolveYouTubePlaylist(rawId, callbackId);
        });

        if (nativeResult && nativeResult.success) {
          let songs = [];
          let playlistTitle = nativeResult.name || 'YouTube Playlist';
          let playlistImage = 'assets/logo.png';

          if (Array.isArray(nativeResult.songs) && nativeResult.songs.length > 0) {
            songs = nativeResult.songs.map(s => ({
              id: s.id || `yt_${s.videoId}`,
              videoId: s.videoId,
              name: s.name || s.title || 'YouTube Track',
              title: s.title || s.name || 'YouTube Track',
              artists: s.artists || s.primaryArtist || 'YouTube Artist',
              primaryArtist: s.primaryArtist || s.artists || 'YouTube Artist',
              album: s.album || s.name || 'YouTube Track',
              duration: Number(s.duration || s.durationSeconds || 0),
              durationSeconds: Number(s.durationSeconds || s.duration || 0),
              image: s.image || (s.videoId ? `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg` : 'assets/logo.png'),
              provider: 'youtube_music',
              providerId: s.videoId,
              source: 'youtube_music',
              sourceId: s.videoId,
              isPlayable: true,
              metadataAvailable: true,
              playbackAvailable: true
            }));
            playlistImage = songs[0]?.image || 'assets/logo.png';
          } else if (nativeResult.data) {
            const data = nativeResult.data;
            const header = data.header?.musicDetailHeaderRenderer 
              || data.header?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicDetailHeaderRenderer
              || data.header?.playlistHeaderRenderer;
            playlistTitle = header?.title?.runs?.[0]?.text || header?.title?.simpleText || playlistTitle;
            const thumbs = header?.thumbnail?.croppedMusicThumbnailRenderer?.thumbnail?.thumbnails 
              || header?.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail?.thumbnails
              || header?.thumbnail?.thumbnails
              || [];
            playlistImage = getHighResImage(thumbs) || 'assets/logo.png';

            const rawItems = extractItemsFromBrowseData(data);
            const seenIds = new Set();
            for (const it of rawItems) {
              const parsed = parseMusicItem(it);
              if (parsed && parsed.name && parsed.videoId && !seenIds.has(parsed.videoId)) {
                seenIds.add(parsed.videoId);
                songs.push(parsed);
              }
            }
          }

          if (songs.length > 0) {
            const result = {
              playlist: {
                id: nativeResult.id || rawId,
                browseId: nativeResult.browseId || browseId,
                name: playlistTitle,
                description: nativeResult.description || '',
                image: playlistImage,
                songCount: songs.length,
                songs: songs
              }
            };

            setInCache(cacheKey, result);
            return result;
          }
        }
      } catch (nativeErr) {
        console.warn('[YouTubeMusicService] Native playlist extraction notice:', nativeErr.message);
      }
    }

    // Strategy 1: YouTube Music Innertube API (via native bridge on iOS/Android)
    try {
      const data = await callInnertube('browse', { browseId });
      const header = data.header?.musicDetailHeaderRenderer 
        || data.header?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicDetailHeaderRenderer
        || data.header?.playlistHeaderRenderer;
      const title = header?.title?.runs?.[0]?.text || header?.title?.simpleText || 'YouTube Playlist';
      const description = header?.description?.runs?.[0]?.text || header?.description?.simpleText || '';
      const thumbs = header?.thumbnail?.croppedMusicThumbnailRenderer?.thumbnail?.thumbnails 
        || header?.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail?.thumbnails
        || header?.thumbnail?.thumbnails
        || [];

      const rawItems = extractItemsFromBrowseData(data);
      const songs = [];
      const seenIds = new Set();

      for (const it of rawItems) {
        const parsed = parseMusicItem(it);
        if (parsed && parsed.name && parsed.videoId && !seenIds.has(parsed.videoId)) {
          seenIds.add(parsed.videoId);
          songs.push(parsed);
        }
      }

      if (songs.length > 0) {
        const result = {
          playlist: {
            id: rawId,
            browseId: browseId,
            name: title,
            description: description,
            image: getHighResImage(thumbs) || (songs[0]?.image || 'assets/logo.png'),
            songCount: songs.length,
            songs: songs
          }
        };

        setInCache(cacheKey, result);
        return result;
      }
    } catch (err) {
      console.warn('[YouTubeMusicService] Innertube browse notice:', err.message);
    }

    // Strategy 2: High-Availability Invidious Public Mirrors Fallback
    // Uses nativeFetchJSON() which routes through native bridges on iOS/Android to bypass CORS
    const invidiousHosts = [
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://yt.artemislena.eu',
      'https://invidious.jing.rocks',
      'https://invidious.privacyredirect.com'
    ];

    const cleanPlaylistId = rawId.replace(/^VL/i, '');

    for (const host of invidiousHosts) {
      try {
        const invUrl = `${host}/api/v1/playlists/${cleanPlaylistId}`;
        const plData = await nativeFetchJSON(invUrl, { method: 'GET', timeout: 6000 });
        const streams = plData.relatedStreams || plData.videos || [];
        if (streams.length > 0) {
          const songs = streams.map(v => {
            const vId = v.videoId || (v.url ? v.url.replace('/watch?v=', '') : '');
            return {
              id: `yt_${vId || Math.random().toString(36).substring(2, 9)}`,
              videoId: vId,
              name: v.title || 'YouTube Track',
              title: v.title || 'YouTube Track',
              artists: v.author || v.uploaderName || 'YouTube Artist',
              primaryArtist: v.author || v.uploaderName || 'YouTube Artist',
              album: plData.title || v.title || 'YouTube Playlist',
              duration: Number(v.lengthSeconds || 0),
              durationSeconds: Number(v.lengthSeconds || 0),
              durationText: `${Math.floor((v.lengthSeconds || 0) / 60)}:${String((v.lengthSeconds || 0) % 60).padStart(2, '0')}`,
              image: (Array.isArray(v.videoThumbnails) && v.videoThumbnails[0]?.url) ? v.videoThumbnails[0].url : (vId ? `https://i.ytimg.com/vi/${vId}/hqdefault.jpg` : 'assets/logo.png'),
              provider: 'youtube_music',
              providerId: vId,
              source: 'youtube_music',
              sourceId: vId,
              isPlayable: true,
              metadataAvailable: true,
              playbackAvailable: true
            };
          }).filter(s => s.videoId);

          if (songs.length > 0) {
            const result = {
              playlist: {
                id: rawId,
                browseId: browseId,
                name: plData.title || 'YouTube Playlist',
                description: plData.description || '',
                image: plData.playlistThumbnail || songs[0]?.image || 'assets/logo.png',
                songCount: songs.length,
                songs: songs
              }
            };
            setInCache(cacheKey, result);
            return result;
          }
        }
      } catch (_) {}
    }

    return { playlist: null };
  },

  /**
   * Import Single YouTube Track & Match against JioSaavn / MusicFlow Catalog
   */
  async importTrack(urlOrVideoId) {
    const rawInput = String(urlOrVideoId || '').trim();
    const videoId = extractVideoId(rawInput);
    if (!videoId) {
      throw new Error('Invalid YouTube URL or Video ID');
    }

    let ytTitle = 'YouTube Track';
    let ytAuthor = 'YouTube Music';
    let ytThumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    // 1. Fetch real video metadata via oEmbed (uses native bridge on iOS to bypass CORS)
    try {
      const oembedData = await nativeFetchJSON(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { method: 'GET', timeout: 4000 });
      if (oembedData && oembedData.title) ytTitle = oembedData.title;
      if (oembedData && oembedData.author_name) ytAuthor = oembedData.author_name;
      if (oembedData && oembedData.thumbnail_url) ytThumbnail = oembedData.thumbnail_url;
    } catch (_) {}

    let cleanArtist = ytAuthor.replace(/ - Topic$/i, '').trim();
    let cleanTitle = ytTitle;
    if (ytTitle.includes(' - ')) {
      const parts = ytTitle.split(' - ');
      cleanArtist = parts[0].trim().replace(/ - Topic$/i, '');
      cleanTitle = parts.slice(1).join(' - ').trim();
    }
    cleanTitle = cleanTitle.replace(/\(.*?\)|\[.*?\]|feat\..*|ft\..*|official.*|video/gi, '').trim();

    let ytTrack = {
      id: `yt_${videoId}`,
      videoId: videoId,
      name: ytTitle,
      title: ytTitle,
      artists: cleanArtist,
      primaryArtist: cleanArtist,
      album: cleanTitle,
      duration: 0,
      durationSeconds: 0,
      image: ytThumbnail,
      provider: 'youtube_music',
      providerId: videoId,
      source: 'youtube_music',
      sourceId: videoId,
      isPlayable: true,
      metadataAvailable: true,
      playbackAvailable: true
    };

    let matchedSong = ytTrack;

    // 2. Try matching against JioSaavn 320kbps catalog
    try {
      const searchQuery = `${cleanTitle} ${cleanArtist}`.trim() || `https://youtu.be/${videoId}`;
      const saavnBase = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.getJioSaavnApiBase === 'function')
        ? ApiConfig.getJioSaavnApiBase()
        : 'https://spoton-trpn.vercel.app/api';
      const saavnRes = await nativeFetchJSON(`${saavnBase}/search/songs?query=${encodeURIComponent(searchQuery)}&limit=3`, { method: 'GET', timeout: 5000 }).catch(() => null);

      const candidateList = saavnRes?.data?.results || saavnRes?.results || [];
      if (candidateList.length > 0) {
        const bestMatch = candidateList[0];
        const streamUrl = (Array.isArray(bestMatch.downloadUrl) && bestMatch.downloadUrl.length > 0)
          ? (bestMatch.downloadUrl.find(u => (u.quality || '').includes('320'))?.url || bestMatch.downloadUrl[bestMatch.downloadUrl.length - 1]?.url)
          : (bestMatch.url || bestMatch.streamUrl || '');

        let artistStr = cleanArtist;
        if (typeof bestMatch.artists === 'string' && bestMatch.artists.trim()) {
          artistStr = bestMatch.artists.trim();
        } else if (Array.isArray(bestMatch.artists)) {
          artistStr = bestMatch.artists.map(a => typeof a === 'object' ? (a.name || a.title || '') : a).filter(Boolean).join(', ');
        } else if (bestMatch.artists && typeof bestMatch.artists === 'object') {
          const prim = Array.isArray(bestMatch.artists.primary) ? bestMatch.artists.primary : [];
          const feat = Array.isArray(bestMatch.artists.featured) ? bestMatch.artists.featured : [];
          const combined = [...prim, ...feat].map(a => typeof a === 'object' ? (a.name || a.title || '') : a).filter(Boolean);
          if (combined.length > 0) artistStr = combined.join(', ');
        } else if (bestMatch.primaryArtists) {
          artistStr = Array.isArray(bestMatch.primaryArtists) ? bestMatch.primaryArtists.join(', ') : String(bestMatch.primaryArtists);
        }

        let primaryArtistStr = cleanArtist;
        if (bestMatch.artists && typeof bestMatch.artists === 'object' && Array.isArray(bestMatch.artists.primary) && bestMatch.artists.primary.length > 0) {
          primaryArtistStr = bestMatch.artists.primary[0]?.name || cleanArtist;
        } else if (typeof bestMatch.primaryArtist === 'string' && bestMatch.primaryArtist) {
          primaryArtistStr = bestMatch.primaryArtist;
        }

        let imgUrl = ytThumbnail;
        if (Array.isArray(bestMatch.image) && bestMatch.image.length > 0) {
          const hi = bestMatch.image.find(i => i.quality === '500x500') || bestMatch.image[bestMatch.image.length - 1];
          imgUrl = hi?.url || hi?.link || bestMatch.image[0]?.url || ytThumbnail;
        } else if (typeof bestMatch.image === 'string' && bestMatch.image.startsWith('http')) {
          imgUrl = bestMatch.image;
        }

        matchedSong = {
          id: String(bestMatch.id || ytTrack.id),
          name: bestMatch.name || bestMatch.title || ytTrack.name,
          title: bestMatch.name || bestMatch.title || ytTrack.name,
          artists: artistStr || ytTrack.artists,
          primaryArtist: primaryArtistStr || cleanArtist,
          album: bestMatch.album?.name || (typeof bestMatch.album === 'string' ? bestMatch.album : '') || ytTrack.album || ytTrack.name,
          albumId: bestMatch.album?.id || '',
          duration: Number(bestMatch.duration || ytTrack.duration || 0),
          durationSeconds: Number(bestMatch.duration || ytTrack.duration || 0),
          image: imgUrl,
          audioUrl: streamUrl,
          streamUrl: streamUrl,
          streamType: 'mp4',
          downloadUrl: bestMatch.downloadUrl || [],
          year: bestMatch.year || '',
          language: bestMatch.language || 'hindi',
          provider: 'jiosaavn',
          providerId: String(bestMatch.id),
          source: 'jiosaavn',
          sourceId: String(bestMatch.id),
          sourceYtVideoId: videoId,
          metadataAvailable: true,
          isPlayable: true,
          playbackAvailable: true
        };
      } else {
        // Fallback: Resolve YouTube Music direct stream URL
        try {
          const directStream = await this.getStreamUrl(videoId);
          if (directStream && directStream.url) {
            ytTrack.audioUrl = directStream.url;
            ytTrack.streamUrl = directStream.url;
          }
        } catch (_) {}
        ytTrack.playbackAvailable = true;
        ytTrack.isPlayable = true;
      }
    } catch (_) {}

    return {
      success: true,
      track: matchedSong,
      matched: true
    };
  },

  /**
   * Import YouTube Playlist or Single Song & Match against JioSaavn / MusicFlow Catalog
   */
  async importAndMatchPlaylist(playlistUrlOrId) {
    const rawInput = String(playlistUrlOrId || '').trim();
    const videoId = extractVideoId(rawInput);
    const hasListParam = /[?&]list=/.test(rawInput);

    // 1. SINGLE SONG IMPORT DELEGATE
    if (videoId && !hasListParam) {
      const res = await this.importTrack(rawInput);
      const matchedSong = res.track;
      matchedSong.playbackAvailable = true;
      matchedSong.isPlayable = true;
      return {
        success: true,
        type: 'song',
        isSingleSong: true,
        playlistTitle: matchedSong.name,
        image: matchedSong.image,
        totalFound: 1,
        matchedCount: 1,
        unmatchedCount: 0,
        matchedTracks: [matchedSong],
        unmatchedTracks: [],
        allTracks: [matchedSong]
      };
    }

    // 2. PLAYLIST / ALBUM IMPORT
    const playlistRes = await this.getPlaylist(playlistUrlOrId);
    const pl = playlistRes.playlist;
    if (!pl || !Array.isArray(pl.songs) || pl.songs.length === 0) {
      throw new Error('Playlist not found or contains no accessible tracks');
    }

    const matchedTracks = [];
    const unmatchedTracks = [];

    // Parallel match resolution in batches of 5 to avoid overwhelming upstream hosts
    const batchSize = 5;
    for (let i = 0; i < pl.songs.length; i += batchSize) {
      const batch = pl.songs.slice(i, i + batchSize);
      const batchPromises = batch.map(async (ytTrack) => {
        try {
          const cleanTitle = ytTrack.name.replace(/\(.*?\)|\[.*?\]|feat\..*|ft\..*|official.*|video/gi, '').trim();
          const cleanArtist = String(ytTrack.primaryArtist || ytTrack.artists || '').replace(/ - Topic$/i, '').trim();
          const searchQuery = `${cleanTitle} ${cleanArtist}`.trim();
          const saavnBase = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.getJioSaavnApiBase === 'function')
            ? ApiConfig.getJioSaavnApiBase()
            : 'https://spoton-trpn.vercel.app/api';

          const saavnRes = await nativeFetchJSON(`${saavnBase}/search/songs?query=${encodeURIComponent(searchQuery)}&limit=3`, { method: 'GET', timeout: 5000 }).catch(() => null);

          const candidateList = saavnRes?.data?.results || saavnRes?.results || [];
          if (candidateList.length > 0) {
            const bestMatch = candidateList[0];
            const streamUrl = (Array.isArray(bestMatch.downloadUrl) && bestMatch.downloadUrl.length > 0)
              ? (bestMatch.downloadUrl.find(u => (u.quality || '').includes('320'))?.url || bestMatch.downloadUrl[bestMatch.downloadUrl.length - 1]?.url)
              : (bestMatch.url || bestMatch.streamUrl || '');

            let artistStr = cleanArtist;
            if (typeof bestMatch.artists === 'string' && bestMatch.artists.trim()) {
              artistStr = bestMatch.artists.trim();
            } else if (Array.isArray(bestMatch.artists)) {
              artistStr = bestMatch.artists.map(a => typeof a === 'object' ? (a.name || a.title || '') : a).filter(Boolean).join(', ');
            } else if (bestMatch.artists && typeof bestMatch.artists === 'object') {
              const prim = Array.isArray(bestMatch.artists.primary) ? bestMatch.artists.primary : [];
              const feat = Array.isArray(bestMatch.artists.featured) ? bestMatch.artists.featured : [];
              const combined = [...prim, ...feat].map(a => typeof a === 'object' ? (a.name || a.title || '') : a).filter(Boolean);
              if (combined.length > 0) artistStr = combined.join(', ');
            } else if (bestMatch.primaryArtists) {
              artistStr = Array.isArray(bestMatch.primaryArtists) ? bestMatch.primaryArtists.join(', ') : String(bestMatch.primaryArtists);
            }

            let primaryArtistStr = cleanArtist;
            if (bestMatch.artists && typeof bestMatch.artists === 'object' && Array.isArray(bestMatch.artists.primary) && bestMatch.artists.primary.length > 0) {
              primaryArtistStr = bestMatch.artists.primary[0]?.name || cleanArtist;
            } else if (typeof bestMatch.primaryArtist === 'string' && bestMatch.primaryArtist) {
              primaryArtistStr = bestMatch.primaryArtist;
            }

            let imgUrl = ytTrack.image;
            if (Array.isArray(bestMatch.image) && bestMatch.image.length > 0) {
              const hi = bestMatch.image.find(i => i.quality === '500x500') || bestMatch.image[bestMatch.image.length - 1];
              imgUrl = hi?.url || hi?.link || bestMatch.image[0]?.url || ytTrack.image;
            } else if (typeof bestMatch.image === 'string' && bestMatch.image.startsWith('http')) {
              imgUrl = bestMatch.image;
            }

            const matchedSong = {
              id: String(bestMatch.id || ytTrack.id),
              name: bestMatch.name || bestMatch.title || ytTrack.name,
              title: bestMatch.name || bestMatch.title || ytTrack.name,
              artists: artistStr || ytTrack.artists,
              primaryArtist: primaryArtistStr || cleanArtist,
              album: bestMatch.album?.name || (typeof bestMatch.album === 'string' ? bestMatch.album : '') || ytTrack.album || ytTrack.name,
              albumId: bestMatch.album?.id || '',
              duration: Number(bestMatch.duration || ytTrack.duration || 0),
              image: imgUrl,
              audioUrl: streamUrl,
              streamUrl: streamUrl,
              downloadUrl: bestMatch.downloadUrl || [],
              year: bestMatch.year || '',
              language: bestMatch.language || 'hindi',
              provider: 'jiosaavn',
              providerId: String(bestMatch.id),
              sourceYtVideoId: ytTrack.videoId,
              metadataAvailable: true,
              playbackAvailable: true,
              isPlayable: true
            };

            return { matched: true, song: matchedSong, original: ytTrack };
          }
        } catch (_) {}

        // Fallback: Keep track as valid playable YouTube Music track
        ytTrack.playbackAvailable = true;
        ytTrack.isPlayable = true;
        return { matched: true, song: ytTrack, original: ytTrack };
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(r => {
        if (r.matched) {
          matchedTracks.push(r.song);
        } else {
          unmatchedTracks.push(r.song);
        }
      });
    }

    return {
      success: true,
      type: 'playlist',
      isSingleSong: false,
      playlistId: pl.id,
      playlistTitle: pl.name,
      description: pl.description,
      image: pl.image,
      totalFound: pl.songs.length,
      matchedCount: matchedTracks.length,
      unmatchedCount: unmatchedTracks.length,
      matchedTracks,
      unmatchedTracks,
      allTracks: [...matchedTracks, ...unmatchedTracks]
    };
  },

  /**
   * Resolve direct playable audio stream URL for a YouTube Music track/videoId
   */
  async getStreamUrl(videoId, options = {}) {
    const cleanId = String(videoId || '').replace(/^yt_/, '').trim();
    if (!cleanId) return null;

    const cacheKey = `stream_${cleanId}`;
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    // Strategy 0: Native Android InnerTubeX Engine (Zemer + Faraday Cipher Deobfuscation)
    if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.resolveYouTubeStream === 'function') {
      try {
        const nativeResult = await new Promise((resolve) => {
          const callbackId = 'yt_stream_' + cleanId + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
          const timeout = setTimeout(() => {
            if (window.__ytStreamCallbacks) delete window.__ytStreamCallbacks[callbackId];
            resolve(null);
          }, 12000);

          if (!window.__ytStreamCallbacks) window.__ytStreamCallbacks = {};
          window.__ytStreamCallbacks[callbackId] = (data) => {
            clearTimeout(timeout);
            delete window.__ytStreamCallbacks[callbackId];
            resolve(data);
          };

          window.__onYtStreamResolved = (cbId, data) => {
            if (window.__ytStreamCallbacks && window.__ytStreamCallbacks[cbId]) {
              window.__ytStreamCallbacks[cbId](data);
            }
          };

          window.AndroidMediaBridge.resolveYouTubeStream(cleanId, callbackId);
        });

        if (nativeResult && nativeResult.success && nativeResult.url) {
          const result = {
            success: true,
            url: nativeResult.url,
            mimeType: nativeResult.mimeType || 'audio/mp4',
            bitrate: nativeResult.bitrate || 160000,
            quality: 'HIGH',
            provider: 'youtube_music',
            providerId: cleanId,
            expiresInSeconds: 21600
          };
          setInCache(cacheKey, result);
          return result;
        }
      } catch (nativeErr) {
        console.warn(`[YouTubeMusicService] Native InnerTubeX extraction failed for ${cleanId}:`, nativeErr.message);
      }
    }

    // Strategy 0.5: In-app youtubei.js resolver (iOS client, direct URLs, resolves on the device's own IP).
    // Runs through the native OkHttp bridge on Android and through the dev-server proxy on localhost.
    if (typeof window !== 'undefined' && window.YtStreamResolver && typeof window.YtStreamResolver.resolve === 'function') {
      try {
        const inApp = await window.YtStreamResolver.resolve(cleanId, { timeoutMs: 12000 });
        if (inApp && inApp.url) {
          if (!inApp.preview) setInCache(cacheKey, inApp);
          return inApp;
        }
      } catch (inAppErr) {
        console.warn(`[YouTubeMusicService] In-app YouTube resolver failed for ${cleanId}:`, inAppErr.message);
      }
    }

    // Strategy 1: Android Client Innertube Player API
    // Returns direct, high-quality audio stream URLs (m4a / webm) without requiring signature ciphering
    try {
      const androidPayload = {
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
            hl: 'en',
            gl: 'US'
          }
        },
        videoId: cleanId,
        playbackContext: {
          contentPlaybackContext: {
            html5Preference: 'HTML5_PREF_WANTS'
          }
        }
      };

      const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip'
        },
        body: JSON.stringify(androidPayload),
        signal: options.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined)
      });

      if (res.ok) {
        const data = await res.json();
        const streamingData = data?.streamingData;
        if (streamingData) {
          const formats = [...(streamingData.adaptiveFormats || []), ...(streamingData.formats || [])];
          const audioFormats = formats.filter(f => (f.mimeType || '').startsWith('audio/'));
          audioFormats.sort((a, b) => (b.bitrate || b.averageBitrate || 0) - (a.bitrate || a.averageBitrate || 0));

          const bestAudio = audioFormats.find(f => f.url && f.url.startsWith('http'));
          if (bestAudio && bestAudio.url) {
            const result = {
              success: true,
              url: bestAudio.url,
              mimeType: bestAudio.mimeType || 'audio/mp4',
              bitrate: bestAudio.bitrate || 160000,
              quality: 'HIGH',
              provider: 'youtube_music',
              providerId: cleanId,
              expiresInSeconds: parseInt(streamingData.expiresInSeconds || '21600', 10)
            };
            setInCache(cacheKey, result);
            return result;
          }
        }
      }
    } catch (err) {
      console.warn(`[YouTubeMusicService] Android Innertube stream resolution failed for ${cleanId}:`, err.message);
    }

    // Strategy 2: Fallback via Public Piped instances
    const pipedMirrors = [
      `https://pipedapi.kavin.rocks/streams/${cleanId}`,
      `https://api.piped.private.coffee/streams/${cleanId}`,
      `https://pipedapi.tokhmi.xyz/streams/${cleanId}`
    ];

    for (const mirror of pipedMirrors) {
      try {
        const pRes = await fetch(mirror, {
          headers: { 'Accept': 'application/json' },
          signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined)
        });
        if (pRes.ok) {
          const pData = await pRes.json();
          const streams = pData?.audioStreams || [];
          if (streams.length > 0) {
            streams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            const best = streams[0];
            if (best?.url) {
              const result = {
                success: true,
                url: best.url,
                mimeType: best.mimeType || 'audio/mp4',
                bitrate: best.bitrate || 128000,
                quality: 'HIGH',
                provider: 'youtube_music',
                providerId: cleanId,
                expiresInSeconds: 3600
              };
              setInCache(cacheKey, result);
              return result;
            }
          }
        }
      } catch (_) {}
    }

    return null;
  }
};

if (typeof window !== 'undefined') {
  window.YouTubeMusicService = YouTubeMusicService;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = YouTubeMusicService;
}

