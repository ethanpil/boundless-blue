// Blue Hole: a shallow reef plateau with a vast circular sinkhole the path crosses. The plateau carries
// coral heads, fans and sponges between sand channels; at the rim the reef crowds to the edge, plate
// and table corals jut out over the void and sea fans lean into the blue. The wall below drops away
// with elephant-ear and tube sponges, black coral, fans, plates and overhanging ledges. Deeper, around
// 30-60 m, ice-age caves left galleries of stalactites under great limestone roofs, with stalagmites
// and columns on the shelves below, mostly on the far wall so the camera sees them as it crosses.
// Light shafts fall into the hole. POIs: 'bluehole' at the centre, 'stalactites' at each gallery.
import { Batch, TAU, rotY, rotX, mul3, presence, budgetK, CHUNK, T, lerp } from './core.js';
import { MAT } from './materials.js';
import { sv, blueHoleOf } from '../biomes.js';
import { pathCache, clearBox, SOLID, SOFT, seat, put, upTo, nrm, mix3, segFor, recipe, lowK, itemSupport, basePts, xf, slice, nbFloor, lab } from './nb_common.js';
import { encrust, featherStar, blackCoral, elephantEar, shelfPlate, sunCorals } from './nb_shapes.js';
import { giantFan, xmasBlackCoral, shelf, stalactites, stalagmite, speleoColumn, softTree, caveMouth } from './nb2_life.js';
import { NB2, pick, tintOf, chunkRng, poolOf, hangY, itemSpots, shaftMesh, Occ, planned, nearSupport, decoOn, embedOn } from './nb2_common.js';
import { rockJob, drain } from './rock_recipes.js';

const B = {};
export const BH_ROCKS = [
  { r: 'boulder', litho: 'limestone', growth: 1 }, { r: 'boulder', litho: 'limestone', kind: 'tafoni', growth: 1 }, { r: 'eroded', litho: 'limestone', growth: 1 },
  { r: 'cracked', litho: 'limestone', growth: 0.9 }, { r: 'conglomerate', growth: 0.8 }, { r: 'boulder', litho: 'sandstone', kind: 'tafoni', growth: 1 },
];
const LIMEC = [0.68, 0.64, 0.56];
export function initBluehole() {
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(6100 + i * 31 + o));
  B.fan = R(5, (s) => giantFan(s, { h: 1.4 + (s % 4) * 0.25, lobes: 1 + (s % 4 === 0 ? 1 : 0), cup: 0.05 + (s % 3) * 0.03 }));
  B.ear = R(5, (s) => elephantEar(s, { H: 0.8 + (s % 3) * 0.25, W: 0.8 + (s % 4) * 0.15, detail: 2 }), 1);
  B.black = [...R(3, (s) => blackCoral(s, { h: 1.0 + (s % 3) * 0.3 }), 2), ...R(3, (s) => xmasBlackCoral(s, { h: 1.2 + (s % 3) * 0.3 }), 3)];
  B.plate = R(6, (s) => shelfPlate(s, { R: 0.6 + (s % 4) * 0.2 }), 4);
  B.enc = R(8, (s) => encrust(s, { r: 0.18 + (s % 4) * 0.06, h: 0.06 + (s % 3) * 0.03, lobes: 0.6, detail: 1, elong: 1 + (s % 3) * 0.35 }), 5);
  B.sun = R(3, (s) => sunCorals(s, { n: 8 + (s % 3) * 3 }), 6);
  B.crin = R(4, (s) => featherStar(s, { arms: 10 + (s % 3) * 3, L: 0.2 + (s % 3) * 0.05, up: 0.5 }), 7);
  B.ledge = R(5, (s) => shelf(s, { w: 2.2 + (s % 3) * 0.7, d: 1.3 + (s % 3) * 0.4, th: 0.5 + (s % 3) * 0.12, col: LIMEC }), 8);
  B.cave = R(3, (s) => caveMouth(s, { W: 11 + (s % 3) * 2.5, H: 5.5 + (s % 2) * 1.5, D: 3.2 + (s % 3) * 0.6 }), 9);
  B.mites = R(6, (s) => stalactites(s, { n: 1 + (s % 6), L: 1.8 + (s % 4) * 0.7, r: 0.28 + (s % 3) * 0.08, curtain: s % 4 === 1 }), 11);
  B.mite = R(5, (s) => stalagmite(s, { H: 1.2 + (s % 4) * 0.6, r: 0.3 + (s % 3) * 0.1 }), 12);
  B.column = R(3, (s) => speleoColumn(s, { r: 0.45 + (s % 3) * 0.12 }), 13);
  B.rock = R(4, (s) => drain(rockJob(BH_ROCKS[s % BH_ROCKS.length], s)), 14);
  B.soft = R(4, (s) => softTree(s, { h: 0.6 + (s % 3) * 0.15 }), 15);
  lab(B.fan, 'Giant gorgonian sea fan', 'Fans at the lip catch plankton carried up the wall by the current.');
  lab(B.ear, 'Elephant ear sponge', 'A single large sponge can filter thousands of litres of water a day.');
  lab(B.black, 'Black coral', 'Black corals grow below the reach of strong light, on deep walls and under overhangs.');
  lab(B.plate, 'Plate coral', 'On the wall, plate corals grow in flat shelves to catch the light falling in from above.');
  lab(B.enc, 'Encrusting sponge', null);
  lab(B.sun, 'Sun coral (Tubastraea)', null);
  lab(B.crin, 'Feather star', null);
  lab(B.ledge, 'Limestone ledge', 'Blue holes formed as caves in limestone during the ice ages, when the sea was 120 m lower.');
  for (const t of [...B.crin, ...B.black]) t.solid = false;
  return B;
}

