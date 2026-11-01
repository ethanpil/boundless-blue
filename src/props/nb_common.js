// Shared infrastructure for the new-biome props (mangrove, wall, softcoral, deepplain):
// own materials (translucent soft coral, glass lattice, bioluminescent glow, brine lake, floor decals),
// exact seating on any support surface, a cached flight-tube clearance test, staged merging with LOD tags,
// labels with facts, and per-populator stats.
import * as THREE from 'three';
import { TUBE, LENS, LOW_GAP, CHUNK, alignY, rotY, mul3, releaseAfterUpload } from './core.js';
import { applyWater } from '../water.js';

export const NBSTATS = { init: 0, pops: {} };
export const NBDBG = { audit: false, layouts: {} }; // the gap audit switches `audit` on and reads `layouts`

// ---------------------------------------------------------------- stats
export function statWrap(name, fn) {
  return (ctx) => {
    const t0 = performance.now();
    const r = fn(ctx);
    const dt = performance.now() - t0;
    const root = typeof window !== 'undefined' ? (window.__props || (window.__props = { init: 0, pops: {} })) : NBSTATS;
    const st = root.pops[name] || (root.pops[name] = { n: 0, ms: 0, max: 0, tris: 0, maxTris: 0, calls: 0 });
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

// ---------------------------------------------------------------- path cache + clearance
// pathX / pathY are noise sums (and pathY walks the biome weights), so tests that touch hundreds of
// points per chunk read them from a 0.5 m table instead (interpolation error < 1 mm).
const PCS = new WeakMap();
export function pathCache(ctx) {
  let c = PCS.get(ctx.group);
  if (c) return c;
  const a = ctx.s0 - 48, st = 0.5, n = Math.ceil((CHUNK + 96) / st) + 1;
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = ctx.pathX(a + i * st); Y[i] = ctx.pathY(a + i * st); }
  c = {
    x(s) { const u = (s - a) / st, i = Math.floor(u); if (i < 0 || i >= n - 1) return ctx.pathX(s); return X[i] + (X[i + 1] - X[i]) * (u - i); },
    y(s) { const u = (s - a) / st, i = Math.floor(u); if (i < 0 || i >= n - 1) return ctx.pathY(s); return Y[i] + (Y[i + 1] - Y[i]) * (u - i); },
    // signed lateral curvature (same as WorldShape.pathCurv)
    curv(s) { const e = 6; return (this.x(s + e) - 2 * this.x(s) + this.x(s - e)) / (e * e); },
  };
  PCS.set(ctx.group, c);
  return c;
}
export const SOLID = 0, SOFT = 1;
// Item spanning x +- r, s +- r, heights [yLo, yHi]. Solid: keep TUBE from the path line unless the whole
// item stays LOW_GAP below it. Soft (swaying): only the lens core stays clear. `tube` overrides the radius.
export function clearBox(pc, x, s, yLo, yHi, r, kind = SOLID, tube = 0) {
  const lim = tube || (kind === SOFT ? LENS + 0.1 : TUBE + 0.35);
  for (let k = -1; k <= 1; k++) {
    const ss = s + k * r, px = pc.x(ss), py = pc.y(ss);
    if (kind === SOLID && !tube && yHi <= py - LOW_GAP) continue;
    const dx = Math.max(0, Math.abs(x - px) - r);
    const dy = py < yLo ? yLo - py : py > yHi ? py - yHi : 0;
    if (dx * dx + dy * dy < lim * lim) return false;
  }
  return true;
}
// spine points [x, y, s, r, ...] (global): every point must be clear (or low enough under the path)
export function clearSpine(pc, pts, kind = SOLID, margin = 0.35) {
  const lim = (kind === SOFT ? LENS : TUBE) + margin;
  for (let i = 0; i < pts.length; i += 4) {
    const s = pts[i + 2], py = pc.y(s), r = pts[i + 3];
    if (kind === SOLID && pts[i + 1] + r <= py - LOW_GAP) continue;
    const dx = pts[i] - pc.x(s), dy = pts[i + 1] - py, d = Math.sqrt(dx * dx + dy * dy) - r;
    if (d < lim) return false;
  }
  return true;
}

// ---------------------------------------------------------------- exact floor-mesh sampler
// Reproduces the terrain mesh (1.5 m lateral grid, 42 rows per 64 m chunk, same triangle split) from
// ctx.floorAt at lattice nodes only. Nodes outside this chunk (items reaching into neighbours) are
// cached too. at(x, s) sets nx/ny/nz (normal of the facet, local frame z = -s).
const DXG = 1.5, NZG = 43, DZG = CHUNK / (NZG - 1);
const NBF = new WeakMap();
export function nbFloor(ctx) {
  let f = NBF.get(ctx.group);
  if (!f) { f = new NBFloor(ctx); NBF.set(ctx.group, f); }
  return f;
}
class NBFloor {
  constructor(ctx) {
    this.ctx = ctx; this.s0 = ctx.s0; this.k0 = Math.floor(ctx.xMin / DXG) - 8;
    this.W = Math.round((ctx.xMax - ctx.xMin) / DXG) + 17; this.J0 = -12; this.H = NZG + 24;
    this.h = new Float32Array(this.W * this.H).fill(NaN); this.far = new Map();
    this.nx = 0; this.ny = 1; this.nz = 0;
  }
  node(i, j) {
    const a = i - this.k0, b = j - this.J0;
    if (a >= 0 && b >= 0 && a < this.W && b < this.H) {
      const o = b * this.W + a;
      let v = this.h[o];
      if (v !== v) { v = this.ctx.floorAt(i * DXG, this.s0 + j * DZG); this.h[o] = v; }
      return v;
    }
    const k = i * 4096 + j;
    let v = this.far.get(k);
    if (v === undefined) { v = this.ctx.floorAt(i * DXG, this.s0 + j * DZG); this.far.set(k, v); }
    return v;
  }
  at(x, s) {
    const u = x / DXG, v = (s - this.s0) / DZG, i = Math.floor(u), jr = Math.floor(v);
    // rows of other chunks: the lattice restarts at every chunk boundary (same spacing, so same rows)
    const j = jr, fu = u - i, fv = v - jr;
    const ha = this.node(i, j), hb = this.node(i + 1, j), hc = this.node(i, j + 1), hd = this.node(i + 1, j + 1);
    let h, gx, gs;
    if (fu + fv <= 1) { h = ha + (hb - ha) * fu + (hc - ha) * fv; gx = (hb - ha) / DXG; gs = (hc - ha) / DZG; }
    else { h = hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv); gx = (hd - hc) / DXG; gs = (hd - hb) / DZG; }
    const l = Math.sqrt(gx * gx + 1 + gs * gs);
    this.nx = -gx / l; this.ny = 1 / l; this.nz = gs / l;
    return h;
  }
}

