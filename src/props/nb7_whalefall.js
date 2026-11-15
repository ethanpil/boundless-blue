// Whale fall: one very large rorqual carcass per segment on a sunlit lava flat in clear water (biomes.whaleFallOf places
// it beside the route on the outside of a bend; the crowd of sharks feeding at it is creatures/wf_crowd.js). The whole
// whale lying on its side or back: mottled skin with pale sloughed patches, a cream belly, the throat pleats and the
// mouth line, the flippers and the flukes (parts missing on some); torn open toward the route (a pale rim of blubber
// around red muscle, the rib cage arching over the dark cavity, the spine at its back), opened at the tail stock where
// the sharks begin, bite marks scattered over the body, strands of tissue trailing from the cuts, scraps and bone
// fragments on the sand around it.
// The depiction is a composite (a ~21 m rorqual); on-screen text describes the documented events (see
// docs/SOURCES.md), never this carcass. The carcass template is generated per segment through the rock_gen providers
// (<= 2 ms slices ahead of the camera; a layout that finds none builds it itself in slices).
import * as THREE from 'three';
import { Builder, Batch, TAU, CHUNK, T, vn3, sat, sstep, lerp, rotY, pointsClear, placedPoints, presence, budgetK } from './core.js';
import { MAT } from './materials.js';
import { whaleFallOf, whaleFallUV } from '../biomes.js';
import { pathCache, clearBox, SOFT, SOLID, seat, put, segFor, lowK, slice, nbFloor, lab, setBase, upTo, mix3 } from './nb_common.js';
import { poolOf, tintOf } from './nb2_common.js';
import { gridG, paintG, blobG, drain, rockJob, tiered } from './rock_recipes.js';
import { pick, chunkRng, segSeed, planktonMeshG, IBatch } from './nb4_common.js';
import { mulberry32 } from '../noise.js';

const KEY = 'whalefall';
const H = {};

// ---------------------------------------------------------------- on-screen text (sourced: docs/SOURCES.md)
// (scraps and ribs describe the documented California sites; the rest the documented events off Hawaii and at False
// Bay; never this carcass)
export const WF = {
  scraps: ['Scraps of whale', 'At one whale fall off California, 90% of the soft tissue had been removed after 18 months.'],
  ribs: ['Whale bones', 'Fresh bones of large whales can be more than 60% lipid (fat) by weight.'],
  sunCarcass: ['Whale carcass', 'In Hawaii in 2024, at least nine oceanic whitetips and five tiger sharks fed on one carcass over 8.5 hours.'],
  sunTail: ['Whale carcass', 'At False Bay, white sharks generally started on a whale\'s tail stock and fluke, then moved along the body.'],
  sunBite: ['Whale carcass', 'At False Bay, white sharks cut whale flesh with side-to-side head shakes; a bout typically lasted 15 to 20 seconds.'],
};

// ---------------------------------------------------------------- resolution per tier
// du: ring spacing along the body (m); nu: vertices around it
const RES = {
  low: { du: 0.34, nu: 48, rib: 6, vd: 1 }, medium: { du: 0.27, nu: 60, rib: 7, vd: 2 },
  high: { du: 0.2, nu: 76, rib: 8, vd: 2 }, ultra: { du: 0.17, nu: 88, rib: 9, vd: 2 },
};
const resOf = (tier) => RES[tier] || RES.high;

// ---------------------------------------------------------------- colours (linear)
// the carcass: the body as it looks in air, then +35 % red for the light path through the water, as the reef palettes
// (reef.js RL): mid-grey hide with pale sloughed patches, a cream belly, a cream band of blubber at the cuts, bright
// red muscle, ivory bone. In sunlight these are the most colourful things in the frame.
const PAL_SUN = { SKIN: [0.055, 0.058, 0.066], SKIN2: [0.1, 0.1, 0.108], BELLY: [0.86, 0.74, 0.6], SLOUGH: [0.66, 0.52, 0.48], BLUB: [1.12, 0.9, 0.62],
  BLUB2: [1.12, 0.74, 0.6], MUSC: [1.0, 0.15, 0.11], MAROON: [0.6, 0.06, 0.06], DEEP: [0.24, 0.035, 0.04], BONE: [1.06, 0.98, 0.84], STR: [1.05, 0.72, 0.64] };
// the bone fragments on the sand (H.bone): a drier, duller ivory than the bone in the wounds
const PAL_FRAG = { BONE: [0.82, 0.76, 0.6] };
const mixIn = (c, b, t) => { c[0] += (b[0] - c[0]) * t; c[1] += (b[1] - c[1]) * t; c[2] += (b[2] - c[2]) * t; return c; };
const set3 = (c, a) => { c[0] = a[0]; c[1] = a[1]; c[2] = a[2]; return c; };

// ---------------------------------------------------------------- body shape (fractions of the length L)
// t: 0 at the tail stock .. 1 at the tip of the snout. Around the body, the anatomical angle a: 0 = the ventral
// midline (belly, throat), pi / 2 = the left flank, pi = the back, 3 pi / 2 = the right flank. AZ: dorso-ventral half
// depth, BY: lateral half width. A rorqual: long and slender, the head broad and flat with a pointed snout, the tail
// stock deep and narrow. The pose turns the cross-section: rho(t) is the template angle p of the belly (p: 0 =
// the side facing the route, +z; pi / 2 = up): belly up pi / 2, on its side 0 or pi, belly down -pi / 2, plus a twist.
// (3.4-3.7 m through the chest for a 21 m animal; the rostrum flat and pointed)
const AZ = [[0, 0.027], [0.1, 0.041], [0.25, 0.063], [0.42, 0.08], [0.56, 0.087], [0.68, 0.083], [0.76, 0.072], [0.84, 0.056], [0.92, 0.036], [0.98, 0.017], [1, 0.006]];
const BY = [[0, 0.009], [0.1, 0.02], [0.25, 0.05], [0.42, 0.071], [0.56, 0.08], [0.68, 0.08], [0.76, 0.077], [0.84, 0.067], [0.92, 0.047], [0.98, 0.024], [1, 0.008]];
function prof(K, t) {
  if (t <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const a = K[i - 1], b = K[i], u = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * u * u * (3 - 2 * u); }
  return K[K.length - 1][1];
}
const angD = (a, b) => { let d = a - b; d -= TAU * Math.round(d / TAU); return d; };
const HP = Math.PI / 2;
// height of the mud beside the body in template space: the body lies in a 0.16 m hollow (biomes.js) and is seated
// 0.1 m into it; flukes, flippers and fallen ribs rest on the level mud
const MUD = 0.26;

