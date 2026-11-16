// Background life: the water around the viewer is inhabited in every direction, not only along the route.
// The encounter director fills a band along the route ahead of the camera and retired every group the camera had passed,
// so the view to the sides and behind was empty water. Two cheap additions, kept in their own list (Creatures.bg) so the
// director, separation, camera subjects and audio never see them:
//  - residents: groups of the zone's own cast spawned off the route (beyond the near band, out to the distance each one
//    still reads at), mostly ahead and on the flanks so the camera's travel carries them past the sides and behind, in
//    patches, on structure for reef fish and in the open water column for schools and swimmers;
//  - passed groups: a group the near system retires behind or beside the camera carries on with its life here until it
//    is too far off to read or the budget needs its slot.
// Both run in Encounter's background mode (_bgUpdate): no steering, separation or camera work, reduced update rate, and
// the coarsest geometry level their size on screen allows (the speck on low and medium). Retired by distance and budget.
import { Encounter } from './encounter.js';
import { TABLES, dielW } from './director.js';
import { eventSkip } from './events.js';
import { hasSpeck } from './build.js';
import { Obstacles } from '../obstacles.js';
import { noise2, hash2i, mulberry32 } from '../noise.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// residents per zone at tier scale 1 (low; medium x1.4, high x1.8, ultra x2.2), the lateral band they live in (m from the
// route: from just beyond the near encounters' band out to a cap; each species also stays within the distance it reads
// at, reachOf, and within 35% of the fog distance, where fog has not yet taken most of its contrast) and the habitat:
// 'reef' fish keep to structure, 'open' groups anywhere in the water column; 'deep': only animals that glow are seen
// beyond the lamps. Caves and tide pools are corridors with nothing beside them, and the lamp-lit zones whose cast does
// not glow (hadal trench, Lost City, cold-water coral) show nothing beyond the lamps: no residents there (passed groups
// still live on behind the camera). A side view takes in about a quarter of the ring around the camera: ~13 groups put
// 3-4 of them in it.
const BG = {
  reef: [13, 9, 60, 'reef'], softcoral: [13, 9, 60, 'reef'], champagne: [12, 9, 50, 'reef'], anemone: [11, 9, 50, 'reef'],
  ruins: [11, 10, 60, 'reef'], wreck: [10, 10, 60, 'reef'], wall: [11, 10, 60, 'reef'], seamount: [13, 11, 70, 'reef'],
  bluehole: [12, 11, 70, 'reef'], kelp: [10, 8, 45, 'reef'], otterkelp: [10, 8, 45, 'reef'], seagrass: [10, 9, 60, 'reef'],
  sandflat: [9, 9, 60, 'reef'], sunkenforest: [10, 9, 50, 'reef'], mangrove: [6, 7, 35, 'reef'], biobay: [6, 7, 35, 'reef'],
  pelagic: [11, 12, 90, 'open'], whaleshark: [9, 12, 80, 'open'], sargassum: [9, 10, 70, 'open'], polar: [9, 10, 60, 'open'],
  iceedge: [9, 10, 60, 'open'], jellylake: [7, 8, 40, 'open'], whalefall: [6, 12, 70, 'open'],
  abyss: [6, 8, 40, 'deep'], deepplain: [4, 8, 40, 'deep'], vents: [6, 8, 40, 'deep'],
  hadal: [0, 0, 0, 'deep'], lostcity: [0, 0, 0, 'deep'], coldcoral: [0, 0, 0, 'deep'], cave: [0, 0, 0, 'reef'], tidepool: [0, 0, 0, 'reef'],
};
// kinds that live on in the background as residents (resting, walking, burrowing and set-piece kinds stay near-only)
const RES_KINDS = new Set(['school', 'shoal', 'hover', 'mill', 'bait', 'solo', 'pod', 'drift']);
const FLOCKS = new Set(['school', 'mill', 'bait', 'solo', 'pod']);
// distance at which a group still reads as fish, with its colour, through the murk: ~28 body lengths for one animal
// (~20 px long at 720p), ~45 for a school, and a big cloud of small fish (anthias, sardines) out to ~16 m (further off
// they were there but read only as faint specks)
const reachOf = (sp, n) => Math.max((sp.size[0] + sp.size[1]) * 0.5 * (n >= 15 ? 45 : 28), n >= 15 ? 16 : 0);
// per tier: [resident scale, max background groups (draw calls), max animals per resident group]
const TIER = { low: [1, 20, 36], medium: [1.4, 28, 56], high: [1.8, 36, 76], ultra: [2.2, 44, 96] }; // (low is bound by maxTris; the others have headroom)

