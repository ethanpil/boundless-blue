// Procedural creature geometry. All bodies are built at UNIT length along local z
// (nose/front at z = +0.5, tail tip near z = -0.5, dorsal +y, lateral x) and scaled per
// instance. Upright plans (jellies, octopus, seahorse) use local +y as their axis.
// Vertex attribute aG = (part, v, u|lateral|rootX|index, w|flex|distance) — see shader.js.
import { mulberry32 } from '../noise.js';

export const PART = { BODY: 0, MEDIAN: 1, PAIRED: 2, CAUDAL: 3, EYE: 4, GLOW: 5, ARM: 6, FLIPPER: 7, TOOTH: 8, BEAK: 9, SHELL: 10 };
const PI = Math.PI;

export class GB {
  constructor() { this.P = []; this.G = []; this.I = []; }
  get count() { return this.P.length / 3; }
  v(x, y, z, a, b, c, d) { this.P.push(x, y, z); this.G.push(a, b, c, d); return this.P.length / 3 - 1; }
  // Triangle; if an outward hint is given the winding is flipped to face it.
  tri(a, b, c, ox, oy, oz) {
    if (a === b || b === c || a === c) return;
    if (ox !== undefined) {
      const P = this.P;
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * ox + ny * oy + nz * oz < 0) { this.I.push(a, c, b); return; }
    }
    this.I.push(a, b, c);
  }
  finish() {
    const n = this.count, P = this.P, I = this.I;
    const nor = new Float32Array(n * 3);
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { nor[o] += nx; nor[o + 1] += ny; nor[o + 2] += nz; }
    }
    for (let i = 0; i < n * 3; i += 3) {
      const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]);
      if (l > 1e-12) { nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; } else nor[i + 1] = 1;
    }
    return {
      pos: new Float32Array(P), nor, g: new Float32Array(this.G),
      idx: n > 65535 ? new Uint32Array(I) : new Uint16Array(I), tris: I.length / 3,
    };
  }
}

