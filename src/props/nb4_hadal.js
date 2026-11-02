// Hadal Trench: eight thousand metres down, a V-shaped trench of soft sediment between steep rock walls, lit only
// by the camera's lamps. Sparse and eerie: sediment ripples (lit relief that fades into the floor), fields of
// xenophyophores (giant single cells in fragile sediment tests), holothurians grazing the ooze (pink sea pigs
// with their tracks, small translucent Elpidia, the purple sail-tailed Psychropotes), pale bacterial mats where
// fluid seeps, and on rock outcrops of the walls a few glass sponges on twisted glass stalks and stalked crinoids.
import { Builder, Batch, TAU, presence, budgetK, CHUNK, vn3, fbm3, sat, sstep, lerp, rotY } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { encrust, ground } from './nb_shapes.js';
import { pathCache, clearBox, SOLID, SOFT, seat, put, upTo, mix3, nrm, segFor, recipe, lowK, slice, nbFloor, decalDisc, decalRibbon, builderMesh, NBMAT, lab, setBase } from './nb_common.js';
import { poolOf, itemSpots, seatOnItem } from './nb2_common.js';
import { Space } from './nb3_common.js';
import { rockJob, drain, tiered } from './rock_recipes.js';
import { rr, pick, chunkRng, once, segSeed, grips, gridded, warmTpl } from './nb4_common.js';
import { mulberry32, noise2 } from '../noise.js';

const KEY = 'hadal';
const H = {};

