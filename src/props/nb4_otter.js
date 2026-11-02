// Otter Coast: a temperate rocky reef under a forest of giant kelp. Kelp plants grip boulders and the floor with
// tangled holdfasts; their stipes rise to the surface and stream along it as a floating canopy (3D fronds plus
// a cheap tangled-weed sheet). Bull kelp holds its single float at the surface with a mane of long blades
// streaming downcurrent. The rocks carry pink coralline crusts, strawberry-anemone clone carpets, ochre stars,
// purple and red urchins and abalone; drift kelp, shell hash and coralline turf lie between them. Everything is
// denser on the shoreward side. Kelp and bull kelp templates are generated per segment (rock_gen providers) at
// heights matched to the segment's depths, so no two forests look alike.
import { Builder, Batch, TAU, presence, budgetK, CHUNK, vn3, sat, sstep, lerp, rotY, rotX, rotZ, mul3 } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { urchin, seastar, tuft, pebblePatch } from './shapes.js';
import { seaPalm } from './features.js';
import { encrust } from './nb_shapes.js';
import { pathCache, clearBox, SOLID, SOFT, seat, put, upTo, mix3, nrm, segFor, recipe, lowK, slice, nbFloor, decalDisc, builderMesh, NBMAT, lab, setBase } from './nb_common.js';
import { poolOf, planned, itemSpots, seatOnItem } from './nb2_common.js';
import { NB3, Space } from './nb3_common.js';
import { rockJob, drain, tiered } from './rock_recipes.js';
import { IBatch, iput, rr, pick, chunkRng, L, once, segSeed, q01, NB4, grips, pressOn, gridded, warmTpl } from './nb4_common.js';
import { mulberry32 } from '../noise.js';

const KEY = 'otterkelp';
const O = {};
const STIPE = [0.34, 0.24, 0.07], BLADE = [0.7, 0.47, 0.11];
const KELP_FACTS = ['Giant kelp can grow half a metre in a day, the fastest-growing seaweed on Earth.', 'Sea otters wrap themselves in kelp fronds so they do not drift away while they sleep.', 'Every giant kelp blade has its own gas bladder, the pneumatocyst, that floats it toward the light.'];
const BULL_FACTS = ['Bull kelp is an annual: its whip-like stipe grows up to 30 m in a single season.', 'One gas float holds bull kelp at the surface; the gas inside is partly carbon monoxide.'];

// ---------------------------------------------------------------- kelp pieces
function bladder(b, c, r, col, sw) { // small gas bladder (pneumatocyst): 6 verts
  const v0 = b.vc, D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const d of D) b.v(c[0] + d[0] * r * 0.6, c[1] + d[1] * r, c[2] + d[2] * r * 0.6, d[0], d[1], d[2], col[0], col[1], col[2], sw, 1);
  for (const f of [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]) b.t(v0 + f[0], v0 + f[1], v0 + f[2]);
}
// corrugated, twisted lanceolate blade from p along d (unit), drooping by `droop` per segment
function blade(b, rng, p, d, Lb, W, sw0, sw1, droop, col, segs, flat = false) {
  const side = [-d[2], 0, d[0]], sl = Math.hypot(side[0], side[2]) || 1;
  side[0] /= sl; side[2] /= sl;
  const tw0 = flat ? (rng() - 0.5) * 0.5 : (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.8), twist = (rng() - 0.5) * (flat ? 0.6 : 1.2), ruf = W * (0.25 + 0.4 * rng()), k = rng() * 10;
  let q = p.slice(), dir = d.slice();
  const v0 = b.vc;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = i === segs ? W * 0.3 : W * Math.pow(Math.sin(Math.min(1, t * 0.85 + 0.15) * Math.PI), 0.6);
    const ux = side[1] * dir[2] - side[2] * dir[1], uy = side[2] * dir[0] - side[0] * dir[2], uz = side[0] * dir[1] - side[1] * dir[0];
    const ul = Math.hypot(ux, uy, uz) || 1, tw = tw0 + twist * t, ct = Math.cos(tw), st = Math.sin(tw);
    const wx = side[0] * ct + ux / ul * st, wy = uy / ul * st, wz = side[2] * ct + uz / ul * st;
    const nx = wy * dir[2] - wz * dir[1], ny = wz * dir[0] - wx * dir[2], nz = wx * dir[1] - wy * dir[0];
    const rf = ruf * Math.sin(t * 9 + k) * (i ? 1 : 0), c = 0.78 + 0.4 * t, f = lerp(sw0, sw1, t);
    b.v(q[0] - wx * w + nx * rf, q[1] - wy * w + ny * rf, q[2] - wz * w + nz * rf, 0, 1, 0, col[0] * c, col[1] * c, col[2] * c, f, 1);
    b.v(q[0] + wx * w + nx * rf, q[1] + wy * w + ny * rf, q[2] + wz * w + nz * rf, 0, 1, 0, col[0] * c, col[1] * c, col[2] * c, f, 1);
    dir = nrm([dir[0], dir[1] - droop * (0.6 + 0.8 * rng()), dir[2]]);
    const stp = Lb / segs;
    q = [q[0] + dir[0] * stp, q[1] + dir[1] * stp, q[2] + dir[2] * stp];
  }
  const i0 = b.I.length;
  for (let i = 0; i < segs; i++) { const a = v0 + i * 2; b.t(a, a + 2, a + 1); b.t(a + 1, a + 2, a + 3); }
  b.smooth(v0, i0);
}
// holdfast: a low dome of tangled haptera with root-like haptera splaying onto the rock (base at y = 0)
function holdfast(b, rng, seed, R, H, col, n, lo) {
  b.blob(lo ? 1 : 2, (x, y, z, o) => {
    const d = 1 + 0.35 * vn3(x * 4 + seed, y * 4, z * 4, seed) + 0.25 * Math.max(0, vn3(x * 9, y * 9, z * 9, seed + 2));
    o[0] = x * R * d; o[1] = 0.012 + Math.max(0, y) * H * d; o[2] = z * R * d;
    const c = 0.5 + 0.3 * vn3(x * 9, y * 9, z * 9, seed + 1); o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[6] = 0; o[7] = 1;
  });
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rng() * 0.6, ca = Math.cos(a), sa = Math.sin(a), r1 = R * (0.5 + 0.3 * rng()), r2 = R * (1.15 + 0.35 * rng());
    b.tube([[ca * r1, H * 0.45, sa * r1], [ca * (r1 + r2) / 2, H * 0.3, sa * (r1 + r2) / 2], [ca * r2, 0.012, sa * r2]], [0.016 * R / 0.25, 0.013 * R / 0.25, 0.011 * R / 0.25], 3,
      (v, an, x, y, z, o) => { o[3] = col[0] * 0.55; o[4] = col[1] * 0.55; o[5] = col[2] * 0.55; o[6] = 0; o[7] = 1; });
  }
}
// horizontal reach of a plant below its canopy (for the lens test)
function reachLow(t, H) { let r = 0; for (let i = 0; i < t.vc; i++) if (t.pos[i * 3 + 1] < H * 0.8) r = Math.max(r, Math.hypot(t.pos[i * 3], t.pos[i * 3 + 2])); return r; }

