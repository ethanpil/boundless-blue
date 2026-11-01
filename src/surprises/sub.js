// A research submarine passing at a safe distance (about once an hour). Three kinds, each randomised:
//  - deep: a three-person deep submersible (titanium personnel sphere with glowing viewports under a
//    syntactic-foam fairing, sail with a strobe, ducted thrusters, science basket, two manipulator arms
//    — one of which may wave — skids and floodlights);
//  - sphere: an acrylic-sphere submersible (passengers visible inside, pontoons, thrusters, light bars);
//  - tourist: a 20 m tourist submarine with a row of lit portholes and passenger silhouettes.
// It slowly passes 9–30 m from the camera path with light cones, a pool of lamp light on the seabed and
// bubbles from its vents, steering around the terrain and props.
import * as THREE from 'three';
import { GeoBuilder, loft, box, cyl, sph, torus, T, seg, lin, mulc, mulS, fbm, surMat, makeBones, skinned, clamp, sstep, lerp, TAU } from './kit.js';
import { Vehicle, thruster, lamp, manipulator, armBones, resolveBones, paint, setBone } from './parts.js';

const NAMES = {
  deep: ['DSV Halcyon', 'DSV Mira', 'DSV Kestrel', 'DSV Wren-7', 'DSV Peregrine Deep'],
  sphere: ['Glassfish', 'Seaglass One', 'Pelagia', 'Lumen II'],
  tourist: ['Coral Lantern', 'Reef Ranger IV', 'Blue Sparrow', 'Sea Marigold'],
};
const FACTS = {
  deep: 'a three-person deep submersible: the crew sit inside a titanium sphere about 2 m across, built to resist hundreds of atmospheres.',
  sphere: 'its clear acrylic hull is about 10 cm thick and gives the passengers an all-round view of the reef.',
  tourist: 'tourist submarines carry around 40 passengers past reefs and wrecks, usually at 20–40 m.',
};
const LABEL = { deep: 'Research submersible', sphere: 'Acrylic-sphere submersible', tourist: 'Tourist submarine' };
const TOURIST_ZONES = ['reef', 'softcoral', 'wreck', 'ruins', 'sandflat', 'bluehole', 'wall', 'kelp'];
const SPHERE_ZONES = ['reef', 'softcoral', 'wreck', 'ruins', 'sandflat', 'bluehole', 'wall', 'kelp', 'seamount', 'pelagic', 'sargassum', 'polar'];
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

