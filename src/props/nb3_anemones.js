// Sea anemones and their relatives, built for the anemone fields and the jellyfish lake. Every builder
// is a generator (yields every few dozen tentacles) so per-segment palettes can be made in short slices
// (rock_gen.js provide()); drain() runs one synchronously. Colours are baked (linear RGB): each
// template is one colour morph, so a segment's palette decides which morphs appear there.
// Templates use the NB3 anemone material (see nb3_common.js for the aFx layout). Base at local y = 0.
import { Builder, TAU, vn3, sat, sstep, lerp } from './core.js';
import { mulberry32 } from '../noise.js';
import { setBase } from './nb_common.js';

const GOLD = Math.PI * (3 - Math.sqrt(5));
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scl = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export function drainG(it) { let r; do r = it.next(); while (!r.done); return r.value; }

// One tentacle: polyline pts, radii, gradient colour col(t) -> [r,g,b], sway amplitude at the tip.
function tentacle(b, pts, radii, radial, col, amp, tipCone = true) {
  b.tube(pts, radii, radial, (v, a, x, y, z, o) => {
    const c = col(v); o[3] = c[0]; o[4] = c[1]; o[5] = c[2];
    o[6] = amp * Math.pow(v, 1.35); o[7] = 1 + Math.min(0.99, v);
  }, { tip: tipCone });
}
// Column + undulating oral disc. yD(r, a) = disc height; rimR(a) = disc radius; colour of column / disc.
// The column is a smooth lathe: a slightly flared foot, a waist, then a flare out to the disc rim.
// discPart: shading of the disc (0 plain flesh; 4 the finger-pile impostor of nb3_common.js).
function body(b, { R, H, rimR, yD, colCol, discCol, mouthCol, nu = 14, base = 0.55, disc = true, rows = 4, rings = 3, discPart = 0 }) {
  b.grid(nu, rows, (u, v, i, j, o) => {
    const a = u * TAU, rr = rimR(a) * (lerp(base, 1, Math.pow(v, 2.2)) + 0.08 * Math.pow(1 - v, 4)), y = lerp(-0.02, yD(rimR(a), a), v);
    o[0] = Math.cos(a) * rr; o[1] = y; o[2] = Math.sin(a) * rr;
    const k = 0.55 + 0.45 * v; o[3] = colCol[0] * k; o[4] = colCol[1] * k; o[5] = colCol[2] * k; o[6] = 0; o[7] = 0.99 * v;
  }, { wrapU: true });
  if (!disc) return; // lite anemones: the tentacle pile covers the disc
  // oral disc, rim to mouth
  b.grid(nu, rings, (u, v, i, j, o) => {
    const a = u * TAU, rr = rimR(a) * (1 - v), y = yD(rr, a);
    o[0] = Math.cos(a) * rr; o[1] = y; o[2] = Math.sin(a) * rr;
    const c = mixc(discCol, mouthCol, sstep(0.55, 1, v)); o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = 0; o[7] = discPart ? discPart + Math.min(0.99, 1 - v) : 0.99;
  }, { wrapU: true });
}
// Lite anemones (seen from a few metres or more): the tentacle mass as a low dome drawn with the
// dotted-pile shading (part 2, or the coarser finger pile, part 4), plus real tentacles at the margin
// for the silhouette. flat: a plateau that rounds off only near the rim (a full tentacle mound), else a
// spherical cap.
const domeY = (q, flat) => (flat ? Math.pow(Math.max(0, 1 - q * q * q), 0.6) : Math.sqrt(Math.max(0, 1 - q * q))) * 0.95;
function pileDome(b, rimR, yD, h, col, tip, nu = 12, flat = false, part = 2, rings = 3) {
  b.grid(nu, rings, (u, v, i, j, o) => {
    const a = u * TAU, r = rimR(a) * 0.98 * (1 - v * 0.999), y = yD(r, a) + h * domeY(r / rimR(a), flat);
    o[0] = Math.cos(a) * r; o[1] = y; o[2] = Math.sin(a) * r;
    const c = mixc(col, tip, 0.35 + 0.5 * v); o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = 0.006 * v; o[7] = part + Math.min(0.99, 1 - v);
  }, { wrapU: true });
}
function foot(t, R, n = 8) {
  const p = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU; p.push(Math.cos(a) * R, -0.02, Math.sin(a) * R); }
  return setBase(t, p);
}

