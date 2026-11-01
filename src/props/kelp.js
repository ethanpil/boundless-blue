// Giant kelp forest: stipes rise from holdfasts to the surface, carrying blades on gas bladders,
// and spread into a floating canopy. Sway (style 1) grows with height so bases stay anchored.
import { Builder, Batch, T, TAU, vn3, sat, sstep, lerp, floorSampler, presence, tubeClear, orient, budgetK, bendSpots, LENS, rotY, tierK, poi } from './core.js';
import { grassPatch } from './shapes.js';
import { putFloor, pickW, tintFrom, spot, putBend, microDetail, microSteps, steps, clusterer, groundY } from './scatter.js';
import { placeArch, placeLedge } from './reef.js';
import { MAT } from './materials.js';
import { mulberry32, noise2 } from '../noise.js';

const STIPE = [0.45, 0.32, 0.1], BLADE = [0.8, 0.6, 0.16];

function octa(b, c, rx, ry, rz, col, f0, f1) {
  const v = [
    b.v(c[0] + rx, c[1], c[2], 1, 0, 0, ...col, f0, f1), b.v(c[0] - rx, c[1], c[2], -1, 0, 0, ...col, f0, f1),
    b.v(c[0], c[1] + ry, c[2], 0, 1, 0, ...col, f0, f1), b.v(c[0], c[1] - ry, c[2], 0, -1, 0, ...col, f0, f1),
    b.v(c[0], c[1], c[2] + rz, 0, 0, 1, ...col, f0, f1), b.v(c[0], c[1], c[2] - rz, 0, 0, -1, ...col, f0, f1),
  ];
  const F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
  for (const f of F) b.t(v[f[0]], v[f[1]], v[f[2]]);
}

