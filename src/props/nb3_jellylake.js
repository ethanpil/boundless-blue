// Jellyfish Lake: an enclosed marine lake in a limestone island. Pale karst walls rise out of the green
// water at the sides, each cut at the waterline by a tidal notch with an overhanging visor, and headlands
// of the same karst jut toward the route (within the murky water's visibility); mangroves fringe the shore
// between them, their prop roots arching down into the shallows, crusted with sponges, sea squirts and the
// lake's white jellyfish-eating anemones; leaves float at the surface. Sunken trees lie on the bottom
// beside the route, limestone boulders carry little gardens of algae and white anemones, and the sunlit
// floor is carpeted with green algae (turf, cushions, streaming filaments, Halimeda, sea grapes, bubble
// algae) with leaf litter and sunken branches. Jellyfish are creatures (director.js).
import { Builder, Batch, TAU, presence, budgetK, CHUNK, vn3, sat, sstep, lerp, rotY, TUBE, LOW_GAP } from './core.js';
import { MAT } from './materials.js';
import { sv } from '../biomes.js';
import { pathCache, clearBox, clearSpine, SOLID, SOFT, seat, put, upTo, mix3, segFor, recipe, lowK, slice, nbFloor, decalDisc, builderMesh, NBMAT, setBase, xf } from './nb_common.js';
import { poolOf, planned, itemSpots, seatOnItem } from './nb2_common.js';
import { encrust, tunicates, bez } from './nb_shapes.js';
import { NB3, Space, chunkRng, pick, pickW, tint, rr, L, bakeInto } from './nb3_common.js';
import { lakeAnemones, drainG } from './nb3_anemones.js';
import { rockJob, drain } from './rock_recipes.js';
import { onRock } from './nb3_anemone.js';
import { mulberry32 } from '../noise.js';

const J = {};
const KEY = 'jellylake';
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ---------------------------------------------------------------- limestone wall with a tidal notch
// Template frame: x along the wall (length Lw), +z toward the lake (front face), y up. The base line of the
// front face is at the origin, the back at z = -D. The notch is centred just below template height yN, which
// placement maps to the water surface (the vertical scale is solved so the base is buried in the slope).
export function* limestoneWall(seed, { Lw = 12, D = 4.5, yN = 6, up = 3, notch = 1.5, lip = 0.5, lean = 0.06, under = 0.6, tier = 'high', tintC = [1, 1, 1] } = {}) {
  const rng = mulberry32(seed * 4241 + 17), b = new Builder(), lo = tier === 'low';
  const H = yN + up, yc = yN - 0.25, hnD = 0.55 + rng() * 0.3, hnU = 0.35 + rng() * 0.2, ox = rng() * 50, key = 6.05 + rng() * 0.9;
  const nu = lo ? 24 : 40, nB = lo ? 16 : 26;
  // front-face offset (toward the lake) at length coordinate x and height y: karst buttresses and bays,
  // ledges, solution pockets, the tidal notch with its visor above, an undercut foot
  const ledges = Array.from({ length: 3 + ((rng() * 3) | 0) }, () => [0.8 + rng() * (yN - 2.5), 0.4 + rng() * 0.6]);
  const pockets = Array.from({ length: 1 + ((rng() * 3) | 0) }, () => [(rng() - 0.5) * Lw * 0.8, 0.8 + rng() * (yN - 3), 0.7 + rng() * 1.1, 0.6 + rng() * 1.0]);
  const zf = (x, y) => {
    let z = lean * y + 1.3 * vn3(x * 0.17 + ox, y * 0.11, 0, seed) + 0.55 * vn3(x * 0.5 + ox, y * 0.42, 2, seed + 1) + 0.16 * vn3(x * 1.6 + ox, y * 1.5, 4, seed + 2);
    z += 0.55 * Math.max(0, Math.sin(x * 1.3 + 2.2 * vn3(x * 0.3, y * 0.12, 13, seed))) * (0.5 + 0.5 * vn3(x * 0.2, y * 0.2, 15, seed)); // karst ribs
    for (const [h, w] of ledges) z += w * sstep(h - 0.35, h, y) * (1 - sstep(h, h + 0.12, y)) * (0.6 + 0.4 * vn3(x * 0.4, h, 9, seed));
    for (const [px, py, rx, d] of pockets) { const q = ((x - px) / rx) ** 2 + ((y - py) / (rx * 0.7)) ** 2; if (q < 1) z -= d * sstep(1, 0.35, q); }
    const dy = y - yc;
    z -= notch * Math.exp(-((dy / (dy > 0 ? hnU : hnD)) ** 2)) * (0.75 + 0.35 * vn3(x * 0.3, 0, 11, seed)); // the tidal notch
    z += lip * sstep(yN + 0.25, yN + 0.7, y) * (1 - 0.6 * sstep(yN + 1.6, H, y));                       // overhanging visor
    z -= under * (1 - sat(y / 1.6)) ** 2;                                                               // undercut at the foot
    z -= 0.08 * Math.abs(Math.sin(x * 2.6 + 1.6 * vn3(x * 0.5, y * 0.2, 5, seed)));                      // dissolution flutes
    return z;
  };
  // closed profile loop (back-bottom -> front-bottom -> up the face -> over the top -> down the back)
  const prof = []; // [kind, t]
  prof.push(['bot', 0], ['bot', 1]);
  for (let i = 0; i <= nB; i++) prof.push(['face', i / nB]);
  for (let i = 1; i <= 3; i++) prof.push(['top', i / 4]);
  for (let i = 0; i <= 3; i++) prof.push(['back', i / 3]);
  const K = prof.length - 1;
  const lime = [1.45 * tintC[0], 1.4 * tintC[1], 1.22 * tintC[2]];
  b.grid(nu, K, (u, v, i, j, o) => {
    const [kind, t] = prof[j], x = (u - 0.5) * Lw, tl = 0.12 + 0.16 * (0.5 + 0.5 * vn3(u < 0.5 ? 1 : 3, t * 2.5, 21, seed)); // irregular, rounded ends
    const e = Math.pow(sstep(0, tl, u) * sstep(0, tl, 1 - u), 0.55);
    let y, z;
    let ao = 1;
    if (kind === 'bot') { y = 0; z = lerp(-D * e, zf(x, 0) * e, t); }
    else if (kind === 'face') { y = t * H * (0.35 + 0.65 * e); z = zf(x, y) * e; ao = 0.5 + 0.5 * sstep(-1.4, 0.7, z - lean * y); } // bays and pockets darker
    else if (kind === 'top') { y = H * (0.35 + 0.65 * e) + 0.3 * Math.sin(t * Math.PI); z = lerp(zf(x, H) * e, -D * e, t); }
    else { y = H * (0.35 + 0.65 * e) * (1 - t); z = -D * e + 0.2 * vn3(x * 0.5, y * 0.5, 7, seed); }
    o[0] = x; o[1] = y; o[2] = z;
    // colour: pale limestone, green-grey biofilm below the notch, a dark wet band in it, grey phytokarst above
    const n = 0.85 + 0.25 * vn3(x * 0.8 + ox, y * 0.8, z, seed + 3), st = sstep(0.2, 0.7, vn3(x * 2.1, y * 0.25, 0, seed + 9));
    let c = lime.slice();
    if (y < yN - 0.9) { const g = sstep(yN - 0.9, yN - 3, y); c = [lerp(c[0], 0.5, g * 0.6), lerp(c[1], 0.58, g * 0.6), lerp(c[2], 0.42, g * 0.6)]; }
    const band = Math.exp(-(((y - yc) / 0.6) ** 2));
    c = [lerp(c[0], 0.3, band * 0.75), lerp(c[1], 0.29, band * 0.75), lerp(c[2], 0.26, band * 0.75)];
    if (y > yN + 0.2) { c = [c[0] * (0.7 - 0.25 * st), c[1] * (0.7 - 0.25 * st), c[2] * (0.68 - 0.25 * st)]; }
    o[3] = c[0] * n * ao; o[4] = c[1] * n * ao; o[5] = c[2] * n * ao;
    o[6] = y < yN - 0.6 ? 0.85 : 0.1; o[7] = key;
  }, { flip: true });
  yield;
  const foot = []; // the front foot line (row 1 of the profile): placement buries the base below the floor under it
  for (let i = 0; i <= nu; i += 2) { const q = (nu + 1) + i; foot.push(b.P[q * 3], b.P[q * 3 + 2]); }
  const t = b.build();
  t.nbFoot = foot;
  t.label = 'Limestone wall';
  t.fact = 'Waves, boring sponges and grazing snails carve a notch into limestone at the waterline, undercutting the island.';
  t.nbYN = yN; t.nbD = D; t.nbLw = Lw; t.nbH = H;
  const obs = [];
  for (let k = 0; k < 4; k++) { const x = (k / 3 - 0.5) * Lw * 0.8; obs.push([x, 0.6, -D * 0.45, x, H - 0.6, -D * 0.45, D * 0.55 + 0.2]); }
  t.obs = obs;
  return t;
}

