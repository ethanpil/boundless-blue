// Champagne Reef: a shallow volcanic reef where streams of CO2 bubbles rise from cracks in the dark sand
// and between volcanic boulders. Bubble streams are shader-driven (rising, wobbling, shimmering; fine
// fizz and big wobbling burps), vents sit in pale bacterial rings, fissures and sulphur-stained patches
// mark the seeps. Around the vents the water is more acidic: hard corals give way to bare rock, algal
// turf and sponges, then the reef returns a few metres away (brain, boulder and pillar corals, sea fans,
// sea rods, tube and vase sponges, anemones). POI 'champagne-vent' at each big cluster.
import { Batch, TAU, presence, budgetK, CHUNK, T, Builder, sstep, lerp } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { NBMAT, pathCache, clearBox, SOLID, SOFT, seat, put, upTo, mix3, segFor, recipe, lowK, slice, nbFloor, decalDisc, decalRibbon, builderMesh, lab } from './nb_common.js';
import { encrust, featherStar } from './nb_shapes.js';
import { scoria, polypMat } from './nb2_life.js';
import { NB2, pick, tintOf, chunkRng, poolOf, itemSpots, bubbleMesh, Occ, planned, decoOn } from './nb2_common.js';
import { rockJob, drain } from './rock_recipes.js';

const C = {};
export const CH_ROCKS = [
  { r: 'pillow', growth: 0.6 }, { r: 'boulder', litho: 'basalt', kind: 'angular', growth: 0.7 }, { r: 'boulder', litho: 'basalt', growth: 0.8 },
  { r: 'columnar', litho: 'basalt', growth: 0.6 }, { r: 'cracked', litho: 'basalt', growth: 0.6 }, { r: 'pile', lithos: ['basalt'], growth: 0.7 },
];
export function initChampagne() {
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(5100 + i * 29 + o));
  C.scoria = R(6, (s) => scoria(s, { s: 0.6 + (s % 4) * 0.25 }));
  C.rock = R(4, (s) => drain(rockJob(CH_ROCKS[s % CH_ROCKS.length], s)), 1);
  C.enc = R(6, (s) => encrust(s, { r: 0.16 + (s % 4) * 0.06, h: 0.06 + (s % 3) * 0.03, lobes: 0.6, detail: 1, elong: 1 + (s % 3) * 0.3 }), 2);
  C.turf = R(5, (s) => polypMat(s, { n: 10 + (s % 3) * 4, r: 0.18 + (s % 3) * 0.08, size: 0.02, zoanthid: true }), 3);
  C.crin = R(4, (s) => featherStar(s, { arms: 10 + (s % 3) * 3, L: 0.18 + (s % 3) * 0.05, up: 0.5 }), 4);
  lab(C.enc, 'Encrusting sponge', null);
  lab(C.turf, 'Zoanthids', 'Soft-bodied zoanthids cope with the acid water near the seeps better than stony corals do.');
  lab(C.crin, 'Feather star', null);
  for (const t of [...C.crin, ...C.enc, ...C.turf]) t.solid = false;
  return C;
}

const VENT_FACT = 'Volcanic gas seeps up through the sand: 99% carbon dioxide, so the bubbles fizz like champagne.';
const ACID_FACT = 'Near the seeps the water is more acidic; corals struggle here, a glimpse of what rising CO2 may do to reefs.';
export const recipeOf = (g) => recipe(g, 'nb2ch', (g) => ({
  clusters: 2 + Math.floor(sv(g, 80) * 4), solo: 4 + Math.floor(sv(g, 81) * 10), fizz: 0.5 + sv(g, 82) * 0.8, burp: 0.2 + sv(g, 83) * 0.8,
  rocks: 0.6 + sv(g, 84) * 0.9, coral: 0.7 + sv(g, 85) * 0.6, fans: 0.4 + sv(g, 86), sponges: 0.4 + sv(g, 87), sulphur: 0.3 + sv(g, 88) * 0.9,
  line: sv(g, 89) < 0.5, // fissure-style clusters
  drift: (sv(g, 106) - 0.5) * 1.2, // the current leans every stream the same way
  hard: [[1.0, 0.5, 0.18], [0.78, 0.28, 0.85], [0.55, 0.8, 0.22], [1.05, 0.8, 0.22], [1.0, 0.35, 0.5], [0.22, 0.75, 0.68]].filter((_, i) => sv(g, 90 + i) > 0.3),
  fanPal: [[0.72, 0.1, 0.9], [1.0, 0.08, 0.16], [1.1, 0.45, 0.06], [1.05, 0.85, 0.12], [0.95, 0.15, 0.6]].filter((_, i) => sv(g, 100 + i) > 0.35),
}));

