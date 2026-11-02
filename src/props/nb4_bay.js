// Bioluminescent Bay: a dark, warm mangrove lagoon at night-like light (the ROV lamps are capped near off here).
// Red mangroves fringe it, their prop roots arching from above the water into soft mud; turtle grass grows in
// meadows; upside-down jellyfish rest in the sandy hollows; fallen leaves drift on the surface and settle on the
// bottom. The light comes from life: sea pens and sea pansies glow in fields, and the sediment twinkles with
// dinoflagellates that flare brighter where the camera passes close.
import { Builder, Batch, TAU, presence, budgetK, CHUNK, vn3, sat, sstep, lerp, rotY } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { grassPatch } from './shapes.js';
import { pathCache, clearBox, clearSpine, SOLID, SOFT, seat, put, upTo, mix3, nrm, xf, segFor, recipe, lowK, slice, nbFloor, decalDisc, builderMesh, NBMAT, lab, setBase } from './nb_common.js';
import { poolOf, planned } from './nb2_common.js';
import { Space } from './nb3_common.js';
import { rootTpl, trunkTpl, leafPatch, DROPS } from './mangrove.js';
import { ground } from './nb_shapes.js';
import { NB4, rr, pick, chunkRng, L, once, segSeed } from './nb4_common.js';
import { mulberry32, noise2 } from '../noise.js';

const KEY = 'biobay';
const B = {};

// ---------------------------------------------------------------- glowing animals (NBMAT.glow: aFx.x = glow)
// Sea pen (Pennatulacea): a feather of polyp leaves on a fleshy rachis, its lower stalk anchored in the mud.
function glowPen(seed) {
  const b = new Builder(), rng = mulberry32(seed * 131 + 7), H = 0.28 + rng() * 0.32, lean = (rng() - 0.5) * 0.35, r = 0.011 + rng() * 0.006;
  const col = [[1.0, 0.72, 0.5], [0.95, 0.8, 0.62], [1.0, 0.62, 0.42]][(rng() * 3) | 0];
  const P = (t) => [lean * t * t * H, -0.07 + t * (H + 0.07), 0.02 * Math.sin(t * 4 + seed)];
  const pts = [], rad = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(P(t)); rad.push(r * (1.25 - 0.6 * t)); }
  b.tube(pts, rad, 4, (v, a, x, y, z, o) => { o[3] = col[0] * 0.85; o[4] = col[1] * 0.75; o[5] = col[2] * 0.7; o[6] = 0.3 + 0.6 * v; }, { tip: true });
  const nl = 10 + ((rng() * 7) | 0);
  for (let k = 0; k < nl; k++) {
    const t = 0.3 + 0.65 * (k / nl), p = P(t), Lf = H * 0.24 * Math.sin(Math.PI * (0.15 + 0.85 * (k / nl)));
    for (const sd of [-1, 1]) {
      const tip = [p[0] + 0.25 * Lf, p[1] + 0.35 * Lf, p[2] + sd * Lf], mid = [p[0], p[1] + 0.12 * Lf, p[2]];
      for (const flip of [false, true]) {
        const a = b.v(p[0], p[1], p[2], 0, 0, sd, col[0], col[1], col[2], 1.4, 0), c = b.v(tip[0], tip[1], tip[2], 0, 0, sd, col[0] * 1.1, col[1] * 1.1, col[2] * 1.1, 2.6, 0);
        const d = b.v(mid[0] + 0.02, mid[1] + 0.04, mid[2] + sd * 0.004, 0, 0, sd, col[0], col[1], col[2], 2.0, 0);
        if (flip) b.t(a, d, c); else b.t(a, c, d);
      }
    }
  }
  b.smooth(0, 0);
  const t = b.build();
  setBase(t, [0, -0.07, 0]);
  t.solid = false;
  return lab(t, 'Sea pen', 'Touch a sea pen and a wave of green light ripples along it: a burglar alarm that may summon bigger predators.');
}
// Sea pansy (Renilla): a purple, kidney-shaped disc of polyps lying on the mud, anchored by a short peduncle.
function seaPansy(seed) {
  const b = new Builder(), rng = mulberry32(seed * 977 + 3), R = 0.035 + rng() * 0.03, th = R * 0.28, notch = rng() * TAU;
  b.blob(2, (x, y, z, o) => {
    const da = Math.atan2(z, x) - notch, w = Math.atan2(Math.sin(da), Math.cos(da)), cut = 1 - 0.28 * Math.exp(-w * w * 6); // the kidney notch
    const d = cut * (1 + 0.06 * vn3(x * 5 + seed, 0, z * 5, seed));
    o[0] = x * R * d; o[2] = z * R * d; o[1] = y > 0 ? 0.004 + y * th : 0.004 + y * 0.004;
    const pol = y > 0.2 && vn3(x * 14, y * 3, z * 14, seed + 4) > 0.25; // pale polyps on the upper face
    o[3] = pol ? 0.85 : 0.42; o[4] = pol ? 0.75 : 0.12; o[5] = pol ? 0.8 : 0.5; o[6] = y > 0 ? (pol ? 2.2 : 1.1) + 0.6 * y : 0.3;
  });
  const nx = Math.cos(notch) * R * 0.55, nz = Math.sin(notch) * R * 0.55;
  b.tube([[nx, 0.006, nz], [nx * 1.15, -0.02, nz * 1.15], [nx * 1.25, -0.045, nz * 1.25]], [0.008, 0.007, 0.005], 4, (v, a, x, y, z, o) => { o[3] = 0.55; o[4] = 0.25; o[5] = 0.45; o[6] = 0.1; }, { tip: true });
  const t = b.build();
  const base = [nx * 1.25, -0.045, nz * 1.25];
  for (let k = 0; k < 6; k++) { const a = notch + Math.PI + (k - 2.5) * 0.7; base.push(Math.cos(a) * R * 0.6, 0.0, Math.sin(a) * R * 0.6); }
  setBase(t, base);
  t.solid = false;
  return lab(t, 'Sea pansy (Renilla)', "The sea pansy's glow comes from a light-making enzyme that labs around the world now borrow to tag genes.");
}

