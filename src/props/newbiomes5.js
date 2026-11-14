// Props for the Lost City zone (nb5_lostcity.js): carbonate chimneys, towers and one landmark complex per segment,
// generated per segment through the rock_gen providers (<= 2 ms slices ahead of the camera), placed by staged
// layout chains (nb4_common.addStaged: layout slices, registration, 4k-vertex merge parts).
import { ENV } from './core.js';
import { initMaterials } from './materials.js';
import { initNBMaterials, NBSTATS } from './nb_common.js';
import { initNB2Materials } from './nb2_common.js';
import { initNB3Materials } from './nb3_common.js';
import { provide } from './rock_gen.js';
import { initNB4Materials, addStaged } from './nb4_common.js';
import { initLostCity, lostCityProviders, layoutLcA, layoutLcB } from './nb5_lostcity.js';

export function registerNewBiomeProps5(terrain, env) {
  const t0 = performance.now();
  if (!ENV.shape) ENV.shape = env.shape;
  initMaterials();
  initNBMaterials();
  initNB2Materials();
  initNB3Materials();
  initNB4Materials();
  initLostCity(env.tier);
  lostCityProviders(provide);
  const ms = performance.now() - t0;
  NBSTATS.init5 = ms;
  if (typeof window !== 'undefined' && window.__props) window.__props.initNew5 = ms;
  if (typeof console !== 'undefined') console.info(`new-biome props 5: templates built in ${ms.toFixed(0)} ms`);
  // (chain A may build a not-yet-generated landmark itself, in ~3 ms slices: generous slot count)
  addStaged(terrain, 'lcA', layoutLcA, 90);
  addStaged(terrain, 'lcB', layoutLcB, 32);
}
