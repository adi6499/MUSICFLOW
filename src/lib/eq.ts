// The sound engine: everything between a song and the speaker.
//
//   song → low cut → 10-band equalizer ─┬→ tone (bass shelf, presence, air) ─┐
//                                        ├→ bass harmonics (for small speakers)┼→ widen ─┬→ leveller → limiter → out
//                                        └→ high sparkle                      ┘         │
//                                                          room ambience ───────────────┘
//
// Five simple controls sit on top of the equalizer:
//   Bass      real low-end boost, plus added harmonics so bass is still heard
//             on speakers too small to play the low notes themselves
//   Clarity   lifts voices and detail
//   Surround  widens the stereo picture and adds a little room around it
//   Vocals    brings the singer forward without touching the instruments
//   Loudness  evens out quiet and loud passages and raises the overall level
// A limiter at the very end stops any of this from distorting.
//
// This is a stereo enhancer. It is not Dolby Atmos (that needs specially mixed
// songs and a licensed decoder) and does not claim to be.
//
// The whole chain is built only when the person first switches Sound on.
// Until then songs play through the browser's plain audio path, which is the
// most dependable one for background playback. iPhones pause web audio
// processing when the screen locks, so Sound is not offered there at all.

import { clamp, isIOS } from './util';

export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const MAX_GAIN = 12;

export interface Sound {
  on: boolean;
  /** Ten equalizer bands, −12…+12 dB. */
  gains: number[];
  /** 0…1 each. */
  bass: number;
  clarity: number;
  space: number;
  loud: number;
  /** Brings the singer forward (0…1). */
  vocal: number;
  /** Remove everything below this many hertz (0 = keep it all). */
  lowCut: number;
}

export interface Mode {
  name: string;
  /** One line shown under the name. */
  note: string;
  gains: number[];
  bass: number;
  clarity: number;
  space: number;
  loud: number;
  vocal: number;
  lowCut: number;
}

