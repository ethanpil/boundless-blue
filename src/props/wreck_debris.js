// Loose wreckage scattered around the wrecks (startup templates, varied per instance): casks, oil drums,
// crates, cannons, cannonball piles, ballast stones, anchors, chain, timbers, bent plates, hull fragments
// with frames, a fallen broken mast with its heel in the sand, loose yards, boilers, fallen cowl ventilators,
// girders, tyres, bottles, gas bottles.
import { Builder, T, TAU, vn3, rotX, rotY, rotZ, mul3, vary } from './core.js';
import { mulberry32 } from '../noise.js';
import { cyl, pipe, disc, ring, beam } from './wreck_geo.js';
import { cowl as cowlPart, anchor as anchorPart, chainAlong, cannonBarrel, WIN } from './wreck_parts.js';
import { growthFilm } from './wreck_hull.js';

function barrel(seed, steel) {
  const b = new Builder();
  b.lathe(12, 6, (v) => [steel ? 0.3 + 0.01 * Math.sin(v * 25) : 0.27 + 0.07 * Math.sin(v * Math.PI), v * (steel ? 0.9 : 0.85)], null, (v, a, x, y, z, o) => {
    const hoop = !steel && (Math.abs(v - 0.15) < 0.05 || Math.abs(v - 0.85) < 0.05) ? 0.5 : 1;
    const c = steel ? [0.32, 0.14, 0.07] : [0.32 * hoop, 0.22 * hoop, 0.13 * hoop];
    o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = 0.6; o[7] = steel ? 4 : 0;
  });
  for (const top of [0, 1]) {
    const c = b.v(0, top * (steel ? 0.9 : 0.85), 0, 0, top ? 1 : -1, 0, 0.2, 0.15, 0.1, 0.5, steel ? 4 : 0), base = top ? 12 * 6 : 0;
    for (let i = 0; i < 12; i++) top ? b.t(base + ((i + 1) % 12), base + i, c) : b.t(base + i, base + ((i + 1) % 12), c);
  }
  if (seed % 2) b.xform(0, rotZ(Math.PI / 2), 0.43, 0.27, 0); // lying on its side
  return b.build();
}
function crate(seed, broken) {
  const b = new Builder(), rng = mulberry32(seed), c = [0.34, 0.26, 0.16];
  for (let k = 0; k < 5; k++) {
    if (broken && rng() < 0.4) continue;
    b.box(1.1, 0.2, 0.9, null, 0, 0.12 + k * 0.21, 0, c.map((v) => v * (0.8 + 0.3 * rng())), [0.8, 0]);
  }
  b.box(1.12, 1.05, 0.08, null, 0, 0.53, 0.46, c, [0.8, 0]);
  if (!broken) b.box(1.12, 1.05, 0.08, null, 0, 0.53, -0.46, c, [0.8, 0]);
  return b.build();
}
function cannon(seed) {
  const b = new Builder(), rng = mulberry32(seed);
  cannonBarrel(b, [0, 0.22, -1.1], [0, 0, 1], 2.2 + rng() * 0.8, [0.1, 0.09, 0.08], [0.8, 4]);
  b.xform(0, rotY(rng() * 0.3), 0, 0, 0);
  return b.build();
}
function shotPile(seed) { // cannonballs fused together by corrosion
  const b = new Builder(), rng = mulberry32(seed), r = 0.075 + rng() * 0.03, n = 6 + Math.floor(rng() * 10);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * 0.45, x = Math.cos(a) * d, z = Math.sin(a) * d, y = r * 0.8 + (d < 0.2 ? rng() * r * 1.6 : 0);
    const v0 = b.vc;
    b.blob(1, (nx, ny, nz, o) => { o[0] = x + nx * r; o[1] = y + ny * r; o[2] = z + nz * r; o[3] = 0.14; o[4] = 0.1; o[5] = 0.08; o[6] = 0.9; o[7] = 4; });
    void v0;
  }
  b.label = 'Cannonballs'; b.fact = 'Iron cannonballs rust together into lumps that archaeologists X-ray to count.';
  return b.build();
}
function ballastPile(seed) { // river stones from a wooden ship's bilge
  const b = new Builder(), rng = mulberry32(seed), n = 14 + Math.floor(rng() * 16), R = 1.2 + rng() * 1.3;
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * R, s = 0.18 + rng() * 0.3, x = Math.cos(a) * d * 1.4, z = Math.sin(a) * d * 0.8;
    const y = s * 0.5 + (1 - d / R) * 0.5 * rng(), col = [0.36, 0.34, 0.3].map((c) => c * (0.7 + 0.5 * rng())), sd = seed * 31 + k;
    b.blob(1, (nx, ny, nz, o) => { const q = 1 + 0.25 * vn3(nx * 2, ny * 2, nz * 2, sd); o[0] = x + nx * s * 1.3 * q; o[1] = y + ny * s * 0.7 * q; o[2] = z + nz * s * q; o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0.9; o[7] = 6.2; });
  }
  b.label = 'Ballast stones'; b.fact = 'A wooden ship carried tonnes of stone ballast; the pile marks where its hull lay.';
  return b.build();
}
function anchorLying(seed, kind) {
  const b = new Builder(), rng = mulberry32(seed);
  anchorPart(b, [0, 0.25, 0], mul3(rotX(Math.PI / 2), rotZ(rng() * 0.3)), 0.9 + rng() * 0.5, kind, [0.18, 0.1, 0.07], [0.8, 4]);
  return b.build();
}
function chainTrail(seed) {
  const b = new Builder(), rng = mulberry32(seed), pts = [];
  let a = rng() * TAU, p = [0, 0.05, 0];
  for (let k = 0; k < 9; k++) { pts.push(p); a += (rng() - 0.5) * 1.1; p = [p[0] + Math.cos(a) * 0.9, 0.05, p[2] + Math.sin(a) * 0.9]; }
  chainAlong(b, pts, 0.3, [0.22, 0.11, 0.06], [0.6, 4]);
  return b.build();
}
function plank(seed, steel) {
  const b = new Builder(), rng = mulberry32(seed);
  if (steel) { // bent, torn plate
    b.grid(6, 3, (u, v, i, j, o) => { o[0] = (u - 0.5) * 3; o[1] = 0.15 + 0.4 * Math.sin(u * 3 + seed) * v + 0.1 * Math.sin(v * 4); o[2] = (v - 0.5) * 2; o[3] = 0.24; o[4] = 0.1; o[5] = 0.06; o[6] = 0.6; o[7] = 4; }, {});
    b.grid(6, 3, (u, v, i, j, o) => { o[0] = (u - 0.5) * 3; o[1] = 0.1 + 0.4 * Math.sin(u * 3 + seed) * v + 0.1 * Math.sin(v * 4); o[2] = (v - 0.5) * 2; o[3] = 0.12; o[4] = 0.06; o[5] = 0.04; o[7] = 4; }, { flip: true });
  } else {
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) b.box(0.25, 0.08, 2 + rng() * 3, rotY((rng() - 0.5) * 0.8), (k - n / 2) * 0.35, 0.05 + k * 0.03, 0, [0.3, 0.22, 0.14].map((c) => c * (0.75 + 0.4 * rng())), [0.9, 0]);
  }
  return b.build();
}
// piece of hull skin with frames lying on the sand (wood or steel), low enough to sit under the path
function hullFragment(seed, steel) {
  const b = new Builder(), rng = mulberry32(seed), L = 3 + rng() * 2.5, W = 1.8 + rng() * 1.2;
  const col = steel ? [0.42, 0.2, 0.12] : [0.4, 0.3, 0.2], f = [0.9, steel ? 4 : 0];
  const hole = (u, v) => vn3(u * 4, v * 3, seed, seed) > 0.35 || (u > 0.85 && rng() < 0.5);
  const v0 = b.vc, NU = 10, NV = 5;
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
    const u = i / NU, v = j / NV, x = (v - 0.5) * W, z = (u - 0.5) * L;
    const y = 0.35 * Math.cos((v - 0.5) * 2.4) - 0.2 + 0.08 * Math.sin(u * 5 + seed) + (steel ? 0 : 0.02 * Math.sin(v * 40));
    const c = steel ? col : col.map((q) => q * (0.85 + 0.25 * Math.sin(v * 40)));
    b.v(x, y, z, 0, 1, 0, c[0], c[1], c[2], f[0], f[1]);
  }
  const i0 = b.I.length;
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    if (hole((i + 0.5) / NU, (j + 0.5) / NV)) continue;
    const a = v0 + i * (NV + 1) + j, bb = a + NV + 1;
    b.t(a, a + 1, bb); b.t(bb, a + 1, bb + 1);
  }
  b.smooth(v0, i0);
  const v1 = b.vc, i1 = b.I.length;
  for (let k = v0; k < v1; k++) b.v(b.P[k * 3], b.P[k * 3 + 1] - 0.06, b.P[k * 3 + 2], 0, -1, 0, 0.12, 0.09, 0.07, 0.2, f[1]);
  for (let k = i0; k < i1; k += 3) b.t(b.I[k] - v0 + v1, b.I[k + 2] - v0 + v1, b.I[k + 1] - v0 + v1);
  b.smooth(v1, i1);
  for (let k = 0; k < 4; k++) {
    const z = (k / 3 - 0.5) * L * 0.85, pts = [];
    for (let j = 0; j <= 6; j++) { const v = j / 6; pts.push([(v - 0.5) * W * 1.05, 0.35 * Math.cos((v - 0.5) * 2.4) - 0.1 + (j === 6 ? 0.25 * rng() : 0), z]); }
    pipe(b, pts, steel ? 0.06 : 0.09, 4, col.map((c) => c * 0.7), f);
  }
  return b.build();
}
// broken mast where it fell: the heel driven into the sand, the shaft 60-85 deg from upright, the splintered
// top clear of the bottom. No yard across it (an upright mast with a crossing yard read as a grave cross);
// the yard lies loose on the sand instead (spar). Origin under the middle of the visible shaft; y = 0 is the
// sand line: the contact band reaches up to it, so the seat buries the heel and the shaft emerges there.
function mastStump(seed) {
  const b = new Builder(), rng = mulberry32(seed), wc = [0.28, 0.21, 0.13], wf = [0.85, 0], iron = [0.16, 0.09, 0.06];
  const t = (60 + (seed % 4) * 6.5 + rng() * 5) * Math.PI / 180, sn = Math.sin(t), cs = Math.cos(t); // 60-85 deg across the 4 variants
  const Lv = 6 + rng() * 3.5, lb = 1.3 + rng() * 0.5, at = (u) => [-Lv * sn / 2 + sn * u, cs * u, 0]; // visible, buried length
  const us = [-lb, -lb / 2, 0, Lv * 0.3, Lv * 0.65, Lv], top = at(Lv);
  pipe(b, us.map(at), us.map((u) => 0.33 - 0.09 * Math.max(0, u) / Lv), 7, wc, wf, 1);
  for (let k = 0; k < 3; k++) { // splintered top
    const a = k * 2.1 + rng(), l = 0.5 + rng() * 0.6, o = [-cs * Math.cos(a) * 0.15, sn * Math.cos(a) * 0.15, Math.sin(a) * 0.15];
    cyl(b, [top[0] + o[0], top[1] + o[1], top[2] + o[2]], [top[0] + sn * l + o[0] * 0.6, top[1] + cs * l + o[1] * 0.6, top[2] + o[2] * 0.6], 0.1, 0.01, 3, wc, wf);
  }
  for (const u of [Lv * 0.32, Lv * 0.6]) ring(b, at(u), [sn, cs, 0], 0.3, 0.035, 0.14, 8, iron, [0.8, 4]); // iron mast bands
  let minY = 0;
  for (let i = 1; i < b.P.length; i += 3) minY = Math.min(minY, b.P[i]);
  b.band = -minY;
  b.label = 'Broken mast'; b.fact = "A big sailing ship's lower mast could be over 30 m tall and a metre thick, built up from several trees.";
  b.obs = [[...at(0), ...top, 0.45]];
  return b.build();
}
// a yard (the spar that carried a square sail) lying loose on the sand: thickest at the slings, tapering to
// the yardarms, iron bands at the middle, one end broken off. Its underside is straight, so it lies flat.
function spar(seed) {
  const b = new Builder(), rng = mulberry32(seed), L = 5 + rng() * 4, r = 0.13 + rng() * 0.05, wc = [0.27, 0.2, 0.12], wf = [0.85, 0];
  const us = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1], rs = us.map((u) => r * (0.55 + 0.45 * Math.sin(u * Math.PI))), x = (u) => (u - 0.5) * L;
  pipe(b, us.map((u, i) => [x(u), rs[i], 0]), rs, 7, wc, wf, 1);
  for (const o of [-0.35, 0.35]) ring(b, [o, r, 0], [1, 0, 0], r + 0.005, 0.025, 0.1, 8, [0.16, 0.09, 0.06], [0.8, 4]);
  for (let k = 0; k < 3; k++) { const a = k * 2.1 + rng(), e = [x(1), rs[6], 0]; cyl(b, [e[0], e[1] + Math.cos(a) * rs[6] * 0.5, Math.sin(a) * rs[6] * 0.5], [e[0] + 0.25 + rng() * 0.35, e[1] + Math.cos(a) * rs[6] * 0.3, Math.sin(a) * rs[6] * 0.3], 0.05, 0.01, 3, wc, wf); }
  b.band = 0.07; // the contact band holds the whole underside, not only the iron bands that stand 3 cm proud of it
  b.label = 'Fallen yard'; b.fact = 'Yards carried the square sails; sailors stood on foot-ropes slung beneath them to furl the canvas.';
  return b.build();
}
// Scotch marine boiler: the last part of a steamer to stand when the hull has collapsed
function boiler(seed) {
  const b = new Builder(), rng = mulberry32(seed), R = 1.5 + rng() * 0.8, L = 3 + rng() * 1.5, c = [0.24, 0.1, 0.05], f = [0.9, 4];
  cyl(b, [0, R, -L / 2], [0, R, L / 2], R, R, 18, c, f);
  disc(b, [0, R, L / 2], [0, 0, 1], R, 18, c.map((x) => x * 0.8), f);
  disc(b, [0, R, -L / 2], [0, 0, -1], R, 18, c.map((x) => x * 0.8), f);
  const nf = R > 1.9 ? 3 : 2; // furnace openings on the front face
  for (let k = 0; k < nf; k++) { const x = (k - (nf - 1) / 2) * R * 0.62; ring(b, [x, R * 0.75, -L / 2 - 0.02], [0, 0, -1], R * 0.24, 0.05, 0.12, 10, c, f); disc(b, [x, R * 0.75, -L / 2 - 0.03], [0, 0, -1], R * 0.21, 10, WIN, [0, 4]); }
  for (let k = 0; k < 12; k++) disc(b, [(rng() - 0.5) * R * 1.2, R * 1.2 + rng() * R * 0.5, -L / 2 - 0.02], [0, 0, -1], 0.06, 5, WIN, [0, 4]); // tube ends
  b.box(R * 1.8, 0.4, L * 0.8, null, 0, 0.2, 0, c, f); // saddle
  b.label = 'Boiler'; b.fact = "Boilers are built so strong they often stand intact long after the ship's hull has rusted away.";
  b.obs = [[0, R, -L / 2 + R * 0.5, 0, R, L / 2 - R * 0.5, R * 1.05]];
  return b.build();
}
function cowlFallen(seed) {
  const b = new Builder(), rng = mulberry32(seed), c = [0.3, 0.13, 0.07], f = [0.9, 4];
  cowlPart(b, [0, 0, 0], 1.6 + rng(), 0.35 + rng() * 0.15, rng() * 6, c, f);
  b.xform(0, mul3(rotZ(Math.PI / 2 * (0.9 + rng() * 0.2)), rotY(rng() * 6)), 0, 0.42, 0);
  b.label = 'Cowl ventilator'; b.fact = 'Cowl vents were turned into the wind to blow fresh air down into the engine room and holds.';
  return b.build();
}
function girders(seed) {
  const b = new Builder(), rng = mulberry32(seed), c = [0.26, 0.11, 0.06], f = [0.8, 4], n = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const L = 3 + rng() * 4, a = rng() * TAU, y = 0.12 + k * 0.2, x = (rng() - 0.5) * 1.2, z = (rng() - 0.5) * 1.2, d = [Math.cos(a), 0.02 * k, Math.sin(a)];
    const p = [x - d[0] * L / 2, y, z - d[2] * L / 2], q = [x + d[0] * L / 2, y + (rng() - 0.3) * 0.4, z + d[2] * L / 2];
    beam(b, p, q, 0.22, 0.04, c, f); beam(b, [p[0], p[1] - 0.1, p[2]], [q[0], q[1] - 0.1, q[2]], 0.04, 0.2, c, f);
  }
  b.label = 'Steel girders';
  return b.build();
}
function tyres(seed) {
  const b = new Builder(), rng = mulberry32(seed), n = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) { const r = 0.45 + rng() * 0.2; ring(b, [(rng() - 0.5) * 1.2, 0.17 + k * 0.32, (rng() - 0.5) * 1.2], [0.1 * rng(), 1, 0.1 * rng()], r, r * 0.38, r * 0.5, 10, [0.05, 0.05, 0.05], [0.7, 0]); }
  b.label = 'Tyre fenders'; b.fact = 'Tugs hang old lorry tyres along their sides as fenders.';
  return b.build();
}
function bottles(seed) {
  const b = new Builder(), rng = mulberry32(seed), n = 4 + Math.floor(rng() * 6);
  for (let k = 0; k < n; k++) {
    const x = (rng() - 0.5) * 0.9, z = (rng() - 0.5) * 0.9, a = rng() * TAU, d = [Math.cos(a), 0, Math.sin(a)], g = rng() < 0.5 ? [0.06, 0.12, 0.05] : [0.12, 0.08, 0.03];
    const r = 0.04 + rng() * 0.025, L = r * 6;
    pipe(b, [[x, r, z], [x + d[0] * L * 0.6, r, z + d[2] * L * 0.6], [x + d[0] * L * 0.75, r * 0.7, z + d[2] * L * 0.75], [x + d[0] * L, r * 0.6, z + d[2] * L]], [r, r, r * 0.4, r * 0.35], 6, g, [0.5, 0], 1);
  }
  b.label = 'Old bottles'; b.fact = 'Hand-blown bottles in a wreck help divers date it: shapes changed every few decades.';
  return b.build();
}
function gasBottles(seed) {
  const b = new Builder(), rng = mulberry32(seed), n = 2 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) { const x = (k - n / 2) * 0.32 + (rng() - 0.5) * 0.1, a = (rng() - 0.5) * 0.4; cyl(b, [x, 0.13, -0.6], [x + a, 0.13, 0.6], 0.13, 0.13, 8, [0.2, 0.2, 0.18].map((c) => c * (0.7 + rng())), [0.8, 4], 3); }
  b.label = 'Gas cylinders';
  return b.build();
}

