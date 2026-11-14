// Cold-Water Coral Reef: mounds and ridges of Lophelia framework on a current-swept bank (terrain: coldCoral() in
// biomes.js). Living thickets crown the mounds and their current-facing flanks, white and orange colonies mixed;
// below them dead framework clumps grade into rubble skirts and rubble tails trailing downcurrent; plain silt
// between the mounds. Squat lobsters perch on the colonies, brittle stars, pencil urchins and anemones sit on the
// rubble. Set pieces per segment: the reef summit (the richest thicket of a mound beside the path) and a
// trawl-scarred patch (flattened framework, parallel furrows, crushed rubble). Darwin-Mounds style segments are
// low sand mounds with sparser coral and xenophyophores in their tails.
// Chain A: colonies, dead framework, rubble, squat lobsters, summit. Chain B: rubble life, tails, trawl scar.
import { Batch, Builder, TAU, presence, budgetK, CHUNK } from './core.js';
import { MAT } from './materials.js';
import { sv, coldCoral, ccSample } from '../biomes.js';
import { pathCache, clearBox, SOLID, SOFT, seat, put, upTo, mix3, segFor, recipe, lowK, slice, nbFloor, decalRibbon, builderMesh, NBMAT, lab } from './nb_common.js';
import { poolOf, itemSpots } from './nb2_common.js';
import { Space } from './nb3_common.js';
import { pick, chunkRng, segSeed, q01, grips, gridded, warmTpl, IBatch, iput } from './nb4_common.js';
import { xeno } from './nb4_hadal.js';
import { colonyJob, bush, drainJob, lopheliaMaterial, rubble, squatLobster, brittleStar, pencilUrchin, anemone, LIVE_WHITE, LIVE_ORANGE, DEAD } from './nb6_lophelia.js';
import { smoothstep, noise2 } from '../noise.js';

const KEY = 'coldcoral';
const CC = {};
// On-screen facts: wordings confirmed from a source that was read (docs/SOURCES.md)
export const CC_FACTS = {
  white: 'Lophelia grows orange and white side by side; it has no algal partners and catches zooplankton.',
  orange: 'A 1.5 m coral colony may be about 250 years old, if it grows about 6 mm a year.',
  dead: 'Mingulay reef growth reached up to 12 mm a year, averaging 3-4 mm.',
  rubble: 'A Lophelia reef community can hold up to three times the diversity of the surrounding soft seabed.',
  mound: 'Lophelia reefs live from about 200 m to over 2,000 m deep, in water typically 4-8 °C.',
  mingulay: "Scotland's Mingulay reefs include live coral at 120-190 m; first mapped in 2003.",
  darwin: 'The Darwin Mounds were found in 1998 and lie at 710-1,129 m; mounds are up to 75 m wide and 5 m high.',
  summit: 'Measured growth of Lophelia ranges from about 2 to 35 mm a year, depending on the method.',
  scarRost: 'Røst Reef, off Lofoten, is about 43 km long and up to 6.9 km wide, and is closed to bottom trawling.',
  scarDarwin: 'The Darwin Mounds were found in 1998 and closed to bottom trawling in 2004.',
};
const NAME = { white: 'Lophelia coral (white)', orange: 'Lophelia coral (orange)', dead: 'Dead coral framework' };

