// Seamount: volcanic pinnacles rising out of the deep blue, smothered in life. Huge netted gorgonian fans
// (broadside to the current on the summits, parallel to the face on the cliffs), black coral trees and
// wire corals, barrel / elephant-ear / tube sponges, translucent soft corals, carpets of jewel anemones
// or zoanthids, encrusting orange and purple, overhanging ledges with sun corals beneath and feather
// stars on top, basalt crags and columns. Every segment picks a regional community (Indo-Pacific,
// temperate Atlantic or eastern Pacific) and its own palette. POI 'pinnacle' on every summit the path
// passes; some summits are manta cleaning stations.
import { Batch, TAU, rotY, rotX, mul3, presence, budgetK, T, Builder, lerp } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { NBMAT, pathCache, clearBox, SOLID, SOFT, seat, put, upTo, nrm, mix3, segFor, recipe, lowK, itemSupport, basePts, xf, slice, nbFloor, decalDisc, builderMesh, lab } from './nb_common.js';
import { encrust, featherStar, blackCoral, elephantEar, sunCorals } from './nb_shapes.js';
import { seaWhips } from './shapes.js';
import { giantFan, wireCoral, xmasBlackCoral, polypMat, shelf, softTree } from './nb2_life.js';
import { Crust, crustPatch, tubeCluster } from './nb2_crust.js';
import { pick, tintOf, chunkRng, poolOf, hotCells, hotCellsG, facet, hangY, itemSpots, WPick, visW, NB2, planned, decoOn, NATC } from './nb2_common.js';
import { rockJob, drain } from './rock_recipes.js';

const S = {};
const ROCKS = [
  { r: 'columnar', litho: 'basalt', growth: 0.8 }, { r: 'boulder', litho: 'basalt', kind: 'angular', growth: 0.9 }, { r: 'pillow', growth: 0.7 },
  { r: 'eroded', litho: 'basalt', growth: 0.9 }, { r: 'boulder', litho: 'greenstone', kind: 'angular', growth: 0.9 }, { r: 'columnar', big: true, litho: 'basalt', growth: 0.7 },
  { r: 'pile', lithos: ['basalt', 'greenstone'], growth: 0.9 }, { r: 'cracked', litho: 'basalt', growth: 0.8 },
];
export const SM_ROCKS = ROCKS;
export const SM_FAN = ['Giant gorgonian sea fan', 'Fans grow broadside to the current; on a seamount the current never stops, and neither does the food.'];

export function initSeamount() {
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(2600 + i * 23 + o));
  S.fan = R(6, (s) => giantFan(s, { h: 1.7 + (s % 5) * 0.22, lobes: 1 + (s % 3 === 0 ? 1 : 0), cup: 0.04 + (s % 4) * 0.03 }));
  S.black = [...R(3, (s) => blackCoral(s, { h: 1.0 + (s % 3) * 0.3 }), 1), ...R(4, (s) => xmasBlackCoral(s, { h: 1.0 + (s % 4) * 0.3 }), 2)];
  S.wire = R(5, (s) => wireCoral(s, { L: 1.2 + (s % 4) * 0.35 }), 3);
  S.whip = R(4, (s) => seaWhips(s + 300, { n: 3 + (s % 4), h: 1.2 + (s % 3) * 0.4 }), 4);
  S.ear = R(4, (s) => elephantEar(s, { H: 0.8 + (s % 3) * 0.25, W: 0.8 + (s % 4) * 0.15, detail: 2 }), 5);
  S.soft = [...R(5, (s) => softTree(s, { h: 0.6 + (s % 4) * 0.15 }), 6), ...R(3, (s) => softTree(s, { h: 0.5 + (s % 3) * 0.15, form: 'cauli' }), 7)];
  S.jewel = R(5, (s) => polypMat(s, { n: 10 + (s % 4) * 3, r: 0.16 + (s % 3) * 0.06, size: 0.026 }), 8);
  S.zoan = R(4, (s) => polypMat(s, { n: 14 + (s % 3) * 4, r: 0.2 + (s % 3) * 0.05, size: 0.024, zoanthid: true }), 9);
  // small cushions and lumps (the broad colour on the rock is the crust skin): rounded outlines
  S.enc = R(8, (s) => encrust(s, { r: 0.1 + (s % 4) * 0.035, h: 0.05 + (s % 3) * 0.025, lobes: 0.5, detail: s % 2 ? 1 : 2, ridges: s % 3 === 0 ? 0.3 : 0, elong: 1 + (s % 3) * 0.25 }), 10);
  S.sun = R(4, (s) => sunCorals(s, { n: 7 + (s % 4) * 3 }), 11);
  S.crin = R(5, (s) => featherStar(s, { arms: 10 + (s % 3) * 3, L: 0.2 + (s % 3) * 0.05, up: 0.4 + (s % 4) * 0.15 }), 12);
  S.ledge = R(5, (s) => shelf(s, { w: 2.2 + (s % 4) * 0.6, d: 1.3 + (s % 3) * 0.35, th: 0.45 + (s % 3) * 0.12, col: [0.42, 0.4, 0.4] }), 13);
  S.rock = R(6, (s) => drain(rockJob(ROCKS[s % ROCKS.length], s)), 14);
  S.tubes = R(6, (s) => tubeCluster(s, { n: 2 + (s % 4), h: 0.12 + (s % 3) * 0.06 }), 15);
  lab(S.fan, SM_FAN[0], SM_FAN[1]);
  lab(S.black, 'Black coral', 'Named for its black skeleton; the living tissue is white, green or orange. Some colonies are over 4,000 years old.');
  lab(S.wire, 'Wire coral', 'Wire corals are single unbranched whips of black coral, often twisted into a corkscrew.');
  lab(S.whip, 'Sea whips', null);
  lab(S.ear, 'Elephant ear sponge', 'A single large sponge can filter thousands of litres of water a day.');
  lab(S.jewel, 'Jewel anemones', 'Not true anemones: each colour patch is one clone, splitting again and again.');
  lab(S.zoan, 'Zoanthids', 'Zoanthids are colonial polyps; some make palytoxin, one of the most potent poisons known.');
  lab(S.enc, 'Encrusting sponge', null);
  lab(S.sun, 'Sun coral (Tubastraea)', 'Sun corals have no algae; they open at night to catch plankton in the shade.');
  lab(S.crin, 'Feather star', 'Feather stars climb to the highest perches to comb plankton from the current.');
  lab(S.ledge, 'Basalt ledge', 'Old lava flows weather unevenly, leaving overhangs where fish shelter from the current.');
  for (const t of [...S.crin, ...S.whip, ...S.black, ...S.wire]) t.solid = false;
  return S;
}