// Giant kelp (Macrocystis pyrifera), height H to the surface. cur: the current's heading (canopy streams that way).
export function* giantKelp(seed, H, { tier = 'high', far = false, cur = 0 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 7717 + 3), lo = tier === 'low' || far;
  const age = rng(), amp = 0.75 * Math.min(1, H / 10) + 0.2, swAt = (y) => amp * Math.pow(sat(y / H), 1.3);
  const hue = [0.88 + rng() * 0.24, 0.86 + rng() * 0.24, 0.7 + rng() * 0.5];
  const hr = 0.14 + age * 0.2, hh = hr * (0.5 + 0.35 * rng());
  holdfast(b, rng, seed, hr, hh, STIPE, lo ? 5 : 8, lo);
  const nSt = lo ? 2 + ((rng() * 3) | 0) : 3 + ((rng() * (1.5 + age * 5)) | 0);
  let nbl = 0;
  for (let k = 0; k < nSt; k++) {
    const reach = rng() < 0.15 + 0.35 * (1 - age) ? 0.35 + rng() * 0.5 : 1; // young stipes stop short
    const top = reach < 1 ? H * reach : H - 0.04 - rng() * 0.08;
    const la = rng() * TAU, lean = rng() * 0.12, cf = 0.25 + rng() * 0.5, ca = 0.05 + rng() * 0.22, ph1 = rng() * 10, ph2 = rng() * 10;
    let p = [(rng() - 0.5) * hr * 0.8, hh * 0.6, (rng() - 0.5) * hr * 0.8];
    const pts = [p], step = lo ? 1.1 : 0.55 + rng() * 0.25;
    while (p[1] < top - step) {
      const y = p[1] + step * (0.8 + 0.4 * rng());
      p = [p[0] + (ca * Math.sin(y * cf + ph1) + Math.cos(la) * lean) * step, y, p[2] + (ca * Math.sin(y * cf * 0.9 + ph2) + Math.sin(la) * lean) * step];
      pts.push(p);
    }
    const nTop = pts.length;
    if (reach === 1) { // the frond turns and runs 3-7 m along the surface, downcurrent
      const lc = lo ? 2.5 + rng() * 2 : 3 + rng() * 4, a = cur + (rng() - 0.5) * 1.3, nc = lo ? 3 : 6 + ((rng() * 3) | 0);
      for (let i = 1; i <= nc; i++) { p = [p[0] + Math.cos(a) * lc / nc + (rng() - 0.5) * 0.3, top + 0.03 * Math.sin(i * 1.7 + ph1), p[2] + Math.sin(a) * lc / nc + (rng() - 0.5) * 0.3]; pts.push(p); }
    }
    const r0 = (lo ? 0.03 : 0.014 + 0.008 * age) * (0.85 + 0.3 * rng());
    b.tube(pts, pts.map((q, i) => r0 * (1 - 0.35 * i / pts.length)), lo ? 3 : 4, (v, a, x, y, z, o) => {
      const c = 0.72 + 0.35 * sat(y / H); o[3] = STIPE[0] * c * hue[0]; o[4] = STIPE[1] * c * hue[1]; o[5] = STIPE[2] * c * hue[2]; o[6] = swAt(Math.min(y, H)); o[7] = 1;
    });
    let acc = 0.3 + rng() * 0.4, az = rng() * TAU;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      acc -= seg;
      while (acc <= 0) {
        if (++nbl % 14 === 0) yield;
        const canopy = i >= nTop;
        acc += (lo ? 0.75 : canopy ? 0.16 : 0.26) + Math.pow(rng(), 2) * (lo ? 1.0 : 0.35);
        az += Math.PI + (rng() - 0.5) * 1.2;
        if (rng() < 0.05 + 0.2 * age) continue; // a lost blade
        const t = rng(), q = [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t), lerp(pts[i - 1][2], pts[i][2], t)];
        const room = sat((H - 0.15 - q[1]) / 0.9), up = canopy ? -0.02 - rng() * 0.12 : (0.35 + rng() * 0.75) * room - 0.25 * (1 - room), d = nrm([Math.cos(az), up, Math.sin(az)]);
        const sw = swAt(Math.min(q[1], H)), bl = 0.028 + rng() * 0.02;
        if (!lo && nbl % 2 === 0) bladder(b, [q[0] + d[0] * 0.03, q[1] + d[1] * 0.03, q[2] + d[2] * 0.03], bl, [STIPE[0] * 1.6, STIPE[1] * 1.55, STIPE[2] * 1.3], sw);
        const young = 1 - 0.3 * (1 - age) * (1 - q[1] / H), Lb = (canopy ? 0.95 : 0.7) * (0.7 + rng() * 0.6) * young + (lo ? 0.3 : 0);
        const W = (lo ? 0.15 : 0.1) * (0.75 + rng() * 0.55), hb = 0.85 + rng() * 0.3, gb = rng() * 0.15;
        blade(b, rng, [q[0] + d[0] * (0.03 + bl), q[1] + d[1] * (0.03 + bl), q[2] + d[2] * (0.03 + bl)], d, Lb, W, sw, sw + 0.1 + rng() * 0.12,
          canopy ? 0.01 + rng() * 0.03 : 0.07 + rng() * 0.12, [BLADE[0] * hue[0] * hb * (1 - gb), BLADE[1] * hue[1] * hb, BLADE[2] * hue[2] * hb * (1 + gb)], lo ? 2 : 3, canopy);
      }
    }
    yield;
  }
  b.band = 0.03;
  const t = b.build();
  // the canopy must stay at the surface: nothing above H
  if (t.maxY > H + 0.02) { const k = H / t.maxY; for (let i = 1; i < t.pos.length; i += 3) if (t.pos[i] > H * 0.9) t.pos[i] = H * 0.9 + (t.pos[i] - H * 0.9) * k; t.maxY = H; t.box[4] = H; }
  lab(t, 'Giant kelp', KELP_FACTS[seed % 3]);
  t.solid = false; t.nbH = H; t.rLow = reachLow(t, H);
  return t;
}

// Bull kelp (Nereocystis luetkeana): a whip-thin stipe flaring into one float at the surface, with a mane of
// long strap blades streaming downcurrent along the surface.
export function* bullKelp(seed, H, { tier = 'high', cur = 0 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 3301 + 9), lo = tier === 'low';
  const amp = 0.6 * Math.min(1, H / 8) + 0.2, swAt = (y) => amp * Math.pow(sat(y / H), 1.2);
  holdfast(b, rng, seed, 0.07 + rng() * 0.04, 0.05, STIPE, lo ? 4 : 6, true);
  const lean = 0.08 + rng() * 0.18, la = cur + Math.PI + (rng() - 0.5) * 0.8, fr = 0.045 + rng() * 0.03, n = lo ? 10 : 18, pts = [], rad = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = 0.04 + t * (H - 0.04 - fr * 1.6);
    pts.push([Math.cos(la) * lean * t * t * H + 0.04 * Math.sin(t * 7 + seed), y, Math.sin(la) * lean * t * t * H + 0.04 * Math.cos(t * 6 + seed)]);
    rad.push(t < 0.65 ? 0.006 + 0.006 * t : 0.01 + (fr * 0.55 - 0.01) * sstep(0.65, 1, t));
  }
  b.tube(pts, rad, lo ? 3 : 5, (v, a, x, y, z, o) => { const c = 0.7 + 0.4 * v; o[3] = STIPE[0] * c; o[4] = STIPE[1] * c; o[5] = STIPE[2] * c; o[6] = swAt(y); o[7] = 1; });
  const top = pts[n], fc = [top[0], H - fr, top[2]];
  b.blob(lo ? 1 : 2, (x, y, z, o) => { o[0] = fc[0] + x * fr; o[1] = fc[1] + y * fr * 0.92; o[2] = fc[2] + z * fr; const c = 0.85 + 0.25 * y; o[3] = 0.42 * c; o[4] = 0.3 * c; o[5] = 0.1 * c; o[6] = swAt(H); o[7] = 1; });
  yield;
  const nb = lo ? 10 + ((rng() * 6) | 0) : 18 + ((rng() * 22) | 0);
  for (let k = 0; k < nb; k++) { // the mane: 1-4 m straps, mostly downcurrent, lying just under the surface
    const a = cur + (rng() - 0.5) * 1.1, Lb = 1.0 + rng() * rng() * 3.2, W = 0.04 + rng() * 0.05, segs = lo ? 3 : 6, rf = rng() * 10;
    const d = [Math.cos(a), 0, Math.sin(a)], s = [-d[2], 0, d[0]], v0 = b.vc, c0 = 0.85 + rng() * 0.3, y0 = H - fr * 0.4;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, w = W * (i === segs ? 0.35 : 1 - 0.3 * t), dist = 0.05 + t * Lb, wv = 0.12 * Math.sin(t * 5 + rf) * t;
      const cx = fc[0] + d[0] * dist + s[0] * wv, cz = fc[2] + d[2] * dist + s[2] * wv, cy = Math.min(H - 0.02, y0 - 0.06 * t - 0.25 * t * t * (0.3 + rng() * 0.7));
      const c = c0 * (0.8 + 0.4 * t), sw = swAt(H) + 0.35 * t;
      b.v(cx - s[0] * w, cy, cz - s[2] * w, 0, 1, 0, BLADE[0] * c, BLADE[1] * c, BLADE[2] * c * 0.9, sw, 1);
      b.v(cx + s[0] * w, cy + 0.01 * Math.sin(t * 13 + rf), cz + s[2] * w, 0, 1, 0, BLADE[0] * c, BLADE[1] * c, BLADE[2] * c * 0.9, sw, 1);
    }
    for (let i = 0; i < segs; i++) { const q = v0 + i * 2; b.t(q, q + 2, q + 1); b.t(q + 1, q + 2, q + 3); }
  }
  b.band = 0.03;
  const t = b.build();
  lab(t, 'Bull kelp', BULL_FACTS[seed % 2]);
  t.solid = false; t.nbH = H; t.rLow = reachLow(t, H);
  return t;
}