// ---------- curves ----------
export function ctrl(arr, u) { // uniform Catmull-Rom over control values, clamped >= 0
  const n = arr.length - 1, x = Math.min(Math.max(u, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1), f = x - i;
  const p0 = arr[Math.max(i - 1, 0)], p1 = arr[i], p2 = arr[i + 1], p3 = arr[Math.min(i + 2, n)];
  return Math.max(0, 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f));
}
export function monoCurve(ts, vs) { // Fritsch-Carlson monotone cubic through stations
  const n = ts.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0; while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], s = (t - ts[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * vs[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * vs[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

export const FIN_SHAPES = {
  round: [0.3, 0.8, 1, 1, 0.92, 0.7, 0.25],
  tri: [0.25, 0.85, 1, 0.75, 0.45, 0.2, 0.05],
  shark: [0.4, 0.95, 1, 0.55, 0.28, 0.12, 0.05],
  falcate: [0.45, 1, 0.62, 0.34, 0.2, 0.12, 0.08],
  long: [0.45, 0.9, 1, 1, 1, 0.95, 0.6],
  sail: [0.75, 1, 1, 0.97, 0.9, 0.75, 0.45],
  spiny: [0.6, 1, 0.95, 0.8, 0.7, 0.85, 0.5],
  pect: [0.55, 0.9, 1, 0.9, 0.7, 0.45, 0.2],
  paddle: [0.5, 0.85, 1, 1, 0.95, 0.7, 0.3],
  low: [0.2, 0.6, 0.8, 0.8, 0.75, 0.6, 0.2],
  rhomb: [0.1, 0.6, 1, 0.75, 0.45, 0.2, 0.05],
  idol: [1, 0.85, 0.5, 0.35, 0.3, 0.25, 0.15],
  wing: [0.3, 0.75, 1, 0.9, 0.6, 0.3, 0.08],
  flipper: [0.55, 0.9, 1, 0.95, 0.8, 0.55, 0.2],
  hump: [0.1, 0.5, 0.9, 1, 0.8, 0.4, 0.05],
};
const CAUDAL = {
  forked: { H: [1, 0.62, 0.42, 0.62, 1], a0: -0.62, a1: 0.62, root: 0.8 },
  lunate: { H: [1, 0.5, 0.3, 0.5, 1], a0: -0.98, a1: 0.98, root: 0.45 },
  truncate: { H: [1.04, 1, 1, 1, 1.04], a0: -0.42, a1: 0.42, root: 1 },
  rounded: { H: [0.62, 0.92, 1, 0.92, 0.62], a0: -0.62, a1: 0.62, root: 1 },
  emarginate: { H: [1, 0.86, 0.78, 0.86, 1], a0: -0.5, a1: 0.5, root: 0.9 },
  hetero: { H: [0.6, 0.48, 0.36, 0.72, 1.15], a0: -0.88, a1: 0.6, root: 0.8 },
  pointed: { H: [0.25, 0.7, 1, 0.7, 0.25], a0: -0.3, a1: 0.3, root: 1 },
  fluke: { H: [1, 0.58, 0.4, 0.58, 1], a0: -1.08, a1: 1.08, root: 0.55 },
  seal: { H: [0.8, 1, 0.45, 1, 0.8], a0: -0.55, a1: 0.55, root: 1 },
  lyre: { H: [1.3, 0.6, 0.4, 0.6, 1.3], a0: -0.55, a1: 0.55, root: 0.8 },
  paddle: { H: [0.7, 0.95, 1, 0.95, 0.7], a0: -0.9, a1: 0.9, root: 0.6 },
};

// ---------- body profile ----------
// Returns prof(t, o) filling o.top/bot/wid/yc/n/nb/thinB/thinW, plus prof.tEnd (end of loft).
export function bodyProfile(B) {
  let top, bot, wid, yc, tEnd, tLast;
  if (B.st) {
    const T = B.st.t;
    top = monoCurve(T, B.st.top); bot = monoCurve(T, B.st.bot); wid = monoCurve(T, B.st.wid);
    yc = B.st.yc ? monoCurve(T, B.st.yc) : () => 0;
    tLast = T[T.length - 1];
    tEnd = B.st.tEnd ?? tLast - 0.02; // caudal attaches just before the station end
  } else {
    const D = B.depth, W = B.width ?? 0.5;
    const tm = B.tm ?? 0.35, tmb = B.tmb ?? tm, tmw = B.tmw ?? tm * 0.85;
    const nose = B.nose ?? 0.65, noseB = B.noseB ?? nose, noseW = B.noseW ?? nose;
    const tail = B.tail ?? 1.5, ped = B.ped ?? 0.12, pedW = B.pedW ?? ped * 0.75;
    tEnd = B.tEnd ?? 0.8;
    const cap = Math.max(0.012, ped * D * 0.6);
    tLast = tEnd + cap;
    const f = (t, tmx, ns, pd) => {
      if (t <= tmx) return Math.pow(Math.sin((t / tmx) * PI / 2), ns);
      if (t <= tEnd) { const y = (t - tmx) / (tEnd - tmx); return pd + (1 - pd) * Math.pow(1 - Math.pow(y, 1.6), tail); }
      const y = (t - tEnd) / cap; return y >= 1 ? 0 : pd * Math.sqrt(1 - y * y);
    };
    const hump = B.hump ?? 0, belly = B.belly ?? 0, snout = B.snout ?? 0;
    top = (t) => 0.5 * D * (1 + hump) * f(t, tm, nose, ped);
    bot = (t) => 0.5 * D * (1 + belly) * f(t, tmb, noseB, ped);
    wid = (t) => 0.5 * D * W * f(t, tmw, noseW, pedW);
    yc = (t) => snout * 0.5 * D * (1 - Math.min(1, t / 0.22)) ** 2;
  }
  const bumps = B.bumps || [];
  const prof = (t, o) => {
    let a = Math.max(0, top(t)), b = Math.max(0, bot(t)), w = Math.max(0, wid(t));
    for (const [k, c, s, amt] of bumps) {
      const g = 1 + amt * Math.exp(-(((t - c) / s) ** 2));
      if (k === 't' || k === 'a') a *= g;
      if (k === 'b' || k === 'a') b *= g;
      if (k === 'w' || k === 'a') w *= g;
    }
    o.top = a; o.bot = b; o.wid = w; o.yc = yc(t);
    o.n = B.n ?? 2.2; o.nb = B.nb ?? o.n; o.thinB = B.thinB ?? 0; o.thinW = B.thinW ?? 0;
  };
  prof.tEnd = tEnd; prof.tLast = tLast;
  return prof;
}

// Point on a body cross-section at angle a (0 = +x lateral, PI/2 = dorsal). Returns [x, y, v].
function section(o, a, out) {
  const c = Math.cos(a), s = Math.sin(a);
  const e = 2 / (s >= 0 ? o.n : o.nb);
  const cx = Math.sign(c) * Math.pow(Math.abs(c), e);
  const sy = Math.sign(s) * Math.pow(Math.abs(s), e);
  const x = o.wid * cx;
  let y = sy >= 0 ? o.top * sy : o.bot * sy;
  if (o.thinW > 0) y *= o.thinB + (1 - o.thinB) * Math.exp(-(x * x) / (o.thinW * o.thinW));
  out[0] = x; out[1] = y + o.yc; out[2] = sy;
  return out;
}

export function loft(gb, prof, nL, nA, partFn) {
  const o = {}, sp = [0, 0, 0], rings = [];
  const t1 = prof.tLast;
  for (let i = 0; i <= nL; i++) {
    const u = i / nL;
    const t = t1 * (0.5 - 0.5 * Math.cos(PI * u));
    prof(t, o);
    const z = 0.5 - t, part = partFn ? partFn(t) : 0;
    if (i === 0 || i === nL || (o.wid < 1e-5 && o.top < 1e-5)) {
      const id = gb.v(0, o.yc, z, part, 0, 0, 0);
      rings.push(new Array(nA).fill(id));
      continue;
    }
    const ring = [];
    for (let j = 0; j < nA; j++) {
      section(o, (j / nA) * PI * 2, sp);
      ring.push(gb.v(sp[0], sp[1], z, part, sp[2], o.wid > 0 ? sp[0] / o.wid : 0, 0));
    }
    rings.push(ring);
  }
  for (let i = 0; i < nL; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let j = 0; j < nA; j++) {
      const j1 = (j + 1) % nA;
      gb.tri(A[j], B[j], A[j1]);
      gb.tri(A[j1], B[j], B[j1]);
    }
  }
}

// Fin plate with a little thickness. o.root(u)->[x,y,z], o.dir(u)->[dx,dy,dz] (unit), o.H(u)->length.
export function fin(gb, o) {
  const nU = o.nU, nW = o.nW, pn = o.pn, part = o.part ?? PART.MEDIAN, vN = o.vN ?? 0;
  for (const side of [1, -1]) {
    const base = gb.count;
    for (let i = 0; i <= nU; i++) {
      const u = i / nU, R = o.root(u), D = o.dir(u), h = o.H(u);
      const su = Math.sqrt(Math.max(0, Math.sin(PI * u)));
      for (let k = 0; k <= nW; k++) {
        const w = k / nW;
        const off = side * (o.thick ?? 0.03) * h * su * Math.pow(1 - w, 0.6) + (o.cup ?? 0) * h * w * w;
        const x = R[0] + D[0] * h * w + pn[0] * off;
        const y = R[1] + D[1] * h * w + pn[1] * off;
        const z = R[2] + D[2] * h * w + pn[2] * off;
        gb.v(x, y, z, part, vN, part === PART.FLIPPER ? R[0] : u, w);
      }
    }
    const ox = pn[0] * side, oy = pn[1] * side, oz = pn[2] * side;
    for (let i = 0; i < nU; i++) for (let k = 0; k < nW; k++) {
      const a = base + i * (nW + 1) + k, b = a + nW + 1;
      gb.tri(a, b, a + 1, ox, oy, oz);
      gb.tri(a + 1, b, b + 1, ox, oy, oz);
    }
  }
}

// Sphere with its pole along `axis` so the pupil (aG.y = cos to axis) is perfectly round.
export function sphere(gb, cx, cy, cz, r, nLat, nLon, part, axis, scale = [1, 1, 1], g2 = 0) {
  let [ax, ay, az] = axis; const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
  let ux = -ay, uy = ax, uz = 0; if (Math.abs(az) > 0.9) { ux = 1; uy = 0; uz = 0; }
  // make u perpendicular
  let d = ux * ax + uy * ay + uz * az; ux -= d * ax; uy -= d * ay; uz -= d * az;
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
  const rings = [];
  for (let i = 0; i <= nLat; i++) {
    const th = (i / nLat) * PI, ct = Math.cos(th), st = Math.sin(th);
    if (i === 0 || i === nLat) {
      const id = gb.v(cx + ax * ct * r * scale[0], cy + ay * ct * r * scale[1], cz + az * ct * r * scale[2], part, ct, g2, 0);
      rings.push(new Array(nLon).fill(id)); continue;
    }
    const ring = [];
    for (let j = 0; j < nLon; j++) {
      const ph = (j / nLon) * PI * 2, cp = Math.cos(ph), sp = Math.sin(ph);
      const dx = ax * ct + (ux * cp + vx * sp) * st, dy = ay * ct + (uy * cp + vy * sp) * st, dz = az * ct + (uz * cp + vz * sp) * st;
      ring.push(gb.v(cx + dx * r * scale[0], cy + dy * r * scale[1], cz + dz * r * scale[2], part, ct, g2, 0));
    }
    rings.push(ring);
  }
  const P = gb.P;
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
    const j1 = (j + 1) % nLon, A = rings[i], B = rings[i + 1];
    const o = A[j] * 3;
    const hx = P[o] - cx, hy = P[o + 1] - cy, hz = P[o + 2] - cz;
    const o2 = B[j] * 3;
    const kx = hx + P[o2] - cx, ky = hy + P[o2 + 1] - cy, kz = hz + P[o2 + 2] - cz;
    gb.tri(A[j], B[j], A[j1], kx, ky, kz);
    gb.tri(A[j1], B[j], B[j1], kx, ky, kz);
  }
}

// Tube along a polyline with parallel-transport frames. gfn(i) -> [part, v, z, w] per ring.
export function tube(gb, pts, radii, sides, gfn, squash = 1) {
  const n = pts.length, rings = [];
  let Nx = 0, Ny = 0, Nz = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (i === 0) { // initial normal: perpendicular to tangent, prefer horizontal
      Nx = -tz; Ny = 0; Nz = tx;
      if (Math.hypot(Nx, Nz) < 0.1) { Nx = 1; Ny = 0; Nz = 0; }
    }
    const d = Nx * tx + Ny * ty + Nz * tz; Nx -= d * tx; Ny -= d * ty; Nz -= d * tz;
    const nl = Math.hypot(Nx, Ny, Nz) || 1; Nx /= nl; Ny /= nl; Nz /= nl;
    const Bx = Ny * tz - Nz * ty, By = Nz * tx - Nx * tz, Bz = Nx * ty - Ny * tx; // B = N x T
    const g = gfn(i), r = radii[i];
    if (r < 1e-6) { const id = gb.v(p[0], p[1], p[2], g[0], g[1], g[2], g[3]); rings.push({ ids: new Array(sides).fill(id), c: p }); continue; }
    const ids = [];
    for (let j = 0; j < sides; j++) {
      const an = (j / sides) * PI * 2, c = Math.cos(an) * r * squash, s = Math.sin(an) * r;
      ids.push(gb.v(p[0] + Nx * c + Bx * s, p[1] + Ny * c + By * s, p[2] + Nz * c + Bz * s, g[0], g[1], g[2], g[3]));
    }
    rings.push({ ids, c: p });
  }
  const P = gb.P;
  for (let i = 0; i < n - 1; i++) {
    const A = rings[i].ids, B = rings[i + 1].ids;
    const c = rings[i].c, c2 = rings[i + 1].c;
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      const ref = A[j] !== A[j1] ? A[j] : B[j];
      const cc = A[j] !== A[j1] ? c : c2;
      const ox = P[ref * 3] - cc[0], oy = P[ref * 3 + 1] - cc[1], oz = P[ref * 3 + 2] - cc[2];
      gb.tri(A[j], B[j], A[j1], ox, oy, oz);
      gb.tri(A[j1], B[j], B[j1], ox, oy, oz);
    }
  }
}

