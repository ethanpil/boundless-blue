// Shipwrecks. Every wreck segment gets its own freshly built wrecks: a plan per segment (theme, slots,
// kinds, resting states, names; the first set piece within ~60 m of the zone start, then none more than GAP m
// apart: small wrecks or debris fields, the remains of ships that broke up, fill the gaps between the big
// ships) and, per slot, a design lofted and built from its own seed (wreck_types.js,
// wreck_air.js) as one or two templates (whole or broken in two) with the resting state baked in (upright,
// listing, on its side, capsized, half-buried, skeleton, or ends left around a debris field). Builds are
// time-sliced generator jobs (~1 ms per step) pumped by this populator's steps in every chunk (including
// chunks before the segment, so they are ready when the camera arrives); a job that is still missing when its
// chunk needs it is finished on the spot.
// Placement keeps the flight tube clear (low parts may pass under the camera), seats the burial cut below
// the sand, registers tight capsules, labels with facts, feature labels, and 'wreck' / 'treasure' / 'arch'
// POIs; debris fields, sea fans and sponges on the hulls, treasure, bells and container spills follow.
import { Batch, T, TAU, TUBE, LOW_GAP, sstep, lerp, floorSampler, presence, placedPoints, rotX, rotY, mul3, orient, budgetK, bendSpots, tierK, poi } from './core.js';
import { putFloor, pickW, tintFrom, putBend, clusterer, groundY, microSteps, steps } from './scatter.js';
import { MAT } from './materials.js';
import { mulberry32 } from '../noise.js';
import { make, pickCond, freighter, galleon } from './wreck_types.js';
import { sailship, tug, trawler, destroyer, yacht, paddle, section, smallBoat } from './wreck_types2.js';
import { submarine, fighter, bomber, seaplane } from './wreck_air.js';
import { initDebris } from './wreck_debris.js';

// ---------- kinds ----------
// conds: resting-state weights; big: a main slot (else a small slot, which may lie under the flight path when low);
// family: debris palette around it; air: aircraft (random heading)
export const KINDS = {
  freighter: { make: freighter, conds: { upright: 3, list: 3, side: 1, broken: 2.2, buried: 1, capsized: 0.4, scattered: 1 }, big: true, family: 'steel' },
  galleon: { make: galleon, conds: { upright: 1.5, list: 2, buried: 2, skeleton: 2.5, broken: 1 }, big: true, family: 'wood' },
  schooner: { make: (r, o) => sailship(r, o, false), conds: { upright: 2, list: 3, side: 2, buried: 1.5, broken: 0.8 }, big: true, family: 'wood' },
  brig: { make: (r, o) => sailship(r, o, true), conds: { upright: 2, list: 2.5, buried: 2, side: 1, broken: 1 }, big: true, family: 'wood' },
  tug: { make: tug, conds: { upright: 3, list: 3, side: 1.5, capsized: 0.5, scattered: 0.4 }, big: true, family: 'steel' },
  trawler: { make: trawler, conds: { upright: 3, list: 3, side: 1.5, buried: 1, capsized: 0.4, scattered: 0.6 }, big: true, family: 'steel' },
  destroyer: { make: destroyer, conds: { upright: 1.5, list: 2, side: 1, broken: 3.5, capsized: 0.5, scattered: 0.6 }, big: true, family: 'steel' },
  paddle: { make: paddle, conds: { upright: 2.5, list: 2, buried: 2 }, big: true, family: 'wood' },
  tanker: { make: (r, o) => section(r, o, false), conds: { upright: 3, list: 2, side: 0.6 }, big: true, family: 'steel' },
  container: { make: (r, o) => section(r, o, true), conds: { upright: 2, list: 3 }, big: true, family: 'steel' },
  submarine: { make: submarine, conds: { upright: 3, list: 3, broken: 1.5, buried: 1, side: 0.5 }, big: true, family: 'steel' },
  yacht: { make: yacht, conds: { side: 5, list: 2, upright: 1 }, big: false, family: 'light' },
  fighter: { make: fighter, conds: { upright: 4, list: 2, capsized: 1.5, broken: 1.2 }, big: false, family: 'light', air: true },
  bomber: { make: bomber, conds: { upright: 4, list: 2, capsized: 0.8, broken: 1.5 }, big: false, family: 'light', air: true },
  seaplane: { make: seaplane, conds: { upright: 4, list: 2, capsized: 1 }, big: false, family: 'light', air: true },
  rowboat: { make: (r, o) => smallBoat(r, o, 'rowboat'), conds: { upright: 3, capsized: 2, side: 1.5, buried: 1.5 }, big: false, family: 'light' },
  longboat: { make: (r, o) => smallBoat(r, o, 'longboat'), conds: { upright: 3, capsized: 1.5, side: 1.5, buried: 2 }, big: false, family: 'light' },
  lifeboat: { make: (r, o) => smallBoat(r, o, 'lifeboat'), conds: { upright: 3, capsized: 2, side: 1.5, buried: 1.5 }, big: false, family: 'light' },
  dinghy: { make: (r, o) => smallBoat(r, o, 'dinghy'), conds: { upright: 3, capsized: 2.5, side: 1.5 }, big: false, family: 'light' },
  skiff: { make: (r, o) => smallBoat(r, o, 'skiff'), conds: { upright: 3, capsized: 2, side: 1.5 }, big: false, family: 'light' },
};
export function designFor(kind, seed, o = {}) {
  const K = KINDS[kind], r = mulberry32(seed >>> 0);
  let cond = o.cond;
  if (!cond) {
    const w = { ...K.conds };
    if (o.hero) { delete w.skeleton; delete w.capsized; delete w.scattered; if (w.side) w.side *= 0.5; }
    cond = pickCond(r, w);
  }
  const d = K.make(r, { ...o, seed: seed >>> 0, cond });
  d.tier = o.tier;
  return d;
}

// ---------- startup ----------
export function initWreck() {
  // the hull templates are generated per segment; these keys stay for the overlay naming pass in index.js
  T.ship = { wood: [], woodBow: [], woodStern: [], steel: [], steelBow: [], steelStern: [], plane: [], sub: [] };
  initDebris();
}

