// Ice Edge: the underside of the pack ice and the floes beyond it, with the open sea 30-40 m deep below.
// Under the ice (only where there is ice overhead: the ceiling mesh below the surface) hang brinicles, fringes of
// icicles along the floe edges, curtains of brown ice-algae strands (Melosira), clusters of platelet ice, and a
// brown film of ice algae stains the underside. Far below, dropstones carry soft corals (sea strawberries),
// sponges and sea stars; brittle stars and sea spiders roam the mud. Every hanging thing is seated in the ice.
import { Builder, Batch, TAU, presence, budgetK, CHUNK, vn3, sat, sstep, lerp, rotY, rotX, rotZ, mul3 } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { seastar } from './shapes.js';
import { encrust, ground } from './nb_shapes.js';
import { softTree } from './nb2_life.js';
import { pathCache, clearBox, SOLID, SOFT, seat, put, upTo, mix3, nrm, segFor, recipe, lowK, slice, nbFloor, builderMesh, NBMAT, lab, setBase } from './nb_common.js';
import { poolOf, itemSpots, seatOnItem } from './nb2_common.js';
import { Space } from './nb3_common.js';
import { rockJob, drain, tiered } from './rock_recipes.js';
import { ceilOf, iced, hangOn, hangR, ceilDecal, rr, pick, chunkRng, L, once, segSeed, q01, grips, gridded, warmTpl } from './nb4_common.js';
import { mulberry32 } from '../noise.js';

const KEY = 'iceedge';
const I = {};
const ICE = [0.72, 0.84, 0.92];