const recipeOf = (g) => recipe(g, 'nb2bh', (g) => ({
  coral: 0.7 + sv(g, 110) * 0.6, fans: 0.5 + sv(g, 111), sponges: 0.5 + sv(g, 112), black: 0.3 + sv(g, 113) * 0.9, plates: 0.4 + sv(g, 114),
  galleries: 3 + Math.floor(sv(g, 115) * 3), shafts: 0.6 + sv(g, 116) * 0.8,
  hard: [[0.95, 0.55, 0.2], [0.6, 0.78, 0.18], [0.78, 0.3, 0.88], [1.0, 0.42, 0.62], [1.0, 0.85, 0.2], [0.35, 0.6, 1.05], [0.15, 0.82, 0.68]].filter((_, i) => sv(g, 120 + i) > 0.3),
  fanPal: [[0.72, 0.1, 0.9], [1.0, 0.08, 0.16], [1.1, 0.45, 0.06], [1.05, 0.85, 0.12], [0.95, 0.15, 0.6]].filter((_, i) => sv(g, 130 + i) > 0.35),
  sponge: [[1.0, 0.42, 0.1], [0.9, 0.25, 0.08], [0.95, 0.55, 0.15], [0.7, 0.3, 0.55], [0.5, 0.35, 0.75]],
}));
// the galleries of a hole: angles from the centre (0 = straight ahead along +s) and depths below the rim
function galleriesOf(g, H) {
  if (H._gal) return H._gal;
  const rc = recipeOf(g), out = [];
  for (let k = 0; k < rc.galleries; k++) {
    // most on the far wall, which faces the camera as it crosses the hole; the rest anywhere
    const far = k < Math.ceil(rc.galleries * 0.6);
    const th = far ? (sv(g, 140 + k) - 0.5) * 1.6 : sv(g, 140 + k) * TAU;
    out.push({ th, depth: 30 + sv(g, 150 + k) * 26, k });
  }
  H._gal = out;
  return out;
}
// the segment whose hole touches this chunk
function holeFor(ctx) {
  for (const g of ctx.segments) {
    if (g.key !== 'bluehole') continue;
    const H = blueHoleOf(g);
    if (H && H.s + H.R + 14 > ctx.s0 && H.s - H.R - 14 < ctx.s1) return { g, H };
  }
  return null;
}
// point on the wall at angle th where the rendered floor crosses height yT (bisection on the mesh)
function wallSpot(fs, H, th, yT) {
  const sx = Math.sin(th), cs = Math.cos(th), P = (d) => [H.x + sx * d, H.s + cs * d];
  let d0 = H.R - 13, d1 = H.R + 2;
  let p0 = P(d0), p1 = P(d1);
  if (fs.at(p0[0], p0[1]) > yT || fs.at(p1[0], p1[1]) < yT) return null;
  for (let k = 0; k < 14; k++) { const m = (d0 + d1) / 2, p = P(m); if (fs.at(p[0], p[1]) > yT) d1 = m; else d0 = m; }
  const p = P(d1), y = fs.at(p[0], p[1]), n = [fs.nx, fs.ny, fs.nz], hl = Math.hypot(n[0], n[2]) || 1;
  return { x: p[0], s: p[1], y, n, hn: [n[0] / hl, 0, n[2] / hl], d: d1 };
}

