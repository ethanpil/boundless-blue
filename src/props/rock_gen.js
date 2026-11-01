// Lazy per-segment template palettes: every biome segment gets its own freshly generated rock shapes (and
// vent chimneys), so the same rock rarely appears twice along the journey.
//
// Jobs are generator functions (rock_recipes.js, vents.js) pumped in <= SLICE ms slices by populator stages
// registered at the FRONT of the terrain's populator list. Chunk builds run one at a time and every populator
// of a chunk runs after these stages, so the shared pools (T.rocks, T.mound, ...) are swapped in place to the
// chunk's segment palette before any layout reads them. Consumers must keep a live reference to the pool array
// (spec.tpl = T.rocks), never a copy. Palettes for the segments ahead are prefetched, the ones left behind are
// dropped (their templates are freed once the chunks that used them are disposed).
import { T } from './core.js';
import { rockJob, drain, tiered } from './rock_recipes.js';

export const SLICE = 2;            // ms of generation per stage
const STAGES = 40;                 // stages per chunk build: up to STAGES * SLICE ms when a palette is missing
const LOOK = 420;                  // prefetch the palettes of segments starting within this distance ahead
const KEEP_BEHIND = 300, MAX_PAL = 6;

// Shared pools swapped per chunk, and the recipes each biome's geology draws from. A recipe entry is
// [weight, spec] with spec = { r: recipe, ...options } (see rock_recipes.RECIPES).
export const SHARED = ['rocks', 'mound', 'pinnacle', 'bigRocks', 'tpRock', 'ventRock'];
const R = (r, o = {}) => ({ r, ...o });
export const GEO = {
  kelp: {
    rocks: [[3, R('boulder', { litho: 'granite' })], [2, R('boulder', { litho: 'diorite', kind: 'angular' })], [2, R('columnar')], [1.5, R('conglomerate')],
      [1.5, R('cracked', { litho: 'slate' })], [1, R('boulder', { litho: 'greenstone', kind: 'block' })], [1, R('boulder', { litho: 'pinkGranite', kind: 'tafoni' })]],
    mound: [[3, R('pile', { lithos: ['granite', 'diorite', 'basalt'], big: true, detail: 4 })], [2, R('boulder', { litho: 'granite', detail: 4, growth: 1 })], [1.5, R('columnar', { big: true, growth: 1 })], [1, R('conglomerate', { detail: 4, big: true, growth: 1 })]],
    pinnacle: [[2, R('eroded', { litho: 'granite', detail: 4, big: true, growth: 0.9 })], [1, R('eroded', { litho: 'gneiss', detail: 4, big: true, growth: 0.9 })]],
    bigRocks: [[2, R('eroded', { litho: 'granite', detail: 4, big: true, growth: 0.9 })], [2, R('pile', { lithos: ['granite', 'diorite'], big: true })], [1.5, R('columnar', { big: true, growth: 0.9 })]],
  },
  polar: {
    rocks: [[4, R('boulder', { litho: 'granite', kind: 'erratic' })], [2, R('boulder', { litho: 'gneiss', kind: 'erratic' })], [2, R('boulder', { litho: 'diorite', kind: 'angular' })],
      [1.5, R('cracked', { litho: 'slate' })], [1, R('pile', { lithos: ['granite', 'gneiss', 'diorite'] })], [1, R('boulder', { litho: 'pinkGranite', kind: 'erratic' })]],
  },
  ruins: {
    rocks: [[3, R('boulder', { litho: 'limestone' })], [2, R('cracked', { litho: 'limestone' })], [1.5, R('boulder', { litho: 'sandstone', kind: 'block' })], [1, R('conglomerate')], [1, R('boulder', { litho: 'limestone', kind: 'tafoni' })]],
  },
  sandflat: {
    rocks: [[3, R('cracked', { litho: 'sandstone' })], [2, R('boulder', { litho: 'sandstone', kind: 'block' })], [2, R('conglomerate')], [1.5, R('boulder', { litho: 'redSand' })], [1, R('boulder', { litho: 'limestone', kind: 'tafoni' })]],
    pinnacle: [[2, R('eroded', { litho: 'sandstone', detail: 4, big: true, growth: 0.9 })], [1.5, R('eroded', { litho: 'redSand', detail: 4, big: true, growth: 0.9 })]],
  },
  seagrass: {
    rocks: [[3, R('boulder', { litho: 'limestone' })], [2, R('conglomerate')], [1.5, R('cracked', { litho: 'limestone' })], [1.5, R('boulder', { litho: 'sandstone', kind: 'tafoni' })], [1, R('boulder', { litho: 'redSand', kind: 'block' })]],
    mound: [[2, R('boulder', { litho: 'limestone', detail: 4, growth: 1 })], [1.5, R('pile', { lithos: ['limestone', 'sandstone'], big: true })], [1, R('conglomerate', { detail: 4, big: true, growth: 1 })]],
    pinnacle: [[2, R('eroded', { litho: 'limestone', detail: 4, big: true, growth: 0.9 })], [1, R('eroded', { litho: 'sandstone', detail: 4, big: true, growth: 0.9 })]],
    bigRocks: [[2, R('eroded', { litho: 'limestone', detail: 4, big: true, growth: 0.9 })], [1.5, R('pile', { lithos: ['limestone', 'sandstone'], big: true })]],
  },
  wreck: {
    rocks: [[3, R('boulder', { litho: 'granite' })], [2, R('boulder', { litho: 'basalt', kind: 'angular' })], [1.5, R('cracked', { litho: 'slate' })], [1, R('conglomerate')], [1, R('pillow')], [1, R('boulder', { litho: 'greenstone' })]],
  },
  cave: {
    rocks: [[3, R('boulder', { litho: 'limestone' })], [2, R('boulder', { litho: 'limestone', kind: 'tafoni' })], [1.5, R('cracked', { litho: 'limestone' })], [1, R('boulder', { litho: 'limestone', kind: 'angular' })]],
  },
  tidepool: {
    tpRock: [[3, R('boulder', { litho: 'basalt', growth: 1 })], [2, R('cracked', { litho: 'slate', growth: 1 })], [2, R('conglomerate', { growth: 1 })], [1.5, R('boulder', { litho: 'greenstone', kind: 'angular', growth: 1 })],
      [1.5, R('pillow', { growth: 1 })], [1, R('boulder', { litho: 'sandstone', kind: 'tafoni', growth: 1 })]],
  },
  vents: {
    ventRock: [[1.5, R('pillow', { vent: true, growth: 0 })], [2, R('columnar', { growth: 0 })], [2, R('boulder', { litho: 'sulfide', kind: 'angular', growth: 0 })], [1.5, R('boulder', { litho: 'basalt', kind: 'angular', growth: 0 })],
      [0.6, R('pillow', { vent: true, big: true, growth: 0 })]],
  },
};
const COUNT = { rocks: 18, mound: 8, pinnacle: 6, bigRocks: 7, tpRock: 12, ventRock: 10 };

