// Hydrothermal vents. Every vents segment is its own "site" (black smoker field, flange chimneys, beehive
// diffusers, white smokers, Lost-City-like carbonate towers or a dying field of toppled stacks), mixed with a
// secondary site type, with its own freshly generated chimneys and worm thickets (lazy palette jobs,
// rock_gen.js). A per-segment form plan keeps every palette to several different chimney forms.
//
// Chimneys are row lathes around a wandering axis: twisting non-round cross-sections, accretion bulges,
// crumbly vertex-scale crust, side sprouts, rounded shelf-like flanges, crumbled hollow broken tops, open
// orifices with glowing throats; layered sulphide colours (black, rust, ochre, white anhydrite, brassy
// linings) with baked crevice occlusion, in the rock texture shader mode (glowing parts in their own vertex
// runs). Each stands on a rubble heap. Smoke is a billowing particle plume (own material) that jets, slows,
// spreads and bends over in the bottom current. Active orifices light themselves (the water swallows lamp light
// beyond ~15 m): a glowing cracked collar under the lip, the orange-lit base of their own plume and a soft orb.
// Beehive diffusers are ochre and rust oxide crust riddled with dark pores. Around them: Riftia thickets
// (splayed white tubes, red plumes that pull back as the camera passes), vent mussels and clams, patchy
// bacterial mats, sulphide rubble and pillow lava.
import * as THREE from 'three';
import { Builder, Batch, T, TAU, TUBE, sat, sstep, lerp, vn3, fbm3, floorSampler, presence, tubeClear, rotY, rotZ, budgetK, bendSpots, tierK, poi } from './core.js';
import { musselBed } from './shapes.js';
import { putFloor, pickW, tintFrom, groundY, microSteps, steps, clusterer } from './scatter.js';
import { MAT, billboardMesh } from './materials.js';
import { applyWater } from '../water.js';
import { mulberry32 } from '../noise.js';
import { blobG, paintG, gridG, drain, set3, mixIn } from './rock_recipes.js';
import { provide, paletteOf, makePool } from './rock_gen.js';

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const C3 = [0, 0, 0]; // scratch colour: per-vertex paint loops never allocate
const SED = [0.3, 0.29, 0.26]; // settled grey-beige sediment
const PORE = [0.03, 0.026, 0.022]; // dark sulphide inside a beehive's pores, whatever the crust colour
const mulK = (c, k) => [c[0] * k[0], c[1] * k[1], c[2] * k[2]];

// ---------- mineral palettes (linear RGB, final colours) ----------
const PAL = {
  black: { black: [0.032, 0.029, 0.027], grey: [0.1, 0.092, 0.085], rust: [0.36, 0.12, 0.035], ochre: [0.5, 0.32, 0.08], white: [0.64, 0.62, 0.56], lining: [0.5, 0.42, 0.12], rustK: 0.9, ochreK: 0.8, whiteK: 0.7, glow: 1 },
  grey: { black: [0.05, 0.047, 0.044], grey: [0.13, 0.12, 0.11], rust: [0.34, 0.14, 0.05], ochre: [0.45, 0.32, 0.1], white: [0.56, 0.55, 0.5], lining: [0.52, 0.45, 0.12], rustK: 0.85, ochreK: 0.8, whiteK: 0.4, glow: 0.75 },
  white: { black: [0.3, 0.28, 0.25], grey: [0.5, 0.48, 0.43], rust: [0.4, 0.17, 0.06], ochre: [0.55, 0.37, 0.11], white: [0.74, 0.73, 0.68], lining: [0.62, 0.55, 0.2], rustK: 0.7, ochreK: 0.75, whiteK: 0.8, glow: 0.15 },
  carbonate: { black: [0.46, 0.44, 0.39], grey: [0.63, 0.61, 0.55], rust: [0.5, 0.38, 0.22], ochre: [0.6, 0.5, 0.32], white: [0.84, 0.83, 0.78], lining: [0.7, 0.66, 0.52], rustK: 0.35, ochreK: 0.45, whiteK: 1, glow: 0 },
  relict: { black: [0.045, 0.034, 0.03], grey: [0.15, 0.1, 0.06], rust: [0.38, 0.14, 0.04], ochre: [0.5, 0.32, 0.09], white: [0.55, 0.52, 0.46], lining: [0.45, 0.36, 0.1], rustK: 1, ochreK: 0.9, whiteK: 0.45, glow: 0.12 },
};

// ---------- sites: one per vents segment ----------
// forms: weights of chimney forms; smoke: plume type; life densities; H: main chimney height range (m)
// alt: site types that share a segment with this one (a third of its chimneys, own minerals and plume)
const SITES = [
  { key: 'black', w: 3, name: 'black smoker field', pal: 'black', smoke: 'jet', forms: { spire: 4, cluster: 2, candelabra: 1.5, flange: 1.2, toppled: 0.8, stump: 0.4, beehive: 0.4 }, H: [7, 16], worms: 1, mussels: 0.8, clams: 0.7, mats: 1, active: 1, alt: ['white', 'relict', 'flange'] },
  { key: 'flange', w: 1.4, name: 'flange chimney field', pal: 'black', smoke: 'jet', forms: { flange: 4, spire: 1.2, candelabra: 1, cluster: 0.8, toppled: 0.5 }, H: [6, 12], worms: 0.7, mussels: 0.6, clams: 0.4, mats: 1, active: 1, alt: ['black', 'relict'] },
  { key: 'beehive', w: 1.4, name: 'beehive diffuser field', pal: 'grey', smoke: 'seep', forms: { beehive: 4, spire: 1, toppled: 0.6, cluster: 0.6, stump: 0.4 }, H: [3, 7], worms: 0.35, mussels: 1.5, clams: 0.5, mats: 1.3, active: 1, alt: ['black', 'white'] },
  { key: 'white', w: 1.2, name: 'white smoker field', pal: 'white', smoke: 'white', forms: { spire: 3, cluster: 1.5, beehive: 1, candelabra: 0.6, stump: 0.5 }, H: [5, 12], worms: 0.5, mussels: 1, clams: 0.8, mats: 1.8, active: 1, alt: ['beehive', 'black'] },
  { key: 'carbonate', w: 0.8, name: 'carbonate tower field', pal: 'carbonate', smoke: 'shimmer', forms: { carbonate: 5, cluster: 0.8, stump: 0.6, toppled: 0.5 }, H: [9, 18], worms: 0.12, mussels: 0.3, clams: 0.2, mats: 1.4, active: 0.8, alt: ['carbonate'] },
  { key: 'relict', w: 0.8, name: 'waning vent field', pal: 'relict', smoke: 'jet', forms: { toppled: 3, stump: 3, spire: 1.2, cluster: 1, flange: 0.8, candelabra: 0.6 }, H: [3, 9], worms: 0.25, mussels: 0.4, clams: 0.3, mats: 0.6, active: 0.3, shells: 1, alt: ['black', 'beehive'] },
];
const SITE_BY = Object.fromEntries(SITES.map((s) => [s.key, s]));
const SMOKE = { // n per big orifice, rise, size, spread, albedo, glow, alpha, speed (m/s at the orifice)
  jet: { n: 34, rise: [18, 30], size: 1.3, spread: 0.13, alb: 0, glow: 1, alpha: 0.9, speed: [1.1, 1.7] },
  white: { n: 26, rise: [10, 18], size: 1.4, spread: 0.16, alb: 1, glow: 0, alpha: 0.6, speed: [0.6, 0.9] },
  seep: { n: 6, rise: [2.5, 5], size: 1.4, spread: 0.22, alb: 0.2, glow: 0.25, alpha: 0.32, speed: [0.3, 0.5] },
  shimmer: { n: 10, rise: [4, 9], size: 1.6, spread: 0.2, alb: 0.9, glow: 0, alpha: 0.18, speed: [0.3, 0.5] },
};
// a site = its type plus per-segment colour and size variation
function makeSite(S, seed, rng = mulberry32(seed ^ 0x51e7)) {
  const P = PAL[S.pal], hk = [1 + (rng() - 0.5) * 0.16, 1 + (rng() - 0.5) * 0.12, 1 + (rng() - 0.5) * 0.16];
  const pal = {};
  for (const k of ['black', 'grey', 'rust', 'ochre', 'white', 'lining']) pal[k] = mulK(P[k], hk);
  for (const k of ['rustK', 'ochreK', 'whiteK', 'glow']) pal[k] = P[k] * (0.8 + rng() * 0.4);
  return { ...S, seed, pal, hK: 0.85 + rng() * 0.35, bandF: 3 + rng() * 5 };
}
export const ventSite = (key, seed) => makeSite(SITE_BY[key] || SITES[0], seed); // dev / tests
export const ventPlan = (seg) => { const s = siteOf(seg); return { site: s.key, alt: s.alt.key, plan: s.plan.map((p) => p.site.key + ':' + p.form) }; }; // dev / tests
const siteCache = new Map();
function siteOf(seg) {
  const key = seg.key + ':' + seg.id + ':' + seg.seed;
  let s = siteCache.get(key);
  if (s) return s;
  const rng = mulberry32(seg.seed ^ 0x7e11);
  let tot = 0; for (const x of SITES) tot += x.w;
  let r = rng() * tot, S = SITES[0];
  for (const x of SITES) { r -= x.w; if (r <= 0) { S = x; break; } }
  s = makeSite(S, seg.seed, rng);
  s.alt = makeSite(SITE_BY[S.alt[Math.floor(rng() * S.alt.length)]], (seg.seed ^ 0xa17) >>> 0);
  s.plan = planForms(s, mulberry32(seg.seed ^ 0x3c6e));
  siteCache.set(key, s);
  if (siteCache.size > 16) siteCache.delete(siteCache.keys().next().value);
  return s;
}
// Chimney k of a segment: which site and form. Stratified so a segment never repeats one form: the
// first four slots are four different forms, no form fills more than a third of the slots, and about a
// third of the slots (never the first two, always at least one of slots 2-5) come from the secondary site.
const PLAN_N = 9;
function planForms(site, rng) {
  const plan = [], count = {}, forceAlt = 2 + Math.floor(rng() * 4);
  let alt = 0;
  for (let k = 0; k < PLAN_N; k++) {
    const S = k >= 2 && (rng() < 0.34 || (k === forceAlt && !alt)) ? site.alt : site, cap = k < 4 ? 1 : k < 7 ? 2 : 3;
    if (S === site.alt) alt++;
    let f = k === 0 ? Object.entries(S.forms).sort((x, y) => y[1] - x[1])[0][0] : formOf(S, rng); // slot 0: the site's signature form
    for (let tries = 0; tries < 12 && ((count[f] || 0) >= cap || (k && plan[k - 1].form === f)); tries++) f = formOf(S, rng);
    if ((count[f] || 0) >= cap) { let lo = 1e9; for (const x of Object.keys(S.forms)) if ((count[x] || 0) < lo) { lo = count[x] || 0; f = x; } } // the site's least-used form
    count[f] = (count[f] || 0) + 1;
    plan.push({ site: S, form: f });
  }
  return plan;
}