// ---------------------------------------------------------------- algae and small life
// Algal turf carpet (draped over the floor): dense short filaments, an irregular outline, a few tall tufts.
function turfCarpet(seed, { R = 1.2, n = 190, col = [0.12, 0.42, 0.08], tip = [0.45, 0.62, 0.15], tall = 14 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 3301 + 7), ph = rng() * TAU;
  const edge = (a) => R * (0.65 + 0.25 * Math.sin(a * 3 + ph) + 0.12 * Math.sin(a * 7 + ph * 2));
  const blade = (x, z, h, w, sway, c0, c1) => {
    const lean = rng() * TAU, la = 0.15 + rng() * 0.5, fx = Math.cos(lean + 1.57), fz = Math.sin(lean + 1.57), v0 = b.vc;
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, px = x + Math.cos(lean) * Math.sin(la) * h * t, py = h * t * Math.cos(la * t), pz = z + Math.sin(lean) * Math.sin(la) * h * t, ww = w * (1 - 0.7 * t);
      const c = [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
      b.v(px - fx * ww, py, pz - fz * ww, 0, 1, 0, c[0], c[1], c[2], sway * t * t, 0);
      b.v(px + fx * ww, py, pz + fz * ww, 0, 1, 0, c[0], c[1], c[2], sway * t * t, 0);
    }
    for (let i = 0; i < 2; i++) { const a = v0 + i * 2; b.t(a, a + 1, a + 2); b.t(a + 1, a + 3, a + 2); }
  };
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = edge(a) * Math.sqrt(rng()), x = Math.cos(a) * d, z = Math.sin(a) * d, k2 = 0.8 + 0.4 * rng();
    blade(x, z, 0.03 + 0.09 * rng() * (1 - 0.5 * d / R), 0.006 + rng() * 0.006, 0.02, [col[0] * 0.6 * k2, col[1] * 0.6 * k2, col[2] * 0.6 * k2], [tip[0] * k2, tip[1] * k2, tip[2] * k2]);
  }
  for (let k = 0; k < tall; k++) {
    const a = rng() * TAU, d = edge(a) * 0.7 * Math.sqrt(rng()), x = Math.cos(a) * d, z = Math.sin(a) * d;
    for (let q = 0; q < 5; q++) blade(x + (rng() - 0.5) * 0.04, z + (rng() - 0.5) * 0.04, 0.15 + rng() * 0.25, 0.004, 0.12, [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7], tip);
  }
  const t = b.build();
  t.label = 'Green algal turf'; t.fact = 'In the sunlit lake, carpets of green algae grow fast on the nutrients the jellyfish release.';
  t.solid = false; t.dLift = 0;
  return t;
}
// A tuft of filamentous green algae: a few dozen fine strands from a small holdfast, swaying.
function algaeTuft(seed, { n = 26, R = 0.05, h = 0.16, col = [0.06, 0.25, 0.04], tip = [0.3, 0.5, 0.1] } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 1597 + 31), base = [];
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = R * Math.sqrt(rng()), x = Math.cos(a) * d, z = Math.sin(a) * d, H = h * (0.4 + 0.8 * rng());
    const lean = a + (rng() - 0.5) * 1.2, la = 0.2 + rng() * 0.7, fx = Math.cos(lean + 1.57), fz = Math.sin(lean + 1.57), w = 0.003 + rng() * 0.004, v0 = b.vc, k2 = 0.8 + 0.4 * rng();
    for (let i = 0; i <= 2; i++) {
      const t = i / 2, ang = la * t * (1 + 0.5 * t), px = x + Math.cos(lean) * Math.sin(ang) * H * t, py = H * t * Math.cos(ang * 0.7), pz = z + Math.sin(lean) * Math.sin(ang) * H * t, ww = w * (1 - 0.6 * t);
      const c = [lerp(col[0], tip[0], t) * k2, lerp(col[1], tip[1], t) * k2, lerp(col[2], tip[2], t) * k2];
      b.v(px - fx * ww, py, pz - fz * ww, 0, 1, 0, c[0], c[1], c[2], 0.18 * H * t * t, 0);
      b.v(px + fx * ww, py, pz + fz * ww, 0, 1, 0, c[0], c[1], c[2], 0.18 * H * t * t, 0);
    }
    for (let i = 0; i < 2; i++) { const q = v0 + i * 2; b.t(q, q + 1, q + 2); b.t(q + 1, q + 3, q + 2); }
    if (k < 12) base.push(x, 0, z);
  }
  const t = b.build();
  setBase(t, base);
  t.label = 'Filamentous green algae'; t.solid = false;
  return t;
}
// Algal cushion: a low dome of tangled green filaments (a soft mound, bristling at the surface).
function algaeCushion(seed, { R = 0.35, H = 0.14, n = 110, col = [0.05, 0.2, 0.04], tip = [0.25, 0.45, 0.1] } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 733 + 51), ph = rng() * TAU, base = [];
  const shape = (x, z) => { const a = Math.atan2(z, x), rr = R * (1 + 0.18 * Math.sin(a * 3 + ph) + 0.1 * Math.sin(a * 5 + ph * 2)); const d = Math.hypot(x, z) / rr; return d >= 1 ? 0 : H * Math.pow(1 - d * d, 0.7) * (0.85 + 0.3 * vn3(x * 6, 0, z * 6, seed)); };
  b.grid(12, 4, (u, v, i, j, o) => {
    const a = u * TAU, rr = R * (1 + 0.18 * Math.sin(a * 3 + ph) + 0.1 * Math.sin(a * 5 + ph * 2)) * (1 - v * 0.999), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    o[0] = x; o[1] = Math.max(0, shape(x * 0.999, z * 0.999)) - 0.01; o[2] = z;
    const k = 0.7 + 0.5 * v; o[3] = col[0] * k; o[4] = col[1] * k; o[5] = col[2] * k; o[6] = 0; o[7] = 0;
  }, { wrapU: true });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; base.push(Math.cos(a) * R * 0.7, -0.01, Math.sin(a) * R * 0.7); }
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = R * 0.95 * Math.sqrt(rng()), x = Math.cos(a) * d, z = Math.sin(a) * d, y = shape(x, z) - 0.005;
    if (y <= 0) continue;
    const L = 0.025 + 0.06 * rng(), la = a + (rng() - 0.5) * 2, out = [Math.cos(la) * (0.3 + d / R * 0.6), 1, Math.sin(la) * (0.3 + d / R * 0.6)], ol = Math.hypot(out[0], out[1], out[2]);
    const dir = [out[0] / ol, out[1] / ol, out[2] / ol], fx = -Math.sin(la), fz = Math.cos(la), w = 0.004 + rng() * 0.004, v0 = b.vc, k2 = 0.8 + 0.4 * rng();
    for (let i = 0; i <= 1; i++) {
      const t = i, px = x + dir[0] * L * t, py = y + dir[1] * L * t, pz = z + dir[2] * L * t, ww = w * (1 - 0.6 * t), c = [lerp(col[0], tip[0], t) * k2, lerp(col[1], tip[1], t) * k2, lerp(col[2], tip[2], t) * k2];
      b.v(px - fx * ww, py, pz - fz * ww, dir[0], dir[1], dir[2], c[0], c[1], c[2], 0.02 * t, 0);
      b.v(px + fx * ww, py, pz + fz * ww, dir[0], dir[1], dir[2], c[0], c[1], c[2], 0.02 * t, 0);
    }
    b.t(v0, v0 + 1, v0 + 2); b.t(v0 + 1, v0 + 3, v0 + 2);
  }
  const t = b.build();
  setBase(t, base);
  t.label = 'Algal cushion'; t.fact = 'In the sunlit lake, carpets of green algae grow fast on the nutrients the jellyfish release.'; t.solid = false;
  return t;
}
// Halimeda: branching chains of flat, lime-hardened green segments.
function halimeda(seed) {
  const b = new Builder(), rng = mulberry32(seed * 811 + 3);
  const seg = (p, d, s, depth, k) => {
    // one kidney-shaped segment: an octagon disc in a plane containing d
    const side = nrm([d[2] + (rng() - 0.5), (rng() - 0.5) * 0.3, -d[0] + (rng() - 0.5)]), nn = nrm([side[1] * d[2] - side[2] * d[1], side[2] * d[0] - side[0] * d[2], side[0] * d[1] - side[1] * d[0]]);
    const c = [p[0] + d[0] * s * 0.5, p[1] + d[1] * s * 0.5, p[2] + d[2] * s * 0.5], v0 = b.vc, g = 0.55 + 0.45 * sat(depth / 5);
    const col = [lerp(0.55, 0.12, g), lerp(0.62, 0.46, g), lerp(0.48, 0.1, g)];
    b.v(c[0], c[1], c[2], nn[0], nn[1], nn[2], col[0] * 1.1, col[1] * 1.1, col[2] * 1.1, 0.004 * depth, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, ca = Math.cos(a) * s * 0.62, sa = Math.sin(a) * s * 0.5;
      b.v(c[0] + side[0] * ca + d[0] * sa, c[1] + side[1] * ca + d[1] * sa, c[2] + side[2] * ca + d[2] * sa, nn[0], nn[1], nn[2], col[0], col[1], col[2], 0.004 * depth, 0);
    }
    for (let i = 0; i < 8; i++) b.t(v0, v0 + 1 + i, v0 + 1 + ((i + 1) % 8));
    const tip = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
    if (depth >= 7 || (depth > 3 && rng() < 0.15)) return;
    const fork = depth > 0 && depth < 5 && rng() < 0.35;
    for (let f = 0; f < (fork ? 2 : 1); f++) {
      const nd = nrm([d[0] + (rng() - 0.5) * 0.6 + (fork ? (f ? 0.4 : -0.4) * side[0] : 0), d[1] + 0.15, d[2] + (rng() - 0.5) * 0.6 + (fork ? (f ? 0.4 : -0.4) * side[2] : 0)]);
      seg(tip, nd, s * (0.95 + rng() * 0.1), depth + 1, k);
    }
  };
  for (let k = 0; k < 2 + ((rng() * 3) | 0); k++) seg([(rng() - 0.5) * 0.03, -0.01, (rng() - 0.5) * 0.03], nrm([(rng() - 0.5) * 0.6, 1, (rng() - 0.5) * 0.6]), 0.022 + rng() * 0.008, 0, k);
  const t = b.build();
  setBase(t, [0.01, -0.01, 0, -0.01, -0.01, 0, 0, -0.01, 0.01, 0, -0.01, -0.01]);
  t.label = 'Halimeda'; t.fact = "Halimeda's lime-hardened segments crumble into sand when it dies; much tropical white sand began this way.";
  t.solid = false;
  return t;
}
// Sea grapes (Caulerpa racemosa): runners over the floor with upright stalks of little green spheres.
function seaGrapes(seed, { R = 0.5 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 977 + 41), base = [];
  const bead = (c, r, col) => { const v0 = b.vc, D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; for (const d of D) b.v(c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r, d[0], d[1], d[2], col[0], col[1], col[2], 0.004, 0); for (const f of [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]) b.t(v0 + f[0], v0 + f[1], v0 + f[2]); };
  for (let k = 0; k < 2 + ((rng() * 3) | 0); k++) {
    let a = rng() * TAU, p = [(rng() - 0.5) * R * 0.6, 0.006, (rng() - 0.5) * R * 0.6];
    const pts = [p.slice()];
    for (let i = 0; i < 6; i++) {
      a += (rng() - 0.5) * 0.9; p = [p[0] + Math.cos(a) * R * 0.18, 0.006, p[2] + Math.sin(a) * R * 0.18]; pts.push(p.slice());
      if (Math.hypot(p[0], p[2]) > R) break;
    }
    b.tube(pts, pts.map(() => 0.0045), 3, (v, an, x, y, z, o) => { o[3] = 0.12; o[4] = 0.3; o[5] = 0.08; o[6] = 0; o[7] = 0; });
    for (const q of pts) base.push(q[0], 0.0015, q[2]);
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i], h = 0.04 + rng() * 0.06, c = [0.1 + 0.08 * rng(), 0.42 + 0.12 * rng(), 0.08];
      b.tube([[q[0], 0.004, q[2]], [q[0] + (rng() - 0.5) * 0.01, h, q[2] + (rng() - 0.5) * 0.01]], [0.0028, 0.002], 3, (v, an, x, y, z, o) => { o[3] = c[0] * 0.8; o[4] = c[1] * 0.8; o[5] = c[2]; o[6] = 0; o[7] = 0; });
      for (let m = 0; m < 4; m++) { const yy = h * (0.4 + 0.6 * m / 3), aa = m * 2.4; bead([q[0] + Math.cos(aa) * 0.009, yy, q[2] + Math.sin(aa) * 0.009], 0.0055 + 0.002 * rng(), [c[0] * 1.2, c[1] * 1.15, c[2]]); }
    }
  }
  const t = b.build();
  setBase(t, base.slice(0, 36));
  t.label = 'Sea grapes (Caulerpa)'; t.fact = 'A sea-grape plant is one giant cell with many nuclei; a single cell can creep across metres of seabed.';
  t.solid = false;
  return t;
}
// Bubble algae (Valonia): glossy dark-green balloons, each a single cell.
function valonia(seed) {
  const b = new Builder(), rng = mulberry32(seed * 563 + 5), base = [];
  const n = 3 + ((rng() * 8) | 0);
  for (let k = 0; k < n; k++) {
    const r = 0.008 + rng() * 0.022, a = rng() * TAU, d = rng() * 0.05, x = Math.cos(a) * d, z = Math.sin(a) * d, c = [0.04 + 0.04 * rng(), 0.2 + 0.1 * rng(), 0.12 + 0.06 * rng()];
    b.blob(1, (px, py, pz, o) => { o[0] = x + px * r; o[1] = r * 0.8 + py * r * 0.85; o[2] = z + pz * r; const sh = 0.8 + 0.4 * Math.max(0, py); o[3] = c[0] * sh; o[4] = c[1] * sh; o[5] = c[2] * sh; o[6] = 0; o[7] = 1; }); // smooth, glossy
    base.push(x, 0.05 * r, z);
  }
  const t = b.build();
  setBase(t, base);
  t.label = "Sailor's eyeballs (Valonia)"; t.fact = 'Each glossy bubble of Valonia is a single cell, among the largest single cells on Earth.';
  t.solid = false;
  return t;
}
// Sunken branch from the island forest, settled on the mud and furred with algae.
function sunkenBranch(seed) {
  const b = new Builder(), rng = mulberry32(seed * 197 + 23), Lb = 1.2 + rng() * 2.2, r = 0.03 + rng() * 0.05, base = [];
  const paint = (v, a, x, y, z, o) => { const n = 0.75 + 0.35 * vn3(x * 5, y * 5, z * 5, seed); o[3] = 0.2 * n; o[4] = 0.18 * n; o[5] = 0.12 * n; o[6] = 0.9; o[7] = 0; };
  const pts = [], rad = [];
  for (let i = 0; i <= 7; i++) { const t = i / 7, rr2 = r * (1 - 0.5 * t); pts.push([(t - 0.5) * Lb, rr2 * 0.85, 0.12 * vn3(t * 3, 0, 0, seed)]); rad.push(rr2); base.push((t - 0.5) * Lb, 0, pts[i][2]); }
  b.tube(pts, rad, 6, paint, { cap: true });
  for (let k = 0; k < 1 + ((rng() * 3) | 0); k++) {
    const i0 = 1 + ((rng() * 5) | 0), P = pts[i0], a = (rng() < 0.5 ? 1 : -1) * (0.4 + rng() * 0.8), l = Lb * (0.15 + rng() * 0.25), r2 = rad[i0] * 0.5, q = [];
    for (let i = 0; i <= 3; i++) { const t = i / 3; q.push([P[0] + Math.cos(a) * l * t, r2 * (1 - 0.4 * t) * 0.9, P[2] + Math.sin(a) * l * t]); }
    b.tube(q, q.map((_, i) => r2 * (1 - 0.4 * i / 3)), 4, paint, { tip: true });
    base.push(q[3][0], 0, q[3][2]);
  }
  const t = b.build();
  setBase(t, base);
  t.label = 'Sunken branch'; t.solid = false;
  return t;
}
// A drift of mangrove leaves: on the mud (sunken) or at the surface (floating, base at y = 0).
const LEAF = [L(0x7a6a1a), L(0x6a3c12), L(0x3c2a10), L(0x5a5a18), L(0x8a5a14)];
function leaves(seed, { n = 16, R = 0.5, floating = false } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 131 + 77), base = [];
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = R * Math.sqrt(rng()), cx = Math.cos(a) * d, cz = Math.sin(a) * d, Ll = 0.06 + rng() * 0.05, W = Ll * 0.42, yaw = rng() * TAU, c = Math.cos(yaw), s = Math.sin(yaw);
    const col = LEAF[(rng() * LEAF.length) | 0], y0 = floating ? 0 : 0.003 + rng() * 0.01, curl = (rng() - 0.3) * 0.4;
    for (const back of floating ? [false, true] : [false]) { // floating leaves are seen from below: both faces
      b.grid(3, 2, (u, v, i, j, o) => {
        const lu = (u - 0.5) * Ll, wv = (v - 0.5) * W * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) + 0.0004;
        o[0] = cx + c * lu - s * wv; o[1] = y0 + curl * (v - 0.5) ** 2 * W - (back ? 0.0015 : 0); o[2] = cz + s * lu + c * wv;
        const k = back ? 0.8 : 1; o[3] = col[0] * k; o[4] = col[1] * k; o[5] = col[2] * k; o[6] = 0; o[7] = 0;
      }, { flip: back });
    }
    base.push(cx, y0, cz);
  }
  const t = b.build();
  setBase(t, base.slice(0, 36));
  t.label = floating ? 'Floating mangrove leaves' : 'Fallen leaves'; t.solid = false;
  return t;
}

