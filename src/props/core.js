// Props infrastructure: geometry Builder -> immutable Template (generated once at startup),
// per-chunk merge Batches (one draw call per material, any number of variants), instancing helper,
// a floor sampler that reproduces the terrain mesh exactly, and flight-tube clearance tests.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash3i } from '../noise.js';

export const TUBE = 3.5;        // hard clearance radius around the camera path
export const TAU = Math.PI * 2;
export const CHUNK = 64;

// ---------- 3D value noise for geometry displacement ----------
export function vn3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h000 = hash3i(ix, iy, iz, seed), h100 = hash3i(ix + 1, iy, iz, seed);
  const h010 = hash3i(ix, iy + 1, iz, seed), h110 = hash3i(ix + 1, iy + 1, iz, seed);
  const h001 = hash3i(ix, iy, iz + 1, seed), h101 = hash3i(ix + 1, iy, iz + 1, seed);
  const h011 = hash3i(ix, iy + 1, iz + 1, seed), h111 = hash3i(ix + 1, iy + 1, iz + 1, seed);
  const a = h000 + (h100 - h000) * u, b = h010 + (h110 - h010) * u;
  const c = h001 + (h101 - h001) * u, d = h011 + (h111 - h011) * u;
  const e = a + (b - a) * v, f = c + (d - c) * v;
  return (e + (f - e) * w) * 2 - 1;
}
export function fbm3(x, y, z, oct = 3, seed = 0) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vn3(x * f, y * f, z * f, seed + i * 13); n += a; a *= 0.5; f *= 2.07; }
  return s / n;
}
export const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------- rotations (row-major 3x3) ----------
export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export function mul3(A, B) {
  const R = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return R;
}
// Rotation taking +Y to unit vector n (Rodrigues).
export function alignY(nx, ny, nz) {
  const ax = nz, az = -nx; // Y x n
  const sn = Math.hypot(ax, az);
  if (sn < 1e-5) return ny > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const kx = ax / sn, kz = az / sn, c = ny, t = 1 - c;
  return [
    t * kx * kx + c, -kz * sn, t * kx * kz,
    kz * sn, c, -kx * sn,
    t * kx * kz, kx * sn, t * kz * kz + c,
  ];
}
// yaw about local up, then tilt local up toward (nx,ny,nz) by `follow` (0..1), plus extra tilt.
export function orient(nx, ny, nz, follow, yaw, tiltX = 0, tiltZ = 0) {
  let ux = nx * follow, uy = 1 - follow + ny * follow, uz = nz * follow;
  const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
  let R = mul3(alignY(ux, uy, uz), rotY(yaw));
  if (tiltX || tiltZ) R = mul3(R, mul3(rotX(tiltX), rotZ(tiltZ)));
  return R;
}
export function applyR(R, x, y, z) {
  return [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
}

// ---------- unit icosphere cache ----------
const icoCache = new Map();
export function icosphere(detail) {
  let c = icoCache.get(detail);
  if (!c) {
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-5);
    c = { pos: Float32Array.from(g.attributes.position.array), idx: Uint32Array.from(g.index.array) };
    for (let i = 0; i < c.pos.length; i += 3) { // re-normalise
      const l = Math.hypot(c.pos[i], c.pos[i + 1], c.pos[i + 2]);
      c.pos[i] /= l; c.pos[i + 1] /= l; c.pos[i + 2] /= l;
    }
    g.dispose();
    icoCache.set(detail, c);
  }
  return c;
}

// ---------- Builder ----------
// Vertex format: position, normal, color (rgb), aFx (vec2: x = growth/sway/glow amount, y = mode/style)
export class Builder {
  constructor() { this.P = []; this.N = []; this.C = []; this.F = []; this.I = []; }
  get vc() { return this.P.length / 3; }
  v(x, y, z, nx = 0, ny = 1, nz = 0, r = 1, g = 1, b = 1, f0 = 0, f1 = 0) {
    this.P.push(x, y, z); this.N.push(nx, ny, nz); this.C.push(r, g, b); this.F.push(f0, f1);
    return this.P.length / 3 - 1;
  }
  t(a, b, c) { this.I.push(a, b, c); }
  // area-weighted smooth normals for vertices >= v0 from triangles >= i0
  smooth(v0 = 0, i0 = 0) {
    const P = this.P, N = this.N, I = this.I;
    for (let k = v0 * 3; k < N.length; k++) N[k] = 0;
    for (let k = i0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const q of [a, b, c]) if (q >= v0 * 3) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
    }
    for (let k = v0 * 3; k < N.length; k += 3) {
      const l = Math.hypot(N[k], N[k + 1], N[k + 2]) || 1;
      N[k] /= l; N[k + 1] /= l; N[k + 2] /= l;
    }
  }
  // paint(i, x,y,z, nx,ny,nz, out[r,g,b,f0,f1]) for vertices >= v0
  paint(v0, fn) {
    const o = [1, 1, 1, 0, 0], P = this.P, N = this.N;
    for (let i = v0; i < this.vc; i++) {
      o[0] = this.C[i * 3]; o[1] = this.C[i * 3 + 1]; o[2] = this.C[i * 3 + 2]; o[3] = this.F[i * 2]; o[4] = this.F[i * 2 + 1];
      fn(i, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], o);
      this.C[i * 3] = o[0]; this.C[i * 3 + 1] = o[1]; this.C[i * 3 + 2] = o[2]; this.F[i * 2] = o[3]; this.F[i * 2 + 1] = o[4];
    }
  }
  // transform vertices >= v0: p' = R*(s.p) + t
  xform(v0, R, tx = 0, ty = 0, tz = 0, sx = 1, sy = 1, sz = 1) {
    const P = this.P, N = this.N;
    for (let i = v0 * 3; i < P.length; i += 3) {
      const x = P[i] * sx, y = P[i + 1] * sy, z = P[i + 2] * sz;
      P[i] = R[0] * x + R[1] * y + R[2] * z + tx; P[i + 1] = R[3] * x + R[4] * y + R[5] * z + ty; P[i + 2] = R[6] * x + R[7] * y + R[8] * z + tz;
      const nx = N[i] / sx, ny = N[i + 1] / sy, nz = N[i + 2] / sz;
      let ax = R[0] * nx + R[1] * ny + R[2] * nz, ay = R[3] * nx + R[4] * ny + R[5] * nz, az = R[6] * nx + R[7] * ny + R[8] * nz;
      const l = Math.hypot(ax, ay, az) || 1; N[i] = ax / l; N[i + 1] = ay / l; N[i + 2] = az / l;
    }
  }
  // Param grid; fn(u, v, i, j, out[x,y,z,r,g,b,f0,f1]). Outward normal = dP/dv x dP/du.
  grid(nu, nv, fn, { wrapU = false, flip = false, smooth = true } = {}) {
    const v0 = this.vc, i0 = this.I.length, cols = wrapU ? nu : nu + 1;
    const o = [0, 0, 0, 1, 1, 1, 0, 0];
    for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) {
      o[3] = o[4] = o[5] = 1; o[6] = o[7] = 0;
      fn(i / nu, j / nv, i, j, o);
      this.v(o[0], o[1], o[2], 0, 1, 0, o[3], o[4], o[5], o[6], o[7]);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = v0 + j * cols + i, b = v0 + j * cols + ((i + 1) % cols), c = a + cols, d = b + cols;
      if (!flip) { this.t(a, c, b); this.t(b, c, d); } else { this.t(a, b, c); this.t(b, d, c); }
    }
    if (smooth) this.smooth(v0, i0);
    return v0;
  }
  // Displaced icosphere; fn(nx,ny,nz,out[x,y,z,r,g,b,f0,f1]) maps the unit direction to a point.
  blob(detail, fn) {
    const ico = icosphere(detail), v0 = this.vc, i0 = this.I.length;
    const o = [0, 0, 0, 1, 1, 1, 0, 0];
    for (let k = 0; k < ico.pos.length; k += 3) {
      o[3] = o[4] = o[5] = 1; o[6] = o[7] = 0;
      fn(ico.pos[k], ico.pos[k + 1], ico.pos[k + 2], o);
      this.v(o[0], o[1], o[2], 0, 1, 0, o[3], o[4], o[5], o[6], o[7]);
    }
    for (let k = 0; k < ico.idx.length; k++) this.I.push(v0 + ico.idx[k]);
    this.smooth(v0, i0);
    return v0;
  }
  // Generalised cylinder along pts ([x,y,z]...), radii per point. paint(v, ang, x,y,z, out) optional.
  tube(pts, radii, radial, paint, { tip = false, cap = false } = {}) {
    const n = pts.length, T = [], N1 = [], N2 = [];
    for (let j = 0; j < n; j++) {
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      let nx, ny, nz;
      if (j === 0) { // any perpendicular
        if (Math.abs(ty) < 0.9) { nx = tz; ny = 0; nz = -tx; } else { nx = 0; ny = -tz; nz = ty; }
      } else { [nx, ny, nz] = N1[j - 1]; }
      const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz;
      const m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m;
      T.push([tx, ty, tz]); N1.push([nx, ny, nz]);
      N2.push([ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx]); // N1 x T
    }
    const iStart = this.I.length;
    const v0 = this.grid(radial, n - 1, (u, v, i, j, o) => {
      const a = u * TAU, c = Math.cos(a), s = Math.sin(a), r = radii[j], p = pts[j], A = N1[j], B = N2[j];
      o[0] = p[0] + r * (c * A[0] + s * B[0]); o[1] = p[1] + r * (c * A[1] + s * B[1]); o[2] = p[2] + r * (c * A[2] + s * B[2]);
      if (paint) paint(v, a, o[0], o[1], o[2], o, j);
    }, { wrapU: true, smooth: false });
    if (tip || cap) {
      const j = n - 1, p = pts[j], t = T[j], r = radii[j];
      const o = [0, 0, 0, this.C[(v0 + j * radial) * 3], this.C[(v0 + j * radial) * 3 + 1], this.C[(v0 + j * radial) * 3 + 2], this.F[(v0 + j * radial) * 2], this.F[(v0 + j * radial) * 2 + 1]];
      const ext = tip ? r * 1.2 : 0;
      const A = this.v(p[0] + t[0] * ext, p[1] + t[1] * ext, p[2] + t[2] * ext, t[0], t[1], t[2], o[3], o[4], o[5], o[6], o[7]);
      const base = v0 + j * radial;
      for (let i = 0; i < radial; i++) this.t(base + ((i + 1) % radial), base + i, A);
    }
    this.smooth(v0, iStart);
    return v0;
  }
  // lathe: profile(v) -> [r, y]; rad(ang, v) multiplier; paint(v, ang, x,y,z,out)
  lathe(nu, nv, profile, rad, paint, opts = {}) {
    return this.grid(nu, nv, (u, v, i, j, o) => {
      const a = u * TAU, [r0, y] = profile(v), r = r0 * (rad ? rad(a, v) : 1);
      o[0] = Math.cos(a) * r; o[1] = y; o[2] = Math.sin(a) * r;
      if (paint) paint(v, a, o[0], o[1], o[2], o);
    }, { wrapU: true, flip: !!opts.flip });
  }
  // flat-shaded box (24 verts) centred at origin, then transformed
  box(w, h, d, R = null, tx = 0, ty = 0, tz = 0, col = [1, 1, 1], fx = [0, 0]) {
    const v0 = this.vc, x = w / 2, y = h / 2, z = d / 2;
    const F = [
      [[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]],
      [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]],
      [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]],
      [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]],
      [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
      [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
    ];
    for (const [n, q] of F) {
      const b = this.vc;
      for (const p of q) this.v(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], fx[0], fx[1]);
      this.t(b, b + 1, b + 2); this.t(b, b + 2, b + 3);
    }
    if (R || tx || ty || tz) this.xform(v0, R || [1, 0, 0, 0, 1, 0, 0, 0, 1], tx, ty, tz);
    return v0;
  }
  // append another builder's content
  append(o) {
    const off = this.vc;
    for (let i = 0; i < o.P.length; i++) { this.P.push(o.P[i]); this.N.push(o.N[i]); this.C.push(o.C[i]); }
    for (let i = 0; i < o.F.length; i++) this.F.push(o.F[i]);
    for (let i = 0; i < o.I.length; i++) this.I.push(o.I[i] + off);
  }
  build() { return new Template(this); }
}

