// --- events 2026-11 ---
// Rare wildlife events, run by the encounter director (director.js calls eventsTick every update, eventPiece for the
// 'pinnacle' and 'octopus-garden' set pieces and eventPrewarm from nextPrewarm). What they show follows the checked
// sources behind the facts in species.js; what those leave open (how long a rest lasts, how deep exactly, leaps,
// which way the current runs) is kept neutral and never labelled.
//   sperm whales    open ocean / whale-shark grounds: about six whales resting upright, heads just under the surface
//                   (Encounter route 'hang'), ~once per 30-45 min of time spent there; the camera slows past them
//   hammerheads     seamount by day: a big polarised school cruising slowly round a pinnacle, above the camera
//                   (silhouetted against the light); none at night (they leave the seamount to feed)
//   devil rays      whale-shark grounds, sand flats, open ocean: a dense school of Munk's devil rays in layers
//                   streaming past, wingbeats loosely in step (no leaps: not in the checked sources)
//   octopus garden  deep plain: octopuses brooding upside down in the cracks of a warm-spring field (props:
//                   octogarden.js registers the field and its nests with an 'octopus-garden' POI)
// Debug: ?event=sperm|hammerheads|devilrays|octopus (octopus also puts a garden in every deep plain segment), or
// __ocean.creatures.director.triggerEvent(kind) from the console. The signature moments (moments.js) take the same
// route: bayhunt, curtain, lampsoff, jellyarc, cathedral, strike.
import { Obstacles } from '../obstacles.js';
import { MOMENT_KINDS } from './moments.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const EVENT_DEBUG = qs.get('event') || '';
const SPERM_ZONES = new Set(['pelagic', 'whaleshark']);
const DEVIL_ZONES = new Set(['whaleshark', 'sandflat', 'pelagic']);
// group sizes per quality tier (low, medium, high, ultra): limited by the creature budgets (instances, triangles)
// (the event groups get interest > 1: the camera director prefers them to everything else, as it does a new set piece)
export const EVENT_N = { sperm: [6, 6, 6, 6], hammerheads: [40, 54, 66, 80], devilrays: [150, 195, 240, 300], octopus: [32, 44, 48, 56] };
export const EVENT_POI_SPECIES = { pinnacle: ['hammerheadPinnacle'], 'octopus-garden': ['broodOctopus'] };
const GAPL = 1.7; // devil-ray layers: vertical spacing (m)
const tierN = (sys, a) => { const k = sys.tierScale; return a[k < 0.7 ? 0 : k < 1 ? 1 : k > 1 ? 3 : 2]; };
const note = (sys, t) => { if (sys.env && typeof sys.env.note === 'function') sys.env.note(t); };

// Event state lives on the director (one per dive); time counters only run while the camera is in a fitting zone.
function state(dir) {
  if (!dir.ev) {
    const r = dir.rng;
    dir.ev = { acc: 0, last: dir.clock, inSperm: 0, inDevil: 0, spermDue: 150 + r() * 150, devilDue: 90 + r() * 120, hamNext: 0, force: EVENT_DEBUG, forceT: 0, count: {} };
  }
  return dir.ev;
}

// Largest group of `want` (at least `min`) that fits the instance and triangle budgets, retiring groups out of view.
function fit(dir, c, sp, want, min, groups = 1) {
  const sys = dir.sys, tris = sys.cache.map.get(sp.key)?.tris ?? (sp.det === 0 ? 700 : 2400);
  while (sys.enc.length > sys.maxEnc - 1 - groups && dir.retireOne(c));
  let n = want;
  for (let k = 0; k < 6 && (n > sys.maxInstances - sys.instances || n * tris > sys.maxTris - sys.trisTotal); k++) {
    if (!dir.retireOne(c)) break;
  }
  n = Math.min(n, sys.maxInstances - sys.instances, Math.floor((sys.maxTris - sys.trisTotal) / tris));
  return n >= min && sys.enc.length <= sys.maxEnc - groups ? n : 0;
}

