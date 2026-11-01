// Sunken Forest: a drowned coastal forest. Standing dead trunks rise from the silt toward the light
// (conifer snags with whorls of branch stubs, gnarled oaks, buttressed cypress, snapped and forked
// trunks), fallen logs with upturned root plates, stumps. The wood is claimed by plumose anemones,
// sponges, mussels and tunicates; algae streamers trail down-current from the branches; light shafts
// slice between the trunks. Trunks are solid: they keep the flight tube clear, so the camera weaves a
// natural corridor, and a big trunk on the outside of each bend comes up dead ahead.
import { Batch, TAU, rotY, rotZ, mul3, presence, budgetK, CHUNK, T, Builder, bendSpots, TUBE } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { NBMAT, pathCache, clearBox, clearSpine, SOLID, SOFT, seat, put, upTo, mix3, segFor, recipe, lowK, slice, nbFloor, decalDisc, builderMesh, lab } from './nb_common.js';
import { encrust, cheapMussels, tunicates, fuzzTuft } from './nb_shapes.js';
import { treeG, logG, stumpG, drainG } from './nb2_trees.js';
import { plumose, streamers, twig } from './nb2_life.js';
import { NB2, pick, tintOf, chunkRng, poolOf, itemSpots, shaftMesh, Occ, planned, decoOn } from './nb2_common.js';

const F = {};
const KINDS = ['snag', 'broad', 'cypress', 'broken', 'fork'];
export function initForest(tier) {
  F.tree = [['snag', 11], ['snag', 12], ['broad', 13], ['cypress', 14], ['broken', 15], ['fork', 16], ['snag', 17], ['broken', 18]].map(([k, s]) => drainG(treeG(4100 + s * 31, k, { tier })));
  F.log = [1, 2, 3].map((s) => drainG(logG(4300 + s * 17, { tier })));
  F.stump = [1, 2, 3].map((s) => drainG(stumpG(4400 + s * 13)));
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(4500 + i * 19 + o));
  F.plumose = R(6, (s) => plumose(s, { h: 0.18 + (s % 4) * 0.06 }));
  F.streamer = R(8, (s) => streamers(s, { L: 0.8 + (s % 4) * 0.35, n: 7 + (s % 5) * 2 }), 1);
  F.enc = R(6, (s) => encrust(s, { r: 0.12 + (s % 4) * 0.05, h: 0.05 + (s % 3) * 0.025, lobes: 0.6, detail: 1, elong: 1 + (s % 3) * 0.4 }), 2);
  F.mussel = R(4, (s) => cheapMussels(s, { n: 8 + (s % 3) * 5, r: 0.1 + (s % 3) * 0.05, L: 0.075, col: [0.12, 0.12, 0.16], edge: [0.35, 0.3, 0.25] }), 3);
  F.tunic = R(3, (s) => tunicates(s, { n: 3 + (s % 3) * 2, H: 0.06, R: 0.02 }), 4);
  F.fuzz = R(4, (s) => fuzzTuft(s, { n: 14 + (s % 3) * 6, r: 0.06, h: 0.12 + (s % 3) * 0.05 }), 5);
  F.twig = R(8, twig, 6);
  lab(F.enc, 'Encrusting sponge', null);
  lab(F.mussel, 'Mussel clump', 'Mussels lash themselves to drowned wood with tough byssal threads.');
  lab(F.tunic, 'Sea squirts', 'Sea squirt larvae have a backbone-like rod: they are distant cousins of ours.');
  lab(F.fuzz, 'Hydroid turf', null);
  for (const t of [...F.enc, ...F.mussel, ...F.tunic, ...F.twig]) t.solid = false;
  return F;
}

