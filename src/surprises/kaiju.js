// The kaiju glimpse (every 2–3 hours, deep or open zones): a 60–120 m leviathan slides past far out in
// the murk, mostly a silhouette with faint glowing eyes, then is gone — and a note asks "did you see
// that?". Three randomised forms: a sea serpent with a dorsal frill, a saurian with jagged dorsal plates
// and four flippers, and a vast whale-like thing with rows of eyes and trailing barbels.
// It either crosses the view far ahead (keeping its distance as the camera travels) or passes on a far
// lane beside the path; its whole body stays above the seabed, below the surface and out of solid props,
// it never comes closer than ~38 m, and it is registered as moving obstacles while it is around.
// The body undulates in the vertex shader (one draw call); geometry is built in small steps.
import * as THREE from 'three';
import { applyWater } from '../water.js';
import { GeoBuilder, loft, sph, hose, T, lin, mulS, mixMulS, fbm, clamp, sstep, lerp, TAU } from './kit.js';

const FORMS = ['serpent', 'saurian', 'whale'];
const FACTS = {
  serpent: 'Tales of sea serpents may come from oarfish, which reach 8 m. This was rather longer.',
  saurian: 'Unconfirmed sighting. The sonar operator has asked for shore leave.',
  whale: 'Something vast passed through the deep scattering layer. Blue whales reach 30 m — not this.',
};
const EYES = [0xc8ffb8, 0xa8ecff, 0xffe39a, 0xd8fff0];
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

let _mat = null;
function kaijuMat() {
  if (_mat) return _mat;
  const u = { uPh: { value: 0 }, uAmp: { value: 0.05 }, uK: { value: 1 }, uLen: { value: 80 }, uVert: { value: 0 }, uGlowK: { value: 1 } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  m.userData.u = u;
  applyWater(m, {
    key: 'sur-kaiju',
    uniforms: u,
    vertexHead: `attribute vec2 aSurf; varying vec2 vSurf;
      uniform float uPh, uAmp, uK, uLen, uVert;
      float kWave(float t) { return uAmp * uLen * (0.1 + 0.9 * t * t) * sin(uPh - uK * 6.2831853 * t); }
      float kSlope(float t) { // d(offset)/dt
        float env = 0.1 + 0.9 * t * t, denv = 1.8 * t, a = uPh - uK * 6.2831853 * t;
        return uAmp * uLen * (denv * sin(a) - env * uK * 6.2831853 * cos(a));
      }`,
    fragmentHead: 'varying vec2 vSurf; uniform float uGlowK;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          {
            float t = clamp(0.5 - position.z / uLen, 0.0, 1.0);
            float sl = -kSlope(t) / uLen; // d(offset)/dz (head at +z)
            if (uVert > 0.5) objectNormal.z -= objectNormal.y * sl; else objectNormal.z -= objectNormal.x * sl;
          }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float t = clamp(0.5 - position.z / uLen, 0.0, 1.0);
            float w = kWave(t) - kWave(0.0) * 0.5;
            if (uVert > 0.5) transformed.y += w; else transformed.x += w;
          }`)
        .replace('#include <color_vertex>', '#include <color_vertex>\nvSurf = aSurf;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vColor.rgb * vSurf.x * uGlowK;`);
    },
  });
  _mat = m;
  return m;
}

