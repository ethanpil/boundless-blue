// The Wall: a near-vertical reef wall on one side of the path. Life grows out of the face, oriented to
// the exact floor-mesh facet it sits on: sea fans facing the open water, elephant-ear and barrel
// sponges, black coral bushes, plate corals in overlapping shelves, whip corals, feather stars on the
// edges and splashes of encrusting colour. Rock ledges jut out (with sun corals under the overhang),
// small caverns open in the face, and the crest carries shallow reef growth. Nothing solid stands on
// the open-water side.
import { Builder, Batch, TAU, vn3, sat, sstep, lerp, rotY, rotX, mul3, presence, budgetK, CHUNK, T } from './core.js';
import { MAT } from './materials.js';
import { seaFan, seaWhips, rockInto } from './shapes.js';
import { mulberry32, noise1, noise2 } from '../noise.js';
import { sv } from '../biomes.js';
import {
  pathCache, clearBox, SOLID, SOFT, seat, put, upTo, nrm, mix3, setBase, lab, segFor, recipe, lowK, itemSupport, basePts, xf, slice,
  nbFloor,
} from './nb_common.js';
import { encrust, featherStar, blackCoral, elephantEar, shelfPlate, sunCorals, ground } from './nb_shapes.js';
import { itemSpots, decoOn, planned } from './nb2_common.js';
import { tintFrom } from './scatter.js';

const W = {};
const UP = [0, 1, 0];

// ---------------------------------------------------------------- templates
function ledgeTpl(seed) {
  const b = new Builder(), rng = mulberry32(seed);
  const sx = 1.4 + rng() * 1.4, sz = 0.9 + rng() * 0.6, sy = 0.35 + rng() * 0.3;
  rockInto(b, seed + 900, { detail: 3, sx, sy, sz, rough: 0.28, flat: 0.25, growth: 0.9, col: [0.62, 0.55, 0.5], strata: 0.05 });
  const t = b.build(), P = t.pos, pts = [];
  // attached along its buried back half
  for (let i = 0; i < t.vc; i += 3) if (P[i * 3 + 2] < t.box[2] * 0.75) pts.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const step = Math.max(1, Math.floor(pts.length / 3 / 14)) * 3, sub = [];
  for (let i = 0; i < pts.length; i += step) sub.push(pts[i], pts[i + 1], pts[i + 2]);
  setBase(t, sub);
  t.label = 'Reef ledge';
  t.obs = [[t.box[0] + sz * 0.5, sy, 0, t.box[3] - sz * 0.5, sy, 0, Math.max(sz, sy) * 0.9]];
  return t;
}

// A cave mouth in the face: a low, rough rock rim swelling only ~0.6 m out of the wall (local +y is the
// face normal, y = 0 the face), crusted with growth outside, around a dark throat recessed back to the
// face. The wide skirt is meant to be pushed into the terrain so the rim sits flush with the wall.
function cavernTpl(seed) {
  const b = new Builder(), rng = mulberry32(seed), R = 1.2 + rng() * 0.7, rm = R * (0.5 + rng() * 0.12), D = 0.5 + rng() * 0.2;
  const prof = [[R * 1.55, -0.12], [R * 1.25, D * 0.25], [rm * 1.6, D * 0.75], [rm * 1.28, D], [rm * 1.08, D * 0.92], [rm * 0.98, D * 0.6], [rm * 0.78, D * 0.3], [rm * 0.42, D * 0.12], [0.02, D * 0.06]];
  const n = prof.length - 1, lobes = 2 + Math.floor(rng() * 3), ph = rng() * TAU;
  b.lathe(30, n * 2, (v) => {
    const f = v * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
    return [lerp(prof[i][0], prof[i + 1][0], t), lerp(prof[i][1], prof[i + 1][1], t)];
  }, (a, v) => (1 + 0.14 * Math.sin(a * lobes + ph) * (v < 0.5 ? 1 : 0.5)) * (1 + 0.16 * vn3(Math.cos(a) * 2.5, v * 5, Math.sin(a) * 2.5, seed) + 0.07 * vn3(Math.cos(a) * 7, v * 12, Math.sin(a) * 7, seed + 9)),
  (v, a, x, y, z, o) => {
    const inside = sstep(0.5, 0.62, v), rough = (1 - inside) * 0.09 * vn3(x * 3, y * 4, z * 3, seed + 4);
    o[1] += rough; // knobbly rock, not a turned urn
    const ao = lerp(0.75 + 0.3 * vn3(x * 3, y * 3, z * 3, seed + 2), 0.03 + 0.04 * (1 - sstep(0.62, 1, v)), inside);
    o[3] = 0.46 * ao; o[4] = 0.38 * ao; o[5] = 0.37 * ao; // the wall's own dark rock
    // outside: generic rock with a light crust of growth; the throat: dark stone
    o[6] = inside ? 0 : 0.25 + 0.2 * vn3(x * 2, y * 2, z * 2, seed + 6); o[7] = inside ? 6.3 + (seed % 5) * 0.1 : 0;
  });
  const t = b.build(), pts = [];
  for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; pts.push(Math.cos(a) * R * 1.45, -0.1, Math.sin(a) * R * 1.45); }
  setBase(t, pts);
  t.label = 'Small cavern';
  t.fact = 'Caves and cracks in reef walls shelter soldierfish, lobsters and sleeping turtles';
  return t;
}

