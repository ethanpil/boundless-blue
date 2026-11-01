// Sunken-city construction kit. Buildings are generated per placement (every one is unique) in a local
// frame: x along the street, z toward the street (the front), y up from the site's reference height.
// Everything is fitted to the terrain under the site (site.fl), so walls follow the slope, buried courses
// are skipped and nothing floats. Walls are coursed masonry with doors, windows, arches and corbel vaults,
// decay (a ruined top profile), physically consistent collapse (blocks need support) and fallen blocks.
// Obstacle capsules are authored as the parts are built (tight around walls, roofs, columns).
import { Builder, Template, T, TAU, vn3, sat, sstep, lerp, rotY, rotX, rotZ, mul3 } from './core.js';
import { mulberry32 } from '../noise.js';

export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const SILT = [0.58, 0.53, 0.42];
const GROW_C = [[0.62, 0.32, 0.42], [0.3, 0.36, 0.17], [0.66, 0.46, 0.2]]; // coralline pink, turf algae, sponge ochre
export const GOLD_MODE = 7;

// ---------- box topology: 24 vertices (4 per face); plain boxes use the face quads, chamfered boxes add
// the 12 edge bevels and 8 corner triangles (normals per face, so bevels shade as softly rounded edges)
const BOX = (() => {
  const sg = [], fa = [];
  for (let k = 0; k < 24; k++) {
    const f = k >> 2, a = f >> 1, q = k & 3, u = (a + 1) % 3, v = (a + 2) % 3, s = [0, 0, 0];
    s[a] = f & 1 ? 1 : -1; s[u] = q & 1 ? 1 : -1; s[v] = q & 2 ? 1 : -1;
    sg.push(s); fa.push(a);
  }
  const pos = sg.map((s, k) => s.map((x, i) => (i === fa[k] ? x : x * 0.7)));
  const tri = [], flat = [];
  const add = (L, a, b, c) => { // outward winding (convex solid around the origin)
    const A = pos[a], B = pos[b], C = pos[c];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const d = n[0] * (A[0] + B[0] + C[0]) + n[1] * (A[1] + B[1] + C[1]) + n[2] * (A[2] + B[2] + C[2]);
    if (d < 0) L.push(a, c, b); else L.push(a, b, c);
  };
  for (let f = 0; f < 6; f++) { const k = f * 4; for (const L of [tri, flat]) { add(L, k, k + 1, k + 3); add(L, k, k + 3, k + 2); } }
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const c = 3 - a - b, A = [], B = [];
    for (let k = 0; k < 24; k++) {
      if (fa[k] === a && sg[k][a] === sa && sg[k][b] === sb) A[sg[k][c] > 0 ? 1 : 0] = k;
      if (fa[k] === b && sg[k][b] === sb && sg[k][a] === sa) B[sg[k][c] > 0 ? 1 : 0] = k;
    }
    add(tri, A[0], A[1], B[1]); add(tri, A[0], B[1], B[0]);
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const t = [];
    for (let k = 0; k < 24; k++) if (sg[k][0] === sx && sg[k][1] === sy && sg[k][2] === sz) t.push(k);
    add(tri, t[0], t[1], t[2]);
  }
  const ci = sg.map((s) => ((s[0] > 0 ? 1 : 0) | (s[1] > 0 ? 2 : 0) | (s[2] > 0 ? 4 : 0)) * 3);
  return { sg, fa, tri, flat, ci };
})();
const _J = new Float64Array(24), _K = new Float64Array(8), _GA = new Float64Array(8), _GI = new Uint8Array(8);
const TOPQ = [0, 1, 3, 0, 3, 2]; // the +y face's two triangles (its 4 vertices are box vertices 12..15)

// 1D noise in [0, 1]
export const n1 = (u, seed) => 0.5 + 0.5 * vn3(u, seed * 0.173, 0.37, seed);

// ---------- wall centre-line paths ----------
export function linePath(ax, az, bx, bz) {
  const L = Math.hypot(bx - ax, bz - az) || 1e-6, tx = (bx - ax) / L, tz = (bz - az) / L;
  return { L, closed: false, at: (u, o) => { o[0] = ax + tx * u; o[1] = az + tz * u; o[2] = tx; o[3] = tz; return o; } };
}
export function arcPath(cx, cz, R, a0, a1) { // anticlockwise seen from above (x right, z toward the viewer)
  const L = Math.abs(a1 - a0) * R, sg = a1 > a0 ? 1 : -1;
  return { L, R, closed: Math.abs(a1 - a0) >= TAU - 1e-6, at: (u, o) => { const a = a0 + sg * u / R; o[0] = cx + Math.cos(a) * R; o[1] = cz + Math.sin(a) * R; o[2] = -Math.sin(a) * sg; o[3] = Math.cos(a) * sg; return o; } };
}

// colour helpers (linear rgb)
export const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mix3c = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Growable typed-array mesh buffer (fast path for thousands of blocks per building); core Builder output
// (lathes, tubes) is appended into it.
class TBuf {
  constructor(cap = 8192, icap = 16384) {
    this.cap = cap; this.icap = icap; this.vc = 0; this.ic = 0;
    this.P = new Float32Array(this.cap * 3); this.N = new Float32Array(this.cap * 3); this.C = new Float32Array(this.cap * 3);
    this.F = new Float32Array(this.cap * 2); this.I = new Uint32Array(this.icap);
  }
  ensure(nv, ni) {
    if (this.vc + nv > this.cap) {
      let c = this.cap; while (this.vc + nv > c) c *= 2;
      const g = (a, k) => { const n = new Float32Array(c * k); n.set(a.subarray(0, this.vc * k)); return n; };
      this.P = g(this.P, 3); this.N = g(this.N, 3); this.C = g(this.C, 3); this.F = g(this.F, 2); this.cap = c;
    }
    if (this.ic + ni > this.icap) {
      let c = this.icap; while (this.ic + ni > c) c *= 2;
      const n = new Uint32Array(c); n.set(this.I.subarray(0, this.ic)); this.I = n; this.icap = c;
    }
  }
  v(x, y, z, nx, ny, nz, r, g, b, f0, f1) {
    if (this.vc >= this.cap) this.ensure(1, 0);
    const i = this.vc, P = this.P, N = this.N, C = this.C;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; N[i * 3] = nx; N[i * 3 + 1] = ny; N[i * 3 + 2] = nz;
    C[i * 3] = r; C[i * 3 + 1] = g; C[i * 3 + 2] = b; this.F[i * 2] = f0; this.F[i * 2 + 1] = f1;
    return this.vc++;
  }
  t(a, b, c) { if (this.ic + 3 > this.icap) this.ensure(0, 3); const I = this.I; I[this.ic++] = a; I[this.ic++] = b; I[this.ic++] = c; }
  appendB(o) {
    const n = o.P.length / 3, m = o.I.length, off = this.vc;
    this.ensure(n, m);
    this.P.set(o.P, off * 3); this.N.set(o.N, off * 3); this.C.set(o.C, off * 3); this.F.set(o.F, off * 2);
    for (let i = 0; i < m; i++) this.I[this.ic + i] = o.I[i] + off;
    this.vc += n; this.ic += m;
    this.fixN(off);
    return off;
  }
  smooth(v0, i0) { // area-weighted normals for vertices >= v0 from triangles >= i0
    const P = this.P, N = this.N, I = this.I;
    N.fill(0, v0 * 3, this.vc * 3);
    for (let k = i0; k < this.ic; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (a >= v0 * 3) { N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; }
      if (b >= v0 * 3) { N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; }
      if (c >= v0 * 3) { N[c] += nx; N[c + 1] += ny; N[c + 2] += nz; }
    }
    this.fixN(v0);
  }
  // unit normals; vertices touching only degenerate triangles (collapsed apexes) get +y instead of NaN
  fixN(v0) {
    const N = this.N;
    for (let k = v0 * 3; k < this.vc * 3; k += 3) {
      const l = Math.sqrt(N[k] * N[k] + N[k + 1] * N[k + 1] + N[k + 2] * N[k + 2]);
      if (!(l > 1e-9)) { N[k] = 0; N[k + 1] = 1; N[k + 2] = 0; continue; }
      N[k] /= l; N[k + 1] /= l; N[k + 2] /= l;
    }
  }
}
// one shared buffer: buildings are generated one at a time (the Template copies the data out)
let POOL = null, POOL_T = -1e9;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function takeBuf() {
  if (POOL && now() - POOL_T > 1500) POOL_T = -1e9; // a build that threw never released it
  if (POOL_T > -1e9) return new TBuf();
  if (!POOL) POOL = new TBuf();
  POOL.vc = 0; POOL.ic = 0; POOL_T = now();
  return POOL;
}
const _R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const yawM = (a) => { const c = Math.cos(a), s = Math.sin(a); _R[0] = c; _R[2] = s; _R[6] = -s; _R[8] = c; _R[1] = _R[3] = _R[5] = _R[7] = 0; _R[4] = 1; return _R; };