// ---------------------------------------------------------------- magnificent sea anemone
// Heteractis magnifica: a brightly coloured column flaring into a wavy disc carpeted with ~100-250 blunt,
// finger-like tentacles of even length. The tentacle mass is darkest at its base (the gaps between the
// fingers) and pale at the tips, so a bed reads as a textured pile against the sand, and the column
// shows as a coloured skirt below the rim. closed: balled up (see closedMagnificent).
// Detail levels: lite 0 = full (high/ultra: 150-250 real fingers; medium ~120; low: the finger-pile
// impostor disc plus a fringe of real fingers hanging over the rim), lite 1 = mid distance (impostor
// mound, fringe and a few standing fingers), lite 2 = far (impostor mound and a sparse fringe).
export function* magnificent(seed, { R = 0.3, col = [0.5, 0.05, 0.3], tent = [0.2, 0.17, 0.05], tip = [0.55, 0.55, 0.12], tier = 'high', lite = false, closed = false } = {}) {
  if (closed) return yield* closedMagnificent(seed, { R, col, tent, tip, tier });
  const rng = mulberry32(seed * 977 + 3), b = new Builder(), lo = tier === 'low', med = tier === 'medium', ult = tier === 'ultra';
  // (the impostor levels sit lower: their pile adds height, and a tall column under it read as a cake)
  const H = R * ((lite || lo) ? 0.3 + rng() * 0.16 : 0.42 + rng() * 0.28), base = 0.5 + rng() * 0.15;
  // the disc margin: a few broad folds with a finer ruffle on top, rising and falling around the rim
  // (few, deep folds made kite-shaped discs: more, gentler folds keep the outline round but wavy)
  const folds = 4 + ((rng() * 4) | 0), ruf = 9 + ((rng() * 6) | 0), fph = rng() * TAU, rph = rng() * TAU;
  const fA = 0.035 + rng() * 0.045, rA = (lite === 2 ? 0.012 : 0.025) + rng() * 0.015, wav = 0.04 + rng() * 0.06, rW = lite === 2 ? 0.2 : 0.6;
  const rimR = (a) => R * (1 + fA * Math.sin(a * folds + fph) + rA * Math.sin(a * ruf + rph));
  const yD = (r, a) => { const q = r / R; return H + R * (q * q * wav * (Math.sin(a * folds + fph + 1.3) + rW * Math.sin(a * ruf + rph + 0.7)) - 0.06 * (1 - q)); };
  // (the lite piles are a rounded mound of real height: a flat plateau read as a tilted slab from afar)
  const pile = lite || lo; // impostor finger pile instead of the inner carpet of real fingers
  const nu = lite === 2 ? 12 : lite ? 20 : lo ? 30 : 40, Lb = 0.05 + 0.15 * R, hD = pile ? Lb * 1.1 + R * 0.12 : Lb * 0.65;
  body(b, { R, H, rimR, yD, colCol: col, discCol: scl(tent, pile ? 0.75 : 0.55), mouthCol: scl(col, 0.8), nu, base, disc: !pile, rows: lite === 2 ? 2 : lite ? 3 : 5, rings: 4, discPart: 4 });
  if (pile) pileDome(b, rimR, yD, hD, scl(tent, 0.8), scl(tip, 0.85), nu, false, 4, lite === 2 ? 2 : 3);
  yield;
  // fingers: inner ones stand up out of the carpet; the outer third hang out over the rim and droop,
  // so the anemone reads as a shaggy, ruffled mat with its coloured column showing below the fringe
  const sz = Math.min(1.3, Math.max(0.75, R / 0.3));
  // (beyond ~6 m a finger is about a pixel wide: the far level is the mound alone, a few fingers on top tiers)
  const nIn = lite === 2 ? 0 : lite ? (lo ? 6 : 10) : lo ? 14 : Math.round((ult ? 190 : med ? 85 : 130) * sz + rng() * 25);
  const nRim = lite === 2 ? (lo ? 0 : 6) : lite ? (lo ? 24 : 28) : lo ? 56 : Math.round((ult ? 64 : med ? 40 : 52) * sz);
  const tipP = mixc(tip, [0.85, 0.85, 0.8], 0.25);
  const colOf = (k) => (t) => scl(mixc(tent, tipP, sstep(0.5, 1, t)), k * (0.45 + 0.55 * sstep(0, 0.7, t)));
  for (let i = 0; i < nIn; i++) {
    const f = (i + 0.5) / nIn, a = i * GOLD + (rng() - 0.5) * 0.3, rr = Math.sqrt(f) * 0.84, r = rr * rimR(a);
    const out = [Math.cos(a), 0, Math.sin(a)], lean = 0.12 + 0.6 * rr * rr;
    // each finger leans its own way (the carpet is tousled, not combed) and swells to a blunt tip
    const d = nrm([out[0] * lean + (rng() - 0.5) * 0.9, 1, out[2] * lean + (rng() - 0.5) * 0.9]);
    const L = Lb * (0.6 + 0.75 * rng()) * (0.85 + 0.3 * rr) * (pile ? 0.85 : 1), rt = Math.max(0.006, Lb * (0.1 + 0.035 * rng()));
    const p0 = [out[0] * r, yD(r, a) + (pile ? hD * domeY(rr, false) * 0.6 : 0) - rt * 0.5, out[2] * r];
    const pts = ult ? [p0, [p0[0] + d[0] * L * 0.5, p0[1] + d[1] * L * 0.5, p0[2] + d[2] * L * 0.5], [p0[0] + (d[0] + out[0] * 0.15) * L, p0[1] + d[1] * L * 0.95, p0[2] + (d[2] + out[2] * 0.15) * L]]
      : [p0, [p0[0] + d[0] * L, p0[1] + d[1] * L, p0[2] + d[2] * L]];
    tentacle(b, pts, ult ? [rt * 0.9, rt, rt * 1.08] : [rt * 0.88, rt * 1.08], 3, colOf(0.8 + 0.4 * rng()), L * 0.3);
    if ((i & 31) === 31) yield;
  }
  for (let i = 0; i < nRim; i++) {
    const a = (i / nRim) * TAU + (rng() - 0.5) * (TAU / nRim) * 0.8, rr = 0.8 + 0.16 * rng(), r = rr * rimR(a);
    const out = [Math.cos(a), 0, Math.sin(a)], side = [-out[2], 0, out[0]], sw = (rng() - 0.5) * 0.5;
    const L = Lb * (1.0 + 0.5 * rng()) * (lite === 2 ? 1.15 : 1), rt = Math.max(0.0065, L * 0.12), droop = 0.35 + 0.45 * rng();
    const p0 = [out[0] * r, yD(r, a) + (pile ? hD * domeY(rr, false) * 0.5 : 0) - rt * 0.4, out[2] * r];
    const at = (t, up) => [p0[0] + (out[0] + side[0] * sw) * L * t, Math.max(0.03, p0[1] + up * L), p0[2] + (out[2] + side[2] * sw) * L * t]; // tips stay off the sand
    const two = lite || lo; // (two-point fringe fingers on low tier and the lite levels: a dense fringe stays cheap)
    // hanging over the rim like a skirt that hides the column's upper edge
    const pts = two ? [p0, at(0.5, -0.45 - droop * 0.5)] : [p0, at(0.42, 0.08), at(0.6, -0.45 - droop * 0.5)];
    tentacle(b, pts, two ? [rt, rt * 0.95] : [rt * 0.95, rt * 0.9, rt * 1.05], 3, colOf(0.8 + 0.4 * rng()), L * 0.35);
    if ((i & 31) === 31) yield;
  }
  const t = foot(b.build(), R * 0.5);
  t.label = 'Magnificent sea anemone';
  t.fact = 'A magnificent sea anemone can reach a metre across; at night it balls up and shows its brightly coloured column.';
  t.solid = false; t.nbR = R * (1 + fA + rA) + Lb * 0.6; t.nbTop = H + Math.max(0.6 * Lb, pile ? hD * 0.95 : 0); // the fringe reaches past the rim
  return t;
}
// A magnificent anemone balled up (in strong current, at dusk, when disturbed): the disc folds inside and
// the brightly coloured column swells into a lobed ball with a puckered opening on top, a few tentacle tips
// peeking out. Fields always hold some of them, scattered like coloured balloons among the open ones.
function* closedMagnificent(seed, { R, col, tent, tip, tier }) {
  const rng = mulberry32(seed * 1301 + 5), b = new Builder(), lo = tier === 'low';
  const Rb = R * (0.55 + 0.15 * rng()), Hb = Rb * (1.2 + 0.35 * rng()), ph = rng() * TAU, lobes = 3 + ((rng() * 3) | 0), lA = 0.05 + 0.07 * rng();
  const th0 = -0.75, th1 = 1.42, yc = -0.02 - Hb * 0.5 * Math.sin(th0);
  const ring = (a, v) => 1 + lA * Math.sin(a * lobes + ph) * Math.sin(Math.PI * v) + 0.025 * Math.sin(a * 11 + ph * 3);
  const stripe = (a) => 1 + 0.1 * Math.sin(a * (14 + lobes * 2) + ph);
  b.lathe(lo ? 10 : 14, lo ? 6 : 8, (v) => { const th = lerp(th0, th1, v); return [Rb * Math.cos(th), yc + Hb * 0.5 * Math.sin(th)]; }, ring, (v, a, x, y, z, o) => {
    const k = (0.55 + 0.5 * sstep(0, 0.6, v)) * stripe(a); o[3] = col[0] * k; o[4] = col[1] * k; o[5] = col[2] * k; o[6] = 0; o[7] = 0.99 * v;
  });
  const yT = yc + Hb * 0.5 * Math.sin(th1), rT = Rb * Math.cos(th1);
  // the pucker: the rim turns inward and down into the opening (dark disc tissue)
  b.lathe(lo ? 10 : 14, 1, (v) => [rT * (1 - 0.85 * v), yT - 0.12 * Rb * v], (a) => ring(a, 1), (v, a, x, y, z, o) => {
    const c = mixc(col, scl(tent, 0.35), v); o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = 0; o[7] = 0.99;
  });
  yield;
  const nT = lo ? 5 : 7 + ((rng() * 5) | 0);
  for (let i = 0; i < nT; i++) { // tentacle tips poking out of the opening
    const a = (i / nT) * TAU + rng() * 0.5, out = [Math.cos(a), 0, Math.sin(a)], rr = rT * 0.45 * rng(), L = Rb * (0.12 + 0.1 * rng()), rt = Math.max(0.006, L * 0.2);
    const p0 = [out[0] * rr, yT - 0.1 * Rb, out[2] * rr];
    tentacle(b, [p0, [p0[0] + out[0] * L * 0.35, p0[1] + L, p0[2] + out[2] * L * 0.35]], [rt, rt * 0.8], 3, (t) => scl(mixc(tent, tip, t), 0.6 + 0.5 * t), L * 0.2);
  }
  const t = foot(b.build(), Rb * 0.62);
  t.label = 'Magnificent sea anemone';
  t.fact = 'A magnificent sea anemone can reach a metre across; when it closes it balls up and shows its brightly coloured column.';
  t.solid = false; t.nbR = Rb * 1.05; t.nbTop = yT; t.closed = true;
  return t;
}

