// Far-field habitat: a cheap layer that carries each zone's seabed life out to where the water hides it.
// The hero populators dress a corridor of ~15-40 m around the route; beyond it the 165 m wide terrain was bare,
// so from a raised or sideways view the route read as a decorated ribbon through a desert. This layer places a
// handful of low-poly templates per zone family (framework mounds and coral heads, rock piles, kelp plants,
// grass tufts, sponge clumps, ruin blocks, wreck outlines...) in the zone's own palette on a world-space grid.
// A world-space habitat field (biomes.habitat) gates it, so gardens, bare stretches and ridges cross the route
// instead of following it; density fades in where the hero bands thin out (overlapping them, same colours and
// sizes) and out toward the zone's visibility. One merged batch per side and material per chunk (2-4 draw
// calls), the side out of view frustum-culled. Nothing far gets a label; only big items get an obstacle.
import { Builder, Batch, T, TAU, vn3, sstep, lerp, rotX, rotY, mul3, orient, groundOf, staged } from './core.js';
import { MAT } from './materials.js';
import { groundY, pickW } from './scatter.js';
import { rockInto } from './shapes.js';
import { cullBase } from './reef_shapes.js';
import { REEF_PAL } from './reef.js';
import { BIOMES, habitat, kelpGrove, seagrassMeadow } from '../biomes.js';
import { mulberry32, hash2i } from '../noise.js';

// density per tier (full on high; low keeps about two thirds, never none) and a triangle cap per chunk (cells are
// tried in a shuffled order, so a capped chunk thins evenly instead of losing its last rows)
const TIER = { low: 0.65, medium: 0.85, high: 1, ultra: 1.15 };
const CAP = { low: 9000, medium: 16000, high: 26000, ultra: 32000 };
const SURF = 0.4; // tops stay this far under the surface

// ---------- low-poly template builders (all bases end at y <= 0 with the buried faces culled) ----------
const pickC = (rng, pal) => pal[(rng() * pal.length) | 0];
// Lumpy dome (coral head, framework mound, sponge clump, boulder): icosahedron of `det`, flattened below its
// equator onto a disc that is culled; vertex colours are a mosaic of `cells` palette patches, darker low down.
function dome(sd, { rx = 1, rz = rx, h = 0.8, det = 1, pal, cells = 4, mode = 2, lump = 0.18, freq = 1.6, base = 0.55, fx = 0 }) {
  const b = new Builder(), rng = mulberry32(sd * 7919 + 3), ph = rng() * 9;
  const C = Array.from({ length: cells }, () => { const a = rng() * TAU, y = rng() * 0.9, r = Math.sqrt(1 - y * y); return [Math.cos(a) * r, y, Math.sin(a) * r, pickC(rng, pal)]; });
  b.blob(det, (nx, ny, nz, o) => {
    const l = 1 + lump * vn3(nx * freq + ph, ny * freq, nz * freq, sd);
    o[0] = nx * rx * l; o[1] = (ny < 0 ? ny * 0.08 : ny) * h * l; o[2] = nz * rz * l;
    let best = C[0], bd = 9;
    for (const c of C) { const d = (nx - c[0]) ** 2 + (ny - c[1]) ** 2 + (nz - c[2]) ** 2; if (d < bd) { bd = d; best = c; } }
    const k = base + (1 - base) * sstep(-0.1, 0.8, ny);
    o[3] = best[3][0] * k; o[4] = best[3][1] * k; o[5] = best[3][2] * k; o[6] = fx; o[7] = mode;
  });
  return b;
}
// A dome with 1-3 smaller domes on it (a knoll of framework with colonies; a rock with boulders)
function mound(sd, o) {
  const b = dome(sd, o), rng = mulberry32(sd * 131 + 7), n = o.kids ?? 2;
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, q = 0.2 + rng() * 0.4, r = (0.3 + rng() * 0.2) * Math.min(o.rx, o.rz ?? o.rx), x = Math.cos(a) * o.rx * q, z = Math.sin(a) * (o.rz ?? o.rx) * q;
    const c = dome(sd * 17 + k, { det: 0, rx: r, h: r * (0.7 + rng() * 0.5), pal: o.kidPal || o.pal, cells: 2, mode: o.kidMode ?? o.mode, lump: 0.1, base: 0.8, fx: o.fx });
    cullBase(c, 0.005);
    const y = o.h * Math.sqrt(Math.max(0, 1 - q * q)) * 0.85;
    c.xform(0, [1, 0, 0, 0, 1, 0, 0, 0, 1], x, y, z);
    b.append(c);
  }
  return b;
}
// A clump of n tapered prongs (branching coral, tube sponges, whips, stumps): 4-sided, pointed or blunt.
function clump(sd, { n = 5, r = 0.4, h = 1, rad = 0.08, pal, mode = 0, spread = 0.35, radial = 4, blunt = false, fx = 0 }) {
  const b = new Builder(), rng = mulberry32(sd * 3301 + 1);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, q = k ? 0.3 + 0.7 * rng() : 0, x = Math.cos(a) * r * q, z = Math.sin(a) * r * q;
    const hh = h * (0.55 + 0.45 * rng()) * (1 - 0.3 * q), lean = spread * q;
    const top = [x + Math.cos(a) * lean * hh, hh, z + Math.sin(a) * lean * hh], c = pickC(rng, pal), rr = rad * (0.7 + 0.6 * rng());
    b.tube([[x, -0.08, z], [x * 0.5 + top[0] * 0.5, hh * 0.5, z * 0.5 + top[2] * 0.5], top], [rr, rr * 0.85, blunt ? rr * 0.7 : rr * 0.25], radial,
      (v, ang, px, py, pz, o) => { const k2 = 0.6 + 0.5 * v; o[3] = c[0] * k2; o[4] = c[1] * k2; o[5] = c[2] * k2; o[6] = fx; o[7] = mode; }, { cap: blunt });
  }
  return b;
}
// Swaying blades (grass tufts, kelp plants, fans, soft corals) for the sway material: n quad strips of `seg`
// segments; aFx.x = sway amplitude (grows toward the tip), aFx.y = sway style.
function blades(sd, { n = 5, h = 0.8, w = 0.06, seg = 2, r = 0.25, pal, style = 2, amp = 0.15, lean = 0.25, tipK = 1.3, taper = 0.4 }) {
  const b = new Builder(), rng = mulberry32(sd * 2203 + 9);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, q = Math.sqrt(rng()), x0 = Math.cos(a) * r * q, z0 = Math.sin(a) * r * q;
    const hh = h * (0.6 + 0.4 * rng()), la = a + (rng() - 0.5), lx = Math.cos(la) * lean * hh, lz = Math.sin(la) * lean * hh;
    const fa = rng() * TAU, ca = Math.cos(fa), sa = Math.sin(fa), ww = w * (0.7 + 0.6 * rng()), c = pickC(rng, pal), v0 = b.vc;
    for (let j = 0; j <= seg; j++) {
      const t = j / seg, cx = x0 + lx * t * t, cz = z0 + lz * t * t, y = hh * t - (j ? 0 : 0.05), hw = ww * (1 - taper * t) * 0.5, kc = lerp(0.55, tipK, t);
      for (const sgn of [-1, 1]) b.v(cx + ca * hw * sgn, y, cz + sa * hw * sgn, -sa * 0.86, 0.51, ca * 0.86, c[0] * kc, c[1] * kc, c[2] * kc, amp * t * t, style);
    }
    for (let j = 0; j < seg; j++) { const p = v0 + j * 2; b.t(p, p + 2, p + 1); b.t(p + 1, p + 2, p + 3); }
  }
  return b;
}
function rockB(sd, { sx = 1, sy = 0.6, sz = 1, col, growth = 0.4, rough = 0.38, det = 1 }) {
  const b = new Builder();
  rockInto(b, sd, { detail: det, sx, sy, sz, rough, flat: 0.3, growth, col });
  return b;
}
// finish a builder as a far template: buried faces culled, not solid (obstacles are registered by hand for
// the big ones), no label
function fin(b, cull = true) {
  if (cull) cullBase(b, 0.005);
  const t = b.build();
  t.solid = false;
  return t;
}
const many = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(1000 + o + i * 37));
// a template with a coarser twin (icosahedron detail 0) used beyond LO_D m, where a dome is a few pixels across
const LO_D = 55;
const withLo = (t, lo) => { t.lo = lo; return t; };

