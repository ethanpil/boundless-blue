// Usage: node --import ./audit/register.mjs audit/lateral.mjs [biomes comma|all] [seeds comma] [chunksPerSeg] [tier] [out.json]
// Where the props are, across the route: runs every populator on the mock terrain ctx of run.mjs and histograms,
// per zone, placed items, triangles and colour cover by lateral distance from the path line (5 m bins out to the
// zone's fog distance, at most the 165 m terrain half-width). Items are recorded as they are placed (Batch.add /
// Inst.add); colour = sRGB chroma of the item's tinted mean vertex colour, weighted by its footprint.
// Prints per zone the distance at which density falls to half and to ~zero, and the share beyond 30 / 60 m.
globalThis.window = globalThis.window || {};
const SRC = new URL('../../src/', import.meta.url).href;
const B = await import(SRC + 'biomes.js');
const { BiomeSequence, WorldShape, BIOMES, BIOME_KEYS } = B;
const core = await import(SRC + 'props/core.js');
const { registerProps } = await import(SRC + 'props/index.js');
const NBR = [];
for (const [f, n] of [['newbiomes', ''], ['newbiomes2', '2'], ['newbiomes3', '3'], ['newbiomes4', '4'], ['newbiomes5', '5'], ['newbiomes6', '6'], ['newbiomes7', '7']])
  NBR.push((await import(SRC + 'props/' + f + '.js'))['registerNewBiomeProps' + n]);
const { mulberry32 } = await import(SRC + 'noise.js');
const { registerFarField, FARSTATS } = await import(SRC + 'props/farfield.js');

const biomes = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : BIOME_KEYS;
const seeds = (process.argv[3] || '1,2').split(',').map(Number);
const maxCh = +(process.argv[4] || 5);
const tier = process.argv[5] || 'low';
const outJson = process.argv[6] || null;
const BIN = 5, HALF = 165, NB = Math.ceil(HALF / BIN);

// ---- record every placed item (global x, s), its triangles and colour
let CUR = null; // { s0, items: [] } of the chunk being built
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function meanCol(t) {
  if (t._lmc) return t._lmc;
  let r = 0, g = 0, b = 0; const n = t.vc, st = Math.max(1, Math.floor(n / 200)); let k = 0;
  for (let i = 0; i < n; i += st, k++) { r += t.col[i * 3]; g += t.col[i * 3 + 1]; b += t.col[i * 3 + 2]; }
  return (t._lmc = [r / k, g / k, b / k]);
}
function rec(tpl, x, z, sx, sz, cr, cg, cb) {
  if (!CUR || !tpl) return;
  const m = meanCol(tpl), R = srgb(Math.min(1, m[0] * cr)), G = srgb(Math.min(1, m[1] * cg)), Bl = srgb(Math.min(1, m[2] * cb));
  const chroma = Math.max(R, G, Bl) - Math.min(R, G, Bl), rad = (tpl.r || 0.3) * Math.max(sx, sz || sx);
  CUR.items.push(x, CUR.s0 - z, tpl.tris, chroma * Math.PI * rad * rad, Math.PI * rad * rad, CUR.far ? 1 : 0);
}
const bAdd = core.Batch.prototype.add;
core.Batch.prototype.add = function (tpl, x, y, z, R, sx, sy = sx, sz = sx, cr = 1, cg = 1, cb = 1, fa = 1) {
  const ok = bAdd.call(this, tpl, x, y, z, R, sx, sy, sz, cr, cg, cb, fa);
  if (ok) rec(tpl, x, z, sx, sz, cr, cg, cb);
  return ok;
};
const iAdd = core.Inst.prototype.add;
core.Inst.prototype.add = function (x, y, z, R, sx, sy = sx, sz = sx, r = 1, g = 1, b = 1) {
  const ok = iAdd.call(this, x, y, z, R, sx, sy, sz, r, g, b);
  if (ok) rec(this.tpl, x, z, sx, sz, r, g, b);
  return ok;
};