// ---------------------------------------------------------------- bubble-tip anemone (one individual)
// Entacmaea quadricolor: a small disc with tentacles that swell into a bulb just below the tip, often with
// a pale ring at the bulb; clones of one individual carpet whole crevices in a single colour morph.
export function* bubbleTip(seed, { R = 0.1, col = [0.3, 0.12, 0.05], tent = [0.2, 0.45, 0.12], tip = [0.6, 0.15, 0.35], ring = 0, bulb = 1, tier = 'high', lite = false } = {}) {
  const rng = mulberry32(seed * 1291 + 7), b = new Builder(), lo = tier === 'low';
  const H = R * (0.45 + rng() * 0.3), folds = 2 + ((rng() * 3) | 0), fph = rng() * TAU;
  const rimR = (a) => R * (1 + 0.06 * Math.sin(a * folds + fph));
  const yD = (r, a) => H + R * 0.1 * (r / R) ** 2 * Math.sin(a * folds + fph);
  const micro = lite >= 2, blob = lite === 3;
  if (blob) { // distant clone: a pile of tentacles on a short column, nothing finer
    b.grid(10, 1, (u, v, i, j, o) => { const a = u * TAU, rr = rimR(a) * lerp(0.6, 1, v); o[0] = Math.cos(a) * rr; o[1] = lerp(-0.02, yD(rimR(a), a), v); o[2] = Math.sin(a) * rr; o[3] = col[0] * 0.6; o[4] = col[1] * 0.6; o[5] = col[2] * 0.6; o[6] = 0; o[7] = 0.5; }, { wrapU: true });
    pileDome(b, rimR, yD, R * 0.75, tent, tip, 10);
  } else body(b, { R, H, rimR, yD, colCol: col, discCol: scl(tent, 0.6), mouthCol: scl(col, 1.3), nu: micro ? 9 : lite ? 10 : lo ? 10 : 14, base: 0.6, disc: !lite });
  const nT = blob ? 0 : micro ? 4 : lite ? (lo ? 5 : 7) : Math.round((lo ? 14 : 18 + rng() * 10) * Math.min(1.3, Math.max(0.7, R / 0.1)));
  if (lite && !blob) pileDome(b, rimR, yD, R * 0.55, tent, tip, micro ? 9 : 10);
  for (let i = 0; i < nT; i++) {
    const f = lite ? 0.75 + 0.2 * ((i * 0.618) % 1) : (i + 0.5) / nT, a = lite ? (i / nT) * TAU + (rng() - 0.5) * 0.4 : i * GOLD + (rng() - 0.5) * 0.4, rr = 0.2 + 0.78 * Math.sqrt(f), r = rr * rimR(a);
    const out = [Math.cos(a), 0, Math.sin(a)], lean = 0.25 + 0.9 * rr * rr;
    const d = nrm([out[0] * lean + (rng() - 0.5) * 0.35, 1, out[2] * lean + (rng() - 0.5) * 0.35]);
    const L = R * (0.75 + 0.45 * rng()), rt = Math.max(0.0045, L * 0.075), bk = bulb * (0.55 + 0.6 * rng());
    const p0 = [out[0] * r, yD(r, a) - rt * 0.5, out[2] * r], at = (t, droop) => [p0[0] + (d[0] + out[0] * droop) * L * t, p0[1] + d[1] * L * t - droop * L * t * t * 0.5, p0[2] + (d[2] + out[2] * droop) * L * t];
    const dr = 0.1 + 0.3 * rr;
    const pts = micro ? [at(0, dr), at(0.75, dr), at(1, dr)] : [at(0, dr), at(0.62, dr), at(0.86, dr), at(1, dr)];
    const radii = micro ? [rt, rt * (1 + 0.7 * bk), rt * 0.6] : [rt, rt * (1 + 0.8 * bk), rt * (1 + 0.5 * bk), rt * 0.55];
    const k = 0.9 + 0.2 * rng(), rc = micro ? 0.5 : 0.33; // the pale ring sits where the bulb starts
    tentacle(b, pts, radii, 3, (t) => {
      let c = mixc(tent, tip, sstep(0.72, 1, t));
      if (ring) c = mixc(c, [0.8, 0.78, 0.72], ring * Math.max(0, 1 - Math.abs(t - rc) / 0.2));
      return scl(c, k * (0.6 + 0.4 * sstep(0, 0.5, t)));
    }, L * 0.38);
    if ((i & 15) === 15) yield;
  }
  const t = foot(b.build(), R * 0.55, 6);
  t.label = 'Bubble-tip anemone';
  t.fact = 'Bubble-tip anemones clone themselves by splitting in two, so a whole field can be copies of one animal.';
  t.solid = false; t.nbR = R * 1.25; t.nbTop = H + R * 0.8;
  return t;
}

