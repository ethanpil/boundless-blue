// Polar sea ice: keels of broken ice slabs and icebergs hanging from the ice ceiling, brinicles, sparse benthos
// on the far floor. Ice uses the static material's translucent ice mode (5).
import { Builder, Batch, T, TAU, sat, sstep, vn3, fbm3, floorSampler, presence, tubeClear, pointsClear, placedPoints, rotY, rotX, rotZ, mul3, budgetK, bendSpots, vary, tierK, poi, ceilSampler } from './core.js';
import { putFloor, pickW, tintFrom, spot, bendX, clusterer, ceilY, hangAt, steps } from './scatter.js';
import { MAT } from './materials.js';
import { mulberry32 } from '../noise.js';

const ICE = [0.72, 0.84, 0.92];

// one broken ice slab: a jittered icosahedron, flat-shaded (every face has its own vertices and normal),
// so it reads as a crisp angular block, not a rounded lump. Centre c, half-extents ex/ey/ez, rotation R.
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2, V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { V: V.map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); }), F };
})();
function shard(b, rng, c, ex, ey, ez, R, col, glow) {
  // squash toward a slab (sea ice is 0.3-2 m thick), jitter every corner, then cut flat faces
  const P = ICO.V.map(([x, y, z]) => {
    const j = 0.72 + 0.5 * rng(), q = [Math.sign(x) * Math.pow(Math.abs(x), 0.6) * ex * j, Math.sign(y) * Math.pow(Math.abs(y), 0.6) * ey * (0.8 + 0.4 * rng()), Math.sign(z) * Math.pow(Math.abs(z), 0.6) * ez * j];
    return [c[0] + R[0] * q[0] + R[1] * q[1] + R[2] * q[2], c[1] + R[3] * q[0] + R[4] * q[1] + R[5] * q[2], c[2] + R[6] * q[0] + R[7] * q[1] + R[8] * q[2]];
  });
  for (const [i, j, k] of ICO.F) {
    const A = P[i], B = P[j], C = P[k];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const f = 0.88 + 0.24 * rng(), v0 = b.vc;
    for (const Q of [A, B, C]) b.v(Q[0], Q[1], Q[2], nx, ny, nz, col[0] * f, col[1] * f, col[2] * f, glow, 5);
    b.t(v0, v0 + 1, v0 + 2);
  }
}
// pressure-ridge keel: a jumble of broken, tilted slabs hanging under the ice; top at y = 0, spans x in
// [-L/2, L/2]. A root layer of flat slabs runs the whole length (it is frozen into the ceiling); below it
// the rubble hangs to an irregular profile with several sub-peaks and gaps, not a regular saw-tooth.
// opts.big: consolidated (older) keel, fewer and larger fused blocks around a sculpted core.
function blockKeel(seed, L = 10, D = 5, { n = 44, size = [0.5, 2.2], big = false } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 7 + 1), W = 2.5 + rng() * 2.5;
  const ph = [rng() * 10, rng() * 10, rng() * 10], pk = 0.5 + rng() * 0.4;
  const prof = (x) => { // 0..1 depth envelope: a main peak off-centre plus random sub-peaks
    const u = x / L + 0.5, e = Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), 1.6));
    return e * sat(0.55 + 0.3 * Math.sin(u * 7.3 + ph[0]) + 0.25 * Math.sin(u * 13.1 + ph[1]) + 0.35 * Math.exp(-((u - pk) ** 2) / 0.03));
  };
  const tint = () => { // clear blue, milky white, or with a brown film of ice algae
    const r = rng(), k = 0.85 + rng() * 0.25;
    return r < 0.55 ? [ICE[0] * k, ICE[1] * k, ICE[2] * k] : r < 0.85 ? [0.86 * k, 0.9 * k, 0.94 * k] : [0.62 * k, 0.6 * k, 0.48 * k];
  };
  if (big) { // sculpted core
    b.blob(2, (x, y, z, o) => {
      const d = 1 + 0.3 * fbm3(x * 1.3 + seed, y * 1.3, z * 1.3, 2, seed);
      o[0] = x * d * L * 0.3; o[1] = Math.min(0, y * d) * D * 0.7 - 0.2; o[2] = z * d * W * 0.3;
      const c = 0.85 + 0.2 * vn3(x * 3, y * 3, z * 3, seed); o[3] = ICE[0] * c; o[4] = ICE[1] * c; o[5] = ICE[2] * c; o[6] = 0.75; o[7] = 5;
    });
  }
  // root layer: flat slabs frozen into the ice sheet along the whole ridge
  for (let x = -L / 2 + 0.6; x < L / 2; x += 1.2 + rng() * 1.6) {
    const ex = 0.8 + rng() * 1.2, ez = 0.8 + rng() * 1.4, ey = 0.25 + rng() * 0.3;
    shard(b, rng, [x, -ey * 0.6, (rng() - 0.5) * W * 0.6], ex, ey, ez, mul3(rotY(rng() * TAU), rotX((rng() - 0.5) * 0.4)), tint(), 0.6 + 0.4 * rng());
  }
  for (let k = 0; k < n; k++) {
    const x = (rng() - 0.5) * L, e = prof(x);
    const sz = size[0] + (size[1] - size[0]) * Math.pow(rng(), 1.6);
    const y = -Math.pow(rng(), 0.7) * D * e - sz * 0.2;
    const ex = sz * (0.6 + rng() * 0.5), ey = sz * (0.18 + rng() * 0.22), ez = sz * (0.5 + rng() * 0.5);
    const R = mul3(rotY(rng() * TAU), mul3(rotX((rng() - 0.5) * 2.0), rotZ((rng() - 0.5) * 2.0))); // tilted every which way
    shard(b, rng, [x, Math.min(-0.25, y), (rng() - 0.5) * W * (0.4 + 0.6 * e)], ex, ey, ez, R, tint(), 0.55 + 0.45 * rng());
  }
  const t = b.build();
  t.label = big ? 'Consolidated ice keel' : 'Pressure-ridge keel';
  t.fact = 'Where floes collide, broken ice piles into ridges whose keels can reach tens of metres below the surface.';
  return t;
}

