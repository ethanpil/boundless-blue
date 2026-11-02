// Usage: node --import ./audit/register.mjs audit/run.mjs [biomes comma|all] [seeds comma] [audit=1|0] [maxChunksPerSeg] [tier]
// Runs EVERY registered populator (old props + new-biome props) on a mock terrain ctx for each chunk of each
// biome segment. Reports per-chunk CPU time, tris, POIs/labels, and ground-gap (floating) audits.
globalThis.window = globalThis.window || { __propsAudit: true, __propsItems: [] }; // enables core.js item recording
window.__propsAudit = true; window.__propsItems = [];
const SRC = new URL('../../src/', import.meta.url).href;
const { BiomeSequence, WorldShape } = await import(SRC + 'biomes.js');
const { registerProps } = await import(SRC + 'props/index.js');
const { registerNewBiomeProps } = await import(SRC + 'props/newbiomes.js');
const { registerNewBiomeProps2 } = await import(SRC + 'props/newbiomes2.js');
const { registerNewBiomeProps3 } = await import(SRC + 'props/newbiomes3.js');
const { registerNewBiomeProps4 } = await import(SRC + 'props/newbiomes4.js');
const NB = await import(SRC + 'props/nb_common.js');
const { mulberry32 } = await import(SRC + 'noise.js');

const { BIOME_KEYS } = await import(SRC + 'biomes.js');
const biomes = (process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : BIOME_KEYS);
const seeds = (process.argv[3] || '1,2,3').split(',').map(Number);
const doAudit = process.argv[4] !== '0';
const maxCh = +(process.argv[5] || 999);
const tier = process.argv[6] || 'high';

let seq = new BiomeSequence(1, biomes[0], 5000), shape = new WorldShape(seq);
const env = { shape, seq, tier, U: { uSunDir: { value: new (await import('three')).Vector3(0.3, 0.9, 0.1).normalize() } } }; // cave.js reads env.U.uSunDir
let t0 = performance.now();
const term = { populators: [] };
registerProps(term, env);
const nOld = term.populators.length;
const tOld = performance.now() - t0;
t0 = performance.now();
registerNewBiomeProps(term, env);
registerNewBiomeProps2(term, env);
registerNewBiomeProps3(term, env);
registerNewBiomeProps4(term, env);
console.log(`init: old props ${tOld.toFixed(0)} ms, new biomes ${(performance.now() - t0).toFixed(0)} ms; populators ${nOld} old + ${term.populators.length - nOld} new`);
const popNames = Object.keys(NB.NBSTATS.pops || {});

const DX = 1.5, DZ = 64 / 42;
function makeFloor(shape) {
  const cache = new Map();
  const node = (i, s) => { const k = i * 1048576 + Math.round(s / DZ); let v = cache.get(k); if (v === undefined) { v = shape.floorExact(i * DX, s); cache.set(k, v); } return v; };
  return (x, s) => {
    const idx = Math.floor(s / 64), s0 = idx * 64, v = (s - s0) / DZ, j = Math.min(41, Math.floor(v)), u = x / DX, i = Math.floor(u);
    const fu = u - i, fv = v - j, sa = s0 + j * DZ, sb = s0 + (j + 1) * DZ;
    const ha = node(i, sa), hb = node(i + 1, sa), hc = node(i, sb), hd = node(i + 1, sb);
    return fu + fv <= 1 ? ha + (hb - ha) * fu + (hc - ha) * fv : hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv);
  };
}
// the rendered ceiling mesh: exact heights at the lattice nodes, the same triangle split in between
function makeCeil(shape) {
  const cache = new Map();
  const node = (i, s) => { const k = i * 1048576 + Math.round(s / DZ); let v = cache.get(k); if (v === undefined) { v = shape.ceilingExact(i * DX, s); cache.set(k, v); } return v; };
  return (x, s) => {
    const idx = Math.floor(s / 64), s0 = idx * 64, v = (s - s0) / DZ, j = Math.min(41, Math.floor(v)), u = x / DX, i = Math.floor(u);
    const fu = u - i, fv = v - j, sa = s0 + j * DZ, sb = s0 + (j + 1) * DZ;
    const ha = node(i, sa), hb = node(i + 1, sa), hc = node(i, sb), hd = node(i + 1, sb);
    return fu + fv <= 1 ? ha + (hb - ha) * fu + (hc - ha) * fv : hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv);
  };
}
function makeCtx(shape, seq, idx, floor) {
  const s0 = idx * 64, px = shape.pathX(s0 + 32);
  const xMin = Math.floor((px - 165) / DX) * DX;
  const obs = [], labels = [], pois = [];
  return {
    s0, s1: s0 + 64, xMin, xMax: xMin + 220 * DX, rng: mulberry32((idx * 2654435761) ^ seq.seed), group: {},
    floorAt: floor, floorNormal: (x, s) => shape.floorNormal(x, s), ceilingAt: (x, s) => shape.ceilingExact(x, s),
    pathX: (s) => shape.pathX(s), pathY: (s) => shape.pathY(s), weights: (s) => seq.weights(s), weightOf: (s, k) => seq.weightOf(s, k),
    segments: seq.segmentsBetween(s0, s0 + 64), surfaceY: 0, tier,
    addObstacle: (...a) => obs.push(a), addLabel: (...a) => labels.push(a), addPOI: (...a) => pois.push(a),
    _obs: obs, _labels: labels, _pois: pois,
  };
}