// ---------- names ----------
const N = {
  steel: ['Meridian', 'Halcyon', 'Northern Star', 'Calliope', 'Kestrel', 'Belmont', 'Celeste', 'Pacific Dawn', 'Marisol', 'Ostrava', 'Cape Lindsay', 'Albatross', 'Thornaby', 'Glenarm', 'Port Elliot', 'Ravenscraig', 'Wanderer', 'Corinthia', 'Elsinore', 'Highland Rose', 'Antares', 'Kittiwake', 'Ardmore', 'Silver Fern'],
  sail: ['Hesperus', 'Mary Ellen', 'Lizzie May', 'Annie B. Cole', 'Dauntless', 'Swift', 'Sea Witch', 'Endeavour', 'Charlotte', 'Polly', 'Resolute', 'Sarah Jane', 'Grace Darling', 'Lark', 'Industry', 'Nancy', 'Brothers'],
  tug: ['Hercules', 'Samson', 'Margaret Moran', 'Titan', 'Bulldog', 'Neptune', 'Goliath', 'Ajax', 'Stalwart', 'Tenacious'],
  boat: ['Sea Breeze', 'Wanderlust', 'Second Wind', 'Blue Heron', 'Serenity', 'Moonshadow', 'Salty Dog', 'Island Time', 'Kingfisher', 'Halcyon Days'],
  fish: ['Northern Pride', 'Ocean Harvest', 'Sea Hunter', 'Morning Star', 'Provider', 'Lady Jean', 'Silver Spray', 'Bonnie Lass', 'Atlantic Rover', 'Good Hope'],
  navy: ['Halford', 'Brannock', 'Kessler', 'Moreland', 'Whitcombe', 'Strathmore', 'Penrose', 'Dalgety', 'Ashworth', 'Corvell'],
};
const namer = (r, used) => (list) => { let n; for (let t = 0; t < 8 && (!n || used.has(n)); t++) n = list[(r() * list.length) | 0]; used.add(n); return n; };
function nameFor(d, r, used) {
  const pick = namer(r, used);
  const y = d.year ? ` (${d.year})` : '';
  switch (d.kind) {
    case 'galleon': return `Galleon ${d.name}${y}`;
    case 'freighter': return `${d.label === 'Steam freighter' ? 'SS' : 'MV'} ${pick(N.steel)}${y}`;
    case 'brig': return `Brig ${pick(N.sail)}${y}`;
    case 'schooner': return `Schooner ${pick(N.sail)}${y}`;
    case 'tanker': return `Tanker ${pick(N.steel)}${y}`;
    case 'container': return `Container ship ${pick(N.steel)}${y}`;
    case 'tug': return `Tug ${pick(N.tug)}${y}`;
    case 'trawler': return `Trawler ${pick(N.fish)}${y}`;
    case 'destroyer': return `Destroyer ${pick(N.navy)}${y}`;
    case 'yacht': return `Yacht ${pick(N.boat)}${y}`;
    case 'paddle': return `Paddle steamer ${pick(N.sail)}${y}`;
    default: return d.name ? `${d.label} ${d.name}${y}` : `${d.label}${y}`;
  }
}
// the ship whose scattered remains a debris field is (kind: a big kind of the theme, for the right flavour)
function remainsName(fam, kind, r, used) {
  const pick = namer(r, used);
  if (fam === 'wood') return `${['brig', 'schooner', 'barque', 'brigantine'][(r() * 4) | 0]} ${pick(N.sail)}`;
  if (kind === 'tug') return `tug ${pick(N.tug)}`;
  if (kind === 'trawler') return `trawler ${pick(N.fish)}`;
  if (kind === 'destroyer') return `destroyer ${pick(N.navy)}`;
  return `${r() < 0.6 ? 'SS' : 'steamer'} ${pick(N.steel)}`;
}

// ---------- generation queue ----------
const Q = { jobs: [], ms: 0, made: 0, sync: 0, maxStep: 0, slow: {} };
// debug: slowest layout step per kind (ms)
const timed = (name, f) => () => { const a = performance.now(); f(); const d = performance.now() - a; if (d > (Q.slow[name] || 0)) Q.slow[name] = +d.toFixed(2); };
if (typeof window !== 'undefined') window.__wreckGen = Q;
function stepJob(j) {
  const t0 = performance.now();
  if (!j.gen) j.gen = j.factory();
  const r = j.gen.next();
  const dt = performance.now() - t0;
  Q.ms += dt; if (dt > Q.maxStep) Q.maxStep = dt;
  if (r.done) { j.out = r.value; j.done = true; Q.made++; }
}
function pump(ms) {
  const t0 = performance.now();
  while (Q.jobs.length && performance.now() - t0 < ms) {
    const j = Q.jobs[0];
    stepJob(j);
    if (j.done) Q.jobs.shift();
  }
}
function need(j) { // finish a job now (its chunk is being built)
  if (j.done) return j.out;
  Q.sync++;
  while (!j.done) stepJob(j);
  const k = Q.jobs.indexOf(j);
  if (k >= 0) Q.jobs.splice(k, 1);
  return j.out;
}

// ---------- per-segment plans ----------
const THEMES = [
  { name: 'galleon graveyard', big: ['galleon', 'galleon', 'brig'], small: ['rowboat', 'longboat', 'rowboat'], chest: 0.75, bell: 0.7, w: 1 },
  { name: 'age of sail', big: ['schooner', 'brig', 'galleon'], small: ['rowboat', 'dinghy', 'longboat'], chest: 0.3, bell: 0.6, w: 1 },
  { name: 'WWII battle', big: ['destroyer', 'freighter', 'submarine'], small: ['fighter', 'bomber', 'seaplane', 'fighter'], chest: 0, bell: 0.4, w: 1.3 },
  { name: 'merchant graveyard', big: ['freighter', 'tanker', 'container', 'freighter'], small: ['tug', 'lifeboat'], chest: 0, bell: 0.3, w: 1.1 },
  { name: 'fishing harbour', big: ['trawler', 'tug', 'trawler'], small: ['yacht', 'dinghy', 'skiff', 'rowboat'], chest: 0, bell: 0.3, w: 1 },
  { name: 'paddle-steamer days', big: ['paddle', 'schooner', 'freighter'], small: ['rowboat', 'lifeboat'], chest: 0.2, bell: 0.5, w: 0.7 },
  { name: 'aircraft graveyard', big: ['freighter', 'bomber', 'seaplane'], small: ['fighter', 'fighter', 'bomber'], chest: 0, bell: 0.2, w: 0.7 },
  { name: 'mixed wrecks', big: null, small: null, chest: 0.35, bell: 0.5, w: 1.2 },
];
const plans = new Map();
if (typeof window !== 'undefined') window.__wreckPlans = plans; // debug: per-segment plans (slots, pieces)
const pathYaw = (ctx, s) => Math.atan2(-(ctx.pathX(s + 12) - ctx.pathX(s - 12)), 24);
const avail = (list) => (list || []).filter((k) => KINDS[k]);
const bigKinds = () => Object.keys(KINDS).filter((k) => KINDS[k].big);
const smallKinds = () => Object.keys(KINDS).filter((k) => !KINDS[k].big);
// Set pieces along a wreck zone: the first within ~60 m of where the zone begins for the viewer, then never more
// than GAP m (slot to slot) to the next, so the camera always has a wreck, or a wreck's remains, coming up.
const GAP = 110;