// Double-sided ribbon strip (for jelly tentacles / oral arms). Two crossed strips.
function ribbon(gb, pts, widths, g, twist = 0, frill = 0) {
  const n = pts.length;
  for (const rot of [0, PI / 2]) {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = rot + twist * i / (n - 1) * PI * 2;
      const w = widths[i] * (1 + frill * Math.sin(i * 2.7));
      const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
      const gi = g(i);
      ids.push(gb.v(p[0] - dx, p[1], p[2] - dz, gi[0], gi[1], gi[2], gi[3]));
      ids.push(gb.v(p[0] + dx, p[1], p[2] + dz, gi[0], gi[1], gi[2], gi[3]));
    }
    for (let i = 0; i < n - 1; i++) {
      const a = ids[i * 2], b = ids[i * 2 + 1], c = ids[i * 2 + 2], d = ids[i * 2 + 3];
      gb.tri(a, c, b); gb.tri(b, c, d);
    }
  }
}

// ---------- detail ----------
// Levels: species det 0..2 map to levels 1..3; LOD -1 (beyond ~40 m) drops one level, LOD +1
// (close passes within a few metres) adds one: smooth silhouettes and round eyes up close.
const DET = [
  { nL: 10, nA: 6, fu: 2, fw: 1, cu: 3, eLat: 3, eLon: 5 },
  { nL: 14, nA: 8, fu: 3, fw: 1, cu: 4, eLat: 4, eLon: 6 },
  { nL: 22, nA: 12, fu: 5, fw: 2, cu: 6, eLat: 5, eLon: 8 },
  { nL: 34, nA: 18, fu: 8, fw: 3, cu: 10, eLat: 7, eLon: 12 },
  { nL: 46, nA: 26, fu: 10, fw: 3, cu: 12, eLat: 10, eLon: 18 },
];
const levelOf = (sp, lod = 0) => Math.max(0, Math.min(4, (sp.det ?? 1) + 1 + lod));
const detOf = (sp, lod = 0) => DET[levelOf(sp, lod)];

// ---------- fish-like plan (fish, sharks, eels, rays, cetaceans, seals, penguins, turtles) ----------
export function buildFish(sp, lod = 0) {
  const gb = new GB();
  const B = sp.body, det = detOf(sp, lod);
  const prof = bodyProfile(B);
  const parts = B.parts;
  const partFn = parts ? (t) => { for (const [a, b, p] of parts) if (t >= a && t <= b) return p; return 0; } : null;
  loft(gb, prof, Math.round(det.nL * (B.segL ?? 1)), Math.round(det.nA * (B.segA ?? 1)), partFn);
  const o = {}, sp3 = [0, 0, 0];
  const F = sp.fins || {};
  const shapeOf = (s) => (Array.isArray(s) ? s : FIN_SHAPES[s || 'round']);
  // median fins
  for (const kind of ['dorsal', 'anal']) {
    for (const f of F[kind] || []) {
      const up = kind === 'dorsal' ? 1 : -1;
      const shp = shapeOf(f.shape);
      const nU = Math.max(det.fu, f.spikes ? Math.min(f.spikes * 2, 26) : 0, f.t1 - f.t0 > 0.35 ? det.fu * 2 : 0);
      const dl = Math.hypot(1, f.sweep ?? 0.4);
      fin(gb, {
        nU, nW: det.fw, pn: [1, 0, 0], part: PART.MEDIAN, vN: up, thick: f.thick ?? 0.025,
        root: (u) => {
          const t = f.t0 + (f.t1 - f.t0) * u; prof(t, o);
          return [0, o.yc + up * (up > 0 ? o.top : o.bot) * 0.86, 0.5 - t];
        },
        dir: () => [0, up / dl, -(f.sweep ?? 0.4) / dl],
        H: (u) => {
          let h = f.h * ctrl(shp, u);
          if (f.spikes) h *= 0.55 + 0.45 * Math.pow(Math.abs(Math.cos(u * f.spikes * PI)), 0.5);
          return h;
        },
      });
    }
  }
  // paired fins / flippers
  for (const kind of ['pect', 'pelv', 'flip', 'flip2', 'ceph']) {
    const f = F[kind]; if (!f) continue;
    const shp = shapeOf(f.shape || 'pect');
    for (const side of [1, -1]) {
      const dip = f.dip ?? 0.5, sw = f.sweep ?? 0.8, fwd = f.fwd ?? 0;
      let dx = side * Math.cos(dip), dy = -Math.sin(dip), dz = -sw + fwd;
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      // plane normal = (root line) x (fin direction)
      const rootAt = (u) => { const t = f.t + (f.span ?? 0.05) * u; prof(t, o); section(o, f.a + (f.aSpan ?? 0) * u, sp3); return [side * sp3[0] * (f.inset ?? 0.9), sp3[1], 0.5 - t]; };
      const r0 = rootAt(0), r1 = rootAt(1);
      const rx = r1[0] - r0[0], ry = r1[1] - r0[1], rz = r1[2] - r0[2];
      let px = ry * dz - rz * dy, py = rz * dx - rx * dz, pz = rx * dy - ry * dx;
      const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
      fin(gb, {
        nU: Math.max(3, det.fu - 1), nW: det.fw + (f.thick > 0.08 ? 1 : 0), pn: [px, py, pz],
        part: f.part ?? (kind === 'flip' ? PART.FLIPPER : kind === 'ceph' ? PART.PAIRED : PART.PAIRED),
        vN: f.vN ?? -0.2, thick: f.thick ?? 0.03, cup: f.cup ?? 0,
        root: rootAt,
        dir: () => [dx, dy, dz],
        H: (u) => f.h * ctrl(shp, u),
      });
    }
  }
  // caudal fin / flukes
  const C = F.caudal;
  if (C) {
    const sh = CAUDAL[C.shape] || CAUDAL.forked;
    const te = prof.tEnd - (C.inset ?? 0.012);
    prof(te, o);
    const z0 = 0.5 - te, horiz = C.shape === 'fluke' || C.horiz;
    const hp = (horiz ? o.wid : Math.max(o.top, o.bot)) * sh.root * (C.root ?? 1);
    const ycc = o.yc + (C.lift ?? 0);
    const tilt = C.tilt ?? 0;
    fin(gb, {
      nU: det.cu, nW: det.fw + 1, pn: horiz ? [0, 1, 0] : [1, 0, 0], part: PART.CAUDAL, vN: 0,
      thick: C.thick ?? (horiz ? 0.09 : 0.025),
      root: (u) => (horiz ? [(u - 0.5) * 2 * hp, ycc, z0] : [0, ycc + (u - 0.5) * 2 * hp, z0]),
      dir: (u) => {
        const a = sh.a0 + (sh.a1 - sh.a0) * u + tilt;
        return horiz ? [Math.sin(a), 0, -Math.cos(a)] : [0, Math.sin(a), -Math.cos(a)];
      },
      H: (u) => C.size * ctrl(sh.H, u),
    });
  }
  // eyes
  const E = sp.eye;
  if (E) {
    prof(E.t, o);
    const n = E.v >= 0 ? o.n : o.nb;
    const hy = E.v >= 0 ? o.top : o.bot;
    const y = o.yc + E.v * hy;
    let x = o.wid * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(E.v), n)), 1 / n);
    if (E.x !== undefined) x = E.x;
    x = Math.max(0.0005, x - E.r * (E.inset ?? 0.45));
    const ax = E.axis || [1, 0.12, 0.25];
    for (const side of [1, -1]) {
      sphere(gb, side * x, y, 0.5 - E.t, E.r, det.eLat, det.eLon, PART.EYE, [side * ax[0], ax[1], ax[2]]);
    }
  }
  extras(gb, sp, prof, det);
  return gb.finish();
}

