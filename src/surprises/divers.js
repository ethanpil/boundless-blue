// Recreational scuba divers (2–4): skinned human figures in wetsuits with BCD, tank, regulator, mask
// and fins; flutter or frog kicks, a breathing rhythm with exhaled bubble bursts that wobble up to the
// surface (or pool under a cave ceiling), torches with light cones at night / in caves / on deep wrecks,
// sometimes an underwater photographer with strobes. One diver turns, faces the camera and waves (or
// makes the big "OK" sign; at night, torch circles). Divers keep personal space from each other, stay
// out of rock, props, ceilings and the surface, keep >= 4 m from the camera, and are registered as
// moving obstacles so fish swim around them.
import * as THREE from 'three';
import { GeoBuilder, loft, hose, box, cyl, sph, torus, T, seg, lin, mixc, mulc, mulS, mixMulS, fbm, surMat, Beam, makeBones, skinned, clamp, sstep, lerp, TAU } from './kit.js';

// Bind pose: standing, facing +Z, +X = the diver's left, hips at the origin. [name, parent, x, y, z]
const BONES = [
  ['hips', -1, 0, 0, 0], ['spine', 0, 0, 0.1, 0], ['chest', 1, 0, 0.3, 0], ['neck', 2, 0, 0.55, -0.01], ['head', 3, 0, 0.64, 0],
  ['shoulderL', 2, 0.19, 0.48, -0.01], ['elbowL', 5, 0.2, 0.19, -0.01], ['wristL', 6, 0.205, -0.06, 0],
  ['shoulderR', 2, -0.19, 0.48, -0.01], ['elbowR', 8, -0.2, 0.19, -0.01], ['wristR', 9, -0.205, -0.06, 0],
  ['thighL', 0, 0.095, -0.1, 0], ['kneeL', 11, 0.095, -0.54, 0], ['ankleL', 12, 0.095, -0.95, -0.01], ['finL', 13, 0.095, -1.3, -0.01],
  ['thighR', 0, -0.095, -0.1, 0], ['kneeR', 15, -0.095, -0.54, 0], ['ankleR', 16, -0.095, -0.95, -0.01], ['finR', 17, -0.095, -1.3, -0.01],
];
const B = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const HEAD_CHAIN = [0, 1, 2, 3, 4], WRIST_R_CHAIN = [0, 1, 2, 8, 9, 10];
const FACT = 'Recreational divers breathe compressed air; every exhale sends up a burst of bubbles that grows as the pressure drops on the way to the surface.';
const PHOTO_FACT = 'Underwater photographers use strobes because water swallows red light within the first few metres.';

const SUIT = [0x15171a, 0x191b1f, 0x1c1d22, 0x23262c];
const ACCENT = [0x1d5aa8, 0xc23a6a, 0x2a8a7a, 0x6b7078, 0xd0602a, 0x7d4bb0, 0x2b2b2b, 0xc9a227];
const SKIN = [0xe2b49a, 0xc8906c, 0x9a6444, 0x5e3b29, 0xf0c6a6, 0xb47a58];
const HAIR = [0x2a1c12, 0x4a2f19, 0x8a6a3a, 0x161616, 0x6a3a22, 0x20160e];
const TANK = [0xb9bdc3, 0xd9c23c, 0xe6e6e0, 0x2d5ea8, 0x262626, 0xb33328, 0x8f969c];
const FIN = [0xf2c018, 0x1e63c6, 0xd23b2a, 0x161616, 0xeeeeee, 0xe85aa0, 0x29b3a0, 0xf07c1a, 0x3a3f46];

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const TUBE = 4.6; // divers keep their whole body this far from the camera path line
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _e = new THREE.Euler();
const _M = new THREE.Matrix4(), _V = new THREE.Vector3(), _ax = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);
const _pt = { x: 0, y: 0, z: 0 }, _push = { x: 0, y: 0, s: 0 };