// ---------------------------------------------------------------- organisms
// Xenophyophore: one cell, up to 20 cm, building a fragile test of glued sediment. Three growth forms.
export function xeno(seed, form = 0) {
  const b = new Builder(), rng = mulberry32(seed * 733 + 5), S = 0.05 + rng() * 0.08, tone = 0.55 + rng() * 0.2;
  const paint = (x, y, z, o, k = 1) => { const c = tone * (0.75 + 0.4 * vn3(x * 40, y * 40, z * 40, seed)) * k; o[3] = 0.62 * c; o[4] = 0.56 * c; o[5] = 0.46 * c; o[6] = 0; o[7] = 2; };
  if (form === 0) { // a lumpy, wrinkled ball
    b.blob(2, (x, y, z, o) => {
      const rid = Math.abs(vn3(x * 3.5 + seed, y * 3.5, z * 3.5, seed)), d = 1 - 0.3 * sstep(0.0, 0.22, 0.22 - rid) + 0.2 * fbm3(x * 2, y * 2, z * 2, 2, seed + 3);
      o[0] = x * S * d; o[1] = (y > 0 ? y : y * 0.4) * S * 0.85 * d; o[2] = z * S * d; paint(x, y, z, o, 0.75 + 0.35 * rid);
    });
  } else if (form === 1) { // upright folded plates (Stannophyllum-like), a few fused together
    const n = 2 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI, w = S * (1.0 + rng() * 0.8), h = S * (1.1 + rng() * 0.9), off = (rng() - 0.5) * S * 0.8, fold = rng() * 6, th = 0.006;
      for (const sd of [-1, 1]) b.grid(6, 4, (u, v, i, j, o) => {
        const lx = (u - 0.5) * w, ly = v * h * (1 - 0.25 * Math.abs(2 * u - 1)), lz = sd * th + 0.18 * S * Math.sin(u * 4 + fold) * (0.3 + v);
        o[0] = Math.cos(a) * lx - Math.sin(a) * (lz + off); o[1] = ly - 0.004; o[2] = Math.sin(a) * lx + Math.cos(a) * (lz + off); paint(o[0], o[1], o[2], o, 0.85 + 0.25 * v);
      }, { flip: sd < 0 });
    }
  } else { // a knobbly tree of agglutinated branches
    const go = (p, d, len, r, depth) => {
      const e = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
      b.tube([p, [(p[0] + e[0]) / 2 + (rng() - 0.5) * r, (p[1] + e[1]) / 2, (p[2] + e[2]) / 2 + (rng() - 0.5) * r], e], [r, r * 0.9, r * 0.8], 4, (v, a, x, y, z, o) => paint(x, y, z, o), { tip: depth === 0 });
      if (depth > 0) for (let k = 0; k < 2; k++) { const a = rng() * TAU, n = nrm([d[0] + Math.cos(a) * 0.8, d[1], d[2] + Math.sin(a) * 0.8]); go(e, n, len * 0.7, r * 0.75, depth - 1); }
    };
    go([0, -0.005, 0], [0, 1, 0], S * 0.9, S * 0.18, 2);
  }
  const t = ground(b).build();
  t.solid = false; t.nbR = S * 1.2;
  return lab(t, 'Xenophyophore', 'Each one is a single cell, yet it can be over 10 cm across, building its home from grains of sediment.');
}
// Sea pig (Scotoplanes): plump, pink and translucent, walking on tube feet; two pairs of papillae on its back
function seaPig(seed) {
  const b = new Builder(), rng = mulberry32(seed * 263 + 7), Lp = 0.13 + rng() * 0.07, base = [], col = [0.95, 0.55 + rng() * 0.1, 0.58];
  b.blob(2, (x, y, z, o) => { o[0] = x * Lp * 0.5; o[1] = 0.028 + y * Lp * 0.22 * (1 - 0.2 * x); o[2] = z * Lp * 0.21; const c = 0.85 + 0.2 * y; o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[6] = 0; o[7] = 0; });
  for (let k = 0; k < 6; k++) for (const sd of [-1, 1]) {
    const x = (k / 5 - 0.5) * Lp * 0.75, p = [x, 0.02, sd * Lp * 0.15];
    b.tube([p, [x, 0.008, sd * Lp * 0.2], [x, 0, sd * Lp * 0.21]], [0.006, 0.005, 0.004], 3, (v, a, px, py, pz, o) => { o[3] = col[0]; o[4] = col[1] * 1.05; o[5] = col[2]; o[6] = 0; o[7] = 0; });
    base.push(x, 0, sd * Lp * 0.21);
  }
  for (let k = 0; k < 2; k++) for (const sd of [-1, 1]) {
    const x = Lp * (0.16 - k * 0.12), p = [x, 0.028 + Lp * 0.18, sd * Lp * 0.05];
    b.tube([p, [x + 0.01, p[1] + 0.03, sd * Lp * 0.07], [x + 0.025, p[1] + 0.05, sd * Lp * 0.09]], [0.005, 0.004, 0.002], 3, (v, a, px, py, pz, o) => { o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0; o[7] = 0; }, { tip: true });
  }
  const t = b.build();
  setBase(t, base); t.solid = false;
  return lab(t, 'Sea pig (Scotoplanes)', 'Sea pigs are sea cucumbers that walk the ooze in herds on water-filled tube feet, all facing into the current.');
}
// Elpidia: small, translucent, pale; the most common sea cucumber of the deepest trenches
function elpidia(seed) {
  const b = new Builder(), rng = mulberry32(seed * 419 + 3), Le = 0.05 + rng() * 0.05, base = [];
  b.blob(2, (x, y, z, o) => { o[0] = x * Le * 0.5; o[1] = 0.012 + (y > 0 ? y * Le * 0.24 : y * Le * 0.08); o[2] = z * Le * 0.2; o[3] = 0.92; o[4] = 0.86; o[5] = 0.95; o[6] = 0; o[7] = 1; });
  for (let k = 0; k < 3; k++) { const x = Le * (0.2 - k * 0.15), p = [x, 0.012 + Le * 0.2, 0]; b.tube([p, [x - 0.005, p[1] + Le * 0.35, 0], [x - 0.012, p[1] + Le * 0.55, 0]], [0.003, 0.002, 0.001], 3, (v, a, px, py, pz, o) => { o[3] = 0.95; o[4] = 0.9; o[5] = 1; o[6] = 0; o[7] = 1; }, { tip: true }); }
  for (const sx of [-0.35, 0, 0.35]) for (const sz of [-1, 1]) base.push(sx * Le, 0, sz * Le * 0.16);
  const t = ground(b).build();
  setBase(t, base); t.solid = false;
  return lab(t, 'Elpidia sea cucumber', 'At the bottom of the deepest trenches, small Elpidia sea cucumbers can outnumber every other animal.');
}
// Psychropotes longicauda: a violet sea cucumber with a tall sail-like tail it can use to drift on the current
function psychropotes(seed) {
  const b = new Builder(), rng = mulberry32(seed * 199 + 11), Lq = 0.3 + rng() * 0.2, col = [0.36, 0.18, 0.42], base = [];
  b.blob(2, (x, y, z, o) => { o[0] = x * Lq * 0.5; o[1] = 0.02 + (y > 0 ? y * Lq * 0.14 : y * Lq * 0.05); o[2] = z * Lq * 0.17 * (1 + 0.3 * (y < 0 ? 1 : 0)); const c = 0.8 + 0.25 * y; o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[6] = 0; o[7] = 0; });
  const hs = Lq * (0.5 + rng() * 0.4), xs = -Lq * 0.36;
  for (const sd of [-1, 1]) b.grid(4, 4, (u, v, i, j, o) => { // the dorsal sail, a thin rounded lobe leaning back
    const w = Lq * 0.22 * Math.sin(Math.PI * (0.15 + 0.85 * u)) * (1 - 0.4 * v);
    o[0] = xs + (u - 0.5) * w * 2 - v * hs * 0.35; o[1] = 0.02 + Lq * 0.1 + v * hs; o[2] = sd * 0.005 * (1 - v);
    const c = 0.75 + 0.35 * v; o[3] = col[0] * c * 1.1; o[4] = col[1] * c; o[5] = col[2] * c * 1.1; o[6] = 0; o[7] = 1;
  }, { flip: sd < 0 });
  for (const sx of [-0.4, -0.15, 0.1, 0.35]) for (const sz of [-1, 1]) base.push(sx * Lq, 0, sz * Lq * 0.12);
  const t = ground(b).build();
  setBase(t, base); t.solid = false;
  return lab(t, 'Psychropotes', 'Nicknamed the gummy squirrel: this deep-sea cucumber may use its tall tail as a sail to drift to fresh food.');
}
// Glass rope sponge (Hyalonema): an egg-shaped lattice body on a twisted rope of glass spicules (NBMAT.glass)
function hyalonema(seed) {
  const b = new Builder(), rng = mulberry32(seed * 829 + 13), Hs = 0.3 + rng() * 0.35, Rb = 0.05 + rng() * 0.04, Lb = Rb * (2.2 + rng() * 0.8), lean = (rng() - 0.5) * 0.25;
  for (let k = 0; k < 3; k++) { // the rope: three strands twisting round each other, rooted 6 cm into the ooze
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, a = t * 9 + k * TAU / 3, r = 0.006; pts.push([lean * t * t * Hs + Math.cos(a) * r, -0.06 + t * (Hs + 0.06), Math.sin(a) * r]); }
    b.tube(pts, pts.map(() => 0.0035), 3, (v, a, x, y, z, o) => { o[3] = 0.95; o[4] = 0.95; o[5] = 0.9; o[6] = 0; o[7] = -1; });
  }
  const top = [lean * Hs, Hs, 0];
  b.lathe(12, 8, (v) => [Rb * Math.sin(Math.PI * (0.06 + 0.88 * v)) * (1 - 0.15 * v), v * Lb], null, (v, a, x, y, z, o) => { o[3] = 0.92; o[4] = 0.92; o[5] = 0.86; o[6] = (a / TAU) * 10; o[7] = v * 9; });
  const v1 = b.vc - 12 * 9;
  for (let i = v1; i < b.vc; i++) { b.P[i * 3] += top[0]; b.P[i * 3 + 1] += top[1] - Lb * 0.1; b.P[i * 3 + 2] += top[2]; }
  const t = b.build();
  setBase(t, [0, -0.06, 0]); t.solid = false;
  return lab(t, 'Glass rope sponge (Hyalonema)', 'Its stalk is a twisted rope of glass fibres; zoanthids and anemones often settle on it.');
}
// Stalked crinoid (sea lily): a jointed stalk with whorls of cirri and arms spread into a filtering bowl
function seaLily(seed) {
  const b = new Builder(), rng = mulberry32(seed * 977 + 1), Hc = 0.35 + rng() * 0.45, lean = (rng() - 0.5) * 0.3, cur = rng() * TAU;
  const col = [[1.0, 0.85, 0.55], [0.95, 0.75, 0.6], [1.0, 0.65, 0.35]][(rng() * 3) | 0];
  const P = (t) => [lean * t * t * Hc, -0.04 + t * (Hc + 0.04), 0];
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(P(i / 8));
  b.tube(pts, pts.map(() => 0.008), 3, (v, a, x, y, z, o) => { const band = Math.floor(v * 26) % 2 ? 0.82 : 1; o[3] = col[0] * band * 0.85; o[4] = col[1] * band * 0.85; o[5] = col[2] * band * 0.85; o[6] = 0; o[7] = 0; });
  for (let w = 1; w < 4; w++) { const p = P(w / 4.5); for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + w, d = [Math.cos(a), -0.4, Math.sin(a)]; b.tube([p, [p[0] + d[0] * 0.04, p[1] + d[1] * 0.04, p[2] + d[2] * 0.04], [p[0] + d[0] * 0.06, p[1] - 0.035, p[2] + d[2] * 0.06]], [0.003, 0.0025, 0.0015], 3, (v, an, x, y, z, o) => { o[3] = col[0] * 0.8; o[4] = col[1] * 0.8; o[5] = col[2] * 0.8; o[6] = 0; o[7] = 0; }); } }
  const top = P(1), nA = 10;
  b.blob(1, (x, y, z, o) => { o[0] = top[0] + x * 0.022; o[1] = top[1] + 0.015 + y * 0.02; o[2] = top[2] + z * 0.022; o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0; o[7] = 0; });
  for (let k = 0; k < nA; k++) { // arms recurved downstream like an inverted umbrella, with pinnules
    const a = (k / nA) * TAU, out = [Math.cos(a), 0, Math.sin(a)], La = 0.11 + rng() * 0.06, ap = [];
    for (let i = 0; i <= 5; i++) { const t = i / 5; ap.push([top[0] + out[0] * La * t + Math.cos(cur) * La * t * t * 0.9, top[1] + 0.02 + La * (0.5 * t - 1.1 * t * t), top[2] + out[2] * La * t + Math.sin(cur) * La * t * t * 0.9]); }
    b.tube(ap, ap.map((_, i) => 0.004 * (1 - i / 7)), 3, (v, an, x, y, z, o) => { o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0.012 * v; o[7] = 0; }, { tip: true });
    for (let i = 1; i < 5; i += 2) {
      const p = ap[i], s = [-out[2], 0, out[0]];
      for (const sd of [-1, 1]) for (const flip of [false, true]) {
        const a0 = b.v(p[0], p[1], p[2], 0, 1, 0, col[0], col[1], col[2], 0.01, 0), a1 = b.v(p[0] + s[0] * sd * 0.025, p[1] - 0.012, p[2] + s[2] * sd * 0.025, 0, 1, 0, col[0], col[1], col[2], 0.02, 0), a2 = b.v(p[0] + out[0] * 0.012, p[1], p[2] + out[2] * 0.012, 0, 1, 0, col[0], col[1], col[2], 0.015, 0);
        if (flip) b.t(a0, a2, a1); else b.t(a0, a1, a2);
      }
    }
  }
  const t = b.build();
  setBase(t, [0, -0.04, 0]); t.solid = false;
  return lab(t, 'Sea lily (stalked crinoid)', 'Sea lilies are animals related to sea stars; they hold their feathery arms into the current to catch drifting food.');
}

