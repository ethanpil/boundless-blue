// Sargassum Sea: golden rafts of floating sargassum weed just under the surface of the open ocean.
// Rafts sit where biomes.sargassumCover(x, s) is high (so the dappled shade the core computes from it
// matches): the matted body of each raft is a sheet cut into tangled weed by the shader (cheap, covers
// hundreds of square metres), and real 3D clumps (zig-zag stems, serrated blades, round air bladders)
// crowd its edges and hang beneath it, swaying and riding the swell. Between rafts drift scattered single
// clumps; the wind herds some stretches into long parallel windrows. Rarely a piece of flotsam drifts
// by: a log trailing gooseneck barnacles, a coconut, a lost fishing float.
import { Builder, Batch, TAU, presence, budgetK, CHUNK, vn3, sat, sstep, lerp, rotY, mul3, rotX, rotZ } from './core.js';
import { sv, sargassumCover } from '../biomes.js';
import { pathCache, clearBox, SOFT, SOLID, put, segFor, recipe, lowK, slice, builderMesh } from './nb_common.js';
import { poolOf } from './nb2_common.js';
import { NB3, Space, chunkRng, pick, tint, rr, L } from './nb3_common.js';
import { mulberry32 } from '../noise.js';
import { drainG } from './nb3_anemones.js';

const S = {};
const KEY = 'sargassum';
const SARG_FACT = 'Pelagic sargassum never touches the seabed: it grows, drifts and breaks into new rafts entirely at sea.';
const BLADDER_FACT = 'Sargassum floats on hundreds of tiny gas-filled bladders called pneumatocysts.';
const RAFT_FACT = 'The Sargasso Sea is the only sea with no coastline; its borders are currents that gather the floating weed.';
const ROW_FACT = 'Wind-driven currents roll the surface water into long spirals that herd sargassum into parallel windrows.';

// golden-amber palettes (linear RGB): [stem, blade, bladder]
// golden-brown palettes (linear RGB): [stem, blade, bladder]. Authored warm: the water's blue-green
// filter shifts yellow weed toward lime, so the blades lean to amber and brown.
const PAL = [
  [L(0x4c3414), L(0xa4722a), L(0xbc8a3a)], // golden brown
  [L(0x4e3014), L(0x925e22), L(0xac7430)], // amber
  [L(0x463416), L(0x86682a), L(0xa0803a)], // olive-brown
  [L(0x5a3e16), L(0xb4822e), L(0xca9c44)], // fresh gold
  [L(0x3e2a10), L(0x74501e), L(0x8e6828)], // dark brown, older weed
];

// ---------------------------------------------------------------- geometry pieces
function octa(b, c, r, col, part, amp) { // a small smooth bead (air bladder): 6 verts, 8 tris
  const v0 = b.vc, D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const d of D) b.v(c[0] + d[0] * r, c[1] + d[1] * r * 0.95, c[2] + d[2] * r, d[0], d[1], d[2], col[0], col[1], col[2], amp, part);
  const F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
  for (const f of F) b.t(v0 + f[0], v0 + f[1], v0 + f[2]);
}
// a serrated, lanceolate blade along direction d from p (two-sided material)
function blade(b, p, d, len, w, col, amp, rng, segs = 3) {
  let sx = -d[2], sz = d[0];
  const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
  const tw = (rng() - 0.5) * 1.2, ux = sx * Math.cos(tw), uy = Math.sin(tw), uz = sz * Math.cos(tw);
  const v0 = b.vc, k = 0.85 + 0.3 * rng();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, ww = w * Math.pow(Math.sin(Math.PI * Math.min(0.97, 0.12 + t * 0.88)), 0.8) * (i % 2 ? 1.18 : 0.9); // toothed edge
    const cx = p[0] + d[0] * len * t, cy = p[1] + d[1] * len * t - 0.15 * len * t * t, cz = p[2] + d[2] * len * t;
    const nx = d[1] * uz - d[2] * uy, ny = d[2] * ux - d[0] * uz, nz = d[0] * uy - d[1] * ux; // d x u
    const c = [col[0] * k * (0.9 + 0.2 * t), col[1] * k * (0.9 + 0.2 * t), col[2] * k];
    b.v(cx - ux * ww, cy - uy * ww, cz - uz * ww, nx, ny, nz, c[0], c[1], c[2], amp, 1);
    b.v(cx + ux * ww, cy + uy * ww, cz + uz * ww, nx, ny, nz, c[0], c[1], c[2], amp, 1);
  }
  for (let i = 0; i < segs; i++) { const a = v0 + i * 2; b.t(a, a + 1, a + 3); b.t(a, a + 3, a + 2); }
}