// ---------------------------------------------------------------- under the ice (templates grow from y = 0 up; hung base-up)
// Brinicle: a hollow tube of ice around a finger of sinking super-cold brine, knobbly, sometimes forked.
function brinicle(seed, Lb) {
  const b = new Builder(), rng = mulberry32(seed * 613 + 1), r0 = 0.05 + rng() * 0.07, kink = rng() * 10;
  const prof = (v) => [r0 * Math.pow(1 - v, 1.2) + 0.006 + 0.01 * Math.sin(v * 31 + seed) * (1 - v), v * Lb];
  b.lathe(7, 8, prof, (a, v) => 1 + 0.28 * vn3(Math.cos(a) * 1.5, v * 7 + kink, Math.sin(a) * 1.5, seed), (v, a, x, y, z, o) => { const c = 0.9 + 0.15 * v; o[3] = 0.82 * c; o[4] = 0.92 * c; o[5] = 1.0 * c; o[6] = 1.1 + 0.3 * v; o[7] = 5; });
  for (let i = 0; i < b.vc; i++) { const v = b.P[i * 3 + 1] / Lb; b.P[i * 3] += 0.12 * Lb * v * v * Math.sin(kink); b.P[i * 3 + 2] += 0.1 * Lb * v * v * Math.cos(kink); }
  if (rng() < 0.55) { // a side finger budding off the lower part
    const v0 = b.vc, l2 = Lb * (0.2 + rng() * 0.3), at = 0.3 + rng() * 0.3, a = rng() * TAU;
    b.lathe(5, 4, (v) => [r0 * 0.45 * (1 - v) + 0.005, v * l2], null, (v, an, x, y, z, o) => { o[3] = 0.8; o[4] = 0.92; o[5] = 1; o[6] = 1.3; o[7] = 5; });
    const R = mul3(rotY(a), rotZ(0.5 + rng() * 0.4)), c = [0.12 * Lb * at * at * Math.sin(kink), at * Lb, 0.1 * Lb * at * at * Math.cos(kink)];
    b.xform(v0, R, c[0], c[1], c[2]);
  }
  const t = b.build();
  setBase(t, [r0, 0, 0, -r0, 0, 0, 0, 0, r0, 0, 0, -r0, 0, 0, 0]);
  t.nbLen = Lb;
  return lab(t, 'Brinicle', 'A brinicle is a tube of ice around sinking super-cold brine; where it reaches the seabed it freezes everything it touches.');
}
// Icicle fringe: a ragged row of icicles under a thin lip of ice, along local x (length len)
function icicleFringe(seed, len) {
  const b = new Builder(), rng = mulberry32(seed * 271 + 5), n = Math.round(len / 0.11);
  b.box(len, 0.06, 0.16, null, 0, 0.03, 0, ICE.map((c) => c * 0.95), [1.0, 5]);
  for (let k = 0; k < n; k++) {
    if (rng() < 0.18) continue;
    const x = -len / 2 + (k + 0.3 + rng() * 0.4) * len / n, z = (rng() - 0.5) * 0.1, cl = Math.pow(0.5 + 0.5 * Math.sin(x * 2.3 + seed), 2);
    const Li = 0.06 + (0.12 + 0.55 * cl) * Math.pow(rng(), 1.4), r = 0.008 + Li * 0.05 + rng() * 0.006, v0 = b.vc;
    b.lathe(5, 3, (v) => [r * (1 - v) + 0.002, 0.05 + v * Li], (a, v) => 1 + 0.2 * vn3(Math.cos(a), v * 5, Math.sin(a), seed + k), (v, a, px, py, pz, o) => { o[3] = 0.78; o[4] = 0.9; o[5] = 1.0; o[6] = 1.2; o[7] = 5; });
    for (let i = v0; i < b.vc; i++) { b.P[i * 3] += x; b.P[i * 3 + 2] += z; }
  }
  const t = b.build();
  setBase(t, [-len / 2, 0, -0.08, len / 2, 0, -0.08, -len / 2, 0, 0.08, len / 2, 0, 0.08, 0, 0, 0]);
  t.nbLen = len;
  return lab(t, 'Icicles', 'Sea-ice icicles form where brine drains from the floes and freezes on contact with the colder water.');
}
// Melosira arctica: chains of diatoms hanging from the ice in brown curtains and strands, swaying (MAT.sway)
function algaeStrands(seed, { n = 14, R = 0.3, Lmax = 1.8 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 457 + 11), hue = [0.6 + rng() * 0.12, 0.45 + rng() * 0.1, 0.16 + rng() * 0.06];
  const lean = rng() * TAU, lx = Math.cos(lean), lz = Math.sin(lean), lk = 0.15 + rng() * 0.3; // the current drags the strands one way
  b.blob(1, (x, y, z, o) => { o[0] = x * R; o[1] = Math.max(0, y) * 0.04; o[2] = z * R; o[3] = hue[0] * 0.7; o[4] = hue[1] * 0.7; o[5] = hue[2] * 0.7; o[6] = 0; o[7] = 0; });
  for (let k = 0; k < n; k++) {
    // wispy: lengths spread wide, widths from a thread to a ribbon, each strand its own curl and drift
    const a = rng() * TAU, d = R * 0.85 * Math.sqrt(rng()), cx = Math.cos(a) * d, cz = Math.sin(a) * d, Ls = Lmax * (0.12 + 0.88 * Math.pow(rng(), 1.4));
    const w = rng() < 0.6 ? 0.004 + rng() * 0.006 : 0.01 + rng() * 0.016, face = rng() * TAU, segs = 8, v0 = b.vc, dr = lk * (0.6 + 0.8 * rng());
    const fx = Math.cos(face), fz = Math.sin(face), ph = rng() * 10, c = 0.7 + rng() * 0.5;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, y = 0.01 + t * Ls * (1 - 0.15 * dr * t), wv = 0.12 * Ls * Math.sin(t * 4 + ph) * t + 0.05 * Ls * Math.sin(t * 11 + ph * 2) * t;
      const ww = w * (i === segs ? 0.3 : 1 - 0.4 * t), sw = 0.4 * Ls * Math.pow(t, 1.4) / Lmax, drift = dr * Ls * t * t;
      const x0 = cx + wv * fz + lx * drift, z0 = cz - wv * fx + lz * drift;
      b.v(x0 - fx * ww, y, z0 - fz * ww, fz, 0, -fx, hue[0] * c, hue[1] * c, hue[2] * c, sw, 0);
      b.v(x0 + fx * ww, y, z0 + fz * ww, fz, 0, -fx, hue[0] * c * 1.1, hue[1] * c * 1.1, hue[2] * c, sw, 0);
    }
    for (let i = 0; i < segs; i++) { const q = v0 + i * 2; b.t(q, q + 1, q + 2); b.t(q + 1, q + 3, q + 2); }
  }
  const t = b.build();
  setBase(t, [R * 0.7, 0, 0, -R * 0.7, 0, 0, 0, 0, R * 0.7, 0, 0, -R * 0.7, 0, 0, 0]);
  t.solid = false; t.nbR = R; t.nbLen = Lmax;
  return lab(t, 'Ice algae (Melosira)', 'Strands of diatoms hanging under the Arctic ice can grow metres long; when they sink they feed the seabed below.');
}
// Platelet ice: thin hexagonal ice crystals stacked loosely under the floe
function platelets(seed, { n = 20, R = 0.35, H = 0.3 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 199 + 3);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = R * Math.sqrt(rng()), depth = H * Math.pow(rng(), 1.5) * (1 - 0.6 * d / R);
    const rp = 0.03 + rng() * 0.09, th = 0.004 + rng() * 0.005, c = [Math.cos(a) * d, rp * 0.4 + depth, Math.sin(a) * d];
    const Rr = mul3(rotY(rng() * TAU), mul3(rotX((rng() - 0.5) * 2.6), rotZ((rng() - 0.5) * 2.6))), v0 = b.vc, k2 = 0.85 + 0.25 * rng();
    for (const sy of [1, -1]) {
      const cv = b.v(0, sy * th, 0, 0, sy, 0, ICE[0] * k2, ICE[1] * k2, ICE[2] * k2, 0.9, 5);
      for (let i = 0; i < 6; i++) { const ai = (i / 6) * TAU; b.v(Math.cos(ai) * rp, sy * th, Math.sin(ai) * rp, 0, sy, 0, ICE[0] * k2, ICE[1] * k2, ICE[2] * k2, 1.1, 5); }
      for (let i = 0; i < 6; i++) { if (sy > 0) b.t(cv, cv + 1 + ((i + 1) % 6), cv + 1 + i); else b.t(cv, cv + 1 + i, cv + 1 + ((i + 1) % 6)); }
    }
    b.xform(v0, Rr, c[0], c[1], c[2]);
  }
  // pull the topmost plates up to y = 0: the cluster is frozen to the ice
  ground(b);
  const t = b.build();
  setBase(t, [R * 0.5, 0, 0, -R * 0.5, 0, 0, 0, 0, R * 0.5, 0, 0, -R * 0.5, 0, 0, 0]);
  t.solid = false; t.nbR = R;
  return lab(t, 'Platelet ice', 'Thin ice crystals grow in supercooled water under the floes and pile up into a loose, glittering layer.');
}