// ---------- per-zone recipes ----------
// in: lateral fade-in [start, full] (overlaps the hero bands), cell: grid step (m), dens: chance a cell holds a
// cluster at full habitat, hk: habitat patch scale, floor: share of density on poor ground (0 = bare between
// patches), deep: skip floor more than this far below the path (a wall's drop), dark: reach (m) in lamp-lit zones,
// grove / meadow: use the kelp's groves or the seagrass meadow as the habitat, maxSlope: steepest floor (ny),
// kinds: what grows there { w: weight, t: templates, sc: scale range, ys: y-stretch, fit: stretch to this share of
// the depth (kelp), tint, sway (sway material), upright (no lean to the slope), n: items per cluster, cr: cluster
// radius, dMin: only this far out, big: height (m) above which an obstacle is registered, hull: an obstacle along
// the length, lowSkip: mostly left out on the low tier }.
const FAR = {};
let built = false;
function tinted(pal, amt = 0.1) {
  return (rng) => { const c = pal[(rng() * pal.length) | 0], k = 1 + (rng() - 0.5) * 2 * amt; return [c[0] * k, c[1] * k, c[2] * k]; };
}
const WHITE = [[1, 1, 1], [1.05, 0.98, 0.92], [0.95, 0.98, 1.04]];
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const at = (b, x, y, z, R = I3) => { b.xform(0, R, x, y, z); return b; };
// rock pile: a boulder with two smaller ones leaning on it
function pile(sd, col, det = 1) {
  const b = rockB(sd, { sx: 1.1, sy: 0.75, sz: 0.9, col, det }), rng = mulberry32(sd * 97 + 5);
  for (let k = 0; k < 2; k++) { const a = rng() * TAU, r = 0.45 + rng() * 0.2; b.append(at(rockB(sd * 7 + k, { sx: r, sy: r * 0.7, sz: r * 0.9, col, det: 0 }), Math.cos(a) * 1.0, -0.05, Math.sin(a) * 0.9)); }
  return b;
}
// a domed crown on a short stalk (soft-coral tree, cold-water soft coral, sponge on a stem)
function tree(sd, { h = 0.9, r = 0.5, pal, stalk = [[0.9, 0.85, 0.8]], mode = 0, fx = 0 }) {
  const b = clump(sd, { n: 1, r: 0, h: h * 0.5, rad: r * 0.25, pal: stalk, blunt: true });
  const c = dome(sd + 3, { rx: r, h: h * 0.55, det: 1, pal, cells: 3, mode, lump: 0.3, freq: 3, base: 0.75, fx });
  cullBase(c, 0.005);
  b.append(at(c, 0, h * 0.4, 0));
  return b;
}
// horizontal cylinder along x (log, fallen column, boiler): lies on the floor, base at y = 0
function lying(sd, { L = 4, r = 0.3, pal, radial = 6, mode = 0, fx = 0, cap = true }) {
  const b = new Builder(), c = pal[sd % pal.length];
  b.tube([[-L / 2, r * 0.85, 0], [0, r * 0.9, 0], [L / 2, r * 0.85, 0]], [r, r * 0.97, r * 0.92], radial, (v, ang, x, y, z, o) => { o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = fx; o[7] = mode; }, { cap });
  return b;
}
function box(b, w, h, d, x, y, z, col, mode, fx = 0, yaw = 0) { return b.box(w, h, d, rotY(yaw), x, y + h / 2, z, col, [fx, mode]); }

