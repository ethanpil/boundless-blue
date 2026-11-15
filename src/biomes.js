// Biome catalogue + endless seeded sequence along the travel distance `s` (metres).
// Each biome defines water optics, camera depth and a terrain shape relative to the path.
import { mulberry32, noise1, noise2, fbm2, ridge2, smoothstep, hash1, hash2i } from './noise.js';

const C = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// Per-segment random value in [0,1): every biome segment varies its own shape and character.
export const sv = (g, k) => (g ? hash1((g.seed ^ Math.imul(k + 1, 0x9e3779b1)) | 0) : 0.5);

// ---------- Kelp forest layout fields, shared by the canopy (sky map, in the workers) and the props (kelp.js) ----------
// Stands per segment: plants = planting density, canopy = cover of the surface canopy, tall = stipe reach.
export const KELP_STANDS = [
  { name: 'old-growth forest', plants: 1.45, canopy: 1.0, tall: 1, under: 1.0 },
  { name: 'mixed kelp', plants: 1.1, canopy: 0.85, tall: 0.8, under: 1.1 },
  { name: 'young forest', plants: 1.3, canopy: 0.4, tall: 0.5, under: 1.3 },
  { name: 'stalked-kelp grove', plants: 0.75, canopy: 0.6, tall: 0.7, under: 1.0, palms: 1 },
  { name: 'urchin barren', plants: 0.6, canopy: 0.6, tall: 0.6, under: 0.7, urchins: true },
];
export function kelpStand(g) {
  const u = sv(g, 40);
  return KELP_STANDS[u < 0.3 ? 0 : u < 0.55 ? 1 : u < 0.73 ? 2 : u < 0.86 ? 3 : 4];
}
// The segment's sunlit clearing (s, dx from the path, radius r): storms tear out old plants.
const _kclear = new Map();
export function kelpClearing(g) {
  let c = _kclear.get(g.seed);
  if (c) return c;
  const rng = mulberry32(g.seed ^ 0xc1ea2), len = g.end - g.start;
  const s = g.start + 120 + rng() * Math.max(10, len - 240);
  c = { s, dx: (rng() - 0.5) * 10, r: 8 + rng() * 5 };
  _kclear.set(g.seed, c);
  if (_kclear.size > 32) _kclear.delete(_kclear.keys().next().value);
  return c;
}
// Urchin barren patches inside a forest (1 = barren); a barren stand is bare along the route, with the
// surviving forest standing 18-30 m off to the sides (so the zone still reads as a kelp forest).
export function kelpBarren(x, s, g, dx = 0) {
  return kelpStand(g).urchins ? 1 - smoothstep(18, 30, Math.abs(dx)) * 0.85 : smoothstep(0.38, 0.52, noise2(x / 40, s / 40, 331));
}
// Planting density 0..1 (before the stand's own factor): groves, barrens and the clearing.
export function kelpGrove(x, s, g, dx) {
  let c = (0.3 + 0.7 * smoothstep(0.22, 0.68, 0.5 + 0.5 * noise2(x / 26, s / 26, 301))) * (1 - kelpBarren(x, s, g, dx));
  if (dx !== undefined) { const C = kelpClearing(g); c *= smoothstep(C.r * 0.7, C.r + 5, Math.hypot(dx - C.dx, s - C.s)); }
  return c;
}
// Canopy cover 0..1 at the surface; `holes` adds the gaps between plants that let the sun through as shafts.
export function kelpCover(x, s, g, dx, holes) {
  let c = kelpStand(g).canopy * Math.min(1, 1.25 * kelpGrove(x, s, g, dx));
  if (holes) c *= kelpHole(x, s);
  return c;
}
// Gaps in the canopy (0 = open): sharp-edged holes 4-8 m across, the 'windows' the shafts fall through.
export function kelpHole(x, s) { return 1 - 0.95 * smoothstep(0.2, 0.34, noise2(x / 9, s / 9, 311)); }
// Sand channels winding through the rocky reef (1 = channel floor).
export function kelpChannel(x, s) {
  return 1 - smoothstep(0.03, 0.13, Math.abs(noise2(x / 24, s / 40, 341) + 0.15 * noise2(x / 7, s / 7, 342)));
}