function extras(gb, sp, prof, det) {
  const X = sp.extra || {}, o = {};
  const sides = Math.max(4, det.eLon - 2);
  if (X.bill) { // sailfish / marlin / narwhal tusk (single, forward)
    const L = X.bill.len, r = X.bill.r, pts = [], rad = [];
    const y0 = X.bill.y ?? 0, x0 = X.bill.x ?? 0;
    for (let i = 0; i <= 6; i++) { const f = i / 6; pts.push([x0 * (1 - f * 0.3), y0 + (X.bill.rise ?? 0) * f * f, 0.5 - 0.02 + L * f]); rad.push(i === 6 ? 0 : r * (X.bill.blunt ? 1 - 0.45 * f : Math.pow(1 - f, 0.8))); }
    tube(gb, pts, rad, sides, () => [X.bill.part ?? PART.TOOTH, 0, 0, 0]);
  }
  if (X.lure) { // anglerfish illicium + esca
    const Lr = X.lure; prof(Lr.t, o);
    const p0 = [0, o.yc + o.top * 0.95, 0.5 - Lr.t], p2 = [0, p0[1] + Lr.h * 0.5, 0.5 + Lr.fwd];
    const p1 = [0, p0[1] + Lr.h, (p0[2] + p2[2]) * 0.5];
    const pts = [], rad = [];
    for (let i = 0; i <= 8; i++) {
      const f = i / 8, a = (1 - f) * (1 - f), b = 2 * f * (1 - f), c = f * f;
      pts.push([0, a * p0[1] + b * p1[1] + c * p2[1], a * p0[2] + b * p1[2] + c * p2[2]]); rad.push(Lr.r * (1 - f * 0.6));
    }
    tube(gb, pts, rad, 4, () => [PART.BODY, 1, 0, 0]);
    sphere(gb, 0, p2[1], p2[2], Lr.glow, 5, 8, PART.GLOW, [0, -1, 0]);
  }
  if (X.barbel) { // dragonfish chin barbel with glowing tip
    const Br = X.barbel; prof(0.06, o);
    const pts = [], rad = [];
    for (let i = 0; i <= 8; i++) { const f = i / 8; pts.push([0.004 * Math.sin(f * 5), o.yc - o.bot * 0.8 - Br.len * f, 0.5 - 0.06 - Br.len * 0.25 * f * f]); rad.push(0.004 * (1 - f * 0.7)); }
    tube(gb, pts, rad, 4, () => [PART.BODY, -1, 0, 0]);
    const e = pts[pts.length - 1];
    sphere(gb, e[0], e[1], e[2], Br.glow, 4, 6, PART.GLOW, [0, -1, 0]);
  }
  if (X.teeth) { // fangs around the mouth
    const T = X.teeth; prof(T.t, o);
    const rng = mulberry32(77);
    for (let i = 0; i < T.n; i++) {
      const f = i / (T.n - 1), side = f < 0.5 ? -1 : 1, g = Math.abs(f - 0.5) * 2;
      const x = side * o.wid * 0.85 * g, z = 0.5 - T.t + (1 - g) * T.t * 0.9;
      const upper = i % 2 === 0;
      const y0 = o.yc + (upper ? 0.15 : -0.35) * o.top;
      const len = T.len * (0.6 + 0.6 * rng());
      const pts = [[x, y0, z], [x * 1.02, y0 + (upper ? -1 : 1) * len * 0.6, z + len * 0.3], [x, y0 + (upper ? -1 : 1) * len, z + len * 0.25]];
      tube(gb, pts, [T.r, T.r * 0.5, 0], 3, () => [PART.TOOTH, 0, 0, 0]);
    }
  }
  if (X.photo) { // row(s) of glowing photophores along the belly
    for (const row of X.photo.rows) for (let i = 0; i < X.photo.n; i++) {
      const t = X.photo.t0 + (X.photo.t1 - X.photo.t0) * (i / (X.photo.n - 1));
      prof(t, o);
      for (const side of [1, -1]) {
        const a = row, sp = [0, 0, 0];
        section(o, a, sp);
        sphere(gb, side * sp[0], sp[1], 0.5 - t, X.photo.r, 2, 4, PART.GLOW, [side, -0.5, 0]);
      }
    }
  }
  if (X.barbels) { // pair of chin barbels (goatfish, nurse shark)
    prof(0.05, o);
    for (const side of [1, -1]) {
      const L = X.barbels.len, x0 = side * o.wid * 0.35, y0 = o.yc - o.bot * 0.75, z0 = 0.5 - 0.05, pts = [];
      for (let i = 0; i <= 5; i++) { const f = i / 5; pts.push([x0 * (1 + f * 0.4), y0 - L * 0.8 * f, z0 - L * 0.5 * f * f]); }
      tube(gb, pts, [0.004, 0.0035, 0.003, 0.0025, 0.002, 0], 4, () => [PART.BODY, -1, 0, 0]);
    }
  }
  if (X.stilts) { // tripod fish: two elongated pelvic rays + the lower caudal ray, tips on the sea floor
    const H = sp.beh.perch ?? 2;
    prof(0.38, o);
    for (const s of [1, -1]) tube(gb, [[s * o.wid * 0.5, o.yc - o.bot * 0.85, 0.12], [s * 0.05, -H * 0.5, 0.15], [s * 0.1, -H, 0.2]], [0.007, 0.0045, 0], 4, () => [PART.PAIRED, -1, 0, 0]);
    prof(prof.tEnd - 0.02, o);
    const zc = 0.5 - prof.tEnd + 0.02;
    tube(gb, [[0, o.yc - o.bot * 0.9, zc], [0, -H * 0.5, zc - 0.05], [0, -H, zc - 0.1]], [0.007, 0.0045, 0], 4, () => [PART.PAIRED, -1, 0, 0]);
  }
  if (X.feelers) { // tripod fish: long pectoral rays held up and forward like antennae
    const Lf = X.feelers.len; prof(0.22, o);
    for (const s of [1, -1]) tube(gb, [[s * o.wid * 0.8, o.yc + o.top * 0.3, 0.28], [s * 0.07, o.top + Lf * 0.45, 0.3 + Lf * 0.3], [s * 0.13, o.top + Lf * 0.62, 0.34 + Lf * 0.6]], [0.004, 0.003, 0], 4, () => [PART.PAIRED, -1, 0, 0]);
  }
  if (X.tassels) { // frogfish skin flaps: short fleshy filaments all over the body (sargassumfish)
    const T = X.tassels, rng = mulberry32(91), s3 = [0, 0, 0], n = det.nL > 20 ? T.n : Math.ceil(T.n * 0.5);
    for (let i = 0; i < n; i++) {
      const t = 0.08 + 0.75 * rng(), a = rng() * PI * 2;
      prof(t, o); section(o, a, s3);
      const x = s3[0], y = s3[1], ox = x, oy = y - o.yc, ol = Math.hypot(ox, oy) || 1, L = T.len * (0.4 + 0.8 * rng());
      const dx = ox / ol, dy = oy / ol, z = 0.5 - t, bend = (rng() - 0.5) * 0.6;
      tube(gb, [[x, y, z], [x + dx * L * 0.55, y + dy * L * 0.55, z - L * 0.15], [x + dx * L + bend * L * 0.3, y + dy * L, z - L * 0.35]],
        [0.009, 0.006, 0], 3, () => [PART.BODY, s3[2], 0, 0]);
    }
  }
  if (X.disc) { // remora: the flat, ridged sucking disc on top of the head
    prof(0.14, o);
    sphere(gb, 0, o.yc + o.top * 0.9, 0.5 - 0.14, 1, Math.max(3, det.eLat), Math.max(6, det.eLon), PART.BEAK, [0, 1, 0], [o.wid * 0.75, o.top * 0.22, 0.11], 0);
  }
}