// one leaf-shaped, corrugated blade from p along direction d (unit): own colour, droop, ruffle, tattering.
// The blade is turned about its axis (tw0) so its broad face shows from the side: kelp blades stream and
// hang in the water, they do not lie flat like shelves (edge-on they read as bare sticks).
function blade(b, rng, p, d, L, W, sw, swTip, droop, col, tatter, segs) {
  const side = [-d[2], 0, d[0]], sl = Math.hypot(side[0], side[2]) || 1;
  side[0] /= sl; side[2] /= sl;
  const k = rng() * 10, ruf = W * (0.15 + 0.4 * rng()), twist = (rng() - 0.5) * 1.4;
  const tw0 = (rng() < 0.5 ? -1 : 1) * (0.55 + rng() * 0.8);
  const notch = tatter ? 1 + Math.floor(rng() * segs) : -1, cut = tatter && rng() < 0.5;
  let q = p.slice(), dir = d.slice();
  const v0 = b.vc;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let w = W * Math.pow(Math.sin(Math.min(1, t * 0.85 + 0.15) * Math.PI), 0.5 + 0.3 * rng());
    if (i === segs) w = cut ? W * 0.5 : W * 0.35; // blunt, rounded tip (lanceolate blade, not a willow leaf)
    if (i === notch) w *= 0.3 + 0.3 * rng();
    // width vector: between the horizontal side and the in-plane normal of the (drooping) blade axis
    const ux = side[1] * dir[2] - side[2] * dir[1], uy = side[2] * dir[0] - side[0] * dir[2], uz = side[0] * dir[1] - side[1] * dir[0];
    const ul = Math.hypot(ux, uy, uz) || 1, tw = tw0 + twist * t, ct = Math.cos(tw), st = Math.sin(tw);
    const wx = side[0] * ct + ux / ul * st, wy = uy / ul * st, wz = side[2] * ct + uz / ul * st;
    // corrugation: rows shift along the blade normal, alternating, so the blade surface undulates
    const nx = wy * dir[2] - wz * dir[1], ny = wz * dir[0] - wx * dir[2], nz = wx * dir[1] - wy * dir[0];
    const rr = ruf * Math.sin(t * 9 + k) * (i ? 1 : 0);
    const c = 0.75 + 0.45 * t * (0.7 + 0.6 * rng());
    const f = lerp(sw, swTip, t);
    b.v(q[0] - wx * w + nx * rr, q[1] - wy * w + ny * rr, q[2] - wz * w + nz * rr, 0, 1, 0, col[0] * c, col[1] * c, col[2] * c, f, 1);
    b.v(q[0] + wx * w + nx * rr, q[1] + wy * w + ny * rr, q[2] + wz * w + nz * rr, 0, 1, 0, col[0] * c, col[1] * c, col[2] * c, f, 1);
    dir = [dir[0], dir[1] - droop * (0.6 + 0.8 * rng()), dir[2]];
    const l = Math.hypot(...dir); dir = dir.map((x) => x / l);
    const stp = (L / segs) * (cut && i === segs - 1 ? 0.6 : 1);
    q = [q[0] + dir[0] * stp, q[1] + dir[1] * stp, q[2] + dir[2] * stp];
  }
  const i0 = b.I.length;
  for (let i = 0; i < segs; i++) { const a = v0 + i * 2; b.t(a, a + 2, a + 1); b.t(a + 1, a + 2, a + 3); }
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
  const hf = 0.25 + age * 0.25;
  b.blob(2, (x, y, z, o) => {
    const d = 1 + 0.4 * Math.sin(x * 7 + seed) * Math.sin(z * 6) + 0.2 * vn3(x * 3, y * 3, z * 3, seed);
    o[0] = x * hf * d; o[1] = Math.max(0, y) * hf * 0.8 + 0.02; o[2] = z * hf * d;
    o[3] = STIPE[0] * 0.7; o[4] = STIPE[1] * 0.7; o[5] = STIPE[2] * 0.7; o[6] = 0; o[7] = 1;
  });
  const nSt = lod ? 1 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * (2 + age * 3.5));
  for (let k = 0; k < nSt; k++) {
    const reach = rng() < 0.2 + 0.4 * (1 - age) ? 0.45 + rng() * 0.45 : 1; // young stipes stop short
    const top = reach < 1 ? H * reach : H - 0.25 - rng() * 0.3;
    const la = rng() * TAU, lean = rng() * 0.18, cd = [Math.cos(la), Math.sin(la)];
    const cf = 0.2 + rng() * 0.6, ca = 0.05 + rng() * 0.3, cph = rng() * 10, cph2 = rng() * 10;
    let p = [(rng() - 0.5) * hf, 0.15, (rng() - 0.5) * hf];
    const pts = [p], step = lod ? 1.4 : 0.6 + rng() * 0.35;
    while (p[1] < top - step) {
      const y = p[1] + step * (0.8 + 0.4 * rng());
      p = [p[0] + ca * Math.sin(y * cf + cph) * step + cd[0] * lean * step, y, p[2] + ca * Math.sin(y * cf * 0.9 + cph2) * step + cd[1] * lean * step];
      pts.push(p);
    }
    const nTop = pts.length;
    if (reach === 1) { // canopy: the frond runs 3-8 m along the surface
      const lc = 3 + rng() * 5, nc = lod ? 3 : 5 + Math.floor(rng() * 4);
      for (let i = 1; i <= nc; i++) { p = [p[0] + cd[0] * lc / nc + (rng() - 0.5) * 0.4, top + 0.08 * Math.sin(i * 1.7 + cph), p[2] + cd[1] * lc / nc + (rng() - 0.5) * 0.4]; pts.push(p); }
    }
    const r0 = (lod ? 0.05 : 0.025 + 0.02 * age) * (0.85 + 0.3 * rng());
    b.tube(pts, pts.map((q, i) => r0 * (1 - 0.4 * i / pts.length)), lod ? 3 : 4, (v, a, x, y, z, o) => {
      const c = 0.75 + 0.35 * sat(y / H); o[3] = STIPE[0] * c * hue[0]; o[4] = STIPE[1] * c * hue[1]; o[5] = STIPE[2] * c; o[6] = swAt(y); o[7] = 1;
    });
    // blades: walk the stipe with irregular gaps, clusters and missing blades, alternating sides
    let acc = rng() * 0.5 + 0.4, az = rng() * TAU;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      acc -= seg;
      while (acc <= 0) {
        const canopy = i >= nTop;
        acc += (lod ? 0.75 : canopy ? 0.16 : 0.22) + Math.pow(rng(), 2.2) * (lod ? 1.6 : 0.6);
        az += Math.PI + (rng() - 0.5) * 1.2;
        if (rng() < 0.06 + 0.18 * age) continue; // lost blade
        const t = rng(), q = [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t), lerp(pts[i - 1][2], pts[i][2], t)];
        const up = canopy ? -0.15 - rng() * 0.5 : 0.7 + rng() * 1.1; // stream upward along the stipe; canopy blades droop
        const d = [Math.cos(az), up, Math.sin(az)], l = Math.hypot(...d);
        const bl = lod ? 0 : 0.035 + rng() * 0.025;
        const bp = [q[0] + d[0] / l * (0.03 + bl), q[1] + d[1] / l * (0.03 + bl), q[2] + d[2] / l * (0.03 + bl)];
        const sw = swAt(q[1]);
        // gas bladder (pneumatocyst) at the base of every blade
        if (!lod) octa(b, [q[0] + d[0] / l * 0.03, q[1] + d[1] / l * 0.03, q[2] + d[2] / l * 0.03], bl * 0.55, bl, bl * 0.55, [STIPE[0] * 1.55, STIPE[1] * 1.5, STIPE[2] * 1.3], sw, 1);
        const young = 1 - 0.35 * (1 - age) * (1 - q[1] / H);
        const L = (canopy ? 1.3 : 0.75) * (0.7 + rng() * 0.7) * young + (lod ? 0.4 : 0);
        const W = (lod ? 0.16 : 0.095) * (0.75 + rng() * 0.6);
        const hb = 0.85 + rng() * 0.3, gb = rng() * 0.15;
        const col = [BLADE[0] * hue[0] * hb * (1 - gb), BLADE[1] * hue[1] * hb, BLADE[2] * hue[2] * hb * (1 + gb)];
        blade(b, rng, bp, [d[0] / l, d[1] / l, d[2] / l], L, W, sw, sw + 0.12 + rng() * 0.15, canopy ? 0.15 + rng() * 0.25 : 0.04 + rng() * 0.12, col, rng() < age * 0.6, lod ? 2 : L > 1.0 ? 4 : 3);
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
}