// ---------------------------------------------------------------- templates, providers, recipe
const hiT = (tier) => tier === 'high' || tier === 'ultra';
const colOpts = (tier, h, orange) => ({ h, col: orange ? LIVE_ORANGE : LIVE_WHITE, detail: hiT(tier) ? 1 : 0, maxSeg: hiT(tier) ? 160 : 110 });
const deadOpts = (tier, h) => ({ h, live: 0, broken: 0.3, spread: 1.35, detail: 0, maxSeg: hiT(tier) ? 90 : 60 });
const labelLive = (t, orange) => lab(t, orange ? NAME.orange : NAME.white, orange ? CC_FACTS.orange : CC_FACTS.white);
function* labelled(it, f) { const t = yield* it; return t ? f(t) : t; }
export const recipeOf = (g) => recipe(g, 'nb6cc', (g) => {
  const u = (k) => sv(g, 640 + k), darwin = coldCoral(g).darwin;
  return { darwin, live: (darwin ? 0.45 : 0.75) + 0.5 * u(0), orange: 0.25 + 0.45 * u(1), dead: 0.6 + 0.6 * u(2), rubble: 0.6 + 0.8 * u(3),
    lobster: 0.4 + 0.9 * u(4), brittle: 0.4 + 1.0 * u(5), urchin: 0.3 + 0.8 * u(6), anemone: 0.3 + 0.9 * u(7), moundFact: u(8) < 0.5 ? 'mound' : 'mingulay' };
});
export function initColdCoral(tier) {
  CC.mat = lopheliaMaterial();
  CC.white = [0, 1].map((i) => labelLive(warmTpl(drainJob(colonyJob(9100 + i, colOpts(tier, 1.0 + 0.3 * i, false))), [0]), false));
  CC.orange = [0, 1].map((i) => labelLive(warmTpl(drainJob(colonyJob(9110 + i, colOpts(tier, 0.9 + 0.35 * i, true))), [0]), true));
  CC.dead = [0, 1].map((i) => lab(warmTpl(drainJob(colonyJob(9120 + i, deadOpts(tier, 1.0 + 0.4 * i))), [0]), NAME.dead, CC_FACTS.dead));
  CC.bush = [0, 1, 2, 3].map((i) => labelLive(bush(9190 + i, i < 2 ? LIVE_WHITE : LIVE_ORANGE), i >= 2)); // white, white, salmon, salmon
  CC.rubble = [0, 1].map((i) => lab(rubble(9130 + i), 'Coral rubble', CC_FACTS.rubble));
  CC.lobster = [0, 1].map((i) => lab(squatLobster(9140 + i), 'Squat lobster (Munida)', CC_FACTS.rubble));
  CC.brittle = [0, 1].map((i) => lab(brittleStar(9150 + i), 'Brittle star', null));
  CC.urchin = [0, 1].map((i) => lab(pencilUrchin(9160 + i), 'Pencil urchin (Cidaris)', null));
  CC.anemone = [0, 1].map((i) => lab(anemone(9170 + i), 'Sea anemone', null));
  CC.xeno = [0, 1, 2].map((i) => { const t = xeno(9180 + i, i % 3); return lab(t, 'Xenophyophore', null); });
  return CC;
}
export function coldCoralProviders(provide) {
  // living colonies: white and orange in the segment's own proportion, a range of sizes (0.6-1.5 m tall)
  provide(KEY, 'nb6ccLive', 6, (seg, k, tier) => {
    const sd = segSeed(seg, k, 0x2c1b3c6d), orange = ((k + 0.5) / 6 + q01(sd, 3) * 0.15) % 1 < recipeOf(seg).orange;
    return labelled(gridded(colonyJob(sd, colOpts(tier, 0.8 + 0.7 * q01(sd, 7), orange)), [0]), (t) => labelLive(t, orange));
  }, 2);
  provide(KEY, 'nb6ccDead', 4, (seg, k, tier) => {
    const sd = segSeed(seg, k, 0x297a2d39);
    return labelled(gridded(colonyJob(sd, deadOpts(tier, 0.8 + 0.8 * q01(sd, 5))), [0]), (t) => lab(t, NAME.dead, CC_FACTS.dead));
  }, 2);
}

// ---------------------------------------------------------------- shared placement helpers
const smp = {};
// colony / framework clump on the floor, upright-ish on the slope, seated by its trunk bases
function placeColony(ctx, fs, pc, co, tpl, x, s, sc, sy, embed, rng, col) {
  fs.at(x, s);
  if (fs.ny < 0.55) return null;
  const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.35), rng() * TAU), P = [x, fs.at(x, s), s];
  seat(fs, tpl, R, sc, sy, sc, P, null, embed);
  const rad = (tpl.nbR || tpl.r) * sc, H = tpl.maxY - tpl.minY;
  if (!clearBox(pc, P[0], P[2], P[1], P[1] + H * sy, rad, SOLID)) {
    // under the flight path: a lower, squatter colony whose top stays clear below it (low props may pass under)
    const room = Math.min(pc.y(s - rad), pc.y(s), pc.y(s + rad)) - 1.45 - P[1], k = room / (H * sy);
    if (k < 0.55) return null;
    sc *= Math.min(1, k); sy *= Math.min(1, k);
    P[0] = x; P[1] = fs.at(x, s); P[2] = s;
    seat(fs, tpl, R, sc, sy, sc, P, null, embed);
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + H * sy, (tpl.nbR || tpl.r) * sc, SOLID)) return null;
  }
  if (!put(ctx, co, tpl, P[0], P[1], P[2], R, sc, sy, sc, col)) return null;
  return co.last;
}
const tint = (rng, k = 0.12) => { const v = 1 - k + 2 * k * rng(); return [v * (0.97 + 0.06 * rng()), v, v * (0.97 + 0.06 * rng())]; };

