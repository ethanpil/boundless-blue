// Lofted ship hulls for the wrecks: stations with superellipse sections morphing from a box-like midship to
// V-shaped ends, raked / clipper / spoon stems, transom / counter / cruiser sterns, keel rise at the forefoot
// and the stern cutaway, sheer with raised forecastle / poop / castles, flare and tumblehome.
// buildHull() turns a HullForm into thick plated (riveted strakes and butts) or planked skins with holes,
// torn edges and broken ends, frames that show through the holes, the keel, a deck with planks or plates,
// hatches, collapsed areas and the beams left spanning them, bulwarks or open rails, transom, bulkheads.
// Ship frame: x to starboard, y up (baseline y = 0), bow toward -z, z = 0 amidships.
import { sat, sstep, lerp, fbm3, vn3, rotX, rotZ, mul3 } from './core.js';
import { shellG, cyl, pipe, beam, disc, ring, h01, slicer, cutBelow, coverCapsules, xpt } from './wreck_geo.js';

export class HullForm {
  constructor(o) {
    Object.assign(this, {
      L: 40, B: 8, D: 5, pmb: [0.3, 0.6], entA: 1.9, entB: 0.9, runA: 2, runB: 0.8, tw: 0, nMid: 6, nBow: 1.4, nStern: 2.2,
      riseF: 1.2, fLen: 0.12, riseA: 1.4, aLen: 0.08, aExp: 1.6, rake: 2, rakeP: 1, over: 1, overP: 1.6, sheerF: 1, sheerA: 0.6,
      raised: [], flare: 0.25, tumble: 0, deadrise: 0, wl: 0.55, bulwark: 0, keelW: 0,
    }, o);
    this.zS0 = this.L / 2; this.zB0 = -this.L / 2;
  }
  // plan half-breadth at station u (0 stern .. 1 bow)
  w(u) {
    const B2 = this.B / 2, [pa, pb] = this.pmb;
    if (u >= pb) { const x = sat((u - pb) / (1 - pb)); return B2 * Math.pow(Math.max(0, 1 - Math.pow(x, this.entA)), this.entB); }
    if (u <= pa) { const x = sat((pa - u) / pa); return B2 * (this.tw + (1 - this.tw) * Math.pow(Math.max(0, 1 - Math.pow(x, this.runA)), this.runB)); }
    return B2;
  }
  keelY(u) {
    return this.riseF * Math.pow(sat((u - (1 - this.fLen)) / this.fLen), 2.2) + this.riseA * Math.pow(sat((this.aLen - u) / this.aLen), this.aExp);
  }
  raisedY(u) {
    let h = 0;
    for (const [a, b, dh, e = 0.006] of this.raised) h += dh * (a <= 0 ? 1 : sstep(a - e, a + e, u)) * (b >= 1 ? 1 : 1 - sstep(b - e, b + e, u));
    return h;
  }
  sheerY(u) {
    return this.D + this.sheerA * Math.pow(sat((0.5 - u) / 0.5), 2) + this.sheerF * Math.pow(sat((u - 0.5) / 0.5), 2) + this.raisedY(u);
  }
  nExp(u) {
    const [pa, pb] = this.pmb;
    if (u >= pb) return lerp(this.nMid, this.nBow, Math.pow(sat((u - pb) / (1 - pb)), 0.8));
    if (u <= pa) return lerp(this.nMid, this.nStern, Math.pow(sat((pa - u) / pa), 0.9));
    return this.nMid;
  }
  // z of a hull point at station u and height y: linear along the length, end profiles near the ends
  zAt(u, y) {
    const zm = this.L / 2 - u * this.L;
    const yb = this.keelY(1), ys = this.sheerY(1) - this.raisedY(1);
    const hb = sat((y - yb) / Math.max(0.5, ys - yb));
    const bow = -this.rake * Math.pow(hb, this.rakeP) * Math.pow(sat((u - 0.7) / 0.3), 1.6);
    const ya = this.keelY(0), ysa = this.sheerY(0) - this.raisedY(0), wl = this.wl * this.D;
    const ha = sat((y - Math.max(ya, wl * 0.6)) / Math.max(0.5, ysa - Math.max(ya, wl * 0.6)));
    const st = this.over * Math.pow(ha, this.overP) * Math.pow(sat((0.25 - u) / 0.25), 1.6);
    return zm + bow + st;
  }
  // section table at station u: K+1 samples (x, y) along the starboard girth from the keel to the sheer,
  // with cumulative arc length (for even girth parametrisation)
  section(u, K = 28) {
    const w = this.w(u), yb = this.keelY(u), ys = this.sheerY(u), n = this.nExp(u);
    const fl = this.flare * Math.pow(sat((u - 0.55) / 0.45), 1.4), tb = this.tumble;
    const X = new Float32Array(K + 1), Y = new Float32Array(K + 1), S = new Float32Array(K + 1);
    const e = 2 / n, kw = this.keelW;
    for (let k = 0; k <= K; k++) {
      const f = (k / K) * Math.PI * 0.5, cx = Math.pow(Math.sin(f), e), cy = 1 - Math.pow(Math.cos(f), e);
      let x = kw + (w - kw) * cx;
      x *= 1 + fl * Math.pow(sat((cy - 0.35) / 0.65), 1.5) - tb * Math.pow(sat((cy - 0.5) / 0.5), 2);
      X[k] = w <= 1e-4 ? 0 : x;
      Y[k] = yb + (ys - yb) * cy + this.deadrise * cx * (1 - cy) * (w / (this.B / 2));
      if (k) S[k] = S[k - 1] + Math.hypot(X[k] - X[k - 1], Y[k] - Y[k - 1]);
    }
    return { X, Y, S, ys, yb };
  }
  // starboard point at girth t (0 keel .. 1 sheer; > 1 continues the side above the sheer by (t-1)*D)
  ptOn(sec, u, t, out) {
    const { X, Y, S } = sec, K = X.length - 1;
    let x, y;
    if (t <= 1) {
      const s = t * S[K];
      let k = 0;
      while (k < K - 1 && S[k + 1] < s) k++;
      const f = S[k + 1] > S[k] ? (s - S[k]) / (S[k + 1] - S[k]) : 0;
      x = X[k] + (X[k + 1] - X[k]) * f; y = Y[k] + (Y[k + 1] - Y[k]) * f;
    } else {
      const dy = Y[K] - Y[K - 1], slope = dy > 1e-4 ? Math.max(-0.3, Math.min(0.5, (X[K] - X[K - 1]) / dy)) : 0;
      y = Y[K] + (t - 1) * this.D; x = X[K] + slope * (y - Y[K]);
    }
    out[0] = x; out[1] = y; out[2] = this.zAt(u, y);
    return out;
  }
}