// ---------------------------------------------------------------- per-segment forest recipe
const FORESTS = {
  conifer: { w: 1.2, kinds: { snag: 6, broken: 2, fork: 0.6, cypress: 0.3 }, name: 'drowned conifers' },
  cypress: { w: 0.9, kinds: { cypress: 5, broken: 1.5, snag: 0.6 }, name: 'drowned cypress swamp' },
  oak: { w: 0.8, kinds: { broad: 4, fork: 2, broken: 2, snag: 0.6 }, name: 'drowned oak wood' },
  mixed: { w: 1.0, kinds: { snag: 2.5, broad: 2, cypress: 1, broken: 1.5, fork: 1 }, name: 'drowned mixed forest' },
};
export const recipeOf = (g) => recipe(g, 'nb2sf', (g) => {
  const keys = Object.keys(FORESTS);
  let tot = 0; for (const k of keys) tot += FORESTS[k].w;
  let u = sv(g, 60) * tot, f = FORESTS.mixed;
  for (const k of keys) { if ((u -= FORESTS[k].w) <= 0) { f = FORESTS[k]; break; } }
  return {
    f, kinds: Object.entries(f.kinds).map(([k, w]) => [w, k]),
    dens: 0.75 + sv(g, 61) * 0.6, spacing: 3.6 + sv(g, 62) * 2.2, algae: 0.3 + sv(g, 63) * 0.9, anem: 0.2 + sv(g, 64) * 1.1,
    sponge: 0.3 + sv(g, 65) * 0.8, mussel: 0.2 + sv(g, 66) * 0.9, logs: 0.4 + sv(g, 67) * 1.1, stumps: 0.3 + sv(g, 68) * 1.2,
    cur: sv(g, 69) * TAU, shafts: 0.5 + sv(g, 70), litter: 0.5 + sv(g, 71),
    anemPal: sv(g, 72) < 0.6 ? [[0.92, 0.9, 0.86], [0.88, 0.84, 0.8]] : [[0.98, 0.55, 0.25], [0.92, 0.88, 0.84], [0.98, 0.68, 0.45]],
  };
});
// tree kind for slot k of a segment palette: stratified over the recipe weights
export function treeKind(g, k, n = 10) {
  const rc = recipeOf(g), list = rc.kinds;
  let tot = 0; for (const e of list) tot += e[0];
  let u = (((k + 0.5) / n) + sv(g, 73)) % 1 * tot;
  for (const e of list) { if ((u -= e[0]) <= 0) return e[1]; }
  return list[list.length - 1][1];
}