// ---------------------------------------------------------------- the seabed
function brittleStar(seed) {
  const b = new Builder(), rng = mulberry32(seed * 811 + 3), dr = 0.012 + rng() * 0.01, Lr = 0.07 + rng() * 0.08, band = rng() < 0.5, base = [];
  const col = [[0.75, 0.55, 0.45], [0.85, 0.42, 0.2], [0.8, 0.78, 0.72], [0.55, 0.38, 0.32]][(rng() * 4) | 0];
  b.blob(1, (x, y, z, o) => { o[0] = x * dr; o[1] = 0.006 + (y > 0 ? y * 0.006 : y * 0.002); o[2] = z * dr; o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + (rng() - 0.5) * 0.3, curl = (rng() - 0.5) * 2.4, pts = [];
    let ang = a;
    for (let i = 0; i <= 6; i++) { const t = i / 6; ang += curl * 0.15; pts.push([Math.cos(ang) * (dr + Lr * t), 0.0025 + 0.004 * Math.sin(t * Math.PI) * (k % 2), Math.sin(ang) * (dr + Lr * t)]); }
    b.tube(pts, pts.map((_, i) => 0.0028 * (1 - i / 8)), 3, (v, an, x, y, z, o, j) => { const c = band && j % 2 ? 0.55 : 1; o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; }, { tip: true });
    base.push(pts[6][0], 0, pts[6][2]);
  }
  base.push(0, 0, 0);
  const t = ground(b).build();
  setBase(t, base); t.solid = false;
  return lab(t, 'Brittle star', 'Brittle stars carpet much of the Arctic shelf; they snap off an arm to escape and grow it back.');
}
// Sea spider (Pycnogonida): a slender body, a long proboscis and eight jointed legs, knees high
function seaSpider(seed) {
  const b = new Builder(), rng = mulberry32(seed * 523 + 9), S = 0.05 + rng() * 0.07, base = [];
  const col = [[0.85, 0.35, 0.12], [0.7, 0.3, 0.18], [0.85, 0.7, 0.5], [0.75, 0.2, 0.15]][(rng() * 4) | 0], paint = (v, a, x, y, z, o) => { o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0; o[7] = 0; };
  const H = S * 0.9, body = [[-S * 0.9, H, 0], [S * 0.9, H, 0]];
  b.tube([[-S * 1.1, H, 0], [-S * 0.4, H + 0.004, 0], [S * 0.4, H + 0.004, 0], [S * 1.1, H - 0.01, 0]], [S * 0.07, S * 0.11, S * 0.11, S * 0.06], 4, paint, { cap: true });
  b.tube([[S * 1.1, H - 0.01, 0], [S * 1.6, H - 0.03, 0]], [S * 0.07, S * 0.04], 4, paint, { tip: true }); // proboscis
  for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) {
    const x0 = lerp(body[0][0], body[1][0], (k + 0.5) / 4) * 0.8, a = sd * (0.25 + 0.35 * k) + (rng() - 0.5) * 0.3;
    const dir = [Math.sin(a) * 0.4 + (k - 1.5) * 0.25, 0, sd * Math.cos(Math.abs(a) * 0.5)], dl = Math.hypot(dir[0], dir[2]), dx = dir[0] / dl, dz = dir[2] / dl;
    const reach = S * (2.2 + rng() * 0.8), knee = [x0 + dx * reach * 0.45, H + S * (0.7 + rng() * 0.4), dz * reach * 0.45], foot = [x0 + dx * reach, 0, dz * reach];
    b.tube([[x0, H, sd * S * 0.08], knee, [x0 + dx * reach * 0.85, S * 0.15, dz * reach * 0.85], foot], [S * 0.045, S * 0.035, S * 0.025, S * 0.015], 3, paint, { tip: true });
    base.push(foot[0], 0, foot[2]);
  }
  const t = ground(b).build();
  setBase(t, base); t.solid = false;
  return lab(t, 'Sea spider', 'Sea spiders are so thin that their gut and organs reach into their legs; they breathe through their skin.');
}
function sponge(seed, k) {
  const t = k % 2 ? encrust(seed, { r: 0.12 + (k % 3) * 0.05, h: 0.06 + (k % 4) * 0.02, lobes: 0.7, detail: 2 }) : (() => {
    const b = new Builder(), rng = mulberry32(seed * 37 + 1), R = 0.06 + rng() * 0.06; // golf-ball sponge (Tetilla)
    b.blob(2, (x, y, z, o) => { const d = 1 + 0.08 * vn3(x * 6 + seed, y * 6, z * 6, seed); o[0] = x * R * d; o[1] = (y + 0.85) * R * d; o[2] = z * R * d; o[3] = o[4] = o[5] = 0.9; o[6] = 0; o[7] = 2; });
    return ground(b).build();
  })();
  t.solid = false;
  return lab(t, k % 2 ? 'Encrusting sponge' : 'Golf-ball sponge', 'Cold-water sponges grow very slowly; some in polar seas are thought to be hundreds of years old.');
}

