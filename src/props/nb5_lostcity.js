// Lost City: the alkaline hydrothermal field near the summit of the Atlantis Massif, about 800 m down and lit only by
// the camera's lamps. A steep, terraced massif of dark serpentinite (biomes.js) carries white carbonate chimneys:
// fields of slender pinnacles (1-12 m), a few big towers stacked with flanges, and one landmark complex per segment
// modelled on Poseidon (60 m tall, several fused towers, four summit pinnacles, a talus apron of fallen chimney
// pieces). Young, venting surfaces are snow white and finely fingered (static mode 2 rugosity); old ones grey-brown,
// knobby and darkening (rock texture mode 6.x), with cold-water corals on them; demosponges sit on the young flanges.
// Carbonate surfaces use their own variant of the static prop shader (carbMaterial). Flanges are lens-shaped
// shelves 1-1.5 m wide; a pool of warm fluid trapped under each shows as a shimmering, mirror-like underside (own
// material), and a faint heat shimmer rises over the active ones (own material, a few quads, no smoke: these vents
// weep, they do not billow). Pale carbonate veins run across the rock as floor decals.
// Chimney geometry: row lathes around a wandering axis (as vents.js does for sulphide chimneys) with carbonate detail
// at metre and vertex scale; every segment generates its own pool of chimneys, towers and its landmark through the
// rock_gen providers (<= 2 ms slices ahead of the camera), so two visits never look the same.
import * as THREE from 'three';
import { Builder, Batch, TAU, presence, budgetK, CHUNK, vn3, fbm3, sat, sstep, lerp, rotY, pointsClear, placedPoints } from './core.js';
import { MAT } from './materials.js';
import { sv, lostCityTowerOf } from '../biomes.js';
import { applyWater } from '../water.js';
import { pathCache, clearBox, SOFT, seat, put, upTo, mix3, segFor, recipe, lowK, slice, nbFloor, decalRibbon, builderMesh, NBMAT, lab, basePts } from './nb_common.js';
import { poolOf, itemSpots, seatOnItem } from './nb2_common.js';
import { Space } from './nb3_common.js';
import { rockJob, tiered, gridG, paintG, blobG, set3, mixIn } from './rock_recipes.js';
import { pick, chunkRng, once, segSeed, grips, gridded, warmTpl } from './nb4_common.js';
import { encrust, blackCoral } from './nb_shapes.js';
import { mulberry32 } from '../noise.js';

const KEY = 'lostcity';
const H = {};
const sqrtN = (n) => (n < 0 ? -Math.sqrt(-n) : Math.sqrt(n));
const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- on-screen text (sourced; see the zone notes)
export const LC = {
  tower: ['Giant carbonate tower', 'Lost City\'s tallest tower, Poseidon, rises 60 m: the largest known hydrothermal structure when measured.'],
  active: ['Active carbonate chimney', 'These white towers are limestone-like carbonate, not metal sulfide, built by warm alkaline fluid meeting seawater.'],
  active2: ['Active carbonate chimney', 'Vent fluid here is 40-91 °C and strongly alkaline (pH 9-11), far cooler than black smokers above 300 °C.'],
  young: ['Young carbonate spire', 'Young vents grow delicate beehive-like deposits and snow-white branching fingers of carbonate.'],
  inactive: ['Inactive carbonate chimney', 'Old, inactive chimneys turn brown and knobby and are colonised by corals.'],
  bigTower: ['Carbonate tower', 'Individual Lost City chimneys date from 17 years old to about 120,000 years old.'],
  bigTower2: ['Carbonate tower', 'The reactions make hydrogen and methane, which microbes can use as food without sunlight.'],
  bigTower3: ['Carbonate tower', 'Lost City was found in December 2000 by a camera survey from the research ship Atlantis, about 800 m deep.'],
  flange: ['Flange pool', 'Ledges called flanges trap pools of 40-55 °C vent fluid beneath them, with a mirror-like surface.'],
  fallen: ['Fallen chimney', 'Fallen chimney pieces up to several metres long lie at the base of towers, cemented by newer carbonate.'],
  talus: ['Carbonate talus', 'Lost City is the longest-lived hydrothermal system known to date.'],
  serp: ['Serpentinite', 'Heat comes from seawater reacting with mantle rock (serpentinization), not from magma.'],
  vein: ['Carbonate veins', 'Branching carbonate veins run through the rock: one of the four kinds of carbonate deposit mapped here.'],
  coral: ['Cold-water coral', 'Corals are especially abundant at the top of the massif, where strong currents are frequent.'],
  sponge: ['Demosponge', 'Demosponges live on the friable flanges here, with tiny polychaetes, amphipods, ostracods and foraminifera.'],
};

// ---------------------------------------------------------------- resolution per tier
// seg: target vertex spacing around a ring (m); step: row spacing (m); cap: max ring vertices
const RES = {
  low: { seg: 0.44, step: 0.46, cap: 20, bigCap: 48 }, medium: { seg: 0.36, step: 0.38, cap: 26, bigCap: 60 },
  high: { seg: 0.28, step: 0.31, cap: 32, bigCap: 76 }, ultra: { seg: 0.23, step: 0.27, cap: 38, bigCap: 90 },
};
const resOf = (tier) => RES[tier] || RES.high;

// ---------------------------------------------------------------- carbonate colours (linear)
const WHITE = [0.9, 0.9, 0.88], CREAM = [0.84, 0.81, 0.72], GREYB = [0.44, 0.4, 0.34], BROWN = [0.36, 0.3, 0.23], MNOX = [0.13, 0.12, 0.11];
const C3 = [0, 0, 0];
// colour of carbonate with activity A (1 = venting, snow white; 0 = old, grey-brown with dark manganese patches)
function carbCol(x, y, z, A, mn, sd, o) {
  const n1 = vn3(x * 0.8, y * 0.45, z * 0.8, sd + 21), n2 = vn3(x * 3.1, y * 2.3, z * 3.1, sd + 23), n3 = vn3(x * 0.4, y * 0.3, z * 0.4, sd + 27);
  const c = mixIn(set3(C3, GREYB), BROWN, sstep(-0.3, 0.5, n1));
  mixIn(c, MNOX, sstep(0.2, 0.65, n3 + 0.3 * n2) * mn);
  const w = sat(A * 1.15 + 0.25 * n2 - 0.1);
  const cw = 0.92 + 0.1 * n2;
  c[0] += (WHITE[0] * cw - c[0]) * w; c[1] += (WHITE[1] * cw - c[1]) * w; c[2] += (WHITE[2] * cw - c[2]) * w;
  mixIn(c, CREAM, sstep(0.35, 0.8, n1) * 0.35 * w);
  o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
}

