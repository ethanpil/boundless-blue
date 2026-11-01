// Organism and rock templates for seamount, blue hole, sunken forest and champagne reef. Colours are
// linear RGB, mostly near-neutral so per-instance tints give the hue. Every template grows from local
// y = 0 (its base) unless noted. Sway-material templates use aFx.x = sway amplitude, aFx.y = style.
import { Builder, TAU, vn3, fbm3, sat, sstep, lerp } from './core.js';
import { branchesInto, rockInto } from './shapes.js';
import { mulberry32 } from '../noise.js';
import { setBase } from './nb_common.js';
import { ground } from './nb_shapes.js';

const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------------------------------------------------------- giant gorgonian sea fan
// A broad netted fan (sway style 4: the shader cuts the sheet into a lattice) on a short stout trunk,
// primary branches radiating within the sheet, irregular lobed outline, cupped into the current.
// Optionally two or three overlapping lobes. Base at the origin; the fan lies in the local x-y plane.
export function giantFan(seed, { h = 2.2, lobes = 1, cup = 0.08 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 131 + 7);
  const trunkH = h * (0.08 + rng() * 0.08), rb = Math.max(0.03, h * 0.02);
  b.tube([[0, -0.05, 0], [0, trunkH * 0.6, 0], [(rng() - 0.5) * 0.05, trunkH, 0]], [rb * 1.6, rb * 1.2, rb], 5, (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.5; o[6] = 0; o[7] = 0; });
  const sway = (y) => 0.025 * h * Math.pow(sat(y / h), 1.6);
  const curveZ = (x, y) => cup * x * x / h + 0.015 * h * Math.sin(x * 3.1 / h + y * 2.3 / h + seed);
  for (let L = 0; L < lobes; L++) {
    const lh = h * (L ? 0.55 + rng() * 0.3 : 1), tilt = L ? (rng() - 0.5) * 1.1 : (rng() - 0.5) * 0.25, ox = L ? (rng() - 0.5) * h * 0.35 : 0, W0 = 0.75 + rng() * 0.35;
    const zoff = L ? (rng() < 0.5 ? -1 : 1) * h * (0.06 + rng() * 0.06) : 0;
    const ct = Math.cos(tilt), st = Math.sin(tilt), W = lh * W0;
    const fr = 5 + Math.floor(rng() * 6), ph = rng() * 6, spread = 2.0 + rng() * 0.8;
    // sheet: polar grid from just above the trunk, irregular rim
    const R = (u) => lh * (0.92 + 0.06 * Math.sin(u * fr + ph) + 0.035 * Math.sin(u * 13 + ph * 2) + 0.06 * vn3(u * 3, L, 0, seed)) * (1 - 0.18 * Math.pow(Math.abs(u - 0.5) * 2, 3));
    const P = (u, v) => {
      const a = (u - 0.5) * spread, r = lh * 0.08 + v * (R(u) - lh * 0.08);
      let x = Math.sin(a) * r * (W / lh) * 1.25, y = Math.cos(a) * r;
      const xr = x * ct - y * st, yr = x * st + y * ct;
      x = xr + ox; y = Math.max(trunkH * 0.6, yr + trunkH * 0.7);
      return [x, y, curveZ(x, y) + zoff * sat(v * 1.5)];
    };
    b.grid(16, 9, (u, v, i, j, o) => {
      const p = P(u, v); o[0] = p[0]; o[1] = p[1]; o[2] = p[2];
      const t = sat(p[1] / h), edge = v > 0.92 ? 1.15 : 1;
      o[3] = o[4] = o[5] = (0.62 + 0.45 * t) * edge; o[6] = sway(p[1]); o[7] = 1;
    });
    // primary / secondary branches running inside the sheet (thicker ribs)
    const nP = 4 + Math.floor(rng() * 4);
    for (let k = 0; k < nP; k++) {
      const u0 = (k + 0.5) / nP + (rng() - 0.5) * 0.08, pts = [], rad = [];
      for (let i = 0; i <= 6; i++) { const v = i / 6 * (0.75 + rng() * 0.2), p = P(u0 + (rng() - 0.5) * 0.02 * i, v); pts.push([p[0], p[1], p[2] + 0.004]); rad.push(rb * 0.55 * (1 - 0.75 * (i / 6)) + 0.004); }
      b.tube(pts, rad, 3, (v, a, x, y, z, o, j) => { const t = sat(y / h); o[3] = o[4] = o[5] = 0.5 + 0.4 * t; o[6] = sway(y); o[7] = 0; });
      if (rng() < 0.7) { // a fork off the middle
        const j0 = 2 + Math.floor(rng() * 2), u1 = u0 + (rng() < 0.5 ? -1 : 1) * (0.04 + rng() * 0.05), q = [pts[j0]];
        for (let i = 1; i <= 3; i++) { const p = P(u1, (j0 + i * 1.1) / 6 * 0.85); q.push([p[0], p[1], p[2] + 0.004]); }
        b.tube(q, [rad[j0] * 0.8, rad[j0] * 0.6, rad[j0] * 0.45, 0.004], 3, (v, a, x, y, z, o) => { const t = sat(y / h); o[3] = o[4] = o[5] = 0.5 + 0.4 * t; o[6] = sway(y); o[7] = 0; });
      }
    }
  }
  const t = b.build();
  setBase(t, [rb * 1.4, -0.05, 0, -rb * 1.4, -0.05, 0, 0, -0.05, rb * 1.4, 0, -0.05, -rb * 1.4]);
  // creature capsules: rows across the fan plane
  const [x0, y0, , x1, y1] = t.box, obs = [];
  for (let k = 0; k < 3; k++) {
    const y = y0 + (y1 - y0) * (0.3 + 0.27 * k), w = (x1 - x0) * (k === 2 ? 0.3 : 0.4);
    obs.push([(x0 + x1) / 2 - w, y, 0.03, (x0 + x1) / 2 + w, y, 0.03, (y1 - y0) * 0.16]);
  }
  t.obs = obs; t.solid = true;
  return t;
}