// ---------- geometry ----------
const _bw = [0, 0, 0];
const bw3 = (a, b, w) => { _bw[0] = a; _bw[1] = b; _bw[2] = w; return _bw; };
function* buildDiver(rng, low, gear, out) {
  const g = new GeoBuilder(true), S = low ? 9 : 13;
  const suit = lin(pick(rng, SUIT)), acc = lin(gear.accent), skin = lin(pick(rng, SKIN)), hair = lin(pick(rng, HAIR));
  const fin = lin(gear.fin), tank = lin(gear.tank), black = lin(0x101113), metal = lin(0xa8adb3), glass = lin(0x0a1620);
  const hooded = gear.hooded, gloves = gear.gloves;
  const k = gear.size;
  yield;
  // a little mottling so the neoprene never looks like flat plastic
  const neo = (c, panel) => (x, y, z) => {
    const n = 0.88 + 0.22 * fbm(x * 9, y * 9, z * 9);
    const p = panel ? panel(x, y, z) : 0;
    return mixMulS(c, acc, p, n);
  };
  const sidePanel = (x, y, z) => (Math.abs(x) > 0.13 * k && y > 0.05 && y < 0.45 ? 0.9 : 0);
  const torsoW = (x, y) => (y < 0.12 ? bw3(0, 1, sstep(-0.04, 0.16, y)) : bw3(1, 2, sstep(0.18, 0.36, y)));
  yield;
  // torso (blended hips / spine / chest)
  const tr = [[-0.17, 0.1, 0.08], [-0.12, 0.155, 0.105], [-0.03, 0.17, 0.115], [0.07, 0.15, 0.104, 0, 0.005], [0.18, 0.155, 0.11, 0, 0.01],
    [0.3, 0.172, 0.12, 0, 0.012], [0.4, 0.184, 0.118, 0, 0.008], [0.47, 0.178, 0.104], [0.52, 0.142, 0.085, 0, -0.005], [0.56, 0.07, 0.06, 0, -0.008]]
    .map((r) => [r[0], r[1] * k, r[2] * k, 0, (r[4] || 0)]);
  g.add(loft(tr, S + 3), null, neo(suit, sidePanel), { bone: torsoW, rough: 0.78 });
  yield;
  // neck and head
  g.add(loft([[0.53, 0.056, 0.056, 0, -0.008], [0.67, 0.05, 0.052, 0, 0]], S), null, hooded ? neo(suit) : skin, { bone: B.neck, rough: 0.7 });
  const face = (x, y, z) => {
    const fr = z > 0.035 && y > 0.655 && y < 0.81 && Math.abs(x) < 0.075;
    if (hooded) return fr ? mulS(skin, 0.95) : mulS(suit, 0.9 + 0.2 * fbm(x * 9, y * 9, z * 9));
    const top = y > 0.765 + 0.03 * (z > 0.04 ? 1 : 0) || (z < -0.02 && y > 0.69);
    return top ? mulS(hair, 0.85 + 0.3 * fbm(x * 30, y * 30, z * 30)) : skin;
  };
  g.add(sph(1, S + 3, S), T(0, 0.75, 0.005, 0, 0, 0, 0.088, 0.113, 0.1), face, { bone: B.head, rough: 0.72 });
  if (!hooded) g.add(sph(1, S, 6, 0), T(0, 0.79, -0.012, 0, 0, 0, 0.094, 0.085, 0.102), hair, { bone: B.head, rough: 0.9 }); // hair volume
  yield;
  // mask: skirt, frame, lens, nose pocket, strap
  const skirt = gear.clearSkirt ? lin(0x9fb2bd) : black, frame = gear.maskFrame;
  g.add(box(0.17, 0.088, 0.03), T(0, 0.775, 0.084), skirt, { bone: B.head, rough: 0.5 });
  g.add(box(0.162, 0.074, 0.03), T(0, 0.776, 0.1), frame, { bone: B.head, rough: 0.45 });
  g.add(box(0.146, 0.058, 0.012), T(0, 0.778, 0.114), glass, { bone: B.head, rough: 0.05 });
  g.add(box(0.036, 0.034, 0.03), T(0, 0.736, 0.1), skirt, { bone: B.head, rough: 0.5 });
  g.add(torus(0.1, 0.008, 4, S + 3), T(0, 0.79, -0.005, Math.PI / 2 - 0.25, 0, 0, 1, 1.12, 1), gear.clearSkirt ? lin(0x5a6a74) : black, { bone: B.head, rough: 0.6 });
  yield;
  // regulator: second stage, purge cover, exhaust tee, mouthpiece; octopus (yellow) on the chest
  g.add(cyl(0.032, 0.034, 0.05, S), T(-0.004, 0.68, 0.118, Math.PI / 2, 0, 0), black, { bone: B.head, rough: 0.4 });
  g.add(cyl(0.026, 0.026, 0.008, S), T(-0.004, 0.68, 0.145, Math.PI / 2, 0, 0), gear.regCol, { bone: B.head, rough: 0.4 });
  g.add(box(0.09, 0.022, 0.03), T(-0.004, 0.652, 0.118), black, { bone: B.head, rough: 0.5 });
  const hoseW = (x, y, z) => bw3(2, 4, sstep(-0.06, 0.07, z)); // chest -> head near the mouth
  g.add(hose([[-0.03, 0.68, 0.11], [-0.09, 0.67, 0.07], [-0.14, 0.62, -0.04], [-0.12, 0.66, -0.17], [-0.03, 0.73, -0.25]], 0.011, 14, 5), null, black, { bone: hoseW, rough: 0.5 });
  const yel = lin(0xf2c418);
  g.add(cyl(0.028, 0.03, 0.045, S), T(0.085, 0.4, 0.14, Math.PI / 2, 0, 0.3), yel, { bone: B.chest, rough: 0.45 });
  g.add(hose([[0.085, 0.4, 0.12], [0.16, 0.3, 0.1], [0.19, 0.45, -0.05], [0.05, 0.72, -0.25]], 0.01, 12, 5), null, yel, { bone: B.chest, rough: 0.5 });
  yield;
  // BCD jacket over the torso, pockets in the accent colour, inflator hose on the left shoulder
  const bcdC = (x, y, z) => {
    const pocket = Math.abs(x) > 0.12 * k && y > 0.04 && y < 0.24 && z > -0.02 ? 1 : 0;
    const trim = Math.abs(y - 0.3) < 0.018 || (z > 0.08 && Math.abs(x) < 0.03) ? 1 : 0;
    return mixMulS(gear.bcd, acc, pocket ? 0.8 : trim ? 1 : 0, 0.9 + 0.18 * fbm(x * 12, y * 12, z * 12));
  };
  const bc = [[0.02, 0.165, 0.12, 0, -0.012], [0.12, 0.172, 0.128, 0, -0.012], [0.28, 0.19, 0.138, 0, -0.008], [0.42, 0.198, 0.136, 0, -0.01], [0.49, 0.188, 0.122, 0, -0.012], [0.53, 0.15, 0.1, 0, -0.016]]
    .map((r) => [r[0], r[1] * k, r[2] * k, 0, r[4]]);
  g.add(loft(bc, S + 3, { caps: false }), null, bcdC, { bone: torsoW, rough: 0.7 });
  g.add(hose([[0.12, 0.54, -0.04], [0.16, 0.5, 0.07], [0.15, 0.36, 0.13], [0.13, 0.31, 0.15]], 0.014, 10, 6), null, black, { bone: B.chest, rough: 0.6 });
  g.add(box(0.03, 0.06, 0.035), T(0.13, 0.29, 0.15), acc, { bone: B.chest, rough: 0.5 });
  yield;
  // weight belt with lead blocks and a buckle
  g.add(loft([[-0.055, 0.176 * k, 0.122 * k], [-0.01, 0.174 * k, 0.12 * k]], S + 3, { caps: false }), null, black, { bone: B.hips, rough: 0.8 });
  for (const a of [-1.1, -0.4, 0.4, 1.1]) g.add(box(0.05, 0.05, 0.03), T(Math.sin(a) * 0.17 * k, -0.033, Math.cos(a) * 0.12 * k, 0, a, 0), lin(0x4a4c50), { bone: B.hips, rough: 0.6 });
  g.add(box(0.055, 0.04, 0.014), T(0, -0.032, 0.127 * k), metal, { bone: B.hips, rough: 0.3 });
  yield;
  // console (pressure gauge) on a hose at the left hip
  g.add(hose([[0.06, 0.72, -0.25], [0.2, 0.5, -0.12], [0.2, 0.15, 0.0], [0.17, 0.0, 0.07]], 0.01, 12, 5), null, black, { bone: B.chest, rough: 0.5 });
  g.add(box(0.05, 0.11, 0.03), T(0.17, -0.04, 0.08, 0, 0, 0.2), black, { bone: B.hips, rough: 0.5 });
  g.add(cyl(0.02, 0.02, 0.006, 10), T(0.172, -0.02, 0.097, Math.PI / 2, 0, 0), lin(0xd8e4e8), { bone: B.hips, rough: 0.2, glow: 0.15 });
  yield;
  // tank: body, domed top, boot, cam bands, valve, first stage
  const tz = -0.255 * k, tr2 = gear.tankR;
  const tankC = (x, y, z) => mulS(tank, 0.92 + 0.12 * fbm(x * 6, y * 6, z * 6) - (Math.abs(y - 0.5) < 0.02 ? 0.25 : 0));
  g.add(cyl(tr2, tr2, 0.56, S + 1), T(0, 0.34, tz), tankC, { bone: B.chest, rough: 0.32 });
  g.add(sph(tr2, S + 1, 6), T(0, 0.62, tz, 0, 0, 0, 1, 0.55, 1), tankC, { bone: B.chest, rough: 0.32 });
  g.add(cyl(tr2 + 0.006, tr2 + 0.006, 0.09, S + 1), T(0, 0.08, tz), black, { bone: B.spine, rough: 0.8 });
  for (const y of [0.24, 0.42]) g.add(cyl(tr2 + 0.006, tr2 + 0.006, 0.04, S + 1, true), T(0, y, tz), black, { bone: B.chest, rough: 0.8 });
  g.add(cyl(0.022, 0.024, 0.07, 8), T(0, 0.69, tz), metal, { bone: B.chest, rough: 0.3 });
  g.add(cyl(0.028, 0.028, 0.03, 10), T(0.045, 0.71, tz, 0, 0, Math.PI / 2), black, { bone: B.chest, rough: 0.5 });
  g.add(cyl(0.03, 0.03, 0.09, 10), T(-0.01, 0.735, tz, 0, 0, Math.PI / 2), metal, { bone: B.chest, rough: 0.3 });
  yield;
  // shoulders
  for (const sx of [1, -1]) g.add(sph(0.062 * k, S, 7), T(sx * 0.178 * k, 0.47, -0.01), neo(suit), { bone: sx > 0 ? B.chest : B.chest, rough: 0.78 });
  yield;
  // arms (upper arm, elbow, forearm, hand, dive computer on the left wrist)
  yield;
  for (const sx of [1, -1]) {
    const L = sx > 0, sh = L ? B.shoulderL : B.shoulderR, el = L ? B.elbowL : B.elbowR, wr = L ? B.wristL : B.wristR;
    const x0 = sx * 0.19, xe = sx * 0.2, xw = sx * 0.205;
    g.add(loft([[0, 0.056, 0.058], [-0.1, 0.054, 0.055], [-0.22, 0.046, 0.047], [-0.3, 0.041, 0.042]].map((r) => [r[0], r[1] * k, r[2] * k]), S), T(x0, 0.48, -0.01), neo(suit), { bone: sh, rough: 0.78 });
    g.add(sph(0.043 * k, S, 6), T(xe, 0.19, -0.01), neo(suit), { bone: el, rough: 0.78 });
    yield;
    g.add(loft([[0.01, 0.043, 0.043], [-0.08, 0.045, 0.041], [-0.19, 0.036, 0.032], [-0.25, 0.031, 0.027]].map((r) => [r[0], r[1] * k, r[2] * k]), S), T(xe, 0.19, -0.01), neo(suit), { bone: el, rough: 0.78 });
    const hc = gloves ? black : skin;
    g.add(loft([[0.01, 0.022, 0.034], [-0.05, 0.02, 0.044, 0, 0.004], [-0.1, 0.018, 0.043, 0, 0.008], [-0.17, 0.014, 0.036, 0, 0.022], [-0.19, 0.01, 0.022, 0, 0.026]], S - 2), T(xw, -0.06, 0), hc, { bone: wr, rough: gloves ? 0.8 : 0.6 });
    g.add(loft([[0, 0.012, 0.012], [-0.07, 0.01, 0.01, 0, 0.02]], 6), T(xw - sx * 0.008, -0.08, 0.035, 0.3, 0, 0), hc, { bone: wr, rough: 0.7 });
    if (L) {
      g.add(box(0.018, 0.045, 0.045), T(xw + 0.034, -0.035, 0), black, { bone: wr, rough: 0.5 });
      g.add(box(0.004, 0.034, 0.034), T(xw + 0.044, -0.035, 0), lin(0x7fd4e0), { bone: wr, rough: 0.2, glow: 0.35 });
    }
  }
  yield;
  // legs, booties and fins (blade flexes on its own bone)
  yield;
  for (const sx of [1, -1]) {
    const L = sx > 0, th = L ? B.thighL : B.thighR, kn = L ? B.kneeL : B.kneeR, an = L ? B.ankleL : B.ankleR, fb = L ? B.finL : B.finR;
    const x = sx * 0.095;
    g.add(loft([[0.02, 0.09, 0.092], [-0.12, 0.084, 0.088], [-0.3, 0.068, 0.07], [-0.44, 0.055, 0.056]].map((r) => [r[0], r[1] * k, r[2] * k]), S), T(x, -0.1, 0), neo(suit), { bone: th, rough: 0.78 });
    g.add(sph(0.056 * k, S, 6), T(x, -0.54, 0), neo(suit), { bone: kn, rough: 0.78 });
    yield;
    g.add(loft([[0.01, 0.055, 0.056], [-0.1, 0.056, 0.062, 0, -0.012], [-0.28, 0.044, 0.046], [-0.41, 0.036, 0.038]].map((r) => [r[0], r[1] * k, r[2] * k]), S), T(x, -0.54, 0), neo(suit), { bone: kn, rough: 0.78 });
    // bootie and the fin's foot pocket (pointed foot continues the leg line)
    g.add(loft([[0.01, 0.04, 0.045], [-0.08, 0.043, 0.058, 0, 0.012], [-0.18, 0.04, 0.046, 0, 0.008], [-0.23, 0.026, 0.026]], S - 2), T(x, -0.95, -0.01), black, { bone: an, rough: 0.85 });
    const pocket = mulc(fin, 0.55);
    g.add(loft([[-0.03, 0.05, 0.062, 0, 0.012], [-0.12, 0.054, 0.058, 0, 0.01], [-0.2, 0.05, 0.04, 0, 0.004]], S - 2), T(x, -0.95, -0.01), pocket, { bone: an, rough: 0.7 });
    // blade: flat, widening, thinning toward a rounded or notched tip; rails along both edges
    const fl = gear.finLen, bw = (y) => bw3(an, fb, sstep(-1.12, -1.45, y));
    const bladeC = (bx, by, bz) => { const t = clamp((-0.98 - by) / fl, 0, 1); return mixMulS(fin, gear.finTip, t * t, 0.95 + 0.1 * fbm(bx * 20, by * 20, bz * 20)); };
    const rings = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, w = lerp(0.07, 0.112, Math.sqrt(t)) * (i === 8 ? 0.82 : 1), th2 = lerp(0.013, 0.005, t);
      rings.push([-0.13 - t * fl, w, th2, 0, -0.012 + 0.012 * t, 6]);
    }
    yield;
    g.add(loft(rings, 12, { e: 6 }), T(x, -0.95, -0.01), bladeC, { bone: (bx, by) => bw(by), rough: 0.45 });
    for (const e of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push([x + e * lerp(0.07, 0.11, Math.sqrt(t)), -0.95 - 0.13 - t * (fl - 0.02), -0.022 + 0.012 * t]); }
      g.add(hose(pts, 0.009, 8, 4), null, mulc(fin, 0.7), { bone: (bx, by) => bw(by), rough: 0.5 });
    }
  }
  yield;
  // torch in the right hand (always built: lens glows only when lit)
  yield;
  if (gear.torch) {
    g.add(cyl(0.03, 0.026, 0.2, 10), T(-0.205, -0.2, 0.02), gear.torchCol, { bone: B.wristR, rough: 0.4 });
    g.add(cyl(0.038, 0.032, 0.05, 12), T(-0.205, -0.32, 0.02), gear.torchCol, { bone: B.wristR, rough: 0.4 });
    g.add(cyl(0.032, 0.032, 0.006, 12), T(-0.205, -0.348, 0.02), lin(0xfff2d8), { bone: B.wristR, rough: 0.1, glow: gear.lit ? 3 : 0 });
  }
  yield;
  // underwater camera rig held in front: housing, dome port, two strobe arms and strobes
  yield;
  if (gear.camera) {
    const hx = -0.205 + 0.2, wr = B.wristR, hcol = lin(gear.housing);
    g.add(box(0.3, 0.12, 0.17), T(hx, -0.15, 0.03), hcol, { bone: wr, rough: 0.35 });
    g.add(new THREE.SphereGeometry(0.075, 12, 6, 0, TAU, 0, Math.PI / 2), T(hx, -0.21, 0.03, Math.PI, 0, 0), lin(0x223040), { bone: wr, rough: 0.05 });
    for (const e of [1, -1]) {
      const ax = hx + e * 0.15, bx = hx + e * 0.33;
      g.add(cyl(0.012, 0.012, 1, 6), seg(ax, -0.12, 0.1, bx, -0.17, 0.3, 1), black, { bone: wr, rough: 0.4 });
      g.add(cyl(0.048, 0.045, 0.08, 12), T(bx, -0.2, 0.3), black, { bone: wr, rough: 0.4 });
      g.add(cyl(0.04, 0.04, 0.006, 12), T(bx, -0.243, 0.3), lin(0xf4f6ff), { bone: wr, rough: 0.1, glow: 0.4 });
      g.add(box(0.03, 0.03, 0.14), T(hx + e * 0.17, -0.12, 0.03), black, { bone: wr, rough: 0.6 });
    }
  }
  yield;
  out.geo = g.build();
}