// Shape functions return floor height RELATIVE to (pathY - clearance); positive = up.
// ceil() returns ceiling height RELATIVE to pathY, or undefined for open water.
// canopy() returns sunlight transmission (0..1) from above-water cover (mangroves).
// Args: x, s global; ad = |x - pathX(s)|; g = the biome segment {key, seed, ...}; dx = x - pathX(s).
export const BIOMES = {
  reef: {
    label: 'Coral Reef', camY: -9, clearance: 4.5, len: [700, 1100], weight: 1.3,
    sigma: [0.11, 0.035, 0.028], lightSigma: [0.045, 0.016, 0.013],
    deep: C(0x0b5d8c), up: C(0x5cc8ea), sun: 1.15, caustic: 1.0, shafts: 1.0, ambient: 1.0, glow: 0, snow: 0.6,
    sand: [0.86, 0.79, 0.63], rock: [0.5, 0.44, 0.4],
    floor(x, s, ad, g) {
      const m = fbm2(x / 18, s / 18, 4, 11) * 1.6 * (0.6 + 0.8 * sv(g, 3));
      const b = Math.max(0, noise2(x / 9, s / 9, 12)) ** 2 * 5 * (0.6 + 0.8 * sv(g, 4)) * smoothstep(5, 12, ad);
      const w0 = 18 + 22 * sv(g, 2);
      const wall = smoothstep(w0, w0 + 50, ad) * (9 + 9 * fbm2(x / 40, s / 40, 3, 13)) * (0.5 + sv(g, 1));
      return m + b + wall;
    },
  },
  softcoral: {
    label: 'Soft Coral Garden', camY: -11, clearance: 4.2, len: [600, 950], weight: 0.95,
    sigma: [0.1, 0.03, 0.022], lightSigma: [0.042, 0.015, 0.012],
    deep: C(0x0a5e96), up: C(0x5ccdf2), sun: 1.1, caustic: 0.95, shafts: 1.1, ambient: 1.05, glow: 0, snow: 0.7,
    sand: [0.84, 0.8, 0.68], rock: [0.55, 0.48, 0.44],
    floor(x, s, ad, g) {
      const pin = Math.max(0, noise2(x / 14, s / 14, 151) - 0.1) ** 1.5 * (7 + 5 * sv(g, 1)) * smoothstep(5, 12, ad);
      return pin + fbm2(x / 16, s / 16, 4, 152) * 1.4 + smoothstep(30, 80, ad) * 8 * (0.6 + 0.8 * sv(g, 2));
    },
  },
  wall: {
    label: 'The Wall', camY: -15, clearance: 6, len: [600, 950], weight: 0.95,
    sigma: [0.09, 0.027, 0.019], lightSigma: [0.04, 0.014, 0.011],
    deep: C(0x05396b), up: C(0x3aa3df), sun: 1.05, caustic: 0.8, shafts: 1.3, ambient: 1.0, glow: 0, snow: 0.6,
    sand: [0.78, 0.74, 0.62], rock: [0.52, 0.47, 0.42],
    // A vertical reef wall on one side of the path, the blue abyss falling away on the other.
    floor(x, s, ad, g, dx) {
      const side = sv(g, 1) < 0.5 ? -1 : 1, t = dx * side; // t > 0 toward the wall
      const wd = 7 + 3 * noise1(s / 60, 141) + 2 * sv(g, 2);
      const rise = smoothstep(wd - 2, wd + 6, t) * (16 + 4 * fbm2(x / 25, s / 25, 3, 142));
      const ledge = fbm2(x / 5, s / 5, 3, 143) * 1.4 * smoothstep(wd - 3, wd + 2, t);
      const drop = smoothstep(3, 30, -t) * (120 + 40 * fbm2(x / 50, s / 50, 2, 144));
      return fbm2(x / 10, s / 10, 3, 145) * 0.8 + rise + ledge - drop;
    },
  },
  kelp: {
    // green-gold, luminous temperate water (clearer than it used to be: 0x0f4c43 / 0.06 left a black-green
    // murk in which the forest and its canopy did not read); still cooler and greener than the reef
    label: 'Kelp Forest', camY: -11, clearance: 6, len: [650, 1000], weight: 1.0,
    sigma: [0.15, 0.048, 0.062], lightSigma: [0.062, 0.022, 0.03],
    deep: C(0x246652), up: C(0x98cf9c), sun: 1.35, caustic: 0.9, shafts: 1.6, ambient: 1.12, glow: 0, snow: 1.0,
    sand: [0.56, 0.51, 0.4], rock: [0.34, 0.31, 0.26],
    // rocky reef cut by sand channels (kelpChannel, shared with floorTint)
    floor(x, s, ad, g) {
      return fbm2(x / 14, s / 14, 5, 21) * 2.6 + ridge2(x / 30, s / 30, 3, 22) * 3.5 * (0.5 + sv(g, 1))
        - kelpChannel(x, s, ad) * 0.9 + smoothstep(30, 85, ad) * 7 * (0.5 + sv(g, 2));
    },
    // the floating canopy: dark over the groves, open over clearings and barrens, and holed by gaps that
    // let the sun through as shafts (the sky map turns this into light pools and god rays)
    canopy(x, s, ad, g, dx) { return 1 - 0.76 * kelpCover(x, s, g, dx, true); },
  },
  seagrass: {
    label: 'Seagrass Meadow', camY: -4.2, clearance: 2.4, len: [600, 900], weight: 0.9,
    sigma: [0.14, 0.05, 0.06], lightSigma: [0.06, 0.022, 0.028],
    deep: C(0x1d6f6a), up: C(0x8adccb), sun: 1.2, caustic: 1.25, shafts: 0.8, ambient: 1.05, glow: 0, snow: 0.8,
    sand: [0.78, 0.74, 0.56], rock: [0.48, 0.46, 0.4],
    floor(x, s, ad, g) {
      return fbm2(x / 25, s / 25, 3, 31) * 0.8 * (0.5 + sv(g, 1)) + smoothstep(40, 95, ad) * 3;
    },
  },
  mangrove: {
    label: 'Mangrove Roots', camY: -1.9, clearance: 2.3, len: [450, 700], weight: 0.8,
    // shallow, sunlit, tannin-green murk: the in-scatter colours carry most of the frame in water this turbid,
    // so they are bright (0x2b4a35 / 0xa8c38e left a 2 m daylight scene at a mean luminance of ~40)
    sigma: [0.15, 0.075, 0.12], lightSigma: [0.06, 0.03, 0.05],
    deep: C(0x527a52), up: C(0xbcd8a0), sun: 1.1, caustic: 1.2, shafts: 0.9, ambient: 1.0, glow: 0, snow: 1.2,
    sand: [0.6, 0.52, 0.39], rock: [0.32, 0.27, 0.22],
    floor(x, s, ad, g) {
      return fbm2(x / 12, s / 12, 3, 131) * 0.5 + smoothstep(9, 26, ad) * (1.6 + 1.2 * sv(g, 1));
    },
    // dappled shade from the mangrove canopy above the surface; more open over the channel
    canopy(x, s, ad) {
      const leaf = smoothstep(-0.25, 0.45, noise2(x / 7, s / 7, 132)) * 0.55 + smoothstep(0, 0.6, noise2(x / 2.5, s / 2.5, 133)) * 0.25;
      return Math.min(1, 0.22 + leaf + smoothstep(9, 3, ad) * 0.35);
    },
  },
  sandflat: {
    label: 'Sand Flats', camY: -7, clearance: 3.0, len: [550, 850], weight: 0.9,
    sigma: [0.1, 0.032, 0.03], lightSigma: [0.045, 0.016, 0.014],
    deep: C(0x0f6f93), up: C(0x6fd6ee), sun: 1.15, caustic: 1.3, shafts: 1.0, ambient: 1.05, glow: 0, snow: 0.5,
    sand: [0.9, 0.84, 0.7], rock: [0.6, 0.55, 0.48],
    floor(x, s, ad, g) {
      const k = 0.07 + 0.08 * sv(g, 1), dir = (sv(g, 2) - 0.5) * 0.12;
      const dune = Math.sin(s * k + x * dir + noise2(x / 30, s / 30, 121) * 3) * 0.45 * (0.4 + 1.4 * sv(g, 3));
      return fbm2(x / 40, s / 40, 3, 122) * 1.4 + dune + smoothstep(60, 120, ad) * 4;
    },
  },
  pelagic: {
    label: 'Open Ocean', camY: -16, clearance: 260, len: [700, 1100], weight: 1.1,
    sigma: [0.085, 0.024, 0.016], lightSigma: [0.04, 0.014, 0.01],
    deep: C(0x022a55), up: C(0x2a86d6), sun: 1.05, caustic: 0.6, shafts: 0.85, ambient: 1.0, glow: 0, snow: 0.5,
    sand: [0.3, 0.3, 0.32], rock: [0.2, 0.2, 0.22],
    floor(x, s) { return fbm2(x / 60, s / 60, 3, 41) * 20; },
  },
  cave: {
    label: 'Cenote Caves', camY: -13, clearance: 4, len: [600, 900], weight: 0.9,
    sigma: [0.08, 0.022, 0.018], lightSigma: [0.04, 0.012, 0.01],
    deep: C(0x05324a), up: C(0x3ca6c8), sun: 1.0, caustic: 0.7, shafts: 1.0, ambient: 0.55, glow: 0.15, snow: 0.5,
    sand: [0.78, 0.75, 0.66], rock: [0.62, 0.58, 0.5],
    floor(x, s, ad, g) {
      const w = (8 + 5 * noise1(s / 50, 51)) * (0.8 + 0.5 * sv(g, 1));
      return fbm2(x / 8, s / 8, 4, 52) * 1.5 + Math.max(0, noise2(x / 5, s / 5, 53)) * 2 * smoothstep(3, 7, ad)
        + smoothstep(w, w + 9, ad) * 26;
    },
    ceil(x, s, ad, g) {
      const w = (8 + 5 * noise1(s / 50, 51)) * (0.8 + 0.5 * sv(g, 1));
      let c = 3.5 + 1.8 * fbm2(x / 10, s / 10, 4, 54) + Math.max(0, noise2(x / 3, s / 3, 55)) ** 3 * -2.5 * smoothstep(3, 6, ad);
      c -= smoothstep(w, w + 8, ad) * 26;
      // Cenote openings to the sky where the noise o passes th. The rim follows the approximate distance to
      // that contour, (o - th) / |grad o|, wobbled by a finer noise so the outline wanders across the 1.5 m
      // mesh grid; the wall climbs at ~65 degrees from a rounded lip. (A step of (o - th) * 260 made near-vertical
      // walls that the heightfield drew as straight grid-aligned edges over stretched triangles.)
      const o = noise2(x / 34, s / 34, 56), th = 0.26 + 0.14 * sv(g, 2);
      if (o > th - 0.52) { // r > -lip needs o - th > -7.3 G, and G is capped at 0.07 /m
        const e = 0.5, gx = noise2((x + e) / 34, s / 34, 56) - o, gs = noise2(x / 34, (s + e) / 34, 56) - o;
        const G = Math.min(0.07, Math.max(0.012, Math.hypot(gx, gs) / e));
        const r = (o - th) / G + 1.3 * noise2(x / 6, s / 6, 57) + 4.5;
        const lip = 1.5; // smooth max(0, r) over +-lip, times the wall slope tan(65 deg) ~ 2.1
        if (r > -lip) c += Math.min(45, 2.1 * (r < lip ? (r + lip) * (r + lip) / (4 * lip) : r));
      }
      return c;
    },
  },
  wreck: {
    // clear blue wreck-dive water (Red Sea, Truk, Malta): a hull resolves as a dark silhouette from ~60 m out
    label: 'Sunken Wrecks', camY: -20, clearance: 5.5, len: [650, 1000], weight: 1.0,
    sigma: [0.11, 0.034, 0.03], lightSigma: [0.05, 0.017, 0.015],
    deep: C(0x0b4866), up: C(0x43a2c4), sun: 1.0, caustic: 0.6, shafts: 1.05, ambient: 1.0, glow: 0, snow: 1.1,
    sand: [0.7, 0.66, 0.56], rock: [0.4, 0.38, 0.35], // pale sand: the dark hulls stand out against it
    floor(x, s, ad, g) { return fbm2(x / 30, s / 30, 3, 61) * 1.2 * (0.5 + sv(g, 1)) + smoothstep(50, 110, ad) * 6; },
  },
  ruins: {
    label: 'Sunken City', camY: -14, clearance: 5.5, len: [700, 1100], weight: 1.0,
    sigma: [0.12, 0.04, 0.034], lightSigma: [0.05, 0.018, 0.015],
    deep: C(0x08446a), up: C(0x39a9cf), sun: 1.0, caustic: 0.85, shafts: 1.1, ambient: 1.0, glow: 0, snow: 0.8,
    sand: [0.8, 0.76, 0.66], rock: [0.66, 0.62, 0.55],
    floor(x, s, ad, g) {
      const step = 1.6 + 1.4 * sv(g, 1);
      const t = fbm2(x / 45, s / 45, 3, 71) * 7 * (0.6 + 0.8 * sv(g, 2)) + 4;
      // ramp up away from the path first, then quantise, so terrace tops are flat
      const t2 = t * smoothstep(9, 30, ad), f = t2 / step;
      const terr = (Math.floor(f) + smoothstep(0.82, 1, f - Math.floor(f))) * step;
      return fbm2(x / 12, s / 12, 2, 72) * 0.4 + terr;
    },
  },
  vents: {
    label: 'Hydrothermal Vents', camY: -42, clearance: 6, len: [550, 850], weight: 0.8,
    sigma: [0.1, 0.045, 0.035], lightSigma: [0.05, 0.02, 0.015],
    deep: C(0x01080e), up: C(0x041d2a), sun: 0.06, caustic: 0, shafts: 0.05, ambient: 0.3, glow: 0.75, snow: 1.6,
    sand: [0.36, 0.33, 0.31], rock: [0.25, 0.23, 0.23],
    floor(x, s, ad, g) {
      return ridge2(x / 22, s / 22, 4, 81) * 9 * (0.6 + 0.8 * sv(g, 1)) * smoothstep(5, 20, ad)
        + fbm2(x / 6, s / 6, 3, 82) * 1.2 + smoothstep(40, 90, ad) * 6;
    },
  },
  deepplain: {
    label: 'Abyssal Plain', camY: -50, clearance: 4.5, len: [550, 850], weight: 0.75,
    sigma: [0.09, 0.04, 0.032], lightSigma: [0.05, 0.02, 0.015],
    deep: C(0x01060c), up: C(0x02121e), sun: 0.03, caustic: 0, shafts: 0, ambient: 0.25, glow: 0.7, snow: 1.9,
    sand: [0.6, 0.58, 0.54], rock: [0.36, 0.35, 0.34],
    // soft sediment with occasional brine-pool basins (see brineBasins below)
    floor(x, s, ad, g) {
      const base = fbm2(x / 50, s / 50, 3, 161) * 2.5 + fbm2(x / 9, s / 9, 2, 162) * 0.3;
      return base + basinDepth(g, x, s) + smoothstep(50, 110, ad) * 6;
    },
  },
  tidepool: {
    label: 'Tide Pools', camY: -1.7, clearance: 1.4, len: [450, 700], weight: 0.8,
    sigma: [0.13, 0.042, 0.048], lightSigma: [0.06, 0.022, 0.026],
    deep: C(0x2c8079), up: C(0xb0ebe0), sun: 1.35, caustic: 1.6, shafts: 0.6, ambient: 1.1, glow: 0, snow: 0.7,
    sand: [0.62, 0.57, 0.47], rock: [0.42, 0.33, 0.34],
    floor(x, s, ad, g) {
      return fbm2(x / 6, s / 6, 4, 91) * 1.0 + Math.max(0, noise2(x / 4, s / 4, 92)) * 1.2 * smoothstep(2.5, 5, ad)
        + smoothstep(4.5, 13, ad) * (4.8 + 2.2 * fbm2(x / 9, s / 9, 3, 93)) * (0.8 + 0.4 * sv(g, 1));
    },
  },
  abyss: {
    label: 'Midnight Zone', camY: -55, clearance: 260, len: [500, 800], weight: 0.7,
    sigma: [0.1, 0.04, 0.03], lightSigma: [0.05, 0.02, 0.015],
    deep: C(0x000307), up: C(0x010c18), sun: 0.02, caustic: 0, shafts: 0, ambient: 0.22, glow: 1.0, snow: 1.4,
    sand: [0.32, 0.31, 0.33], rock: [0.22, 0.22, 0.24],
    floor(x, s) { return fbm2(x / 60, s / 60, 3, 101) * 20; },
  },
  polar: {
    label: 'Polar Ice', camY: -9, clearance: 45, len: [600, 950], weight: 0.85,
    sigma: [0.13, 0.05, 0.045], lightSigma: [0.06, 0.022, 0.02],
    deep: C(0x0a3442), up: C(0x3a8794), sun: 0.75, caustic: 0.35, shafts: 1.0, ambient: 0.85, glow: 0, snow: 1.0,
    sand: [0.42, 0.42, 0.42], rock: [0.3, 0.3, 0.31],
    floor(x, s) { return fbm2(x / 30, s / 30, 4, 111) * 8; },
    ceil(x, s, ad, g) {
      let c = 7.6 + 0.6 * fbm2(x / 7, s / 7, 3, 112);
      // pressure-ridge keels: long, rounded rubble ridges (a Gaussian across the ridge line, no sharp saw-tooth crests)
      const rn = noise2(x / 38 + 0.35 * fbm2(x / 70, s / 70, 2, 116), s / 38, 113);
      const keel = Math.exp(-((rn / 0.2) ** 2)) * (0.65 + 0.35 * fbm2(x / 9, s / 9, 2, 115));
      c -= keel * 8 * (0.5 + sv(g, 1)) * smoothstep(5, 16, ad);
      const lead = noise2(x / 45, s / 45, 114), th = 0.3 + 0.16 * sv(g, 2);
      if (lead > th) c += (lead - th) * 120; // open leads between floes
      return c;
    },
  },
};

