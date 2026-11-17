// The Sound panel: pick a mode made for your speakers, nudge five simple
// sliders, or open the ten-band equalizer for fine control.

import { useState } from 'preact/hooks';
import { ChevronDown } from 'lucide-preact';
import * as eq from '../lib/eq';
import { buzz } from '../lib/haptics';
import { setSettings, settings } from '../lib/library';
import * as player from '../lib/player';
import { cx } from '../lib/util';
import { Seek, VSlider } from './slider';
import { openSheet } from './state';

export function openSound(): void {
  openSheet(() => <SoundPanel />);
}

/** Switch the sound on in one of the ready-made modes (by name). */
export function applyMode(name: string): void {
  const m = eq.MODES.find((x) => x.name === name);
  if (!m || !eq.supported) return;
  setSettings({
    eqOn: true,
    eqPreset: m.name,
    eqGains: m.gains.slice(),
    fxBass: m.bass,
    fxClarity: m.clarity,
    fxSpace: m.space,
    fxLoud: m.loud,
    fxVocal: m.vocal,
    fxLowCut: m.lowCut,
  });
  if (player.playing.value) eq.wake();
}

const CONTROLS: Array<{ key: 'fxBass' | 'fxVocal' | 'fxClarity' | 'fxSpace' | 'fxLoud'; name: string; hint: string }> = [
  { key: 'fxBass', name: 'Bass', hint: 'Deeper low end, even on small speakers' },
  { key: 'fxVocal', name: 'Vocals', hint: 'Brings the singer forward' },
  { key: 'fxClarity', name: 'Clarity', hint: 'Crisper detail and sparkle' },
  { key: 'fxSpace', name: 'Surround', hint: 'Wider, with room around the music' },
  { key: 'fxLoud', name: 'Loudness', hint: 'Evens out quiet and loud parts' },
];

function SoundPanel() {
  const s = settings.value;
  const [fine, setFine] = useState(false);

  if (!eq.supported) {
    return (
      <>
        <div class="sheet-title">Sound</div>
        <p class="muted" style={{ padding: '0 20px 24px', fontSize: 15 }}>
          Sound modes and the equalizer aren't available on iPhone and iPad, because they pause sound processing when the screen locks. Everything else works as normal.
        </p>
      </>
    );
  }

  const mode = eq.MODES.find((m) => m.name === s.eqPreset);
  const wake = () => { if (player.playing.value) eq.wake(); };
  const pick = (m: eq.Mode) => { buzz('select'); applyMode(m.name); };
  const setControl = (key: (typeof CONTROLS)[number]['key'], value: number) => {
    setSettings({ [key]: Math.round(value * 100) / 100, eqPreset: 'Custom', eqOn: true });
  };
  const setGain = (i: number, value: number) => {
    const gains = s.eqGains.slice();
    gains[i] = value;
    setSettings({ eqGains: gains, eqPreset: 'Custom', eqOn: true });
  };

  return (
    <>
      <div class="sheet-head" style={{ paddingBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="sheet-title" style={{ padding: 0 }}>Sound</div>
          <div class="small muted" style={{ marginTop: 3 }}>
            {!s.eqOn ? 'Off — songs play exactly as they were made.' : mode ? mode.note : 'Your own settings.'}
          </div>
        </div>
        <button
          class={cx('switch', s.eqOn && 'on')}
          role="switch"
          aria-checked={s.eqOn}
          aria-label="Sound"
          onClick={() => { buzz('select'); setSettings({ eqOn: !s.eqOn }); wake(); }}
        />
      </div>

      <div class="sheet-body" style={{ paddingLeft: 20, paddingRight: 20 }}>
        <div class="label" style={{ padding: '6px 0 10px' }}>Mode</div>
        <div class="chips">
          {eq.MODES.map((m) => (
            <button key={m.name} class={cx('chip', s.eqOn && s.eqPreset === m.name && 'on')} aria-pressed={s.eqOn && s.eqPreset === m.name} onClick={() => pick(m)}>
              {m.name}
            </button>
          ))}
        </div>

        <div class={cx('fx', !s.eqOn && 'off')}>
          {CONTROLS.map((c) => (
            <div class="fx-row" key={c.key}>
              <div class="fx-head">
                <b>{c.name}</b>
                <span>{c.hint}</span>
                <i class="num">{Math.round(s[c.key] * 100)}</i>
              </div>
              <Seek
                class="fat"
                value={s[c.key]}
                max={1}
                step={0.05}
                label={c.name}
                text={(v) => `${Math.round(v * 100)} percent`}
                onSeek={(v) => setControl(c.key, v)}
                onScrub={(v) => { if (v !== null) setControl(c.key, v); }}
              />
            </div>
          ))}
        </div>

        <button class="fx-more" aria-expanded={fine} onClick={() => setFine(!fine)}>
          <span>10-band equalizer</span>
          <ChevronDown size={18} style={{ transform: fine ? 'rotate(180deg)' : 'none', transition: 'transform 240ms var(--out)' }} />
        </button>
        {fine && (
          <div class={cx('eq', !s.eqOn && 'off')} style={{ paddingBottom: 12 }}>
            {eq.BANDS.map((hz, i) => (
              <div class="eq-band" key={hz}>
                <VSlider value={s.eqGains[i] || 0} max={eq.MAX_GAIN} label={`${eq.BAND_LABELS[i]} hertz`} onChange={(v) => setGain(i, v)} />
                <span>{eq.BAND_LABELS[i]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
