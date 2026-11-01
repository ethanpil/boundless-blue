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
import { noise1 } from '../noise.js';
import { pathCache, clearBox, SOLID, SOFT, seat, put, upTo, nrm, mix3, segFor, recipe, lowK, itemSupport, basePts, xf, slice, nbFloor, lab } from './nb_common.js';
import { encrust, featherStar, blackCoral, elephantEar, shelfPlate, sunCorals } from './nb_shapes.js';
import { giantFan, xmasBlackCoral, shelf, stalactites, stalagmite, speleoColumn, softTree, caveMouth } from './nb2_life.js';
import { NB2, pick, tintOf, chunkRng, poolOf, hangY, itemSpots, shaftMesh, Occ, planned, nearSupport, decoOn, embedOn } from './nb2_common.js';
import { Crust, crustPatch } from './nb2_crust.js';
import { rockJob, drain } from './rock_recipes.js';

const B = {};
// strata ledge: a long, thick, rugged limestone shelf with a shaded underside (strata bands round the wall)
export function ribTpl(seed, k) {
  const t = shelf(seed, { w: 4.4 + (k % 3) * 0.9, d: 1.8 + (k % 3) * 0.35, th: 0.62 + (k % 4) * 0.14, col: LIMEC, under: 0.4, rough: 0.46, growth: 0.5 });
  t.label = 'Limestone ledge'; t.fact = 'The ledges ringing a blue hole mark old sea levels, when the ice-age sea stood still long enough to cut a notch.';
  return t;
}
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
  B.rib = R(4, (s) => ribTpl(s, s % 6), 16);
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