// One carcass, all from its segment's seed: pose, proportions, how far it has been eaten and where, what is missing.
// cam: the carcass a dive starts at (page load, zone jump): always fresh, partly eaten, the sharks at it.
function carcassPlan(seed, W) {
  const rng = mulberry32(seed), r = (a, b) => a + (b - a) * rng(), L = W.L, cam = W.cam;
  const Pl = { L, rng, seed, sd: (seed % 99991) + 7, Rr: 0.065 * L, W: [], sc: L / 21, K: PAL_SUN };
  Pl.gk = r(0.9, 1.1); Pl.bloat = rng() < 0.4 ? r(0.05, 0.16) : 0;
  // skin: how much has peeled off (pale grey-pink), and its cast (blue-grey .. brownish)
  Pl.slough = (cam ? r(0.05, 0.35) : r(0.05, 0.6)) + 0.2; Pl.tint = [r(0.85, 1.25), r(0.9, 1.05), r(0.75, 1.1)];
  const u = rng();
  // (the first carcass of a dive shows its pale belly to the camera: belly up or turned toward the route; the others
  // mostly the pale belly up or toward the route, where the sun and the camera find it)
  Pl.rho0 = (cam ? (u < 0.55 ? HP : 0.35) : u < 0.42 ? HP : u < 0.82 ? 0.3 : Math.PI * 0.8) + r(-0.3, 0.3);
  Pl.twist = rng() < 0.4 ? r(-0.9, 0.9) : r(-0.2, 0.2);
  Pl.curl = rng() < 0.45 ? r(-1.8, 1.8) : 0;      // the tail stock bent sideways (m at the flukes)
  Pl.jaw = rng() < 0.45 ? r(0.5, 1) : 0;          // jaw agape
  Pl.flip = rng() < 0.5;                         // head up or down the route
  Pl.E = cam ? r(0.12, 0.42) : Math.pow(rng(), 0.85); // how far it has been eaten (0 intact .. 1 mostly skeleton)
  Pl.fin = [0, 1].map(() => { const q = rng(); return { st: q < 0.14 ? 2 : q < 0.34 ? 1 : 0, flop: r(0, 1) }; }); // 0 whole, 1 bare bones at the tip, 2 gone
  Pl.fluke = rng() < 0.28 ? { side: rng() < 0.5 ? -1 : 1, k: r(0.3, 0.65) } : null;
  const E = Pl.E, add = (t, p, hx, ha, d, bone = 0, rough = 1) => Pl.W.push({ x: (t - 0.5) * L, p, hx, ha, d, bone, rough, sd: (rng() * 1e6) | 0 });
  // the main tear: over the rib cage, on a side the camera sees (the flank toward the route, or the top; on the first
  // carcass of a dive squarely toward the camera, where the sharks feed)
  const tm = r(0.4, 0.66);
  add(tm, cam ? r(0.15, 0.95) : r(-0.05, 1.5), L * r(0.09, 0.16) * (0.85 + 0.6 * E), r(1.3, 2.4), r(0.52, 0.64), 0, 1.2);
  if (rng() < 0.35) add(tm < 0.53 ? r(0.64, 0.74) : r(0.36, 0.44), r(0, 1.8), L * r(0.05, 0.09), r(0.9, 1.6), r(0.4, 0.52), 0, 1.2); // a second tear
  // other opened parts (belly, back down to the spine, the head down to the skull, the tail stock down to the
  // vertebrae, the far flank)
  const parts = ['belly', 'back', 'head', 'tail', 'far'], n2 = 1 + Math.floor(rng() * (1.5 + 2 * E));
  for (let k = 0; k < n2; k++) {
    const pt = parts[Math.floor(rng() * parts.length)], rho = (t) => Pl.rho0 + Pl.twist * (t - 0.5);
    if (pt === 'belly') { const t = r(0.28, 0.46); add(t, rho(t) + r(-0.4, 0.4), r(1, 2), r(0.6, 1), r(0.3, 0.42)); }
    else if (pt === 'back') { const t = r(0.22, 0.55); add(t, rho(t) + Math.PI + r(-0.3, 0.3), r(1.5, 3), r(0.6, 1), 0.58, 1); }
    else if (pt === 'head') { add(r(0.88, 0.95), r(0.1, 1.8), r(0.7, 1.3), r(0.5, 0.9), 0.5, 1); }
    else if (pt === 'tail') { add(r(0.04, 0.11), r(-0.2, 2.2), r(0.6, 1.1), r(0.4, 0.7), 0.6, 1); }
    else { const t = r(0.3, 0.7); add(t, r(2.3, 3.3), r(1, 2.5), r(0.7, 1.3), r(0.35, 0.5)); }
  }
  // the tail stock and flukes, opened down to bone (sharks begin there: the carcasses are eaten there first)
  add(r(0.03, 0.09), r(0, 2.2), r(1.0, 1.6), r(0.6, 1.0), 0.6, 1); add(r(0.1, 0.2), r(-0.2, 2.4), r(0.9, 1.5), r(0.6, 1.0), r(0.4, 0.55));
  if (!Pl.fluke && rng() < 0.45) Pl.fluke = { side: rng() < 0.5 ? -1 : 1, k: r(0.3, 0.6) };
  // bite marks: more and bigger the further it has been eaten
  for (let k = 0, nb = Math.round(r(5, 10) + 6 * E); k < nb; k++) {
    const rr = r(0.25, 0.55) * (0.9 + 0.4 * E);
    add(r(0.12, 0.88), r(-0.4, 3.3), rr * r(1, 1.6), rr, r(0.12, 0.26), 0, 0.8);
  }
  // stripping: past ~0.35 the middle of the body is eaten down toward the skeleton, tissue left on head and tail
  Pl.sk = sstep(0.32, 0.85, E) * 0.62;
  Pl.st0 = 0.5 - (0.16 + 0.24 * E) + r(-0.05, 0.05); Pl.st1 = 0.5 + (0.12 + 0.2 * E) + r(-0.05, 0.05);
  Pl.ribFall = sstep(0.35, 0.95, E) * 0.75;
  return Pl;
}
const rhoAt = (Pl, t) => Pl.rho0 + Pl.twist * (t - 0.5);
// how far the middle of the body is stripped at t, angle p (0..0.93); the side on the mud keeps more
function stripAt(Pl, t, p, x) {
  if (!Pl.sk) return 0;
  const n = 0.04 * vn3(x * 0.4, p * 0.8, 0.5, Pl.sd + 31);
  const w = sstep(Pl.st0 - 0.04, Pl.st0 + 0.04, t + n) * sstep(Pl.st1 + 0.04, Pl.st1 - 0.04, t - n);
  // eaten down onto the rib cage and spine (k ~0.4), ragged sheets of hide and blubber still clinging here and there
  const sheet = sstep(0.15, 0.4, vn3(x * 0.55, p * 1.6, 0.2, Pl.sd + 33) + 0.3 * vn3(x * 1.7, p * 4, 0.6, Pl.sd + 34));
  return Pl.sk * w * (Math.sin(p) > -0.3 ? 1 : 0.6) * (1 - 0.7 * sheet);
}
// wound depth D (fraction of the radius removed), rim M (0..1) and bone floor B (0..1) at body x, template angle p
function woundAt(Pl, x, p, out) {
  let D = 0, M = 0, B = 0;
  const a = p * Pl.Rr;
  for (const w of Pl.W) {
    const dx = (x - w.x) / w.hx;
    if (dx > 1.5 || dx < -1.5) continue;
    const da = angD(p, w.p) * Pl.Rr / w.ha;
    if (da > 1.5 || da < -1.5) continue;
    // ragged, scalloped rim (bites), then a steep step down through the blubber (~0.09 of the radius: 12-16 cm) onto
    // a shelf, then down into the muscle
    const e = Math.sqrt(dx * dx + da * da) + w.rough * (0.2 * vn3(x * 1.1, a * 1.1, 0.3, w.sd) + 0.09 * vn3(x * 3.7, a * 3.7, 0.7, w.sd + 1))
      + 0.06 * w.rough * Math.abs(Math.sin(Math.atan2(da, dx) * 7 + w.sd));
    const m = sstep(0.97, 0.74, e); if (m > M) M = m;
    const d = w.d * (0.17 * sstep(0.95, 0.89, e) + 0.83 * sstep(0.85, 0.55, e)); if (d > D) D = d;
    if (w.bone && d > 0.3) B = Math.max(B, sstep(0.3, 0.45, d));
  }
  const t = x / Pl.L + 0.5, S = stripAt(Pl, t, p, x);
  if (S > D) D = S;
  if (S > 0.05) M = Math.max(M, 0.12 + 0.88 * sstep(0.25, 0.5, S)); // (the clinging sheets show hide and blubber)
  out[0] = D; out[1] = M; out[2] = B;
  return out;
}
const _w3 = [0, 0, 0], _uv = [0, 0];
// Hawaiian coral heads (linear tints of the reef's grey templates): lobe coral (yellow-brown, olive), cauliflower coral
// (pink-brown), rice coral (brown, purple-brown)
const CORAL_HI = [[0.86, 0.74, 0.36], [0.62, 0.62, 0.32], [0.8, 0.56, 0.4], [0.82, 0.56, 0.52], [0.58, 0.44, 0.38], [0.6, 0.46, 0.56]];

