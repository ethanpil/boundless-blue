// Props & set-pieces entry point. Generates the startup geometry variants, then registers one or more
// populators per biome on the terrain. Each populator returns merged / instanced meshes for its chunk
// (a handful of draw calls) and frees its per-chunk buffers on dispose. Rock pools (T.rocks, T.mound,
// T.pinnacle, T.bigRocks, T.tpRock, T.ventRock) and vent chimneys are regenerated per biome segment by
// rock_gen.js, whose stages run first in every chunk build: keep live references to those arrays.
import { T, ENV, staged, named } from './core.js';
import { initMaterials } from './materials.js';
import { rock, pebblePatch, algaePatch, rockSet, ROCK_TYPE_KEYS } from './shapes.js';
import { initSandflat, layoutSandflat } from './sandflat.js';
import { initReef, layoutReef, layoutReefMicro } from './reef.js';
import { initKelp, layoutKelp, layoutKelpFloor } from './kelp.js';
import { initSeagrass, layoutGrassNear, layoutGrassFar, layoutSeagrassMisc } from './seagrass.js';
import { initCave, makeCaveLayout } from './cave.js';
import { initWreck, layoutWreck } from './wreck.js';
import { initRuins, layoutRuins } from './ruins.js';
import { initVents, layoutVents } from './vents.js';
import { initTidepool, layoutTidepool } from './tidepool.js';
import { initPolar, layoutPolar } from './polar.js';
import { initPelagic, layoutPelagic } from './pelagic.js';
import { initFeatures } from './features.js';
import { rockGenStages, captureBase, makePool } from './rock_gen.js';

// lightweight per-populator stats (inspect window.__props in the console)
const stats = { init: 0, pops: {} };
if (typeof window !== 'undefined') window.__props = stats;

function wrap(name, fn) {
  return (ctx) => {
    const t0 = performance.now();
    const r = fn(ctx);
    const dt = performance.now() - t0;
    const st = stats.pops[name] || (stats.pops[name] = { n: 0, ms: 0, max: 0, tris: 0, maxTris: 0, calls: 0 });
    st.max = Math.max(st.max, dt);
    if (r) {
      let tris = 0, calls = 0;
      r.object.traverse((o) => {
        if (!o.isMesh) return;
        calls++;
        const n = o.geometry.index ? o.geometry.index.count / 3 : 0;
        tris += o.isInstancedMesh ? n * o.count : n;
      });
      st.n++; st.ms += dt; st.tris += tris; st.maxTris = Math.max(st.maxTris, tris); st.calls = Math.max(st.calls, calls);
    }
    return r;
  };
}

export function registerProps(terrain, env) {
  const it = registerPropsSteps(terrain, env);
  while (!it.next().done);
}

// The same work in steps (one template group each, in the same order, so the world is identical): main.js boot
// paints the title card's progress between them instead of freezing it for the ~0.9 s of the whole call.
// Yields the fraction done (by typical cost); stats.initSteps keeps each step's ms.
export function* registerPropsSteps(terrain, env) {
  const steps = [
    () => {
      ENV.shape = env.shape;
      initMaterials();
      T.rocks = [...rockSet(ROCK_TYPE_KEYS.filter((k) => k !== 'pinnacle'), 4, { detail: 3 }), ...makePool('kelp', 'rocks', 7, 3)];
    },
    () => {
      T.mound = rockSet(['boulder', 'angular', 'sediment', 'undercut', 'volcanic'], 2, { detail: 4, growth: 1.0 });
      // shared floor micro detail + steer-around pinnacles
      T.rubble = [pebblePatch(1, { n: 14, r: 0.6, size: 0.07, flat: 0.45, elong: 3, col: [0.85, 0.8, 0.7], growth: 0.4, mode: 2 }), pebblePatch(2, { n: 9, r: 0.4, size: 0.09, flat: 0.5, elong: 2.5, col: [0.8, 0.76, 0.68], growth: 0.5, mode: 2 })];
      T.pebbles = [pebblePatch(3, { n: 16, r: 0.6, size: 0.06, flat: 0.6, col: [0.7, 0.68, 0.64] }), pebblePatch(4, { n: 7, r: 0.35, size: 0.12, flat: 0.55, col: [0.66, 0.64, 0.6] })];
      T.grit = [pebblePatch(5, { n: 16, r: 0.55, size: 0.03, flat: 0.35, col: [0.95, 0.9, 0.82], growth: 0 })];
      T.algae = [algaePatch(1), algaePatch(2, { r: 1.2, col: [0.42, 0.3, 0.14] })];
      T.spongeLump = [rock(61, { detail: 2, sx: 0.25, sy: 0.2, sz: 0.22, rough: 0.5, growth: 0.3 }), rock(62, { detail: 2, sx: 0.18, sy: 0.25, sz: 0.2, rough: 0.6, growth: 0.3 })];
    },
    () => { T.pinnacle = rockSet(['pinnacle'], 6, { detail: 4, growth: 0.9 }); },
    initReef, initKelp, initSeagrass, initCave, initWreck, initRuins, initVents, initTidepool, initPolar, initPelagic, initSandflat, initFeatures,
    () => {
      flagTemplates();
      nameAll();
      captureBase(); // startup pools = fallback while a segment's own palette is generated
    },
  ];
  const W = [7, 2, 1, 22, 5, 2, 5, 4, 23, 13, 5, 3, 5, 1, 4, 0.2]; // typical cost of each step (browser, ms / 10)
  const total = W.reduce((a, b) => a + b, 0);
  stats.initSteps = [];
  let busy = 0, done = 0;
  for (let i = 0; i < steps.length; i++) {
    const t = performance.now();
    steps[i]();
    const ms = performance.now() - t;
    busy += ms; stats.initSteps.push(Math.round(ms));
    done += W[i];
    if (i < steps.length - 1) yield done / total;
  }
  stats.init = busy;
  console.info(`props: templates built in ${stats.init.toFixed(0)} ms`);
  // lazy per-segment rock / chimney generation (<= 2 ms slices), ahead of every other populator of a chunk
  terrain.populators.unshift(...rockGenStages());
  const add = (name, layout) => staged(layout).forEach((p, i) => terrain.populators.push(wrap(name + i, p)));
  add('reef', layoutReef);
  add('reefM', layoutReefMicro);
  add('kelp', layoutKelp);
  add('kelpF', layoutKelpFloor);
  add('grassN', layoutGrassNear);
  add('grassF', layoutGrassFar);
  add('grassM', layoutSeagrassMisc);
  add('cave', makeCaveLayout(env));
  add('wreck', layoutWreck);
  add('ruins', layoutRuins);
  add('vents', layoutVents);
  add('tide', layoutTidepool);
  add('polar', layoutPolar);
  add('pelagic', layoutPelagic);
  add('sand', layoutSandflat);
}

