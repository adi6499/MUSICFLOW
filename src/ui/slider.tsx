// Sliders you can drag with a finger or a mouse. They only ever move with
// transform, so dragging stays smooth even on slow phones.

import type { TargetedKeyboardEvent, TargetedPointerEvent } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { clamp, cx } from '../lib/util';

export function Seek(props: {
  value: number;
  max: number;
  buffered?: number;
  /** Called once, when the finger lifts. */
  onSeek: (value: number) => void;
  /** Called while dragging (and with null when it ends), e.g. to preview the time. */
  onScrub?: (value: number | null) => void;
  label: string;
  /** Step for the arrow keys. */
  step?: number;
  class?: string;
  text?: (value: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const max = props.max > 0 ? props.max : 0;
  const ratio = drag !== null ? drag : max ? clamp(props.value / max, 0, 1) : 0;

  const at = (clientX: number): number => {
    const box = ref.current!.getBoundingClientRect();
    return box.width ? clamp((clientX - box.left) / box.width, 0, 1) : 0;
  };
  const down = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (!max || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = at(e.clientX);
    setDrag(r);
    props.onScrub?.(r * max);
  };
  const move = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const r = at(e.clientX);
    setDrag(r);
    props.onScrub?.(r * max);
  };
  const up = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const r = at(e.clientX);
    setDrag(null);
    props.onScrub?.(null);
    props.onSeek(r * max);
  };
  const cancel = () => {
    if (drag === null) return;
    setDrag(null);
    props.onScrub?.(null);
  };
  const key = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    const step = props.step ?? 5;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = props.value + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = props.value - step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    props.onSeek(clamp(next, 0, max));
  };

  const buf = max && props.buffered ? clamp(props.buffered / max, 0, 1) : 0;
  const shown = ratio * max;
  return (
    <div
      ref={ref}
      class={cx('seek', drag !== null && 'dragging', props.class)}
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={props.text ? props.text(shown) : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onKeyDown={key}
    >
      <div class="seek-track">
        <div class="seek-buf" style={{ transform: `scaleX(${buf})` }} />
        <div class="seek-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <div class="seek-thumb" style={{ left: `${ratio * 100}%` }} />
    </div>
  );
}

/** Vertical slider for one equalizer band: −max … +max, centre is 0. */
export function VSlider(props: { value: number; max: number; label: string; onChange: (value: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const TRAVEL = 156; // track height (168) minus the 6px insets
  const ratio = clamp((props.max - props.value) / (2 * props.max), 0, 1);

  const at = (clientY: number): number => {
    const box = ref.current!.getBoundingClientRect();
    const r = clamp((clientY - box.top - 6) / (box.height - 12), 0, 1);
    const raw = props.max - r * 2 * props.max;
    // Snap gently to the centre line.
    return Math.abs(raw) < 0.6 ? 0 : Math.round(raw * 2) / 2;
  };
  const down = (e: TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    props.onChange(at(e.clientY));
  };
  const move = (e: TargetedPointerEvent<HTMLDivElement>) => { if (dragging) props.onChange(at(e.clientY)); };
  const end = () => setDragging(false);
  const key = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = props.value + 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = props.value - 1;
    else if (e.key === 'Home' || e.key === '0') next = 0;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    props.onChange(clamp(next, -props.max, props.max));
  };
  return (
    <div
      ref={ref}
      class={cx('vslider', dragging && 'dragging')}
      role="slider"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuemin={-props.max}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-valuetext={`${props.value > 0 ? '+' : ''}${props.value} dB`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={key}
    >
      <i style={{ transform: `translateY(${ratio * TRAVEL}px)` }} />
    </div>
  );
}
