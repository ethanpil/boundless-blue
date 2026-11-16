// Whale fall in daylight (the sunlit 'whalefall' POI of props/nb7_whalefall.js): a crowd of tiger sharks and oceanic
// whitetips feeding all around the carcass, a cloud of small fish at the wounds, a school wheeling over it, mahi-mahi
// passes. A guard (watch, _guard) keeps other zones' animals away from the carcass.
//
// Sharks are solo 'circle' encounters with a zero-radius orbit whose centre this controller moves every frame.
// Swimming (loops round the body, the run-in, sweeps, arrivals, departures) is left to their own smooth
// steering; the bite itself is posed here (Encounter.HOLD, _holdPose in encounter.js): a curve from wherever the
// shark is to its snout on the flesh, the clamp and 6-22 s of shaking about the snout (a tiger may roll onto its
// back), then the chunk comes free and it backs off and turns away along the body with the piece in its jaws, scraps
// and a pale oily cloud drifting off and the fish rushing in. A larger shark coming in takes a smaller one's place
// (it peels off), new sharks come out of the blue while others leave, and now and then one sweeps fast through the
// fish, which part around it (the encounter's `threats`, as for a bait ball) and close up again.
// Each event in view marks a highlight for the pacing governor and pulls the camera's gaze toward it (POI data
// gx / gy / gs / gw, read by camera.js while it holds the carcass). Nothing here allocates per frame.
// Encounter fields used: HOLD, SPIN, PSI, plan.orbit, orbR, orbA, P, F, V, SL, STL, SZ, n, kind, done, dying, unseen (the
// crowd is kept while the camera is at the carcass), route, speed, vl, vs, ll, anchorZ, sp.key, threats, threatsNext,
// nThreatNext, R, Cx, Cy, Cz, Cvx, Cvz; plan.readLat (high: the director's make-room pass leaves them be).
import * as THREE from 'three';
import { mulberry32 } from '../noise.js';

const TAU = Math.PI * 2;
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const LOOP = 0, IN = 1, HOLDIN = 2, BITE = 3, TEAR = 4, SNAP = 5, SWEEP = 6, ARRIVE = 7, LEAVE = 8;
const held = (st) => st === HOLDIN || st === BITE || st === TEAR;
const busyS = (st) => st === IN || held(st);
const SPOT = 8; // feeding spots (POI data.ring): x, y, s, nx, ny, ns, kind (0 skin, 1 wound rim, 2 deep / bone, 3 tail), u
const _v = new THREE.Vector3();

export class WhaleCrowd {
  constructor(dir) {
    this.dir = dir; this.p = null; this.sharks = []; this.rng = mulberry32(0x2f6e2b1); this.clock = 0;
    this.N = 6; this.maxFeed = 4; this.tier = 0; this.white = false; this.whiteDone = true;
    this.schools = []; this.mill = null; this.mahi = null; this.cam = null; // schools: the fish at the wounds (_school)
    // event counters (dev tools, the pass harness): bites begun, chunks torn free, displacements, arrivals, sweeps, scraps
    this.ev = { bite: 0, chunk: 0, displace: 0, arrive: 0, sweep: 0, snap: 0 };
    this.lx = 0; this.ly = 0; this.lz = 0; // where the latest event happened (global; the sound reads it, src/audio)
    this.nextFeed = 0; this.nextArr = 0; this.nextSweep = 0; this.nextCycle = 0; this.nextDisp = 0; this.open = 0; this.uv = 0;
    this.rushT = 0; this.rx = 0; this.ry = 0; this.rz = 0; this.bA = null; this.bB = null; // rush point (a chunk torn free); the biters the fish crowd
    this.gx = 0; this.gy = 0; this.gz = 0; this.gw = 0; this.gT = 0; this.gp = 0; // gaze pull (camera.js)
    this.scr = new Float32Array(4 * 6); this.nScr = 0; // drifting scraps the small sharks snap at: x, y, z, age
    this.mt = 0; this.mph = 0; this.mahiT = 0; this.mdir = 1; // mahi passes
    this.hazeAcc = 0; this.camD = 1e9; this.camU = -1e9;
    this._t = [0, 0, 0]; this._ex = new Int32Array(4); this._nex = 0; // (spots ruled out for the pick being made)
    this.guard = null; this.own = null; this.guT = 0; // the guard: the carcass POI, the cast's species keys, its timer
  }
  reset() { this.release(); this.p = null; this.guard = null; }
  // keep other zones' animals away from carcass POI p while the camera is near it (own: the cast's species keys)
  watch(p, own) { this.guard = p; this.own = own; this.guT = 0; }
  // the guard: once a second, animals of other zones within reach of the carcass fade away (a short zone's neighbours
  // arrived while the carcass was still in view; spawning is also kept to each zone's own ground, see spawnOne)
  _guard(dt, c) {
    const g = this.guard, d = g && g.data;
    if (!d) return;
    if (c.s > d.cs + d.L / 2 + 60 || c.s < d.cs - 260) { this.guard = null; return; }
    this.guT -= dt;
    if (this.guT > 0 || c.s < d.cs - d.L / 2 - 90) return;
    this.guT = 1;
    const sys = this.dir.sys;
    for (let li = 0; li < 2; li++) for (const e of li ? sys.bg : sys.enc) { // (background life too, background.js)
      if (e.done || e.dying || (this.own && this.own.has(e.sp.key))) continue;
      const es = -(e.anchorZ + e.bounds.z);
      if (Math.abs(es - d.cs) < d.L / 2 + 70 && Math.abs(e.bounds.x - d.cx) < 60) e.dying = true;
    }
  }
  release() {
    for (const S of this.sharks) this._free(S);
    this.sharks.length = 0;
    for (const F of this.schools) this._go(F.e);
    this._go(this.mahi);
    this.schools.length = 0; this.mill = this.mahi = null;
  }
  _go(e) { if (e && !e.done) { e.route = 'cross'; e.vl = (e.ll >= 0 ? 1 : -1) * 0.6; e.vs = 0.4; } }
  _free(S) {
    const e = S.e;
    if (e.done) return;
    if (e.HOLD) e.HOLD[13] = 0;
    if (e.SPIN) e.SPIN.fill(0);
    e.speed = S.spd0; e.route = 'cross'; e.vl = (e.ll >= 0 ? 1 : -1) * 0.5; e.vs = 0.3;
  }

