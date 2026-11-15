// Ambient sound: procedural WebAudio, no audio files. Buffers are generated once in unlock() (a few tens of ms);
// update() steers the mix at 4 Hz and fires one-shots. main.js: new Ambience(env, app); unlock() on the first user
// gesture; setEnabled(b); setVolume(v); update(dt). `active` is true only while the context runs.
//
// The bed is meant to sound like a head under water with the ears plugged: low, enclosed, slow and liquid, with
// distinct bubbles and almost nothing above ~1 kHz (no broadband hiss: an earlier pink-noise wash and a dense
// snapping-shrimp crackle read as radio static). Animal calls and bubbles stay clear on top of it.
// Layers (one bus each, see levels()):
//   base     brown noise -> two cascaded lowpasses (~410 Hz shallow, ~150 Hz deep), two slow swell LFOs
//   slosh    water moving around the head: two noise voices through a wandering, gurgling bandpass (~130-500 Hz),
//            with irregular surges every 2-6 s and slow stereo drift; strongest in shallow, wave and surge zones
//   hum      faint 41/62/83 Hz drone in abyss, deep plain, vents, hadal
//   shrimp   sparse, soft, distant snapping-shrimp pops (low-passed) on reefs, seagrass, mangrove, tidepools...
//   vent     brown-noise rumble at vents/champagne; bubbles: a looped generated bubble stream
//   chorus   evening/night fish chorus on reefs: trains of low harmonic pops (sweepers), only after dusk
//   rain     soft muffled patter when it rains and the surface is open overhead
//   fx       one-shots: wave slaps, cave drips, ice creaks/groans/pings, kelp creaks
//   bub      bubble one-shots everywhere: small rising trails and rare big low glugs (denser when moving fast or
//            when animals pass close), with their own voice cap
//   life     calls of the nearest calling animals (up to five) (see VOICE), diver exhale bubbles, distant song
//   reverb   one generated impulse response; caves and ice send base and fx, distant animals send most of their call
// Mix: bed buses (base..fx) -> two lowpasses ("ears plugged", ~1.6 kHz) -> duck (dips under a close call) -> master;
// bub, bubbles, life and reverb reach the master through gentler lowpasses. master (volume, enable) -> compressor ->
// limiter -> out. Disabled or hidden: ramp down, then suspend.

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const R = (a, b) => a + (b - a) * Math.random();
const pick = (a) => a[(Math.random() * a.length) | 0];
const ri = (n) => (Math.random() * n) | 0;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const LAYERS = ['base', 'slosh', 'hum', 'shrimp', 'vent', 'bubbles', 'chorus', 'rain', 'fx', 'bub', 'life', 'reverb'];
const STEERED = LAYERS.slice(0, 8); // buses whose gain follows the zone mix
const BED = ['base', 'slosh', 'hum', 'shrimp', 'vent', 'chorus', 'rain', 'fx']; // through the "ears plugged" lowpass

// Per-zone amounts (0..1), blended by the sequence weights. song/seal: chance of distant calls with no animal near.
// wash: surface water movement (slosh surges, wave slaps) when shallow and open to the sky. chorus: night fish chorus.
const Z0 = { shrimp: 0, kelp: 0, vent: 0, bubbles: 0, ice: 0, cave: 0, hum: 0, song: 0, seal: 0, wash: 1, chorus: 0 };
const PROFILE = {
  reef: { shrimp: 0.9, chorus: 1 }, softcoral: { shrimp: 0.7, chorus: 0.8 }, wall: { shrimp: 0.4, song: 0.3, chorus: 0.6 },
  kelp: { kelp: 1, shrimp: 0.3 }, seagrass: { shrimp: 0.8 }, mangrove: { shrimp: 1 }, sandflat: { shrimp: 0.4 }, pelagic: { song: 1 },
  cave: { cave: 1, chorus: 0.5 }, wreck: { shrimp: 0.3, chorus: 0.6 }, ruins: { shrimp: 0.3, chorus: 0.6 }, vents: { vent: 1, bubbles: 0.5, hum: 0.5 },
  deepplain: { hum: 0.6 }, tidepool: { shrimp: 0.8, wash: 1.5 }, abyss: { hum: 0.8, song: 0.3 }, polar: { ice: 1, song: 0.3, seal: 0.6 },
  seamount: { shrimp: 0.3, song: 0.6, chorus: 0.4 }, sargassum: { song: 0.5 }, champagne: { bubbles: 1, vent: 0.3, shrimp: 0.4, chorus: 0.7 },
  jellylake: {}, sunkenforest: { kelp: 0.5 }, anemone: { shrimp: 0.7, chorus: 0.8 }, bluehole: { cave: 0.4, song: 0.3, chorus: 0.5 },
  otterkelp: { kelp: 1, shrimp: 0.4, wash: 1.3 }, whaleshark: { song: 0.7 }, biobay: { shrimp: 0.9 },
  iceedge: { ice: 0.8, song: 0.6, seal: 1 }, hadal: { hum: 1 },
  lostcity: { hum: 0.8, vent: 0.15 }, // Lost City: the deep hum; its vents only weep, so barely a hiss
};
PROFILE.coldcoral = { hum: 0.55, shrimp: 0.15 }; // --- coldcoral --- (deep hum, a faint crackle from the reef)
PROFILE.whalefall = { hum: 0.7 }; // --- whalefall --- (the deep hum, nothing else: a quiet place)
for (const k in PROFILE) PROFILE[k] = { ...Z0, ...PROFILE[k] };
// species key -> call voice. Every voice is a sound the species is documented to make (docs/SOURCES.md, "Sounds").
const CALLS = {
  humpback: 'humpback', blueWhale: 'blue', spermWhale: 'sperm', orca: 'orca', pilotWhale: 'pilot', bottlenose: 'dolphin',
  commonDolphin: 'dolphin', beluga: 'beluga', narwhal: 'narwhal', weddellSeal: 'weddell', leopardSeal: 'leopard', harbourSeal: 'harbour',
  seaLion: 'sealion', harpSeal: 'harp', ringedSeal: 'ringed', bowhead: 'bowhead', manatee: 'manatee', dugong: 'dugong',
  seaOtter: 'otter', seaOtterUrchin: 'otter', seaOtterMom: 'otter',
  goliath: 'boom', giantSeaBass: 'gsb', clownfish: 'clown', pinkSkunkClown: 'clown', tomatoClown: 'clown', blackClown: 'clown',
  clarkClown: 'clown', dominoDamsel: 'damsel', sergeant: 'damsel', garibaldi: 'thump', grunt: 'grunt', parrotfish: 'crunch',
  spinyLobster: 'rasp', seahorse: 'seahorse', sweeper: 'sweeper', kelpRockfish: 'rockfish',
};
// per voice: [audible range (m), seconds between calls while near (lo, hi), seconds the bed ducks under a close call]
// (gaps shrink while the animal is in view and for bigger groups; fish are quiet, so they are heard only up close)
const VOICE = {
  humpback: [160, 5, 14, 6], blue: [160, 12, 28, 9], sperm: [160, 7, 18, 4], orca: [130, 3, 9, 1.5], pilot: [120, 3, 8, 1.2],
  dolphin: [120, 4, 10, 1.2], beluga: [120, 2, 6, 1.2], narwhal: [120, 4, 9, 1.5], weddell: [130, 5, 13, 6], leopard: [130, 6, 14, 5],
  sealion: [100, 3, 9, 1.5], harbour: [110, 6, 15, 3], harp: [110, 3, 9, 2], ringed: [100, 4, 11, 1.5], bowhead: [160, 7, 18, 6],
  manatee: [70, 3, 9, 1.5], dugong: [70, 3, 9, 1.5], otter: [60, 6, 14, 3], boom: [60, 4, 12, 1.5], gsb: [60, 4, 12, 1.5], clown: [25, 2, 6, 0.5],
  damsel: [30, 2, 7, 0.6], thump: [28, 3, 8, 0.6], grunt: [30, 2.5, 7, 0.8], crunch: [35, 4, 10, 1.2], rasp: [22, 4, 11, 0.8],
  seahorse: [14, 4, 12, 0.4], sweeper: [40, 2.5, 7, 0.8], rockfish: [18, 4, 11, 0.5],
};
const LIFE_GAIN = 1.7; // animal calls sit ~4.6 dB above where they were, and fall off more slowly with distance

