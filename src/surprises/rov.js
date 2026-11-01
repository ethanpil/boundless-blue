// A work-class ROV on its tether (about every 45 minutes in the deep zones): a buoyancy-foam block on
// an open frame, vectored and vertical thrusters, LED lamps and cameras on pan-tilt, two manipulators
// and a tool skid. Its umbilical rises toward a ship far above, swaying and fading into the murk.
// It surveys slowly beside the camera path, stops now and then to sample the seabed (the arm reaches
// down, the jaws close, a puff of silt), and turns its cameras toward us when we pass.
import * as THREE from 'three';
import { GeoBuilder, loft, box, cyl, sph, torus, T, seg, lin, mulS, fbm, surMat, makeBones, skinned, clamp, sstep, lerp, TAU } from './kit.js';
import { Vehicle, thruster, lamp, manipulator, armBones, resolveBones, paint, setBone } from './parts.js';

const FACT = 'work-class ROVs are flown from a ship far above through a tether that carries power and fibre-optic video; the deepest dive below 6,000 m.';
const NAMES = ['ROV Lanternfish', 'ROV Argo Minor', 'ROV Tethys-4', 'ROV Bathy Owl', 'ROV Sounder'];
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const TETHER_N = 44, TETHER_R = 6;

function spec() {
  const s = [['root', -1, 0, 0, 0], ['tFL', 0, 0.72, -0.3, 1.0], ['tFR', 0, -0.72, -0.3, 1.0], ['tAL', 0, 0.72, -0.3, -1.0], ['tAR', 0, -0.72, -0.3, -1.0],
    ['tVL', 0, 0.42, 0.45, -0.05], ['tVR', 0, -0.42, 0.45, -0.05], ['pan', 0, 0.3, 0.02, 1.25]];
  for (const b of armBones('aL', [0.45, -0.55, 1.22], 0.55, 0.48, 0.05)) s.push(b);
  for (const b of armBones('aR', [-0.45, -0.55, 1.22], 0.45, 0.38, 0.045)) s.push(b);
  return resolveBones(s);
}

