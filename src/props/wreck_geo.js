// Low-level geometry for the wrecks (see wreck.js): thick shells over a node lattice with plate / plank
// seams, holes, torn and bent edges and broken-edge strips; small primitives (cylinders between points,
// discs, rings, oriented boxes, catenaries); and whole-template operations: rigid transforms, the burial
// cut (geometry below the sand line is dropped) and a tight capsule cover for the creature obstacles.
import { TAU } from './core.js';
import { hash3i } from '../noise.js';

// ---------- tiny vector helpers (arrays [x, y, z]) ----------
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const h01 = (i, j, k, s) => hash3i(i, j, k, s); // integer hash -> [0, 1)

// Time slicer for generator builds: due() is true once `ms` have passed since the last reset.
// Pattern: if (due()) { yield; due.reset(); }
export function slicer(ms = 1.2) {
  let t = performance.now();
  const f = () => performance.now() - t > ms;
  f.reset = () => { t = performance.now(); };
  return f;
}

// ---------- primitives ----------
// Cylinder / cone between points p and q (radii r0, r1), n sides. c = rgb, f = [fx0, fx1]. caps: 1 = start, 2 = end, 3 = both.
export function cyl(b, p, q, r0, r1, n, c, f, caps = 0, c1 = null) {
  const d = sub(q, p), L = len(d) || 1e-6, a = [d[0] / L, d[1] / L, d[2] / L];
  let u = Math.abs(a[1]) < 0.9 ? [a[2], 0, -a[0]] : [0, -a[2], a[1]];
  u = norm(u);
  const w = cross(a, u), v0 = b.vc, slope = (r0 - r1) / L, cb = c1 || c;
  for (let k = 0; k < n; k++) {
    const t = (k / n) * TAU, cs = Math.cos(t), sn = Math.sin(t);
    const rx = u[0] * cs + w[0] * sn, ry = u[1] * cs + w[1] * sn, rz = u[2] * cs + w[2] * sn;
    const nl = Math.hypot(1, slope), nx = (rx + a[0] * slope) / nl, ny = (ry + a[1] * slope) / nl, nz = (rz + a[2] * slope) / nl;
    b.v(p[0] + rx * r0, p[1] + ry * r0, p[2] + rz * r0, nx, ny, nz, c[0], c[1], c[2], f[0], f[1]);
    b.v(q[0] + rx * r1, q[1] + ry * r1, q[2] + rz * r1, nx, ny, nz, cb[0], cb[1], cb[2], f[0], f[1]);
  }
  for (let k = 0; k < n; k++) {
    const p0 = v0 + 2 * k, q0 = p0 + 1, p1 = v0 + 2 * ((k + 1) % n), q1 = p1 + 1;
    b.t(p0, p1, q0); b.t(q0, p1, q1);
  }
  if (caps & 1) {
    const cc = b.v(p[0], p[1], p[2], -a[0], -a[1], -a[2], c[0], c[1], c[2], f[0], f[1]), s0 = b.vc;
    for (let k = 0; k < n; k++) b.v(b.P[(v0 + 2 * k) * 3], b.P[(v0 + 2 * k) * 3 + 1], b.P[(v0 + 2 * k) * 3 + 2], -a[0], -a[1], -a[2], c[0], c[1], c[2], f[0], f[1]);
    for (let k = 0; k < n; k++) b.t(cc, s0 + ((k + 1) % n), s0 + k);
  }
  if (caps & 2) {
    const cc = b.v(q[0], q[1], q[2], a[0], a[1], a[2], cb[0], cb[1], cb[2], f[0], f[1]), s0 = b.vc;
    for (let k = 0; k < n; k++) b.v(b.P[(v0 + 2 * k + 1) * 3], b.P[(v0 + 2 * k + 1) * 3 + 1], b.P[(v0 + 2 * k + 1) * 3 + 2], a[0], a[1], a[2], cb[0], cb[1], cb[2], f[0], f[1]);
    for (let k = 0; k < n; k++) b.t(cc, s0 + k, s0 + ((k + 1) % n));
  }
  return v0;
}