export function initWall() {
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(900 + i * 17 + o));
  W.fan = R(10, (s) => seaFan(s, { h: 1.2 + (s % 4) * 0.25 }));
  W.ear = [...R(4, (s) => elephantEar(s, { H: 0.9 + (s % 3) * 0.2, W: 0.8 + (s % 4) * 0.15, detail: 3 })), ...R(4, (s) => elephantEar(s, { H: 0.6, W: 0.5, th: 0.05, detail: 2 }), 5)];
  W.black = R(6, (s) => blackCoral(s, { h: 0.9 + (s % 3) * 0.3 }));
  W.plate = R(8, (s) => shelfPlate(s, { R: 0.55 + (s % 4) * 0.17 }));
  W.whip = R(6, (s) => seaWhips(s, { n: 1 + (s % 3), h: 1.6 + (s % 3) * 0.5 }));
  W.crin = R(6, (s) => featherStar(s, { arms: 8 + (s % 3) * 3, L: 0.2 + (s % 3) * 0.05, up: 0.4 + (s % 4) * 0.15 }));
  W.enc = R(10, (s) => encrust(s, { r: 0.16 + (s % 4) * 0.05, h: 0.07 + (s % 3) * 0.035, lobes: 0.55, detail: 1, ridges: s % 3 === 0 ? 0.3 : 0, elong: 1 + (s % 3) * 0.35 }));
  W.encHi = R(6, (s) => encrust(s, { r: 0.16 + (s % 4) * 0.05, h: 0.07 + (s % 3) * 0.035, lobes: 0.55, detail: 2, ridges: s % 3 === 0 ? 0.3 : 0, elong: 1 + (s % 3) * 0.35 }), 3);
  W.sun = R(5, (s) => sunCorals(s, { n: 6 + (s % 4) * 3 }));
  W.ledge = R(6, ledgeTpl);
  W.cave = R(4, cavernTpl);
  lab(W.fan, 'Gorgonian sea fan', 'Sea fans grow across the current to sieve plankton from the passing water');
  lab(W.ear, 'Elephant ear sponge', 'A single large sponge can filter thousands of litres of water a day');
  lab(W.black, 'Black coral', 'Named for its black skeleton; the living tissue is white, green or orange');
  lab(W.plate, 'Plate coral', 'Grows in flat shelves to catch as much of the dim light as possible');
  lab(W.whip, 'Whip coral', null);
  lab(W.crin, 'Feather star', 'Feather stars climb to high perches at night to comb plankton from the current');
  lab(W.enc, 'Encrusting sponge', null); lab(W.encHi, 'Encrusting sponge', null);
  lab(W.sun, 'Sun coral (Tubastraea)', 'Sun corals have no algae; they open at night to catch plankton in the shade');
  for (const t of [...W.crin, ...W.whip]) t.solid = false;
  return W;
}

// ---------------------------------------------------------------- palettes & recipe
const FANS = [[0.72, 0.1, 0.9], [1.0, 0.08, 0.16], [1.1, 0.45, 0.06], [1.05, 0.85, 0.12], [0.95, 0.15, 0.6]];
const ENC = [[1.0, 0.35, 0.05], [0.85, 0.06, 0.08], [0.55, 0.12, 0.75], [1.05, 0.8, 0.1], [0.3, 0.45, 0.8], [0.95, 0.3, 0.55], [0.75, 0.6, 0.45], [0.55, 0.65, 0.35]];
const EAR = [[1.0, 0.42, 0.1], [0.9, 0.25, 0.08], [0.95, 0.55, 0.15], [0.7, 0.3, 0.55]];
const BLACK = [[0.9, 0.9, 0.85], [0.55, 0.75, 0.4], [0.95, 0.65, 0.3], [0.5, 0.42, 0.3]];
const PLATE = [[0.6, 0.45, 0.28], [0.45, 0.55, 0.3], [0.65, 0.38, 0.55], [0.75, 0.6, 0.35]];
// tables and massive heads in the tans, browns and creams of living colonies
const TABLEW = [[0.74, 0.62, 0.44], [0.64, 0.54, 0.4], [0.82, 0.74, 0.58], [0.6, 0.58, 0.42], [0.72, 0.56, 0.58]];
const MASSW = [[0.82, 0.64, 0.4], [0.66, 0.5, 0.32], [0.62, 0.62, 0.36], [0.86, 0.78, 0.56], [0.8, 0.62, 0.3], [0.74, 0.54, 0.5], [0.58, 0.5, 0.6]];
// dead framework under turf and coralline algae (dark, so it reads as reef pavement, not pale slabs)
const FRAMEW = [[0.5, 0.45, 0.32], [0.46, 0.42, 0.31], [0.54, 0.45, 0.38], [0.42, 0.41, 0.3], [0.52, 0.42, 0.4]];
const recipeOf = (g) => recipe(g, 'wall', (g) => ({
  fan: 0.5 + sv(g, 5) * 1.2, ear: 0.3 + sv(g, 6), black: 0.2 + sv(g, 7) * 1.1, plate: 0.3 + sv(g, 8) * 1.2,
  whip: 0.3 + sv(g, 9), crin: 0.3 + sv(g, 10), enc: 0.6 + sv(g, 11) * 0.8, ledges: 0.5 + sv(g, 12),
  giant: sv(g, 13) < 0.55, fanPal: FANS.filter((_, i) => sv(g, 20 + i) > 0.3),
}));

// wall geometry along s: side toward the wall and the lateral distance of its foot
function wallAt(ctx, pc, s) {
  const g = segFor(ctx, s, 'wall');
  if (!g) return null;
  const side = sv(g, 1) < 0.5 ? -1 : 1, wd = 7 + 3 * noise1(s / 60, 141) + 2 * sv(g, 2);
  return { g, side, wd, rc: recipeOf(g), px: pc.x(s), py: pc.y(s) };
}

