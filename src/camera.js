// Camera director: follows the endless path but behaves like a curious documentary camera —
// it varies altitude within safe headroom, notices creatures and set pieces, turns to watch the
// most interesting one (with hysteresis and cooldowns), slows down for highlights, and drives
// the depth-of-field focus distance. The camera rides a small craft that turns, pitches and banks
// with inertia; the documentary gaze is a head turn inside it, and the viewer can drag to look around.
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

const DEG = Math.PI / 180;
// A smooth follower (the craft's heading and pitch, the pilot's head, the view's return after a look), moving like a
// vehicle: it aims for a rate (at most p.v, slow enough to brake at 0.75 p.a, and p.k times the distance near the
// target), reaches it with at most p.a of acceleration, and changes the acceleration by at most p.j per second, so
// every turn starts gently, holds a steady rate and eases out (no jolt when a target jumps; the old springs jumped
// their acceleration). vOff / aOff are the rate and acceleration of a motion this one rides on (the craft under the
// head), so that the sum stays within vTot / aTot (the head gives way).
// p.f: a critically damped pre-filter on the target (rad/s), for targets that jitter (a fish's bearing).
class Follow {
  constructor() { this.x = 0; this.v = 0; this.a = 0; this.t = { x: 0, v: 0 }; }
  reset(x = 0) { this.x = x; this.v = 0; this.a = 0; this.t.x = x; this.t.v = 0; }
  shift(d) { this.x += d; this.t.x += d; }   // move it without changing its motion
  update(target, p, dt, vOff = 0, aOff = 0, vTot = Infinity, aTot = Infinity) {
    if (!(dt > 0)) return this.x;
    if (p.f) { spring(this.t, target, p.f, dt); target = this.t.x; }
    const e = target - this.x, ae = Math.abs(e);
    let vd = Math.sign(e) * Math.min(p.v, Math.sqrt(1.5 * p.a * ae), p.k * ae);
    vd = clamp(vd, -vTot - vOff, Math.max(-vTot - vOff, vTot - vOff));
    let ad = clamp((vd - this.v) * p.r, -p.a, p.a);
    ad = clamp(ad, -aTot - aOff, Math.max(-aTot - aOff, aTot - aOff));
    this.a += clamp(ad - this.a, -p.j * dt, p.j * dt);
    this.v += this.a * dt; this.x += this.v * dt;
    return this.x;
  }
}
const wrapA = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

// --- vehicle turns 2026-11 --- The camera rides a small submersible. The craft's heading follows the route's direction
// averaged over a window ahead (wiggles shorter than ~35 m are filtered out, and the turn starts before the bend),
// through a jerk-limited follower; it banks into turns by its yaw rate times its speed, slows a little into tight
// bends, and drifts a little wide of the route line when its heading lags (bounded to LAT_MAX). Where the pilot looks
// (subjects, POIs, moments) is a separate head turn on top, slower and eased, and the two together are capped
// (VIEW_V, VIEW_A). Before: the view swung at up to 14-27 deg/s with acceleration steps of 160-190 deg/s^2 and 9-11
// yaw reversals a minute, with a bank under 5 degrees not tied to the turn.
const ROUTE_W = 32;                     // half-width (m) of the triangular window averaging the route's direction
// follower limits: rate v, acceleration a, jerk j, approach gain k (1/s), rate-loop gain r (1/s)
const CRAFT = { v: 9 * DEG, a: 3 * DEG, j: 4 * DEG, k: 1.2, r: 3 }, CRAFT_P = { v: 5 * DEG, a: 3 * DEG, j: 4 * DEG, k: 1.2, r: 3 };
const HEAD = { v: 10 * DEG, a: 5 * DEG, j: 8 * DEG, k: 0.7, r: 2.5, f: 0.6 }, HEAD_P = { v: 6 * DEG, a: 4 * DEG, j: 6 * DEG, k: 0.7, r: 2.5, f: 0.6 };
const VIEW_V = 13 * DEG, VIEW_A = 8 * DEG;   // craft + head together (the viewer's own drag is not limited)
const BANK_MAX = 15 * DEG, BANK_K = 3.2;      // roll = BANK_MAX tanh(BANK_K v w / BANK_MAX): ~10-14 deg in the tightest bends
const ROLL = { v: 6 * DEG, a: 6 * DEG, j: 20 * DEG, k: 1.6, r: 3 };
const LAT_MAX = 0.4;                          // m off the route line at most (the flight-tube rules are drawn round it)
// The viewer's look (drag to look): offsets from the craft's heading; after release it waits LOOK_IDLE s (unless
// held) and eases back to the pilot's gaze; a double tap brings it back quickly.
const LOOK_YAW = 150 * DEG, LOOK_PITCH = 70 * DEG, LOOK_IDLE = 4;
const LOOK_BACK = { v: 30 * DEG, a: 16 * DEG, j: 30 * DEG, k: 1.2, r: 3 }, LOOK_FAST = { v: 200 * DEG, a: 500 * DEG, j: 3000 * DEG, k: 5, r: 10 };