// Upside-down jellyfish (Cassiopea): a pale bell lying mouth-up on the mud with eight frilly, algae-brown oral arms
// (a lighter build than the mangrove zone's, which runs to 2.9k triangles)
function cassiopea(seed) {
  const b = new Builder(), rng = mulberry32(seed * 53 + 1), R = 0.1, sp = rng() < 0.5;
  b.blob(1, (x, y, z, o) => {
    const d = 1 + 0.07 * Math.sin(Math.atan2(z, x) * 16);
    o[0] = x * R * d; o[1] = (y < 0 ? y * 0.25 : y * 0.1) * R + 0.025; o[2] = z * R * d;
    const rim = sstep(0.7, 1, Math.hypot(x, z)); o[3] = lerp(0.5, 0.78, rim); o[4] = lerp(0.48, 0.76, rim); o[5] = lerp(0.4, 0.8, rim); o[6] = 0; o[7] = 0;
  });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + rng() * 0.3;
    for (let q = 0; q < 3; q++) {
      const rr2 = R * (0.18 + q * 0.24), s2 = R * (0.15 - q * 0.025), cx = Math.cos(a) * rr2, cz = Math.sin(a) * rr2, cy = 0.036 + 0.012 * Math.sin(q + k);
      b.blob(0, (x, y, z, o) => {
        const d = 1 + 0.35 * vn3(x * 4 + k, y * 4 + q, z * 4, seed);
        o[0] = cx + x * s2 * d; o[1] = cy + y * s2 * d * 0.6; o[2] = cz + z * s2 * d;
        const pale = sp && y > 0.4; o[3] = pale ? 0.7 : 0.27; o[4] = pale ? 0.8 : 0.24; o[5] = pale ? 0.9 : 0.1; o[6] = 0; o[7] = 0;
      });
    }
  }
  const t = ground(b).build();
  t.solid = false;
  return t;
}

