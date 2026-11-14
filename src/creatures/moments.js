// --- moments 2026-11 ---
// Signature moments: choreography and camera work with each zone's own cast (no new species, no facts on screen).
// The encounter director calls tick(c, dt) every update. While nothing is running it costs one zone lookup per
// second; each moment publishes a camera request (this.cam, read by CameraDirector.moment) and the lamp-off moment a
// lamp multiplier (sys.lampDim, applied by main.js to the auto lamps only).
//   bay hunt   biobay at night: tarpon strike a silverside ball and every dash lights the water; the camera holds
//              low and slow on it (every 2.5-4 min of night in the bay)
//   curtain    cave / sunken forest: a silverside school hangs as a curtain in a skylight's light shaft or a beam
//              between the trunks; it parts around the camera and closes behind it (every 2.5-4 min there)
//   lamps off  abyss, deep plain, vents: the auto lamps fade to near zero for ~11 s so the animals' own light fills
//              the frame, only while glowing animals are in view (every 6-10 min of zone time)
//   jelly arc  Jellyfish Lake: a 4-minute arc for the camera (into the swarm on the sunlit side, up toward the sun
//              through the bells, low over the algae, then free); the recycled swarm crowds the sunlit side
//   (the sun-shaft 'cathedral' pause is the camera's own: 'light-shaft' POIs in camera.js)
// Debug: ?event=bayhunt|curtain|lampsoff|jellyarc|cathedral|strike, or __ocean.creatures.director.triggerEvent(kind).
import { HUNTERS } from './director.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const BAY_RGB = [0.22, 0.78, 1.0]; // as Creatures._bayGlow
const LAMP_ZONES = new Set(['abyss', 'deepplain', 'vents']); // (not the hadal trench: none of its cast glows)
const CURTAIN_POI = { cave: ['cave-opening'], sunkenforest: ['light-shaft', 'drowned-tree'] };
export const MOMENT_KINDS = new Set(['bayhunt', 'curtain', 'lampsoff', 'jellyarc', 'cathedral', 'strike']);
// a species whose own light reads with the lamps off (photophores, glowing bells, lures)
const glows = (sp) => ((sp.glowMode ?? 0) > 0 && (sp.glow ?? 0) >= 0.4) || (sp.glow ?? 0) >= 0.8;

export class Moments {
  constructor(dir) {
    this.dir = dir; this.sys = dir.sys;
    // camera request: weight (eased), gaze point (GLOBAL, z = -s) or plain yaw / pitch, speed multiplier, altitude
    this.cam = { w: 0, wT: 0, gaze: false, gx: 0, gy: 0, gz: 0, yaw: 0, pitch: 0, speed: 1, alt: 0, kind: '' };
    this.sys.lampDim = 1;
    this.acc = 0; this.zone = ''; this.zw = 0;
    this.state = { kind: '', t: 0, prey: null, hunters: [], school: null, glowE: null, noted: false, dur: 0 };
    this.t = { bay: 0, curtain: 0, lamp: 0, jelly: 0 }; // zone time counters
    this.due = { bay: 50 + dir.rng() * 30, curtain: 40 + dir.rng() * 40, lamp: 150 + dir.rng() * 110 };
    this.lampWait = 0; this.force = ''; this.count = {}; this.jForce = false; this.sparkAcc = 0; this._gAcc = null;
    this._q = [];
  }

  reset() {
    this._end();
    this.cam.w = 0; this.cam.wT = 0; this.sys.lampDim = 1; this.acc = 0;
    this.t.bay = 0; this.t.curtain = 0; this.t.lamp = 0; this.t.jelly = 0; this.lampWait = 0;
  }

  _end() {
    const S = this.state;
    S.kind = ''; S.t = 0; S.prey = null; S.hunters.length = 0; S.school = null; S.glowE = null; S.noted = false;
    this.cam.wT = 0;
  }

  _note(t) { const env = this.sys.env; if (env && typeof env.note === 'function') env.note(t); }