// biome segment record of `key` at s (or the nearest one in the chunk)
export function segFor(ctx, s, key) {
  let best = null;
  for (const g of ctx.segments) if (g.key === key) { if (s >= g.start && s < g.end) return g; best = best || g; }
  return best;
}
// per-segment "community recipe", cached by seed
const RECIPES = new Map();
export function recipe(g, key, make) {
  const id = key + ':' + (g ? g.seed : 0);
  let r = RECIPES.get(id);
  if (!r) { r = make(g); RECIPES.set(id, r); if (RECIPES.size > 64) RECIPES.delete(RECIPES.keys().next().value); }
  return r;
}
// density factor for small (near / mid LOD) detail on weak GPUs
export const lowK = (ctx) => (ctx.tier === 'low' ? 0.6 : 1);

// ---------------------------------------------------------------- template helpers
// Base points: the template's lowest vertices (the part that must touch its support), farthest-point
// sampled. Builders may set tpl._nbBase explicitly (e.g. the attached back edge of a shelf).
export function basePts(tpl, max = 12) {
  if (tpl._nbBase) return tpl._nbBase;
  const P = tpl.pos, h = tpl.maxY - tpl.minY, tol = Math.max(0.004, Math.min(0.05, h * 0.03));
  const cand = [];
  for (let i = 0; i < tpl.vc; i++) if (P[i * 3 + 1] <= tpl.minY + tol) cand.push(i);
  const out = [cand[0]], dmin = cand.map((i) => Math.hypot(P[i * 3] - P[cand[0] * 3], P[i * 3 + 2] - P[cand[0] * 3 + 2]));
  while (out.length < max) {
    let bi = -1, bd = 0.01;
    for (let k = 0; k < cand.length; k++) if (dmin[k] > bd) { bd = dmin[k]; bi = k; }
    if (bi < 0) break;
    const q = cand[bi];
    out.push(q);
    for (let k = 0; k < cand.length; k++) { const i = cand[k]; dmin[k] = Math.min(dmin[k], Math.hypot(P[i * 3] - P[q * 3], P[i * 3 + 2] - P[q * 3 + 2])); }
  }
  const B = new Float32Array(out.length * 3);
  out.forEach((i, k) => { B[k * 3] = P[i * 3]; B[k * 3 + 1] = P[i * 3 + 1]; B[k * 3 + 2] = P[i * 3 + 2]; });
  tpl._nbBase = B;
  let r = 0; for (let k = 0; k < B.length; k += 3) r = Math.max(r, Math.hypot(B[k], B[k + 2]));
  tpl._nbBaseR = r;
  return B;
}
export function setBase(tpl, pts) { tpl._nbBase = Float32Array.from(pts); let r = 0; for (let k = 0; k < pts.length; k += 3) r = Math.max(r, Math.hypot(pts[k], pts[k + 2])); tpl._nbBaseR = r; return tpl; }
export function lab(tpl, name, fact) { for (const t of Array.isArray(tpl) ? tpl : [tpl]) { t.label = name; t.fact = fact || null; } return tpl; }

