// Short messages that slide in at the bottom and leave on their own.

import { signal } from '@preact/signals';

export interface Toast {
  id: number;
  text: string;
  /** Optional button, e.g. "Undo". */
  action?: { label: string; run: () => void };
}

export const toasts = signal<Toast[]>([]);
let nextId = 1;

export function toast(text: string, action?: Toast['action'], ms = 3200): void {
  // Saying the same thing twice in a row is noise.
  const last = toasts.value[toasts.value.length - 1];
  if (last && last.text === text) return;
  const id = nextId++;
  toasts.value = [...toasts.value.slice(-1), { id, text, action }];
  setTimeout(() => dismiss(id), action ? ms + 1800 : ms);
}

export function dismiss(id: number): void {
  if (toasts.value.some((t) => t.id === id)) toasts.value = toasts.value.filter((t) => t.id !== id);
}
