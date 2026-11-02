// Mangrove roots: red-mangrove trees standing on dense arching prop roots that plunge from above the
// surface into the mud, forming the channel the camera follows. Roots carry oysters, sponges, sea
// squirts, anemones and algae; the mud holds pencil roots, leaf litter, twigs, fallen branches,
// turtle grass, sunlit sand patches with upside-down jellyfish, and leaves float overhead.
//
// Each prop root is its own template instance: its yaw, reach and vertical stretch are solved per
// placement so that every root tip enters the exact floor mesh.
import { Builder, Batch, TAU, vn3, sat, sstep, lerp, rotY, presence, budgetK, CHUNK } from './core.js';
import { MAT } from './materials.js';
import { grassPatch, anemone } from './shapes.js';
import { mulberry32, noise2, smoothstep } from '../noise.js';
import { sv } from '../biomes.js';
import {
  NBMAT, pathCache, clearBox, clearSpine, SOLID, SOFT, seat, put, xf, xfn, upTo, nrm, setBase, lab, basePts,
  decalDisc, builderMesh, segFor, recipe, lowK, slice, runLayout,
  nbFloor,
} from './nb_common.js';
import { encrust, oysterCluster, tunicates, fuzzTuft, bez, ground } from './nb_shapes.js';

const M = {};
export const DROPS = [2.2, 3.0, 3.9, 4.9];
const EXT = 0.45; // root length continuing straight down below its nominal mud point

// root sponges: orange, red, purple (no yellow: in the green water it turned into lime 'corn cobs')
const SPONGE = [[0.95, 0.28, 0.03], [0.7, 0.05, 0.04], [0.32, 0.06, 0.42], [0.55, 0.08, 0.5], [0.9, 0.16, 0.06]];