// ---------------------------------------------------------------- reef life
// Strawberry anemones (Corynactis californica): a clone carpet of small polyps, each with a ring of white-tipped,
// knobbed tentacles. Neutral pink body: the instance tint gives the colony its colour (clones share it).
function corynactis(seed, { n = 40, R = 0.22 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 911 + 7), base = [];
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = R * Math.sqrt(rng()), x = Math.cos(a) * d, z = Math.sin(a) * d;
    const r = 0.007 + rng() * 0.006, h = r * (0.8 + rng() * 0.8), col = [0.95, 0.42 + rng() * 0.12, 0.5 + rng() * 0.1];
    b.blob(0, (px, py, pz, o) => { // a short, closed column with a domed oral disc
      o[0] = x + px * r * (1 + 0.15 * py); o[1] = py < -0.3 ? -0.004 : (py + 0.3) / 1.3 * h + 0.2 * h * Math.max(0, py); o[2] = z + pz * r * (1 + 0.15 * py);
      o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0; o[7] = sat(py * 0.5 + 0.5) * 0.9;
    });
    const nt = 4 + ((rng() * 2) | 0);
    for (let q = 0; q < nt; q++) { // knobbed tentacle tips (tetrahedra), white
      const ta = (q / nt) * TAU + rng() * 0.3, tr = r * 1.15, c = [x + Math.cos(ta) * tr, h + r * 0.2, z + Math.sin(ta) * tr], s = r * 0.42, v0 = b.vc;
      for (const dd of [[0, 1, 0], [0.94, -0.33, 0], [-0.47, -0.33, 0.82], [-0.47, -0.33, -0.82]]) b.v(c[0] + dd[0] * s, c[1] + dd[1] * s, c[2] + dd[2] * s, dd[0], dd[1], dd[2], 1.25, 1.2, 1.2, 0, 1.95);
      b.t(v0, v0 + 1, v0 + 2); b.t(v0, v0 + 2, v0 + 3); b.t(v0, v0 + 3, v0 + 1); b.t(v0 + 1, v0 + 3, v0 + 2);
    }
    base.push(x, -0.004, z);
  }
  const t = b.build();
  setBase(t, base.length > 36 ? base.slice(0, 36) : base);
  t.nbR = R; t.solid = false;
  return lab(t, 'Strawberry anemones', 'Strawberry anemones are corallimorphs that clone themselves into vivid carpets of identical polyps.');
}
// Red abalone (Haliotis rufescens): an ear-shaped shell with a row of breathing holes, crusted brick red, the
// black-fringed foot clamped to the rock.
function abalone(seed) {
  const b = new Builder(), rng = mulberry32(seed * 577 + 1), Ls = 0.16 + rng() * 0.08, W = Ls * (0.7 + rng() * 0.08), Hs = Ls * (0.22 + rng() * 0.06);
  const ax = -Ls * 0.28, az = -W * 0.18; // apex of the spire, toward one end and one side
  b.blob(2, (x, y, z, o) => {
    const px = x * Ls / 2, pz = z * W / 2, d = Math.hypot((px - ax) / Ls, (pz - az) / W), hump = Math.max(0, 1 - d * 1.5);
    const rough = 1 + 0.08 * vn3(x * 7 + seed, y * 7, z * 7, seed);
    o[0] = px * rough; o[2] = pz * rough; o[1] = y > 0 ? 0.012 + y * Hs * (0.45 + 0.75 * hump) : 0.012 + y * 0.01;
    const n = 0.7 + 0.45 * vn3(x * 5, y * 5, z * 5, seed + 3), grow = sstep(0.1, 0.5, vn3(x * 3 + 4, y * 3, z * 3, seed + 5));
    o[3] = lerp(0.42, 0.62, grow) * n; o[4] = lerp(0.12, 0.42, grow) * n; o[5] = lerp(0.08, 0.36, grow) * n; o[6] = 0.3; o[7] = 2;
  });
  for (let k = 0; k < 4 + ((rng() * 3) | 0); k++) { // the respiratory holes: dark pits ringed by raised rims along the left margin
    const t = 0.2 + k * 0.13, px = lerp(Ls * 0.42, -Ls * 0.2, t), pz = W * 0.32 * Math.sin(Math.PI * (0.3 + t * 0.6)), r = Ls * 0.026;
    const ux = px / (Ls / 2), uz = pz / (W / 2), hump = Math.max(0, 1 - Math.hypot((px - ax) / Ls, (pz - az) / W) * 1.5);
    const ys = 0.012 + Math.sqrt(Math.max(0, 1 - ux * ux - uz * uz)) * Hs * (0.45 + 0.75 * hump) - 0.006; // the shell surface there, rim sunk 6 mm
    b.lathe(6, 2, (v) => [r * (1.4 - 0.9 * v), ys + v * r * 0.6], null, (v, an, x, y, z, o) => { const c = v > 0.6 ? 0.06 : 0.38; o[3] = c; o[4] = c * 0.5; o[5] = c * 0.4; o[6] = 0; o[7] = 2; }, {});
    const v1 = b.vc - 18;
    for (let i = v1; i < b.vc; i++) { b.P[i * 3] += px; b.P[i * 3 + 2] += pz; }
  }
  const nf = 16, base = [];
  for (let k = 0; k < nf; k++) { // epipodium: the black tentacled fringe of the foot, peeking out under the shell
    const a = (k / nf) * TAU, cx = Math.cos(a) * Ls * 0.48, cz = Math.sin(a) * W * 0.48, ex = Math.cos(a) * Ls * 0.58, ez = Math.sin(a) * W * 0.58;
    b.tube([[cx, 0.006, cz], [ex, 0.004 + rng() * 0.006, ez]], [0.006, 0.002], 3, (v, an, x, y, z, o) => { o[3] = 0.05; o[4] = 0.06; o[5] = 0.04; o[6] = 0; o[7] = 2; }, { tip: true });
    if (k % 2 === 0) base.push(cx, 0, cz);
  }
  const t = b.build();
  setBase(t, base);
  return lab(t, 'Red abalone', 'Abalone breathe through the row of holes along their shell; sea otters crack them open with rocks.');
}
// drift kelp: torn blades and a stipe piece lying on the floor (draped patch)
function driftKelp(seed) {
  const b = new Builder(), rng = mulberry32(seed * 241 + 5), n = 4 + ((rng() * 6) | 0);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, cx = (rng() - 0.5) * 0.8, cz = (rng() - 0.5) * 0.8, Lb = 0.4 + rng() * 0.7, W = 0.05 + rng() * 0.05, d = [Math.cos(a), 0, Math.sin(a)], s = [-d[2], 0, d[0]], v0 = b.vc, c = 0.55 + rng() * 0.4;
    for (let i = 0; i <= 3; i++) { const t = i / 3, w = W * (i === 3 ? 0.4 : 1), y = 0.004 + 0.012 * Math.sin(t * 6 + k) ** 2; for (const sd of [-1, 1]) b.v(cx + d[0] * Lb * t + s[0] * w * sd, y + 0.004 * sd, cz + d[2] * Lb * t + s[2] * w * sd, 0, 1, 0, BLADE[0] * c, BLADE[1] * c * 0.9, BLADE[2] * c * 0.7, 0, 0); }
    for (let i = 0; i < 3; i++) { const q = v0 + i * 2; b.t(q, q + 2, q + 1); b.t(q + 1, q + 2, q + 3); }
  }
  const t = b.build();
  t.drape = true; t.dLift = 0.01; t.solid = false;
  return lab(t, 'Drift kelp', 'Torn kelp feeds the deep: drifting fronds sink and nourish animals far below the forest.');
}