function segmentPlan(ctx, seg) {
  let L = plans.get(seg.id);
  if (L && L.seed === seg.seed) return L;
  const rng = mulberry32(seg.seed ^ 0x5eed);
  let tw = 0; for (const t of THEMES) tw += t.w;
  let x = rng() * tw, theme = THEMES[THEMES.length - 1];
  for (const t of THEMES) { x -= t.w; if (x <= 0) { theme = t; break; } }
  // the zone begins at seg.start (half way through the cross-fade); a dive that starts in this zone (the
  // sequence's first segment, see BiomeSequence._push) starts 200 m into it
  const z0 = seg.id === 0 ? seg.start + 200 : seg.start, zEnd = seg.end - 15;
  const slots = [], lo = Math.max(seg.start + 140, z0 + 60), hi = seg.end - 140;
  if (hi > lo) {
    const n = 2 + (rng() < 0.55 ? 1 : 0), big = avail(theme.big).length ? avail(theme.big) : bigKinds(), small = avail(theme.small).length ? avail(theme.small) : smallKinds();
    for (let i = 0; i < n; i++) slots.push({ s: lerp(lo, hi, n === 1 ? 0.5 : i / (n - 1)) + (rng() - 0.5) * 40, big: true });
    // the hero wreck (slot 0) goes where the path is straightest so it can lie close alongside
    let bc = 1e9;
    for (let k = 0; k < 16; k++) {
      const c = lerp(lo, Math.min(hi, lo + (hi - lo) * 0.45), k / 15);
      const curv = Math.abs(ctx.pathX(c + 22) - 2 * ctx.pathX(c) + ctx.pathX(c - 22));
      if (curv < bc) { bc = curv; slots[0].s = c; }
    }
    // small wrecks (aircraft, boats) and the remains of ships that broke up (field) fill in: each goes into
    // the widest gap left (the zone's end counts as a boundary)
    const widest = () => {
      const s = slots.map((q) => q.s).sort((a, b) => a - b);
      s.push(zEnd);
      let g = 0, at = 0;
      for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > g) { g = s[i] - s[i - 1]; at = s[i - 1]; }
      return [at, g];
    };
    const fill = (field) => { const [a, g] = widest(); slots.push({ s: a + g * (0.5 + (rng() - 0.5) * 0.3), big: false, field }); };
    if (!slots.some((q) => q.s <= z0 + 60)) slots.push({ s: z0 + 42 + rng() * 18, big: false, field: rng() < 0.5 }); // wreck weight >= 0.84 there
    for (let i = 0, m = 1 + Math.floor(rng() * 3); i < m; i++) fill(false);
    for (let k = 0; k < 12 && widest()[1] > GAP; k++) fill(rng() < 0.6);
    const used = new Set(), foot = [];
    slots.forEach((sl, i) => {
      if (sl.field) { // no hull: a trail of the heaviest parts (boilers or ballast, frames, plates) on the bottom
        const fk = big[(rng() * big.length) | 0], fam = theme.big ? (KINDS[fk].family === 'wood' ? 'wood' : 'steel') : rng() < 0.5 ? 'wood' : 'steel';
        Object.assign(sl, { i, kind: 'remains', fam, hero: false, side: rng() < 0.5 ? -1 : 1, k: (rng() * 1e9) | 0, pieces: null, job: null, used, foot });
        sl.name = remainsName(fam, fk, mulberry32(sl.k ^ 0x51), used);
        return;
      }
      const pool = sl.big ? big : small;
      const kind = theme.big ? pool[i % pool.length] : pool[(rng() * pool.length) | 0];
      Object.assign(sl, {
        i, kind: KINDS[kind] ? kind : 'freighter', hero: i === 0, side: rng() < 0.5 ? -1 : 1, seed: (rng() * 4294967295) >>> 0, pieces: null, job: null,
        yawX: (rng() - 0.5) * (i === 0 ? 0.12 : 0.6) + (rng() < 0.3 ? Math.PI : 0), gapOK: rng() < 0.5, k: (rng() * 1e9) | 0,
        // a bell only on ships (not aircraft or small boats)
        chest: rng() < (theme.chest || 0), bell: rng() < (theme.bell || 0) && !!(KINDS[kind] || KINDS.freighter).big, used, foot,
      });
    });
  }
  L = { seed: seg.seed, theme, slots, seg };
  plans.set(seg.id, L);
  // drop plans (and their templates / pending jobs) of segments far behind
  if (plans.size > 5) {
    const [k0, p0] = plans.entries().next().value;
    plans.delete(k0);
    for (const sl of p0.slots) if (sl.job && !sl.job.done) { const q = Q.jobs.indexOf(sl.job); if (q >= 0) Q.jobs.splice(q, 1); }
  }
  return L;
}
function jobOf(ctx, sl) {
  if (sl.job || sl.field) return sl.job; // a debris field has no hull to build
  const tier = ctx.tier;
  sl.job = {
    factory: function* () {
      const d = designFor(sl.kind, sl.seed, { hero: sl.hero, tier });
      yield;
      const pieces = yield* make(d);
      for (const t of pieces) { probe(t); t.points(90); t.points(200); yield; }
      const r = mulberry32(sl.seed ^ 77);
      sl.design = { kind: d.kind, label: d.label, year: d.year };
      sl.name = nameFor(d, r, sl.used);
      sl.fact = d.facts[(r() * d.facts.length) | 0];
      sl.debris = d.debris || null;
      return pieces;
    }, gen: null, done: false, out: null,
  };
  Q.jobs.push(sl.job);
  return sl.job;
}