const flat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export const MODES: Mode[] = [
  { name: 'Original', note: 'The song exactly as it was made.', gains: flat, bass: 0, clarity: 0, space: 0, loud: 0, vocal: 0, lowCut: 0 },
  { name: 'Signature', note: "Music Flow's own tuning: warm bass, a clear voice and a little air around it.", gains: [2, 1.5, 0.5, 0, -0.5, 0, 1, 1.5, 2, 2], bass: 0.3, clarity: 0.35, space: 0.3, loud: 0.2, vocal: 0.35, lowCut: 0 },
  { name: 'Spatial', note: 'Wide and open, with room around the music.', gains: [2, 2, 1, 0, -1, 0, 1, 2, 3, 3], bass: 0.35, clarity: 0.45, space: 0.7, loud: 0.25, vocal: 0.2, lowCut: 0 },
  { name: 'Cinema', note: 'Big, deep and enveloping.', gains: [4, 3, 2, 0, -1, 0, 1, 2, 3, 3], bass: 0.6, clarity: 0.4, space: 0.85, loud: 0.4, vocal: 0.25, lowCut: 0 },
  { name: 'Concert', note: 'Like a seat in the hall.', gains: [2, 2, 1, 0, 0, 0, 1, 2, 2, 2], bass: 0.3, clarity: 0.3, space: 1, loud: 0.2, vocal: 0.1, lowCut: 0 },
  { name: 'Headphones', note: 'Balanced, with a gentle sense of space.', gains: [2, 1, 0, 0, 0, 0, 1, 1, 2, 2], bass: 0.3, clarity: 0.3, space: 0.5, loud: 0.15, vocal: 0.15, lowCut: 0 },
  { name: 'Old speaker', note: 'For ageing or tired speakers: removes rumble they cannot play, restores warmth and detail, and lifts the level.', gains: [-6, -2, 3, 2, -1, 0, 2, 3, 4, 2], bass: 0.8, clarity: 0.6, space: 0.15, loud: 0.7, vocal: 0.45, lowCut: 80 },
  { name: 'Phone speaker', note: 'For a phone or tablet playing out loud: fuller and louder without distortion.', gains: [-9, -6, 0, 3, 2, 1, 2, 3, 2, 0], bass: 0.95, clarity: 0.35, space: 0, loud: 0.85, vocal: 0.5, lowCut: 140 },
  { name: 'Small speaker', note: 'For Bluetooth and laptop speakers: bass you can hear without the boom.', gains: [-5, -1, 3, 2, 0, 0, 1, 2, 3, 1], bass: 0.75, clarity: 0.4, space: 0.25, loud: 0.55, vocal: 0.4, lowCut: 65 },
  { name: 'Car', note: 'Cuts through road noise.', gains: [4, 3, 1, 0, -1, 0, 1, 2, 3, 2], bass: 0.5, clarity: 0.45, space: 0.4, loud: 0.55, vocal: 0.4, lowCut: 0 },
  { name: 'Bass boost', note: 'More weight in the low end.', gains: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0], bass: 0.8, clarity: 0.1, space: 0.1, loud: 0.2, vocal: 0, lowCut: 0 },
  { name: 'Vocal', note: 'Brings the singer forward.', gains: [-2, -2, -1, 1, 3, 4, 4, 2, 0, -1], bass: 0, clarity: 0.4, space: 0.1, loud: 0.3, vocal: 0.8, lowCut: 0 },
  { name: 'Bollywood', note: 'Punchy rhythm, bright strings and clear vocals.', gains: [4, 3, 1, 0, 1, 2, 3, 3, 3, 2], bass: 0.45, clarity: 0.45, space: 0.35, loud: 0.35, vocal: 0.4, lowCut: 0 },
  { name: 'Acoustic', note: 'Natural and warm.', gains: [3, 3, 2, 0, 1, 1, 2, 3, 2, 1], bass: 0.2, clarity: 0.3, space: 0.3, loud: 0.1, vocal: 0.3, lowCut: 0 },
  { name: 'Classical', note: 'Wide dynamics, airy top.', gains: [3, 2, 1, 1, 0, 0, 0, 1, 2, 3], bass: 0.15, clarity: 0.25, space: 0.55, loud: 0, vocal: 0, lowCut: 0 },
  { name: 'Electronic', note: 'Deep bass and crisp highs.', gains: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5], bass: 0.6, clarity: 0.4, space: 0.45, loud: 0.3, vocal: 0.1, lowCut: 0 },
  { name: 'Rock', note: 'Guitars and drums up front.', gains: [4, 3, 2, 0, -1, 0, 2, 3, 4, 4], bass: 0.4, clarity: 0.4, space: 0.3, loud: 0.35, vocal: 0.2, lowCut: 0 },
  { name: 'Late night', note: 'Quiet parts up, loud parts down, bass tamed: easy at low volume.', gains: [-4, -3, -1, 0, 1, 2, 2, 1, 0, -1], bass: 0, clarity: 0.25, space: 0.1, loud: 0.9, vocal: 0.45, lowCut: 0 },
];

const Ctx: typeof AudioContext | undefined =
  typeof window !== 'undefined' ? window.AudioContext || (window as any).webkitAudioContext : undefined;

export const supported = !!Ctx && !isIOS;

interface Graph {
  ctx: AudioContext;
  input: GainNode;
  lowCut: BiquadFilterNode;
  bands: BiquadFilterNode[];
  shelf: BiquadFilterNode;
  presence: BiquadFilterNode;
  air: BiquadFilterNode;
  bassGain: GainNode;
  sparkleGain: GainNode;
  vocalGain: GainNode;
  lowKeep: GainNode;
  highKeep: GainNode;
  mix: GainNode;
  ll: GainNode;
  rr: GainNode;
  lr: GainNode;
  rl: GainNode;
  room: ConvolverNode;
  wet: GainNode;
  leveller: DynamicsCompressorNode;
  makeup: GainNode;
  analyser: AnalyserNode;
}

let g: Graph | null = null;
let roomOn = false;
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
let last: Sound = { on: false, gains: flat, bass: 0, clarity: 0, space: 0, loud: 0, vocal: 0, lowCut: 0 };

