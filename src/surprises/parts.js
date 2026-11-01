// Vehicle parts and behaviour shared by the submersible, the ROV and the glider: ducted thrusters with
// spinning props, lamps (housing + lens glow + fake volumetric cone + light pool on the seabed),
// hydraulic manipulator arms, and a Vehicle base class that follows a lane beside the camera path,
// keeps its whole hull clear of the seabed, ceilings, the surface and solid props, stays out of the
// camera's way, and registers itself as a moving obstacle for the creatures.
import * as THREE from 'three';
import { box, cyl, sph, torus, flip, T, seg, mulS, fbm, Beam, LightPool, skinned, clamp, lerp, TAU } from './kit.js';

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4();
const _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);
const _push = { x: 0, y: 0, s: 0 };

// Paint with a little grime: darker toward the bottom, faint streaks and mottling.
export function paint(c, amt = 0.12, streak = 0.08) {
  return (x, y, z) => {
    const n = 1 - amt * 0.5 + amt * fbm(x * 2.2, y * 2.2, z * 2.2) - streak * Math.max(0, fbm(x * 9, y * 0.6, z * 9) - 0.55) * 2;
    return mulS(c, n);
  };
}

/**
 * A ducted thruster centred at p (mesh frame) with its axis along a (unit, mesh frame): duct ring,
 * struts, hub and blades. Blades are skinned to `bone` (spun about the axis); the rest to bone 0.
 */
export function thruster(g, bone, p, a, r, ductCol, propCol, blades = 4, low = false) {
  _d.set(a[0], a[1], a[2]).normalize();
  _q.setFromUnitVectors(_Z, _d);
  const M = new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q, new THREE.Vector3(1, 1, 1));
  const ring = (rr, len) => { const gg = cyl(rr, rr, len, low ? 14 : 22, true); gg.rotateX(Math.PI / 2); return gg; };
  g.add(ring(r, r * 0.9), M, ductCol, { rough: 0.5 });
  const inner = flip(ring(r * 0.94, r * 0.9)); // inner wall faces inward
  const innerCol = typeof ductCol === 'function' ? (x, y, z) => mulS(ductCol(x, y, z), 0.6) : mulS(ductCol, 0.6).slice();
  g.add(inner, M, innerCol, { rough: 0.6 });
  g.add(torus(r, r * 0.06, 5, low ? 14 : 22), new THREE.Matrix4().multiplyMatrices(M, T(0, 0, r * 0.45)), ductCol, { rough: 0.5 });
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * TAU + 0.5;
    g.add(box(r * 0.05, r * 0.95, r * 0.1), new THREE.Matrix4().multiplyMatrices(M, T(Math.cos(ang) * r * 0.5, Math.sin(ang) * r * 0.5, -r * 0.3, 0, 0, ang - Math.PI / 2)), ductCol, { rough: 0.6 });
  }
  const hub = cyl(r * 0.2, r * 0.16, r * 0.9, 10); hub.rotateX(Math.PI / 2);
  g.add(hub, M, propCol, { bone, rough: 0.4 });
  for (let i = 0; i < blades; i++) {
    const ang = (i / blades) * TAU;
    g.add(box(r * 0.26, r * 0.7, r * 0.03), new THREE.Matrix4().multiplyMatrices(M, T(Math.cos(ang) * r * 0.48, Math.sin(ang) * r * 0.48, 0, 0, 0.45, ang - Math.PI / 2)), propCol, { bone, rough: 0.4 });
  }
}

/** Lamp housing at p aimed along dir (mesh frame); returns the lamp spec for beams / pools / flares. */
export function lamp(g, p, dir, r, housing, { glow = 2.5, lens = [1, 0.95, 0.85], bone = 0 } = {}) {
  _d.set(dir[0], dir[1], dir[2]).normalize();
  _q.setFromUnitVectors(_Z, _d);
  const M = new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q, new THREE.Vector3(1, 1, 1));
  const h = cyl(r * 1.05, r * 0.8, r * 1.6, 12); h.rotateX(Math.PI / 2); h.translate(0, 0, -r * 0.8);
  g.add(h, M, housing, { bone, rough: 0.45 });
  const l = cyl(r * 0.85, r * 0.85, r * 0.12, 12); l.rotateX(Math.PI / 2); l.translate(0, 0, r * 0.02);
  g.add(l, M, lens, { bone, rough: 0.1, glow });
  return { p: p.slice(), d: [_d.x, _d.y, _d.z], r };
}

