// Whale fall set piece (the 'whalefall' POI of props/nb7_whalefall.js): sharks feeding at a carcass, and a guard that
// keeps other zones' animals away from it.
// Each shark is its own solo encounter on route 'circle' with a zero-radius orbit, so this controller places its
// leader directly every frame (plan.orbit x / y / s; encounter.js steers the animal after it with its usual smooth
// turning). Sharks patrol loops around the carcass at their own distance and height; up to `maxFeed` of them at once
// swim in to a free feeding spot (the last 2.5 m straight in, so they face the flesh), clamp on and twist their whole
// body back and forth for several seconds (a lateral sway plus a roll, SPIN), pull back and rejoin a loop. While the
// camera is alongside, the next feeder favours spots a few metres ahead of it on the side it sees.
// (ringMin: the group centre does not steer around the carcass's obstacles, which would keep it off the flesh; each
// animal's body is still pushed out of them. spacing: a one-animal group has no formation radius, which would hold it
// a body length higher above the mud.) Encounter fields used: plan.orbit, orbR, orbA, SPIN, SZ, n, done, dying, route,
// vl, vs, ll, sp.key, bounds, anchorZ. Nothing here creates objects per frame.
import { mulberry32 } from '../noise.js';

const TAU = Math.PI * 2;
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class WhaleFeed {
  constructor(dir) {
    this.dir = dir; this.sharks = []; this.p = null; this.guard = null; this.next = 0; this.clock = 0; this.rng = mulberry32(0x5f3759df);
    this.maxFeed = 1; this.gT = 0; this.own = null;
    this._t = [0, 0, 0];
  }
  reset() { this.release(); this.p = null; this.guard = null; }
  release() {
    for (const S of this.sharks) {
      const e = S.e;
      if (e.done) continue;
      if (e.SPIN) e.SPIN.fill(0);
      e.route = 'cross'; e.vl = (e.ll >= 0 ? 1 : -1) * 0.4; e.vs = 0.3;
    }
    this.sharks.length = 0;
  }
  // keep other zones' animals away from carcass POI p while the camera is near it (own: the cast's species keys)
  watch(p, own) { this.guard = p; this.own = own; this.gT = 0; }
  // start at a carcass POI: n sharks of species `key` (or key(k) per shark), up to maxFeed feeding at once
  start(p, n, rng, key = 'wfSleeper', maxFeed = 1, opt = null) {
    this.release();
    const d = p.data;
    if (!d || !d.spots || !d.spots.length) return 0;
    this.p = p; this.rng = rng; this.maxFeed = maxFeed; this.sun = !!(opt && opt.sun); this.next = this.clock + (this.sun ? 0.5 : 2 + rng() * 2);
    for (let k = 0; k < n; k++) {
      const th = Math.PI * (0.25 + 0.55 * k / Math.max(1, n - 1)) + rng() * 0.3 + (k > 2 ? Math.PI * (k & 1) : 0);
      const ring = k < 3 ? 0 : (k % 3) * 1.6;
      const S = { e: null, th, A: d.L / 2 + 3.6 + ring, B: 3.5 + ring, h: 0.9 + rng() * 0.7 + ring * 0.5, mode: 0, t: 0, spd: 0.38 + rng() * 0.12, dir: k & 1 ? -1 : 1,
        len: 0, hx: 0, hy: 0, hs: 0, dx: 0, dy: 0, ds: 0, px: 0, py: 0, ps: 0, dur: 0, sq: -1, tiger: false, roll: 0, full: 0 };
      this._loop(S, this._t);
      const e = this.dir.spawnAt(typeof key === 'function' ? key(k) : key, p, { route: 'circle', kind: 'solo', zone: 'mid', n: 1, interest: 0.85,
        orbit: { x: this._t[0], s: this._t[2], y: this._t[1], r: 0.01, w: 0, a0: 0, T: 1e9 }, ringMin: 0.01, spacing: 0.12 });
      if (!e) continue;
      if (!e.SPIN) e.SPIN = new Float32Array(e.n); // (the field exists on every encounter: the hidden class stays)
      S.e = e; S.len = e.SZ ? e.SZ[0] : 3; S.tiger = e.sp.key === 'wfTiger';
      this.sharks.push(S);
    }
    return this.sharks.length;
  }
  // a point of a patrol loop: an ellipse around the carcass (u along it, v across), a little above the seabed
  _loop(S, o) {
    const d = this.p.data, u = S.A * Math.cos(S.th), v = S.B * Math.sin(S.th);
    o[0] = d.cx + u * d.ca + v * d.sa * d.side; o[2] = d.cs + u * d.sa - v * d.ca * d.side;
    o[1] = d.cy + S.h + 0.35 * Math.sin(S.th * 2 + S.spd * 9);
    return o;
  }
  // the guard: once a second, animals of other zones within reach of the carcass fade away (a short zone's neighbours
  // arrived while the carcass was still in view; spawning is also kept to each zone's own ground, see spawnOne)
  _guard(dt, c) {
    const g = this.guard, d = g && g.data;
    if (!d) return;
    if (c.s > d.cs + d.L / 2 + 60 || c.s < d.cs - 260) { this.guard = null; return; }
    this.gT -= dt;
    if (this.gT > 0 || c.s < d.cs - d.L / 2 - 90) return;
    this.gT = 1;
    for (const e of this.dir.sys.enc) {
      if (e.done || e.dying || (this.own && this.own.has(e.sp.key))) continue;
      const es = -(e.anchorZ + e.bounds.z);
      if (Math.abs(es - d.cs) < d.L / 2 + 70 && Math.abs(e.bounds.x - d.cx) < 60) e.dying = true;
    }
  }
  tick(dt, c) {
    this.clock += dt;
    this._guard(dt, c);
    if (!this.p || !this.sharks.length) return;
    const d = this.p.data;
    // the camera has gone on: let them go
    if (c.s > d.cs + d.L / 2 + 40 || c.s < d.cs - 200) { this.release(); this.p = null; return; }
    let busy = 0;
    for (const S of this.sharks) if (S.mode > 0 && !S.e.done) busy++;
    const uc = (c.x - d.cx) * d.ca + (c.s - d.cs) * d.sa; // the camera's place along the body
    for (const S of this.sharks) {
      const e = S.e;
      if (e.done || e.route !== 'circle') continue;
      const O = e.plan.orbit, T = this._t;
      S.t += dt;
      if (S.mode === 0) { // patrol
        const ds = S.spd / Math.max(0.5, Math.hypot(S.A * Math.sin(S.th), S.B * Math.cos(S.th)));
        S.th = (S.th + S.dir * ds * dt + TAU) % TAU;
        this._loop(S, T);
        if (busy < this.maxFeed && this.clock > this.next && S.t > (S.full ? 20 : this.sun ? 1.5 : 4)) { // its turn: a free feeding spot
          const q = this._spot(S, T, uc, busy === 0);
          if (q >= 0) {
            const sp = d.spots, nx = sp[q + 3], ns = sp[q + 5], nl = Math.hypot(nx, ns) || 1;
            // into the flesh: against the spot normal (horizontal part), a little downward
            S.dx = -nx / nl * 0.99; S.ds = -ns / nl * 0.99; S.dy = -0.15;
            S.hx = sp[q] + nx * 0.12; S.hy = sp[q + 1] + 0.05; S.hs = sp[q + 2] + ns * 0.12;
            S.px = T[0]; S.py = T[1]; S.ps = T[2]; S.sq = q;
            S.mode = 1; S.t = 0; busy++;
            this.next = this.clock + (this.sun ? 0.3 + this.rng() * 1.2 : 1 + this.rng() * 2.5);
            // give-way: a smaller shark coming in to (nearly) the same spot veers off for the larger one
            for (const o of this.sharks) if (o !== S && o.mode === 1 && o.len < S.len && Math.hypot(o.hx - S.hx, o.hs - S.hs) < 3.5) { o.mode = 3; o.t = 0; }
          }
        }
      }
      if (S.mode >= 1) {
        const half = S.len * 0.46;
        const bx = S.hx - S.dx * half, by = S.hy - S.dy * half, bs = S.hs - S.ds * half; // body centre at the bite
        const qx = bx - S.dx * 2.5, qy = by - S.dy * 2.5, qs = bs - S.ds * 2.5;         // lined up, 2.5 m out
        if (S.mode === 1) { // approach: swing round to the line-up point, then straight in
          const D1 = Math.hypot(qx - S.px, qy - S.py, qs - S.ps), t1 = Math.max(2.5, D1 / 0.55);
          if (S.t < t1) { const k = sm(S.t / t1); T[0] = S.px + (qx - S.px) * k; T[1] = S.py + (qy - S.py) * k; T[2] = S.ps + (qs - S.ps) * k; }
          else { const k = sm((S.t - t1) / 3.5); T[0] = qx + (bx - qx) * k; T[1] = qy + (by - qy) * k; T[2] = qs + (bs - qs) * k; if (k >= 1) { S.mode = 2; S.t = 0; S.dur = this.sun ? (this.rng() < 0.15 ? 30 + this.rng() * 25 : 15 + this.rng() * 5) : 9 + this.rng() * 7; S.roll = S.tiger && this.rng() < 0.4 ? 1 : 0; } }
        } else if (S.mode === 2) { // clamped on: twisting the whole body back and forth
          const w = Math.sin(S.t * TAU * 0.55), env = sm(S.t / 1.2) * sm((S.dur - S.t) / 1.2);
          const lx = -S.ds, ls = S.dx; // horizontal, across the body
          T[0] = bx + lx * 0.16 * w * env; T[1] = by + 0.05 * Math.abs(w) * env; T[2] = bs + ls * 0.16 * w * env;
          // (a tiger may roll right over onto its back while biting, and saw back and forth there)
          const roll = S.roll ? Math.PI * 0.85 * sm(S.t / 2.5) * sm((S.dur - S.t) / 2.5) : 0;
          for (let i = 0; i < e.n; i++) e.SPIN[i] = 0.6 * w * env + roll;
          if (S.t > S.dur) { S.mode = 3; S.t = 0; e.SPIN.fill(0); }
        } else { // a piece torn off: back out a little and turn away along the body, then rejoin the loop
          const k = sm(S.t / 2.2), al = S.dx * d.sa * d.side - S.ds * d.ca * d.side >= 0 ? 1 : -1;
          T[0] = bx - S.dx * 1.2 * k + d.ca * al * 2.2 * k; T[1] = by + 0.3 * k; T[2] = bs - S.ds * 1.2 * k + d.sa * al * 2.2 * k;
          if (S.t > 2.2) { // nearest loop angle
            const du = (T[0] - d.cx) * d.ca + (T[2] - d.cs) * d.sa, dv = ((T[0] - d.cx) * d.sa - (T[2] - d.cs) * d.ca) * d.side;
            S.th = (Math.atan2(dv / S.B, du / S.A) + TAU) % TAU; S.mode = 0; S.t = 0; S.sq = -1;
            if (this.sun && this.rng() < 0.3) { S.full = 1; S.spd *= 0.6; S.h *= 0.7; } // gorged: slow and heavy, low by the carcass
          }
        }
      }
      // place the leader: the orbit centre is the target (its radius is ~0; the encounter may widen it near rocks)
      // (never up toward the camera's line, ~4.5 m above the seabed beside the carcass)
      const r = e.orbR || O.r;
      O.x = T[0] - r; O.y = Math.min(T[1], d.cy + 2.5); O.s = T[2]; e.orbA = 0;
    }
  }
  // a feeding spot not taken by another shark; the first feeder (front) favours one a few metres ahead of the camera on
  // the side it sees, the others anywhere near their own loop
  _spot(S, T, uc, front) {
    const d = this.p.data, sp = d.spots, nS = sp.length / 6, tx = -d.side * d.sa, ts = d.side * d.ca;
    let best = -1, bd = 1e9;
    for (let i = 0; i < nS; i++) {
      const q = i * 6;
      let taken = false;
      for (const o of this.sharks) if (o !== S && o.mode > 0 && Math.hypot(sp[o.sq] - sp[q], sp[o.sq + 2] - sp[q + 2]) < 2.5) taken = true;
      if (taken) continue;
      const face = sp[q + 3] * tx + sp[q + 5] * ts, high = sp[q + 1] - d.cy > 2.3 || sp[q + 4] > 0.9;
      const us = (sp[q] - d.cx) * d.ca + (sp[q + 2] - d.cs) * d.sa;
      const dd = front && uc > -d.L / 2 - 25 && uc < d.L / 2
        ? Math.abs(us - Math.min(d.L / 2 - 1, uc + 5)) - 6 * face + (high ? 20 : 0) + (face < -0.15 ? 12 : 0) + 2 * this.rng()
        : Math.hypot(sp[q] - T[0], sp[q + 2] - T[2]) * (0.6 + 0.8 * this.rng()) + (high ? 8 : 0);
      if (dd < bd) { bd = dd; best = q; }
    }
    return best;
  }
}
