// Far-field habitat: a cheap layer that carries each zone's seabed life from the edge of the flight tube out to
// where the water hides it. The hero populators dress a few tight clusters around the route; around and beyond
// them the 330 m wide terrain was bare, so from the side, from a raised view or looking back the route read as a
// decorated ribbon through a desert. This layer places a handful of low-poly templates per zone family (coral
// bommies and framework mounds, soft-coral rocks, anemone carpets, kelp plants, grass patches, rock outcrops,
// sponges, chimneys, ruin walls and colonnades on a street grid, wreck debris and hull outlines...) in the zone's
// own palette on a world-space grid. A world-space habitat field (biomes.habitat) gates it, so gardens, bare
// stretches and ridges cross the route instead of following it; habitat zones are mostly covered, sand zones
// mostly bare. Items keep off every hero prop of the chunk (a footprint grid made from the hero meshes as they
// are built) and out of the flight tube, and thin toward the zone's visibility while growing bigger.
// One merged batch per material per chunk (slices are spatially sorted, so frustum culling still drops the side
// out of view); a per-chunk triangle cap per tier. Nothing gets a label; only big items get an obstacle.
import { Builder, Batch, T, TAU, vn3, sstep, lerp, rotX, rotY, mul3, orient, groundOf, staged, propClear } from './core.js';
import { MAT } from './materials.js';
import { groundY, pickW } from './scatter.js';
import { rockInto } from './shapes.js';
import { cullBase } from './reef_shapes.js';
import { REEF_PAL } from './reef.js';
import { BIOMES, habitat, kelpGrove, seagrassMeadow, sv, whaleFallOf } from '../biomes.js';
import { mulberry32, hash2i } from '../noise.js';

// density per tier (full on high; low keeps about two thirds, never none) and a triangle cap per chunk (cells are
// tried in a shuffled order, so a capped chunk thins evenly instead of losing its last rows); a recipe's capK
// scales it for zones whose hero props are light
const TIER = { low: 0.7, medium: 0.85, high: 1, ultra: 1.15 };
const CAP = { low: 9000, medium: 18000, high: 30000, ultra: 38000 };
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
const LO_D = 55, FAR_D = 45, FAR_SHARE = 0.3; // (and beyond FAR_D: a recipe's far kinds, FAR_SHARE of the cap kept for them)
const withLo = (t, lo) => { t.lo = lo; return t; };
const tw = (f) => withLo(f(1), f(0)); // f(det): the template at icosahedron detail 1, and its coarse twin

// ---------- per-zone recipes ----------
// in: lateral fade-in [start, full] (overlaps the hero bands), cell: grid step (m), dens: chance a cell holds a
// cluster at full habitat, hk: habitat patch scale, floor: share of density on poor ground (0 = bare between
// patches), deep: skip floor more than this far below the path (a wall's drop), dark: reach (m) in lamp-lit zones,
// grove / meadow: use the kelp's groves or the seagrass meadow as the habitat, maxSlope: steepest floor (ny),
// capK: cap factor, carcass: clearing (m) around the whale fall, grid: street spacing (m) of a ruined city (kinds
// with line: runs along its streets), feats: per-segment landmarks { n, kind, d: lateral range },
// kinds: what grows there { w: weight, t: templates, sc: scale range, ys: y-stretch, fit: stretch to this share of
// the depth (kelp), tint, sway (sway material), upright (no lean to the slope), n: items per cluster, cr: cluster
// radius, dMin: only this far out, big: height (m) above which an obstacle is registered, hull: an obstacle along
// the length, lowSkip: mostly left out on the low tier }, loD: on low, coarse twins from this far out (default 20 m;
// nearer frees triangles for more items in the band side views see).
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
function tree(sd, { h = 0.9, r = 0.5, pal, stalk = [[0.9, 0.85, 0.8]], mode = 0, fx = 0, det = 1 }) {
  const b = clump(sd, { n: 1, r: 0, h: h * 0.5, rad: r * 0.25, pal: stalk, blunt: true, radial: det ? 4 : 3 });
  const c = dome(sd + 3, { rx: r, h: h * 0.55, det, pal, cells: 3, mode, lump: 0.3, freq: 3, base: 0.75, fx });
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
// stronger colour for far palettes: the water and the shader's distance wash take most of it away
const vivid = (pal, k = 1.3) => pal.map((c) => { const l = (c[0] + c[1] + c[2]) / 3; return c.map((v) => Math.max(0.02, l + (v - l) * k)); });
// crowns (soft-coral trees, sponge tops...) set on a rock: a bommie covered in life
function crowned(sd, rockOpts, n, crown) {
  const b = rockB(sd, rockOpts), rt = b.build(), rng = mulberry32(sd * 59 + 3);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, q = rng() * 0.5, x = Math.cos(a) * q * rockOpts.sx, z = Math.sin(a) * q * (rockOpts.sz ?? rockOpts.sx);
    const y = rt.rayDown(x, z); // seated on the rock's real top surface
    if (y === -Infinity) continue;
    b.append(at(crown(sd * 13 + k, rng), x, y - 0.06, z));
  }
  return b;
}