// ---------------------------------------------------------------- chain A: coral, framework, rubble, squat lobsters, summit
// ---------------------------------------------------------------- chain C: the reef fabric
// Seen from a few metres up, a reef mound is covered: hundreds of living colonies packed over the crown and the face
// into the current, a dark tangle of dead framework under and below them, then rubble. Two layers on one global
// lattice (step 0.64 m divides the 64 m chunk, so neighbouring chunks share their border row exactly):
//  - the tangle: a low, lumpy, dark grey-brown skin hugging the floor, its vertices jittered and its edge broken by
//    dropped and sunk vertices fading into the rubble colour, so it reads as "the floor under the coral", not an object;
//  - the thicket: low-poly bush instances (nb6_lophelia.bush, ~120 triangles) in clustered patches over the living
//    zone, white and salmon mixed, packed so neighbours touch, thinning to singles down the flanks.
// Rows are built across continuation stages (<= 2 ms each); normals come from the floor facets (no smoothing pass).
const BUSH_CAP = { low: 520, medium: 950, high: 1600, ultra: 1600 };
const jit = (i, j, k) => { const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return h - Math.floor(h) - 0.5; };
export function* layoutCcC(ctx) {
  const Y = slice(2);
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), st = 0.64, HW = 50, b = new Builder(), S = {}, rng = chunkRng(ctx, 0x6cc3), bk = budgetK(ctx, KEY);
  const j0 = Math.round(ctx.s0 / st), nJ = Math.round(CHUNK / st), cand = [];
  let prev = null;
  for (let j = 0; j <= nJ; j++) {
    if (Y.over()) { yield; Y.reset(); }
    const sRow = (j0 + j) * st, g = segFor(ctx, sRow, KEY);
    if (!g) { prev = null; continue; }
    const rc = recipeOf(g), px = pc.x(sRow), i0 = Math.floor((px - HW) / st), i1 = Math.ceil((px + HW) / st), row = { i0, n: [] };
    for (let i = i0; i <= i1; i++) {
      // jittered lattice node (the jitter is a function of the global node, so border rows match)
      const x = i * st + jit(i, j0 + j, 1) * st * 0.6, s = sRow + (j === 0 || j === nJ ? 0 : jit(i, j0 + j, 2) * st * 0.6);
      ccSample(g, x, s, S);
      const fy = fs.at(x, s), nx = fs.nx, ny = fs.ny, nz = fs.nz, ad = Math.abs(x - pc.x(s));
      const th = 0.2 + 0.14 * noise2(x / 3.1, s / 3.1, 634) + 0.08 * noise2(x / 1.1, s / 1.1, 639);
      const cover = smoothstep(th, th + 0.1, S.p) * (1 - smoothstep(0.12, 0.35, S.scar)) * Math.min(1, ctx.weightOf(s, KEY) * 1.5);
      const live = smoothstep(0.5, 0.72, S.p + 0.1 * noise2(x / 5.3, s / 5.3, 636)) * (0.7 + 0.3 * smoothstep(0.3, -0.5, S.u)) * Math.min(1, rc.live) * (1 - smoothstep(0.1, 0.3, S.scar));
      row.n.push({ x, s, fy, nx, ny, nz, cover, v: -1 });
      // thicket candidates: clustered patches (~70 % of the living zone), thinning to singles down the flank
      if (live > 0.05 && ad < 32) { // (within reach of the lamps: farther crowns keep the tangle and the hero-free silhouette)
        const patch = smoothstep(-0.25, 0.15, noise2(x / 3.5, s / 3.5, 637) + 0.35 * live - 0.15);
        const w = live * (0.15 + 0.85 * patch);
        if (rng() < w) cand.push({ x, s, w, ad, rc, g });
      }
    }
    // the tangle: vertices only where there is cover (the edge is broken where they drop out)
    for (const N of row.n) {
      if (N.cover < 0.04) continue;
      const lump = Math.max(0, noise2(N.x / 1.3, N.s / 1.3, 631) + 0.2) * 0.7 + Math.max(0, noise2(N.x / 0.55, N.s / 0.55, 632)) * 0.3;
      const c = N.cover, y = N.fy - 0.08 + c * (0.1 + 0.3 * lump) * (N.x - pc.x(N.s) > 4.5 || N.x - pc.x(N.s) < -4.5 ? 1 : 0.5);
      const f = (0.6 + 0.4 * smoothstep(0.1, 0.6, c)) * (0.8 + 0.25 * Math.max(0, noise2(N.x / 1.3, N.s / 1.3, 631) + 0.2)) * 0.62; // fades into the rubble at the edge (and stays darker than it: lit from above it read as a pale sheet)
      N.v = b.v(N.x, y, -(N.s - ctx.s0), N.nx, N.ny, N.nz, DEAD[0] * f, DEAD[1] * f, DEAD[2] * f, 0, 1);
    }
    if (prev) for (let k = 0; k < row.n.length - 1; k++) {
      const pk = k + row.i0 - prev.i0;
      if (pk < 0 || pk >= prev.n.length - 1) continue;
      const a = prev.n[pk].v, bb = prev.n[pk + 1].v, cc = row.n[k].v, d = row.n[k + 1].v;
      if (a >= 0 && bb >= 0 && cc >= 0) b.t(a, bb, cc);
      if (bb >= 0 && d >= 0 && cc >= 0) b.t(bb, d, cc);
    }
    prev = row;
  }
  yield;
  // the thicket: a random subset of the candidates up to the tier's cap
  const cap = Math.round((BUSH_CAP[ctx.tier] || 1200) * bk);
  for (let i = cand.length - 1; i > 0; i--) { const k = (rng() * (i + 1)) | 0, tq = cand[i]; cand[i] = cand[k]; cand[k] = tq; }
  const ib = CC.bush.map((t) => new IBatch(t, CC.mat, cap, 'mid'));
  let n = 0;
  for (const c of cand) {
    if (n >= cap) break;
    if (Y.over()) { yield; Y.reset(); }
    const x = c.x + (rng() - 0.5) * 0.5, s = c.s + (rng() - 0.5) * 0.5, y = fs.at(x, s);
    if (fs.ny < 0.5) continue;
    // white and salmon mixed within a patch, the segment's own proportion overall
    const orange = (noise2(x / 4, s / 4, 638) * 0.5 + 0.5 + (rng() - 0.5) * 0.5) < c.rc.orange, list = orange ? 2 : 0;
    const q = ib[list + (rng() < 0.5 ? 0 : 1)], tpl = q.tpl;
    let sc = (0.75 + 0.65 * rng()) * (0.75 + 0.25 * c.w);
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.5), rng() * TAU), P = [x, y, s], H = tpl.maxY - tpl.minY;
    seat(fs, tpl, R, sc, sc, sc, P, null, 0.05);
    if (c.ad < 7) { // low props may pass under the flight path: shrink to fit, or leave it out
      const room = pc.y(s) - 1.35 - P[1], k = room / (H * sc);
      if (k < 0.5) continue;
      if (k < 1) { sc *= k; P[0] = x; P[1] = y; P[2] = s; seat(fs, tpl, R, sc, sc, sc, P, null, 0.05); }
    }
    if (iput(ctx, q, P[0], P[1], P[2], R, sc, sc, sc, tint(rng, 0.1))) n++;
  }
  const extra = [];
  if (b.I.length) extra.push(builderMesh(b, CC.mat));
  return { batches: ib, extra };
}