// ---------------------------------------------------------------- templates, providers, recipe
export const recipeOf = (g) => recipe(g, 'nb4bb', (g) => {
  const u = (k) => sv(g, 470 + k);
  return {
    trees: 0.7 + 0.6 * u(0), fringe: 15 + 6 * u(1), grass: 0.3 + 1.1 * u(2), cassio: 0.2 + 1.0 * u(3), pens: 0.4 + 1.0 * u(4), pansy: 0.3 + 1.0 * u(5),
    sparkle: 0.6 + 0.8 * u(6), litter: 0.5 + 0.8 * u(7), floats: u(8) > 0.35,
    grassCol: [[L(0x123010), L(0x2e6a1c), L(0x6a6a2a)], [L(0x163812), L(0x3a7a22), L(0x7a7032)], [L(0x10280e), L(0x2a5a1a), L(0x5a5a26)]][Math.floor(u(9) * 3)],
  };
});
export function initBay(tier) {
  B.root = DROPS.map((d, i) => [rootTpl(6100 + i * 7, d, false)]);
  B.rootFar = DROPS.map((d, i) => [rootTpl(6150 + i * 7, d, true)]);
  B.trunk = [trunkTpl(6200), trunkTpl(6201)];
  B.pen = [0, 1, 2, 3, 4].map((i) => glowPen(6300 + i));
  B.pansy = [0, 1, 2, 3].map((i) => seaPansy(6400 + i));
  B.cassio = [0, 1, 2].map((i) => lab(cassiopea(6500 + i), 'Upside-down jellyfish (Cassiopea)', 'It lies bell-down on the bottom so the algae living in its frilly arms can soak up the light.'));
  B.leaves = [leafPatch(6601, 16, 0.4), leafPatch(6602, 24, 0.55), leafPatch(6603, 10, 0.3)];
  B.floatLeaves = [leafPatch(6611, 12, 0.7, true), leafPatch(6612, 8, 0.5, true)];
  lab(B.leaves, 'Fallen mangrove leaves', 'Fallen mangrove leaves feed crabs and microbes, the base of the whole lagoon food web.');
  lab(B.floatLeaves, 'Floating mangrove leaves', null);
  for (const t of [...B.leaves, ...B.floatLeaves]) t.solid = false;
  B.grass = [0, 1, 2].map((i) => turtleGrass(6700 + i, i, [L(0x123010), L(0x2e6a1c), L(0x6a6a2a)]));
  return B;
}
function turtleGrass(seed, k, pal) {
  const t = grassPatch(seed, { n: 12 + (k % 3) * 6, r: 0.3 + (k % 3) * 0.08, h: 0.22 + (k % 4) * 0.05, w: 0.012, segs: 3, base: pal[0], mid: pal[1], tipc: pal[2], sway: 0.14 });
  t.solid = false;
  return lab(t, 'Turtle grass', 'Turtle grass meadows trap silt and keep the bay water clear enough for the glowing plankton to thrive.');
}
export function bayProviders(provide) {
  // prop roots: three per drop height for every segment (each tree mixes them with its own yaw, reach and stretch)
  provide(KEY, 'nb4bbRoot', 12, (seg, k) => once(() => rootTpl(segSeed(seg, k, 0x2545f491), DROPS[k % 4], false))(), 3);
  provide(KEY, 'nb4bbRootFar', 4, (seg, k) => once(() => rootTpl(segSeed(seg, k, 0x6c078965), DROPS[k % 4], true))(), 3);
  provide(KEY, 'nb4bbTrunk', 3, (seg, k) => once(() => trunkTpl(segSeed(seg, k, 0x7feb352d)))(), 3);
  provide(KEY, 'nb4bbPen', 5, (seg, k) => once(() => glowPen(segSeed(seg, k, 0x165667b1)))(), 3);
  provide(KEY, 'nb4bbPansy', 3, (seg, k) => once(() => seaPansy(segSeed(seg, k, 0x27d4eb2f)))(), 3);
  provide(KEY, 'nb4bbGrass', 4, (seg, k) => once(() => turtleGrass(segSeed(seg, k, 0x61c88647), k, recipeOf(seg).grassCol))(), 3);
}

