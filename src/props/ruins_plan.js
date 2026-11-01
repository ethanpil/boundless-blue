// City planner for the sunken cities. Each ruins segment becomes one city with its own style, state of
// decay, overgrowth, silt, street width and name. The plan is deterministic and computed lazily in 40 m
// slices (independent of chunk boundaries and build order): a street along the camera path, building lots
// set back on both sides in one or two rows, plazas with a monument, temples and one big set piece, gates
// and a city wall across the street, an aqueduct or bridge overhead, and landmarks on the outside of bends
// (they appear dead ahead and the camera curves past). Items carry footprints so any chunk can keep its
// scatter out of buildings, including ones owned by a neighbouring chunk.
import { TUBE, ENV } from './core.js';
import { mulberry32, hash2i } from '../noise.js';
import { STYLES, pickW } from './ruins_styles.js';

export const SL = 40; // slice length (m)
const STYLE_W = [['greco', 1.5], ['egypt', 1.1], ['maya', 1.0], ['khmer', 1.0], ['minoan', 0.9], ['pagoda', 1.0], ['atlantis', 0.8]];

// lot sizes per kind: [W min, W max, D min, D max]
const DIMS = {
  house: [7, 11.5, 6, 9.5], block: [12, 17, 9, 12], palace: [14, 20, 7, 9], magazine: [10, 14, 8, 10], library: [6, 8, 8, 10.5],
  hall: [11, 15, 8, 11], bath: [12, 15, 10, 13], tower: [6, 7.5, 6, 7.5], rotunda: [11, 14, 11, 14], dome: [9, 12, 9, 12],
  stoa: [14, 22, 5.5, 7], gallery: [14, 22, 5.5, 7], shrine: [8, 11, 9, 12], platform: [9, 12, 9, 12], prasat: [7, 9, 7, 9],
  pavilion: [8, 9.5, 8, 9.5], courtyard: [12, 16, 10, 13], spire: [6, 8, 6, 8], shell: [9, 12, 9, 12],
};
export const RADIUS = { lighthouse: 4.5, colossus: 2.6, victoryCol: 2.2, tholos: 6.5, obeliskPair: 4.5, colossusPair: 5, pyramid: 9, stelaGroup: 3,
  observatory: 6.5, head: 2.2, faceTower: 5, prang: 4.5, buddha: 3.5, horns: 2.8, bull: 2.4, labrys: 1.6, pagoda: 5, bellTower: 4.5,
  lionPair: 4, spiralTower: 4, trident: 2.4, nautilus: 3.8 };

const plans = new Map();
let forced = null;
if (typeof location !== 'undefined') { const m = /[?&]ruinstyle=([a-z]+)/.exec(location.search || ''); if (m && STYLES[m[1]]) forced = m[1]; }

export function planFor(seg) {
  let P = plans.get(seg.id);
  if (P && P.seed === seg.seed) return P;
  const r = mulberry32((seg.seed ^ 0x51a7c1) >>> 0);
  const key = (typeof window !== 'undefined' && window.__ruinsStyle && STYLES[window.__ruinsStyle]) ? window.__ruinsStyle : forced || pickW(r, STYLE_W);
  const S = STYLES[key];
  P = {
    seed: seg.seed, seg, S, key,
    mix: S.mix && STYLES[S.mix] ? STYLES[S.mix] : null,
    decay: 0.25 + 0.55 * r(), grow: 0.45 + 0.9 * r(), silt: 0.3 + 0.6 * r(), density: 0.65 + 0.35 * r(),
    streetHalf: 3.9 + 1.4 * r(), side2: r() < 0.8, city: S.cities[(r() * S.cities.length) | 0],
    slices: new Map(), n: Math.ceil((seg.end - seg.start) / SL),
  };
  P.front = P.streetHalf + 1.8 + 1.4 * r();               // building front line (m from the path)
  P.bigSlice = 3 + Math.floor(r() * Math.max(1, P.n - 7));   // the city's big set piece
  P.crossSlice = S.crossing.length && r() < 0.8 ? 2 + Math.floor(r() * Math.max(1, P.n - 5)) : -1;
  if (P.crossSlice === P.bigSlice) P.crossSlice = P.bigSlice + 2 < P.n - 2 ? P.bigSlice + 2 : -1;
  P.wallSlice = -1;
  plans.set(seg.id, P);
  if (plans.size > 16) plans.delete(plans.keys().next().value);
  return P;
}

const W = (seq, s, key) => seq.weightOf(s, key);
export const pathYaw = (sh, s) => Math.atan2(-(sh.pathX(s + 3) - sh.pathX(s - 3)), 6);