// ---------------------------------------------------------------- carpet anemone
// Stichodactyla: a flat, deeply folded disc up to a metre across, covered in thousands of short sticky
// tentacles (drawn by the material as a dotted pile, part 2).
export function* carpet(seed, { R = 0.4, col = [0.1, 0.35, 0.12], mouth = [0.4, 0.38, 0.2], tier = 'high' } = {}) {
  const rng = mulberry32(seed * 733 + 11), b = new Builder(), lo = tier === 'low';
  // many shallow folds (a few deep ones made a pentagonal slab): a round, ruffled disc
  const h = 0.03 + rng() * 0.03, A = R * (0.06 + rng() * 0.08), k1 = 7 + ((rng() * 6) | 0), k2 = 2 + ((rng() * 2) | 0), ph = rng() * TAU, ph2 = rng() * TAU;
  const ex = 0.9 + rng() * 0.3; // slightly oval
  const rimR = (a) => R * (1 + 0.045 * Math.sin(a * k1 + ph) + 0.04 * Math.sin(a * k2 + ph2) + 0.02 * Math.sin(a * (2 * k1 + 1) + ph2));
  const fold = (r, a) => Math.pow(r / R, 2.2) * (A * Math.sin(a * k1 + ph + 1.2 * Math.sin(a * k2 + ph2)) + R * 0.05 * Math.sin(a * k2 + ph2 + 0.7));
  const nu = lo ? 28 : 44, nr = lo ? 5 : 8;
  const P = (r, a) => [Math.cos(a) * r * ex, Math.sin(a) * r / ex];
  // underside skirt / short column
  b.grid(nu, 2, (u, v, i, j, o) => {
    const a = u * TAU, rr = rimR(a) * lerp(0.72, 1, v), q = P(rr, a);
    o[0] = q[0]; o[1] = lerp(-0.02, h + fold(rimR(a), a), v); o[2] = q[1];
    const kk = 0.45 + 0.35 * v; o[3] = col[0] * kk; o[4] = col[1] * kk; o[5] = col[2] * kk; o[6] = 0; o[7] = 0.5;
  }, { wrapU: true });
  yield;
  b.grid(nu, nr, (u, v, i, j, o) => {
    const a = u * TAU, rr = rimR(a) * (1 - v), q = P(rr, a);
    o[0] = q[0]; o[1] = h + fold(rr, a) + 0.012 * vn3(q[0] * 9, 0, q[1] * 9, seed) - 0.015 * sstep(0.8, 1, v); o[2] = q[1];
    const bl = 0.85 + 0.3 * vn3(q[0] * 4, 1, q[1] * 4, seed + 3), c = mixc(col, mouth, sstep(0.82, 0.97, v));
    o[3] = c[0] * bl; o[4] = c[1] * bl; o[5] = c[2] * bl; o[6] = 0.004 * (1 - v); o[7] = 2 + Math.min(0.99, 1 - v);
  }, { wrapU: true });
  const t = foot(b.build(), R * 0.62, 10);
  t.label = 'Carpet anemone';
  t.fact = 'Carpet anemones are covered in thousands of short, sticky tentacles that can grip a finger.';
  t.solid = false; t.nbR = R * 1.08; t.nbTop = h + A * 0.6;
  return t;
}

