// Shared infrastructure for the 2026-11 zones (otter coast, whale-shark grounds, bioluminescent bay, ice edge,
// hadal trench): drifting sunlit plankton particles, twinkling dinoflagellate sediment, an instanced batch the
// gap audit and the label / obstacle registration understand, ceiling sampling and hanging, staged merging.
import * as THREE from 'three';
import { applyWater } from '../water.js';
import { Batch, Inst, CHUNK, ceilSampler, releaseAfterUpload } from './core.js';
import { NBDBG, statWrap, basePts, surfGrid, registerNB, finishNB } from './nb_common.js';
import { hangY, itemSpots } from './nb2_common.js';
import { mulberry32 } from '../noise.js';

export const NB4 = { mat: {} };
export const rr = (rng, a, b) => a + (b - a) * rng();
export const pick = (rng, a) => a[(rng() * a.length) | 0];
export const chunkRng = (ctx, salt) => mulberry32(((Math.floor(ctx.s0) * 2654435761) ^ salt) >>> 0);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const L = (hex) => [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
export const once = (f) => function* () { return f(); };
// a seed for slot k of a segment's template pool
export const segSeed = (seg, k, salt) => (seg.seed ^ Math.imul(k + 1, salt)) >>> 0;
// fraction in [0, 1) from bits of a seed
export const q01 = (sd, n) => ((sd >>> n) % 1000) / 1000;

// ---------------------------------------------------------------- contact with a host item (rocks)
// A coarse grid of a template's triangles (cells >= 0.2 template units, ~20 per axis) for closest-point queries:
// a few ms to build even for a big outcrop (nb2_common's fine grid took 34 ms on one), built in a provider step.
const CG = new WeakMap();
export function coarseGrid(t) {
  let G = CG.get(t);
  if (G) return G;
  const [x0, y0, z0, x1, y1, z1] = t.box, cs = Math.max(0.2, Math.max(x1 - x0, y1 - y0, z1 - z0) / 20);
  const nx = Math.ceil((x1 - x0) / cs) + 1, ny = Math.ceil((y1 - y0) / cs) + 1, nz = Math.ceil((z1 - z0) / cs) + 1, cells = new Map(), P = t.pos, I = t.idx;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const i0 = Math.floor((Math.min(P[a], P[b], P[c]) - x0) / cs), i1 = Math.floor((Math.max(P[a], P[b], P[c]) - x0) / cs);
    const j0 = Math.floor((Math.min(P[a + 1], P[b + 1], P[c + 1]) - y0) / cs), j1 = Math.floor((Math.max(P[a + 1], P[b + 1], P[c + 1]) - y0) / cs);
    const k0 = Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z0) / cs), k1 = Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z0) / cs);
    for (let q = k0; q <= k1; q++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const key = (q * ny + j) * nx + i; let l = cells.get(key); if (!l) cells.set(key, (l = [])); l.push(k); }
  }
  G = { x0, y0, z0, cs, nx, ny, nz, cells };
  CG.set(t, G);
  return G;
}
const _cq = [0, 0, 0];
function closestTri(px, py, pz, P, a, b, c, out) { // closest point on a triangle (Ericson)
  const ax = P[a], ay = P[a + 1], az = P[a + 2], abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = P[b]; out[1] = P[b + 1]; out[2] = P[b + 2]; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return; }
  const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = P[c]; out[1] = P[c + 1]; out[2] = P[c + 2]; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = P[b] + w * (P[c] - P[b]); out[1] = P[b + 1] + w * (P[c + 1] - P[b + 1]); out[2] = P[b + 2] + w * (P[c + 2] - P[b + 2]); return; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}