// ---------- geometry ----------
// Body radius / shape along the spine (t: 0 head .. 1 tail), as fractions of the length.
function profile(form, t) {
  if (form === 'serpent') {
    const head = sstep(0, 0.035, t) * (1 - 0.35 * sstep(0.05, 0.09, t) * (1 - sstep(0.09, 0.16, t)));
    const r = 0.042 * head * (1 - 0.9 * Math.pow(sstep(0.35, 1.0, t), 0.8)) + 0.003;
    return { rx: r * 0.88, ry: r * 1.05, cy: 0 };
  }
  if (form === 'saurian') {
    const snout = sstep(0, 0.07, t), neck = 1 - 0.3 * sstep(0.1, 0.14, t) * (1 - sstep(0.15, 0.24, t));
    const r = 0.068 * snout * neck * (1 - 0.94 * Math.pow(sstep(0.42, 1.0, t), 0.9)) + 0.003;
    return { rx: r * 1.1, ry: r * (t < 0.1 ? 0.62 + 2.5 * t : 0.92), cy: t < 0.1 ? -0.008 * (1 - t / 0.1) : 0 };
  }
  // whale-like: huge blunt head, long tapering body
  const head = 0.55 + 0.45 * sstep(0, 0.06, t);
  const r = 0.085 * head * (1 - 0.95 * Math.pow(sstep(0.3, 1.0, t), 1.3)) * (t < 0.01 ? 0.6 + 40 * t : 1) + 0.003;
  return { rx: r, ry: r * 0.92, cy: -0.01 * sstep(0.2, 0, t) };
}