// ---------------------------------------------------------------- regional communities
const PAL = {
  fanTrop: [[1.0, 0.1, 0.14], [1.1, 0.45, 0.06], [0.72, 0.1, 0.9], [1.05, 0.85, 0.12], [0.95, 0.15, 0.6]],
  fanTemp: [[1.05, 0.85, 0.15], [1.0, 0.25, 0.08], [1.05, 0.55, 0.1], [0.95, 0.9, 0.75]],
  fanEast: [[1.05, 0.75, 0.15], [1.0, 0.4, 0.08], [0.95, 0.2, 0.12]],
  black: [[0.92, 0.92, 0.86], [0.55, 0.75, 0.4], [0.95, 0.65, 0.3], [1.0, 0.85, 0.45]],
  soft: [[1.0, 0.18, 0.55], [0.7, 0.12, 1.0], [1.0, 0.06, 0.08], [1.1, 0.42, 0.04], [1.1, 0.9, 0.12], [0.95, 0.35, 0.75]],
  jewel: [[1.05, 0.25, 0.65], [0.75, 0.25, 1.0], [1.1, 0.5, 0.1], [0.35, 0.95, 0.55], [1.0, 0.9, 0.85], [1.0, 0.15, 0.2]],
  zoan: [[0.45, 0.85, 0.25], [0.95, 0.6, 0.15], [0.55, 0.42, 0.25], [0.3, 0.75, 0.75]],
  enc: [[1.0, 0.35, 0.05], [0.85, 0.06, 0.08], [0.55, 0.12, 0.75], [1.05, 0.8, 0.1], [0.95, 0.3, 0.55], [0.75, 0.6, 0.45]],
  sponge: [[0.85, 0.32, 0.22], [0.7, 0.22, 0.7], [0.95, 0.55, 0.2], [1.0, 0.75, 0.15], [0.55, 0.45, 0.85]],
  decal: [[0.95, 0.3, 0.08], [0.6, 0.12, 0.6], [0.9, 0.12, 0.2], [0.95, 0.7, 0.12], [0.85, 0.4, 0.55]],
};
const STYLES = {
  // tropical Indo-Pacific pinnacle: riotous soft corals, fans, zoanthids
  trop: { w: 1.3, fan: 1.0, giant: 1.0, black: 0.6, wire: 0.6, sponge: 0.8, soft: 1.4, jewel: 0.2, zoan: 1.0, crin: 1.0, fanPal: PAL.fanTrop, name: 'Indo-Pacific' },
  // temperate Atlantic: yellow and red gorgonians, carpets of jewel anemones, fewer soft corals
  temp: { w: 0.9, fan: 1.4, giant: 0.8, black: 0.3, wire: 0.2, sponge: 1.0, soft: 0.25, jewel: 1.8, zoan: 0.1, crin: 0.6, fanPal: PAL.fanTemp, name: 'Atlantic' },
  // eastern Pacific (Galapagos, Cocos): black coral forests, wire coral, sea fans in yellow and orange
  east: { w: 0.8, fan: 0.9, giant: 0.7, black: 1.6, wire: 1.5, sponge: 0.7, soft: 0.5, jewel: 0.6, zoan: 0.6, crin: 0.5, fanPal: PAL.fanEast, name: 'eastern Pacific' },
};
const recipeOf = (g) => recipe(g, 'nb2sm', (g) => {
  const keys = Object.keys(STYLES);
  let tot = 0; for (const k of keys) tot += STYLES[k].w;
  let u = sv(g, 40) * tot, st = STYLES.trop;
  for (const k of keys) { if ((u -= STYLES[k].w) <= 0) { st = STYLES[k]; break; } }
  const sub = (list, k0) => { const l = list.filter((_, i) => sv(g, k0 + i) > 0.35); return l.length ? l : list; };
  return {
    st, life: 0.75 + sv(g, 41) * 0.5,
    fan: st.fan * (0.6 + sv(g, 42) * 0.8), black: st.black * (0.6 + sv(g, 43) * 0.8), sponge: st.sponge * (0.6 + sv(g, 44) * 0.8),
    soft: st.soft * (0.5 + sv(g, 45)), jewel: st.jewel * (0.5 + sv(g, 46)), zoan: st.zoan * (0.5 + sv(g, 47)), crin: st.crin, wire: st.wire * (0.6 + sv(g, 48) * 0.8),
    ledges: 0.4 + sv(g, 49) * 0.8, crags: 0.5 + sv(g, 50),
    fanPal: sub(st.fanPal, 60), softPal: sub(PAL.soft, 70), jewelPal: sub(PAL.jewel, 80), encPal: sub(PAL.enc, 90), decalPal: sub(PAL.decal, 100),
    giantK: st.giant * (0.6 + sv(g, 51) * 0.8),
  };
});