// ---------------------------------------------------------------- templates, providers, recipe
const OK_ROCKS = [{ r: 'boulder', litho: 'granite', growth: 1 }, { r: 'boulder', litho: 'diorite', kind: 'angular', growth: 1 }, { r: 'cracked', litho: 'slate', growth: 1 },
  { r: 'conglomerate', growth: 1 }, { r: 'boulder', litho: 'basalt', kind: 'block', growth: 1 }, { r: 'boulder', litho: 'granite', kind: 'tafoni', growth: 1 }, { r: 'boulder', litho: 'sandstone', growth: 1 }];
const OK_COBBLE = [{ r: 'boulder', litho: 'granite', detail: 2, growth: 1 }, { r: 'boulder', litho: 'diorite', kind: 'angular', detail: 2, growth: 1 }, { r: 'boulder', litho: 'basalt', kind: 'block', detail: 2, growth: 1 }, { r: 'boulder', litho: 'sandstone', detail: 2, growth: 1 }, { r: 'boulder', litho: 'greenstone', kind: 'angular', detail: 2, growth: 1 }];
const OK_SLAB = [{ r: 'cracked', litho: 'slate', growth: 0.25 }, { r: 'cracked', litho: 'sandstone', growth: 0.25 }, { r: 'boulder', litho: 'granite', kind: 'block', growth: 0.25 }]; // big and flat: little growth (CLAUDE.md)
const OK_BIG = [{ r: 'pile', lithos: ['granite', 'diorite', 'basalt'], big: true, growth: 1 }, { r: 'columnar', big: true, growth: 1 }, { r: 'pile', lithos: ['sandstone', 'slate'], big: true, growth: 1 }, { r: 'conglomerate', detail: 4, big: true, growth: 1 }];
export const recipeOf = (g) => recipe(g, 'nb4ok', (g) => {
  const u = (k) => sv(g, 400 + k);
  const mix = u(0); // giant-kelp forest .. bull-kelp bed
  return {
    giant: mix < 0.75 ? 0.75 + 0.6 * u(1) : 0.25 + 0.3 * u(1), bull: mix > 0.55 ? 0.6 + 0.6 * u(2) : 0.15 + 0.25 * u(2),
    cur: u(3) * TAU, rocks: 0.6 + 0.8 * u(4), urchins: 0.4 + 1.1 * u(5), stars: 0.5 + 0.9 * u(6), straw: 0.4 + 1.0 * u(7), abalone: 0.3 + 0.9 * u(8),
    shore: sv(g, 1) < 0.5 ? -1 : 1, hue: [0.92 + 0.16 * u(9), 0.9 + 0.2 * u(10), 0.85 + 0.3 * u(11)],
    strawPal: [L(0xff4a6a), L(0xff6a8a), L(0xe8304a), L(0xff8a5a), L(0xd060c0), L(0xff9ab0)].filter((_, i) => u(20 + i) > 0.4),
  };
});
export function initOtter(tier) {
  O.kelp = [3, 5, 7, 9].map((H, i) => drain(giantKelp(4100 + i * 7, H, { tier })));
  O.kelpFar = [3, 5.5, 8, 10.5].map((H, i) => drain(giantKelp(4120 + i * 7, H, { tier, far: true })));
  O.bull = [3, 6].map((H, i) => drain(bullKelp(4200 + i * 5, H, { tier })));
  O.rock = [0, 1, 2].map((i) => drain(rockJob(tiered(OK_ROCKS[i], tier), 4300 + i * 11)));
  O.big = [drain(rockJob(tiered(OK_BIG[0], tier), 4350))];
  for (const t of [...O.rock, ...O.big]) warmTpl(t); // contact grids for decorations
  O.purple = [0, 1, 2, 3].map((i) => urchin(4400 + i, { spines: 44 + i * 6, len: 0.75 + i * 0.1, body: [0.2, 0.05, 0.24] }));
  O.red = [0, 1, 2].map((i) => urchin(4410 + i, { spines: 44 + i * 6, len: 1.55 + i * 0.15, body: [0.3, 0.03, 0.04] }));
  lab(O.purple, 'Purple sea urchin', 'Without sea otters to eat them, purple urchins multiply and mow kelp forests down to bare barrens.');
  lab(O.red, 'Red sea urchin', 'Red sea urchins can live for more than 100 years; juvenile urchins shelter under their spines.');
  O.star = [0, 1, 2, 3, 4].map((i) => seastar(4420 + i, { arms: 5, fat: 1.5 + i * 0.12, curl: 0.04 + i * 0.03, thin: 1.25 + 0.1 * (i % 3), detail: 2 }));
  lab(O.star, 'Ochre sea star', 'The ochre star was the first "keystone species": remove it and the whole shore community changes.');
  O.straw = [0, 1, 2, 3].map((i) => corynactis(4430 + i, { n: tier === 'low' ? 14 + i * 4 : 22 + i * 7, R: 0.14 + i * 0.06 }));
  O.crust = [0, 1, 2, 3, 4].map((i) => encrust(4440 + i, { r: 0.12 + i * 0.04, h: 0.012 + (i % 2) * 0.008, lobes: 0.6, detail: 2, elong: 1 + (i % 3) * 0.3 }));
  for (const t of O.crust) { t.solid = false; lab(t, 'Coralline algae crust', 'Pink crusts on the rocks are coralline algae: seaweeds that build skeletons of limestone.'); }
  O.abalone = [0, 1, 2, 3].map((i) => abalone(4450 + i));
  O.drift = [0, 1, 2].map((i) => driftKelp(4460 + i));
  O.turf = [0, 1, 2, 3].map((i) => { const t = tuft(4470 + i, { h: 0.06 + i * 0.02, depth: 3 }); t.solid = false; return lab(t, 'Coralline turf', 'Jointed coralline algae: stony segments linked by flexible hinges, so they bend in the surge.'); });
  O.slab = [drain(rockJob(tiered(OK_SLAB[0], tier), 4360))];
  O.field = [0, 1, 2].map((i) => drain(rockJob(OK_COBBLE[i], 4365 + i)));
  for (const t of O.slab) warmTpl(t);
  O.palm = [0, 1, 2].map((i) => lab(seaPalm(4490 + i), 'Stalked kelp (Pterygophora)', 'This understory kelp stands on a woody stalk and can live for more than 20 years, growing a ring a year like a tree.'));
  O.cobble = [0, 1, 2].map((i) => { const t = pebblePatch(4495 + i, { n: 9 + i * 4, r: 0.55 + i * 0.15, size: 0.11 + i * 0.03, flat: 0.55, col: [0.5, 0.48, 0.45], growth: 0.8, mode: 6.3 + i * 0.2 }); t.solid = false; return lab(t, 'Cobbles', 'Storm waves roll cobbles smooth; on a rocky reef every stone carries its own crust of life.'); });
  O.hash = [0, 1].map((i) => { const t = pebblePatch(4480 + i, { n: 20, r: 0.45, size: 0.035, flat: 0.25, col: [0.9, 0.86, 0.8], growth: 0, mode: 2 }); t.solid = false; return lab(t, 'Shell hash', 'Broken shells of mussels, snails and urchins, sorted by the surge into pale drifts.'); });
  return O;
}
export function otterProviders(provide) {
  // kelp plants per segment at heights spread over the depths the segment's floor offers (2.6-11 m)
  provide(KEY, 'nb4okKelp', 10, (seg, k, tier) => giantKelp(segSeed(seg, k, 0x2545f491), 2.6 + k * 0.95 + q01(seg.seed, k) * 0.5, { tier, cur: recipeOf(seg).cur }), 2);
  provide(KEY, 'nb4okKelpFar', 6, (seg, k, tier) => giantKelp(segSeed(seg, k, 0x3c6ef372), 2.6 + k * 1.6 + q01(seg.seed, k + 5) * 0.6, { tier, far: true, cur: recipeOf(seg).cur }), 2);
  provide(KEY, 'nb4okBull', 6, (seg, k, tier) => bullKelp(segSeed(seg, k, 0x6c078965), 2.6 + k * 1.5 + q01(seg.seed, k + 3) * 0.8, { tier, cur: recipeOf(seg).cur }), 2);
  provide(KEY, 'nb4okRock', 8, (seg, k, tier) => gridded(rockJob(tiered(OK_ROCKS[(k + (seg.seed >>> 5)) % OK_ROCKS.length], tier), segSeed(seg, k, 0x7feb352d))), 2);
  provide(KEY, 'nb4okBig', 3, (seg, k, tier) => gridded(rockJob(tiered(OK_BIG[(k + (seg.seed >>> 7)) % OK_BIG.length], tier), segSeed(seg, k, 0x165667b1))), 2);
  // low-poly boulders (~80 triangles) for the boulder field between the big rocks
  provide(KEY, 'nb4okCobble', 6, (seg, k) => rockJob(OK_COBBLE[(k + (seg.seed >>> 11)) % OK_COBBLE.length], segSeed(seg, k, 0x5bd1e995)), 2);
  provide(KEY, 'nb4okSlab', 3, (seg, k, tier) => gridded(rockJob(tiered(OK_SLAB[(k + (seg.seed >>> 9)) % OK_SLAB.length], tier), segSeed(seg, k, 0x61c88647))), 2);
  provide(KEY, 'nb4okPalm', 4, (seg, k) => once(() => lab(seaPalm(segSeed(seg, k, 0x9e3779b1) % 100000), 'Stalked kelp (Pterygophora)', 'This understory kelp stands on a woody stalk and can live for more than 20 years, growing a ring a year like a tree.'))(), 3);
  provide(KEY, 'nb4okStraw', 3, (seg, k, tier) => once(() => corynactis(segSeed(seg, k, 0x27d4eb2f), { n: tier === 'low' ? 16 : 22 + k * 9, R: 0.15 + k * 0.07 }))(), 3);
}