// Move a placed template along direction m (local frame, z = -s; null = vertical) until every base
// point sits `embed` m below the support (vertical measure). sup.at(x, s) -> support height, and sets
// sup.nx/ny/nz (support normal at that point). P = [x, y, s] anchor (modified in place).
export function seat(sup, tpl, R, sx, sy, sz, P, m = null, embed = 0.02) {
  const B = basePts(tpl);
  let x = P[0], y = P[1], s = P[2];
  for (let it = 0; it < 5; it++) {
    let gmax = -1e9;
    for (let i = 0; i < B.length; i += 3) {
      const lx = B[i] * sx, ly = B[i + 1] * sy, lz = B[i + 2] * sz;
      const ox = R[0] * lx + R[1] * ly + R[2] * lz, oy = R[3] * lx + R[4] * ly + R[5] * lz, oz = R[6] * lx + R[7] * ly + R[8] * lz;
      const g = y + oy - sup.at(x + ox, s - oz);
      if (g > gmax) gmax = g;
    }
    const d = gmax + embed;
    if (Math.abs(d) < 0.002) break;
    if (!m || it >= 3) { y -= d; continue; } // vertical: exact for every base point
    sup.at(x, s);
    const rate = (m[0] * sup.nx + m[1] * sup.ny + m[2] * sup.nz) / Math.max(0.05, sup.ny);
    if (rate < 0.25) { y -= d; continue; }
    const del = Math.max(-3, Math.min(3, -d / rate));
    x += m[0] * del; y += m[1] * del; s -= m[2] * del;
  }
  P[0] = x; P[1] = y; P[2] = s;
  return P;
}
// world offset of template-local point p for transform (R, S)
export function xf(R, sx, sy, sz, px, py, pz) {
  const lx = px * sx, ly = py * sy, lz = pz * sz;
  return [R[0] * lx + R[1] * ly + R[2] * lz, R[3] * lx + R[4] * ly + R[5] * lz, R[6] * lx + R[7] * ly + R[8] * lz];
}
// world normal of template-local normal n for transform (R, S)
export function xfn(R, sx, sy, sz, nx, ny, nz) {
  const a = nx / sx, b = ny / sy, c = nz / sz;
  const x = R[0] * a + R[1] * b + R[2] * c, y = R[3] * a + R[4] * b + R[5] * c, z = R[6] * a + R[7] * b + R[8] * c;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
// rotation: local +Y to n, then yaw about it
export const upTo = (n, yaw) => mul3(alignY(n[0], n[1], n[2]), rotY(yaw));
export const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const mix3 = (a, b, t) => nrm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);

// Exact vertical ray against a template's triangles (template space). top: highest hit, else lowest.
export function surfGrid(tpl, cell = 0.12) {
  if (tpl._nbSG) return tpl._nbSG;
  const [x0, , z0, x1, , z1] = tpl.box, nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const cells = Array.from({ length: nx * nz }, () => []);
  const P = tpl.pos, I = tpl.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const i0 = Math.floor((Math.min(P[a], P[b], P[c]) - x0) / cell), i1 = Math.floor((Math.max(P[a], P[b], P[c]) - x0) / cell);
    const j0 = Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z0) / cell), j1 = Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z0) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * nx + i].push(t);
  }
  tpl._nbSG = { x0, z0, cell, nx, nz, cells };
  return tpl._nbSG;
}
export function rayY(tpl, x, z, top = true) {
  const G = surfGrid(tpl), i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
  if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return NaN;
  const P = tpl.pos, I = tpl.idx;
  let best = NaN;
  for (const t of G.cells[j * G.nx + i]) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a], az = P[a + 2], e1x = P[b] - ax, e1z = P[b + 2] - az, e2x = P[c] - ax, e2z = P[c + 2] - az;
    const det = e1x * e2z - e2x * e1z;
    if (Math.abs(det) < 1e-12) continue;
    const u = ((x - ax) * e2z - e2x * (z - az)) / det, v = (e1x * (z - az) - (x - ax) * e1z) / det;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    const y = P[a + 1] + u * (P[b + 1] - P[a + 1]) + v * (P[c + 1] - P[a + 1]);
    if (best !== best || (top ? y > best : y < best)) best = y;
  }
  return best;
}
// Support surface of a placed item (yaw-only rotation R): top or underside of its mesh, else `fallback`.
export function itemSupport(tpl, x, y, s, R, sx, sy, sz, top, fallback) {
  const c = R[0], sn = R[2];
  return {
    nx: 0, ny: top ? 1 : -1, nz: 0, miss: 0,
    at(qx, qs) {
      const ox = qx - x, oz = -(qs - s);
      const px = (c * ox - sn * oz) / sx, pz = (sn * ox + c * oz) / sz; // R^T for rotY
      const h = rayY(tpl, px, pz, top);
      if (h !== h) { this.miss++; return fallback ? fallback.at(qx, qs) : (top ? -1e9 : 1e9); }
      return y + h * sy;
    },
  };
}