// encrusting skin (crust patches, nb2_crust.js): albedo-scaled colony colours, linear
const CR = {
  turf: [[0.3, 0.29, 0.13], [0.36, 0.3, 0.17], [0.26, 0.29, 0.19], [0.42, 0.35, 0.22]],
  coral: [[0.52, 0.19, 0.28], [0.46, 0.22, 0.4], [0.58, 0.28, 0.3], [0.42, 0.17, 0.33]],
  veil: [[0.4, 0.23, 0.29], [0.38, 0.32, 0.22], [0.31, 0.29, 0.21], [0.43, 0.29, 0.35], [0.34, 0.29, 0.28]],
};
const scaled = (list, k) => list.map((c) => [c[0] * k, c[1] * k, c[2] * k]);
const CRUST_LABEL = [
  ['Encrusting sponges', 'Every hard surface swept by current is claimed: sponges, zoanthids and hydroids fight for space centimetre by centimetre.'],
  null, // polyps: jewel anemones or zoanthids (labelled from their templates' text)
  ['Hydroid turf', 'Hydroids look like tiny plants but are colonies of polyps, relatives of jellyfish, stinging plankton from the current.'],
  ['Coralline algae', 'Coralline algae lay down limestone in their cell walls; their pink crusts cement the rock together.'],
];

// ---------------------------------------------------------------- pinnacle summits, found on the live terrain
// Local maxima of the rendered floor (ctx.floorAt) within 84 m of the path, so every pinnacle gets its
// POI whatever raised it. (A private copy of the 70 m peak lattice missed the path-side route spires of
// biomes.js, which never got POIs or summit life.) Coarse 4 m grid on world coordinates, hill-climb to
// the top, then a pinnacle test: the highest point within 12 m and >= 10 m above its surroundings (fbm
// bumps on a flank or the rolling base fail it). A summit belongs to the chunk holding its top.
const SUM_C = 4, SUM_W = 84, SUM_M = 16, SUM_DIR = Array.from({ length: 8 }, (_, k) => [Math.cos(k * TAU / 8), Math.sin(k * TAU / 8)]);
function climb(ctx, x, s) {
  let y = ctx.floorAt(x, s);
  for (const st of [2, 1, 0.5]) {
    for (let it = 0; it < 8; it++) {
      let bx = x, bs = s, by = y;
      for (const [cx, cs] of SUM_DIR) { const v = ctx.floorAt(x + cx * st, s + cs * st); if (v > by + 1e-3) { bx = x + cx * st; bs = s + cs * st; by = v; } }
      if (bx === x && bs === s) break;
      x = bx; s = bs; y = by;
    }
  }
  return { x, s, y };
}
function* summits(ctx, pc, out, Y) {
  const c = SUM_C, j0 = Math.floor((ctx.s0 - SUM_M) / c), j1 = Math.ceil((ctx.s1 + SUM_M) / c);
  let xa = Infinity, xb = -Infinity;
  for (let s = ctx.s0 - SUM_M; s <= ctx.s1 + SUM_M; s += 8) { const x = pc.x(s); xa = Math.min(xa, x); xb = Math.max(xb, x); }
  const i0 = Math.floor((xa - SUM_W) / c), i1 = Math.ceil((xb + SUM_W) / c), W = i1 - i0 + 1, h = new Float32Array(W * (j1 - j0 + 1));
  for (let j = j0; j <= j1; j++) {
    if (Y.over()) { yield; Y.reset(); }
    for (let i = i0; i <= i1; i++) h[(j - j0) * W + i - i0] = ctx.floorAt(i * c, j * c);
  }
  const cand = [];
  for (let j = j0 + 1; j < j1; j++) {
    const px = pc.x(j * c);
    for (let i = i0 + 1; i < i1; i++) {
      if (Math.abs(i * c - px) > SUM_W) continue;
      const o = (j - j0) * W + i - i0, v = h[o];
      if (v < h[o - 1] || v < h[o + 1] || v < h[o - W] || v < h[o + W] || v < h[o - W - 1] || v < h[o - W + 1] || v < h[o + W - 1] || v < h[o + W + 1]) continue;
      cand.push(i * c, j * c);
    }
  }
  const tops = [];
  for (let k = 0; k < cand.length; k += 2) {
    if (Y.over()) { yield; Y.reset(); }
    const p = climb(ctx, cand[k], cand[k + 1]);
    if (p.s < ctx.s0 || p.s >= ctx.s1) continue;
    // pinnacle test, and its radius: where the flanks have fallen 80% of the way to the surroundings
    let base = Infinity, hi = -Infinity;
    const prof = [];
    for (const [cx, cs] of SUM_DIR) for (let r = 4; r <= 36; r += 4) {
      const v = ctx.floorAt(p.x + cx * r, p.s + cs * r);
      prof.push(v); base = Math.min(base, v);
      if (r <= 12) hi = Math.max(hi, v);
    }
    if (hi > p.y + 0.05 || p.y - base < 10) continue;
    let rs = 0;
    for (let d = 0; d < 8; d++) { let rd = 36; for (let q = 0; q < 9; q++) if (p.y - prof[d * 9 + q] >= 0.8 * (p.y - base)) { rd = 4 + q * 4; break; } rs += rd; }
    p.r = Math.min(40, Math.max(12, rs / 8 / 0.6)); // (a cone falls 80% at 0.6 of its radius)
    tops.push(p);
  }
  // the highest first, so a lower top beside it (a second climb onto the same spire) is the one dropped
  tops.sort((a, b) => b.y - a.y);
  for (const p of tops) if (!out.some((q) => Math.hypot(q.x - p.x, q.s - p.s) < 12)) out.push(p);
  return out;
}