  // Called by the director every update with time running. Returns true when it spawned something this tick.
  tick(c, dt) {
    const sys = this.sys, cam = this.cam, S = this.state;
    let spawned = false;
    if (S.kind) spawned = this._run(c, dt);
    this.acc += dt;
    if (this.acc >= 1) {
      const el = this.acc; this.acc = 0;
      const z = sys.seq.weights(c.s + 20)[0];
      this.zone = z.w >= 0.6 ? z.key : ''; this.zw = z.w;
      if (!S.kind) spawned = this._schedule(c, el) || spawned;
      if (this.zone === 'jellylake' || this.t.jelly > 0) this._jellyArc(c, el);
    }
    // ease the camera request (about 2 s in, 3 s out) and hand it to the camera director
    const k = Math.min(1, dt * (cam.wT > cam.w ? 0.55 : 0.35));
    cam.w += (cam.wT - cam.w) * k;
    if (cam.w < 0.002 && cam.wT === 0) cam.w = 0;
    const cd = sys.env && sys.env.camDirector;
    if (cd) cd.moment = cam.w > 0 ? cam : null;
    return spawned;
  }

  // ---------- scheduling (once a second) ----------
  _schedule(c, el) {
    const zone = this.zone, U = this.sys.U, night = U ? U.uNight.value : 0;
    if (this.force) { const k = this.force; this.force = ''; return this.trigger(k); }
    if (zone === 'biobay' && night > 0.5) {
      this.t.bay += el;
      if (this.t.bay >= this.due.bay && this.dir.clock - (this.dir.lastSpawn ?? 0) > 0.5) {
        if (this._bayHunt(c, false)) { this.t.bay = 0; this.due.bay = 150 + this.dir.rng() * 90; return true; }
        this.t.bay = this.due.bay - 8; // try again in a few seconds
      }
    }
    if (CURTAIN_POI[zone]) {
      this.t.curtain += el;
      if (this.t.curtain >= this.due.curtain && this._curtain(c, false)) { this.t.curtain = 0; this.due.curtain = 150 + this.dir.rng() * 90; return true; }
    }
    if (LAMP_ZONES.has(zone)) {
      this.t.lamp += el;
      if (this.t.lamp >= this.due.lamp) {
        if (this._lampsOff(c, false)) { this.t.lamp = 0; this.due.lamp = 360 + this.dir.rng() * 240; this.lampWait = 0; }
        else if ((this.lampWait += el) > 120) { this.t.lamp = 0; this.due.lamp = 60 + this.dir.rng() * 60; this.lampWait = 0; } // nothing glowing in view: later
      }
    }
    return false;
  }

  // Debug: start a moment right here (ignores zone, time of day and timers where it can). True when it started.
  trigger(kind) {
    const c = this.dir._c || this.sys.ctx;
    if (this.state.kind && kind !== 'cathedral') this._end();
    switch (kind) {
      case 'bayhunt': return this._bayHunt(c, true);
      case 'strike': return this._bayHunt(c, true, true);
      case 'curtain': return this._curtain(c, true);
      case 'lampsoff': return this._lampsOff(c, true);
      case 'jellyarc': this.t.jelly = 1; this.jForce = true; return true;
      case 'cathedral': { // the next 'light-shaft' POI is watched whatever the light and the cooldown
        const cd = this.sys.env && this.sys.env.camDirector, pois = this.sys.env && this.sys.env.pois;
        if (!cd || !pois) return false;
        const list = pois.query(c.s + 8, c.s + 160, this._q);
        if (!list.some((p) => p.type === 'light-shaft')) return false;
        cd.forceLight = true;
        return true;
      }
    }
    return false;
  }