// ---------------------------------------------------------------- plan: rim & plateau ground, wall structure, galleries
const PL = planned(function* (ctx) {
  const Y = slice(2.5);
  const rng = chunkRng(ctx, 0xb411), fs = nbFloor(ctx), pc = pathCache(ctx), occ = new Occ();
  const hf = holeFor(ctx), ledges = [], galleries = [], rocks = [];
  const g0 = segFor(ctx, ctx.s0 + 32, 'bluehole');
  // plateau boulders (limestone, with reef growth on top)
  for (let k = 0; k < 10; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'bluehole');
    if (!g || rng() > ctx.weightOf(s, 'bluehole') * 0.8) continue;
    const x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (5 + rng() * 30);
    if (hf && Math.hypot(x - hf.H.x, s - hf.H.s) < hf.H.R + 3) continue;
    const tpl = pick(rng, poolOf(g, 'nb2bhRock', B.rock)), sc = 0.8 + rng() * 1.2, y = fs.at(x, s), R = rotY(rng() * TAU), h = (tpl.maxY - tpl.minY) * sc;
    if (!occ.free(x, s, tpl.r * sc) || !clearBox(pc, x, s, y, y + h, tpl.r * sc)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.06);
    occ.add(x, s, tpl.r * sc);
    rocks.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, g });
  }
  if (hf) {
    const { g, H } = hf, rim = fs.at(H.x + H.R + 4, H.s) ;
    // ledges on the upper wall
    for (let k = 0; k < 14; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const th = rng() * TAU, sp = wallSpot(fs, H, th, rim - 3 - rng() * 22);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.6) continue;
      const tpl = pick(rng, B.ledge), sc = 0.8 + rng() * 0.6, R = rotY(Math.atan2(sp.hn[0], sp.hn[2]) + (rng() - 0.5) * 0.4);
      const Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, sc, sc, sc, Pp, sp.hn, 0.18);
      const reach = tpl.r * sc;
      if (!clearBox(pc, Pp[0], Pp[2], Pp[1] - reach, Pp[1] + reach, reach)) continue;
      if (ledges.some((L) => Math.hypot(L.x - Pp[0], L.s - Pp[2], L.y - Pp[1]) < 4)) continue;
      ledges.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, hn: sp.hn });
    }
    // stalactite galleries (ice-age cave mouths) whose wall position falls in this chunk
    for (const G of galleriesOf(g, H)) {
      if (Y.over()) { yield; Y.reset(); }
      const yT = rim - G.depth, sp = wallSpot(fs, H, G.th, yT);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1) continue;
      const grng = chunkRng({ s0: G.k * 977 + (g.seed & 0xffff) }, 0xb4a1);
      const tpl = pick(grng, poolOf(g, 'nb2bhCave', B.cave, 2)), R = rotY(Math.atan2(sp.hn[0], sp.hn[2]) + (grng() - 0.5) * 0.2);
      const Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, 1, 1, 1, Pp, sp.hn, 0.45);
      galleries.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, hn: sp.hn, G, seed: G.k * 131 + (g.seed & 0xfff) });
    }
  }
  return { hf, ledges, galleries, rocks, occ, g0 };
});
const plan = (ctx) => PL.get(ctx);
export function layoutBhP(ctx) { return presence(ctx, 'bluehole') > 0 ? PL.stage(ctx) : null; }
const UP = [0, 1, 0];
const inHole = (hf, x, s, pad = 0) => hf && Math.hypot(x - hf.H.x, s - hf.H.s) < hf.H.R + pad;

