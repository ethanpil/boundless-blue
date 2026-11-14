// Props for the cold-water coral reef zone (nb6_coldcoral.js). Startup templates are small fallbacks; every
// segment grows its own living colonies and dead framework clumps through the rock_gen providers (<= 2 ms
// slices ahead of the camera). Staged like newbiomes4.js: layout chains yielding at ~3 ms, a registration stage,
// then 4k-vertex merge parts (nb4_common.addStaged).
import { ENV } from './core.js';
import { initMaterials } from './materials.js';
import { initNBMaterials, NBSTATS } from './nb_common.js';
import { initNB4Materials, addStaged } from './nb4_common.js';
import { provide } from './rock_gen.js';
import { initColdCoral, coldCoralProviders, layoutCcA, layoutCcB, layoutCcC } from './nb6_coldcoral.js';

export function registerNewBiomeProps6(terrain, env) {
  const t0 = performance.now();
  if (!ENV.shape) ENV.shape = env.shape;
  initMaterials();
  initNBMaterials();
  initNB4Materials();
  initColdCoral(env.tier);
  coldCoralProviders(provide);
  const ms = performance.now() - t0;
  NBSTATS.init6 = ms;
  if (typeof window !== 'undefined' && window.__props) window.__props.initNew6 = ms;
  if (typeof console !== 'undefined') console.info(`new-biome props 6: templates built in ${ms.toFixed(0)} ms`);
  addStaged(terrain, 'ccA', layoutCcA, 56);
  addStaged(terrain, 'ccB', layoutCcB, 40);
  addStaged(terrain, 'ccC', layoutCcC, 40);
}