export function* layoutCcA(ctx) {
  const Y = slice(3);
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const hi = hiT(ctx.tier), fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rc0 = recipeOf(g0), rng = chunkRng(ctx, 0x6cc1);
  const co = new Batch(CC.mat, (hi ? 200000 : 105000) * bk); co.lod = 'mid';
  const rb = CC.rubble.map((t) => new IBatch(t, CC.mat, Math.round(80 * bk * lk), 'near'));
  const lo = [new IBatch(pick(rng, CC.lobster), MAT.static, 60, 'near')]; // (one instanced batch per kind and chunk: fewer draw calls)
  const sp = new Space(), labels = [], pois = [], colonies = [];
  const maxCol = Math.round((hi ? 40 : 24) * bk * rc0.live), maxDead = Math.round((hi ? 22 : 11) * bk * rc0.dead);
  let nCol = 0, nDead = 0;
  const live = (g) => poolOf(g, 'nb6ccLive', null, 4) || [...CC.white, ...CC.orange];
  const dead = (g) => poolOf(g, 'nb6ccDead', CC.dead, 2);
  const thicket = function* (g, x, s, n, rad) { // a dense clump of colonies, touching
    for (let q = 0, k = 0; q < n * 3 && k < n && nCol < maxCol; q++) {
      if (Y.over()) { yield; Y.reset(); }
      const a = rng() * TAU, d = rad * Math.sqrt(rng()), px = x + Math.cos(a) * d, ps = s + Math.sin(a) * d, tpl = pick(rng, live(g)), sc = 0.9 + rng() * 0.55;
      if (Math.abs(px - pc.x(ps)) > 11 || !sp.free(px, ps, tpl.nbR * sc * 0.55)) continue; // hero layer: by the path
      const S = ccSample(g, px, ps, smp);
      if (S.scar > 0.2) continue;
      const it = placeColony(ctx, fs, pc, co, tpl, px, ps, sc, sc * (0.9 + rng() * 0.25), 0.05, rng, tint(rng));
      if (!it) continue;
      sp.add(px, ps, tpl.nbR * sc * 0.55); colonies.push(it); nCol++; k++;
    }
  };
  const rubbleAt = function* (x, s, n, rad) {
    for (let q = 0; q < n; q++) {
      if (Y.over()) { yield; Y.reset(); }
      const a = rng() * TAU, d = rad * Math.sqrt(rng()), px = x + Math.cos(a) * d, ps = s + Math.sin(a) * d, ib = pick(rng, rb), sc = 0.8 + rng() * 0.7;
      const y = fs.at(px, ps);
      if (fs.ny < 0.5) continue;
      const R = upTo([fs.nx, fs.ny, fs.nz], rng() * TAU), P = [px, y, ps];
      seat(fs, ib.tpl, R, sc, sc, sc, P, null, 0.006);
      if (!clearBox(pc, P[0], P[2], P[1], P[1] + 0.05, 0.25 * sc, SOFT)) continue;
      iput(ctx, ib, P[0], P[1], P[2], R, sc, sc, sc, tint(rng, 0.15));
    }
  };
  // the segment's summit: the tallest mound beside the path, crowned by its richest thicket
  const C = coldCoral(g0);
  let summit = null;
  for (const m of C.mounds) {
    if (m.H < 3 || Math.abs(m.x - pc.x(m.s)) > 30 || m.s < g0.start + 40 || m.s > g0.end - 40) continue;
    if (C.scar && Math.hypot(m.x - C.scar.x, m.s - C.scar.s) < C.scar.L * 0.6) continue;
    if (!summit || m.H > summit.H) summit = m;
  }
  if (summit && summit.s >= ctx.s0 && summit.s < ctx.s0 + CHUNK) {
    // its top: the highest floor point near the centre
    let bx = summit.x, bs = summit.s, by = -1e9;
    // the crown where the camera meets it: the highest floor beside the path (4-12 m off it) that stays below the
    // camera line, so the director looks down onto the thicket rather than up at a dark flank
    for (let k = 0; k < 40; k++) {
      const s = summit.s + (rng() - 0.5) * summit.Lv, x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (4 + 8 * rng()), y = fs.at(x, s);
      if (y > by && y < pc.y(s) - 2.5 && Math.abs(x - summit.x) < summit.Lv * 1.2) { by = y; bx = x; bs = s; }
    }
    if (by < -1e8) by = fs.at(bx, bs);
    yield* thicket(g0, bx, bs, hi ? 12 : 8, 3.2);
    pois.push({ type: 'coral-summit', x: bx, y: by + 1.2, s: bs, r: 4, data: { name: 'Reef summit' } });
    labels.push(['Reef summit', bx, by + 1.5, bs, CC_FACTS.summit]);
  }
  yield;
  // sampling over the chunk: living thickets high on the mounds and on their faces into the current,
  // framework clumps lower down and downcurrent, rubble on the skirts and tails
  const N = Math.round((hi ? 320 : 250) * bk);
  for (let i = 0; i < N; i++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g || ctx.weightOf(s, KEY) < rng()) continue;
    const rc = recipeOf(g), x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (1 + Math.pow(rng(), 1.7) * 48); // most of it where the lamps reach
    const S = ccSample(g, x, s, smp);
    if (S.hm < 0.25 && rng() < 0.85) continue;
    const up = smoothstep(0.25, -0.5, S.u), crushed = S.scar;
    const pLive = (1 - crushed) * smoothstep(0.12, 0.55, S.p) * (0.55 + 0.45 * up) * Math.min(1, rc.live);
    const pDead = (1 - pLive) * (smoothstep(0.03, 0.25, S.p) * (0.5 + 0.4 * (1 - up)) + crushed * 0.5) * Math.min(1, rc.dead);
    const u = rng();
    if (u < pLive && nCol < maxCol) yield* thicket(g, x, s, 2 + ((rng() * 5) | 0), 1.1 + 0.8 * rng());
    else if (u < pLive + pDead && nDead < maxDead) {
      const tpl = pick(rng, dead(g)), sc = 0.9 + rng() * 0.7, flat = crushed > 0.3 ? 0.35 + 0.25 * rng() : 0.8 + 0.3 * rng();
      if (!sp.free(x, s, tpl.nbR * sc * 0.6)) continue;
      // framework sits deep in its own rubble; crushed by gear it lies flattened
      if (placeColony(ctx, fs, pc, co, tpl, x, s, sc, sc * flat, 0.12 + 0.1 * rng(), rng, tint(rng, 0.15))) { sp.add(x, s, tpl.nbR * sc * 0.6); nDead++; yield* rubbleAt(x, s, 3 + ((rng() * 4) | 0), 1.8); }
    } else if ((S.d > 0.75 && S.d < 1.6) || S.tail > 0.2 || crushed > 0.2) yield* rubbleAt(x, s, Math.round((2 + rng() * 5) * rc.rubble * lk), 1.5);
  }
  yield;
  // squat lobsters perched on the colonies
  const rcL = rc0.lobster * lk;
  for (const it of colonies) {
    if (rng() > 0.35 * rcL) continue;
    if (Y.over()) { yield; Y.reset(); }
    const spots = itemSpots(it, ctx, 16, 0.55);
    for (let q = 0, n = 0; q < 6 && n < 1 + (rng() < 0.3); q++) {
      const p = spots[(rng() * spots.length) | 0];
      if (!p) break;
      if (p.n[1] < 0.5) continue;
      // straddling a branch: the body sits on the spot, its legs within a few cm of the coral all round
      // (a branch is too thin for every foot to land on its top surface, which seatOnItem needs)
      const ib = pick(rng, lo), sc = 0.9 + rng() * 0.3, R = upTo(p.n, rng() * TAU), Pp = [p.x - p.n[0] * 0.006, p.y - p.n[1] * 0.006, p.s + p.n[2] * 0.006];
      if (!grips(it, ctx.s0, ib.tpl, R, sc, sc, sc, Pp, 0.045)) continue;
      if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + 0.05, 0.1, SOFT)) continue;
      if (iput(ctx, ib, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tint(rng, 0.1), 'item')) n++;
    }
  }
  // the mounds themselves (labels at their crowns)
  let nm = 0;
  for (const m of C.mounds) {
    if (nm >= 2 || m.s < ctx.s0 || m.s >= ctx.s0 + CHUNK || m.H < 3 || m === summit) continue;
    const y = fs.at(m.x, m.s);
    labels.push(['Lophelia reef mound', m.x, y + 1.5, m.s, rc0.darwin ? CC_FACTS.darwin : CC_FACTS[rc0.moundFact]]); nm++;
  }
  return { batches: [co, ...rb, ...lo], labels, pois };
}