// ---------------------------------------------------------------- templates, providers, recipe
const IE_ROCKS = [{ r: 'boulder', litho: 'granite', kind: 'erratic', growth: 0.6 }, { r: 'boulder', litho: 'gneiss', kind: 'erratic', growth: 0.6 }, { r: 'boulder', litho: 'diorite', kind: 'angular', growth: 0.6 }, { r: 'boulder', litho: 'pinkGranite', kind: 'erratic', growth: 0.6 }, { r: 'cracked', litho: 'slate', growth: 0.6 }];
export const recipeOf = (g) => recipe(g, 'nb4ie', (g) => {
  const u = (k) => sv(g, 480 + k);
  return {
    brinicles: 0.4 + 1.2 * u(0), fringe: 0.5 + 1.0 * u(1), algae: 0.3 + 1.2 * u(2), platelets: 0.3 + 1.0 * u(3), film: 0.4 + 0.9 * u(4),
    stones: 0.5 + 0.9 * u(5), life: 0.5 + 0.9 * u(6), algaeHue: [[0.9, 0.85, 0.8], [1.05, 0.95, 0.75], [0.85, 0.9, 0.85]][Math.floor(u(7) * 3)],
  };
});
export function initIce(tier) {
  I.brin = [1.2, 2.2, 3.4].map((Lb, i) => brinicle(7100 + i, Lb));
  I.fringe = [1.6, 2.4, 3.2].map((len, i) => icicleFringe(7150 + i, len));
  I.strands = [0, 1, 2].map((i) => algaeStrands(7200 + i, { n: tier === 'low' ? 8 + i * 3 : 12 + i * 5, R: 0.2 + i * 0.12, Lmax: 0.9 + i * 0.8 }));
  I.plate = [0, 1].map((i) => platelets(7250 + i, { n: tier === 'low' ? 12 : 18 + i * 10, R: 0.25 + i * 0.15, H: 0.2 + i * 0.12 }));
  I.stone = [drain(rockJob(tiered(IE_ROCKS[0], tier), 7300)), drain(rockJob(tiered(IE_ROCKS[1], tier), 7301))];
  for (const t of I.stone) warmTpl(t);
  I.soft = [0, 1, 2].map((i) => { const t = softTree(7350 + i, { h: 0.25 + i * 0.1, form: 'cauli' }); return lab(t, 'Sea strawberry (Gersemia)', 'Arctic sea strawberries are soft corals: they swell with water to feed and shrink when the current dies.'); });
  I.sponge = [0, 1, 2, 3].map((i) => sponge(7400 + i, i));
  I.star = [0, 1, 2].map((i) => lab(seastar(7450 + i, { arms: i === 2 ? 6 : 5, fat: 1.6 + i * 0.3, curl: 0.05, thin: 1.1 }), 'Sea star', 'Polar sea stars grow and move slowly in the cold, and can live for decades.'));
  I.brittle = [0, 1, 2, 3, 4].map((i) => brittleStar(7500 + i));
  I.spider = [0, 1, 2].map((i) => seaSpider(7550 + i));
  return I;
}
export function iceProviders(provide) {
  provide(KEY, 'nb4ieBrin', 5, (seg, k) => once(() => brinicle(segSeed(seg, k, 0x2545f491), 0.8 + k * 0.7 + q01(seg.seed, k) * 0.6))(), 3);
  provide(KEY, 'nb4ieFringe', 4, (seg, k) => once(() => icicleFringe(segSeed(seg, k, 0x6c078965), 1.4 + k * 0.6))(), 3);
  provide(KEY, 'nb4ieStrands', 5, (seg, k, tier) => once(() => algaeStrands(segSeed(seg, k, 0x7feb352d), { n: tier === 'low' ? 8 + k * 2 : 12 + k * 4, R: 0.18 + k * 0.08, Lmax: 0.7 + k * 0.5 }))(), 3);
  provide(KEY, 'nb4iePlate', 3, (seg, k, tier) => once(() => platelets(segSeed(seg, k, 0x165667b1), { n: tier === 'low' ? 12 : 16 + k * 8, R: 0.22 + k * 0.12, H: 0.18 + k * 0.1 }))(), 3);
  provide(KEY, 'nb4ieStone', 6, (seg, k, tier) => gridded(rockJob(tiered(IE_ROCKS[(k + (seg.seed >>> 4)) % IE_ROCKS.length], tier), segSeed(seg, k, 0x27d4eb2f))), 2);
  provide(KEY, 'nb4ieSpider', 3, (seg, k) => once(() => seaSpider(segSeed(seg, k, 0x61c88647)))(), 3);
}

