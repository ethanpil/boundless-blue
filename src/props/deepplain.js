// Abyssal Plain (~50 m, black water, lit only by the camera's lamps): sea pens and deep-sea Umbellula
// that glow softly, stalked crinoids, Venus' flower baskets and cloud sponges, xenophyophores,
// dropstones, burrow mounds, brittle stars, sea pigs at the end of their feeding tracks.
// Set pieces: a whale fall (skull, jaws, ribs, vertebral chain, bacterial mats, bone-eating worms) and
// brine pools - mirror-like lakes filling the terrain's basins, ringed by mussels.
import { Builder, Batch, TAU, vn3, fbm3, sat, sstep, lerp, rotY, rotX, rotZ, mul3, presence, budgetK, CHUNK } from './core.js';
import { MAT } from './materials.js';
import { rockInto, stoneInto, anemone } from './shapes.js';
import { mulberry32 } from '../noise.js';
import { sv, brineBasins } from '../biomes.js';
import {
  NBMAT, pathCache, clearBox, SOLID, SOFT, seat, put, upTo, nrm, mix3, setBase, lab, segFor, recipe, lowK, itemSupport,
  basePts, xf, decalDisc, decalRibbon, builderMesh, nbFloor, slice,
} from './nb_common.js';
import { cheapMussels, ground, bez } from './nb_shapes.js';
import { inGarden } from './octogarden.js'; // events 2026-11
import { tintFrom } from './scatter.js';

const D = {};
const BONE = [0.62, 0.57, 0.46];