// ---------------------------------------------------------------- templates, providers, recipe
const HD_ROCKS = [{ r: 'boulder', litho: 'basalt', kind: 'angular', growth: 0 }, { r: 'boulder', litho: 'greenstone', kind: 'block', growth: 0 }, { r: 'cracked', litho: 'slate', growth: 0 }, { r: 'pillow', growth: 0 }, { r: 'boulder', litho: 'basalt', kind: 'round', growth: 0 }];
export const recipeOf = (g) => recipe(g, 'nb4hd', (g) => {
  const u = (k) => sv(g, 490 + k);
  return { xeno: 0.3 + 1.0 * u(0), holo: 0.3 + 1.0 * u(1), mats: u(2) < 0.6 ? 0.4 + u(3) : 0, rocks: 0.5 + 0.9 * u(4), glass: 0.3 + 0.9 * u(5), lily: 0.3 + 0.9 * u(6), ripple: 0.4 + 0.9 * u(7), dir: u(8) * Math.PI };
});
export function initHadal(tier) {
  H.xeno = [0, 1, 2, 3, 4, 5].map((i) => xeno(8100 + i, i % 3));
  H.pig = [0, 1, 2].map((i) => seaPig(8200 + i));
  H.elp = [0, 1, 2].map((i) => elpidia(8250 + i));
  H.psy = [0, 1].map((i) => psychropotes(8300 + i));
  H.glass = [0, 1].map((i) => hyalonema(8350 + i));
  H.lily = [0, 1, 2].map((i) => seaLily(8400 + i));
  H.rock = [drain(rockJob(tiered(HD_ROCKS[0], tier), 8450)), drain(rockJob(tiered(HD_ROCKS[1], tier), 8451))];
  for (const t of H.rock) warmTpl(t);
  H.mat = [0, 1, 2].map((i) => { const t = encrust(8500 + i, { r: 0.18 + i * 0.08, h: 0.012, lobes: 0.8, detail: 2 }); t.solid = false; return lab(t, 'Bacterial mat', 'Where fluid seeps from the trench floor, bacteria live on its chemicals and spread in pale mats.'); });
  return H;
}
export function hadalProviders(provide) {
  provide(KEY, 'nb4hdXeno', 9, (seg, k) => once(() => xeno(segSeed(seg, k, 0x2545f491), k % 3))(), 3);
  provide(KEY, 'nb4hdHolo', 6, (seg, k) => once(() => (k < 3 ? seaPig : k < 5 ? elpidia : psychropotes)(segSeed(seg, k, 0x6c078965)))(), 3);
  provide(KEY, 'nb4hdGlass', 3, (seg, k) => once(() => hyalonema(segSeed(seg, k, 0x7feb352d)))(), 3);
  provide(KEY, 'nb4hdLily', 3, (seg, k) => once(() => seaLily(segSeed(seg, k, 0x165667b1)))(), 3);
  provide(KEY, 'nb4hdRock', 6, (seg, k, tier) => gridded(rockJob(tiered(HD_ROCKS[(k + (seg.seed >>> 3)) % HD_ROCKS.length], tier), segSeed(seg, k, 0x27d4eb2f))), 2);
}