// ---------- providers (biome -> pools with job makers) ----------
// make(seg, k, tier) -> iterator returning a Template (or null to skip the slot); lower prio runs first
const providers = new Map();
export function provide(biome, pool, n, make, prio = 1) {
  let a = providers.get(biome);
  if (!a) providers.set(biome, (a = []));
  a.push({ pool, n, make, prio });
  a.sort((p, q) => p.prio - q.prio);
}
const pickW = (list, u) => { let tot = 0; for (const e of list) tot += e[0]; let r = u * tot; for (const e of list) { r -= e[0]; if (r <= 0) return e[1]; } return list[list.length - 1][1]; };
for (const [biome, pools] of Object.entries(GEO)) {
  for (const [pool, list] of Object.entries(pools)) {
    provide(biome, pool, COUNT[pool], (seg, k, tier) => {
      // stratified recipe choice: every recipe in the list appears, weighted, never all the same
      const u = ((k + 0.5) / COUNT[pool] + ((seg.seed >>> 3) % 997) / 997) % 1;
      return rockJob(tiered(pickW(list, u), tier), (seg.seed ^ (k * 0x9e3779b1) ^ pool.length * 7919) >>> 0);
    });
  }
}

// ---------- palettes + job queue ----------
const palettes = new Map(); // key -> { seg, key, pools: {name: Template[]}, left }
const queue = [];           // { pal, pool, k, make, it }
const keyOf = (seg) => seg.key + ':' + seg.id + ':' + seg.seed;
const base = {};
const stats = { made: 0, ms: 0, maxSlice: 0, maxStep: 0, slowStep: '', palettes: 0, dropped: 0 };
if (typeof window !== 'undefined') window.__rockGen = { stats, palettes, queue };

export function paletteOf(seg) { return palettes.get(keyOf(seg)) || null; }

function ensure(seg, tier) {
  const key = keyOf(seg);
  let pal = palettes.get(key);
  if (pal) return pal;
  const list = providers.get(seg.key);
  if (!list) return null;
  pal = { seg, key, pools: {}, left: 0 };
  for (const p of list) {
    pal.pools[p.pool] = pal.pools[p.pool] || [];
    for (let k = 0; k < p.n; k++) { queue.push({ pal, pool: p.pool, k, make: p.make, tier, it: null }); pal.left++; }
  }
  palettes.set(key, pal);
  stats.palettes++;
  return pal;
}
function evict(s0) {
  if (palettes.size <= 2) return;
  for (const [key, pal] of palettes) {
    const g = pal.seg;
    if (g.end < s0 - KEEP_BEHIND || g.start > s0 + 4 * LOOK || palettes.size > MAX_PAL) {
      palettes.delete(key); stats.dropped++;
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].pal === pal) queue.splice(i, 1);
    }
  }
}
// Boot: terrain.prime builds the first chunks synchronously behind the loading screen, before the first
// animation frame. Then the chunk's own palettes are finished outright (capped) instead of falling back to
// the few startup templates, so a journey never opens on the same handful of shapes. (Node: always.)
let booted = false;
if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => { booted = true; });
const BOOT_CAP = typeof requestAnimationFrame === 'undefined' ? Infinity : 1500; // ms of boot-time generation at most, over all chunks
let bootMs = 0;