// ---------------------------------------------------------------- plan: ledges, crags (shared by chains)
const PL = planned(function* (ctx) {
  const Y = slice(2.5);
  const rng = chunkRng(ctx, 0x5a11), fs = nbFloor(ctx), pc = pathCache(ctx);
  const ledges = [], crags = [], peaks = [];
  // steep, visible faces near the camera
  const hot = yield* hotCellsG(ctx, fs, pc, { W: 46, cell: 3, test: (rel, ny) => rel > -30 && rel < 14 && ny < 0.97 }, Y);
  yield* summits(ctx, pc, peaks, Y);
  yield;
  for (const p of peaks) { p.y = fs.at(p.x, p.s); p.rel = p.y - pc.y(p.s); }
  const steepL = hot.filter((c) => c.ny < 0.62 && c.rel > -22 && c.rel < 8), steep = new WPick(steepL, (c) => visW(c, pc));
  const nL = Math.min(7, Math.round(steepL.length / 18));
  for (let k = 0; k < nL * 3 && ledges.length < nL; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const c = steep.pick(rng), s = c.s + (rng() - 0.5) * 3, g = segFor(ctx, s, 'seamount');
    if (!g || rng() > ctx.weightOf(s, 'seamount') * recipeOf(g).ledges) continue;
    const x = c.x + (rng() - 0.5) * 3, F = facet(fs, x, s);
    if (!F.hn || F.n[1] > 0.7) continue;
    const tpl = pick(rng, S.ledge), sc = 0.8 + rng() * 0.6, R = rotY(Math.atan2(F.hn[0], F.hn[2]) + (rng() - 0.5) * 0.5);
    const Pp = [x, F.y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, F.hn, 0.15);
    const reach = tpl.r * sc;
    if (!clearBox(pc, Pp[0], Pp[2], Pp[1] - reach, Pp[1] + reach, reach)) continue;
    if (ledges.some((L) => Math.hypot(L.x - Pp[0], L.s - Pp[2]) < 4)) continue;
    ledges.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, hn: F.hn });
  }
  const modL = hot.filter((c) => c.ny > 0.4 && c.ny < 0.93), mod = new WPick(modL, (c) => visW(c, pc));
  const nC = Math.min(18, Math.round(modL.length / 10));
  for (let k = 0; k < nC * 2 && crags.length < nC; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const c = mod.pick(rng), s = c.s + (rng() - 0.5) * 3, g = segFor(ctx, s, 'seamount');
    if (!g || rng() > ctx.weightOf(s, 'seamount') * recipeOf(g).crags) continue;
    const pool = poolOf(g, 'nb2smRock', S.rock), tpl = pick(rng, pool);
    const x = c.x + (rng() - 0.5) * 3, F = facet(fs, x, s), sc = 0.9 + Math.pow(rng(), 1.5) * 1.8, sy = sc * (0.8 + rng() * 0.5);
    const R = upTo(mix3([0, 1, 0], F.n, 0.55), rng() * TAU), h = (tpl.maxY - tpl.minY) * sy;
    if (!clearBox(pc, x, s, F.y - 0.5, F.y + h, tpl.r * sc)) continue;
    if (crags.some((C) => Math.hypot(C.x - x, C.s - s) < (C.r + tpl.r * sc) * 0.8)) continue;
    const Pp = [x, F.y, s];
    seat(fs, tpl, R, sc, sy, sc, Pp, null, 0.08 + h * 0.12);
    crags.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, sy, r: tpl.r * sc });
  }
  return { ledges, crags, hot, peaks };
});
const plan = (ctx) => PL.get(ctx);
export function layoutSmP(ctx) { return presence(ctx, 'seamount') > 0 ? PL.stage(ctx) : null; }

// a random hot cell, jittered; facet + segment + recipe, or null
function spot(ctx, fs, rng, list, jit = 3) {
  if (list.empty) return null;
  const c = list.pick(rng), s = c.s + (rng() - 0.5) * jit, x = c.x + (rng() - 0.5) * jit;
  const g = segFor(ctx, s, 'seamount');
  if (!g || rng() > ctx.weightOf(s, 'seamount')) return null;
  const F = facet(fs, x, s);
  return { x, s, y: F.y, n: F.n, hn: F.hn, g, rc: recipeOf(g), dx: c.dx };
}
const UP = [0, 1, 0];
const CPTS = new Float32Array(4 * 6);