// ---------------------------------------------------------------- sediment life
function seaPen(seed) { // Pennatula: a feather of polyp leaves on a fleshy stalk (glow material: aFx.x = glow)
  const b = new Builder(), rng = mulberry32(seed), H = 0.3 + rng() * 0.25, lean = (rng() - 0.5) * 0.3, r = 0.012 + rng() * 0.006;
  const pts = [], rr = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([lean * t * t * H, -0.06 + t * (H + 0.06), 0]); rr.push(r * (1.2 - 0.6 * t)); }
  b.tube(pts, rr, 4, (v, a, x, y, z, o) => { o[3] = 0.85; o[4] = 0.5; o[5] = 0.35; o[6] = 0.15 * v; }, { tip: true });
  const nl = 9 + Math.floor(rng() * 6);
  for (let k = 0; k < nl; k++) { // paired leaves along the upper rachis
    const t = 0.35 + 0.6 * (k / nl), p = [lean * t * t * H, -0.06 + t * (H + 0.06), 0], L = H * 0.22 * Math.sin(Math.PI * (0.15 + 0.85 * (k / nl)));
    for (const sd of [-1, 1]) {
      const tip = [p[0] + 0.25 * L, p[1] + 0.35 * L, sd * L], mid = [p[0], p[1] + 0.12 * L, 0];
      for (const flip of [false, true]) { // both faces
        const a = b.v(p[0], p[1], 0, 0, 0, sd, 1, 0.72, 0.55, 0.5, 0), c = b.v(tip[0], tip[1], tip[2], 0, 0, sd, 1.1, 0.85, 0.7, 1, 0), d = b.v(mid[0] + 0.02, mid[1] + 0.04, sd * 0.004, 0, 0, sd, 1, 0.75, 0.6, 0.8, 0);
        if (flip) b.t(a, d, c); else b.t(a, c, d);
      }
    }
  }
  b.smooth(0, 0);
  const t = b.build(); setBase(t, [0, -0.06, 0]);
  return t;
}
function umbellula(seed) { // a whip-thin stalk up to 2 m bearing a nodding head of large polyps
  const b = new Builder(), rng = mulberry32(seed), H = 1.0 + rng() * 1.2, bend = 0.15 + rng() * 0.25;
  const pts = [], rr = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([bend * t * t * H, -0.08 + t * (H + 0.08), 0.03 * Math.sin(t * 5 + seed)]); rr.push(0.008 * (1.3 - 0.5 * t)); }
  b.tube(pts, rr, 3, (v, a, x, y, z, o) => { o[3] = 0.75; o[4] = 0.7; o[5] = 0.6; o[6] = 0.05; }, { tip: false });
  const top = pts[8], n = 4 + Math.floor(rng() * 5);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rng() * 0.4, dir = nrm([Math.cos(a) * 0.8 + bend, -0.3 + rng() * 0.5, Math.sin(a) * 0.8]), L = 0.07 + rng() * 0.05;
    const c = [top[0] + dir[0] * L * 0.7, top[1] + dir[1] * L * 0.7, top[2] + dir[2] * L * 0.7];
    b.blob(1, (x, y, z, o) => {
      o[0] = c[0] + (x * dir[0]) * L * 0.6 + x * 0.02; o[1] = c[1] + y * 0.025 + x * dir[1] * L * 0.5; o[2] = c[2] + z * 0.025 + x * dir[2] * L * 0.5;
      o[3] = 1.0; o[4] = 0.55 + 0.2 * y; o[5] = 0.45; o[6] = 0.9;
    });
  }
  const t = b.build(); setBase(t, [0, -0.08, 0]);
  return t;
}
function stalkedCrinoid(seed) { // sea lily: jointed stalk with whorls of cirri, arms bent into a filtering bowl
  const b = new Builder(), rng = mulberry32(seed), H = 0.5 + rng() * 0.45, lean = (rng() - 0.5) * 0.2;
  const P = (t) => [lean * t * t * H, -0.05 + t * (H + 0.05), 0];
  const pts = [], rr = [];
  for (let i = 0; i <= 8; i++) { pts.push(P(i / 8)); rr.push(0.009); }
  b.tube(pts, rr, 3, (v, a, x, y, z, o) => { const band = Math.floor(v * 24) % 2 ? 0.85 : 1; o[3] = 0.85 * band; o[4] = 0.75 * band; o[5] = 0.55 * band; });
  for (let w = 1; w < 4; w++) { // nodal whorls of cirri
    const p = P(w / 4.5);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + w, d = [Math.cos(a), -0.4, Math.sin(a)];
      b.tube([p, [p[0] + d[0] * 0.04, p[1] + d[1] * 0.04, p[2] + d[2] * 0.04], [p[0] + d[0] * 0.06, p[1] - 0.035, p[2] + d[2] * 0.06]], [0.003, 0.0025, 0.0015], 3, (v, an, x, y, z, o) => { o[3] = 0.8; o[4] = 0.7; o[5] = 0.5; });
    }
  }
  const top = P(1);
  b.blob(1, (x, y, z, o) => { o[0] = top[0] + x * 0.022; o[1] = top[1] + 0.015 + y * 0.02; o[2] = top[2] + z * 0.022; o[3] = 0.9; o[4] = 0.75; o[5] = 0.5; });
  const nA = 10, cur = rng() * TAU;
  for (let k = 0; k < nA; k++) { // arms recurved downstream like an inverted umbrella
    const a = (k / nA) * TAU, out = [Math.cos(a), 0, Math.sin(a)], L = 0.12 + rng() * 0.05, apts = [];
    for (let i = 0; i <= 5; i++) { const t = i / 5; apts.push([top[0] + out[0] * L * t + Math.cos(cur) * L * t * t * 0.9, top[1] + 0.02 + L * (0.5 * t - 1.1 * t * t), top[2] + out[2] * L * t + Math.sin(cur) * L * t * t * 0.9]); }
    b.tube(apts, apts.map((_, i) => 0.004 * (1 - i / 7)), 3, (v, an, x, y, z, o) => { o[3] = 1.0; o[4] = 0.85; o[5] = 0.55; }, { tip: true });
    for (let i = 1; i < 5; i += 2) { // pinnules (both faces)
      const p = apts[i], s = [-out[2], 0, out[0]];
      for (const sd of [-1, 1]) for (const flip of [false, true]) {
        const a0 = b.v(p[0], p[1], p[2], 0, 1, 0, 1, 0.9, 0.6), a1 = b.v(p[0] + s[0] * sd * 0.025, p[1] - 0.012, p[2] + s[2] * sd * 0.025, 0, 1, 0, 1, 0.9, 0.6), a2 = b.v(p[0] + out[0] * 0.012, p[1], p[2] + out[2] * 0.012, 0, 1, 0, 1, 0.9, 0.6);
        if (flip) b.t(a0, a2, a1); else b.t(a0, a1, a2);
      }
    }
  }
  const t = b.build(); setBase(t, [0, -0.05, 0]);
  return t;
}
function venusBasket(seed) { // Euplectella: a curved lattice tube with a sieve plate, rooted by glassy fibres
  const b = new Builder(), rng = mulberry32(seed), H = 0.3 + rng() * 0.22, R = 0.035 + rng() * 0.02, curve = (rng() - 0.3) * 0.25;
  const prof = (v) => R * (0.45 + 0.75 * Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.62) + 0.15 * v);
  const off = (v) => curve * v * v * H;
  b.lathe(14, 10, (v) => [prof(v), v * H], null, (v, a, x, y, z, o) => { o[3] = 0.9; o[4] = 0.88; o[5] = 0.78; o[6] = (a / TAU) * 12; o[7] = v * 16; });
  b.grid(14, 2, (u, v, i, j, o) => { const a = u * TAU, r = prof(1) * (1 - v); o[0] = Math.cos(a) * r; o[1] = H + 0.004 * (1 - v); o[2] = Math.sin(a) * r; o[3] = 0.95; o[4] = 0.92; o[5] = 0.82; o[6] = 0; o[7] = -1; }, { wrapU: true, flip: true });
  b.grid(14, 1, (u, v, i, j, o) => { const a = u * TAU, r = prof(1) * (1 + 0.15 * v); o[0] = Math.cos(a) * r; o[1] = H - 0.01 + 0.012 * v; o[2] = Math.sin(a) * r; o[3] = 1; o[4] = 0.97; o[5] = 0.88; o[6] = 0; o[7] = -1; }, { wrapU: true });
  for (let i = 0; i < b.vc; i++) b.P[i * 3] += off(sat(b.P[i * 3 + 1] / H));
  for (let k = 0; k < 7; k++) { // basalia: glassy anchor fibres into the ooze
    const a = rng() * TAU, x = Math.cos(a) * R * 0.3, z = Math.sin(a) * R * 0.3;
    b.tube([[x, 0.02, z], [x * 2.5, -0.03, z * 2.5], [x * 3.5, -0.08, z * 3.5]], [0.0025, 0.002, 0.0015], 3, (v, an, px, py, pz, o) => { o[3] = 0.95; o[4] = 0.95; o[5] = 0.9; o[6] = 0; o[7] = -1; }, { tip: true });
  }
  const t = b.build(); setBase(t, [0, 0.0, 0, R * 0.4, 0, 0, -R * 0.4, 0, 0, 0, 0, R * 0.4, 0, 0, -R * 0.4]);
  return t;
}
function cloudSponge(seed) { // Aphrocallistes: pale, folded, chimney-studded mass
  const b = new Builder(), rng = mulberry32(seed), S = 0.3 + rng() * 0.3;
  b.blob(3, (x, y, z, o) => {
    const d = 1 + 0.45 * fbm3(x * 1.8 + seed, y * 1.8, z * 1.8, 3, seed) + 0.25 * Math.max(0, vn3(x * 5, y * 5, z * 5, seed + 4));
    const py = y > 0 ? y * 0.8 : y * 0.25;
    o[0] = x * S * d; o[1] = (py + 0.25) * S * d; o[2] = z * S * d;
    const ao = y > -0.2 ? 0.85 + 0.25 * y : 0.5; o[3] = 0.95 * ao; o[4] = 0.92 * ao; o[5] = 0.82 * ao; o[7] = 2;
  });
  for (let k = 0; k < 4 + Math.floor(rng() * 4); k++) { // chimneys
    const a = rng() * TAU, rr = S * 0.5 * Math.sqrt(rng()), h = S * (0.5 + rng() * 0.6), r = S * 0.12;
    const v0 = b.vc;
    b.lathe(8, 3, (v) => [r * (1 + 0.3 * v), v * h], null, (v, an, x, y, z, o) => { o[3] = o[4] = 0.95; o[5] = 0.85; o[7] = 2; });
    b.lathe(8, 1, (v) => [r * 1.3 * (1 - v * 0.8), h * (1 - v * 0.3)], null, (v, an, x, y, z, o) => { o[3] = o[4] = o[5] = 0.25; }, { flip: true });
    for (let i = v0; i < b.vc; i++) { b.P[i * 3] += Math.cos(a) * rr; b.P[i * 3 + 1] += S * 0.3; b.P[i * 3 + 2] += Math.sin(a) * rr; }
  }
  return ground(b).build();
}
function xeno(seed) { // xenophyophore: a giant single cell building a fragile, folded test of sediment
  const b = new Builder(), S = 0.06 + (seed % 5) * 0.03;
  b.blob(2, (x, y, z, o) => {
    const rid = Math.abs(vn3(x * 3.5 + seed, y * 3.5, z * 3.5, seed)) ;
    const d = 1 - 0.35 * sstep(0.0, 0.25, 0.25 - rid) + 0.2 * fbm3(x * 2, y * 2, z * 2, 2, seed + 3);
    o[0] = x * S * d; o[1] = (y > 0 ? y : y * 0.4) * S * 0.85 * d; o[2] = z * S * d;
    const c = 0.55 + 0.3 * rid; o[3] = 0.6 * c; o[4] = 0.52 * c; o[5] = 0.42 * c; o[7] = 2;
  });
  return ground(b).build();
}
function burrowMound(seed) { // lebensspuren: a low cone of ejected sediment with a dark hole
  const b = new Builder(), rng = mulberry32(seed), R = 0.15 + rng() * 0.2, h = R * (0.25 + rng() * 0.2), rh = R * 0.12;
  b.lathe(14, 6, (v) => {
    if (v < 0.7) { const t = v / 0.7; return [lerp(R, rh * 1.6, Math.sqrt(t)), h * t * t * (3 - 2 * t)]; }
    const t = (v - 0.7) / 0.3; return [lerp(rh * 1.6, 0.003, t), h - h * 0.9 * t];
  }, (a, v) => 1 + 0.1 * vn3(Math.cos(a) * 2, v * 2, Math.sin(a) * 2, seed), (v, a, x, y, z, o) => { const hole = sstep(0.75, 0.95, v); o[3] = lerp(0.36, 0.04, hole); o[4] = lerp(0.34, 0.035, hole); o[5] = lerp(0.3, 0.03, hole); });
  return b.build();
}
function brittleStar(seed) {
  const b = new Builder(), rng = mulberry32(seed), dr = 0.012 + rng() * 0.008, L = 0.08 + rng() * 0.07, band = rng() < 0.5, base = [];
  b.blob(1, (x, y, z, o) => { o[0] = x * dr; o[1] = 0.006 + (y > 0 ? y * 0.006 : y * 0.002); o[2] = z * dr; o[3] = 0.8; o[4] = 0.6; o[5] = 0.5; });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + (rng() - 0.5) * 0.3, curl = (rng() - 0.5) * 2.2, pts = [];
    let ang = a;
    for (let i = 0; i <= 6; i++) { const t = i / 6; ang += curl * 0.15; pts.push([Math.cos(ang) * (dr + L * t), 0.0025 + 0.004 * Math.sin(t * Math.PI) * (k % 2), Math.sin(ang) * (dr + L * t)]); }
    b.tube(pts, pts.map((_, i) => 0.0025 * (1 - i / 8)), 3, (v, an, x, y, z, o, j) => { const c = band && j % 2 ? 0.45 : 0.85; o[3] = c; o[4] = c * 0.8; o[5] = c * 0.7; }, { tip: true });
    base.push(pts[6][0], 0, pts[6][2]);
  }
  base.push(0, 0, 0);
  const t = ground(b).build(); setBase(t, base);
  return t;
}
function seaPig(seed) { // Scotoplanes: plump translucent pink sea cucumber walking on tube feet
  const b = new Builder(), rng = mulberry32(seed), L = 0.12 + rng() * 0.05, base = [];
  b.blob(2, (x, y, z, o) => { o[0] = x * L * 0.5; o[1] = 0.03 + y * L * 0.22 * (1 - 0.2 * x); o[2] = z * L * 0.2; o[3] = 0.9; o[4] = 0.55; o[5] = 0.55; });
  for (let k = 0; k < 6; k++) for (const sd of [-1, 1]) { // tube feet
    const x = (k / 5 - 0.5) * L * 0.75, p = [x, 0.02, sd * L * 0.15];
    b.tube([p, [x, 0.008, sd * L * 0.2], [x, 0, sd * L * 0.21]], [0.006, 0.005, 0.004], 3, (v, a, px, py, pz, o) => { o[3] = 0.95; o[4] = 0.6; o[5] = 0.6; });
    base.push(x, 0, sd * L * 0.21);
  }
  for (let k = 0; k < 2; k++) for (const sd of [-1, 1]) { // the "legs" on top (papillae)
    const x = L * (0.15 - k * 0.12), p = [x, 0.03 + L * 0.2, sd * L * 0.05];
    b.tube([p, [x + 0.01, p[1] + 0.03, sd * L * 0.07], [x + 0.025, p[1] + 0.045, sd * L * 0.09]], [0.005, 0.004, 0.002], 3, (v, a, px, py, pz, o) => { o[3] = 1.0; o[4] = 0.65; o[5] = 0.65; }, { tip: true });
  }
  const t = b.build(); setBase(t, base);
  return t;
}
function dropstone(seed) {
  const b = new Builder();
  rockInto(b, seed, { detail: 3, sx: 0.5 + (seed % 3) * 0.2, sy: 0.4 + (seed % 2) * 0.15, sz: 0.45, rough: 0.3, flat: 0.25, growth: 0.15, col: [0.5, 0.48, 0.46] });
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => { o[4] = 6.15 + (seed % 4) * 0.2; });
  const t = b.build(); t.label = 'Dropstone'; t.fact = 'Rafted out to sea in an iceberg and dropped as the ice melted';
  return t;
}

