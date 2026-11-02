// Personal space: no two animals may interpenetrate, stack or "blend" into each other.
// Every animal is a capsule (segment along its body axis + radius) derived from its geometry. Pairs are
// resolved with the separating-axis test along the line between their centres: the capsules' projected
// half-extents ext(u) = h * |u . axis| + r must not overlap (plus a small gap), which guarantees a positive
// surface clearance. Neighbours are found by sweep and prune along x (each group keeps an x-sorted order), across
// groups only for pairs whose boxes overlap. Corrections are split by mass (big animals
// barely move, resting / anchored ones least of all) and followed by the hard constraints (terrain, camera
// bubble, obstacles) in Encounter._applySep.
import { PART } from './build.js';

// plans whose long axis is local +y (bells, upright bodies)
const YAXIS = new Set(['jelly', 'dumbo', 'cassiopea', 'octopus', 'seahorse']);
// local support directions for the terrain check: nose, tail, top, bottom, tail-top, tail-bottom, left, right
const SUP_DIRS = [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [0, 0.7, -0.7], [0, -0.7, -0.7], [1, 0, 0], [-1, 0, 0]];
// candidate directions for extra support points: the 26 axis / edge / corner directions of a cube
const DIR26 = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
  if (dx || dy || dz) { const l = Math.hypot(dx, dy, dz); DIR26.push(dx / l, dy / l, dz / l); }
}
const SUP_MAX = 16;
// extra terrain clearance of a jelly bell (Encounter.tPad): its pulsing rim is soft and only coarsely sampled
export const JELLY_PAD = 0.1;

// Shape of a species from its built geometry (unit body length): capsule centre offset c along the axis,
// half segment h, radius r; and the extreme points (local x, y, z) used to keep every extremity out of rock:
// the 8 above, plus the extremes of those of the 26 cube directions that the hull of the points so far misses by
// more than `tol` (whale flukes behind the flippers, crab legs, big bells). A miss of g body lengths eats g * size
// out of the terrain clearance (0.03 m + 0.035 body lengths + a jelly's pad, along the surface normal), so it is
// held to half of that for the largest individuals; most fish and jellies keep the 8 points.
export function bodyShape(sp, g) {
  const pos = g.pos, ga = g.g, nv = pos.length / 3, ya = YAXIS.has(sp.plan);
  const soft = sp.plan === 'jelly' || sp.plan === 'siphon'; // trailing tentacles may brush things
  let amin = 1e9, amax = -1e9, rb = 0, rf = 0;
  const best = new Float32Array(8).fill(-1e9), sup8 = new Float32Array(24), ext = new Float32Array(26 * 4);
  for (let j = 0; j < 26; j++) ext[j * 4] = -1e9;
  for (let v = 0; v < nv; v++) {
    const part = ga[v * 4], x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (part === PART.GLOW) continue;
    const arm = part === PART.ARM;
    if (!(arm && soft)) {
      for (let k = 0; k < 8; k++) {
        const d = SUP_DIRS[k], s = x * d[0] + y * d[1] + z * d[2];
        if (s > best[k]) { best[k] = s; sup8[k * 3] = x; sup8[k * 3 + 1] = y; sup8[k * 3 + 2] = z; }
      }
      for (let j = 0; j < 26; j++) {
        const s = x * DIR26[j * 3] + y * DIR26[j * 3 + 1] + z * DIR26[j * 3 + 2];
        if (s > ext[j * 4]) { ext[j * 4] = s; ext[j * 4 + 1] = x; ext[j * 4 + 2] = y; ext[j * 4 + 3] = z; }
      }
    }
    if (arm && sp.plan !== 'octopus' && sp.plan !== 'cassiopea') continue; // tentacles, squid arms
    if (part === PART.TOOTH || part === PART.BEAK || part === PART.EYE) continue; // bills, tusks, claws
    const a = ya ? y : z, rad = ya ? Math.hypot(x, z) : Math.hypot(x, y);
    const body = part === PART.BODY || part === PART.SHELL || arm;
    if (body || part === PART.CAUDAL) { if (a < amin) amin = a; if (a > amax) amax = a; }
    if (body) { if (rad > rb) rb = rad; } else if (rad > rf) rf = rad;
  }
  let r = Math.max(rb, rf * 0.75);
  if (sp.plan === 'octopus') r *= 0.8;          // arms drape and curl
  if (sp.plan === 'jelly') r = Math.max(r, 0.5); // the bell rim
  const half = Math.max(0, (amax - amin) * 0.5);
  const smax = (sp.size && sp.size[1]) || 1, pad = sp.plan === 'jelly' ? JELLY_PAD : 0;
  const tol = 0.5 * (0.035 + (0.03 + pad) / smax), pts = Array.from(sup8);
  while (pts.length < SUP_MAX * 3) {
    let worst = tol, wj = -1;
    for (let j = 0; j < 26; j++) {
      const dx = DIR26[j * 3], dy = DIR26[j * 3 + 1], dz = DIR26[j * 3 + 2];
      let hh = -1e9;
      for (let k = 0; k < pts.length; k += 3) { const s = pts[k] * dx + pts[k + 1] * dy + pts[k + 2] * dz; if (s > hh) hh = s; }
      if (ext[j * 4] - hh > worst) { worst = ext[j * 4] - hh; wj = j; }
    }
    if (wj < 0) break;
    pts.push(ext[wj * 4 + 1], ext[wj * 4 + 2], ext[wj * 4 + 3]);
  }
  return { ya, c: (amin + amax) * 0.5, h: Math.max(0, half - r), r, sup: Float32Array.from(pts) };
}