// ---------------------------------------------------------------- sediment ripples: lit relief that fades into the floor
// A field of ripples (wavelength lam, height A) along heading `dir`, built straight onto the floor mesh with the
// decal material (alpha fades at the edges, so no seam), relief lifted 4 mm above the floor.
function rippleField(b, fs, ctx, x, s, Lx, Lz, dir, lam, A, col) {
  const nu = Math.min(56, Math.max(6, Math.round(Lx / (lam / 3)))), nv = Math.min(10, Math.max(4, Math.round(Lz / 0.35))), c = Math.cos(dir), sn = Math.sin(dir), v0 = b.vc, ph = x * 3.1 + s * 1.7;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu - 0.5, v = j / nv - 0.5, lx = u * Lx, lz = v * Lz, gx = x + c * lx - sn * lz, gs = s + sn * lx + c * lz;
    const e = sat(1 - (Math.abs(2 * u) ** 3 + Math.abs(2 * v) ** 3)), wob = 0.35 * noise2(gx / 1.3, gs / 1.3, 283), q = (lx / lam + wob) * TAU + ph;
    const h = A * e * (0.5 + 0.5 * Math.sin(q)), dh = A * e * 0.5 * Math.cos(q) * TAU / lam; // d(height)/d(lx)
    const y = fs.at(gx, gs) + 0.004 + h, fn = [fs.nx, fs.ny, fs.nz], n = nrm([fn[0] - c * dh, fn[1], fn[2] + sn * dh]);
    const k = 0.92 + 0.16 * Math.sin(q);
    b.v(gx, y, -(gs - ctx.s0), n[0], n[1], n[2], col[0] * k, col[1] * k, col[2] * k, e * 0.85, 3);
  }
  const W = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = v0 + j * W + i; b.t(a, a + W, a + 1); b.t(a + 1, a + W, a + W + 1); }
}