export class Background {
  constructor(sys) {
    this.sys = sys; this.list = sys.bg;
    const T = TIER[sys.env.tier] || TIER.high;
    this.scale = T[0]; this.cap = T[1]; this.maxN = T[2];
    this.rng = mulberry32((sys.seed ^ 0x6b6c1fe5) >>> 0); this.primed = false; this.t = 0; this.nRes = 0; this.nPas = 0; this.want = 0;
    this._c = []; this._w = []; // candidate species / weights (reused)
  }
  reset() { this.primed = false; this.t = 0; }

  // A group the near system retires behind or beside the camera (Encounter.passed): live on here if it may.
  adopt(e, c) {
    const sys = this.sys;
    // (not riders, recycled swarms, or groups orbiting a set piece: the whale-fall crowd's controller keeps driving its
    // fish clouds, which then milled through the carcass)
    if (e.kind === 'attach' || e.HOLD !== null || e.IFD || e.plan.orbit || e.route === 'circle' || e.route === 'hang' || e.dying || e.fade < 0.5 || e.dist > Math.min(sys.fogD * 0.75, reachOf(e.sp, e.n))) return false; // (or already too far to read)
    if (sys.trisTotal + sys.bgTris > sys.maxTris * 0.85) return false;
    // a flock's members follow their slots without steering round rock: only one with no rock near it carries on here
    if (FLOCKS.has(e.kind) && this._rockNear(e.bounds.x, -(e.anchorZ + e.bounds.z), e.bounds.y, e.bounds.r + 4)) return false;
    // (the residents' share of the slots is kept for them: passed groups take the rest, the farthest giving way)
    if (this.nPas >= this.cap - this.want && !this._makeRoom(e.dist, 2)) return false;
    sys.instances -= e.n; sys.trisTotal -= e.tris; sys.bgInst += e.n; sys.bgTris += e.tris; // (before toBg: it may switch level)
    e.toBg(2, c); e.bgR = reachOf(e.sp, e.n);
    this.list.push(e); this.nPas++;
    return true;
  }

  tick(dt, c) {
    const sys = this.sys;
    const fogD = sys.fogD;
    // retire by distance, age and budget (never by being behind)
    let nRes = 0, nPas = 0;
    for (const e of this.list) {
      if (e.done || e.dying) continue;
      // (a group beyond the distance it reads at is only a slot held: it goes, and a new one comes nearer; one still ahead
      // is coming nearer; a resident the camera has left behind goes a little sooner, the passed groups keep the view
      // back filled)
      const ahead = -(e.anchorZ + e.bounds.z) > c.s + 5;
      const far = e.bgT > 6 && !ahead && e.dist > Math.max(e.bgR * (e.bg === 1 && this._behind(e, c) ? 0.7 : 1.3), 20);
      if (far || e.dist > fogD * 0.9 || (e.bgT > 240 && !e.visible)) this._retire(e);
      else if (e.bg === 1) nRes++; else nPas++;
    }
    // the tier's triangle budget holds for near and background together, and the near encounters come first: past 92%
    // the farthest background group fades out, past 100% they go at once
    if (sys.trisTotal + sys.bgTris > sys.maxTris * 0.92) this._makeRoom(-1, 0);
    this.trim();
    this.nRes = nRes; this.nPas = nPas;
    this.t -= dt;
    const first = !this.primed;
    if (!first && this.t > 0) return;
    this.t = 0.3;
    const want = this.want = Math.min(this._want(c), this.cap);
    for (let k = 0; k < (first ? want + 4 : nRes < want - 2 ? 2 : 1) && nRes < want; k++) {
      if (nRes + this.nPas >= this.cap && !this._makeRoom(-1, 2)) break; // (a resident wanted: the farthest passed group goes)
      if (this._spawn(c, first)) nRes++;
    }
    this.nRes = nRes;
    this.primed = true;
  }