/** A shape that turns a low note into the same note plus its overtones. */
function curve(make: (x: number) => number) {
  const n = 2048;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = make((i / (n - 1)) * 2 - 1);
  return out;
}

/** A short, soft "room": fading noise with a few early echoes. Made once, in memory. */
function makeRoom(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 0.85);
  const buffer = ctx.createBuffer(2, length, rate);
  const quiet = Math.floor(rate * 0.009);
  const echoes = [0.011, 0.017, 0.023, 0.031, 0.043, 0.059];
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let smooth = 0;
    for (let i = quiet; i < length; i++) {
      const fade = Math.pow(1 - i / length, 3.4);
      const noise = Math.random() * 2 - 1;
      smooth += 0.42 * (noise - smooth); // soften the hiss
      data[i] = smooth * fade;
    }
    echoes.forEach((seconds, n) => {
      // Alternate sides so the echoes arrive from around the listener.
      if ((n + ch) % 2 === 0) data[Math.floor(rate * seconds)] += 0.9 - n * 0.11;
    });
  }
  return buffer;
}

function build(): Graph | null {
  if (g) return g;
  if (!supported || !Ctx) return null;
  try {
    const ctx = new Ctx({ latencyHint: 'playback' });
    const filter = (type: BiquadFilterType, hz: number, q = 0.707) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      f.gain.value = 0;
      return f;
    };
    const gain = (value: number) => {
      const n = ctx.createGain();
      n.gain.value = value;
      return n;
    };

    const input = gain(1);
    const lowCut = filter('highpass', 10);
    input.connect(lowCut);

    // Ten-band equalizer.
    let node: AudioNode = lowCut;
    const bands = BANDS.map((hz, i) => {
      const f = filter(i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking', hz, 1.1);
      node.connect(f);
      node = f;
      return f;
    });
    const tap = node;

    // Tone: real bass, voice presence, and "air".
    const shelf = filter('lowshelf', 100);
    const presence = filter('peaking', 3000, 0.9);
    const air = filter('highshelf', 8500);
    const mix = gain(1);
    mix.channelCount = 2;
    mix.channelCountMode = 'explicit';
    mix.channelInterpretation = 'speakers'; // a mono song is spread to both sides
    tap.connect(shelf);
    shelf.connect(presence);
    presence.connect(air);
    air.connect(mix);

    // Bass harmonics: take the low notes, add overtones, keep only the part a
    // small speaker can actually play. The ear fills in the missing low note.
    const bassIn = filter('lowpass', 150);
    const bassShape = ctx.createWaveShaper();
    bassShape.curve = curve((x) => 0.7 * Math.tanh(4 * x) + 0.5 * Math.abs(x) - 0.25);
    bassShape.oversample = '2x';
    const bassFrom = filter('highpass', 110);
    const bassTo = filter('lowpass', 520);
    const bassGain = gain(0);
    tap.connect(bassIn);
    bassIn.connect(bassShape);
    bassShape.connect(bassFrom);
    bassFrom.connect(bassTo);
    bassTo.connect(bassGain);
    bassGain.connect(mix);

    // Sparkle: a touch of new overtones at the very top, for dull speakers.
    const sparkleIn = filter('highpass', 3200);
    const sparkleShape = ctx.createWaveShaper();
    sparkleShape.curve = curve((x) => Math.tanh(3 * x));
    sparkleShape.oversample = '2x';
    const sparkleOut = filter('highpass', 6200);
    const sparkleGain = gain(0);
    tap.connect(sparkleIn);
    sparkleIn.connect(sparkleShape);
    sparkleShape.connect(sparkleOut);
    sparkleOut.connect(sparkleGain);
    sparkleGain.connect(mix);

    // Widening: push what differs between left and right further apart. Played
    // through a single speaker the two sides still add up to the original.
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const ll = gain(1);
    const rr = gain(1);
    const lr = gain(0);
    const rl = gain(0);
    mix.connect(split);
    split.connect(ll, 0);
    ll.connect(merge, 0, 0);
    split.connect(rl, 1);
    rl.connect(merge, 0, 0);
    split.connect(lr, 0);
    lr.connect(merge, 0, 1);
    split.connect(rr, 1);
    rr.connect(merge, 0, 1);
    const out = gain(1);
    merge.connect(out);

    // Vocals: a singer is nearly always mixed dead centre, in the middle of the
    // range. So take what is the same in both ears, keep only the voice range,
    // and add a little of it back in. Instruments off to the sides are untouched.
    const centre = gain(1);
    centre.channelCount = 1;
    centre.channelCountMode = 'explicit';
    centre.channelInterpretation = 'speakers'; // both sides folded into one
    const voiceFrom = filter('highpass', 300);
    const voiceTo = filter('lowpass', 3600);
    const vocalGain = gain(0);
    mix.connect(centre);
    centre.connect(voiceFrom);
    voiceFrom.connect(voiceTo);
    voiceTo.connect(vocalGain);
    vocalGain.connect(out);

    // Sing along: the widener above can also remove everything that is the
    // same in both ears, which is where the singer sits. That would take the
    // bass and the cymbals with it, so those two ranges are kept on these side
    // paths and added back. Silent unless sing-along is switched on.
    const keepLow = gain(1);
    keepLow.channelCount = 1;
    keepLow.channelCountMode = 'explicit';
    keepLow.channelInterpretation = 'speakers';
    const lowOnly = filter('lowpass', 170);
    const lowKeep = gain(0);
    mix.connect(keepLow);
    keepLow.connect(lowOnly);
    lowOnly.connect(lowKeep);
    lowKeep.connect(out);
    const keepHigh = gain(1);
    keepHigh.channelCount = 1;
    keepHigh.channelCountMode = 'explicit';
    keepHigh.channelInterpretation = 'speakers';
    const highOnly = filter('highpass', 7500);
    const highKeep = gain(0);
    mix.connect(keepHigh);
    keepHigh.connect(highOnly);
    highOnly.connect(highKeep);
    highKeep.connect(out);

    // Room ambience (bass is kept out of it so the low end stays tight).
    const room = ctx.createConvolver();
    room.buffer = makeRoom(ctx);
    const roomTone = filter('highpass', 260);
    const wet = gain(0);
    room.connect(roomTone);
    roomTone.connect(wet);
    wet.connect(out);

    // Leveller, then a limiter that guarantees nothing distorts.
    const leveller = ctx.createDynamicsCompressor();
    leveller.threshold.value = 0;
    leveller.ratio.value = 1;
    leveller.knee.value = 20;
    leveller.attack.value = 0.012;
    leveller.release.value = 0.28;
    const makeup = gain(1);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    // The browser's compressor quietly adds gain of its own, and lets the very
    // first instant of a loud hit through. A fixed trim after the limiter
    // keeps the true ceiling just under full scale, so nothing ever clips.
    const trim = gain(db(-1.6));
    out.connect(leveller);
    leveller.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(trim);
    trim.connect(ctx.destination);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    trim.connect(analyser);

    g = { ctx, input, lowCut, bands, shelf, presence, air, bassGain, sparkleGain, vocalGain, lowKeep, highKeep, mix, ll, rr, lr, rl, room, wet, leveller, makeup, analyser };
    return g;
  } catch {
    g = null;
    return null;
  }
}