// ---------------------------------------------------------------- chain A: plateau + rim reef, wall structure
export function* layoutBhA(ctx) {
  const Y = slice();
  if (presence(ctx, 'bluehole') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'bluehole'), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0xb422), fs = nbFloor(ctx), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 80000 * bk);
  const sw = new Batch(MAT.sway, 20000 * bk); sw.soft = true;
  const fan = new Batch(NB2.mat.fan, 26000 * bk);
  const labels = [], pois = [];
  for (const L of P.ledges) { if (put(ctx, st, L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, tintOf(rng, [[1, 0.97, 0.92], [0.95, 0.92, 0.9]], 0.06))) L.item = st.last; }
  for (const R0 of P.rocks) { if (put(ctx, st, R0.tpl, R0.x, R0.y, R0.s, R0.R, R0.sc, R0.sc, R0.sc, tintOf(rng, [[1, 0.96, 0.9]], 0.06))) R0.item = st.last; }
  const hf = P.hf;
  if (hf && hf.H.s >= ctx.s0 && hf.H.s < ctx.s1) {
    const H = hf.H, py = pc.y(H.s);
    pois.push({ type: 'bluehole', x: H.x, y: py - 10, s: H.s, r: H.R, data: { name: 'The Blue Hole', fact: 'Blue holes are drowned sinkholes; their still, deep water can hold no oxygen at the bottom.' } });
    labels.push(['The Blue Hole', H.x, py - 6, H.s, 'The Great Blue Hole of Belize is 318 m across and 124 m deep; this one falls away into darkness too.']);
  }
  const SPECS = [
    { t: T.table, w: 1.6, sc: [0.8, 1.6], hard: true }, { t: T.stag, w: 2.0, sc: [0.8, 1.7], hard: true }, { t: T.brain, w: 1.6, sc: [0.6, 1.4], hard: true },
    { t: T.boulder, w: 1.2, sc: [0.7, 1.5], hard: true }, { t: T.coralMound, w: 0.8, sc: [0.6, 1.3], hard: true, mound: true }, { t: T.elkhorn, w: 0.8, sc: [0.8, 1.4], hard: true },
    { t: T.plateC, w: 0.8, sc: [0.9, 1.7], hard: true }, { t: T.pillar, w: 0.4, sc: [0.7, 1.2], hard: true },
    { t: T.fan, w: 1.4, sc: [0.9, 1.8], fan: true }, { t: T.whip, w: 1.0, sc: [0.8, 1.4], sway: true }, { t: T.soft, w: 0.8, sc: [0.8, 1.5], sway: true },
    { t: T.tubeSp, w: 1.0, sc: [0.8, 1.5], sponge: true }, { t: T.vase, w: 0.7, sc: [0.8, 1.4], sponge: true }, { t: T.barrel, w: 0.5, sc: [0.6, 1.2], sponge: true },
  ].filter((e) => e.t && e.t.length);
  let tot = 0; for (const e of SPECS) tot += e.w;
  // plateau reef between sand channels
  const N = 220 * bk * lk;
  for (let k = 0; k < N; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'bluehole');
    if (!g || rng() > ctx.weightOf(s, 'bluehole')) continue;
    const rc = recipeOf(g), x = pc.x(s) + (rng() - 0.5) * 2 * (1 + Math.pow(rng(), 1.3) * 32);
    if (inHole(hf, x, s, 12)) continue;
    if (rng() > rc.coral * 0.75) continue;
    placeReef(ctx, rng, fs, pc, x, s, rc, 0, hf, SPECS, tot, st, sw, fan);
  }
  // the rim: the reef crowds the lip, bigger and leaning out over the drop
  if (hf) {
    const H = hf.H, rc = recipeOf(hf.g);
    for (let k = 0; k < 420 * bk * lk; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const s = ctx.s0 + rng() * CHUNK, ds = s - H.s;
      let x, d;
      if (k & 1) { // where the path crosses the rim: right under and beside the camera
        x = pc.x(s) + (rng() - 0.5) * 2 * (1 + Math.pow(rng(), 1.5) * 16); d = Math.hypot(x - H.x, ds);
        if (d < H.R + 0.2 || d > H.R + 12) continue;
      } else { // all around the lip
        d = H.R + 0.2 + Math.pow(rng(), 1.8) * 12;
        if (Math.abs(ds) >= d) continue;
        x = H.x + (rng() < 0.5 ? -1 : 1) * Math.sqrt(d * d - ds * ds);
      }
      placeReef(ctx, rng, fs, pc, x, s, rc, 1 - (d - H.R) / 12, hf, SPECS, tot, st, sw, fan);
    }
    // just below the lip: plate corals in overlapping shelves, sea fans and sponges facing the blue
    const rim = fs.at(H.x + H.R + 4, H.s);
    for (let k = 0; k < 160 * bk * lk; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const s = ctx.s0 + rng() * CHUNK, ds = s - H.s;
      if (Math.abs(ds) >= H.R - 1) continue;
      const th = (rng() < 0.5 ? 1 : -1) * Math.acos(Math.max(-1, Math.min(1, ds / (H.R - 3)))); // the wall point at this s
      const sp = wallSpot(fs, H, th, rim - 0.4 - Math.pow(rng(), 1.3) * 7);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.8) continue;
      const face = Math.atan2(sp.hn[0], sp.hn[2]), u = rng();
      let tpl, sc, R, b = st, m = sp.hn, col, fa = 1, embed = 0.03;
      if (u < 0.5) { tpl = pick(rng, B.plate); sc = 1.0 + rng() * 0.9; R = rotY(face + (rng() - 0.5) * 0.5); col = tintOf(rng, [[0.6, 0.45, 0.28], [0.45, 0.55, 0.3], [0.65, 0.38, 0.55], [0.75, 0.6, 0.35]], 0.15); }
      else if (u < 0.75) { tpl = pick(rng, poolOf(hf.g, 'nb2bhFan', B.fan)); sc = 0.9 + rng() * 0.8; b = fan; fa = sc; m = null; R = mul3(rotY(face + (rng() - 0.5) * 0.4), rotX(0.2 + rng() * 0.25)); col = tintOf(rng, rc.fanPal.length ? rc.fanPal : [[1, 0.3, 0.1]], 0.15); }
      else { tpl = pick(rng, B.ear); sc = 1.0 + rng() * 0.8; R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.2 + rng() * 0.3)); col = tintOf(rng, rc.sponge, 0.15); embed = 0.05; }
      const h = (tpl.maxY - tpl.minY) * sc, reach = Math.max(tpl.r * sc, h * 0.5);
      if (!clearBox(pc, sp.x, sp.s, sp.y - reach, sp.y + h, reach)) continue;
      const Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
      put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
    }
  }
  // the wall: sponges, black coral, fans and plates down to ~40 m below the rim
  if (hf) {
    const H = hf.H, rim = fs.at(H.x + H.R + 4, H.s), g = hf.g, rc = recipeOf(g);
    for (let k = 0; k < 240 * bk * lk; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const th = rng() * TAU, depth = 1 + Math.pow(rng(), 1.5) * 40, sp = wallSpot(fs, H, th, rim - depth);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.75) continue;
      const u = rng() * (rc.sponges * 1.6 + rc.black + rc.fans + rc.plates), face = Math.atan2(sp.hn[0], sp.hn[2]);
      let tpl, sc, R, b = st, col, fa = 1, m = sp.n, embed = 0.05, solid = true;
      if (u < rc.sponges * 1.6) {
        if (rng() < 0.55) { tpl = pick(rng, B.ear); sc = 0.9 + rng() * 0.9; R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.15 + rng() * 0.35)); }
        else { tpl = pick(rng, T.tubeSp || B.ear); sc = 0.9 + rng() * 0.8; R = upTo(mix3(sp.n, UP, 0.35), rng() * TAU); }
        col = tintOf(rng, rc.sponge, 0.15);
      } else if (u < rc.sponges * 1.6 + rc.black) {
        tpl = pick(rng, B.black); sc = 0.9 + rng() * 0.9; b = sw; fa = sc * 0.5; solid = false; col = tintOf(rng, [[0.92, 0.92, 0.86], [0.55, 0.75, 0.4], [0.95, 0.65, 0.3]], 0.1);
        R = upTo(nrm([sp.n[0], sp.n[1] + 0.25, sp.n[2]]), rng() * TAU);
      } else if (u < rc.sponges * 1.6 + rc.black + rc.fans) {
        tpl = pick(rng, poolOf(g, 'nb2bhFan', B.fan)); sc = 0.9 + rng() * 0.8; b = fan; fa = sc; m = null; col = tintOf(rng, rc.fanPal.length ? rc.fanPal : [[1, 0.3, 0.1]], 0.15);
        R = mul3(rotY(face + (rng() - 0.5) * 0.4), rotX(0.12 + rng() * 0.25));
      } else { // plate shelves stacked up the face
        tpl = pick(rng, B.plate); sc = 0.9 + rng() * 0.7; R = rotY(face + (rng() - 0.5) * 0.5); m = sp.hn; embed = 0.03;
        col = tintOf(rng, [[0.6, 0.45, 0.28], [0.45, 0.55, 0.3], [0.65, 0.38, 0.55], [0.75, 0.6, 0.35]], 0.15);
      }
      const h = (tpl.maxY - tpl.minY) * sc, reach = Math.max(tpl.r * sc, h * 0.5);
      if (!clearBox(pc, sp.x, sp.s, sp.y - reach, sp.y + h, reach, solid ? SOLID : SOFT, solid ? 0 : 1.2)) continue;
      const Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
      put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
    }
  }
  return { batches: [st, sw, fan], labels, pois };
}
function placeReef(ctx, rng, fs, pc, x, s, rc, rimK, hf, SPECS, tot, st, sw, fan) {
  let u = rng() * tot, e = SPECS[0];
  for (const q of SPECS) { if ((u -= q.w) < 0) { e = q; break; } }
  if (e.fan && rng() > rc.fans) return;
  if (e.sponge && rng() > rc.sponges) return;
  const tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng()) * (1 + rimK * 0.35), y = fs.at(x, s), n = [fs.nx, fs.ny, fs.nz];
  if (n[1] < 0.55) return;
  // at the rim growth leans out over the drop
  let up = mix3(UP, n, e.mound ? 0.7 : 0.4);
  if (rimK > 0 && hf) { const dx = x - hf.H.x, ds = s - hf.H.s, l = Math.hypot(dx, ds) || 1; up = nrm([up[0] - dx / l * 0.35 * rimK, up[1], up[2] + ds / l * 0.35 * rimK]); }
  const R = e.fan && hf && rimK > 0 ? mul3(rotY(Math.atan2(-(x - hf.H.x), (s - hf.H.s)) + (rng() - 0.5) * 0.5), rotX(-0.15 * rimK)) : upTo(up, rng() * TAU);
  const h = (tpl.maxY - tpl.minY) * sc;
  if (!clearBox(pc, x, s, y, y + h, tpl.r * sc, e.sway ? SOFT : SOLID, e.sway ? 1.0 : 0)) return;
  const Pp = [x, y, s];
  seat(fs, tpl, R, sc, sc, sc, Pp, null, e.mound ? 0.1 : 0.04);
  const col = e.fan ? tintOf(rng, rc.fanPal.length ? rc.fanPal : [[1, 0.3, 0.6]], 0.15) : e.sponge ? tintOf(rng, rc.sponge, 0.15)
    : e.sway ? tintOf(rng, [[0.72, 0.12, 0.98], [0.98, 0.14, 0.62], [1.1, 0.42, 0.05], [1.0, 0.75, 0.3]], 0.15) : tintOf(rng, rc.hard.length ? rc.hard : [[1, 0.6, 0.3]], 0.18);
  put(ctx, e.fan ? fan : e.sway ? sw : st, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, e.sway || e.fan ? sc : 1);
}