// ---------------------------------------------------------------- plan: vents and rocks
const PL = planned(function* (ctx) {
  const Y = slice(2.5);
  const rng = chunkRng(ctx, 0xc411), fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, 'champagne');
  const vents = [], clusters = [], rocks = [], occ = new Occ();
  const g0 = segFor(ctx, ctx.s0 + 32, 'champagne');
  if (!g0) return { vents, clusters, rocks, occ };
  const rc0 = recipeOf(g0);
  // vent clusters: often right beside or under the path, so the camera glides through the bubbles
  const nCl = Math.round(rc0.clusters * bk * (0.6 + rng() * 0.8));
  for (let k = 0; k < nCl; k++) {
    const s = ctx.s0 + (k + rng()) * CHUNK / Math.max(1, nCl), g = segFor(ctx, s, 'champagne');
    if (!g || rng() > ctx.weightOf(s, 'champagne')) continue;
    const rc = recipeOf(g), x = pc.x(s) + (rng() - 0.5) * 2 * (0.5 + Math.pow(rng(), 1.3) * 22), R = 1.2 + rng() * 3.5;
    const line = rc.line && rng() < 0.7, ang = rng() * TAU, n = Math.round((5 + rng() * 12) * (0.7 + 0.3 * bk));
    const cl = { x, s, y: fs.at(x, s), R, line, ang, vents: [] };
    for (let q = 0; q < n; q++) {
      let vx, vs;
      if (line) { const t = (rng() - 0.5) * 2 * R * 1.6; vx = x + Math.cos(ang) * t + (rng() - 0.5) * 0.3; vs = s + Math.sin(ang) * t + (rng() - 0.5) * 0.3; }
      else { const a = rng() * TAU, d = R * Math.sqrt(rng()); vx = x + Math.cos(a) * d; vs = s + Math.sin(a) * d; }
      const v = { x: vx, s: vs, y: fs.at(vx, vs), big: rng() < 0.12 * rc.burp, cl };
      vents.push(v); cl.vents.push(v);
    }
    clusters.push(cl);
    occ.add(x, s, R * 0.6);
  }
  yield;
  // solitary seeps scattered over the sand
  for (let k = 0; k < rc0.solo * bk; k++) {
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 2 * (1 + rng() * 26);
    vents.push({ x, s, y: fs.at(x, s), big: rng() < 0.1, cl: null });
  }
  // volcanic boulders; some seeps bubble up from the cracks at their feet
  const nR = Math.round(22 * rc0.rocks * bk);
  for (let k = 0; k < nR * 2 && rocks.length < nR; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'champagne');
    if (!g) continue;
    const side = rng() < 0.5 ? -1 : 1, x = pc.x(s) + side * (2 + Math.pow(rng(), 1.2) * 30);
    const tpl = rng() < 0.55 ? pick(rng, C.scoria) : pick(rng, poolOf(g, 'nb2chRock', C.rock)), sc = 0.6 + Math.pow(rng(), 1.5) * 1.6, sy = sc * (0.8 + rng() * 0.3);
    const y = fs.at(x, s), R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.6), rng() * TAU), h = (tpl.maxY - tpl.minY) * sy;
    if (!occ.free(x, s, tpl.r * sc * 0.8)) continue;
    if (!clearBox(pc, x, s, y, y + h, tpl.r * sc)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sy, sc, Pp, null, 0.04 + h * 0.08);
    occ.add(x, s, tpl.r * sc * 0.8);
    rocks.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, sy, g });
    if (rng() < 0.35) { // seep at the foot of the boulder
      const a = rng() * TAU, d = tpl.r * sc * 0.85, vx = Pp[0] + Math.cos(a) * d, vs = Pp[2] + Math.sin(a) * d;
      vents.push({ x: vx, s: vs, y: fs.at(vx, vs), big: rng() < 0.2, cl: null, rock: true });
    }
  }
  return { vents, clusters, rocks, occ };
});
const plan = (ctx) => PL.get(ctx);
export function layoutChP(ctx) { return presence(ctx, 'champagne') > 0 ? PL.stage(ctx) : null; }
// distance to the nearest seep (for the acidification gradient)
function ventDist(P, x, s) { let d = 1e9; for (const v of P.vents) { const q = Math.hypot(v.x - x, v.s - s); if (q < d) d = q; } return d; }

