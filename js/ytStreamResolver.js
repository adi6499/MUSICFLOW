// ============================================================================
// MUSICFLOW — IN-APP YOUTUBE STREAM RESOLVER
// Resolves a playable audio URL for a YouTube video *on the device*, using the
// youtubei.js library (loaded lazily, ~1.5 MB, only when a YouTube track needs
// it). YouTube stream URLs are bound to the IP that requested them, so this has
// to run where playback happens:
//   • Android app  → HTTP goes through the native OkHttp bridge
//                    (window.AndroidMediaBridge.executeHttpRequest), which also
//                    lets the library send the iOS-client headers YouTube expects.
//   • Local dev web → HTTP goes through the dev server (/api/proxy/yt) and the
//                    audio is played through /api/proxy/stream (same-origin).
//   • Anything else → direct fetch (works where CORS is not enforced).
// ============================================================================

const YtStreamResolver = (() => {
  const LIB_PATH = 'js/vendor/youtubei.browser.js';
  const CACHE_TTL_MS = 60 * 60 * 1000;          // YouTube URLs expire after ~6h; stay conservative
  const cache = new Map();                       // videoId -> { result, timestamp }
  let libPromise = null;
  let innertubePromise = null;
  let lastTransport = 'unknown';

  function hasAndroidBridge() {
    return typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.executeHttpRequest === 'function';
  }

  function isLocalDevWeb() {
    try {
      if (typeof ApiConfig !== 'undefined' && typeof ApiConfig.isLocalDevelopment === 'function') return ApiConfig.isLocalDevelopment();
    } catch (_) {}
    return false;
  }

  function loadLibrary() {
    if (typeof window !== 'undefined' && window.YouTubeJS) return Promise.resolve(window.YouTubeJS);
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      try {
        const s = document.createElement('script');
        s.src = LIB_PATH;
        s.async = true;
        s.onload = () => (window.YouTubeJS ? resolve(window.YouTubeJS) : reject(new Error('YouTubeJS global missing after load')));
        s.onerror = () => reject(new Error('Failed to load ' + LIB_PATH));
        document.head.appendChild(s);
      } catch (e) {
        reject(e);
      }
    }).catch(err => { libPromise = null; throw err; });
    return libPromise;
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function requestSpec(input, init) {
    const req = (typeof Request !== 'undefined' && input instanceof Request) ? input : null;
    const url = req ? req.url : String(input);
    const method = ((init && init.method) || (req && req.method) || 'GET').toUpperCase();
    const headers = {};
    const src = (init && init.headers) || (req && req.headers) || null;
    if (src) {
      if (typeof src.forEach === 'function') src.forEach((v, k) => { headers[k] = v; });
      else Object.assign(headers, src);
    }
    let body = init && init.body != null ? init.body : null;
    if (body == null && req && method !== 'GET' && method !== 'HEAD') {
      try { body = await req.text(); } catch (_) { body = null; }
    }
    if (body != null && typeof body !== 'string') {
      try { body = typeof body.text === 'function' ? await body.text() : String(body); } catch (_) { body = String(body); }
    }
    return { url, method, headers, body };
  }

  // fetch() replacement handed to youtubei.js
  async function transportFetch(input, init) {
    const spec = await requestSpec(input, init);

    if (hasAndroidBridge()) {
      lastTransport = 'android-bridge';
      const raw = window.AndroidMediaBridge.executeHttpRequest(spec.url, spec.method, JSON.stringify(spec.headers), spec.body || '');
      const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const status = Number(res.status) || (res.success ? 200 : 500);
      const bytes = res.base64Data ? base64ToBytes(res.base64Data) : new TextEncoder().encode(String(res.data || ''));
      return new Response(bytes, { status, headers: { 'content-type': 'application/json' } });
    }

    if (isLocalDevWeb()) {
      lastTransport = 'dev-proxy';
      const proxyRes = await fetch('/api/proxy/yt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec)
      });
      if (!proxyRes.ok) throw new Error('dev proxy HTTP ' + proxyRes.status);
      const data = await proxyRes.json();
      const bytes = data.bodyBase64 ? base64ToBytes(data.bodyBase64) : new Uint8Array(0);
      return new Response(bytes, { status: Number(data.status) || 200, headers: { 'content-type': (data.headers && data.headers['content-type']) || 'application/json' } });
    }

    lastTransport = 'direct';
    return fetch(input, init);
  }

  async function getInnertube() {
    if (innertubePromise) return innertubePromise;
    innertubePromise = (async () => {
      const lib = await loadLibrary();
      const Innertube = lib.Innertube;
      const ClientType = lib.ClientType || {};
      return Innertube.create({
        client_type: ClientType.IOS || 'IOS',
        retrieve_player: false,            // iOS client returns direct URLs, no cipher, no player download
        generate_session_locally: true,
        fetch: transportFetch
      });
    })().catch(err => { innertubePromise = null; throw err; });
    return innertubePromise;
  }

  function playableUrl(rawUrl) {
    if (isLocalDevWeb()) {
      // Browser cannot play googlevideo directly (no CORS headers): go through the dev server.
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
      return `${origin}/api/proxy/stream?url=${encodeURIComponent(rawUrl)}`;
    }
    return rawUrl;
  }

  /**
   * Resolve the best audio-only stream for a YouTube video id.
   * Returns { url, mimeType, bitrate, itag, expiresInSeconds } or null.
   */
  async function resolve(videoId, options = {}) {
    const id = String(videoId || '').replace(/^yt_/, '').trim();
    if (!id) return null;

    const hit = cache.get(id);
    if (hit && Date.now() - hit.timestamp < CACHE_TTL_MS) return hit.result;

    const timeoutMs = options.timeoutMs || 12000;
    const work = (async () => {
      const yt = await getInnertube();
      const info = await yt.getBasicInfo(id);
      const status = info && info.playability_status ? info.playability_status.status : 'UNKNOWN';
      if (status && status !== 'OK') throw new Error('YouTube says ' + status + (info.playability_status.reason ? ': ' + info.playability_status.reason : ''));
      const sd = info.streaming_data || {};
      const formats = [...(sd.adaptive_formats || []), ...(sd.formats || [])]
        .filter(f => f && f.has_audio && !f.has_video && f.url);
      if (!formats.length) throw new Error('no audio-only formats');
      // Highest bitrate the device can actually play: Opus (WebM) where MediaSource supports it, else AAC.
      let canOpus = false;
      try { canOpus = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/webm; codecs="opus"'); } catch (_) {}
      formats.sort((a, b) => {
        const ok = (f) => /webm|opus/i.test(f.mime_type || '') ? (canOpus ? 1 : 0) : 1;
        return (ok(b) - ok(a)) || ((b.bitrate || 0) - (a.bitrate || 0));
      });
      const best = formats[0];
      const result = {
        success: true,
        url: playableUrl(best.url),
        rawUrl: best.url,
        mimeType: String(best.mime_type || 'audio/mp4').split(';')[0],
        bitrate: best.bitrate || 128000,
        itag: best.itag,
        contentLength: Number(best.content_length) || 0,
        // Without a BotGuard attestation token YouTube only serves roughly the first megabyte,
        // so anything larger than that is effectively a preview.
        preview: (Number(best.content_length) || 0) > 1100000,
        quality: 'HIGH',
        provider: 'youtube_music',
        providerId: id,
        expiresInSeconds: Number(sd.expires_in_seconds || 21600) || 21600,
        transport: lastTransport
      };
      cache.set(id, { result, timestamp: Date.now() });
      return result;
    })();

    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('YouTube resolve timeout')), timeoutMs); });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }


  // ------------------------------------------------------------------------
  // MEDIA SOURCE LOADER
  // YouTube's media servers refuse the open-ended byte range that an <audio>
  // element sends ("bytes=0-") but accept bounded ranges. So instead of handing
  // the URL to the element, we feed it through MediaSource: bounded chunks are
  // fetched back to back and appended to a SourceBuffer. Same code path on the
  // web and inside the Android WebView.
  // ------------------------------------------------------------------------
  const CHUNK_BYTES = 960 * 1024;   // YouTube refuses bounded ranges much above 1 MB
  let mseGeneration = 0;
  let activeSession = null;

  function isYouTubeStream(uri) {
    return /googlevideo\.com/i.test(String(uri || ''));
  }

  function mimeFor(result) {
    const m = String((result && result.mimeType) || '');
    return /webm/i.test(m) ? 'audio/webm; codecs="opus"' : 'audio/mp4; codecs="mp4a.40.2"';
  }

  function canUseMse(result) {
    try {
      return typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function' && MediaSource.isTypeSupported(mimeFor(result));
    } catch (_) { return false; }
  }

  function contentLengthOf(result) {
    if (result && Number(result.contentLength) > 0) return Number(result.contentLength);
    const candidates = [result && result.rawUrl, result && result.url, result && result.uri];
    for (const c of candidates) {
      if (!c) continue;
      try {
        let u = new URL(c);
        if (!/googlevideo\.com$/i.test(u.hostname) && u.searchParams.get('url')) u = new URL(u.searchParams.get('url'));
        const clen = Number(u.searchParams.get('clen'));
        if (clen > 0) return clen;
      } catch (_) {}
    }
    return 0;
  }

  function detach() {
    const s = activeSession;
    if (!s) return;
    s.aborted = true;
    try { if (s.mediaSource.readyState === 'open' && !(s.sourceBuffer && s.sourceBuffer.updating)) s.mediaSource.endOfStream(); } catch (_) {}
    try { URL.revokeObjectURL(s.objectUrl); } catch (_) {}
    activeSession = null;
  }

  function appendChunk(sb, buf) {
    return new Promise((resolve, reject) => {
      const done = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', fail); resolve(); };
      const fail = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', fail); reject(new Error('SourceBuffer append failed')); };
      sb.addEventListener('updateend', done);
      sb.addEventListener('error', fail);
      try { sb.appendBuffer(buf); } catch (e) { fail(); }
    });
  }

  async function fetchRange(url, from, to) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, cache: 'no-store' });
        if (res.status === 206 || res.status === 200) return await res.arrayBuffer();
        lastErr = new Error('YouTube chunk HTTP ' + res.status);
        if (res.status === 403 || res.status === 404) break;
      } catch (e) { lastErr = e; }
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
    throw lastErr || new Error('chunk fetch failed');
  }

  /**
   * Attach a YouTube stream to an <audio> element via MediaSource.
   * Resolves once the first chunk is buffered (so play() can start); the rest streams in the background.
   */
  async function attach(audio, result) {
    detach();
    const gen = ++mseGeneration;
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    const session = { aborted: false, mediaSource, objectUrl, sourceBuffer: null };
    activeSession = session;

    const opened = new Promise(resolve => mediaSource.addEventListener('sourceopen', resolve, { once: true }));
    audio.src = objectUrl;
    audio.load();
    await opened;
    if (session.aborted || gen !== mseGeneration) return;

    const sb = mediaSource.addSourceBuffer(mimeFor(result));
    sb.mode = 'segments';
    session.sourceBuffer = sb;
    const url = result.url || result.uri;
    const total = contentLengthOf(result);
    lastTransport = 'mse';

    let pos = 0;
    const step = async () => {
      const end = total ? Math.min(pos + CHUNK_BYTES - 1, total - 1) : pos + CHUNK_BYTES - 1;
      const buf = await fetchRange(url, pos, end);
      if (session.aborted || gen !== mseGeneration) return false;
      if (!buf.byteLength) return false;
      await appendChunk(sb, buf);
      pos += buf.byteLength;
      return total ? pos < total : buf.byteLength >= CHUNK_BYTES;
    };

    // First chunk synchronously so playback can begin, the rest in the background.
    let more = await step();
    (async () => {
      try {
        while (more && !session.aborted && gen === mseGeneration) more = await step();
        if (!session.aborted && gen === mseGeneration && mediaSource.readyState === 'open') {
          if (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
          mediaSource.endOfStream();
        }
      } catch (e) {
        console.warn('[YtStreamResolver] background chunk loading stopped:', e.message);
        try { if (mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch (_) {}
      }
    })();
  }

  return { resolve, loadLibrary, attach, detach, isYouTubeStream, canUseMse, getTransport: () => lastTransport, _cache: cache };
})();

if (typeof window !== 'undefined') {
  window.YtStreamResolver = YtStreamResolver;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = YtStreamResolver;
}