// ---------- liveries: vertex colour + fx per surface point ----------
// kind: 'steel' (mode 4 rust streaks), 'wood', 'grp' (fibreglass), 'alu'
export function livery(kind, rng, o = {}) {
  const L = { kind, mode: kind === 'steel' ? 4 : 0, growth: o.growth ?? (kind === 'alu' ? 0.25 + rng() * 0.25 : 0.55 + rng() * 0.45), rust: o.rust ?? 0.3 + rng() * 0.6, seed: (rng() * 1e6) | 0, foul: o.foul ?? (kind === 'alu' ? 0.2 + rng() * 0.25 : 0.35 + rng() * 0.5) };
  const hullPaints = [[0.07, 0.07, 0.07], [0.1, 0.09, 0.08], [0.24, 0.25, 0.26], [0.16, 0.18, 0.2], [0.45, 0.45, 0.42], [0.08, 0.13, 0.17], [0.22, 0.08, 0.05]];
  if (kind === 'steel') {
    L.top = o.top || hullPaints[(rng() * hullPaints.length) | 0];
    L.bottom = o.bottom || (rng() < 0.75 ? [0.3, 0.06, 0.04] : [0.08, 0.08, 0.07]);
    L.boot = rng() < 0.5;
    L.rustC = [0.33, 0.13, 0.055]; L.rustC2 = [0.2, 0.085, 0.045];
  } else if (kind === 'wood') {
    const t = rng();
    L.base = o.base || (t < 0.4 ? [0.26, 0.21, 0.15] : t < 0.75 ? [0.3, 0.24, 0.17] : [0.23, 0.21, 0.17]);
    L.tar = [0.06, 0.05, 0.04];
    L.paint = o.paint || (rng() < 0.4 ? [[0.32, 0.22, 0.06], [0.08, 0.14, 0.2], [0.25, 0.06, 0.04], [0.5, 0.48, 0.42]][(rng() * 4) | 0] : null);
    L.mode = 0;
  } else if (kind === 'grp') {
    L.top = o.top || (rng() < 0.6 ? [0.55, 0.55, 0.52] : [[0.08, 0.14, 0.25], [0.35, 0.05, 0.04], [0.06, 0.06, 0.06], [0.5, 0.45, 0.32]][(rng() * 4) | 0]);
    L.bottom = o.bottom || [[0.25, 0.05, 0.04], [0.05, 0.07, 0.14], [0.07, 0.07, 0.07]][(rng() * 3) | 0];
  } else {
    L.top = o.top || [[0.3, 0.32, 0.31], [0.16, 0.19, 0.12], [0.1, 0.13, 0.2], [0.4, 0.4, 0.38]][(rng() * 4) | 0];
  }
  return L;
}
// fouling palette: algal turf, settled silt, coralline crust, sponge ochre, rusty bloom
const FOUL = [[0.21, 0.23, 0.14], [0.33, 0.31, 0.26], [0.36, 0.21, 0.23], [0.4, 0.3, 0.13], [0.27, 0.17, 0.11]];
const FOUL_ALU = [[0.3, 0.29, 0.25], [0.25, 0.23, 0.17], [0.21, 0.22, 0.16], [0.33, 0.31, 0.27]]; // aircraft: silt and algal film
function foul(Lv, x, y, z, o) {
  const sd = Lv.seed, n = 0.5 + 0.5 * fbm3(x * 0.42 + 3.1, y * 0.42, z * 0.42, 2, sd + 11);
  const k = sat((n - (1 - Lv.foul)) * 3.2) * 0.85;
  if (k <= 0) return;
  const t = 0.5 + 0.5 * vn3(x * 0.2, y * 0.25, z * 0.2, sd + 12);
  const P = Lv.kind === 'alu' ? FOUL_ALU : FOUL, i = Math.min(P.length - 1, Math.floor(t * P.length)), c = P[i], v = 0.85 + 0.25 * ((t * 7.31) % 1);
  o[0] += (c[0] * v - o[0]) * k; o[1] += (c[1] * v - o[1]) * k; o[2] += (c[2] * v - o[2]) * k;
  o[3] = Math.min(1.2, o[3] + k * 0.4);
}
// colour at a ship-frame point; plate = per-panel random [0,1), wl = waterline height, extra = more rust
export function paintAt(Lv, x, y, z, plate, wl, o, extra = 0) {
  const sd = Lv.seed;
  if (Lv.kind === 'steel') {
    const below = y < wl - 0.25, boot = Lv.boot && Math.abs(y - wl) < 0.25;
    let c = below ? Lv.bottom : boot ? [0.05, 0.05, 0.05] : Lv.top;
    if (Lv.dazzle && !below) c = Lv.dazzle[Math.floor(h01(Math.floor(z / 7.3 + plate * 3), Math.floor(y / 2.1 + x * 0.05), 5, sd) * Lv.dazzle.length)];
    const n = 0.5 + 0.5 * fbm3(x * 0.35, y * 0.5, z * 0.18, 2, sd);
    const streak = Math.pow(0.5 + 0.5 * vn3(z * 1.7 + x * 0.3, 0.5, sd * 0.01, sd + 3), 3);
    const r = sat(Lv.rust * (0.55 + 0.6 * n) + extra + streak * 0.35 + (plate - 0.5) * 0.35);
    const rc = n > 0.55 ? Lv.rustC : Lv.rustC2;
    const v = 0.85 + 0.3 * plate;
    o[0] = (c[0] + (rc[0] - c[0]) * r) * v; o[1] = (c[1] + (rc[1] - c[1]) * r) * v; o[2] = (c[2] + (rc[2] - c[2]) * r) * v;
    o[3] = Lv.growth * (0.6 + 0.5 * n); o[4] = 4;
  } else if (Lv.kind === 'wood') {
    const n = 0.5 + 0.5 * fbm3(x * 0.5, y * 0.6, z * 0.12, 2, sd);
    const v = 0.72 + 0.5 * plate + 0.15 * (n - 0.5);
    let c = Lv.base;
    if (Lv.paint && y > wl + 0.4 && n > 0.35) c = [lerp(c[0], Lv.paint[0], 0.45), lerp(c[1], Lv.paint[1], 0.45), lerp(c[2], Lv.paint[2], 0.45)];
    o[0] = c[0] * v; o[1] = c[1] * v; o[2] = c[2] * v; o[3] = Lv.growth * (0.7 + 0.5 * n); o[4] = 0;
  } else if (Lv.kind === 'grp') {
    const n = 0.5 + 0.5 * fbm3(x * 0.6, y * 0.6, z * 0.3, 2, sd), c = y < wl ? Lv.bottom : Lv.top, v = 0.85 + 0.25 * n + 0.1 * plate;
    const dirt = 0.15 + 0.3 * n; // fouling film
    o[0] = lerp(c[0], 0.2, dirt) * v; o[1] = lerp(c[1], 0.22, dirt) * v; o[2] = lerp(c[2], 0.16, dirt) * v; o[3] = Lv.growth * (0.5 + 0.6 * n); o[4] = 0;
  } else {
    const n = 0.5 + 0.5 * fbm3(x * 0.8, y * 0.8, z * 0.8, 2, sd), c = n > 0.62 ? [0.42, 0.43, 0.42] : Lv.top, v = 0.85 + 0.3 * plate;
    o[0] = c[0] * v; o[1] = c[1] * v; o[2] = c[2] * v; o[3] = Lv.growth * (0.5 + 0.6 * n); o[4] = 0;
  }
  if (Lv.foul > 0) foul(Lv, x, y, z, o);
  return o;
}
// per-plate / per-plank variation applied on top of a base colour painted with plate = 0.5
export function plateMod(Lv, p, o) {
  if (Lv.kind === 'steel') {
    const v = 0.85 + 0.3 * p, k = (p - 0.5) * 0.3, rc = Lv.rustC;
    o[0] = (o[0] + (rc[0] - o[0]) * k) * v; o[1] = (o[1] + (rc[1] - o[1]) * k) * v; o[2] = (o[2] + (rc[2] - o[2]) * k) * v;
  } else { const v = Lv.kind === 'wood' ? (0.72 + 0.5 * p) / 0.97 : 0.9 + 0.2 * p; o[0] *= v; o[1] *= v; o[2] *= v; }
  return o;
}
export function paintC(Lv, kind = 'top', v = 1) { // a flat colour for small parts
  const o = [0, 0, 0, 0, 0];
  paintAt(Lv, 0.3, kind === 'bottom' ? -10 : 10, 0.7, 0.5, 0, o);
  return [[o[0] * v, o[1] * v, o[2] * v], [o[3], o[4]]];
}