export function initDebris() {
  T.debris = {
    barrel: vary([barrel(1, false), barrel(3, false)], 4, 71, { disp: 0.08, bend: 0.06, twist: 0.2 }), drum: vary([barrel(2, true), barrel(5, true)], 4, 72, { disp: 0.1, bend: 0.08 }),
    crate: vary([1, 2, 3, 4].map((s) => crate(s, s % 2 === 0)), 2, 73, { disp: 0.03, bend: 0.05, twist: 0.1, smooth: false }),
    cannon: vary([cannon(1), cannon(2)], 3, 74, { disp: 0.03, scale: 0.15, bend: 0.03, twist: 0 }),
    frag: [1, 2, 5, 6].map((s) => hullFragment(s, false)), fragSteel: [3, 4, 7, 8].map((s) => hullFragment(s, true)), mast: [1, 2, 3, 4].map(mastStump), spar: [7, 12, 4].map(spar),
    anchor: [anchorLying(1, 'admiralty'), anchorLying(2, 'admiralty'), anchorLying(3, 'stockless'), anchorLying(4, 'stockless')], chain: [1, 2, 3, 4, 5].map(chainTrail),
    plank: [1, 2, 5, 6].map((s) => plank(s, false)), plate: [3, 4, 7, 8].map((s) => plank(s, true)),
    shot: [1, 2, 3].map(shotPile), ballast: [1, 2, 3, 4].map(ballastPile), boiler: [1, 2, 3].map(boiler), cowl: [1, 2, 3].map(cowlFallen),
    girder: [1, 2, 3].map(girders), tyre: [1, 2, 3].map(tyres), bottles: [1, 2].map(bottles), gas: [1, 2].map(gasBottles),
  };
  const D = T.debris;
  for (const k in D) for (const t of D[k]) growthFilm(t.fx); // a faint growth film, like the hulls
  for (const t of D.anchor.slice(0, 2)) { t.label = 'Admiralty anchor'; t.fact = 'Old anchors had a stock across the shank, so one fluke always dug into the seabed.'; }
  for (const t of D.anchor.slice(2)) { t.label = 'Stockless anchor'; t.fact = 'Stockless anchors, from the 1820s on, could be hauled right up into the hawse pipe.'; }
  return D;
}