// ---------------------------------------------------------------- leathery anemone
// Heteractis crispa: long, tapering tentacles that ripple like grass in the surge, often purple-tipped.
export function* leathery(seed, { R = 0.18, col = [0.3, 0.28, 0.22], tent = [0.4, 0.38, 0.33], tip = [0.5, 0.15, 0.45], tier = 'high' } = {}) {
  const rng = mulberry32(seed * 457 + 19), b = new Builder(), lo = tier === 'low';
  const H = R * (0.4 + rng() * 0.3), fph = rng() * TAU;
  const rimR = (a) => R * (1 + 0.05 * Math.sin(a * 3 + fph));
  const yD = (r, a) => H + R * 0.08 * (r / R) ** 2 * Math.sin(a * 3 + fph);
  body(b, { R, H, rimR, yD, colCol: col, discCol: scl(tent, 0.35), mouthCol: scl(col, 1.2), nu: lo ? 10 : 14, base: 0.5 });
  const nT = Math.round(lo ? 30 : 42 + rng() * 30);
  for (let i = 0; i < nT; i++) {
    const f = (i + 0.5) / nT, a = i * GOLD + (rng() - 0.5) * 0.3, rr = 0.25 + 0.73 * Math.sqrt(f), r = rr * rimR(a);
    const out = [Math.cos(a), 0, Math.sin(a)], lean = 0.3 + 1.1 * rr * rr;
    const d = nrm([out[0] * lean + (rng() - 0.5) * 0.3, 1, out[2] * lean + (rng() - 0.5) * 0.3]);
    const L = R * (0.6 + 0.4 * rng()) + 0.05, rt = Math.max(0.004, L * 0.045), droop = 0.25 + 0.35 * rr;
    const p0 = [out[0] * r, yD(r, a) - rt * 0.5, out[2] * r];
    const pts = [];
    for (let q = 0; q <= 3; q++) { const t = q / 3; pts.push([p0[0] + (d[0] + out[0] * droop * t) * L * t, p0[1] + (d[1] - droop * t) * L * t, p0[2] + (d[2] + out[2] * droop * t) * L * t]); }
    const k = 0.9 + 0.2 * rng();
    tentacle(b, pts, [rt, rt * 0.8, rt * 0.55, rt * 0.3], 3, (t) => scl(mixc(tent, tip, sstep(0.6, 1, t)), k * (0.5 + 0.5 * sstep(0, 0.6, t))), L * 0.4);
    if ((i & 15) === 15) yield;
  }
  const t = foot(b.build(), R * 0.5);
  t.label = 'Leathery sea anemone';
  t.fact = 'Clownfish get used to a new anemone by touching it bit by bit, coating themselves in its protective mucus.';
  t.solid = false; t.nbR = R + 0.12; t.nbTop = H + 0.06;
  return t;
}