// signed distance (template units, negative inside) from a template-space point to the nearest triangle within
// one coarse cell of it; NaN if none is that close
export function nearDist(t, px, py, pz) {
  const G = coarseGrid(t), P = t.pos, I = t.idx;
  const fx = (px - G.x0) / G.cs, fy = (py - G.y0) / G.cs, fz = (pz - G.z0) / G.cs, ci = Math.floor(fx), cj = Math.floor(fy), ck = Math.floor(fz);
  let best = Infinity, sg = 1;
  const scan = (i, j, q) => {
    if (i < 0 || j < 0 || q < 0 || i >= G.nx || j >= G.ny || q >= G.nz) return;
    const l = G.cells.get((q * G.ny + j) * G.nx + i);
    if (!l) return;
    for (const k of l) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      closestTri(px, py, pz, P, a, b, c, _cq);
      const dx = px - _cq[0], dy = py - _cq[1], dz = pz - _cq[2], d = dx * dx + dy * dy + dz * dz;
      if (d < best - 1e-12) {
        best = d;
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        sg = dx * (e1y * e2z - e1z * e2y) + dy * (e1z * e2x - e1x * e2z) + dz * (e1x * e2y - e1y * e2x) < 0 ? -1 : 1;
      }
    }
  };
  // own cell first: a hit closer than the cell's nearest face is the true closest (the common case, near the surface)
  scan(ci, cj, ck);
  const m = Math.min(fx - ci, ci + 1 - fx, fy - cj, cj + 1 - fy, fz - ck, ck + 1 - fz) * G.cs;
  if (best < m * m) return sg * Math.sqrt(best);
  for (let q = ck - 1; q <= ck + 1; q++) for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) if (i !== ci || j !== cj || q !== ck) scan(i, j, q);
  return best === Infinity ? NaN : sg * Math.sqrt(best);
}
// a base point of a decoration (rotation R, scale sx/sy/sz, anchor P = [x, y, s]) in the host's template space
function toHost(it, s0, R, sx, sy, sz, P, bx0, by0, bz0, o) {
  const H = it.R, bx = bx0 * sx, by = by0 * sy, bz = bz0 * sz;
  const wx = P[0] + R[0] * bx + R[1] * by + R[2] * bz - it.x, wy = P[1] + R[3] * bx + R[4] * by + R[5] * bz - it.y, wz = -(P[2] - s0) + R[6] * bx + R[7] * by + R[8] * bz - it.z;
  o[0] = (H[0] * wx + H[3] * wy + H[6] * wz) / it.sx; o[1] = (H[1] * wx + H[4] * wy + H[7] * wz) / it.sy; o[2] = (H[2] * wx + H[5] * wy + H[8] * wz) / it.sz;
  return o;
}
const _hp = [0, 0, 0];
// Does a decoration really grip its host item? Every base point must lie within `tol` of the host's surface or
// inside it, by the closest-point distance (the vertical "top surface" that seatOnItem measures lies over
// crevices, pits and leaning columns: a holdfast seated that way hung 25 cm deep in a crack). Conservative for
// non-uniform scales (distances scaled by the largest axis); nothing near counts as a miss.
export function grips(it, s0, tpl, R, sx, sy, sz, P, tol = 0.02) {
  const B = basePts(tpl), k = Math.max(it.sx, it.sy, it.sz);
  for (let i = 0; i < B.length; i += 3) {
    toHost(it, s0, R, sx, sy, sz, P, B[i], B[i + 1], B[i + 2], _hp);
    if (!(nearDist(it.tpl, _hp[0], _hp[1], _hp[2]) * k <= tol)) return false;
  }
  return true;
}
// Press a decoration (rotation R, uniform scale sc, anchor P) onto a host item along -n (the spot normal) until
// every base point is `embed` inside it; false where a base point finds no surface near (overhang, thin part).
export function pressOn(it, s0, tpl, R, sc, P, n, embed = 0.02) {
  const B = basePts(tpl), k = Math.min(it.sx, it.sy, it.sz);
  for (let pass = 0; pass < 3; pass++) {
    let worst = -1e9;
    for (let i = 0; i < B.length; i += 3) {
      toHost(it, s0, R, sc, sc, sc, P, B[i], B[i + 1], B[i + 2], _hp);
      const d = nearDist(it.tpl, _hp[0], _hp[1], _hp[2]);
      if (d !== d) return false;
      if (d * k > worst) worst = d * k;
    }
    const m = worst + embed;
    if (m <= 0.003) return true;
    if (m > 0.6) return false;
    P[0] -= n[0] * m; P[1] -= n[1] * m; P[2] += n[2] * m;
  }
  return false;
}
// a template job whose result also gets its lookup structures (coarse contact grid, top-surface ray grid, base
// points, obstacle capsules), each in a step of its own, so the first layout that seats something on it pays nothing.
// qy: the capsule fits registerNB will ask for (Template.capsules keys: round(2 log2(sy / sx)), sx = sz here);
// a new segment's first chunk spent ~7 ms fitting 24 of them in one registration.
export function* gridded(it, qy = [-1, 0, 1]) {
  const t = yield* it;
  if (!t) return t;
  yield;
  coarseGrid(t);
  yield;
  surfGrid(t); basePts(t);
  yield;
  itemSpots({ tpl: t, R: I3, sx: 1, sy: 1, sz: 1, x: 0, y: 0, z: 0 }, { s0: 0 }, 1, 2); // caches the template's surface spots
  for (const q of qy) { yield; t.capsules(2 ** (q / 2), 1, 6); }
  return t;
}
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const warmTpl = (t, qy = [-1, 0, 1]) => { coarseGrid(t); surfGrid(t); basePts(t); itemSpots({ tpl: t, R: I3, sx: 1, sy: 1, sz: 1, x: 0, y: 0, z: 0 }, { s0: 0 }, 1, 2); for (const q of qy) t.capsules(2 ** (q / 2), 1, 6); return t; };
// Register a staged layout under `name`: the layout stage(s), then registration, then merges (stagedNB4).
export function addStaged(terrain, name, layout, nBuild = 20, part = 4000) {
  NBDBG.layouts[name] = layout;
  stagedNB4(layout, nBuild, part).forEach((p, i) => terrain.populators.push(statWrap(name + i, p)));
}