// Wire coral (Cirrhipathes): one unbranched whip, often coiled into a corkscrew toward the tip.
export function wireCoral(seed, { L = 1.6 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 977 + 3), coil = rng() < 0.6, turns = 2 + rng() * 4, cr = 0.04 + rng() * 0.08;
  const lean = rng() * TAU, la = 0.15 + rng() * 0.4, pts = [], rad = [];
  const n = coil ? 20 : 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n, c = coil ? sstep(0.25, 0.6, t) : 0, ang = t * turns * TAU;
    pts.push([Math.cos(lean) * la * t * L + Math.cos(ang) * cr * c, t * L * (1 - 0.15 * t), Math.sin(lean) * la * t * L + Math.sin(ang) * cr * c]);
    rad.push(0.01 * (1 - 0.6 * t) + 0.002);
  }
  b.tube(pts, rad, 3, (v, a, x, y, z, o, j) => { const t = j / n; o[3] = o[4] = o[5] = 0.8 + 0.3 * t; o[6] = 0.12 * L * t * t; o[7] = 0; }, { tip: true });
  const tp = b.build(); tp.solid = false;
  return tp;
}

// "Christmas tree" black coral (Antipathes): a tall stem with dense, short side branchlets, conical.
export function xmasBlackCoral(seed, { h = 1.4 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 313 + 11), pts = [], rad = [], bend = (rng() - 0.5) * 0.3;
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([bend * t * t * h, t * h, 0.05 * Math.sin(t * 4 + seed)]); rad.push(h * 0.018 * (1 - 0.7 * t) + 0.003); }
  b.tube(pts, rad, 4, (v, a, x, y, z, o, j) => { o[3] = o[4] = o[5] = j < 2 ? 0.25 : 0.8; o[6] = 0.03 * h * (j / 8) ** 2; o[7] = 0; });
  const nb = 34 + Math.floor(rng() * 22);
  for (let k = 0; k < nb; k++) {
    const t = 0.15 + 0.82 * (k / nb), p = [bend * t * t * h, t * h, 0.05 * Math.sin(t * 4 + seed)], a = k * 2.39996 + rng() * 0.5;
    const L = h * 0.4 * Math.pow(1 - t, 0.8) * (0.6 + 0.6 * rng()) + 0.05, d = nrm([Math.cos(a), 0.3 + rng() * 0.35, Math.sin(a)]);
    b.tube([p, [p[0] + d[0] * L * 0.5, p[1] + d[1] * L * 0.5, p[2] + d[2] * L * 0.5], [p[0] + d[0] * L, p[1] + d[1] * L + 0.02, p[2] + d[2] * L]], [0.006, 0.004, 0.002], 3,
      (v, an, x, y, z, o) => { const tt = sat(y / h); o[3] = o[4] = o[5] = 0.85 + 0.25 * v; o[6] = 0.035 * h * tt * tt + 0.01 * v; o[7] = 0; });
  }
  const tp = b.build(); tp.solid = false;
  return tp;
}

