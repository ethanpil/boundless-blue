// Giant kelp forest: stipes rise from holdfasts to the surface, carrying blades on gas bladders,
// and spread into a floating canopy. Sway (style 1) grows with height so bases stay anchored.
import { Builder, Batch, T, TAU, vn3, sat, sstep, lerp, floorSampler, presence, tubeClear, orient, budgetK, bendSpots, LENS, rotY, tierK, poi } from './core.js';
import { grassPatch } from './shapes.js';
import { putFloor, pickW, tintFrom, spot, putBend, microDetail, microSteps, steps, clusterer, groundY } from './scatter.js';
import { placeArch, placeLedge } from './reef.js';
import { MAT } from './materials.js';
import { mulberry32, noise1 } from '../noise.js';
import { kelpStand, kelpClearing, kelpGrove, kelpBarren, kelpCover, kelpHole } from '../biomes.js';
import { U } from '../water.js';
import { shaftMesh } from './nb2_common.js';

const STIPE = [0.45, 0.32, 0.1], BLADE = [0.8, 0.6, 0.16];

// One leaf-shaped, wrinkled blade from p along direction d (unit): own colour, droop, ruffle, tattering.
// The blade is turned about its axis (tw0) so its broad face shows from the side: kelp blades stream and
// hang in the water, they do not lie flat like shelves (edge-on they read as bare sticks). Canopy blades
// (flat) do lie flat, so from below the canopy shows their faces as a dark mat against the bright surface.
// bulb > 0: the blade starts in a gas bladder (pneumatocyst), a swelling of the strip itself: one extra row
// instead of a separate 8-triangle solid (bladders were half the triangles of a plant).
// Ruffle: the two edges undulate out of phase (giant-kelp blades are wrinkled and wavy-edged).
function blade(b, rng, p, d, L, W, sw, swTip, droop, col, tatter, segs, bulb = 0, flat = false) {
  const side = [-d[2], 0, d[0]], sl = Math.hypot(side[0], side[2]) || 1;
  side[0] /= sl; side[2] /= sl;
  const k = rng() * 10, k2 = rng() * 10, ruf = W * (0.25 + 0.45 * rng()), twist = (rng() - 0.5) * (flat ? 0.5 : 1.4);
  const tw0 = flat ? (rng() - 0.5) * 0.4 : (rng() < 0.5 ? -1 : 1) * (0.55 + rng() * 0.8);
  const notch = tatter ? 1 + Math.floor(rng() * segs) : -1, cut = tatter && rng() < 0.5;
  let q = p.slice(), dir = d.slice();
  const v0 = b.vc, r0 = bulb > 0 ? -1 : 0;
  const bc = [STIPE[0] * 1.6, STIPE[1] * 1.55, STIPE[2] * 1.3];
  if (bulb > 0) q = [q[0] - dir[0] * bulb * 2.2, q[1] - dir[1] * bulb * 2.2, q[2] - dir[2] * bulb * 2.2];
  for (let i = r0; i <= segs; i++) {
    const t = Math.max(0, i) / segs;
    let w = W * Math.pow(Math.sin(Math.min(1, t * 0.85 + 0.15) * Math.PI), 0.5 + 0.3 * rng());
    if (i === segs) w = cut ? W * 0.5 : W * 0.4; // blunt, rounded tip (lanceolate blade, not a willow leaf)
    if (i === notch) w *= 0.3 + 0.3 * rng();
    if (i === r0 && bulb > 0) w = bulb * 0.35;      // short stalk on the stipe
    else if (i === 0 && bulb > 0) w = bulb;         // the bladder
    // width vector: between the horizontal side and the in-plane normal of the (drooping) blade axis
    const ux = side[1] * dir[2] - side[2] * dir[1], uy = side[2] * dir[0] - side[0] * dir[2], uz = side[0] * dir[1] - side[1] * dir[0];
    const ul = Math.hypot(ux, uy, uz) || 1, tw = tw0 + twist * t, ct = Math.cos(tw), st = Math.sin(tw);
    const wx = side[0] * ct + ux / ul * st, wy = uy / ul * st, wz = side[2] * ct + uz / ul * st;
    // wrinkles: each edge shifts along the blade normal with its own phase, so the blade twists and ruffles
    const nx = wy * dir[2] - wz * dir[1], ny = wz * dir[0] - wx * dir[2], nz = wx * dir[1] - wy * dir[0];
    const on = i > 0 ? 1 : 0, ra = ruf * Math.sin(t * 9 + k) * on, rb = ruf * Math.sin(t * 11 + k2) * on;
    const c = 0.75 + 0.45 * t * (0.7 + 0.6 * rng()), bl = i <= 0 && bulb > 0;
    const cr = bl ? bc[0] : col[0] * c, cg = bl ? bc[1] : col[1] * c, cb = bl ? bc[2] : col[2] * c;
    const f = lerp(sw, swTip, t);
    b.v(q[0] - wx * w + nx * ra, q[1] - wy * w + ny * ra, q[2] - wz * w + nz * ra, 0, 1, 0, cr, cg, cb, f, 1);
    b.v(q[0] + wx * w + nx * rb, q[1] + wy * w + ny * rb, q[2] + wz * w + nz * rb, 0, 1, 0, cr, cg, cb, f, 1);
    if (i < 0) { q = [q[0] + dir[0] * bulb * 2.2, q[1] + dir[1] * bulb * 2.2, q[2] + dir[2] * bulb * 2.2]; continue; }
    dir = [dir[0], dir[1] - droop * (0.6 + 0.8 * rng()), dir[2]];
    const l = Math.hypot(...dir); dir = dir.map((x) => x / l);
    const stp = (L / segs) * (cut && i === segs - 1 ? 0.6 : 1);
    q = [q[0] + dir[0] * stp, q[1] + dir[1] * stp, q[2] + dir[2] * stp];
  }
  const i0 = b.I.length, n = segs - r0;
  for (let i = 0; i < n; i++) { const a = v0 + i * 2; b.t(a, a + 2, a + 1); b.t(a + 1, a + 2, a + 3); }
  b.smooth(v0, i0);
}