// ---------------------------------------------------------------- plan: ledges, caverns, terrace knolls (shared by chains)
// (computed in slices by the plan stages; a chain that needs it earlier drains it)
const PLW = planned(function* (ctx) {
  const Y = slice(2.5);
  const rng = mulberry32(((ctx.s0 * 2654435761) ^ 0x7a11) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const ledges = [], caves = [];
  const nL = 4;
  for (let k = 0; k < nL; k++) {
    const s = ctx.s0 + (k + rng()) * (CHUNK / nL), w = wallAt(ctx, pc, s);
    if (!w || rng() > ctx.weightOf(s, 'wall') * w.rc.ledges) continue;
    const spot = faceSpot(fs, w, s, w.py - 3.5 + rng() * 11);
    if (!spot) continue;
    const isCave = rng() < 0.3, tpl = (isCave ? W.cave : W.ledge)[(rng() * (isCave ? W.cave : W.ledge).length) | 0];
    const sc = 0.8 + rng() * 0.5;
    let R, m;
    if (isCave) { R = upTo(mix3([spot.n[0], spot.n[1], spot.n[2]], [spot.hn[0], 0, spot.hn[2]], 0.5), rng() * TAU); m = spot.n; }
    else { R = rotY(Math.atan2(spot.hn[0], spot.hn[2]) + (rng() - 0.5) * 0.4); m = spot.hn; }
    const Pp = [spot.x, spot.y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, m, isCave ? 0.3 : 0.12); // a cave's skirt sinks into the face: the rim sits flush
    // flight tube: the outcrop must stay clear of the path
    const reach = tpl.r * sc;
    if (!clearBox(pc, Pp[0], Pp[2], Pp[1] - reach, Pp[1] + reach, reach)) continue;
    (isCave ? caves : ledges).push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, hn: spot.hn, w });
  }
  const lobes = [];
  yield* planLobes(ctx, fs, pc, lobes, Y);
  return { ledges, caves, lobes };
});
const planWall = (ctx) => PLW.get(ctx);
// Spur and groove: crests of reef framework run across the terrace toward the drop about every 11 m,
// wandering, with sand grooves between them (> 0 on a spur)
function spurAt(x, s) {
  const w = noise2(x / 30, s / 30, 1913) * 6;
  return Math.sin((s + w) * TAU / 11 + noise2(x / 17, s / 9, 1911) * 2.2) * 0.6 + noise2(x / 7, s / 7, 1912) * 0.9;
}
// The terrace reef: reef.js framework on a jittered grid, fused into spurs where the field is up and
// nearly continuous along the reef crest at the lip. They pass under the camera (low solids: tops LOW_GAP
// below the path) and carry the colonies of chain E. Whatever framework reef.js provides is used:
// knolls (low mounds with living colonies of several species baked in), else framework lobes (bare:
// chain E grows the hard corals on them), else coral heads.
const KNOLL_FAMS = ['mixed', 'branchy', 'massive', 'plating'];
const LOBE = { knoll: { sc: [0.78, 1.15], sy: [0.8, 1.15] }, lobe: { sc: [0.8, 1.15], sy: [0.5, 0.95] }, mound: { sc: [0.8, 1.2], sy: [0.6, 0.9] } };
function framework(g, rng, under) {
  const K = T.knoll;
  if (K) {
    if (!under && T.knollLo && T.knollLo.length) return { kind: 'knoll', list: T.knollLo }; // out to the sides the cheap ones
    // each segment leans on one family, with the others mixed in
    const f = rng() < 0.6 ? KNOLL_FAMS[Math.floor(sv(g, 14) * 4) % 4] : pick(rng, KNOLL_FAMS);
    return { kind: 'knoll', list: K[f] && K[f].length ? K[f] : K.mixed };
  }
  if (T.reefFrame && T.reefFrame.length && T.reefLive && T.reefLive.length) {
    const lo = !under && T.reefFrameLo && T.reefFrameLo.length;
    const live = rng() < 0.72; // (living massive colonies read as coral; bare framework as stone)
    return { kind: 'lobe', live, list: live ? T.reefLive : lo ? T.reefFrameLo : T.reefFrame };
  }
  return T.coralMound && T.coralMound.length ? { kind: 'mound', live: true, list: T.coralMound } : null;
}
function* planLobes(ctx, fs, pc, lobes, Y) {
  const rng = mulberry32(((ctx.s0 * 2246822519) ^ 0x7a22) >>> 0), cell = 3.5;
  for (let j = 0; j < CHUNK / cell; j++) {
    if (Y.over()) { yield; Y.reset(); }
    const s0 = ctx.s0 + (j + 0.5) * cell, w = wallAt(ctx, pc, s0);
    if (!w) continue;
    const wk = ctx.weightOf(s0, 'wall');
    for (let t = -5 + rng() * cell * 0.4; t < w.wd - 2.2; t += cell * (0.8 + rng() * 0.3)) {
      const s = s0 + (rng() - 0.5) * cell * 0.8, tt = t + (rng() - 0.5) * cell * 0.5;
      if (rng() > wk || s < ctx.s0 || s >= ctx.s1) continue;
      const x = w.px + w.side * tt, lipK = sstep(-1.5, -4, tt);
      if (spurAt(x, s) < -0.62 - lipK * 0.6) continue; // a sand groove (rare along the crest)
      const y = fs.at(x, s);
      if (fs.ny < 0.72) continue;
      const F = framework(w.g, rng, Math.abs(tt) < 4);
      if (!F) return;
      const n = [fs.nx, fs.ny, fs.nz], tpl = pick(rng, F.list), Ls = LOBE[F.kind];
      const sc = lerp(Ls.sc[0], Ls.sc[1], rng()), sy = sc * lerp(Ls.sy[0], Ls.sy[1], rng()), R = upTo(mix3(UP, n, 0.7), rng() * TAU);
      const h = (tpl.maxY - tpl.minY) * sy, r = tpl.r * sc;
      if (!clearBox(pc, x, s, y, y + h, r)) continue;
      const Pp = [x, y, s];
      seat(fs, tpl, R, sc, sy, sc, Pp, null, 0.06);
      lobes.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, sy, r, tt, kind: F.kind, live: F.live });
    }
  }
}
// a spot on the framework (anything placed there would be buried in it or poke through)
const onLobe = (P, x, s, pad = 0) => P.lobes.some((L) => { const dx = L.x - x, ds = L.s - s, m = L.r * 0.8 + pad; return dx * dx + ds * ds < m * m; });
// point on the wall face at height ~yT (marching out from the foot); returns facet normal and outward dir
function faceSpot(fs, w, s, yT) {
  // coarse march out from the foot, then bisect to the height crossing
  const X = (t) => w.px + w.side * t;
  let t0 = w.wd - 2.5;
  if (fs.at(X(t0), s) >= yT) return null;
  let t1 = -1;
  for (let t = t0 + 1.2; t < w.wd + 9.5; t += 1.2) { if (fs.at(X(t), s) >= yT) { t1 = t; break; } t0 = t; }
  if (t1 < 0) return null;
  for (let k = 0; k < 4; k++) { const m = (t0 + t1) / 2; if (fs.at(X(m), s) >= yT) t1 = m; else t0 = m; }
  const x = X(t1), y = fs.at(x, s);
  if (fs.ny > 0.8) return null;
  const hl = Math.hypot(fs.nx, fs.nz) || 1;
  return { x, y, t: t1, n: [fs.nx, fs.ny, fs.nz], hn: [fs.nx / hl, 0, fs.nz / hl] };
}
const pick = (rng, a) => a[(rng() * a.length) | 0];
const tint = (rng, list, amt = 0.15) => tintFrom(list, amt)(rng);