function bendsIn(sh, s0, s1) {
  const out = [];
  for (let s = Math.ceil(s0 / 2) * 2; s < s1; s += 2) {
    const c = sh.pathCurv(s), a = Math.abs(c);
    if (a < 0.012 || a < Math.abs(sh.pathCurv(s - 2)) || a < Math.abs(sh.pathCurv(s + 2))) continue;
    out.push({ s, side: c > 0 ? -1 : 1, c });
  }
  return out;
}

// item: { kind, gen, S, s, side, off, W, D, seed, row, ... } with a footprint in the path-aligned frame
function item(P, sh, o) {
  const it = Object.assign({ row: 1, decayK: 0, cross: false, pad: 0.6, plan: P }, o);
  it.x = sh.pathX(it.s) + (it.cross ? 0 : it.side * it.off);
  it.yaw = it.cross ? pathYaw(sh, it.s) : pathYaw(sh, it.s) - it.side * Math.PI / 2;
  it.c = Math.cos(it.yaw); it.sn = Math.sin(it.yaw);
  it.hx = (it.cross ? it.span : it.W / 2) + it.pad; it.hz = (it.cross ? it.depth / 2 : it.D / 2) + it.pad;
  it.R = Math.hypot(it.hx, it.hz);
  return it;
}

// slice i of the city: role and items (cached)
export function slice(P, seq, i) {
  let L = P.slices.get(i);
  if (L) return L;
  const sh = ENV.shape, S = P.S, seg = P.seg;
  const s0 = seg.start + i * SL, s1 = s0 + SL, sc = s0 + SL / 2;
  const r = mulberry32((hash2i(seg.seed, i, 0x7a3) * 4294967296) >>> 0);
  const w = W(seq, sc, 'ruins'), core = Math.min(W(seq, s0 + 4, 'ruins'), W(seq, s1 - 4, 'ruins'));
  const h = (k) => hash2i(seg.seed, k, 0x7a5);
  const plazaAt = (k) => k > 1 && k < P.n - 2 && h(k) < 0.16 && !(h(k - 1) < 0.16);
  L = { i, s0, s1, w, items: [], plaza: null, gates: [] };
  P.slices.set(i, L);
  if (w < 0.3) return L;
  const res = { '-1': [], 1: [] }; // reserved s-ranges per side for the first row: [sa, sb, maxLateral]
  const reserve = (side, sa, sb, lat = 1e9) => { res[side].push([sa, sb, lat]); };
  const both = (sa, sb, lat) => { reserve(-1, sa, sb, lat); reserve(1, sa, sb, lat); };
  const seed = () => (r() * 2147483647) | 0;
  // city wall with its gate where the city proper begins (and at its far end)
  if (P.wallSlice < 0 && core > 0.85 && i >= 1) P.wallSlice = i;
  const wallHere = i === P.wallSlice || (i === P.n - 3 && core > 0.85 && r() < 0.5);
  if (wallHere) {
    const s = s0 + 5;
    L.items.push(item(P, sh, { kind: 'citywall', gen: 'citywall', S, s, side: 0, cross: true, span: 55, depth: 4, seed: seed(), gate: pickW(r, S.gates), Rg: 4.6 + r() * 0.9 }));
    both(s - 5, s + 5, 1e9);
  } else if (core > 0.6 && r() < 0.22) { // freestanding gate / arch over the street
    const s = s0 + 6 + r() * (SL - 12);
    L.items.push(item(P, sh, { kind: 'gate', gen: 'gate', S, s, side: 0, cross: true, span: 9, depth: 3, seed: seed(), gate: pickW(r, S.gates), Rg: 4.4 + r() * 1.4 }));
    both(s - 3.5, s + 3.5, 9);
  }
  if (i === P.crossSlice && core > 0.7) { // aqueduct / bridge across the street
    const s = s0 + SL * (0.35 + 0.3 * r());
    L.items.push(item(P, sh, { kind: S.crossing[(r() * S.crossing.length) | 0], gen: 'crossing', S, s, side: 0, cross: true, span: 48, depth: 4, seed: seed() }));
    both(s - 4, s + 4, 1e9);
  }
  // landmarks on the outside of bends
  for (const b of bendsIn(sh, s0 + 4, s1 - 4)) {
    if (r() > 0.75) continue;
    const kind = pickW(r, S.landmarks), rad = RADIUS[kind] || 3.5;
    const off = TUBE + 0.6 + rad + 0.6 + r() * 1.8;
    L.items.push(item(P, sh, { kind, gen: 'landmark', S, s: b.s, side: b.side, off, W: rad * 2, D: rad * 2, seed: seed(), landmark: true, pad: 0.4 }));
    reserve(b.side, b.s - rad - 3, b.s + rad + 3, off + rad + 2);
    break;
  }
  const plaza = core > 0.7 && plazaAt(i);
  const big = i === P.bigSlice && core > 0.75;
  const temple = !plaza && !big && core > 0.7 && h(i + 1000) < 0.2;
  if (plaza) {
    const half = 11 + r() * 5, sp = sc + (r() - 0.5) * 6, mside = r() < 0.5 ? -1 : 1, mk = pickW(r, S.monument.map((k) => [k, 1]));
    L.plaza = { s: sp, half, side: mside, x0: P.streetHalf + 7 };
    const rad = mk === 'obelisk' || mk === 'trident' ? 2.4 : 3.2;
    L.items.push(item(P, sh, { kind: mk, gen: 'monument', S, s: sp, side: mside, off: TUBE + 0.6 + rad + 2 + r() * 3, W: rad * 2, D: rad * 2, seed: seed(), pad: 0.3 }));
    both(sp - half, sp + half, P.front + 14);
  }
  if (big) {
    const side = r() < 0.5 ? -1 : 1, R = 13 + r() * 5;
    L.items.push(item(P, sh, { kind: S.big, gen: 'big', S, s: sc, side, off: P.front + R + 2, W: R * 2, D: R * 2, seed: seed(), row: 0 }));
    reserve(side, sc - R - 2, sc + R + 2);
  }
  if (temple) {
    const side = r() < 0.5 ? -1 : 1, Wt = 14 + r() * 6, Dt = 16 + r() * 8;
    L.items.push(item(P, sh, { kind: S.temple, gen: 'temple', S, s: sc, side, off: P.front + 1.5 + Dt / 2, W: Wt, D: Dt, seed: seed(), row: 0 }));
    reserve(side, sc - Wt / 2 - 2, sc + Wt / 2 + 2);
  }
  // building lots: one row along the street, a second row behind it
  const outskirts = core < 0.55;
  for (const side of [-1, 1]) for (let row = 1; row <= (outskirts || !P.side2 ? 1 : 2); row++) {
    let u = s0 + 1 + r() * 3;
    while (u < s1 - 4) {
      const kind = row === 2 && r() < 0.5 ? (r() < 0.6 ? 'house' : pickW(r, S.kinds)) : pickW(r, S.kinds);
      const mixed = P.mix && r() < 0.1;
      const St = mixed ? P.mix : S;
      const k2 = St.kinds.some((e) => e[0] === kind) ? kind : 'house';
      const dm = DIMS[k2] || DIMS.house;
      const Wl = dm[0] + r() * (dm[1] - dm[0]), Dl = dm[2] + r() * (dm[3] - dm[2]);
      const sa = u, sb = u + Wl;
      u = sb + 1.2 + r() * 3.5 / P.density;
      if (sb > s1 - 1) break;
      const off = row === 1 ? P.front + Dl / 2 : P.front + 12.5 + r() * 2 + Dl / 2;
      let hit = false;
      for (const [ra, rb, lat] of res[side]) if (sb > ra && sa < rb && (row === 1 || off - Dl / 2 < lat)) { hit = true; break; }
      if (hit) continue;
      if (r() > (outskirts ? 0.35 : P.density * (row === 2 ? 0.8 : 0.95))) { // an empty lot: silted over, or a stairway up the terrace
        if (row === 1 && !outskirts && r() < 0.35) L.items.push(item(P, sh, { kind: 'stairway', gen: 'lot', S, s: (sa + sb) / 2, side, off: P.front + 6, W: 3 + r() * 2.5, D: 12, seed: seed(), row: 1 }));
        continue;
      }
      L.items.push(item(P, sh, { kind: k2, gen: 'lot', S: St, s: (sa + sb) / 2, side, off, W: Wl, D: Dl, seed: seed(), row, decayK: outskirts ? 0.35 : 0 }));
    }
  }
  return L;
}