// point on the body surface at (t, anatomical angle a), radius factor k. The carcass has settled on the mud: below
// its axis it is flattened and spread; where the middle is stripped the axis sinks toward the mud.
function bodyPt(Pl, t, a, k, o) {
  const L = Pl.L, g = Pl.gk * (1 + Pl.bloat * Math.exp(-(((t - 0.4) / 0.14) ** 2)));
  const az = prof(AZ, t) * L * g, by = prof(BY, t) * L * g, rho = rhoAt(Pl, t), cr = Math.cos(rho), sr = Math.sin(rho);
  const ca = Math.cos(a) * az * k, sa = Math.sin(a) * by * k;
  let z = ca * cr - sa * sr, y = ca * sr + sa * cr; // ventral axis at angle rho, left flank at rho + pi / 2
  const ext = Math.sqrt((az * sr) ** 2 + (by * cr) ** 2);
  const yc = ext * 0.72 * (1 - 0.3 * sstep(0.2, 0.8, Pl.sk ? stripAt(Pl, t, HP, 0) / Pl.sk : 0));
  if (y < 0) { y *= 0.72; z *= 1.08; }
  o[0] = (t - 0.5) * L;
  o[1] = yc + y;
  o[2] = z + Pl.curl * Math.max(0, 1 - t / 0.42) ** 2;
  return o;
}
// throat pleats (anatomical): grooves from the chin back past the flippers (1 = in a groove)
const pleat = (Pl, t, a) => { const da = angD(a, 0); return t > 0.48 && t < 0.975 && Math.abs(da) < 1.25 ? sstep(0.48, 0.55, t) * sstep(1.25, 1.0, Math.abs(da)) * sstep(0.6, 0.95, 0.5 + 0.5 * Math.cos(da * Pl.Rr * TAU / 0.55)) : 0; };
// the mouth line along each side of the head (1 = in the gape); wider and deeper with the jaw agape
const mouthAt = (Pl, t, a) => { const w = 0.07 + 0.07 * Pl.jaw; return sstep(0.78 - 0.05 * Pl.jaw, 0.84, t) * Math.max(Math.exp(-((angD(a, 1.15) / w) ** 2)), Math.exp(-((angD(a, -1.15) / w) ** 2))); };