// families of far templates, built once on first use
const FAM = {};
const fam = (k, f) => FAM[k] || (FAM[k] = f());
const P = () => REEF_PAL;
const coralT = () => fam('coral', () => {
  const p = P();
  return {
    mound: many(8, (s) => { const o = { rx: 2.2 + (s % 3) * 0.3, rz: 1.7 + (s % 2) * 0.3, h: 0.7, pal: p.MOSAIC.concat(p.PAD), cells: 6, mode: 9.08, kidPal: p.PORITES.concat(p.BRAINP), kidMode: 2, kids: 2 }; return withLo(fin(mound(s, o)), fin(mound(s, { ...o, det: 0, kids: 1 }))); }),
    head: many(6, (s) => { const o = { rx: 1.0, h: 0.85, pal: s % 2 ? p.HEADP : p.BRAINP, cells: 3, mode: s % 2 ? 2 : 0.9, lump: 0.22 }; return withLo(fin(dome(s, o)), fin(dome(s, { ...o, det: 0 }))); }, 50),
    bush: many(5, (s) => fin(dome(s, { rx: 0.7, h: 0.45, pal: p.ACRO, cells: 3, mode: 9.12, lump: 0.3, freq: 3 })), 90),
    branch: many(4, (s) => fin(clump(s, { n: 6, r: 0.5, h: 0.9, rad: 0.07, pal: p.ACRO, mode: 9.1, spread: 0.6 }), false), 120),
    table: many(3, (s) => { const b = clump(s, { n: 1, r: 0, h: 0.5, rad: 0.12, pal: p.TABLE, blunt: true }); b.append(at(dome(s + 5, { rx: 1.1, h: 0.18, det: 1, pal: p.TABLE, cells: 2, mode: 9.1 }), 0, 0.42, 0)); return fin(b, false); }, 140),
    fan: many(4, (s) => fin(blades(s, { n: 1, h: 1.4, w: 1.1, seg: 2, r: 0, pal: p.FANS, style: 0, amp: 0.08, lean: 0.05, taper: -0.2 }), false), 160),
    soft: many(4, (s) => fin(blades(s, { n: 5, h: 0.7, w: 0.22, seg: 2, r: 0.25, pal: p.SOFTC, style: 0, amp: 0.1, lean: 0.4, taper: 0.1 }), false), 180),
    sponge: many(3, (s) => fin(clump(s, { n: 4, r: 0.3, h: 0.9, rad: 0.12, pal: p.VIVID.concat(p.BARREL), mode: 2, spread: 0.2, blunt: true }), false), 200),
    softTree: many(6, (s) => fin(tree(s, { h: 1.0, r: 0.55, pal: p.SOFTC, mode: 0 }), false), 220),
    crust: many(5, (s) => fin(mound(s, { rx: 1.8, rz: 1.4, h: 0.9, pal: [[0.95, 0.38, 0.6], [0.62, 0.32, 0.8], [1.05, 0.5, 0.22], [0.86, 0.72, 0.42], [0.5, 0.42, 0.36]], cells: 6, mode: 2, kids: 1, kidPal: p.SOFTC })), 240),
    carpet: many(6, (s) => fin(dome(s, { rx: 1.3, rz: 1.0, h: 0.28, pal: [[0.78, 0.3, 0.88], [0.36, 0.78, 0.42], [1.05, 0.45, 0.62], [1.05, 0.66, 0.24], [0.92, 0.9, 0.74], [0.3, 0.55, 0.9]], cells: 7, mode: 2, lump: 0.25, freq: 3, base: 0.8 })), 260),
  };
});
const ROCK = [0.62, 0.6, 0.56];
const rockT = () => fam('rock', () => ({
  rock: many(6, (s) => { const o = { sx: 1, sy: 0.55 + (s % 3) * 0.15, sz: 0.8 + (s % 2) * 0.3, col: ROCK, growth: 0.5 }; return withLo(fin(rockB(s, o)), fin(rockB(s, { ...o, det: 0 }))); }, 300),
  pile: many(4, (s) => withLo(fin(pile(s, ROCK)), fin(pile(s, ROCK, 0))), 330),
  algae: many(4, (s) => fin(dome(s, { rx: 1.2, rz: 0.9, h: 0.3, pal: [[0.3, 0.38, 0.12], [0.42, 0.34, 0.14], [0.26, 0.3, 0.1], [0.5, 0.44, 0.2]], cells: 5, mode: 2, lump: 0.3, freq: 3, base: 0.7 })), 350),
}));
const kelpT = () => fam('kelp', () => ({
  // a kelp plant 10 m tall before its depth fit: two crossed golden-brown ribbons of fronds round the stipes
  plant: many(5, (s) => fin(blades(s, { n: 3, h: 10, w: 0.9, seg: 6, r: 0.35, pal: [[0.8, 0.6, 0.16], [0.68, 0.5, 0.14], [0.58, 0.42, 0.12]], style: 1, amp: 0.9, lean: 0.06, tipK: 1.25, taper: 0.15 }), false), 400),
  under: many(3, (s) => fin(blades(s, { n: 7, h: 0.55, w: 0.09, seg: 2, r: 0.35, pal: [[0.35, 0.26, 0.07], [0.45, 0.36, 0.1], [0.5, 0.09, 0.1]], style: 2, amp: 0.2, lean: 0.35 }), false), 430),
}));
const deepT = () => fam('deep', () => ({
  vase: many(4, (s) => fin(clump(s, { n: 1 + (s % 2), r: 0.25, h: 1.1, rad: 0.22, pal: [[0.85, 0.82, 0.72], [0.9, 0.86, 0.62], [0.78, 0.76, 0.7]], mode: 2, spread: 0.15, blunt: true, radial: 6 }), false), 500),
  xeno: many(3, (s) => fin(dome(s, { rx: 0.5, h: 0.35, pal: [[0.7, 0.66, 0.58], [0.6, 0.56, 0.5]], cells: 2, mode: 2, lump: 0.35, freq: 4 })), 520),
  pen: many(3, (s) => fin(blades(s, { n: 1, h: 0.7, w: 0.07, seg: 2, r: 0, pal: [[0.95, 0.6, 0.35], [0.9, 0.85, 0.75], [0.85, 0.4, 0.3]], style: 6, amp: 0.05, lean: 0.05, taper: 0.2 }), false), 540),
  softCold: many(4, (s) => fin(tree(s, { h: 0.8, r: 0.45, pal: [[1.0, 0.5, 0.5], [0.95, 0.92, 0.88], [1.05, 0.6, 0.3]], mode: 0 }), false), 560),
}));
const coldT = () => fam('cold', () => {
  const W = [0.68, 0.61, 0.46], O = [0.83, 0.33, 0.14], D = [0.2, 0.17, 0.13];
  return {
    mound: many(6, (s) => fin(mound(s, { rx: 2.0, rz: 1.6, h: 1.0, pal: [W, W, O, D, D, [0.3, 0.26, 0.2]], cells: 7, mode: 9.18, lump: 0.32, freq: 2.6, kids: 2, kidPal: [W, O, W] })), 600),
    bush: many(5, (s) => fin(dome(s, { rx: 0.8, h: 0.7, pal: s % 3 ? [W, [0.62, 0.56, 0.42]] : [O, [0.75, 0.3, 0.13]], cells: 2, mode: 9.2, lump: 0.38, freq: 3.4, base: 0.6 })), 630),
    sponge: many(3, (s) => fin(clump(s, { n: 3, r: 0.3, h: 0.7, rad: 0.15, pal: [[0.85, 0.7, 0.25], [0.9, 0.5, 0.2], [0.8, 0.78, 0.65]], mode: 2, spread: 0.25, blunt: true }), false), 660),
  };
});
const ventT = () => fam('vent', () => {
  const C = [[0.2, 0.17, 0.15], [0.26, 0.2, 0.16], [0.3, 0.24, 0.18]];
  return {
    // a sulphide chimney 6 m tall, knobbly, its top rim glowing faintly with hot mineral (mode 3)
    chimney: many(5, (s) => {
      const b = new Builder(), rng = mulberry32(s), c = C[s % 3], n = 5, pts = [], rad = [];
      for (let i = 0; i < n; i++) { const t = i / (n - 1); pts.push([(rng() - 0.5) * 0.4 * t, -0.1 + t * 6, (rng() - 0.5) * 0.4 * t]); rad.push(0.9 * (1 - 0.65 * t) * (0.8 + 0.4 * rng())); }
      b.tube(pts, rad, 5, (v, ang, x, y, z, o) => { const k = 0.7 + 0.4 * v; o[3] = c[0] * k; o[4] = c[1] * k; o[5] = c[2] * k; o[6] = v > 0.9 ? 0.6 : 0; o[7] = v > 0.9 ? 3 : 0; }, { cap: true });
      return fin(b, false);
    }, 700),
    mat: many(4, (s) => fin(dome(s, { rx: 1.8, rz: 1.3, h: 0.1, pal: [[0.75, 0.7, 0.42], [0.82, 0.8, 0.72], [0.62, 0.36, 0.14]], cells: 4, mode: 0, lump: 0.2, freq: 2, base: 0.9 })), 730),
  };
});
const carbT = () => fam('carb', () => ({
  spire: many(5, (s) => fin(clump(s, { n: 2 + (s % 3), r: 0.6, h: 7, rad: 0.55, pal: [[0.86, 0.84, 0.78], [0.8, 0.78, 0.72], [0.92, 0.9, 0.84]], mode: 0, fx: 0.15, spread: 0.08, blunt: true, radial: 5 }), false), 800),
  rubble: many(4, (s) => fin(pile(s, [0.78, 0.76, 0.7])), 830),
}));
const woodT = () => fam('wood', () => {
  const Wd = [[0.24, 0.17, 0.1], [0.3, 0.22, 0.13], [0.2, 0.16, 0.12]];
  return {
    stump: many(5, (s) => fin(clump(s, { n: 1 + (s % 2), r: 0.3, h: 1.6, rad: 0.4, pal: Wd, mode: 0, fx: 0.3, spread: 0.1, blunt: true, radial: 5 }), false), 900),
    snag: many(4, (s) => fin(clump(s, { n: 4, r: 0.2, h: 5, rad: 0.18, pal: Wd, mode: 0, fx: 0.2, spread: 0.45, radial: 4 }), false), 930),
    log: many(4, (s) => fin(lying(s, { L: 5 + (s % 3), r: 0.35, pal: Wd, radial: 5, fx: 0.4 }), false), 960),
  };
});
const stoneT = () => fam('stone', () => {
  const S = [[0.8, 0.76, 0.68], [0.72, 0.68, 0.6], [0.84, 0.78, 0.66]], m = (s) => 6.05 + (s % 7) * 0.12;
  return {
    block: many(6, (s) => { const b = new Builder(), rng = mulberry32(s); for (let k = 0; k < 2 + (s % 3); k++) box(b, 0.8 + rng() * 0.6, 0.5 + rng() * 0.4, 0.6 + rng() * 0.4, (rng() - 0.5) * 1.6, -0.05, (rng() - 0.5) * 1.6, S[k % 3], m(s), 0.5, rng() * TAU); return fin(b, false); }, 1000),
    wall: many(5, (s) => { const b = new Builder(), rng = mulberry32(s); let x = -1.5; for (let k = 0; k < 4; k++) { const h = 1.0 + rng() * 1.6; box(b, 0.95, h, 0.7, x, -0.05, (rng() - 0.5) * 0.08, S[k % 3], m(s), 0.4); x += 1.0; } return fin(b, false); }, 1030),
    column: many(4, (s) => { const b = clump(s, { n: 1, r: 0, h: 1.6 + (s % 3) * 0.9, rad: 0.4, pal: S, mode: m(s), fx: 0.4, spread: 0, blunt: true, radial: 7 }); box(b, 1.1, 0.35, 1.1, 0, -0.05, 0, S[0], m(s), 0.4); return fin(b, false); }, 1060),
    fallen: many(3, (s) => fin(lying(s, { L: 3.5 + s % 2, r: 0.4, pal: S, radial: 7, mode: m(s), fx: 0.5 }), false), 1090),
    platform: many(3, (s) => { const b = new Builder(); for (let k = 0; k < 3; k++) box(b, 6 - k * 1.6, 0.8, 6 - k * 1.6, 0, -0.05 + k * 0.8, 0, S[k % 3], m(s), 0.4); return fin(b, false); }, 1120),
  };
});
const wreckT = () => fam('wreck', () => {
  const Rr = [[0.34, 0.22, 0.15], [0.3, 0.25, 0.2], [0.4, 0.28, 0.18]];
  return {
    // hull plates bent up out of the sand, one lying flat beside them
    plate: many(5, (s) => {
      const b = new Builder(), rng = mulberry32(s);
      for (let k = 0; k < 3; k++) {
        const w = 1.6 + rng(), d = 1.0 + rng() * 0.6, t = k ? 0.35 + rng() * 0.6 : 0, R = mul3(rotY(rng() * TAU), rotX(t));
        b.box(w, 0.08, d, R, (rng() - 0.5) * 1.4, d * 0.5 * Math.sin(t) - 0.04, (rng() - 0.5) * 1.4, Rr[k % 3], [0.3, 4]);
      }
      return fin(b, false);
    }, 1200),
    frames: many(3, (s) => fin(clump(s, { n: 4, r: 0.8, h: 2.6, rad: 0.11, pal: Rr, mode: 4, fx: 0.3, spread: 0.45, radial: 4, blunt: true }), false), 1215),
    girder: many(3, (s) => { const b = new Builder(), rng = mulberry32(s); box(b, 4 + rng() * 2, 0.3, 0.25, 0, -0.05, 0, Rr[s % 3], 4, 0.3); box(b, 2.2, 0.25, 0.25, 0.5, 0.18, 0.5, Rr[(s + 1) % 3], 4, 0.3, 0.6 + rng()); return fin(b, false); }, 1230),
    boiler: many(2, (s) => fin(lying(s, { L: 3, r: 0.9, pal: Rr, radial: 7, mode: 4, fx: 0.3 }), false), 1260),
    // a whole hull's outline for the haze: a long low mound with blocky deckhouses (18-36 m once scaled)
    hull: many(3, (s) => {
      const b = dome(s, { rx: 1, rz: 0.17, h: 0.2, pal: [Rr[s % 3]], cells: 1, mode: 4, lump: 0.08, freq: 1.2, base: 0.7, fx: 0.4 }), rng = mulberry32(s);
      box(b, 0.16, 0.12, 0.12, -0.2 + rng() * 0.2, 0.14, 0, Rr[(s + 1) % 3], 4, 0.3);
      box(b, 0.08, 0.1, 0.09, 0.3, 0.14, 0, Rr[(s + 2) % 3], 4, 0.3);
      return fin(b);
    }, 1290),
  };
});
// the hero seagrass' own far patches (sway material): the meadow carries on, same blades, same colours
const grassT = () => fam('grass', () => ({ patch: [...(T.turtleFar || []), ...(T.eelFar || [])] }));