export class CameraDirector {
  constructor(camera, shape) {
    this.camera = camera; this.shape = shape;
    this.alt = { x: 0, v: 0 };
    // the pilot's head turn (where it looks, relative to the craft's heading)
    this.yaw = new Follow(); this.pitch = new Follow();
    // the craft: heading (yaw), pitch, bank, speed along the route, lateral offset from the route line
    this.craft = { init: false, s: 0, v: 3, yaw: 0, pitch: 0, roll: new Follow(), lat: 0, latRaw: 0, k: 0, H: new Follow(), P: new Follow() };
    this.heading = new THREE.Vector3(0, 0, -1); // the craft's forward direction (instruments, sonar)
    // the viewer's look: mode 'on' (drifts back), 'hold' or 'off'; yaw/pitch the current offset, w the share of the
    // pilot's own gaze it has taken over (1 while the viewer looks around, back to 0 as the view returns)
    this.look = { mode: 'on', drag: false, yaw: 0, pitch: 0, ty: 0, tp: 0, vy: 0, vp: 0, idle: 0, w: 0, back: 0, b0: 1, dt: 0, tMove: 0 };
    this._lb = { y: new Follow(), p: new Follow() };
    this._r = { yaw: 0, slope: 0 }; this._rx = new Float64Array(9);
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
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3();
  }

  // Forget the current subject and settle the springs (zone jump in place).
  reset() {
    this.subject = null; this.hasSubject = false; this.watchTime = 0; this.evalTimer = 0;
    this.cooldown.clear(); this.seen.clear(); this.fatigue.clear();
    this.alt.x = 0; this.alt.v = 0; this.yaw.reset(0); this.pitch.reset(0);
    this.craft.init = false; // re-seated on the route at the next update
    const L = this.look; L.yaw = L.pitch = L.ty = L.tp = L.vy = L.vp = 0; L.back = 0; L.w = 0; // (and the viewer's look)
    this.focus.x = 12; this.focus.v = 0; this.speedMul.x = 1; this.speedMul.v = 0;
    this.moment = null; this.lightNext = 0; this.forceLight = false;
  }