// ---------------------------------------------------------------- plan: trees, logs, stumps
const tf = (it, s0, x, y, z) => { // template point -> global [x, y, s]
  const R = it.R, px = x * it.sx, py = y * it.sy, pz = z * it.sz;
  return [R[0] * px + R[1] * py + R[2] * pz + it.x, R[3] * px + R[4] * py + R[5] * pz + it.y, s0 - (R[6] * px + R[7] * py + R[8] * pz + it.z)];
};
function spineClear(pc, ctx, tpl, x, y, s, R, sx, sy, sz, margin = 0.35) {
  const sp = tpl.spine, pts = [];
  if (!sp) return true;
  const it = { R, sx, sy, sz, x, y, z: -(s - ctx.s0) };
  for (let i = 0; i < sp.length; i += 4) { const p = tf(it, ctx.s0, sp[i], sp[i + 1], sp[i + 2]); pts.push(p[0], p[1], p[2], sp[i + 3] * Math.max(sx, sz)); }
  return clearSpine(pc, pts, SOLID, margin);
}
const PL = planned(function* (ctx) {
  const Y = slice(2.5);
  const rng = chunkRng(ctx, 0x5f11), fs = nbFloor(ctx), pc = pathCache(ctx), occ = new Occ(), bk = budgetK(ctx, 'sunkenforest');
  const trees = [], logs = [], stumps = [];
  const surf = ctx.surfaceY - 0.45;
  const tryTree = (x, s, g, tpl, sc, ahead = false) => {
    const R = rotY(rng() * TAU), y = fs.at(x, s);
    let sy = sc * (0.92 + rng() * 0.16);
    if (y + tpl.maxY * sy > surf) sy = (surf - y) / tpl.maxY;
    if (sy < sc * 0.72) return false;
    const rTr = Math.max(0.6, tpl.r * sc * (tpl.kind === 'broad' || tpl.kind === 'fork' ? 0.55 : 0.3));
    if (!occ.free(x, s, rTr)) return false;
    if (!spineClear(pc, ctx, tpl, x, y, s, R, sc, sy, sc, ahead ? 0.5 : 0.35)) return false;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sy, sc, Pp, null, 0.03);
    occ.add(x, s, rTr);
    trees.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, sy, g, ahead });
    return true;
  };
  // big trunks on the outside of the bends: dead ahead on approach, the camera curves past them
  for (const b of bendSpots(ctx, 0.01, 2)) {
    const g = segFor(ctx, b.s, 'sunkenforest');
    if (!g || ctx.weightOf(b.s, 'sunkenforest') < 0.6 || rng() > 0.8) continue;
    const pool = poolOf(g, 'nb2sfTree', F.tree), tpl = pick(rng, pool.filter((t) => t.kind !== 'broad' && t.kind !== 'fork').concat(F.tree.slice(0, 1)));
    const sc = 1.0 + rng() * 0.2, rb = 0.5 * sc;
    for (let q = 0; q < 3; q++) if (tryTree(pc.x(b.s) + b.side * (TUBE + rb + 0.6 + rng() * 1.5), b.s + (rng() - 0.5) * 3, g, tpl, sc, true)) break;
  }
  // the forest: near trunks line the corridor, more stand back in the haze
  const low = ctx.tier === 'low', nT = (low ? 34 : 46) * bk;
  for (let k = 0; k < nT * 2.2 && trees.length < nT; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'sunkenforest');
    if (!g) continue;
    const rc = recipeOf(g);
    if (rng() > ctx.weightOf(s, 'sunkenforest') * Math.min(1, rc.dens)) continue;
    const u = rng(), side = rng() < 0.5 ? -1 : 1;
    const d = u < 0.4 ? TUBE + 0.8 + rng() * 8 : u < 0.85 ? 11 + rng() * 22 : 33 + rng() * (low ? 18 : 32);
    const pool = poolOf(g, 'nb2sfTree', F.tree), tpl = pick(rng, pool), sc = 0.85 + rng() * 0.35;
    if (!occ.free(pc.x(s) + side * d, s, rc.spacing * (u < 0.4 ? 0.9 : 1))) continue;
    tryTree(pc.x(s) + side * d, s, g, tpl, sc);
  }
  // fallen logs (often across the corridor floor, below the camera) and stumps
  for (let k = 0; k < 9 * bk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'sunkenforest');
    if (!g) continue;
    const rc = recipeOf(g);
    if (rng() > ctx.weightOf(s, 'sunkenforest') * rc.logs * 0.7) continue;
    const x = pc.x(s) + (rng() - 0.5) * 2 * (2 + rng() * 34), tpl = pick(rng, poolOf(g, 'nb2sfLog', F.log, 2)), sc = 0.85 + rng() * 0.35;
    const yaw = rng() * TAU, L = tpl.len * sc, ca = Math.cos(yaw), sa = Math.sin(yaw);
    // tilt along the slope under the log so it lies on the silt along its whole length
    const ya = fs.at(x - ca * L * 0.45, s + sa * L * 0.45), yb = fs.at(x + ca * L * 0.45, s - sa * L * 0.45);
    const R = mul3(rotY(yaw), rotZ(Math.atan2(yb - ya, L * 0.9)));
    if (!occ.free(x, s, L * 0.4)) continue;
    const y = fs.at(x, s);
    if (!spineClear(pc, ctx, tpl, x, y, s, R, sc, sc, sc)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.04);
    occ.add(x, s, L * 0.4);
    logs.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, g });
  }
  for (let k = 0; k < 10 * bk; k++) {
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'sunkenforest');
    if (!g) continue;
    const rc = recipeOf(g);
    if (rng() > ctx.weightOf(s, 'sunkenforest') * rc.stumps * 0.6) continue;
    const x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (1.5 + rng() * 36), tpl = pick(rng, poolOf(g, 'nb2sfStump', F.stump, 2)), sc = 0.8 + rng() * 0.5;
    if (!occ.free(x, s, tpl.r * sc * 0.6)) continue;
    const y = fs.at(x, s), R = rotY(rng() * TAU);
    if (!spineClear(pc, ctx, tpl, x, y, s, R, sc, sc, sc)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.03);
    occ.add(x, s, tpl.r * sc * 0.6);
    stumps.push({ tpl, x: Pp[0], y: Pp[1], s: Pp[2], R, sc, g });
  }
  return { trees, logs, stumps, occ };
});
const plan = (ctx) => PL.get(ctx);
export function layoutSfP(ctx) { return presence(ctx, 'sunkenforest') > 0 ? PL.stage(ctx) : null; }