export function eventsTick(dir, c) {
  const ev = state(dir), sys = dir.sys;
  ev.acc += dir.clock - ev.last; ev.last = dir.clock;
  if (ev.acc < 1) return false; // checked once a second
  const el = ev.acc; ev.acc = 0;
  const z = sys.seq.weights(c.s)[0];
  if (z.w >= 0.6) { if (SPERM_ZONES.has(z.key)) ev.inSperm += el; if (DEVIL_ZONES.has(z.key)) ev.inDevil += el; }
  if (ev.force && dir.clock > 2.5) { // ?event=: once, as soon as the cast is primed (POI events: the next fitting POI)
    const k = ev.force;
    if (k === 'sperm' || k === 'devilrays' || (k !== 'octopus' && dir.clock > 4) || (k === 'octopus' && dir.clock > 6)) {
      if (triggerEvent(dir, k) || ++ev.forceT > 20) ev.force = '';
    }
    return false;
  }
  if (ev.inSperm >= ev.spermDue && spawnSperm(dir, c, false)) { ev.inSperm = 0; ev.spermDue = 1200 + dir.rng() * 600; return true; }
  if (ev.inDevil >= ev.devilDue && spawnDevil(dir, c, false)) { ev.inDevil = 0; ev.devilDue = 720 + dir.rng() * 480; return true; }
  return false;
}

// Species kept out of the director's tables at night (a school's day-only habit, see the hammerhead fact): the
// director skips a table entry when this returns true.
export function eventSkip(key, night) { return night > 0.35 && key === 'hammerheadSchool'; }

// Names of the event animals around now (the deck shows them as a rare encounter, like the surprises).
const EVENT_KEYS = new Set(['spermWhaleRest', 'hammerheadPinnacle', 'devilRay', 'broodOctopus']);
export function eventRare(dir, name) {
  for (const e of dir.sys.enc) if (!e.done && EVENT_KEYS.has(e.sp.key) && (e._label || '') === name) return true;
  return false;
}

// Species to build in idle time before an event needs them (the whales and rays are big builds).
export function eventPrewarm(dir) {
  const ev = dir.ev, out = [];
  if (!ev) return out;
  if (ev.inSperm > ev.spermDue - 90 || ev.force === 'sperm') out.push('spermWhaleRest');
  if (ev.inDevil > ev.devilDue - 90 || ev.force === 'devilrays') out.push('devilRay');
  return out;
}

// Set pieces at POIs (director.setPiece falls through to this): true when something was spawned.
export function eventPiece(dir, p, c, force = false) {
  if (p.type === 'pinnacle') return hammerheads(dir, p, c, force);
  if (p.type === 'octopus-garden') return octoGarden(dir, p, c);
  return false;
}

