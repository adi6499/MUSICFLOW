// Menus and small dialogs. On phones they slide up from the bottom and can be
// dragged down to dismiss; on wide screens they appear as a centred card.

import type { ComponentChildren, TargetedPointerEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  Check, Disc3, Heart, ListEnd, ListPlus, ListStart, MicVocal, Plus, Radio, Share2, Trash2,
} from 'lucide-preact';
import type { Track } from '../lib/types';
import {
  addToPlaylist, createPlaylist, isLiked, playlists, removeFromPlaylist, settings,
} from '../lib/library';
import * as player from '../lib/player';
import { isOpen } from '../lib/router';
import { toast } from '../lib/toast';
import { clock, cx, plural } from '../lib/util';
import { goAlbum, goArtist, like, shareTrack, startRadio } from './actions';
import { Art } from './bits';
import { closeSheet, openSheet, sheet } from './state';

export function SheetHost() {
  const spec = sheet.value;
  const open = isOpen('sheet');
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setShown(true), 20);
      return () => clearTimeout(t);
    }
    setShown(false);
    const t = setTimeout(() => { if (!isOpen('sheet')) sheet.value = null; }, 380);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open]);

  if (!spec) return null;

  const down = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    ref.current?.classList.add('dragging');
  };
  const move = (e: TargetedPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    ref.current.style.transform = `translateY(${d.dy}px)`;
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    const el = ref.current;
    if (!d || !el) return;
    el.classList.remove('dragging');
    el.style.transform = '';
    const speed = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 110 || (d.dy > 30 && speed > 0.6)) closeSheet();
  };

  return (
    <>
      <div class={cx('scrim', shown && open && 'in')} onClick={closeSheet} />
      <div ref={ref} class={cx('sheet', shown && open && 'in')} role="dialog" aria-modal="true">
        <div class="sheet-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        <div key={spec.key} style={{ display: 'contents' }}>{spec.render(closeSheet)}</div>
      </div>
    </>
  );
}