// One plant: random age, stipe count, lean, curvature. Blades alternate up every stipe at irregular
// spacing (clusters, gaps, lost blades), each on a gas bladder (pneumatocyst); stipes that reach the
// surface run along it as a canopy of long drooping blades. Old plants are tattered.
function kelpPlant(seed, H, lod = 0) {
  const b = new Builder(), rng = mulberry32(seed);
  const age = rng(), amp = 0.9 * Math.min(1, H / 14) + 0.25;
  const swAt = (y) => amp * Math.pow(sat(y / H), 1.3);
  const hue = [0.92 + rng() * 0.2, 0.9 + rng() * 0.2, 0.8 + rng() * 0.4];
  // fronds stream downcurrent, along +x, the surge axis of the sway shader: the whole forest leans one way
  const cur = (rng() - 0.5) * 1.1, cdx = Math.cos(cur), cdz = Math.sin(cur);
  // holdfast: a low tangled dome (icosphere detail 1: detail 2 spent 320 triangles on a 0.3 m lump)
  const hf = 0.28 + age * 0.3;
  b.blob(1, (x, y, z, o) => {
    const d = 1 + 0.4 * Math.sin(x * 7 + seed) * Math.sin(z * 6) + 0.25 * vn3(x * 3, y * 3, z * 3, seed);
    o[0] = x * hf * d; o[1] = Math.max(0, y) * hf * 0.75 + 0.02; o[2] = z * hf * d;
    const c = 0.55 + 0.25 * vn3(x * 5, y * 5, z * 5, seed + 1);
    o[3] = STIPE[0] * c; o[4] = STIPE[1] * c; o[5] = STIPE[2] * c; o[6] = 0; o[7] = 1;
  });
  // fronds: old plants carry many (a bundle of stipes); some young ones stop short of the surface
  const nSt = lod ? 2 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * (1.5 + age * 3.5));
  for (let k = 0; k < nSt; k++) {
    const reach = rng() < 0.15 + 0.35 * (1 - age) ? 0.4 + rng() * 0.5 : 1;
    const top = reach < 1 ? H * reach : H - 0.25 - rng() * 0.3;
    const la = rng() * TAU, lean = 0.04 + rng() * 0.12, cd = [Math.cos(la) * 0.4 + cdx * 0.6, Math.sin(la) * 0.4 + cdz * 0.6];
    const cf = 0.2 + rng() * 0.6, ca = 0.05 + rng() * 0.25, cph = rng() * 10, cph2 = rng() * 10;
    let p = [(rng() - 0.5) * hf, 0.15, (rng() - 0.5) * hf];
    const pts = [p], step = lod ? 1.6 : 0.85 + rng() * 0.3;
    while (p[1] < top - step) {
      const y = p[1] + step * (0.8 + 0.4 * rng());
      p = [p[0] + ca * Math.sin(y * cf + cph) * step + cd[0] * lean * step, y, p[2] + ca * Math.sin(y * cf * 0.9 + cph2) * step + cd[1] * lean * step];
      pts.push(p);
    }
    const nTop = pts.length;
    if (reach === 1) { // canopy: the frond turns and runs 3-8 m along the surface, downcurrent
      const lc = 3 + rng() * 5, nc = lod ? 3 : 5 + Math.floor(rng() * 3), ca2 = cur + (rng() - 0.5) * 1.6;
      for (let i = 1; i <= nc; i++) { p = [p[0] + Math.cos(ca2) * lc / nc + (rng() - 0.5) * 0.4, top + 0.08 * Math.sin(i * 1.7 + cph), p[2] + Math.sin(ca2) * lc / nc + (rng() - 0.5) * 0.4]; pts.push(p); }
    }
    const r0 = (lod ? 0.045 : 0.025 + 0.02 * age) * (0.85 + 0.3 * rng());
    b.tube(pts, pts.map((q, i) => r0 * (1 - 0.4 * i / pts.length)), 3, (v, a, x, y, z, o) => {
      const c = 0.75 + 0.35 * sat(y / H); o[3] = STIPE[0] * c * hue[0]; o[4] = STIPE[1] * c * hue[1]; o[5] = STIPE[2] * c; o[6] = swAt(y); o[7] = 1;
    });
    // blades: walk the stipe with irregular gaps, clusters and missing blades, alternating sides, each
    // streaming downcurrent and buoyed up by its bladder; along the surface they lie flat in a dense mat
    let acc = rng() * 0.5 + 0.3, az = rng() * TAU;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      acc -= seg;
      while (acc <= 0) {
        const canopy = i >= nTop;
        acc += (lod ? (canopy ? 0.45 : 0.8) : canopy ? 0.2 : 0.36) + Math.pow(rng(), 2.2) * (lod ? 1.0 : 0.45);
        az += Math.PI + (rng() - 0.5) * 1.2;
        if (rng() < 0.05 + 0.15 * age) continue; // lost blade
        const t = rng(), q = [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t), lerp(pts[i - 1][2], pts[i][2], t)];
        const up = canopy ? -0.08 - rng() * 0.25 : 0.35 + rng() * 0.7;
        const cs = canopy ? 0.3 : 0.75; // downcurrent pull
        const d = [Math.cos(az) * (1 - cs * 0.6) + cdx * cs, up, Math.sin(az) * (1 - cs * 0.6) + cdz * cs], l = Math.hypot(...d);
        const bl = lod ? 0 : 0.03 + rng() * 0.02;
        const bp = [q[0] + d[0] / l * (0.02 + bl * 2.2), q[1] + d[1] / l * (0.02 + bl * 2.2), q[2] + d[2] / l * (0.02 + bl * 2.2)];
        const sw = swAt(q[1]);
        const young = 1 - 0.35 * (1 - age) * (1 - q[1] / H);
        const L = (canopy ? 1.35 : 0.9) * (0.7 + rng() * 0.6) * young + (lod ? 0.35 : 0);
        const W = (canopy ? 0.13 : 0.11) * (0.75 + rng() * 0.6) * (lod ? 1.45 : 1);
        const hb = 0.85 + rng() * 0.3, gb = rng() * 0.15;
        const col = [BLADE[0] * hue[0] * hb * (1 - gb), BLADE[1] * hue[1] * hb, BLADE[2] * hue[2] * hb * (1 + gb)];
        blade(b, rng, bp, [d[0] / l, d[1] / l, d[2] / l], L, W, sw, sw + 0.12 + rng() * 0.15, canopy ? 0.05 + rng() * 0.1 : 0.06 + rng() * 0.12,
          col, rng() < age * 0.6, lod ? 2 : 3, bl, canopy);
      }
    }
  }
  b.band = 0.08; // only the holdfast disc counts as the contact band (stipes rise from it)
  const t = b.build();
  t.label = H > 8 ? 'Giant kelp' : 'Young giant kelp';
  return t;
}

