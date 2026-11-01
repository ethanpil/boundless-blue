// Seagrass meadow: thousands of swaying blades as two instanced patch LODs (near / far), sandy gaps
// from noise, plus shells, sea cucumbers, scallops, sand dollars, cushion stars and rocks.
import { Builder, Batch, Inst, T, TAU, sat, sstep, lerp, vn3, floorSampler, presence, tubeClear, orient, budgetK, bendSpots, vary, tierK, LENS } from './core.js';
import { seastar } from './shapes.js';
import { putFloor, pickW, tintFrom, spot, putBend, microDetail, microSteps, steps, clusterer, groundY } from './scatter.js';
import { MAT } from './materials.js';
import { mulberry32, noise2 } from '../noise.js';

function conch(seed) {
  const b = new Builder();
  // spire + body whorl as a lathe around a tilted axis, with a flared lip
  b.lathe(10, 7, (v) => {
    const r = v < 0.55 ? 0.42 * Math.sin((v / 0.55) * Math.PI * 0.5) : 0.42 * Math.pow(1 - (v - 0.55) / 0.45, 1.3) + 0.02;
    return [r, v * 1.0];
  }, (a, v) => 1 + 0.12 * Math.max(0, Math.sin(a * 6 + v * 20)) * (v > 0.45 ? 1 : 0.3) + (v < 0.55 ? 0.25 * Math.max(0, Math.cos(a)) * (1 - v) : 0),
  (v, a, x, y, z, o) => {
    const band = 0.75 + 0.3 * Math.sin(v * 30 + a);
    const lip = Math.max(0, Math.cos(a)) * (1 - v);
    o[3] = lerp(0.72, 0.95, lip) * band; o[4] = lerp(0.55, 0.6, lip) * band; o[5] = lerp(0.42, 0.5, lip) * band; o[7] = 2;
  });
  b.xform(0, [0, -1, 0, 1, 0, 0, 0, 0, 1], 0.5, 0.3, 0); // lay it on its side
  return b.build();
}

function cucumber(seed) {
  const b = new Builder();
  b.blob(2, (x, y, z, o) => {
    const bump = 1 + 0.12 * Math.max(0, vn3(x * 6, y * 6, z * 6, seed));
    const w = 0.12 * (1 - 0.25 * x * x) * bump;
    o[0] = x * 0.55; o[1] = Math.max(-0.2, y) * w + 0.085; o[2] = z * w;
    const ao = y < 0 ? 0.5 : 1;
    o[3] = 0.22 * ao; o[4] = 0.14 * ao; o[5] = 0.09 * ao; o[7] = 2;
  });
  return b.build();
}

function scallop(seed) {
  const b = new Builder();
  const shell = (top) => b.grid(14, 5, (u, v, i, j, o) => {
    const a = (u - 0.5) * 2.4, r = v * 0.5 * (1 + 0.04 * Math.abs(Math.sin(u * 14 * Math.PI)));
    const x = Math.sin(a) * r, z = Math.cos(a) * r - 0.25;
    const h = (top ? 0.09 : 0.03) * Math.sin(v * Math.PI * 0.8) + 0.015 * Math.abs(Math.sin(u * 14 * Math.PI)) * v;
    o[0] = x; o[1] = top ? 0.04 + h : 0.04 - h; o[2] = z;
    const c = top ? 0.8 + 0.25 * Math.abs(Math.sin(u * 14 * Math.PI)) : 0.6;
    o[3] = c * 0.95; o[4] = c * 0.6; o[5] = c * 0.45;
  }, { flip: !top });
  shell(true); shell(false);
  return b.build();
}

function sandDollar(seed) {
  const b = new Builder();
  b.grid(18, 4, (u, v, i, j, o) => {
    const a = u * TAU, r = 0.5 * Math.sin(v * Math.PI * 0.5);
    o[0] = Math.cos(a) * r; o[1] = 0.05 * Math.cos(v * Math.PI * 0.5) + 0.01; o[2] = Math.sin(a) * r;
    const petal = v > 0.25 && v < 0.75 ? Math.pow(Math.abs(Math.cos(a * 2.5)), 6) : 0;
    const c = 0.82 - 0.25 * petal;
    o[3] = c; o[4] = c * 0.93; o[5] = c * 0.8;
  }, { wrapU: true, flip: true });
  return b.build();
}