// ---------------------------------------------------------------- chain A: the trench floor
export function* layoutHdA(ctx) {
  const Y = slice(2); // (each ripple field is a ~1-2 ms block of its own)
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rc0 = recipeOf(g0), rng = chunkRng(ctx, 0x4ad1);
  const st = new Batch(MAT.static, 16000 * bk * lk); st.lod = 'near';
  const so = new Batch(NBMAT.soft, 9000 * bk * lk); so.lod = 'near'; so.soft = true;
  const dec = new Builder(), labels = [], pois = [], sp = new Space();
  const lateral = (a, b, k = 1.3) => (rng() < 0.5 ? -1 : 1) * (a + Math.pow(rng(), k) * (b - a));
  const floorPut = (b, tpl, x, s, sc, col, follow, embed, fa, yaw = rng() * TAU) => {
    const y = fs.at(x, s);
    if (fs.ny < 0.75) return false; // the ooze lies on the gentle floor, not on the walls
    const n = [fs.nx * follow, 1 - follow + fs.ny * follow, fs.nz * follow], R = upTo(nrm(n), yaw), Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, embed);
    if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + (tpl.maxY - tpl.minY) * sc, (tpl.nbR || tpl.r) * sc, SOFT)) return false;
    return put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
  };
  // ripples on the trench floor
  const SED = [0.24, 0.22, 0.2];
  for (let k = 0; k < 9 * rc0.ripple * bk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + lateral(0, 8, 1);
    fs.at(x, s);
    if (fs.ny < 0.85) continue;
    rippleField(dec, fs, ctx, x, s, 2.5 + rng() * 3, 1.8 + rng() * 2.5, rc0.dir + (rng() - 0.5) * 0.4, 0.1 + rng() * 0.07, 0.012 + rng() * 0.012, SED);
  }
  yield;
  // xenophyophore fields
  const nX = Math.round((1 + rng() * 2) * rc0.xeno * bk);
  for (let f = 0; f < nX; f++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 3 + rng() * (CHUNK - 6), g = segFor(ctx, s, KEY);
    if (!g) continue;
    const x = pc.x(s) + lateral(0, 7, 1.2), R0 = 1 + rng() * 2.5, n = Math.round((6 + rng() * 16) * lk);
    let placed = 0;
    for (let k = 0; k < n * 2 && placed < n; k++) {
      const a = rng() * TAU, d = R0 * Math.sqrt(rng()), px = x + Math.cos(a) * d, ps = s + Math.sin(a) * d, tpl = pick(rng, poolOf(g, 'nb4hdXeno', H.xeno, 3)), sc = 0.7 + rng() * 0.9;
      if (!sp.free(px, ps, tpl.nbR * sc)) continue;
      if (floorPut(st, tpl, px, ps, sc, [0.9 + rng() * 0.2, 0.9 + rng() * 0.15, 0.9 + rng() * 0.1], 0.8, 0.008, 1)) { sp.add(px, ps, tpl.nbR * sc); placed++; }
    }
    if (placed > 4 && pois.length < 2) pois.push({ type: 'xeno-field', x, y: fs.at(x, s) + 0.6, s, r: R0, data: { name: 'Xenophyophores' } });
  }
  // holothurians: sea pigs in small herds facing one way (the current), with tracks; Elpidia, Psychropotes
  const nH = Math.round((2 + rng() * 5) * rc0.holo * bk);
  for (let k = 0; k < nH; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 3 + rng() * (CHUNK - 6), g = segFor(ctx, s, KEY);
    if (!g) continue;
    const pool = poolOf(g, 'nb4hdHolo', null, 4), u = rng(), x = pc.x(s) + lateral(0, 7, 1.1);
    const kind = u < 0.5 ? 'pig' : u < 0.78 ? 'elp' : 'psy', list = (pool && pool.filter((t) => (kind === 'pig' ? /pig/ : kind === 'elp' ? /Elpidia/ : /Psychro/).test(t.label))) || [];
    const set = list.length ? list : H[kind], herd = kind === 'pig' ? 2 + ((rng() * 5) | 0) : kind === 'elp' ? 1 + ((rng() * 4) | 0) : 1, head = rc0.dir + (rng() - 0.5) * 0.5;
    for (let q = 0; q < herd; q++) {
      const px = x + (rng() - 0.5) * 2.2, ps = s + (rng() - 0.5) * 2.2, tpl = pick(rng, set), sc = 0.85 + rng() * 0.35, yaw = head + (rng() - 0.5) * 0.4;
      if (!sp.free(px, ps, 0.2)) continue;
      if (!floorPut(kind === 'pig' ? st : so, tpl, px, ps, sc, [0.9 + rng() * 0.2, 0.9 + rng() * 0.15, 0.9 + rng() * 0.2], 1, 0.006, kind === 'pig' ? 1 : 0, yaw)) continue;
      sp.add(px, ps, 0.2);
      if (kind === 'pig' || rng() < 0.4) { // the feeding track it leaves behind (local +x is its front)
        const pts = [], Lt = 1 + rng() * 3, c = Math.cos(yaw), sn = Math.sin(yaw);
        for (let i = 0; i <= 8; i++) { const t = i / 8, w = 0.15 * Math.sin(t * 5 + q); pts.push(px - c * Lt * t - sn * w, ps - sn * Lt * t + c * w); }
        decalRibbon(dec, fs, ctx, pts, 0.05 + 0.03 * sc, [0.12, 0.11, 0.1], 1, 0.6);
      }
    }
    if (k === 0) labels.push([kind === 'pig' ? 'Sea pigs' : kind === 'elp' ? 'Elpidia sea cucumbers' : 'Psychropotes', x, fs.at(x, s) + 0.3, s, set[0].fact]);
    if (kind === 'pig' && pois.length < 3) pois.push({ type: 'sea-pigs', x, y: fs.at(x, s) + 0.5, s, r: 2, data: { name: 'Sea pigs' } });
  }
  // pale bacterial mats where fluid seeps
  if (rc0.mats > 0 && rng() < rc0.mats * bk) {
    const s = ctx.s0 + 6 + rng() * (CHUNK - 12), x = pc.x(s) + lateral(1, 9, 1);
    for (let k = 0; k < 3 + rng() * 4; k++) {
      const px = x + (rng() - 0.5) * 5, ps = s + (rng() - 0.5) * 5, r = 0.6 + rng() * 1.6;
      decalDisc(dec, fs, ctx, px, ps, r, r * (0.5 + rng() * 0.5), rng() * TAU, [0.7, 0.68, 0.6], 2, 0.85, 5, 16);
      if (rng() < 0.6) floorPut(st, pick(rng, H.mat), px, ps, 0.8 + rng() * 0.8, [1.0, 0.97, 0.88], 1, 0.004, 1);
    }
    labels.push(['Bacterial mat', x, fs.at(x, s) + 0.2, s, H.mat[0].fact]);
  }
  const extra = [];
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  return { batches: [st, so], extra, labels, pois };
}