// ---------------------------------------------------------------- chain A: the wood (bark material)
export function layoutSfA(ctx) {
  if (presence(ctx, 'sunkenforest') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'sunkenforest');
  const rng = chunkRng(ctx, 0x5f22), pc = pathCache(ctx);
  const wood = new Batch(NB2.mat.bark, 120000 * bk);
  const labels = [], pois = [];
  let best = null, bd = 1e9;
  const tone = () => tintOf(rng, [[1, 1, 1], [0.92, 0.95, 1.0], [1.05, 1.0, 0.92], [0.85, 0.85, 0.82]], 0.06);
  for (const T0 of P.trees) {
    if (!put(ctx, wood, T0.tpl, T0.x, T0.y, T0.s, T0.R, T0.sc, T0.sy, T0.sc, tone())) continue;
    T0.item = wood.last;
    const d = Math.abs(T0.x - pc.x(T0.s));
    if (T0.tpl.maxY * T0.sy > 6 && d < bd && d > 4.5) { bd = d; best = T0; }
  }
  for (const L of P.logs) if (put(ctx, wood, L.tpl, L.x, L.y, L.s, L.R, L.sc, L.sc, L.sc, tone())) L.item = wood.last;
  for (const S of P.stumps) if (put(ctx, wood, S.tpl, S.x, S.y, S.s, S.R, S.sc, S.sc, S.sc, tone())) S.item = wood.last;
  if (best) {
    const h = best.tpl.maxY * best.sy;
    pois.push({ type: 'drowned-tree', x: best.x, y: best.y + h * 0.5, s: best.s, r: 3, data: { name: best.tpl.label, fact: best.tpl.fact } });
  }
  if (P.logs.length) { const L = P.logs[0]; pois.push({ type: 'fallen-log', x: L.x, y: L.y + 0.6, s: L.s, r: 2.5, data: { name: L.tpl.label, fact: L.tpl.fact } }); }
  return { batches: [wood], labels, pois };
}

// streamers hang from a single holdfast point: push it a little into the wood
const streamAt = (p, it) => (p.lr < 0.025 ? null : [p.x - p.n[0] * 0.03, p.y - p.n[1] * 0.03, p.s + p.n[2] * 0.03]);