// Seagrass shoot patch: n narrow ribbon blades rising from a disc of radius r. Each blade arcs smoothly
// (constant curl, bent across its flat face), tapers gently to a blunt tip, and some carry a brownish film
// of epiphytes toward the tip. Same vertex format as shapes.grassPatch (sway style 2, up-biased normals).
function meadowPatch(seed, { n = 24, r = 0.45, h = 0.8, w = 0.016, segs = 4, base = [0.07, 0.15, 0.05], mid = [0.2, 0.44, 0.12], tipc = [0.34, 0.48, 0.17], epi = 0.35, sway = 0.22 } = {}) {
  const b = new Builder(), rng = mulberry32(seed), EPI = [0.34, 0.3, 0.15];
  for (let k = 0; k < n; k++) {
    const rr = r * Math.sqrt(rng()), a = rng() * TAU, cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const L = h * (0.55 + 0.6 * Math.pow(rng(), 0.8));
    const lean = rng() * TAU, lx = Math.cos(lean), lz = Math.sin(lean);
    const fa = lean + Math.PI / 2 + (rng() - 0.5) * 0.5, fx = Math.cos(fa), fz = Math.sin(fa); // ribbon width: across the bend
    const la = 0.08 + rng() * 0.4, th = 0.25 + rng() * 1.0;    // base lean, total arc over the blade (rad)
    const ww = w * (0.7 + 0.6 * rng()), ck = 0.75 + 0.5 * rng(), cy = rng() * 0.25;
    const ep = rng() < epi ? 0.35 + 0.5 * rng() : 0;
    let px = cx, py = 0, pz = cz;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      if (i > 0) { const am = la + th * (t - 0.5 / segs), st = L / segs; px += Math.sin(am) * lx * st; py += Math.cos(am) * st; pz += Math.sin(am) * lz * st; }
      const wt = ww * (i === segs ? 0.32 : 1 - 0.1 * t - 0.2 * t * t * t);
      const c0 = t < 0.5 ? [lerp(base[0], mid[0], t * 2), lerp(base[1], mid[1], t * 2), lerp(base[2], mid[2], t * 2)]
        : [lerp(mid[0], tipc[0], (t - 0.5) * 2), lerp(mid[1], tipc[1], (t - 0.5) * 2), lerp(mid[2], tipc[2], (t - 0.5) * 2)];
      const e = ep * sstep(0.35, 1, t), c = [lerp(c0[0] * (1 + cy), EPI[0], e) * ck, lerp(c0[1], EPI[1], e) * ck, lerp(c0[2] * (1 - cy), EPI[2], e) * ck];
      const am = la + th * t, nh = Math.cos(am) * 0.5, ny = 0.85 + Math.sin(am) * 0.15; // face normal (lean side), biased up
      b.v(px - fx * wt, py, pz - fz * wt, lx * nh, ny, lz * nh, c[0], c[1], c[2], sway * L * Math.pow(t, 1.5), 2);
      b.v(px + fx * wt, py, pz + fz * wt, lx * nh, ny, lz * nh, c[0], c[1], c[2], sway * L * Math.pow(t, 1.5), 2);
    }
    const v0 = b.vc - (segs + 1) * 2;
    for (let i = 0; i < segs; i++) { const a0 = v0 + i * 2; b.t(a0, a0 + 1, a0 + 2); b.t(a0 + 1, a0 + 3, a0 + 2); }
  }
  for (let i = 0; i < b.N.length; i += 3) { const l = Math.hypot(b.N[i], b.N[i + 1], b.N[i + 2]); b.N[i] /= l; b.N[i + 1] /= l; b.N[i + 2] /= l; }
  return b.build();
}

