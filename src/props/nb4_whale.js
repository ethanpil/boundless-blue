// Whale Shark Grounds: green, plankton-rich open water over a sandy, rubbly bottom some 35 m down. The show is
// near the surface: drifting clouds of copepods, larvae and fish eggs catching the sun (cheap additive particle
// volumes; whale sharks feed at them, see the 'plankton' POIs) and tufts of sargassum adrift at the surface.
// Far below, sparse coral bommies rise from rubble and pale sand.
import { Builder, Batch, T, TAU, presence, budgetK, CHUNK, sat, sstep, rotY, rotX, rotZ, mul3 } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { pathCache, clearBox, SOLID, SOFT, seat, put, upTo, mix3, segFor, recipe, lowK, slice, nbFloor, decalDisc, builderMesh, NBMAT } from './nb_common.js';
import { poolOf, itemSpots, seatOnItem, NATC } from './nb2_common.js';
import { NB3, Space } from './nb3_common.js';
import { sargClump } from './nb3_sargassum.js';
import { drainG } from './nb3_anemones.js';
import { rockJob, drain, tiered } from './rock_recipes.js';
import { planktonMeshG, rr, pick, chunkRng, L, segSeed, q01, grips, gridded, warmTpl } from './nb4_common.js';

const KEY = 'whaleshark';
const W = {};
const PLANKTON_FACT = 'A whale shark filters thousands of litres of water an hour through sieve pads in its gills to catch plankton like this.';
const SARG = [[L(0x4c3414), L(0xa4722a), L(0xbc8a3a)], [L(0x463416), L(0x86682a), L(0xa0803a)], [L(0x5a3e16), L(0xb4822e), L(0xca9c44)]];
const WS_ROCK = [{ r: 'boulder', litho: 'limestone', growth: 1, big: true, detail: 3 }, { r: 'conglomerate', growth: 1, big: true }, { r: 'pile', lithos: ['limestone', 'sandstone'], growth: 1, big: true }, { r: 'boulder', litho: 'limestone', kind: 'tafoni', growth: 1, big: true }];

export const recipeOf = (g) => recipe(g, 'nb4ws', (g) => {
  const u = (k) => sv(g, 450 + k);
  return {
    clouds: 1.6 + 2.6 * u(0), dens: 0.6 + 0.8 * u(1), depth: 3 + 7 * u(2), // plankton: clouds per chunk, particle density, typical depth
    sarg: 0.15 + 0.85 * u(3), bommie: 0.25 + 0.6 * u(4), rubble: 0.4 + 0.9 * u(5), pal: SARG[Math.floor(u(6) * SARG.length)],
  };
});
export function initWhale(tier) {
  W.sarg = [0, 1].map((i) => drainG(sargClump(5100 + i * 7, { R: 0.35 + i * 0.15, hang: 0.4, pal: SARG[i], detail: 1, tier })));
  W.rock = [drain(rockJob(tiered(WS_ROCK[0], tier), 5150))];
  for (const t of W.rock) warmTpl(t);
  return W;
}
export function whaleProviders(provide) {
  provide(KEY, 'nb4wsSarg', 4, (seg, k, tier) => { const sd = segSeed(seg, k, 0x2545f491); return sargClump(sd, { R: 0.3 + q01(sd, 3) * 0.45, hang: 0.3 + q01(sd, 9) * 0.6, pal: recipeOf(seg).pal, natans: k !== 3, detail: 1, tier }); }, 2);
  provide(KEY, 'nb4wsRock', 4, (seg, k, tier) => gridded(rockJob(tiered(WS_ROCK[(k + (seg.seed >>> 6)) % WS_ROCK.length], tier), segSeed(seg, k, 0x7feb352d))), 2);
}