// ---------------------------------------------------------------- one carbonate column (generator)
// o: { x, z, y0, H, r0, topK, taper, lean: [lx, lz], act (0..1), age (how much older the base looks), mn, seed, Q,
//      cap: 'dome' | 'broken', flare, big, mode (fx mode: 2 rugose / 6.x rock) }
// Returns { axis(y) -> [cx, cz], Rb(y) -> mean radius, yTop }: flanges and summit pieces attach to it.
function* columnG(b, o) {
  const Q = o.Q, rng = mulberry32(o.seed), sd = o.seed, r0 = o.r0, Hh = o.H, y0 = o.y0 || 0, act = o.act ?? 0.5;
  const topK = o.topK ?? 0.45, taper = o.taper ?? 1.2, lean = o.lean || [0, 0], flare = o.flare ?? 1.3;
  const seg = o.big ? Q.seg * 1.1 : Q.seg, step = o.big ? Q.step * 1.1 : Math.min(Q.step, Math.max(Q.step * 0.55, r0 * 0.8));
  const nu = clampI(Math.round(TAU * r0 * 1.2 / seg), r0 < 0.2 ? 6 : r0 < 0.45 ? 8 : 10, o.big ? Q.bigCap : Q.cap);
  const nRows = Math.max(3, Math.ceil(Hh / step));
  // flutes: one every ~0.6-1 m of girth (a few on a slender spire, dozens on a big tower)
  const nodes = 0.1 + rng() * 0.14, wob = 0.25 + rng() * 0.25, nF = Math.max(5 + Math.floor(rng() * 4), Math.round(TAU * r0 / (0.6 + rng() * 0.4))),
    lobeH = 0.5 + rng() * 0.6, lobeP = rng() * 10, e2 = 0.05 + rng() * 0.12, p2 = rng() * TAU, e3 = 0.03 + rng() * 0.07, p3 = rng() * TAU;
  const capH = Math.min(Hh * 0.3, r0 * topK * (o.cap === 'broken' ? 0.6 : 1.8));
  const Rb = (y) => { const t = sat(y / Hh); return r0 * lerp(1, topK, Math.pow(t, taper)) * (1 + nodes * (vn3(y * 0.35 / Math.max(1, r0), 0.3, 0.7, sd + 5) + 0.5 * vn3(y * 1.1, 0.9, 0.2, sd + 6))) * (1 + (flare - 1) * Math.pow(Math.max(0, 1 - y / (r0 * 1.6)), 2)); };
  const axis = (y) => { const t = sat(y / Hh); return [o.x + lean[0] * y + wob * r0 * vn3(t * 2.1, 0.5, 0.3, sd), o.z + lean[1] * y + wob * r0 * vn3(0.7, t * 2.1, 0.9, sd + 1)]; };
  const rf = 0.9 / seg, crumb = Math.min(0.12, 0.3 * seg);
  const young = act > 0.5, bigK = Math.max(1, Math.min(3, r0 / 1.2)); // lumps grow with the column (a 5 m tower is not a 1 m spire)
  const v0 = yield* gridG(b, nu, nRows, (u, v, i, j, out) => {
    const y = Hh * v, a = u * TAU, ca = Math.cos(a), sa = Math.sin(a);
    let R = Rb(y);
    const px = ca * R, pz = sa * R;
    const shapeK = (1 + e2 * Math.cos(2 * (a - p2 - 0.6 * vn3(0.1, y * 0.2, 0.4, sd + 40))) + e3 * Math.cos(3 * (a - p3 - 0.8 * vn3(0.6, y * 0.25, 0.2, sd + 41))));
    // metre-scale lumps, then the surface character: vertical fingers and flutes (venting) or knobs and pits (old)
    let d = 0.16 * fbm3(px * 1.4 / bigK, y * 0.7 / bigK, pz * 1.4 / bigK, 3, sd + 3);
    // (both characters, weighted: a big tower is fingered where it vents and knobby where it has gone quiet)
    // venting: vertical flutes and drapery (ribs that wander and merge), stacked beehive lobes, fingered crust;
    // amplitudes in metres over R, so a big tower is as rough as a small spire
    const flu = Math.pow(0.5 + 0.5 * Math.sin(a * nF + 2.2 * vn3(ca * 0.8, y * 0.18, sa * 0.8, sd + 2)), 2.5);
    const lob = Math.pow(Math.abs(Math.sin((y / lobeH + lobeP + 0.8 * vn3(ca * 1.3, y * 0.3, sa * 1.3, sd + 7)) * Math.PI)), 0.6);
    const kR = 1 / Math.max(0.3, Rb(y));
    d += act * (Math.min(0.12, 0.28 * kR) * flu + Math.min(0.08, 0.16 * kR) * lob + 0.06 * sqrtN(vn3(px * 4.5, y * 1.6, pz * 4.5, sd + 4)));
    d += (1 - act) * (0.3 * Math.max(0, vn3(px * 2.1 / bigK, y * 2.1 / bigK, pz * 2.1 / bigK, sd + 5) - 0.12) - 0.06 * Math.max(0, vn3(px * 6, y * 6, pz * 6, sd + 8) - 0.3)) + 0.05 * vn3(px * 0.9, y * 0.9, pz * 0.9, sd + 9);
    R *= shapeK * (1 + d);
    R += Math.min(crumb, 0.2 * Rb(y)) * sqrtN(vn3(px * rf, y * rf, pz * rf, sd + 50));
    // the summit: a rounded, lumpy dome, or a broken-off top
    const yc = Hh - capH;
    if (y > yc && capH > 0) { const k = Math.min(0.93, (y - yc) / capH); R *= o.cap === 'broken' ? 1 - 0.35 * k : Math.sqrt(1 - k * k); }
    const c = axis(y);
    out[0] = c[0] + ca * R; out[1] = y0 + y; out[2] = c[1] + sa * R; out[6] = d; out[7] = v;
  });
  // tilt the normals by noise at vertex scale: under the lamps a coarse ring then shades as a crusty mineral, not clay
  { const P = b.P, N = b.N, kj = 0.42, f = rf * 1.1;
    for (let i = v0; i < b.vc; i++) {
      const x = P[i * 3] * f, y = P[i * 3 + 1] * f, z = P[i * 3 + 2] * f;
      const nx = N[i * 3] + kj * vn3(x, y, z, sd + 61), ny = N[i * 3 + 1] + kj * vn3(x, y, z, sd + 62), nz = N[i * 3 + 2] + kj * vn3(x, y, z, sd + 63);
      const l = Math.hypot(nx, ny, nz) || 1; N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
    } }
  yield;
  // close the top
  { const base = v0 + nRows * nu, c = axis(Hh); let cy = 0; for (let i = 0; i < nu; i++) cy += b.P[(base + i) * 3 + 1]; cy /= nu;
    const top = b.v(c[0], cy + (o.cap === 'broken' ? -0.05 : 0.04) * r0, c[1], 0, 1, 0, 1, 1, 1, 0, 0);
    for (let i = 0; i < nu; i++) b.t(top, base + (i + 1) % nu, base + i); }
  const mode = o.mode ?? (act >= 0.45 ? 2 : 6.05 + rng() * 0.9), age = o.age ?? 0.5, mn = o.mn ?? (1 - act) * 0.8;
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, out) => {
    const t = sat((y - y0) / Hh), dd = out[3];
    const A = sat(act + (t - 0.5) * age); // venting tops and flanges stay whiter than the base
    carbCol(x, y, z, A, mn, sd, out);
    const ao = (0.72 + 0.28 * sstep(0, Math.min(2, Hh * 0.3), y - y0)) * (0.74 + 0.36 * sat(0.5 + dd * 2.5)) * (0.9 + 0.1 * Math.max(0, ny));
    out[0] *= ao; out[1] *= ao; out[2] *= ao; out[3] = 0; out[4] = mode;
  });
  return { axis, Rb, yTop: y0 + Hh, y0, nu, mode, H: Hh };
}