/** Route an audio element through the sound engine. Safe to call many times. */
export function attach(el: HTMLMediaElement): void {
  const graph = build();
  if (!graph || sources.has(el)) return;
  try {
    const src = graph.ctx.createMediaElementSource(el);
    src.connect(graph.input);
    sources.set(el, src);
    apply(last);
  } catch { /* already routed elsewhere; leave the plain path */ }
}

let singing = false;

/**
 * Sing along: lower the original singer so you can take over. It works by
 * removing what is identical in the left and right ear (the singer is nearly
 * always placed dead centre) while keeping the bass and the shimmer. It suits
 * most songs; on old or single-channel recordings there is nothing to separate.
 */
export function setSingAlong(on: boolean): void {
  if (singing === on) return;
  singing = on;
  apply(last);
}
export const isSinging = () => singing;

/** Browsers start audio processing asleep until the person interacts. */
export function wake(): void {
  if (g && g.ctx.state !== 'running') g.ctx.resume().catch(() => { /* will retry on the next tap */ });
}

const db = (value: number) => Math.pow(10, value / 20);

/** Set every control. Changes glide over a few hundredths of a second so nothing clicks. */
export function apply(s: Sound): void {
  last = s;
  const graph = g;
  if (!graph) return;
  const t = graph.ctx.currentTime;
  const to = (param: AudioParam, value: number) => param.setTargetAtTime(value, t, 0.05);
  const on = s.on;
  const bass = on ? clamp(s.bass || 0, 0, 1) : 0;
  const clarity = on ? clamp(s.clarity || 0, 0, 1) : 0;
  const space = on ? clamp(s.space || 0, 0, 1) : 0;
  const loud = on ? clamp(s.loud || 0, 0, 1) : 0;
  const vocal = on ? clamp(s.vocal || 0, 0, 1) : 0;

  let boost = 0;
  graph.bands.forEach((f, i) => {
    const gain = on ? clamp(s.gains[i] || 0, -MAX_GAIN, MAX_GAIN) : 0;
    if (gain > boost) boost = gain;
    to(f.gain, gain);
  });
  to(graph.lowCut.frequency, on && s.lowCut > 20 ? clamp(s.lowCut, 20, 300) : 10);

  to(graph.shelf.gain, bass * 7);
  to(graph.bassGain.gain, bass * 0.6);
  to(graph.presence.gain, clarity * 3);
  to(graph.air.gain, clarity * 6);
  to(graph.sparkleGain.gain, clarity * 0.14);
  to(graph.vocalGain.gain, singing ? 0 : vocal * 0.55);
  to(graph.lowKeep.gain, singing ? 1 : 0);
  to(graph.highKeep.gain, singing ? 0.6 : 0);

  // "centre" is how much of what both ears share is kept; "width" is how far
  // the differences are pushed apart. Sing-along drops the centre almost away.
  const centre = singing ? 0.06 : 1;
  const width = singing ? 1.5 : 1 + space * 0.9;
  to(graph.ll.gain, (centre + width) / 2);
  to(graph.rr.gain, (centre + width) / 2);
  to(graph.lr.gain, (centre - width) / 2);
  to(graph.rl.gain, (centre - width) / 2);
  to(graph.wet.gain, singing ? 0 : space * 0.3);
  // The room costs processor time, so it is only wired in while it is used.
  const wantRoom = space > 0.01 && !singing;
  if (wantRoom !== roomOn) {
    try {
      if (wantRoom) graph.mix.connect(graph.room);
      else graph.mix.disconnect(graph.room);
      roomOn = wantRoom;
    } catch { /* already in that state */ }
  }

  // Loudness: squeeze the loud parts gently, then raise everything so the
  // loudest moments sit back near the top. Quiet passages come up the most.
  const threshold = loud > 0 ? -6 - loud * 18 : 0;
  const ratio = 1 + loud * 2.5;
  // How far a full-scale sound is pulled down by the squeeze (a negative number of dB).
  const pulled = threshold * (1 - 1 / ratio);
  // The browser's compressor already restores 60% of that by itself; add the rest.
  const restore = 0.4 * -pulled - 0.5 * Math.min(1, -pulled / 4);
  to(graph.leveller.threshold, threshold);
  to(graph.leveller.ratio, ratio);
  to(graph.makeup.gain, db(restore));

  // Leave headroom for whatever was boosted; the limiter catches the rest.
  to(graph.input.gain, db(-(boost * 0.5 + bass * 2.5 + clarity * 1 + vocal * 2)));
}

/** How loud the output is right now (0…1) — used by tests to confirm sound is flowing and not clipping. */
export function meter(): { rms: number; peak: number; state: string } | null {
  if (!g) return null;
  const data = new Float32Array(g.analyser.fftSize);
  g.analyser.getFloatTimeDomainData(data);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sum += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  return { rms: Math.sqrt(sum / data.length), peak, state: g.ctx.state };
}
