// One encounter = one species group = one InstancedMesh (one draw call).
// Positions are simulated relative to an anchor (global z) so float32 instance matrices
// stay precise no matter how far the journey has gone.
import * as THREE from 'three';
import { mulberry32 } from '../noise.js';
import { buildSpecies } from './build.js';
import { interestOf } from './species.js';
import { Obstacles } from '../obstacles.js';
import { bodyShape, JELLY_PAD, segSegDist } from './sep.js';

// Max terrain slope assumed by the terrain-clearance budget (blue-hole and cave walls are near vertical):
// moving `b` metres can raise the floor / lower the ceiling under any extremity by at most SLOPE * b.
// (a blue hole's wall drops 140-190 m over ~10 m: measured up to ~27:1 on the rendered mesh)
const SLOPE = 32;
const RING = 1.5; // look-around distance of the terrain budget (beyond the body's own extremities, > its 1 m cap)
const _B = new Float64Array(9); // body basis scratch (X, Y, Z columns)
const _TP = new Float64Array(16 * 5); // terrain-check samples (x, y, z, floor, roof) of up to 16 support points (sep.js SUP_MAX)

const _n = { x: 0, y: 0, s: 0 };
const _hit = { nx: 0, ny: 1, nz: 0 };   // outward normal of the closest obstacle (render-relative x, y, z)
const _push = { x: 0, y: 0, z: 0 };     // accumulated de-penetration vector
const DIRS = (() => { // 26 unit directions (cube faces, edges, corners), upward ones first
  const d = [];
  for (const y of [1, 0, -1]) for (const x of [0, 1, -1]) for (const z of [0, 1, -1]) {
    if (!x && !y && !z) continue;
    const l = Math.hypot(x, y, z); d.push(x / l, y / l, z / l);
  }
  return d;
})();
const _q = [];
// coarse bounds per obstacle (cached on the object) for cheap rejection before the exact distance
function obsBox(o) {
  if (o._bb) return o._bb;
  const r = o.r;
  const abx = o.bx - o.ax, aby = o.by - o.ay, abs = o.bs - o.as;
  return (o._bb = [Math.min(o.ax, o.bx) - r, Math.max(o.ax, o.bx) + r, Math.min(o.ay, o.by) - r, Math.max(o.ay, o.by) + r, Math.min(o.as, o.bs) - r, Math.max(o.as, o.bs) + r,
    abx, aby, abs, abx * abx + aby * aby + abs * abs]);
}

const TAU = Math.PI * 2, PH_WRAP = 200 * Math.PI;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---------- LRU geometry cache (CPU arrays persist; GPU buffers freed when unused) ----------
const geoKey = (sp, lod) => (lod ? sp.key + '|' + lod : sp.key);
export class GeoCache {
  constructor(cap = 40) { this.map = new Map(); this.cap = cap; }
  has(sp, lod = 0) { return this.map.has(geoKey(sp, lod)); }
  // Build ahead of time (idle callbacks) so spawning / LOD switches never pay for geometry generation.
  prebuild(sp, lod = 0) {
    if (this.map.has(geoKey(sp, lod))) return false;
    this.acquire(sp, lod).refs--;
    return true;
  }
  acquire(sp, lod = 0) {
    const key = geoKey(sp, lod);
    let e = this.map.get(key);
    if (e) { this.map.delete(key); this.map.set(key, e); } else {
      const g = buildSpecies(sp, lod);
      // body radius (unit length) from the body / shell vertices: used for obstacle clearance
      let br = 0;
      for (let v = 0, nv = g.pos.length / 3; v < nv; v++) {
        const part = g.g[v * 4];
        if (part === 0 || part === 10 || (part === 6 && sp.plan === 'octopus')) {
          const r = h2(g.pos[v * 3], g.pos[v * 3 + 1] * (sp.plan === 'jelly' ? 0.5 : 1));
          if (r > br) br = r;
        }
      }
      if (sp.plan === 'octopus') br *= 0.75; // arms drape over things a little
      // underside height per tenth of the body (unit coords): where remoras attach
      const belly = new Float32Array(10);
      let minY = 0, maxX = 0; // lowest point / half thickness of the body: resting animals touch the sand exactly
      for (let v = 0, nv = g.pos.length / 3; v < nv; v++) {
        const part = g.g[v * 4];
        if (part !== 0 && part !== 10) continue;
        const y = g.pos[v * 3 + 1], b = Math.min(9, Math.max(0, Math.floor((0.5 - g.pos[v * 3 + 2]) * 10)));
        if (y < belly[b]) belly[b] = y;
        if (y < minY) minY = y;
        if (Math.abs(g.pos[v * 3]) > maxX) maxX = Math.abs(g.pos[v * 3]);
      }
      e = {
        key, refs: 0, tris: g.tris, bodyR: Math.min(br, 1.2), belly, minY, maxX, shape: bodyShape(sp, g),
        index: new THREE.BufferAttribute(g.idx, 1), pos: new THREE.BufferAttribute(g.pos, 3),
        nor: new THREE.BufferAttribute(g.nor, 3), g: new THREE.BufferAttribute(g.g, 4),
      };
      this.map.set(key, e);
    }
    e.refs++;
    this._evict();
    return e;
  }
  // Dispose an encounter geometry. Shared attributes are detached first unless this was
  // the last user, in which case their GPU buffers go too (CPU data stays cached).
  release(e, geo) {
    e.refs--;
    if (e.refs > 0) {
      geo.deleteAttribute('position'); geo.deleteAttribute('normal'); geo.deleteAttribute('aG'); geo.setIndex(null);
    }
    geo.dispose();
    this._evict();
  }
  _evict() {
    if (this.map.size <= this.cap) return;
    for (const [k, e] of this.map) { if (this.map.size <= this.cap) break; if (e.refs === 0) this.map.delete(k); }
  }
}

// ---------- colour helpers ----------
function jitter(hex, r, amt) {
  let R = (hex >> 16) & 255, G = (hex >> 8) & 255, B = hex & 255;
  const v = 1 + (r() - 0.5) * 0.24 * amt;
  const h = (r() - 0.5) * 18 * amt;
  R = clamp(Math.round(R * v + h), 0, 255); G = clamp(Math.round(G * v - h * 0.3), 0, 255); B = clamp(Math.round(B * v - h * 0.7), 0, 255);
  return R * 65536 + G * 256 + B;
}
const bytes = (a, b, c) => Math.round(clamp(a, 0, 1) * 255) * 65536 + Math.round(clamp(b, 0, 1) * 255) * 256 + Math.round(clamp(c, 0, 1) * 255);

const STATIC_KINDS = new Set(['colony', 'peek', 'bed']);
const NOEVADE = new Set(['swirl', 'play', 'circle', 'curious', 'strike', 'lunge', 'majestic']);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const INST_NAMES = ['aCol', 'aCol2', 'aPat', 'aPat2', 'aMot', 'aVar', 'aVar2'];
const d0ok = (e) => e.baseSize >= 0.06 && e.kind !== 'attach' && e.fade > 0.3;
let UID = 0;
const FLOCK_KINDS = new Set(['school', 'bait', 'mill', 'solo', 'pod']);