  // residents wanted around the camera: the zones' counts blended by weight
  _want(c) {
    let n = 0;
    for (const e of this.sys.seq.weights(c.s)) n += (BG[e.key] ? BG[e.key][0] : 4) * e.w;
    return Math.round(n * this.scale);
  }
  _behind(e, c) { return -(e.anchorZ + e.bounds.z) < c.s - 10; }
  _retire(e) { if (e.visible) e.dying = true; else e.done = true; }
  // (also after the near encounters' update, whose level changes can add triangles within the frame)
  trim() { const sys = this.sys; for (let k = 0; k < 40 && sys.trisTotal + sys.bgTris > sys.maxTris && this._evict(); k++); }
  // over budget: the farthest background group goes now, in view or not (false: none left to drop)
  _evict() {
    let worst = null;
    for (const e of this.list) if (!e.done && e.kind !== 'attach' && (!worst || e.dist > worst.dist)) worst = e;
    if (!worst) return false;
    worst.done = true; if (worst.bg === 2) this.nPas--;
    // (its triangles leave the total when it is disposed this frame)
    this.sys.bgTris -= worst.tris; worst.tris = 0;
    return true;
  }
  // retire the farthest background group (farther than `d`; out of view first; mode 2: passed groups only): true if a
  // slot was freed
  _makeRoom(d, mode) {
    let worst = null, ws = -1;
    for (const e of this.list) {
      if (e.done || e.dying || e.dist <= d || (mode && e.bg !== mode)) continue;
      const sc = e.dist + (e.visible ? 0 : 1000);
      if (sc > ws) { ws = sc; worst = e; }
    }
    if (!worst) return false;
    this._retire(worst); // (out of the live count at once; a visible one fades out in _bgStep first)
    if (worst.bg === 2) this.nPas--;
    return true;
  }

  // One resident: a species of the zone, a place off the route within the distance at which it still reads (reachOf:
  // clouds of small reef fish stay just beyond the near band, sharks and turtles further out), in a patch of life, in its
  // habitat.
  _spawn(c, prime) {
    const sys = this.sys, sh = sys.shape, rng = this.rng, fogD = sys.fogD;
    const key = sys.seq.weights(c.s)[0].key, P = BG[key];
    if (!P || !P[0]) return false;
    const lMin = P[1], rMax = Math.min(P[2], fogD * 0.35), hab = P[3];
    if (rMax < lMin + 8) return false;
    for (let tr = 0; tr < 8; tr++) {
      const sp = this._pick(key, hab, c.s, lMin);
      if (!sp) continue;
      const reach = clamp(reachOf(sp, sp.beh.n[1]), lMin + 5, rMax);
      // where: on either flank beyond the route's band (the near encounters'), within its reach of the route, from a
      // little behind the camera to twice that reach ahead: the camera's travel brings them past, into a view to the side
      // from its front edge (whichever way the viewer is looking), and on behind
      const l = (rng() < 0.5 ? -1 : 1) * (lMin + (reach - lMin) * rng()), u = reach * (rng() * 2.6 - 0.6), rho = Math.hypot(l, u);
      if (rho > fogD * 0.8) continue;
      const s0 = c.s + u, x0 = sh.pathX(s0) + l;
      // its own zone only (spawns belong to their zone)
      if (sys.seq.weightOf(s0, key) < 0.6) continue;
      // patches of life, not a uniform sprinkle (~60 m blobs)
      if (rng() > 0.15 + 0.85 * clamp(noise2(x0 / 55, s0 / 55, 4417) * 1.6 + 0.35, 0, 1)) continue;
      // not popping up in view near the camera (further off, a slow fade-in through the murk is not seen as a pop)
      if (!prime && rho < fogD * 0.3 && this._inView(c, x0, sh.pathY(s0), s0, 3)) continue;
      const plan = this._plan(sp, s0, l, hab);
      if (!plan) continue;
      const e = new Encounter(sys, sp, plan);
      sys.bgInst += e.n; sys.bgTris += e.tris;
      e.toBg(1, c); e.bgR = reach;
      e._bgRock(); // (where the group really ended up: surface and ice dwellers sit higher than the spot checked above)
      if (e.dying || e.done) { e.dispose(); sys.bgInst -= e.n; sys.bgTris -= e.tris; continue; }
      e.regCount = sys.env && sys.env.obstacles ? sys.env.obstacles.count : 0;
      this.list.push(e);
      if (prime) e.fade = 1;
      return true;
    }
    return false;
  }

