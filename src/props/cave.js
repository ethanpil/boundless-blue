// Cenote caves: speleothems hanging from / rising to the rock, columns where floor and ceiling meet,
// breakdown boulders, drowned trees beneath the sky openings, and soft animated light shafts.
import * as THREE from 'three';
import { Builder, Batch, T, TAU, sat, sstep, lerp, vn3, floorSampler, presence, tubeClear, pointsClear, placedPoints, orient, rotY, rotZ, mul3, budgetK, bendSpots, TUBE, vary, tierK, poi, ceilSampler } from './core.js';
import { branchesInto, stoneInto } from './shapes.js';
import { putFloor, putAt, pickW, tintFrom, spot, bendX, microDetail, clusterer, groundY, hangAt, microSteps, steps } from './scatter.js';
import { MAT } from './materials.js';
import { mulberry32 } from '../noise.js';

const LIME = [0.56, 0.52, 0.43];
// speleothem calcite: cream, ochre and wet tan, with darker iron-stained growth bands; stone texture keys
// (static mode 6.x) with almost no encrusting growth (they grew in air, then drowned in the dark)
const SPELEO = [[0.8, 0.74, 0.6], [0.74, 0.62, 0.45], [0.66, 0.57, 0.45], [0.84, 0.72, 0.54]], STAIN = [0.62, 0.45, 0.28];
const stoneKey = (seed) => 6.05 + mulberry32(seed * 131 + 17)() * 0.9;
function speleoPaint(seed, v, band, ao, o) {
  const c = SPELEO[seed % SPELEO.length], st = 0.35 * Math.max(0, Math.sin(v * 23 + seed * 1.7)) ** 3;
  o[3] = lerp(c[0], STAIN[0], st) * band * ao; o[4] = lerp(c[1], STAIN[1], st) * band * ao; o[5] = lerp(c[2], STAIN[2], st) * band * ao;
}

function stalactite(seed, parts) {
  const b = new Builder(), key = stoneKey(seed);
  for (const [L, ox, oz, rr] of parts) {
    const v0 = b.vc;
    b.lathe(9, 7, (v) => [rr * (0.26 * Math.pow(1 - v, 1.25) + 0.004 + 0.012 * Math.sin(v * 31 + seed) * (1 - v)), -v * L],
      (a, v) => 1 + 0.18 * vn3(Math.cos(a) * 1.5, v * 4, Math.sin(a) * 1.5, seed),
      (v, a, x, y, z, o) => { speleoPaint(seed, v, 0.85 + 0.2 * Math.sin(v * 40 + seed), 0.55 + 0.45 * v, o); o[6] = 0.02; o[7] = key; },
      { flip: true });
    b.xform(v0, [1, 0, 0, 0, 1, 0, 0, 0, 1], ox, 0.02, oz);
  }
  return b.build();
}

function stalagmite(seed) {
  const b = new Builder(), key = stoneKey(seed + 40);
  b.lathe(10, 8, (v) => [0.3 * Math.pow(1 - Math.pow(v, 1.8), 0.7) + 0.02 + 0.03 * Math.sin(v * 17 + seed) * (1 - v), v],
    (a, v) => 1 + 0.15 * vn3(Math.cos(a) * 1.5, v * 3, Math.sin(a) * 1.5, seed + 3),
    (v, a, x, y, z, o) => { speleoPaint(seed + 1, v, 0.85 + 0.18 * Math.sin(v * 30 + seed), 0.5 + 0.5 * v, o); o[6] = 0.03; o[7] = key; });
  return b.build();
}

function column(seed) {
  const b = new Builder(), key = stoneKey(seed + 80);
  b.lathe(14, 12, (v) => [0.5 * (0.3 + 0.7 * Math.pow(Math.abs(2 * v - 1), 1.7)) + 0.04 * Math.sin(v * 23 + seed), v],
    (a, v) => 1 + 0.1 * Math.abs(Math.sin(a * 5 + v * 7)) + 0.12 * vn3(Math.cos(a) * 1.5, v * 5, Math.sin(a) * 1.5, seed),
    (v, a, x, y, z, o) => { speleoPaint(seed + 2, v, 0.82 + 0.2 * Math.sin(v * 50 + a), 1, o); o[6] = 0.02; o[7] = key; });
  return b.build();
}

