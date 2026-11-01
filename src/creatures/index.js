// Creatures system: procedural species, instanced encounters, behaviours and the encounter director.
// Contract: new Creatures(world, env); update(dt, time, cam); labels(out); subjects(out).
// Debug URL params: cr=<speciesKey> forces every spawn to that species; crstats=1 logs a summary every 5 s.
import * as THREE from 'three';
import { makeMaterials } from './shader.js';
import { GeoCache, Encounter } from './encounter.js';
import { Director } from './director.js';
import { commonName, FACTS } from './species.js';
import { FX } from './fx.js';
import { Separation } from './sep.js';

const _v = new THREE.Vector3();
const TAU = Math.PI * 2;
const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
// coastal waters where plankton light up at night / where shrimp eyes shine in the lamp
const NIGHT_SPARK = new Set(['reef', 'softcoral', 'wall', 'kelp', 'seagrass', 'sandflat', 'mangrove', 'tidepool', 'wreck', 'ruins', 'pelagic', 'cave']);
const SHRIMPY = new Set(['reef', 'softcoral', 'wall', 'seagrass', 'sandflat', 'mangrove', 'tidepool', 'wreck', 'ruins', 'kelp']);
const DEEP = new Set(['deepplain', 'abyss', 'vents']);

export class Creatures {
  constructor(world, env) {
    this.world = world; this.env = env;
    this.shape = env.shape; this.seq = env.seq; this.U = env.U; this.seed = env.seed | 0;
    this.mats = makeMaterials();
    this.cache = new GeoCache(96);
    this.enc = [];
    // per-tier budgets: groups (= draw calls), instances, triangles, high-detail close-up twins (extra draw calls)
    const T = { low: [0.6, 26, 1800, 260000, 3], medium: [0.85, 30, 2500, 360000, 4], high: [1, 34, 3000, 460000, 5], ultra: [1.15, 40, 3600, 600000, 8] }[env.tier] || [1, 34, 3000, 460000, 5];
    this.tierScale = T[0];
    this.maxEnc = T[1]; this.maxInstances = T[2]; this.maxTris = T[3]; this.maxNear = T[4];
    this.instances = 0; this.trisTotal = 0;
    this.nearActive = 0; this.lodQueue = new Map();
    this.forceSpecies = qs.get('cr');
    this.logStats = qs.get('crstats') === '1';
    this.fx = new FX(world, env.U);
    this.director = new Director(this);
    this.sep = new Separation(this);
    this.frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this.lastS = null; this.camSpeed = 3; this.fogD = 130;
    this.ctx = { s: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 3, Oz: 0, frustum: this.frustum, jumped: false, fx: 0, fz: -1 };
    this.stats = { enc: 0, visible: 0, instances: 0, tris: 0, ms: 0 };
    this._logT = 0; this._sparkAcc = 0; this._wakeAcc = 0; this._eyeAcc = 0;
    this._idleQueued = false;
    this._idleCb = (deadline) => {
      this._idleQueued = false;
      let k = 0;
      for (const [key, q] of this.lodQueue) { // LOD levels requested by encounters first (close passes)
        if (k >= 3 || !(deadline.timeRemaining() > 6 || (k === 0 && deadline.didTimeout))) break;
        this.lodQueue.delete(key);
        this.cache.prebuild(q.sp, q.lod); k++;
      }
      for (; k < 3 && (deadline.timeRemaining() > 8 || (k === 0 && deadline.didTimeout)); k++) {
        const sp = this.director.nextPrewarm(this.ctx);
        if (!sp) break;
        this.cache.prebuild(sp);
      }
    };
  }

  // An encounter wants a geometry level that is not built yet: build it in idle time.
  wantLod(sp, lod) { const k = sp.key + '|' + lod; if (!this.lodQueue.has(k) && this.lodQueue.size < 24) this.lodQueue.set(k, { sp, lod }); }