// ---------------------------------------------------------------- templates and per-segment palettes
const TINTS = [[1, 1, 1], [1.04, 1.0, 0.9], [0.94, 0.95, 0.96], [1.06, 0.98, 0.84]];
export const recipeOf = (g) => recipe(g, 'nb3jl', (g) => {
  const u = (k) => sv(g, 600 + k);
  return {
    walls: 0.45 + 0.55 * u(0), front: -4.2 - 2.6 * u(1), notch: 0.9 + 1.2 * u(2), lip: 0.2 + 0.7 * u(3), up: 1.6 + 2.6 * u(4), tint: TINTS[Math.floor(u(5) * TINTS.length)],
    mangrove: 0.5 + 0.6 * u(6), turf: 0.7 + 0.7 * u(7), anem: 0.5 + 0.9 * u(8), halimeda: u(9), grapes: u(10), valonia: u(11), litter: 0.3 + 0.8 * u(12),
    turfPal: [[L(0x2a5a18), L(0x7a9a30)], [L(0x405a16), L(0x9a9a38)], [L(0x1e4a1c), L(0x5a8a2a)], [L(0x4a5018), L(0x8a8a3a)], [L(0x2a5a2a), L(0x80b048)]].filter((_, i) => u(20 + i) > 0.35),
    sponge: [L(0xe0601a), L(0xc0201a), L(0x6a2a8a), L(0xe0b020), L(0xd04a6a)].filter((_, i) => u(30 + i) > 0.4),
    rocks: 0.5 + 0.8 * u(13),
    prom: 0.3 + 0.55 * u(14),                          // limestone headlands jutting toward the route
    logs: 0.6 + 1.2 * u(15),                           // sunken trees on the floor
  };
});
export const JL_ROCKS = [{ r: 'boulder', litho: 'limestone', kind: 'tafoni', growth: 1, detail: 3 }, { r: 'boulder', litho: 'limestone', growth: 1, detail: 3 }, { r: 'cracked', litho: 'limestone', growth: 1 }, { r: 'eroded', litho: 'limestone', growth: 1, detail: 3 }];
export function initJellyLake(tier) {
  J.wall = [0, 1].map((i) => drainG(limestoneWall(8300 + i * 11, { Lw: 11 + i * 4, D: 4 + i, yN: 6, up: 2.5 + i, notch: 1.3 + i * 0.4, lip: 0.4 + i * 0.2, tier })));
  J.rock = [0, 1, 2].map((i) => drain(rockJob(JL_ROCKS[i], 8400 + i * 13)));
  const TP = [[L(0x2a5a18), L(0x7a9a30)], [L(0x405a16), L(0x9a9a38)], [L(0x1e4a1c), L(0x5a8a2a)], [L(0x4a5018), L(0x8a8a3a)], [L(0x2a5a2a), L(0x80b048)]];
  J.tuft = TP.flatMap((p, i) => [0, 1].map((q) => algaeTuft(8550 + i * 13 + q, { n: tier === 'low' ? 22 : 32 + q * 16, R: 0.07 + q * 0.07, h: 0.18 + i * 0.04 + q * 0.12, col: p[0], tip: p[1] })));
  J.cushion = TP.flatMap((p, i) => [0, 1].map((q) => algaeCushion(8580 + i * 11 + q, { R: 0.3 + q * 0.3 + i * 0.04, H: 0.1 + q * 0.06, n: tier === 'low' ? 70 : 110 + q * 60, col: p[0], tip: p[1] })));
  J.turf = [0, 1, 2, 3, 4].map((i) => turfCarpet(8500 + i * 7, { R: 0.8 + i * 0.2, n: tier === 'low' ? 110 : 170 + i * 15, tall: i % 2 ? 8 : 16, col: TP[i][0], tip: TP[i][1] }));
  J.halimeda = [0, 1, 2, 3].map((i) => halimeda(8600 + i * 5));
  J.grapes = [0, 1, 2].map((i) => seaGrapes(8700 + i * 9, { R: 0.35 + i * 0.12 }));
  J.valonia = [0, 1, 2].map((i) => valonia(8800 + i * 3));
  J.branch = [0, 1, 2, 3].map((i) => sunkenBranch(8900 + i * 3));
  J.litter = [0, 1, 2].map((i) => leaves(9000 + i, { n: 12 + i * 6, R: 0.35 + i * 0.15 }));
  J.floatLeaf = [0, 1].map((i) => leaves(9050 + i, { n: 10 + i * 6, R: 0.5 + i * 0.3, floating: true }));
  const hues = [[0.86, 0.84, 0.8], [0.9, 0.82, 0.78], [0.8, 0.82, 0.8], [0.88, 0.86, 0.74]];
  J.anem = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => drainG(lakeAnemones(9100 + i * 7, { n: 6 + i, Rp: 0.14 + i * 0.035, R0: 0.03, tier, hue: hues[i % 4] })));
  J.rootAnem = [0, 1, 2].map((i) => drainG(lakeAnemones(9200 + i * 7, { n: 2 + (i % 2), Rp: 0.018, tier, hue: hues[i] })));
  J.sponge = [0, 1, 2, 3].map((i) => encrust(9300 + i, { r: 0.025 + (i % 2) * 0.008, h: 0.03 + (i % 3) * 0.01, lobes: 0.5, detail: 1 }));
  J.tunic = [0, 1].map((i) => tunicates(9400 + i, { n: 3 + i, H: 0.035, R: 0.009, spread: 0.02 }));
  for (const t of J.sponge) { t.label = 'Root sponge'; t.fact = 'Sponges crust the submerged mangrove roots in reds, oranges and purples.'; t.solid = false; }
  for (const t of J.tunic) { t.label = 'Sea squirts'; t.solid = false; }
  return J;
}
export function jellyLakeProviders(provide) {
  provide(KEY, 'nb3jlWall', 4, (seg, k, tier) => {
    const rc = recipeOf(seg), sd = (seg.seed ^ Math.imul(k + 1, 0x2c1b3c6d)) >>> 0, q = (n) => ((sd >>> n) % 100) / 100;
    return limestoneWall(sd, { Lw: 9 + 9 * q(2), D: 3.5 + 2.5 * q(5), yN: 6, up: rc.up * (0.8 + 0.4 * q(8)), notch: rc.notch * (0.8 + 0.4 * q(11)), lip: rc.lip * (0.6 + 0.8 * q(14)), lean: 0.02 + 0.08 * q(17), under: 0.2 + 0.9 * q(20), tier, tintC: rc.tint });
  }, 2);
  provide(KEY, 'nb3jlTurf', 4, (seg, k, tier) => (function* () {
    const rc = recipeOf(seg), pal = rc.turfPal.length ? rc.turfPal[k % rc.turfPal.length] : [L(0x1e6a14), L(0x8ab02a)], sd = (seg.seed ^ Math.imul(k + 9, 0x165667b1)) >>> 0;
    yield;
    return turfCarpet(sd, { R: 0.8 + ((sd >>> 4) % 100) / 100 * 0.9, n: tier === 'low' ? 110 : 160 + ((sd >>> 9) % 60), tall: (sd >>> 13) % 18, col: pal[0], tip: pal[1] });
  })(), 2);
  provide(KEY, 'nb3jlRock', 5, (seg, k) => rockJob(JL_ROCKS[(k + (seg.seed >>> 9)) % JL_ROCKS.length], (seg.seed ^ Math.imul(k + 5, 0x7feb352d)) >>> 0), 2);
}