// ---------- placement ----------
// path samples every 2 m (linear in between: well under a centimetre off on these gentle curves)
function pathTable(ctx, a, b) {
  const n = Math.ceil((b - a) / 2) + 2, X = new Float32Array(n), Y = new Float32Array(n);
  for (let i = 0; i < n; i++) { X[i] = ctx.pathX(a + i * 2); Y[i] = ctx.pathY(a + i * 2); }
  return { a, n, X, Y };
}
// every point keeps TUBE + margin from the path line, or stays LOW_GAP below the camera
function clearT(P, pts, margin) {
  const lim = (TUBE + margin) * (TUBE + margin);
  for (let i = 0; i < pts.length; i += 3) {
    const u = Math.min(P.n - 1.001, Math.max(0, (pts[i + 2] - P.a) / 2)), k = Math.floor(u), f = u - k;
    const py = P.Y[k] + (P.Y[k + 1] - P.Y[k]) * f;
    if (pts[i + 1] < py - LOW_GAP - 0.2) continue;
    const dx = pts[i] - (P.X[k] + (P.X[k + 1] - P.X[k]) * f), dy = pts[i + 1] - py;
    if (dx * dx + dy * dy < lim) return false;
  }
  return true;
}
// silhouette probe points of a template: per 2 m slice along z and 16 sectors around it, the farthest vertex
// (so masts, yards and davits are tested, not only an even subsample)
function probe(tpl) {
  if (tpl._probe) return tpl._probe;
  const P = tpl.pos, [, y0, z0, , y1] = tpl.box, cy = (y0 + y1) / 2, best = new Map();
  for (let i = 0; i < tpl.vc; i++) {
    const x = P[i * 3], y = P[i * 3 + 1] - cy, z = P[i * 3 + 2];
    const k = Math.floor((z - z0) / 2) * 16 + ((Math.floor((Math.atan2(y, x) / TAU + 0.5) * 16)) & 15), d = x * x + y * y, e = best.get(k);
    if (!e || d > e[0]) best.set(k, [d, i]);
  }
  const out = [];
  for (const [, i] of best.values()) out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  for (const p of tpl.points(240)) out.push(p);
  return (tpl._probe = out);
}
function probePts(tpl, x, y, s, R) {
  const p = probe(tpl), out = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = R[0] * p[i] + R[1] * p[i + 1] + R[2] * p[i + 2] + x;
    out[i + 1] = R[3] * p[i] + R[4] * p[i + 1] + R[5] * p[i + 2] + y;
    out[i + 2] = s - (R[6] * p[i] + R[7] * p[i + 1] + R[8] * p[i + 2]);
  }
  return out;
}
// Footprints (oriented rectangles in x, s: centre c, unit-ish axes u, v, half extents hu, hv) of a plan's placed
// pieces and debris fields, so the wrecks of two slots are never laid into each other.
function overlaps(A, list, si, m = 1.5) {
  for (const B of list) {
    if (B.sl === si) continue;
    const dx = B.c[0] - A.c[0], ds = B.c[1] - A.c[1], far = A.hu + A.hv + B.hu + B.hv + m;
    if (dx * dx + ds * ds > far * far) continue;
    let sep = false;
    for (const ax of [A.u, A.v, B.u, B.v]) { // separating axis test
      const l = Math.hypot(ax[0], ax[1]) || 1, nx = ax[0] / l, ns = ax[1] / l;
      const pa = Math.abs(A.u[0] * nx + A.u[1] * ns) * A.hu + Math.abs(A.v[0] * nx + A.v[1] * ns) * A.hv;
      const pb = Math.abs(B.u[0] * nx + B.u[1] * ns) * B.hu + Math.abs(B.v[0] * nx + B.v[1] * ns) * B.hv;
      if (Math.abs(dx * nx + ds * ns) > pa + pb + m) { sep = true; break; }
    }
    if (!sep) return true;
  }
  return false;
}
const footOf = (c, R, box) => ({ c: [c[0], c[2]], u: [R[0], -R[6]], v: [R[2], -R[8]], hu: (box[3] - box[0]) / 2, hv: (box[5] - box[2]) / 2 });
// seat a piece on the floor: yaw about the path, pitch along its own axis; the burial cut lies below the sand.
// sl: its slot (footprints of the plan's other slots are kept clear)
function placePiece(ctx, fl, P, tpl, s, off, yaw, step = 1.6, tries = 24, sl = null) {
  const bx = -Math.sin(yaw), bs = Math.cos(yaw), half = Math.max(4, (tpl.box[5] - tpl.box[2]) * 0.4);
  const [x0, y0, z0, x1, y1, z1] = tpl.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  for (let t = 0; t < tries; t++) {
    const d = off + (t === 0 ? 0 : (Math.sign(off) || (t % 2 ? 1 : -1)) * Math.ceil(t / (off ? 1 : 2)) * step);
    const x = ctx.pathX(s) + d;
    const fA = fl.at(x - bx * half, s - bs * half), fB = fl.at(x + bx * half, s + bs * half);
    const R = mul3(rotY(yaw), rotX(Math.atan2(fB - fA, 2 * half) * 0.85));
    const y = groundY(fl, x, s, tpl, R, 1, 1, 1) - (tpl.sinkK ?? 0.25);
    const c = [R[0] * cx + R[1] * cy + R[2] * cz + x, R[3] * cx + R[4] * cy + R[5] * cz + y, s - (R[6] * cx + R[7] * cy + R[8] * cz)];
    if (sl && overlaps(footOf(c, R, tpl.box), sl.foot, sl.i)) continue;
    if (!clearT(P, placedPoints(tpl, x, y, s, R, 1, 1, 1, 90), 0.6)) continue; // cheap reject first
    if (!clearT(P, probePts(tpl, x, y, s, R), 0.6)) continue;
    let sMax = -1e9, sMin = 1e9;
    const pts = placedPoints(tpl, x, y, s, R, 1, 1, 1, 200);
    for (let i = 2; i < pts.length; i += 3) { sMax = Math.max(sMax, pts[i]); sMin = Math.min(sMin, pts[i]); }
    return { tpl, x, y, s, R, sMax, sMin, c, r: Math.max(x1 - x0, z1 - z0) / 2, hw: Math.max(-x0, x1), top: y1 };
  }
  return null;
}
const worldOf = (p, v) => [p.R[0] * v[0] + p.R[1] * v[1] + p.R[2] * v[2] + p.x, p.R[3] * v[0] + p.R[4] * v[1] + p.R[5] * v[2] + p.y, p.s - (p.R[6] * v[0] + p.R[7] * v[1] + p.R[8] * v[2])];

// Floor lattice cache for one slot: the terrain mesh nodes (1.5 m across, 64/42 m along, global) with the
// mesh's own triangle split, so seating is exact whichever chunk computes it, at a few lookups per sample.
const DXG = 1.5, DZG = 64 / 42;
function latticeFloor(ctx) {
  const cache = new Map();
  const node = (i, j) => { const k = i * 131071 + j; let v = cache.get(k); if (v === undefined) { v = ctx.floorAt(i * DXG, j * DZG); cache.set(k, v); } return v; };
  return {
    at(x, s) {
      const u = x / DXG, v = s / DZG, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const ha = node(i, j), hb = node(i + 1, j), hc = node(i, j + 1), hd = node(i + 1, j + 1);
      return fu + fv <= 1 ? ha + (hb - ha) * fu + (hc - ha) * fv : hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv);
    },
  };
}

// The remains of a ship that broke up (a field slot): no hull, its heaviest parts (boilers, or the ballast
// pile, named after the ship) and a trail of frames, plates and fittings along the line it lay on, beside the path.
function fieldPieces(ctx, sl) {
  const rng = mulberry32(sl.k), sp = specs(), wood = sl.fam === 'wood';
  const a = Math.PI / 2 + (rng() - 0.5) * 1.2, ca = Math.cos(a), sa = Math.sin(a); // the line, in (x, s): mostly along the path
  const hl = 7 + rng() * 6, hw = 2.5 + rng() * 2, cs = sl.s, off = TUBE + 2.5 + hw + rng() * 5;
  const foot = (cx) => ({ sl: sl.i, c: [cx, cs], u: [ca, sa], v: [-sa, ca], hu: hl + 1, hv: hw + 1 });
  let cx = ctx.pathX(cs) + sl.side * off;
  for (let t = 1; t < 10 && overlaps(foot(cx), sl.foot, sl.i); t++) cx = ctx.pathX(cs) + sl.side * (off + t * 2.5);
  sl.foot.push(foot(cx));
  const at = (u, v) => [cx + ca * u - sa * v, cs + sa * u + ca * v]; // u along the line, v across it
  sl.extras = [];
  for (let q = 0, n = wood || rng() < 0.6 ? 1 : 2; q < n; q++) {
    const p = at((rng() - 0.5) * hl * 0.5 + (q ? hl * 0.45 : 0), (rng() - 0.5) * hw * 0.4);
    sl.extras.push({ type: 'debris', k: wood ? 'ballast' : 'boiler', x: p[0], s: p[1], big: true, lbl: (wood ? 'Ballast stones of the ' : 'Boiler of the ') + sl.name });
  }
  for (let q = 0, n = Math.round((14 + rng() * 8) * tierK(ctx)); q < n; q++) {
    const u = (rng() * 2 - 1) * hl, p = at(u, (rng() * 2 - 1) * hw * Math.sqrt(1 - 0.7 * (u / hl) ** 2));
    sl.extras.push({ type: 'debris', k: pickW(rng, wood ? sp.remWood : sp.remSteel).k, x: p[0], s: p[1] });
  }
  sl.site = { x: cx, s: cs, r: hl };
  return (sl.pieces = []);
}