// ---------------------------------------------------------------- the carcass
function* freshG(b, Pl, Q, spots, ring) {
  const L = Pl.L, nv = Math.max(24, Math.round(L / Q.du)), nu = Q.nu, sd = Pl.sd, P3 = [0, 0, 0];
  const Dv = [], PV = new Float32Array((nv + 1) * nu * 3);
  // the surface first, two rings per step (gridG's own steps of 8 rings cost up to 8 ms on medium, cold, at zone start)
  for (let j = 0, q = 0; j <= nv; j++) {
    for (let i = 0; i < nu; i++, q += 3) {
      const t = j / nv, a = i / nu * TAU, p = a + rhoAt(Pl, t);
      woundAt(Pl, (t - 0.5) * L, p, _w3);
      let k = 1 - _w3[0];
      // skin relief: sagging folds and lumps; the gape; the pleat grooves
      k *= 1 + 0.025 * vn3(t * L * 0.6, a * 1.3, 0.2, sd + 3) + 0.01 * vn3(t * L * 2.5, a * 5, 0.9, sd + 4);
      const mouth = mouthAt(Pl, t, a), pl = pleat(Pl, t, a);
      k *= 1 - (0.14 + 0.22 * Pl.jaw) * mouth - 0.04 * pl * (1 - _w3[1]); // (pleats as real grooves: they read at 640x360)
      bodyPt(Pl, t, a, k, P3);
      PV[q] = P3[0]; PV[q + 1] = Math.max(-0.05, P3[1]); PV[q + 2] = P3[2];
      Dv.push(_w3[0], _w3[1], mouth, pl, _w3[2], Math.cos(a), t, a);
    }
    if (j & 1) yield;
  }
  const v0 = yield* gridG(b, nu, nv, (u, v, i, j, out) => { const q = (j * nu + i) * 3; out[0] = PV[q]; out[1] = PV[q + 1]; out[2] = PV[q + 2]; });
  yield;
  // close both ends (the blunt snout a little rounded forward)
  { for (const [j, dx, dir] of [[0, -0.05, -1], [nv, 0.12, 1]]) {
      const r0 = v0 + j * nu; let cy = 0, cz = 0;
      for (let i = 0; i < nu; i++) { cy += b.P[(r0 + i) * 3 + 1]; cz += b.P[(r0 + i) * 3 + 2]; }
      const c = b.v(b.P[r0 * 3] + dx * Pl.sc * 2, cy / nu, cz / nu, dir, 0, 0, 1, 1, 1, 0, 0);
      for (let i = 0; i < nu; i++) { const a = r0 + i, a2 = r0 + (i + 1) % nu; if (dir < 0) b.t(c, a, a2); else b.t(c, a2, a); }
      Dv.push(0, 0, 0, 0, 0, 0, j ? 1 : 0, 0);
    } }
  // paint: dark back, paler belly and throat (countershaded), mottling, pale sloughed patches; at the wounds a rim of
  // blubber, red muscle, a dark cavity, or bone where the wound goes down to it
  const C = [0, 0, 0], K = Pl.K;
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
    const q = (i - v0) * 8, D = Dv[q], M = Dv[q + 1], mouth = Dv[q + 2], pl = Dv[q + 3], B = Dv[q + 4], ven = Dv[q + 5], t = Dv[q + 6], a = Dv[q + 7];
    const n1 = vn3(x * 0.35, y * 0.35, z * 0.35, sd + 11), n2 = vn3(x * 1.4, y * 1.4, z * 1.4, sd + 12);
    set3(C, K.SKIN); C[0] *= Pl.tint[0]; C[1] *= Pl.tint[1]; C[2] *= Pl.tint[2];
    mixIn(C, K.SKIN2, sstep(0.1, 0.5, n2) * 0.7);                               // mottling
    mixIn(C, K.BELLY, sstep(-0.05, 0.55, ven) * (0.85 + 0.15 * n2));            // countershading: cream belly and throat
    mixIn(C, K.SLOUGH, sstep(0.55 - 0.6 * Pl.slough, 0.85 - 0.6 * Pl.slough, n1 + 0.25 * n2) * 0.8); // skin peeling off
    mixIn(C, [0.05, 0.045, 0.045], pl * 0.85);                                   // pleat grooves
    mixIn(C, [0.012, 0.01, 0.01], mouth * 0.95);                                 // the jaw line / gape
    const eye = Math.min(Math.hypot((t - 0.805) * Pl.L, (Math.abs(angD(a, 0)) - 1.32) * Pl.Rr), 1);
    mixIn(C, [0.01, 0.01, 0.012], sstep(0.13, 0.08, eye));                      // the small eye
    let wet = 0.25;
    if (M > 0.03) {
      // the cut: a cream band of blubber at the rim (the step down), then red muscle in strands, maroon and near
      // black deeper in; bone where the wound goes down to it
      const bl = sstep(0.04, 0.16, M), st = vn3(x * 0.6, a * 9, 0.4, sd + 13) * 0.6 + vn3(x * 2.5, a * 22, 0.9, sd + 14) * 0.4;
      mixIn(C, n2 > 0 ? K.BLUB : K.BLUB2, bl);
      mixIn(C, K.MUSC, sstep(0.5, 0.62, M) * (0.85 + 0.3 * st));
      mixIn(C, K.MAROON, sstep(0.62, 0.9, M) * sstep(-0.2, 0.4, st + 0.3 * n1));
      mixIn(C, K.STR, sstep(0.35, 0.5, st) * sstep(0.55, 0.8, M) * 0.5);        // pale strings of connective tissue
      mixIn(C, K.DEEP, sstep(0.25, 0.48, D) * (1 - B));
      mixIn(C, K.BONE, B * (0.85 + 0.15 * n1));
      wet = 0.25 + 0.65 * bl - 0.3 * B;
    }
    const ao = 0.5 + 0.5 * sat(y / 0.5);                                         // dark where it meets the mud
    o[0] = C[0] * ao; o[1] = C[1] * ao; o[2] = C[2] * ao; o[3] = wet; o[4] = 0;
    // spots: the rims of the wounds (the faint cloud of scraps over them, layoutWfA)
    if (M > 0.35 && M < 0.85 && ny > -0.3 && y > 0.3 && ((i - v0) & 1) === 0 && (Math.floor((i - v0) / nu) & 1) === 0) spots.push(x, y, z, nx, ny, nz, M);
    // (feeding spots all around the body for the crowd, wf_crowd.js: skin, wound rims, deep wounds, the tail stock)
    if (ring && (i - v0) < (nv + 1) * nu && ((i - v0) % nu) % 4 === 0 && Math.floor((i - v0) / nu) % 4 === 0 && y > MUD + 0.3 && ny > -0.25)
      ring.push(x, y, z, nx, ny, nz, t < 0.14 ? 3 : D > 0.25 ? 2 : M > 0.3 ? 1 : 0, t);
  });
  return v0;
}
// Baleen hanging from the upper jaw in an agape mouth: a dark comb of plates in the gape on each side, both faces
// drawn (the strip is thin)
function* baleenG(b, Pl) {
  if (Pl.jaw < 0.3) return;
  const A = [0, 0, 0], B = [0, 0, 0], n = 36;
  for (const s of [1, -1]) {
    const v0 = b.vc, i0 = b.I.length;
    for (let i = 0; i <= n; i++) {
      const t = 0.79 + 0.18 * i / n;
      bodyPt(Pl, t, s * 1.21, 0.97, A); bodyPt(Pl, t, s * 1.15, 0.97 - (0.2 + 0.25 * Pl.jaw) * sstep(0.79, 0.84, t) * sstep(0.98, 0.93, t), B);
      const g = (i & 1) ? 0.05 : 0.025, f = 0.12 + 0.05 * ((i * 7) % 3);
      b.v(A[0], A[1], A[2], 0, 1, 0, g, g * 0.95, g * 0.9, 0.3, 0);
      b.v(B[0], B[1], B[2], 0, 1, 0, f, f * 0.9, f * 0.8, 0.3, 0);
    }
    for (let i = 0; i < n; i++) { const q = v0 + i * 2; b.t(q, q + 1, q + 2); b.t(q + 1, q + 3, q + 2); b.t(q, q + 2, q + 1); b.t(q + 1, q + 2, q + 3); }
    b.smooth(v0, i0);
    yield;
  }
}
// Flaps of blubber hanging from the lower rim of the bigger wounds (cream inside, skin outside)
function* flapsG(b, Pl) {
  const L = Pl.L, A = [0, 0, 0], C0 = [0, 0, 0], rng = mulberry32(Pl.sd + 71);
  for (const w of Pl.W) {
    if (w.d < 0.3 || w.hx < 0.9) continue;
    for (let k = 0, n = 2 + Math.floor(rng() * 4); k < n; k++) {
      const ph = TAU * rng(), dx = Math.cos(ph) * 0.92 * w.hx, da = Math.sin(ph) * 0.92 * w.ha / Pl.Rr;
      const t = (w.x + dx) / L + 0.5;
      if (t < 0.05 || t > 0.95) continue;
      const a = w.p + da - rhoAt(Pl, t);
      bodyPt(Pl, t, a, 1, A); bodyPt(Pl, t, a, 0, C0);
      const out = nrm3([0, A[1] - C0[1], A[2] - C0[2]]);
      if (out[1] > 0.6 || A[1] < MUD + 0.4) continue; // only where it can hang down the flank
      const len = 0.5 + rng() * 0.7, wd = 0.14 + rng() * 0.12, tw = (rng() - 0.5) * 0.6, down = nrm3([tw * 0.3, -1, out[2] * 0.25]), sz = out[2] >= 0 ? 1 : -1;
      yield* bladeG(b, 4, 6, (u) => ({ c: [A[0] + down[0] * len * u + tw * u * 0.2, Math.max(MUD + 0.05, A[1] + down[1] * len * u), A[2] + down[2] * len * u + out[2] * 0.06 * u], cd: [1, 0, 0], ch: wd * (1 - 0.5 * u), nd: [0, 0, sz], th: 0.035 }),
        (i, x, y, z, nx, ny, nz, o) => { const c = set3([0, 0, 0], Pl.K.BLUB); mixIn(c, Pl.K.MUSC, sstep(0.1, 0.5, vn3(x * 5, y * 5, z * 5, Pl.sd + k)) * 0.5); if (nz * sz > 0.3) mixIn(c, Pl.K.SKIN2, 0.85); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = 0.8; o[4] = 0; });
    }
  }
}
// a flat lofted blade (flipper / fluke lobe): sections along the span w (0 root .. 1 tip), each an ellipse with
// half chord ch along cd and half thickness th along nd, centred on c
function* bladeG(b, n, m, at, paint) {
  const v0 = yield* gridG(b, m, n, (u, v, i, j, out) => {
    const s = at(v), a = u * TAU, ca = Math.cos(a), sa = Math.sin(a);
    out[0] = s.c[0] + s.cd[0] * ca * s.ch + s.nd[0] * sa * s.th;
    out[1] = s.c[1] + s.cd[1] * ca * s.ch + s.nd[1] * sa * s.th;
    out[2] = s.c[2] + s.cd[2] * ca * s.ch + s.nd[2] * sa * s.th;
  });
  if (paint) yield* paintG(b, v0, paint);
  return v0;
}
const nrm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
function skinPaint(sd, pale, K) {
  return (i, x, y, z, nx, ny, nz, o) => {
    const n2 = vn3(x * 1.4, y * 1.4, z * 1.4, sd), n1 = vn3(x * 0.4, y * 0.4, z * 0.4, sd + 1), c = set3([0, 0, 0], K.SKIN);
    mixIn(c, K.SKIN2, sstep(0.1, 0.5, n2) * 0.7); mixIn(c, K.BELLY, pale * sat(ny)); mixIn(c, K.SLOUGH, sstep(0.3, 0.6, n1) * 0.6);
    const ao = 0.55 + 0.45 * sat(y / 0.4);
    o[0] = c[0] * ao; o[1] = c[1] * ao; o[2] = c[2] * ao; o[3] = 0.3; o[4] = 0;
  };
}
// bone: ivory, a little glossy, a faint stain of tissue
function cleanBone(sd, stain, K) {
  return (i, x, y, z, nx, ny, nz, o) => {
    const c = set3([0, 0, 0], K.BONE), n = vn3(x * 2.2, y * 2.2, z * 2.2, sd);
    mixIn(c, K.MUSC, sstep(0.25, 0.7, n) * stain); mixIn(c, [0.95, 0.9, 0.74], sat(ny) * 0.25);
    const ao = 0.62 + 0.38 * sat(0.5 + 0.5 * ny);                                // shaded below: it reads as a solid
    o[0] = c[0] * ao; o[1] = c[1] * ao; o[2] = c[2] * ao; o[3] = 0.55; o[4] = 0;
  };
}
// ellipsoid blob along the axes A1, A2, A3 (unit) with radii r1..r3 about c
function* blobAx(b, det, c, A1, r1, A2, r2, A3, r3) {
  return yield* blobG(b, det, (ux, uy, uz, o) => {
    o[0] = c[0] + A1[0] * ux * r1 + A2[0] * uy * r2 + A3[0] * uz * r3;
    o[1] = c[1] + A1[1] * ux * r1 + A2[1] * uy * r2 + A3[1] * uz * r3;
    o[2] = c[2] + A1[2] * ux * r1 + A2[2] * uy * r2 + A3[2] * uz * r3;
  });
}
// the flukes (one lobe partly gone on some), the two long slender flippers (whole, bare bones at the tip, or gone)
function* appendagesG(b, Pl, Q, obs) {
  const L = Pl.L, sd = Pl.sd, sc = Pl.sc, x0 = -L / 2, c0 = bodyPt(Pl, 0, 0, 0, [0, 0, 0]);
  const rho = rhoAt(Pl, 0), lat = [0, Math.cos(rho), -Math.sin(rho)], ven = [0, Math.sin(rho), Math.cos(rho)]; // (x, y, z)
  const span = 0.115 * L * Pl.gk, C0 = 0.05 * L;
  for (const side of [1, -1]) {
    const cut = Pl.fluke && Pl.fluke.side === side ? Pl.fluke.k : 1;
    yield* bladeG(b, 10, Math.max(8, Q.rib + 4), (w) => {
      const ww = w * 0.98 * cut, ch = C0 * 0.5 * (1 - 0.62 * ww ** 1.6) + 0.04, le = x0 + 0.25 - 0.55 * C0 * ww ** 1.3;
      const notch = 0.14 * C0 * Math.exp(-((ww / 0.12) ** 2)), sw = side * span * ww;
      let y = c0[1] + lat[1] * sw;
      if (y < MUD + 0.08) y = MUD + 0.08 + (y - MUD - 0.08) * 0.04; // a lobe that would reach into the mud lies on it
      const rag = cut < 1 && w > 0.9 ? 0.6 + 0.4 * vn3(w * 9, side, 0.3, sd) : 1;
      return { c: [le - ch + notch * 0.5, y, c0[2] + lat[2] * sw], cd: [1, 0, 0], ch: (ch - notch * 0.5) * rag, nd: ven, th: 0.08 * sc * (1 - 0.75 * ww) };
    }, skinPaint(sd + 21, 0.4, Pl.K));
  }
  obs.push([x0 - 0.5 * C0, Math.max(0.3, c0[1]), c0[2] - span * 0.7, x0 - 0.5 * C0, Math.max(0.3, c0[1]), c0[2] + span * 0.7, 0.35]);
  yield;
  for (let f = 0; f < 2; f++) {
    const F = Pl.fin[f], a0 = f ? -1.25 : 1.25, t0 = 0.715, base = bodyPt(Pl, t0, a0, 0.92, [0, 0, 0]), ax = bodyPt(Pl, t0, a0, 0, [0, 0, 0]);
    const nOut = nrm3([0, base[1] - ax[1], base[2] - ax[2]]), len = 0.125 * L * (F.st === 2 ? 0.22 : 1);
    // (swept well back: a raised flipper stood up short and wide read as a shark's dorsal fin)
    const dir = nrm3([-0.85, nOut[1] * 0.6 - 0.25 - 0.5 * F.flop, nOut[2] * 0.75]), vrho = rhoAt(Pl, t0);
    const vn = [0, Math.sin(vrho), Math.cos(vrho)], nd = nrm3(cross(dir, cross(vn, dir))), cd = nrm3(cross(dir, nd)); // (flat: thickness along the belly axis)
    const at = (w) => {
      const droop = 0.18 * w * w * len;
      return [base[0] + dir[0] * len * w, Math.max(MUD + 0.07, base[1] + dir[1] * len * w - droop * 0.4), base[2] + dir[2] * len * w];
    };
    const wEnd = F.st === 1 ? 0.5 : 1;
    yield* bladeG(b, F.st === 1 ? 5 : 9, Math.max(8, Q.rib + 4), (w) => ({ c: at(w * wEnd), cd, ch: 0.013 * L * (1 - 0.6 * (w * wEnd) ** 1.4) + 0.04, nd, th: 0.08 * sc * (1 - 0.65 * w * wEnd) }), skinPaint(sd + 22 + f, 0.65, Pl.K));
    if (F.st === 1) { // the finger bones beyond the flesh
      for (let k = -1.5; k <= 1.5; k++) {
        const pts = [], rr = [];
        for (let q = 0; q <= 4; q++) { const w = 0.45 + 0.5 * q / 4, p = at(w), cw = 0.013 * L * (1 - 0.6 * w ** 1.4) * 0.5 * k / 1.5; pts.push([p[0] + cd[0] * cw, Math.max(MUD + 0.04, p[1] + cd[1] * cw), p[2] + cd[2] * cw]); rr.push(0.035 * sc * (1 - 0.4 * q / 4)); }
        const v1 = b.vc; b.tube(pts, rr, 4, null, { tip: true }); yield* paintG(b, v1, cleanBone(sd + 50 + k, 0.2, Pl.K));
      }
    }
    if (F.st === 2) { const v1 = yield* blobAx(b, 1, at(1), dir, 0.12, cd, 0.18, nd, 0.1); yield* paintG(b, v1, cleanBone(sd + 60, 0.5, Pl.K)); }
    const tip = at(1);
    obs.push([base[0], base[1], base[2], tip[0], tip[1], tip[2], 0.3]);
  }
}
// bone laid bare: rib arcs where the tear and the stripping expose them (some fallen out onto the mud), the
// vertebrae (centrum, neural spine, transverse processes) where the back or the tail stock is open
function* bonesG(b, Pl, Q, obs, marks) {
  const L = Pl.L, sc = Pl.sc, P3 = [0, 0, 0], A3 = [0, 0, 0], sd = Pl.sd, rng = mulberry32(sd + 5);
  let nRib = 0;
  for (let t = 0.42; t < 0.77; t += 0.95 / L) {
    const x = (t - 0.5) * L, rho = rhoAt(Pl, t);
    for (const side of [1, -1]) {
      const n = 12, ex = [];
      for (let k = 0; k <= n; k++) { const a = side * (Math.PI - 0.25 - (Math.PI - 0.55) * k / n); ex.push(woundAt(Pl, x, a + rho, _w3)[0] > 0.17); }
      let i0 = ex.indexOf(true), i1 = ex.lastIndexOf(true);
      if (i0 < 0) continue;
      i0 = Math.max(0, i0 - 1); i1 = Math.min(n, i1 + 1);
      const S = stripAt(Pl, t, HP, x), fall = S > 0.3 && rng() < Pl.ribFall ? 0.6 + 0.4 * rng() : 0;
      if (S > 0.5 && rng() < 0.12) continue; // a rib gone
      const pts = [], rr = [];
      for (let k = i0; k <= i1; k++) {
        const a = side * (Math.PI - 0.25 - (Math.PI - 0.55) * k / n);
        bodyPt(Pl, t, a, 0.86 - 0.04 * Math.sin(k * 1.7 + t * 40), P3);
        bodyPt(Pl, t, a, 0, A3);
        let y = P3[1], z = P3[2];
        if (fall) { y = lerp(y, MUD + 0.07, fall * sat((k - i0) / 3)); z = A3[2] + (z - A3[2]) * (1 + 0.7 * fall); } // fallen out onto the mud
        pts.push([P3[0] - 0.1 * (k / n) * L / 21, Math.max(MUD + 0.05, y), z]); rr.push((0.09 - 0.025 * Math.abs(k - (i0 + i1) / 2) / Math.max(1, i1 - i0)) * sc); // (13-18 cm across)
      }
      if (pts.length < 2) continue;
      const v1 = b.vc;
      b.tube(pts, rr, Q.rib, null, { tip: true });
      yield* paintG(b, v1, cleanBone(sd + 100 + nRib, 0.15, Pl.K));
      if (!nRib) marks.ribs = pts[pts.length >> 1];
      nRib++;
    }
    yield;
  }
  // vertebrae along the back (anatomical a = pi) wherever it is open, and where the middle is stripped
  let nV = 0;
  for (let t = 0.03; t < 0.8; t += 0.55 / L) {
    const x = (t - 0.5) * L, rho = rhoAt(Pl, t), D = woundAt(Pl, x, Math.PI + rho, _w3)[0];
    if (D < 0.3) continue;
    const r = (0.1 + 1.6 * prof(BY, t)) * sc * 0.9, c = bodyPt(Pl, t, Math.PI, 0.45, [0, 0, 0]), ax = bodyPt(Pl, t, 0, 0, [0, 0, 0]);
    const dor = nrm3([0, c[1] - ax[1], c[2] - ax[2]]), lat = [0, -dor[2], dor[1]];
    if (c[1] < MUD + r * 0.6) c[1] = MUD + r * 0.6;
    const v1 = yield* blobAx(b, Q.vd, c, [1, 0, 0], r * 1.15, dor, r, lat, r);
    const ns = [c[0] - r * 0.3, c[1] + dor[1] * r * 1.7, c[2] + dor[2] * r * 1.7];
    yield* blobAx(b, 1, ns, dor, r * 1.05, [1, 0, 0], r * 0.32, lat, r * 0.18);
    for (const s of [1, -1]) {
      const tp = [c[0], Math.max(MUD + 0.05, c[1] + lat[1] * s * r * 1.5), c[2] + lat[2] * s * r * 1.5];
      yield* blobAx(b, 1, tp, lat, r * 0.95, [1, 0, 0], r * 0.3, dor, r * 0.15);
    }
    yield* paintG(b, v1, cleanBone(sd + 200 + nV, 0.25, Pl.K));
    if (!marks.spine || Math.abs(t - 0.3) < Math.abs(marks.spineT - 0.3)) { marks.spine = c.slice(); marks.spineT = t; }
    nV++;
  }
  if (nV) for (const s of [0.1, 0.4, 0.7]) { // (capsules along the exposed spine, which may lie outside the body chain)
    const c = bodyPt(Pl, s, Math.PI, 0.45, [0, 0, 0]), e = bodyPt(Pl, s + 0.3, Math.PI, 0.45, [0, 0, 0]);
    obs.push([c[0], c[1], c[2], e[0], e[1], e[2], 0.45 * sc]);
  }
  marks.nRib = nRib; marks.nV = nV;
}
// obstacle capsules along the body (an authored chain: a fitted chain would wrap the flippers and flukes into the
// body's own capsules and reach toward the route); thinner where the middle has been stripped
function bodyObs(Pl, obs) {
  const A = [0, 0, 0], B = [0, 0, 0], Q = [0, 0, 0];
  for (let k = 0; k < 8; k++) {
    const ta = 0.02 + k / 8 * 0.96, tb = 0.02 + (k + 1) / 8 * 0.96, tm = (ta + tb) / 2;
    bodyPt(Pl, ta, 0, 0, A); bodyPt(Pl, tb, 0, 0, B);
    let r = 0;
    for (let a = 0; a < TAU; a += 0.4) { bodyPt(Pl, tm, a, 1 - stripAt(Pl, tm, a + rhoAt(Pl, tm), 0), Q); r = Math.max(r, Math.hypot(Q[1] - (A[1] + B[1]) / 2, Q[2] - (A[2] + B[2]) / 2)); }
    r = Math.max(0.35, r * 0.95);
    obs.push([A[0] + r * 0.4, Math.max(A[1], r * 0.5), A[2], B[0] - r * 0.4, Math.max(B[1], r * 0.5), B[2], r]);
  }
}

