// Solid-obstacle registry so creatures can avoid props (rocks, coral heads, columns, hulls...).
// Obstacles are capsules between points A and B (a sphere when A == B), in GLOBAL coordinates
// using travel distance s (global z = -s). Stored in a 2D spatial hash over (x, s).
const CELL = 8;
const key = (i, j) => i * 73856093 ^ j * 19349663;

export class Obstacles {
  constructor() { this.map = new Map(); this.count = 0; }

  // o = { ax, ay, as, bx, by, bs, r }
  add(o) {
    const i0 = Math.floor((Math.min(o.ax, o.bx) - o.r) / CELL), i1 = Math.floor((Math.max(o.ax, o.bx) + o.r) / CELL);
    const j0 = Math.floor((Math.min(o.as, o.bs) - o.r) / CELL), j1 = Math.floor((Math.max(o.as, o.bs) + o.r) / CELL);
    // every bookkeeping field is created here, in a fixed order, so all obstacles share one hidden class before the
    // hot loops see them (query's dedup stamp and the creatures' cached box used to be added later); a re-added
    // (moved) obstacle drops its cached box
    o._cells = []; o._q = 0; o._bb = null;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(o); o._cells.push(k);
    }
    this.count++;
    return o;
  }

  remove(o) {
    if (!o._cells) return;
    for (const k of o._cells) {
      const a = this.map.get(k);
      if (!a) continue;
      const idx = a.indexOf(o);
      if (idx >= 0) { a[idx] = a[a.length - 1]; a.pop(); }
      if (!a.length) this.map.delete(k);
    }
    o._cells = null;
    this.count--;
  }

  // Push every obstacle whose bounds overlap the box around (x, s) with half-size `rad` into `out`
  // (deduplicated). Returns out.
  query(x, s, rad, out) {
    // (written in place and truncated at the end: `out.length = 0` dropped the array's storage on every query, so
    // each refill allocated a new one)
    let n = 0;
    const i0 = Math.floor((x - rad) / CELL), i1 = Math.floor((x + rad) / CELL);
    const j0 = Math.floor((s - rad) / CELL), j1 = Math.floor((s + rad) / CELL);
    const stamp = (this._stamp = (this._stamp + 1) | 0);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.map.get(key(i, j));
      if (!a) continue;
      for (let k = 0; k < a.length; k++) { const o = a[k]; if (o._q !== stamp) { o._q = stamp; if (n < out.length) out[n] = o; else out.push(o); n++; } }
    }
    out.length = n;
    return out;
  }

  // Signed distance from point to obstacle surface (negative = inside). Writes the outward
  // unit normal (in x, y, s) into n = {x, y, s} when provided.
  static dist(o, x, y, s, n) {
    const abx = o.bx - o.ax, aby = o.by - o.ay, abs = o.bs - o.as;
    const l2 = abx * abx + aby * aby + abs * abs;
    let t = l2 > 0 ? ((x - o.ax) * abx + (y - o.ay) * aby + (s - o.as) * abs) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (o.ax + abx * t), dy = y - (o.ay + aby * t), ds = s - (o.as + abs * t);
    const d = Math.hypot(dx, dy, ds) || 1e-6;
    if (n) { n.x = dx / d; n.y = dy / d; n.s = ds / d; }
    return d - o.r;
  }
}
Obstacles.prototype._stamp = 0;

export const obstacles = new Obstacles();
