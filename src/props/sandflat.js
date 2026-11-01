// Sand flats: rippled turquoise plain with dense small life (shells, sand dollars, sea pens, stars,
// cucumbers, conchs, grass tufts, coral rubble, shell grit, garden-eel burrow colonies), occasional
// coral heads / rocks, and rock outcrops or big coral heads on the outside of bends to steer around.
import { Builder, Batch, T, TAU, sat, lerp, vn3, floorSampler, presence, budgetK, bendSpots, vary, tierK, poi } from './core.js';
import { grassPatch } from './shapes.js';
import { putFloor, putAt, pickW, tintFrom, spot, putBend, bendX, microDetail, microSteps, steps, clusterer } from './scatter.js';
import { bommie } from './reef.js';
import { MAT } from './materials.js';
import { mulberry32, noise2 } from '../noise.js';

function seaPen(seed) {
  const b = new Builder(), rng = mulberry32(seed), H = 0.3 + 0.06 * (seed % 5);
  b.tube([[0, -0.05, 0], [0, H * 0.4, 0], [0.01, H, 0.01]], [0.012, 0.01, 0.006], 4, (v, a, x, y, z, o) => {
    o[3] = 0.9; o[4] = 0.75; o[5] = 0.55; o[6] = 0.03 * v * v; o[7] = 6;
  });
  for (let k = 0; k < 9; k++) {
    const y = H * (0.42 + 0.06 * k), w = 0.07 * Math.sin(((k + 1) / 10) * Math.PI) + 0.02;
    for (const sd of [-1, 1]) {
      b.grid(1, 2, (u, v, i, j, o) => {
        o[0] = sd * v * w; o[1] = y + v * 0.025 + (u - 0.5) * 0.03; o[2] = (u - 0.5) * 0.015 + 0.01 * v;
        const t = sat(y / H); o[3] = 1.0; o[4] = 0.55 + 0.25 * v; o[5] = 0.3; o[6] = 0.03 * t * t + 0.01; o[7] = 6;
      });
    }
  }
  b.label = 'Sea pen'; b.fact = 'Each sea pen is a colony of polyps, and many species glow green at night when disturbed.';
  return b.build();
}

function burrows(seed, { n = 9, r = 1.4 } = {}) {
  const b = new Builder(), rng = mulberry32(seed);
  for (let k = 0; k < n; k++) {
    const rr = r * Math.sqrt(rng()), a = rng() * TAU, cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, s = 0.8 + rng() * 0.5;
    const v0 = b.vc;
    b.lathe(9, 4, (v) => [lerp(0.16, 0.018, v), v < 0.75 ? 0.05 * Math.sin((v / 0.75) * Math.PI * 0.5) : 0.05 - (v - 0.75) * 0.25], null,
      (v, ang, x, y, z, o) => { const c = v > 0.8 ? 0.15 : 0.85 + 0.1 * Math.sin(ang * 3); o[3] = 0.92 * c; o[4] = 0.86 * c; o[5] = 0.72 * c; o[7] = 2; });
    b.xform(v0, [1, 0, 0, 0, 1, 0, 0, 0, 1], cx, 0, cz, s, s, s);
  }
  b.label = 'Garden eel burrows'; b.fact = 'Garden eels almost never leave their burrows: they sway in the current, snatching plankton.';
  return b.build();
}

export function initSandflat() {
  T.seaPen = vary([1, 2, 3, 4, 5, 6, 7, 8].map(seaPen), 2, 51, { disp: 0.05, bend: 0.2, twist: 0.3 });
  T.burrows = vary([1, 2, 3, 4].map((s) => burrows(s, { n: 4 + s * 3, r: 0.8 + s * 0.4 })), 2, 61, { disp: 0.05, bend: 0, twist: 0.6 });
  T.tuft = [1, 2, 3, 4, 5, 6].map((k) => grassPatch(900 + k, { n: 4 + k, r: 0.12 + 0.03 * k, h: 0.22 + 0.05 * k, w: 0.025 + 0.003 * k, segs: 2, base: [0.1, 0.18, 0.05], mid: [0.3, 0.55, 0.15], tipc: [0.6, 0.6, 0.25], sway: 0.25 }));
}