// strands of tissue trailing from the cut edges, hanging and drifting a little in the water (sway material;
// documented under a floating carcass: "strands of whale tissue are hanging beneath it")
function strandsG(ob, Pl, ring, n) {
  const rng = mulberry32(Pl.sd + 91), K = Pl.K, nS = ring.length / 8;
  for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
    const q = Math.floor(rng() * nS) * 8;
    if (ring[q + 6] < 1 || ring[q + 6] > 2) continue; // (cut edges only)
    k++;
    const len = 0.35 + rng() * 0.8, nx = ring[q + 3], ny = ring[q + 4], nz = ring[q + 5];
    let dx = nx * 0.7 + (rng() - 0.5) * 0.5, dy = ny * 0.3 - 0.75, dz = nz * 0.7 + (rng() - 0.5) * 0.5;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const pts = [], rr = [], cu = (rng() - 0.5) * 0.5;
    for (let j = 0; j <= 5; j++) {
      const t = j / 5, x = ring[q] + dx * len * t + Math.sin(t * 3 + cu * 9) * 0.06, z = ring[q + 2] + dz * len * t + cu * t * t * len;
      pts.push([x, Math.max(MUD + 0.04, ring[q + 1] + dy * len * t), z]); rr.push((0.03 + 0.015 * rng()) * (1 - 0.7 * t));
    }
    const c = set3([0, 0, 0], rng() < 0.45 ? K.STR : rng() < 0.6 ? K.BLUB : K.MUSC);
    ob.tube(pts, rr, 4, (v, a, x, y, z, o) => { o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = 0.1 * v * v; o[7] = 0; }, { tip: true });
  }
}
// ---------------------------------------------------------------- the carcass template
// mirror a builder's x and / or z (template frame), keeping the triangles front-facing
function mirror(b, mx, mz) {
  for (let i = 0; i < b.P.length; i += 3) { if (mx) { b.P[i] = -b.P[i]; b.N[i] = -b.N[i]; } if (mz) { b.P[i + 2] = -b.P[i + 2]; b.N[i + 2] = -b.N[i + 2]; } }
  if (mx !== mz) for (let i = 0; i < b.I.length; i += 3) { const t = b.I[i + 1]; b.I[i + 1] = b.I[i + 2]; b.I[i + 2] = t; }
}
export function* carcassG(seed, tier, W) {
  const Q = resOf(tier), Pl = carcassPlan(seed, W), b = new Builder(), ob = new Builder(), obs = [], spots = [], marks = {}, ring = [];
  yield* freshG(b, Pl, Q, spots, ring);
  yield* appendagesG(b, Pl, Q, obs);
  yield* bonesG(b, Pl, Q, obs, marks);
  yield* baleenG(b, Pl);
  yield* flapsG(b, Pl);
  { const w = Pl.W[0], tw = w.x / Pl.L + 0.5; marks.flank = bodyPt(Pl, tw, w.p - rhoAt(Pl, tw), 1.05, [0, 0, 0]); }
  bodyObs(Pl, obs);
  strandsG(ob, Pl, ring, tier === 'low' ? 14 : 24);
  yield;
  // template frame: +z toward the route (mirrored when the carcass lies on the +x side of the route, see layout);
  // the head toward +x, or toward -x on half of them
  const mx = Pl.flip, mz = W.side > 0;
  if (mx || mz) {
    mirror(b, mx, mz); mirror(ob, mx, mz);
    for (const o of obs) { if (mx) { o[0] = -o[0]; o[3] = -o[3]; } if (mz) { o[2] = -o[2]; o[5] = -o[5]; } }
    for (let i = 0; i < spots.length; i += 7) { if (mx) { spots[i] = -spots[i]; spots[i + 3] = -spots[i + 3]; } if (mz) { spots[i + 2] = -spots[i + 2]; spots[i + 5] = -spots[i + 5]; } }
    for (let i = 0; i < ring.length; i += 8) { if (mx) { ring[i] = -ring[i]; ring[i + 3] = -ring[i + 3]; } if (mz) { ring[i + 2] = -ring[i + 2]; ring[i + 5] = -ring[i + 5]; } }
    for (const k of ['ribs', 'spine', 'flank']) { const m = marks[k]; if (m) { if (mx) m[0] = -m[0]; if (mz) m[2] = -m[2]; } }
  }
  b.obs = obs;
  b.band = 0.05;
  const t = b.build();
  yield;
  // base: the body's contact line with the mud (y = 0), not its lowest vertices (the flattened fluke lobe)
  const base = [];
  for (let k = 0; k <= 8; k++) { const tt = 0.06 + 0.88 * k / 8; base.push((tt - 0.5) * W.L, 0, 0); }
  setBase(t, base);
  t.wfL = W.L; t.wfE = Pl.E; t.wfMarks = marks;
  t.spots = Float32Array.from(spots);
  t.ring = Float32Array.from(ring); t.wfHead = Pl.flip ? -1 : 1;
  t.strands = ob.vc ? ob.build() : null; // (the trailing strands, see strandsG)
  if (t.strands) lab(t.strands, ...WF.scraps);
  t.label = WF.sunCarcass[0];
  t.fact = WF.sunCarcass[1];
  return t;
}
function* carcassJob(seg, tier) {
  const W = whaleFallOf(seg);
  if (!W) return null;
  const t = yield* carcassG(segSeed(seg, 0, 0x2545f491), tier, W);
  yield; t.points(600);
  return t;
}