// ---------- Seven more oceanscapes (added 2026-10-31) ----------
// Cone-ish peaks scattered on a jittered grid (0..1), used for seamount pinnacles.
function peaks(x, s, cell, seed, rMin, rMax, keep) {
  let best = 0;
  const cx0 = Math.floor(x / cell), cy0 = Math.floor(s / cell);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = cx0 + i, cy = cy0 + j;
    if (hash2i(cx, cy, seed + 3) > keep) continue;
    const px = (cx + hash2i(cx, cy, seed)) * cell, ps = (cy + hash2i(cx, cy, seed + 1)) * cell;
    const r = rMin + (rMax - rMin) * hash2i(cx, cy, seed + 2);
    const d = Math.hypot(x - px, s - ps) / r;
    if (d < 1) best = Math.max(best, Math.pow(1 - d, 1.4));
  }
  return best;
}
// Seamount pinnacles the path is routed past. The lattice above leaves 100+ m of empty blue beside the path,
// so every seamount segment also gets one spire every 60-80 m, centred 15-34 m to the side at the sharpest
// bend of that stretch and on its outside (see WorldShape.pathCurv): it rises ahead and the camera swings past.
// The segment a dive starts in has one 45 m ahead of the camera. Sorted by s; {x, s, r}.
function routePeaksOf(g) {
  if (g._route) return g._route;
  const out = [], h = (i, k) => hash1((g.seed ^ Math.imul(i + 1, 0x85ebca6b) ^ Math.imul(k + 1, 0x9e3779b1)) | 0);
  const bend = (s) => pathXAt(s + 20) - 2 * pathXAt(s) + pathXAt(s - 20); // + = bending toward +x
  let s = g.camStart !== undefined ? g.camStart + 45 : g.start + 10 + 30 * sv(g, 20);
  for (let i = 0; s < g.end + 20; i++) {
    let b = bend(s);
    if (i > 0) { // the sharpest bend within the next 60-80 m
      const s0 = s;
      for (let t = s0 + 5; t <= s0 + 20; t += 5) { const bt = bend(t); if (Math.abs(bt) > Math.abs(b)) { b = bt; s = t; } }
    }
    const side = Math.abs(b) > 0.25 ? -Math.sign(b) : h(i, 1) < 0.5 ? -1 : 1;
    out.push({ x: pathXAt(s) + side * (15 + 19 * h(i, 2)), s, r: 18 + 12 * h(i, 3) });
    s += 60;
  }
  g._route = out;
  return out;
}
function routePeak(g, x, s) {
  if (!g || g.key !== 'seamount') return 0;
  const P = routePeaksOf(g);
  let lo = 0, hi = P.length, best = 0;
  while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].s < s - 30) lo = m + 1; else hi = m; }
  for (let i = lo; i < P.length && P[i].s < s + 30; i++) {
    const d = Math.hypot(x - P[i].x, s - P[i].s) / P[i].r;
    if (d < 1) best = Math.max(best, Math.pow(1 - d, 1.4));
  }
  return best;
}
// Pinnacle centres {x, s, r} of seamount segment g with s0 <= s < s1: the path-side spires plus the lattice
// peaks within 90 m of the path. Props place summit POIs, labels and fans from this list.
export function seamountPeaks(g, s0, s1, out = []) {
  if (!g || g.key !== 'seamount') return out;
  for (const p of routePeaksOf(g)) if (p.s >= s0 && p.s < s1) out.push({ x: p.x, s: p.s, r: p.r });
  const cell = 70, seed = 172 + (g.seed & 15), px = pathXAt((s0 + s1) / 2);
  for (let cy = Math.floor((s0 - 40) / cell); cy <= Math.floor((s1 + 40) / cell); cy++) {
    for (let cx = Math.floor((px - 90) / cell); cx <= Math.floor((px + 90) / cell); cx++) {
      if (hash2i(cx, cy, seed + 3) > 0.6) continue;
      const x = (cx + hash2i(cx, cy, seed)) * cell, s = (cy + hash2i(cx, cy, seed + 1)) * cell;
      if (s >= s0 && s < s1) out.push({ x, s, r: 18 + 16 * hash2i(cx, cy, seed + 2) });
    }
  }
  return out;
}
// Floating sargassum mat density near the surface (0..1); props place mats where this is high.
export function sargassumCover(x, s) {
  const n = noise2(x / 22, s / 22, 181) * 0.7 + noise2(x / 7, s / 7, 182) * 0.3;
  return smoothstep(0.05, 0.45, n);
}
// The blue hole of a segment: a circular sinkhole centred on the path mid-segment.
export function blueHoleOf(g) {
  if (!g || g.key !== 'bluehole') return null;
  if (g._hole) return g._hole;
  const sc = g.start + (g.end - g.start) * (0.45 + 0.1 * sv(g, 2));
  g._hole = { x: pathXAt(sc), s: sc, R: 32 + 20 * sv(g, 1), depth: 140 + 30 * sv(g, 3) };
  return g._hole;
}
Object.assign(BIOMES, {
  seamount: {
    label: 'Seamount', camY: -18, clearance: 6, len: [600, 950], weight: 0.85,
    sigma: [0.085, 0.026, 0.018], lightSigma: [0.04, 0.014, 0.011],
    deep: C(0x033566), up: C(0x2f8fd8), sun: 1.05, caustic: 0.6, shafts: 1.3, ambient: 1.0, glow: 0, snow: 0.6,
    sand: [0.42, 0.4, 0.38], rock: [0.44, 0.41, 0.39],
    floor(x, s, ad, g) {
      const base = -40 + fbm2(x / 40, s / 40, 3, 171) * 6;
      const pk = Math.max(peaks(x, s, 70, 172 + ((g ? g.seed : 0) & 15), 18, 34, 0.6), routePeak(g, x, s));
      const spire = Math.pow(pk, 1.25) * (52 + 10 * sv(g, 1)) * (1 + 0.25 * fbm2(x / 8, s / 8, 3, 173));
      return Math.min(base + spire, 15);
    },
  },
  sargassum: {
    label: 'Sargassum Sea', camY: -4.5, clearance: 260, len: [550, 850], weight: 0.8,
    sigma: [0.08, 0.024, 0.017], lightSigma: [0.04, 0.014, 0.011],
    deep: C(0x0a3d78), up: C(0x4aa8e0), sun: 1.15, caustic: 0.9, shafts: 1.4, ambient: 1.0, glow: 0, snow: 0.6,
    sand: [0.3, 0.3, 0.32], rock: [0.2, 0.2, 0.22],
    floor(x, s) { return fbm2(x / 60, s / 60, 3, 183) * 20; },
    // shade under the golden floating mats
    canopy(x, s) { return 1 - 0.62 * sargassumCover(x, s); },
  },
  champagne: {
    label: 'Champagne Reef', camY: -6, clearance: 3.2, len: [500, 800], weight: 0.85,
    sigma: [0.1, 0.03, 0.025], lightSigma: [0.045, 0.016, 0.013],
    deep: C(0x0c6390), up: C(0x5ccbea), sun: 1.15, caustic: 1.25, shafts: 1.0, ambient: 1.05, glow: 0, snow: 0.6,
    sand: [0.46, 0.43, 0.41], rock: [0.33, 0.31, 0.3],
    floor(x, s, ad, g) {
      return fbm2(x / 14, s / 14, 4, 191) * 1.4 + Math.max(0, noise2(x / 6, s / 6, 192)) ** 2 * 2.5 * smoothstep(4, 9, ad)
        + smoothstep(25, 70, ad) * 7 * (0.6 + 0.8 * sv(g, 1));
    },
  },
  jellylake: {
    label: 'Jellyfish Lake', camY: -4, clearance: 4, len: [450, 700], weight: 0.7,
    sigma: [0.16, 0.07, 0.09], lightSigma: [0.06, 0.03, 0.04],
    deep: C(0x2f6a4f), up: C(0x9ccf86), sun: 1.15, caustic: 1.1, shafts: 1.2, ambient: 1.05, glow: 0, snow: 1.2,
    sand: [0.52, 0.5, 0.4], rock: [0.62, 0.6, 0.52],
    floor(x, s, ad, g) {
      return fbm2(x / 18, s / 18, 3, 201) * 1.0 + smoothstep(12, 32, ad) * (9 + 4 * fbm2(x / 15, s / 15, 3, 202)) * (0.8 + 0.4 * sv(g, 1));
    },
  },
  sunkenforest: {
    label: 'Sunken Forest', camY: -7, clearance: 4.5, len: [500, 800], weight: 0.75,
    sigma: [0.11, 0.04, 0.045], lightSigma: [0.05, 0.018, 0.02],
    deep: C(0x0e5a5a), up: C(0x6fc7b8), sun: 1.05, caustic: 0.9, shafts: 1.45, ambient: 1.0, glow: 0, snow: 1.1,
    sand: [0.5, 0.47, 0.38], rock: [0.4, 0.37, 0.32],
    floor(x, s, ad) { return fbm2(x / 20, s / 20, 3, 211) * 1.2 + smoothstep(35, 90, ad) * 6; },
  },
  anemone: {
    label: 'Anemone Fields', camY: -6.5, clearance: 3, len: [500, 800], weight: 0.85,
    sigma: [0.1, 0.03, 0.026], lightSigma: [0.045, 0.016, 0.013],
    deep: C(0x0b5f8c), up: C(0x5ccbe9), sun: 1.15, caustic: 1.2, shafts: 1.0, ambient: 1.05, glow: 0, snow: 0.6,
    sand: [0.82, 0.77, 0.62], rock: [0.5, 0.44, 0.4],
    floor(x, s, ad) {
      return fbm2(x / 10, s / 10, 4, 221) * 1.6 + Math.max(0, noise2(x / 7, s / 7, 222)) ** 1.5 * 2.2 * smoothstep(4, 8, ad)
        + smoothstep(30, 80, ad) * 6;
    },
  },
  bluehole: {
    label: 'Blue Hole', camY: -12, clearance: 4, len: [600, 900], weight: 0.7,
    sigma: [0.085, 0.025, 0.017], lightSigma: [0.04, 0.013, 0.01],
    deep: C(0x02305f), up: C(0x3a9fe0), sun: 1.1, caustic: 1.0, shafts: 1.3, ambient: 1.0, glow: 0, snow: 0.5,
    sand: [0.84, 0.8, 0.68], rock: [0.62, 0.58, 0.5],
    // a shallow reef plateau with a vast circular sinkhole the path crosses
    floor(x, s, ad, g) {
      let f = fbm2(x / 14, s / 14, 4, 231) * 1.4 + Math.max(0, noise2(x / 9, s / 9, 232)) ** 2 * 3 * smoothstep(5, 12, ad);
      const H = blueHoleOf(g);
      if (H) {
        const dx = x - H.x, ds = s - H.s, d = Math.hypot(dx, ds) || 1e-6, cx = dx / d, cs = ds / d;
        const R = H.R * (1 + 0.07 * noise2(cx * 1.6, cs * 1.6, 233));
        const wall = smoothstep(R, R - 10, d);
        const ledges = Math.floor(fbm2(x / 12, s / 12, 2, 234) * 3 + 3) * 0.8 * smoothstep(R - 2, R - 10, d) * smoothstep(R * 0.2, R - 12, d);
        f -= wall * (H.depth + 20 * fbm2(x / 30, s / 30, 2, 235)) - ledges;
      }
      return f;
    },
  },
});