function* buildRov(g, rng, low, out) {
  const foam = lin(pick(rng, [0xf2b51b, 0xf06a1d, 0xf2c21b, 0xe8e8e2, 0xd23a2a])), frameC = lin(pick(rng, [0x2a2c30, 0x1a1b1e, 0x8a9096]));
  const steel = lin(0x9aa1a8), black = lin(0x141518), S = low ? 16 : 24;
  // buoyancy block with grime, decal stripes and a top deck
  const foamC = (x, y, z) => {
    const stripe = Math.abs(z - 0.55) < 0.07 || Math.abs(z + 0.75) < 0.05 ? 0.25 : 1;
    return mulS(foam, stripe * (0.86 + 0.18 * fbm(x * 2.5, y * 2.5, z * 2.5)) - 0.08 * Math.max(0, fbm(x * 9, y * 0.8, z * 9) - 0.5));
  };
  const rings = [[-1.25, 0.7, 0.26, 0, 0.5], [-1.15, 0.8, 0.32, 0, 0.48], [1.05, 0.8, 0.32, 0, 0.48], [1.2, 0.7, 0.25, 0, 0.5]].map((r) => [...r, 6]);
  g.add(loft(rings, S, { axis: 'z', e: 6 }), null, foamC, { rough: 0.6 });
  yield;
  // open frame: corner posts, rails, cross members
  const fx = 0.8, fz = 1.18, y0 = -0.82, y1 = 0.16;
  for (const sx of [1, -1]) for (const sz of [1, -1]) g.add(cyl(0.035, 0.035, 1, 6), seg(sx * fx, y0, sz * fz, sx * fx, y1, sz * fz, 1), frameC, { rough: 0.5 });
  for (const y of [y0, y1, -0.35]) {
    for (const sx of [1, -1]) g.add(box(0.06, 0.06, fz * 2), T(sx * fx, y, 0), frameC, { rough: 0.5 });
    for (const sz of [1, -1]) g.add(box(fx * 2, 0.06, 0.06), T(0, y, sz * fz), frameC, { rough: 0.5 });
  }
  // pressure housings (electronics pods) inside the frame
  for (const sx of [1, -1]) g.add(cyl(0.13, 0.13, 1.5, 14), T(sx * 0.32, -0.15, -0.15, Math.PI / 2, 0, 0), paint(lin(0x5a6068), 0.1), { rough: 0.35 });
  g.add(box(0.5, 0.3, 0.6), T(0, -0.5, -0.4), paint(lin(0x3a3f45), 0.1), { rough: 0.5 });
  yield;
  // tool skid with sample drawer and push cores
  g.add(box(1.5, 0.05, 2.2), T(0, -0.98, 0), frameC, { rough: 0.6 });
  for (const sx of [1, -1]) for (const sz of [1, -1]) g.add(cyl(0.03, 0.03, 1, 6), seg(sx * 0.7, -0.98, sz * 1.0, sx * 0.75, y0, sz * 1.05, 1), frameC, { rough: 0.5 });
  g.add(box(1.0, 0.16, 0.5), T(0, -0.9, 0.75), lin(0x9098a0), { rough: 0.5 });
  for (let i = 0; i < 6; i++) g.add(cyl(0.035, 0.035, 0.42, 8), T(-0.5 + i * 0.2, -0.75, 0.2, 0, 0, 0), lin(0xc8d4d8), { rough: 0.15 });
  yield;
  // thrusters: four vectored horizontals at the corners, two verticals through the foam
  const duct = paint(lin(0x2c2e33), 0.12), prop = lin(0x1c1c1c);
  const c45 = Math.SQRT1_2;
  thruster(g, 1, [0.72, -0.3, 1.0], [c45, 0, c45], 0.17, duct, prop, 3, low);
  thruster(g, 2, [-0.72, -0.3, 1.0], [-c45, 0, c45], 0.17, duct, prop, 3, low);
  thruster(g, 3, [0.72, -0.3, -1.0], [c45, 0, -c45], 0.17, duct, prop, 3, low);
  thruster(g, 4, [-0.72, -0.3, -1.0], [-c45, 0, -c45], 0.17, duct, prop, 3, low);
  thruster(g, 5, [0.42, 0.45, -0.05], [0, 1, 0], 0.18, duct, prop, 3, low);
  thruster(g, 6, [-0.42, 0.45, -0.05], [0, 1, 0], 0.18, duct, prop, 3, low);
  yield;
  // cameras: pan-tilt HD camera (bone 7) and a fixed one; lamps on a front bar and on the top corners
  g.add(box(0.14, 0.14, 0.1), T(0.3, -0.05, 1.18), black, { bone: 7, rough: 0.5 });
  g.add(cyl(0.065, 0.065, 0.28, 12), T(0.3, 0.02, 1.32, Math.PI / 2, 0, 0), lin(0x30343a), { bone: 7, rough: 0.35 });
  g.add(cyl(0.05, 0.05, 0.02, 12), T(0.3, 0.02, 1.465, Math.PI / 2, 0, 0), lin(0x0c1a2a), { bone: 7, rough: 0.05, glow: 0.15 });
  g.add(box(0.16, 0.12, 0.26), T(-0.25, 0.04, 1.25), lin(0x30343a), { rough: 0.4 });
  g.add(cyl(0.045, 0.045, 0.02, 12), T(-0.25, 0.04, 1.385, Math.PI / 2, 0, 0), lin(0x0c1a2a), { rough: 0.05 });
  const housing = lin(0x2a2c30), lamps = [];
  g.add(box(1.7, 0.05, 0.06), T(0, 0.14, 1.24), frameC, { rough: 0.5 });
  for (const x of [0.72, 0.4, -0.4, -0.72]) lamps.push(lamp(g, [x, 0.14, 1.28], [x * 0.12, -0.42, 1], 0.06, housing, { lens: [1, 0.97, 0.92], glow: 3 }));
  for (const sx of [1, -1]) lamps.push(lamp(g, [sx * 0.72, 0.82, 1.08], [sx * 0.18, -0.55, 1], 0.07, housing, { lens: [1, 0.97, 0.92], glow: 3 }));
  yield;
  // manipulators: a 7-function arm and a grabber
  manipulator(g, 8, [0.45, -0.55, 1.22], 0.55, 0.48, 0.05, steel, lin(0x1c1d20), low);
  manipulator(g, 13, [-0.45, -0.55, 1.22], 0.45, 0.38, 0.045, lin(0x2a2b2e), lin(0xd8661e), low);
  // tether termination with a bend restrictor, strobe beacon, lifting bail
  g.add(cyl(0.06, 0.14, 0.4, 12), T(0, 0.98, -0.45), black, { rough: 0.5 });
  g.add(sph(0.05, 8, 6), T(0.55, 0.85, -1.0), lin(0xffffff), { rough: 0.1, glow: 104 });
  g.add(torus(0.18, 0.03, 6, 12, Math.PI), T(0, 0.8, 0.5, 0, Math.PI / 2, 0), steel, { rough: 0.4 });
  out.lamps = lamps;
  out.tether = [0, 1.18, -0.45];
  out.samples = [[0, 0, 0.6, 1.0], [0, 0, -0.6, 1.0], [0, -0.85, 0, 0.7], [0, 0.5, 0, 0.9], [0, -0.55, 1.9, 0.35]];
}

