// Drowned trees for the sunken forest, built as generators (sliced by rock_gen.js palettes, or drained at
// startup): standing conifer snags with whorls of dead branch stubs, gnarled broadleaf skeletons,
// buttressed cypress, snapped and forked trunks, fallen logs and stumps. Every template carries
//   obs   : creature capsules (template space), spine: [x, y, z, r, ...] skeleton for flight-tube tests,
//   root  : base points (trunk foot + root tips) used to seat it into the silt.
// Bark uses the nb2 bark material (aFx = parametric bark coordinates); vertex colours carry the wood tone,
// pale bleached wood, dark wet patches and blotches of encrusting life.
import { Builder, TAU, vn3, sat, sstep, lerp } from './core.js';
import { mulberry32 } from '../noise.js';
import { barkTube } from './nb2_common.js';
import { setBase } from './nb_common.js';

const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const WOOD = [[0.5, 0.45, 0.38], [0.42, 0.36, 0.29], [0.55, 0.52, 0.47], [0.36, 0.3, 0.24], [0.47, 0.44, 0.4]];
const ENC = [[0.95, 0.42, 0.08], [0.9, 0.78, 0.2], [0.55, 0.2, 0.55], [0.85, 0.85, 0.78], [0.3, 0.42, 0.18]];

// colour of the wood at a template point: base tone, bleached crests up high, dark wet base, encrusting blotches
function woodPainter(rng, seed, H) {
  const base = WOOD[(rng() * WOOD.length) | 0], k = 0.9 + rng() * 0.2, enc = ENC[(rng() * ENC.length) | 0], enc2 = ENC[(rng() * ENC.length) | 0];
  const encAmt = 0.3 + rng() * 0.5;
  return (x, y, z, o) => {
    const t = sat(y / Math.max(1, H));
    const n = vn3(x * 1.3, y * 0.6, z * 1.3, seed), m = vn3(x * 3.1, y * 2.2, z * 3.1, seed + 5);
    let r = base[0] * k * (0.85 + 0.25 * n), g = base[1] * k * (0.85 + 0.25 * n), b = base[2] * k * (0.85 + 0.25 * n);
    const wet = (1 - sstep(0, 0.12, t)) * 0.35; r *= 1 - wet; g *= 1 - wet; b *= 1 - wet * 0.8;
    const bleach = sstep(0.55, 1, t) * 0.25 * (0.5 + 0.5 * n); r += bleach * 0.4; g += bleach * 0.4; b += bleach * 0.38;
    // encrusting sponge / tunicate blotches, mostly low and mid trunk
    const e = sstep(0.38, 0.62, m) * encAmt * (1 - sstep(0.5, 0.9, t)), c = n > 0 ? enc : enc2;
    o[0] = lerp(r, c[0] * 0.8, e); o[1] = lerp(g, c[1] * 0.8, e); o[2] = lerp(b, c[2] * 0.8, e);
  };
}

// capsules and spine helpers
function addCap(caps, a, c, r) { caps.push([a[0], a[1], a[2], c[0], c[1], c[2], r]); }
function addSpine(sp, pts, radii, every = 2) { for (let i = 0; i < pts.length; i += every) sp.push(pts[i][0], pts[i][1], pts[i][2], radii[i]); const l = pts.length - 1; sp.push(pts[l][0], pts[l][1], pts[l][2], radii[l]); }

// a branch from p along dir (with droop / wiggle); returns its points and radii
function limb(rng, p, dir, len, r0, r1, segs, { droop = 0, wig = 0.15, up = 0 } = {}) {
  const pts = [p], radii = [r0];
  let d = nrm(dir), c = p;
  for (let i = 1; i <= segs; i++) {
    d = nrm([d[0] + (rng() - 0.5) * wig, d[1] + (rng() - 0.5) * wig * 0.6 - droop / segs + up / segs, d[2] + (rng() - 0.5) * wig]);
    c = [c[0] + d[0] * len / segs, c[1] + d[1] * len / segs, c[2] + d[2] * len / segs];
    pts.push(c); radii.push(lerp(r0, r1, i / segs));
  }
  return { pts, radii, dir: d };
}