// ---------------------------------------------------------------- plan: shorelines, walls, tree sites
// shore(side, s): lateral distance at which the floor reaches depth `y` (searching outward from 16 m)
function crossing(fs, pc, s, side, y, from = 16, to = 70) {
  const px = pc.x(s);
  for (let ad = from; ad < to; ad += 0.75) if (fs.at(px + side * ad, s) >= y) return ad;
  return -1;
}
// The template's surface stays out of the camera's flight tube (vertex sample, solid rule: parts lower
// than LOW_GAP under the path are fine).
function wallClear(pc, W) {
  const P = W.tpl.pos, n = W.tpl.vc;
  for (let i = 0; i < n; i += 3) {
    const w = xf(W.R, W.sx, W.sy, W.sz, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), y = W.y + w[1], s = W.s - w[2], py = pc.y(s);
    if (y <= py - LOW_GAP) continue;
    const dx = W.x + w[0] - pc.x(s), dy = y - py;
    if (dx * dx + dy * dy < (TUBE + 0.4) ** 2) return false;
  }
  return true;
}
// lowest floor under the template's front foot line (wall placed at px, sc with rotation R, scale sx)
function footMin(fs, tpl, R, sx, px, sc) {
  let fmin = 1e9;
  const F = tpl.nbFoot;
  for (let q = 0; q < F.length; q += 2) {
    const w = xf(R, sx, 1, 1.05, F[q], 0, F[q + 1] + 0.35);
    fmin = Math.min(fmin, fs.at(px + w[0], sc - w[2]));
  }
  return fmin;
}
// A sunken tree from the island forest, settled into the mud: the trunk follows the floor (its lower ~40 %
// buried), limbs rise from it, a root plate (or a snapped end) at its foot. Returns spines in global
// [x, y, s] with radii, or null where it would cross the flight tube.
function logPlan(fs, pc, rng, x0, s0, ang, Lt, r0) {
  const n = Math.max(8, Math.round(Lt / 0.45)), pts = [], rad = [], bend = (rng() - 0.5) * 0.5;
  let a = ang, x = x0, s = s0;
  for (let i = 0; i <= n; i++) {
    const t = i / n, r = r0 * (1 - 0.55 * Math.pow(t, 0.8)), sink = 0.45 - 0.15 * t;
    pts.push([x, fs.at(x, s) + r * (1 - 2 * sink), s]); rad.push(r);
    a += bend / n; x += Math.cos(a) * Lt / n; s += Math.sin(a) * Lt / n;
  }
  const spine = (P, R) => { const o = []; for (let i = 0; i < P.length; i++) o.push(P[i][0], P[i][1], P[i][2], R[i]); return o; };
  if (!clearSpine(pc, spine(pts, rad))) return null;
  const limbs = [], above = (p, r) => p[1] - r > fs.at(p[0], p[2]) + 0.03;
  const limb = (p0, dx, ds, dy, Lb, rb, broken) => {
    const P = [p0], R = [rb], m = 4;
    let d = [dx, dy, ds];
    for (let k = 1; k <= m; k++) {
      d = [d[0] * 0.92, d[1] + 0.12, d[2] * 0.92];
      const l = Math.hypot(d[0], d[1], d[2]); d = [d[0] / l, d[1] / l, d[2] / l];
      const q = P[k - 1]; P.push([q[0] + d[0] * Lb / m, q[1] + d[1] * Lb / m, q[2] + d[2] * Lb / m]); R.push(rb * (1 - 0.6 * k / m));
    }
    for (let k = 1; k < P.length; k++) if (!above(P[k], R[k])) return null;
    if (!clearSpine(pc, spine(P, R))) return null;
    return { pts: P, rad: R, broken };
  };
  // limbs: from the upper side of the trunk, angled off it and rising
  const nL = 3 + ((rng() * 4) | 0);
  for (let k = 0; k < nL; k++) {
    const i = Math.min(n - 1, Math.round(n * (0.25 + 0.65 * rng()))), p = pts[i], c = pts[i + 1], tx = c[0] - p[0], ts = c[2] - p[2], tl = Math.hypot(tx, ts) || 1;
    const sd = rng() < 0.5 ? -1 : 1, aa = sd * (0.5 + 0.8 * rng()), ca = Math.cos(aa), sa = Math.sin(aa);
    const dx = (tx * ca - ts * sa) / tl, ds = (tx * sa + ts * ca) / tl, dy = 0.45 + 0.6 * rng();
    const L0 = limb([p[0], p[1] + rad[i] * 0.3, p[2]], dx, ds, dy, (1.2 + 2.4 * rng()) * (1 - 0.4 * i / n) * (0.7 + r0), rad[i] * (0.4 + 0.15 * rng()), rng() < 0.4);
    if (!L0) continue;
    limbs.push(L0);
    if (rng() < 0.5) { // a side branch
      const q = L0.pts[2], b2 = sd * (0.6 + 0.6 * rng()), c2 = Math.cos(b2), s2 = Math.sin(b2);
      const L1 = limb(q, dx * c2 - ds * s2, dx * s2 + ds * c2, 0.5 + 0.4 * rng(), (0.5 + 0.9 * rng()) * (0.6 + r0), L0.rad[2] * 0.75, rng() < 0.5);
      if (L1) limbs.push(L1);
    }
  }
  // the foot: a root plate standing out of the mud, or a snapped, splintered end
  const roots = [], plate = rng() < 0.6;
  if (plate) {
    const p = pts[0], c = pts[1], tx = c[0] - p[0], ts = c[2] - p[2], tl = Math.hypot(tx, ts) || 1, sx = -ts / tl, ss = tx / tl;
    const nR = 5 + ((rng() * 4) | 0);
    for (let k = 0; k < nR; k++) {
      const ph = (k / nR) * TAU + rng() * 0.5, cu = Math.cos(ph), su = Math.sin(ph), Lr = r0 * (2.2 + 2.5 * rng()), rr0 = r0 * (0.28 + 0.12 * rng());
      const dir = [sx * su - tx / tl * 0.35, cu * 0.9 + 0.1, ss * su - ts / tl * 0.35], P = [[p[0], p[1], p[2]]], R = [rr0];
      for (let q = 1; q <= 3; q++) { const t = q / 3; P.push([p[0] + dir[0] * Lr * t, p[1] + dir[1] * Lr * t - 0.15 * Lr * t * t, p[2] + dir[2] * Lr * t]); R.push(rr0 * (1 - 0.7 * t)); }
      if (!clearSpine(pc, spine(P, R))) continue;
      roots.push({ pts: P, rad: R });
    }
  }
  return { pts, rad, limbs, roots, plate };
}
const PL = planned(function* (ctx) {
  const Y = slice(2.5), out = { walls: [], trees: [], rocks: [], logs: [], sp: new Space() };
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return out;
  const rng = chunkRng(ctx, 0x1e11), fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), rc0 = recipeOf(g0);
  for (const side of [-1, 1]) {
    // walk along the shore: limestone walls with gaps, mangroves in the gaps
    let s = ctx.s0 + rng() * 6;
    while (s < ctx.s1) {
      if (Y.over()) { yield; Y.reset(); }
      const g = segFor(ctx, s, KEY);
      if (!g || ctx.weightOf(s, KEY) < 0.5) { s += 6; continue; }
      const rc = recipeOf(g);
      if (rng() < rc.walls * 0.55) {
        const tpl = pick(rng, poolOf(g, 'nb3jlWall', J.wall, 2)), sx = 0.8 + rng() * 0.4, len = tpl.nbLw * sx, sc = s + len / 2;
        const adF = crossing(fs, pc, sc, side, rc.front + (rng() - 0.5));
        if (adF > 17 && adF < 34 && sc < ctx.s1 + 4) {
          // footprint: lowest floor under the front line decides the vertical scale (notch at the surface)
          const yaw = -side * Math.PI / 2 + (rng() - 0.5) * 0.25, R = rotY(yaw), px = pc.x(sc) + side * adF;
          const sy = (0.3 - footMin(fs, tpl, R, sx, px, sc)) / tpl.nbYN;
          if (sy > 0.45 && sy < 1.6) {
            const sz = 0.95 + rng() * 0.1;
            out.walls.push({ tpl, x: px, y: -tpl.nbYN * sy, s: sc, R, sx, sy, sz, g, side });
            out.sp.add(px - side * 1.5, sc, len / 2);
          }
        }
        s += len + 3 + rng() * 14;
      } else {
        // a stretch of mangrove fringe: trees every few metres along the shoreline
        const run = 8 + rng() * 16;
        for (let t = 0; t < run; t += 3.5 + rng() * 4) {
          const ss = s + t;
          if (ss >= ctx.s1) break;
          if (rng() > rc.mangrove * bk) continue;
          const adS = crossing(fs, pc, ss, side, -0.15, 18, 75);
          if (adS < 0) continue;
          out.trees.push({ x: pc.x(ss) + side * (adS + 0.6 + rng() * 1.2), s: ss, side, g });
        }
        s += run;
      }
    }
  }
  yield;
  // headlands: a limestone wall juts into the lake 9-15 m from the route, rising from the deep floor to
  // its notch at the surface, so the karst is in view and not only at the misty shore
  for (const side of [-1, 1]) {
    if (rng() > rc0.prom * bk) continue;
    for (let t = 0; t < 3; t++) {
      if (Y.over()) { yield; Y.reset(); }
      const tpl = pick(rng, poolOf(g0, 'nb3jlWall', J.wall, 2)), sx = 0.75 + rng() * 0.3, len = tpl.nbLw * sx;
      if (len > CHUNK - 4) continue;
      const sc = ctx.s0 + len / 2 + 2 + rng() * (CHUNK - len - 4), ad = 9 + rng() * 6;
      if (ctx.weightOf(sc, KEY) < 0.6) continue;
      const R = rotY(-side * Math.PI / 2 + (rng() - 0.5) * 0.5), px = pc.x(sc) + side * ad, sy = (0.3 - footMin(fs, tpl, R, sx, px, sc)) / tpl.nbYN;
      if (sy < 0.45 || sy > 1.9) continue;
      const W = { tpl, x: px, y: -tpl.nbYN * sy, s: sc, R, sx, sy, sz: 0.9 + rng() * 0.15, g: g0, side, prom: true };
      if (!out.sp.free(px - side * 2, sc, len / 2, 1) || !wallClear(pc, W)) continue;
      out.walls.push(W);
      out.sp.add(px - side * 2, sc, len / 2);
      break;
    }
  }
  yield;
  // sunken trees across the floor beside the route
  const nLog = Math.floor(rc0.logs * bk + rng());
  for (let k = 0; k < nLog * 4 && out.logs.length < nLog; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 6 + rng() * (CHUNK - 12), g = segFor(ctx, s, KEY);
    if (!g || ctx.weightOf(s, KEY) < 0.6) continue;
    const side = rng() < 0.5 ? -1 : 1, x = pc.x(s) + side * (3 + rng() * 10), Lt = 5 + rng() * 7, r0 = 0.22 + rng() * 0.24;
    const ang = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 2.2; // roughly along or across the route, either way round
    const ex = x + Math.cos(ang) * Lt, es = s + Math.sin(ang) * Lt;
    if (es < ctx.s0 + 2 || es > ctx.s1 - 2 || fs.at(x, s) > ctx.surfaceY - 1.5 || fs.at(ex, es) > ctx.surfaceY - 1.5) continue;
    let ok = true;
    for (let q = 0; q <= 6 && ok; q++) { const t = q / 6; ok = out.sp.free(x + (ex - x) * t, s + (es - s) * t, r0 + 0.4, 0.3); }
    if (!ok) continue;
    const T = logPlan(fs, pc, rng, x, s, ang, Lt, r0);
    if (!T) continue;
    T.g = g;
    out.logs.push(T);
    for (let i = 0; i < T.pts.length; i += 2) out.sp.add(T.pts[i][0], T.pts[i][2], T.rad[i] + 0.15);
  }
  yield;
  // limestone boulders: most in view of the route, some tumbled down the slopes
  const nR = Math.round((5 + rng() * 5) * rc0.rocks * bk);
  for (let k = 0; k < nR * 3 && out.rocks.length < nR; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const side = rng() < 0.5 ? -1 : 1, ad = rng() < 0.6 ? 4 + rng() * 9 : 13 + rng() * 13, x = pc.x(s) + side * ad;
    const tpl = pick(rng, poolOf(g, 'nb3jlRock', J.rock, 2)), sc = 0.8 + Math.pow(rng(), 1.4) * 1.8, r = tpl.r * sc * 0.85;
    if (!out.sp.free(x, s, r, 0.3) || fs.at(x, s) > -0.6) continue;
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.6), rng() * TAU), P = [x, fs.at(x, s), s], sy = sc * (0.7 + rng() * 0.4);
    seat(fs, tpl, R, sc, sy, sc, P, null, 0.05 + (tpl.maxY - tpl.minY) * sy * 0.1);
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) continue;
    out.sp.add(P[0], P[2], r);
    out.rocks.push({ tpl, x: P[0], y: P[1], s: P[2], R, sc, sy, g });
  }
  return out;
});
const plan = (ctx) => PL.get(ctx);
export function layoutJlP(ctx) { return presence(ctx, KEY) > 0 ? PL.stage(ctx) : null; }

