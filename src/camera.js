// Camera director: follows the endless path but behaves like a curious documentary camera —
// it varies altitude within safe headroom, notices creatures and set pieces, turns to watch the
// most interesting one (with hysteresis and cooldowns), slows down for highlights, and drives
// the depth-of-field focus distance. All motion is critically damped so it never jerks.
import * as THREE from 'three';
import { noise1, smoothstep, clamp } from './noise.js';

// How much the camera wants to look at each kind of set piece (0..1).
const POI_INTEREST = {
  'whale-fall': 0.95, 'brine-pool': 0.9, 'cleaning-station': 0.8, arch: 0.8, wreck: 0.75, treasure: 0.75,
  'vent-field': 0.7, 'cave-opening': 0.7, giant: 0.65, iceberg: 0.6, statue: 0.42, ledge: 0.5,
  'wall-overhang': 0.5, 'amphora-den': 0.5, 'kelp-clearing': 0.5, 'garden-eel-field': 0.45, 'mangrove-roots': 0.4,
  bluehole: 0.7, stalactites: 0.75, flotsam: 0.7, 'champagne-vent': 0.65, pinnacle: 0.6, anemone: 0.55,
  'sargassum-raft': 0.55, 'drowned-tree': 0.5, 'limestone-notch': 0.45, 'fallen-log': 0.4, anchor: 0.6, 'lost-instrument': 0.6,
};

// critically damped spring toward target (x, v) -> mutates state object {x, v}
function spring(st, target, omega, dt) {
  const f = 1 + 2 * dt * omega, oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const x = (f * st.x + dt * st.v + hhoo * target) * det;
  st.v = (st.v + hoo * (target - st.x)) * det;
  st.x = x;
}

export class CameraDirector {
  constructor(camera, shape) {
    this.camera = camera; this.shape = shape;
    this.alt = { x: 0, v: 0 };
    this.yaw = { x: 0, v: 0 }; this.pitch = { x: 0, v: 0 };
    this.focus = { x: 12, v: 0 };
    this.speedMul = { x: 1, v: 0 };
    this.subject = null;          // { id, x, y, z, vx, vy, vz, r, interest, kind }
    this.watchTime = 0;
    this.evalTimer = 0;
    this.cooldown = new Map();    // id -> seconds remaining
    this.cands = []; this.pois = [];
    this.seen = new Set();        // set pieces already watched once (rare ones get a novelty boost)
    this.focusPos = new THREE.Vector3();
    this.hasSubject = false;
    this.curiosity = 1;           // 0 = steady forward view, 1 = documentary camera that watches things
    this._f = new THREE.Vector3(); this._d = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  // Pick the most interesting visible thing ahead. Returns null when nothing beats the wander.
  _choose(cam, sigmaG, subjectsFn, poisFn, s, Oz) {
    const c = this.cands; c.length = 0;
    if (subjectsFn) subjectsFn(c);
    if (poisFn) {
      poisFn(s + 6, s + 70, this.pois);
      for (const p of this.pois) {
        const id = 'poi:' + p.type + ':' + Math.round(p.x) + ':' + Math.round(p.s);
        const base = POI_INTEREST[p.type] ?? 0.4;
        // a rare set piece seen for the first time beats almost anything else
        const interest = base >= 0.7 && !this.seen.has(id) ? Math.min(1.6, base * 1.7) : base;
        c.push({ id, x: p.x, y: p.y + Math.min(2.5, (p.r || 3) * 0.3), z: -p.s, vx: 0, vy: 0, vz: 0, r: p.r || 3, interest, poi: true });
      }
    }
    const maxD = Math.min(60, 2.6 / Math.max(0.01, sigmaG));
    const F = this._f; let best = null, bestScore = 0, curScore = 0;
    for (const e of c) {
      const dx = e.x - cam.x, dy = e.y - cam.y, dz = (e.z - Oz) - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 3.5 || d > maxD) continue;
      const cosA = (dx * F.x + dy * F.y + dz * F.z) / d;
      if (cosA < (e.poi ? 0.08 : 0.25)) continue;                // too far off the path heading (POIs may be wider)
      if (this.cooldown.has(e.id)) continue;
      const ang = Math.pow(clamp((cosA - (e.poi ? 0.08 : 0.25)) / (e.poi ? 0.92 : 0.75), 0, 1), e.poi ? 0.8 : 1.2);
      const vis = Math.exp(-sigmaG * d * 0.7);
      const size = 0.55 + 0.45 * clamp(e.r / 1.5, 0, 1);
      const sc = e.interest * ang * vis * size;
      if (this.subject && e.id === this.subject.id) curScore = sc;
      if (sc > bestScore) { bestScore = sc; best = e; }
    }
    // hysteresis: keep watching the current subject unless something clearly better appears
    if (this.subject && curScore > 0 && (curScore > bestScore * 0.65 || this.watchTime < 4)) {
      for (const e of c) if (e.id === this.subject.id) return e;
    }
    return bestScore > 0.12 ? best : null;
  }