let seq = new BiomeSequence(1, biomes[0], 5000), shape = new WorldShape(seq);
const env = { shape, seq, tier, U: { uSunDir: { value: new (await import('three')).Vector3(0.3, 0.9, 0.1).normalize() } } };
const term = { populators: [] };
registerProps(term, env);
for (const f of NBR) f(term, env);
const nPre = term.populators.length;
if (process.env.NOFAR !== '1') registerFarField(term, env);

const DX = 1.5, DZ = 64 / 42;
function makeFloor(shape) { // the rendered floor mesh (as run.mjs)
  const cache = new Map();
  const node = (i, s) => { const k = i * 1048576 + Math.round(s / DZ); let v = cache.get(k); if (v === undefined) { v = shape.floorExact(i * DX, s); cache.set(k, v); } return v; };
  return (x, s) => {
    const idx = Math.floor(s / 64), s0 = idx * 64, v = (s - s0) / DZ, j = Math.min(41, Math.floor(v)), u = x / DX, i = Math.floor(u);
    const fu = u - i, fv = v - j, sa = s0 + j * DZ, sb = s0 + (j + 1) * DZ;
    const ha = node(i, sa), hb = node(i + 1, sa), hc = node(i, sb), hd = node(i + 1, sb);
    return fu + fv <= 1 ? ha + (hb - ha) * fu + (hc - ha) * fv : hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv);
  };
}
function makeCtx(shape, seq, idx, floor) {
  const s0 = idx * 64, px = shape.pathX(s0 + 32), xMin = Math.floor((px - 165) / DX) * DX;
  return {
    s0, s1: s0 + 64, xMin, xMax: xMin + 220 * DX, rng: mulberry32((idx * 2654435761) ^ seq.seed), group: {},
    floorAt: floor, floorNormal: (x, s) => shape.floorNormal(x, s), ceilingAt: (x, s) => shape.ceilingExact(x, s),
    pathX: (s) => shape.pathX(s), pathY: (s) => shape.pathY(s), weights: (s) => seq.weights(s), weightOf: (s, k) => seq.weightOf(s, k),
    segments: seq.segmentsBetween(s0, s0 + 64), surfaceY: 0, tier,
    addObstacle: () => { OBS.n++; }, addLabel: () => {}, addPOI: () => {},
  };
}
const OBS = { n: 0 }; // obstacles registered (all populators)
const fogOf = (k) => { const sg = BIOMES[k].sigma; return Math.min(330, Math.max(90, 4.5 / Math.min(sg[1], sg[2]))); };