// ---------------------------------------------------------------- chain A: structure + big life
export function* layoutSmA(ctx) {
  const Y = slice();
  if (presence(ctx, 'seamount') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'seamount');
  const rng = chunkRng(ctx, 0x5a22), fs = nbFloor(ctx), pc = pathCache(ctx);
  const tk = ctx.tier === 'low' ? 0.85 : 1; // per-chunk triangle caps (all chains together stay under ~165k)
  const st = new Batch(MAT.static, 38000 * bk * tk);
  const fan = new Batch(NB2.mat.fan, 30000 * bk * tk); // giant fans are solid for creatures and the camera
  const sw = new Batch(MAT.sway, 12000 * bk * tk); sw.soft = true;
  const labels = [], pois = [];
  for (const L of P.ledges) {
    put(ctx, st, L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, tintOf(rng, [[0.74, 0.7, 0.68], [0.66, 0.64, 0.66]], 0.1), 0.45);
    L.item = st.last;
    const o = L.tpl.box[5] * L.sc * 0.7;
    pois.push({ type: 'wall-overhang', x: L.x + L.hn[0] * o, y: L.y - 0.8, s: L.s - L.hn[2] * o, r: 2.5, data: { name: 'Ledge overhang', fact: 'Overhangs shelter fish from the current that sweeps the seamount.' } });
  }
  // volcanic rock as dark as the pinnacle it sits on (basalt templates are authored light), little growth
  // of their own: flat column tops otherwise turn into bright silt and algae pads
  for (const C of P.crags) { put(ctx, st, C.tpl, C.x, C.y, C.s, C.R, C.sc, C.sy, C.sc, tintOf(rng, [[0.42, 0.4, 0.39], [0.36, 0.35, 0.37], [0.45, 0.4, 0.36]], 0.08), 0.35); C.item = st.last; }
  // summits: POIs (the camera and the schools gather) and a garden of fans on top
  for (const p of P.peaks) {
    if (Y.over()) { yield; Y.reset(); }
    const g = segFor(ctx, p.s, 'seamount');
    if (!g || ctx.weightOf(p.s, 'seamount') < 0.5) continue;
    const dx = p.x - pc.x(p.s);
    if (Math.abs(dx) > 70 || p.rel < -34) continue;
    const name = p.rel > -6 ? 'Pinnacle summit' : 'Seamount pinnacle';
    pois.push({ type: 'pinnacle', x: p.x, y: p.y + 1, s: p.s, r: p.r * 0.5, data: { name, fact: 'Seamounts lift currents toward the light: plankton blooms, and the hunters follow.' } });
    labels.push([name, p.x, p.y + 1.5, p.s, 'Over 30,000 seamounts rise more than 1,000 m from the ocean floor; most have never been visited.']);
    if (p.rel < -4 && sv(g, 52 + (Math.floor(p.s) & 7)) < 0.45)
      pois.push({ type: 'cleaning-station', x: p.x, y: p.y + 0.5, s: p.s, r: 6, data: { name: 'Cleaning station', fact: 'Mantas queue over seamount cleaning stations, where wrasse pick off their parasites.' } });
    // the garden on the cap: giant fans (broadside to the current where it is flat enough, parallel to the
    // face on the steep spire tips), sponges, black coral (summits beyond the faces the hot cells cover
    // would otherwise stand bare)
    const rc = recipeOf(g), rCap = Math.min(7, p.r * 0.3), done = [];
    for (let q = 0; q < 8 * bk * rc.life; q++) {
      const a = rng() * TAU, d = 0.8 + Math.sqrt(rng()) * rCap, x = p.x + Math.cos(a) * d, s = p.s + Math.sin(a) * d;
      const F = facet(fs, x, s), n = F.n, steep = n[1] < 0.75, face = F.hn ? Math.atan2(F.hn[0], F.hn[2]) : rng() * TAU;
      if (n[1] < 0.12 || done.some((o) => Math.hypot(o[0] - x, o[1] - s) < 1.6)) continue;
      const u = rng();
      let tpl, sc, R, b = st, col, fa = 1, solid = true, m = n, embed = 0.04;
      if (u < 0.55) {
        tpl = pick(rng, poolOf(g, 'nb2smFan', S.fan)); sc = 1.0 + rng() * 0.8; b = fan; fa = sc; m = null; col = tintOf(rng, rc.fanPal, 0.15);
        R = steep ? mul3(rotY(face + (rng() - 0.5) * 0.4), rotX(0.12 + rng() * 0.25)) : mul3(rotY(sv(g, 53) * TAU + (rng() - 0.5) * 0.5), rotX((rng() - 0.5) * 0.2));
      } else if (u < 0.8 && (steep || T.barrel)) {
        if (steep) { tpl = pick(rng, S.ear); sc = 1.0 + rng() * 0.8; R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.15 + rng() * 0.3)); col = tintOf(rng, PAL.sponge, 0.15); }
        else { tpl = pick(rng, T.barrel); sc = 0.9 + rng() * 0.8; R = upTo(mix3(UP, n, 0.35), rng() * TAU); embed = 0.06; col = tintOf(rng, NATC.barrel, 0.12); }
      } else { tpl = pick(rng, S.black); sc = 1.0 + rng() * 1.0; b = sw; fa = sc * 0.5; solid = false; col = tintOf(rng, PAL.black, 0.12); R = upTo(steep ? nrm([n[0], n[1] + 0.35, n[2]]) : mix3(UP, n, 0.3), rng() * TAU); }
      const h = (tpl.maxY - tpl.minY) * sc, reach = Math.max(tpl.r * sc, h * 0.45);
      if (!clearBox(pc, x, s, F.y - reach * 0.5, F.y + h, reach, solid ? SOLID : SOFT, solid ? 0 : 1.4)) continue;
      const Pp = [x, F.y, s];
      seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
      if (put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa)) done.push([x, s]);
    }
  }
  // big life on the faces
  const vis = new WPick(P.hot.filter((c) => c.rel > -28), (c) => visW(c, pc));
  const nBig = Math.min(280, vis.list.length * 0.8) * bk;
  for (let k = 0; k < nBig; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const sp = spot(ctx, fs, rng, vis);
    if (!sp) continue;
    const rc = sp.rc, steep = sp.n[1] < 0.75, u = rng() * (rc.fan * rc.giantK + rc.black + rc.sponge * 1.2 + rc.wire * 0.6) * rc.life;
    let tpl, sc, R, b = st, col, fa = 1, m = sp.n, embed = 0.04, solid = true;
    const face = sp.hn ? Math.atan2(sp.hn[0], sp.hn[2]) : rng() * TAU;
    let x = rc.fan * rc.giantK;
    if (u < x) { // giant fan
      const big = rng() < 0.45 || !T.fan;
      tpl = big ? pick(rng, poolOf(sp.g, 'nb2smFan', S.fan)) : pick(rng, T.fan); sc = big ? 1.1 + Math.pow(rng(), 1.2) * 0.9 : 1.4 + rng() * 1.4; b = fan; fa = sc; col = tintOf(rng, rc.fanPal, 0.15);
      R = steep ? mul3(rotY(face + (rng() - 0.5) * 0.4), rotX(0.12 + rng() * 0.25)) : mul3(rotY(sv(sp.g, 53) * TAU + (rng() - 0.5) * 0.5), rotX((rng() - 0.5) * 0.2));
      m = null;
    } else if (u < (x += rc.black)) { // black coral bush / christmas tree
      tpl = pick(rng, S.black); sc = 1.0 + rng() * 1.2; b = sw; fa = sc * 0.5; col = tintOf(rng, PAL.black, 0.12); solid = false;
      R = upTo(steep ? nrm([sp.n[0], sp.n[1] + 0.35, sp.n[2]]) : mix3(UP, sp.n, 0.3), rng() * TAU);
    } else if (u < (x += rc.sponge * 1.2)) { // sponges
      const kind = steep ? (rng() < 0.65 ? 'ear' : 'tube') : (rng() < 0.55 ? 'barrel' : rng() < 0.5 ? 'vase' : 'tube');
      if (kind === 'ear') { tpl = pick(rng, S.ear); sc = 1.0 + rng() * 1.0; R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.15 + rng() * 0.3)); }
      else if (kind === 'barrel' && T.barrel) { tpl = pick(rng, T.barrel); sc = 0.9 + rng() * 1.1; R = upTo(mix3(UP, sp.n, 0.35), rng() * TAU); embed = 0.06; }
      else if (kind === 'vase' && T.vase) { tpl = pick(rng, T.vase); sc = 1.0 + rng() * 1.0; R = upTo(mix3(UP, sp.n, 0.3), rng() * TAU); }
      else if (T.tubeSp) { tpl = pick(rng, T.tubeSp); sc = 1.0 + rng() * 0.9; R = upTo(mix3(UP, sp.n, steep ? 0.6 : 0.3), rng() * TAU); }
      else continue;
      col = tintOf(rng, PAL.sponge, 0.15);
    } else { // wire coral spray: several whips from one patch of rock
      const n = 2 + Math.floor(rng() * 4);
      for (let q = 0; q < n; q++) {
        const xx = sp.x + (rng() - 0.5) * 1.2, ss = sp.s + (rng() - 0.5) * 1.2, F = facet(fs, xx, ss);
        const t2 = pick(rng, S.wire), s2 = 0.8 + rng() * 0.6, R2 = upTo(mix3(F.n, UP, 0.45), rng() * TAU);
        if (!clearBox(pc, xx, ss, F.y, F.y + t2.maxY * s2, t2.maxY * s2 * 0.5, SOFT, 1.0)) continue;
        const P2 = [xx, F.y, ss];
        seat(fs, t2, R2, s2, s2, s2, P2, F.n, 0.03);
        put(ctx, sw, t2, P2[0], P2[1], P2[2], R2, s2, s2, s2, tintOf(rng, [[0.95, 0.85, 0.35], [1.0, 0.45, 0.12], [0.7, 0.85, 0.35], [0.95, 0.95, 0.85]], 0.12), s2);
      }
      continue;
    }
    if (!tpl) continue;
    const h = (tpl.maxY - tpl.minY) * sc, reach = Math.max(tpl.r * sc, h * 0.45);
    if (!clearBox(pc, sp.x, sp.s, sp.y - reach * 0.5, sp.y + h, reach, solid ? SOLID : SOFT, solid ? 0 : 1.4)) continue;
    const Pp = [sp.x, sp.y, sp.s];
    seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
    put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
  }
  // a few silhouettes on the deep slopes below (big fans and sponges seen far down in the blue)
  const deepL = P.hot.length ? [] : hotCells(ctx, fs, pc, { W: 30, cell: 6, test: (rel) => rel < -28 && rel > -60 }), deep = new WPick(deepL, () => 1);
  for (let k = 0; k < Math.min(8, deepL.length); k++) {
    const sp = spot(ctx, fs, rng, deep, 5);
    if (!sp) continue;
    const isFan = rng() < 0.6, tpl = isFan ? pick(rng, poolOf(sp.g, 'nb2smFan', S.fan)) : T.barrel ? pick(rng, T.barrel) : null;
    if (!tpl) continue;
    const sc = isFan ? 1.0 + rng() * 0.6 : 1.2 + rng() * 0.8, R = isFan ? rotY(sv(sp.g, 53) * TAU + (rng() - 0.5) * 0.6) : rotY(rng() * TAU);
    const Pp = [sp.x, sp.y, sp.s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.05);
    put(ctx, isFan ? fan : st, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, isFan ? tintOf(rng, sp.rc.fanPal) : tintOf(rng, PAL.sponge), isFan ? sc : 1);
  }
  return { batches: [st, fan, sw], labels, pois };
}