// Meadow floor: inside a bed the sediment is darker than bare sand (detritus, blade litter, diatom film).
// A low draped disc with a lobed outline, lightening toward its rim so beds blend into the sand.
function bedPatch(seed, r) {
  const b = new Builder(), rng = mulberry32(seed * 97 + 5), lob = 3 + Math.floor(rng() * 4), ph = rng() * TAU;
  const dark = [0.2, 0.21, 0.11], rim = [0.42, 0.4, 0.3];
  b.grid(12, 2, (u, v, i, j, o) => {
    const a = u * TAU, R = r * (1 + 0.28 * vn3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, seed, seed) + 0.12 * Math.sin(a * lob + ph));
    const rr = Math.pow(v, 0.85) * R;
    o[0] = Math.cos(a) * rr; o[2] = Math.sin(a) * rr;
    o[1] = 0.012 * (1 - v) + 0.005 * (1 + vn3(o[0] * 5, 0, o[2] * 5, seed + 1));
    const c = 0.8 + 0.3 * vn3(o[0] * 3, 2, o[2] * 3, seed + 2), e = 0.65 * v * v;
    o[3] = lerp(dark[0], rim[0], e) * c; o[4] = lerp(dark[1], rim[1], e) * c; o[5] = lerp(dark[2], rim[2], e) * c; o[6] = 0; o[7] = 0;
  }, { wrapU: true, flip: true });
  b.drape = true; b.dLift = 0.015; b.solid = false;
  return b.build();
}

export function initSeagrass() {
  // near patches (<= 9 m from the path): narrow, long ribbons on 3-4 segments; far patches: fewer, wider blades
  const MID = [0.22, 0.46, 0.12], BASE = [0.07, 0.15, 0.05];
  T.grassNear = [501, 503, 505].map((sd, i) => meadowPatch(sd, { n: 20 + i * 2, r: 0.6 + i * 0.05, h: 0.8 + i * 0.1, w: 0.022 + i * 0.002, segs: 3 }));
  T.grassFar = [502, 504].map((sd, i) => meadowPatch(sd, { n: 16 + i * 2, r: 1.1 + i * 0.1, h: 0.85 + i * 0.12, w: 0.04 + i * 0.005, segs: 2 }));
  // turtle grass: shorter, strap-like; eelgrass: long, very narrow ribbons
  T.turtleNear = [601, 603, 605].map((sd, i) => meadowPatch(sd, { n: 22 + i * 2, r: 0.6, h: 0.65 + i * 0.06, w: 0.026 + i * 0.002, segs: 3, base: BASE, mid: MID, tipc: [0.36, 0.47, 0.17], epi: 0.45 }));
  T.turtleFar = [602, 604].map((sd, i) => meadowPatch(sd, { n: 16 + i * 2, r: 1.1, h: 0.68, w: 0.045, segs: 2, base: BASE, mid: MID, tipc: [0.36, 0.47, 0.17], epi: 0.45 }));
  T.eelNear = [701, 703, 705].map((sd, i) => meadowPatch(sd, { n: 16 + i * 2, r: 0.6, h: 1.05 + i * 0.12, w: 0.016 + i * 0.002, segs: 4, base: [0.06, 0.14, 0.05], mid: [0.18, 0.42, 0.14], tipc: [0.35, 0.5, 0.2], epi: 0.25, sway: 0.28 }));
  T.eelFar = [702, 704].map((sd, i) => meadowPatch(sd, { n: 16 + i * 2, r: 1.1, h: 1.15, w: 0.032, segs: 2, base: [0.06, 0.14, 0.05], mid: [0.18, 0.42, 0.14], tipc: [0.35, 0.5, 0.2], epi: 0.25, sway: 0.28 }));
  T.grassBed = [1, 2, 3, 4].map((k) => bedPatch(k, 1.5 + 0.15 * k));
  T.conch = vary([conch(1), conch(2)], 4, 11, { disp: 0.1 });
  T.cucumber = vary([cucumber(1), cucumber(2), cucumber(3)], 3, 21, { disp: 0.12, bend: 0.25, twist: 0.4 });
  T.scallop = vary([scallop(1), scallop(2)], 4, 31, { disp: 0.06, bend: 0.05 });
  T.sandDollar = vary([sandDollar(1), sandDollar(2)], 3, 41, { disp: 0.04, bend: 0.04, twist: 0 });
  T.cushion = [5, 6, 7, 8, 9].map((s) => seastar(s, { arms: 5, fat: 0.7 + (s % 3) * 0.25, curl: 0.02 }));
}