// ---------------------------------------------------------------- chain A: structure + big life on the face
export function layoutWallP(ctx) { return presence(ctx, 'wall') > 0 ? PLW.stage(ctx) : null; }
export function* layoutWallA(ctx) {
  const Y = slice();
  if (presence(ctx, 'wall') <= 0) return null;
  const P = planWall(ctx), bk = budgetK(ctx, 'wall');
  const rng = mulberry32(((ctx.s0 * 2246822519) ^ 0x3a11) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 34000 * bk);
  const sw = new Batch(MAT.sway, 34000 * bk); sw.soft = true;
  const labels = [], pois = [];
  for (const L of P.ledges) {
    put(ctx, st, L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, tint(rng, [[1, 0.95, 0.9], [0.9, 0.9, 0.85]], 0.1));
    L.item = st.items[st.items.length - 1];
    const o = L.tpl.box[5] * L.sc * 0.8;
    pois.push({ type: 'wall-overhang', x: L.x + L.hn[0] * o, y: L.y - 0.6, s: L.s - L.hn[2] * o, r: 2.5, data: { name: 'Ledge overhang', fact: 'Overhangs shade sun corals and shelter fish from passing predators' } });
  }
  for (const C of P.caves) {
    put(ctx, st, C.tpl, C.x, C.y, C.s, C.R, C.sc, C.sc, C.sc, tint(rng, [[1, 0.95, 0.9]], 0.1));
    const ax = xf(C.R, C.sc, C.sc, C.sc, 0, C.tpl.box[4] * 0.5, 0);
    pois.push({ type: 'ledge', x: C.x + ax[0], y: C.y + ax[1], s: C.s - ax[2], r: 2, data: { name: 'Small cavern', fact: C.tpl.fact } });
  }
  // big growth on the face: fans facing the open water, elephant ears, black coral
  const N = 110;
  for (let k = 0; k < N; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, w = wallAt(ctx, pc, s);
    if (!w || rng() > ctx.weightOf(s, 'wall')) continue;
    const spot = faceSpot(fs, w, s, w.py - 6 + Math.pow(rng(), 0.8) * 17);
    if (!spot || spot.n[1] > 0.7) continue;
    const rc = w.rc, u = rng() * (rc.fan + rc.ear + rc.black);
    const face = Math.atan2(spot.hn[0], spot.hn[2]);
    let tpl, sc, R, b = st, col, fa = 1, m = spot.n, embed = 0.04;
    if (u < rc.fan) {
      tpl = pick(rng, W.fan); sc = 0.9 + Math.pow(rng(), 1.3) * 1.5; b = sw; fa = sc;
      col = tint(rng, rc.fanPal.length ? rc.fanPal : FANS, 0.2);
      R = mul3(rotY(face + (rng() - 0.5) * 0.5), rotX(0.1 + rng() * 0.3));
    } else if (u < rc.fan + rc.ear) {
      tpl = pick(rng, W.ear); sc = 0.8 + rng() * 0.7; col = tint(rng, EAR);
      R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.15 + rng() * 0.3));
    } else {
      tpl = pick(rng, W.black); sc = 0.8 + rng() * 0.8; b = sw; fa = sc * 0.4; col = tint(rng, BLACK, 0.12);
      R = upTo(nrm([spot.n[0], spot.n[1] - 0.25, spot.n[2]]), rng() * TAU);
    }
    const h = (tpl.maxY - tpl.minY) * sc, reach = tpl.r * sc + h * 0.4;
    if (!clearBox(pc, spot.x, s, spot.y - reach, spot.y + h, reach)) continue;
    const Pp = [spot.x, spot.y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
    put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
  }
  // rare enormous gorgonian, seen dead ahead on the outside of a bend
  const w0 = wallAt(ctx, pc, ctx.s0 + 32);
  if (w0 && w0.rc.giant && sv(w0.g, 30 + Math.floor(ctx.s0 / 64) % 7) < 0.3) {
    for (let k = 0; k < 6; k++) {
      const s = ctx.s0 + 8 + rng() * 48, w = wallAt(ctx, pc, s), spot = w && faceSpot(fs, w, s, w.py - 4 + rng() * 6);
      if (!spot || spot.n[1] > 0.7) continue;
      const tpl = pick(rng, W.fan), sc = 2.6 + rng() * 0.8, R = mul3(rotY(Math.atan2(spot.hn[0], spot.hn[2]) + (rng() - 0.5) * 0.3), rotX(0.12));
      const h = tpl.maxY * sc;
      if (!clearBox(pc, spot.x, s, spot.y, spot.y + h, tpl.r * sc + 0.4)) continue;
      const Pp = [spot.x, spot.y, s];
      seat(fs, tpl, R, sc, sc, sc, Pp, spot.n, 0.06);
      if (put(ctx, sw, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tint(rng, FANS, 0.1), sc)) {
        sw.items[sw.items.length - 1].lbl = 'Giant gorgonian sea fan';
        labels.push(['Giant gorgonian sea fan', Pp[0], Pp[1] + h * 0.5, Pp[2], 'Giant sea fans can be centuries old and span more than three metres']);
        pois.push({ type: 'giant', x: Pp[0] + spot.hn[0] * 1.5, y: Pp[1] + h * 0.5, s: Pp[2] - spot.hn[2] * 1.5, r: Math.max(2.5, h * 0.6), data: { name: 'Giant gorgonian sea fan', fact: 'Giant sea fans can be centuries old and span more than three metres' } });
        break;
      }
    }
  }
  return { batches: [st, sw], labels, pois };
}

