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
  bluehole: 0.85, stalactites: 0.75, flotsam: 0.7, 'champagne-vent': 0.65, pinnacle: 0.6, anemone: 0.55,
  'sargassum-raft': 0.55, 'drowned-tree': 0.5, 'limestone-notch': 0.45, 'fallen-log': 0.4, anchor: 0.6, 'lost-instrument': 0.6,
  'kelp-canopy': 0.55, plankton: 0.45, 'glow-field': 0.6, brinicle: 0.7, 'xeno-field': 0.45, 'sea-pigs': 0.6, 'glass-sponge': 0.55, 'sea-lily': 0.5,
};
// --- events 2026-11 --- (the garden's POI sits below the floor, so the camera looks down across it while it slows)
Object.assign(POI_INTEREST, { 'octopus-garden': 0.95 });
// Lost City: the landmark tower (its POI sits ~11 m above the route, so watching it tilts the view up the tower)
Object.assign(POI_INTEREST, { 'lc-tower': 0.85, 'lc-flange': 0.55 });
Object.assign(POI_INTEREST, { 'coral-summit': 0.85, 'trawl-scar': 0.6 }); // --- coldcoral ---
// --- whalefall --- the carcass: once picked it is held for the whole pass (see wfHold), the gaze travelling along it
Object.assign(POI_INTEREST, { whalefall: 1 });
// --- moments 2026-11 --- a strong sun shaft beside the route (kelp canopy gaps, cenote skylights, beams between drowned
// trunks or into a blue hole; the POI sits high in the beam): the camera slows to half speed and tilts up into it for
// 6-8 s, by day in clear weather only (lightOK, set by main.js) and at most once every 2.5-4.5 min
Object.assign(POI_INTEREST, { 'light-shaft': 0.75 });
const LIGHT_HOLD = 7;