// ---------------------------------------------------------------- plan: the mangrove fringe
const PL = planned(function* (ctx) {
  const Y = slice(2.5), out = { trees: [], roots: [], sp: new Space() };
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return out;
  const rng = chunkRng(ctx, 0xb1a1), fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY);
  for (let k = 0; k < 60; k++) {
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const rc = recipeOf(g), side = rng() < 0.5 ? -1 : 1, d = rc.fringe + Math.pow(rng(), 1.4) * 16, x = pc.x(s) + side * d;
    if (rng() > ctx.weightOf(s, KEY) * rc.trees * bk * 0.6) continue;
    if (out.trees.some((t) => (t.x - x) ** 2 + (t.s - s) ** 2 < 3.2 * 3.2)) continue;
    out.trees.push({ x, s, d, side, g, yb: 0.05 + rng() * 0.4, yaw: rng() * TAU, tpl: pick(rng, poolOf(g, 'nb4bbTrunk', B.trunk, 2)) });
  }
  for (const t of out.trees) {
    if (Y.over()) { yield; Y.reset(); }
    const near = t.d < 24, age = rng(), spreadK = 0.8 + rng() * 0.45, hi = 0.2 + rng() * 0.5;
    const nR = Math.round((near ? 8 + age * 8 : 5 + age * 4) * (ctx.tier === 'low' ? 0.7 : 1));
    let placed = 0;
    for (let k = 0; k < nR; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const yaw = rng() * TAU, fromBranch = rng() < 0.2, ya = fromBranch ? 0.8 + rng() * 1.0 : t.yb + hi + Math.pow(rng(), 0.8) * 1.1;
      const aa = fromBranch ? rng() * TAU : yaw, ra = fromBranch ? 0.7 + rng() * 1.8 : t.tpl.nbR * 0.55;
      const xa = t.x + Math.cos(aa) * ra, sa = t.s + Math.sin(aa) * ra, D = ya - fs.at(xa, sa);
      if (D < 1.0) continue;
      let di = 0; for (let i = 1; i < DROPS.length; i++) if (Math.abs(DROPS[i] - D) < Math.abs(DROPS[di] - D)) di = i;
      const list = near ? poolOf(t.g, 'nb4bbRoot', null, 8) : poolOf(t.g, 'nb4bbRootFar', null, 3);
      const set = list ? list.filter((q) => q.nbDrop === DROPS[di]) : [];
      const tpl = set.length ? pick(rng, set) : (near ? B.root : B.rootFar)[di][0];
      let k2 = spreadK * (0.85 + rng() * 0.3), ok = false, sy = 1;
      const R = rotY(yaw);
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        if (attempt) k2 *= 0.84;
        sy = 0;
        for (const tp of tpl.nbTips) { // vertical stretch so that every tip enters the mud by 15 cm
          const o = xf(R, k2, 1, k2, tp[0], 0, tp[2]);
          sy = Math.max(sy, (ya - fs.at(xa + o[0], sa - o[2]) + 0.15) / -tp[1]);
        }
        if (sy < 0.55 || sy > 1.7 || k2 < 0.62) break;
        const sp = tpl.nbSpine, pts = [];
        for (let i = 0; i < sp.length; i += 4) { const o = xf(R, k2, sy, k2, sp[i], sp[i + 1], sp[i + 2]); pts.push(xa + o[0], ya + o[1], sa - o[2], sp[i + 3] * k2); }
        ok = clearSpine(pc, pts, SOLID, 0.3);
      }
      if (!ok) continue;
      out.roots.push({ tpl, x: xa, y: ya, s: sa, R, sx: k2, sy, sz: k2, near, tree: t });
      placed++;
    }
    t.placed = placed;
    if (placed) out.sp.add(t.x, t.s, 2.6);
  }
  return out;
});
const plan = (ctx) => PL.get(ctx);
export function layoutBbP(ctx) { return presence(ctx, KEY) > 0 ? PL.stage(ctx) : null; }

