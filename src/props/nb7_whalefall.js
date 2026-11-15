// Whale fall: one very large rorqual carcass per segment on a dark muddy slope, lit only by the camera's lamps
// (biomes.whaleFallOf places it beside the route on the outside of a bend). Two stages, per segment:
//  0 fresh (the mobile-scavenger stage; always the first one after a zone jump): the whole whale lying on its side,
//    dark mottled skin with pale sloughed patches, the throat pleats and the mouth line, a flipper raised, the flukes
//    twisted half onto the mud; torn open along the upper flank toward the route (a pale rim of blubber around red
//    muscle, the rib cage arching over the dark cavity, the spine at its back), bite marks scattered over the body.
//    Hundreds of hagfish writhe on the open flank and the mud beside it (one instanced mesh, animated in its vertex
//    shader: a few triangles each), amphipod swarms hang at the wounds, scraps of flesh and blubber lie around it.
//  2 old skeleton (the sulfophilic stage): skull, jaws, the vertebral chain and collapsed ribs on black sediment,
//    white and yellow bacterial mats on the bones and the mud, red fringes of bone-eating Osedax worms.
// The depiction is a composite (a ~21 m rorqual); on-screen text describes the real California sites (see
// docs/SOURCES.md), never this carcass. The carcass template is generated per segment through the rock_gen providers
// (<= 2 ms slices ahead of the camera; a layout that finds none builds it itself in slices).
import * as THREE from 'three';
import { Builder, Batch, TAU, CHUNK, vn3, sat, sstep, lerp, rotY, pointsClear, placedPoints, presence, budgetK, releaseAfterUpload } from './core.js';
import { MAT } from './materials.js';
import { applyWater } from '../water.js';
import { whaleFallOf } from '../biomes.js';
import { pathCache, clearBox, SOFT, seat, put, segFor, lowK, slice, nbFloor, decalDisc, builderMesh, NBMAT, lab, setBase, upTo, mix3 } from './nb_common.js';
import { poolOf } from './nb2_common.js';
import { gridG, paintG, blobG, drain } from './rock_recipes.js';
import { pick, chunkRng, segSeed, planktonMeshG, IBatch, iput } from './nb4_common.js';
import { mulberry32 } from '../noise.js';

// the two variants (biomes.isWhaleFall): sunlit 'whalefall' and the deep, lamp-lit 'whalefalldeep'
const KEYS = ['whalefall', 'whalefalldeep'];
const presenceWF = (ctx) => Math.max(presence(ctx, KEYS[0]), presence(ctx, KEYS[1]));
const H = {};

// ---------------------------------------------------------------- on-screen text (sourced: docs/SOURCES.md)
export const WF = {
  carcass: ['Whale fall', 'At a gray whale sunk off California, an estimated 400-800 hagfish were feeding 1.5 months later.'],
  carcass2: ['Whale fall', 'The seabed under a sunken whale gets organic carbon equal to about 2,000 years of the normal supply.'],
  flank: ['Whale carcass', 'Off California, scavengers remove whale soft tissue at roughly 40 to 60 kg per day.'],
  scraps: ['Scraps of whale', 'At one whale fall off California, 90% of the soft tissue had been removed after 18 months.'],
  ribs: ['Whale bones', 'Fresh bones of large whales can be more than 60% lipid (fat) by weight.'],
  skeleton: ['Whale skeleton', 'One whale skeleton off California still hosted a sulfide-fed community an estimated 50 years after it sank.'],
  osedax: ['Bone-eating worms (Osedax)', 'Osedax worms have no mouth or stomach; bacteria in their roots break down oil in whale bone.'],
  osedax2: ['Bone-eating worms (Osedax)', 'The name Osedax means "bone devourer".'],
  mats: ['Bacterial mats', 'Sediment by old whale bones turns black with metal sulfides; white and yellow bacterial mats grow on the bones.'],
  brittle: ['Brittle star', null],
  // sunlit variant (Hawaii; sources: docs/SOURCES.md): about the documented events, never this carcass
  sunCarcass: ['Whale carcass', 'In Hawaii in 2024, at least nine oceanic whitetips and five tiger sharks fed on one carcass over 8.5 hours.'],
  sunTail: ['Whale carcass', 'At False Bay, white sharks generally started on a whale\'s tail stock and fluke, then moved along the body.'],
  sunBite: ['Whale carcass', 'At False Bay, white sharks cut whale flesh with side-to-side head shakes; a bout typically lasted 15 to 20 seconds.'],
};

// ---------------------------------------------------------------- resolution per tier
// du: ring spacing along the body (m); nu: vertices around it; hag: hagfish in the writhing mass; ost: Osedax tufts
const RES = {
  low: { du: 0.34, nu: 48, rib: 6, vd: 1, hag: 380, ost: 50, nv: 30 }, medium: { du: 0.27, nu: 60, rib: 7, vd: 2, hag: 480, ost: 90, nv: 40 },
  high: { du: 0.2, nu: 76, rib: 8, vd: 2, hag: 650, ost: 140, nv: 52 }, ultra: { du: 0.17, nu: 88, rib: 9, vd: 2, hag: 800, ost: 180, nv: 60 },
};
const resOf = (tier) => RES[tier] || RES.high;

// ---------------------------------------------------------------- colours (linear)
// (linear: the back near-black slate, the belly cream-white (countershaded: half the body is pale and catches the
// lamps), peeling patches grey-pink; blubber cream, muscle red to maroon, bone ivory)
const SKIN = [0.018, 0.022, 0.03], SKIN2 = [0.045, 0.05, 0.062], BELLY = [0.38, 0.355, 0.3], SLOUGH = [0.3, 0.25, 0.23];
const BLUB = [0.78, 0.68, 0.52], BLUB2 = [0.8, 0.58, 0.48], MUSC = [0.42, 0.06, 0.05], MAROON = [0.17, 0.022, 0.028], DEEP = [0.06, 0.012, 0.016];
const BONE = [0.82, 0.76, 0.6], MAT_W = [0.88, 0.88, 0.82], MAT_Y = [0.85, 0.7, 0.28], OSE = [0.75, 0.06, 0.05];
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
// 0.1 m into it; flukes, flippers, fallen ribs and the hagfish beside it rest on the level mud
const MUD = 0.26;