const SLOW = new Set(['drift', 'hover', 'rest', 'walk', 'octo']);
const STATIC = new Set(['colony', 'peek', 'bed']);
const ON_FLOOR = (e, i) => e.kind === 'walk' || e.kind === 'bed' || ((e.kind === 'rest' || e.kind === 'octo') && e.MODE[i] === 0);
const slowOf = (e) => e.speed < 0.35 && SLOW.has(e.kind);
// resolve cadence (in 60 fps frames) and the matching safety margin added to the gap: drifting jellies every 5th
// frame (huge schools / mills every 2nd frame: neighbours there swim together, their relative drift is tiny)
const every = (e) => (STATIC.has(e.kind) ? 5 : !slowOf(e) ? (e.n > 80 ? 2 : 1) : e.kind === 'drift' ? 5 : 3);
const marginOf = (k) => (k >= 5 ? 0.06 : k >= 3 ? 0.04 : k >= 2 ? 0.02 : 0);
// The cadence is kept in time, not frames (groups simulated at a third of the rate, or a slow frame rate, would
// otherwise go many frames without a resolve), and slow groups' margins cover their members' closing speed over
// the real interval (pulsing jellies surge to ~2.5x their cruising speed, scuttling crabs to 2.5x).
const periodOf = (k) => (k - 0.5) / 60;
const marginFor = (e, k, dt) => (k < 3 ? marginOf(k) : Math.min(0.15, Math.max(marginOf(k), (e.speed * 3 + 0.03) * Math.max(periodOf(k), dt))));

export class Separation {
  constructor(sys) {
    this.sys = sys; this.frame = 0; this.margin = 0;
    this.stats = { pairs: 0, pushes: 0, ms: 0 };
  }