// ---------------------------------------------------------------- chain A: plankton clouds and sargassum
export function* layoutWsA(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const rc0 = recipeOf(g0), bk = budgetK(ctx, KEY), pc = pathCache(ctx), surf = ctx.surfaceY, rng = chunkRng(ctx, 0x3a51);
  const per = ctx.tier === 'low' ? 480 : ctx.tier === 'medium' ? 720 : 950;
  const clouds = [], labels = [], pois = [];
  const nC = Math.floor(rc0.clouds * bk + rng());
  for (let k = 0; k < nC; k++) {
    const s = ctx.s0 + rng() * CHUNK;
    if (rng() > ctx.weightOf(s, KEY)) continue;
    const x = pc.x(s) + (rng() - 0.5) * 2 * (2 + rng() * 22), rx = 3 + rng() * 8, rz = 3 + rng() * 8, ry = 1.2 + rng() * 3;
    const y = Math.min(surf - 0.8 - ry * 0.5, surf - rc0.depth * (0.4 + rng() * 0.9));
    clouds.push({ x, y, s, rx, ry, rz, n: Math.round(per * 1.5 * rc0.dens * (0.5 + 0.7 * rng()) * Math.min(1.6, (rx * rz) / 40)), size: 0.012 + rng() * 0.012 });
    pois.push({ type: 'plankton', x, y, s, r: Math.max(rx, rz), data: { name: 'Plankton bloom', density: rc0.dens } });
    if (k === 0) labels.push(['Plankton bloom', x, y, s, PLANKTON_FACT]);
  }
  // a thin scatter everywhere else near the surface, so the clouds have no hard edges
  clouds.push({ x: pc.x(ctx.s0 + 32), y: surf - 5, s: ctx.s0 + 32, rx: 26, ry: 3.5, rz: 22, n: Math.round(per * 0.6 * rc0.dens), size: 0.011 });
  yield;
  const pm = yield* planktonMeshG(ctx, clouds, rng), extra = pm ? [pm] : [];
  // sargassum tufts adrift at the surface (single clumps and short lines), soft
  const sw = new Batch(NB3.mat.sarg, 24000 * bk); sw.soft = true; sw.lod = 'mid';
  const nS = Math.round(rc0.sarg * 9 * bk * lowK(ctx)), sp = new Space();
  for (let k = 0, n = 0; k < nS * 4 && n < nS; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const x = pc.x(s) + (rng() - 0.5) * 2 * (1 + rng() * 30), tpl = pick(rng, poolOf(g, 'nb4wsSarg', W.sarg, 2)), sc = 0.8 + rng() * 0.6, r = tpl.nbR * sc;
    if (!sp.free(x, s, r * 0.6)) continue;
    const y = surf - 0.02 - rng() * 0.04;
    if (!clearBox(pc, x, s, y + tpl.minY * sc, y, r, SOFT)) continue;
    const R = mul3(rotY(rng() * TAU), mul3(rotX((rng() - 0.5) * 0.15), rotZ((rng() - 0.5) * 0.15))), c = 0.88 + rng() * 0.24;
    if (put(ctx, sw, tpl, x, y, s, R, sc, sc * (0.85 + rng() * 0.3), sc, [c, c, c * 0.95], sc, 'surface')) { sp.add(x, s, r * 0.6); n++; }
  }
  return { batches: [sw], extra, labels, pois };
}