  // ---------------------------------------------------------------- start (director set piece)
  // p: the carcass POI; tier: 0 low .. 3 ultra; white: a very large white shark arrives during the pass
  start(p, rng, tier, white) {
    this.release();
    const d = p.data;
    if (!d || !d.ring || !d.ring.length) return 0;
    this.p = p; this.rng = rng; this.tier = tier;
    this.N = [6, 9, 12, 12][tier]; this.maxFeed = [5, 6, 8, 8][tier];
    this.white = white; this.whiteDone = !white; this.open = 0; this.nScr = 0; this.gw = 0; this.gT = 0;
    this.uv = 0; this.nextFeed = this.clock + 0.5; this.nextArr = this.clock + 4; this.nextSweep = this.clock + 6 + rng() * 4;
    this.nextCycle = this.clock + 14 + rng() * 8; this.nextDisp = this.clock + 8 + rng() * 6;
    const nT = Math.round(this.N * 5 / 12);
    for (let k = 0; k < this.N; k++) {
      const S = this._spawn(k < nT ? 'wfTiger' : 'wfWhitetip', k);
      if (!S) continue;
      // the first few already at the flesh (the carcass is busy when it comes out of the blue), the rest in loops
      if (k < Math.min(4, this.maxFeed - 1) || (k === nT && tier > 0)) {
        let q = -1;
        this._nex = 0;
        for (let j = 0; j < 4; j++) { q = this._spot(S, true); if (q < 0) break; this._bitePose(S, q); if (!this._clash(S)) break; this._ex[this._nex++] = q; q = -1; }
        this._nex = 0;
        if (q >= 0) { S.st = BITE; S.t = rng() * 3; S.dur = S.t + 5 + k * 5 + rng() * 4; this._snapTo(S); }
      }
    }
    // the fish: a cloud of small fish at the wounds (driven like the sharks), bigeye trevally wheeling high over the
    // carcass, mahi-mahi making passes along it, crabs at the scraps on the sand, sometimes a few dolphins looking in
    const dd = this.dir, r = rng;
    // (two clouds of bluestripe snapper at the two feeding sharks nearest the middle of the view, a few bluefin trevally
    // darting in among them)
    this._addSchool('snapper', 'bait', [130, 170, 220, 260][tier], 0, 0.7, 0.95, 0);
    this._addSchool('snapper', 'bait', [80, 110, 140, 170][tier], 1, 0.7, 0.95, 0);
    this._addSchool('bluefinTrevally', 'school', 5 + Math.floor(r() * 4), 0, 1.8, 1, 1);
    const ctr = this._uvw(0, 0, 0, this._t);
    this.mill = dd.spawnAt('jack', { x: ctr[0], y: d.cy, s: -ctr[2], r: 2, type: p.type, data: null }, { kind: 'mill', route: 'hold', vs: 0, zone: 'mid',
      h0: d.cy + d.camH + 2.2 - dd.sys.shape.pathY(-ctr[2]), ringMin: d.L * 0.38, n: [60, 80, 110, 130][tier], interest: 0.5, readLat: 80 });
    this.mdir = r() < 0.5 ? 1 : -1; this._mahiIn();
    { // (the encounters are budgeted: on low 26 groups in all, so one group of crabs)
      const m = this._uvw((r() - 0.5) * d.L * 0.5, -2.6 - r() * 1.5, 0, this._t);
      dd.spawnAt('reefCrab', { x: m[0], y: dd.sys.shape.floorAt(m[0], -m[2]), s: -m[2], r: 2, type: p.type, data: null }, { n: 3 + Math.floor(r() * 3), readLat: 80 });
    }
    if (!d.cam && r() < 0.3) { const m = this._uvw(0, -14, 0, this._t); dd.spawnAt('bottlenose', { x: m[0], y: d.cy, s: -m[2], r: 2, type: p.type, data: null }, { route: 'cross', n: 2 + Math.floor(r() * 3) }); }
    return this.sharks.length;
  }
  _addSchool(key, kind, n, rank, rate, spacing, dart) {
    const T = this._uvw(this.uv + rank * 6, -3, 1.6, [0, 0, 0]);
    const e = this.dir.spawnAt(key, this.p, { kind, route: 'circle', zone: 'mid', n, interest: 0.5, spacing, readLat: 80,
      orbit: { x: T[0], s: -T[2], y: T[1], r: 0.01, w: 0, a0: 0, T: 1e9 }, ringMin: 0.01, noSeek: true });
    if (e) this.schools.push({ e, x: T[0], y: T[1], z: T[2], vx: 0, vy: 0, vz: 0, rank, rate, dart, ph: this.rng() * TAU, S: null, lt: 0 });
  }
  _spawn(key, k, at = null) {
    const p = this.p, d = p.data, r = this.rng;
    const S = { e: null, key, len: 3, big: false, st: LOOP, t: 0, dur: 0, q: -1, spd0: 1, side: 0,
      lc: 0, off: 0, A: 0, Bn: 0, Bf: 0, h: 0, th: 0, dir: 1, spd: 1, ph: r() * TAU,
      H: new Float32Array(14), ax: 0, ay: 0, az: 0, afx: 0, afy: 0, afz: 1, T: 1,
      sx: 0, sy: 0, sz: 0, nx: 0, ny: 0, nz: 0, fbx: 0, fby: 0, fbz: 1, ex: 0, ey: 0, ez: 1,
      w: 3, tw: 0.2, roll: 0, carry: 0, full: 0, chunk: true, vic: null, fresh: 0, tx: 0, ty: 0, tz: 0, ux: 0, uz: 0, lead: 0, bend: 0 };
    // loops: round the body at their own length, height and side bias; low ones run along the near flank, high ones
    // pass over the top (silhouettes against the surface from the camera's side)
    const lv = k % 3;
    S.off = [-3, 1, 5, 9, -1, 3, 7, 11, 0, 4, 8, 12][k % 12] + (r() - 0.5) * 2; S.A = 3 + r() * 3.5;
    S.Bn = 3.0 + r() * 2.2 + (lv === 0 ? 0.6 : 0); S.Bf = 2.8 + r() * 1.2;
    S.h = lv === 0 ? 1.0 + r() * 0.6 : lv === 1 ? 2.4 + r() * 1.0 : 3.8 + r() * 1.4;
    S.th = r() * TAU; S.dir = k & 1 ? -1 : 1; S.lc = clamp(this.uv + S.off, -d.L / 2, d.L / 2);
    const T = at || this._loop(S, this._t);
    const e = this.dir.spawnAt(key, p, { route: 'circle', kind: 'solo', zone: 'mid', n: 1, interest: 0.85, readLat: 120,
      orbit: { x: T[0], s: -T[2], y: T[1], r: 0.01, w: 0, a0: 0, T: 1e9 }, ringMin: 0.01, spacing: 0.12 });
    if (!e) return null;
    if (!e.SPIN) e.SPIN = new Float32Array(e.n); // (the field exists on every encounter: the hidden class stays)
    e.HOLD = S.H;
    S.e = e; S.len = e.SZ[0]; S.big = key !== 'wfWhitetip'; S.spd0 = e.speed; S.spd = Math.max(0.9, Math.min(1.5, e.speed));
    S.w = key === 'wfWhitetip' ? TAU * (1.0 + r() * 0.4) : TAU * (0.5 + r() * 0.2); // whitetips shake faster
    this.sharks.push(S);
    return S;
  }

  // ---------------------------------------------------------------- carcass frame
  // world point (x, y, z = -s) at u along the body, v across (+ away from the route), h above the seabed under it
  _uvw(u, v, h, o) {
    const d = this.p.data, s = d.cs + u * d.sa - v * d.ca * d.side;
    o[0] = d.cx + u * d.ca + v * d.sa * d.side; o[1] = d.cy + h; o[2] = -s;
    return o;
  }
  _loop(S, o) {
    const d = this.p.data, sv = Math.sin(S.th), op = this.open;
    const u = S.lc + S.A * Math.cos(S.th), v = sv < 0 ? (S.Bn + 2.5 * op) * sv : S.Bf * sv;
    let h = S.h + 0.8 * op + 0.35 * Math.sin(S.th * 2 + S.ph);
    if (v < -2.2) h = Math.min(h, d.camH - 1.6); // (never up into the camera's line beside the carcass)
    return this._uvw(u, v, h, o);
  }
  // leader target: the orbit centre (its radius is ~0)
  _lead(S, x, y, z) {
    const e = S.e, O = e.plan.orbit, r = e.orbR || O.r;
    O.x = x - r; O.y = y; O.s = -z; e.orbA = 0;
  }