// polyline tube with per-point radii (smooth joints), n sides, optional end caps
export function pipe(b, pts, r, n, c, f, caps = 0) {
  const m = pts.length, v0 = b.vc, i0 = b.I.length, rr = typeof r === 'number' ? null : r;
  let prevU = null;
  for (let j = 0; j < m; j++) {
    const a = norm(sub(pts[Math.min(m - 1, j + 1)], pts[Math.max(0, j - 1)]));
    let u;
    if (!prevU) u = Math.abs(a[1]) < 0.9 ? norm([a[2], 0, -a[0]]) : norm([0, -a[2], a[1]]);
    else { const d = dot(prevU, a); u = norm([prevU[0] - a[0] * d, prevU[1] - a[1] * d, prevU[2] - a[2] * d]); }
    prevU = u;
    const w = cross(a, u), R = rr ? rr[j] : r, p = pts[j];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * TAU, cs = Math.cos(t), sn = Math.sin(t);
      const nx = u[0] * cs + w[0] * sn, ny = u[1] * cs + w[1] * sn, nz = u[2] * cs + w[2] * sn;
      b.v(p[0] + nx * R, p[1] + ny * R, p[2] + nz * R, nx, ny, nz, c[0], c[1], c[2], f[0], f[1]);
    }
  }
  for (let j = 0; j < m - 1; j++) for (let k = 0; k < n; k++) {
    const p0 = v0 + j * n + k, p1 = v0 + j * n + ((k + 1) % n), q0 = p0 + n, q1 = p1 + n;
    b.t(p0, p1, q0); b.t(q0, p1, q1);
  }
  if (caps) for (const e of [0, m - 1]) {
    const a = norm(e ? sub(pts[m - 1], pts[m - 2]) : sub(pts[0], pts[1])), p = pts[e], cc = b.v(p[0], p[1], p[2], a[0], a[1], a[2], c[0], c[1], c[2], f[0], f[1]);
    for (let k = 0; k < n; k++) { const q = v0 + e * n + k, q2 = v0 + e * n + ((k + 1) % n); if (e) b.t(cc, q, q2); else b.t(cc, q2, q); }
  }
  void i0;
  return v0;
}

// sagging line (rope, cable, chain catenary) between p and q, sag metres at the middle
export function sagLine(p, q, sag, n = 6) {
  const out = [];
  for (let k = 0; k <= n; k++) { const t = k / n, s = 4 * t * (1 - t) * sag; out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t - s, p[2] + (q[2] - p[2]) * t]); }
  return out;
}

// flat disc facing n (unit), radius r, centre p
export function disc(b, p, nrm, r, sides, c, f) {
  let u = Math.abs(nrm[1]) < 0.9 ? norm([nrm[2], 0, -nrm[0]]) : norm([0, -nrm[2], nrm[1]]);
  const w = cross(nrm, u), cc = b.v(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], c[0], c[1], c[2], f[0], f[1]), s0 = b.vc;
  for (let k = 0; k < sides; k++) {
    const t = (k / sides) * TAU, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    b.v(p[0] + u[0] * cs + w[0] * sn, p[1] + u[1] * cs + w[1] * sn, p[2] + u[2] * cs + w[2] * sn, nrm[0], nrm[1], nrm[2], c[0], c[1], c[2], f[0], f[1]);
  }
  for (let k = 0; k < sides; k++) b.t(cc, s0 + k, s0 + ((k + 1) % sides));
  return cc;
}

// short ring (porthole rim, hoop, tyre) around axis nrm at p: radius r, tube half-width hw, depth dp
export function ring(b, p, nrm, r, hw, dp, sides, c, f) {
  let u = Math.abs(nrm[1]) < 0.9 ? norm([nrm[2], 0, -nrm[0]]) : norm([0, -nrm[2], nrm[1]]);
  const w = cross(nrm, u), v0 = b.vc;
  // 4 vertices per angle: outer-front, inner-front, inner-back, outer-back (a square section)
  const prof = [[r + hw, dp], [r - hw, dp], [r - hw, 0], [r + hw, 0]];
  for (let k = 0; k < sides; k++) {
    const t = (k / sides) * TAU, cs = Math.cos(t), sn = Math.sin(t), rx = u[0] * cs + w[0] * sn, ry = u[1] * cs + w[1] * sn, rz = u[2] * cs + w[2] * sn;
    for (const [rr, d] of prof) b.v(p[0] + rx * rr + nrm[0] * d, p[1] + ry * rr + nrm[1] * d, p[2] + rz * rr + nrm[2] * d, rx, ry, rz, c[0], c[1], c[2], f[0], f[1]);
  }
  const i0 = b.I.length;
  for (let k = 0; k < sides; k++) for (let e = 0; e < 3; e++) {
    const a = v0 + k * 4 + e, bb = v0 + k * 4 + e + 1, a2 = v0 + ((k + 1) % sides) * 4 + e, b2 = a2 + 1;
    b.t(a, bb, a2); b.t(a2, bb, b2);
  }
  b.smooth(v0, i0);
  return v0;
}