// place a slot's pieces (once): whole, broken halves (maybe a gap the camera threads), aircraft, small boats
function slotPieces(ctx, gnd, sl) {
  if (sl.pieces) return sl.pieces;
  if (sl.field) return fieldPieces(ctx, sl);
  const tpls = need(jobOf(ctx, sl)) || [];
  sl.extras = [];
  const tp0 = performance.now();
  const rng = mulberry32(sl.k), s = sl.s, side = sl.side, P = pathTable(ctx, s - 90, s + 90), out = [];
  const fl = latticeFloor(ctx); // floor mesh only: identical whichever chunk computes it
  const yaw0 = pathYaw(ctx, s);
  const push = (p, lbl) => { if (p) { p.lbl = lbl; out.push(p); } return p; };
  const lat = (t) => Math.max(-t.box[0], t.box[3]); // half extent across the template's axis
  if (tpls.length === 2) {
    // A: the piece whose broken end is at template +z, B: at -z (bow/stern for hulls, front/tail for bodies)
    const A = tpls[0].cutEnd > 0 ? tpls[0] : tpls[1], B = A === tpls[0] ? tpls[1] : tpls[0];
    if (sl.gapOK && !sl.hero && KINDS[sl.kind] && KINDS[sl.kind].big && sl.kind !== 'galleon') { // broken across the path: the camera threads the gap
      const a = push(placePiece(ctx, fl, P, A, s, side * (TUBE + 1.2 + Math.max(0, A.box[5])), yaw0 - side * Math.PI / 2 + (rng() - 0.5) * 0.15, 0.6, 24, sl), sl.name + ', ' + A.part);
      const b = push(placePiece(ctx, fl, P, B, s + (rng() - 0.5) * 3, -side * (TUBE + 1.2 + Math.max(0, -B.box[2])), yaw0 + side * Math.PI / 2 + (rng() - 0.5) * 0.3, 0.6, 24, sl), sl.name + ', ' + B.part);
      if (a && b) sl.arch = { x: ctx.pathX(s), y: ctx.pathY(s), s };
    } else { // the two pieces lie a little apart along the same line, the broken ends facing each other
      const off = side * (Math.max(lat(A), lat(B)) + TUBE + 1.5 + (sl.hero ? 0.5 : rng() * 6));
      const yaw = yaw0 + sl.yawX, fwd = Math.cos(sl.yawX) >= 0 ? 1 : -1, gap = tpls.gap ? tpls.gap * (0.8 + rng() * 0.3) : 2 + rng() * 7;
      if (tpls.gap) { // a field of wreckage where the middle of the ship used to be: boilers, plates, girders
        const kinds = ['boiler', 'girder', 'plate', 'fragSteel', 'girder', 'plate', 'drum', 'cowl', 'gas', 'fragSteel'];
        for (let q = 0, n = Math.round(gap / 2.2); q < n; q++) {
          const t = (q + 0.5) / n - 0.5, k = q === Math.floor(n / 2) || (q === Math.floor(n / 3) && rng() < 0.6) ? 'boiler' : kinds[(rng() * kinds.length) | 0];
          sl.extras.push({ type: 'debris', k, x: ctx.pathX(s) + off + (rng() - 0.5) * lat(A) * 3, s: s + fwd * t * gap + (rng() - 0.5) * 3 });
        }
      }
      // template -z points along +s for yaw ~ yaw0: A (broken end +z) lies ahead of the break, B behind it
      push(placePiece(ctx, fl, P, A, s + fwd * (A.box[5] + gap / 2), off, yaw + (rng() - 0.5) * 0.4, 1.6, 24, sl), sl.name + ', ' + A.part);
      push(placePiece(ctx, fl, P, B, s + fwd * (B.box[2] - gap / 2), off + side * rng() * 5, yaw + (rng() - 0.5) * 0.7, 1.6, 24, sl), sl.name + ', ' + B.part);
    }
  } else if (tpls.length === 1) {
    const t = tpls[0], low = t.box[4] - t.box[1] < 3.2;
    const off = low && !sl.hero && rng() < 0.6 ? (rng() - 0.5) * 4 : side * (lat(t) + TUBE + 1.0 + (sl.hero ? 0.4 : rng() * 7));
    const yaw = yaw0 + (KINDS[sl.kind] && KINDS[sl.kind].air ? rng() * TAU : sl.yawX);
    push(placePiece(ctx, fl, P, t, s, off, yaw, sl.hero ? 0.6 : 1.4, 24, sl), sl.name);
  }
  // delights around the wreck, placed by whichever chunk contains them
  const h = out[0];
  if (h) {
    const away = h.c[0] > ctx.pathX(h.c[2]) ? 0 : Math.PI; // the far side, away from the camera line
    if (sl.chest) { const a = away + (rng() - 0.5) * 1.6, r = h.r * 0.6 + 3 + rng() * 4; sl.extras.push({ type: 'chest', x: h.c[0] + Math.cos(a) * r, s: h.c[2] + Math.sin(a) * r }); }
    if (sl.bell) { const a = rng() * TAU, r = h.r * 0.5 + 2 + rng() * 3; sl.extras.push({ type: 'bell', x: h.c[0] + Math.cos(a) * r, s: h.c[2] + Math.sin(a) * r }); }
  }
  if (sl.kind === 'container') { // spilled cargo, some stacked
    const cx = (h ? h.c[0] : ctx.pathX(s)) + side * (8 + rng() * 6), n = 10 + Math.floor(rng() * 8);
    for (let q = 0; q < n; q++) sl.extras.push({ type: 'container', x: cx + (rng() - 0.5) * 24, s: s + (rng() - 0.5) * 40, stack: rng() < 0.35, k: (rng() * 1e9) | 0 });
    sl.cargo = { x: cx, s };
    sl.foot.push({ sl: sl.i, c: [cx, s], u: [1, 0], v: [0, 1], hu: 15, hv: 23 });
  }
  for (const p of out) sl.foot.push({ sl: sl.i, ...footOf(p.c, p.R, p.tpl.box) });
  sl.pieces = out;
  const dt = performance.now() - tp0;
  if (dt > (Q.slow.place || 0)) Q.slow.place = +dt.toFixed(2);
  return out;
}