export function initKelp() {
  const HS = [5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
  T.kelp = HS.flatMap((H, i) => [kelpPlant(10 + i * 7, H), kelpPlant(11 + i * 7, H * (0.93 + 0.1 * (i % 3)))]);
  T.kelpLo = HS.map((H, i) => kelpPlant(500 + i * 7, H, 1));
  // true horizontal reach of each plant below its canopy (stipe drift + blades), for the tube test
  for (const t of [...T.kelp, ...T.kelpLo]) {
    let r = 0;
    for (let i = 0; i < t.vc; i++) if (t.pos[i * 3 + 1] < t.maxY * 0.85) r = Math.max(r, Math.hypot(t.pos[i * 3], t.pos[i * 3 + 2]));
    t.rLow = r;
  }
  T.understory = [1, 2].map((s) => grassPatch(40 + s, { n: 7, r: 0.35, h: 0.5, w: 0.05, segs: 3, base: [0.12, 0.09, 0.03], mid: [0.35, 0.26, 0.07], tipc: [0.45, 0.36, 0.1], sway: 0.25 }));
  // low red seaweeds of the understory: short, broad, frilly fronds in wine red to coral pink
  T.kelpRed = [1, 2].map((s) => grassPatch(60 + s, { n: 9, r: 0.18, h: 0.3, w: 0.045, segs: 2, base: [0.2, 0.03, 0.04], mid: [0.5, 0.09, 0.1], tipc: [0.66, 0.22, 0.2], sway: 0.2 }));
}

const S = {};
function specs() {
  if (S.rock) return S;
  Object.assign(S, {
    rock: { tpl: T.rocks, scale: [0.6, 2.4], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.5, tint: tintFrom([[0.38, 0.36, 0.33], [0.32, 0.33, 0.3]]) },
    holdRock: { tpl: T.rocks, scale: [0.9, 1.7], ys: [0.45, 0.8], xz: 0.4, grow: [0.6, 1.5], follow: 0.6, tint: tintFrom([[0.4, 0.36, 0.3], [0.36, 0.34, 0.3], [0.45, 0.33, 0.33]]) },
    boulder: { tpl: T.mound, scale: [1.2, 2.8], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.3, tint: tintFrom([[0.36, 0.34, 0.3]]), sink: 0.15 },
    // temperate (California) species: short-spined purple urchins, giant green and strawberry anemones
    urchin: { tpl: T.tpUrchin, scale: [0.05, 0.085], follow: 0.85, tint: tintFrom([[1, 1, 1], [0.85, 0.7, 0.95], [1.1, 0.75, 0.9]], 0.12) },
    star: { tpl: T.star, scale: [0.1, 0.2], follow: 0.95, sink: 0, tint: tintFrom([[0.85, 0.3, 0.06], [0.5, 0.2, 0.55], [0.75, 0.12, 0.1]]) },
    anem: { tpl: T.tpAnemGreen, scale: [0.6, 1.1], follow: 0.8, sway: true, tint: tintFrom([[1, 1, 1], [0.85, 1.05, 0.9]], 0.12) },
    anemS: { tpl: T.anem, scale: [0.35, 0.6], follow: 0.8, sway: true, tint: tintFrom([[1.1, 0.32, 0.38], [1.05, 0.42, 0.5], [1.15, 0.5, 0.42]], 0.1), lbl: 'Strawberry anemone',
      fact: 'Strawberry anemones are not true anemones but corallimorphs, cloning themselves into bright carpets.' },
    sponge: { tpl: T.tubeSp, scale: [0.5, 1.0], follow: 0.5, sink: 0.05, tint: tintFrom([[0.7, 0.45, 0.15], [0.55, 0.25, 0.4]]) },
    bendRock: { tpl: T.bigRocks || [...T.mound, ...T.pinnacle], scale: [1.4, 2.2], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.2, sink: 0.25, tint: tintFrom([[0.42, 0.38, 0.34], [0.38, 0.36, 0.33]]) },
    pebbles: { tpl: T.pebbles, scale: [0.8, 1.6], follow: 1, sink: 0.02, tint: tintFrom([[0.6, 0.58, 0.55], [0.55, 0.5, 0.45]], 0.1) },
    algae: { tpl: T.algae, scale: [0.6, 1.5], follow: 1, sink: 0.01, tint: tintFrom([[0.9, 0.45, 0.5], [0.7, 0.55, 0.3], [0.55, 0.6, 0.3]], 0.12) },
    lump: { tpl: T.spongeLump, scale: [0.8, 1.6], follow: 0.7, tint: tintFrom([[0.85, 0.55, 0.2], [0.8, 0.3, 0.3], [0.7, 0.65, 0.4]]) },
    under: { tpl: T.understory, scale: [0.8, 1.6], follow: 0.6, sway: true, tint: tintFrom([[1, 1, 1]], 0.2) },
    red: { tpl: T.kelpRed, scale: [0.8, 1.6], follow: 0.9, sink: 0.04, sway: true, tint: tintFrom([[1, 1, 1], [1.1, 0.8, 1.05], [0.9, 1.1, 0.8]], 0.15), lbl: 'Red seaweed' },
  });
  S.micro = [{ w: 3, spec: S.pebbles }, { w: 2.2, spec: S.algae }, { w: 1.4, spec: S.lump }];
  S.palm = { tpl: T.seaPalm, scale: [0.8, 1.5], follow: 0.3, sway: true, tint: tintFrom([[1, 1, 1], [1.1, 0.95, 0.8]], 0.15) };
  S.barrenUrchin = { tpl: T.tpUrchin, scale: [0.055, 0.095], follow: 0.85, tint: tintFrom([[1, 1, 1], [0.85, 0.7, 0.95], [1.1, 0.75, 0.9]], 0.15),
    fact: 'Where otters and sunflower stars disappear, purple urchins mow kelp forests down to bare "barrens".' };
  S.barrenRock = { ...S.rock, tint: tintFrom([[0.85, 0.5, 0.6], [0.75, 0.45, 0.55]], 0.12), grow: [1.2, 1.8] };
  S.barrenList = [{ w: 9, k: 'barrenUrchin' }, { w: 1.5, k: 'barrenRock' }, { w: 0.6, k: 'star' }];
  S.palmList = [{ w: 4, k: 'palm', sway: true }, { w: 2, k: 'rock' }, { w: 1.5, k: 'under', sway: true }, { w: 1, k: 'urchin' }, { w: 0.5, k: 'anem', sway: true }, { w: 0.5, k: 'anemS', sway: true }];
  S.floorList = [
    { w: 3, k: 'rock' }, { w: 1.6, k: 'under', sway: true }, { w: 1.6, k: 'red', sway: true }, { w: 1.5, k: 'urchin' }, { w: 1, k: 'star' },
    { w: 0.5, k: 'anem', sway: true }, { w: 0.5, k: 'anemS', sway: true }, { w: 0.6, k: 'sponge' }, { w: 0.5, k: 'boulder' },
  ];
  return S;
}

// ---------- per-segment stands (biomes.js KELP_STANDS: old growth, mixed, young, stalked-kelp grove, barren) ----------
// The same fields drive the floating canopy in the sky map, so light shafts fall where the canopy is open.
const kelpSeg = (ctx) => ctx.segments.find((g) => g.key === 'kelp');
const segAt = (ctx, s) => ctx.segments.find((g) => g.key === 'kelp' && s >= g.start && s < g.end) || kelpSeg(ctx);
function community(ctx) {
  const seg = kelpSeg(ctx);
  return seg ? kelpStand(seg) : kelpStand(null);
}
// per-segment set pieces: a sunlit clearing, arches every 300-700 m
const segSets = new Map();
function kelpSet(ctx, seg) {
  let S = segSets.get(seg.id);
  if (S && S.seed === seg.seed) return S;
  const rng = mulberry32(seg.seed ^ 0xc1ea2), C = kelpClearing(seg);
  rng(); rng(); rng(); // (the clearing's three draws)
  S = { seed: seg.seed, clear: { s: C.s, x: ctx.pathX(C.s) + C.dx, r: C.r }, arches: [] };
  for (let a = seg.start + 200 + rng() * 200; a < seg.end - 160; a += 300 + rng() * 400) S.arches.push({ s: a, k: (rng() * 1e9) | 0 });
  segSets.set(seg.id, S);
  if (segSets.size > 24) segSets.delete(segSets.keys().next().value);
  return S;
}

export function layoutKelp(ctx) {
  if (presence(ctx, 'kelp') <= 0) return null;
  const sp = specs(), rng = ctx.rng, fs = floorSampler(ctx), comm = community(ctx), tk = tierK(ctx);
  const bk = budgetK(ctx, 'kelp');
  const kb = new Batch(MAT.sway, 120000 * bk, 'mid'), st = new Batch(MAT.static, 26000 * bk);
  const idx = Math.floor(ctx.s0 / 64), clears = [], more = [];
  // set pieces first, so holdfasts can grip them
  for (const seg of ctx.segments) {
    if (seg.key !== 'kelp') continue;
    const S = kelpSet(ctx, seg);
    clears.push(S.clear);
    for (const a of S.arches) if (Math.floor((a.s + 3) / 64) === idx) more.push(() => placeArch(ctx, fs, st, null, mulberry32(a.k), a.s, T.arch));
    if (S.clear.s >= ctx.s0 && S.clear.s < ctx.s1) {
      const c = S.clear, y = fs.at(c.x, c.s);
      poi(ctx, 'kelp-clearing', c.x, y + 4, c.s, c.r, { community: comm.name });
      if (ctx.addLabel) ctx.addLabel('Kelp clearing', c.x, y + 1.5, c.s, 'Gaps open where storms tear out old plants; sunlight floods in and young kelp races upward.');
    }
  }
  for (const b of bendSpots(ctx)) {
    if (rng() > ctx.weightOf(b.s, 'kelp') * 0.8) continue;
    more.push(() => {
      const x = putBend(ctx, fs, st, sp.bendRock, b, rng);
      if (x !== null) for (let j = 0; j < 4; j++) putFloor(ctx, fs, st, sp.rock, x + (rng() - 0.5) * 6, b.s + (rng() - 0.5) * 6, rng, 0.7);
    });
  }
  if (rng() < 0.15) more.push(...placeLedge(ctx, fs, st, rng, T.ledge)); // rarer here: kelp grips open rock
  const plants = [];
  // two passes: the walls of the aisle (0-26 m, where the camera sees each plant) and the forest behind them
  // (16-44 m, cheap far plants that read as silhouettes in the green haze)
  const nearP = clusterer(ctx, rng, 0, 26, 1.1, { r: [1, 5], n: [3, 12] });
  const farP = clusterer(ctx, rng, 16, 44, 1.0, { r: [2, 7], n: [4, 12], single: 0.1 });
  const nNear = Math.round(250 * comm.plants);
  // the stipes leave a winding avenue 3-7 m wide (their blades still stream into it): the camera flies down an
  // aisle between groves, not through a random scatter
  const aisle = (s) => 1.5 + 2.2 * (0.5 + 0.5 * noise1(s / 45, 307));
  // the low tier thins the forest away from the path only: thinned near it too, the camera crossed 20-30 m of bare
  // sand between groves, where murky kelp water hid the next one
  for (let k = 0; k < nNear + 110 * comm.plants; k++) {
    const p = k < nNear ? nearP() : farP();
    if (!p || (tk < 1 && p.d > 10 && rng() > tk * 0.75)) continue;
    if (p.d < aisle(p.s) && rng() < 0.85) continue;
    // groves (dense where the canopy is: the same field shades the sky map), barren patches and the clearing
    // (fewer under the canopy gaps, so the shafts fall between plants)
    const g = segAt(ctx, p.s), grove = g ? kelpGrove(p.x, p.s, g, p.x - ctx.pathX(p.s)) : 0.5;
    if (rng() > ctx.weightOf(p.s, 'kelp') * (0.12 + 1.05 * grove) * (0.35 + 0.65 * kelpHole(p.x, p.s))) continue;
    if (clears.some((c) => (p.x - c.x) ** 2 + (p.s - c.s) ** 2 < c.r * c.r)) continue;
    plants.push(p);
  }
  plants.sort((a, b) => a.d - b.d);
  const grow = (list) => { for (const p of list) {
    const y0 = fs.at(p.x, p.s);
    let H = ctx.surfaceY - 0.35 - y0;
    if (rng() > comm.tall) H *= 0.4 + 0.45 * rng(); // young plants still growing toward the light
    if (H < 3.5) continue;
    const lod = p.d > 13, pool = lod ? T.kelpLo : T.kelp;
    const cands = pool.filter((t) => H / t.maxY > 0.8 && H / t.maxY < 1.25);
    let tpl = cands.length ? rng.pick(cands) : pool.reduce((a, t) => (Math.abs(t.maxY - H) < Math.abs(a.maxY - H) ? t : a));
    const sy = H / tpl.maxY;
    if (sy < 0.6 || sy > 1.6) continue;
    const sx = 0.9 + rng() * 0.3;
    // kelp is soft: the camera may fly through the forest, only the lens radius stays clear
    if (!tubeClear(ctx, p.x, p.s, y0, y0 + H + 0.5, tpl.rLow * sx + 0.2, 0.1, LENS)) continue;
    const R = rotY(rng() * TAU), c = 0.85 + rng() * 0.3;
    // rocky reef: many holdfasts grip a boulder (placed first, so the plant seats on top of it)
    if (!lod && rng() < 0.5) putFloor(ctx, fs, st, sp.holdRock, p.x + (rng() - 0.5) * 0.8, p.s + (rng() - 0.5) * 0.8, rng);
    // the whole contact band (not the few-point hull): a holdfast on a rounded boulder floated at its rim
    const y = groundY(fs, p.x, p.s, tpl, R, sx, sy, sx, false, true) - 0.06; // holdfast gripping floor or rock
    if (!kb.add(tpl, p.x, y, -(p.s - ctx.s0), R, sx, sy, sx, c, c * (0.95 + rng() * 0.1), c * (0.85 + rng() * 0.2), 1)) break;
    kb.last.g = 1;
    if (!lod && rng() < 0.25) putFloor(ctx, fs, st, sp.rock, p.x + (rng() - 0.5) * 2.5, p.s + (rng() - 0.5) * 2.5, rng, 0.6);
  } };
  // plants a few per step, nearest first
  for (let q = 0; q < plants.length; q += 4) { const part = plants.slice(q, q + 4); more.push(() => grow(part)); }
  // sunbeams falling through the canopy gaps near the path: 'cathedral windows'. The sky map darkens the floor
  // and the god rays under the same canopy field (biomes.js kelpCover), so the beams land in pools of light.
  const extra = [];
  more.push(() => {
    const g = segAt(ctx, ctx.s0 + 32);
    if (!g || ctx.weightOf(ctx.s0 + 32, 'kelp') < 0.5) return;
    const cand = [];
    for (let s = ctx.s0 + 1; s < ctx.s1; s += 2) {
      const px = ctx.pathX(s);
      for (let dx = -17; dx <= 17; dx += 2) {
        const x = px + dx, shade = kelpCover(x, s, g, dx, false); // a gap in a dense canopy, not open water
        if (shade > 0.45 && kelpHole(x, s) < 0.2) cand.push({ x, s, k: shade + rng() * 0.3 - Math.abs(dx) * 0.012 });
      }
    }
    cand.sort((a, b) => b.k - a.k);
    const beams = [], nMax = ctx.tier === 'low' ? 6 : 10; // (two cylinders per beam)
    for (const c of cand) {
      if (beams.length >= nMax) break;
      if (beams.some((b) => (b.x - c.x) ** 2 + (b.s - c.s) ** 2 < 64)) continue;
      const r0 = 0.8 + rng() * 1.0, yBot = fs.at(c.x, c.s) - 0.3, ph = rng();
      beams.push({ x: c.x, s: c.s, yTop: ctx.surfaceY - 0.05, yBot, r0, ph }, { x: c.x, s: c.s, yTop: ctx.surfaceY - 0.05, yBot, r0: r0 * 0.45, ph: ph + 0.37 }); // + a brighter core
    }
    const m = shaftMesh(ctx, beams, U.uSunDir.value);
    if (m) extra.push(m);
  });
  return { batches: [st, kb], more, extra };
}

// second chain: floor micro detail and understory life (near), small rocks (mid)
export function layoutKelpFloor(ctx) {
  if (presence(ctx, 'kelp') <= 0) return null;
  const sp = specs(), rng = mulberry32((ctx.s0 * 2246822519) ^ 0x6b3), fs = floorSampler(ctx), bk = budgetK(ctx, 'kelp'), tk = tierK(ctx), comm = community(ctx);
  const st = new Batch(MAT.static, 26000 * bk * tk, 'near'), sw = new Batch(MAT.sway, 14000 * bk * tk, 'near'), mid = new Batch(MAT.static, 12000 * bk * tk, 'mid');
  const more = microSteps(ctx, fs, st, rng, 'kelp', sp.micro, 150, 28, 25);
  const list = comm.urchins ? sp.barrenList : comm.palms ? sp.palmList : sp.floorList;
  const nextP = clusterer(ctx, rng, 0, 36, 1.3, comm.urchins ? { r: [1.5, 6], n: [6, 20], single: 0.05 } : undefined);
  more.push(...steps(Math.round(150 * tk * comm.under), 22, () => {
    const p = nextP();
    if (!p || rng() > ctx.weightOf(p.s, 'kelp')) return;
    const g = segAt(ctx, p.s);
    const e = pickW(rng, g && kelpBarren(p.x, p.s, g, p.x - ctx.pathX(p.s)) > 0.5 ? sp.barrenList : list); // urchin-barren patches
    putFloor(ctx, fs, e.k === 'rock' || e.k === 'boulder' ? mid : e.sway ? sw : st, sp[e.k], p.x, p.s, rng, 0.8 + sstep(4, 30, p.d) * 0.6);
  }));
  return { batches: [mid, st, sw], more };
}
