// Props for the whale fall zone (nb7_whalefall.js): one carcass per segment, generated per segment through the
// rock_gen providers (<= 2 ms slices ahead of the camera), placed by staged layout chains (nb4_common.addStaged:
// layout slices, registration, 4k-vertex merge parts).
import { ENV } from './core.js';
import { initMaterials } from './materials.js';
import { initNBMaterials, NBSTATS } from './nb_common.js';
import { initNB4Materials, addStaged } from './nb4_common.js';
import { provide } from './rock_gen.js';
import { initWhaleFall, whaleFallProviders, layoutWfA, layoutWfB } from './nb7_whalefall.js';

export function registerNewBiomeProps7(terrain, env) {
  const t0 = performance.now();
  if (!ENV.shape) ENV.shape = env.shape;
  initMaterials();
  initNBMaterials();
  initNB4Materials();
  initWhaleFall(env.tier);
  whaleFallProviders(provide);
  const ms = performance.now() - t0;
  NBSTATS.init7 = ms;
  if (typeof window !== 'undefined' && window.__props) window.__props.initNew7 = ms;
  if (typeof console !== 'undefined') console.info(`new-biome props 7: templates built in ${ms.toFixed(0)} ms`);
  // (chain A may build a not-yet-generated carcass itself, in ~2 ms slices: generous slot count)
  addStaged(terrain, 'wfA', layoutWfA, 90);
  addStaged(terrain, 'wfB', layoutWfB, 24);
}
