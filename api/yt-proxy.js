// MusicFlow website — YouTube helper (Vercel serverless function, Node runtime).
// Browsers cannot call YouTube's endpoints directly (no CORS), so the web app sends those requests
// here and this function performs them. Only YouTube and the public YouTube front-ends used by the
// app are allowed, so this is not an open proxy.
const ALLOWED_HOSTS = [
  /^(www\.|music\.|m\.)?youtube\.com$/i,
  /^i\.ytimg\.com$/i,
  /^(inv\.|invidious\.|yt\.)?[a-z0-9.-]*(nadeko\.net|nerdvpn\.de|artemislena\.eu|jing\.rocks|privacyredirect\.com|yewtu\.be)$/i,
  /^(api\.|pipedapi\.|piped-api\.)[a-z0-9.-]+$/i
];
const BLOCKED_HEADERS = new Set(['host', 'cookie', 'authorization', 'content-length', 'connection']);
const MAX_BYTES = 6 * 1024 * 1024;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'POST only' }); return; }
  let payload = req.body;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (_) { payload = null; } }
  if (!payload || typeof payload.url !== 'string') { res.status(400).json({ success: false, error: 'url required' }); return; }

  let target;
  try { target = new URL(payload.url); } catch (_) { res.status(400).json({ success: false, error: 'bad url' }); return; }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.some(rx => rx.test(target.hostname))) {
    res.status(403).json({ success: false, error: 'host not allowed' }); return;
  }

  const method = String(payload.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  const headers = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36', 'Accept': '*/*' };
  for (const [k, v] of Object.entries(payload.headers || {})) {
    if (typeof v === 'string' && v && !BLOCKED_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  if (method === 'POST' && !headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json; charset=utf-8';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const upstream = await fetch(target.toString(), { method, headers, body: method === 'POST' ? String(payload.body || '{}') : undefined, redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) { res.status(502).json({ success: false, status: upstream.status, error: 'response too large' }); return; }
    res.status(200).json({ status: upstream.status, success: upstream.ok, data: buf.toString('utf8') });
  } catch (e) {
    res.status(502).json({ success: false, error: String(e && e.message || e) });
  }
};
