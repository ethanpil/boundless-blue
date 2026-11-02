// Rare surprise encounters: recreational divers who wave at the camera, a research submersible, a
// tethered ROV at work, an autonomous ocean glider and — very rarely — a leviathan out in the murk.
//
// Contract (main.js): new Surprises(world, env); update(dt, time, cam); subjects(out); labels(out).
// Scheduling runs on simulation time and is never reset by zone changes; the remaining time of every
// timer is also kept in localStorage, so jumping zones (which reloads the page) keeps the rhythm.
// A due surprise waits for an eligible zone and a safe lane, is built in small steps across frames,
// its shaders compile asynchronously, and only then is it added to the world. Idle cost: a few
// subtractions per frame. Everything an encounter creates is disposed when it ends (shared materials
// are kept, re-creating them would recompile their programs).
//
// Debug (window.__ocean.surprises): trigger(kind), stop(), list(), schedule(); URL ?surprise=<kind>
// triggers that kind a few seconds after load.
import * as THREE from 'three';
import { Obstacles } from '../obstacles.js';
import { mulberry32 } from '../noise.js';
import { SurpriseFX } from './fx.js';
import { darkness, disposeTree } from './kit.js';
import { Divers } from './divers.js';
import { Submersible } from './sub.js';
import { Rov } from './rov.js';
import { Kaiju } from './kaiju.js';
import { Glider } from './glider.js';

const MIN = 60;
const DIVER_ZONES = ['reef', 'softcoral', 'wreck', 'ruins', 'cave', 'sunkenforest', 'anemone', 'champagne', 'bluehole', 'sandflat', 'seagrass', 'kelp'];
const KINDS = {
  kaiju: { cls: Kaiju, every: [120 * MIN, 180 * MIN], first: [50 * MIN, 120 * MIN],
    zones: ['pelagic', 'abyss', 'seamount', 'wall', 'bluehole', 'deepplain', 'sargassum', 'vents'] },
  sub: { cls: Submersible, every: [48 * MIN, 72 * MIN], first: [14 * MIN, 40 * MIN],
    zones: ['reef', 'softcoral', 'wall', 'kelp', 'pelagic', 'wreck', 'ruins', 'vents', 'deepplain', 'abyss', 'seamount', 'sargassum', 'bluehole', 'sandflat', 'polar'] },
  rov: { cls: Rov, every: [38 * MIN, 52 * MIN], first: [9 * MIN, 30 * MIN],
    zones: ['vents', 'deepplain', 'abyss', 'wall', 'seamount', 'wreck', 'bluehole', 'pelagic'] },
  glider: { cls: Glider, every: [35 * MIN, 55 * MIN], first: [12 * MIN, 35 * MIN],
    zones: ['pelagic', 'sargassum', 'seamount', 'wall', 'bluehole', 'kelp', 'polar', 'abyss'] },
  divers: { cls: Divers, every: [15 * MIN, 25 * MIN], first: [3 * MIN, 9 * MIN], zones: DIVER_ZONES },
};
const ORDER = ['kaiju', 'sub', 'rov', 'glider', 'divers']; // rarest first when several are due
const STORE = 'boundlessBlue.surprises.v1';
const OLD_STORE = 'endlessOcean.surprises.v1'; // before the rename to Boundless Blue
const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

const _n = { x: 0, y: 0, s: 0 };