// ---------------------------------------------------------------- chain B: the bottom, far below
export function* layoutWsB(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const rc0 = recipeOf(g0), bk = budgetK(ctx, KEY), lk = lowK(ctx), pc = pathCache(ctx), fs = nbFloor(ctx), rng = chunkRng(ctx, 0x3a52);
  const st = new Batch(MAT.static, 40000 * bk), mid = new Batch(MAT.static, 14000 * bk * lk); mid.lod = 'mid';
  const sw = new Batch(MAT.sway, 8000 * bk * lk); sw.lod = 'mid'; sw.soft = true;
  const sp = new Space(), labels = [];
  // bommies: a limestone knoll crowned with massive corals and a few soft corals
  const nB = Math.floor(rc0.bommie * 1.8 * bk + rng());
  for (let k = 0; k < nB * 3; k++) {
    if (Y.over()) { yield; Y.reset(); }
    if (sp.big.length >= nB) break;
    const s = ctx.s0 + 6 + rng() * (CHUNK - 12), g = segFor(ctx, s, KEY);
    if (!g || ctx.weightOf(s, KEY) < 0.6) continue;
    const x = pc.x(s) + (rng() - 0.5) * 2 * (2 + rng() * 26), tpl = pick(rng, poolOf(g, 'nb4wsRock', W.rock, 2)), sc = 1.2 + rng() * 1.3, sy = sc * (0.8 + rng() * 0.6);
    if (!sp.free(x, s, tpl.r * sc)) continue;
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.4), rng() * TAU), P = [x, fs.at(x, s), s];
    seat(fs, tpl, R, sc, sy, sc, P, null, 0.1 + (tpl.maxY - tpl.minY) * sy * 0.1);
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) continue;
    if (!put(ctx, st, tpl, P[0], P[1], P[2], R, sc, sy, sc, [1.0, 0.97, 0.9], 1)) continue;
    const item = st.last;
    sp.add(P[0], P[2], Math.max(1.6, tpl.r * sc));
    if (!labels.length) labels.push(['Coral bommie', P[0], P[1] + (tpl.maxY - tpl.minY) * sy, P[2], 'Isolated coral knolls on sand are oases: fish shelter and clean each other there.']);
    const spots = itemSpots(item, ctx, 30, 0.6);
    for (let i = spots.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0, t = spots[i]; spots[i] = spots[j]; spots[j] = t; }
    for (let q = 0, n = 0; q < spots.length && n < (3 + rng() * 5) * lk; q++) {
      if (Y.over()) { yield; Y.reset(); }
      const p = spots[q], soft = rng() < 0.3, ct = soft ? pick(rng, T.soft) : pick(rng, rng() < 0.5 ? T.coralMound : rng() < 0.5 ? T.brain : T.boulder);
      const c2 = soft ? 0.7 + rng() * 0.6 : 0.35 + rng() * 0.6, R2 = upTo(mix3([0, 1, 0], p.n, 0.6), rng() * TAU), Pp = [p.x, p.y, p.s];
      if (!seatOnItem(item, ctx.s0, ct, R2, c2, Pp, 0.03) || !grips(item, ctx.s0, ct, R2, c2, c2, c2, Pp)) continue;
      if (put(ctx, soft ? sw : st, ct, Pp[0], Pp[1], Pp[2], R2, c2, c2, c2, pick(rng, soft ? NATC.soft : NATC.massive), soft ? c2 : 1, { item })) n++;
    }
  }
  yield;
  // coral rubble and shells scattered over the sand
  for (let k = 0; k < 40 * rc0.rubble * bk * lk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 2 * Math.pow(rng(), 1.1) * 34;
    if (rng() > ctx.weightOf(s, KEY)) continue;
    const tpl = pick(rng, T.rubble), sc = 0.8 + rng() * 1.2, r = tpl.r * sc;
    if (!sp.free(x, s, r, 0.1)) continue;
    const R = upTo([fs.nx, fs.ny, fs.nz], rng() * TAU), P = [x, fs.at(x, s), s];
    seat(fs, tpl, R, sc, sc, sc, P, null, 0.01);
    if (put(ctx, mid, tpl, P[0], P[1], P[2], R, sc, sc, sc, [0.95 + rng() * 0.1, 0.92 + rng() * 0.1, 0.85 + rng() * 0.1], 1)) sp.add(x, s, r);
  }
  // pale sand and grey rubble fields
  const dec = new Builder();
  for (let k = 0; k < 14 * bk; k++) {
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 60, r = 3 + rng() * 6, pale = rng() < 0.6;
    decalDisc(dec, fs, ctx, x, s, r, r * (0.5 + rng() * 0.5), rng() * TAU, pale ? [0.62, 0.6, 0.52] : [0.28, 0.27, 0.25], pale ? 0 : 3, pale ? 0.7 : 0.45, 5, 16);
  }
  const extra = [];
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  return { batches: [st, mid, sw], extra, labels };
}