// ---------- jellyfish ----------
export function buildJelly(sp, lod = 0) {
  const gb = new GB(), J = sp.jelly, lv = levelOf(sp, lod), det = lv <= 1 ? 0 : 1;
  const rng = mulberry32(J.seed ?? 5);
  // swarm jellies (hundreds at once) use a much lighter bell
  const nR = J.cheap ? (lv <= 1 ? 5 : 8) : lv <= 1 ? 7 : lv >= 3 ? 13 : 10, nA = J.cheap ? (lv <= 1 ? 10 : 18) : lv <= 1 ? 16 : lv >= 3 ? 32 : 24;
  const H = J.h, thMax = J.th ?? 1.7;
  const rings = [];
  const rN = thMax > PI / 2 ? 1 : Math.sin(thMax), rimR = 0.5 * Math.sin(thMax) / rN + (J.flare ?? 0) * 0.5;
  for (let i = 0; i <= nR; i++) {
    const u = i / nR, th = u * thMax;
    const y = H * (Math.cos(th) - Math.cos(thMax)) / (1 - Math.cos(thMax));
    let r = 0.5 * Math.sin(th) / rN;
    r += (J.flare ?? 0) * Math.max(0, u - 0.75) * 2;
    if (i === 0) { const id = gb.v(0, y, 0, PART.BODY, 1, 0, 0); rings.push(new Array(nA).fill(id)); continue; }
    if (J.closed && i === nR) { const id = gb.v(0, y, 0, PART.BODY, 0, 0, 0); rings.push(new Array(nA).fill(id)); continue; }
    const ring = [];
    for (let j = 0; j < nA; j++) {
      const ph = (j / nA) * PI * 2;
      const rr = r * (1 + (J.scallop ?? 0.04) * Math.cos(ph * (J.lappets ?? 8)) * Math.max(0, u - 0.8) * 5);
      ring.push(gb.v(Math.cos(ph) * rr, y, Math.sin(ph) * rr, PART.BODY, H > 0 ? y / H : 0, j / nA, 0));
    }
    rings.push(ring);
  }
  const P = gb.P;
  for (let i = 0; i < nR; i++) for (let j = 0; j < nA; j++) {
    const j1 = (j + 1) % nA, A = rings[i], B = rings[i + 1], ref = B[j] * 3;
    gb.tri(A[j], B[j], A[j1], P[ref], P[ref + 1] - H * 0.3, P[ref + 2]);
    gb.tri(A[j1], B[j], B[j1], P[ref], P[ref + 1] - H * 0.3, P[ref + 2]);
  }
  // tentacles from the rim
  const nT = det === 0 ? Math.min(J.nT ?? 0, 8) : J.nT ?? 0, seg = det === 0 ? 8 : 12;
  for (let k = 0; k < nT; k++) {
    const ph = (k / nT) * PI * 2 + rng() * 0.2, L = J.tl * (0.6 + 0.4 * rng());
    const r0 = rimR * 0.94, pts = [], w = [];
    for (let i = 0; i <= seg; i++) {
      const f = i / seg, d = f * L;
      pts.push([Math.cos(ph) * r0 * (1 - 0.25 * f), -d + 0.01, Math.sin(ph) * r0 * (1 - 0.25 * f)]);
      w.push((J.tw ?? 0.006) * (1 - 0.7 * f));
    }
    ribbon(gb, pts, w, (i) => [PART.ARM, 0, k * 1.37, (i / seg) * L]);
  }
  // oral arms (frilly, from the centre); club-ended tubes for Mastigias-like swarm jellies
  const nO = J.nO ?? 0;
  if (J.club) {
    sphere(gb, 0, -0.05, 0, 1, 3, lv <= 1 ? 6 : 8, PART.ARM, [0, 1, 0], [0.16, 0.09, 0.16], 0); // dense oral mass under the bell
    const ns = lv <= 1 ? 3 : 4, sides = lv <= 1 ? 3 : 4;
    for (let k = 0; k < nO; k++) {
      const ph = (k / nO) * PI * 2 + 0.3, L = J.ol * (0.75 + 0.35 * rng()), pts = [], rad = [];
      for (let i = 0; i <= ns; i++) {
        const f = i / ns;
        pts.push([Math.cos(ph) * (0.06 + 0.1 * f), -0.04 - f * L, Math.sin(ph) * (0.06 + 0.1 * f)]);
        rad.push(i === ns ? 0 : (J.ow ?? 0.04) * (i === ns - 1 ? 1.6 : 0.8 - 0.15 * f) + (i === ns - 1 ? J.club : 0) * 0.5);
      }
      tube(gb, pts, rad, sides, (i) => [PART.ARM, 1, k * 2.11 + 5, (i / ns) * L]);
    }
    return gb.finish();
  }
  for (let k = 0; k < nO; k++) {
    const ph = (k / nO) * PI * 2 + 0.4, L = J.ol * (0.8 + 0.3 * rng()), pts = [], w = [];
    for (let i = 0; i <= seg; i++) {
      const f = i / seg;
      pts.push([Math.cos(ph) * (0.05 + 0.06 * f), -f * L + 0.02, Math.sin(ph) * (0.05 + 0.06 * f)]);
      w.push((J.ow ?? 0.04) * (1 - 0.6 * f));
    }
    ribbon(gb, pts, w, (i) => [PART.ARM, 1, k * 2.11 + 5, (i / seg) * L], J.twist ?? 1, 0.35);
  }
  return gb.finish();
}

// ---------- siphonophore: long translucent chain with glowing nodes ----------
export function buildSiphonophore(sp) {
  const gb = new GB(), nS = 90, pts = [], rad = [];
  for (let i = 0; i <= nS; i++) {
    const t = i / nS;
    pts.push([0, 0, 0.5 - t]);
    const head = t < 0.06 ? 0.02 * Math.sin((t / 0.06) * PI) : 0;
    rad.push(i === 0 || i === nS ? 0 : 0.004 + head + 0.0035 * Math.abs(Math.sin(t * 160)));
  }
  tube(gb, pts, rad, 6, (i) => [PART.BODY, 0, 0, 0]);
  for (let i = 0; i < 40; i++) {
    const t = 0.08 + 0.9 * (i / 39);
    sphere(gb, 0, -0.006, 0.5 - t, 0.0045, 2, 4, PART.GLOW, [0, -1, 0]);
  }
  for (let i = 0; i < 26; i++) { // dangling feeding tentacles
    const t = 0.1 + 0.88 * (i / 25), pts2 = [], w = [];
    for (let k = 0; k <= 5; k++) { pts2.push([0, -k * 0.012, 0.5 - t + k * 0.002]); w.push(0.0012); }
    ribbon(gb, pts2, w, (k) => [PART.ARM, 0, i, k * 0.012]);
  }
  return gb.finish();
}