// surface roots flaring from the trunk foot into the silt; returns their tip points (for seating)
function roots(b, rng, paint, r0, n, reach, tips, caps) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + (rng() - 0.5) * 0.7, L = reach * (0.6 + 0.6 * rng()), ca = Math.cos(a), sa = Math.sin(a);
    const pts = [], radii = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4, d = r0 * 0.55 + L * t;
      pts.push([ca * d, 0.35 * r0 * (1 - t) * (1 - t) + 0.12 - 0.34 * t * t - 0.02, sa * d]);
      radii.push(lerp(r0 * 0.5, r0 * 0.12, t));
    }
    barkTube(b, pts, radii, 5, { col: (j, ang, x, y, z, o) => paint(x, y, z, o), cap: false });
    tips.push(pts[3][0], pts[3][1] - radii[3] * 0.8, pts[3][2], pts[4][0], pts[4][1] - radii[4] * 0.5, pts[4][2]);
    if (L > 1.1 && radii[1] > 0.12) addCap(caps, pts[0], pts[3], radii[1] * 1.1);
  }
}

// Standing trees. kind: 'snag' | 'broad' | 'cypress' | 'broken' | 'fork'. Heights are template metres
// (placement scales them ~0.8-1.25).
export function* treeG(seed, kind = 'snag', { tier = 'medium' } = {}) {
  const rng = mulberry32(seed * 7907 + 31), b = new Builder(), caps = [], spine = [], tips = [];
  const fine = tier === 'high' || tier === 'ultra' ? 1 : tier === 'low' ? -1 : 0;
  let H, r0;
  if (kind === 'snag') { H = 7 + rng() * 4.5; r0 = 0.24 + rng() * 0.16; }
  else if (kind === 'broad') { H = 3 + rng() * 2; r0 = 0.3 + rng() * 0.15; }
  else if (kind === 'cypress') { H = 6 + rng() * 4; r0 = 0.32 + rng() * 0.14; }
  else if (kind === 'broken') { H = 2.4 + rng() * 3.2; r0 = 0.32 + rng() * 0.2; }
  else { H = 2.2 + rng() * 2.2; r0 = 0.3 + rng() * 0.12; } // fork
  const paint = woodPainter(rng, seed, kind === 'broad' || kind === 'fork' ? H * 2.2 : H);
  const col = (j, ang, x, y, z, o) => paint(x, y, z, o);
  // trunk line: lean + gentle sweep, buried 0.4 m
  const lean = [(rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12], sw = rng() * TAU, swA = 0.15 + rng() * 0.25;
  const nR = Math.max(6, Math.round(H / 0.42)), radial = (kind === 'snag' ? 10 : 12) + fine * 2;
  const P = (t) => [lean[0] * t * H + Math.sin(t * 2.4 + sw) * swA * t, -0.4 + t * (H + 0.4), lean[1] * t * H + Math.cos(t * 2.1 + sw) * swA * t];
  const flareK = kind === 'cypress' ? 1.6 + rng() * 0.8 : kind === 'broken' ? 0.5 : 0.35, lobes = kind === 'cypress' ? 5 + Math.floor(rng() * 3) : 0;
  const top = kind === 'snag' ? 0.2 + rng() * 0.18 : kind === 'cypress' ? 0.45 : kind === 'broken' ? 0.8 : 0.75;
  const R = (t) => r0 * lerp(1, top, Math.pow(t, 0.9)) * (1 + flareK * Math.exp(-Math.max(0, t * (H + 0.4) - 0.4) / (kind === 'cypress' ? 0.9 : 0.5)));
  const pts = [], radii = [];
  for (let i = 0; i <= nR; i++) { const t = i / nR; pts.push(P(t)); radii.push(R(t)); }
  const ox = rng() * 20;
  const rad = (j, ang, r) => {
    const t = j / nR, y = t * H;
    let f = 1 + 0.07 * vn3(Math.cos(ang) * 1.3 + ox, y * 0.8, Math.sin(ang) * 1.3, seed) + 0.03 * vn3(Math.cos(ang) * 4, y * 3, Math.sin(ang) * 4, seed + 1);
    if (lobes) f *= 1 + 0.35 * Math.max(0, Math.cos(ang * lobes + vn3(ang, 0, 0, seed) * 2)) * Math.exp(-Math.max(0, y) / 1.2); // fluted buttresses
    return r * f;
  };
  const broken = kind === 'snag' || kind === 'broken' || kind === 'cypress';
  barkTube(b, pts, radii, radial, { col, rad, cap: true, jag: broken ? r0 * (kind === 'snag' ? 0.8 : 1.4) : 0, rng });
  addSpine(spine, pts, radii, 2);
  // trunk capsules in ~2 m pieces
  // creature capsules along the trunk in ~3 m pieces (the flared foot gets its own, fatter one)
  addCap(caps, pts[0], pts[Math.min(nR, 2)], Math.max(radii[0], radii[Math.min(nR, 2)]) * (1 + flareK * 0.2));
  for (let i = 2; i < nR; i += 7) { const j = Math.min(nR, i + 7); addCap(caps, pts[i], pts[j], Math.max(radii[i], radii[j]) * 1.08 + 0.03); }
  yield;
  // splinters on a snapped top
  if (kind === 'snag' || kind === 'broken') {
    const tp = pts[nR], rt = radii[nR];
    for (let k = 0, n = 2 + Math.floor(rng() * 3); k < n; k++) {
      const a = rng() * TAU, len = rt * (2 + rng() * 4);
      const base = [tp[0] + Math.cos(a) * rt * 0.6, tp[1] - rt * 0.5, tp[2] + Math.sin(a) * rt * 0.6];
      const L = limb(rng, base, [Math.cos(a) * 0.15, 1, Math.sin(a) * 0.15], len, rt * 0.3, rt * 0.04, 2, { wig: 0.2 });
      barkTube(b, L.pts, L.radii, 4, { col });
    }
  }
  // branches
  const limbs = [];
  if (kind === 'snag') { // whorls of short dead stubs, longer and drooping lower down, a few twigs
    const y0 = 1.2 + rng() * 2.2;
    for (let y = y0; y < H - 0.3; y += 0.32 + rng() * 0.35) {
      const t = y / H, n = 2 + Math.floor(rng() * 3), a0 = rng() * TAU, i = Math.round(t * nR);
      for (let k = 0; k < n; k++) {
        if (rng() < 0.25) continue;
        const a = a0 + (k / n) * TAU + (rng() - 0.5) * 0.6, out = [Math.cos(a), -0.15 - rng() * 0.45, Math.sin(a)];
        const brk = rng() < 0.45, len = (brk ? 0.12 + rng() * 0.35 : 0.4 + rng() * 1.2) * Math.pow(1 - t, 0.4) + 0.08;
        const rb = Math.max(0.018, radii[i] * (0.18 + rng() * 0.12)), p = P(t);
        const st = [p[0] + Math.cos(a) * radii[i] * 0.5, p[1], p[2] + Math.sin(a) * radii[i] * 0.5];
        limbs.push({ L: limb(rng, st, out, len + radii[i] * 0.5, rb, rb * (brk ? 0.7 : 0.25), len > 0.5 ? 2 : 1, { droop: 0.25, wig: 0.25 }), rad: 4, twig: !brk && len > 0.7 });
      }
    }
  } else if (kind === 'broad' || kind === 'fork') { // a few big gnarled limbs forking upward, broken ends
    const nL = kind === 'fork' ? 2 : 2 + Math.floor(rng() * 3), tp = pts[nR];
    for (let k = 0; k < nL; k++) {
      const a = (k / nL) * TAU + rng() * 0.8, spread = kind === 'fork' ? 0.25 + rng() * 0.2 : 0.45 + rng() * 0.5;
      const len = kind === 'fork' ? 4 + rng() * 3.5 : 2.4 + rng() * 2.6, rb = radii[nR] * (kind === 'fork' ? 0.85 : 0.6 + rng() * 0.2);
      const L = limb(rng, [tp[0], tp[1] - rb * 0.6, tp[2]], [Math.cos(a) * spread, 1, Math.sin(a) * spread], len, rb, rb * (0.35 + rng() * 0.2), 4, { wig: 0.35, droop: kind === 'broad' ? 0.15 : 0 });
      limbs.push({ L, rad: 7 + fine, cap: true, main: true });
      // secondary branches
      for (let q = 0, nq = 1 + Math.floor(rng() * 3); q < nq; q++) {
        const ji = 2 + Math.floor(rng() * 2), p = L.pts[ji], d = L.dir, aa = rng() * TAU;
        const dir = nrm([d[0] + Math.cos(aa) * 0.9, d[1] * 0.6 + 0.15, d[2] + Math.sin(aa) * 0.9]);
        const l2 = len * (0.35 + rng() * 0.35), r2 = L.radii[ji] * 0.55;
        limbs.push({ L: limb(rng, p, dir, l2, r2, r2 * 0.3, 3, { wig: 0.4, droop: 0.1 }), rad: 5, cap: rng() < 0.6, twig: true });
      }
    }
    // a couple of low dead limbs / stubs on the trunk
    for (let k = 0, n = Math.floor(rng() * 3); k < n; k++) {
      const t = 0.35 + rng() * 0.5, i = Math.round(t * nR), p = P(t), a = rng() * TAU;
      limbs.push({ L: limb(rng, [p[0], p[1], p[2]], [Math.cos(a), 0.1 + rng() * 0.3, Math.sin(a)], 0.4 + rng() * 0.8, radii[i] * 0.3, radii[i] * 0.2, 2, { wig: 0.2 }), rad: 5, cap: true });
    }
  } else { // cypress / broken: few short limbs near the top
    const n = kind === 'cypress' ? 2 + Math.floor(rng() * 4) : Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const t = (kind === 'cypress' ? 0.6 : 0.4) + rng() * (kind === 'cypress' ? 0.35 : 0.5), i = Math.min(nR, Math.round(t * nR)), p = P(t), a = rng() * TAU;
      const len = kind === 'cypress' ? 0.8 + rng() * 1.8 : 0.3 + rng() * 0.7;
      limbs.push({ L: limb(rng, [p[0], p[1], p[2]], [Math.cos(a), 0.2 + rng() * 0.5, Math.sin(a)], len + radii[i] * 0.5, radii[i] * 0.32, radii[i] * 0.15, 3, { wig: 0.3 }), rad: 5, cap: true, twig: kind === 'cypress' });
    }
  }
  let nb = 0;
  for (const e of limbs) {
    const { pts: lp, radii: lr } = e.L;
    barkTube(b, lp, lr, e.rad, { col, cap: !!e.cap, jag: e.cap ? lr[lr.length - 1] * 0.8 : 0, rng });
    addSpine(spine, lp, lr, 1);
    // creature capsules: limbs, and only the longer stubs (fish thread between the short ones)
    const reach = Math.hypot(lp[lp.length - 1][0] - lp[0][0], lp[lp.length - 1][1] - lp[0][1], lp[lp.length - 1][2] - lp[0][2]);
    if (lr[0] > 0.06 || e.main) addCap(caps, lp[0], lp[lp.length - 1], Math.max(lr[0], 0.08) * 1.15);
    else if (reach > 1.3) addCap(caps, lp[0], lp[lp.length - 1], 0.1);
    if (e.twig) { // a few thin twigs off the end
      const tp = lp[lp.length - 1], d = e.L.dir;
      for (let q = 0, nq = 1 + Math.floor(rng() * 3); q < nq; q++) {
        const aa = rng() * TAU, dir = nrm([d[0] + Math.cos(aa) * 0.8, d[1] + 0.2, d[2] + Math.sin(aa) * 0.8]);
        const T = limb(rng, tp, dir, 0.3 + rng() * 0.6, lr[lr.length - 1] * 0.7, 0.008, 2, { wig: 0.5 });
        barkTube(b, T.pts, T.radii, 3, { col });
        addSpine(spine, T.pts, T.radii, 1);
      }
    }
    if (++nb % 6 === 0) yield;
  }
  // roots into the silt
  const nRoot = kind === 'cypress' ? 6 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 3);
  roots(b, rng, paint, r0 * (1 + flareK * 0.3), nRoot, kind === 'cypress' ? 1.4 + rng() * 0.8 : 0.7 + rng() * 0.7, tips, caps);
  yield;
  const t = b.build();
  // seat on the trunk foot (ring at y = 0) and the root tips
  const base = [];
  const rf = R(0.4 / (H + 0.4)) * 0.92;
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; base.push(Math.cos(a) * rf, 0, Math.sin(a) * rf); }
  setBase(t, base.concat(tips));
  t.obs = caps; t.spine = Float32Array.from(spine); t.kind = kind; t.H = t.maxY;
  t.label = LABEL[kind]; t.fact = FACT[kind](rng);
  t.solid = true;
  return t;
}
const LABEL = { snag: 'Drowned conifer snag', broad: 'Drowned oak', cypress: 'Drowned cypress', broken: 'Snapped trunk', fork: 'Drowned forked tree' };
const FACT = {
  snag: (r) => (r() < 0.5 ? 'Cold, oxygen-poor water slows decay: drowned forests can stand for centuries.' : 'Its needles and bark are long gone; the branch stubs show where whorls of branches grew each year.'),
  broad: (r) => (r() < 0.5 ? 'This forest drowned when the land sank or the water rose; the trees died standing.' : 'Wood-boring shipworms and gribbles slowly honeycomb drowned timber.'),
  cypress: (r) => (r() < 0.5 ? 'Off Alabama, a 60,000-year-old cypress forest lies buried and preserved under the sea floor.' : 'Cypress trunks flare into buttresses that steady them in soft, waterlogged ground.'),
  broken: (r) => (r() < 0.5 ? 'Storms and ice snap the weakened trunks; the stumps can stand for centuries.' : 'Drowned wood becomes a reef: every surface is soon claimed by sponges, mussels and anemones.'),
  fork: () => 'Two leaders grew from one trunk: a fork the tree carried until the water came.',
};

