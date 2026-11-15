// Whale fall set piece (the 'whalefall' POI of props/nb7_whalefall.js): the scavengers at a carcass, and the
// sleeper sharks taking turns to feed on it.
// Each shark is its own solo encounter on route 'circle' with a zero-radius orbit, so this controller places its
// leader directly every frame (plan.orbit x / y / s; encounter.js steers the animal after it with its usual smooth
// turning): it patrols a slow loop around the carcass a little above the mud, then, one shark at a time, swims in
// to a feeding spot on the open flank (the last 2.5 m straight in, so it faces the flesh), clamps on and twists its
// whole body back and forth for several seconds (a lateral sway plus a roll, SPIN), pulls back with a piece and
// rejoins the loop. (ringMin: the group centre does not steer around the carcass's obstacles, which would keep it off
// the flesh; each animal's body is still pushed out of them. spacing: a one-animal group has no formation radius,
// which would hold it a body length higher above the mud.) Nothing here creates objects per frame.
import { mulberry32 } from '../noise.js';

const TAU = Math.PI * 2;
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class WhaleFeed {
  constructor(dir) {
    this.dir = dir; this.sharks = []; this.p = null; this.next = 0; this.clock = 0; this.rng = mulberry32(0x5f3759df);
    this._t = [0, 0, 0];
  }
  reset() { this.release(); this.p = null; }
  release() {
    for (const S of this.sharks) {
      const e = S.e;
      if (e.done) continue;
      if (e.SPIN) e.SPIN.fill(0);
      e.route = 'cross'; e.vl = (e.ll >= 0 ? 1 : -1) * 0.4; e.vs = 0.3;
    }
    this.sharks.length = 0;
  }
  // start at a carcass POI: n sharks on the loop (spread around it, the first ones out of sight behind the carcass)
  start(p, n, rng) {
    this.release();
    const d = p.data;
    if (!d || !d.spots || !d.spots.length) return 0;
    this.p = p; this.rng = rng; this.next = this.clock + 4 + rng() * 4;
    const A = d.L / 2 + 3.6, B = 3.5;
    for (let k = 0; k < n; k++) {
      const th = Math.PI * (0.25 + 0.55 * k / Math.max(1, n - 1)) + rng() * 0.3; // far side first (v > 0)
      const S = { e: null, th, A, B, h: 0.9 + rng() * 0.7, mode: 0, t: 0, spot: -1, spd: 0.38 + rng() * 0.12, len: 0, hx: 0, hy: 0, hs: 0, dx: 0, dy: 0, ds: 0, px: 0, py: 0, ps: 0, dur: 0 };
      this._loop(S, this._t);
      const e = this.dir.spawnAt('wfSleeper', p, { route: 'circle', kind: 'solo', zone: 'mid', n: 1, interest: 0.85,
        orbit: { x: this._t[0], s: this._t[2], y: this._t[1], r: 0.01, w: 0, a0: 0, T: 1e9 }, ringMin: 0.01, spacing: 0.12 });
      if (!e) continue;
      if (!e.SPIN) e.SPIN = new Float32Array(e.n); // (the field exists on every encounter: the hidden class stays)
      S.e = e; S.len = e.SZ ? e.SZ[0] : 3;
      this.sharks.push(S);
    }
    return this.sharks.length;
  }
  // a point of the patrol loop: an ellipse around the carcass (u along it, v across), a little above the mud
  _loop(S, o) {
    const d = this.p.data, u = S.A * Math.cos(S.th), v = S.B * Math.sin(S.th);
    o[0] = d.cx + u * d.ca + v * d.sa * d.side; o[2] = d.cs + u * d.sa - v * d.ca * d.side;
    o[1] = d.cy + S.h + 0.35 * Math.sin(S.th * 2 + S.spd * 9);
    return o;
  }
  tick(dt, c) {
    this.clock += dt;
    if (!this.p || !this.sharks.length) return;
    const d = this.p.data;
    // the camera has gone on: let them go
    if (c.s > d.cs + d.L / 2 + 40 || c.s < d.cs - 200) { this.release(); this.p = null; return; }
    let busy = false;
    for (const S of this.sharks) if (S.mode > 0 && !S.e.done) busy = true;
    for (const S of this.sharks) {
      const e = S.e;
      if (e.done || e.route !== 'circle') continue;
      const O = e.plan.orbit, T = this._t;
      S.t += dt;
      if (S.mode === 0) { // patrol
        const ds = S.spd / Math.max(0.5, Math.hypot(S.A * Math.sin(S.th), S.B * Math.cos(S.th)));
        S.th = (S.th + ds * dt) % TAU;
        this._loop(S, T);
        if (!busy && this.clock > this.next && S.t > 6) { // its turn: pick a feeding spot near its side of the loop
          // (spots on the route side first: the shark then shows dark against the pale flank)
          const sp = d.spots, nS = sp.length / 6, tx = -d.side * d.sa, ts = d.side * d.ca;
          let best = -1, bd = 1e9;
          for (let q = 0; q < nS; q++) {
            // (low on the flank, facing sideways: a shark lying alongside the carcass, not perched on top of it)
            const face = sp[q * 6 + 3] * tx + sp[q * 6 + 5] * ts, high = sp[q * 6 + 1] - d.cy > 2.3 || sp[q * 6 + 4] > 0.9;
            const dd = Math.hypot(sp[q * 6] - T[0], sp[q * 6 + 2] - T[2]) * (0.6 + 0.8 * this.rng()) - 6 * face + (high ? 20 : 0) + (face < -0.15 ? 12 : 0);
            if (dd < bd) { bd = dd; best = q; }
          }
          if (best >= 0) {
            const q = best * 6, nx = sp[q + 3], ns = sp[q + 5], nl = Math.hypot(nx, ns) || 1;
            // into the flesh: against the spot normal (horizontal part), a little downward
            S.dx = -nx / nl * 0.99; S.ds = -ns / nl * 0.99; S.dy = -0.15;
            S.hx = sp[q] + nx * 0.12; S.hy = sp[q + 1] + 0.05; S.hs = sp[q + 2] + ns * 0.12;
            S.px = T[0]; S.py = T[1]; S.ps = T[2];
            S.mode = 1; S.t = 0; busy = true;
          }
        }
      }
      if (S.mode === 1 || S.mode === 2 || S.mode === 3) {
        const half = S.len * 0.46;
        const bx = S.hx - S.dx * half, by = S.hy - S.dy * half, bs = S.hs - S.ds * half; // body centre at the bite
        const qx = bx - S.dx * 2.5, qy = by - S.dy * 2.5, qs = bs - S.ds * 2.5;         // lined up, 2.5 m out
        if (S.mode === 1) { // approach: swing round to the line-up point, then straight in
          const D1 = Math.hypot(qx - S.px, qy - S.py, qs - S.ps), t1 = Math.max(3, D1 / 0.45);
          if (S.t < t1) { const k = sm(S.t / t1); T[0] = S.px + (qx - S.px) * k; T[1] = S.py + (qy - S.py) * k; T[2] = S.ps + (qs - S.ps) * k; }
          else { const k = sm((S.t - t1) / 4); T[0] = qx + (bx - qx) * k; T[1] = qy + (by - qy) * k; T[2] = qs + (bs - qs) * k; if (k >= 1) { S.mode = 2; S.t = 0; S.dur = 7 + this.rng() * 5; } }
        } else if (S.mode === 2) { // clamped on: twisting the whole body back and forth
          const w = Math.sin(S.t * TAU * 0.55), env = sm(S.t / 1.2) * sm((S.dur - S.t) / 1.2);
          const lx = -S.ds, ls = S.dx; // horizontal, across the body
          T[0] = bx + lx * 0.16 * w * env; T[1] = by + 0.05 * Math.abs(w) * env; T[2] = bs + ls * 0.16 * w * env;
          for (let i = 0; i < e.n; i++) e.SPIN[i] = 0.6 * w * env;
          if (S.t > S.dur) { S.mode = 3; S.t = 0; e.SPIN.fill(0); }
        } else { // a piece torn off: back out a little and turn away along the body, then rejoin the loop
          const k = sm(S.t / 2.2), al = S.dx * d.sa * d.side - S.ds * d.ca * d.side >= 0 ? 1 : -1;
          T[0] = bx - S.dx * 1.2 * k + d.ca * al * 2.2 * k; T[1] = by + 0.3 * k; T[2] = bs - S.ds * 1.2 * k + d.sa * al * 2.2 * k;
          if (S.t > 2.2) { // nearest loop angle
            const du = (T[0] - d.cx) * d.ca + (T[2] - d.cs) * d.sa, dv = ((T[0] - d.cx) * d.sa - (T[2] - d.cs) * d.ca) * d.side;
            S.th = Math.atan2(dv / S.B, du / S.A); S.mode = 0; S.t = 0; this.next = this.clock + 3 + this.rng() * 6;
          }
        }
      }
      // place the leader: the orbit centre is the target (its radius is ~0; the encounter may widen it near rocks)
      // (never up toward the camera's line, ~4.5 m above the mud beside the carcass)
      const r = e.orbR || O.r;
      O.x = T[0] - r; O.y = Math.min(T[1], d.cy + 2.5); O.s = T[2]; e.orbA = 0;
    }
  }
}
