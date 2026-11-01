// Rock recipes for the lazy per-segment palettes (rock_gen.js). Each recipe is a generator function that
// yields every few hundred vertices (so a budgeted job never blocks for long) and returns a Template.
// Colours are relative tints with luminance ~1: biome specs multiply their own rock tint on top, while each
// rock keeps its own hue, banding, veins, speckle or clasts. Every part of a rock (each slab piece, column,
// pillow or boulder of a pile) has its bottom flattened onto y = 0, so the whole footprint is contact band:
// seated with groundY it is buried at the high spots and never hovers over a dip.
import { Builder, TAU, fbm3, vn3, sat, sstep, lerp, icosphere } from './core.js';
import { mulberry32 } from '../noise.js';

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// in-place colour helpers (the per-vertex paint loops must not allocate: garbage means GC pauses)
export function set3(c, a) { c[0] = a[0]; c[1] = a[1]; c[2] = a[2]; return c; }
export function mixIn(c, b, t) { c[0] += (b[0] - c[0]) * t; c[1] += (b[1] - c[1]) * t; c[2] += (b[2] - c[2]) * t; return c; }
// allocation-free area-weighted normals for vertices >= v0 from triangles >= i0 (Builder.smooth allocates)
export function smoothRange(b, v0, i0) {
  const P = b.P, N = b.N, I = b.I, a0 = v0 * 3;
  for (let k = a0; k < N.length; k++) N[k] = 0;
  for (let k = i0; k < I.length; k += 3) {
    const a = I[k] * 3, c1 = I[k + 1] * 3, c2 = I[k + 2] * 3;
    const e1x = P[c1] - P[a], e1y = P[c1 + 1] - P[a + 1], e1z = P[c1 + 2] - P[a + 2];
    const e2x = P[c2] - P[a], e2y = P[c2 + 1] - P[a + 1], e2z = P[c2 + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (a >= a0) { N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; }
    if (c1 >= a0) { N[c1] += nx; N[c1 + 1] += ny; N[c1 + 2] += nz; }
    if (c2 >= a0) { N[c2] += nx; N[c2 + 1] += ny; N[c2 + 2] += nz; }
  }
  for (let k = a0; k < N.length; k += 3) {
    const l = Math.sqrt(N[k] * N[k] + N[k + 1] * N[k + 1] + N[k + 2] * N[k + 2]) || 1;
    N[k] /= l; N[k + 1] /= l; N[k + 2] /= l;
  }
}

// ---------- generator versions of the Builder primitives ----------
export function* blobG(b, detail, fn, per = 320) {
  const ico = icosphere(detail), v0 = b.vc, i0 = b.I.length, o = [0, 0, 0, 1, 1, 1, 0, 0];
  for (let k = 0, n = 0; k < ico.pos.length; k += 3) {
    o[3] = o[4] = o[5] = 1; o[6] = o[7] = 0;
    fn(ico.pos[k], ico.pos[k + 1], ico.pos[k + 2], o);
    b.v(o[0], o[1], o[2], 0, 1, 0, o[3], o[4], o[5], o[6], o[7]);
    if (++n % per === 0) yield;
  }
  for (let k = 0; k < ico.idx.length; k++) b.I.push(v0 + ico.idx[k]);
  smoothRange(b, v0, i0);
  yield;
  return v0;
}
export function* paintG(b, v0, fn, per = 700) {
  const o = [1, 1, 1, 0, 0], P = b.P, N = b.N, C = b.C, F = b.F;
  for (let i = v0, n = 0; i < b.vc; i++) {
    o[0] = C[i * 3]; o[1] = C[i * 3 + 1]; o[2] = C[i * 3 + 2]; o[3] = F[i * 2]; o[4] = F[i * 2 + 1];
    fn(i, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], o);
    C[i * 3] = o[0]; C[i * 3 + 1] = o[1]; C[i * 3 + 2] = o[2]; F[i * 2] = o[3]; F[i * 2 + 1] = o[4];
    if (++n % per === 0) yield;
  }
  yield;
}
// wrapped parametric grid (surface of revolution style), yielding every 8 rows
export function* gridG(b, nu, nv, fn, flip = false) {
  const v0 = b.vc, i0 = b.I.length, o = [0, 0, 0, 1, 1, 1, 0, 0];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i < nu; i++) {
      o[3] = o[4] = o[5] = 1; o[6] = o[7] = 0;
      fn(i / nu, j / nv, i, j, o);
      b.v(o[0], o[1], o[2], 0, 1, 0, o[3], o[4], o[5], o[6], o[7]);
    }
    if ((j & 7) === 7) yield;
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = v0 + j * nu + i, c = v0 + j * nu + ((i + 1) % nu), d = a + nu, e = c + nu;
    if (!flip) { b.t(a, d, c); b.t(c, d, e); } else { b.t(a, c, d); b.t(c, e, d); }
  }
  yield;
  smoothRange(b, v0, i0);
  yield;
  return v0;
}
// run a recipe generator to completion (startup / synchronous callers)
export function drain(it) { let r; do r = it.next(); while (!r.done); return r.value; }