// low draped flowstone mound with rimstone ripples
function flowstone(seed) {
  const b = new Builder(), rng = mulberry32(seed * 3), R = 0.8 + rng() * 0.8, H = 0.4 + rng() * 0.6, rip = 14 + rng() * 14, key = stoneKey(seed + 120);
  b.lathe(16, 8, (v) => [R * Math.pow(1 - v, 0.6) * (1 + 0.05 * Math.sin(v * rip)) + 0.02, H * Math.sin(v * Math.PI * 0.5)], (a, v) => 1 + 0.18 * vn3(Math.cos(a) * 1.5, v * 3, Math.sin(a) * 1.5, seed),
    (v, a, x, y, z, o) => { speleoPaint(seed + 3, v, 0.8 + 0.25 * Math.sin(v * rip * 2 + a), 1, o); o[6] = 0.03; o[7] = key; });
  const t = b.build(); t.label = 'Flowstone'; return t;
}

function deadTree(seed) {
  const b = new Builder(), rng = mulberry32(seed * 7 + 3);
  const paint = (level, v, x, y, z, o) => { const c = 0.7 + 0.3 * vn3(x * 2, y * 2, z * 2, seed); o[3] = 0.28 * c; o[4] = 0.22 * c; o[5] = 0.16 * c; o[6] = 0.35; o[7] = 0; };
  branchesInto(b, rng, {
    depth: 2 + Math.floor(rng() * 2), len: 1.6 + rng() * 2, rad: 0.14 + rng() * 0.14, radial: 6, segs: 3, kids: [1, 2 + Math.floor(rng() * 2)], spread: 0.4 + rng() * 0.5, up: rng() * 0.12, wiggle: 0.15 + rng() * 0.35,
    lenK: 0.5 + rng() * 0.25, radK: 0.6, tipK: 0.4, childAt: [0.35 + rng() * 0.3, 1], continueTrunk: false, paint,
  });
  for (let k = 0, nr = 2 + Math.floor(rng() * 6); k < nr; k++) { // root plate
    const a = (k / 5) * TAU + rng();
    branchesInto(b, rng, {
      depth: 1, len: 0.9, rad: 0.11, radial: 5, segs: 2, kids: [1, 2], spread: 0.6, up: -0.15, wiggle: 0.3,
      lenK: 0.6, radK: 0.6, tipK: 0.3, childAt: [0.6, 1], paint,
    }, [0, 0.1, 0], [Math.cos(a), -0.35, Math.sin(a)]);
  }
  return b.build();
}

// a drowned tree toppled onto its side, built that way: its template base is what it lies on, and it
// remembers its trunk line (to rest on the floor) and its root plate (to avoid hanging it over a drop)
function lyingTree(t, a) {
  const b = new Builder(), R = rotZ(a);
  b.P = Array.from(t.pos); b.N = Array.from(t.nor); b.C = Array.from(t.col); b.F = Array.from(t.fx); b.I = Array.from(t.idx);
  b.xform(0, R, 0, 0, 0);
  let mn = 1e9; for (let i = 1; i < b.P.length; i += 3) mn = Math.min(mn, b.P[i]);
  for (let i = 1; i < b.P.length; i += 3) b.P[i] -= mn;
  const L = b.build();
  L.label = t.label; L.fact = t.fact;
  const len = t.maxY * 0.45;
  L.trunk = [0, -mn, 0, R[1] * len, R[4] * len, R[7] * len]; // base point, then the trunk vector
  const F = t.foot, roots = [];
  for (let i = 0; i < F.length; i += 3) roots.push(R[0] * F[i] + R[1] * F[i + 1] + R[2] * F[i + 2], R[3] * F[i] + R[4] * F[i + 1] + R[5] * F[i + 2] - mn, R[6] * F[i] + R[7] * F[i + 1] + R[8] * F[i + 2]);
  L.roots = Float32Array.from(roots);
  return L;
}