// ---------------------------------------------------------------- chain B: colour and detail
export function* layoutSmB(ctx) {
  const Y = slice();
  if (presence(ctx, 'seamount') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'seamount'), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0x5a33), fs = nbFloor(ctx), pc = pathCache(ctx);
  const tk = ctx.tier === 'low' ? 0.85 : 1;
  const soft = new Batch(NBMAT.soft, 24000 * bk * tk); soft.lod = 'mid'; soft.soft = true;
  const mid = new Batch(MAT.static, 22000 * bk * tk); mid.lod = 'mid';
  const near = new Batch(MAT.static, 10000 * bk * tk); near.lod = 'near';
  const sw = new Batch(MAT.sway, 9000 * bk * tk); sw.lod = 'mid'; sw.soft = true;
  const vis = new WPick(P.hot.filter((c) => c.rel > -26), (c) => visW(c, pc));
  const N = Math.min(950, vis.list.length * 2.2) * lk * bk;
  for (let k = 0; k < N; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const sp = spot(ctx, fs, rng, vis);
    if (!sp) continue;
    const rc = sp.rc, d = Math.abs(sp.x - pc.x(sp.s)), close = d < 14;
    const tot = rc.soft * 1.6 + rc.jewel + rc.zoan + 1.0 + rc.crin * 0.5;
    let u = rng() * tot * rc.life;
    if ((u -= rc.soft * 1.6) < 0) { // soft coral clusters (clones share a colour)
      if (sp.n[1] < 0.35) continue;
      const n = 2 + Math.floor(rng() * 5), c0 = pick(rng, rc.softPal);
      for (let q = 0; q < n; q++) {
        const xx = sp.x + (rng() - 0.5) * 1.6, ss = sp.s + (rng() - 0.5) * 1.6, F = facet(fs, xx, ss);
        if (F.n[1] < 0.3) continue;
        const tpl = pick(rng, S.soft), sc = 1.0 + Math.pow(rng(), 1.5) * 1.4, R = upTo(mix3(UP, F.n, 0.45), rng() * TAU), h = tpl.maxY * sc;
        if (!clearBox(pc, xx, ss, F.y, F.y + h, tpl.r * sc, SOLID, 2.0)) continue;
        const Pp = [xx, F.y, ss];
        seat(fs, tpl, R, sc, sc, sc, Pp, F.n, 0.03);
        put(ctx, soft, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, rng() < 0.75 ? tintOf(rng, [c0], 0.12) : tintOf(rng, rc.softPal, 0.18), sc);
      }
      continue;
    }
    let tpl, sc, R, b, col, fa = 1, embed = 0.02, kind = SOLID;
    if ((u -= rc.jewel) < 0) { tpl = pick(rng, S.jewel); sc = 0.8 + rng() * 0.9; b = close ? near : mid; col = tintOf(rng, rc.jewelPal, 0.1); R = upTo(sp.n, rng() * TAU); }
    else if ((u -= rc.zoan) < 0) { tpl = pick(rng, S.zoan); sc = 0.8 + rng() * 0.9; b = close ? near : mid; col = tintOf(rng, PAL.zoan, 0.12); R = upTo(sp.n, rng() * TAU); }
    else if ((u -= 1.0) < 0) { tpl = pick(rng, S.enc); sc = 0.7 + rng() * 0.6; b = mid; col = tintOf(rng, scaled(rc.encPal, 0.72), 0.2); R = upTo(sp.n, rng() * TAU); }
    else { tpl = pick(rng, S.crin); sc = 0.9 + rng() * 0.8; b = sw; fa = sc; kind = SOFT; col = tintOf(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.08, 0.1], [0.2, 0.2, 0.22], [0.9, 0.9, 0.85], [0.5, 0.2, 0.7]], 0.12); R = upTo(mix3(UP, sp.n, 0.5), rng() * TAU); embed = 0.01; }
    const h = (tpl.maxY - tpl.minY) * sc;
    if (!clearBox(pc, sp.x, sp.s, sp.y - 0.3, sp.y + h, tpl.r * sc, kind, kind === SOFT ? 1.2 : 0)) continue;
    const Pp = [sp.x, sp.y, sp.s];
    seat(fs, tpl, R, sc, sc, sc, Pp, sp.n, embed);
    put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
  }
  // encrusting life on the faces nearest the camera: colony patches conformed to the rock on any slope
  // (sponge sheets, polyp carpets, hydroid turf, coralline crust) over broad, faint veils, with small
  // tube sponges, sponge lumps and polyp clusters standing out of them
  const cv = new WPick(P.hot.filter((c) => c.rel > -24), (c) => visW(c, pc) ** 2);
  const crust = new Crust(), bits = new Batch(MAT.static, 12000 * bk * tk); bits.lod = 'near';
  const labels = [], nVeil = Math.round((ctx.tier === 'low' ? 7 : 18) * bk), nCol = Math.round(110 * lk * bk), lab0 = [0, 0, 0, 0];
  for (let k = 0; k < nVeil + nCol && !cv.empty; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const sp = spot(ctx, fs, rng, cv, 3);
    if (!sp) continue;
    const rc = sp.rc;
    if (k < nVeil) {
      crustPatch(crust, fs, ctx, rng, sp.x, sp.s, { R: 1.8 + rng() * 2.0, ell: 0.55 + rng() * 0.45, colA: pick(rng, CR.veil), colB: pick(rng, CR.veil), kind: 4 });
      continue;
    }
    const jewel = rc.jewel >= rc.zoan, wS = 0.3 + rc.sponge, wP = rc.jewel + rc.zoan, wT = 0.6, wC = 0.7;
    let u = rng() * (wS + wP + wT + wC), kind = 0, cols;
    if ((u -= wS) < 0) { kind = 0; cols = scaled(rc.encPal, 0.5); }
    else if ((u -= wP) < 0) { kind = 1; cols = jewel ? scaled(rc.jewelPal, 0.5) : scaled(PAL.zoan, 0.48); }
    else if ((u -= wT) < 0) { kind = 2; cols = CR.turf; }
    else { kind = 3; cols = CR.coral; }
    const R = 0.45 + Math.pow(rng(), 1.6) * 1.7;
    const n = crustPatch(crust, fs, ctx, rng, sp.x, sp.s, { R, ell: 0.55 + rng() * 0.45, colA: pick(rng, cols), colB: pick(rng, cols), kind, pts: CPTS, maxPts: 4 });
    if (R > 0.9 && lab0[kind]++ < 1) {
      const L = kind === 1 ? (jewel ? [S.jewel[0].label, S.jewel[0].fact] : [S.zoan[0].label, S.zoan[0].fact]) : CRUST_LABEL[kind];
      labels.push([L[0], sp.x, sp.y + 0.3, sp.s, L[1]]);
    }
    // 3D growths seated on the patch, coloured like it
    const m = kind === 0 ? (rng() < 0.6 ? 1 + Math.floor(rng() * 2) : 0) : kind === 1 ? 1 + Math.floor(rng() * 3 * Math.min(1, R)) : 0;
    for (let q = 0; q < Math.min(m, n); q++) {
      const o = ((rng() * n) | 0) * 6, pn = [CPTS[o + 3], CPTS[o + 4], CPTS[o + 5]];
      const c0 = pick(rng, cols), cn = Math.max(c0[0], c0[1], c0[2], 0.05), tint = [c0[0] / cn, c0[1] / cn, c0[2] / cn];
      let tpl, sc, R2;
      if (kind === 1) { tpl = pick(rng, jewel ? S.jewel : S.zoan); sc = 0.6 + rng() * 0.6; R2 = upTo(pn, rng() * TAU); }
      else if (rng() < 0.65) { tpl = pick(rng, S.tubes); sc = 0.8 + rng() * 0.7; R2 = upTo(mix3(UP, pn, 0.45), rng() * TAU); }
      else { tpl = pick(rng, S.enc); sc = 0.6 + rng() * 0.6; R2 = upTo(pn, rng() * TAU); }
      const h = (tpl.maxY - tpl.minY) * sc;
      if (!clearBox(pc, CPTS[o], CPTS[o + 2], CPTS[o + 1] - 0.3, CPTS[o + 1] + h, tpl.r * sc)) continue;
      const Pp = [CPTS[o], CPTS[o + 1], CPTS[o + 2]];
      seat(fs, tpl, R2, sc, sc, sc, Pp, pn, 0.02);
      put(ctx, bits, tpl, Pp[0], Pp[1], Pp[2], R2, sc, sc, sc, tintOf(rng, [tint], 0.1));
    }
  }
  if (Y.over()) { yield; Y.reset(); }
  const crustMesh = crust.mesh(NB2.mat.crust, 'mid');
  if (crustMesh) { crustMesh.renderOrder = 1; crustMesh.receiveShadow = ctx.tier === 'high' || ctx.tier === 'ultra'; }
  // ledges: sun corals hanging beneath, feather stars and sponges on top
  for (const L of P.ledges) {
    if (Y.over()) { yield; Y.reset(); }
    decorateLedge(ctx, rng, L, near, sw, mid);
  }
  // crags: crowned with soft coral, feather stars and encrusting colour on their own upper faces
  for (const C of P.crags) {
    if (Y.over()) { yield; Y.reset(); }
    const g = segFor(ctx, C.s, 'seamount'), rc = g && recipeOf(g);
    if (!rc || !C.item) continue;
    const spots = itemSpots(C.item, ctx, 10, 0.55);
    for (let q = 0; q < Math.min(spots.length, 3 + Math.floor(rng() * 4)); q++) {
      const p = spots[(rng() * spots.length) | 0], u = rng();
      const isSoft = u < 0.35 * rc.soft, isCrin = !isSoft && u < 0.35 * rc.soft + 0.2 * rc.crin;
      const tpl = isSoft ? pick(rng, S.soft) : isCrin ? pick(rng, S.crin) : pick(rng, S.enc), sc = isSoft ? 0.6 + rng() * 0.5 : 0.7 + rng() * 0.7;
      const R = upTo(isSoft ? mix3(UP, p.n, 0.4) : p.n, rng() * TAU), h = tpl.maxY * sc;
      if (!clearBox(pc, p.x, p.s, p.y, p.y + h, tpl.r * sc, SOLID, isSoft ? 2 : 0)) continue;
      const Pp = decoOn(ctx, C.item, p, tpl, sc, R);
      if (!Pp) continue;
      const b = isSoft ? soft : isCrin ? sw : mid;
      put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, isCrin ? tintOf(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.9, 0.85]]) : tintOf(rng, isSoft ? rc.softPal : rc.encPal, 0.15), isSoft || isCrin ? sc : 1, { item: C.item });
    }
  }
  return { batches: [soft, mid, near, sw, bits], labels, extra: crustMesh ? [crustMesh] : [] };
}

