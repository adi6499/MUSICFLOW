// Settings: few, plain, and each explained in a line.

import { useRef } from 'preact/hooks';
import { ChevronRight } from 'lucide-preact';
import type { Quality, Settings, ThemeChoice } from '../lib/types';
import { appFileKey, getAppFile, isNewer } from '../lib/appfile';
import * as eq from '../lib/eq';
import { clearHistory, exportLibrary, history, importLibrary, liked, playlists, setSetting, setSettings, settings } from '../lib/library';
import { PALETTES, paletteFor, type Palette } from '../lib/themes';
import { canBend, canGlass } from '../ui/glass';
import { saveText } from '../lib/native';
import { to } from '../lib/router';
import { toast } from '../lib/toast';
import { VERSION } from '../lib/version';
import { useQuery } from '../ui/hooks';
import { buzz } from '../lib/haptics';
import { isApp } from '../lib/native';
import * as offline from '../lib/offline';
import { cx, isIOS, isTouch } from '../lib/util';
import { Link, TopBar } from '../ui/bits';
import { openConfirm, openShortcuts } from '../ui/sheet';
import { openSound } from '../ui/sound';
import { isWide, themeNow } from '../ui/state';
import { LanguageChips } from './home';


function Switch(props: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return <button class={cx('switch', props.on && 'on')} role="switch" aria-checked={props.on} aria-label={props.label} onClick={() => props.onChange(!props.on)} />;
}

function Seg<T extends string>(props: { value: T; options: Array<[T, string]>; label: string; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="radiogroup" aria-label={props.label}>
      {props.options.map(([v, name]) => (
        <button key={v} role="radio" aria-checked={props.value === v} class={cx(props.value === v && 'on')} onClick={() => props.onChange(v)}>{name}</button>
      ))}
    </div>
  );
}

