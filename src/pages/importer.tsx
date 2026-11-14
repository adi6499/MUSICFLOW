// Import a playlist from YouTube Music: paste the link, Sukoon finds the same
// songs in its own catalog and saves them as one of your playlists.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, ClipboardPaste, Download, ListMusic } from 'lucide-preact';
import type { Track } from '../lib/types';
import { createPlaylist } from '../lib/library';
import { go, to } from '../lib/router';
import { toast } from '../lib/toast';
import { fetchYtPlaylist, matchAll, playlistIdFrom, type YtSong } from '../lib/ytimport';
import { plural } from '../lib/util';
import { Spinner, TopBar } from '../ui/bits';
import { TrackList } from '../ui/rows';

type Step =
  | { at: 'ask' }
  | { at: 'reading' }
  | { at: 'matching'; title: string; done: number; total: number; found: number }
  | { at: 'done'; title: string; matched: Track[]; missed: YtSong[] };

export function Importer() {
  const [link, setLink] = useState('');
  const [step, setStep] = useState<Step>({ at: 'ask' });
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const job = useRef<AbortController | null>(null);

  useEffect(() => () => job.current?.abort(), []);

  const valid = !!playlistIdFrom(link);

  const run = async (e?: Event) => {
    e?.preventDefault();
    if (!valid) { setError('That does not look like a YouTube Music playlist link.'); return; }
    setError('');
    job.current?.abort();
    const ctl = new AbortController();
    job.current = ctl;
    setStep({ at: 'reading' });
    try {
      const pl = await fetchYtPlaylist(link, ctl.signal);
      if (ctl.signal.aborted) return;
      setName(pl.title);
      setStep({ at: 'matching', title: pl.title, done: 0, total: pl.songs.length, found: 0 });
      const result = await matchAll(pl.songs, (done, total, found) => {
        if (!ctl.signal.aborted) setStep({ at: 'matching', title: pl.title, done, total, found });
      }, ctl.signal);
      if (ctl.signal.aborted) return;
      setStep({ at: 'done', title: pl.title, matched: result.matched, missed: result.missed });
    } catch (err) {
      if (ctl.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Couldn't read that playlist.");
      setStep({ at: 'ask' });
    }
  };

  const cancel = () => { job.current?.abort(); setStep({ at: 'ask' }); };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setLink(text.trim()); setError(''); }
    } catch {
      toast('Paste the link into the box by hand.');
    }
  };

  const save = () => {
    if (step.at !== 'done' || !step.matched.length) return;
    const pl = createPlaylist(name || step.title, step.matched);
    toast(`Saved “${pl.name}”`);
    go(to.localPlaylist(pl.id), { replace: true });
  };

  return (
    <div class="page page-narrow page-in">
      <TopBar title="Import playlist" threshold={90} />
      <header class="page-head">
        <h1 class="display">Import a playlist</h1>
        <p class="muted">Paste a YouTube Music playlist link. Sukoon finds the same songs in its own library and saves them as a playlist here.</p>
      </header>

      {step.at === 'ask' && (
        <form onSubmit={run} style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              class="field"
              type="url"
              inputMode="url"
              value={link}
              placeholder="https://music.youtube.com/playlist?list=…"
              aria-label="Playlist link"
              autocomplete="off"
              spellcheck={false}
              onInput={(e) => { setLink((e.currentTarget as HTMLInputElement).value); setError(''); }}
            />
            <button type="button" class="icon-btn" style={{ background: 'var(--line)', width: 48, height: 48 }} onClick={() => void paste()} aria-label="Paste"><ClipboardPaste size={20} /></button>
          </div>
          {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 14 }}>{error}</p>}
          <button type="submit" class="btn" disabled={!link.trim()}><Download size={18} /> Find these songs</button>
          <p class="small faint" style={{ marginTop: 6 }}>
            The playlist must be Public or Unlisted. Only song names are read; nothing is taken from your YouTube account.
          </p>
        </form>
      )}

      {step.at === 'reading' && (
        <div class="empty"><Spinner size={26} /><p>Reading the playlist…</p><button class="btn quiet small" onClick={cancel}>Cancel</button></div>
      )}

      {step.at === 'matching' && (
        <div style={{ marginTop: 28 }}>
          <h2 class="title" style={{ fontSize: 22 }}>{step.title}</h2>
          <p class="muted" style={{ margin: '8px 0 16px' }}>Looking up song {Math.min(step.done + 1, step.total)} of {step.total} · {step.found} found so far</p>
          <div class="meter"><i style={{ transform: `scaleX(${step.total ? step.done / step.total : 0})` }} /></div>
          <button class="btn quiet small" style={{ marginTop: 20 }} onClick={cancel}>Cancel</button>
        </div>
      )}

      {step.at === 'done' && (
        <div style={{ marginTop: 26 }}>
          <div class="set-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span class="empty-ico" style={{ width: 40, height: 40, margin: 0, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)' }}><Check size={20} /></span>
              <div>
                <b>Found {step.matched.length} of {step.matched.length + step.missed.length} songs</b>
                {step.missed.length > 0 && <div class="small muted">{plural(step.missed.length, 'song')} had no confident match and were left out.</div>}
              </div>
            </div>
            {step.matched.length > 0 && (
              <>
                <input class="field" value={name} maxLength={80} aria-label="Playlist name" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
                <button class="btn" onClick={save}><ListMusic size={18} /> Save as playlist</button>
              </>
            )}
            <button class="btn quiet" onClick={() => { setStep({ at: 'ask' }); setLink(''); }}>Import another</button>
          </div>

          {step.matched.length > 0 && (
            <section class="section">
              <h2 class="heading" style={{ marginBottom: 10 }}>Songs found</h2>
              <TrackList tracks={step.matched} from={name || step.title} />
            </section>
          )}
          {step.missed.length > 0 && (
            <section class="section">
              <h2 class="heading" style={{ marginBottom: 10 }}>Not found</h2>
              <ul class="small muted" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {step.missed.map((m, i) => <li key={m.videoId || i}>{m.title}{m.artists.length ? ` — ${m.artists.join(', ')}` : ''}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