function decorateLedge(ctx, rng, L, near, sw, mid) {
  const top = itemSupport(L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, true, null);
  const under = itemSupport(L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, false, null);
  const [x0, , , x1, , z1] = L.tpl.box;
  for (let k = 0; k < 9; k++) {
    const lx = lerp(x0, x1, 0.15 + rng() * 0.7) * L.sc, lz = lerp(0.1, z1, 0.25 + rng() * 0.6) * L.sc;
    const o = xf(L.R, 1, 1, 1, lx, 0, lz), x = L.x + o[0], s = L.s - o[2];
    const onTop = k < 4;
    const tpl = onTop ? (rng() < 0.5 ? pick(rng, S.crin) : pick(rng, S.enc)) : pick(rng, S.sun);
    const sup = onTop ? top : under, y = sup.at(x, s);
    if (!isFinite(y) || Math.abs(y) > 1e8) continue;
    const sc = 0.8 + rng() * 0.6, R = onTop ? rotY(rng() * TAU) : upTo([0, -1, 0], rng() * TAU);
    const B = basePts(tpl);
    // the rock must be thick enough under every base point
    let ok = true;
    for (let i = 0; i < B.length && ok; i += 3) {
      const q = xf(R, sc, sc, sc, B[i], B[i + 1], B[i + 2]), h = sup.at(x + q[0], s - q[2]), h2 = (onTop ? under : top).at(x + q[0], s - q[2]);
      if (!isFinite(h) || Math.abs(h) > 1e8 || !isFinite(h2) || Math.abs(h2) > 1e8 || Math.abs(h - h2) < 0.12) ok = false;
    }
    if (!ok) continue;
    let yy;
    if (onTop) {
      let gmax = -1e9;
      for (let i = 0; i < B.length; i += 3) { const q = xf(R, sc, sc, sc, B[i], B[i + 1], B[i + 2]); gmax = Math.max(gmax, y + q[1] - top.at(x + q[0], s - q[2])); }
      yy = y - gmax - 0.025;
    } else yy = hangY(under, B, R, sc, x, y, s, 0.025);
    if (!isFinite(yy)) continue;
    const isCrin = onTop && S.crin.includes(tpl);
    const col = isCrin ? tintOf(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.9, 0.85]]) : onTop ? tintOf(rng, PAL.enc) : tintOf(rng, [[1, 1, 1], [1.05, 0.9, 0.7]], 0.08);
    put(ctx, isCrin ? sw : onTop ? mid : near, tpl, x, yy, s, R, sc, sc, sc, col, isCrin ? sc : 1, { item: L.item });
  }
}

// ---------------------------------------------------------------- chain C: encrusting colour on the rock (decals)
export function layoutSmC(ctx) {
  if (presence(ctx, 'seamount') <= 0) return null;
  const P = plan(ctx), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0x5a44), fs = nbFloor(ctx), pc = pathCache(ctx);
  const b = new Builder();
  const vis = new WPick(P.hot.filter((c) => c.rel > -24 && c.ny > 0.6), (c) => visW(c, pc));
  const N = Math.min(36, vis.list.length * 0.12) * lk;
  for (let k = 0; k < N; k++) {
    const sp = spot(ctx, fs, rng, vis);
    if (!sp) continue;
    const r = 0.5 + rng() * 1.3;
    decalDisc(b, fs, ctx, sp.x, sp.s, r, r * (0.6 + rng() * 0.5), rng() * TAU, tintOf(rng, sp.rc.decalPal, 0.15), 3, 0.55 + rng() * 0.35, 5, 16);
  }
  const m = b.vc ? builderMesh(b, NBMAT.decal, null, 'mid') : null;
  if (m) m.renderOrder = 1;
  return { batches: [], extra: m ? [m] : [] };
}