// ---------------------------------------------------------------- chain B: life on the wood
export function* layoutSfB(ctx) {
  const Y = slice();
  if (presence(ctx, 'sunkenforest') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'sunkenforest'), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0x5f33), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 30000 * bk); st.lod = 'mid';
  const sw = new Batch(MAT.sway, 40000 * bk); sw.lod = 'mid'; sw.soft = true;
  const surf = ctx.surfaceY;
  const all = [...P.trees, ...P.logs, ...P.stumps];
  for (const W of all) {
    if (Y.over()) { yield; Y.reset(); }
    if (!W.item) continue;
    const rc = recipeOf(W.g), d = Math.abs(W.x - pc.x(W.s)), near = d < 16, kk = (near ? 1 : d < 30 ? 0.4 : 0.15) * lk;
    // spots facing up/sideways for sessile life; branch undersides for the streamers
    const up = itemSpots(W.item, ctx, 60, -0.25);
    const n = Math.round(up.length * kk * 0.45);
    for (let q = 0; q < n; q++) {
      if (Y.over()) { yield; Y.reset(); }
      const p = up[(rng() * up.length) | 0];
      if (p.y > surf - 0.6) continue;
      const shallow = p.y > surf - 3.5, u = rng() * (rc.anem + rc.sponge + rc.mussel + rc.algae * 1.4 + (shallow ? 1.2 : 0.2) + 0.3);
      let tpl, b = st, sc, col, fa = 1, R, a;
      if (u < (a = rc.anem)) { tpl = pick(rng, F.plumose); sc = 0.8 + rng() * 0.8; col = tintOf(rng, rc.anemPal, 0.06); R = upTo(mix3(p.n, [0, 1, 0], 0.45), rng() * TAU); }
      else if (u < (a += rc.sponge)) { tpl = pick(rng, F.enc); sc = 0.7 + rng() * 0.9; col = tintOf(rng, [[1.05, 0.55, 0.12], [1.0, 0.85, 0.2], [0.75, 0.3, 0.6], [0.95, 0.4, 0.3]], 0.12); }
      else if (u < (a += rc.mussel)) { tpl = pick(rng, F.mussel); sc = 0.8 + rng() * 0.6; col = tintOf(rng, [[1, 1, 1]], 0.1); }
      else if (u < (a += rc.algae * 1.4)) { // streamers trail down-current from the wood (downstream faces only)
        if (p.n[0] * Math.cos(rc.cur) - p.n[2] * Math.sin(rc.cur) < 0.15) continue;
        tpl = pick(rng, F.streamer); b = sw; sc = 0.7 + rng() * 0.7; fa = sc;
        col = tintOf(rng, [[0.24, 0.3, 0.1], [0.3, 0.28, 0.12], [0.34, 0.24, 0.1], [0.2, 0.28, 0.14]], 0.15);
        R = rotY(rc.cur + (rng() - 0.5) * 0.6);
      } else if (u < (a += shallow ? 1.2 : 0.2)) { tpl = pick(rng, F.fuzz); b = sw; sc = 1 + rng() * 1.2; fa = sc; col = tintOf(rng, [[0.3, 0.55, 0.15], [0.45, 0.6, 0.2], [0.6, 0.5, 0.25]], 0.12); }
      else { tpl = pick(rng, F.tunic); sc = 0.9 + rng() * 0.6; col = tintOf(rng, [[0.95, 0.85, 0.55], [0.9, 0.55, 0.35], [0.75, 0.8, 0.9]], 0.1); }
      R = R || upTo(p.n, rng() * TAU);
      const Pp = tpl === F.streamer[0] || F.streamer.includes(tpl) ? streamAt(p, W.item) : decoOn(ctx, W.item, p, tpl, sc, R);
      if (!Pp) continue;
      const x = Pp[0], y = Pp[1], s = Pp[2], h = (tpl.maxY - tpl.minY) * sc;
      if (!clearBox(pc, x, s, y - h, y + h, tpl.r * sc, b === sw ? SOFT : SOLID, b === sw ? 1.0 : 0)) continue;
      put(ctx, b, tpl, x, y, s, R, sc, sc, sc, col, fa, { item: W.item });
    }
  }
  return { batches: [st, sw] };
}