/**
 * A hydraulic manipulator from shoulder s (mesh frame), straight along +Z in the bind pose:
 * shoulder (bone b0), upper arm to the elbow (b1), forearm to the wrist (b2), two gripper jaws (b3, b4).
 */
export function manipulator(g, b0, s, L1, L2, r, metal, accent, low = false) {
  const n = low ? 8 : 12;
  const [x, y, z] = s;
  g.add(sph(r * 1.5, n, 8), T(x, y, z), metal, { bone: 0, rough: 0.4 });
  g.add(cyl(r, r * 0.9, 1, n), seg(x, y, z, x, y, z + L1, 1), metal, { bone: b0, rough: 0.35 });
  g.add(cyl(r * 0.45, r * 0.45, 1, 8), seg(x + r * 1.1, y + r * 0.5, z + 0.1, x + r * 1.1, y + r * 0.5, z + L1 * 0.8, 1), accent, { bone: b0, rough: 0.4 }); // hydraulic ram
  g.add(sph(r * 1.25, n, 8), T(x, y, z + L1), metal, { bone: b1(b0), rough: 0.4 });
  g.add(cyl(r * 0.85, r * 0.75, 1, n), seg(x, y, z + L1, x, y, z + L1 + L2, 1), metal, { bone: b1(b0), rough: 0.35 });
  g.add(cyl(r * 0.4, r * 0.4, 1, 8), seg(x - r, y + r * 0.4, z + L1 + 0.08, x - r, y + r * 0.4, z + L1 + L2 * 0.75, 1), accent, { bone: b1(b0), rough: 0.4 });
  const w = z + L1 + L2;
  g.add(cyl(r * 0.9, r * 0.9, r * 1.6, n), T(x, y, w + r * 0.5, Math.PI / 2, 0, 0), accent, { bone: b0 + 2, rough: 0.4 });
  for (let k = 0; k < 2; k++) {
    const sgn = k ? -1 : 1;
    g.add(box(r * 0.5, r * 0.45, r * 3.2), T(x, y + sgn * r * 0.55, w + r * 2.6, sgn * 0.12, 0, 0), metal, { bone: b0 + 3 + k, rough: 0.35 });
    g.add(box(r * 0.5, r * 0.6, r * 0.5), T(x, y + sgn * r * 0.2, w + r * 4.1), metal, { bone: b0 + 3 + k, rough: 0.35 });
  }
}
const b1 = (b0) => b0 + 1;
/** Bone specs for a manipulator (shoulder, elbow, wrist, two jaws) to append to a vehicle's bone list. */
export function armBones(name, s, L1, L2, r) {
  const [x, y, z] = s;
  return [[name + 'Sh', 0, x, y, z], [name + 'El', -1, x, y, z + L1], [name + 'Wr', -1, x, y, z + L1 + L2],
    [name + 'J1', -1, x, y + r * 0.3, z + L1 + L2 + r], [name + 'J2', -2, x, y - r * 0.3, z + L1 + L2 + r]];
}
/** Resolve relative parent indices (-1 = previous bone, -k = k bones back) in a bone spec list. */
export function resolveBones(spec) {
  return spec.map((b, i) => [b[0], b[1] < 0 ? i + b[1] : b[1], b[2], b[3], b[4]]);
}

const _e = new THREE.Euler();
export function setBone(bone, x, y, z) { _e.set(x, y, z, 'XYZ'); bone.quaternion.setFromEuler(_e); }

/**
 * Base class for vehicles. Subclasses set (in plan/build): this.len (hull length), this.rad (hull
 * radius for clearance), this.height (above/below centre: this.top, this.bot), this.samples (local
 * hull points [x, y, z, r]), this.lamps (lamp specs), this.speed, this.dir (+1 forward with the
 * camera, -1 toward it), this.side, this.lat, this.alt (wanted height of the centre over the seabed),
 * this.camMin (minimum camera distance to the hull surface).
 */
export class Vehicle {
  constructor(sys, rng, kind) {
    this.sys = sys; this.rng = rng; this.kind = kind;
    this.root = new THREE.Group(); this.root.name = 'surprise-' + kind;
    this.done = false; this.age = 0;
    this.s = 0; this.latO = 0; this.y = 0; this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.yV = 0; this.latV = 0; this.avoid = 0; this.lift = 0;
    this.beams = []; this.pool = null; this.props = []; this.h = {}; this.regT = 0;
    this.sub = { id: 'sur:' + kind, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 2, interest: 1.3 };
    this.lab = { name: kind, x: 0, y: 0, z: 0, fact: '' };
    this.vx = 0; this.vy = 0; this.vz = 0; this.speedNow = 0;
    this.lampsOn = 1; this.ahead = 70;
  }