// ---------- the deep submersible ----------
const ARM = [1.05, 0.9, 0.08]; // manipulator: upper arm, forearm, radius (m)
function deepSpec() {
  const spec = [['root', -1, 0, 0, 0], ['propM', 0, 0, 0.55, -3.78], ['propL', 0, 1.25, 0.45, -2.95], ['propR', 0, -1.25, 0.45, -2.95],
    ['propVL', 0, 0.95, 1.5, -0.9], ['propVR', 0, -0.95, 1.5, -0.9]];
  for (const b of armBones('aL', [0.62, -0.78, 2.9], ARM[0], ARM[1], ARM[2])) spec.push(b);
  for (const b of armBones('aR', [-0.62, -0.78, 2.9], ARM[0], ARM[1], ARM[2])) spec.push(b);
  return resolveBones(spec);
}
function* buildDeep(g, rng, low, out) {
  const band = lin(pick(rng, [0xd8462a, 0xf0b81c, 0x2a5fb0, 0xff5a1f, 0x1f8a70])), white = lin(0xe9ebe6), dark = lin(0x2b2e33);
  const ti = lin(0x8b9097), black = lin(0x141518), glass = lin(0xffc27a), steel = lin(0x9aa1a8), yel = lin(0xf2c31b);
  const S = low ? 18 : 28;
  const hullC = (x, y, z) => {
    const c = y > 0.55 ? white : y > 0.18 ? band : dark;
    const seam = Math.abs(((z + 10) % 1.3) - 0.65) < 0.012 ? 0.75 : 1;
    return mulS(c, seam * (0.9 + 0.12 * fbm(x * 1.7, y * 1.7, z * 1.7)) - 0.06 * Math.max(0, fbm(x * 8, y * 0.5, z * 8) - 0.5));
  };
  const rings = [[-3.55, 0.3, 0.3, 0, 0.62], [-3.25, 0.68, 0.6, 0, 0.64], [-2.6, 1.05, 0.86, 0, 0.68], [-1.5, 1.18, 0.95, 0, 0.72], [0.5, 1.2, 0.95, 0, 0.72],
    [1.6, 1.15, 0.9, 0, 0.72], [2.3, 1.0, 0.76, 0, 0.78], [2.8, 0.7, 0.52, 0, 0.88], [3.05, 0.3, 0.25, 0, 0.96]].map((r) => [...r, 3]);
  g.add(loft(rings.slice(0, 5), S, { axis: 'z', e: 3 }), null, hullC, { rough: 0.45 }); // stern half
  yield;
  g.add(loft(rings.slice(4), S, { axis: 'z', e: 3 }), null, hullC, { rough: 0.45 });     // bow half
  yield;
  // titanium personnel sphere and its viewports (lit from inside)
  g.add(sph(1.0, S, Math.round(S * 0.6)), T(0, -0.25, 2.35), paint(ti, 0.1, 0.05), { rough: 0.35 });
  const ports = [[0, -0.42, 3.31, 0, -0.28, 1], [0.6, -0.72, 3.0, 0.55, -0.45, 0.7], [-0.6, -0.72, 3.0, -0.55, -0.45, 0.7]];
  for (const [x, y, z, nx, ny, nz] of ports) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny, nz).normalize());
    const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    g.add(cyl(0.17, 0.19, 0.12, 16), M, black, { rough: 0.4 });
    g.add(cyl(0.115, 0.115, 0.13, 16), M, glass, { rough: 0.05, glow: 1.8 });
  }
  yield;
  // frame, battery pods, skids
  for (const sx of [1, -1]) {
    g.add(cyl(0.3, 0.3, 3.6, 14), T(sx * 0.82, -0.52, -0.6, Math.PI / 2, 0, 0), paint(dark, 0.15), { rough: 0.55 });
    g.add(sph(0.3, 14, 8), T(sx * 0.82, -0.52, 1.2), paint(dark, 0.15), { rough: 0.55 });
    g.add(sph(0.3, 14, 8), T(sx * 0.82, -0.52, -2.4), paint(dark, 0.15), { rough: 0.55 });
    g.add(cyl(0.05, 0.05, 4.6, 8), T(sx * 0.75, -1.15, -0.2, Math.PI / 2, 0, 0), steel, { rough: 0.4 });
    g.add(cyl(0.05, 0.05, 1, 8), seg(sx * 0.75, -1.15, 2.1, sx * 0.75, -0.95, 2.45, 1), steel, { rough: 0.4 });
    for (const z of [-2.2, -0.8, 0.6, 1.8]) g.add(cyl(0.04, 0.04, 1, 6), seg(sx * 0.78, -0.8, z, sx * 0.75, -1.15, z, 1), steel, { rough: 0.4 });
    g.add(cyl(0.06, 0.06, 4.8, 8), T(sx * 0.98, -0.2, -0.4, Math.PI / 2, 0, 0), black, { rough: 0.5 });
  }
  yield;
  // science basket with sample containers and push cores
  const bz0 = 2.95, bz1 = 3.75, by0 = -1.08, by1 = -0.76, bx = 0.82;
  for (const [ax, ay, az, cx, cy, cz] of [[-bx, by0, bz0, bx, by0, bz0], [-bx, by0, bz1, bx, by0, bz1], [-bx, by1, bz1, bx, by1, bz1], [-bx, by0, bz0, -bx, by0, bz1], [bx, by0, bz0, bx, by0, bz1],
    [-bx, by1, bz0, -bx, by1, bz1], [bx, by1, bz0, bx, by1, bz1], [-bx, by0, bz1, -bx, by1, bz1], [bx, by0, bz1, bx, by1, bz1]]) {
    g.add(cyl(0.025, 0.025, 1, 6), seg(ax, ay, az, cx, cy, cz, 1), steel, { rough: 0.4 });
  }
  g.add(box(bx * 2, 0.03, bz1 - bz0), T(0, by0, (bz0 + bz1) / 2), mulc(steel, 0.6), { rough: 0.6 });
  for (let i = 0; i < 5; i++) {
    const r = 0.06 + rng() * 0.06, h = 0.12 + rng() * 0.18, c = lin(pick(rng, [0xf2f2ee, 0x2d68c4, 0xe8c21c, 0x30a070, 0xd04a2a]));
    g.add(cyl(r, r, h, 12), T(-0.6 + i * 0.3, by0 + h / 2 + 0.015, bz0 + 0.2 + rng() * 0.45), c, { rough: 0.4 });
  }
  for (let i = 0; i < 4; i++) g.add(cyl(0.035, 0.035, 0.55, 8), T(-0.3 + i * 0.2, by0 + 0.12, bz1 - 0.08, 0.15, 0, 0), lin(0xc8d4d8), { rough: 0.15 });
  yield;
  // sail with strobe, antennas and lifting point
  const sail = [[-0.75, 0.05, 0.28, 0, 1.92], [-0.45, 0.15, 0.42, 0, 2.0], [0.55, 0.16, 0.44, 0, 2.0], [0.95, 0.07, 0.34, 0, 1.95]].map((r) => [...r, 4]);
  g.add(loft(sail, 16, { axis: 'z', e: 4 }), null, (x, y, z) => mulS(y > 2.25 ? band : white, 0.95 + 0.08 * fbm(x * 3, y * 3, z * 3)), { rough: 0.45 });
  g.add(sph(0.06, 10, 6), T(0, 2.48, 0.25), lin(0xffffff), { rough: 0.1, glow: 104 });
  g.add(cyl(0.012, 0.012, 0.75, 5), T(0.06, 2.75, -0.2), black, { rough: 0.5 });
  g.add(cyl(0.01, 0.01, 0.5, 5), T(-0.07, 2.6, -0.4), black, { rough: 0.5 });
  g.add(torus(0.16, 0.035, 6, 12), T(0, 1.72, -1.7), steel, { rough: 0.4 });
  yield;
  // thrusters (ducted, props spin on their bones)
  const duct = paint(lin(0x34373c), 0.15), prop = lin(pick(rng, [0xe6b81e, 0x1c1c1c, 0xc84a24]));
  thruster(g, 1, [0, 0.55, -3.78], [0, 0, 1], 0.42, duct, prop, 4, low);
  thruster(g, 2, [1.25, 0.45, -2.95], [0, 0, 1], 0.22, duct, prop, 3, low);
  thruster(g, 3, [-1.25, 0.45, -2.95], [0, 0, 1], 0.22, duct, prop, 3, low);
  thruster(g, 4, [0.95, 1.5, -0.9], [0, 1, 0], 0.25, duct, prop, 3, low);
  thruster(g, 5, [-0.95, 1.5, -0.9], [0, 1, 0], 0.25, duct, prop, 3, low);
  for (const sx of [1, -1]) g.add(cyl(0.035, 0.035, 1, 6), seg(sx * 0.9, 0.5, -2.95, sx * 1.25, 0.45, -2.95, 1), duct, { rough: 0.5 });
  yield;
  // floodlights: a bar over the bow and two on booms
  const housing = lin(0x2a2c30);
  g.add(box(1.4, 0.07, 0.12), T(0, 1.25, 2.45), housing, { rough: 0.5 });
  const lamps = [];
  lamps.push(lamp(g, [0.45, 1.25, 2.58], [0.12, -0.35, 1], 0.09, housing));
  lamps.push(lamp(g, [-0.45, 1.25, 2.58], [-0.12, -0.35, 1], 0.09, housing));
  for (const sx of [1, -1]) {
    g.add(cyl(0.035, 0.035, 1, 6), seg(sx * 1.05, 0.3, 1.9, sx * 1.32, 0.2, 2.25, 1), housing, { rough: 0.5 });
    lamps.push(lamp(g, [sx * 1.32, 0.2, 2.3], [sx * 0.3, -0.55, 1], 0.1, housing));
  }
  lamps.push(lamp(g, [0, -0.72, 3.78], [0, -0.75, 1], 0.06, housing));
  yield;
  // manipulator arms
  const armMetal = lin(pick(rng, [0x9aa0a6, 0x2a2b2e, 0xb8a17a])), accent = lin(0xd8661e);
  manipulator(g, 6, [0.62, -0.78, 2.9], ARM[0], ARM[1], ARM[2], armMetal, accent, low);
  manipulator(g, 11, [-0.62, -0.78, 2.9], ARM[0], ARM[1], ARM[2], armMetal, accent, low);
  out.lamps = lamps;
  out.vents = [[0.42, 1.62, -1.9], [-0.42, 1.62, -1.9]];
  out.len = 7.6; out.rad = 1.35; out.top = 2.6; out.bot = 1.2;
  out.samples = [[0, -0.25, 2.4, 1.05], [0, -0.9, 3.35, 0.8], [0, 0.55, 0.3, 1.3], [0, 0.55, -2.4, 1.05], [0, 0.55, -3.6, 0.55], [0, 2.1, 0.1, 0.55],
    [0, -1.1, 1.7, 0.6], [0, -1.1, -1.9, 0.6], [1.15, 0.4, -0.6, 0.6], [-1.15, 0.4, -0.6, 0.6]];
  out.props = [[1, 0, 0, 1, 1], [2, 0, 0, 1, 1.6], [3, 0, 0, 1, 1.6], [4, 0, 1, 0, 0.6], [5, 0, 1, 0, -0.6]];
  out.arms = [6, 11];
}