// ---------------------------------------------------------------- whale bones
// bacterial mats (white / orange) and red Osedax fuzz baked into the bone colours
function bonePaint(seed, k = 1) {
  return (x, y, z, up) => {
    const m = vn3(x * 3 + seed, y * 3, z * 3, seed), r = vn3(x * 7, y * 7, z * 7, seed + 5);
    let c = BONE.map((v) => v * (0.8 + 0.3 * vn3(x * 5, y * 5, z * 5, seed + 2)));
    const mat = sstep(0.1, 0.4, m) * (0.4 + 0.6 * up);
    c = c.map((v, i) => lerp(v, [0.9, 0.88, 0.82][i], mat * 0.8));
    const ora = sstep(0.35, 0.6, vn3(x * 2, y * 2, z * 2, seed + 9)) * up;
    c = c.map((v, i) => lerp(v, [0.85, 0.35, 0.08][i], ora * 0.7));
    const red = sstep(0.3, 0.55, r) * up * k;
    return c.map((v, i) => lerp(v, [0.6, 0.04, 0.03][i], red * 0.85));
  };
}
// Osedax: clusters of tiny red plumes rooted in the bone (baked, so always attached)
function osedax(b, rng, pts, n) {
  for (let k = 0; k < n; k++) {
    const p = pts[(rng() * pts.length) | 0], h = 0.02 + rng() * 0.025;
    b.tube([[p[0], p[1] - 0.01, p[2]], [p[0] + (rng() - 0.5) * 0.01, p[1] + h * 0.6, p[2]], [p[0] + (rng() - 0.5) * 0.02, p[1] + h, p[2] + (rng() - 0.5) * 0.02]], [0.004, 0.003, 0.006], 3, (v, a, x, y, z, o) => { o[3] = 0.9; o[4] = lerp(0.4, 0.05, v); o[5] = lerp(0.35, 0.05, v); }, { tip: true });
  }
}
function upPts(b, v0, frac = 0.75) { // vertices on the upper part of a part (for plume placement)
  let top = -1e9; for (let i = v0; i < b.vc; i++) top = Math.max(top, b.P[i * 3 + 1]);
  const out = []; for (let i = v0; i < b.vc; i++) if (b.P[i * 3 + 1] > top * frac && b.N[i * 3 + 1] > 0.5) out.push([b.P[i * 3], b.P[i * 3 + 1], b.P[i * 3 + 2]]);
  return out;
}
function vertebra(seed, s) {
  const b = new Builder(), rng = mulberry32(seed), paint = bonePaint(seed);
  stoneInto(b, { sx: 0.32 * s, sy: 0.5 * s, sz: 0.5 * s, p: 3, rough: 0.06, seed, detail: 2, col: [1, 1, 1], growth: 0 });
  const v1 = b.vc;
  stoneInto(b, { sx: 0.1 * s, sy: 0.55 * s, sz: 0.2 * s, p: 4, rough: 0.08, seed: seed + 1, detail: 1, col: [1, 1, 1], growth: 0 });
  b.xform(v1, rotZ((rng() - 0.5) * 0.3), 0, 0.42 * s, 0);
  for (const sd of [-1, 1]) {
    const v2 = b.vc;
    stoneInto(b, { sx: 0.08 * s, sy: 0.08 * s, sz: 0.4 * s, p: 4, rough: 0.08, seed: seed + 2, detail: 1, col: [1, 1, 1], growth: 0 });
    b.xform(v2, rotX(sd * 0.25), 0, 0.05 * s, sd * 0.38 * s);
  }
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => { const c = paint(x, y, z, sat(ny * 0.7 + 0.4)); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = 0; o[4] = 2; });
  osedax(b, rng, upPts(b, 0, 0.2), 10);
  const t = ground(b).build();
  return t;
}
function rib(seed, L) { // arch from the spine (origin) out along +x, ending below its start
  const b = new Builder(), rng = mulberry32(seed), paint = bonePaint(seed, 0.6), r0 = 0.045 * L / 1.6 + 0.02;
  const P0 = [0, 0, 0], P1 = [0.3 * L, 0.32 * L, 0], P2 = [0.8 * L, 0.22 * L, (rng() - 0.5) * 0.2], P3 = [L, -0.05, (rng() - 0.5) * 0.15];
  const pts = [], rr = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(bez(P0, P1, P2, P3, t)); rr.push(r0 * (1 - 0.45 * t)); }
  pts.push([P3[0] + 0.03, -0.15, P3[2]]); rr.push(r0 * 0.5);
  b.tube(pts, rr, 4, (v, a, x, y, z, o) => { const c = paint(x, y, z, 0.7); o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[7] = 2; }, { tip: true });
  const t = b.build(); t.nbTips = [pts[11]];
  t.obs = [[...pts[0], ...pts[5], r0], [...pts[5], ...pts[10], r0]];
  return t;
}
function mandible(seed, flip = 1) { // long bowed jaw bone lying on its side
  const b = new Builder(), rng = mulberry32(seed), L = 3.2 + rng() * 0.8, bow = (0.35 + rng() * 0.2) * flip, paint = bonePaint(seed), base = [];
  const pts = [], rr = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10, r = 0.13 * (1 - 0.45 * t) + 0.02; pts.push([t * L, r * 0.8, bow * Math.sin(t * Math.PI) * (1 - 0.3 * t)]); rr.push(r); base.push(t * L, 0, pts[i][2]); }
  b.tube(pts, rr, 6, (v, a, x, y, z, o) => { const c = paint(x, y, z, sat(Math.sin(a) * 0.6 + 0.4)); o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[7] = 2; }, { cap: true });
  for (let i = 0; i < b.vc; i++) b.P[i * 3 + 1] *= 0.75; // flattened in section
  osedax(b, rng, upPts(b, 0, 0.6), 14);
  const t = b.build(); setBase(t, base.map((v, i) => (i % 3 === 1 ? 0 : v)));
  return t;
}
function skull(seed) { // cranium with a long flattened rostrum (baleen whale), resting upright
  const b = new Builder(), rng = mulberry32(seed), paint = bonePaint(seed);
  b.blob(3, (x, y, z, o) => { // cranium
    const d = 1 + 0.08 * fbm3(x * 2 + seed, y * 2, z * 2, 2, seed);
    o[0] = -0.4 + x * 0.8 * d; o[1] = 0.4 + y * (y > 0 ? 0.42 : 0.3) * d; o[2] = z * 1.15 * d;
  });
  const v1 = b.vc, Lr = 2.4 + rng() * 0.6;
  b.blob(3, (x, y, z, o) => { // rostrum: long, flat, tapering, slightly arched
    const t = (x + 1) / 2, w = 0.95 * (1 - 0.72 * t) + 0.1, hh = 0.18 * (1 - 0.6 * t) + 0.05;
    o[0] = t * Lr; o[1] = 0.3 + y * hh + 0.1 * Math.sin(t * Math.PI) - 0.12 * t; o[2] = z * w * (1 + 0.06 * Math.sin(t * 9 + seed));
  });
  for (const sd of [-1, 1]) { // occipital condyles
    const v2 = b.vc;
    b.blob(1, (x, y, z, o) => { o[0] = -1.1 + x * 0.12; o[1] = 0.3 + y * 0.14; o[2] = sd * 0.22 + z * 0.12; });
  }
  b.smooth(0, 0);
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => { const c = paint(x, y, z, sat(ny * 0.7 + 0.4)); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = 0; o[4] = 2; });
  osedax(b, rng, upPts(b, 0, 0.5), 30);
  const t = ground(b).build();
  t.label = 'Whale fall'; t.fact = 'A single whale carcass can feed a community of deep-sea life for decades';
  return t;
}