// ---------- squid / cuttlefish ----------
export function buildSquid(sp, lod = 0) {
  const gb = new GB(), S = sp.squid, det = detOf(sp, lod);
  const prof = bodyProfile(sp.body);
  loft(gb, prof, det.nL, det.nA);
  const o = {}, s3 = [0, 0, 0];
  // fins
  if (S.fin) {
    const f = S.fin;
    for (const side of [1, -1]) fin(gb, {
      nU: det.fu + 2, nW: det.fw, pn: [0, 1, 0], part: PART.MEDIAN, vN: 0, thick: 0.02,
      root: (u) => { const t = f.t0 + (f.t1 - f.t0) * u; prof(t, o); return [side * o.wid * 0.92, o.yc, 0.5 - t]; },
      dir: () => [side * 0.94, 0, -(f.sweep ?? 0.3)],
      H: (u) => f.h * ctrl(FIN_SHAPES[f.shape || 'rhomb'], u),
    });
  }
  // eyes
  prof(S.eyeT, o);
  for (const side of [1, -1]) sphere(gb, side * o.wid * 0.82, o.yc + o.top * 0.15, 0.5 - S.eyeT, S.eyeR, det.eLat, det.eLon, PART.EYE, [side, 0.1, 0]);
  // arms
  const front = S.armsFront;
  const tA = front ? 0.0 : prof.tLast - 0.01;
  prof(front ? 0.04 : tA - 0.03, o);
  const r0 = Math.max(o.wid, o.top) * 0.55;
  const nArms = S.arms ?? 8;
  for (let k = 0; k < nArms + (S.tentacles ? 2 : 0); k++) {
    const isT = k >= nArms;
    const a = isT ? (k === nArms ? 0.3 : PI - 0.3) : (k / nArms) * PI * 2;
    const L = isT ? S.tentLen : S.armLen * (0.8 + 0.2 * Math.cos(a * 2));
    const n = det.nL > 20 ? 10 : 6, pts = [], rad = [];
    const dir = front ? 1 : -1;
    for (let i = 0; i <= n; i++) {
      const f = i / n, spread = (S.spread ?? 0.4) * Math.sin(f * PI * 0.8);
      const rr = r0 * (1 + spread * (front ? 0.3 : 1.5));
      pts.push([Math.cos(a) * rr, o.yc + Math.sin(a) * rr * 0.8, 0.5 - tA + dir * f * L]);
      let r = S.armR * (1 - 0.85 * f);
      if (isT && f > 0.8) r = S.armR * 1.1;
      if (i === n) r = 0;
      rad.push(r);
    }
    tube(gb, pts, rad, det.nL > 20 ? 5 : 4, (i) => [PART.ARM, 0, k, (i / n) * L]);
    if (S.glowTips) { const e = pts[n - 1]; sphere(gb, e[0], e[1], e[2], S.armR * 0.9, 2, 4, PART.GLOW, [0, 1, 0]); }
  }
  // cuttlefish skirt fin along the mantle
  if (S.skirt) {
    const f = S.skirt;
    for (const side of [1, -1]) fin(gb, {
      nU: det.fu * 3, nW: Math.max(1, det.fw), pn: [0, 1, 0], part: PART.MEDIAN, vN: 0, thick: 0.02,
      root: (u) => { const t = f.t0 + (f.t1 - f.t0) * u; prof(t, o); section(o, 0, s3); return [side * s3[0] * 0.95, s3[1], 0.5 - t]; },
      dir: () => [side, -0.05, 0],
      H: (u) => f.h * (0.4 + 0.6 * Math.sin(PI * Math.min(1, u * 1.05))),
    });
  }
  return gb.finish();
}

// ---------- octopus (upright, resting on the floor; local +y up, +z front) ----------
export function buildOctopus(sp, lod = 0) {
  const gb = new GB(), det = detOf(sp, lod), O = sp.octo || {};
  const lat = det.eLat + 3, lon = det.eLon + 4;
  sphere(gb, 0, 0.26, -0.12, 0.15, lat, lon, PART.BODY, [0, 0.6, -0.8], [0.8, 1, 1], 0);
  sphere(gb, 0, 0.12, 0.02, 0.1, lat - 1, lon, PART.BODY, [0, 1, 0], [1, 0.8, 1]);
  for (const s of [1, -1]) sphere(gb, s * 0.065, 0.17, 0.06, 0.02, det.eLat, det.eLon, PART.EYE, [s, 0.4, 0.4]);
  const n = det.nL > 20 ? 14 : 9, L = O.armLen ?? 0.55;
  for (let k = 0; k < 8; k++) {
    const a0 = ((k + 0.5) / 8) * PI * 2, pts = [], rad = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, d = f * L;
      const a = a0 + 0.5 * Math.sin(k * 1.7 + 1) * f;
      let r = 0.06 + d, y = 0.07 * Math.exp(-f * 6) + 0.018;
      if (f > 0.75) { const c = (f - 0.75) / 0.25; r -= c * c * 0.05; y += c * c * 0.06; }
      pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
      rad.push(i === n ? 0 : 0.045 * (1 - 0.9 * Math.pow(f, 0.8)));
    }
    tube(gb, pts, rad, det.nL > 20 ? 6 : 4, (i) => [PART.ARM, 0, k, (i / n) * L], 1);
  }
  return gb.finish();
}

// ---------- seahorse (upright: local +y up, snout toward +z) ----------
export function buildSeahorse(sp, lod = 0) {
  const gb = new GB(), det = detOf(sp, lod);
  const spine = [[0, 0.40, -0.01], [0, 0.34, 0.03], [0, 0.26, 0.055], [0, 0.16, 0.06], [0, 0.05, 0.035], [0, -0.06, -0.01],
    [0, -0.17, -0.035], [0, -0.27, -0.02], [0, -0.33, 0.03], [0, -0.32, 0.085], [0, -0.27, 0.095], [0, -0.245, 0.06]];
  const rad = [0.0, 0.045, 0.06, 0.075, 0.075, 0.06, 0.04, 0.028, 0.02, 0.014, 0.009, 0];
  // resample for smoothness
  const pts = [], rr = [], N = det.nL;
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * (spine.length - 1), k = Math.min(Math.floor(x), spine.length - 2), f = x - k;
    const a = spine[Math.max(k - 1, 0)], b = spine[k], c = spine[k + 1], d = spine[Math.min(k + 2, spine.length - 1)];
    const cr = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * f + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * f * f + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * f * f * f);
    pts.push([0, cr(1), cr(2)]);
    rr.push(i === 0 || i === N ? 0 : rad[k] + (rad[k + 1] - rad[k]) * f);
  }
  tube(gb, pts, rr, det.nA, (i) => [PART.BODY, 1 - (2 * i) / N, 0, 0], 0.8);
  // head + snout
  const hp = [[0, 0.405, -0.035], [0, 0.415, 0.02], [0, 0.41, 0.07], [0, 0.402, 0.13], [0, 0.4, 0.17], [0, 0.4, 0.172]];
  tube(gb, hp, [0, 0.045, 0.034, 0.014, 0.017, 0], det.nA, () => [PART.BODY, 0.8, 0, 0], 0.8);
  // crown (coronet)
  tube(gb, [[0, 0.43, -0.01], [0, 0.47, -0.02], [0, 0.48, -0.025]], [0.018, 0.01, 0], 5, () => [PART.BODY, 1, 0, 0]);
  for (const s of [1, -1]) sphere(gb, s * 0.03, 0.415, 0.04, 0.014, det.eLat, det.eLon, PART.EYE, [s, 0.2, 0.3]);
  // dorsal fin on the back
  fin(gb, {
    nU: det.fu + 2, nW: det.fw, pn: [1, 0, 0], part: PART.MEDIAN, vN: 0.5, thick: 0.02,
    root: (u) => [0, 0.1 - u * 0.12, -0.0 - 0.035 - u * 0.02], dir: () => [0, 0.1, -1], H: () => 0.045,
  });
  for (const s of [1, -1]) fin(gb, {
    nU: 3, nW: 1, pn: [0, 0, 1], part: PART.PAIRED, vN: 0, thick: 0.02,
    root: (u) => [s * 0.035, 0.36 - u * 0.02, 0.0], dir: () => [s * 0.8, 0, -0.6], H: () => 0.025,
  });
  return gb.finish();
}

// ---------- walkers: local +y up, feet on y = 0, +z = direction of travel ----------
// Legs and antennae are PART.ARM with aG = (6, band 0/1, index, fraction along it): |index| 1..9 legs
// (sign = side, stepping in a metachronal wave in the shader), |index| >= 10 antennae / papillae (sway).
function leg(gb, pts, r0, r1, sides, idx, band = true) {
  const n = pts.length, rad = [], cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const Lt = cum[n - 1] || 1;
  for (let i = 0; i < n; i++) rad.push(i === n - 1 ? 0 : r0 + (r1 - r0) * (cum[i] / Lt));
  tube(gb, pts, rad, sides, (i) => [PART.ARM, band ? Math.floor((cum[i] / Lt) * 3.999) & 1 : 0, idx, cum[i] / Lt]);
}
const flatY = (T, y) => T.map(() => y);