// ---------- the hull ----------
// opt: { cutLo, cutHi (0..1 broken-off ends), cell (m along the length), strakes, rowsPer, buttEvery (cells),
//        th, lap, holeThr, decay (0..1 upper works lost), impacts, frames (m, 0 = none), deck (see addDeck),
//        tier, hero, seed, wood (planking), noInnerBottom }
export function buildHull(b, H, Lv, rng, opt) { const g = buildHullG(b, H, Lv, rng, opt); let r; do r = g.next(); while (!r.done); return r.value; }
export function* buildHullG(b, H, Lv, rng, opt) {
  const cutLo = opt.cutLo ?? 0, cutHi = opt.cutHi ?? 1, wood = Lv.kind === 'wood', sd = (opt.seed ?? 1) | 0;
  const cell = opt.cell ?? (wood ? 1.3 : 1.7), bw = H.bulwark > 0;
  // lattice columns: denser toward the ends; extra columns hug the raised-deck steps
  const cols = [cutLo];
  for (let u = cutLo; u < cutHi - 1e-6;) {
    const endK = 0.55 + 0.45 * sat(Math.min(u, 1 - u) / 0.2);
    u = Math.min(cutHi, u + (cell * endK) / H.L);
    cols.push(u);
  }
  for (const [a, e2, , e = 0.006] of H.raised) for (const v of [a - e, a + e, e2 - e, e2 + e]) if (v > cutLo + 0.004 && v < cutHi - 0.004) cols.push(v);
  cols.sort((p, q) => p - q);
  const U = cols.filter((u, k) => k === 0 || u - cols[k - 1] > 0.0025);
  const nu = U.length - 1;
  const nStr = opt.strakes ?? (wood ? 11 : 7), rowsPer = opt.rowsPer ?? (wood ? 1 : 2);
  const Tr = [];
  for (let k = 0; k <= nStr; k++) for (let r = 0; r < (k < nStr ? rowsPer : 1); r++) Tr.push((k + r / rowsPer) / nStr);
  if (bw) Tr.push(1 + H.bulwark / H.D);
  const nt = Tr.length - 1, W = nu + 1, jDeck = nStr * rowsPer;
  const strakes = [];
  for (let k = 0; k <= nStr; k++) strakes.push(k * rowsPer);
  if (bw) strakes.push(nt);
  // node positions (starboard), shared by both sides (mirrored)
  const PS = new Float32Array(W * (nt + 1) * 3), tmp = [0, 0, 0], secs = [], due = slicer();
  for (let i = 0; i <= nu; i++) {
    const sec = H.section(U[i]);
    secs.push(sec);
    for (let j = 0; j <= nt; j++) { H.ptOn(sec, U[i], Tr[j], tmp); const k = (j * W + i) * 3; PS[k] = tmp[0]; PS[k + 1] = tmp[1]; PS[k + 2] = tmp[2]; }
    if (due()) { yield; due.reset(); }
  }
  yield;
  // ---- damage: holes per side
  const thr = opt.holeThr ?? 0.78, decay = opt.decay ?? 0, girth = secs[Math.floor(nu / 2)].S.at(-1);
  const impacts = opt.impacts || [];
  const holeAt = (u, t, side, yc) => {
    if (t > 1) { // bulwark: rusted through / broken more easily
      const hb = 0.5 + 0.5 * vn3(u * H.L / 3, side * 5.3, 2, sd + 9);
      return hb > thr - 0.25 - decay * 0.3;
    }
    let h = 0.5 + 0.5 * fbm3(u * H.L / 7, t * girth / 3.5, side * 3.7, 2, sd);
    h += decay * Math.pow(t, 1.3) * 0.85 - (1 - t) * 0.12;
    for (const im of impacts) {
      if (im.side !== 0 && im.side !== side) continue;
      const du = (u - im.u) * H.L, dt = (t - im.t) * girth, d = Math.hypot(du, dt * 1.3);
      h += im.k * sstep(im.r, im.r * 0.3, d);
    }
    if (cutLo > 0) h += 0.55 * sstep(2.5, 0, (u - cutLo) * H.L + 1.5 * vn3(t * 4, side, 0, sd));
    if (cutHi < 1) h += 0.55 * sstep(2.5, 0, (cutHi - u) * H.L + 1.5 * vn3(t * 4, side, 1, sd));
    if (t < 0.12 && !opt.skeleton) h -= 0.3;
    if (opt.skeleton) h -= 0.75 * sat((H.D * 0.55 - yc) / (H.D * 0.22)) - 0.25;
    return h > thr;
  };
  const holes = {};
  for (const side of [-1, 1]) {
    const hl = new Uint8Array(nu * nt);
    for (let j = 0; j < nt; j++) {
      for (let i = 0; i < nu; i++) hl[j * nu + i] = holeAt((U[i] + U[i + 1]) / 2, (Tr[j] + Tr[j + 1]) / 2, side, (PS[(j * W + i) * 3 + 1] + PS[((j + 1) * W + i + 1) * 3 + 1]) / 2) ? 1 : 0;
      if (due()) { yield; due.reset(); }
    }
    holes[side] = hl;
  }
  yield;
  // ---- skins
  const wl = H.wl * H.D, th = opt.th ?? (wood ? 0.16 : 0.1), plateRnd = (i, k, m, side) => h01(k, m, side + 3, sd);
  const buttEvery = opt.buttEvery ?? (wood ? 4 : 3);
  const butts = (k) => {
    const off = wood ? (k * 7) % buttEvery : (k % 2) * Math.floor(buttEvery / 2), out = [0];
    for (let i = off || buttEvery; i < nu; i += buttEvery) out.push(i);
    out.push(nu);
    return out;
  };
  const inner = {};
  const o5 = [0, 0, 0, 0, 0];
  for (const side of [-1, 1]) {
    const P = new Float32Array(PS.length);
    for (let k = 0; k < PS.length; k += 3) { P[k] = PS[k] * side; P[k + 1] = PS[k + 1]; P[k + 2] = PS[k + 2]; }
    const plates = new Map(), base = new Float32Array(W * (nt + 1) * 5).fill(NaN);
    const r = yield* shellG(b, {
      nu, nt, P, hole: holes[side], th, strakes, butts, seed: sd + side * 17, due,
      // outward reference: sideways, down on the bottom (a flat bottom's normal is perpendicular to plain
      // "sideways"), up at the sheer, aft at the counter and forward at the forefoot
      out: (i, j) => {
        if (j === 0) return [side, -0.6, 0];
        const q = (j * W + i) * 3, yk = PS[i * 3 + 1], ys = PS[(jDeck * W + i) * 3 + 1];
        return [side, 0.9 * (2 * (PS[q + 1] - yk) / Math.max(0.5, ys - yk) - 1), 0.8 * Math.max(-1, Math.min(1, PS[q + 2] / (H.L / 2)))];
      },
      lap: (k) => (wood ? 0 : (k % 2 ? opt.lap ?? 0.025 : 0)),
      tear: wood ? 0.12 : 0.28,
      color: (i, j, k, m, o) => {
        const key = k * 997 + m;
        let pr = plates.get(key);
        if (pr === undefined) plates.set(key, (pr = plateRnd(i, k, m, side)));
        const q = j * W + i, c = q * 5;
        if (base[c] !== base[c]) {
          paintAt(Lv, P[q * 3], P[q * 3 + 1], P[q * 3 + 2], 0.5, wl, o, j >= jDeck - 1 ? 0.12 : 0);
          if (j === 0) { o[0] *= 0.8; o[1] *= 0.8; o[2] *= 0.8; }
          for (let e = 0; e < 5; e++) base[c + e] = o[e];
        } else for (let e = 0; e < 5; e++) o[e] = base[c + e];
        plateMod(Lv, pr, o);
      },
      inner: (i, j, o) => { const h = h01(i, j, side, sd), v = 0.6 + 0.5 * h; if (wood) { o[0] = 0.13 * v; o[1] = 0.1 * v; o[2] = 0.07 * v; } else { o[0] = 0.15 * v; o[1] = 0.07 * v; o[2] = 0.045 * v; } o[3] = Lv.growth * 0.5; o[4] = Lv.mode; },
      edge: (i, j, o) => { if (wood) { o[0] = 0.3; o[1] = 0.24; o[2] = 0.16; o[3] = 0.3; o[4] = 0; } else { o[0] = 0.28; o[1] = 0.12; o[2] = 0.06; o[3] = 0.4; o[4] = 4; } },
      open: { i0: cutLo > 0, i1: cutHi < 1, j1: true },
    });
    inner[side] = { P, r };
    yield;
  }
  // stem / keel bar (closes the keel seam and the stem edge)
  const kc = wood ? [0.13, 0.1, 0.07] : [0.17, 0.08, 0.05], kf = [Lv.growth * 0.8, wood ? 0 : 4];
  const keelPts = [];
  for (let i = 0; i <= nu; i++) { const q = i * 3; keelPts.push([0, PS[q + 1] - 0.04, PS[q + 2]]); }
  if (cutHi >= 1) { // continue up the stem
    for (let j = 1; j <= jDeck; j++) { const q = (j * W + nu) * 3; keelPts.push([0, PS[q + 1], PS[q + 2] - 0.03]); }
  }
  pipe(b, keelPts, wood ? 0.2 : 0.13, 4, kc, kf, 1);
  // transom: close the stern if the hull ends square
  if (cutLo <= 0 && H.tw > 0.01) {
    const v0 = b.vc, t0 = b.I.length, tc = paintC(Lv, 'top', 0.85);
    const top = bw ? nt : jDeck;
    for (let j = 0; j <= top; j++) {
      const q = (j * W) * 3;
      b.v(-PS[q], PS[q + 1], PS[q + 2] + 0.02, 0, 0, 1, tc[0][0], tc[0][1], tc[0][2], tc[1][0], tc[1][1]);
      b.v(PS[q], PS[q + 1], PS[q + 2] + 0.02, 0, 0, 1, tc[0][0], tc[0][1], tc[0][2], tc[1][0], tc[1][1]);
    }
    const holeT = (j) => vn3(j * 0.7, 3, 1, sd + 5) > 0.5 + (1 - decay) * 0.25;
    for (let j = 0; j < top; j++) {
      if (holeT(j)) continue;
      const a = v0 + j * 2, c = a + 1, d = a + 2, e = a + 3;
      b.t(a, c, d); b.t(d, c, e);
    }
    b.smooth(v0, t0);
    // inner face (dark)
    const v1 = b.vc, t1 = b.I.length;
    for (let k = v0; k < v1; k++) b.v(b.P[k * 3], b.P[k * 3 + 1], b.P[k * 3 + 2] - th, 0, 0, -1, 0.06, 0.05, 0.04, 0.2, kf[1]);
    for (let k = t0; k < t1; k += 3) b.t(b.I[k] - v0 + v1, b.I[k + 2] - v0 + v1, b.I[k + 1] - v0 + v1);
  }
  const NS = inner[1].r.N; // starboard node normals (port mirrors x)
  // untorn inner-surface point (side, lattice node), pushed `extra` m further in
  const innerPt = (side, i, j, extra = 0) => {
    const q = (j * W + i) * 3, k = th + extra;
    return [side * (PS[q] - NS[q] * k), PS[q + 1] - NS[q + 1] * k, PS[q + 2] - NS[q + 2] * k];
  };
  const info = { H, U, Tr, nu, nt, W, PS, NS, secs, jDeck, holes, inner, th, cutLo, cutHi, wl, wood, Lv, sd, innerPt };
  // frames (ribs) where they can be seen: next to a hole, or under an open deck
  info.frameAt = [];
  if (opt.frames !== 0) {
    const fsp = opt.frames ?? (wood ? 1.0 : 2.0);
    let last = -1e9;
    const rc = wood ? [0.17, 0.13, 0.09] : [0.2, 0.09, 0.05], rf = [Lv.growth * 0.9, wood ? 0 : 4], fr = wood ? 0.12 : 0.07;
    for (let i = 1; i < nu; i++) {
      const z = PS[(jDeck * W + i) * 3 + 2];
      if (Math.abs(z - last) < fsp * 0.85) continue;
      last = z;
      let seen = !!opt.deckOpen;
      for (const [ua, ub] of opt.openU || []) if (U[i] > ua - 0.01 && U[i] < ub + 0.01) seen = true;
      for (const side of [-1, 1]) for (let j = 0; j < nt && !seen; j++) if (holes[side][j * nu + i] || holes[side][j * nu + i - 1]) seen = true;
      if (!seen && rng() > 0.15) continue;
      info.frameAt.push(i);
      const pts = [];
      // skeleton wrecks: each side of the frame snapped off at its own height (stumps out of the sand)
      const snap = (f) => { let j = jDeck; while (j > 1 && PS[(j * W + i) * 3 + 1] > H.D * f) j--; return j; };
      const ta = opt.skeleton ? snap(0.4 + 0.35 * rng()) : jDeck, tb = opt.skeleton ? snap(0.4 + 0.35 * rng()) : jDeck;
      for (let j = ta; j >= 0; j--) pts.push(innerPt(-1, i, j, fr));
      for (let j = 1; j <= tb; j++) pts.push(innerPt(1, i, j, fr));
      if (opt.skeleton && rng() < 0.15) continue;
      pipe(b, pts, fr * (opt.skeleton ? 1.6 : 1), wood ? 4 : 3, rc, rf);
      if (due()) { yield; due.reset(); }
    }
  }
  return info;
}