// vertex positions satisfying pred(y), at most `max`: spatially stratified so every part of the band
// (each paw, each leg) keeps its extreme point (lowest for a foot band, highest for a head band),
// then filled evenly. Returns { pts, box: [x0, z0, x1, z1] of the whole band }.
function bandPoints(pos, pred, max, low = true) {
  const idx = [];
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < pos.length; i += 3) if (pred(pos[i + 1])) {
    idx.push(i);
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
  }
  let pick = idx;
  if (idx.length > max) {
    const g = 7, cx = (x1 - x0) / g + 1e-6, cz = (z1 - z0) / g + 1e-6, best = new Map();
    for (const i of idx) {
      const k = Math.min(g - 1, Math.floor((pos[i] - x0) / cx)) * g + Math.min(g - 1, Math.floor((pos[i + 2] - z0) / cz)), b = best.get(k);
      if (b === undefined || (low ? pos[i + 1] < pos[b + 1] : pos[i + 1] > pos[b + 1])) best.set(k, i);
    }
    const set = new Set(best.values()), step = idx.length / Math.max(1, max - set.size);
    for (let k = 0; k < idx.length && set.size < max; k += step) set.add(idx[Math.floor(k)]);
    pick = [...set];
  }
  const out = [];
  for (const i of pick) out.push(pos[i], pos[i + 1], pos[i + 2]);
  return { pts: Float32Array.from(out), box: [x0, z0, x1, z1] };
}