  // ---------------------------------------------------------------- spots and poses
  // a free feeding spot for S: in view of the camera when it is near (the side it sees, a few metres ahead), the tail
  // stock and flukes favoured early, a big shark at the blubber of the wounds, a small one anywhere; at most one feeder
  // on the far side; low spots only where the body stays out of the sand
  _spot(S, any, own = false) {
    const d = this.p.data, R = d.ring, nS = R.length / SPOT, c = this.cam, rng = this.rng;
    let far = 0;
    for (const o of this.sharks) if (o !== S && busyS(o.st) && o.side > 0) far++;
    const near = c ? clamp((60 - this.camD) / 35, 0, 1) : 0;
    let best = -1, bd = -1e9;
    for (let i = 0; i < nS; i++) {
      const q = i * SPOT, x = R[q], y = R[q + 1], z = -R[q + 2], kind = R[q + 6], u = R[q + 7];
      let taken = false;
      for (let k = 0; k < this._nex; k++) if (this._ex[k] === q) taken = true;
      for (const o of this.sharks) { // (taken: a spot near another feeder's facing the same way; across the top or on the other flank is free)
        if (o === S || o.q < 0 || !busyS(o.st)) continue;
        const dd = Math.hypot(R[o.q] - x, R[o.q + 1] - y, R[o.q + 2] + z), fa = R[o.q + 3] * R[q + 3] + R[o.q + 4] * R[q + 4] + R[o.q + 5] * R[q + 5];
        if (dd < 1.6 || (fa > 0.3 && dd < 1.8 + 0.3 * (o.len + S.len))) { taken = true; break; }
      }
      if (taken) continue;
      if (y - d.cy < 0.35 + S.len * 0.12) continue;
      if (own && (S.e.P[0] - x) * R[q + 3] + (S.e.P[1] - y) * R[q + 4] + (S.e.P[2] + S.e.anchorZ - z) * -R[q + 5] < 0.8) continue; // (on its own side of the body)
      const side = (x - d.cx) * d.sa * d.side - (-z - d.cs) * d.ca * d.side; // > 0: the far side
      if (side > 0.6 && R[q + 4] < 0.55 && far >= 1) continue;
      let sc = rng() * 0.8 + (any ? rng() * 2 : 0);
      if (!any) { // (near it, and on its own side of the body: a shorter run-in)
        const px = S.e.P[0] - x, py = S.e.P[1] - y, pz = S.e.P[2] + S.e.anchorZ - z;
        sc += (px * R[q + 3] + py * R[q + 4] - pz * R[q + 5] > 0.8 ? 0.8 : 0) - 0.06 * Math.hypot(px, py, pz);
      }
      sc += kind === 1 ? (S.big ? 1.0 : 0.4) : kind === 2 ? 0.6 : kind === 3 ? 0.8 + (this.ev.bite < 4 ? 1 : 0) : (S.big ? -0.2 : 0.2);
      if (near > 0) {
        const du = u - this.uv - 3; // (a little further ahead than the gaze: a bite there stays in view for most of its length)
        sc += near * (2.2 * Math.exp(-((du / 7) ** 2)) + (side < -0.6 ? 1.0 : side > 0.6 && R[q + 4] < 0.55 ? -0.6 : 0.3));
      }
      if (sc > bd) { bd = sc; best = q; }
    }
    return best;
  }
  // would S's bite pose (snout to tail) come within reach of another feeder's?
  _clash(S) {
    for (const o of this.sharks) {
      if (o === S || o.q < 0 || !busyS(o.st)) continue;
      const lim = 0.5 + 0.11 * (S.len + o.len);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const ka = a * 0.45 * S.len, kb = b * 0.45 * o.len;
        if (Math.hypot(S.sx - S.fbx * ka - o.sx + o.fbx * kb, S.sy - S.fby * ka - o.sy + o.fby * kb, S.sz - S.fbz * ka - o.sz + o.fbz * kb) < lim) return true;
      }
    }
    return false;
  }
  // the bite: snout on spot q, heading into the flesh (from above on the top of the body, nose down)
  _bitePose(S, q) {
    const d = this.p.data, R = d.ring, e = S.e;
    S.q = q; S.chunk = true;
    const nx = R[q + 3], ny = R[q + 4], nz = -R[q + 5];
    S.nx = nx; S.ny = ny; S.nz = nz;
    S.sx = R[q] + nx * 0.04; S.sy = R[q + 1] + ny * 0.04; S.sz = -R[q + 2] + nz * 0.04;
    let hx = -nx, hz = -nz, hl = Math.hypot(hx, hz);
    if (hl < 0.5) { // on the top: lying along the body, nose down (seen side-on from the camera), from the end it is at
      const u = (e.P[0] - S.sx) * d.ca + (-(e.P[2] + e.anchorZ) + S.sz) * d.sa, su = u > 0 ? -1 : 1;
      hx = d.ca * su + hx * 0.6; hz = -d.sa * su + hz * 0.6; hl = Math.hypot(hx, hz) || 1;
    }
    hx /= hl; hz /= hl;
    const dn = clamp(-0.1 - 0.8 * Math.max(0, ny - 0.25), -0.66, -0.05); // (on the top: nose well down, tail raised, not lying on it)
    const fh = Math.sqrt(1 - dn * dn);
    S.fbx = hx * fh; S.fby = dn; S.fbz = hz * fh;
    // (the body must stay out of the seabed: tilt nose down less on low spots)
    const tailY = S.sy - S.fby * S.len * 0.95;
    if (tailY < d.cy + 0.3) { S.fby = Math.min(0, S.fby + 0.25); const k = Math.sqrt(1 - S.fby * S.fby) / (Math.hypot(S.fbx, S.fbz) || 1); S.fbx *= k; S.fbz *= k; }
    const side = (S.sx - d.cx) * d.sa * d.side - (-S.sz - d.cs) * d.ca * d.side;
    S.side = side > 0.6 && ny < 0.55 ? 1 : 0;
    S.tw = S.big ? 0.2 + this.rng() * 0.08 : 0.16 + this.rng() * 0.06;
    S.roll = S.key === 'wfTiger' && this.rng() < 0.35 ? 1 : 0;
  }
  // put an encounter's member and leader right at the held pose (spawned already biting)
  _snapTo(S) {
    const e = S.e, H = S.H, k = S.len * 0.47;
    H[0] = S.sx - S.fbx * k; H[1] = S.sy - S.fby * k; H[2] = S.sz - S.fbz * k;
    H[3] = S.fbx; H[4] = S.fby; H[5] = S.fbz; H[6] = H[7] = H[8] = 0; H[9] = H[10] = 0; H[11] = 1.2; H[12] = 0; H[13] = 1;
    e.P[0] = H[0]; e.P[1] = H[1]; e.P[2] = H[2] - e.anchorZ; e.F[0] = H[3]; e.F[1] = H[4]; e.F[2] = H[5];
    this._lead(S, H[0], H[1], H[2]);
  }

  // ---------------------------------------------------------------- tick
  tick(dt, c) {
    this.clock += dt;
    this._guard(dt, c);
    if (!this.p) return;
    const d = this.p.data, r = this.rng;
    // the camera has gone on: let them go
    if (c.s > d.cs + d.L / 2 + 40 || c.s < d.cs - 220) { this.release(); this.p = null; return; }
    const uc = (c.x - d.cx) * d.ca + (c.s - d.cs) * d.sa, dist = Math.hypot(c.x - d.cx, c.s - d.cs);
    this.cam = c; this.camD = dist; this.camU = uc;
    // where along the body the camera looks: the whole body from far off, a few metres ahead of it alongside
    const near = clamp((45 - dist) / 25, 0, 1), uvT = clamp(uc + 5, -d.L / 2 + 1.5, d.L / 2 - 1.5) * near;
    this.uv += clamp(uvT - this.uv, -dt * 1.2, dt * 1.2);
    this.open = Math.max(0, this.open - dt / 6);
    // the crowd: drop sharks the system retired, keep N about the carcass (arrivals from the blue)
    let alive = 0, busy = 0, loopN = 0;
    for (let i = this.sharks.length - 1; i >= 0; i--) {
      const S = this.sharks[i];
      if (S.e.done || S.e.dying || S.st < 0) { this.sharks[i] = this.sharks[this.sharks.length - 1]; this.sharks.pop(); if (this.nextArr < this.clock + 1.5) this.nextArr = this.clock + 1.5 + r() * 2.5; continue; }
      if (S.st !== LEAVE) alive++;
      if (busyS(S.st)) busy++;
      if (S.st === LOOP) loopN++;
    }
    if (alive < this.N && this.clock > this.nextArr && near > 0.05) { this._arrive(c, false); this.nextArr = this.clock + 2.5 + r() * 3; }
    if (!this.whiteDone && uc > -d.L / 2 - 12 && near > 0.5) { this.whiteDone = true; this._arrive(c, true); }
    // turnover: now and then one leaves (gorged, or just drifting off) and another comes in
    if (this.clock > this.nextCycle && loopN > 1) {
      this.nextCycle = this.clock + 16 + r() * 12;
      const S = this._pick(LOOP, false);
      if (S) this._leave(S);
    }
    // feeding turns
    if (busy < this.maxFeed && this.clock > this.nextFeed) {
      const S = this._pick(LOOP, true);
      if (S) {
        this.nextFeed = this.clock + 0.6 + r() * 1.6;
        let q = -1;
        this._nex = 0;
        for (let k = 0; k < 4; k++) { // (a spot whose bite pose would put the body into another feeder's is passed over)
          q = this._spot(S, false);
          if (q < 0) break;
          this._bitePose(S, q);
          if (!this._clash(S)) break;
          this._ex[this._nex++] = q; q = -1;
        }
        this._nex = 0;
        if (q >= 0) { S.st = IN; S.t = 0; S.vic = null; S.lead = 0; } else S.q = -1;
      }
    }
    // a larger shark takes a smaller one's place, which it yields (peels off): now and then, and soon after a tiger
    // has come in out of the blue
    if (this.clock > this.nextDisp) {
      let vic = null, S = null;
      for (const o of this.sharks) if (o.st === BITE && !o.big && o.t > 2.5 && this._inView(o.sx, o.sy, o.sz, 35)) { vic = o; break; }
      if (vic) for (const o of this.sharks) if (o.big && o.st === LOOP && o.len > vic.len + 0.5 && (!S || o.fresh > S.fresh)) S = o;
      if (vic && S) { this._bitePose(S, vic.q); S.st = IN; S.t = 0; S.vic = vic; S.lead = 0; this.nextDisp = this.clock + 15 + r() * 10; }
      else this.nextDisp = this.clock + 1.5;
    }
    // a fast pass through the fish
    if (this.schools.length && !this.schools[0].e.done && this.clock > this.nextSweep && near > 0.3) {
      this.nextSweep = this.clock + 7 + r() * 7;
      const F0 = this.schools[0];
      let S = null, bd = 1e9, nl = 0;
      for (const o of this.sharks) if (o.st === LOOP) nl++;
      for (const o of this.sharks) {
        if (o.st !== LOOP || o.t < 1) continue;
        const l = Math.hypot(o.e.P[0] - F0.x, o.e.P[2] + o.e.anchorZ - F0.z);
        if (l > 4 && l < 20 && Math.abs(l - 10) < bd) { bd = Math.abs(l - 10); S = o; }
      }
      if (S) this._sweep(S); else this.nextSweep = this.clock + 1.5;
    }
    for (const S of this.sharks) this._step(S, dt, c);
    this._biters();
    for (const F of this.schools) this._school(F, dt);
    if (this.mill && !this.mill.done) this.mill.unseen = 0;
    if (this.mahi && !this.mahi.done) this.mahi.unseen = 0;
    this._mahi(dt);
    this._haze(dt, c);
    // the camera's gaze pull: toward the latest event in view, eased in and out
    this.gT -= dt;
    const gw = this.gT > 0 ? 1 : 0;
    this.gp += (gw - this.gp) * Math.min(1, dt * (gw ? 1.2 : 0.6));
    d.gx = this.gx; d.gy = this.gy; d.gs = -this.gz; d.gw = this.gp;
    // scraps drift down and age
    for (let k = 0; k < this.nScr; k++) { const o = k * 4; this.scr[o + 1] -= dt * 0.06; this.scr[o + 3] += dt; if (this.scr[o + 3] > 12) { this.scr.copyWithin(o, (this.nScr - 1) * 4, this.nScr * 4); this.nScr--; k--; } }
  }
  // a shark in state st (the one nearest the camera's view along the body when `view`)
  _pick(st, view) {
    let best = null, bd = 1e9;
    for (const S of this.sharks) {
      if (S.st !== st || S.t < 1.5 || (S.full > 0 && S.full > this.clock)) continue;
      const e = S.e, d = this.p.data, u = (e.P[0] - d.cx) * d.ca + (-(e.P[2] + e.anchorZ) - d.cs) * d.sa;
      const k = view ? Math.abs(u - this.uv) + this.rng() * 6 : this.rng();
      if (k < bd) { bd = k; best = S; }
    }
    return best;
  }
  _inView(x, y, z, maxD) {
    const c = this.cam;
    if (!c || Math.hypot(x - c.x, y - c.y, z - c.z) > maxD) return false;
    _v.set(x, y, z - c.Oz);
    return c.frustum.containsPoint(_v);
  }
  // an event at (x, y, z): a highlight for the pacing governor and a pull of the gaze, when the camera can see it
  _event(kind, x, y, z) {
    this.ev[kind]++; this.lx = x; this.ly = y; this.lz = z;
    if (!this._inView(x, y, z, 45)) return;
    this.dir.pace.mark();
    if (this.gT < 0.5 || kind !== 'bite') { this.gx = x; this.gy = y; this.gz = z; this.gT = kind === 'arrive' ? 4 : 3; }
  }

  // ---------------------------------------------------------------- one shark
  _step(S, dt, c) {
    const e = S.e, H = S.H, d = this.p.data, r = this.rng, T = this._t;
    if (e.route !== 'circle') return;
    S.t += dt;
    if (S.st !== LEAVE) e.unseen = 0; // (the crowd stays while the camera is here, out of view or not; it thins out behind it)
    const k47 = S.len * 0.47;
    // its loop centre follows the part of the body the camera sees
    S.lc += clamp(clamp(this.uv + S.off, -d.L / 2 - 1, d.L / 2 + 1) - S.lc, -dt * 1.5, dt * 1.5);
    if (S.carry > 0) { // the piece in its jaws for a few seconds
      S.carry -= dt;
      const fx = this.dir.sys.fx, m = S.len * 0.5;
      if (fx) fx.emit(5, e.P[0] + e.F[0] * m, e.P[1] + e.F[1] * m - 0.04, e.P[2] + e.anchorZ + e.F[2] * m, 0, 0, 0, 0.11 * S.len / 3, 0.12 * S.len / 3, 0.07, 0.62, 0.22, 0.17, 0.95);
    }
    if (S.st === LOOP) {
      const ds = S.spd / Math.max(0.5, Math.hypot(S.A * Math.sin(S.th), (Math.sin(S.th) < 0 ? S.Bn : S.Bf) * Math.cos(S.th)));
      S.th = (S.th + S.dir * ds * dt + TAU) % TAU;
      this._loop(S, T); this._lead(S, T[0], T[1], T[2]);
      // a small shark snaps up a drifting scrap now and then
      if (!S.big && this.nScr && S.t > 3 && r() < dt * 0.25) { S.st = SNAP; S.t = 0; S.dur = 0; S.lead = Math.floor(r() * this.nScr); }
      return;
    }
    if (S.st === IN) { // swim in along the approach line, a carrot that shrinks as it closes in
      const bx = S.sx - S.fbx * k47, by = S.sy - S.fby * k47, bz = S.sz - S.fbz * k47;
      const px = e.P[0], py = e.P[1], pz = e.P[2] + e.anchorZ, dq = Math.hypot(px - bx, py - by, pz - bz);
      const back = clamp(dq - 2.5, 1.5, 6);
      this._lead(S, bx - S.fbx * back, Math.max(by - S.fby * back, d.cy + 0.9), bz - S.fbz * back);
      const face = e.F[0] * S.fbx + e.F[1] * S.fby + e.F[2] * S.fbz;
      if (S.vic && S.vic.st === BITE && S.vic.q === S.q && dq < 7) { this._tear(S.vic, false, S); this._event('displace', S.vic.sx, S.vic.sy, S.vic.sz); S.vic = null; }
      // (the run-in is posed from here: out by the flank, near the camera, the camera's bubble kept the steering off it;
      // only from the open side of the spot, so the curve never cuts through the body)
      const out = (px - S.sx) * S.nx + (py - S.sy) * S.ny + (pz - S.sz) * S.nz;
      if (out > 0.6 && ((dq < 11 && face > -0.2) || (S.t > 4 && dq < 15))) {
        if (S.vic && S.vic.q === S.q && held(S.vic.st)) { this._tear(S.vic, false, S); this._event('displace', S.vic.sx, S.vic.sy, S.vic.sz); }
        S.vic = null;
        S.ax = px; S.ay = py; S.az = pz; S.afx = e.F[0]; S.afy = e.F[1]; S.afz = e.F[2]; H[3] = e.F[0]; H[4] = e.F[1]; H[5] = e.F[2];
        S.T = clamp(dq / 1.6, 1.2, 6.5); S.st = HOLDIN; S.t = 0; S.bend = 0;
      } else if (S.t > 6 && !S.vic && out <= 0.6 && S.lead !== 7) { // round the wrong side of the body: a spot on its own side instead
        const q = this._spot(S, false, true);
        S.lead = 7;
        if (q >= 0) { this._bitePose(S, q); S.t = 0; }
      } else if (S.t > 16) { S.st = LOOP; S.t = 0; S.q = -1; }
      return;
    }
    if (S.st === HOLDIN) { // a curve from where it was onto the flesh, slowing to the clamp
      const bx = S.sx - S.fbx * k47, by = S.sy - S.fby * k47, bz = S.sz - S.fbz * k47;
      const D = Math.hypot(bx - S.ax, by - S.ay, bz - S.az), u = Math.min(1, S.t / S.T);
      const m0 = D * 1.1, m1 = D * 0.6, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
      H[0] = h00 * S.ax + h10 * m0 * S.afx + h01 * bx + h11 * m1 * S.fbx;
      H[1] = h00 * S.ay + h10 * m0 * S.afy + h01 * by + h11 * m1 * S.fby;
      H[2] = h00 * S.az + h10 * m0 * S.afz + h01 * bz + h11 * m1 * S.fbz;
      let vx = d00 * S.ax + d10 * m0 * S.afx + d01 * bx + d11 * m1 * S.fbx, vy = d00 * S.ay + d10 * m0 * S.afy + d01 * by + d11 * m1 * S.fby, vz = d00 * S.az + d10 * m0 * S.afz + d01 * bz + d11 * m1 * S.fbz;
      const vl = Math.hypot(vx, vy, vz) || 1, kf = sm((u - 0.8) / 0.2);
      this._head(S, vx / vl * (1 - kf) + S.fbx * kf, vy / vl * (1 - kf) + S.fby * kf, vz / vl * (1 - kf) + S.fbz * kf, dt);
      H[6] = vx / S.T; H[7] = vy / S.T; H[8] = vz / S.T; H[11] = 0.9; H[12] = 0; H[13] = 1;
      this._lead(S, H[0], H[1], H[2]);
      if (u >= 1) { S.st = BITE; S.t = 0; S.dur = S.big ? 14 + r() * 10 : r() < 0.3 ? 6 + r() * 3 : 13 + r() * 8; this._event('bite', S.sx, S.sy, S.sz); }
      return;
    }
    if (S.st === BITE) { // clamped on: shaking about the snout, the tail thrashing
      const t = S.t, env = sm(t / 0.7) * sm((S.dur - t) / 0.5), w = S.w;
      const jab = t < 1.6 ? 0.18 * Math.sin(Math.min(1, t / 1.6) * TAU * 2) ** 2 : 0; // two quick bites to get a purchase
      const ang = S.tw * env * (Math.sin(w * t) + (S.big ? 0.35 * Math.sin(2.3 * w * t + 1) : 0.15 * Math.sin(1.7 * w * t)));
      const ca = Math.cos(ang), sa = Math.sin(ang);
      this._head(S, S.fbx * ca - S.fbz * sa, S.fby + 0.06 * Math.sin(w * t * 0.5) * env, S.fbx * sa + S.fbz * ca, dt, 4);
      const fx = H[3], fy = H[4], fz = H[5], sx = S.sx + S.nx * jab, sy = S.sy + S.ny * jab, sz = S.sz + S.nz * jab;
      H[0] = sx - fx * k47; H[1] = sy - fy * k47; H[2] = sz - fz * k47;
      H[6] = H[7] = H[8] = 0;
      H[9] = -0.95 * Math.sin(w * t + 0.5) * env; H[10] = 0.75 * Math.sin(w * t - 0.9) * env; H[11] = 1.1 + 0.5 * env; H[12] = 0; H[13] = 1;
      const roll = S.roll ? Math.PI * 0.85 * sm((t - 1) / 2.5) * sm((S.dur - t) / 2) : 0;
      e.SPIN[0] = 0.35 * Math.sin(w * t + 0.3) * env + roll;
      this._lead(S, H[0], H[1], H[2]);
      if (t > S.dur) this._tear(S, true, null);
      return;
    }
    if (S.st === TEAR) { // backing off with the piece, turning away along the body
      const u = Math.min(1, S.t / S.T), kh = sm((u - 0.2) / 0.8);
      const shake = (1 - sm(u / 0.45)) * (S.chunk ? 0.35 : 0.1) * Math.sin(S.w * 1.3 * S.t);
      const bx0 = S.sx - S.fbx * k47, by0 = S.sy - S.fby * k47, bz0 = S.sz - S.fbz * k47, D = S.len * 1.3;
      // (backed out along the spot normal, then off along the exit heading)
      const out = 1.1 * sm(u / 0.5), go = D * sm((u - 0.3) / 0.7);
      H[0] = bx0 + S.nx * out + S.ex * go; H[1] = by0 + Math.max(0, S.ny) * out * 0.5 + 0.35 * sm(u) + S.ey * go; H[2] = bz0 + S.nz * out + S.ez * go;
      let fx = S.fbx + (S.ex - S.fbx) * kh, fy = S.fby + (S.ey - S.fby) * kh, fz = S.fbz + (S.ez - S.fbz) * kh;
      const ca = Math.cos(shake), sa = Math.sin(shake), gx = fx * ca - fz * sa; fz = fx * sa + fz * ca; fx = gx;
      const fl = Math.hypot(fx, fy, fz) || 1;
      this._head(S, fx / fl, fy / fl, fz / fl, dt);
      const sp = S.spd * sm((u - 0.3) / 0.7);
      H[6] = S.ex * sp; H[7] = 0; H[8] = S.ez * sp; H[11] = 1.3; H[12] = 0; H[13] = 1;
      e.SPIN[0] *= 1 - Math.min(1, dt * 2.5);
      this._lead(S, H[0], H[1], H[2]);
      if (u >= 1) { // free swimming again
        H[13] = 0; e.SPIN[0] = 0; S.q = -1;
        e.F[0] = S.ex; e.F[1] = S.ey; e.F[2] = S.ez; e.V[0] = S.ex * S.spd; e.V[1] = 0; e.V[2] = S.ez * S.spd;
        this._rejoin(S);
        if (S.chunk && r() < 0.2) S.full = this.clock + 20; // gorged: it loafs about the carcass a while
      }
      return;
    }
    if (S.st === SNAP) { // after a drifting scrap: swims at it, and from a few metres out a quick lunge (posed)
      if (S.dur > 0) { // the lunge
        const u = Math.min(1, S.t / S.T), k = sm(u), D = S.T * 2.2;
        H[0] = S.ax + S.afx * D * k + (S.sx - S.fbx * k47 - S.ax - S.afx * D) * k * k; H[1] = S.ay + (S.sy - S.fby * k47 - S.ay) * k; H[2] = S.az + S.afz * D * k + (S.sz - S.fbz * k47 - S.az - S.afz * D) * k * k;
        const jerk = 0.35 * Math.sin(u * TAU * 1.5) * (1 - u);
        const ca = Math.cos(jerk), sa = Math.sin(jerk), fx = S.afx + (S.fbx - S.afx) * k, fz = S.afz + (S.fbz - S.afz) * k, fl = Math.hypot(fx, fz) || 1;
        this._head(S, (fx * ca - fz * sa) / fl, S.fby * k, (fx * sa + fz * ca) / fl, dt);
        H[6] = S.fbx * 2; H[7] = 0; H[8] = S.fbz * 2; H[11] = 1.5; H[12] = 0; H[13] = 1;
        this._lead(S, H[0], H[1], H[2]);
        if (u >= 1) {
          this._burst(S.sx, S.sy, S.sz, 7, false); this._event('snap', S.sx, S.sy, S.sz);
          H[13] = 0; e.V[0] = S.fbx * S.spd; e.V[1] = 0; e.V[2] = S.fbz * S.spd; S.carry = 1.5; S.dur = 0; S.q = -1; this._rejoin(S);
        }
        return;
      }
      if (S.lead >= this.nScr) { S.st = LOOP; S.t = 0; return; }
      const o = S.lead * 4, sx = this.scr[o], sy = Math.max(this.scr[o + 1], d.cy + 0.8), sz = this.scr[o + 2];
      this._lead(S, sx - e.F[0] * k47, sy, sz - e.F[2] * k47);
      const m = S.len * 0.5, mx = e.P[0] + e.F[0] * m, my = e.P[1] + e.F[1] * m, mz = e.P[2] + e.anchorZ + e.F[2] * m, dm = Math.hypot(mx - sx, my - sy, mz - sz);
      if (dm < 4.5 && ((sx - mx) * e.F[0] + (sz - mz) * e.F[2]) > 0.4 * dm) { // facing it: lunge
        S.ax = e.P[0]; S.ay = e.P[1]; S.az = e.P[2] + e.anchorZ; S.afx = e.F[0]; S.afy = e.F[1]; S.afz = e.F[2];
        H[3] = e.F[0]; H[4] = e.F[1]; H[5] = e.F[2]; S.bend = 0;
        let fx = sx - mx, fz = sz - mz; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
        S.fbx = fx; S.fby = clamp((sy - my) / Math.max(dm, 0.5), -0.4, 0.4); S.fbz = fz; S.sx = sx; S.sy = sy; S.sz = sz;
        S.T = clamp(dm / 2.4, 0.6, 1.6); S.dur = 1; S.t = 0;
        this.scr.copyWithin(o, (this.nScr - 1) * 4, this.nScr * 4); this.nScr--;
      } else if (S.t > 7) { S.st = LOOP; S.t = 0; this._rejoin(S); }
      return;
    }
    if (S.st === SWEEP || S.st === ARRIVE || S.st === LEAVE) { // along a line (tx..: end point, ux..: unit direction)
      const px = e.P[0], py = e.P[1], pz = e.P[2] + e.anchorZ;
      const along = (px - S.tx) * S.ux + (pz - S.tz) * S.uz; // < 0 before the end point
      const ahead = S.st === SWEEP ? 4 : 5;
      this._lead(S, px + S.ux * ahead, S.ty + (py - S.ty) * 0.3, pz + S.uz * ahead);
      const F0 = this.schools[0];
      if (S.st === ARRIVE && F0 && !F0.e.done && !S.lead && Math.hypot(px - F0.e.Cx, pz - F0.e.Cz - F0.e.anchorZ) < F0.e.R + 2) { S.lead = 1; this._event('sweep', px, py, pz); } // (an arrival through the fish)
      if (S.st === SWEEP && F0 && !S.lead) { // (aimed at the fish until it is through them)
        let ux = F0.x - px, uz = F0.z - pz; const l = Math.hypot(ux, uz);
        if (Math.hypot(px - F0.e.Cx, pz - F0.e.Cz - F0.e.anchorZ) < F0.e.R + 2.5) { S.lead = 1; this._event('sweep', px, py, pz); }
        else if (l < 3 || S.t > 4) S.lead = 1; // (through, or past: on out the way it is going)
        else { ux /= l; uz /= l; S.ux = ux; S.uz = uz; S.tx = F0.x + ux * 2; S.tz = F0.z + uz * 2; S.ty = Math.max(F0.y - 0.3, this.p.data.cy + 1); }
      }
      if (along > (S.st === SWEEP ? 5 : -3) || S.t > (S.st === LEAVE ? 14 : S.st === SWEEP ? 7 : 12)) {
        e.speed = S.spd0;
        if (S.st === LEAVE) { this._free(S); S.st = -1; return; }
        S.st = LOOP; S.t = 0; this._rejoin(S);
      }
    }
  }
  // heading (and the body bend of the turn) for a posed shark
  // (turning at most maxW rad/s and pitching at most 1.5 rad/s, never steeper than ~43 deg down or 30 up: a posed
  // curve with a cusp flipped a shark round in one frame, and one dropping onto the top of the body stood on its nose)
  _head(S, fx, fy, fz, dt, maxW = 2.2) {
    const H = S.H, fl = Math.hypot(fx, fy, fz) || 1, pp = Math.atan2(H[3], H[5]), pt = Math.asin(clamp(H[4], -1, 1));
    let dp = Math.atan2(fx, fz) - pp; dp -= TAU * Math.round(dp / TAU); dp = clamp(dp, -maxW * dt, maxW * dt);
    const th = clamp(pt + clamp(Math.asin(clamp(fy / fl, -0.68, 0.5)) - pt, -1.5 * dt, 1.5 * dt), -0.75, 0.53), yaw = pp + dp, ct = Math.cos(th);
    const tb = clamp(dp / Math.max(dt, 1e-3) * 0.45, -1.1, 1.1);
    S.bend += (tb - S.bend) * Math.min(1, dt * 4);
    H[3] = ct * Math.sin(yaw); H[4] = Math.sin(th); H[5] = ct * Math.cos(yaw); H[9] = S.bend; H[10] = S.bend * 0.6;
  }
  // back to its loop at the angle nearest to where it is
  _rejoin(S) {
    const d = this.p.data, e = S.e, x = e.P[0], s = -(e.P[2] + e.anchorZ);
    const u = (x - d.cx) * d.ca + (s - d.cs) * d.sa, v = ((x - d.cx) * d.sa - (s - d.cs) * d.ca) * d.side;
    S.lc = clamp(u, -d.L / 2, d.L / 2);
    S.th = (Math.atan2(v / (v < 0 ? S.Bn : S.Bf), (u - S.lc) / S.A) + TAU) % TAU;
    S.st = LOOP; S.t = 0;
    // (round the way it is heading)
    const tu = -S.A * Math.sin(S.th), tv = (v < 0 ? S.Bn : S.Bf) * Math.cos(S.th), hu = e.F[0] * d.ca - e.F[2] * d.sa, hv = (e.F[0] * d.sa + e.F[2] * d.ca) * d.side;
    S.dir = tu * hu + tv * hv >= 0 ? 1 : -1;
  }
  // the chunk comes free (or, peel: the shark lets go for a larger one): backing off, then away along the body
  _tear(S, chunk, by) {
    const d = this.p.data;
    S.st = TEAR; S.t = 0; S.chunk = chunk; S.T = chunk ? 2.6 : 1.9;
    // exit: along the body (the side away from the shark taking over, or the one with fewer sharks), out from the flesh
    let su = this.rng() < 0.5 ? 1 : -1;
    if (by) { const bu = (by.e.P[0] - S.sx) * d.ca + (-(by.e.P[2] + by.e.anchorZ) + S.sz) * d.sa; su = bu > 0 ? -1 : 1; }
    let ex = d.ca * su + S.nx * 0.9, ez = -d.sa * su + S.nz * 0.9;
    const l = Math.hypot(ex, ez) || 1; S.ex = ex / l; S.ey = 0.08; S.ez = ez / l;
    if (chunk) {
      this._burst(S.sx, S.sy, S.sz, 26, true);
      S.carry = 3.2;
      this._event('chunk', S.sx, S.sy, S.sz);
      // the fish rush in at the scraps
      this.rushT = 5; this.rx = S.sx + S.nx * 0.9; this.ry = S.sy + 0.3; this.rz = S.sz + S.nz * 0.9;
      if (this.nScr < 6) {
        const o = this.nScr++ * 4; this.scr[o] = S.sx + S.nx * 1.5; this.scr[o + 1] = S.sy + 0.4; this.scr[o + 2] = S.sz + S.nz * 1.5; this.scr[o + 3] = 0;
        // a smaller shark close by goes for the drifting scraps (the smallest kept to pieces that drifted off)
        for (const o2 of this.sharks) if (!o2.big && (o2.st === LOOP || o2.st === IN) && Math.hypot(o2.e.P[0] - S.sx, o2.e.P[2] + o2.e.anchorZ - S.sz) < 14) { o2.st = SNAP; o2.t = 0; o2.q = -1; o2.dur = 0; o2.lead = this.nScr - 1; break; }
      }
    }
  }
  // scraps of flesh and blubber, a pale oily cloud and a few bubbles where a piece came free
  _burst(x, y, z, n, oil) {
    const fx = this.dir.sys.fx;
    if (!fx) return;
    for (let k = 0; k < n; k++) {
      const a = fx.rnd() * TAU, sp = 0.15 + fx.rnd() * 0.45, red = fx.rnd() < 0.55, sz = 0.035 + fx.rnd() * 0.05;
      fx.emit(5, x + (fx.rnd() - 0.5) * 0.3, y + (fx.rnd() - 0.5) * 0.3, z + (fx.rnd() - 0.5) * 0.3, Math.cos(a) * sp, 0.1 + fx.rnd() * 0.25, Math.sin(a) * sp,
        sz, sz * 1.15, 6 + fx.rnd() * 5, red ? 0.6 : 0.85, red ? 0.16 : 0.74, red ? 0.12 : 0.55, 0.95, 0.9, -0.05);
    }
    if (!oil) return;
    for (let k = 0; k < 9; k++) {
      const a = fx.rnd() * TAU, sp = 0.05 + fx.rnd() * 0.15;
      fx.emit(1, x + (fx.rnd() - 0.5) * 0.4, y + fx.rnd() * 0.3, z + (fx.rnd() - 0.5) * 0.4, Math.cos(a) * sp, 0.06 + fx.rnd() * 0.06, Math.sin(a) * sp,
        0.25 + fx.rnd() * 0.2, 1.2 + fx.rnd() * 0.8, 7 + fx.rnd() * 4, 0.8, 0.74, 0.52, 0.32, 0.3, 0.01);
    }
    fx.bubbles(x, y, z, 5, 0.4, 0.6);
  }
  _sweep(S) { // from where it is, through the fish cloud, low, and on out the other side
    const e = S.e, px = e.P[0], pz = e.P[2] + e.anchorZ, F0 = this.schools[0];
    if (!F0 || F0.e.done) return;
    let ux = F0.x - px, uz = F0.z - pz;
    const l = Math.hypot(ux, uz);
    if (l < 3 || l > 22) return;
    ux /= l; uz /= l;
    S.st = SWEEP; S.t = 0; S.lead = 0; S.ux = ux; S.uz = uz; S.tx = F0.x + ux * 2; S.ty = Math.max(F0.y - 0.3, this.p.data.cy + 1); S.tz = F0.z + uz * 2;
    e.speed = Math.min(2.6, S.spd0 * 2.2);
  }
  _leave(S) { // off into the blue, away from the camera's side
    const d = this.p.data, e = S.e;
    const v = 30, u = (this.rng() - 0.5) * 20, T = this._uvw(u, v, 3, this._t);
    let ux = T[0] - e.P[0], uz = T[2] - (e.P[2] + e.anchorZ); const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
    S.st = LEAVE; S.t = 0; S.ux = ux; S.uz = uz; S.tx = T[0]; S.ty = d.cy + 3; S.tz = T[2];
  }
  // a new shark out of the blue: mostly from ahead, straight down the near flank toward the camera; sometimes over the
  // top from the far side. The others open up their loops for it.
  _arrive(c, white) {
    const d = this.p.data, r = this.rng;
    if (this.dir.sys.enc.length >= this.dir.sys.maxEnc - 2) return;
    const fromAhead = r() < 0.7; // (the camera travels toward +u)
    const u0 = fromAhead ? this.camU + 30 + r() * 6 : this.uv + (r() - 0.5) * 6, v0 = fromAhead ? -3 - r() * 3 : 18 + r() * 6;
    const A = this._uvw(u0, v0, fromAhead ? 2 : 3.5, [0, 0, 0]);
    let nT = 0;
    for (const o of this.sharks) if (o.key === 'wfTiger' && o.st !== LEAVE) nT++;
    const S = this._spawn(white ? 'wfWhite' : nT < Math.round(this.N * 5 / 12) ? 'wfTiger' : 'wfWhitetip', this.sharks.length, A);
    if (!S) return;
    const B = this._uvw(this.uv, fromAhead ? -3.5 : -1, fromAhead ? 1.6 : 3.8, this._t), F0 = this.schools[0];
    if (fromAhead && F0 && !F0.e.done && r() < 0.5) { B[0] = F0.x; B[1] = Math.max(F0.y - 0.3, d.cy + 1); B[2] = F0.z; } // (straight through the fish)
    let ux = B[0] - A[0], uz = B[2] - A[2]; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
    S.st = ARRIVE; S.t = 0; S.fresh = this.clock; S.ux = ux; S.uz = uz; S.tx = B[0]; S.ty = B[1]; S.tz = B[2];
    S.e.F[0] = ux; S.e.F[1] = 0; S.e.F[2] = uz; S.e.PSI[0] = Math.atan2(ux, uz);
    this.open = 1;
    this._event('arrive', A[0], A[1], A[2]);
    if (white) for (const o of this.sharks) if (o.key === 'wfTiger' && o.st === LOOP) { this._leave(o); break; } // (the tigers leave it room)
  }

  // ---------------------------------------------------------------- the fish
  // the two feeding sharks on the near side nearest the middle of the view (the fish crowd at their heads)
  _biters() {
    const d = this.p.data;
    let a = null, b = null, ka = 1e9, kb = 1e9;
    for (const S of this.sharks) {
      if (S.st !== BITE || S.side) continue;
      const k = Math.abs((S.sx - d.cx) * d.ca + (-S.sz - d.cs) * d.sa - this.uv);
      if (k < ka) { b = a; kb = ka; a = S; ka = k; } else if (k < kb) { b = S; kb = k; }
    }
    this.bA = a; this.bB = b;
  }
  // a school's centre: at the head of its feeding shark (beside the wound, just above it), else over the flank in view;
  // rushing in where a chunk came free; the darting ones swing about their spot. Sharks in or by it: the fish part
  // around them (the encounter's `threats`, as for a bait ball), and it gives way to a fast one.
  _school(F, dt) {
    const e = F.e, d = this.p.data, T = this._t;
    if (e.done) return;
    e.unseen = 0;
    // (a bait ball follows its centre only slowly: it keeps to one shark while that one feeds, and eases about)
    if (!F.S || F.S.st !== BITE || F.S.e.done) F.S = F.rank ? this.bB : this.bA;
    const S = F.S;
    if (S) { T[0] = S.sx + S.nx * 1.7; T[1] = Math.max(S.sy + 0.4, d.cy + 1.2); T[2] = S.sz + S.nz * 1.7; }
    else this._uvw(this.uv + F.rank * 6, -3.2, 1.6 + F.rank * 0.4, T);
    let rate = F.rate;
    if (this.rushT > 0 && (F.rank === 0 || Math.hypot(this.rx - F.x, this.rz - F.z) < 10)) { T[0] = this.rx; T[1] = this.ry; T[2] = this.rz; rate *= 1.6; }
    if (F.dart) { F.ph += dt * 1.9; T[0] += Math.sin(F.ph) * 2.2; T[1] += Math.sin(F.ph * 1.7) * 0.5; T[2] += Math.cos(F.ph * 0.8) * 2.2; }
    const k = Math.min(1, dt * 1.5);
    F.vx += ((T[0] - F.x) * 0.6 - F.vx) * k; F.vy += ((T[1] - F.y) * 0.6 - F.vy) * k; F.vz += ((T[2] - F.z) * 0.6 - F.vz) * k;
    const vl = Math.hypot(F.vx, F.vy, F.vz);
    if (vl > rate) { F.vx *= rate / vl; F.vy *= rate / vl; F.vz *= rate / vl; }
    F.x += F.vx * dt; F.y += F.vy * dt; F.z += F.vz * dt;
    if (!e.threatsNext) { e.threatsNext = new Float32Array(24); e.threats = new Float32Array(24); e.nThreatNext = 0; }
    const R2 = (e.R + 2.5) ** 2;
    let px = 0, pz = 0;
    for (const X of this.sharks) {
      const s = X.e;
      if (s.done) continue;
      const m = X.len * 0.3, x = s.P[0] + s.F[0] * m, y = s.P[1], z = s.P[2] + s.anchorZ + s.F[2] * m;
      const qx = x - e.Cx, qy = y - e.Cy, qz = z - e.anchorZ - e.Cz, q2 = qx * qx + qy * qy + qz * qz;
      if (q2 > R2) continue;
      if (e.nThreatNext < 8 && !held(X.st)) { const o = e.nThreatNext++ * 3; e.threatsNext[o] = x; e.threatsNext[o + 1] = y; e.threatsNext[o + 2] = z - e.anchorZ; }
      if (X.st === SWEEP || X.st === ARRIVE) { const q = Math.sqrt(q2) || 1, k = (1 - q / Math.sqrt(R2)) * 2.5; px -= qx / q * k; pz -= qz / q * k; }
    }
    const O = e.plan.orbit, r = e.orbR || O.r;
    O.x = F.x + px - r; O.y = F.y; O.s = -(F.z + pz); e.orbA = 0;
    // the formation: every push of the separation pass (sharks held on the flesh inside the cloud) widens a bait ring
    // slot for good (Encounter._slotShift), so over a pass the rings grew to 100 m and more and fish swam off along
    // them, up to the surface; the slots are put back inside the ball here, and a fish already far off rejoins the
    // school out of view
    F.lt -= dt;
    if (F.lt <= 0) {
      F.lt = 0.5;
      const P = e.P, V = e.V, SL = e.SL, far = e.R * 2.5 + 4, az = e.anchorZ, Rr = e.R, bait = e.kind === 'bait';
      for (let i = 0; i < e.n; i++) {
        const i3 = i * 3, o = i * 4, x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
        if (bait) {
          if (SL[o] > Rr * 1.15) { SL[o] = Rr * (0.4 + 0.6 * this.rng()); SL[o + 3] = e.speed / SL[o]; }
          if (Math.abs(SL[o + 2]) > Rr) SL[o + 2] *= 0.7;
        } else { const l = Math.hypot(SL[o], SL[o + 1], SL[o + 2]); if (l > Rr * 1.6) { const k = Rr * 1.2 / l; SL[o] *= k; SL[o + 1] *= k; SL[o + 2] *= k; } }
        if (Math.hypot(x - e.Cx, y - e.Cy, z - e.Cz) < far || this._inView(x, y, z + az, 45)) continue; // (one more fish in a cloud of a hundred: unseen)
        const a = this.rng() * TAU, q = this.rng() * e.R;
        P[i3] = e.Cx + Math.cos(a) * q; P[i3 + 1] = e.Cy + (this.rng() - 0.5) * e.R; P[i3 + 2] = e.Cz + Math.sin(a) * q;
        V[i3] = e.Cvx; V[i3 + 1] = 0; V[i3 + 2] = e.Cvz; e.STL[i] = 0;
      }
    }
  }
  // mahi-mahi: fast passes along the near side of the carcass, then a wide swing out into the blue and back (a new
  // group comes in once one has gone)
  _mahiIn() {
    const d = this.p.data, M0 = this._uvw(0, -30.4, 4.4, this._t); // (half way round the wide swing, out in the blue)
    this.mahi = this.dir.spawnAt('mahi', this.p, { kind: 'school', route: 'circle', zone: 'mid', n: 3 + Math.floor(this.rng() * 3), interest: 0.6, readLat: 80,
      orbit: { x: M0[0], s: -M0[2], y: M0[1], r: 0.01, w: 0, a0: 0, T: 1e9 }, ringMin: 0.01 });
    this.mt = 7; this.mph = 2; this.mahiT = this.clock + 25;
    void d;
  }
  _mahi(dt) {
    const e = this.mahi, d = this.p.data;
    if (!e || e.done) { if (this.clock > this.mahiT && this.camD < 45) { this.mdir = -this.mdir; this._mahiIn(); } return; }
    this.mt += dt;
    const T = this._t;
    if (this.mph === 1) { // the pass: 3 m/s, from beyond one end to beyond the other
      const u = (-d.L / 2 - 14 + this.mt * 3) * this.mdir;
      this._uvw(u, -4.4, 2.4, T);
      if (this.mt * 3 > d.L + 28) { this.mph = 2; this.mt = 0; }
    } else { // out wide (a half circle 25 m out) and back for the next pass the other way
      const a = Math.min(1, this.mt / 14) * Math.PI, u = (d.L / 2 + 14) * this.mdir * Math.cos(a), v = -4.4 - 26 * Math.sin(a);
      this._uvw(u, v, 2.4 + 2 * Math.sin(a), T);
      if (this.mt > 14) { this.mph = 1; this.mt = 0; this.mdir = -this.mdir; }
    }
    const O = e.plan.orbit, r = e.orbR || O.r;
    O.x = T[0] - r; O.y = T[1]; O.s = -T[2]; e.orbA = 0;
  }
  // a fine haze of scraps drifting off the wounds the camera looks at
  _haze(dt, c) {
    const fx = this.dir.sys.fx, d = this.p.data, R = d.ring;
    if (!fx || this.camD > 50) return;
    this.hazeAcc += dt * [6, 9, 12, 14][this.tier];
    while (this.hazeAcc >= 1) {
      this.hazeAcc -= 1;
      const q = Math.floor(fx.rnd() * (R.length / SPOT)) * SPOT;
      if (R[q + 6] === 0 || Math.abs(R[q + 7] - this.uv) > 9) continue;
      const sz = 0.02 + fx.rnd() * 0.03, red = fx.rnd() < 0.5;
      fx.emit(5, R[q] + R[q + 3] * 0.3, R[q + 1] + R[q + 4] * 0.3 + 0.1, -R[q + 2] - R[q + 5] * 0.3, (fx.rnd() - 0.5) * 0.12, 0.03 + fx.rnd() * 0.05, (fx.rnd() - 0.5) * 0.12,
        sz, sz * 1.3, 7 + fx.rnd() * 5, red ? 0.55 : 0.8, red ? 0.2 : 0.7, red ? 0.16 : 0.52, 0.8, 0.6, 0.004);
    }
  }
}