const S = {};
function specs() {
  if (S.rock) return S;
  Object.assign(S, {
    rock: { tpl: T.rocks, scale: [0.6, 2.4], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.5, tint: tintFrom([[0.38, 0.36, 0.33], [0.32, 0.33, 0.3]]) },
    boulder: { tpl: T.mound, scale: [1.2, 2.8], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.3, tint: tintFrom([[0.36, 0.34, 0.3]]), sink: 0.15 },
    // temperate (California) species: short-spined purple urchins, giant green and strawberry anemones
    urchin: { tpl: T.tpUrchin, scale: [0.05, 0.085], follow: 0.85, tint: tintFrom([[1, 1, 1], [0.85, 0.7, 0.95], [1.1, 0.75, 0.9]], 0.12) },
    star: { tpl: T.star, scale: [0.1, 0.2], follow: 0.95, sink: 0, tint: tintFrom([[0.85, 0.3, 0.06], [0.5, 0.2, 0.55], [0.75, 0.12, 0.1]]) },
    anem: { tpl: T.tpAnemGreen, scale: [0.6, 1.1], follow: 0.8, sway: true, tint: tintFrom([[1, 1, 1], [0.85, 1.05, 0.9]], 0.12) },
    anemS: { tpl: T.anem, scale: [0.35, 0.6], follow: 0.8, sway: true, tint: tintFrom([[1.1, 0.32, 0.38], [1.05, 0.42, 0.5], [1.15, 0.5, 0.42]], 0.1), lbl: 'Strawberry anemone',
      fact: 'Strawberry anemones are not true anemones but corallimorphs, cloning themselves into bright carpets.' },
    sponge: { tpl: T.tubeSp, scale: [0.5, 1.0], follow: 0.5, tint: tintFrom([[0.7, 0.45, 0.15], [0.55, 0.25, 0.4]]) },
    bendRock: { tpl: T.bigRocks || [...T.mound, ...T.pinnacle], scale: [1.4, 2.2], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.2, sink: 0.25, tint: tintFrom([[0.42, 0.38, 0.34], [0.38, 0.36, 0.33]]) },
    pebbles: { tpl: T.pebbles, scale: [0.8, 1.6], follow: 1, sink: 0.02, tint: tintFrom([[0.6, 0.58, 0.55], [0.55, 0.5, 0.45]], 0.1) },
    algae: { tpl: T.algae, scale: [0.6, 1.5], follow: 1, sink: 0.01, tint: tintFrom([[0.9, 0.45, 0.5], [0.7, 0.55, 0.3], [0.55, 0.6, 0.3]], 0.12) },
    lump: { tpl: T.spongeLump, scale: [0.8, 1.6], follow: 0.7, tint: tintFrom([[0.85, 0.55, 0.2], [0.8, 0.3, 0.3], [0.7, 0.65, 0.4]]) },
    under: { tpl: T.understory, scale: [0.8, 1.6], follow: 0.6, sway: true, tint: tintFrom([[1, 1, 1]], 0.2) },
  });
  S.micro = [{ w: 3, spec: S.pebbles }, { w: 2.2, spec: S.algae }, { w: 1.4, spec: S.lump }];
  S.palm = { tpl: T.seaPalm, scale: [0.8, 1.5], follow: 0.3, sway: true, tint: tintFrom([[1, 1, 1], [1.1, 0.95, 0.8]], 0.15) };
  S.barrenUrchin = { tpl: T.tpUrchin, scale: [0.055, 0.095], follow: 0.85, tint: tintFrom([[1, 1, 1], [0.85, 0.7, 0.95], [1.1, 0.75, 0.9]], 0.15),
    fact: 'Where otters and sunflower stars disappear, purple urchins mow kelp forests down to bare "barrens".' };
  S.barrenRock = { ...S.rock, tint: tintFrom([[0.85, 0.5, 0.6], [0.75, 0.45, 0.55]], 0.12), grow: [1.2, 1.8] };
  S.barrenList = [{ w: 9, k: 'barrenUrchin' }, { w: 1.5, k: 'barrenRock' }, { w: 0.6, k: 'star' }];
  S.palmList = [{ w: 4, k: 'palm', sway: true }, { w: 2, k: 'rock' }, { w: 1.5, k: 'under', sway: true }, { w: 1, k: 'urchin' }, { w: 0.5, k: 'anem', sway: true }, { w: 0.5, k: 'anemS', sway: true }];
  S.floorList = [
    { w: 3, k: 'rock' }, { w: 2.5, k: 'under', sway: true }, { w: 1.5, k: 'urchin' }, { w: 1, k: 'star' },
    { w: 0.5, k: 'anem', sway: true }, { w: 0.5, k: 'anemS', sway: true }, { w: 0.6, k: 'sponge' }, { w: 0.5, k: 'boulder' },
  ];
  return S;
}