// ---------- chimney geometry: row lathe around a wandering axis ----------
// row: { y, cx, cz, R (base radius), f (feature), w (flange protrusion), k (flange index), hot, jk (jag share) }
// features: 0 wall, 1 flange underside (hot pool), 2 flange rim, 6 flange top, 3 lip, 4 throat, 5 broken rim,
// 7 hollow conduit inside a broken end
const F_WALL = 0, F_UNDER = 1, F_RIM = 2, F_LIP = 3, F_THROAT = 4, F_BROKEN = 5, F_TOP = 6, F_HOLLOW = 7;
// Surfaces come in two shader modes: rock texture (6.x: per-pixel crust, cracks, growth bands, settled
// sediment, darker crevices) and hot mineral glow (3: orifices, hot pools, vent pits). A vertex mode never
// interpolates across a triangle (it would pass through other modes), so glowing rows are built as separate
// vertex runs whose seams share positions and averaged normals.
const HOT = 16; // added to the feature id of vertices in a glowing run
const chimneyKey = (rng) => 6 + (rng() < 0.65 ? 0.24 + rng() * 0.085 : 0.07 + rng() * 0.14); // 2 m texture period, often banded
const moundKey = (rng) => 6 + 0.45 + rng() * 0.17;                                               // 4 m period, no banding
const sqrtN = (n) => (n < 0 ? -Math.sqrt(-n) : Math.sqrt(n)); // value noise reshaped: fewer near-zero values
// Tilt the normals of vertices >= v0 by smooth position noise (period ~1/f): under the lamps a coarse mesh then
// shades like a rough, uneven crust instead of clay. Seam copies share positions, so they stay identical.
function* jitterG(b, v0, k, seed, f) {
  const P = b.P, N = b.N;
  for (let i = v0, n = 0; i < b.vc; i++) {
    const x = P[i * 3] * f, y = P[i * 3 + 1] * f, z = P[i * 3 + 2] * f;
    const nx = N[i * 3] + k * vn3(x, y, z, seed), ny = N[i * 3 + 1] + k * vn3(x, y, z, seed + 1), nz = N[i * 3 + 2] + k * vn3(x, y, z, seed + 2);
    const l = Math.hypot(nx, ny, nz) || 1;
    N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
    if (++n % 900 === 0) yield;
  }
}
// Bake curvature into the vertex colours of vertices >= v0 (triangles >= i0): crevices darken, crests
// lighten a little. The lamps sit at the camera, so real crevices show no shadow; this is what makes a
// lumpy crust read as rock rather than clay. k: strength per metre of hollow over the local edge length.
function* cavityG(b, v0, i0, k = 3) {
  const P = b.P, N = b.N, I = b.I, C = b.C, n = b.vc - v0;
  if (n <= 0) return;
  const acc = new Float32Array(n), len = new Float32Array(n);
  for (let q = i0, m = 0; q < I.length; q += 3) {
    const a = I[q], c = I[q + 1], d = I[q + 2];
    const mx = (P[a * 3] + P[c * 3] + P[d * 3]) / 3, my = (P[a * 3 + 1] + P[c * 3 + 1] + P[d * 3 + 1]) / 3, mz = (P[a * 3 + 2] + P[c * 3 + 2] + P[d * 3 + 2]) / 3;
    for (let e = 0; e < 3; e++) {
      const v = e === 0 ? a : e === 1 ? c : d, j = v - v0;
      if (j < 0) continue;
      const dx = mx - P[v * 3], dy = my - P[v * 3 + 1], dz = mz - P[v * 3 + 2];
      acc[j] += dx * N[v * 3] + dy * N[v * 3 + 1] + dz * N[v * 3 + 2];
      len[j] += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    if (++m % 2000 === 0) yield;
  }
  for (let j = 0; j < n; j++) {
    if (!len[j]) continue;
    const cv = acc[j] / len[j] * k, f = cv > 0 ? 1 - Math.min(0.55, cv) : 1 + Math.min(0.15, -cv * 0.5);
    const i = (v0 + j) * 3;
    C[i] *= f; C[i + 1] *= f; C[i + 2] *= f;
  }
  yield;
}
function spireRows(rng, o) {
  const { y0 = 0, H, r0, topK = 0.55, taper = 1.3, step = 0.3, flanges = [], open = true, broken = false, brokenBase = false, lean = [0, 0], wob = 0.2, drift = null } = o;
  const ys = [];
  for (let y = y0; y < y0 + H - step * 0.5; y += step) ys.push(y);
  ys.push(y0 + H);
  // remove plain rows inside flange bands, then add the flange rows: a sloping buttress underneath, a thick
  // rounded rim, a top that rolls back into the wall (lens-shaped ledge, not a fin)
  const rows = [];
  const inFl = (y) => flanges.some((f) => y > f.y - f.th * 1.7 - 0.05 && y < f.y + f.th * 0.8 + 0.05);
  for (const y of ys) if (!inFl(y) || y === y0 || y === y0 + H) rows.push({ y, f: y === y0 + H && broken ? F_BROKEN : F_WALL, w: 0, jk: y === y0 + H && broken ? 1 : 0 });
  flanges.forEach((f, k) => {
    const th = f.th, hot = !!f.pool;
    if (th < 0.15) { // thin carbonate ledge: compact profile
      rows.push({ y: f.y - th * 1.5, f: F_WALL, w: 0, k }, { y: f.y - th * 0.6, f: F_UNDER, w: 0.9, k, hot }, { y: f.y, f: F_RIM, w: 1, k }, { y: f.y + th * 0.5, f: F_TOP, w: 0.3, k });
      return;
    }
    rows.push({ y: f.y - th * 1.6, f: F_WALL, w: 0, k });
    rows.push({ y: f.y - th * 1.05, f: F_UNDER, w: 0.5, k, hot });
    rows.push({ y: f.y - th * 0.72, f: F_UNDER, w: 0.88, k, hot });
    rows.push({ y: f.y - th * 0.32, f: F_RIM, w: 1, k });
    rows.push({ y: f.y, f: F_RIM, w: 0.95, k });
    rows.push({ y: f.y + th * 0.3, f: F_TOP, w: 0.66, k });
    rows.push({ y: f.y + th * 0.65, f: F_TOP, w: 0.25, k });
  });
  rows.sort((a, b) => a.y - b.y);
  const yTop = y0 + H;
  rows.gap = rows.length > 2 ? Math.min(yTop - rows[rows.length - 2].y, rows[1].y - y0) : step; // room for a broken rim's bite
  const nodes = o.nodes ?? 0.16 + rng() * 0.16; // accretion bulges and waists along the height
  const RofY = (y) => {
    const t = sat((y - y0) / H), q = Math.min(y, y0 + H);
    return r0 * lerp(1, topK, Math.pow(t, taper)) * (1 + nodes * (vn3(q * 0.45, 0.3, 0.7, o.seed + 5) + 0.5 * vn3(q * 1.1, 0.9, 0.2, o.seed + 6) + 0.7 * vn3(q * 0.4 / r0, 0.5, 0.1, o.seed + 7)));
  };
  const C = (y) => { // axis: lean, wobble, optional outward drift (branches)
    const t = sat((y - y0) / H), d = drift ? drift(y - y0) : [0, 0];
    return [lean[0] * (y - y0) + wob * r0 * vn3(t * 2.3, 0.5, 0.3, o.seed) + d[0], lean[1] * (y - y0) + wob * r0 * vn3(0.7, t * 2.3, 0.9, o.seed + 1) + d[1]];
  };
  for (const r of rows) { const c = C(r.y); r.cx = c[0]; r.cz = c[1]; r.R = RofY(r.y); }
  if (brokenBase) { // a broken-off base shows its hollow conduit (the piece is laid on its side later)
    const rB = rows[0].R, c = C(y0);
    rows[0].f = F_BROKEN; rows[0].jk = -1;
    for (const [dy, k, jk] of [[0.04, 0.78, -0.85], [0.35, 0.56, -0.6], [0.9, 0.44, -0.3]]) rows.unshift({ y: y0 + dy * rB, f: F_HOLLOW, w: 0, cx: c[0], cz: c[1], R: rB * k, jk });
  }
  if (open && !broken && o.collar) { // hot collar: the wall just under an active orifice glows (own vertex run)
    rows.gH = Math.min(1.3, Math.max(0.5, H * 0.1));
    for (const r of rows) if (r.f === F_WALL && r.y > yTop - rows.gH) r.hot = true;
  }
  if (open && !broken) { // lip rolls in, throat drops into the chimney
    const rT = RofY(yTop), c = C(yTop);
    for (const [dy, k, f] of [[0.05, 0.92, F_LIP], [0.035, 0.68, F_LIP], [-0.25, 0.5, F_THROAT], [-0.85, 0.42, F_THROAT], [-1.5, 0.36, F_THROAT]]) {
      rows.push({ y: yTop + dy * rT, f, w: 0, cx: c[0], cz: c[1], R: rT * k, hot: true });
    }
  } else if (broken) { // crumbled rim around the old conduit, lined with brassy chalcopyrite
    const rT = RofY(yTop), c = C(yTop);
    for (const [dy, k, jk] of [[-0.04, 0.78, 0.85], [-0.35, 0.56, 0.6], [-0.9, 0.44, 0.3]]) rows.push({ y: yTop + dy * rT, f: F_HOLLOW, w: 0, cx: c[0], cz: c[1], R: rT * k, jk });
  }
  return rows;
}
// Wrapped grid over rows split into runs of glowing / textured strips (see HOT). fn(u, row, j, hot, out).
// Returns the vertex base of every run and the runs ([firstRow, lastRow, hot]).
function* runsG(b, nu, rows, fn) {
  const sh = (j) => !!(rows[j].hot || rows[j + 1].hot), runs = [], bases = [];
  for (let j = 0, ja = 0; j < rows.length - 1; j++) {
    if (j === rows.length - 2 || sh(j + 1) !== sh(j)) { runs.push([ja, j + 1, sh(j)]); ja = j + 1; }
  }
  for (const [a, c, hot] of runs) bases.push(yield* gridG(b, nu, c - a, (u, v, i, j, out) => fn(u, rows[a + j], a + j, hot, out)));
  const N = b.N;
  for (let r = 1; r < runs.length; r++) { // seam rows: one shared normal
    const A = bases[r - 1] + (runs[r - 1][1] - runs[r - 1][0]) * nu, B = bases[r];
    for (let i = 0; i < nu; i++) {
      const p = (A + i) * 3, q = (B + i) * 3;
      let x = N[p] + N[q], y = N[p + 1] + N[q + 1], z = N[p + 2] + N[q + 2];
      const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      N[p] = N[q] = x; N[p + 1] = N[q + 1] = y; N[p + 2] = N[q + 2] = z;
    }
  }
  return { runs, bases };
}
// build one spire; returns { orifice: [x,y,z,r] | null }
function* spireG(b, site, o) {
  const rng = mulberry32(o.seed), rows = spireRows(rng, o), nu = o.nu, P = o.pal || site.pal;
  // ledges: one or two rounded shelves (shelf-fungus outlines, never pointed petals), each tilted its own way
  const fl = (o.flanges || []).map((f) => {
    const sh = [], n = rng() < 0.45 ? 2 : 1, a0 = rng() * TAU;
    for (let q = 0; q < n; q++) sh.push([a0 + q * (2.2 + rng() * 1.6), 0.6 + rng() * 0.8, q ? 0.55 + rng() * 0.35 : 1]); // centre, half-width (rad), reach
    return { ...f, sh, ph: rng() * 10, droop: 0.1 + rng() * 0.25, tilt: Math.min(0.35, f.W * (0.1 + rng() * 0.25)), tdir: rng() * TAU }; // tilt <= 0.35: the 0.65 m fade keeps rows monotonic
  });
  const shelf = (f, a) => {
    let c = 0;
    for (let q = 0; q < f.sh.length; q++) { const e = f.sh[q], da = Math.atan2(Math.sin(a - e[0]), Math.cos(a - e[0])) / e[1]; if (da * da < 1) c = Math.max(c, e[2] * Math.sqrt(1 - da * da)); }
    return c;
  };
  const nA = o.noise ?? 0.24, fF = 1.9 + rng() * 1.3, flute = (o.flute ?? 0.04) * rng(), nFl = 5 + Math.floor(rng() * 6), knob = o.knob ?? 0.32;
  const sd = o.seed, y0 = o.y0 || 0, yTop = y0 + o.H, v0 = b.vc, i0 = b.I.length;
  // low-order cross-section shape (oval, three-lobed) that twists up the chimney, and lumps sized to what the
  // ring resolution can show; shared by the wall and the conduit inside it so the two never cross
  const e2 = 0.05 + rng() * 0.13, e3 = 0.03 + rng() * 0.08, p2 = rng() * TAU, p3 = rng() * TAU, lumpA = o.lump ?? 0.36 + rng() * 0.2;
  const lf = Math.min(1.6, 0.42 / (o.seg || 0.3)), lk = Math.max(0.5, Math.min(1.6, o.r0 * lf * 1.6));
  const shapeK = (ca, sa, a, y) => (1 + e2 * Math.cos(2 * (a - p2 - 0.7 * vn3(0.1, y * 0.22, 0.4, sd + 40))) + e3 * Math.cos(3 * (a - p3 - 0.9 * vn3(0.6, y * 0.27, 0.2, sd + 41))))
    * (1 + lumpA * vn3(ca * lk, y * lf * 0.7, sa * lk, sd + 42));
  // crumbled broken rims: crown of uneven teeth plus one deeper bite out of the side (never below the next
  // wall row, so the rim cannot fold over it; the conduit rows inside follow the bite fully, the teeth partly)
  const rim = rows.find((q) => q.jk === 1 || q.jk === -1), rR = rim ? rim.R : o.r0; // teeth and bite scale with the rim itself
  const aN = rng() * TAU, bite = Math.min((0.3 + rng() * 0.7) * rR, 0.85 * rows.gap);
  const teeth = (a) => 0.4 * rR * Math.abs(vn3(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 3.3, sd + 7) + 0.6 * vn3(Math.cos(a) * 5, Math.sin(a) * 5, 1.1, sd + 8));
  const biteAt = (a) => bite * Math.pow(Math.max(0, Math.cos(a - aN)), 3);
  // crumbly crust at the scale of the vertex spacing (what a low ring count can still show)
  const seg = o.seg || 0.3, rf = 0.9 / seg, rA = (o.crumb ?? 1) * 0.3 * seg;
  const { runs, bases } = yield* runsG(b, nu, rows, (u, r, j, hot, out) => {
    const a = u * TAU, ca = Math.cos(a), sa = Math.sin(a);
    let R = r.R, y = r.y;
    if (r.w > 0) { // partial, lobed ledges with ragged, slightly drooping edges
      const f = fl[r.k], cov = shelf(f, a);
      const ext = f.W * r.w * cov * (0.82 + 0.18 * vn3(ca * 3 + f.ph, sa * 3, 1.7, sd + 4) + 0.08 * vn3(ca * 7 + f.ph, sa * 7, 0.4, sd + 9)); // ragged rim
      R += ext;
      if (r.f === F_RIM || r.f === F_TOP) y -= f.droop * f.th * (ext / Math.max(0.01, f.W));
    }
    R *= shapeK(ca, sa, a, r.y);
    for (let q = 0; q < fl.length; q++) { // tilt each ledge, fading out over >= 0.6 m of wall so rows never cross
      const f = fl[q], dy = r.y - f.y;
      if (dy > -f.th * 1.6 - 0.65 && dy < f.th * 0.65 + 0.65) y += f.tilt * Math.cos(a - f.tdir) * sstep(-f.th * 1.6 - 0.65, -f.th * 1.6, dy) * (1 - sstep(f.th * 0.65, f.th * 0.65 + 0.65, dy));
    }
    const px = r.cx + ca * R, pz = r.cz + sa * R;
    const inner = r.f === F_THROAT || r.f === F_LIP || r.f === F_HOLLOW;
    let d = nA * (inner ? 0.25 : 1) * fbm3(px * fF, r.y * fF * 0.55, pz * fF, 3, sd) + flute * Math.sin(a * nFl + vn3(0, r.y * 0.15, 0, sd + 2) * 1.2) * (0.5 + 0.5 * vn3(ca, r.y * 0.3, sa, sd + 13))
      + (inner ? 0 : knob * Math.max(0, vn3(px * 4.5, r.y * 3.2, pz * 4.5, sd + 4) - 0.25)) + 0.05 * vn3(px * 9, r.y * 9, pz * 9, sd + 12);
    if (r.f === F_UNDER || r.f === F_RIM || r.f === F_TOP) d *= 0.6;
    R *= 1 + d;
    R += Math.min(rA, 0.2 * r.R) * (inner ? 0.3 : 1) * sqrtN(vn3(px * rf, r.y * rf, pz * rf, sd + 50));
    if (r.jk) y += Math.sign(r.jk) * (Math.abs(r.jk) * teeth(a) - biteAt(a));
    out[0] = r.cx + ca * R; out[1] = y; out[2] = r.cz + sa * R;
    out[6] = r.f + (hot ? HOT : 0); out[7] = sat((r.y - y0) / o.H);
  });
  // caps: throat floor (glowing) or the bottom of a broken conduit
  const rowBase = (j) => (j === 0 ? bases[0] : bases[bases.length - 1] + (j - runs[runs.length - 1][0]) * nu);
  const capRing = (j, up, f) => {
    const base = rowBase(j);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < nu; i++) { cx += b.P[(base + i) * 3]; cy += b.P[(base + i) * 3 + 1]; cz += b.P[(base + i) * 3 + 2]; }
    cx /= nu; cy /= nu; cz /= nu;
    const c = b.v(cx, cy + (up ? -0.06 : 0.06) * o.r0, cz, 0, up ? 1 : -1, 0, 1, 1, 1, f, 1);
    for (let i = 0; i < nu; i++) { const a0 = base + i, a1 = base + (i + 1) % nu; if (up) b.t(c, a1, a0); else b.t(c, a0, a1); }
  };
  const last = rows.length - 1;
  if (rows[last].f === F_THROAT) capRing(last, true, F_THROAT + HOT);
  else if (rows[last].f === F_HOLLOW || rows[last].f === F_BROKEN) capRing(last, true, F_HOLLOW);
  if (o.brokenBase) capRing(0, false, F_HOLLOW);
  yield* jitterG(b, v0, 0.5, sd + 60, rf);
  // paint: layered sulphides, oxidised base, drips, anhydrite crusts, brassy conduit lining, glow
  const bandF = site.bandF, gK = P.glow * (o.glowK ?? 1), key = o.key ?? chimneyKey(rng), rustB = o.rustB ?? 0;
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, out) => {
    const hot = out[3] >= HOT - 0.5, f = Math.round(out[3]) - (hot ? HOT : 0), t = out[4];
    const n1 = vn3(x * 1.2, y * 0.35, z * 1.2, sd + 21), n2 = vn3(x * 4, y * 0.22, z * 4, sd + 25), n3 = vn3(x * 7, y * 7, z * 7, sd + 29);
    const n4 = vn3(x * 0.7, y * 0.5, z * 0.7, sd + 23); // big patches: whole flanks rusted, sooty or crusted
    const age = 1 - t;
    const c = mixIn(set3(C3, P.black), P.grey, 0.18 + 0.22 * Math.sin(y * bandF + n1 * 2.5) + 0.2 * sstep(0.1, 0.6, n4));
    mixIn(c, P.rust, sat(sstep(0.15, 0.6, n1 * 0.8 + age * 0.75 - 0.45 + rustB) * P.rustK * (0.25 + 0.95 * sstep(-0.45, 0.35, n4))));
    mixIn(c, P.ochre, sstep(0.48, 0.75, n2) * (0.25 + 0.6 * age) * P.ochreK);
    mixIn(c, P.white, sstep(0.55, 0.85, n3 * 0.4 + n1 * 0.35 - n4 * 0.25 + (f === F_TOP ? 0.2 : 0) + (f === F_UNDER ? -0.6 : 0) + t * 0.3 - 0.1) * P.whiteK);
    if (!hot && f !== F_HOLLOW) mixIn(c, SED, sstep(0.45, 0.95, ny + 0.3 * n1) * (0.25 + 0.3 * age));
    let glow = 0;
    if (f === F_THROAT) { mixIn(c, P.lining, 0.65); glow = 1.1 + 0.9 * sat((yTop - y) / (o.r0 * 1.5)); }
    else if (f === F_LIP) { mixIn(c, P.lining, 0.35); glow = 0.45; }
    else if (f === F_WALL && hot && rows.gH) { // collar: brassy, patchy glow rising to the lip (what shows from below and afar)
      const q = sat((y0 + t * o.H - (yTop - rows.gH)) / rows.gH), cr = sstep(-0.1, 0.45, vn3(x * 3.4, y * 2.3, z * 3.4, sd + 36));
      mixIn(c, P.black, 0.55 * sstep(0, 0.35, q)); // fresh sulphide at the active top (and glow mode has no rock-texture darkening)
      mixIn(c, P.lining, 0.12 * q * cr);
      glow = o.collar * q * q * Math.max(cr, sstep(0.75, 1, q)); // glowing cracks in dark crust, a solid ring at the rim
    }
    else if (f === F_HOLLOW) mixIn(c, P.lining, 0.3 + 0.3 * sstep(-0.2, 0.5, n2));
    else if (f === F_UNDER && hot) glow = (o.poolGlow ?? 0.3) * sstep(0.0, 0.5, vn3(x * 2.5, y * 2.5, z * 2.5, sd + 35)); // patchy hot pools
    const ao = (0.55 + 0.45 * sstep(0, 0.3, t)) * (0.8 + 0.2 * Math.max(0, ny)) * (f === F_UNDER ? 0.6 : f === F_HOLLOW ? 0.45 : 1) * (0.66 + 0.62 * sat(0.5 + n3));
    out[0] = c[0] * ao; out[1] = c[1] * ao; out[2] = c[2] * ao;
    if (hot) { out[3] = glow * gK; out[4] = 3; } else { out[3] = 0; out[4] = key; }
  });
  yield* cavityG(b, v0, i0, 2.5);
  const wall = rows.filter((q) => q.f === F_WALL); // axis and radius along the height (side sprouts attach here)
  if (rows[last].f === F_THROAT) {
    const r = rows.find((q) => q.f === F_LIP);
    return { orifice: [r.cx, yTop + 0.02, r.cz, r.R], wall };
  }
  return { orifice: null, wall };
}
// broad sulphide mound the edifice stands on (flat bottom on y = 0)
function* moundG(b, site, { R, Rz, Hm, seed, detail, pal = null, rng = mulberry32(seed), crumb = 0.12, Q = null }) {
  const P = pal || site.pal, ox = (seed % 97) * 0.37, fl = -0.25, key = moundKey(rng), i0 = b.I.length;
  // a few buried chimney stubs and slumped lobes break up the dome
  const lobes = [];
  for (let k = 0, n = 4 + Math.floor(rng() * 5); k < n; k++) { const a = rng() * TAU, e = 0.1 + rng() * 0.7; lobes.push([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e), 0.88 - rng() * 0.14, 0.15 + rng() * 0.3]); }
  const v0 = yield* blobG(b, detail, (x, y, z, o) => {
    // noise in metres (not on the unit sphere): lumps, knobs and crusts at chimney scale
    const mx = x * R, my = y * Hm, mz = z * Rz;
    let d = 1 + 0.5 * fbm3(x * 1.3 + ox, y * 1.3, z * 1.3, 2, seed) + (0.4 * fbm3(mx * 0.8 + ox, my * 0.8, mz * 0.8, 3, seed + 1)
      + 0.3 * Math.max(0, vn3(mx * 1.8, my * 1.8, mz * 1.8, seed + 2) - 0.1)) / Math.max(1, R * 0.5);
    for (const l of lobes) { const q = x * l[0] + y * l[1] + z * l[2]; if (q > l[3]) d += l[4] * sstep(l[3], 1, q); }
    d += crumb * sqrtN(vn3(mx * 2.6, my * 2.6, mz * 2.6, seed + 11)) / R; // rubbly crust at vertex scale
    let py = y * d;
    if (py < fl) py = fl + (py - fl) * 0.08;
    o[0] = x * d * R; o[1] = Math.max(0, (py - fl) * Hm / (1 - fl)); o[2] = z * d * Rz;
  });
  yield* jitterG(b, v0, 0.55, seed + 13, 2.4);
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
    const n1 = vn3(x * 0.9, y * 0.9, z * 0.9, seed + 3), n2 = vn3(x * 3, y * 3, z * 3, seed + 5), n4 = vn3(x * 0.45, y * 0.6, z * 0.45, seed + 7);
    const c = mixIn(set3(C3, P.grey), P.black, sstep(-0.2, 0.4, n1));
    mixIn(c, P.rust, sat(sstep(-0.1, 0.5, n2 + 0.15 + 0.35 * n4) * P.rustK * 0.8));
    mixIn(c, P.ochre, sstep(0.35, 0.7, n1 + n2 * 0.4) * P.ochreK * 0.7);
    mixIn(c, P.white, sstep(0.55, 0.85, n2 - n4 * 0.3 + ny * 0.25) * P.whiteK * 0.6);
    mixIn(c, P.black, sstep(0.25, 0.6, -n4 - 0.3 * n2) * 0.6);                                  // sooty / manganese-black patches
    mixIn(c, SED, sstep(0.35, 0.9, ny + 0.35 * n1) * (0.35 + 0.35 * sstep(-0.3, 0.4, n4)));     // settled sediment on top
    const ao = (0.5 + 0.5 * sstep(0, Hm * 0.6, y)) * (0.8 + 0.2 * Math.max(0, ny)) * (0.8 + 0.35 * sat(0.5 + vn3(x * 5, y * 5, z * 5, seed + 9)));
    o[0] = c[0] * ao; o[1] = c[1] * ao; o[2] = c[2] * ao; o[3] = 0; o[4] = key;
  });
  yield* cavityG(b, v0, i0, 3);
  if (Q) yield* heapG(b, site, P, rng, v0, R, Rz, Q, key);
}
// Rubble heaped on a mound: angular sulphide blocks and broken, hollow chimney fragments. Each piece is
// seated on the mound's real surface (the highest mound vertex nearby, lowest of five samples over its
// footprint), embedded a little, and flattened at y = 0 wherever it reaches the floor.
function* heapG(b, site, P, rng, v0, R, Rz, Q, key) {
  const v1 = b.vc, Pm = b.P;
  const surf = (x, z) => { let h = 0; for (let i = v0; i < v1; i++) { const dx = Pm[i * 3] - x, dz = Pm[i * 3 + 2] - z; if (dx * dx + dz * dz < 0.16) h = Math.max(h, Pm[i * 3 + 1]); } return h; };
  const foot = (x, z, r) => Math.min(surf(x, z), surf(x + r, z), surf(x - r, z), surf(x, z + r), surf(x, z - r));
  for (let k = 0, n = 3 + Math.floor(R * 1.5 + rng() * 3); k < n; k++) {
    const a = rng() * TAU, d = Math.sqrt(0.05 + rng() * 0.9) * 0.85, x = Math.cos(a) * d * R, z = Math.sin(a) * d * Rz;
    const s = (0.16 + rng() * 0.3) * Math.min(1.3, 0.4 + R * 0.3), sx = s * (0.8 + rng() * 0.5), sy = s * (0.5 + rng() * 0.4), sz = s * (0.8 + rng() * 0.5);
    const yc = foot(x, z, s * 0.7) - 0.25 * sy, yaw = rng() * TAU, cy = Math.cos(yaw), sY = Math.sin(yaw), bs = (rng() * 1e6) | 0;
    const planes = [];
    for (let q = 0; q < 5; q++) { const pa = rng() * TAU, pe = (rng() - 0.3) * 1.4; planes.push([Math.cos(pa) * Math.cos(pe), Math.sin(pe), Math.sin(pa) * Math.cos(pe), 0.5 + rng() * 0.3]); }
    const c0 = mix3(P.black, rng() < 0.55 ? P.rust : P.grey, 0.2 + rng() * 0.7);
    const bv = yield* blobG(b, s < 0.3 ? 1 : Q.block, (ux, uy, uz, o) => {
      const dd = 1 + 0.14 * vn3(ux * 2 + bs, uy * 2, uz * 2, bs);
      let px = ux * dd, py = uy * dd, pz = uz * dd;
      for (let q = 0; q < planes.length; q++) { const pl = planes[q], e = px * pl[0] + py * pl[1] + pz * pl[2]; if (e > pl[3]) { px -= (e - pl[3]) * pl[0]; py -= (e - pl[3]) * pl[1]; pz -= (e - pl[3]) * pl[2]; } }
      px *= sx; py *= sy; pz *= sz;
      o[0] = x + cy * px - sY * pz; o[1] = Math.max(0, yc + py); o[2] = z + sY * px + cy * pz;
    });
    yield* paintG(b, bv, (i, px, py, pz, nx, ny, nz, o) => {
      const n = vn3(px * 4, py * 4, pz * 4, bs + 1), c = mixIn(set3(C3, c0), P.ochre, sstep(0.25, 0.6, n) * P.ochreK * 0.6);
      mixIn(c, SED, sstep(0.5, 0.95, ny) * 0.18);
      const ao = (0.45 + 0.55 * sat((py - yc + sy) / (1.6 * sy))) * (0.8 + 0.3 * sat(0.5 + vn3(px * 9, py * 9, pz * 9, bs + 2)));
      o[0] = c[0] * ao; o[1] = c[1] * ao; o[2] = c[2] * ao; o[3] = 0; o[4] = key;
    });
  }
  for (let k = 0, n = 1 + Math.floor(rng() * 2.6); k < n; k++) { // broken chimney fragments lying on the heap
    const rr = 0.07 + rng() * 0.12, L = 0.35 + rng() * 0.9, a = rng() * TAU, d = (0.3 + rng() * 0.75), x0 = Math.cos(a) * d * R, z0 = Math.sin(a) * d * Rz, fv = b.vc;
    yield* spireG(b, site, { nu: 8, step: Math.max(0.12, rr * 0.9), seg: Q.seg, seed: (rng() * 1e9) | 0, H: L, r0: rr, topK: 0.85, open: false, broken: true, brokenBase: true, flanges: [], glowK: 0, lump: 0.15, crumb: 0.5, pal: P });
    b.xform(fv, [0, 1, 0, -1, 0, 0, 0, 0, 1], -L / 2, 0, 0);       // lie along x, centred
    b.xform(fv, rotY(rng() * TAU), x0, 0, z0);
    let minY = 1e9; for (let i = fv; i < b.vc; i++) minY = Math.min(minY, b.P[i * 3 + 1]);
    const dy = foot(x0, z0, L * 0.35) - rr * 0.35 - minY;
    for (let i = fv; i < b.vc; i++) b.P[i * 3 + 1] = Math.max(0, b.P[i * 3 + 1] + dy);
  }
}
// broken chimney chunks lying around (each with its own flat underside on y = 0)
function* rubbleG(b, site, rng, n, rIn, rOut, size, pal = null) {
  const P = pal || site.pal, key = moundKey(rng);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = rIn + rng() * (rOut - rIn), L = size * (0.5 + rng()), r = size * (0.18 + rng() * 0.14), yaw = rng() * TAU, sd = (rng() * 1e6) | 0;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const v0 = yield* blobG(b, 1, (x, y, z, o) => {
      const dd = 1 + 0.25 * vn3(x * 2 + sd, y * 2, z * 2, sd);
      const lx = x * L * dd, ly = y * r * dd, lz = z * r * 1.1 * dd;
      o[0] = cx + cy * lx - sy * lz; o[1] = Math.max(0, ly + r * 0.75); o[2] = cz + sy * lx + cy * lz;
    });
    const c0 = mix3(P.black, P.rust, rng() * P.rustK);
    yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
      const n = 0.75 + 0.5 * vn3(x * 6, y * 6, z * 6, sd + 2), c = mixIn(set3(C3, c0), P.ochre, sstep(0.4, 0.8, n - 0.4) * P.ochreK);
      o[0] = c[0] * n; o[1] = c[1] * n; o[2] = c[2] * n; o[3] = 0; o[4] = key;
    });
  }
}
// beehive diffuser: squat shingled dome venting from many small orifices, its oxidised crust riddled with pores
// (lathe rows j, columns i: vertex v0 + j * nu + i; gridG's fan around a vertex, in order)
const FAN = [[0, 1], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1]];
function* beehiveG(b, site, o) {
  const rng = mulberry32(o.seed), sd = o.seed, P = site.pal, nu = o.nu, H = o.H, Rb = o.R, sp = 0.22 + rng() * 0.18;
  const ny = Math.max(24, Math.round(H / (o.step * 0.25))), spots = [], lip = (0.14 + rng() * 0.1) * Rb;
  const seg = o.seg || 0.3, rf = 0.9 / seg, crumb = 0.25 * seg;
  for (let k = 0, n = 4 + Math.floor(rng() * 6); k < n; k++) spots.push([rng() * TAU, 0.3 + rng() * 0.62, 0.1 + rng() * 0.12]);
  // pores: lathe vertices sunk into the crust (row j -> depth), never next to each other or to a vent pit;
  // each gets a dark funnel over its own triangle fan below (so it can neither float nor sink into the dome)
  const pores = new Map(), nP = Math.round(TAU * Rb * H * 0.75 * 3.5);
  for (let tries = 0; pores.size < nP && tries < nP * 5; tries++) {
    const j = 2 + Math.floor(rng() * (ny * 0.88 - 2)), i = Math.floor(rng() * nu), t = j / ny, a = i / nu * TAU;
    let free = true;
    for (let dj = -2; dj <= 2 && free; dj++) for (let di = -2; di <= 2 && free; di++) if (pores.has((j + dj) * nu + (i + di + nu) % nu)) free = false;
    if (!free || spots.some((q) => Math.abs(Math.atan2(Math.sin(a - q[0]), Math.cos(a - q[0]))) < 0.35 && Math.abs(t - q[1]) < 0.09)) continue;
    pores.set(j * nu + i, 0.05 + rng() * 0.06);
  }
  const R = (t, a) => {
    const ca = Math.cos(a), sa = Math.sin(a), y = t * H;
    // stacked shingles: each band swells slowly, then its lip overhangs the band below (irregular per angle)
    const ph = 0.8 * vn3(ca * 1.3, sa * 1.3, 0.3, sd) + 0.3 * vn3(ca * 3, sa * 3, 1.3, sd + 1);
    const f = (((y / sp + ph) % 1) + 1) % 1, saw = f < 0.8 ? Math.pow(f / 0.8, 1.6) : 1 - (f - 0.8) / 0.2;
    const px = ca * Rb, pz = sa * Rb;
    // rounded dome (a beehive, not a cone), shingle lips, knobs and a crumbly vertex-scale crust
    let r = Rb * Math.pow(Math.max(0, 1 - Math.pow(t, 1.6)), 0.6) * (1 + 0.25 * fbm3(ca * 1.6, y * 0.9, sa * 1.6, 3, sd))
      + saw * lip * (1 - 0.6 * t) * (0.6 + 0.4 * vn3(ca * 2, y, sa * 2, sd + 2))
      + 0.09 * Rb * Math.max(0, vn3(px * 3.5, y * 3.5, pz * 3.5, sd + 3) - 0.2) + 0.06
      + crumb * (1 - t) * sqrtN(vn3(px * rf, y * rf, pz * rf, sd + 50));
    for (const s of spots) { const da = Math.atan2(Math.sin(a - s[0]), Math.cos(a - s[0])), dt = t - s[1]; r -= 0.06 * Math.exp(-(da * da * 9 + dt * dt * 300)); } // small vent pits
    return r;
  };
  const i0 = b.I.length, v0 = yield* gridG(b, nu, ny, (u, v, i, j, out) => {
    const t = Math.min(0.985, v), a = u * TAU, r = R(t, a) - (pores.get(j * nu + i) || 0);
    out[0] = Math.cos(a) * r; out[1] = t * H; out[2] = Math.sin(a) * r; out[6] = 0; out[7] = t;
  });
  { // cap the top
    const base = v0 + ny * nu, c = b.v(0, H * 0.995, 0, 0, 1, 0, 1, 1, 1, 0, 3);
    for (let i = 0; i < nu; i++) b.t(c, base + (i + 1) % nu, base + i);
  }
  yield* jitterG(b, v0, 0.45, sd + 60, rf);
  const vents = [], gK = P.glow, key = chimneyKey(rng);
  for (const s of spots) {
    const r = R(s[1], s[0]);
    vents.push({ x: Math.cos(s[0]) * r, y: s[1] * H, z: Math.sin(s[0]) * r, r: s[2], seep: true });
  }
  yield* paintG(b, v0, (i, x, y, z, nx, nyy, nz, out) => {
    const t = y / H, a = Math.atan2(z, x);
    const n1 = vn3(x * 1.4, y * 0.8, z * 1.4, sd + 3), n2 = vn3(x * 3, y * 3, z * 3, sd + 5), n3 = vn3(x * 6, y * 6, z * 6, sd + 9);
    // ochre and rust-brown iron-oxide crust; fresh dark sulphide shows under the shingle lips and in the pores
    const c = mixIn(set3(C3, P.ochre), P.rust, sstep(-0.6, 0.4, n1 + (1 - t) * 0.25) * 0.85);
    mixIn(c, P.grey, 0.22 + 0.3 * sstep(0.3, 0.75, n2));
    mixIn(c, P.black, sstep(0.1, -0.55, nyy) * 0.7);
    mixIn(c, P.white, sstep(0.55, 0.9, n3 * 0.4 + n1 * 0.3 + Math.max(0, nyy) * 0.5) * P.whiteK * 0.5);
    mixIn(c, SED, sstep(0.55, 0.95, nyy + 0.3 * n2) * 0.25);
    if (pores.has(i - v0)) mixIn(c, PORE, 0.85);
    for (const s of spots) { // brassy staining around the vent pits
      const da = Math.atan2(Math.sin(a - s[0]), Math.cos(a - s[0])), dt = t - s[1];
      if (da * da * 14 + dt * dt * 500 < 1.2) mixIn(c, P.lining, 0.45);
    }
    const ao = (0.55 + 0.45 * sstep(0, 0.4, t)) * (0.75 + 0.25 * Math.max(0, nyy)) * (0.85 + 0.3 * n3);
    out[0] = c[0] * ao; out[1] = c[1] * ao; out[2] = c[2] * ao; out[3] = 0; out[4] = key;
  });
  yield* cavityG(b, v0, i0, 2.5);
  // glowing vent pits: small cupped discs in the dents (own vertices, glow mode)
  if (gK > 0.05) for (const s of spots) {
    const a = s[0], t = s[1], r = R(t, a), dr = (R(t + 0.02, a) - R(t - 0.02, a)) / (0.04 * H);
    const ca = Math.cos(a), sa = Math.sin(a), nl = Math.hypot(1, dr);
    const nx = ca / nl, ny2 = -dr / nl, nz = sa / nl;               // outward surface normal (radial, tilted by the slope)
    const tx = -sa, tz = ca, bx = -ca * ny2, by = 1 / nl, bz = -sa * ny2; // tangent (around), bitangent (up the slope)
    const cx = ca * r + nx * 0.005, cy = t * H + ny2 * 0.005, cz = sa * r + nz * 0.005, rr = s[2] * 0.75;
    const c = b.v(cx - nx * 0.03, cy - ny2 * 0.03, cz - nz * 0.03, nx, ny2, nz, P.lining[0] * 0.6, P.lining[1] * 0.6, P.lining[2] * 0.6, 1.5 * gK, 3);
    for (let k = 0; k < 7; k++) {
      const q = k / 7 * TAU, u = Math.cos(q) * rr, w = Math.sin(q) * rr;
      b.v(cx + tx * u + bx * w, cy + by * w, cz + tz * u + bz * w, nx, ny2, nz, P.black[0] + 0.04, P.black[1] + 0.035, P.black[2] + 0.03, 0.35 * gK, 3);
    }
    for (let k = 0; k < 7; k++) b.t(c, c + 1 + (k + 1) % 7, c + 1 + k);
  }
  // pore patches: rim points 70% of the way along the fan edges lie on the dome's own triangles, so each patch rides
  // just above the sunken fan (the dent gives the depth); a quarter glow faintly where warm fluid seeps through
  const Pb = b.P, Nb = b.N;
  for (const [k] of pores) {
    const j = Math.floor(k / nu), i = k % nu, V = v0 + k, nx = Nb[V * 3], ny2 = Nb[V * 3 + 1], nz = Nb[V * 3 + 2];
    const vx = Pb[V * 3], vy = Pb[V * 3 + 1], vz = Pb[V * 3 + 2], hot = gK > 0.3 && rng() < 0.25;
    const c = b.v(vx + nx * 0.004, vy + ny2 * 0.004, vz + nz * 0.004, nx, ny2, nz, PORE[0] * 0.5, PORE[1] * 0.5, PORE[2] * 0.5, hot ? 0.5 * gK : 0, 3);
    for (const [dj, di] of FAN) {
      const W = v0 + (j + dj) * nu + (i + di + nu) % nu;
      b.v(vx + (Pb[W * 3] - vx) * 0.7 + nx * 0.006, vy + (Pb[W * 3 + 1] - vy) * 0.7 + ny2 * 0.006, vz + (Pb[W * 3 + 2] - vz) * 0.7 + nz * 0.006,
        nx, ny2, nz, PORE[0] * 1.6, PORE[1] * 1.5, PORE[2] * 1.4, 0, 3);
    }
    for (let q = 0; q < 6; q++) b.t(c, c + 1 + (q + 1) % 6, c + 1 + q); // same winding as the dome
  }
  return vents;
}