// ---------- generated buffers ----------
// Seamless loop: render len + F samples, then equal-power crossfade the overshoot into the start.
function loopBuffer(ctx, sec, fill, rms = 0.2) {
  const sr = ctx.sampleRate, len = Math.round(sec * sr), F = Math.round(0.25 * sr);
  const x = new Float32Array(len + F); fill(x, sr);
  const buf = ctx.createBuffer(1, len, sr), b = buf.getChannelData(0);
  b.set(x.subarray(0, len));
  for (let i = 0; i < F; i++) { const w = i / F; b[i] = x[i] * Math.sqrt(w) + x[len + i] * Math.sqrt(1 - w); }
  let e = 0; for (let i = 0; i < len; i += 7) e += b[i] * b[i];
  const k = rms / Math.sqrt(e / Math.ceil(len / 7) || 1);
  for (let i = 0; i < len; i++) b[i] *= k;
  return buf;
}
// one-shot buffer normalised to a peak of 0.8
function shotBuffer(ctx, sec, fill) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, Math.round(sec * sr), sr), x = buf.getChannelData(0);
  fill(x, sr);
  let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] *= 0.8 / p;
  return buf;
}
function pink(x) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < x.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
  }
}
function brown(x) { let l = 0; for (let i = 0; i < x.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; x[i] = l; } }
// gurgle control signal (-1..1): random steps every 40-150 ms, smoothed, so a bandpass driven by it babbles like water
function gurgle(x, sr) {
  let v = 0, y = 0, next = 0; const a = 1 - Math.exp(-1 / (0.022 * sr));
  for (let i = 0; i < x.length; i++) {
    if (i >= next) { v = Math.random() * 2 - 1; next = i + ((R(0.04, 0.15) * sr) | 0); }
    y += a * (v - y); x[i] = y;
  }
}
// snapping shrimp, far off: sparse soft snaps (power-law amplitudes); the graph low-passes them into pops
function ticks(x, sr) {
  const n = x.length, count = Math.round(n / sr * 6);
  for (let k = 0; k < count; k++) {
    const p = (Math.random() * n) | 0, a = (0.08 + 0.92 * Math.random() ** 5) * (Math.random() < 0.5 ? -1 : 1);
    const tau = sr * R(0.0002, 0.0006);
    for (let j = 0; j < 6 * tau; j++) x[(p + j) % n] += a * Math.exp(-j / tau) * (j === 0 ? 1 : Math.random() * 2 - 1);
  }
}
// one bubble: Minnaert ring with the upward chirp of a rising bubble (damp: fraction of a cycle's energy lost)
function bubble(x, i0, f0, amp, sr, damp = R(0.04, 0.08), chirp = R(0.1, 0.5)) {
  const tau = 1 / (Math.PI * f0 * damp) * sr, n = Math.min(x.length - i0, (5 * tau) | 0);
  let ph = 0;
  for (let j = 0; j < n; j++) { ph += 2 * Math.PI * f0 * (1 + chirp * j / tau) / sr; x[i0 + j] += amp * Math.sin(ph) * Math.exp(-j / tau); }
}
function bubbleStream(x, sr) {
  let t = 0;
  while (t < x.length) { // clustered: bursts of a few bubbles, then a pause
    const m = 1 + ((Math.random() * 5) | 0);
    for (let k = 0; k < m && t < x.length; k++) { bubble(x, t, R(350, 1600), R(0.2, 1), sr); t += (sr * R(0.01, 0.05)) | 0; }
    t += (sr * R(0.02, 0.25)) | 0;
  }
}
// a short trail of small bubbles rising past: a few clusters, each bubble a little lower than the last
function bubbleTrail(x, sr) {
  let t = (0.01 * sr) | 0, f = R(380, 1150), a = 1;
  for (let k = 4 + ri(9); k > 0 && t < x.length - sr * 0.1; k--) {
    bubble(x, t, f * R(0.8, 1.25), a * R(0.5, 1), sr, R(0.05, 0.09), R(0.15, 0.4));
    t += (sr * (Math.random() < 0.3 ? R(0.08, 0.2) : R(0.015, 0.06))) | 0;
    f *= R(0.9, 1.02); a *= R(0.8, 0.97);
  }
}
// big, low bubbles leaving something under water ("glug"): 1-3 of them, ringing longer than small ones
function bubbleGlug(x, sr) {
  let t = (0.01 * sr) | 0;
  for (let k = 1 + ri(3); k > 0; k--) { bubble(x, t, R(110, 380), R(0.6, 1), sr, R(0.025, 0.045), R(0.05, 0.25)); t += (sr * R(0.07, 0.22)) | 0; }
}
function rainPatter(x, sr) {
  const n = x.length, count = Math.round(n / sr * 260);
  for (let k = 0; k < count; k++) {
    const p = (Math.random() * n) | 0, f = R(500, 1600), a = 0.05 + 0.95 * Math.random() ** 3, tau = sr * R(0.004, 0.01);
    for (let j = 1; j < 6 * tau; j++) x[(p + j) % n] += a * Math.sin(2 * Math.PI * f * j / sr) * Math.exp(-j / tau);
  }
}
// evening reef chorus: trains of 1-7 short harmonic pops (~360-420 Hz, ~8 ms) from many fish at once
function chorusLoop(x, sr) {
  const n = x.length, trains = Math.round(n / sr * 7);
  for (let k = 0; k < trains; k++) {
    let p = (Math.random() * n) | 0;
    const f = R(340, 420), a = 0.15 + 0.85 * Math.random() ** 2, per = R(0.05, 0.11) * sr;
    for (let m = 1 + ((Math.random() ** 1.6 * 7) | 0); m > 0; m--) {
      pop(x, p, f, 0.0026 * sr, a * R(0.7, 1), sr, n);
      p += (per * R(0.85, 1.15)) | 0;
    }
  }
}
// a damped harmonic pulse (fundamental + a little octave), wrapped around the buffer when `wrap` is given
function pop(x, i0, f, tau, a, sr, wrap) {
  const len = (6 * tau) | 0, att = 0.001 * sr;
  for (let j = 0; j < len; j++) {
    const i = wrap ? (i0 + j) % wrap : i0 + j; if (i >= x.length) break;
    const w = 2 * Math.PI * f * j / sr;
    x[i] += a * Math.min(1, j / att) * Math.exp(-j / tau) * (Math.sin(w) + 0.35 * Math.sin(2 * w + 0.5));
  }
}
// fish and invertebrate pulse sounds (played at other rates for size and species)
const PULSES = {
  // damselfish / clownfish pulse: ~600 Hz at rate 1, ~16 ms (jaw-slam "pop"; chirps are trains of them)
  pop: [0.03, (x, sr) => pop(x, 0, 600, 0.004 * sr, 1, sr)],
  // grunt: 6 stridulation pulses in ~47 ms with a ~700 Hz resonance
  grunt: [0.07, (x, sr) => { for (let p = 0; p < 6; p++) { const i0 = (p * 0.0078 * sr) | 0, a = R(0.6, 1); for (let j = 0; j < 0.006 * sr; j++) { const e = Math.exp(-j / (0.0015 * sr)); x[i0 + j] += a * e * (0.6 * Math.sin(2 * Math.PI * 700 * j / sr) + 0.4 * (Math.random() * 2 - 1)); } } }],
  // swim-bladder boom: rises over ~1.5 cycles of 60 Hz, then decays exponentially; soft-clipped for audible harmonics
  boom: [0.45, (x, sr) => { const f = 60, rise = 1.5 / f; for (let j = 0; j < x.length; j++) { const t = j / sr, e = t < rise ? Math.sin(0.5 * Math.PI * t / rise) : Math.exp(-(t - rise) / 0.07); x[j] = Math.tanh(1.8 * e * Math.sin(2 * Math.PI * f * t)); } }],
  // low thump: grinding pharyngeal teeth, amplified by the swim bladder (~160 Hz, gritty onset)
  thump: [0.09, (x, sr) => { for (let j = 0; j < x.length; j++) { const t = j / sr; x[j] = Math.exp(-t / 0.018) * (Math.sin(2 * Math.PI * 160 * t) + (t < 0.006 ? 0.5 * (Math.random() * 2 - 1) : 0)); } }],
  // stone on shell: a hard click with a few shell/stone modes and a dull thud under it
  tap: [0.05, (x, sr) => { for (let j = 0; j < x.length; j++) { const t = j / sr; x[j] = Math.exp(-t / 0.0012) * (Math.random() * 2 - 1) + 0.45 * Math.exp(-t / 0.0025) * Math.sin(2 * Math.PI * 1150 * t) + 0.3 * Math.exp(-t / 0.002) * Math.sin(2 * Math.PI * 1930 * t) + 0.7 * Math.exp(-t / 0.012) * Math.sin(2 * Math.PI * 210 * t); } }],
  // a bite through shell or coral: a burst of small cracks, densest at the start
  crunch: [0.26, (x, sr) => { for (let k = 0; k < 45; k++) { const i0 = (Math.random() ** 1.8 * 0.22 * sr) | 0, a = R(0.2, 1) * (1 - i0 / x.length), f = R(900, 2600), tau = R(0.0006, 0.002) * sr; for (let j = 0; j < 5 * tau && i0 + j < x.length; j++) x[i0 + j] += a * Math.exp(-j / tau) * (0.5 * Math.sin(2 * Math.PI * f * j / sr) + 0.5 * (Math.random() * 2 - 1)); } }],
  // spiny lobster rasp: stick-slip pulses at ~190 per second (rate 0.66-1.4 gives 125-265)
  rasp: [0.5, (x, sr) => { for (let t = 0; t < x.length - 0.003 * sr; t += sr / 190 * R(0.9, 1.1)) { const i0 = t | 0, a = R(0.5, 1); for (let j = 0; j < 0.0025 * sr; j++) x[i0 + j] += a * Math.exp(-j / (0.0005 * sr)) * (Math.random() * 2 - 1); } }],
  // seahorse click: short, energy 50-800 Hz (skull stridulation)
  click: [0.02, (x, sr) => { for (let j = 0; j < x.length; j++) { const t = j / sr; x[j] = Math.exp(-t / 0.0025) * (0.8 * Math.sin(2 * Math.PI * 420 * t) + 0.4 * Math.sin(2 * Math.PI * 170 * t)) + (j < 0.0003 * sr ? 0.4 * (Math.random() * 2 - 1) : 0); } }],
  // sweeper pop: ~380 Hz, ~8 ms
  spop: [0.015, (x, sr) => pop(x, 0, 380, 0.0026 * sr, 1, sr)],
};
// a diver's exhale: a rush of large bubbles that tapers off
function exhale(ctx) {
  const sr = ctx.sampleRate, len = Math.round(1.6 * sr), buf = ctx.createBuffer(1, len, sr), x = buf.getChannelData(0);
  for (let k = 0; k < 70; k++) {
    const t = Math.random() ** 1.6 * 1.3;
    bubble(x, (t * sr) | 0, R(250, 1100), (1 - t / 1.4) * R(0.15, 0.5), sr);
  }
  return buf;
}
// clicks: 'tick' (dolphin, narwhal) and 'knock' (sperm whale: multi-pulse)
function click(ctx, knock) {
  const sr = ctx.sampleRate, len = Math.round(0.03 * sr), buf = ctx.createBuffer(1, len, sr), x = buf.getChannelData(0);
  const pulses = knock ? 4 : 1, tau = sr * (knock ? 0.0009 : 0.00018);
  for (let p = 0; p < pulses; p++) {
    const i0 = Math.round(p * 0.0045 * sr), a = Math.pow(0.55, p);
    for (let j = 0; i0 + j < len && j < 8 * tau; j++) x[i0 + j] += a * Math.exp(-j / tau) * (Math.random() * 2 - 1);
  }
  return buf;
}
// stereo impulse: early reflections, then a decaying noise tail that darkens with time
function impulse(ctx, sec) {
  const sr = ctx.sampleRate, len = Math.round(sec * sr), buf = ctx.createBuffer(2, len, sr), pre = Math.round(0.008 * sr);
  for (let c = 0; c < 2; c++) {
    const x = buf.getChannelData(c);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr, a = 0.85 - 0.75 * Math.min(1, t / sec);
      y += a * ((Math.random() * 2 - 1) - y);
      x[i] = y * Math.exp(-6.9 * t / sec);
    }
    for (let k = 0; k < 8; k++) x[pre + ((R(0.004, 0.06) * sr) | 0)] += R(-0.6, 0.6);
  }
  return buf;
}