// ---------------------------------------------------------------- plan: rocks
// shore-ward distance t (> 0 toward the shallows) and a density factor that grows toward the shore
const shoreT = (ctx, pc, rc, x, s) => (x - pc.x(s)) * rc.shore;
const shoreK = (t) => 0.55 + 0.9 * sstep(-20, 35, t);
const PL = planned(function* (ctx) {
  const Y = slice(2.5), out = { rocks: [], sp: new Space() };
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return out;
  const rng = chunkRng(ctx, 0x07e1), fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), rc0 = recipeOf(g0);
  // outcrops: piles of big boulders and columnar basalt, off the path (they appear dead ahead on bends)
  const nBig = Math.floor((1.5 + rng() * 3) * rc0.rocks * bk);
  for (let k = 0, n = 0; k < nBig * 4 && n < nBig; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 4 + rng() * (CHUNK - 8), g = segFor(ctx, s, KEY);
    if (!g || ctx.weightOf(s, KEY) < 0.5) continue;
    const side = rng() < 0.5 ? -1 : 1, x = pc.x(s) + side * (6 + Math.pow(rng(), 1.3) * 26), tpl = pick(rng, poolOf(g, 'nb4okBig', O.big, 1)), sc = 1.0 + rng() * 1.0, r = tpl.r * sc * 0.9;
    if (!out.sp.free(x, s, r, 0.5)) continue;
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.4), rng() * TAU), P = [x, fs.at(x, s), s], sy = sc * (0.75 + rng() * 0.45);
    seat(fs, tpl, R, sc, sy, sc, P, null, 0.08 + (tpl.maxY - tpl.minY) * sy * 0.12);
    if (P[1] + tpl.maxY * sy > ctx.surfaceY - 1.2) continue;
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) continue;
    out.sp.add(P[0], P[2], r);
    out.rocks.push({ tpl, x: P[0], y: P[1], s: P[2], R, sc, sy, g, big: true });
    n++;
  }
  // reef slabs: low, flat ledges of bedrock (they may lie under the route: their tops stay well below it)
  const nSl = Math.round((6 + rng() * 5) * rc0.rocks * bk);
  for (let k = 0, n = 0; k < nSl * 4 && n < nSl; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 3 + rng() * (CHUNK - 6), g = segFor(ctx, s, KEY);
    if (!g || ctx.weightOf(s, KEY) < 0.5) continue;
    const x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * Math.pow(rng(), 1.2) * 26, tpl = pick(rng, poolOf(g, 'nb4okSlab', O.slab, 1)), sc = 1.4 + rng() * 1.6, sy = sc * (0.3 + rng() * 0.3), r = tpl.r * sc * 0.8;
    if (!out.sp.free(x, s, r, 0.3)) continue;
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.85), rng() * TAU), P = [x, fs.at(x, s), s];
    seat(fs, tpl, R, sc, sy, sc, P, null, 0.06 + (tpl.maxY - tpl.minY) * sy * 0.25);
    if (P[1] + tpl.maxY * sy > ctx.surfaceY - 1.2 || !clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) continue;
    out.sp.add(P[0], P[2], r);
    out.rocks.push({ tpl, x: P[0], y: P[1], s: P[2], R, sc, sy, g, slab: true });
    n++;
  }
  // boulders: in clusters, more on the shore side
  const nR = Math.round((40 + rng() * 22) * rc0.rocks * bk) + out.rocks.length;
  let cx = 0, cs = 0, left = 0;
  for (let k = 0; k < nR * 4 && out.rocks.length < nR + nBig; k++) {
    if (Y.over()) { yield; Y.reset(); }
    if (left <= 0) { cs = ctx.s0 + rng() * CHUNK; cx = pc.x(cs) + (rng() < 0.5 ? -1 : 1) * (1 + Math.pow(rng(), 1.3) * 30); left = 4 + ((rng() * 7) | 0); }
    left--;
    const s = cs + (rng() - 0.5) * 8, x = cx + (rng() - 0.5) * 8, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const rc = recipeOf(g);
    if (rng() > ctx.weightOf(s, KEY) * shoreK(shoreT(ctx, pc, rc, x, s)) * 0.85) continue;
    const tpl = pick(rng, poolOf(g, 'nb4okRock', O.rock, 2)), sc = 0.3 + Math.pow(rng(), 1.4) * 1.3, r = tpl.r * sc * 0.85;
    if (!out.sp.free(x, s, r, 0.1) || fs.at(x, s) > ctx.surfaceY - 1.0) continue;
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.6), rng() * TAU), P = [x, fs.at(x, s), s], sy = sc * (0.65 + rng() * 0.5);
    seat(fs, tpl, R, sc, sy, sc, P, null, 0.04 + (tpl.maxY - tpl.minY) * sy * 0.1);
    if (P[1] + tpl.maxY * sy > ctx.surfaceY - 0.8) continue;
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) continue;
    out.sp.add(P[0], P[2], r);
    out.rocks.push({ tpl, x: P[0], y: P[1], s: P[2], R, sc, sy, g });
  }
  return out;
});
const plan = (ctx) => PL.get(ctx);
export function layoutOkP(ctx) { return presence(ctx, KEY) > 0 ? PL.stage(ctx) : null; }