export class Rov extends Vehicle {
  constructor(sys, rng) {
    super(sys, rng, 'rov');
    this.frame = 0; this.task = null; this.taskT = 8 + rng() * 8; this.lookT = 0; this.looked = false;
    this.lab.name = 'ROV (remotely operated vehicle)';
  }

  plan(cam, force) {
    const sys = this.sys, rng = this.rng, o = this.opts || {};
    this.len = 2.7; this.rad = 1.25; this.top = 1.0; this.bot = 1.0;
    this.samples = [[0, 0, 0, 1.3]];
    this.camMin = 6;
    this.dir = o.dir || (rng() < 0.55 ? -1 : 1);
    this.speed = 0.28 + rng() * 0.16;
    this.alt = this.bot + 1.0 + rng() * 1.4;
    this.maxBelow = 3 + rng() * 5;
    const zone = sys.zoneKey(cam.s + 40);
    this.midwater = ['pelagic', 'abyss'].includes(zone);
    const fog = sys.fogD();
    this.ahead = clamp(fog * 0.8, 38, 80);
    const s0 = cam.s + (this.dir < 0 ? this.ahead : clamp(this.ahead * 0.55, 30, 45));
    const minLat = this.camMin + this.rad + 1;
    const lane = this.dir < 0 ? this.lane(cam.s - 10, s0 + 3, [minLat + 1, minLat + 3, minLat + 6], force) : this.lane(s0 - 3, s0 + 40, [minLat + 1, minLat + 3, minLat + 6], force);
    if (!lane) return false;
    this.side = lane.side; this.lat = lane.lat;
    this.vessel = pick(rng, NAMES);
    this.lab.fact = `${this.vessel} — ${FACT}`;
    this.sub.id = 'sur:rov'; this.sub.r = 1.4; this.sub.interest = 1.3;
    return true;
  }