// ---------- Template: immutable geometry variant ----------
export class Template {
  constructor(b) {
    this.pos = Float32Array.from(b.P); this.nor = Float32Array.from(b.N);
    this.col = Float32Array.from(b.C); this.fx = Float32Array.from(b.F);
    this.idx = Uint32Array.from(b.I);
    this.vc = this.pos.length / 3; this.tris = this.idx.length / 3;
    let minY = 1e9, maxY = -1e9, r = 0;
    for (let i = 0; i < this.pos.length; i += 3) {
      const y = this.pos[i + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y;
      r = Math.max(r, Math.hypot(this.pos[i], this.pos[i + 2]));
    }
    this.minY = minY; this.maxY = maxY; this.r = r; this.h = maxY;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < this.pos.length; i += 3) {
      x0 = Math.min(x0, this.pos[i]); x1 = Math.max(x1, this.pos[i]); z0 = Math.min(z0, this.pos[i + 2]); z1 = Math.max(z1, this.pos[i + 2]);
    }
    this.box = [x0, minY, z0, x1, maxY, z1];
    this.obs = b.obs || null;      // explicit obstacle capsules [ax,ay,az,bx,by,bz,r] (template space)
    this.label = b.label || null;  // common name for the "i" overlay
    this.fact = b.fact || null;    // optional one-line fun fact for the overlay
    this.solid = b.solid ?? true;
    this.support = b.support || false; // other props may rest on top of it (exact top-surface raycast)
    this.drape = b.drape || false;     // flat patch: follows the floor mesh vertex by vertex
    this.dLift = b.dLift || 0;         // draped patches: raise the base this much (thin things lie ON the sand)
    // contact band (what touches the ground) and head band (what touches a ceiling), template space
    const band = b.band ?? Math.max(0.02, 0.06 * (maxY - minY)); // b.band: explicit override
    this.band = band;
    const fb = bandPoints(this.pos, (y) => y <= minY + band, 96, true);
    this.foot = fb.pts; this.footBox = fb.box;
    this.head = bandPoints(this.pos, (y) => y >= maxY - band, 64, false).pts;
    this._geo = null; this._pts = null; this._rb = null;
  }
  // Few-point contact set for small footprints: the band's convex hull in xz plus its 4 lowest points.
  get footFew() {
    if (this._ff) return this._ff;
    const F = this.foot, n = F.length / 3;
    if (n <= 16) return (this._ff = F);
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => F[a * 3] - F[b * 3] || F[a * 3 + 2] - F[b * 3 + 2]);
    const cross = (o, a, b) => (F[a * 3] - F[o * 3]) * (F[b * 3 + 2] - F[o * 3 + 2]) - (F[a * 3 + 2] - F[o * 3 + 2]) * (F[b * 3] - F[o * 3]);
    const lo = [], hi = [];
    for (const i of idx) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
    let hull = lo.slice(0, -1).concat(hi.slice(0, -1));
    if (hull.length > 12) { const st = hull.length / 12; hull = Array.from({ length: 12 }, (_, k) => hull[Math.floor(k * st)]); }
    const low = Array.from({ length: n }, (_, i) => i).sort((a, b) => F[a * 3 + 1] - F[b * 3 + 1]).slice(0, 4);
    const out = [];
    for (const i of new Set([...hull, ...low])) out.push(F[i * 3], F[i * 3 + 1], F[i * 3 + 2]);
    return (this._ff = Float32Array.from(out));
  }
  // Height of the BOTTOM surface along the vertical line through local (lx, lz); +Infinity if none.
  rayUp(lx, lz) {
    const R = this._rb || this._buildRay();
    const i = Math.floor((lx - R.x0) / R.cs), j = Math.floor((lz - R.z0) / R.cs);
    if (i < 0 || j < 0 || i >= R.n || j >= R.n) return Infinity;
    const list = R.cells[j * R.n + i];
    if (!list) return Infinity;
    const P = this.pos, I = this.idx;
    let best = Infinity;
    for (let q = 0; q < list.length; q++) {
      const t = list[q] * 3, a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const x0 = P[a], z0 = P[a + 2], x1 = P[b], z1 = P[b + 2], x2 = P[c], z2 = P[c + 2];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (d > -1e-12 && d < 1e-12) continue;
      const w0 = ((z1 - z2) * (lx - x2) + (x2 - x1) * (lz - z2)) / d;
      const w1 = ((z2 - z0) * (lx - x2) + (x0 - x2) * (lz - z2)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[c + 1];
      if (y < best) best = y;
    }
    return best;
  }
  // Exact height of the TOP surface along the vertical line through local (lx, lz); -Infinity if none.
  rayDown(lx, lz) {
    const R = this._rb || this._buildRay();
    const i = Math.floor((lx - R.x0) / R.cs), j = Math.floor((lz - R.z0) / R.cs);
    if (i < 0 || j < 0 || i >= R.n || j >= R.n) return -Infinity;
    const list = R.cells[j * R.n + i];
    if (!list) return -Infinity;
    const P = this.pos, I = this.idx;
    let best = -Infinity;
    for (let q = 0; q < list.length; q++) {
      const t = list[q] * 3, a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const x0 = P[a], z0 = P[a + 2], x1 = P[b], z1 = P[b + 2], x2 = P[c], z2 = P[c + 2];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (d > -1e-12 && d < 1e-12) continue;
      const w0 = ((z1 - z2) * (lx - x2) + (x2 - x1) * (lz - z2)) / d;
      const w1 = ((z2 - z0) * (lx - x2) + (x0 - x2) * (lz - z2)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[c + 1];
      if (y > best) best = y;
    }
    return best;
  }
  _buildRay() {
    const [x0, , z0, x1, , z1] = this.box, ext = Math.max(x1 - x0, z1 - z0, 1e-3);
    const n = Math.max(4, Math.min(48, Math.round(ext / 0.18))), cs = ext / n * 1.0001;
    const cells = new Array(n * n), P = this.pos, I = this.idx;
    for (let t = 0; t < I.length / 3; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const i0 = Math.max(0, Math.floor((Math.min(P[a], P[b], P[c]) - x0) / cs)), i1 = Math.min(n - 1, Math.floor((Math.max(P[a], P[b], P[c]) - x0) / cs));
      const j0 = Math.max(0, Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z0) / cs)), j1 = Math.min(n - 1, Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z0) / cs));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * n + i; (cells[k] || (cells[k] = [])).push(t); }
    }
    return (this._rb = { x0, z0, cs, n, cells });
  }
  // obstacle capsules: explicit, or one capsule fitted to the bounding box (kept for other callers;
  // registerItems() uses explicit ones or capsules() fitted at the item's real scale)
  obstacles() {
    if (this.obs) return this.obs;
    if (this._obsBox) return this._obsBox;
    const [x0, y0, z0, x1, y1, z1] = this.box;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
    if (hy >= Math.max(hx, hz)) { const r = Math.max(hx, hz); this._obsBox = [[cx, y0 + r * 0.8, cz, cx, Math.max(y0 + r * 0.8, y1 - r * 0.8), cz, r]]; }
    else if (hx >= hz) { const r = Math.max(hy, hz); this._obsBox = [[x0 + r * 0.8, cy, cz, Math.max(x0 + r * 0.8, x1 - r * 0.8), cy, cz, r]]; }
    else { const r = Math.max(hy, hx); this._obsBox = [[cx, cy, z0 + r * 0.8, cx, cy, Math.max(z0 + r * 0.8, z1 - r * 0.8), r]]; }
    return this._obsBox;
  }
  // Obstacle capsules fitted to the mesh for an item scaled (1, ry, rz) relative to its x scale: a chain
  // along the longest axis for roundish cross-sections, parallel rows for flat shapes; every vertex lies
  // inside a capsule. Cached per half-octave scale class (ordinary +-15% jitter shares one fit; the caller
  // scales the radius by the leftover ratio). Returns { list: [[ax,ay,az,bx,by,bz,r]], fy, fz }
  // in that normalised space (multiply by the item's x scale, correct y/z by ry/fy, rz/fz).
  capsules(ry, rz, maxK = 6) {
    const qy = Math.round(Math.log2(ry) * 2), qz = Math.round(Math.log2(rz) * 2), key = (qy * 1000 + qz) * 8 + maxK;
    const cache = this._caps || (this._caps = new Map());
    let out = cache.get(key);
    if (out) return out;
    // at most ~700 vertices (evenly strided) take part in the fit; the radius gets a small margin for the rest
    const fy = 2 ** (qy / 2), fz = 2 ** (qz / 2), P = this.pos, stp = Math.max(1, Math.ceil(this.vc / 700)), n = Math.ceil(this.vc / stp), X = new Float32Array(n * 3);
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < n; i++) {
      const v = i * stp;
      X[i * 3] = P[v * 3]; X[i * 3 + 1] = P[v * 3 + 1] * fy; X[i * 3 + 2] = P[v * 3 + 2] * fz;
      for (let a = 0; a < 3; a++) { const v = X[i * 3 + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
    }
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], ord = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
    const a1 = ord[0], a2 = ord[1], a3 = ord[2], L = ext[a1], M = ext[a2], S = Math.max(ext[a3], 0.05);
    const flat = M > 1.6 * S;
    // groups: slices along the long axis (roundish) or strips across the middle axis (flat)
    const k = L < 0.6 || maxK === 1 ? 1 : flat ? Math.max(2, Math.min(maxK, Math.ceil(M / (2.2 * S)))) : Math.max(1, Math.min(maxK, Math.round(L / (1.5 * Math.max(M, 0.05)))));
    const ga = flat ? a2 : a1, gw = ext[ga] / k, list = [];
    for (let j = 0; j < k; j++) {
      const ja = lo[ga] + (j - 0.05) * gw, jb = lo[ga] + (j + 1.05) * gw;
      let c2 = 0, c3 = 0, m = 0, u0 = 1e9, u1 = -1e9;
      for (let i = 0; i < n; i++) {
        const g = X[i * 3 + ga]; if (g < ja || g > jb) continue;
        c2 += X[i * 3 + a2]; c3 += X[i * 3 + a3]; m++;
        const u = X[i * 3 + a1]; if (u < u0) u0 = u; if (u > u1) u1 = u;
      }
      if (!m) continue;
      c2 /= m; c3 /= m;
      let rp = 0;
      for (let i = 0; i < n; i++) { const g = X[i * 3 + ga]; if (g >= ja && g <= jb) rp = Math.max(rp, Math.hypot(X[i * 3 + a2] - c2, X[i * 3 + a3] - c3)); }
      const inset = Math.min(rp * 0.6, (u1 - u0) / 2), e0 = u0 + inset, e1 = u1 - inset;
      let r = 0; // exact containment: farthest group vertex from the segment
      for (let i = 0; i < n; i++) {
        const g = X[i * 3 + ga]; if (g < ja || g > jb) continue;
        const u = X[i * 3 + a1], du = u < e0 ? e0 - u : u > e1 ? u - e1 : 0;
        r = Math.max(r, Math.hypot(du, X[i * 3 + a2] - c2, X[i * 3 + a3] - c3));
      }
      const A = [0, 0, 0], B = [0, 0, 0];
      A[a1] = e0; B[a1] = e1; A[a2] = B[a2] = c2; A[a3] = B[a3] = c3;
      list.push([A[0], A[1], A[2], B[0], B[1], B[2], stp > 1 ? r * 1.04 : r]);
    }
    out = { list, fy, fz };
    cache.set(key, out);
    return out;
  }
  // shared BufferGeometry for instancing (never disposed)
  geometry() {
    if (!this._geo) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
      g.setAttribute('aFx', new THREE.BufferAttribute(this.fx, 2));
      g.setIndex(new THREE.BufferAttribute(this.vc > 65535 ? this.idx : Uint16Array.from(this.idx), 1));
      g.computeBoundingSphere();
      this._geo = g;
    }
    return this._geo;
  }
  // subsample of vertices for clearance tests of big set pieces
  points(max = 300) {
    const C = this._pts || (this._pts = new Map());
    let p = C.get(max);
    if (!p) {
      const step = Math.max(1, Math.floor(this.vc / max));
      p = [];
      for (let i = 0; i < this.vc; i += step) p.push(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      C.set(max, p);
    }
    return p;
  }
  // Contact band for a heavily tilted placement (lying trees, toppled drums, capsized hulls): the lowest
  // band of vertices in WORLD orientation. Returns world-relative offsets [dx, dy, dz, ...] (z = local z).
  tiltFoot(R, sx, sy, sz, max = 64) {
    const P = this.pos, n = this.vc, wy = new Float32Array(n);
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < n; i++) {
      const y = R[3] * P[i * 3] * sx + R[4] * P[i * 3 + 1] * sy + R[5] * P[i * 3 + 2] * sz;
      wy[i] = y; if (y < lo) lo = y; if (y > hi) hi = y;
    }
    const band = Math.max(0.02, 0.06 * (hi - lo)), idx = [];
    for (let i = 0; i < n; i++) if (wy[i] <= lo + band) idx.push(i);
    const step = Math.max(1, idx.length / max), out = [];
    for (let k = 0; k < idx.length; k += step) {
      const i = idx[Math.floor(k)], px = P[i * 3] * sx, py = P[i * 3 + 1] * sy, pz = P[i * 3 + 2] * sz;
      out.push(R[0] * px + R[1] * py + R[2] * pz, wy[i], R[6] * px + R[7] * py + R[8] * pz);
    }
    return out;
  }
}