// Per-biome metadata: HUD subtitle, nominal surface temperature (degC), sand ripple strength,
// and an optional floorTint(x, s, nn, T) that edits [sandR, sandG, sandB, rockR, rockG, rockB] (linear).
const META = {
  reef: { subtitle: 'shallow tropical reef', tempC: 27 },
  softcoral: { subtitle: 'a garden of soft corals', tempC: 26 },
  wall: { subtitle: 'along the edge of the abyss', tempC: 26, ripple: 0.6 },
  kelp: { subtitle: 'temperate forest of giant kelp', tempC: 14 },
  seagrass: { subtitle: 'sunlit meadow', tempC: 25 },
  mangrove: { subtitle: 'a nursery among the roots', tempC: 28, ripple: 0.25 },
  sandflat: { subtitle: 'rippled plains of rays and garden eels', tempC: 26, ripple: 1.6 },
  pelagic: { subtitle: 'the blue — open water', tempC: 24, ripple: 0.2 },
  cave: { subtitle: 'flooded limestone passages', tempC: 24 },
  wreck: { subtitle: 'graveyard of ships', tempC: 22 },
  ruins: { subtitle: 'a drowned civilisation', tempC: 23 },
  vents: { subtitle: 'black smokers of the deep', tempC: 4, ripple: 0.2 },
  deepplain: { subtitle: 'the abyssal plain, lit only by our lamps', tempC: 3, ripple: 0.15 },
  tidepool: { subtitle: 'where the sea meets the shore', tempC: 18, ripple: 0.2 },
  abyss: { subtitle: 'the midnight zone', tempC: 4, ripple: 0.2 },
  polar: { subtitle: 'beneath the sea ice', tempC: -1.6 },
  seamount: { subtitle: 'a mountain rising from the blue', tempC: 21, ripple: 0.3 },
  sargassum: { subtitle: 'golden rafts adrift on the open sea', tempC: 25, ripple: 0.2 },
  champagne: { subtitle: 'volcanic bubbles stream from the sand', tempC: 27, ripple: 0.7 },
  jellylake: { subtitle: 'a lake of a million jellyfish', tempC: 29, ripple: 0.3 },
  sunkenforest: { subtitle: 'a forest the sea reclaimed', tempC: 12, ripple: 0.4 },
  anemone: { subtitle: 'carpets of anemones and their clownfish', tempC: 27 },
  bluehole: { subtitle: 'a sinkhole falling into deep blue', tempC: 26 },
};
for (const [k, v] of Object.entries(META)) Object.assign(BIOMES[k], v);
// ---------- Five more oceanscapes (added 2026-11-02) ----------
Object.assign(BIOMES, {
  otterkelp: {
    label: 'Otter Coast', camY: -5, clearance: 3.5, len: [500, 800], weight: 0.85,
    sigma: [0.15, 0.055, 0.065], lightSigma: [0.065, 0.025, 0.032],
    deep: C(0x0f4a46), up: C(0x6cb8a6), sun: 1.1, caustic: 1.0, shafts: 1.3, ambient: 1.0, glow: 0, snow: 1.0,
    sand: [0.55, 0.5, 0.4], rock: [0.33, 0.31, 0.28],
    // shallow rocky reef under a kelp canopy; the shore rises toward the surface on one side
    floor(x, s, ad, g, dx) {
      const side = sv(g, 1) < 0.5 ? -1 : 1, t = dx * side;
      return fbm2(x / 12, s / 12, 4, 241) * 1.8 + ridge2(x / 25, s / 25, 3, 242) * 2.5
        + smoothstep(18, 70, t) * (7 + 3 * fbm2(x / 20, s / 20, 2, 243)) + smoothstep(30, 80, -t) * 4;
    },
  },
  whaleshark: {
    label: 'Whale Shark Grounds', camY: -6, clearance: 34, len: [550, 850], weight: 0.8,
    sigma: [0.13, 0.06, 0.07], lightSigma: [0.06, 0.026, 0.032],
    deep: C(0x0d4f5c), up: C(0x58b8b5), sun: 1.1, caustic: 0.9, shafts: 1.6, ambient: 1.05, glow: 0, snow: 2.4,
    sand: [0.6, 0.57, 0.5], rock: [0.4, 0.38, 0.35],
    floor(x, s) { return fbm2(x / 40, s / 40, 3, 251) * 6; },
  },
  biobay: {
    label: 'Bioluminescent Bay', camY: -3, clearance: 2.4, len: [450, 700], weight: 0.75,
    sigma: [0.18, 0.08, 0.09], lightSigma: [0.07, 0.03, 0.04],
    deep: C(0x020c16), up: C(0x0a2238), sun: 0.12, caustic: 0.2, shafts: 0.2, ambient: 0.35, glow: 1.0, snow: 1.6,
    sand: [0.42, 0.38, 0.3], rock: [0.3, 0.27, 0.23],
    lampMax: 0.08, // lamps would drown out the glow
    floor(x, s, ad) { return fbm2(x / 16, s / 16, 3, 261) * 0.6 + smoothstep(14, 40, ad) * 3; },
    canopy(x, s, ad) { return Math.min(1, 0.55 + smoothstep(16, 6, ad) * 0.45); }, // mangrove-fringed lagoon
  },
  iceedge: {
    // (the route runs ~4 m under the floes, close enough to see the algae, icicles and platelets hanging there)
    label: 'Ice Edge', camY: -5, clearance: 30, len: [550, 850], weight: 0.75,
    sigma: [0.13, 0.05, 0.045], lightSigma: [0.06, 0.022, 0.02],
    deep: C(0x0a3846), up: C(0x4f9fb0), sun: 0.85, caustic: 0.4, shafts: 1.2, ambient: 0.9, glow: 0, snow: 1.2,
    sand: [0.42, 0.42, 0.42], rock: [0.3, 0.3, 0.31],
    iceCeiling: true, iceLight: 0.38,
    floor(x, s) { return fbm2(x / 30, s / 30, 4, 271) * 8; },
    // pack ice on one side of the path with a sheer edge; scattered floes over the open water
    ceil(x, s, ad, g, dx) {
      const side = sv(g, 1) < 0.5 ? -1 : 1, t = dx * side;
      const surf = 5 - 0.6875 * noise1(s / 70, 7); // the surface over pathY (camY -5, see WorldShape.pathY)
      let ice = surf - 0.8 + 0.6 * fbm2(x / 7, s / 7, 3, 272);                 // the underside ~0.8 m down
      const rn = noise2(x / 30, s / 30, 273);
      ice -= Math.exp(-((rn / 0.22) ** 2)) * 6 * smoothstep(8, 20, t);          // rounded keels under the pack
      const floe = smoothstep(0.48, 0.64, noise2(x / 14, s / 14, 274)) * smoothstep(6, 12, ad);
      const pack = smoothstep(5, 10, t);
      const k = Math.max(pack, floe);
      // across the edge band the underside thins out through the surface on a slope the 1.5 m grid can follow, and
      // only above the water leaves for "no ice" (a jump straight to it drew every floe outline in grid stairs)
      return k > 0.02 ? ice + (surf + 1.5 - ice) * (1 - k) : 60;
    },
  },
  hadal: {
    label: 'Hadal Trench', camY: -70, clearance: 5, len: [500, 800], weight: 0.6,
    sigma: [0.09, 0.04, 0.032], lightSigma: [0.05, 0.02, 0.015],
    deep: C(0x000306), up: C(0x010a12), sun: 0.0, caustic: 0, shafts: 0, ambient: 0.2, glow: 0.8, snow: 2.0,
    // (a paler ooze blew out to white in the lamp pool, and the pale snailfish and amphipods vanished against it)
    sand: [0.38, 0.36, 0.34], rock: [0.26, 0.25, 0.25],
    // a V-shaped trench: sediment floor, steep walls rising on both sides
    floor(x, s, ad, g) {
      return fbm2(x / 10, s / 10, 3, 281) * 1.2 + smoothstep(6, 30, ad) * (36 + 10 * fbm2(x / 25, s / 25, 2, 282)) * (0.8 + 0.4 * sv(g, 1));
    },
  },
});
Object.assign(META, {
  otterkelp: { subtitle: 'sea otters in the kelp canopy', tempC: 13 },
  whaleshark: { subtitle: 'gentle giants feeding on plankton', tempC: 27, ripple: 0.4 },
  biobay: { subtitle: 'every movement glows', tempC: 28, ripple: 0.25 },
  iceedge: { subtitle: 'where the pack ice meets the open sea', tempC: -1.5, ripple: 0.3 },
  hadal: { subtitle: 'the deepest sea, eight thousand metres down', tempC: 1.5, ripple: 0.15 },
});
for (const k of ['otterkelp', 'whaleshark', 'biobay', 'iceedge', 'hadal']) Object.assign(BIOMES[k], META[k]);
BIOMES.polar.iceCeiling = true; BIOMES.polar.iceLight = 0.38;
BIOMES.otterkelp.floorTint = (x, s, nn, T) => { const p = smoothstep(0.2, 0.6, nn); T[3] += 0.12 * p; T[4] += 0.02 * p; T[5] += 0.06 * p; }; // coralline crusts
BIOMES.hadal.floorTint = (x, s, nn, T) => { const p = smoothstep(0.3, 0.7, fbm2(x / 9, s / 9, 2, 47)); T[0] -= 0.08 * p; T[1] -= 0.08 * p; T[2] -= 0.06 * p; };