// ---------- per-segment communities ----------
const COMMUNITIES = [
  { name: 'dense canopy', plants: 1.35, floor: 1.0 },
  { name: 'urchin barren', plants: 0.22, floor: 1.2, urchins: true },
  { name: 'stalked-kelp grove', plants: 0.8, floor: 1.0, palms: 1 },
  { name: 'mixed kelp', plants: 1.0, floor: 1.0 },
];
function community(ctx) {
  const seg = ctx.segments.find((g) => g.key === 'kelp');
  return seg ? COMMUNITIES[Math.floor(mulberry32(seg.seed ^ 0x4e1b)() * COMMUNITIES.length)] : COMMUNITIES[3];
}
// per-segment set pieces: a sunlit clearing, arches every 300-700 m
const segSets = new Map();
function kelpSet(ctx, seg) {
  let S = segSets.get(seg.id);
  if (S && S.seed === seg.seed) return S;
  const rng = mulberry32(seg.seed ^ 0xc1ea2), len = seg.end - seg.start;
  const cs = seg.start + 120 + rng() * Math.max(10, len - 240);
  S = { seed: seg.seed, clear: { s: cs, x: ctx.pathX(cs) + (rng() - 0.5) * 10, r: 8 + rng() * 5 }, arches: [] };
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
  const nextP = clusterer(ctx, rng, 0, 42, 1.55); // densest near the path (the camera flies through the forest)
  for (let k = 0; k < 360 * comm.plants * tk; k++) {
    const p = nextP();
    if (!p) continue;
    const grove = 0.5 + 0.5 * noise2(p.x / 26, p.s / 26, 301);
    if (rng() > ctx.weightOf(p.s, 'kelp') * (0.55 + 0.65 * grove)) continue;
    if (clears.some((c) => (p.x - c.x) ** 2 + (p.s - c.s) ** 2 < c.r * c.r)) continue;
    plants.push(p);
  }
  plants.sort((a, b) => a.d - b.d);
  const grow = (list) => { for (const p of list) {
    const y0 = fs.at(p.x, p.s), H = ctx.surfaceY - 0.35 - y0;
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
    const y = groundY(fs, p.x, p.s, tpl, R, sx, sy, sx) - 0.06; // holdfast gripping floor or rock
    if (!kb.add(tpl, p.x, y, -(p.s - ctx.s0), R, sx, sy, sx, c, c * (0.95 + rng() * 0.1), c * (0.85 + rng() * 0.2), 1)) break;
    kb.last.g = 1;
    if (!lod && rng() < 0.4) putFloor(ctx, fs, st, sp.rock, p.x + (rng() - 0.5) * 2, p.s + (rng() - 0.5) * 2, rng, 0.6);
  } };
  // plants a few per step, nearest first
  for (let q = 0; q < plants.length; q += 4) { const part = plants.slice(q, q + 4); more.push(() => grow(part)); }
  return { batches: [st, kb], more };
}