const K = (w, t, sc, o = {}) => ({ w, t, sc, n: [1, 3], cr: 3, tint: tinted(WHITE), ...o });
const rockTint = (k, mul = 1) => { const c = BIOMES[k].rock; return tinted([[c[0] * mul * 1.6, c[1] * mul * 1.6, c[2] * mul * 1.6], [c[0] * mul * 1.45, c[1] * mul * 1.5, c[2] * mul * 1.5]], 0.12); };
export function initFarField() {
  if (built) return;
  built = true;
  const c = coralT(), r = rockT();
  const reefKinds = [
    K(4, c.mound, [0.8, 1.5], { ys: [0.7, 1.2], cr: 4.5 }),
    K(2, c.head, [0.9, 2.0], { big: 2.2 }),
    K(1.4, c.bush, [0.8, 1.6], { n: [2, 5] }),
    K(1.0, c.branch, [0.8, 1.6], { n: [2, 4], cr: 2.5, lowSkip: true }),
    K(0.8, c.table, [0.8, 1.6]),
    K(1.0, c.fan, [0.8, 1.5], { cr: 2.5, sway: true, lowSkip: true }),
    K(0.8, c.soft, [0.8, 1.5], { n: [2, 4], cr: 2.5, sway: true, lowSkip: true }),
    K(0.6, c.sponge, [0.8, 1.5], { cr: 2, lowSkip: true }),
  ];
  // ---- coral family
  FAR.reef = { in: [14, 34], cell: 6, dens: 1.3, floor: 0.2, kinds: reefKinds };
  FAR.wall = { in: [8, 24], cell: 7, dens: 1.4, floor: 0.2, deep: 25, kinds: reefKinds };
  FAR.bluehole = { in: [10, 28], cell: 7, dens: 1.0, floor: 0.2, deep: 20, kinds: reefKinds };
  FAR.softcoral = { in: [8, 26], cell: 7, dens: 0.9, floor: 0.2, kinds: [
    K(3, c.softTree, [0.9, 1.8], { n: [2, 5] }), K(2, c.crust, [0.9, 1.6], { cr: 4 }), K(1, c.head, [0.9, 1.8], { big: 2.2 }),
    K(1.5, c.fan, [0.9, 1.6], { sway: true, lowSkip: true }), K(1, r.pile, [0.8, 1.6], { tint: rockTint('softcoral') }),
  ] };
  FAR.champagne = { in: [8, 26], cell: 7, dens: 0.8, floor: 0.15, kinds: [
    K(2, c.head, [0.8, 1.6]), K(1, c.softTree, [0.8, 1.4], { n: [1, 3] }), K(2, r.pile, [0.7, 1.5], { tint: rockTint('champagne', 0.9) }), K(1, c.crust, [0.8, 1.4]),
  ] };
  FAR.anemone = { in: [8, 24], cell: 7, dens: 0.9, floor: 0.2, kinds: [
    K(4, c.carpet, [0.9, 1.7], { n: [2, 5], cr: 4 }), K(1.5, r.rock, [0.7, 1.6], { tint: rockTint('anemone') }), K(0.5, c.softTree, [0.8, 1.3]),
  ] };
  FAR.seamount = { in: [10, 30], cell: 8, dens: 1.0, floor: 0.2, kinds: [
    K(3, r.pile, [0.9, 2.0], { tint: rockTint('seamount'), big: 2 }), K(2, c.fan, [1.0, 2.0], { sway: true, n: [2, 4] }),
    K(1, c.sponge, [0.9, 1.6]), K(1, c.crust, [0.9, 1.5]),
  ] };
  const cc = coldT();
  FAR.coldcoral = { in: [10, 30], cell: 8, dens: 0.9, dark: 60, floor: 0.15, kinds: [
    K(3, cc.mound, [0.9, 1.8], { big: 2.4, cr: 4 }), K(2, cc.bush, [0.8, 1.6], { n: [2, 5] }), K(1, cc.sponge, [0.8, 1.4], { lowSkip: true }),
    K(1, r.rock, [0.7, 1.5], { tint: rockTint('coldcoral') }),
  ] };
  FAR.tidepool = { in: [6, 12], cell: 6, dens: 0.6, floor: 0.3, kinds: [
    K(3, r.pile, [0.6, 1.3], { tint: rockTint('tidepool', 1.1) }), K(2, c.carpet, [0.6, 1.1], { n: [1, 3] }), K(1, r.algae, [0.6, 1.2]),
  ] };
  // ---- kelp family: plants follow the forest's own grove field, so the canopy overhead has stipes under it
  const kp = kelpT(), kelpKinds = (k) => [
    K(4, kp.plant, [0.8, 1.3], { fit: 0.9, sway: true, n: [2, 4], cr: 3.5, upright: true }),
    K(2, r.rock, [0.8, 2.0], { tint: rockTint(k, 1.1) }), K(1, r.pile, [0.8, 1.6], { tint: rockTint(k, 1.1) }),
    K(1.5, kp.under, [0.9, 1.5], { sway: true, n: [2, 4], lowSkip: true }),
  ];
  FAR.kelp = { in: [12, 32], cell: 6, dens: 1.3, floor: 0.1, grove: true, kinds: kelpKinds('kelp') };
  FAR.otterkelp = { in: [12, 30], cell: 6, dens: 1.2, floor: 0.1, kinds: kelpKinds('otterkelp') };
  // ---- meadows and shallows
  const gr = grassT();
  if (gr.patch.length) {
    FAR.seagrass = { in: [30, 46], cell: 5, dens: 1.3, floor: 0.3, meadow: true, kinds: [
      K(6, gr.patch, [0.95, 1.25], { sway: true, n: [3, 6], cr: 3, upright: true, tint: tinted([[1, 1, 1], [1.1, 1.05, 0.88]], 0.1) }),
      K(0.4, r.rock, [0.5, 1.2], { tint: rockTint('seagrass', 1.1) }),
    ] };
    const shallows = (k) => [K(3, gr.patch, [0.8, 1.1], { sway: true, n: [2, 5], upright: true }), K(2, r.algae, [0.7, 1.3]), K(1, r.rock, [0.5, 1.2], { tint: rockTint(k, 1.2) })];
    FAR.mangrove = { in: [10, 20], cell: 6, dens: 0.8, floor: 0.2, maxSlope: 0.45, kinds: shallows('mangrove') };
    FAR.biobay = { in: [10, 24], cell: 6, dens: 0.5, dark: 60, floor: 0.2, kinds: shallows('biobay') };
    FAR.sandflat = { in: [16, 34], cell: 9, dens: 0.5, floor: 0, hk: 1.6, kinds: [
      K(2, c.head, [0.6, 1.2], { n: [2, 4], cr: 4 }), K(1, c.bush, [0.7, 1.3], { n: [1, 3] }), K(2, r.rock, [0.5, 1.3], { tint: rockTint('sandflat', 1.15) }),
      K(1.5, gr.patch, [0.8, 1.1], { sway: true, n: [2, 4], upright: true, lowSkip: true }),
    ] };
  }
  FAR.jellylake = { in: [8, 18], cell: 6, dens: 1.0, floor: 0.2, maxSlope: 0.4, kinds: [K(3, r.algae, [0.8, 1.5], { n: [2, 4] }), K(1, c.sponge, [0.7, 1.2]), K(1, r.rock, [0.6, 1.3], { tint: rockTint('jellylake', 1.1) })] };
  // ---- sand, silt and lava
  const dp = deepT();
  FAR.whaleshark = { in: [10, 24], cell: 9, dens: 0.5, floor: 0.1, kinds: [K(2, r.rock, [0.7, 1.6], { tint: rockTint('whaleshark', 1.2) }), K(1, r.algae, [0.8, 1.4])] };
  FAR.whalefall = { in: [16, 32], cell: 9, dens: 0.6, floor: 0.1, kinds: [
    K(3, r.pile, [0.8, 1.6], { tint: tinted([[0.3, 0.28, 0.27], [0.26, 0.24, 0.24]]) }), K(1, c.head, [0.6, 1.1]), K(1, r.rock, [0.6, 1.4], { tint: rockTint('whalefall') }),
  ] };
  FAR.deepplain = { in: [10, 28], cell: 8, dens: 0.6, dark: 55, floor: 0.15, kinds: [
    K(2, dp.vase, [0.8, 1.5]), K(2, dp.pen, [1.0, 1.6], { sway: true, n: [2, 5], lowSkip: true }), K(1, r.rock, [0.6, 1.3], { tint: rockTint('deepplain') }), K(1, dp.xeno, [0.8, 1.5], { n: [2, 4] }),
  ] };
  FAR.hadal = { in: [8, 30], cell: 9, dens: 0.35, dark: 50, floor: 0.2, maxSlope: 0.35, kinds: [K(1, dp.vase, [0.7, 1.3], { maxSlope: 0.35 }), K(2, r.rock, [0.8, 1.8], { tint: rockTint('hadal', 1.2), maxSlope: 0.35 }), K(1, dp.xeno, [0.8, 1.4], { maxSlope: 0.35 })] };
  const icy = (k) => [K(2, r.pile, [0.9, 1.8], { tint: rockTint(k, 1.2) }), K(1, dp.vase, [0.8, 1.4]), K(1.5, dp.softCold, [0.8, 1.5], { n: [2, 4] })];
  FAR.polar = { in: [6, 20], cell: 8, dens: 0.7, floor: 0.2, kinds: icy('polar') };
  FAR.iceedge = { in: [6, 20], cell: 8, dens: 0.7, floor: 0.2, kinds: icy('iceedge') };
  // ---- vents, carbonate towers, drowned forest
  const vt = ventT(), cb = carbT(), wd = woodT();
  FAR.vents = { in: [12, 32], cell: 9, dens: 0.8, dark: 90, floor: 0.15, kinds: [
    K(2, vt.chimney, [0.6, 1.4], { big: 2.5, cr: 5, upright: true }), K(2, r.pile, [0.8, 1.7], { tint: rockTint('vents', 1.1) }), K(2, vt.mat, [0.8, 1.5], { n: [1, 3] }),
  ] };
  FAR.lostcity = { in: [10, 30], cell: 9, dens: 0.8, dark: 60, floor: 0.15, kinds: [
    K(3, cb.spire, [0.5, 1.3], { big: 2.5, cr: 4, upright: true }), K(2, cb.rubble, [0.7, 1.5]),
  ] };
  FAR.sunkenforest = { in: [12, 30], cell: 8, dens: 0.9, floor: 0.2, kinds: [
    K(3, wd.stump, [0.8, 1.5], { big: 1.8, upright: true }), K(1.5, wd.snag, [0.7, 1.3], { big: 2.5, upright: true }), K(2, wd.log, [0.8, 1.4]), K(1, r.rock, [0.6, 1.3], { tint: rockTint('sunkenforest', 1.1) }),
  ] };
  // ---- wrecks and ruins: debris fields, a second wreck's outline in the haze, more ruin blocks
  const wr = wreckT(), stn = stoneT();
  FAR.wreck = { in: [16, 34], cell: 9, dens: 0.9, floor: 0.15, kinds: [
    K(3, wr.plate, [1.0, 1.8], { n: [2, 4] }), K(2, wr.frames, [1.0, 1.6], { n: [1, 3], upright: true }), K(1.5, wr.girder, [1.0, 1.6]),
    K(0.8, wr.boiler, [0.9, 1.3], { n: [1, 1] }), K(1.5, r.pile, [0.9, 1.7], { tint: rockTint('wreck', 1.1) }),
    K(0.8, wr.hull, [9, 16], { n: [1, 1], dMin: 50, hull: true, upright: true }),
  ] };
  FAR.ruins = { in: [10, 28], cell: 7, dens: 1.2, floor: 0.2, kinds: [
    K(3, stn.block, [0.8, 1.4], { n: [2, 4], cr: 3.5 }), K(2, stn.wall, [0.8, 1.3], { big: 2.2, upright: true }), K(1.5, stn.column, [0.8, 1.2], { big: 2.2, upright: true }),
    K(1, stn.fallen, [0.8, 1.2], { upright: true }), K(0.4, stn.platform, [0.8, 1.3], { n: [1, 1], dMin: 40, big: 1.5, upright: true }),
  ] };
  T.far = FAR;
}