// ---------------------------------------------------------------- chain B: shelves, sponges, whips, crinoids, colour
export function* layoutWallB(ctx) {
  const Y = slice();
  if (presence(ctx, 'wall') <= 0) return null;
  const P = planWall(ctx), bk = budgetK(ctx, 'wall'), lk = lowK(ctx);
  const rng = mulberry32(((ctx.s0 * 3266489917) ^ 0x3b22) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const mid = new Batch(MAT.static, 36000 * bk); mid.lod = 'mid';
  const near = new Batch(MAT.static, 15000 * bk); near.lod = 'near';
  const sw = new Batch(MAT.sway, 18000 * bk); sw.lod = 'mid'; sw.soft = true;
  const N = 330 * lk;
  for (let k = 0; k < N; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, w = wallAt(ctx, pc, s);
    if (!w || rng() > ctx.weightOf(s, 'wall')) continue;
    const spot = faceSpot(fs, w, s, w.py - 6 + rng() * 18);
    if (!spot || spot.n[1] > 0.75) continue;
    const rc = w.rc, hf = sat((spot.y - (w.py - 6)) / 16);
    const tot = rc.plate * (0.4 + hf) + rc.whip + rc.crin * 0.3 + rc.enc * 4 + 0.5;
    let u = rng() * tot, tpl, sc, R, b, col, fa = 1, m = spot.n, embed = 0.025;
    const face = Math.atan2(spot.hn[0], spot.hn[2]);
    if ((u -= rc.plate * (0.4 + hf)) < 0) { // overlapping shelves: stack 2-4 plates up the face
      const n = 1 + Math.floor(rng() * 3.5);
      for (let q = 0; q < n; q++) {
        const sp = q ? faceSpot(fs, w, s + (rng() - 0.5) * 0.8, spot.y + q * (0.25 + rng() * 0.25)) : spot;
        if (!sp) break;
        const tp = pick(rng, W.plate), c = 0.8 + rng() * 0.6, Rr = rotY(Math.atan2(sp.hn[0], sp.hn[2]) + (rng() - 0.5) * 0.5);
        const reach = tp.r * c;
        if (!clearBox(pc, sp.x, s, sp.y - 0.2, sp.y + 0.3, reach)) continue;
        const Pp = [sp.x, sp.y, s];
        seat(fs, tp, Rr, c, c, c, Pp, sp.hn, 0.03);
        put(ctx, mid, tp, Pp[0], Pp[1], Pp[2], Rr, c, c, c, tint(rng, PLATE, 0.18));
      }
      continue;
    }
    if ((u -= rc.whip) < 0) { tpl = pick(rng, W.whip); sc = 0.8 + rng() * 0.6; b = sw; fa = sc; col = tint(rng, [[1.1, 0.4, 0.06], [1.0, 0.1, 0.12], [1.1, 0.85, 0.15], [0.9, 0.9, 0.85]]); R = upTo(mix3(spot.n, [0, 1, 0], 0.35), rng() * TAU); }
    else if ((u -= rc.crin * 0.3) < 0) { tpl = pick(rng, W.crin); sc = 0.9 + rng() * 0.8; b = sw; fa = sc; col = tint(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.08, 0.1], [0.2, 0.2, 0.22], [0.9, 0.9, 0.85], [0.5, 0.2, 0.7]], 0.12); R = upTo(spot.n, rng() * TAU); embed = 0.01; }
    else if ((u -= rc.enc * 4) < 0) { b = rng() < 0.4 ? near : mid; tpl = pick(rng, b === near ? W.encHi : W.enc); sc = 0.7 + rng() * 1.1; col = tint(rng, ENC, 0.2); R = upTo(spot.n, rng() * TAU); }
    else if (T.barrel && T.barrel.length) { tpl = pick(rng, T.barrel); sc = 0.6 + rng() * 0.7; b = mid; col = tint(rng, [[0.85, 0.32, 0.22], [0.7, 0.22, 0.7], [0.95, 0.55, 0.2]]); R = upTo(mix3([0, 1, 0], spot.n, 0.4), rng() * TAU); embed = 0.06; }
    else continue;
    const h = (tpl.maxY - tpl.minY) * sc, reach = tpl.r * sc + h * 0.3;
    if (!clearBox(pc, spot.x, s, spot.y - reach, spot.y + h, reach, b === sw ? SOFT : SOLID, b === sw ? 1.2 : 0)) continue;
    const Pp = [spot.x, spot.y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
    put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
  }
  // ledges: crinoids and sponges on top, sun corals hanging beneath the overhang
  for (const L of P.ledges) {
    if (Y.over()) { yield; Y.reset(); }
    const top = itemSupport(L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, true, null);
    const under = itemSupport(L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, false, null);
    const [x0, , z0, x1, , z1] = L.tpl.box;
    for (let k = 0; k < 7; k++) {
      const lx = lerp(x0, x1, 0.15 + rng() * 0.7) * L.sc, lz = lerp(0, z1, 0.2 + rng() * 0.6) * L.sc;
      const o = xf(L.R, 1, 1, 1, lx, 0, lz), x = L.x + o[0], s = L.s - o[2];
      const onTop = k < 4, tpl = onTop ? (rng() < 0.5 ? pick(rng, W.crin) : pick(rng, W.enc)) : pick(rng, W.sun);
      const sup = onTop ? top : under, y = sup.at(x, s);
      if (!isFinite(y) || Math.abs(y) > 1e8) continue;
      const sc = onTop ? 0.8 + rng() * 0.5 : 0.8 + rng() * 0.6;
      const R = onTop ? rotY(rng() * TAU) : upTo([0, -1, 0], rng() * TAU);
      const B = basePts(tpl);
      let g = onTop ? -1e9 : -1e9, miss = false;
      for (let i = 0; i < B.length; i += 3) {
        const q = xf(R, sc, sc, sc, B[i], B[i + 1], B[i + 2]), h = sup.at(x + q[0], s - q[2]);
        if (!isFinite(h) || Math.abs(h) > 1e8) { miss = true; break; }
        // the rock must be thick enough here to take the embedded base
        const h2 = (onTop ? under : top).at(x + q[0], s - q[2]);
        if (!isFinite(h2) || Math.abs(h2) > 1e8 || Math.abs(h - h2) < 0.12) { miss = true; break; }
        g = Math.max(g, onTop ? (y + q[1]) - h : h - (y + q[1]));
      }
      if (miss) continue;
      const yy = onTop ? y - g - 0.025 : y + g + 0.025; // every base point a few cm into the rock
      const isCrin = onTop && W.crin.includes(tpl);
      const col = isCrin ? tint(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.9, 0.9, 0.85]]) : onTop ? tint(rng, ENC) : tint(rng, [[1, 1, 1], [1.05, 0.9, 0.7]], 0.08);
      put(ctx, isCrin ? sw : near, tpl, x, yy, s, R, sc, sc, sc, col, isCrin ? sc : 1, { item: L.item });
    }
  }
  return { batches: [mid, near, sw] };
}

// ---------------------------------------------------------------- chain C: reef growth on the crest
const CREST = () => [
  { t: T.table, w: 2, sc: [0.8, 1.6], tint: [[0.95, 0.55, 0.2], [0.6, 0.78, 0.18], [0.78, 0.3, 0.88], [1.0, 0.85, 0.2]] },
  { t: T.stag, w: 2.5, sc: [0.8, 1.8], tint: [[0.95, 0.55, 0.2], [0.35, 0.6, 1.05], [0.15, 0.82, 0.68], [1.0, 0.42, 0.62]] },
  { t: T.brain, w: 1.5, sc: [0.5, 1.2], tint: [[1.0, 0.5, 0.18], [0.55, 0.8, 0.22], [1.05, 0.8, 0.22]] },
  { t: T.plateC, w: 1.2, sc: [0.9, 1.8], tint: PLATE },
  { t: T.soft, w: 1.5, sc: [0.9, 1.6], sway: true, tint: [[0.72, 0.12, 0.98], [0.98, 0.14, 0.62], [1.1, 0.42, 0.05]] },
  { t: T.fan, w: 1.2, sc: [0.7, 1.5], sway: true, tint: FANS },
  { t: T.tubeSp, w: 0.8, sc: [0.8, 1.5], tint: [[0.72, 0.12, 0.98], [1.1, 0.42, 0.05], [1.1, 0.86, 0.08]] },
  { t: W.enc, w: 1.5, sc: [0.8, 1.5], tint: ENC },
].filter((e) => e.t && e.t.length);
export function layoutWallC(ctx) {
  if (presence(ctx, 'wall') <= 0) return null;
  const bk = budgetK(ctx, 'wall'), lk = lowK(ctx);
  const rng = mulberry32(((ctx.s0 * 668265263) ^ 0x3c33) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 22000 * bk); st.lod = 'mid';
  const sw = new Batch(MAT.sway, 8000 * bk); sw.lod = 'mid'; sw.soft = true;
  const list = CREST();
  let tot = 0; for (const e of list) tot += e.w;
  for (let k = 0; k < 56 * lk; k++) { // (the crest share of the 75 that once also dressed the terrace)
    const s = ctx.s0 + rng() * CHUNK, w = wallAt(ctx, pc, s);
    if (!w || rng() > ctx.weightOf(s, 'wall')) continue;
    // the crest beyond the top of the face (the terrace below is chain E's reef)
    const t = w.wd + 5.5 + rng() * 12;
    const x = w.px + w.side * t, y = fs.at(x, s);
    if (fs.ny < 0.8) continue;
    let u = rng() * tot, e = list[0];
    for (const q of list) { if ((u -= q.w) < 0) { e = q; break; } }
    const tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng());
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.5), rng() * TAU);
    const h = (tpl.maxY - tpl.minY) * sc;
    if (!clearBox(pc, x, s, y, y + h, tpl.r * sc, e.sway ? SOFT : SOLID)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.03);
    put(ctx, e.sway ? sw : st, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tint(rng, e.tint, 0.2), e.sway ? sc : 1);
  }
  return { batches: [st, sw] };
}