// second chain: floor micro detail and understory life (near), small rocks (mid)
export function layoutKelpFloor(ctx) {
  if (presence(ctx, 'kelp') <= 0) return null;
  const sp = specs(), rng = mulberry32((ctx.s0 * 2246822519) ^ 0x6b3), fs = floorSampler(ctx), bk = budgetK(ctx, 'kelp'), tk = tierK(ctx), comm = community(ctx);
  const st = new Batch(MAT.static, 26000 * bk * tk, 'near'), sw = new Batch(MAT.sway, 14000 * bk * tk, 'near'), mid = new Batch(MAT.static, 12000 * bk * tk, 'mid');
  const more = microSteps(ctx, fs, st, rng, 'kelp', sp.micro, 150, 28, 25);
  const list = comm.urchins ? sp.barrenList : comm.palms ? sp.palmList : sp.floorList;
  const nextP = clusterer(ctx, rng, 0, 36, 1.3, comm.urchins ? { r: [1.5, 6], n: [6, 20], single: 0.05 } : undefined);
  more.push(...steps(Math.round(150 * tk * comm.floor), 22, () => {
    const p = nextP();
    if (!p || rng() > ctx.weightOf(p.s, 'kelp')) return;
    const e = pickW(rng, list);
    putFloor(ctx, fs, e.k === 'rock' || e.k === 'boulder' ? mid : e.sway ? sw : st, sp[e.k], p.x, p.s, rng, 0.8 + sstep(4, 30, p.d) * 0.6);
  }));
  return { batches: [mid, st, sw], more };
}