export function initCave() {
  T.stalactite = [
    stalactite(1, [[1, 0, 0, 1]]), stalactite(2, [[1, 0, 0, 1], [0.55, 0.12, 0.05, 0.7], [0.35, -0.08, 0.1, 0.6]]),
    stalactite(3, [[1, 0, 0, 1.2], [0.7, -0.15, -0.05, 0.8]]),
  ];
  T.stalactite = vary([...T.stalactite, stalactite(4, [[1, 0, 0, 0.8], [0.8, 0.1, 0, 0.7], [0.6, 0.2, 0.02, 0.6], [0.4, 0.3, 0.03, 0.5]]), stalactite(5, [[1, 0, 0, 1.5]])], 3, 7, { disp: 0.12, bend: 0.08, twist: 0.5 });
  T.stalagmite = vary([1, 2, 3, 4, 5].map(stalagmite), 3, 17, { disp: 0.15, bend: 0.1, twist: 0.5 });
  T.flowstone = vary([1, 2, 3].map(flowstone), 3, 27, { disp: 0.1, twist: 0.6 });
  T.caveColumn = vary([1, 2, 3].map(column), 2, 37, { disp: 0.1, bend: 0.06, twist: 0.6 });
  T.deadTree = vary([1, 2, 3, 4, 5, 6].map(deadTree), 2, 47, { disp: 0.05, bend: 0.15, twist: 0.4 });
  T.deadTreeLying = T.deadTree.flatMap((t, i) => [lyingTree(t, 1.3 + (i % 3) * 0.05), lyingTree(t, 1.48 - (i % 2) * 0.04)]);
  const b = new Builder(); stoneInto(b, { sx: 1.6, sy: 0.9, sz: 1.2, p: 4, rough: 0.12, seed: 5, detail: 2, col: LIME, growth: 0.05, mode: stoneKey(5) });
  b.xform(0, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0, 0.4, 0); T.caveBlock = [b.build()];
  T.caveBlock[0].label = 'Breakdown block';
}

const S = {};
function specs() {
  if (S.rock) return S;
  Object.assign(S, {
    // live reference: rock_gen.js refreshes T.rocks per segment; blocks are a separate, rarer entry
    // little encrusting growth in the dark: bare breakdown limestone with a film of silt
    rock: { tpl: T.rocks, scale: [0.5, 2.2], ys: [0.7, 1.35], xz: 0.5, grow: [0, 0.18], follow: 0.6, tint: tintFrom([[0.62, 0.58, 0.5], [0.5, 0.48, 0.44]]) },
    block: { tpl: T.caveBlock, scale: [0.5, 2.2], ys: [0.7, 1.35], xz: 0.5, grow: [0, 0.18], follow: 0.6, tint: tintFrom([[0.62, 0.58, 0.5], [0.5, 0.48, 0.44]]) },
    pebbles: { tpl: T.pebbles, scale: [0.8, 1.7], follow: 1, sink: 0.02, tint: tintFrom([[0.85, 0.8, 0.7], [0.75, 0.72, 0.66]], 0.08) },
    grit: { tpl: T.rubble, scale: [0.8, 1.5], follow: 1, sink: 0.02, tint: tintFrom([[0.8, 0.77, 0.7]], 0.08) },
    flow: { tpl: T.flowstone, scale: [0.7, 1.6], follow: 0.7, sink: 0.1, tint: tintFrom([[1, 1, 1], [1.05, 0.95, 0.85]], 0.12) },
    flowCream: { tpl: T.flowstone, scale: [0.9, 2.0], follow: 0.7, sink: 0.1, tint: tintFrom([[1.25, 1.18, 1.0], [1.2, 1.05, 0.85], [1.15, 0.95, 0.8]], 0.1) },
    mite: { tpl: T.stalagmite, scale: [0.6, 2.6], ys: [0.6, 1.4], follow: 0.15, tint: tintFrom([[1, 1, 1]]) },
  });
  S.micro = [{ w: 2, spec: S.pebbles }, { w: 1.4, spec: S.grit }];
  return S;
}