// Fallen log lying along local x (resting on y = 0), with branch stubs, sometimes its root plate.
export function* logG(seed, { tier = 'medium' } = {}) {
  const rng = mulberry32(seed * 6151 + 3), b = new Builder(), caps = [], spine = [];
  const L = 3.5 + rng() * 6, r0 = 0.18 + rng() * 0.2, r1 = r0 * (0.45 + rng() * 0.3), sag = (rng() - 0.5) * 0.1, bend = (rng() - 0.5) * 0.5;
  const paint = woodPainter(rng, seed, 1.0), col = (j, ang, x, y, z, o) => paint(x, y * 0.3, z, o);
  const n = Math.max(6, Math.round(L / 0.45)), pts = [], radii = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, r = lerp(r0, r1, t);
    pts.push([t * L - L / 2, r * 0.92 + sag * Math.sin(t * Math.PI), bend * Math.sin(t * Math.PI) * L * 0.1]); radii.push(r);
  }
  const ox = rng() * 20;
  // flattened underside where it settled into the silt
  const rad = (j, ang, r) => r * (1 + 0.06 * vn3(Math.cos(ang) + ox, j * 0.4, Math.sin(ang), seed));
  barkTube(b, pts, radii, 10 + (tier === 'high' || tier === 'ultra' ? 2 : 0), { col, rad, cap: true, jag: r1 * 0.9, rng });
  // butt end: root plate (upturned) or a clean/ragged end cap
  const rootPlate = rng() < 0.4;
  if (rootPlate) {
    const p0 = pts[0], nr = 7 + Math.floor(rng() * 5);
    for (let k = 0; k < nr; k++) {
      const a = (k / nr) * TAU + rng() * 0.4, d = nrm([-0.35 - rng() * 0.3, Math.sin(a), Math.cos(a)]);
      const len = r0 * (2.5 + rng() * 3), Lb = limb(rng, [p0[0] + 0.1, p0[1], p0[2]], d, len, r0 * 0.38, 0.015, 3, { wig: 0.5, droop: 0.15 });
      for (const q of Lb.pts) q[1] = Math.max(q[1], 0.02 + 0.3 * r0 * 0.1);
      barkTube(b, Lb.pts, Lb.radii, 4, { col });
      addSpine(spine, Lb.pts, Lb.radii, 1);
    }
  } else { // butt end cap
    const p0 = pts[0], r = radii[0], c0 = b.vc, nrad = 10;
    const ce = b.v(p0[0] - 0.02, p0[1], p0[2], -1, 0, 0, 0.6, 0.5, 0.4, 0, -50);
    for (let i = 0; i < nrad; i++) { const a = (i / nrad) * TAU; b.v(p0[0], p0[1] + Math.cos(a) * r, p0[2] + Math.sin(a) * r, -1, 0, 0, 0.5, 0.42, 0.33, r, -50); }
    for (let i = 0; i < nrad; i++) b.t(c0 + 1 + ((i + 1) % nrad), c0 + 1 + i, ce);
  }
  yield;
  // stubs on the upper half
  for (let k = 0, ns = 2 + Math.floor(rng() * 6); k < ns; k++) {
    const t = 0.15 + rng() * 0.8, i = Math.round(t * n), p = pts[i], a = (rng() - 0.5) * 2.4; // around the top (+y)
    const dir = [0.6 * (rng() - 0.5), Math.cos(a) * 0.8, Math.sin(a)], len = 0.12 + rng() * 0.55;
    const Lb = limb(rng, [p[0], p[1] + Math.cos(a) * radii[i] * 0.5, p[2] + Math.sin(a) * radii[i] * 0.5], dir, len + radii[i] * 0.5, radii[i] * 0.32, radii[i] * 0.26, 2, { wig: 0.3 });
    for (const q of Lb.pts) q[1] = Math.max(q[1], 0.03);
    barkTube(b, Lb.pts, Lb.radii, 5, { col, cap: true, jag: 0, rng });
    addSpine(spine, Lb.pts, Lb.radii, 1);
  }
  const t = b.build();
  // base: along the bottom line
  const base = [];
  for (let i = 0; i <= n; i += Math.max(1, Math.floor(n / 9))) base.push(pts[i][0], pts[i][1] - radii[i] * 0.92, pts[i][2]);
  base.push(pts[n][0], pts[n][1] - radii[n] * 0.92, pts[n][2]);
  setBase(t, base);
  for (let i = 0; i < n; i += 3) { const j = Math.min(n, i + 3); addCap(caps, pts[i], pts[j], Math.max(radii[i], radii[j]) * 1.08); }
  if (rootPlate) addCap(caps, [pts[0][0] - 0.2, pts[0][1], pts[0][2]], [pts[0][0] - 0.2, pts[0][1] + r0 * 3, pts[0][2]], r0 * 3);
  addSpine(spine, pts, radii, 2);
  t.obs = caps; t.spine = Float32Array.from(spine); t.kind = 'log'; t.len = L;
  t.label = rootPlate ? 'Fallen tree and root plate' : 'Fallen log';
  t.fact = rootPlate ? 'When a tree falls it levers up a plate of roots and soil, leaving a pit beside it.' : 'Sunken logs feed whole communities: wood-boring clams, crabs, and the fish that hunt them.';
  t.solid = true;
  return t;
}

