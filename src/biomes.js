// Biome catalogue + endless seeded sequence along the travel distance `s` (metres).
// Each biome defines water optics, camera depth and a terrain shape relative to the path.
import { mulberry32, noise1, noise2, fbm2, ridge2, smoothstep, hash1, hash2i } from './noise.js';

const C = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// Per-segment random value in [0,1): every biome segment varies its own shape and character.
export const sv = (g, k) => (g ? hash1((g.seed ^ Math.imul(k + 1, 0x9e3779b1)) | 0) : 0.5);

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
    label: 'Kelp Forest', camY: -11, clearance: 6, len: [650, 1000], weight: 1.0,
    sigma: [0.16, 0.06, 0.07], lightSigma: [0.07, 0.028, 0.035],
    deep: C(0x0f4c43), up: C(0x5fb39f), sun: 1.0, caustic: 0.75, shafts: 1.35, ambient: 0.95, glow: 0, snow: 1.0,
    sand: [0.5, 0.47, 0.38], rock: [0.3, 0.29, 0.26],
    floor(x, s, ad, g) {
      return fbm2(x / 14, s / 14, 5, 21) * 2.6 + ridge2(x / 30, s / 30, 3, 22) * 3.5 * (0.5 + sv(g, 1))
        + smoothstep(30, 85, ad) * 7 * (0.5 + sv(g, 2));
    },
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
    sigma: [0.15, 0.075, 0.12], lightSigma: [0.06, 0.03, 0.05],
    deep: C(0x2b4a35), up: C(0xa8c38e), sun: 1.1, caustic: 1.2, shafts: 0.9, ambient: 1.0, glow: 0, snow: 1.2,
    sand: [0.5, 0.43, 0.32], rock: [0.32, 0.27, 0.22],
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
      const o = noise2(x / 34, s / 34, 56), th = 0.26 + 0.14 * sv(g, 2);
      if (o > th) c += (o - th) * 260; // cenote openings to the sky
      return c;
    },
  },
  wreck: {
    label: 'Sunken Wrecks', camY: -20, clearance: 5.5, len: [650, 1000], weight: 1.0,
    sigma: [0.12, 0.042, 0.038], lightSigma: [0.055, 0.02, 0.018],
    deep: C(0x0a3e50), up: C(0x3e93a6), sun: 0.85, caustic: 0.5, shafts: 1.0, ambient: 0.9, glow: 0, snow: 1.3,
    sand: [0.56, 0.54, 0.48], rock: [0.36, 0.35, 0.33],
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
      c -= ridge2(x / 24, s / 24, 3, 113) ** 3 * 9 * (0.5 + sv(g, 1)) * smoothstep(5, 16, ad); // pressure-ridge keels
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
      const pk = peaks(x, s, 70, 172 + ((g ? g.seed : 0) & 15), 18, 34, 0.6);
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
// Seabed tints (applied after the sRGB->linear conversion of sand/rock; values are linear offsets).
BIOMES.tidepool.floorTint = (x, s, nn, T) => { const p = smoothstep(0.1, 0.5, nn); T[3] += 0.25 * p; T[4] += 0.05 * p; T[5] += 0.12 * p; };
BIOMES.vents.floorTint = (x, s, nn, T) => {
  const p = smoothstep(0.35, 0.7, fbm2(x / 11, s / 11, 2, 9));
  T[3] += 0.35 * p; T[4] += 0.18 * p; T[5] += 0.02 * p; T[0] += 0.2 * p; T[1] += 0.1 * p;
};
const greenish = (x, s, nn, T) => { const p = smoothstep(0.2, 0.6, nn); T[3] -= 0.06 * p; T[4] += 0.04 * p; };
BIOMES.kelp.floorTint = BIOMES.reef.floorTint = BIOMES.softcoral.floorTint = BIOMES.anemone.floorTint = greenish;
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

// ---------- Endless sequence ----------
const TH = 90; // half-width of the cross-fade between biomes (m)

export class BiomeSequence {
  constructor(seed, startKey = 'reef', startS = 0) {
    this.startS = startS;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.seed = seed;
    this.segs = [];
    this.recent = [];
    this._push(BIOMES[startKey] ? startKey : 'reef');
  }
  _push(key) {
    const start = this.segs.length ? this.segs[this.segs.length - 1].end : this.startS - 200;
    const b = BIOMES[key];
    const len = this.rng.range(b.len[0], b.len[1]);
    this.segs.push({ key, start, end: start + len, id: this.segs.length, seed: (this.rng() * 1e9) | 0 });
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
  segAt(s) {
    this._extend(s);
    const a = this.segs;
    for (let i = a.length - 1; i >= 0; i--) if (s >= a[i].start) return i;
    return 0;
  }
  // Returns [{key, w, g}] (1-2 entries) summing to 1; g is the segment record.
  weights(s) {
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
    this._extend(s1);
    return this.segs.filter((g) => g.end > s0 && g.start < s1);
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
    const ad = Math.abs(x - this.pathX(s));
    for (const e of ws) { const b = BIOMES[e.key]; t += (b.canopy ? b.canopy(x, s, ad, e.g) : 1) * e.w; }
    return t;
  }
  hasCeiling(s) { return this.seq.weights(s).some((e) => BIOMES[e.key].ceil); }
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