const S = {};
function specs() {
  if (S.pen) return S;
  const shell = tintFrom([[1.0, 0.92, 0.82], [1.05, 0.75, 0.6], [0.9, 0.85, 0.8]], 0.12);
  Object.assign(S, {
    pen: { tpl: T.seaPen, scale: [0.7, 1.4], follow: 0.6, sway: true, tint: tintFrom([[1.1, 0.75, 0.6], [1.0, 0.95, 0.85], [1.1, 0.5, 0.35]]) },
    burrow: { tpl: T.burrows, scale: [0.8, 1.3], follow: 1, sink: 0.02, tint: tintFrom([[1, 0.97, 0.9]], 0.06) },
    tuft: { tpl: T.tuft, scale: [0.7, 1.5], follow: 0.8, sway: true, tint: tintFrom([[1, 1, 1], [1.1, 1.05, 0.8]]) },
    conch: { tpl: T.conch, scale: [0.18, 0.32], follow: 0.9, sink: 0.12, tint: shell },
    scallop: { tpl: T.scallop, scale: [0.12, 0.2], follow: 0.95, tint: shell },
    dollar: { tpl: T.sandDollar, scale: [0.07, 0.11], follow: 1, sink: 0.3, tint: shell },
    cucumber: { tpl: T.cucumber, scale: [0.6, 1.2], follow: 0.95, tint: tintFrom([[1, 1, 1], [0.6, 0.6, 0.6], [1.4, 1.1, 0.8]]) },
    star: { tpl: [...T.star, ...T.cushion], scale: [0.12, 0.24], follow: 1, sink: 0, tint: tintFrom([[1.1, 0.4, 0.08], [1.0, 0.75, 0.2], [0.9, 0.15, 0.12], [0.5, 0.3, 0.8]]) },
    rubble: { tpl: T.rubble, scale: [0.8, 1.6], follow: 1, sink: 0.02, tint: tintFrom([[1, 0.97, 0.9], [0.9, 0.85, 0.8]], 0.08) },
    grit: { tpl: T.grit, scale: [0.8, 1.6], follow: 1, sink: 0.01, tint: tintFrom([[1, 0.97, 0.92]], 0.08) },
    algae: { tpl: T.algae, scale: [0.5, 1.4], follow: 1, sink: 0.01, tint: tintFrom([[0.8, 0.85, 0.6], [0.9, 0.75, 0.55]], 0.1) },
    rock: { tpl: T.rocks, scale: [0.4, 1.4], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.5, tint: tintFrom([[0.68, 0.62, 0.52], [0.6, 0.58, 0.54]]) },
    // steer-around outcrop: a low, broad boulder mound (live pool), never a lone spire on open sand
    outcrop: { tpl: T.mound, scale: [1.2, 1.9], ys: [0.55, 0.85], xz: 0.5, grow: [0.3, 0.9], follow: 0.25, sink: 0.2, tint: tintFrom([[0.65, 0.58, 0.5], [0.58, 0.55, 0.5]]) },
  });
  S.micro = [
    { w: 3, spec: S.grit }, { w: 2.2, spec: S.rubble }, { w: 1.6, spec: S.dollar }, { w: 1.2, spec: S.scallop }, { w: 1, spec: S.conch },
    { w: 1.2, spec: S.star }, { w: 1, spec: S.cucumber }, { w: 0.8, spec: S.algae }, { w: 0.6, spec: S.burrow },
  ];
  S.soft = [{ w: 3, spec: S.tuft }, { w: 1.6, spec: S.pen }];
  S.bottle = { tpl: T.bottle, scale: [1, 1.15], follow: 0.9, sink: 0.5, tint: tintFrom([[1, 1, 1]], 0.08) };
  return S;
}