// ---- geometry helpers for the audit
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
function closestOnTri(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}
const worldPt = (it, px, py, pz) => { const R = it.R, x = px * it.sx, y = py * it.sy, z = pz * it.sz; return [R[0] * x + R[1] * y + R[2] * z + it.x, R[3] * x + R[4] * y + R[5] * z + it.y, R[6] * x + R[7] * y + R[8] * z + it.z]; };
const meshCache = new Map();
function worldTris(key, it) {
  let m = meshCache.get(key); if (m) return m;
  const t = it.tpl, P = [];
  for (let i = 0; i < t.vc; i++) P.push(worldPt(it, t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2]));
  m = { P, I: t.idx, C: comps(t) }; meshCache.set(key, m); return m;
}
function comps(t) { // connected parts of a template mesh (union-find over shared vertices)
  if (t._cmp) return t._cmp;
  const par = Int32Array.from({ length: t.vc }, (_, i) => i), f = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  for (let k = 0; k < t.idx.length; k += 3) { const a = f(t.idx[k]), b = f(t.idx[k + 1]), c = f(t.idx[k + 2]); par[b] = a; par[f(c)] = a; }
  const id = new Int32Array(t.idx.length / 3); for (let k = 0; k < id.length; k++) id[k] = f(t.idx[k * 3]);
  return (t._cmp = id);
}
function meshDist(p, m) { // signed distance to a union of closed parts (negative inside any part)
  const best = new Map();
  for (let k = 0; k < m.I.length; k += 3) {
    const a = m.P[m.I[k]], b = m.P[m.I[k + 1]], c = m.P[m.I[k + 2]];
    const q = closestOnTri(p, a, b, c), d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const cid = m.C[k / 3], e = best.get(cid);
    if (!e || d < e[0] - 1e-9) {
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      best.set(cid, [d, (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2] < 0 ? -1 : 1]);
    }
  }
  let r = 1e9; for (const [d, sg] of best.values()) r = Math.min(r, d * sg);
  return r;
}