// ---------------------------------------------------------------- sargassum clump
// A floating clump (local y = 0 is the waterline): a few dense, bushy puffs of zig-zag stems, each node
// carrying serrated blades and round air bladders, plus (sometimes) strands hanging deeper. detail: 1 near,
// 0 far (fewer, bigger parts). Sway amplitude grows with depth below the raft.
export function* sargClump(seed, { R = 0.45, hang = 0.5, pal = PAL[0], bladK = 1, bladderK = 1, natans = true, detail = 1, tier = 'high', puffs = 0, strands = 0 } = {}) {
  const rng = mulberry32(seed * 911 + 5), b = new Builder(), lo = tier === 'low' || !detail, big = detail ? 1 : 1.45;
  const [cS, cB, cP] = pal;
  const amp = (y) => 0.015 + 0.2 * sat(-y / Math.max(0.2, hang));
  const W = (natans ? 0.009 : 0.013) * bladK * big, BL = (natans ? 0.07 : 0.055) * big, BR = (natans ? 0.0065 : 0.008) * big;
  const shade = () => 0.8 + 0.4 * rng();
  // one stem: zig-zag polyline from p along d, a node every `seg` m with blades and bladders
  const stem = (p0, d0, len, seg, nb, np, dangle) => {
    const n = Math.max(2, Math.round(len / seg)), pts = [p0.slice()], rad = [0.0045];
    let d = d0.slice();
    const p = p0.slice();
    for (let i = 1; i <= n; i++) {
      const zz = (i % 2 ? 1 : -1) * (0.35 + rng() * 0.25), c = Math.cos(zz), sn = Math.sin(zz);
      d = [d[0] * c - d[2] * sn, d[1] - (dangle ? 0 : 0.05), d[0] * sn + d[2] * c];
      const l = Math.hypot(d[0], d[1], d[2]); d = [d[0] / l, d[1] / l, d[2] / l];
      p[0] += d[0] * seg; p[1] = Math.min(-0.006, p[1] + d[1] * seg); p[2] += d[2] * seg;
      pts.push(p.slice()); rad.push(0.004 - 0.0015 * (i / n));
      const k = shade();
      for (let q = 0; q < nb; q++) {
        const ba = Math.atan2(d[2], d[0]) + (rng() - 0.5) * 2.6, bd = [Math.cos(ba), -0.05 - rng() * 0.45, Math.sin(ba)], bl = Math.hypot(bd[0], bd[1], bd[2]);
        blade(b, p, [bd[0] / bl, bd[1] / bl, bd[2] / bl], BL * (0.65 + 0.6 * rng()), W * (0.7 + 0.5 * rng()), [cB[0] * k, cB[1] * k, cB[2] * k], amp(p[1]), rng, lo ? 2 : 3);
      }
      for (let q = 0; q < np; q++) {
        const o = [p[0] + (rng() - 0.5) * 0.035, Math.min(-0.006, p[1] + (rng() - 0.65) * 0.03), p[2] + (rng() - 0.5) * 0.035];
        octa(b, o, BR * (0.75 + 0.5 * rng()), [cP[0] * k, cP[1] * k, cP[2] * k], 2, amp(o[1]));
      }
    }
    b.tube(pts, rad, 3, (v, an, x, y, z, o) => { const k = 0.8 + 0.2 * v; o[3] = cS[0] * k; o[4] = cS[1] * k; o[5] = cS[2] * k; o[6] = amp(y); o[7] = v < 0.35 ? 3 : 0; });
  };
  // puffs: dense bushes near the surface, the biggest in the middle
  const nP = puffs || (lo ? 2 + ((rng() * 2) | 0) : 2 + ((rng() * 3) | 0));
  for (let k = 0; k < nP; k++) {
    const a = rng() * TAU, d = k ? R * (0.35 + 0.5 * rng()) : 0, rp = R * (k ? 0.3 + 0.25 * rng() : 0.45 + 0.2 * rng());
    const c = [Math.cos(a) * d, -0.02 - rng() * 0.06, Math.sin(a) * d], nS = lo ? 4 + ((rng() * 2) | 0) : 5 + ((rng() * 3) | 0);
    for (let q = 0; q < nS; q++) {
      const sa = (q / nS) * TAU + rng() * 0.8, dir = [Math.cos(sa), -0.25 + (rng() - 0.5) * 0.8, Math.sin(sa)];
      const st = [c[0] + (rng() - 0.5) * rp * 0.4, c[1] + (rng() - 0.5) * 0.03, c[2] + (rng() - 0.5) * rp * 0.4];
      stem(st, dir, rp * (0.8 + 0.45 * rng()), lo ? 0.08 * big : 0.065, lo ? 1 : 1 + (rng() < 0.3 ? 1 : 0), Math.round((lo ? 1 : 1 + rng()) * bladderK), false);
    }
    yield;
  }
  // strands hanging below the raft
  const nH = strands || Math.round((lo ? 1 : 1 + rng() * 2) * Math.min(1.5, hang / 0.5));
  for (let k = 0; k < nH; k++) {
    const a = rng() * TAU, st = [Math.cos(a) * R * 0.5 * rng(), -0.05, Math.sin(a) * R * 0.5 * rng()];
    // long fronds (strands > 0) node every 10-14 cm: a ragged fringe, not a bead curtain
    stem(st, [Math.cos(a) * 0.35, -1, Math.sin(a) * 0.35], hang * (0.5 + 0.5 * rng()), strands ? (lo ? 0.14 : 0.1) : lo ? 0.1 : 0.07, 1, rng() < 0.6 ? 1 : 0, true);
    if (strands) yield;
  }
  const t = b.build();
  t.label = natans ? 'Sargassum (S. natans)' : 'Sargassum (S. fluitans)';
  t.fact = rng() < 0.5 ? SARG_FACT : BLADDER_FACT;
  t.solid = false; t.nbR = R;
  return t;
}