// ---------------------------------------------------------------- staged merging that never blocks
// Like nb2_common.stagedNB2 (the layout generator resumes in its slices; the last slot drains whatever is left), but
// labels / obstacles / POIs are registered in a stage of their own, and each batch is merged straight into the buffers
// of one mesh per <= 40k vertices, in parts of <= `part` vertices (as many parts per stage as start within ~1.5 ms).
// stagedNB2 made one mesh (one draw call) per 11k-vertex slice and merged a whole slice in one stage (6-12 ms);
// building parts and joining them afterwards cost another 3-13 ms per join (allocation and copy).
const JOIN = 40000, STAGE_MS = 1.5;
// Items [i0, i1) of batch b into the mesh buffers A at vertex offset vo / index offset io. The per-vertex transform is
// core.js Batch.build's (keep the two in step): rotation and scale, renormalised normals for non-uniform scales,
// draped patches following the floor, tint, aFx.x multiplier and the per-instance texture-key shift.
function fillItems(b, i0, i1, A, vo, io) {
  const { pos, nor, col, fx, idx } = A;
  for (let q = i0; q < i1; q++) {
    const it = b.items[q];
    const t = it.tpl, R = it.R, sx = it.sx, sy = it.sy, sz = it.sz;
    const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
    const P = t.pos, N = t.nor, C = t.col, F = t.fx, tx = it.x, ty = it.y, tz = it.z;
    const cr = it.cr, cg = it.cg, cb = it.cb, fa = it.fa, ko = it.ko;
    const uni = sx === sy && sy === sz;
    const isx = 1 / sx, isy = 1 / sy, isz = 1 / sz;
    const nv = t.vc, ob = vo * 3, dr = it.drape, minY = t.minY, ds0 = it.s0, dl = t.dLift - 0.012;
    for (let k3 = 0, e = nv * 3; k3 < e; k3 += 3) {
      const o = ob + k3;
      const px = P[k3] * sx, py = P[k3 + 1] * sy, pz = P[k3 + 2] * sz;
      pos[o] = r0 * px + r1 * py + r2 * pz + tx;
      pos[o + 1] = r3 * px + r4 * py + r5 * pz + ty;
      pos[o + 2] = r6 * px + r7 * py + r8 * pz + tz;
      if (dr) pos[o + 1] = dr.at(pos[o], ds0 - pos[o + 2]) + (P[k3 + 1] - minY) * sy + dl;
      let nx = N[k3], ny = N[k3 + 1], nz = N[k3 + 2];
      if (uni) {
        nor[o] = r0 * nx + r1 * ny + r2 * nz; nor[o + 1] = r3 * nx + r4 * ny + r5 * nz; nor[o + 2] = r6 * nx + r7 * ny + r8 * nz;
      } else {
        nx *= isx; ny *= isy; nz *= isz;
        const ax = r0 * nx + r1 * ny + r2 * nz, ay = r3 * nx + r4 * ny + r5 * nz, az = r6 * nx + r7 * ny + r8 * nz;
        const l = 1 / (Math.sqrt(ax * ax + ay * ay + az * az) || 1);
        nor[o] = ax * l; nor[o + 1] = ay * l; nor[o + 2] = az * l;
      }
      col[o] = C[k3] * cr; col[o + 1] = C[k3 + 1] * cg; col[o + 2] = C[k3 + 2] * cb;
    }
    const fo = vo * 2;
    for (let i = 0, e = nv * 2; i < e; i += 2) {
      fx[fo + i] = F[i] * fa;
      const m = F[i + 1];
      fx[fo + i + 1] = ko && m > 5.5 && m < 6.99 ? 6.05 + ((m - 6.05 + ko) % 0.9) : ko && m > 0.55 && m < 1.45 ? 0.6 + ((m - 0.6 + ko * 0.8) % 0.8) : m;
    }
    const I = t.idx;
    for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo;
    vo += nv; io += I.length;
  }
}
function meshOf(grp) {
  const { b, A } = grp, P = A.pos, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(A.nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(A.col, 3));
  g.setAttribute('aFx', new THREE.BufferAttribute(A.fx, 2));
  g.setIndex(new THREE.BufferAttribute(A.idx, 1));
  // bounding sphere about the box centre, as computeBoundingSphere does (its per-vertex Vector3 reads took 1.5-3 ms)
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < P.length; i += 3) { const dx = P[i] - cx, dy = P[i + 1] - cy, dz = P[i + 2] - cz, d = dx * dx + dy * dy + dz * dz; if (d > r2) r2 = d; }
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.sqrt(r2) + (b.pad ?? 1));
  releaseAfterUpload(g);
  const m = new THREE.Mesh(g, b.mat);
  m.matrixAutoUpdate = false;
  if (b.lod) m.userData.lod = b.lod;
  if (b.order) m.renderOrder = b.order;
  grp.A = null;
  return m;
}
function stagedNB4(layout, nBuild, part) {
  const cache = new WeakMap();
  const plan = (L) => { // jobs: a part of a mesh, a finished mesh, an instanced batch, a ready mesh
    const jobs = [];
    for (const b of L.batches) {
      if (!b || !b.items.length) continue;
      if (b instanceof IBatch) { jobs.push({ ib: b }); continue; }
      const its = b.items;
      for (let i = 0; i < its.length;) {
        let j = i, vc = 0, ic = 0;
        while (j < its.length && (j === i || vc + its[j].tpl.vc <= JOIN)) { vc += its[j].tpl.vc; ic += its[j].tpl.idx.length; j++; }
        const grp = { b, vc, ic, A: null };
        for (let k = i, vo = 0, io = 0; k < j;) {
          let k1 = k, pv = 0;
          while (k1 < j && (k1 === k || pv + its[k1].tpl.vc <= part)) pv += its[k1++].tpl.vc;
          jobs.push({ grp, i0: k, i1: k1, vo, io });
          for (; k < k1; k++) { vo += its[k].tpl.vc; io += its[k].tpl.idx.length; }
        }
        jobs.push({ done: grp });
        i = j;
      }
    }
    if (L.extra) for (const m of L.extra) if (m) jobs.push({ mesh: m });
    L.jobs = jobs; L.j = 0;
  };
  const run = (job) => {
    if (job.mesh) return job.mesh;
    if (job.ib) return job.ib.build();
    if (job.done) return meshOf(job.done);
    const G = job.grp;
    if (!G.A) G.A = { pos: new Float32Array(G.vc * 3), nor: new Float32Array(G.vc * 3), col: new Float32Array(G.vc * 3), fx: new Float32Array(G.vc * 2), idx: G.vc > 65535 ? new Uint32Array(G.ic) : new Uint16Array(G.ic) };
    fillItems(G.b, job.i0, job.i1, G.A, job.vo, job.io);
    return null;
  };
  const step = (ctx, last) => {
    const st = cache.get(ctx.group);
    if (!st) return null;
    if (st.gen) {
      let v = st.gen.next();
      if (last) while (!v.done) v = st.gen.next();
      if (!v.done) return null;
      st.gen = null;
      if (!v.value) { cache.delete(ctx.group); return null; }
      st.L = v.value;
      if (!last) return null;
    }
    const L = st.L;
    if (!L.jobs) {
      plan(L);
      registerNB(ctx, L.batches, L.labels);
      if (L.pois && ctx.addPOI) for (const p of L.pois) ctx.addPOI(p.type, p.x, p.y, p.s, p.r, p.data);
      if (!last) return null;
    }
    const out = [], t0 = performance.now();
    while (L.j < L.jobs.length) {
      const m = run(L.jobs[L.j++]);
      if (m) out.push(m);
      if (!last && performance.now() - t0 > STAGE_MS) break;
    }
    if (L.j >= L.jobs.length) cache.delete(ctx.group);
    return finishNB(out);
  };
  const pops = [(ctx) => {
    const r = layout(ctx);
    if (!r) return null;
    cache.set(ctx.group, typeof r.next === 'function' ? { gen: r } : { gen: null, L: r });
    return step(ctx, false);
  }];
  for (let k = 0; k < nBuild; k++) pops.push((ctx) => step(ctx, k === nBuild - 1));
  return pops;
}