// ---------------------------------------------------------------- lost things
function anchor(seed) { // Admiralty pattern anchor lying on its side, one fluke dug in
  const b = new Builder(), iron = (v, a, x, y, z, o) => { const n = 0.75 + 0.5 * vn3(x * 4, y * 4, z * 4, seed); o[3] = 0.22 * n; o[4] = 0.13 * n; o[5] = 0.08 * n; o[6] = 0.6; o[7] = 4; };
  const L = 1.8;
  b.tube([[0, 0.07, 0], [L * 0.5, 0.07, 0], [L, 0.07, 0]], [0.06, 0.055, 0.05], 6, iron, { cap: true }); // shank
  for (const sd of [-1, 1]) { // arms curving to the flukes
    const pts = [[0, 0.07, 0], [-0.15, 0.07, sd * 0.35], [-0.05, 0.07, sd * 0.65]];
    b.tube(pts, [0.06, 0.05, 0.04], 6, iron, { tip: true });
    const v0 = b.vc;
    stoneInto(b, { sx: 0.28, sy: 0.05, sz: 0.2, p: 3, rough: 0.05, seed, detail: 1, col: [0.22, 0.13, 0.08], growth: 0.6, mode: 4 });
    b.xform(v0, rotY(sd * 0.6), -0.02, 0.07, sd * 0.68);
  }
  const v1 = b.vc; // wooden stock (perpendicular, standing up from the sediment)
  stoneInto(b, { sx: 0.14, sy: 1.5, sz: 0.14, p: 4, rough: 0.06, seed: seed + 3, detail: 1, col: [0.12, 0.09, 0.06], growth: 0.5, mode: 0 });
  b.xform(v1, rotX(1.2), L * 0.88, 0.1, 0);
  b.tube([[L + 0.05, 0.07, -0.12], [L + 0.18, 0.07, 0], [L + 0.05, 0.07, 0.12]], [0.025, 0.025, 0.025], 5, iron); // ring
  const t = ground(b).build();
  t.label = 'Admiralty pattern anchor'; t.fact = 'The classic anchor shape standardised by the British Navy in the 1840s';
  return t;
}
function seismometer(seed) { // lost ocean-bottom seismometer: frame, instrument sphere and orange glass floats
  const b = new Builder(), metal = (v, a, x, y, z, o) => { o[3] = 0.4; o[4] = 0.4; o[5] = 0.42; o[6] = 0.4; o[7] = 4; };
  const W = 0.9, H = 0.7, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [i, j] of c) b.tube([[i * W / 2, 0, j * W / 2], [i * W / 2, H, j * W / 2]], [0.02, 0.02], 4, metal);
  for (let k = 0; k < 4; k++) { const [a, bb] = [c[k], c[(k + 1) % 4]]; for (const y of [0.02, H]) b.tube([[a[0] * W / 2, y, a[1] * W / 2], [bb[0] * W / 2, y, bb[1] * W / 2]], [0.018, 0.018], 4, metal); }
  for (const [i, j] of c) b.blob(2, (x, y, z, o) => { o[0] = i * 0.2 + x * 0.17; o[1] = H + 0.17 + y * 0.17; o[2] = j * 0.2 + z * 0.17; o[3] = 1.0; o[4] = 0.35; o[5] = 0.04; });
  b.blob(2, (x, y, z, o) => { o[0] = x * 0.2; o[1] = 0.28 + y * 0.2; o[2] = z * 0.2; o[3] = 0.85; o[4] = 0.75; o[5] = 0.1; });
  const t = b.build();
  setBase(t, c.flatMap(([i, j]) => [i * W / 2, 0, j * W / 2]));
  t.label = 'Lost ocean-bottom seismometer'; t.fact = 'Set down to record earthquakes; its floats should have carried it back up';
  return t;
}

