// --- events 2026-11 ---
// The Octopus Garden (deep plain): a field of low, dark pillow-rock lobes whose cracks seep faintly shimmering warm
// water, ringed by pale microbial film, where octopuses (Muusoctopus robustus) brood their eggs. The props here are
// the rock field, its crack and mat decals and the shimmer; the octopuses are creatures (events.js), placed on the
// nest spots this layout lists in its 'octopus-garden' POI. About one deep plain segment in two has a garden, late in
// the segment (the whale fall sits in its middle); ?event=octopus puts one 70 m ahead of the camera's start and every
// 300 m after it.
import { Builder, Batch, TAU, rotY, presence } from './core.js';
import { MAT } from './materials.js';
import { rockInto } from './shapes.js';
import { mulberry32 } from '../noise.js';
import { sv, brineBasins } from '../biomes.js';
import { NBMAT, pathCache, clearBox, SOLID, seat, put, lab, nbFloor, decalDisc, builderMesh, slice } from './nb_common.js';
import { whalePlan } from './deepplain.js';
import { shimmerMesh } from './vents.js';

const FORCED = typeof location !== 'undefined' && new URLSearchParams(location.search).get('event') === 'octopus';
const G = {};
const FACT = 'Warm springs cut brooding to about 1.8 years, versus an estimated 5-8 years in ambient water.';
const SPRING_FACT = 'Ambient water is about 1.6 °C; crevices in the springs reach about 10.8 °C.';
const STEP = 2.5; // lobe grid spacing (m): the lobes are ~1.5-1.9 m across, so the cracks between them are 0.6-1 m

function pillow(seed) { // a low, rounded pillow-lava lobe, dark and glassy, a little dusted
  const b = new Builder(), r = mulberry32(seed);
  rockInto(b, seed, { detail: 1, sx: 0.8 + r() * 0.1, sy: 0.3 + r() * 0.1, sz: 0.66 + r() * 0.12, rough: 0.16, flat: 0.45, growth: 0, col: [0.05, 0.047, 0.05] });
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => { o[4] = 6.15; });
  const t = b.build(); t.label = null;
  return t;
}
export function initOctoGarden() { G.lobes = [0, 1, 2, 3, 4, 5].map((k) => pillow(2300 + k * 17)); lab(G.lobes, null, null); }

// Gardens of a segment (cached, deterministic): centre, side, the lobes [x, s, yaw, tpl, scale], seeps and nests
// (global x, s pairs).
const PLANS = new Map();
function gardensOf(g, ctx) {
  let L = PLANS.get(g.seed);
  if (L) return L;
  L = [];
  const len = g.end - g.start, at = [];
  if (FORCED) { for (let s = (g.camStart ?? g.start + 40) + 70; s < g.end - 30; s += 300) if (s > g.start + 30) at.push(s); }
  else if (sv(g, 50) < 0.5 && len > 160) at.push(g.start + (0.78 + 0.08 * sv(g, 51)) * len);
  const W = whalePlan(g, { x: (s) => ctx.pathX(s) });
  for (let k = 0; k < at.length; k++) {
    const rng = mulberry32((g.seed ^ 0x0c70 ^ (k * 2654435761)) >>> 0);
    let s = at[k];
    if (Math.abs(s - W.s) < 45 && !FORCED) s = W.s + 45 * Math.sign(s - W.s || 1);
    const side = rng() < 0.5 ? -1 : 1, x = ctx.pathX(s) + side * (3 + rng() * 1.5); // the path runs across the field's near half
    if (brineBasins(g, x - 40, x + 40, s - 40, s + 40).some((B) => Math.hypot(B.x - x, B.s - s) < B.r * 1.4 + 11)) continue;
    const lobes = [], cell = new Map(), seeps = [], nests = [];
    const nu = 6, nv = 4; // half extents in cells: ~30 m along the path, ~20 m across
    for (let i = -nu; i <= nu; i++) for (let j = -nv; j <= nv; j++) {
      const e = (i / (nu + 0.5)) ** 2 + (j / (nv + 0.5)) ** 2;
      if (e > 1 || (e > 0.6 && rng() < 0.4)) continue; // ragged outline
      const ls = s + i * STEP + (rng() - 0.5) * 0.35, lx = x + j * STEP + (rng() - 0.5) * 0.35;
      cell.set(i * 100 + j, lobes.length);
      lobes.push([lx, ls, rng() * TAU, (rng() * G.lobes.length) | 0, 0.92 + rng() * 0.1]);
    }
    // nests and seeps in the cracks between neighbouring lobes
    for (let i = -nu; i <= nu; i++) for (let j = -nv; j <= nv; j++) {
      const a = cell.get(i * 100 + j);
      if (a === undefined) continue;
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const b = cell.get((i + di) * 100 + j + dj);
        if (b === undefined) continue;
        const A = lobes[a], B = lobes[b], mx = (A[0] + B[0]) / 2, ms = (A[1] + B[1]) / 2;
        const tx = di ? 1 : 0, ts = di ? 0 : 1; // along the crack
        if (rng() < 0.3) seeps.push(mx, ms);
        for (const off of [-0.6, 0.6]) if (rng() < 0.55) nests.push(mx + tx * off + (rng() - 0.5) * 0.1, ms + ts * off + (rng() - 0.5) * 0.1);
      }
    }
    // nests in a mixed order (the creature side takes the first n for its tier): nearest the path first, shuffled a little
    const P = []; for (let q = 0; q < nests.length; q += 2) P.push([nests[q], nests[q + 1], Math.abs(nests[q] - ctx.pathX(nests[q + 1])) + rng() * 4]);
    P.sort((p, q) => p[2] - q[2]);
    L.push({ x, s, side, lobes, seeps, nests: P.flatMap((p) => [p[0], p[1]]) });
  }
  PLANS.set(g.seed, L);
  if (PLANS.size > 32) PLANS.delete(PLANS.keys().next().value);
  return L;
}