// ---------------------------------------------------------------- chain A: walls and rocks
export function* layoutJlA(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, KEY), pc = pathCache(ctx);
  const rng = chunkRng(ctx, 0x1e22);
  const st = new Batch(MAT.static, 60000 * bk);
  const labels = [], pois = [];
  for (const W of P.walls) {
    const c = tint(rng, [[1, 1, 1]], 0.05);
    if (put(ctx, st, W.tpl, W.x, W.y, W.s, W.R, W.sx, W.sy, W.sz, c, 1, 'floor')) {
      W.item = st.last;
      if (pois.length < 2) pois.push({ type: 'limestone-notch', x: W.x - W.side * 1.5, y: -1.2, s: W.s, r: 4, data: { name: 'Tidal notch' } });
    }
  }
  yield;
  for (const R0 of P.rocks) {
    if (Y.over()) { yield; Y.reset(); }
    if (put(ctx, st, R0.tpl, R0.x, R0.y, R0.s, R0.R, R0.sc, R0.sy, R0.sc, tint(rng, [[0.95, 0.95, 0.9], [0.9, 0.92, 0.86]], 0.05), 1)) R0.item = st.last;
  }
  yield;
  // each boulder's top is a little garden: algal cushions and tufts, Halimeda, groups of white anemones
  const lk = lowK(ctx), sw = new Batch(MAT.sway, 16000 * bk * lk); sw.soft = true; sw.lod = 'mid';
  const an = new Batch(NB3.mat.anem, 10000 * bk * lk); an.soft = true; an.lod = 'mid';
  for (const R0 of P.rocks) {
    if (!R0.item) continue;
    const spots = itemSpots(R0.item, ctx, 32, 0.6), nE = Math.round((2 + rng() * 6) * lk);
    for (let i = spots.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0, t = spots[i]; spots[i] = spots[j]; spots[j] = t; }
    for (let k = 0, nOn = 0; k < spots.length && nOn < nE; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const p = spots[k], u = rng(), isA = u > 0.62 && u < 0.86;
      const tpl = u < 0.32 ? pick(rng, J.cushion) : u < 0.62 ? pick(rng, J.tuft) : isA ? pick(rng, J.anem) : pick(rng, J.halimeda);
      const sc = (u < 0.32 ? 0.55 + rng() * 0.4 : 0.85 + rng() * 0.45), R = upTo(mix3([0, 1, 0], p.n, 0.7), rng() * TAU), Pp = [p.x, p.y, p.s];
      if (!seatOnItem(R0.item, ctx.s0, tpl, R, sc, Pp, 0.02) || !onRock(R0.item, ctx.s0, tpl, R, sc, Pp)) continue;
      if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + (tpl.maxY - tpl.minY) * sc, (tpl.nbR || tpl.r) * sc, SOFT)) continue;
      if (put(ctx, isA ? an : sw, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tint(rng, [[1, 1, 1], [1.08, 1.04, 0.9]], 0.06), isA ? 1 : sc, { item: R0.item })) nOn++;
    }
  }
  return { batches: [st, sw, an], labels, pois };
}