// ---------- lithologies: relative colours and surface character ----------
// base/alt: two tones blended by blotch noise; speck: salt-and-pepper crystals; veins: quartz veins;
// bands: layering strength (fold: folded bands as in gneiss); stain: iron-oxide streaks
const LITHO = {
  granite: { base: [1.0, 0.97, 0.93], alt: [0.8, 0.79, 0.77], speck: 0.32, veins: 0.45, stain: 0.3, name: 'Granite boulder', fact: 'Granite cooled slowly deep underground, growing the large crystals that speckle it.' },
  pinkGranite: { base: [1.13, 0.9, 0.82], alt: [0.95, 0.86, 0.84], speck: 0.38, veins: 0.35, stain: 0.2, name: 'Pink granite', fact: 'The pink in this granite comes from crystals of potassium feldspar.' },
  diorite: { base: [0.9, 0.9, 0.88], alt: [1.12, 1.1, 1.06], speck: 0.7, stain: 0.15, name: 'Diorite boulder', fact: "Diorite's salt-and-pepper look comes from black hornblende and white feldspar crystals." },
  basalt: { base: [0.72, 0.71, 0.72], alt: [0.86, 0.75, 0.64], speck: 0.06, stain: 0.5, name: 'Basalt boulder', fact: 'Basalt is cooled lava; it makes up most of the ocean floor.' },
  sandstone: { base: [1.18, 1.0, 0.74], alt: [1.04, 0.84, 0.62], bands: 0.55, stain: 0.35, name: 'Sandstone boulder', fact: 'Sandstone is ancient sand, its grains cemented together over millions of years.' },
  redSand: { base: [1.24, 0.8, 0.58], alt: [1.1, 0.92, 0.74], bands: 0.65, stain: 0.2, name: 'Red sandstone', fact: 'Red sandstone is coloured by a thin coat of iron oxide, rust, on every grain.' },
  limestone: { base: [1.18, 1.14, 1.02], alt: [0.98, 0.96, 0.88], bands: 0.25, stain: 0.25, name: 'Limestone boulder', fact: 'Most limestone is made of the shells and skeletons of ancient sea creatures.' },
  greenstone: { base: [0.86, 1.0, 0.87], alt: [0.72, 0.82, 0.74], veins: 0.65, stain: 0.15, name: 'Greenstone', fact: 'Greenstone is old seafloor basalt, turned green by hot water and pressure deep in the crust.' },
  gneiss: { base: [1.14, 1.09, 1.02], alt: [0.62, 0.59, 0.57], bands: 1.0, fold: 1, stain: 0.15, name: 'Banded gneiss', fact: 'Gneiss formed deep in the crust, where heat and pressure squeezed its minerals into bands.' },
  slate: { base: [0.8, 0.82, 0.88], alt: [0.68, 0.7, 0.75], bands: 0.35, stain: 0.3, name: 'Slate', fact: 'Slate is mud pressed into stone; it splits into thin sheets along its old layers.' },
  sulfide: { base: [0.6, 0.55, 0.51], alt: [1.05, 0.62, 0.34], stain: 0.9, name: 'Sulphide rubble', fact: 'Collapsed vent chimneys leave rubble rich in copper, zinc and iron sulphides.' },
};
export const LITHO_KEYS = Object.keys(LITHO);

// colour of a lithology at template point (x,y,z); L.k = per-rock tint; returns into o[0..2]
const C3 = [0, 0, 0], VEIN = [1.35, 1.33, 1.27];
function lithoCol(L, x, y, z, seed, o) {
  const n1 = vn3(x * 1.4 + 3.1, y * 1.4, z * 1.4, seed + 31), c = mixIn(set3(C3, L.base), L.alt, sstep(-0.25, 0.55, n1) * 0.7);
  if (L.speck) { // crystal speckle: per-vertex hash, dark and light grains
    const h = vn3(x * 23.7, y * 23.7, z * 23.7, seed + 5);
    const k = h > 0.42 ? 1 - L.speck * 0.55 : h < -0.5 ? 1 + L.speck * 0.35 : 1;
    c[0] *= k; c[1] *= k; c[2] *= k;
  }
  if (L.bands) {
    const q = (L.dx * x + L.dy * y + L.dz * z) * L.bf + (L.fold ? 1.6 * vn3(x * 0.9, y * 0.9, z * 0.9, seed + 9) : 0.4 * n1);
    const bnd = 0.5 + 0.5 * Math.sin(q * TAU);
    mixIn(c, L.alt, L.bands * sstep(0.35, 0.8, bnd) * 0.75);
  }
  if (L.veins) { // thin quartz veins along noise zero-crossings
    const v = Math.abs(vn3(x * 1.2 + 7, y * 1.2, z * 1.2, seed + 17));
    const w = sstep(0.07, 0.015, v) * L.veins;
    if (w > 0) mixIn(c, VEIN, w);
  }
  if (L.stain) { // iron-oxide streaks running down the faces
    const st = sstep(0.35, 0.75, vn3(x * 3.1, y * 0.55, z * 3.1, seed + 41)) * L.stain;
    c[0] *= 1 + 0.1 * st; c[1] *= 1 - 0.1 * st; c[2] *= 1 - 0.25 * st;
  }
  o[0] = c[0] * L.k[0]; o[1] = c[1] * L.k[1]; o[2] = c[2] * L.k[2];
}
function lithoOf(key, rng) {
  const B = LITHO[key] || LITHO.granite;
  const d = [rng() - 0.5, 1 + rng() * 2, rng() - 0.5], l = Math.hypot(d[0], d[1], d[2]);
  return {
    ...B, key,
    k: [1 + (rng() - 0.5) * 0.12, 1 + (rng() - 0.5) * 0.1, 1 + (rng() - 0.5) * 0.12], // every rock its own hue
    dx: d[0] / l, dy: d[1] / l, dz: d[2] / l, bf: 1.6 + rng() * 2.6,
  };
}
const texKey = (rng) => 6.05 + rng() * 0.9; // per-template rock texture key (static material mode 6.x)