// ---------------------------------------------------------------- chain A: rocks + reef (acid gradient)
export function* layoutChA(ctx) {
  const Y = slice();
  if (presence(ctx, 'champagne') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'champagne');
  const rng = chunkRng(ctx, 0xc422), fs = nbFloor(ctx), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 60000 * bk);
  const sw = new Batch(MAT.sway, 24000 * bk); sw.soft = true;
  const fan = new Batch(NB2.mat.fan, 16000 * bk);
  const labels = [], pois = [];
  // basalt templates are authored light: darker tints, and little growth of their own (flat column tops
  // otherwise turn into bright silt and algae pads)
  for (const R0 of P.rocks) { if (put(ctx, st, R0.tpl, R0.x, R0.y, R0.s, R0.R, R0.sc, R0.sy, R0.sc, tintOf(rng, [[0.64, 0.62, 0.62], [0.56, 0.55, 0.57], [0.7, 0.64, 0.6]], 0.08), 0.5)) R0.item = st.last; }
  for (const cl of P.clusters) {
    pois.push({ type: 'champagne-vent', x: cl.x, y: cl.y + 1.5, s: cl.s, r: Math.max(2.5, cl.R), data: { name: cl.line ? 'Bubbling fissure' : 'Champagne vents', fact: VENT_FACT } });
    labels.push([cl.line ? 'Bubbling fissure' : 'Champagne vents', cl.x, cl.y + 0.8, cl.s, VENT_FACT]);
  }
  const SPECS = [
    { t: T.brain, w: 2, sc: [0.6, 1.5], hard: true },
    { t: T.boulder, w: 1.6, sc: [0.7, 1.6], hard: true },
    { t: T.coralMound, w: 0.7, sc: [0.6, 1.3], hard: true, mound: true },
    { t: T.pillar, w: 0.6, sc: [0.7, 1.3], hard: true },
    { t: T.finger, w: 0.8, sc: [0.7, 1.4], hard: true },
    { t: T.fan, w: 1.6, sc: [0.9, 1.8], fan: true },
    { t: T.whip, w: 1.4, sc: [0.8, 1.5], sway: true, col: [[0.75, 0.42, 0.85], [1.0, 0.75, 0.3], [0.8, 0.35, 0.2]] },
    { t: T.tubeSp, w: 1.2, sc: [0.8, 1.6], sponge: true },
    { t: T.vase, w: 0.8, sc: [0.8, 1.5], sponge: true },
    { t: T.barrel, w: 0.5, sc: [0.6, 1.2], sponge: true },
    { t: T.soft, w: 0.8, sc: [0.8, 1.5], sway: true, col: [[0.72, 0.12, 0.98], [0.98, 0.14, 0.62], [1.1, 0.42, 0.05]] },
    { t: T.leather, w: 0.6, sc: [0.8, 1.5], col: [[0.75, 0.7, 0.45], [0.6, 0.65, 0.4]] },
    { t: T.anem, w: 0.6, sc: [0.8, 1.4], sway: true, col: [[1, 1, 1]] },
  ].filter((e) => e.t && e.t.length);
  let tot = 0; for (const e of SPECS) tot += e.w;
  const N = 260 * bk * lowK(ctx);
  for (let k = 0; k < N; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'champagne');
    if (!g || rng() > ctx.weightOf(s, 'champagne')) continue;
    const rc = recipeOf(g), x = pc.x(s) + (rng() - 0.5) * 2 * (1 + Math.pow(rng(), 1.3) * 28);
    // acidification: within ~2 m of a seep almost nothing calcifies; full reef beyond ~7 m
    const vd = ventDist(P, x, s), acid = sstep(1.5, 7, vd);
    let u = rng() * tot, e = SPECS[0];
    for (const q of SPECS) { if ((u -= q.w) < 0) { e = q; break; } }
    if (e.hard && rng() > acid * rc.coral) continue;
    if ((e.sponge || e.fan || e.sway) && rng() > (0.25 + 0.75 * acid) * (e.fan ? rc.fans : e.sponge ? rc.sponges : 1)) continue;
    if (!P.occ.free(x, s, 0.4)) continue;
    const tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng()), y = fs.at(x, s), n = [fs.nx, fs.ny, fs.nz];
    const R = upTo(mix3([0, 1, 0], n, e.mound ? 0.7 : 0.4), rng() * TAU), h = (tpl.maxY - tpl.minY) * sc;
    if (!clearBox(pc, x, s, y, y + h, tpl.r * sc, e.sway ? SOFT : SOLID, e.sway ? 1.0 : 0)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, e.mound ? 0.1 : 0.03);
    const col = e.col ? tintOf(rng, e.col, 0.15) : e.fan ? tintOf(rng, rc.fanPal.length ? rc.fanPal : [[1, 0.3, 0.6]], 0.15)
      : e.sponge ? tintOf(rng, [[0.72, 0.12, 0.98], [1.1, 0.42, 0.05], [1.1, 0.86, 0.08], [0.85, 0.32, 0.22]], 0.15) : tintOf(rng, rc.hard.length ? rc.hard : [[1, 0.6, 0.3]], 0.18);
    put(ctx, e.fan ? fan : e.sway ? sw : st, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, e.sway || e.fan ? sc : 1);
  }
  return { batches: [st, sw, fan], labels, pois };
}