// ---------------------------------------------------------------- polyp carpets
// Jewel anemones (Corynactis) or zoanthids: a dense cluster of small polyps, each a short column with an
// oral disc and a ring of knobbed tentacles. Static material (mode 2 rugosity).
export function polypMat(seed, { n = 22, r = 0.22, size = 0.025, zoanthid = false } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 523 + 5);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = r * Math.sqrt(rng()), cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const s = size * (0.7 + 0.6 * rng()), h = s * (zoanthid ? 1.2 + rng() : 0.8 + rng() * 0.6), v0 = b.vc;
    // short column (5 sides) and a domed oral disc whose rim carries the tentacle knobs
    b.lathe(5, 1, (v) => [s * (0.8 + 0.25 * v), v * h], null, (v, an, x, y, z, o) => { o[3] = o[4] = o[5] = 0.55 + 0.3 * v; o[6] = 0; o[7] = 2; });
    b.grid(8, 1, (u, v, i, j, o) => {
      const an = u * TAU, knob = zoanthid ? 0.12 * Math.sin(an * 8) : 0.28 * Math.max(0, Math.sin(an * 4)), rr = (zoanthid ? 1.3 : 1.2) * s * (1 - v) * (1 + knob);
      o[0] = Math.cos(an) * rr; o[1] = h + 0.004 + v * s * 0.25; o[2] = Math.sin(an) * rr;
      o[3] = o[4] = o[5] = v === 0 ? 1.15 : 0.75; o[6] = 0; o[7] = 2;
    }, { wrapU: true, flip: true });
    for (let i = v0; i < b.vc; i++) { b.P[i * 3] += cx; b.P[i * 3 + 2] += cz; }
  }
  // a thin encrusting skin they share
  b.blob(1, (x, y, z, o) => { o[0] = x * r * 1.1; o[1] = Math.max(0, y) * 0.012; o[2] = z * r * 1.1; o[3] = o[4] = o[5] = 0.45; o[6] = 0; o[7] = 2; });
  const t = ground(b).build(); t.solid = false;
  return t;
}

// ---------------------------------------------------------------- rock shelves
// A ledge / roof slab jutting horizontally out of a wall along local +z; its back half (z < 0) is meant
// to be buried in the rock. Base points along the buried back edge (seated against the wall).
export function shelf(seed, { w = 3, d = 1.8, th = 0.6, col = [0.6, 0.56, 0.5], growth = 0.9, under = 0.6, rough = 0.3 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 811 + 9);
  rockInto(b, seed + 4400, { detail: 3, sx: w / 2, sy: th, sz: d / 2 + 0.6, rough, flat: 0.1, growth, col, strata: 0.04 + rng() * 0.04 });
  // shift so the back face sits behind z = 0; darken the underside (shade)
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => { const k = ny < -0.2 ? under : 1; o[0] *= k; o[1] *= k; o[2] *= k; });
  for (let i = 0; i < b.vc; i++) b.P[i * 3 + 2] += d * 0.25;
  const t = b.build(), P = t.pos, pts = [];
  for (let i = 0; i < t.vc; i++) if (P[i * 3 + 2] < t.box[2] + (t.box[5] - t.box[2]) * 0.2) pts.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const step = Math.max(1, Math.floor(pts.length / 3 / 16)) * 3, sub = [];
  for (let i = 0; i < pts.length; i += step) sub.push(pts[i], pts[i + 1], pts[i + 2]);
  setBase(t, sub);
  const [x0, y0, z0, x1, y1, z1] = t.box, r = Math.max(th, 0.3);
  t.obs = [[x0 + r, (y0 + y1) / 2, (z0 + z1) / 2, x1 - r, (y0 + y1) / 2, (z0 + z1) / 2, Math.max(r, (z1 - z0) / 2) * 0.95]];
  t.support = true;
  return t;
}