// box with its local axes: centre p, axis directions ax (width), ay (height), az (depth) unit vectors
export function obox(b, p, ax, ay, az, w, h, d, c, f) {
  const v0 = b.box(w, h, d, null, 0, 0, 0, c, f);
  const R = [ax[0], ay[0], az[0], ax[1], ay[1], az[1], ax[2], ay[2], az[2]];
  b.xform(v0, R, p[0], p[1], p[2]);
  return v0;
}
// beam (square section) between two points, thickness w (side) x h (up-ish)
export function beam(b, p, q, w, h, c, f, up = [0, 1, 0]) {
  const az = norm(sub(q, p));
  let ax = cross(up, az);
  if (len(ax) < 1e-4) ax = cross([1, 0, 0], az);
  ax = norm(ax);
  const ay = cross(az, ax);
  return obox(b, mix3(p, q, 0.5), ax, ay, az, w, h, len(sub(q, p)), c, f);
}

// ---------- thick shell over a lattice ----------
// S = {
//   nu, nt            : cells (nodes (nu+1) x (nt+1)); node index k = j * (nu + 1) + i
//   P                 : Float32Array of node positions (modified in place by tearing)
//   out(i, j) -> [x,y,z] outward reference direction (only its sign relative to the lattice matters)
//   hole              : Uint8Array(nu * nt) cell flags (1 = missing)
//   th                : thickness (inner surface = outer - N * th)
//   strakes           : row boundaries [0, ..., nt] (panels never cross them)
//   butts(k)          : column boundaries [0, ..., nu] for strake k
//   lap(k)            : outward offset of strake k (lapped plating), m
//   color(i, j, k, m, o): outer vertex colour + fx -> o = [r, g, b, fx0, fx1] (k strake, m plate index)
//   inner(i, j, o)    : inner surface colour + fx
//   edge(i, j, o)     : broken-edge strip colour + fx
//   tear              : bend amplitude (m) of nodes on hole edges; seed
//   open              : { i0, i1, j0, j1 } borders that get edge strips (broken ends, bare top edge)
//   noInner           : skip the inner surface (thin plates seen from one side only)
// }
export function shell(b, S) { const g = shellG(b, S); let r; do r = g.next(); while (!r.done); return r.value; }
export function* shellG(b, S) {
  const nu = S.nu, nt = S.nt, W = nu + 1, P = S.P, n = W * (nt + 1), hole = S.hole;
  const isHole = (i, j) => (i < 0 || j < 0 || i >= nu || j >= nt) ? 2 : hole[j * nu + i];
  // node normals from the lattice (central differences), oriented by the outward reference
  const N = new Float32Array(n * 3);
  let sgnVotes = 0;
  for (let j = 0; j <= nt; j++) for (let i = 0; i <= nu; i++) {
    const k = j * W + i, ia = Math.max(0, i - 1), ib = Math.min(nu, i + 1), ja = Math.max(0, j - 1), jb = Math.min(nt, j + 1);
    const a = (j * W + ia) * 3, bb = (j * W + ib) * 3, c = (ja * W + i) * 3, d = (jb * W + i) * 3;
    const ux = P[bb] - P[a], uy = P[bb + 1] - P[a + 1], uz = P[bb + 2] - P[a + 2];
    const vx = P[d] - P[c], vy = P[d + 1] - P[c + 1], vz = P[d + 2] - P[c + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const o = S.out(i, j), l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) { nx = o[0]; ny = o[1]; nz = o[2]; }
    const s = nx * o[0] + ny * o[1] + nz * o[2];
    if (l >= 1e-9) sgnVotes += s > 0 ? 1 : -1;
    if (s < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const m = Math.hypot(nx, ny, nz) || 1;
    N[k * 3] = nx / m; N[k * 3 + 1] = ny / m; N[k * 3 + 2] = nz / m;
  }
  const flip = sgnVotes < 0; // lattice (i, j) orientation is inward: reverse the winding
  // tear: nodes on a hole edge bend inward and jag
  if (S.tear > 0) for (let j = 0; j <= nt; j++) for (let i = 0; i <= nu; i++) {
    let h = 0;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (isHole(i + di, j + dj) === 1) h++;
    if (!h) continue;
    const k = j * W + i, r1 = h01(i, j, 1, S.seed), r2 = h01(i, j, 2, S.seed) - 0.5, r3 = h01(i, j, 3, S.seed) - 0.5;
    const amp = S.tear * (0.25 + 0.75 * r1) * (h >= 2 ? 1 : 0.6);
    // in-plane jag along the lattice directions
    const ia = Math.max(0, i - 1), ib = Math.min(nu, i + 1), ja = Math.max(0, j - 1), jb = Math.min(nt, j + 1);
    for (let q = 0; q < 3; q++) {
      const du = (P[(j * W + ib) * 3 + q] - P[(j * W + ia) * 3 + q]) * 0.5, dv = (P[(jb * W + i) * 3 + q] - P[(ja * W + i) * 3 + q]) * 0.5;
      P[k * 3 + q] += -N[k * 3 + q] * amp + du * r2 * 0.45 + dv * r3 * 0.45;
    }
  }
  const o = [0, 0, 0, 0, 0], due = S.due || slicer();
  const tri = (a, bb, c) => (flip ? b.t(a, c, bb) : b.t(a, bb, c));
  // ---- outer panels
  const strakes = S.strakes;
  for (let k = 0; k < strakes.length - 1; k++) {
    const j0 = strakes[k], j1 = strakes[k + 1], butts = S.butts(k), lap = S.lap ? S.lap(k) : 0;
    for (let m = 0; m < butts.length - 1; m++) {
      const i0 = butts[m], i1 = butts[m + 1];
      let any = false;
      for (let j = j0; j < j1 && !any; j++) for (let i = i0; i < i1; i++) if (!hole[j * nu + i]) { any = true; break; }
      if (!any) continue;
      const v0 = b.vc, t0 = b.I.length, pw = i1 - i0 + 1, map = new Int32Array(pw * (j1 - j0 + 1)).fill(-1);
      const node = (i, j) => {
        const q = (j - j0) * pw + (i - i0);
        if (map[q] >= 0) return map[q];
        const kk = j * W + i;
        S.color(i, j, k, m, o);
        return (map[q] = b.v(P[kk * 3] + N[kk * 3] * lap, P[kk * 3 + 1] + N[kk * 3 + 1] * lap, P[kk * 3 + 2] + N[kk * 3 + 2] * lap,
          N[kk * 3], N[kk * 3 + 1], N[kk * 3 + 2], o[0], o[1], o[2], o[3], o[4]));
      };
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        if (hole[j * nu + i]) continue;
        const a = node(i, j), bb = node(i + 1, j), c = node(i, j + 1), d = node(i + 1, j + 1);
        tri(a, bb, c); tri(c, bb, d);
      }
      if (!S.latticeNormals) b.smooth(v0, t0);
      if (due()) { yield; due.reset(); }
    }
  }
  // ---- inner surface (one smooth grid)
  const inner = new Int32Array(n).fill(-1), th = S.th;
  if (!S.noInner) {
    const v0 = b.vc, t0 = b.I.length;
    const node = (i, j) => {
      const kk = j * W + i;
      if (inner[kk] >= 0) return inner[kk];
      S.inner(i, j, o);
      return (inner[kk] = b.v(P[kk * 3] - N[kk * 3] * th, P[kk * 3 + 1] - N[kk * 3 + 1] * th, P[kk * 3 + 2] - N[kk * 3 + 2] * th,
        -N[kk * 3], -N[kk * 3 + 1], -N[kk * 3 + 2], o[0], o[1], o[2], o[3], o[4]));
    };
    for (let j = 0; j < nt; j++) {
      for (let i = 0; i < nu; i++) {
        if (hole[j * nu + i]) continue;
        const a = node(i, j), bb = node(i + 1, j), c = node(i, j + 1), d = node(i + 1, j + 1);
        tri(a, c, bb); tri(c, d, bb);
      }
      if (due()) { yield; due.reset(); }
    }
    b.smooth(v0, t0);
  }
  // ---- edge strips: hole boundaries, open borders
  const op = S.open || {};
  const strip = (ka, kb, ci, cj) => { // nodes ka -> kb along the edge of cell (ci, cj)
    const A = [P[ka * 3], P[ka * 3 + 1], P[ka * 3 + 2]], B = [P[kb * 3], P[kb * 3 + 1], P[kb * 3 + 2]];
    const A2 = [A[0] - N[ka * 3] * th, A[1] - N[ka * 3 + 1] * th, A[2] - N[ka * 3 + 2] * th], B2 = [B[0] - N[kb * 3] * th, B[1] - N[kb * 3 + 1] * th, B[2] - N[kb * 3 + 2] * th];
    // cell centre: the strip faces away from it
    const c0 = (cj * W + ci) * 3, c1 = ((cj + 1) * W + ci + 1) * 3;
    const mid = [(A[0] + B[0]) / 2 - (P[c0] + P[c1]) / 2, (A[1] + B[1]) / 2 - (P[c0 + 1] + P[c1 + 1]) / 2, (A[2] + B[2]) / 2 - (P[c0 + 2] + P[c1 + 2]) / 2];
    let nn = cross(sub(B, A), sub(A2, A));
    const sw = dot(nn, mid) < 0;
    if (sw) nn = scl(nn, -1);
    nn = norm(nn);
    S.edge(ci, cj, o);
    const a = b.v(A[0], A[1], A[2], nn[0], nn[1], nn[2], o[0], o[1], o[2], o[3], o[4]), bb = b.v(B[0], B[1], B[2], nn[0], nn[1], nn[2], o[0], o[1], o[2], o[3], o[4]);
    const c = b.v(A2[0], A2[1], A2[2], nn[0], nn[1], nn[2], o[0], o[1], o[2], o[3], o[4]), d = b.v(B2[0], B2[1], B2[2], nn[0], nn[1], nn[2], o[0], o[1], o[2], o[3], o[4]);
    if (!sw) { b.t(a, bb, c); b.t(c, bb, d); } else { b.t(a, c, bb); b.t(c, d, bb); }
  };
  const want = (h, border) => h === 1 || (h === 2 && border);
  if (th > 0) for (let j = 0; j < nt; j++) {
    for (let i = 0; i < nu; i++) {
      if (hole[j * nu + i]) continue;
      if (want(isHole(i - 1, j), op.i0)) strip(j * W + i, (j + 1) * W + i, i, j);
      if (want(isHole(i + 1, j), op.i1)) strip(j * W + i + 1, (j + 1) * W + i + 1, i, j);
      if (want(isHole(i, j - 1), op.j0)) strip(j * W + i, j * W + i + 1, i, j);
      if (want(isHole(i, j + 1), op.j1)) strip((j + 1) * W + i, (j + 1) * W + i + 1, i, j);
    }
    if (due()) { yield; due.reset(); }
  }
  return { N, inner };
}