  // ---------- the running moment (every frame) ----------
  _run(c, dt) {
    const S = this.state, cam = this.cam;
    S.t += dt;
    if (S.kind === 'hunt') {
      const pr = S.prey;
      let live = 0;
      for (const h of S.hunters) if (!h.done && h.event && h.event.type === 'strike') live++;
      if (!pr || pr.done || (!live && S.t > 3) || S.t > S.dur) { this._end(); return false; }
      cam.gaze = true; cam.gx = pr.Cx; cam.gy = pr.Cy; cam.gz = pr.anchorZ + pr.Cz;
      const d = Math.hypot(pr.Cx - c.x, pr.Cy - c.y, pr.anchorZ + pr.Cz - c.z);
      cam.wT = d < 4 ? 0.4 : 1; cam.speed = clamp(0.3 + (d - 12) * 0.035, 0.3, 0.8); cam.alt = -0.8; cam.kind = 'hunt'; // (closes in, then lingers 8-12 m off)
      if (S.bay) this._strikeGlow(dt);
      return false;
    }
    if (S.kind === 'curtain') {
      const e = S.school;
      if (!e || e.done) { this._end(); return false; }
      const gz = e.anchorZ + e.Cz, ahead = -gz - c.s, d = Math.hypot(e.Cx - c.x, e.Cy - c.y, gz - c.z);
      cam.gaze = true; cam.gx = e.Cx; cam.gy = e.Cy; cam.gz = gz; cam.alt = 0; cam.kind = 'curtain';
      cam.speed = ahead < 40 && ahead > 2 ? clamp(0.3 + (ahead - 5) * 0.025, 0.3, 0.6) : 1; // (slowest a few metres from the sheet)
      cam.wT = ahead > 7 && d < 60 ? 0.85 : 0; // inside: let the free camera pass through
      if (ahead < -6 || S.t > 90) this._end();
      return false;
    }
    if (S.kind === 'lamps') {
      const sys = this.sys, env = sys.env, L = S.dur;
      // dim over 2.5 s, hold, back over 3.5 s; the viewer's own lamp setting ends it at once
      const auto = !env || env.lampAuto !== false;
      const f = !auto ? 1 : S.t < 2.5 ? 1 - 0.97 * smooth(S.t / 2.5) : S.t < L ? 0.03 : 0.03 + 0.97 * smooth((S.t - L) / 3.5);
      sys.lampDim = f;
      const g = S.glowE;
      if (g && !g.done && g.visible) { cam.gaze = true; cam.gx = g.bounds.x; cam.gy = g.bounds.y; cam.gz = g.anchorZ + g.bounds.z; cam.wT = S.t < L ? 0.55 : 0; }
      else { cam.gaze = false; cam.yaw = 0; cam.pitch = 0; cam.wT = S.t < L ? 0.3 : 0; }
      cam.speed = 0.55; cam.alt = 0; cam.kind = 'lamps';
      if (f < 0.5) this._darkSparks(c, dt, 1 - f);
      if (!auto || S.t > L + 3.5) { sys.lampDim = 1; this._end(); }
      return false;
    }
    return false;
  }

  // ---------- bay hunt ----------
  // A silverside ball ahead (an existing school, or one gathered low over the bottom) and two to four tarpon striking it.
  _bayHunt(c, force, anyZone = false) {
    const dir = this.dir, sys = this.sys, sh = sys.shape, r = dir.rng;
    const biome = sys.seq.weights(c.s + 40)[0].key;
    let prey = null;
    for (const e of sys.enc) {
      if (e.done || e.hunted || e.fade < 0.5 || e.sp.key !== 'silverside' || e.n < 30 || (e.kind !== 'school' && e.kind !== 'mill' && e.kind !== 'bait')) continue;
      const ahead = -(e.anchorZ + e.Cz) - c.s;
      if (ahead > 14 && ahead < 45 && Math.abs(e.Cx - c.x) < 14) { prey = e; break; }
    }
    if (!prey) prey = this._gatherSilversides(c, 34 + r() * 6, (r() < 0.5 ? -1 : 1) * (2.5 + r() * 2), -0.9, 'mill', 1.5, 170);
    if (!prey) return false;
    const keys = anyZone ? HUNTERS[biome] || HUNTERS.reef : ['tarpon'];
    const hunters = this._strike(c, prey, keys, 2 + Math.floor(r() * 3));
    if (!hunters.length) { prey.done = prey.fade < 0.2 ? true : prey.done; return false; }
    const S = this.state;
    S.kind = 'hunt'; S.t = 0; S.prey = prey; S.hunters.length = 0; S.hunters.push(...hunters); S.dur = 30; S.bay = biome === 'biobay' || sys.seq.weightOf(c.s, 'biobay') > 0.3;
    const cool = dir.dcool || (dir.dcool = {}); cool.strike = dir.clock; cool.hunt = dir.clock; // (no generic strike on top of it)
    dir.lastSpawn = dir.clock;
    this.count.bayhunt = (this.count.bayhunt || 0) + 1;
    if (S.bay) this._note('Tarpon are hunting in the glow');
    return true;
  }

