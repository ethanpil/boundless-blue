// Placement helpers shared by the biome populators.
// Everything placed on the ground is seated on its real contact band (template.foot) over the chunk's
// composite ground (floor mesh + support props), so nothing floats; ceiling props hang by their top band.
import { orient, propClear, rotY, TAU, TUBE, poi, tierK, ceilSampler } from './core.js';
import { noise2 } from '../noise.js';

export function pickW(rng, list) {
  let tot = 0;
  for (const e of list) tot += e.w;
  let r = rng() * tot;
  for (const e of list) { r -= e.w; if (r <= 0) return e; }
  return list[list.length - 1];
}
export const pick = (rng, a) => a[(rng() * a.length) | 0];

// y that puts every contact point (and a grid across wide flat bases) at or below the surface
// `fs` is the chunk Ground (floor + supports) or any object with at(x, s). full: the whole contact band even
// for a small footprint (the hull + lowest points can straddle a dip in an uneven support's top).
export function groundY(fs, x, s, tpl, R, sx, sy, sz, few = false, full = false) {
  const at = fs.h ? (px, ps) => fs.h(px, ps) : (px, ps) => fs.at(px, ps);
  if (R[4] < 0.5) { // lying / capsized: use the lowest band in world orientation
    const F = tpl.tiltFoot(R, sx, sy, sz);
    let y = 1e9;
    for (let i = 0; i < F.length; i += 3) y = Math.min(y, at(x + F[i], s - F[i + 2]) - F[i + 1]);
    return y;
  }
  const [fx0, fz0, fx1, fz1] = tpl.footBox;
  const ext = Math.max((fx1 - fx0) * sx, (fz1 - fz0) * sz);
  const F = !full && (few || ext < 0.8) ? tpl.footFew : tpl.foot; // small footprints / planar bases: hull + lowest points
  const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
  let y = 1e9;
  for (let i = 0; i < F.length; i += 3) {
    const px = F[i] * sx, py = F[i + 1] * sy, pz = F[i + 2] * sz;
    y = Math.min(y, at(x + r0 * px + r1 * py + r2 * pz, s - (r6 * px + r7 * py + r8 * pz)) - (r3 * px + r4 * py + r5 * pz));
  }
  if (ext > 0.6 && !few) { // flat bases spanning uneven ground: sample the whole base
    const n = ext > 8 ? 8 : ext > 5 ? 6 : ext > 2 ? 4 : 3, ly = tpl.minY * sy;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const lx = (fx0 + (fx1 - fx0) * i / n) * sx, lz = (fz0 + (fz1 - fz0) * j / n) * sz;
      y = Math.min(y, at(x + r0 * lx + r1 * ly + r2 * lz, s - (r6 * lx + r7 * ly + r8 * lz)) - (r3 * lx + r4 * ly + r5 * lz));
    }
  }
  return y;
}

// y that pushes every head point (top band) at or above the ceiling, for things hanging from it
export function ceilY(ctx, x, s, tpl, R, sx, sy, sz) {
  const H = tpl.head, cs = ceilSampler(ctx);
  let y = -1e9;
  for (let i = 0; i < H.length; i += 3) {
    const px = H[i] * sx, py = H[i + 1] * sy, pz = H[i + 2] * sz;
    y = Math.max(y, cs.at(x + R[0] * px + R[1] * py + R[2] * pz, s - (R[6] * px + R[7] * py + R[8] * pz)) - (R[3] * px + R[4] * py + R[5] * pz));
  }
  return y;
}