// ---------------------------------------------------------------- chain A: trees and roots
export function* layoutBbA(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const P = plan(ctx), pc = pathCache(ctx), surf = ctx.surfaceY, rng = chunkRng(ctx, 0xb1a2);
  const st = new Batch(MAT.static, 80000 * budgetK(ctx, KEY)), fl = new Batch(MAT.sway, 6000); fl.soft = true; fl.lod = 'mid';
  const roots = P.roots.slice().sort((p, q) => Math.abs(p.x - pc.x(p.s)) - Math.abs(q.x - pc.x(q.s))); // the channel side first
  for (const r of roots) { if (Y.over()) { yield; Y.reset(); } put(ctx, st, r.tpl, r.x, r.y, r.s, r.R, r.sx, r.sy, r.sz, [1, 1, 1], 1, 'floor'); }
  for (const t of P.trees) if (t.placed) put(ctx, st, t.tpl, t.x, t.yb, t.s, rotY(t.yaw), 1, 1, 1, [1, 1, 1], 1, 'roots');
  // leaves drifting at the surface off the fringe
  for (const t of P.trees) {
    if (!t.placed || rng() > (recipeOf(t.g).floats ? 0.7 : 0.25)) continue;
    const x = t.x - t.side * (2 + rng() * 6), s = t.s + (rng() - 0.5) * 5;
    put(ctx, fl, pick(rng, B.floatLeaves), x, surf - 0.012, s, rotY(rng() * TAU), 0.8 + rng() * 0.6, 1, 0.8 + rng() * 0.6, [1, 1, 1], 0, 'surface');
  }
  const near = P.trees.filter((t) => t.placed).sort((a, b) => a.d - b.d);
  const labels = near.slice(0, 1).map((t) => ['Red mangrove prop roots', t.x - t.side * 1.2, -1.0, t.s, 'Prop roots hold mangroves up in soft mud and shelter the young fish of the bay.']);
  const pois = near.slice(0, 2).map((t) => ({ type: 'mangrove-roots', x: t.x - t.side * 1.6, y: -1.4, s: t.s, r: 3, data: { name: 'Mangrove roots' } }));
  return { batches: [st, fl], labels, pois };
}

