// Website server function: GET /api/yt-playlist?list=<playlist link or id>
// Answers with the playlist's name and its songs (title, artists, length).
// It can only read playlist listings from YouTube Music — it is not a general
// proxy — and browsers need it because YouTube does not allow web pages to
// ask directly.

import { playlistIdFrom, readPlaylist, nodePost } from './_ytcore.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Use GET.' });
    return;
  }
  let raw = '';
  try {
    raw = (req.query && req.query.list) || new URL(req.url, 'http://localhost').searchParams.get('list') || '';
  } catch {
    raw = '';
  }
  const id = playlistIdFrom(Array.isArray(raw) ? raw[0] : raw);
  if (!id) {
    res.status(400).json({ ok: false, error: 'That does not look like a playlist link.' });
    return;
  }
  try {
    const playlist = await readPlaylist(id, nodePost);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    res.status(200).json({ ok: true, ...playlist });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, error: e && e.message ? String(e.message) : 'YouTube Music did not answer.' });
  }
}