// ---------------------------------------------------------------- instanced batch
// One InstancedMesh per template, with the Batch interface the staged merge and registerNB use (items with
// tpl / R / scale / position for labels, obstacles and the gap audit; build() returns the mesh). Pays for
// numerous identical small things (urchins, brittle stars): no per-chunk vertex merge, a few bytes each.
export class IBatch {
  constructor(tpl, mat, max, lod = null) { this.inst = new Inst(tpl, mat, max, lod); this.tpl = tpl; this.items = []; this.lod = lod; this.vc = 1; this.max = max; }
  get count() { return this.items.length; }
  add(x, y, z, R, sx, sy, sz, col, sup = 'floor') {
    if (!this.inst.add(x, y, z, R, sx, sy, sz, col[0], col[1], col[2])) return false;
    const it = { tpl: this.tpl, x, y, z, R, sx, sy, sz, cr: col[0], cg: col[1], cb: col[2], fa: 1, ko: 0, lbl: null, name: null, fact: null };
    if (NBDBG.audit) it.nb = sup;
    this.items.push(it);
    return true;
  }
  // (the staged merge disposes mesh.geometry when the chunk unloads; the template's shared geometry must survive,
  // so each chunk's instanced mesh gets its own copy of it: a few hundred vertices)
  build() {
    const m = this.inst.build();
    if (!m) return null;
    const g = m.geometry.clone(), gd = g.dispose.bind(g);
    g.dispose = () => { gd(); m.dispose(); }; // ...and the instance buffers go with it
    m.geometry = g;
    releaseAfterUpload(g);
    if (this.lod) m.userData.lod = this.lod;
    return m;
  }
}
// put into an IBatch with the same arguments order as nb_common.put
export function iput(ctx, ib, x, y, s, R, sx, sy, sz, col, sup = 'floor') { return ib.add(x, y, -(s - ctx.s0), R, sx, sy, sz, col, sup); }