// ---------- the encounter ----------
export class Divers {
  constructor(sys, rng) {
    this.sys = sys; this.rng = rng; this.kind = 'divers';
    this.root = new THREE.Group(); this.root.name = 'surprise-divers';
    this.done = false; this.age = 0;
    this.divers = []; this.sub = []; this.lab = [];
  }

  // Lane on one side of the path with room for a diver at a comfortable height for the whole route. Over
  // a dense reef the coral heads fill the first couple of metres above the sand, so the divers may swim
  // up to 2 m higher (lift) rather than never appearing there.
  _lane(cam, s0, s1, force) {
    const sys = this.sys, sh = sys.shape, rng = this.rng;
    const sides = rng() < 0.5 ? [1, -1] : [-1, 1];
    const lats = [6.5, 8, 9.5, 5.8, 11];
    for (const lift of [0, 1, 2]) {
      let best = null, bestScore = -1;
      for (const side of sides) for (const lat of lats) {
        let ok = 0, n = 0, ySum = 0;
        for (let k = 0; k <= 8; k++) {
          const s = lerp(s0, s1, k / 8), x = sh.pathX(s) + side * lat;
          const f = sys.floor(x, s), c = sys.ceil(x, s), py = sh.pathY(s);
          let y = clamp(Math.max(f + 1.8 + lift, py - 4), f + 1.2, py + 1.5); // over deep water: midwater, near our depth
          y = Math.min(y, c - 1.2);
          n++;
          if (y - f < 1.0 || c - y < 1.0) continue;
          if (sys.obsDist(x, y, s, 3, null) < 1.2) continue;
          ok++; ySum += y;
        }
        const score = ok / n - Math.abs(lat - 7.5) * 0.01;
        if (score > bestScore) { bestScore = score; best = { side, lat, y: ySum / Math.max(1, ok), lift }; }
      }
      if (bestScore >= (force ? 0.5 : 0.8)) return best;
    }
    return null;
  }