const OUT = {};
const STG = {};
for (const key of biomes) {
  if (FARSTATS) { FARSTATS.hero = 0; FARSTATS.heroMax = 0; }
  const H = { items: new Float64Array(NB), tris: new Float64Array(NB), col: new Float64Array(NB), area: new Float64Array(NB), chunks: 0, triOut: 0, calls: 0, stageMax: 0 };
  for (const seed of seeds) {
    seq = new BiomeSequence(seed, key, 20000 + seed * 3000); shape = new WorldShape(seq);
    env.shape = shape; env.seq = seq; core.ENV.shape = shape; // bendSpots reads the shape through ENV
    const g = seq.segs[0], floor = makeFloor(shape);
    let n = 0;
    for (let idx = Math.ceil(g.start / 64) + 1; idx * 64 < g.end - 64 && n < maxCh; idx++, n++) {
      { const px = shape.pathX(idx * 64 + 32); for (let s = idx * 64 - 64; s <= idx * 64 + 128; s += DZ) for (let x = Math.floor((px - 170) / DX) * DX; x < px + 170; x += DX) floor(x, s + 1e-6); }
      const ctx = makeCtx(shape, seq, idx, floor);
      CUR = { s0: ctx.s0, items: [] };
      for (let pi = 0; pi < term.populators.length; pi++) {
        if (pi >= nPre) window.__stageTrace = []; else delete window.__stageTrace;
        CUR.far = pi >= nPre;
        const o0 = OBS.n, ta = performance.now(); const r = term.populators[pi](ctx); const dt = performance.now() - ta;
        if (pi >= nPre && n >= 1) for (const [k, ms] of window.__stageTrace) { const T = H.trace || (H.trace = {}); T[k] = Math.max(T[k] || 0, ms); if (ms > 5) H.over5 = (H.over5 || 0) + 1; H.nst = (H.nst || 0) + 1; }
        if (pi >= nPre) H.farObs = (H.farObs || 0) + OBS.n - o0; else H.obs = (H.obs || 0) + OBS.n - o0;
        if (n >= 1 && dt > H.stageMax) H.stageMax = dt;
        if (n >= 1 && pi >= nPre && dt > (H.farMax || 0)) H.farMax = dt;
        if (pi >= nPre) H.farMs = (H.farMs || 0) + dt;
        if (n >= 1 && dt > 0.3) { const a = STG[pi] || (STG[pi] = []); a.push(dt); }
        if (r) {
          r.object.traverse((o) => {
            if (!o.isMesh) return;
            const tr = o.geometry.index.count / 3 * (o.isInstancedMesh ? o.count : 1);
            H.calls++; H.triOut += tr; if (pi >= nPre) { H.farTri = (H.farTri || 0) + tr; H.farCalls = (H.farCalls || 0) + 1; }
            // GPU bytes: merged geometry (instanced: the per-instance buffers only, the template is shared)
            let b = 0;
            if (o.isInstancedMesh) b = o.instanceMatrix.array.byteLength + (o.instanceColor ? o.instanceColor.array.byteLength : 0);
            else { for (const k in o.geometry.attributes) b += o.geometry.attributes[k].array.byteLength; b += o.geometry.index.array.byteLength; }
            H.bytes = (H.bytes || 0) + b; if (pi >= nPre) H.farBytes = (H.farBytes || 0) + b;
          });
          r.dispose();
        }
      }
      const I = CUR.items; CUR = null; H.chunks++;
      for (let i = 0; i < I.length; i += 6) {
        const d = Math.abs(I[i] - shape.pathX(I[i + 1])), b = Math.min(NB - 1, Math.floor(d / BIN));
        H.items[b]++; H.tris[b] += I[i + 2]; H.col[b] += I[i + 3]; H.area[b] += I[i + 4]; if (I[i + 5]) { H.farIt = H.farIt || new Float64Array(NB); H.farIt[b]++; H.farTr = H.farTr || new Float64Array(NB); H.farTr[b] += I[i + 2]; }
      }
    }
  }
  // per 100 m2 of seabed in each bin (both sides of the path, 64 m per chunk)
  const per = (a) => Array.from(a, (v) => v / (H.chunks * 64 * 2 * BIN / 100));
  const fog = fogOf(key), nb = Math.min(NB, Math.ceil(Math.min(fog, HALF) / BIN));
  const stat = (a) => {
    const d = per(a).slice(0, nb), sm = d.map((_, i) => (d[Math.max(0, i - 1)] + d[i] + d[Math.min(nb - 1, i + 1)]) / 3);
    let pk = 0; for (let i = 1; i < nb; i++) if (sm[i] > sm[pk]) pk = i;
    const ref = sm[pk]; let half = -1, zero = -1;
    for (let i = pk; i < nb; i++) if (half < 0 && sm[i] < ref / 2) half = i;
    for (let i = nb - 1; i >= 0; i--) if (sm[i] >= ref * 0.02) { zero = i + 1; break; }
    const tot = d.reduce((s, v) => s + v, 0) || 1, beyond = (m) => d.slice(m / BIN).reduce((s, v) => s + v, 0) / tot;
    return { half: half < 0 ? '>' + nb * BIN : half * BIN, zero: zero >= nb ? '>' + nb * BIN : zero * BIN, b30: +(beyond(30) * 100).toFixed(0), b60: +(beyond(60) * 100).toFixed(0), d };
  };
  const S = { fog, chunks: H.chunks, ktrisChunk: +(H.triOut / H.chunks / 1000).toFixed(1), calls: +(H.calls / H.chunks).toFixed(1), stageMax: +H.stageMax.toFixed(1), farMax: +(H.farMax || 0).toFixed(1), farMs: +((H.farMs || 0) / H.chunks).toFixed(1), mb: +((H.bytes || 0) / H.chunks / 1048576).toFixed(2), farK: +((H.farTri || 0) / H.chunks / 1000).toFixed(1), farCalls: +((H.farCalls || 0) / H.chunks).toFixed(1), obs: +((H.obs || 0) / H.chunks).toFixed(0), farObs: +((H.farObs || 0) / H.chunks).toFixed(1), farMb: +((H.farBytes || 0) / H.chunks / 1048576).toFixed(2),
    items: stat(H.items), tris: stat(H.tris), col: stat(H.col), area: stat(H.area) };
  OUT[key] = S;
  const row = (a, k = 1) => a.d.filter((_, i) => i % 2 === 0).map((v) => (v * k).toFixed(k > 1 ? 0 : 1).padStart(5)).join('');
  console.log(`\n== ${key}  fog ${fog.toFixed(0)} m, ${H.chunks} chunks, ${S.ktrisChunk}k tris/chunk (far ${S.farK}k), ${S.calls} calls/chunk (far ${S.farCalls}), slowest stage ${S.stageMax} ms; far field ${S.farMs} ms/chunk, slowest far stage ${S.farMax} ms; props ${S.mb} MB/chunk (far ${S.farMb}); obstacles/chunk ${S.obs} (far ${S.farObs})`);
  if (FARSTATS) console.log(`  hero footprint stamping: ${(FARSTATS.hero / H.chunks).toFixed(2)} ms/chunk, slowest ${FARSTATS.heroMax.toFixed(2)} ms`);
  if (H.trace) console.log('  far stage kinds, max ms:', JSON.stringify(Object.fromEntries(Object.entries(H.trace).map(([k, v]) => [k, +v.toFixed(2)]))), `stages over 5 ms: ${H.over5 || 0} of ${H.nst}`);
  console.log(`  items: half at ${S.items.half} m, ~zero at ${S.items.zero} m, beyond 30 m ${S.items.b30}%, beyond 60 m ${S.items.b60}%`);
  console.log(`  tris : half at ${S.tris.half} m, ~zero at ${S.tris.zero} m, beyond 30 m ${S.tris.b30}%, beyond 60 m ${S.tris.b60}%`);
  console.log(`  color: half at ${S.col.half} m, ~zero at ${S.col.zero} m, beyond 30 m ${S.col.b30}%, beyond 60 m ${S.col.b60}%`);
  console.log(`  cover: half at ${S.area.half} m, ~zero at ${S.area.zero} m, beyond 30 m ${S.area.b30}%, beyond 60 m ${S.area.b60}%`);
  console.log('  m       ' + S.items.d.filter((_, i) => i % 2 === 0).map((_, i) => String(i * 10).padStart(5)).join(''));
  console.log('  it/100m2' + row(S.items));
  console.log('  tris/m2 ' + row(S.tris, 0.01));
  console.log('  cover%  ' + row(S.area));
  if (H.farIt) { const k = 1 / (H.chunks * 64 * 2 * BIN / 100); console.log('  far it  ' + Array.from(H.farIt).filter((_, i) => i % 2 === 0).map((v) => (v * k).toFixed(1).padStart(5)).join('')); console.log('  far ktri' + Array.from(H.farTr).filter((_, i) => i % 2 === 0).map((v) => (v / H.chunks / 1000).toFixed(1).padStart(5)).join('')); }
}
const names = {}; // stage index -> populator kind is not tracked here; run.mjs prints per-stage names
const slow = Object.entries(STG).map(([i, a]) => [+i, Math.max(...a)]).filter((x) => x[1] > 3).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('\nslowest stages (index, max ms):', JSON.stringify(slow.map(([i, v]) => [i, +v.toFixed(1)])));
if (outJson) { const fs = await import('node:fs'); fs.writeFileSync(outJson, JSON.stringify(OUT)); }