// ---------------------------------------------------------------- ceilings
// Ceiling mesh sampler (same lattice and split as the rendered ceiling): at(x, s) = underside height.
export const ceilOf = (ctx) => ceilSampler(ctx);
// Is there solid ice / rock overhead at (x, s) (not open water)?
export const iced = (cs, ctx, x, s, margin = 0.3) => cs.at(x, s) < ctx.surfaceY - margin;
// Hang a base-up template (R maps its local +y downward) under the ceiling: every base point `embed` m inside
// the ice. Returns the anchor y, or NaN where a base point is under open water.
export function hangOn(ctx, cs, tpl, R, sc, x, s, embed = 0.03, margin = 0.25) {
  const sup = { at: (qx, qs) => { const h = cs.at(qx, qs); return h < ctx.surfaceY - margin ? h : NaN; } };
  return hangY(sup, basePts(tpl), R, sc, x, -1e9, s, embed);
}
// rotation of a base-up template hanging under a surface: +y to -y (about x), then yaw
export function hangR(yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // rotX(pi) * rotY(yaw): local up turns down, local x / z keep their yaw
  return [c, 0, s, 0, -1, 0, s, 0, -c];
}
// ---------------------------------------------------------------- plankton clouds
// Copepods, larvae and fish eggs: tiny specks drifting and twitching in the sunlit water. Additive billboards
// (never smaller than ~1.3 px), bright when lit from behind (forward scatter toward the sun), dimmer with depth.
// Instanced quads: position = the quad corner (+-1, +-1); per particle aOff = rest point, aP = (phase, wander m,
// size m, seed): 7 floats a particle (per-vertex quads took five times the memory, ~2 MB a chunk).
const PK_V = /* glsl */`
attribute vec3 aOff; attribute vec4 aP;
varying vec2 vC; varying float vK; varying float vS; varying float vCam;
uniform float uTime;
`;
const PK_F = /* glsl */`
varying vec2 vC; varying float vK; varying float vS; varying float vCam;
`;
function planktonMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  return applyWater(m, {
    key: 'nb4-plankton', additive: true, noLight: true, vertexHead: PK_V, fragmentHead: PK_F,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', /* glsl */`
        float ph = aP.x * 6.2831853, w = aP.y;
        vec3 c = aOff;
        vec2 aCorner = position.xy;
        // slow looping wander (closed curves: nothing drifts off and pops back) plus a twitch now and then
        c += vec3(sin(uTime * 0.11 + ph) + 0.4 * sin(uTime * 0.29 + ph * 2.7), 0.45 * sin(uTime * 0.17 + ph * 1.9), cos(uTime * 0.13 + ph * 1.3) + 0.4 * cos(uTime * 0.23 + ph * 3.1)) * w;
        float tw = pow(max(0.0, sin(uTime * (0.7 + aP.w) + ph * 5.0)), 24.0);
        c.y += tw * 0.04;
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        float sz = aP.z;
        float minSz = 1.7 * max(0.1, -mvPosition.z) / (projectionMatrix[1][1] * 350.0);
        vK = sz < minSz ? pow(sz / minSz, 1.6) : 1.0;
        sz = max(sz, minSz);
        mvPosition.xy += aCorner * sz;
        gl_Position = projectionMatrix * mvPosition;
        vC = aCorner; vS = aP.w; vCam = length(mvPosition.xyz);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          float r = length(vC);
          if (r > 1.0) discard;
          float core = pow(1.0 - r, 1.8);
          vec3 vd = normalize(vWPos - cameraPosition);
          float fwd = pow(max(dot(vd, uSunDir), 0.0), 4.0);
          float dB = max(0.0, uSurfaceY - vWPos.y);
          vec3 sunL = uSunColor * uSunScatter * exp(-uLightSigma * dB) * (1.0 - 0.85 * uNight);
          vec3 tint = mix(vec3(0.95, 0.9, 0.62), vec3(0.75, 0.95, 0.8), fract(vS * 7.13));
          vec3 col = tint * (sunL * (0.4 + 2.0 * fwd) + uWaterUp * 0.3) + vec3(1.0, 0.94, 0.85) * uLamp * 0.5 / (1.0 + 0.05 * vCam * vCam);
          float camF = smoothstep(0.25, 1.2, vCam);
          diffuseColor.rgb = col * core * vK * camF * 1.3;
        }`);
    },
  });
}
// clouds: [{x, y, s, rx, ry, rz, n, size}] (global x, y, s). Particles concentrate toward each cloud's core.
export function planktonMesh(ctx, clouds, rng) { let r, it = planktonMeshG(ctx, clouds, rng); do r = it.next(); while (!r.done); return r.value; }
// generator form: yields after every ~2500 particles (a dense cloud of 4000 took ~8 ms in one go)
export function* planktonMeshG(ctx, clouds, rng) {
  let total = 0;
  for (const c of clouds) total += c.n;
  if (!total) return null;
  const off = new Float32Array(total * 3), ap = new Float32Array(total * 4);
  let q = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const cl of clouds) {
    const zc = -(cl.s - ctx.s0);
    for (let k = 0; k < cl.n; k++, q++) {
      // gaussian-ish core with a ragged edge: the sum of three uniforms per axis
      const gx = (rng() + rng() + rng() - 1.5) / 1.5, gy = (rng() + rng() + rng() - 1.5) / 1.5, gz = (rng() + rng() + rng() - 1.5) / 1.5;
      const x = cl.x + gx * cl.rx, y = Math.min(ctx.surfaceY - 0.3, cl.y + gy * cl.ry), z = zc + gz * cl.rz;
      off[q * 3] = x; off[q * 3 + 1] = y; off[q * 3 + 2] = z;
      ap[q * 4] = rng(); ap[q * 4 + 1] = 0.15 + rng() * 0.6; ap[q * 4 + 2] = cl.size * (0.5 + rng() * rng() * 1.6); ap[q * 4 + 3] = rng();
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      if (q % 4000 === 3999) yield;
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
  g.setAttribute('aP', new THREE.InstancedBufferAttribute(ap, 4));
  g.instanceCount = total;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 2);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(x0 - 2, y0 - 2, z0 - 2), new THREE.Vector3(x1 + 2, y1 + 2, z1 + 2));
  releaseAfterUpload(g);
  const m = new THREE.Mesh(g, NB4.mat.plankton);
  m.matrixAutoUpdate = false;
  m.renderOrder = 2;
  m.userData.lod = 'mid';
  return m;
}

// ---------------------------------------------------------------- twinkling sediment
// Dinoflagellates in the mud: tiny blue-green sparks that flare and fade at random, more and brighter where the
// camera passes close (the disturbance). A floor decal (nb_common.decalDisc vertices: aFx.x = alpha, aFx.y unused).
// 20 cells per metre; the cell hash reads the 256-texel noise texture at texel centres (period 12.8 m, which
// divides the 1024 m rebase). Far away the sparks blend to a faint mean glow before they would alias.
function sparkleMaterial() {
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  });
  return applyWater(m, {
    key: 'nb4-sparkle', additive: true, noLight: true,
    vertexHead: 'attribute vec2 aFx; varying vec2 vFx; uniform float uTime;', fragmentHead: 'varying vec2 vFx;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          vec2 q = vWPos.xz * 20.0;
          vec2 id = floor(q);
          vec4 h = texture2D(uNoiseTex, (mod(id, 256.0) + 0.5) / 256.0);
          vec4 h2 = texture2D(uNoiseTex, (mod(id + vec2(97.0, 41.0), 256.0) + 0.5) / 256.0);
          vec2 f = fract(q) - 0.5 - (h.yz - 0.5) * 0.6;
          float fw = length(fwidth(q));
          float near = 1.0 - smoothstep(1.5, 6.0, length(vWPos - cameraPosition));
          float on = step(0.45 - 0.15 * near, h2.r);                      // which grains can spark
          float tw = pow(max(0.0, sin(uTime * (0.9 + 2.2 * h2.g) + h.x * 61.0)), 8.0 - 5.0 * near);
          float dotS = (1.0 - smoothstep(0.03, 0.16, length(f))) * on * tw;
          float k = 1.0 - smoothstep(0.35, 0.9, fw);
          // the far field: a faint glow in drifts (2 m value noise, period 512 m), not an even sheet. An even mean
          // glow of 0.06-0.16 drew each patch as a smooth teal oval, like a spotlight on the mud.
          float drift = smoothstep(0.35, 0.85, texture2D(uNoiseTex, vWPos.xz / 512.0).g);
          float glow = mix((0.012 + 0.05 * near) * (0.25 + 0.75 * drift), dotS * (3.0 + 4.0 * near) + 0.01, k);
          vec3 c = mix(vec3(0.15, 0.55, 1.0), vec3(0.3, 1.0, 0.75), h2.b);
          diffuseColor.rgb = c * glow * vFx.x * (0.35 + 0.65 * max(uGlow, uNight));
        }`);
    },
  });
}