  // a species of zone `key` (diel-weighted) that reads at a distance and whose geometry is built (level 0 and the far
  // level: building level 0 here would stall the frame, so a species without it is queued for idle time)
  _pick(key, hab, s0, lMin) {
    const sys = this.sys, dir = sys.director, T = TABLES[key], C = this._c, W = this._w, rng = this.rng;
    if (!T) return null;
    const night = sys.U ? sys.U.uNight.value : 0;
    C.length = 0; W.length = 0; let tot = 0;
    const region = dir.region(s0);
    for (let li = 0; li < 3; li++) {
      const L = li === 0 ? T.list : li === 1 ? (night > 0.05 ? T.night : null) : (night > 0.05 && night < 0.95 ? T.dusk : null);
      if (!L) continue;
      for (let j = 0; j < L.length; j++) {
        const k0 = L[j][0];
        let w = L[j][1] * (li === 0 ? dielW(k0, night) : li === 1 ? night : clamp(1 - Math.abs(night * 2 - 1) * 1.4, 0, 1));
        if (w < 0.01 || eventSkip(k0, night)) continue;
        // (procedural reef fish: one of the region's variants the idle prewarm has built)
        const sp = dir.species(k0.startsWith('proc:') ? `${k0}:${(region % 100000) * 16 + Math.floor(rng() * 3)}` : k0);
        // (not the rare highlight animals, nor whales: those are the near system's to show)
        if (!sp || sp.hl || sp.beh.recycle || !RES_KINDS.has(sp.beh.kind) || sp.size[1] >= 6 || sp.plan === 'siphon') continue;
        if (hab === 'deep' && !(sp.glow > 0)) continue; // beyond the lamps only light makes an animal visible
        // seen off the route at all: a 10 cm damselfish is a pixel at 15 m, so far life is the larger fish, the schools
        // (their cloud reads further than one fish), sharks, rays and turtles (weighted by size)
        if (reachOf(sp, sp.beh.n[1]) < lMin + 5) continue;
        w *= clamp((sp.size[0] + sp.size[1]) / 1.2, 0.3, 1.5) * (hasSpeck(sp) ? 1 : 0.5);
        let same = 0; for (const e of this.list) if (e.sp === sp && !e.done) same++;
        w /= 1 + same * same * 2; // (variety: a second group of a species is rarer, a third rarer still)
        C.push(sp); W.push(w); tot += w;
      }
    }
    let r = rng() * tot;
    for (let j = 0; j < C.length; j++) {
      r -= W[j];
      if (r > 0 && j < C.length - 1) continue;
      const sp = C[j], far = hasSpeck(sp) ? -3 : -1;
      if (!sys.cache.has(sp, 0)) { if (sys.cache.map.size < sys.cache.cap - 8) sys.wantLod(sp, 0); return null; }
      if (!sys.cache.has(sp, far)) sys.cache.prebuild(sp, far); // (the speck: ~100 triangles, cheap to build)
      return sp;
    }
    return null;
  }