// ---------------------------------------------------------------- chain B: mangrove fringe
// Prop roots are generated per tree straight into a chunk mesh, each root arching from above the water
// down into the exact floor (its tip continues 0.2 m into the mud). Epiphytes sit on the roots below the
// waterline, pressed into the root surface.
export function* layoutJlB(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const P = plan(ctx), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0x1e33), fs = nbFloor(ctx), pc = pathCache(ctx), surf = ctx.surfaceY;
  const roots = new Builder(); // roots, the sponges and sea squirts on them, and the leaves floating off the fringe
  const anem = new Batch(NB3.mat.anem, 9000); anem.soft = true; anem.lod = 'near';
  const labels = [];
  let spongeLbl = null;
  let nRoot = 0;
  for (const T of P.trees) {
    if (Y.over()) { yield; Y.reset(); }
    const rc = recipeOf(T.g), n = Math.round((3 + rng() * 4) * lk) + 1, dirL = [-T.side, 0, 0];
    for (let k = 0; k < n; k++) {
      if (Y.over()) { yield; Y.reset(); }
      // land the root 1-3.5 m lakeward of the trunk, where the water is 0.3-2.5 m deep
      const a = (rng() - 0.5) * 2.2, reach = 1 + rng() * 2.5, ex = T.x + (dirL[0] * Math.cos(a)) * reach, es = T.s + Math.sin(a) * reach;
      const fy = fs.at(ex, es);
      if (fy > surf - 0.25 || fy < surf - 3) continue;
      const y0 = surf + 0.5 + rng() * 0.9, P0 = [T.x + (rng() - 0.5) * 0.3, y0, T.s + (rng() - 0.5) * 0.3], E = [ex, fy - 0.22, es];
      const hx = E[0] - P0[0], hs = E[2] - P0[2], drop = P0[1] - E[1];
      const P1 = [P0[0] + hx * 0.45, P0[1] + 0.15 + rng() * 0.2, P0[2] + hs * 0.45], P2 = [E[0] - hx * 0.05, E[1] + drop * (0.55 + rng() * 0.25), E[2] - hs * 0.05];
      const r0 = 0.035 + rng() * 0.035, pts = [], rad = [];
      for (let i = 0; i <= 11; i++) { const t = i / 11, q = bez(P0, P1, P2, E, t); q[0] += 0.04 * vn3(t * 4, k, 0, T.s) * Math.sin(t * Math.PI); pts.push(q); rad.push(lerp(r0, r0 * 0.6, Math.pow(t, 0.8))); }
      if (!clearBox(pc, ex, es, fy, surf + 1, 0.3, SOLID)) continue;
      const v0 = roots.vc, wetC = 0.75 + 0.3 * rng();
      // local frame z = -(s - s0)
      roots.tube(pts.map((q) => [q[0], q[1], -(q[2] - ctx.s0)]), rad, 6, (v, an, x, y, z, o) => {
        const wet = sstep(surf + 0.1, surf - 0.4, y), mud = sstep(fy + 0.25, fy - 0.05, y), n2 = 0.85 + 0.3 * vn3(x * 6, y * 6, z * 6, 3);
        o[3] = lerp(0.24, 0.13 * wetC, wet) * n2 * (1 - 0.3 * mud); o[4] = lerp(0.18, 0.14 * wetC, wet) * n2 * (1 - 0.3 * mud); o[5] = lerp(0.12, 0.07, wet) * n2 * (1 - 0.3 * mud);
        o[6] = 0.85 * wet; o[7] = 0;
      }, { tip: true });
      nRoot++;
      if (ctx.addObstacle) for (const [i, j] of [[0, 4], [4, 8], [8, 11]]) { const a = pts[i], c = pts[j]; ctx.addObstacle(a[0], a[1], a[2], c[0], c[1], c[2], Math.max(rad[i], rad[j]) + 0.06); }
      // epiphytes on the submerged part of the root: sponges, white anemones, sea squirts
      for (let i = 2; i < 10; i++) {
        const q = pts[i];
        if (q[1] > surf - 0.25 || q[1] < fy + 0.15 || rng() > 0.4) continue;
        const Tn = nrm([pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1], pts[i + 1][2] - pts[i - 1][2]]);
        let n2 = nrm([-Tn[0] * Tn[1], 1 - Tn[1] * Tn[1], -Tn[2] * Tn[1]]);
        if (Math.abs(Tn[1]) > 0.97) n2 = nrm([dirL[0], 0.2, 0]);
        const sAng = (rng() - 0.5) * 1.6, side2 = nrm([Tn[1] * n2[2] - Tn[2] * n2[1], Tn[2] * n2[0] - Tn[0] * n2[2], Tn[0] * n2[1] - Tn[1] * n2[0]]);
        const nn = nrm([n2[0] * Math.cos(sAng) + side2[0] * Math.sin(sAng), n2[1] * Math.cos(sAng) + side2[1] * Math.sin(sAng), n2[2] * Math.cos(sAng) + side2[2] * Math.sin(sAng)]);
        const u = rng(), tpl = u < 0.4 ? pick(rng, J.rootAnem) : u < 0.8 ? pick(rng, J.sponge) : pick(rng, J.tunic);
        // footprint must fit inside the root: keep the base within sqrt(2 r e) of the contact point
        const e = 0.022, fit = Math.sqrt(2 * rad[i] * e - e * e), fr = tpl._nbBaseR ?? tpl.r, sc = Math.min(1.1, fit / Math.max(0.005, fr));
        if (sc < 0.45) continue;
        const R = upTo(nn, rng() * TAU), at = [q[0] + nn[0] * (rad[i] - e), q[1] + nn[1] * (rad[i] - e), q[2] + nn[2] * (rad[i] - e)];
        const isA = J.rootAnem.includes(tpl), col = isA ? [1, 1, 1] : J.sponge.includes(tpl) ? tint(rng, rc.sponge.length ? rc.sponge : [L(0xe0601a)], 0.1) : tint(rng, [[0.9, 0.6, 0.85], [0.7, 0.85, 0.9], [1, 0.8, 0.4]], 0.1);
        if (isA) put(ctx, anem, tpl, at[0], at[1], at[2], R, sc, sc, sc, col, 1, 'roots');
        else { bakeInto(roots, tpl, at[0], at[1], -(at[2] - ctx.s0), R, sc, col); if (!spongeLbl && J.sponge.includes(tpl)) spongeLbl = at; }
      }
    }
    // leaves drifting at the surface off the fringe
    if (rng() < 0.45) {
      const tpl = pick(rng, J.floatLeaf), x = T.x - T.side * (2 + rng() * 5), s = T.s + (rng() - 0.5) * 4;
      bakeInto(roots, tpl, x, surf - 0.012, -(s - ctx.s0), rotY(rng() * TAU), 1, [1, 1, 1]);
    }
  }
  // sunken trees: trunk, limbs and root plate straight into the chunk mesh (exact on the floor by
  // construction), algae furring their upper sides; tufts and white anemones growing on the trunk
  const sw = new Batch(MAT.sway, 6000 * lk); sw.soft = true; sw.lod = 'near';
  const loc = (P) => P.map((q) => [q[0], q[1], -(q[2] - ctx.s0)]);
  const bark = (P, R, wet) => (v, an, x, y, z, o, j) => {
    const up = sat((y - P[j][1]) / Math.max(1e-3, R[j]) * 0.5 + 0.5), n = 0.78 + 0.4 * vn3(x * 2.5, y * 2.5, z * 2.5, 17), al = sstep(0.35, 0.9, up);
    o[3] = lerp(0.15, 0.1, al) * n * wet; o[4] = lerp(0.12, 0.16, al) * n * wet; o[5] = lerp(0.09, 0.05, al) * n * wet; o[6] = 0.25 + 0.5 * al; o[7] = 0;
  };
  for (const T of P.logs) {
    if (Y.over()) { yield; Y.reset(); }
    const n = T.pts.length - 1, wet = 0.85 + 0.3 * rng();
    // thin end first (closed by a zero-radius point), the thick foot last (flat cap: the snapped or root-plate end)
    const tp = T.pts[n], tq = T.pts[n - 1], ex = [tp[0] + (tp[0] - tq[0]) * 0.25, tp[1], tp[2] + (tp[2] - tq[2]) * 0.25];
    const P0 = [ex, ...T.pts.slice().reverse()], R0 = [0.004, ...T.rad.slice().reverse()];
    roots.tube(loc(P0), R0, ctx.tier === 'low' ? 7 : 9, bark(loc(P0), R0, wet), { cap: true });
    for (const B of [...T.limbs, ...T.roots]) roots.tube(loc(B.pts), B.rad, 5, bark(loc(B.pts), B.rad, wet), B.broken ? { cap: true } : { tip: true });
    if (ctx.addObstacle) {
      for (let i = 0; i < n; i += 3) { const a = T.pts[i], c = T.pts[Math.min(n, i + 3)]; ctx.addObstacle(a[0], a[1], a[2], c[0], c[1], c[2], T.rad[i] + 0.08); }
      for (const B of [...T.limbs, ...T.roots]) { const a = B.pts[0], c = B.pts[B.pts.length - 1]; ctx.addObstacle(a[0], a[1], a[2], c[0], c[1], c[2], B.rad[0] + 0.06); }
    }
    // tufts of green algae and small white anemones on the trunk's upper side
    for (let i = 2; i < n - 1; i += 2) {
      if (rng() > 0.55) continue;
      const q = T.pts[i], r = T.rad[i], e = 0.02, fit = Math.sqrt(2 * r * e - e * e), isA = rng() < 0.35, tpl = isA ? pick(rng, J.rootAnem) : pick(rng, J.tuft);
      const fr = tpl._nbBaseR ?? tpl.r, sc = Math.min(1.3, fit / Math.max(0.005, fr));
      if (sc < 0.45) continue;
      const a = (rng() - 0.5) * 0.9, nn = [Math.sin(a) * 0.3, Math.cos(a), 0], l = Math.hypot(nn[0], nn[1]), at = [q[0] + nn[0] / l * (r - e), q[1] + nn[1] / l * (r - e), q[2]];
      put(ctx, isA ? anem : sw, tpl, at[0], at[1], at[2], upTo([nn[0] / l, nn[1] / l, 0], rng() * TAU), sc, sc, sc, isA ? [1, 1, 1] : tint(rng, [[1, 1, 1], [1.1, 1.05, 0.9]], 0.08), isA ? 1 : sc, 'roots');
    }
    const m = T.pts[(n / 2) | 0];
    labels.push(['Sunken tree', m[0], m[1] + 0.3, m[2], 'Trees from the island forest topple into the lake; in the warm, still water their trunks last for decades under a fur of algae.']);
  }
  if (spongeLbl) labels.push(['Root sponge', spongeLbl[0], spongeLbl[1], spongeLbl[2], J.sponge[0].fact]);
  if (P.trees.length) {
    const T = P.trees[(P.trees.length / 2) | 0];
    labels.push(['Mangrove fringe', T.x, surf - 0.8, T.s, 'Mangroves ring the lake; in their shade live the white anemones that eat any jellyfish that wander in.']);
  }
  const extra = [];
  yield;
  if (roots.vc) { const m = builderMesh(roots, MAT.static, null, null); extra.push(m); }
  return { batches: [anem, sw], extra, labels };
}