// Stump: cut flat (logged before the flooding) or broken; flared roots.
export function* stumpG(seed) {
  const rng = mulberry32(seed * 4409 + 17), b = new Builder(), caps = [], tips = [];
  const H = 0.35 + rng() * 1.3, r0 = 0.25 + rng() * 0.35, cut = rng() < 0.45;
  const paint = woodPainter(rng, seed, 3), col = (j, ang, x, y, z, o) => paint(x, y, z, o);
  const pts = [], radii = [];
  for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push([0, -0.3 + t * (H + 0.3), 0]); radii.push(r0 * (1 + 0.6 * Math.exp(-Math.max(0, t * (H + 0.3) - 0.3) / 0.35))); }
  const ox = rng() * 20;
  barkTube(b, pts, radii, 12, { col, cap: true, jag: cut ? 0 : r0 * 1.2, rng, rad: (j, ang, r) => r * (1 + 0.1 * vn3(Math.cos(ang) * 1.5 + ox, j, Math.sin(ang) * 1.5, seed)) });
  roots(b, rng, paint, r0 * 1.2, 4 + Math.floor(rng() * 4), 0.6 + rng() * 0.9, tips, caps);
  yield;
  const t = b.build(), base = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; base.push(Math.cos(a) * r0 * 1.3, 0, Math.sin(a) * r0 * 1.3); }
  setBase(t, base.concat(tips));
  addCap(caps, [0, 0, 0], [0, H, 0], r0 * 1.3);
  t.obs = caps; t.spine = Float32Array.from([0, H * 0.5, 0, r0 * 1.3]); t.kind = 'stump';
  t.label = cut ? 'Cut stump' : 'Broken stump';
  t.fact = cut ? 'Saw-cut stumps underwater tell of forests logged before the valley was flooded.' : 'Stumps of drowned forests can be dated by their growth rings to the year the water came.';
  t.solid = true;
  return t;
}

// drain a generator synchronously (startup fallbacks)
export function drainG(it) { let r; do r = it.next(); while (!r.done); return r.value; }