// ---------------------------------------------------------------- templates
// One prop root, like an arm of an upside-down candelabra: it leaves the trunk above the waterline at a
// shallow angle, arches out and down in a smooth curve, forks into 2-3 at mid-height, and splays into
// the mud with small kinks. Thick at the trunk, thinning after each fork.
export function rootTpl(seed, drop, far) {
  const b = new Builder(), rng = mulberry32(seed);
  const radial = far ? 4 : 5, segs = far ? 8 : 12;
  const age = 0.55 + rng() * 0.9, spread = drop * (0.75 + rng() * 0.65);
  // thick and only gently tapering (a prop root is still 8-12 cm across where it enters the water)
  const r0 = 0.085 + 0.05 * age, r1 = r0 * (0.68 + rng() * 0.12), zw = (rng() - 0.5) * 0.45 * spread;
  const P0 = [0, 0, 0], P1 = [spread * (0.38 + rng() * 0.22), -drop * (0.04 + rng() * 0.2), zw * 0.25];
  const P2 = [spread * (0.82 + rng() * 0.15), -drop * (0.3 + rng() * 0.3), zw * 0.8], P3 = [spread, -drop, zw];
  const paint = (v, a, x, y, z, o) => {
    const ty = sat(-y / drop), wet = sstep(0.18, 0.5, ty), n = 0.82 + 0.36 * vn3(x * 3, y * 3, z * 3, seed + 3);
    const mud = 1 - 0.45 * sstep(0.9, 1.02, ty);
    o[3] = lerp(0.23, 0.1, wet) * n * mud; o[4] = lerp(0.15, 0.1, wet) * n * mud; o[5] = lerp(0.1, 0.05, wet) * n * mud;
    o[6] = 0.8 * wet; o[7] = 0;
  };
  const fork = Math.round((0.38 + rng() * 0.2) * segs), nFork = far ? 1 + (rng() < 0.4 ? 1 : 0) : 1 + (rng() < 0.7 ? 1 : 0);
  const kink = (t, k) => 0.035 * spread * sstep(0.65, 1, t) * vn3(t * 5 + k, k, 0, seed + 5);
  const main = [], rad = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = bez(P0, P1, P2, P3, t), w = 0.05 * spread * Math.sin(t * Math.PI);
    p[0] += w * vn3(t * 2.5, 0, 0, seed) + kink(t, 1); p[1] += w * 0.4 * vn3(t * 2.5, 3, 0, seed); p[2] += w * vn3(t * 2.5, 1, 0, seed) + kink(t, 2);
    main.push(p); rad.push(lerp(r0, r1, Math.pow(t, 0.7)) * (i > fork && nFork ? 0.82 : 1) * (1 + 0.12 * vn3(t * 7, 2, 0, seed)));
  }
  const E0 = main[segs];
  main.push([E0[0] + 0.05, -drop - EXT * 0.5, E0[2]], [E0[0] + 0.08, -drop - EXT, E0[2]]); rad.push(rad[segs] * 0.95, rad[segs] * 0.9);
  b.tube(main, rad, radial, paint, { tip: true });
  const spine = [], tips = [main[segs + 2]], obs = [];
  for (let i = 0; i <= segs; i += 2) spine.push(main[i][0], main[i][1], main[i][2], rad[i]);
  const c3 = Math.round(segs / 3), c6 = Math.round(2 * segs / 3);
  for (const [i, j] of [[0, c3], [c3, c6], [c6, segs + 2]]) obs.push([...main[i], ...main[j], (rad[i] + rad[j]) / 2 + 0.03]);
  // daughter roots forking at mid-height, each arching out to its own anchor in the mud
  const Q = main[fork], T0 = nrm([main[fork + 1][0] - main[fork - 1][0], 0, main[fork + 1][2] - main[fork - 1][2]]);
  for (let f = 0; f < nFork; f++) {
    const yaw = (f === 0 ? 1 : -1) * (rng() < 0.5 ? 1 : -1) * (0.4 + rng() * 0.5), c = Math.cos(yaw), sn = Math.sin(yaw);
    const dir = [T0[0] * c - T0[2] * sn, 0, T0[0] * sn + T0[2] * c];
    const reach = (spread - Q[0]) * (0.7 + rng() * 0.7) + 0.4, E = [Q[0] + dir[0] * reach, -drop, Q[2] + dir[2] * reach];
    const C1 = [Q[0] + dir[0] * reach * 0.55, Q[1] - (Q[1] + drop) * 0.08, Q[2] + dir[2] * reach * 0.55];
    const C2 = [E[0] - dir[0] * reach * 0.08, Q[1] - (Q[1] + drop) * 0.55, E[2] - dir[2] * reach * 0.08];
    const n = far ? 5 : 8, pts = [], rr = [];
    for (let i = 0; i <= n; i++) { const t = i / n, p = bez(Q, C1, C2, E, t); p[0] += kink(t, 3 + f); p[2] += kink(t, 5 + f); pts.push(p); rr.push(lerp(rad[fork] * 0.8, r1 * 0.82, Math.pow(t, 0.7))); }
    const En = pts[n];
    pts.push([En[0] + dir[0] * 0.05, -drop - EXT * 0.5, En[2] + dir[2] * 0.05], [En[0] + dir[0] * 0.08, -drop - EXT, En[2] + dir[2] * 0.08]); rr.push(rr[n] * 0.95, rr[n] * 0.9);
    b.tube(pts, rr, far ? 4 : radial, paint, { tip: true });
    for (let i = 0; i <= n; i += 2) spine.push(pts[i][0], pts[i][1], pts[i][2], rr[i]);
    tips.push(pts[n + 2]);
    obs.push([...Q, ...pts[n + 2], rr[0] + 0.03]);
    // a smaller sub-arch springing from the daughter root and dropping to its own anchor
    if (!far && rng() < 0.65) {
      const j = Math.round(n * (0.35 + rng() * 0.25)), S0 = pts[j], ya = (rng() < 0.5 ? 1 : -1) * (0.5 + rng() * 0.6), c2 = Math.cos(ya), s2 = Math.sin(ya);
      const d2 = [dir[0] * c2 - dir[2] * s2, 0, dir[0] * s2 + dir[2] * c2], reach2 = 0.35 + rng() * 0.6, E2 = [S0[0] + d2[0] * reach2, -drop, S0[2] + d2[2] * reach2];
      const D1 = [S0[0] + d2[0] * reach2 * 0.6, S0[1] - (S0[1] + drop) * 0.05, S0[2] + d2[2] * reach2 * 0.6], D2 = [E2[0] - d2[0] * reach2 * 0.05, S0[1] - (S0[1] + drop) * 0.6, E2[2] - d2[2] * reach2 * 0.05];
      const q = [], qr = [];
      for (let i = 0; i <= 5; i++) { const t = i / 5; q.push(bez(S0, D1, D2, E2, t)); qr.push(lerp(rr[j] * 0.7, r1 * 0.62, Math.pow(t, 0.7))); }
      const Eq = q[5];
      q.push([Eq[0] + d2[0] * 0.04, -drop - EXT * 0.5, Eq[2] + d2[2] * 0.04], [Eq[0] + d2[0] * 0.06, -drop - EXT, Eq[2] + d2[2] * 0.06]); qr.push(qr[5] * 0.95, qr[5] * 0.9);
      b.tube(q, qr, 4, paint, { tip: true });
      for (let i = 0; i <= 5; i += 2) spine.push(q[i][0], q[i][1], q[i][2], qr[i]);
      tips.push(q[7]);
      obs.push([...S0, ...q[7], qr[0] + 0.03]);
    }
  }
  // baked collar sponge hugging the submerged part of some roots
  if (!far && rng() < 0.6) {
    const i0 = Math.round((0.6 + rng() * 0.2) * segs), col = SPONGE[(rng() * SPONGE.length) | 0];
    const pts = main.slice(i0, i0 + 3), rr = pts.map((p, k) => rad[i0 + k] * (k === 1 ? 1.45 + rng() * 0.35 : 0.96));
    b.tube(pts, rr, 7, (v, a, x, y, z, o) => {
      const n = 0.8 + 0.4 * vn3(x * 9, y * 9, z * 9, seed + 7); o[3] = col[0] * n; o[4] = col[1] * n; o[5] = col[2] * n; o[6] = 0; o[7] = 2;
    });
  }
  const t = b.build();
  t.obs = obs; t.nbSpine = spine; t.nbTips = tips; t.nbDrop = drop;
  t.nbMain = main.slice(0, segs + 1).flatMap((p, i) => [p[0], p[1], p[2], rad[i] * Math.cos(Math.PI / radial)]);
  // attachment rings along the main root (for oysters, sponges, sea squirts...)
  t.nbRings = [];
  for (let j = 1; j < segs; j++) {
    const p = main[j], q = main[j + 1], o = main[j - 1];
    const T = nrm([q[0] - o[0], q[1] - o[1], q[2] - o[2]]);
    const A = nrm(Math.abs(T[1]) < 0.9 ? [T[2], 0, -T[0]] : [0, -T[2], T[1]]);
    const B = [T[1] * A[2] - T[2] * A[1], T[2] * A[0] - T[0] * A[2], T[0] * A[1] - T[1] * A[0]];
    t.nbRings.push({ c: p, A, B, r: rad[j] * Math.cos(Math.PI / radial) });
  }
  t.label = null; t.solid = true;
  return t;
}