// iceberg: faceted mass, flat top at y = 0, unit size (scaled per instance)
function iceberg(seed) {
  const b = new Builder();
  b.blob(4, (x, y, z, o) => {
    let d = 1 + 0.35 * fbm3(x * 1.3 + seed, y * 1.3, z * 1.3, 3, seed);
    d += 0.15 * Math.abs(vn3(x * 3, y * 3, z * 3, seed + 3));
    let py = y * d;
    py = py > -0.1 ? -0.1 * (1 - sat(py)) * 0.2 : py * (1.3 + 0.4 * vn3(x * 2, z * 2, 0, seed + 5));
    o[0] = x * d; o[1] = py + 0.05; o[2] = z * d * 0.8;
    const c = 0.85 + 0.2 * vn3(x * 4, y * 4, z * 4, seed);
    o[3] = ICE[0] * c; o[4] = ICE[1] * c; o[5] = ICE[2] * c; o[6] = 0.5 + 0.5 * sat(-py); o[7] = 5;
  });
  return b.build();
}

function brinicle(seed) {
  const b = new Builder();
  b.lathe(7, 6, (v) => [0.08 * (1 - v) ** 1.3 + 0.008 + 0.012 * Math.sin(v * 30 + seed), -v], (a, v) => 1 + 0.25 * vn3(Math.cos(a), v * 6, Math.sin(a), seed),
    (v, a, x, y, z, o) => { o[3] = 0.85; o[4] = 0.93; o[5] = 1.0; o[6] = 1.2; o[7] = 5; }, { flip: true });
  const t = b.build();
  t.fact = 'A brinicle is a tube of ice around sinking super-cold brine; where it touches the seabed it freezes everything it meets.';
  return t;
}