  // Label overlay (`i` key): one entry per visible group, anchored on a visible instance near its centre
  // (two for large schools). GLOBAL coordinates (z = -s). Notable species carry a one-line fun fact.
  labels(out) {
    const camera = this.env.camera, cp = camera.position, maxD = this.fogD * 0.7, v = _v, Oz = this.ctx.Oz;
    for (const e of this.enc) {
      if (!e.visible || e.dist > maxD || e.fade < 0.5) continue;
      const name = e._label || (e._label = commonName(e.sp)), fact = FACTS[e.sp.key];
      const b = e.bounds, step = Math.max(1, Math.floor(e.n / 40));
      let best = -1, bd = 1e9, far = -1, fd = -1;
      for (let i = 0; i < e.n; i += step) {
        v.set(e.P[i * 3], e.P[i * 3 + 1], e.anchorZ + e.P[i * 3 + 2] - Oz);
        if (!this.frustum.containsPoint(v) || v.distanceTo(cp) > maxD) continue;
        const dx = e.P[i * 3] - b.x, dy = e.P[i * 3 + 1] - b.y, dz = e.P[i * 3 + 2] - b.z, dc = dx * dx + dy * dy + dz * dz;
        if (dc < bd) { bd = dc; best = i; }
        if (dc > fd) { fd = dc; far = i; }
      }
      if (best < 0) continue;
      const lift = e.SZ[best] * (e.sp.plan === 'jelly' || e.sp.plan === 'octopus' ? 0.8 : 0.45);
      const l = { name, x: e.P[best * 3], y: e.P[best * 3 + 1] + lift, z: e.anchorZ + e.P[best * 3 + 2] };
      if (fact) l.fact = fact;
      out.push(l);
      if (e.n >= 40 && far >= 0 && fd > 36) out.push({ name, x: e.P[far * 3], y: e.P[far * 3 + 1] + lift, z: e.anchorZ + e.P[far * 3 + 2] });
    }
    return out;
  }

  // Things worth filming within ~70 m, for the documentary camera (called a few times per second).
  // GLOBAL coords (z = -s), velocity in m/s, r = body radius (m). Big animals and small groups are listed
  // one by one; schools and shoals as one subject at their centre.
  subjects(out) {
    const cp = this.env.camera.position, Oz = this.ctx.Oz;
    for (const e of this.enc) {
      if (e.done || e.fade < 0.3 || e.dist > 70) continue;
      const P = e.P, V = e.V, az = e.anchorZ, it = e.interest;
      if (e.n <= 4 || (it >= 0.65 && e.n <= 8)) {
        for (let i = 0; i < e.n; i++) {
          const x = P[i * 3], y = P[i * 3 + 1], z = az + P[i * 3 + 2];
          const dx = x - cp.x, dy = y - cp.y, dz = z - Oz - cp.z;
          if (dx * dx + dy * dy + dz * dz > 4900) continue;
          out.push({ id: e.uid * 1000 + i, x, y, z, vx: V[i * 3], vy: V[i * 3 + 1], vz: V[i * 3 + 2], r: e.SZ[i] * 0.5, interest: it });
        }
      } else {
        const b = e.bounds, z = az + b.z, dx = b.x - cp.x, dy = b.y - cp.y, dz = z - Oz - cp.z;
        if (dx * dx + dy * dy + dz * dz > 4900) continue;
        const interest = e.n >= 40 ? Math.max(0.6, it) : Math.max(it, e.n >= 15 ? 0.3 : 0.2);
        out.push({ id: e.uid * 1000 + 999, x: b.x, y: b.y, z, vx: e.Cvx || 0, vy: e.Cvy || 0, vz: e.Cvz || 0, r: Math.min(b.r * 0.6, 12), interest });
      }
    }
    return out;
  }

  spawn(sp, plan) {
    if (this.enc.length >= this.maxEnc) return null;
    const e = new Encounter(this, sp, plan);
    if (plan.host) { // hitchhikers update right after their host (the list is walked from the end)
      const k = this.enc.indexOf(plan.host);
      this.enc.splice(k < 0 ? this.enc.length : k, 0, e);
    } else this.enc.push(e);
    this.instances += e.n; this.trisTotal += e.tris;
    return e;
  }