  // ---------- lane planning ----------
  // The height for the centre at (x, s): `alt` over the highest seabed under the hull, inside the water column.
  _height(x, s, wantY) {
    const sys = this.sys, h = this.len * 0.5;
    let f = -1e9, c = 1e9;
    for (let k = -1; k <= 1; k++) { const ss = s + k * h * 0.9; f = Math.max(f, sys.floor(x, ss)); c = Math.min(c, sys.ceil(x, ss)); }
    // over deep water stay within sight: no more than maxBelow under the camera path
    let y = wantY ?? Math.max(f + this.alt, sys.shape.pathY(s) - (this.maxBelow ?? 5));
    y = Math.max(y, f + this.bot + 1.2);
    y = Math.min(y, c - this.top - 1.2);
    return { y, f, c, ok: c - this.top - 1.2 >= f + this.bot + 1.2 };
  }
  /** Find a side and lateral offset with room for the hull along [s0, s1]. */
  lane(s0, s1, lats, force) {
    const sys = this.sys, sh = sys.shape, need = force ? 0.55 : 0.85, N = 11;
    const sides = this.rng() < 0.5 ? [1, -1] : [-1, 1];
    let best = null, bestScore = -1;
    for (const side of sides) for (const lat of lats) {
      let fails = 0;
      for (let k = 0; k < N; k++) {
        const s = lerp(s0, s1, k / (N - 1)), x = sh.pathX(s) + side * lat;
        const H = this._height(x, s, this.wantY ? this.wantY(s) : undefined);
        let clear = H.ok;
        if (clear) for (const [lx, ly, lz, r] of this.samples) {
          if (sys.obsDist(x + lx, H.y + ly, s + lz, r + 3, null) < r + 0.8) { clear = false; break; }
        }
        // stop sampling a lane that can no longer reach the threshold (callers may try many lanes)
        if (!clear && (N - ++fails) / N - lat * 0.004 < need) break;
      }
      const score = (N - fails) / N - lat * 0.004;
      if (score > bestScore) { bestScore = score; best = { side, lat }; }
    }
    return bestScore >= need ? best : null;
  }

  // ---------- placement ----------
  place(cam) {
    const sh = this.sys.shape;
    const x = sh.pathX(this.s) + this.side * this.lat + this.latO;
    this.x = x; this.z = -this.s;
    const H = this._height(x, this.s, this.wantY ? this.wantY(this.s) : undefined);
    this.y = H.y;
    this.yaw = this.dir > 0 ? Math.PI : 0;
    this._apply();
  }
  // Nudge a freshly placed hull out of anything it overlaps; false when it cannot get clear.
  settle() {
    const sys = this.sys;
    for (let it = 0; it < 24; it++) {
      _push.x = _push.y = _push.s = 0;
      let worst = 9;
      for (const sp of this.samples) {
        this.toGlobal(sp[0], sp[1], sp[2], _g);
        worst = Math.min(worst, sys.clear(_g.x, _g.y, -_g.z, sp[3], 0.4, _push));
      }
      if (worst >= 0.05) break;
      if (Math.hypot(_push.x, _push.y, _push.s) < 1e-4) return false;
      this.x += _push.x * 0.8; this.y += _push.y * 0.8; this.s += _push.s * 0.8; this.z = -this.s;
      this._apply();
      if (it === 23) return false;
    }
    // keep the corrected offset as the lane's avoidance so the springs do not pull it back in
    this.avoid = this.x - this.sys.shape.pathX(this.s) - this.side * this.lat;
    this.lift = 0;
    return this._camDist(this.sys.cam || { x: 1e9, y: 0, z: 0 }) > this.camMin * 0.6;
  }
  _apply() {
    const r = this.root;
    r.position.set(this.x, this.y, this.z);
    _e.set(this.pitch, this.yaw, this.roll, 'YXZ');
    r.quaternion.setFromEuler(_e);
    r.updateMatrix();
  }
  // local -> GLOBAL point (z = -s)
  toGlobal(lx, ly, lz, out) {
    _v.set(lx, ly, lz).applyMatrix4(this.root.matrix);
    out.x = _v.x; out.y = _v.y; out.z = _v.z; return out;
  }
  toGlobalDir(dx, dy, dz, out) {
    _v.set(dx, dy, dz).applyQuaternion(this.root.quaternion);
    out.x = _v.x; out.y = _v.y; out.z = _v.z; return out;
  }