// ---------- Batch: merges template instances into one mesh per chunk ----------
export class Batch {
  // lod: null (always drawn), 'mid' or 'near' (the core hides these with distance)
  constructor(material, maxTris = 120000, lod = null) {
    this.mat = material; this.max = maxTris; this.items = []; this.vc = 0; this.ic = 0; this.lod = lod;
  }
  get tris() { return this.ic / 3; }
  // place template with rotation R (row-major 3x3), scale, tint and fx.x multiplier
  add(tpl, x, y, z, R, sx, sy = sx, sz = sx, cr = 1, cg = 1, cb = 1, fa = 1) {
    if (!tpl || (this.ic + tpl.idx.length) / 3 > this.max) return false;
    this.items.push({ tpl, x, y, z, R, sx, sy, sz, cr, cg, cb, fa, ko: 0, lbl: null, name: null, fact: null, g: 0, hang: 0, drape: null, s0: 0 });
    this.vc += tpl.vc; this.ic += tpl.idx.length;
    return true;
  }
  // per-instance extras for the last added item: texture-key offset, label override (lbl: a showpiece such as a
  // giant, ranked first for labels; it.name: a plain per-placement name such as a regional species)
  tag(ko, lbl, fact = null) { const it = this.items[this.items.length - 1]; if (it) { it.ko = ko; it.lbl = lbl; if (fact) it.fact = fact; } }
  get last() { return this.items[this.items.length - 1]; }
  // Split items into n slices of similar vertex count; build(k, n) merges slice k only.
  build(k = 0, n = 1, pad = 1) {
    if (!this.items.length) return null;
    let i0 = 0, i1 = this.items.length;
    if (n > 1) {
      const per = this.vc / n;
      let acc = 0, part = 0; i0 = -1; i1 = this.items.length;
      for (let i = 0; i < this.items.length; i++) {
        const p = Math.min(n - 1, Math.floor(acc / per));
        if (p === k && i0 < 0) i0 = i;
        if (p > k) { i1 = i; break; }
        acc += this.items[i].tpl.vc;
      }
      if (i0 < 0 || i0 >= i1) return null;
    }
    let vc = 0, ic = 0;
    for (let i = i0; i < i1; i++) { vc += this.items[i].tpl.vc; ic += this.items[i].tpl.idx.length; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
    const col = new Float32Array(vc * 3), fx = new Float32Array(vc * 2);
    const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
    let vo = 0, io = 0;
    for (let q = i0; q < i1; q++) {
      const it = this.items[q];
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
        // draped patches follow the floor mesh exactly, vertex by vertex
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
        // rock/stone texture keys (6.x) and brain-groove keys (0.6..1.4) shift per instance
        fx[fo + i + 1] = ko && m > 5.5 && m < 6.99 ? 6.05 + ((m - 6.05 + ko) % 0.9) : ko && m > 0.55 && m < 1.45 ? 0.6 + ((m - 0.6 + ko * 0.8) % 0.8) : m;
      }
      const I = t.idx;
      for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo;
      vo += nv; io += I.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aFx', new THREE.BufferAttribute(fx, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.boundingSphere.radius += pad;
    releaseAfterUpload(g);
    const m = new THREE.Mesh(g, this.mat);
    m.matrixAutoUpdate = false;
    if (this.lod) m.userData.lod = this.lod;
    return m;
  }
}

// Free CPU-side vertex data once the GPU has it (less heap / GC pressure while streaming).
// Set window.__propsKeepArrays = true before load to keep them for debugging.
function dropArray() { this.array = null; }
export function releaseAfterUpload(g) {
  if (typeof window !== 'undefined' && window.__propsKeepArrays) return;
  for (const k in g.attributes) g.attributes[k].onUpload(dropArray);
  if (g.index) g.index.onUpload(dropArray);
}

// ---------- Instanced helper (shared template geometry, per-chunk instance buffers) ----------
export class Inst {
  constructor(tpl, material, max, lod = null) {
    this.tpl = tpl; this.mat = material; this.max = max; this.n = 0; this.lod = lod;
    this.m = null; this.c = null; // typed buffers, allocated on the first add (no array growth, little garbage)
    this.items = typeof window !== 'undefined' && (window.__propsAudit || window.__propsGapCheck) ? [] : null; // debug: contact audit
  }
  get count() { return this.n; }
  get tris() { return this.n * this.tpl.tris; }
  add(x, y, z, R, sx, sy = sx, sz = sx, r = 1, g = 1, b = 1) {
    if (this.n >= this.max) return false;
    if (!this.m) { this.m = new Float32Array(this.max * 16); this.c = new Float32Array(this.max * 3); }
    // column-major 4x4 for InstancedMesh
    const M = this.m, o = this.n * 16, oc = this.n * 3;
    M[o] = R[0] * sx; M[o + 1] = R[3] * sx; M[o + 2] = R[6] * sx; M[o + 3] = 0;
    M[o + 4] = R[1] * sy; M[o + 5] = R[4] * sy; M[o + 6] = R[7] * sy; M[o + 7] = 0;
    M[o + 8] = R[2] * sz; M[o + 9] = R[5] * sz; M[o + 10] = R[8] * sz; M[o + 11] = 0;
    M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
    this.c[oc] = r; this.c[oc + 1] = g; this.c[oc + 2] = b;
    this.n++;
    if (this.items) this.items.push({ tpl: this.tpl, x, y, z, R, sx, sy, sz, g: 1 });
    return true;
  }
  build() {
    const n = this.n;
    if (!n) return null;
    const im = new THREE.InstancedMesh(this.tpl.geometry(), this.mat, n);
    im.instanceMatrix.array.set(this.m.subarray(0, n * 16));
    im.instanceColor = new THREE.InstancedBufferAttribute(this.c.slice(0, n * 3), 3);
    im.computeBoundingSphere();
    im.boundingSphere.radius += 1;
    im.matrixAutoUpdate = false;
    if (this.lod) im.userData.lod = this.lod;
    this.m = this.c = null;
    return im;
  }
}

// ---------- Floor sampler: reproduces the terrain mesh (1.5 m grid, same triangle split) ----------
const DXG = 1.5, NZG = 43, DZG = CHUNK / (NZG - 1);
const grounds = new WeakMap();
// Per-chunk ground: floor mesh + every registered support prop (rocks, mounds, steps, arches...).
// Same API as before (at(x, s) + nx/ny/nz), so existing callers now land on supports too.
export function floorSampler(ctx) { return groundOf(ctx); }
// Ceiling mesh sampler for the chunk (same lattice and triangle split as the rendered ceiling), cached:
// node heights are fetched once, so ceiling-hung props cost a few lookups instead of exact evaluations.
const ceils = new WeakMap();
export function ceilSampler(ctx) {
  let c = ceils.get(ctx.group);
  if (!c) { c = new FloorSampler(ctx, (x, s) => ctx.ceilingAt(x, s)); ceils.set(ctx.group, c); }
  return c;
}
export function groundOf(ctx) {
  let g = grounds.get(ctx.group);
  if (!g) { g = new Ground(ctx); grounds.set(ctx.group, g); }
  return g;
}
const hkey = (i, j) => (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) | 0;
export class Ground {
  constructor(ctx) {
    this.ctx = ctx; this.fs = new FloorSampler(ctx); this.s0 = ctx.s0;
    this.hash = new Map(); this.list = []; this.occ = new Set();
    this.nx = 0; this.ny = 1; this.nz = 0;
  }
  // floor mesh only
  floor(x, s) { const h = this.fs.at(x, s); this.nx = this.fs.nx; this.ny = this.fs.ny; this.nz = this.fs.nz; return h; }
  // top-most surface at (x, s): floor or any support prop (optionally ignoring one item)
  at(x, s, exclude = null) {
    let h = this.floor(x, s);
    const cell = this.hash.get(hkey(Math.floor(x / 4), Math.floor(s / 4)));
    if (!cell) return h;
    let best = null;
    for (let i = 0; i < cell.length; i++) {
      const sp = cell[i];
      if (sp.it === exclude) continue;
      const dx = x - sp.x, ds = s - sp.s;
      if (dx * dx + ds * ds > sp.r2) continue;
      const y = this.supH(sp, x, s);
      if (y > h) { h = y; best = sp; }
    }
    if (best) {
      const e = 0.15, a = this.supH(best, x - e, s), b = this.supH(best, x + e, s), c = this.supH(best, x, s - e), d = this.supH(best, x, s + e);
      if (a > -1e8 && b > -1e8 && c > -1e8 && d > -1e8) {
        const gx = (b - a) / (2 * e), gs = (d - c) / (2 * e), l = Math.sqrt(gx * gx + 1 + gs * gs);
        this.nx = -gx / l; this.ny = 1 / l; this.nz = gs / l;
      } else { this.nx = 0; this.ny = 1; this.nz = 0; }
    }
    return h;
  }
  // height only (no normal): the fast path for contact-band seating and the audit
  h(x, s, exclude = null) {
    let h = this.fs.at(x, s);
    const cell = this.hash.get(hkey(Math.floor(x / 4), Math.floor(s / 4)));
    if (!cell) return h;
    for (let i = 0; i < cell.length; i++) {
      const sp = cell[i];
      if (sp.it === exclude) continue;
      const dx = x - sp.x, ds = s - sp.s;
      if (dx * dx + ds * ds > sp.r2) continue;
      const y = this.supH(sp, x, s);
      if (y > h) h = y;
    }
    return h;
  }
  // is (x, s) on top of a support (rather than the bare floor)?
  onSupport(x, s, tol = 0.02) { const f = this.fs.at(x, s); return this.at(x, s) > f + tol; }
  supH(sp, x, s) {
    const dx = x - sp.x, dz = -(s - sp.s);
    const ly = sp.tpl.rayDown((sp.c * dx - sp.sn * dz) / sp.sx, (sp.sn * dx + sp.c * dz) / sp.sz);
    return ly === -Infinity ? -1e9 : sp.y + ly * sp.sy;
  }
  // register a placed batch item (yaw-only rotation) as something others can rest on. A template may name
  // a support proxy (tpl.supTpl, same space): its solid body without thin plates and branches, so what
  // settles on it never perches on a plate's edge.
  addSupport(it, s) {
    const R = it.R;
    if (Math.abs(R[4] - 1) > 1e-4) return null;
    const rad = it.tpl.r * Math.max(it.sx, it.sz) + 0.2;
    const sp = { it, tpl: it.tpl.supTpl || it.tpl, x: it.x, y: it.y, s, c: R[0], sn: R[2], sx: it.sx, sy: it.sy, sz: it.sz, r2: rad * rad };
    for (let i = Math.floor((sp.x - rad) / 4); i <= Math.floor((sp.x + rad) / 4); i++) {
      for (let j = Math.floor((s - rad) / 4); j <= Math.floor((s + rad) / 4); j++) {
        const k = hkey(i, j); let a = this.hash.get(k);
        if (!a) this.hash.set(k, (a = []));
        a.push(sp);
      }
    }
    this.list.push(sp);
    return sp;
  }
  // footprint occupancy (1 m cells, per layer) so big props do not interpenetrate
  free(x, s, r, layer = 0) {
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let j = Math.floor(s - r); j <= Math.floor(s + r); j++) {
      const cx = i + 0.5 - x, cs = j + 0.5 - s;
      if (cx * cx + cs * cs <= (r + 0.35) * (r + 0.35) && this.occ.has(hkey(i, j) ^ (layer * 1640531527))) return false;
    }
    return true;
  }
  occupy(x, s, r, layer = 0) {
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let j = Math.floor(s - r); j <= Math.floor(s + r); j++) {
      const cx = i + 0.5 - x, cs = j + 0.5 - s;
      if (cx * cx + cs * cs <= (r + 0.35) * (r + 0.35)) this.occ.add(hkey(i, j) ^ (layer * 1640531527));
    }
  }
}
export class FloorSampler {
  // sample(x, s): the surface whose mesh lattice this reproduces (the floor by default; also used for ceilings)
  constructor(ctx, sample = null) {
    this.ctx = ctx; this.s0 = ctx.s0; this.sample = sample || ((x, s) => ctx.floorAt(x, s));
    this.k0 = Math.round(ctx.xMin / DXG);
    this.W = Math.round((ctx.xMax - ctx.xMin) / DXG) + 1;
    this.h = new Float32Array(this.W * NZG).fill(NaN);
    this.nx = 0; this.ny = 1; this.nz = 0;
  }
  node(i, j) {
    if (i < 0 || j < 0 || i >= this.W || j >= NZG) return this.sample((this.k0 + i) * DXG, this.s0 + j * DZG); // same global lattice
    const o = j * this.W + i;
    let v = this.h[o];
    if (v !== v) { v = this.sample((this.k0 + i) * DXG, this.s0 + j * DZG); this.h[o] = v; }
    return v;
  }
  // floor height at (x, s); sets this.nx/ny/nz (local frame normal, z = -s)
  at(x, s) {
    const u = x / DXG - this.k0, v = (s - this.s0) / DZG;
    const i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    const ha = this.node(i, j), hb = this.node(i + 1, j), hc = this.node(i, j + 1), hd = this.node(i + 1, j + 1);
    let h, gx, gs;
    if (fu + fv <= 1) { h = ha + (hb - ha) * fu + (hc - ha) * fv; gx = (hb - ha) / DXG; gs = (hc - ha) / DZG; }
    else { h = hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv); gx = (hd - hc) / DXG; gs = (hd - hb) / DZG; }
    const l = Math.sqrt(gx * gx + 1 + gs * gs);
    this.nx = -gx / l; this.ny = 1 / l; this.nz = gs / l;
    return h;
  }
}