// procedural reef-fish variants ('proc:reef:123') tire the camera as one family
const famKey = (k) => (k.charCodeAt(0) === 112 && k.startsWith('proc:') ? k.slice(0, k.indexOf(':', 5) >>> 0) : k);

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
    this.fatigue = new Map();     // species key -> recent seconds watched (decays), so one species cannot hog the camera
    this.focusPos = new THREE.Vector3();
    this.hasSubject = false;
    this.curiosity = 1;           // 0 = steady forward view, 1 = documentary camera that watches things
    this.biasYaw = 0; this.biasPitch = 0; // per-zone framing preference (set by main.js: wall face, blue-hole drop)
    // signature moments (creatures/moments.js): { w, gaze, gx, gy, gz (GLOBAL), yaw, pitch, speed, alt } or null
    this.moment = null;
    this.lightOK = true; this.lightNext = 0; this.forceLight = false; this.clock = 0; // sun-shaft pauses (light-shaft POIs)
    this._f = new THREE.Vector3(); this._d = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  // Forget the current subject and settle the springs (zone jump in place).
  reset() {
    this.subject = null; this.hasSubject = false; this.watchTime = 0; this.evalTimer = 0;
    this.cooldown.clear(); this.seen.clear(); this.fatigue.clear();
    for (const k of ['alt', 'yaw', 'pitch']) { this[k].x = 0; this[k].v = 0; }
    this.focus.x = 12; this.focus.v = 0; this.speedMul.x = 1; this.speedMul.v = 0;
    this.moment = null; this.lightNext = 0; this.forceLight = false;
  }

  // Pick the most interesting visible thing ahead. Returns null when nothing beats the wander.
  _choose(cam, sigmaG, subjectsFn, poisFn, s, Oz) {
    const c = this.cands; c.length = 0;
    if (subjectsFn) subjectsFn(c);
    if (poisFn) {
      poisFn(s + 6, s + 70, this.pois);
      for (const p of this.pois) {
        const id = 'poi:' + p.type + ':' + Math.round(p.x) + ':' + Math.round(p.s);
        if (p.type === 'light-shaft' && !(this.subject && this.subject.id === id) && !this.forceLight && !(this.lightOK && this.clock >= this.lightNext)) continue;
        const base = (POI_INTEREST[p.type] ?? 0.4) + (p.data && p.data.showpiece ? 0.15 : 0); // e.g. a ship's hull beats a dinghy
        // a rare set piece seen for the first time beats almost anything else
        const light = p.type === 'light-shaft';
        const interest = light && this.forceLight ? 1.6 : base >= 0.7 && !this.seen.has(id) ? Math.min(1.6, base * 1.7) : base;
        c.push({ id, x: p.x, y: p.y + Math.min(2.5, (p.r || 3) * 0.3), z: -p.s, vx: 0, vy: 0, vz: 0, r: p.r || 3, interest, poi: true,
          hole: p.type === 'bluehole' ? p : null, light, wf: p.type === 'whalefall' ? p : null });
      }
    }
    const maxD = Math.min(60, 2.6 / Math.max(0.01, sigmaG));
    const F = this._f; let best = null, bestScore = 0, curScore = 0;
    for (const e of c) {
      const dx = e.x - cam.x, dy = e.y - cam.y, dz = (e.z - Oz) - cam.z;
      const d = Math.hypot(dx, dy, dz);
      const dv = e.hole ? Math.max(3.6, d - e.r) : d;              // a blue hole is as near as its rim
      if (d < 3.5 || dv > maxD) continue;
      const cosA = (dx * F.x + dy * F.y + dz * F.z) / d;
      if (cosA < (e.poi ? 0.08 : 0.25)) continue;                // too far off the path heading (POIs may be wider)
      if (this.cooldown.has(e.id)) continue;
      const ang = Math.pow(clamp((cosA - (e.poi ? 0.08 : 0.25)) / (e.poi ? 0.92 : 0.75), 0, 1), e.poi ? 0.8 : 1.2);
      const vis = Math.exp(-sigmaG * dv * 0.7);
      const size = 0.55 + 0.45 * clamp(e.r / 1.5, 0, 1);
      // species fatigue: after ~30 s of the same species in the last few minutes its score halves (60 s: a fifth),
      // so the camera turns to whatever else is around, or simply glides on (sea otters, sweepers, chimaeras or
      // golden jellies had 45-85% of the watch time)
      // (animals in the middle of a highlight, interest >= 0.9, tire it half as fast: a lunge or a hunt is the show)
      const fat = e.key ? (this.fatigue.get(famKey(e.key)) || 0) / (e.interest >= 0.9 ? 60 : 30) : 0;
      const sc = e.interest * ang * vis * size / (1 + fat * fat);
      if (this.subject && e.id === this.subject.id) curScore = sc;
      if (sc > bestScore) { bestScore = sc; best = e; }
    }
    // hysteresis: keep watching the current subject unless something clearly better appears
    // (a subject the fatigue has worn below the glide threshold is let go after its first few seconds)
    if (this.subject && curScore > 0 && (curScore > bestScore * 0.65 || this.watchTime < 4) && (curScore > 0.08 || this.watchTime < 4)) {
      for (const e of c) if (e.id === this.subject.id) return e;
    }
    return bestScore > 0.12 ? best : null;
  }

  /**
   * dt, time (s, unwrapped), s (travel), Oz (floating origin), sigmaG (green extinction),
   * surge 0..1, subjectsFn(out), poisFn(s0, s1, out). Returns {x, y, gz} global camera position.
   */
  update(dt, time, s, Oz, sigmaG, surge, subjectsFn, poisFn) {
    const sh = this.shape, cam = this.camera, mo = this.moment && this.moment.w > 0.002 ? this.moment : null;
    const px = sh.pathX(s), py = sh.pathY(s);
    this.clock = time;

    // ---- altitude mood: drift up for overviews, skim low for detail, within safe headroom ----
    const n = noise1(s / 190, 401) + 0.35 * noise1(s / 60, 402);
    let aT = n > 0 ? n * 2.6 : n * 0.7;
    const ceil = sh.ceilingAt(px, s + 4), floor = sh.floorAt(px, s + 4);
    const upLim = Math.max(0, Math.min(2.8, ceil - py - 1.8, -0.9 - py));
    const downLim = Math.min(0, Math.max(-0.6, floor + 1.9 - py));
    if (this.subject && this.subject.interest > 0.6 && !this.subject.light) aT += clamp((this.subject.y - (py + this.alt.x)) * 0.25, -1, 1.2);
    if (mo) aT += (mo.alt - aT) * mo.w * this.curiosity; // a moment's own height (held low for a hunt, raised under the jellies)
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
      const decay = Math.exp(-0.4 / 150); // (fatigue fades with a ~2.5 min time constant)
      for (const [k, v] of this.fatigue) { if (v < 0.1) this.fatigue.delete(k); else this.fatigue.set(k, v * decay); }
      if (this.subject && this.subject.key) { const k = famKey(this.subject.key); this.fatigue.set(k, (this.fatigue.get(k) || 0) + 0.4); }
      // (a whale fall, once picked, is kept until the camera has passed its head: nothing else takes the view)
      const pick = this._wfHold(s) ? this.subject : this._choose(cam.position, sigmaG, subjectsFn, poisFn, s, Oz);
      if (!pick || !this.subject || pick.id !== this.subject.id) this.watchTime = 0;
      this.subject = pick ? Object.assign(this.subject && this.subject.id === pick.id ? this.subject : {}, pick) : null;
    }
    if (this.subject) {
      this.watchTime += dt;
      if (this.subject.poi && this.watchTime > 3) this.seen.add(this.subject.id);
      if (this.seen.size > 400) this.seen.clear();
      if (this.subject && this.subject.light && this.watchTime > 1) { // a sun-shaft pause started: the next one in 2.5-4.5 min
        if (this.lightNext <= time) this.lightNext = time + 150 + 120 * (0.5 + 0.5 * noise1(time / 7, 931));
        this.forceLight = false;
      }
      // a blue hole is watched until the camera is over its middle (it leaves the POI window there)
      // (a highlight, e.g. a whale or a pod at play, is followed for up to 24 s rather than dropped mid-pass)
      if (this.watchTime > (this.subject.hole ? 60 : this.subject.wf ? 150 : this.subject.light ? LIGHT_HOLD : this.subject.interest >= 0.9 ? 24 : 14)) { this.cooldown.set(this.subject.id, 35); this.subject = null; this.watchTime = 0; }
    }

    // ---- gaze: blend the path heading with the subject direction ----
    let yawT = 0.2 * noise1(time / 23, 901) + 0.07 * noise1(time / 7.3, 902) + this.biasYaw;
    let pitchT = 0.07 * noise1(time / 17, 903) - 0.03 + this.biasPitch;
    let focusT = this._autoFocus(px, py + this.alt.x, s, F);
    let speedT = 1;
    this.hasSubject = !!this.subject;
    if (this.subject) {
      const e = this.subject;
      // lead moving subjects slightly so they stay framed
      let ax = e.x + e.vx * 0.4, ay = e.y + e.vy * 0.4, az = e.z + e.vz * 0.4;
      const dS = Math.hypot(ax - cam.position.x, ay - cam.position.y, (az - Oz) - cam.position.z); // to the subject
      if (e.hole) {
        // Blue hole: from just before the rim, look down into the sinkhole at a point ~30 m below the rim on
        // the far side (pitch about -25..-35 deg while crossing the rim), then ease back to a level view ahead
        // toward the middle. u = -1 at the near rim, 0 over the centre.
        const H = e.hole, u = (s - H.s) / H.r, k1 = smoothstep(-1.9, -1.15, u), k2 = smoothstep(-0.5, 0.05, u);
        const sD = H.s + 0.2 * H.r, sL = s + 40;
        ax += (sh.pathX(sD) - ax) * k1; ay += (H.y - 25 - ay) * k1; az += (-sD - az) * k1;
        ax += (sh.pathX(sL) - ax) * k2; ay += (sh.pathY(sL) + this.alt.x - ay) * k2; az += (-sL - az) * k2;
      }
      let wfK = 1, wfYaw = 0.95;
      if (e.wf) { // whale fall: look at the body just ahead of the camera's place along it (tail first, then sweeping along
        // the flank to the head), at the height of its flank; past the head keep looking back at it a while, easing out
        // (a point 7 m ahead swung the view past the body: on some seeds it sat cut off at the edge, out of focus)
        const W = e.wf.data, u = (cam.position.x - W.cx) * W.ca + (s - W.cs) * W.sa;
        // (sunlit: from 55 m out the whole body, its middle; closer in, the part just ahead; drawn a little toward where a
        // shark is biting, tearing free or arriving: the crowd's pull, gw, eased in and out by wf_crowd.js)
        const nr = W.ring ? smoothstep(-W.L / 2 - 30, -W.L / 2 - 8, u) : 1, ut = clamp(u + 3, -W.L / 2 + 1.5, W.L / 2 - 1.5) * nr;
        ax = W.cx + W.ca * ut; ay = W.cy + 1.2; az = -(W.cs + W.sa * ut);
        if (W.gw > 0.01) {
          let gx = W.gx - ax, gy = W.gy - ay, gz = -W.gs - az;
          const gl = Math.hypot(gx, gy, gz), k = 0.55 * W.gw * Math.min(1, 7 / Math.max(gl, 1e-3));
          ax += gx * k; ay += gy * k; az += gz * k;
        }
        wfK = 1 - smoothstep(W.L / 2 + 2, W.L / 2 + 10, u); wfYaw = 1.35;
      }
      const D = this._d.set(ax - cam.position.x, ay - cam.position.y, (az - Oz) - cam.position.z);
      const d = D.length(); D.divideScalar(d);
      const yawS = Math.atan2(F.z * D.x - F.x * D.z, F.x * D.x + F.z * D.z); // signed angle F->D about +Y
      const pitchS = Math.asin(clamp(D.y, -1, 1)) - Math.asin(clamp(F.y, -1, 1));
      const w = smoothstep(0, 1.2, this.watchTime) * (e.hole || e.light ? 1 : e.wf ? wfK : 0.8) * this.curiosity;
      yawT = yawT * (1 - w) + clamp(yawS, -wfYaw, wfYaw) * w;
      pitchT = pitchT * (1 - w) + (e.light ? clamp(pitchS + 0.12, 0, 0.55) : clamp(pitchS, e.hole ? -0.62 : -0.5, 0.45)) * w; // (a sun shaft: up into the light)
      focusT = d;
      this.focusPos.set(e.x, e.y, e.z);
      // (a whale fall: only once the lamps reach it; further out it is a shadow, and the zone is slow already)
      if (e.wf && e.wf.data.ring && dS < 30) speedT = 1 - 0.6 * this.curiosity;                     // (sunlit whale fall: the crowd is the show)
      else if (e.interest >= 0.7 && dS < (e.wf ? 24 : 45)) speedT = 1 - 0.5 * this.curiosity;       // linger on highlights
      else if (e.interest >= 0.5 && dS < 30) speedT = 1 - 0.25 * this.curiosity;
    }
    if (mo) { // a signature moment (creatures/moments.js) takes the gaze and the pace by its weight
      const w = mo.w * this.curiosity;
      let my = mo.yaw, mp = mo.pitch;
      if (mo.gaze) {
        const D = this._d.set(mo.gx - cam.position.x, mo.gy - cam.position.y, (mo.gz - Oz) - cam.position.z), d = D.length();
        if (d > 0.5) {
          D.divideScalar(d);
          my = clamp(Math.atan2(F.z * D.x - F.x * D.z, F.x * D.x + F.z * D.z), -0.95, 0.95);
          mp = clamp(Math.asin(clamp(D.y, -1, 1)) - Math.asin(clamp(F.y, -1, 1)), -0.5, 0.45);
          focusT += (d - focusT) * w;
        }
      }
      yawT += (my - yawT) * w; pitchT += (mp - pitchT) * w;
      speedT = Math.min(speedT, 1 + (mo.speed - 1) * w);
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

  // Keep watching a whale fall while the camera is alongside it (from 30 m before its tail to 10 m past its head; the
  // sunlit one from 55 m out: the crowd wheeling round it is the approach).
  _wfHold(s) {
    const e = this.subject;
    if (!e || !e.wf) return false;
    const W = e.wf.data, u = (this.camera.position.x - W.cx) * W.ca + (s - W.cs) * W.sa;
    return u > -W.L / 2 - (W.ring ? 55 : 30) && u < W.L / 2 + 10;
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