// ---------- the acrylic-sphere submersible ----------
function sphereSpec() {
  return [['root', -1, 0, 0, 0], ['p1', 0, 1.45, -0.15, -2.35], ['p2', 0, -1.45, -0.15, -2.35], ['p3', 0, 1.45, 0.38, 0.3], ['p4', 0, -1.45, 0.38, 0.3]];
}
function* buildSphere(g, rng, low, out) {
  const frame = lin(pick(rng, [0xf3f3ef, 0xf2c21b, 0xf06a1d, 0xe9ebe6])), accent = lin(pick(rng, [0xf06a1d, 0x2563b6, 0xd8a81a, 0x1b1b1b]));
  const dark = lin(0x26282c), steel = lin(0x9aa1a8), S = low ? 18 : 26;
  // pontoons
  for (const sx of [1, -1]) {
    const rr = [[-2.2, 0.12], [-2.05, 0.3], [-1.75, 0.42], [1.5, 0.42], [1.85, 0.34], [2.08, 0.16]].map(([z, r]) => [z, r, r, sx * 1.45, -0.15]);
    g.add(loft(rr, S - 6, { axis: 'z' }), null, (x, y, z) => mulS(y > -0.2 ? frame : accent, 0.92 + 0.12 * fbm(x * 2, y * 2, z * 2)), { rough: 0.4 });
    yield;
    g.add(cyl(0.04, 0.04, 3.6, 6), T(sx * 1.2, -0.95, 0, Math.PI / 2, 0, 0), steel, { rough: 0.4 });
    for (const z of [-1.3, 0, 1.3]) g.add(cyl(0.035, 0.035, 1, 6), seg(sx * 1.4, -0.5, z, sx * 1.2, -0.95, z, 1), steel, { rough: 0.4 });
  }
  yield;
  // frame around the sphere, aft machinery trunk, hatch
  g.add(torus(1.08, 0.06, 6, S), T(0, 0.35, 0.25), steel, { rough: 0.35 });
  g.add(box(1.1, 1.0, 1.5), T(0, 0.15, -1.55), paint(frame, 0.12), { rough: 0.45 });
  g.add(box(1.2, 0.18, 1.6), T(0, 0.72, -1.5), paint(accent, 0.1), { rough: 0.45 });
  for (const sx of [1, -1]) {
    g.add(cyl(0.05, 0.05, 1, 6), seg(sx * 1.45, 0.2, 0.9, sx * 0.8, 0.35, 0.95, 1), dark, { rough: 0.5 });
    g.add(cyl(0.05, 0.05, 1, 6), seg(sx * 1.45, 0.2, -1.2, sx * 0.55, 0.3, -1.2, 1), dark, { rough: 0.5 });
    g.add(cyl(0.05, 0.05, 1, 6), seg(sx * 1.45, 0.2, 0.9, sx * 1.45, 0.2, -1.2, 1), dark, { rough: 0.5 });
  }
  g.add(cyl(0.34, 0.38, 0.14, 18), T(0, 1.38, 0.25), dark, { rough: 0.45 });
  g.add(sph(0.06, 10, 6), T(0, 1.5, 0.25), lin(0xffffff), { rough: 0.1, glow: 104 });
  yield;
  // inside the sphere: deck, seats, passengers, warm light strip, control screens
  g.add(cyl(0.88, 0.88, 0.06, 20), T(0, -0.3, 0.25), dark, { rough: 0.7 });
  g.add(torus(0.96, 0.02, 4, 24), T(0, -0.24, 0.25, Math.PI / 2, 0, 0), lin(0xffd9a0), { rough: 0.2, glow: 1.4 });
  const shirts = [0x2d5fb0, 0xd8d8d0, 0xc23a3a, 0x2b2b2b, 0x3a8a5a, 0xe0a020];
  const seats = [[0.45, 0.35], [-0.45, 0.35], [0, -0.25]];
  for (const [sx, sz] of seats) {
    g.add(box(0.42, 0.4, 0.42), T(sx, -0.08, sz + 0.25), dark, { rough: 0.7 });
    if (rng() < 0.85) {
      const skin = lin(pick(rng, [0xe2b49a, 0xc8906c, 0x9a6444, 0x5e3b29, 0xf0c6a6]));
      g.add(box(0.36, 0.46, 0.22), T(sx, 0.32, sz + 0.2), lin(pick(rng, shirts)), { rough: 0.8 });
      g.add(sph(0.1, 12, 8), T(sx, 0.67, sz + 0.24), skin, { rough: 0.6 });
      g.add(sph(0.104, 12, 8, 0), T(sx, 0.7, sz + 0.2, 0, 0, 0, 1, 0.8, 1), lin(pick(rng, [0x2a1c12, 0x5a3a1e, 0x8a6a3a, 0x161616])), { rough: 0.9 });
    }
  }
  g.add(box(0.5, 0.25, 0.04), T(0, 0.05, 1.05, -0.4, 0, 0), lin(0x7fd0ff), { rough: 0.2, glow: 0.8 });
  yield;
  // thrusters
  const duct = paint(lin(0x34373c), 0.15), prop = lin(0x1c1c1c);
  thruster(g, 1, [1.45, -0.15, -2.35], [0, 0, 1], 0.24, duct, prop, 3, low);
  thruster(g, 2, [-1.45, -0.15, -2.35], [0, 0, 1], 0.24, duct, prop, 3, low);
  thruster(g, 3, [1.45, 0.38, 0.3], [0, 1, 0], 0.22, duct, prop, 3, low);
  thruster(g, 4, [-1.45, 0.38, 0.3], [0, 1, 0], 0.22, duct, prop, 3, low);
  // light bars at the pontoon bows
  const housing = lin(0x2a2c30), lamps = [];
  for (const sx of [1, -1]) {
    lamps.push(lamp(g, [sx * 1.45, 0.32, 1.85], [sx * 0.12, -0.3, 1], 0.09, housing));
    lamps.push(lamp(g, [sx * 1.45, -0.55, 1.95], [sx * 0.2, -0.6, 1], 0.08, housing));
  }
  // the acrylic sphere itself is a separate transparent mesh (see build())
  out.glass = { x: 0, y: 0.35, z: 0.25, r: 1.05 };
  out.lamps = lamps;
  out.vents = [[0.3, 0.85, -1.9], [-0.3, 0.85, -1.9]];
  out.len = 4.7; out.rad = 1.75; out.top = 1.6; out.bot = 1.05;
  out.samples = [[0, 0.35, 0.25, 1.12], [1.45, -0.15, 1.3, 0.5], [-1.45, -0.15, 1.3, 0.5], [1.45, -0.15, -1.5, 0.5], [-1.45, -0.15, -1.5, 0.5], [0, 0.2, -1.5, 0.8], [0, -0.95, 0, 0.5]];
  out.props = [[1, 0, 0, 1, 1.4], [2, 0, 0, 1, 1.4], [3, 0, 1, 0, 0.5], [4, 0, 1, 0, -0.5]];
  out.arms = [];
}