const S = {};
function specs() {
  if (S.rock) return S;
  Object.assign(S, {
    rock: { tpl: T.rocks, scale: [0.3, 1.3], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.4, tint: tintFrom([[0.52, 0.5, 0.44], [0.46, 0.45, 0.42]]) },
    conch: { tpl: T.conch, scale: [0.18, 0.3], follow: 0.9, sink: 0.1, tint: tintFrom([[0.9, 0.85, 0.8]]) },
    cucumber: { tpl: T.cucumber, scale: [0.6, 1.1], follow: 0.95, tint: tintFrom([[1, 1, 1], [0.6, 0.6, 0.6], [1.4, 1.1, 0.8]]) },
    scallop: { tpl: T.scallop, scale: [0.12, 0.2], follow: 0.95, tint: tintFrom([[1, 0.8, 0.7], [1, 0.5, 0.4], [0.9, 0.85, 0.8]]) },
    dollar: { tpl: T.sandDollar, scale: [0.07, 0.1], follow: 1, sink: 0.3, tint: tintFrom([[0.9, 0.85, 0.75]]) },
    cushion: { tpl: T.cushion, scale: [0.18, 0.26], follow: 0.95, sink: 0, tint: tintFrom([[0.9, 0.35, 0.08], [0.85, 0.6, 0.15], [0.7, 0.2, 0.12]]) },
  });
  Object.assign(S, {
    // steer-around outcrops: low, broad boulder mounds (live pool) with rubble at the foot, never lone spires
    bendRock: { tpl: T.mound, scale: [1.1, 1.7], ys: [0.6, 0.9], xz: 0.5, grow: [0.6, 1.5], follow: 0.2, sink: 0.2, tint: tintFrom([[0.55, 0.52, 0.46], [0.5, 0.48, 0.44]]) },
    grit: { tpl: T.grit, scale: [0.8, 1.6], follow: 1, sink: 0.01, tint: tintFrom([[1, 0.96, 0.9]], 0.06) },
    algae: { tpl: T.algae, scale: [0.6, 1.5], follow: 1, sink: 0.01, tint: tintFrom([[0.7, 0.8, 0.5], [0.8, 0.7, 0.45]], 0.1) },
  });
  S.bottle = { tpl: T.bottle, scale: [1, 1.15], follow: 0.9, sink: 0.5, tint: tintFrom([[1, 1, 1]], 0.08) };
  S.bed = { tpl: T.grassBed, scale: [0.85, 1.3], follow: 1, tint: tintFrom([[1, 1, 1], [1.08, 1.02, 0.9], [0.9, 0.95, 0.85]], 0.08) };
  S.micro = [{ w: 2, spec: S.grit }, { w: 1.5, spec: S.algae }];
  S.list = [
    { w: 2, k: 'rock' }, { w: 1.2, k: 'conch' }, { w: 1.6, k: 'cucumber' }, { w: 1.2, k: 'scallop' }, { w: 1.4, k: 'dollar' }, { w: 1.1, k: 'cushion' },
  ];
  return S;
}

const meadow = (x, s) => noise2(x / 13, s / 13, 501) * 0.7 + noise2(x / 4.5, s / 4.5, 502) * 0.3;
// meandering bare-sand channels (current-scoured) for the channelled community
const channel = (x, s) => 1 - sstep(0.04, 0.16, Math.abs(noise2(x / 24 + 1.6 * noise2(s / 70, 3.1, 504), s / 90, 503)));