// ambient occlusion by height and normal (same feel as shapes.rockLib)
const aoOf = (y, top, ny) => (0.42 + 0.58 * sstep(0, 1, sat(y / (top * 0.6 + 1e-3)))) * (0.74 + 0.26 * Math.max(0, ny));

function finish(b, name, fact) {
  b.band = 0.06; // the flattened bottoms are the contact band (default would be 6% of the height)
  const t = b.build();
  t.label = name; t.fact = fact || null; t.support = true;
  return t;
}
function topOf(b, v0) { let top = 0; for (let i = v0; i < b.vc; i++) top = Math.max(top, b.P[i * 3 + 1]); return top; }

// ---------- boulders: rounded, angular, erratic, tafoni-pitted; any lithology ----------
// kind: 'round' | 'angular' | 'erratic' | 'tafoni' | 'block'
export function* boulder(seed, { litho = 'granite', kind = 'round', detail = 3, growth = 0.7, big = false } = {}) {
  const rng = mulberry32(seed * 7919 + 13), L = lithoOf(litho, rng), b = new Builder(), ox = rng() * 30;
  const sx = 0.75 + rng() * 0.6, sz = 0.65 + rng() * 0.55;
  const sy = kind === 'angular' ? 0.45 + rng() * 0.55 : kind === 'block' ? 0.55 + rng() * 0.45 : kind === 'erratic' ? 0.6 + rng() * 0.35 : 0.48 + rng() * 0.4;
  const amp = kind === 'angular' || kind === 'block' ? 0.1 + rng() * 0.1 : 0.18 + rng() * 0.16, f1 = 0.75 + rng() * 0.9;
  const skx = (rng() - 0.5) * 0.5, skz = (rng() - 0.5) * 0.5;
  const planes = [];
  const np = kind === 'angular' ? 5 + Math.floor(rng() * 5) : kind === 'block' ? 6 : rng() < 0.4 ? 1 : 0;
  for (let k = 0; k < np; k++) {
    let n;
    if (kind === 'block') { const a = (k % 4) * TAU / 4 + rng() * 0.3; n = k < 4 ? [Math.cos(a), (rng() - 0.5) * 0.2, Math.sin(a)] : [(rng() - 0.5) * 0.3, k === 4 ? 1 : -1, (rng() - 0.5) * 0.3]; }
    else { const a = rng() * TAU, e = (rng() - 0.5) * 1.5; n = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)]; }
    const l = Math.hypot(n[0], n[1], n[2]);
    planes.push([n[0] / l, n[1] / l, n[2] / l, (kind === 'block' ? 0.62 : 0.5) + rng() * 0.32]);
  }
  const pitT = kind === 'tafoni' ? 0.2 + rng() * 0.12 : rng() < 0.2 ? 0.42 : 9, exf = litho.indexOf('ranite') > 0 && kind === 'round' ? 0.035 : 0;
  const fl = -(0.2 + rng() * 0.16);
  const v0 = yield* blobG(b, detail, (x, y, z, o) => {
    let d = 1 + amp * fbm3(x * f1 + ox, y * f1, z * f1, 3, seed) + 0.06 * vn3(x * 4.6 + ox, y * 4.6, z * 4.6, seed + 3);
    if (kind === 'erratic') d -= amp * 0.6 * sstep(0.1, 0.8, y) * fbm3(x * f1 + ox, y * f1, z * f1, 2, seed); // ice-scoured top
    if (pitT < 1) d -= 0.13 * sstep(pitT, pitT + 0.12, vn3(x * 5.5 + ox, y * 5.5, z * 5.5, seed + 5));
    if (exf) d += exf * Math.abs(Math.sin((y + 0.3 * vn3(x, y, z, seed + 8)) * 9));
    let px = x * d, py = y * d, pz = z * d;
    for (const [nx, ny, nz, c] of planes) { const q = px * nx + py * ny + pz * nz; if (q > c) { px -= (q - c) * nx; py -= (q - c) * ny; pz -= (q - c) * nz; } }
    py *= sy;
    if (py < fl * sy) py = fl * sy + (py - fl * sy) * 0.1;
    o[0] = px * sx + skx * (py - fl * sy); o[1] = py - fl * sy; o[2] = pz * sz + skz * (py - fl * sy);
  });
  const top = topOf(b, v0), key = texKey(rng), tmp = [0, 0, 0];
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
    lithoCol(L, x, y, z, seed, tmp);
    const ao = aoOf(y, top, ny);
    o[0] = tmp[0] * ao; o[1] = tmp[1] * ao; o[2] = tmp[2] * ao;
    o[3] = growth * sstep(0.1, 0.7, ny); o[4] = key;
  });
  const nm = kind === 'erratic' ? 'Glacial erratic' : kind === 'tafoni' ? 'Honeycombed boulder' : kind === 'angular' && L.key === 'granite' ? 'Fractured granite' : L.name;
  const ft = kind === 'erratic' ? 'Ice carried this boulder here: glaciers and icebergs drop rocks far from where they formed.'
    : kind === 'tafoni' ? 'Salt crystals growing in the pores of the rock pried out these honeycomb hollows, grain by grain.' : L.fact;
  return finish(b, nm, ft);
}