// (hard: branching corals, which can be vivid; tables, plates and massive heads keep the tans, browns and
// creams of living colonies: a lime or teal table coral two metres across reads as a plastic disc)
const TABLEC = [[0.6, 0.48, 0.32], [0.52, 0.42, 0.3], [0.66, 0.58, 0.44], [0.48, 0.46, 0.32], [0.58, 0.44, 0.46], [0.46, 0.48, 0.52]];
const MASSC = [[0.82, 0.64, 0.4], [0.66, 0.5, 0.32], [0.62, 0.62, 0.36], [0.86, 0.78, 0.56], [0.8, 0.62, 0.3], [0.74, 0.54, 0.5], [0.58, 0.5, 0.6], [0.55, 0.62, 0.42]];
const PLATEC = [[0.5, 0.37, 0.23], [0.46, 0.42, 0.28], [0.52, 0.34, 0.4], [0.58, 0.46, 0.3], [0.42, 0.34, 0.26]];
const recipeOf = (g) => recipe(g, 'nb2bh', (g) => ({
  coral: 0.7 + sv(g, 110) * 0.6, fans: 0.5 + sv(g, 111), sponges: 0.5 + sv(g, 112), black: 0.3 + sv(g, 113) * 0.9, plates: 0.4 + sv(g, 114),
  galleries: 3 + Math.floor(sv(g, 115) * 3), shafts: 0.6 + sv(g, 116) * 0.8,
  hard: [[0.95, 0.55, 0.2], [0.85, 0.7, 0.45], [0.78, 0.3, 0.88], [1.0, 0.42, 0.62], [0.9, 0.78, 0.4], [0.35, 0.6, 1.05], [0.7, 0.62, 0.5]].filter((_, i) => sv(g, 120 + i) > 0.3),
  fanPal: [[0.72, 0.1, 0.9], [1.0, 0.08, 0.16], [1.1, 0.45, 0.06], [1.05, 0.85, 0.12], [0.95, 0.15, 0.6]].filter((_, i) => sv(g, 130 + i) > 0.35),
  sponge: [[1.0, 0.42, 0.1], [0.9, 0.25, 0.08], [0.95, 0.55, 0.15], [0.7, 0.3, 0.55], [0.5, 0.35, 0.75]],
}));
// the galleries of a hole: angles from the centre (0 = straight ahead along +s) and depths below the rim
function galleriesOf(g, H) {
  if (H._gal) return H._gal;
  const rc = recipeOf(g), out = [];
  for (let k = 0; k < rc.galleries; k++) {
    // most on the far wall, which faces the camera as it crosses the hole; the rest anywhere
    // (deeper than ~30 m the camera crossing at the rim never sees them: they sit 12-30 m down, the first
    // one dead ahead on the far wall where the path climbs out)
    const far = k < Math.ceil(rc.galleries * 0.6);
    const th = k === 0 ? (sv(g, 140) - 0.5) * 0.6 : far ? (sv(g, 140 + k) - 0.5) * 1.8 : sv(g, 140 + k) * TAU;
    out.push({ th, depth: (k === 0 ? 12 : 14) + sv(g, 150 + k) * (k === 0 ? 8 : 16), k });
  }
  H._gal = out;
  return out;
}
// strata bands round the hole: depths below the rim of the ledge lines (3 or 4, from ~4 m to ~35 m)
function bandsOf(g, H) {
  if (H._bands) return H._bands;
  const n = 3 + (sv(g, 160) > 0.45 ? 1 : 0), out = [];
  for (let k = 0; k < n; k++) out.push({ k, d: 3.5 + k * 8.5 + sv(g, 161 + k) * 3.5, ph: sv(g, 170 + k) * TAU });
  H._bands = out;
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
// The wall this chunk owns. Wall points at radius Rw lie at s = H.s + Rw cos(th), so the angles inside
// [s0, s1) form one arc on each side. Sampling th uniformly along those arcs spends every attempt on this
// chunk's wall and spreads growth evenly round the rim. (Angles drawn over the whole circle were mostly
// discarded as other chunks' wall, and spots drawn uniformly in s starved the far wall, the one the camera
// faces while crossing, because there ds/dth -> 0.)
// (the wall spans radii R - 13 .. R + 2, as wallSpot searches: the arcs are the union over that band,
// or where the far rim straddles a chunk boundary its top belongs to a chunk whose mid-radius arc is empty)
function arcOf(ctx, H) {
  let a0 = Infinity, a1 = -Infinity;
  for (const Rw of [H.R - 13, H.R + 2]) {
    const c0 = Math.max(-1, Math.min(1, (ctx.s0 - H.s) / Rw)), c1 = Math.max(-1, Math.min(1, (ctx.s1 - H.s) / Rw));
    if (c1 <= c0) continue;
    a0 = Math.min(a0, Math.acos(c1)); a1 = Math.max(a1, Math.acos(c0));
  }
  if (!(a1 > a0)) return null;
  // len: the arcs' length at mid radius (attempt counts); wall: the wall this chunk really owns (budgets)
  const Rm = H.R - 5, m0 = Math.max(-1, Math.min(1, (ctx.s0 - H.s) / Rm)), m1 = Math.max(-1, Math.min(1, (ctx.s1 - H.s) / Rm));
  return { a0, a1, len: 2 * Rm * (a1 - a0), wall: Math.max(12, 2 * Rm * (Math.acos(m0) - Math.acos(m1))) };
}
// an angle along the chunk's arcs; the near wall (under and behind the camera as it crosses) is thinned to `nearK`
function arcTh(rng, A, nearK = 0.3) {
  for (let k = 0; k < 3; k++) {
    const th = (A.a0 + rng() * (A.a1 - A.a0)) * (rng() < 0.5 ? -1 : 1);
    if (rng() < nearK + (1 - nearK) * (0.5 + 0.5 * Math.cos(th))) return th;
  }
  return null;
}

// ---------------------------------------------------------------- plan: rim & plateau ground, wall structure, galleries
const PL = planned(function* (ctx) {
  const Y = slice(2.5);
  const rng = chunkRng(ctx, 0xb411), fs = nbFloor(ctx), pc = pathCache(ctx), occ = new Occ();
  const hf = holeFor(ctx), ledges = [], galleries = [], rocks = [];
  const g0 = segFor(ctx, ctx.s0 + 32, 'bluehole');
  // plateau boulders (limestone, with reef growth on top)
  // (a few rock shapes at one scale and one tint read as copies: every boulder gets its own squash,
  // burial and colour, and a share of the heads are coral, not rock)
  const heads = [T.coralMound, T.boulder, T.brain].filter((l) => l && l.length);
  for (let k = 0; k < 14; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'bluehole');
    if (!g || rng() > ctx.weightOf(s, 'bluehole') * 0.8) continue;
    const x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (5 + rng() * 30);
    if (hf && Math.hypot(x - hf.H.x, s - hf.H.s) < hf.H.R + 3) continue;
    const coral = heads.length && rng() < 0.4, tpl = coral ? pick(rng, pick(rng, heads)) : pick(rng, poolOf(g, 'nb2bhRock', B.rock));
    const sc = coral ? 0.9 + rng() * 1.1 : 0.7 + rng() * 1.3, sy = sc * (coral ? 0.8 + rng() * 0.3 : 0.55 + rng() * 0.55), sz = sc * (0.8 + rng() * 0.4);
    const y = fs.at(x, s), R = rotY(rng() * TAU), h = (tpl.maxY - tpl.minY) * sy, r = tpl.r * Math.max(sc, sz);
    if (!occ.free(x, s, r) || !clearBox(pc, x, s, y, y + h, r)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sy, sz, Pp, null, coral ? 0.08 : 0.06 + h * (0.05 + 0.15 * rng()));
    occ.add(x, s, r);
    const col = coral ? tintOf(rng, [[1.0, 0.6, 0.35], [0.75, 0.8, 0.45], [0.95, 0.75, 0.7], [0.85, 0.5, 0.75]], 0.12)
      : tintOf(rng, [[1, 0.96, 0.9], [1.06, 0.95, 0.8], [0.92, 0.98, 0.84], [1.05, 0.88, 0.88], [0.85, 0.82, 0.78]], 0.06);
    rocks.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, sy, sz, g, col });
  }
  const outcrops = [], galSpots = [];
  const A = hf && arcOf(ctx, hf.H);
  if (hf) {
    const { g, H } = hf, rim = fs.at(H.x + H.R + 4, H.s) ;
    // stalactite galleries (ice-age cave mouths): all of the hole's, so buttresses and ledges keep out of
    // every mouth, including those of neighbouring chunks; the ones whose wall position falls in this chunk are built
    for (const G of galleriesOf(g, H)) {
      if (Y.over()) { yield; Y.reset(); }
      const sp = wallSpot(fs, H, G.th, rim - G.depth);
      if (!sp) continue;
      const grng = chunkRng({ s0: G.k * 977 + (g.seed & 0xffff) }, 0xb4a1);
      const tpl = pick(grng, poolOf(g, 'nb2bhCave', B.cave, 2)), R = rotY(Math.atan2(sp.hn[0], sp.hn[2]) + (grng() - 0.5) * 0.2);
      galSpots.push({ x: sp.x, y: sp.y, s: sp.s, r: (tpl.mouth ? tpl.mouth.W * 0.6 : 7) + 1 });
      if (sp.s < ctx.s0 || sp.s >= ctx.s1) continue;
      const Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, 1, 1, 1, Pp, sp.hn, 0.45);
      galleries.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, hn: sp.hn, G, seed: G.k * 131 + (g.seed & 0xfff) });
    }
    const nearGal = (x, y, s, r) => galSpots.some((q) => Math.hypot(q.x - x, q.s - s, q.y - y) < q.r + r);
    // Strata: rugged ledges in bands round the hole, fusing into ribs broken by gaps. Seen across the
    // hole they draw horizontal lines of lit tops over shaded undercuts, the way a sinkhole wall reads.
    const ribs = poolOf(g, 'nb2bhRib', B.rib), Rw = H.R - 4, step = 2.7 / Rw;
    for (const bd of A ? bandsOf(g, H) : []) for (const sgn of [1, -1]) for (let th0 = A.a0 + rng() * step; th0 < A.a1; th0 += step) {
      if (Y.over()) { yield; Y.reset(); }
      const th = sgn * th0;
      if (noise1(th * Rw / 13 + bd.k * 37.1, 919 + bd.k) < -0.28) continue; // a gap in the band
      const dep = bd.d + 1.3 * Math.sin(th * (2 + bd.k) + bd.ph) + 0.6 * Math.sin(th * 9 + bd.k * 2.1) + (rng() - 0.5) * 0.35;
      const sp = wallSpot(fs, H, th, rim - dep);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.6) continue;
      const tpl = pick(rng, ribs), sc = 0.85 + rng() * 0.35, R = rotY(Math.atan2(sp.hn[0], sp.hn[2]) + (rng() - 0.5) * 0.2), Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, sc, sc, sc, Pp, sp.hn, 0.2);
      const reach = tpl.r * sc;
      if (!clearBox(pc, Pp[0], Pp[2], Pp[1] - reach, Pp[1] + reach, reach) || nearGal(Pp[0], Pp[1], Pp[2], reach * 0.7)) continue;
      ledges.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, hn: sp.hn, rib: true });
    }
    // Limestone buttresses: blocks of the old cave wall standing out of the face (a boulder or slab from
    // the segment's rock pool pressed flat side first onto the wall facet; pinnacles would stick out
    // sideways like spikes). The heightfield draws the 140 m drop as a few long smooth facets; these give
    // it relief, in clusters that fuse into a rugged face, with lit tops and shaded undersides that read
    // from across the hole, and they host sponges, corals and feather stars.
    const pool0 = poolOf(g, 'nb2bhRock', B.rock), pool1 = pool0.filter((t) => !/hoodoo|pinnacle/i.test(t.label || ''));
    const pool = pool1.length ? pool1 : B.rock;
    for (let k = 0; A && k < A.len * 0.12; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const th = arcTh(rng, A, 0.25);
      if (th === null) continue;
      const sp = wallSpot(fs, H, th, rim - 1.5 - Math.pow(rng(), 1.25) * 38);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.55) continue;
      const tpl = pick(rng, pool), w = 1.5 + Math.pow(rng(), 1.4) * 2.6, sx = w * (0.7 + rng() * 0.6), sz = w * (0.7 + rng() * 0.8), sy = 0.8 + rng() * 1.2;
      const R = upTo(mix3(sp.n, UP, 0.12), rng() * TAU), Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, sx, sy, sz, Pp, sp.n, 0.14);
      const r = tpl.r * Math.max(sx, sz);
      if (!clearBox(pc, Pp[0], Pp[2], Pp[1] - r, Pp[1] + r, r) || nearGal(Pp[0], Pp[1], Pp[2], r)) continue;
      if (outcrops.some((O) => Math.hypot(O.x - Pp[0], O.s - Pp[2], O.y - Pp[1]) < (O.r + r) * 0.5)) continue;
      if (ledges.some((L) => Math.hypot(L.x - Pp[0], L.s - Pp[2], L.y - Pp[1]) < r + 1.2)) continue;
      outcrops.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sx, sy, sz, r, col: tintOf(rng, [[0.88, 0.84, 0.76], [0.78, 0.74, 0.68], [0.84, 0.76, 0.66], [0.72, 0.72, 0.7]], 0.06) });
    }
    // odd ledges off the bands
    for (let k = 0; A && k < A.len * 0.04; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const th = arcTh(rng, A, 0.3);
      if (th === null) continue;
      const sp = wallSpot(fs, H, th, rim - 2 - Math.pow(rng(), 1.3) * 26);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.6) continue;
      const tpl = pick(rng, B.ledge), sc = 0.8 + rng() * 0.6, R = rotY(Math.atan2(sp.hn[0], sp.hn[2]) + (rng() - 0.5) * 0.4);
      const Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, sc, sc, sc, Pp, sp.hn, 0.18);
      const reach = tpl.r * sc;
      if (!clearBox(pc, Pp[0], Pp[2], Pp[1] - reach, Pp[1] + reach, reach) || nearGal(Pp[0], Pp[1], Pp[2], reach)) continue;
      if (ledges.some((L) => Math.hypot(L.x - Pp[0], L.s - Pp[2], L.y - Pp[1]) < 3.5)) continue;
      if (outcrops.some((O) => Math.hypot(O.x - Pp[0], O.s - Pp[2], O.y - Pp[1]) < O.r + reach * 0.6)) continue;
      ledges.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, hn: sp.hn });
    }
  }
  return { hf, ledges, galleries, rocks, occ, g0, outcrops, A, galSpots };
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
  // rock structure is drawn as far as the fog allows; the reef life on it only within mid range (it was all
  // one unbounded batch, drawn in every chunk out to 300 m ahead in clear water)
  const rock = new Batch(MAT.static, 70000);
  const st = new Batch(MAT.static, 70000 * bk); st.lod = 'mid';
  const sw = new Batch(MAT.sway, 20000 * bk); sw.soft = true; sw.lod = 'mid';
  const fan = new Batch(NB2.mat.fan, 22000 * bk); fan.lod = 'mid';
  // the hole's wall has its own budget: sharing the plateau and rim batches, it got whatever the rim reef
  // left (nothing, once those batches filled up, so the far wall stayed bare rock)
  // (budgets scale with the length of wall in the chunk, so every stretch of wall gets the same density)
  const wk = (P.A ? P.A.wall : 0) * (0.7 + 0.5 * lk);
  const wl = new Batch(MAT.static, 190 * wk), wsw = new Batch(MAT.sway, 45 * wk), wfan = new Batch(NB2.mat.fan, 70 * wk);
  wl.lod = wsw.lod = wfan.lod = 'mid'; wsw.soft = true;
  const labels = [], pois = [];
  // (the strata ribs darker and warmer than bare limestone: turf, sponge and coralline cover them)
  for (const L of P.ledges) { if (put(ctx, rock, L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, L.rib ? tintOf(rng, [[0.66, 0.6, 0.54], [0.6, 0.56, 0.52], [0.68, 0.58, 0.58], [0.58, 0.58, 0.5]], 0.08) : tintOf(rng, [[0.92, 0.88, 0.8], [0.84, 0.8, 0.74], [0.9, 0.82, 0.72]], 0.06))) L.item = rock.last; }
  for (const R0 of P.rocks) { if (put(ctx, rock, R0.tpl, R0.x, R0.y, R0.s, R0.R, R0.sc, R0.sy, R0.sz, R0.col)) R0.item = rock.last; }
  for (const O of P.outcrops) { if (put(ctx, rock, O.tpl, O.x, O.y, O.s, O.R, O.sx, O.sy, O.sz, O.col)) O.item = rock.last; }
  const hf = P.hf;
  if (hf && hf.H.s >= ctx.s0 && hf.H.s < ctx.s1) {
    const H = hf.H, py = pc.y(H.s);
    pois.push({ type: 'bluehole', x: H.x, y: py - 10, s: H.s, r: H.R, data: { name: 'The Blue Hole', fact: 'Blue holes are drowned sinkholes; their still, deep water can hold no oxygen at the bottom.' } });
    labels.push(['The Blue Hole', H.x, py - 6, H.s, 'The Great Blue Hole of Belize is 318 m across and 124 m deep; this one falls away into darkness too.']);
  }
  const SPECS = [
    { t: T.table, w: 1.6, sc: [0.8, 1.6], hard: true, pal: TABLEC }, { t: T.stag, w: 2.0, sc: [0.8, 1.7], hard: true }, { t: T.brain, w: 1.6, sc: [0.6, 1.4], hard: true, pal: MASSC },
    { t: T.boulder, w: 1.2, sc: [0.7, 1.5], hard: true, pal: MASSC }, { t: T.coralMound, w: 0.8, sc: [0.6, 1.3], hard: true, mound: true, pal: MASSC }, { t: T.elkhorn, w: 0.8, sc: [0.8, 1.4], hard: true },
    { t: T.plateC, w: 0.8, sc: [0.9, 1.7], hard: true, pal: TABLEC }, { t: T.pillar, w: 0.4, sc: [0.7, 1.2], hard: true, pal: MASSC },
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
    for (let k = 0; k < 270 * bk * lk; k++) {
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
    // just below the lip: sea fans and sponges facing the blue, plate corals in shelves
    // (sampled along the chunk's arcs: drawn uniformly in s, the far wall straight ahead got almost none)
    const rim = fs.at(H.x + H.R + 4, H.s), A = P.A;
    for (let k = 0; A && k < A.len * 1.3 * lk; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const th = arcTh(rng, A, 0.35);
      if (th === null) continue;
      const sp = wallSpot(fs, H, th, rim - 0.4 - Math.pow(rng(), 1.3) * 7);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.8 || covered(P, sp.x, sp.y, sp.s)) continue;
      const face = Math.atan2(sp.hn[0], sp.hn[2]), u = rng();
      let tpl, sc, R, b = wl, m = sp.hn, col, fa = 1, embed = 0.03;
      // (plates are few and small: big ones jut out of the lip as flat discs, paper-thin seen edge-on)
      if (u < 0.1) { tpl = pick(rng, B.plate); sc = 0.55 + rng() * 0.4; R = rotY(face + (rng() - 0.5) * 0.5); col = tintOf(rng, PLATEC, 0.12); }
      else if (u < 0.5) { tpl = pick(rng, poolOf(hf.g, 'nb2bhFan', B.fan)); sc = 0.9 + rng() * 0.8; b = wfan; fa = sc; m = null; R = mul3(rotY(face + (rng() - 0.5) * 0.4), rotX(0.2 + rng() * 0.25)); col = tintOf(rng, rc.fanPal.length ? rc.fanPal : [[1, 0.3, 0.1]], 0.15); }
      else if (u < 0.78) { tpl = pick(rng, B.ear); sc = 1.0 + rng() * 0.8; R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.2 + rng() * 0.3)); col = tintOf(rng, rc.sponge, 0.15); embed = 0.05; }
      else { tpl = pick(rng, T.tubeSp || B.ear); sc = 0.9 + rng() * 0.7; R = upTo(mix3(sp.n, UP, 0.4), rng() * TAU); m = sp.n; col = tintOf(rng, rc.sponge, 0.15); embed = 0.05; }
      const h = (tpl.maxY - tpl.minY) * sc, reach = Math.max(tpl.r * sc, h * 0.5);
      if (!clearBox(pc, sp.x, sp.s, sp.y - reach, sp.y + h, reach)) continue;
      const Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
      put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
    }
  }
  // The wall down to ~38 m below the rim (the camera looks ~30 m down across the hole): sponges, black
  // coral, fans, encrusting colour and a few plates, densest on the far wall that faces the camera.
  // (Fans, black coral and tube or barrel sponges give the face a silhouette; plates read as flat discs.)
  if (hf && P.A) {
    const H = hf.H, rim = fs.at(H.x + H.R + 4, H.s), g = hf.g, rc = recipeOf(g), A = P.A;
    for (let k = 0; k < A.len * 3.4 * lk; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const th = arcTh(rng, A, 0.3);
      if (th === null) continue;
      const depth = 1 + Math.pow(rng(), 1.4) * 37, sp = wallSpot(fs, H, th, rim - depth);
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.75 || covered(P, sp.x, sp.y, sp.s)) continue;
      const wS = rc.sponges * 1.6, wB = rc.black * (0.5 + Math.min(1, depth / 18)), wF = rc.fans * 1.3, wP = rc.plates * (depth < 14 ? 0.12 : 0), wE = 1.2;
      const u = rng() * (wS + wB + wF + wP + wE), face = Math.atan2(sp.hn[0], sp.hn[2]);
      let tpl, sc, R, b = wl, col, fa = 1, m = sp.n, embed = 0.05, solid = true;
      if (u < wS) {
        const v = rng(), barrel = v >= 0.78 && T.barrel && T.barrel.length;
        if (v < 0.58) { tpl = pick(rng, B.ear); sc = 0.9 + rng() * 1.0; R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.15 + rng() * 0.35)); }
        else if (!barrel) { tpl = pick(rng, T.tubeSp || B.ear); sc = 0.9 + rng() * 0.8; R = upTo(mix3(sp.n, UP, 0.35), rng() * TAU); }
        else { tpl = pick(rng, T.barrel); sc = 0.7 + rng() * 0.6; R = upTo(mix3(sp.n, UP, 0.45), rng() * TAU); embed = 0.08; }
        col = barrel ? tintOf(rng, [[0.66, 0.34, 0.28], [0.58, 0.36, 0.3], [0.72, 0.46, 0.36]], 0.1) : tintOf(rng, rc.sponge, 0.15);
      } else if ((u - wS) < wB) {
        tpl = pick(rng, B.black); sc = 0.9 + rng() * 0.9; b = wsw; fa = sc * 0.5; solid = false; col = tintOf(rng, [[0.92, 0.92, 0.86], [0.55, 0.75, 0.4], [0.95, 0.65, 0.3]], 0.1);
        R = upTo(nrm([sp.n[0], sp.n[1] + 0.25, sp.n[2]]), rng() * TAU);
      } else if ((u - wS - wB) < wF) {
        tpl = pick(rng, poolOf(g, 'nb2bhFan', B.fan)); sc = 0.9 + rng() * 0.9; b = wfan; fa = sc; m = null; col = tintOf(rng, rc.fanPal.length ? rc.fanPal : [[1, 0.3, 0.1]], 0.15);
        R = mul3(rotY(face + (rng() - 0.5) * 0.4), rotX(0.12 + rng() * 0.25));
      } else if ((u - wS - wB - wF) < wP) { // plate shelves
        tpl = pick(rng, B.plate); sc = 0.55 + rng() * 0.4; R = rotY(face + (rng() - 0.5) * 0.5); m = sp.hn; embed = 0.03; col = tintOf(rng, PLATEC, 0.12);
      } else { // encrusting sponge: a splash of colour on the bare rock
        tpl = pick(rng, B.enc); sc = 1.3 + rng() * 1.4; R = upTo(sp.n, rng() * TAU); embed = 0.03; col = tintOf(rng, [[1.0, 0.35, 0.05], [0.85, 0.06, 0.08], [0.55, 0.12, 0.75], [1.05, 0.8, 0.1], [0.95, 0.3, 0.55]], 0.15);
      }
      const h = (tpl.maxY - tpl.minY) * sc, reach = Math.max(tpl.r * sc, h * 0.5);
      if (!clearBox(pc, sp.x, sp.s, sp.y - reach, sp.y + h, reach, solid ? SOLID : SOFT, solid ? 0 : 1.2)) continue;
      const Pp = [sp.x, sp.y, sp.s];
      seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
      put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
    }
  }
  return { batches: [rock, st, sw, fan, wl, wsw, wfan], labels, pois };
}
// a wall spot under a buttress or inside a gallery mouth (growth there would be buried in rock)
function covered(P, x, y, s) {
  for (const O of P.outcrops) if (Math.hypot(O.x - x, O.s - s, O.y - y) < O.r * 0.85) return true;
  for (const q of P.galSpots) if (Math.hypot(q.x - x, q.s - s, q.y - y) < q.r) return true;
  return false;
}
function placeReef(ctx, rng, fs, pc, x, s, rc, rimK, hf, SPECS, tot, st, sw, fan) {
  let u = rng() * tot, e = SPECS[0];
  for (const q of SPECS) { if ((u -= q.w) < 0) { e = q; break; } }
  if (e.fan && rng() > rc.fans) return;
  if (e.sponge && rng() > rc.sponges) return;
  const flat = e.t === T.table || e.t === T.plateC; // (big flat colonies at the lip read as discs from across the hole)
  const tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng()) * (1 + rimK * (flat ? 0.08 : 0.35)), y = fs.at(x, s), n = [fs.nx, fs.ny, fs.nz];
  if (n[1] < 0.55) return;
  // at the rim growth leans out over the drop
  let up = mix3(UP, n, e.mound ? 0.7 : 0.4);
  if (rimK > 0 && hf) { const dx = x - hf.H.x, ds = s - hf.H.s, l = Math.hypot(dx, ds) || 1, k = (flat ? 0.4 : 0.35) * rimK; up = nrm([up[0] - dx / l * k, up[1], up[2] + ds / l * k]); }
  const R = e.fan && hf && rimK > 0 ? mul3(rotY(Math.atan2(-(x - hf.H.x), (s - hf.H.s)) + (rng() - 0.5) * 0.5), rotX(-0.15 * rimK)) : upTo(up, rng() * TAU);
  const h = (tpl.maxY - tpl.minY) * sc;
  if (!clearBox(pc, x, s, y, y + h, tpl.r * sc, e.sway ? SOFT : SOLID, e.sway ? 1.0 : 0)) return;
  const Pp = [x, y, s];
  seat(fs, tpl, R, sc, sc, sc, Pp, null, e.mound ? 0.1 : 0.04);
  const col = e.fan ? tintOf(rng, rc.fanPal.length ? rc.fanPal : [[1, 0.3, 0.6]], 0.15) : e.sponge ? tintOf(rng, rc.sponge, 0.15)
    : e.sway ? tintOf(rng, [[0.72, 0.12, 0.98], [0.98, 0.14, 0.62], [1.1, 0.42, 0.05], [1.0, 0.75, 0.3]], 0.15)
      : e.pal ? tintOf(rng, e.pal, 0.12) : tintOf(rng, rc.hard.length ? rc.hard : [[1, 0.6, 0.3]], 0.18);
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
  // ledges: sun corals beneath, crinoids and encrusting colour on top (the strata ribs, many and mostly
  // seen from across the hole, get one of each, and an overhang POI now and then)
  let nRib = 0;
  for (const L of P.ledges) {
    if (Y.over()) { yield; Y.reset(); }
    if (!L.item) continue;
    const top = itemSupport(L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, true, null), under = itemSupport(L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, false, null);
    const [x0, , , x1, , z1] = L.tpl.box;
    const nK = L.rib ? 1 : 7, nTop = L.rib ? (rng() < 0.5 ? 1 : 0) : 4;
    for (let k = 0; k < nK; k++) {
      const lx = lerp(x0, x1, 0.15 + rng() * 0.7) * L.sc, lz = lerp(0.1, z1, 0.25 + rng() * 0.6) * L.sc;
      const o = xf(L.R, 1, 1, 1, lx, 0, lz), x = L.x + o[0], s = L.s - o[2], onTop = k < nTop;
      const tpl = onTop ? (rng() < 0.4 ? pick(rng, B.crin) : pick(rng, B.enc)) : pick(rng, B.sun), sup = onTop ? top : under, y = sup.at(x, s);
      if (!isFinite(y) || Math.abs(y) > 1e8) continue;
      const sc = 0.8 + rng() * 0.6, R = onTop ? rotY(rng() * TAU) : upTo([0, -1, 0], rng() * TAU), Bp = basePts(tpl);
      let ok = true;
      for (let i = 0; i < Bp.length && ok; i += 3) { const q = xf(R, sc, sc, sc, Bp[i], Bp[i + 1], Bp[i + 2]), h = sup.at(x + q[0], s - q[2]), h2 = (onTop ? under : top).at(x + q[0], s - q[2]); if (!isFinite(h) || Math.abs(h) > 1e8 || !isFinite(h2) || Math.abs(h2) > 1e8 || Math.abs(h - h2) < 0.12) ok = false; }
      if (!ok) continue;
      let yy;
      if (onTop) { let gm = -1e9; for (let i = 0; i < Bp.length; i += 3) { const q = xf(R, sc, sc, sc, Bp[i], Bp[i + 1], Bp[i + 2]); gm = Math.max(gm, y + q[1] - top.at(x + q[0], s - q[2])); } yy = y - gm - 0.025; }
      else yy = hangY(under, Bp, R, sc, x, y, s, 0.025);
      // the vertical fit can leave a base point just outside where the ledge is lumpy: finish on the mesh itself
      const Pe = [x, yy, s];
      if (!isFinite(yy) || !embedOn(L.item, ctx.s0, tpl, R, sc, Pe, onTop ? UP : [0, -1, 0], 0.025)) continue;
      const isCrin = onTop && B.crin.includes(tpl);
      put(ctx, isCrin ? sw : near, tpl, Pe[0], Pe[1], Pe[2], R, sc, sc, sc, isCrin ? tintOf(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.9, 0.85]]) : onTop ? tintOf(rng, [[1.0, 0.35, 0.05], [0.85, 0.06, 0.08], [0.55, 0.12, 0.75]]) : tintOf(rng, [[1, 1, 1]], 0.08), isCrin ? sc : 1, { item: L.item });
    }
    if (L.y > pc.y(L.s) - 30 && (!L.rib || nRib++ % 6 === 0)) pois.push({ type: 'wall-overhang', x: L.x + L.hn[0] * 1.2, y: L.y - 0.8, s: L.s - L.hn[2] * 1.2, r: 2.5, data: { name: 'Ledge overhang', fact: 'Groupers and snappers hang under the ledges of the wall, out of the current.' } });
  }
  // Encrusting skin on the upper wall (nb2_crust.js, as on the seamount cliffs): broad mottled veils of
  // coralline algae and turf with sponge, coralline and polyp colonies over them, conformed to the wall's
  // own facets and shaded per fragment, so the long smooth planes the heightfield draws for the drop read
  // as living rock from across the hole
  const crust = new Crust();
  if (P.hf && P.A) {
    const H = P.hf.H, A = P.A, rim = fs.at(H.x + H.R + 4, H.s), lk = lowK(ctx);
    const nV = A.len * (ctx.tier === 'low' ? 0.08 : 0.14), nC = A.len * 0.5 * lk;
    let lab0 = 0;
    for (let k = 0; k < nV + nC; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const veil = k < nV, th = arcTh(rng, A, 0.3);
      if (th === null) continue;
      const sp = wallSpot(fs, H, th, rim - 1 - Math.pow(rng(), 1.3) * (veil ? 36 : 30));
      if (!sp || sp.s < ctx.s0 || sp.s >= ctx.s1 || sp.n[1] > 0.7 || covered(P, sp.x, sp.y, sp.s)) continue;
      if (veil) { crustPatch(crust, fs, ctx, rng, sp.x, sp.s, { R: 2.2 + rng() * 1.6, ell: 0.5 + rng() * 0.5, colA: pick(rng, CRB.veil), colB: pick(rng, CRB.veil), kind: 4 }); continue; }
      const u = rng(), kind = u < 0.42 ? 0 : u < 0.72 ? 3 : u < 0.9 ? 2 : 1, cols = [CRB.sponge, CRB.polyp, CRB.turf, CRB.coral][kind];
      crustPatch(crust, fs, ctx, rng, sp.x, sp.s, { R: 0.7 + Math.pow(rng(), 1.4) * 1.6, ell: 0.55 + rng() * 0.45, colA: pick(rng, cols), colB: pick(rng, cols), kind });
      if (kind === 0 && !lab0++) labels.push(['Encrusting sponges', sp.x, sp.y, sp.s, 'Sponges, coralline algae and hydroids crust every metre of a blue hole wall down to where the light runs out.']);
    }
  }
  const crustMesh = crust.mesh(NB2.mat.crust, 'mid');
  if (crustMesh) crustMesh.renderOrder = 1;
  return { batches: [rock, near, sw], labels, pois, extra: crustMesh ? [crustMesh] : [] };
}
// crust colours (linear): mottled veils of turf and coralline, sponge sheets, zoanthid carpets, algal turf,
// pink coralline. The hole is pale limestone (rock ~0.6, against the seamount's dark ~0.42), so colonies
// are brighter than the seamount's and the turf veils darker than the rock: both read against it.
const CRB = {
  veil: [[0.36, 0.22, 0.26], [0.3, 0.27, 0.17], [0.24, 0.25, 0.18], [0.4, 0.26, 0.32], [0.28, 0.25, 0.21]],
  sponge: [[0.75, 0.28, 0.05], [0.62, 0.1, 0.07], [0.42, 0.14, 0.55], [0.75, 0.6, 0.08], [0.7, 0.22, 0.4]],
  polyp: [[0.6, 0.5, 0.16], [0.26, 0.48, 0.4], [0.6, 0.28, 0.14]],
  turf: [[0.3, 0.29, 0.13], [0.36, 0.3, 0.17], [0.26, 0.29, 0.19]],
  coral: [[0.72, 0.27, 0.4], [0.62, 0.3, 0.55], [0.78, 0.4, 0.42], [0.58, 0.24, 0.46]],
};

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
    { t: T.rubble, w: 2.4, sc: [0.7, 1.6], col: [[0.85, 0.8, 0.72], [0.78, 0.74, 0.68]] }, { t: B.enc, w: 1.0, sc: [0.8, 1.5], col: [[1.0, 0.35, 0.05], [0.55, 0.12, 0.75], [1.05, 0.8, 0.1]] },
    { t: T.anem, w: 0.4, sc: [0.8, 1.3], col: [[1, 1, 1]], sway: true }, { t: T.clam, w: 0.3, sc: [0.6, 1.1], col: [[1, 1, 1]] },
  ].filter((e) => e.t && e.t.length);
  let tot = 0; for (const e of DET) tot += e.w;
  for (let k = 0; k < 230 * lk * bk; k++) {
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
  // growth on the wall buttresses (seen from across the hole, so mid range): small coral heads on the lit
  // tops, sponges and encrusting colour on the faces, feather stars on the edges
  const mid = new Batch(MAT.static, 20000 * bk); mid.lod = 'mid';
  const rc = hf && recipeOf(hf.g);
  const hosts = [...P.outcrops, ...P.ledges.filter((L) => L.rib)];
  for (const O of hosts) {
    if (Y.over()) { yield; Y.reset(); }
    if (!O.item) continue;
    // (on a rib only its flat top, and nothing with a wide base: an elephant ear's foot overhung the edge)
    const spots = itemSpots(O.item, ctx, 16, O.rib ? 0.7 : 0.05);
    for (let q = 0; q < Math.min(spots.length, O.rib ? (rng() < 0.6 ? 1 : 0) : 2 + ((rng() * 3) | 0)); q++) {
      const p = spots[(rng() * spots.length) | 0], u = rng();
      let tpl, sc, col, b = mid;
      if (p.n[1] > 0.6 && u < 0.35 && T.brain && T.brain.length) { tpl = pick(rng, T.brain); sc = 0.35 + rng() * 0.4; col = tintOf(rng, MASSC, 0.12); }
      else if (u < 0.65) { tpl = pick(rng, B.enc); sc = 0.9 + rng() * 0.9; col = tintOf(rng, [[1.0, 0.35, 0.05], [0.85, 0.06, 0.08], [0.55, 0.12, 0.75], [1.05, 0.8, 0.1]], 0.15); }
      else if (u < 0.88 && !O.rib) { tpl = pick(rng, B.ear); sc = 0.7 + rng() * 0.6; col = tintOf(rng, rc.sponge, 0.15); }
      else { tpl = pick(rng, B.crin); sc = 0.8 + rng() * 0.6; b = sw; col = tintOf(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.9, 0.85]], 0.1); }
      const Rd = upTo(mix3(p.n, UP, 0.25), rng() * TAU), Pp = decoOn(ctx, O.item, p, tpl, sc, Rd);
      if (!Pp) continue;
      const [x, y, s] = Pp, h = (tpl.maxY - tpl.minY) * sc;
      if (!clearBox(pc, x, s, y - h, y + h, tpl.r * sc + h * 0.3, b === sw ? SOFT : SOLID, b === sw ? 1 : 0)) continue;
      put(ctx, b, tpl, x, y, s, Rd, sc, sc, sc, col, b === sw ? sc : 1, { item: O.item });
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
  return { batches: [near, mid, sw], extra };
}