  _plan(sp, s0, l, hab) {
    const sys = this.sys, sh = sys.shape, rng = this.rng, beh = sp.beh, dir = sys.director;
    const rr = (a, b) => a + (b - a) * rng();
    let n = Math.round(beh.n[0] + (beh.n[1] - beh.n[0]) * rng());
    if (sys.tierScale !== 1 && n > 3) n = Math.round(n * sys.tierScale);
    n = Math.max(1, Math.min(n, hasSpeck(sp) ? this.maxN : 8)); // (jellies & co have no speck level: ~600 triangles each)
    if (sys.instances + sys.bgInst + n > sys.maxInstances * 0.9) return null;
    const entry = sys.cache.map.get(sp.key), far = sys.cache.map.get(sp.key + '|' + (hasSpeck(sp) ? -3 : -1));
    if (!entry || !far || sys.trisTotal + sys.bgTris + entry.tris * n > sys.maxTris * 0.75) return null; // (level 0 until the first step)
    const kind = beh.kind, sz = (sp.size[0] + sp.size[1]) * 0.5, R = sz * 1.9 * Math.cbrt(n);
    let x = sh.pathX(s0) + l, s = s0;
    let fl = sh.floorAt(x, s), top = Math.min(sh.ceilingAt(x, s), 0) - 0.8;
    let y;
    if (kind === 'shoal' || kind === 'hover') {
      // reef fish: on the highest structure nearby with water above it
      let best = -1e9;
      for (let k = 0; k < 6; k++) {
        const xx = x + rr(-8, 8), ss = s0 + rr(-8, 8), f = sh.floorAt(xx, ss), t = Math.min(sh.ceilingAt(xx, ss), 0) - 0.8;
        if (t - f > 2.5 + (beh.alt ? beh.alt[1] : 2) && f > best) { best = f; x = xx; s = ss; fl = f; top = t; }
      }
      if (best === -1e9) return null;
      y = fl + (beh.alt ? rr(beh.alt[0], beh.alt[1]) : 1.5);
    } else {
      if (top - fl < 2 * Math.min(R, 3) + 3) return null;
      // mid-water near the camera's depth band; reef zones: over the reef
      const mid = sh.pathY(s) + (hab === 'reef' ? rr(-6, 3) : rr(-12, 5));
      y = clamp(mid, fl + 1.5 + Math.min(R, 3), top - Math.min(R, 3) * 0.5);
    }
    // clear of rock: a hover group's members are pushed clear in _init; a flock's whole formation must be (its members do
    // not steer round rock here; a mill or bait ball holds its spot)
    if (this._rockNear(x, s, y, FLOCKS.has(kind) ? R + 1.5 : 1.5)) return null;
    const py = sh.pathY(s);
    // travelling groups mostly follow the lie of the coast / reef (along or against the route), some cut across
    const hr = rng(), rel = (hr < 0.55 ? 0 : hr < 0.85 ? Math.PI : rng() * TAU) + (rng() - 0.5);
    const plan = { n, formation: ['ellipsoid', 'loose', 'ribbon', 'ball'][Math.floor(rng() * 4)], mood: rng() < 0.7 ? 'calm' : 'feeding',
      wseed: (rng() * 4294967296) >>> 0, seed: (rng() * 4294967296) >>> 0,
      variant: (dir.region(s) ^ hash2i(sp.key.length, 3, 9) * 1e9) >>> 0, // (the same colour morph as the director's groups here)
      fadeIn: true, latMax: 1e4, s0: s, l0: x - sh.pathX(s), h0: y - py, route: 'hold', vs: Math.cos(rel) * 0.3, vl: Math.sin(rel) * 0.3, readLat: 1,
      alt: kind === 'shoal' || kind === 'hover' ? y - fl : 1, zone: kind === 'shoal' || kind === 'hover' ? beh.zone || 'floor' : beh.zone === 'surface' || beh.zone === 'ceiling' ? beh.zone : 'mid' };
    return plan;
  }

  // a rock (registered obstacle) within `rad` of the point
  _rockNear(x, s, y, rad) {
    const reg = this.sys.env && this.sys.env.obstacles;
    if (!reg || !reg.count) return false;
    const q = reg.query(x, s, rad + 2, this._q || (this._q = []));
    for (let j = 0; j < q.length; j++) if (Obstacles.dist(q[j], x, y, s, null) < rad) return true;
    return false;
  }
  _inView(c, x, y, s, pad) {
    const v = this._v || (this._v = { x: 0, y: 0, z: 0 });
    v.x = x; v.y = y; v.z = -s - c.Oz;
    const pl = c.frustum.planes;
    for (let i = 0; i < 6; i++) { const p = pl[i]; if (p.normal.x * v.x + p.normal.y * v.y + p.normal.z * v.z + p.constant < -pad) return false; }
    return true;
  }
}