// ---------- cracked slab: one slab split along 1-2 joints into pieces that settled differently ----------
export function* cracked(seed, { litho = 'sandstone', detail = 2, growth = 0.7 } = {}) {
  const rng = mulberry32(seed * 6151 + 7), L = lithoOf(litho, rng), b = new Builder(), ox = rng() * 30;
  const SX = 1.0 + rng() * 0.6, SZ = 0.75 + rng() * 0.55, SY = 0.16 + rng() * 0.16, p = 3 + rng() * 2;
  const nL = rng() < 0.55 ? 1 : 2, lines = [];
  for (let k = 0; k < nL; k++) {
    const a = (k ? lines[0].a + 0.9 + rng() * 1.3 : rng() * Math.PI);
    lines.push({ a, n: [Math.cos(a), Math.sin(a)], c: (rng() - 0.5) * 0.5 * Math.min(SX, SZ), g: 0.025 + rng() * 0.05 });
  }
  const key = texKey(rng), tmp = [0, 0, 0];
  for (let sig = 0; sig < (1 << nL); sig++) {
    // skip empty regions (no footprint sample on this side of every joint)
    let any = false;
    for (let q = 0; q < 24 && !any; q++) {
      const a = q / 24 * TAU, r = 0.15 + 0.8 * ((q * 7) % 5) / 5, x = Math.cos(a) * r * SX, z = Math.sin(a) * r * SZ;
      any = lines.every((l, k) => ((sig >> k) & 1 ? 1 : -1) * (x * l.n[0] + z * l.n[1] - l.c) > l.g);
    }
    if (!any) continue;
    const tilt = (rng() - 0.5) * 0.12, lift = 0.85 + rng() * 0.3, dir = rng() * TAU, push = 0.01 + rng() * 0.04;
    const v0 = yield* blobG(b, detail, (x, y, z, o) => {
      const k = Math.pow(Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p) + Math.pow(Math.abs(z), p), 1 / p);
      const d = 1 + 0.1 * fbm3(x * 1.6 + ox, y * 1.6, z * 1.6, 2, seed) + 0.03 * vn3(x * 5 + ox, y * 5, z * 5, seed + 2);
      let px = x / k * d * SX, py = y / k * d * SY, pz = z / k * d * SZ, cut = 0;
      for (let q = 0; q < lines.length; q++) {
        const l = lines[q], s = (sig >> q) & 1 ? 1 : -1, dd = s * (px * l.n[0] + pz * l.n[1] - l.c) - l.g / 2;
        if (dd < 0) { px -= s * dd * l.n[0]; pz -= s * dd * l.n[1]; cut = 1; }
      }
      // flat bottom, top surface tilted about the joint and lifted per piece (the bottom stays on y = 0)
      if (py < -SY * 0.55) py = -SY * 0.55 + (py + SY * 0.55) * 0.1;
      let y0 = py + SY * 0.55;
      const along = px * Math.cos(dir) + pz * Math.sin(dir);
      y0 *= lift; y0 += (y0 / (SY * 1.6)) * tilt * along;
      o[0] = px + Math.cos(dir) * push; o[1] = Math.max(0, y0); o[2] = pz + Math.sin(dir) * push;
      o[6] = cut;
    });
    const top = topOf(b, v0);
    yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
      lithoCol(L, x, y, z, seed, tmp);
      const ao = aoOf(y, top, ny) * (o[3] > 0.5 ? 0.62 : 1); // joint faces darker
      o[0] = tmp[0] * ao; o[1] = tmp[1] * ao; o[2] = tmp[2] * ao;
      o[3] = growth * sstep(0.2, 0.8, ny); o[4] = key;
    });
  }
  return finish(b, L.key === 'slate' ? 'Slate slab' : 'Cracked slab', 'Rock splits along joints, cracks opened by stress over thousands of years, and the pieces settle apart.');
}