// ---------------------------------------------------------------- chain A: rocks, kelp, bull kelp, canopy
// best template of a height pool for depth D: vertical scale within +-15 %
function byDepth(rng, list, D) {
  let best = null, bd = 1e9;
  for (const t of list) { const k = D / t.nbH; if (k < 0.85 || k > 1.18) continue; const d = Math.abs(Math.log(k)) + rng() * 0.08; if (d < bd) { bd = d; best = t; } }
  return best;
}
export function* layoutOkA(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), pc = pathCache(ctx), fs = nbFloor(ctx), surf = ctx.surfaceY;
  const rng = chunkRng(ctx, 0x07e2), g0 = segFor(ctx, ctx.s0 + 32, KEY), rc0 = recipeOf(g0);
  const st = new Batch(MAT.static, 60000 * bk);
  const kb = new Batch(MAT.sway, (ctx.tier === 'low' ? 48000 : 84000) * bk); kb.soft = true; kb.lod = 'mid'; kb.jobVerts = 8000; // (non-uniform scales: normals renormalised)
  const labels = [], pois = [];
  for (const R0 of P.rocks) {
    if (Y.over()) { yield; Y.reset(); }
    const t = R0.big ? 0.95 : 0.9 + rng() * 0.15;
    if (put(ctx, st, R0.tpl, R0.x, R0.y, R0.s, R0.R, R0.sc, R0.sy, R0.sc, [t * rc0.hue[0] * 0.95, t * 0.95, t * rc0.hue[2] * 0.95], 1, 'floor')) R0.item = st.last;
  }
  yield;
  // kelp: holdfasts on the floor and on rock tops; densest in groves and toward the shore
  const sp = new Space(), canopy = [];
  for (const R0 of P.rocks) sp.add(R0.x, R0.s, R0.tpl.r * R0.sc * 0.8);
  const place = (tpl, x, y0, s, sup, isBull, R, sx) => {
    const D = surf - (isBull ? 0.03 : 0.08) - y0, sy = D / tpl.nbH;
    if (sy < 0.82 || sy > 1.22 || !clearBox(pc, x, s, y0, y0 + D * 0.85, tpl.rLow * sx + 0.15, SOFT)) return false;
    const c = 0.85 + rng() * 0.3;
    if (!put(ctx, kb, tpl, x, y0, s, R, sx, sy, sx, [c * rc0.hue[0], c * rc0.hue[1], c * rc0.hue[2]], 1, sup)) return false;
    if (!isBull) canopy.push([x, s, 2.5 + rng() * 2]);
    return true;
  };
  const nK = Math.round(78 * rc0.giant * bk * lk), nB = Math.round(26 * rc0.bull * bk * lk);
  for (const isBull of [false, true]) {
    const want = isBull ? nB : nK;
    for (let k = 0, n = 0; k < want * 4 && n < want; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
      if (!g) continue;
      const rc = recipeOf(g), x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * Math.pow(rng(), 1.15) * 44;
      const grove = 0.45 + 0.55 * sstep(-0.3, 0.4, vn3(x / 22, 0.5, s / 22, 77)), t = shoreT(ctx, pc, rc, x, s);
      if (rng() > ctx.weightOf(s, KEY) * grove * shoreK(t) * (isBull ? 0.5 + 0.5 * sstep(0, 30, t) : 1)) continue;
      if (!sp.free(x, s, isBull ? 0.2 : 0.35)) continue;
      const y0 = fs.at(x, s), D = surf - y0;
      if (D < 2.2) continue;
      const farP = Math.abs(x - pc.x(s)) > 17;
      const tpl = byDepth(rng, isBull ? poolOf(g, 'nb4okBull', O.bull, 2) : farP ? poolOf(g, 'nb4okKelpFar', O.kelpFar, 3) : poolOf(g, 'nb4okKelp', O.kelp, 3), D - 0.06);
      if (!tpl) continue;
      const Pp = [x, y0, s], R = rotY(rng() * TAU), sx = 0.9 + rng() * 0.25;
      seat(fs, tpl, R, sx, 1, sx, Pp, null, 0.025);
      if (place(tpl, Pp[0], Pp[1], Pp[2], 'floor', isBull, R, sx)) { sp.add(x, s, isBull ? 0.25 : 0.45); n++; }
    }
  }
  // holdfasts gripping the tops of boulders (most kelp in a rocky forest grows on rock)
  for (const R0 of P.rocks) {
    if (!R0.item || rng() > 0.55 * rc0.giant) continue;
    if (Y.over()) { yield; Y.reset(); }
    const spots = itemSpots(R0.item, ctx, 16, 0.88); // flat tops only: a holdfast spreads over the rock
    for (let q = 0, n = 0; q < spots.length && n < (R0.big ? 3 : 1); q++) {
      const p = spots[(q * 7 + 3) % spots.length], g = segFor(ctx, p.s, KEY) || g0, D = surf - p.y;
      if (D < 2.2) continue;
      const tpl = byDepth(rng, poolOf(g, 'nb4okKelp', O.kelp, 3), D - 0.08);
      if (!tpl) continue;
      const Rr = rotY(rng() * TAU), sx = 0.9 + rng() * 0.2, Pp = [p.x, p.y, p.s];
      if (!seatOnItem(R0.item, ctx.s0, tpl, Rr, sx, Pp, 0.035) || !grips(R0.item, ctx.s0, tpl, Rr, sx, sx, sx, Pp)) continue;
      if (place(tpl, Pp[0], Pp[1], Pp[2], { item: R0.item }, false, Rr, sx)) n++;
    }
  }
  yield;
  // the floating canopy: a tangled-weed sheet where fronds pile up, 2 m lattice over the chunk
  const CELL = 2, W = 56, xs0 = Math.floor((pc.x(ctx.s0 + 32) - W) / CELL) * CELL, nx = Math.round(2 * W / CELL) + 1, ns = Math.round(CHUNK / CELL) + 1;
  const Dn = new Float32Array(nx * ns);
  for (const [x, s, r] of canopy) {
    const cx = x + Math.cos(rc0.cur) * r * 0.6, cs = s + Math.sin(rc0.cur) * r * 0.6, R = r + 1.5;
    const i0 = Math.max(0, Math.floor((cx - R - xs0) / CELL)), i1 = Math.min(nx - 1, Math.ceil((cx + R - xs0) / CELL));
    const j0 = Math.max(0, Math.floor((cs - R - ctx.s0) / CELL)), j1 = Math.min(ns - 1, Math.ceil((cs + R - ctx.s0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(xs0 + i * CELL - cx, ctx.s0 + j * CELL - cs) / R; if (d < 1) Dn[j * nx + i] += (1 - d * d) * 0.55; }
  }
  const sheet = new Builder(), axis = Math.abs(Math.cos(rc0.cur)) > Math.abs(Math.sin(rc0.cur)) ? 0 : 2;
  for (let layer = 0; layer < 2; layer++) {
    const thr = layer ? 0.75 : 0.35, idx = new Int32Array(nx * ns).fill(-1);
    for (let j = 0; j < ns; j++) for (let i = 0; i < nx; i++) {
      let mx = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj, ii = i + di; if (jj >= 0 && ii >= 0 && jj < ns && ii < nx) mx = Math.max(mx, Dn[jj * nx + ii]); }
      if (mx < thr) continue;
      const x = xs0 + i * CELL, s = ctx.s0 + j * CELL, d = sat(Dn[j * nx + i]), lump = 0.5 + 0.5 * vn3(x * 0.3, layer * 3, s * 0.3, 51);
      const y = surf - (layer ? 0.22 + 0.25 * d * lump : 0.04 + 0.12 * d * lump), k = (layer ? 0.7 : 1) * (0.8 + 0.35 * vn3(x * 0.2, 1, s * 0.2, 53));
      idx[j * nx + i] = sheet.v(x, y, -(s - ctx.s0), 0, -1, 0, BLADE[0] * k * rc0.hue[0], BLADE[1] * k * rc0.hue[1], BLADE[2] * k * rc0.hue[2], sstep(0.15, 1.1, d) * 0.9, layer + axis);
    }
    for (let j = 0; j < ns - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = idx[j * nx + i], b2 = idx[j * nx + i + 1], c2 = idx[(j + 1) * nx + i], d2 = idx[(j + 1) * nx + i + 1];
      if (a >= 0 && b2 >= 0 && c2 >= 0 && d2 >= 0) { sheet.t(a, b2, d2); sheet.t(a, d2, c2); }
    }
    if (Y.over()) { yield; Y.reset(); }
  }
  // the camera director looks up at the thickest canopy near the route (sea otters rest in it)
  const best = [];
  for (let j = 2; j < ns - 2; j += 4) for (let i = 2; i < nx - 2; i += 2) {
    const d = Dn[j * nx + i], x = xs0 + i * CELL, s = ctx.s0 + j * CELL, ad = Math.abs(x - pc.x(s));
    if (d > 0.9 && ad < 22) best.push({ x, s, k: d - ad * 0.03 });
  }
  best.sort((a, b) => b.k - a.k);
  for (const c of best.slice(0, 2)) pois.push({ type: 'kelp-canopy', x: c.x, y: surf - 1.6, s: c.s, r: 4, data: { name: 'Kelp canopy' } });
  if (best.length) labels.push(['Kelp canopy', best[0].x, surf - 0.4, best[0].s, 'Fronds pile up at the surface into a floating canopy; sea otters anchor themselves in it to rest.']);
  const extra = [];
  if (sheet.I.length) { const m = builderMesh(sheet, NB4.mat.canopy, null, 'mid'); m.geometry.boundingSphere.radius += 1; extra.push(m); }
  return { batches: [st, kb], extra, labels, pois };
}