// ---------------------------------------------------------------- speleothems (blue hole)
// Stalactites authored upside down: base at y = 0, growing toward +y (place with the up axis pointing
// down). Clusters of 1-6 cones with dripstone banding; curtains (draperies) as thin wavy sheets.
const LIME = [0.62, 0.58, 0.5];
export function stalactites(seed, { n = 4, L = 2.2, r = 0.32, curtain = false } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 199 + 1);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = k ? r * (0.8 + rng() * 2.2) : 0, len = L * (k ? 0.3 + rng() * 0.6 : 1), rr = r * (k ? 0.4 + rng() * 0.5 : 1), v0 = b.vc;
    b.lathe(9, 8, (v) => [rr * (Math.pow(1 - v, 1.35) * 0.95 + 0.04 + 0.04 * Math.sin(v * 27 + k) * (1 - v)), v * len], (an, v) => 1 + 0.16 * vn3(Math.cos(an) * 1.5, v * 4, Math.sin(an) * 1.5, seed + k),
      (v, an, x, y, z, o) => { const band = 0.85 + 0.18 * Math.sin(v * 40 + seed + k); const ao = 0.6 + 0.4 * (1 - v); o[3] = LIME[0] * band * ao; o[4] = LIME[1] * band * ao; o[5] = LIME[2] * band * ao; o[6] = 0.05; o[7] = 6.2 + (seed % 7) * 0.1; });
    for (let i = v0; i < b.vc; i++) { b.P[i * 3] += Math.cos(a) * d; b.P[i * 3 + 1] -= 0.06; b.P[i * 3 + 2] += Math.sin(a) * d; }
  }
  if (curtain) { // a dripstone curtain: thin folded sheet with a wavy lower edge
    const W = L * (0.8 + rng() * 0.8), Hc = L * (0.5 + rng() * 0.4), ox = (rng() - 0.5) * r * 2, ph = rng() * 6;
    for (const side of [1, -1]) b.grid(14, 4, (u, v, i, j, o) => {
      const x = (u - 0.5) * W + ox, fold = 0.08 * Math.sin(u * 19 + ph) + 0.05 * Math.sin(u * 7 + ph);
      const hh = Hc * (1 - 0.35 * Math.abs(u - 0.5) * 2) * (1 + 0.15 * Math.sin(u * 23 + ph));
      o[0] = x; o[1] = v * hh - 0.06; o[2] = fold * (1 + v) + side * 0.02 * (1 - v);
      const band = 0.8 + 0.25 * Math.sin(v * 30 + u * 5); o[3] = LIME[0] * band * 1.08; o[4] = LIME[1] * band * 1.04; o[5] = LIME[2] * band; o[6] = 0.05; o[7] = 6.25;
    }, { flip: side < 0 });
  }
  const t = b.build(), pts = [];
  // attached around the root of each cone (all at y ~ -0.06 .. 0)
  const P = t.pos;
  for (let i = 0; i < t.vc; i++) if (P[i * 3 + 1] < -0.02) pts.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const step = Math.max(1, Math.floor(pts.length / 3 / 14)) * 3, sub = [];
  for (let i = 0; i < pts.length; i += step) sub.push(pts[i], pts[i + 1], pts[i + 2]);
  setBase(t, sub.length ? sub : [0, -0.06, 0]);
  t.label = curtain ? 'Dripstone curtain' : 'Stalactites';
  t.fact = curtain ? 'Curtains form where drips run down a sloping ceiling, leaving a thin wavy sheet of calcite.'
    : 'These grew in air during the ice ages, when sea level was 120 m lower and this hole was a dry cave.';
  return t;
}
export function stalagmite(seed, { H = 1.6, r = 0.35 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 271 + 5), tiers = rng() < 0.4;
  b.lathe(10, 9, (v) => {
    let w = r * (Math.pow(1 - Math.pow(v, 1.6), 0.75) + 0.05) + 0.03 * Math.sin(v * 21 + seed) * (1 - v);
    if (tiers) w *= 1 + 0.18 * Math.max(0, Math.sin(v * 14 + seed));
    return [w, v * H - 0.08];
  }, (an, v) => 1 + 0.14 * vn3(Math.cos(an) * 1.5, v * 3, Math.sin(an) * 1.5, seed + 3),
  (v, an, x, y, z, o) => { const band = 0.84 + 0.18 * Math.sin(v * 34 + seed); const ao = 0.55 + 0.45 * v; o[3] = LIME[0] * band * ao; o[4] = LIME[1] * band * ao; o[5] = LIME[2] * band * ao; o[6] = 0.15; o[7] = 6.15 + (seed % 5) * 0.1; });
  const t = b.build();
  t.label = 'Stalagmite'; t.fact = 'Stalagmites only grow in air: this one stopped growing when the sea flooded the cave.';
  return t;
}

