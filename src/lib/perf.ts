// Keeps the app smooth on every device, by itself.
//
// The liquid glass look costs the graphics chip real work on every frame of
// scrolling. Fast phones and computers don't notice; modest ones stutter. So
// Sukoon watches how long frames actually take while the person scrolls, and
// if this device is struggling it steps the effects down:
//
//   level 0  everything: clear glass that bends what is behind it
//   level 1  clear glass without the bending rim
//   level 2  solid bars, and screens appear without the staggered entrance
//
// It only ever steps down, it remembers the result for next time, and the
// person can undo it in Settings ("Restore full effects").

import { signal } from '@preact/signals';

export type PerfLevel = 0 | 1 | 2;

const KEY = 'sukoon.perf';

function read(): { level: PerfLevel; locked: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && (raw.level === 0 || raw.level === 1 || raw.level === 2)) return { level: raw.level, locked: !!raw.locked };
  } catch { /* first run */ }
  return { level: 0, locked: false };
}

const start = typeof localStorage !== 'undefined' ? read() : { level: 0 as PerfLevel, locked: false };

/** How far effects have been stepped down on this device. */
export const perfLevel = signal<PerfLevel>(start.level);
/** True when the person asked for full effects regardless of speed. */
let locked = start.locked;

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify({ level: perfLevel.value, locked })); } catch { /* optional */ }
}

/** Bring every effect back and stop adjusting automatically. */
export function restoreEffects(): void {
  locked = true;
  perfLevel.value = 0;
  save();
}

/** Let Sukoon adjust effects by itself again. */
export function autoEffects(): void {
  locked = false;
  save();
}

export const isLocked = () => locked;

// ---------------------------------------------------------------- the watcher

const SLOW_MS = 26; // slower than about 38 frames a second
const WINDOW = 50; // frames per verdict
let frames = 0;
let slow = 0;
let strikes = 0;
let last = 0;
let watching = false;
let stopAt = 0;

function frame(now: number): void {
  if (!watching) return;
  const gap = now - last;
  last = now;
  // Gaps over a quarter of a second are not slow drawing: the tab was in the
  // background, or the phone was asleep. Ignore them entirely.
  if (gap > 4 && gap < 250) {
    frames++;
    if (gap > SLOW_MS) slow++;
    if (frames >= WINDOW) {
      const share = slow / frames;
      frames = 0;
      slow = 0;
      // Two bad stretches in a row, so one hiccup (a big picture decoding,
      // another app waking up) never costs the person their effects.
      if (share > 0.4) strikes++;
      else strikes = 0;
      if (strikes >= 2 && perfLevel.value < 2) {
        strikes = 0;
        perfLevel.value = (perfLevel.value + 1) as PerfLevel;
        save();
      }
    }
  }
  if (now < stopAt) requestAnimationFrame(frame);
  else watching = false;
}

if (typeof window !== 'undefined') {
  const ready = performance.now() + 4000; // start-up is always busy; don't judge it
  window.addEventListener('scroll', () => {
    if (locked || perfLevel.value >= 2 || document.hidden) return;
    const now = performance.now();
    if (now < ready) return;
    stopAt = now + 400; // keep measuring while scrolling continues
    if (!watching) {
      watching = true;
      last = now;
      requestAnimationFrame(frame);
    }
  }, { passive: true });
}