function* buildKaiju(rng, form, L, low, out) {
  const g = new GeoBuilder(false);
  const base = lin(pick(rng, [0x1c2328, 0x23251f, 0x1a1f2a, 0x2a2420])), belly = lin(pick(rng, [0x4c5258, 0x5a5a4e, 0x464e5e]));
  const eyeC = lin(pick(rng, EYES)), photo = lin(pick(rng, [0x6ff0ff, 0x9dff8a, 0xb8c8ff]));
  const NZ = low ? 64 : 104, NR = low ? 14 : 20;
  const rings = [];
  for (let i = 0; i <= NZ; i++) {
    const t = Math.pow(i / NZ, 1.15), p = profile(form, t), z = (0.5 - t) * L;
    const lump = 1 + 0.06 * (fbm(t * 40, 0.5, 1.3) - 0.5);
    rings.push([z, p.rx * L * lump, p.ry * L * lump, 0, p.cy * L, form === 'saurian' ? 2.4 : 2.1]);
  }
  const skinC = (x, y, z) => {
    const t = 0.5 - z / L, p = profile(form, clamp(t, 0, 1));
    const v = clamp((y / L - p.cy) / Math.max(1e-4, p.ry), -1, 1);
    const scar = fbm(x * 0.4, y * 0.4, z * 0.15);
    return mixMulS(base, belly, sstep(-0.1, -0.75, v), 0.75 + 0.5 * scar);
  };
  // the body in three overlapping spans (each a short build step)
  const third = Math.ceil(NZ / 3);
  for (let k = 0; k < 3; k++) {
    g.add(loft(rings.slice(k * third, Math.min(NZ, (k + 1) * third) + 1), NR, { axis: 'z', caps: k === 0 || k === 2 }), null, skinC, { rough: 0.85 });
    yield;
  }
  const at = (t, ang, lift = 1) => { // point on the skin at spine t, around angle (0 = +x side, pi/2 = top)
    const p = profile(form, t), z = (0.5 - t) * L;
    return [Math.cos(ang) * p.rx * L * lift, p.cy * L + Math.sin(ang) * p.ry * L * lift, z];
  };
  // eyes (the whale-like one has a row of them), with brow ridges
  const eyeT = form === 'serpent' ? 0.028 : form === 'saurian' ? 0.06 : 0.07;
  const eyeR = (form === 'whale' ? 0.006 : 0.0075) * L;
  const nEyes = form === 'whale' ? 3 : 1;
  out.eyes = [];
  for (const sx of [1, -1]) for (let k = 0; k < nEyes; k++) {
    const t = eyeT + k * 0.022, [x, y, z] = at(t, sx > 0 ? 0.42 - k * 0.12 : Math.PI - 0.42 + k * 0.12, 0.93);
    g.add(sph(eyeR * (1 - k * 0.2), 10, 8), T(x, y, z), eyeC, { glow: 22 });
    g.add(sph(eyeR * 1.5, 10, 6), T(x * 1.02, y + eyeR * 0.9, z, 0, 0, 0, 1.2, 0.5, 1.6), base, { rough: 0.9 });
    out.eyes.push([x * 1.04, y, z]);
  }
  yield;
  // jaw line: a dark seam along the side of the head
  for (const sx of [1, -1]) {
    const pts = [];
    for (let k = 0; k <= 6; k++) { const t = 0.004 + k * (form === 'whale' ? 0.03 : 0.018); const p = at(t, sx > 0 ? -0.25 : Math.PI + 0.25, 1.0); pts.push(p); }
    g.add(hose(pts, 0.0028 * L, 12, 4), null, mulS(base, 0.35).slice(), { rough: 0.9 });
  }
  yield;
  // dorsal frill / plates
  const plate = (t, ang, h, w, tilt) => {
    const [x, y, z] = at(t, ang, 0.92);
    const geo = new THREE.ConeGeometry(w, h, 4, 1); geo.scale(0.22, 1, 1);
    g.add(geo, T(x, y + h * 0.45 * Math.sin(ang), z, -0.35, 0, tilt), (px, py, pz) => mulS(base, 0.7 + 0.35 * fbm(px * 0.8, py * 0.8, pz * 0.8)), { rough: 0.8 });
  };
  let np = 0;
  if (form === 'serpent') {
    for (let t = 0.05; t < 0.92; t += 0.012) { const p = profile(form, t); plate(t, Math.PI / 2, p.ry * L * (1.1 + 0.5 * Math.sin(t * 60)), p.rx * L * 0.35, 0); if (++np % 20 === 0) yield; }
  } else if (form === 'saurian') {
    for (let t = 0.1; t < 0.88; t += 0.022) {
      if (++np % 8 === 0) yield;
      const p = profile(form, t), hh = p.ry * L * (0.9 + 0.6 * sstep(0.1, 0.3, t) * (1 - sstep(0.4, 0.9, t)));
      plate(t, Math.PI / 2, hh * 1.2, p.rx * L * 0.45, 0);
      if (t < 0.7) { plate(t + 0.011, Math.PI / 2 - 0.45, hh * 0.75, p.rx * L * 0.3, -0.45); plate(t + 0.011, Math.PI / 2 + 0.45, hh * 0.75, p.rx * L * 0.3, 0.45); }
    }
  } else {
    for (let t = 0.32; t < 0.8; t += 0.04) { const p = profile(form, t); plate(t, Math.PI / 2, p.ry * L * 0.5, p.rx * L * 0.25, 0); }
  }
  yield;
  // flippers: long wing-like pectorals (+ rear pair for the saurian)
  const fin = (t, sx, len, wid, sweep, droop) => {
    const [x, y, z] = at(t, sx > 0 ? -0.2 : Math.PI + 0.2, 0.9);
    const rr = [];
    for (let k = 0; k <= 6; k++) { const u = k / 6; rr.push([u * len, wid * (1 - 0.85 * u) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, u * 1.6))), wid * 0.12 * (1 - 0.7 * u), 0, 0, 5]); }
    const geo = loft(rr, 10, { e: 5 });
    g.add(geo, T(x, y, z, 0, 0, 0).multiply(T(0, 0, 0, 0, sx > 0 ? sweep : -sweep, sx > 0 ? -Math.PI / 2 - droop : Math.PI / 2 + droop)), (px, py, pz) => mulS(base, 0.8 + 0.3 * fbm(px * 0.5, py * 0.5, pz * 0.5)), { rough: 0.85 });
  };
  for (const sx of [1, -1]) {
    if (form === 'serpent') fin(0.1, sx, 0.09 * L, 0.025 * L, 0.9, 0.35);
    else if (form === 'saurian') { fin(0.2, sx, 0.11 * L, 0.035 * L, 0.6, 0.5); fin(0.48, sx, 0.085 * L, 0.03 * L, 0.8, 0.55); }
    else fin(0.2, sx, 0.16 * L, 0.04 * L, 0.7, 0.3);
  }
  yield;
  // tail: a vertical paddle (serpent / saurian) or horizontal flukes (whale-like)
  {
    const [x, y, z] = at(0.985, 0, 0);
    if (form === 'whale') {
      for (const sx of [1, -1]) { const geo = new THREE.ConeGeometry(0.04 * L, 0.12 * L, 4, 1); geo.scale(1, 1, 0.12); g.add(geo, T(x + sx * 0.05 * L, y, z - 0.01 * L, Math.PI / 2, 0, sx * 1.1), mulS(base, 0.8).slice(), { rough: 0.85 }); }
    } else {
      const geo = new THREE.ConeGeometry(0.035 * L, 0.1 * L, 4, 1); geo.scale(0.12, 1, 1);
      g.add(geo, T(x, y + 0.01 * L, z - 0.03 * L, -1.2, 0, 0), mulS(base, 0.8).slice(), { rough: 0.85 });
      const geo2 = new THREE.ConeGeometry(0.03 * L, 0.08 * L, 4, 1); geo2.scale(0.12, 1, 1);
      g.add(geo2, T(x, y - 0.01 * L, z - 0.03 * L, -1.95, 0, 0), mulS(base, 0.8).slice(), { rough: 0.85 });
    }
  }
  yield;
  // trailing barbels under the jaw (whale-like) and rows of faint photophores along the flanks
  if (form === 'whale') {
    for (let k = 0; k < 6; k++) {
      const [x, y, z] = at(0.02 + k * 0.012, -Math.PI / 2 + (k - 2.5) * 0.25, 0.95), len = (0.06 + rng() * 0.05) * L;
      g.add(hose([[x, y, z], [x * 1.1, y - len * 0.35, z - len * 0.35], [x * 1.2, y - len * 0.6, z - len * 0.75], [x * 1.25, y - len * 0.7, z - len]], 0.0018 * L, 10, 4), null, mulS(base, 0.9).slice(), { rough: 0.85 });
    }
  }
  // photophores: irregular rows, larger and denser toward the head
  const nP = low ? 16 : 30;
  for (const sx of [1, -1]) for (let row = 0; row < 2; row++) for (let k = 0; k < nP; k++) {
    if (rng() < 0.3) continue;
    const t = 0.1 + ((k + rng() * 0.8) / nP) * 0.72, ang = -0.4 - row * 0.32 + (rng() - 0.5) * 0.12;
    const [x, y, z] = at(t, sx > 0 ? ang : Math.PI - ang, 1.0);
    g.add(sph((0.0018 + 0.0016 * rng()) * L * (1.2 - t), 6, 4), T(x, y, z), photo, { glow: 1.2 + rng() * 1.6 });
  }
  yield;
  out.geo = g.build();
}