// ---------- the tourist submarine ----------
function* buildTourist(g, rng, low, out) {
  const white = lin(0xeef0ec), stripe = lin(pick(rng, [0x1d58b0, 0xf0b81c, 0xc8352a, 0x1f8a70])), anti = lin(pick(rng, [0x5a2a22, 0x2a2e36]));
  const dark = lin(0x1d1f23), steel = lin(0x9aa1a8), warm = lin(0xffc684), S = low ? 20 : 32;
  const R = 1.75;
  const hullC = (x, y, z) => {
    const c = y < -1.0 ? anti : Math.abs(y + 0.05) < 0.5 && Math.abs(y + 0.05) > 0.42 ? stripe : white;
    return mulS(c, (0.9 + 0.12 * fbm(x * 0.8, y * 0.8, z * 0.8)) - 0.07 * Math.max(0, fbm(x * 5, y * 0.4, z * 5) - 0.5) * (y > 0 ? 1 : 0.3));
  };
  const rings = [[-9.7, 0.15], [-9.4, 0.65], [-8.6, 1.25], [-7.4, 1.65], [-6.4, R], [6.4, R], [7.7, 1.62], [8.7, 1.22], [9.35, 0.66], [9.6, 0.2]];
  const rr = rings.map(([z, r]) => [z, r, r]);
  g.add(loft(rr.slice(0, 6), S, { axis: 'z' }), null, hullC, { rough: 0.45 });
  yield;
  g.add(loft(rr.slice(5), S, { axis: 'z' }), null, hullC, { rough: 0.45 });
  yield;
  // portholes with passengers' silhouettes against the warm cabin light
  const n = low ? 9 : 12;
  for (const sx of [1, -1]) for (let i = 0; i < n; i++) {
    const z = -6 + (12 * i) / (n - 1), y = 0.02, x = sx * (R - 0.02);
    const M = T(x, y, z, 0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.add(torus(0.34, 0.05, 5, 16), new THREE.Matrix4().multiplyMatrices(T(x, y, z), T(0, 0, 0, 0, Math.PI / 2, 0)), dark, { rough: 0.4 });
    const who = rng() < 0.75, hz = (rng() - 0.5) * 0.18, hs = 0.075 + rng() * 0.03;
    const pc = (px, py, pz) => {
      if (!who) return warm;
      const dz = pz - z - hz, dy = py - y + 0.04;
      const head = dz * dz + dy * dy < hs * hs, body = dy < -0.13 && Math.abs(dz) < 0.17;
      return head || body ? mulS(warm, 0.08) : warm;
    };
    g.add(cyl(0.3, 0.3, 0.06, 16), M, pc, { rough: 0.05, glow: 1.2 });
  }
  yield;
  // conning tower with windows, hatch and a strobe
  const tw = [[-1.7, 0.2, 0.25, 0, 2.05], [-1.3, 0.62, 0.62, 0, 2.15], [1.6, 0.62, 0.62, 0, 2.15], [2.1, 0.25, 0.35, 0, 2.05]].map((r) => [...r, 3.5]);
  g.add(loft(tw, 20, { axis: 'z', e: 3.5 }), null, paint(white, 0.12), { rough: 0.45 });
  for (let i = 0; i < 3; i++) g.add(box(0.28, 0.2, 0.04), T(-0.32 + i * 0.32, 2.35, 2.06, -0.5, 0, 0), warm, { rough: 0.1, glow: 0.9 });
  g.add(cyl(0.32, 0.36, 0.16, 16), T(0, 2.82, -0.3), dark, { rough: 0.5 });
  g.add(sph(0.07, 10, 6), T(0, 2.95, 0.6), lin(0xffffff), { rough: 0.1, glow: 104 });
  // pilot's bow dome
  g.add(new THREE.SphereGeometry(0.62, 18, 10, 0, TAU, 0, Math.PI / 2), T(0, -0.25, 9.0, Math.PI / 2, 0, 0), lin(0x506070), { rough: 0.05, glow: 0.35 });
  yield;
  // stern: cruciform fins, shrouded main propeller, side thrusters
  g.add(box(0.1, 3.0, 1.5), T(0, 0, -8.7), paint(white, 0.12), { rough: 0.45 });
  g.add(box(3.2, 0.1, 1.3), T(0, 0, -8.6), paint(white, 0.12), { rough: 0.45 });
  const duct = paint(lin(0x34373c), 0.15), prop = lin(0xc9a43a);
  thruster(g, 1, [0, 0, -10.05], [0, 0, 1], 0.75, duct, prop, 5, low);
  for (const sx of [1, -1]) thruster(g, 0, [sx * 1.65, -0.85, -6.8], [0, 0, 1], 0.3, duct, lin(0x1c1c1c), 3, low);
  // skids
  for (const sx of [1, -1]) {
    g.add(cyl(0.07, 0.07, 11, 8), T(sx * 0.95, -2.15, 0, Math.PI / 2, 0, 0), steel, { rough: 0.4 });
    for (const z of [-4.5, -1.5, 1.5, 4.5]) g.add(cyl(0.06, 0.06, 1, 6), seg(sx * 0.9, -1.5, z, sx * 0.95, -2.15, z, 1), steel, { rough: 0.4 });
  }
  yield;
  const housing = lin(0x2a2c30), lamps = [];
  for (const sx of [1, -1]) lamps.push(lamp(g, [sx * 0.95, -0.75, 8.55], [sx * 0.15, -0.3, 1], 0.12, housing));
  for (const sx of [1, -1]) lamps.push(lamp(g, [sx * 0.55, 2.2, 1.95], [sx * 0.25, -0.45, 1], 0.09, housing));
  out.lamps = lamps;
  out.vents = [[0.6, 1.7, -4.5], [-0.6, 1.7, -4.5], [0, 1.75, 4.0]];
  out.len = 20.2; out.rad = 1.9; out.top = 3.0; out.bot = 2.25;
  out.samples = [[0, 0, -8.6, 1.3], [0, 0, -5, 1.85], [0, 0, -1.5, 1.85], [0, 0, 2, 1.85], [0, 0, 5.5, 1.85], [0, -0.1, 8.5, 1.3], [0, 2.3, 0.2, 0.75], [0, -1.95, -3.5, 0.6], [0, -1.95, 3.5, 0.6], [0, 0, -10, 0.8]];
  out.props = [[1, 0, 0, 1, 0.7]];
  out.arms = [];
}

export class Submersible extends Vehicle {
  constructor(sys, rng) { super(sys, rng, 'sub'); this.waveT = 0; this.waved = false; this.ventT = 3; this.frame = 0; }

  plan(cam, force) {
    const sys = this.sys, rng = this.rng, o = this.opts || {};
    const zone = sys.zoneKey(cam.s + 50);
    const day = sys.night() < 0.4;
    let type = o.type;
    if (!type) {
      const r = rng();
      if (day && TOURIST_ZONES.includes(zone) && r < 0.3) type = 'tourist';
      else if (SPHERE_ZONES.includes(zone) && r < 0.6) type = 'sphere';
      else type = 'deep';
    }
    this.type = type;
    const dims = { deep: [7.6, 1.35, 2.6, 1.2], sphere: [4.7, 1.75, 1.6, 1.05], tourist: [20.2, 1.9, 3.0, 2.25] }[type];
    [this.len, this.rad, this.top, this.bot] = dims;
    this.samples = type === 'tourist' ? [[0, 0, -8, 1.9], [0, 0, 0, 1.9], [0, 0, 8, 1.9]] : [[0, 0, 0, this.rad + 0.3]];
    this.camMin = type === 'tourist' ? 10 : 8;
    this.dir = o.dir || (rng() < 0.62 ? -1 : 1);
    this.speed = { deep: 0.45, sphere: 0.55, tourist: 0.75 }[type] * (1 + rng() * 0.4);
    this.alt = this.bot + (type === 'tourist' ? 2.5 : 1.8) + rng() * 2.2;
    const deepZone = ['pelagic', 'abyss', 'sargassum'].includes(zone);
    if (deepZone) this.wantY = (s) => sys.shape.pathY(s) - 1 - this._yOff;
    this._yOff = rng() * 5 - 1.5;
    this.maxBelow = 2 + rng() * 5;
    const fog = sys.fogD();
    this.ahead = clamp(fog * 0.85 + this.len * 0.5, 45, 110);
    const s0 = cam.s + (this.dir < 0 ? this.ahead : clamp(this.ahead * 0.6, 35, 60));
    this.s0 = s0;
    const minLat = this.camMin + this.rad + 1;
    const lats = type === 'tourist' ? [minLat + 2, minLat + 5, minLat + 8] : [minLat + 1, minLat + 3, minLat + 6, minLat + 9];
    const lane = this.dir < 0 ? this.lane(cam.s - 15, s0 + this.len * 0.5, lats, force) : this.lane(s0 - this.len, s0 + 70, lats, force);
    if (!lane) return false;
    this.side = lane.side; this.lat = lane.lat;
    this.vessel = pick(rng, NAMES[type]);
    this.lab.name = LABEL[type]; this.lab.fact = `${this.vessel} — ${FACTS[type]}`;
    this.sub.id = 'sur:sub:' + type; this.sub.r = Math.min(4, this.len * 0.4); this.sub.interest = 1.35;
    return true;
  }

  *build() {
    const sys = this.sys, rng = this.rng, low = sys.low;
    const out = {};
    const spec = this.type === 'deep' ? deepSpec() : this.type === 'sphere' ? sphereSpec() : [['root', -1, 0, 0, 0], ['prop', 0, 0, 0, -10.05]];
    const g = new GeoBuilder(true);
    yield* (this.type === 'deep' ? buildDeep(g, rng, low, out) : this.type === 'sphere' ? buildSphere(g, rng, low, out) : buildTourist(g, rng, low, out));
    yield;
    const geo = g.build();
    yield;
    const bones = makeBones(spec);
    const mesh = skinned(geo, surMat('vehicle', { rough: 0.5 }), bones, this.len * 0.62 + 1);
    this.root.add(mesh);
    this.mesh = mesh; this.bones = bones;
    if (out.glass) {
      const gg = new GeoBuilder(false);
      gg.add(sph(out.glass.r, low ? 24 : 36, low ? 16 : 24), T(out.glass.x, out.glass.y, out.glass.z), lin(0xcfe6f2), { rough: 0.04 });
      const glass = new THREE.Mesh(gg.build(), surMat('acrylic', { rough: 0.04, transparent: true, opacity: 0.16 }));
      glass.renderOrder = 2;
      this.root.add(glass);
    }
    this.lamps = out.lamps; this.vents = out.vents; this.samples = out.samples; this.props = out.props; this.arms = out.arms;
    this.len = out.len; this.rad = out.rad; this.top = out.top; this.bot = out.bot;
    yield;
    this.makeLights(this.type === 'tourist' ? 16 : 14, 0.3, [1, 0.95, 0.86], 0.2, this.type === 'deep' ? 4 : 3, true);
    this._stow();
  }

  _stow() {
    for (const a of this.arms) {
      const b = this.bones;
      setBone(b[a], 0.35, 0, 0); setBone(b[a + 1], -2.55, 0, 0); setBone(b[a + 2], 0, 0, 0);
      setBone(b[a + 3], 0.05, 0, 0); setBone(b[a + 4], -0.05, 0, 0);
    }
  }

  start(cam) {
    const s0 = cam.s + (this.dir < 0 ? this.ahead : clamp(this.ahead * 0.6, 35, 60));
    this.s = s0; this.latO = 0;
    this.place(cam);
    this.speedNow = this.speed;
    // the hull must start clear of everything
    return this.settle(); // the hull must start clear of everything
  }

  update(dt, time, cam) {
    if (dt <= 0) return;
    this.age += dt; this.frame++;
    this.move(dt, cam, this.speed);
    // props spin with the thrust
    const spin = this.speedNow * 9 + 1.5;
    for (const [bi, ax, ay, az, k] of this.props) {
      const b = this.bones[bi];
      b.userData.a = (b.userData.a || 0) + spin * k * dt;
      _ax.set(ax, ay, az); b.quaternion.setFromAxisAngle(_ax, b.userData.a);
    }
    // the pilot gives a little wave with a manipulator as the camera goes by
    if (this.arms.length) this._arms(dt, cam);
    this.lights(dt, cam, this.frame);
    // a little air from the vents now and then
    this.ventT -= dt;
    if (this.ventT <= 0) {
      this.ventT = 4 + this.rng() * 7;
      const big = this.rng() < 0.2;
      for (const v of this.vents) {
        this.toGlobal(v[0], v[1], v[2], _p);
        const kill = this.sys.ceil(_p.x, -_p.z) - 0.05;
        if (_p.y < kill) this.sys.fx.burst(_p.x, _p.y, _p.z, big ? 16 : 6, 0.12, kill, big ? 3 : 1, this.vx, this.vz, big ? 1.3 : 0.9);
      }
    }
    this.register(dt, this.rad + 1.5);
    // gone once well behind the camera or far away
    const behind = (cam.s - this.s) > this.len * 0.5 + 35, far = Math.abs(this.s - cam.s) > 260;
    if (behind || far || this.age > 600) this.done = true;
  }

  _arms(dt, cam) {
    const b = this.bones, a = this.arms[1];
    const d = Math.hypot(this.x - cam.x, this.y - cam.y, this.z - cam.z);
    if (!this.waved && d < 24 && this.waveT === 0) this.waveT = 0.001;
    if (this.waveT > 0) {
      this.waveT += dt;
      const t = this.waveT, up = sstep(0, 2, t) * (1 - sstep(7, 9, t));
      const side = Math.sign(cam.x - this.x) * Math.sign(Math.cos(this.yaw)) || 1;
      setBone(b[a], lerp(0.35, -0.55, up), side * 0.5 * up, 0);
      setBone(b[a + 1], lerp(-2.55, -0.9, up), 0, 0.35 * up * Math.sin(t * 4));
      setBone(b[a + 2], 0, 0, 0.6 * up * Math.sin(t * 4 + 1));
      const open = up * (0.25 + 0.2 * Math.sin(t * 6));
      setBone(b[a + 3], open, 0, 0); setBone(b[a + 4], -open, 0, 0);
      if (t > 9) { this.waveT = 0; this.waved = true; this._stow(); }
    }
  }

  dispose() { this.disposeLights(); }
}
const _p = { x: 0, y: 0, z: 0 }, _ax = new THREE.Vector3();