export class Encounter {
  constructor(sys, sp, plan) {
    // Every field that is set later (by _init, behaviours, events, the LOD code or the director) is created here
    // first, in a fixed order, so all encounters share one hidden class and the per-agent loops stay monomorphic.
    this.NRM = null; this.HOME = null; this.spread = 0; this.homeX = 0; this.homeZ = 0; this.curX = 0; this.curZ = 0; this.curDir = null;
    this.R = 0; this.HB = null; this.hbI = 0; this.hbT = 0; this.DLY = null; this.obsGrid = null; this.lbd = undefined; this.lbx = 0; this.lby = 0;
    this.orbA = undefined; this.calfT = undefined; this.hunted = false; this.FLASH = null; this.AX = null; this.OCL = null; this.OCT = null; this.ALT = null;
    this.IFD = null; this.recOn = false; this.recT = 0; this.recI = 0; // recycled drift swarms: per-instance fade-in, active while in their biome
    this.fsq = 1; // pods / pairs bunch up (formation scale < 1) to pass rocks and walls
    this.threats = null; this.threatsNext = null; this.nThreat = 0; this.nThreatNext = 0;
    this.nearMesh = null; this.nearEntry = null; this.nearGeo = null; this.nearIdx = null; this.nearCount = 0; this.nearMark = null; this.nearCopy = null; this.nearAttrs = null;
    this.walk = null; this.herdX = 0; this.herdZ = 0; this.alarmR = 0; this.wf = 0; this.den = false; this.perched = null; this.perchY = null;
    this.host = null; this.HI = null; this.LOC = null; this._cx = 0; this._cy = 0; this._cz = 0; this._label = null;
    this.recheck = false; this.recheckT = 0; this.unseen = 0; this.swirling = false; this.lFloor = 0; this.lCeil = 0; this.openWater = false;
    this.dist = 0; this._mUp = false; this._aUp = false; this.obsValid = false; this.orbR = 0;
    const rng = mulberry32(plan.seed);
    this.rng = rng; this.sys = sys; this.sp = sp; this.plan = plan;
    const beh = sp.beh, n = plan.n;
    this.n = n; this.kind = plan.kind || beh.kind; this.age = 0; this.done = false; this.visible = false;
    this.fade = plan.fadeIn ? 0 : 1; this.dying = false;
    this.uid = ++UID; this.interest = plan.interest ?? interestOf(sp);
    this.anchorZ = plan.host ? plan.host.anchorZ : Math.round(-plan.s0 / 16) * 16;
    this.baseSize = sp.size[0] + (sp.size[1] - sp.size[0]) * rng();
    this.readLat = plan.readLat ?? Math.max(1.5, this.baseSize * 16);
    this.readDist = this.baseSize * (plan.n >= 20 ? 75 : 24) * (sp.plan === 'jelly' ? 0.6 : sp.plan === 'siphon' ? 0.12 : 1);
    this.route = plan.route || 'hold';
    this.maxAge = beh.kind === 'drift' || STATIC_KINDS.has(beh.kind) ? 900 : 600;

    // ---- geometry + instancing ----
    this.entry = sys.cache.acquire(sp);
    const geo = new THREE.BufferGeometry();
    geo.setIndex(this.entry.index);
    geo.setAttribute('position', this.entry.pos);
    geo.setAttribute('normal', this.entry.nor);
    geo.setAttribute('aG', this.entry.g);
    const mk = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); geo.setAttribute(k, a); return a; };
    const aCol = mk('aCol'), aCol2 = mk('aCol2'), aPat = mk('aPat'), aPat2 = mk('aPat2'), aMot = mk('aMot');
    const aVar = mk('aVar'), aVar2 = mk('aVar2');
    this.aAnim = mk('aAnim'); this.aAnim.setUsage(THREE.DynamicDrawUsage);
    this.geo = geo; this.lod = 0; this.lodGeo = [null, geo, null]; this.lodEntry = [null, this.entry, null];
    this.instAttrs = [aCol, aCol2, aPat, aPat2, aMot, aVar, aVar2];
    this.tris = this.entry.tris * n;
    const mat = sp.translucent ? sys.mats.jelly : sys.mats.opaque;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.position.set(0, 0, this.anchorZ);
    mesh.renderOrder = sp.translucent ? 3 : 1;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.name = 'creature:' + sp.key;
    mesh.castShadow = !!sys.env?.shadows && !sp.translucent;
    this.mesh = mesh;
    sys.world.add(mesh);

    // ---- per-instance appearance ----
    const vr = mulberry32(plan.variant), c = sp.col;
    // regional colour morph: the same species looks a bit different from one segment to the next
    const morph = vr() < 0.3 ? 2.6 : 1.6;
    const base = { d: jitter(c.d, vr, morph), b: jitter(c.b, vr, 0.8), p: jitter(c.p, vr, morph * 0.7), f: jitter(c.f, vr, morph), p2: jitter(c.p2 || 0, vr, 0.8), a: jitter(c.a || 0, vr, 0.7) };
    const ceph = sp.plan === 'octopus' || sp.plan === 'squid';
    const indiv = ceph ? 1.6 : sp.det === 0 || n > 20 ? 0.5 : 0.9;
    const cs = sp.cs || [0, 0.1], pat = sp.pat || [0, 1, 0], pat2 = sp.pat2 || [0, 1, 0], mot = sp.mot;
    const packed2z = bytes(sp.finEdge ?? 0, sp.finRays ?? 0.4, sp.iris ?? 0.5);
    const packed2w = bytes((cs[0] + 1) / 2, cs[1], ((sp.glowMode ?? 0) + (sp.gill === false ? 8 : 0)) / 255);
    const scaleJ = 1 + (vr() - 0.5) * 0.2;
    const roughGlow = Math.floor((sp.glow ?? 0) * 10) + clamp(sp.rough ?? 0.42, 0.02, 0.98);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      aCol.array[o] = jitter(base.d, rng, indiv); aCol.array[o + 1] = jitter(base.b, rng, indiv * 0.5);
      aCol.array[o + 2] = jitter(base.p, rng, indiv * 0.5); aCol.array[o + 3] = jitter(base.f, rng, indiv);
      aCol2.array[o] = base.p2; aCol2.array[o + 1] = base.a; aCol2.array[o + 2] = packed2z; aCol2.array[o + 3] = packed2w;
      const pj = 1 + (rng() - 0.5) * 0.12;
      aPat.array[o] = pat[0]; aPat.array[o + 1] = pat[1] * (pat[0] === 8 || pat[0] === 12 || pat[0] === 22 || pat[0] === 23 || pat[0] === 24 || pat[0] === 28 ? 1 : scaleJ * pj); aPat.array[o + 2] = pat[2]; aPat.array[o + 3] = pat2[0];
      aPat2.array[o] = pat2[1] * (pat2[0] === 3 || pat2[0] === 1 || pat2[0] === 4 || pat2[0] === 6 ? pj : 1); aPat2.array[o + 1] = pat2[2];
      aPat2.array[o + 2] = sp.sheen ?? 0.3; aPat2.array[o + 3] = roughGlow;
      aMot.array[o] = mot.mode; aMot.array[o + 1] = mot.amp * (1 + (rng() - 0.5) * 0.3); aMot.array[o + 2] = mot.waves * (1 + (rng() - 0.5) * 0.15); aMot.array[o + 3] = mot.c0;
      // individual: seed, girth, fin (or tentacle) size, pattern intensity
      aVar.array[o] = rng();
      aVar.array[o + 1] = clamp(1 + gauss(rng) * 0.05, 0.88, 1.14);
      aVar.array[o + 2] = sp.plan === 'jelly' ? 0.7 + rng() * 0.6 : clamp(1 + gauss(rng) * 0.08, 0.8, 1.22);
      aVar.array[o + 3] = rng() < 0.12 ? 0.5 + rng() * 0.3 : 0.8 + rng() * 0.2;
      // scars & fin nicks (large animals, sharks), wear / fading, barnacles, fluke ID pattern
      const big = this.baseSize > 1.1;
      aVar2.array[o] = (sp.scars ?? (big ? 0.5 : 0.1)) * (rng() < (big ? 0.65 : 0.15) ? rng() : 0);
      aVar2.array[o + 1] = rng() < 0.08 ? 0.3 + rng() * 0.5 : 0;
      aVar2.array[o + 2] = sp.barnacles ? sp.barnacles * (0.3 + rng() * 0.7) : 0;
      aVar2.array[o + 3] = sp.flukeId ? sp.flukeId * (0.7 + rng() * 0.3) : 0;
    }

    // ---- agent state ----
    this.P = new Float32Array(n * 3); this.V = new Float32Array(n * 3); this.F = new Float32Array(n * 3);
    this.SL = new Float32Array(n * 4); this.RP = new Float32Array(n * 4);
    this.SZ = new Float32Array(n); this.PH = new Float32Array(n); this.AMP = new Float32Array(n).fill(0.6);
    this.BEND = new Float32Array(n); this.BANK = new Float32Array(n);
    this.FLO = new Float32Array(n).fill(-1e4); this.CEI = new Float32Array(n).fill(1e4);
    this.OTP = new Float32Array(n).fill(-1e4); // soft floor over low rocks / coral heads under the agent (obstacle tops)
    this.EXP = kindNeedsExpose(this.kind) ? new Float32Array(n * 2) : null;
    this.STL = new Float32Array(n);          // startle level (0..1): burst swimming when the camera comes close
    this.MODE = new Uint8Array(n);           // rest / octo state machine
    this.TMR = new Float32Array(n);
    this.JET = new Float32Array(n);          // octopus jet factor (arms streaming behind)
    this.FQ = new Float32Array(n);           // individual tail-beat frequency factor
    this.OA = new Float32Array(n * 3);       // cached obstacle-avoidance steering (refreshed every 3rd frame)
    this.CLR = new Float32Array(n);          // conservative clearance budget (skip exact tests while positive)
    this.BF = new Float32Array(n);           // current tail-beat frequency (coasting frames keep the beat smooth)
    this.ACC = new Float32Array(n);          // time coasted since the last full steering step (agent LOD)
    // personal space (see sep.js): capsule centre / axis / half length / radius / mass, accumulated push
    this.SC = new Float32Array(n * 3); this.SA = new Float32Array(n * 3); this.SH = new Float32Array(n);
    this.SR = new Float32Array(n); this.SM = new Float32Array(n); this.SD = new Float32Array(n * 3);
    this.SF = new Uint8Array(n); this.SV = null; // on-floor flags, array view used by the pair loop
    this.SB = new Uint8Array(n); this.nBlk = 0;  // blocked this frame: a hard constraint undid its separation push (sep.js)
    this.SO = new Uint16Array(n); for (let i = 0; i < n; i++) this.SO[i] = i; // agents sorted along x (sweep and prune)
    this.SOI = new Uint16Array(n); this.SK = new Uint8Array(n); this.SMV = new Uint16Array(n); this.nMoved = 0; // inverse order, marks, moved list
    this.sepExt = 0; this.stepped = false; this.sepMoved = false; this.sepT = -1e9; this.sepDue = false; this.sepMg = 0; // sep.js cadence
    this.TCL = new Float32Array(n);          // terrain clearance budget of the body extremities (exact check when used up)
    this.ceilOn = false; this.terrainOn = false; this.topCap = -0.03;
    this.inspect = -1; this.inspT = 0; this.inspX = 0; this.inspY = 0; this.inspZ = 0; // one curious individual (shoals)
    this.fc = 0;
    this.bankBase = beh.side ? Math.PI / 2 : 0; // flatfish lie and swim on their side
    this.mot = sp.mot; this.browse = !!beh.browse;
    // per-agent hot paths read these instead of the (differently shaped) species / plan objects
    this.calf = !!plan.calf; this.dart = !!beh.dart; this.cork = !!beh.corkscrew; this.latMax = plan.latMax ?? 80; this.l0 = plan.l0 ?? 0;
    // fast movers check obstacles every frame (no staggered look-ahead, no coasting near obstacles) and are
    // clamped under the ceiling (ice, cave roofs) every frame
    this.fast = (beh.speed ? beh.speed[1] : 0) >= 1.8 || beh.zone === 'surface' || beh.zone === 'ceiling';
    this.glides = mot.mode !== 4 && sp.plan !== 'octopus' && this.kind !== 'bait' && this.kind !== 'mill';
    for (let i = 0; i < n; i++) {
      // realistic size spread with occasional juveniles and big adults
      let f = n > 1 ? Math.exp(gauss(rng) * 0.09) : 1;
      if (n > 1) { const r = rng(); if (r < 0.07) f = 0.55 + rng() * 0.2; else if (r > 0.97) f = 1.2 + rng() * 0.2; }
      if (sp.plan === 'jelly') f *= 0.8 + rng() * 0.45;
      this.SZ[i] = this.baseSize * f;
      this.FQ[i] = 0.85 + rng() * 0.3;
      this.PH[i] = rng() * TAU;
      for (let k = 0; k < 4; k++) this.RP[i * 4 + k] = rng();
    }
    this.speed = beh.speed ? beh.speed[0] + (beh.speed[1] - beh.speed[0]) * rng() : 0.3;
    // group mood: calm (slow, spread out), feeding (busy), alert (tight, quick, skittish)
    this.mood = plan.mood || 'calm';
    this.speed *= this.mood === 'calm' ? 0.8 : this.mood === 'alert' ? 1.25 : 1.05;
    this.moodSpacing = this.mood === 'calm' ? 1.15 : this.mood === 'alert' ? 0.72 : 1;
    if (plan.sleepy) this.speed *= 0.45; // diurnal fish after dark: slow, close to the bottom
    this.alertR = this.mood === 'alert' ? 1.5 : 0;
    this.evade = ['side', 'side', 'dive', 'rise'][Math.floor(rng() * 4)]; this.evH = 0;
    this.maxPitch = mot.mode === 1 || mot.mode === 2 ? 0.35 : mot.mode === 3 ? 0.7 : 0.5;
    this.turnRate = clamp(3.2 / Math.sqrt(this.baseSize + 0.2), 0.5, 6);
    this.surfY = beh.zone === 'surface' || beh.zone === 'ceiling' ? -0.35 - this.baseSize * 0.1 : -0.8 - this.baseSize * 0.35;
    if (beh.skim) this.surfY = -0.1; // crocodiles cruise with the back just under the surface
    // highest point any part of the body may reach (crocodile backs and porpoising mammals break the surface)
    this.topCap = beh.skim ? 0.3 : (beh.zone === 'surface' || beh.zone === 'ceiling') && (mot.mode === 1 || mot.mode === 3) ? 0.12 : -0.03;
    this.mFloor = sp.plan === 'jelly' ? Math.max(1, 0.25 + this.baseSize * 2.5) : 0.25 + this.baseSize * 0.35; // jellies never settle on the sand
    // extra terrain margin: a pulsing bell's rim is only coarsely covered by the support points; a siphonophore's stem
    // undulates by ~mot.amp of its length in the shader
    this.tPad = sp.plan === 'jelly' ? JELLY_PAD : sp.plan === 'siphon' ? sp.mot.amp * 1.3 * this.baseSize : 0;
    this.mCeil = beh.skim ? 0.05 : 0.3 + this.baseSize * 0.3;
    // camera bubble (centre distance): no part of the body comes within ~1.5 m of the lens (jellies: tentacles too)
    // (bells without a fringe of long tentacles, like the lake's golden jellies, may drift much closer)
    this.hardR = sp.plan === 'jelly' ? (sp.jelly.nT ? 1.8 + this.baseSize * (0.6 + 0.5 * (sp.jelly.tl ?? 0)) : 1.0 + this.baseSize * (0.6 + 0.5 * (sp.jelly.ol ?? 0))) : 1.5 + this.baseSize * 0.55;
    this.rr = 0;
    this.bounds = { x: 0, y: 0, z: 0, r: 1 };
    this.obs = []; this.obsFrame = Math.floor(rng() * 3); // staggered refresh across groups
    this.rbU = this.entry.bodyR || 0.2;
    this.elong = !['jelly', 'octopus', 'seahorse', 'dumbo', 'cassiopea'].includes(sp.plan);
    this.SPIN = beh.corkscrew || sp.mot.mode === 2 ? new Float32Array(n) : null; // barrel rolls / corkscrews
    this.worstPen = 0; this.regCount = -1; this.simSkip = 0; this.simAcc = 0;
    this.event = null; this.threats = null; this.nThreat = 0; this.lookCam = 0;
    if (this.kind === 'school') { this.HB = new Float32Array(64); this.hbI = 0; this.hbT = 0; this.DLY = new Uint8Array(n); }
    this.matrixDirty = true;
    this._init(plan);
  }

  // ======================================================================
  _init(plan) {
    const { sys, n, rng, sp } = this, sh = sys.shape, beh = sp.beh;
    let s0 = plan.s0, x0 = sh.pathX(s0) + plan.l0;
    if (plan.orbit) { const O = plan.orbit, a = O.a0 ?? 0; s0 = O.s + Math.sin(a) * O.r; x0 = O.x + Math.cos(a) * O.r; plan.h0 = O.y - sh.pathY(s0); plan.l0 = x0 - sh.pathX(s0); }
    this.zone = plan.zone || beh.zone || 'mid';
    if (this.zone === 'floor' && sh.pathY(s0) - sh.floorAt(x0, s0) > 30) this.zone = 'mid';
    if ((this.kind === 'shoal' || this.kind === 'hover') && this.zone === 'floor' && !plan.noSeek) {
      // reef fish gather around structure: prefer the highest nearby floor point (coral heads, rocks)
      let best = sh.floorAt(x0, s0), bx = x0, bs = s0;
      for (let k = 0; k < 6; k++) {
        const x = x0 + (rng() - 0.5) * Math.min(4, (plan.readLat ?? 4) * 0.8), s = s0 + (rng() - 0.5) * 10, f = sh.floorAt(x, s);
        if (f > best && Math.abs(x - sh.pathX(s)) > 1.5) { best = f; bx = x; bs = s; }
      }
      x0 = bx; s0 = bs;
    }
    const z0 = -s0 - this.anchorZ;
    const P = this.P, V = this.V, F = this.F, SL = this.SL;
    // leader (path-relative)
    this.ls = s0; this.ll = plan.l0; this.lh = plan.h0 ?? 0; this.alt = plan.alt ?? 1;
    this.vs = plan.vs ?? 0; this.vl = plan.vl ?? 0; this.route = plan.route || 'hold';
    const wr = plan.wseed ? mulberry32(plan.wseed) : rng; // mixed-species groups share the same leader motion
    this.wA = plan.wobble ?? 0; this.wF = 0.03 + wr() * 0.05; this.wP = wr() * TAU;
    if (plan.evade) this.evade = plan.evade;
    this.escortT = 15 + rng() * 25; this.side = plan.l0 >= 0 ? 1 : -1;
    this.leadA = plan.leadA ?? 15; this.leadT = plan.leadT ?? 20; this.vh = plan.vh || 0;
    this.maxSwim = Math.max((beh.speed?.[1] ?? 1) * 2.2, 4.2); // lead groups must be able to keep pace with the camera
    const fl0 = sh.floorAt(x0, s0), ce0 = Math.min(sh.ceilingAt(x0, s0), 0);
    this.Cx = x0; this.Cz = z0;
    this.Cy = this._zoneY(x0, s0, fl0, ce0, 0);
    this.Cvx = 0; this.Cvy = 0; this.Cvz = 0; this.psi = Math.atan2(plan.vl ?? 0, -(plan.vs ?? 0)) || 0;
    if (Math.abs((plan.vs ?? 0)) + Math.abs(plan.vl ?? 0) < 0.05) this.psi = rng() * TAU;
    // a mixed-species companion (director mixWith) shares the primary group's formation: same heading frame, and (mills)
    // the same swimming speed, so its rings turn in step with the primary's instead of overtaking through its fish
    const mx = plan.mixOf && plan.mixOf.kind === this.kind && !plan.mixOf.done ? plan.mixOf : null;
    if (mx) { this.psi = mx.psi; if (this.kind === 'mill' || this.kind === 'bait') this.speed = mx.speed; }
    this.cvx = Math.sin(this.psi); this.cvz = Math.cos(this.psi);
    if (this.HB) for (let k = 0; k < 32; k++) { this.HB[k * 2] = this.cvx; this.HB[k * 2 + 1] = this.cvz; }
    const kind = this.kind;
    const size = this.baseSize;
    if (plan.calf && n >= 2) this.SZ[1] = this.SZ[0] * 0.33; // humpback mother and calf
    if (FLOCK_KINDS.has(kind)) {
      const spacing = size * (kind === 'pod' ? 2.6 : kind === 'solo' ? 1.5 : kind === 'bait' ? 2.0 : 1.9) * (kind === 'bait' ? 1 : this.moodSpacing) * (plan.spacing ?? beh.spacing ?? 1);
      const FORM = { ellipsoid: [0.85, 0.42, 1.4], ball: [0.8, 0.8, 0.8], ribbon: [0.35, 0.3, 2.6], wall: [2.0, 1.1, 0.3], loose: [1.6, 0.7, 2.1], column: [0.5, 2.2, 0.5] };
      const iceAbove = sh.hasCeiling(s0);
      const fm = FORM[plan.formation] || FORM.ellipsoid;
      const R = spacing * Math.cbrt(n) * (kind === 'bait' ? 0.75 : 0.95);
      this.R = R;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (kind === 'bait' || kind === 'mill') {
          let r = R * (kind === 'mill' ? 0.45 + 0.55 * Math.sqrt(rng()) : 0.25 + 0.75 * Math.cbrt(rng()));
          if (plan.route === 'swirl') r = this.hardR + 1.2 + rng() * Math.max(2.5, R * 0.6);
          if (plan.ringMin) r = plan.ringMin + R * 0.6 * Math.sqrt(rng()); // around a landmark: the ring clears it
          SL[o] = r; SL[o + 1] = rng() * TAU;
          const hh = plan.route === 'swirl' ? 1.6 : kind === 'mill' ? R * 1.3 : Math.sqrt(Math.max(0, R * R - r * r)) * 0.9;
          SL[o + 2] = (rng() * 2 - 1) * hh;
          // one swimming speed for all: the angular speed depends on the radius only, so fish on the same ring never
          // overtake (and collide with) each other; rings at different radii shear past without touching
          SL[o + 3] = this.speed / Math.max(r, 0.3);
        } else if (kind === 'pod') {
          const a = rng() * TAU, r = i === 0 ? 0 : spacing * (0.45 + Math.sqrt(rng()) * Math.sqrt(n) * 0.35);
          SL[o] = Math.cos(a) * r; SL[o + 1] = (rng() - 0.5) * size * (this.zone === 'surface' ? 0.8 : 1.6); SL[o + 2] = Math.sin(a) * r - r * 0.3;
          if (plan.calf && i === 1) { SL[o] = -size * 0.42; SL[o + 1] = size * 0.12; SL[o + 2] = size * 0.12; } // tucked in by the mother's flipper
        } else if (kind === 'solo') {
          // a pair or trio of big animals travels in a loose echelon, never on one spot (no stacked mantas)
          const k = Math.ceil(i / 2), sd = i & 1 ? 1 : -1;
          SL[o] = i ? sd * spacing * (0.9 + 0.3 * rng()) * k : 0; SL[o + 1] = i ? (rng() - 0.5) * size * 0.3 : 0; SL[o + 2] = i ? -spacing * (0.4 + 0.4 * rng()) * k : 0;
        } else {
          let x, y, z; do { x = rng() * 2 - 1; y = rng() * 2 - 1; z = rng() * 2 - 1; } while (x * x + y * y + z * z > 1);
          const ps = 0.85 + rng() * 0.3; // personal spacing
          SL[o] = x * R * fm[0] * ps; SL[o + 1] = y * R * fm[1] * ps; SL[o + 2] = z * R * fm[2] * ps;
        }
        const t = this._slotTarget(i, 0);
        P[i * 3] = t[0] + (rng() - 0.5) * size; P[i * 3 + 1] = t[1]; P[i * 3 + 2] = t[2] + (rng() - 0.5) * size;
        if (plan.calf) { P[i * 3] = t[0]; P[i * 3 + 2] = t[2]; }
        if (iceAbove) { // start under the ice / cave roof, never inside it
          const top = Math.min(sh.ceilingAt(P[i * 3], -(P[i * 3 + 2] + this.anchorZ)), 0) - this.SZ[i] * Math.max(-this.entry.minY, 0.04) - 0.06;
          if (P[i * 3 + 1] > top) P[i * 3 + 1] = top;
        }
        const hx = kind === 'bait' || kind === 'mill' ? -Math.sin(SL[o + 1]) : this.cvx, hz = kind === 'bait' || kind === 'mill' ? Math.cos(SL[o + 1]) : this.cvz;
        F[i * 3] = hx; F[i * 3 + 1] = 0; F[i * 3 + 2] = hz;
        V[i * 3] = hx * this.speed; V[i * 3 + 2] = hz * this.speed;
      }
      // a companion's slots also keep clear of the primary's (fixed), which fill the same formation volume
      const ms = mx ? mx.entry.shape : null, mD = mx ? (size * (2 * this.entry.shape.r + this.entry.shape.h + 0.15) + mx.baseSize * (2 * ms.r + ms.h + 0.15)) * 0.525 : 0;
      if (kind !== 'bait' && kind !== 'mill' && (n > 1 || mx) && n <= 160 && !plan.calf) {
        // spread the formation slots so neighbours never start inside each other (nor fight the separation pass)
        const bs = this.entry.shape, minD = size * (2 * bs.r + bs.h + 0.15) * 1.05;
        for (let it = 0; it < 5; it++) {
          let moved = false;
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            const a = i * 4, b = j * 4;
            let dx = SL[b] - SL[a], dy = SL[b + 1] - SL[a + 1], dz = SL[b + 2] - SL[a + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= minD * minD) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-4) { dx = rng() - 0.5; dy = (rng() - 0.5) * 0.3; dz = rng() - 0.5; d = h3(dx, dy, dz) || 1; }
            const k = (minD - d) * 0.5 / d;
            SL[a] -= dx * k; SL[a + 1] -= dy * k; SL[a + 2] -= dz * k; SL[b] += dx * k; SL[b + 1] += dy * k; SL[b + 2] += dz * k;
            moved = true;
          }
          if (mx) for (let i = 0; i < n; i++) for (let j = 0; j < mx.n; j++) {
            const a = i * 4, b = j * 4;
            let dx = SL[a] - mx.SL[b], dy = SL[a + 1] - mx.SL[b + 1], dz = SL[a + 2] - mx.SL[b + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= mD * mD) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-4) { dx = rng() - 0.5; dy = (rng() - 0.5) * 0.3; dz = rng() - 0.5; d = h3(dx, dy, dz) || 1; }
            const k = (mD - d) / d;
            SL[a] += dx * k; SL[a + 1] += dy * k; SL[a + 2] += dz * k;
            moved = true;
          }
          if (!moved) break;
        }
        for (let i = 0; i < n; i++) { const t = this._slotTarget(i, 0); P[i * 3] = t[0]; P[i * 3 + 1] = t[1]; P[i * 3 + 2] = t[2]; }
      } else if ((kind === 'bait' || kind === 'mill') && (n > 1 || mx) && n <= 200) {
        // ring slots too: relaxed apart in 3D (cos a r, h, sin a r), then back to radius / angle / height
        const bs = this.entry.shape, minD = size * (2 * bs.r + bs.h + 0.15) * 1.05, X = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const o = i * 4; X[i * 3] = Math.cos(SL[o + 1]) * SL[o]; X[i * 3 + 1] = SL[o + 2]; X[i * 3 + 2] = Math.sin(SL[o + 1]) * SL[o]; }
        const MX = mx ? new Float32Array(mx.n * 3) : null; // the primary's ring slots (fixed)
        if (mx) for (let j = 0; j < mx.n; j++) { const o = j * 4; MX[j * 3] = Math.cos(mx.SL[o + 1]) * mx.SL[o]; MX[j * 3 + 1] = mx.SL[o + 2]; MX[j * 3 + 2] = Math.sin(mx.SL[o + 1]) * mx.SL[o]; }
        for (let it = 0; it < 5; it++) {
          let moved = false;
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            const a = i * 3, b = j * 3;
            let dx = X[b] - X[a], dy = X[b + 1] - X[a + 1], dz = X[b + 2] - X[a + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= minD * minD) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-4) { dx = rng() - 0.5; dy = (rng() - 0.5) * 0.3; dz = rng() - 0.5; d = h3(dx, dy, dz) || 1; }
            const k = (minD - d) * 0.5 / d;
            X[a] -= dx * k; X[a + 1] -= dy * k; X[a + 2] -= dz * k; X[b] += dx * k; X[b + 1] += dy * k; X[b + 2] += dz * k;
            moved = true;
          }
          if (MX) for (let i = 0; i < n; i++) for (let j = 0; j < mx.n; j++) {
            const a = i * 3, b = j * 3;
            let dx = X[a] - MX[b], dy = X[a + 1] - MX[b + 1], dz = X[a + 2] - MX[b + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= mD * mD) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-4) { dx = rng() - 0.5; dy = (rng() - 0.5) * 0.3; dz = rng() - 0.5; d = h3(dx, dy, dz) || 1; }
            const k = (mD - d) / d;
            X[a] += dx * k; X[a + 1] += dy * k; X[a + 2] += dz * k;
            moved = true;
          }
          if (!moved) break;
        }
        for (let i = 0; i < n; i++) {
          const o = i * 4, i3 = i * 3, r = Math.max(plan.ringMin || 0.3, h2(X[i3], X[i3 + 2]));
          SL[o] = r; SL[o + 1] = Math.atan2(X[i3 + 2], X[i3]); if (SL[o + 1] < 0) SL[o + 1] += TAU; SL[o + 2] = X[i3 + 1]; SL[o + 3] = this.speed / r;
          const t = this._slotTarget(i, 0); P[i3] = t[0]; P[i3 + 1] = t[1]; P[i3 + 2] = t[2];
          const hx = -Math.sin(SL[o + 1]), hz = Math.cos(SL[o + 1]);
          F[i3] = hx; F[i3 + 1] = 0; F[i3 + 2] = hz; V[i3] = hx * this.speed; V[i3 + 1] = 0; V[i3 + 2] = hz * this.speed;
        }
      }
      if (this.DLY) { // turn waves: fish further back pick up a change of heading later
        let zmax = -1e9; for (let i = 0; i < n; i++) zmax = Math.max(zmax, SL[i * 4 + 2]);
        const vw = Math.max(1.5, this.speed * 3);
        for (let i = 0; i < n; i++) this.DLY[i] = Math.min(31, Math.round((zmax - SL[i * 4 + 2]) / vw / 0.1));
      }
    } else if (kind === 'shoal' || kind === 'hover') {
      // aggregations are tighter for small fish: radius ~ sqrt(n) body lengths
      const spread = plan.spread ?? (beh.loose ? beh.spread : Math.min(beh.spread ?? 4, Math.max(1.2, Math.sqrt(n) * size * 3.5)));
      this.spread = spread; this.homeX = x0; this.homeZ = z0;
      const am = plan.altMul ?? 1, alt = (beh.alt || [0.5, 2]).map((a) => a * am);
      for (let i = 0; i < n; i++) {
        const a = rng() * TAU, r = plan.ring ? plan.ring * (0.92 + 0.16 * rng()) : Math.sqrt(rng()) * spread;
        const hx = x0 + Math.cos(a) * r, hz = z0 + Math.sin(a) * r * (plan.ring ? 1 : 1.4);
        this._setHome(i, hx, hz, alt[0] + (alt[1] - alt[0]) * rng(), plan, true);
        P[i * 3] = SL[i * 4]; P[i * 3 + 1] = SL[i * 4 + 1]; P[i * 3 + 2] = SL[i * 4 + 2];
        const h = rng() * TAU; F[i * 3] = Math.sin(h); F[i * 3 + 2] = Math.cos(h);
        this.RP[i * 4 + 3] = 5 + rng() * 25; // relocation timer
      }
    } else if (kind === 'drift') {
      const spread = beh.spread ?? 20;
      for (let i = 0; i < n; i++) {
        const x = x0 + (rng() - 0.5) * spread, z = z0 + (rng() - 0.5) * spread * 1.6;
        const s = -(z + this.anchorZ), fl = sh.floorAt(x, s), ce = Math.min(sh.ceilingAt(x, s), 0);
        const lo = fl + this.mFloor, hi = Math.min(ce - this.mCeil, this.surfY);
        if (beh.alt) { if (!this.ALT) this.ALT = new Float32Array(n); this.ALT[i] = beh.alt[0] + (beh.alt[1] - beh.alt[0]) * rng(); }
        const yt = beh.alt ? fl + this.ALT[i] : sh.pathY(s) + (plan.h0 ?? 0) + (rng() - 0.5) * spread * 0.6;
        const y = hi > lo ? clamp(yt, lo, hi) : (lo + hi) / 2;
        P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
        if (P[i * 3 + 1] < lo) P[i * 3 + 1] = lo;
        // bells face up; a siphonophore's long axis is its heading, and it trails out nearly level
        const sip = sp.plan === 'siphon', a = sip ? rng() * TAU : 0;
        let hx = sip ? Math.cos(a) : (rng() - 0.5) * 0.8, hy = sip ? 0.12 : 1, hz = sip ? Math.sin(a) : (rng() - 0.5) * 0.8; const l = h3(hx, hy, hz);
        F[i * 3] = hx / l; F[i * 3 + 1] = hy / l; F[i * 3 + 2] = hz / l;
        this.FLO[i] = lo; this.CEI[i] = hi;
      }
      this.curX = (rng() - 0.5) * 0.08; this.curZ = (rng() - 0.5) * 0.08;
      if (plan.recycle) { this.IFD = new Float32Array(n).fill(1); this.recOn = true; }
    } else if (kind === 'colony') {
      const spread = beh.spread ?? 5;
      const ca = rng() * TAU; this.curDir = [Math.cos(ca), 0, Math.sin(ca)];
      for (let i = 0; i < n; i++) {
        const [x, z] = this._spaced(i, () => { const a = rng() * TAU, r = Math.sqrt(rng()) * spread; return [x0 + Math.cos(a) * r, z0 + Math.sin(a) * r]; }, 0.06, Math.max(0.22, this.SZ[i] * 0.4), SL, 4);
        const s = -(z + this.anchorZ);
        SL[i * 4] = x; SL[i * 4 + 1] = sh.floorAt(x, s) - 0.02; SL[i * 4 + 2] = z;
        SL[i * 4 + 3] = 0.35 + 0.35 * rng();
        this.EXP[i * 2] = SL[i * 4 + 3]; this.EXP[i * 2 + 1] = SL[i * 4 + 3];
      }
    } else if (kind === 'peek') {
      for (let i = 0; i < n; i++) {
        // pick the steepest of a few nearby floor points (a rock face)
        let best = null;
        for (let k = 0; k < 10; k++) {
          const x = x0 + (rng() - 0.5) * 6, z = z0 + (rng() - 0.5) * 6, s = -(z + this.anchorZ);
          let crowd = false; // never two in one spot: keep well over a body length apart (both lean out of the rock)
          for (let j = 0; j < i; j++) if (h2(SL[j * 4] - x, SL[j * 4 + 2] - z) < this.SZ[i] * 1.3) { crowd = true; break; }
          if (crowd && k < 9) continue;
          const nn = sh.floorNormal(x, s), steep = 1 - nn.y;
          if (!best || steep > best.steep) best = { x, z, s, nn, steep };
        }
        let nn = best.nn;
        const reg = this.sys.env && this.sys.env.obstacles;
        if (reg && reg.count) { // prefer the foot of a nearby rock: emerge beside it, facing out
          reg.query(best.x, best.s, 6, _q);
          let bo = null, bd = 1e9;
          for (const o of _q) { const d = Obstacles.dist(o, best.x, sh.floorAt(best.x, best.s), best.s, _n); if (d < bd) { bd = d; bo = o; } }
          if (bo) {
            const fy = sh.floorAt(best.x, best.s); Obstacles.dist(bo, best.x, fy, best.s, _n);
            const h = h2(_n.x, _n.s) || 1, ox = _n.x / h, os = _n.s / h;
            const bx = best.x - ox * (bd - 0.12), bs = best.s - os * (bd - 0.12); // just outside the rock surface
            let crowd = false;
            for (let j = 0; j < i; j++) if (h2(SL[j * 4] - bx, SL[j * 4 + 2] + bs + this.anchorZ) < this.SZ[i] * 1.3) { crowd = true; break; }
            if (!crowd) { best.x = bx; best.s = bs; best.z = -bs - this.anchorZ; nn = { x: ox, y: 0.3, z: -os }; }
          }
        }
        let zx = nn.x * 0.9, zy = 0.55 + nn.y * 0.3, zz = nn.z * 0.9;
        if (h2(zx, zz) < 0.15) { const a = rng() * TAU; zx = Math.cos(a) * 0.6; zz = Math.sin(a) * 0.6; }
        const l = h3(zx, zy, zz); zx /= l; zy /= l; zz /= l;
        SL[i * 4] = best.x; SL[i * 4 + 1] = sh.floorAt(best.x, best.s); SL[i * 4 + 2] = best.z; SL[i * 4 + 3] = 0.3 + 0.12 * rng();
        F[i * 3] = zx; F[i * 3 + 1] = zy; F[i * 3 + 2] = zz;
        this.EXP[i * 2] = SL[i * 4 + 3]; this.EXP[i * 2 + 1] = SL[i * 4 + 3];
      }
    } else if (kind === 'octo' || kind === 'rest') {
      const spread = beh.spread ?? 3;
      this.NRM = new Float32Array(n * 3); this.HOME = new Float32Array(n * 2);
      // set pieces: resting on a ledge / peeking from an amphora at an exact spot (no floor search)
      this.perchY = plan.restY ?? null; this.perched = this.perchY !== null ? new Uint8Array(n).fill(1) : null;
      if (kind === 'octo' && plan.den) this.den = true;
      for (let i = 0; i < n; i++) {
        const bs = this.entry.shape;
        const [x, z] = this.perched && i === 0 ? [x0, z0] : this._spaced(i, () => [x0 + (rng() - 0.5) * spread, z0 + (rng() - 0.5) * spread * 1.4], kind === 'octo' && !this.den ? this._octoR(i) : this.rbU * this.SZ[i] + 0.1, (2 * bs.r + bs.h + 0.4) * size * 1.1, P, 3);
        if (this.perched && i > 0) this.perched[i] = 0;
        const s = -(z + this.anchorZ);
        const nn = sh.floorNormal(x, s), a = rng() * TAU;
        P[i * 3] = x; P[i * 3 + 1] = (this.perched && this.perched[i] ? this.perchY : sh.floorAt(x, s)) + this._restLift(i); P[i * 3 + 2] = z;
        this.NRM[i * 3] = nn.x; this.NRM[i * 3 + 1] = nn.y; this.NRM[i * 3 + 2] = nn.z;
        this.HOME[i * 2] = x; this.HOME[i * 2 + 1] = z;
        F[i * 3] = Math.cos(a); F[i * 3 + 2] = Math.sin(a);
        if (this.perched && this.perched[i]) { // on top of / beside the prop, not inside its collision proxy
          this._settleClear(i); this.perchY = P[i * 3 + 1] - this._restLift(i);
          this.HOME[i * 2] = P[i * 3]; this.HOME[i * 2 + 1] = P[i * 3 + 2];
        }
        this.BANK[i] = this.bankBase;
        const lift = beh.lift || [4, 6];
        SL[i * 4 + 3] = lift[0] + (lift[1] - lift[0]) * rng();   // startle distance
        this.TMR[i] = kind === 'octo' ? (this.den ? 400 : 30 + rng() * 60) : 0; // octopus: time to the next spontaneous swim
      }
    } else if (kind === 'walk') {
      // crabs, lobsters, isopods, sea pigs: on the floor, walking in short bouts (herds and queues share a heading)
      const spread = beh.spread ?? 4, walk = plan.walk || beh.walk || 'wander';
      this.walk = walk;
      this.NRM = new Float32Array(n * 3); this.HOME = new Float32Array(n * 2);
      const ha = rng() * TAU; this.herdX = Math.sin(ha); this.herdZ = Math.cos(ha);
      const gap = Math.max(0.45, size * 1.7);
      for (let i = 0; i < n; i++) {
        let x, z;
        if (walk === 'queue') { x = x0 - this.herdX * gap * i + (rng() - 0.5) * 0.08; z = z0 - this.herdZ * gap * i + (rng() - 0.5) * 0.08; }
        else if (plan.ring) { const a = rng() * TAU; x = x0 + Math.cos(a) * plan.ring * (0.95 + 0.1 * rng()); z = z0 + Math.sin(a) * plan.ring * (0.95 + 0.1 * rng()); }
        else { const a = rng() * TAU, r = Math.sqrt(rng()) * spread; x = x0 + Math.cos(a) * r; z = z0 + Math.sin(a) * r; }
        if (walk === 'queue') [x, z] = this._freeSpot(x, z, this.rbU * this.SZ[i] * 1.6 + 0.08, true);
        else { const x1 = x, z1 = z; [x, z] = this._spaced(i, (t) => t ? [x1 + (rng() - 0.5) * spread * 0.5, z1 + (rng() - 0.5) * spread * 0.5] : [x1, z1], this.rbU * this.SZ[i] * 1.6 + 0.08, (2 * this.entry.shape.r + 0.15) * size * 1.1, P, 3); }
        const s = -(z + this.anchorZ), nn = sh.floorNormal(x, s);
        P[i * 3] = x; P[i * 3 + 1] = sh.floorAt(x, s); P[i * 3 + 2] = z;
        this.NRM[i * 3] = nn.x; this.NRM[i * 3 + 1] = nn.y; this.NRM[i * 3 + 2] = nn.z;
        this.HOME[i * 2] = x; this.HOME[i * 2 + 1] = z;
        const h = walk === 'wander' ? rng() * TAU : ha + (rng() - 0.5) * (walk === 'queue' ? 0.15 : 0.6);
        F[i * 3] = Math.sin(h); F[i * 3 + 2] = Math.cos(h);
        SL[i * 4] = x; SL[i * 4 + 2] = z;
        this.MODE[i] = walk === 'queue' ? 1 : 0; this.TMR[i] = walk === 'queue' ? 1e9 : rng() * 3;
      }
      this.alarmR = 1.2 + size * 4;
    } else if (kind === 'bed') {
      // upside-down jellyfish carpeting the mud, pulsing in place
      const spread = beh.spread ?? 4;
      for (let i = 0; i < n; i++) {
        const [x, z] = this._spaced(i, () => { const a = rng() * TAU, r = Math.sqrt(rng()) * spread; return [x0 + Math.cos(a) * r, z0 + Math.sin(a) * r * 1.3]; }, this.SZ[i] * 0.45, this.SZ[i] * 1.08 + 0.02, P, 3);
        P[i * 3] = x; P[i * 3 + 1] = sh.floorAt(x, -(z + this.anchorZ)) + 0.006 * this.SZ[i]; P[i * 3 + 2] = z;
        const h = rng() * TAU; F[i * 3] = Math.sin(h); F[i * 3 + 2] = Math.cos(h);
      }
    } else if (kind === 'attach') {
      // remoras riding under a host (one host animal each): spot on the belly in host body units
      const host = plan.host; this.host = host;
      this.HI = new Uint16Array(n); this.LOC = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        this.HI[i] = Math.min(host.n - 1, Math.floor(i / 2));
        const t = 0.22 + rng() * 0.26, b = Math.min(9, Math.floor(t * 10));
        const hostSz = host.SZ[this.HI[i]] || 1, rh = this.SZ[i] * 0.07 / hostSz;
        this.LOC[i * 4] = (rng() - 0.5) * 0.05; this.LOC[i * 4 + 1] = (host.entry.belly ? host.entry.belly[b] : -0.08) - rh * 0.8;
        this.LOC[i * 4 + 2] = 0.5 - t; this.LOC[i * 4 + 3] = (rng() - 0.5) * 0.25;
        this.PH[i] = rng() * TAU;
      }
      this.fade = host.fade;
    }
    if (FLOCK_KINDS.has(kind) || kind === 'shoal' || kind === 'hover' || kind === 'drift') this._placeClear();
    if (plan.mixOf) plan.mixOf = null; // only needed to lay out the slots (don't keep a retired primary group alive)
    this.matrixDirty = true;
    this._writeAll(0);
    if (STATIC_KINDS.has(kind)) this._staticSpace();
  }

  // Static animals (garden eels, morays in their holes, upside-down jellies) are never moved by the separation pass
  // (both weights are 0, and their pose is redrawn from the burrow), so one placed touching another static animal
  // stays inside it for good: a moray's hole at the edge of an eel field, two eels whose burrows the spacing search
  // could not keep apart. Such a member's burrow moves a little away (from earlier members and earlier groups).
  _staticSpace() {
    const sys = this.sys, sh = sys.shape, n = this.n, P = this.P, SL = this.SL, az = this.anchorZ, b = this.bounds, A = _capA, B = _capB;
    const others = sys.enc.filter((e) => e !== this && !e.done && STATIC_KINDS.has(e.kind) &&
      h3(e.bounds.x - b.x, e.bounds.y - b.y, e.anchorZ + e.bounds.z - az - b.z) < e.bounds.r + b.r + 1);
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        this._capsule(i, A, az);
        let worst = 0.03, wx = 0, wz = 0;
        for (let g = -1; g < others.length; g++) {
          const e = g < 0 ? this : others[g], m = g < 0 ? i : e.n;
          for (let j = 0; j < m; j++) {
            e._capsule(j, B, az);
            const d = segSegDist(A[0], A[1], A[2], A[3], A[4], A[5], B[0], B[1], B[2], B[3], B[4], B[5]) - A[6] - B[6];
            if (d < worst) { worst = d; wx = A[0] + A[3] - B[0] - B[3]; wz = A[2] + A[5] - B[2] - B[5]; }
          }
        }
        if (worst >= 0.03) continue;
        let l = h2(wx, wz); if (l < 1e-4) { wx = Math.cos(i * 2.4); wz = Math.sin(i * 2.4); l = 1; }
        const k = (0.05 - worst) / l, dx = wx * k, dz = wz * k, o = i * 4, i3 = i * 3;
        if (this.kind === 'bed') { P[i3] += dx; P[i3 + 2] += dz; P[i3 + 1] = sh.floorAt(P[i3], -(P[i3 + 2] + az)) + 0.006 * this.SZ[i]; }
        else { SL[o] += dx; SL[o + 2] += dz; SL[o + 1] = sh.floorAt(SL[o], -(SL[o + 2] + az)) - (this.kind === 'colony' ? 0.02 : 0); }
        moved = true;
      }
      if (!moved) break;
      this.matrixDirty = true; this._writeAll(0);
    }
  }
  // Separation capsule of agent i as sep.js builds it (segment ends, radius), z relative to anchor `az`. Garden eels
  // and morays slide along their axis as they retreat into the burrow and come out again (exposure 0.02 .. their
  // own maximum), so theirs covers that whole travel.
  _capsule(i, out, az) {
    const sh = this.entry.shape, i3 = i * 3, s = this.SZ[i], pl = this.sp.plan, k = this.kind;
    const up = k === 'colony' || (sh.ya && (pl === 'seahorse' || pl === 'cassiopea' || pl === 'octopus'));
    const ax = up ? 0 : this.F[i3], ay = up ? 1 : this.F[i3 + 1], azz = up ? 0 : this.F[i3 + 2], c = sh.c * s, h = sh.h * s;
    let bx = this.P[i3], by = this.P[i3 + 1], bz = this.P[i3 + 2], t0 = c - h, t1 = c + h;
    if (k === 'colony' || k === 'peek') { // burrow base; the body's offset along the axis is (exposure - 0.5) * size
      const o = i * 4; bx = this.SL[o]; by = this.SL[o + 1]; bz = this.SL[o + 2];
      t0 += (0.02 - 0.5) * s; t1 += (Math.max(this.SL[o + 3], 0.02) - 0.5) * s;
    }
    bz += this.anchorZ - az;
    out[0] = bx + ax * t0; out[1] = by + ay * t0; out[2] = bz + azz * t0; out[3] = bx + ax * t1; out[4] = by + ay * t1; out[5] = bz + azz * t1; out[6] = sh.r * s;
  }

  // Every swimmer starts clear of rock and terrain. Formation slots, mill rings and shoal homes are laid out around
  // one checked point, so a group set at a reef edge or a sinkhole rim would start partly inside it (and be lifted
  // out metres in its first frames): each member is pushed out of the obstacles, then the terrain fix keeps its
  // extremities off the floor, walls and roof; the move goes into its slot / home too, so the group does not pull
  // it straight back in.
  _placeClear() {
    const n = this.n, P = this.P, az = this.anchorZ, sh = this.sys.shape, reg = this.sys.env && this.sys.env.obstacles;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9, big = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3; if (this.SZ[i] > big) big = this.SZ[i];
      if (P[i3] < x0) x0 = P[i3]; if (P[i3] > x1) x1 = P[i3]; if (P[i3 + 1] < y0) y0 = P[i3 + 1]; if (P[i3 + 1] > y1) y1 = P[i3 + 1];
      if (P[i3 + 2] < z0) z0 = P[i3 + 2]; if (P[i3 + 2] > z1) z1 = P[i3 + 2];
    }
    const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5, rad = h2(x1 - x0, z1 - z0) * 0.5 + big;
    this.ceilOn = sh.hasCeiling(-(cz + az));
    const list = reg && reg.count ? reg.query(cx, -(cz + az), rad + 4, []) : null;
    // terrain fixes only where the floor / roof come near (a school out in the blue skips them)
    const terr = y1 + big > this.topCap - 0.5 || !this._columnClear(cx, -(cz + az), rad + 2, y0 - big - 2, y1 + big + 2);
    if (!terr && !(list && list.length)) return;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
      let b = 1;
      for (let it = 0; it < 3; it++) {
        if (list && list.length) for (let k = 0; k < 12; k++) {
          const d = this._depen(i, P[i3], P[i3 + 1], P[i3 + 2], list);
          if (d >= 0) break;
          if (_push.x * _push.x + _push.y * _push.y + _push.z * _push.z < 1e-6) { P[i3 + 1] += -d + 0.01; continue; } // on a proxy's axis: up and over
          P[i3] += _push.x; P[i3 + 1] += _push.y; P[i3 + 2] += _push.z;
        }
        if (!terr) break;
        b = this._terrainFix(i);
        if (b > 0 && !(list && list.length && this._depen(i, P[i3], P[i3 + 1], P[i3 + 2], list) < 0)) break;
      }
      this.TCL[i] = terr ? b : 0; this.CLR[i] = 0;
      const dx = P[i3] - px, dy = P[i3 + 1] - py, dz = P[i3 + 2] - pz;
      if (dx !== 0 || dy !== 0 || dz !== 0) this._slotShift(i, dx, dy, dz);
    }
  }

  // Is the water column clear of the floor (below yLo) and of any roof / ice (above yHi) at (x, s) and on a ring of
  // radius r around it? Beside a blue hole's wall or a drop-off the floor right below can be 100 m down while the
  // wall is a few metres to the side, so the ring (8 points) is what catches it.
  _columnClear(x, s, r, yLo, yHi) {
    const sh = this.sys.shape, ceil = sh.hasCeiling(s);
    for (let k = 0; k < 9; k++) {
      const a = k * (TAU / 8), qx = k === 8 ? x : x + Math.cos(a) * r, qs = k === 8 ? s : s + Math.sin(a) * r;
      if (sh.floorAt(qx, qs) > yLo) return false;
      if (ceil && sh.ceilingAt(qx, qs) < yHi) return false;
    }
    return true;
  }

  // ---------- obstacles ----------
  _obsRefresh() {
    const reg = this.sys.env && this.sys.env.obstacles;
    if (!reg || !reg.count) { this.obs.length = 0; return; }
    const every = this.speed < 1 && this.kind !== 'bait' ? 6 : 3; // slow groups refresh less often (margin covers it)
    if (this.obsFrame++ % every !== 0 && this.obsValid) return;
    // reach of one refresh interval + the look-ahead (|v| T) + body + the 1.5 m test margin
    const b = this.bounds, look = 2 + this.speed * (every === 6 ? 3 : 2) + this.baseSize * 0.6;
    const R = b.r + look + 1, bs = -(this.anchorZ + b.z);
    reg.query(b.x, bs, R, this.obs);
    this.obsValid = true;
    // bucket the short list into a small grid over the group so each instance only tests nearby obstacles
    const obs = this.obs, G = this.obsGrid || (this.obsGrid = { cells: [], n: 0, x0: 0, s0: 0, cs: 4 });
    if (obs.length <= 10 || obs.length * this.n < 600) { G.n = 0; return; } // a grid only pays off for big groups
    const cs = 4, nn = Math.min(16, Math.ceil((2 * R) / cs));
    G.n = nn; G.cs = (2 * R) / nn; G.x0 = b.x - R; G.s0 = bs - R;
    for (let k = 0; k < nn * nn; k++) { if (G.cells[k]) G.cells[k].length = 0; else G.cells[k] = []; }
    const m = 2.2 + this.rbU * this.baseSize * 1.5 + (this.elong ? this.baseSize * 0.5 : 0); // whole body (big adults, head and tail) + the 1.8 m test horizon
    for (const o of obs) {
      const bb = obsBox(o);
      const i0 = Math.max(0, Math.floor((bb[0] - m - G.x0) / G.cs)), i1 = Math.min(nn - 1, Math.floor((bb[1] + m - G.x0) / G.cs));
      const j0 = Math.max(0, Math.floor((bb[4] - m - G.s0) / G.cs)), j1 = Math.min(nn - 1, Math.floor((bb[5] + m - G.s0) / G.cs));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) G.cells[j * nn + i].push(o);
    }
  }
  _obsList(x, z) {
    const G = this.obsGrid;
    if (!G || !G.n) return this.obs;
    const i = Math.floor((x - G.x0) / G.cs), j = Math.floor((-(z + this.anchorZ) - G.s0) / G.cs);
    if (i < 0 || j < 0 || i >= G.n || j >= G.n) return this.obs;
    return G.cells[j * G.n + i];
  }
  // Signed clearance of instance i's body (1 or 3 spheres along the heading) at (px,py,pz), relative
  // coordinates. Writes the closest obstacle's outward normal into _hit. Large value when clear.
  _clear(i, px, py, pz, pts = 3, list = this.obs) {
    if (!list.length) return 1e9;
    const sz = this.SZ[i], rb = this.rbU * sz + 0.05 + 0.03 * sz, F = this.F, i3 = i * 3;
    const half = sz * 0.42, el = this.elong && pts > 1 && half > rb * 1.5, yo = this.kind === 'walk' ? rb : 0;
    let best = 1e9;
    for (let k = el ? -1 : 0; k <= (el ? 1 : 0); k++) {
      const off = k === 1 ? half : k === -1 ? -half * 0.85 : 0, rr = k === 0 ? rb : rb * 0.75;
      const qx = px + F[i3] * off, qy = py + F[i3 + 1] * off + yo, qz = pz + F[i3 + 2] * off, qs = -(qz + this.anchorZ);
      const m = rr + 1.8; // looks 1.8 m out: "nothing found" means a clearance of at least 1.8 m
      for (let j = 0; j < list.length; j++) {
        const o = list[j], bb = o._bb || obsBox(o);
        if (qx < bb[0] - m || qx > bb[1] + m || qy < bb[2] - m || qy > bb[3] + m || qs < bb[4] - m || qs > bb[5] + m) continue;
        // capsule distance, inlined (no allocation, no hypot)
        const abx = bb[6], aby = bb[7], abs = bb[8], l2 = bb[9];
        let t = l2 > 0 ? ((qx - o.ax) * abx + (qy - o.ay) * aby + (qs - o.as) * abs) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = qx - (o.ax + abx * t), dy = qy - (o.ay + aby * t), ds = qs - (o.as + abs * t);
        const dd = dx * dx + dy * dy + ds * ds, lim = best + o.r + rr;
        if (lim > 0 && dd >= lim * lim) continue;
        const dl = Math.sqrt(dd) || 1e-6, d = dl - o.r - rr;
        if (d < best) { best = d; _hit.nx = dx / dl; _hit.ny = dy / dl; _hit.nz = -ds / dl; }
      }
    }
    return best;
  }
  // Last-resort correction (steering looks ahead, so this is rare): move out by the sum of all
  // penetration vectors of the body spheres (resolves bodies wedged between several rocks at once).
  _pushOut(i, P, V, top = Infinity) { // returns false if the body could not be freed; `top`: highest allowed centre (ice / roof)
    const i3 = i * 3, L = this._obsList(P[i3], P[i3 + 2]);
    if (!L.length) return true;
    // cheap early-out: if the centre sphere clears by more than the half length, no part of the body can touch
    // (_clear only looks 1.8 m out, so a big body's head or tail can touch while its centre reads "clear")
    if (Math.min(this._clear(i, P[i3], P[i3 + 1], P[i3 + 2], 1, L), 1.8) > (this.elong ? this.SZ[i] * 0.45 : 0) + 0.02) return true;
    // swimmers never go into the floor or a wall: a rock seated in the sand pushes down into it, and a push out of a
    // rock at a sinkhole's rim went metres into the wall (the terrain fix then lifted the fish 9 m)
    const k = this.kind, sh = this.sys.shape, az = this.anchorZ;
    const swim = this.terrainOn && !(k === 'walk' || k === 'bed' || ((k === 'rest' || k === 'octo') && this.MODE[i] === 0));
    const hb = this.SZ[i] * Math.max(-this.entry.minY, 0.04) + 0.03; // centre above the floor (belly clear)
    for (let it = 0; it < 16; it++) {
      const d = this._depen(i, P[i3], P[i3 + 1], P[i3 + 2], L);
      if (d >= 0) return true;
      let px = _push.x * 1.25, py = _push.y * 1.25, pz = _push.z * 1.25; // slight over-relaxation: wedges converge faster
      if (px * px + py * py + pz * pz < 1e-8) { if (top < 1e9) return false; px = 0; py = -d + 0.01; pz = 0; } // pushes cancel out: escape upward
      if (swim) {
        const x0 = P[i3], z0 = P[i3 + 2], fb = sh.floorAt(x0 + px, -(z0 + pz + az)) + hb;
        if (P[i3 + 1] + py < fb) {
          const fa = sh.floorAt(x0, -(z0 + az)) + hb;
          if (fb - fa > 2 * h2(px, pz) + 0.05) { // into a steep face: only the part of the push along the face
            const nn = sh.floorNormal(x0 + px, -(z0 + pz + az)), vn = px * nn.x + py * nn.y + pz * nn.z;
            if (vn < 0) { px -= vn * nn.x; py -= vn * nn.y; pz -= vn * nn.z; }
            if (P[i3 + 1] + py < sh.floorAt(x0 + px, -(z0 + pz + az)) + hb) return false; // wedged between rock and wall: the caller undoes the step
          } else py = fb - P[i3 + 1]; // into the sand: slide out along it
        }
      }
      P[i3] += px; P[i3 + 1] += py; P[i3 + 2] += pz;
      if (P[i3 + 1] > top) { py -= P[i3 + 1] - top; P[i3 + 1] = top; } // squeezed against the ice: slide sideways instead
      if (V) {
        const pl = h3(px, py, pz) || 1, nx = px / pl, ny = py / pl, nz = pz / pl, vn = V[i3] * nx + V[i3 + 1] * ny + V[i3 + 2] * nz;
        if (vn < 0) { V[i3] -= vn * nx; V[i3 + 1] -= vn * ny; V[i3 + 2] -= vn * nz; }
      }
    }
    return this._depen(i, P[i3], P[i3 + 1], P[i3 + 2], L) >= 0;
  }
  // After an undone step: if even the previous spot is inside something (it was registered on top of the
  // animal), jump to the nearest free spot in the water (search shells of increasing radius).
  _unstick(i) {
    const reg = this.sys.env && this.sys.env.obstacles, P = this.P, i3 = i * 3;
    if (!reg || !reg.count || ((this.fc + i) & 7) !== 0) return; // a costly search: a wedged animal retries every 8th frame
    const x0 = P[i3], y0 = P[i3 + 1], z0 = P[i3 + 2], az = this.anchorZ, sh = this.sys.shape, reach = this.SZ[i] * 0.55;
    reg.query(x0, -(z0 + az), 14, _q);
    if (this._clear(i, x0, y0, z0, 3, _q) >= 0) return;
    for (let r = 0.5; r <= 12; r += 0.5) {
      for (let k = 0; k < DIRS.length; k += 3) {
        const x = x0 + DIRS[k] * r, y = y0 + DIRS[k + 1] * r, z = z0 + DIRS[k + 2] * r, s = -(z + az);
        if (y > Math.min(sh.ceilingAt(x, s), 0) - this.SZ[i] * Math.max(-this.entry.minY, 0.04) - 0.15 || y < this._floorNear(x, z, reach) + 0.2) continue;
        if (this._clear(i, x, y, z, 3, _q) >= 0.02) { P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; this.CLR[i] = 0; this._band(i); return; }
      }
    }
  }
  // A group member stranded far from its place (wedged against a berg the group swam around, left behind by a route
  // change) rejoins the group, but only out of sight: neither where it is nor where it goes may be in view.
  _rejoin(i, c) {
    const ev = this.event;
    if ((ev && (ev.type === 'strike' || ev.type === 'play')) || (this.nearMark && this.nearMark[i])) return false;
    const P = this.P, i3 = i * 3, t = this._slotTarget(i, 0), tx = t[0], ty = t[1], tz = t[2];
    const far = Math.max(12, (this.R || 0) * 1.5 + 8);
    if (h3(P[i3] - tx, P[i3 + 1] - ty, P[i3 + 2] - tz) < far) return false;
    const sh = this.sys.shape, az = this.anchorZ, fogK = this.sys.fogD * 0.7;
    if (inView(c, P[i3], P[i3 + 1], az + P[i3 + 2], fogK) || inView(c, tx, ty, az + tz, fogK) || h3(tx - c.x, ty - c.y, az + tz - c.z) < this.hardR + 6) return false;
    const s = -(tz + az), fl = this._floorNear(tx, tz, this.SZ[i] * 0.55), ce = Math.min(sh.ceilingAt(tx, s), 0), hb = this.SZ[i] * 0.6 + 0.2;
    // the spot itself must have room: clear of the floor and of ice / a cave roof (porpoising pods' slots sit just under the surface)
    if (ty < fl + hb || ty > (ce < 0 ? ce - hb : this.surfY + 0.5)) return false;
    const reg = this.sys.env && this.sys.env.obstacles;
    if (reg && reg.count) { reg.query(tx, s, 6 + this.SZ[i], _q); if (this._clear(i, tx, ty, tz, 3, _q) < 0.15) return false; }
    // nor inside another group's big animal (a manta gliding through the mill): the separation pass moves a fish out
    // by at most 1.5 m a frame, so a jump deep into one left the pair overlapping
    for (const e of this.sys.enc) {
      if (e === this || e.done || e.baseSize < 1 || e.kind === 'attach') continue;
      const eb = e.bounds, dz = e.anchorZ - az, es = e.entry.shape;
      if (h3(eb.x - tx, eb.y - ty, eb.z + dz - tz) > eb.r + this.SZ[i] + 1) continue;
      for (let j = 0; j < e.n; j++) {
        const j3 = j * 3;
        if (h3(e.P[j3] - tx, e.P[j3 + 1] - ty, e.P[j3 + 2] + dz - tz) < (es.h + es.r + Math.abs(es.c)) * e.SZ[j] + this.SZ[i] * 0.6 + 0.3) return false;
      }
    }
    P[i3] = tx; P[i3 + 1] = ty; P[i3 + 2] = tz;
    this.V[i3] = this.Cvx; this.V[i3 + 1] = this.Cvy; this.V[i3 + 2] = this.Cvz;
    this.CLR[i] = 0; this.TCL[i] = 0; this.STL[i] = 0;
    this._band(i);
    return true;
  }
  // Floor / roof band of a swimmer (as _steer samples it) right where it is: after a jump (rejoin, unstick) the old
  // band would let the hard floor clamp snap it back toward the old spot's floor.
  _band(i) {
    const sh = this.sys.shape, P = this.P, x = P[i * 3], s = -(P[i * 3 + 2] + this.anchorZ);
    this.FLO[i] = sh.floorAt(x, s) + this.mFloor * 0.5 + this.SZ[i] * 0.15;
    this.CEI[i] = Math.min(Math.min(sh.ceilingAt(x, s), 0) - this.mCeil * 0.6, this.surfY);
    this.OTP[i] = -1e4;
  }
  // Highest floor within `r` (horizontally) of (x, z), relative coordinates: beside a steep face the floor half a body
  // length away can be metres above the floor right under the centre.
  _floorNear(x, z, r) {
    const sh = this.sys.shape, s = -(z + this.anchorZ);
    return Math.max(sh.floorAt(x, s), sh.floorAt(x + r, s), sh.floorAt(x - r, s), sh.floorAt(x, s + r), sh.floorAt(x, s - r));
  }
  // A walker inside a rock (one was registered on top of it): move to the nearest free patch of floor.
  _escape(i) {
    const reg = this.sys.env && this.sys.env.obstacles, sh = this.sys.shape, P = this.P, i3 = i * 3, az = this.anchorZ;
    if (!reg || !reg.count) return;
    const x0 = P[i3], z0 = P[i3 + 2];
    reg.query(x0, -(z0 + az), 8, _q);
    for (let r = 0.4; r <= 6; r += 0.4) {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU + r, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r, y = sh.floorAt(x, -(z + az));
        if (this._clear(i, x, y, z, 3, _q) >= 0.02) { P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; this.HOME[i * 2] = x; this.HOME[i * 2 + 1] = z; return; }
      }
    }
  }
  // Push a freshly placed body out of any obstacle (the group has no obstacle list yet at placement).
  _settleClear(i) {
    const reg = this.sys.env && this.sys.env.obstacles;
    if (!reg || !reg.count) return;
    const P = this.P, i3 = i * 3;
    reg.query(P[i3], -(P[i3 + 2] + this.anchorZ), 4 + this.SZ[i], _q);
    for (let it = 0; it < 12; it++) {
      const d = this._depen(i, P[i3], P[i3 + 1], P[i3 + 2], _q);
      if (d >= 0) break;
      if (_push.x * _push.x + _push.y * _push.y + _push.z * _push.z < 1e-6) { P[i3 + 1] += -d + 0.01; continue; } // on a proxy's axis: up and over
      P[i3] += _push.x; P[i3 + 1] += _push.y; P[i3 + 2] += _push.z;
    }
  }
  // Sum of the push-out vectors over every (body sphere, obstacle) overlap -> _push; returns the deepest clearance.
  _depen(i, px, py, pz, list) {
    const sz = this.SZ[i], rb = this.rbU * sz + 0.05 + 0.03 * sz, F = this.F, i3 = i * 3;
    const half = sz * 0.42, el = this.elong && half > rb * 1.5, yo = this.kind === 'walk' ? rb : 0;
    let best = 1e9; _push.x = 0; _push.y = 0; _push.z = 0;
    for (let k = el ? -1 : 0; k <= (el ? 1 : 0); k++) {
      const off = k === 1 ? half : k === -1 ? -half * 0.85 : 0, rr = k === 0 ? rb : rb * 0.75;
      const qx = px + F[i3] * off, qy = py + F[i3 + 1] * off + yo, qz = pz + F[i3 + 2] * off, qs = -(qz + this.anchorZ);
      for (let j = 0; j < list.length; j++) {
        const o = list[j], bb = o._bb || obsBox(o);
        if (qx < bb[0] - rr || qx > bb[1] + rr || qy < bb[2] - rr || qy > bb[3] + rr || qs < bb[4] - rr || qs > bb[5] + rr) continue;
        const abx = bb[6], aby = bb[7], abs = bb[8], l2 = bb[9];
        let t = l2 > 0 ? ((qx - o.ax) * abx + (qy - o.ay) * aby + (qs - o.as) * abs) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = qx - (o.ax + abx * t), dy = qy - (o.ay + aby * t), ds = qs - (o.as + abs * t);
        const dl = Math.sqrt(dx * dx + dy * dy + ds * ds) || 1e-6, d = dl - o.r - rr;
        if (d >= 0) continue;
        if (d < best) best = d;
        const m = (-d + 0.005) / dl; // land a hair outside the surface
        _push.x += dx * m; _push.y += dy * m; _push.z -= ds * m;
      }
    }
    return best;
  }
  // Placement with personal space: up to 8 candidates from gen(t); returns the first that is at least minD
  // (horizontally) from every earlier member (A[j * stride], A[j * stride + 2]), else the most spacious one.
  _spaced(i, gen, rad, minD, A, stride) {
    let bx = 0, bz = 0, bd = -1;
    for (let t = 0; t < 8; t++) { // spacing is tested on the raw candidates; only the chosen one is moved off rocks
      const g = gen(t), x = g[0], z = g[1];
      let dm = 1e18;
      for (let j = 0; j < i; j++) { const dx = A[j * stride] - x, dz = A[j * stride + 2] - z, d = dx * dx + dz * dz; if (d < dm) dm = d; }
      dm = Math.sqrt(dm);
      if (dm >= minD) { bx = x; bz = z; break; }
      if (dm > bd) { bd = dm; bx = x; bz = z; }
    }
    return this._freeSpot(bx, bz, rad, true);
  }
  // Move a point (relative coords) out of nearby obstacles horizontally, keeping it on the floor.
  _freeSpot(x, z, rad, onFloor) {
    const reg = this.sys.env && this.sys.env.obstacles, sh = this.sys.shape;
    if (!reg || !reg.count) return [x, z];
    for (let it = 0; it < 4; it++) {
      const s = -(z + this.anchorZ), y = onFloor ? sh.floorAt(x, s) + rad * 0.5 : 0;
      reg.query(x, s, rad + 4, _q);
      let worst = 0, nx = 0, nz = 0;
      for (const o of _q) {
        const d = Obstacles.dist(o, x, y, s, _n) - rad - 0.1;
        if (d < worst) { worst = d; const h = h2(_n.x, _n.s) || 1; nx = _n.x / h; nz = -_n.s / h; if (h < 0.2) { nx = 1; nz = 0; } }
      }
      if (worst >= 0) break;
      x -= nx * worst; z -= nz * worst;
    }
    return [x, z];
  }

  // height of the body axis above the sand for an animal lying on it (its lowest point just touches)
  _restLift(i) {
    const sp = this.sp, sz = this.SZ[i];
    if (sp.beh.perch) return sz * sp.beh.perch;          // tripod fish on its fin stilts
    if (sp.plan === 'octopus') return 0.01 * sz;
    const d = this.bankBase ? this.entry.maxX : -this.entry.minY; // flatfish lie on their side
    return sz * Math.max(0.006, d - 0.003);
  }

  // `place`: the animal is put at its home (spawn), so the home's water column is its floor / roof band too. A later
  // relocation leaves FLO / CEI alone: they are the band where the animal is now, and the hard floor clamp in _steer
  // used to snap it straight to the new home's floor (3.9 m up a blue hole's wall in one frame, into a rock).
  _setHome(i, x, z, alt, plan, place = false) {
    const sh = this.sys.shape;
    let s = -(z + this.anchorZ);
    let yF = null;
    if (plan && plan.face) { // a wall face: hover a metre or two in front of it, spread up and down the wall
      yF = sh.pathY(s) + (plan.h0 ?? 0) + (alt - 1.5) * 1.6;
      let xx = sh.pathX(s);
      for (let k = 0; k < 50 && sh.floorAt(xx, s) < yF - 0.2; k++) xx += plan.face * 0.5;
      x = xx - plan.face * (0.8 + this.rng() * 1.6);
    }
    let fl = sh.floorAt(x, s), ce = Math.min(sh.ceilingAt(x, s), 0);
    // no room here (inside a cave wall / under a low roof): walk the home toward the open passage at the path
    const need = this.mFloor * 0.6 + this.mCeil + this.baseSize * 0.6 + 0.3;
    for (let k = 0; k < 24 && Math.min(ce, this.surfY + this.mCeil) - fl < need; k++) {
      const px = sh.pathX(s), dx = px - x;
      if (Math.abs(dx) < 0.3) break;
      x += Math.sign(dx) * Math.min(Math.abs(dx), 0.75);
      fl = sh.floorAt(x, s); ce = Math.min(sh.ceilingAt(x, s), 0);
    }
    let y = yF !== null ? yF : plan && plan.homeY !== undefined ? plan.homeY + alt * 0.5 : this.zone === 'mid' ? sh.pathY(s) + (plan?.h0 ?? 0) + alt * 0.3 : fl + alt;
    let lo = fl + this.mFloor * 0.6, hi = Math.min(ce - this.mCeil, this.surfY);
    y = hi > lo ? clamp(y, lo, hi) : (lo + hi) * 0.5;
    // Homes are never inside rocks (moved up / out along the surface normal), nor against a steep face: beside a
    // blue hole's wall or a drop-off a home `alt` above the floor right below is centimetres from the face, with the
    // fish's head in it, so it steps out from the face (downhill) at the same height until the floor within a body
    // length and some slack is below it. The two alternate: a home in the crevice between a rock and the wall moves
    // out of it, instead of the rock pushing it back against the wall (where rock avoidance then drove the fish
    // into the wall at up to 5 m/s).
    const reg = this.sys.env && this.sys.env.obstacles, rad = this.rbU * this.baseSize + 0.3, reach = this.baseSize * 0.6 + 0.8;
    if (reg && reg.count) reg.query(x, s, rad + 8, _q); else _q.length = 0;
    let moved = false;
    for (let round = 0; round < 12; round++) {
      let clear = true;
      for (let it = 0; it < 3; it++) {
        let worst = 0, nx = 0, ny = 0, nz = 0;
        for (const o of _q) { const d = Obstacles.dist(o, x, y, -(z + this.anchorZ), _n) - rad; if (d < worst) { worst = d; nx = _n.x; ny = _n.y; nz = -_n.s; } }
        if (worst >= 0) break;
        x -= nx * worst; y -= ny * worst; z -= nz * worst; clear = false;
      }
      s = -(z + this.anchorZ);
      let hf = -1e9, gx = 0, gz = 0;
      for (let d = 0; d < 4; d++) {
        const dx = d === 0 ? reach : d === 1 ? -reach : 0, dz = d === 2 ? reach : d === 3 ? -reach : 0, f = sh.floorAt(x + dx, s - dz);
        if (f > hf) { hf = f; gx = dx; gz = dz; }
      }
      if (hf > y - this.mFloor * 0.6 && hf - sh.floorAt(x, s) > reach) { // a steep face within reach (not a gentle slope)
        x -= (gx / reach) * 0.5; z -= (gz / reach) * 0.5; s = -(z + this.anchorZ); moved = true; clear = false;
      }
      if (clear) break;
    }
    if (moved) { // the water column where it ended up
      fl = sh.floorAt(x, s); ce = Math.min(sh.ceilingAt(x, s), 0);
      lo = fl + this.mFloor * 0.6; hi = Math.min(ce - this.mCeil, this.surfY);
      if (y < lo || y > hi) y = hi > lo ? clamp(y, lo, hi) : (lo + hi) * 0.5;
    }
    const o = i * 4; this.SL[o] = x; this.SL[o + 1] = y; this.SL[o + 2] = z;
    if (place) { this.FLO[i] = lo; this.CEI[i] = hi; }
  }

  _zoneY(x, s, fl, ce, wh) {
    const zone = this.zone, sh = this.sys.shape;
    let y;
    if (zone === 'floor') y = fl + this.alt + wh;
    else if (zone === 'surface') y = this.sp.beh.skim ? -0.2 - this.baseSize * 0.035 + wh * 0.1 : -1.0 - this.baseSize * 0.3 + wh * 0.5;
    else if (zone === 'ceiling') y = ce - this.alt + wh;
    else y = sh.pathY(s) + this.lh + wh;
    const lo = fl + this.mFloor + this.R0(), hi = Math.min(ce - this.mCeil, this.surfY) - this.R0() * 0.5;
    return hi > lo ? clamp(y, lo, hi) : (lo + hi) * 0.5;
  }
  R0() { return this.R ? Math.min(this.R * 0.4, 3) : 0; }
  // vertical room for the group centre at (x, s) between the limits _zoneY clamps to (negative: no water column for it)
  _room(x, s, fl, ce) { return Math.min(ce - this.mCeil, this.surfY) - this.R0() * 1.5 - fl - this.mFloor; }

  _slotTarget(i, dt) {
    const o = i * 4, SL = this.SL, out = _t;
    const k = this.kind;
    if (k === 'bait' || k === 'mill') {
      SL[o + 1] += SL[o + 3] * dt;
      if (SL[o + 1] > TAU) SL[o + 1] -= TAU;
      const a = SL[o + 1], r = SL[o];
      const bob = Math.sin(this.age * 0.4 + a * 2 + r * 0.3) * r * 0.12; // a slow wave around the ring: neighbours bob together
      out[0] = this.Cx + Math.cos(a) * r; out[1] = this.Cy + SL[o + 2] + bob; out[2] = this.Cz + Math.sin(a) * r;
      out[3] = -Math.sin(a) * SL[o + 3] * r; out[4] = 0; out[5] = Math.cos(a) * SL[o + 3] * r;
      // a mill column taller than the water here (caves, under ledges) is squeezed into it, not pushed into the rock
      // (nor into the low rocks and coral heads under it)
      if (this.CEI[i] > this.FLO[i]) out[1] = clamp(out[1], this._lo(i), this.CEI[i]);
      return out;
    }
    const ev = this.event;
    if (ev && ev.type === 'play') { // orbit the camera (the leader sits on it), bobbing up and down
      const RP = this.RP, r = this.hardR + 0.9 + 1.6 * RP[o + 1], th = ev.t * ev.w + (i / this.n) * TAU + RP[o] * 0.6;
      const ct = Math.cos(th), st = Math.sin(th), w = ev.w;
      out[0] = this.Cx + ct * r; out[1] = this.Cy + Math.sin(th * 1.5 + RP[o + 2] * 6) * 1.1; out[2] = this.Cz - 1.5 + st * r * 0.85;
      out[3] = this.Cvx - st * r * w; out[4] = this.Cvy; out[5] = this.Cvz + ct * r * w * 0.85;
      if (this.CEI[i] > this.FLO[i]) out[1] = clamp(out[1], this._lo(i), this.CEI[i]); // the camera may fly low over the reef
      return out;
    }
    if (ev && ev.type === 'strike' && this.MODE[i] === 1 && ev.prey) { // dash through the bait ball
      const pr = ev.prey, dz = pr.anchorZ - this.anchorZ, o2 = i * 4;
      out[0] = pr.Cx + this.RP[o2] * 2 - 1; out[1] = pr.Cy + this.RP[o2 + 1] * 2 - 1; out[2] = pr.Cz + dz + this.RP[o2 + 2] * 2 - 1;
      out[3] = 0; out[4] = 0; out[5] = 0;
      return out;
    }
    let c = this.cvz, s = this.cvx; // heading (sin psi = s, cos psi = c)
    if (this.DLY) { const j = ((this.hbI - this.DLY[i]) & 31) * 2; s = this.HB[j]; c = this.HB[j + 1]; } // turn wave
    let sx = SL[o], sy = SL[o + 1], sz = SL[o + 2];
    if (this.calfT !== undefined && i === 1 && this.calfT < 15) { // one loop over and under the mother
      const th = TAU * smooth(this.calfT / 14), L = this.SZ[0], rc = L * 0.42;
      sx = -Math.cos(th) * rc; sy = Math.sin(th) * rc * 0.8 + L * 0.12;
    }
    const w = this.age * (0.15 + this.RP[o + 1] * 0.2) + this.RP[o + 2] * TAU;
    const sq = k === 'pod' || k === 'solo' ? this.fsq : 1; // bunched up near rocks and walls
    const wob = (k === 'school' ? this.R * 0.12 : k === 'pod' ? this.baseSize * (this.calf ? 0.06 : 0.6) : 0) * sq;
    const dart = this.dart ? Math.sin(this.age * 0.7 + this.RP[o] * 9) * this.baseSize * 3 * sq : 0;
    const ox = sx * sq + Math.sin(w) * wob + dart, oz = sz * sq + Math.cos(w * 0.8) * wob;
    out[0] = this.Cx + ox * c + oz * s;
    out[1] = this.Cy + sy * sq + Math.sin(w * 1.3) * wob * 0.4;
    out[2] = this.Cz - ox * s + oz * c;
    out[3] = this.Cvx; out[4] = this.Cvy; out[5] = this.Cvz;
    if ((this.zone === 'surface' || this.zone === 'ceiling') && k === 'pod') { // porpoising arcs near the surface / ice
      const ph = this.age * (0.35 + this.RP[o + 3] * 0.15) + this.RP[o] * TAU;
      out[1] += -Math.abs(Math.sin(ph)) * 2.2 + 1.0;
    }
    // big animals: wobble and porpoising arcs stay inside the animal's own floor / ceiling band
    if ((k === 'pod' || k === 'solo') && this.CEI[i] > this.FLO[i]) out[1] = clamp(out[1], this._lo(i), this.CEI[i]);
    return out;
  }
  // lowest height for agent i's slot: the sand, or the top of a low rock / coral head under it (when that fits)
  _lo(i) { const f = this.FLO[i], t = this.OTP[i]; return t > f && t < this.CEI[i] ? t : f; }

  // Top of the low rocks / coral heads under a body of radius `rad` at (x, y, z) (relative coordinates): the highest
  // surface point of any obstacle whose footprint it is over, unless that obstacle is overhead (the body is below
  // its underside: an arch, an overhang) or more than 3 m + a body length above it (taller structure is swum
  // around, not over). -1e9 when none.
  _obsTop(x, y, z, rad, list) {
    const s = -(z + this.anchorZ), climb = 3 + this.baseSize;
    let top = -1e9;
    for (let j = 0; j < list.length; j++) {
      const o = list[j], bb = o._bb || obsBox(o);
      if (x < bb[0] - rad || x > bb[1] + rad || s < bb[4] - rad || s > bb[5] + rad || y < bb[2] - rad) continue;
      const abx = bb[6], aby = bb[7], abs = bb[8], hl = abx * abx + abs * abs, R = o.r + rad;
      // the axis point under (x, s) and both ends (a tilted capsule peaks at one of them)
      const tc = hl > 1e-6 ? clamp(((x - o.ax) * abx + (s - o.as) * abs) / hl, 0, 1) : 0.5;
      for (let q = 0; q < 3; q++) {
        const t = q === 0 ? tc : q === 1 ? 0 : 1, dx = x - (o.ax + abx * t), ds = s - (o.as + abs * t), h = dx * dx + ds * ds;
        if (h >= R * R) continue;
        const cy = o.ay + aby * t, w = Math.sqrt(R * R - h);
        if (y < cy - w || cy + w - y > climb) continue;
        if (cy + w > top) top = cy + w;
      }
    }
    return top;
  }

  // ======================================================================
  update(dt, c) {
    this.stepped = false;
    if (this.kind === 'attach') { // remoras ride their host (updated just before us)
      const h = this.host;
      if (h.done) { this.done = true; return; }
      this.fade = h.fade; this.age += dt;
      if (dt > 0) this._attach(dt);
      this._visibility(c);
      return;
    }
    if (dt <= 0) { this._visibility(c); return; }
    // simulation LOD: off-screen groups and groups too small to read step at a third of the rate,
    // small-on-screen groups beyond 35 m at half the rate (accumulated dt; obstacle budgets use real displacement)
    const dd = this.dist || 0, px = this.baseSize * 600 / Math.max(dd, 1), reg0 = this.sys.env && this.sys.env.obstacles;
    const rate = dd < 25 || this.kind === 'colony' || this.kind === 'peek' || this.event || (reg0 && reg0.count !== this.regCount) ? 1
      : !this.visible || px < 6 ? 3 : dd > 35 && px < 14 ? 2 : 1;
    if (rate > 1) {
      this.simAcc += dt;
      if (++this.simSkip % rate !== 0) { this.age += dt; return; }
      const cur = dt; dt = Math.min(this.simAcc, 0.12); this.simAcc = 0; this.age -= dt - cur;
    } else this.simAcc = 0;
    this.age += dt;
    if (this.plan.fadeIn && !this.dying) this.fade = Math.min(1, this.fade + dt * 0.5);
    if (this.dying) { this.fade -= dt * 0.6; if (this.fade <= 0) { this.done = true; return; } }
    const k = this.kind;
    // obstacles registered after we settled (chunk layouts finish later): refresh and re-validate everything
    const reg = this.sys.env && this.sys.env.obstacles;
    const rc = reg ? reg.count : 0;
    if (rc !== this.regCount) { this.regCount = rc; this.obsValid = false; this.CLR.fill(0); this.recheck = true; }
    this.recheckT = (this.recheckT || 0) - dt;
    if (this.recheckT < 0) { this.recheckT = 0.5; this.recheck = true; }
    if (!STATIC_KINDS.has(k)) this._obsRefresh();
    else if (this.recheck && rc) this._revalidateBases();
    // terrain under / over the group: extremity checks run unless a flock is out in open water
    if (!STATIC_KINDS.has(k)) {
      this.stepped = true;
      this.ceilOn = this.sys.shape.hasCeiling(-(this.anchorZ + this.bounds.z));
      const was = this.terrainOn;
      this.terrainOn = k !== 'walk' && !(FLOCK_KINDS.has(k) && this.openWater);
      if (this.terrainOn && !was) this.TCL.fill(0); // budgets went stale while out in open water
    }
    if (FLOCK_KINDS.has(k)) { this._leader(dt, c); this._steer(dt, c, true); }
    else if (k === 'shoal' || k === 'hover') this._steer(dt, c, false);
    else if (k === 'drift') this._drift(dt, c);
    else if (k === 'rest') this._rest(dt, c);
    else if (k === 'octo') this._octo(dt, c);
    else if (k === 'walk') this._walk(dt, c);
    else this._static(dt, c);
    this.recheck = false;
    this._visibility(c);
    this._lodTick(c);
    // despawn rules
    const b = this.bounds;
    const sMax = -(this.anchorZ + b.z) + b.r;
    // out of view and already passed (behind, or off to the side of the view cone) -> retire early
    this.unseen = this.visible ? 0 : (this.unseen || 0) + dt;
    const ahead = -(this.anchorZ + b.z) - c.s, lat = Math.abs(b.x - c.x);
    const fromBehind = (this.route === 'overtake' || this.route === 'escort' || this.route === 'lead') && this.age < 45;
    if (sMax < c.s - 14) this.done = true;
    else if (this.unseen > 6 && !fromBehind && (ahead < 3 || lat > ahead * 1.2 + 8 + b.r)) this.done = true;
    else if (Math.abs(b.x - c.x) > 320 || Math.abs(-(this.anchorZ + b.z) - c.s) > 520) this.done = true;
    else if (this.age > this.maxAge && !this.visible) this.done = true;
  }

  _leader(dt, c) {
    const sh = this.sys.shape;
    let direct = false; // routes that place the leader themselves
    // route logic
    if (this.route === 'circle') {
      // slow banked circles around a fixed point (mantas over a cleaning station)
      const O = this.plan.orbit;
      if (!this.orbR) this.orbR = O.r;
      if (this.lbd !== undefined && this.lbd < 1.5) this.orbR = Math.min(this.orbR + (1.5 - this.lbd) * dt * 2, O.r * 1.35 + 4); // widen around the berg / rocks
      this.orbA = (this.orbA ?? O.a0 ?? 0) + O.w * O.r / this.orbR * dt;
      const s1 = O.s + Math.sin(this.orbA) * this.orbR;
      this.ls = s1; this.ll = O.x + Math.cos(this.orbA) * this.orbR - sh.pathX(s1);
      this.lh = O.y + 0.8 * Math.sin(this.orbA * 0.37) - sh.pathY(s1);
      this.vs = 0; this.vl = 0; direct = true;
      if (this.age > (O.T ?? 1e9)) { this.route = 'cross'; this.vl = (this.ll >= 0 ? 1 : -1) * this.speed; this.vs = this.speed * 0.3; }
    } else if (this.route === 'curious') {
      // turtles & co: swim to a spot just ahead of the camera, glide slowly past it looking at it, then leave
      const ev = this.event; ev.t += dt;
      const ds = this.ls - c.s, side = ev.side, camL = c.x - sh.pathX(this.ls), camH = c.y - sh.pathY(this.ls);
      // pass 2.5-4 m from the lens (groups: their nearest members), never inside the camera bubble
      const L = Math.max(ev.lat ?? 2.2, this.hardR + 0.4) + (this.R ? this.R * 0.6 : 0);
      if (ev.ph === 0) {
        const want = c.speed + clamp((7 - ds) * 0.35, -1.5, 1.2);
        this.vs += (want - this.vs) * Math.min(1, dt * 0.8);
        this.ll += (camL + side * L * 1.15 - this.ll) * Math.min(1, dt * 0.5);
        this.lh += (camH + 0.2 - this.lh) * Math.min(1, dt * 0.5);
        if ((Math.abs(ds - 7) < 2.5 && Math.abs(this.ll - camL - side * L * 1.15) < 1.5) || ev.t > 14) { ev.ph = 1; ev.t = 0; }
      } else if (ev.ph === 1) {
        this.vs += (-0.35 - this.vs) * Math.min(1, dt * 0.7);
        this.ll += (camL + side * L - this.ll) * Math.min(1, dt * 0.6);
        this.lh += (camH - this.lh) * Math.min(1, dt * 0.6);
        this.lookCam = Math.min(1, this.lookCam + dt * 0.8);
        if (ds < -5 || ev.t > 12) { ev.ph = 2; ev.t = 0; }
      } else {
        this.lookCam = Math.max(0, this.lookCam - dt);
        this.vl += (side * this.speed - this.vl) * Math.min(1, dt * 0.5);
        this.vs += (-this.speed * 0.5 - this.vs) * Math.min(1, dt * 0.5);
        if (ev.t > 8) { this.event = null; this.route = 'cross'; this.lookCam = 0; }
      }
    } else if (this.route === 'play') {
      // dolphins / sea lions: travel with the camera while the members orbit around it (see _slotTarget)
      const ev = this.event; ev.t += dt; direct = true;
      const k = Math.min(1, dt * 1.2), m = 5 * dt; // close in at up to ~5 m/s relative to the camera
      this.ls += clamp((c.s + 2 - this.ls) * k, -m, m) + c.speed * dt;
      this.ll += clamp((c.x - sh.pathX(this.ls) - this.ll) * k, -m, m);
      this.lh += clamp((c.y - sh.pathY(this.ls) - this.lh) * k, -m * 0.5, m * 0.5);
      ev.ring -= dt;
      if (ev.ring < 0 && this.sys.fx) { // bubble rings blown from the blowhole... into the water ahead
        ev.ring = 2.5 + this.rng() * 4;
        const i = Math.floor(this.rng() * this.n), i3 = i * 3, sz = this.SZ[i];
        this.sys.fx.ring(this.P[i3] + this.F[i3] * sz * 0.5, this.P[i3 + 1] + sz * 0.05, this.anchorZ + this.P[i3 + 2] + this.F[i3 + 2] * sz * 0.5, this.F[i3], this.F[i3 + 1], this.F[i3 + 2]);
      }
      if (ev.t > ev.dur) { this.event = null; this.route = 'overtake'; this.vs = c.speed + 2.5; this.vl = this.side * this.speed * 0.5; this.ll += this.side * 2; }
    } else if (this.route === 'strike') {
      // predators circling a bait ball (members dash through it, see _slotTarget)
      const ev = this.event, prey = ev.prey;
      if (!prey || prey.done || ev.t > ev.dur) { this.event = null; this.route = 'cross'; this.vl = this.side * this.speed; this.vs = this.speed * 0.5; }
      else {
        ev.t += dt; ev.a += ev.w * dt; direct = true;
        const ps = -(prey.anchorZ + prey.Cz), pr = (prey.R || 3) + 4.5;
        const s1 = ps + Math.sin(ev.a) * pr * 0.8;
        this.ls = s1; this.ll = prey.Cx + Math.cos(ev.a) * pr - sh.pathX(s1); this.lh = prey.Cy + Math.sin(ev.a * 1.7) * 1.2 - sh.pathY(s1);
        this.vs = 0; this.vl = 0;
      }
    } else if (this.route === 'lunge') {
      // humpbacks under a bubble net: circle deep, lunge straight up through the ring, then swim off
      const ev = this.event, O = ev.o; ev.t += dt; direct = true;
      if (ev.ph === 0) {
        ev.a += 0.16 * dt;
        const s1 = O.s + Math.sin(ev.a) * 10; this.ls = s1; this.ll = O.x + Math.cos(ev.a) * 10 - sh.pathX(s1); this.lh = O.y0 - sh.pathY(s1);
        if (ev.t > ev.wait) { ev.ph = 1; ev.t = 0; this.maxPitch = 1.35; }
      } else if (ev.ph === 1) {
        const k = Math.min(1, dt * 1.5);
        this.ls += (O.s - this.ls) * k; this.ll += (O.x - sh.pathX(this.ls) - this.ll) * k;
        const top = Math.min(sh.ceilingAt(O.x, this.ls), 0) - this.baseSize * 0.35; // up to the surface (or the ice)
        this.lh = Math.min(this.lh + 3.2 * dt, top - sh.pathY(this.ls));
        if (ev.t > 7) { ev.ph = 2; ev.t = 0; }
      } else {
        this.maxPitch = 0.35 + 1.0 * Math.max(0, 1 - ev.t / 3);
        this.lh -= 0.7 * dt; this.ll += this.side * 1.2 * dt;
        if (ev.t > 10) { this.event = null; this.route = 'cross'; this.maxPitch = 0.35; this.vl = this.side * 1.2; this.vs = 0.5; }
      }
    } else if (this.route === 'escort') {
      const ds = this.ls - c.s;
      if (this.age < 200 && this.escortT > 0) {
        const want = ds < -4 ? c.speed + 1.8 : c.speed + (ds > 6 ? -0.6 : 0.15);
        this.vs += (want - this.vs) * Math.min(1, dt * 0.4);
        if (ds > -6) this.escortT -= dt;
      } else { this.vs += (c.speed * 0.4 - this.vs) * dt * 0.2; this.vl += (this.side * this.speed * 0.8 - this.vl) * dt * 0.15; }
    } else if (this.route === 'swirl') {
      // wait on the path; once the camera arrives, travel with it so the school circles it, then let it go
      const ds = this.ls - c.s;
      if (ds < 2 && this.leadT > 0) { this.swirling = true; }
      let want = 0;
      if (this.swirling && this.leadT > 0) { want = c.speed + clamp((c.s + 0.5 - this.ls) * 0.8, -1.5, 1.5); this.leadT -= dt; this.ll *= 1 - Math.min(1, dt); this.lh *= 1 - Math.min(1, dt); }
      else if (this.swirling) want = 0.2;
      this.vs += (want - this.vs) * Math.min(1, dt * 0.8);
    } else if (this.route === 'lead') {
      // Swim ahead of the camera at a readable distance, then slow so the camera passes alongside / through.
      const ds = this.ls - c.s, A = this.leadA;
      let want;
      if (this.leadT > 0) {
        if (ds > A) want = c.speed - Math.min(3, 0.8 + (ds - A) * 0.05); // let the camera close in
        else want = c.speed + Math.min(2.5, (A - ds) * 0.45);
        want = Math.min(want, this.maxSwim);
        if (Math.abs(ds - A) < 6 || this.age > 90) this.leadT -= dt;
      } else want = Math.min(c.speed * 0.35, this.speed);
      this.vs += (Math.max(0, want) - this.vs) * Math.min(1, dt * 0.6);
    }
    // natural speed variation (slow surges and lulls)
    const surge = 1 + 0.12 * Math.sin(this.age * 0.21 + this.wP * 3) * Math.sin(this.age * 0.07 + this.wP);
    if (!direct) { this.ls += this.vs * dt * surge; this.ll += this.vl * dt; }
    if (this.calfT !== undefined && this.calfT < 16) this.calfT += dt; // the calf's loop around its mother
    if (this.event && this.event.type === 'roll') { // manta barrel roll
      const ev = this.event; ev.t += dt;
      const f = smooth(ev.t / ev.dur), a = TAU * f;
      for (let i = 0; i < this.n; i++) this.SPIN[i] = a;
      this.lh += Math.sin(Math.PI * Math.min(1, ev.t / ev.dur)) * 0.5 * dt;
      if (ev.t >= ev.dur) { this.SPIN.fill(0); this.event = null; }
    }
    if (this.vh) this.lh = clamp(this.lh + this.vh * dt, -6, 2);
    const latMax = this.latMax;
    if (this.route !== 'cross' && this.route !== 'escort' && Math.abs(this.ll) > latMax) this.ll -= Math.sign(this.ll) * (Math.abs(this.ll) - latMax) * dt * 0.3;
    // keep clear of the camera tube
    const k0 = this.kind;
    const R = k0 === 'school' || k0 === 'bait' ? this.hardR : // the camera may pass through schools; fish part around it
      this.hardR + (this.R ? this.R * (k0 === 'pod' ? 0.35 : 0.8) : 0) + this.baseSize * 0.5 + 1.2;
    const ds = this.ls - c.s;
    const wl = this.wA * Math.sin(this.age * this.wF + this.wP);
    const wh = this.wA * 0.25 * Math.sin(this.age * this.wF * 1.37 + this.wP * 2);
    if (!NOEVADE.has(this.route) && !this.plan.ringMin && ds > -R && ds < R * 1.5 + c.speed * 2) { // (a mill around a landmark stays on it)
      // evade the camera: veer aside, dive or rise (solo animals); schools only shift a little and part
      const l = this.ll + wl, al = Math.abs(l), dh = this.Cy - c.y;
      const clear = h2(l, dh);
      if (clear < R) {
        const k2 = (R - clear) * Math.min(1, dt * 1.1);
        if (this.evade === 'side' || k0 === 'school' || k0 === 'bait' || k0 === 'mill') this.ll += (l >= 0 ? 1 : -1) * k2;
        else this.evH += (this.evade === 'dive' ? -1 : 1) * k2;
      }
    } else this.evH *= 1 - Math.min(1, dt * 0.15);
    const s = this.ls, x = sh.pathX(s) + this.ll + wl;
    const fl = sh.floorAt(x, s), ce = Math.min(sh.ceilingAt(x, s), 0);
    this.lFloor = fl; this.lCeil = ce;
    if (!direct) { // no water column for the group here (a shore, a lake rim, a reef flat, a low roof): back toward the open water
      const room = this._room(x, s, fl, ce), need = this.baseSize * 0.5 + 0.4;
      if (room < need && Math.abs(this.ll) > 0.5) {
        const st = Math.min(4, Math.abs(this.ll)), x2 = x - Math.sign(this.ll) * st;
        if (this._room(x2, s, sh.floorAt(x2, s), Math.min(sh.ceilingAt(x2, s), 0)) > room + 0.05) { // more room toward the path
          this.ll -= Math.sign(this.ll) * Math.min(st, Math.max(1.5, this.speed * 1.5) * Math.min(1, (need - room) / need + 0.25) * dt);
          if (this.vl * this.ll > 0) this.vl *= Math.max(0, 1 - dt * 3); // stop drifting outward (cross / overtake routes)
        }
      }
    }
    if (this.obs.length && !this.plan.ringMin) { // steer the group centre around the closest obstacle only (re-evaluated every 3rd frame)
      const rl = this.rbU * this.baseSize + Math.min((this.R || 0) * 0.5, 2) + 0.6;
      if ((this.obsFrame + 1) % (this.speed < 1 ? 6 : 3) === 0 || this.lbd === undefined) {
        let bd = 1e9, bx = 0, by = 0;
        // within 1.5 m (+ reaction distance); wide formations (pods) look as far as their flanks reach
        const qs = s + this.vs * 1.5, qy = this.Cy, m = Math.max(rl + 1.5, this.kind === 'pod' || this.kind === 'solo' ? (this.R || 0) : 0) + Math.abs(this.vs) * 0.5;
        for (let j = 0; j < this.obs.length; j++) {
          const o = this.obs[j], bb = o._bb || obsBox(o);
          if (x < bb[0] - m || x > bb[1] + m || qy < bb[2] - m || qy > bb[3] + m || qs < bb[4] - m || qs > bb[5] + m) continue;
          const abx = bb[6], aby = bb[7], abs = bb[8], l2 = bb[9];
          let t = l2 > 0 ? ((x - o.ax) * abx + (qy - o.ay) * aby + (qs - o.as) * abs) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = x - (o.ax + abx * t), dy = qy - (o.ay + aby * t), ds = qs - (o.as + abs * t);
          const dl = Math.sqrt(dx * dx + dy * dy + ds * ds) || 1e-6, d = dl - o.r - rl;
          if (d < bd) { bd = d; bx = dx / dl; by = dy / dl; }
        }
        this.lbd = bd; this.lbx = bx; this.lby = by;
      }
      const bd = this.lbd, bx = this.lbx, by = this.lby, warn = 1.5 + Math.abs(this.vs) * 0.5; // fast groups react earlier
      if ((this.kind === 'pod' || this.kind === 'solo') && this.R) { // bunch up while a rock / wall is within the formation's reach
        const want = clamp((bd + rl) / (this.R + rl), 0.5, 1);
        this.fsq += (want - this.fsq) * Math.min(1, dt * (want < this.fsq ? 2 : 0.5));
      }
      if (bd < warn) {
        // around it (harder the faster the group closes in); a centre already inside (a big berg / rock the route ran
        // into) is pushed straight out, so the members are never pulled into the rock after it
        const k3 = Math.min(warn - bd, 3) * Math.min(1, dt * (1.2 + 0.4 * Math.abs(this.vs))) + (bd < 0 ? Math.min(-bd, 4) * Math.min(1, dt * 1.5) : 0);
        const hl = Math.abs(bx) > 0.05 ? bx : (this.ll >= 0 ? 0.3 : -0.3); // head-on (normal straight back): pick the open side
        this.ll += hl * k3; this.evH += Math.max(by, 0.35) * Math.min(Math.max(1.5 - bd, 0), 1.5) * Math.min(1, dt * 1.2);
        if (this.vl * hl < 0) this.vl *= Math.max(0, 1 - dt * 2); // don't keep drifting into it
      } else if (!direct && this.route !== 'cross' && this.route !== 'crossNear' && this.route !== 'escort' && this.route !== 'curious') this.ll += (this.l0 + this.vl * this.age - this.ll) * Math.min(1, dt * 0.08); // drift back to the planned line
    } else if (this.fsq < 1) this.fsq = Math.min(1, this.fsq + dt * 0.25);
    // a group holding near the bottom keeps its centre above the low rocks / coral heads under it, not just the sand
    // (a mill around a landmark keeps its set height)
    let flo = fl;
    if (this.obs.length && !this.plan.ringMin && this.Cy - fl < this.R0() + 4) flo = Math.max(fl, this._obsTop(x, this.Cy, -s - this.anchorZ, this.rbU * this.baseSize + this.R0(), this.obs));
    const y = this._zoneY(x, s, flo, ce, wh + this.evH);
    const ny = this.Cy + (y - this.Cy) * (1 - Math.exp(-dt * 0.9));
    const nz = -s - this.anchorZ;
    const k = 1 - Math.exp(-dt * 3), jump = h3(x - this.Cx, ny - this.Cy, nz - this.Cz) > Math.max(3, this.maxSwim * dt * 3);
    if (jump) { this.Cvx = 0; this.Cvy = 0; this.Cvz = 0; } // relocated (set piece / route change): not a velocity
    else {
      this.Cvx += ((x - this.Cx) / dt - this.Cvx) * k;
      this.Cvy += ((ny - this.Cy) / dt - this.Cvy) * k;
      this.Cvz += ((nz - this.Cz) / dt - this.Cvz) * k;
    }
    this.Cx = x; this.Cy = ny; this.Cz = nz;
    const hs = h2(this.Cvx, this.Cvz);
    if (hs > 0.05) {
      const tx = this.Cvx / hs, tz = this.Cvz / hs, kk = Math.min(1, dt * 0.6);
      this.cvx += (tx - this.cvx) * kk; this.cvz += (tz - this.cvz) * kk;
      const l = h2(this.cvx, this.cvz) || 1; this.cvx /= l; this.cvz /= l;
    }
    if (this.HB) { this.hbT += dt; if (this.hbT >= 0.1) { this.hbT = 0; this.hbI = (this.hbI + 1) & 31; this.HB[this.hbI * 2] = this.cvx; this.HB[this.hbI * 2 + 1] = this.cvz; } }
    // open water? then members can skip per-agent floor sampling and terrain checks. Judged over the whole group
    // (its bounds) and a ring 4 m beyond them, not only straight down from the leader: in a blue hole or off a
    // drop-off the floor below is 100 m away while the wall is a few metres to the side.
    const b = this.bounds;
    this.openWater = this.Cy - fl > (this.R || 0) + 12 && ce - this.Cy > (this.R || 0) + 12 &&
      this._columnClear(b.x, -(this.anchorZ + b.z), b.r + 4, b.y - b.r - 2, b.y + b.r + 2);
  }

  _steer(dt, c, flock) {
    const { n, P, V, F, SL, RP, SZ, FLO, CEI, OTP } = this;
    const sh = this.sys.shape, az = this.anchorZ;
    const kind = this.kind;
    const cx = c.x, cy = c.y, cz = c.z - az;
    const px2 = cx + c.vx * 1.2, py2 = cy, pz2 = cz + c.vz * 1.2;
    const sgx = px2 - cx, sgz = pz2 - cz, sgl = sgx * sgx + sgz * sgz;
    const spd0 = this.speed;
    const maxS = flock ? Math.max(spd0 * 2.2, h2(this.Cvx, this.Cvz) * 1.5 + 0.5) : spd0 * 4 + 0.6;
    const kp = flock ? (kind === 'solo' ? 0.6 : kind === 'pod' ? 0.7 : 1.1) : 0.5;
    const ka = flock ? (this.baseSize > 3 ? 0.8 : 2.5) : 2.2;
    const avR = this.hardR + (flock ? 1.6 + this.baseSize * 0.6 : 1.3) + this.alertR; // calm fish let the camera within ~3 m
    // per-agent floor/ceiling sampling (round-robin)
    const needFloor = !flock || !this.openWater;
    if (needFloor) {
      const K = Math.min(n, Math.max(2, Math.ceil(n / 12)));
      const ceil = sh.hasCeiling(-(this.bounds.z + az));
      for (let j = 0; j < K; j++) {
        const i = this.rr = (this.rr + 1) % n;
        const x = P[i * 3], s = -(P[i * 3 + 2] + az);
        const fl = sh.floorAt(x, s), ce = ceil ? Math.min(sh.ceilingAt(x, s), 0) : 0, m = this.mFloor * 0.5 + SZ[i] * 0.15;
        FLO[i] = fl + m; CEI[i] = Math.min(ce - this.mCeil * 0.6, this.surfY);
        // low rocks and coral heads under it count as floor too (a school holding at the bottom sat inside them)
        OTP[i] = this.obs.length ? this._obsTop(x, P[i * 3 + 1], P[i * 3 + 2], this.rbU * SZ[i] + 0.05, this._obsList(x, P[i * 3 + 2])) + m : -1e4;
      }
    } else {
      const lo = this.lFloor + this.mFloor * 0.5, hi = Math.min(this.lCeil - this.mCeil * 0.6, this.surfY);
      if (FLO[0] !== lo) { FLO.fill(lo); CEI.fill(hi); OTP.fill(-1e4); }
    }
    // agent LOD: agents reacting to the camera (inside its avoidance range) or startled steer every frame; the
    // others every 2nd frame (every 3rd when smaller than ~12 px), coasting in between (staggered across agents)
    const fastObs = this.fast && this.obs.length > 0;
    const coastOK = n >= 4 && !this.event && !fastObs, fc = ++this.fc, PH = this.PH, BF = this.BF, ACC = this.ACC, nearR2 = (avR + 1.5) * (avR + 1.5);
    const ceilClamp = this.fast && sh.hasCeiling(-(this.bounds.z + az)), hh0 = Math.max(-this.entry.minY, 0.04), terr = this.terrainOn;
    this._cx = cx; this._cy = cy; this._cz = cz;
    // predators in or around a bait ball (double-buffered: written by the hunters each frame)
    if (this.threatsNext) { const t = this.threats; this.threats = this.threatsNext; this.threatsNext = t; this.nThreat = this.nThreatNext; this.nThreatNext = 0; }
    const TH = this.nThreat ? this.threats : null, nT = this.nThreat;
    const ev = this.event, strike = ev && ev.type === 'strike' ? ev : null;
    if (strike && strike.prey && !strike.prey.done) { // dashes, and tell the bait where the hunters are
      const pr = strike.prey, dz = this.anchorZ - pr.anchorZ, R2 = ((pr.R || 3) + 3) ** 2;
      if (!pr.threatsNext) { pr.threatsNext = new Float32Array(24); pr.threats = new Float32Array(24); pr.nThreatNext = 0; }
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        this.TMR[i] -= dt;
        if (this.TMR[i] < 0) { if (this.MODE[i] === 1) { this.MODE[i] = 0; this.TMR[i] = 2 + this.rng() * 4; } else { this.MODE[i] = 1; this.TMR[i] = 1.3 + this.rng() * 0.6; } }
        const x = P[i3], y = P[i3 + 1], z = P[i3 + 2] + dz, ex = x - pr.Cx, ey = y - pr.Cy, ez = z - pr.Cz;
        if (ex * ex + ey * ey + ez * ez < R2 && pr.nThreatNext < 8) { const k = pr.nThreatNext++ * 3; pr.threatsNext[k] = x; pr.threatsNext[k + 1] = y; pr.threatsNext[k + 2] = z; }
      }
    }
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, o = i * 4;
      if (coastOK) {
        const ax = P[i3] - cx, ay = P[i3 + 1] - cy, az2 = P[i3 + 2] - cz, d2 = ax * ax + ay * ay + az2 * az2;
        const k = d2 < nearR2 || this.STL[i] > 0.05 ? 1 : SZ[i] * SZ[i] * 2500 < d2 ? 3 : 2;
        if (k > 1 && (i + fc) % k !== 0) {
          const vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2], ox = P[i3], oy = P[i3 + 1], oz = P[i3 + 2];
          P[i3] += vx * dt; P[i3 + 1] += vy * dt; P[i3 + 2] += vz * dt;
          let ph = PH[i] + TAU * BF[i] * dt; if (ph > PH_WRAP) ph -= PH_WRAP; PH[i] = ph;
          ACC[i] += dt;
          let ctop = Infinity;
          if (ceilClamp) {
            const hx = P[i3] + F[i3] * SZ[i] * 0.45, hz = P[i3 + 2] + F[i3 + 2] * SZ[i] * 0.45;
            ctop = Math.min(sh.ceilingAt(P[i3], -(P[i3 + 2] + az)), sh.ceilingAt(hx, -(hz + az)), 0) - SZ[i] * Math.max(hh0, F[i3 + 1] * 0.45 + hh0 * 0.75) - 0.06;
            if (P[i3 + 1] > ctop) { P[i3 + 1] = ctop; if (V[i3 + 1] > 0) V[i3 + 1] = 0; }
          }
          if (this.obs.length) {
            this.CLR[i] -= h3(vx, vy, vz) * dt + 0.01;
            if (this.CLR[i] < 0.05) {
              if (!this._pushOut(i, P, V, ctop)) { P[i3] -= vx * dt; P[i3 + 1] -= vy * dt; P[i3 + 2] -= vz * dt; V[i3] = V[i3 + 1] = V[i3 + 2] = 0; this._unstick(i); }
              this.CLR[i] = Math.min(this._clear(i, P[i3], P[i3 + 1], P[i3 + 2], 1, this._obsList(P[i3], P[i3 + 2])), 1.8) - (this.elong ? this.SZ[i] * 0.45 : 0);
            }
          }
          if (terr) this._terrainTick(i, h3(P[i3] - ox, P[i3 + 1] - oy, P[i3 + 2] - oz), 0); // incl. obstacle push-outs
          continue;
        }
      }
      const dts = Math.min(ACC[i] + dt, 0.25); ACC[i] = 0;
      if (flock && ((fc + i) & 31) === 0) this._rejoin(i, c);
      let tx, ty, tz, tvx = 0, tvy = 0, tvz = 0;
      if (flock) {
        const t = this._slotTarget(i, dts);
        tx = t[0]; ty = t[1]; tz = t[2]; tvx = t[3]; tvy = t[4]; tvz = t[5];
      } else {
        const w = this.age * (0.08 + RP[o] * 0.12) + RP[o + 1] * TAU;
        const rw = kind === 'hover' ? 0.35 : (0.6 + RP[o + 2] * 0.8) * clamp(this.baseSize * 8, 0.5, 2.5);
        tx = SL[o] + Math.sin(w) * rw; ty = SL[o + 1] + Math.sin(w * 1.7) * rw * 0.25; tz = SL[o + 2] + Math.cos(w * 0.77) * rw;
        if (this.terrainOn) { // the wander point stays in the water: up with the sand on a slope, back home at a steep face
          const ft = sh.floorAt(tx, -(tz + az)) + SZ[i] * 0.5 + 0.1;
          if (ty < ft) { if (ft - SL[o + 1] > rw * 0.5 + 0.5) { tx = SL[o]; ty = SL[o + 1]; tz = SL[o + 2]; } else ty = ft; }
        }
        if (i === this.inspect) { // the curious one: up beside the camera's line, 2.5-4 m from the lens as it passes
          const sf = -(P[i3 + 2] + az), off = c.x - sh.pathX(c.s);
          tx = sh.pathX(sf) + off + this.inspX; ty = c.y + this.inspY; tz = P[i3 + 2];
          this.inspT -= dts;
          if (sf < c.s - 2.5 && this.inspT > 1.2) this.inspT = 1.2;
          if (this.inspT <= 0) this.inspect = -1;
        }
        RP[o + 3] -= dts;
        if (RP[o + 3] < 0 && kind === 'shoal') { // drift to a new spot within the patch
          RP[o + 3] = 6 + this.rng() * 20;
          const a = this.rng() * TAU, r = this.plan.ring ? this.plan.ring * (0.92 + 0.16 * this.rng()) : Math.sqrt(this.rng()) * this.spread;
          const alt = this.sp.beh.alt || [0.5, 2];
          this._setHome(i, this.homeX + Math.cos(a) * r, this.homeZ + Math.sin(a) * r * 1.4, alt[0] + (alt[1] - alt[0]) * this.rng(), this.plan);
        }
      }
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2], f0x = F[i3], f0y = F[i3 + 1], f0z = F[i3 + 2], b0 = this.BANK[i] + (this.SPIN ? this.SPIN[i] : 0);
      let dvx = (tx - px) * kp + tvx, dvy = (ty - py) * kp + tvy, dvz = (tz - pz) * kp + tvz;
      let dl = h3(dvx, dvy, dvz);
      const mS = strike && this.MODE[i] === 1 ? maxS * 2.6 : maxS;
      if (dl > mS) { const f = mS / dl; dvx *= f; dvy *= f; dvz *= f; }
      if (TH) for (let k = 0; k < nT; k++) { // the ball splits around hunters
        const qx = px - TH[k * 3], qy = py - TH[k * 3 + 1], qz = pz - TH[k * 3 + 2], d2 = qx * qx + qy * qy + qz * qz;
        if (d2 < 7.3 && d2 > 1e-4) { const d = Math.sqrt(d2), f = (2.7 - d) / d * 3.2; dvx += qx * f; dvy += qy * f; dvz += qz * f; this.STL[i] = 1; }
      }
      // camera avoidance (capsule along the camera's motion)
      let qx = px - cx, qz = pz - cz;
      let tq = sgl > 1e-6 ? clamp((qx * sgx + qz * sgz) / sgl, 0, 1) : 0;
      let ex = px - (cx + sgx * tq), ey = py - py2, ez = pz - (cz + sgz * tq);
      let ed = h3(ex, ey, ez);
      const STL = this.STL;
      const OA = this.OA;
      if (this.obs.length) {
        if (fastObs || (i + this.obsFrame) % 3 === 0) { // look ahead along the velocity: around, and over low rocks (staggered)
          const OL = this._obsList(px, pz);
          OA[i3] = OA[i3 + 1] = OA[i3 + 2] = 0;
          if (OL.length) {
            const T = 0.8 + this.SZ[i] * 0.2;
            const dC = this._clear(i, px, py, pz, 1, OL);
            this.CLR[i] = Math.min(dC, 1.8) - (this.elong ? this.SZ[i] * 0.45 : 0); // _clear sees 1.8 m out
            const thr = 0.7 + this.SZ[i] * 0.6;
            // the look-ahead clearance can't be below dC - |v|T - half length (skip the test when that is already clear)
            const reach = h3(V[i3], V[i3 + 1], V[i3 + 2]) * T + (this.elong ? this.SZ[i] * 0.42 : 0);
            const dA = Math.min(dC, 1.8) - reach >= thr ? 1e9
              : Math.min(this._clear(i, px + V[i3] * T, py + V[i3 + 1] * T, pz + V[i3 + 2] * T, flock && n > 30 ? 1 : 3, OL), dC + 0.2);
            if (dA < thr) {
              const k4 = (thr - dA) / thr * (maxS + 1.2) * 1.6;
              OA[i3] = _hit.nx * k4; OA[i3 + 1] = (_hit.ny > -0.3 ? _hit.ny + 0.35 : _hit.ny) * k4; OA[i3 + 2] = _hit.nz * k4;
            }
          } else this.CLR[i] = 1.8 - (this.elong ? this.SZ[i] * 0.45 : 0);
        }
        const oax = OA[i3], oay = OA[i3 + 1], oaz = OA[i3 + 2];
        if (oax !== 0 || oay !== 0 || oaz !== 0) {
          // slide around it: drop the part of the wanted velocity that points into the rock (a slot or home behind a big
          // rock would otherwise hold the animal pressed against it until it wedges); head-on, slip off to one side
          const ol = h3(oax, oay, oaz), nx = oax / ol, ny = oay / ol, nz = oaz / ol, vn = dvx * nx + dvy * ny + dvz * nz;
          if (vn < 0) {
            dvx -= nx * vn; dvy -= ny * vn; dvz -= nz * vn;
            if (dvx * dvx + dvz * dvz < vn * vn * 0.09) { const sd = i & 1 ? -vn : vn; dvx += nz * sd; dvz -= nx * sd; }
          }
          dvx += oax; dvy += oay; dvz += oaz;
        }
      }
      if (ed < avR && ed > 1e-4 && i !== this.inspect) {
        const push = (avR - ed) / avR * (2.5 + spd0 * 2) * (flock ? 1.6 : 2.4) * (1 + STL[i]);
        dvx += ex / ed * push; dvy += ey / ed * push * 0.7; dvz += ez / ed * push;
        if (ed < avR * 0.75 && this.baseSize < 2) STL[i] = 1; // startle: a quick dart away
      }
      STL[i] = Math.max(0, STL[i] - dts * 0.8);
      const ka2 = Math.min(1, ka * dts * (1 + 3 * STL[i]));
      let vx = V[i3] + (dvx - V[i3]) * ka2, vy = V[i3 + 1] + (dvy - V[i3 + 1]) * ka2, vz = V[i3 + 2] + (dvz - V[i3 + 2]) * ka2;
      // floor / ceiling (soft; the soft floor also rises over low rocks, the hard clamp below is the sand only)
      const lo = FLO[i], hi = CEI[i], lr = OTP[i] > lo && OTP[i] < hi ? OTP[i] : lo;
      if (hi > lo) {
        if (py < lr) vy += (lr - py) * 3 * dts + 0.5 * dts;
        else if (py > hi) vy -= (py - hi) * 3 * dts + 0.5 * dts;
      } else { // inside a wall: head back toward the path centre
        const s = -(pz + az); vx += (sh.pathX(s) - px) * 0.5 * dts; vy += (sh.pathY(s) - py) * 0.5 * dts;
      }
      let nx = px + vx * dt, ny = py + vy * dt, nz = pz + vz * dt;
      if (hi > lo) { if (ny < lo - 0.4) { ny = lo - 0.4; if (vy < 0) vy = 0; } if (ny > hi + 0.3) { ny = hi + 0.3; if (vy > 0) vy = 0; } }
      let ctop = Infinity;
      if (ceilClamp) { // exact ceiling right here and over the head (ice keels are cliffs, cave roofs): never swim up into it
        const hx = nx + F[i3] * SZ[i] * 0.45, hz = nz + F[i3 + 2] * SZ[i] * 0.45;
        ctop = Math.min(sh.ceilingAt(nx, -(nz + az)), sh.ceilingAt(hx, -(hz + az)), 0) - SZ[i] * Math.max(hh0, F[i3 + 1] * 0.45 + hh0 * 0.75) - 0.06;
        if (ny > ctop) { ny = ctop; if (vy > 0) vy = 0; }
      }
      // hard bubble
      qx = nx - cx; qz = nz - cz;
      tq = sgl > 1e-6 ? clamp((qx * sgx + qz * sgz) / sgl, 0, 1) * 0.3 : 0;
      ex = nx - (cx + sgx * tq); ey = ny - cy; ez = nz - (cz + sgz * tq);
      ed = h3(ex, ey, ez);
      const hr = this.hardR + SZ[i] * 0.2;
      if (ed < hr) {
        const f = (ed > 1e-4 ? 1 / ed : 0);
        const ux = ed > 1e-4 ? ex * f : 0, uy = ed > 1e-4 ? ey * f : 1, uz = ed > 1e-4 ? ez * f : 0;
        nx = cx + sgx * tq + ux * hr; ny = cy + uy * hr; nz = cz + sgz * tq + uz * hr;
        const vn = vx * ux + vy * uy + vz * uz; if (vn < 0) { vx -= vn * ux; vy -= vn * uy; vz -= vn * uz; }
        if (ny > ctop) { ny = ctop; if (vy > 0) vy = 0; } // the camera bubble must not push it into the ice either
      }
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
      P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz;
      if (kind === 'bait' || kind === 'mill') // a drifting ball: fish face their milling direction, not the drift
        this._orient(i, dts, vx - this.Cvx * 0.85, vy - this.Cvy * 0.85, vz - this.Cvz * 0.85, dt);
      else if (i === this.inspect) { const lk = this.lookCam; this.lookCam = 0.85; this._orient(i, dts, vx, vy, vz, dt); this.lookCam = lk; }
      else this._orient(i, dts, vx, vy, vz, dt);
      if (this.cork) { // sea lions: playful corkscrew rolls
        if (this.SPIN[i] > 0 || (this.speed > 0.5 && this.rng() < dts * 0.06)) {
          this.SPIN[i] += dts * 5.2;
          if (this.SPIN[i] >= TAU * (1 + (i & 1))) this.SPIN[i] = 0;
        }
      }
      if (this.obs.length) { // exact correction (after the heading update) only when the clearance budget could be used up
        this.CLR[i] -= h3(nx - px, ny - py, nz - pz) + 0.01; // actual displacement (incl. camera-bubble pushes)
        if (this.CLR[i] < 0.05) {
          if (!this._pushOut(i, P, V, ctop)) { P[i3] = px; P[i3 + 1] = Math.min(py, ctop); P[i3 + 2] = pz; V[i3] = V[i3 + 1] = V[i3 + 2] = 0; this._unstick(i); } // wedged: undo the step
          this.CLR[i] = Math.min(this._clear(i, P[i3], P[i3 + 1], P[i3 + 2], 1, this._obsList(P[i3], P[i3 + 2])), 1.8) - (this.elong ? this.SZ[i] * 0.45 : 0);
        }
      }
      if (terr) {
        let db = this.BANK[i] + (this.SPIN ? this.SPIN[i] : 0) - b0; db -= TAU * Math.round(db / TAU); // rolling swings the flippers / fins up and down
        this._terrainTick(i, h3(P[i3] - px, P[i3 + 1] - py, P[i3 + 2] - pz), h3(F[i3] - f0x, F[i3 + 1] - f0y, F[i3 + 2] - f0z) + Math.abs(db) * 0.4);
      }
    }
    this._writeAll(dt);
  }

  // One individual of a shoal comes up to inspect the camera (director close encounters): the member
  // nearest to the camera's line ahead, holding 2.5-4 m to its own side of the line.
  startInspect(c) {
    const sh = this.sys.shape, P = this.P, az = this.anchorZ;
    let bi = -1, bd = 1e9;
    for (let i = 0; i < this.n; i++) {
      const s = -(P[i * 3 + 2] + az);
      if (s < c.s + 6) continue;
      const d = Math.abs(P[i * 3] - sh.pathX(s)) + Math.abs(P[i * 3 + 1] - sh.pathY(s)) * 0.7;
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) return false;
    const s = -(P[bi * 3 + 2] + az), side = P[bi * 3] >= sh.pathX(s) ? 1 : -1;
    this.inspect = bi; this.inspT = 16;
    this.inspX = side * Math.max(2.5 + this.rng() * 1.3, this.hardR + 0.5); this.inspY = this.rng() * 0.9 - 0.6;
    return true;
  }

  // heading, bank, body bend and tail-beat phase from velocity
  _orient(i, dt, vx, vy, vz, dtPh = dt) {
    const F = this.F, i3 = i * 3;
    let spd = h3(vx, vy, vz);
    if (this.lookCam > 0 && spd > 0.04) { // turn toward the camera (a curious look)
      const P = this.P, tx = this._cx - P[i3], ty = this._cy - P[i3 + 1], tz = this._cz - P[i3 + 2], tl = h3(tx, ty, tz) || 1, w = 0.55 * this.lookCam;
      vx = vx * (1 - w) + tx / tl * spd * w; vy = vy * (1 - w) + ty / tl * spd * w; vz = vz * (1 - w) + tz / tl * spd * w;
      spd = h3(vx, vy, vz);
    }
    const ofx = F[i3], ofz = F[i3 + 2];
    if (spd > 0.04) {
      const k = Math.min(1, this.turnRate * dt * clamp(spd / (this.speed + 0.1), 0.3, 1.5));
      let fx = F[i3] + (vx / spd - F[i3]) * k, fy = F[i3 + 1] + (vy / spd - F[i3 + 1]) * k, fz = F[i3 + 2] + (vz / spd - F[i3 + 2]) * k;
      const mp = this.maxPitch;
      let l = h3(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
      if (fy > mp || fy < -mp) { fy = fy > 0 ? mp : -mp; const h = h2(fx, fz) || 1, sc = Math.sqrt(1 - mp * mp) / h; fx *= sc; fz *= sc; }
      F[i3] = fx; F[i3 + 1] = fy; F[i3 + 2] = fz;
    } else if (this.kind !== 'hover' && this.kind !== 'octo') { // level out when idle
      F[i3 + 1] *= 1 - Math.min(1, dt); const h = h2(F[i3], F[i3 + 2]) || 1, sc = Math.sqrt(1 - F[i3 + 1] * F[i3 + 1]) / h; F[i3] *= sc; F[i3 + 2] *= sc;
    }
    // yaw rate from the change of heading projected on the right vector (Fz, 0, -Fx)
    const h = h2(F[i3], F[i3 + 2]) || 1;
    const yaw = ((F[i3] - ofx) * (F[i3 + 2] / h) + (F[i3 + 2] - ofz) * (-F[i3] / h)) / Math.max(dt, 1e-3);
    const sz = this.SZ[i];
    // body curvature follows the path: bend = kappa * L / 2 (unit-length body coordinates)
    const m = this.mot;
    const bt = clamp((yaw / Math.max(spd, 0.3)) * sz * 0.5, -0.25, 0.25) * (m.mode === 1 ? 0.6 : 1);
    this.BEND[i] += (bt - this.BEND[i]) * Math.min(1, dt * 4);
    if (this.browse && spd < 0.3) { // goatfish & co: nose down, rooting in the sand
      F[i3 + 1] += (-0.5 - F[i3 + 1]) * Math.min(1, dt * 1.5);
      const hh = h2(F[i3], F[i3 + 2]) || 1, sc2 = Math.sqrt(Math.max(0, 1 - F[i3 + 1] * F[i3 + 1])) / hh; F[i3] *= sc2; F[i3 + 2] *= sc2;
    }
    const bankT = this.bankBase + clamp(yaw * spd * 0.35, -0.6, 0.6) * (this.baseSize > 4 ? 0.5 : 1);
    this.BANK[i] += (bankT - this.BANK[i]) * Math.min(1, dt * 2);
    const freq = ((m.beat || 0) * spd / sz + (m.idle || 0.5) * (0.85 + 0.3 * this.RP[i * 4 + 2])) * this.FQ[i];
    let ph = this.PH[i] + TAU * freq * dtPh; if (ph > PH_WRAP) ph -= PH_WRAP; this.PH[i] = ph; this.BF[i] = freq;
    let at = clamp(0.3 + 0.75 * spd / (this.speed + 0.15), 0.3, 1.6);
    // gliding phases between bursts of propulsion (rays, sharks, turtles, larger fish)
    if (this.glides && this.baseSize > 0.35 && this.STL[i] < 0.1) {
      const g = Math.sin(this.age * 0.17 + this.RP[i * 4] * 20) + 0.5 * Math.sin(this.age * 0.41 + this.RP[i * 4 + 1] * 9);
      if (g > 0.7) at *= 0.25;
    }
    at = Math.max(at, this.STL[i] * 1.6);
    this.AMP[i] += (at - this.AMP[i]) * Math.min(1, dt * 1.5);
  }

  // Bottom dwellers that rest on the sand (rays, flatfish, guitarfish, lizardfish, nurse sharks):
  // they lift off when the camera comes near, glide away a few metres and settle again.
  _rest(dt, c) {
    const { n, P, V, F, SL, MODE, TMR } = this;
    const sh = this.sys.shape, az = this.anchorZ, beh = this.sp.beh;
    const cx = c.x, cy = c.y, cz = c.z - az;
    const lx = cx + c.vx * 1.5, lz = cz + c.vz * 1.5; // where the camera will be shortly
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, o = i * 4;
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
      const dc = Math.min(h3(px - cx, (py - cy) * 0.5, pz - cz), h3(px - lx, (py - cy) * 0.5, pz - lz)); // mostly horizontal: the camera passes overhead
      if (MODE[i] === 0 && this.obs.length) { // rest groups are tiny: check every frame
        const d = this._clear(i, px, py, pz);
        if (d < 0.03) { // something solid appeared here: hop clear, then glide to free sand nearby
          this._pushOut(i, P, V);
          const [hx, hz] = this._freeSpot(P[i3], P[i3 + 2], this.rbU * this.SZ[i] + 0.3, true);
          this.HOME[i * 2] = hx; this.HOME[i * 2 + 1] = hz; MODE[i] = 2; this.STL[i] = 0.4;
          continue;
        }
      }
      if (MODE[i] === 0) {
        V[i3] = V[i3 + 1] = V[i3 + 2] = 0;
        if (dc < SL[o + 3]) { // lift off: glide away from the camera's line, diagonally forward
          MODE[i] = 1; TMR[i] = 5 + this.rng() * 6; this.STL[i] = 0.6;
          if (this.perched) this.perched[i] = 0;
          let ax = px - cx, az2 = pz - cz; const al = h2(ax, az2) || 1; ax /= al; az2 /= al;
          const side = Math.abs(px - sh.pathX(-(pz + az))) < 0.5 ? (this.rng() < 0.5 ? -1 : 1) : Math.sign(px - sh.pathX(-(pz + az)));
          const dx = ax * 0.5 + side * 0.85, dz = az2 * 0.5 - 0.35, dl = h2(dx, dz) || 1;
          const alt = beh.alt ? beh.alt[0] + (beh.alt[1] - beh.alt[0]) * this.rng() : 0.6;
          this.HOME[i * 2] = px + dx / dl * 14; this.HOME[i * 2 + 1] = pz + dz / dl * 14;
          this.TMR[i] += 0; this.FLO[i] = alt;
        }
        this._orient(i, dt, 0, 0, 0);
        this.AMP[i] = 0.12;
        continue;
      }
      const s = -(pz + az), fl = sh.floorAt(px, s);
      let tx = this.HOME[i * 2], tz = this.HOME[i * 2 + 1], ty = fl + (MODE[i] === 1 ? this.FLO[i] : this._restLift(i));
      let dx = tx - px, dy = ty - py, dz = tz - pz;
      const dl = h3(dx, dy, dz) || 1;
      const spd = MODE[i] === 1 ? this.speed * (1 + this.STL[i]) : this.speed * 0.4;
      let dvx = dx / dl * spd, dvy = dy / dl * spd * 0.8, dvz = dz / dl * spd;
      if (MODE[i] === 2 && dl < 0.6) { dvx *= dl; dvz *= dl; }
      const ka2 = Math.min(1, dt * 1.6);
      let vx = V[i3] + (dvx - V[i3]) * ka2, vy = V[i3 + 1] + (dvy - V[i3 + 1]) * ka2, vz = V[i3 + 2] + (dvz - V[i3 + 2]) * ka2;
      let nx = px + vx * dt, ny = Math.max(py + vy * dt, fl + this._restLift(i)), nz = pz + vz * dt;
      // never through the camera
      const ex = nx - cx, ey = ny - cy, ez = nz - cz, ed = h3(ex, ey, ez), hr = this.hardR;
      if (ed < hr && ed > 1e-4) { nx = cx + ex / ed * hr; ny = cy + ey / ed * hr; nz = cz + ez / ed * hr; }
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz; P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz;
      this._orient(i, dt, vx, vy, vz); // heading first: the final correction must see the final pose
      if (this.obs.length) {
        const dA = this._clear(i, nx + vx, ny + vy, nz + vz);
        if (dA < 0.8) { V[i3] += _hit.nx * (0.8 - dA) * dt * 4; V[i3 + 1] += Math.max(_hit.ny, 0.4) * (0.8 - dA) * dt * 4; V[i3 + 2] += _hit.nz * (0.8 - dA) * dt * 4; }
        this._pushOut(i, P, V);
      }
      if (this.terrainOn) this._terrainTick(i, h3(P[i3] - px, P[i3 + 1] - py, P[i3 + 2] - pz), 0.05);
      this.STL[i] = Math.max(0, this.STL[i] - dt * 0.3);
      TMR[i] -= dt;
      if (MODE[i] === 1 && (TMR[i] < 0 || dl < 1)) {
        MODE[i] = 2;
        const [hx, hz] = this._freeSpot(nx + vx * 1.5, nz + vz * 1.5, this.rbU * this.SZ[i] + 0.1, true); // settle beside rocks
        this.HOME[i * 2] = hx; this.HOME[i * 2 + 1] = hz;
      }
      if (MODE[i] === 2 && ny <= fl + this._restLift(i) + 0.05 && dc > SL[o + 3] * 0.8) { MODE[i] = 0; P[i3 + 1] = fl + this._restLift(i); if (this.obs.length) this._pushOut(i, P, V); }
    }
    this._writeAll(dt);
  }

  // Resting height of octopus i: on the sand or its perch. Never on a rock's collision capsule: the body sphere sat
  // ~0.2 m above the capsule top and the flat arm spread floated over the domed rock (one over a rock crawls off it).
  _octoRest(i, px, py, pz, fl) {
    return (this.perched && this.perched[i] ? this.perchY : fl) + this._restLift(i);
  }
  // Clearance an octopus keeps from rocks where it rests: the arm span (~0.62 size, up to +13% per individual) and the
  // skirt of a rock beyond its collision capsule (with the body radius only, arms lay through rocks and under slabs)
  _octoR(i) { return 0.7 * this.SZ[i] + 0.15; }
  // A resting octopus's rock push-out (from ox, oy, oz): only sideways along the sand, at most `cap` m, and not at all
  // where the push is mostly upward. Lifted, it bounced between the sand and the rock top; deep in a coral thicket the
  // sideways part flipped from side to side (a 1.2 m jitter every frame); held at its height, the separation push
  // downhill and this push back uphill ratcheted it ~0.3 m into the bottom. The crawl to free sand takes it out.
  _octoSlide(i, ox, oy, oz, cap) {
    const P = this.P, i3 = i * 3, sh = this.sys.shape, az = this.anchorZ;
    const hx = P[i3] - ox, hz = P[i3 + 2] - oz, hl = h2(hx, hz), c = P[i3 + 1] - oy > hl ? 0 : cap;
    if (hl > c) { P[i3] = ox + hx / hl * c; P[i3 + 2] = oz + hz / hl * c; }
    P[i3 + 1] = oy + this._octoRest(i, 0, 0, 0, sh.floorAt(P[i3], -(P[i3 + 2] + az))) - this._octoRest(i, 0, 0, 0, sh.floorAt(ox, -(oz + az)));
  }
  // Send octopus i crawling to the nearest clear spot (_octoSpot); with none better nearby it looks again in 3 s
  // (the search costs ~0.5-1 ms)
  _octoClear(i, x, z) {
    const [hx, hz] = this._octoSpot(i, x, z);
    if (h2(hx - x, hz - z) < 0.1) { this.OCT[i] = -3; return; }
    this.HOME[i * 2] = hx; this.HOME[i * 2 + 1] = hz; this.OCL[i] = 1; this.OCT[i] = 0;
  }
  // Nearest sand spot (relative x, z) where octopus i's arms clear every rock, on rings out to 8 m (_freeSpot tests
  // 0.5 m up a rock's side and often led it further in). Rare (blocked octopuses only); returns a shared pair.
  _octoSpot(i, x, z) {
    const need = 0.45 * this.SZ[i], sh = this.sys.shape, az = this.anchorZ, a0 = this.RP[i * 4] * TAU;
    let best = this._clear(i, x, sh.floorAt(x, -(z + az)) + this._restLift(i), z, 1) + 0.1; // (else the roomiest spot)
    _spot[0] = x; _spot[1] = z;
    for (let r = 0.5; r <= 8; r += r < 4 ? 0.5 : 1) { // (reef crevices: nothing clear for 4 m around)
      for (let k = 0; k < 8; k++) {
        const a = a0 + k * (TAU / 8), qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        // not onto another octopus (partners and nearby groups went to the same spot, and the separation pushed them back)
        let near = false;
        for (const e of this.sys.enc) {
          if (e.kind !== 'octo') continue;
          const dz = e.anchorZ - az;
          for (let j = 0; j < e.n && !near; j++) near = (e !== this || j !== i) && h2(e.P[j * 3] - qx, e.P[j * 3 + 2] + dz - qz) < 0.7 * (this.SZ[i] + e.SZ[j]);
          if (near) break;
        }
        if (near) continue;
        const d = this._clear(i, qx, sh.floorAt(qx, -(qz + az)) + this._restLift(i), qz, 1);
        if (d >= need) { _spot[0] = qx; _spot[1] = qz; return _spot; }
        if (d > best) { best = d; _spot[0] = qx; _spot[1] = qz; }
      }
    }
    return _spot;
  }

  // Largest arm stream (JET) that keeps the arm tips clear of the bottom by the terrain fix's margin: the clearance is
  // measured along the floor normal, and the tips (~0.56 size out, see _terrainFix) reach toward the slope both by
  // trailing behind and, while still spread, by the pitch (up to ~0.95 size per unit of JET).
  _octoRoom(i, py, fl) {
    const sz = this.SZ[i];
    return ((py - fl) * this.NRM[i * 3 + 1] - 0.06 - 0.035 * sz) / (0.95 * sz);
  }

  // Octopus: crawls slowly over the bottom (arms rippling), jets away mantle-first when startled
  // (arms streaming behind, skin blanching), then glides back down and settles.
  _octo(dt, c) {
    const { n, P, V, F, SL, MODE, TMR, JET, NRM, HOME } = this;
    const sh = this.sys.shape, az = this.anchorZ;
    const cx = c.x, cy = c.y, cz = c.z - az;
    // jet axis the body pitches onto (weighted by JET in _writeAll / _frame): eased toward the velocity while jetting,
    // held while settling (tied to V itself, the body snapped round whenever V turned with JET still up)
    if (!this.AX || this.AX.length < n * 3) this.AX = new Float32Array(n * 3);
    const AX = this.AX;
    if (!this.OCL || this.OCL.length < n) { this.OCL = new Uint8Array(n); this.OCT = new Float32Array(n); } // crawling clear of a rock (flag, time)
    const OCL = this.OCL, OCT = this.OCT;
    this.fc++;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, o = i * 4;
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2], s = -(pz + az);
      const fl = sh.floorAt(px, s);
      const dc = h3(px - cx, (py - cy) * 0.5, pz - cz);
      TMR[i] -= dt;
      if (this.IFD && this.IFD[i] < 1 && !OCL[i]) this.IFD[i] = Math.min(1, this.IFD[i] + dt * 0.8); // fading back in
      if (OCT[i] < 0 && !OCL[i]) OCT[i] = Math.min(0, OCT[i] + dt); // no clear spot found: looks again later
      if (MODE[i] === 0) {
        const w = this.age * 0.05 + this.RP[o] * TAU, wr = this.den ? 0 : 1.5;
        // arms in a rock (often one registered after it settled): crawl clear (hysteresis: the spot clears 0.45 size)
        if (this.obs.length && !OCL[i] && OCT[i] >= 0 && !this.den && !(this.perched && this.perched[i]) && ((this.fc + i + this.uid) & 15) === 0 && this._clear(i, px, py, pz, 1) < 0.3 * this.SZ[i]) this._octoClear(i, px, pz);
        let tx = HOME[i * 2], tz = HOME[i * 2 + 1];
        if (OCL[i]) { // straight to the free spot
          _sphere.center.set(px, py, this.anchorZ + pz - c.Oz); _sphere.radius = this.SZ[i];
          const hidden = dc > 25 || !c.frustum.intersectsSphere(_sphere);
          if (h2(tx - px, tz - pz) < 0.1) { OCL[i] = 0; OCT[i] = 0; }
          else if (hidden || ((OCT[i] += dt) > 4 && this._clear(i, px, py, pz, 1) < 0)) {
            // out of sight it is just there; still inside a rock after 4 s (pinned by an animal that never moves) it
            // fades out like camouflage, and back in on the sand
            const IFD = this.IFD || (this.IFD = new Float32Array(n).fill(1));
            if (hidden) IFD[i] = Math.min(IFD[i], 0.01); else IFD[i] -= dt * 1.5;
            if (IFD[i] <= 0.01) {
              const hs = -(tz + az), nn = sh.floorNormal(tx, hs);
              P[i3] = tx; P[i3 + 2] = tz; P[i3 + 1] = sh.floorAt(tx, hs) + this._restLift(i); V[i3] = V[i3 + 2] = 0; OCL[i] = 0; OCT[i] = 0; IFD[i] = 0;
              NRM[i3] = nn.x; NRM[i3 + 1] = nn.y; NRM[i3 + 2] = nn.z;
            }
            continue;
          }
        }
        else {
          tx += Math.sin(w) * wr; tz += Math.cos(w * 0.8) * wr;
          if (this.obs.length && this._clear(i, tx, py, tz, 1) < 0.45 * this.SZ[i] + 0.1) { tx = px; tz = pz; } // don't crawl into rocks (arms included)
        }
        let dx = tx - px, dz = tz - pz; const dl = h2(dx, dz) || 1;
        // ease in on the target (it moves slower than the octopus, which overshot it and reversed every frame) and
        // steer the velocity instead of setting it
        const spd = (OCL[i] ? Math.max(this.speed, 0.15) : this.speed * (0.5 + 0.5 * Math.max(0, Math.sin(this.age * 0.6 + this.RP[o + 1] * 9)))) * Math.min(1, dl / 0.4), kv = Math.min(1, dt * 2);
        V[i3] += (dx / dl * spd - V[i3]) * kv; V[i3 + 2] += (dz / dl * spd - V[i3 + 2]) * kv; V[i3 + 1] = 0;
        P[i3] = px + V[i3] * dt; P[i3 + 2] = pz + V[i3 + 2] * dt;
        P[i3 + 1] += (this._octoRest(i, px, py, pz, fl) - py) * Math.min(1, dt * 3);
        if (((i + Math.floor(this.age * 4)) & 7) === 0) { // the body tilts with the floor, eased (sampled in bursts)
          const nn = sh.floorNormal(P[i3], s), kn = Math.min(1, dt * 5);
          NRM[i3] += (nn.x - NRM[i3]) * kn; NRM[i3 + 1] += (nn.y - NRM[i3 + 1]) * kn; NRM[i3 + 2] += (nn.z - NRM[i3 + 2]) * kn;
        }
        if ((dc < SL[o + 3] || TMR[i] < 0) && this.obs.length && this._clear(i, px, py, pz, 1) < 0.1 * this.SZ[i] + 0.05) {
          if (TMR[i] < 0) TMR[i] = 20 + this.rng() * 30; // tucked against a rock it stays put (a jet from there shot it up the face)
        } else if (dc < SL[o + 3] || TMR[i] < 0) { // jet away (or a spontaneous swim)
          if (dc < SL[o + 3]) { // startled: a dark flush, then a puff of ink as it jets off
            if (!this.FLASH) this.FLASH = new Float32Array(n);
            this.FLASH[i] = 0.7;
            if (this.sys.fx) this.sys.fx.ink(px, py + this.SZ[i] * 0.15, this.anchorZ + pz, this.SZ[i]);
          }
          if (this.perched) this.perched[i] = 0;
          MODE[i] = 1; TMR[i] = 2.5 + this.rng() * 2;
          let ax = px - cx, az2 = pz - cz; const al = h2(ax, az2) || 1;
          if (dc > SL[o + 3]) { const a = this.rng() * TAU; ax = Math.cos(a); az2 = Math.sin(a); } else { ax /= al; az2 /= al; }
          if (this.obs.length) { // not straight into the rock beside it: turn up to 90 degrees either way
            const bx = ax, bz = az2;
            for (let t = 1; t < 5 && this._clear(i, px + ax * 1.2, py + 0.4, pz + az2 * 1.2, 1) < 0.3; t++) {
              const a = (t & 1 ? 0.8 : -0.8) * ((t + 1) >> 1), ca = Math.cos(a), sa = Math.sin(a);
              ax = bx * ca - bz * sa; az2 = bx * sa + bz * ca;
            }
          }
          V[i3] = ax * 0.45; V[i3 + 1] = 0.2; V[i3 + 2] = az2 * 0.45; // a push off the bottom; the jet builds up below (from 1 m/s it leapt off)
          const vn = V[i3] * NRM[i3] + V[i3 + 1] * NRM[i3 + 1] + V[i3 + 2] * NRM[i3 + 2]; // ... away from the slope it sat on
          if (vn < 0.3) { const k = 0.3 - vn; V[i3] += NRM[i3] * k; V[i3 + 1] += NRM[i3 + 1] * k; V[i3 + 2] += NRM[i3 + 2] * k; }
          if (JET[i] < 0.05) { const l = h3(V[i3], V[i3 + 1], V[i3 + 2]); AX[i3] = V[i3] / l; AX[i3 + 1] = V[i3 + 1] / l; AX[i3 + 2] = V[i3 + 2] / l; }
        }
        JET[i] = Math.max(0, JET[i] - dt * 1.5);
      } else if (MODE[i] === 1) {
        // pulsed jet (~1.5 Hz): thrust while the mantle contracts (shader), a short glide between
        const pulse = 0.6 + 0.8 * Math.max(0, -Math.sin(this.PH[i] * 2.2));
        const vl = h3(V[i3], V[i3 + 1], V[i3 + 2]) || 1;
        const sp = (0.6 + 0.5 * this.RP[o + 2]) * pulse; // ~0.4-1.5 m/s (escape jets of real octopuses)
        // keeps rising off the bottom until the arms stream out, then skims along it (rising on, it went 2-3 m up)
        const ty = JET[i] < 0.9 ? V[i3 + 1] / vl * sp : py - fl > 1.2 ? -0.2 : V[i3 + 1] / vl * sp * 0.15;
        V[i3] += (V[i3] / vl * sp - V[i3]) * Math.min(1, dt * 3); V[i3 + 1] += (ty - V[i3 + 1]) * Math.min(1, dt * 3); V[i3 + 2] += (V[i3 + 2] / vl * sp - V[i3 + 2]) * Math.min(1, dt * 3);
        if (this.obs.length) { // veer off rocks ahead (jetting into one, the push-out shot it up the face)
          const dA = this._clear(i, px + V[i3] * 0.6, py + V[i3 + 1] * 0.6, pz + V[i3 + 2] * 0.6, 1);
          if (dA < 0.6) { const k = (0.6 - dA) * dt * 6; V[i3] += _hit.nx * k; V[i3 + 1] += Math.max(_hit.ny, 0.3) * k; V[i3 + 2] += _hit.nz * k; }
        }
        const vl2 = h3(V[i3], V[i3 + 1], V[i3 + 2]) || 1, ka = Math.min(1, dt * 3);
        AX[i3] += (V[i3] / vl2 - AX[i3]) * ka; AX[i3 + 1] += (V[i3 + 1] / vl2 - AX[i3 + 1]) * ka; AX[i3 + 2] += (V[i3 + 2] / vl2 - AX[i3 + 2]) * ka;
        // the arms stream out only as far as the room under the body allows (they trail off the bottom on take-off; at
        // full stream right away their tips went into the sand and the terrain fix threw the body up ~0.6 m)
        JET[i] = Math.max(0, Math.min(1, JET[i] + dt * 3, this._octoRoom(i, py, fl)));
        if (TMR[i] < 0) { // glide down onto free sand ahead (it settled on rock tops, floating over them)
          MODE[i] = 2;
          const [hx, hz] = this._octoSpot(i, px + V[i3] * 1.5, pz + V[i3 + 2] * 1.5); HOME[i * 2] = hx; HOME[i * 2 + 1] = hz;
        }
      } else {
        { // drift toward the landing spot while sinking
          const hx = HOME[i * 2] - px, hz = HOME[i * 2 + 1] - pz, hl = h2(hx, hz), ks = Math.min(1, dt * 1.2);
          if (hl > 0.2) { const sp = Math.min(0.4, hl * 0.5); V[i3] += (hx / hl * sp - V[i3]) * ks; V[i3 + 2] += (hz / hl * sp - V[i3 + 2]) * ks; }
        }
        V[i3] *= 1 - Math.min(1, dt * 0.8); V[i3 + 2] *= 1 - Math.min(1, dt * 0.8);
        V[i3 + 1] += (-0.45 - V[i3 + 1]) * Math.min(1, dt * 1.5);
        JET[i] = Math.max(0, Math.min(JET[i] - dt * 1.5, this._octoRoom(i, py, fl))); // arms spread, it sinks arms-first
        { const nn = sh.floorNormal(px, s), kn = Math.min(1, dt * 1.5); NRM[i3] += (nn.x - NRM[i3]) * kn; NRM[i3 + 1] += (nn.y - NRM[i3 + 1]) * kn; NRM[i3 + 2] += (nn.z - NRM[i3 + 2]) * kn; } // tilts to the bottom below
        // touchdown within the terrain fix's clearance (it holds the arm tips ~0.08 m up: a 0.03 m test never landed on
        // open sand, and the fix bounced the sinking body every frame); the crawl eases the rest of the way down
        if (py <= this._octoRest(i, px, py, pz, fl) + 0.05 + 0.05 * this.SZ[i]) { MODE[i] = 0; HOME[i * 2] = px; HOME[i * 2 + 1] = pz; TMR[i] = 40 + this.rng() * 60; }
      }
      if (MODE[i] !== 0) {
        let nx = px + V[i3] * dt, ny = Math.max(fl + this._restLift(i), py + V[i3 + 1] * dt), nz = pz + V[i3 + 2] * dt;
        const ex = nx - cx, ey = ny - cy, ez = nz - cz, ed = h3(ex, ey, ez), hr = this.hardR + this.SZ[i] * 0.2; // the separation pass's bubble (a smaller one here: popped out by 0.2 size whenever that pass touched it)
        if (ed < hr && ed > 1e-4) { nx = cx + ex / ed * hr; ny = cy + ey / ed * hr; nz = cz + ez / ed * hr; }
        P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz;
      }
      if (this.obs.length) {
        const ox = P[i3], oy = P[i3 + 1], oz = P[i3 + 2];
        this._pushOut(i, P, MODE[i] === 0 ? null : V); // (crawling, the push took the crawl's velocity and it never got out)
        const pl = h3(P[i3] - ox, P[i3 + 1] - oy, P[i3 + 2] - oz);
        if (MODE[i] === 0) {
          this._octoSlide(i, ox, oy, oz, dt * 0.5);
          if (pl > 0.01 && !OCL[i] && OCT[i] >= 0 && ((this.fc + i + this.uid) & 7) === 0) this._octoClear(i, P[i3], P[i3 + 2]); // blocked: crawl off to free sand
        } else if (pl > 0.02) { // jetted into a rock: break off and glide away from it (pressing on, it shot up the face)
          const hx = P[i3] - ox, hz = P[i3 + 2] - oz, hl = h2(hx, hz) || 1;
          // no faster than a jet (taking off from inside a coral thicket, the push threw it 1.5 m up in one frame)
          if (pl > dt * 2.5) { const f = dt * 2.5 / pl; P[i3] = ox + (P[i3] - ox) * f; P[i3 + 1] = oy + (P[i3 + 1] - oy) * f; P[i3 + 2] = oz + hz * f; }
          V[i3] = V[i3] * 0.4 + hx / hl * 0.3; V[i3 + 2] = V[i3 + 2] * 0.4 + hz / hl * 0.3; V[i3 + 1] = Math.min(V[i3 + 1], 0.1);
          if (MODE[i] === 1) { MODE[i] = 2; TMR[i] = -1; const [fx, fz] = this._octoSpot(i, P[i3] + hx / hl, P[i3 + 2] + hz / hl); HOME[i * 2] = fx; HOME[i * 2 + 1] = fz; }
        }
      }
      // still in the resting pose at the sand (take-off, touchdown): no terrain fix, as at rest (its clearance margin
      // popped the body ~0.1 m up in one frame at every launch)
      const atRest = JET[i] < 0.05 && P[i3 + 1] - fl < 0.07 + 0.035 * this.SZ[i];
      if (MODE[i] !== 0 && this.terrainOn && !atRest) {
        const y0 = P[i3 + 1];
        this._terrainTick(i, h3(P[i3] - px, P[i3 + 1] - py, P[i3 + 2] - pz), 0.05);
        // rising off a slope its spread arms lay on: the lift eases out over a few frames (in one it hopped 4-7 cm a frame)
        if (MODE[i] === 1 && P[i3 + 1] - y0 > dt * 0.8) P[i3 + 1] = y0 + dt * 0.8;
        // sinking arms onto the bottom (a slope holds the spread arms up well above the centre's rest height): touchdown
        if (MODE[i] === 2 && P[i3 + 1] - y0 > 0.005 && P[i3 + 1] - fl < 0.6 * this.SZ[i] + 0.15) { MODE[i] = 0; HOME[i * 2] = P[i3]; HOME[i * 2 + 1] = P[i3 + 2]; TMR[i] = 40 + this.rng() * 60; }
      }
      const hv = h2(V[i3], V[i3 + 2]);
      if (hv > 0.03) { const k = Math.min(1, dt * 2); F[i3] += (V[i3] / hv - F[i3]) * k; F[i3 + 2] += (V[i3 + 2] / hv - F[i3 + 2]) * k; const l = h2(F[i3], F[i3 + 2]) || 1; F[i3] /= l; F[i3 + 2] /= l; }
      // a steady clock (0.4-0.7 Hz): tied to the jet speed it ran at ~5 Hz and the mantle / thrust fluttered
      let ph = this.PH[i] + TAU * (0.4 + Math.min(hv, 0.25) * 1.2) * dt; if (ph > PH_WRAP) ph -= PH_WRAP; this.PH[i] = ph;
      this.BEND[i] = JET[i];             // shader: arms stream behind
      let at = 1 + JET[i] * 1.2;         // shader: blanching when alarmed
      if (this.FLASH && this.FLASH[i] > 0) { this.FLASH[i] -= dt; at = Math.max(at, 2.4 + Math.min(1, this.FLASH[i] / 0.25)); } // ... after a dark flush (fading out)
      this.AMP[i] += (at - this.AMP[i]) * Math.min(1, dt * 8); // eased: chromatophores flush in ~0.1 s (it switched in one frame)
    }
    this._writeAll(dt);
  }

  _drift(dt, c) {
    const { n, P, F, FLO, CEI } = this;
    const sh = this.sys.shape, az = this.anchorZ;
    const cx = c.x, cy = c.y, cz = c.z - az, lvl = this.sp.plan === 'siphon' ? 0.15 : 1; // siphonophores stay nearly level
    if (this.IFD) this._recycle(dt, c);
    // occasional limit refresh (big swarms: every member within ~0.5 s)
    for (let j = 0, K = Math.max(2, Math.ceil(n / 30)); j < K; j++) {
      const i = this.rr = (this.rr + 1) % n;
      const x = P[i * 3], s = -(P[i * 3 + 2] + az);
      FLO[i] = sh.floorAt(x, s) + this.mFloor; CEI[i] = Math.min(Math.min(sh.ceilingAt(x, s), 0) - this.mCeil, this.surfY);
    }
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const ph = this.PH[i];
      const pulse = Math.max(0, Math.sin(ph)); const thrust = this.speed * (0.25 + 2.2 * pulse * pulse);
      let hx = F[i3], hy = F[i3 + 1], hz = F[i3 + 2];
      // wander / avoid limits
      const w = this.age * 0.05 + this.RP[i * 4] * TAU;
      let tx = Math.sin(w) * 0.5, ty = 0.75 * lvl, tz = Math.cos(w * 1.3) * 0.5;
      const y = P[i3 + 1];
      if (y > CEI[i] - 1) ty = -0.6 * lvl; else if (y < FLO[i] + 1) ty = 1.2 * lvl;
      else if (this.ALT) ty = clamp((FLO[i] - this.mFloor + this.ALT[i] - y) * 0.8, -0.6, 0.9) * lvl;
      const k = Math.min(1, dt * 0.15);
      hx += (tx - hx) * k; hy += (ty - hy) * k; hz += (tz - hz) * k;
      const l = h3(hx, hy, hz) || 1; hx /= l; hy /= l; hz /= l;
      F[i3] = hx; F[i3 + 1] = hy; F[i3 + 2] = hz;
      let nx = P[i3] + (hx * thrust + this.curX) * dt, ny = P[i3 + 1] + hy * thrust * dt, nz = P[i3 + 2] + (hz * thrust + this.curZ) * dt;
      if (CEI[i] > FLO[i]) ny = clamp(ny, FLO[i] - 0.5, CEI[i] + 0.3);
      // camera bubble (jellies drift slowly, so push them gently aside; the lake's small golden jellies may come close)
      const ex = nx - cx, ey = ny - cy, ez = nz - cz, ed = h3(ex, ey, ez), hr = this.hardR + (this.IFD ? 0.3 : 1);
      if (ed < hr + 2 && ed > 1e-4) { const pu = (hr + 2 - ed) * dt * 0.8; nx += ex / ed * pu; ny += ey / ed * pu * 0.5; nz += ez / ed * pu; }
      if (ed < hr && ed > 1e-4) { nx = cx + ex / ed * hr; ny = cy + ey / ed * hr; nz = cz + ez / ed * hr; }
      const ox = P[i3], oy = P[i3 + 1], oz = P[i3 + 2];
      P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz;
      if (this.obs.length) { // exact rock check only once the clearance budget could be used up (they drift slowly)
        this.CLR[i] -= h3(nx - ox, ny - oy, nz - oz) + 0.004;
        if (this.CLR[i] < 0.05) {
          this._pushOut(i, P, null);
          this.CLR[i] = Math.min(this._clear(i, P[i3], P[i3 + 1], P[i3 + 2], 1, this._obsList(P[i3], P[i3 + 2])), 1.8) - (this.elong ? this.SZ[i] * 0.45 : 0);
        }
      }
      if (this.terrainOn) this._terrainTick(i, h3(P[i3] - ox, P[i3 + 1] - oy, P[i3 + 2] - oz), 0.02);
      const m = this.sp.mot;
      let p2 = ph + TAU * m.idle * (0.8 + 0.4 * this.RP[i * 4 + 1]) * dt; if (p2 > PH_WRAP) p2 -= PH_WRAP; this.PH[i] = p2;
      this.AMP[i] = 1;
    }
    this._writeAll(dt);
  }

  // A swarm that keeps the camera company through its biome (the golden jellies of a marine lake): members that fell
  // behind or strayed are re-placed ahead, out of sight in the murk, 1.5-12 m off the camera's line in the upper
  // water column, and fade in. Once the camera leaves the biome the swarm is simply passed and retired.
  _recycle(dt, c) {
    const sh = this.sys.shape, az = this.anchorZ, P = this.P, F = this.F, n = this.n, IFD = this.IFD, rng = this.rng;
    this.recT -= dt;
    if (this.recT <= 0) { this.recT = 1; this.recOn = this.sys.seq.weights(c.s + 10).some((x) => x.key === this.plan.recycle && x.w > 0.3); }
    for (let i = 0; i < n; i++) if (IFD[i] < 1) IFD[i] = Math.min(1, IFD[i] + dt * 0.45);
    if (!this.recOn) return;
    const off = c.x - sh.pathX(c.s);
    for (let j = 0, K = Math.ceil(n / 8); j < K; j++) { // a few per frame: they drift slowly
      const i = this.recI = (this.recI + 1) % n, i3 = i * 3, ahead = -(P[i3 + 2] + az) - c.s;
      if (ahead > -4 && ahead < 34 && Math.abs(P[i3] - c.x) < 13) continue;
      for (let k = 0; k < 3; k++) { // lateral offsets crowd toward the camera's line (they are seen up close only there)
        const r = rng(), s = c.s + 12 + rng() * 18, l = (rng() < 0.5 ? -1 : 1) * (1.2 + 10 * r * r), x = sh.pathX(s) + off + l;
        const fl = sh.floorAt(x, s), ce = Math.min(sh.ceilingAt(x, s), 0);
        const lo = fl + this.mFloor, hi = Math.min(ce - this.mCeil, this.surfY), yLo = Math.max(lo, Math.min(c.y - 2.2, hi - 0.5));
        if (hi - yLo < 0.5) continue;
        P[i3] = x; P[i3 + 1] = yLo + (hi - yLo) * rng(); P[i3 + 2] = -s - az;
        F[i3] = (rng() - 0.5) * 0.6; F[i3 + 1] = 1; F[i3 + 2] = (rng() - 0.5) * 0.6;
        const l3 = h3(F[i3], F[i3 + 1], F[i3 + 2]); F[i3] /= l3; F[i3 + 1] /= l3; F[i3 + 2] /= l3;
        this.FLO[i] = lo; this.CEI[i] = hi; IFD[i] = 0; this.TCL[i] = 0; this.CLR[i] = 0;
        break;
      }
    }
  }

  // another member's burrow base (SL x / z) within `gap` of (x, z)?
  _crowded(i, x, z, gap) {
    const SL = this.SL;
    for (let j = 0; j < this.n; j++) if (j !== i && h2(SL[j * 4] - x, SL[j * 4 + 2] - z) < gap) return true;
    return false;
  }
  // Garden eels / morays: keep burrow bases out of any obstacle (re-run when the registry changes).
  _revalidateBases() {
    const reg = this.sys.env.obstacles, sh = this.sys.shape, SL = this.SL;
    let moved = false;
    if (this.kind === 'bed') {
      const P = this.P;
      for (let i = 0; i < this.n; i++) {
        const x = P[i * 3], z = P[i * 3 + 2], s = -(z + this.anchorZ);
        reg.query(x, s, 3, _q);
        let inside = false;
        for (const ob of _q) if (Obstacles.dist(ob, x, P[i * 3 + 1], s, null) < this.rbU * this.SZ[i] + 0.02) { inside = true; break; }
        if (!inside) continue;
        const [nx, nz] = this._freeSpot(x, z, this.SZ[i] * 0.45, true);
        P[i * 3] = nx; P[i * 3 + 2] = nz; P[i * 3 + 1] = sh.floorAt(nx, -(nz + this.anchorZ)) + 0.006 * this.SZ[i];
        moved = true;
      }
      if (moved) { this.matrixDirty = true; this._staticSpace(); }
      return;
    }
    for (let i = 0; i < this.n; i++) {
      const o = i * 4, x = SL[o], z = SL[o + 2], s = -(z + this.anchorZ), y = SL[o + 1];
      reg.query(x, s, 3, _q);
      let inside = false;
      for (const ob of _q) if (Obstacles.dist(ob, x, y + 0.05, s, null) < (this.kind === 'peek' ? -0.05 : 0.04)) { inside = true; break; }
      if (!inside) continue;
      let [nx, nz] = this._freeSpot(x, z, 0.12, true);
      // the new burrow keeps its distance from the others (both may have been moved off the same new rock)
      const gap = this.kind === 'peek' ? this.SZ[i] * 1.3 : Math.max(0.22, this.SZ[i] * 0.4);
      for (let k = 0; k < 9 && this._crowded(i, nx, nz, gap); k++) { const a = k * 2.4 + i; [nx, nz] = this._freeSpot(nx + Math.cos(a) * gap, nz + Math.sin(a) * gap, 0.12, true); }
      SL[o] = nx; SL[o + 2] = nz; SL[o + 1] = sh.floorAt(nx, -(nz + this.anchorZ)) - 0.02;
      if (this.EXP) this.EXP[i * 2] = 0.02; // pop back out of the new burrow gradually
      moved = true;
    }
    if (moved) { this.matrixDirty = true; this._staticSpace(); } // the new burrows keep clear of the neighbours too
  }

  _static(dt, c) {
    const { n, SL } = this, az = this.anchorZ;
    const cx = c.x, cy = c.y, cz = c.z - az;
    const m = this.sp.mot;
    let moved = false;
    for (let i = 0; i < n; i++) {
      let p2 = this.PH[i] + TAU * (m.idle || 0.4) * (0.8 + 0.4 * this.RP[i * 4 + 1]) * dt; if (p2 > PH_WRAP) p2 -= PH_WRAP; this.PH[i] = p2;
      this.AMP[i] = 1;
      if (this.EXP) { // garden eels / morays retreat when the camera comes close
        const o = i * 4, dx = SL[o] - cx, dy = SL[o + 1] - cy, dz = SL[o + 2] - cz;
        const d = h3(dx, dy, dz);
        const want = d < (this.kind === 'colony' ? 9 : 5) ? (this.kind === 'colony' ? 0.06 : 0.15) : SL[o + 3];
        const cur = this.EXP[i * 2];
        const nv = cur + clamp(want - cur, -dt * 0.5, dt * 0.08);
        if (nv !== cur) { this.EXP[i * 2] = nv; moved = true; }
      }
    }
    if (moved) this.matrixDirty = true;
    this._writeAll(dt);
  }

  // ---------- terrain & personal space ----------
  // Body basis of agent i as drawn by _writeAll: B = [X, Y, Z] (columns, unit length).
  _frame(i, B) {
    const F = this.F, i3 = i * 3, plan = this.sp.plan;
    if (plan === 'jelly' || plan === 'dumbo') {
      const Yx = F[i3], Yy = F[i3 + 1], Yz = F[i3 + 2];
      let Xx = Yy, Xy = -Yx; const l = h2(Xx, Xy) || 1; Xx /= l; Xy /= l;
      B[0] = Xx; B[1] = Xy; B[2] = 0; B[3] = Yx; B[4] = Yy; B[5] = Yz; B[6] = Xy * Yz; B[7] = -Xx * Yz; B[8] = Xx * Yy - Xy * Yx;
      return;
    }
    if (this.sp.beh.upright) {
      const l = h2(F[i3], F[i3 + 2]) || 1, zx = F[i3] / l, zz = F[i3 + 2] / l;
      B[0] = zz; B[1] = 0; B[2] = -zx; B[3] = 0; B[4] = 1; B[5] = 0; B[6] = zx; B[7] = 0; B[8] = zz;
      return;
    }
    if (this.kind === 'octo') {
      const J = this.JET[i], V = this.AX || this.V, N = this.NRM, vl = h3(V[i3], V[i3 + 1], V[i3 + 2]) || 1;
      let Yx = N[i3] * (1 - J) + V[i3] / vl * J, Yy = N[i3 + 1] * (1 - J) + V[i3 + 1] / vl * J, Yz = N[i3 + 2] * (1 - J) + V[i3 + 2] / vl * J;
      const yl = h3(Yx, Yy, Yz) || 1; Yx /= yl; Yy /= yl; Yz /= yl;
      const zx = F[i3] * (1 - J) - N[i3] * J, zz = F[i3 + 2] * (1 - J) - N[i3 + 2] * J, d = zx * Yx + zz * Yz;
      let Zx = zx - d * Yx, Zy = -d * Yy, Zz = zz - d * Yz; const l = h3(Zx, Zy, Zz) || 1; Zx /= l; Zy /= l; Zz /= l;
      B[0] = Yy * Zz - Yz * Zy; B[1] = Yz * Zx - Yx * Zz; B[2] = Yx * Zy - Yy * Zx; B[3] = Yx; B[4] = Yy; B[5] = Yz; B[6] = Zx; B[7] = Zy; B[8] = Zz;
      return;
    }
    const Zx = F[i3], Zy = F[i3 + 1], Zz = F[i3 + 2];
    let rx = Zz, rz = -Zx; const rl = h2(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = Zy * rz, uy = Zz * rx - Zx * rz, uz = -Zy * rx;
    const b = this.BANK[i] + (this.SPIN ? this.SPIN[i] : 0), cb = Math.cos(b), sb = Math.sin(b);
    B[0] = rx * cb - ux * sb; B[1] = -uy * sb; B[2] = rz * cb - uz * sb;
    B[3] = ux * cb + rx * sb; B[4] = uy * cb; B[5] = uz * cb + rz * sb;
    B[6] = Zx; B[7] = Zy; B[8] = Zz;
  }

  // Keep every extremity of agent i (the extreme points of its geometry: nose, tail, fin tips, back, belly, see
  // sep.js bodyShape) out of the sea floor, cave walls, ceilings / ice and above-surface space. The margin is a
  // clearance along the surface normal: on a face of slope k it is sqrt(1 + k^2) times taller, measured
  // vertically (a vertical margin let an eye or fin between two sample points touch a steep cave roof).
  // Corrections go along the surface normal by the planar depth (beside a vertical wall a fish slides away from
  // it instead of climbing it), the velocity into the rock is turned away and a pitched nose / tail levels out.
  // When squeezed (floor and roof both in the way) the animal heads back toward the open passage at the path.
  // Returns the new clearance budget (metres of motion before the next exact check is needed).
  _terrainFix(i) {
    const sh = this.sys.shape, P = this.P, V = this.V, F = this.F, i3 = i * 3, az = this.anchorZ, sz = this.SZ[i];
    const sup = this.entry.shape.sup, ns = sup.length / 3, B = _B, T = _TP, top0 = this.topCap, ceil = this.ceilOn, m = 0.03 + 0.035 * sz + this.tPad; // + tail beat
    let moved = 0; // corrections also use up the obstacle clearance budget
    // a jetting octopus draws its arms in behind the mantle (shader): its rest-pose arm tips, swung down by the pitch,
    // lifted it ~0.6 m off the sand at every launch
    const jet = this.kind === 'octo' ? this.JET[i] : 0;
    for (let it = 0; it < 6; it++) {
      this._frame(i, B);
      let worst = 0, wF = true, wx = 0, wz = 0, wk = 0, gap = 1e9;
      let f0 = 1e9, f1 = -1e9, c0 = 1e9, c1 = -1e9;
      for (let k = 0; k < ns; k++) {
        let lx = sup[k * 3] * sz, ly = sup[k * 3 + 1] * sz, lz = sup[k * 3 + 2] * sz;
        if (jet > 0) { const r = h2(lx, lz); if (r > ly) ly += (-r - ly) * jet; lx *= 1 - 0.85 * jet; lz *= 1 - 0.85 * jet; }
        const x = P[i3] + B[0] * lx + B[3] * ly + B[6] * lz, y = P[i3 + 1] + B[1] * lx + B[4] * ly + B[7] * lz, z = P[i3 + 2] + B[2] * lx + B[5] * ly + B[8] * lz;
        const s = -(z + az), fl = sh.floorAt(x, s);
        let ce = top0;
        if (ceil) { const cc = sh.ceilingAt(x, s); if (cc < ce) ce = cc; }
        const o = k * 5; T[o] = x; T[o + 1] = y; T[o + 2] = z; T[o + 3] = fl; T[o + 4] = ce;
        if (fl < f0) f0 = fl; if (fl > f1) f1 = fl; if (ce < c0) c0 = ce; if (ce > c1) c1 = ce;
      }
      // steepest floor / roof gradient between the sample points (squared; no extra terrain lookups)
      let kf = 0, kc = 0;
      if (f1 - f0 > 0.005 || c1 - c0 > 0.005) {
        for (let a = 0; a < ns; a++) for (let b = a + 1; b < ns; b++) {
          const oa = a * 5, ob = b * 5, dx = T[oa] - T[ob], dz = T[oa + 2] - T[ob + 2], d2 = dx * dx + dz * dz;
          if (d2 < 4e-4) continue;
          const df = T[oa + 3] - T[ob + 3], dc = T[oa + 4] - T[ob + 4];
          if (df * df > kf * d2) kf = df * df / d2;
          if (dc * dc > kc * d2) kc = dc * dc / d2;
        }
      }
      const mf = m * Math.sqrt(1 + Math.min(kf, SLOPE * SLOPE)), mc = m * Math.sqrt(1 + Math.min(kc, SLOPE * SLOPE));
      for (let k = 0; k < ns; k++) {
        const o = k * 5, y = T[o + 1], fl = T[o + 3], ce = T[o + 4];
        const pf = fl + mf - y, pc = y + mc - ce;
        if (pf > worst) { worst = pf; wF = true; wx = T[o]; wz = T[o + 2]; wk = k; }
        if (pc > worst) { worst = pc; wF = false; wx = T[o]; wz = T[o + 2]; wk = k; }
        const g = y - fl - mf < ce - y - mc ? y - fl - mf : ce - y - mc;
        if (g < gap) gap = g;
      }
      if (worst <= 0) {
        if (moved > 0) this.CLR[i] -= moved;
        if (gap <= 0) return 0;
        // budget: how far it may move before terrain can reach an extremity, gap / (1 + 2k), k = the steepest slope
        // between the extremities and from them out to a ring of samples RING beyond the body (a wall face or cliff
        // foot just outside it; the factor 2 covers a face up to twice that steep further on). The slope averaged
        // across the body hid a blue hole's 27:1 wall beside a fish swimming along it, and the fish then swam metres
        // into the wall between checks. At least 3:1, 10:1 under roofs and ice (openings, leads and keels are cliffs);
        // at most 1 m between checks.
        let k2 = kf > kc ? kf : kc;
        const px = P[i3], pz = P[i3 + 2], hl = h2(F[i3], F[i3 + 2]);
        const ux = hl > 0.2 ? F[i3] / hl : 1, uz = hl > 0.2 ? F[i3 + 2] / hl : 0; // heading frame (u forward, v to the side)
        let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for (let k = 0; k < ns; k++) {
          const o = k * 5, dx = T[o] - px, dz = T[o + 2] - pz, u = dx * ux + dz * uz, v = dz * ux - dx * uz;
          if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
        }
        for (let a = 0; a < 3; a++) for (let q = 0; q < 3; q++) {
          if (a === 1 && q === 1) continue;
          const u = a === 0 ? u0 - RING : a === 2 ? u1 + RING : (u0 + u1) * 0.5, v = q === 0 ? v0 - RING : q === 2 ? v1 + RING : (v0 + v1) * 0.5;
          const rx = px + u * ux - v * uz, rz = pz + u * uz + v * ux, rs = -(rz + az);
          const fr = sh.floorAt(rx, rs), cr = ceil ? Math.min(top0, sh.ceilingAt(rx, rs)) : top0;
          for (let k = 0; k < ns; k++) { // only a floor rising / a roof dropping toward the ring point matters
            const o = k * 5, df = fr - T[o + 3], dc = T[o + 4] - cr, r = df > dc ? df : dc;
            if (r <= 0) continue;
            const dx = rx - T[o], dz = rz - T[o + 2], d2 = dx * dx + dz * dz;
            if (r * r > k2 * d2) k2 = r * r / d2;
          }
        }
        const slope = Math.min(SLOPE, Math.max(Math.sqrt(k2), ceil ? 10 : 3));
        return Math.min(1, gap / (1 + 2 * slope));
      }
      if (it >= 3) { // squeezed or wedged: back toward the open passage around the path
        const s = -(P[i3 + 2] + az), dx = sh.pathX(s) - P[i3], dy = sh.pathY(s) - P[i3 + 1], dl = h2(dx, dy) || 1, st = Math.min(dl, 0.2 + Math.min(worst, 2));
        P[i3] += dx / dl * st; P[i3 + 1] += dy / dl * st; moved += st;
        V[i3] *= 0.5; V[i3 + 1] *= 0.5; V[i3 + 2] *= 0.5;
        if (this.elong) { F[i3 + 1] *= 0.5; const hh = h2(F[i3], F[i3 + 2]) || 1, sc = Math.sqrt(1 - F[i3 + 1] * F[i3 + 1]) / hh; F[i3] *= sc; F[i3 + 2] *= sc; }
        continue;
      }
      const ws = -(wz + az), e = 0.5;
      let nx = 0, ny = -1, nz = 0; // the sea surface
      if (wF) { const hx = sh.floorAt(wx + e, ws) - sh.floorAt(wx - e, ws), hs = sh.floorAt(wx, ws + e) - sh.floorAt(wx, ws - e); nx = -hx; ny = 2 * e; nz = hs; }
      else if (ceil && sh.ceilingAt(wx, ws) < top0) { const hx = sh.ceilingAt(wx + e, ws) - sh.ceilingAt(wx - e, ws), hs = sh.ceilingAt(wx, ws + e) - sh.ceilingAt(wx, ws - e); nx = hx; ny = -2 * e; nz = -hs; }
      const nl = h3(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const d = worst * Math.max(Math.abs(ny), 0.12) + 0.02 + 0.01 * sz; // a little slack: no re-check every frame
      P[i3] += nx * d; P[i3 + 1] += ny * d; P[i3 + 2] += nz * d; moved += d;
      const vn = V[i3] * nx + V[i3 + 1] * ny + V[i3 + 2] * nz;
      if (vn < 0.2) { const k2 = 0.2 - vn; V[i3] += nx * k2; V[i3 + 1] += ny * k2; V[i3 + 2] += nz * k2; } // turn away from the rock
      if (this.elong && wk !== 2 && wk !== 3 && Math.abs(F[i3 + 1]) > 0.05) { // nose or tail pitched into it: level out
        F[i3 + 1] *= 0.6; const hh = h2(F[i3], F[i3 + 2]) || 1, sc = Math.sqrt(1 - F[i3 + 1] * F[i3 + 1]) / hh; F[i3] *= sc; F[i3 + 2] *= sc;
      }
    }
    this.CLR[i] -= moved;
    return 0;
  }
  // Terrain budget bookkeeping after agent i moved by `disp` (and turned by `turn`, |dF|): exact check when used up.
  _terrainTick(i, disp, turn) {
    const t = this.TCL[i] - disp - turn * this.SZ[i] * 0.55 - 0.002;
    this.TCL[i] = t < 0 ? this._terrainFix(i) : t;
  }

  // A pushed animal takes its place in the formation with it (formation offset, orbit radius / angle /
  // height, or shoal home), so the group settles into a non-overlapping arrangement instead of fighting.
  _slotShift(i, dx, dy, dz) {
    const k = this.kind, SL = this.SL, o = i * 4;
    if (k === 'bait' || k === 'mill') {
      const a = SL[o + 1], r = SL[o], ca = Math.cos(a), sa = Math.sin(a);
      const r2 = Math.max(0.3, r + dx * ca + dz * sa);
      SL[o + 1] = a + (-dx * sa + dz * ca) / Math.max(r, 0.3); SL[o] = r2; SL[o + 2] += dy;
      SL[o + 3] *= r / r2; // same swimming speed on the new radius
    } else if (k === 'school' || k === 'pod' || k === 'solo') { // offsets live in the heading frame (sin psi = cvx, cos psi = cvz)
      const c = this.cvz, sn = this.cvx, q = k === 'school' ? 1 : 1 / this.fsq; // (in unsqueezed formation units)
      SL[o] += (dx * c - dz * sn) * q; SL[o + 1] += dy * q; SL[o + 2] += (dx * sn + dz * c) * q;
    } else if (k === 'shoal' || k === 'hover') { SL[o] += dx; SL[o + 1] += dy; SL[o + 2] += dz; }
  }

  // Apply the separation pass's correction (sep.js) and re-establish the hard constraints for moved animals.
  _applySep(c) {
    const n = this.n, D = this.SD, P = this.P, V = this.V, sh = this.sys.shape, az = this.anchorZ, k = this.kind;
    const M = this.mesh.instanceMatrix.array, cx = c.x, cy = c.y, cz = c.z - az, MV = this.SMV;
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let dx = D[i3], dy = D[i3 + 1], dz = D[i3 + 2];
      if (dx === 0 && dy === 0 && dz === 0) continue;
      MV[cnt] = i; // moved: re-checked by the follow-up rounds
      let dl = h3(dx, dy, dz);
      if (dl > 1.5) { const f = 1.5 / dl; dx *= f; dy *= f; dz *= f; dl = 1.5; }
      // an octopus slides aside (resting: <= ~0.5 m/s over the up to four rounds) instead of popping 0.2-0.4 m when
      // something lands next to it or two take off side by side
      if (k === 'octo') { const cap = this.MODE[i] === 0 ? 0.0025 : 0.006; if (dl > cap) { const f = cap / dl; dx *= f; dy *= f; dz *= f; dl = cap; } }
      const ox = P[i3], oy = P[i3 + 1], oz = P[i3 + 2];
      P[i3] += dx; P[i3 + 1] += dy; P[i3 + 2] += dz;
      D[i3] = 0; D[i3 + 1] = 0; D[i3 + 2] = 0;
      const s = -(P[i3 + 2] + az);
      let swim = false;
      if (k === 'walk') P[i3 + 1] = sh.floorAt(P[i3], s);
      else if (k === 'bed') P[i3 + 1] = sh.floorAt(P[i3], s) + 0.006 * this.SZ[i];
      else if ((k === 'rest' || k === 'octo') && this.MODE[i] === 0) {
        // octopus: keeps its height above the rest level (set to it, a touchdown still easing down dropped ~0.1 m)
        P[i3 + 1] = k === 'octo' ? oy + this._octoRest(i, P[i3], oy, P[i3 + 2], sh.floorAt(P[i3], s)) - this._octoRest(i, ox, oy, oz, sh.floorAt(ox, -(oz + az)))
          : (this.perched && this.perched[i] ? this.perchY : sh.floorAt(P[i3], s)) + this._restLift(i);
        // (an octopus crawling clear of a rock keeps its target: pushed back by the rock every frame, the home ran off 260 m)
        if (this.HOME && !(k === 'octo' && this.OCL && this.OCL[i])) { this.HOME[i * 2] += dx; this.HOME[i * 2 + 1] += dz; }
      } else {
        swim = true;
        const vn = (V[i3] * dx + V[i3 + 1] * dy + V[i3 + 2] * dz) / dl;
        if (vn < 0) { V[i3] -= dx / dl * vn; V[i3 + 1] -= dy / dl * vn; V[i3 + 2] -= dz / dl * vn; }
        this._slotShift(i, dx, dy, dz);
        const ex = P[i3] - cx, ey = P[i3 + 1] - cy, ez = P[i3 + 2] - cz, ed = h3(ex, ey, ez), hr = this.hardR + this.SZ[i] * 0.2;
        if (ed < hr && ed > 1e-4) { P[i3] = cx + ex / ed * hr; P[i3 + 1] = cy + ey / ed * hr; P[i3 + 2] = cz + ez / ed * hr; dl += hr - ed; }
      }
      this.CLR[i] -= dl;
      if (this.obs.length && this.CLR[i] < 0.05) {
        const qx = P[i3], qy = P[i3 + 1], qz = P[i3 + 2];
        const oc = k === 'octo' && !swim;
        this._pushOut(i, P, oc ? null : V); this.CLR[i] = 0;
        if (oc) this._octoSlide(i, qx, qy, qz, 0.008); // a resting octopus slides out slowly and keeps crawling clear (see _octo)
        dl += h3(P[i3] - qx, P[i3 + 1] - qy, P[i3 + 2] - qz);
      }
      // octopus still in the resting pose at the sand (take-off, touchdown): kept on the sand only, as in _octo (the
      // terrain fix's margin popped a nudged one ~0.08 m up at launch)
      const fo = k === 'octo' && swim && this.JET[i] < 0.05 ? sh.floorAt(P[i3], -(P[i3 + 2] + az)) : -1e9;
      if (P[i3 + 1] - fo < 0.07 + 0.035 * this.SZ[i]) P[i3 + 1] = Math.max(P[i3 + 1], fo + this._restLift(i));
      else if (swim && this.terrainOn) {
        const y0 = P[i3 + 1];
        this._terrainTick(i, dl, 0); // last: the push-out above can move the body toward the rock face
        if (k === 'octo' && this.MODE[i] === 1 && P[i3 + 1] - y0 > 0.015) P[i3 + 1] = y0 + 0.015; // eased, as in _octo
      }
      // wedged (the floor, a rock or the camera bubble took back most of the push): it holds still in the follow-up
      // rounds, so the other animal makes the room (a jack under a manta gliding low over the reef)
      if (swim && (P[i3] - ox) * dx + (P[i3 + 1] - oy) * dy + (P[i3 + 2] - oz) * dz < 0.5 * (dx * dx + dy * dy + dz * dz)) { this.SB[i] = 1; this.nBlk++; }
      const o = i * 16; // the drawn instance moves with it
      if (M[o + 15] === 1) { M[o + 12] = P[i3]; M[o + 13] = P[i3 + 1]; M[o + 14] = P[i3 + 2]; }
      else if (this.nearCount) {
        for (let q = 0; q < this.nearCount; q++) {
          if (this.nearIdx[q] !== i) continue;
          const NM = this.nearMesh.instanceMatrix.array, C = this.nearCopy, b = q * 16;
          C[b + 12] = NM[b + 12] = P[i3]; C[b + 13] = NM[b + 13] = P[i3 + 1]; C[b + 14] = NM[b + 14] = P[i3 + 2];
          this.nearMesh.instanceMatrix.needsUpdate = true;
          break;
        }
      }
      cnt++;
    }
    this.nMoved = cnt;
    if (cnt) { this.sepMoved = true; if (this.visible) this.mesh.instanceMatrix.needsUpdate = true; else this._mUp = true; }
    return cnt;
  }

  // ---------- geometry LOD ----------
  _makeGeo(entry) {
    const g = new THREE.BufferGeometry();
    g.setIndex(entry.index); g.setAttribute('position', entry.pos); g.setAttribute('normal', entry.nor); g.setAttribute('aG', entry.g);
    for (let k = 0; k < 7; k++) g.setAttribute(INST_NAMES[k], this.instAttrs[k]);
    g.setAttribute('aAnim', this.aAnim);
    return g;
  }
  // Lower-poly geometry beyond ~45 m; agents within ~7 m are drawn by a small high-detail twin mesh
  // (smooth silhouettes and round eyes on close passes). Missing levels are built in idle time.
  _lodTick(c) {
    const sp = this.sp, cache = this.sys.cache;
    if (sp.plan === 'siphon') return;
    const d = this.dist, want = d > 48 ? -1 : d < 40 ? 0 : this.lod;
    if (want !== this.lod) {
      const k = want + 1;
      if (!this.lodGeo[k] && cache.has(sp, want)) { this.lodEntry[k] = cache.acquire(sp, want); this.lodGeo[k] = this._makeGeo(this.lodEntry[k]); }
      if (this.lodGeo[k]) {
        this.mesh.geometry = this.lodGeo[k];
        const nt = this.lodEntry[k].tris * this.n; this.sys.trisTotal += nt - this.tris; this.tris = nt;
        this.lod = want;
      } else this.sys.wantLod(sp, want);
    }
    this._nearTick(c);
  }
  _nearTick(c) {
    const NMAX = 12, sys = this.sys;
    const ok = this.visible && d0ok(this) && this.dist < 11;
    if (!ok) { if (this.nearCount) this._nearSet(0); return; }
    if (!this.nearMesh) {
      if (!sys.cache.has(this.sp, 1)) { sys.wantLod(this.sp, 1); return; }
      if (sys.nearActive >= sys.maxNear) return; // draw-call budget
      const entry = sys.cache.acquire(this.sp, 1), g = new THREE.BufferGeometry();
      g.setIndex(entry.index); g.setAttribute('position', entry.pos); g.setAttribute('normal', entry.nor); g.setAttribute('aG', entry.g);
      this.nearAttrs = [];
      for (let k = 0; k < 8; k++) { const a = new THREE.InstancedBufferAttribute(new Float32Array(NMAX * 4), 4); if (k === 7) a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k < 7 ? INST_NAMES[k] : 'aAnim', a); this.nearAttrs.push(a); }
      const m = new THREE.InstancedMesh(g, this.mesh.material, NMAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0;
      m.position.set(0, 0, this.anchorZ); m.matrixAutoUpdate = false; m.updateMatrix();
      m.renderOrder = this.mesh.renderOrder; m.castShadow = this.mesh.castShadow; m.name = this.mesh.name + ':near';
      sys.world.add(m);
      this.nearMesh = m; this.nearEntry = entry; this.nearGeo = g; this.nearIdx = new Int16Array(NMAX).fill(-1); this.nearCount = 0;
      this.nearMark = new Uint8Array(this.n); this.nearCopy = new Float32Array(NMAX * 16);
    }
    if (!this.nearCount && sys.nearActive >= sys.maxNear) return; // draw-call budget: a few twins at a time
    const P = this.P, n = this.n, cx = c.x, cy = c.y, cz = c.z - this.anchorZ, mark = this.nearMark, idx = this.nearIdx;
    // keep agents still within 8 m, add new ones within 7 m (nearest first is not needed: few agents qualify)
    let cnt = 0, changed = false;
    for (let k = 0; k < this.nearCount; k++) {
      const i = idx[k], dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz < 100) { if (k !== cnt) { idx[cnt] = i; this.nearCopy.copyWithin(cnt * 16, k * 16, k * 16 + 16); changed = true; } cnt++; }
      else { mark[i] = 0; changed = true; if (STATIC_KINDS.has(this.kind)) this.matrixDirty = true; }
    }
    for (let i = 0; i < n && cnt < NMAX; i++) {
      if (mark[i]) continue;
      const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz < 81) { mark[i] = 1; idx[cnt] = i; cnt++; changed = true; this.nearCopy.fill(0, (cnt - 1) * 16, cnt * 16); }
    }
    if (changed) { // static per-instance attributes follow the selection
      for (let k = 0; k < 7; k++) {
        const src = this.instAttrs[k].array, dst = this.nearAttrs[k].array;
        for (let j = 0; j < cnt; j++) { const a = idx[j] * 4; dst[j * 4] = src[a]; dst[j * 4 + 1] = src[a + 1]; dst[j * 4 + 2] = src[a + 2]; dst[j * 4 + 3] = src[a + 3]; }
        this.nearAttrs[k].needsUpdate = true;
      }
    }
    this._nearSet(cnt);
  }
  // copy the selected agents' matrices / animation into the twin and hide them in the main mesh
  _nearSet(cnt) {
    const sys = this.sys;
    if (!this.nearMesh) return;
    if ((cnt > 0) !== (this.nearCount > 0)) sys.nearActive += cnt > 0 ? 1 : -1;
    if (cnt === 0) {
      for (let k = 0; k < this.nearCount; k++) this.nearMark[this.nearIdx[k]] = 0;
      if (this.nearCount && STATIC_KINDS.has(this.kind)) this.matrixDirty = true;
      this.nearCount = 0; this.nearMesh.count = 0; this.nearMesh.visible = false;
      return;
    }
    const M = this.mesh.instanceMatrix.array, NM = this.nearMesh.instanceMatrix.array, A = this.aAnim.array, NA = this.nearAttrs[7].array, C = this.nearCopy;
    for (let k = 0; k < cnt; k++) {
      const i = this.nearIdx[k], o = i * 16;
      if (M[o + 15] === 1) { for (let j = 0; j < 16; j++) C[k * 16 + j] = M[o + j]; for (let j = 0; j < 15; j++) M[o + j] = 0; M[o + 15] = 0; }
      for (let j = 0; j < 16; j++) NM[k * 16 + j] = C[k * 16 + j];
      NA[k * 4] = A[i * 4]; NA[k * 4 + 1] = A[i * 4 + 1]; NA[k * 4 + 2] = A[i * 4 + 2]; NA[k * 4 + 3] = A[i * 4 + 3];
    }
    this.nearCount = cnt; this.nearMesh.count = cnt; this.nearMesh.visible = this.visible;
    this.nearMesh.instanceMatrix.needsUpdate = true; this.nearAttrs[7].needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- walkers: crabs, lobsters, isopods, sea pigs ----------
  _walk(dt, c) {
    const { n, P, V, F, SL, MODE, TMR, NRM, HOME, RP } = this;
    const sh = this.sys.shape, az = this.anchorZ, m = this.sp.mot, walk = this.walk, spread = this.sp.beh.spread ?? 4;
    const cx = c.x, cy = c.y, cz = c.z - az, gap = Math.max(0.45, this.baseSize * 1.7);
    this.wf = (this.wf || 0) + 1;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, o = i * 4;
      let px = P[i3], pz = P[i3 + 2];
      TMR[i] -= dt;
      if (walk === 'queue') { // single file: the leader heads along the line, the others follow the one ahead
        if (i === 0) { SL[o] = px + this.herdX * 2; SL[o + 2] = pz + this.herdZ * 2; }
        else { const j3 = (i - 1) * 3, dx = P[j3] - px, dz = P[j3 + 2] - pz, dl = h2(dx, dz) || 1; SL[o] = P[j3] - dx / dl * gap; SL[o + 2] = P[j3 + 2] - dz / dl * gap; }
        MODE[i] = 1;
      } else if (TMR[i] < 0) {
        if (MODE[i] === 0) {
          MODE[i] = 1; TMR[i] = walk === 'herd' ? 6 + this.rng() * 8 : 2.5 + this.rng() * 5;
          if (walk === 'herd') { SL[o] = px + this.herdX * 0.6 + (this.rng() - 0.5) * 0.4; SL[o + 2] = pz + this.herdZ * 0.6 + (this.rng() - 0.5) * 0.4; }
          else { const a = this.rng() * TAU, r = Math.sqrt(this.rng()) * spread; SL[o] = HOME[i * 2] + Math.cos(a) * r; SL[o + 2] = HOME[i * 2 + 1] + Math.sin(a) * r; }
        } else { MODE[i] = 0; TMR[i] = walk === 'herd' ? 1 + this.rng() * 2 : 1.5 + this.rng() * 5; }
      }
      let spd = this.speed * (0.8 + 0.4 * RP[o]);
      const ex = px - cx, ez = pz - cz, dc = h2(ex, ez) + Math.abs(P[i3 + 1] - cy) * 0.6;
      if (dc < this.alarmR && walk !== 'queue') { // scuttle away from the camera
        MODE[i] = 1; TMR[i] = Math.max(TMR[i], 1.2);
        const el = h2(ex, ez) || 1; SL[o] = px + ex / el * 1.5; SL[o + 2] = pz + ez / el * 1.5; spd *= 2.5;
      }
      let vx = 0, vz = 0;
      if (MODE[i] === 1) {
        const dx = SL[o] - px, dz = SL[o + 2] - pz, dl = h2(dx, dz);
        if (dl < 0.04 && walk !== 'queue') { MODE[i] = 0; TMR[i] = 0.8 + this.rng() * 3; }
        else if (dl > 1e-4) { const f = Math.min(1, dl / 0.25) * spd / dl; vx = dx * f; vz = dz * f; }
      }
      const k = Math.min(1, dt * 4);
      V[i3] += (vx - V[i3]) * k; V[i3 + 2] += (vz - V[i3 + 2]) * k; V[i3 + 1] = 0;
      const ox = px, oz = pz;
      px += V[i3] * dt; pz += V[i3 + 2] * dt;
      let s = -(pz + az);
      P[i3] = px; P[i3 + 2] = pz; P[i3 + 1] = sh.floorAt(px, s);
      if (this.obs.length) {
        const L = this._obsList(px, pz);
        if (L.length && this._clear(i, px, P[i3 + 1], pz, 3, L) < 0) { // walked into a rock: step back, pick another way
          P[i3] = ox; P[i3 + 2] = oz; s = -(oz + az); P[i3 + 1] = sh.floorAt(ox, s);
          V[i3] = V[i3 + 2] = 0;
          if (walk !== 'queue') { MODE[i] = 0; TMR[i] = 0.2 + this.rng() * 0.4; }
          if (this._clear(i, P[i3], P[i3 + 1], P[i3 + 2], 3, L) < 0) this._escape(i); // a rock appeared on top of it
        }
      }
      const hv = h2(V[i3], V[i3 + 2]);
      if (hv > 0.005) { // heading follows the walking direction (for crabs that is sideways)
        const kk = Math.min(1, dt * 3); F[i3] += (V[i3] / hv - F[i3]) * kk; F[i3 + 2] += (V[i3 + 2] / hv - F[i3 + 2]) * kk;
        const l = h2(F[i3], F[i3 + 2]) || 1; F[i3] /= l; F[i3 + 2] /= l;
      }
      if (((i + this.wf) & 7) === 0) { const nn = sh.floorNormal(P[i3], s); NRM[i3] = nn.x; NRM[i3 + 1] = nn.y; NRM[i3 + 2] = nn.z; }
      let ph = this.PH[i] + TAU * ((m.beat || 6) * hv / Math.max(this.SZ[i], 0.05) + (m.idle || 0.1)) * dt;
      if (ph > PH_WRAP) ph -= PH_WRAP; this.PH[i] = ph;
      this.AMP[i] += ((hv > 0.01 ? 1 : 0.12) - this.AMP[i]) * Math.min(1, dt * 4);
    }
    this._writeAll(dt);
  }

  // remoras: a slow tail beat; the pose comes from the host in _writeAll
  _attach(dt) {
    for (let i = 0; i < this.n; i++) {
      let ph = this.PH[i] + TAU * 0.55 * (0.85 + 0.3 * this.RP[i * 4]) * dt; if (ph > PH_WRAP) ph -= PH_WRAP; this.PH[i] = ph;
      this.AMP[i] = 0.35;
    }
    this._writeAll(dt);
  }

  // ======================================================================
  _writeAll(dt) {
    const { n, P, F, SZ, BANK } = this;
    const M = this.mesh.instanceMatrix.array, A = this.aAnim.array;
    const kind = this.kind, upright = this.sp.beh.upright, plan = this.sp.plan;
    let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
    const isStatic = STATIC_KINDS.has(kind);
    const writeM = !isStatic || this.matrixDirty;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, o = i * 16, s = SZ[i];
      if (writeM) {
        let px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
        let Xx, Xy, Xz, Yx, Yy, Yz, Zx, Zy, Zz;
        if (kind === 'colony') {
          const c = this.curDir, e = this.EXP[i * 2];
          Zx = 0; Zy = 1; Zz = 0; Yx = c[0]; Yy = 0; Yz = c[2];
          Xx = Yy * Zz - Yz * Zy; Xy = Yz * Zx - Yx * Zz; Xz = Yx * Zy - Yy * Zx;
          px = this.SL[i * 4]; py = this.SL[i * 4 + 1] + (e - 0.5) * s; pz = this.SL[i * 4 + 2];
          P[i3] = px; P[i3 + 1] = py; P[i3 + 2] = pz;
        } else if (kind === 'peek') {
          Zx = F[i3]; Zy = F[i3 + 1]; Zz = F[i3 + 2];
          const d = Zy; Yx = -d * Zx; Yy = 1 - d * Zy; Yz = -d * Zz;
          const l = h3(Yx, Yy, Yz) || 1; Yx /= l; Yy /= l; Yz /= l;
          Xx = Yy * Zz - Yz * Zy; Xy = Yz * Zx - Yx * Zz; Xz = Yx * Zy - Yy * Zx;
          const e = this.EXP[i * 2];
          px = this.SL[i * 4] + Zx * (e - 0.5) * s; py = this.SL[i * 4 + 1] + Zy * (e - 0.5) * s; pz = this.SL[i * 4 + 2] + Zz * (e - 0.5) * s;
          P[i3] = px; P[i3 + 1] = py; P[i3 + 2] = pz;
        } else if (kind === 'attach') {
          const h = this.host, j = this.HI[i], j3 = j * 3, L = this.LOC, l4 = i * 4;
          const zx = h.F[j3], zy = h.F[j3 + 1], zz = h.F[j3 + 2];
          let rx = zz, rz = -zx; const rl = h2(rx, rz) || 1; rx /= rl; rz /= rl;
          const ux = zy * rz, uy = zz * rx - zx * rz, uz = -zy * rx;
          const bk = h.BANK[j], cb = Math.cos(bk), sb = Math.sin(bk);
          const hYx = ux * cb + rx * sb, hYy = uy * cb, hYz = uz * cb + rz * sb;
          const hXx = rx * cb - ux * sb, hXy = -uy * sb, hXz = rz * cb - uz * sb;
          const hs = h.SZ[j], lx = L[l4] * hs, ly = L[l4 + 1] * hs, lz = L[l4 + 2] * hs;
          px = h.P[j3] + hXx * lx + hYx * ly + zx * lz; py = h.P[j3 + 1] + hXy * lx + hYy * ly + zy * lz; pz = h.P[j3 + 2] + hXz * lx + hYz * ly + zz * lz;
          P[i3] = px; P[i3 + 1] = py; P[i3 + 2] = pz;
          const cyw = Math.cos(L[l4 + 3]), syw = Math.sin(L[l4 + 3]);
          Zx = zx * cyw + hXx * syw; Zy = zy * cyw + hXy * syw; Zz = zz * cyw + hXz * syw;
          Xx = hXx * cyw - zx * syw; Xy = hXy * cyw - zy * syw; Xz = hXz * cyw - zz * syw;
          Yx = hYx; Yy = hYy; Yz = hYz;
        } else if (kind === 'octo' || kind === 'walk') {
          const J = this.JET[i], V = this.AX || this.V, vl = h3(V[i3], V[i3 + 1], V[i3 + 2]) || 1; // octopus: jet axis
          Yx = this.NRM[i3] * (1 - J) + V[i3] / vl * J; Yy = this.NRM[i3 + 1] * (1 - J) + V[i3 + 1] / vl * J; Yz = this.NRM[i3 + 2] * (1 - J) + V[i3 + 2] / vl * J;
          const yl = h3(Yx, Yy, Yz) || 1; Yx /= yl; Yy /= yl; Yz /= yl;
          let zx = F[i3] * (1 - J) - this.NRM[i3] * J, zz = F[i3 + 2] * (1 - J) - this.NRM[i3 + 2] * J; const d = zx * Yx + zz * Yz;
          Zx = zx - d * Yx; Zy = -d * Yy; Zz = zz - d * Yz;
          const l = h3(Zx, Zy, Zz) || 1; Zx /= l; Zy /= l; Zz /= l;
          Xx = Yy * Zz - Yz * Zy; Xy = Yz * Zx - Yx * Zz; Xz = Yx * Zy - Yy * Zx;
        } else if (plan === 'jelly' || plan === 'dumbo') {
          Yx = F[i3]; Yy = F[i3 + 1]; Yz = F[i3 + 2];
          // X = Y x (0,0,1)
          Xx = Yy; Xy = -Yx; Xz = 0; let l = h2(Xx, Xy) || 1; Xx /= l; Xy /= l;
          Zx = Xy * Yz - Xz * Yy; Zy = Xz * Yx - Xx * Yz; Zz = Xx * Yy - Xy * Yx;
        } else if (upright) {
          Yx = 0; Yy = 1; Yz = 0;
          let zx = F[i3], zz = F[i3 + 2]; const l = h2(zx, zz) || 1; Zx = zx / l; Zy = 0; Zz = zz / l;
          Xx = Zz; Xy = 0; Xz = -Zx;
        } else {
          Zx = F[i3]; Zy = F[i3 + 1]; Zz = F[i3 + 2];
          let rx = Zz, rz = -Zx; const rl = h2(rx, rz) || 1; rx /= rl; rz /= rl;
          // up = Z x R
          let ux = Zy * rz, uy = Zz * rx - Zx * rz, uz = -Zy * rx;
          const b = BANK[i] + (this.SPIN ? this.SPIN[i] : 0), cb = Math.cos(b), sb = Math.sin(b);
          Yx = ux * cb + rx * sb; Yy = uy * cb; Yz = uz * cb + rz * sb;
          Xx = rx * cb - ux * sb; Xy = -uy * sb; Xz = rz * cb - uz * sb;
        }
        M[o] = Xx * s; M[o + 1] = Xy * s; M[o + 2] = Xz * s; M[o + 3] = 0;
        M[o + 4] = Yx * s; M[o + 5] = Yy * s; M[o + 6] = Yz * s; M[o + 7] = 0;
        M[o + 8] = Zx * s; M[o + 9] = Zy * s; M[o + 10] = Zz * s; M[o + 11] = 0;
        M[o + 12] = px; M[o + 13] = py; M[o + 14] = pz; M[o + 15] = 1;
      }
      const a = i * 4;
      A[a] = this.PH[i]; A[a + 1] = this.AMP[i]; A[a + 2] = this.BEND[i]; A[a + 3] = this.IFD ? this.fade * this.IFD[i] : this.fade;
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
      if (px < mnx) mnx = px; if (px > mxx) mxx = px; if (py < mny) mny = py; if (py > mxy) mxy = py; if (pz < mnz) mnz = pz; if (pz > mxz) mxz = pz;
    }
    const ext = this.baseSize * (plan === 'jelly' ? 3 : plan === 'octopus' ? 0.8 : 0.75) + 0.5;
    const b = this.bounds;
    b.x = (mnx + mxx) * 0.5; b.y = (mny + mxy) * 0.5; b.z = (mnz + mxz) * 0.5;
    b.r = h3(mxx - mnx, mxy - mny, mxz - mnz) * 0.5 + ext;
    if (writeM) { this.matrixDirty = false; this._mUp = true; }
    this._aUp = true;
    void dt;
  }

  _visibility(c) {
    const b = this.bounds;
    _sphere.center.set(b.x, b.y, this.anchorZ + b.z - c.Oz);
    _sphere.radius = b.r;
    const vis = c.frustum.intersectsSphere(_sphere);
    this.visible = vis;
    this.mesh.visible = vis;
    if (this.nearMesh) this.nearMesh.visible = vis && this.nearCount > 0;
    if (vis) {
      if (this._mUp) { this.mesh.instanceMatrix.needsUpdate = true; this._mUp = false; }
      if (this._aUp) { this.aAnim.needsUpdate = true; this._aUp = false; }
    }
    const dx = b.x - c.x, dy = b.y - c.y, dz = this.anchorZ + b.z - c.z;
    this.dist = Math.max(0, h3(dx, dy, dz) - b.r);
  }

  dispose() {
    const sys = this.sys;
    sys.world.remove(this.mesh);
    for (let k = 0; k < 3; k++) if (this.lodGeo[k]) sys.cache.release(this.lodEntry[k], this.lodGeo[k]);
    this.mesh.dispose();
    if (this.nearMesh) {
      if (this.nearCount) sys.nearActive--;
      sys.world.remove(this.nearMesh); sys.cache.release(this.nearEntry, this.nearGeo); this.nearMesh.dispose(); this.nearMesh = null;
    }
  }
}
const _t = new Float64Array(6);
const _capA = new Float64Array(7), _capB = new Float64Array(7);
const _tv = new THREE.Vector3();
// a point (global coordinates) the camera can see: inside the view frustum and nearer than `maxD`
function inView(c, x, y, z, maxD) { _tv.set(x, y, z - c.Oz); return h3(x - c.x, y - c.y, z - c.z) < maxD && c.frustum.containsPoint(_tv); }
function h2(x, y) { return Math.sqrt(x * x + y * y); }
function h3(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }
function gauss(r) { return (r() + r() + r() + r() - 2) * 1.73; } // ~N(0, 1)
const _sphere = new THREE.Sphere();
const _spot = [0, 0];
function kindNeedsExpose(k) { return k === 'colony' || k === 'peek'; }
