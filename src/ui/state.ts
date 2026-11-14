// Small pieces of screen state that several components share.

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { closeOverlay, openOverlay } from '../lib/router';

const wideQuery = typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)') : null;
/** True on tablets-landscape and computers: sidebar + bottom bar layout. */
export const isWide = signal(!!wideQuery?.matches);
wideQuery?.addEventListener('change', (e) => { isWide.value = e.matches; });

/** The appearance actually in use right now ("auto" already resolved). */
export const themeNow = signal<'light' | 'dark'>(
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
);

/** What the big player shows beside (or instead of) the cover. */
export const npPanel = signal<'art' | 'lyrics' | 'queue'>('art');

export function openPlayer(panel?: 'art' | 'lyrics' | 'queue'): void {
  if (panel) npPanel.value = panel;
  openOverlay('player');
}
export function closePlayer(): void { closeOverlay('player'); }

export interface SheetSpec {
  key: number;
  render: (close: () => void) => ComponentChildren;
}

/** The menu or dialog currently slid over the page, if any. */
export const sheet = signal<SheetSpec | null>(null);
let sheetKey = 1;

export function openSheet(render: SheetSpec['render']): void {
  sheet.value = { key: sheetKey++, render };
  openOverlay('sheet');
}
export function closeSheet(): void { closeOverlay('sheet'); }