// ---------------------------------------------------------------- chain B: life on the rocks and the floor
export function* layoutOkB(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), pc = pathCache(ctx), fs = nbFloor(ctx);
  const rng = chunkRng(ctx, 0x07e3), g0 = segFor(ctx, ctx.s0 + 32, KEY), rc0 = recipeOf(g0);
  const st = new Batch(MAT.static, 26000 * bk * lk); st.lod = 'near';
  const an = new Batch(NB3.mat.anem, 30000 * bk * lk); an.lod = 'near'; an.soft = true;
  const sw = new Batch(MAT.sway, 20000 * bk * lk); sw.lod = 'mid'; sw.soft = true;
  // two purple and one red urchin template per chunk (each instanced template is a draw call; rotation, scale
  // and tint already make every urchin different)
  const pk = Math.abs((ctx.s0 / 64) | 0), ups = [O.purple[pk % 4], O.purple[(pk + 1 + (pk >> 2) % 3) % 4]].map((t) => new IBatch(t, MAT.static, 260, 'near')), urs = [new IBatch(O.red[pk % 3], MAT.static, 90, 'near')];
  const PURPLE = [[0.95, 0.75, 1.05], [0.8, 0.55, 1.0], [1.05, 0.65, 0.95], [0.7, 0.5, 0.85]], RED = [[1.1, 0.75, 0.75], [0.95, 0.55, 0.5], [1.15, 0.5, 0.35]];
  const OCHRE = [[0.55, 0.14, 0.42], [0.62, 0.18, 0.5], [0.9, 0.42, 0.08], [0.95, 0.55, 0.12], [0.75, 0.25, 0.2]], CRUST = [L(0xd890a8), L(0xc07090), L(0xb06a9a), L(0xe0a0b0)];
  const strawPal = rc0.strawPal.length ? rc0.strawPal : [L(0xff4a6a)];
  const urchinAt = (x, y, s, n, sup) => { // a purple (sometimes red) urchin at (x, y, s), surface normal n
    const red = rng() < 0.18, list = red ? urs : ups, ib = pick(rng, list), t = ib.tpl, sc = red ? 0.035 + rng() * 0.012 : 0.024 + rng() * 0.01;
    const R = upTo(mix3([0, 1, 0], n, 0.85), rng() * TAU), Pp = [x, y, s];
    if (sup === 'floor') seat(fs, t, R, sc, sc, sc, Pp, null, 0.012);
    else if (!seatOnItem(sup.item, ctx.s0, t, R, sc, Pp, 0.012) || !grips(sup.item, ctx.s0, t, R, sc, sc, sc, Pp)) return false;
    return iput(ctx, ib, Pp[0], Pp[1], Pp[2], R, sc, sc * (0.9 + rng() * 0.2), sc, pick(rng, red ? RED : PURPLE), sup);
  };
  // dress every boulder: crusts, strawberry anemones on the flanks, stars, urchins in the cracks, abalone
  for (const R0 of P.rocks) {
    if (!R0.item) continue;
    if (Y.over()) { yield; Y.reset(); }
    const g = R0.g || g0, rc = recipeOf(g), up = itemSpots(R0.item, ctx, 40, 0.55), side = itemSpots(R0.item, ctx, 40, -0.2, (q) => q.n[1] < 0.6);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    shuffle(up); shuffle(side);
    const big = R0.big ? 2.2 : 1, nOn = Math.round((2 + rng() * 5) * big * lk);
    let iu = 0, is = 0;
    for (let k = 0; k < nOn; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const u = rng();
      if (u < 0.3 && iu < up.length) { // coralline crust on the flat of the top
        const p = up[iu++];
        if (p.n[1] < 0.82) continue;
        const tpl = pick(rng, O.crust), sc = 0.7 + rng() * 0.8, R = upTo(mix3([0, 1, 0], p.n, 0.9), rng() * TAU), Pp = [p.x, p.y, p.s];
        const sy = sc * (0.6 + rng() * 0.6);
        if (seatOnItem(R0.item, ctx.s0, tpl, R, sc, Pp, 0.008) && grips(R0.item, ctx.s0, tpl, R, sc, sy, sc, Pp)) put(ctx, st, tpl, Pp[0], Pp[1], Pp[2], R, sc, sy, sc, pick(rng, CRUST), 0.2, { item: R0.item });
      } else if (u < 0.46 && is < side.length) { // strawberry anemones carpeting a flank
        const p = side[is++], tpl = pick(rng, poolOf(g, 'nb4okStraw', O.straw, 2)), sc = 0.7 + rng() * 0.6, R = upTo(p.n, rng() * TAU);
        const at = [p.x, p.y, p.s], ok = pressOn(R0.item, ctx.s0, tpl, R, sc, at, p.n, 0.022) && grips(R0.item, ctx.s0, tpl, R, sc, sc, sc, at);
        if (ok && clearBox(pc, at[0], at[2], at[1] - 0.3, at[1] + 0.3, tpl.nbR * sc, SOFT)) put(ctx, an, tpl, at[0], at[1], at[2], R, sc, sc, sc, pick(rng, strawPal), 0, { item: R0.item });
      } else if (u < 0.7) { // ochre star: on a flank or on top
        const p = rng() < 0.6 && is < side.length ? side[is++] : iu < up.length ? up[iu++] : null;
        if (!p) continue;
        const tpl = pick(rng, O.star), sc = 0.11 + rng() * 0.06, R = upTo(p.n, rng() * TAU), at = [p.x, p.y, p.s], ok = pressOn(R0.item, ctx.s0, tpl, R, sc, at, p.n, 0.015) && grips(R0.item, ctx.s0, tpl, R, sc, sc, sc, at);
        if (ok && rng() < rc.stars) put(ctx, st, tpl, at[0], at[1], at[2], R, sc, sc, sc, pick(rng, OCHRE), 1, { item: R0.item });
      } else if (u < 0.86 && iu < up.length) { // urchins on the top, singly or in pairs
        const p = up[iu++];
        if (rng() < rc.urchins * 0.45) for (let q = 0, m = 1 + ((rng() * 2) | 0); q < m; q++) urchinAt(p.x + (rng() - 0.5) * 0.25, p.y, p.s + (rng() - 0.5) * 0.25, p.n, { item: R0.item });
      } else if (is < side.length) { // abalone clamped to a flank
        const p = side[is++], tpl = pick(rng, O.abalone), sc = 0.85 + rng() * 0.35, R = upTo(p.n, rng() * TAU), at = [p.x, p.y, p.s], ok = pressOn(R0.item, ctx.s0, tpl, R, sc, at, p.n, 0.015) && grips(R0.item, ctx.s0, tpl, R, sc, sc, sc, at);
        if (ok && rng() < rc.abalone) put(ctx, st, tpl, at[0], at[1], at[2], R, sc, sc, sc, [0.9 + rng() * 0.2, 0.9 + rng() * 0.15, 0.9 + rng() * 0.1], 1, { item: R0.item });
      }
    }
  }
  yield;
  // the floor between: a field of low boulders around the route (the reef's rubble), then urchins in loose groups,
  // stars, turf, shell hash, drift kelp, the odd abalone
  const sp = new Space(), fld = new Batch(MAT.static, (ctx.tier === 'low' ? 9000 : 16000) * bk); fld.lod = 'mid';
  for (const R0 of P.rocks) sp.add(R0.x, R0.s, R0.tpl.r * R0.sc * 0.85);
  const FIELD = [[0.95, 0.92, 0.9], [1.0, 0.82, 0.86], [0.88, 0.88, 0.84], [1.05, 0.88, 0.85]];
  for (let k = 0, n = 0, want = Math.round(150 * rc0.rocks * bk * lk); k < want * 3 && n < want; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const rc = recipeOf(g), x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (0.5 + Math.pow(rng(), 1.5) * 22);
    if (rng() > ctx.weightOf(s, KEY) * shoreK(shoreT(ctx, pc, rc, x, s)) * (0.55 + 0.45 * sstep(-0.2, 0.3, vn3(x / 9, 1.5, s / 9, 91)))) continue;
    const tpl = pick(rng, poolOf(g, 'nb4okCobble', O.field, 3)), sc = 0.18 + Math.pow(rng(), 1.6) * 0.42, sy = sc * (0.45 + rng() * 0.4), r = tpl.r * sc * 0.85;
    if (!sp.free(x, s, r, 0.05) || fs.at(x, s) > ctx.surfaceY - 0.8) continue;
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.7), rng() * TAU), Pp = [x, fs.at(x, s), s];
    seat(fs, tpl, R, sc, sy, sc, Pp, null, 0.03 + (tpl.maxY - tpl.minY) * sy * 0.15);
    if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) continue;
    if (put(ctx, fld, tpl, Pp[0], Pp[1], Pp[2], R, sc, sy, sc, pick(rng, FIELD), 1)) { sp.add(x, s, r); n++; }
  }
  const nF = Math.round(160 * bk * lk);
  for (let k = 0; k < nF * 2 && k < 500; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const rc = recipeOf(g), x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * Math.pow(rng(), 1.3) * 28;
    if (rng() > ctx.weightOf(s, KEY) * shoreK(shoreT(ctx, pc, rc, x, s))) continue;
    const y0 = fs.at(x, s);
    if (y0 > ctx.surfaceY - 0.6) continue;
    const n = [fs.nx, fs.ny, fs.nz], u = rng();
    if (u < 0.12 * rc.urchins) {
      if (!sp.free(x, s, 0.4)) continue;
      for (let q = 0, m = 1 + ((rng() * 4) | 0); q < m; q++) { const a = rng() * TAU, d = rng() * 0.4; urchinAt(x + Math.cos(a) * d, y0, s + Math.sin(a) * d, n, 'floor'); }
      sp.add(x, s, 0.4);
      continue;
    }
    const e = u < 0.24 ? { t: O.star, sc: [0.12, 0.18], b: st, col: OCHRE, fa: 1 } : u < 0.36 ? { t: O.turf, sc: [0.8, 1.6], b: sw, col: [[0.9, 0.5, 0.6], [0.75, 0.42, 0.55], [0.85, 0.55, 0.45]], fa: 0.6 }
      : u < 0.52 ? { t: O.hash, sc: [0.8, 1.5], b: st, col: [[1, 1, 1], [0.95, 0.92, 0.85]], fa: 1 } : u < 0.62 ? { t: O.drift, sc: [0.8, 1.4], b: sw, col: [[1, 1, 1], [0.9, 0.95, 0.85]], fa: 0, drape: true }
        : u < 0.8 ? { t: O.cobble, sc: [0.8, 1.6], b: st, col: [[0.95, 0.92, 0.9], [0.85, 0.85, 0.88], [1.0, 0.9, 0.85]], fa: 1 }
          : u < 0.95 ? { t: poolOf(g, 'nb4okPalm', O.palm, 2), sc: [0.7, 1.3], b: sw, col: [[1, 1, 1], [1.1, 0.95, 0.8], [0.9, 1.0, 0.85]], fa: 1, tall: true }
            : { t: O.abalone, sc: [0.85, 1.15], b: st, col: [[1, 1, 1]], fa: 1 };
    const tpl = pick(rng, e.t), sc = rr(rng, e.sc[0], e.sc[1]), r = (tpl.nbR || tpl.r) * sc;
    if (!sp.free(x, s, r, 0.05)) continue;
    if (e.drape) { // drift kelp follows the floor mesh vertex by vertex
      if (put(ctx, e.b, tpl, x, y0, s, rotY(rng() * TAU), sc, 1, sc, pick(rng, e.col), 0, null)) { e.b.last.drape = fs; e.b.last.s0 = ctx.s0; sp.add(x, s, r); }
      continue;
    }
    const R = upTo(mix3([0, 1, 0], n, 0.9), rng() * TAU), Pp = [x, y0, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.01);
    if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + (tpl.maxY - tpl.minY) * sc, r, SOFT)) continue;
    if (put(ctx, e.b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, pick(rng, e.col), e.fa * sc)) sp.add(x, s, r);
  }
  // coralline pink and pale sand on the floor
  const dec = new Builder();
  for (let k = 0; k < 26 * bk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 2 * Math.pow(rng(), 1.2) * 30, r = 1.5 + rng() * 3.5, pink = rng() < 0.55;
    decalDisc(dec, fs, ctx, x, s, r, r * (0.5 + rng() * 0.5), rng() * TAU, pink ? pick(rng, [[0.42, 0.18, 0.26], [0.36, 0.14, 0.24], [0.45, 0.22, 0.3]]) : [0.42, 0.38, 0.3], pink ? 3 : 0, pink ? 0.55 : 0.6, 5, 18);
  }
  const extra = [];
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  return { batches: [st, an, sw, fld, ...ups, ...urs], extra };
}