// ---------------------------------------------------------------- placement into batches
// Adds tpl at global (x, y, s); records the support for the gap audit when enabled.
export function put(ctx, batch, tpl, x, y, s, R, sx, sy, sz, col, fa = 1, sup = 'floor') {
  if (!batch.add(tpl, x, y, -(s - ctx.s0), R, sx, sy, sz, col[0], col[1], col[2], fa)) return false;
  if (NBDBG.audit) batch.items[batch.items.length - 1].nb = sup;
  return true;
}

// ---------------------------------------------------------------- labels & obstacles
const MAX_OBS = 400;
export function registerNB(ctx, batches, extraLabels, maxLabels = 45) {
  const obs = [], labels = [];
  for (const b of batches) {
    if (!b || !b.items) continue;
    for (const it of b.items) {
      const t = it.tpl, bx = t.box;
      const size = Math.max((bx[3] - bx[0]) * it.sx, (bx[4] - bx[1]) * it.sy, (bx[5] - bx[2]) * it.sz);
      const R = it.R, tf = (x, y, z) => {
        const px = x * it.sx, py = y * it.sy, pz = z * it.sz;
        return [R[0] * px + R[1] * py + R[2] * pz + it.x, R[3] * px + R[4] * py + R[5] * pz + it.y, ctx.s0 - (R[6] * px + R[7] * py + R[8] * pz + it.z)];
      };
      const name = it.lbl || t.label;
      if (name && size > 0.15 && !it.noLabel) labels.push([size * (t.fact ? 1.5 : 1) * (it.lbl ? 3 : 1), name, tf((bx[0] + bx[3]) / 2, (bx[1] + bx[4]) / 2, (bx[2] + bx[5]) / 2), t.fact]);
      // no obstacles for soft things, ground cover (draped patches) or anything lower than a hand
      if (b.soft || !t.solid || size < 0.4 || t.drape || it.drape || (bx[4] - bx[1]) * it.sy < 0.2) continue;
      if (t.obs) { // authored capsules (arches, roots, logs...): used as drawn
        for (const o of t.obs) {
          const vert = Math.abs(o[1] - o[4]) > Math.abs(o[0] - o[3]) + Math.abs(o[2] - o[5]);
          const k = vert ? Math.max(it.sx, it.sz) : Math.max(it.sx, it.sy, it.sz);
          obs.push([o[6] * k * 1.08 + 0.1, tf(o[0], o[1], o[2]), tf(o[3], o[4], o[5])]);
        }
        continue;
      }
      // (the bounding-box fit of Template.obstacles() makes a wide, flat item a ball as tall as it is wide:
      // a 5 m mat 0.3 m high became a 2.5 m sphere poking up into the flight tube; fit the real shape instead)
      if (size < 1.5) { // small: one capsule along the longest scaled axis of the box
        const e = [(bx[3] - bx[0]) * it.sx, (bx[4] - bx[1]) * it.sy, (bx[5] - bx[2]) * it.sz], c = [(bx[0] + bx[3]) / 2, (bx[1] + bx[4]) / 2, (bx[2] + bx[5]) / 2];
        const ax = e[0] >= e[1] && e[0] >= e[2] ? 0 : e[1] >= e[2] ? 1 : 2, r = Math.hypot(e[(ax + 1) % 3], e[(ax + 2) % 3]) / 2, half = Math.max(0, e[ax] / 2 - r * 0.7);
        const A = [c[0], c[1], c[2]], E = [c[0], c[1], c[2]], sc = [it.sx, it.sy, it.sz];
        A[ax] -= half / sc[ax]; E[ax] += half / sc[ax];
        obs.push([r * 0.9 + 0.05, tf(A[0], A[1], A[2]), tf(E[0], E[1], E[2])]);
        continue;
      }
      // big: a capsule chain fitted to the mesh at this item's (possibly non-uniform) scale (core.js capsules())
      const ry = it.sy / it.sx, rz = it.sz / it.sx, F = t.capsules(ry, rz, 6), cy = ry / F.fy, cz = rz / F.fz, kr = Math.max(1, cy, cz) * it.sx;
      const tc = (x, y, z) => {
        const px = x * it.sx, py = y * cy * it.sx, pz = z * cz * it.sx;
        return [R[0] * px + R[1] * py + R[2] * pz + it.x, R[3] * px + R[4] * py + R[5] * pz + it.y, ctx.s0 - (R[6] * px + R[7] * py + R[8] * pz + it.z)];
      };
      for (const o of F.list) obs.push([o[6] * kr * 1.03 + 0.05, tc(o[0], o[1], o[2]), tc(o[3], o[4], o[5])]);
    }
  }
  if (ctx.addObstacle) {
    obs.sort((p, q) => q[0] - p[0]);
    const n = Math.max(0, Math.min(MAX_OBS - (ctx._nbObs || 0), obs.length));
    for (let i = 0; i < n; i++) { const [r, a, e] = obs[i]; ctx.addObstacle(a[0], a[1], a[2], e[0], e[1], e[2], r); }
    ctx._nbObs = (ctx._nbObs || 0) + n;
  }
  if (ctx.addLabel) {
    // the same species is labelled at most a few times per chunk; the biggest specimens win
    labels.sort((p, q) => q[0] - p[0]);
    const per = {}, room = Math.max(0, maxLabels - (ctx._nbLbl || 0));
    let n = 0;
    for (const l of extraLabels || []) { if (n >= room) break; ctx.addLabel(l[0], l[1], l[2], l[3], l[4]); n++; }
    for (const [, name, c, fact] of labels) {
      if (n >= room) break;
      if ((per[name] = (per[name] || 0) + 1) > 3) continue;
      ctx.addLabel(name, c[0], c[1], c[2], fact || undefined); n++;
    }
    ctx._nbLbl = (ctx._nbLbl || 0) + n;
  }
}