  *build() {
    const sys = this.sys, low = sys.low, out = {};
    const g = new GeoBuilder(true);
    yield* buildRov(g, this.rng, low, out);
    yield;
    const bones = makeBones(spec());
    const mesh = skinned(g.build(), surMat('vehicle', { rough: 0.5 }), bones, 2.6);
    this.root.add(mesh);
    this.mesh = mesh; this.bones = bones;
    this.lamps = out.lamps; this.samples = out.samples; this.tetherAt = out.tether;
    this.props = [[1, 0.707, 0, 0.707, 1], [2, -0.707, 0, 0.707, -1], [3, 0.707, 0, -0.707, 1], [4, -0.707, 0, -0.707, -1], [5, 0, 1, 0, 0.7], [6, 0, 1, 0, -0.7]];
    this.arms = [8, 13];
    yield;
    // the umbilical: a tube rebuilt in place every frame
    const tg = new THREE.BufferGeometry();
    const nv = (TETHER_N + 1) * (TETHER_R + 1);
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    tg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    const col = new Float32Array(nv * 3), surf = new Float32Array(nv * 2);
    const tc = lin(this.rng() < 0.5 ? 0xf2b51b : 0x1c1d20), mark = lin(0xe8e8e8);
    for (let i = 0; i <= TETHER_N; i++) for (let j = 0; j <= TETHER_R; j++) {
      const k = i * (TETHER_R + 1) + j, c = i % 6 === 0 ? mark : tc;
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2]; surf[k * 2 + 1] = 0.5;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    tg.setAttribute('aSurf', new THREE.BufferAttribute(surf, 2));
    const idx = [];
    for (let i = 0; i < TETHER_N; i++) for (let j = 0; j < TETHER_R; j++) {
      const a = i * (TETHER_R + 1) + j, b = a + 1, c = a + TETHER_R + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    tg.setIndex(idx);
    this.tether = new THREE.Mesh(tg, surMat('vehicle', { rough: 0.5 }));
    this.tether.frustumCulled = false;
    this.tPts = new Float32Array((TETHER_N + 1) * 3);
    this.makeLights(11, 0.36, [0.92, 0.97, 1], 0.2, 4, true);
    this._stow();
  }

  _stow() {
    const b = this.bones;
    for (const a of this.arms) { setBone(b[a], 0.85, 0, 0); setBone(b[a + 1], -2.0, 0, 0); setBone(b[a + 2], 0, 0, 0); setBone(b[a + 3], 0.05, 0, 0); setBone(b[a + 4], -0.05, 0, 0); }
  }

  start(cam) {
    const s0 = cam.s + (this.dir < 0 ? this.ahead : clamp(this.ahead * 0.55, 30, 45));
    this.s = s0; this.place(cam); this.speedNow = this.speed;
    return this.settle(); // the hull must start clear of everything
  }

  update(dt, time, cam) {
    if (dt <= 0) return;
    this.age += dt; this.frame++;
    if (!this.tether.parent && this.root.parent) this.root.parent.add(this.tether);
    // tasks: stop to sample the seabed; turn the cameras toward us as we pass
    const dCam = Math.hypot(this.x - cam.x, this.y - cam.y, this.z - cam.z);
    let speed = this.speed;
    if (!this.task) {
      this.taskT -= dt;
      if (!this.looked && dCam < 18) { this.task = { k: 'look', t: 0 }; this.looked = true; }
      else if (this.taskT <= 0 && !this.midwater) {
        const f = this.sys.floor(this.x, this.s);
        if (this.y - f < 2.8) this.task = { k: 'sample', t: 0 };
        this.taskT = 18 + this.rng() * 14;
      }
    }
    const tk = this.task;
    if (tk) {
      tk.t += dt;
      speed = 0.04;
      if (tk.k === 'look' && tk.t > 7) this.task = null;
      if (tk.k === 'sample' && tk.t > 11) { this.task = null; this._stow(); }
    }
    this.move(dt, cam, speed);
    // while looking, yaw toward the camera (the pilot films us back)
    if (tk && tk.k === 'look') {
      const yawT = Math.atan2(cam.x - this.x, cam.z - this.z);
      let d = yawT - this.yaw; d -= Math.round(d / TAU) * TAU;
      this.yaw += clamp(d, -0.5, 0.5) * Math.min(1, dt * 0.6) * sstep(0, 1.5, tk.t) * (1 - sstep(5.5, 7, tk.t));
      this._apply();
    }
    this._animate(dt, time, cam);
    this.lights(dt, cam, this.frame);
    this._tether(time);
    this.register(dt, this.rad + 1.2);
    const behind = (cam.s - this.s) > 30, far = Math.abs(this.s - cam.s) > 240;
    if (behind || far || this.age > 600) this.done = true;
  }

  _animate(dt, time, cam) {
    const b = this.bones;
    const spin = 2 + this.speedNow * 14;
    for (const [bi, ax, ay, az, k] of this.props) {
      const bone = b[bi];
      bone.userData.a = (bone.userData.a || 0) + spin * k * dt * (bi >= 5 ? 0.5 + 0.5 * Math.sin(time * 0.3 + bi) : 1);
      _ax.set(ax, ay, az); bone.quaternion.setFromAxisAngle(_ax, bone.userData.a);
    }
    // pan-tilt camera: scans, or tracks us while looking
    const tk = this.task;
    let pan = 0.35 * Math.sin(time * 0.21), tilt = -0.2 + 0.12 * Math.sin(time * 0.17);
    if (tk && tk.k === 'look') {
      this.toGlobal(0.3, 0.02, 1.25, _p);
      _v.set(cam.x - _p.x, cam.y - _p.y, cam.z - _p.z).applyQuaternion(_qi.copy(this.root.quaternion).invert());
      pan = clamp(Math.atan2(_v.x, _v.z), -1, 1); tilt = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6) * -1;
    }
    const pb = b[7];
    pb.userData.pan = lerp(pb.userData.pan || 0, pan, Math.min(1, dt * 1.5));
    pb.userData.tilt = lerp(pb.userData.tilt || 0, tilt, Math.min(1, dt * 1.5));
    setBone(pb, pb.userData.tilt, pb.userData.pan, 0);
    // sampling: the 7-function arm reaches to the seabed, the jaws close, a puff of silt
    if (tk && tk.k === 'sample') {
      const a = this.arms[0], t = tk.t;
      const reach = sstep(0.5, 3, t) * (1 - sstep(8.5, 10.5, t));
      setBone(b[a], lerp(0.85, 0.75, reach), 0.15 * reach, 0);
      setBone(b[a + 1], lerp(-2.0, 0.35, reach), 0, 0);
      setBone(b[a + 2], 0.6 * reach, 0, 0.4 * Math.sin(t * 0.8) * reach);
      const open = reach * (t < 4.5 ? 0.45 : 0.04);
      setBone(b[a + 3], open, 0, 0); setBone(b[a + 4], -open, 0, 0);
      if (t > 4.4 && !tk.puff) {
        tk.puff = true;
        // gripper tip in mesh space follows the bone chain; approximate with the reach point below the bow
        this.toGlobal(0.45, -1.55, 1.95, _p);
        const f = this.sys.floor(_p.x, -_p.z);
        if (_p.y - f < 1.5) this.sys.fx.silt(_p.x, f + 0.1, _p.z, 10, 0.9);
      }
    }
  }