export function trunkTpl(seed) {
  const b = new Builder(), rng = mulberry32(seed), H = 3.4, R = 0.14 + rng() * 0.1, lx = (rng() - 0.5) * 0.4, lz = (rng() - 0.5) * 0.4;
  b.lathe(9, 9, (v) => [v < 0.07 ? R * 0.95 * Math.sqrt(v / 0.07) + 0.012 : R * (1 + 0.3 * (1 - v)), v * H],
    (a, v) => 1 + 0.08 * vn3(Math.cos(a) * 2, v * 6, Math.sin(a) * 2, seed),
    (v, a, x, y, z, o) => { const n = 0.85 + 0.3 * vn3(x * 4, y * 2, z * 4, seed); const wet = sstep(0.3, 0.05, v); o[3] = lerp(0.22, 0.11, wet) * n; o[4] = lerp(0.15, 0.1, wet) * n; o[5] = lerp(0.1, 0.05, wet) * n; o[6] = 0.6 * wet; });
  for (let i = 0; i < b.vc; i++) { const v = b.P[i * 3 + 1] / H; b.P[i * 3] += lx * v * v * H * 0.3; b.P[i * 3 + 2] += lz * v * v * H * 0.3; }
  const t = b.build(); t.nbR = R; t.label = null;
  return t;
}

function dropRootTpl(seed) {
  const b = new Builder(), rng = mulberry32(seed), L = 3.6, r = 0.012 + rng() * 0.01, pts = [], rr = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([0.08 * vn3(t * 3, 0, 0, seed) + t * (rng() - 0.5) * 0.15, -t * L, 0.08 * vn3(t * 3, 1, 0, seed)]); rr.push(r * (1 - 0.25 * t)); }
  b.tube(pts, rr, 4, (v, a, x, y, z, o) => { const wet = sstep(0.1, 0.4, v); o[3] = lerp(0.24, 0.1, wet); o[4] = lerp(0.16, 0.1, wet); o[5] = lerp(0.11, 0.05, wet); o[6] = 0.7 * wet; }, { tip: true });
  const t = b.build(); t.nbTips = [pts[6]]; t.label = null;
  return t;
}

function pneuPatch(seed, n, R) {
  const b = new Builder(), rng = mulberry32(seed), base = [];
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, rr = R * Math.pow(rng(), 0.7), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = (0.08 + Math.pow(rng(), 1.6) * 0.26) * (1 - 0.4 * rr / R), r = 0.007 + rng() * 0.006, lx = (rng() - 0.5) * 0.06, lz = (rng() - 0.5) * 0.06;
    b.tube([[x, -0.1, z], [x + lx * 0.5, h * 0.5, z + lz * 0.5], [x + lx, h, z + lz]], [r * 1.25, r, r * 0.7], 3, (v, an, px, py, pz, o) => {
      const m = sstep(0.03, -0.02, py), alg = sstep(0.08, 0.0, py) * 0.6;
      o[3] = lerp(0.26, 0.09, m) * (1 - alg * 0.3); o[4] = lerp(0.2, 0.08, m) * (1 + alg * 0.2); o[5] = lerp(0.14, 0.05, m) * (1 - alg * 0.5); o[6] = alg;
    }, { tip: true });
    base.push(x, -0.1, z);
  }
  const t = b.build();
  setBase(t, base);
  return t;
}

const LEAF = [[0.55, 0.42, 0.06], [0.42, 0.2, 0.05], [0.16, 0.09, 0.03], [0.3, 0.32, 0.07], [0.6, 0.3, 0.05]];
export function leafPatch(seed, n, R, floating = false) {
  const b = new Builder(), rng = mulberry32(seed), base = [];
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, rr = R * Math.sqrt(rng()), cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const L = 0.06 + rng() * 0.06, W = L * (0.38 + rng() * 0.12), yaw = rng() * TAU, c = Math.cos(yaw), s = Math.sin(yaw);
    const y0 = floating ? 0 : 0.002 + rng() * 0.012, curl = (rng() - 0.3) * 0.5, col = LEAF[(rng() * LEAF.length) | 0], under = rng() < 0.3 ? 1.25 : 1;
    b.grid(3, 2, (u, v, i, j, o) => {
      const lu = (u - 0.5) * L, wv = (v - 0.5) * W * 2 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) * 0.5 + 0.0005;
      const y = y0 + curl * (v - 0.5) ** 2 * W + 0.15 * Math.abs(v - 0.5) * W;
      o[0] = cx + c * lu - s * wv; o[1] = y; o[2] = cz + s * lu + c * wv;
      const mid = 1 - 0.25 * (1 - Math.abs(v - 0.5) * 2) * 0.4;
      o[3] = col[0] * under * mid; o[4] = col[1] * under * mid; o[5] = col[2] * under * mid; o[6] = 0; o[7] = 0;
    });
    base.push(cx, y0, cz);
  }
  const t = b.build();
  setBase(t, base);
  return t;
}

function twigPatch(seed) {
  const b = new Builder(), rng = mulberry32(seed), base = [], n = 3 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, cx = (rng() - 0.5) * 0.5, cz = (rng() - 0.5) * 0.5, L = 0.2 + rng() * 0.45, r = 0.006 + rng() * 0.008;
    const pts = [];
    for (let i = 0; i <= 3; i++) { const t = i / 3 - 0.5; pts.push([cx + Math.cos(a) * t * L + (rng() - 0.5) * 0.03, r + (i === 1 || i === 2 ? rng() * 0.01 : 0), cz + Math.sin(a) * t * L + (rng() - 0.5) * 0.03]); }
    b.tube(pts, pts.map(() => r), 3, (v, an, x, y, z, o) => { o[3] = 0.16; o[4] = 0.11; o[5] = 0.07; o[6] = 0.3; }, { cap: true });
    base.push(pts[0][0], 0, pts[0][2], pts[3][0], 0, pts[3][2]);
  }
  const t = b.build();
  setBase(t, base);
  return t;
}