// ---------- edifices: one template per call (generator) ----------
const NAMES = {
  spire: ['Black smoker', 'Black smokers gush mineral-laden water at over 350 °C, kept liquid by the crushing pressure of the deep.'],
  cluster: ['Chimney cluster', 'Each chimney grows as dissolved metals hit cold seawater and drop out as sulphide minerals, up to 30 cm a day.'],
  flange: ['Flange chimney', 'Hot fluid pools beneath the flanges, shimmering like an upside-down mirror.'],
  candelabra: ['Candelabra chimney', 'Chimneys branch where a crack opens a new path for the hot fluid.'],
  beehive: ['Beehive diffuser', 'Fluid seeps through the porous walls of a beehive chimney, cooling and depositing minerals as it goes.'],
  toppled: ['Toppled chimney', 'Chimneys grow top-heavy and topple; new ones soon start growing from the stump.'],
  stump: ['Extinct chimney', 'When the hot fluid stops flowing, the chimney rusts away: its iron sulphides oxidise to orange.'],
  carbonate: ['Carbonate tower', 'Carbonate towers grow where seawater reacts with mantle rock: warm, alkaline fluid instead of black smoke.'],
  white: ['White smoker', 'White smokers vent cooler fluid, clouded with barium, calcium and silica instead of black sulphides.'],
};
// site-specific names (dead fields, white smokers, carbonate towers)
const SITE_NAMES = {
  white: { spire: NAMES.white, cluster: ['White smoker cluster', 'White smokers vent cooler fluid, so their chimneys grow slowly from pale barite and anhydrite.'] },
  relict: {
    spire: ['Oxidised chimney', 'Without hot fluid to feed it, a chimney\'s iron sulphides rust to orange and it slowly crumbles.'],
    cluster: ['Dead chimney cluster', 'Vent fields wander as cracks clog: these chimneys died when their fluid found another way up.'],
    flange: ['Extinct flange chimney', 'The ledges once trapped pools of hot fluid; now they only catch falling sediment.'],
    candelabra: ['Extinct candelabra', 'Branching chimneys keep their shape for years after the hot water stops.'],
  },
  carbonate: {
    spire: ['Carbonate spire', 'Warm, alkaline fluid seeping from the rock builds slender white spires of calcium carbonate.'],
    cluster: ['Carbonate spires', 'Thin white spires grow where warm, alkaline fluid seeps from the rock and meets seawater.'],
    stump: ['Dead carbonate tower', 'When the warm flow stops, a carbonate tower stops growing and slowly weathers away.'],
    toppled: ['Fallen carbonate spire', 'Carbonate spires are brittle: earthquakes and their own weight bring them down.'],
  },
};
function formOf(site, rng) {
  let tot = 0; for (const w of Object.values(site.forms)) tot += w;
  let r = rng() * tot;
  for (const [k, w] of Object.entries(site.forms)) { r -= w; if (r <= 0) return k; }
  return 'spire';
}
// seg: target vertex spacing around a ring (m); nu is chosen per spire from its radius (+ flange width)
// mound: icosphere detail (three r186: 10 (d+1)^2 + 2 vertices, so 6 -> 492, 9 -> 1002)
// block: icosphere detail of the rubble blocks heaped on the mound
const RES = { low: { nu: 14, seg: 0.42, step: 0.42, mound: 5, block: 1, cap: 26 }, medium: { nu: 16, seg: 0.34, step: 0.36, mound: 6, block: 1, cap: 30 }, high: { nu: 20, seg: 0.26, step: 0.3, mound: 7, block: 2, cap: 32 }, ultra: { nu: 24, seg: 0.21, step: 0.26, mound: 10, block: 2, cap: 40 } };
const ringN = (Q, r0, flanges) => {
  let w = 0; for (const f of flanges || []) w = Math.max(w, f.W);
  return Math.max(r0 < 0.3 ? 10 : Q.nu - 2, Math.min(Q.cap, Math.round(TAU * (r0 + 0.5 * w) / Q.seg)));
};
// row spacing: finer on narrow spires (cheap there, and what keeps a stump from reading as a pipe)
const rowStep = (Q, r0) => Math.min(Q.step, Math.max(Q.step * 0.62, r0 * 0.7));
// every chimney its own variant of the site's minerals: hue, how rusted, how crusted
function varyPal(P, rng) {
  const hk = [1 + (rng() - 0.5) * 0.12, 1 + (rng() - 0.5) * 0.1, 1 + (rng() - 0.5) * 0.12], out = {};
  for (const k of ['black', 'grey', 'rust', 'ochre', 'white', 'lining']) out[k] = mulK(P[k], hk);
  for (const k of ['rustK', 'ochreK', 'whiteK']) out[k] = P[k] * (0.7 + rng() * 0.6);
  out.glow = P.glow;
  return out;
}
export function* edificeG(site0, seed, tier, form = null) {
  const rng = mulberry32(seed), Q = RES[tier] || RES.high, b = new Builder(), vents = [];
  const site = { ...site0, pal: varyPal(site0.pal, rng) };
  form = form || formOf(site, rng);
  const dead = site.key === 'relict', hk = site.hK, Hr = site.H, H0 = (Hr[0] + (Hr[1] - Hr[0]) * Math.pow(rng(), 0.8)) * hk;
  const nS = () => (rng() * 1e9) | 0;
  const deadO = dead ? { open: false, broken: true, glowK: 0.15, rustB: 0.25 } : {};
  // build a spire; shift(sp, dx, dz) then moves just that spire (and its vent) sideways
  const spire = function* (o) {
    const act = o.open !== false && !o.broken && rng() < site.active; // an active orifice smokes and gets a glowing collar
    const v1 = b.vc, r = yield* spireG(b, site, { nu: ringN(Q, o.r0, o.flanges), step: rowStep(Q, o.r0), seg: Q.seg, seed: nS(), collar: act ? 0.6 : 0, ...o });
    let vent = null;
    if (r.orifice && act) vents.push((vent = { x: r.orifice[0], y: r.orifice[1], z: r.orifice[2], r: r.orifice[3] }));
    if (o.sprouts) yield* sprouts(r.wall, o.sprouts);
    return { v1, vent };
  };
  // small side chimneys growing out of a wall, tilted outward: they break up a plain shaft. Each one's axis
  // starts on the parent's axis line, so its open base is always buried inside the parent.
  const sprouts = function* (wall, n) {
    for (let k = 0; k < n; k++) {
      const r = wall[Math.floor(wall.length * (0.25 + 0.65 * rng()))];
      // stubby knobs angled upward (tilt 0.35-0.85 rad from vertical), two to five times as long as thick
      const a = rng() * TAU, t = 0.35 + rng() * 0.5, ca = Math.cos(a), sa = Math.sin(a), st = Math.sin(t), ct = Math.cos(t);
      if (!r || r.y < 0.62 * r.R * ct / st + 0.5) continue; // the buried base stays well above the ground
      const rr = Math.min(r.R * 0.32, 0.11 + rng() * 0.12), dIn = 0.62 * r.R, u = dIn / st, len = rr * (2 + rng() * 3);
      const v1 = b.vc;
      yield* spireG(b, site, { nu: 8, step: Math.max(0.12, Q.step * 0.6), seg: Q.seg, seed: nS(), y0: -u, H: u + len, r0: rr, topK: 0.45, taper: 1.2, flanges: [], lump: 0.2, nodes: 0.15, noise: 0.18, knob: 0.2,
        open: !dead && rng() < 0.35, broken: dead || rng() < 0.6, glowK: dead ? 0.15 : 0.6, rustB: dead ? 0.1 : 0 });
      // local y along the tilted axis d, x along e1 (in the vertical plane), z along e2 (horizontal)
      b.xform(v1, [ct * ca, st * ca, -sa, -st, ct, 0, ct * sa, st * sa, ca], r.cx + ca * dIn, r.y, r.cz + sa * dIn);
    }
  };
  const shift = (sp, dx, dz) => {
    for (let i = sp.v1; i < b.vc; i++) { b.P[i * 3] += dx; b.P[i * 3 + 2] += dz; }
    if (sp.vent) { sp.vent.x += dx; sp.vent.z += dz; }
  };
  // irregular heights, widths and thicknesses; ledges never crowd each other or the top
  const flangeSet = (H, n, W, th, pool = 0) => {
    const out = [];
    for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      const t2 = th * (0.8 + rng() * 0.5), W2 = W * (0.6 + rng() * 0.8), T2 = Math.max(t2, W2 * 0.12);
      const y = H * 0.22 + rng() * Math.max(0, Math.min(H * 0.7, H * 0.78 - T2 - 0.3));
      if (out.some((f) => Math.abs(f.y - y) < 0.4 + (T2 + f.th) * 1.3)) continue;
      out.push({ y, W: W2, th: T2, pool: rng() < pool }); k++;
    }
    return out.sort((a, b) => a.y - b.y);
  };
  let Rm = 1.6, label = form;
  if (form === 'spire' || form === 'cluster') {
    const r0 = Math.max(H0 * 0.05, (0.32 + rng() * 0.32) * (form === 'cluster' ? 0.85 : 1)); // never a thin pole
    yield* spire({ H: H0, r0, topK: 0.45 + rng() * 0.25, lean: [(rng() - 0.5) * 0.06, (rng() - 0.5) * 0.06], flanges: rng() < 0.35 ? flangeSet(H0, 1 + Math.floor(rng() * 2), r0 * 0.7, 0.16, 0.5) : [],
      sprouts: Math.floor(rng() * (form === 'cluster' ? 2 : 1.5 + H0 / 4)), ...deadO });
    const n = form === 'cluster' ? 3 + Math.floor(rng() * 4) : Math.floor(rng() * 3.5);
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU, d = r0 + 0.35 + rng() * (form === 'cluster' ? 1.6 : 0.9), h = H0 * (form === 'cluster' ? 0.45 + rng() * 0.5 : 0.25 + rng() * 0.45);
      const sp = yield* spire({ H: h, r0: Math.max(h * 0.055, 0.2 + rng() * 0.22), lean: [Math.cos(a) * 0.05, Math.sin(a) * 0.05], flanges: [], open: rng() < 0.85, broken: rng() < (dead ? 0.8 : 0.15), glowK: dead ? 0.15 : 1, rustB: dead ? 0.25 : 0 });
      shift(sp, Math.cos(a) * d, Math.sin(a) * d);
    }
    Rm = form === 'cluster' ? 2.2 + rng() * 0.8 : 1.3 + r0 * 1.5;
  } else if (form === 'flange') {
    // a bulky edifice: thick lens-shaped ledges on part of its girth, fused buttresses, small spires on top
    const r0 = 1.25 + rng() * 0.85, topK = 0.32 + rng() * 0.2;
    yield* spire({ H: H0, r0, topK, taper: 0.9 + rng() * 0.5, open: false, broken: true, noise: 0.24, knob: 0.34, nodes: 0.14 + rng() * 0.12, poolGlow: 0.18, lump: 0.2 + rng() * 0.1,
      flanges: flangeSet(H0, 2 + Math.floor(rng() * 3), r0 * (0.4 + rng() * 0.45), 0.24 + rng() * 0.16, dead ? 0 : 0.35), glowK: dead ? 0.15 : 1, rustB: dead ? 0.25 : 0, sprouts: 1 + Math.floor(rng() * 2) });
    for (let k = 0, n = rng() < 0.6 ? 1 + Math.floor(rng() * 2) : 0; k < n; k++) { // fused buttresses
      const a = rng() * TAU, h = H0 * (0.25 + rng() * 0.35), rr = r0 * (0.45 + rng() * 0.2);
      const sp = yield* spire({ H: h, r0: rr, topK: 0.45, taper: 1.2, open: false, broken: true, lean: [Math.cos(a) * 0.05, Math.sin(a) * 0.05], flanges: rng() < 0.5 ? flangeSet(h, 1, rr * 0.7, 0.2, 0.4) : [], poolGlow: 0.22, ...deadO });
      shift(sp, Math.cos(a) * r0 * 0.7, Math.sin(a) * r0 * 0.7);
    }
    const nt = dead ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 3), topR = r0 * topK * 0.9;
    for (let k = 0; k < nt; k++) {
      const a = rng() * TAU, d = topR * (0.2 + rng() * 0.6), h = 1 + rng() * 2.5;
      const sp = yield* spire({ H: h, y0: H0 * 0.86, r0: 0.16 + rng() * 0.16, lean: [Math.cos(a) * 0.08, Math.sin(a) * 0.08], flanges: [], ...deadO });
      shift(sp, Math.cos(a) * d, Math.sin(a) * d);
    }
    Rm = 1.5 + r0 * 1.15;
  } else if (form === 'candelabra') {
    const r0 = 0.55 + rng() * 0.4, Ht = H0 * (0.4 + rng() * 0.2);
    yield* spire({ H: Ht + 0.5, r0, topK: 0.7, open: false, broken: true, flanges: rng() < 0.5 ? flangeSet(Ht, 1, r0 * 0.7, 0.16, 0.5) : [], glowK: dead ? 0.15 : 1, rustB: dead ? 0.25 : 0, sprouts: Math.floor(rng() * 2) });
    const nb = 2 + Math.floor(rng() * 3), a0 = rng() * TAU;
    for (let k = 0; k < nb; k++) {
      const a = a0 + k * TAU / nb + (rng() - 0.5) * 0.6, D = 0.6 + rng() * 0.9, Lr = 0.8 + rng() * 1.2, ca = Math.cos(a), sa = Math.sin(a);
      const yb = Ht * (0.55 + rng() * 0.4), h = H0 - yb + (rng() - 0.5) * 2;
      yield* spire({ H: Math.max(1.5, h), y0: yb, r0: r0 * (0.45 + rng() * 0.2), topK: 0.6, flanges: [], drift: (dy) => { const e = D * (1 - Math.exp(-dy / Lr)); return [ca * e, sa * e]; }, ...deadO });
    }
    Rm = 1.5 + r0 * 1.5;
  } else if (form === 'beehive') {
    const H = Math.min(H0, 1.6 + rng() * 2.2), R = 1.0 + rng() * 0.9; // squat domes
    const nu = Math.min(Q.cap + 20, Math.max(ringN(Q, R * 1.1, null), Math.round(TAU * R * 1.1 / (Q.seg * 0.45)))); // fine enough for the pores
    const sp = yield* beehiveG(b, site, { seed: nS(), nu, step: Q.step, seg: Q.seg, H, R });
    for (const v of sp) if (rng() < site.active) vents.push(v);
    for (let k = 0, n = Math.floor(rng() * 2.5); k < n; k++) {
      const a = rng() * TAU, d = R * 0.15 * rng();
      const sp = yield* spire({ H: 0.8 + rng() * 1.6, y0: H * 0.8, r0: 0.12 + rng() * 0.1, flanges: [] });
      shift(sp, Math.cos(a) * d, Math.sin(a) * d);
    }
    Rm = R + 0.8;
  } else if (form === 'carbonate') {
    const r0 = 0.8 + rng() * 0.7;
    const fls = flangeSet(H0, 2 + Math.floor(rng() * 3), 0.4 + rng() * 0.5, 0.15 + rng() * 0.08);
    yield* spire({ H: H0, r0, topK: 0.35 + rng() * 0.2, taper: 1.1, open: false, broken: true, noise: 0.2, knob: 0.22, flute: 0.08, glowK: 0, nodes: 0.15 + rng() * 0.12,
      flanges: fls, poolGlow: 0, nu: Math.min(Q.cap - 6, ringN(Q, r0, fls)) });
    for (let k = 0, n = 1 + Math.floor(rng() * 2); k < n; k++) { // fused sub-towers buttress the main one
      const a = rng() * TAU, h = H0 * (0.35 + rng() * 0.45), rr = r0 * (0.4 + rng() * 0.25);
      const sp = yield* spire({ H: h, r0: rr, topK: 0.4, taper: 1.2, open: false, broken: true, noise: 0.2, knob: 0.22, glowK: 0, lean: [Math.cos(a) * 0.04, Math.sin(a) * 0.04],
        flanges: rng() < 0.6 ? flangeSet(h, 1 + Math.floor(rng() * 2), 0.3, 0.08) : [], poolGlow: 0 });
      shift(sp, Math.cos(a) * r0 * (0.55 + rng() * 0.3), Math.sin(a) * r0 * (0.55 + rng() * 0.3));
    }
    for (let k = 0, n = 2 + Math.floor(rng() * 4); k < n; k++) { // delicate fingers on top
      const a = rng() * TAU, d = r0 * 0.35 * rng(), y0 = H0 * (0.85 + rng() * 0.1);
      const sp = yield* spire({ H: 0.8 + rng() * 2.6, y0, r0: 0.09 + rng() * 0.14, topK: 0.5, glowK: 0, flanges: [], open: rng() < 0.6, nu: 8 });
      shift(sp, Math.cos(a) * d, Math.sin(a) * d);
    }
    Rm = 1.4 + r0;
  } else { // toppled / stump: broken stumps (one may still smoke) and fallen tops
    const r0 = 0.4 + rng() * 0.45, Hs = 0.9 + rng() * (form === 'stump' ? 3.5 : 2.2);
    const brk = rng() < 0.75 || form === 'stump' || dead;
    yield* spire({ H: Hs, r0, topK: 0.6 + rng() * 0.3, taper: 1 + rng(), lean: [(rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12], broken: brk, open: true, flanges: [], lump: 0.2 + rng() * 0.12,
      glowK: brk ? 0.2 : 1, rustB: form === 'stump' ? 0.1 : 0, nodes: 0.14 + rng() * 0.14, sprouts: Math.floor(rng() * 2.4) });
    for (let k = 0, n = rng() < 0.55 ? 1 + Math.floor(rng() * 2) : 0; k < n; k++) { // smaller stumps fused at the foot
      const a = rng() * TAU, h = Hs * (0.25 + rng() * 0.5), rr = r0 * (0.45 + rng() * 0.3);
      const sp = yield* spire({ H: h, r0: rr, topK: 0.7, lean: [Math.cos(a) * 0.08, Math.sin(a) * 0.08], broken: true, flanges: [], glowK: 0.2, rustB: 0.2 });
      shift(sp, Math.cos(a) * (r0 + rr) * 0.75, Math.sin(a) * (r0 + rr) * 0.75);
    }
    for (let k = 0, n = form === 'toppled' ? 1 + (rng() < 0.35 ? 1 : 0) : rng() < 0.35 ? 1 : 0; k < n; k++) {
      const v1 = b.vc, L = (form === 'toppled' && !k ? 2.5 + rng() * 4 : 1.2 + rng() * 2) * Math.min(1.3, hk), rr = r0 * (k ? 0.5 + rng() * 0.2 : 0.7 + rng() * 0.2);
      yield* spireG(b, site, { nu: ringN(Q, rr, null), step: rowStep(Q, rr), seg: Q.seg, seed: nS(), H: L, r0: rr, topK: 0.6, open: false, broken: true, brokenBase: true, flanges: [], glowK: 0.2, rustB: 0.15 });
      layDown(b, v1, rng, r0 + 0.25 + k * 0.4);
    }
    Rm = 1.2 + r0;
    label = form;
  }
  // mound + rubble
  const mv0 = b.vc, mi0 = b.I.length;
  yield* moundG(b, site, { R: Rm, Rz: Rm * (0.7 + rng() * 0.3), Hm: Math.min(1.6, 0.35 + Rm * (0.15 + rng() * 0.2)), seed: nS(), detail: Q.mound, rng, Q });
  const mv1 = b.vc, mi1 = b.I.length;
  yield* rubbleG(b, site, rng, 2 + Math.floor(rng() * 5), Rm * 0.8, Rm * 1.4, 0.25 + rng() * 0.25);
  b.band = 0.05; // the flat bottoms (mound, spire bases, rubble) are the contact band
  // flight-tube split (see layoutVents): the low part is the mound with its heap and the rubble around it,
  // everything above its top is the tall part, usually far narrower than the whole footprint
  let hLow = 0, rTall = 0;
  for (let i = mv0; i < b.vc; i++) hLow = Math.max(hLow, b.P[i * 3 + 1]);
  for (let i = 0; i < b.vc; i++) if (b.P[i * 3 + 1] > hLow) rTall = Math.max(rTall, Math.hypot(b.P[i * 3], b.P[i * 3 + 2]));
  const t = b.build();
  t.hLow = hLow; t.rTall = rTall;
  // what other props rest on: the mound alone. A spire's thousands of triangles project into a few top-down
  // cells, which would make every nearby ground query scan them.
  const pb = new Builder();
  pb.P = b.P.slice(mv0 * 3, mv1 * 3); pb.N = b.N.slice(mv0 * 3, mv1 * 3); pb.C = b.C.slice(mv0 * 3, mv1 * 3); pb.F = b.F.slice(mv0 * 2, mv1 * 2);
  pb.I = b.I.slice(mi0, mi1).map((i) => i - mv0);
  t.supportProxy = pb.build();
  const nm = (SITE_NAMES[site.key] && SITE_NAMES[site.key][label]) || NAMES[label] || NAMES.spire;
  t.label = nm[0]; t.fact = nm[1];
  t.support = false; // seated by hand; others rest on t.supportProxy
  t.vents = vents;
  t.rFoot = Rm;
  t.form = form;
  t.smoke = site.smoke; t.glow = site.pal.glow; // the plume of this chimney's own site type
  return t;
}
// lay a vertically built broken piece on its side next to the stump, flat underside on y = 0
function layDown(b, v1, rng, off) {
  const R = rotZ(-Math.PI / 2 + (rng() - 0.5) * 0.08), yaw = rng() * TAU, Y = rotY(yaw);
  b.xform(v1, R);
  let minY = 1e9, minX = 1e9;
  for (let i = v1; i < b.vc; i++) { minY = Math.min(minY, b.P[i * 3 + 1]); minX = Math.min(minX, b.P[i * 3]); }
  for (let i = v1; i < b.vc; i++) {
    let y = b.P[i * 3 + 1] - minY;
    if (y < 0.06) y *= 0.3; // settled: flattened contact strip
    b.P[i * 3 + 1] = y; b.P[i * 3] += off - minX;
  }
  b.xform(v1, Y);
}