// ---------------------------------------------------------------- a flange (lens-shaped shelf) with its pool
// f: { y (local to the column base), a0, hw (half angle), W, th, act, droop, seed }. Adds the shelf to b (same
// colours / mode as its column), the pool underside to pb (pool material) and a heat-shimmer emitter to hz.
// The shelf's inner edge lies inside the column (hidden), its sector ends collapse into the wall.
const PROF = [[-0.3, 2.2], [0, 1.5], [0.45, 0.7], [0.88, 0.3], [1, 0], [0.97, -0.38], [0.9, -0.62], [0.8, -0.2], [0.42, -0.05], [0, -0.2], [-0.3, -0.42]];
function* flangeG(b, pb, hz, col, f, Q, mode, A) {
  const sd = f.seed, y0 = col.y0 || 0, yF = y0 + f.y, c = col.axis(f.y), Rw = col.Rb(f.y);
  const rIn = Rw * 0.62, rw = Rw * 1.12, nu = clampI(Math.round(2 * f.hw * (rw + f.W) / (Q.seg * 0.9)), 6, 28), nv = PROF.length - 1;
  const cov = (u) => Math.sqrt(Math.max(0, 1 - u * u)) * (0.84 + 0.2 * vn3(u * 3, f.y, 0.3, sd + 3));
  const ext = (u) => f.W * cov(u);
  const at = (u, k) => { // profile point k at sector position u (-1..1) -> [x, y, z]
    const a = f.a0 + u * f.hw, e = ext(u), p = PROF[k];
    // (where the shelf narrows to nothing at its ends, the whole profile shrinks into the column)
    const r = p[0] < 0 ? rIn : lerp(rIn, rw + e * p[0], sat(e / (0.3 * f.W)));
    const y = yF + f.th * p[1] * (0.35 + 0.65 * sat(e / (f.W * 0.4))) - f.droop * f.th * (e * Math.max(0, p[0]) / f.W);
    return [c[0] + Math.cos(a) * r, y, c[1] + Math.sin(a) * r];
  };
  const v0 = b.grid(nu, nv, (u, v, i, j, out) => { const p = at(-1 + 2 * u, j); out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; }, { flip: true });
  yield;
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, out) => {
    carbCol(x, y, z, A, (1 - A) * 0.6, sd, out);
    const k = ny < -0.3 ? 0.55 : 1; // the roof over the pool is in shade
    out[0] *= k; out[1] *= k; out[2] *= k; out[3] = 0; out[4] = mode;
  });
  // the pool: a level surface just above the lip, from the wall out under the shelf (alpha fades at its edges)
  if (f.pool && pb) {
    const pv = pb.vc, nr = 3, yP = yF - f.th * 0.47 * 1.0 - 0.01;
    for (let j = 0; j <= nr; j++) for (let i = 0; i <= nu; i++) {
      const u = -0.82 + 1.64 * i / nu, a = f.a0 + u * f.hw, e = ext(u), r = rw * 0.98 + (e * 0.84) * j / nr;
      const fade = sat(e / (f.W * 0.35)) * (j === nr ? 0 : 1) * (i === 0 || i === nu ? 0 : 1);
      pb.v(c[0] + Math.cos(a) * r, yP, c[1] + Math.sin(a) * r, 0, -1, 0, 1, 1, 1, fade, 0);
    }
    for (let j = 0; j < nr; j++) for (let i = 0; i < nu; i++) { const a = pv + j * (nu + 1) + i, d = a + nu + 1; pb.t(a, a + 1, d); pb.t(a + 1, d + 1, d); }
    if (hz && A > 0.45) { const a = f.a0, r = rw + ext(0) * 0.55; hz.push(c[0] + Math.cos(a) * r, yF + f.th * 0.4, c[1] + Math.sin(a) * r, Math.max(0.25, f.W * 0.35), 0.9 + f.W * 0.8); }
  }
  // a spot on the young shelf's top (centre of its reach) where a demosponge can sit: [x, y, z, nx, ny, nz]
  if (hz && hz.spots && A > 0.45 && f.W > 0.7) {
    const p1 = at(0, 1), p2 = at(0, 2), p3 = at(0, 3), sa = [-Math.sin(f.a0), 0, Math.cos(f.a0)], t = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]];
    let n = [sa[1] * t[2] - sa[2] * t[1], sa[2] * t[0] - sa[0] * t[2], sa[0] * t[1] - sa[1] * t[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    hz.spots.push(p2[0], p2[1], p2[2], n[0], n[1], n[2]);
  }
  // stalagmite-like growths up through the young roofs
  if (A > 0.6 && f.W > 0.7) {
    const rng = mulberry32(sd + 77);
    for (let k = 0, n = 1 + Math.floor(rng() * 2.5); k < n; k++) {
      const u = (rng() - 0.5) * 1.2, a = f.a0 + u * f.hw, r = rw + ext(u) * (0.3 + rng() * 0.4);
      yield* columnG(b, { Q, x: c[0] + Math.cos(a) * r, z: c[1] + Math.sin(a) * r, y0: yF + f.th * 0.2, H: 0.25 + rng() * 0.8 * f.W, r0: 0.05 + rng() * 0.07, topK: 0.55, act: 1, seed: sd + 90 + k, mode: 2, flare: 1.1 });
    }
  }
}
// flange set up a column: heights spread, never crowding each other
function flangePlan(rng, Hh, n, Wr, th, poolP, act) {
  const out = [];
  for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
    const y = Hh * (0.18 + 0.68 * rng());
    if (out.some((f) => Math.abs(f.y - y) < 0.9 + th * 2)) continue;
    out.push({ y, a0: rng() * TAU, hw: 0.7 + rng() * 0.9, W: Wr[0] + rng() * (Wr[1] - Wr[0]), th: th * (0.8 + rng() * 0.5), droop: 0.1 + rng() * 0.25, pool: rng() < poolP, act, seed: (rng() * 1e9) | 0 });
    k++;
  }
  return out;
}
// small branching "fingers" on a young summit
function* fingersG(b, col, n, rng, Q) {
  const c = col.axis(col.H * 0.98), R = col.Rb(col.H * 0.98) * 0.5;
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = R * Math.sqrt(rng());
    yield* columnG(b, { Q, x: c[0] + Math.cos(a) * d, z: c[1] + Math.sin(a) * d, y0: col.yTop - R * 0.6, H: 0.2 + rng() * 0.7, r0: 0.035 + rng() * 0.06,
      topK: 0.6, act: 1, seed: (rng() * 1e9) | 0, mode: 2, flare: 1.05, lean: [(rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3] });
  }
}
function finishTpl(b, pb, hz, name, fact) {
  b.band = 0.06;
  const t = b.build();
  t.label = name; t.fact = fact;
  t.pool = pb && pb.vc ? pb.build() : null;
  t.haze = hz && hz.length ? Float32Array.from(hz) : null;
  t.spots = hz && hz.spots && hz.spots.length ? Float32Array.from(hz.spots) : null;
  return t;
}

// Obstacle capsules for a column, stacked along its height (a single fit to a whole complex would wrap the talus
// apron and the gaps between towers in one fat capsule reaching into the flight tube). pad: flange reach.
function colObs(out, col, n, pad) {
  for (let k = 0; k < n; k++) {
    const ya = col.H * k / n, yb = col.H * (k + 1) / n, a = col.axis(ya), c = col.axis(yb);
    let r = 0; for (let q = 0; q <= 4; q++) r = Math.max(r, col.Rb(ya + (yb - ya) * q / 4));
    const rr = r * 1.15 + pad, y0 = col.y0 || 0;
    out.push([a[0], y0 + ya + (k ? 0 : rr * 0.5), a[1], c[0], y0 + yb - rr * 0.5, c[1], rr]);
  }
  return out;
}