// ---------------------------------------------------------------- chain C: the sunlit lake floor
export function* layoutJlC(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const P = plan(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx);
  const rng = chunkRng(ctx, 0x1e44), fs = nbFloor(ctx), pc = pathCache(ctx), sp = P.sp;
  const sw = new Batch(MAT.sway, 46000 * bk); sw.soft = true; sw.lod = 'mid'; sw.jobVerts = 11000; // carpets (draped), tufts, cushions, Halimeda
  const carpet = sw;
  const st = new Batch(MAT.static, 22000 * bk); st.lod = 'near';
  const an = new Batch(NB3.mat.anem, 20000 * bk * lk); an.soft = true; an.lod = 'near'; an.jobVerts = 14000;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY), rc0 = recipeOf(g0);
  const lateral = (near, far, k = 1.3) => (rng() < 0.5 ? -1 : 1) * (near + Math.pow(rng(), k) * (far - near));
  // algal turf carpets, draped over the floor (every vertex follows the exact floor mesh)
  const nT = Math.round(20 * rc0.turf * bk * lk);
  for (let k = 0; k < nT * 2; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g || rng() > ctx.weightOf(s, KEY)) continue;
    const x = pc.x(s) + lateral(0, 16), tpl = pick(rng, poolOf(g, 'nb3jlTurf', J.turf, 2)), sc = 1.0 + rng() * 1.1;
    const y = fs.at(x, s);
    if (y > ctx.surfaceY - 0.6 || fs.ny < 0.8) continue;
    if (!clearBox(pc, x, s, y, y + 0.4, tpl.r * sc, SOFT)) continue;
    if (put(ctx, carpet, tpl, x, y, s, rotY(rng() * TAU), sc, 0.8 + rng() * 0.5, sc, tint(rng, [[1, 1, 1]], 0.1), 1, null)) { carpet.last.drape = fs; carpet.last.s0 = ctx.s0; }
  }
  yield;
  // white anemones in groups, Halimeda, sea grapes, bubble algae, leaf litter and sunken branches
  const SPECS = [
    { t: J.anem, w: 1.8 * rc0.anem, b: an, sc: [1.0, 1.6], col: [[1, 1, 1]], soft: true, near: 16 },
    { t: J.tuft, w: 3.0 * rc0.turf, b: sw, sc: [0.9, 1.7], col: [[1, 1, 1], [1.1, 1.05, 0.9]], soft: true, near: 14 },
    { t: J.cushion, w: 2.8 * rc0.turf, b: sw, sc: [0.8, 1.6], col: [[1, 1, 1], [1.1, 1.0, 0.85], [0.85, 1.0, 0.9]], soft: true, near: 16 },
    { t: J.halimeda, w: 1.0 * rc0.halimeda + 0.15, b: sw, sc: [0.8, 1.4], col: [[1, 1, 1], [0.9, 1.05, 0.9]], soft: true, near: 18 },
    { t: J.grapes, w: 0.9 * rc0.grapes + 0.1, b: st, sc: [0.8, 1.3], col: [[1, 1, 1], [0.9, 1.1, 0.85]], near: 14 },
    { t: J.valonia, w: 0.7 * rc0.valonia + 0.1, b: an, sc: [0.8, 1.4], col: [[1, 1, 1]], soft: true, near: 14 },
    { t: J.litter, w: 0.8 * rc0.litter, b: st, sc: [0.8, 1.3], col: [[1, 1, 1]], near: 20 },
    { t: J.branch, w: 0.35 * rc0.litter, b: st, sc: [0.8, 1.2], col: [[0.9, 1, 0.85], [1, 1, 1]], near: 22 },
  ];
  const nS = Math.round(280 * bk * lk);
  for (let k = 0; k < nS * 2 && k < 900; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g || rng() > ctx.weightOf(s, KEY)) continue;
    const e = pickW(rng, SPECS.map((q) => [q.w, q])), tpl = pick(rng, e.t), sc = lerp(e.sc[0], e.sc[1], rng());
    const x = pc.x(s) + lateral(0.3, e.near, 1.4), y0 = fs.at(x, s);
    if (y0 > ctx.surfaceY - 0.5) continue;
    const r = (tpl.nbR || tpl.r) * sc;
    if (!sp.free(x, s, r, 0.04)) continue;
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], 0.8), rng() * TAU), Pp = [x, y0, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.015);
    if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + (tpl.maxY - tpl.minY) * sc, r, e.soft ? SOFT : SOLID)) continue;
    if (put(ctx, e.b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tint(rng, e.col, 0.06), e.soft ? sc : 1)) sp.add(x, s, r);
  }
  yield;
  // green films and darker organic mud over the bottom
  const dec = new Builder();
  for (let k = 0; k < 44 * bk; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + lateral(0, 22, 1.2), r = 2 + rng() * 4.5;
    const green = rng() < 0.7;
    decalDisc(dec, fs, ctx, x, s, r, r * (0.5 + rng() * 0.5), rng() * TAU, green ? tint(rng, [[0.1, 0.22, 0.04], [0.17, 0.24, 0.05], [0.08, 0.17, 0.05]], 0.12) : [0.17, 0.15, 0.1], green ? 0 : 3, green ? 0.85 : 0.5, 6, 20);
  }
  const extra = [];
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  return { batches: [sw, st, an], extra };
}