function fallenBranch(seed) {
  const b = new Builder(), rng = mulberry32(seed), L = 1.4 + rng() * 1.8, r = 0.035 + rng() * 0.05, base = [];
  const pts = [], rr = [];
  for (let i = 0; i <= 7; i++) { const t = i / 7; pts.push([(t - 0.5) * L, 0, 0.12 * vn3(t * 3, 0, 0, seed)]); rr.push(r * (1 - 0.55 * t)); }
  for (let i = 0; i <= 7; i++) { pts[i][1] = rr[i]; base.push(pts[i][0], 0, pts[i][2]); }
  const paint = (v, a, x, y, z, o) => { const n = 0.8 + 0.4 * vn3(x * 4, y * 4, z * 4, seed); o[3] = 0.13 * n; o[4] = 0.11 * n; o[5] = 0.07 * n; o[6] = 0.7; o[7] = 0; };
  b.tube(pts, rr, 6, paint, { cap: true });
  const nb = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < nb; k++) {
    const i0 = 1 + Math.floor(rng() * 5), P = pts[i0], sd = rng() < 0.5 ? -1 : 1, ang = (0.4 + rng() * 0.7) * sd, len = L * (0.2 + rng() * 0.3), rise = rng() < 0.4 ? 0.1 + rng() * 0.25 : 0;
    const q = [];
    const r2 = rr[i0] * 0.55;
    for (let i = 0; i <= 3; i++) { const t = i / 3; q.push([P[0] + Math.cos(ang) * len * t, Math.max(r2 * (1 - 0.5 * t), P[1] + rise * Math.sin(t * Math.PI * 0.8)), P[2] + Math.sin(ang) * len * t]); }
    b.tube(q, q.map((_, i) => r2 * (1 - 0.5 * i / 3)), 4, paint, { tip: true });
    if (!rise) base.push(q[3][0], 0, q[3][2]);
  }
  const t = b.build();
  setBase(t, base);
  return t;
}

function cassiopea(seed) {
  const b = new Builder(), rng = mulberry32(seed), R = 0.1;
  b.blob(2, (x, y, z, o) => { // bell lying upside down on the sand
    const d = 1 + 0.06 * Math.sin(Math.atan2(z, x) * 16);
    o[0] = x * R * d; o[1] = (y < 0 ? y * 0.25 : y * 0.08) * R + 0.025 * R * 4; o[2] = z * R * d;
    const rim = sstep(0.75, 1, Math.hypot(x, z));
    o[3] = lerp(0.5, 0.75, rim); o[4] = lerp(0.48, 0.75, rim); o[5] = lerp(0.4, 0.8, rim);
  });
  for (let k = 0; k < 8; k++) { // frilly oral arms full of algae
    const a = (k / 8) * TAU + rng() * 0.3;
    for (let q = 0; q < 4; q++) {
      const rr = R * (0.15 + q * 0.2), s = R * (0.13 - q * 0.018), cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, cy = 0.035 + 0.02 * Math.sin(q);
      const spot = rng() < 0.35;
      b.blob(1, (x, y, z, o) => {
        const d = 1 + 0.35 * vn3(x * 4 + k, y * 4 + q, z * 4, seed);
        o[0] = cx + x * s * d; o[1] = cy + y * s * d * 0.6; o[2] = cz + z * s * d;
        if (spot && y > 0.5) { o[3] = 0.7; o[4] = 0.8; o[5] = 0.9; } else { o[3] = 0.26; o[4] = 0.24; o[5] = 0.1; }
      });
    }
  }
  return ground(b).build();
}