// ---------- light shafts ----------
// skylight cells: every third / second node of the ceiling lattice (~4.5 x 3 m) within ~26 m of the path
function findOpenings(ctx, cs) {
  const di = 3, dj = 2, cell = Math.sqrt(1.5 * di * dj * 64 / 42), rows = Math.ceil(42 / dj) + 1, cols = Math.round(52 / (1.5 * di)), surf = ctx.surfaceY;
  const open = new Uint8Array(cols * rows), xs = new Float32Array(cols * rows), ss = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const jj = Math.min(42, j * dj), s = ctx.s0 + jj * 64 / 42, i0 = Math.round((ctx.pathX(s) - 26) / 1.5) - cs.k0;
    for (let i = 0; i < cols; i++) {
      const ii = i0 + i * di, o = j * cols + i;
      xs[o] = (cs.k0 + ii) * 1.5; ss[o] = s;
      open[o] = cs.node(ii, jj) > surf + 0.3 ? 1 : 0;
    }
  }
  const seen = new Uint8Array(cols * rows), clusters = [];
  for (let o = 0; o < open.length; o++) {
    if (!open[o] || seen[o]) continue;
    const stack = [o], cells = []; seen[o] = 1;
    while (stack.length) {
      const q = stack.pop(); cells.push(q);
      const i = q % cols, j = (q / cols) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
        const n = jj * cols + ii;
        if (open[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    let cx = 0, cs = 0;
    for (const q of cells) { cx += xs[q]; cs += ss[q]; }
    clusters.push({ x: cx / cells.length, s: cs / cells.length, r: Math.sqrt(cells.length * cell * cell / Math.PI), cells: cells.map((q) => [xs[q], ss[q]]) });
  }
  return clusters;
}

function shaftMesh(ctx, fs, rng, clusters, sunDir) {
  let d = [-sunDir.x * 0.55, -sunDir.y, -sunDir.z * 0.55];
  const l = Math.hypot(...d); d = d.map((v) => v / l);
  const beams = [];
  for (const c of clusters) {
    const n = Math.min(7, 2 + Math.round(c.r * 0.8));
    for (let k = 0; k < n; k++) {
      const [x, s] = c.cells[(rng() * c.cells.length) | 0];
      const top = [x + (rng() - 0.5) * 1.5, ctx.surfaceY - 0.05, -(s - ctx.s0) + (rng() - 0.5) * 1.5];
      const fy = fs.at(x, s);
      const L = (top[1] - fy) / -d[1] + 1;
      const r0 = 0.3 + rng() * Math.min(1.4, c.r * 0.35);
      beams.push({ top, L, r0, r1: r0 * 1.35 + L * 0.03, ph: rng() });
    }
  }
  if (!beams.length) return null;
  const NR = 14, NL = 3, vpb = NR * (NL + 1);
  const pos = new Float32Array(beams.length * vpb * 3), nor = new Float32Array(beams.length * vpb * 3), fx = new Float32Array(beams.length * vpb * 2);
  const idx = new Uint16Array(beams.length * NR * NL * 6);
  // frame perpendicular to d
  let a = [d[2], 0, -d[0]]; const al = Math.hypot(...a) || 1; a = a.map((v) => v / al);
  const bb = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  let vi = 0, ii = 0;
  for (const B of beams) {
    const base = vi;
    for (let j = 0; j <= NL; j++) {
      const t = j / NL, r = lerp(B.r0, B.r1, t);
      const c = [B.top[0] + d[0] * B.L * t, B.top[1] + d[1] * B.L * t, B.top[2] + d[2] * B.L * t];
      for (let i = 0; i < NR; i++, vi++) {
        const ang = (i / NR) * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
        const n = [a[0] * ca + bb[0] * sa, a[1] * ca + bb[1] * sa, a[2] * ca + bb[2] * sa];
        pos.set([c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r], vi * 3);
        nor.set(n, vi * 3);
        fx[vi * 2] = t; fx[vi * 2 + 1] = B.ph;
      }
    }
    for (let j = 0; j < NL; j++) for (let i = 0; i < NR; i++) {
      const p = base + j * NR + i, q = base + j * NR + ((i + 1) % NR), r = p + NR, s = q + NR;
      idx.set([p, q, r, q, s, r], ii); ii += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aFx', new THREE.BufferAttribute(fx, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, MAT.shaft);
  m.matrixAutoUpdate = false;
  m.renderOrder = 3;
  return m;
}

// ---------- per-segment communities ----------
const COMMUNITIES = [
  { name: 'stalactite forest', tites: 1.8, mites: 1.6, cols: 1.6, flow: 0.7, trees: 0.6 },
  { name: 'flowstone gallery', tites: 0.7, mites: 0.8, cols: 1.0, flow: 2.6, trees: 0.6, cream: 1 },
  { name: 'tree-filled cenote', tites: 0.8, mites: 0.8, cols: 0.8, flow: 0.8, trees: 3.2, logs: 1 },
  { name: 'mixed cavern', tites: 1.0, mites: 1.0, cols: 1.0, flow: 1.0, trees: 1.0 },
];
function community(ctx) {
  const seg = ctx.segments.find((g) => g.key === 'cave');
  return seg ? COMMUNITIES[Math.floor(mulberry32(seg.seed ^ 0xca7e)() * COMMUNITIES.length)] : COMMUNITIES[3];
}

// floor-to-ceiling column: foot seated on the floor, head pushed into the ceiling
function placeColumn(ctx, fs, cs, st, rng, x, s, sx) {
  const tpl = rng.pick(T.caveColumn), R = rotY(rng() * TAU), H = tpl.head;
  const y = groundY(fs, x, s, tpl, R, sx, 1, sx) - 0.06;
  let top = -1e9;
  for (let i = 0; i < H.length; i += 3) top = Math.max(top, cs.at(x + R[0] * H[i] * sx + R[2] * H[i + 2] * sx, s - (R[6] * H[i] * sx + R[8] * H[i + 2] * sx)));
  const sy = (top - y) / (tpl.maxY - tpl.band) + 0.08;
  if (!st.add(tpl, x, y, -(s - ctx.s0), R, sx, sy, sx, 0.9 + rng() * 0.15, 0.88 + rng() * 0.15, 0.85 + rng() * 0.15, 1)) return null;
  const it = st.last;
  it.g = 1; it.hang = 1;
  return it;
}

export function makeCaveLayout(env) {
  return function layoutCave(ctx) {
    if (presence(ctx, 'cave') <= 0) return null;
    const sp = specs(), rng = ctx.rng, fs = floorSampler(ctx), cs = ceilSampler(ctx), comm = community(ctx), tk = tierK(ctx), bk = budgetK(ctx, 'cave');
    const st = new Batch(MAT.static, 34000 * bk);                          // columns, trees, big breakdown
    const mid = new Batch(MAT.static, 60000 * bk * tk, 'mid');             // stalactites, stalagmites, flowstone
    const near = new Batch(MAT.static, 16000 * bk * tk, 'near');           // floor micro detail
    const extra = [], more = [];
    // drowned trees and branches beneath the openings (a tree-filled cenote also has them further in):
    // spots drawn now, one tree per continuation step
    const lying = (x, s, sc) => () => {
      const tpl = rng.pick(T.deadTreeLying), R = rotY(rng() * TAU), tr = tpl.trunk;
      // lowest branches settle into the sediment; the trunk rests on the floor, half sunk
      let y = groundY(fs, x, s, tpl, R, sc, sc, sc) - 0.12 * sc;
      for (let k = 0; k <= 6; k++) {
        const u = k / 6, px = (tr[0] + tr[3] * u) * sc, py = (tr[1] + tr[4] * u) * sc, pz = (tr[2] + tr[5] * u) * sc;
        y = Math.min(y, fs.h(x + R[0] * px + R[2] * pz, s - (R[6] * px + R[8] * pz)) + 0.06 * sc - py);
      }
      // a root plate jutting a metre out over a drop reads as floating: try elsewhere
      const F = tpl.roots;
      for (let i = 0; i < F.length; i += 3) {
        const px = F[i] * sc, py = F[i + 1] * sc, pz = F[i + 2] * sc;
        if (py + y - fs.h(x + R[0] * px + R[2] * pz, s - (R[6] * px + R[8] * pz)) > 1.0) return;
      }
      if (!pointsClear(ctx, placedPoints(tpl, x, y, s, R, sc, sc, sc, 300), 0.3)) return;
      if (st.add(tpl, x, y, -(s - ctx.s0), R, sc, sc, sc, 0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 0.9 + rng() * 0.2, 1)) st.last.g = 1;
    };
    // first step: find the skylights (light shafts, POIs) and queue a tree step per drowned tree
    const sky = {};
    more.push(() => { sky.clusters = findOpenings(ctx, cs); });
    more.push(() => {
      const clusters = sky.clusters, trees = [];
      const sm = shaftMesh(ctx, fs, rng, clusters, env.U.uSunDir.value);
      if (sm) extra.push(sm);
      for (const c of clusters) {
        const yc = fs.at(c.x, c.s);
        if (c.r >= 2.5) poi(ctx, 'cave-opening', c.x, lerp(yc, ctx.surfaceY, 0.45), c.s, c.r, { r: c.r }); // real skylights only
        const n = Math.min(3, 1 + Math.floor(c.r / 4)) * comm.trees;
        for (let k = 0; k < n; k++) {
          if (rng() > ctx.weightOf(c.s, 'cave')) continue;
          const [x0, s0] = c.cells[(rng() * c.cells.length) | 0];
          const x = x0 + (rng() - 0.5) * 4, s = s0 + (rng() - 0.5) * 4;
          if (s < ctx.s0 || s >= ctx.s1) continue;
          trees.push(lying(x, s, 0.6 + rng() * 0.6));
        }
      }
      if (comm.logs) for (let k = 0; k < 5; k++) { const p = spot(ctx, rng, 4.5, 22, 0.9); if (rng() < ctx.weightOf(p.s, 'cave')) trees.push(lying(p.x, p.s, 0.5 + rng() * 0.5)); }
      more.unshift(...trees);
    });
    // stalactites hang from the real ceiling (not in openings), head band pushed into the rock
    const nextP205 = clusterer(ctx, rng, 3.5, 24, 0.9);
    more.push(...steps(Math.round(280 * comm.tites * tk), 10, () => {
      const p = nextP205();
      if (!p || rng() > ctx.weightOf(p.s, 'cave')) return;
      const c = cs.at(p.x, p.s);
      if (c > ctx.surfaceY - 0.4) return;
      const f = fs.at(p.x, p.s), gap = c - f;
      if (gap < 1.2) return;
      const L = Math.min(gap * 0.5, 0.4 + Math.pow(rng(), 1.4) * 4.5), sx = 0.7 + L * 0.4, tpl = rng.pick(T.stalactite);
      if (!tubeClear(ctx, p.x, p.s, c - L, c, 0.2 * sx)) return;
      hangAt(ctx, mid, tpl, p.x, p.s, rotY(rng() * TAU), sx, L, sx, [0.9 + rng() * 0.2, 0.88 + rng() * 0.2, 0.85 + rng() * 0.2], 1, 0.1);
    }));
    // columns where the gap is small, away from the path
    more.push(...steps(Math.round(40 * comm.cols), 10, () => {
      const p = spot(ctx, rng, 6, 24, 0.8);
      if (rng() > ctx.weightOf(p.s, 'cave')) return;
      const c = cs.at(p.x, p.s);
      if (c > ctx.surfaceY - 0.4) return;
      const f = fs.at(p.x, p.s), gap = c - f;
      if (gap < 1.5 || gap > 10) return;
      const sx = 0.7 + rng() * 1.2;
      if (!tubeClear(ctx, p.x, p.s, f, c, 0.55 * sx)) return;
      placeColumn(ctx, fs, cs, st, rng, p.x, p.s, sx);
    }));
    // columns on the outside of bends: the camera swings around them (one step each)
    for (const b of bendSpots(ctx)) more.push(() => {
      if (rng() > ctx.weightOf(b.s, 'cave') * 0.85) return;
      const sx = 0.9 + rng() * 0.9, x = bendX(ctx, b, 0.62 * sx, rng, 1.0);
      const c = cs.at(x, b.s), f = fs.at(x, b.s), gap = c - f;
      if (c > ctx.surfaceY - 0.4 || gap < 1.5 || gap > 14) return;
      if (!tubeClear(ctx, x, b.s, f, c, 0.62 * sx)) return;
      placeColumn(ctx, fs, cs, st, rng, x, b.s, sx);
    });
    more.push(...microSteps(ctx, fs, near, rng, 'cave', sp.micro, 110, 20, 28));
    // stalagmites, flowstone and breakdown boulders on the floor (low ones also under the path)
    const nextP239 = clusterer(ctx, rng, 0, 24, 1);
    more.push(...steps(Math.round(170 * tk), 10, () => {
      const p = nextP239();
      if (!p || rng() > ctx.weightOf(p.s, 'cave')) return;
      const roof = cs.at(p.x, p.s) < ctx.surfaceY - 0.4;
      const wM = roof ? 0.5 * comm.mites : 0, wF = (roof ? 0.18 : 0.3) * comm.flow, r = rng() * (wM + wF + 0.32);
      const spec = r < wM ? sp.mite : r < wM + wF ? (comm.cream ? sp.flowCream : sp.flow) : (rng() < 0.25 ? sp.block : sp.rock);
      putFloor(ctx, fs, mid, spec, p.x, p.s, rng);
    }));
    return { batches: [st, mid, near], extra, more };
  };
}