// ---------------------------------------------------------------- chain B: seeps (bubbles, bacterial rings, sulphur, fissures)
export function* layoutChB(ctx) {
  const Y = slice();
  if (presence(ctx, 'champagne') <= 0) return null;
  const P = plan(ctx), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0xc433), fs = nbFloor(ctx), pc = pathCache(ctx);
  const dec = new Builder(), streams = [], surf = ctx.surfaceY;
  const g0 = segFor(ctx, ctx.s0 + 32, 'champagne'), rc0 = g0 ? recipeOf(g0) : null;
  for (const cl of P.clusters) { // stained sand and bacterial film around each cluster
    const r = cl.R * (1.2 + rng() * 0.5);
    decalDisc(dec, fs, ctx, cl.x, cl.s, r, r * (cl.line ? 0.45 : 0.85), cl.ang, tintOf(rng, [[0.62, 0.6, 0.52], [0.66, 0.62, 0.5], [0.6, 0.5, 0.38]], 0.1), 0, 0.45, 6, 20);
    if (rc0 && rng() < rc0.sulphur) decalDisc(dec, fs, ctx, cl.x + (rng() - 0.5) * cl.R, cl.s + (rng() - 0.5) * cl.R, r * 0.5, r * 0.4, rng() * TAU, [0.85, 0.72, 0.25], 0, 0.5, 5, 16);
    if (cl.line) { // the fissure itself: a dark crack with pale lips
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = (i / 10 - 0.5) * 2 * cl.R * 1.7; pts.push(cl.x + Math.cos(cl.ang) * t + (rng() - 0.5) * 0.25, cl.s + Math.sin(cl.ang) * t + (rng() - 0.5) * 0.25); }
      decalRibbon(dec, fs, ctx, pts, 0.18, [0.06, 0.06, 0.06], 3, 0.9);
      decalRibbon(dec, fs, ctx, pts, 0.42, [0.9, 0.88, 0.75], 2, 0.6);
    }
  }
  const lowF = lk < 1 ? 0.65 : 1;
  for (const v of P.vents) {
    if (Y.over()) { yield; Y.reset(); }
    const g = segFor(ctx, v.s, 'champagne');
    if (!g || ctx.weightOf(v.s, 'champagne') < 0.15) continue;
    const rc = recipeOf(g), rise = surf - v.y - 0.1;
    if (rise < 1) continue;
    // vent mouth: dark pit in a pale bacterial ring
    const r = v.big ? 0.22 + rng() * 0.15 : 0.08 + rng() * 0.1;
    decalDisc(dec, fs, ctx, v.x, v.s, r * 2.6, r * 2.6, rng() * TAU, tintOf(rng, [[0.85, 0.84, 0.76], [0.88, 0.8, 0.55]], 0.08), 2, 0.55, 3, 10);
    decalDisc(dec, fs, ctx, v.x, v.s, r, r, rng() * TAU, [0.05, 0.05, 0.05], 3, 0.85, 2, 8);
    // the bubble stream(s): fine fizz, sometimes big wobbling burps
    const fizz = { x: v.x, y: v.y + 0.02, s: v.s, n: Math.round((v.big ? 220 : 80 + rng() * 110) * Math.min(1, rc.fizz) * lowF) + 16, rise, speed: 0.3 + rng() * 0.2, size: 0.009 + rng() * 0.008, wob: 0.015 + rng() * 0.03, drift: rc.drift + (rng() - 0.5) * 0.25, spread: v.big ? 0.16 : 0.07 };
    streams.push(fizz);
    if (v.big || rng() < rc.burp * 0.35) streams.push({ x: v.x, y: v.y + 0.02, s: v.s, n: Math.round((14 + rng() * 20) * lowF) + 4, rise, speed: 0.55 + rng() * 0.25, size: 0.026 + rng() * 0.025, wob: 0.07 + rng() * 0.08, drift: rc.drift * 0.7 + (rng() - 0.5) * 0.3, spread: 0.12 });
  }
  const extra = [];
  yield;
  const bm = streams.length ? bubbleMesh(ctx, streams, rng) : null;
  if (bm) extra.push(bm);
  yield;
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  return { batches: [], extra };
}