// ---------------------------------------------------------------- staged merging
// layout(ctx) -> { batches, extra (ready meshes), labels, pois } or null. A layout may be a generator
// that yields whenever its stage has used its time slice (see slice()); it is resumed in the next
// populator slot. Then each later slot merges one <= 15k-vertex slice of every batch. Batches may carry
// .lod ('near' | 'mid') which is copied to their meshes.
const VERTS_PER_STAGE = 15000;
export const slice = (ms = 3.0) => { let t0 = performance.now(); return { over: () => performance.now() - t0 > ms, reset: () => { t0 = performance.now(); } }; };
export function runLayout(layout, ctx) { // drain a (possibly generator) layout synchronously
  const r = layout(ctx);
  if (!r || typeof r.next !== 'function') return r;
  let v; do v = r.next(); while (!v.done);
  return v.value;
}
export function stagedNB(layout, nBuild = 8) {
  const cache = new WeakMap();
  const finalize = (ctx, L) => {
    L.jobs = []; L.j = 0;
    for (const b of L.batches) {
      if (!b || !b.items.length) continue;
      const n = Math.max(1, Math.ceil(b.vc / VERTS_PER_STAGE));
      for (let k = 0; k < n; k++) L.jobs.push([b, k, n]);
    }
    cache.set(ctx.group, L);
    registerNB(ctx, L.batches, L.labels);
    if (L.pois && ctx.addPOI) for (const p of L.pois) ctx.addPOI(p.type, p.x, p.y, p.s, p.r, p.data);
    return L.extra && L.extra.length ? L.extra : [];
  };
  const buildJobs = (st, last) => {
    const jobs = last ? st.jobs.slice(st.j) : [st.jobs[st.j]];
    st.j += jobs.length;
    return jobs.map(([b, i, n]) => {
      const m = b.build(i, n, b.pad ?? 1);
      if (m && b.lod) m.userData.lod = b.lod;
      if (m && b.order) m.renderOrder = b.order;
      return m;
    });
  };
  const step = (ctx, last) => {
    const st = cache.get(ctx.group);
    if (!st) return null;
    if (st.gen) { // resume the layout (the last slot finishes it outright)
      let v = st.gen.next();
      if (last) while (!v.done) v = st.gen.next();
      if (!v.done) return null;
      if (!v.value) { cache.delete(ctx.group); return null; }
      const extra = finalize(ctx, v.value);
      if (!last) return finishNB(extra);
      const L = cache.get(ctx.group);
      cache.delete(ctx.group);
      return finishNB([...extra, ...buildJobs(L, true)]);
    }
    if (st.j >= st.jobs.length) { cache.delete(ctx.group); return null; }
    const parts = buildJobs(st, last);
    if (st.j >= st.jobs.length) cache.delete(ctx.group);
    return finishNB(parts);
  };
  const pops = [(ctx) => {
    const r = layout(ctx);
    if (!r) return null;
    if (typeof r.next === 'function') { cache.set(ctx.group, { gen: r }); return step(ctx, false); }
    return finishNB(finalize(ctx, r));
  }];
  for (let k = 0; k < nBuild; k++) pops.push((ctx) => step(ctx, k === nBuild - 1));
  return pops;
}
export function finishNB(parts) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  const meshes = parts.filter(Boolean);
  for (const m of meshes) g.add(m);
  if (!meshes.length) return null;
  return { object: g, dispose() { for (const m of meshes) m.geometry.dispose(); } };
}
// Mesh from a per-chunk Builder (decals, brine lakes); extra float attributes: { name: [array, itemSize] }
export function builderMesh(b, mat, extra = null, lod = null) {
  if (!b.I.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(b.P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(b.N), 3));
  g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(b.C), 3));
  g.setAttribute('aFx', new THREE.BufferAttribute(Float32Array.from(b.F), 2));
  if (extra) for (const k in extra) g.setAttribute(k, new THREE.BufferAttribute(Float32Array.from(extra[k][0]), extra[k][1]));
  g.setIndex(new THREE.BufferAttribute(b.vc > 65535 ? Uint32Array.from(b.I) : Uint16Array.from(b.I), 1));
  g.computeBoundingSphere();
  releaseAfterUpload(g);
  const m = new THREE.Mesh(g, mat);
  m.matrixAutoUpdate = false;
  if (lod) m.userData.lod = lod;
  return m;
}
// Conforming floor decal: polar disc (or ellipse) sampled on the exact floor mesh. alpha in aFx.x, mode in aFx.y.
export function decalDisc(b, fs, ctx, x, s, rx, rz, yaw, col, mode, alpha = 1, rings = 6, segs = 22) {
  const c = Math.cos(yaw), sn = Math.sin(yaw), v0 = b.vc;
  for (let j = 0; j <= rings; j++) for (let i = 0; i < (j ? segs : 1); i++) {
    const t = j / rings, a = (i / segs) * Math.PI * 2;
    const lx = Math.cos(a) * rx * t, lz = Math.sin(a) * rz * t;
    const gx = x + c * lx - sn * lz, gs = s + sn * lx + c * lz;
    const y = fs.at(gx, gs);
    b.v(gx, y, -(gs - ctx.s0), fs.nx, fs.ny, fs.nz, col[0], col[1], col[2], alpha * (1 - t * t * t), mode);
  }
  for (let i = 0; i < segs; i++) b.t(v0, v0 + 1 + i, v0 + 1 + ((i + 1) % segs));
  for (let j = 1; j < rings; j++) {
    const r0 = v0 + 1 + (j - 1) * segs, r1 = r0 + segs;
    for (let i = 0; i < segs; i++) { const i1 = (i + 1) % segs; b.t(r0 + i, r1 + i, r1 + i1); b.t(r0 + i, r1 + i1, r0 + i1); }
  }
}
// Ribbon decal along a polyline of global [x, s] points (tracks, grooves); width w.
export function decalRibbon(b, fs, ctx, pts, w, col, mode, alpha = 1) {
  const v0 = b.vc, n = pts.length / 2;
  for (let k = 0; k < n; k++) {
    const i0 = Math.max(0, k - 1) * 2, i1 = Math.min(n - 1, k + 1) * 2;
    let tx = pts[i1] - pts[i0], ts = pts[i1 + 1] - pts[i0 + 1];
    const l = Math.hypot(tx, ts) || 1; tx /= l; ts /= l;
    const fade = Math.min(1, k / 3, (n - 1 - k) / 3);
    for (const side of [-1, 0, 1]) {
      const gx = pts[k * 2] - ts * w * side, gs = pts[k * 2 + 1] + tx * w * side;
      const y = fs.at(gx, gs);
      b.v(gx, y, -(gs - ctx.s0), fs.nx, fs.ny, fs.nz, col[0], col[1], col[2], alpha * fade * (side ? 0.15 : 1), mode);
    }
  }
  for (let k = 0; k < n - 1; k++) {
    const a = v0 + k * 3, c = a + 3;
    for (let q = 0; q < 2; q++) { b.t(a + q, c + q, c + q + 1); b.t(a + q, c + q + 1, a + q + 1); }
  }
}