// station column i -> ship-frame point on the inner skin at the deck edge (starboard)
export function deckEdge(info, i) {
  return info.innerPt(1, i, info.jDeck, 0.02);
}
// interpolated hull data at any u (between lattice columns)
export function hullAt(info, u) {
  const U = info.U;
  let i = 0;
  while (i < info.nu - 1 && U[i + 1] < u) i++;
  const f = sat((u - U[i]) / Math.max(1e-6, U[i + 1] - U[i])), a = deckEdge(info, i), c = deckEdge(info, i + 1);
  return { x: lerp(a[0], c[0], f), y: lerp(a[1], c[1], f), z: lerp(a[2], c[2], f), i };
}

// ---------- deck ----------
// d: { planks (wood strips across), hatches: [[ua, ub, halfWidthFrac]], collapse: [[uc, halfLen(m), depth]], thr, beams }
export function addDeck(b, info, rng, d = {}) { const g = addDeckG(b, info, rng, d); let r; do r = g.next(); while (!r.done); return r.value; }
export function* addDeckG(b, info, rng, d = {}) {
  const { nu, U, wood, Lv, sd } = info, H = info.H, NX = d.nx ?? (wood ? 9 : 6);
  const i0 = d.i0 ?? 0, i1 = d.i1 ?? nu, n2 = i1 - i0;
  if (n2 < 1) return null;
  const W2 = n2 + 1, P = new Float32Array(W2 * (NX + 1) * 3);
  for (let i = i0; i <= i1; i++) {
    const e = deckEdge(info, i), drop = d.drop ?? 0.04;
    for (let j = 0; j <= NX; j++) {
      const xn = (j / NX) * 2 - 1, q = ((j * W2) + (i - i0)) * 3;
      P[q] = e[0] * xn; P[q + 1] = e[1] - drop + (d.camber ?? 0.12) * (1 - xn * xn); P[q + 2] = e[2];
    }
  }
  const hole = new Uint8Array(n2 * NX), thr = d.thr ?? 0.8, hatches = d.hatches || [], collapse = d.collapse || [];
  for (let j = 0; j < NX; j++) for (let i = 0; i < n2; i++) {
    const u = (U[i + i0] + U[i + i0 + 1]) / 2, xn = ((j + 0.5) / NX) * 2 - 1;
    let h = 0.5 + 0.5 * fbm3(u * H.L / 6, xn * 2.2, 5, 2, sd + 31);
    for (const [uc, hl, k] of collapse) h += k * sstep(hl, hl * 0.4, Math.abs(u - uc) * H.L + 1.2 * vn3(xn * 3, uc * 9, 2, sd));
    let hatch = false;
    for (const [ua, ub, hw] of hatches) if (u > ua && u < ub && Math.abs(xn) < hw) hatch = true;
    hole[j * n2 + i] = hatch || h > thr ? 1 : 0;
  }
  const tone = (j, m) => h01(j, m, 77, sd);
  yield;
  const r = yield* shellG(b, {
    nu: n2, nt: NX, P, hole, th: d.th ?? (wood ? 0.12 : 0.08), seed: sd + 41,
    strakes: wood ? Array.from({ length: NX + 1 }, (_, k) => k) : [0, Math.floor(NX / 3), Math.floor(2 * NX / 3), NX],
    butts: (k) => { const ev = wood ? 5 : 3, out = [0]; for (let i = ((k * 3) % ev) || ev; i < n2; i += ev) out.push(i); out.push(n2); return out; },
    out: () => [0, 1, 0], tear: wood ? 0.08 : 0.18,
    color: (i, j, k, m, o) => {
      const q = (j * W2 + i) * 3, t = tone(k, m);
      if (wood) { const v = 0.75 + 0.45 * t; o[0] = 0.25 * v; o[1] = 0.2 * v; o[2] = 0.14 * v; o[3] = Lv.growth * 1.1; o[4] = 0; }
      else paintAt(Lv, P[q], P[q + 1] + 30, P[q + 2], t, -99, o, 0.25);
      if (d.color) d.color(P[q], P[q + 1], P[q + 2], o);
    },
    inner: (i, j, o) => { o[0] = 0.07; o[1] = 0.055; o[2] = 0.045; o[3] = 0.15; o[4] = wood ? 0 : 4; },
    edge: (i, j, o) => { if (wood) { o[0] = 0.28; o[1] = 0.22; o[2] = 0.15; o[3] = 0.2; o[4] = 0; } else { o[0] = 0.26; o[1] = 0.11; o[2] = 0.06; o[3] = 0.3; o[4] = 4; } },
    open: { i0: info.cutLo > 0 && i0 === 0, i1: info.cutHi < 1 && i1 === nu },
  });
  // beams left spanning the open areas; some broken and sagging
  const bc = wood ? [0.18, 0.14, 0.1] : [0.19, 0.085, 0.05], bf = [Lv.growth, wood ? 0 : 4];
  if (d.beams !== false) for (let i = i0 + 1; i < i1; i += wood ? 1 : 2) {
    let open = 0;
    for (let j = 0; j < NX; j++) if (hole[j * n2 + i - i0] || hole[j * n2 + i - i0 - 1]) open++;
    if (open < 2) continue;
    const e = deckEdge(info, i), yb = e[1] - 0.25, x = Math.abs(e[0]) - 0.05;
    const roll = h01(i, 5, 9, sd);
    if (roll < 0.62) beam(b, [-x, yb, e[2]], [x, yb, e[2]], wood ? 0.22 : 0.16, wood ? 0.24 : 0.3, bc, bf);
    else if (roll < 0.85) { const m = 0.25 + 0.4 * h01(i, 6, 9, sd), sag = 0.6 + 1.5 * h01(i, 7, 9, sd), sx = roll < 0.74 ? -1 : 1; beam(b, [sx * x, yb, e[2]], [sx * x * (1 - 2 * m) * 0.3, yb - sag, e[2] + 0.2], wood ? 0.22 : 0.16, wood ? 0.24 : 0.3, bc, bf); }
  }
  // hatch coamings
  for (const [ua, ub, hw] of hatches) {
    if (ua < U[i0] || ub > U[i1]) continue;
    const A = hullAt(info, ua), Bq = hullAt(info, ub), x = Math.abs((A.x + Bq.x) / 2) * hw, ch = d.coaming ?? 0.75, y = Math.max(A.y, Bq.y) - 0.04 + ch / 2;
    const cc = d.coamingC || paintC(Lv, 'top', 0.9)[0], cf = [Lv.growth, Lv.mode];
    const zc = (A.z + Bq.z) / 2, lz = Math.abs(A.z - Bq.z);
    beam(b, [-x, y, A.z], [x, y, A.z], 0.18, ch, cc, cf); beam(b, [-x, y, Bq.z], [x, y, Bq.z], 0.18, ch, cc, cf);
    beam(b, [-x, y, A.z], [-x, y, Bq.z], 0.18, ch, cc, cf); beam(b, [x, y, A.z], [x, y, Bq.z], 0.18, ch, cc, cf);
    void zc; void lz;
  }
  return { hole, NX, n2, P, r };
}