// Crab: walks sideways, so the wide carapace lies along local z; eyes and claws face +x.
export function buildCrab(sp, lod = 0) {
  const gb = new GB(), L = detOf(sp, lod), C = sp.crab || {}, sides = L.nA >= 12 ? 6 : 4;
  const cw = C.w ?? 0.33, cl = C.l ?? 0.25, ch = C.h ?? 0.1, cy = C.y ?? 0.15;
  sphere(gb, 0, cy, 0, 1, L.eLat + 3, L.eLon + 6, PART.BODY, [0, 1, 0], [cl, ch, cw]);
  for (const s of [1, -1]) { // eyes on stalks
    tube(gb, [[cl * 0.8, cy + ch * 0.4, s * 0.06], [cl * 0.95, cy + ch * 1.15, s * 0.075]], [0.013, 0.01], 4, () => [PART.BODY, 0.6, 0, 0]);
    sphere(gb, cl * 0.96, cy + ch * 1.3, s * 0.077, 0.019, L.eLat, L.eLon, PART.EYE, [1, 0.7, s * 0.4]);
  }
  const span = C.span ?? 0.52, kneeH = C.knee ?? 0.24, lr = C.legR ?? 0.024;
  for (const s of [1, -1]) for (let k = 0; k < 4; k++) { // walking legs, knee raised, tips on the floor
    const x0 = cl * (0.42 - k * 0.36), z0 = s * cw * 0.82;
    const xk = x0 * 1.2 + (k - 1.5) * 0.04, zk = s * (cw + (span - cw) * 0.55);
    const xt = x0 * 1.5 + (k - 1.5) * 0.1, zt = s * span;
    leg(gb, [[x0, cy - ch * 0.25, z0], [(x0 + xk) / 2, (cy + kneeH) / 2 + 0.02, (z0 + zk) / 2], [xk, kneeH, zk], [(xk + xt) / 2, kneeH * 0.5, (zk + zt) / 2], [xt, 0, zt]], lr, lr * 0.45, sides, s * (k + 1));
  }
  const cs = C.claw ?? 1;
  for (const s of [1, -1]) { // claws: arm, swollen palm, two fingers
    const a0 = [cl * 0.7, cy - ch * 0.15, s * cw * 0.45], a1 = [cl * 1.12, cy + 0.02, s * cw * 0.62], a2 = [cl * 1.42, cy - 0.01, s * cw * 0.36];
    tube(gb, [a0, a1, a2], [lr * 1.3 * cs, lr * 1.25 * cs, lr * 1.5 * cs], sides, () => [PART.BODY, 0.3, 0, 0]);
    sphere(gb, a2[0] + 0.05 * cs, a2[1], a2[2], 0.065 * cs, Math.max(3, L.eLat), Math.max(6, L.eLon), PART.BODY, [1, 0, 0], [1, 0.55, 0.62], 0);
    for (const f of [1, -1]) tube(gb, [[a2[0] + 0.1 * cs, a2[1] + f * 0.012 * cs, a2[2]], [a2[0] + 0.17 * cs, a2[1] + f * 0.004 * cs, a2[2] - s * 0.01]], [0.016 * cs, 0], 4, () => [PART.BEAK, 0, 0, 0]);
  }
  return gb.finish();
}

// Spiny lobster: carapace + segmented abdomen + tail fan, very long spiny antennae, 5 pairs of legs.
export function buildLobster(sp, lod = 0) {
  const gb = new GB(), L = detOf(sp, lod), X = sp.lobster || {}, sides = L.nA >= 12 ? 6 : 4, y0 = X.y ?? 0.13;
  const T = [0, 0.03, 0.1, 0.2, 0.3, 0.38, 0.42, 0.5, 0.58, 0.66, 0.74, 0.8, 0.84];
  const prof = bodyProfile({ st: { t: T,
    top: [0.02, 0.068, 0.098, 0.11, 0.108, 0.092, 0.078, 0.079, 0.075, 0.069, 0.059, 0.045, 0],
    bot: [0.015, 0.045, 0.065, 0.072, 0.07, 0.058, 0.05, 0.049, 0.045, 0.04, 0.034, 0.025, 0],
    wid: [0.027, 0.078, 0.115, 0.128, 0.125, 0.108, 0.095, 0.1, 0.096, 0.088, 0.076, 0.061, 0], yc: flatY(T, y0) }, n: 2.3, nb: 2.8 });
  loft(gb, prof, L.nL, L.nA);
  const o = {}; prof(0.8, o);
  fin(gb, { nU: Math.max(3, L.cu - 2), nW: L.fw + 1, pn: [0, 1, 0], part: PART.CAUDAL, vN: 0, thick: 0.05,
    root: (u) => [(u - 0.5) * 2 * o.wid * 0.95, y0, 0.5 - 0.8],
    dir: (u) => { const a = (u - 0.5) * 1.6; return [Math.sin(a), -0.06, -Math.cos(a)]; },
    H: (u) => 0.18 * (0.82 + 0.18 * Math.cos((u - 0.5) * 3)) });
  const N = L.nL > 20 ? 12 : 8, len = X.ant ?? 1.2;
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= N; i++) { const f = i / N; pts.push([s * (0.03 + 0.05 * f + 0.32 * f * f), y0 + 0.05 + 0.09 * Math.sin(f * 2.2) - 0.06 * f, 0.47 + len * f * (1 - 0.3 * f)]); }
    leg(gb, pts, 0.022, 0.004, sides, s * 10);
    leg(gb, [[s * 0.012, y0 + 0.03, 0.48], [s * 0.03, y0 + 0.08, 0.57], [s * 0.05, y0 + 0.09, 0.66]], 0.005, 0.002, 4, s * 11, false);
    sphere(gb, s * 0.03, y0 + 0.055, 0.47, 0.012, L.eLat, L.eLon, PART.EYE, [s * 0.6, 0.4, 1]);
    tube(gb, [[s * 0.022, y0 + 0.05, 0.44], [s * 0.034, y0 + 0.1, 0.5]], [0.01, 0], 4, () => [PART.BEAK, 0, 0, 0]);
    for (let k = 0; k < 5; k++) {
      const z0 = 0.5 - (0.12 + k * 0.055), dz = (2 - k) * 0.045;
      leg(gb, [[s * 0.05, y0 - 0.04, z0], [s * 0.1, y0 + 0.005, z0 + dz * 0.4], [s * 0.13, y0 + 0.015, z0 + dz * 0.6], [s * 0.155, y0 * 0.45, z0 + dz * 0.85], [s * 0.17, 0, z0 + dz]], 0.011, 0.005, sides, s * (k + 1));
    }
  }
  return gb.finish();
}

// Giant isopod: broad armoured body of overlapping plates, big compound eyes, 7 pairs of short legs.
export function buildIsopod(sp, lod = 0) {
  const gb = new GB(), L = detOf(sp, lod), y0 = 0.075;
  const T = [0, 0.03, 0.08, 0.16, 0.3, 0.5, 0.7, 0.82, 0.9, 0.95];
  const bumps = []; for (let k = 0; k < 7; k++) bumps.push(['t', 0.24 + k * 0.08, 0.018, 0.07]);
  const prof = bodyProfile({ st: { t: T, top: [0.012, 0.04, 0.058, 0.068, 0.074, 0.075, 0.068, 0.054, 0.034, 0],
    bot: [0.008, 0.014, 0.018, 0.02, 0.022, 0.022, 0.02, 0.016, 0.011, 0],
    wid: [0.04, 0.12, 0.165, 0.195, 0.21, 0.215, 0.195, 0.155, 0.1, 0], yc: flatY(T, y0) }, n: 1.7, nb: 3.4, bumps });
  loft(gb, prof, L.nL, L.nA);
  const o = {}; prof(0.88, o);
  fin(gb, { nU: Math.max(3, L.cu - 2), nW: L.fw, pn: [0, 1, 0], part: PART.CAUDAL, vN: 0, thick: 0.05,
    root: (u) => [(u - 0.5) * 2 * o.wid * 0.9, y0, 0.5 - 0.88], dir: (u) => { const a = (u - 0.5) * 1.2; return [Math.sin(a), -0.05, -Math.cos(a)]; },
    H: (u) => 0.08 * (0.7 + 0.3 * Math.cos((u - 0.5) * 3)) });
  for (const s of [1, -1]) {
    sphere(gb, s * 0.115, y0 + 0.03, 0.43, 0.036, L.eLat, L.eLon, PART.EYE, [s, 0.3, 0.5], [0.55, 0.75, 1.25]);
    const pts = [];
    for (let i = 0; i <= 8; i++) { const f = i / 8; pts.push([s * (0.05 + 0.22 * f), y0 + 0.02 + 0.03 * Math.sin(f * 3), 0.47 + 0.12 * f - 0.5 * f * f]); }
    leg(gb, pts, 0.008, 0.003, 4, s * 10, false);
    leg(gb, [[s * 0.03, y0 + 0.01, 0.48], [s * 0.06, y0 + 0.03, 0.56], [s * 0.08, y0 + 0.02, 0.6]], 0.006, 0.003, 4, s * 11, false);
    for (let k = 0; k < 7; k++) {
      const z0 = 0.5 - (0.16 + k * 0.095), dz = (3 - k) * 0.025;
      leg(gb, [[s * 0.12, y0 - 0.012, z0], [s * 0.2, y0 + 0.01, z0 + dz * 0.5], [s * 0.245, y0 * 0.5, z0 + dz * 0.8], [s * 0.265, 0, z0 + dz]], 0.012, 0.006, 4, s * (k + 1), false);
    }
  }
  return gb.finish();
}

