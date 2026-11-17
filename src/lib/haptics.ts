// Small taps you can feel. Each kind of action has its own feel, so the phone
// quietly confirms what you did without you having to look:
//
//   tap      pressing a button (play, pause, next)
//   select   choosing something (a mode, a theme, a tab)
//   tick     a notch while dragging (reordering the queue, a slider's centre)
//   like     a soft double beat for liking a song
//   done     something finished (a playlist saved, an import completed)
//   warn     something could not be done
//
// How it reaches the phone:
//   - inside the Android app: the phone's own crisp haptics;
//   - Android in a browser: the vibration motor;
//   - iPhone: Safari has no vibration control, but toggling a hidden switch
//     makes the phone give its standard light tick (newer iPhones only).
// Wherever none of these exist, nothing happens — never an error.

import { settings } from './library';

export type Buzz = 'tap' | 'select' | 'tick' | 'like' | 'done' | 'warn';

const PATTERN: Record<Buzz, number | number[]> = {
  tap: 9,
  select: 6,
  tick: 4,
  like: [8, 55, 14],
  done: [10, 40, 10, 40, 18],
  warn: [22, 70, 22],
};

interface Shell { haptic?: (kind: string) => void }

const inBrowser = typeof window !== 'undefined';
const shell: Shell | undefined = inBrowser ? (window as unknown as { SukoonNative?: Shell }).SukoonNative : undefined;
const ios = inBrowser && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

let iosSwitch: HTMLLabelElement | null = null;

/** iPhone: a hidden switch whose toggle makes the phone tick. */
function iosTick(): void {
  try {
    if (!iosSwitch) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.setAttribute('switch', '');
      box.tabIndex = -1;
      label.appendChild(box);
      document.body.appendChild(label);
      iosSwitch = label;
    }
    iosSwitch.click();
  } catch { /* not supported on this iPhone */ }
}

let lastAt = 0;

export function buzz(kind: Buzz = 'tap'): void {
  if (!inBrowser || !settings.peek().haptics) return;
  // Never chatter: two requests within a few hundredths of a second are one tap.
  const now = performance.now();
  if (kind === 'tick' ? now - lastAt < 45 : now - lastAt < 25) return;
  lastAt = now;
  try {
    if (shell?.haptic) { shell.haptic(kind); return; }
    if (ios) {
      iosTick();
      if (kind === 'like' || kind === 'done') setTimeout(iosTick, 90);
      return;
    }
    navigator.vibrate?.(PATTERN[kind]);
  } catch { /* nothing to feel on this device */ }
}