// ---------- columnar basalt: a honeycomb of 5-7 sided columns with stepped, broken tops ----------
function prism(b, cx, cz, y0, y1, verts, bev, col, colTop, key, growth, lean, tilt) {
  const n = verts.length, top = y1 - bev, sh = (y) => [lean[0] * y, lean[1] * y];
  const ty = (x, z) => tilt[0] * (x - cx) + tilt[1] * (z - cz);
  for (let k = 0; k < n; k++) { // flat side faces, each split down the middle: lighter centre, darker worn edges
    const a = verts[k], c = verts[(k + 1) % n], m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const ex = c[0] - a[0], ez = c[1] - a[1], l = Math.hypot(ex, ez) || 1, nx = ez / l, nz = -ex / l;
    const s0 = sh(y0), s1 = sh(top), i = b.vc;
    for (const [p, e] of [[a, 0.74], [m, 1.04], [c, 0.74]]) {
      b.v(cx + p[0] + s0[0], y0, cz + p[1] + s0[1], nx, 0, nz, col[0] * 0.7 * e, col[1] * 0.7 * e, col[2] * 0.7 * e, growth * 0.15, key);
      b.v(cx + p[0] + s1[0], top + ty(cx + p[0], cz + p[1]), cz + p[1] + s1[1], nx, 0, nz, col[0] * e, col[1] * e, col[2] * e, growth * 0.2, key);
    }
    b.t(i, i + 3, i + 2); b.t(i, i + 1, i + 3); b.t(i + 2, i + 5, i + 4); b.t(i + 2, i + 3, i + 5);
  }
  // bevel ring + top cap (shared vertices, so the worn edge reads rounded)
  const s1 = sh(top), s2 = sh(y1), r0 = b.vc;
  for (let k = 0; k < n; k++) { const a = verts[k]; b.v(cx + a[0] + s1[0], top + ty(cx + a[0], cz + a[1]), cz + a[1] + s1[1], 0, 1, 0, col[0], col[1], col[2], growth * 0.4, key); }
  const r1 = b.vc;
  for (let k = 0; k < n; k++) { const a = verts[k]; b.v(cx + a[0] * 0.92 + s2[0], y1 + ty(cx + a[0], cz + a[1]), cz + a[1] * 0.92 + s2[1], 0, 1, 0, colTop[0], colTop[1], colTop[2], growth, key); }
  const ci = b.v(cx + s2[0], y1 + 0.01, cz + s2[1], 0, 1, 0, colTop[0], colTop[1], colTop[2], growth, key);
  const i0 = b.I.length;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    b.t(r0 + k, r1 + k, r0 + k1); b.t(r0 + k1, r1 + k, r1 + k1);
    b.t(r1 + k, ci, r1 + k1);
  }
  // normals of bevel + cap from their own triangles
  const N = b.N, P = b.P, I = b.I;
  for (let v = r0; v < b.vc; v++) { N[v * 3] = 0; N[v * 3 + 1] = 0; N[v * 3 + 2] = 0; }
  for (let q = i0; q < I.length; q += 3) {
    const A = I[q] * 3, B = I[q + 1] * 3, C = I[q + 2] * 3;
    const e1 = [P[B] - P[A], P[B + 1] - P[A + 1], P[B + 2] - P[A + 2]], e2 = [P[C] - P[A], P[C + 1] - P[A + 1], P[C + 2] - P[A + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const v of [A, B, C]) { N[v] += nx; N[v + 1] += ny; N[v + 2] += nz; }
  }
  for (let v = r0; v < b.vc; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
}
export function* columnar(seed, { big = false, growth = 0.6, litho = 'basalt' } = {}) {
  const rng = mulberry32(seed * 4241 + 3), L = lithoOf(litho, rng), b = new Builder();
  const Rf = big ? 1.5 + rng() * 1.1 : 0.75 + rng() * 0.6, rc = big ? 0.3 + rng() * 0.14 : 0.2 + rng() * 0.1;
  const H = big ? 1.6 + rng() * 2.2 : 0.55 + rng() * 0.9, sp = rc * Math.sqrt(3) * 1.004; // packed edge to edge
  const tiltP = [(rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5], lean = [(rng() - 0.5) * 0.2, (rng() - 0.5) * 0.2];
  const key = texKey(rng), base = mix3(L.base, L.alt, rng() * 0.4), ox = rng() * 20;
  const cols = [];
  const n = Math.ceil(Rf / sp) + 1;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const cx = (i + (j & 1) * 0.5) * sp, cz = j * sp * 0.866;
    const d = Math.hypot(cx, cz) / Rf + 0.25 * vn3(cx * 1.3 + ox, 0, cz * 1.3, seed);
    if (d > 1) continue;
    cols.push([cx + (rng() - 0.5) * rc * 0.04, cz + (rng() - 0.5) * rc * 0.04, d]);
  }
  for (let q = 0; q < cols.length; q++) {
    const [cx, cz, d] = cols[q];
    if (d > 0.7 && rng() < 0.18) continue; // gaps at the edge
    const ns = rng() < 0.75 ? 6 : rng() < 0.5 ? 5 : 7, a0 = Math.PI / 6 + (rng() - 0.5) * 0.15, verts = [];
    for (let k = 0; k < ns; k++) { const a = a0 + k * TAU / ns + (rng() - 0.5) * 0.08, r = rc * (0.96 + rng() * 0.05); verts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    let h = H * (1 - 0.45 * d * d) * (1 + tiltP[0] * cx / Rf + tiltP[1] * cz / Rf) * (0.88 + 0.24 * rng());
    if (rng() < 0.22) h *= 0.45 + rng() * 0.35; // broken short
    h = Math.max(rc * 0.8, h);
    const k = 1 + (rng() - 0.5) * 0.16, wz = sstep(0.2, 0.7, vn3(cx * 2 + ox, 1, cz * 2, seed + 4)) * L.stain;
    const col = [base[0] * k * L.k[0] * (1 + 0.12 * wz), base[1] * k * L.k[1], base[2] * k * L.k[2] * (1 - 0.18 * wz)];
    const colTop = [col[0] * 1.15, col[1] * 1.12, col[2] * 1.08];
    const tk = rng() < 0.2 ? 0.45 : 0.12, tl = [(rng() - 0.5) * tk, (rng() - 0.5) * tk], bev = Math.min(0.03, rc * 0.1); // some tops broken off at a slant
    if (h > rc * 5 && rng() < 0.7) { // cross joint: two stacked drums (the lower one's bevel reads as the joint)
      const hj = h * (0.35 + rng() * 0.3);
      prism(b, cx, cz, 0, hj, verts, bev * 0.6, col, colTop, key, growth, lean, [0, 0]);
      const sx = (rng() - 0.5) * 0.03, sz = (rng() - 0.5) * 0.03, v1 = verts.map((v) => [v[0] * 0.985, v[1] * 0.985]);
      prism(b, cx + sx, cz + sz, hj, h, v1, bev, col, colTop, key, growth, lean, tl);
    } else prism(b, cx, cz, 0, h, verts, bev, col, colTop, key, growth, lean, tl);
    if ((q & 7) === 7) yield;
  }
  return finish(b, 'Columnar basalt', 'As thick lava cools it shrinks and cracks into columns, most of them six-sided.');
}

// ---------- eroded pinnacle / hoodoo: notched by currents, undercut, capped ----------
export function* eroded(seed, { litho = 'sandstone', detail = 3, growth = 0.8, big = false } = {}) {
  const rng = mulberry32(seed * 3301 + 11), L = lithoOf(litho, rng), b = new Builder(), ox = rng() * 30;
  const hoodoo = rng() < 0.4, sy = big ? 1.9 + rng() * 1.5 : 1.2 + rng() * 0.9, sx = 0.65 + rng() * 0.4, sz = 0.6 + rng() * 0.4;
  const notches = [];
  for (let k = 0, nn = 1 + Math.floor(rng() * 3); k < nn; k++) notches.push([0.15 + rng() * 0.65, 0.12 + rng() * 0.24, 0.04 + rng() * 0.07]);
  if (hoodoo) notches.push([0.62 + rng() * 0.12, 0.3 + rng() * 0.15, 0.1 + rng() * 0.06]);
  const skx = (rng() - 0.5) * 0.35, skz = (rng() - 0.5) * 0.35, strata = 0.02 + rng() * 0.04, sf = 6 + rng() * 8, fl = -0.85;
  const v0 = yield* blobG(b, detail, (x, y, z, o) => {
    const t = sat((y + 1) / 2);
    let d = 1 + 0.2 * fbm3(x * 1.2 + ox, y * 1.2, z * 1.2, 3, seed) + 0.06 * vn3(x * 5 + ox, y * 5, z * 5, seed + 3);
    d -= 0.12 * sstep(0.45, 0.6, vn3(x * 5.5 + ox, y * 5.5, z * 5.5, seed + 6)); // tafoni pits
    let k = (1 - 0.5 * t) * (1 + strata * Math.sin(y * sf + vn3(x, y, z, seed + 9)));
    for (const [h, dep, w] of notches) k *= 1 - dep * Math.exp(-(((t - h) / w) ** 2));
    if (hoodoo) k *= 1 + 0.55 * sstep(0.74, 0.86, t); // resistant cap rock
    let px = x * d * k, py = y * d, pz = z * d * k;
    if (py < fl) py = fl + (py - fl) * 0.1;
    const yy = (py - fl) * sy;
    o[0] = px * sx + skx * yy * 0.4; o[1] = yy; o[2] = pz * sz + skz * yy * 0.4;
  });
  const top = topOf(b, v0), key = texKey(rng), tmp = [0, 0, 0];
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
    lithoCol(L, x, y, z, seed, tmp);
    const ao = aoOf(y, top, ny);
    o[0] = tmp[0] * ao; o[1] = tmp[1] * ao; o[2] = tmp[2] * ao;
    o[3] = growth * sstep(0.0, 0.7, ny); o[4] = key;
  });
  return finish(b, hoodoo ? 'Rock hoodoo' : 'Eroded pinnacle', hoodoo
    ? 'A harder cap rock shields the softer stone beneath it, which erodes into a narrow waist.'
    : 'Currents scour the softer layers faster, carving notches and overhangs into the stone.');
}