// ---------------------------------------------------------------- chain B: the lagoon floor
export function* layoutBbB(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), pc = pathCache(ctx), fs = nbFloor(ctx), surf = ctx.surfaceY;
  const rng = chunkRng(ctx, 0xb1a3), g0 = segFor(ctx, ctx.s0 + 32, KEY), rc0 = recipeOf(g0);
  const st = new Batch(MAT.static, 24000 * bk * lk); st.lod = 'near';
  const gr = new Batch(MAT.sway, 30000 * bk * lk); gr.lod = 'mid'; gr.soft = true; gr.jobVerts = 12000;
  const gl = new Batch(NBMAT.glow, 22000 * bk * lk); gl.lod = 'mid'; gl.soft = true;
  const sp = P.sp, labels = [], pois = [];
  const floorPut = (b, tpl, x, s, sc, col, follow, embed, fa, kind) => {
    const y = fs.at(x, s);
    if (y > surf - 0.6) return false;
    const n = [fs.nx * follow, 1 - follow + fs.ny * follow, fs.nz * follow], R = upTo(nrm(n), rng() * TAU), Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, embed);
    if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + (tpl.maxY - tpl.minY) * sc, (tpl.nbR || tpl.r) * sc, kind)) return false;
    return put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
  };
  const lateral = (a, b, k = 1.3) => (rng() < 0.5 ? -1 : 1) * (a + Math.pow(rng(), k) * (b - a));
  // turtle grass in meadows (noise-shaped), thinning toward the fringe
  const nG = Math.round(240 * rc0.grass * bk * lk);
  for (let k = 0; k < nG * 2 && k < 700; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const x = pc.x(s) + lateral(0.5, 22, 1.2), m = sstep(-0.15, 0.35, noise2(x / 9, s / 9, 471));
    if (rng() > ctx.weightOf(s, KEY) * m) continue;
    const tpl = pick(rng, poolOf(g, 'nb4bbGrass', B.grass, 2)), sc = 0.8 + rng() * 0.6;
    if (!sp.free(x, s, tpl.r * sc * 0.6)) continue;
    if (floorPut(gr, tpl, x, s, sc, [0.85 + rng() * 0.3, 0.9 + rng() * 0.2, 0.85 + rng() * 0.25], 0.4, 0.03, sc, SOFT)) sp.add(x, s, tpl.r * sc * 0.5);
  }
  yield;
  // sea-pen and sea-pansy fields: clustered, glowing; the densest near the route are points of interest
  const nP = Math.round(5.5 * rc0.pens * bk + rng() * 2);
  for (let f = 0; f < nP; f++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 4 + rng() * (CHUNK - 8), g = segFor(ctx, s, KEY);
    if (!g || rng() > ctx.weightOf(s, KEY)) continue;
    const x = pc.x(s) + lateral(0.5, 16, 1.5), R0 = 1.8 + rng() * 3.5, pansy = rng() < rc0.pansy * 0.45, n = Math.round((pansy ? 26 : 18) + rng() * 26);
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU, d = R0 * Math.sqrt(rng()), px = x + Math.cos(a) * d, ps = s + Math.sin(a) * d;
      const tpl = pansy ? pick(rng, poolOf(g, 'nb4bbPansy', B.pansy, 2)) : pick(rng, poolOf(g, 'nb4bbPen', B.pen, 2)), sc = pansy ? 0.8 + rng() * 0.6 : 0.75 + rng() * 0.6;
      if (!sp.free(px, ps, tpl.r * sc * 0.6)) continue;
      if (floorPut(gl, tpl, px, ps, sc, [0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 0.9 + rng() * 0.2], pansy ? 0.9 : 0.15, 0.015, 0.75 + rng() * 0.5, SOFT)) { sp.add(px, ps, tpl.r * sc * 0.5); placed++; }
    }
    if (placed > 6 && Math.abs(x - pc.x(s)) < 12) {
      pois.push({ type: 'glow-field', x, y: fs.at(x, s) + 0.8, s, r: R0, data: { name: pansy ? 'Sea pansies' : 'Glowing sea pens' } });
      if (!labels.length) labels.push(['Bioluminescence', x, fs.at(x, s) + 0.4, s, 'In a bioluminescent bay a litre of water can hold more than a hundred thousand dinoflagellates, each flashing blue-green when disturbed.']);
    }
  }
  yield;
  // upside-down jellyfish in pale sandy hollows; fallen leaves everywhere, thickest under the fringe
  const dec = new Builder(), spk = new Builder();
  for (let k = 0; k < 5; k++) {
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + lateral(0, 12);
    if (rng() > ctx.weightOf(s, KEY) * rc0.cassio) continue;
    const rx = 1.0 + rng() * 2.0, rz = rx * (0.6 + rng() * 0.5);
    decalDisc(dec, fs, ctx, x, s, rx, rz, rng() * TAU, [0.3, 0.27, 0.2], 0, 0.75, 5, 18);
    for (let j = 2 + Math.floor(rng() * 6); j > 0; j--) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * rx * 0.75, px = x + Math.cos(a) * d, ps = s + Math.sin(a) * d * (rz / rx);
      if (sp.free(px, ps, 0.15)) { floorPut(st, pick(rng, B.cassio), px, ps, 0.9 + rng() * 0.9, [1, 1, 1], 1, 0.01, 1, SOFT); sp.add(px, ps, 0.15); }
    }
  }
  for (let k = 0; k < 75 * rc0.litter * lk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + lateral(0, 30, 0.9);
    if (rng() > ctx.weightOf(s, KEY) * (0.3 + 0.7 * sstep(6, 20, Math.abs(x - pc.x(s))))) continue;
    floorPut(st, pick(rng, B.leaves), x, s, 0.8 + rng() * 0.6, [1, 1, 1], 1, 0.004, 1, SOFT);
  }
  // dark organic mud; twinkling sediment (the sparkles are their own additive decal)
  for (let k = 0; k < 16 * bk; k++) {
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + lateral(0, 26, 1), r = 2 + rng() * 5;
    decalDisc(dec, fs, ctx, x, s, r, r * (0.5 + rng() * 0.5), rng() * TAU, [0.07, 0.06, 0.04], 3, 0.6, 5, 16);
  }
  for (let k = 0; k < 12 * rc0.sparkle * bk; k++) {
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + lateral(0, 18, 1.4), r = 2.5 + rng() * 5;
    if (rng() > ctx.weightOf(s, KEY)) continue;
    decalDisc(spk, fs, ctx, x, s, r, r * (0.5 + rng() * 0.5), rng() * TAU, [1, 1, 1], 0, 0.6 + rng() * 0.4, 6, 20);
  }
  if (spk.vc) labels.push(['Glowing sediment', pc.x(ctx.s0 + 32), fs.at(pc.x(ctx.s0 + 32), ctx.s0 + 32) + 0.2, ctx.s0 + 32, 'Dinoflagellates settle in the mud by day; stir the bottom and it sparkles.']);
  const extra = [];
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  const sm = spk.vc ? builderMesh(spk, NB4.mat.sparkle, null, 'mid') : null;
  if (sm) { sm.renderOrder = 2; extra.push(sm); }
  return { batches: [st, gr, gl], extra, labels, pois };
}
