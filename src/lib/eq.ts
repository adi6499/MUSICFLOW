// Ten-band equalizer.
//
// It is built only when the person first switches it on. Until then songs play
// through the browser's plain audio path, which is the most dependable one for
// background and lock-screen playback. iPhones pause web audio processing when
// the screen locks, so the equalizer is not offered there at all.

import { isIOS } from './util';

export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const MAX_GAIN = 12;

export const PRESETS: Array<{ name: string; gains: number[] }> = [
  { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Warm', gains: [3, 3, 2, 1, 0, 0, -1, -1, -2, -2] },
  { name: 'Bass boost', gains: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'Vocal', gains: [-2, -2, -1, 1, 3, 4, 4, 2, 0, -1] },
  { name: 'Bollywood', gains: [4, 3, 1, 0, 1, 2, 3, 3, 3, 2] },
  { name: 'Acoustic', gains: [3, 3, 2, 0, 1, 1, 2, 3, 2, 1] },
  { name: 'Classical', gains: [3, 2, 1, 1, 0, 0, 0, 1, 2, 3] },
  { name: 'Electronic', gains: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  { name: 'Rock', gains: [4, 3, 2, 0, -1, 0, 2, 3, 4, 4] },
  { name: 'Treble boost', gains: [0, 0, 0, 0, 0, 1, 2, 4, 6, 7] },
  { name: 'Late night', gains: [-4, -3, -1, 0, 1, 2, 2, 1, 0, -1] },
  { name: 'Small speaker', gains: [-6, -2, 2, 3, 2, 1, 2, 3, 2, 0] },
];

const Ctx: typeof AudioContext | undefined =
  typeof window !== 'undefined' ? window.AudioContext || (window as any).webkitAudioContext : undefined;

export const supported = !!Ctx && !isIOS;

let ctx: AudioContext | null = null;
let pre: GainNode | null = null;
let filters: BiquadFilterNode[] = [];
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
let lastOn = false;
let lastGains: number[] = [];

function build(): boolean {
  if (ctx) return true;
  if (!supported || !Ctx) return false;
  try {
    ctx = new Ctx({ latencyHint: 'playback' });
    pre = ctx.createGain();
    let node: AudioNode = pre;
    filters = BANDS.map((freq, i) => {
      const f = ctx!.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.1;
      f.gain.value = 0;
      node.connect(f);
      node = f;
      return f;
    });
    node.connect(ctx.destination);
    return true;
  } catch {
    ctx = null;
    pre = null;
    filters = [];
    return false;
  }
}

/** Route an audio element through the equalizer. Safe to call many times. */
export function attach(el: HTMLMediaElement): void {
  if (!build() || !ctx || !pre || sources.has(el)) return;
  try {
    const src = ctx.createMediaElementSource(el);
    src.connect(pre);
    sources.set(el, src);
    apply(lastOn, lastGains);
  } catch { /* already routed elsewhere; leave the plain path */ }
}

/** Browsers start audio processing asleep until the person interacts. */
export function wake(): void {
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => { /* will retry on the next tap */ });
}

/** Set the bands. Changes glide over a few hundredths of a second so nothing clicks. */
export function apply(on: boolean, gains: number[]): void {
  lastOn = on;
  lastGains = gains;
  if (!ctx || !pre) return;
  const t = ctx.currentTime;
  let peak = 0;
  filters.forEach((f, i) => {
    const g = on ? Math.max(-MAX_GAIN, Math.min(MAX_GAIN, gains[i] || 0)) : 0;
    if (g > peak) peak = g;
    f.gain.setTargetAtTime(g, t, 0.04);
  });
  // Pull the overall level down a little when bands are boosted, to avoid distortion.
  const preDb = -peak * 0.55;
  pre.gain.setTargetAtTime(Math.pow(10, preDb / 20), t, 0.04);
}