// ---------- debris specs ----------
const S = {};
export function specs() {
  if (S.rock) return S;
  const D = T.debris, w = tintFrom([[1, 1, 1]]);
  Object.assign(S, {
    rock: { tpl: T.rocks, scale: [0.5, 1.6], ys: [0.7, 1.3], xz: 0.5, grow: [0.1, 1.5], follow: 0.5, occ: 0.6, tint: tintFrom([[0.42, 0.41, 0.38]]) },
    barrel: { tpl: D.barrel, scale: [0.9, 1.1], follow: 0.7, tilt: 0.3, occ: 0.8, tint: w },
    drum: { tpl: D.drum, scale: [0.9, 1.1], follow: 0.7, tilt: 0.3, occ: 0.8, tint: tintFrom([[1, 1, 1], [0.6, 0.7, 0.8]]) },
    crate: { tpl: D.crate, scale: [0.8, 1.2], follow: 0.8, tilt: 0.4, sink: 0.15, occ: 0.8, tint: w },
    cannon: { tpl: D.cannon, scale: [0.9, 1.1], follow: 0.8, tilt: 0.1, sink: 0.25, occ: 0.7, tint: w },
    shot: { tpl: D.shot, scale: [0.9, 1.2], follow: 0.9, sink: 0.05, occ: 0.6, tint: w },
    ballast: { tpl: D.ballast, scale: [0.8, 1.3], follow: 0.95, sink: 0.12, occ: 0.6, tint: tintFrom([[1, 1, 1], [0.9, 0.85, 0.8]]) },
    anchor: { tpl: D.anchor, scale: [0.8, 1.2], follow: 0.8, tilt: 0.2, sink: 0.1, occ: 0.7, tint: w },
    chain: { tpl: D.chain, scale: [0.9, 1.3], follow: 0.9, sink: 0.2, tint: w },
    plank: { tpl: D.plank, scale: [0.8, 1.3], follow: 0.9, sink: 0.2, occ: 0.5, tint: w },
    plate: { tpl: D.plate, scale: [0.6, 1.4], follow: 0.7, tilt: 0.4, sink: 0.2, occ: 0.6, tint: w },
    frag: { tpl: D.frag, scale: [0.8, 1.2], follow: 0.9, tilt: 0.15, sink: 0.12, occ: 0.7, tint: w },
    fragSteel: { tpl: D.fragSteel, scale: [0.8, 1.2], follow: 0.9, tilt: 0.15, sink: 0.12, occ: 0.7, tint: w },
    boiler: { tpl: D.boiler, scale: [0.9, 1.1], follow: 0.4, tilt: 0.1, sink: 0.35, occ: 1, tint: w },
    cowl: { tpl: D.cowl, scale: [0.9, 1.1], follow: 0.7, tilt: 0.2, sink: 0.08, occ: 0.7, tint: w },
    girder: { tpl: D.girder, scale: [0.9, 1.2], follow: 0.9, sink: 0.08, occ: 0.6, tint: w },
    tyre: { tpl: D.tyre, scale: [0.9, 1.1], follow: 0.9, sink: 0.08, occ: 0.6, tint: w },
    bottles: { tpl: D.bottles, scale: [0.9, 1.2], follow: 1, sink: 0.02, tint: w },
    gas: { tpl: D.gas, scale: [0.9, 1.1], follow: 0.9, sink: 0.05, occ: 0.6, tint: w },
    mast: { tpl: D.mast, scale: [0.9, 1.1], follow: 0.1, occ: 0.5, tint: w }, // fallen, heel in the sand (contact band up to the sand line)
    spar: { tpl: D.spar, scale: [0.9, 1.15], follow: 0.9, tilt: 0.04, sink: 0.05, occ: 0.5, tint: w },
    chest: { tpl: T.chest, scale: [1, 1.15], follow: 0.8, tilt: 0.15, sink: 0.08, occ: 1, tint: tintFrom([[1, 1, 1]], 0.06) },
    bell: { tpl: T.bell, scale: [1, 1.2], follow: 0.8, sink: 0.12, tint: tintFrom([[1, 1, 1]], 0.08) },
    coins: { tpl: T.coinSpill, scale: [1, 1.2], tint: tintFrom([[1, 1, 1]], 0.05) },
    container: { tpl: T.container, scale: [1, 1], follow: 0.5, sink: 0.04, support: true, occ: 1, grow: [0.15, 0.3], tint: tintFrom([[1, 1, 1], [0.8, 0.8, 0.8]], 0.1) }, // faint growth film (see growthFilm)
    pebbles: { tpl: T.pebbles, scale: [0.8, 1.6], follow: 1, sink: 0.02, tint: tintFrom([[0.55, 0.45, 0.38], [0.45, 0.32, 0.25]], 0.1) },
    algae: { tpl: T.algae, scale: [0.6, 1.4], follow: 1, sink: 0.01, tint: tintFrom([[0.55, 0.6, 0.4]], 0.1) },
    sponge: { tpl: T.tubeSp, scale: [0.4, 0.9], follow: 0.5, tint: tintFrom([[0.55, 0.35, 0.18], [0.45, 0.25, 0.35], [0.6, 0.5, 0.2]]) },
    fan: { tpl: T.fan, scale: [0.5, 1.1], follow: 0.2, sway: true, tint: tintFrom([[0.5, 0.18, 0.5], [0.65, 0.3, 0.12], [0.7, 0.55, 0.2]]) },
    anem: { tpl: T.anem, scale: [0.6, 1.0], follow: 0.7, sway: true, tint: tintFrom([[0.85, 0.85, 0.85]]) },
  });
  S.wood = [{ w: 2.5, k: 'frag' }, { w: 2.5, k: 'barrel' }, { w: 1.5, k: 'crate' }, { w: 1.8, k: 'cannon' }, { w: 0.8, k: 'shot' }, { w: 1.4, k: 'ballast' }, { w: 0.4, k: 'anchor' }, { w: 0.6, k: 'chain' }, { w: 2.5, k: 'plank' }, { w: 0.6, k: 'bottles' }, { w: 1, k: 'rock' }, { w: 0.8, k: 'sponge' }, { w: 0.5, k: 'fan', sway: true }];
  S.steel = [{ w: 2.5, k: 'fragSteel' }, { w: 2, k: 'drum' }, { w: 1, k: 'crate' }, { w: 0.4, k: 'anchor' }, { w: 1, k: 'chain' }, { w: 2.5, k: 'plate' }, { w: 0.9, k: 'girder' }, { w: 0.5, k: 'cowl' }, { w: 0.35, k: 'boiler' }, { w: 0.5, k: 'gas' }, { w: 0.4, k: 'tyre' }, { w: 1, k: 'rock' }, { w: 0.8, k: 'sponge' }, { w: 0.5, k: 'anem', sway: true }];
  S.light = [{ w: 2, k: 'plate' }, { w: 1, k: 'fragSteel' }, { w: 0.8, k: 'gas' }, { w: 0.5, k: 'tyre' }, { w: 1, k: 'rock' }, { w: 0.8, k: 'sponge' }, { w: 0.5, k: 'anem', sway: true }];
  S.micro = [{ w: 2, spec: S.pebbles }, { w: 1.2, spec: S.algae }];
  // the remains of a ship that broke up (field slots), around its boilers or ballast pile
  S.remWood = [{ w: 3, k: 'frag' }, { w: 2.5, k: 'plank' }, { w: 1.2, k: 'cannon' }, { w: 1.2, k: 'barrel' }, { w: 0.6, k: 'shot' }, { w: 0.8, k: 'chain' }, { w: 0.35, k: 'anchor' }, { w: 0.6, k: 'crate' }, { w: 0.4, k: 'bottles' }, { w: 0.8, k: 'spar' }, { w: 0.4, k: 'mast' }, { w: 0.5, k: 'sponge' }, { w: 0.4, k: 'fan' }];
  S.remSteel = [{ w: 3, k: 'fragSteel' }, { w: 3, k: 'plate' }, { w: 1.6, k: 'girder' }, { w: 1.2, k: 'drum' }, { w: 0.6, k: 'cowl' }, { w: 0.8, k: 'chain' }, { w: 0.35, k: 'anchor' }, { w: 0.5, k: 'gas' }, { w: 0.5, k: 'crate' }, { w: 0.3, k: 'tyre' }, { w: 0.5, k: 'sponge' }, { w: 0.4, k: 'anem' }];
  S.sparse = [{ w: 1.2, k: 'frag' }, { w: 0.8, k: 'fragSteel' }, { w: 4, k: 'rock' }, { w: 1, k: 'plank' }, { w: 0.6, k: 'drum' }, { w: 0.5, k: 'barrel' }, { w: 0.6, k: 'plate' }, { w: 0.3, k: 'girder' }, { w: 0.6, k: 'sponge' }, { w: 0.4, k: 'anem', sway: true }];
  S.grow = [{ w: 3, k: 'fan', sway: true }, { w: 2.5, k: 'sponge' }, { w: 1.5, k: 'anem', sway: true }];
  return S;
}