// ---------------------------------------------------------------- chain C: the forest floor + light shafts
export function* layoutSfC(ctx, env) {
  const Y = slice();
  if (presence(ctx, 'sunkenforest') <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, 'sunkenforest'), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0x5f44), fs = nbFloor(ctx), pc = pathCache(ctx);
  const near = new Batch(MAT.static, 16000 * bk); near.lod = 'near';
  const dec = new Builder();
  const FLOOR = () => [
    { t: F.twig, w: 3, sc: [0.7, 1.3], tint: [[1, 1, 1], [0.85, 0.85, 0.8]] },
    { t: T.tpStar, w: 0.7, sc: [0.12, 0.22], tint: [[1.0, 0.45, 0.12], [0.6, 0.2, 0.55], [0.95, 0.3, 0.2]] },
    { t: T.tpUrchin, w: 0.35, sc: [0.05, 0.09], tint: [[0.55, 0.25, 0.6], [0.4, 0.3, 0.2]] },
    { t: T.tpAnemPink, w: 0.4, sc: [0.5, 1.0], tint: [[1, 1, 1]] },
    { t: T.rubble, w: 0.6, sc: [0.6, 1.2], tint: [[0.7, 0.66, 0.6]] },
  ].filter((e) => e.t && e.t.length);
  const list = FLOOR();
  let tot = 0; for (const e of list) tot += e.w;
  for (let k = 0; k < 160 * lk * bk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'sunkenforest');
    if (!g || rng() > ctx.weightOf(s, 'sunkenforest')) continue;
    const x = pc.x(s) + (rng() - 0.5) * 2 * (1 + Math.pow(rng(), 1.5) * 18);
    let u = rng() * tot, e = list[0];
    for (const q of list) { if ((u -= q.w) < 0) { e = q; break; } }
    const tpl = pick(rng, e.t), sc = e.sc[0] + rng() * (e.sc[1] - e.sc[0]), y = fs.at(x, s), R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.8), rng() * TAU);
    if (!P.occ.free(x, s, 0.3)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.015);
    put(ctx, near, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tintOf(rng, e.tint, 0.12));
  }
  // leaf litter, darker silt around the trunk feet, pale sand ripples
  for (let k = 0; k < 26 * lk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 2 * (2 + rng() * 26), g = segFor(ctx, s, 'sunkenforest');
    if (!g) continue;
    const r = 0.8 + rng() * 2.2, rc = recipeOf(g);
    if (rng() > rc.litter) continue;
    decalDisc(dec, fs, ctx, x, s, r, r * (0.5 + rng() * 0.5), rng() * TAU, tintOf(rng, [[0.28, 0.2, 0.12], [0.35, 0.28, 0.16], [0.22, 0.2, 0.15]], 0.15), 2, 0.5 + rng() * 0.3, 5, 16);
  }
  for (const T0 of P.trees) {
    if (Y.over()) { yield; Y.reset(); }
    if (Math.abs(T0.x - pc.x(T0.s)) > 30) continue;
    const r = T0.tpl.r * T0.sc * 0.35 + 0.8;
    decalDisc(dec, fs, ctx, T0.x, T0.s, r, r, rng() * TAU, [0.16, 0.14, 0.11], 3, 0.45, 4, 14);
  }
  const extra = [];
  yield;
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  // light shafts slicing down between the trunks
  const sun = env && env.U && env.U.uSunDir ? env.U.uSunDir.value : { x: 0.3, y: 0.9, z: -0.2 };
  const beams = [], g0 = segFor(ctx, ctx.s0 + 32, 'sunkenforest'), nB = g0 ? Math.round((2 + rng() * 4) * recipeOf(g0).shafts) : 0;
  for (let k = 0; k < nB * 3 && beams.length < nB; k++) {
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 2 * (2 + rng() * 22);
    if (!P.occ.free(x, s, 1.2)) continue;
    beams.push({ x, s, yTop: ctx.surfaceY - 0.05, yBot: fs.at(x, s) - 0.5, r0: 0.35 + rng() * 1.1, ph: rng() });
  }
  const sm = shaftMesh(ctx, beams, sun);
  if (sm) extra.push(sm);
  return { batches: [near], extra };
}
export { KINDS };