// Site: a placement frame over the chunk ground. fl(lx, lz) = floor height (local y) under a local point.
export class Site {
  constructor(fs, x, s, yaw, y0 = null) {
    this.fs = fs; this.x = x; this.s = s; this.yaw = yaw; this.R = rotY(yaw);
    this.y0 = y0 ?? fs.floor(x, s);
  }
  wx(lx, lz) { const R = this.R; return this.x + R[0] * lx + R[2] * lz; }
  ws(lx, lz) { const R = this.R; return this.s - (R[6] * lx + R[8] * lz); }
  fl(lx, lz) { const R = this.R; return this.fs.floor(this.x + R[0] * lx + R[2] * lz, this.s - (R[6] * lx + R[8] * lz)) - this.y0; }
  // min / max local floor over a local rectangle (n x n samples)
  range(x0, z0, x1, z1, n = 4) {
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const h = this.fl(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * j / n);
      if (h < lo) lo = h; if (h > hi) hi = h;
    }
    return [lo, hi];
  }
}

const _p = [0, 0, 0, 0], _q = [0, 0, 0, 0];

// ---------- the building builder ----------
// S: style (see ruins_styles.js); o: { tier, grow, silt, decay, stone, trim }
export class Bld {
  constructor(site, seed, S, o = {}) {
    this.b = takeBuf(); this.site = site; this.S = S; this.seed = seed | 0;
    this.tops = []; // upward faces (triangle soup): the light support surface others rest on
    this.pr = [];   // vertex ranges of curved geometry that get encrusting colour in finish()
    this.rng = mulberry32((seed ^ 0x5bd1e995) >>> 0 || 7);
    this.obs = []; this.fall = []; this.walls = [];
    this.lo = o.tier === 'low';
    this.grow = o.grow ?? 0.9; this.silt = o.silt ?? 0.5; this.decay = o.decay ?? 0.5;
    this.key = 6.05 + this.rng() * 0.9;
    this.stone = o.stone || S.stones[(this.rng() * S.stones.length) | 0];
    this.trim = o.trim || (S.trim || S.stones)[(this.rng() * (S.trim || S.stones).length) | 0];
    this.fallMax = this.lo ? 8 : 18;
    this.blocks = 0; this.t0 = now();
    // masonry scale: bigger blocks and courses on low-end GPUs and for distant (coarse) buildings
    this.bev = o.bev ?? 0; // chamfered (weathered) block edges: showcase structures on capable GPUs (3.7x the triangles)
    this.blK = (this.lo ? 2.1 : 1.6) * (o.coarse ? 1.8 : 1);
    this.chK = (this.lo ? 1.4 : 1.22) * (o.coarse ? 1.25 : 1);
  }
  // generation is resumable: generators yield at checkpoints once this step has used its time slice
  over(ms = 2.5) { return now() - this.t0 > ms; }
  r(a, b) { return a + (b - a) * this.rng(); }
  pick(a) { return a[(this.rng() * a.length) | 0]; }
  // block colour: base with per-block value / hue variation
  tone(c, v = 0.12) { const k = 1 + (this.rng() - 0.5) * 2 * v, h = (this.rng() - 0.5) * v * 0.6; return [c[0] * k * (1 + h), c[1] * k, c[2] * k * (1 - h)]; }