  plan(cam, force) {
    const sys = this.sys, rng = this.rng;
    const r = rng(), o = this.opts || {};
    this.mode = o.mode || (r < 0.45 ? 'oncoming' : r < 0.75 ? 'ahead' : 'hover');
    const fog = sys.fogD();
    this.ahead = clamp(fog * 0.7, 32, 62);
    const s0 = cam.s + this.ahead;
    const lane = this.mode === 'oncoming' ? this._lane(cam, cam.s - 5, s0, force)
      : this._lane(cam, s0 - 6, s0 + 30, force);
    if (!lane) return false;
    this.lane = lane;
    const zone = sys.zoneKey(cam.s + 40);
    this.cave = zone === 'cave';
    const night = sys.night() > 0.45;
    const deep = sys.dark(cam.y) > 0.55;
    this.lit = night || this.cave || deep || ((zone === 'wreck' || zone === 'ruins') && rng() < 0.35);
    this.n = 2 + Math.floor(rng() * (sys.low ? 2 : 3));
    this.speed = this.mode === 'hover' ? 0 : 0.3 + rng() * 0.16;
    this.frog = this.cave || rng() < 0.25;
    this.waver = Math.floor(rng() * this.n);
    this.alt = (zone === 'sandflat' || zone === 'seagrass' ? 1.3 : 1.6) + rng() * 0.8 + lane.lift;
    this.midDepth = 1.5 + rng() * 2.5;
    this.photoIdx = rng() < 0.45 ? (this.waver + 1) % this.n : -1;
    return true;
  }

  *build() {
    const sys = this.sys, rng = this.rng, mat = surMat('diver', { rough: 0.75 });
    const pairFin = pick(rng, FIN), pairTank = pick(rng, TANK);
    for (let i = 0; i < this.n; i++) {
      const buddy = i % 2 === 1 && rng() < 0.4; // buddies sometimes match
      const accent = pick(rng, ACCENT);
      const fin = buddy ? pairFin : pick(rng, FIN);
      const gear = {
        accent, fin, finTip: rng() < 0.5 ? lin(fin) : mixc(lin(fin), lin(0xffffff), 0.35), tank: buddy ? pairTank : pick(rng, TANK),
        bcd: rng() < 0.7 ? lin(0x1a1b1e) : mixc(lin(0x1a1b1e), lin(accent), 0.35), hooded: this.cave || rng() < 0.45, gloves: this.cave || rng() < 0.5,
        clearSkirt: rng() < 0.35, maskFrame: rng() < 0.6 ? lin(0x111214) : lin(accent), regCol: rng() < 0.5 ? lin(0x2c2e33) : lin(accent),
        size: 0.94 + rng() * 0.12, tankR: 0.085 + rng() * 0.012, finLen: 0.5 + rng() * 0.16,
        torch: this.lit, lit: this.lit, torchCol: rng() < 0.5 ? lin(0x1b1c1f) : lin(pick(rng, [0xd9b51c, 0x2d6fc0, 0xa8adb3])),
        camera: i === this.photoIdx, housing: pick(rng, [0x9aa0a8, 0x1c1d20, 0x2d3540, 0x7a1f1f]),
      };
      if (gear.camera) gear.torch = false;
      const res = {};
      yield* buildDiver(rng, sys.low, gear, res);
      const geo = res.geo;
      yield;
      const bones = BONES.map((b) => b); // spec
      const bs = makeBones(bones);
      const mesh = skinned(geo, mat, bs, 2.2);
      mesh.matrixAutoUpdate = true;
      const d = {
        mesh, bones: bs, gear, i,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawV: 0, up: 0.15, roll: 0,
        kick: rng() * TAU, breath: rng() * 4, breathP: 3.8 + rng() * 1.6, exhaled: false, puff2: -1,
        look: 0.9, headYaw: 0, headPitch: 0, glanceT: 2 + rng() * 6, glanceYaw: 0,
        wave: null, waved: false, flashT: 3 + rng() * 5,
        off: null, h: {}, regT: 0, arms: gear.camera ? 'photo' : gear.torch ? 'torch' : rng() < 0.55 ? 'clasp' : 'side',
        beam: null, frog: this.frog || rng() < 0.15,
        sid: 'sur:diver:' + i, interest: 1.15,
      };
      if (gear.torch && (!sys.low || i < 2)) {
        const b = new Beam(this.cave ? 9 : 7.5, 0.17, [1, 0.93, 0.8], this.cave ? 0.2 : 0.17, sys.low ? 5 : 8);
        b.mesh.position.set(0, -0.27, 0.02); b.mesh.rotation.x = Math.PI / 2;
        bs[B.wristR].add(b.mesh);
        d.beam = b;
      }
      this.root.add(mesh);
      this.divers.push(d);
      yield;
    }
  }