// ---------- bulkhead (transverse wall) at lattice column i: a fan inside the inner skin ----------
export function bulkhead(b, info, i, rng, holeK = 0.25) {
  const { jDeck, sd } = info, v0 = b.vc, t0 = b.I.length;
  const pts = [];
  for (let j = jDeck; j >= 0; j--) pts.push(info.innerPt(-1, i, j, 0.03));
  for (let j = 1; j <= jDeck; j++) pts.push(info.innerPt(1, i, j, 0.03));
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
  const c = [0.13, 0.065, 0.04], f = [info.Lv.growth * 0.6, info.wood ? 0 : 4];
  for (const face of [1, -1]) {
    const cc = b.v(0, cy, cz, 0, 0, face, c[0], c[1], c[2], f[0], f[1]), s0 = b.vc;
    for (const p of pts) b.v(p[0], p[1], p[2], 0, 0, face, c[0], c[1], c[2], f[0], f[1]);
    for (let k = 0; k < pts.length - 1; k++) {
      if (h01(i, k, face > 0 ? 1 : 1, sd + 61) < holeK) continue;
      if (face > 0) b.t(cc, s0 + k, s0 + k + 1); else b.t(cc, s0 + k + 1, s0 + k);
    }
  }
  void v0; void t0; void rng;
}