  // ---------- motion ----------
  move(dt, cam, speed) {
    const sys = this.sys, sh = sys.shape;
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 0.5);
    const ds = this.dir * this.speedNow * dt;
    this.s += ds;
    // clearance of the whole hull: push the lane offset and the height away from anything close
    _push.x = _push.y = _push.s = 0;
    let worst = 9;
    for (const sp of this.samples) {
      this.toGlobal(sp[0], sp[1], sp[2], _g);
      worst = Math.min(worst, sys.clear(_g.x, _g.y, -_g.z, sp[3], 1.0, _push));
    }
    // camera bubble: keep the hull at least camMin away (lateral first, then vertical)
    const cd = this._camDist(cam);
    let camPush = 0;
    if (cd < this.camMin) camPush = (this.camMin - cd);
    const outward = Math.sign(this.side * this.lat + this.latO) || this.side;
    this.avoid += (_push.x * 1.5 + outward * camPush * 1.5) * dt;
    this.lift += _push.y * 1.5 * dt;
    // never let the avoidance pull the hull toward the camera path line
    const minLat = this.camMin * 0.7 + this.rad;
    this.avoid *= 1 - Math.min(1, dt * 0.08); this.lift *= 1 - Math.min(1, dt * 0.08);
    const latT = this.side * this.lat + this.avoid;
    const lat2 = Math.abs(latT) < minLat ? Math.sign(latT || this.side) * minLat : latT;
    // critically damped springs toward the lane offset and the height
    const x0 = sh.pathX(this.s);
    const cur = this.x - x0;
    this.latV += ((lat2 - cur) * 0.4 - this.latV * 1.25) * dt;
    let nx = x0 + cur + this.latV * dt;
    const H = this._height(nx, this.s + this.dir * this.len * 0.3, this.wantY ? this.wantY(this.s) : undefined);
    const yT = clamp(H.y + this.lift, H.f + this.bot + 0.8, H.c - this.top - 0.8);
    this.yV += ((yT - this.y) * 0.5 - this.yV * 1.4) * dt;
    let ny = this.y + this.yV * dt;
    // hard: if something is inside the hull margin, step straight out of it
    if (worst < 0.15) { nx += _push.x * 0.5; ny += _push.y * 0.5; this.s += _push.s * 0.5; }
    const vx = (nx - this.x) / dt, vy = (ny - this.y) / dt, vz = -(ds) / dt;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.x = nx; this.y = ny; this.z = -this.s;
    // heading follows the motion (vehicles crab a little in currents)
    if (this.speedNow > 0.05) {
      const yawT = Math.atan2(vx, vz);
      let dyaw = yawT - this.yaw; dyaw -= Math.round(dyaw / TAU) * TAU;
      this.yaw += clamp(dyaw, -0.4, 0.4) * Math.min(1, dt * 0.8);
    }
    if (!Number.isFinite(this.x + this.y + this.s + this.yaw)) { // numerical safety on very long runs
      const g = this._good;
      if (!g) { this.done = true; return -1; }
      this.x = g.x; this.y = g.y; this.s = g.s; this.z = -g.s; this.yaw = g.yaw; this.latV = this.yV = 0; this.avoid = this.lift = 0;
    } else { const g = this._good || (this._good = {}); g.x = this.x; g.y = this.y; g.s = this.s; g.yaw = this.yaw; }
    const pm = this.pitchMax ?? 0.15; // nose down while descending (+x pitch tips the bow down)
    const pT = clamp(-Math.atan2(vy, Math.hypot(vx, vz) + 0.05) * (this.pitchK ?? 0.6), -pm, pm);
    this.pitch += (pT - this.pitch) * Math.min(1, dt * 0.5);
    this._apply();
    return worst;
  }
  _camDist(cam) {
    let best = 1e9;
    for (const sp of this.samples) {
      this.toGlobal(sp[0], sp[1], sp[2], _g);
      const d = Math.hypot(_g.x - cam.x, _g.y - cam.y, _g.z - cam.z) - sp[3];
      if (d < best) best = d;
    }
    return best;
  }

  // ---------- lights ----------
  makeLights(beamLen, half, color, intensity, maxBeams, pool = true) {
    const sys = this.sys;
    const nb = Math.min(this.lamps.length, sys.low ? Math.min(2, maxBeams) : maxBeams);
    const step = this.lamps.length / Math.max(1, nb);
    for (let i = 0; i < nb; i++) {
      const L = this.lamps[Math.floor(i * step)];
      const b = new Beam(beamLen, half, color, intensity, sys.low ? 5 : 8);
      b.mesh.position.set(L.p[0], L.p[1], L.p[2]);
      _d.set(L.d[0], L.d[1], L.d[2]); _q.setFromUnitVectors(_Z, _d); b.mesh.quaternion.copy(_q);
      (L.bone || this.root).add(b.mesh);
      this.beams.push(b);
    }
    if (pool && !sys.low) {
      this.pool = new LightPool(13);
      this._poolLamps = this.lamps.map(() => ({ x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, cos0: Math.cos(half * 1.3), k: 1 }));
    }
    this.lampLen = beamLen;
  }
  lights(dt, cam, frame) {
    const sys = this.sys, fx = sys.fx, dark = sys.dark(this.y);
    const on = this.lampsOn;
    const k = on * (0.12 + 0.88 * dark);
    for (const b of this.beams) { b.set(k); b.update(sys.shape, sys.env.camera, cam.Oz); }
    for (const L of this.lamps) {
      this.toGlobal(L.p[0] + L.d[0] * 0.02, L.p[1] + L.d[1] * 0.02, L.p[2] + L.d[2] * 0.02, _g);
      // the flare is brightest when the lamp faces the camera
      this.toGlobalDir(L.d[0], L.d[1], L.d[2], _gd);
      const tx = cam.x - _g.x, ty = cam.y - _g.y, tz = cam.z - _g.z, tl = Math.hypot(tx, ty, tz) || 1;
      const facing = Math.max(0, (_gd.x * tx + _gd.y * ty + _gd.z * tz) / tl);
      fx.flare(_g.x, _g.y, _g.z, L.r * (2 + 3.5 * facing), 1, 0.93, 0.82, on * (0.2 + 0.5 * dark) * (0.3 + 0.7 * facing));
    }
    // pool of light on the seabed where the lamps point (every other frame)
    if (this.pool && (frame & 1) === 0) {
      const P = this._poolLamps;
      let cx = 0, cz = 0, n = 0;
      for (let i = 0; i < this.lamps.length; i++) {
        const L = this.lamps[i], q = P[i];
        this.toGlobal(L.p[0], L.p[1], L.p[2], _g); this.toGlobalDir(L.d[0], L.d[1], L.d[2], _gd);
        q.x = _g.x; q.y = _g.y; q.z = _g.z; q.dx = _gd.x; q.dy = _gd.y; q.dz = _gd.z; q.k = 9 * L.r;
        // where the beam axis meets the seabed (march)
        for (let t = 1; t <= this.lampLen; t += 1) {
          const x = q.x + q.dx * t, y = q.y + q.dy * t, z = q.z + q.dz * t;
          if (sys.floor(x, -z) >= y) { cx += x; cz += z; n++; break; }
        }
      }
      if (n && k > 0.05) {
        if (!this.pool.mesh.parent) this.root.parent.add(this.pool.mesh);
        this.pool.update(sys.shape, P, P.length, cx / n, cz / n, Math.min(9, this.lampLen * 0.55), k * 0.9);
      } else this.pool.mesh.visible = false;
    }
  }

  // meshes that join the world outside this.root (precompiled with it before the reveal)
  extras() { return this.pool ? [this.pool.mesh] : []; }

  // moving obstacle along the hull axis
  register(dt, r) {
    this.regT -= dt;
    if (this.regT > 0) return;
    this.regT = 0.25;
    const h = this.len * 0.5 - r * 0.5;
    this.toGlobal(0, 0, Math.max(0, h), _g); const ax = _g.x, ay = _g.y, as = -_g.z;
    this.toGlobal(0, 0, -Math.max(0, h), _g);
    this.sys.reg(this.h, ax, ay, as, _g.x, _g.y, -_g.z, r);
  }

  subjects(out) {
    const e = this.sub;
    e.x = this.x; e.y = this.y; e.z = this.z; e.vx = this.vx; e.vy = this.vy; e.vz = this.vz;
    out.push(e);
  }
  labels(out) {
    const l = this.lab;
    l.x = this.x; l.y = this.y + this.top + 0.6; l.z = this.z;
    out.push(l);
  }
  disposeLights() {
    for (const b of this.beams) b.dispose();
    this.beams.length = 0;
    if (this.pool) { if (this.pool.mesh.parent) this.pool.mesh.parent.remove(this.pool.mesh); this.pool.dispose(); this.pool = null; }
    this.sys.unreg(this.h);
  }
}
const _g = { x: 0, y: 0, z: 0 }, _gd = { x: 0, y: 0, z: 0 };