export function initDeepplain() {
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(1700 + i * 23 + o));
  D.pen = R(6, seaPen);
  D.umb = R(4, umbellula);
  D.lily = R(5, stalkedCrinoid);
  D.basket = R(5, venusBasket);
  D.cloud = R(4, cloudSponge);
  D.xeno = R(6, xeno);
  D.mound = R(5, burrowMound);
  D.brittle = R(6, brittleStar);
  D.pig = R(3, seaPig);
  D.stone = R(5, dropstone);
  D.anem = [1, 2].map((k) => anemone(k + 300, { tentacles: 20, tlen: 0.12, rows: 2, disc: 0.06, height: 0.05, thick: 0.008, body: [0.9, 0.8, 0.75], tent: [0.95, 0.85, 0.8] }));
  D.mussel = R(5, (s) => cheapMussels(s, { n: 26, r: 0.45, L: 0.1, col: [0.32, 0.25, 0.14], edge: [0.55, 0.45, 0.25] }));
  D.vert = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((s, i) => vertebra(1800 + i, s));
  D.rib = [1.4, 1.7, 2.0, 2.3].map((L, i) => rib(1900 + i, L));
  // the same ribs fallen flat: both ends rest on the ooze
  D.ribFlat = [1.4, 1.7, 2.0, 2.3].map((L, i) => { const t = rib(1900 + i, L), tp = t.nbTips[0]; return setBase(t, [0, -0.02, 0, tp[0], tp[1], tp[2]]); });
  D.jaw = [mandible(1950, 1), mandible(1950, -1)];
  D.skull = [skull(1960), skull(1961)];
  D.anchor = anchor(1970);
  D.obs = seismometer(1971);
  lab(D.pen, 'Sea pen', 'A colony of polyps; many sea pens glow when touched');
  lab(D.umb, 'Deep-sea sea pen (Umbellula)', 'Its polyps sway on a stalk up to two metres tall to catch drifting food');
  lab(D.lily, 'Sea lily (stalked crinoid)', 'Sea lilies are animals related to sea stars, and can creep along on their stalks');
  lab(D.basket, "Venus' flower basket", 'A pair of shrimp often lives trapped inside for life, a symbol of marriage in Japan');
  lab(D.cloud, 'Cloud sponge', 'Glass sponges build their skeletons from silica, the stuff of glass');
  lab(D.xeno, 'Xenophyophore', 'Each one is a single cell, yet it can be over 10 cm across');
  lab(D.mound, 'Burrow mound', 'Hidden burrowers pile up these mounds as they rework the soft ooze');
  lab(D.brittle, 'Brittle star', 'Brittle stars carpet vast areas of the deep sea floor');
  lab(D.pig, 'Sea pig (Scotoplanes)', 'This sea cucumber walks on water-filled tube feet');
  lab(D.mussel, 'Brine pool mussels', 'Bacteria in their gills live on the methane seeping from the pool');
  lab(D.vert, 'Bone-eating worms (Osedax)', 'They have no mouth or gut; root-like tissue dissolves the bone with acid');
  lab([...D.rib, ...D.ribFlat, ...D.jaw], 'Whale bones', null);
  for (const t of [...D.pen, ...D.umb, ...D.lily, ...D.brittle, ...D.pig]) t.solid = false;
  return D;
}

// ---------------------------------------------------------------- recipe
const recipeOf = (g) => recipe(g, 'deepplain', (g) => ({
  pen: 0.4 + sv(g, 5) * 1.2, umb: 0.1 + sv(g, 6) * 0.6, lily: 0.2 + sv(g, 7) * 1.0, glass: 0.2 + sv(g, 8) * 1.0, xeno: 0.3 + sv(g, 9),
  mound: 0.4 + sv(g, 10), brittle: 0.3 + sv(g, 11) * 1.4, stones: 0.2 + sv(g, 12) * 0.8, tracks: sv(g, 13),
  whale: sv(g, 30) < 0.75, lost: sv(g, 40) < 0.45,
}));
const pick = (rng, a) => a[(rng() * a.length) | 0];
const tint = (rng, list, amt = 0.15) => tintFrom(list, amt)(rng);
// Brine basins near the chunk, analysed once: lake level just below the lowest point of the (irregular)
// rim, and the shoreline radius at NA angles. Brine is toxic: nothing grows inside (mussels line the shore).
const BAS = new WeakMap(), NA = 32;
function basinInfo(ctx, pc, fs) {
  let L = BAS.get(ctx.group);
  if (L) return L;
  L = [];
  const xm = pc.x(ctx.s0 + 32);
  for (const g of ctx.segments) for (const B of brineBasins(g, xm - 120, xm + 120, ctx.s0 - 90, ctx.s1 + 90)) {
    const step = 1.0, n = Math.ceil((B.r * 1.5) / step), H = new Float32Array(NA * (n + 1));
    let fc = 1e9, rim = 1e9;
    for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, r = k ? B.rFlat * 0.6 : 0; fc = Math.min(fc, fs.at(B.x + Math.cos(a) * r, B.s + Math.sin(a) * r)); }
    for (let k = 0; k < NA; k++) { // crest height along each ray; the lowest crest is where brine would spill
      const a = (k / NA) * TAU, c = Math.cos(a), sn = Math.sin(a);
      let crest = -1e9;
      for (let i = 0; i <= n; i++) { const h = fs.at(B.x + c * i * step, B.s + sn * i * step); H[k * (n + 1) + i] = h; if (i * step > B.rFlat) crest = Math.max(crest, h); }
      rim = Math.min(rim, crest);
    }
    if (rim - fc < 0.6) continue;
    const level = Math.min(fc + 0.72 * (rim - fc), rim - 0.2), shore = new Float32Array(NA);
    for (let k = 0; k < NA; k++) { // first crossing above the level, refined by bisection
      const a = (k / NA) * TAU, c = Math.cos(a), sn = Math.sin(a);
      let i = 1; while (i <= n && H[k * (n + 1) + i] <= level) i++;
      let lo = (i - 1) * step, hi = Math.min(i, n) * step;
      for (let q = 0; q < 4; q++) { const m = (lo + hi) / 2; if (fs.at(B.x + c * m, B.s + sn * m) > level) hi = m; else lo = m; }
      shore[k] = hi;
    }
    L.push({ B, x: B.x, s: B.s, level, shore });
  }
  BAS.set(ctx.group, L);
  return L;
}
const shoreAt = (I, a) => { const u = (((a / TAU) % 1) + 1) % 1 * NA, k = Math.floor(u), f = u - k; return I.shore[k % NA] * (1 - f) + I.shore[(k + 1) % NA] * f; };
const inBasin = (L, x, s, pad = 0) => L.some((I) => { const dx = x - I.x, ds = s - I.s, d = Math.hypot(dx, ds); return d < I.B.r * 1.6 && d < shoreAt(I, Math.atan2(ds, dx)) + pad; });