// ---------------------------------------------------------------- chain C: life on the rocks, turf near the seeps
export function* layoutChC(ctx) {
  const Y = slice();
  if (presence(ctx, 'champagne') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'champagne'), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0xc444), fs = nbFloor(ctx), pc = pathCache(ctx);
  const mid = new Batch(MAT.static, 30000 * bk); mid.lod = 'mid';
  const near = mid, sw = null;
  for (const R0 of P.rocks) {
    if (Y.over()) { yield; Y.reset(); }
    if (!R0.item) continue;
    const acid = sstep(1.0, 5, ventDist(P, R0.x, R0.s)), spots = itemSpots(R0.item, ctx, 14, 0.35);
    for (let q = 0; q < Math.min(spots.length, Math.round((2 + rng() * 5) * lk)); q++) {
      const p = spots[(rng() * spots.length) | 0], u = rng();
      // acid side: zoanthid turf and sponges; reef side: encrusting colour and feather stars
      const tpl = u < 0.5 * (1 - acid) + 0.15 ? pick(rng, C.turf) : pick(rng, C.enc);
      const isCrin = C.crin.includes(tpl), sc = 0.7 + rng() * 0.8, R = upTo(p.n, rng() * TAU);
      const Pp = decoOn(ctx, R0.item, p, tpl, sc, R);
      if (!Pp) continue;
      const [x, y, s] = Pp;
      if (!clearBox(pc, x, s, y, y + 0.4, tpl.r * sc, isCrin ? SOFT : SOLID, isCrin ? 1 : 0)) continue;
      const col = isCrin ? tintOf(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.08, 0.1], [0.9, 0.9, 0.85]], 0.12)
        : C.turf.includes(tpl) ? tintOf(rng, [[0.45, 0.85, 0.25], [0.95, 0.6, 0.15], [0.55, 0.42, 0.25]], 0.12) : tintOf(rng, [[1.0, 0.35, 0.05], [0.85, 0.06, 0.08], [0.55, 0.12, 0.75], [1.05, 0.8, 0.1]], 0.18);
      put(ctx, mid, tpl, x, y, s, R, sc, sc, sc, col, 1, { item: R0.item });
    }
  }
  // the sand: algal turf hugging the seeps, sea stars, long-spined urchins on the reef side
  const FL = [
    { t: C.turf, w: 1.6, acid: true, sc: [0.8, 1.8], col: [[0.35, 0.7, 0.2], [0.55, 0.75, 0.25], [0.6, 0.45, 0.2]] },
    { t: T.star, w: 0.5, sc: [0.1, 0.18], col: [[1.0, 0.45, 0.12], [0.9, 0.2, 0.2], [1.0, 0.75, 0.3]] },
    { t: T.urchin, w: 0.6, sc: [0.06, 0.11], reef: true, col: [[1, 1, 1]] },
    { t: C.enc, w: 0.8, sc: [0.8, 1.5], col: [[0.55, 0.12, 0.75], [1.0, 0.35, 0.05]] },
    { t: T.rubble, w: 0.8, sc: [0.7, 1.4], col: [[0.6, 0.58, 0.55]] },
  ].filter((e) => e.t && e.t.length);
  let tot = 0; for (const e of FL) tot += e.w;
  for (let k = 0; k < 180 * lk * bk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'champagne');
    if (!g || rng() > ctx.weightOf(s, 'champagne')) continue;
    const x = pc.x(s) + (rng() - 0.5) * 2 * (0.5 + Math.pow(rng(), 1.4) * 20);
    let u = rng() * tot, e = FL[0];
    for (const q of FL) { if ((u -= q.w) < 0) { e = q; break; } }
    const vd = ventDist(P, x, s);
    if (e.acid && vd > 4 + rng() * 3) continue;
    if (e.reef && vd < 5) continue;
    const tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng()), y = fs.at(x, s), R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.85), rng() * TAU);
    if (!clearBox(pc, x, s, y, y + (tpl.maxY - tpl.minY) * sc, tpl.r * sc)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.015);
    put(ctx, near, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tintOf(rng, e.col, 0.12));
  }
  return { batches: [mid] };
}
export { ACID_FACT };