  start(cam) {
    const sys = this.sys, sh = sys.shape, rng = this.rng, L = this.lane;
    const s0 = cam.s + this.ahead;
    this.dir = this.mode === 'oncoming' ? -1 : 1;
    this.gs = s0; this.gLat = L.side * L.lat;
    // formation: buddy pairs side by side, the second pair a few metres behind (in travel direction)
    for (const d of this.divers) {
      const pair = Math.floor(d.i / 2), inPair = d.i % 2;
      const lat = (inPair ? 1 : -1) * (0.85 + rng() * 0.4) * (this.mode === 'hover' ? 1.6 : 1);
      const back = pair * (3.2 + rng() * 1.2) + inPair * (rng() - 0.3) * 0.8;
      d.off = { lat, back, up: (rng() - 0.5) * 0.6 };
      const s = s0 - this.dir * back, x = sh.pathX(s) + this.gLat + lat * L.side;
      const f = sys.floor(x, s);
      d.x = x; d.y = clamp(L.y + d.off.up, f + 1.3, sys.ceil(x, s) - 1.1); d.z = -s;
      d.yaw = this.dir > 0 ? Math.PI : 0;
      d.hoverYaw = L.side * Math.PI / 2 + (rng() - 0.5) * 1.8; // mostly facing the reef, some across the path
      if (this.mode === 'hover') d.yaw = d.hoverYaw;
      d.up = this.mode === 'hover' ? 0.35 : 0.15;
    }
    // validate: nobody starts inside anything
    for (const d of this.divers) if (sys.clear(d.x, d.y, -d.z, 0.35, 0) < 0) { if (!this._settle(d)) return false; }
    this._pose(0, 0);
    return true;
  }
  _settle(d) {
    for (let k = 0; k < 12; k++) {
      _push.x = _push.y = _push.s = 0;
      const g = this.sys.clear(d.x, d.y, -d.z, 0.35, 0.3, _push);
      if (g >= 0) return true;
      d.x += _push.x * 1.2; d.y += _push.y * 1.2; d.z -= _push.s * 1.2;
    }
    return false;
  }

  update(dt, time, cam) {
    if (dt <= 0) return;
    const sys = this.sys, sh = sys.shape;
    this.age += dt; this.dtNow = dt;
    // group anchor moves along its lane
    this.gs += this.dir * this.speed * dt;
    const fwdX = cam.forward.x, fwdZ = cam.forward.z, fl = Math.hypot(fwdX, fwdZ) || 1;
    let far = true;
    const dark = sys.dark(cam.y);
    for (const d of this.divers) {
      this._steer(d, dt, cam);
      this._animate(d, dt, cam, dark);
      const ds = -d.z - cam.s;
      if (ds > -32 && Math.hypot(d.x - cam.x, d.z - cam.z) < 170) far = false;
    }
    this._separate();
    for (const d of this.divers) { this._constrain(d, cam); this._sane(d); }
    this._pose(dt, time);
    for (const d of this.divers) this._fx(d, dt, cam, dark);
    if (far || this.age > 420) this.done = true;
  }

  // steering toward the formation slot; waving divers hold position and face the camera
  _steer(d, dt, cam) {
    const sys = this.sys, sh = sys.shape, L = this.lane;
    const s = this.gs - this.dir * d.off.back;
    let lat = this.gLat + d.off.lat * L.side;
    if (Math.abs(lat) < TUBE + 0.8) lat = Math.sign(lat || L.side) * (TUBE + 0.8);
    let tx = sh.pathX(s) + lat, tz = -s;
    if (this.mode === 'hover') { // slow drifting around the spot
      tx += Math.sin(this.age * 0.11 + d.i * 2) * 0.8; tz += Math.cos(this.age * 0.09 + d.i) * 0.8;
    }
    const sd = -tz;
    // comfortable height over the seabed (max under the body), below the ceiling / surface
    const f = Math.max(sys.floor(tx, sd), sys.floor(tx, sd + this.dir * 1.2), sys.floor(d.x, -d.z));
    const c = Math.min(sys.ceil(tx, sd), sys.ceil(d.x, -d.z));
    // a comfortable height over the seabed; over deep water (drop-offs, the blue hole) they swim in
    // midwater a few metres below the camera instead of following the seabed down
    const py = sh.pathY(sd);
    let ty = Math.min(Math.max(f + this.alt, py - this.midDepth) + d.off.up, Math.max(f + 1.2, py + 1.6));
    ty = Math.min(Math.max(ty, f + 1.2), c - 1.0);
    const w = d.wave;
    let mx = 0.62, k = 0.6;
    if (w && w.st !== 'back') { tx = d.x; ty = d.y; tz = d.z; mx = 0.15; }
    else if (w && w.st === 'back') { mx = 0.8; }
    const ex = tx - d.x, ey = ty - d.y, ez = tz - d.z;
    let vx = ex * k, vy = ey * k, vz = ez * k;
    // cruise: match the anchor's speed along the lane when close to the slot
    if (!w && this.mode !== 'hover') vz += -this.dir * this.speed * clamp(1 - Math.hypot(ex, ez) / 6, 0.3, 1);
    const sp = Math.hypot(vx, vy, vz);
    if (sp > mx) { vx *= mx / sp; vy *= mx / sp; vz *= mx / sp; }
    const a = Math.min(1, dt * 1.4);
    d.vx += (vx - d.vx) * a; d.vy += (vy - d.vy) * a; d.vz += (vz - d.vz) * a;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
  }

