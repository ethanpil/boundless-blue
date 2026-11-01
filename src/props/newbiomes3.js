// Props for the sargassum sea, the jellyfish lake and the anemone fields. Startup templates are the
// fallbacks; every segment of these biomes also generates its own anemones, rocks, limestone walls and
// weed clumps (rock_gen.js providers, <= 2 ms slices ahead of the camera), so nothing repeats from one
// visit to the next. Each biome registers staged populators (layout slices <= ~3 ms, then merge stages).
import { ENV } from './core.js';
import { initMaterials } from './materials.js';
import { initNBMaterials, statWrap, NBSTATS, NBDBG } from './nb_common.js';
import { initNB2Materials, stagedNB2 } from './nb2_common.js';
import { provide } from './rock_gen.js';
import { initNB3Materials } from './nb3_common.js';
import { initAnemoneField, anemoneProviders, layoutAnP, layoutAnA, layoutAnB, layoutAnC } from './nb3_anemone.js';
import { initSargassum, sargassumProviders, layoutSargassum } from './nb3_sargassum.js';
import { initJellyLake, jellyLakeProviders, layoutJlP, layoutJlA, layoutJlB, layoutJlC } from './nb3_jellylake.js';

export function registerNewBiomeProps3(terrain, env) {
  const t0 = performance.now();
  if (!ENV.shape) ENV.shape = env.shape;
  initMaterials();
  initNBMaterials();
  initNB2Materials();
  initNB3Materials();
  initAnemoneField(env.tier);
  initSargassum(env.tier);
  initJellyLake(env.tier);
  anemoneProviders(provide);
  sargassumProviders(provide);
  jellyLakeProviders(provide);
  const ms = performance.now() - t0;
  NBSTATS.init3 = ms;
  if (typeof window !== 'undefined' && window.__props) window.__props.initNew3 = ms;
  if (typeof console !== 'undefined') console.info(`new-biome props 3: templates built in ${ms.toFixed(0)} ms`);
  const L = { anA: layoutAnA, anB: layoutAnB, anC: layoutAnC, sg: layoutSargassum, jlA: layoutJlA, jlB: layoutJlB, jlC: layoutJlC };
  Object.assign(NBDBG.layouts, L);
  const PLAN = { anP: layoutAnP, jlP: layoutJlP };
  // merge jobs of <= 13k vertices keep every stage near 2-3 ms on weak CPUs (draped carpets cost more per vertex)
  const add = (name, layout, n) => stagedNB2(layout, n, 13000).forEach((p, i) => terrain.populators.push(statWrap(name + i, p)));
  for (const [name, layout] of Object.entries(PLAN)) add(name, layout, 10);
  for (const [name, layout] of Object.entries(L)) add(name, layout, 22);
}