// ---------- flight-tube clearance ----------
// Object occupying x +- r horizontally, s +- r, heights [yLo, yHi]
export function tubeClear(ctx, x, s, yLo, yHi, r = 0, margin = 0.35, tube = TUBE) {
  const lim = tube + margin;
  for (let k = -1; k <= 1; k++) {
    if (r === 0 && k !== 0) continue;
    const ss = s + k * r, px = ctx.pathX(ss), py = ctx.pathY(ss);
    const dx = Math.max(0, Math.abs(x - px) - r);
    const dy = py < yLo ? yLo - py : py > yHi ? py - yHi : 0;
    if (dx * dx + dy * dy < lim * lim) return false;
  }
  return true;
}
// 1 m table of the path around the chunk (built on first use), linear in between
function pathTab(ctx) {
  let P = ctx._pathTab;
  if (!P) {
    const a = ctx.s0 - 80, n = Math.ceil(ctx.s1 - ctx.s0) + 162, X = new Float32Array(n), Y = new Float32Array(n);
    for (let i = 0; i < n; i++) { X[i] = ctx.pathX(a + i); Y[i] = ctx.pathY(a + i); }
    P = ctx._pathTab = { a, n, X, Y };
  }
  return P;
}
// flat array of global [x, y, s] points
export function pointsClear(ctx, pts, margin = 0.5) {
  const lim = (TUBE + margin) * (TUBE + margin), P = pathTab(ctx), X = P.X, Y = P.Y;
  for (let i = 0; i < pts.length; i += 3) {
    const s = pts[i + 2], u = s - P.a;
    let px, py;
    if (u >= 0 && u < P.n - 1) { const k = u | 0, f = u - k; px = X[k] + (X[k + 1] - X[k]) * f; py = Y[k] + (Y[k + 1] - Y[k]) * f; }
    else { px = ctx.pathX(s); py = ctx.pathY(s); }
    const dx = pts[i] - px, dy = pts[i + 1] - py;
    if (dx * dx + dy * dy < lim) return false;
  }
  return true;
}
// transform template sample points into global [x, y, s]
export function placedPoints(tpl, x, y, s, R, sx, sy = sx, sz = sx, max = 300) {
  const p = tpl.points(max), out = [];
  for (let i = 0; i < p.length; i += 3) {
    const a = p[i] * sx, b = p[i + 1] * sy, c = p[i + 2] * sz;
    out.push(R[0] * a + R[1] * b + R[2] * c + x, R[3] * a + R[4] * b + R[5] * c + y, s - (R[6] * a + R[7] * b + R[8] * c));
  }
  return out;
}