// Seabed tints (applied after the sRGB->linear conversion of sand/rock; values are linear offsets).
BIOMES.tidepool.floorTint = (x, s, nn, T) => { const p = smoothstep(0.1, 0.5, nn); T[3] += 0.25 * p; T[4] += 0.05 * p; T[5] += 0.12 * p; };
BIOMES.vents.floorTint = (x, s, nn, T) => {
  const p = smoothstep(0.35, 0.7, fbm2(x / 11, s / 11, 2, 9));
  T[3] += 0.35 * p; T[4] += 0.18 * p; T[5] += 0.02 * p; T[0] += 0.2 * p; T[1] += 0.1 * p;
};
const greenish = (x, s, nn, T) => { const p = smoothstep(0.2, 0.6, nn); T[3] -= 0.06 * p; T[4] += 0.04 * p; };
BIOMES.reef.floorTint = BIOMES.softcoral.floorTint = BIOMES.anemone.floorTint = greenish;
// kelp: rocky reef in patches (kelp needs rock to hold on to), pale sand along the channels
BIOMES.kelp.floorTint = (x, s, nn, T) => {
  greenish(x, s, nn, T);
  const ch = kelpChannel(x, s);
  T[7] += 0.55 * (1 - ch) * smoothstep(-0.2, 0.25, noise2(x / 11, s / 11, 343));
  T[0] += 0.05 * ch; T[1] += 0.045 * ch; T[2] += 0.03 * ch;
};
BIOMES.wall.floorTint = (x, s, nn, T) => { const p = smoothstep(0.1, 0.55, fbm2(x / 5, s / 5, 2, 17)); T[3] += 0.22 * p; T[4] += 0.06 * p; T[5] += 0.08 * p; };
BIOMES.mangrove.floorTint = (x, s, nn, T) => { const p = smoothstep(0.2, 0.7, fbm2(x / 3, s / 3, 2, 19)); T[0] -= 0.12 * p; T[1] -= 0.1 * p; T[2] -= 0.07 * p; };
BIOMES.deepplain.floorTint = (x, s, nn, T) => { const p = smoothstep(0.3, 0.7, fbm2(x / 13, s / 13, 2, 23)); T[0] -= 0.1 * p; T[1] -= 0.1 * p; T[2] -= 0.08 * p; };
BIOMES.seamount.floorTint = (x, s, nn, T) => { // encrusting orange/purple life on volcanic rock
  const p = smoothstep(0.15, 0.6, fbm2(x / 6, s / 6, 2, 29)), q = smoothstep(0.3, 0.7, fbm2(x / 9, s / 9, 2, 31));
  T[3] += 0.12 * p + 0.04 * q; T[4] += 0.03 * p; T[5] += 0.02 * p + 0.07 * q;
};
BIOMES.champagne.floorTint = (x, s, nn, T) => { // iron-stained volcanic sand, pale bacterial film
  const p = smoothstep(0.35, 0.75, fbm2(x / 8, s / 8, 2, 37)), q = smoothstep(0.55, 0.85, fbm2(x / 3, s / 3, 2, 41));
  T[0] += 0.12 * p + 0.15 * q; T[1] += 0.05 * p + 0.15 * q; T[2] += 0.12 * q;
};
BIOMES.jellylake.floorTint = (x, s, nn, T) => { const p = smoothstep(0.2, 0.6, nn); T[0] -= 0.08 * p; T[1] += 0.02 * p; T[2] -= 0.08 * p; };
BIOMES.sunkenforest.floorTint = (x, s, nn, T) => { // silt with leaf litter
  const p = smoothstep(0.25, 0.7, fbm2(x / 4, s / 4, 2, 43)); T[0] -= 0.1 * p; T[1] -= 0.08 * p; T[2] -= 0.1 * p;
};
BIOMES.bluehole.floorTint = (x, s, nn, T) => { const p = smoothstep(0.2, 0.6, nn); T[3] -= 0.05 * p; T[4] += 0.03 * p; };

// ---------- Lost City (added 2026-11-13) ----------
// The alkaline hydrothermal field near the summit of the Atlantis Massif (Mid-Atlantic Ridge), about 800 m down:
// a steep massif of dark serpentinite stepped into terraces, with white carbonate chimneys (props: nb5_lostcity.js).
// Each segment has one landmark complex modelled on Poseidon (60 m tall). It stands on a bench cut into the slope,
// centred beside the sharpest bend of its stretch and on the outside of it (see WorldShape.pathCurv), so it rises
// dead ahead and the camera curves past it. A segment the camera starts in has it ~90 m ahead. {x, s, R, Rb, side}
export function lostCityTowerOf(g) {
  if (!g || g.key !== 'lostcity') return null;
  if (g._lc) return g._lc;
  const bend = (s) => pathXAt(s + 20) - 2 * pathXAt(s) + pathXAt(s - 20); // + = bending toward +x
  const L = g.end - g.start;
  let s = g.camStart !== undefined && g.camStart > g.start ? g.camStart + 90 : g.start + L * (0.32 + 0.2 * sv(g, 30));
  let b = bend(s);
  for (let t = s + 5, s0 = s; t <= s0 + 60; t += 5) { const bt = bend(t); if (Math.abs(bt) > Math.abs(b)) { b = bt; s = t; } }
  const side = Math.abs(b) > 0.25 ? -Math.sign(b) : sv(g, 31) < 0.5 ? -1 : 1;
  const R = 8 + 3 * sv(g, 32); // footprint radius of the complex (talus apron included)
  // (main tower radius ~R / 2 plus its flanges, ~4 m clear of the route: the lamps light its face from ~6 m)
  g._lc = { x: pathXAt(s) + side * (R * 0.56 + 6), s, R, Rb: R + 5, side };
  return g._lc;
}
const LC_TH = 4.5; // terrace riser height scale (m)
Object.assign(BIOMES, {
  lostcity: {
    label: 'Lost City', camY: -64, clearance: 5.5, len: [550, 850], weight: 0.7,
    // (clear water, absorbing red only a little more than green and blue: the lamp-lit carbonate stays white over
    // the 3-15 m it is seen at; with the usual deep-water red loss it came out teal)
    sigma: [0.05, 0.035, 0.03], lightSigma: [0.05, 0.02, 0.015],
    // (deep, near-black blue: everything that shows is lit by the lamps; the pale carbonate carries the frame)
    deep: C(0x01070c), up: C(0x061620), sun: 0.03, caustic: 0, shafts: 0, ambient: 0.38, glow: 0.4, snow: 1.5,
    sand: [0.46, 0.45, 0.42], rock: [0.23, 0.25, 0.23],
    // a steep massif stepped into terraces: rising on one side of the route (its riser lines wander with fbm),
    // falling away in terraces on the other, rough serpentinite between; a bench under the landmark complex
    floor(x, s, ad, g, dx) {
      const side = sv(g, 1) < 0.5 ? -1 : 1, t = dx * side + fbm2(x / 23, s / 23, 2, 301) * 7;
      const st = LC_TH * (1 + 0.6 * sv(g, 2)), steep = 0.9 + 0.5 * sv(g, 3);
      const terr = (u) => (Math.floor(u) + smoothstep(0.62, 1, u - Math.floor(u))) * st;
      const up = Math.max(0, t - 8) * steep / st, dn = Math.max(0, -t - 11) * 0.75 / st;
      let h = terr(up) - Math.min(terr(dn), 36) + fbm2(x / 7, s / 7, 3, 302) * 1.1 + ridge2(x / 16, s / 16, 3, 303) * 1.8 * smoothstep(4, 14, ad);
      const T = lostCityTowerOf(g);
      if (T) {
        const d = Math.hypot(x - T.x, s - T.s);
        if (d < T.Rb + 12) { const k = smoothstep(T.Rb + 12, T.Rb, d); h += (-1.5 + 0.4 * fbm2(x / 5, s / 5, 2, 304) - h) * k; }
      }
      return h;
    },
  },
});
Object.assign(META, { lostcity: { subtitle: 'white carbonate towers on the Atlantis Massif', tempC: 7, ripple: 0.15 } });
Object.assign(BIOMES.lostcity, META.lostcity);
// pale carbonate caps on the terrace treads (the rock faces stay dark serpentinite, a little green)
BIOMES.lostcity.floorTint = (x, s, nn, T) => {
  const p = smoothstep(0.3, 0.72, fbm2(x / 13, s / 13, 2, 305)), q = smoothstep(0.3, 0.7, fbm2(x / 6, s / 6, 2, 306));
  T[0] += 0.2 * p; T[1] += 0.2 * p; T[2] += 0.18 * p; T[3] -= 0.01 * q; T[4] += 0.01 * q;
};

// --- coldcoral ---
// Cold-water coral reef: a current-swept bank ~300 m down with mounds and ridges of Lophelia (Desmophyllum
// pertusum) framework, living thickets on their crowns (props: nb6_coldcoral.js), silty seabed between them.
// Twilight-zone water: a faint blue-violet residue of daylight, the ROV lamps carry the colour.
Object.assign(BIOMES, {
  coldcoral: {
    label: 'Cold-Water Coral Reef', camY: -40, clearance: 5.6, len: [600, 950], weight: 0.8,
    // clearer than the abyssal zones and with a little more blue-violet in-scatter, so a mound's silhouette and its
    // pale crown read at 25-30 m; the lamps still carry all the colour (sun 0.14 keeps them on: deepDark ~0.84)
    sigma: [0.08, 0.034, 0.028], lightSigma: [0.05, 0.021, 0.016],
    deep: C(0x090c2a), up: C(0x18224e), sun: 0.14, caustic: 0, shafts: 0.06, ambient: 0.55, glow: 0.3, snow: 1.5,
    // pale silt between the mounds; grey-brown rubble and dead framework on their flanks (a paler silt blew out
    // to white in the lamp pool, as in hadal)
    sand: [0.46, 0.44, 0.4], rock: [0.34, 0.29, 0.245],
    floor(x, s, ad, g) { return ccFloor(g, x, s, ad); },
  },
});
Object.assign(META, { coldcoral: { subtitle: 'living coral mounds in cold, dark water', tempC: 6, ripple: 0.08 } });
Object.assign(BIOMES.coldcoral, META.coldcoral);
// The mounds are rubble and dead framework all over (not silt), a pale scatter of old coral fragments on it and
// more where gear crushed the reef; darker silt drifts between the mounds. (g: the segment, from terrain_gen.)
const _cct = {};
BIOMES.coldcoral.floorTint = (x, s, nn, T, g) => {
  const S = ccSample(g, x, s, _cct), k = smoothstep(0.3, 1.6, S.hm) * (1 - 0.4 * S.scar);
  const p = smoothstep(0.35, 0.75, fbm2(x / 3, s / 3, 2, 621)) * (1 + S.scar), q = smoothstep(0.3, 0.7, fbm2(x / 11, s / 11, 2, 622)) * (1 - k);
  for (let i = 0; i < 3; i++) { T[3 + i] += (0.1 - 0.01 * i) * p; T[i] -= (0.06 - 0.005 * i) * q; }
  // rubble on the mounds takes the rock texture and loses the sand grain and ripples (T[6], T[7]: terrain_gen)
  T[6] = 1 - k; T[7] = 0.9 * k;
};