// ---------------------------------------------------------------- template kinds
// Pinnacle (1-12 m): kind 0 venting (white, fingered, small flanges), 1 old (grey-brown, knobby, sometimes broken)
export function* spireG(seed, tier, kind) {
  const Q = resOf(tier), rng = mulberry32(seed), b = new Builder(), pb = new Builder(), hz = []; hz.spots = [];
  const young = kind === 0, Hh = 1.5 + 10.5 * Math.pow(rng(), 1.1), r0 = Math.max(0.12, Hh * (0.045 + rng() * 0.04) + rng() * 0.15);
  const act = young ? 0.8 + rng() * 0.2 : rng() * 0.25;
  const col = yield* columnG(b, { Q, x: 0, z: 0, H: Hh, r0, topK: 0.35 + rng() * 0.3, taper: 1 + rng() * 0.6, lean: [(rng() - 0.5) * 0.06, (rng() - 0.5) * 0.06], act, age: 0.4, seed: (rng() * 1e9) | 0, cap: !young && rng() < 0.5 ? 'broken' : 'dome' });
  // fused side columns: a cluster of "Greek columns"
  for (let k = 0, n = Hh > 3 && rng() < 0.6 ? 1 + Math.floor(rng() * 2.5) : 0; k < n; k++) {
    const a = rng() * TAU, h = Hh * (0.3 + rng() * 0.5), rr = r0 * (0.45 + rng() * 0.35), d = r0 * (0.6 + rng() * 0.4);
    yield* columnG(b, { Q, x: Math.cos(a) * d, z: Math.sin(a) * d, H: h, r0: rr, topK: 0.45, lean: [Math.cos(a) * 0.04, Math.sin(a) * 0.04], act: act * (0.7 + rng() * 0.3), age: 0.4, seed: (rng() * 1e9) | 0, mode: col.mode });
  }
  if (young && Hh > 2.5) for (const f of flangePlan(rng, Hh, Math.floor(rng() * (1 + Hh / 4)), [0.35, 0.8], 0.12, 0.6, act)) yield* flangeG(b, pb, hz, col, f, Q, col.mode, act);
  if (young) yield* fingersG(b, col, 5 + Math.floor(rng() * 6), rng, Q);
  const nm = young ? (rng() < 0.5 ? LC.young : rng() < 0.5 ? LC.active : LC.active2) : LC.inactive;
  const t = finishTpl(b, pb, hz, nm[0], nm[1]);
  t.lcAct = act; t.lcR = r0 * 1.6; t.lcH = Hh;
  return t;
}
// Big tower (14-30 m): partly active (white top and flanges over an older base), stacked flanges with pools,
// fused sub-towers, a fingered summit
export function* towerG(seed, tier, k = 0) {
  const Q = resOf(tier), rng = mulberry32(seed), b = new Builder(), pb = new Builder(), hz = []; hz.spots = [];
  const Hh = 14 + 16 * rng(), r0 = 1.3 + rng() * 1.2, act = 0.6 + rng() * 0.3, mode = 2;
  const col = yield* columnG(b, { Q, x: 0, z: 0, H: Hh, r0, topK: 0.3 + rng() * 0.15, taper: 0.9 + rng() * 0.5, act, age: 0.7, seed: (rng() * 1e9) | 0, mode, mn: 0.7 });
  const obs = colObs([], col, 4, 0.6);
  for (let q = 0, n = 1 + Math.floor(rng() * 2.4); q < n; q++) {
    const a = rng() * TAU, h = Hh * (0.3 + rng() * 0.4), rr = r0 * (0.45 + rng() * 0.25), d = r0 * (0.65 + rng() * 0.3);
    const sub = yield* columnG(b, { Q, x: Math.cos(a) * d, z: Math.sin(a) * d, H: h, r0: rr, topK: 0.45, lean: [Math.cos(a) * 0.03, Math.sin(a) * 0.03], act: act * 0.9, age: 0.7, seed: (rng() * 1e9) | 0, mode, mn: 0.7 });
    colObs(obs, sub, 2, 0.5);
    for (const f of flangePlan(rng, h, 1 + Math.floor(rng() * 2), [0.8, 1.3], 0.32, 0.7, act)) yield* flangeG(b, pb, hz, sub, f, Q, mode, sat(act + 0.2));
  }
  b.obs = obs;
  for (const f of flangePlan(rng, Hh, 4 + Math.floor(rng() * 5), [1.0, 1.5], 0.38, 0.8, act)) yield* flangeG(b, pb, hz, col, f, Q, mode, sat(act + (f.y / Hh - 0.5) * 0.6 + 0.15));
  yield* fingersG(b, col, 6 + Math.floor(rng() * 6), rng, Q);
  const nm = [LC.bigTower, LC.bigTower2, LC.bigTower3][k % 3];
  const t = finishTpl(b, pb, hz, nm[0], nm[1]);
  t.lcAct = act; t.lcR = r0 * 2.2; t.lcH = Hh;
  return t;
}
// Fallen chimney: a broken column lying on its side, flat underside on y = 0
export function* fallenG(seed, tier) {
  const Q = resOf(tier), rng = mulberry32(seed), b = new Builder();
  const L = 1.5 + rng() * 4.5, r = 0.25 + rng() * 0.45;
  yield* columnG(b, { Q, x: 0, z: 0, H: L, r0: r, topK: 0.6 + rng() * 0.3, taper: 1, act: rng() * 0.3, seed: (rng() * 1e9) | 0, cap: 'broken', flare: 1 });
  layDown(b, rng);
  const t = finishTpl(b, null, null, LC.fallen[0], LC.fallen[1]);
  t.lcR = L * 0.5;
  return t;
}
// lay vertices >= v0 down along x (centred), flattened on y = 0
function layDown(b, rng, v0 = 0, off = [0, 0], yaw = 0) {
  let x0 = 1e9, x1 = -1e9;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = v0; i < b.vc; i++) { // (x, y, z) -> (y, -x, z): the column's axis becomes +x
    const x = b.P[i * 3], y = b.P[i * 3 + 1], nx = b.N[i * 3], ny = b.N[i * 3 + 1];
    b.P[i * 3] = y; b.P[i * 3 + 1] = -x; b.N[i * 3] = ny; b.N[i * 3 + 1] = -nx;
    x0 = Math.min(x0, y); x1 = Math.max(x1, y);
  }
  let minY = 1e9;
  for (let i = v0; i < b.vc; i++) minY = Math.min(minY, b.P[i * 3 + 1]);
  const cut = minY + 0.18 * (rng ? 0.6 + rng() * 0.6 : 1) * 0.5;
  for (let i = v0; i < b.vc; i++) {
    let x = b.P[i * 3] - (x0 + x1) / 2, y = Math.max(0, b.P[i * 3 + 1] - cut);
    const z = b.P[i * 3 + 2];
    b.P[i * 3] = c * x - s * z + off[0]; b.P[i * 3 + 1] = y; b.P[i * 3 + 2] = s * x + c * z + off[1];
    const nx = b.N[i * 3], nz = b.N[i * 3 + 2];
    b.N[i * 3] = c * nx - s * nz; b.N[i * 3 + 2] = s * nx + c * nz;
  }
}
// The landmark complex, modelled on Poseidon: a main tower (45-60 m), two or three fused towers along its long axis
// (local x), four pinnacles on its summit, flanges stacked up every tower, a talus apron of carbonate blocks and
// fallen chimney pieces around the base. R = footprint radius (biomes.lostCityTowerOf).
export function* landmarkG(seed, tier, R = 9) {
  const Q = resOf(tier), rng = mulberry32(seed), b = new Builder(), pb = new Builder(), hz = []; hz.spots = [];
  const Hh = 45 + 15 * rng(), r0 = R * 0.5, mode = 2, act = 0.78;
  const main = yield* columnG(b, { Q, x: 0, z: 0, H: Hh, r0, topK: 0.22 + rng() * 0.08, taper: 0.8 + rng() * 0.3, act, age: 0.4, seed: (rng() * 1e9) | 0, mode, mn: 0.8, big: true, flare: 1.35 });
  const subs = [];
  for (let q = 0, n = 2 + (rng() < 0.5 ? 1 : 0); q < n; q++) {
    const sd = q % 2 ? -1 : 1, d = r0 * (0.75 + rng() * 0.45) + q * 1.2, h = Hh * (0.35 + rng() * 0.35), rr = r0 * (0.45 + rng() * 0.2);
    const zz = (rng() - 0.5) * r0 * 0.6;
    subs.push(yield* columnG(b, { Q, x: sd * d, z: zz, H: h, r0: rr, topK: 0.35, taper: 1, lean: [sd * 0.02, 0], act: act * 0.92, age: 0.5, seed: (rng() * 1e9) | 0, mode, mn: 0.8, big: rr > 2.2, flare: 1.3 }));
  }
  const obs = colObs([], main, 6, 0.9);
  for (const sc of subs) colObs(obs, sc, 3, 0.7);
  b.obs = obs;
  // four summit pinnacles (one about a metre across)
  const top = main.axis(Hh * 0.97), rt = main.Rb(Hh * 0.97);
  for (let k = 0; k < 4; k++) {
    const a = k * TAU / 4 + rng() * 0.8, d = rt * (0.15 + rng() * 0.45);
    yield* columnG(b, { Q, x: top[0] + Math.cos(a) * d, z: top[1] + Math.sin(a) * d, y0: Hh - rt * 0.8, H: 2.5 + rng() * 5, r0: k ? 0.25 + rng() * 0.25 : 0.5, topK: 0.4, act: 0.9, seed: (rng() * 1e9) | 0, mode, flare: 1.2 });
  }
  // flanges: shelves stacked up the towers, most holding a pool
  // (most of them low down, within reach of the lamps; a few higher up)
  const fls = [...flangePlan(rng, Hh * 0.42, 8 + Math.floor(rng() * 5), [1.0, 1.5], 0.45, 0.8, act), ...flangePlan(rng, Hh * 0.92, 4, [1.0, 1.5], 0.45, 0.7, act).filter((f) => f.y > Hh * 0.42)];
  for (const f of fls) yield* flangeG(b, pb, hz, main, f, Q, mode, sat(act + (f.y / Hh - 0.3) * 0.7));
  for (const s of subs) for (const f of flangePlan(rng, s.H, 2 + Math.floor(rng() * 3), [0.9, 1.4], 0.38, 0.7, act)) yield* flangeG(b, pb, hz, s, f, Q, mode, sat(act + (f.y / s.H - 0.4) * 0.6));
  // talus apron: angular carbonate blocks, and fallen chimney pieces up to several metres long
  for (let k = 0, n = 14 + Math.floor(rng() * 10); k < n; k++) {
    const a = rng() * TAU, d = r0 * (0.9 + rng() * 0.9) + rng() * 2.5, x = Math.cos(a) * d * 1.3, z = Math.sin(a) * d * 0.85;
    const s = 0.35 + rng() * 0.9, sx = s * (0.8 + rng() * 0.6), sy = s * (0.5 + rng() * 0.4), sz = s * (0.8 + rng() * 0.6), bs = (rng() * 1e6) | 0, yaw = rng() * TAU, cy = Math.cos(yaw), sY = Math.sin(yaw);
    const planes = [];
    for (let q = 0; q < 5; q++) { const pa = rng() * TAU, pe = (rng() - 0.3) * 1.4; planes.push([Math.cos(pa) * Math.cos(pe), Math.sin(pe), Math.sin(pa) * Math.cos(pe), 0.5 + rng() * 0.3]); }
    const bv = yield* blobG(b, 1, (ux, uy, uz, o) => {
      const dd = 1 + 0.15 * vn3(ux * 2 + bs, uy * 2, uz * 2, bs);
      let px = ux * dd, py = uy * dd, pz = uz * dd;
      for (const pl of planes) { const e = px * pl[0] + py * pl[1] + pz * pl[2]; if (e > pl[3]) { px -= (e - pl[3]) * pl[0]; py -= (e - pl[3]) * pl[1]; pz -= (e - pl[3]) * pl[2]; } }
      px *= sx; py *= sy; pz *= sz;
      o[0] = x + cy * px - sY * pz; o[1] = Math.max(0, sy * 0.55 + py); o[2] = z + sY * px + cy * pz;
    });
    const A = rng() * 0.35;
    yield* paintG(b, bv, (i, px, py, pz, nx, ny, nz, o) => { carbCol(px, py, pz, A, 0.7, bs, o); const ao = 0.6 + 0.4 * sat(py / (sy * 1.5)); o[0] *= ao; o[1] *= ao; o[2] *= ao; o[3] = 0; o[4] = mode; });
  }
  for (let k = 0, n = 3 + Math.floor(rng() * 3); k < n; k++) {
    const v1 = b.vc, a = rng() * TAU, d = r0 * (1.1 + rng() * 0.7), L = 2 + rng() * 4.5;
    yield* columnG(b, { Q, x: 0, z: 0, H: L, r0: 0.35 + rng() * 0.5, topK: 0.7, taper: 1, act: rng() * 0.3, seed: (rng() * 1e9) | 0, cap: 'broken', flare: 1, mode });
    layDown(b, rng, v1, [Math.cos(a) * d * 1.25, Math.sin(a) * d * 0.85], a + Math.PI / 2 + (rng() - 0.5) * 0.8);
  }
  const t = finishTpl(b, pb, hz, LC.tower[0], LC.tower[1]);
  t.lcR = r0; t.lcH = Hh;
  return t;
}