// support: other props may rest on it (exact top-surface raycast, placed upright)
// drape: flat patch that follows the floor mesh vertex by vertex
function flagTemplates() {
  const set = (keys, f) => { for (const k of keys) if (T[k]) for (const x of Array.isArray(T[k]) ? T[k] : [T[k]]) x[f] = true; };
  set(['rocks', 'mound', 'pinnacle', 'coralMound', 'boulder', 'brain', 'tpRock', 'ventRock', 'caveBlock', 'steps', 'container'], 'support');
  set(['rubble', 'grit', 'algae', 'pebbles', 'mat', 'burrows', 'tpBarnacle', 'tpMussel', 'tpLimpet', 'ventMussels', 'sandDollar'], 'drape');
}

// common names for the "i" overlay
function nameAll() {
  const N = {
    coralMound: 'Coral head',
    fan: 'Gorgonian sea fan', tubeSp: 'Tube sponge', barrel: 'Giant barrel sponge', soft: 'Soft coral', leather: 'Leather coral',
    anem: 'Magnificent sea anemone', whip: 'Sea whip', clam: 'Giant clam', star: 'Sea star', urchin: 'Long-spined sea urchin',
    conch: 'Queen conch', cucumber: 'Sea cucumber', scallop: 'Scallop', sandDollar: 'Sand dollar', cushion: 'Cushion star',
    understory: 'Understory kelp', stalactite: 'Stalactite', stalagmite: 'Stalagmite', caveColumn: 'Cave column', deadTree: 'Drowned tree', block: 'Masonry block',
    wall: 'Ruined wall', pyramid: 'Stepped pyramid', head: 'Colossal stone head', figure: 'Stone statue', amphora: 'Amphora', slab: 'Paving stone',
    chimney: 'Black smoker', worms: 'Giant tube worms', ventMussels: 'Vent mussel bed', mat: 'Bacterial mat',
    tpAnemGreen: 'Giant green anemone', tpAnemPink: 'Aggregating anemone', tpStar: 'Ochre sea star', tpUrchin: 'Purple sea urchin',
    tpMussel: 'California mussels', tpBarnacle: 'Acorn barnacles', tpSnail: 'Black turban snail', tpLettuce: 'Sea lettuce', tpTuft: 'Coralline algae', tpSurf: 'Surfgrass',
    keel: 'Ice keel', berg: 'Iceberg', brinicle: 'Brinicle', sargassum: 'Sargassum', seaPen: 'Sea pen', burrows: 'Garden eel burrows', tuft: 'Turtle grass',
    rubble: 'Coral rubble', spongeLump: 'Encrusting sponge', linckia: 'Blue sea star', cots: 'Crown-of-thorns starfish',
  };
  const fill = (t, n) => { for (const x of Array.isArray(t) ? t : [t]) if (!x.label) x.label = n; };
  for (const [k, n] of Object.entries(N)) if (T[k]) fill(T[k], n);
  // one-line fun facts for the overlay (templates that set their own keep theirs)
  const F = {
    coralMound: 'Massive corals grow about a centimetre a year: a head this size can be centuries old.',
    fan: 'Sea fans grow broadside to the current, sieving plankton with thousands of tiny polyps.',
    barrel: 'Giant barrel sponges grow for centuries; the largest may be over 2,000 years old.',
    tubeSp: 'Sponges are animals that pump and filter thousands of litres of seawater a day.',
    star: 'A sea star walks on hundreds of tiny tube feet, and can regrow a lost arm.',
    urchin: 'When a disease killed most Caribbean long-spined urchins in 1983, algae smothered many reefs.',
    conch: 'A queen conch can live about 30 years; adults grow the famous flared pink lip.',
    cucumber: 'Sea cucumbers swallow sand, digest the film of food on it and leave clean sand behind.',
    sandDollar: 'Sand dollars are flattened sea urchins; their velvet coat is thousands of tiny spines.',
    cushion: 'Cushion stars graze the film of algae and microbes on sand and seagrass.',
    scallop: 'A scallop has dozens of tiny blue eyes along the edge of its shell.',
    kelp: 'Giant kelp can grow more than half a metre in a single day.',
    stalactite: 'These grew in dry caves during the last ice age, when the sea stood over 100 m lower.',
    stalagmite: 'Stalagmites only grow in air: this one stopped when the sea flooded the cave.',
    caveColumn: 'A column forms where a stalactite and a stalagmite finally meet.',
    deadTree: 'Cenotes are layered: fresh rainwater floats on salty sea water, with a shimmering halocline between.',
    worms: 'Giant tube worms have no mouth or gut: bacteria inside them make food from vent chemicals.',
    ventMussels: 'Vent mussels carry bacteria in their gills that turn sulphide or methane into food.',
    mat: 'Bacterial mats feed on hydrogen sulphide: the base of a food web that never sees sunlight.',
    tpStar: 'Ochre stars are a keystone species: without them, mussels crowd out everything else.',
    tpAnemGreen: 'Its green comes from algae living inside its tissues.',
    tpUrchin: 'Purple urchins can grind out their own pockets in solid rock.',
    tpMussel: 'Mussels anchor themselves with silky byssal threads that hold against crashing waves.',
    tpBarnacle: 'Barnacles are crustaceans glued head-down to the rock, kicking food into their mouths with their legs.',
    berg: 'Only about a tenth of an iceberg shows above the water.',
    cots: 'Crown-of-thorns starfish eat living coral; outbreaks can strip whole reefs bare.',
    linckia: 'Blue sea stars can split in two, and each half regrows the rest.',
    amphora: 'Amphorae carried wine, olive oil and garum, a pungent fermented fish sauce.',
    head: 'The largest Olmec colossal heads weigh about 40 tonnes, each carved from a single boulder.',
    column: 'Classical columns were stacked from stone drums joined by wooden or bronze dowels.',
    columnBroken: 'Classical columns were stacked from stone drums joined by wooden or bronze dowels.',
    drum: 'Classical columns were stacked from stone drums joined by wooden or bronze dowels.',
    wall: 'Ancient masons often fitted blocks without mortar, held by weight and precision alone.',
    pyramid: 'Stepped pyramids were temple platforms: priests climbed the stair to the shrine on top.',
    slab: 'Ancient roads were paved with fitted stone over layers of gravel and sand.',
    figure: 'Most ancient bronze statues were melted down; stone ones survived for divers to find.',
  };
  const fact = (t, f) => { for (const x of Array.isArray(t) ? t : [t]) if (!x.fact) x.fact = f; };
  for (const [k, f] of Object.entries(F)) if (T[k]) fact(T[k], f);
  const S = T.ship, D = T.debris;
  if (S) {
    named(S.wood, 'Galleon wreck'); named(S.woodBow, 'Galleon bow section'); named(S.woodStern, 'Galleon stern section');
    named(S.steel, 'Steel freighter wreck'); named(S.steelBow, 'Freighter bow section'); named(S.steelStern, 'Freighter stern section');
    named(S.plane, 'Aircraft wreck'); named(S.sub, 'Submarine wreck');
  }
  if (D) {
    const DN = { barrel: 'Wooden cask', drum: 'Oil drum', crate: 'Cargo crate', cannon: 'Iron cannon', anchor: 'Anchor', chain: 'Anchor chain', plank: 'Ship timbers', plate: 'Hull plating', frag: 'Hull fragment', fragSteel: 'Steel hull fragment', mast: 'Broken mast' };
    for (const [k, n] of Object.entries(DN)) if (D[k]) fill(D[k], n);
    if (D.cannon) fact(D.cannon, "In the 1660s divers in a simple diving bell salvaged most of the Vasa's bronze cannons.");
    if (D.anchor) fact(D.anchor, 'Old anchors had a stock across the shank, so one fluke always dug into the seabed.');
  }
}