export class Kaiju {
  constructor(sys, rng) {
    this.sys = sys; this.rng = rng; this.kind = 'kaiju';
    this.root = new THREE.Group(); this.root.name = 'surprise-kaiju';
    this.done = false; this.age = 0; this.seen = false; this.noted = false;
    this.h = []; this.regT = 0; this.chk = 0; this.lift = 0; this.liftV = 0;
    this.sub = { id: 'sur:kaiju', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 8, interest: 3 };
    this.lab = { name: 'Leviathan?', x: 0, y: 0, z: 0, fact: '' };
    this.pts = []; // spine sample points (global) for clearance, obstacles, subjects
  }

  plan(cam, force) {
    const sys = this.sys, rng = this.rng, o = this.opts || {};
    this.form = o.form || pick(rng, FORMS);
    this.L = o.len || (this.form === 'saurian' ? 60 + rng() * 30 : this.form === 'serpent' ? 85 + rng() * 35 : 75 + rng() * 35);
    const maxR = { serpent: 0.042, saurian: 0.068, whale: 0.085 }[this.form] * this.L;
    this.R = maxR;
    const open = ['pelagic', 'abyss', 'sargassum'];
    // the crossing travels ahead with the camera: the water must stay open for its whole duration
    const openAhead = [40, 150, 260, 360].every((d) => open.includes(sys.zoneKey(cam.s + d)));
    this.fog = clamp(2.4 / sys.sigmaG(), 60, 120); // how far a silhouette carries through this water
    // closest approach of the skin: far enough to stay half-hidden, close enough to be logged
    this.near = clamp(1.1 / sys.sigmaG(), 34, 42);
    this.depth = 6 + rng() * 10; // below the camera path (when the seabed allows)
    this.speed = 3 + rng() * 1.5;
    this.lab.fact = FACTS[this.form];
    const first = o.route || (openAhead && rng() < 0.65 ? 'cross' : 'pass');
    for (const route of [first, first === 'cross' ? 'pass' : 'cross']) {
      if (route === 'cross' && !openAhead && !o.route) continue;
      this._setup(route, cam);
      if (this._routeOK(cam)) return true; // the whole route has water for the body
      if (o.route) break;
    }
    return false;
  }
  _setup(route, cam) {
    const sys = this.sys, rng = this.rng;
    this.route = route;
    this.side = rng() < 0.5 ? 1 : -1;
    if (route === 'cross') {
      // nearest skin at about `near` when it crosses the view (it passes a little below the camera)
      const dy = this.depth + 3;
      this.D = Math.sqrt(Math.max(0, (this.near + this.R) ** 2 - dy * dy)) + 1;
      this.u0 = -this.side * (this.fog * 0.95 + this.L * 0.5);
    } else {
      // the far lane on the side with more room (deeper seabed)
      let best = -1e9;
      for (const sd of [1, -1]) {
        let m = 1e9;
        for (let k = 0; k <= 8; k++) { const s = cam.s - 40 + k * 25, x = sys.shape.pathX(s) + sd * (this.near + this.R + 2); m = Math.min(m, sys.shape.pathY(s) - sys.floor(x, s)); }
        if (m > best) { best = m; this.side = sd; }
      }
      this.lat = this.near + this.R + 2;
    }
  }
  // Is there room along the planned route? (sampled before anything is built; the crossing also looks
  // ahead to where the travelling camera will have taken it, at up to ~3.5 m/s)
  _routeOK(cam) {
    const dur = this.route === 'cross' ? (2 * Math.abs(this.u0)) / this.speed : 0;
    for (let k = 0; k <= 16; k++) {
      const u = k / 16, p = this._at(this.route === 'cross' ? cam.s + u * dur * 3.5 : cam.s, u, cam);
      if (this._yFor(p.x, p.s, p.yBase) === null) return false;
    }
    return true;
  }
  // Route position for progress u in [0, 1] relative to the camera travel (cs).
  _at(cs, u, cam) {
    const sh = this.sys.shape;
    const ex = this.extra || 0; // distance kept in reserve: grows if the camera gets closer than planned
    if (this.route === 'cross') {
      const s = cs + this.D + ex, x = sh.pathX(s) + lerp(this.u0, -this.u0, u);
      return { x, s, yBase: sh.pathY(s) - this.depth - 3 * Math.sin(Math.PI * u) };
    }
    const s = cs + (this.fog + this.L * 0.6) * (1 - 2 * u), x = sh.pathX(s) + this.side * (this.lat + ex);
    return { x, s, yBase: sh.pathY(s) - this.depth };
  }
  // Height for the body centre: the wanted y, pushed above the seabed, below the surface and over any
  // solid props along the whole body (sampled along its axis: x for the crossing, s for the pass).
  _yFor(x, s, want) {
    const sys = this.sys, L = this.L, ax = this.route === 'cross' ? 1 : 0, as = 1 - ax;
    let lo = -1e9, hi = 1e9;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, off = (0.5 - t) * L, r = this._r(t);
      const xx = x + ax * off, ss = s + as * off;
      lo = Math.max(lo, sys.floor(xx, ss) + r + 4); hi = Math.min(hi, sys.ceil(xx, ss) - r - 3);
    }
    this._lo = lo;
    if (lo > hi) return null;
    let y = clamp(want, lo, hi);
    for (let it = 0; it < 4; it++) { // rise over props in the way
      let need = 0;
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, off = (0.5 - t) * L, r = this._r(t) + L * 0.03 + 1;
        const d = sys.obsDist(x + ax * off, y, s + as * off, r + 4, null);
        if (d < r) need = Math.max(need, r - d + 0.5);
      }
      if (need <= 0) return y;
      y += need;
      if (y > hi) return null;
    }
    return y;
  }
  _r(t) { const p = profile(this.form, t); return Math.max(p.rx, p.ry) * this.L; }

  *build() {
    const out = {};
    yield* buildKaiju(this.rng, this.form, this.L, this.sys.low, out);
    const mesh = new THREE.Mesh(out.geo, kaijuMat());
    out.geo.boundingSphere.radius *= 1.15;
    this.root.add(mesh);
    this.mesh = mesh; this.eyes = out.eyes;
    const u = kaijuMat().userData.u;
    u.uLen.value = this.L; u.uVert.value = this.form === 'whale' ? 1 : 0;
    u.uAmp.value = this.form === 'whale' ? 0.018 : this.form === 'saurian' ? 0.035 : 0.05;
    u.uK.value = this.form === 'whale' ? 0.55 : this.form === 'saurian' ? 0.8 : 1.25;
    for (let i = 0; i < 6; i++) this.h.push({});
  }

  start(cam) {
    this.cs0 = cam.s; this.u = 0; this.ph = 0;
    const p = this._at(cam.s, 0, cam);
    const y = this._yFor(p.x, p.s, p.yBase);
    if (y === null) return false;
    this.x = p.x; this.y = y; this.s = p.s; this.z = -p.s;
    this.yaw = this.route === 'cross' ? (this.u0 < 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
    this._apply();
    return true;
  }
  _apply() {
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.root.updateMatrix();
  }

  update(dt, time, cam) {
    if (dt <= 0) return;
    const sys = this.sys;
    this.age += dt;
    // progress: the crossing keeps its distance ahead of the travelling camera; the pass runs on a
    // world-fixed lane toward (and past) the camera
    const total = this.route === 'cross' ? (2 * Math.abs(this.u0)) / this.speed : (2 * (this.fog + this.L * 0.6)) / this.speed;
    this.u += (dt / total) * (this.hurry ? 2.5 : 1);
    const p = this._at(this.route === 'cross' ? cam.s : this.cs0, this.u, cam);
    // leaving: sink away into the deep at the end
    const sink = sstep(0.78, 1, this.u) * 14;
    this.chk -= dt;
    if (this.chk <= 0) {
      this.chk = 0.2;
      const y = this._yFor(p.x, p.s, p.yBase - sink);
      if (y !== null) this.yT = y;
      else { this.hurry = true; this.yT = Math.max(this.yT ?? this.y, this._lo); } // no room: stay above the seabed and leave sooner
    }
    if (this.yT === undefined) this.yT = this.y;
    this.liftV += ((this.yT - this.y) * 0.4 - this.liftV * 1.2) * dt;
    const ny = this.y + this.liftV * dt;
    this.vx = (p.x - this.x) / dt; this.vy = (ny - this.y) / dt; this.vz = (-p.s - this.z) / dt;
    this.x = p.x; this.y = ny; this.s = p.s; this.z = -p.s;
    // along the lane (it follows the bends of the path) or straight across the view
    const yawT = this.route === 'cross' ? (this.u0 < 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(sys.shape.pathX(this.s - 6) - sys.shape.pathX(this.s), 6);
    let d = yawT - this.yaw; d -= Math.round(d / TAU) * TAU;
    this.yaw += d * Math.min(1, dt * 0.5);
    this._apply();
    // swimming wave travelling down the body
    const u = kaijuMat().userData.u, lam = this.L / u.uK.value;
    this.ph += dt * TAU * (this.speed * 1.5) / lam;
    u.uPh.value = this.ph % (TAU * 1000);
    this._spine(cam);
    // keep the planned distance: back off (sideways / further ahead) when the camera gets closer
    if (this.nearD < this.near - 2) this.extra = (this.extra || 0) + Math.min(this.near - 2 - this.nearD, 1) * dt * (this.nearD < this.near - 8 ? 6 : 2);
    this._eyes(cam);
    u.uGlowK.value = 0.3 + 0.7 * sys.dark(this.y);
    this._register(dt);
    if (!this.seen) this.seen = this._inView(cam);
    const behind = this.route === 'pass' && cam.s - this.s > this.L * 0.6 + 40;
    if (this.u >= 1 || behind) {
      this.done = true;
      if (this.seen && !this.noted) { this.noted = true; if (sys.env.note) sys.env.note('…did you see that?'); }
    }
  }

  // global positions of points along the (straight) spine; nearest one to the camera for subject/label
  _spine(cam) {
    const n = 9, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    let best = 1e9;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), lz = (0.5 - t) * this.L, pr = profile(this.form, t);
      const p = this.pts[i] || (this.pts[i] = { x: 0, y: 0, z: 0, r: 0 });
      p.x = this.x + sn * lz; p.y = this.y + pr.cy * this.L; p.z = this.z + c * lz; p.r = Math.max(pr.rx, pr.ry) * this.L;
      const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) - p.r;
      if (d < best) { best = d; this.nearest = p; }
    }
    this.nearD = best;
  }
  _eyes(cam) {
    const fx = this.sys.fx, k = 0.55 + 0.45 * this.sys.dark(this.y);
    for (const e of this.eyes) {
      _v.set(e[0], e[1], e[2]).applyMatrix4(this.root.matrix);
      fx.flare(_v.x, _v.y, _v.z, this.L * 0.02, 0.8, 1, 0.9, 0.5 * k);
    }
  }
  _inView(cam) {
    const p = this.nearest;
    if (!p || this.nearD > 2.2 / this.sys.sigmaG()) return false;
    const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z, d = Math.hypot(dx, dy, dz) || 1, f = cam.forward;
    return (dx * f.x + dy * f.y + dz * f.z) / d > 0.55;
  }
  _register(dt) {
    this.regT -= dt;
    if (this.regT > 0) return;
    this.regT = 0.3;
    const P = this.pts;
    for (let i = 0; i < 6; i++) {
      const a = P[Math.round((i * 8) / 6)], b = P[Math.round(((i + 1) * 8) / 6)];
      this.sys.reg(this.h[i], a.x, a.y, -a.z, b.x, b.y, -b.z, Math.max(a.r, b.r) + this.L * 0.05 + 2);
    }
  }

  subjects(out) {
    const p = this.nearest;
    if (!p) return;
    const e = this.sub;
    // the head is what the camera wants; the nearest flank keeps it in range
    _v.set(this.eyes[0][0], this.eyes[0][1], this.eyes[0][2]).applyMatrix4(this.root.matrix);
    const hd = Math.hypot(_v.x - this.sys.cam.x, _v.y - this.sys.cam.y, _v.z - this.sys.cam.z);
    if (hd < 58) { e.x = _v.x; e.y = _v.y; e.z = _v.z; } else { e.x = p.x; e.y = p.y; e.z = p.z; }
    e.vx = this.vx; e.vy = this.vy; e.vz = this.vz; e.r = 8;
    out.push(e);
  }
  labels(out) {
    const p = this.nearest;
    if (!p) return;
    // on the skin nearest to the camera (a little above), so the dive log counts the sighting
    const c = this.sys.cam, dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z, d = Math.hypot(dx, dy, dz) || 1;
    const l = this.lab;
    l.x = p.x + (dx / d) * p.r; l.y = p.y + (dy / d) * p.r + p.r * 0.3; l.z = p.z + (dz / d) * p.r;
    out.push(l);
  }
  dispose() {
    for (const h of this.h) this.sys.unreg(h);
    if (this.mesh) this.mesh.geometry.dispose();
  }
}
const _v = new THREE.Vector3();