// ---------------------------------------------------------------- materials
// Flesh: the static prop shader (materials.js) as its own program: aFx.x is wetness here (not encrusting growth):
// almost no settled sediment on wet tissue, and a tight glint of the lamps beside the lens on it.
function fleshMaterial() {
  const base = MAT.static, m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  m.onBeforeCompile = (sh, r) => {
    const keep = base.userData.shader;
    base.onBeforeCompile(sh, r);
    base.userData.shader = keep; m.userData.shader = sh;
    sh.fragmentShader = sh.fragmentShader
      .replace('float g = vFx.x * smoothstep', 'float g = 0.0 * smoothstep')
      .replace('float dust = smoothstep(0.55, 0.95, pN.y)', 'float dust = (1.0 - vFx.x) * 0.15 * smoothstep(0.55, 0.95, pN.y)')
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        {
          float wd = length(vViewPosition);
          float sp = pow(max(dot(normal, normalize(vViewPosition)), 0.0), 26.0);
          totalEmissiveRadiance += vec3(0.85, 0.88, 0.92) * vFx.x * sp * uLamp * 1.2 * exp(-uSigma.g * wd) / (1.0 + 0.04 * wd * wd);
          // (the light the lamps bounce around a pale carcass: it keeps the belly, blubber and bone readable as a looming
          // pale shape out to 25-30 m, as the carbonate at Lost City; stronger with distance, so close up nothing changes)
          totalEmissiveRadiance += diffuseColor.rgb * uLamp * (0.04 + 0.34 * smoothstep(8.0, 26.0, wd)) * smoothstep(0.12, 0.4, dot(diffuseColor.rgb, vec3(0.333)));
        }`);
  };
  m.customProgramCacheKey = () => 'water:nb7-wf-flesh:' + base.customProgramCacheKey();
  return m;
}
// ---------------------------------------------------------------- small templates
function scrap(seed, kind, K, k0 = 0.4) { // 0 flesh lump, 1 blubber strip (skin on one face), 2 bone fragment
  const rng = mulberry32(seed), b = new Builder(), sx = kind === 1 ? 0.25 + rng() * 0.25 : 0.1 + rng() * 0.14, sz = kind === 1 ? 0.1 + rng() * 0.08 : sx * (0.6 + rng() * 0.4), sy = kind === 1 ? 0.04 : kind === 2 ? 0.05 : sx * 0.45;
  b.blob(kind === 2 ? 1 : 2, (x, y, z, o) => {
    const d = 1 + 0.45 * vn3(x * 2 + seed, y * 2, z * 2, seed % 997);
    o[0] = x * sx * d; o[1] = Math.max(0, sy * 0.6 + y * sy * d); o[2] = z * sz * d;
    // (dirtied by the mud they lie in: darker than the tissue on the carcass)
    const c = kind === 2 ? set3([0, 0, 0], K.BONE) : kind === 1 ? (y > 0.3 ? set3([0, 0, 0], K.SKIN2) : set3([0, 0, 0], K.BLUB)) : mixIn(set3([0, 0, 0], K.MUSC), K.BLUB, sat(vn3(x * 3, y * 3, z * 3, seed % 991) + 0.2) * 0.5);
    const k = kind === 2 ? 0.8 : k0;
    o[3] = c[0] * k; o[4] = c[1] * k; o[5] = c[2] * k; o[6] = kind === 2 ? 0.2 : 0.8; o[7] = 0;
  });
  const t = b.build();
  return lab(t, WF.scraps[0], WF.scraps[1]);
}
// ---------------------------------------------------------------- init, providers
export function initWhaleFall(tier) {
  if (H.mat) return H;
  H.mat = { flesh: fleshMaterial() };
  H.scrap = [0, 1, 2, 3, 4, 5].map((k) => scrap(7301 + k, k % 3 === 2 ? 0 : k % 3, PAL_SUN, 0.7)); // (fresh, on clean sand)
  H.bone = [0, 1, 2].map((k) => lab(scrap(7311 + k, 2, PAL_FRAG), WF.ribs[0], WF.ribs[1]));
  return H;
}
// (dev tools: one carcass as a mesh in template space, with its trailing strands, e.g. for a contact sheet)
export function devCarcass(seed, tier, W) {
  const t = drain(carcassG(seed, tier, W)), m = new THREE.Mesh(t.geometry(), H.mat.flesh);
  if (t.strands) m.add(new THREE.Mesh(t.strands.geometry(), MAT.sway));
  m.userData.tpl = t;
  return m;
}
// the lava flat's rocks, fresh per segment: pillow lobes and blocky basalt
const LAVA = [{ r: 'boulder', litho: 'basalt', kind: 'angular', growth: 0.25, detail: 2 }, { r: 'pillow', growth: 0.25 }, { r: 'boulder', litho: 'basalt', growth: 0.25, detail: 2 }, { r: 'boulder', litho: 'basalt', kind: 'angular', growth: 0.2, detail: 2 }];
export function whaleFallProviders(provide) {
  provide(KEY, 'wfCarcass', 1, (seg, kk, tier) => carcassJob(seg, tier), 0);
  // (pillow lobes are ~1.6k triangles each: medium and up only)
  provide(KEY, 'wfLava', 8, (seg, k, tier) => rockJob(tiered(LAVA[tier === 'low' && k % LAVA.length === 1 ? 0 : k % LAVA.length], tier), (seg.seed ^ (k * 0x9e3779b1) ^ 0x1a7a) >>> 0));
}

// ---------------------------------------------------------------- helpers
const toChunk = (it, px, py, pz) => { const R = it.R, x = px * it.sx, y = py * it.sy, z = pz * it.sz; return [R[0] * x + R[1] * y + R[2] * z + it.x, R[3] * x + R[4] * y + R[5] * z + it.y, R[6] * x + R[7] * y + R[8] * z + it.z]; };
const toChunkN = (it, nx, ny, nz) => { const R = it.R; return [R[0] * nx + R[1] * ny + R[2] * nz, R[3] * nx + R[4] * ny + R[5] * nz, R[6] * nx + R[7] * ny + R[8] * nz]; };

// a placed item as a mesh of its own (shares the template's arrays: no copy, nothing released after upload; the
// template belongs to its segment's palette)
function itemMesh(it) {
  const t = it.tpl, g = new THREE.BufferGeometry(), R = it.R, b = t.box;
  g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(t.nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
  g.setAttribute('aFx', new THREE.BufferAttribute(t.fx, 2));
  g.setIndex(new THREE.BufferAttribute(t.idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2), Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 + 0.5);
  const m = new THREE.Mesh(g, H.mat.flesh);
  m.matrix.set(R[0] * it.sx, R[1] * it.sy, R[2] * it.sz, it.x, R[3] * it.sx, R[4] * it.sy, R[5] * it.sz, it.y, R[6] * it.sx, R[7] * it.sy, R[8] * it.sz, it.z, 0, 0, 0, 1);
  m.matrixAutoUpdate = false;
  return m;
}
// registration-only batch for the staged merge: its items are registered (registerNB) but drawn by itemMesh
class OneMesh extends IBatch {
  constructor(b) { super(H.bone[0], MAT.static, 1); this.items = b.items; }
  build() { return null; }
}

// ---------------------------------------------------------------- chain A: the carcass, its strands, the POI
export function* layoutWfA(ctx) {
  const Y = slice(2);
  if (presence(ctx, KEY) <= 0) return null;
  const fs = nbFloor(ctx), rng = chunkRng(ctx, 0x7f01);
  const st = new Batch(H.mat.flesh, 200000);
  const sw = new Batch(MAT.sway, 30000); sw.lod = 'near'; sw.soft = true;
  const labels = [], pois = [], extra = [];
  for (const g of ctx.segments) {
    const W = whaleFallOf(g);
    if (!W || W.s < ctx.s0 || W.s >= ctx.s1) continue;
    const lm = poolOf(g, 'wfCarcass', null, 1);
    let tpl = lm && lm[0];
    if (!tpl) { // not generated yet (boot, zone jump): build it here, in slices
      const it = carcassJob(g, ctx.tier);
      let r; for (;;) { r = it.next(); if (r.done) break; if (Y.over()) { yield; Y.reset(); } }
      tpl = r.value;
    }
    if (!tpl) continue;
    // local x along the path at the carcass, local z = (sa, ca) in chunk space (the template is mirrored to suit)
    const R = [W.ca, 0, W.sa, 0, 1, 0, -W.sa, 0, W.ca];
    const P = [W.x, 0, W.s];
    let ok = false;
    for (let k = 0; k < 8 && !ok; k++) { // the whole body out of the flight tube (pushed outward if needed)
      P[0] = W.x + W.side * k * 0.6 * W.sa; P[2] = W.s - W.side * k * 0.6 * W.ca; P[1] = fs.at(P[0], P[2]);
      seat(fs, tpl, R, 1, 1, 1, P, null, 0.1);
      ok = pointsClear(ctx, placedPoints(tpl, P[0], P[1], P[2], R, 1, 1, 1, 600), 0.3);
    }
    yield;
    if (!ok || !put(ctx, st, tpl, P[0], P[1], P[2], R, 1, 1, 1, [1, 1, 1], 1)) continue;
    const it = st.last;
    if (tpl.strands) sw.add(tpl.strands, it.x, it.y, it.z, R, 1, 1, 1, 1, 1, 1, 1);
    yield;
    // the crowd's feeding spots all around the body (wf_crowd.js): x, y, s, normal, kind, u along the body
    const RG = tpl.ring, ring = new Float32Array(RG.length);
    for (let i = 0; i < RG.length; i += 8) {
      const p = toChunk(it, RG[i], RG[i + 1], RG[i + 2]), n = toChunkN(it, RG[i + 3], RG[i + 4], RG[i + 5]), s = ctx.s0 - p[2];
      ring[i] = p[0]; ring[i + 1] = p[1]; ring[i + 2] = s; ring[i + 3] = n[0]; ring[i + 4] = n[1]; ring[i + 5] = -n[2];
      ring[i + 6] = RG[i + 6]; ring[i + 7] = (p[0] - P[0]) * W.ca + (s - P[2]) * W.sa;
    }
    const top = P[1] + (tpl.maxY - tpl.minY) * 0.8, toward = -W.side; // the route side, in x
    pois.push({ type: 'whalefall', x: P[0] + toward * 1.2 * W.sa, y: top, s: P[2] - toward * 1.2 * W.ca, r: W.L * 0.5,
      data: { name: tpl.label, fact: tpl.fact, L: W.L, ca: W.ca, sa: W.sa, side: W.side,
        cx: P[0], cy: P[1], cs: P[2], showpiece: true, E: tpl.wfE ?? 0.5, cam: !!W.cam,
        ring, head: tpl.wfHead || 1, camH: pathCache(ctx).y(P[2]) - P[1], gx: 0, gy: 0, gs: 0, gw: 0 } }); // (gx..gw: the crowd's pull on the camera's gaze)
    // labels on the generated shape: the main tear, the tail stock, the bare ribs (or spine)
    const mk = tpl.wfMarks || {};
    if (mk.flank) { const q = toChunk(it, mk.flank[0], mk.flank[1], mk.flank[2]); labels.push([WF.sunBite[0], q[0], q[1] + 0.3, ctx.s0 - q[2], WF.sunBite[1]]); }
    { const q = toChunk(it, -0.42 * W.L, 1.0, 0); labels.push([WF.sunTail[0], q[0], q[1], ctx.s0 - q[2], WF.sunTail[1]]); }
    const bm = mk.ribs || mk.spine;
    if (bm) { const rb = toChunk(it, bm[0], bm[1], bm[2]); labels.push([WF.ribs[0], rb[0], rb[1] + 0.15, ctx.s0 - rb[2], WF.ribs[1]]); }
    // a faint cloud of scraps and oil in the water over the wounds (sunlit specks)
    const S = tpl.spots, clouds = [];
    for (let i = 0; i < S.length && clouds.length < 5; i += 7 * 9) {
      const p = toChunk(it, S[i], S[i + 1], S[i + 2]);
      clouds.push({ x: p[0], y: p[1] + 0.8, s: ctx.s0 - p[2], rx: 1.6, ry: 0.9, rz: 1.6, n: Math.round((ctx.tier === 'low' ? 160 : 320) * (0.6 + rng() * 0.8)), size: 0.018 });
    }
    if (clouds.length) { const pm = yield* planktonMeshG(ctx, clouds, rng); if (pm) { pm.userData.lod = 'near'; extra.push(pm); } }
  }
  if (!st.items.length) return null;
  // the carcass is one big item (10-25k vertices): merging it into a batch took 5-10 ms in one stage, so it is drawn
  // as a mesh of its own over the template's arrays; the batch stays for registration (obstacles, labels, audit)
  const one = new OneMesh(st);
  for (const it of st.items) extra.push(itemMesh(it));
  return { batches: [one, sw], extra, labels, pois };
}

// ---------------------------------------------------------------- chain B: scraps around it, the lava flat
export function* layoutWfB(ctx) {
  const Y = slice();
  if (presence(ctx, KEY) <= 0) return null;
  const g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rng = chunkRng(ctx, 0x7f02);
  const st = new Batch(H.mat.flesh, 30000 * bk); st.lod = 'near';
  const place = (b, tpl, x, s, sc, col, tilt = 0.8) => {
    fs.at(x, s);
    const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], tilt), rng() * TAU), P = [x, fs.at(x, s), s];
    seat(fs, tpl, R, sc, sc, sc, P, null, 0.015);
    if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sc, tpl.r * sc, SOFT)) return false;
    return put(ctx, b, tpl, P[0], P[1], P[2], R, sc, sc, sc, col, 1);
  };
  for (const g of ctx.segments) {
    const W = whaleFallOf(g);
    if (!W || W.s + W.R < ctx.s0 - 4 || W.s - W.R > ctx.s1 + 4) continue;
    const n = Math.round(34 * lk);
    // sloppy feeding spreads tissue and a few bone fragments over the sand around the carcass
    for (let k = 0; k < n; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const u = (rng() - 0.5) * (W.L + 4), v = (rng() < 0.6 ? -1 : 1) * (2.6 + Math.pow(rng(), 1.6) * 3.5) + (rng() - 0.5);
      const x = W.x + u * W.ca + v * W.sa * W.side, s = W.s + u * W.sa - v * W.ca * W.side;
      if (s < ctx.s0 || s >= ctx.s1) continue;
      const tpl = rng() < 0.85 ? pick(rng, H.scrap) : pick(rng, H.bone), sc = 0.7 + rng() * 0.8;
      place(st, tpl, x, s, sc, [1, 1, 1], 0.9);
    }
    yield;
  }
  yield;
  // the lava flat: low black basalt and pillow lobes, rubble patches and a few coral heads (lobe and cauliflower
  // corals, as in Hawaii); small and sparse within ~15 m of the carcass, so nothing hides it, and out of the flight tube
  const lv = new Batch(MAT.static, 60000 * bk);
  {
    const lava = poolOf(g0, 'wfLava', T.rocks, 3), heads = [T.boulder, T.coralMound].filter((l) => l && l.length), occ = [];
    const Wn = [];
    for (const g of ctx.segments) { const W = whaleFallOf(g); if (W) Wn.push(W); }
    const near = (x, s) => { // 0 on the carcass .. 1 from ~15 m out
      let k = 1;
      for (const W of Wn) { const uv = whaleFallUV(W, x, s, _uv), eu = uv[0] / (W.L / 2 + 5), ev = uv[1] / 6.5; k = Math.min(k, sstep(1.0, 1.9, Math.sqrt(eu * eu + ev * ev))); }
      return k;
    };
    const putS = (tpl, x, s, sc, sy, col, tilt) => {
      const k = near(x, s);
      if (k < 0.08) return false;
      for (let i = 0; i < occ.length; i += 3) if (Math.hypot(occ[i] - x, occ[i + 1] - s) < occ[i + 2] + tpl.r * sc) return false;
      fs.at(x, s);
      const R = upTo(mix3([0, 1, 0], [fs.nx, fs.ny, fs.nz], tilt), rng() * TAU), P = [x, fs.at(x, s), s];
      seat(fs, tpl, R, sc, sy, sc, P, null, 0.04 + 0.1 * sy);
      if (!clearBox(pc, P[0], P[2], P[1], P[1] + (tpl.maxY - tpl.minY) * sy, tpl.r * sc, SOLID)) return false;
      if (!put(ctx, lv, tpl, P[0], P[1], P[2], R, sc, sy, sc, col, 1)) return false;
      occ.push(x, s, tpl.r * sc);
      return true;
    };
    const side = () => (rng() < 0.5 ? -1 : 1);
    for (let k = 0, n = Math.round((ctx.tier === 'low' ? 8 : 13) * bk); k < n; k++) { // basalt
      if (Y.over()) { yield; Y.reset(); }
      const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + side() * (4.5 + Math.pow(rng(), 0.8) * 30), k1 = near(x, s);
      const sc = (0.45 + rng() * 1.1) * (0.4 + 0.6 * k1);
      putS(pick(rng, lava), x, s, sc, sc * (0.4 + 0.3 * rng()), tintOf(rng, [[0.4, 0.38, 0.38], [0.33, 0.31, 0.31], [0.46, 0.42, 0.4]], 0.08), 0.6);
    }
    for (let k = 0, n = Math.round((ctx.tier === 'low' ? 2 : 3) * bk); k < n; k++) { // rubble: a patch of small broken rock
      if (Y.over()) { yield; Y.reset(); }
      const s0 = ctx.s0 + 4 + rng() * (CHUNK - 8), x0 = pc.x(s0) + side() * (4.5 + rng() * 22);
      for (let j = 0, m = 5 + Math.floor(rng() * 6); j < m; j++) {
        if (Y.over()) { yield; Y.reset(); }
        const a = rng() * TAU, r = Math.sqrt(rng()) * 1.8, sc = 0.1 + rng() * 0.18;
        putS(pick(rng, lava), x0 + Math.cos(a) * r, s0 + Math.sin(a) * r, sc, sc * (0.5 + 0.4 * rng()), tintOf(rng, [[0.5, 0.47, 0.44], [0.62, 0.58, 0.52], [0.4, 0.38, 0.37]], 0.1), 0.9);
      }
    }
    for (let k = 0, n = heads.length ? Math.round((ctx.tier === 'low' ? 4 : 7) * bk) : 0; k < n; k++) { // coral heads
      if (Y.over()) { yield; Y.reset(); }
      const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + side() * (4.5 + Math.pow(rng(), 0.7) * 28), k1 = near(x, s), sc = (0.45 + rng() * 0.8) * (0.5 + 0.5 * k1);
      putS(pick(rng, pick(rng, heads)), x, s, sc, sc * (0.75 + 0.3 * rng()), tintOf(rng, CORAL_HI, 0.1), 0.3);
    }
  }
  return { batches: [st, lv] };
}
