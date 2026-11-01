// Props for the newer biomes (mangrove, wall, softcoral, deepplain). Templates are generated once at
// startup; each biome registers staged populators (layout stage + merge stages, each <= ~5 ms).
import { ENV } from './core.js';
import { initMaterials } from './materials.js';
import { initNBMaterials, stagedNB, statWrap, NBSTATS, NBDBG } from './nb_common.js';
import { initMangrove, layoutMangroveP, layoutMangroveA, layoutMangroveB, layoutMangroveC } from './mangrove.js';
import { initWall, layoutWallP, layoutWallA, layoutWallB, layoutWallC, layoutWallD, layoutWallE } from './wall.js';
import { initSoftcoral, layoutSoftA, layoutSoftB } from './softcoral.js';
import { initDeepplain, layoutDeepA, layoutDeepB, layoutDeepC } from './deepplain.js';

export function registerNewBiomeProps(terrain, env) {
  const t0 = performance.now();
  if (!ENV.shape) ENV.shape = env.shape;
  initMaterials();
  initNBMaterials();
  initMangrove();
  initWall();
  initSoftcoral();
  initDeepplain();
  NBSTATS.init = performance.now() - t0;
  if (typeof window !== 'undefined' && window.__props) window.__props.initNew = NBSTATS.init;
  if (typeof console !== 'undefined') console.info(`new-biome props: templates built in ${NBSTATS.init.toFixed(0)} ms`);
  const L = {
    mangroveA: layoutMangroveA, mangroveB: layoutMangroveB, mangroveC: layoutMangroveC,
    wallA: layoutWallA, wallB: layoutWallB, wallC: layoutWallC, wallD: layoutWallD, wallE: layoutWallE,
    softA: layoutSoftA, softB: layoutSoftB,
    deepA: layoutDeepA, deepB: layoutDeepB, deepC: layoutDeepC,
  };
  NBDBG.layouts = L;
  // plan-only stages (layouts that cache a per-chunk plan used by the next chains)
  const PLAN = { mangroveP: layoutMangroveP, wallP: layoutWallP };
  const add = (name, layout, n) => stagedNB(layout, n).forEach((p, i) => terrain.populators.push(statWrap(name + i, p)));
  for (const [name, layout] of Object.entries(PLAN)) add(name, layout, 3);
  // (the wall's terrace reef, chain E, seats colonies on the knolls' meshes and merges five batches: it
  // needs more slices than the others, or its last stage drains the rest in one go)
  for (const [name, layout] of Object.entries(L)) add(name, layout, name === 'wallE' ? 20 : 10);
}