// ---------------------------------------------------------------- flotsam
// Gooseneck barnacles (Lepas) hanging from a surface: dark stalks and white almond-shaped shells.
function goosenecks(b, pts, rng) { // pts: [[x, y, z], ...] attachment points on the underside
  for (const p of pts) {
    const L = 0.03 + rng() * 0.06, a = rng() * TAU, lean = 0.2 + rng() * 0.3;
    const e = [p[0] + Math.cos(a) * lean * L, p[1] - L, p[2] + Math.sin(a) * lean * L];
    b.tube([[p[0], p[1] + 0.01, p[2]], [(p[0] + e[0]) / 2, (p[1] + e[1]) / 2, (p[2] + e[2]) / 2], e], [0.006, 0.005, 0.0045], 4, (v, an, x, y, z, o) => { o[3] = 0.09; o[4] = 0.05; o[5] = 0.05; o[6] = 0.03 * v; o[7] = 4; });
    const s = 0.012 + rng() * 0.006, v0 = b.vc;
    b.blob(0, (x, y, z, o) => { o[0] = e[0] + x * s * 0.6; o[1] = e[1] - s * 1.1 + y * s * 1.3; o[2] = e[2] + z * s * 0.35; const k = 0.75 + 0.25 * Math.abs(x); o[3] = 0.85 * k; o[4] = 0.84 * k; o[5] = 0.8 * k; o[6] = 0.03; o[7] = 4; });
    const R = rotY(a); b.xform(v0, R, 0, 0, 0); // shells turn with the stalk (around their own centre below)
    for (let i = v0; i < b.vc; i++) { b.P[i * 3] += e[0] - (R[0] * e[0] + R[2] * e[2]); b.P[i * 3 + 2] += e[2] - (R[6] * e[0] + R[8] * e[2]); }
  }
}
function driftLog(seed) {
  const b = new Builder(), rng = mulberry32(seed * 313 + 1), Lg = 1.2 + rng() * 1.6, r0 = 0.07 + rng() * 0.06, pts = [], rad = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([(t - 0.5) * Lg, -r0 * 0.45 + 0.03 * vn3(t * 3, 0, 0, seed), 0.08 * vn3(t * 2, 1, 0, seed)]); rad.push(r0 * (1 - 0.35 * t) * (1 + 0.1 * vn3(t * 6, 2, 0, seed))); }
  b.tube(pts, rad, 7, (v, a, x, y, z, o) => { const n = 0.75 + 0.35 * vn3(x * 6, y * 6, z * 6, seed); const wet = y < -0.02 ? 0.6 : 1; o[3] = 0.42 * n * wet; o[4] = 0.36 * n * wet; o[5] = 0.28 * n * wet; o[6] = 0; o[7] = 4; }, { cap: true });
  // a broken side branch
  const j = 2 + ((rng() * 4) | 0), P = pts[j], a = rng() < 0.5 ? 1 : -1;
  b.tube([P, [P[0] + 0.25, P[1] - 0.05, P[2] + a * 0.3]], [rad[j] * 0.45, rad[j] * 0.3], 5, (v, an, x, y, z, o) => { o[3] = 0.4; o[4] = 0.34; o[5] = 0.27; o[6] = 0; o[7] = 4; }, { cap: true });
  const att = [];
  for (let k = 0; k < 14 + rng() * 20; k++) { const i = Math.min(7, (rng() * 8) | 0), t = rng(), p0 = pts[i], p1 = pts[i + 1], an = (rng() - 0.5) * 1.2; att.push([lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t) - rad[i] * Math.cos(an) * 0.9, lerp(p0[2], p1[2], t) + rad[i] * Math.sin(an) * 0.9]); }
  goosenecks(b, att, rng);
  const t = b.build();
  t.label = 'Driftwood with gooseneck barnacles';
  t.fact = 'Gooseneck barnacles ride driftwood across whole oceans, combing the water with feathery legs.';
  t.obs = [[pts[0][0], pts[0][1], pts[0][2], pts[8][0], pts[8][1], pts[8][2], r0 + 0.08]];
  return t;
}
function coconut(seed) {
  const b = new Builder(), rng = mulberry32(seed * 271 + 3), R = 0.11 + rng() * 0.04;
  b.blob(2, (x, y, z, o) => {
    const ridge = 1 + 0.06 * Math.max(Math.cos(Math.atan2(z, x) * 3), 0);
    o[0] = x * R * ridge; o[1] = y * R * 0.9 - R * 0.25; o[2] = z * R * 1.18 * ridge;
    const n = 0.75 + 0.35 * vn3(x * 9, y * 9, z * 9, seed); o[3] = 0.25 * n; o[4] = 0.15 * n; o[5] = 0.07 * n; o[6] = 0; o[7] = 4;
  });
  const att = [];
  for (let k = 0; k < (rng() < 0.6 ? 4 + rng() * 6 : 0); k++) { const a = rng() * TAU; att.push([Math.cos(a) * R * 0.5, -R * 1.1, Math.sin(a) * R * 0.6]); }
  goosenecks(b, att, rng);
  const t = b.build();
  t.label = 'Drifting coconut';
  t.fact = 'A coconut can float for months and still sprout on the beach where it finally lands.';
  return t;
}
function fishFloat(seed) {
  const b = new Builder(), rng = mulberry32(seed * 197 + 9), R = 0.1 + rng() * 0.08;
  const col = pick(rng, [[0.9, 0.22, 0.02], [0.92, 0.65, 0.02], [0.85, 0.85, 0.82], [0.75, 0.08, 0.04]]);
  b.blob(2, (x, y, z, o) => { o[0] = x * R; o[1] = y * R - R * 0.3; o[2] = z * R; const k = 0.85 + 0.15 * y; o[3] = col[0] * k; o[4] = col[1] * k; o[5] = col[2] * k; o[6] = 0; o[7] = 4; });
  // a frayed rope stub trailing below
  const Lr = 0.5 + rng() * 1.1, pts = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([0.05 * Math.sin(t * 5 + seed), -R * 1.25 - Lr * t, 0.06 * Math.cos(t * 4 + seed) * t]); }
  b.tube(pts, pts.map((_, i) => 0.008 * (1 - 0.2 * i / 6)), 4, (v, an, x, y, z, o) => { o[3] = 0.55; o[4] = 0.5; o[5] = 0.32; o[6] = 0.12 * v; o[7] = 4; });
  goosenecks(b, Array.from({ length: 3 + ((rng() * 5) | 0) }, () => { const a = rng() * TAU; return [Math.cos(a) * R * 0.4, -R * 1.2, Math.sin(a) * R * 0.4]; }), rng);
  const t = b.build();
  t.label = 'Lost fishing float';
  t.fact = 'Lost floats drift for years, gathering a crew of barnacles, crabs and young fish that shelter beneath them.';
  return t;
}