// Max biome weight over the chunk (0 => skip populator)
export function presence(ctx, key) {
  let w = 0;
  for (let k = 0; k <= 4; k++) w = Math.max(w, ctx.weightOf(ctx.s0 + k * 16, key));
  return w;
}

// Staged populators: stage 0 runs layout(ctx) -> { batches, extra, more } and caches it per chunk.
// `more` (optional) is a list of small continuation functions that keep filling the same batches; each
// later stage runs as many as fit in STAGE_BUDGET ms, so heavy layouts never hitch a frame. Then the
// batches are sliced and obstacles / labels registered (more continuation steps, same budget), and the
// merge work goes out one job per stage (<= VERTS_PER_STAGE vertices). The last stage flushes whatever is left.
const VERTS_PER_STAGE = 10000, STAGE_BUDGET = 2; // vertices per merge stage; ms of layout continuations per stage
const morton = (i, j) => { let k = 0; for (let b = 0; b < 4; b++) k |= ((i >> b) & 1) << (2 * b) | ((j >> b) & 1) << (2 * b + 1); return k; };
export function staged(layout, nBuild = 96) { // ~3x the stages a reef chunk needs here; an idle stage costs ~1 us
  const cache = new WeakMap();
  const plan = (ctx, L) => { // slice into merge jobs; queue the registration steps
    L.jobs = [];
    for (const b of L.batches) {
      if (!b || !b.items.length) continue;
      // spatially coherent slices: items in Z-order over 16 m tiles, so each merged slice is a compact
      // patch with a tight bounding sphere and frustum culling drops the parts behind or beside the camera
      if (b.vc > VERTS_PER_STAGE) {
        const px = ctx.pathX(ctx.s0 + 32);
        for (const it of b.items) it._k = morton(Math.max(0, Math.min(15, Math.floor(-it.z / 16))), Math.max(0, Math.min(15, Math.floor((it.x - px) / 16 + 8))));
        b.items.sort((p, q) => p._k - q._k);
      }
      const n = Math.max(1, Math.ceil(b.vc / VERTS_PER_STAGE));
      for (let k = 0; k < n; k++) L.jobs.push([b, k, n]);
    }
    L.next = 0;
    // meshes built directly during layout (shafts, plumes, instanced grass...) go out one per stage too
    if (L.extra) for (let i = L.extra.length - 1; i >= 0; i--) L.jobs.unshift([L.extra[i]]);
    L.more.push(...registerSteps(ctx, L.batches, L.extra));
  };
  const pops = [(ctx) => {
    const tr = typeof window !== 'undefined' && window.__stageTrace, t0 = performance.now();
    const L = layout(ctx);
    if (tr) tr.push(['layout', performance.now() - t0]);
    if (!L) return null;
    L.more = L.more || [];
    cache.set(ctx.group, L);
    return null;
  }];
  for (let k = 0; k < nBuild; k++) {
    const last = k === nBuild - 1;
    pops.push((ctx) => {
      const L = cache.get(ctx.group);
      if (!L) return null;
      const tr = typeof window !== 'undefined' && window.__stageTrace, t0 = performance.now();
      if (L.more.length || !L.jobs) { // continuations, slicing, registration: as many as fit in the stage budget (all on the last stage)
        do { if (L.more.length) L.more.shift()(); else plan(ctx, L); } while ((L.more.length || !L.jobs) && (last || performance.now() - t0 < STAGE_BUDGET));
        if (tr) tr.push(['more', performance.now() - t0]);
        if (!last) return null; // merges get stages of their own
      }
      const jobs = last ? L.jobs.slice(L.next) : L.jobs.slice(L.next, L.next + 1);
      L.next += jobs.length;
      if (last || L.next >= L.jobs.length) cache.delete(ctx.group);
      const r = finish(jobs.map((j) => (j.length === 1 ? j[0] : j[0].build(j[1], j[2]))), ctx.tier);
      if (tr) tr.push(['merge', performance.now() - t0, jobs.reduce((v, j) => v + (j.length === 1 ? 0 : j[0].vc / j[2]), 0)]);
      return r;
    });
  }
  return pops;
}

// Assemble populator output from batches / meshes
// Per-mesh LOD (same distances as the core's per-chunk LOD): each 'near' / 'mid' slice sits in a
// THREE.LOD at its bounding-sphere centre, so a slice is hidden by its own distance, not its chunk's.
const LOD_DIST = { high: { near: 70, mid: 150 }, low: { near: 45, mid: 100 } };
export function finish(parts, tier = null) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  const meshes = [], D = tier ? LOD_DIST[tier === 'low' ? 'low' : 'high'] : null;
  for (const p of parts) {
    if (!p) continue;
    const m = p.build ? p.build() : p;
    if (!m) continue;
    meshes.push(m);
    const d = D && m.userData.lod && D[m.userData.lod];
    const bs = d && (m.isInstancedMesh ? m.boundingSphere : m.geometry.boundingSphere);
    if (bs) {
      const lod = new THREE.LOD();
      lod.position.copy(bs.center); lod.updateMatrix(); lod.matrixAutoUpdate = false;
      m.position.copy(bs.center).negate(); m.updateMatrix();
      lod.addLevel(m, 0); lod.addLevel(new THREE.Object3D(), d);
      g.add(lod);
    } else g.add(m);
  }
  if (!meshes.length) return null;
  return {
    object: g,
    dispose() {
      for (const m of meshes) {
        if (m.isInstancedMesh) m.dispose(); // frees instance buffers; template geometry is shared
        else m.geometry.dispose();
      }
    },
  };
}

// colour helpers
export function hsl(h, s, l) { const c = new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l); return [c.r, c.g, c.b]; }
export function jitter(rng, c, amt = 0.12) { const k = 1 + (rng() * 2 - 1) * amt; return [c[0] * k * (1 + (rng() - 0.5) * amt), c[1] * k * (1 + (rng() - 0.5) * amt), c[2] * k * (1 + (rng() - 0.5) * amt)]; }

// shared template registry (filled by the init functions at startup)
export const T = {};

// Budget multiplier: average biome weight over the chunk, so cross-fade chunks stay within budget
export function budgetK(ctx, key) {
  let w = 0;
  for (let k = 0; k <= 4; k++) w += ctx.weightOf(ctx.s0 + k * 16, key);
  return Math.max(0.15, Math.min(1, w / 5 + 0.05));
}

// ---------- clearance rules ----------
// soft (swaying) props may fill the tube but keep LENS m clear of the exact camera line;
// low solids may sit under the path while their top stays LOW_GAP below pathY;
// tall solids keep the full TUBE.
export const LENS = 0.6, LOW_GAP = 1.3;
export function propClear(ctx, x, s, yLo, yHi, r, soft) {
  if (soft) return tubeClear(ctx, x, s, yLo, yHi, r, 0.1, LENS);
  let low = true;
  for (let k = -1; k <= 1 && low; k++) if (yHi > ctx.pathY(s + k * r) - LOW_GAP) low = false;
  return low || tubeClear(ctx, x, s, yLo, yHi, r);
}