// ---------------------------------------------------------------- chain A: sediment life
export function* layoutDeepA(ctx) {
  const Y = slice();
  if (presence(ctx, 'deepplain') <= 0) return null;
  const bk = budgetK(ctx, 'deepplain'), lk = lowK(ctx);
  const rng = mulberry32(((ctx.s0 * 2654435761) ^ 0xd33f) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 50000 * bk); st.lod = 'mid';
  const glow = new Batch(NBMAT.glow, 22000 * bk); glow.lod = 'mid'; glow.soft = true;
  const glass = new Batch(NBMAT.glass, 12000 * bk); glass.lod = 'mid';
  const near = st;
  const sw = new Batch(MAT.sway, 6000 * bk); sw.lod = 'near'; sw.soft = true;
  const dec = new Builder(), bas = basinInfo(ctx, pc, fs);
  const place = (b, tpl, x, s, sc, col, follow = 0.3, kind = SOLID, embed = 0.02, fa = 1) => {
    const y = fs.at(x, s), n = [fs.nx, fs.ny, fs.nz], R = upTo(mix3([0, 1, 0], n, follow), rng() * TAU), h = (tpl.maxY - tpl.minY) * sc;
    if (!clearBox(pc, x, s, y, y + h, tpl.r * sc, kind)) return null;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, n, embed);
    return put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa) ? { P: Pp, R } : null;
  };
  // lamps reach ~25 m: life is concentrated near the path; glowing pens are seen further out
  for (let k = 0; k < 240; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'deepplain');
    if (!g || rng() > ctx.weightOf(s, 'deepplain')) continue;
    const rc = recipeOf(g), d = Math.pow(rng(), 1.4) * 30, x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * d;
    if (inBasin(bas, x, s, 1) || inGarden(ctx, x, s)) continue;
    const tot = rc.pen + rc.umb + rc.lily + rc.glass + rc.xeno + rc.mound + rc.brittle + rc.stones * 0.4;
    let u = rng() * tot;
    if ((u -= rc.pen) < 0) { // sea pens stand in loose meadows
      for (let q = 0; q < 1 + Math.floor(rng() * 3); q++) place(glow, pick(rng, D.pen), x + (rng() - 0.5) * 1.5, s + (rng() - 0.5) * 1.5, 0.8 + rng() * 0.8, tint(rng, [[1, 0.75, 0.55], [1, 0.5, 0.4], [0.95, 0.9, 0.8]], 0.12), 0, SOFT, 0.02);
    } else if ((u -= rc.umb) < 0) place(glow, pick(rng, D.umb), x, s, 0.8 + rng() * 0.6, tint(rng, [[1, 1, 1], [1, 0.85, 0.85]], 0.1), 0, SOFT, 0.02);
    else if ((u -= rc.lily) < 0) {
      if (lk === 1 || rng() < lk) for (let q = 0; q < 1 + Math.floor(rng() * 3); q++) place(st, pick(rng, D.lily), x + (rng() - 0.5) * 1.2, s + (rng() - 0.5) * 1.2, 0.9 + rng() * 0.5, tint(rng, [[1, 0.95, 0.75], [1, 0.8, 0.55]], 0.12), 0, SOFT, 0.02);
    } else if ((u -= rc.glass) < 0) {
      if (rng() < 0.65) place(glass, pick(rng, D.basket), x, s, 0.9 + rng() * 0.8, tint(rng, [[1, 1, 1], [1, 0.97, 0.9]], 0.06), 0.2, SOLID, 0.03);
      else place(st, pick(rng, D.cloud), x, s, 0.8 + rng() * 0.9, tint(rng, [[1, 1, 0.95], [0.95, 0.93, 0.9]], 0.06), 0.4, SOLID, 0.06);
    } else if ((u -= rc.xeno) < 0) { for (let q = 0; q < 2 + Math.floor(rng() * 4); q++) place(near, pick(rng, D.xeno), x + (rng() - 0.5) * 1.5, s + (rng() - 0.5) * 1.5, 0.8 + rng() * 0.8, [1, 1, 1], 0.6, SOLID, 0.01); }
    else if ((u -= rc.mound) < 0) place(near, pick(rng, D.mound), x, s, 0.8 + rng() * 0.8, [1, 1, 1], 1, SOLID, 0.04);
    else if ((u -= rc.brittle) < 0) { for (let q = 0; q < 2 + Math.floor(rng() * 6); q++) place(near, pick(rng, D.brittle), x + (rng() - 0.5) * 2, s + (rng() - 0.5) * 2, 0.8 + rng() * 0.6, tint(rng, [[0.9, 0.9, 0.85], [1, 0.6, 0.4], [0.7, 0.6, 0.55]], 0.15), 1, SOFT, 0.004); }
    else { // dropstone, often with pale anemones and sponges riding on top
      const r = place(st, pick(rng, D.stone), x, s, 0.6 + rng() * 0.9, tint(rng, [[1, 1, 1], [0.8, 0.75, 0.7], [1.1, 1, 0.9]], 0.1), 0, SOLID, 0.1);
      if (r && Math.abs(r.R[4] - 1) < 1e-6) {
        const it = st.items[st.items.length - 1], top = itemSupport(it.tpl, r.P[0], r.P[1], r.P[2], r.R, it.sx, it.sy, it.sz, true, fs);
        for (let q = 0; q < 1 + Math.floor(rng() * 3); q++) {
          const a = rng() * TAU, rr = Math.sqrt(rng()) * it.tpl.r * it.sx * 0.5, cx = r.P[0] + Math.cos(a) * rr, cs = r.P[2] + Math.sin(a) * rr;
          const t2 = pick(rng, D.anem), Rq = rotY(rng() * TAU), Pq = [cx, top.at(cx, cs), cs];
          seat(top, t2, Rq, 1, 1, 1, Pq, null, 0.02);
          put(ctx, sw, t2, Pq[0], Pq[1], Pq[2], Rq, 1, 1, 1, [1, 1, 1], 1, top.miss ? 'floor' : { item: it });
          top.miss = 0;
        }
      }
    }
  }
  // sea cucumber feeding tracks, each ending at a sea pig
  const g0 = segFor(ctx, ctx.s0 + 32, 'deepplain');
  if (g0) {
    const rc = recipeOf(g0);
    for (let k = 0; k < Math.round(rc.tracks * 4); k++) {
      let x = pc.x(ctx.s0) + (rng() - 0.5) * 30, s = ctx.s0 + rng() * CHUNK, a = rng() * TAU;
      const pts = [], n = 20 + Math.floor(rng() * 30);
      for (let i = 0; i < n; i++) { pts.push(x, s); a += (rng() - 0.5) * 0.35; x += Math.cos(a) * 0.3; s += Math.sin(a) * 0.3; }
      decalRibbon(dec, fs, ctx, pts, 0.07, [0.07, 0.065, 0.06], 1, 0.9);
      const R = rotY(Math.atan2(-Math.sin(a), Math.cos(a))), tpl = pick(rng, D.pig), Pp = [x, fs.at(x, s), s];
      seat(fs, tpl, R, 1, 1, 1, Pp, null, 0.005);
      put(ctx, near, tpl, Pp[0], Pp[1], Pp[2], R, 1, 1, 1, [1, 1, 1]);
    }
  }
  const extra = [builderMesh(dec, NBMAT.decal, null, 'mid')].filter(Boolean);
  return { batches: [st, glow, glass, sw], extra };
}