export function initMangrove() {
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(700 + i * 13 + o));
  M.root = DROPS.map((d, i) => R(9, (s) => rootTpl(s, d, false), i * 101));
  M.rootFar = DROPS.map((d, i) => R(5, (s) => rootTpl(s, d, true), i * 103 + 50));
  M.trunk = R(6, trunkTpl);
  M.drop = R(5, dropRootTpl);
  M.pneu = [pneuPatch(1, 26, 0.45), pneuPatch(2, 38, 0.6), pneuPatch(3, 16, 0.3), pneuPatch(4, 30, 0.55)];
  M.leaves = [leafPatch(1, 18, 0.45), leafPatch(2, 26, 0.6), leafPatch(3, 12, 0.3), leafPatch(4, 22, 0.5)];
  M.floatLeaves = [leafPatch(9, 14, 0.8, true), leafPatch(10, 9, 0.6, true)];
  M.twigs = R(4, twigPatch);
  M.branch = R(5, fallenBranch);
  M.oyster = R(6, (s) => oysterCluster(s, { n: 2 + (s % 4), L: 0.07 + (s % 3) * 0.012 }));
  M.sponge = R(6, (s) => encrust(s, { r: 0.07 + (s % 3) * 0.03, h: 0.05 + (s % 4) * 0.015, lobes: 0.5, ridges: s % 2 ? 0.25 : 0, detail: 1 }));
  M.tunic = R(5, (s) => tunicates(s, { n: 3 + (s % 4) }));
  M.anem = R(4, (k) => anemone(k + 30, { tentacles: 12 + (k % 3) * 3, tlen: 0.14, rows: 2, disc: 0.07, height: 0.05, thick: 0.009, body: [0.45, 0.38, 0.3], tent: k % 2 ? [0.85, 0.55, 0.3] : [0.6, 0.75, 0.55] }));
  M.fuzz = R(4, (s) => fuzzTuft(s, { n: 14, r: 0.05, h: 0.09 }));
  M.grass = R(5, (s) => grassPatch(s + 300, { n: 18, r: 0.5, h: 0.36, w: 0.011, base: [0.05, 0.1, 0.03], mid: [0.12, 0.3, 0.06], tipc: [0.32, 0.36, 0.12], sway: 0.16 }));
  M.cassio = R(3, cassiopea);
  lab(M.oyster, 'Mangrove oysters', 'Oysters cling to the roots and filter the water as the tide rises over them');
  lab(M.sponge, 'Root sponge', 'Sponges on mangrove roots shield them from root-boring isopods');
  lab(M.tunic, 'Sea squirts', 'Sea squirt larvae look like tiny tadpoles with a backbone-like rod');
  lab(M.anem, 'Root anemone', null);
  lab(M.pneu, 'Pneumatophores', 'Snorkel-like pencil roots let mangroves breathe from airless mud');
  lab(M.leaves, 'Fallen mangrove leaves', 'Fallen leaves feed crabs and fuel the whole mangrove food web');
  lab(M.branch, 'Fallen mangrove branch', null);
  lab(M.grass, 'Turtle grass', 'Seagrasses are flowering plants that bloom underwater');
  lab(M.cassio, 'Upside-down jellyfish (Cassiopea)', 'It rests bell-down so the algae in its arms can sunbathe');
  for (const t of [...M.leaves, ...M.floatLeaves, ...M.twigs, ...M.fuzz, ...M.grass, ...M.pneu]) t.solid = false;
  return M;
}

// ---------------------------------------------------------------- per-segment community recipe
const recipeOf = (g) => recipe(g, 'mangrove', (g) => ({
  dens: 0.75 + 0.6 * sv(g, 5),          // tree density
  fringe: 4.4 + 2.6 * sv(g, 6),         // trunk distance of the channel fringe
  oyster: 0.3 + 1.2 * sv(g, 7),
  sponge: 0.3 + 1.2 * sv(g, 8),
  grass: sv(g, 9) * 1.4,
  pneu: 0.2 + sv(g, 10),
  sand: sv(g, 11),
  litter: 0.5 + 0.8 * sv(g, 12),
  floats: sv(g, 13) > 0.55,
  pal: SPONGE.map((c, i) => (sv(g, 14 + i) > 0.35 ? c : null)).filter(Boolean),
}));