  // ---------- the viewer's look (drag to look; input in hud.js, through app in main.js) ----------
  // The view turns 1:1 under the finger; the offset is relative to the craft's heading, so it turns with the craft.
  lookStart() {
    const L = this.look;
    if (L.mode === 'off') return false;
    if (L.w < 1) { // take over the pilot's current head turn, so the view does not move under the finger
      L.yaw += this.yaw.x; L.pitch += this.pitch.x; this.yaw.reset(0); this.pitch.reset(0);
    }
    L.ty = L.yaw; L.tp = L.pitch; L.w = 1; L.back = 0; L.drag = true; L.vy = L.vp = 0; L.idle = 0;
    return true;
  }
  // dy, dp: radians (+ turns the view left / up); now: ms (for the release speed)
  lookBy(dy, dp, now) {
    const L = this.look;
    if (!L.drag) return;
    L.ty = clamp(L.ty + dy, -LOOK_YAW, LOOK_YAW); L.tp = clamp(L.tp + dp, -LOOK_PITCH, LOOK_PITCH);
    const el = (now - L.tMove) / 1000;
    if (el > 0.002 && el < 0.12) { const k = Math.min(1, el / 0.06); L.vy += (dy / el - L.vy) * k; L.vp += (dp / el - L.vp) * k; }
    else if (el >= 0.12) { L.vy = 0; L.vp = 0; }
    L.tMove = now;
  }
  // release: the view coasts on a little (inertia) unless the finger had stopped
  lookEnd(now, cancel = false) {
    const L = this.look;
    if (!L.drag) return;
    L.drag = false; L.idle = 0;
    if (cancel || now - L.tMove > 90) { L.vy = 0; L.vp = 0; }
    // (a short coast only: at 4 rad/s and 0.28 s a fast flick carried the view on by up to 64 degrees, which felt floaty)
    L.vy = clamp(L.vy, -1.6, 1.6); L.vp = clamp(L.vp, -1.2, 1.2);
  }
  // back to the pilot's gaze: quickly (double tap) or slowly (after the idle time)
  lookRecentre(fast = true) {
    const L = this.look;
    if (L.w <= 0 || L.drag) return;
    L.back = fast ? 2 : 1; L.vy = L.vp = 0; L.b0 = Math.max(Math.abs(L.yaw), Math.abs(L.pitch), 1e-3);
    this._lb.y.reset(L.yaw); this._lb.p.reset(L.pitch);
  }
  // debug / tests: set the offset at once (radians), as if dragged there and released
  lookSet(yaw, pitch = 0) {
    this.lookStart(); const L = this.look;
    L.yaw = L.ty = clamp(yaw, -LOOK_YAW, LOOK_YAW); L.pitch = L.tp = clamp(pitch, -LOOK_PITCH, LOOK_PITCH);
    L.drag = false; L.idle = 0;
  }
  // per frame with the real frame time (the look works while the dive is paused)
  lookTick(dt) {
    const L = this.look;
    L.dt = dt;
    if (!(dt > 0) || (L.w <= 0 && !L.back)) return;
    if (L.back) {
      const f = L.back === 2 ? LOOK_FAST : LOOK_BACK;
      L.yaw = L.ty = this._lb.y.update(0, f, dt); L.pitch = L.tp = this._lb.p.update(0, f, dt);
      // the pilot's own gaze takes the view back as it returns, in step with it
      L.w = Math.min(L.w, Math.max(Math.abs(L.yaw), Math.abs(L.pitch)) / L.b0);
      // the last 1.5 degrees are handed to the pilot's head, which carries on smoothly from there (the followers'
      // tails are slow)
      if (Math.max(Math.abs(L.yaw), Math.abs(L.pitch)) < 0.026) {
        this.yaw.shift(L.yaw); this.pitch.shift(L.pitch);
        L.yaw = L.pitch = L.ty = L.tp = 0; L.back = 0; L.w = 0;
      }
      return;
    }
    if (!L.drag && (L.vy || L.vp)) { // coasting after a flick
      L.ty += L.vy * dt; L.tp += L.vp * dt;
      if (Math.abs(L.ty) > LOOK_YAW) { L.ty = clamp(L.ty, -LOOK_YAW, LOOK_YAW); L.vy = 0; }
      if (Math.abs(L.tp) > LOOK_PITCH) { L.tp = clamp(L.tp, -LOOK_PITCH, LOOK_PITCH); L.vp = 0; }
      const k = Math.exp(-dt / 0.2);
      L.vy *= k; L.vp *= k;
      if (Math.abs(L.vy) + Math.abs(L.vp) < 0.01) L.vy = L.vp = 0;
    }
    const k = 1 - Math.exp(-dt / 0.04); // a touch of smoothing under the finger
    L.yaw += (L.ty - L.yaw) * k; L.pitch += (L.tp - L.pitch) * k;
    if (!L.drag) {
      L.idle += dt;
      if (L.mode !== 'hold' && L.idle > LOOK_IDLE && !L.vy && !L.vp) this.lookRecentre(false);
    }
  }