/** A row of theme swatches. Tapping one applies it straight away. */
function ThemeTiles(props: { kind: 'light' | 'dark' }) {
  const s = settings.value;
  const chosen = paletteFor(props.kind === 'dark' ? s.darkTheme : s.lightTheme, props.kind).id;
  const pick = (p: Palette) => {
    const patch: Partial<Settings> = p.kind === 'dark' ? { darkTheme: p.id } : { lightTheme: p.id };
    // Picking a dark theme while the app is light (or the other way round) switches to it, so the choice is visible.
    if (themeNow.value !== p.kind) patch.theme = p.kind;
    setSettings(patch);
  };
  return (
    <div class="themes" role="radiogroup" aria-label={props.kind === 'dark' ? 'Dark themes' : 'Light themes'}>
      {PALETTES.filter((p) => p.kind === props.kind).map((p) => (
        <button key={p.id} class={cx('theme-tile', chosen === p.id && 'on')} role="radio" aria-checked={chosen === p.id} onClick={() => pick(p)}>
          <span class="theme-swatch" style={{ background: p.bg }}>
            <b style={{ background: p.accent }} />
            <u style={{ background: p.ink }} />
            <i style={{ background: p.surface }} />
          </span>
          <span class="theme-name">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

function download(name: string, text: string): void {
  if (saveText(name, text)) return;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Inside the Android app: appears only when the website offers a newer version than this one. */
function UpdateRow() {
  const q = useQuery(appFileKey, (signal) => getAppFile(signal), { ttl: 30 * 60 * 1000 });
  const file = q.data;
  if (!file || !isNewer(file.version, VERSION)) return null;
  return (
    <Link to={to.getApp()} class="set-row">
      <div class="set-text">
        <div class="set-name">Update available</div>
        <div class="set-note">Version {file.version} is ready. You have {VERSION}.</div>
      </div>
      <ChevronRight size={20} class="faint" />
    </Link>
  );
}

export function SettingsPage() {
  const s = settings.value;
  const file = useRef<HTMLInputElement>(null);

  const backup = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`sukoon-backup-${stamp}.json`, exportLibrary());
    toast('Backup saved to your downloads');
  };
  const restore = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = '';
    if (!picked) return;
    try {
      const got = importLibrary(await picked.text());
      toast(`Restored: ${got.songs} liked songs and ${got.playlists} playlists added`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That file could not be read.');
    }
  };
  const quality: Record<Quality, string> = {
    auto: 'Best quality on Wi-Fi, lighter on mobile data.',
    high: 'Always the best quality (uses the most data).',
    normal: 'Good quality, about half the data.',
    saver: 'Lowest data use.',
  };

  return (
    <div class="page page-narrow page-in">
      {!isWide.value && <TopBar title="Settings" threshold={70} />}
      <header class="page-head"><h1 class="display">Settings</h1></header>

      <section class="set-group">
        <span class="label">Appearance</span>
        <div class="set-card">
          <div class="set-row" style={{ flexWrap: 'wrap' }}>
            <div class="set-text" style={{ minWidth: 170 }}>
              <div class="set-name">Light or dark</div>
              <div class="set-note">Auto uses your light theme by day and your dark theme at night.</div>
            </div>
            <Seg<ThemeChoice> label="Light or dark" value={s.theme} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => setSetting('theme', v)} />
          </div>
          <div class="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <div class="set-name">Light themes</div>
            <ThemeTiles kind="light" />
          </div>
          <div class="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <div class="set-name">Dark themes</div>
            <ThemeTiles kind="dark" />
          </div>
          <div class="set-row">
            <div class="set-text">
              <div class="set-name">Liquid glass</div>
              <div class="set-note">
                {!canGlass
                  ? 'This browser cannot draw glass, so bars stay solid.'
                  : canBend
                    ? 'Bars become clear glass that bends what scrolls behind them.'
                    : 'Bars become clear glass. The bending rim needs Chrome, Edge or the Android app.'}
              </div>
            </div>
            <Switch on={s.glass && canGlass} label="Liquid glass" onChange={(v) => setSetting('glass', v)} />
          </div>
          <div class="set-row">
            <div class="set-text"><div class="set-name">Colour from the cover</div><div class="set-note">The player takes a soft tint from the album cover.</div></div>
            <Switch on={s.tint} label="Colour from the cover" onChange={(v) => setSetting('tint', v)} />
          </div>
          <div class="set-row">
            <div class="set-text"><div class="set-name">Less motion</div><div class="set-note">Turn off slides and fades.</div></div>
            <Switch on={s.calmMotion} label="Less motion" onChange={(v) => setSetting('calmMotion', v)} />
          </div>
          {(isTouch || isApp) && (
            <div class="set-row">
              <div class="set-text">
                <div class="set-name">Taps you can feel</div>
                <div class="set-note">{isIOS ? 'A light tick when you press play, like a song or move things. Needs a recent iPhone.' : 'A small vibration when you press play, like a song or move things.'}</div>
              </div>
              <Switch on={s.haptics} label="Taps you can feel" onChange={(v) => { setSetting('haptics', v); if (v) setTimeout(() => buzz('like'), 30); }} />
            </div>
          )}
          {isWide.value && (
            <button class="set-row" onClick={openShortcuts}>
              <div class="set-text"><div class="set-name">Keyboard shortcuts</div><div class="set-note">Press ? at any time to see them.</div></div>
              <ChevronRight size={20} class="faint" />
            </button>
          )}
        </div>
      </section>

      <section class="set-group">
        <span class="label">Music</span>
        <div class="set-card">
          <div class="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <div class="set-text"><div class="set-name">Languages</div><div class="set-note">Home and moods lean towards these.</div></div>
            <LanguageChips />
          </div>
          <div class="set-row" style={{ flexWrap: 'wrap' }}>
            <div class="set-text" style={{ minWidth: 180 }}><div class="set-name">Sound quality</div><div class="set-note">{quality[s.quality]}</div></div>
            <Seg<Quality> label="Sound quality" value={s.quality} options={[['auto', 'Auto'], ['high', 'High'], ['normal', 'Normal'], ['saver', 'Saver']]} onChange={(v) => setSetting('quality', v)} />
          </div>
          <div class="set-row">
            <div class="set-text"><div class="set-name">Keep the music going</div><div class="set-note">When the queue ends, play similar songs.</div></div>
            <Switch on={s.autoplay} label="Keep the music going" onChange={(v) => setSetting('autoplay', v)} />
          </div>
          {!isIOS && (
            <div class="set-row" style={{ flexWrap: 'wrap' }}>
              <div class="set-text" style={{ minWidth: 180 }}>
                <div class="set-name">Songs blend together</div>
                <div class="set-note">{s.crossfade > 0 ? `Each song fades into the next over ${s.crossfade} seconds, with no silence between.` : 'Each song ends before the next one starts.'}</div>
              </div>
              <Seg<string>
                label="Songs blend together"
                value={String(s.crossfade)}
                options={[['0', 'Off'], ['3', '3s'], ['5', '5s'], ['8', '8s'], ['12', '12s']]}
                onChange={(v) => setSetting('crossfade', Number(v))}
              />
            </div>
          )}
          <button class="set-row" onClick={openSound}>
            <div class="set-text">
              <div class="set-name">Sound</div>
              <div class="set-note">{!eq.supported ? 'Not available on iPhone and iPad.' : s.eqOn ? `On · ${s.eqPreset}` : 'Modes for every speaker, surround, bass and a 10-band equalizer.'}</div>
            </div>
            <ChevronRight size={20} class="faint" />
          </button>
        </div>
      </section>

{offline.supported && (
        <section class="set-group">
          <span class="label">Downloads</span>
          <div class="set-card">
            <Link to={to.library('downloads')} class="set-row">
              <div class="set-text">
                <div class="set-name">Downloaded songs</div>
                <div class="set-note">{offline.downloads.value.length ? `${offline.downloads.value.length} songs, ${offline.megabytes(offline.totalBytes.value)} on this device.` : 'Songs you download play without internet.'}</div>
              </div>
              <ChevronRight size={20} class="faint" />
            </Link>
            <div class="set-row" style={{ flexWrap: 'wrap' }}>
              <div class="set-text" style={{ minWidth: 180 }}>
                <div class="set-name">Download quality</div>
                <div class="set-note">{s.downloadQuality === 'high' ? 'Best sound, about 10 MB a song.' : s.downloadQuality === 'saver' ? 'Smallest, about 3 MB a song.' : 'Good sound, about 5 MB a song.'}</div>
              </div>
              <Seg<Settings['downloadQuality']> label="Download quality" value={s.downloadQuality} options={[['high', 'High'], ['normal', 'Normal'], ['saver', 'Saver']]} onChange={(v) => setSetting('downloadQuality', v)} />
            </div>
            <div class="set-row">
              <div class="set-text"><div class="set-name">Keep liked songs offline</div><div class="set-note">Every song you like is downloaded by itself.</div></div>
              <Switch on={s.keepLiked} label="Keep liked songs offline" onChange={(v) => {
                setSetting('keepLiked', v);
                if (v) { const n = offline.download(liked.value); if (n) toast(`Downloading ${n} liked ${n === 1 ? 'song' : 'songs'}…`); }
              }} />
            </div>
          </div>
        </section>
      )}

      <section class="set-group">
        <span class="label">Your library</span>
        <div class="set-card">
          <Link to={to.importer()} class="set-row">
            <div class="set-text"><div class="set-name">Import from YouTube Music</div><div class="set-note">Turn a playlist link into a Sukoon playlist.</div></div>
            <ChevronRight size={20} class="faint" />
          </Link>
          <button class="set-row" onClick={backup}>
            <div class="set-text">
              <div class="set-name">Back up</div>
              <div class="set-note">Save {liked.value.length} liked songs and {playlists.value.length} playlists to a file.</div>
            </div>
            <ChevronRight size={20} class="faint" />
          </button>
          <button class="set-row" onClick={() => file.current?.click()}>
            <div class="set-text"><div class="set-name">Restore from a backup</div><div class="set-note">Adds to what is already here; nothing is removed.</div></div>
            <ChevronRight size={20} class="faint" />
          </button>
          <button class="set-row" disabled={!history.value.length} onClick={() => openConfirm({
            title: 'Clear history?',
            text: 'This forgets what you have played on this device. Liked songs and playlists stay.',
            action: 'Clear history',
            danger: true,
            onConfirm: () => { clearHistory(); toast('History cleared'); },
          })}>
            <div class="set-text"><div class="set-name">Clear listening history</div><div class="set-note">{history.value.length ? `${history.value.length} plays remembered.` : 'Nothing to clear.'}</div></div>
          </button>
        </div>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void restore(e)} />
        <p class="small faint" style={{ padding: '10px 4px 0' }}>
          Your library lives on this device only. The app on your phone and the website keep separate libraries; use Back up and Restore to move between them.
        </p>
      </section>

      <section class="set-group">
        <span class="label">About</span>
        <div class="set-card">
          {isApp ? <UpdateRow /> : (
            <Link to={to.getApp()} class="set-row">
              <div class="set-text">
                <div class="set-name">Get the Android app</div>
                <div class="set-note">Plays with the screen off and keeps your downloads safe.</div>
              </div>
              <ChevronRight size={20} class="faint" />
            </Link>
          )}
          <div class="set-row">
            <div class="set-text">
              <div class="set-name">Sukoon {VERSION}</div>
              <div class="set-note">
                Songs come from a community-run catalog that Sukoon does not control, so a song may occasionally be missing or stop working. Lyrics are from LRCLIB; podcasts from Apple's podcast directory.
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