// ---------------------------------------------------------------- chain A: under the ice
// edge of the ice at (x, s): the direction (unit, in x/s) toward open water within 1.6 m, or null
function edgeDir(cs, ctx, x, s) {
  let dx = 0, ds = 0, n = 0;
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, c = Math.cos(a), sn = Math.sin(a); if (!iced(cs, ctx, x + c * 1.6, s + sn * 1.6, 0.1)) { dx += c; ds += sn; n++; } }
  if (!n || n > 5) return null;
  const l = Math.hypot(dx, ds);
  return l > 1e-3 ? [dx / l, ds / l] : null;
}
export function* layoutIeA(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const cs = ceilOf(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rc0 = recipeOf(g0), rng = chunkRng(ctx, 0x1ce1), surf = ctx.surfaceY;
  // is there ice in this chunk at all (near the route)?
  let anyIce = false;
  for (let k = 0; k < 40 && !anyIce; k++) { const s = ctx.s0 + rng() * CHUNK; anyIce = iced(cs, ctx, pc.x(s) + (rng() - 0.5) * 80, s); }
  if (!anyIce) return null;
  const ice = new Batch(MAT.static, 30000 * bk), sw = new Batch(MAT.sway, 30000 * bk * lk); sw.soft = true; sw.lod = 'mid'; sw.jobVerts = 12000;
  const pl = new Batch(MAT.static, 16000 * bk * lk); pl.lod = 'mid';
  const labels = [], pois = [], sp = new Space();
  const lateral = (a, b, k = 1.2) => (rng() < 0.5 ? -1 : 1) * (a + Math.pow(rng(), k) * (b - a));
  // hang tpl (lateral scale sc, length scale sy) at (x, s): seated in the ice, clear of the flight tube
  const hang = (b, tpl, x, s, yaw, sc, sy, col, fa, kind, r) => {
    const R = hangR(yaw), y = hangOn(ctx, cs, tpl, R, sc, x, s, 0.03);
    if (!(y === y)) return null;
    if (!clearBox(pc, x, s, y - (tpl.maxY - tpl.minY) * sy, y, r, kind)) return null;
    return put(ctx, b, tpl, x, y, s, R, sc, sy, sc, col, fa, 'ceil') ? y : null;
  };
  // icicle fringes along the floe edges, just inside the edge
  const nF = Math.round(14 * rc0.fringe * bk * lk);
  for (let k = 0, n = 0; k < nF * 6 && n < nF; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const x = pc.x(s) + lateral(0, 40, 1.1);
    if (!iced(cs, ctx, x, s)) continue;
    const e = edgeDir(cs, ctx, x, s);
    if (!e) continue;
    const ix = x - e[0] * (0.35 + rng() * 0.3), is = s - e[1] * (0.35 + rng() * 0.3), tpl = pick(rng, poolOf(g, 'nb4ieFringe', I.fringe, 2)), yaw = Math.atan2(e[0], e[1]); // local x along the edge
    if (!sp.free(ix, is, tpl.nbLen * 0.4)) continue;
    if (hang(ice, tpl, ix, is, yaw, 1, 0.8 + rng() * 0.6, [1, 1, 1], 1, SOLID, tpl.nbLen * 0.5) !== null) { sp.add(ix, is, tpl.nbLen * 0.4); n++; }
  }
  yield;
  // brown ice-algae film on the underside, with strands of Melosira hanging from it and platelet clusters
  const film = new Builder(), patches = [];
  for (let k = 0; k < 18 * rc0.film * bk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + lateral(0, 34, 1), r = 1.2 + rng() * 3;
    if (!iced(cs, ctx, x, s, 0.4)) continue;
    const col = [0.62 * rc0.algaeHue[0], 0.5 * rc0.algaeHue[1], 0.24 * rc0.algaeHue[2]]; // dirty golden-brown ice, lit through the floe
    if (ceilDecal(film, cs, ctx, x, s, r, r * (0.5 + rng() * 0.5), rng() * TAU, col, 0, 0.3 + rng() * 0.3)) patches.push([x, s, r]);
  }
  const nS = Math.round(30 * rc0.algae * bk * lk);
  for (let k = 0, n = 0; k < nS * 4 && n < nS; k++) {
    if (Y.over()) { yield; Y.reset(); }
    let x, s;
    if (patches.length && rng() < 0.7) { const p = pick(rng, patches), a = rng() * TAU, d = Math.sqrt(rng()) * p[2]; x = p[0] + Math.cos(a) * d; s = p[1] + Math.sin(a) * d; }
    else { s = ctx.s0 + rng() * CHUNK; x = pc.x(s) + lateral(0, 34, 1); }
    const g = segFor(ctx, s, KEY);
    if (!g || !iced(cs, ctx, x, s, 0.4)) continue;
    const tpl = pick(rng, poolOf(g, 'nb4ieStrands', I.strands, 2)), sc = 0.8 + rng() * 0.5, sy = 0.7 + rng() * 0.7;
    if (!sp.free(x, s, tpl.nbR * sc)) continue;
    if (hang(sw, tpl, x, s, rng() * TAU, sc, sy, rc0.algaeHue, sy, SOFT, tpl.nbR * sc + 0.2) !== null) { sp.add(x, s, tpl.nbR * sc); n++; }
  }
  const nP = Math.round(16 * rc0.platelets * bk * lk);
  for (let k = 0, n = 0; k < nP * 4 && n < nP; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY), x = pc.x(s) + lateral(0, 30, 1);
    if (!g || !iced(cs, ctx, x, s, 0.5)) continue;
    const keel = cs.at(x, s) < surf - 1.6; // more where the ice is thick (keels)
    if (!keel && rng() < 0.6) continue;
    const tpl = pick(rng, poolOf(g, 'nb4iePlate', I.plate, 2)), sc = 0.8 + rng() * 0.7;
    if (!sp.free(x, s, tpl.nbR * sc)) continue;
    if (hang(pl, tpl, x, s, rng() * TAU, sc, sc, [1, 1, 1], 1, SOFT, tpl.nbR * sc) !== null) { sp.add(x, s, tpl.nbR * sc); n++; }
  }
  yield;
  // brinicles: a few, where the camera will see them
  const nB = Math.round((1 + rng() * 4) * rc0.brinicles * bk);
  for (let k = 0, n = 0; k < nB * 6 && n < nB; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY), x = pc.x(s) + lateral(3, 26, 1.3);
    if (!g || !iced(cs, ctx, x, s, 0.4)) continue;
    const tpl = pick(rng, poolOf(g, 'nb4ieBrin', I.brin, 2)), sc = 0.8 + rng() * 0.5, sy = 0.8 + rng() * 0.5;
    if (!sp.free(x, s, 0.5)) continue;
    const y = hang(ice, tpl, x, s, rng() * TAU, sc, sy, [1, 1, 1], 1, SOLID, 0.3);
    if (y === null) continue;
    sp.add(x, s, 0.5); n++;
    if (pois.length < 2 && Math.abs(x - pc.x(s)) < 14) pois.push({ type: 'brinicle', x, y: y - tpl.nbLen * sy * 0.6, s, r: 2, data: { name: 'Brinicle' } });
  }
  const extra = [];
  const fm = film.vc ? builderMesh(film, NBMAT.decal, null, 'mid') : null;
  if (fm) { fm.renderOrder = 1; extra.push(fm); }
  return { batches: [ice, sw, pl], extra, labels, pois };
}