// ---------------------------------------------------------------- chain B: galleries (roofs, stalactites, stalagmites, columns) + ledge life
export function* layoutBhB(ctx) {
  const Y = slice();
  if (presence(ctx, 'bluehole') <= 0) return null;
  const P = plan(ctx);
  const rng = chunkRng(ctx, 0xb433), fs = nbFloor(ctx), pc = pathCache(ctx);
  const rock = new Batch(MAT.static, 40000);
  const near = new Batch(MAT.static, 12000); near.lod = 'near';
  const sw = new Batch(MAT.sway, 6000); sw.lod = 'mid'; sw.soft = true;
  const labels = [], pois = [];
  for (const Gp of P.galleries) {
    if (Y.over()) { yield; Y.reset(); }
    const grng = chunkRng({ s0: Gp.seed }, 0xb4b2), M = Gp.tpl.mouth;
    if (!put(ctx, rock, Gp.tpl, Gp.x, Gp.y, Gp.s, Gp.R, 1, 1, 1, tintOf(grng, [[1, 0.97, 0.92], [0.94, 0.92, 0.88]], 0.05))) continue;
    const cave = rock.last;
    const ceil = nearSupport(Gp.tpl, Gp.x, Gp.y, Gp.s, Gp.R, 1, 1, 1, true, 0), flo = nearSupport(Gp.tpl, Gp.x, Gp.y, Gp.s, Gp.R, 1, 1, 1, false, 0);
    const at = (lx, lz) => { const o = xf(Gp.R, 1, 1, 1, lx, 0, lz); return [Gp.x + o[0], Gp.s - o[2]]; };
    // a hanging forest of stalactites and curtains from the cave roof
    for (let q = 0; q < 46; q++) {
      const [x, s] = at((grng() - 0.5) * 2 * M.W / 2 * M.rm * 0.88, M.D * (0.15 + grng() * 0.72)), y = ceil.at(x, s);
      if (ceil.miss) { ceil.miss = 0; continue; }
      const yl = y - Gp.y;
      if (yl < M.H / 2 * 0.2) continue; // the low sides of the mouth
      // a support locked onto this ceiling sheet (never the outer surface of the hood above it)
      const sheet = nearSupport(Gp.tpl, Gp.x, Gp.y, Gp.s, Gp.R, 1, 1, 1, true, yl - 0.35);
      const tpl = pick(grng, B.mites), sc = 0.5 + grng() * 0.8, R = upTo([0, -1, 0], grng() * TAU), Bp = basePts(tpl);
      const yy = hangY(sheet, Bp, R, sc, x, y, s, 0.08);
      if (!isFinite(yy) || sheet.miss || yy - y > 0.5) continue;
      // keep the tips above the cave floor
      const fy = flo.at(x, s);
      if (flo.miss) { flo.miss = 0; continue; }
      if (yy - tpl.maxY * sc < fy + 0.4) continue;
      const Ps = [x, yy, s];
      if (!embedOn(cave, ctx.s0, tpl, R, sc, Ps, [0, -1, 0], 0.06)) continue;
      put(ctx, rock, tpl, Ps[0], Ps[1], Ps[2], R, sc, sc, sc, tintOf(grng, [[1, 0.97, 0.9], [0.95, 0.92, 0.85], [1.05, 0.98, 0.88]], 0.06), 1, { item: cave });
    }
    // stalagmites and columns rising from the cave floor
    for (let q = 0; q < 12; q++) {
      const [x, s] = at((grng() - 0.5) * 2 * M.W / 2 * M.rm * 0.75, M.D * (0.2 + grng() * 0.6)), y = flo.at(x, s);
      if (flo.miss) { flo.miss = 0; continue; }
      const cy = ceil.at(x, s);
      if (ceil.miss) { ceil.miss = 0; continue; }
      const column = cy - y < 6 && grng() < 0.3;
      const tpl = column ? pick(grng, B.column) : pick(grng, B.mite);
      const sc = column ? 0.6 + grng() * 0.4 : 0.5 + grng() * 0.7, sy = column ? (cy - y) / 0.96 : sc, R = rotY(grng() * TAU);
      if (!column && y + tpl.maxY * sy > cy - 0.3) continue;
      const Pp = [x, y, s];
      seat(flo, tpl, R, sc, sy, sc, Pp, null, 0.06);
      if (flo.miss) { flo.miss = 0; continue; }
      if (!embedOn(cave, ctx.s0, tpl, R, sc, Pp, [0, 1, 0], 0.06, sy)) continue;
      put(ctx, rock, tpl, Pp[0], Pp[1], Pp[2], R, sc, sy, sc, tintOf(grng, [[1, 0.97, 0.9], [0.95, 0.92, 0.85]], 0.06), 1, { item: cave });
    }
    const cx = Gp.x + Gp.hn[0] * M.D * 0.8, cs = Gp.s - Gp.hn[2] * M.D * 0.8;
    pois.push({ type: 'stalactites', x: cx, y: Gp.y, s: cs, r: Math.max(4, M.W * 0.4), data: { name: 'Stalactite gallery', fact: B.mites[0].fact } });
    labels.push(['Stalactite gallery', cx, Gp.y + 1, cs, 'Stalactites only grow in air: these formed when this hole was a dry cave, before the sea rose.']);
  }
  // ledges: sun corals beneath, crinoids and encrusting colour on top
  for (const L of P.ledges) {
    if (Y.over()) { yield; Y.reset(); }
    if (!L.item) continue;
    const top = itemSupport(L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, true, null), under = itemSupport(L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, false, null);
    const [x0, , , x1, , z1] = L.tpl.box;
    for (let k = 0; k < 7; k++) {
      const lx = lerp(x0, x1, 0.15 + rng() * 0.7) * L.sc, lz = lerp(0.1, z1, 0.25 + rng() * 0.6) * L.sc;
      const o = xf(L.R, 1, 1, 1, lx, 0, lz), x = L.x + o[0], s = L.s - o[2], onTop = k < 4;
      const tpl = onTop ? (rng() < 0.4 ? pick(rng, B.crin) : pick(rng, B.enc)) : pick(rng, B.sun), sup = onTop ? top : under, y = sup.at(x, s);
      if (!isFinite(y) || Math.abs(y) > 1e8) continue;
      const sc = 0.8 + rng() * 0.6, R = onTop ? rotY(rng() * TAU) : upTo([0, -1, 0], rng() * TAU), Bp = basePts(tpl);
      let ok = true;
      for (let i = 0; i < Bp.length && ok; i += 3) { const q = xf(R, sc, sc, sc, Bp[i], Bp[i + 1], Bp[i + 2]), h = sup.at(x + q[0], s - q[2]), h2 = (onTop ? under : top).at(x + q[0], s - q[2]); if (!isFinite(h) || Math.abs(h) > 1e8 || !isFinite(h2) || Math.abs(h2) > 1e8 || Math.abs(h - h2) < 0.12) ok = false; }
      if (!ok) continue;
      let yy;
      if (onTop) { let gm = -1e9; for (let i = 0; i < Bp.length; i += 3) { const q = xf(R, sc, sc, sc, Bp[i], Bp[i + 1], Bp[i + 2]); gm = Math.max(gm, y + q[1] - top.at(x + q[0], s - q[2])); } yy = y - gm - 0.025; }
      else yy = hangY(under, Bp, R, sc, x, y, s, 0.025);
      if (!isFinite(yy)) continue;
      const isCrin = onTop && B.crin.includes(tpl);
      put(ctx, isCrin ? sw : near, tpl, x, yy, s, R, sc, sc, sc, isCrin ? tintOf(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.9, 0.85]]) : onTop ? tintOf(rng, [[1.0, 0.35, 0.05], [0.85, 0.06, 0.08], [0.55, 0.12, 0.75]]) : tintOf(rng, [[1, 1, 1]], 0.08), isCrin ? sc : 1, { item: L.item });
    }
    if (L.y > pc.y(L.s) - 30) pois.push({ type: 'wall-overhang', x: L.x + L.hn[0] * 1.2, y: L.y - 0.8, s: L.s - L.hn[2] * 1.2, r: 2.5, data: { name: 'Ledge overhang', fact: 'Groupers and snappers hang under the ledges of the wall, out of the current.' } });
  }
  return { batches: [rock, near, sw], labels, pois };
}