// ---------- portholes: a row along the hull side at depth `below` under the sheer, rims with rust streaks ----------
export function portholes(b, info, u0, u1, { below = 1.1, every = 1.6, r = 0.2, col = [0.2, 0.09, 0.05] } = {}) {
  const { H, holes, nu, nt, U, Lv, sd } = info, f = [Lv.growth * 0.5, 4], streak = [0.3, 0.12, 0.05];
  for (let u = Math.max(u0, info.cutLo + 0.01); u < Math.min(u1, info.cutHi - 0.01); u += every / H.L) {
    const sec = H.section(u), yT = H.sheerY(u) - below, p = [0, 0, 0];
    let lo = 0, hi = 1; // girth t at height yT
    for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; H.ptOn(sec, u, m, p); if (p[1] < yT) lo = m; else hi = m; }
    H.ptOn(sec, u, lo, p);
    let i = 0; while (i < nu - 1 && U[i + 1] < u) i++;
    const j = Math.min(nt - 1, Math.round(lo * info.jDeck));
    for (const side of [-1, 1]) {
      if (holes[side][j * nu + i] || h01(i, side, 7, sd) < 0.1) continue;
      const q = [side * (p[0] + 0.03), p[1], p[2]], n = [side, 0, 0];
      ring(b, q, n, r, 0.045, 0.06, 8, col, f);
      disc(b, [q[0] + side * 0.01, q[1], q[2]], n, r * 0.8, 8, [0.03, 0.035, 0.04], [0, 4]);
      if (h01(i, side, 8, sd) < 0.7) b.box(0.02, 0.5 + 0.8 * h01(i, side, 9, sd), r * 0.6, null, q[0] + side * 0.005, q[1] - r - 0.3, q[2], streak, [0.2, 4]);
    }
  }
}

