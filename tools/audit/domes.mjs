// Usage: node --import ./audit/register.mjs audit/domes.mjs [styles comma|all] [seeds comma] [mode pipeline|direct|both]
// Dome audit for the sunken cities (src/props/ruins_audit.js): every dome and prang crown must rest on what is
// built under it (>= 90 % of its base ring carried within 5 cm), no piece of a holed dome may hang loose and
// every fallen shard must lie on the floor.
//   pipeline: runs every populator over the chunks of a ruins segment per style and seed (the real city plans)
//   direct:   builds every dome-bearing building kind in every style at decays 0..0.85 on a sloping site
globalThis.window = globalThis.window || {};
window.__ruinsDomeAudit = true;
const SRC = new URL('../../src/', import.meta.url).href;
const { BiomeSequence, WorldShape } = await import(SRC + 'biomes.js');
const { registerProps } = await import(SRC + 'props/index.js');
const { mulberry32 } = await import(SRC + 'noise.js');
const { DOME_LOG, Bld, Site } = await import(SRC + 'props/ruins_kit.js');
const { STYLES } = await import(SRC + 'props/ruins_styles.js');
const { auditAll } = await import(SRC + 'props/ruins_audit.js');
const { genLot, genLandmark, genTemple } = await import(SRC + 'props/ruins_mon.js');
const { genShrine } = await import(SRC + 'props/ruins_bld.js');
const { genGate } = await import(SRC + 'props/ruins_gate.js');

const styles = !process.argv[2] || process.argv[2] === 'all' ? Object.keys(STYLES) : process.argv[2].split(',');
const seeds = (process.argv[3] || '1,2,3').split(',').map(Number);
const mode = process.argv[4] || 'both';

let seq = new BiomeSequence(1, 'ruins', 5000), shape = new WorldShape(seq);
const env = { shape, seq, tier: 'high', U: { uSunDir: { value: new (await import('three')).Vector3(0.3, 0.9, 0.1).normalize() } } };
const term = { populators: [] };
registerProps(term, env); // also builds the shared column / statue templates the kit copies

const fmt = (s) => `${s.templates} templates: ${s.dome} domes, ${s.prang} prang crowns, ${s.fallen} fallen shards; min carried ${s.minCarried.toFixed(2)}, worst base gap ${(s.maxGap * 100).toFixed(1)} cm; failures ${s.fail.length}${s.fail.length ? ' ' + JSON.stringify(s.fail.slice(0, 8)) : ''}`;
let bad = 0;

if (mode !== 'direct') {
  const DX = 1.5;
  for (const st of styles) {
    window.__ruinsStyle = st;
    DOME_LOG.length = 0;
    for (const seed of seeds) {
      seq = new BiomeSequence(seed * 101 + st.length * 7 + st.charCodeAt(0), 'ruins', 20000 + seed * 3000); shape = new WorldShape(seq);
      const g = seq.segs[0];
      for (let idx = Math.ceil(g.start / 64); idx * 64 < g.end + 60; idx++) {
        const s0 = idx * 64, px = shape.pathX(s0 + 32), xMin = Math.floor((px - 165) / DX) * DX;
        const ctx = {
          s0, s1: s0 + 64, xMin, xMax: xMin + 220 * DX, rng: mulberry32((idx * 2654435761) ^ seq.seed), group: {},
          floorAt: (x, s) => shape.floorExact(x, s), floorNormal: (x, s) => shape.floorNormal(x, s), ceilingAt: (x, s) => shape.ceilingExact(x, s),
          pathX: (s) => shape.pathX(s), pathY: (s) => shape.pathY(s), weights: (s) => seq.weights(s), weightOf: (s, k) => seq.weightOf(s, k),
          segments: seq.segmentsBetween(s0, s0 + 64), surfaceY: 0, tier: 'high',
        };
        for (const pop of term.populators) { const r = pop(ctx); if (r) r.dispose(); }
      }
    }
    const s = auditAll();
    bad += s.fail.length;
    console.log(`pipeline ${st.padEnd(8)} ${fmt(s)}`);
  }
}

if (mode !== 'pipeline') {
  const fs = { floor: (x, s) => 0.9 * Math.sin(x / 6.3) + 0.6 * Math.cos(s / 4.1) + 0.04 * x }; // sloping, uneven ground
  const JOBS = [
    ['lot', 'bath', 13, 11], ['lot', 'dome', 10, 10], ['lot', 'rotunda', 12, 12], ['lot', 'shell', 10, 10], ['lot', 'tower', 7, 7],
    ['lot', 'house', 9, 8], ['lot', 'block', 14, 10], ['lot', 'prasat', 8, 8], ['shrine', '', 0, 0],
    ['landmark', 'lighthouse', 0, 0], ['landmark', 'observatory', 0, 0], ['landmark', 'tholos', 0, 0], ['landmark', 'faceTower', 0, 0], ['landmark', 'prang', 0, 0],
    ['temple', 'atlantis', 26, 24], ['temple', 'khmer', 22, 22], ['gate', 'gopura', 0, 0],
  ];
  for (const st of styles) {
    DOME_LOG.length = 0;
    let n = 0;
    for (const seed of seeds) for (const decay of [0, 0.15, 0.3, 0.45, 0.6, 0.85]) for (const [gen, kind, W, D] of JOBS) {
      const sd = seed * 7919 + Math.round(decay * 100) * 31 + kind.length * 131 + gen.length;
      const site = new Site(fs, 3 + seed, 7 + seed * 2, 0.3 * seed);
      const B = new Bld(site, sd, STYLES[st], { tier: seed % 2 ? 'high' : 'low', decay, grow: 0.8, silt: 0.5 });
      const it = gen === 'lot' ? genLot(B, kind, W, D) : gen === 'landmark' ? genLandmark(B, kind) : gen === 'temple' ? genTemple(B, kind, W, D) : gen === 'shrine' ? genShrine(B) : genGate(B, kind, 6, 4.5);
      let r = it && it.next ? it.next() : { done: true };
      while (!r.done) r = it.next();
      if (B.b.vc) { B.finish(kind || gen); n++; } else B.release();
    }
    const s = auditAll();
    bad += s.fail.length;
    console.log(`direct   ${st.padEnd(8)} ${n} builds, ${fmt(s)}`);
  }
}
console.log(bad ? `\nFAIL: ${bad} unsupported or loose domes` : '\nPASS: every dome and crown is carried, every fallen shard lies on the floor');
process.exitCode = bad ? 1 : 0;