  // The route's direction around travel distance c: its slope dx/ds averaged with a triangular weight over c +- W (the
  // mean of five chords of width W), so wiggles much shorter than W cancel out; and its climb slope dy/ds. -> this._r
  _routeDir(c, W) {
    const sh = this.shape, q = W / 4;
    let sx = 0;
    const x = this._rx;
    for (let i = 0; i < 9; i++) x[i] = sh.pathX(c - W + i * q);
    for (let i = 0; i < 5; i++) sx += (x[i + 4] - x[i]) * (i === 0 || i === 4 ? 0.5 : 1);
    sx /= 4 * W;
    const r = this._r;
    r.yaw = Math.atan2(-sx, 1);
    r.slope = (sh.pathY(c + W * 0.5) - sh.pathY(c - W * 0.5)) / W;
    return r;
  }
  // Put the craft on the route, pointing along it (first frame, zone jumps).
  _seat(s) {
    const cr = this.craft, r = this._routeDir(s + 6, ROUTE_W);
    cr.init = true; cr.s = s; cr.yaw = r.yaw; cr.pitch = Math.atan(r.slope);
    cr.H.reset(cr.yaw); cr.P.reset(cr.pitch); cr.roll.reset(0); cr.lat = 0; cr.latRaw = 0; cr.k = 0;
  }

