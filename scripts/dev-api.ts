// While developing on this PC there is no hosting service to run the small
// server function in /api, so this plugin runs the same code inside the
// development server. One function, one behaviour, everywhere.

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { playlistIdFrom, readPlaylist, nodePost } from '../api/_ytcore.js';

async function ytPlaylist(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const id = playlistIdFrom(url.searchParams.get('list') || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!id) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: 'That does not look like a playlist link.' }));
    return;
  }
  try {
    const playlist = await readPlaylist(id, nodePost);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...playlist }));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'YouTube Music did not answer.' }));
  }
}

export function devApi(): Plugin {
  const mount = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void } }) => {
    server.middlewares.use('/api/yt-playlist', (req, res) => void ytPlaylist(req, res));
  };
  return {
    name: 'sukoon-dev-api',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