// Sea pig (Scotoplanes): a plump holothurian on tube-feet "legs", with dorsal papillae waving like antennae.
export function buildSeaPig(sp, lod = 0) {
  const gb = new GB(), L = detOf(sp, lod), y0 = 0.1;
  const T = [0, 0.05, 0.18, 0.45, 0.75, 0.92, 1];
  const prof = bodyProfile({ st: { t: T, top: [0.02, 0.09, 0.13, 0.145, 0.13, 0.08, 0], bot: [0.015, 0.05, 0.075, 0.08, 0.075, 0.05, 0],
    wid: [0.02, 0.09, 0.14, 0.155, 0.14, 0.085, 0], yc: flatY(T, y0) }, n: 2.1, nb: 3.0 });
  loft(gb, prof, L.nL, L.nA);
  const o = {};
  for (const s of [1, -1]) {
    for (let k = 0; k < 6; k++) { // tube feet
      const t = 0.16 + k * 0.13; prof(t, o);
      leg(gb, [[s * o.wid * 0.75, y0 - o.bot * 0.6, 0.5 - t], [s * (o.wid * 0.95 + 0.02), y0 * 0.45, 0.5 - t + 0.01], [s * (o.wid + 0.04), 0, 0.5 - t + 0.02]], 0.028, 0.012, 4, s * (k + 1), false);
    }
    prof(0.2, o); // two pairs of long dorsal papillae
    leg(gb, [[s * 0.05, y0 + o.top * 0.9, 0.3], [s * 0.07, y0 + o.top + 0.12, 0.34], [s * 0.1, y0 + o.top + 0.25, 0.38]], 0.022, 0.008, 4, s * 10, false);
    prof(0.3, o);
    leg(gb, [[s * 0.06, y0 + o.top * 0.92, 0.2], [s * 0.09, y0 + o.top + 0.08, 0.22], [s * 0.12, y0 + o.top + 0.15, 0.24]], 0.018, 0.007, 4, s * 12, false);
  }
  return gb.finish();
}

// Dumbo octopus (local +y up): mantle with two ear-like fins, webbed umbrella of arms beneath.
export function buildDumbo(sp, lod = 0) {
  const gb = new GB(), L = detOf(sp, lod), lat = L.eLat + 3, lon = L.eLon + 6;
  sphere(gb, 0, 0.3, -0.03, 0.15, lat, lon, PART.BODY, [0, 1, -0.2], [0.95, 1.2, 1]);
  sphere(gb, 0, 0.15, 0, 0.12, lat - 1, lon, PART.BODY, [0, 1, 0], [1.05, 0.85, 1.05]);
  for (const s of [1, -1]) sphere(gb, s * 0.085, 0.17, 0.075, 0.028, L.eLat, L.eLon, PART.EYE, [s, 0.2, 0.6]);
  sphere(gb, 0, 0.03, 0, 1, lat, lon * 2, PART.BODY, [0, 1, 0], [0.4, 0.07, 0.4]); // the web
  const n = L.nL > 20 ? 8 : 5;
  for (let k = 0; k < 8; k++) { // arm ridges under the web, tips curling past the rim
    const a = ((k + 0.5) / 8) * PI * 2, pts = [], rad = [];
    for (let i = 0; i <= n; i++) { const f = i / n, r = 0.05 + 0.4 * f; pts.push([Math.cos(a) * r, 0.0 - 0.02 * f + 0.05 * Math.max(0, f - 0.85) * 6, Math.sin(a) * r]); rad.push(i === n ? 0 : 0.03 * (1 - 0.7 * f)); }
    tube(gb, pts, rad, 4, (i) => [PART.ARM, 0, k, (i / n) * 0.4]);
  }
  for (const s of [1, -1]) fin(gb, { nU: 4, nW: Math.max(1, L.fw), pn: [0, 0, 1], part: PART.PAIRED, vN: 0, thick: 0.06,
    root: (u) => [s * 0.125, 0.27 + u * 0.1, -0.03], dir: () => [s * 0.96, 0.26, -0.1], H: (u) => 0.13 * ctrl(FIN_SHAPES.paddle, u) });
  return gb.finish();
}

// Cassiopea (local +y up): the bell lies upside down on the mud; eight branched, frilly oral arms reach up.
export function buildCassiopea(sp, lod = 0) {
  const gb = new GB(), L = detOf(sp, lod), rng = mulberry32(31);
  sphere(gb, 0, 0.025, 0, 1, Math.max(4, L.eLat), L.eLon * 2 + 8, PART.BODY, [0, 1, 0], [0.5, 0.05, 0.5]);
  const N = L.nL > 20 ? 6 : 4;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2 + 0.2, ca = Math.cos(a), sa = Math.sin(a), pts = [], rad = [];
    for (let i = 0; i <= N; i++) { const f = i / N; pts.push([ca * (0.04 + 0.3 * f), 0.05 + 0.13 * Math.sin(f * 1.7), sa * (0.04 + 0.3 * f)]); rad.push(i === N ? 0 : 0.034 * (1 - 0.55 * f)); }
    tube(gb, pts, rad, 5, (i) => [PART.ARM, 0, k, (i / N) * 0.35]);
    for (let b = 0; b < 4; b++) { // frilly side branches tipped with vesicles
      const f = 0.3 + b * 0.17, p = pts[Math.min(N, Math.round(f * N))], side = b % 2 ? 1 : -1;
      const bx = ca * Math.cos(side * 0.9) - sa * Math.sin(side * 0.9), bz = sa * Math.cos(side * 0.9) + ca * Math.sin(side * 0.9);
      const q1 = [p[0] + bx * 0.06, p[1] + 0.05, p[2] + bz * 0.06], q2 = [p[0] + bx * 0.1, p[1] + 0.06 + rng() * 0.03, p[2] + bz * 0.1];
      tube(gb, [p, q1, q2], [0.018, 0.013, 0], 4, () => [PART.ARM, 0.3, k + b, f * 0.35]);
      sphere(gb, q2[0], q2[1], q2[2], 0.022 + rng() * 0.012, 3, 5, PART.ARM, [0, 1, 0], [1, 0.8, 1], 0);
    }
  }
  return gb.finish();
}

export function buildSpecies(sp, lod = 0) {
  switch (sp.plan) {
    case 'jelly': return buildJelly(sp, lod);
    case 'siphon': return buildSiphonophore(sp);
    case 'squid': return buildSquid(sp, lod);
    case 'octopus': return buildOctopus(sp, lod);
    case 'seahorse': return buildSeahorse(sp, lod);
    case 'crab': return buildCrab(sp, lod);
    case 'lobster': return buildLobster(sp, lod);
    case 'isopod': return buildIsopod(sp, lod);
    case 'seapig': return buildSeaPig(sp, lod);
    case 'dumbo': return buildDumbo(sp, lod);
    case 'cassiopea': return buildCassiopea(sp, lod);
    default: return buildFish(sp, lod);
  }
}