// ---------- per-segment communities: dominant species, density, sand pattern ----------
const COMMUNITIES = [
  { name: 'turtle grass meadow', near: () => T.turtleNear, far: () => T.turtleFar, gap: -0.36, dens: 1.1,
    label: 'Turtle grass', fact: 'Seagrass meadows are nurseries: young conch, snapper and spiny lobster hide among the blades.' },
  { name: 'eelgrass meadow', near: () => T.eelNear, far: () => T.eelFar, gap: -0.3, dens: 0.95,
    label: 'Eelgrass', fact: 'Eelgrass is a flowering plant, not a seaweed: it even pollinates underwater.' },
  { name: 'seagrass with sand channels', near: () => [T.grassNear[0], T.grassNear[1], T.eelNear[0]], far: () => [T.grassFar[0], T.eelFar[0]], gap: -0.26, dens: 1.0, channels: true,
    label: 'Seagrass', fact: 'Seagrasses descend from land plants that returned to the sea some 70-100 million years ago.' },
];
function community(ctx) {
  const seg = ctx.segments.find((g) => g.key === 'seagrass');
  return seg ? COMMUNITIES[Math.floor(mulberry32(seg.seed ^ 0x5ea9)() * COMMUNITIES.length)] : COMMUNITIES[0];
}

// grass patches on a jittered grid within [d0, d1] of the path; every blade base is seated on the floor
function grassField(ctx, fs, insts, rng, d0, d1, step, comm, sA = ctx.s0, sB = ctx.s1) {
  const k = comm.dens * Math.sqrt(tierK(ctx)); // low tiers thin the meadow less than other props: it IS the zone
  for (let s = (Math.ceil(sA / step - 0.5) + 0.5) * step; s < sB; s += step) { // rows on a global lattice: windows join seamlessly
    const w = ctx.weightOf(s, 'seagrass');
    if (w <= 0) continue;
    const px = ctx.pathX(s), py = ctx.pathY(s);
    for (let side = -1; side <= 1; side += 2) {
      for (let d = d0; d < d1; d += step) {
        if (rng() > w * k) continue;
        const ss = s + (rng() - 0.5) * step, x = px + side * (d + rng() * step);
        const m = meadow(x, ss) - (comm.channels ? 0.6 * channel(x, ss) : 0);
        if (m < comm.gap) continue; // sand patch
        const dens = sstep(comm.gap, comm.gap + 0.08, m); // dense beds with crisp sandy gaps
        if (rng() > dens) continue;
        const ins = insts[(rng() * insts.length) | 0], tpl = ins.tpl;
        const y0 = fs.at(x, ss);
        const sc = (0.85 + 0.25 * dens) * (0.85 + rng() * 0.3), sy = sc * (0.85 + rng() * 0.4);
        // soft: only the lens radius around the camera line stays clear
        const dx = Math.abs(x - px) - tpl.r * sc, dy = py - (y0 + tpl.maxY * sy);
        if (dx < LENS && dy < LENS) continue;
        const steep = fs.ny < 0.93, R = orient(fs.nx, fs.ny, fs.nz, 0.8, rng() * TAU);
        const g = 0.85 + rng() * 0.3, yel = rng() * 0.15;
        ins.add(x, groundY(fs, x, ss, tpl, R, sc, sy, sc, !steep) - 0.025, -(ss - ctx.s0), R, sc, sy, sc, g * (1 + yel), g * (1 + yel * 0.4), g * (1 - yel * 0.5));
      }
    }
  }
}