// ---------------------------------------------------------------- tree plan (shared by both chains)
const PLANS = new WeakMap();
function* planGen(ctx) {
  let P = PLANS.get(ctx.group);
  if (P) return P;
  const Y = slice();
  const rng = mulberry32(((ctx.s0 * 2654435761) ^ 0x6a09e667) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const trees = [], roots = [], drops = [];
  const tryTree = (s, d0, d1) => {
    const w = ctx.weightOf(s, 'mangrove');
    if (w < 0.03) return;
    const g = segFor(ctx, s, 'mangrove'), rc = recipeOf(g), side = rng() < 0.5 ? -1 : 1;
    const d = rc.fringe + d0 + Math.pow(rng(), 1.3) * (d1 - d0), x = pc.x(s) + side * d;
    const leaf = smoothstep(-0.25, 0.45, noise2(x / 7, s / 7, 132));
    if (rng() > w * rc.dens * (0.3 + 0.7 * leaf)) return;
    for (const t of trees) if ((t.x - x) ** 2 + (t.s - s) ** 2 < 2.6 * 2.6) return;
    trees.push({ x, s, d, side, rng: rng() });
  };
  for (let k = 0; k < 40; k++) tryTree(ctx.s0 + rng() * CHUNK, 0, 4.5);
  for (let k = 0; k < 40; k++) tryTree(ctx.s0 + rng() * CHUNK, 0, 26);
  for (const t of trees) {
    if (Y.over()) { yield; Y.reset(); }
    const yf = fs.at(t.x, t.s), near = t.d < 14;
    t.yb = rng() < 0.15 ? -0.35 + rng() * 0.35 : 0.05 + rng() * 0.45; // trunks mostly stand above the waterline
    t.tpl = M.trunk[(rng() * M.trunk.length) | 0];
    t.yaw = rng() * TAU;
    if (t.yb < -0.05 && !clearBox(pc, t.x, t.s, t.yb, 0, t.tpl.nbR + 0.1)) t.yb = 0.05;
    // every tree differs: age (root count), reach and how high its roots leave the trunk
    const age = rng(), spreadK = 0.8 + rng() * 0.45, hi = 0.2 + rng() * 0.5;
    const nR = Math.round((near ? (t.d < 9 ? 17 + age * 10 : 13 + age * 8) : 6 + age * 5));
    let placed = 0;
    for (let k = 0; k < nR; k++) {
      const yaw = rng() * TAU; // irregular, so neighbouring roots cross and overlap
      // most roots leave the trunk above the water; some drop from overhead branches
      const fromBranch = rng() < 0.2, ya = fromBranch ? 0.8 + rng() * 1.0 : t.yb + hi + Math.pow(rng(), 0.8) * 1.1;
      const aa = fromBranch ? rng() * TAU : yaw, ra = fromBranch ? 0.7 + rng() * 1.8 : t.tpl.nbR * 0.55;
      const xa = t.x + Math.cos(aa) * ra, sa = t.s + Math.sin(aa) * ra, D = ya - yf;
      if (D < 1.0) continue;
      let di = 0; for (let i = 1; i < DROPS.length; i++) if (Math.abs(DROPS[i] - D) < Math.abs(DROPS[di] - D)) di = i;
      const set = (near ? M.root : M.rootFar)[di], tpl = set[(rng() * set.length) | 0];
      let k2 = spreadK * (0.85 + rng() * 0.3), ok = false, sy = 1;
      const R = rotY(yaw);
      for (let attempt = 0; attempt < 3 && !ok; attempt++) { // shorten roots that would reach into the channel
        if (attempt) k2 *= 0.84;
        sy = 0;
        for (const tp of tpl.nbTips) { // vertical stretch so that every tip enters the mud by 15 cm
          const o = xf(R, k2, 1, k2, tp[0], 0, tp[2]);
          const f = fs.at(xa + o[0], sa - o[2]);
          sy = Math.max(sy, (ya - f + 0.15) / -tp[1]);
        }
        if (sy < 0.55 || sy > 1.7 || k2 < 0.62) break;
        if (t.d - ra - (tpl.box[3] + Math.max(-tpl.box[2], tpl.box[5]) + 0.3) * k2 > 4.3) { ok = true; break; } // too far from the path to matter
        const sp = tpl.nbSpine, pts = [];
        for (let i = 0; i < sp.length; i += 4) { const o = xf(R, k2, sy, k2, sp[i], sp[i + 1], sp[i + 2]); pts.push(xa + o[0], ya + o[1], sa - o[2], sp[i + 3] * k2); }
        ok = clearSpine(pc, pts, SOLID, 0.3);
      }
      if (!ok) continue;
      roots.push({ tpl, x: xa, y: ya, s: sa, R, sx: k2, sy, sz: k2, near, tree: t });
      placed++;
    }
    t.placed = placed;
    // aerial drop roots from the branches
    const nd = placed ? Math.floor(rng() * (near ? 2.4 : 1.3)) : 0; // fewer, thinner hanging roots
    for (let k = 0; k < nd; k++) {
      const a = rng() * TAU, r = 1.4 + rng() * 2.2, x = t.x + Math.cos(a) * r, s = t.s + Math.sin(a) * r, top = 0.35 + rng() * 0.8;
      const tpl = M.drop[(rng() * M.drop.length) | 0], R = rotY(rng() * TAU), tp = tpl.nbTips[0], o = xf(R, 1, 1, 1, tp[0], 0, tp[2]);
      const f = fs.at(x + o[0], s - o[2]), sy = (top - f + 0.12) / -tp[1];
      if (sy < 0.35 || sy > 1.7 || !clearBox(pc, x, s, f, top, 0.25)) continue;
      drops.push({ tpl, x, y: top, s, R, sy });
    }
  }
  P = { trees, roots, drops };
  PLANS.set(ctx.group, P);
  return P;
}

// ---------------------------------------------------------------- plan stage, then chain A: trees (structure)
export function* layoutMangroveP(ctx) { if (presence(ctx, 'mangrove') > 0) yield* planGen(ctx); return null; }
function planTrees(ctx) { return PLANS.get(ctx.group) || runLayout(planGen, ctx); }
export function layoutMangroveA(ctx) {
  if (presence(ctx, 'mangrove') <= 0) return null;
  const P = planTrees(ctx), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 90000);
  // channel-side roots first: if the batch fills up, it is the far ones that are left out
  const roots = P.roots.slice().sort((p, q) => Math.abs(p.x - pc.x(p.s)) - Math.abs(q.x - pc.x(q.s)));
  for (const r of roots) r.ok = put(ctx, st, r.tpl, r.x, r.y, r.s, r.R, r.sx, r.sy, r.sz, [1, 1, 1], 1, 'floor');
  for (const d of P.drops) put(ctx, st, d.tpl, d.x, d.y, d.s, d.R, 1, d.sy, 1, [1, 1, 1], 1, 'floor');
  for (const t of P.trees) if (t.placed) put(ctx, st, t.tpl, t.x, t.yb, t.s, rotY(t.yaw), 1, 1, 1, [1, 1, 1], 1, 'roots');
  // label the nearest trees
  const labels = P.trees.filter((t) => t.placed && t.d < 12).sort((a, b) => a.d - b.d).slice(0, 2)
    .map((t) => ['Red mangrove prop roots', t.x - t.side * 1.2, -1.2, t.s, 'Prop roots let mangroves breathe and stand in shifting mud']);
  // where juvenile fish shelter among the fringe roots
  const pois = P.trees.filter((t) => t.placed >= 8 && t.d < 10).slice(0, 2)
    .map((t) => ({ type: 'mangrove-roots', x: t.x - t.side * 1.5, y: -1.4, s: t.s, r: 3, data: { name: 'Mangrove nursery', fact: 'Many reef fish spend their youth hidden among mangrove roots' } }));
  return { batches: [st], labels, pois };
}