// ---------------------------------------------------------------- chain D: the terrace lip and the drop-off face
// The path runs over a terrace; on its open-water side the floor breaks over a lip (from ~3 m out) and
// falls away into the blue. Life crowds that edge: coral heads, fans and sponges along the lip, table and
// plate corals overhanging the drop, and the face below dressed with fans facing the open water, elephant
// ears, black coral, plate shelves, whips and encrusting colour. (The terrace reef is chain E.)
// point on the outer face where the floor falls through height yT (marching out from the lip)
function outerSpot(fs, w, s, yT) {
  const X = (t) => w.px - w.side * t;
  let t0 = 2.5;
  if (fs.at(X(t0), s) <= yT) return null;
  let t1 = -1;
  for (let t = t0 + 1.5; t < 42; t += 1.5) { if (fs.at(X(t), s) <= yT) { t1 = t; break; } t0 = t; }
  if (t1 < 0) return null;
  for (let k = 0; k < 5; k++) { const m = (t0 + t1) / 2; if (fs.at(X(m), s) <= yT) t1 = m; else t0 = m; }
  const x = X(t1), y = fs.at(x, s), hl = Math.hypot(fs.nx, fs.nz) || 1;
  return { x, y, t: t1, n: [fs.nx, fs.ny, fs.nz], hn: [fs.nx / hl, 0, fs.nz / hl] };
}
const LIP = () => [
  { t: T.table, w: 1.4, sc: [0.9, 1.7], over: true, tint: TABLEW },
  { t: W.plate, w: 1.0, sc: [0.9, 1.5], over: true, tint: PLATE },
  { t: T.brain, w: 1.4, sc: [0.6, 1.4], tint: [[1.0, 0.5, 0.18], [0.55, 0.8, 0.22], [1.05, 0.8, 0.22], [0.78, 0.28, 0.85]] },
  { t: T.boulder, w: 1.0, sc: [0.6, 1.3], tint: [[0.95, 0.6, 0.3], [0.7, 0.75, 0.4]] },
  { t: T.coralMound, w: 0.5, sc: [0.6, 1.1], tint: [[0.95, 0.75, 0.7]], mound: true },
  // (fans, whips, soft corals and barrels stand up against the blue: the lip's silhouette from the path)
  { t: W.fan, w: 2.4, sc: [1.0, 2.0], fan: true, tint: FANS },
  { t: W.ear, w: 0.8, sc: [0.8, 1.3], ear: true, tint: EAR },
  { t: T.barrel, w: 0.9, sc: [0.6, 1.2], tint: [[0.85, 0.32, 0.22], [0.7, 0.22, 0.7], [0.95, 0.55, 0.2]] },
  { t: T.tubeSp, w: 0.6, sc: [0.8, 1.4], tint: [[0.72, 0.12, 0.98], [1.1, 0.42, 0.05], [0.95, 0.2, 0.5]] },
  { t: W.whip, w: 1.4, sc: [0.8, 1.3], sway: true, tint: [[1.1, 0.4, 0.06], [1.0, 0.1, 0.12], [0.9, 0.9, 0.85]] },
  { t: T.soft, w: 1.3, sc: [0.9, 1.5], sway: true, tint: [[0.72, 0.12, 0.98], [0.98, 0.14, 0.62], [1.1, 0.42, 0.05]] },
].filter((e) => e.t && e.t.length);
const TER = () => [
  { t: T.rubble, w: 3.0, sc: [0.8, 1.6], tint: [[0.8, 0.76, 0.7], [0.72, 0.68, 0.62]] },
  { t: T.pebbles, w: 0.8, sc: [0.8, 1.4], tint: [[0.8, 0.78, 0.72]] },
  { t: T.brain, w: 1.0, sc: [0.35, 0.8], tint: MASSW },
  { t: T.boulder, w: 0.8, sc: [0.35, 0.8], tint: MASSW },
  { t: T.finger, w: 0.6, sc: [0.4, 0.9], tint: [[0.9, 0.55, 0.65], [0.75, 0.7, 0.4]] },
  { t: T.star, w: 0.5, sc: [0.1, 0.18], tint: [[1.15, 0.35, 0.05], [1.0, 0.08, 0.08], [0.7, 0.25, 0.95], [0.25, 0.4, 1.1]] },
  { t: T.urchin, w: 0.5, sc: [0.06, 0.11], tint: [[0.7, 0.45, 0.8], [0.45, 0.35, 0.5]] },
  { t: T.soft, w: 0.9, sc: [0.7, 1.2], sway: true, tint: [[0.86, 0.56, 0.62], [0.9, 0.84, 0.68], [0.72, 0.12, 0.98]] },
  { t: T.fan, w: 0.5, sc: [0.6, 1.1], sway: true, tint: FANS },
  { t: T.reefHead, w: 0.5, sc: [0.45, 0.8], tint: [[1, 1, 1], [1.04, 0.98, 0.94]] },
].filter((e) => e.t && e.t.length);
const pickE = (rng, list) => { let tot = 0; for (const e of list) tot += e.w; let u = rng() * tot; for (const e of list) if ((u -= e.w) < 0) return e; return list[list.length - 1]; };
export function* layoutWallD(ctx) {
  const Y = slice();
  if (presence(ctx, 'wall') <= 0) return null;
  const bk = budgetK(ctx, 'wall'), lk = lowK(ctx);
  const rng = mulberry32(((ctx.s0 * 374761393) ^ 0x3d44) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx), P = planWall(ctx);
  const st = new Batch(MAT.static, 34000 * bk); st.lod = 'mid';
  const sw = new Batch(MAT.sway, 22000 * bk); sw.lod = 'mid'; sw.soft = true;
  const lip = LIP(), up = UP;
  const putOn = (b, tpl, x, y, s, R, sc, col, fa, m, embed, kind = SOLID, tube = 0) => {
    const h = (tpl.maxY - tpl.minY) * sc, reach = tpl.r * sc;
    if (!clearBox(pc, x, s, y - reach * 0.5, y + h, reach, kind, tube)) return false;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, m, embed);
    return put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, fa);
  };
  // 1. the lip: from where the terrace starts to break (3 m out) to ~12 m, densest right at the edge
  //    (around and beyond the crest framework; colonies on the framework itself are chain E's)
  for (let k = 0; k < 250 * lk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, w = wallAt(ctx, pc, s);
    if (!w || rng() > ctx.weightOf(s, 'wall')) continue;
    const t = 2.5 + Math.pow(rng(), 1.4) * 8, x = w.px - w.side * t, y = fs.at(x, s), n = [fs.nx, fs.ny, fs.nz];
    if (n[1] < 0.3 || onLobe(P, x, s, 0.3)) continue;
    const e = pickE(rng, lip), tpl = e.t[(rng() * e.t.length) | 0], sc = lerp(e.sc[0], e.sc[1], rng());
    const hl = Math.hypot(n[0], n[2]), face = hl > 0.05 ? Math.atan2(n[0] / hl, n[2] / hl) : Math.atan2(-w.side, 0);
    let R, m = null;
    const embed = e.mound ? 0.12 : 0.04;
    // overhanging tables and plates lean out over the drop; fans and ears face the open water
    if (e.over) R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.25 + rng() * 0.25));
    else if (e.fan || e.ear) R = mul3(rotY(face + (rng() - 0.5) * 0.5), rotX(0.1 + rng() * 0.25));
    else { R = upTo(mix3(up, n, 0.5), rng() * TAU); m = n; }
    const soft = e.sway || e.fan;
    putOn(soft ? sw : st, tpl, x, y, s, R, sc, tint(rng, e.tint, 0.18), soft ? sc : 1, m, embed, soft ? SOFT : SOLID, soft ? 1.2 : 0);
  }
  // 2. the face below the lip, down to ~22 m under it (the camera sees it when it looks out and down)
  for (let k = 0; k < 85 * lk; k++) { // (the lip hides this face from the path: the lip keeps the budget)
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, w = wallAt(ctx, pc, s);
    if (!w || rng() > ctx.weightOf(s, 'wall')) continue;
    const lipY = fs.at(w.px - w.side * 3, s), sp = outerSpot(fs, w, s, lipY - 0.8 - Math.pow(rng(), 1.3) * 22);
    if (!sp || sp.n[1] > 0.75) continue;
    const rc = w.rc, face = Math.atan2(sp.hn[0], sp.hn[2]), u = rng() * (rc.fan + rc.ear + rc.black + rc.plate + rc.enc * 1.5 + rc.whip * 0.6);
    let tpl, sc, R, b = st, col, fa = 1, m = sp.n, embed = 0.04;
    if (u < rc.fan) { tpl = pick(rng, W.fan); sc = 0.9 + Math.pow(rng(), 1.3) * 1.4; b = sw; fa = sc; col = tint(rng, rc.fanPal.length ? rc.fanPal : FANS, 0.2); R = mul3(rotY(face + (rng() - 0.5) * 0.5), rotX(0.1 + rng() * 0.3)); m = sp.hn; }
    else if (u < rc.fan + rc.ear) { tpl = pick(rng, W.ear); sc = 0.8 + rng() * 0.7; col = tint(rng, EAR); R = mul3(rotY(face + (rng() - 0.5) * 0.6), rotX(0.15 + rng() * 0.3)); m = sp.hn; }
    else if (u < rc.fan + rc.ear + rc.black) { tpl = pick(rng, W.black); sc = 0.8 + rng() * 0.8; b = sw; fa = sc * 0.4; col = tint(rng, BLACK, 0.12); R = upTo(nrm([sp.n[0], sp.n[1] - 0.25, sp.n[2]]), rng() * TAU); }
    else if (u < rc.fan + rc.ear + rc.black + rc.plate) { tpl = pick(rng, W.plate); sc = 0.8 + rng() * 0.6; col = tint(rng, PLATE, 0.18); R = rotY(face + (rng() - 0.5) * 0.5); m = sp.hn; embed = 0.03; }
    else if (u < rc.fan + rc.ear + rc.black + rc.plate + rc.enc * 1.5) { tpl = pick(rng, W.enc); sc = 0.8 + rng() * 1.1; col = tint(rng, ENC, 0.2); R = upTo(sp.n, rng() * TAU); embed = 0.025; }
    else { tpl = pick(rng, W.whip); sc = 0.8 + rng() * 0.6; b = sw; fa = sc; col = tint(rng, [[1.1, 0.4, 0.06], [1.0, 0.1, 0.12], [1.1, 0.85, 0.15], [0.9, 0.9, 0.85]]); R = upTo(mix3(sp.n, up, 0.35), rng() * TAU); }
    putOn(b, tpl, sp.x, sp.y, s, R, sc, col, fa, m, embed, b === sw ? SOFT : SOLID, b === sw ? 1.2 : 0);
  }
  return { batches: [st, sw] };
}