  // Focus distance along the view ray (looking around): the nearest watched candidate (animals and set pieces, from the
  // last selection), seabed or ceiling the ray meets, else 30 m.
  _viewFocus(p, d, s, Oz) {
    const sh = this.shape;
    let best = 60;
    for (const e of this.cands) {
      const rx = e.x - p.x, ry = e.y - p.y, rz = (e.z - Oz) - p.z, t = rx * d.x + ry * d.y + rz * d.z;
      if (t > 0.8 && t < best && rx * rx + ry * ry + rz * rz - t * t < e.r * e.r) best = t;
    }
    for (let t = 1.5; t < best; t *= 1.15) {
      const x = p.x + d.x * t, y = p.y + d.y * t, ss = s - d.z * t;
      if (sh.floorAt(x, ss) >= y || sh.ceilingAt(x, ss) <= y) return t;
    }
    return best < 60 ? best : 30;
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
    const cr = this.craft, L = this.look;
    // speed along the route (main.js moves s); a jump (zone change) re-seats the craft on the route
    if (!cr.init || Math.abs(s - cr.s) > 60) this._seat(s);
    else if (dt > 0) cr.v += ((s - cr.s) / dt - cr.v) * Math.min(1, dt * 2);
    cr.s = s;
    const v = Math.max(0.3, cr.v);
    const px = sh.pathX(s) + cr.lat, py = sh.pathY(s);
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

    // ---- the craft: heading and pitch with inertia ----
    // The target is the route's direction averaged over a window centred where the craft will be in ~2.8 s (the
    // follower's lag, ~1.2 s, plus ~1.5 s of anticipation), so it starts turning before a bend; the window filters out
    // the route's short wiggles.
    if (dt > 0) {
      const lead = clamp(v * 2.8, 5, 50), r = this._routeDir(s + lead, ROUTE_W), rYaw = r.yaw;
      const yT = cr.yaw + wrapA(rYaw - cr.yaw);
      // climbs and descents arc, the nose leading a little: the route's slope ahead plus the altitude mood's
      // (x1.3: the nose pitches a little more than the flight path; a target height that jumps stays out of it)
      const pT = clamp(Math.atan(r.slope + 1.3 * this.alt.v / v), -0.3, 0.3);
      cr.yaw = cr.H.update(yT, CRAFT, dt);
      cr.pitch = cr.P.update(pT, CRAFT_P, dt);
      // the bend ahead (rad/m of the averaged route): the craft slows a little into tight bends
      const yA = this._routeDir(s + lead + 12, ROUTE_W).yaw;
      cr.k = wrapA(yA - rYaw) / 12;
      // bank into the turn, by yaw rate times speed (+ yaw = turning left, + roll = left side down)
      cr.roll.update(BANK_MAX * Math.tanh(BANK_K * v * cr.H.v / BANK_MAX), ROLL, dt);
      // drift: the craft travels partly where it points, and is drawn back onto the route line (at most LAT_MAX off)
      const tY = Math.atan2(-(sh.pathX(s + 2) - sh.pathX(s - 2)), 4), slip = Math.sin(wrapA(cr.yaw - tY));
      cr.latRaw += (-0.5 * v * slip - 0.4 * cr.latRaw) * dt;
      cr.lat = LAT_MAX * Math.tanh(cr.latRaw / LAT_MAX);
    }
    const gz = -s;
    const hand = 1 + 2 * surge;
    const hx = 0.1 * noise1(time / 3.1, 911) * hand + 0.35 * surge * Math.sin(time * 0.55);
    const hy = 0.08 * noise1(time / 2.7, 912) * hand + 0.18 * Math.sin(time * 0.35);
    cam.position.set(px + hx, py + this.alt.x + hy, gz - Oz);
    const cp = Math.cos(cr.pitch);
    const F = this._f.set(-Math.sin(cr.yaw) * cp, Math.sin(cr.pitch), -Math.cos(cr.yaw) * cp); // the craft's forward
    this.heading.copy(F);

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
        // (from 55 m out the whole body, its middle; closer in, the part just ahead; drawn a little toward where a shark
        // is biting, tearing free or arriving: the crowd's pull, gw, eased in and out by wf_crowd.js)
        const nr = smoothstep(-W.L / 2 - 30, -W.L / 2 - 8, u), ut = clamp(u + 3, -W.L / 2 + 1.5, W.L / 2 - 1.5) * nr;
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
      if (e.wf) { if (dS < 30) speedT = 1 - 0.6 * this.curiosity; }                                  // (whale fall: the crowd is the show)
      else if (e.interest >= 0.7 && dS < 45) speedT = 1 - 0.5 * this.curiosity;                      // linger on highlights
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
    // the craft slows a little into tight bends and picks up again out of them
    // (cr.k: about 4 mrad/m on a typical stretch, 16 at the 95th percentile)
    speedT *= 1 - 0.18 * smoothstep(0.008, 0.02, Math.abs(cr.k));
    // While the viewer looks around (drag to look) the pilot's gaze, the moments' and the whale fall's included, is
    // suspended: the viewer wins. It comes back as the view returns (look.w eases to 0).
    const lw = 1 - L.w;
    // the pilot's head turn: slower than the old camera pan and eased, and together with the craft's own turn capped
    // at VIEW_V / VIEW_A (the head gives way)
    this.yaw.update(yawT * lw, HEAD, dt, cr.H.v, cr.H.a, VIEW_V, VIEW_A);
    this.pitch.update(pitchT * lw, HEAD_P, dt, cr.P.v, cr.P.a, VIEW_V, VIEW_A);
    spring(this.speedMul, speedT, 0.45, dt);

    // ---- orientation: the craft (heading, pitch, bank), then the head turn and the viewer's look inside it ----
    const e = this._e;
    e.set(cr.pitch, cr.yaw, cr.roll.x + 0.012 * noise1(time / 2.3, 915) * hand + 0.03 * surge * Math.sin(time * 0.55), 'YXZ');
    const q = this._q.setFromEuler(e);
    e.set(clamp(this.pitch.x + L.pitch + 0.008 * noise1(time / 1.9, 913) * hand, -1.35, 1.35),
      this.yaw.x + L.yaw + 0.01 * noise1(time / 1.7, 914) * hand, 0, 'YXZ');
    cam.quaternion.copy(q).multiply(this._q2.setFromEuler(e));
    cam.updateMatrixWorld();
    // focus: what is at the centre of the view while the viewer looks around (the subject is not in view then)
    if (L.w > 0) {
      const vd = cam.getWorldDirection(this._v);
      focusT += (this._viewFocus(cam.position, vd, s, Oz) - focusT) * L.w;
    }
    spring(this.focus, clamp(focusT, 1.5, 120), 2.2, dt > 0 ? dt : L.dt);
    return { x: cam.position.x, y: cam.position.y, gz };
  }

  // Keep watching a whale fall while the camera is alongside it (from 55 m before its tail, the crowd wheeling round it
  // is the approach, to 10 m past its head).
  _wfHold(s) {
    const e = this.subject;
    if (!e || !e.wf) return false;
    const W = e.wf.data, u = (this.camera.position.x - W.cx) * W.ca + (s - W.cs) * W.sa;
    return u > -W.L / 2 - 55 && u < W.L / 2 + 10;
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
