// World-building worker (module worker; see pool.js): terrain chunk data, the sky-visibility map and the noise
// texture. Jobs carry the biome segment list (BiomeSequence.snapshot) and get typed arrays back (transferred).
// Its module graph must stay free of the bare 'three' specifier: import maps do not reach workers.
import { BiomeSequence, WorldShape } from '../biomes.js';
import { noiseTextureData } from '../noise.js';
import { chunkData, skyData } from './terrain_gen.js';

// Segment records by id (ids are never reused), so lazily cached layouts (seamount spires, blue holes,
// brine basins) are worked out once per segment, as on the main thread.
let segCache = new Map();
function world(list) {
  const next = new Map();
  const segs = list.map((g) => { const r = segCache.get(g.id) || g; next.set(g.id, r); return r; });
  segCache = next;
  const seq = BiomeSequence.replica(segs);
  return { seq, shape: new WorldShape(seq) };
}
const finish = (it) => { for (;;) { const r = it.next(); if (r.done) return r.value; } };

self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'chunk') {
      const { seq, shape } = world(m.segs);
      const d = finish(chunkData(shape, seq, m.idx, m.surfaceY));
      const t = [d.hf.buffer, d.hc.buffer];
      for (const a of [d.floor, d.ceil]) if (a) t.push(a.pos.buffer, a.nor.buffer, a.col.buffer, a.det.buffer, a.idx.buffer);
      self.postMessage({ id: m.id, result: d }, t);
    } else if (m.type === 'sky') {
      const { seq, shape } = world(m.segs);
      const d = finish(skyData(shape, seq, m.ox, m.os, m.N, m.cell, m.surf));
      self.postMessage({ id: m.id, result: d }, [d.buffer]);
    } else if (m.type === 'noise') {
      const d = noiseTextureData(m.size);
      self.postMessage({ id: m.id, result: d }, [d.buffer]);
    }
  } catch (e) {
    self.postMessage({ id: m.id, error: String((e && e.stack) || e) });
  }
};