// all plan items whose footprint may reach [s0, s1)
export function itemsNear(P, seq, s0, s1, out = []) {
  const seg = P.seg, a = Math.max(0, Math.floor((s0 - seg.start - 30) / SL)), b = Math.min(P.n - 1, Math.floor((s1 - seg.start + 30) / SL));
  for (let i = a; i <= b; i++) for (const it of slice(P, seq, i).items) if (it.s + it.R > s0 && it.s - it.R < s1) out.push(it);
  return out;
}

// is (x, s) within r of a planned structure? (hollow buildings let small things sit inside their rooms)
export function blocked(items, x, s, r, inside = false) {
  for (const it of items) {
    const dx = x - it.x, dz = -(s - it.s);
    if (Math.abs(dx) > it.R + r + 30 && !it.cross) continue;
    const lx = it.c * dx - it.sn * dz, lz = it.sn * dx + it.c * dz; // into the item frame (R = rotY(yaw))
    if (Math.abs(lx) > it.hx + r || Math.abs(lz) > it.hz + r) continue;
    if (inside && it.gen === 'lot' && Math.abs(lx) < it.W / 2 - 1.0 - r && Math.abs(lz) < it.D / 2 - 1.0 - r) continue; // inside the rooms
    return true;
  }
  return false;
}

export function planCity(P) { return P.city; }