  // A silverside school gathered at s = c.s + ahead (lateral lat, height h relative to the path).
  _gatherSilversides(c, ahead, lat, h, kind, spacing, nWant) {
    const dir = this.dir, sys = this.sys, sp = dir.species('silverside');
    if (!sp) return null;
    while (sys.enc.length > sys.maxEnc - 6 && dir.retireOne(c));
    const plan = dir.plan(sp, c, true, sys.seq.weights(c.s + ahead), sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
    if (!plan) return null;
    const tris = sys.cache.map.get(sp.key)?.tris ?? 700;
    const n = Math.min(dir.cloud(nWant), sys.maxInstances - sys.instances - 12, Math.floor((sys.maxTris - sys.trisTotal) / tris) - 4);
    if (n < 30) return null;
    Object.assign(plan, { n, kind, route: 'hold', formation: kind === 'school' ? 'curtain' : 'ellipsoid', mood: 'calm', zone: 'mid', s0: c.s + ahead, l0: lat, h0: h,
      vs: 0, vl: kind === 'school' ? (lat >= 0 ? 0.1 : -0.1) : 0, // (a curtain heads across the route, then holds)
      spacing, noSeek: true, fadeIn: true, interest: 0.6, wobble: 0.3, latMax: 60 });
    const e = sys.spawn(sp, plan);
    if (e) { dir.seen.set(sp.key, dir.clock); e.vl = 0; }
    return e;
  }

  // Hunters strike `prey` (as the director's delight strike: circling it, members dashing through).
  _strike(c, prey, keys, nWant) {
    const dir = this.dir, sys = this.sys, sh = sys.shape, r = dir.rng, out = [];
    const sp = dir.species(keys[Math.floor(r() * keys.length)]);
    if (!sp) return out;
    while (sys.enc.length > sys.maxEnc - 2 && dir.retireOne(c));
    const plan = dir.plan(sp, c, true, sys.seq.weights(c.s + 40), sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
    if (!plan) return out;
    const ps = -(prey.anchorZ + prey.Cz);
    plan.s0 = ps + 8; plan.l0 = prey.Cx - sh.pathX(ps) + (r() < 0.5 ? -6 : 6); plan.route = 'strike'; plan.zone = 'mid';
    plan.n = Math.max(1, Math.min(nWant, sp.beh.n[1] > 20 ? 14 : 6)); plan.fadeIn = true;
    if ((plan.kind || sp.beh.kind) === 'mill') { plan.kind = 'school'; plan.formation = 'loose'; }
    const h = sys.spawn(sp, plan);
    if (!h) return out;
    prey.hunted = true;
    h.event = { type: 'strike', prey, t: 0, dur: 22 + r() * 8, a: r() * TAU, w: 0.28 * (r() < 0.5 ? 1 : -1) }; h.route = 'strike';
    dir.seen.set(sp.key, dir.clock);
    out.push(h);
    return out;
  }

  // Every dash churns the dinoflagellates: a burst of sparks along a lunging tarpon and around the fleeing fish near it.
  _strikeGlow(dt) {
    const fx = this.sys.fx, S = this.state, pr = S.prey;
    if (!fx) return;
    let budget = Math.max(8, Math.round(30 * this.sys.tierScale));
    const acc = this._gAcc || (this._gAcc = new Float32Array(16));
    let j = 0;
    for (const h of S.hunters) {
      if (h.done || h.dist > 40) { j += h.n; continue; }
      const P = h.P, V = h.V, F = h.F, az = h.anchorZ;
      for (let i = 0; i < h.n && budget > 0; i++, j++) {
        const i3 = i * 3, sp = Math.hypot(V[i3], V[i3 + 1], V[i3 + 2]), q = j & 15;
        // a sheath of light that flares with speed: ~40 sparks/s cruising at 2 m/s, ~110/s in a 3 m/s lunge
        acc[q] = Math.min(acc[q] + dt * 40 * Math.max(0, sp - 1) ** 1.5, 6);
        for (; acc[q] >= 1 && budget > 0; acc[q]--, budget--) {
          const L = h.SZ[i], t = (0.35 - fx.rnd() * 0.95) * L, a = fx.rnd() * TAU, rr = L * 0.1 * (0.6 + fx.rnd());
          const x = P[i3] + F[i3] * t - F[i3 + 2] * Math.cos(a) * rr, y = P[i3 + 1] + F[i3 + 1] * t + Math.sin(a) * rr, z = az + P[i3 + 2] + F[i3 + 2] * t + F[i3] * Math.cos(a) * rr;
          const w = 0.9 + 0.3 * fx.rnd();
          fx.glow(x, y, z, 0.045 + 0.05 * fx.rnd(), 1.1 + fx.rnd() * 0.9, BAY_RGB[0] * w, BAY_RGB[1] * w, BAY_RGB[2], 1.6, -V[i3] * 0.06, -V[i3 + 1] * 0.06, -V[i3 + 2] * 0.06);
        }
      }
    }
    if (pr && !pr.done && pr.nThreat > 0) { // the ball flaring where it splits around a hunter
      const P = pr.P, STL = pr.STL, az = pr.anchorZ;
      for (let k = 0; k < 12 && budget > 0; k++) {
        const i = Math.floor(fx.rnd() * pr.n), i3 = i * 3;
        if (STL[i] < 0.5) continue;
        budget--;
        fx.glow(P[i3], P[i3 + 1], az + P[i3 + 2], 0.02 + 0.02 * fx.rnd(), 0.8 + fx.rnd() * 0.7, BAY_RGB[0], BAY_RGB[1], BAY_RGB[2], 1.1);
      }
    }
  }

  // ---------- silverside curtain ----------
  _curtain(c, force) {
    const sys = this.sys, sh = sys.shape, dir = this.dir, env = sys.env;
    const types = CURTAIN_POI[this.zone] || (force ? ['cave-opening', 'light-shaft', 'drowned-tree'] : null);
    let p = null;
    if (types && env && env.pois) {
      const list = env.pois.query(c.s + (force ? 25 : 55), c.s + (force ? 300 : 120), this._q);
      let best = 1e9;
      for (const q of list) {
        const ti = types.indexOf(q.type);
        if (ti < 0 || Math.abs(q.x - sh.pathX(q.s)) > 10) continue;
        const sc = ti * 1000 + (q.s - c.s);
        if (sc < best) { best = sc; p = q; }
      }
    }
    if (!p && !force) return false;
    const s0 = p ? p.s : c.s + 45;
    if (p) { // (the director's own set piece at that POI is skipped: one school there)
      if (!dir.poiDone) dir.poiDone = new Map();
      dir.poiDone.set(p.type + ':' + Math.round(p.x) + ':' + Math.round(p.s), p.s);
    }
    const lat = p ? clamp((p.x - sh.pathX(s0)) * 0.4, -2, 2) : 0;
    const e = this._gatherSilversides(c, s0 - c.s, lat, 0.2, 'school', 1.25, 400);
    if (!e) return false;
    if (p) e.plan.poi = p; // (a set piece at that POI, as the director's own)
    const S = this.state;
    S.kind = 'curtain'; S.t = 0; S.school = e;
    dir.lastSpawn = dir.clock;
    this.count.curtain = (this.count.curtain || 0) + 1;
    this._note(this.zone === 'cave' || (p && p.type === 'cave-opening') ? 'Silversides hanging in the light' : 'Silversides between the trunks');
    return true;
  }

  // ---------- lamps off ----------
  _lampsOff(c, force) {
    const sys = this.sys, env = sys.env, U = sys.U;
    if (env && env.lampAuto === false) return false; // the viewer chose the lamps: their setting stands
    if (!force && U && U.uLamp && U.uLamp.value < 0.3) return false; // nothing to switch off
    // glowing animals in view, close enough to read: at least two groups, or one of five or more
    let groups = 0, members = 0, best = null, bd = 1e9;
    for (const e of sys.enc) {
      if (e.done || !e.visible || e.fade < 0.8 || e.dist > 24 || !glows(e.sp)) continue;
      groups++; members += e.n;
      if (e.dist < bd && e.dist > 3) { bd = e.dist; best = e; }
    }
    if (!(groups >= 2 || members >= 5)) return false;
    const S = this.state;
    S.kind = 'lamps'; S.t = 0; S.dur = 12.5 + this.dir.rng() * 2; S.glowE = best; // (2.5 s fade + 10-12 s dark)
    this.count.lampsoff = (this.count.lampsoff || 0) + 1;
    this._note('Lamps off');
    return true;
  }

  // the water itself sparkles as the camera drifts through it in the dark (plankton stirred by its motion)
  _darkSparks(c, dt, k) {
    const fx = this.sys.fx;
    if (!fx) return;
    this.sparkAcc = (this.sparkAcc || 0) + dt * k * 26 * this.sys.tierScale;
    const fxd = c.fx, fzd = c.fz, rx = -fzd, rz = fxd;
    while (this.sparkAcc >= 1) {
      this.sparkAcc -= 1;
      const a = fx.rnd() * TAU, r = 1 + fx.rnd() * 6, ahead = 1 + fx.rnd() * 12, lat = Math.cos(a) * r, blue = fx.rnd() < 0.8;
      fx.glow(c.x + fxd * ahead + rx * lat, c.y + Math.sin(a) * r * 0.7, c.z + fzd * ahead + rz * lat, 0.02 + fx.rnd() * 0.03, 0.5 + fx.rnd() * 0.9,
        blue ? 0.25 : 0.4, blue ? 0.7 : 1, blue ? 1 : 0.6, 1.2);
    }
  }

  // ---------- Jellyfish Lake arc ----------
  // Zone time t in a 4-minute cycle: 0-60 s drifting into the swarm on the sunlit side, 60-105 s tilted up toward the
  // sun through the bells, 105-150 s low and level over the algae (looking toward the shade), then 90 s left to the
  // documentary camera. The swarm's recycled members land on the sunlit side three times in four.
  _jellyArc(c, el) {
    const sys = this.sys, sh = sys.shape, cam = this.cam, U = sys.U;
    if (this.zone !== 'jellylake' && !this.jForce) { if (this.state.kind === '' && cam.kind === 'jelly') cam.wT = 0; this.t.jelly = 0; return; }
    if (this.state.kind) return;
    this.t.jelly += el;
    const t = this.t.jelly % 240, s = c.s;
    // sunlit side of the path (+1: right of the travel direction)
    const hx = sh.pathX(s + 2) - sh.pathX(s), hz = -2, hl = Math.hypot(hx, hz), rxv = -hz / hl, rzv = hx / hl;
    const sd = U && U.uSunDir ? U.uSunDir.value : null;
    const side = sd && Math.abs(sd.x * rxv + sd.z * rzv) > 0.02 ? Math.sign(sd.x * rxv + sd.z * rzv) : 1;
    for (const e of sys.enc) if (e.IFD) e.recSide = side * 0.3; // (0.5 + 0.3: 80% land on the sunlit side)
    const at = (ahead, lat, y) => { const ss = s + ahead; cam.gx = sh.pathX(ss) + side * lat; cam.gy = y; cam.gz = -ss; };
    cam.gaze = true; cam.kind = 'jelly';
    if (t < 60) { at(22, 6, sh.pathY(s + 22) + 0.4); cam.speed = 0.8; cam.alt = 0.3; cam.wT = 0.7 * smooth(t / 4); }
    else if (t < 105) { at(5.5, 2, -0.3); cam.speed = 0.55; cam.alt = 1.2; cam.wT = 0.9; }
    else if (t < 150) { const ss = s + 14; at(14, -4, sh.floorAt(sh.pathX(ss) - side * 4, ss) + 1.0); cam.speed = 0.75; cam.alt = -0.6; cam.wT = 0.6; }
    else { cam.wT = 0; if (this.jForce && t > 150) { this.jForce = false; } }
    // a set piece or a highlight the documentary camera is watching keeps the frame (the arc steps back)
    const cd = sys.env && sys.env.camDirector, sb = cd && cd.subject;
    if (sb && (sb.poi || sb.interest >= 0.9)) { cam.wT *= 0.2; cam.speed = 1; }
  }
}