// ---------------------------------------------------------------- chain B: whale fall, brine pools, lost things
export function whalePlan(g, pc) { // deterministic per segment, clear of the brine basins (also read by octogarden.js)
  const rng = mulberry32(g.seed ^ 0x3fa11), len = g.end - g.start;
  let s = g.start + (0.3 + 0.4 * sv(g, 31)) * len, x = pc.x(s) + (sv(g, 32) - 0.5) * 12;
  for (let k = 0; k < 8; k++) {
    const near = brineBasins(g, x - 60, x + 60, s - 60, s + 60);
    if (!near.some((B) => (x - B.x) ** 2 + (s - B.s) ** 2 < (B.r * 1.3 + 8) ** 2)) break;
    s += 23 * (k % 2 ? -(k + 1) : k + 1); x = pc.x(s) + (sv(g, 32) - 0.5) * 12;
  }
  const yaw = Math.atan2(pc.x(s + 5) - pc.x(s - 5), 10) + (sv(g, 33) - 0.5) * 1.6;
  return { s, x, yaw, L: 11 + rng() * 4, N: 26 + Math.floor(rng() * 8), rng };
}
export function layoutDeepB(ctx) {
  if (presence(ctx, 'deepplain') <= 0) return null;
  const bk = budgetK(ctx, 'deepplain');
  const rng = mulberry32(((ctx.s0 * 2246822519) ^ 0xd44) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 36000); // set pieces are not thinned by the cross-fade
  const dec = new Builder(), labels = [], pois = [];
  const inChunk = (s) => s >= ctx.s0 && s < ctx.s1;
  for (const g of ctx.segments) {
    if (g.key !== 'deepplain') continue;
    const rc = recipeOf(g);
    // ---- whale fall
    if (rc.whale) {
      const W = whalePlan(g, pc), wr = mulberry32(g.seed ^ 0x77), dir = [Math.sin(W.yaw), Math.cos(W.yaw)], side = [dir[1], -dir[0]]; // (x, s)
      const along = (t) => { const k = W.L * (0.5 - t), c = 0.5 * Math.sin(t * 3.2 + 1); return [W.x + dir[0] * k + side[0] * c, W.s + dir[1] * k + side[1] * c]; };
      const near0 = W.s > ctx.s0 - 20 && W.s < ctx.s1 + 20;
      if (near0) {
        const yawOf = (t) => { const a = along(t - 0.01), b = along(t + 0.01); return Math.atan2(a[0] - b[0], a[1] - b[1]); };
        const vtx = [];
        for (let i = 0; i < W.N; i++) { // vertebral chain, half buried, shrinking toward the tail
          const t = 0.02 + 0.95 * (i / W.N), [x, s] = along(t), si = Math.min(D.vert.length - 1, Math.max(0, Math.floor((1 - t) * D.vert.length * 1.1 - 0.5)));
          const tpl = D.vert[si], sc = 0.7 + 0.25 * (1 - t), R = rotY(yawOf(t) + Math.PI / 2 + (wr() - 0.5) * 0.3);
          const Pp = [x, fs.at(x, s), s];
          seat(fs, tpl, R, sc, sc, sc, Pp, null, (tpl.maxY - tpl.minY) * sc * (0.25 + 0.2 * wr()));
          vtx.push({ P: Pp, h: tpl.maxY * sc, t });
          if (inChunk(s)) put(ctx, st, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, [1, 1, 1]);
        }
        for (let i = 2; i < Math.min(15, W.N); i++) for (const sd of [-1, 1]) { // ribs: some still arching, some collapsed
          if (wr() < 0.28) continue;
          const v = vtx[i], tpl = D.rib[Math.min(D.rib.length - 1, Math.floor(wr() * D.rib.length))], yw = Math.atan2(side[0] * sd, side[1] * sd) - Math.PI / 2 + (wr() - 0.5) * 0.5;
          const R = rotY(yw), ya = v.P[1] + v.h * 0.55, tp = tpl.nbTips[0];
          const o = xf(R, 1, 1, 1, tp[0], 0, tp[2]), f = fs.at(v.P[0] + o[0], v.P[2] - o[2]);
          let sy = (ya - f + 0.08) / -tp[1];
          const collapsed = sy < 0.25 || sy > 2.2 || wr() < 0.3;
          const tq = collapsed ? D.ribFlat[D.rib.indexOf(tpl)] : tpl;
          if (collapsed) sy = 0.25;
          const Pp = [v.P[0], ya, v.P[2]];
          if (collapsed) { Pp[1] = fs.at(Pp[0], Pp[2]); seat(fs, tq, R, 1, sy, 1, Pp, null, 0.04); }
          if (inChunk(Pp[2])) put(ctx, st, tq, Pp[0], Pp[1], Pp[2], R, 1, sy, 1, [1, 1, 1]);
        }
        const [hx, hs] = along(-0.12), syaw = yawOf(0) + Math.PI / 2;
        if (inChunk(hs)) { // skull, jaws, mats and the dark halo of sulfide-rich ooze
          const tpl = pick(wr, D.skull), R = rotY(syaw + Math.PI), Pp = [hx, fs.at(hx, hs), hs];
          seat(fs, tpl, R, 1, 1, 1, Pp, null, tpl.maxY * 0.22);
          put(ctx, st, tpl, Pp[0], Pp[1], Pp[2], R, 1, 1, 1, [1, 1, 1]);
          for (const sd of [-1, 1]) {
            const jt = D.jaw[sd > 0 ? 0 : 1], jy = syaw + Math.PI + sd * 0.35, Rj = rotY(jy), jx = hx + side[0] * sd * 0.9, js = hs + side[1] * sd * 0.9;
            const Pj = [jx, fs.at(jx, js), js];
            seat(fs, jt, Rj, 1, 1, 1, Pj, null, 0.06);
            put(ctx, st, jt, Pj[0], Pj[1], Pj[2], Rj, 1, 1, 1, [1, 1, 1]);
          }
          const [cx, cs] = along(0.35);
          decalDisc(dec, fs, ctx, cx, cs, W.L * 0.75, W.L * 0.45, Math.atan2(dir[1], dir[0]), [0.02, 0.02, 0.025], 3, 0.85, 6, 26);
          for (let k = 0; k < 14; k++) { const [mx, ms] = along(wr() * 0.9); decalDisc(dec, fs, ctx, mx + (wr() - 0.5) * 3, ms + (wr() - 0.5) * 3, 0.3 + wr() * 0.6, 0.25 + wr() * 0.5, wr() * TAU, [0.4, 0.38, 0.33], 2, 0.8, 3, 12); }
          labels.push(['Whale fall', hx, Pp[1] + 1.2, hs, tpl.fact]);
          pois.push({ type: 'whale-fall', x: cx, y: Pp[1] + 0.8, s: cs, r: W.L * 0.6, data: { name: 'Whale fall', fact: tpl.fact } });
        }
      }
    }
    // ---- a rare lost thing: an old anchor or an ocean-bottom seismometer
    if (rc.lost) {
      const sL = g.start + (0.15 + 0.7 * sv(g, 41)) * (g.end - g.start);
      const x = pc.x(sL) + (sv(g, 43) < 0.5 ? -1 : 1) * (4 + sv(g, 44) * 5);
      if (inChunk(sL) && !inBasin(basinInfo(ctx, pc, fs), x, sL, 2)) {
        const tpl = sv(g, 42) < 0.5 ? D.anchor : D.obs;
        const y = fs.at(x, sL), R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.5), sv(g, 45) * TAU), Pp = [x, y, sL];
        if (clearBox(pc, x, sL, y, y + tpl.maxY, tpl.r)) {
          seat(fs, tpl, R, 1, 1, 1, Pp, null, tpl === D.anchor ? 0.06 : 0.04);
          put(ctx, st, tpl, Pp[0], Pp[1], Pp[2], R, 1, 1, 1, [1, 1, 1]);
          labels.push([tpl.label, Pp[0], Pp[1] + 0.8, sL, tpl.fact]);
          pois.push({ type: tpl === D.anchor ? 'anchor' : 'lost-instrument', x: Pp[0], y: Pp[1] + 0.5, s: sL, r: 2, data: { name: tpl.label, fact: tpl.fact } });
        }
      }
    }
  }
  const extra = [builderMesh(dec, NBMAT.decal, null, 'mid')].filter(Boolean);
  return { batches: [st], extra, labels, pois };
}