  // personal space between divers: capsule-to-capsule clearance >= 0.4 m
  _separate() {
    const D = this.divers;
    for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) {
      const a = D[i], b = D[j];
      const c = segSeg(a.ax, a.ay, a.az, a.bx, a.by, a.bz, b.ax, b.ay, b.az, b.bx, b.by, b.bz);
      const need = 0.32 + 0.32 + 0.4;
      if (!(c.d < need)) continue; // (NaN-safe)
      let nx = c.dx, ny = c.dy, nz = c.dz;
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-4) { nx = a.x - b.x; ny = 0; nz = a.z - b.z; l = Math.hypot(nx, nz) || 1; if (l < 1e-4) { nx = 1; l = 1; } }
      const p = (need - c.d) * 0.5 / l;
      a.x += nx * p; a.y += ny * p * 0.5; a.z += nz * p;
      b.x -= nx * p; b.y -= ny * p * 0.5; b.z -= nz * p;
      // shift the capsule cache too, so later pairs see the corrected positions
      a.ax += nx * p; a.bx += nx * p; a.az += nz * p; a.bz += nz * p;
      b.ax -= nx * p; b.bx -= nx * p; b.az -= nz * p; b.bz -= nz * p;
    }
  }

  // hard constraints: out of rock / props / ceiling / surface, and >= 4 m (+ body) from the camera
  _constrain(d, cam) {
    const sys = this.sys;
    // body sample points along the capsule (head .. fins)
    for (let it = 0; it < 2; it++) {
      _push.x = _push.y = _push.s = 0;
      let worst = 9;
      for (let k = 0; k < 4; k++) {
        const t = k / 3, x = lerp(d.ax, d.bx, t), y = lerp(d.ay, d.by, t), z = lerp(d.az, d.bz, t);
        const r = k === 1 ? 0.3 : k === 0 ? 0.24 : 0.2;
        worst = Math.min(worst, sys.clear(x, y, -z, r, 0.25, _push));
      }
      if (worst >= 0.25) break;
      const m = Math.hypot(_push.x, _push.y, _push.s);
      if (m < 1e-5) break;
      const k = worst < 0 ? 1 : 0.35;
      const dx = _push.x * k, dy = _push.y * k, dz = -_push.s * k;
      d.x += dx; d.y += dy; d.z += dz; d.ax += dx; d.bx += dx; d.ay += dy; d.by += dy; d.az += dz; d.bz += dz;
      if (worst < 0) { d.vy = Math.max(d.vy, 0); }
    }
    // the flight tube and the camera bubble: divers step sideways out of the camera's way (never along
    // its travel, which would push them ahead of it), and are kept >= 4 m (+ body) from the lens
    const px = this.sys.shape.pathX(-d.z), side = Math.sign(d.x - px) || (d.i % 2 ? 1 : -1);
    const latMin = Math.min(Math.abs(d.ax - px), Math.abs(d.bx - px), Math.abs(d.x - px));
    const ahead = -d.z - cam.s;
    if (latMin < TUBE && ahead > -8 && ahead < 30) { // soft: clear the tube before the camera arrives
      const k = Math.min(TUBE - latMin, 0.9 * this.dtNow);
      d.x += side * k; d.ax += side * k; d.bx += side * k;
    }
    const c = ptSeg(cam.x, cam.y, cam.z, d.ax, d.ay, d.az, d.bx, d.by, d.bz);
    const need = 4.0 + 0.35;
    if (c.d < need) {
      const lat = Math.abs(c.dx) > 1e-6 ? Math.abs(c.dx) : 0, vert = c.dy;
      // smallest sideways (and a little vertical) move that restores the distance
      const want = Math.sqrt(Math.max(0, need * need - vert * vert - c.dz * c.dz));
      const k = Math.max(0, want - lat) + 0.02;
      d.x += side * k; d.ax += side * k; d.bx += side * k;
      if (Math.abs(vert) > 0.5) { const kv = Math.sign(-vert) * Math.min(0.3, need - c.d); d.y += kv; d.ay += kv; d.by += kv; }
    }
  }

  // Numerical safety for very long runs: a diver whose state ever turns non-finite is put back to its
  // last good state (and stopped) instead of poisoning the scene.
  _sane(d) {
    const ok = Number.isFinite(d.x + d.y + d.z + d.vx + d.vy + d.vz + d.yaw + d.up + d.ax + d.ay + d.az + d.bx + d.by + d.bz);
    const g = d.good || (d.good = {});
    if (ok) { g.x = d.x; g.y = d.y; g.z = d.z; g.yaw = d.yaw; g.up = d.up; g.ax = d.ax; g.ay = d.ay; g.az = d.az; g.bx = d.bx; g.by = d.by; g.bz = d.bz; return; }
    if (g.x === undefined) { this.done = true; return; }
    d.x = g.x; d.y = g.y; d.z = g.z; d.yaw = g.yaw; d.up = g.up; d.ax = g.ax; d.ay = g.ay; d.az = g.az; d.bx = g.bx; d.by = g.by; d.bz = g.bz;
    d.vx = d.vy = d.vz = 0; d.yawV = 0;
  }

  // orientation, wave logic and bones
  _animate(d, dt, cam, dark) {
    const sys = this.sys;
    const hs = Math.hypot(d.vx, d.vz), speed = Math.hypot(hs, d.vy);
    const dx = cam.x - d.x, dy = cam.y - d.y, dz = cam.z - d.z, dc = Math.hypot(dx, dy, dz);
    // the wave: when the camera approaches and the diver is in view
    if (d.i === this.waver && !d.waved && !d.wave && dc < 18 && dc > 6) {
      const fl = Math.hypot(cam.forward.x, cam.forward.z) || 1;
      const inView = -(dx * cam.forward.x + dz * cam.forward.z) / (fl * Math.hypot(dx, dz) || 1);
      if (inView > 0.42) { d.wave = { st: 'turn', t: 0, ok: this.rng() < 0.55 }; d.waved = true; }
    }
    let yawT = d.yaw, upT = 0.14, lookT = 0.85;
    const w = d.wave;
    if (w) {
      w.t += dt;
      if (w.st === 'turn' && w.t > 1.3) { w.st = 'wave'; w.t = 0; }
      else if (w.st === 'wave' && w.t > 3.4) { w.st = w.ok ? 'ok' : 'back'; w.t = 0; }
      else if (w.st === 'ok' && w.t > 2.2) { w.st = 'back'; w.t = 0; }
      else if (w.st === 'back' && w.t > 2.5) { d.wave = null; }
      if (d.wave && w.st !== 'back') { yawT = Math.atan2(dx, dz); upT = 0.92; lookT = 0.25; }
      d.interest = d.wave && w.st !== 'back' ? 1.75 : 1.15;
    } else d.interest = 1.15;
    if (!w || w.st === 'back') {
      if (this.mode === 'hover' && hs < 0.25) yawT = d.hoverYaw + 0.5 * Math.sin(this.age * 0.05 + d.i * 2);
      else if (hs > 0.06) yawT = Math.atan2(d.vx, d.vz);
      upT = this.mode === 'hover' ? 0.38 : clamp(0.12 + d.vy * 0.8, -0.2, 0.5);
      lookT = this.mode === 'hover' ? 0.6 : 0.85;
    }
    // shortest-way yaw spring
    let dy2 = yawT - d.yaw; dy2 -= Math.round(dy2 / TAU) * TAU;
    d.yawV += (dy2 * 2.2 - d.yawV * 2.4) * dt;
    d.yaw += d.yawV * dt;
    d.up += (upT - d.up) * Math.min(1, dt * 1.2);
    d.look += (lookT - d.look) * Math.min(1, dt * 1.5);
    d.roll = clamp(-d.yawV * 0.35, -0.35, 0.35);
    // glances: the head turns now and then (often toward the camera when it is near)
    d.glanceT -= dt;
    if (d.glanceT <= 0) {
      d.glanceT = 2.5 + this.rng() * 5;
      d.glanceYaw = dc < 14 && this.rng() < 0.6 ? 1e9 : (this.rng() - 0.5) * 1.2;
    }
    let hy = d.glanceYaw;
    if (hy > 1e8) { let a = Math.atan2(dx, dz) - d.yaw; a -= Math.round(a / TAU) * TAU; hy = clamp(a, -0.9, 0.9); }
    if (w && w.st !== 'back') hy = 0;
    d.headYaw += (hy - d.headYaw) * Math.min(1, dt * 2);
    // kicks: rate follows speed (flutter ~0.7 Hz cruising), slow sculling when hovering
    const rate = (d.frog ? 0.32 : 0.5) + speed * (d.frog ? 0.6 : 1.1) + (w ? 0.15 : 0);
    d.kick += dt * rate * TAU;
    d.amp = clamp(0.2 + speed * 0.7, 0.18, 0.55) * (w && w.st !== 'back' ? 0.45 : 1);
    // body capsule (head .. fin tips) in GLOBAL coords for constraints, separation and obstacles
    this._quat(d, _q1);
    _ax.set(0, 1, 0).applyQuaternion(_q1);
    d.qx = _ax.x; d.qy = _ax.y; d.qz = _ax.z;
    d.ax = d.x + _ax.x * 0.82; d.ay = d.y + _ax.y * 0.82; d.az = d.z + _ax.z * 0.82;
    d.bx = d.x - _ax.x * 1.5; d.by = d.y - _ax.y * 1.5; d.bz = d.z - _ax.z * 1.5;
  }
  _quat(d, out) {
    // yaw (world Y) * tilt (X: head forward) * roll (about the body's long axis)
    _q2.setFromAxisAngle(_Y, d.yaw);
    _q3.setFromAxisAngle(_X, Math.PI / 2 - d.up);
    out.multiplyQuaternions(_q2, _q3);
    _q3.setFromAxisAngle(_Y, d.roll);
    out.multiply(_q3);
    return out;
  }

  _pose(dt, time) {
    for (const d of this.divers) {
      const m = d.mesh, b = d.bones;
      m.position.set(d.x, d.y, d.z);
      this._quat(d, m.quaternion);
      const ph = d.kick, A = d.amp ?? 0.3, w = d.wave;
      const set = (i, x, y, z) => setRot(b, i, x, y, z);
      // spine arches a little to look ahead; small roll with each kick
      set(B.spine, -0.06 * d.look, 0.03 * Math.sin(ph), 0);
      set(B.chest, -0.08 * d.look, 0.02 * Math.sin(ph), 0);
      set(B.neck, -0.32 * d.look, d.headYaw * 0.4, 0);
      set(B.head, -0.42 * d.look + 0.05 * Math.sin(time * 0.7 + d.i), d.headYaw * 0.6, 0);
      // legs
      if (d.frog && !(w && w.st !== 'back')) {
        const p = (ph / TAU) % 1;
        const bend = p < 0.38 ? sstep(0, 0.38, p) : p < 0.56 ? 1 - sstep(0.38, 0.56, p) : 0;
        for (let sx = 1; sx >= -1; sx -= 2) {
          const L = sx > 0;
          set(L ? B.thighL : B.thighR, -0.25 * bend, 0, sx * (0.12 + 0.4 * bend));
          set(L ? B.kneeL : B.kneeR, 0.15 + 1.55 * bend, 0, 0);
          set(L ? B.ankleL : B.ankleR, -0.3 * bend, sx * 0.9 * bend, 0);
          set(L ? B.finL : B.finR, 0.15 * Math.sin(ph * 2), 0, 0);
        }
      } else {
        for (let sx = 1; sx >= -1; sx -= 2) {
          const L = sx > 0, p = ph + (L ? 0 : Math.PI);
          set(L ? B.thighL : B.thighR, -(0.06 + A * 0.55 * Math.sin(p)), 0, sx * 0.05);
          set(L ? B.kneeL : B.kneeR, 0.12 + A * 0.5 * Math.max(0, Math.sin(p - 1.1)) + A * 0.15, 0, 0);
          set(L ? B.ankleL : B.ankleR, 0.22 * A * Math.sin(p - 1.8), 0, 0);
          set(L ? B.finL : B.finR, 0.55 * A * Math.sin(p - 2.4), 0, 0);
        }
      }
      // arms
      const lit = d.gear.torch;
      const wt = w ? w.t : 0;
      let pose = d.arms;
      for (let sx = 1; sx >= -1; sx -= 2) {
        const L = sx > 0, sh = L ? B.shoulderL : B.shoulderR, el = L ? B.elbowL : B.elbowR, wr = L ? B.wristL : B.wristR;
        let a = pose;
        if (w && w.st !== 'back' && !L) a = w.st === 'turn' ? 'raise' : w.st === 'wave' ? (lit ? 'circle' : 'wave') : 'ok';
        if (w && w.st !== 'back' && L) a = 'side';
        if (a === 'clasp') { set(sh, -0.62, 0, -sx * 0.3); set(el, -1.7, 0, 0); set(wr, 0, 0, sx * 0.2); }
        else if (a === 'side') { set(sh, 0.12, 0, sx * 0.14); set(el, -0.25, 0, 0); set(wr, 0, 0, 0); }
        else if (a === 'photo') { set(sh, -2.25, 0, -sx * 0.28); set(el, -0.55, 0, 0); set(wr, 0.15, 0, 0); }
        else if (a === 'torch') {
          if (L) { set(sh, -0.95, 0, -sx * 0.32); set(el, -1.55, 0, 0); set(wr, 0, 0, 0); }
          else { set(sh, -2.0 + 0.12 * Math.sin(time * 0.4 + d.i), 0.1 * Math.sin(time * 0.31 + d.i * 3), -sx * 0.12); set(el, -0.4, 0, 0); set(wr, 0.1, 0, 0); }
        } else if (a === 'raise') { const t = sstep(0, 1.3, wt); set(sh, -0.3 * t, 0, sx * 2.35 * t); set(el, -0.4 * t, 0, sx * 0.3 * t); set(wr, 0, 0, 0); }
        else if (a === 'wave') { const o = Math.sin(wt * 9.5); set(sh, -0.35, 0, sx * 2.4); set(el, -0.35, 0, sx * (0.35 + 0.45 * o)); set(wr, 0, 0, sx * 0.3 * Math.sin(wt * 9.5 + 0.6)); }
        else if (a === 'circle') { const c = wt * 5.5; set(sh, -1.8 + 0.2 * Math.cos(c), 0, sx * 0.22 * Math.sin(c)); set(el, -0.15, 0, 0); set(wr, 0, 0, 0); }
        else if (a === 'ok') { const t = sstep(0, 0.6, wt); set(sh, -0.2, 0, sx * lerp(2.4, 2.65, t)); set(el, 0, 0, sx * lerp(0.35, 2.05, t)); set(wr, 0, 0, sx * 0.35 * t); }
      }
      for (let i = 0; i < b.length; i++) b[i].updateMatrix();
      m.updateMatrix();
    }
  }

  // breathing bubbles, torch flares and beams, strobe flashes; obstacle registration
  _fx(d, dt, cam, dark) {
    const sys = this.sys, fx = sys.fx;
    d.breath += dt;
    const p = d.breath % d.breathP;
    const ex = p > d.breathP * 0.58;
    if (ex && !d.exhaled) { // exhale: a big burst from both exhaust ports, a smaller one just after
      d.exhaled = true; d.puff2 = 0.35 + this.rng() * 0.2;
      this._bubbles(d, 14 + Math.floor(this.rng() * 10), 2 + Math.floor(this.rng() * 2));
    } else if (!ex) d.exhaled = false;
    if (d.puff2 > 0) { d.puff2 -= dt; if (d.puff2 <= 0) this._bubbles(d, 6 + Math.floor(this.rng() * 6), 1); }
    // torch: lens flare and beam strength follow how dark the water is
    if (d.gear.torch) {
      bonePoint(d.mesh, d.bones, WRIST_R_CHAIN, 0, -0.29, 0.02, _pt);
      const k = 0.12 + 0.88 * dark * dark;
      fx.flare(_pt.x, _pt.y, _pt.z, 0.22, 1, 0.9, 0.75, 0.25 + 0.75 * k);
      if (d.beam) { d.beam.set(k); d.beam.update(sys.shape, sys.env.camera, cam.Oz); }
    }
    // the photographer fires the strobes now and then
    if (d.gear.camera) {
      d.flashT -= dt;
      if (d.flashT <= 0 && (!d.wave)) {
        d.flashT = 4 + this.rng() * 6;
        for (let e = 1; e >= -1; e -= 2) { bonePoint(d.mesh, d.bones, WRIST_R_CHAIN, 0.2 + e * 0.33, -0.18, 0.3, _pt); fx.flash(_pt.x, _pt.y, _pt.z, 1.1, 1, 0.98, 0.94, 0.14); }
      }
    }
    // moving obstacle for the creatures (refresh a few times a second)
    d.regT -= dt;
    if (d.regT <= 0) {
      d.regT = 0.25;
      sys.reg(d.h, d.ax, d.ay, -d.az, d.bx, d.by, -d.bz, 0.38);
    }
  }
  _bubbles(d, n, caps) {
    const sys = this.sys;
    // exhaust tee on the regulator, both sides of the mouth
    for (let e = 1; e >= -1; e -= 2) {
      bonePoint(d.mesh, d.bones, HEAD_CHAIN, e * 0.05, 0.012, 0.12, _pt);
      const kill = sys.ceil(_pt.x, -_pt.z) - 0.05;
      if (_pt.y >= kill) continue;
      sys.fx.burst(_pt.x, _pt.y, _pt.z, n >> 1, 0.06, kill, e > 0 ? caps : Math.max(0, caps - 1), d.vx, d.vz);
    }
  }

  subjects(out) {
    for (const d of this.divers) {
      const e = this.sub[d.i] || (this.sub[d.i] = { id: d.sid, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1.1, interest: 1.15 });
      e.x = d.x + d.qx * 0.2; e.y = d.y + d.qy * 0.2 + 0.1; e.z = d.z + d.qz * 0.2; e.vx = d.vx; e.vy = d.vy; e.vz = d.vz; e.interest = d.interest;
      out.push(e);
    }
  }
  labels(out) {
    let x = 0, y = 0, z = 0;
    for (const d of this.divers) { x += d.x; y += d.y; z += d.z; }
    const n = this.divers.length || 1;
    const a = this.lab[0] || (this.lab[0] = { name: 'Scuba divers', x: 0, y: 0, z: 0, fact: FACT });
    a.x = x / n; a.y = y / n + 0.9; a.z = z / n;
    out.push(a);
    if (this.photoIdx >= 0 && this.divers[this.photoIdx]) {
      const d = this.divers[this.photoIdx];
      const b = this.lab[1] || (this.lab[1] = { name: 'Underwater photographer', x: 0, y: 0, z: 0, fact: PHOTO_FACT });
      b.x = d.x; b.y = d.y + 0.6; b.z = d.z;
      out.push(b);
    }
  }
  dispose() {
    for (const d of this.divers) { this.sys.unreg(d.h); if (d.beam) d.beam.dispose(); }
    this.divers.length = 0;
  }
}