// spec: { tpl: Template|Template[], scale: [a,b], ys: [a,b] (y-stretch), xz (depth-stretch amount), follow, sink,
//         tint(rng) -> rgb, sway (bool: scale fx by size), fxScale (scale fx by size), fa, grow [a,b], tilt,
//         maxSlope, minK, giant (probability of a rare 2.2-3x showpiece, labelled "Giant ..." + POI),
//         support (others may rest on it; placed upright), occ (footprint occupancy factor), layer,
//         drape (patch follows the floor vertex by vertex), yaw/yawJ, R, lbl / fact (per-placement name and fact),
//         embed (may sit deep in a slope: its uphill side buried), straddle (m it may sink below the floor
//         at its centre on a slope, default 0.3; broad low patches set into a slope need more),
//         fullFoot (seat on the whole contact band: small things set on bumpy coral heads) }
// Every placement also gets mild default non-uniform scale, lean and a per-instance texture-key offset.
// Returns the placed scale, or 0 if rejected.
export function putAt(ctx, batch, spec, x, y, s, nx, ny, nz, rng, sizeK = 1, fs = null) {
  const tpl = Array.isArray(spec.tpl) ? spec.tpl[(rng() * spec.tpl.length) | 0] : spec.tpl;
  if (spec.maxSlope && ny < spec.maxSlope) return 0;
  const support = !!(spec.support ?? tpl.support), drape = !!(spec.drape ?? tpl.drape) && !!(fs && fs.fs);
  if (drape && fs.onSupport(x, s)) return 0; // patches live on the bare floor
  let sc = (spec.scale[0] + (spec.scale[1] - spec.scale[0]) * Math.pow(rng(), 1.3)) * sizeK;
  const giant = spec.giant && rng() < spec.giant;
  if (giant) sc *= 2.2 + rng() * 0.8;
  const ys = spec.ys ? spec.ys[0] + (spec.ys[1] - spec.ys[0]) * rng() : drape ? 1 : 0.85 + rng() * 0.32;
  const minSc = spec.scale[0] * (spec.minK ?? 0.35);
  const zs = drape ? 1 : 1 + (rng() - 0.5) * (spec.xz ?? 0.3);
  const top = ctx.surfaceY - 0.08;
  const tilt = spec.tilt ?? ((spec.follow ?? 0.6) >= 0.95 ? 0.03 : 0.14);
  const yaw = spec.yaw !== undefined ? spec.yaw + (rng() - 0.5) * (spec.yawJ ?? 0.15) : rng() * TAU;
  // never lean further than ~37 deg into a steep face: the base then always sinks into the surface
  // (seated vertically) instead of tipping over onto its edge
  let ox = nx, oy = ny, oz = nz;
  if (oy < 0.8) { const h = Math.hypot(ox, oz) || 1; ox = ox / h * 0.6; oz = oz / h * 0.6; oy = 0.8; }
  const R = spec.R || (support || drape ? rotY(yaw) : orient(ox, oy, oz, spec.follow ?? 0.6, yaw, (rng() - 0.5) * tilt, (rng() - 0.5) * tilt));
  const lean = Math.sqrt(R[1] * R[1] + R[7] * R[7]), up = Math.max(0.2, R[4]); // tilted items reach sideways
  let ok = false;
  for (let t = 0; t < 4; t++) {
    const h = tpl.maxY * sc * ys;
    if (y + h * up < top && propClear(ctx, x, s, y, y + h * up + tpl.r * sc * lean, tpl.r * sc * Math.max(1, zs) + h * lean, spec.sway || spec.soft)) { ok = true; break; }
    sc *= 0.65;
    if (sc < minSc) break;
  }
  if (!ok) return 0;
  // footprint occupancy: big props do not interpenetrate
  const occR = spec.occ && fs && fs.free ? Math.max(tpl.footBox[2] - tpl.footBox[0], tpl.footBox[3] - tpl.footBox[1], tpl.r * 0.5) * 0.5 * sc * Math.max(1, zs) * spec.occ : 0;
  if (occR && !fs.free(x, s, occR, spec.layer || 0)) return 0;
  const c = spec.tint ? spec.tint(rng) : [1, 1, 1];
  let sink = (spec.sink ?? 0.04) * sc * ys + (1 - ny) * tpl.r * sc * 0.5;
  if (fs) { // seat on the ground under the whole contact band, then embed slightly
    const hgt = (tpl.box[4] - tpl.box[1]) * sc * ys;
    const yc = y;
    y = drape ? fs.fs.at(x, s) - tpl.minY * sc : groundY(fs, x, s, tpl, R, sc, sc * ys, sc * zs, false, !!spec.fullFoot);
    if (!drape && !spec.embed && yc - y > Math.max(spec.straddle ?? 0.3, 0.5 * hgt)) return 0; // straddles a ledge: would be buried deep (spec.embed: a boulder set into a slope, that is fine)
    sink = drape ? 0 : Math.min((spec.sink ?? 0.04) * sc * ys, 0.2 * hgt) + 0.01;
  }
  const fa = (spec.sway || spec.fxScale ? sc : 1) * (spec.fa ?? 1) * (spec.grow ? spec.grow[0] + (spec.grow[1] - spec.grow[0]) * rng() : 0.5 + rng());
  if (!batch.add(tpl, x, y - sink, -(s - ctx.s0), R, sc, sc * ys, sc * zs, c[0], c[1], c[2], fa)) return 0;
  const it = batch.last;
  if (fs) it.g = 1;
  if (drape) { it.drape = fs.fs; it.s0 = ctx.s0; }
  const base = spec.lbl || tpl.label, label = giant && base ? 'Giant ' + base.charAt(0).toLowerCase() + base.slice(1) : null;
  batch.tag(rng(), label, spec.fact);
  if (spec.lbl && !giant) it.name = spec.lbl; // regional species name for a shared template
  if (support && fs && fs.addSupport) fs.addSupport(it, s);
  if (occR) fs.occupy(x, s, occR, spec.layer || 0);
  if (giant) { const h = tpl.maxY * sc * ys; poi(ctx, 'giant', x, y + h * 0.5, s, Math.max(h, tpl.r * sc), { name: label }); }
  return sc;
}