// ---------------------------------------------------------------- materials
const V_HEAD = /* glsl */`
attribute vec2 aFx;
varying vec2 vFx;
uniform float uTime;
`;
// gentle sway; spatial frequencies are 2*pi*n/1024 so floating-origin rebases stay seamless
const SWAY = /* glsl */`
vec3 nbSway(vec3 wq, float w) {
  if (w <= 0.0) return vec3(0.0);
  float ph = dot(wq.xz, vec2(0.2454369, 0.1963495));
  return vec3(sin(uTime * 0.8 + ph), 0.0, 0.6 * sin(uTime * 0.63 + ph * 1.3 + 1.0)) * w;
}
`;
const SWAY_PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition.xyz += nbSway( ( modelMatrix * mvPosition ).xyz, aFx.x );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
const F_HEAD = /* glsl */`
varying vec2 vFx;
vec3 nbTriW(vec3 n) { vec3 w = n * n; w *= w; return w / (w.x + w.y + w.z + 1e-5); }
vec4 nbTri(vec3 p, vec3 w, float P) {
  return texture2D(uNoiseTex, p.yz / P) * w.x + texture2D(uNoiseTex, p.xz / P) * w.y + texture2D(uNoiseTex, p.xy / P) * w.z;
}
`;
const PASS_FX = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;'); };