// ---------------------------------------------------------------- sunken forest life
// Plumose anemone (Metridium): a tall smooth column crowned by a lobed, frilly mass of fine tentacles.
// Sway material style 3 (tentacle wiggle) on the crown.
export function plumose(seed, { h = 0.25 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 401 + 3), r = h * (0.17 + rng() * 0.06), lean = (rng() - 0.5) * 0.2;
  b.lathe(7, 3, (v) => [r * (1.2 - 0.3 * v + 0.12 * Math.sin(v * 3)), v * h], null, (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.8 + 0.2 * v; o[6] = 0; o[7] = 0; });
  // crown: a fluffy mass of frilled lobes (fine tentacles read as the polyp rugosity texture)
  const lobes = 3 + Math.floor(rng() * 3), cr = r * (1.4 + rng() * 0.5);
  for (let k = 0; k < lobes; k++) {
    const a = (k / lobes) * TAU + rng() * 0.6, out = cr * (0.55 + 0.25 * rng()), up = h + r * (0.5 + rng() * 0.6);
    const c = [Math.cos(a) * out + lean * up, up, Math.sin(a) * out], rx = cr * (0.75 + 0.3 * rng()), ry = cr * (0.5 + 0.25 * rng());
    b.blob(1, (x, y, z, o) => {
      const frill = 1 + 0.22 * Math.abs(Math.sin(Math.atan2(z, x) * 7 + y * 5 + k)) + 0.15 * vn3(x * 4 + k, y * 4, z * 4, seed);
      o[0] = c[0] + x * rx * frill; o[1] = c[1] + y * ry * frill; o[2] = c[2] + z * rx * frill;
      o[3] = o[4] = o[5] = 0.95 + 0.2 * Math.max(0, y); o[6] = 0; o[7] = 2;
    });
  }
  b.blob(1, (x, y, z, o) => { o[0] = x * cr * 0.8 + lean * h; o[1] = h + r * 0.4 + y * cr * 0.45; o[2] = z * cr * 0.8; o[3] = o[4] = o[5] = 1.0; o[6] = 0; o[7] = 2; });
  const t = ground(b).build();
  setBase(t, [r, 0, 0, -r, 0, 0, 0, 0, r, 0, 0, -r, 0, 0, 0]);
  t.solid = false;
  t.label = 'Plumose anemone'; t.fact = 'Plumose anemones clone themselves by tearing off bits of their base, carpeting wrecks and pilings.';
  return t;
}
// Filamentous algae streamers: a tuft of thin ribbons drifting down-current from their holdfast
// (sway style 1, surge). Base at the origin; ribbons trail along local +x and downward.
export function streamers(seed, { L = 1.0, n = 5 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 733 + 9);
  for (let k = 0; k < n; k++) {
    const len = L * (0.5 + 0.8 * rng()), w = 0.006 + rng() * 0.012, a = (rng() - 0.5) * 0.7, droop = 0.45 + rng() * 0.6, nseg = 8;
    const side = [Math.sin(a) * 0.3, 0, Math.cos(a)], c = 0.7 + 0.35 * rng(), lift = (rng() - 0.3) * 0.15;
    const v0 = b.vc;
    for (let i = 0; i <= nseg; i++) {
      const t = i / nseg, ww = w * (0.5 + 0.9 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.8)) + 0.0015;
      const p = [Math.cos(a) * t * len * (1 - 0.35 * droop * t), (lift - droop * t) * t * len - 0.02 * t, Math.sin(a) * t * len + 0.06 * Math.sin(t * 7 + k) * t + 0.03 * Math.sin(t * 13 + k * 2) * t];
      const tw = Math.sin(t * 4 + k * 1.7) * 0.8, sx = side[0] * Math.cos(tw), sy = Math.sin(tw), sz = side[2] * Math.cos(tw);
      const sw = 0.22 * len * t * t + 0.01, cc = c * (0.8 + 0.35 * t);
      b.v(p[0] - sx * ww, p[1] - sy * ww, p[2] - sz * ww, 0, 1, 0, cc, cc, cc, sw, 0);
      b.v(p[0] + sx * ww, p[1] + sy * ww, p[2] + sz * ww, 0, 1, 0, cc * 1.08, cc * 1.08, cc * 1.08, sw, 0);
    }
    for (let i = 0; i < nseg; i++) { const q = v0 + i * 2; b.t(q, q + 2, q + 1); b.t(q + 1, q + 2, q + 3); }
  }
  b.smooth(0, 0);
  const t = b.build();
  setBase(t, [0, 0, 0]);
  t.solid = false;
  t.label = 'Filamentous algae'; t.fact = 'Fine algae streamers trail downstream, showing which way the current flows.';
  return t;
}
// Fallen twig / branchlet lying on the silt (static, bark-like vertex colour).
export function twig(seed) {
  const b = new Builder(), rng = mulberry32(seed * 97 + 13), L = 0.4 + rng() * 1.0, r = 0.012 + rng() * 0.02;
  const c = [0.38 + rng() * 0.1, 0.32 + rng() * 0.08, 0.25 + rng() * 0.06];
  const pts = []; for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push([t * L - L / 2, r * 0.9, 0.05 * Math.sin(t * 3 + seed) * L]); }
  b.tube(pts, pts.map((_, i) => r * (1 - i * 0.12)), 4, (v, a, x, y, z, o) => { o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = 0.2; o[7] = 0; });
  for (let k = 0, n = Math.floor(rng() * 3); k < n; k++) { // side twigs, lying flat
    const t = 0.3 + rng() * 0.5, p = [t * L - L / 2, r * 0.8, 0.05 * Math.sin(t * 3 + seed) * L], a = (rng() < 0.5 ? 1 : -1) * (0.5 + rng() * 0.6), l = L * (0.2 + rng() * 0.3);
    b.tube([p, [p[0] + Math.cos(a) * l * 0.5, r * 0.6, p[2] + Math.sin(a) * l * 0.5], [p[0] + Math.cos(a) * l, r * 0.5, p[2] + Math.sin(a) * l]], [r * 0.6, r * 0.45, r * 0.3], 3, (v, an, x, y, z, o) => { o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = 0.2; o[7] = 0; });
  }
  const t = b.build();
  t.label = 'Fallen branch'; t.solid = false;
  return t;
}