export class Ambience {
  constructor(env, app) {
    this.env = env; this.app = app;
    this.active = false; this.enabled = true; this.volume = 0.6;
    this.ctx = null; this.unlocked = false;
    const low = env && env.tier === 'low';
    this.voices = 0; this.cap = low ? 8 : 12;      // animal calls and other one-shots
    this.bVoices = 0; this.bCap = low ? 3 : 5;     // bubble one-shots
    this.Z = { ...Z0 };   // blended zone amounts
    this.mix = {};        // latest bus targets (debug)
    this.cand = Array.from({ length: low ? 3 : 5 }, () => ({ kind: '', d: 1e9, pan: 0, uid: 0, vis: false, n: 1 })); // nearest callers
    this.nCand = 0;
    this._due = new Map(); // encounter uid -> time of its next call
    this.diverD = 1e9; this.diverPan = 0; this.closeN = 0;
    this._next = 0; this._scan = 0; this._susT = 0; this._lifeFar = true; this._lastS = null; this.speed = 0; this.night = 0;
    this._dueE = { slap: 0, drip: 0, ice: 0, kelp: 0, life: 0, diver: 0, trail: 0, glug: 0 };
    this._curve = new Float32Array(16); // reused frequency contours (setValueCurveAtTime copies it)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => (document.hidden ? this._suspend() : this._resume()));
  }