// ---------------------------------------------------------------- tube-dwelling anemone
// Cerianthus: a felt tube in the sand and a fountain of long, thin tentacles around a tuft of short ones.
export function* tubeAnemone(seed, { outer = [0.45, 0.12, 0.5], inner = [0.9, 0.75, 0.55], band = 0, tier = 'high' } = {}) {
  const rng = mulberry32(seed * 383 + 23), b = new Builder(), lo = tier === 'low';
  const rT = 0.022 + rng() * 0.018, hT = 0.07 + rng() * 0.1;
  b.lathe(lo ? 7 : 9, 3, (v) => [rT * (1.15 - 0.15 * v + (v > 0.95 ? 0.08 : 0)), -0.03 + v * (hT + 0.03)], (a, v) => 1 + 0.1 * vn3(Math.cos(a) * 3, v * 5, Math.sin(a) * 3, seed), (v, a, x, y, z, o) => {
    const n = 0.7 + 0.5 * vn3(x * 40, y * 40, z * 40, seed + 1); o[3] = 0.16 * n; o[4] = 0.13 * n; o[5] = 0.1 * n; o[6] = 0; o[7] = 0.5;
  });
  yield;
  const nO = lo ? 20 : 26 + ((rng() * 14) | 0), Lo = 0.11 + rng() * 0.12;
  for (let i = 0; i < nO; i++) {
    const a = (i / nO) * TAU + (rng() - 0.5) * 0.15, out = [Math.cos(a), 0, Math.sin(a)];
    const L = Lo * (0.75 + 0.5 * rng()), rt = 0.0035 + rng() * 0.0015, up = 0.45 + rng() * 0.4;
    const p0 = [out[0] * rT * 0.92, hT, out[2] * rT * 0.92], pts = [];
    const maxDrop = hT - 0.035; // the drooping tips stay above the sand
    for (let q = 0; q <= 3; q++) {
      const t = q / 3, dy = L * (up * t - 1.05 * t * t);
      pts.push([p0[0] + out[0] * L * 0.95 * t, p0[1] + Math.max(-maxDrop, dy), p0[2] + out[2] * L * 0.95 * t]);
    }
    const k = 0.85 + 0.3 * rng();
    tentacle(b, pts, [rt, rt * 0.8, rt * 0.55, rt * 0.3], 3, (t) => {
      const st = band ? 0.65 + 0.35 * (Math.sin(t * 18 + i) > 0 ? 1 : 0) : 1;
      return scl(outer, k * st * (0.8 + 0.3 * t));
    }, L * 0.35);
    if ((i & 15) === 15) yield;
  }
  const nI = lo ? 8 : 12 + ((rng() * 8) | 0);
  for (let i = 0; i < nI; i++) {
    const a = (i / nI) * TAU + rng() * 0.3, out = [Math.cos(a), 0, Math.sin(a)], L = 0.025 + rng() * 0.03, rt = 0.0028;
    const p0 = [out[0] * rT * 0.45, hT - 0.003, out[2] * rT * 0.45];
    const pts = [p0, [p0[0] + out[0] * L * 0.3, p0[1] + L * 0.7, p0[2] + out[2] * L * 0.3], [p0[0] - out[0] * L * 0.1, p0[1] + L, p0[2] - out[2] * L * 0.1]];
    tentacle(b, pts, [rt, rt * 0.8, rt * 0.4], 3, () => inner, L * 0.25);
  }
  const t = foot(b.build(), rT * 1.05, 6);
  t.label = 'Tube-dwelling anemone';
  t.fact = 'Tube anemones live in a felt tube woven from special stinging threads, and vanish into it in a blink.';
  t.solid = false; t.nbR = Lo * 0.95 + rT; t.nbTop = hT + 0.06;
  return t;
}