// growth on a placed hull: fans, sponges, anemones at its attachment points (rails, sheer line, and the
// plating that faces up when the hull lies on its side or capsized)
function growthOn(ctx, sp, p, rng, sw, st, n) {
  const A = p.tpl.attach;
  if (!A || !A.length) return;
  const used = new Set(), placed = []; // each point once, and no two growths grown into each other
  for (let k = 0; k < n; k++) {
    const ai = (rng() * A.length) | 0;
    if (used.has(ai)) continue;
    used.add(ai);
    const a = A[ai], w = worldOf(p, a.p);
    if (w[2] < ctx.s0 || w[2] >= ctx.s1) continue;
    let near = false;
    for (let q = 0; q < placed.length && !near; q += 3) near = Math.hypot(placed[q] - w[0], placed[q + 1] - w[1], placed[q + 2] - w[2]) < 1.1;
    if (near) continue;
    const nx = p.R[0] * a.n[0] + p.R[1] * a.n[1] + p.R[2] * a.n[2], ny = p.R[3] * a.n[0] + p.R[4] * a.n[1] + p.R[5] * a.n[2], nz = -(p.R[6] * a.n[0] + p.R[7] * a.n[1] + p.R[8] * a.n[2]);
    const e = pickW(rng, sp.grow), spec = sp[e.k], tpl = spec.tpl[(rng() * spec.tpl.length) | 0];
    const sc = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * rng(), l = Math.hypot(nx, ny, nz) || 1;
    const R = orient(nx / l, ny / l, -nz / l, e.k === 'fan' ? 0.2 : 0.8, rng() * TAU);
    const c = spec.tint(rng), b = e.sway ? sw : st;
    // keep it out of the flight tube
    const px = ctx.pathX(w[2]), py = ctx.pathY(w[2]), top = w[1] + tpl.maxY * sc;
    if (Math.hypot(w[0] - px, Math.min(Math.abs(w[1] - py), Math.abs(top - py))) < TUBE + 0.4 + tpl.r * sc) continue;
    if (b.add(tpl, w[0], w[1] - 0.04 * sc, -(w[2] - ctx.s0), R, sc, sc, sc, c[0], c[1], c[2], sc)) placed.push(w[0], w[1], w[2]);
  }
}