// Is (x, s) on a garden's field? The deep plain's sea pens, lilies and sponges keep off it (the brooders are the subject).
export function inGarden(ctx, x, s) {
  for (const g of ctx.segments) {
    if (g.key !== 'deepplain' || s < g.start - 20 || s > g.end + 20) continue;
    for (const Gd of gardensOf(g, ctx)) if (((s - Gd.s) / 18) ** 2 + ((x - Gd.x) / 13) ** 2 < 1) return true;
  }
  return false;
}

export function* layoutOctoGarden(ctx) { // (a generator: resumed in <= 3 ms slices)
  const Y = slice();
  if (presence(ctx, 'deepplain') <= 0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), inChunk = (s) => s >= ctx.s0 && s < ctx.s1;
  const st = new Batch(MAT.static, 30000);
  const dec = new Builder(), labels = [], pois = [], em = [];
  const rng = mulberry32(((ctx.s0 * 2654435761) ^ 0x0c71) >>> 0);
  for (const g of ctx.segments) {
    if (g.key !== 'deepplain') continue;
    for (const Gd of gardensOf(g, ctx)) {
      if (Gd.s < ctx.s0 - 40 || Gd.s > ctx.s1 + 40) continue;
      for (const [lx, ls, yaw, ti, sc] of Gd.lobes) {
        if (!inChunk(ls)) continue;
        if (Y.over()) { yield; Y.reset(); }
        const tpl = G.lobes[ti], R = rotY(yaw), y = fs.at(lx, ls), Pp = [lx, y, ls];
        if (!clearBox(pc, lx, ls, y, y + (tpl.maxY - tpl.minY) * sc, tpl.r * sc, SOLID)) continue;
        seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.08);
        put(ctx, st, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, [1, 1, 1]);
      }
      // dark cracks between the lobes, pale microbial film and a shimmer of warm water over each seep
      for (let q = 0; q < Gd.seeps.length; q += 2) {
        const x = Gd.seeps[q], s = Gd.seeps[q + 1];
        if (!inChunk(s)) continue;
        decalDisc(dec, fs, ctx, x, s, 0.45 + rng() * 0.35, 0.3 + rng() * 0.25, rng() * TAU, [0.72, 0.7, 0.6], 2, 0.75, 3, 14);
        em.push({ x, y: fs.at(x, s) + 0.05, z: -(s - ctx.s0), n: 4, phase: rng(), speed: 0.22 + rng() * 0.08, rise: 1.4 + rng() * 1.2, size: 0.3,
          spread: 0.12, alb: 0.75, glow: 0, alpha: 0.045 });
      }
      for (const [lx, ls] of Gd.lobes) if (inChunk(ls)) decalDisc(dec, fs, ctx, lx, ls, 1.45, 1.3, 0, [0.025, 0.025, 0.03], 3, 0.55, 3, 16);
      // the cracks themselves: dark rock showing through at every nest, so the pale brooders stand out in the lamps
      for (let q = 0; q < Math.min(Gd.nests.length, 112); q += 2) { // (the first 56 nests: the most any tier fills)
        const x = Gd.nests[q], s = Gd.nests[q + 1];
        if (inChunk(s)) decalDisc(dec, fs, ctx, x, s, 0.55, 0.45, rng() * TAU, [0.015, 0.014, 0.018], 3, 0.92, 2, 10);
      }
      if (inChunk(Gd.s)) {
        const y = fs.at(Gd.x, Gd.s);
        labels.push(['Octopus Garden', Gd.x, y + 1.4, Gd.s, FACT]);
        if (Gd.seeps.length) labels.push(['Warm spring', Gd.seeps[0], fs.at(Gd.seeps[0], Gd.seeps[1]) + 0.6, Gd.seeps[1], SPRING_FACT]);
        // (y below the floor: the camera, slowing for it, looks down across the field)
        pois.push({ type: 'octopus-garden', x: Gd.x, y: y - 2, s: Gd.s, r: 8, data: { name: 'Octopus Garden', fact: FACT, nests: Gd.nests } });
      }
    }
  }
  if (!st.items.length && !pois.length && !em.length) return null;
  const extra = [builderMesh(dec, NBMAT.decal, null, 'mid'), em.length ? shimmerMesh(em, rng) : null].filter(Boolean);
  return { batches: [st], extra, labels, pois };
}