  unlock() {
    if (!AC) return;
    if (!this.ctx) {
      try { this._build(); } catch (e) {
        // a context that was created but failed to build would otherwise stay open (browsers allow only a few)
        if (this.ctx && this.ctx.state !== 'closed') this.ctx.close().catch(() => {});
        this.ctx = null; return;
      }
    }
    this.unlocked = true;
    this._resume();
  }
  setEnabled(b) { this.enabled = !!b; if (this.enabled) this._resume(); else this._suspend(); }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    if (this.ctx && this.enabled) this.master.gain.setTargetAtTime(this._level(), this.ctx.currentTime, 0.15);
  }
  _level() { return 0.9 * Math.pow(this.volume, 1.6); }
  _resume() {
    const c = this.ctx;
    if (!c || !this.unlocked || !this.enabled || c.state === 'closed' || (typeof document !== 'undefined' && document.hidden)) return;
    clearTimeout(this._susT);
    if (c.state !== 'running') c.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(c.currentTime);
    this.master.gain.setTargetAtTime(this._level(), c.currentTime, 0.5);
  }
  _suspend() {
    const c = this.ctx;
    if (!c || c.state === 'closed') return;
    this.master.gain.cancelScheduledValues(c.currentTime);
    this.master.gain.setTargetAtTime(0, c.currentTime, 0.06);
    clearTimeout(this._susT);
    this._susT = setTimeout(() => {
      if (!this.enabled || (typeof document !== 'undefined' && document.hidden)) c.suspend().catch(() => {});
    }, 400);
  }

  // ---------- graph ----------
  _build() {
    const c = this.ctx = new AC({ latencyHint: 'playback' });
    c.onstatechange = () => { this.active = c.state === 'running'; };
    const low = this.env && this.env.tier === 'low';
    const pulses = {};
    for (const k in PULSES) pulses[k] = shotBuffer(c, PULSES[k][0], PULSES[k][1]);
    this.buf = {
      pink: loopBuffer(c, 5.3, pink), brown: loopBuffer(c, 6.1, brown), shrimp: loopBuffer(c, 4.7, ticks, 0.15),
      gurgle: loopBuffer(c, 3.7, gurgle, 0.55), bubbles: loopBuffer(c, 5.9, bubbleStream, 0.15), rain: null, chorus: null,
      trail: [0, 1, 2, 3].map(() => shotBuffer(c, 1.2, bubbleTrail)), glug: [0, 1, 2].map(() => shotBuffer(c, 0.9, bubbleGlug)),
      exhale: [exhale(c), exhale(c)], tick: click(c, false), knock: click(c, true), ...pulses,
    };
    const g = (v, to) => { const n = c.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
    const f = (type, hz, q, to) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = hz; n.Q.value = q; if (to) n.connect(to); return n; };
    const src = (b, rate = 1) => { const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * b.duration); return s; };
    const lfo = (hz, depth, param) => { const o = c.createOscillator(); o.frequency.value = hz; o.connect(g(depth, param)); o.start(); return o; };
    this._mk = { g, f, src };

    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.12;
    lim.connect(c.destination);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.03; comp.release.value = 0.4;
    comp.connect(lim);
    this.master = g(0, comp);
    // "ears plugged": the bed through two gentle lowpasses, then the duck that dips it under a close call
    this.duck = g(1, this.master);
    const bed = f('lowpass', 1500, 0.5, f('lowpass', 1800, 0.5, this.duck));
    const bubLP = f('lowpass', 3200, 0.5, this.master), lifeLP = f('lowpass', 7000, 0.5, this.master), revLP = f('lowpass', 3500, 0.5, this.master);
    const bus = this.bus = {};
    for (const k of LAYERS) bus[k] = g(k === 'fx' || k === 'life' || k === 'reverb' || k === 'bub' ? 1 : 0, BED.includes(k) ? bed : k === 'life' ? lifeLP : k === 'reverb' ? revLP : bubLP);

    // reverb (shorter impulse on the low tier)
    this.conv = c.createConvolver(); this.conv.buffer = impulse(c, low ? 1.5 : 2.6);
    this.revIn = g(1, this.conv); this.conv.connect(bus.reverb);

    const brownS = src(this.buf.brown), pinkS = src(this.buf.pink);
    // base: brown -> highpass 28 -> lowpass -> lowpass (depth) -> swell -> bus
    const swell = g(1, bus.base);
    this.baseLP = [f('lowpass', 400, 0.6, swell)]; this.baseLP.unshift(f('lowpass', 400, 0.5, this.baseLP[0]));
    brownS.connect(f('highpass', 28, 0.7, this.baseLP[0]));
    lfo(0.043, 0.3, swell.gain); lfo(0.0291, 0.22, swell.gain);
    this.baseRev = g(0, this.revIn); bus.base.connect(this.baseRev);
    // slosh: two voices, each noise -> lowpass -> gurgling bandpass -> surge envelope -> drifting pan
    this.slosh = [];
    for (const side of [-1, 1]) {
      let out = bus.slosh, pan = null;
      if (c.createStereoPanner) { pan = c.createStereoPanner(); pan.pan.value = 0.45 * side; pan.connect(bus.slosh); out = pan; lfo(R(0.02, 0.04), 0.4, pan.pan); }
      const env = g(0.2, out), bp = f('bandpass', 220, 5, env);
      const n = c.createBufferSource(); n.buffer = this.buf.pink; n.loop = true; n.playbackRate.value = R(0.9, 1.1); n.start(0, side > 0 ? 2.6 : 0.4);
      n.connect(f('lowpass', 700, 0.5, bp));
      const depth = g(150, bp.detune); src(this.buf.gurgle, side > 0 ? 1.13 : 0.89).connect(depth);
      lfo(R(0.05, 0.08), 40, bp.frequency);
      this.slosh.push({ env, bp, depth, due: 0 });
    }
    // hum
    for (const [hz, a] of [[41.2, 1], [61.9, 0.55], [82.6, 0.3]]) { const o = c.createOscillator(); o.frequency.value = hz; o.connect(g(a, bus.hum)); o.start(); lfo(R(0.02, 0.05), 0.6, o.detune); }
    // shrimp: sparse snaps, low-passed into soft pops; two offset loops at different rates never line up
    const shp = f('highpass', 250, 0.6, f('lowpass', 1100, 0.5, bus.shrimp));
    src(this.buf.shrimp, 1).connect(shp); src(this.buf.shrimp, 0.93).connect(shp);
    // vent rumble + bubble stream
    const vsw = g(1, bus.vent);
    brownS.connect(f('lowpass', 110, 1.2, vsw)); lfo(0.17, 0.35, vsw.gain);
    src(this.buf.bubbles, 1).connect(f('lowpass', 2400, 0.5, bus.bubbles));
    // rain and chorus loops are generated the first time they are needed (_lazy)
    this.rainLP = f('lowpass', 800, 0.5, bus.rain);
    this.chorusIn = f('lowpass', 1400, 0.5, bus.chorus);
    this.fxRev = g(0.3, this.revIn); bus.fx.connect(this.fxRev);
    this.lifeRev = g(0, this.revIn); bus.chorus.connect(this.lifeRev);
  }
  // loops only some zones and weathers use: built on first use, outside unlock()
  _lazy(k) {
    const c = this.ctx, b = this.buf, { src } = this._mk;
    if (k === 'rain' && !b.rain) { b.rain = loopBuffer(c, 3.9, rainPatter, 0.15); src(b.rain, 1).connect(this.rainLP); }
    if (k === 'chorus' && !b.chorus) { b.chorus = loopBuffer(c, 6.3, chorusLoop, 0.15); src(b.chorus, 1).connect(this.chorusIn); src(b.chorus, 0.97).connect(this.chorusIn); }
  }

  // ---------- 4 Hz control ----------
  update() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    if (now < this._next) return;
    const dt = now - (this._next - 0.25);
    this._next = now + 0.25;
    this._steer(now, dt);
    if (now >= this._scan) { this._scan = now + 1; this._look(now); }
    this._events(now);
  }

  _steer(now, dt) {
    const env = this.env, cam = env.camera.position, O = window.__ocean || {}, C = (O.conditions && O.conditions.out) || {};
    const Oz = -env.world.position.z, s = -(cam.z + Oz);
    // camera speed (m/s), for bubble density; a jump (zone change) reads as a stop, not a dash
    const ds = this._lastS === null ? 0 : Math.abs(s - this._lastS); this._lastS = s;
    this.speed += ((ds < 60 && dt > 0 ? ds / dt : 0) - this.speed) * 0.3;
    const Z = this.Z; for (const k in Z0) Z[k] = 0;
    let off = 0;
    const offs = (this.app && this.app.depthOffsets) || {};
    for (const e of env.seq.weights(s)) {
      const p = PROFILE[e.key] || Z0;
      for (const k in Z0) Z[k] += (p[k] ?? Z0[k]) * e.w;
      off += (offs[e.key] || 0) * e.w;
    }
    const camD = Math.max(0, -cam.y), D = camD + off;
    const head = env.shape.ceilingAt(cam.x, s) - cam.y;           // ice, cave roof or rock overhead
    const cover = clamp01((60 - head) / 50), open = 1 - cover;
    const night = this.night = C.night || 0, rain = C.rain || 0, surge = C.surge || 0;
    const shallow = Math.exp(-camD / 9), bright = Math.exp(-D / 45);
    Z.wash *= shallow * open; Z.iceAmt = Z.ice * (0.4 + 0.6 * cover); Z.caveAmt = Z.cave * cover;
    // how much water moves around the head: surface wash, surge weather, kelp swell; never quite still
    Z.slosh = Math.min(1.4, 0.3 + 0.1 * bright + 0.7 * Z.wash + 0.6 * surge + 0.3 * Z.kelp * Math.exp(-camD / 30));
    const m = this.mix;
    m.base = 0.34 * (0.35 + 0.65 * Math.exp(-D / 600));
    m.slosh = 4 * Z.slosh;
    m.hum = 0.022 * Z.hum;
    m.shrimp = 0.15 * Z.shrimp * (0.8 + 0.5 * night) * Math.exp(-camD / 70);
    m.vent = 0.4 * Z.vent;
    m.bubbles = 0.3 * Z.bubbles;
    m.chorus = 0.3 * Z.chorus * clamp01((night - 0.2) / 0.5) * Math.exp(-camD / 80);
    m.rain = 0.18 * rain * Math.exp(-camD / 20) * open;
    if (m.rain > 0.01) this._lazy('rain');
    if (m.chorus > 0.01) this._lazy('chorus');
    for (const k of STEERED) this.bus[k].gain.setTargetAtTime(m[k], now, 0.8);
    const lp = 150 + 260 * bright;
    for (const n of this.baseLP) n.frequency.setTargetAtTime(lp, now, 1);
    this.rainLP.frequency.setTargetAtTime(350 + 500 * Math.exp(-camD / 15), now, 1);
    this.baseRev.gain.setTargetAtTime(0.5 * (Z.caveAmt + 0.6 * Z.iceAmt), now, 1);
    this.fxRev.gain.setTargetAtTime(0.25 + 0.6 * Math.max(Z.caveAmt, Z.iceAmt), now, 1);
    this.lifeRev.gain.setTargetAtTime(0.3 + 0.5 * Z.caveAmt, now, 1);
    for (const v of this.slosh) if (now >= v.due) this._surge(v, now + R(0, 0.2), Z.slosh);
  }

  // one slosh surge: the water swells past (gain up, band rises, gurgle deepens), then drains away
  _surge(v, t, amt) {
    const up = R(0.35, 1.1), hold = R(0.1, 0.5), down = R(1, 2.8), pk = R(0.6, 1), top = t + up + hold;
    v.env.gain.cancelScheduledValues(t); v.bp.frequency.cancelScheduledValues(t); v.depth.gain.cancelScheduledValues(t);
    v.env.gain.setTargetAtTime(pk, t, up / 3); v.env.gain.setTargetAtTime(R(0.06, 0.15), top, down / 3);
    v.bp.frequency.setTargetAtTime(R(260, 500), t, up / 2); v.bp.frequency.setTargetAtTime(R(130, 200), top, down / 2);
    v.depth.gain.setTargetAtTime(R(500, 1000), t, 0.2); v.depth.gain.setTargetAtTime(R(150, 250), top, down / 2);
    v.due = top + down * R(0.3, 0.9) + R(0.4, 3) / (0.5 + amt);
    if (Math.random() < 0.25 * amt) this._bub(top - R(0, 0.3), true, 0.7 * amt);
  }

  // calling animals near the camera (the nearest 5, or 3 on low, within their voice's range) and the nearest diver, once a
  // second; reads encounter state and allocates nothing after the first sighting of an animal
  _look(now) {
    const O = window.__ocean || {}, cam = this.env.camera.position, Oz = -this.env.world.position.z;
    const me = this.env.camera.matrixWorld.elements, rx = me[0], ry = me[1], rz = me[2]; // camera right
    const cand = this.cand, K = cand.length; let nc = 0, close = 0;
    const enc = O.creatures && O.creatures.enc;
    if (enc) for (const e of enc) {
      if (e.done || !(e.fade > 0.3)) continue;
      if (e.dist < 6 && e.visible) close++;
      const kind = e.sp && CALLS[e.sp.key];
      if (!kind || e.dist > VOICE[kind][0]) continue;
      if (kind === 'sweeper' && this.night < 0.25) continue; // sweepers call after dusk
      // insert into the sorted list of the nearest K
      let i;
      if (nc < K) i = nc++;
      else if (e.dist < cand[K - 1].d) i = K - 1;
      else continue;
      const slot = cand[i];
      while (i > 0 && cand[i - 1].d > e.dist) { cand[i] = cand[i - 1]; i--; }
      cand[i] = slot;
      const b = e.bounds, dx = b.x - cam.x, dy = b.y - cam.y, dz = e.anchorZ + b.z - Oz - cam.z;
      slot.kind = kind; slot.d = e.dist; slot.uid = e.uid; slot.vis = !!e.visible; slot.n = e.n || 1;
      slot.pan = 0.8 * Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / (Math.hypot(dx, dy, dz) || 1)));
    }
    this.nCand = nc; this.closeN = close;
    for (let i = nc; i < K; i++) cand[i].d = 1e9;
    // forget animals that left; a new arrival calls within a few seconds
    for (const [uid, t] of this._due) if (t < now - 30) this._due.delete(uid);
    for (let i = 0; i < nc; i++) if (!this._due.has(cand[i].uid)) this._due.set(cand[i].uid, now + R(0.5, 3.5));
    this.diverD = 1e9;
    const a = O.surprises && O.surprises.active;
    if (a && !a.done && a.kind === 'divers' && a.divers) for (const d of a.divers) {
      const dx = d.x - cam.x, dy = d.y - cam.y, dz = d.z - Oz - cam.z, dd = Math.hypot(dx, dy, dz);
      if (dd < this.diverD) { this.diverD = dd; this.diverPan = 0.8 * Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / (dd || 1))); }
    }
  }

  _events(now) {
    const Z = this.Z, due = this._dueE, full = () => this.voices >= this.cap;
    const fire = (k, amt, lo, hi, fn) => {
      if (now < due[k]) return;
      if (amt < 0.08) { due[k] = now + R(lo, hi); return; }
      if (!full()) fn(now + R(0.05, 0.3), amt);
      due[k] = now + R(lo, hi) / Math.min(1, amt + 0.15);
    };
    fire('slap', Z.wash, 2, 7, (t, a) => this._slap(t, a));
    fire('drip', Z.caveAmt, 0.8, 5, (t, a) => this._drip(t, a));
    fire('ice', Z.iceAmt, 3, 14, (t, a) => { const r = Math.random(); r < 0.45 ? this._creak(t, a, false) : r < 0.75 ? this._groan(t, a) : this._ping(t, a); });
    fire('kelp', Z.kelp, 4, 15, (t, a) => this._creak(t, a * 0.6, true));
    // bubbles everywhere: trails at random intervals, denser when moving fast or with animals close; rare glugs
    const dens = 0.55 + 0.12 * Math.min(6, this.speed) + 0.5 * Math.min(2, this.closeN) + 0.6 * Z.bubbles + 0.4 * Z.vent + 0.3 * Z.wash;
    if (now >= due.trail) { this._bub(now + R(0.05, 0.3), false, 0.6 + 0.4 * Math.random()); due.trail = now + R(1.2, 5.5) / dens; }
    if (now >= due.glug) { this._bub(now + R(0.05, 0.3), true, R(0.6, 1)); due.glug = now + R(7, 20) / (0.8 + 0.5 * Z.wash + 0.3 * Z.slosh); }
    if (now >= due.diver) {
      due.diver = now + R(4, 7);
      if (this.diverD < 45 && !full()) this._exhale(now + 0.05, this.diverD, this.diverPan);
    }
    // animals near: each of the nearest callers calls on its own timer (sooner while in view or in a bigger group)
    let calls = 0;
    for (let i = 0; i < this.nCand; i++) {
      const n = this.cand[i], t = this._due.get(n.uid);
      if (t === undefined || now < t || calls) continue; // (one new call per tick; the others wait a tick)
      if (full()) { this._due.set(n.uid, now + R(0.5, 2)); continue; }
      const v = VOICE[n.kind];
      this._call(n.kind, now + R(0.05, 0.25), n.d, n.pan); this._duckFor(now, v[3], n.d); calls++;
      this._due.set(n.uid, now + R(v[1], v[2]) * (n.vis ? 0.7 : 1) / Math.min(1.6, 1 + 0.15 * (n.n - 1)));
    }
    if (this.nCand && this._lifeFar) this._lifeFar = false;
    if (!this.nCand && now >= due.life) { // far away, unseen: whale song in open water, seals under the ice
      const first = !this._lifeFar; this._lifeFar = true;
      const r = Math.random();
      if (!first && !full() && r < 0.5 * Z.song) this._call(pick(['humpback', 'humpback', 'blue', 'sperm']), now + 0.1, R(250, 600), R(-0.7, 0.7));
      else if (!first && !full() && r > 1 - 0.5 * Z.seal) this._call(pick(['weddell', 'weddell', 'leopard']), now + 0.1, R(120, 300), R(-0.7, 0.7));
      due.life = now + (first ? R(5, 25) : R(30, 100));
    }
  }

  // dip the bed under a call so it stands out (more for close animals)
  _duckFor(t, len, d) {
    const p = this.duck.gain, amt = 0.35 * clamp01(1.3 - d / 60);
    if (amt < 0.03) return;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(1 - amt, t, 0.12); p.setTargetAtTime(1, t + len, 0.8);
  }

  // ---------- one-shot helpers ----------
  // voice output: gain -> lowpass -> pan -> bus, plus a reverb send. Returns the input gain; its `chain` lists the
  // nodes after it, which _hold disconnects too (left wired to the bus, every voice ever played stayed in the graph).
  _out(pan, lp, gain, wet, bus) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter();
    g.gain.value = gain; f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5;
    g.connect(f);
    g.chain = [f];
    let o = f;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; f.connect(p); o = p; g.chain.push(p); }
    o.connect(bus);
    if (wet > 0) { const w = c.createGain(); w.gain.value = wet; o.connect(w); w.connect(this.revIn); g.chain.push(w); }
    return g;
  }
  // a call heard from d metres: quieter, darker and wetter with distance
  _far(d, pan, level, lpMax = 9000) {
    return this._out(pan, Math.min(lpMax, 500 + 9000 * Math.exp(-d / 60)), LIFE_GAIN * level / (1 + d / 45), Math.min(0.85, 0.12 + d / 160), this.bus.life);
  }
  // count a voice until its last source ends, then drop its chain (bubble voices have their own count)
  _hold(src, head, bub) {
    if (bub) this.bVoices++; else this.voices++;
    src.onended = () => { if (bub) this.bVoices--; else this.voices--; head.disconnect(); for (const n of head.chain) n.disconnect(); };
  }
  _env(param, t, a, peak, hold, rel) {
    param.setValueAtTime(0, t); param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + a + hold); param.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    return t + a + hold + rel;
  }
  _osc(type, hz, to) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = hz; if (to) o.connect(to); return o; }
  _gain(v, to) { const g = this.ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  _shot(buf, t, rate, to, offset = 0, dur) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.connect(to);
    if (dur) s.start(t, offset, dur); else s.start(t, offset);
    return s;
  }
  // n pulses of a prebuilt buffer, `per` seconds apart; returns the last source (it ends last) and the time after it
  _train(buf, t, n, per, rate, head, amp = 1, jit = 0.1) {
    let s = null;
    for (let i = 0; i < n; i++) { s = this._shot(buf, t, rate * R(0.97, 1.03), this._gain(amp * R(0.7, 1), head)); t += per * R(1 - jit, 1 + jit); }
    this._tEnd = t;
    return s;
  }
  // smooth random contour between lo and hi into this._curve
  _contour(lo, hi) {
    const k = this._curve, p = R(0.5, 2), ph = R(0, 6.28), tr = R(-0.6, 0.6), mid = Math.sqrt(lo * hi), span = Math.log2(hi / lo) / 2;
    for (let i = 0; i < 16; i++) { const u = i / 15; k[i] = mid * Math.pow(2, Math.max(-span, Math.min(span, span * (0.8 * Math.sin(ph + u * p * Math.PI) + tr * (u - 0.5))))); }
    return k;
  }

  // ---------- environment one-shots ----------
  // bubbles: a small trail rising past, or a big low glug
  _bub(t, glug, a) {
    if (this.bVoices >= this.bCap) return;
    const head = this._out(R(-0.75, 0.75), glug ? 1600 : R(2200, 3500), (glug ? 0.55 : 0.32) * a, 0.15, this.bus.bub);
    const s = this._shot(pick(glug ? this.buf.glug : this.buf.trail), t, R(0.8, 1.25), head); this._hold(s, head, true);
  }
  _slap(t, a) { // a wave breaking overhead, heard from below: a low wash that swells and drains
    const head = this._out(R(-0.6, 0.6), 900, 0.6 * Math.min(1, a), 0, this.bus.fx), c = this.ctx;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = R(160, 380); bp.Q.value = 1.2;
    const e = this._gain(0, head); bp.connect(e);
    const end = this._env(e.gain, t, R(0.08, 0.2), 1, 0.08, R(0.5, 1.1));
    bp.frequency.setValueAtTime(bp.frequency.value, t); bp.frequency.exponentialRampToValueAtTime(R(110, 160), end);
    const s = this._shot(this.buf.pink, t, R(0.8, 1.2), bp, R(0, 4)); s.stop(end + 0.05); this._hold(s, head);
  }
  _drip(t, a) {
    const head = this._out(R(-0.7, 0.7), 3000, 0.22 * Math.min(1, a), 0.85, this.bus.fx);
    for (let i = Math.random() < 0.25 ? 2 : 1; i > 0; i--) {
      const f0 = R(500, 1500), e = this._gain(0, head), o = this._osc('sine', f0, e);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(1.3, 2), t + 0.03);
      const end = this._env(e.gain, t, 0.002, 1, 0, R(0.08, 0.2));
      o.start(t); o.stop(end + 0.02);
      if (i === 1) this._hold(o, head);
      t += R(0.1, 0.4);
    }
  }
  // stick-slip creak: a jittery low sawtooth through a resonant band (ice: high and sharp; kelp/wood: low and soft)
  _creak(t, a, soft) {
    const c = this.ctx, head = this._out(R(-0.8, 0.8), soft ? 1500 : 4000, (soft ? 0.25 : 0.3) * Math.min(1, a), soft ? 0.2 : 0.5, this.bus.fx);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = soft ? R(180, 520) : R(500, 1800); bp.Q.value = soft ? 5 : 7;
    const e = this._gain(0, head); bp.connect(e);
    const o = this._osc('sawtooth', 10, bp), dur = soft ? R(0.6, 1.6) : R(1, 3);
    o.frequency.setValueCurveAtTime(this._contour(soft ? 3 : 6, soft ? 14 : 35), t, dur);
    const end = this._env(e.gain, t, 0.15, 1, dur - 0.4, 0.25);
    o.start(t); o.stop(end + 0.02); this._hold(o, head);
  }
  _groan(t, a) {
    const c = this.ctx, head = this._out(R(-0.8, 0.8), 600, 0.35 * Math.min(1, a), 0.6, this.bus.fx);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = R(250, 450); lp.Q.value = 5;
    const e = this._gain(0, head); lp.connect(e);
    const f0 = R(35, 80), dur = R(2, 5), o = this._osc('sawtooth', f0, lp);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(0.7, 1.4), t + dur);
    const end = this._env(e.gain, t, 0.6, 1, dur - 1.4, 0.8);
    o.start(t); o.stop(end + 0.02); this._hold(o, head);
  }
  _ping(t, a) {
    const head = this._out(R(-0.8, 0.8), 8000, 0.08 * Math.min(1, a), 0.8, this.bus.fx);
    const f0 = R(1500, 4500), e = this._gain(0, head), o = this._osc('sine', f0, e), dur = R(1, 2.5);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.97, t + dur);
    const end = this._env(e.gain, t, 0.003, 1, 0, dur);
    o.start(t); o.stop(end + 0.02); this._hold(o, head);
  }
  _exhale(t, d, pan) {
    const head = this._out(pan, 600 + 7000 * Math.exp(-d / 15), 0.5 / (1 + d / 8), 0.2, this.bus.life);
    const s = this._shot(pick(this.buf.exhale), t, R(0.85, 1.15), head); this._hold(s, head);
  }

  // ---------- animal calls ----------
  _call(kind, t, d, pan) {
    const c = this.ctx;
    if (kind === 'humpback') { // song phrase: 3-7 units with glides, some growled (FM)
      const head = this._far(d, pan, 0.5, 3000), base = R(110, 380);
      let last = null;
      for (let i = 3 + ((Math.random() * 5) | 0); i > 0; i--) {
        const f0 = base * Math.pow(2, R(-1, 1.2)), dur = R(0.5, 2), e = this._gain(0, head);
        const o = this._osc(Math.random() < 0.6 ? 'sine' : 'triangle', f0, e), m = this._osc('sine', f0 * pick([0.5, 1, 1.5, 2, 3]));
        const fp = o.frequency, sh = (Math.random() * 4) | 0;
        fp.setValueAtTime(f0 * [1, 1.6, 0.8, 1][sh], t);
        if (sh === 2) { fp.exponentialRampToValueAtTime(f0 * 1.5, t + dur / 2); fp.exponentialRampToValueAtTime(f0 * 0.9, t + dur); }
        else fp.exponentialRampToValueAtTime(f0 * [R(1.4, 2.5), 0.5, 1, 1.05][sh], t + dur);
        m.connect(this._gain(f0 * (Math.random() < 0.4 ? R(0.3, 1.5) : R(0, 0.15)), fp));
        const end = this._env(e.gain, t, 0.12, R(0.5, 1), Math.max(0, dur - 0.4), 0.3);
        o.start(t); m.start(t); o.stop(end); m.stop(end); last = o;
        t = end + R(0.15, 1.2);
      }
      this._hold(last, head);
    } else if (kind === 'blue') { // long low downsweep with its harmonics (the fundamental alone is below most speakers)
      const head = this._far(d, pan, 0.5, 800), e = this._gain(0, head), f0 = R(48, 55), dur = R(7, 12);
      const end = this._env(e.gain, t, 1.5, 1, dur - 3.5, 2);
      let last = null;
      for (const [h, a] of [[1, 1], [2, 0.6], [3, 0.35]]) {
        const o = this._osc('sine', f0 * h, this._gain(a, e));
        o.frequency.setValueAtTime(f0 * h, t); o.frequency.exponentialRampToValueAtTime(f0 * h * R(0.8, 0.88), t + dur);
        o.start(t); o.stop(end); last = o;
      }
      this._hold(last, head);
    } else if (kind === 'sperm') { // slow regular clicks, or a quick coda
      const head = this._far(d, pan, 0.7, 4000), coda = Math.random() < 0.4, n = coda ? 3 + ((Math.random() * 5) | 0) : 6 + ((Math.random() * 9) | 0);
      const gap = coda ? R(0.1, 0.25) : R(0.5, 1.2);
      let s = null;
      for (let i = 0; i < n; i++) { s = this._shot(this.buf.knock, t, R(0.9, 1.1), this._gain(R(0.6, 1), head)); t += gap * R(0.9, 1.1); }
      this._hold(s, head);
    } else if (kind === 'dolphin' || kind === 'pilot') {
      const lo = kind === 'pilot' ? 2500 : 4500, hi = kind === 'pilot' ? 8000 : 13000;
      if (Math.random() < 0.55) { // whistles, sometimes two animals overlapping
        const head = this._far(d, pan, 0.18);
        let last = null, lastEnd = 0;
        for (let i = Math.random() < 0.35 ? 2 : 1; i > 0; i--) {
          const dur = R(0.4, 1.4), e = this._gain(0, head), o = this._osc('sine', lo, e);
          o.frequency.setValueCurveAtTime(this._contour(lo, hi), t, dur);
          const end = this._env(e.gain, t, 0.04, 1, dur - 0.12, 0.08);
          o.start(t); o.stop(end + 0.02);
          if (end > lastEnd) { last = o; lastEnd = end; } // the chain lives until the later whistle ends
          t += R(0.2, 0.9);
        }
        this._hold(last, head);
      } else { // echolocation train, often closing into a buzz
        const head = this._far(d, pan, 0.3), n = 15 + ((Math.random() * 25) | 0), buzz = Math.random() < 0.6;
        let ici = R(0.04, 0.09), s = null;
        for (let i = 0; i < n; i++) { s = this._shot(this.buf.tick, t, R(0.8, 1.3), this._gain(R(0.5, 1), head)); t += ici; if (buzz) ici = Math.max(0.006, ici * 0.9); }
        this._hold(s, head);
      }
    } else if (kind === 'orca') { // pulsed call: harsh tone with a pitch step
      const head = this._far(d, pan, 0.12, 3000), e = this._gain(0, head), f0 = R(700, 1400), dur = R(0.6, 1.5);
      const o = this._osc('sawtooth', f0, e);
      o.frequency.setValueAtTime(f0, t); o.frequency.setValueAtTime(f0 * R(1.2, 1.6), t + dur * R(0.3, 0.6));
      o.frequency.exponentialRampToValueAtTime(f0 * R(0.8, 1.1), t + dur);
      const end = this._env(e.gain, t, 0.05, 1, dur - 0.15, 0.1);
      o.start(t); o.stop(end + 0.02); this._hold(o, head);
    } else if (kind === 'beluga') { // bursts of short chirps
      const head = this._far(d, pan, 0.16);
      let last = null;
      for (let i = 3 + ((Math.random() * 6) | 0); i > 0; i--) {
        const f0 = R(1000, 4000), dur = R(0.08, 0.3), e = this._gain(0, head), o = this._osc('sine', f0, e);
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? R(1.3, 2) : R(0.5, 0.8)), t + dur);
        const end = this._env(e.gain, t, 0.01, 1, dur - 0.04, 0.03);
        o.start(t); o.stop(end + 0.02); last = o;
        t = end + R(0.05, 0.25);
      }
      this._hold(last, head);
    } else if (kind === 'narwhal') { // slower click train with a low knock now and then
      const head = this._far(d, pan, 0.35), n = 10 + ((Math.random() * 20) | 0), ici = R(0.03, 0.12);
      let s = null;
      for (let i = 0; i < n; i++) { s = this._shot(Math.random() < 0.1 ? this.buf.knock : this.buf.tick, t, R(0.6, 0.8), this._gain(R(0.5, 1), head)); t += ici * R(0.85, 1.15); }
      this._hold(s, head);
    } else if (kind === 'weddell') { // descending trills, each starting lower
      const head = this._far(d, pan, 0.2, 7000);
      let f0 = R(2500, 5000), last = null;
      for (let i = 1 + ((Math.random() * 3) | 0); i > 0; i--) {
        const dur = R(2, 5), e = this._gain(0, head), am = this._gain(0.5, e), o = this._osc('sine', f0, am), l = this._osc('sine', R(8, 22));
        l.connect(this._gain(0.5, am.gain));
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(R(200, 500), t + dur);
        const end = this._env(e.gain, t, 0.2, 1, dur - 0.5, 0.3);
        o.start(t); l.start(t); o.stop(end + 0.02); l.stop(end + 0.02); last = o;
        t = end + R(0.3, 1.5); f0 *= R(0.6, 0.9);
      }
      this._hold(last, head);
    } else if (kind === 'leopard') { // low moan with a slow vibrato
      const head = this._far(d, pan, 0.25, 2500), e = this._gain(0, head), f0 = R(150, 320), dur = R(3, 6);
      const o = this._osc('triangle', f0, e), v = this._osc('sine', R(3, 6));
      v.connect(this._gain(f0 * 0.03, o.frequency));
      o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * R(0.85, 1.1), t + dur);
      const end = this._env(e.gain, t, 0.8, 1, dur - 1.6, 0.8);
      o.start(t); v.start(t); o.stop(end + 0.02); v.stop(end + 0.02); this._hold(o, head);
    } else if (kind === 'sealion') { // a few short buzzy barks, each sagging in pitch
      const head = this._far(d, pan, 0.14, 3500);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = R(500, 900); bp.Q.value = 1.2; bp.connect(head);
      let last = null;
      for (let i = 2 + ((Math.random() * 4) | 0); i > 0; i--) {
        const f0 = R(180, 420), dur = R(0.1, 0.25), e = this._gain(0, bp), o = this._osc('sawtooth', f0, e);
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(0.7, 0.9), t + dur);
        const end = this._env(e.gain, t, 0.015, 1, dur - 0.06, 0.045);
        o.start(t); o.stop(end + 0.02); last = o;
        t = end + R(0.12, 0.4);
      }
      this._hold(last, head);
    } else if (kind === 'harbour') { // male's underwater roar: a rough low buzz with its energy near 1.2 kHz
      const head = this._far(d, pan, 0.2, 4000), dur = R(1.5, 3.5), f0 = R(70, 110);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = R(1000, 1300); bp.Q.value = 0.9;
      const e = this._gain(0, head); bp.connect(this._gain(3, e));
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.connect(this._gain(0.06, e));
      const o = this._osc('sawtooth', f0), j = this._osc('sine', R(17, 29)); o.connect(bp); o.connect(lp);
      j.connect(this._gain(f0 * 0.18, o.frequency));
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(0.75, 0.9), t + dur);
      const end = this._env(e.gain, t, 0.3, 1, dur - 0.8, 0.5);
      o.start(t); j.start(t); o.stop(end + 0.02); j.stop(end + 0.02); this._hold(o, head);
    } else if (kind === 'harp') { // a call of 2-6 repeated elements (few harmonics, below ~3 kHz)
      const head = this._far(d, pan, 0.2, 6000), f0 = R(500, 2400), dur = R(0.12, 0.45), gap = R(0.05, 0.25), sh = ri(4);
      let last = null;
      for (let i = 2 + ri(5); i > 0; i--) {
        const e = this._gain(0, head), o = this._osc('triangle', f0, e), fp = o.frequency;
        fp.setValueAtTime(f0 * [1.3, 0.8, 1, 1][sh], t);
        if (sh === 3) { fp.linearRampToValueAtTime(f0 * 1.15, t + dur / 2); fp.linearRampToValueAtTime(f0 * 0.95, t + dur); }
        else fp.exponentialRampToValueAtTime(f0 * [0.7, 1.2, 1.02, 1][sh], t + dur);
        const end = this._env(e.gain, t, 0.02, 1, dur - 0.06, 0.04);
        o.start(t); o.stop(end + 0.02); last = o; t = end + gap;
      }
      this._hold(last, head);
    } else if (kind === 'ringed') { // simple barks and yelps, or a run of clicks
      const head = this._far(d, pan, 0.2, 6000);
      if (Math.random() < 0.7) {
        let last = null;
        for (let i = 1 + ri(4); i > 0; i--) {
          const f0 = R(400, 1200), dur = R(0.08, 0.35), e = this._gain(0, head), o = this._osc(Math.random() < 0.5 ? 'triangle' : 'sawtooth', f0, e);
          o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * R(1.1, 1.4), t + dur * 0.3); o.frequency.exponentialRampToValueAtTime(f0 * R(0.6, 0.85), t + dur);
          const end = this._env(e.gain, t, 0.01, 0.7, dur - 0.04, 0.03);
          o.start(t); o.stop(end + 0.02); last = o; t = end + R(0.1, 0.5);
        }
        this._hold(last, head);
      } else this._hold(this._train(this.buf.tick, t, 4 + ri(9), R(0.05, 0.15), R(0.4, 0.6), head, 0.8), head);
    } else if (kind === 'bowhead') { // a few moans at a constant pitch (25-900 Hz), sometimes repeated like a song
      const head = this._far(d, pan, 0.45, 1500);
      let last = null;
      const f1 = R(90, 400), rep = Math.random() < 0.4;
      for (let i = 2 + ri(3); i > 0; i--) {
        const f0 = rep ? f1 : R(80, 420), dur = R(1, 3), e = this._gain(0, head);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(900, f0 * 3); lp.Q.value = 0.7; lp.connect(e);
        const o = this._osc('sawtooth', f0, lp);
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * R(0.97, 1.03), t + dur);
        const end = this._env(e.gain, t, 0.25, 1, dur - 0.55, 0.3);
        o.start(t); o.stop(end + 0.02); last = o; t = end + R(0.4, 1.5);
      }
      this._hold(last, head);
    } else if (kind === 'manatee') { // squeaks between mother and calf: short harmonic tones, often hill-shaped
      const head = this._far(d, pan, 0.2, 9000);
      let last = null, f1 = R(1200, 2800);
      for (let i = 1 + ri(4); i > 0; i--) {
        const f0 = f1 * R(0.9, 1.1), dur = R(0.2, 0.8), hill = Math.random() < 0.6, e = this._gain(0, head);
        let lastO = null;
        for (const [h, a] of [[1, 1], [2, 0.35], [3, 0.15]]) {
          const o = this._osc('sine', f0 * h, this._gain(a, e)), fp = o.frequency;
          fp.setValueAtTime(f0 * h, t);
          if (hill) { fp.linearRampToValueAtTime(f0 * h * R(1.15, 1.35), t + dur * 0.45); fp.linearRampToValueAtTime(f0 * h * R(0.9, 1), t + dur); }
          else fp.linearRampToValueAtTime(f0 * h * R(0.95, 1.05), t + dur);
          o.start(t); o.stop(t + dur + 0.02); lastO = o;
        }
        this._env(e.gain, t, 0.03, 1, dur - 0.08, 0.05);
        last = lastO; t += dur + R(0.3, 1.2); f1 *= Math.random() < 0.5 ? R(1.1, 1.3) : R(0.75, 0.9); // the other animal answers
      }
      this._hold(last, head);
    } else if (kind === 'dugong') { // chirps (<60 ms), a rising trill, or a bark
      const head = this._far(d, pan, 0.3, 9000), r = Math.random();
      let last = null;
      if (r < 0.75) { // chirps, or a trill: a rising cascade of short notes
        const trill = r > 0.45, n = trill ? 6 + ri(10) : 2 + ri(5);
        let f0 = trill ? R(3000, 4000) : R(3000, 7000);
        for (let i = 0; i < n; i++) {
          const dur = trill ? R(0.05, 0.1) : R(0.025, 0.055), e = this._gain(0, head), o = this._osc('sine', f0, e);
          o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(1.1, 1.4), t + dur);
          const end = this._env(e.gain, t, 0.005, 1, dur - 0.015, 0.01);
          o.start(t); o.stop(end + 0.02); last = o;
          t = end + (trill ? R(0.01, 0.04) : R(0.08, 0.3)); if (trill) f0 *= R(1.03, 1.08); else f0 = R(3000, 7000);
        }
      } else { // bark: broadband, 500-2200 Hz, up to 120 ms
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = R(900, 1500); bp.Q.value = 0.8;
        const e = this._gain(0, head); bp.connect(e);
        const end = this._env(e.gain, t, 0.01, 1.4, R(0.04, 0.07), 0.04);
        last = this._shot(this.buf.pink, t, 1, bp, R(0, 4)); last.stop(end + 0.02);
      }
      this._hold(last, head);
    } else if (kind === 'otter') { // cracking a shell on a stone: several fast taps, then the crunch of the bite
      const head = this._far(d, pan, 0.4, 6000);
      let s = null;
      if (Math.random() < 0.75) { s = this._train(this.buf.tap, t, 3 + ri(6), R(0.12, 0.22), R(0.85, 1.15), head, 1, 0.15); t = this._tEnd + R(0.2, 0.6); }
      for (let i = 1 + ri(3); i > 0; i--) { s = this._shot(this.buf.crunch, t, R(0.8, 1.15), this._gain(R(0.45, 0.7), head)); t += R(0.3, 0.7); }
      this._hold(s, head);
    } else if (kind === 'boom' || kind === 'gsb') { // 1-3 low swim-bladder booms: goliath grouper ~60 Hz, giant sea bass lower
      const head = this._far(d, pan, 0.6, 1200), rate = kind === 'gsb' ? R(0.6, 0.8) : R(0.85, 1.15);
      this._hold(this._train(this.buf.boom, t, 1 + ri(3), R(0.5, 1.2), rate, head, 1, 0.2), head);
    } else if (kind === 'clown') { // dominant fish chasing: chirps (trains of jaw pops, ~90 ms) and single pops, 370-900 Hz
      const head = this._far(d, pan, 0.4, 4000), rate = R(0.62, 1.5);
      let s = null;
      for (let i = 1 + ri(4); i > 0; i--) {
        const chirp = Math.random() < 0.6;
        s = this._train(this.buf.pop, t, chirp ? 5 + ri(4) : 1 + ri(2), chirp ? R(0.011, 0.016) : R(0.05, 0.09), rate, head, 1, 0.1);
        t = this._tEnd + R(0.15, 0.6);
      }
      this._hold(s, head);
    } else if (kind === 'damsel') { // damselfish: pulsed "dip" calls (~16 ms pulses every ~35-40 ms, ~750-810 Hz) or pops
      const head = this._far(d, pan, 0.4, 4000);
      const dip = Math.random() < 0.55, rate = R(1.22, 1.38);
      this._hold(this._train(this.buf.pop, t, dip ? 4 + ri(7) : 1 + ri(2), dip ? R(0.035, 0.04) : R(0.08, 0.15), dip ? rate : rate * 0.75, head, 1, 0.08), head);
    } else if (kind === 'thump') { // garibaldi warning an intruder: low thumps
      const head = this._far(d, pan, 0.55, 2500);
      this._hold(this._train(this.buf.thump, t, 1 + ri(3), R(0.15, 0.45), R(0.85, 1.15), head, 1, 0.2), head);
    } else if (kind === 'grunt') { // grunts (~47 ms, ~700 Hz) in a series, about 155 ms apart
      const head = this._far(d, pan, 0.4, 4000), n = Math.min(6, 1 + ((-Math.log(1 - Math.random() * 0.98) * 1.3) | 0));
      this._hold(this._train(this.buf.grunt, t, n, 0.155, R(0.8, 1.2), head, 1, 0.2), head);
    } else if (kind === 'crunch') { // parrotfish grazing: rasping bites on coral
      const head = this._far(d, pan, 0.45, 3500);
      this._hold(this._train(this.buf.crunch, t, 2 + ri(4), R(0.3, 0.7), R(0.6, 0.85), head, 1, 0.25), head);
    } else if (kind === 'rasp') { // spiny lobster: 1-3 antennal rasps of 125-265 pulses a second
      const head = this._far(d, pan, 0.3, 4000);
      let s = null;
      for (let i = 1 + ri(3); i > 0; i--) { const dur = R(0.12, 0.4); s = this._shot(this.buf.rasp, t, R(0.66, 1.4), this._gain(1, head), 0, dur); t += dur + R(0.3, 0.8); }
      this._hold(s, head);
    } else if (kind === 'seahorse') { // feeding/courtship clicks, energy 50-800 Hz
      const head = this._far(d, pan, 0.35, 1500);
      this._hold(this._train(this.buf.click, t, 1 + ri(3), R(0.3, 1.2), R(0.8, 1.2), head, 1, 0.3), head);
    } else if (kind === 'sweeper') { // a shoal at night: a few overlapping trains of 1-7 low pops
      const head = this._far(d, pan, 0.35, 2500);
      let s = null, tEnd = 0;
      for (let i = 2 + ri(3); i > 0; i--) {
        const s1 = this._train(this.buf.spop, t + R(0, 0.6), 1 + ((Math.random() ** 1.6 * 7) | 0), R(0.05, 0.11), R(0.92, 1.08), head, R(0.5, 1), 0.15);
        if (this._tEnd > tEnd) { tEnd = this._tEnd; s = s1; }
      }
      this._hold(s, head);
    } else if (kind === 'rockfish') { // kelp rockfish: quiet, close-range pulse trains
      const head = this._far(d, pan, 0.3, 2000);
      this._hold(this._train(this.buf.pop, t, 3 + ri(6), R(0.04, 0.08), R(0.45, 0.55), head, 1, 0.1), head);
    }
  }

  // Debug: RMS level (dBFS) per bus; analysers are created on first call only.
  levels() {
    if (!this.ctx) return null;
    if (!this._an) {
      this._an = {}; this._ab = new Float32Array(2048);
      for (const k of [...LAYERS, 'master']) { const a = this.ctx.createAnalyser(); a.fftSize = 2048; (k === 'master' ? this.master : this.bus[k]).connect(a); this._an[k] = a; }
    }
    const o = {};
    for (const k in this._an) {
      this._an[k].getFloatTimeDomainData(this._ab);
      let e = 0; for (let i = 0; i < 2048; i++) e += this._ab[i] * this._ab[i];
      o[k] = Math.round(10 * Math.log10(e / 2048 + 1e-12) * 10) / 10;
    }
    return o;
  }
}