export function layoutSandflat(ctx) {
  if (presence(ctx, 'sandflat') <= 0) return null;
  const sp = specs(), rng = ctx.rng, fs = floorSampler(ctx), bk = budgetK(ctx, 'sandflat'), tk = tierK(ctx);
  const st = new Batch(MAT.static, 24000 * bk);                                    // pinnacles, coral heads, rocks
  const mid = { st: new Batch(MAT.static, 30000 * bk * tk, 'mid'), sw: new Batch(MAT.sway, 14000 * bk * tk, 'mid') }; // colonies
  const near = new Batch(MAT.static, 80000 * bk * tk, 'near'), nsw = new Batch(MAT.sway, 40000 * bk * tk, 'near'); // small life
  const head = { mid, near: { st: near, sw: nsw } }, more = [];
  // steer-around features on the outside of bends: a big coral head, or a low rock outcrop with rubble at its foot
  for (const b of bendSpots(ctx)) {
    if (rng() > ctx.weightOf(b.s, 'sandflat') * 0.8) continue;
    if (rng() < 0.4) more.push(() => {
      const x = putBend(ctx, fs, st, sp.outcrop, b, rng);
      if (x === null) return;
      for (let j = 0; j < 5; j++) putFloor(ctx, fs, j < 2 ? st : near, j < 2 ? sp.rock : sp.rubble, x + (rng() - 0.5) * 6, b.s + (rng() - 0.5) * 6, rng, j < 2 ? 0.6 : 1.2);
    });
    else { const x = bendX(ctx, b, 3.6, rng); more.push(...bommie(ctx, fs, st, mid.sw, rng, x, b.s, 1.2, 9, 1.05, null, head)); }
  }
  // occasional coral heads / rocks out on the flat
  for (let k = 0; k < 4; k++) {
    const p = spot(ctx, rng, 7, 34, 1);
    if (rng() > ctx.weightOf(p.s, 'sandflat') * 0.7) continue;
    if (rng() < 0.6) more.push(...bommie(ctx, fs, st, mid.sw, rng, p.x, p.s, 0.8, 5, 0.9, null, head));
    else more.push(() => putFloor(ctx, fs, st, sp.rock, p.x, p.s, rng, 1.5));
  }
  // garden-eel colonies: clusters of burrows (the eels themselves are creatures that gather at the POI)
  for (let k = 0; k < 3; k++) {
    const p = spot(ctx, rng, 0, 28, 1);
    if (rng() > ctx.weightOf(p.s, 'sandflat') * 0.6) continue;
    more.push(() => {
      let n = 0;
      for (let j = 0; j < 5; j++) if (putFloor(ctx, fs, near, sp.burrow, p.x + (rng() - 0.5) * 5, p.s + (rng() - 0.5) * 5, rng)) n++;
      if (n >= 2) poi(ctx, 'garden-eel-field', p.x, fs.at(p.x, p.s) + 0.4, p.s, 4, { burrows: n });
    });
  }
  // dense small life everywhere, including under the camera; patchy via noise
  more.push(...microSteps(ctx, fs, near, rng, 'sandflat', sp.micro, 420, 32, 15));
  const nextP99 = clusterer(ctx, rng, 0, 30, 1.2);
  more.push(...steps(Math.round(260 * tk), 26, () => {
    const p = nextP99();
    if (!p) return;
    const w = ctx.weightOf(p.s, 'sandflat') * (0.4 + 0.6 * Math.max(0, noise2(p.x / 9, p.s / 9, 931) + 0.4));
    if (rng() > w) return;
    const e = pickW(rng, sp.soft);
    putFloor(ctx, fs, nsw, e.spec, p.x, p.s, rng);
  }));
  // rare delight: a message in a bottle, half buried in the sand
  if (rng() < 0.05) for (let t = 0; t < 6; t++) { const p = spot(ctx, rng, 2.5, 10, 1.3); if (putFloor(ctx, fs, st, sp.bottle, p.x, p.s, rng)) break; }
  return { batches: [st, mid.st, mid.sw, near, nsw], more };
}