// ---------------------------------------------------------------- mushroom anemones (corallimorphs)
// A patch of flat, ribbed discs carpeting a rock, each a few centimetres across, often metallic.
export function* mushroomPatch(seed, { Rp = 0.25, n = 16, cols = [[0.1, 0.4, 0.3]], tier = 'high' } = {}) {
  const rng = mulberry32(seed * 619 + 29), b = new Builder(), lo = tier === 'low', pos = [];
  const nn = lo ? Math.round(n * 0.65) : n;
  for (let k = 0; k < nn * 3 && pos.length < nn; k++) {
    const a = rng() * TAU, d = Rp * Math.sqrt(rng()), x = Math.cos(a) * d, z = Math.sin(a) * d, R = 0.022 + rng() * 0.03;
    if (pos.some((p) => Math.hypot(p[0] - x, p[1] - z) < (p[2] + R) * 0.92)) continue;
    pos.push([x, z, R]);
  }
  const nu = lo ? 9 : 12;
  for (const [x, z, R] of pos) {
    const c = cols[(rng() * cols.length) | 0], cc = scl(c, 0.85 + 0.3 * rng()), y0 = 0.012 + 0.04 * (1 - Math.hypot(x, z) / Rp) * rng();
    const cup = (rng() - 0.3) * 0.25 * R, rib = 5 + ((rng() * 5) | 0), ph = rng() * TAU, tx = (rng() - 0.5) * 0.3, tz = (rng() - 0.5) * 0.3;
    // short stalk, then the disc (rim to centre: normal up)
    b.lathe(5, 1, (v) => [R * (0.35 + 0.15 * v), -0.02 + v * (y0 + 0.02)], null, (v, a, px, py, pz, o) => { o[3] = cc[0] * 0.5; o[4] = cc[1] * 0.5; o[5] = cc[2] * 0.5; o[6] = 0; o[7] = 0.3; });
    const v0 = b.vc - 10;
    for (let i = v0; i < b.vc; i++) { b.P[i * 3] += x; b.P[i * 3 + 2] += z; }
    b.grid(nu, lo ? 2 : 3, (u, v, i, j, o) => {
      const a = u * TAU, r = R * (1 - v) * (1 + 0.08 * Math.sin(a * rib + ph)), lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      o[0] = x + lx; o[1] = y0 + cup * (1 - v) ** 2 + lx * tx + lz * tz + (v > 0.85 ? R * 0.12 : 0); o[2] = z + lz;
      const str = 0.8 + 0.35 * (Math.sin(a * rib * 2 + ph) > 0 ? 1 : 0) * (1 - v), mouth = v > 0.8 ? 1.4 : 1;
      o[3] = cc[0] * str * mouth; o[4] = cc[1] * str * mouth; o[5] = cc[2] * str * mouth; o[6] = 0.003; o[7] = 3 + Math.min(0.99, 1 - v);
    }, { wrapU: true });
  }
  yield;
  // the shared encrusting skin
  b.blob(1, (x, y, z, o) => { o[0] = x * Rp * 1.08; o[1] = Math.max(0, y) * 0.015 - 0.01; o[2] = z * Rp * 1.08; o[3] = o[4] = o[5] = 0.3; o[6] = 0; o[7] = 0.2; });
  const t = foot(b.build(), Rp * 0.8, 10);
  t.label = 'Mushroom anemones';
  t.fact = 'Mushroom anemones are closer kin to stony corals than to sea anemones, but they never grow a skeleton.';
  t.solid = false; t.nbR = Rp * 1.1; t.nbTop = 0.07;
  return t;
}

// ---------------------------------------------------------------- jellyfish-eating white anemones
// Entacmaea medusivora: small pale anemones in groups on the lake floor; they catch golden jellyfish.
export function* lakeAnemones(seed, { n = 8, Rp = 0.18, R0 = 0.018, tier = 'high', hue = [0.85, 0.82, 0.76] } = {}) {
  const rng = mulberry32(seed * 271 + 31), b = new Builder(), lo = tier === 'low', pos = [];
  const nn = lo ? Math.max(2, Math.round(n * 0.6)) : n;
  for (let k = 0; k < nn * 4 && pos.length < nn; k++) {
    const a = rng() * TAU, d = Rp * Math.sqrt(rng()), x = Math.cos(a) * d, z = Math.sin(a) * d, R = R0 + rng() * R0 * 1.1;
    if (pos.some((p) => Math.hypot(p[0] - x, p[1] - z) < (p[2] + R) * 1.15)) continue;
    pos.push([x, z, R]);
  }
  for (const [x, z, R] of pos) {
    const v0 = b.vc, H = R * (0.8 + rng() * 0.8), c = scl(hue, 0.9 + 0.2 * rng()), tipc = scl(hue, 1.25), stalk = mixc(hue, [0.55, 0.42, 0.35], 0.5);
    const rimR = () => R, yD = (r) => H - 0.1 * R * (1 - r / R);
    body(b, { R, H, rimR, yD, colCol: stalk, discCol: scl(c, 0.8), mouthCol: [0.75, 0.55, 0.45], nu: lo ? 6 : 7, base: 0.65 });
    const nT = lo ? 7 : 8 + ((rng() * 4) | 0);
    for (let i = 0; i < nT; i++) { // short, single-segment tentacles: these anemones are only a few centimetres across
      const a = (i / nT) * TAU + (rng() - 0.5) * 0.2, out = [Math.cos(a), 0, Math.sin(a)], L = R * (1.2 + rng() * 0.9), rt = Math.max(0.0028, R * 0.09);
      const p0 = [out[0] * R * 0.85, H - 0.002, out[2] * R * 0.85], lean = 0.6 + rng() * 0.5;
      tentacle(b, [p0, [p0[0] + out[0] * lean * L, p0[1] + L * 0.7, p0[2] + out[2] * lean * L]], [rt, rt * 0.55], 3, (t) => mixc(c, tipc, t), L * 0.3);
    }
    for (let i = v0; i < b.vc; i++) { b.P[i * 3] += x; b.P[i * 3 + 2] += z; }
  }
  yield;
  const base = [];
  for (const [x, z, R] of pos) base.push(x + R * 0.5, -0.02, z, x - R * 0.5, -0.02, z);
  const t = b.build();
  setBase(t, base.slice(0, 36));
  t.label = 'Jellyfish-eating anemone';
  t.fact = 'These white anemones live only in Jellyfish Lake and catch the golden jellies that stray into the shade.';
  t.solid = false; t.nbR = Rp + 0.05; t.nbTop = 0.08;
  return t;
}