  // Dev metric (enable with window.__crMetric = {}): fraction of frames with something worth watching
  // in frame: an instance inside the frustum within 0.6 x fog distance that projects to >= 25 px at
  // 1280x720, or a school (>= 12 in view) whose extent projects to >= 60 px.
  _measure(cam, M) {
    const camera = cam.camera, cp = camera.position;
    const K = 360 / Math.tan((camera.fov * Math.PI) / 360);
    const maxD = this.fogD * 0.6, fr = this.frustum, v = _v;
    let hit = false;
    for (const e of this.enc) {
      if (!e.visible) continue;
      // readable size: thin / translucent bodies count for less than their length
      const pl = e.sp.plan, eb = e.sp.body || {};
      const vis = pl === 'siphon' ? 0.12 : pl === 'jelly' ? 0.6 : (eb.depth ?? 0.2) < 0.08 ? 0.5 : 1;
      const step = Math.max(1, Math.floor(e.n / 48));
      let small = 0;
      for (let i = 0; i < e.n; i += step) {
        v.set(e.P[i * 3], e.P[i * 3 + 1], e.anchorZ + e.P[i * 3 + 2] - cam.Oz);
        const d = v.distanceTo(cp);
        if (d > maxD || !fr.containsPoint(v)) continue;
        const px = (e.SZ[i] * vis * K) / Math.max(d, 0.5);
        if (px >= 25) { hit = true; break; }
        if (px >= 8) small += step;
      }
      if (small >= 20) hit = true; // a school of clearly visible fish
      if (hit) break;
    }
    const key = this.seq.weights(cam.s)[0].key;
    const r = M[key] || (M[key] = { f: 0, hit: 0, ray: 0, ceph: 0, peng: 0 });
    r.f++; if (hit) r.hit++;
    // how often a ray / a cephalopod is readable in frame (>= 20 px)
    let ray = false, ceph = false, peng = false;
    for (const e of this.enc) {
      if (!e.visible) continue;
      const isRay = e.sp.mot.mode === 2, isCeph = e.sp.plan === 'squid' || e.sp.plan === 'octopus', isPeng = e.sp.key.endsWith('Penguin');
      if (!(isRay && !ray) && !(isCeph && !ceph) && !(isPeng && !peng)) continue;
      for (let i = 0; i < e.n; i++) {
        v.set(e.P[i * 3], e.P[i * 3 + 1], e.anchorZ + e.P[i * 3 + 2] - cam.Oz);
        const d = v.distanceTo(cp);
        if (d > maxD || !fr.containsPoint(v) || (e.SZ[i] * K) / Math.max(d, 0.5) < 20) continue;
        if (isRay) ray = true; else if (isCeph) ceph = true; else peng = true; break;
      }
    }
    if (ray) r.ray++; if (ceph) r.ceph++; if (peng) r.peng++;
  }

  // Bioluminescence: plankton flashing as the camera stirs the water (night on the coast, always in the
  // deep), faint glowing wakes behind fish swimming close by, and shrimp eyes shining in the lamps.
  _ambientFx(dt, c) {
    if (dt <= 0) return;
    const U = this.U, fx = this.fx, night = U.uNight.value, key = this.seq.weights(c.s)[0].key;
    const glow = U.uGlow ? U.uGlow.value : 0, lamp = U.uLamp ? U.uLamp.value : 0, tier = this.tierScale;
    const spark = Math.max(night > 0.35 && NIGHT_SPARK.has(key) ? (night - 0.35) / 0.65 : 0, DEEP.has(key) ? Math.min(1, glow) * 0.6 : 0);
    if (spark <= 0.01) return;
    const fxd = c.fx, fzd = c.fz, rx = -fzd, rz = fxd; // forward / right (horizontal)
    this._sparkAcc += dt * spark * tier * (5 + c.speed * 9);
    while (this._sparkAcc >= 1) {
      this._sparkAcc -= 1;
      const a = fx.rnd() * TAU, r = 1.2 + fx.rnd() * 5, ahead = 0.5 + fx.rnd() * 9, lat = Math.cos(a) * r;
      fx.glow(c.x + fxd * ahead + rx * lat, c.y + Math.sin(a) * r * 0.7, c.z + fzd * ahead + rz * lat, 0.025 + fx.rnd() * 0.03, 0.35 + fx.rnd() * 0.6, 0.3, 0.85, 1, 1.6);
    }
    // wakes: a few sparks shed behind fish moving near the camera
    this._wakeAcc += dt * spark * tier * 40;
    let tries = 0;
    while (this._wakeAcc >= 1 && tries++ < 8) {
      const e = this.enc[Math.floor(fx.rnd() * this.enc.length)];
      if (!e || !e.visible || e.dist > 14 || e.kind === 'colony' || e.kind === 'peek' || e.kind === 'bed') continue;
      this._wakeAcc -= 1;
      const i = Math.floor(fx.rnd() * e.n), i3 = i * 3, V = e.V, sp = Math.hypot(V[i3], V[i3 + 1], V[i3 + 2]);
      if (sp < 0.25) continue;
      const s = e.SZ[i] * 0.55;
      fx.glow(e.P[i3] - e.F[i3] * s, e.P[i3 + 1] - e.F[i3 + 1] * s, e.anchorZ + e.P[i3 + 2] - e.F[i3 + 2] * s, 0.03 + e.SZ[i] * 0.05, 1.1 + fx.rnd() * 0.6, 0.25, 0.75, 1, 0.8 * spark);
    }
    if (this._wakeAcc > 3) this._wakeAcc = 3;
    // shrimp eyes on the sea floor ahead, lit by the lamps
    if (lamp > 0.3 && night > 0.5 && SHRIMPY.has(key)) {
      this._eyeAcc += dt * 3 * tier * lamp;
      while (this._eyeAcc >= 1) {
        this._eyeAcc -= 1;
        const ahead = 5 + fx.rnd() * 10, lat = (fx.rnd() - 0.5) * 10;
        const x = c.x + fxd * ahead + rx * lat, z = c.z + fzd * ahead + rz * lat, y = this.shape.floorAt(x, -z) + 0.03;
        if (y > c.y - 0.5) continue;
        const warm = fx.rnd() < 0.6;
        fx.glint(x, y, z, 0.012 + fx.rnd() * 0.01, 8 + fx.rnd() * 6, warm ? 1 : 0.55, warm ? 0.55 : 1, warm ? 0.25 : 0.45);
      }
    }
  }