// --- whalefall ---
// A whale fall: one very large rorqual carcass on a dark, muddy deep slope, lamp-lit (props: nb7_whalefall.js). A short
// zone flown very slowly (cruise 0.45), sparse on purpose: the carcass is the event. One carcass per segment, lying on
// the mud beside the route on the outside of the sharpest bend of the segment's middle (so it opens up dead ahead and
// the camera curves along it), its long axis along the path, its near flank ~5-6 m from the camera line. A segment the
// camera starts in (page load, zone jump) has it ~75 m ahead, and always the fresh stage.
// {x, s, side (-1 / 1: which side of the route), ca, sa (axis: unit (x, s) direction of the path there), L (body
// length), R (footprint half length incl. the stained mud), stage (0 fresh, 2 old skeleton), off}
export function whaleFallOf(g) {
  if (!g || (g.key !== 'whalefall' && g.key !== 'whalefalldeep')) return null;
  if (g._wf) return g._wf;
  const bend = (s) => pathXAt(s + 20) - 2 * pathXAt(s) + pathXAt(s - 20); // + = bending toward +x
  const cam = g.camStart !== undefined && g.camStart > g.start, Lg = g.end - g.start;
  // (in the middle: its neighbours' cross-fades, with their props, stay 50 m or more beyond either end)
  let s = cam ? g.camStart + 75 : g.start + Lg * (0.48 + 0.04 * sv(g, 650)), b = bend(s);
  for (let t = s - 10, s0 = s; t <= s0 + 10; t += 5) { const bt = bend(t); if (Math.abs(bt) > Math.abs(b)) { b = bt; s = t; } }
  const side = Math.abs(b) > 0.25 ? -Math.sign(b) : sv(g, 651) < 0.5 ? -1 : 1;
  const stage = cam || g.key === 'whalefall' || sv(g, 652) < 0.62 ? 0 : 2; // (the old skeleton: deep only)
  // (its heading a little off the path's; the body is up to ~3.8 m wide at the chest: its centre ~2 m beyond the
  // near flank, which runs ~5-6 m from the camera line, also at the end the heading turns toward it)
  const L = 17 + 6 * sv(g, 653), yaw = (sv(g, 655) - 0.5) * 0.26, a = Math.atan2(pathXAt(s + 4) - pathXAt(s - 4), 8) + yaw;
  const off = 7.3 + 0.9 * sv(g, 654) + Math.abs(Math.sin(yaw)) * L * 0.45;
  g._wf = { x: pathXAt(s) + side * off, s, side, ca: Math.sin(a), sa: Math.cos(a), L, R: L / 2 + 7, stage, off, cam, deep: g.key === 'whalefalldeep' };
  return g._wf;
}
// carcass frame of (x, s): u along the body (+ toward the head, which points down the route), v across (+ away from
// the route); out = [u, v]
export function whaleFallUV(W, x, s, out) {
  const dx = x - W.x, ds = s - W.s;
  out[0] = dx * W.ca + ds * W.sa; out[1] = (dx * W.sa - ds * W.ca) * W.side;
  return out;
}
const _wuv = [0, 0];
// Two variants share the carcass, the floor and the set piece: 'whalefall', sunlit shallows with a crowd of sharks
// (the user's brief), and 'whalefalldeep', the lamp-lit deep basin with sleeper sharks and hagfish (and old skeletons).
export const isWhaleFall = (k) => k === 'whalefall' || k === 'whalefalldeep';
Object.assign(BIOMES, {
  whalefalldeep: {
    // (short, but long enough that the 90 m cross-fades into its neighbours lie 50 m or more beyond the carcass's ends:
    // at 240-360 m the next zone's jellyfish and algae turf were in view while the camera was still alongside it)
    label: 'Deep Whale Fall', camY: -48, clearance: 3.4, len: [340, 420], weight: 0.3,
    lenAhead: 280, // a dive that starts here keeps 280 m of this zone ahead (the carcass sits ~75 m in)
    cruise: 0.45,  // cruise speed factor: a very slow pass (blended by the sequence weights in main.js)
    // (clear, and red absorbed only a little more than green and blue, as at Lost City: the pale belly and the blubber
    // read as a looming pale shape from 25-30 m, and the red muscle stays red instead of going grey-teal)
    sigma: [0.042, 0.03, 0.026], lightSigma: [0.05, 0.02, 0.015],
    deep: C(0x01060b), up: C(0x03111b), sun: 0.03, caustic: 0, shafts: 0, ambient: 0.42, glow: 0.35, snow: 1.9,
    // dark grey-brown mud, so the pale carcass carries the frame
    sand: [0.33, 0.31, 0.28], rock: [0.25, 0.24, 0.23],
    // a gentle muddy slope: rising on the side of the route away from the carcass and falling away behind it (the
    // lamps light the carcass against dark water); a level bench under the carcass, pressed a little into the mud
    floor(x, s, ad, g, dx) {
      const W = whaleFallOf(g), side = W ? -W.side : sv(g, 1) < 0.5 ? -1 : 1, t = dx * side;
      const base = (xx, ss, tt) => fbm2(xx / 45, ss / 45, 3, 641) * 1.5 + fbm2(xx / 9, ss / 9, 2, 642) * 0.22 + tt * 0.05
        + smoothstep(20, 80, tt) * 6 - smoothstep(18, 70, -tt) * 4;
      let h = base(x, s, t);
      if (W) {
        const uv = whaleFallUV(W, x, s, _wuv), eu = uv[0] / (W.L / 2 + 6), ev = uv[1] / 8.5, e = Math.sqrt(eu * eu + ev * ev);
        if (e < 1.6) {
          const hc = base(W.x, W.s, -W.off) + 0.15;
          h += (hc - h) * smoothstep(1.6, 0.9, e);
          // the body's own shallow hollow (it lies pressed into the mud: not under the flukes and flippers, which
          // lie on it) and the mud churned up along its sides
          const bu = uv[0] / (W.L / 2 - 1.5), bv = Math.abs(uv[1]) / 2.8;
          h -= 0.16 * smoothstep(1.05, 0.8, bv) * smoothstep(1.0, 0.85, Math.abs(bu)) - 0.08 * Math.exp(-(((bv - 1.2) / 0.18) ** 2)) * smoothstep(1.1, 0.8, Math.abs(bu)) * (0.6 + 0.4 * noise2(x / 1.7, s / 1.7, 643));
        }
      }
      return h;
    },
  },
});
// (displayed as the Santa Cruz Basin off southern California: 1,675 m, ~4 degC; deeper, the sharks and hagfish drop out)
Object.assign(META, { whalefalldeep: { subtitle: 'a whale carcass feeds the deep sea floor', tempC: 4, ripple: 0.08 } });
Object.assign(BIOMES.whalefalldeep, META.whalefalldeep);
// the sunlit variant: the same carcass on pale sand in clear blue water, ~14 m down, sunlit (caustics, shafts), seen
// from far off; not slowed as much (the crowd of sharks is the show)
Object.assign(BIOMES, {
  whalefall: {
    label: 'Whale Fall', camY: -14, clearance: 3.4, len: [340, 420], weight: 0.5, lenAhead: 280, cruise: 0.55,
    // (clear: the carcass and the crowd round it read from 40-60 m, as the >40 m visibility of the Kona day)
    sigma: [0.09, 0.024, 0.021], lightSigma: [0.045, 0.016, 0.013],
    deep: C(0x0c5f8e), up: C(0x5ac6ea), sun: 1.15, caustic: 1.1, shafts: 1.25, ambient: 1.0, glow: 0, snow: 0.7,
    sand: [0.84, 0.8, 0.68], rock: [0.55, 0.5, 0.44], // (floor, floorTint: the lava flat, below)
  },
});
// (shown as off Hawaii: 25 degC water, 40 m+ visibility, as on the day tiger sharks and whitetips were filmed at a carcass)
Object.assign(META, { whalefall: { subtitle: 'sharks feeding at a whale carcass in warm, clear water', tempC: 25, ripple: 0.9 } });
Object.assign(BIOMES.whalefall, META.whalefall);
// The sunlit carcass has come to rest on a lava flat (a carcass off Kona was moved onto one in 2026: DLNR): pale rippled
// sand between low, ropy flows of black basalt ridged a few tens of centimetres, kept back from the carcass so nothing
// hides it; a level bench under the body as in the deep variant (props: nb7_whalefall.js, layoutWfB)
export function wfLavaAt(x, s, W) {
  // (patches, kept off the corridor under the camera: there they read as dark smudges filling the foreground)
  let m = smoothstep(0.04, 0.26, fbm2(x / 13, s / 13, 3, 664)) * smoothstep(5, 13, Math.abs(x - pathXAt(s)));
  if (W && m > 0) {
    const uv = whaleFallUV(W, x, s, _wuv), eu = uv[0] / (W.L / 2 + 8), ev = uv[1] / 10;
    m *= smoothstep(1.0, 1.5, Math.sqrt(eu * eu + ev * ev));
  }
  return m;
}
BIOMES.whalefall.floor = (x, s, ad, g) => {
  // (a flat: the large swells of the deep variant hid the carcass behind them from 30-50 m out)
  const W = whaleFallOf(g), base = (xx, ss) => fbm2(xx / 40, ss / 40, 3, 661) * 0.55 + fbm2(xx / 9, ss / 9, 2, 662) * 0.12;
  let h = base(x, s);
  const m = wfLavaAt(x, s, W);
  if (m > 0) h += m * (0.15 + 0.3 * ridge2(x / 3.2, s / 3.2, 2, 663));
  if (W) {
    const uv = whaleFallUV(W, x, s, _wuv), eu = uv[0] / (W.L / 2 + 6), ev = uv[1] / 8.5, e = Math.sqrt(eu * eu + ev * ev);
    if (e < 1.6) {
      h += (base(W.x, W.s) + 0.15 - h) * smoothstep(1.6, 0.9, e);
      const bu = uv[0] / (W.L / 2 - 1.5), bv = Math.abs(uv[1]) / 2.8;
      h -= 0.16 * smoothstep(1.05, 0.8, bv) * smoothstep(1.0, 0.85, Math.abs(bu)) - 0.08 * Math.exp(-(((bv - 1.2) / 0.18) ** 2)) * smoothstep(1.1, 0.8, Math.abs(bu)) * (0.6 + 0.4 * noise2(x / 1.7, s / 1.7, 643));
    }
  }
  return h;
};
// the sand around a sunlit carcass: a faint oily stain close in; black basalt on the lava, no ripples there
BIOMES.whalefall.floorTint = (x, s, nn, T, g) => {
  const W = whaleFallOf(g), m = wfLavaAt(x, s, W);
  if (m > 0) { T[3] = 0.085; T[4] = 0.075; T[5] = 0.07; T[7] = 0.85 * m; T[6] = 1 - m; }
  if (!W) return;
  const uv = whaleFallUV(W, x, s, _wuv), eu = uv[0] / (W.L / 2 + 4), ev = uv[1] / 5.5, e = Math.sqrt(eu * eu + ev * ev);
  if (e > 1.3) return;
  const k = smoothstep(1.25, 0.8, e + 0.15 * fbm2(x / 2.2, s / 2.2, 2, 646));
  T[0] -= 0.1 * k; T[1] -= 0.09 * k; T[2] -= 0.07 * k;
};
// the stained mud around the carcass: dark, oily sediment close in, a paler disturbed ring further out
BIOMES.whalefalldeep.floorTint = (x, s, nn, T, g) => {
  const W = whaleFallOf(g);
  const q = smoothstep(0.35, 0.75, fbm2(x / 6, s / 6, 2, 645)); // patchy mud everywhere: darker drifts
  T[0] -= 0.04 * q; T[1] -= 0.04 * q; T[2] -= 0.03 * q;
  if (!W) return;
  const uv = whaleFallUV(W, x, s, _wuv), eu = uv[0] / (W.L / 2 + 5), ev = uv[1] / 6.5, e = Math.sqrt(eu * eu + ev * ev);
  if (e > 1.4) return;
  const n = fbm2(x / 2.2, s / 2.2, 2, 646), k = smoothstep(1.3, 0.75, e + 0.18 * n);
  T[0] -= 0.13 * k; T[1] -= 0.13 * k; T[2] -= 0.11 * k; T[6] = 1 - 0.8 * k;
};