// ---------------------------------------------------------------- materials
// Carbonate: the static prop shader (materials.js) with three changes for this zone, as its own program.
//  - a crusted, porous micro-relief (two scales of tiling-broken triplanar noise, faded out where it would alias);
//  - settled sediment pale instead of beige (it is carbonate silt on carbonate);
//  - a small self-lit floor tied to the lamps: the light the lamps bounce around a field of white carbonate, which
//    keeps pale towers faintly readable as silhouettes out to 30-40 m (dark rock gets almost none of it).
function carbMaterial() {
  const base = MAT.static, m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh, r) => {
    const keep = base.userData.shader;
    base.onBeforeCompile(sh, r);
    base.userData.shader = keep; m.userData.shader = sh;
    sh.fragmentShader = sh.fragmentShader
      .replace('diffuseColor.rgb *= 0.8 + 0.34 * d;', 'diffuseColor.rgb *= 0.92 + 0.12 * d;') // (fainter polyp dots: carbonate pores, not coral)
      .replace('vec3(0.64, 0.6, 0.52) * (0.85 + 0.3 * pB.g), dust)', 'vec3(0.8, 0.79, 0.75) * (0.9 + 0.2 * pB.g), dust * 0.6)')
      .replace('normal = pBump(-vViewPosition, normal, vec2(dFdx(pH), dFdy(pH)) * pBumpK, faceDirection);', /* glsl */`
        {
          float ck = nrIndex(vWPos.xz);
          vec4 c1 = nrTri(vWPos, pW, 0.5, ck), c2 = nrTri(vWPos, pW, 2.0, ck + 3.0);
          float pores = smoothstep(0.6, 0.78, c1.a);
          float crust = c2.r * 0.45 + c1.g * 0.4 - pores * 0.7;
          float nearK = 1.0 - smoothstep(0.02, 0.09, length(fwidth(vWPos)));
          pH = mix(pH, crust, 0.65 * nearK);
          pBumpK = mix(pBumpK, 0.085, nearK);
          diffuseColor.rgb *= 1.0 - 0.1 * pores * nearK;
        }
        normal = pBump(-vViewPosition, normal, vec2(dFdx(pH), dFdy(pH)) * pBumpK, faceDirection);`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uLamp * 0.09 * smoothstep(0.2, 0.6, dot(diffuseColor.rgb, vec3(0.333)));`);
  };
  m.customProgramCacheKey = () => 'water:nb5-lc-carb:' + base.customProgramCacheKey();
  return m;
}
// Pool of warm fluid under a flange, seen from below: a level, mirror-like interface. It reflects the lamp-lit roof
// and the water: silvery, with slow ripples (noise periods 1-2 m divide the 1024 m rebase). aFx.x = edge alpha.
function poolMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  return applyWater(m, {
    key: 'nb5-lc-pool', noLight: true,
    vertexHead: 'attribute vec2 aFx; varying vec2 vFx; uniform float uTime;', fragmentHead: 'varying vec2 vFx;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          vec3 toP = vWPos - cameraPosition;
          float d = length(toP);
          vec4 n1 = texture2D(uNoiseTex, vWPos.xz / 2.0 + vec2(uTime * 0.021, uTime * 0.013));
          vec4 n2 = texture2D(uNoiseTex, vWPos.xz / 1.0 - vec2(uTime * 0.017, uTime * 0.029));
          float rip = n1.r * 0.6 + n2.g * 0.4;
          float lamp = uLamp * 5.0 * exp(-uSigma.g * d) / (1.0 + 0.05 * d * d);
          float graze = 0.55 + 0.45 * pow(1.0 - abs(toP.y) / max(d, 1e-3), 2.0);   // a mirror: brighter at grazing angles
          vec3 col = vec3(0.72, 0.78, 0.8) * (lamp * (0.55 + 0.9 * rip) + uAmbientScale * 0.05) * graze;
          col += vec3(0.9, 0.95, 1.0) * pow(n2.b, 7.0) * lamp * 1.6;                 // glints wandering over it
          diffuseColor = vec4(col, vFx.x * 0.92);
        }`);
    },
  });
}
// Heat shimmer: a few camera-facing quads over active flanges and summits, faint wavering streaks rising through
// them (no smoke). aCorner = (-1..1 across, 0..1 up), aP = (half width, height, phase). Only local coordinates and
// time feed the pattern, so the floating origin cannot shift it.
function hazeMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  return applyWater(m, {
    key: 'nb5-lc-haze', noLight: true,
    vertexHead: 'attribute vec2 aCorner; attribute vec3 aP; varying vec2 vC; varying float vPh; uniform float uTime;',
    fragmentHead: 'varying vec2 vC; varying float vPh;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', /* glsl */`
        vec3 c = position + vec3(0.0, aCorner.y * aP.y, 0.0);
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        mvPosition.x += aCorner.x * aP.x * (1.0 + 0.4 * aCorner.y) + sin(uTime * 0.9 + aP.z * 6.0 + aCorner.y * 3.0) * 0.06 * aCorner.y;
        gl_Position = projectionMatrix * mvPosition;
        vC = aCorner; vPh = aP.z;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          float d = length(vWPos - cameraPosition);
          vec4 n = texture2D(uNoiseTex, vec2(vC.x * 0.35 + vPh * 3.7, vC.y * 0.45 - uTime * 0.23 + vPh));
          vec4 n2 = texture2D(uNoiseTex, vec2(vC.x * 0.8 - vPh * 1.3, vC.y * 0.9 - uTime * 0.41));
          float st = abs(n.r * 0.65 + n2.g * 0.35 - 0.5) * 2.0;               // thin wavering filaments
          float a = (1.0 - vC.x * vC.x) * pow(sin(3.14159 * clamp(vC.y, 0.0, 1.0)), 0.8) * (1.0 - smoothstep(0.05, 0.3, st));
          float lamp = uLamp * 4.0 * exp(-uSigma.g * d) / (1.0 + 0.05 * d * d);
          diffuseColor = vec4(vec3(0.75, 0.8, 0.82) * (lamp + 0.02), a * 0.13 * smoothstep(1.0, 3.0, d));
        }`);
    },
  });
}
function hazeMesh(em) {
  const n = em.length / 6;
  if (!n) return null;
  const pos = new Float32Array(n * 12), cor = new Float32Array(n * 8), ap = new Float32Array(n * 12), idx = new Uint16Array(n * 6), C = [-1, 0, 1, 0, 1, 1, -1, 1];
  for (let q = 0; q < n; q++) {
    for (let c = 0; c < 4; c++) {
      const v = q * 4 + c;
      pos[v * 3] = em[q * 6]; pos[v * 3 + 1] = em[q * 6 + 1]; pos[v * 3 + 2] = em[q * 6 + 2];
      cor[v * 2] = C[c * 2]; cor[v * 2 + 1] = C[c * 2 + 1];
      ap[v * 3] = em[q * 6 + 3]; ap[v * 3 + 1] = em[q * 6 + 4]; ap[v * 3 + 2] = em[q * 6 + 5];
    }
    const b0 = q * 4, o = q * 6;
    idx[o] = b0; idx[o + 1] = b0 + 1; idx[o + 2] = b0 + 2; idx[o + 3] = b0; idx[o + 4] = b0 + 2; idx[o + 5] = b0 + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  g.setAttribute('aP', new THREE.BufferAttribute(ap, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 4;
  const m = new THREE.Mesh(g, H.mat.haze);
  m.matrixAutoUpdate = false;
  m.renderOrder = 2;
  m.userData.lod = 'near';
  return m;
}

// ---------------------------------------------------------------- templates, providers, recipe
const SERP = [{ r: 'cracked', litho: 'greenstone', growth: 0 }, { r: 'boulder', litho: 'greenstone', kind: 'angular', growth: 0 }, { r: 'boulder', litho: 'greenstone', kind: 'block', growth: 0 }];
const TALUS = [{ r: 'boulder', litho: 'limestone', kind: 'angular', growth: 0 }, { r: 'boulder', litho: 'limestone', kind: 'block', growth: 0 }];
function* named(it, nm) { const t = yield* it; if (t) lab(t, nm[0], nm[1]); return t; }
export const recipeOf = (g) => recipe(g, 'nb5lc', (g) => {
  const u = (k) => sv(g, 520 + k);
  // fields: pinnacle field density; young: share of venting spires; towers: chance of a big tower per chunk
  return { fields: 0.8 + 0.6 * u(0), young: 0.35 + 0.45 * u(1), towers: 0.35 + 0.5 * u(2), talus: 0.5 + 0.9 * u(3), serp: 0.5 + 0.9 * u(4), veins: 0.4 + 0.9 * u(5), coral: 0.4 + 0.8 * u(6), upW: 0.55 + 0.3 * u(7) };
});
export function initLostCity(tier) {
  H.mat = { pool: poolMaterial(), haze: hazeMaterial(), carb: carbMaterial() };
  // startup fallbacks (low resolution; every segment generates its own)
  const run = (it) => { let r; do r = it.next(); while (!r.done); return r.value; };
  H.spire = [run(spireG(9101, 'low', 0)), run(spireG(9102, 'low', 1)), run(spireG(9103, 'low', 0))].map((t) => warmTpl(t));
  H.tower = [run(towerG(9111, 'low'))];
  H.fallen = [run(fallenG(9121, 'low'))];
  H.serp = [run(named(rockJob(SERP[0], 9131), LC.serp))];
  H.talus = [run(named(rockJob(TALUS[0], 9141), LC.talus))];
  H.coral = [0, 1, 2].map((i) => lab(blackCoral(9151 + i, { h: 0.35 + i * 0.15 }), LC.coral[0], LC.coral[1]));
  H.sponge = [0, 1, 2].map((i) => { const t = encrust(9161 + i, { r: 0.08 + i * 0.04, h: 0.05 + i * 0.02, lobes: 0.6, detail: 1 }); t.solid = false; return lab(t, LC.sponge[0], LC.sponge[1]); });
  return H;
}
// the landmark plus its lookup structures (obstacle capsules, base points), each in a step of its own
function* landmarkJob(seg, tier) {
  const T = lostCityTowerOf(seg), t = yield* landmarkG(segSeed(seg, 0, 0x3c6ef372), tier, T ? T.R : 9);
  yield; t.capsules(1, 1, 6);
  yield; basePts(t);
  return t;
}
export function lostCityProviders(provide) {
  provide(KEY, 'lcLandmark', 1, (seg, k, tier) => landmarkJob(seg, tier), 0);
  provide(KEY, 'lcSpire', 10, (seg, k, tier) => gridded(spireG(segSeed(seg, k, 0x9e3779b9), tier, (k % 5) < 2 + Math.round(sv(seg, 521) * 2) ? 0 : 1)), 1);
  provide(KEY, 'lcTower', 3, (seg, k, tier) => gridded(towerG(segSeed(seg, k, 0x85ebca6b), tier, k + (seg.seed >>> 5))), 1);
  provide(KEY, 'lcFallen', 4, (seg, k, tier) => fallenG(segSeed(seg, k, 0xc2b2ae35), tier), 2);
  provide(KEY, 'lcSerp', 5, (seg, k, tier) => gridded(named(rockJob(tiered(SERP[k % SERP.length], tier), segSeed(seg, k, 0x27d4eb2f)), LC.serp)), 2);
  provide(KEY, 'lcTalus', 4, (seg, k, tier) => named(rockJob(tiered(TALUS[k % TALUS.length], tier), segSeed(seg, k, 0x165667b1)), LC.talus), 2);
  provide(KEY, 'lcCoral', 4, (seg, k) => once(() => lab(blackCoral(segSeed(seg, k, 0x7feb352d) % 100000, { h: 0.3 + 0.12 * k }), LC.coral[0], LC.coral[1]))(), 3);
}

// ---------------------------------------------------------------- helpers
// item-local point -> chunk-local [x, y, z]
const toChunk = (it, px, py, pz) => { const R = it.R, x = px * it.sx, y = py * it.sy, z = pz * it.sz; return [R[0] * x + R[1] * y + R[2] * z + it.x, R[3] * x + R[4] * y + R[5] * z + it.y, R[6] * x + R[7] * y + R[8] * z + it.z]; };
// pools and shimmer of a placed chimney: its pool template goes into the pool batch with the same transform
function dressItem(ctx, it, pools, haze, rng) {
  const t = it.tpl;
  if (t.pool) pools.add(t.pool, it.x, it.y, it.z, it.R, it.sx, it.sy, it.sz, 1, 1, 1, 1);
  if (t.haze) for (let i = 0; i < t.haze.length; i += 5) {
    const p = toChunk(it, t.haze[i], t.haze[i + 1], t.haze[i + 2]);
    haze.push(p[0], p[1], p[2], t.haze[i + 3] * it.sx, t.haze[i + 4] * it.sy, rng());
  }
}
// Rhythm along a segment (0.45..1.35): dense spire clusters alternate with open terraces where the view reaches down
// the massif; wavelength and phase are the segment's own.
function rhythm(g, s) {
  if (!g) return 1;
  const L = 110 + 80 * sv(g, 530), ph = sv(g, 531) * TAU;
  return 0.9 + 0.45 * Math.sin((s - g.start) / L * TAU + ph);
}
// where a segment's passage between two towers is (s), away from its landmark; null if it has none
export function passageOf(g) { // (exported for dev tools)
  if (!g || g.key !== KEY || sv(g, 532) < 0.15) return null;
  const T = lostCityTowerOf(g), L = g.end - g.start;
  let s = g.start + L * (0.62 + 0.2 * sv(g, 533));
  if (T && Math.abs(s - T.s) < 90) s = T.s + (s > T.s ? 90 : -90);
  return s > g.start + 100 && s < g.end - 100 ? s : null;
}
// away from the landmark complex of any lostcity segment in the chunk
function offLandmark(ctx, x, s, r) {
  for (const g of ctx.segments) { const T = lostCityTowerOf(g); if (T && Math.hypot(x - T.x, s - T.s) < T.Rb + r + 1) return false; }
  return true;
}

// ---------------------------------------------------------------- chain A: chimneys, towers, the landmark
export function* layoutLcA(ctx) {
  const Y = slice(2); // (single placements here can cost a few ms: seating, surface spots, grips)
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rc0 = recipeOf(g0), rng = chunkRng(ctx, 0x1c51);
  const st = new Batch(H.mat.carb, 160000); st.lod = 'mid';
  const sm = new Batch(H.mat.carb, 60000 * lk); sm.lod = 'near';
  const pools = new Batch(H.mat.pool, 30000); pools.lod = 'near'; pools.soft = true;
  const deco = new Batch(MAT.sway, 9000 * lk); deco.lod = 'near'; deco.soft = true;
  const spg = new Batch(MAT.static, 4000 * lk); spg.lod = 'near'; spg.soft = true;
  const labels = [], pois = [], haze = [], sp = new Space(), olds = [];
  const upSide = sv(g0, 1) < 0.5 ? -1 : 1;
  // ---- the landmark complex
  for (const g of ctx.segments) {
    const T = lostCityTowerOf(g);
    if (!T || T.s < ctx.s0 || T.s >= ctx.s1) continue;
    const lm = poolOf(g, 'lcLandmark', null, 1);
    let tpl = lm && lm[0];
    if (!tpl) { // not generated yet (boot, zone jump): build it here, in slices
      const it = landmarkJob(g, ctx.tier);
      let r; for (;;) { r = it.next(); if (r.done) break; if (Y.over()) { yield; Y.reset(); } }
      tpl = r.value;
    }
    const dxs = (pc.x(T.s + 2) - pc.x(T.s - 2)) / 4, l = Math.hypot(dxs, 1), c = dxs / l, s1 = 1 / l; // local x along the path
    const R = [c, 0, s1, 0, 1, 0, -s1, 0, c];
    let ok = false;
    const P = [T.x, 0, T.s];
    for (let k = 0; k < 8 && !ok; k++) { // keep its whole body out of the flight tube (push it outward if needed)
      P[0] = T.x + T.side * k * 0.8; P[1] = fs.at(P[0], P[2]); P[2] = T.s;
      seat(fs, tpl, R, 1, 1, 1, P, null, 0.25);
      ok = pointsClear(ctx, placedPoints(tpl, P[0], P[1], P[2], R, 1, 1, 1, 600), 0.4);
    }
    if (!ok) continue;
    if (!put(ctx, st, tpl, P[0], P[1], P[2], R, 1, 1, 1, [1, 1, 1], 1)) continue;
    st.tag(0, LC.tower[0], LC.tower[1]);
    dressItem(ctx, st.last, pools, haze, rng);
    sp.add(P[0], P[2], T.Rb);
    const py = pc.y(T.s), xf = P[0] - T.side * (tpl.lcR + 1.5);
    pois.push({ type: 'lc-tower', x: xf, y: py + 11, s: T.s, r: 5, data: { name: LC.tower[0], fact: LC.tower[1], yh: py + 0.5 } });
    labels.push([LC.flange[0], P[0] - T.side * tpl.lcR * 0.9, py + 3, T.s, LC.flange[1]]);
  }
  yield;
  // ---- big towers. placeTower: a tower at s, `side` of the route, its body `gap` m clear of the path line (pushed
  // outward until its whole mesh clears the flight tube)
  const placeTower = (g, s, side, gap, steep = 0.7) => {
    const tpl = pick(rng, poolOf(g, 'lcTower', H.tower, 2)), R = rotY(rng() * TAU);
    for (let k = 0; k < 6; k++) {
      const x = pc.x(s) + side * (tpl.lcR + gap + k * 0.8);
      if (!sp.free(x, s, tpl.lcR + 0.5) || !offLandmark(ctx, x, s, tpl.lcR)) return null;
      fs.at(x, s);
      if (fs.ny < steep) return null;
      const P = [x, fs.at(x, s), s];
      seat(fs, tpl, R, 1, 1, 1, P, null, 0.15 + (1 - fs.ny) * tpl.lcR);
      if (!pointsClear(ctx, placedPoints(tpl, P[0], P[1], P[2], R, 1, 1, 1, 400), 0.35)) continue;
      if (!put(ctx, st, tpl, P[0], P[1], P[2], R, 1, 1, 1, [1, 1, 1], 1)) return null;
      dressItem(ctx, st.last, pools, haze, rng);
      sp.add(x, s, tpl.lcR);
      return st.last;
    }
    return null;
  };
  // a passage once per segment: two towers either side of the route, the camera threading between them
  for (const g of ctx.segments) {
    const ps = passageOf(g);
    if (ps === null || ps < ctx.s0 || ps >= ctx.s1) continue;
    placeTower(g, ps, 1, 1.2, 0.55); placeTower(g, ps + (rng() - 0.5) * 6, -1, 1.2, 0.55);
    yield;
  }
  // and up to one or two more a chunk, beside the route, more of them where the segment's rhythm is dense
  const nT = rng() < rc0.towers * bk * rhythm(g0, ctx.s0 + 32) ? 1 + (rng() < 0.3 ? 1 : 0) : 0;
  for (let k = 0, tries = 0; k < nT && tries < 12; tries++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 6 + rng() * (CHUNK - 12), g = segFor(ctx, s, KEY);
    if (!g) continue;
    const side = rng() < rc0.upW ? upSide : -upSide, it = placeTower(g, s, side, 4 + rng() * 8);
    if (!it) continue;
    const tpl = it.tpl, x = it.x;
    k++;
    // a flange pool close to the route: the camera may stop to look up at it
    if (tpl.haze && pois.length < 3 && Math.abs(x - pc.x(s)) < 16) {
      const h = tpl.haze, q = toChunk(st.last, h[0], h[1], h[2]);
      pois.push({ type: 'lc-flange', x: q[0], y: q[1] - 0.6, s: ctx.s0 - q[2], r: 1.5, data: { name: LC.flange[0], fact: LC.flange[1] } });
      labels.push([LC.flange[0], q[0], q[1] - 0.5, ctx.s0 - q[2], LC.flange[1]]);
    }
  }
  yield;
  // ---- pinnacle fields: clusters of slender spires on the terrace treads, spread along the chunk (stratified in s,
  // alternating sides, most within lamp reach) so a few always stand in the light
  const nF = Math.round((5 + rng() * 3) * rc0.fields * bk * rhythm(g0, ctx.s0 + 32));
  for (let f = 0; f < nF; f++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 2 + (f + rng()) * (CHUNK - 4) / nF, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const side = (f % 2 ? rng() < rc0.upW : rng() < 0.45) ? upSide : -upSide;
    const x = pc.x(s) + side * (3.5 + Math.pow(rng(), 1.4) * 16), R0 = 1.8 + rng() * 4, n = Math.round((5 + rng() * 9) * (0.7 + 0.3 * lk));
    const pool = poolOf(g, 'lcSpire', H.spire, 3);
    for (let q = 0, tries = 0; q < n && tries < n * 3; tries++) {
      if (Y.over()) { yield; Y.reset(); }
      const a = rng() * TAU, d = R0 * Math.pow(rng(), 0.75), px = x + Math.cos(a) * d, ps = s + Math.sin(a) * d;
      let tpl = pick(rng, pool);
      if ((tpl.lcAct > 0.5) !== (rng() < rc0.young)) tpl = pick(rng, pool); // lean the mix toward this segment's share
      const sc = 0.75 + rng() * 0.5, r = tpl.lcR * sc;
      if (!sp.free(px, ps, r) || !offLandmark(ctx, px, ps, r)) continue;
      fs.at(px, ps);
      if (fs.ny < 0.62) continue;
      const R = rotY(rng() * TAU), P = [px, fs.at(px, ps), ps];
      seat(fs, tpl, R, sc, sc, sc, P, null, 0.05 + (1 - fs.ny) * r * 1.2);
      if (!clearBox(pc, P[0], P[2], P[1], P[1] + tpl.lcH * sc, r)) continue;
      const b = tpl.lcH * sc > 5 ? st : sm;
      if (!put(ctx, b, tpl, P[0], P[1], P[2], R, sc, sc, sc, [1, 1, 1], 1)) continue;
      sp.add(px, ps, r);
      dressItem(ctx, b.last, pools, haze, rng);
      if (tpl.lcAct < 0.5) olds.push({ it: b.last, g });
      q++;
    }
  }
  yield;
  // ---- cold-water corals on the old, inactive chimneys
  for (const { it, g } of olds) {
    if (Y.over()) { yield; Y.reset(); }
    const spots = itemSpots(it, ctx, 16, 0.25);
    for (let q = 0, n = 0; q < spots.length && n < 1 + rng() * 3 * rc0.coral; q++) {
      if (rng() > 0.45 * lk) continue;
      const p = spots[(q * 7) % spots.length], tpl = pick(rng, poolOf(g, 'lcCoral', H.coral, 2));
      const sc = 0.7 + rng() * 0.6, R = upTo(mix3([0, 1, 0], p.n, 0.35), rng() * TAU), Pp = [p.x, p.y, p.s];
      if (!seatOnItem(it, ctx.s0, tpl, R, sc, Pp, 0.02) || !grips(it, ctx.s0, tpl, R, sc, sc, sc, Pp)) continue;
      if (!clearBox(pc, Pp[0], Pp[2], Pp[1], Pp[1] + (tpl.maxY - tpl.minY) * sc, 0.15, SOFT)) continue;
      const col = rng() < 0.6 ? [1, 0.97, 0.92] : [1, 0.62, 0.38];
      if (put(ctx, deco, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, sc, 'item')) n++;
    }
  }
  // ---- demosponges on the young, friable flanges (spots recorded on each shelf's top when it was built)
  let nSp = 0;
  for (const b of [st, sm]) for (const it of b.items) {
    const S = it.tpl.spots;
    if (!S) continue;
    for (let i = 0; i < S.length; i += 6) {
      if (rng() > 0.4 * lk || nSp > 24) continue;
      const p = toChunk(it, S[i], S[i + 1], S[i + 2]), R0 = it.R;
      const n = [R0[0] * S[i + 3] + R0[1] * S[i + 4] + R0[2] * S[i + 5], R0[3] * S[i + 3] + R0[4] * S[i + 4] + R0[5] * S[i + 5], R0[6] * S[i + 3] + R0[7] * S[i + 4] + R0[8] * S[i + 5]];
      const tpl = pick(rng, H.sponge), sc = (0.6 + rng() * 0.5) * Math.min(1.2, it.sx), R = upTo(n, rng() * TAU), e = 0.03 * sc;
      const x = p[0] - n[0] * e, y = p[1] - n[1] * e, ss = ctx.s0 - (p[2] - n[2] * e);
      if (!clearBox(pc, x, ss, y, y + 0.2, 0.15, SOFT)) continue;
      const col = rng() < 0.5 ? [0.95, 0.85, 0.55] : [0.82, 0.8, 0.74];
      if (put(ctx, spg, tpl, x, y, ss, R, sc, sc, sc, col, 1, 'item')) nSp++;
    }
  }
  const extra = [];
  const hm = hazeMesh(haze);
  if (hm) extra.push(hm);
  return { batches: [st, sm, pools, deco, spg], extra, labels, pois };
}

// ---------------------------------------------------------------- chain B: the ground: serpentinite, talus, fallen chimneys, veins
export function* layoutLcB(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rc0 = recipeOf(g0), rng = chunkRng(ctx, 0x1c52);
  const st = new Batch(MAT.static, 40000 * bk); st.lod = 'mid';
  const sm = new Batch(MAT.static, 16000 * bk * lk); sm.lod = 'near';
  const dec = new Builder(), labels = [], sp = new Space();
  const place = (b, tpl, x, s, sc, sy, col, tilt) => {
    if (!sp.free(x, s, tpl.r * sc) || !offLandmark(ctx, x, s, tpl.r * sc)) return false;
    fs.at(x, s);
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], tilt), rng() * TAU), P = [x, fs.at(x, s), s];
    seat(fs, tpl, R, sc, sy, sc, P, null, 0.06 + (tpl.maxY - tpl.minY) * sy * 0.15 + (1 - fs.ny) * tpl.r * sc * 0.5);
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc)) return false;
    if (!put(ctx, b, tpl, P[0], P[1], P[2], R, sc, sy, sc, col, 1)) return false;
    sp.add(x, s, tpl.r * sc * 0.85);
    return true;
  };
  // serpentinite outcrops: dark, greenish blocks breaking out of the slopes and terrace edges
  const nS = Math.round((4 + rng() * 6) * rc0.serp * bk);
  for (let k = 0, tries = 0; k < nS && tries < nS * 3; tries++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const tpl = pick(rng, poolOf(g, 'lcSerp', H.serp, 2)), sc = 0.6 + Math.pow(rng(), 1.3) * 2, x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (4 + Math.pow(rng(), 1.1) * 24), dk = 0.38 + rng() * 0.12;
    if (place(st, tpl, x, s, sc, sc * (0.6 + rng() * 0.5), [dk * 0.95, dk * 1.04, dk * 0.96], 0.6)) k++;
  }
  yield;
  // talus: fallen carbonate blocks and broken chimney pieces scattered below the risers
  const nT = Math.round((3 + rng() * 6) * rc0.talus * bk * lk);
  for (let k = 0, tries = 0; k < nT && tries < nT * 3; tries++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, KEY);
    if (!g) continue;
    const x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (2 + Math.pow(rng(), 1.2) * 20), fallen = rng() < 0.4;
    const tpl = fallen ? pick(rng, poolOf(g, 'lcFallen', H.fallen, 2)) : pick(rng, poolOf(g, 'lcTalus', H.talus, 2));
    const sc = fallen ? 0.8 + rng() * 0.4 : 0.35 + rng() * 0.6, gr = 0.36 + rng() * 0.16;
    if (place(fallen ? st : sm, tpl, x, s, sc, sc * (fallen ? 1 : 0.6 + rng() * 0.4), fallen ? [1, 1, 1] : [gr, gr * 0.93, gr * 0.82], fallen ? 0.85 : 0.7)) k++;
  }
  yield;
  // anastomosing carbonate veins: pale branching lines across the rock (floor decals)
  const nV = Math.round((2 + rng() * 4) * rc0.veins * bk);
  let vlab = false;
  for (let k = 0; k < nV; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + 4 + rng() * (CHUNK - 8), x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (1 + rng() * 14);
    let h = rng() * TAU;
    const walk = (x0, s0, n, w) => {
      const pts = [];
      let px = x0, ps = s0;
      for (let i = 0; i < n; i++) { pts.push(px, ps); h += (rng() - 0.5) * 0.7; px += Math.cos(h) * 0.45; ps += Math.sin(h) * 0.45; }
      decalRibbon(dec, fs, ctx, pts, w, [0.62, 0.61, 0.57], 3, 0.85);
      return pts;
    };
    const main = walk(x, s, 8 + Math.floor(rng() * 12), 0.05 + rng() * 0.07);
    for (let b = 0, nb = 1 + Math.floor(rng() * 3); b < nb; b++) { // branches that split off and rejoin
      const i = 2 * Math.floor(rng() * (main.length / 2 - 1));
      h += (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.6);
      walk(main[i], main[i + 1], 4 + Math.floor(rng() * 7), 0.03 + rng() * 0.04);
    }
    if (!vlab && Math.abs(x - pc.x(s)) < 10) { labels.push([LC.vein[0], x, fs.at(x, s) + 0.2, s, LC.vein[1]]); vlab = true; }
  }
  const extra = [];
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'near') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  return { batches: [st, sm], extra, labels };
}