function setRot(b, i, x, y, z) { _e.set(x, y, z, 'XYZ'); b[i].quaternion.setFromEuler(_e); }

// GLOBAL position of a point given relative to a bone's bind position (point_abs - bone_abs), through
// the mesh transform and the chain of bone matrices (no dependency on the world group's matrices).
function bonePoint(mesh, bones, chain, lx, ly, lz, out) {
  _M.copy(mesh.matrix);
  for (let i = 0; i < chain.length; i++) _M.multiply(bones[chain[i]].matrix);
  _V.set(lx, ly, lz).applyMatrix4(_M);
  out.x = _V.x; out.y = _V.y; out.z = _V.z;
  return out;
}

// closest distance between a point and a segment; (dx, dy, dz) = point - closest
const _ps = { d: 0, dx: 0, dy: 0, dz: 0 };
function ptSeg(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, l2 = ux * ux + uy * uy + uz * uz;
  let t = l2 > 0 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _ps.dx = px - (ax + ux * t); _ps.dy = py - (ay + uy * t); _ps.dz = pz - (az + uz * t);
  _ps.d = Math.hypot(_ps.dx, _ps.dy, _ps.dz);
  return _ps;
}
// closest distance between two segments; (dx, dy, dz) = from the second toward the first
const _ss = { d: 0, dx: 0, dy: 0, dz: 0 };
function segSeg(ax, ay, az, bx, by, bz, cx, cy, cz, ex, ey, ez) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = ex - cx, vy = ey - cy, vz = ez - cz;
  const wx = ax - cx, wy = ay - cy, wz = az - cz;
  const a = ux * ux + uy * uy + uz * uz, b = ux * vx + uy * vy + uz * vz, c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz, e = vx * wx + vy * wy + vz * wz;
  const D = a * c - b * b;
  let s = D > 1e-8 ? clamp((b * e - c * d) / D, 0, 1) : 0;
  let t = c > 1e-8 ? (b * s + e) / c : 0;
  if (t < 0) { t = 0; s = a > 1e-8 ? clamp(-d / a, 0, 1) : 0; } else if (t > 1) { t = 1; s = a > 1e-8 ? clamp((b - d) / a, 0, 1) : 0; }
  _ss.dx = wx + ux * s - vx * t; _ss.dy = wy + uy * s - vy * t; _ss.dz = wz + uz * s - vz * t;
  _ss.d = Math.hypot(_ss.dx, _ss.dy, _ss.dz);
  return _ss;
}