// ---------------------------------------------------------------- colour morphs (linear RGB)
export const MORPH = {
  // magnificent: [column, tentacle body, tentacle tip]. Tentacles are olive / brown / green with paler
  // tips (zooxanthellae), clearly darker and more saturated than the sand; the columns are the vivid part.
  magnificent: [
    [[0.55, 0.03, 0.32], [0.2, 0.17, 0.05], [0.55, 0.55, 0.14]],   // magenta column, olive-brown fingers
    [[0.6, 0.04, 0.05], [0.13, 0.2, 0.04], [0.42, 0.6, 0.12]],     // red column, olive-green
    [[0.06, 0.14, 0.6], [0.24, 0.18, 0.07], [0.62, 0.5, 0.2]],     // blue column, brown
    [[0.75, 0.72, 0.68], [0.3, 0.26, 0.09], [0.72, 0.66, 0.3]],    // white column, khaki
    [[0.9, 0.3, 0.04], [0.15, 0.24, 0.05], [0.5, 0.62, 0.18]],     // orange column, green
    [[0.1, 0.42, 0.1], [0.13, 0.26, 0.06], [0.42, 0.64, 0.2]],     // green, pale green tips
    [[0.32, 0.05, 0.42], [0.28, 0.17, 0.13], [0.78, 0.5, 0.55]],   // purple column, pinkish-brown
  ],
  // bubble-tip: [column, tentacle, tip, white ring]
  bubble: [
    [[0.3, 0.08, 0.04], [0.15, 0.42, 0.1], [0.55, 0.12, 0.3], 0],     // green with pink tips
    [[0.35, 0.05, 0.06], [0.75, 0.12, 0.2], [0.85, 0.3, 0.42], 0],    // rose bubble-tip
    [[0.25, 0.04, 0.02], [0.55, 0.04, 0.03], [0.6, 0.1, 0.08], 0],    // deep red
    [[0.4, 0.15, 0.03], [0.85, 0.32, 0.05], [0.95, 0.65, 0.2], 0.8],  // orange, white ring
    [[0.25, 0.18, 0.1], [0.32, 0.26, 0.12], [0.5, 0.2, 0.38], 0.9],   // brown, pale ring, purple tips
    [[0.15, 0.25, 0.08], [0.25, 0.6, 0.18], [0.4, 0.9, 0.3], 0.6],    // bright green
    [[0.45, 0.1, 0.2], [0.6, 0.25, 0.08], [0.9, 0.15, 0.35], 0],      // 'rainbow': orange to pink
  ],
  // carpet: [disc, mouth]
  carpet: [
    [[0.06, 0.3, 0.08], [0.3, 0.32, 0.14]], [[0.05, 0.18, 0.32], [0.2, 0.3, 0.32]], [[0.28, 0.06, 0.3], [0.45, 0.3, 0.2]],
    [[0.45, 0.4, 0.12], [0.6, 0.45, 0.25]], [[0.12, 0.28, 0.22], [0.5, 0.5, 0.42]], [[0.5, 0.16, 0.22], [0.6, 0.45, 0.3]], [[0.2, 0.22, 0.1], [0.55, 0.15, 0.4]],
  ],
  // leathery: [column, tentacle, tip]
  leathery: [
    [[0.32, 0.3, 0.24], [0.26, 0.22, 0.16], [0.5, 0.12, 0.45]], [[0.3, 0.12, 0.06], [0.32, 0.2, 0.12], [0.85, 0.25, 0.5]],
    [[0.2, 0.24, 0.3], [0.42, 0.42, 0.44], [0.35, 0.15, 0.55]], [[0.28, 0.3, 0.1], [0.2, 0.28, 0.08], [0.6, 0.8, 0.2]],
  ],
  // tube anemone: [outer, inner, banded]
  tube: [
    [[0.42, 0.1, 0.55], [0.9, 0.85, 0.75], 0], [[0.9, 0.42, 0.06], [0.95, 0.85, 0.5], 0], [[0.85, 0.82, 0.78], [0.3, 0.12, 0.4], 0],
    [[0.2, 0.18, 0.16], [0.9, 0.88, 0.8], 1], [[0.55, 0.06, 0.12], [0.95, 0.6, 0.3], 1], [[0.15, 0.4, 0.25], [0.8, 0.85, 0.6], 0],
  ],
  // mushroom anemone disc colours (several per patch)
  mushroom: [
    [[0.05, 0.42, 0.3], [0.08, 0.6, 0.35]], [[0.08, 0.15, 0.55], [0.25, 0.1, 0.5]], [[0.6, 0.05, 0.08], [0.85, 0.2, 0.1]],
    [[0.4, 0.05, 0.45], [0.15, 0.08, 0.55]], [[0.75, 0.35, 0.05], [0.25, 0.55, 0.1]], [[0.12, 0.45, 0.5], [0.5, 0.08, 0.3]],
  ],
};
// carpet anemones grow to ~1 m; nbR, nbTop drive spacing and clownfish height.
export const ANEM_CLOWNS = { magnificent: ['clownfish', 'pinkSkunkClown', 'clarkClown'], bubble: ['tomatoClown', 'clarkClown'], carpet: ['clarkClown', 'clownfish', 'blackClown'], leathery: ['clarkClown', 'clownfish'] };