export function layoutWreck(ctx) {
  // look ahead: plan the wreck segments coming up and queue their builds
  for (let s = ctx.s0; s <= ctx.s1 + 460; s += 60) for (const e of ctx.weights(s)) if (e.key === 'wreck' && e.g) { const pl = segmentPlan(ctx, e.g); for (const sl of pl.slots) jobOf(ctx, sl); }
  const pumpSteps = [];
  for (let k = 0; k < Math.min(24, Q.jobs.length * 6); k++) pumpSteps.push(() => pump(0.95));
  if (presence(ctx, 'wreck') <= 0) return pumpSteps.length ? { batches: [], more: pumpSteps } : null;
  const sp = specs(), rng = ctx.rng, fs = floorSampler(ctx), bk = budgetK(ctx, 'wreck'), tk = tierK(ctx);
  const ships = new Batch(MAT.static, 160000), st = new Batch(MAT.static, 16000 * bk);       // hulls; big pieces, delights
  const mid = new Batch(MAT.static, 34000 * bk * tk, 'mid'), sw = new Batch(MAT.sway, 9000 * bk * tk, 'mid'); // debris field, growth
  const near = new Batch(MAT.static, 12000 * bk * tk, 'near');                                // floor micro detail
  const idx = Math.floor(ctx.s0 / 64), inChunk = (s) => s >= ctx.s0 && s < ctx.s1, more = [];
  const extra = (sl, e) => () => {
    if (e.type === 'chest') {
      if (putFloor(ctx, fs, st, sp.chest, e.x, e.s, rng)) {
        const it = st.last, yaw = Math.atan2(it.R[2], it.R[0]), f = it.tpl.front * it.sx + 0.05;
        putFloor(ctx, fs, st, { ...sp.coins, yaw, yawJ: 0.2 }, e.x + it.R[2] * f, e.s - it.R[8] * f, rng); // gold spilling out of the front
        poi(ctx, 'treasure', e.x, fs.at(e.x, e.s) + 0.4, e.s, 2, { wreck: sl.name });
      }
    } else if (e.type === 'debris') { // big: a field's centrepiece, always drawn and named after its ship
      const spec = sp[e.k];
      putFloor(ctx, fs, e.big ? st : spec.sway ? sw : mid, e.lbl ? { ...spec, lbl: e.lbl } : spec, e.x, e.s, rng);
    } else if (e.type === 'bell') {
      if (putFloor(ctx, fs, st, sp.bell, e.x, e.s, rng)) st.last.lbl = "Ship's bell of the " + (sl.name || 'wreck').replace(/ \(\d+\)$/, '');
    } else { // container, sometimes with a shorter one stacked on top (same yaw, inside its roof)
      const cr = mulberry32(e.k), long = T.container.filter((t) => t.box[3] - t.box[0] > 10), short = T.container.filter((t) => t.box[3] - t.box[0] < 10);
      const stack = e.stack && long.length && short.length, base = stack ? long[(cr() * long.length) | 0] : T.container[(cr() * T.container.length) | 0], yaw = cr() * TAU;
      if (!putFloor(ctx, fs, st, { ...sp.container, tpl: base, yaw, yawJ: 0 }, e.x, e.s, cr) || !stack) return;
      const o = (cr() - 0.5) * 4, it = st.last;
      putFloor(ctx, fs, st, { ...sp.container, tpl: short[(cr() * short.length) | 0], yaw, yawJ: 0.02, occ: 0 }, it.x + Math.cos(yaw) * o, e.s + Math.sin(yaw) * o, cr);
    }
  };
  for (const seg of ctx.segments) {
    if (seg.key !== 'wreck') continue;
    const plan = segmentPlan(ctx, seg);
    for (const sl of plan.slots) {
      if (sl.s < ctx.s0 - 120 || sl.s > ctx.s1 + 120) continue;
      // one step places the slot's pieces (once per slot, cached) and adds the hulls this chunk owns; its
      // debris, growth and delights become the following steps
      more.push(timed('slot', () => {
        const next = [];
        for (const p of slotPieces(ctx, fs, sl)) {
          // footprint occupancy (this chunk's ground) so debris does not land inside the hull
          const L2 = (p.tpl.box[5] - p.tpl.box[2]) / 2, hw = p.hw * 0.9;
          for (let t = -L2; t <= L2; t += Math.max(1.5, hw)) { const cx = p.c[0] + p.R[2] * t, cs = p.c[2] - p.R[8] * t; if (cs > ctx.s0 - 20 && cs < ctx.s1 + 20) fs.occupy(cx, cs, hw); }
          if (Math.floor(p.sMax / 64) === idx && ships.add(p.tpl, p.x, p.y, -(p.s - ctx.s0), p.R, 1, 1, 1, 0.92 + rng() * 0.16, 0.92 + rng() * 0.16, 0.92 + rng() * 0.16, 1)) {
            const it = ships.last;
            it.g = 1; it.lbl = p.lbl; it.fact = sl.fact;
            // the set piece: hovering water above the deck; wrecks low beside or under the flight path get it on
            // their far side instead, so the shoals it gathers never crowd the camera line
            const dx = p.c[0] - ctx.pathX(p.c[2]), away = Math.sign(dx) || 1, deck = p.y + p.tpl.deckY;
            const nearPath = Math.abs(dx) < TUBE + 3 && Math.abs(deck + 2.5 - ctx.pathY(p.c[2])) < TUBE + 2;
            const px = nearPath ? p.c[0] + away * (p.hw + 3) : p.c[0], py = nearPath ? Math.max(p.c[1], fs.at(px, p.c[2]) + 1.5) : deck + 2.5;
            poi(ctx, 'wreck', px, py, p.c[2], p.r, { name: p.lbl, kind: sl.kind, community: plan.theme.name });
          }
          // labels for the notable parts inside this chunk
          for (const f of p.tpl.feats || []) { const w = worldOf(p, f.p); if (inChunk(w[2]) && ctx.addLabel) ctx.addLabel(f.name, w[0], w[1], w[2], f.fact); }
          if (p.sMax > ctx.s0 - 40 && p.sMin < ctx.s1 + 40) {
            const fam = KINDS[sl.kind] ? KINDS[sl.kind].family : 'steel', list = fam === 'wood' ? sp.wood : fam === 'light' ? sp.light : sp.steel;
            const L2b = Math.max(4, (p.tpl.box[5] - p.tpl.box[2]) / 2), yaw = Math.atan2(p.R[2], p.R[0]), ca = Math.cos(yaw), sa = Math.sin(yaw);
            const n = Math.round((fam === 'light' ? 26 : 60) * tk * (p.tpl.box[5] - p.tpl.box[2] > 30 ? 1.3 : 0.75));
            next.push(...steps(n, 10, () => { // debris on an elliptical ring around the hull, trailing to one side
              const a = rng() * TAU, rr = 1 + Math.pow(rng(), 1.4) * 1.6;
              const lx = Math.cos(a) * (p.hw + 1.5) * rr * (Math.cos(a) * sl.side > 0 ? 1.6 : 1), lz = Math.sin(a) * (L2b + 2) * (0.6 + 0.5 * rr);
              const x = p.c[0] + ca * lx + sa * lz, s = p.c[2] - (-sa * lx + ca * lz);
              if (!inChunk(s)) return;
              const e = pickW(rng, list);
              putFloor(ctx, fs, e.sway ? sw : mid, sp[e.k], x, s, rng);
            }));
            const ng = Math.round(((sl.hero ? 22 : 12) + Math.min(36, (p.tpl.skin || 0) * 0.3)) * tk);
            next.push(timed('growth', () => growthOn(ctx, sp, p, rng, sw, mid, ng)));
          }
        }
        if (sl.arch && inChunk(sl.arch.s)) poi(ctx, 'arch', sl.arch.x, sl.arch.y, sl.arch.s, TUBE + 1.2, { kind: 'hull gap', name: sl.name });
        if (sl.cargo && inChunk(sl.cargo.s)) poi(ctx, 'wreck', sl.cargo.x, fs.at(sl.cargo.x, sl.cargo.s) + 2, sl.cargo.s, 16, { name: sl.name, kind: 'containers' });
        if (sl.site && inChunk(sl.site.s)) poi(ctx, 'wreck', sl.site.x, fs.at(sl.site.x, sl.site.s) + 2, sl.site.s, sl.site.r, { name: 'Remains of the ' + sl.name, kind: 'remains', community: plan.theme.name });
        for (const e of sl.extras) if (inChunk(e.s)) next.push(timed('extra', extra(sl, e)));
        more.unshift(...next);
      }));
    }
  }
  const nextP = clusterer(ctx, rng, 0, 45, 1);
  more.push(...steps(Math.round(90 * tk), 20, () => {
    const p = nextP();
    if (!p || rng() > ctx.weightOf(p.s, 'wreck')) return;
    const e = pickW(rng, sp.sparse);
    putFloor(ctx, fs, e.sway ? sw : mid, sp[e.k], p.x, p.s, rng, 1 + sstep(5, 30, p.d));
  }));
  more.push(() => {
    for (const b of bendSpots(ctx)) {
      if (rng() >= ctx.weightOf(b.s, 'wreck') * 0.5) continue;
      if (rng() >= 0.6) { putBend(ctx, fs, st, sp.rock, b, rng); continue; }
      if (putBend(ctx, fs, st, sp.mast, b, rng) === null) continue;
      // the fallen mast's yard lies loose beside it, roughly parallel, on the side away from the path
      const it = st.last, yaw = Math.atan2(it.R[2], it.R[0]), nx = -Math.sin(yaw), ns = Math.cos(yaw), o = (2.6 + rng() * 1.6) * (Math.sign(nx * b.side) || 1);
      putFloor(ctx, fs, st, { ...sp.spar, yaw, yawJ: 0.4 }, it.x + nx * o, ctx.s0 - it.z + ns * o, rng);
    }
  });
  more.push(...microSteps(ctx, fs, near, rng, 'wreck', sp.micro, 90, 26, 30));
  // the slot steps unshift their follow-ups (debris ring, growth, delights) into this same array, so the
  // stage runner must get `more` itself, not a copy
  more.unshift(...pumpSteps.slice(0, 4));
  more.push(...pumpSteps.slice(4));
  return { batches: [ships, st, mid, sw, near], more };
}