// ---------------------------------------------------------------- chain C: plateau detail, rock tops, light shafts into the hole
export function* layoutBhC(ctx, env) {
  const Y = slice();
  if (presence(ctx, 'bluehole') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'bluehole'), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0xb444), fs = nbFloor(ctx), pc = pathCache(ctx), hf = P.hf;
  const near = new Batch(MAT.static, 16000 * bk); near.lod = 'near';
  const sw = new Batch(MAT.sway, 8000 * bk); sw.lod = 'mid'; sw.soft = true;
  const DET = [
    { t: T.star, w: 0.5, sc: [0.1, 0.18], col: [[1.0, 0.45, 0.12], [0.9, 0.2, 0.2]] }, { t: T.urchin, w: 0.6, sc: [0.06, 0.11], col: [[1, 1, 1]] },
    { t: T.rubble, w: 1.4, sc: [0.7, 1.5], col: [[0.85, 0.8, 0.72]] }, { t: B.enc, w: 1.0, sc: [0.8, 1.5], col: [[1.0, 0.35, 0.05], [0.55, 0.12, 0.75], [1.05, 0.8, 0.1]] },
    { t: T.anem, w: 0.4, sc: [0.8, 1.3], col: [[1, 1, 1]], sway: true }, { t: T.clam, w: 0.3, sc: [0.6, 1.1], col: [[1, 1, 1]] },
  ].filter((e) => e.t && e.t.length);
  let tot = 0; for (const e of DET) tot += e.w;
  for (let k = 0; k < 170 * lk * bk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'bluehole');
    if (!g || rng() > ctx.weightOf(s, 'bluehole')) continue;
    const x = pc.x(s) + (rng() - 0.5) * 2 * (0.5 + Math.pow(rng(), 1.4) * 18);
    if (inHole(hf, x, s, 0.6)) continue;
    let u = rng() * tot, e = DET[0];
    for (const q of DET) { if ((u -= q.w) < 0) { e = q; break; } }
    const tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng()), y = fs.at(x, s);
    if (fs.ny < 0.6) continue;
    const R = upTo(mix3(UP, [fs.nx, fs.ny, fs.nz], 0.8), rng() * TAU);
    if (!clearBox(pc, x, s, y, y + (tpl.maxY - tpl.minY) * sc, tpl.r * sc, e.sway ? SOFT : SOLID, e.sway ? 1 : 0)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.02);
    put(ctx, e.sway ? sw : near, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tintOf(rng, e.col, 0.12), e.sway ? sc : 1);
  }
  // reef growth on the plateau boulders
  for (const R0 of P.rocks) {
    if (Y.over()) { yield; Y.reset(); }
    if (!R0.item) continue;
    const spots = itemSpots(R0.item, ctx, 12, 0.5);
    for (let q = 0; q < Math.min(spots.length, 4); q++) {
      const p = spots[(rng() * spots.length) | 0], tpl = rng() < 0.5 ? pick(rng, B.enc) : pick(rng, B.crin), isCrin = B.crin.includes(tpl), sc = 0.7 + rng() * 0.7;
      const Rd = upTo(p.n, rng() * TAU), Pp = decoOn(ctx, R0.item, p, tpl, sc, Rd);
      if (!Pp) continue;
      const [x, y, s] = Pp;
      if (!clearBox(pc, x, s, y, y + 0.4, tpl.r * sc, isCrin ? SOFT : SOLID, isCrin ? 1 : 0)) continue;
      put(ctx, isCrin ? sw : near, tpl, x, y, s, Rd, sc, sc, sc, isCrin ? tintOf(rng, [[1.1, 0.85, 0.1], [0.9, 0.9, 0.85]]) : tintOf(rng, [[1.0, 0.35, 0.05], [0.55, 0.12, 0.75], [1.05, 0.8, 0.1]]), isCrin ? sc : 1, { item: R0.item });
    }
  }
  const extra = [];
  // light shafts falling into the hole
  if (hf) {
    yield;
    const H = hf.H, rc = recipeOf(hf.g), sun = env && env.U && env.U.uSunDir ? env.U.uSunDir.value : { x: 0.3, y: 0.9, z: -0.2 }, beams = [];
    const nB = Math.round((3 + rng() * 3) * rc.shafts);
    for (let k = 0; k < nB * 3 && beams.length < nB; k++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * H.R * 0.8, x = H.x + Math.sin(a) * d, s = H.s + Math.cos(a) * d;
      if (s < ctx.s0 || s >= ctx.s1) continue;
      beams.push({ x, s, yTop: ctx.surfaceY - 0.05, yBot: pc.y(s) - 55 - rng() * 25, r0: 0.8 + rng() * 1.8, ph: rng() });
    }
    const sm = shaftMesh(ctx, beams, sun);
    if (sm) extra.push(sm);
  }
  return { batches: [near, sw], extra };
}