// Translucent tree soft coral (Dendronephthya): aFx.x = sway (m), aFx.y = 0 polyp bundles, 1 stalk/branches.
// Backlit by the sun it glows; pale stalks show white sclerite speckles.
function softMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
  return applyWater(m, {
    key: 'nb-softcoral', vertexHead: V_HEAD + SWAY, fragmentHead: F_HEAD,
    patch(sh) {
      PASS_FX(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', SWAY_PROJECT);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          {
            vec3 pN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            vec3 pW = nbTriW(pN);
            vec4 pA = nbTri(vWPos, pW, 0.5);
            vec4 pB = nbTri(vWPos, pW, 2.0);
            float stalk = step(0.5, vFx.y);
            float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
            vec3 st = mix(diffuseColor.rgb, vec3(lum) * 1.3 + 0.16, 0.6); // pale, so the stalk survives the haze
            float scl = smoothstep(0.6, 0.78, nbTri(vWPos, pW, 0.25).b);
            st = mix(st, vec3(0.95, 0.9, 0.92), scl * 0.5);
            vec3 po = diffuseColor.rgb * (0.65 + 0.7 * smoothstep(0.3, 0.75, pA.a));
            diffuseColor.rgb = mix(po, st, stalk) * (0.85 + 0.3 * pB.g);
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          {
            vec3 vd = normalize(vWPos - cameraPosition);
            vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            float back = pow(max(dot(vd, uSunDir), 0.0), 2.0);
            float rim = pow(1.0 - abs(dot(wN, vd)), 2.0);
            float dB = max(0.0, uSurfaceY - vWPos.y);
            vec3 Tl = exp(-uLightSigma * dB) * skyVis(vWPos);
            float k = mix(1.0, 0.75, step(0.5, vFx.y));
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * uSunScatter * Tl * (0.16 + 0.45 * rim + 1.5 * back) * k;
            totalEmissiveRadiance += diffuseColor.rgb * uLamp * 0.2 * (0.4 + rim);
          }`);
    },
  });
}

// Bioluminescent life: aFx.x = glow amount. Glows in the deep (uGlow) and at night, with a slow pulse.
function glowMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  return applyWater(m, {
    key: 'nb-glow', vertexHead: V_HEAD + SWAY, fragmentHead: F_HEAD,
    patch(sh) {
      PASS_FX(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          { vec3 pN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz); vec4 pA = nbTri(vWPos, nbTriW(pN), 1.0); diffuseColor.rgb *= 0.75 + 0.5 * pA.g; }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          {
            float gk = max(uNight, uGlow);
            float ph = texture2D(uNoiseTex, vWPos.xz / 16.0).r * 18.0;
            float pulse = 0.55 + 0.45 * sin(uTime * 0.9 + ph);
            vec3 tint = diffuseColor.rgb / max(0.05, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
            totalEmissiveRadiance += mix(vec3(0.15, 0.6, 1.0), tint, 0.35) * vFx.x * gk * pulse * 0.55;
          }`);
    },
  });
}

