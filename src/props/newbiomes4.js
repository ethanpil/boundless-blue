// Props for the five 2026-11 zones: otterkelp, whaleshark, biobay, iceedge, hadal (nb4_*.js). Startup templates
// are small fallbacks; every segment of these zones generates its own kelp plants, bull kelp, rocks, prop roots,
// sea pens, brinicles, icicle fringes, algae curtains, xenophyophores, holothurians and glass sponges through the
// rock_gen providers (<= 2 ms slices ahead of the camera), so nothing repeats from one visit to the next.
// Each zone registers staged populators: an optional plan stage, then layout chains (generators yielding at
// ~3 ms slices) and their merge stages (<= 12-14k vertices each).
import { ENV } from './core.js';
import { initMaterials } from './materials.js';
import { initNBMaterials, NBSTATS } from './nb_common.js';
import { initNB2Materials, stagedNB2 } from './nb2_common.js';
import { initNB3Materials } from './nb3_common.js';
import { statWrap } from './nb_common.js';
import { provide } from './rock_gen.js';
import { initNB4Materials, addStaged } from './nb4_common.js';
import { initOtter, otterProviders, layoutOkP, layoutOkA, layoutOkB } from './nb4_otter.js';
import { initWhale, whaleProviders, layoutWsA, layoutWsB } from './nb4_whale.js';
import { initBay, bayProviders, layoutBbP, layoutBbA, layoutBbB } from './nb4_bay.js';
import { initIce, iceProviders, layoutIeA, layoutIeB } from './nb4_ice.js';
import { initHadal, hadalProviders, layoutHdA, layoutHdB } from './nb4_hadal.js';

export function registerNewBiomeProps4(terrain, env) {
  const t0 = performance.now();
  if (!ENV.shape) ENV.shape = env.shape;
  initMaterials();
  initNBMaterials();
  initNB2Materials();
  initNB3Materials();
  initNB4Materials();
  initOtter(env.tier); initWhale(env.tier); initBay(env.tier); initIce(env.tier); initHadal(env.tier);
  otterProviders(provide); whaleProviders(provide); bayProviders(provide); iceProviders(provide); hadalProviders(provide);
  const ms = performance.now() - t0;
  NBSTATS.init4 = ms;
  if (typeof window !== 'undefined' && window.__props) window.__props.initNew4 = ms;
  if (typeof console !== 'undefined') console.info(`new-biome props 4: templates built in ${ms.toFixed(0)} ms`);
  // plan stages (shared by a zone's chains; not audited themselves)
  const plan = (name, layout) => stagedNB2(layout, 8).forEach((p, i) => terrain.populators.push(statWrap(name + i, p)));
  plan('okP', layoutOkP);
  plan('bbP', layoutBbP);
  // (generous slot counts: the layout generators use several slots before their merges start, and an idle slot
  // costs about a microsecond, while too few slots flush the remaining merges into the last one)
  addStaged(terrain, 'okA', layoutOkA, 56, 11000);
  addStaged(terrain, 'okB', layoutOkB, 56, 11000);
  addStaged(terrain, 'wsA', layoutWsA, 24, 11000);
  addStaged(terrain, 'wsB', layoutWsB, 28, 11000);
  addStaged(terrain, 'bbA', layoutBbA, 40, 11000);
  addStaged(terrain, 'bbB', layoutBbB, 48, 11000);
  addStaged(terrain, 'ieA', layoutIeA, 40, 11000);
  addStaged(terrain, 'ieB', layoutIeB, 32, 11000);
  addStaged(terrain, 'hdA', layoutHdA, 36, 11000);
  addStaged(terrain, 'hdB', layoutHdB, 32, 11000);
}