// ---------- layout ----------
const fogOf = (k) => { const sg = BIOMES[k].sigma; return Math.min(330, Math.max(90, 4.5 / Math.min(sg[1], sg[2]))); };
const DMAX = {};
function dMax(k, low) {
  const id = k + (low ? '|l' : '');
  return DMAX[id] ?? (DMAX[id] = low ? Math.min(120, fogOf(k) * 0.62) : Math.min(158, fogOf(k) * 0.9));
}
// the zone at s chosen for a cell (weighted by the cross-fade, deterministic per cell)
function zoneAt(ctx, s, u) {
  const ws = ctx.weights(s);
  let acc = 0;
  for (const e of ws) { acc += e.w; if (u < acc) return e; }
  return ws[ws.length - 1];
}

export function layoutFarField(ctx) {
  const tierK = TIER[ctx.tier] ?? 1, low = ctx.tier === 'low';
  // any zone in this chunk with a far recipe?
  let any = false;
  for (const g of ctx.segments) if (FAR[g.key]) { any = true; break; }
  if (!any) return null;
  const gnd = groundOf(ctx);
  const cap = CAP[ctx.tier] ?? CAP.high;
  const st = [new Batch(MAT.static, cap), new Batch(MAT.static, cap)], sw = [new Batch(MAT.sway, cap), new Batch(MAT.sway, cap)];
  const left = { tris: cap }; // shared by the four batches
  const more = [], s0 = ctx.s0, s1 = ctx.s1;
  // cells: a global grid per zone cell size (so neighbouring chunks agree); collect the cells to try first
  const cells = [];
  const cellOf = new Map();
  for (const g of ctx.segments) { const R = FAR[g.key]; if (R && !cellOf.has(R.cell)) cellOf.set(R.cell, true); }
  for (const c of cellOf.keys()) {
    const i0 = Math.floor(ctx.xMin / c), i1 = Math.floor(ctx.xMax / c), j0 = Math.floor(s0 / c), j1 = Math.floor(s1 / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells.push(c, i, j);
  }
  const order = Array.from({ length: cells.length / 3 }, (_, k) => k);
  const key = order.map((k) => hash2i(cells[k * 3 + 1], cells[k * 3 + 2], 0xfa7));
  order.sort((a, b) => key[a] - key[b]);
  const per = 16; // cells per continuation step (~15 us per placed item: a step stays well under the 2 ms stage budget)
  for (let k0 = 0; k0 < cells.length; k0 += per * 3) more.push(() => {
    for (let k = k0; k < Math.min(cells.length, k0 + per * 3); k += 3) {
      const o = order[k / 3] * 3, c = cells[o], i = cells[o + 1], j = cells[o + 2];
      const h1 = hash2i(i, j, 0xfa1 + c), h2 = hash2i(i, j, 0xfa2 + c);
      const s = (j + h2) * c, x = (i + h1) * c;
      if (s < s0 || s >= s1 || x < ctx.xMin + 2 || x > ctx.xMax - 2) continue;
      const e = zoneAt(ctx, s, hash2i(i, j, 0xfa3 + c) * 0.9999), R = FAR[e.key];
      if (!R || R.cell !== c) continue;
      const px = ctx.pathX(s), d = Math.abs(x - px), D = Math.min(dMax(e.key, low), R.dark ?? 999);
      if (d < R.in[0] || d > D) continue;
      const hab = habAt(R, e, x, s, x - px);
      const p = R.dens * tierK * sstep(R.in[0], R.in[1], d) * (1 - sstep(D * 0.75, D, d)) * (1 - 0.5 * sstep(50, D, d)) * (R.floor + (1 - R.floor) * hab);
      const rng = mulberry32((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ c) | 0);
      if (rng() >= p) continue;
      if (left.tris > 0) cluster(ctx, gnd, R, e, x, s, d, hab, rng, x < px ? 0 : 1, st, sw, low, left);
    }
  });
  return { batches: [...st, ...sw], more };
}

// habitat richness 0..1 for a recipe: the world-space habitat field, or the zone's own field where it has one
// (the kelp's groves, under its canopy; the seagrass meadow and its sandy gaps)
function habAt(R, e, x, s, dx) {
  const h = habitat(x, s, R.hk ?? 1);
  if (R.grove) return e.g ? kelpGrove(x, s, e.g, dx) * (0.5 + 0.5 * h) : h;
  if (R.meadow) return sstep(-0.32, -0.2, seagrassMeadow(x, s)) * (0.35 + 0.65 * h);
  return h;
}
const _R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function cluster(ctx, gnd, R, e, cx, cs, cd, hab, rng, side, st, sw, low, left) {
  // a cluster leans on one kind (gardens of one growth form), the rest mixed
  const main = pickW(rng, R.kinds), n = main.n[0] + Math.floor(rng() * (main.n[1] - main.n[0] + 1));
  // richer ground grows bigger colonies; farther out the big structures (bommies, patch reefs) are what reads
  const big = (0.85 + 0.35 * hab) * (1 + (R.grow ?? 0.5) * sstep(30, 110, cd));
  const hasCeil = !!BIOMES[e.key].ceil;
  for (let q = 0; q < n; q++) {
    const K = q === 0 || rng() < 0.6 ? main : pickW(rng, R.kinds);
    if ((low && K.lowSkip && rng() < 0.6) || (K.dMin && cd < K.dMin)) continue;
    const a = rng() * TAU, rr = q ? K.cr * Math.sqrt(rng()) : 0, x = cx + Math.cos(a) * rr, s = cs + Math.sin(a) * rr;
    if (s < ctx.s0 || s >= ctx.s1) continue;
    let tpl = K.t[(rng() * K.t.length) | 0];
    if (tpl.lo && cd > LO_D) tpl = tpl.lo;
    const sc = (K.sc[0] + (K.sc[1] - K.sc[0]) * Math.pow(rng(), 1.4)) * (K.hull ? 1 : big);
    const fy = gnd.floor(x, s), ny = gnd.ny;
    if (ny < (K.maxSlope ?? R.maxSlope ?? 0.6)) continue; // a steep face: nothing settles there
    if (R.deep && fy < ctx.pathY(s) - R.deep) continue;
    // kelp plants reach up to just under the surface, whatever the depth
    const ys = K.fit ? Math.min(3, Math.max(0.3, (ctx.surfaceY - 0.8 - fy) * K.fit / (tpl.maxY * sc))) * (0.9 + 0.1 * rng())
      : K.ys ? K.ys[0] + (K.ys[1] - K.ys[0]) * rng() : 0.85 + 0.3 * rng();
    const hgt = tpl.maxY * sc * ys;
    if (fy + hgt > ctx.surfaceY - SURF) continue;
    if (hasCeil && ctx.ceilingAt(x, s) < fy + hgt + 0.6) continue;
    // keep off the hero props: their footprints (knolls, heads, hulls) and anything standing here as a support
    const fr = tpl.r * sc * 0.7;
    if (!gnd.free(x, s, fr, 0) || !gnd.free(x, s, fr, 2) || gnd.h(x, s) > fy + 0.25) continue;
    const Rm = K.sway || K.upright ? rotY(rng() * TAU) : orient(gnd.nx, ny, gnd.nz, K.follow ?? 0.35, rng() * TAU);
    // seat on the floor under the whole base (small things: the hull of their contact band); skip what would
    // straddle a ledge (a terrace step) and end up buried deep on its high side
    const y = groundY({ at: (px, ps) => gnd.floor(px, ps) }, x, s, tpl, Rm, sc, sc * ys, sc, tpl.r * sc < 1.2) - Math.min(0.06 * hgt, 0.12) - 0.01;
    if (fy - y > Math.max(0.35, 0.5 * hgt)) continue;
    const c = K.tint ? K.tint(rng) : _R;
    const B = (K.sway ? sw : st)[side];
    if (tpl.tris > left.tris || !B.add(tpl, x, y, -(s - ctx.s0), Rm, sc, sc * ys, sc, c[0], c[1], c[2], K.sway ? sc : 0.4 + 0.4 * rng())) continue;
    left.tris -= tpl.tris;
    B.last.g = 1; // floor-seated: covered by the contact audit
    if (!ctx.addObstacle || ctx._farObs >= 16) continue; // (at most 16 per chunk: only the big ones matter to swimmers)
    if (K.hull) { // a capsule along the hull's length
      const hl = sc * 0.8, r = sc * 0.16, ax = Rm[0] * hl, az = Rm[6] * hl;
      ctx.addObstacle(x - ax, y + r * 0.6, s + az, x + ax, y + r * 0.6, s - az, r); ctx._farObs = (ctx._farObs || 0) + 1;
    } else if (K.big && hgt > K.big) { const r = tpl.r * sc * 0.75; ctx.addObstacle(x, y + Math.min(r, hgt * 0.5), s, x, y + Math.max(hgt - r, hgt * 0.5), s, r); ctx._farObs = (ctx._farObs || 0) + 1; }
  }
}

export function registerFarField(terrain, env) {
  initFarField();
  // stage times in window.__props.pops.far (as index.js records the others); groups are tagged farField, so debug
  // captures can toggle the layer to measure its cost
  const stats = typeof window !== 'undefined' && window.__props;
  staged(layoutFarField, 40).forEach((p) => terrain.populators.push((ctx) => {
    const t0 = performance.now(), r = p(ctx), dt = performance.now() - t0;
    if (stats) { const e = stats.pops.far || (stats.pops.far = { n: 0, ms: 0, max: 0 }); e.ms += dt; if (dt > e.max) e.max = dt; if (r) e.n++; }
    if (r) r.object.userData.farField = true;
    return r;
  }));
}