// ---------------------------------------------------------------- chain B: life on roots, leaf litter, twigs
const pick = (rng, a) => a[(rng() * a.length) | 0];
// signed distance (world metres, conservative) from a point to a placed root's main tube surface
function rootGap(r, wx, wy, ws, j) {
  const R = r.R, dx = wx - r.x, dy = wy - r.y, dz = -(ws - r.s);
  const lx = (R[0] * dx + R[3] * dy + R[6] * dz) / r.sx, ly = (R[1] * dx + R[4] * dy + R[7] * dz) / r.sy, lz = (R[2] * dx + R[5] * dy + R[8] * dz) / r.sz;
  const S = r.tpl.nbMain;
  let best = 1e9;
  for (let i = 0; i + 4 < S.length; i += 4) {
    const ax = S[i], ay = S[i + 1], az = S[i + 2], ex = S[i + 4] - ax, ey = S[i + 5] - ay, ez = S[i + 6] - az;
    const t = Math.max(0, Math.min(1, ((lx - ax) * ex + (ly - ay) * ey + (lz - az) * ez) / (ex * ex + ey * ey + ez * ez || 1)));
    const d = Math.hypot(lx - ax - ex * t, ly - ay - ey * t, lz - az - ez * t) - (S[i + 3] + (S[i + 7] - S[i + 3]) * t);
    if (d < best) best = d;
  }
  return best * Math.max(r.sx, r.sy, r.sz);
}
export function* layoutMangroveB(ctx) {
  const Y = slice();
  if (presence(ctx, 'mangrove') <= 0) return null;
  const P = planTrees(ctx), lk = lowK(ctx), bk = budgetK(ctx, 'mangrove');
  const rng = mulberry32(((ctx.s0 * 2246822519) ^ 0x3c6ef372) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const near = new Batch(MAT.static, 52000 * bk); near.lod = 'near';
  const sw = new Batch(MAT.sway, 12000 * bk); sw.lod = 'near'; sw.soft = true;
  // --- life encrusting the submerged roots
  for (const r of P.roots) {
    if (Y.over()) { yield; Y.reset(); }
    if (r.ok === false || rng() > lk * (r.near ? 1 : 0.4)) continue; // (a root chain A left out carries nothing)
    const g = segFor(ctx, r.s, 'mangrove'), rc = recipeOf(g), pal = rc.pal.length ? rc.pal : SPONGE;
    const n = 2 + Math.floor(rng() * (3 + 2 * (rc.oyster + rc.sponge)));
    for (let k = 0; k < n; k++) {
      const ri = (rng() * r.tpl.nbRings.length) | 0, rg = r.tpl.nbRings[ri], a = rng() * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const nl = [ca * rg.A[0] + sa * rg.B[0], ca * rg.A[1] + sa * rg.B[1], ca * rg.A[2] + sa * rg.B[2]];
      const pl = [rg.c[0] + nl[0] * rg.r, rg.c[1] + nl[1] * rg.r, rg.c[2] + nl[2] * rg.r];
      const o = xf(r.R, r.sx, r.sy, r.sz, pl[0], pl[1], pl[2]), wy = r.y + o[1];
      if (wy > -0.08) continue;
      const nw = xfn(r.R, r.sx, r.sy, r.sz, nl[0], nl[1], nl[2]);
      const smin = Math.min(r.sx, r.sy, r.sz), rWorld = (rg.r * smin * smin) / Math.max(r.sx, r.sy, r.sz); // tightest curvature
      let tpl, sc, col, b = near, emb = 0.04;
      const u = rng() * (rc.oyster + rc.sponge + 1.1);
      if (u < rc.oyster * (wy > -0.9 ? 2 : 0.4) && wy > -1.3) { tpl = pick(rng, M.oyster); sc = 0.8 + rng() * 0.5; col = [1, 1, 1]; }
      else if (u < rc.oyster + rc.sponge) { tpl = pick(rng, M.sponge); sc = 0.6 + rng() * 0.7; col = pick(rng, pal); }
      else if (u < rc.oyster + rc.sponge + 0.45) { tpl = pick(rng, M.tunic); sc = 0.8 + rng() * 0.6; col = pick(rng, [[0.25, 0.45, 1.0], [1.0, 0.55, 0.2], [0.85, 0.3, 0.55], [0.75, 0.35, 0.95], [1, 1, 1]]); }
      else if (u < rc.oyster + rc.sponge + 0.7 && wy < -1.0) { tpl = pick(rng, M.anem); sc = 0.7 + rng() * 0.5; col = [1, 1, 1]; b = sw; }
      else { tpl = pick(rng, M.fuzz); sc = 0.8 + rng() * 0.6; col = pick(rng, [[0.55, 0.5, 0.25], [0.35, 0.45, 0.2], [0.6, 0.35, 0.3]]); b = sw; }
      // keep the flat base no wider than the root, and sink it so its rim still meets the curved surface
      basePts(tpl);
      if (tpl._nbBaseR * sc > rWorld * 0.85) sc = (rWorld * 0.85) / Math.max(1e-3, tpl._nbBaseR);
      if (sc < 0.35) continue;
      const br = tpl._nbBaseR * sc;
      emb += rWorld - Math.sqrt(Math.max(0, rWorld * rWorld - br * br));
      const Ri = upTo(nw, rng() * TAU), B = basePts(tpl);
      let px = r.x + o[0] - nw[0] * emb, py = wy - nw[1] * emb, ps = r.s - o[2] + nw[2] * emb;
      const gapOf = () => { let g = -1e9; for (let i = 0; i < B.length; i += B.length > 18 ? 6 : 3) { const q = xf(Ri, sc, sc, sc, B[i], B[i + 1], B[i + 2]); g = Math.max(g, rootGap(r, px + q[0], py + q[1], ps - q[2], ri + 1)); } return g; };
      let g = gapOf();
      for (let it = 0; it < 5 && (g > -0.004 || g < -0.025); it++) { // settle every base point onto the real (curved) root surface
        const d = g + 0.012;
        px -= nw[0] * d; py -= nw[1] * d; ps += nw[2] * d;
        g = gapOf();
      }
      if (g > 0.005) continue;
      put(ctx, b, tpl, px, py, ps, Ri, sc, sc, sc, col, b === sw ? sc : 1, { root: r });
    }
  }
  return { batches: [near, sw] };
}

function floorKit(ctx, rng, fs, pc) {
  return (b, tpl, x, s, sc, col, follow = 1, embed = 0.01, fa = 1, tall = 0) => {
    const y = fs.at(x, s), n = [fs.nx * follow, 1 - follow + fs.ny * follow, fs.nz * follow];
    const R = upTo(nrm(n), rng() * TAU);
    const h = (tpl.maxY - tpl.minY) * sc;
    if (tall && !clearBox(pc, x, s, y, y + h, tpl.r * sc, tall === 2 ? SOFT : SOLID)) return false;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, n, embed);
    return put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
  };
}