export function initPolar() {
  T.keel = [[1, 10, 5], [2, 14, 7], [3, 8, 4], [4, 12, 9], [5, 6, 3], [6, 16, 6], [7, 11, 6], [8, 9, 5]].map(([s, L, D]) => blockKeel(s, L, D, { n: Math.round(L * 3.2) }));
  T.keel.push(...[[11, 9, 5], [12, 13, 7], [13, 7, 4], [14, 15, 8], [15, 10, 6]].map(([s, L, D]) => blockKeel(s, L, D, { n: Math.round(L * 1.6), size: [1.2, 3.2], big: true })));
  T.berg = vary([1, 2, 3, 4, 5].map(iceberg), 2, 111, { disp: 0.1, bend: 0.05, twist: 0.3 });
  T.brinicle = vary([1, 2, 3, 4, 5, 6].map(brinicle), 2, 121, { disp: 0.15, bend: 0.2, twist: 0.6 });
}

const S = {};
function specs() {
  if (S.sponge) return S;
  Object.assign(S, {
    sponge: { tpl: T.tubeSp, scale: [0.8, 1.6], follow: 0.5, tint: tintFrom([[0.75, 0.72, 0.6], [0.7, 0.6, 0.3]]) },
    soft: { tpl: T.soft, scale: [0.8, 1.5], follow: 0.4, sway: true, tint: tintFrom([[0.8, 0.4, 0.35], [0.8, 0.75, 0.7]]) },
    anem: { tpl: T.anem, scale: [0.9, 1.5], follow: 0.7, sway: true, tint: tintFrom([[0.9, 0.9, 0.9]]) },
    star: { tpl: T.star, scale: [0.15, 0.3], follow: 1, sink: 0, tint: tintFrom([[0.9, 0.3, 0.1], [0.8, 0.6, 0.2]]) },
    rock: { tpl: T.rocks, scale: [0.6, 2], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.5, tint: tintFrom([[0.35, 0.35, 0.36]]) },
  });
  S.list = [{ w: 2, k: 'sponge' }, { w: 1.4, k: 'soft', sway: true }, { w: 1.4, k: 'anem', sway: true }, { w: 1, k: 'star' }, { w: 1.5, k: 'rock' }];
  return S;
}

// ---------- per-segment communities ----------
const COMMUNITIES = [
  { name: 'pressure-ridge rubble', keels: () => T.keel.slice(0, 8), n: 18, brinicles: 1.0 },
  { name: 'consolidated ridges', keels: () => T.keel.slice(8), n: 13, brinicles: 1.6 },
];
function community(ctx) {
  const seg = ctx.segments.find((g) => g.key === 'polar');
  return seg ? COMMUNITIES[Math.floor(mulberry32(seg.seed ^ 0x1c3)() * COMMUNITIES.length)] : COMMUNITIES[0];
}

const bergs = new Map();
function segmentBergs(ctx, seg) {
  let B = bergs.get(seg.id);
  if (B && B.seed === seg.seed) return B;
  const rng = mulberry32(seg.seed ^ 0x1ce), list = [];
  for (let s = seg.start + 130 + rng() * 80; s < seg.end - 120; s += 160 + rng() * 220) {
    const side = rng() < 0.5 ? -1 : 1, size = 12 + rng() * 10, x = ctx.pathX(s) + side * (size * 1.1 + 12 + rng() * 15);
    const tpl = rng.pick(T.berg), R = rotY(rng() * TAU), sy = size * (0.9 + rng() * 0.6);
    const y = Math.min(ctx.surfaceY + 0.3, ceilY(ctx, x, s, tpl, R, size, sy, size) + 0.4); // frozen into the ice sheet
    const pts = placedPoints(tpl, x, y, s, R, size, sy, size, 200);
    if (!pointsClear(ctx, pts, 1)) continue;
    let sMax = -1e9; for (let i = 2; i < pts.length; i += 3) sMax = Math.max(sMax, pts[i]);
    list.push({ tpl, x, y, s, R, size, sy, sMax });
  }
  B = { seed: seg.seed, list };
  bergs.set(seg.id, B);
  if (bergs.size > 24) bergs.delete(bergs.keys().next().value);
  return B;
}

