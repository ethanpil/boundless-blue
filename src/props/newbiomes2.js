// Props for seamount, blue hole, sunken forest and champagne reef. Startup templates are the fallbacks;
// every segment of these biomes also gets its own freshly generated shapes (giant fans, rocks, drowned
// trees, speleothems) through rock_gen.js palettes, so nothing repeats from one visit to the next.
// Each biome registers staged populators (layout stages <= ~3 ms slices, then merge stages).
import { ENV } from './core.js';
import { initMaterials } from './materials.js';
import { initNBMaterials, statWrap, NBSTATS, NBDBG } from './nb_common.js';
import { provide } from './rock_gen.js';
import { rockJob, tiered } from './rock_recipes.js';
import { initNB2Materials, stagedNB2 } from './nb2_common.js';
import { giantFan, caveMouth } from './nb2_life.js';
import { initSeamount, layoutSmP, layoutSmA, layoutSmB, layoutSmC, SM_ROCKS, SM_FAN } from './nb2_seamount.js';
import { initForest, layoutSfP, layoutSfA, layoutSfB, layoutSfC, treeKind } from './nb2_forest.js';
import { treeG, logG, stumpG } from './nb2_trees.js';
import { initChampagne, layoutChP, layoutChA, layoutChB, layoutChC, CH_ROCKS } from './nb2_champagne.js';
import { initBluehole, layoutBhP, layoutBhA, layoutBhB, layoutBhC, BH_ROCKS, ribTpl } from './nb2_bluehole.js';

const once = (f) => function* () { return f(); };
const named = (t, [label, fact]) => { t.label = label; t.fact = fact; return t; };

export function registerNewBiomeProps2(terrain, env) {
  const t0 = performance.now();
  if (!ENV.shape) ENV.shape = env.shape;
  initMaterials();
  initNBMaterials();
  initNB2Materials();
  initSeamount();
  initForest(env.tier);
  initChampagne();
  initBluehole();
  // per-segment palettes (generated in <= 2 ms slices ahead of the camera)
  provide('seamount', 'nb2smRock', 10, (seg, k, tier) => rockJob(tiered(SM_ROCKS[(k + (seg.seed >>> 4)) % SM_ROCKS.length], tier), (seg.seed ^ (k * 0x9e3779b1)) >>> 0), 2);
  provide('seamount', 'nb2smFan', 8, (seg, k) => once(() => named(giantFan((seg.seed ^ (k * 0x2545f491)) >>> 0, { h: 1.6 + ((seg.seed >>> (k + 2)) % 9) * 0.13, lobes: 1 + ((seg.seed >>> k) % 3 === 0 ? 1 : 0) + (k === 7 ? 1 : 0), cup: 0.03 + (k % 4) * 0.03 }), SM_FAN))(), 2);
  provide('sunkenforest', 'nb2sfTree', 10, (seg, k, tier) => treeG((seg.seed ^ (k * 0x27d4eb2f)) >>> 0, treeKind(seg, k, 10), { tier }), 1);
  provide('sunkenforest', 'nb2sfLog', 4, (seg, k, tier) => logG((seg.seed ^ (k * 0x165667b1)) >>> 0, { tier }), 2);
  provide('champagne', 'nb2chRock', 8, (seg, k, tier) => rockJob(tiered(CH_ROCKS[(k + (seg.seed >>> 5)) % CH_ROCKS.length], tier), (seg.seed ^ (k * 0x7feb352d)) >>> 0), 2);
  provide('bluehole', 'nb2bhRock', 8, (seg, k, tier) => rockJob(tiered(BH_ROCKS[(k + (seg.seed >>> 6)) % BH_ROCKS.length], tier), (seg.seed ^ (k * 0x2c1b3c6d)) >>> 0), 2);
  provide('bluehole', 'nb2bhFan', 6, (seg, k) => once(() => named(giantFan((seg.seed ^ (k * 0x297a2d39)) >>> 0, { h: 1.4 + ((seg.seed >>> (k + 3)) % 7) * 0.15, lobes: 1 + (k % 3 === 2 ? 1 : 0), cup: 0.04 + (k % 3) * 0.03 }), SM_FAN))(), 2);
  provide('bluehole', 'nb2bhRib', 6, (seg, k) => once(() => ribTpl((seg.seed ^ (k * 0x3c6ef372)) >>> 0, k + (seg.seed >>> 9)))(), 2);
  provide('bluehole', 'nb2bhCave', 3, (seg, k) => once(() => caveMouth((seg.seed ^ (k * 0x1b873593)) >>> 0, { W: 10 + ((seg.seed >>> (k + 1)) % 7) * 1.3, H: 5 + ((seg.seed >>> (k + 4)) % 4) * 0.8, D: 3 + (k % 3) * 0.6 }))(), 2);
  provide('sunkenforest', 'nb2sfStump', 3, (seg, k) => stumpG((seg.seed ^ (k * 0x61c88647)) >>> 0), 2);
  const ms = performance.now() - t0;
  NBSTATS.init2 = ms;
  if (typeof window !== 'undefined' && window.__props) window.__props.initNew2 = ms;
  if (typeof console !== 'undefined') console.info(`new-biome props 2: templates built in ${ms.toFixed(0)} ms`);
  const L = { smA: layoutSmA, smB: layoutSmB, smC: layoutSmC, sfA: layoutSfA, sfB: layoutSfB, sfC: (ctx) => layoutSfC(ctx, env), chA: layoutChA, chB: layoutChB, chC: layoutChC, bhA: layoutBhA, bhB: layoutBhB, bhC: (ctx) => layoutBhC(ctx, env) };
  Object.assign(NBDBG.layouts, L);
  const PLAN = { smP: layoutSmP, sfP: layoutSfP, chP: layoutChP, bhP: layoutBhP };
  const add = (name, layout, n) => stagedNB2(layout, n).forEach((p, i) => terrain.populators.push(statWrap(name + i, p)));
  for (const [name, layout] of Object.entries(PLAN)) add(name, layout, 10);
  // seamount chain B and blue hole chain B also build a crust skin (~16 slices of 3 ms on a laptop): headroom
  // before the last stage would have to drain it in one go on slower devices
  for (const [name, layout] of Object.entries(L)) add(name, layout, name === 'smB' || name === 'bhB' ? 34 : 22);
}