// Glass sponge lattice: aFx = lattice coordinates (cells); aFx.y < 0 marks solid parts.
function glassMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0, side: THREE.DoubleSide });
  return applyWater(m, {
    key: 'nb-glass', vertexHead: V_HEAD, fragmentHead: F_HEAD,
    patch(sh) {
      PASS_FX(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          if (vFx.y >= 0.0) {
            vec2 q = vFx;
            vec2 f = abs(fract(q) - 0.5);
            vec2 g = abs(fract(vec2(q.x + q.y, q.x - q.y) * 0.5) - 0.5);
            float fw = fwidth(q.x) + fwidth(q.y);
            float w = clamp(fw * 0.9, 0.06, 0.45);
            float grid = smoothstep(0.5 - w - 0.04, 0.5 - w * 0.4, max(f.x, f.y));
            float diag = smoothstep(0.5 - w * 0.6 - 0.03, 0.5 - w * 0.25, max(g.x, g.y));
            float line = max(grid, diag * 0.85);
            if (fw < 0.8 && line < 0.5) discard;
            diffuseColor.rgb *= mix(0.7, 1.1, line);
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * (uLamp * 0.05 + uNight * 0.02);`);
    },
  });
}

// Brine lake surface: a dark, metallic mirror lying on the seafloor. Near-black teal body; it reflects a
// dim mirrored gradient of the lamp-lit seabed and the black water above; the camera lamps (view space
// +-0.8 m, aimed forward, as in water.js) leave a crisp sheen; slow waves roll across it; a thin bright
// rim of disturbed brine marks the shore, where the brine thins and turns slightly translucent.
// aDepth = brine depth at each vertex (0 at the shore, negative beyond it).
function brineMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.004, 0.008, 0.011), roughness: 0.9, metalness: 0, transparent: true });
  return applyWater(m, {
    key: 'nb-brine', noLight: true, vertexHead: 'attribute float aDepth; varying float vDepth;', fragmentHead: 'varying float vDepth;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvDepth = aDepth;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <normal_fragment_maps>', /* glsl */`
          #include <normal_fragment_maps>
          vec3 bN;
          {
            // slow, long brine waves (wavelengths divide 1024 m) plus faint fine ripples
            vec2 q = vWPos.xz;
            float p1 = dot(q, vec2(0.9817477, 0.3926991)) - uTime * 0.35;
            float p2 = dot(q, vec2(-0.4908739, 1.1780972)) - uTime * 0.27;
            vec3 g = vec3(0.9817477, 0.0, 0.3926991) * cos(p1) * 0.03 + vec3(-0.4908739, 0.0, 1.1780972) * cos(p2) * 0.022;
            vec2 o1 = vec2(uTime * 0.006, uTime * 0.004);
            float e = 0.1, h0 = texture2D(uNoiseTex, q / 8.0 + o1).r;
            g += vec3(texture2D(uNoiseTex, (q + vec2(e, 0.0)) / 8.0 + o1).r - h0, 0.0, texture2D(uNoiseTex, (q + vec2(0.0, e)) / 8.0 + o1).r - h0) / e * 0.02;
            bN = normalize(vec3(0.0, 1.0, 0.0) - g);
            normal = normalize(mat3(viewMatrix) * bN);
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          {
            vec3 vd = normalize(vWPos - cameraPosition);
            vec3 Rr = reflect(vd, bN);
            float cosT = max(dot(-vd, bN), 0.0);
            float F = 0.04 + 0.96 * pow(1.0 - cosT, 4.0);
            float dist = length(vWPos - cameraPosition);
            // what the mirror shows: a dim band of lamp-lit seabed near its horizon, black water above
            float lampK = uLamp / (1.0 + 0.005 * dist * dist);
            float band = 1.0 - smoothstep(0.02, 0.45, Rr.y);
            vec3 env = waterColor(Rr) * 1.5 + vec3(0.11, 0.14, 0.15) * lampK * band;
            vec3 col = env * F * vec3(0.7, 0.95, 1.05);
            // crisp sheen from the two lamps beside the camera
            vec3 Vv = normalize(vViewPosition);
            for (int k = 0; k < 2; k++) {
              vec3 lp = vec3(k == 0 ? -0.8 : 0.8, -0.3, 0.0);
              vec3 toL = lp + vViewPosition;
              float d = length(toL);
              vec3 L = toL / d;
              float cone = smoothstep(0.55, 0.92, dot(-L, normalize(vec3(-lp.x * 0.04, 0.02, -1.0))));
              vec3 irr = vec3(1.0, 0.93, 0.82) * uLamp * 14.0 * cone * exp(-uSigma * d) / (1.0 + 0.04 * d * d);
              vec3 H = normalize(L + Vv);
              float nh = max(dot(normal, H), 0.0);
              col += irr * (pow(nh, 300.0) * 1.4 + pow(nh, 90.0) * 0.05) * (0.3 + F);
            }
            // thin bright rim of disturbed brine at the shoreline, with a faint milky fringe
            float rim = 1.0 - smoothstep(0.0, 0.035, vDepth);
            float fringe = (1.0 - smoothstep(0.03, 0.25, vDepth)) * 0.25;
            col += vec3(0.55, 0.6, 0.6) * (rim + fringe) * (0.02 + 0.35 * lampK);
            totalEmissiveRadiance += col;
            diffuseColor.a = max(smoothstep(0.0, 0.2, vDepth) * 0.45 + 0.55, rim);
          }`);
    },
  });
}

// Floor decals (sandy light patches, feeding tracks, microbial mats, dark sulfide halos).
// aFx.x = alpha, aFx.y = mode (0 sand, 1 track, 2 microbial mat, 3 stain).
function decalMaterial() {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  return applyWater(m, {
    key: 'nb-decal', vertexHead: V_HEAD, fragmentHead: F_HEAD,
    patch(sh) {
      PASS_FX(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        {
          vec4 n = texture2D(uNoiseTex, vWPos.xz / 4.0);
          vec4 n2 = texture2D(uNoiseTex, vWPos.xz / 0.5);
          float a = vFx.x;
          if (vFx.y < 0.5) {
            a = smoothstep(0.12, 0.7, a + (n.r - 0.5) * 0.7);
            diffuseColor.rgb *= 0.85 + 0.3 * n2.g;
          } else if (vFx.y < 1.5) {
            a *= 0.55 + 0.6 * n2.r;
          } else if (vFx.y < 2.5) {
            a *= smoothstep(0.5, 0.7, n.g * 0.6 + n2.b * 0.5 + a * 0.2);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.42, 0.1), smoothstep(0.55, 0.75, n.b) * 0.75);
          } else {
            a = smoothstep(0.0, 0.8, a + (n.r - 0.5) * 0.5);
          }
          diffuseColor.a *= clamp(a, 0.0, 1.0);
        }`);
    },
  });
}

export const NBMAT = {};
export function initNBMaterials() {
  if (NBMAT.soft) return NBMAT;
  NBMAT.soft = softMaterial();
  NBMAT.glow = glowMaterial();
  NBMAT.glass = glassMaterial();
  NBMAT.brine = brineMaterial();
  NBMAT.decal = decalMaterial();
  return NBMAT;
}