// ---------------------------------------------------------------- templates and per-segment palettes
export const recipeOf = (g) => recipe(g, 'nb3sg', (g) => {
  const u = (k) => sv(g, 500 + k);
  return {
    pal: PAL[Math.floor(u(0) * PAL.length)], pal2: PAL[Math.floor(u(1) * PAL.length)],
    natans: u(2) < 0.7,                    // S. natans (narrow blades, spiny bladders) vs S. fluitans
    hang: 0.3 + 0.7 * u(3),                // how far strands dangle below the rafts
    dens: 0.75 + 0.55 * u(4),              // clump density
    rows: u(5) < 0.4 ? 0.55 + 0.4 * u(6) : 0, rowDir: u(7) * Math.PI, rowSp: 7 + 9 * u(8), // windrows
    flot: 0.08 + 0.2 * u(9),               // flotsam chance per chunk
    big: 0.8 + 0.6 * u(10),
  };
});
export function initSargassum(tier) {
  S.near = [0, 1, 2, 3].map((i) => drainG(sargClump(9100 + i * 7, { R: 0.4 + i * 0.1, hang: 0.4 + i * 0.12, pal: PAL[i % PAL.length], natans: i !== 2, detail: 1, tier })));
  S.far = [0, 1, 2].map((i) => drainG(sargClump(9200 + i * 7, { R: 0.6 + i * 0.15, hang: 0.5, pal: PAL[(i + 1) % PAL.length], detail: 0, tier })));
  S.hang = [0, 1, 2].map((i) => drainG(sargClump(9300 + i * 7, { R: 0.3 + i * 0.08, hang: 0.8 + i * 0.3, pal: PAL[(i + 2) % PAL.length], puffs: 1, strands: 4 + i, detail: 1, tier })));
  S.flot = { log: [1, 2, 3].map(driftLog), coco: [1, 2].map(coconut), float: [1, 2, 3].map(fishFloat) };
  return S;
}
export function sargassumProviders(provide) {
  provide(KEY, 'nb3sgNear', 9, (seg, k, tier) => {
    const rc = recipeOf(seg), sd = (seg.seed ^ Math.imul(k + 1, 0x2545f491)) >>> 0;
    return sargClump(sd, { R: 0.38 + ((sd >>> 3) % 100) / 100 * 0.5, hang: rc.hang * (0.6 + ((sd >>> 9) % 100) / 100 * 0.8), pal: k % 3 === 2 ? rc.pal2 : rc.pal, natans: rc.natans !== (k % 4 === 3), bladderK: 0.7 + ((sd >>> 13) % 100) / 100 * 0.7, detail: 1, tier });
  }, 2);
  // matted tangles hanging 0.5-1.5 m under the rafts: one small puff and a fringe of long fronds
  provide(KEY, 'nb3sgHang', 6, (seg, k, tier) => {
    const rc = recipeOf(seg), sd = (seg.seed ^ Math.imul(k + 13, 0x6c078965)) >>> 0;
    return sargClump(sd, { R: 0.28 + ((sd >>> 3) % 100) / 100 * 0.3, hang: 0.6 + ((sd >>> 9) % 100) / 100 * 0.9, pal: k % 2 ? rc.pal2 : rc.pal, natans: rc.natans, puffs: 1, strands: 3 + ((sd >>> 15) % 4), detail: 1, tier });
  }, 2);
  provide(KEY, 'nb3sgFar', 5, (seg, k, tier) => {
    const rc = recipeOf(seg), sd = (seg.seed ^ Math.imul(k + 7, 0x165667b1)) >>> 0;
    return sargClump(sd, { R: 0.55 + ((sd >>> 3) % 100) / 100 * 0.5, hang: rc.hang, pal: k % 2 ? rc.pal2 : rc.pal, natans: rc.natans, detail: 0, tier });
  }, 2);
}