// Colours above are authored in sRGB; shaders work in linear light.
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
for (const b of Object.values(BIOMES)) for (const k of ['deep', 'up', 'sand', 'rock']) b[k] = b[k].map(toLin);
export const BIOME_KEYS = Object.keys(BIOMES);
const NO_CEIL = 60; // metres above the surface: "no ceiling" for open-water biomes

// ---------- Brine-pool basins (deepplain): rare set pieces, 1-2 per segment, near the path ----------
// The camera path's lateral position (same formula as WorldShape.pathX), so basins can sit beside it.
export const pathXAt = (s) => 30 * noise1(s / 260, 3) + 9 * noise1(s / 85, 5) + 3.5 * noise1(s / 38, 9);
function basinsOf(g) {
  if (!g || g.key !== 'deepplain') return [];
  if (g._basins) return g._basins;
  const out = [];
  if (sv(g, 3) < 0.75) {
    const n = sv(g, 4) < 0.35 ? 2 : 1, len = g.end - g.start;
    for (let k = 0; k < n; k++) {
      const s = g.start + len * (0.25 + 0.5 * ((k + sv(g, 5 + k)) / n));
      const side = sv(g, 7 + k) < 0.5 ? -1 : 1;
      const r = 10 + 7 * sv(g, 9 + k);
      const x = pathXAt(s) + side * (r * 0.35 + 4 + 14 * sv(g, 11 + k)); // often partly under the path
      out.push({ x, s, r, rFlat: r * 0.4, depth: 2.5 + 1.5 * sv(g, 13 + k), seed: (g.seed + k * 977) | 0 });
    }
  }
  g._basins = out;
  return out;
}
// Depression depth (<= 0) at (x, s): irregular, flat-bottomed basins with soft rims.
function basinDepth(g, x, s) {
  let h = 0;
  for (const b of basinsOf(g)) {
    const dx = x - b.x, ds = s - b.s;
    if (Math.abs(dx) > b.r * 1.4 || Math.abs(ds) > b.r * 1.4) continue;
    // radius noise sampled on a circle, so the rim has no seam at +-pi
    const d = Math.hypot(dx, ds) || 1e-6, cx = dx / d, cs = ds / d;
    const rr = b.r * (1 + 0.16 * noise2(cx * 1.4, cs * 1.4, b.seed) + 0.08 * noise2(cx * 3.2 + 7, cs * 3.2, b.seed + 1));
    h = Math.min(h, -b.depth * smoothstep(rr, rr * 0.4, d));
  }
  return h;
}
// Basin centres (global x, s) with radius r (m) overlapping [s0, s1] x [x0, x1] for segment g.
export function brineBasins(g, x0, x1, s0, s1) {
  return basinsOf(g).filter((b) => b.s >= s0 && b.s < s1 && b.x >= x0 && b.x < x1);
}

// --- coldcoral ---
// Reef mounds of a coldcoral segment, elongated along the current (u axis = the direction it flows toward):
// Norwegian-shelf style ridges 4-20 m high, or (one segment in ~3) low, rounder Darwin-Mounds style sand mounds
// 2-5 m high. Each mound has a rubble skirt and a low tail trailing downcurrent; the face into the current is a
// little steeper. One trawl scar per segment sits on a crushed mound near the path: flattened, with parallel
// furrows. Mounds are bucketed by s (32 m) so a floor sample tests only its neighbours.
const CC_NONE = { mounds: [], scar: null, darwin: false, near: () => [] };
const ccSmin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };
export function coldCoral(g) {
  if (!g || g.key !== 'coldcoral') return CC_NONE;
  if (g._cc) return g._cc;
  const rng = mulberry32((g.seed ^ 0x1c0a7c0) >>> 0);
  const darwin = sv(g, 600) < 0.3, th = sv(g, 601) * Math.PI * 2, rich = 0.7 + 0.5 * sv(g, 602);
  const mounds = [], add = (x, s, H, Lu, Lv, a) => mounds.push({ x, s, H, Lu, Lv, ca: Math.cos(a), sa: Math.sin(a), R: Math.max(Lu * 2.7, Lv * 1.6) + 2 });
  for (let s = g.start - 60; s < g.end + 60;) {
    s += darwin ? 13 + rng() * 15 : 10 + rng() * 16;
    const a = th + (rng() - 0.5) * 0.5;
    let H, Lu, Lv;
    if (darwin) { H = 2 + 3 * rng(); Lu = 13 + rng() * 20; Lv = Lu * (0.75 + 0.3 * rng()); }
    else if (rng() < 0.4) { H = 2 + 2.5 * rng(); Lu = 10 + rng() * 14; Lv = 5 + rng() * 5; } // small patch reefs
    else { H = 5 + 15 * rng() ** 1.4 * rich; Lu = 16 + H * 2 + rng() * 40; Lv = 7 + H * 0.5 + rng() * 9; }
    // low mounds may lie under the path (it flies over them); tall ones stand off to a side with their flanks in
    // reach of the lamps (ccFloor rounds them off below the flight tube)
    const side = rng() < 0.5 ? -1 : 1, crest = rng() < 0.35; // (the path crests about a third of them)
    const off = H < 4.5 ? rng() * 16 : crest ? rng() * Lv * 0.4 : Lv * 0.55 + 3 + rng() ** 1.5 * 24;
    add(pathXAt(s) + side * off, s, H, Lu, Lv, a);
  }
  // the trawl scar: a crushed mound beside the path, towed across roughly along the route
  const ss = g.start + (g.end - g.start) * (0.3 + 0.4 * sv(g, 603)), sx = pathXAt(ss) + (sv(g, 604) < 0.5 ? -1 : 1) * (5 + 9 * sv(g, 605));
  const ha = (sv(g, 606) - 0.5) * 1.2, fur = [];
  const W = 18 + 10 * sv(g, 607), nF = 3 + Math.floor(sv(g, 608) * 3);
  for (let k = 0; k < nF; k++) fur.push((k / (nF - 1) - 0.5) * W * 0.8 + (rng() - 0.5) * 2.5);
  const scar = { x: sx, s: ss, ca: Math.sin(ha), sa: Math.cos(ha), L: 50 + 30 * sv(g, 609), W, fur };
  add(sx, ss, darwin ? 4 : 6 + 3 * rng(), 22, 13, th);
  const B = new Map();
  mounds.forEach((m, i) => { for (let b = Math.floor((m.s - m.R) / 32); b <= Math.floor((m.s + m.R) / 32); b++) { let l = B.get(b); if (!l) B.set(b, (l = [])); l.push(i); } });
  const near = (s) => B.get(Math.floor(s / 32)) || [];
  g._cc = { mounds, scar, darwin, th, near };
  return g._cc;
}
// One mound at (x, s): height, plus its frame (relative height p 0..1 of the dome, along/across u v, radius d).
// wob: shared outline noise. out (optional) receives the frame.
function ccMound(m, x, s, wob, out) {
  const dx = x - m.x, ds = s - m.s;
  const u = (dx * m.ca + ds * m.sa) / m.Lu, v = (-dx * m.sa + ds * m.ca) / m.Lv;
  if (v > 1.75 || v < -1.75 || u < -1.5 || u > 2.7) return 0; // (the outline wobble is at most 16 %)
  const uu = u < 0 ? u * 1.2 : u;
  const d = Math.sqrt(uu * uu + v * v) * (1 + 0.16 * wob);
  const p = smoothstep(1, 0.1, d), skirt = (0.4 + 0.05 * m.H) * smoothstep(1.45, 0.9, d);
  const tail = u > 0.3 ? (0.35 + 0.06 * m.H) * Math.exp(-((v * 1.7) ** 2)) * smoothstep(2.6, 1.0, u) * smoothstep(0.3, 0.9, u) : 0;
  const h = m.H * p + Math.max(skirt, tail);
  if (out) { out.p = p; out.u = u; out.v = v; out.d = d; out.tail = tail > skirt ? smoothstep(0.15, 0.6, tail) : 0; }
  return h;
}
// trawl scar mask (0..1) and furrow depth at (x, s)
function ccScar(sc, x, s) {
  const dx = x - sc.x, ds = s - sc.s, u = dx * sc.ca + ds * sc.sa, v = -dx * sc.sa + ds * sc.ca;
  const k = smoothstep(sc.L / 2, sc.L / 2 - 10, Math.abs(u)) * smoothstep(sc.W / 2 + 3, sc.W / 2 - 4, Math.abs(v));
  if (k <= 0) return [0, 0];
  // furrow (wide enough for the 1.5 m grid) with low spoil banks pushed up either side
  let f = 0, bank = 0;
  for (const c of sc.fur) { const w = (v - c) / 1.4; f += Math.exp(-w * w); bank += Math.exp(-(((Math.abs(v - c) - 2.4) / 0.9) ** 2)); }
  return [k, (Math.min(1, f) * 0.85 - Math.min(1, bank) * 0.3) * k];
}
const _ccm = { p: 0, u: 0, v: 0, d: 9, tail: 0 };
// Reef state at (x, s) for props: mound height hm, the dominant mound's frame (p, u, v, d, tail), scar mask.
export function ccSample(g, x, s, out = {}) {
  const C = coldCoral(g), wob = noise2(x / 9, s / 9, 611);
  let hm = 0, best = null;
  out.p = 0; out.u = 0; out.v = 0; out.d = 9; out.tail = 0; out.H = 0;
  for (const i of C.near(s)) {
    const m = C.mounds[i], h = ccMound(m, x, s, wob, _ccm);
    if (h > hm) { hm = h; best = m; out.p = _ccm.p; out.u = _ccm.u; out.v = _ccm.v; out.d = _ccm.d; out.tail = _ccm.tail; out.H = m.H; }
  }
  out.scar = C.scar ? ccScar(C.scar, x, s)[0] : 0;
  out.hm = hm; out.m = best;
  return out;
}
function ccFloor(g, x, s, ad) {
  const C = coldCoral(g), wob = noise2(x / 9, s / 9, 611);
  let hm = 0;
  for (const i of C.near(s)) { const h = ccMound(C.mounds[i], x, s, wob, null); if (h > hm) hm = h; }
  let fur = 0, sk = 0;
  if (C.scar) { const r = ccScar(C.scar, x, s); sk = r[0]; hm *= 1 - 0.85 * sk; fur = r[1]; }
  // knobbly framework relief on the mounds (thickets, collapsed branches), period ~3 m
  const lump = hm > 0.4 ? fbm2(x / 3.2, s / 3.2, 2, 612) * 0.55 * smoothstep(0.4, 2.5, hm) * (1 - 0.8 * sk) : 0;
  const h = fbm2(x / 45, s / 45, 3, 613) * 1.3 + fbm2(x / 8, s / 8, 2, 614) * 0.15 + hm - fur;
  // near the path tall mounds round off ~3.8 m below the tube (room for the thicket on their crowns): low ones
  // pass under the camera, tall ones flank it
  // (the knobbly relief goes on after, so a rounded-off crown is not smooth)
  return ccSmin(h, 1.8 + Math.max(0, ad - 4.5) * 1.15, 1.2) + lump + smoothstep(70, 130, ad) * 6;
}