export function layoutPolar(ctx) {
  if (presence(ctx, 'polar') <= 0) return null;
  const sp = specs(), rng = ctx.rng, fs = floorSampler(ctx), cs = ceilSampler(ctx), comm = community(ctx), bk = budgetK(ctx, 'polar'), tk = tierK(ctx);
  const st = new Batch(MAT.static, 60000 * bk);                                                     // keels, bergs
  const mid = new Batch(MAT.static, 16000 * bk * tk, 'mid'), sw = new Batch(MAT.sway, 12000 * bk * tk, 'mid'); // brinicles, benthos
  const idx = Math.floor(ctx.s0 / 64);
  for (const seg of ctx.segments) {
    if (seg.key !== 'polar') continue;
    for (const g of segmentBergs(ctx, seg).list) if (Math.floor(g.sMax / 64) === idx && st.add(g.tpl, g.x, g.y, -(g.s - ctx.s0), g.R, g.size, g.sy, g.size, 1, 1, 1, 1)) {
      const it = st.last;
      it.hang = 1;
      poi(ctx, 'iceberg', g.x, g.y - (g.tpl.maxY - g.tpl.minY) * g.sy * 0.45, g.s, g.size, { size: g.size });
    }
  }
  // keels under the ice (not in open leads); some on the outside of bends, dead ahead
  const keels = comm.keels(), keelSpots = bendSpots(ctx).map((b) => ({ s: b.s, x: bendX(ctx, b, 5.5, rng, 1.5) }));
  const more = steps(comm.n + keelSpots.length, 1, (k) => {
    const p = k < keelSpots.length ? keelSpots[k] : spot(ctx, rng, 6, 45, 0.9);
    if (rng() > ctx.weightOf(p.s, 'polar')) return;
    if (cs.at(p.x, p.s) > ctx.surfaceY - 0.4) return;
    const tpl = rng.pick(keels), sc = 0.7 + rng() * 0.7, sy = sc * (0.8 + rng() * 0.6), R = rotY(rng() * TAU);
    const y = ceilY(ctx, p.x, p.s, tpl, R, sc, sy, sc) + 0.3;
    if (!pointsClear(ctx, placedPoints(tpl, p.x, y, p.s, R, sc, sy, sc, 800), 0.6)) return;
    if (st.add(tpl, p.x, y, -(p.s - ctx.s0), R, sc, sy, sc, 1, 1, 1, 1)) st.last.hang = 1;
  });
  // brinicles: brine icicles growing down from the ice
  more.push(...steps(Math.round(14 * comm.brinicles * tk), 8, () => {
    const p = spot(ctx, rng, 5, 35, 1);
    if (rng() > ctx.weightOf(p.s, 'polar')) return;
    const c = cs.at(p.x, p.s);
    if (c > ctx.surfaceY - 0.4) return;
    const L = 1 + rng() * 4, w = 1 + rng() * 0.6;
    if (!tubeClear(ctx, p.x, p.s, c - L, c, 0.2)) return;
    hangAt(ctx, mid, rng.pick(T.brinicle), p.x, p.s, rotY(rng() * TAU), w, L, w, [1, 1, 1], 1, 0.1);
  }));
  // benthos far below
  const nextP136 = clusterer(ctx, rng, 0, 40, 1);
  more.push(...steps(Math.round(45 * tk), 15, () => {
    const p = nextP136();
    if (!p || rng() > ctx.weightOf(p.s, 'polar')) return;
    const e = pickW(rng, sp.list);
    putFloor(ctx, fs, e.sway ? sw : mid, sp[e.k], p.x, p.s, rng);
  }));
  return { batches: [st, mid, sw], more };
}