// ---------------------------------------------------------------- chain C: the rest of the mud
export function* layoutMangroveC(ctx) {
  const Y = slice();
  if (presence(ctx, 'mangrove') <= 0) return null;
  const lk = lowK(ctx), bk = budgetK(ctx, 'mangrove');
  const rng = mulberry32(((ctx.s0 * 3266489917) ^ 0x510e527f) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const near = new Batch(MAT.static, 30000 * bk); near.lod = 'near';
  const mid = new Batch(MAT.static, 10000 * bk); mid.lod = 'mid';
  const sw = new Batch(MAT.sway, 10000 * bk); sw.lod = 'mid'; sw.soft = true;
  const dec = new Builder();
  const floorPut = floorKit(ctx, rng, fs, pc);
  for (let k = 0; k < 4; k++) { // fallen branches
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (1 + rng() * 22);
    if (rng() > ctx.weightOf(s, 'mangrove') * 0.75) continue;
    floorPut(mid, pick(rng, M.branch), x, s, 0.8 + rng() * 0.5, [1, 1, 1], 1, 0.015, 1, 1);
  }
  for (let k = 0; k < 36 * lk; k++) { // pencil roots, in clumps on the banks
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, rc = recipeOf(segFor(ctx, s, 'mangrove')), d = 6 + rng() * 22, x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * d;
    if (rng() > ctx.weightOf(s, 'mangrove') * rc.pneu) continue;
    floorPut(near, pick(rng, M.pneu), x, s, 0.8 + rng() * 0.6, [0.9 + rng() * 0.2, 0.9 + rng() * 0.15, 0.9], 0, 0.06);
  }
  // sunlit sand patches in the channel, with upside-down jellyfish and turtle grass
  const sandC = [0.44, 0.38, 0.26];
  for (let k = 0; k < 4; k++) {
    const s = ctx.s0 + rng() * CHUNK, rc = recipeOf(segFor(ctx, s, 'mangrove')), x = pc.x(s) + (rng() - 0.5) * 9;
    if (rng() > ctx.weightOf(s, 'mangrove') * rc.sand) continue;
    const rx = 1.2 + rng() * 2.2, rz = rx * (0.6 + rng() * 0.6);
    decalDisc(dec, fs, ctx, x, s, rx, rz, rng() * TAU, sandC, 0, 0.85);
    for (let j = Math.floor(rng() * 5); j > 0; j--) {
      const a = rng() * TAU, rr = Math.sqrt(rng()) * rx * 0.7;
      floorPut(near, pick(rng, M.cassio), x + Math.cos(a) * rr, s + Math.sin(a) * rr * (rz / rx), 0.9 + rng() * 0.8, [1, 1, 1], 1, 0.01);
    }
  }
  for (let k = 0; k < 40 * lk; k++) { // turtle grass tufts, mostly in the open channel
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, rc = recipeOf(segFor(ctx, s, 'mangrove')), x = pc.x(s) + (rng() - 0.5) * 2 * (1 + Math.pow(rng(), 2) * 12);
    if (rng() > ctx.weightOf(s, 'mangrove') * rc.grass) continue;
    floorPut(sw, pick(rng, M.grass), x, s, 0.8 + rng() * 0.6, [0.9 + rng() * 0.25, 0.95 + rng() * 0.15, 0.9], 0.3, 0.03, 1, 2);
  }
  for (let k = 0; k < 170 * lk; k++) { // leaf litter: thickest under the canopy
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, rc = recipeOf(segFor(ctx, s, 'mangrove')), d = Math.pow(rng(), 1.3) * 24, x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * d;
    const leaf = smoothstep(-0.25, 0.45, noise2(x / 7, s / 7, 132));
    if (rng() > ctx.weightOf(s, 'mangrove') * rc.litter * (0.25 + 0.75 * leaf)) continue;
    floorPut(near, pick(rng, M.leaves), x, s, 0.8 + rng() * 0.6, [1, 1, 1], 1, 0.003);
  }
  for (let k = 0; k < 45 * lk; k++) { // twigs
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 40;
    if (rng() > ctx.weightOf(s, 'mangrove')) continue;
    floorPut(near, pick(rng, M.twigs), x, s, 0.8 + rng() * 0.5, [1, 1, 1], 1, 0.004);
  }
  // leaves floating on the surface, silhouetted from below (rare)
  const g0 = segFor(ctx, ctx.s0 + 32, 'mangrove');
  if (g0 && recipeOf(g0).floats) {
    for (let k = 0; k < 5; k++) {
      const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 14;
      if (rng() > ctx.weightOf(s, 'mangrove')) continue;
      put(ctx, sw, pick(rng, M.floatLeaves), x, ctx.surfaceY - 0.012, s, rotY(rng() * TAU), 0.8 + rng() * 0.6, 1, 0.8 + rng() * 0.6, [1, 1, 1], 0, 'surface');
    }
  }
  const extra = [builderMesh(dec, NBMAT.decal, null, 'mid')].filter(Boolean);
  return { batches: [near, mid, sw], extra };
}