// ---------------------------------------------------------------- floating kelp canopy
// The matted fronds at the surface, seen from below: a sheet cut by alpha test into blade-shaped streaks that run
// along one world axis (the current's dominant one; the noise periods 8 m x 2 m divide the 1024 m rebase, which a
// rotated pattern would not). aFx.x = density, aFx.y = layer (0 top, 1 lower) + 2 * axis (0: along x, 1: along z).
// Thin edges glow golden against the sunlit surface. Transparent only so it casts no (uncut) shadow.
function canopyMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, transparent: true });
  return applyWater(m, {
    key: 'nb4-canopy', vertexHead: 'attribute vec2 aFx; varying vec2 vFx;', fragmentHead: 'varying vec2 vFx;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          float kcThin;
          {
            float layer = mod(vFx.y, 2.0), axis = step(1.5, vFx.y);
            vec2 q = vWPos.xz + vec2(layer * 3.0, layer * 1.5);
            vec2 qa = axis > 0.5 ? q.yx : q;
            vec4 n0 = texture2D(uNoiseTex, q / 32.0);
            vec4 n1 = texture2D(uNoiseTex, vec2(qa.x / 8.0, qa.y / 2.0));
            vec4 n2 = texture2D(uNoiseTex, vec2(qa.x / 4.0, qa.y));
            float fw = length(fwidth(q));
            float k2 = 1.0 - smoothstep(0.06, 0.3, fw);
            float weed = max(n1.a, mix(0.62, n2.a, k2) - 0.05);
            float cov = vFx.x * (0.55 + 0.7 * n0.r);
            float thr = max(0.55, 0.98 - 0.45 * cov) + layer * 0.05;
            if (weed < thr) discard;
            kcThin = 1.0 - smoothstep(0.0, 0.12, weed - thr);
            diffuseColor.rgb *= (0.72 + 0.5 * n2.g) * (0.85 + 0.3 * n1.r) * (1.0 - 0.25 * layer);
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          {
            vec3 vd = normalize(vWPos - cameraPosition);
            float sun = pow(max(dot(vd, uSunDir), 0.0), 3.0), up = smoothstep(-0.1, 0.55, vd.y);
            float dB = max(0.0, uSurfaceY - vWPos.y);
            vec3 warm = diffuseColor.rgb * vec3(1.15, 0.92, 0.62);
            totalEmissiveRadiance += warm * exp(-uLightSigma * dB) * uSunColor * uSunScatter * (0.1 + 0.8 * up + 1.2 * sun) * (0.45 + 0.8 * kcThin) * (1.0 - uNight) + diffuseColor.rgb * uLamp * 0.1;
          }`);
    },
  });
}

export function initNB4Materials() {
  if (NB4.mat.plankton) return NB4.mat;
  NB4.mat.plankton = planktonMaterial();
  NB4.mat.sparkle = sparkleMaterial();
  NB4.mat.canopy = canopyMaterial();
  return NB4.mat;
}
export { Batch, CHUNK };