// ---------- whole-template operations ----------
// rotate (3x3 row-major) + translate every vertex (and normal) from v0, and the obstacle list
export function xformAll(b, R, t, v0 = 0) {
  b.xform(v0, R, t[0], t[1], t[2]);
}
export function xpt(R, t, p) {
  return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2]];
}

// Drop every triangle lying entirely below y = yc (buried in the sediment) and compact the vertex arrays.
export function cutBelow(b, yc) {
  const P = b.P, I = b.I, keep = [], used = new Uint8Array(b.vc);
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k], c = I[k + 1], d = I[k + 2];
    if (P[a * 3 + 1] < yc && P[c * 3 + 1] < yc && P[d * 3 + 1] < yc) continue;
    keep.push(a, c, d); used[a] = used[c] = used[d] = 1;
  }
  const remap = new Int32Array(b.vc).fill(-1), NP = [], NN = [], NC = [], NF = [];
  let m = 0;
  for (let i = 0; i < b.vc; i++) {
    if (!used[i]) continue;
    remap[i] = m++;
    NP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); NN.push(b.N[i * 3], b.N[i * 3 + 1], b.N[i * 3 + 2]);
    NC.push(b.C[i * 3], b.C[i * 3 + 1], b.C[i * 3 + 2]); NF.push(b.F[i * 2], b.F[i * 2 + 1]);
  }
  for (let k = 0; k < keep.length; k++) keep[k] = remap[keep[k]];
  b.P = NP; b.N = NN; b.C = NC; b.F = NF; b.I = keep;
}