// ---------------------------------------------------------------- chain E: the terrace reef (spur and groove)
// The path runs over the terrace between the drop-off and the wall foot: on a real wall dive this is the
// reef top. The framework lobes of the plan (planLobes) carry colonies on their real surface: staghorn
// and finger thickets, small brain heads and tables, tube and vase sponges, sea rods, fans and whips; the
// sand grooves between the spurs hold rubble, sea stars, urchins and the odd coral head. (This was bare
// sand with a little rubble: the camera spends most of the zone looking along it.)
// on bare framework (lobes, coral heads): the hard corals of a reef top as well
const HARD = () => [
  { t: T.stag, w: 2.4, sc: [0.6, 1.15], tint: [[0.85, 0.66, 0.42], [0.72, 0.6, 0.38], [0.6, 0.66, 0.9], [0.92, 0.8, 0.55]] },
  { t: T.finger, w: 1.5, sc: [0.6, 1.2], tint: [[0.85, 0.7, 0.45], [0.75, 0.45, 0.85], [0.95, 0.85, 0.4]] },
  { t: T.brain, w: 1.3, sc: [0.35, 0.7], tint: MASSW, mid: true },
  { t: T.table, w: 0.9, sc: [0.45, 0.85], tint: TABLEW, mid: true },
].filter((e) => e.t && e.t.length);
// (knolls carry their own hard corals; these add what stands up out of a reef top)
const TOP = () => [
  { t: T.stag, w: 0.8, sc: [0.6, 1.1], tint: [[0.85, 0.66, 0.42], [0.72, 0.6, 0.38], [0.6, 0.66, 0.9], [0.92, 0.8, 0.55]] },
  { t: T.table, w: 0.5, sc: [0.45, 0.8], tint: TABLEW, mid: true },
  { t: T.barrel, w: 0.5, sc: [0.5, 0.9], tint: [[0.58, 0.24, 0.2], [0.5, 0.3, 0.22], [0.66, 0.38, 0.36]], mid: true },
  { t: T.tubeSp, w: 0.9, sc: [0.6, 1.1], tint: [[0.72, 0.12, 0.98], [1.1, 0.42, 0.05], [1.1, 0.86, 0.08], [0.95, 0.2, 0.5]] },
  { t: T.vase, w: 0.6, sc: [0.7, 1.2], tint: [[0.45, 0.6, 1.1], [0.95, 0.35, 0.7], [1.0, 0.6, 0.15]] },
  { t: T.soft, w: 1.6, sc: [0.7, 1.3], sway: true, tint: [[0.86, 0.56, 0.62], [0.9, 0.84, 0.68], [0.62, 0.64, 0.42], [0.72, 0.12, 0.98]] },
  { t: T.fan, w: 1.1, sc: [0.6, 1.2], sway: true, tint: FANS },
  { t: T.whip, w: 0.8, sc: [0.7, 1.2], sway: true, tint: [[1.1, 0.4, 0.06], [1.0, 0.1, 0.12], [1.1, 0.85, 0.15]] },
  { t: W.enc, w: 0.9, sc: [0.8, 1.4], tint: ENC },
].filter((e) => e.t && e.t.length);
// on the crest knolls at the lip: what stands up against the blue beyond
const CRESTTOP = () => [
  { t: W.fan, w: 2.4, sc: [0.9, 1.7], sway: true, tint: FANS },
  { t: W.whip, w: 1.2, sc: [0.8, 1.3], sway: true, tint: [[1.1, 0.4, 0.06], [1.0, 0.1, 0.12], [0.9, 0.9, 0.85]] },
  { t: T.soft, w: 1.2, sc: [0.9, 1.4], sway: true, tint: [[0.72, 0.12, 0.98], [0.98, 0.14, 0.62], [1.1, 0.42, 0.05]] },
  { t: T.barrel, w: 0.8, sc: [0.6, 1.1], tint: [[0.58, 0.24, 0.2], [0.5, 0.3, 0.22], [0.66, 0.38, 0.36]], mid: true },
  { t: T.table, w: 0.6, sc: [0.6, 1.0], tint: TABLEW, mid: true },
].filter((e) => e.t && e.t.length);
export function* layoutWallE(ctx) {
  const Y = slice();
  if (presence(ctx, 'wall') <= 0) return null;
  const P = planWall(ctx), bk = budgetK(ctx, 'wall'), lk = lowK(ctx);
  const rng = mulberry32(((ctx.s0 * 3266489917) ^ 0x3e55) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const frame = new Batch(MAT.static, 32000); frame.lod = 'mid';
  // (bare framework needs its hard corals from here: a larger budget than for knolls, which carry theirs)
  const bareK = P.lobes.length && P.lobes[0].kind !== 'knoll' ? 1.4 : 1;
  const mid = new Batch(MAT.static, 10000 * bk * bareK); mid.lod = 'mid';
  const near = new Batch(MAT.static, 13000 * bk * bareK); near.lod = 'near';
  const sw = new Batch(MAT.sway, 8000 * bk); sw.lod = 'near'; sw.soft = true;
  const csw = new Batch(MAT.sway, 7000 * bk); csw.lod = 'mid'; csw.soft = true; // the crest silhouettes, seen from afar
  // (knolls carry their colonies' colours in the template: a near-neutral tint; bare framework is tinted)
  const NEUTRAL = [[1, 1, 1], [1.04, 0.98, 0.94], [0.96, 0.98, 1.02]];
  for (const L of P.lobes) if (put(ctx, frame, L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sy, L.sc, tint(rng, L.kind === 'knoll' ? NEUTRAL : L.live ? MASSW : FRAMEW, 0.08))) L.item = frame.last;
  // colonies on the framework's real surface
  const top = TOP(), crestTop = CRESTTOP(), bare = [...HARD(), ...TOP()];
  for (const L of P.lobes) {
    if (Y.over()) { yield; Y.reset(); }
    if (!L.item) continue;
    const crest = L.tt < -1.5, knoll = L.kind === 'knoll', spots = itemSpots(L.item, ctx, 14, 0.55);
    const n = Math.min(spots.length, (knoll ? 1 : 2) + Math.floor(rng() * (1.2 + lk)) + (crest ? 2 : 0));
    for (let q = 0; q < n; q++) {
      const p = spots[(rng() * spots.length) | 0], e = pickE(rng, crest && (knoll || q > 1) ? crestTop : knoll ? top : bare), tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng());
      const R = upTo(mix3(UP, p.n, e.sway ? 0.3 : 0.6), rng() * TAU), h = (tpl.maxY - tpl.minY) * sc;
      if (!clearBox(pc, p.x, p.s, p.y, p.y + h, tpl.r * sc, e.sway ? SOFT : SOLID, e.sway ? 1.0 : 0)) continue;
      const Pp = decoOn(ctx, L.item, p, tpl, sc, R);
      if (!Pp) continue;
      put(ctx, e.sway ? (crest ? csw : sw) : e.mid ? mid : near, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tint(rng, e.tint, 0.15), e.sway ? sc : 1, { item: L.item });
    }
  }
  // the sand grooves (never on the framework)
  const det = TER();
  for (let k = 0; k < 110 * lk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, w = wallAt(ctx, pc, s);
    if (!w || rng() > ctx.weightOf(s, 'wall')) continue;
    const t = -3 + rng() * (w.wd + 0.5), x = w.px + w.side * t, y = fs.at(x, s), n = [fs.nx, fs.ny, fs.nz];
    if (n[1] < 0.75 || onLobe(P, x, s, 0.2)) continue;
    const e = pickE(rng, det), tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng());
    const R = upTo(mix3(UP, n, 0.8), rng() * TAU), h = (tpl.maxY - tpl.minY) * sc;
    if (!clearBox(pc, x, s, y, y + h, tpl.r * sc, e.sway ? SOFT : SOLID, e.sway ? 1.0 : 0)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, n, 0.02);
    put(ctx, e.sway ? sw : near, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tint(rng, e.tint, 0.15), e.sway ? sc : 1);
  }
  return { batches: [frame, mid, near, sw, csw] };
}