// ---------------------------------------------------------------- chain B: life on the rubble, tails, the trawl scar
export function* layoutCcB(ctx) {
  const Y = slice(3);
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rc0 = recipeOf(g0), rng = chunkRng(ctx, 0x6cc2);
  const br = [new IBatch(pick(rng, CC.brittle), MAT.static, Math.round(120 * bk * lk), 'near')];
  const ur = [new IBatch(pick(rng, CC.urchin), MAT.static, Math.round(60 * bk * lk), 'near')];
  const rb = [new IBatch(pick(rng, CC.rubble), CC.mat, Math.round(160 * bk * lk), 'near')];
  const an = new Batch(MAT.sway, 14000 * bk * lk); an.lod = 'near'; an.soft = true;
  const st = new Batch(MAT.static, 9000 * bk * lk); st.lod = 'near';
  const co = new Batch(CC.mat, 26000 * bk); co.lod = 'mid';
  const dec = new Builder(), labels = [], pois = [], sp = new Space();
  const floorI = (ib, x, s, sc, embed, tl = 0.12) => {
    const y = fs.at(x, s);
    if (fs.ny < 0.6) return false;
    const R = upTo([fs.nx, fs.ny, fs.nz], rng() * TAU), P = [x, y, s];
    seat(fs, ib.tpl, R, sc, sc, sc, P, null, embed);
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (ib.tpl.maxY - ib.tpl.minY) * sc, 0.15, SOFT)) return false;
    return iput(ctx, ib, P[0], P[1], P[2], R, sc, sc, sc, tint(rng, tl));
  };
  // life on the rubble skirts and tails
  const N = Math.round(90 * bk);
  let nl = 0;
  for (let i = 0; i < N; i++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g || ctx.weightOf(s, KEY) < rng()) continue;
    const rc = recipeOf(g), x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * Math.pow(rng(), 1.3) * 30;
    const S = ccSample(g, x, s, smp);
    const onRubble = (S.d > 0.7 && S.d < 1.6) || S.tail > 0.2 || (S.p > 0.05 && S.p < 0.4);
    if (!onRubble) continue;
    const u = rng() * (rc.brittle + rc.urchin + rc.anemone + (rc.darwin ? 1.2 : 0));
    if ((u < rc.brittle)) { for (let q = 0; q < 1 + rng() * 3; q++) if (floorI(pick(rng, br), x + (rng() - 0.5) * 1.5, s + (rng() - 0.5) * 1.5, 0.8 + rng() * 0.5, 0.003) && nl < 1) { labels.push(['Brittle star', x, fs.at(x, s) + 0.2, s, null]); nl++; } }
    else if (u < rc.brittle + rc.urchin) floorI(pick(rng, ur), x, s, 0.9 + rng() * 0.4, 0.004);
    else if (u < rc.brittle + rc.urchin + rc.anemone) {
      for (let q = 0; q < 1 + rng() * 3; q++) {
        const px = x + (rng() - 0.5) * 1.2, ps = s + (rng() - 0.5) * 1.2, tpl = pick(rng, CC.anemone), sc = 0.8 + rng() * 0.6, y = fs.at(px, ps);
        if (fs.ny < 0.6 || !sp.free(px, ps, 0.08 * sc)) continue;
        const R = upTo([fs.nx, fs.ny, fs.nz], rng() * TAU), P = [px, y, ps];
        seat(fs, tpl, R, sc, sc, sc, P, null, 0.01);
        if (clearBox(pc, P[0], P[2], P[1], P[1] + 0.15, 0.1, SOFT) && put(ctx, an, tpl, P[0], P[1], P[2], R, sc, sc, sc, tint(rng, 0.1), sc)) sp.add(px, ps, 0.08 * sc);
      }
    } else if (rc.darwin && S.tail > 0.15) { // Darwin Mounds: xenophyophores in the tails
      for (let q = 0; q < 3 + rng() * 6; q++) {
        const px = x + (rng() - 0.5) * 3, ps = s + (rng() - 0.5) * 3, tpl = pick(rng, CC.xeno), sc = 0.8 + rng() * 0.8, y = fs.at(px, ps);
        if (fs.ny < 0.75 || !sp.free(px, ps, tpl.nbR * sc)) continue;
        const R = upTo([fs.nx, fs.ny, fs.nz], rng() * TAU), P = [px, y, ps];
        seat(fs, tpl, R, sc, sc, sc, P, null, 0.008);
        if (clearBox(pc, P[0], P[2], P[1], P[1] + 0.2, tpl.nbR * sc, SOFT) && put(ctx, st, tpl, P[0], P[1], P[2], R, sc, sc, sc, tint(rng, 0.1))) sp.add(px, ps, tpl.nbR * sc);
      }
    }
  }
  yield;
  // the trawl scar: furrows ploughed through crushed framework, broken coral strewn about
  const C = coldCoral(g0), sc0 = C.scar;
  if (sc0 && sc0.s + sc0.L / 2 > ctx.s0 && sc0.s - sc0.L / 2 < ctx.s0 + CHUNK) {
    const ux = sc0.ca, us = sc0.sa, vx = -sc0.sa, vs = sc0.ca;
    for (const c of sc0.fur) { // a dark ribbon along each furrow floor, broken into lengths of the chunk
      const pts = [];
      for (let t = -sc0.L / 2 + 4; t <= sc0.L / 2 - 4; t += 2) {
        const x = sc0.x + ux * t + vx * c, s = sc0.s + us * t + vs * c;
        if (s < ctx.s0 - 1 || s > ctx.s0 + CHUNK + 1) { if (pts.length > 4) { decalRibbon(dec, fs, ctx, pts, 1.3, [0.13, 0.12, 0.1], 1, 0.9); } pts.length = 0; continue; }
        pts.push(x + (rng() - 0.5) * 0.2, s);
      }
      if (pts.length > 4) decalRibbon(dec, fs, ctx, pts, 1.3, [0.13, 0.12, 0.1], 1, 0.9);
    }
    const n = Math.round(160 * bk);
    for (let i = 0; i < n; i++) { // crushed rubble, thickest on the furrow banks
      if (Y.over()) { yield; Y.reset(); }
      const t = (rng() - 0.5) * sc0.L, c = (rng() - 0.5) * sc0.W, x = sc0.x + ux * t + vx * c, s = sc0.s + us * t + vs * c;
      if (s < ctx.s0 || s >= ctx.s0 + CHUNK) continue;
      let f = 0;
      for (const cc of sc0.fur) f = Math.max(f, Math.exp(-(((c - cc - 2.4) / 1.1) ** 2)), Math.exp(-(((c - cc + 2.4) / 1.1) ** 2)));
      if (rng() > 0.35 + 0.65 * f) continue;
      floorI(pick(rng, rb), x, s, 0.9 + rng() * 0.9, 0.01, 0.15);
    }
    // a few broken framework clumps, flattened
    for (let i = 0; i < 12 * bk; i++) {
      const t = (rng() - 0.5) * sc0.L * 0.8, c = (rng() - 0.5) * sc0.W * 0.8, x = sc0.x + ux * t + vx * c, s = sc0.s + us * t + vs * c;
      if (s < ctx.s0 || s >= ctx.s0 + CHUNK) continue;
      const tpl = pick(rng, poolOf(g0, 'nb6ccDead', CC.dead, 2)), sc = 0.8 + rng() * 0.5;
      placeColony(ctx, fs, pc, co, tpl, x, s, sc, sc * (0.3 + 0.2 * rng()), 0.08, rng, tint(rng, 0.12));
    }
    if (sc0.s >= ctx.s0 && sc0.s < ctx.s0 + CHUNK) {
      const y = fs.at(sc0.x, sc0.s);
      pois.push({ type: 'trawl-scar', x: sc0.x, y: y + 1, s: sc0.s, r: sc0.W / 2, data: { name: 'Trawl scar' } });
      labels.push(['Trawl scar', sc0.x, y + 1.2, sc0.s, rc0.darwin ? CC_FACTS.scarDarwin : CC_FACTS.scarRost]);
    }
  }
  const extra = [];
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  return { batches: [...br, ...ur, ...rb, an, st, co], extra, labels, pois };
}