export function layoutDeepC(ctx) {
  if (presence(ctx, 'deepplain') <= 0) return null;
  const bk = budgetK(ctx, 'deepplain');
  const rng = mulberry32(((ctx.s0 * 3266489917) ^ 0xd55) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const near = new Batch(MAT.static, 24000 * bk); near.lod = 'mid';
  const labels = [], pois = [], brine = new Builder(), depth = [];
  // ---- brine pools: lakes filling the basins, ringed by mussels on the shore
  for (const I of basinInfo(ctx, pc, fs)) {
    const B = I.B;
    if (B.s < ctx.s0 || B.s >= ctx.s1 || rng() > Math.min(1, ctx.weightOf(B.s, 'deepplain') * 2)) continue;
    lakeMesh(brine, depth, fs, ctx, I);
    const close = Math.abs(B.x - pc.x(B.s)) < 40, n = close ? Math.round((TAU * B.r) / 0.7) : 0;
    for (let k = 0; k < n; k++) { // mussel beds along the shoreline, some reaching into the brine
      if (rng() < 0.12) continue;
      const a = (k / n) * TAU + rng() * 0.04, r1 = shoreAt(I, a) + (rng() - 0.35) * 0.5;
      const x = B.x + Math.cos(a) * r1, s = B.s + Math.sin(a) * r1, tpl = pick(rng, D.mussel), R = rotY(rng() * TAU);
      const Pp = [x, fs.at(x, s), s];
      seat(fs, tpl, R, 1, 1, 1, Pp, null, 0.02);
      put(ctx, near, tpl, Pp[0], Pp[1], Pp[2], R, 1, 1, 1, tint(rng, [[1, 1, 1], [1.1, 1, 0.9]], 0.1));
    }
    const fact = 'So salty and dense that it forms a lake on the seafloor, with its own shoreline';
    labels.push(['Brine pool', B.x, I.level + 0.4, B.s, fact]);
    pois.push({ type: 'brine-pool', x: B.x, y: I.level + 0.3, s: B.s, r: B.r * 0.8, data: { name: 'Brine pool', fact, level: I.level } });
  }
  const extra = [builderMesh(brine, NBMAT.brine, { aDepth: [depth, 1] })].filter(Boolean);
  return { batches: [near], extra, labels, pois };
}

// lake surface: polar grid at the brine level reaching just past the shoreline at every angle
function lakeMesh(b, depth, fs, ctx, I) {
  const rings = 10, segs = 48, v0 = b.vc, d = [], level = I.level;
  b.v(I.x, level, -(I.s - ctx.s0), 0, 1, 0, 1, 1, 1); d.push(level - fs.at(I.x, I.s));
  for (let j = 1; j <= rings; j++) for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU, R = shoreAt(I, a) + 0.6, r = R * Math.pow(j / rings, 0.75), x = I.x + Math.cos(a) * r, s = I.s + Math.sin(a) * r;
    b.v(x, level, -(s - ctx.s0), 0, 1, 0, 1, 1, 1); d.push(level - fs.at(x, s));
  }
  for (let i = 0; i < segs; i++) b.t(v0, v0 + 1 + i, v0 + 1 + ((i + 1) % segs)); // wound to face up
  for (let j = 1; j < rings; j++) {
    const r0 = v0 + 1 + (j - 1) * segs, r1 = r0 + segs;
    for (let i = 0; i < segs; i++) { const i1 = (i + 1) % segs; b.t(r0 + i, r1 + i, r1 + i1); b.t(r0 + i, r1 + i1, r0 + i1); }
  }
  for (const v of d) depth.push(Math.max(-1, v));
}