export class Surprises {
  constructor(world, env) {
    this.world = world; this.env = env;
    this.shape = env.shape; this.seq = env.seq; this.U = env.U;
    this.tier = env.tier || 'high'; this.low = this.tier === 'low';
    this.rng = mulberry32((Math.random() * 4294967296) >>> 0);
    this.clock = 0;          // simulation seconds since load
    this.fx = null;          // particles, created with the first encounter
    this.active = null; this.building = null; this.ready = null;
    this.gap = 0;            // quiet time after an encounter
    this.checkT = 0; this.saveT = 0;
    this.cam = null;
    this._q = [];            // obstacle query buffer
    this.last = '';          // kind of the latest encounter
    this.log = [];           // [{ kind, t }] encounters so far (debug)
    this.due = {};
    for (const k of ORDER) this.due[k] = this._range(KINDS[k].first);
    this._restore();
    const f = qs.get('surprise');
    if (f && KINDS[f]) this._forced = { kind: f, t: 4 };
    if (typeof addEventListener === 'function') {
      addEventListener('pagehide', () => this._save());
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this._save(); });
    }
  }
  _range(r) { return r[0] + (r[1] - r[0]) * this.rng(); }

  // ---------- persistence (remaining time per kind; sim time, so time away does not count) ----------
  _restore() {
    try {
      const raw = localStorage.getItem(STORE) || localStorage.getItem(OLD_STORE);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (!o || !o.due) return;
      for (const k of ORDER) {
        const v = +o.due[k];
        if (Number.isFinite(v)) this.due[k] = Math.min(Math.max(v, 20), KINDS[k].every[1]);
      }
    } catch (e) { /* storage blocked: start fresh */ }
  }
  _save() {
    try { localStorage.setItem(STORE, JSON.stringify({ due: this.due, at: Date.now() })); } catch (e) { /* ignore */ }
  }

  // ---------- world queries shared by the encounters (GLOBAL coords, s = -z) ----------
  floor(x, s) { return this.shape.floorAt(x, s); }
  // lowest of the cave / ice ceiling and the water surface
  ceil(x, s) { return Math.min(this.shape.ceilingAt(x, s), 0); }
  zoneKey(s) {
    let best = null, bw = -1;
    for (const e of this.seq.weights(s)) if (e.w > bw) { bw = e.w; best = e.key; }
    return best;
  }
  fogD() {
    const sg = this.U.uSigma.value, m = Math.max(1e-3, Math.min(sg.x, sg.y, sg.z));
    return Math.max(45, Math.min(160, 3 / m));
  }
  sigmaG() { return Math.max(0.005, this.U.uSigma.value.y); }
  dark(y) { return darkness(y); }
  night() { return this.U.uNight.value; }
  // distance from a global point to the camera
  camDist(x, y, z) { const c = this.cam; return c ? Math.hypot(x - c.x, y - c.y, z - c.z) : 1e9; }
  // Distance from the point to the nearest solid obstacle surface (ours excluded); writes the outward
  // normal of the nearest one into n ({x, y, s}) when given. Returns 99 when nothing is near.
  obsDist(x, y, s, reach, n) {
    const reg = this.env.obstacles;
    if (!reg || !reg.count) return 99;
    const q = reg.query(x, s, reach, this._q);
    let best = 99;
    for (let i = 0; i < q.length; i++) {
      const o = q[i];
      if (o.sur) continue;
      const d = Obstacles.dist(o, x, y, s, _n);
      if (d < best) { best = d; if (n) { n.x = _n.x; n.y = _n.y; n.s = _n.s; } }
    }
    return best;
  }
  /**
   * Clearance of a sphere (x, y, s, r) from the seabed, the ceiling / surface and solid obstacles.
   * Accumulates a push-out direction weighted by how far inside `margin` it is into out {x, y, s}
   * (when given) and returns the smallest gap (negative = penetrating).
   */
  clear(x, y, s, r, margin = 0.5, out = null) {
    let f = this.floor(x, s), c = this.ceil(x, s);
    if (!Number.isFinite(f)) f = this.shape.floorExact(x, s);
    if (!Number.isFinite(c)) c = Math.min(this.shape.ceilingExact(x, s), 0);
    const gf = y - r - f, gc = c - r - y;
    let g = Math.min(gf, gc);
    if (out) {
      if (gf < margin) out.y += margin - gf;
      if (gc < margin) out.y -= margin - gc;
    }
    const go = this.obsDist(x, y, s, r + margin + 2, _o) - r;
    if (go < g) g = go;
    if (out && go < margin) { const k = margin - go; out.x += _o.x * k; out.y += _o.y * k; out.s += _o.s * k; }
    return g;
  }
  // Moving obstacle (a capsule in GLOBAL x, y, s) so creatures steer around our bodies. h = a handle object.
  reg(h, ax, ay, as, bx, by, bs, r) {
    const reg = this.env.obstacles;
    if (!reg) return;
    if (h._cells) reg.remove(h);
    h.ax = ax; h.ay = ay; h.as = as; h.bx = bx; h.by = by; h.bs = bs; h.r = r; h.sur = true;
    reg.add(h);
  }
  unreg(h) { if (h && h._cells && this.env.obstacles) this.env.obstacles.remove(h); }

  // ---------- scheduling ----------
  _eligible(kind, force) {
    const c = this.cam;
    if (!c) return false;
    if (force) return true;
    const z = KINDS[kind].zones, a = this.zoneKey(c.s + 40), b = this.zoneKey(c.s + 160);
    return z.includes(a) && z.includes(b);
  }
  _begin(kind, force = false, sync = false, opts = {}) {
    if (!this.cam) return 'no camera yet';
    if (!this.fx) this.fx = new SurpriseFX(this.world, this.U, this.low ? 500 : 900);
    const inst = new KINDS[kind].cls(this, this.rng);
    inst.opts = opts;
    let ok = false;
    try { ok = inst.plan(this.cam, force); } catch (e) { console.error(e); }
    if (!ok) return 'no safe place for it here';
    this.building = { inst, gen: inst.build(), kind, sync };
    if (sync) { while (!this.building.gen.next().done); this._built(); return this.active === inst ? 'ok' : 'could not start clear of the scenery'; }
    return 'ok';
  }
  _built() {
    const b = this.building; this.building = null;
    const inst = b.inst, r = this.env.renderer;
    if (b.sync || !r || !r.compileAsync) { this._activate(inst); return; }
    this._compileT = 0;
    this.ready = null; this._compiling = inst;
    const done = () => { if (this._compiling === inst) { this._compiling = null; this.ready = inst; } };
    this._compile(inst).then(done, done);
  }
  // Compile every program the encounter will draw, exactly as the scene pass will draw it. The scene is
  // rendered into a render target (post.js), which selects a different program variant (linear output,
  // no tone mapping) than the canvas, so a scratch target is bound while three builds the programs.
  // Objects that join the world outside inst.root (ROV tether, lamp pools, the particles) are included;
  // each material has a single variant, so compileAsync's readiness check covers all of them.
  _compile(inst) {
    const r = this.env.renderer, cam = this.env.camera, scene = this.env.scene;
    const objs = [inst.root, this.fx.mesh];
    if (inst.extras) for (const o of inst.extras()) if (o) objs.push(o);
    const prev = r.getRenderTarget();
    if (!this._rt) this._rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    r.setRenderTarget(this._rt);
    let jobs;
    try { jobs = objs.map((o) => r.compileAsync(o, cam, scene)); } finally { r.setRenderTarget(prev); }
    return Promise.all(jobs);
  }
  _activate(inst) {
    let ok = false;
    try { ok = inst.start(this.cam); } catch (e) { console.error(e); }
    if (!ok) { this._end(inst, false); return false; }
    this.world.add(inst.root);
    this.active = inst; this.last = inst.kind;
    this.log.push({ kind: inst.kind, t: Math.round(this.clock) });
    if (this.log.length > 50) this.log.shift();
    const k = KINDS[inst.kind];
    this.due[inst.kind] = this._range(k.every);
    return true;
  }
  _end(inst, wasActive = true) {
    try { inst.dispose(); } catch (e) { console.error(e); }
    if (inst.root) { if (inst.root.parent) inst.root.parent.remove(inst.root); disposeTree(inst.root); }
    if (this.active === inst) this.active = null;
    if (wasActive) this.gap = 100 + 100 * this.rng();
  }

  update(dt, time, cam) {
    this.cam = cam;
    if (dt > 0) {
      this.clock += dt;
      for (const k of ORDER) this.due[k] -= dt;
      if (this.gap > 0) this.gap -= dt;
      this.saveT -= dt;
      if (this.saveT <= 0) { this.saveT = 30; this._save(); }
    }
    if (this.building) {
      const t0 = performance.now(), b = this.building;
      try {
        while (performance.now() - t0 < 3) { if (b.gen.next().done) { this._built(); break; } }
      } catch (e) { console.error(e); this.building = null; }
    } else if (this.ready) {
      const inst = this.ready; this.ready = null;
      this._activate(inst);
    } else if (this._compiling) { // never wait forever on a compile status (lost context, frozen timers)
      this._compileT += Math.max(dt, 1 / 60);
      if (this._compileT > 15) { const inst = this._compiling; this._compiling = null; this._activate(inst); }
    }
    const a = this.active;
    if (a) {
      a.update(dt, time, cam);
      if (a.done) this._end(a);
    }
    if (this.fx) this.fx.update(dt, cam.z);
    if (dt <= 0 || a || this.building || this._compiling || this.ready) return;
    if (this._forced) {
      this._forced.t -= dt;
      if (this._forced.t <= 0) { const k = this._forced.kind; this._forced = null; this._begin(k, true); }
      return;
    }
    if (this.gap > 0) return;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 2;
    const fast = this.cam.s - (this._lastS ?? this.cam.s) > 60; // fast-forwarding: wait for a calmer pace
    this._lastS = this.cam.s;
    if (fast) return;
    for (const k of ORDER) {
      if (this.due[k] > 0 || !this._eligible(k, false)) continue;
      if (this._begin(k) === 'ok') break; // otherwise it stays due and retries at the next check
    }
  }

  subjects(out) { const a = this.active; if (a && !a.done) a.subjects(out); return out; }
  labels(out) { const a = this.active; if (a && !a.done) a.labels(out); return out; }

  // ---------- debug API ----------
  /**
   * Start a surprise now, wherever we are (zone rules relaxed; a safe lane is still required).
   * opts: { sync: build and add at once (tests), ...variant options read by the encounter (e.g. mode) }.
   */
  trigger(kind, opts = {}) {
    if (!KINDS[kind]) return `unknown surprise "${kind}" (${ORDER.join(', ')})`;
    if (this.active) this._end(this.active, false);
    this.building = null; this.ready = null; this._compiling = null;
    return this._begin(kind, true, !!opts.sync, opts);
  }
  stop() { if (this.active) { const k = this.active.kind; this._end(this.active); return 'stopped ' + k; } return 'nothing active'; }
  list() {
    return ORDER.map((k) => ({
      kind: k, active: !!(this.active && this.active.kind === k), dueIn: Math.max(0, Math.round(this.due[k])),
      every: KINDS[k].every.map((v) => Math.round(v / MIN) + ' min').join('-'), zones: KINDS[k].zones.join(' '),
    }));
  }
  schedule() {
    const f = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(x).padStart(2, '0')}s`; };
    const st = this.active ? `active: ${this.active.kind}` : this.building || this._compiling ? 'preparing…' : this.gap > 0 ? `quiet ${f(this.gap)}` : 'waiting';
    return ORDER.map((k) => `${k} ${this.due[k] <= 0 ? 'due (waiting for its zone)' : 'in ' + f(this.due[k])}`).join(' · ') + ` | ${st}`;
  }
  get summary() { return this.schedule(); }
}
const _o = { x: 0, y: 0, s: 0 };
