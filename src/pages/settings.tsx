// Settings: few, plain, and each explained in a line.

import { useRef } from 'preact/hooks';
import { ChevronRight } from 'lucide-preact';
import type { Quality, ThemeChoice } from '../lib/types';
import * as eq from '../lib/eq';
import { clearHistory, exportLibrary, history, importLibrary, liked, playlists, setSetting, settings } from '../lib/library';
import { saveText } from '../lib/native';
import { to } from '../lib/router';
import { toast } from '../lib/toast';
import { cx } from '../lib/util';
import { Link, TopBar } from '../ui/bits';
import { openConfirm, openEq } from '../ui/sheet';
import { isWide } from '../ui/state';
import { LanguageChips } from './home';

const VERSION = '1.0.0';

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
          <div class="set-row">
            <div class="set-text"><div class="set-name">Theme</div><div class="set-note">Auto follows your device.</div></div>
            <Seg<ThemeChoice> label="Theme" value={s.theme} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => setSetting('theme', v)} />
          </div>
          <div class="set-row">
            <div class="set-text"><div class="set-name">Colour from the cover</div><div class="set-note">The player takes a soft tint from the album cover.</div></div>
            <Switch on={s.tint} label="Colour from the cover" onChange={(v) => setSetting('tint', v)} />
          </div>
          <div class="set-row">
            <div class="set-text"><div class="set-name">Less motion</div><div class="set-note">Turn off slides and fades.</div></div>
            <Switch on={s.calmMotion} label="Less motion" onChange={(v) => setSetting('calmMotion', v)} />
          </div>
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
          <button class="set-row" onClick={openEq}>
            <div class="set-text">
              <div class="set-name">Equalizer</div>
              <div class="set-note">{!eq.supported ? 'Not available on iPhone and iPad.' : s.eqOn ? `On · ${s.eqPreset}` : 'Off'}</div>
            </div>
            <ChevronRight size={20} class="faint" />
          </button>
        </div>
      </section>

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