export function putFloor(ctx, fs, batch, spec, x, s, rng, sizeK = 1) {
  const y = fs.at(x, s);
  return putAt(ctx, batch, spec, x, y, s, fs.nx, fs.ny, fs.nz, rng, sizeK, fs);
}

// Hang a prop from the ceiling at (x, s): its top band is pushed into the ceiling surface everywhere.
// Returns the placed item or null.
export function hangAt(ctx, batch, tpl, x, s, R, sx, sy, sz, tint = [1, 1, 1], fa = 1, embed = 0.12) {
  const y = ceilY(ctx, x, s, tpl, R, sx, sy, sz) + embed;
  if (!batch.add(tpl, x, y, -(s - ctx.s0), R, sx, sy, sz, tint[0], tint[1], tint[2], fa)) return null;
  const it = batch.last;
  it.hang = 1;
  return it;
}

// Seat a prop placed by hand (fixed rotation/scale) on the ground; returns the item or null.
export function seat(ctx, gnd, batch, tpl, x, s, R, sx, sy, sz, tint = [1, 1, 1], fa = 1, sink = 0.03, opts = {}) {
  const y = groundY(gnd, x, s, tpl, R, sx, sy, sz) - sink;
  if (!batch.add(tpl, x, y, -(s - ctx.s0), R, sx, sy, sz, tint[0], tint[1], tint[2], fa)) return null;
  const it = batch.last;
  it.g = 1;
  if (opts.support && gnd.addSupport) gnd.addSupport(it, s);
  return it;
}

// random spot in chunk at lateral distance in [d0, d1] from the path (bias > 1 favours near)
export function spot(ctx, rng, d0, d1, bias = 1) {
  const s = ctx.s0 + rng() * 64;
  const d = d0 + (d1 - d0) * Math.pow(rng(), bias);
  const side = rng() < 0.5 ? -1 : 1;
  return { s, x: ctx.pathX(s) + side * d, d, side };
}

// tint helpers: pick a base colour and jitter value, saturation and hue per instance
export function tintFrom(list, amt = 0.15) {
  return (rng) => {
    const c = list[(rng() * list.length) | 0], k = 1 + (rng() - 0.5) * 2.4 * amt;
    const l = (c[0] + c[1] + c[2]) / 3, sat = 1 + (rng() - 0.5) * 3 * amt;
    const h = (rng() - 0.5) * 1.6 * amt; // small hue shift: rotate energy between channels
    const r = l + (c[0] - l) * sat, g = l + (c[1] - l) * sat, b = l + (c[2] - l) * sat;
    return [Math.max(0, (r + h * (g - b)) * k), Math.max(0, (g + h * (b - r)) * k), Math.max(0, (b + h * (r - g)) * k)];
  };
}
export const grey = (c, amt = 0.15) => tintFrom([c], amt);