// ---------- bilge keels: fin plates along the turn of the bilge, between u0 and u1 (they stand out once the
// hull lies on its side or capsizes); broken where the plating behind them has rotted away ----------
export function bilgeKeels(b, info, u0, u1, depth = 0.45) {
  const { H, U, nu, holes, jDeck, Lv } = info, c = [0.19, 0.085, 0.05], f = [Lv.growth, 4], h = depth + 0.08;
  const lo = Math.max(u0, info.cutLo + 0.01), hi = Math.min(u1, info.cutHi - 0.01);
  for (const side of [-1, 1]) {
    let run = [];
    const flush = () => {
      for (let k = 0; k + 1 < run.length; k++) {
        const [p, n] = run[k], [q, m] = run[k + 1], up = [n[0] + m[0], n[1] + m[1], 0], l = Math.hypot(up[0], up[1]) || 1, o = (depth - 0.08) / 2;
        beam(b, [p[0] + n[0] * o, p[1] + n[1] * o, p[2]], [q[0] + m[0] * o, q[1] + m[1] * o, q[2]], 0.05, h, c, f, [up[0] / l, up[1] / l, 0]);
      }
      run = [];
    };
    for (let i = 0; i <= nu; i++) {
      const u = U[i];
      if (u < lo || u > hi) { flush(); continue; }
      // the turn of the bilge: first section sample where the girth turns past 45 degrees
      const { X, Y, S } = H.section(u), K = X.length - 1;
      let k = 1;
      while (k < K - 1 && Y[k + 1] - Y[k] < X[k + 1] - X[k]) k++;
      const tx = X[k + 1] - X[k - 1], ty = Y[k + 1] - Y[k - 1], tl = Math.hypot(tx, ty) || 1;
      const j = Math.min(jDeck - 1, Math.floor((S[k] / S[K]) * jDeck)), hl = holes[side];
      if (hl[j * nu + Math.min(nu - 1, i)] || hl[j * nu + Math.max(0, i - 1)]) { flush(); continue; }
      run.push([[side * X[k], Y[k], H.zAt(u, Y[k])], [side * ty / tl, -tx / tl, 0]]);
    }
    flush();
  }
}

// ---------- railing along the sheer (stanchions + 2 rails), with gaps and bent sections ----------
export function railing(b, info, rng, { h = 1.05, every = 1.6, gaps = 0.25, col = null, i0 = 0, i1 = info.nu } = {}) {
  const { W, PS, jDeck, sd } = info, c = col || [0.22, 0.1, 0.06], f = [info.Lv.growth, info.wood ? 0 : 4];
  for (const side of [-1, 1]) {
    let run = [], lastZ = 1e9;
    const flush = () => {
      if (run.length >= 2) for (const yk of [h, h * 0.5]) pipe(b, run.map((p) => [p[0], p[1] + yk, p[2]]), 0.03, 3, c, f);
      run = [];
    };
    for (let i = i0; i <= i1; i++) {
      const q = (jDeck * W + i) * 3, z = PS[q + 2];
      if (Math.abs(z - lastZ) < every * 0.8 && i !== i1) continue;
      lastZ = z;
      const gone = h01(i, side + 5, 3, sd + 71) < gaps;
      if (gone) { flush(); continue; }
      const x = side * (Math.abs(PS[q]) - 0.08), y = PS[q + 1], lean = (h01(i, side, 4, sd) - 0.5) * 0.5;
      cyl(b, [x, y - 0.05, z], [x + side * lean * 0.3, y + h, z], 0.03, 0.03, 3, c, f);
      run.push([x + side * lean * 0.3 * (1), y, z]);
    }
    flush();
  }
}