export function layoutGrassNear(ctx) {
  if (presence(ctx, 'seagrass') <= 0) return null;
  const fs = floorSampler(ctx), rng = ctx.rng, comm = community(ctx);
  // one instanced set per half chunk: each half gets its own bounding sphere, so LOD and culling are finer
  const mk = () => comm.near().map((t) => new Inst(t, MAT.sway, Math.round(280 * budgetK(ctx, 'seagrass')), 'near'));
  const A = mk(), B = mk();
  if (ctx.addLabel) for (let k = 0; k < 6; k++) { const s = ctx.s0 + rng() * 64, x = ctx.pathX(s) + (rng() - 0.5) * 16; ctx.addLabel(comm.label, x, fs.at(x, s) + 0.35, s, comm.fact); }
  const h = ctx.s0 + 32;
  const more = [];
  for (let k = 0; k < 32; k++) { const a = ctx.s0 + k * 2, I = a < h ? A : B; more.push(() => grassField(ctx, fs, I, rng, 0, 9, 1.3, comm, a, a + 2)); }
  return { extra: [...A, ...B], batches: [], more };
}
export function layoutGrassFar(ctx) {
  if (presence(ctx, 'seagrass') <= 0) return null;
  const fs = floorSampler(ctx), rng = ctx.rng, comm = community(ctx);
  const insts = comm.far().map((t) => new Inst(t, MAT.sway, Math.round(420 * budgetK(ctx, 'seagrass')), 'mid'));
  const more = [];
  for (let k = 0; k < 18; k++) { const a = ctx.s0 + k * 3.6, b = k === 17 ? ctx.s1 : a + 3.6; more.push(() => grassField(ctx, fs, insts, rng, 9, 40, 2.6, comm, a, b)); }
  return { extra: insts, batches: [], more };
}
export function layoutSeagrassMisc(ctx) {
  if (presence(ctx, 'seagrass') <= 0) return null;
  const sp = specs(), fs = floorSampler(ctx), rng = ctx.rng, tk = tierK(ctx), bk = budgetK(ctx, 'seagrass');
  const st = new Batch(MAT.static, 8000 * bk), mid = new Batch(MAT.static, 10000 * bk * tk, 'mid'), near = new Batch(MAT.static, 12000 * bk * tk, 'near');
  const more = [];
  for (const b of bendSpots(ctx)) if (rng() < ctx.weightOf(b.s, 'seagrass') * 0.7) more.push(() => {
    const x = putBend(ctx, fs, st, sp.bendRock, b, rng);
    if (x !== null) for (let j = 0; j < 4; j++) putFloor(ctx, fs, mid, sp.rock, x + (rng() - 0.5) * 5, b.s + (rng() - 0.5) * 5, rng, 0.6);
  });
  // darker sediment under the dense beds (one draped disc per ~3 m cell where the meadow is thick)
  const bed = new Batch(MAT.static, 24000 * bk, 'mid'), comm = community(ctx);
  for (let r0 = 0; r0 < 64; r0 += 16) more.push(() => {
    for (let s = ctx.s0 + r0 + 1.5; s < ctx.s0 + r0 + 16; s += 3) {
      const w = ctx.weightOf(s, 'seagrass');
      if (w <= 0) continue;
      for (const side of [-1, 1]) for (let d = 0.5; d < 32; d += d < 9 ? 2.8 : 3.4) {
        if (rng() > w) continue;
        const ss = s + (rng() - 0.5) * 2, x = ctx.pathX(ss) + side * (d + rng() * 2);
        if (meadow(x, ss) - (comm.channels ? 0.6 * channel(x, ss) : 0) < comm.gap + 0.12) continue;
        putFloor(ctx, fs, bed, sp.bed, x, ss, rng);
      }
    }
  });
  more.push(...microSteps(ctx, fs, near, rng, 'seagrass', sp.micro, 70, 26, 25));
  const nextP148 = clusterer(ctx, rng, 0, 30, 1.2);
  more.push(...steps(Math.round(110 * tk), 22, () => {
    const p = nextP148();
    if (!p || rng() > ctx.weightOf(p.s, 'seagrass')) return;
    const e = pickW(rng, sp.list);
    putFloor(ctx, fs, e.k === 'rock' ? mid : near, sp[e.k], p.x, p.s, rng);
  }));
  // rare delight: a message in a bottle, half buried in a sandy gap
  if (rng() < 0.06) {
    for (let t = 0; t < 12; t++) {
      const p = spot(ctx, rng, 2.5, 12, 1.4);
      if (meadow(p.x, p.s) > -0.3) continue;
      if (putFloor(ctx, fs, st, sp.bottle, p.x, p.s, rng)) break;
    }
  }
  return { batches: [st, bed, mid, near], more };
}