// ---------- vent life ----------
const MAT_EDGE = [0.3, 0.28, 0.25], DIRT = [0.32, 0.24, 0.14], SHELL = [0.86, 0.84, 0.78], SHELL_DEAD = [0.8, 0.78, 0.72], PERIO = [0.3, 0.2, 0.1], MAT_W = [0.66, 0.66, 0.63], MAT_Y = [0.64, 0.56, 0.28];
// Riftia thicket: white tubes in clumps, red plumes (sway style 5: they pull back as the camera passes)
// Tubes splay out of each clump like a bouquet (outer ones lean and curve further), wander a little, widen
// towards the mouth and carry their own tint: chalky white to cream or grey, stained brown at the base.
const TUBE_TINTS = [[0.66, 0.64, 0.58], [0.64, 0.6, 0.5], [0.56, 0.55, 0.52], [0.68, 0.66, 0.62], [0.6, 0.55, 0.44]];
export function* thicketG(seed, { n = 40, r = 0.5, h = 1.0, small = false, tier = 'high' } = {}) {
  const b = new Builder(), rng = mulberry32(seed), radial = tier === 'low' || small ? 5 : 6;
  const nc = 1 + Math.floor(rng() * 3), cl = [];
  for (let k = 0; k < nc; k++) { const a = rng() * TAU, d = k ? r * (0.3 + rng() * 0.5) : 0; cl.push([Math.cos(a) * d, Math.sin(a) * d, r * (0.3 + rng() * 0.3)]); }
  const plumeC = small ? [0.6, 0.06, 0.04] : [0.78, 0.045, 0.035], tc = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const c = cl[k % nc], g = Math.sqrt(-2 * Math.log(1 - rng() * 0.95)) * 0.5, a = rng() * TAU;
    const bx = c[0] + Math.cos(a) * g * c[2], bz = c[1] + Math.sin(a) * g * c[2];
    const L = h * (0.3 + 0.9 * Math.pow(rng(), 0.8)) * (1 - 0.4 * Math.min(1, g)), rr = (small ? 0.011 : 0.017) + rng() * 0.011;
    // splay direction: away from the clump centre (plus jitter); outer tubes splay and curve more
    const da = Math.atan2(bz - c[1], bx - c[0]) + (rng() - 0.5) * 0.9, spl = (0.12 + 0.55 * Math.min(1.2, g) + rng() * 0.2) * (small ? 1.2 : 1);
    const sx = Math.cos(da), sz = Math.sin(da), wx = -sz, wz = sx, wph = rng() * TAU, wig = (0.03 + rng() * 0.06) * L, droop = rng() < 0.15 ? 0.25 : 0;
    const pts = [], radii = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4, out = spl * L * (0.25 * t + 0.55 * t * t), side = wig * Math.sin(wph + t * 4.5) * t;
      pts.push([bx + sx * out + wx * side, L * t * (1 - 0.18 * spl * t - droop * t * t), bz + sz * out + wz * side]);
      radii.push(rr * (0.75 + 0.35 * t) * (i === 4 ? 1.12 : 1));
    }
    const dirty = 0.15 + rng() * 0.4, T0 = TUBE_TINTS[(rng() * TUBE_TINTS.length) | 0], tk = 0.9 + rng() * 0.18, rg = 30 + rng() * 25;
    set3(tc, T0); tc[0] *= tk; tc[1] *= tk; tc[2] *= tk;
    b.tube(pts, radii, radial, (v, an, x, y, z, o) => {
      const cc = mixIn(set3(C3, tc), DIRT, sstep(dirty, 0, v) * 0.85);
      const ring = 0.9 + 0.1 * Math.sin(v * rg + k) - 0.12 * sstep(0.85, 0.97, Math.sin(v * rg * 0.31 + k * 1.7)); // growth rings
      o[3] = cc[0] * ring; o[4] = cc[1] * ring; o[5] = cc[2] * ring; o[6] = 0.012 * L * v * v; o[7] = 0;
    });
    // plume: narrow base in the tube mouth, flaring feathery crown (lamellae as lobes); some withdrawn
    const top = pts[4], seg = Math.hypot(pts[4][0] - pts[3][0], pts[4][1] - pts[3][1], pts[4][2] - pts[3][2]) || 1;
    const dx = (pts[4][0] - pts[3][0]) / seg, dy = (pts[4][1] - pts[3][1]) / seg, dz = (pts[4][2] - pts[3][2]) / seg;
    const shy = rng() < 0.18, pl = shy ? 0.025 : (small ? 0.06 : 0.1) + rng() * (small ? 0.06 : 0.14), lob = 5 + Math.floor(rng() * 3);
    const flare = shy ? 0.6 : (small ? 1.0 : 1.5) + rng() * 0.8, pk = 0.8 + rng() * 0.35;
    b.lathe(6, 3, (v) => [rr * 1.05 * (0.75 + flare * Math.sin(Math.PI * v * 0.92)) * (v > 0.99 ? 0.45 : 1), v * pl], (an) => 1 + 0.3 * Math.sin(an * lob), (v, an, x, y, z, o) => {
      const s = (0.75 + 0.25 * Math.sin(an * lob * 2)) * (0.55 + 0.6 * v) * pk;
      o[3] = plumeC[0] * s; o[4] = plumeC[1] * s * (1 + 0.6 * v); o[5] = plumeC[2] * s; o[6] = pl * 0.8 + 0.02; o[7] = 5;
    });
    // stand the crown on the tube mouth along its direction (y along d, x/z offset)
    const v0 = b.vc - 6 * 4;
    for (let i = v0; i < b.vc; i++) { const y = b.P[i * 3 + 1]; b.P[i * 3] += top[0] + dx * y; b.P[i * 3 + 1] = top[1] - 0.01 + dy * y; b.P[i * 3 + 2] += top[2] + dz * y; }
    if ((k & 15) === 15) yield;
  }
  b.band = 0.03;
  const t = b.build();
  t.label = small ? 'Vent tube worms' : 'Giant tube worms';
  t.fact = small ? 'Smaller vent tube worms crowd the cooler edges of a vent, where the fluid is a little gentler.'
    : 'Giant tube worms have no mouth or gut: bacteria inside them make food from vent chemicals.';
  t.solid = false;
  return t;
}
// vent clams nestled in a crack (Calyptogena): white shells with brown edges
function clamBed(seed, { n = 14, L = 1.6, dead = false } = {}) {
  const b = new Builder(), rng = mulberry32(seed), a0 = rng() * TAU, bend = (rng() - 0.5) * 0.6;
  for (let k = 0; k < n; k++) {
    const t = (k / Math.max(1, n - 1) - 0.5) * L, off = (rng() - 0.5) * 0.18, s = 0.12 + rng() * 0.1;
    const cx = Math.cos(a0) * t - Math.sin(a0) * (off + bend * t * t), cz = Math.sin(a0) * t + Math.cos(a0) * (off + bend * t * t);
    const yaw = a0 + (rng() - 0.5) * 0.9, cy = Math.cos(yaw), sy = Math.sin(yaw), stand = dead ? 0 : rng() * 0.6, broken = dead && rng() < 0.5;
    b.blob(1, (x, y, z, o) => {
      const w = 0.42 * Math.sqrt(Math.max(0, 1 - x * x * 0.25)), lx = x * s * 0.5, ly = y * s * 0.22 * (broken ? 0.5 : 1), lz = z * s * w * 0.5;
      const yy = ly * Math.cos(stand) + lz * Math.sin(stand), zz = lz * Math.cos(stand) - ly * Math.sin(stand);
      o[0] = cx + cy * lx - sy * zz; o[1] = Math.max(0, yy + s * 0.07); o[2] = cz + sy * lx + cy * zz;
      const e = sstep(0.55, 0.95, Math.abs(z)) * (dead ? 0.2 : 0.75);
      const c = mixIn(set3(C3, dead ? SHELL_DEAD : SHELL), PERIO, e);
      o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[7] = 0;
    });
  }
  const t = b.build();
  t.label = dead ? 'Dead clam shells' : 'Vent clams';
  t.fact = dead ? 'Empty white shells mark where a vent once flowed; without it the clams starve.'
    : 'Vent clams push a foot into the cracks to reach the sulphide that their gill bacteria live on.';
  return t;
}
// bacterial mat: lobed, patchy white / yellow / orange film (drapes on the floor)
function bacterialMat(seed, { col = 0 } = {}) {
  const b = new Builder(), rng = mulberry32(seed), ph = rng() * 10;
  const C = [[0.6, 0.6, 0.57], [0.6, 0.53, 0.26], [0.6, 0.37, 0.16]][col];
  // fine grid (a drape only follows the floor at its own vertices) with a lobed outline that never folds
  b.grid(44, 9, (u, v, i, j, o) => {
    const a = u * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const R = Math.max(0.45, 1 + 0.32 * vn3(ca * 1.4 + ph, sa * 1.4, seed, seed) + 0.12 * vn3(ca * 4 + ph, sa * 4, 2, seed + 1) + 0.08 * Math.sin(a * 3 + ph));
    const r = Math.pow(v, 0.85) * R;
    o[0] = ca * r; o[2] = sa * r;
    const p = vn3(o[0] * 3, 0, o[2] * 3, seed + 2), q = vn3(o[0] * 1.2, 1, o[2] * 1.2, seed + 3), hole = vn3(o[0] * 2.2 + ph, 2, o[2] * 2.2, seed + 4);
    o[1] = 0.012 + 0.024 * (1 - sstep(0.7, 1, v)) * (0.75 + 0.25 * p); // interior rides over floor creases, the rim tucks under
    const c = mixIn(set3(C3, C), col ? MAT_W : MAT_Y, sstep(0.3, 0.7, q) * 0.5);
    mixIn(c, MAT_EDGE, Math.max(sstep(0.35, 1, v + 0.3 * p) * 0.85, sstep(0.2, 0.55, hole) * 0.7)); // patchy film, fading into the sediment
    const k = 0.74 + 0.34 * p;
    o[3] = c[0] * k; o[4] = c[1] * k; o[5] = c[2] * k; o[6] = 0; o[7] = 0;
  }, { wrapU: true, flip: true });
  b.dLift = 0.004; // rim 8 mm under the floor (ragged natural edge), interior ~2.5 cm above it
  const t = b.build();
  t.label = col === 2 ? 'Orange bacterial mat' : col === 1 ? 'Sulphur bacterial mat' : 'Bacterial mat';
  t.fact = 'Bacterial mats feed on hydrogen sulphide: the base of a food web that never sees sunlight.';
  t.drape = true;
  return t;
}