const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const report = {};
const STG = [];
const names = term.populators.map((_, i) => i < nOld ? 'old#' + i : 'new#' + (i - nOld));
for (const key of biomes) {
  const R = report[key] = { km: 0, chunks: 0, items: 0, maxBase: -1e9, maxLow: -1e9, worst: [], tris: [], calls: [], layoutMs: [], counts: {}, tk: {}, pois: {}, labels: 0 };
  for (const seed of seeds) {
    seq = new BiomeSequence(seed, key, 20000 + seed * 3000); shape = new WorldShape(seq);
    const g = seq.segs[0], floor = makeFloor(shape), ceil = makeCeil(shape);
    let n = 0;
    for (let idx = Math.ceil(g.start / 64); idx * 64 < g.end + 60 && n < maxCh; idx++, n++) {
      R.chunks++; R.km += 0.064;
      // pre-build the floor lattice around the chunk (the terrain has its grid before props run)
      { const px = shape.pathX(idx * 64 + 32); for (let s = idx * 64 - 64; s <= idx * 64 + 128; s += DZ) for (let x = Math.floor((px - 170) / DX) * DX; x < px + 170; x += DX) floor(x, s + 1e-6); }
      const ctx = makeCtx(shape, seq, idx, floor);
      let tris = 0, calls = 0; const tc0 = performance.now(); let tmax = 0; window.__propsItems.length = 0;
      for (let pi = 0; pi < term.populators.length; pi++) {
        const pop = term.populators[pi];
        const ta = performance.now();
        const r = pop(ctx);
        const dt = performance.now() - ta; if (dt > tmax) tmax = dt;
        if (n >= 2) (STG[pi] || (STG[pi] = [])).push(dt);
        if (r) { r.object.traverse((o) => { if (o.isMesh) { calls++; tris += o.geometry.index.count / 3; } }); r.dispose(); }
      }
      for (const p of ctx._pois) R.pois[p[0]] = (R.pois[p[0]] || 0) + 1;
      R.labels += ctx._labels.length;
      R.tris.push(tris); R.calls.push(calls);
      if (n >= 2) { (R.chunkMs || (R.chunkMs = [])).push(performance.now() - tc0); R.stageMax = Math.max(R.stageMax || 0, tmax); }
      { // old-props contact audit: lowest base points of each floor-seated item vs the Ground (floor + supports)
        const gl = window.__propsItems;
        for (const e of gl) {
          if (e.mode !== 'floor' || !e.it.tpl || !e.it.tpl.pos || e.it.tpl.drape) continue; // drape patches conform to the floor vertex by vertex
          let B; try { B = NB.basePts(e.it.tpl); } catch { continue; }
          let gb = -1e9;
          for (let i = 0; i < B.length; i += 3) { const w = worldPt(e.it, B[i], B[i + 1], B[i + 2]); gb = Math.max(gb, w[1] - e.gnd.h(w[0], e.s0 - w[2])); }
          R.oldItems = (R.oldItems || 0) + 1; if (gb > (R.oldMax ?? -1e9)) R.oldMax = gb;
          if (gb > 0.05) (R.oldFloat || (R.oldFloat = [])).push([e.it.tpl.label || '?', +gb.toFixed(3), seed, idx]);
        }
      }
      if (!doAudit) continue;
      NB.NBDBG.audit = true;
      meshCache.clear();
      const actx = makeCtx(shape, seq, idx, floor);
      for (const [name, layout] of Object.entries(NB.NBDBG.layouts)) {
        const ta = performance.now();
        const L = NB.runLayout(layout, actx);
        R.layoutMs.push([name, performance.now() - ta]);
        if (!L) continue;
        for (const b of L.batches) for (const it of b.items) {
          const sup = it.nb; if (!sup) continue; if (sup === 'surface' || sup === 'roots') { const l2 = it.tpl.label || name; R.tk[l2] = (R.tk[l2] || 0) + it.tpl.tris; continue; }
          const lbl = it.tpl.label || name;
          R.counts[lbl] = (R.counts[lbl] || 0) + 1; R.tk[lbl] = (R.tk[lbl] || 0) + it.tpl.tris;
          R.items++;
          const B = NB.basePts(it.tpl);
          let gb = -1e9, gl = 1e9;
          const gapAt = (p) => {
            if (sup === 'floor') return p[1] - floor(p[0], actx.s0 - p[2]);
            if (sup === 'ceil') return ceil(p[0], actx.s0 - p[2]) - p[1]; // hanging: base point below the ice underside
            if (sup.root) return meshDist(p, worldTris(sup.root, { ...sup.root, z: -(sup.root.s - actx.s0) }));
            if (sup.item) return Math.min(meshDist(p, worldTris(sup.item, sup.item)), p[1] - floor(p[0], actx.s0 - p[2]));
            return 0;
          };
          for (let i = 0; i < B.length; i += 3) gb = Math.max(gb, gapAt(worldPt(it, B[i], B[i + 1], B[i + 2])));
          if (sup === 'floor') {
            const t = it.tpl, step = Math.max(1, Math.floor(t.vc / 300));
            for (let i = 0; i < t.vc; i += step) gl = Math.min(gl, gapAt(worldPt(it, t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2])));
          } else gl = gb;
          if (gb > R.maxBase) R.maxBase = gb;
          if (gl > R.maxLow) R.maxLow = gl;
          if (gb > 0.02) { R.worst.push([lbl, +gb.toFixed(3), seed, idx]); if (process.env.DBG && sup.root) { const r = sup.root; const ds = []; for (let i = 0; i < B.length; i += 3) ds.push(+gapAt(worldPt(it, B[i], B[i + 1], B[i + 2])).toFixed(3)); const rg = []; for (let i = 0; i < B.length; i += 3) { const w = worldPt(it, B[i], B[i + 1], B[i + 2]); rg.push(+rootGapD(r, w[0], w[1], actx.s0 - w[2]).toFixed(3)); } console.log(lbl, "sc", it.sx.toFixed(2), "root s", r.sx.toFixed(2), r.sy.toFixed(2), "ds", ds.join(","), "rg", rg.join(",")); } }
        }
      }
      NB.NBDBG.audit = false;
    }
  }
  const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const lm = {}; for (const [n, ms] of R.layoutMs) lm[n] = Math.max(lm[n] || 0, ms);
  console.log(`\n== ${key}: ${R.km.toFixed(1)} km, ${R.chunks} chunks, ${R.items} audited items, labels/chunk ${(R.labels / R.chunks).toFixed(1)}`);
  console.log(`  tris/chunk avg ${(avg(R.tris) / 1000).toFixed(0)}k max ${(Math.max(...R.tris) / 1000).toFixed(0)}k; calls avg ${avg(R.calls).toFixed(1)} max ${Math.max(...R.calls)}`);
  if (R.chunkMs) console.log(`  chunk CPU ms (all populators) p50 ${pct(R.chunkMs, 0.5).toFixed(1)} p90 ${pct(R.chunkMs, 0.9).toFixed(1)} max ${Math.max(...R.chunkMs).toFixed(1)}; slowest single stage ${R.stageMax.toFixed(1)} ms`);
  if (R.oldItems) console.log(`  old-props floor audit: ${R.oldItems} items, max base gap ${(R.oldMax * 100).toFixed(1)} cm, >5cm: ${(R.oldFloat || []).length}${R.oldFloat ? ' worst ' + JSON.stringify(R.oldFloat.sort((a, b) => b[1] - a[1]).slice(0, 6)) : ''}`);
  console.log('  pois:', JSON.stringify(R.pois));
  if (doAudit) {
    console.log(`  max base gap ${(R.maxBase * 100).toFixed(2)} cm, max lowest-vertex gap ${(R.maxLow * 100).toFixed(2)} cm, floating items: ${R.worst.length}`);
    if (R.worst.length) console.log('  worst:', JSON.stringify(R.worst.sort((a, b) => b[1] - a[1]).slice(0, 12)));
    console.log('  layout ms (audit pass, max):', JSON.stringify(Object.fromEntries(Object.entries(lm).map(([k, v]) => [k, +v.toFixed(2)]))));
    console.log('  ktris/chunk by type:', JSON.stringify(Object.fromEntries(Object.entries(R.tk).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / R.chunks / 1000).toFixed(1)]))));
    console.log('  counts:', JSON.stringify(Object.fromEntries(Object.entries(R.counts).map(([k, v]) => [k, Math.round(v / R.chunks)]))));
  }
}
console.log('\nstage ms p50/p90/max (warm):', STG.map((a, i) => a && pct(a, 0.9) > 0.3 ? names[i] + ' ' + pct(a, 0.5).toFixed(1) + '/' + pct(a, 0.9).toFixed(1) + '/' + Math.max(...a).toFixed(1) : null).filter(Boolean).join('  '));
const stg = Object.entries((window.__props && window.__props.pops) || NB.NBSTATS.pops || {}).map(([k, v]) => [k, +v.max.toFixed(2), Math.round(v.maxTris / 1000) + 'k']).filter((x) => x[1] > 0.3 || x[2] !== '0k');
console.log('\nstage max ms / max tris:', JSON.stringify(stg));