// raft density at (x, s): the core's cover, times the biome weight, with windrows in some segments
function density(rc, x, s, w) {
  let c = sargassumCover(x, s) * w;
  if (rc.rows) {
    const q = (x * Math.cos(rc.rowDir) + s * Math.sin(rc.rowDir)) / rc.rowSp;
    const row = Math.pow(0.5 + 0.5 * Math.cos(q * TAU), 3);
    c *= 1 - rc.rows + rc.rows * (0.35 + 1.1 * row);
  }
  return c;
}

// ---------------------------------------------------------------- layout
export function* layoutSargassum(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const rc0 = recipeOf(g0), bk = budgetK(ctx, KEY), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0x5a26), pc = pathCache(ctx), sp = new Space(), surf = ctx.surfaceY;
  const near = new Batch(NB3.mat.sarg, 70000 * bk); near.soft = true; near.lod = 'near'; near.jobVerts = 13000;
  const far = new Batch(NB3.mat.sarg, 34000 * bk); far.soft = true; far.lod = 'mid'; far.jobVerts = 12000;
  const flot = new Batch(NB3.mat.sarg, 12000); flot.lod = 'mid';
  const hang = new Batch(NB3.mat.sarg, 44000 * bk); hang.soft = true; hang.lod = 'mid'; hang.jobVerts = 12000;
  const labels = [], pois = [];
  // ---- raft sheet: 2 m lattice over the visible band, three layers: the surface mat, a lower one under
  // thick mats, and a sparse, ragged underlayer of tangles sagging up to ~1.2 m (the mat has body)
  const sheet = new Builder(), CELL = 2, W = 70;
  const ns = Math.round(CHUNK / CELL) + 1, xs0 = Math.floor((pc.x(ctx.s0 + 32) - W) / CELL) * CELL, nx = Math.round(2 * W / CELL) + 1;
  const D = new Float32Array(ns * nx), Wt = new Float32Array(ns);
  for (let j = 0; j < ns; j++) {
    const s = ctx.s0 + j * CELL, g = segFor(ctx, s, KEY);
    Wt[j] = g ? ctx.weightOf(s, KEY) : 0;
    for (let i = 0; i < nx; i++) D[j * nx + i] = Wt[j] > 0 ? density(g ? recipeOf(g) : rc0, xs0 + i * CELL, s, Wt[j]) : 0;
    if (Y.over()) { yield; Y.reset(); }
  }
  for (let layer = 0; layer < 3; layer++) {
    const thr = layer === 2 ? 0.62 : layer ? 0.5 : 0.3, idx = new Int32Array(ns * nx).fill(-1);
    const need = (j, i) => { for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) { const jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj >= ns - 1 || ii >= nx - 1) continue; if (Math.max(D[jj * nx + ii], D[jj * nx + ii + 1], D[(jj + 1) * nx + ii], D[(jj + 1) * nx + ii + 1]) > thr) return true; } return false; };
    for (let j = 0; j < ns; j++) for (let i = 0; i < nx; i++) {
      if (i === 0 && Y.over()) { yield; Y.reset(); }
      if (!need(j, i)) continue;
      const x = xs0 + i * CELL, s = ctx.s0 + j * CELL, d = D[j * nx + i], g = segFor(ctx, s, KEY), rc = g ? recipeOf(g) : rc0;
      const dn = sstep(layer ? 0.45 : 0.22, layer ? 0.95 : 0.8, d), lump = 0.5 + 0.5 * vn3(x * 0.3, layer * 3, s * 0.3, 47);
      const y = surf - (layer === 2 ? 0.5 + 0.35 * dn + 0.4 * dn * lump : layer ? 0.25 + 0.3 * dn + 0.35 * dn * lump : 0.05 + 0.1 * dn + 0.22 * dn * lump); // thick mats sag in lumps
      const pv = vn3(x * 0.07, 0, s * 0.07, 41) * 0.5 + 0.5, c = pv < 0.5 ? rc.pal[1] : rc.pal2[1], k = (layer === 2 ? 0.62 : layer ? 0.8 : 1) * (0.85 + 0.3 * vn3(x * 0.2, 1, s * 0.2, 43));
      idx[j * nx + i] = sheet.v(x, y, -(s - ctx.s0), 0, 1, 0, c[0] * k, c[1] * k, c[2] * k, dn, layer);
    }
    for (let j = 0; j < ns - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = idx[j * nx + i], b2 = idx[j * nx + i + 1], c2 = idx[(j + 1) * nx + i], d2 = idx[(j + 1) * nx + i + 1];
      if (a < 0 || b2 < 0 || c2 < 0 || d2 < 0) continue;
      sheet.t(a, b2, d2); sheet.t(a, d2, c2);
    }
    yield;
  }
  // big rafts get a label (and the camera may look up at them)
  let best = null;
  for (let j = 2; j < ns - 2; j += 3) for (let i = 2; i < nx - 2; i += 3) {
    const d = D[j * nx + i], x = xs0 + i * CELL, s = ctx.s0 + j * CELL, ad = Math.abs(x - pc.x(s));
    if (d > 0.7 && ad < 30 && (!best || d - ad * 0.01 > best.k)) best = { x, s, k: d - ad * 0.01 };
  }
  if (best) labels.push([rc0.rows ? 'Sargassum windrow' : 'Sargassum raft', best.x, surf - 0.3, best.s, rc0.rows ? ROW_FACT : RAFT_FACT]);
  // one POI per raft (connected cells of thick mat), at its underside where it comes nearest the route, so
  // the camera director tilts up to frame the rafts instead of cruising level beneath them
  {
    const seen = new Uint8Array(ns * nx), rafts = [], st = [];
    for (let k0 = 0; k0 < ns * nx; k0++) {
      if (seen[k0] || D[k0] < 0.55) continue;
      seen[k0] = 1; st.push(k0);
      let n = 0, nb = null;
      while (st.length) {
        const k = st.pop(), jj = (k / nx) | 0, ii = k - jj * nx, x = xs0 + ii * CELL, s = ctx.s0 + jj * CELL, ad = Math.abs(x - pc.x(s));
        n++;
        if (!nb || ad < nb.ad) nb = { x, s, ad };
        if (jj > 0 && !seen[k - nx] && D[k - nx] >= 0.55) { seen[k - nx] = 1; st.push(k - nx); }
        if (jj < ns - 1 && !seen[k + nx] && D[k + nx] >= 0.55) { seen[k + nx] = 1; st.push(k + nx); }
        if (ii > 0 && !seen[k - 1] && D[k - 1] >= 0.55) { seen[k - 1] = 1; st.push(k - 1); }
        if (ii < nx - 1 && !seen[k + 1] && D[k + 1] >= 0.55) { seen[k + 1] = 1; st.push(k + 1); }
      }
      if (n >= 5 && nb.ad < 28) rafts.push({ x: nb.x, s: nb.s, n });
    }
    rafts.sort((a, b) => b.n - a.n);
    for (const r of rafts.slice(0, 4)) pois.push({ type: 'sargassum-raft', x: r.x, y: surf - 2.2, s: r.s, r: Math.min(6, 2.5 + Math.sqrt(r.n) * 0.5), data: { name: rc0.rows ? 'Sargassum windrow' : 'Sargassum raft' } });
  }
  // ---- 3D clumps: crowding raft edges, hanging under the mats, and scattered singles in between.
  // Detailed ones close to the path (the closest are overhead, ~4 m up), simpler ones out to 55 m.
  const nN = Math.round(46 * rc0.dens * bk * lk), nF = Math.round(36 * rc0.dens * bk * lk);
  for (const isNear of [true, false]) {
    const want = isNear ? nN : nF, list0 = isNear ? 'nb3sgNear' : 'nb3sgFar';
    let placed = 0;
    for (let k = 0; k < want * 6 && placed < want; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
      if (!g) continue;
      const w = ctx.weightOf(s, KEY), rc = recipeOf(g);
      const dx = (rng() < 0.5 ? -1 : 1) * (isNear ? Math.pow(rng(), 1.4) * 20 : 20 + rng() * 35), x = pc.x(s) + dx;
      const d = density(rc, x, s, w);
      // accept: raft edges and undersides, plus rare drifting singles
      const p = d > 0.6 ? 0.55 : d > 0.12 ? 0.5 + d : 0.04 * w;
      if (rng() > p) continue;
      const tpl = pick(rng, isNear ? poolOf(g, list0, S.near, 3) : poolOf(g, list0, S.far, 2));
      const sc = (0.85 + rng() * 0.6) * (d > 0.55 ? rc.big : 0.9), r = tpl.nbR * sc;
      if (!sp.free(x, s, r * 0.45)) continue;
      const y = surf - 0.015 - rng() * 0.04 - 0.12 * sat(d);
      if (!clearBox(pc, x, s, y + tpl.minY * sc, y, r, SOFT)) continue;
      const R = mul3(rotY(rng() * TAU), mul3(rotX((rng() - 0.5) * 0.2), rotZ((rng() - 0.5) * 0.2)));
      const c = 0.88 + rng() * 0.24;
      if (!put(ctx, isNear ? near : far, tpl, x, y, s, R, sc, sc * (0.85 + rng() * 0.3), sc, [c, c, c * (0.92 + rng() * 0.1)], sc, 'surface')) continue;
      sp.add(x, s, r * 0.45);
      placed++;
    }
  }
  // ---- tangles hanging 0.5-1.5 m under the mats: crowded along the raft edges (seen from the side as
  // the camera approaches) and scattered under the body (seen when it passes beneath)
  const spH = new Space(), nHg = Math.round(56 * rc0.dens * bk * lk);
  for (let k = 0, placed = 0; k < nHg * 6 && placed < nHg; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const w = ctx.weightOf(s, KEY), rc = recipeOf(g), x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * Math.pow(rng(), 1.2) * 32;
    const d = density(rc, x, s, w);
    if (d < 0.28 || rng() > (d < 0.75 ? 0.95 : 0.45)) continue;
    // half are frond tangles hanging from the mat, half bushy clumps caught 0.25-1.2 m under it
    const puff = rng() < 0.5, tpl = puff ? pick(rng, poolOf(g, 'nb3sgFar', S.far, 2)) : pick(rng, poolOf(g, 'nb3sgHang', S.hang, 2));
    const sc = puff ? 1.0 + rng() * 0.6 : 0.85 + rng() * 0.5, r = tpl.nbR * sc;
    if (!spH.free(x, s, r * 0.5)) continue;
    const y = surf - 0.08 - 0.3 * sstep(0.22, 0.8, d) - (puff ? 0.2 + Math.pow(rng(), 0.8) * 0.9 : rng() * 0.1), sy = sc * (0.8 + rng() * 0.5);
    if (!clearBox(pc, x, s, y + tpl.minY * sy, y, r, SOFT)) continue;
    const c = 0.85 + rng() * 0.25;
    if (!put(ctx, hang, tpl, x, y, s, mul3(rotY(rng() * TAU), rotX((rng() - 0.5) * 0.15)), sc, sy, sc, [c, c * 0.97, c * 0.9], sc, 'surface')) break;
    spH.add(x, s, r * 0.5); placed++;
  }
  // ---- flotsam, rarely
  if (rng() < rc0.flot * bk) {
    const kind = rng(), list = kind < 0.45 ? S.flot.log : kind < 0.75 ? S.flot.coco : S.flot.float, tpl = pick(rng, list);
    for (let tries = 0; tries < 8; tries++) {
      const s = ctx.s0 + 6 + rng() * (CHUNK - 12), x = pc.x(s) + (rng() - 0.5) * 2 * (2 + rng() * 14);
      const y = surf + (list === S.flot.log ? 0 : 0.02), sc = 0.9 + rng() * 0.3;
      if (!clearBox(pc, x, s, y + tpl.minY * sc, y + tpl.maxY * sc, tpl.r * sc, SOLID)) continue;
      put(ctx, flot, tpl, x, y, s, rotY(rng() * TAU), sc, sc, sc, [1, 1, 1], 1, 'surface');
      pois.push({ type: 'flotsam', x, y: y - 1.5, s, r: 2, data: { name: tpl.label } });
      break;
    }
  }
  const extra = [];
  yield;
  if (sheet.I.length) {
    const m = builderMesh(sheet, NB3.mat.mat, null, 'mid');
    m.geometry.boundingSphere.radius += 1;
    extra.push(m);
  }
  return { batches: [near, far, flot, hang], extra, labels, pois };
}