// ---------------------------------------------------------------- volcanic rocks (champagne reef)
// Vesicular scoria / basalt boulder: dark, pitted, iron-stained, with pale bacterial film in hollows.
export function scoria(seed, { s = 1 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 619 + 23);
  const sx = s * (0.7 + rng() * 0.5), sz = s * (0.6 + rng() * 0.45), sy = s * (0.4 + rng() * 0.35), ox = rng() * 30, key = 6.05 + rng() * 0.9;
  b.blob(3, (x, y, z, o) => {
    let d = 1 + 0.22 * fbm3(x * 1.2 + ox, y * 1.2, z * 1.2, 3, seed) + 0.06 * vn3(x * 5 + ox, y * 5, z * 5, seed + 3);
    d -= 0.1 * sstep(0.35, 0.6, vn3(x * 7.5 + ox, y * 7.5, z * 7.5, seed + 5)); // vesicles
    let py = y * d;
    if (py < -0.3) py = -0.3 + (py + 0.3) * 0.1;
    o[0] = x * d * sx; o[1] = (py + 0.3) * sy; o[2] = z * d * sz;
  });
  let top = 0; for (let i = 1; i < b.P.length; i += 3) top = Math.max(top, b.P[i]);
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => {
    const h = sat(y / (top + 1e-3)), ao = (0.45 + 0.55 * sstep(0, 0.8, h)) * (0.75 + 0.25 * Math.max(0, ny));
    const rust = sstep(0.2, 0.6, vn3(x * 2.2, y * 1.2, z * 2.2, seed + 9)), film = sstep(0.45, 0.7, vn3(x * 4, y * 4, z * 4, seed + 11)) * (1 - h);
    let r = 0.3 + 0.12 * rust, g = 0.28 + 0.03 * rust, bl = 0.29 - 0.06 * rust;
    r = lerp(r, 0.75, film * 0.5); g = lerp(g, 0.72, film * 0.5); bl = lerp(bl, 0.62, film * 0.5);
    o[0] = r * ao; o[1] = g * ao; o[2] = bl * ao; o[3] = 0.22 * sstep(0.3, 0.9, ny); o[4] = key;
  });
  b.band = 0.06;
  const t = b.build();
  t.label = 'Volcanic boulder'; t.fact = 'Gas bubbles frozen in cooling lava leave the rock full of holes: scoria.';
  t.support = true;
  return t;
}