// ---------------------------------------------------------------- chain B: rock outcrops on the walls, glass sponges, sea lilies
export function* layoutHdB(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rc0 = recipeOf(g0), rng = chunkRng(ctx, 0x4ad2);
  const st = new Batch(MAT.static, 26000 * bk), gl = new Batch(NBMAT.glass, 9000 * bk * lk); gl.lod = 'mid'; gl.soft = true;
  const sw = new Batch(MAT.sway, 7000 * bk * lk); sw.lod = 'mid'; sw.soft = true;
  const sp = new Space(), rocks = [], pois = [];
  const nR = Math.round((3 + rng() * 6) * rc0.rocks * bk);
  for (let k = 0; k < nR * 3 && rocks.length < nR; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (5 + Math.pow(rng(), 1.2) * 22), tpl = pick(rng, poolOf(g, 'nb4hdRock', H.rock, 2)), sc = 0.5 + Math.pow(rng(), 1.3) * 1.5, sy = sc * (0.7 + rng() * 0.5);
    if (!sp.free(x, s, tpl.r * sc)) continue;
    fs.at(x, s);
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.55), rng() * TAU), P = [x, fs.at(x, s), s];
    seat(fs, tpl, R, sc, sy, sc, P, null, 0.08 + (tpl.maxY - tpl.minY) * sy * 0.15 + (1 - fs.ny) * tpl.r * sc * 0.5); // deeper on steep walls
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) continue;
    const dk = 0.55 + rng() * 0.15; // dark trench rock
    if (!put(ctx, st, tpl, P[0], P[1], P[2], R, sc, sy, sc, [dk, dk * 0.97, dk * 0.95], 1)) continue;
    rocks.push({ it: st.last, g }); sp.add(P[0], P[2], tpl.r * sc * 0.85);
  }
  yield;
  for (const { it, g } of rocks) {
    if (Y.over()) { yield; Y.reset(); }
    const spots = itemSpots(it, ctx, 20, 0.55);
    for (let i = spots.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0, t = spots[i]; spots[i] = spots[j]; spots[j] = t; }
    for (let q = 0, n = 0; q < spots.length && n < 1 + rng() * 3; q++) {
      if (Y.over()) { yield; Y.reset(); }
      const p = spots[q], glass = rng() < rc0.glass / (rc0.glass + rc0.lily), tpl = pick(rng, glass ? poolOf(g, 'nb4hdGlass', H.glass, 2) : poolOf(g, 'nb4hdLily', H.lily, 2));
      if (rng() > (glass ? rc0.glass : rc0.lily) * lk) continue;
      const sc = 0.8 + rng() * 0.5, R = upTo(mix3([0, 1, 0], p.n, 0.25), rng() * TAU), Pp = [p.x, p.y, p.s];
      if (!seatOnItem(it, ctx.s0, tpl, R, sc, Pp, 0.03) || !grips(it, ctx.s0, tpl, R, sc, sc, sc, Pp)) continue;
      if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + (tpl.maxY - tpl.minY) * sc, 0.15, SOFT)) continue;
      if (put(ctx, glass ? gl : sw, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, [0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 0.9 + rng() * 0.15], glass ? 1 : sc, { item: it })) {
        n++;
        if (pois.length < 2 && Math.abs(Pp[0] - pc.x(Pp[2])) < 14) pois.push({ type: glass ? 'glass-sponge' : 'sea-lily', x: Pp[0], y: Pp[1] + 0.4, s: Pp[2], r: 1.2, data: { name: tpl.label } });
      }
    }
  }
  return { batches: [st, gl, sw], pois };
}