// ---------- smoke: billowing particle plumes (own material) ----------
// attributes: position = orifice (chunk-local), aCorner, aP = (phase, rate, rise, size0), aQ = (spread, albedo, glow, alpha)
let SMOKE_MAT = null;
function smokeMaterial() {
  if (SMOKE_MAT) return SMOKE_MAT;
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  SMOKE_MAT = applyWater(m, {
    key: 'vents-smoke-v3', noLight: true,
    vertexHead: 'attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aQ; varying vec2 vC; varying float vT; varying float vPh; varying float vH; varying vec4 vQ; uniform float uTime;',
    fragmentHead: 'varying vec2 vC; varying float vT; varying float vPh; varying float vH; varying vec4 vQ;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', /* glsl */`
        float t = fract(uTime * aP.y + aP.x);
        float sd = fract(aP.x * 7.31 + 0.13);
        float h = aP.z * (1.0 - pow(1.0 - t, 1.55));          // buoyant jet: fast at the orifice, slowing
        vec3 c = position;
        float R = aP.w * 0.3 + aQ.x * h;                        // the plume widens as it entrains water
        float a = sd * 6.2831 + t * (2.0 + 3.0 * sd) + uTime * 0.07;
        c.xz += vec2(cos(a), sin(a)) * R * (0.2 + 0.55 * fract(sd * 13.7));
        c.y += h;
        // bottom current bends the plume over with height (periods divide the 4096 s shader-time wrap)
        float da = 0.9 + 0.8 * sin(uTime * 0.0015339808) + 0.3 * sin(uTime * 0.0046019424 + 1.0);
        float dm = 0.55 + 0.45 * sin(uTime * 0.0030679616 + 2.0);
        c.xz += vec2(cos(da), sin(da)) * dm * (0.06 * h + 0.004 * h * h);
        float sz = aP.w * (0.6 + 0.8 * sqrt(t)) + aQ.x * h * 1.2;
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        float ang = sd * 40.0 + uTime * 0.12 * (fract(sd * 3.7) - 0.5);
        float cs = cos(ang), sn = sin(ang);
        vec2 q = vec2(cs * aCorner.x - sn * aCorner.y, sn * aCorner.x + cs * aCorner.y);
        q.y *= 1.0 + 0.7 * (1.0 - smoothstep(0.0, 0.18, t)) * step(0.5, aQ.z);   // stretched jet near a hot orifice
        mvPosition.xy += q * sz;
        gl_Position = projectionMatrix * mvPosition;
        vC = aCorner; vT = t; vPh = sd; vH = h; vQ = aQ;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          float r = length(vC);
          vec4 n1 = texture2D(uNoiseTex, vC * 0.2 + vec2(vPh * 7.3, vPh * 3.1 + vT * 0.4));
          vec4 n2 = texture2D(uNoiseTex, vC * 0.45 + vec2(vPh * 2.7 - vT * 0.7, vPh * 5.9 + vT * 0.2));
          float bil = n1.r * 0.6 + n2.g * 0.4;                             // cauliflower billows
          float m = 1.0 - smoothstep(0.2, 1.0, r + (bil - 0.5) * 1.1);
          if (m < 0.003) discard;
          float life = smoothstep(0.0, 0.035, vT) * (1.0 - smoothstep(0.45, 1.0, vT));
          float d = length(vWPos - cameraPosition);
          float a = m * life * smoothstep(1.0, 4.5, d) * mix(1.0, 0.3, sqrt(vT)) * vQ.w;
          // lit from the front by the ROV lamps, from below by the hot orifice
          float nz = sqrt(max(0.0, 1.0 - r * r));
          float lamp = uLamp * 7.0 * exp(-uSigma.g * d) / (1.0 + 0.05 * d * d) * (0.3 + 0.7 * nz);
          vec3 alb = mix(vec3(0.13, 0.115, 0.1), vec3(0.6, 0.61, 0.58), vQ.y) * (0.7 + 0.6 * bil);
          vec3 amb = (uWaterUp * 0.5 + uWaterDeep * 0.5) * uAmbientScale * 1.5 + vec3(0.015);
          vec3 col = alb * (amb + lamp);
          col += vec3(1.0, 0.38, 0.1) * vQ.z * (1.0 - smoothstep(0.0, 0.05, vT)) * (0.5 - 0.45 * vC.y) * 0.3;
          // the glowing orifice lights the base of its own plume: billows lit from below, fading over a few metres
          col += vec3(1.0, 0.46, 0.15) * vQ.z * (0.5 + 0.5 * bil) * (0.6 - 0.4 * vC.y) * 0.34 / (1.0 + 0.3 * vH * vH);
          diffuseColor = vec4(col, a);
        }`);
    },
  });
  return SMOKE_MAT;
}
// Soft point glow around an active orifice (additive billboards from materials.billboardMesh: aP.w = radius).
// Warmer and wider than the small orange core halo; the water haze scatters it into a faint orb that marks a
// smoking chimney from beyond the lamps' reach. Fogged by extinction only (additive).
let GLOW_MAT = null;
function glowMaterial() {
  if (GLOW_MAT) return GLOW_MAT;
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  GLOW_MAT = applyWater(m, {
    key: 'vents-glow-v1', additive: true, noLight: true,
    vertexHead: 'attribute vec2 aCorner; attribute vec4 aP; varying vec2 vC; varying float vPh; uniform float uTime;',
    fragmentHead: 'varying vec2 vC; varying float vPh;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', /* glsl */`
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        mvPosition.xy += aCorner * aP.w;
        gl_Position = projectionMatrix * mvPosition;
        vC = aCorner; vPh = aP.x;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          float r = length(vC);
          if (r > 1.0) discard;
          float a = (1.0 - r) * (1.0 - r) * (0.75 + 0.25 * exp(-r * r * 10.0));
          float fl = 0.85 + 0.15 * sin(uTime * (1.7 + vPh) + vPh * 40.0);
          float near = smoothstep(1.5, 5.0, length(vWPos - cameraPosition)); // no flat disc in the lens
          diffuseColor.rgb = vec3(1.0, 0.5, 0.17) * a * fl * near * 0.16;
        }`);
    },
  });
  return GLOW_MAT;
}
function smokeMesh(em, rng) {
  let total = 0;
  for (const e of em) total += e.n;
  if (!total) return null;
  const pos = new Float32Array(total * 12), cor = new Float32Array(total * 8), ap = new Float32Array(total * 16), aq = new Float32Array(total * 16);
  const idx = new Uint16Array(total * 6), C = [-1, -1, 1, -1, 1, 1, -1, 1];
  let q = 0;
  for (const e of em) for (let k = 0; k < e.n; k++, q++) {
    const ph = (k + rng() * 0.8) / e.n + e.phase, rate = e.speed / Math.max(1, e.rise) * (0.85 + 0.3 * rng());
    for (let c = 0; c < 4; c++) {
      const v = q * 4 + c;
      pos[v * 3] = e.x; pos[v * 3 + 1] = e.y; pos[v * 3 + 2] = e.z;
      cor[v * 2] = C[c * 2]; cor[v * 2 + 1] = C[c * 2 + 1];
      ap[v * 4] = ph; ap[v * 4 + 1] = rate; ap[v * 4 + 2] = e.rise; ap[v * 4 + 3] = e.size;
      aq[v * 4] = e.spread; aq[v * 4 + 1] = e.alb; aq[v * 4 + 2] = e.glow; aq[v * 4 + 3] = e.alpha;
    }
    const b0 = q * 4, o = q * 6;
    idx[o] = b0; idx[o + 1] = b0 + 1; idx[o + 2] = b0 + 2; idx[o + 3] = b0; idx[o + 4] = b0 + 2; idx[o + 5] = b0 + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  g.setAttribute('aP', new THREE.BufferAttribute(ap, 4));
  g.setAttribute('aQ', new THREE.BufferAttribute(aq, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 34;
  const m = new THREE.Mesh(g, smokeMaterial());
  m.matrixAutoUpdate = false;
  m.renderOrder = 2;
  return m;
}

// ---------- init: startup fallbacks + per-segment palette providers ----------
const N_CHIMNEY = { low: 6, medium: 7, high: 8, ultra: 9 };
export function initVents() {
  smokeMaterial(); glowMaterial();
  // fallbacks (used only until a segment's own palette is ready)
  const fb = makeSite(SITES[0], 4242);
  T.chimney = [drain(edificeG(fb, 11, 'medium', 'spire')), drain(edificeG(makeSite(SITES[1], 4243), 12, 'medium', 'flange')), drain(edificeG(fb, 13, 'medium', 'candelabra')),
    drain(edificeG(makeSite(SITE_BY.relict, 4244), 14, 'medium', 'stump'))];
  T.worms = [drain(thicketG(1, { n: 36, r: 0.45, h: 1.0, tier: 'medium' })), drain(thicketG(2, { n: 28, r: 0.4, h: 0.6, small: true, tier: 'medium' }))];
  T.ventMussels = [1, 2, 3, 4].map((s) => {
    const t = musselBed(60 + s, { n: 16 + s * 9, r: 0.35 + s * 0.15, col: [0.3, 0.22, 0.1], edge: [0.58, 0.48, 0.24], len: 0.1 + s * 0.012 });
    t.label = 'Vent mussel bed'; t.fact = 'Vent mussels carry bacteria in their gills that turn sulphide or methane into food.'; t.drape = true;
    return t;
  });
  T.ventClams = [1, 2, 3].map((s) => clamBed(70 + s, { n: 10 + s * 5, L: 1 + s * 0.5 }));
  T.ventShells = [1, 2].map((s) => clamBed(80 + s, { n: 12 + s * 6, L: 1.4 + s * 0.4, dead: true }));
  T.mat = [0, 1, 2, 0, 1, 0].map((c, i) => bacterialMat(90 + i, { col: c }));
  T.ventRubble = [1, 2, 3].map((s) => { const b = new Builder(), rng = mulberry32(s * 31); drain(rubbleG(b, fb, rng, 5 + s * 2, 0, 0.6 + s * 0.2, 0.18 + s * 0.04)); const t = b.build(); t.label = 'Chimney rubble'; t.fact = 'Sulphide chimneys are brittle: rubble from collapsed spires piles up around every vent.'; return t; });
  T.ventRock = makePool('vents', 'ventRock', 5, 7);
  // per-segment palettes: fresh chimneys and thickets for every vents segment
  provide('vents', 'chimney', PLAN_N, (seg, k, tier) => {
    if (k >= (N_CHIMNEY[tier] || 8)) return null;
    const p = siteOf(seg).plan[k];
    return edificeG(p.site, (seg.seed ^ (k * 0x2545f491)) >>> 0, tier, p.form);
  }, 0);
  provide('vents', 'thicket', 5, (seg, k, tier) => thicketG((seg.seed ^ (k * 0x68e31da4)) >>> 0, { n: 30 + k * 6, r: 0.35 + k * 0.07, h: 0.7 + (k % 3) * 0.25, small: k === 4, tier }), 0);
}
// palette lists for a segment (fallbacks while generating)
function chimneysOf(seg) { const p = paletteOf(seg), l = p && p.pools.chimney; return l && l.length >= 3 ? l : T.chimney; }
function thicketsOf(seg) { const p = paletteOf(seg), l = p && p.pools.thicket; return l && l.length >= 2 ? l : T.worms; }

const S = {};
function specs() {
  if (S.rock) return S;
  Object.assign(S, {
    rock: { tpl: T.ventRock, scale: [0.5, 1.8], ys: [0.75, 1.3], xz: 0.5, grow: [0, 0], follow: 0.5, tint: tintFrom([[0.3, 0.29, 0.29], [0.36, 0.3, 0.26], [0.26, 0.26, 0.28]], 0.12) },
    mussels: { tpl: T.ventMussels, scale: [0.8, 1.6], follow: 0.9, sink: 0.04, tint: tintFrom([[1, 1, 1], [1.1, 1.0, 0.85]], 0.12) },
    clams: { tpl: T.ventClams, scale: [0.8, 1.3], follow: 0.9, sink: 0.03, tint: tintFrom([[1, 1, 1]], 0.06) },
    shells: { tpl: T.ventShells, scale: [0.8, 1.4], follow: 0.9, sink: 0.02, tint: tintFrom([[1, 1, 1]], 0.06) },
    mat: { tpl: T.mat, scale: [0.5, 1.7], follow: 1, sink: 0, maxSlope: 0.85, tint: tintFrom([[1, 1, 1]], 0.08) },
    rubble: { tpl: T.ventRubble, scale: [0.7, 1.4], follow: 0.8, sink: 0.03, tint: tintFrom([[1, 1, 1]], 0.15) },
  });
  S.micro = [{ w: 2, spec: S.rubble }, { w: 1.4, spec: S.mat }, { w: 1.2, spec: S.mussels }, { w: 0.8, spec: S.clams }];
  return S;
}
const wormSpec = (list) => ({ tpl: list, scale: [0.75, 1.35], follow: 0.45, sway: true, sink: 0.03, tint: tintFrom([[1, 1, 1]], 0.07) });

// chimney placement outcomes per reason / form (dev: window.__ventStats in the console)
const VSTAT = {};
if (typeof window !== 'undefined') window.__ventStats = VSTAT;
const why = (k) => { VSTAT[k] = (VSTAT[k] || 0) + 1; };

// ---------- vent fields per segment ----------
// Fields stand 6-15 m off the path: the water (sigma ~0.1/m) swallows lamp light and glow beyond ~15-20 m,
// so a field further out is never seen. A field takes the outside of the local bend when there is one
// (tall chimneys then appear dead ahead and the camera curves past); chimney() pushes each chimney out to
// the clearance its own low and tall parts need.
const fields = new Map();
function segmentFields(ctx, seg, site) {
  let F = fields.get(seg.id);
  if (F && F.seed === seg.seed) return F;
  const rng = mulberry32(seg.seed ^ 0x7e47), members = [];
  for (let s = seg.start + 30 + rng() * 30, fi = 0; s < seg.end - 30; s += 30 + rng() * 32, fi++) {
    const c = (ctx.pathX(s + 6) - 2 * ctx.pathX(s) + ctx.pathX(s - 6)) / 36; // as WorldShape.pathCurv
    const side = Math.abs(c) > 0.004 && rng() < 0.8 ? (c > 0 ? -1 : 1) : rng() < 0.5 ? -1 : 1;
    const d = 6 + rng() * 9, cx = ctx.pathX(s) + side * d;
    const n = 1 + Math.floor(rng() * (site.key === 'beehive' || site.key === 'relict' ? 5 : 4));
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU, r = k === 0 ? 0 : 3.5 + rng() * 6.5, ms = s + Math.sin(a) * r;
      const lat = Math.max(4 + rng() * 2, d + Math.cos(a) * r); // the field keeps to its own side of the path
      members.push({ kind: 'chimney', x: ctx.pathX(ms) + side * lat, s: ms, seed: (rng() * 1e9) | 0, main: k === 0, side, fi });
    }
    // a Riftia thicket patch and a clam crack on the diffuse-flow floor between the chimneys
    if (rng() < site.worms) { const a = rng() * TAU, r = 3 + rng() * 6; members.push({ kind: 'thicket', x: cx + Math.cos(a) * r, s: s + Math.sin(a) * r, seed: (rng() * 1e9) | 0 }); }
    for (let k = 0; k < 18; k++) {
      const a = rng() * TAU, r = 1.5 + Math.pow(rng(), 0.8) * 13;
      members.push({ kind: 'life', x: cx + Math.cos(a) * r, s: s + Math.sin(a) * r, seed: (rng() * 1e9) | 0 });
    }
  }
  F = { seed: seg.seed, members };
  fields.set(seg.id, F);
  if (fields.size > 24) fields.delete(fields.keys().next().value);
  return F;
}

export function layoutVents(ctx) {
  if (presence(ctx, 'vents') <= 0) return null;
  const sp = specs(), rng = ctx.rng, fs = floorSampler(ctx), bk = budgetK(ctx, 'vents'), tk = tierK(ctx);
  const st = new Batch(MAT.static, 70000 * bk);                                                 // chimneys, rocks
  const mid = new Batch(MAT.static, 22000 * bk * tk, 'mid'), sw = new Batch(MAT.sway, 34000 * bk * tk, 'mid'); // vent life
  const near = new Batch(MAT.static, 14000 * bk * tk, 'near');                                   // micro detail
  const em = [], halos = [], orbs = [], members = [];
  const inChunk = (s) => s >= ctx.s0 && s < ctx.s1;
  let site = null, segV = null;
  for (const seg of ctx.segments) {
    if (seg.key !== 'vents') continue;
    site = siteOf(seg); segV = seg;
    const F = segmentFields(ctx, seg, site);
    for (const m of F.members) if (inChunk(m.s)) members.push({ ...m, site, seg });
  }
  if (!site) { // vents weight from a neighbouring chunk's segment only (cross-fade edge): borrow the nearest
    const g = ctx.weights(ctx.s0 + 32).find((e) => e.key === 'vents');
    if (!g) return null;
    site = siteOf(g.g); segV = g.g;
  }
  // chimneys on the outside of bends: the camera curves past the smoking stack
  for (const b of bendSpots(ctx)) {
    if (rng() > ctx.weightOf(b.s, 'vents') * 0.8) continue;
    members.push({ kind: 'chimney', bend: b, x: 0, s: b.s, seed: (b.s * 7919) | 0, site, seg: segV, main: true, side: b.side });
  }
  const placed = [], shown = new Set(); // fields announced (POI) in this chunk: only once a chimney of theirs stands
  // Flight tube per part: the wide mound and rubble (up to hLow) and the narrow tall spires above it.
  // need() is the lateral offset from the path line both parts need at s, given how far the path runs above
  // or below them (same limit as tubeClear plus 0.25 m slack: the path moves a little over the footprint).
  const LIM = TUBE + 0.35 + 0.25;
  const part = (s, yLo, yHi, r) => { const py = ctx.pathY(s), dy = py < yLo ? yLo - py : py > yHi ? py - yHi : 0; return dy >= LIM ? 0 : Math.sqrt(LIM * LIM - dy * dy) + r; };
  const need = (tpl, s, y0, sc, ky, k) => {
    const yL = y0 + tpl.hLow * sc * ky;
    return Math.max(part(s, y0 - 1, yL, tpl.r * sc * k + 0.4), tpl.maxY > tpl.hLow ? part(s, yL, y0 + tpl.maxY * sc * ky, tpl.rTall * sc * k + 0.4) : 0);
  };
  const clear = (tpl, x, s, y0, sc, ky, k) => {
    const yL = y0 + tpl.hLow * sc * ky;
    return tubeClear(ctx, x, s, y0 - 1, yL, tpl.r * sc * k + 0.4) && (tpl.maxY <= tpl.hLow || tubeClear(ctx, x, s, yL, y0 + tpl.maxY * sc * ky, tpl.rTall * sc * k + 0.4));
  };
  const chimney = (m) => {
    const r2 = mulberry32(m.seed), list = chimneysOf(m.seg), S2 = m.site;
    // the main chimney of a field: a third of the time the site's signature form (palette slot 0)
    let tpl = list[(r2() * list.length) | 0];
    if (m.main && r2() < 0.35) tpl = list[0];
    const sm = SMOKE[tpl.smoke || S2.smoke], glowP = tpl.glow ?? S2.pal.glow;
    // every copy its own proportions: squatter or slimmer, a little wider one way
    const sc0 = 0.8 + r2() * 0.4, ky = 0.85 + r2() * 0.35, kx = 0.9 + r2() * 0.2, kz = 0.9 + r2() * 0.2, yaw = r2() * TAU, k = Math.max(kx, kz);
    let R = rotY(yaw);
    // up to four spots: the member's own, then nearby ones (steep slopes and ridges bury a mound: each
    // ridge failure also shrinks the footprint, which is what sets the burial on a slope). Each spot is
    // pushed out from the path, on the member's side, to the clearance this chimney needs.
    let x = m.x, s = m.s, sc = sc0, y = 0, fail = '', shrink = 1;
    for (let att = 0; att < (m.bend ? 1 : 4); att++) {
      if (att) { // another spot nearby, a step nearer the path each time: flatter ground than the ridge flanks
        const a = r2() * TAU, d = 2.5 + r2() * 4;
        x = m.x + Math.cos(a) * d - (m.side || 0) * att * 1.5; s = Math.min(ctx.s1 - 0.01, Math.max(ctx.s0, m.s + Math.sin(a) * d));
      }
      sc = sc0 * shrink;
      const px = ctx.pathX(s), side = m.side || (x < px ? -1 : 1);
      if (m.bend) x = px + side * (need(tpl, s, fs.at(px + side * 6, s), sc, ky, k) + r2() * 1.2);
      else for (let q = 0; q < 2; q++) { const nd = need(tpl, s, fs.at(x, s), sc, ky, k); if (side * (x - px) < nd) x = px + side * nd; }
      const y0 = fs.at(x, s);
      let ok = false;
      for (let t = 0; t < 3 && !ok; t++) { ok = clear(tpl, x, s, y0, sc, ky, k); if (!ok) sc *= 0.72; }
      if (!ok || sc < 0.5) { fail = 'tube'; continue; }
      if (!fs.free(x, s, tpl.rFoot * sc * Math.max(kx, kz) * 0.8)) { fail = 'occupied'; continue; } // fields never stack chimneys into each other
      // flat-bottomed mound settled into the floor; a long fallen piece settles along the slope, so on a
      // slope two more headings are tried before the spot is given up
      const bury = Math.min(2.5, 0.3 + 0.25 * tpl.maxY * sc * ky);
      for (let h = 0; h < 3; h++) {
        if (h) R = rotY(yaw + h * 1.05);
        y = groundY(fs, x, s, tpl, R, sc * kx, sc * ky, sc * kz) - 0.09 * sc * ky; // heap pieces spread the contact band thin: embed a little deeper
        if (y0 - y <= bury) break;
      }
      if (y0 - y > bury) { fail = 'ridge'; shrink *= 0.85; R = rotY(yaw); continue; } // would be buried too deep
      fail = '';
      break;
    }
    if (fail) return why(fail);
    const sx = sc * kx, sy = sc * ky, sz = sc * kz, rF = tpl.rFoot * sc * Math.max(kx, kz), z = -(s - ctx.s0);
    const tk = 0.9 + r2() * 0.2;
    if (!st.add(tpl, x, y, z, R, sx, sy, sz, tk * (0.97 + r2() * 0.06), tk, tk * (0.97 + r2() * 0.06), 1)) return why('budget');
    why('placed:' + tpl.form);
    const it = st.last;
    it.g = 1;
    fs.addSupport({ tpl: tpl.supportProxy || tpl, x: it.x, y: it.y, R: it.R, sx: it.sx, sy: it.sy, sz: it.sz }, s);
    fs.occupy(x, s, rF * 0.8);
    placed.push({ x, s, r: rF, site: S2, seg: m.seg });
    if (m.fi !== undefined && !shown.has(m.fi)) { shown.add(m.fi); poi(ctx, 'vent-field', x, y + 3, s, 12, { kind: S2.name }); }
    for (const v of tpl.vents) {
      const lx = v.x * sx, lz = v.z * sz, vx = R[0] * lx + R[2] * lz, vz = R[6] * lx + R[8] * lz, vy = y + v.y * sy;
      const s2 = v.seep ? SMOKE.seep : sm, big = v.r * sc > 0.22;
      em.push({ x: x + vx, y: vy, z: z + vz, n: Math.round(s2.n * (v.seep ? 1 : big ? 1 : 0.6) * (ctx.tier === 'low' ? 0.7 : 1)),
        rise: (s2.rise[0] + r2() * (s2.rise[1] - s2.rise[0])) * (big || v.seep ? 1 : 0.6), size: Math.max(0.25, v.r * sc * s2.size), spread: s2.spread,
        alb: s2.alb, glow: s2.glow * (glowP > 0.5 ? 1 : 0.2), alpha: s2.alpha, speed: s2.speed[0] + r2() * (s2.speed[1] - s2.speed[0]), phase: r2() });
      if (glowP > 0.3 && !v.seep) {
        halos.push({ x: x + vx, y: vy - 0.05, z: z + vz, n: 1, rise: 0, size: Math.max(0.35, v.r * sc * 1.8), speed: 0, phase: r2() });
        if (big) orbs.push({ x: x + vx, y: vy + 0.5 + v.r * sc, z: z + vz, n: 1, rise: 0, size: 1.3 + v.r * sc * 2.5, speed: 0, phase: r2() });
      }
    }
    // tube worms, mussels and clams crowd the warm foot of active chimneys
    const thk = thicketsOf(m.seg), ws = wormSpec(thk), nL = Math.round(5 * (0.6 + S2.worms));
    for (let k = 0; k < nL; k++) {
      const a = r2() * TAU, rr = tpl.rFoot * sc * (0.75 + r2() * 0.55);
      const e = r2() < S2.worms * 0.6 ? 'w' : r2() < S2.mussels / (S2.mussels + S2.clams + 0.01) ? 'm' : 'c';
      if (e === 'w') putFloor(ctx, fs, sw, ws, x + Math.cos(a) * rr, s + Math.sin(a) * rr, r2);
      else putFloor(ctx, fs, mid, e === 'm' ? sp.mussels : S2.shells ? sp.shells : sp.clams, x + Math.cos(a) * rr, s + Math.sin(a) * rr, r2);
    }
  };
  const thicket = (m) => { // a dense bush of several thickets around one spot
    const r2 = mulberry32(m.seed), ws = wormSpec(thicketsOf(m.seg)), n = 3 + Math.floor(r2() * 4);
    for (let k = 0; k < n; k++) { const a = r2() * TAU, rr = k ? 0.5 + r2() * 1.4 : 0; putFloor(ctx, fs, sw, ws, m.x + Math.cos(a) * rr, m.s + Math.sin(a) * rr, r2); }
    const a = r2() * TAU;
    putFloor(ctx, fs, mid, m.site.shells ? sp.shells : sp.clams, m.x + Math.cos(a) * 2, m.s + Math.sin(a) * 2, r2);
  };
  const life = (m) => {
    const r2 = mulberry32(m.seed), S2 = m.site;
    const e = pickW(r2, [{ w: 2.2 * S2.mats, k: 'mat' }, { w: 1.4 * S2.mussels, k: 'mussels' }, { w: 1 * S2.clams, k: S2.shells ? 'shells' : 'clams' }, { w: 1.2, k: 'rock' }, { w: 1, k: 'rubble' }, { w: 0.8 * S2.worms, k: 'worms' }]);
    if (e.k === 'worms') putFloor(ctx, fs, sw, wormSpec(thicketsOf(m.seg)), m.x, m.s, r2);
    else putFloor(ctx, fs, e.k === 'rock' ? st : e.k === 'mat' ? near : mid, sp[e.k], m.x, m.s, r2);
  };
  const chim = members.filter((m) => m.kind === 'chimney').sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
  const thk = members.filter((m) => m.kind === 'thicket'), lifeM = members.filter((m) => m.kind === 'life'), more = [];
  for (const m of chim) more.push(() => chimney(m));
  for (const m of thk) more.push(() => thicket(m));
  for (let q = 0; q < lifeM.length; q += 12) { const part = lifeM.slice(q, q + 12); more.push(() => part.forEach(life)); }
  more.push(...microSteps(ctx, fs, near, rng, 'vents', sp.micro, 110, 28, 28));
  // sparse pillow lava, sulphide blocks and the odd mat elsewhere
  const nextP = clusterer(ctx, rng, 0, 40, 1);
  more.push(...steps(Math.round(46 * tk), 23, () => {
    const p = nextP();
    if (!p || rng() > ctx.weightOf(p.s, 'vents')) return;
    if (rng() < 0.7 / site.mats) putFloor(ctx, fs, st, sp.rock, p.x, p.s, rng);
    else putFloor(ctx, fs, near, sp.mat, p.x, p.s, rng);
  }));
  more.push(() => { // plumes and orifice glow once every chimney is seated
    const pm = smokeMesh(em, rng); if (pm) L.extra.push(pm);
    const hm = billboardMesh(halos, MAT.halo, rng); if (hm) L.extra.push(hm);
    const om = billboardMesh(orbs, glowMaterial(), rng); if (om) L.extra.push(om);
  });
  const L = { batches: [st, mid, sw, near], extra: [], more };
  return L;
}