// Natural, non-grid distribution: clusters of varied size and count with gaps, occasional singletons,
// and patch-to-patch density from a noise field. next() -> {x, s, d} or null (rejected by density).
export function clusterer(ctx, rng, d0, d1, bias = 1.2, { r: [r0, r1] = [0.6, 4], n: [n0, n1] = [2, 12], single = 0.15, patch = 19, seed = 7 } = {}) {
  let left = 0, cx = 0, cs = 0, cr = 1;
  return () => {
    if (left <= 0) {
      const p = spot(ctx, rng, d0, d1, bias);
      cx = p.x; cs = p.s; cr = r0 + (r1 - r0) * Math.pow(rng(), 1.5);
      left = rng() < single ? 1 : n0 + Math.floor(rng() * (n1 - n0 + 1));
    }
    left--;
    const a = rng() * TAU, rr = cr * Math.sqrt(-Math.log(1 - rng() * 0.95)) * 0.6;
    const x = cx + Math.cos(a) * rr, s = cs + Math.sin(a) * rr;
    if (s < ctx.s0 || s >= ctx.s1) return null;
    const dens = 0.25 + 0.75 * Math.min(1, Math.max(0, 0.5 + noise2(x / patch, s / patch, seed)));
    if (rng() > dens) return null;
    return { x, s, d: Math.abs(x - ctx.pathX(s)) };
  };
}

// Solid obstacle on the outside of a bend apex (b from bendSpots): reads dead ahead, camera curves past.
export function bendX(ctx, b, radius, rng, extra = 1.6) {
  return ctx.pathX(b.s) + b.side * (TUBE + 0.45 + radius + rng() * extra);
}
export function putBend(ctx, fs, batch, spec, b, rng) {
  const tpl = Array.isArray(spec.tpl) ? spec.tpl[(rng() * spec.tpl.length) | 0] : spec.tpl;
  const sc = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * rng();
  const x = bendX(ctx, b, tpl.r * sc, rng);
  const y = fs.at(x, b.s);
  return putAt(ctx, batch, { ...spec, tpl, scale: [sc, sc], tilt: 0, follow: Math.min(spec.follow ?? 0.3, 0.25) }, x, y, b.s, fs.nx, fs.ny, fs.nz, rng, 1, fs) ? x : null;
}

// Split n iterations of body(k) into continuation steps of `per` iterations (see core.staged).
export function steps(n, per, body) {
  const out = [];
  for (let a = 0; a < n; a += per) { const b = Math.min(n, a + per); out.push(() => { for (let k = a; k < b; k++) body(k); }); }
  return out;
}
// microDetail as continuation steps sharing one clusterer
export function microSteps(ctx, fs, batch, rng, key, list, n, d1 = 30, per = 40) {
  const next = clusterer(ctx, rng, 0, d1, 1.25, { r: [0.4, 3], n: [2, 9], single: 0.25, patch: 13, seed: 41 });
  return steps(Math.round(n * tierK(ctx)), per, () => {
    const p = next();
    if (!p || rng() > ctx.weightOf(p.s, key)) return;
    const e = pickW(rng, list);
    putFloor(ctx, fs, batch, e.spec, p.x, p.s, rng);
  });
}

// Dense low micro detail across the floor, including directly under the path (scaled by GPU tier).
// list: [{ w, spec }] ; n attempts; d1 lateral range
export function microDetail(ctx, fs, batch, rng, key, list, n, d1 = 30) {
  const next = clusterer(ctx, rng, 0, d1, 1.25, { r: [0.4, 3], n: [2, 9], single: 0.25, patch: 13, seed: 41 });
  n = Math.round(n * tierK(ctx));
  for (let k = 0; k < n; k++) {
    const p = next();
    if (!p || rng() > ctx.weightOf(p.s, key)) continue;
    const e = pickW(rng, list);
    putFloor(ctx, fs, batch, e.spec, p.x, p.s, rng);
  }
}