// ---------- pillow lava: glassy budding lobes, the upper ones resting on the lower ----------
const CRUST = [1.1, 0.95, 0.5];
export function* pillow(seed, { growth = 0.3, big = false, vent = false, fine = 0 } = {}) {
  const rng = mulberry32(seed * 2903 + 17), b = new Builder(), ox = rng() * 30;
  const rind = vent ? [0.38, 0.36, 0.37] : [0.46, 0.44, 0.46], palag = vent ? [0.95, 0.52, 0.24] : [1.0, 0.68, 0.42];
  const hue = [1 + (rng() - 0.5) * 0.1, 1 + (rng() - 0.5) * 0.08, 1 + (rng() - 0.5) * 0.1], key = texKey(rng);
  const S = big ? 1.6 : 1, n0 = (big ? 4 : 3) + Math.floor(rng() * 2), lows = [];
  const lobe = function* (cx, cy, cz, a, rl, rw, rh, flat, detail) {
    const ca = Math.cos(a), sa = Math.sin(a), s2 = (seed + lows.length * 13) | 0;
    const v0 = yield* blobG(b, detail, (x, y, z, o) => {
      const along = x, egg = 1 + 0.15 * along;
      // lumpy budding lobes, wrinkled crust (bread-crust ridges across the flow)
      let d = 1 + 0.14 * fbm3(x * 1.6 + ox, y * 1.6, z * 1.6, 3, s2) + 0.03 * Math.sin(along * 16 + vn3(x * 2, y * 2, z * 2, s2) * 3)
        - 0.05 * sstep(0.06, 0.0, Math.abs(vn3(x * 2.6 + ox, y * 2.6, z * 2.6, seed + 7)));
      let lx = x * rl * d * egg, ly = y * rh * d, lz = z * rw * d * (1 - 0.12 * Math.max(0, y));
      let wy = cy + ly;
      if (flat && wy < 0.02 * S) wy = 0.02 * S + (wy - 0.02 * S) * 0.08;
      o[0] = cx + ca * lx - sa * lz; o[1] = Math.max(0, wy); o[2] = cz + sa * lx + ca * lz;
    });
    return v0;
  };
  for (let k = 0; k < n0; k++) { // ground layer
    const a = k === 0 ? 0 : (k / (n0 - 1)) * TAU + rng() * 0.6, d = k === 0 ? 0 : (0.45 + rng() * 0.25) * S;
    const rl = (0.45 + rng() * 0.3) * S, rw = (0.3 + rng() * 0.14) * S, rh = (0.22 + rng() * 0.1) * S;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    lows.push([cx, rh * 0.8, cz, rw]);
    yield* lobe(cx, rh * 0.8, cz, rng() * TAU, rl, rw, rh, true, (k < 1 ? 4 : 3) + fine);
  }
  for (let k = 0, nu = Math.floor(rng() * (big ? 2.6 : 1.8)); k < nu; k++) { // upper pillows, embedded into the lower ones
    const l = lows[Math.floor(rng() * lows.length)];
    const rl = (0.35 + rng() * 0.2) * S, rw = (0.25 + rng() * 0.1) * S, rh = (0.22 + rng() * 0.08) * S;
    yield* lobe(l[0] + (rng() - 0.5) * 0.2 * S, l[1] * 1.55 + rh * 0.3, l[2] + (rng() - 0.5) * 0.2 * S, rng() * TAU, rl, rw, rh, false, 3 + fine);
  }
  let top = topOf(b, 0);
  yield* paintG(b, 0, (i, x, y, z, nx, ny, nz, o) => {
    const crev = 1 - sstep(0.02, 0.35, y / top) * sstep(-0.4, 0.3, ny + 0.2); // low, downward-facing seams
    const crack = sstep(0.06, 0.0, Math.abs(vn3(x * 2.6 + ox, y * 2.6, z * 2.6, seed + 7))); // chill cracks (match the grooves)
    const n = vn3(x * 2.5, y * 2.5, z * 2.5, seed + 3);
    const c = mixIn(set3(C3, rind), palag, sat(crev * 0.8 + sstep(0.4, 0.8, n) * 0.35));
    if (vent && vn3(x * 2, y * 2, z * 2, seed + 21) > 0.5) mixIn(c, CRUST, 0.5); // sulphur / iron crust
    const ao = aoOf(y, top, ny) * (1 - 0.45 * crack);
    o[0] = c[0] * hue[0] * ao; o[1] = c[1] * hue[1] * ao; o[2] = c[2] * hue[2] * ao;
    o[3] = growth * sstep(0.3, 0.9, ny); o[4] = key;
  });
  return finish(b, 'Pillow lava', 'Lava erupting underwater chills into a glassy skin, then buds out new pillows one after another.');
}