// ---------- environment access (set by registerProps) ----------
export const ENV = { shape: null };
// Bend apexes inside the chunk: obstacles placed at side * d appear dead ahead on approach
// (outside of the bend) and the camera curves around them.
export function bendSpots(ctx, thr = 0.012, step = 2) { // apexes ~35 m apart; layouts thin them further
  const sh = ENV.shape, out = [];
  if (!sh || !sh.pathCurv) return out;
  for (let s = Math.ceil(ctx.s0 / step) * step; s < ctx.s1; s += step) {
    const c = sh.pathCurv(s), a = Math.abs(c);
    if (a < thr || a < Math.abs(sh.pathCurv(s - step)) || a < Math.abs(sh.pathCurv(s + step))) continue;
    out.push({ s, side: c > 0 ? -1 : 1, c });
  }
  return out;
}

// ---------- creature obstacles + "i" overlay labels ----------
export function named(t, name) { for (const x of Array.isArray(t) ? t : [t]) x.label = name; return t; }
export function soft(t) { for (const x of Array.isArray(t) ? t : [t]) x.solid = false; return t; }
const MAX_OBS = 400, MAX_LABELS = 150;
// A fitted capsule encloses its item, whose geometry keeps the flight-tube clearance; where the capsule's
// empty bulge would reach within 1 m of the camera path line, slide it away from the path (low capsules
// that stay LOW_GAP below the camera are left alone).
function keepOff(ctx, c) {
  const [r, a, e] = c, P = pathTab(ctx);
  { // quick reject: the capsule's bounding sphere is well clear of the path at its middle
    const ms = (a[2] + e[2]) / 2, half = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]) / 2;
    if (Math.abs(a[0] + e[0] - 2 * ctx.pathX(ms)) / 2 > r + half + 6) return c;
  }
  let best = 1e9, dir = null;
  const s0 = Math.min(a[2], e[2]) - r, s1 = Math.max(a[2], e[2]) + r, n = Math.max(2, Math.ceil((s1 - s0) / 0.5));
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * i / n, u = s - P.a;
    let px, py;
    if (u >= 0 && u < P.n - 1) { const k = u | 0, f = u - k; px = P.X[k] + (P.X[k + 1] - P.X[k]) * f; py = P.Y[k] + (P.Y[k + 1] - P.Y[k]) * f; }
    else { px = ctx.pathX(s); py = ctx.pathY(s); }
    if (Math.max(a[1], e[1]) + r <= py - LOW_GAP) continue;
    const ux = e[0] - a[0], uy = e[1] - a[1], us = e[2] - a[2], L2 = ux * ux + uy * uy + us * us;
    let t = L2 > 0 ? ((px - a[0]) * ux + (py - a[1]) * uy + (s - a[2]) * us) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const qx = a[0] + ux * t - px, qy = a[1] + uy * t - py, qs = a[2] + us * t - s, d = Math.hypot(qx, qy, qs) - r;
    if (d < best) { best = d; dir = [qx, qy, qs]; }
  }
  if (best >= 1 || !dir) return c;
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1, m = (1.05 - best) / l;
  return [r, [a[0] + dir[0] * m, a[1] + dir[1] * m, a[2] + dir[2] * m], [e[0] + dir[0] * m, e[1] + dir[1] * m, e[2] + dir[2] * m]];
}
// Obstacles and "i" labels for a finished layout, as continuation steps (a chunk can hold thousands of
// items): REG_PER items per step, then one step commits the largest ones to the chunk.
const REG_PER = 150;
function registerSteps(ctx, batches, extra = null) {
  const out = [];
  if (typeof window !== 'undefined' && (window.__propsAudit || window.__propsGapCheck)) out.push(() => { // debug: ground/ceiling contact audit
    const L = window.__propsItems || (window.__propsItems = []), gnd = groundOf(ctx);
    for (const b of extra ? [...batches, ...extra] : batches) if (b && b.items) for (const it of b.items) {
      it._sw = !!(b.mat && b.mat.side === THREE.DoubleSide); // soft / swaying (clearance check uses the lens radius)
      if (it.g) L.push({ it, s0: ctx.s0, group: ctx.group, gnd, ctx, mode: 'floor' });
      if (it.hang) L.push({ it, s0: ctx.s0, group: ctx.group, gnd, ctx, mode: 'ceil' });
    }
  });
  if (!ctx.addObstacle && !ctx.addLabel) return out;
  const obs = [], labels = [];
  for (const b of batches) {
    if (!b || !b.items) continue;
    for (let a = 0; a < b.items.length; a += REG_PER) out.push(() => registerItems(ctx, b, a, Math.min(b.items.length, a + REG_PER), obs, labels));
  }
  out.push(() => {
    if (ctx.addObstacle) {
      obs.sort((p, q) => q[0] - p[0]);
      const nO = Math.max(0, Math.min(MAX_OBS - (ctx._obsCount || 0), obs.length));
      for (let i = 0; i < nO; i++) { const [r, a, e] = obs[i]; ctx.addObstacle(a[0], a[1], a[2], e[0], e[1], e[2], r); }
    }
    if (ctx.addLabel) {
      labels.sort((p, q) => q[0] - p[0]);
      const nL = Math.max(0, Math.min(MAX_LABELS - (ctx._lblCount || 0), labels.length));
      for (let i = 0; i < nL; i++) { const [, n, c, f] = labels[i]; ctx.addLabel(n, c[0], c[1], c[2], f || undefined); }
    }
    ctx._obsCount = Math.min(MAX_OBS, (ctx._obsCount || 0) + obs.length);
    ctx._lblCount = Math.min(MAX_LABELS, (ctx._lblCount || 0) + labels.length);
  });
  return out;
}
function registerItems(ctx, b, i0, i1, obs, labels) {
  const swayMat = b.mat && b.mat.side === THREE.DoubleSide;
  for (let i = i0; i < i1; i++) {
    const it = b.items[i], t = it.tpl, bx = t.box;
    const size = Math.max((bx[3] - bx[0]) * it.sx, (bx[4] - bx[1]) * it.sy, (bx[5] - bx[2]) * it.sz);
    const R = it.R, tf = (x, y, z) => {
      const px = x * it.sx, py = y * it.sy, pz = z * it.sz;
      return [R[0] * px + R[1] * py + R[2] * pz + it.x, R[3] * px + R[4] * py + R[5] * pz + it.y, ctx.s0 - (R[6] * px + R[7] * py + R[8] * pz + it.z)];
    };
    const name = it.lbl || it.name || t.label;
    if (name && size > 0.12) {
      const c = tf((bx[0] + bx[3]) / 2, (bx[1] + bx[4]) / 2, (bx[2] + bx[5]) / 2);
      labels.push([it.lbl ? size * 3 : size, name, c, it.fact || t.fact]);
    }
    // no obstacles for soft things, ground cover (draped patches) or anything lower than a hand
    if (swayMat || !t.solid || size < 0.4 || t.drape || (bx[4] - bx[1]) * it.sy < 0.2) continue;
    if (t.obs) { // authored capsules (arches, gates, hulls...): used as drawn
      for (const o of t.obs) {
        const vert = Math.abs(o[1] - o[4]) > Math.abs(o[0] - o[3]) + Math.abs(o[2] - o[5]);
        const k = vert ? Math.max(it.sx, it.sz) : Math.max(it.sx, it.sy, it.sz);
        const a = tf(o[0], o[1], o[2]), e = tf(o[3], o[4], o[5]);
        obs.push([o[6] * k * 1.08 + 0.1, a, e]);
      }
      continue;
    }
    if (size < 1.5) { // small: one capsule along the longest scaled axis of the box (no vertex pass)
      const e = [(bx[3] - bx[0]) * it.sx, (bx[4] - bx[1]) * it.sy, (bx[5] - bx[2]) * it.sz], c = [(bx[0] + bx[3]) / 2, (bx[1] + bx[4]) / 2, (bx[2] + bx[5]) / 2];
      const ax = e[0] >= e[1] && e[0] >= e[2] ? 0 : e[1] >= e[2] ? 1 : 2, r = Math.hypot(e[(ax + 1) % 3], e[(ax + 2) % 3]) / 2, half = Math.max(0, e[ax] / 2 - r * 0.7);
      const A = [c[0], c[1], c[2]], B = [c[0], c[1], c[2]], sc = [it.sx, it.sy, it.sz];
      A[ax] -= half / sc[ax]; B[ax] += half / sc[ax];
      obs.push(keepOff(ctx, [r * 0.9 + 0.05, tf(A[0], A[1], A[2]), tf(B[0], B[1], B[2])]));
      continue;
    }
    // big: a capsule chain fitted to the real shape at this item's (possibly very non-uniform) scale
    const ry = it.sy / it.sx, rz = it.sz / it.sx, F = t.capsules(ry, rz, 6), cy = ry / F.fy, cz = rz / F.fz, kr = Math.max(1, cy, cz) * it.sx;
    const tc = (x, y, z) => { // normalised fit space -> global
      const px = x * it.sx, py = y * cy * it.sx, pz = z * cz * it.sx;
      return [R[0] * px + R[1] * py + R[2] * pz + it.x, R[3] * px + R[4] * py + R[5] * pz + it.y, ctx.s0 - (R[6] * px + R[7] * py + R[8] * pz + it.z)];
    };
    for (const o of F.list) obs.push(keepOff(ctx, [o[6] * kr * 1.03 + 0.05, tc(o[0], o[1], o[2]), tc(o[3], o[4], o[5])]));
  }
}