  // The umbilical leaves the top of the ROV and rises toward the ship, trailing behind and away from
  // the camera path, swaying slowly. It stops below the surface (or the fog hides its end).
  _tether(time) {
    const P = this.tPts, sys = this.sys;
    this.toGlobal(this.tetherAt[0], this.tetherAt[1], this.tetherAt[2], _p);
    const x0 = _p.x, y0 = _p.y, z0 = _p.z;
    const H = Math.max(4, Math.min(85, -1.5 - y0));
    const back = -Math.sin(this.yaw), backZ = -Math.cos(this.yaw); // opposite the heading
    const out = Math.sign(this.x - sys.shape.pathX(this.s)) || 1;
    for (let i = 0; i <= TETHER_N; i++) {
      const u = i / TETHER_N, h = H * u;
      const trail = H * 0.35 * Math.pow(u, 1.5), sway = 1.2 * Math.sin(time * 0.25 + u * 3.5) * u;
      P[i * 3] = x0 + back * trail + out * (H * 0.12 * u * u) + sway;
      P[i * 3 + 1] = y0 + h;
      P[i * 3 + 2] = z0 + backZ * trail + 0.8 * Math.cos(time * 0.2 + u * 2.7) * u;
    }
    const m = this.tether;
    m.position.set(x0, y0, z0);
    const pos = m.geometry.attributes.position.array, nor = m.geometry.attributes.normal.array;
    for (let i = 0; i <= TETHER_N; i++) {
      const a = Math.max(0, i - 1), c = Math.min(TETHER_N, i + 1);
      let tx = P[c * 3] - P[a * 3], ty = P[c * 3 + 1] - P[a * 3 + 1], tz = P[c * 3 + 2] - P[a * 3 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // frame: n = normalize(X x t), b = t x n
      let nx = 0, ny = -tz, nz = ty; let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-3) { nx = tz; ny = 0; nz = -tx; nl = Math.hypot(nx, ny, nz) || 1; }
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const r = 0.032;
      for (let j = 0; j <= TETHER_R; j++) {
        const ang = (j / TETHER_R) * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
        const k = (i * (TETHER_R + 1) + j) * 3;
        const ox = nx * ca + bx * sa, oy = ny * ca + by * sa, oz = nz * ca + bz * sa;
        pos[k] = P[i * 3] - x0 + ox * r; pos[k + 1] = P[i * 3 + 1] - y0 + oy * r; pos[k + 2] = P[i * 3 + 2] - z0 + oz * r;
        nor[k] = ox; nor[k + 1] = oy; nor[k + 2] = oz;
      }
    }
    m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.normal.needsUpdate = true;
  }

  dispose() {
    this.disposeLights();
    if (this.tether) { if (this.tether.parent) this.tether.parent.remove(this.tether); this.tether.geometry.dispose(); }
  }
}
const _p = { x: 0, y: 0, z: 0 }, _ax = new THREE.Vector3(), _v = new THREE.Vector3(), _qi = new THREE.Quaternion();