// ---------- sperm whales resting at the surface ----------
function spawnSperm(dir, c, force) {
  const sys = dir.sys, sh = sys.shape, r = dir.rng, rr = (a, b) => a + (b - a) * r();
  const sp = dir.species('spermWhaleRest');
  if (!sp) return false;
  const ws = sys.seq.weights(c.s + 130);
  if (!force && (!SPERM_ZONES.has(ws[0].key) || ws[0].w < 0.6)) return false;
  for (let k = 0; k < 8; k++) {
    const s0 = c.s + rr(115, 150), lat = (r() < 0.5 ? -1 : 1) * rr(14, 17), x = sh.pathX(s0) + lat;
    if (sh.hasCeiling(s0)) continue;
    // open water over the whole group: the floor far below the tails (16 m whales, upright), no ice or rock above
    let open = true;
    for (let q = 0; q < 9 && open; q++) {
      const a = (q * TAU) / 8, rad = q === 8 ? 0 : 16, fx = x + Math.cos(a) * rad, fs = s0 + Math.sin(a) * rad;
      if (sh.floorAt(fx, fs) > -26 || sh.ceilingAt(fx, fs) < -0.2) open = false;
    }
    if (!open) continue;
    const n = fit(dir, c, sp, tierN(sys, EVENT_N.sperm) - (r() < 0.35 ? 1 : 0), 3);
    if (!n) return false;
    const plan = dir.plan(sp, c, true, ws, sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
    if (!plan) return false;
    Object.assign(plan, { n, kind: 'pod', route: 'hang', zone: 'mid', s0, l0: lat, h0: -8 - sh.pathY(s0), vs: 0, vl: 0, latMax: 200, fadeIn: true,
      interest: 1.5, wobble: 0, hang: { top: -rr(0.55, 0.9), gap: rr(5.5, 7) } });
    const e = sys.spawn(sp, plan);
    if (!e) return false;
    dir.seen.set(sp.key, dir.clock); dir.lastSpawn = dir.clock; dir.ev.count.sperm = (dir.ev.count.sperm || 0) + 1;
    note(sys, 'Sperm whales resting upright at the surface, possibly asleep');
    return true;
  }
  return false;
}

// ---------- Munk's devil rays streaming past ----------
function spawnDevil(dir, c, force) {
  const sys = dir.sys, sh = sys.shape, r = dir.rng, rr = (a, b) => a + (b - a) * r();
  const sp = dir.species('devilRay');
  if (!sp) return false;
  const ws = sys.seq.weights(c.s + 90);
  if (!force && (!DEVIL_ZONES.has(ws[0].key) || ws[0].w < 0.6)) return false;
  const total = tierN(sys, EVENT_N.devilrays), layers = 3;
  const per = fit(dir, c, sp, Math.round(total / layers) * layers, 40 * layers, layers);
  if (!per) return false;
  const nL = Math.floor(per / layers);
  for (let k = 0; k < 6; k++) {
    const s0 = c.s + rr(75, 105), side = r() < 0.5 ? -1 : 1, lat = side * rr(1.5, 4), x = sh.pathX(s0) + lat, py = sh.pathY(s0);
    const fl = Math.max(sh.floorAt(x, s0), sh.floorAt(x, s0 - 12), sh.floorAt(x, s0 + 12)), ce = Math.min(sh.ceilingAt(x, s0), 0);
    const lo = fl + 3.5, hi = ce - 1.8 - (layers - 1) * GAPL;
    if (hi < lo) continue;
    const y0 = clamp(py + rr(2, 4), lo, hi), // the lowest layer 2-4 m above the camera: silhouettes against the light
      vs = -rr(0.9, 1.15), wseed = (r() * 4294967296) >>> 0, ph0 = r() * TAU;
    let first = null;
    for (let L = 0; L < layers; L++) {
      const plan = dir.plan(sp, c, true, ws, sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
      if (!plan) break;
      // layers: one above the other, slightly offset (each its own group: one draw call, slots spread per layer)
      Object.assign(plan, { n: nL, kind: 'school', route: 'oncoming', formation: 'loose', mood: 'calm', zone: 'mid', s0: s0 + L * rr(-4, 4),
        l0: lat + side * L * rr(0.5, 1.5), h0: y0 + L * GAPL - py, vs, vl: 0, spacing: 1.0, wobble: 2.2, wseed, latMax: 200, fadeIn: true, interest: 1.3 });
      const e = sys.spawn(sp, plan);
      if (!e) break;
      for (let i = 0; i < e.n; i++) { e.PH[i] = ph0 + (e.rng() - 0.5) * 1.3; e.FQ[i] = 0.97 + e.rng() * 0.06; } // wingbeats loosely in step
      if (!first) first = e;
    }
    if (!first) return false;
    dir.seen.set(sp.key, dir.clock); dir.lastSpawn = dir.clock; dir.ev.count.devilrays = (dir.ev.count.devilrays || 0) + 1;
    note(sys, "A school of Munk's devil rays");
    return true;
  }
  return false;
}

// ---------- scalloped hammerheads over a seamount pinnacle (day only) ----------
function hammerheads(dir, p, c, force) {
  const sys = dir.sys, sh = sys.shape, ev = state(dir), r = dir.rng, rr = (a, b) => a + (b - a) * r();
  const night = sys.U ? sys.U.uNight.value : 0;
  if (!force && (night > 0.35 || dir.clock < ev.hamNext || r() > 0.75)) return false;
  const sp = dir.species('hammerheadPinnacle');
  if (!sp || sys.enc.some((e) => !e.done && e.sp === sp)) return false; // one school at a time
  const n = fit(dir, c, sp, tierN(sys, EVENT_N.hammerheads), 16);
  if (!n) return false;
  const ps = Math.max(p.s, c.s + 55), px = sh.pathX(ps), py = sh.pathY(ps), side = Math.sign(p.x - px) || 1;
  // a loose ellipsoid ~0.42 R tall: its centre high enough that most of it is above the camera, under the surface
  const R = sp.size[1] * 1.9 * 0.65 * Math.cbrt(n) * 0.95, top = Math.min(0, sh.ceilingAt(px, ps)) - 2.5 - R * 0.42;
  const fl = Math.max(sh.floorAt(px, ps), sh.floorAt(px + side * 6, ps));
  const y = Math.min(py + rr(5.5, 8.5), top);
  if (y < fl + R * 0.42 + 3 && !force) return false;
  // cruising slowly round the pinnacle on a wide arc that crosses over the path (polarised: all on one heading)
  const xC = px + side * rr(1, 6), dx = xC - p.x, ds = ps - p.s, rad = Math.max(12, Math.hypot(dx, ds));
  const spd = rr(0.5, 0.7), plan = dir.plan(sp, c, true, sys.seq.weights(ps), sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
  if (!plan) return false;
  Object.assign(plan, { n, kind: 'school', route: 'circle', formation: 'ellipsoid', mood: 'calm', zone: 'mid', spacing: 0.65, s0: ps, l0: xC - px, h0: y - py,
    noSeek: true, fadeIn: true, latMax: 200, interest: 1.3, poi: p, wobble: 1.6,
    orbit: { x: p.x, s: p.s, y, r: rad, w: (spd / rad) * (r() < 0.5 ? 1 : -1), a0: Math.atan2(ds, dx), T: 160 } });
  const e = sys.spawn(sp, plan);
  if (!e) return false;
  dir.seen.set(sp.key, dir.clock); dir.lastSpawn = dir.clock; ev.count.hammerheads = (ev.count.hammerheads || 0) + 1;
  ev.hamNext = dir.clock + 200 + r() * 160;
  note(sys, 'A school of scalloped hammerheads over the pinnacle');
  return true;
}

// ---------- the Octopus Garden: brooding octopuses in the cracks of a warm-spring field ----------
function octoGarden(dir, p, c) {
  const sys = dir.sys, reg = sys.env && sys.env.obstacles, nests = p.data && p.data.nests;
  if (!nests || nests.length < 4) return false;
  const sp = dir.species('broodOctopus');
  if (!sp || sys.enc.some((e) => !e.done && e.sp === sp && Math.abs(-(e.anchorZ + e.bounds.z) - p.s) < 25)) return false; // (once per garden)
  // keep the nests clear of the rocks' collision capsules (the octopus would be pushed out of them every frame)
  const spots = [], q = [], sh = sys.shape;
  for (let k = 0; k + 1 < nests.length; k += 2) {
    const x = nests[k], s = nests[k + 1], y = sh.floorAt(x, s) + 0.15;
    let ok = true;
    if (reg && reg.count) for (const o of reg.query(x, s, 2, q)) if (Obstacles.dist(o, x, y, s, null) < 0.24) { ok = false; break; }
    if (ok) spots.push(x, s);
  }
  const n = fit(dir, c, sp, Math.min(tierN(sys, EVENT_N.octopus), spots.length / 2), 4);
  if (!n) return false;
  const e = dir.spawnAt('broodOctopus', p, { kind: 'octo', brood: true, spots: spots.slice(0, n * 2), n, noSeek: true, spread: 1, interest: 1.2 });
  if (!e) return false;
  state(dir).count.octopus = (state(dir).count.octopus || 0) + 1;
  note(sys, 'An octopus garden: octopuses brooding their eggs at warm springs');
  return true;
}

// Debug: start an event right here (ignores zones, time of day and cooldowns where it can). Returns true if spawned.
export function triggerEvent(dir, kind) {
  const sys = dir.sys, c = dir._c || sys.ctx, sh = sys.shape, env = sys.env;
  if (MOMENT_KINDS.has(kind)) return dir.moments.trigger(kind);
  state(dir);
  if (kind === 'sperm') return spawnSperm(dir, c, true);
  if (kind === 'devilrays') return spawnDevil(dir, c, true);
  const type = kind === 'hammerheads' ? 'pinnacle' : kind === 'octopus' ? 'octopus-garden' : null;
  if (!type) return false;
  const list = env && env.pois ? env.pois.query(c.s + 20, c.s + 170, []) : [];
  const p = list.find((x) => x.type === type);
  if (p) {
    if (!dir.poiDone) dir.poiDone = new Map();
    dir.poiDone.set(p.type + ':' + Math.round(p.x) + ':' + Math.round(p.s), p.s);
    return type === 'pinnacle' ? hammerheads(dir, p, c, true) : octoGarden(dir, p, c);
  }
  if (type === 'pinnacle') { const s = c.s + 80; return hammerheads(dir, { type, x: sh.pathX(s) + 24, y: sh.pathY(s) - 8, s, r: 8 }, c, true); }
  // no garden here: brooding octopuses on the bare floor ahead (creature test only)
  const s = c.s + 26, x0 = sh.pathX(s) + 3.5, nests = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) nests.push(x0 + i * 0.95 + (j & 1) * 0.4, s + j * 0.9);
  return octoGarden(dir, { type, x: x0 + 2.5, y: sh.floorAt(x0, s), s: s + 2.5, r: 4, data: { nests } }, c);
}