  // Fill an encounter's capsule arrays (centre relative to its anchor, axis, half length, radius, mass weight),
  // its box (capsule centres grown by the largest extent) and its order sorted along x (sweep and prune:
  // an insertion sort, nearly linear because the order barely changes from one frame to the next).
  _fill(e) {
    const sh = e.entry.shape, n = e.n, P = e.P, F = e.F, SZ = e.SZ, C = e.SC, A = e.SA, H = e.SH, R = e.SR, M = e.SM, FL = e.SF, O = e.SO;
    // a small fixed view of the arrays: the pair loops never touch the (large) encounter object
    const v = e.SV || (e.SV = { C, A, H, R, Z: SZ, M, FL, D: e.SD, O, hit: 0, ext: 0, x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 });
    v.hit = 0;
    const up = e.kind === 'colony' || (sh.ya && (e.sp.plan === 'seahorse' || e.sp.plan === 'cassiopea' || e.sp.plan === 'octopus'));
    const stat = STATIC.has(e.kind), floorKinds = e.kind === 'walk' || e.kind === 'bed' || e.kind === 'rest' || e.kind === 'octo';
    let ext = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, s = SZ[i];
      let ax = 0, ay = 1, az = 0;
      if (!up) { ax = F[i3]; ay = F[i3 + 1]; az = F[i3 + 2]; }
      const c = sh.c * s, cx = P[i3] + ax * c, cy = P[i3 + 1] + ay * c, cz = P[i3 + 2] + az * c;
      C[i3] = cx; C[i3 + 1] = cy; C[i3 + 2] = cz;
      A[i3] = ax; A[i3 + 1] = ay; A[i3 + 2] = az;
      const h = sh.h * s, r = sh.r * s;
      H[i] = h; R[i] = r;
      // inverse-mass style weight: anchored animals never move, resting ones are heavy
      const fl = floorKinds && ON_FLOOR(e, i); FL[i] = fl ? 1 : 0;
      M[i] = stat || e.SB[i] ? 0 : s * s * s * (fl ? 6 : 1); // (wedged this frame: holds still, see Encounter._applySep)
      const x = h + r + 0.35 * s; if (x > ext) ext = x;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
    }
    for (let k = 1; k < n; k++) { // keep O sorted by centre x
      const q = O[k], x = C[q * 3];
      let m = k - 1;
      while (m >= 0 && C[O[m] * 3] > x) { O[m + 1] = O[m]; m--; }
      O[m + 1] = q;
    }
    const OI = e.SOI;
    for (let k = 0; k < n; k++) OI[O[k]] = k;
    e.sepExt = ext; v.ext = ext;
    v.x0 = x0 - ext; v.x1 = x1 + ext; v.y0 = y0 - ext; v.y1 = y1 + ext; v.z0 = z0 - ext; v.z1 = z1 + ext;
    e.SD.fill(0, 0, n * 3);
  }

  // Resolve one pair (agent i of view a, agent j of view b; dz converts b's z into a's frame).
  _pair(a, i, b, j, dz, gapK) {
    const i3 = i * 3, j3 = j * 3, CA = a.C, CB = b.C;
    const dx = CB[j3] - CA[i3], dy = CB[j3 + 1] - CA[i3 + 1], dzz = CB[j3 + 2] + dz - CA[i3 + 2];
    const hi = a.H[i], ri = a.R[i], hj = b.H[j], rj = b.R[j], zi = a.Z[i], zj = b.Z[j];
    const gap = gapK * (zi < zj ? zi : zj) + this.margin;
    const lim = hi + ri + hj + rj + gap, d2 = dx * dx + dy * dy + dzz * dzz;
    if (d2 >= lim * lim) return;
    let d = Math.sqrt(d2), ux, uy, uz;
    if (d < 1e-5) { const k = (i * 7 + j * 13) % 4; ux = k < 2 ? (k ? -1 : 1) : 0; uy = 0; uz = k >= 2 ? (k > 2 ? -1 : 1) : 0; d = 0; }
    else { ux = dx / d; uy = dy / d; uz = dzz / d; }
    const AA = a.A, AB = b.A;
    const need = hi * Math.abs(ux * AA[i3] + uy * AA[i3 + 1] + uz * AA[i3 + 2]) + ri + hj * Math.abs(ux * AB[j3] + uy * AB[j3 + 1] + uz * AB[j3 + 2]) + rj + gap;
    if (d >= need) return;
    const mi = a.M[i], mj = b.M[j];
    if (mi === 0 && mj === 0) return;
    this.stats.pairs++;
    // animals on the floor slide sideways only (a swimmer above one still moves straight away from it): their
    // share goes along the horizontal part of the push direction, lengthened to make up for the lost vertical part
    const fi = a.FL[i] === 1, fj = b.FL[j] === 1;
    let hx = ux, hz = uz, hk = 1;
    if (fi || fj) {
      const hl = Math.sqrt(ux * ux + uz * uz);
      if (hl < 0.2) { const k = (i + j) & 1; hx = k ? 0.8 : -0.8; hz = 0.6; hk = fi && fj ? 1 : 0.5; } else { hx = ux / hl; hz = uz / hl; hk = 1 / Math.max(hl, 0.5); }
    }
    const ov = need - d + 0.004, wi = mi === 0 ? 0 : mj === 0 ? 1 : mj / (mi + mj), wj = mj === 0 ? 0 : 1 - wi;
    const SA = a.D, SB = b.D;
    if (fi) { const p = ov * wi * hk; SA[i3] -= hx * p; SA[i3 + 2] -= hz * p; }
    else { SA[i3] -= ux * ov * wi; SA[i3 + 1] -= uy * ov * wi; SA[i3 + 2] -= uz * ov * wi; }
    if (fj) { const p = ov * wj * hk; SB[j3] += hx * p; SB[j3 + 2] += hz * p; }
    else { SB[j3] += ux * ov * wj; SB[j3 + 1] += uy * ov * wj; SB[j3 + 2] += uz * ov * wj; }
    a.hit = 1; b.hit = 1;
  }

  // Within a group: sweep along x, test only the slab each agent can reach.
  _within(e) {
    const n = e.n, gapK = e.kind === 'rest' ? 0.35 : 0.12, v = e.SV, C = v.C, H = v.H, R = v.R, Z = v.Z, O = v.O, mg = this.margin, ext = v.ext;
    for (let a = 0; a < n - 1; a++) {
      const i = O[a], x = C[i * 3], y = C[i * 3 + 1], z = C[i * 3 + 2], ei = H[i] + R[i] + gapK * Z[i] + mg, reach = ei + ext;
      for (let b = a + 1; b < n; b++) {
        const j = O[b], dx = C[j * 3] - x;
        if (dx > reach) break;
        const dy = C[j * 3 + 1] - y, dz = C[j * 3 + 2] - z, l = ei + H[j] + R[j];
        if (dx * dx + dy * dy + dz * dz < l * l) this._pair(v, i, v, j, 0, gapK);
      }
    }
  }

  // Follow-up round: only the agents that just moved (list) against their neighbours in the sorted order.
  _withinSome(e, list, count) {
    const n = e.n, gapK = e.kind === 'rest' ? 0.35 : 0.12, v = e.SV, C = v.C, H = v.H, R = v.R, Z = v.Z, O = v.O, OI = e.SOI, mk = e.SK, mg = this.margin, ext = v.ext;
    for (let q = 0; q < count; q++) mk[list[q]] = 1;
    for (let q = 0; q < count; q++) {
      const i = list[q], a = OI[i], x = C[i * 3], y = C[i * 3 + 1], z = C[i * 3 + 2], ei = H[i] + R[i] + gapK * Z[i] + mg, reach = ei + ext;
      for (let b = a + 1; b < n; b++) {
        const j = O[b], dx = C[j * 3] - x;
        if (dx > reach) break;
        if (mk[j] && j < i) continue; // that pair is handled from j's side
        const dy = C[j * 3 + 1] - y, dz = C[j * 3 + 2] - z, l = ei + H[j] + R[j];
        if (dx * dx + dy * dy + dz * dz < l * l) this._pair(v, i, v, j, 0, gapK);
      }
      for (let b = a - 1; b >= 0; b--) {
        const j = O[b], dx = x - C[j * 3];
        if (dx > reach) break;
        if (mk[j] && j < i) continue;
        const dy = C[j * 3 + 1] - y, dz = C[j * 3 + 2] - z, l = ei + H[j] + R[j];
        if (dx * dx + dy * dy + dz * dz < l * l) this._pair(v, i, v, j, 0, gapK);
      }
    }
    for (let q = 0; q < count; q++) mk[list[q]] = 0;
  }

  // Two different groups: merge-sweep of their x-sorted orders.
  _across(a, b) {
    const va = a.SV, vb = b.SV, dz = b.anchorZ - a.anchorZ, gapK = a.kind === 'rest' || b.kind === 'rest' ? 0.35 : 0.2, mg = this.margin;
    const CA = va.C, CB = vb.C, HA = va.H, RA = va.R, HB = vb.H, RB = vb.R, ZA = va.Z, OA = va.O, OB = vb.O, na = a.n, nb = b.n, extB = vb.ext;
    // only the stretch of x where both boxes overlap matters
    const xl = Math.max(va.x0, vb.x0), xh = Math.min(va.x1, vb.x1);
    // the sweep's start only moves past b's members that no member of a can reach any more: each agent's own reach
    // varies with its size, so `x - reach` is not monotonic along a's order (a big adult after a juvenile skipped
    // the partners the juvenile had left behind, and those cross-group pairs were never tested)
    const reachA = va.ext + mg + extB;
    let start = 0;
    for (let p = 0; p < na; p++) {
      const i = OA[p], x = CA[i * 3];
      if (x < xl - va.ext) continue;
      if (x > xh + va.ext) break;
      const y = CA[i * 3 + 1], z = CA[i * 3 + 2] - dz, ei = HA[i] + RA[i] + gapK * ZA[i] + mg, reach = ei + extB;
      while (start < nb && CB[OB[start] * 3] < x - reachA) start++;
      for (let q = start; q < nb; q++) {
        const j = OB[q], ddx = CB[j * 3] - x;
        if (ddx > reach) break;
        const ddy = CB[j * 3 + 1] - y, ddz = CB[j * 3 + 2] - z, l = ei + HB[j] + RB[j];
        if (ddx * ddx + ddy * ddy + ddz * ddz < l * l) this._pair(va, i, vb, j, dz, gapK);
      }
    }
  }

  // One pass over every group (call after all encounters updated this frame; dt = this frame's step).
  run(c, dt = 1 / 60) {
    const t0 = performance.now(), list = this.sys.enc;
    const fr = ++this.frame;
    this.stats.pairs = 0;
    const act = this._act || (this._act = []);
    act.length = 0;
    for (const e of list) if (e.nBlk) { e.SB.fill(0); e.nBlk = 0; } // wedge flags last one frame
    for (const e of list) {
      if (e.done || e.kind === 'attach' || !e.SC) continue;
      // capsules only change when the group moved (simulated this frame, or pushed by the last pass)
      if (e.stepped || e.sepMoved || !e.SV || (STATIC.has(e.kind) && (fr + e.uid) % 5 === 0)) { this._fill(e); e.sepMoved = false; } else e.SV.hit = 0;
      // slow drifters / hoverers (jelly swarms, sea horses, resting rays) resolve every few frames' worth of time;
      // their gap carries a margin so the drift in between can never close it
      const k = every(e);
      e.sepDue = e.stepped && !STATIC.has(e.kind) && e.age - e.sepT >= periodOf(k) - 1e-6;
      e.sepMg = marginFor(e, k, dt);
      act.push(e);
    }
    for (const e of act) {
      if (!e.sepDue) continue;
      this.margin = e.sepMg;
      this._within(e);
    }
    for (let p = 0; p < act.length; p++) {
      const a = act[p], va = a.SV;
      for (let q = p + 1; q < act.length; q++) {
        const b = act[q];
        if (!a.sepDue && !b.sepDue) continue; // the faster of the two sets the pace
        const vb = b.SV, dz = b.anchorZ - a.anchorZ;
        if (va.x0 > vb.x1 || vb.x0 > va.x1 || va.y0 > vb.y1 || vb.y0 > va.y1 || va.z0 > vb.z1 + dz || vb.z0 + dz > va.z1) continue;
        this.margin = Math.max(a.sepMg, b.sepMg);
        this._across(a, b);
      }
    }
    for (const e of act) if (e.sepDue) e.sepT = e.age;
    let pushes = 0;
    for (const e of act) if (e.SV.hit) pushes += e._applySep(c);
    // a second relaxation round inside the groups that moved (pushes from several neighbours partly cancel), and
    // between pairs of them: mixed-species companions share one formation, and the hard constraints re-applied after
    // a push (terrain, rocks, camera) moved members back into the other group's fish with no cross-group re-check
    const again = this._again || (this._again = []);
    again.length = 0;
    for (const e of act) if (e.SV.hit && !STATIC.has(e.kind)) { this._fill(e); e.sepMoved = false; again.push(e); } // pushed by a neighbour group too
    // (three rounds: an animal found wedged after one round holds still in the next, see Encounter._applySep)
    for (let round = 0; round < 3 && again.length; round++) {
      for (const e of again) { this.margin = e.sepMg; this._withinSome(e, e.SMV, e.nMoved); }
      for (let p = 0; p < again.length; p++) {
        const a = again[p], va = a.SV;
        for (let q = p + 1; q < again.length; q++) {
          const b = again[q], vb = b.SV, dz = b.anchorZ - a.anchorZ;
          if (va.x0 > vb.x1 || vb.x0 > va.x1 || va.y0 > vb.y1 || vb.y0 > va.y1 || va.z0 > vb.z1 + dz || vb.z0 + dz > va.z1) continue;
          this.margin = Math.max(a.sepMg, b.sepMg);
          this._across(a, b);
        }
      }
      this.margin = 0;
      let k = 0;
      for (const e of again) if (e.SV.hit) { pushes += e._applySep(c); if (round < 2) { this._fill(e); e.sepMoved = false; again[k++] = e; } }
      again.length = round < 2 ? k : 0;
    }
    this.stats.pushes = pushes;
    this.stats.ms = this.stats.ms * 0.95 + (performance.now() - t0) * 0.05;
  }
}

// ---------- measurement helpers (dev tests) ----------
// Closest distance between segments [p1,q1] and [p2,q2] (Ericson, Real-Time Collision Detection 5.1.9).
export function segSegDist(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z, d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const x = p1x + d1x * s - (p2x + d2x * t), y = p1y + d1y * s - (p2y + d2y * t), z = p1z + d1z * s - (p2z + d2z * t);
  return Math.sqrt(x * x + y * y + z * z);
}