// Tree soft coral (NBMAT.soft: aFx.y = 0 polyp bundles, 1 translucent stalk). Two growth forms:
// 'tree' (Dendronephthya: stout stalk, branches ending in grape-like polyp bundles) and 'cauli'
// (a rounded cauliflower crown of lobes on a short trunk).
export function softTree(seed, { h = 0.8, form = 'tree', lod = 0 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 389 + 17), tips = [];
  const sway = (y) => 0.05 * h * sat(y / h) ** 2;
  const trunkH = h * (form === 'cauli' ? 0.25 + rng() * 0.1 : 0.18 + rng() * 0.15);
  b.tube([[0, -0.03, 0], [0.01, trunkH * 0.5, 0], [(rng() - 0.5) * 0.04, trunkH, (rng() - 0.5) * 0.04]], [h * 0.075, h * 0.062, h * 0.05], 4, (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.95; o[6] = sway(y); o[7] = 1; });
  if (form === 'cauli') {
    const n = lod ? 4 : 7 + Math.floor(rng() * 5);
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU, e = rng() * 0.9, rr = h * (0.13 + rng() * 0.09), d = h * 0.2;
      const c = [Math.cos(a) * Math.cos(e) * d, trunkH + h * 0.18 + Math.sin(e) * d, Math.sin(a) * Math.cos(e) * d];
      b.blob(lod ? 0 : 1, (x, y, z, o) => {
        const q = 1 + 0.22 * vn3(x * 3 + k, y * 3, z * 3, seed) + 0.1 * vn3(x * 8, y * 8, z * 8, seed + k);
        o[0] = c[0] + x * rr * q; o[1] = c[1] + y * rr * q * 0.85; o[2] = c[2] + z * rr * q;
        o[3] = o[4] = o[5] = 0.85 + 0.25 * Math.max(0, y); o[6] = sway(o[1]); o[7] = y < -0.5 ? 1 : 0;
      });
    }
  } else {
    const nMain = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < nMain; k++) {
      const a = (k / nMain) * TAU + rng() * 0.6, out = 0.35 + rng() * 0.5;
      branchesInto(b, rng, {
        depth: 1, len: h * (0.32 + rng() * 0.16), rad: h * 0.032, radial: 3, segs: lod ? 1 : 2, kids: lod ? [1, 2] : [2, 3], spread: 0.5 + rng() * 0.3, up: 0.12, wiggle: 0.25,
        lenK: 0.62, radK: 0.72, tipK: 0.6, childAt: [0.45, 1], tip: false,
        paint(level, v, x, y, z, o) { o[3] = o[4] = o[5] = 0.95; o[6] = sway(y); o[7] = 1; },
        onTip(p) { tips.push(p); },
      }, [0, trunkH * (0.75 + 0.2 * rng()), 0], [Math.cos(a) * out, 1, Math.sin(a) * out]);
    }
    for (const p of tips) {
      const n = lod ? 1 : 2 + Math.floor(rng() * 2), s = h * (lod ? 0.11 : 0.085) * (0.8 + 0.4 * rng());
      for (let q = 0; q < n; q++) {
        const c = [p[0] + (rng() - 0.5) * s * 1.8, p[1] + (rng() - 0.3) * s * 1.2, p[2] + (rng() - 0.5) * s * 1.8], k = q + rng() * 10;
        b.blob(0, (x, y, z, o) => {
          const d = 1 + 0.22 * vn3(x * 3 + k, y * 3, z * 3, seed);
          o[0] = c[0] + x * s * d; o[1] = c[1] + y * s * d * 0.9; o[2] = c[2] + z * s * d;
          o[3] = o[4] = o[5] = 0.85 + 0.25 * Math.max(0, y); o[6] = sway(o[1]); o[7] = 0;
        });
      }
    }
  }
  const t = ground(b).build(), rb = h * 0.05;
  setBase(t, [rb, 0, 0, -rb, 0, 0, 0, 0, rb, 0, 0, -rb, 0, 0, 0]);
  t.label = form === 'cauli' ? 'Cauliflower soft coral' : 'Tree soft coral (Dendronephthya)';
  t.fact = 'Without algae of its own, it pumps itself up with water and feeds on plankton carried by the current.';
  t.solid = false;
  return t;
}

// Speleothem column: a stalactite and a stalagmite grown together (unit height; scale y to the gap).
export function speleoColumn(seed, { r = 0.45 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 457 + 3), waist = 0.25 + rng() * 0.3, wy = 0.35 + rng() * 0.35;
  b.lathe(11, 12, (v) => {
    const d = Math.abs(v - wy) / (v < wy ? wy : 1 - wy);
    return [r * (waist + (1 - waist) * Math.pow(d, 1.6)) * (1 + 0.06 * Math.sin(v * 31 + seed)), v - 0.04 + v * 0.08];
  }, (an, v) => 1 + 0.12 * vn3(Math.cos(an) * 1.5, v * 5, Math.sin(an) * 1.5, seed) + 0.06 * Math.abs(Math.sin(an * 5 + v * 9)),
  (v, an, x, y, z, o) => { const band = 0.82 + 0.2 * Math.sin(v * 46 + an); o[3] = LIME[0] * band; o[4] = LIME[1] * band; o[5] = LIME[2] * band; o[6] = 0.1; o[7] = 6.35; });
  const t = b.build();
  t.label = 'Cave column'; t.fact = 'A column forms where a stalactite and a stalagmite finally meet, a process that takes many thousands of years.';
  return t;
}