// The prop shader's encrusting growth (aFx.x, modes 0 and 4) paints 1-4 m blotches of green, pink and ochre on
// up-facing faces: across big hull plates, decks and wings that reads as camouflage paint, not fouling. Wrecks
// keep it to a faint film; their fouling colour lives in the vertex colours (foul()) and the growth props.
export const GROW_K = 0.3, GROW_MAX = 0.24;
export function growthFilm(F) {
  for (let i = 0; i < F.length; i += 2) {
    const m = F[i + 1];
    if ((m < 0.5 || (m > 3.5 && m < 4.5)) && F[i] > 0) F[i] = Math.min(GROW_MAX, F[i] * GROW_K);
  }
}

// ---------- finishing: resting state, burial, sediment fill, obstacle cover ----------
// st: { roll, pitch, bury (m of the lowest part lost in the sediment), fill (m of sand inside above the cut),
//       sand: rgb, cover: { cx, cy, cz } }. Rotates everything (roll about the ship's axis, then pitch), drops the
// buried geometry, lays a sand floor inside the hull and fits the obstacle capsules. Returns { R, yCut }.
export function finishWreck(b, info, st) { const g = finishWreckG(b, info, st); let r; do r = g.next(); while (!r.done); return r.value; }
export function* finishWreckG(b, info, st) {
  const R = mul3(rotX(st.pitch || 0), rotZ(st.roll || 0)), T0 = [0, 0, 0];
  b.xform(0, R, 0, 0, 0);
  yield;
  if (b.obsX) b.obsX = b.obsX.map((o) => [...xpt(R, T0, o), ...xpt(R, T0, [o[3], o[4], o[5]]), o[6]]);
  let minY = 1e9;
  for (let i = 1; i < b.P.length; i += 3) if (b.P[i] < minY) minY = b.P[i];
  const yCut = minY + (st.bury || 0);
  const cv = st.cover || {};
  const caps = coverCapsules(b, { cx: cv.cx ?? 3.2, cy: cv.cy ?? 3.2, cz: cv.cz ?? 6, skip: b.skipObs || [], yMin: yCut + 0.15, maxN: cv.maxN ?? 60 });
  yield;
  if (st.bury > 0) cutBelow(b, yCut);
  yield;
  // sand inside the hull: per lattice column, the closed inner section (with the deck chord) cut by y = yF
  if (info && st.fill > 0) {
    const yF = yCut + st.fill, rows = [], NXF = 6, sand = st.sand || [0.3, 0.28, 0.22];
    const due = slicer();
    for (let i = 0; i <= info.nu; i++) {
      if (due()) { yield; due.reset(); }
      const poly = [];
      for (let j = info.jDeck; j >= 0; j--) poly.push(xpt(R, T0, info.innerPt(-1, i, j, 0.12)));
      for (let j = 1; j <= info.jDeck; j++) poly.push(xpt(R, T0, info.innerPt(1, i, j, 0.12)));
      let A = null, Bp = null;
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k], q = poly[(k + 1) % poly.length];
        if ((p[1] - yF) * (q[1] - yF) >= 0) continue;
        const t = (yF - p[1]) / (q[1] - p[1]), c = [p[0] + (q[0] - p[0]) * t, yF, p[2] + (q[2] - p[2]) * t];
        if (!A || c[0] < A[0]) A = c;
        if (!Bp || c[0] > Bp[0]) Bp = c;
      }
      rows.push(A && Bp && Bp[0] - A[0] > 0.3 ? [A, Bp] : null);
    }
    const v0 = b.vc, t0 = b.I.length, idx = [];
    for (let i = 0; i <= info.nu; i++) {
      const r = rows[i];
      if (!r) { idx.push(-1); continue; }
      idx.push(b.vc);
      for (let k = 0; k <= NXF; k++) {
        const t = k / NXF, x = lerp(r[0][0], r[1][0], t), z = lerp(r[0][2], r[1][2], t);
        const y = yF + Math.sin(t * Math.PI) * (0.12 + 0.2 * vn3(x * 0.6, z * 0.4, 1, info.sd + 3));
        const v = 0.9 + 0.2 * vn3(x * 1.3, z * 1.1, 2, info.sd);
        b.v(x, y, z, 0, 1, 0, sand[0] * v, sand[1] * v, sand[2] * v, 0.15, 0);
      }
    }
    for (let i = 0; i < info.nu; i++) {
      if (idx[i] < 0 || idx[i + 1] < 0) continue;
      for (let k = 0; k < NXF; k++) {
        const a = idx[i] + k, c = idx[i + 1] + k;
        b.t(a, a + 1, c); b.t(c, a + 1, c + 1); // +x, -z order: normal up (bow toward -z)
      }
    }
    // fix winding if the stations run the other way
    if (b.I.length > t0) {
      const a = b.I[t0], c = b.I[t0 + 1], d = b.I[t0 + 2], P = b.P;
      const ux = P[c * 3] - P[a * 3], uz = P[c * 3 + 2] - P[a * 3 + 2], vx = P[d * 3] - P[a * 3], vz = P[d * 3 + 2] - P[a * 3 + 2];
      if (uz * vx - ux * vz < 0) for (let k = t0; k < b.I.length; k += 3) { const q = b.I[k + 1]; b.I[k + 1] = b.I[k + 2]; b.I[k + 2] = q; }
    }
    b.smooth(v0, t0);
  }
  growthFilm(b.F);
  let minY2 = 1e9;
  for (let i = 1; i < b.P.length; i += 3) if (b.P[i] < minY2) minY2 = b.P[i];
  // degenerate cells (a stem where both sides meet) leave zero normals: point them up
  for (let i = 0; i < b.N.length; i += 3) if (Math.abs(b.N[i]) + Math.abs(b.N[i + 1]) + Math.abs(b.N[i + 2]) < 1e-6) b.N[i + 1] = 1;
  b.band = Math.max(0.12, Math.min(1.2, yCut + 0.2 - minY2));
  b.obs = [...caps, ...(b.obsX || []).filter((o) => Math.max(o[1], o[4]) + o[6] > yCut)];
  return { R, yCut };
}