// ---------- Endless sequence ----------
const TH = 90; // half-width of the cross-fade between biomes (m)

export class BiomeSequence {
  constructor(seed, startKey = 'reef', startS = 0) {
    this.startS = startS;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.seed = seed;
    this.segs = [];
    this.recent = [];
    this.nextId = 0; // segment ids are never reused (pruning old segments must not recycle ids)
    this._push(BIOMES[startKey] ? startKey : 'reef');
    this.segs[0].camStart = startS; // where the camera starts (set pieces can be placed in view of it)
    this._ahead();
  }
  // a short zone (lenAhead) keeps that much of itself ahead of where the camera starts in it
  _ahead() { const g = this.segs[0], a = BIOMES[g.key].lenAhead; if (a) g.end = Math.max(g.end, this.startS + a); }
  // Start again in place (zone jump without a page reload): a new sequence from startKey at startS.
  restart(startKey, startS) {
    this.startS = startS;
    this.rng = mulberry32((this.seed ^ 0x9e3779b9 ^ Math.imul(this.nextId + 1, 0x85ebca6b)) >>> 0);
    this.segs = [];
    this.recent = [];
    this._push(BIOMES[startKey] ? startKey : 'reef');
    this.segs[0].camStart = startS;
    this._ahead();
  }
  _push(key) {
    const start = this.segs.length ? this.segs[this.segs.length - 1].end : this.startS - 200;
    const b = BIOMES[key];
    const len = this.rng.range(b.len[0], b.len[1]);
    this.segs.push({ key, start, end: start + len, id: this.nextId++, seed: (this.rng() * 1e9) | 0 });
    this.recent.push(key);
    if (this.recent.length > 5) this.recent.shift();
  }
  _extend(s) {
    while (this.segs[this.segs.length - 1].end < s + 400) {
      const opts = BIOME_KEYS.filter((k) => !this.recent.includes(k));
      let tot = 0; for (const k of opts) tot += BIOMES[k].weight;
      let r = this.rng() * tot, pick = opts[0];
      for (const k of opts) { r -= BIOMES[k].weight; if (r <= 0) { pick = k; break; } }
      this._push(pick);
    }
    // forget far-behind segments (keep a few for lookups)
    while (this.segs.length > 12 && this.segs[1].end < s - 2000) this.segs.shift();
  }
  // A lookup far ahead of the live range (a stale object after a zone jump) must not grow or prune the
  // sequence: one once rebuilt it 640 km ahead of the camera, which then sat in a pruned-away zone.
  // Such lookups read the last segment instead.
  _far(s) { return s > this.segs[this.segs.length - 1].end + 20000; }
  segAt(s) {
    if (this._far(s)) return this.segs.length - 1;
    this._extend(s);
    const a = this.segs;
    for (let i = a.length - 1; i >= 0; i--) if (s >= a[i].start) return i;
    return 0;
  }
  // Returns [{key, w, g}] (1-2 entries) summing to 1; g is the segment record.
  weights(s) {
    if (this._far(s)) { const g = this.segs[this.segs.length - 1]; return [{ key: g.key, w: 1, g }]; }
    const i = this.segAt(s), a = this.segs, g = a[i];
    if (i > 0 && s < g.start + TH) {
      const t = smoothstep(-TH, TH, s - g.start);
      if (t < 1) return [{ key: g.key, w: t, g }, { key: a[i - 1].key, w: 1 - t, g: a[i - 1] }];
    }
    if (s > g.end - TH) {
      this._extend(g.end + 10);
      const n = a[a.indexOf(g) + 1];
      const t = smoothstep(-TH, TH, s - g.end);
      return [{ key: g.key, w: 1 - t, g }, { key: n.key, w: t, g: n }];
    }
    return [{ key: g.key, w: 1, g }];
  }
  weightOf(s, key) { let w = 0; for (const e of this.weights(s)) if (e.key === key) w += e.w; return w; }
  // Segments overlapping [s0, s1)
  segmentsBetween(s0, s1) {
    if (!this._far(s1)) this._extend(s1);
    return this.segs.filter((g) => g.end > s0 && g.start < s1);
  }
  // Plain copy of the live segment list, sent with every world-worker job (src/worker/).
  snapshot() { return this.segs.map(({ key, start, end, id, seed, camStart }) => ({ key, start, end, id, seed, camStart })); }
  // Read-only sequence over such a copy (in the worker): the same lookups, but it never grows or prunes, so the
  // owner first looks up every s the job will read (that grows its own sequence exactly as a local build would).
  static replica(segs) {
    const q = Object.create(BiomeSequence.prototype);
    q.segs = segs; q._extend = () => {};
    return q;
  }
}

// ---------- World shape: path, floor, ceiling ----------
export class WorldShape {
  constructor(seq) {
    this.seq = seq;
    // Optional fast exact samplers over the built terrain meshes (set by Terrain).
    this.gridFloor = null; this.gridCeil = null;
  }
  pathX(s) { return pathXAt(s); }
  // Signed lateral curvature d2x/ds2 (+ = bending toward +x). Tall obstacles placed on the
  // OUTSIDE of a bend (offset opposite the sign) appear dead ahead and the camera curves around them.
  pathCurv(s) { const e = 6; return (this.pathX(s + e) - 2 * this.pathX(s) + this.pathX(s - e)) / (e * e); }
  pathY(s) {
    let y = 0;
    for (const e of this.seq.weights(s)) { y += BIOMES[e.key].camY * e.w; }
    const amp = Math.min(1, -y / 8);
    return y + 1.1 * amp * noise1(s / 70, 7);
  }
  // Analytic floor (before any mesh exists). Prefer floorAt, which samples the rendered mesh.
  floorExact(x, s) {
    const ws = this.seq.weights(s);
    const px = this.pathX(s), py = this.pathY(s), dx = x - px, ad = Math.abs(dx);
    let h = 0;
    for (const e of ws) { const b = BIOMES[e.key]; h += (py - b.clearance + b.floor(x, s, ad, e.g, dx)) * e.w; }
    // guarantee a clear tube around the camera path
    return Math.min(h, py - 2.2 + Math.max(0, ad - 4) * 2.5);
  }
  floorAt(x, s) {
    if (this.gridFloor) { const v = this.gridFloor(x, s); if (v !== undefined) return v; }
    return this.floorExact(x, s);
  }
  // Absolute ceiling height (y). Returns surface+NO_CEIL when open water.
  ceilingExact(x, s) {
    const ws = this.seq.weights(s);
    const px = this.pathX(s), py = this.pathY(s), dx = x - px, ad = Math.abs(dx);
    let c = 0;
    for (const e of ws) {
      const b = BIOMES[e.key];
      c += (b.ceil ? py + b.ceil(x, s, ad, e.g, dx) : NO_CEIL) * e.w;
    }
    return Math.max(c, py + 2.4 - Math.max(0, ad - 4) * 2.5);
  }
  ceilingAt(x, s) {
    if (this.gridCeil) { const v = this.gridCeil(x, s); if (v !== undefined) return v; }
    return this.ceilingExact(x, s);
  }
  // Sunlight transmission from above-water cover (1 = open sky).
  canopyAt(x, s) {
    let t = 0;
    const ws = this.seq.weights(s);
    let any = false;
    for (const e of ws) if (BIOMES[e.key].canopy) { any = true; break; }
    if (!any) return 1;
    const dx = x - this.pathX(s), ad = Math.abs(dx);
    for (const e of ws) { const b = BIOMES[e.key]; t += (b.canopy ? b.canopy(x, s, ad, e.g, dx) : 1) * e.w; }
    return t;
  }
  hasCeiling(s) { // (a loop, not .some(closure): called per creature group several times a frame)
    const ws = this.seq.weights(s);
    for (let i = 0; i < ws.length; i++) if (BIOMES[ws[i].key].ceil) return true;
    return false;
  }
  floorNormal(x, s) {
    const e = 0.75;
    const hx = this.floorAt(x + e, s) - this.floorAt(x - e, s);
    const hz = this.floorAt(x, s + e) - this.floorAt(x, s - e); // +s is -z
    const nx = -hx, ny = 2 * e, nz = hz; // z = -s
    const l = Math.hypot(nx, ny, nz);
    return { x: nx / l, y: ny / l, z: nz / l };
  }
}
export const NO_CEILING = NO_CEIL;