// ---------------------------------------------------------------- chain B: the seabed far below
export function* layoutIeB(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rc0 = recipeOf(g0), rng = chunkRng(ctx, 0x1ce2);
  const st = new Batch(MAT.static, 30000 * bk); st.lod = 'mid';
  const soft = new Batch(NBMAT.soft, 10000 * bk * lk); soft.lod = 'mid'; soft.soft = true;
  const sm = new Batch(MAT.static, 14000 * bk * lk); sm.lod = 'near';
  const sp = new Space(), stones = [];
  const lateral = (a, b, k = 1.2) => (rng() < 0.5 ? -1 : 1) * (a + Math.pow(rng(), k) * (b - a));
  // dropstones: boulders rafted out by icebergs and dropped into the mud
  const nS = Math.round((5 + rng() * 6) * rc0.stones * bk);
  for (let k = 0; k < nS * 3 && stones.length < nS; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const x = pc.x(s) + lateral(0, 34, 1), tpl = pick(rng, poolOf(g, 'nb4ieStone', I.stone, 2)), sc = 0.3 + Math.pow(rng(), 1.6) * 1.2, sy = sc * (0.7 + rng() * 0.5);
    if (!sp.free(x, s, tpl.r * sc)) continue;
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.5), rng() * TAU), P = [x, fs.at(x, s), s];
    seat(fs, tpl, R, sc, sy, sc, P, null, 0.06 + (tpl.maxY - tpl.minY) * sy * 0.15); // dropped: half-sunk in the soft mud
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) continue;
    if (!put(ctx, st, tpl, P[0], P[1], P[2], R, sc, sy, sc, [0.95, 0.95, 0.97], 1)) continue;
    stones.push(st.last); sp.add(P[0], P[2], tpl.r * sc * 0.85);
  }
  yield;
  // life on the stones: sea strawberries, sponges, stars
  const PINK = [[1.0, 0.45, 0.5], [0.95, 0.3, 0.32], [1.0, 0.6, 0.6]], SPONGE = [[0.95, 0.92, 0.82], [0.95, 0.85, 0.45], [0.9, 0.7, 0.5]], STAR = [[0.9, 0.3, 0.12], [0.85, 0.2, 0.2], [0.9, 0.55, 0.2]];
  for (const it of stones) {
    if (Y.over()) { yield; Y.reset(); }
    const spots = itemSpots(it, ctx, 24, 0.5);
    for (let i = spots.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0, t = spots[i]; spots[i] = spots[j]; spots[j] = t; }
    for (let q = 0, n = 0; q < spots.length && n < Math.round((1 + rng() * 4) * rc0.life * lk); q++) {
      const p = spots[q], u = rng(), R = upTo(mix3([0, 1, 0], p.n, 0.7), rng() * TAU), Pp = [p.x, p.y, p.s];
      const e = u < 0.45 ? { t: I.soft, b: soft, sc: [0.7, 1.3], col: PINK } : u < 0.8 ? { t: I.sponge, b: sm, sc: [0.7, 1.4], col: SPONGE } : { t: I.star, b: sm, sc: [0.1, 0.16], col: STAR };
      const tpl = pick(rng, e.t), sc = rr(rng, e.sc[0], e.sc[1]);
      if (!seatOnItem(it, ctx.s0, tpl, R, sc, Pp, 0.015) || !grips(it, ctx.s0, tpl, R, sc, sc, sc, Pp)) continue;
      if (put(ctx, e.b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, pick(rng, e.col), e.b === soft ? 0.3 : 1, { item: it })) n++;
    }
  }
  // brittle stars, sea spiders and stars on the mud
  const nM = Math.round(70 * rc0.life * bk * lk);
  for (let k = 0; k < nM * 2 && k < 260; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g || rng() > ctx.weightOf(s, KEY)) continue;
    const x = pc.x(s) + lateral(0, 26, 1.2), u = rng();
    const e = u < 0.6 ? { t: I.brittle, sc: [0.8, 1.6], fol: 1 } : u < 0.85 ? { t: poolOf(g, 'nb4ieSpider', I.spider, 2), sc: [0.8, 1.5], fol: 0.6 } : { t: I.star, sc: [0.1, 0.17], fol: 1 };
    const tpl = pick(rng, e.t), sc = rr(rng, e.sc[0], e.sc[1]), r = tpl.r * sc;
    if (!sp.free(x, s, r, 0.02)) continue;
    const y = fs.at(x, s), n = [fs.nx * e.fol, 1 - e.fol + fs.ny * e.fol, fs.nz * e.fol], R = upTo(nrm(n), rng() * TAU), Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.008);
    if (put(ctx, sm, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, e.t === I.star ? pick(rng, STAR) : [0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 0.9 + rng() * 0.2], 1)) sp.add(x, s, r);
  }
  return { batches: [st, soft, sm] };
}
