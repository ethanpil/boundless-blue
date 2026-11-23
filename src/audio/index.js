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
//   lap      the underside of the surface lapping and slapping, in very shallow zones (a generated loop)
//   sand     dark sand and grit shifting under a heavy swell, gated by the slosh surges (reefs, sand flats)
//   fx       one-shots: wave slaps and breakers, cave drips and hollow glugs, ice creaks/groans/pings and trapped-air
//            squeaks, kelp creaks and wood knocks, pebbles in the surge, distant booms and thuds, wakes of big
//            animals, splashes and breaches at the surface, the whale-fall feeding (tearing, thrashing, scattering)
//   bub      bubble one-shots everywhere: trails, glugs, curtains, belches, fading fizz, vent gushes and seeps,
//            champagne streams; size, density and rhythm follow the zone family (FAMILY); own voice cap
//   life     calls of the nearest calling animals (up to five) (see VOICE), diver exhale bubbles, distant song;
//            each animal has its own pitch and tempo, some species have signature calls, groups answer and chorus
//   reverb   one generated impulse response; caves and ice send base and fx, distant animals send most of their call
// Each zone belongs to a family (ZONE_FAM -> FAMILY) that sets its liquid character: slosh band, surge pace and
// width, which water events happen and how often, and the bubble style. A slow "mood" (calmer and busier spells of
// a minute or so), the night (calmer) and the weather (rain, storm surge) vary the bed further.
// Mix: bed buses (base..fx) -> two lowpasses ("ears plugged", ~1.6 kHz) -> duck (dips under a close call) -> master;
// bub, bubbles, life and reverb reach the master through gentler lowpasses. master (volume, enable) -> compressor ->
// limiter -> out. Disabled or hidden: ramp down, then suspend.

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const R = (a, b) => a + (b - a) * Math.random();
const pick = (a) => a[(Math.random() * a.length) | 0];
const ri = (n) => (Math.random() * n) | 0;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const LAYERS = ['base', 'slosh', 'hum', 'shrimp', 'vent', 'bubbles', 'chorus', 'rain', 'lap', 'sand', 'fx', 'bub', 'life', 'reverb'];
const STEERED = LAYERS.slice(0, 10); // buses whose gain follows the zone mix
const BED = ['base', 'slosh', 'hum', 'shrimp', 'vent', 'chorus', 'rain', 'lap', 'sand', 'fx']; // through the "ears plugged" lowpass
// deterministic randoms (per animal traits, signature whistles, pod dialects, song themes)
const seeded = (s) => { let a = (s * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// Liquid character per zone family, blended by the zone weights like PROFILE.
//   sl: slosh level; slLo/slHi: slosh band (Hz); up/gap: surge rise time and spacing (x the default 0.35-1.1 s, 2-6 s);
//   width: stereo spread of the rumble; lap/swell/wood/hollow/far/deep/gush/fizz/seep/squeak/pebble: amounts of the
//   family's own sounds; bubD/bubF: bubble density and pitch (x); curtain/belch: amounts of those bubble events
const FAM0 = { sl: 1, slLo: 130, slHi: 500, up: 1, gap: 1, width: 0.5, lap: 0, swell: 0, wood: 0, hollow: 0, far: 0, deep: 0,
  gush: 0, fizz: 0, seep: 0, squeak: 0, pebble: 0, bubD: 1, bubF: 1, curtain: 0.3, belch: 0.3 };
const FAMILY = {
  // under a surface a metre or two up: quick light surges, lapping, pebbles, lots of small bubbles
  shallow: { sl: 1.1, slLo: 170, slHi: 600, up: 0.6, gap: 0.6, width: 0.6, lap: 1, pebble: 0.6, bubD: 1.4, bubF: 1.15, curtain: 0.4, belch: 0.2 },
  // a slow, heavy swell over coral and sand, with the sand shifting in it
  reef: { sl: 1, slLo: 90, slHi: 300, up: 1.8, gap: 1.6, width: 0.6, swell: 1, pebble: 0.2, bubD: 1, curtain: 0.5, belch: 0.4 },
  // kelp and drowned trees: medium surges, deep creaks and soft knocks of stipes and trunks
  forest: { sl: 0.9, slLo: 110, slHi: 380, up: 1.3, gap: 1.3, width: 0.5, wood: 1, swell: 0.4, pebble: 0.4, bubD: 0.9 },
  // caves and the blue hole: low, slow water, hollow resonant glugs, drips, long tail (reverb)
  cave: { sl: 0.6, slLo: 90, slHi: 260, up: 1.6, gap: 1.8, width: 0.3, hollow: 1, bubD: 0.7, bubF: 0.8, belch: 0.5, curtain: 0.1 },
  // open ocean: a wide slow rumble, long gentle surges, distant low booms
  open: { sl: 0.85, slLo: 70, slHi: 200, up: 2.5, gap: 2.4, width: 1, far: 1, bubD: 0.6, bubF: 0.85, curtain: 0.3, belch: 0.25 },
  // floating weed mats at the surface over open water
  sargassum: { sl: 0.9, slLo: 110, slHi: 380, up: 1.4, gap: 1.4, width: 0.9, far: 0.5, lap: 0.5, bubD: 0.9, curtain: 0.3, belch: 0.2 },
  // sunlit whale fall: open water over sand, with the swell reaching the bottom
  whalefall: { sl: 0.85, slLo: 80, slHi: 260, up: 2, gap: 1.8, width: 0.9, far: 0.6, swell: 0.5, bubD: 0.8, curtain: 0.3, belch: 0.35 },
  // under ice: creaks, groans and pings (PROFILE.ice) plus air trapped under the floes squeaking
  ice: { sl: 0.6, slLo: 100, slHi: 300, up: 1.5, gap: 1.8, width: 0.7, squeak: 1, bubD: 0.6, belch: 0.3, curtain: 0.15 },
  // the deep: little but a slow pressure rumble, rare big bubbles and distant thuds
  deep: { sl: 0.45, slLo: 60, slHi: 160, up: 3, gap: 3, width: 0.8, deep: 1, bubD: 0.25, bubF: 0.7, curtain: 0, belch: 0.12 },
  // black smokers: gushes of heavy bubbling over the rumble
  vent: { sl: 0.35, slLo: 70, slHi: 200, up: 2.5, gap: 2.5, width: 0.7, deep: 0.5, gush: 1, bubD: 0.6, bubF: 0.75, belch: 0.6, curtain: 0 },
  // Champagne Reef: streams of fine gas bubbles rising out of the sand
  fizz: { sl: 0.9, slLo: 110, slHi: 400, up: 1.2, gap: 1.2, width: 0.6, fizz: 1, swell: 0.4, bubD: 1.8, bubF: 1.2, curtain: 0.8 },
  // Lost City: deep, the chimneys only weep: a slow trickle of tiny bubbles and soft low gurgles
  seep: { sl: 0.45, slLo: 60, slHi: 170, up: 3, gap: 3, width: 0.8, deep: 0.7, seep: 1, bubD: 0.4, bubF: 0.8, belch: 0.1, curtain: 0 },
};
for (const k in FAMILY) FAMILY[k] = { ...FAM0, ...FAMILY[k] };
const ZONE_FAM = { tidepool: 'shallow', mangrove: 'shallow', seagrass: 'shallow', biobay: 'shallow', jellylake: 'shallow',
  reef: 'reef', sandflat: 'reef', softcoral: 'reef', anemone: 'reef', wall: 'reef', wreck: 'reef', ruins: 'reef',
  kelp: 'forest', otterkelp: 'forest', sunkenforest: 'forest', cave: 'cave', bluehole: 'cave',
  pelagic: 'open', whaleshark: 'open', seamount: 'open', sargassum: 'sargassum', whalefall: 'whalefall',
  polar: 'ice', iceedge: 'ice', abyss: 'deep', deepplain: 'deep', hadal: 'deep', coldcoral: 'deep',
  vents: 'vent', champagne: 'fizz', lostcity: 'seep' };
// animals whose dives in from the surface make a splash (heard from below), and big ones whose breaches, tail and
// flipper slaps carry down as thumps
const PLUNGE = new Set(['seaOtter', 'seaOtterUrchin', 'seaOtterMom', 'harbourSeal', 'seaLion', 'harpSeal', 'ringedSeal', 'leopardSeal',
  'weddellSeal', 'adeliePenguin', 'emperorPenguin', 'bottlenose', 'commonDolphin']);
const BREACH = new Set(['humpback', 'blueWhale', 'spermWhale', 'orca', 'pilotWhale', 'bowhead', 'beluga', 'narwhal', 'mantaFeed', 'manta']);
// voices whose group mates answer a call, and voices that call together in a big group
const ANSWER = new Set(['dolphin', 'pilot', 'beluga', 'orca', 'weddell', 'harp', 'sealion', 'clown', 'damsel', 'ringed', 'narwhal', 'squirrel', 'manatee']);
const CHORUS = new Set(['dolphin', 'pilot', 'beluga', 'narwhal', 'sweeper', 'orca', 'squirrel']);

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
PROFILE.whalefall = { song: 0.5 }; // --- whalefall --- (sunlit open water)
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
  soldierfish: 'squirrel', picasso: 'drum', arcticCod: 'cod', arcticCodIce: 'cod',
};
// per voice: [audible range (m), seconds between calls while near (lo, hi), seconds the bed ducks under a close call]
// (gaps shrink while the animal is in view and for bigger groups; fish are quiet, so they are heard only up close)
const VOICE = {
  humpback: [160, 5, 14, 6], blue: [160, 12, 28, 9], sperm: [160, 7, 18, 4], orca: [130, 3, 9, 1.5], pilot: [120, 3, 8, 1.2],
  dolphin: [120, 4, 10, 1.2], beluga: [120, 3, 8, 1.2], narwhal: [120, 4, 9, 1.5], weddell: [130, 5, 13, 6], leopard: [130, 6, 14, 5],
  sealion: [100, 3, 9, 1.5], harbour: [110, 6, 15, 3], harp: [110, 3, 9, 2], ringed: [100, 4, 11, 1.5], bowhead: [160, 7, 18, 6],
  manatee: [70, 3, 9, 1.5], dugong: [70, 3, 9, 1.5], otter: [60, 6, 14, 3], boom: [60, 4, 12, 1.5], gsb: [60, 4, 12, 1.5], clown: [25, 3, 8, 0.5],
  damsel: [30, 3, 9, 0.6], thump: [28, 3, 8, 0.6], grunt: [30, 2.5, 7, 0.8], crunch: [35, 4, 10, 1.2], rasp: [22, 4, 11, 0.8],
  seahorse: [14, 4, 12, 0.4], sweeper: [40, 2.5, 7, 0.8], rockfish: [18, 4, 11, 0.5],
  squirrel: [25, 3, 8, 0.5], drum: [20, 4, 11, 0.4], cod: [30, 3, 9, 0.6],
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
// (a rotating phasor with the pitch updated every 32 samples: several times cheaper than sin/exp per sample)
function bubble(x, i0, f0, amp, sr, damp = R(0.04, 0.08), chirp = R(0.1, 0.5)) {
  const tau = 1 / (Math.PI * f0 * damp) * sr, n = Math.min(x.length - i0, (5 * tau) | 0), dk = Math.exp(-1 / tau);
  let c = 1, s = 0, env = amp, cw = 1, sw = 0;
  for (let j = 0; j < n; j++) {
    if ((j & 31) === 0) {
      const w = 2 * Math.PI * f0 * (1 + chirp * (j + 16) / tau) / sr, m = 1 / Math.hypot(c, s);
      cw = Math.cos(w); sw = Math.sin(w); c *= m; s *= m;
    }
    const c2 = c * cw - s * sw; s = s * cw + c * sw; c = c2;
    x[i0 + j] += env * s; env *= dk;
  }
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
  // swim-bladder drumming pulse: about two cycles of 100 Hz (soldierfish growls and knocks, triggerfish drum rolls
  // and Arctic cod grunts at other rates)
  low: [0.03, (x, sr) => { for (let j = 0; j < x.length; j++) { const t = j / sr; x[j] = Math.exp(-t / 0.007) * Math.sin(2 * Math.PI * 100 * t) * Math.min(1, t / 0.0015); } }],
};
// ---- buffers generated on first use (_bank) ----
// a two-pole resonator ringing on noise: the building block of slaps, knocks and grit
function ring(x, i0, f, tau, a, sr, noise = 1) {
  const r = Math.exp(-1 / (tau * sr)), c = 2 * r * Math.cos(2 * Math.PI * f / sr);
  let y1 = 0, y2 = 0;
  const n = Math.min(x.length - i0, (6 * tau * sr) | 0), att = (0.002 * sr) | 0;
  for (let j = 0; j < n; j++) {
    const ex = j < att ? noise * (Math.random() * 2 - 1) * (1 - j / att) : 0;
    const y = ex + c * y1 - r * r * y2; y2 = y1; y1 = y; x[i0 + j] += a * y * 0.05;
  }
}
// the underside of the surface slapping and lapping: waves every 0.7-1.9 s, each one to three soft low slaps,
// sometimes a few small bubbles trapped by them
function lapLoop(x, sr) {
  let t = 0;
  while (t < x.length - sr * 0.4) {
    let s = t;
    for (let k = 1 + ri(3); k > 0; k--) { ring(x, s, R(160, 450), R(0.03, 0.09), R(0.4, 1), sr); s += (R(0.05, 0.2) * sr) | 0; }
    if (Math.random() < 0.35) for (let k = 1 + ri(3); k > 0; k--) bubble(x, Math.min(x.length - 1, s + ((R(0, 0.2) * sr) | 0)), R(400, 900), R(0.1, 0.3), sr);
    t += (R(0.7, 1.9) * sr) | 0;
  }
}
// sand and grit stirred by a swell: many tiny grains, kept dark (one-pole lowpass at ~450 Hz, then 600 Hz in the graph)
function sandLoop(x, sr) {
  const a = 1 - Math.exp(-2 * Math.PI * 450 / sr); let y = 0;
  for (let i = 0; i < x.length; i++) {
    const g = Math.random() < 0.02 ? (Math.random() * 2 - 1) * (0.3 + Math.random() ** 3) : 0;
    y += a * (g - y); x[i] = y;
  }
}
// a curtain of bubbles rising past: a dense wash of 120-200 mixed bubbles that swells and thins out
function curtain(x, sr) {
  const n = 120 + ri(80), len = x.length - sr * 0.15;
  for (let k = 0; k < n; k++) {
    const t = (Math.random() * len) | 0, env = Math.sin(Math.PI * t / len);
    bubble(x, t, R(300, 1400), env * R(0.1, 0.45), sr, R(0.05, 0.09));
  }
}
// a big belch of air: a low whump, then four to eight big bubbles in quick succession
function belch(x, sr) {
  const f0 = R(60, 90);
  for (let j = 0; j < 0.4 * sr; j++) { const t = j / sr; x[j] += 0.6 * Math.exp(-t / 0.09) * Math.sin(2 * Math.PI * f0 * t * (1 - 0.3 * t)) * Math.min(1, t / 0.01); }
  let t = (0.03 * sr) | 0;
  for (let k = 4 + ri(5); k > 0 && t < x.length - sr * 0.3; k--) { bubble(x, t, R(90, 260), R(0.5, 1), sr, R(0.025, 0.04), R(0.05, 0.2)); t += (R(0.04, 0.13) * sr) | 0; }
}
// a fizzing trail that fades: many small bubbles, thinning out
function fizzOut(x, sr) {
  const n = 70 + ri(50), len = x.length - sr * 0.1;
  for (let k = 0; k < n; k++) { const u = Math.random() ** 2.2, t = (u * len) | 0; bubble(x, t, R(700, 1800), (1 - u) * R(0.08, 0.3), sr, R(0.06, 0.1)); }
}
// pebbles and shell grit rolling in the surge: clicks of small stones, swelling in and out
function pebbles(x, sr) {
  const n = 25 + ri(35), len = x.length - sr * 0.05;
  for (let k = 0; k < n; k++) { const u = Math.random(), t = (u * len) | 0, env = Math.sin(Math.PI * u); ring(x, t, R(900, 2200), R(0.002, 0.005), env * R(0.3, 1), sr); ring(x, t, R(220, 400), R(0.006, 0.012), env * R(0.1, 0.4), sr); }
}
// a hollow wooden knock (a kelp stipe or a drowned trunk knocking): a few damped modes
function woodKnock(x, sr) {
  const f = R(150, 260);
  ring(x, 0, f, 0.04, 1, sr); ring(x, 0, f * R(2.2, 2.6), 0.025, 0.6, sr); ring(x, 0, f * R(3.9, 4.6), 0.014, 0.35, sr);
}
const BANK = { lap: [7.3, lapLoop, true], sand: [6.1, sandLoop, true], curtain: [2.4, curtain], belch: [1.4, belch], fizz: [2.5, fizzOut],
  pebbles: [0.9, pebbles], knock: [0.3, woodKnock] };
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
    this.fVoices = 0; this.fCap = low ? 4 : 7;     // water events (fx: breakers, knocks, wakes, feeding...)
    this.F = { ...FAM0 }; // blended zone family (liquid character)
    this.stats = {};      // count of every event and call played, by kind (debug, harness)
    this.mood = 1; this._moodT = 1; this._moodNext = 0; // slow calmer / busier spells
    this._seen = new WeakSet(); // encounter events already heard (strike, lunge, play...)
    this._sfx = new Map();      // encounter uid -> time its next splash / wake may sound
    this._wf = { bite: 0, chunk: 0, displace: 0, arrive: 0, sweep: 0, snap: 0 }; // whale-fall crowd events heard
    this._ans = { kind: '', t: 0, d: 0, pan: 0, rear: 0, uid: 0, e: null }; // a pending answer from a group mate
    this._cents = 0; this._T = 1; this._lifeGap = 0; this._lastKind = ''; this._lastKindT = 0; this._warmK = ''; this._wakeT = 0; // pitch (cents) and tempo of the animal calling now; next call start
    this.Z = { ...Z0 };   // blended zone amounts
    this.mix = {};        // latest bus targets (debug)
    this.cand = Array.from({ length: low ? 3 : 5 }, () => ({ kind: '', d: 1e9, pan: 0, rear: 0, uid: 0, vis: false, n: 1, bg: false, e: null })); // nearest callers
    this.nCand = 0;
    this._due = new Map(); // encounter uid -> time of its next call
    this.diverD = 1e9; this.diverPan = 0; this.diverRear = 0; this.closeN = 0;
    this._turn = 0; this._v0 = -1; this._acc = 0; this._stirT = 0; // the craft: yaw rate, speed, its change; next stir
    this._rear = 0; this._rr = 0;
    // long calls (songs, moans, trills) follow their animal and the view while they last: _far files the call's head
    // here when _trackE is set, and _steer re-aims its pan, rear lowpass and gain at 4 Hz
    this._trackE = null; this._trk = Array.from({ length: 4 }, () => ({ e: null, h: null })); // how far behind the view the voice being made is (0 ahead or beside, 1 straight behind)
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
    // base: two independent brown noises (left and right: the family sets how wide) -> highpass 28 -> lowpass ->
    // lowpass (depth) -> pan -> swell -> bus
    const swell = g(1, bus.base);
    this.baseLP = []; this.basePan = [];
    for (const side of [-1, 1]) {
      let out = swell;
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = 0.5 * side; p.connect(swell); out = p; this.basePan.push(p); }
      const l2 = f('lowpass', 400, 0.6, g(1.1, out)), l1 = f('lowpass', 400, 0.5, l2); // (the panner's equal-power law: -3 dB at centre)
      (side < 0 ? brownS : src(this.buf.brown, 0.97)).connect(f('highpass', 28, 0.7, l1));
      this.baseLP.push(l1, l2);
    }
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
    // lapping (lazy loop) and the sand under the swell (lazy loop through a gain the surges open and close)
    // the rush of water past the ears, rising and falling with the craft's speed: the pink loop under ~400 Hz
    this.rushG = g(0, bus.base); this.rushLP = f('lowpass', 330, 0.6, this.rushG); pinkS.connect(this.rushLP);
    this.lapIn = f('lowpass', 900, 0.5, bus.lap);
    this.sandEnv = g(0.15, f('lowpass', 600, 0.7, bus.sand));
  }
  // loops only some zones and weathers use: built on first use, outside unlock()
  _lazy(k) {
    const c = this.ctx, b = this.buf, { src } = this._mk;
    if (k === 'rain' && !b.rain) { b.rain = loopBuffer(c, 3.9, rainPatter, 0.15); src(b.rain, 1).connect(this.rainLP); }
    if (k === 'chorus' && !b.chorus) { b.chorus = loopBuffer(c, 6.3, chorusLoop, 0.15); src(b.chorus, 1).connect(this.chorusIn); src(b.chorus, 0.97).connect(this.chorusIn); }
    if (k === 'lap' && !b.lap) { b.lap = this._bank('lap'); src(b.lap, 1).connect(this.lapIn); src(b.lap, 0.91).connect(this.lapIn); }
    if (k === 'sand' && !b.sand) { b.sand = this._bank('sand'); src(b.sand, 1).connect(this.sandEnv); }
  }
  // generated sounds of the water events: two variants of each one-shot (one loop), made on first use
  // (a one-shot's first variant is made when first needed, its second one a tick later: one buffer per tick at most)
  _bank(k) {
    const b = this.buf, B = BANK[k], c = this.ctx;
    if (!b['_' + k]) b['_' + k] = B[2] ? loopBuffer(c, B[0], B[1], 0.15) : [shotBuffer(c, B[0], B[1])];
    if (!B[2] && b['_' + k].length < 2 && !this._warmK) this._warmK = k;
    return b['_' + k];
  }
  _warm() {
    const k = this._warmK; if (!k) return;
    this._warmK = '';
    const v = this.buf['_' + k], B = BANK[k];
    if (v && v.length < 2) v.push(shotBuffer(this.ctx, B[0], B[1]));
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
    this._warm();
  }

  _steer(now, dt) {
    const env = this.env, cam = env.camera.position, O = window.__ocean || {}, C = (O.conditions && O.conditions.out) || {};
    const Oz = -env.world.position.z, s = -(cam.z + Oz);
    // camera speed (m/s), for bubble density; a jump (zone change) reads as a stop, not a dash
    const ds = this._lastS === null ? 0 : Math.abs(s - this._lastS); this._lastS = s;
    this.speed += ((ds < 60 && dt > 0 ? ds / dt : 0) - this.speed) * 0.3;
    const Z = this.Z, F = this.F; for (const k in Z0) Z[k] = 0; for (const k in FAM0) F[k] = 0;
    let off = 0;
    const offs = (this.app && this.app.depthOffsets) || {};
    for (const e of env.seq.weights(s)) {
      const p = PROFILE[e.key] || Z0, fm = FAMILY[ZONE_FAM[e.key]] || FAMILY.reef;
      for (const k in Z0) Z[k] += (p[k] ?? Z0[k]) * e.w;
      for (const k in FAM0) F[k] += fm[k] * e.w;
      off += (offs[e.key] || 0) * e.w;
    }
    const camD = Math.max(0, -cam.y), D = camD + off;
    const head = env.shape.ceilingAt(cam.x, s) - cam.y;           // ice, cave roof or rock overhead
    const cover = clamp01((60 - head) / 50), open = 1 - cover;
    const night = this.night = C.night || 0, rain = C.rain || 0, surge = this.surge = C.surge || 0;
    const shallow = Math.exp(-camD / 9), bright = Math.exp(-D / 45);
    Z.wash *= shallow * open; Z.iceAmt = Z.ice * (0.4 + 0.6 * cover); Z.caveAmt = Z.cave * cover; Z.open = open; Z.camD = camD;
    // calmer and busier spells of a minute or so; calm nights (unless a storm is up) quieten the water further
    if (now >= this._moodNext) { this._moodT = R(0.65, 1.35); this._moodNext = now + R(40, 90); }
    this.mood += (this._moodT - this.mood) * Math.min(1, dt / 15);
    const calm = 1 - 0.3 * night * (1 - Math.min(1, surge));
    Z.act = this.mood * calm;
    // how much water moves around the head: surface wash, surge weather, kelp swell; never quite still
    Z.slosh = Math.min(1.4, 0.3 + 0.1 * bright + 0.7 * Z.wash + 0.6 * surge + 0.3 * Z.kelp * Math.exp(-camD / 30));
    const m = this.mix;
    m.base = 0.34 * (0.35 + 0.65 * Math.exp(-D / 600)) * (0.9 + 0.1 * this.mood);
    m.slosh = 4 * Z.slosh * F.sl * (0.75 + 0.25 * Z.act);
    m.hum = 0.022 * Z.hum;
    m.shrimp = 0.15 * Z.shrimp * (0.8 + 0.5 * night) * Math.exp(-camD / 70);
    m.vent = 0.4 * Z.vent;
    m.bubbles = 0.3 * Z.bubbles;
    m.chorus = 0.3 * Z.chorus * clamp01((night - 0.2) / 0.5) * Math.exp(-camD / 80);
    m.rain = 0.18 * rain * Math.exp(-camD / 20) * open;
    m.lap = 0.5 * F.lap * Math.exp(-camD / 5) * open * (0.7 + 0.3 * Z.act + 0.5 * surge);
    m.sand = 0.9 * F.swell * Math.exp(-camD / 40) * (0.6 + 0.4 * Z.act + 0.6 * surge);
    if (m.rain > 0.01) this._lazy('rain');
    if (m.chorus > 0.01) this._lazy('chorus');
    if (m.lap > 0.01) this._lazy('lap');
    if (m.sand > 0.01) this._lazy('sand');
    for (const k of STEERED) this.bus[k].gain.setTargetAtTime(m[k], now, 0.8);
    const lp = 150 + 260 * bright;
    for (const n of this.baseLP) n.frequency.setTargetAtTime(lp, now, 1);
    for (let i = 0; i < this.basePan.length; i++) this.basePan[i].pan.setTargetAtTime((i ? 1 : -1) * (0.15 + 0.75 * F.width), now, 2);
    this.rainLP.frequency.setTargetAtTime(350 + 500 * Math.exp(-camD / 15), now, 1);
    this.baseRev.gain.setTargetAtTime(0.5 * (Z.caveAmt + 0.6 * Z.iceAmt), now, 1);
    this.fxRev.gain.setTargetAtTime(0.25 + 0.6 * Math.max(Z.caveAmt, Z.iceAmt) + 0.3 * F.far + 0.3 * F.deep, now, 1);
    this.lifeRev.gain.setTargetAtTime(0.3 + 0.5 * Z.caveAmt, now, 1);
    for (let i = 0; i < this.slosh.length; i++) { const v = this.slosh[i]; if (now >= v.due) this._surge(v, now + R(0, 0.2), Z.slosh, i === 0); }
    this._craft(now, dt);
    this._retrack(now);
  }

  // The craft (camera.js): the water rushes past a little louder and brighter as it speeds up; a turn or a change of
  // speed stirs it, an early slosh surge and a few bubbles sliding past on the outside of the turn (in the view's frame)
  _craft(now, dt) {
    const D = this.env.camDirector, cr = D && D.craft, H = D && D.heading;
    const v = cr && cr.v > 0 ? cr.v : this.speed, turn = this._turn = cr && cr.H ? cr.H.v || 0 : 0; // m/s; rad/s, + = left
    if (this._v0 >= 0 && dt > 0) this._acc += ((v - this._v0) / dt - this._acc) * 0.4;
    this._v0 = v;
    const u = Math.min(2.2, v / 3);
    this.rushG.gain.setTargetAtTime(0.45 * u * Math.sqrt(u), now, 1.5);
    this.rushLP.frequency.setTargetAtTime(270 + 60 * u, now, 1.5);
    if (!H || now < this._stirT || Math.abs(turn) / 0.03 + Math.abs(this._acc) / 0.2 < 1) return; // (bends: 1-3 deg/s)
    this._stirT = now + R(8, 16); this._count('stir');
    const side = Math.abs(turn) > 0.02 ? Math.sign(-turn) : Math.random() < 0.5 ? -1 : 1; // outside: right in a left turn
    const ox = -H.z * side * 3, oz = H.x * side * 3, p0 = this._dir(ox + 2 * H.x, 0, oz + 2 * H.z), p1 = this._dir(ox - 3 * H.x, 0, oz - 3 * H.z);
    const sl = this.slosh[p0 + p1 > 0 ? 1 : 0];
    if (sl) this._surge(sl, now + R(0, 0.3), Math.min(1, this.Z.slosh), false);
    for (let k = Math.random() < 0.3 ? 2 : 1; k > 0; k--) this._bub(now + R(0.1, 0.9), false, R(0.4, 0.65), p0, p1);
  }

  // one slosh surge: the water swells past (gain up, band rises, gurgle deepens), then drains away. The zone family
  // sets its band and pace (quick and light under a shallow surface, slow and heavy over a reef, long in open water);
  // over a swell the sand shifts with it, and in the shallows pebbles roll at the top
  _surge(v, t, amt, lead) {
    const F = this.F, up = R(0.35, 1.1) * F.up, hold = R(0.1, 0.5) * Math.sqrt(F.up), down = R(1, 2.8) * F.up, pk = R(0.6, 1), top = t + up + hold;
    const lo = F.slLo, hi = F.slHi, mid = Math.sqrt(lo * hi);
    v.env.gain.cancelScheduledValues(t); v.bp.frequency.cancelScheduledValues(t); v.depth.gain.cancelScheduledValues(t);
    v.env.gain.setTargetAtTime(pk, t, up / 3); v.env.gain.setTargetAtTime(R(0.06, 0.15), top, down / 3);
    v.bp.frequency.setTargetAtTime(R(mid, hi), t, up / 2); v.bp.frequency.setTargetAtTime(R(lo, mid), top, down / 2);
    v.depth.gain.setTargetAtTime(R(500, 1000), t, 0.2); v.depth.gain.setTargetAtTime(R(150, 250), top, down / 2);
    v.due = top + down * R(0.3, 0.9) + R(0.4, 3) * F.gap / (0.5 + amt * this.Z.act);
    if (Math.random() < 0.25 * amt) this._bub(top - R(0, 0.3), true, 0.7 * amt);
    if (!lead) return;
    if (F.swell > 0.15 && this.buf._sand) { // the sand lifts with the surge and settles after it
      const p = this.sandEnv.gain; p.cancelScheduledValues(t);
      p.setTargetAtTime(pk, t + up * 0.4, up / 2); p.setTargetAtTime(0.12, top, down / 2);
    }
    const peb = (F.pebble + 0.5 * this.surge) * Math.exp(-this.Z.camD / 12);
    if (Math.random() < 0.35 * peb) this._water('pebbles', top - R(0.1, 0.4), Math.min(1, peb), R(-0.7, 0.7), 0);
  }

  // calling animals near the camera (the nearest 5, or 3 on low, within their voice's range) and the nearest diver, once a
  // second; also what the animals are doing (strikes, lunges, play: e.event), big bodies passing close (a wake) and
  // dives and breaches at the surface. Reads encounter state and allocates nothing after the first sighting
  _look(now) {
    const O = window.__ocean || {}, cam = this.env.camera.position, Oz = -this.env.world.position.z;
    // (pan and rear come from the camera's own matrix: the view, which the viewer can turn, not the travel direction)
    const cand = this.cand, K = cand.length; let nc = 0, close = 0;
    const enc = O.creatures && O.creatures.enc;
    if (enc) for (const e of enc) {
      if (e.done || !(e.fade > 0.3)) continue;
      if (e.dist < 6 && e.visible) close++;
      const b = e.bounds;
      if (e.dist < 60 && this._sfxDue(e, now)) { this._behave(e, now, cam, Oz); this._rear = 0; }
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
      const dx = b.x - cam.x, dy = b.y - cam.y, dz = e.anchorZ + b.z - Oz - cam.z;
      slot.kind = kind; slot.d = e.dist; slot.uid = e.uid; slot.vis = !!e.visible; slot.n = e.n || 1; slot.bg = false; slot.e = e;
      slot.pan = this._dir(dx, dy, dz); slot.rear = this._rr;
    }
    // background life (creatures.bg: groups beside and behind the route) fills free slots, the nearest two at most,
    // after the near callers: they call half as often and are coloured by distance like any far call
    const bg = O.creatures && O.creatures.bg;
    if (bg && nc < K) {
      let b0 = null, b1 = null;
      for (const e of bg) {
        if (e.done || !(e.fade > 0.3) || !e.sp || !e.bounds) continue;
        const kind = CALLS[e.sp.key];
        if (!kind || !(e.dist <= VOICE[kind][0]) || (kind === 'sweeper' && this.night < 0.25)) continue;
        if (!b0 || e.dist < b0.dist) { b1 = b0; b0 = e; } else if (!b1 || e.dist < b1.dist) b1 = e;
      }
      for (let j = 0; j < 2; j++) {
        const e = j ? b1 : b0;
        if (!e || nc >= K) continue;
        const slot = cand[nc++], b = e.bounds, kind = CALLS[e.sp.key];
        slot.kind = kind; slot.d = e.dist; slot.uid = e.uid; slot.vis = false; slot.n = e.n || 1; slot.bg = true; slot.e = e;
        slot.pan = this._dir(b.x - cam.x, b.y - cam.y, e.anchorZ + b.z - Oz - cam.z); slot.rear = this._rr;
      }
    }
    this.nCand = nc; this.closeN = close;
    for (let i = nc; i < K; i++) cand[i].d = 1e9;
    // forget animals that left; a new arrival calls within a few seconds
    for (const [uid, t] of this._due) if (t < now - 30) this._due.delete(uid);
    for (const [uid, t] of this._sfx) if (t < now - 30) this._sfx.delete(uid);
    for (let i = 0; i < nc; i++) if (!this._due.has(cand[i].uid)) this._due.set(cand[i].uid, now + R(0.5, 3.5));
    this.diverD = 1e9;
    const a = O.surprises && O.surprises.active;
    if (a && !a.done && a.kind === 'divers' && a.divers) for (const d of a.divers) {
      const dx = d.x - cam.x, dy = d.y - cam.y, dz = d.z - Oz - cam.z, dd = Math.hypot(dx, dy, dz);
      if (dd < this.diverD) { this.diverD = dd; this.diverPan = this._dir(dx, dy, dz); this.diverRear = this._rr; }
    }
  }
  // stereo position of an offset from the camera (render space) in the VIEW's frame: pan from the camera's right axis;
  // this._rr = how far behind the view it is (0 ahead or beside, 1 straight behind), for _out's rear dulling
  _dir(dx, dy, dz) {
    const me = this.env.camera.matrixWorld.elements, l = Math.hypot(dx, dy, dz) || 1;
    this._rr = clamp01((dx * me[8] + dy * me[9] + dz * me[10]) / l); // (the camera looks down its -z axis)
    return 0.8 * Math.max(-1, Math.min(1, (dx * me[0] + dy * me[1] + dz * me[2]) / l));
  }
  // may this animal make a water sound now? (a new event always may; splashes and wakes have a per-animal cooldown)
  _sfxDue(e, now) {
    if (e.event && !this._seen.has(e.event)) return true;
    const t = this._sfx.get(e.uid);
    return t === undefined || now >= t;
  }
  // the water sounds of what an animal is doing
  _behave(e, now, cam, Oz) {
    const b = e.bounds, dx = b.x - cam.x, dy = b.y - cam.y, dz = e.anchorZ + b.z - Oz - cam.z, d = e.dist;
    const pan = this._dir(dx, dy, dz); this._rear = this._rr;
    const key = e.sp && e.sp.key, r = b.r || 1, ev = e.event, t = now + R(0.05, 0.3);
    if (ev && !this._seen.has(ev)) {
      this._seen.add(ev);
      const ty = ev.type;
      if (ty === 'strike') { this._water('scatter', t, 1, pan, d); this._water('wake', t + 0.1, 0.6, pan, d); }
      else if (ty === 'lunge') { this._water('wake', t, 1.4, pan, d); this._water('belch', t + 0.4, 0.8, pan, d); if (b.y > -4 - r) this._water('breach', t + 0.6, 1, pan, d); }
      else if (ty === 'play') this._water(Math.random() < 0.5 ? 'belch' : 'curtain', t, 0.5, pan, d);
      else if (ty === 'flip' || ty === 'roll') this._water('wake', t, 0.8, pan, d);
      this._sfx.set(e.uid, now + 4);
      return;
    }
    // a big body passing close pushes water past the head (single animals: a school's bounds are the whole school)
    if (r > 2 && (e.n || 1) <= 2 && d < 2 + 0.2 * r && now >= this._wakeT) { this._water('wake', t, Math.min(1.5, r / 3), pan, d); this._sfx.set(e.uid, now + R(12, 20)); this._wakeT = now + R(5, 9); return; }
    // dives from the surface and breaches / slaps carry down from above
    const surf = b.y > -2.5 - 0.3 * r;
    if (surf && PLUNGE.has(key) && d < 45 && Math.random() < 0.12) { this._water('plunge', t, 1, pan, d); this._sfx.set(e.uid, now + R(6, 14)); return; }
    if (surf && BREACH.has(key) && d < 140 && Math.random() < 0.06) { this._water('breach', t, Math.min(1.5, r / 4), pan, d); this._sfx.set(e.uid, now + R(15, 40)); return; }
    this._sfx.set(e.uid, now + 1);
  }

  _events(now) {
    const Z = this.Z, F = this.F, due = this._dueE, full = () => this.voices >= this.cap, act = Z.act;
    const fire = (k, amt, lo, hi, fn) => {
      if (due[k] === undefined) due[k] = now + R(0, hi) / Math.max(0.2, Math.min(1, amt + 0.15));
      if (now < due[k]) return;
      if (amt < 0.08) { due[k] = now + R(lo, hi); return; }
      if (!full()) fn(now + R(0.05, 0.3), amt);
      due[k] = now + R(lo, hi) / Math.min(1.6, (amt + 0.15) * act);
    };
    const water = (k, amt, lo, hi) => fire(k, amt, lo, hi, (t, a) => this._water(k, t, Math.min(1, a), R(-0.75, 0.75), 0));
    fire('slap', Z.wash, 2, 7, (t, a) => this._slap(t, a));
    fire('drip', Z.caveAmt, 0.8, 5, (t, a) => this._drip(t, a));
    fire('ice', Z.iceAmt, 3, 14, (t, a) => { const r = Math.random(); r < 0.45 ? this._creak(t, a, false) : r < 0.75 ? this._groan(t, a) : this._ping(t, a); });
    fire('kelp', Z.kelp, 4, 15, (t, a) => this._creak(t, a * 0.6, true));
    // the zone family's own water events
    const sh = Math.exp(-Z.camD / 6) * Z.open;
    water('breaker', (0.5 * F.lap + 0.2 * F.swell + 0.8 * this.surge) * sh, 10, 28);
    water('knock', F.wood, 5, 16);
    water('hglug', F.hollow * Math.max(Z.caveAmt, 0.3), 5, 14);
    water('boomFar', F.far, 22, 55);
    water('thud', F.deep, 25, 70);
    water('squeak', F.squeak * Z.iceAmt, 7, 20);
    water('gush', F.gush, 10, 26);
    water('fizzStream', F.fizz, 3, 9);
    water('seep', F.seep, 6, 16);
    water('curtain', F.curtain, 25, 70);
    water('belch', F.belch, 30, 80);
    water('fizz', 0.25 + 0.4 * F.fizz + 0.3 * F.lap - 0.3 * F.deep, 18, 45);
    // bubbles everywhere: trails at random intervals, denser when moving fast or with animals close; rare glugs
    const dens = (0.55 + 0.12 * Math.min(6, this.speed) + 0.5 * Math.min(2, this.closeN) + 0.6 * Z.bubbles + 0.4 * Z.vent + 0.3 * Z.wash) * F.bubD * act;
    if (now >= due.trail) { this._bub(now + R(0.05, 0.3), false, 0.6 + 0.4 * Math.random()); due.trail = now + R(1.2, 5.5) / Math.max(0.15, dens); }
    if (now >= due.glug) { this._bub(now + R(0.05, 0.3), true, R(0.6, 1)); due.glug = now + R(7, 20) / Math.max(0.3, (0.8 + 0.5 * Z.wash + 0.3 * Z.slosh) * Math.sqrt(F.bubD)); }
    if (now >= due.diver) {
      due.diver = now + R(4, 7);
      if (this.diverD < 45 && !full()) { this._rear = this.diverRear; this._exhale(now + 0.05, this.diverD, this.diverPan); this._rear = 0; }
    }
    this._crowd(now);
    // animals near: each of the nearest callers calls on its own timer (sooner while in view or in a bigger group)
    let calls = 0;
    for (let i = 0; i < this.nCand; i++) {
      const n = this.cand[i], t = this._due.get(n.uid);
      if (t === undefined || now < t || calls || now < this._lifeGap) continue; // (one new call at a time, ~0.5 s apart)
      if (n.kind === this._lastKind && now < this._lastKindT) continue; // (and not the same voice twice running)
      if (full()) { this._due.set(n.uid, now + R(0.5, 2)); continue; }
      const v = VOICE[n.kind], member = n.n > 1 ? ri(Math.min(n.n, 8)) : 0;
      this._rear = n.rear; this._trackE = v[3] >= 1.5 ? n.e : null; this._call(n.kind, now + R(0.05, 0.25), n.d, n.pan, n.uid * 16 + member); this._trackE = null; this._duckFor(now, v[3], n.d); calls++; this._lifeGap = now + R(0.35, 0.8); this._lastKind = n.kind; this._lastKindT = now + R(1.5, 3);
      this._due.set(n.uid, now + R(v[1], v[2]) * (n.vis ? 0.7 : n.bg ? 2 : 1) / Math.min(1.3, 1 + 0.1 * (n.n - 1)));
      // a group mate answers; a big group sometimes calls together
      if (n.n > 1 && ANSWER.has(n.kind) && Math.random() < (VOICE[n.kind][0] < 50 ? 0.25 : 0.45) && !this._ans.kind) {
        const A = this._ans; A.kind = n.kind; A.t = now + v[3] * 0.7 + R(0.3, 1.2); A.d = n.d * R(0.85, 1.2); A.pan = Math.max(-0.8, Math.min(0.8, n.pan + R(-0.4, 0.4))); A.rear = n.rear; A.e = n.e; A.uid = n.uid * 16 + ((member + 1 + ri(3)) % 8);
      }
      if (n.n >= 6 && CHORUS.has(n.kind) && Math.random() < 0.3) for (let k = 1 + ri(2); k > 0 && !full(); k--) this._call(n.kind, now + R(0.2, 1), n.d * R(0.9, 1.3), Math.max(-0.8, Math.min(0.8, n.pan + R(-0.5, 0.5))), n.uid * 16 + 8 + k);
      this._rear = 0; this._trackE = null;
    }
    const A = this._ans;
    if (A.kind && now >= A.t) { this._rear = A.rear; this._trackE = VOICE[A.kind][3] >= 1.5 ? A.e : null; if (!full()) this._call(A.kind, now + 0.05, A.d, A.pan, A.uid); this._rear = 0; this._trackE = null; A.kind = ''; A.e = null; }
    if (this.nCand && this._lifeFar) this._lifeFar = false;
    if (!this.nCand && now >= due.life) { // far away, unseen: whale song in open water, seals under the ice
      const first = !this._lifeFar; this._lifeFar = true;
      const r = Math.random();
      if (!first && !full() && r < 0.5 * Z.song) this._call(pick(['humpback', 'humpback', 'blue', 'sperm']), now + 0.1, R(250, 600), R(-0.7, 0.7));
      else if (!first && !full() && r > 1 - 0.5 * Z.seal) this._call(pick(['weddell', 'weddell', 'leopard']), now + 0.1, R(120, 300), R(-0.7, 0.7));
      due.life = now + (first ? R(5, 25) : R(30, 100));
    }
  }

  // the feeding crowd at a sunlit whale fall (creatures/wf_crowd.js counts its events in `ev` and keeps the place of
  // the latest in lx/ly/lz): sharks biting and shaking, chunks tearing free, fish scattering, sharks sweeping in
  _crowd(now) {
    const O = window.__ocean || {}, W = O.creatures && O.creatures.director && O.creatures.director.wfCrowd, last = this._wf;
    if (!W || !W.ev) return;
    const cam = this.env.camera.position, Oz = -this.env.world.position.z;
    for (const k in last) {
      const n = W.ev[k] || 0, was = last[k]; last[k] = n;
      if (n <= was || !W.p || n - was > 3) continue; // (a jump of many: a reset or a first look, not events to play)
      const x = W.lx ?? cam.x, y = W.ly ?? cam.y, z = W.lz ?? (cam.z + Oz);
      const dx = x - cam.x, dy = y - cam.y, dz = z - Oz - cam.z, d = Math.hypot(dx, dy, dz);
      if (d > 70) continue;
      const pan = this._dir(dx, dy, dz), t = now + R(0.02, 0.2); this._rear = this._rr;
      if (k === 'bite') this._water('tear', t, 0.8, pan, d);
      else if (k === 'chunk') { this._water('tear', t, 1.3, pan, d); this._water('scatter', t + 0.5, 1, pan, d); }
      else if (k === 'displace') this._water('thrash', t, 1, pan, d);
      else if (k === 'snap') this._water('snap', t, 0.8, pan, d);
      else this._water(k === 'sweep' ? 'scatter' : 'wake', t, 0.8, pan, d);
      this._rear = 0;
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
  // A voice behind the view (this._rear, set around the call) is a little duller and quieter, as the head shadows it.
  _out(pan, lp, gain, wet, bus) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter(), rr = this._rear;
    g._lp0 = lp; g._g0 = gain; g._done = false;
    if (rr > 0) { lp *= 1 - 0.55 * rr; gain *= 1 - 0.3 * rr; }
    g.gain.value = gain; f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5;
    g.connect(f);
    g.chain = [f];
    let o = f;
    g.pan = null;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; f.connect(p); o = p; g.chain.push(p); g.pan = p; }
    o.connect(bus);
    if (wet > 0) { const w = c.createGain(); w.gain.value = wet; o.connect(w); w.connect(this.revIn); g.chain.push(w); }
    return g;
  }
  // a call heard from d metres: quieter, darker and wetter with distance (unchanged within ~15 m; a far caller reaches
  // the ear mostly through the water's reverberation, so past ~100 m it is mostly tail)
  _far(d, pan, level, lpMax = 9000) {
    const h = this._out(pan, Math.min(lpMax, 400 + 9000 * Math.exp(-d / 52)), LIFE_GAIN * level / (1 + d / 45), Math.min(1, 0.12 + d / 140), this.bus.life);
    if (this._trackE && h.pan) { // (one head per call: the first)
      for (const k of this._trk) if (!k.h || k.h._done || !k.e || k.e.done) { k.e = this._trackE; k.h = h; break; }
      this._trackE = null;
    }
    return h;
  }
  // re-aim the long calls still sounding (4 Hz, a short ramp): pan, and the rear lowpass and gain, from where the
  // animal is now in the view
  _retrack(now) {
    const cam = this.env.camera.position, Oz = -this.env.world.position.z;
    for (const k of this._trk) {
      const h = k.h, e = k.e;
      if (!h || h._done || !e || e.done || !e.bounds) { k.h = null; k.e = null; continue; }
      const b = e.bounds, pan = this._dir(b.x - cam.x, b.y - cam.y, e.anchorZ + b.z - Oz - cam.z), rr = this._rr;
      h.pan.pan.setTargetAtTime(pan, now, 0.1);
      h.chain[0].frequency.setTargetAtTime(h._lp0 * (1 - 0.55 * rr), now, 0.1);
      h.gain.setTargetAtTime(h._g0 * (1 - 0.3 * rr), now, 0.1);
    }
  }
  // count a voice until its last source ends, then drop its chain (bubble voices have their own count)
  _hold(src, head, bub) {
    const k = bub === true ? 'bVoices' : bub ? 'fVoices' : 'voices';
    this[k]++;
    src.onended = () => { this[k]--; head._done = true; head.disconnect(); for (const n of head.chain) n.disconnect(); };
  }
  _env(param, t, a, peak, hold, rel) {
    param.setValueAtTime(0, t); param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + a + hold); param.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    return t + a + hold + rel;
  }
  // (inside a call, every oscillator and buffer is detuned to the calling animal's own pitch: this._cents)
  _osc(type, hz, to) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = hz; if (this._cents) o.detune.value = this._cents; if (to) o.connect(to); return o; }
  _gain(v, to) { const g = this.ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  _shot(buf, t, rate, to, offset = 0, dur) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.connect(to);
    if (this._cents && s.detune) s.detune.value = this._cents;
    if (dur) s.start(t, offset, dur); else s.start(t, offset);
    return s;
  }
  // n pulses of a prebuilt buffer, `per` seconds apart; returns the last source (it ends last) and the time after it
  _train(buf, t, n, per, rate, head, amp = 1, jit = 0.1) {
    let s = null;
    for (let i = 0; i < n; i++) { s = this._shot(buf, t, rate * R(0.97, 1.03), this._gain(amp * R(0.7, 1), head)); t += per * this._T * R(1 - jit, 1 + jit); }
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
  _bub(t, glug, a, pan, pan1) { // (pan -> pan1: a trail sliding past)
    if (this.bVoices >= this.bCap) return;
    const head = this._out(pan ?? R(-0.75, 0.75), glug ? 1600 : R(2200, 3500), (glug ? 0.55 : 0.32) * a, 0.15, this.bus.bub);
    if (pan1 !== undefined && head.pan) { head.pan.pan.setValueAtTime(pan, t); head.pan.pan.linearRampToValueAtTime(pan1, t + 1); }
    const s = this._shot(pick(glug ? this.buf.glug : this.buf.trail), t, R(0.8, 1.25) * this.F.bubF, head); this._hold(s, head, true);
    this._count(glug ? 'glug' : 'trail');
  }
  _count(k) { this.stats[k] = (this.stats[k] || 0) + 1; }
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
  // a far ice ping: a soft ringing tone (kept under 3 kHz with a slow onset: at up to 4.5 kHz with a 3 ms strike it
  // stood out of the muffled bed as a sharp beep)
  _ping(t, a) {
    const head = this._out(R(-0.8, 0.8), 3200, 0.055 * Math.min(1, a), 0.8, this.bus.fx);
    const f0 = R(1300, 2700), e = this._gain(0, head), o = this._osc('sine', f0, e), dur = R(1, 2.5);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.97, t + dur);
    const end = this._env(e.gain, t, 0.04, 1, 0, dur);
    o.start(t); o.stop(end + 0.02); this._hold(o, head);
  }
  _exhale(t, d, pan) {
    const head = this._out(pan, 600 + 7000 * Math.exp(-d / 15), 0.5 / (1 + d / 8), 0.2, this.bus.life);
    const s = this._shot(pick(this.buf.exhale), t, R(0.85, 1.15), head); this._hold(s, head);
  }

  // ---------- water events (zone families, animals at the surface or passing close, the whale-fall feeding) ----------
  // k: event kind; a: amount (~0-1.5); d: distance in metres (0: somewhere around, not tied to an animal)
  _water(k, t, a, pan, d) {
    if (this.fVoices >= this.fCap || !this.ctx) return;
    this._count(k);
    const B = this.bus, F = this.F, near = d > 0 ? 1 / (1 + d / 20) : 1, lpD = d > 0 ? 500 + 6000 * Math.exp(-d / 25) : 6000;
    const wet = d > 0 ? Math.min(0.75, 0.12 + d / 90) : 0.2;
    this._le = 0; this._ls = null;
    let head = null;
    if (k === 'curtain' || k === 'belch' || k === 'fizz' || k === 'pebbles') { // generated bubble / grit sounds
      const peb = k === 'pebbles', lvl = k === 'curtain' ? 0.5 : k === 'belch' ? 0.75 : k === 'fizz' ? 0.3 : 0.45;
      head = this._out(pan, Math.min(lpD, peb ? 1400 : k === 'fizz' ? 2200 : 2800), a * near * lvl, wet, peb ? B.fx : B.bub);
      const buf = pick(this._bank(k)), rate = R(0.85, 1.15) * (peb ? 1 : F.bubF), s = this._shot(buf, t, rate, head);
      this._L(s, t + buf.duration / rate);
      if (k === 'curtain' && head.pan) { head.pan.pan.setValueAtTime(pan, t); head.pan.pan.linearRampToValueAtTime(Math.max(-0.8, Math.min(0.8, pan + R(-0.9, 0.9))), t + 2.3); }
    } else if (k === 'knock') { // kelp stipes / drowned trunks knocking: one to three hollow knocks
      head = this._out(pan, 1200, 0.5 * a, 0.3, B.fx);
      const bank = this._bank('knock'), rate = R(0.8, 1.3);
      for (let i = 1 + ri(3); i > 0; i--) { this._L(this._shot(pick(bank), t, rate * R(0.97, 1.03), this._gain(R(0.6, 1), head)), t + 0.3 / rate); t += R(0.15, 0.45); }
    } else if (k === 'hglug') { // a hollow, resonant glug in a cave or a hole
      head = this._out(pan, 900, 0.7 * a, 0.9, B.fx);
      const bp = this._filt('bandpass', R(180, 420), R(4, 7), this._gain(2.5, head));
      for (let i = 1 + ri(2); i > 0; i--) { const s = this._shot(pick(this.buf.glug), t, R(0.7, 1), bp); this._L(s, t + 1); t += R(0.2, 0.6); }
    } else if (k === 'boomFar' || k === 'thud') { // a distant low boom in open water (swell breaking far off); a deep thud
      const far = k === 'boomFar', dur = far ? R(1.5, 3) : R(0.5, 0.9), f0 = far ? R(32, 55) : R(25, 40);
      head = this._out(pan, far ? 260 : 160, (far ? 0.55 : 0.45) * a, far ? 0.7 : 0.85, B.fx);
      const e = this._gain(0, head), o = this._osc('sine', f0, e);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + dur);
      const end = this._env(e.gain, t, far ? 0.08 : 0.02, 1, 0, dur);
      o.start(t); o.stop(end + 0.02); this._L(o, end);
      this._noise(t, dur * 0.8, far ? 140 : 90, far ? 90 : 60, 0.7, head, far ? 1.2 : 0.8, far ? 0.15 : 0.03);
    } else if (k === 'squeak') { // air trapped under the ice squeezed along a floe: a squeaky, gurgling whistle
      head = this._out(pan, 1500, 0.14 * a, 0.5, B.fx);
      const f0 = R(450, 1100), dur = R(0.2, 0.6), e = this._gain(0, head), o = this._osc('sine', f0, e), v = this._osc('sine', R(18, 35));
      v.connect(this._gain(f0 * 0.06, o.frequency));
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(0.7, 1.35), t + dur);
      const end = this._env(e.gain, t, 0.02, 1, dur - 0.08, 0.06);
      o.start(t); v.start(t); o.stop(end + 0.02); v.stop(end + 0.02); this._L(o, end);
      this._L(this._shot(pick(this.buf.trail), end, R(1, 1.3), this._gain(0.4, head)), end + 1);
    } else if (k === 'gush') { // a vent gushing: a swell of low roar and heavy bubbling
      head = this._out(pan, 700, 0.6 * a, 0.35, B.fx);
      const dur = R(1.5, 3);
      this._noise(t, dur, 260, 140, 0.8, head, 1.6, 0.4);
      this._L(this._shot(pick(this._bank('belch')), t + 0.2, R(0.65, 0.85), this._gain(0.8, head)), t + 2.4);
    } else if (k === 'fizzStream' || k === 'seep') { // a stream of fine gas bubbles (Champagne); a slow weep (Lost City)
      const fz = k === 'fizzStream';
      head = this._out(pan, fz ? 2600 : 1400, (fz ? 0.3 : 0.22) * a, 0.2, B.bub);
      for (let i = fz ? 3 + ri(4) : 2 + ri(3); i > 0; i--) {
        this._L(this._shot(pick(this.buf.trail), t, fz ? R(1.1, 1.45) : R(0.6, 0.8), this._gain(R(0.5, 1), head)), t + 1.2);
        t += fz ? R(0.25, 0.6) : R(0.6, 1.5);
      }
      if (head.pan) head.pan.pan.linearRampToValueAtTime(Math.max(-0.8, Math.min(0.8, pan + R(-0.3, 0.3))), t + 1);
    } else if (k === 'breaker') { // a wave breaking overhead: a muffled thump, a wash, and a burst of bubbles
      head = this._out(pan, 1200, 0.7 * a, 0.25, B.fx);
      this._thump(t, R(55, 90), 0.35, head, 1);
      this._noise(t + 0.02, R(1.5, 2.5), R(250, 450), 150, 1.2, head, 1.4, 0.15);
      this._L(this._shot(pick(this._bank('curtain')), t + 0.08, R(1, 1.3), this._gain(0.45, head)), t + 2.4);
    } else if (k === 'wake') { // a big body passing close: water pushed past, a whoosh-gurgle sweeping across
      head = this._out(pan, Math.min(lpD, 1600), 0.6 * a * near, 0.2, B.fx);
      const dur = R(1.2, 2.4), [, end] = this._noise(t, dur, 130, 130, 1.4, head, 1.6, dur * 0.4, R(320, 480));
      if (head.pan) { head.pan.pan.setValueAtTime(pan, t); head.pan.pan.linearRampToValueAtTime(-0.7 * pan, end); }
      this._L(this._shot(pick(this.buf.trail), t + dur * 0.5, R(0.8, 1), this._gain(0.4, head)), t + dur * 0.5 + 1.2);
    } else if (k === 'plunge') { // something diving in from the surface: a slap from above, then its bubble trail
      head = this._out(pan, Math.min(lpD, 2400), 0.8 * a * near, wet, B.fx);
      this._thump(t, R(110, 200), 0.12, head, 0.8);
      this._noise(t, 0.15, 500, 300, 0.8, head, 1, 0.005);
      this._L(this._shot(pick(this._bank('curtain')), t + 0.05, R(1.2, 1.5), this._gain(0.5, head), R(0.2, 0.6), 1.2), t + 1.3);
    } else if (k === 'breach') { // a whale's breach or a tail / flipper slap, from above: a heavy thump, a long wash
      head = this._out(pan, Math.min(lpD, 900), 0.9 * a * near, wet + 0.1, B.fx);
      this._thump(t, R(40, 70), 0.5, head, 1);
      this._noise(t + 0.03, R(2, 3), 220, 120, 1, head, 1.2, 0.1);
      this._L(this._shot(pick(this._bank('belch')), t + 0.15, R(0.8, 1), this._gain(0.6, head)), t + 1.6);
    } else if (k === 'tear' || k === 'thrash') { // sharks biting and shaking flesh loose; a shark shoved off its place
      const tear = k === 'tear';
      head = this._out(pan, Math.min(lpD, 1500), 1.1 * a * near, wet, B.fx);
      let tt = t;
      for (let i = tear ? 3 + ri(4) : 4 + ri(5); i > 0; i--) { this._noise(tt, R(0.12, 0.22), R(180, 450), 140, 1.3, head, R(0.6, 1), 0.03); tt += tear ? R(0.25, 0.4) : R(0.15, 0.28); }
      if (tear) { // the low grind of the bite itself
        const e = this._gain(0, this._filt('lowpass', 260, 0.7, this._gain(0.35, head))), o = this._osc('sawtooth', R(45, 70), e), j = this._osc('sine', R(9, 15));
        j.connect(this._gain(12, o.frequency));
        const end = this._env(e.gain, t, 0.08, 1, tt - t - 0.2, 0.15);
        o.start(t); j.start(t); o.stop(end + 0.02); j.stop(end + 0.02); this._L(o, end);
      }
      this._L(this._shot(pick(tear ? this.buf.trail : this._bank('belch')), tt, R(0.9, 1.2), this._gain(0.5, head)), tt + 1.4);
    } else if (k === 'scatter') { // a school bolting: a flurry of small whooshes (the fish turning all at once)
      head = this._out(pan, Math.min(lpD, 1800), 0.8 * a * near, wet, B.fx);
      for (let i = 6 + ri(6); i > 0; i--) this._noise(t + R(0, 0.45), R(0.05, 0.1), R(300, 800), 250, 1.5, head, R(0.4, 1), 0.01);
    } else if (k === 'snap') { // a quick snap at a scrap
      head = this._out(pan, Math.min(lpD, 2000), 0.6 * a * near, wet, B.fx);
      this._noise(t, 0.12, 350, 200, 1.2, head, 1, 0.02); this._thump(t + 0.06, R(130, 180), 0.08, head, 0.7);
    }
    if (head && this._ls) this._hold(this._ls, head, 'f');
    else if (head) head.disconnect();
  }
  // keep the source that ends last (the voice's chain lives until then)
  _L(s, end) { if (end > this._le) { this._le = end; this._ls = s; } return s; }
  _filt(type, hz, q, to) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; f.connect(to); return f; }
  // a burst of noise through a bandpass gliding from f0 to f1 (through fMid at the peak when given)
  _noise(t, dur, f0, f1, q, to, peak, att, fMid) {
    const g = this._gain(0, to), bp = this._filt('bandpass', f0, q, g);
    bp.frequency.setValueAtTime(f0, t);
    if (fMid) bp.frequency.exponentialRampToValueAtTime(fMid, t + att);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const end = this._env(g.gain, t, Math.max(0.005, att), peak, 0, Math.max(0.03, dur - att));
    const s = this._shot(this.buf.pink, t, R(0.8, 1.2), bp, R(0, 4));
    s.stop(end + 0.02); this._L(s, end);
    return [s, end];
  }
  // a low thump: a sine dropping in pitch, struck and dying away
  _thump(t, f0, dur, to, peak) {
    const e = this._gain(0, to), o = this._osc('sine', f0, e);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + dur);
    const end = this._env(e.gain, t, 0.005, peak, 0, dur);
    o.start(t); o.stop(end + 0.02); this._L(o, end);
  }

  // ---------- animal calls ----------
  // uid: the calling animal (encounter uid * 16 + member); it sets the animal's own pitch and tempo (+-12 %, +-15 %),
  // signature whistles, a pod's dialect and a singer's song. 0: an unseen animal, random traits.
  _call(kind, t, d, pan, uid = 0) {
    this._count('call:' + kind);
    const r = uid ? seeded(uid) : Math.random;
    this._cents = 1200 * Math.log2(0.88 + 0.25 * r()); this._T = 0.85 + 0.3 * r();
    try { this._voice(kind, t, d, pan, uid); } finally { this._cents = 0; this._T = 1; }
  }
  // a whistle contour (into this._curve): level, falling, rising, up-down, down-up, waver or multi-hump (the seven
  // shapes of pilot whale whistles); rng: deterministic for signature and group whistles
  _shape(sh, lo, hi, rng = Math.random) {
    const k = this._curve, a = lo + (hi - lo) * (0.2 + 0.3 * rng()), b = lo + (hi - lo) * (0.6 + 0.4 * rng()), w = 3 + 3 * rng();
    for (let i = 0; i < 16; i++) {
      const u = i / 15, hump = Math.sin(Math.PI * u), f = [
        (a + b) / 2, b + (a - b) * u, a + (b - a) * u, a + (b - a) * hump, b + (a - b) * hump,
        (a + b) / 2 * (1 + 0.06 * Math.sin(2 * Math.PI * w * u)), a + (b - a) * Math.abs(Math.sin(2 * Math.PI * u)),
      ][sh];
      k[i] = f;
    }
    return k;
  }
  _whistle(t, dur, curve, head) {
    const e = this._gain(0, head), o = this._osc('sine', curve[0], e);
    o.frequency.setValueCurveAtTime(curve, t, dur);
    const end = this._env(e.gain, t, 0.04, 1, Math.max(0.02, dur - 0.12), 0.08);
    o.start(t); o.stop(end + 0.02);
    return [o, end];
  }
  // a pulse train heard as a buzzy tone (burst pulses, tonal-pulsed signals, buzzes): a sawtooth at the pulse rate
  _buzz(t, dur, rate0, rate1, lo, hi, head, peak = 1) {
    const e = this._gain(0, head), bp = this._filt('bandpass', Math.sqrt(lo * hi), Math.sqrt(lo * hi) / (hi - lo), e);
    const o = this._osc('sawtooth', rate0, bp);
    o.frequency.setValueAtTime(rate0, t); o.frequency.exponentialRampToValueAtTime(rate1, t + dur);
    const end = this._env(e.gain, t, 0.02, peak, Math.max(0, dur - 0.06), 0.04);
    o.start(t); o.stop(end + 0.02);
    return [o, end];
  }

  _voice(kind, t, d, pan, uid) {
    const c = this.ctx, T = this._T, P = Math.random();
    if (kind === 'humpback') {
      const head = this._far(d, pan, 0.5, 3000);
      if (uid && P < 0.2) { // feeding call: rhythmic, around 500 Hz, about 2.5 s
        const f0 = R(430, 560), dur = R(2, 3), e = this._gain(0, head), am = this._gain(0.5, e), l = this._osc('sine', R(3, 6));
        const o = this._osc('sawtooth', f0, this._filt('lowpass', 1300, 0.7, am));
        l.connect(this._gain(0.5, am.gain));
        o.frequency.setValueAtTime(f0 * 0.95, t); o.frequency.linearRampToValueAtTime(f0 * 1.05, t + dur);
        const end = this._env(e.gain, t, 0.15, 0.6, dur - 0.4, 0.25);
        o.start(t); l.start(t); o.stop(end + 0.02); l.stop(end + 0.02); this._hold(o, head);
        return;
      }
      // song: each singer repeats its own phrase (its units, in order, from a seed), a little different each time
      const rs = uid ? seeded(uid >> 4) : Math.random, base = 110 + 270 * rs(), nU = 3 + ((rs() * 5) | 0);
      let last = null;
      for (let i = 0; i < nU; i++) {
        const f0 = base * Math.pow(2, -1 + 2.2 * rs()) * R(0.97, 1.03), dur = (0.5 + 1.5 * rs()) * T, sh = (rs() * 4) | 0, e = this._gain(0, head);
        const o = this._osc(rs() < 0.6 ? 'sine' : 'triangle', f0, e), m = this._osc('sine', f0 * [0.5, 1, 1.5, 2, 3][(rs() * 5) | 0]);
        const fp = o.frequency, up = 1.4 + 1.1 * rs(), growl = rs() < 0.4 ? 0.3 + 1.2 * rs() : 0.15 * rs(), pk = 0.5 + 0.5 * rs(), gap = 0.15 + 1.05 * rs();
        fp.setValueAtTime(f0 * [1, 1.6, 0.8, 1][sh], t);
        if (sh === 2) { fp.exponentialRampToValueAtTime(f0 * 1.5, t + dur / 2); fp.exponentialRampToValueAtTime(f0 * 0.9, t + dur); }
        else fp.exponentialRampToValueAtTime(f0 * [up, 0.5, 1, 1.05][sh], t + dur);
        m.connect(this._gain(f0 * growl, fp));
        const end = this._env(e.gain, t, 0.12, pk, Math.max(0, dur - 0.4), 0.3);
        o.start(t); m.start(t); o.stop(end); m.stop(end); last = o;
        t = end + gap * T;
      }
      this._hold(last, head);
    } else if (kind === 'blue') { // song units (long and low), or a D call: a short downsweep between whales
      // (blue whale calls are 15-40 Hz: played an octave or so up, with harmonics, so speakers carry them)
      const D = P < 0.3, head = this._far(d, pan, 0.5, 800), e = this._gain(0, head), f0 = D ? R(62, 78) : R(46, 54), dur = D ? R(1.5, 3) : R(10, 16);
      const end = D ? this._env(e.gain, t, 0.2, 1, dur - 0.5, 0.3) : this._env(e.gain, t, 1.5, 1, dur - 3.5, 2);
      let last = null;
      for (const [h, a] of [[1, 1], [2, 0.6], [3, 0.35]]) {
        const o = this._osc('sine', f0 * h, this._gain(a, e));
        o.frequency.setValueAtTime(f0 * h, t); o.frequency.exponentialRampToValueAtTime(f0 * h * (D ? R(0.5, 0.6) : R(0.8, 0.88)), t + dur);
        o.start(t); o.stop(end); last = o;
      }
      this._hold(last, head);
    } else if (kind === 'sperm') { // usual clicks, a coda (the group's own rhythm), or a creak closing on prey
      const head = this._far(d, pan, 0.7, 4000);
      let s = null;
      if (P < 0.25) { // creak: clicks speeding up into a buzz
        let ici = R(0.12, 0.2);
        for (let i = 0; i < 45 && ici > 0.012; i++) { s = this._shot(this.buf.knock, t, R(1, 1.2), this._gain(R(0.4, 0.8), head)); t += ici; ici *= R(0.88, 0.93); }
      } else if (P < 0.6) { // coda: a repeated click pattern; each group has its own
        const rs = seeded((uid >> 4) + 77), n = 3 + ((rs() * 6) | 0), base = 0.1 + 0.15 * rs();
        for (let i = 0; i < n; i++) { s = this._shot(this.buf.knock, t, R(0.95, 1.05), this._gain(R(0.7, 1), head)); t += base * (i === n - 2 && rs() < 0.5 ? 2 : 1) * R(0.95, 1.05) * T; }
      } else {
        const n = 6 + ri(9), gap = R(0.5, 1.2) * T;
        for (let i = 0; i < n; i++) { s = this._shot(this.buf.knock, t, R(0.9, 1.1), this._gain(R(0.6, 1), head)); t += gap * R(0.9, 1.1); }
      }
      this._hold(s, head);
    } else if (kind === 'dolphin') { // whistles (often the caller's own signature), click trains, burst-pulse squawks
      if (P < 0.6) {
        const head = this._far(d, pan, 0.18), sig = P < 0.45 && uid, rs = sig ? seeded(uid * 7 + 3) : Math.random;
        const dur = (0.4 + rs()) * T, [o] = this._whistle(t, dur, this._shape((rs() * 7) | 0, 4500, 13000, rs), head);
        this._hold(o, head);
      } else if (P < 0.85) { // echolocation train, often closing into a buzz
        const head = this._far(d, pan, 0.3), n = 15 + ((Math.random() * 25) | 0), buzz = Math.random() < 0.6;
        let ici = R(0.04, 0.09), s = null;
        for (let i = 0; i < n; i++) { s = this._shot(this.buf.tick, t, R(0.8, 1.3), this._gain(R(0.5, 1), head)); t += ici; if (buzz) ici = Math.max(0.006, ici * 0.9); }
        this._hold(s, head);
      } else { // quacks and rusty-hinge sounds: short bursts of very fast pulses
        const head = this._far(d, pan, 0.16, 6000);
        let last = null;
        for (let i = 1 + ri(3); i > 0; i--) { const dur = R(0.12, 0.45), r0 = R(150, 600); [last] = this._buzz(t, dur, r0, r0 * R(0.6, 1.5), 1200, 4500, head); t += dur + R(0.08, 0.3); }
        this._hold(last, head);
      }
    } else if (kind === 'pilot') { // whistles of seven contour shapes (level, falling, rising, up-down...), or clicks
      if (P < 0.7) {
        const head = this._far(d, pan, 0.2), dur = R(0.4, 1.2) * T, [o] = this._whistle(t, dur, this._shape(ri(7), 2000, 8000), head);
        this._hold(o, head);
      } else {
        const head = this._far(d, pan, 0.3), n = 12 + ri(20), ici = R(0.03, 0.08);
        this._hold(this._train(this.buf.tick, t, n, ici, R(0.6, 0.9), head, 1, 0.15), head);
      }
    } else if (kind === 'orca') { // pulsed calls in the pod's own dialect (two call types per pod), or a click train
      if (P < 0.25) {
        const head = this._far(d, pan, 0.25, 6000);
        this._hold(this._train(this.buf.tick, t, 20 + ri(40), R(0.01, 0.04), R(0.7, 1), head, 1, 0.2), head);
      } else {
        const rs = seeded((uid >> 4) * 3 + (P < 0.6 ? 1 : 2)), head = this._far(d, pan, 0.3, 3000), e = this._gain(0, head); // (at 0.12: ~10 dB under the pilot whales' whistles)
        const f0 = (700 + 700 * rs()) * R(0.98, 1.02), dur = (0.6 + 0.9 * rs()) * T, step = 1.2 + 0.4 * rs(), at = 0.3 + 0.3 * rs(), fin = 0.8 + 0.3 * rs();
        const o = this._osc('sawtooth', f0, e);
        o.frequency.setValueAtTime(f0, t); o.frequency.setValueAtTime(f0 * step, t + dur * at);
        o.frequency.exponentialRampToValueAtTime(f0 * fin, t + dur);
        const end = this._env(e.gain, t, 0.05, 1, dur - 0.15, 0.1);
        o.start(t); o.stop(end + 0.02); this._hold(o, head);
      }
    } else if (kind === 'beluga') { // chirp bursts, whistles, squeals, clicks
      const head = this._far(d, pan, 0.16);
      let last = null;
      if (P < 0.4) {
        for (let i = 3 + ((Math.random() * 6) | 0); i > 0; i--) {
          const f0 = R(1000, 4000), dur = R(0.08, 0.3) * T, e = this._gain(0, head), o = this._osc('sine', f0, e);
          o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? R(1.3, 2) : R(0.5, 0.8)), t + dur);
          const end = this._env(e.gain, t, 0.01, 1, dur - 0.04, 0.03);
          o.start(t); o.stop(end + 0.02); last = o;
          t = end + R(0.05, 0.25);
        }
      } else if (P < 0.7) [last] = this._whistle(t, R(0.5, 1.5) * T, this._contour(2000, 6000), head);
      else if (P < 0.9) { // squeals: quick upsweeps with harmonics
        for (let i = 2 + ri(3); i > 0; i--) {
          const f0 = R(1500, 2500), dur = R(0.15, 0.35), e = this._gain(0, head);
          for (const [h, a] of [[1, 1], [2, 0.4]]) { const o = this._osc('sine', f0 * h, this._gain(a, e)); o.frequency.setValueAtTime(f0 * h, t); o.frequency.exponentialRampToValueAtTime(f0 * h * R(1.4, 1.8), t + dur); o.start(t); o.stop(t + dur + 0.03); last = o; }
          this._env(e.gain, t, 0.01, 1, dur - 0.04, 0.03); t += dur + R(0.05, 0.2);
        }
      } else last = this._train(this.buf.tick, t, 10 + ri(15), R(0.02, 0.06), R(0.8, 1.1), head, 1, 0.15);
      this._hold(last, head);
    } else if (kind === 'narwhal') { // click trains, tonal-pulsed signals, whistles
      const head = this._far(d, pan, 0.35);
      if (P < 0.5) {
        const n = 10 + ((Math.random() * 20) | 0), ici = R(0.03, 0.12);
        let s = null;
        for (let i = 0; i < n; i++) { s = this._shot(Math.random() < 0.1 ? this.buf.knock : this.buf.tick, t, R(0.6, 0.8), this._gain(R(0.5, 1), head)); t += ici * R(0.85, 1.15); }
        this._hold(s, head);
      } else if (P < 0.8) { const r0 = R(300, 900), [o] = this._buzz(t, R(0.5, 2.5) * T, r0, r0 * R(0.7, 1.4), 900, 6000, head, 0.5); this._hold(o, head); }
      else { const [o] = this._whistle(t, R(0.7, 1.3) * T, this._contour(500, 3000), this._gain(0.5, head)); this._hold(o, head); }
    } else if (kind === 'weddell') { // descending trills, whistles, low buzzes, chirps
      const head = this._far(d, pan, 0.2, 7000);
      let last = null;
      if (P < 0.4) {
        let f0 = R(2500, 5000);
        for (let i = 1 + ((Math.random() * 3) | 0); i > 0; i--) {
          const dur = R(2, 5) * T, e = this._gain(0, head), am = this._gain(0.5, e), o = this._osc('sine', f0, am), l = this._osc('sine', R(8, 22));
          l.connect(this._gain(0.5, am.gain));
          o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(R(200, 500), t + dur);
          const end = this._env(e.gain, t, 0.2, 1, dur - 0.5, 0.3);
          o.start(t); l.start(t); o.stop(end + 0.02); l.stop(end + 0.02); last = o;
          t = end + R(0.3, 1.5); f0 *= R(0.6, 0.9);
        }
      } else if (P < 0.6) [last] = this._whistle(t, R(0.5, 2) * T, this._contour(1000, 6000), head);
      else if (P < 0.8) { const r0 = R(80, 200); [last] = this._buzz(t, R(1, 3) * T, r0, r0 * R(0.8, 1.2), 150, 1500, head, 1.3); }
      else for (let i = 3 + ri(6); i > 0; i--) { const f0 = R(2000, 5000), [o, end] = this._whistle(t, R(0.06, 0.15), this._shape(2, f0, f0 * 1.6), head); last = o; t = end + R(0.06, 0.25) * T; }
      this._hold(last, head);
    } else if (kind === 'leopard') { // low tonal moans, trills and hoots, growls
      const head = this._far(d, pan, 0.25, 2500);
      if (P < 0.5) {
        const e = this._gain(0, head), f0 = R(150, 320), dur = R(3, 6) * T, o = this._osc('triangle', f0, e), v = this._osc('sine', R(3, 6));
        v.connect(this._gain(f0 * 0.03, o.frequency));
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * R(0.85, 1.1), t + dur);
        const end = this._env(e.gain, t, 0.8, 1, dur - 1.6, 0.8);
        o.start(t); v.start(t); o.stop(end + 0.02); v.stop(end + 0.02); this._hold(o, head);
      } else if (P < 0.8) { // a trill (a pulsed tone) or a few hoots
        let last = null;
        if (Math.random() < 0.5) {
          const f0 = R(1000, 3000), dur = R(1, 3) * T, e = this._gain(0, head), am = this._gain(0.5, e), o = this._osc('sine', f0, am), l = this._osc('square', R(15, 30));
          l.connect(this._gain(0.5, am.gain));
          o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(0.6, 0.9), t + dur);
          const end = this._env(e.gain, t, 0.1, 0.8, dur - 0.3, 0.2);
          o.start(t); l.start(t); o.stop(end + 0.02); l.stop(end + 0.02); last = o;
        } else for (let i = 1 + ri(3); i > 0; i--) {
          const f0 = R(200, 400), dur = R(0.3, 0.6), e = this._gain(0, head), o = this._osc('triangle', f0, e);
          o.frequency.setValueAtTime(f0 * 1.1, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + dur);
          const end = this._env(e.gain, t, 0.05, 1, dur - 0.15, 0.1); o.start(t); o.stop(end + 0.02); last = o; t = end + R(0.2, 0.6) * T;
        }
        this._hold(last, head);
      } else { const r0 = R(60, 100), [o] = this._buzz(t, R(0.5, 1.2), r0, r0 * 0.8, 150, 900, head, 1.4); this._hold(o, head); }
    } else if (kind === 'sealion') { // barks, whines, buzzing, click trains
      const head = this._far(d, pan, 0.14, 3500);
      let last = null;
      if (P < 0.45) {
        const bp = this._filt('bandpass', R(500, 900), 1.2, head);
        for (let i = 2 + ((Math.random() * 4) | 0); i > 0; i--) {
          const f0 = R(180, 420), dur = R(0.1, 0.25) * T, e = this._gain(0, bp), o = this._osc('sawtooth', f0, e);
          o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(0.7, 0.9), t + dur);
          const end = this._env(e.gain, t, 0.015, 1, dur - 0.06, 0.045);
          o.start(t); o.stop(end + 0.02); last = o;
          t = end + R(0.12, 0.4) * T;
        }
      } else if (P < 0.65) { // whine: a tone rising and falling
        const f0 = R(300, 700), dur = R(0.4, 1) * T, e = this._gain(0, head), o = this._osc('triangle', f0, e);
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * R(1.2, 1.5), t + dur * 0.5); o.frequency.linearRampToValueAtTime(f0 * R(0.8, 1), t + dur);
        const end = this._env(e.gain, t, 0.05, 1.5, dur - 0.1, 0.05); o.start(t); o.stop(end + 0.02); last = o;
      } else if (P < 0.85) { const r0 = R(50, 120); [last] = this._buzz(t, R(0.4, 1.2) * T, r0, r0 * R(0.9, 1.2), 300, 1500, head, 2.5); }
      else last = this._train(this.buf.tick, t, 10 + ri(15), R(0.03, 0.08), R(0.45, 0.6), head, 1.5, 0.15);
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
    } else if (kind === 'squirrel') { // soldierfish chasing in the school: growls (fast pulse trains, ~80-130 Hz) and knocks
      const head = this._far(d, pan, 0.6, 1500), rate = R(0.8, 1.3);
      let s = null;
      for (let i = 1 + ri(3); i > 0; i--) {
        const growl = Math.random() < 0.55;
        s = this._train(this.buf.low, t, growl ? 6 + ri(6) : 1 + ri(2), growl ? R(0.009, 0.013) : R(0.08, 0.15), rate, head, 1, 0.08);
        t = this._tEnd + R(0.2, 0.6);
      }
      this._hold(s, head);
    } else if (kind === 'drum') { // Picasso triggerfish: a short drum roll (~85 ms, ~190 Hz), its pulses in pairs (one per fin)
      const head = this._far(d, pan, 0.6, 2000), rate = R(1.8, 2.05);
      let s = null;
      for (let i = 1 + ri(2); i > 0; i--) {
        for (let p = 3 + ri(2); p > 0; p--) { this._shot(this.buf.low, t, rate, this._gain(R(0.7, 1), head)); s = this._shot(this.buf.low, t + 0.011, rate, this._gain(R(0.6, 0.9), head)); t += 0.026 * this._T; }
        t += R(0.25, 0.7);
      }
      this._hold(s, head);
    } else if (kind === 'cod') { // Arctic cod: one grunt of 6-12 pulses, about 0.29 s, around 107 Hz
      const head = this._far(d, pan, 0.55, 1200), n = 6 + ri(7);
      this._hold(this._train(this.buf.low, t, n, R(0.26, 0.32) / n, R(0.95, 1.2), head, 1, 0.12), head);
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