// Cave mouth in a wall: a lumpy rock hood around a dark recess, opening along local +z (the wall lies in
// the local x-y plane at z = 0; the back rim is buried in it). Sizes are baked in (W wide, H tall, D deep)
// so the creature capsules fit; place with a yaw-only rotation and unit scale.
export function caveMouth(seed, { W = 10, H = 6, D = 4.5 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 619 + 41), rm = 0.62 + rng() * 0.08;
  // profile (radius, depth) from the buried back rim, over the lip, into the dark recess
  const prof = [[1, 0], [0.97, 0.28], [0.86, 0.66], [rm * 1.28, 0.98], [rm * 1.08, 1.04], [rm, 0.92], [rm * 0.93, 0.66], [rm * 0.74, 0.4], [rm * 0.42, 0.2], [0.03, 0.1]];
  const n = prof.length - 1, ox = rng() * 20, lobes = 2 + Math.floor(rng() * 3), ph = rng() * TAU;
  b.grid(36, n * 2, (u, v, i, j, o) => {
    const a = u * TAU, f = v * n, k = Math.min(n - 1, Math.floor(f)), t = f - k;
    let r = lerp(prof[k][0], prof[k + 1][0], t), y = lerp(prof[k][1], prof[k + 1][1], t);
    const top = Math.max(0, -Math.sin(a)), bot = Math.max(0, Math.sin(a));
    // irregular outline, a heavy overhanging brow, a low apron below, sides sweeping back into the wall
    const outer = v < 0.5 ? 1 : 0.6;
    r *= 1 + (0.17 * vn3(Math.cos(a) * 2 + ox, v * 4, Math.sin(a) * 2, seed) + 0.07 * vn3(Math.cos(a) * 6, v * 9, Math.sin(a) * 6, seed + 1) + 0.08 * Math.sin(a * lobes + ph)) * outer;
    y *= (0.62 + 0.38 * top - 0.22 * bot + 0.12 * vn3(Math.cos(a) * 3, 0, Math.sin(a) * 3, seed + 4)) ;
    let x = Math.cos(a) * r, z = Math.sin(a) * r;
    z += top * sstep(0.25, 0.5, v) * 0.18; // the brow sags over the opening
    o[0] = x; o[1] = y; o[2] = z;
    const inside = sstep(0.42, 0.62, v), deep = 1 - sstep(0.62, 1, v);
    const ao = lerp(0.8 + 0.25 * vn3(x * 3, y * 3, z * 3, seed + 2), 0.04 + 0.1 * (1 - deep), inside);
    o[3] = LIME[0] * ao; o[4] = LIME[1] * ao; o[5] = LIME[2] * ao; o[6] = 0.9 * (1 - inside); o[7] = 6.4 + (seed % 5) * 0.1;
  }, { wrapU: true });
  // grid axis (y) -> +z, then the baked size: x = width, y = height, z = depth
  b.xform(0, [1, 0, 0, 0, 0, -1, 0, 1, 0], 0, 0, 0, W / 2, D, H / 2);
  const t = b.build(), pts = [];
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; pts.push(Math.cos(a) * W / 2 * 0.95, Math.sin(a) * H / 2 * 0.95, 0.02); }
  setBase(t, pts);
  // creature capsules: the hood's upper and lower lips and its sides (the recess itself stays open)
  const rl = 0.22 * H / 2 + 0.25, rs = 0.18 * W / 2 + 0.25;
  t.obs = [[-W / 2 * 0.8, H / 2 * 0.82, D * 0.6, W / 2 * 0.8, H / 2 * 0.82, D * 0.6, rl], [-W / 2 * 0.8, -H / 2 * 0.82, D * 0.45, W / 2 * 0.8, -H / 2 * 0.82, D * 0.45, rl],
    [-W / 2 * 0.85, -H / 2 * 0.5, D * 0.4, -W / 2 * 0.85, H / 2 * 0.5, D * 0.4, rs], [W / 2 * 0.85, -H / 2 * 0.5, D * 0.4, W / 2 * 0.85, H / 2 * 0.5, D * 0.4, rs],
    [-W / 2 * rm * 0.6, 0, D * 0.12, W / 2 * rm * 0.6, 0, D * 0.12, Math.min(H / 2 * rm * 0.7, D * 0.25)]]; // the back of the recess
  t.mouth = { rm, W, H, D };
  t.label = 'Cave mouth'; t.fact = 'Divers find dry-cave formations deep inside blue holes: proof the sea was once 120 m lower.';
  return t;
}