  update(dt, time, cam) {
    const t0 = performance.now();
    const c = this.ctx;
    // camera kinematics (global coordinates)
    let jumped = false;
    if (this.lastS !== null) {
      const ds = cam.s - this.lastS;
      if (Math.abs(ds) > 40) jumped = true;
      else if (dt > 0) this.camSpeed += (ds / dt - this.camSpeed) * Math.min(1, dt * 1.5);
    }
    this.lastS = cam.s;
    const f = cam.forward;
    c.s = cam.s; c.x = cam.x; c.y = cam.y; c.z = cam.z; c.Oz = cam.Oz; c.jumped = jumped;
    c.speed = Math.max(0, this.camSpeed);
    // camera velocity ~ along the forward direction projected on the path
    const fl = Math.hypot(f.x, f.z) || 1;
    c.vx = (f.x / fl) * c.speed * 0.3; c.vz = -c.speed;
    c.fx = f.x / fl; c.fz = f.z / fl;
    // view frustum in render space
    const camera = cam.camera;
    camera.updateMatrixWorld();
    this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pm);
    // fog visibility distance from the current water extinction
    const sg = this.U.uSigma.value;
    const sMin = Math.max(1e-3, Math.min(sg.x, sg.y, sg.z));
    this.fogD = Math.max(70, Math.min(190, 3.0 / sMin));

    if (dt > 0 || jumped || !this.director.primed) this.director.update(dt, c);
    let vis = 0, visTris = 0;
    for (let i = this.enc.length - 1; i >= 0; i--) {
      const e = this.enc[i];
      e.update(dt, c);
      if (e.done) {
        e.dispose();
        this.enc.splice(i, 1);
        this.instances -= e.n; this.trisTotal -= e.tris;
        continue;
      }
      if (e.visible) { vis++; visTris += e.tris + (e.nearCount ? e.nearEntry.tris * e.nearCount : 0); }
    }
    if (dt > 0) this.sep.run(c, dt); // personal space: no two animals inside each other
    this._ambientFx(dt, c);
    this.fx.update(dt, c.s);
    if (!this._idleQueued && typeof requestIdleCallback === 'function') { this._idleQueued = true; requestIdleCallback(this._idleCb, { timeout: 1500 }); }
    if (window.__crMetric) this._measure(cam, window.__crMetric);
    const st = this.stats;
    st.enc = this.enc.length; st.visible = vis; st.instances = this.instances; st.tris = visTris;
    st.ms = st.ms * 0.95 + (performance.now() - t0) * 0.05;
    if (this.logStats) {
      this._logT += dt;
      if (this._logT > 5) {
        this._logT = 0;
        console.log(`[creatures] enc ${st.enc} vis ${st.visible} inst ${st.instances} visTris ${(st.tris / 1000).toFixed(0)}k cpu ${st.ms.toFixed(2)}ms fog ${this.fogD.toFixed(0)}m fx ${this.fx.n} :: ` +
          this.enc.map((e) => `${e.sp.key}x${e.n}${e.visible ? '*' : ''}@${Math.round(e.dist)}`).join(' '));
      }
    }
  }
}