// families of far templates, built once on first use
const FAM = {};
const fam = (k, f) => FAM[k] || (FAM[k] = f());
const P = () => REEF_PAL;
const SOFT = [[1.15, 0.32, 0.62], [1.1, 0.5, 0.2], [0.85, 0.35, 1.05], [1.15, 0.85, 0.25], [1.1, 0.25, 0.3], [1.0, 0.6, 0.85]];
const ANEM = [[0.8, 0.28, 0.92], [0.32, 0.82, 0.4], [1.1, 0.42, 0.62], [1.1, 0.66, 0.2], [0.95, 0.92, 0.72], [0.3, 0.55, 0.95]];
const coralT = () => fam('coral', () => {
  const p = P(), soft = vivid(SOFT, 1.1), anem = vivid(ANEM, 1.15);
  const tree1 = (sd, rng) => { const c = dome(sd, { rx: 0.35 + rng() * 0.2, h: 0.45, det: 0, pal: soft, cells: 2, mode: 0, lump: 0.3, freq: 3, base: 0.8 }); cullBase(c, 0.005); return c; };
  return {
    mound: many(8, (s) => { const o = { rx: 2.2 + (s % 3) * 0.3, rz: 1.7 + (s % 2) * 0.3, h: 0.7, pal: vivid(p.MOSAIC.concat(p.PAD), 1.2), cells: 6, mode: 9.08, kidPal: vivid(p.PORITES.concat(p.BRAINP)), kidMode: 2, kids: 2 }; return withLo(fin(mound(s, o)), fin(mound(s, { ...o, det: 0, kids: 1 }))); }),
    // a big bommie for the haze: a tall lumpy mound crowded with colonies (4-7 m across once scaled)
    bommie: many(5, (s) => { const o = { rx: 2.0, rz: 1.8, h: 1.8, pal: vivid(p.HEADP.concat(p.MOSAIC), 1.2), cells: 7, mode: 2, lump: 0.28, kids: 4, kidPal: vivid(p.PORITES.concat(p.ACRO)), kidMode: 9.1 }; return withLo(fin(mound(s, o)), fin(mound(s, { ...o, det: 0, kids: 2 }))); }, 30),
    // a spur of framework running across the slope
    ridge: many(4, (s) => { const o = { rx: 4.2, rz: 1.3, h: 0.9, pal: vivid(p.MOSAIC.concat(p.PAD), 1.2), cells: 8, mode: 9.08, kidPal: vivid(p.BRAINP), kidMode: 2, kids: 3 }; return withLo(fin(mound(s, o)), fin(mound(s, { ...o, det: 0, kids: 1 }))); }, 40),
    head: many(6, (s) => { const o = { rx: 1.0, h: 0.85, pal: vivid(s % 2 ? p.HEADP : p.BRAINP), cells: 3, mode: s % 2 ? 2 : 0.9, lump: 0.22 }; return withLo(fin(dome(s, o)), fin(dome(s, { ...o, det: 0 }))); }, 50),
    bush: many(5, (s) => tw((det) => fin(dome(s, { rx: 0.7, h: 0.45, det, pal: vivid(p.ACRO), cells: 3, mode: 9.12, lump: 0.3, freq: 3 }))), 90),
    branch: many(4, (s) => fin(clump(s, { n: 6, r: 0.5, h: 0.9, rad: 0.07, pal: vivid(p.ACRO), mode: 9.1, spread: 0.6 }), false), 120),
    table: many(3, (s) => { const b = clump(s, { n: 1, r: 0, h: 0.5, rad: 0.12, pal: p.TABLE, blunt: true }); b.append(at(dome(s + 5, { rx: 1.1, h: 0.18, det: 1, pal: vivid(p.TABLE), cells: 2, mode: 9.1 }), 0, 0.42, 0)); return fin(b, false); }, 140),
    fan: many(4, (s) => fin(blades(s, { n: 1, h: 1.4, w: 1.1, seg: 2, r: 0, pal: p.FANS, style: 0, amp: 0.08, lean: 0.05, taper: -0.2 }), false), 160),
    soft: many(4, (s) => fin(blades(s, { n: 5, h: 0.7, w: 0.22, seg: 2, r: 0.25, pal: p.SOFTC, style: 0, amp: 0.1, lean: 0.4, taper: 0.1 }), false), 180),
    sponge: many(3, (s) => fin(clump(s, { n: 4, r: 0.3, h: 0.9, rad: 0.12, pal: p.VIVID.concat(p.BARREL), mode: 2, spread: 0.2, blunt: true }), false), 200),
    softTree: many(6, (s) => tw((det) => fin(tree(s, { h: 1.0, r: 0.55, pal: soft, mode: 0, det }), false)), 220),
    // a rock smothered in soft-coral trees (the soft-coral garden's bommies)
    softRock: many(6, (s) => { const o = { sx: 1.5, sy: 1.0 + (s % 3) * 0.3, sz: 1.3, col: [0.55, 0.5, 0.52], growth: 0.8 }; return withLo(fin(crowned(s, o, 4, tree1), false), fin(crowned(s, { ...o, det: 0 }, 2, tree1), false)); }, 230),
    crust: many(5, (s) => tw((det) => fin(mound(s, { rx: 1.8, rz: 1.4, h: 0.9, det, pal: vivid([[0.95, 0.38, 0.6], [0.62, 0.32, 0.8], [1.05, 0.5, 0.22], [0.86, 0.72, 0.42], [0.5, 0.42, 0.36]]), cells: 6, mode: 2, kids: 1 + det, kidPal: soft }))), 240),
    carpet: many(6, (s) => withLo(fin(dome(s, { rx: 1.5, rz: 1.2, h: 0.45, pal: anem, cells: 8, mode: 2, lump: 0.25, freq: 3, base: 0.85 })), fin(dome(s, { rx: 1.5, rz: 1.2, h: 0.45, det: 0, pal: anem, cells: 4, mode: 2, base: 0.85 }))), 260),
    // anemones crowding the top of a rubble rock
    anemRock: many(5, (s) => tw((det) => fin(crowned(s, { sx: 1.3, sy: 0.7, sz: 1.1, col: [0.6, 0.56, 0.52], growth: 0.4, det }, 2 + 2 * det, (sd) => { const c = dome(sd, { rx: 0.45, h: 0.18, det: 0, pal: anem, cells: 2, mode: 2, base: 0.9 }); cullBase(c, 0.005); return c; }), false)), 280),
  };
});
const ROCK = [0.62, 0.6, 0.56];
const rockT = () => fam('rock', () => ({
  rock: many(6, (s) => { const o = { sx: 1, sy: 0.55 + (s % 3) * 0.15, sz: 0.8 + (s % 2) * 0.3, col: ROCK, growth: 0.5 }; return withLo(fin(rockB(s, o)), fin(rockB(s, { ...o, det: 0 }))); }, 300),
  pile: many(4, (s) => withLo(fin(pile(s, ROCK)), fin(pile(s, ROCK, 0))), 330),
  // a low outcrop of bedrock breaking through the sand
  outcrop: many(4, (s) => { const o = { sx: 3.2, sy: 0.7, sz: 1.6, col: ROCK, growth: 0.6, rough: 0.5 }; return withLo(fin(rockB(s, o)), fin(rockB(s, { ...o, det: 0 }))); }, 340),
  algae: many(4, (s) => fin(dome(s, { rx: 1.2, rz: 0.9, h: 0.3, pal: vivid([[0.3, 0.38, 0.12], [0.42, 0.34, 0.14], [0.26, 0.3, 0.1], [0.5, 0.44, 0.2]]), cells: 5, mode: 2, lump: 0.3, freq: 3, base: 0.7 })), 350),
  // a pale patch of shell hash and coral rubble on the sand, and a burrow mound
  shells: many(4, (s) => fin(dome(s, { rx: 1.6, rz: 1.1, h: 0.08, det: 1, pal: [[0.95, 0.9, 0.82], [0.85, 0.75, 0.68], [1.0, 0.82, 0.7], [0.7, 0.66, 0.6]], cells: 6, mode: 2, lump: 0.35, freq: 4, base: 0.9 })), 360),
  burrow: many(3, (s) => fin(dome(s, { rx: 0.6, h: 0.3, det: 0, pal: [[0.8, 0.74, 0.62], [0.72, 0.66, 0.55]], cells: 2, mode: 0, lump: 0.2, base: 0.85 })), 370),
}));
const kelpT = () => fam('kelp', () => ({
  // a kelp plant 10 m tall before its depth fit: crossed golden-brown ribbons of fronds round the stipes
  plant: many(5, (s) => fin(blades(s, { n: 3, h: 10, w: 0.9, seg: 6, r: 0.35, pal: vivid([[0.8, 0.6, 0.16], [0.68, 0.5, 0.14], [0.58, 0.42, 0.12]], 1.15), style: 1, amp: 0.9, lean: 0.06, tipK: 1.25, taper: 0.15 }), false), 400),
  under: many(3, (s) => fin(blades(s, { n: 7, h: 0.55, w: 0.09, seg: 2, r: 0.35, pal: [[0.35, 0.26, 0.07], [0.45, 0.36, 0.1], [0.5, 0.09, 0.1]], style: 2, amp: 0.2, lean: 0.35 }), false), 430),
  // a rock under red and olive understory turf (static: cheap, and it stands still at range)
  turfRock: many(4, (s) => tw((det) => fin(mound(s, { rx: 1.6, rz: 1.2, h: 0.7, det, pal: vivid([[0.42, 0.3, 0.12], [0.55, 0.14, 0.12], [0.32, 0.36, 0.14], [0.6, 0.4, 0.2]], 1.2), cells: 6, mode: 2, kids: 1 + det, lump: 0.3 }))), 440),
}));
const deepT = () => fam('deep', () => ({
  vase: many(4, (s) => fin(clump(s, { n: 1 + (s % 2), r: 0.25, h: 1.1, rad: 0.22, pal: [[0.85, 0.82, 0.72], [0.9, 0.86, 0.62], [0.78, 0.76, 0.7]], mode: 2, spread: 0.15, blunt: true, radial: 6 }), false), 500),
  xeno: many(3, (s) => fin(dome(s, { rx: 0.5, h: 0.35, pal: [[0.7, 0.66, 0.58], [0.6, 0.56, 0.5]], cells: 2, mode: 2, lump: 0.35, freq: 4 })), 520),
  pen: many(3, (s) => fin(blades(s, { n: 1, h: 0.7, w: 0.07, seg: 2, r: 0, pal: [[0.95, 0.6, 0.35], [0.9, 0.85, 0.75], [0.85, 0.4, 0.3]], style: 6, amp: 0.05, lean: 0.05, taper: 0.2 }), false), 540),
  softCold: many(4, (s) => fin(tree(s, { h: 0.8, r: 0.45, pal: vivid([[1.0, 0.5, 0.5], [0.95, 0.92, 0.88], [1.05, 0.6, 0.3]]), mode: 0 }), false), 560),
}));
const coldT = () => fam('cold', () => {
  const W = [0.68, 0.61, 0.46], O = [0.9, 0.33, 0.12], D = [0.2, 0.17, 0.13];
  return {
    mound: many(6, (s) => tw((det) => fin(mound(s, { rx: 2.0, rz: 1.6, h: 1.0, det, pal: [W, W, O, D, D, [0.3, 0.26, 0.2]], cells: 7, mode: 9.18, lump: 0.32, freq: 2.6, kids: 1 + det, kidPal: [W, O, W] }))), 600),
    big: many(4, (s) => withLo(fin(mound(s, { rx: 3.4, rz: 2.4, h: 1.8, pal: [W, W, O, D, [0.3, 0.26, 0.2]], cells: 8, mode: 9.18, lump: 0.35, freq: 2.4, kids: 4, kidPal: [W, O, W] })), fin(mound(s, { rx: 3.4, rz: 2.4, h: 1.8, det: 0, pal: [W, O, D], cells: 3, mode: 9.18, kids: 1, kidPal: [W] }))), 615),
    bush: many(5, (s) => tw((det) => fin(dome(s, { rx: 0.8, h: 0.7, det, pal: s % 3 ? [W, [0.62, 0.56, 0.42]] : [O, [0.75, 0.3, 0.13]], cells: 2, mode: 9.2, lump: 0.38, freq: 3.4, base: 0.6 }))), 630),
    sponge: many(3, (s) => fin(clump(s, { n: 3, r: 0.3, h: 0.7, rad: 0.15, pal: [[0.95, 0.75, 0.2], [1.0, 0.5, 0.15], [0.8, 0.78, 0.65]], mode: 2, spread: 0.25, blunt: true }), false), 660),
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
    mat: many(4, (s) => fin(dome(s, { rx: 1.8, rz: 1.3, h: 0.1, pal: [[0.85, 0.78, 0.4], [0.9, 0.88, 0.8], [0.75, 0.4, 0.12]], cells: 4, mode: 0, lump: 0.2, freq: 2, base: 0.9 })), 730),
    // a clump of white tube worms with red plumes
    worms: many(3, (s) => fin(clump(s, { n: 9, r: 0.45, h: 1.1, rad: 0.05, pal: [[0.9, 0.88, 0.82], [0.95, 0.25, 0.15]], mode: 0, spread: 0.3, radial: 3, blunt: true }), false), 760),
  };
});
const carbT = () => fam('carb', () => ({
  spire: many(5, (s) => fin(clump(s, { n: 2 + (s % 3), r: 0.6, h: 7, rad: 0.55, pal: [[0.86, 0.84, 0.78], [0.8, 0.78, 0.72], [0.92, 0.9, 0.84]], mode: 0, fx: 0.15, spread: 0.08, blunt: true, radial: 5 }), false), 800),
  rubble: many(4, (s) => fin(pile(s, [0.78, 0.76, 0.7])), 830),
}));
const woodT = () => fam('wood', () => {
  const Wd = [[0.26, 0.17, 0.09], [0.32, 0.22, 0.12], [0.22, 0.16, 0.11]];
  return {
    stump: many(5, (s) => fin(clump(s, { n: 1 + (s % 2), r: 0.3, h: 1.6, rad: 0.4, pal: Wd, mode: 0, fx: 0.3, spread: 0.1, blunt: true, radial: 5 }), false), 900),
    snag: many(4, (s) => fin(clump(s, { n: 4, r: 0.2, h: 5, rad: 0.18, pal: Wd, mode: 0, fx: 0.2, spread: 0.45, radial: 4 }), false), 930),
    // a drowned tree standing whole: trunk with a crown of bare branches (6-9 m once scaled)
    tree: many(3, (s) => { const b = clump(s, { n: 1, r: 0, h: 4, rad: 0.35, pal: Wd, blunt: true, radial: 5, fx: 0.3 }); b.append(at(clump(s + 9, { n: 6, r: 0.3, h: 3, rad: 0.12, pal: Wd, spread: 0.8, radial: 3, fx: 0.2 }), 0, 3.4, 0)); return fin(b, false); }, 945),
    log: many(4, (s) => fin(lying(s, { L: 5 + (s % 3), r: 0.35, pal: Wd, radial: 5, fx: 0.4 }), false), 960),
  };
});
const stoneT = () => fam('stone', () => {
  const S = [[0.82, 0.77, 0.68], [0.74, 0.69, 0.6], [0.86, 0.79, 0.66], [0.78, 0.7, 0.62]], m = (s) => 6.05 + (s % 7) * 0.12;
  const wallRow = (s, L, hMin, hMax) => { // a wall stub L m long along x, broken to an uneven top, a few blocks fallen at its foot
    const b = new Builder(), rng = mulberry32(s);
    for (let x = -L / 2; x < L / 2 - 0.4; x += 1.0) { if (rng() < 0.12) continue; const h = hMin + rng() * (hMax - hMin); box(b, 0.98, h, 0.7, x + 0.5, -0.05, (rng() - 0.5) * 0.06, S[(rng() * 4) | 0], m(s), 0.45); }
    for (let k = 0; k < 2; k++) box(b, 0.8, 0.5, 0.6, (rng() - 0.5) * L * 0.8, -0.05, 0.9 + rng() * 0.6, S[k % 4], m(s), 0.5, rng() * TAU);
    return b;
  };
  return {
    block: many(6, (s) => { const b = new Builder(), rng = mulberry32(s); for (let k = 0; k < 2 + (s % 3); k++) box(b, 0.8 + rng() * 0.6, 0.5 + rng() * 0.4, 0.6 + rng() * 0.4, (rng() - 0.5) * 1.6, -0.05, (rng() - 0.5) * 1.6, S[k % 4], m(s), 0.5, rng() * TAU); return fin(b, false); }, 1000),
    wall: many(6, (s) => fin(wallRow(s, 6 + (s % 3) * 2, 0.8, 2.8), false), 1030),
    // a colonnade: a row of columns 3 m apart, some broken low, a drum or two fallen beside them
    colonnade: many(4, (s) => {
      const b = new Builder(), rng = mulberry32(s), n = 3 + (s % 3);
      for (let k = 0; k < n; k++) { const x = (k - (n - 1) / 2) * 3, h = rng() < 0.3 ? 0.6 + rng() : 2.2 + rng() * 2.6; b.append(at(clump(s * 7 + k, { n: 1, r: 0, h, rad: 0.38, pal: S, mode: m(s), fx: 0.4, spread: 0, blunt: true, radial: 7 }), x, 0, 0)); box(b, 1.0, 0.3, 1.0, x, -0.05, 0, S[k % 4], m(s), 0.4); }
      b.append(at(lying(s, { L: 1.4, r: 0.38, pal: S, radial: 7, mode: m(s), fx: 0.5 }), 0, 0, 1.4));
      return fin(b, false);
    }, 1060),
    fallen: many(3, (s) => fin(lying(s, { L: 3.5 + s % 2, r: 0.4, pal: S, radial: 7, mode: m(s), fx: 0.5 }), false), 1090),
    platform: many(3, (s) => { const b = new Builder(); for (let k = 0; k < 3; k++) box(b, 6 - k * 1.6, 0.8, 6 - k * 1.6, 0, -0.05 + k * 0.8, 0, S[k % 4], m(s), 0.4); return fin(b, false); }, 1120),
    // a collapsed heap of blocks
    heap: many(4, (s) => { const b = new Builder(), rng = mulberry32(s); for (let k = 0; k < 9; k++) { const a = rng() * TAU, q = rng() * 1.6, h = 0.6 * (1 - q / 2) * rng(); b.box(0.9, 0.55, 0.7, mul3(rotY(rng() * TAU), rotX((rng() - 0.5) * 0.6)), Math.cos(a) * q, h + 0.2, Math.sin(a) * q, S[k % 4], [0.5, m(s)]); } return fin(b, false); }, 1150),
    // big silhouettes for the haze: a stepped temple mound and a broken tower (10-14 m once scaled)
    stepped: many(2, (s) => { const b = new Builder(); for (let k = 0; k < 5; k++) box(b, 12 - k * 2.2, 1.6, 12 - k * 2.2, 0, -0.05 + k * 1.6, 0, S[k % 4], m(s), 0.5); box(b, 2.2, 2.4, 2.2, 0, 7.95, 0, S[1], m(s), 0.5); return fin(b, false); }, 1180),
    tower: many(2, (s) => { const b = new Builder(), rng = mulberry32(s); box(b, 4, 6, 4, 0, -0.05, 0, S[0], m(s), 0.45); box(b, 3.4, 3 + rng() * 3, 3.4, 0.2, 5.9, -0.1, S[2], m(s), 0.45); box(b, 1.6, 2, 1.4, -0.6, 8.8, 0.6, S[3], m(s), 0.45); return fin(b, false); }, 1190),
  };
});
const wreckT = () => fam('wreck', () => {
  const Rr = [[0.4, 0.22, 0.13], [0.32, 0.25, 0.2], [0.45, 0.28, 0.16]];
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
const sandTint = (k, mul = 1) => { const c = BIOMES[k].sand; return tinted([[c[0] * mul, c[1] * mul, c[2] * mul]], 0.08); };
export function initFarField() {
  if (built) return;
  built = true;
  const c = coralT(), r = rockT();
  const reefKinds = [
    K(4, c.mound, [0.8, 1.5], { ys: [0.7, 1.2], cr: 4.5 }),
    K(1.2, c.bommie, [0.9, 1.6], { big: 2.5, n: [1, 2], cr: 4 }),
    K(1.0, c.ridge, [0.8, 1.4], { ys: [0.7, 1.1] }),
    K(2, c.head, [0.9, 2.0], { big: 2.2 }),
    K(1.4, c.bush, [0.8, 1.6], { n: [2, 5] }),
    K(1.0, c.branch, [0.8, 1.6], { n: [2, 4], cr: 2.5, lowSkip: true }),
    K(0.8, c.table, [0.8, 1.6]),
    K(1.0, c.fan, [0.8, 1.5], { cr: 2.5, sway: true, lowSkip: true }),
    K(0.8, c.soft, [0.8, 1.5], { n: [2, 4], cr: 2.5, sway: true, lowSkip: true }),
    K(0.6, c.sponge, [0.8, 1.5], { cr: 2, lowSkip: true }),
  ];
  // in: lateral fade-in [start, full] from the edge of the flight tube; the hero footprint test keeps items out
  // of the hero clusters, so they fill the ground around and between them
  // ---- coral family (habitat zones: covered, with sand channels and bare patches the minority)
  FAR.reef = { capK: 1.0, in: [14, 34], cell: 6, dens: 2.6, floor: 0.35, kinds: reefKinds }; // (kept: the reference)
  const reefFar = [K(3, c.bommie, [1.0, 1.7], { big: 2.5 }), K(2, c.ridge, [0.9, 1.5], { ys: [0.7, 1.1] }), K(2, c.mound, [1.0, 1.6], { ys: [0.8, 1.3] })];
  FAR.wall = { capK: 1.1, far: reefFar, maxSlope: 0.45, in: [5, 14], cell: 5, dens: 2.5, floor: 0.45, deep: 25, loD: 12, kinds: reefKinds };
  FAR.bluehole = { far: reefFar, maxSlope: 0.45, in: [5, 16], cell: 6, dens: 2.0, floor: 0.45, deep: 20, kinds: reefKinds };
  FAR.softcoral = { capK: 1.3, far: [K(3, c.softRock, [1.1, 1.9], { big: 2.5 }), K(2, c.bommie, [0.9, 1.5], { big: 2.5 }), K(1.5, c.crust, [1.0, 1.7])], maxSlope: 0.45, in: [4, 12], cell: 4, dens: 2.0, floor: 0.3, loD: 12, kinds: [
    K(4, c.softRock, [0.9, 1.8], { n: [1, 3], cr: 4, big: 2.5 }), K(2.5, c.softTree, [0.9, 1.8], { n: [3, 6], cr: 3 }), K(1.5, c.crust, [0.9, 1.6], { cr: 4 }),
    K(0.8, c.bommie, [0.8, 1.4], { big: 2.5 }), K(1.2, c.fan, [0.9, 1.6], { sway: true, lowSkip: true }), K(0.8, r.pile, [0.8, 1.6], { tint: rockTint('softcoral') }),
  ] };
  FAR.champagne = { capK: 0.95, far: [K(2, c.softRock, [1.0, 1.7]), K(2, c.bommie, [0.9, 1.4]), K(1.5, r.outcrop, [0.9, 1.5], { tint: rockTint('champagne', 0.9) })], maxSlope: 0.45, in: [4, 12], cell: 5, dens: 1.6, floor: 0.35, loD: 12, kinds: [
    K(2, c.head, [0.8, 1.6], { n: [2, 4] }), K(2, c.softRock, [0.8, 1.5]), K(1.5, c.softTree, [0.8, 1.4], { n: [2, 4] }),
    K(1.5, r.pile, [0.7, 1.5], { tint: rockTint('champagne', 0.9) }), K(1.5, c.crust, [0.8, 1.4]), K(1, c.mound, [0.8, 1.3]),
  ] };
  FAR.anemone = { capK: 0.76, far: [K(3, c.anemRock, [1.1, 1.9], { n: [1, 2] }), K(2, c.carpet, [1.2, 2.0], { n: [1, 3] }), K(1, r.outcrop, [0.9, 1.5], { tint: rockTint('anemone') })], maxSlope: 0.45, in: [4, 12], cell: 4, dens: 2.0, floor: 0.3, loD: 8, kinds: [
    K(4, c.carpet, [0.9, 1.8], { n: [2, 5], cr: 4 }), K(4, c.anemRock, [0.9, 1.7], { n: [1, 3], cr: 3.5 }), K(0.8, r.rock, [0.7, 1.6], { tint: rockTint('anemone') }),
    K(1, r.shells, [0.9, 1.5], { n: [1, 2] }), K(0.4, c.softTree, [0.8, 1.3]),
  ] };
  FAR.seamount = { capK: 1.3, far: [K(3, r.pile, [1.2, 2.2], { tint: rockTint('seamount'), big: 2 }), K(2, r.outcrop, [1.0, 1.8], { tint: rockTint('seamount') }), K(1, c.softRock, [1.0, 1.6])], maxSlope: 0.45, in: [5, 16], cell: 5, dens: 2.2, floor: 0.4, loD: 12, kinds: [
    K(3, r.pile, [0.9, 2.0], { tint: rockTint('seamount'), big: 2 }), K(2, r.outcrop, [0.8, 1.6], { tint: rockTint('seamount') }), K(2.5, c.fan, [1.0, 2.0], { sway: true, n: [2, 5] }),
    K(1.5, c.sponge, [0.9, 1.6], { n: [1, 3] }), K(1.5, c.crust, [0.9, 1.5]), K(1, c.softRock, [0.8, 1.4]),
  ] };
  const cc = coldT();
  FAR.coldcoral = { capK: 1.0, far: [K(3, cc.big, [1.0, 1.6], { big: 2.4 }), K(2, cc.mound, [1.0, 1.8])], in: [5, 16], cell: 7, dens: 2.0, dark: 60, floor: 0.35, kinds: [
    K(3, cc.mound, [0.9, 1.8], { big: 2.4, cr: 4 }), K(1.5, cc.big, [0.9, 1.5], { big: 2.4, n: [1, 1] }), K(2.5, cc.bush, [0.8, 1.6], { n: [2, 6] }),
    K(1, cc.sponge, [0.8, 1.4]), K(1, r.rock, [0.7, 1.5], { tint: rockTint('coldcoral') }),
  ] };
  FAR.tidepool = { in: [4, 10], cell: 5, dens: 0.8, floor: 0.4, kinds: [
    K(3, r.pile, [0.6, 1.3], { tint: rockTint('tidepool', 1.1) }), K(2, c.carpet, [0.6, 1.1], { n: [1, 3] }), K(1, r.algae, [0.6, 1.2]),
  ] };
  // ---- kelp family: plants follow the forest's own grove field, so the canopy overhead has stipes under it
  const kp = kelpT(), kelpKinds = (k) => [
    K(4, kp.plant, [0.8, 1.3], { fit: 0.9, sway: true, n: [2, 4], cr: 3.5, upright: true }),
    K(2.5, kp.turfRock, [0.8, 1.7], { n: [1, 3] }), K(2, r.rock, [0.8, 2.0], { tint: rockTint(k, 1.1) }), K(1.5, r.pile, [0.8, 1.6], { tint: rockTint(k, 1.1) }),
    K(1.5, kp.under, [0.9, 1.5], { sway: true, n: [2, 4], lowSkip: true }),
  ];
  FAR.kelp = { capK: 0.65, swayLow: true, in: [5, 16], cell: 6, dens: 2.2, floor: 0.25, grove: true, kinds: kelpKinds('kelp') };
  FAR.otterkelp = { capK: 0.65, swayLow: true, in: [5, 16], cell: 6, dens: 2.2, floor: 0.3, kinds: kelpKinds('otterkelp') };
  // ---- meadows and shallows
  const gr = grassT();
  if (gr.patch.length) {
    FAR.seagrass = { capK: 0.6, swayLow: true, in: [26, 40], cell: 5, dens: 2.0, floor: 0.35, meadow: true, kinds: [
      K(6, gr.patch, [0.95, 1.25], { sway: true, n: [3, 6], cr: 3, upright: true, tint: tinted([[1, 1, 1], [1.1, 1.05, 0.88]], 0.1) }),
      K(0.5, r.rock, [0.5, 1.2], { tint: rockTint('seagrass', 1.1) }), K(0.5, r.shells, [0.8, 1.3]),
    ] };
    const shallows = (k) => [K(3, gr.patch, [0.8, 1.1], { sway: true, n: [2, 5], upright: true }), K(2.5, r.algae, [0.7, 1.4], { n: [1, 3] }), K(1.5, r.rock, [0.5, 1.2], { tint: rockTint(k, 1.2) })];
    FAR.mangrove = { capK: 0.95, swayLow: true, in: [5, 14], cell: 5, dens: 1.2, floor: 0.35, maxSlope: 0.45, kinds: shallows('mangrove') };
    FAR.biobay = { swayLow: true, in: [6, 18], cell: 6, dens: 0.7, dark: 60, floor: 0.3, kinds: shallows('biobay') };
    FAR.sandflat = { capK: 0.6, in: [8, 18], cell: 7, dens: 1.4, loD: 12, floor: 0.3, hk: 1.6, kinds: [
      K(2, c.head, [0.6, 1.2], { n: [2, 5], cr: 4 }), K(1, c.bush, [0.7, 1.3], { n: [1, 3] }), K(2, r.outcrop, [0.6, 1.2], { tint: rockTint('sandflat', 1.15) }),
      K(2, r.rock, [0.5, 1.3], { tint: rockTint('sandflat', 1.15) }), K(2, r.shells, [0.8, 1.5], { n: [1, 3] }), K(1.5, r.burrow, [0.8, 1.4], { n: [2, 5], cr: 3, tint: sandTint('sandflat', 1.0) }),
      K(1.5, gr.patch, [0.8, 1.1], { sway: true, n: [2, 4], upright: true, lowSkip: true }),
    ] };
  }
  FAR.jellylake = { in: [6, 16], cell: 6, dens: 1.0, floor: 0.3, maxSlope: 0.4, kinds: [K(3, r.algae, [0.8, 1.5], { n: [2, 4] }), K(1, c.sponge, [0.7, 1.2]), K(1, r.rock, [0.6, 1.3], { tint: rockTint('jellylake', 1.1) })] };
  // ---- sand, silt and lava: sparse, but never empty
  const dp = deepT();
  FAR.whaleshark = { in: [8, 20], cell: 9, dens: 0.6, floor: 0.15, capK: 0.6, kinds: [K(2, r.rock, [0.7, 1.6], { tint: rockTint('whaleshark', 1.2) }), K(1.5, r.outcrop, [0.7, 1.3], { tint: rockTint('whaleshark', 1.2) }), K(1.5, r.algae, [0.8, 1.4]), K(1, r.shells, [0.9, 1.5])] };
  FAR.whalefall = { in: [12, 26], cell: 9, dens: 0.7, floor: 0.15, capK: 0.6, carcass: 15, kinds: [
    K(3, r.pile, [0.8, 1.6], { tint: tinted([[0.3, 0.28, 0.27], [0.26, 0.24, 0.24]]) }), K(1.5, r.outcrop, [0.7, 1.4], { tint: tinted([[0.28, 0.26, 0.25]]) }), K(1, c.head, [0.6, 1.1]),
    K(1, r.rock, [0.6, 1.4], { tint: rockTint('whalefall') }), K(1, r.shells, [0.8, 1.4]),
  ] };
  FAR.deepplain = { in: [6, 18], cell: 8, dens: 0.8, dark: 55, floor: 0.2, capK: 0.7, kinds: [
    K(2, dp.vase, [0.8, 1.5]), K(2, dp.pen, [1.0, 1.6], { sway: true, n: [2, 5], lowSkip: true }), K(1, r.rock, [0.6, 1.3], { tint: rockTint('deepplain') }), K(1.5, dp.xeno, [0.8, 1.5], { n: [2, 5] }),
    K(1, r.burrow, [0.7, 1.2], { n: [2, 4], tint: sandTint('deepplain', 1.1) }),
  ] };
  FAR.hadal = { in: [6, 20], cell: 8, dens: 0.6, dark: 50, floor: 0.25, maxSlope: 0.35, capK: 0.6, kinds: [K(1, dp.vase, [0.7, 1.3], { maxSlope: 0.35 }), K(2, r.rock, [0.8, 1.8], { tint: rockTint('hadal', 1.2), maxSlope: 0.35 }), K(1.5, dp.xeno, [0.8, 1.4], { maxSlope: 0.35, n: [2, 4] })] };
  const icy = (k) => [K(2, r.pile, [0.9, 1.8], { tint: rockTint(k, 1.2) }), K(1.5, r.outcrop, [0.8, 1.5], { tint: rockTint(k, 1.2) }), K(1, dp.vase, [0.8, 1.4]), K(1.5, dp.softCold, [0.8, 1.5], { n: [2, 4] })];
  FAR.polar = { in: [6, 18], cell: 8, dens: 0.9, floor: 0.25, capK: 0.7, kinds: icy('polar') };
  FAR.iceedge = { in: [6, 18], cell: 8, dens: 0.9, floor: 0.25, capK: 0.7, kinds: icy('iceedge') };
  // ---- vents, carbonate towers, drowned forest
  const vt = ventT(), cb = carbT(), wd = woodT();
  FAR.vents = { capK: 0.7, in: [6, 18], cell: 8, dens: 1.2, dark: 90, floor: 0.3, kinds: [
    K(2.5, vt.chimney, [0.6, 1.4], { big: 2.5, cr: 5, n: [1, 3], upright: true }), K(2, r.pile, [0.8, 1.7], { tint: rockTint('vents', 1.1) }), K(2, vt.mat, [0.8, 1.5], { n: [1, 3] }),
    K(1.5, vt.worms, [0.8, 1.4], { n: [1, 3], upright: true }),
  ] };
  FAR.lostcity = { in: [6, 18], cell: 8, dens: 1.2, dark: 60, floor: 0.3, kinds: [
    K(3, cb.spire, [0.5, 1.3], { big: 2.5, cr: 4, n: [1, 4], upright: true }), K(2, cb.rubble, [0.7, 1.5], { n: [1, 3] }),
  ] };
  FAR.sunkenforest = { capK: 0.85, in: [6, 18], cell: 5, dens: 1.8, floor: 0.35, loD: 12, kinds: [
    K(3, wd.stump, [0.8, 1.5], { big: 1.8, upright: true, n: [1, 4] }), K(1.5, wd.snag, [0.7, 1.3], { big: 2.5, upright: true }), K(1, wd.tree, [0.8, 1.3], { big: 2.5, upright: true, n: [1, 2] }),
    K(2, wd.log, [0.8, 1.4], { n: [1, 3] }), K(1, r.rock, [0.6, 1.3], { tint: rockTint('sunkenforest', 1.1) }), K(1, r.algae, [0.8, 1.4]),
  ] };
  // ---- wrecks and ruins: debris fields and more hull outlines; a ruined city on a street grid
  const wr = wreckT(), stn = stoneT();
  FAR.wreck = { capK: 0.55, in: [6, 16], cell: 5, dens: 1.5, floor: 0.25, loD: 12, kinds: [
    K(3, wr.plate, [1.0, 1.8], { n: [2, 5], cr: 4 }), K(2, wr.frames, [1.0, 1.6], { n: [1, 3], upright: true }), K(1.5, wr.girder, [1.0, 1.6], { n: [1, 3] }),
    K(0.8, wr.boiler, [0.9, 1.3], { n: [1, 1] }), K(1.5, r.pile, [0.9, 1.7], { tint: rockTint('wreck', 1.1) }), K(1, r.outcrop, [0.7, 1.3], { tint: rockTint('wreck', 1.1) }),
    K(0.5, wr.hull, [9, 16], { n: [1, 1], dMin: 50, hull: true, upright: true }),
  ], feats: { n: [1, 2], kind: { t: wr.hull, sc: [10, 16], hull: true, upright: true }, d: [45, 85] } };
  FAR.ruins = { capK: 0.7, in: [5, 14], cell: 5, dens: 2.0, floor: 0.35, grid: 17, loD: 10, kinds: [
    K(3, stn.wall, [0.9, 1.3], { big: 2.2, line: true, n: [1, 3] }), K(1.5, stn.colonnade, [0.9, 1.2], { big: 2.2, line: true, n: [1, 2] }),
    K(2, stn.block, [0.8, 1.4], { n: [2, 4], cr: 3.5 }), K(1.5, stn.heap, [0.9, 1.5], { n: [1, 2] }), K(1, stn.fallen, [0.8, 1.2], { upright: true }),
    K(0.8, stn.platform, [0.8, 1.3], { n: [1, 1], dMin: 20, big: 1.5, line: true }),
  ], feats: { n: [2, 3], kind: { t: [...stn.stepped, ...stn.tower], sc: [0.9, 1.25], big: 3, line: true }, d: [40, 90] } };
  T.far = FAR;
}

// ---------- hero footprints ----------
// Every hero populator's meshes are stamped into a 1 m grid of the chunk (highest point per cell), so far items
// can keep off them whatever module made them (NB zones and the ruins register no occupancy).
const HERO = new WeakMap(), HJ = 4, HH = 64 + 2 * HJ;
const _v = [0, 0, 0];
function heroGrid(ctx, make = true) {
  let g = HERO.get(ctx.group);
  if (!g && make) { const x0 = Math.floor(ctx.xMin) - 4, W = Math.ceil(ctx.xMax - ctx.xMin) + 8; g = { x0, W, top: new Float32Array(W * HH).fill(-1e9) }; HERO.set(ctx.group, g); }
  return g;
}
function stamp(g, s0, x, y, s) {
  const i = Math.floor(x - g.x0), j = Math.floor(s - s0) + HJ;
  if (i < 0 || j < 0 || i >= g.W || j >= HH) return;
  const k = j * g.W + i;
  if (y > g.top[k]) g.top[k] = y;
}
function xf(e, x, y, z) { _v[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; _v[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; _v[2] = e[2] * x + e[6] * y + e[10] * z + e[14]; return _v; }
// As each hero populator returns its meshes, only references are queued (their typed arrays stay readable after
// the GPU upload drops the attribute's own reference); the far layout stamps them in budgeted steps.
const HEROQ = new WeakMap();
function recordHero(ctx, obj) {
  let q = HEROQ.get(ctx.group);
  if (!q) HEROQ.set(ctx.group, (q = []));
  obj.updateMatrixWorld(true);
  obj.traverse((m) => {
    if (!m.isMesh || !m.geometry) return;
    const e = m.matrixWorld.elements, geo = m.geometry, id = e[0] === 1 && e[5] === 1 && e[10] === 1 && !e[12] && !e[13] && !e[14] && !e[1] && !e[2] && !e[4] && !e[6] && !e[8] && !e[9];
    if (m.isInstancedMesh) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      q.push({ inst: true, A: m.instanceMatrix.array, n: m.count, bb: geo.boundingBox, e: id ? null : e.slice() });
    } else {
      const P = geo.attributes.position && geo.attributes.position.array, I = geo.index && geo.index.array;
      if (P && I) q.push({ inst: false, P, I, e: id ? null : e.slice() });
    }
  });
}
// stamping steps for the queued hero meshes: STAMP vertices or STAMP_T triangles per step
const STAMP = 12000, STAMP_T = 1000;
function stampSteps(ctx, g) {
  const q = HEROQ.get(ctx.group), out = [];
  if (!q) return out;
  HEROQ.delete(ctx.group);
  const s0 = ctx.s0;
  for (const m of q) {
    if (m.inst) { out.push(() => stampInst(g, s0, m)); continue; }
    const nv = m.P.length / 3, nt = m.I.length / 3;
    for (let a = 0; a < nv; a += STAMP) out.push(() => stampVerts(g, s0, m, a, Math.min(nv, a + STAMP)));
    for (let a = 0; a < nt; a += STAMP_T) out.push(() => stampBig(g, s0, m, a, Math.min(nt, a + STAMP_T)));
  }
  return out;
}
function stampInst(g, s0, m) { // a disc of the template's footprint at each instance, at its top height
  const A = m.A, bb = m.bb, rx = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z), e = m.e;
  for (let n = 0; n < m.n; n++) {
    const o = n * 16, sx = Math.hypot(A[o], A[o + 1], A[o + 2]), sy = Math.hypot(A[o + 4], A[o + 5], A[o + 6]);
    let px = A[o + 12], py = A[o + 13], pz = A[o + 14];
    if (e) { const p = xf(e, px, py, pz); px = p[0]; py = p[1]; pz = p[2]; }
    const top = py + bb.max.y * sy, ps = s0 - pz, rad = Math.min(4, rx * sx * 0.8);
    for (let dx = -rad; dx <= rad; dx += 1) for (let dz = -rad; dz <= rad; dz += 1) if (dx * dx + dz * dz <= rad * rad + 0.5) stamp(g, s0, px + dx, top, ps + dz);
  }
}
function stampVerts(g, s0, m, a, b) {
  const P = m.P, e = m.e;
  for (let v = a; v < b; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (e) { const p = xf(e, x, y, z); x = p[0]; y = p[1]; z = p[2]; }
    stamp(g, s0, x, y, s0 - z);
  }
}
// big triangles (walls, hull plates, platforms) cover cells their corners miss: sample their insides every ~1 m
function stampBig(g, s0, m, a, b) {
  const P = m.P, I = m.I, e = m.e;
  for (let t = a; t < b; t++) {
    const ia = I[t * 3] * 3, ib = I[t * 3 + 1] * 3, ic = I[t * 3 + 2] * 3;
    const span = Math.max(Math.abs(P[ib] - P[ia]), Math.abs(P[ic] - P[ia]), Math.abs(P[ib + 2] - P[ia + 2]), Math.abs(P[ic + 2] - P[ia + 2]));
    if (span < 2 && !e) continue;
    let p = e ? xf(e, P[ia], P[ia + 1], P[ia + 2]) : [P[ia], P[ia + 1], P[ia + 2]]; const ax = p[0], ay = p[1], az = p[2];
    p = e ? xf(e, P[ib], P[ib + 1], P[ib + 2]) : [P[ib], P[ib + 1], P[ib + 2]]; const bx = p[0], by = p[1], bz = p[2];
    p = e ? xf(e, P[ic], P[ic + 1], P[ic + 2]) : [P[ic], P[ic + 1], P[ic + 2]]; const cx = p[0], cy = p[1], cz = p[2];
    const sp = Math.max(Math.abs(bx - ax), Math.abs(cx - ax), Math.abs(bz - az), Math.abs(cz - az));
    if (sp < 2) continue;
    const top = Math.max(ay, by, cy), n = Math.min(10, Math.ceil(sp / 1.2));
    for (let u = 0; u <= n; u++) for (let v = 0; u + v <= n; v++) {
      const fu = u / n, fv = v / n, fw = 1 - fu - fv;
      stamp(g, s0, ax * fw + bx * fu + cx * fv, top, s0 - (az * fw + bz * fu + cz * fv));
    }
  }
}
// is there a hero prop standing above y0 + 0.25 within r of (x, s)?
function heroAt(g, s0, x, s, r, y0) {
  if (!g) return false;
  const lim = y0 + 0.25;
  for (let dx = -r; dx <= r + 0.5; dx += 1) for (let ds = -r; ds <= r + 0.5; ds += 1) {
    if (dx * dx + ds * ds > r * r + 1) continue;
    const i = Math.floor(x + dx - g.x0), j = Math.floor(s + ds - s0) + HJ;
    if (i < 0 || j < 0 || i >= g.W || j >= HH) continue;
    if (g.top[j * g.W + i] > lim) return true;
  }
  return false;
}

// ---------- layout ----------
const fogOf = (k) => { const sg = BIOMES[k].sigma; return Math.min(330, Math.max(90, 4.5 / Math.min(sg[1], sg[2]))); };
const DMAX = {};
function dMax(k, low) {
  const id = k + (low ? '|l' : '');
  return DMAX[id] ?? (DMAX[id] = low ? Math.min(100, fogOf(k) * 0.58) : Math.min(158, fogOf(k) * 0.9));
}
// the zone at s chosen for a cell (weighted by the cross-fade, deterministic per cell)
function zoneAt(ctx, s, u) {
  const ws = ctx.weights(s);
  let acc = 0;
  for (const e of ws) { acc += e.w; if (u < acc) return e; }
  return ws[ws.length - 1];
}
// per-segment landmarks (ruin silhouettes, hull outlines): positions drawn from the segment seed
function feats(g, R) {
  if (g._farFeats) return g._farFeats;
  const rng = mulberry32((g.seed ^ 0xfea7) | 0), F = R.feats, n = F.n[0] + Math.floor(rng() * (F.n[1] - F.n[0] + 1)), out = [], L = g.end - g.start;
  for (let k = 0; k < n; k++) out.push({ s: g.start + L * (0.15 + 0.7 * (k + rng()) / n), side: rng() < 0.5 ? -1 : 1, d: F.d[0] + rng() * (F.d[1] - F.d[0]), k: (rng() * 1e9) | 0 });
  return (g._farFeats = out);
}

export function layoutFarField(ctx) {
  const tierK = TIER[ctx.tier] ?? 1, low = ctx.tier === 'low';
  // any zone in this chunk with a far recipe?
  let any = false, capK = 0;
  for (const g of ctx.segments) { const R = FAR[g.key]; if (R) { any = true; capK = Math.max(capK, R.capK ?? 1); } }
  if (!any) return null;
  const gnd = groundOf(ctx), hero = heroGrid(ctx);
  const cap = (CAP[ctx.tier] ?? CAP.high) * capK;
  // one batch per material: their slices are spatially sorted (core.staged), so the side out of view is culled
  const st = new Batch(MAT.static, cap), sw = new Batch(MAT.sway, cap);
  const env = { ctx, gnd, hero, st, sw, low, cap, left: { tris: cap } };
  const more = stampSteps(ctx, hero), s0 = ctx.s0, s1 = ctx.s1;
  // landmarks first (they claim their ground before the grid fills it)
  for (const g of ctx.segments) {
    const R = FAR[g.key];
    if (!R || !R.feats) continue;
    for (const f of feats(g, R)) if (f.s >= s0 && f.s < s1) more.push(() => {
      const x = ctx.pathX(f.s) + f.side * f.d;
      if (x < ctx.xMin + 8 || x > ctx.xMax - 8) return;
      place(env, R, { key: g.key, g, w: 1 }, R.feats.kind, x, f.s, f.d, 1, mulberry32(f.k), R.grid ? gridAngle(g) : null);
    });
  }
  // cells: a global grid per zone cell size (so neighbouring chunks agree)
  const cells = [], cellOf = new Map();
  for (const g of ctx.segments) { const R = FAR[g.key]; if (R && !cellOf.has(R.cell)) cellOf.set(R.cell, true); }
  for (const c of cellOf.keys()) {
    const i0 = Math.floor(ctx.xMin / c), i1 = Math.floor(ctx.xMax / c), j0 = Math.floor(s0 / c), j1 = Math.floor(s1 / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells.push(c, i, j);
  }
  // nearer bands first (15 m bands, shuffled within each), so a capped chunk spends its triangles where the eye looks
  const pm = ctx.pathX(s0 + 32), order = Array.from({ length: cells.length / 3 }, (_, k) => k);
  const key = order.map((k) => Math.floor(Math.abs((cells[k * 3 + 1] + 0.5) * cells[k * 3] - pm) / 15) + hash2i(cells[k * 3 + 1], cells[k * 3 + 2], 0xfa7));
  order.sort((a, b) => key[a] - key[b]);
  const per = 8; // cells per continuation step (a cluster of big items costs up to ~0.5 ms: a step stays under ~2 ms)
  for (let k0 = 0; k0 < cells.length; k0 += per * 3) more.push(() => {
    for (let k = k0; k < Math.min(cells.length, k0 + per * 3); k += 3) {
      if (env.left.tris <= 0) return;
      const o = order[k / 3] * 3, c = cells[o], i = cells[o + 1], j = cells[o + 2];
      const h1 = hash2i(i, j, 0xfa1 + c), h2 = hash2i(i, j, 0xfa2 + c);
      const s = (j + h2) * c, x = (i + h1) * c;
      if (s < s0 || s >= s1 || x < ctx.xMin + 2 || x > ctx.xMax - 2) continue;
      const e = zoneAt(ctx, s, hash2i(i, j, 0xfa3 + c) * 0.9999), R = FAR[e.key];
      if (!R || R.cell !== c) continue;
      const px = ctx.pathX(s), d = Math.abs(x - px), D = Math.min(dMax(e.key, low), R.dark ?? 999);
      if (d < R.in[0] || d > D || (d < FAR_D && env.left.tris < env.cap * FAR_SHARE)) continue;
      const hab = habAt(R, e, x, s, x - px);
      const p = R.dens * tierK * sstep(R.in[0] - 0.01, R.in[1], d) * (1 - sstep(D * 0.75, D, d)) * (1 - 0.45 * sstep(50, D, d)) * (R.floor + (1 - R.floor) * hab);
      const rng = mulberry32((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ c) | 0);
      if (rng() >= p) continue;
      cluster(env, R, e, x, s, d, hab, rng);
    }
  });
  more.push(() => HERO.delete(ctx.group)); // (the footprint grid is done with)
  return { batches: [st, sw], more };
}

// habitat richness 0..1 for a recipe: the world-space habitat field, or the zone's own field where it has one
// (the kelp's groves, under its canopy; the seagrass meadow and its sandy gaps)
function habAt(R, e, x, s, dx) {
  const h = habitat(x, s, R.hk ?? 1);
  if (R.grove) return e.g ? kelpGrove(x, s, e.g, dx) * (0.5 + 0.5 * h) : h;
  if (R.meadow) return sstep(-0.32, -0.2, seagrassMeadow(x, s)) * (0.35 + 0.65 * h);
  return h;
}
// street grid of a ruins segment: rotated per segment, streets every R.grid m
function gridAngle(g) { return g ? sv(g, 77) * Math.PI * 0.5 : 0; }
function cluster(env, R, e, cx, cs, cd, hab, rng) {
  // a cluster leans on one kind (gardens of one growth form), the rest mixed
  const kinds = cd > FAR_D && R.far ? R.far : R.kinds, main = pickW(rng, kinds), n = main.n[0] + Math.floor(rng() * (main.n[1] - main.n[0] + 1));
  // richer ground grows bigger colonies; farther out the big structures (bommies, stands) are what reads
  const big = (0.85 + 0.35 * hab) * (1 + (R.grow ?? 0.5) * sstep(30, 110, cd));
  if (R.grid && main.line) { // ruins: a run of walls / colonnades along the nearest street of the segment's grid
    if (main.dMin && cd < main.dMin) return;
    const th = gridAngle(e.g), ca = Math.cos(th), sa = Math.sin(th), B = R.grid;
    const u = cx * ca + cs * sa, v = -cx * sa + cs * ca, alongU = rng() < 0.5;
    let u0 = u, v0 = v;
    if (alongU) v0 = Math.round(v / B) * B + (rng() < 0.5 ? -2 : 2); else u0 = Math.round(u / B) * B + (rng() < 0.5 ? -2 : 2);
    const step = main === R.kinds[0] ? 8.5 : 9.5; // wall runs / colonnades, with gaps (fallen stretches)
    for (let q = 0; q < n; q++) {
      const t = (q - (n - 1) / 2) * step + (rng() - 0.5) * 1.5, uu = alongU ? u0 + t : u0, vv = alongU ? v0 : v0 + t;
      const x = uu * ca - vv * sa, s = uu * sa + vv * ca;
      place(env, R, e, main, x, s, cd, big, rng, alongU ? th : th + Math.PI / 2);
    }
    return;
  }
  for (let q = 0; q < n; q++) {
    const K = q === 0 || rng() < 0.6 ? main : pickW(rng, kinds);
    if ((env.low && ((K.lowSkip && rng() < 0.6) || (K.sway && !R.swayLow))) || (K.dMin && cd < K.dMin)) continue;
    const a = rng() * TAU, rr = q ? K.cr * Math.sqrt(rng()) : 0;
    place(env, R, e, K, cx + Math.cos(a) * rr, cs + Math.sin(a) * rr, cd, big, rng, K.line && R.grid ? gridAngle(e.g) : null);
  }
}
const _R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// one item of kind K at (x, s); yaw: null = random
function place(env, R, e, K, x, s, cd, big, rng, yaw) {
  const { ctx, gnd, hero } = env;
  if (s < ctx.s0 || s >= ctx.s1) return;
  let tpl = K.t[(rng() * K.t.length) | 0];
  if (tpl.lo && cd > (env.low ? R.loD ?? 20 : LO_D)) tpl = tpl.lo;
  if (env.left.tris < tpl.tris) return;
  const sc = (K.sc[0] + (K.sc[1] - K.sc[0]) * Math.pow(rng(), 1.4)) * (K.hull || R.feats && K === R.feats.kind ? 1 : big);
  const fy = gnd.floor(x, s), ny = gnd.ny;
  if (ny < (K.maxSlope ?? R.maxSlope ?? 0.6)) return; // a steep face: nothing settles there
  if (R.deep && fy < ctx.pathY(s) - R.deep) return;
  if (R.carcass && e.g) { const W = whaleFallOf(e.g); if (W && Math.hypot(x - W.x, s - W.s) < W.L / 2 + R.carcass) return; } // the carcass keeps its clearing
  // kelp plants reach up to just under the surface, whatever the depth
  const ys = K.fit ? Math.min(3, Math.max(0.3, (ctx.surfaceY - 0.8 - fy) * K.fit / (tpl.maxY * sc))) * (0.9 + 0.1 * rng())
    : K.ys ? K.ys[0] + (K.ys[1] - K.ys[0]) * rng() : 0.85 + 0.3 * rng();
  const hgt = tpl.maxY * sc * ys;
  if (fy + hgt > ctx.surfaceY - SURF) return;
  if (BIOMES[e.key].ceil && ctx.ceilingAt(x, s) < fy + hgt + 0.6) return;
  // keep off every hero prop (their footprint grid) and the old props' occupancy
  const fr = Math.max(0.6, tpl.r * sc * 0.75);
  if (heroAt(hero, ctx.s0, x, s, fr, fy) || !gnd.free(x, s, fr * 0.9, 0) || !gnd.free(x, s, fr * 0.9, 2)) return;
  // near the route: the flight tube rules (low solids under the path, tall ones 3.5 m off it, soft ones off the lens)
  const pd = Math.abs(x - ctx.pathX(s));
  if (pd < 16 && !propClear(ctx, x, s, fy, fy + hgt, tpl.r * sc, !!K.sway)) return;
  const Rm = yaw !== null && yaw !== undefined ? rotY(yaw + (rng() - 0.5) * 0.12) : K.sway || K.upright ? rotY(rng() * TAU) : orient(gnd.nx, ny, gnd.nz, K.follow ?? 0.35, rng() * TAU);
  // seat on the floor under the whole base (small things: the hull of their contact band); skip what would
  // straddle a ledge (a terrace step) and end up buried deep on its high side
  const y = groundY({ at: (px, ps) => gnd.floor(px, ps) }, x, s, tpl, Rm, sc, sc * ys, sc, tpl.r * sc < 1.2) - Math.min(0.06 * hgt, 0.12) - 0.01;
  if (fy - y > Math.max(0.35, 0.5 * hgt)) return;
  const c = K.tint ? K.tint(rng) : _R;
  const B = K.sway ? env.sw : env.st;
  if (!B.add(tpl, x, y, -(s - ctx.s0), Rm, sc, sc * ys, sc, c[0], c[1], c[2], K.sway ? sc : 0.4 + 0.4 * rng())) return;
  env.left.tris -= tpl.tris;
  B.last.g = 1; // floor-seated: covered by the contact audit
  // claim the ground: later far items keep off it too
  if (hero) for (let dx = -fr; dx <= fr; dx += 1) for (let ds = -fr; ds <= fr; ds += 1) if (dx * dx + ds * ds <= fr * fr) stamp(hero, ctx.s0, x + dx, y + hgt, s + ds);
  if (!ctx.addObstacle || ctx._farObs >= 16) return; // (at most 16 per chunk: only the big ones matter to swimmers)
  if (K.hull) { // a capsule along the hull's length
    const hl = sc * 0.8, r = sc * 0.16, ax = Rm[0] * hl, az = Rm[6] * hl;
    ctx.addObstacle(x - ax, y + r * 0.6, s + az, x + ax, y + r * 0.6, s - az, r); ctx._farObs = (ctx._farObs || 0) + 1;
  } else if (K.big && hgt > K.big) { const r = tpl.r * sc * 0.75; ctx.addObstacle(x, y + Math.min(r, hgt * 0.5), s, x, y + Math.max(hgt - r, hgt * 0.5), s, r); ctx._farObs = (ctx._farObs || 0) + 1; }
}

export const FARSTATS = { hero: 0, heroMax: 0 }; // ms spent stamping hero meshes (total, slowest single stamp)
export function registerFarField(terrain, env) {
  initFarField();
  // every populator registered so far stamps its meshes into the chunk's hero footprint grid as it returns them
  const has = (ctx) => ctx._farAny ?? (ctx._farAny = ctx.segments.some((g) => FAR[g.key]));
  for (let i = 0; i < terrain.populators.length; i++) {
    const p = terrain.populators[i];
    terrain.populators[i] = (ctx) => {
      const r = p(ctx);
      if (r && r.object && has(ctx)) { const t0 = performance.now(); recordHero(ctx, r.object); const dt = performance.now() - t0; FARSTATS.hero += dt; if (dt > FARSTATS.heroMax) FARSTATS.heroMax = dt; }
      return r;
    };
  }
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