  // jittered box centred at (x, y, z), rotation R; bev > 0 = chamfered (softly rounded edges)
  box(w, h, d, x, y, z, R, col, bev = 0, jit = 0, f0 = this.grow, f1 = this.key) {
    const b = this.b, hx = w / 2, hy = h / 2, hz = d / 2, rng = this.rng;
    const bv = Math.min(bev, 0.4 * Math.min(hx, hy, hz));
    const T = bv > 0 ? BOX.tri : BOX.flat;
    b.ensure(24, T.length);
    const v0 = b.vc;
    for (let c = 0; c < 24; c++) _J[c] = jit ? (rng() - 0.5) * jit : 0;
    for (let c = 0; c < 8; c++) _K[c] = (c & 2 ? 1.04 : 0.8) * (0.93 + 0.13 * rng()); // darker lower edges: the joints read
    const r = R || I3, P = b.P, N = b.N, C = b.C, F = b.F;
    const r0 = r[0], r1 = r[1], r2 = r[2], r3 = r[3], r4 = r[4], r5 = r[5], r6 = r[6], r7 = r[7], r8 = r[8];
    const c0 = col[0], c1 = col[1], c2 = col[2];
    // encrusting life in patches (turf algae, coralline crusts, sponges), per corner; one centre test first
    let patchy = false;
    const gk = this.grow * 0.55, seed = this.seed;
    if (gk > 0.05 && f1 > 5.5 && f1 < 6.99 && vn3(x * 0.45, y * 0.6, z * 0.45, seed + 77) > -0.1) {
      patchy = true;
      for (let c = 0; c < 8; c++) {
        const sx = c & 1 ? hx : -hx, sy = c & 2 ? hy : -hy, sz = c & 4 ? hz : -hz;
        const px = r0 * sx + r1 * sy + r2 * sz + x, py = r3 * sx + r4 * sy + r5 * sz + y, pz = r6 * sx + r7 * sy + r8 * sz + z;
        const a = sstep(0.15, 0.55, vn3(px * 0.45, py * 0.6, pz * 0.45, seed + 77)) * gk;
        _GA[c] = Math.min(0.8, a);
        if (a > 0.02) { const pal = vn3(px * 0.21 + 3, py * 0.3, pz * 0.21, seed + 78); _GI[c] = pal < -0.25 ? 0 : pal < 0.3 ? 1 : 2; }
      }
    }
    for (let k = 0; k < 24; k++) {
      const s = BOX.sg[k], a = BOX.fa[k], ci = BOX.ci[k], o = (v0 + k) * 3;
      const px = s[0] * (a === 0 ? hx : hx - bv) + _J[ci], py = s[1] * (a === 1 ? hy : hy - bv) + _J[ci + 1], pz = s[2] * (a === 2 ? hz : hz - bv) + _J[ci + 2];
      const nx = a === 0 ? s[0] : 0, ny = a === 1 ? s[1] : 0, nz = a === 2 ? s[2] : 0;
      P[o] = r0 * px + r1 * py + r2 * pz + x; P[o + 1] = r3 * px + r4 * py + r5 * pz + y; P[o + 2] = r6 * px + r7 * py + r8 * pz + z;
      N[o] = r0 * nx + r1 * ny + r2 * nz; N[o + 1] = r3 * nx + r4 * ny + r5 * nz; N[o + 2] = r6 * nx + r7 * ny + r8 * nz;
      const cc = ci / 3, sh = _K[cc];
      let cr = c0 * sh, cg = c1 * sh, cb = c2 * sh;
      if (patchy && _GA[cc] > 0.02) { const g = GROW_C[_GI[cc]], ka = _GA[cc]; cr += (g[0] - cr) * ka; cg += (g[1] - cg) * ka; cb += (g[2] - cb) * ka; }
      C[o] = cr; C[o + 1] = cg; C[o + 2] = cb; F[(v0 + k) * 2] = f0; F[(v0 + k) * 2 + 1] = f1;
    }
    const I = b.I;
    for (let i = 0; i < T.length; i++) I[b.ic + i] = v0 + T[i];
    b.vc += 24; b.ic += T.length;
    this.blocks++;
    if (r4 > 0.9) { const t = this.tops, q = (v0 + 12) * 3; for (const k of TOPQ) t.push(P[q + k * 3], P[q + k * 3 + 1], P[q + k * 3 + 2]); }
    return v0;
  }
  // box whose bottom follows the ground: extends down from yTop to below the floor under its footprint
  pier(w, d, x, z, yTop, R, col, bev = 0, jit = 0, sink = 0.25) {
    const fl = this.minFloor(w, d, x, z, R) - sink;
    if (yTop <= fl + 0.05) return -1;
    return this.box(w, yTop - fl, d, x, (yTop + fl) / 2, z, R, col, bev, jit);
  }
  // lowest ground under a (rotated) rectangle: corners plus a grid finer than the 1.5 m terrain lattice
  minFloor(w, d, x, z, R) {
    const r = R || I3, site = this.site, nx = Math.max(1, Math.ceil(w / 1.4)), nz = Math.max(1, Math.ceil(d / 1.4));
    let m = 1e9;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const sx = i / nx - 0.5, sz = j / nz - 0.5;
      m = Math.min(m, site.fl(x + r[0] * w * sx + r[2] * d * sz, z + r[6] * w * sx + r[8] * d * sz));
    }
    return m;
  }
  // y that puts the lowest band of a template (rotated R, scale s, at x, z) at or below the ground
  seatTpl(t, R, x, z, s) {
    const F = t.tiltFoot(R, s, s, s, 48);
    let y = 1e9;
    for (let i = 0; i < F.length; i += 3) y = Math.min(y, this.site.fl(x + F[i], z + F[i + 2]) - F[i + 1]);
    return y;
  }
  // convex polygon (x, y pairs, any winding) extruded along local z by d, then rotated / moved
  prism(poly, d, x, y, z, R, col, f0 = this.grow, f1 = this.key) {
    const b = this.b, n = poly.length, r = R || I3, hz = d / 2;
    let area = 0;
    for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
    const ccw = area > 0;
    const put = (px, py, pz, nx, ny, nz) => b.v(r[0] * px + r[1] * py + r[2] * pz + x, r[3] * px + r[4] * py + r[5] * pz + y, r[6] * px + r[7] * py + r[8] * pz + z,
      r[0] * nx + r[1] * ny + r[2] * nz, r[3] * nx + r[4] * ny + r[5] * nz, r[6] * nx + r[7] * ny + r[8] * nz, col[0], col[1], col[2], f0, f1);
    for (const sz of [1, -1]) { // caps
      const v0 = b.vc;
      for (const p of poly) put(p[0], p[1], sz * hz, 0, 0, sz);
      for (let i = 1; i < n - 1; i++) { if ((sz > 0) === ccw) b.t(v0, v0 + i, v0 + i + 1); else b.t(v0, v0 + i + 1, v0 + i); }
    }
    for (let i = 0; i < n; i++) { // sides
      const p = poly[i], q = poly[(i + 1) % n];
      let ex = q[0] - p[0], ey = q[1] - p[1];
      const l = Math.sqrt(ex * ex + ey * ey) || 1; ex /= l; ey /= l;
      const nx = ccw ? ey : -ey, ny = ccw ? -ex : ex;
      const a = put(p[0], p[1], hz, nx, ny, 0), bb = put(q[0], q[1], hz, nx, ny, 0), c = put(q[0], q[1], -hz, nx, ny, 0), dd = put(p[0], p[1], -hz, nx, ny, 0);
      if (ccw) { b.t(a, dd, c); b.t(a, c, bb); } else { b.t(a, c, dd); b.t(a, bb, c); }
    }
  }
  // lathe painted as stone (colour variation), optional per-vertex colour fn
  lathe(nu, nv, prof, rad, col, f0 = this.grow, f1 = this.key, x = 0, y = 0, z = 0) {
    const tb = new Builder(), seed = this.seed;
    tb.lathe(nu, nv, prof, rad, (v, a, px, py, pz, o) => {
      const k = 0.88 + 0.22 * vn3(px * 2.1 + x, py * 2.1, pz * 2.1 + z, seed);
      const c = typeof col === 'function' ? col(v, a, py) : col;
      o[3] = c[0] * k; o[4] = c[1] * k; o[5] = c[2] * k; o[6] = f0; o[7] = f1;
    });
    const v0 = this.b.appendB(tb);
    if (x || y || z) { const P = this.b.P; for (let i = v0 * 3; i < this.b.vc * 3; i += 3) { P[i] += x; P[i + 1] += y; P[i + 2] += z; } }
    if (f1 > 5.5 && f1 < 6.99) this.pr.push(v0, this.b.vc);
    return v0;
  }
  tube(pts, radii, radial, col, cap = true, f0 = this.grow, f1 = this.key) {
    const tb = new Builder(), seed = this.seed;
    tb.tube(pts, radii, radial, (v, a, px, py, pz, o) => {
      const k = 0.88 + 0.22 * vn3(px * 2.3, py * 2.3, pz * 2.3, seed);
      o[3] = col[0] * k; o[4] = col[1] * k; o[5] = col[2] * k; o[6] = f0; o[7] = f1;
    }, { cap });
    const v0 = this.b.appendB(tb);
    if (f1 > 5.5 && f1 < 6.99) this.pr.push(v0, this.b.vc);
    return v0;
  }
  // grid surface fn(u, v, out[x, y, z]) with optional holes (keep(u, v) per cell) and a back face th below
  surf(nu, nv, fn, col, { th = 0, keep = null, f0 = this.grow, f1 = this.key, two = true } = {}) {
    const b = this.b, v0 = b.vc, i0 = b.ic, o = [0, 0, 0], seed = this.seed;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      fn(i / nu, j / nv, o);
      const k = 0.86 + 0.24 * vn3(o[0] * 1.7, o[1] * 1.7, o[2] * 1.7, seed + 3);
      const c = typeof col === 'function' ? col(i / nu, j / nv) : col;
      b.v(o[0], o[1], o[2], 0, 1, 0, c[0] * k, c[1] * k, c[2] * k, f0, f1);
    }
    const W = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (keep && !keep((i + 0.5) / nu, (j + 0.5) / nv)) continue;
      const a = v0 + j * W + i;
      b.t(a, a + W, a + 1); b.t(a + 1, a + W, a + W + 1);
    }
    b.smooth(v0, i0);
    if (f1 > 5.5 && f1 < 6.99) this.pr.push(v0, b.vc);
    { const t = this.tops, P = b.P, I = b.I; for (let k = i0; k < b.ic; k++) { const q = I[k] * 3; t.push(P[q], P[q + 1], P[q + 2]); } }
    if (two && th > 0) this.thicken(v0, i0, th);
    return v0;
  }
  // duplicate vertices >= v0 offset by -normal * th with reversed triangles (a solid-looking underside)
  thicken(v0, i0, th) {
    const b = this.b, n = b.vc - v0, off = b.vc, i1 = b.ic;
    b.ensure(n, i1 - i0);
    for (let i = v0; i < v0 + n; i++) {
      const P = b.P, N = b.N, C = b.C, nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      b.v(P[i * 3] - nx * th, P[i * 3 + 1] - ny * th, P[i * 3 + 2] - nz * th, -nx, -ny, -nz, C[i * 3] * 0.8, C[i * 3 + 1] * 0.8, C[i * 3 + 2] * 0.8, b.F[i * 2] * 0.3, b.F[i * 2 + 1]);
    }
    for (let k = i0; k < i1; k += 3) b.t(b.I[k] - v0 + off, b.I[k + 2] - v0 + off, b.I[k + 1] - v0 + off);
  }
  cap(ax, ay, az, bx, by, bz, r) { this.obs.push([ax, ay, az, bx, by, bz, r]); }
  // embed another template (statue, fragment) rotated by R, scaled by s, tinted, at (x, y, z)
  addTpl(t, R, x, y, z, s = 1, tint = null, f0 = null) {
    const b = this.b, n = t.vc, m = t.idx.length, r = R || I3;
    const sx = typeof s === 'number' ? s : s[0], sy = typeof s === 'number' ? s : s[1], sz = typeof s === 'number' ? s : s[2];
    const ix = 1 / sx, iy = 1 / sy, iz = 1 / sz;
    b.ensure(n, m);
    const v0 = b.vc, P = b.P, N = b.N, C = b.C, F = b.F, tp = t.pos, tn = t.nor, tc = t.col, tf = t.fx;
    for (let i = 0; i < n; i++) {
      const px = tp[i * 3] * sx, py = tp[i * 3 + 1] * sy, pz = tp[i * 3 + 2] * sz, o = (v0 + i) * 3;
      let nx = tn[i * 3] * ix, ny = tn[i * 3 + 1] * iy, nz = tn[i * 3 + 2] * iz;
      const nq = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nq > 1e-9) { nx /= nq; ny /= nq; nz /= nq; } else { nx = 0; ny = 1; nz = 0; }
      P[o] = r[0] * px + r[1] * py + r[2] * pz + x; P[o + 1] = r[3] * px + r[4] * py + r[5] * pz + y; P[o + 2] = r[6] * px + r[7] * py + r[8] * pz + z;
      N[o] = r[0] * nx + r[1] * ny + r[2] * nz; N[o + 1] = r[3] * nx + r[4] * ny + r[5] * nz; N[o + 2] = r[6] * nx + r[7] * ny + r[8] * nz;
      C[o] = tc[i * 3] * (tint ? tint[0] : 1); C[o + 1] = tc[i * 3 + 1] * (tint ? tint[1] : 1); C[o + 2] = tc[i * 3 + 2] * (tint ? tint[2] : 1);
      F[(v0 + i) * 2] = f0 ?? tf[i * 2]; F[(v0 + i) * 2 + 1] = tf[i * 2 + 1];
    }
    for (let i = 0; i < m; i++) b.I[b.ic + i] = t.idx[i] + v0;
    b.vc += n; b.ic += m;
    return v0;
  }
  // a mark of everything emitted so far; turn / shift / xform move what was emitted after it
  // (vertices, capsules and the support surface alike)
  mark() { return [this.b.vc, this.obs.length, this.tops.length]; }
  xform(m, R, tx = 0, ty = 0, tz = 0) {
    const [v0, c0, t0] = m, P = this.b.P, N = this.b.N, T = this.tops;
    const ap = (A, i) => { const x = A[i], y = A[i + 1], z = A[i + 2]; A[i] = R[0] * x + R[1] * y + R[2] * z; A[i + 1] = R[3] * x + R[4] * y + R[5] * z; A[i + 2] = R[6] * x + R[7] * y + R[8] * z; };
    for (let i = v0; i < this.b.vc; i++) { ap(P, i * 3); P[i * 3] += tx; P[i * 3 + 1] += ty; P[i * 3 + 2] += tz; ap(N, i * 3); }
    for (let i = t0; i < T.length; i += 3) { ap(T, i); T[i] += tx; T[i + 1] += ty; T[i + 2] += tz; }
    for (let i = c0; i < this.obs.length; i++) { const o = this.obs[i]; for (const q of [0, 3]) { ap(o, q); o[q] += tx; o[q + 1] += ty; o[q + 2] += tz; } }
  }
  shift(m, dx, dy, dz) { this.xform(m, I3, dx, dy, dz); }
  // build a part at an offset (dx, dz) fitted to the ground there: generate centred, then shift(m, dx, 0, dz)
  offsetSite(dx, dz) {
    const site = this.site;
    this.site = { fl: (x, z) => site.fl(x + dx, z + dz), range: (x0, z0, x1, z1, n) => site.range(x0 + dx, z0 + dz, x1 + dx, z1 + dz, n), base: site };
    return () => { if (this.fall.length) this.dropFallen(); this.site = site; };
  }
  // turn about the vertical axis through (x, z)
  turn(m, a, x = 0, z = 0) {
    const R = rotY(-a); // rotY(-a): (x, z) -> (x cos a + z sin a, -x sin a + z cos a)
    this.xform(m, I3, -x, 0, -z); this.xform(m, R, x, 0, z);
  }
  // vertical capsules covering a box footprint (w along x, d along z) from y0 to y1
  boxCaps(cx, cz, w, d, y0, y1) {
    let nx = Math.max(1, Math.round(w / Math.min(w, d))), nz = Math.max(1, Math.round(d / Math.min(w, d)));
    while (Math.hypot(w / nx, d / nz) / 2 > 1.9) { if (w / nx >= d / nz) nx++; else nz++; }
    const r = Math.hypot(w / nx, d / nz) / 2 + 0.05;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = cx - w / 2 + (i + 0.5) * w / nx, z = cz - d / 2 + (j + 0.5) * d / nz;
      const a = Math.min(y0 + r * 0.6, (y0 + y1) / 2), b = Math.max(a, y1 - r * 0.6);
      this.cap(x, a, z, x, b, z, r);
    }
  }


  // Decay profile for a wall: design top H, never below `base`; corners stand higher (they are stronger).
  profile(H, base, L, phase, d = this.decay, corners = true) {
    if (d <= 0.02) return () => H;
    const seed = this.seed, k = H - base;
    return (u) => {
      const n = n1((u + phase) / 3.1, seed) * 0.7 + n1((u + phase) / 0.9, seed + 5) * 0.3;
      let h = H - d * k * (0.2 + 0.95 * sat(n * 1.25 - 0.1));
      if (corners) { const e = Math.min(u, L - u); h += d * k * 0.5 * sstep(1.8, 0, e); }
      return Math.min(H, Math.max(base, h));
    };
  }

  // Coursed masonry wall along `path`. o: { t, y0 (lowest course bottom), H (design top), top(u) (decayed
  // profile), ch:[a,b] course heights, bl:[a,b] block lengths, open:[{u0,u1,v0,v1,kind}], col(k, i), bands:Set,
  // jit, bev, lap, noObs, fall (prob.) }. Returns the course table.
  wall(path, o) {
    const rng = this.rng, L = path.L, t = o.t, H = o.H, top = o.top || (() => H);
    const ch0 = o.ch[0] * this.chK, ch1 = o.ch[1] * this.chK, bl0 = o.bl[0] * this.blK, bl1 = o.bl[1] * this.blK, jit = o.jit ?? 0.05, bev = this.lo ? 0 : (o.bev ?? this.bev);
    const nF = Math.ceil(L / 0.75) + 2, F = new Float32Array(nF);
    // o.floor: the wall stands on a platform (constant height) instead of the terrain
    for (let i = 0; i < nF; i++) { path.at(Math.min(L, i * 0.75), _p); F[i] = o.floor != null ? Math.max(o.floor, this.site.fl(_p[0], _p[1])) : this.site.fl(_p[0], _p[1]); }
    const fAt = (u) => { const q = Math.max(0, Math.min(nF - 1.001, u / 0.75)), i = q | 0, f = q - i; return F[i] + (F[i + 1] - F[i]) * f; };
    let lowF = 1e9; for (let i = 0; i < nF; i++) lowF = Math.min(lowF, F[i]);
    const y0 = Math.min(o.y0 ?? lowF - 0.3, lowF - 0.3);
    // courses (the last one absorbs a short remainder)
    const cs = [];
    let y = y0;
    while (y < H - 0.02) {
      let c = ch0 + (ch1 - ch0) * rng();
      if (H - (y + c) < ch0 * 0.55) c = H - y;
      cs.push(y, y + c); y += c;
    }
    const nc = cs.length / 2;
    // openings: snap rect / trapezoid / corbel heads and sills to course joints
    const snap = (v) => { let best = cs[0], bd = 1e9; for (let k = 0; k <= nc; k++) { const yy = k < nc ? cs[k * 2] : cs[nc * 2 - 1], d = Math.abs(yy - v); if (d < bd) { bd = d; best = yy; } } return best; };
    const ops = (o.open || []).map((q) => {
      const p = { ...q, uc: (q.u0 + q.u1) / 2, w: q.u1 - q.u0, ok: false, th: q.th ?? Math.max(0.35, Math.min(0.6, (q.u1 - q.u0) * 0.22)) };
      if (p.kind === 'rect' || p.kind === 'trap' || p.kind === 'corbel' || !p.kind) { p.v0 = snap(q.v0); p.v1 = snap(q.v1); if (p.v1 <= p.v0 + 0.3) p.v1 = p.v0 + 0.6; }
      if (p.kind === 'corbel') p.vs = p.v0 + (p.v1 - p.v0) * 0.5; // vertical jambs, then each course steps in
      if (p.kind === 'arch') p.vs = q.v1 - p.w / 2;                // springing line; v1 = crown (intrados)
      if (p.kind === 'para') p.vs = q.v0 + (q.v1 - q.v0) * 0.3;    // tall parabolic (organic) arch
      if (p.kind === 'round') { p.vc = (q.v0 + q.v1) / 2; p.rr = Math.min(p.w, q.v1 - q.v0) / 2; }
      return p;
    });
    const holes = (ya, yb, out) => {
      out.length = 0;
      for (const p of ops) {
        let a = 0, c = -1;
        if (p.kind === 'arch' || p.kind === 'para') {
          if (yb <= p.v0 + 0.01 || ya >= p.v1) continue;
          if (ya < p.vs) { a = p.u0; c = p.u1; }
          else {
            const dy = ya - p.vs, r = p.w / 2;
            const hw = p.kind === 'arch' ? Math.sqrt(Math.max(0, r * r - dy * dy)) : r * Math.sqrt(Math.max(0, 1 - dy / (p.v1 - p.vs)));
            if (hw < 0.06) continue;
            a = p.uc - hw; c = p.uc + hw;
          }
        } else if (p.kind === 'round') {
          const dy = ya > p.vc ? ya - p.vc : yb < p.vc ? p.vc - yb : 0;
          if (dy >= p.rr) continue;
          const hw = Math.sqrt(p.rr * p.rr - dy * dy); a = p.uc - hw; c = p.uc + hw;
        } else if (p.kind === 'corbel') {
          if (yb <= p.v0 + 0.01 || (p.capY !== undefined && ya >= p.capY - 0.01)) continue;
          const hw = p.w / 2 - Math.max(0, ya - p.vs) * 0.7;
          if (hw < 0.12) continue;
          a = p.uc - hw; c = p.uc + hw;
        } else {
          if (yb <= p.v0 + 0.01 || ya >= p.v1 - 0.01) continue;
          if (p.kind === 'trap') { const f = sat((ya - p.v0) / (p.v1 - p.v0)), hw = p.w / 2 * (1 - 0.3 * f); a = p.uc - hw; c = p.uc + hw; }
          else { a = p.u0; c = p.u1; }
        }
        out.push(a, c);
      }
      return out;
    };
    const covered = (u, iv) => { for (let i = 0; i < iv.length; i += 2) if (u >= iv[i] - 1e-4 && u <= iv[i + 1] + 1e-4) return true; return false; };
    const extra = []; // support from lintels / rings for the courses they carry: [ua, ub, fromY, toY]
    let prev = [], cur = [];
    const H2 = new Float32Array(Math.ceil(L / 2) + 1).fill(-1e9);
    const hb = [], fixed = [];
    const placeBlock = (pa, pb, ya, yb, k, i, thick = t, col = null, down = 0) => {
      path.at((pa + pb) / 2, _p);
      // neighbours overlap by more than the corner jitter, so no see-through slits open between blocks
      const lap = (o.lap ? o.lap * (pb - pa) : 0) + jit * 1.6 + 0.02, vlap = jit + 0.02 + down;
      const yaw = Math.atan2(-_p[3], _p[2]) + (rng() - 0.5) * 0.035;
      const c = col || (o.col ? o.col(k, i) : this.tone(this.stone, 0.16));
      const dk = 1 + (rng() - 0.5) * 0.06;
      this.box(pb - pa + lap, yb - ya + vlap, thick * dk, _p[0], (ya + yb - vlap) / 2, _p[1], yawM(yaw), c, bev, jit);
      const bi = Math.min(H2.length - 1, ((pa + pb) / 4) | 0); if (yb > H2[bi]) H2[bi] = yb;
    };
    // completed voussoir rings: extrados height over u (the stones above rest on it)
    const rings = [];
    const ext = (u) => {
      let e = -1e9;
      for (const g of rings) {
        const du = u - g.uc;
        if (du <= -g.R0 || du >= g.R0) continue; // over the ring (true outer radius); height from the inscribed curve, never below the springing
        e = Math.max(e, g.para ? g.y1 + g.h * Math.max(0, 1 - (du / g.R) * (du / g.R)) : g.y1 + Math.sqrt(Math.max(0, g.R * g.R - du * du)));
      }
      return e;
    };
    // A block that rests partly on a ring: a wedge stone whose underside follows the extrados (the chord lies
    // inside the ring), so it neither hovers above the curve nor pokes into the opening.
    const placeOnRing = (pa, pb, ya, yb, k, i, thick, col, prev) => {
      const sup = (u) => (covered(u, prev) || fAt(u) >= ya - 0.05 ? ya : Math.min(ya, ext(u)));
      const ea = sup(pa + 0.02), eb = sup(pb - 0.02);
      if (ea >= ya - 0.03 && eb >= ya - 0.03) { placeBlock(pa, pb, ya, yb, k, i, thick, col); return; }
      if (ea < -1e8 || eb < -1e8) { placeBlock(pa, pb, ya, yb, k, i, thick, col); return; }
      path.at((pa + pb) / 2, _p);
      const um = (pa + pb) / 2, yaw = Math.atan2(-_p[3], _p[2]), lap = jit * 1.6 + 0.02;
      const c = col || (o.col ? o.col(k, i) : this.tone(this.stone, 0.16));
      this.prism([[pa - um - lap / 2, ea - 0.1], [pb - um + lap / 2, eb - 0.1], [pb - um + lap / 2, yb], [pa - um - lap / 2, yb]], thick, _p[0], 0, _p[1], yawM(yaw), c); // seated 10 cm into the ring
      const bi = Math.min(H2.length - 1, (um / 2) | 0); if (yb > H2[bi]) H2[bi] = yb;
    };
    const fallP = o.fall ?? 0.35;
    const maybeFall = (pa, pb, ya, yb) => {
      if (this.fall.length >= this.fallMax || rng() > fallP) return;
      path.at((pa + pb) / 2, _p);
      this.fall.push({ x: _p[0], z: _p[1], tx: _p[2], tz: _p[3], l: pb - pa, h: yb - ya, d: t, side: rng() < 0.5 ? -1 : 1, col: this.tone(this.stone) });
    };
    for (let k = 0; k < nc; k++) {
      const ya = cs[k * 2], yb = cs[k * 2 + 1];
      let band = false;
      if (o.bands) for (const hb2 of o.bands) if (hb2 >= ya - 0.01 && hb2 < yb - 0.01) band = true;
      holes(ya, yb, hb);
      cur = [];
      fixed.length = 0;
      // lintels / capstones / rings that start at this course
      for (const p of ops) {
        if (p.kind === 'rect' || p.kind === 'trap' || !p.kind) {
          if (Math.abs(ya - p.v1) > 0.01 || p.done) continue;
          p.done = true;
          const hw = p.kind === 'trap' ? p.w / 2 * 0.7 : p.w / 2, lap = Math.min(0.45, 0.2 + p.w * 0.12);
          const a = p.uc - hw - lap, c = p.uc + hw + lap;
          if (covered(p.uc - hw - 0.12, prev) && covered(p.uc + hw + 0.12, prev) && top(p.uc) >= yb - 0.05) {
            placeBlock(a, c, ya, yb, k, -1, t * 1.02, this.tone(this.trim, 0.06));
            fixed.push(a, c); cur.push(a, c); p.ok = true;
            extra.push(a, c, yb, yb);
          }
        } else if (p.kind === 'corbel') {
          const hw = p.w / 2 - Math.max(0, ya - p.vs) * 0.7;
          if (p.done || ya <= p.vs || hw >= 0.45) continue;
          p.done = true; p.capY = ya; // capstone closes the vault
          const a = p.uc - Math.max(hw, 0.12) - 0.35, c = p.uc + Math.max(hw, 0.12) + 0.35;
          if (covered(a + 0.1, prev) && covered(c - 0.1, prev) && top(p.uc) >= yb - 0.05) { placeBlock(a, c, ya, yb, k, -1, t * 1.02, this.tone(this.trim, 0.06)); fixed.push(a, c); cur.push(a, c); extra.push(a, c, yb, yb); p.ok = true; }
          else { const q = Math.max(hw, 0.12); fixed.push(p.uc - q, p.uc + q); } // open crack where the capstone fell
        } else if ((p.kind === 'arch' || p.kind === 'para' || p.kind === 'round') && !p.done && ya >= (p.kind === 'round' ? p.vc : p.vs) - 0.01) {
          p.done = true;
          const r = p.kind === 'round' ? p.rr : p.w / 2, uc = p.uc, y1 = p.kind === 'round' ? p.vc : p.vs;
          if (!covered(uc - r - 0.1, prev) || !covered(uc + r + 0.1, prev)) continue;
          p.ok = this.ring(path, p, y1, r, top, t);
          if (p.ok) {
            extra.push(uc - r - p.th, uc + r + p.th, y1, y1 + (p.kind === 'para' ? p.v1 - p.vs : r) + p.th); // up to the crown, not beyond
            const ci = Math.cos(Math.PI / p.n) - 0.01; // chords sag inside the true curve
            rings.push({ uc, y1, R: (r + p.th) * ci, R0: r + p.th, para: p.kind === 'para', h: p.kind === 'para' ? (p.v1 - p.vs + p.th) * ci : 0 });
          }
        }
      }
      // filler blocks
      let u = 0, i = 0;
      while (u < L - 1e-3) {
        let l = bl0 + (bl1 - bl0) * rng();
        if (k % 2 && u === 0) l *= 0.5;
        if (L - u - l < bl0 * 0.45) l = L - u;
        const ua = u, ub = Math.min(L, u + l);
        u = ub; i++;
        // cut out holes and fixed pieces
        let segs = [ua, ub];
        for (const iv of [hb, fixed]) for (let q = 0; q < iv.length; q += 2) {
          const ha = iv[q], hc = iv[q + 1], nxt = [];
          for (let m = 0; m < segs.length; m += 2) {
            const sa = segs[m], sb = segs[m + 1];
            if (hc <= sa || ha >= sb) { nxt.push(sa, sb); continue; }
            if (ha > sa) nxt.push(sa, ha);
            if (hc < sb) nxt.push(hc, sb);
          }
          segs = nxt;
        }
        for (let m = 0; m < segs.length; m += 2) {
          const pa = segs[m], pb = segs[m + 1];
          if (pb - pa < 0.14) continue;
          const um = (pa + pb) / 2, fm = Math.min(fAt(pa), fAt(um), fAt(pb));
          if (yb < fm - 0.06) { cur.push(pa, pb); continue; } // buried: still carries the course above
          if ((ya + yb) * 0.5 > top(um) + (rng() - 0.5) * 0.25) { maybeFall(pa, pb, ya, yb); continue; }
          if (k > 0 && ya > Math.max(fAt(pa), fAt(pb)) + 0.04) { // must rest on something
            let sup = 0;
            for (let q = 0; q < 5; q++) {
              const uu = pa + (pb - pa) * (q + 0.5) / 5;
              if (covered(uu, prev) || fAt(uu) >= ya - 0.05) { sup++; continue; }
              for (let e = 0; e < extra.length; e += 4) if (ya >= extra[e + 2] - 0.01 && ya <= extra[e + 3] + 0.01 && uu >= extra[e] && uu <= extra[e + 1]) { sup++; break; }
            }
            if (sup < 3) { maybeFall(pa, pb, ya, yb); continue; }
          }
          let ext0 = 0; // a block near the ground reaches below the floor under all four bottom corners (cross slopes)
          if (ya < fm + 0.9) {
            let fmin = 1e9;
            for (const uu of [pa, pb]) { path.at(uu, _q); for (const sd of [-0.5, 0.5]) fmin = Math.min(fmin, this.site.fl(_q[0] - _q[3] * t * sd, _q[1] + _q[2] * t * sd)); }
            if (o.floor != null) fmin = Math.max(fmin, o.floor);
            const vl = jit + 0.02;
            if (fmin - 0.06 < ya - vl) ext0 = ya - vl - (fmin - 0.06);
          }
          if (rings.length && !ext0) placeOnRing(pa, pb, ya, yb, k, i, band ? t + 0.16 : t, band ? this.tone(this.trim, 0.05) : null, prev);
          else placeBlock(pa, pb, ya, yb, k, i, band ? t + 0.16 : t, band ? this.tone(this.trim, 0.05) : null, ext0);
          cur.push(pa, pb);
        }
      }
      prev = cur;
    }
    this.walls.push({ path, t });
    if (!o.noObs) this.wallObs(path, t, H2, fAt);
    return ops; // the openings as built (course-snapped sill and head, ok = lintel / ring in place)
  }
  // voussoir ring (semicircle / parabola / full circle); stops where the wall has decayed. Returns complete?
  ring(path, p, y1, r, top, t) {
    const full = p.kind === 'round', rm = r + p.th / 2, hp = p.kind === 'para' ? p.v1 - p.vs + p.th / 2 : rm;
    const len = full ? TAU * rm : p.kind === 'para' ? Math.PI * 0.5 * (rm + hp) * 1.15 : Math.PI * rm;
    const n = Math.max(5, Math.round(len / 0.55)) | 1;
    p.n = n; // the extrados is a polygon of n chords (its inscribed radius is what stones above rest on)
    const a0 = full ? -Math.PI / 2 : 0, span = full ? TAU : Math.PI;
    const col = this.tone(this.trim, 0.05);
    // wedge stones (voussoirs): trapezoids between the intrados and the extrados, so the ring is closed
    const hpI = p.kind === 'para' ? p.v1 - p.vs : r, ro = r + p.th;
    const at = (a, outer, o) => {
      o[0] = Math.cos(a) * (outer ? ro : r);
      o[1] = p.kind === 'para' ? (hpI + (outer ? p.th : 0)) * Math.sin(a) * Math.sin(a) : Math.sin(a) * (outer ? ro : r);
      return o;
    };
    const Q = [[0, 0], [0, 0], [0, 0], [0, 0]];
    let done = 0;
    const put = (k) => {
      const ak = a0 + span * k / n, ak1 = a0 + span * (k + 1) / n;
      at(ak, false, Q[0]); at(ak1, false, Q[1]); at(ak1, true, Q[2]); at(ak, true, Q[3]);
      if (full && Math.sin((ak + ak1) / 2) < 0.2) for (const q of [Q[2], Q[3]]) { // lower half of an oculus: keyed deep into the courses below
        const l = Math.hypot(q[0], q[1]) || 1, e = 0.55; q[0] += q[0] / l * e; q[1] += q[1] / l * e;
      }
      const cu = (Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4, cy = (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4;
      if (y1 + cy > top(p.uc + cu) + 0.15) return false;
      path.at(p.uc + cu, _p);
      const poly = Q.map((q) => [q[0] - cu, q[1] - cy]); // stones meet exactly (no see-through joints); colour tells them apart
      this.prism(poly, t * 1.04, _p[0], y1 + cy, _p[1], yawM(Math.atan2(-_p[3], _p[2])), this.tone(col, 0.05));
      done++;
      return true;
    };
    if (full) { for (let k = 0; k < n; k++) put(k); return done === n; }
    for (let k = 0; k < (n >> 1); k++) if (!put(k)) break;
    for (let k = n - 1; k > (n >> 1); k--) if (!put(k)) break;
    if (done === n - 1) put(n >> 1); // keystone only when both haunches stand
    return done === n;
  }
  // tight capsules over a wall: pieces of <= 6 m, stacked to the standing height
  wallObs(path, t, H2, fAt) {
    const L = path.L, nb = H2.length;
    for (let g = 0; g < nb; g += 4) {
      let hm = -1e9;
      for (let q = g; q < Math.min(nb, g + 4); q++) hm = Math.max(hm, H2[q]);
      const ua = g * 2, ub = Math.min(L, (g + 4) * 2);
      if (hm < -1e8 || ub - ua < 0.2) continue;
      const yl = Math.min(fAt(ua), fAt((ua + ub) / 2), fAt(ub));
      if (hm < yl + 0.2) continue;
      const span = hm - yl, len = ub - ua;
      // horizontal rows or vertical posts, whichever needs fewer capsules
      const rr = Math.max(t / 2 + 0.12, Math.min(1.45, Math.min(span, len) / 2)), hh = Math.sqrt(Math.max(1e-3, rr * rr - t * t / 4));
      const nH = Math.max(1, Math.ceil(span / (2 * hh) - 0.05)), nV = Math.max(1, Math.ceil(len / (2 * hh) - 0.05));
      if (nH <= nV) {
        const e0 = Math.min(ub, ua + rr * 0.3), e1 = Math.max(e0, ub - rr * 0.3);
        path.at(e0, _p); path.at(e1, _q);
        for (let i = 0; i < nH; i++) { const yy = yl + (i + 0.5) * span / nH; this.cap(_p[0], yy, _p[1], _q[0], yy, _q[1], rr); }
      } else {
        const y0 = yl + Math.min(rr * 0.3, span / 2), y1 = Math.max(y0, hm - rr * 0.3);
        for (let i = 0; i < nV; i++) { path.at(ua + (i + 0.5) * len / nV, _p); this.cap(_p[0], y0, _p[1], _p[0], y1, _p[1], rr); }
      }
    }
  }

  // Column standing at (x, z) on the ground or at y0. o: { style, R, H, broken, nu, col, capCol, noObs }
  column(x, y0, z, o) {
    const S = this.S, st = o.style || S.col, R = o.R, H = o.H, rng = this.rng, nu = o.nu || (this.lo ? 8 : 12);
    const col = o.col || this.tone(this.stone, 0.06), capc = o.capCol || col, b = this.b;
    const pw = R * (st === 'minoan' ? 2.2 : 2.6), fl = this.minFloor(pw, pw, x, z, null);
    let yb;
    if (y0 != null) yb = y0; // on a platform / stylobate
    else if (o.plinth) { // square plinth seated in the ground
      const top = Math.max(fl, this.site.fl(x, z)) + 0.3 + this.rng() * 0.25;
      this.box(pw, top - fl + 0.3, pw, x, (top + fl - 0.3) / 2, z, null, scale3(col, 0.92), this.lo ? 0 : 0.03, 0.02);
      yb = top;
    } else yb = fl - 0.12;
    const brk = o.broken ? Math.max(0.6, H * o.broken) : 0, top = yb + (brk || H);
    const set0 = T.colStyle && T.colStyle[st], set = set0 && (o.full && !this.lo ? set0 : set0.lite || set0);
    if (set && !o.lathe) { // fast path: copy a startup column of this order, rescaled and tinted
      const t = this.pick(brk ? set.broken : set.intact), kr = R / t.colR, ky = (brk || H) / t.colH;
      const base = t.colStyleCol || [0.62, 0.58, 0.5], c = o.col || col;
      this.addTpl(t, yawM(this.rng() * TAU), x, yb, z, [kr, ky, kr], [c[0] / base[0], c[1] / base[1], c[2] / base[2]]);
      if (!o.noObs) this.cap(x, Math.min(fl, yb) + R, z, x, top + (brk ? 0 : R * 0.5), z, R * (st === 'papyrus' ? 1.45 : st === 'corinthian' ? 1.4 : 1.25));
      return brk ? top : yb + (t.maxY * ky);
    }
    const flutes = !this.lo && (st === 'doric' || st === 'ionic' || st === 'corinthian') ? 16 : 0;
    const nuF = flutes ? 16 : nu;
    // base moulding
    if (st === 'ionic' || st === 'corinthian' || st === 'tuscan' || st === 'atlantean') this.lathe(nu, 2, (v) => [R * (1.32 - 0.22 * v), yb + v * 0.28], null, col, this.grow, this.key, x, 0, z);
    else if (st === 'papyrus' || st === 'lotus' || st === 'pagoda' || st === 'khmer') this.lathe(nu, 1, (v) => [R * (1.45 - 0.1 * v), yb + v * 0.25], null, col, this.grow, this.key, x, 0, z);
    const y1 = yb + (st === 'doric' || st === 'maya' || st === 'minoan' ? 0 : 0.25);
    const taper = st === 'minoan' ? -0.22 : st === 'papyrus' ? 0.12 : st === 'pagoda' ? 0.04 : 0.12, seed = this.seed + ((x * 7 + z * 13) | 0);
    const sq = st === 'maya';
    const v0 = b.vc;
    this.lathe(sq ? 4 : nuF, Math.max(2, Math.round((top - y1) / 1.6)), (v) => {
      const yy = y1 + v * (top - y1), tt = (yy - yb) / H;
      return [R * (1 - taper * tt + 0.03 * Math.sin(tt * Math.PI)) * (sq ? 1.414 : 1), yy];
    }, (a) => {
      let k = 1;
      if (flutes) k *= 1 - 0.05 * (0.5 + 0.5 * Math.cos(a * flutes));
      if (st === 'papyrus') k *= 1 + 0.07 * Math.abs(Math.sin(a * 4));
      if (st === 'atlantean') k *= 1 + 0.08 * Math.cos(a * 6);
      return k;
    }, st === 'minoan' ? [0.42, 0.12, 0.08] : st === 'pagoda' ? [0.38, 0.11, 0.07] : col);
    if (sq) for (let i = v0; i < b.vc; i++) { const px = b.P[i * 3], pz = b.P[i * 3 + 2], c = Math.SQRT1_2; b.P[i * 3] = c * (px - pz); b.P[i * 3 + 2] = c * (px + pz); }
    if (st === 'atlantean') for (let i = v0; i < b.vc; i++) { const yy = b.P[i * 3 + 1] - y1, a = yy * 0.9, c = Math.cos(a), s = Math.sin(a), px = b.P[i * 3], pz = b.P[i * 3 + 2]; b.P[i * 3] = px * c - pz * s; b.P[i * 3 + 2] = px * s + pz * c; }
    for (let i = v0; i < b.vc; i++) { b.P[i * 3] += x; b.P[i * 3 + 2] += z; }
    if (brk) { // jagged break with lighter stone at the fracture
      const vt = b.vc;
      const c = b.v(x, top + 0.08 * (rng() - 0.3), z, 0, 1, 0, col[0] * 1.15, col[1] * 1.15, col[2] * 1.12, 0.2, this.key);
      const ring = vt - (sq ? 4 : nuF);
      const nr = sq ? 4 : nuF;
      for (let i = 0; i < nr; i++) { b.P[(ring + i) * 3 + 1] += (rng() - 0.6) * R * 0.8; }
      for (let i = 0; i < nr; i++) b.t(ring + ((i + 1) % nr), ring + i, c);
    } else this.capital(x, top, z, R * (1 - taper), st, capc, o.capCol);
    if (!o.noObs) this.cap(x, Math.min(fl, yb) + R, z, x, top + (brk ? 0 : R * 0.5), z, R * (st === 'papyrus' ? 1.45 : st === 'corinthian' ? 1.4 : 1.25));
    return top + (brk ? 0 : this.capH(st, R));
  }
  capH(st, R) { return st === 'corinthian' ? R * 2.2 + 0.22 : st === 'papyrus' || st === 'lotus' ? R * 2.4 : st === 'ionic' ? 0.55 : st === 'pagoda' ? 0.45 : st === 'khmer' ? 0.5 : 0.6; }
  capital(x, y, z, rt, st, col) {
    const tr = this.tone(this.trim, 0.04), lo = this.lo;
    if (st === 'doric' || st === 'tuscan') { this.lathe(lo ? 8 : 12, 2, (v) => [rt * (1 + 0.45 * Math.sin(v * Math.PI * 0.5)), y + v * 0.3], null, col, this.grow, this.key, x, 0, z); this.box(rt * 3, 0.3, rt * 3, x, y + 0.45, z, null, tr, lo ? 0 : 0.03); }
    else if (st === 'ionic') { this.box(rt * 2.9, 0.22, rt * 2.2, x, y + 0.2, z, null, tr, lo ? 0 : 0.03); for (const sd of [-1, 1]) this.tube([[x + sd * rt * 1.2, y + 0.12, z - rt * 1.05], [x + sd * rt * 1.2, y + 0.12, z + rt * 1.05]], [rt * 0.32, rt * 0.32], lo ? 5 : 8, tr); this.box(rt * 3, 0.2, rt * 3, x, y + 0.42, z, null, tr); }
    else if (st === 'corinthian') { this.lathe(lo ? 8 : 14, 4, (v) => [rt * (1 + 0.42 * v), y + v * rt * 2.2], (a, v) => 1 + 0.16 * Math.max(0, Math.sin(a * 8 + (v > 0.5 ? 0.4 : 0))) * Math.sin((v * 2 % 1) * Math.PI), col, this.grow, this.key, x, 0, z); this.box(rt * 3.1, 0.22, rt * 3.1, x, y + rt * 2.2 + 0.11, z, null, tr, lo ? 0 : 0.03); }
    else if (st === 'papyrus') this.lathe(lo ? 8 : 14, 4, (v) => [rt * (0.9 + 0.85 * Math.sin(v * Math.PI * 0.5)), y + v * rt * 2.4], (a) => 1 + 0.06 * Math.abs(Math.sin(a * 8)), col, this.grow, this.key, x, 0, z);
    else if (st === 'lotus') this.lathe(lo ? 8 : 12, 4, (v) => [rt * (1 + 0.35 * Math.sin(v * Math.PI) - 0.3 * v), y + v * rt * 2.4], (a) => 1 + 0.1 * Math.abs(Math.sin(a * 3)), col, this.grow, this.key, x, 0, z);
    else if (st === 'minoan') { this.lathe(lo ? 8 : 12, 3, (v) => [rt * (1 + 0.45 * Math.sin(v * Math.PI)), y + v * 0.4], null, [0.07, 0.06, 0.06], this.grow, this.key, x, 0, z); this.box(rt * 2.8, 0.22, rt * 2.8, x, y + 0.51, z, null, [0.1, 0.08, 0.08]); }
    else if (st === 'pagoda') { this.box(rt * 2.4, 0.22, rt * 2.4, x, y + 0.11, z, null, tr); this.box(rt * 3.6, 0.2, rt * 1.2, x, y + 0.32, z, null, [0.3, 0.12, 0.08]); }
    else if (st === 'khmer') { for (let k = 0; k < 3; k++) this.lathe(lo ? 8 : 10, 1, (v) => [rt * (1.3 - 0.15 * k) * (1 - 0.1 * v), y + k * 0.16 + v * 0.16], null, col, this.grow, this.key, x, 0, z); }
    else if (st === 'atlantean') { this.lathe(lo ? 8 : 12, 3, (v) => [rt * (1 + 0.7 * v * v), y + v * 0.55], null, [0.75, 0.52, 0.22], 0, GOLD_MODE, x, 0, z); }
    else this.box(rt * 2.8, 0.45, rt * 2.8, x, y + 0.22, z, null, tr, lo ? 0 : 0.04, 0.02);
  }

  // ---------- roofs ----------
  // hip roof (pagoda style when curve > 0): eave rectangle +-ax, +-az at height y, rise h, ridge half-length rl
  hipRoof(ax, az, y, h, o = {}) {
    const rl = Math.max(0, o.ridge ?? Math.max(0, ax - az)), up = o.up ?? 0, cv = o.curve ?? 1, col = o.col || [0.22, 0.24, 0.22];
    const nu = this.lo ? 6 : 12, nv = this.lo ? 3 : 5, th = o.th ?? 0.18, keep = o.keep || null;
    const E = [[-ax, az, ax, az, -rl, rl], [ax, az, ax, -az, rl, rl], [ax, -az, -ax, -az, rl, -rl], [-ax, -az, -ax, az, -rl, -rl]];
    for (let f = 0; f < 4; f++) {
      const [ex0, ez0, ex1, ez1, rx0, rx1] = E[f];
      this.surf(nu, nv, (s, v, out) => {
        const ex = lerp(ex0, ex1, s), ez = lerp(ez0, ez1, s), rx = lerp(rx0, rx1, s);
        out[0] = lerp(ex, rx, v); out[2] = lerp(ez, 0, v);
        const e = Math.abs(2 * s - 1);
        out[1] = y + h * Math.pow(v, cv) + up * Math.pow(e, 5) * (1 - v) * (1 - v);
      }, col, { th, keep: keep ? (s, v) => keep(f, s, v) : null, f0: this.grow * 0.8, f1: this.key });
    }
    const rc = scale3(col, 0.85);
    if (!o.noRidge) {
      if (rl > 0.2) this.tube([[-rl - 0.2, y + h + 0.05, 0], [rl + 0.2, y + h + 0.05, 0]], [0.16, 0.16], this.lo ? 4 : 6, rc);
      for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
        const pts = [];
        for (let k = 0; k <= 4; k++) { const v = k / 4; pts.push([lerp(sx * ax, sx * rl, v), y + h * Math.pow(v, cv) + up * (1 - v) * (1 - v) + 0.06, lerp(sz * az, 0, v)]); }
        this.tube(pts, pts.map(() => 0.1), 4, rc);
      }
    }
    const r = Math.max(0.5, Math.min(az * 0.55, h * 0.75));
    for (const sz of [-1, 1]) this.cap(-Math.max(0, ax - r), y + h * 0.4, sz * az * 0.45, Math.max(0, ax - r), y + h * 0.4, sz * az * 0.45, r);
  }
  // gable roof along x: eaves at z = +-az, height y, rise h; pediments at both ends
  gableRoof(ax, az, y, h, o = {}) {
    const col = o.col || [0.45, 0.24, 0.17], nu = this.lo ? 4 : 8, keep = o.keep || null;
    for (const sd of [1, -1]) {
      this.surf(nu, 2, (s, v, out) => { out[0] = lerp(-ax, ax, s) * sd; out[2] = sd * az * (1 - v); out[1] = y + h * v; }, col, { th: 0.15, keep: keep ? (s, v) => keep(sd, s, v) : null, f0: this.grow * 0.9, f1: this.key });
    }
    if (o.pediment) for (const sx of [-1, 1]) this.prism([[-az * 0.96, 0], [az * 0.96, 0], [0, h * 0.94]], 0.5, sx * (ax - 0.35), y, 0, rotY(Math.PI / 2), this.tone(this.trim, 0.05));
    const r = Math.max(0.5, Math.min(az * 0.55, h * 0.75));
    for (const sz of [-1, 1]) this.cap(-Math.max(0, ax - r), y + h * 0.4, sz * az * 0.45, Math.max(0, ax - r), y + h * 0.4, sz * az * 0.45, r);
  }
  // dome on a ring: centre (x, y, z), radius R, rise k*R; ribs, oculus, broken (holes) and gold leaf
  dome(x, y, z, R, o = {}) {
    const k = o.k ?? 1, ribs = o.ribs || 0, ocu = o.oculus || 0, brk = o.broken || 0, col = o.col || this.tone(this.stone, 0.05);
    const nu = this.lo ? 12 : 20, nv = this.lo ? 5 : 8, seed = this.seed;
    const keep = brk > 0 ? (u, v) => n1(u * 9 + v * 2.3, seed + 11) * 0.7 + 0.3 * n1(v * 7, seed) > brk * (0.3 + 0.7 * v) : null;
    this.surf(nu, nv, (u, v, out) => {
      const a = u * TAU, t = (v * (1 - ocu)) * Math.PI / 2, rr = R * Math.cos(t) * (1 + (ribs ? 0.035 * Math.pow(Math.abs(Math.cos(a * ribs / 2)), 8) : 0));
      out[0] = x + Math.cos(a) * rr; out[2] = z + Math.sin(a) * rr; out[1] = y + Math.sin(t) * R * k;
    }, o.gold ? [0.72, 0.5, 0.2] : col, { th: 0.3, keep, f0: o.gold ? 0 : this.grow, f1: o.gold ? GOLD_MODE : this.key });
    if (ribs && !this.lo) for (let i = 0; i < ribs; i++) {
      const a = i / ribs * TAU, pts = [];
      for (let q = 0; q <= 5; q++) { const t = q / 5 * (1 - ocu) * Math.PI / 2; pts.push([x + Math.cos(a) * R * Math.cos(t) * 1.02, y + Math.sin(t) * R * k * 1.02, z + Math.sin(a) * R * Math.cos(t) * 1.02]); }
      this.tube(pts, pts.map((_, q) => 0.16 - q * 0.015), 5, o.ribCol || this.tone(this.trim, 0.04), false, o.ribGold ? 0 : this.grow, o.ribGold ? GOLD_MODE : this.key);
    }
    this.cap(x, y + R * k * 0.3, z, x, y + R * k * 0.3, z, R * 1.04);
  }
  // fallen blocks from the decay, scattered at the wall feet (no block lands inside a standing wall)
  dropFallen() {
    const rng = this.rng, site = this.site;
    for (const f of this.fall) {
      const off = f.d / 2 + 0.25 + rng() * 1.8, nx = -f.tz * f.side, nz = f.tx * f.side;
      const x = f.x + nx * off + (rng() - 0.5) * 1.2, z = f.z + nz * off + (rng() - 0.5) * 1.2;
      const l = Math.min(f.l, 1.8), hw = Math.max(l, f.h, f.d) / 2;
      let bad = false;
      for (const w of this.walls) {
        const L = w.path.L;
        for (let u = 0; u <= L && !bad; u += 0.6) { w.path.at(u, _p); if (Math.hypot(_p[0] - x, _p[1] - z) < w.t / 2 + hw + 0.05) bad = true; }
        if (bad) break;
      }
      if (bad) continue;
      const yaw = rng() * TAU, tx = (rng() - 0.5) * 0.5, tz = (rng() - 0.5) * 0.5;
      const R = mul3(rotY(yaw), mul3(rotX(tx), rotZ(tz)));
      // seat: every bottom corner at or below the ground
      let y = 1e9;
      for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
        const px = sx * l, py = sy * f.h, pz = sz * f.d;
        const wx = R[0] * px + R[1] * py + R[2] * pz, wy = R[3] * px + R[4] * py + R[5] * pz, wz = R[6] * px + R[7] * py + R[8] * pz;
        y = Math.min(y, site.fl(x + wx, z + wz) - wy);
      }
      this.box(l, f.h, f.d, x, y - 0.06, z, R, scale3(f.col, 0.92), this.lo ? 0 : 0.04, 0.05);
    }
    this.fall.length = 0;
  }
  // silt line and ground occlusion on stone, then the template (support: others may rest on it)
  // silt line, ground occlusion and encrusting growth, resumable: false when this step's time (ms) is up, true when done
  prep(ms = Infinity, siltH = 0.9) {
    const b = this.b, site = this.site, P = b.P, C = b.C, F = b.F;
    let q = this._prep;
    if (!q) {
      if (this.fall.length) this.dropFallen();
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < b.vc; i++) { const x = P[i * 3], z = P[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      q = this._prep = { i: 0, r: 0, j: -1, yCut: site.range(x0, z0, x1, z1, 4)[1] + siltH + 1.7, done: false }; // vertices above yCut are never near the ground
    }
    if (q.done) return true;
    const sk = this.silt;
    while (q.i < b.vc) {
      const e = Math.min(b.vc, q.i + 1024);
      for (let i = q.i; i < e; i++) {
        if (P[i * 3 + 1] > q.yCut) continue;
        const m = F[i * 2 + 1];
        if (m > 6.99 && m < 7.99) continue; // gold stays bright
        const hf = P[i * 3 + 1] - site.fl(P[i * 3], P[i * 3 + 2]);
        if (hf > siltH + 1.6) continue;
        const s = sk * sstep(siltH, 0.05, hf) * 0.75, ao = 0.72 + 0.28 * sstep(-0.1, 1.6, hf);
        C[i * 3] = (C[i * 3] + (SILT[0] - C[i * 3]) * s) * ao; C[i * 3 + 1] = (C[i * 3 + 1] + (SILT[1] - C[i * 3 + 1]) * s) * ao; C[i * 3 + 2] = (C[i * 3 + 2] + (SILT[2] - C[i * 3 + 2]) * s) * ao;
        F[i * 2] *= 1 - 0.6 * s;
      }
      q.i = e;
      if (this.over(ms)) return false;
    }
    // encrusting life in patches on curved parts (boxes did their own corners): columns, domes, roofs
    const gk = this.grow * 0.55, seed = this.seed;
    if (gk > 0.05) while (q.r < this.pr.length) {
      const a = Math.max(q.j, this.pr[q.r]), end = Math.min(b.vc, this.pr[q.r + 1]), e = Math.min(end, a + 1024);
      for (let i = a; i < e; i++) {
        const m = F[i * 2 + 1];
        if (m > 6.99 && m < 7.99) continue;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const n = vn3(x * 0.45, y * 0.6, z * 0.45, seed + 77), w = sstep(0.15, 0.55, n) * gk;
        if (w < 0.02) continue;
        const pal = vn3(x * 0.21 + 3, y * 0.3, z * 0.21, seed + 78), g = pal < -0.25 ? GROW_C[0] : pal < 0.3 ? GROW_C[1] : GROW_C[2];
        const k = Math.min(0.8, w);
        C[i * 3] += (g[0] - C[i * 3]) * k; C[i * 3 + 1] += (g[1] - C[i * 3 + 1]) * k; C[i * 3 + 2] += (g[2] - C[i * 3 + 2]) * k;
      }
      if (e >= end) { q.r += 2; q.j = -1; } else q.j = e;
      if (this.over(ms)) return false;
    }
    return (q.done = true);
  }
  finish(label, fact = null, { support = true, siltH = 0.9 } = {}) {
    this.prep(Infinity, siltH);
    const b = this.b, P = b.P, C = b.C, F = b.F;
    const t = new Template({
      P: P.subarray(0, b.vc * 3), N: b.N.subarray(0, b.vc * 3), C: C.subarray(0, b.vc * 3), F: F.subarray(0, b.vc * 2), I: b.I.subarray(0, b.ic),
      obs: this.obs, label, fact, band: 0.03,
    });
    t.site = this.site; // (kept for audits: the frame the structure was fitted in)
    this.release();
    if (support && this.tops.length >= 9) { // light proxy of the top surfaces for the ground's support raycast
      const n = this.tops.length / 3, z = new Float32Array(n * 3), I = new Uint32Array(n);
      for (let i = 0; i < n; i++) I[i] = i;
      t.supProxy = new Template({ P: Float32Array.from(this.tops), N: z, C: z, F: new Float32Array(n * 2), I, band: 0.01 });
    }
    return t;
  }
  release() { if (this.b === POOL) POOL_T = -1e9; }
  // a build that continues in a later step leaves the shared buffer (other builds may run in between)
  detach() {
    const o = this.b;
    if (o !== POOL) return;
    const n = new TBuf(Math.max(8192, o.vc * 1.5) | 0, Math.max(16384, o.ic * 1.5) | 0);
    n.P.set(o.P.subarray(0, o.vc * 3)); n.N.set(o.N.subarray(0, o.vc * 3)); n.C.set(o.C.subarray(0, o.vc * 3)); n.F.set(o.F.subarray(0, o.vc * 2)); n.I.set(o.I.subarray(0, o.ic));
    n.vc = o.vc; n.ic = o.ic;
    this.b = n; POOL_T = -1e9;
  }
}