// One carcass, all from its segment's seed: pose, proportions, how far it has been eaten and where, what is missing.
// cam: the carcass a dive starts at (page load, zone jump): always fresh, partly eaten, the sharks at it.
function carcassPlan(seed, W) {
  const rng = mulberry32(seed), r = (a, b) => a + (b - a) * rng(), L = W.L, cam = W.cam;
  const Pl = { L, rng, seed, sd: (seed % 99991) + 7, Rr: 0.065 * L, W: [], sc: L / 21 };
  Pl.gk = r(0.9, 1.1); Pl.bloat = rng() < 0.4 ? r(0.05, 0.16) : 0;
  // skin: how much has peeled off (pale grey-pink), and its cast (blue-grey .. brownish)
  Pl.slough = cam ? r(0.05, 0.35) : r(0.05, 0.6); Pl.tint = [r(0.85, 1.25), r(0.9, 1.05), r(0.75, 1.1)];
  const u = rng();
  // (the first carcass of a dive shows its pale belly to the camera: belly up or turned toward the route)
  Pl.rho0 = (cam ? (u < 0.55 ? HP : 0.35) : u < 0.36 ? HP : u < 0.58 ? 0 : u < 0.78 ? Math.PI : -HP) + r(-0.3, 0.3);
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
  // vertebrae, the far flank); always at least one laid down to bone
  const parts = ['belly', 'back', 'head', 'tail', 'far'], n2 = 1 + Math.floor(rng() * (1.5 + 2 * E));
  let bone = false;
  for (let k = 0; k < n2; k++) {
    const pt = parts[Math.floor(rng() * parts.length)], rho = (t) => Pl.rho0 + Pl.twist * (t - 0.5);
    if (pt === 'belly') { const t = r(0.28, 0.46); add(t, rho(t) + r(-0.4, 0.4), r(1, 2), r(0.6, 1), r(0.3, 0.42)); }
    else if (pt === 'back') { const t = r(0.22, 0.55); add(t, rho(t) + Math.PI + r(-0.3, 0.3), r(1.5, 3), r(0.6, 1), 0.58, 1); bone = true; }
    else if (pt === 'head') { add(r(0.88, 0.95), r(0.1, 1.8), r(0.7, 1.3), r(0.5, 0.9), 0.5, 1); bone = true; }
    else if (pt === 'tail') { add(r(0.04, 0.11), r(-0.2, 2.2), r(0.6, 1.1), r(0.4, 0.7), 0.6, 1); bone = true; }
    else { const t = r(0.3, 0.7); add(t, r(2.3, 3.3), r(1, 2.5), r(0.7, 1.3), r(0.35, 0.5)); }
  }
  if (!W.deep) { // (sharks begin at the tail stock and flukes: the sunlit carcasses are eaten there first)
    add(r(0.03, 0.09), r(0, 2.2), r(1.0, 1.6), r(0.6, 1.0), 0.6, 1); add(r(0.1, 0.2), r(-0.2, 2.4), r(0.9, 1.5), r(0.6, 1.0), r(0.4, 0.55)); bone = true;
    if (!Pl.fluke && rng() < 0.45) Pl.fluke = { side: rng() < 0.5 ? -1 : 1, k: r(0.3, 0.6) };
  }
  if (!bone) { if (rng() < 0.5) add(r(0.04, 0.1), r(0, 2), r(0.6, 1), 0.5, 0.6, 1); else add(r(0.88, 0.94), r(0.2, 1.6), r(0.7, 1.2), 0.6, 0.5, 1); }
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
const _w3 = [0, 0, 0];

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

// ---------------------------------------------------------------- the fresh carcass (stage 0)
function* freshG(b, Pl, Q, spots) {
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
  const C = [0, 0, 0];
  yield* paintG(b, v0, (i, x, y, z, nx, ny, nz, o) => {
    const q = (i - v0) * 8, D = Dv[q], M = Dv[q + 1], mouth = Dv[q + 2], pl = Dv[q + 3], B = Dv[q + 4], ven = Dv[q + 5], t = Dv[q + 6], a = Dv[q + 7];
    const n1 = vn3(x * 0.35, y * 0.35, z * 0.35, sd + 11), n2 = vn3(x * 1.4, y * 1.4, z * 1.4, sd + 12);
    set3(C, SKIN); C[0] *= Pl.tint[0]; C[1] *= Pl.tint[1]; C[2] *= Pl.tint[2];
    mixIn(C, SKIN2, sstep(0.1, 0.5, n2) * 0.7);                                 // mottling
    mixIn(C, BELLY, sstep(-0.05, 0.55, ven) * (0.85 + 0.15 * n2));              // countershading: cream belly and throat
    mixIn(C, SLOUGH, sstep(0.55 - 0.6 * Pl.slough, 0.85 - 0.6 * Pl.slough, n1 + 0.25 * n2) * 0.8); // skin peeling off
    mixIn(C, [0.05, 0.045, 0.045], pl * 0.85);                                   // pleat grooves
    mixIn(C, [0.012, 0.01, 0.01], mouth * 0.95);                                 // the jaw line / gape
    const eye = Math.min(Math.hypot((t - 0.805) * Pl.L, (Math.abs(angD(a, 0)) - 1.32) * Pl.Rr), 1);
    mixIn(C, [0.01, 0.01, 0.012], sstep(0.13, 0.08, eye));                      // the small eye
    let wet = 0.25;
    if (M > 0.03) {
      // the cut: a cream band of blubber at the rim (the step down), then red muscle in strands, maroon and near
      // black deeper in; bone where the wound goes down to it
      const bl = sstep(0.04, 0.16, M), st = vn3(x * 0.6, a * 9, 0.4, sd + 13) * 0.6 + vn3(x * 2.5, a * 22, 0.9, sd + 14) * 0.4;
      mixIn(C, n2 > 0 ? BLUB : BLUB2, bl);
      mixIn(C, MUSC, sstep(0.5, 0.62, M) * (0.85 + 0.3 * st));
      mixIn(C, MAROON, sstep(0.62, 0.9, M) * sstep(-0.2, 0.4, st + 0.3 * n1));
      mixIn(C, [0.55, 0.42, 0.36], sstep(0.35, 0.5, st) * sstep(0.55, 0.8, M) * 0.5); // pale strings of connective tissue
      mixIn(C, DEEP, sstep(0.25, 0.48, D) * (1 - B));
      mixIn(C, BONE, B * (0.85 + 0.15 * n1));
      wet = 0.25 + 0.65 * bl - 0.3 * B;
    }
    const ao = 0.5 + 0.5 * sat(y / 0.5);                                         // dark where it meets the mud
    o[0] = C[0] * ao; o[1] = C[1] * ao; o[2] = C[2] * ao; o[3] = wet; o[4] = 0;
    // spots: where scavengers feed (rims of the wounds) and hagfish crowd
    if (M > 0.35 && M < 0.85 && ny > -0.3 && y > 0.3 && ((i - v0) & 1) === 0 && (Math.floor((i - v0) / nu) & 1) === 0) spots.push(x, y, z, nx, ny, nz, M);
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
        (i, x, y, z, nx, ny, nz, o) => { const c = set3([0, 0, 0], BLUB); mixIn(c, MUSC, sstep(0.1, 0.5, vn3(x * 5, y * 5, z * 5, Pl.sd + k)) * 0.5); if (nz * sz > 0.3) mixIn(c, SKIN2, 0.85); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = 0.8; o[4] = 0; });
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
function skinPaint(sd, pale = 0.5) {
  return (i, x, y, z, nx, ny, nz, o) => {
    const n2 = vn3(x * 1.4, y * 1.4, z * 1.4, sd), n1 = vn3(x * 0.4, y * 0.4, z * 0.4, sd + 1), c = set3([0, 0, 0], SKIN);
    mixIn(c, SKIN2, sstep(0.1, 0.5, n2) * 0.7); mixIn(c, BELLY, pale * sat(ny)); mixIn(c, SLOUGH, sstep(0.3, 0.6, n1) * 0.6);
    const ao = 0.55 + 0.45 * sat(y / 0.4);
    o[0] = c[0] * ao; o[1] = c[1] * ao; o[2] = c[2] * ao; o[3] = 0.3; o[4] = 0;
  };
}
// bone: ivory, a little glossy, a faint stain of tissue (stage 2 has its own: bonePaint)
function cleanBone(sd, stain = 0.2) {
  return (i, x, y, z, nx, ny, nz, o) => {
    const c = set3([0, 0, 0], BONE), n = vn3(x * 2.2, y * 2.2, z * 2.2, sd);
    mixIn(c, MUSC, sstep(0.25, 0.7, n) * stain); mixIn(c, [0.95, 0.9, 0.74], sat(ny) * 0.25);
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
    }, skinPaint(sd + 21, 0.4));
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
    yield* bladeG(b, F.st === 1 ? 5 : 9, Math.max(8, Q.rib + 4), (w) => ({ c: at(w * wEnd), cd, ch: 0.013 * L * (1 - 0.6 * (w * wEnd) ** 1.4) + 0.04, nd, th: 0.08 * sc * (1 - 0.65 * w * wEnd) }), skinPaint(sd + 22 + f, 0.65));
    if (F.st === 1) { // the finger bones beyond the flesh
      for (let k = -1.5; k <= 1.5; k++) {
        const pts = [], rr = [];
        for (let q = 0; q <= 4; q++) { const w = 0.45 + 0.5 * q / 4, p = at(w), cw = 0.013 * L * (1 - 0.6 * w ** 1.4) * 0.5 * k / 1.5; pts.push([p[0] + cd[0] * cw, Math.max(MUD + 0.04, p[1] + cd[1] * cw), p[2] + cd[2] * cw]); rr.push(0.035 * sc * (1 - 0.4 * q / 4)); }
        const v1 = b.vc; b.tube(pts, rr, 4, null, { tip: true }); yield* paintG(b, v1, cleanBone(sd + 50 + k));
      }
    }
    if (F.st === 2) { const v1 = yield* blobAx(b, 1, at(1), dir, 0.12, cd, 0.18, nd, 0.1); yield* paintG(b, v1, cleanBone(sd + 60, 0.5)); }
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
      yield* paintG(b, v1, cleanBone(sd + 100 + nRib, 0.15));
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
    yield* paintG(b, v1, cleanBone(sd + 200 + nV, 0.25));
    if (!marks.spine || Math.abs(t - 0.3) < Math.abs(marks.spineT - 0.3)) { marks.spine = c.slice(); marks.spineT = t; }
    nV++;
  }
  if (nV) for (const s of [0.1, 0.4, 0.7]) { // (capsules along the exposed spine, which may lie outside the body chain)
    const c = bodyPt(Pl, s, Math.PI, 0.45, [0, 0, 0]), e = bodyPt(Pl, s + 0.3, Math.PI, 0.45, [0, 0, 0]);
    obs.push([c[0], c[1], c[2], e[0], e[1], e[2], 0.45 * sc]);
  }
  marks.nRib = nRib; marks.nV = nV;
}
// hagfish crowding points: the open wounds (feeding spots) and the mud along the near side of the body
function hagPoints(Pl, spots, rng, n) {
  const L = Pl.L, out = [], A = [0, 0, 0];
  const nS = spots.length / 7;
  for (let k = 0; k < n; k++) {
    if (nS && rng() < 0.7) {
      const q = Math.floor(rng() * nS) * 7;
      out.push(spots[q] + (rng() - 0.5) * 0.3, spots[q + 1], spots[q + 2] + (rng() - 0.5) * 0.3, spots[q + 3], spots[q + 4], spots[q + 5], rng() < 0.4 ? 1 : 0);
    } else { // on the mud beside the near flank: just outside its widest point
      const t = 0.18 + rng() * 0.68;
      let zm = 0;
      for (let a = 0; a < TAU; a += 0.5) zm = Math.max(zm, bodyPt(Pl, t, a, 1, A)[2]);
      out.push((t - 0.5) * L, MUD, zm + 0.15 + rng() * rng() * 1.6, 0, 1, 0, 0);
    }
  }
  return out;
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

// ---------------------------------------------------------------- the old skeleton (stage 2)
function bonePaint(sd, mats) {
  return (i, x, y, z, nx, ny, nz, o) => {
    // old bone: stained grey-brown (oily), paler on top; white and yellow mat patches; red Osedax fuzz in places
    const c = set3([0, 0, 0], [0.2, 0.17, 0.13]), m = vn3(x * 1.7, y * 1.7, z * 1.7, sd), n = vn3(x * 5, y * 5, z * 5, sd + 1);
    mixIn(c, [0.34, 0.3, 0.23], sat(ny) * 0.5 + 0.2 * n);
    const up = sat(ny * 0.8 + 0.4);
    mixIn(c, [0.7, 0.7, 0.65], sstep(0.3, 0.45, m) * up * mats);
    mixIn(c, [0.62, 0.5, 0.2], sstep(0.4, 0.58, vn3(x * 2.3, y * 2.3, z * 2.3, sd + 4)) * up * mats * 0.8);
    mixIn(c, [0.45, 0.04, 0.03], sstep(0.5, 0.62, vn3(x * 4, y * 4, z * 4, sd + 7)) * up * 0.75);
    const ao = 0.6 + 0.4 * sat(0.5 + 0.5 * ny);
    o[0] = c[0] * ao; o[1] = c[1] * ao; o[2] = c[2] * ao; o[3] = 0.2; o[4] = 0;
  };
}
function* skeletonG(b, ob, Pl, Q, obs) {
  const L = Pl.L, sd = Pl.sd, sc = L / 21, rng = mulberry32(sd + 77), ost = [], curl = Pl.curl * 0.8;
  // a baleen-whale skull lying on the mud (head toward +x): a tall, blocky braincase at the back with the eye-socket
  // arches flaring out sideways in front of it, a long, narrow rostrum (upper jaw) arched along its length with a ridge
  // and real thickness, and the two lower jaws: separate, round, strongly bowed bones lying outside it like calipers
  // (a flat plate with a low dome read as a surfboard)
  const xs = 0.22 * L, Lr = 0.26 * L, sq = (u, e) => Math.sign(u) * Math.pow(Math.abs(u), e);
  let v = yield* blobG(b, Q.vd + 1, (ux, uy, uz, o) => { // braincase: a squarish block, highest at the back
    const d = 1 + 0.05 * vn3(ux * 2, uy * 2, uz * 2, sd), qx = sq(ux, 0.55), qy = sq(uy, 0.6), qz = sq(uz, 0.55);
    o[0] = xs + qx * 0.95 * sc * d; o[2] = qz * (1.35 - 0.25 * ux) * sc * d;
    o[1] = Math.max(0.02, 0.55 * sc + qy * (0.55 + 0.25 * Math.max(0, -ux)) * sc * d);
  });
  yield* paintG(b, v, bonePaint(sd + 1, 1));
  for (const s of [1, -1]) { // supraorbital arches: flat wings flaring sideways, sloping down to the eye sockets
    v = yield* blobG(b, 1, (ux, uy, uz, o) => { o[0] = xs + 0.75 * sc + ux * 0.45 * sc; o[1] = Math.max(0.02, 0.6 * sc - Math.abs(uz) * 0.25 * sc + uy * 0.12 * sc); o[2] = s * (1.55 * sc + uz * 0.75 * sc); });
    yield* paintG(b, v, bonePaint(sd + 5 + s, 1));
  }
  v = yield* gridG(b, 12, 16, (u, w, i, j, o) => { // the rostrum: narrow, tapering, arched, with a ridge on top
    const t = w, a = u * TAU, ca = Math.cos(a), sa = Math.sin(a), hw = 0.6 * sc * Math.pow(1 - t, 0.6) + 0.05;
    const th = (0.3 * sc * (1 - 0.65 * t) + 0.04) * (sa > 0 ? 1 + 0.5 * (1 - Math.abs(ca)) : 0.7);
    o[0] = xs + 0.8 * sc + t * Lr; o[2] = ca * hw; o[1] = 0.32 * sc + 0.45 * sc * Math.sin(t * Math.PI * 0.9) * (1 - t * 0.2) + sa * th;
  });
  { const P = b.P; for (let i = v; i < b.vc; i++) if (P[i * 3 + 1] < 0.02) P[i * 3 + 1] = 0.02; }
  yield* paintG(b, v, bonePaint(sd + 2, 1));
  obs.push([xs - 0.6 * sc, 0.6 * sc, 0, xs + Lr * 0.7, 0.45 * sc, 0, 1.2 * sc]);
  for (const s of [1, -1]) {
    const pts = [], rr = [], len = 0.28 * L, rot = (rng() - 0.5) * 0.15;
    for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([xs - 0.4 * sc + t * len, (0.24 - 0.1 * t) * sc, s * (1.3 * sc + 1.6 * sc * Math.sin(t * Math.PI) - t * 1.0 * sc) + rot * t * len]); rr.push((0.24 - 0.11 * t) * sc); }
    v = b.vc; b.tube(pts, rr, Q.rib + 2, null, { cap: true });
    for (let i = v; i < b.vc; i++) b.P[i * 3 + 1] = Math.max(0.02, b.P[i * 3 + 1]);
    yield* paintG(b, v, bonePaint(sd + 3 + s, 0.8));
  }
  yield;
  // the vertebral chain, half sunk, the tail vertebrae smaller; a gap here and there
  const nV = Math.round(Q.nv), xa = xs - 1.5 * sc, xb = -0.48 * L, sp = [];
  for (let k = 0; k < nV; k++) {
    const t = k / (nV - 1), x = lerp(xa, xb, t) + (rng() - 0.5) * 0.08, r = (0.24 - 0.14 * t) * sc, zz = 0.25 * sc * Math.sin(t * 5 + sd) + curl * t * t;
    if (rng() < 0.06) continue;
    const yaw = (rng() - 0.5) * 0.4;
    v = yield* blobG(b, Q.vd, (ux, uy, uz, o) => { const lx = ux * r * 1.1, lz = uz * r; o[0] = x + lx * Math.cos(yaw) - lz * Math.sin(yaw); o[1] = r * 0.55 + uy * r; o[2] = zz + lx * Math.sin(yaw) + lz * Math.cos(yaw); });
    if (t < 0.75) { // transverse processes and the neural spine (the skeleton lies on its side: the spine points -z)
      yield* blobG(b, 1, (ux, uy, uz, o) => { o[0] = x + ux * r * 0.3; o[1] = r * 0.6 + uy * r * 1.6; o[2] = zz + uz * r * 0.35; });
      yield* blobG(b, 1, (ux, uy, uz, o) => { o[0] = x + ux * r * 0.3; o[1] = r * 0.7 + uy * r * 0.35; o[2] = zz - r * 1.5 + uz * r * 1.3; });
    }
    yield* paintG(b, v, bonePaint(sd + 9 + k, 1));
    sp.push([x, r * 0.55, zz]);
    if (k % 3 === 0) ost.push(x, r * 1.4, zz, 0, 1, 0);
  }
  obs.push([xa, 0.3 * sc, 0, xb * 0.5, 0.3 * sc, 0, 0.45 * sc], [xb * 0.5, 0.2 * sc, 0, xb, 0.15 * sc, 0, 0.3 * sc]);
  yield;
  // ribs: most fallen flat toward the route, a few still arching
  for (let k = 0; k < 14; k++) {
    const x = xa - 0.5 * sc - k * 0.95 * sc;
    for (const s of [1, -1]) {
      if (rng() < 0.2) continue;
      const up = s > 0 && rng() < 0.3, len = (2.6 - Math.abs(k - 5) * 0.12) * sc, pts = [], rr = [], a0 = s * (0.25 + rng() * 0.5);
      for (let q = 0; q <= 8; q++) {
        const t = q / 8, rx = x - t * 0.6 * sc + Math.sin(a0) * 0.2, h = up ? Math.sin(t * Math.PI * 0.9) * len * 0.45 : 0.07 * sc;
        pts.push([rx + Math.sin(a0) * t * len * 0.3, h + 0.06 * sc, s * (0.3 * sc + t * len * Math.cos(a0 * 0.4))]); rr.push((0.08 - 0.03 * t) * sc);
      }
      v = b.vc; b.tube(pts, rr.map((q) => q * 1.25), Q.rib, null, { tip: true }); yield* paintG(b, v, bonePaint(sd + 40 + k * 2 + s, 0.9));
      if (up || rng() < 0.4) ost.push(pts[4][0], pts[4][1] + rr[4], pts[4][2], 0, 1, 0);
    }
  }
  yield;
  // Osedax: tufts of small red plumes on pink trunks rooted in the bone (a sway template: they wave)
  const nO = Q.ost;
  for (let k = 0; k < nO && ost.length; k++) {
    const q = Math.floor(rng() * (ost.length / 6)) * 6, bx = ost[q] + (rng() - 0.5) * 0.5 * sc, by = ost[q + 1] - 0.02, bz = ost[q + 2] + (rng() - 0.5) * 0.4 * sc;
    const h = 0.03 + rng() * 0.05;
    ob.tube([[bx, by, bz], [bx + (rng() - 0.5) * 0.02, by + h * 0.5, bz], [bx + (rng() - 0.5) * 0.04, by + h, bz + (rng() - 0.5) * 0.04]], [0.007, 0.006, 0.012], 4,
      (vv, a, x, y, z, o) => { o[3] = lerp(0.85, 0.8, vv); o[4] = lerp(0.45, 0.06, vv); o[5] = lerp(0.42, 0.05, vv); o[6] = vv * 0.015; o[7] = 3; }, { tip: true });
  }
  return sp;
}

// ---------------------------------------------------------------- the carcass template
// mirror a builder's x and / or z (template frame), keeping the triangles front-facing
function mirror(b, mx, mz) {
  for (let i = 0; i < b.P.length; i += 3) { if (mx) { b.P[i] = -b.P[i]; b.N[i] = -b.N[i]; } if (mz) { b.P[i + 2] = -b.P[i + 2]; b.N[i + 2] = -b.N[i + 2]; } }
  if (mx !== mz) for (let i = 0; i < b.I.length; i += 3) { const t = b.I[i + 1]; b.I[i + 1] = b.I[i + 2]; b.I[i + 2] = t; }
}
export function* carcassG(seed, tier, W) {
  const Q = resOf(tier), Pl = carcassPlan(seed, W), b = new Builder(), ob = new Builder(), obs = [], spots = [], marks = {};
  if (W.stage === 0) {
    yield* freshG(b, Pl, Q, spots);
    yield* appendagesG(b, Pl, Q, obs);
    yield* bonesG(b, Pl, Q, obs, marks);
    yield* baleenG(b, Pl);
    yield* flapsG(b, Pl);
    { const w = Pl.W[0], tw = w.x / Pl.L + 0.5; marks.flank = bodyPt(Pl, tw, w.p - rhoAt(Pl, tw), 1.05, [0, 0, 0]); }
    bodyObs(Pl, obs);
  } else yield* skeletonG(b, ob, Pl, Q, obs);
  yield;
  const hag = W.stage === 0 && W.deep ? hagPoints(Pl, spots, mulberry32(seed + 5), Math.round(Q.hag * (0.6 + 0.6 * Pl.rng()))) : null;
  // template frame: +z toward the route (mirrored when the carcass lies on the +x side of the route, see layout);
  // the head toward +x, or toward -x on half of them
  const mx = Pl.flip, mz = W.side > 0;
  if (mx || mz) {
    mirror(b, mx, mz); mirror(ob, mx, mz);
    for (const o of obs) { if (mx) { o[0] = -o[0]; o[3] = -o[3]; } if (mz) { o[2] = -o[2]; o[5] = -o[5]; } }
    for (const A of [spots, hag]) if (A) for (let i = 0; i < A.length; i += 7) { if (mx) { A[i] = -A[i]; A[i + 3] = -A[i + 3]; } if (mz) { A[i + 2] = -A[i + 2]; A[i + 5] = -A[i + 5]; } }
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
  t.wfStage = W.stage; t.wfL = W.L; t.wfE = Pl.E; t.wfMarks = marks;
  t.spots = Float32Array.from(spots);
  t.hag = hag ? Float32Array.from(hag) : null;
  t.ose = ob.vc ? ob.build() : null;
  if (t.ose) lab(t.ose, WF.osedax[0], WF.osedax[1]);
  t.label = !W.deep ? WF.sunCarcass[0] : W.stage === 0 ? WF.carcass[0] : WF.skeleton[0];
  t.fact = !W.deep ? WF.sunCarcass[1] : W.stage === 0 ? WF.carcass[1] : WF.skeleton[1];
  t.wfDeep = !!W.deep;
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
// Hagfish: one instanced tube per animal (head at x = 0, tail at x = 1), writhing in the vertex shader (no CPU
// work). aHag = (phase, rate, lying 0 / burrowed 1). Only time and the instance's own coordinates feed the motion.
function hagMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0 });
  return applyWater(m, {
    key: 'nb7-wf-hag', vertexHead: 'attribute vec3 aHag; uniform float uTime;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        {
          float u = transformed.x, ph = aHag.x * 6.2831853, sp = aHag.y;
          float burrow = aHag.z;
          float amp = mix(0.07, 0.11, burrow) * (0.25 + 0.75 * u);
          float w = sin(u * 8.0 - uTime * sp + ph) * amp + sin(uTime * 0.31 * sp + ph * 1.7) * u * u * mix(0.1, 0.2, burrow);
          transformed.z += w;
          transformed.y += (1.0 - burrow) * abs(sin(u * 4.0 - uTime * sp * 0.5 + ph)) * 0.03 * u;
        }`);
    },
  });
}
function hagTemplate(tier) {
  const b = new Builder(), n = tier === 'low' ? 6 : 9, rad = tier === 'low' ? 4 : 5, pts = [], rr = [];
  for (let k = 0; k <= n; k++) { const t = k / n; pts.push([t, 0, 0]); rr.push(0.045 * (t < 0.15 ? 0.75 + t * 1.6 : 1 - 0.55 * (t - 0.15) ** 1.5)); }
  b.tube(pts, rr, rad, (v, a, x, y, z, o) => { const belly = sat(-Math.sin(a)); o[3] = 0.42 + 0.12 * belly; o[4] = 0.28 + 0.1 * belly; o[5] = 0.28 + 0.08 * belly; }, { tip: true, cap: false });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(b.P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(b.N), 3));
  g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(b.C), 3));
  g.setIndex(new THREE.BufferAttribute(Uint16Array.from(b.I), 1));
  return g;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
// the writhing mass for a placed carcass item (chunk-local transform of its template points)
function hagMesh(it, rng) {
  const P = it.tpl.hag;
  if (!P || !P.length) return null;
  const n = P.length / 7, g = H.hagGeo.clone(), ap = new Float32Array(n * 3), R = it.R;
  const m = new THREE.InstancedMesh(g, H.mat.hag, n);
  for (let k = 0; k < n; k++) {
    const q = k * 7, lx = P[q], ly = P[q + 1], lz = P[q + 2];
    const px = R[0] * lx + R[1] * ly + R[2] * lz + it.x, py = R[3] * lx + R[4] * ly + R[5] * lz + it.y, pz = R[6] * lx + R[7] * ly + R[8] * lz + it.z;
    const nx = R[0] * P[q + 3] + R[1] * P[q + 4] + R[2] * P[q + 5], ny = R[3] * P[q + 3] + R[4] * P[q + 4] + R[5] * P[q + 5], nz = R[6] * P[q + 3] + R[7] * P[q + 4] + R[8] * P[q + 5];
    const bur = P[q + 6] > 0.5, len = 0.4 + rng() * 0.2;
    _bz.set(nx, ny, nz).normalize(); // up = the surface normal
    if (bur) { // head buried in the flesh, the body sticking out along the normal, bent over
      _bx.set(nx, ny, nz).normalize().multiplyScalar(0.7).add(_v.set(rng() - 0.5, 0.4, rng() - 0.5)).normalize();
      _by.set(rng() - 0.5, 0, rng() - 0.5).cross(_bx).normalize();
      _bz.crossVectors(_bx, _by).normalize();
      _m4.makeBasis(_bx, _bz, _by.negate());
      _m4.setPosition(px - _bx.x * len * 0.35, py - _bx.y * len * 0.35, pz - _bx.z * len * 0.35);
    } else { // lying on the surface, heading anywhere in its plane
      const a = rng() * TAU;
      _v.set(Math.cos(a), 0, Math.sin(a));
      _bx.copy(_v).addScaledVector(_bz, -_v.dot(_bz)).normalize();
      _by.crossVectors(_bz, _bx);
      _m4.makeBasis(_bx, _bz, _by.negate());
      _m4.setPosition(px + nx * 0.03, py + ny * 0.03, pz + nz * 0.03);
    }
    _s.set(len, len, len); _m4.scale(_s);
    m.setMatrixAt(k, _m4);
    ap[k * 3] = rng(); ap[k * 3 + 1] = 2.2 + rng() * 2.4; ap[k * 3 + 2] = bur ? 1 : 0;
  }
  g.setAttribute('aHag', new THREE.InstancedBufferAttribute(ap, 3));
  m.computeBoundingSphere();
  if (m.boundingSphere) m.boundingSphere.radius += 0.5;
  const gd = g.dispose.bind(g);
  g.dispose = () => { gd(); m.dispose(); };
  releaseAfterUpload(g);
  m.matrixAutoUpdate = false;
  m.userData.lod = 'mid';
  return m;
}

// ---------------------------------------------------------------- small templates
function scrap(seed, kind) { // 0 flesh lump, 1 blubber strip (skin on one face), 2 bone fragment
  const rng = mulberry32(seed), b = new Builder(), sx = kind === 1 ? 0.25 + rng() * 0.25 : 0.1 + rng() * 0.14, sz = kind === 1 ? 0.1 + rng() * 0.08 : sx * (0.6 + rng() * 0.4), sy = kind === 1 ? 0.04 : kind === 2 ? 0.05 : sx * 0.45;
  b.blob(kind === 2 ? 1 : 2, (x, y, z, o) => {
    const d = 1 + 0.45 * vn3(x * 2 + seed, y * 2, z * 2, seed % 997);
    o[0] = x * sx * d; o[1] = Math.max(0, sy * 0.6 + y * sy * d); o[2] = z * sz * d;
    // (dirtied by the mud they lie in: darker than the tissue on the carcass)
    const c = kind === 2 ? set3([0, 0, 0], BONE) : kind === 1 ? (y > 0.3 ? set3([0, 0, 0], SKIN2) : set3([0, 0, 0], BLUB)) : mixIn(set3([0, 0, 0], MUSC), BLUB, sat(vn3(x * 3, y * 3, z * 3, seed % 991) + 0.2) * 0.5);
    const k = kind === 2 ? 0.8 : 0.4;
    o[3] = c[0] * k; o[4] = c[1] * k; o[5] = c[2] * k; o[6] = kind === 2 ? 0.2 : 0.8; o[7] = 0;
  });
  const t = b.build();
  return lab(t, WF.scraps[0], WF.scraps[1]);
}
function brittleStar(seed) {
  const rng = mulberry32(seed), b = new Builder(), col = [0.62, 0.55, 0.48];
  b.blob(1, (x, y, z, o) => { o[0] = x * 0.03; o[1] = 0.012 + y * 0.012; o[2] = z * 0.03; o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; });
  for (let k = 0; k < 5; k++) {
    const a = k * TAU / 5 + rng() * 0.3, pts = [], rr = [];
    for (let q = 0; q <= 5; q++) { const t = q / 5, cu = Math.sin(t * 2.5 + k) * 0.25 * t; pts.push([Math.cos(a + cu) * (0.025 + t * 0.13), 0.008, Math.sin(a + cu) * (0.025 + t * 0.13)]); rr.push(0.006 * (1 - 0.7 * t)); }
    b.tube(pts, rr, 3, (v, aa, x, y, z, o) => { o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; }, { tip: true });
  }
  const t = b.build(); t.solid = false;
  return lab(t, WF.brittle[0], WF.brittle[1]);
}

// ---------------------------------------------------------------- init, providers
export function initWhaleFall(tier) {
  if (H.mat) return H;
  H.mat = { flesh: fleshMaterial(), hag: hagMaterial() };
  H.hagGeo = hagTemplate(tier);
  H.scrap = [0, 1, 2, 3, 4, 5].map((k) => scrap(7301 + k, k % 3 === 2 ? 0 : k % 3));
  H.bone = [0, 1, 2].map((k) => lab(scrap(7311 + k, 2), WF.ribs[0], WF.ribs[1]));
  H.brittle = [0, 1, 2].map((k) => brittleStar(7321 + k));
  return H;
}
// (dev tools: one carcass as a mesh in template space, with its hagfish and Osedax, e.g. for a contact sheet)
export function devCarcass(seed, tier, W) {
  const t = drain(carcassG(seed, tier, W)), m = new THREE.Mesh(t.geometry(), H.mat.flesh);
  const hm = hagMesh({ tpl: t, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1 }, mulberry32(seed));
  if (hm) m.add(hm);
  if (t.ose) m.add(new THREE.Mesh(t.ose.geometry(), MAT.sway));
  m.userData.tpl = t;
  return m;
}
export function whaleFallProviders(provide) {
  for (const k of KEYS) provide(k, 'wfCarcass', 1, (seg, kk, tier) => carcassJob(seg, tier), 0);
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
  constructor(b) { super(H.brittle[0], MAT.static, 1); this.items = b.items; }
  build() { return null; }
}

// ---------------------------------------------------------------- chain A: the carcass, its hagfish, the POI
export function* layoutWfA(ctx) {
  const Y = slice(2);
  if (presenceWF(ctx) <= 0) return null;
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
    if (tpl.ose) sw.add(tpl.ose, it.x, it.y, it.z, R, 1, 1, 1, 1, 1, 1, 1);
    yield;
    const hm = hagMesh(it, rng);
    if (hm) extra.push(hm);
    yield;
    // feeding spots (world): along the open flank, facing the route
    const S = tpl.spots, spots = [];
    for (let i = 0; i < S.length && spots.length < 32 * 6; i += 7 * 2) {
      const p = toChunk(it, S[i], S[i + 1], S[i + 2]), n = toChunkN(it, S[i + 3], S[i + 4], S[i + 5]);
      spots.push(p[0], p[1], ctx.s0 - p[2], n[0], n[1], -n[2]);
    }
    const top = P[1] + (tpl.maxY - tpl.minY) * 0.8, toward = -W.side; // the route side, in x
    const fresh = tpl.wfStage === 0, deep = !!W.deep;
    pois.push({ type: 'whalefall', x: P[0] + toward * 1.2 * W.sa, y: top, s: P[2] - toward * 1.2 * W.ca, r: W.L * 0.5,
      data: { name: tpl.label, fact: tpl.fact, stage: tpl.wfStage, L: W.L, ca: W.ca, sa: W.sa, side: W.side, deep,
        cx: P[0], cy: P[1], cs: P[2], spots, showpiece: true, E: tpl.wfE ?? 0.5, cam: !!W.cam } });
    // labels on the generated shape: the main tear, the bare ribs (or spine), the body's far end
    const mk = tpl.wfMarks || {}, lab1 = toChunk(it, -0.3 * W.L, 1.4, 0);
    if (!deep) {
      if (mk.flank) { const q = toChunk(it, mk.flank[0], mk.flank[1], mk.flank[2]); labels.push([WF.sunBite[0], q[0], q[1] + 0.3, ctx.s0 - q[2], WF.sunBite[1]]); }
      { const q = toChunk(it, -0.42 * W.L, 1.0, 0); labels.push([WF.sunTail[0], q[0], q[1], ctx.s0 - q[2], WF.sunTail[1]]); }
      const bm = mk.ribs || mk.spine;
      if (bm) { const rb = toChunk(it, bm[0], bm[1], bm[2]); labels.push([WF.ribs[0], rb[0], rb[1] + 0.15, ctx.s0 - rb[2], WF.ribs[1]]); }
      // a faint cloud of scraps and oil in the water over the wounds (sunlit specks)
      const clouds = [];
      for (let i = 0; i < S.length && clouds.length < 5; i += 7 * 9) {
        const p = toChunk(it, S[i], S[i + 1], S[i + 2]);
        clouds.push({ x: p[0], y: p[1] + 0.8, s: ctx.s0 - p[2], rx: 1.6, ry: 0.9, rz: 1.6, n: Math.round((ctx.tier === 'low' ? 160 : 320) * (0.6 + rng() * 0.8)), size: 0.018 });
      }
      if (clouds.length) { const pm = yield* planktonMeshG(ctx, clouds, rng); if (pm) { pm.userData.lod = 'near'; extra.push(pm); } }
    } else if (fresh) {
      if (mk.flank) { const q = toChunk(it, mk.flank[0], mk.flank[1], mk.flank[2]); labels.push([WF.flank[0], q[0], q[1] + 0.3, ctx.s0 - q[2], WF.flank[1]]); }
      labels.push([WF.carcass2[0], lab1[0], lab1[1] + 0.6, ctx.s0 - lab1[2], WF.carcass2[1]]);
      const bm = mk.ribs || mk.spine;
      if (bm) { const rb = toChunk(it, bm[0], bm[1], bm[2]); labels.push([WF.ribs[0], rb[0], rb[1] + 0.15, ctx.s0 - rb[2], WF.ribs[1]]); }
      // amphipod swarms hanging at the wounds (specks lit by the lamps)
      const clouds = [];
      for (let i = 0; i < S.length && clouds.length < 4; i += 7 * 11) {
        const p = toChunk(it, S[i], S[i + 1], S[i + 2]);
        clouds.push({ x: p[0], y: p[1] + 0.35, s: ctx.s0 - p[2], rx: 0.9, ry: 0.45, rz: 0.9, n: Math.round((ctx.tier === 'low' ? 350 : 700) * (0.6 + rng() * 0.8)), size: 0.006 });
      }
      if (clouds.length) { const pm = yield* planktonMeshG(ctx, clouds, rng); if (pm) { pm.userData.lod = 'near'; extra.push(pm); } }
    } else {
      labels.push([WF.mats[0], lab1[0], P[1] + 0.6, ctx.s0 - lab1[2], WF.mats[1]]);
      const os = toChunk(it, -0.05 * W.L, 0.5, 0);
      labels.push([WF.osedax2[0], os[0], os[1], ctx.s0 - os[2], WF.osedax2[1]]);
    }
  }
  if (!st.items.length) return null;
  // the carcass is one big item (10-25k vertices): merging it into a batch took 5-10 ms in one stage, so it is drawn
  // as a mesh of its own over the template's arrays; the batch stays for registration (obstacles, labels, audit)
  const one = new OneMesh(st);
  for (const it of st.items) extra.push(itemMesh(it));
  return { batches: [one, sw], extra, labels, pois };
}

// ---------------------------------------------------------------- chain B: scraps and stains around it, the near-empty mud
export function* layoutWfB(ctx) {
  const Y = slice();
  if (presenceWF(ctx) <= 0) return null;
  const KEY = presence(ctx, KEYS[0]) >= presence(ctx, KEYS[1]) ? KEYS[0] : KEYS[1], g0 = segFor(ctx, ctx.s0 + 32, KEY);
  if (!g0) return null;
  const fs = nbFloor(ctx), pc = pathCache(ctx), bk = budgetK(ctx, KEY), lk = lowK(ctx), rng = chunkRng(ctx, 0x7f02);
  const st = new Batch(H.mat.flesh, 30000 * bk); st.lod = 'near';
  const ib = new IBatch(H.brittle[0], MAT.static, 64, 'near');
  const dec = new Builder(), labels = [];
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
    const fresh = W.stage === 0, n = Math.round((fresh ? 34 : 22) * lk);
    // sloppy feeding spreads tissue (fresh) or bone fragments (old) over the mud around the carcass
    for (let k = 0; k < n; k++) {
      if (Y.over()) { yield; Y.reset(); }
      const u = (rng() - 0.5) * (W.L + 4), v = (rng() < 0.6 ? -1 : 1) * (2.6 + Math.pow(rng(), 1.6) * 3.5) + (rng() - 0.5);
      const x = W.x + u * W.ca + v * W.sa * W.side, s = W.s + u * W.sa - v * W.ca * W.side;
      if (s < ctx.s0 || s >= ctx.s1) continue;
      const tpl = fresh && rng() < 0.85 ? pick(rng, H.scrap) : pick(rng, H.bone), sc = 0.7 + rng() * 0.8;
      place(st, tpl, x, s, sc, [1, 1, 1], 0.9);
    }
    yield;
    // the stain: black sulfide patches and (old stage) white and yellow bacterial mats on the mud
    if (!fresh) {
      for (let k = 0; k < 16; k++) {
        const u = (rng() - 0.5) * W.L, v = (rng() - 0.5) * 7, x = W.x + u * W.ca + v * W.sa * W.side, s = W.s + u * W.sa - v * W.ca * W.side;
        if (s < ctx.s0 - 3 || s >= ctx.s1 + 3) continue;
        const c = rng() < 0.65 ? MAT_W : MAT_Y;
        decalDisc(dec, fs, ctx, x, s, 0.5 + rng() * 1.2, 0.4 + rng() * 0.9, rng() * TAU, c, 0, 0.85, 4, 14);
      }
      const lp = W.x - W.side * 3 * W.sa;
      if (W.s >= ctx.s0 && W.s < ctx.s1) labels.push([WF.mats[0], lp, fs.at(lp, W.s) + 0.4, W.s, WF.mats[1]]);
    }
  }
  yield;
  // away from the carcass the mud is nearly bare: a few brittle stars (deep only)
  const nB = KEY === KEYS[1] ? Math.round(6 * bk * lk) : 0;
  for (let k = 0; k < nB; k++) {
    const s = ctx.s0 + rng() * CHUNK, x = pc.x(s) + (rng() - 0.5) * 28;
    fs.at(x, s);
    const R = upTo([fs.nx, fs.ny, fs.nz], rng() * TAU), P = [x, fs.at(x, s), s];
    seat(fs, H.brittle[0], R, 1, 1, 1, P, null, 0.004);
    iput(ctx, ib, P[0], P[1], P[2], R, 1, 1, 1, [0.9 + rng() * 0.2, 0.85, 0.8]);
  }
  const extra = [];
  const dm = dec.vc ? builderMesh(dec, NBMAT.decal, null, 'mid') : null;
  if (dm) { dm.renderOrder = 1; extra.push(dm); }
  return { batches: [st, ib], extra, labels };
}