function Item(props: { icon: ComponentChildren; label: string; end?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button class={cx('menu-item', props.danger && 'danger')} onClick={props.onClick}>
      {props.icon}
      <span class="clip">{props.label}</span>
      {props.end && <span class="menu-end">{props.end}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- song menu

export function openTrackMenu(track: Track, opts: { playlistId?: string; queueIndex?: number } = {}): void {
  openSheet((close) => {
    const liked = isLiked(track.id);
    const song = track.kind === 'song';
    const act = (fn: () => void) => () => { close(); fn(); };
    return (
      <>
        <div class="sheet-head">
          <Art src={track.image} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 class="clip">{track.title}</h3>
            <div class="small muted clip">{track.artist}</div>
          </div>
        </div>
        <div class="sheet-body">
          <Item icon={<ListStart size={20} />} label="Play next" onClick={act(() => { player.playNext(track); toast('Playing next'); })} />
          <Item icon={<ListEnd size={20} />} label="Add to queue" onClick={act(() => { toast(player.addToQueue([track]) ? 'Added to queue' : 'Already in the queue'); })} />
          {song && <Item icon={<Heart size={20} fill={liked ? 'currentColor' : 'none'} />} label={liked ? 'Remove from Liked songs' : 'Like'} onClick={act(() => like(track))} />}
          {song && <Item icon={<ListPlus size={20} />} label="Add to playlist" onClick={() => openAddToPlaylist([track])} />}
          {song && <Item icon={<Radio size={20} />} label="Start radio" onClick={act(() => void startRadio(track))} />}
          {(track.albumId || track.showId) && <Item icon={<Disc3 size={20} />} label={song ? 'Go to album' : 'Go to podcast'} onClick={act(() => goAlbum(track))} />}
          {song && track.artist && <Item icon={<MicVocal size={20} />} label="Go to artist" onClick={act(() => goArtist(track))} />}
          <Item icon={<Share2 size={20} />} label="Share" onClick={act(() => shareTrack(track))} />
          {opts.playlistId && (
            <>
              <div class="menu-sep" />
              <Item danger icon={<Trash2 size={20} />} label="Remove from this playlist" onClick={act(() => {
                removeFromPlaylist(opts.playlistId!, track.id);
                toast('Removed', { label: 'Undo', run: () => { addToPlaylist(opts.playlistId!, [track]); } });
              })} />
            </>
          )}
          {opts.queueIndex !== undefined && (
            <>
              <div class="menu-sep" />
              <Item danger icon={<Trash2 size={20} />} label="Remove from queue" onClick={act(() => player.removeAt(opts.queueIndex!))} />
            </>
          )}
        </div>
      </>
    );
  });
}

// ---------------------------------------------------------------- add to playlist

export function openAddToPlaylist(tracks: Track[]): void {
  openSheet((close) => <AddToPlaylist tracks={tracks} close={close} />);
}

function AddToPlaylist(props: { tracks: Track[]; close: () => void }) {
  const lists = playlists.value;
  const add = (id: string, name: string) => {
    const n = addToPlaylist(id, props.tracks);
    props.close();
    toast(n ? `Added to ${name}` : `Already in ${name}`);
  };
  const fresh = () => {
    openPrompt({
      title: 'New playlist',
      placeholder: 'Give it a name',
      action: 'Create',
      onSubmit: (name) => {
        const pl = createPlaylist(name, props.tracks);
        toast(`Added to ${pl.name}`);
      },
    });
  };
  return (
    <>
      <div class="sheet-title">Add to playlist</div>
      <div class="sheet-body">
        <Item icon={<Plus size={20} />} label="New playlist" onClick={fresh} />
        {lists.length > 0 && <div class="menu-sep" />}
        {lists.map((p) => {
          const has = props.tracks.length === 1 && p.tracks.some((t) => t.id === props.tracks[0].id);
          return (
            <Item
              key={p.id}
              icon={has ? <Check size={20} /> : <ListPlus size={20} />}
              label={p.name}
              end={plural(p.tracks.length, 'song')}
              onClick={() => add(p.id, p.name)}
            />
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- ask for a name / confirm

export function openPrompt(opts: { title: string; initial?: string; placeholder?: string; action: string; onSubmit: (text: string) => void }): void {
  openSheet((close) => <Prompt {...opts} close={close} />);
}

function Prompt(props: { title: string; initial?: string; placeholder?: string; action: string; onSubmit: (text: string) => void; close: () => void }) {
  const [text, setText] = useState(props.initial ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => { input.current?.focus(); input.current?.select(); }, 260);
    return () => clearTimeout(t);
  }, []);
  const submit = (e: Event) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    props.close();
    props.onSubmit(clean);
  };
  return (
    <form onSubmit={submit} style={{ display: 'contents' }}>
      <div class="sheet-title">{props.title}</div>
      <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input
          ref={input}
          class="field"
          value={text}
          maxLength={80}
          placeholder={props.placeholder}
          enterkeyhint="done"
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" class="btn quiet wide" onClick={props.close}>Cancel</button>
          <button type="submit" class="btn wide" disabled={!text.trim()}>{props.action}</button>
        </div>
      </div>
    </form>
  );
}

export function openConfirm(opts: { title: string; text?: string; action: string; danger?: boolean; onConfirm: () => void }): void {
  openSheet((close) => (
    <>
      <div class="sheet-title">{opts.title}</div>
      <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {opts.text && <p class="muted" style={{ fontSize: 15 }}>{opts.text}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button class="btn quiet wide" onClick={close}>Cancel</button>
          <button class={cx('btn wide', opts.danger && 'danger')} onClick={() => { close(); opts.onConfirm(); }}>{opts.action}</button>
        </div>
      </div>
    </>
  ));
}

// ---------------------------------------------------------------- sleep timer

export function openSleep(): void {
  openSheet((close) => <Sleep close={close} />);
}

function Sleep(props: { close: () => void }) {
  const at = player.sleepAt.value;
  const left = player.sleepLeft.value;
  const set = (choice: number | 'track' | null, say: string) => {
    player.setSleep(choice);
    props.close();
    toast(say);
  };
  const minutes = [5, 10, 15, 30, 45, 60];
  return (
    <>
      <div class="sheet-title">Sleep timer</div>
      <p class="muted small" style={{ padding: '0 20px 14px', marginTop: -6 }}>
        {left !== null ? `Music stops in ${clock(left)}.` : at === 'track' ? 'Music stops when this song ends.' : 'Music fades out and stops by itself.'}
      </p>
      <div class="opt-grid">
        {minutes.map((m) => (
          <button key={m} class="opt" onClick={() => set(m, `Music will stop in ${m} minutes`)}>{m} min</button>
        ))}
        <button class={cx('opt wide', at === 'track' && 'on')} onClick={() => set('track', 'Music will stop after this song')}>
          When this {player.current.value?.kind === 'episode' ? 'episode' : 'song'} ends
        </button>
        {at !== null && <button class="opt wide" onClick={() => set(null, 'Sleep timer off')}>Turn off timer</button>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- keyboard shortcuts

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play or pause'],
  ['←  →', 'Back or forward 5 seconds'],
  ['Shift ←  →', 'Previous or next song'],
  ['N  P', 'Next or previous song'],
  ['↑  ↓', 'Volume, in the full player'],
  ['M', 'Mute'],
  ['L', 'Like this song'],
  ['S', 'Shuffle'],
  ['R', 'Repeat'],
  ['Q', 'Show the queue'],
  ['F', 'Open or close the full player'],
  ['/', 'Search'],
  ['?', 'This list'],
];

export function openShortcuts(): void {
  openSheet(() => (
    <>
      <div class="sheet-title">Keyboard shortcuts</div>
      <div class="sheet-body">
        <div class="keys">
          {SHORTCUTS.map(([k, what]) => (
            <div class="key-row" key={k}><kbd>{k}</kbd><span>{what}</span></div>
          ))}
        </div>
      </div>
    </>
  ));
}

// ---------------------------------------------------------------- podcast speed

export function openSpeed(): void {
  openSheet((close) => {
    const now = settings.value.podcastSpeed;
    const speeds = [0.8, 1, 1.2, 1.5, 1.75, 2];
    return (
      <>
        <div class="sheet-title">Playback speed</div>
        <div class="opt-grid">
          {speeds.map((s) => (
            <button key={s} class={cx('opt', now === s && 'on')} onClick={() => { player.setSpeed(s); close(); }}>{s}×</button>
          ))}
        </div>
      </>
    );
  });
}