// run queued jobs for ~ms; jobs of the chunk's own segments first (onlyCur: nothing else)
function pump(ms, cur, onlyCur = false) {
  const t0 = performance.now();
  let qi = -1;
  while (queue.length) {
    if (qi < 0 || qi >= queue.length) {
      qi = -1;
      for (let i = 0; i < queue.length; i++) if (cur.has(queue[i].pal)) { qi = i; break; }
      if (qi < 0) { if (onlyCur) break; qi = 0; }
    }
    const j = queue[qi], ts = performance.now();
    if (j.warm) { // a step of its own: the support raycast grid and contact hull layouts would build lazily
      if (j.warm.support) j.warm._buildRay();
      if (j.warm.supportProxy) j.warm.supportProxy._buildRay();
      void j.warm.footFew;
      j.pal.pools[j.pool].push(j.warm); stats.made++;
      queue.splice(qi, 1); qi = -1; j.pal.left--;
    } else {
      if (!j.it) j.it = j.make(j.pal.seg, j.k, j.tier);
      if (!j.it) { queue.splice(qi, 1); qi = -1; j.pal.left--; continue; } // provider skips this slot (tier)
      const r = j.it.next();
      if (r.done) {
        if (r.value) j.warm = r.value;
        else { queue.splice(qi, 1); qi = -1; j.pal.left--; }
      }
    }
    const te = performance.now();
    if (te - ts > stats.maxStep) { stats.maxStep = te - ts; stats.slowStep = j.pal.seg.key + '/' + j.pool + (j.warm ? '/warm' : ''); }
    if (te - t0 > ms * 0.8) break;
  }
  const dt = performance.now() - t0;
  stats.ms += dt; stats.maxSlice = Math.max(stats.maxSlice, dt);
}

// In-place pool swap for the chunk: per pool, the palette of the segment (in this chunk) that uses it most.
const cur = { };
function swap(ctx) {
  for (const p of SHARED) {
    if (!T[p]) continue;
    let best = null, bw = 0;
    for (const g of ctx.segments) {
      const pal = palettes.get(keyOf(g)), list = pal && pal.pools[p];
      if (!list || list.length < Math.min(4, COUNT[p])) continue;
      const w = Math.max(ctx.weightOf(ctx.s0, g.key), ctx.weightOf(ctx.s0 + 32, g.key), ctx.weightOf(ctx.s1 - 0.01, g.key));
      if (w > bw) { bw = w; best = list; }
    }
    const src = best || base[p];
    if (cur[p] === src && T[p].length === src.length) continue;
    const A = T[p];
    A.length = 0;
    for (let i = 0; i < src.length; i++) A.push(src[i]);
    cur[p] = src;
  }
}

// Snapshot the startup pools (fallback while a palette is not ready). Call after every init*.
export function captureBase() {
  if (!T.bigRocks) T.bigRocks = [...(T.mound || []), ...(T.pinnacle || [])];
  for (const p of SHARED) if (T[p]) base[p] = T[p].slice();
}

// Populator stages (register at the front of terrain.populators).
export function rockGenStages() {
  const pops = [];
  const curPals = new Set();
  for (let k = 0; k < STAGES; k++) {
    pops.push((ctx) => {
      if (k === 0) {
        evict(ctx.s0);
        curPals.clear();
        for (const g of ctx.segments) { const p = ensure(g, ctx.tier); if (p) curPals.add(p); }
        for (let s = ctx.s1; s <= ctx.s1 + LOOK; s += 60) for (const e of ctx.weights(s)) ensure(e.g, ctx.tier); // prefetch ahead
        if (!booted && bootMs < BOOT_CAP) { const t0 = performance.now(); pump(BOOT_CAP - bootMs, curPals, true); bootMs += performance.now() - t0; stats.boot = bootMs; }
      }
      if (queue.length) pump(SLICE, curPals);
      if (k === STAGES - 1) swap(ctx);
      return null;
    });
  }
  return pops;
}

// synchronous helper for startup pools: n templates of a biome pool from its recipe list
export function makePool(biome, pool, n, seed) {
  const list = GEO[biome][pool], out = [];
  for (let k = 0; k < n; k++) out.push(drain(rockJob(pickW(list, (k + 0.5) / n), (seed * 7919 + k * 104729) >>> 0)));
  return out;
}