  /**
   * dt, time (s, unwrapped), s (travel), Oz (floating origin), sigmaG (green extinction),
   * surge 0..1, subjectsFn(out), poisFn(s0, s1, out). Returns {x, y, gz} global camera position.
   */
  update(dt, time, s, Oz, sigmaG, surge, subjectsFn, poisFn) {
    const sh = this.shape, cam = this.camera;
    const px = sh.pathX(s), py = sh.pathY(s);

    // ---- altitude mood: drift up for overviews, skim low for detail, within safe headroom ----
    const n = noise1(s / 190, 401) + 0.35 * noise1(s / 60, 402);
    let aT = n > 0 ? n * 2.6 : n * 0.7;
    const ceil = sh.ceilingAt(px, s + 4), floor = sh.floorAt(px, s + 4);
    const upLim = Math.max(0, Math.min(2.8, ceil - py - 1.8, -0.9 - py));
    const downLim = Math.min(0, Math.max(-0.6, floor + 1.9 - py));
    if (this.subject && this.subject.interest > 0.6) aT += clamp((this.subject.y - (py + this.alt.x)) * 0.25, -1, 1.2);
    aT = clamp(aT, downLim, upLim);
    spring(this.alt, aT, 0.35, dt);
    this.alt.x = clamp(this.alt.x, downLim, upLim);

    // ---- base heading along the path ----
    const la = 16, tx = sh.pathX(s + la), ty = sh.pathY(s + la);
    const gz = -s;
    const hand = 1 + 2 * surge;
    const hx = 0.1 * noise1(time / 3.1, 911) * hand + 0.35 * surge * Math.sin(time * 0.55);
    const hy = 0.08 * noise1(time / 2.7, 912) * hand + 0.18 * Math.sin(time * 0.35);
    cam.position.set(px + hx, py + this.alt.x + hy, gz - Oz);
    const F = this._f.set(tx - px, ty - py, -la).normalize();

    // ---- subject selection (a few times per second) ----
    for (const [k, v] of this.cooldown) { if (v - dt <= 0) this.cooldown.delete(k); else this.cooldown.set(k, v - dt); }
    this.evalTimer -= dt;
    if (this.evalTimer <= 0) {
      this.evalTimer = 0.4;
      const pick = this._choose(cam.position, sigmaG, subjectsFn, poisFn, s, Oz);
      if (!pick || !this.subject || pick.id !== this.subject.id) this.watchTime = 0;
      this.subject = pick ? Object.assign(this.subject && this.subject.id === pick.id ? this.subject : {}, pick) : null;
    }
    if (this.subject) {
      this.watchTime += dt;
      if (this.subject.poi && this.watchTime > 3) this.seen.add(this.subject.id);
      if (this.seen.size > 400) this.seen.clear();
      if (this.watchTime > 14) { this.cooldown.set(this.subject.id, 35); this.subject = null; this.watchTime = 0; }
    }

    // ---- gaze: blend the path heading with the subject direction ----
    let yawT = 0.2 * noise1(time / 23, 901) + 0.07 * noise1(time / 7.3, 902);
    let pitchT = 0.07 * noise1(time / 17, 903) - 0.03;
    let focusT = this._autoFocus(px, py + this.alt.x, s, F);
    let speedT = 1;
    this.hasSubject = !!this.subject;
    if (this.subject) {
      const e = this.subject;
      // lead moving subjects slightly so they stay framed
      const D = this._d.set(e.x + e.vx * 0.4 - cam.position.x, e.y + e.vy * 0.4 - cam.position.y, (e.z + e.vz * 0.4 - Oz) - cam.position.z);
      const d = D.length(); D.divideScalar(d);
      const yawS = Math.atan2(F.z * D.x - F.x * D.z, F.x * D.x + F.z * D.z); // signed angle F->D about +Y
      const pitchS = Math.asin(clamp(D.y, -1, 1)) - Math.asin(clamp(F.y, -1, 1));
      const w = smoothstep(0, 1.2, this.watchTime) * 0.8 * this.curiosity;
      yawT = yawT * (1 - w) + clamp(yawS, -0.95, 0.95) * w;
      pitchT = pitchT * (1 - w) + clamp(pitchS, -0.5, 0.45) * w;
      focusT = d;
      this.focusPos.set(e.x, e.y, e.z);
      if (e.interest >= 0.7 && d < 45) speedT = 1 - 0.5 * this.curiosity;            // linger on highlights
      else if (e.interest >= 0.5 && d < 30) speedT = 1 - 0.25 * this.curiosity;
    }
    spring(this.yaw, yawT, 1.1, dt);
    spring(this.pitch, pitchT, 1.1, dt);
    spring(this.focus, clamp(focusT, 1.5, 120), 2.2, dt);
    spring(this.speedMul, speedT, 0.45, dt);

    // ---- orientation: heading + yaw/pitch, bank into turns, handheld micro-rotation ----
    const baseYaw = Math.atan2(-F.x, -F.z), basePitch = Math.asin(clamp(F.y, -1, 1));
    const curv = tx - 2 * px + sh.pathX(s - la);
    const e = this._e;
    e.set(
      basePitch + this.pitch.x + 0.008 * noise1(time / 1.9, 913) * hand,
      baseYaw + this.yaw.x + 0.01 * noise1(time / 1.7, 914) * hand,
      clamp(curv * 0.012, -0.08, 0.08) - this.yaw.v * 0.05 + 0.012 * noise1(time / 2.3, 915) * hand + 0.03 * surge * Math.sin(time * 0.55),
      'YXZ',
    );
    cam.quaternion.setFromEuler(e);
    cam.updateMatrixWorld();
    return { x: cam.position.x, y: cam.position.y, gz };
  }

  // Distance to the seabed along the view heading (for focus when nothing is being watched).
  _autoFocus(x, y, s, F) {
    const sh = this.shape;
    for (let t = 2; t <= 40; t += 2) {
      const sx = x + F.x * t, sy = y + F.y * t - t * 0.12, ss = s - F.z * t;
      if (sh.floorAt(sx, ss) >= sy) return t;
    }
    return 30;
  }
}