// ---------- shape variants: deform a template N ways (noise displacement, non-uniform scale, bend, twist) ----------
export function variants(tpl, n, seed, { disp = 0.08, freq = 1.6, scale = 0.22, bend = 0.12, twist = 0.25, smooth = true } = {}) {
  const out = [tpl];
  const [x0, y0, z0, x1, y1, z1] = tpl.box;
  const ext = Math.max(x1 - x0, y1 - y0, z1 - z0) || 1, H = Math.max(1e-3, y1 - y0);
  for (let k = 1; k < n; k++) {
    let st = (seed * 9301 + k * 49297) % 233280;
    const r = () => (st = (st * 9301 + 49297) % 233280) / 233280;
    const sx = 1 + (r() - 0.5) * 2 * scale, sy = 1 + (r() - 0.5) * 2 * scale, sz = 1 + (r() - 0.5) * 2 * scale;
    const bx = (r() - 0.5) * 2 * bend, bz = (r() - 0.5) * 2 * bend, tw = (r() - 0.5) * 2 * twist, sd = (seed * 31 + k * 7) | 0;
    const b = new Builder();
    b.P = Array.from(tpl.pos); b.N = Array.from(tpl.nor); b.C = Array.from(tpl.col); b.F = Array.from(tpl.fx); b.I = Array.from(tpl.idx);
    for (let i = 0; i < b.P.length; i += 3) {
      let x = b.P[i], y = b.P[i + 1], z = b.P[i + 2];
      const t = (y - y0) / H, f = freq / ext;
      const d = 1 + disp * vn3(x * f + sd, y * f, z * f, sd);
      x *= d; z *= d; y = y0 + (y - y0) * (1 + disp * 0.5 * vn3(x * f, y * f + 3, z * f, sd + 1));
      const a = tw * t, c = Math.cos(a), s = Math.sin(a);
      const xr = x * c - z * s, zr = x * s + z * c;
      b.P[i] = xr * sx + bx * t * t * H; b.P[i + 1] = y * sy; b.P[i + 2] = zr * sz + bz * t * t * H;
    }
    if (smooth) b.smooth(0, 0);
    b.obs = tpl.obs ? tpl.obs.map((o) => o.slice()) : null;
    b.label = tpl.label; b.solid = tpl.solid; b.fact = tpl.fact; b.support = tpl.support; b.drape = tpl.drape;
    const v = b.build();
    v.vents = tpl.vents;
    out.push(v);
  }
  return out;
}
// expand every template in a list into n variants each
export const vary = (list, n, seed, opts) => list.flatMap((t, i) => variants(t, n, seed + i * 101, opts));


// ---------- quality tier ----------
// near/mid densities scale down on low-tier GPUs
export const tierK = (ctx) => (ctx.tier === 'low' ? 0.6 : 1);
// guarded point-of-interest registration (creatures gather, the camera director looks)
export function poi(ctx, type, x, y, s, r = 5, data = null) { if (ctx.addPOI) ctx.addPOI(type, x, y, s, r, data); }

// ---------- contact audit (debug): gap between an item's contact band and what it rests on ----------
// Returns the worst gap (m) over a 3x3 grid of the contact band; <= 0 means embedded / touching.
export function auditGap(rec) {
  const it = rec.it, t = it.tpl, R = it.R, P = t.pos, ceil = rec.mode === 'ceil';
  // draped patches conform vertex by vertex: only their base vertices are contact points
  const lim = ceil ? t.maxY - t.band : t.minY + (it.drape ? 0.004 : t.band);
  const pts = [];
  let xa = 1e9, xb = -1e9, sa = 1e9, sb = -1e9;
  if (!ceil && R[4] < 0.5) { // lying / capsized: contact band in world orientation (as groundY seats it)
    const F = t.tiltFoot(R, it.sx, it.sy, it.sz, 1e9);
    for (let i = 0; i < F.length; i += 3) {
      const wx = F[i] + it.x, wy = F[i + 1] + it.y, ws = rec.s0 - (F[i + 2] + it.z);
      pts.push(wx, wy, ws);
      xa = Math.min(xa, wx); xb = Math.max(xb, wx); sa = Math.min(sa, ws); sb = Math.max(sb, ws);
    }
  } else for (let i = 0; i < P.length; i += 3) {
    const ly = P[i + 1];
    if (ceil ? ly < lim : ly > lim) continue;
    const px = P[i] * it.sx, py = ly * it.sy, pz = P[i + 2] * it.sz;
    const wx = R[0] * px + R[1] * py + R[2] * pz + it.x, wz = R[6] * px + R[7] * py + R[8] * pz + it.z, ws = rec.s0 - wz;
    let wy = R[3] * px + R[4] * py + R[5] * pz + it.y;
    if (it.drape) wy = it.drape.at(wx, ws) + (ly - t.minY) * it.sy + t.dLift - 0.012;
    pts.push(wx, wy, ws);
    xa = Math.min(xa, wx); xb = Math.max(xb, wx); sa = Math.min(sa, ws); sb = Math.max(sb, ws);
  }
  const cell = new Map(), cx = (xb - xa) / 3 + 1e-6, cs = (sb - sa) / 3 + 1e-6;
  if (!ceil && !it.drape && R[4] >= 0.5 && pts.length >= 24) { // flat-based items (8+ contact vertices)
    // the item's real underside: sample its bottom surface in a 6x6 grid over the band's extent
    // (a box's bottom face spans cells without putting a vertex in them)
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
      const wx = xa + (xb - xa) * (a + 0.5) / 6, ws = sa + (sb - sa) * (b + 0.5) / 6;
      const dx = wx - it.x, dy = 0, dz = (rec.s0 - ws) - it.z; // to template space (R orthonormal)
      const lx = (R[0] * dx + R[3] * dy + R[6] * dz) / it.sx, lz = (R[2] * dx + R[5] * dy + R[8] * dz) / it.sz;
      const by = t.rayUp(lx, lz);
      if (!(by <= t.minY + Math.min(t.band, 0.012 / it.sy))) continue; // only the flat bottom faces are contact faces
      const px = lx * it.sx, py = by * it.sy, pz = lz * it.sz;
      pts.push(R[0] * px + R[1] * py + R[2] * pz + it.x, R[3] * px + R[4] * py + R[5] * pz + it.y, rec.s0 - (R[6] * px + R[7] * py + R[8] * pz + it.z));
    }
  }
  for (let i = 0; i < pts.length; i += 3) {
    const wx = pts[i], wy = pts[i + 1], ws = pts[i + 2];
    // hanging items under open water (icebergs in a lead) are pinned to the surface instead of the ice
    const g = ceil ? Math.min(rec.ctx.ceilingAt(wx, ws), rec.ctx.surfaceY) - wy : wy - rec.gnd.h(wx, ws, it);
    const k = Math.min(2, Math.floor((wx - xa) / cx)) * 3 + Math.min(2, Math.floor((ws - sa) / cs));
    const v = cell.get(k);
    cell.set(k, v === undefined ? g : Math.min(v, g));
  }
  let gap = -1e9;
  for (const v of cell.values()) gap = Math.max(gap, v);
  return gap;
}