// ---------- conglomerate: rounded clasts of many rocks cemented in a sandy matrix ----------
const CLASTS = [[1.35, 1.3, 1.2], [0.45, 0.45, 0.48], [1.15, 0.62, 0.46], [0.82, 0.96, 0.82], [1.12, 0.96, 0.75], [0.7, 0.66, 0.62], [1.2, 1.1, 0.95]];
export function* conglomerate(seed, { detail = 5, growth = 0.45, big = false } = {}) {
  const rng = mulberry32(seed * 5009 + 29), b = new Builder(), ox = rng() * 30;
  const sx = 0.8 + rng() * 0.5, sz = 0.7 + rng() * 0.45, sy = 0.5 + rng() * 0.35, fl = -0.28;
  const K = (big ? 18 : 11) + Math.floor(rng() * 8), cl = [];
  for (let k = 0; k < K; k++) {
    const u = rng() * 2 - 1, a = rng() * TAU, r = Math.sqrt(1 - u * u);
    const c = CLASTS[Math.floor(rng() * CLASTS.length)], kk = 0.85 + rng() * 0.3;
    cl.push([r * Math.cos(a), u, r * Math.sin(a), Math.cos(0.14 + rng() * (big ? 0.16 : 0.24)), [c[0] * kk, c[1] * kk, c[2] * kk], 0.03 + rng() * 0.05]);
  }
  const matrix = [1.06 + rng() * 0.1, 0.94 + rng() * 0.08, 0.76 + rng() * 0.1], tag = new Int16Array(icosphere(detail).pos.length / 3);
  let vi = 0;
  const v0 = yield* blobG(b, detail, (x, y, z, o) => {
    let best = -2, bi = -1;
    for (let k = 0; k < K; k++) { const c = cl[k], dd = x * c[0] + y * c[1] + z * c[2]; if (dd > c[3] && dd > best) { best = dd; bi = k; } }
    let d = 1 + 0.16 * fbm3(x * 1.1 + ox, y * 1.1, z * 1.1, 3, seed) + 0.05 * vn3(x * 6 + ox, y * 6, z * 6, seed + 4);
    if (bi >= 0) { const c = cl[bi], t = sat((best - c[3]) / (1 - c[3]) * 3); d += c[5] * Math.sqrt(t); }
    tag[vi++] = bi;
    let py = y * d * sy;
    if (py < fl * sy) py = fl * sy + (py - fl * sy) * 0.1;
    o[0] = x * d * sx; o[1] = py - fl * sy; o[2] = z * d * sz;
  });
  const top = topOf(b, v0), key = texKey(rng);
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
    const t = tag[i - v0], ao = aoOf(y, top, ny), n = 0.85 + 0.3 * vn3(x * 4, y * 4, z * 4, seed + 2);
    const c = t >= 0 ? cl[t][4] : matrix;
    o[0] = c[0] * ao * n; o[1] = c[1] * ao * n; o[2] = c[2] * ao * n;
    o[3] = growth * sstep(0.1, 0.7, ny) * (t >= 0 ? 0.4 : 1); o[4] = key;
  });
  return finish(b, 'Conglomerate', 'Conglomerate is cemented gravel: each rounded pebble was tumbled smooth by an ancient river or surf.');
}