// Tight capsule cover of the geometry (template space, axis along z): vertices from `from` on (except the
// skipped ranges) are binned in cells (cx x cy x cz m); each occupied cell gets a capsule along z through
// its points' centre, radius = farthest point from that segment; neighbouring cells along z with similar
// capsules merge. Returns [[ax, ay, az, bx, by, bz, r], ...].
export function coverCapsules(b, { cx = 3.2, cy = 3.2, cz = 6, skip = [], maxN = 40, minPts = 3, yMin = -1e9 } = {}) {
  const P = b.P, n = b.vc, mask = new Uint8Array(n);
  for (const [a, e] of skip) mask.fill(1, a, Math.min(n, e));
  for (let i = 0; i < n; i++) if (P[i * 3 + 1] < yMin) mask[i] = 1;
  if (n > 9000) for (let i = 1; i < n; i += 2) mask[i] = 1; // every other vertex: the shells are dense enough
  const inSkip = (i) => mask[i] === 1;
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) {
    if (inSkip(i)) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (x0 > x1) return [];
  const NX = Math.max(1, Math.ceil((x1 - x0) / cx)), NY = Math.max(1, Math.ceil((y1 - y0) / cy)), NZ = Math.max(1, Math.ceil((z1 - z0) / cz));
  const dx = (x1 - x0) / NX + 1e-6, dy = (y1 - y0) / NY + 1e-6, dz = (z1 - z0) / NZ + 1e-6;
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    if (inSkip(i)) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const k = (Math.floor((z - z0) / dz) * NY + Math.floor((y - y0) / dy)) * NX + Math.floor((x - x0) / dx);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { k, n: 0, sx: 0, sy: 0, za: 1e9, zb: -1e9, pts: [] }));
    c.n++; c.sx += x; c.sy += y; if (z < c.za) c.za = z; if (z > c.zb) c.zb = z; c.pts.push(i);
  }
  const caps = [];
  for (const c of cells.values()) {
    if (c.n < minPts) continue;
    const mx = c.sx / c.n, my = c.sy / c.n;
    let r = 0;
    for (const i of c.pts) { const dx = P[i * 3] - mx, dy = P[i * 3 + 1] - my, d = dx * dx + dy * dy; if (d > r) r = d; }
    r = Math.sqrt(r);
    // shorten the segment by the radius (the caps cover the ends), never past the middle
    const zm = (c.za + c.zb) / 2, half = Math.max(0, (c.zb - c.za) / 2 - r * 0.7);
    let rr = 0;
    for (const i of c.pts) { const z = P[i * 3 + 2], dzz = Math.max(0, Math.abs(z - zm) - half), dx = P[i * 3] - mx, dy = P[i * 3 + 1] - my, d = dx * dx + dy * dy + dzz * dzz; if (d > rr) rr = d; }
    rr = Math.sqrt(rr);
    const ix = c.k % NX, iy = Math.floor(c.k / NX) % NY, iz = Math.floor(c.k / (NX * NY));
    caps.push({ ix, iy, iz, x: mx, y: my, a: zm - half, e: zm + half, r: rr });
  }
  // merge runs along z (same column, similar centre and radius)
  caps.sort((p, q) => p.ix - q.ix || p.iy - q.iy || p.iz - q.iz);
  const out = [];
  for (let k = 0; k < caps.length; k++) {
    const c = caps[k], last = out[out.length - 1];
    if (last && last.ix === c.ix && last.iy === c.iy && last.iz === c.iz - 1 && Math.abs(last.r - c.r) < 0.8 && Math.hypot(last.x - c.x, last.y - c.y) < 0.9) {
      const r = Math.max(last.r, c.r) + Math.hypot(last.x - c.x, last.y - c.y) * 0.5;
      last.x = (last.x + c.x) / 2; last.y = (last.y + c.y) / 2; last.e = c.e; last.r = r; last.iz = c.iz;
    } else out.push({ ...c });
  }
  out.sort((p, q) => q.r * (q.e - q.a + q.r) - p.r * (p.e - p.a + p.r));
  return out.slice(0, maxN).map((c) => [c.x, c.y, c.a, c.x, c.y, c.e, c.r]);
}