// ---------- boulder pile: a jumble of boulders, the small ones wedged on top ----------
export function* pile(seed, { lithos = ['granite'], growth = 0.8, big = false, fine = 0 } = {}) {
  const rng = mulberry32(seed * 1777 + 5), b = new Builder();
  const n = (big ? 4 : 3) + Math.floor(rng() * 3), R = big ? 1.1 : 0.62, mixed = rng() < 0.4;
  const L0 = lithoOf(lithos[Math.floor(rng() * lithos.length)], rng), placed = [];
  for (let k = 0; k < n; k++) {
    const r = k === 0 ? R : R * (0.35 + 0.55 * Math.pow(rng(), 1.3));
    let cx = 0, cz = 0, onTop = false;
    if (k > 0) {
      onTop = k >= n - 1 && rng() < 0.6 && n > 3;
      const p = placed[onTop ? 0 : Math.floor(rng() * placed.length)], a = rng() * TAU;
      const dist = onTop ? p[3] * 0.25 : p[3] * (0.75 + rng() * 0.3) + r * 0.55;
      cx = p[0] + Math.cos(a) * dist; cz = p[2] + Math.sin(a) * dist;
    }
    const L = mixed ? lithoOf(lithos[Math.floor(rng() * lithos.length)], rng) : { ...L0, k: [L0.k[0] * (0.95 + rng() * 0.1), L0.k[1] * (0.95 + rng() * 0.1), L0.k[2] * (0.95 + rng() * 0.1)] };
    const sy = 0.6 + rng() * 0.3, ox = rng() * 30, s2 = (seed + k * 101) | 0, amp = 0.16 + rng() * 0.14;
    // centre height: ground boulders sit flattened on y = 0; the top one wedges into the biggest
    const cy = onTop ? placed[0][1] + placed[0][4] * 0.75 : r * sy * 0.78;
    const v0 = yield* blobG(b, (k === 0 && big ? 3 : 2) + fine, (x, y, z, o) => {
      const d = 1 + amp * fbm3(x * 1.1 + ox, y * 1.1, z * 1.1, 3, s2) + 0.05 * vn3(x * 4.5 + ox, y * 4.5, z * 4.5, s2 + 3);
      let py = cy + y * d * r * sy;
      if (!onTop && py < 0.03) py = 0.03 + (py - 0.03) * 0.08;
      o[0] = cx + x * d * r * (0.9 + 0.2 * (k & 1)); o[1] = Math.max(0, py); o[2] = cz + z * d * r;
    });
    placed.push([cx, cy, cz, r, r * sy]);
    const key = texKey(rng), tmp = [0, 0, 0], top = cy + r * sy;
    yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
      lithoCol(L, x, y, z, s2, tmp);
      const ao = (0.45 + 0.55 * sstep(0, 1, sat(y / (top * 0.7)))) * (0.74 + 0.26 * Math.max(0, ny));
      o[0] = tmp[0] * ao; o[1] = tmp[1] * ao; o[2] = tmp[2] * ao;
      o[3] = growth * sstep(0.1, 0.7, ny); o[4] = key;
    });
  }
  return finish(b, 'Boulder pile', 'Boulders tumble from cliffs and pile up at their foot, a jumble geologists call talus.');
}

// ---------- recipe dispatch: { r: recipe name, ...opts } -> iterator ----------
export const RECIPES = { boulder, cracked, columnar, eroded, pillow, conglomerate, pile };
export function rockJob(spec, seed) {
  const f = RECIPES[spec.r];
  return f(seed, spec);
}
// one more subdivision level on high / ultra GPUs
const DEF_DETAIL = { boulder: 3, cracked: 2, eroded: 3, conglomerate: 5 };
export function tiered(spec, tier) {
  if (tier !== 'high' && tier !== 'ultra') return spec;
  const d = spec.detail ?? DEF_DETAIL[spec.r];
  return d === undefined ? { ...spec, fine: 1 } : { ...spec, detail: d + 1, fine: 1 };
}
