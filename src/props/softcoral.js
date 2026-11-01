// Soft Coral Garden (Red Sea style): pinnacles smothered in translucent Dendronephthya tree corals
// that glow when backlit, with sea fans, whip corals, leather corals, feather stars, table corals and
// encrusting colour. One coral bommie per segment hosts a cleaning station.
import { Builder, Batch, TAU, vn3, sat, sstep, lerp, rotY, presence, budgetK, CHUNK, T } from './core.js';
import { MAT } from './materials.js';
import { seaFan, seaWhips, leatherCoral, anemone, branchesInto, rockInto } from './shapes.js';
import { mulberry32, noise2, smoothstep } from '../noise.js';
import { sv } from '../biomes.js';
import { NBMAT, pathCache, clearBox, SOLID, SOFT, seat, put, upTo, nrm, mix3, lab, segFor, recipe, lowK, rayY, setBase, nbFloor, itemSupport, slice } from './nb_common.js';
import { encrust, featherStar, ground } from './nb_shapes.js';
import { tintFrom } from './scatter.js';
import { Space } from './nb3_common.js';

const S = {};

// ---------------------------------------------------------------- Dendronephthya
// A thick, pale, translucent stalk on a flared holdfast, forking into 3-6 limbs that each end in a
// "cauliflower" lobe: a knobbly bundle of polyp clusters (aFx.y = 0) on translucent branches (aFx.y = 1).
// Every template draws its own habit: an open umbrella, a rounded bush or a tall, narrow tree, leaning a
// little. aFx.x = sway amplitude (grows with height).
const knob = (seed, k) => (x, y, z) => 1 + 0.16 * vn3(x * 2.6 + k, y * 2.6, z * 2.6, seed) + 0.24 * Math.max(0, vn3(x * 7 + k, y * 7, z * 7, seed + 5));
function holdfast(b, h, sway) {
  b.lathe(8, 2, (v) => [h * (0.16 - 0.08 * v), -0.02 + h * 0.07 * v * v], (a, v) => 1 + 0.18 * Math.sin(a * 3 + v * 2) * (1 - v), (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.95; o[6] = sway(y); o[7] = 1; });
}
function dendro(seed, { h = 0.8, lod = 0 } = {}) {
  const b = new Builder(), rng = mulberry32(seed), tips = [];
  const habit = rng(), umbrella = habit < 0.4, tall = habit > 0.78;
  const radial = 4, trunkH = h * (tall ? 0.42 + rng() * 0.12 : 0.24 + rng() * 0.14), lx = (rng() - 0.5) * 0.12, lz = (rng() - 0.5) * 0.12;
  const sway = (y) => 0.05 * h * sat(y / h) ** 2;
  const stalk = (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.95; o[6] = sway(y); o[7] = 1; };
  holdfast(b, h, sway);
  // stout translucent trunk, bulging a little where the limbs fork off
  b.tube([[0, -0.02, 0], [lx * h * 0.4, trunkH * 0.5, lz * h * 0.4], [lx * h, trunkH, lz * h]], [h * 0.11, h * 0.095, h * 0.085], radial + 1, stalk);
  const nMain = 3 + Math.floor(rng() * 4), top = [lx * h, trunkH * (0.82 + 0.15 * rng()), lz * h];
  for (let k = 0; k < nMain; k++) {
    const a = (k / nMain) * TAU + rng() * 0.7, out = umbrella ? 0.9 + rng() * 0.6 : tall ? 0.25 + rng() * 0.3 : 0.45 + rng() * 0.5;
    branchesInto(b, rng, {
      depth: 1, len: h * (umbrella ? 0.38 : 0.3 + rng() * 0.12), rad: h * 0.05, radial: 3, segs: lod ? 1 : 2, kids: lod ? [1, 2] : [2, 3], spread: umbrella ? 0.65 : 0.45 + rng() * 0.25, up: umbrella ? 0.04 : 0.14, wiggle: 0.25,
      lenK: 0.6, radK: 0.72, tipK: 0.6, childAt: [0.45, 1], tip: false,
      paint(level, v, x, y, z, o) { o[3] = o[4] = o[5] = 0.95; o[6] = sway(y); o[7] = 1; },
      onTip(p) { tips.push(p); },
    }, top, [Math.cos(a) * out, 1, Math.sin(a) * out]);
  }
  // polyp lobes: a knobbly cluster at every twig tip, the lobes of one limb crowding into a cauliflower head
  for (const p of tips) {
    const s = h * (lod ? 0.13 : 0.1) * (0.75 + 0.5 * rng()), k = rng() * 10, kn = knob(seed, k);
    const n = lod ? 1 : 1 + (rng() < 0.5 ? 1 : 0);
    for (let q = 0; q < n; q++) {
      const c = q ? [p[0] + (rng() - 0.5) * s * 1.4, p[1] - s * 0.3, p[2] + (rng() - 0.5) * s * 1.4] : [p[0], p[1] + s * 0.25, p[2]], sq = q ? s * 0.7 : s;
      b.blob(1, (x, y, z, o) => {
        const d = kn(x, y, z);
        o[0] = c[0] + x * sq * d; o[1] = c[1] + y * sq * d * (umbrella ? 0.75 : 0.9); o[2] = c[2] + z * sq * d;
        o[3] = o[4] = o[5] = 0.8 + 0.3 * Math.max(0, y) + 0.12 * (d - 1); o[6] = sway(o[1]); o[7] = 0;
      });
    }
  }
  const t = ground(b).build();
  const rb = h * 0.13;
  setBase(t, [rb, 0, 0, -rb, 0, 0, 0, 0, rb, 0, 0, -rb, rb * 0.7, 0, rb * 0.7, -rb * 0.7, 0, -rb * 0.7]);
  t.label = 'Tree soft coral (Dendronephthya)';
  t.fact = 'Without algae of its own, it inflates with water and feeds on plankton in the current';
  t.solid = false;
  return t;
}

// distant colonies: the same build, coarser: a thick pale stalk on its holdfast and 3-5 knobbly lobes on
// short limbs (about 250 triangles), so the stalk still reads through the haze and nothing hovers
function dendroFar(seed, { h = 0.8 } = {}) {
  const b = new Builder(), rng = mulberry32(seed), habit = rng(), umbrella = habit < 0.4, tall = habit > 0.78;
  const th = h * (tall ? 0.45 : 0.3 + rng() * 0.12), sway = (y) => 0.04 * h * sat(y / h);
  holdfast(b, h, sway);
  b.tube([[0, -0.02, 0], [0.01, th * 0.6, 0], [0, th, 0]], [h * 0.12, h * 0.1, h * 0.09], 4, (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.95; o[6] = sway(y); o[7] = 1; });
  const nL = 3 + Math.floor(rng() * 3), cr = h * (umbrella ? 0.2 : 0.17) * (0.9 + 0.2 * rng());
  // the central head, then lobes around it on short limbs
  const lobe = (c, r, det, k) => {
    const kn = knob(seed, k);
    b.blob(det, (x, y, z, o) => { const d = kn(x, y, z); o[0] = c[0] + x * r * d; o[1] = c[1] + y * r * d * (umbrella ? 0.75 : 0.9); o[2] = c[2] + z * r * d; o[3] = o[4] = o[5] = 0.82 + 0.25 * Math.max(0, y); o[6] = sway(o[1]); o[7] = 0; });
  };
  lobe([0, th + cr * 0.8, 0], cr, 1, 0);
  for (let k = 0; k < nL; k++) {
    const a = (k / nL) * TAU + rng() * 0.8, out = (umbrella ? 1.5 : tall ? 0.7 : 1.1) * cr * (0.9 + 0.3 * rng()), up = cr * (umbrella ? 0.2 : 0.5 + 0.5 * rng());
    const c = [Math.cos(a) * out * 1.3, th + up, Math.sin(a) * out * 1.3];
    b.tube([[0, th * 0.85, 0], [c[0] * 0.8, c[1] - cr * 0.4, c[2] * 0.8]], [h * 0.05, h * 0.035], 3, (v, an, x, y, z, o) => { o[3] = o[4] = o[5] = 0.95; o[6] = sway(y); o[7] = 1; });
    lobe(c, cr * (0.7 + 0.25 * rng()), 0, k + 1);
  }
  const t = ground(b).build(), rb = h * 0.13;
  setBase(t, [rb, 0, 0, -rb, 0, 0, 0, 0, rb, 0, 0, -rb, 0, 0, 0]);
  t.label = 'Tree soft coral (Dendronephthya)'; t.solid = false;
  return t;
}

function bommieTpl(seed) {
  const b = new Builder();
  rockInto(b, seed, { detail: 3, sx: 1.1 + (seed % 3) * 0.15, sy: 0.7 + (seed % 4) * 0.1, sz: 0.95, rough: 0.42, flat: 0.25, growth: 1.0, col: [0.75, 0.64, 0.56] });
  // living cover: patches of pink coralline algae, orange and purple sponge, green turf
  const PAL = [[0.95, 0.35, 0.55], [1.0, 0.42, 0.08], [0.55, 0.15, 0.75], [0.35, 0.55, 0.2], [0.9, 0.75, 0.2]];
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => {
    const n = vn3(x * 2.2 + seed, y * 2.2, z * 2.2, seed + 11), m = vn3(x * 0.9, y * 0.9, z * 0.9, seed + 17);
    const k = sstep(0.05, 0.35, n), c = PAL[Math.min(4, Math.floor((m * 0.5 + 0.5) * 5))];
    o[0] = lerp(o[0], c[0] * (0.6 + 0.4 * o[0]), k * 0.85); o[1] = lerp(o[1], c[1] * (0.6 + 0.4 * o[1]), k * 0.85); o[2] = lerp(o[2], c[2] * (0.6 + 0.4 * o[2]), k * 0.85);
    o[4] = 2;
  });
  const t = b.build(); t.label = 'Coral bommie';
  return t;
}

export function initSoftcoral() {
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(1300 + i * 19 + o));
  S.bommie = R(6, bommieTpl, 3);
  S.dNear = R(10, (s) => dendro(s, { h: 0.6 + (s % 5) * 0.12 }));
  S.dMid = R(8, (s) => dendroFar(s, { h: 0.6 + (s % 5) * 0.12 }), 7);
  S.fan = R(8, (s) => seaFan(s + 40, { h: 1.0 + (s % 4) * 0.25 }));
  S.whip = R(5, (s) => seaWhips(s + 40, { n: 2 + (s % 5), h: 1.1 + (s % 3) * 0.3 }));
  S.leather = R(5, (s) => leatherCoral(s + 40));
  S.crin = R(5, (s) => featherStar(s + 77, { arms: 8 + (s % 3) * 2, L: 0.2 + (s % 3) * 0.05, up: 0.5 + (s % 3) * 0.15 }));
  S.enc = R(8, (s) => encrust(s + 55, { r: 0.22 + (s % 4) * 0.08, h: 0.05 + (s % 3) * 0.03, lobes: 0.7, detail: 1, elong: 1 + (s % 3) * 0.4 }));
  S.anem = [1, 2, 3].map((k) => anemone(k + 80, { tentacles: 48, tlen: 0.32, rows: 3, disc: 0.28, height: 0.18, thick: 0.03, body: [0.75, 0.2, 0.25], tent: [0.75, 0.82, 0.5], tipC: [1.3, 1.1, 1.0] }));
  lab(S.fan, 'Gorgonian sea fan', 'Sea fans grow across the current to sieve plankton from the passing water');
  lab(S.whip, 'Whip coral', null);
  lab(S.leather, 'Leather coral', 'Leather corals shed a waxy skin now and then to clean themselves');
  lab(S.crin, 'Feather star', 'Feather stars can swim by rowing their arms');
  lab(S.enc, 'Encrusting sponge', null);
  lab(S.anem, 'Magnificent sea anemone', 'Home to anemonefish, which are protected by a slimy coat from the stinging tentacles');
  for (const t of [...S.crin, ...S.whip, ...S.fan]) t.solid = false;
  return S;
}

// ---------------------------------------------------------------- palettes & recipe
// saturated, authored to survive blue water (linear RGB)
// (red-biased: the water's blue-green filter turns yellow to lime, violet to periwinkle, white to mint)
const DEN = {
  pink: [[1.0, 0.16, 0.45], [1.0, 0.3, 0.6], [1.0, 0.1, 0.3]],
  purple: [[0.78, 0.08, 0.72], [0.65, 0.1, 0.78], [0.88, 0.16, 0.66]],
  red: [[1.0, 0.06, 0.08], [1.0, 0.18, 0.1], [0.85, 0.04, 0.2]],
  orange: [[1.1, 0.3, 0.04], [1.05, 0.4, 0.07], [1.0, 0.22, 0.06]],
  salmon: [[1.05, 0.3, 0.26], [1.0, 0.36, 0.34], [1.08, 0.26, 0.18]],
  white: [[1.05, 0.88, 0.84], [1.0, 0.82, 0.82]],
};
const FANP = [[1.05, 0.12, 0.12], [1.1, 0.45, 0.06], [0.75, 0.1, 0.9], [1.05, 0.85, 0.12]];
const ENC = [[1.0, 0.35, 0.5], [0.9, 0.08, 0.15], [0.6, 0.15, 0.85], [1.05, 0.55, 0.1], [0.95, 0.85, 0.2], [0.2, 0.5, 1.0]];
const recipeOf = (g) => recipe(g, 'softcoral', (g) => {
  const keys = ['pink', 'purple', 'red', 'orange', 'salmon'], pal = [];
  const a = Math.floor(sv(g, 19) * 5), b = (a + 1 + Math.floor(sv(g, 20) * 4)) % 5;
  pal.push(...DEN[keys[a]], ...DEN[keys[a]], ...DEN[keys[b]]);
  if (sv(g, 21) > 0.5) pal.push(...DEN[keys[(b + 1 + Math.floor(sv(g, 22) * 3)) % 5]]);
  if (sv(g, 23) > 0.75) pal.push(DEN.white[0]);
  return { dens: 0.8 + sv(g, 5) * 0.5, fan: 0.4 + sv(g, 6), whip: 0.3 + sv(g, 7), leather: 0.3 + sv(g, 8) * 0.8, crin: 0.3 + sv(g, 9), table: 0.1 + sv(g, 10) * 0.4, pal };
});
// pinnacle height (m) from the biome formula: where the coral towers rise
function pinAt(g, x, s, ad) { return Math.max(0, noise2(x / 14, s / 14, 151) - 0.1) ** 1.5 * (7 + 5 * sv(g, 1)) * smoothstep(5, 12, ad); }

const pick = (rng, a) => a[(rng() * a.length) | 0];
const tint = (rng, list, amt = 0.15) => tintFrom(list, amt)(rng);

// ---------------------------------------------------------------- chain A: tree soft corals
export function* layoutSoftA(ctx) {
  const Y = slice();
  if (presence(ctx, 'softcoral') <= 0) return null;
  const bk = budgetK(ctx, 'softcoral'), lk = lowK(ctx);
  const rng = mulberry32(((ctx.s0 * 2654435761) ^ 0x50f7) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const near = new Batch(NBMAT.soft, 54000 * bk); near.lod = 'mid'; near.soft = true;
  const mid = new Batch(NBMAT.soft, 30000 * bk); mid.soft = true;
  // coral bommies along the route, each smothered in a cluster of colonies seated on its real top
  const rock = new Batch(MAT.static, 30000 * bk);
  let placed = 0;
  for (let k = 0; k < 22; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + (k + rng()) * (CHUNK / 22), g = segFor(ctx, s, 'softcoral');
    if (!g || rng() > ctx.weightOf(s, 'softcoral') * 0.85) continue;
    const rc = recipeOf(g), x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * (3 + Math.pow(rng(), 1.3) * 14);
    const tpl = pick(rng, S.bommie), sc = 1.1 + rng() * 1.1, R = rotY(rng() * TAU), y = fs.at(x, s);
    if (!clearBox(pc, x, s, y, y + tpl.maxY * sc + 1.2, tpl.r * sc)) continue;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, null, 0.12);
    if (!put(ctx, rock, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, tint(rng, [[1, 0.9, 0.85], [0.9, 0.85, 0.95]], 0.1))) continue;
    const item = rock.items[rock.items.length - 1], top = itemSupport(tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, true, fs);
    // encrusting sponges on the bommie's flanks, following the rock (seated along the local surface normal)
    for (let q = 0, ne = 1 + Math.floor(rng() * 3); q < ne; q++) {
      const a = rng() * TAU, rr = tpl.r * sc * (0.45 + 0.3 * rng()), ex = Pp[0] + Math.cos(a) * rr, es = Pp[2] + Math.sin(a) * rr, e = 0.15;
      const ey = top.at(ex, es), gx = (top.at(ex + e, es) - top.at(ex - e, es)) / (2 * e), gs = (top.at(ex, es + e) - top.at(ex, es - e)) / (2 * e);
      if (top.miss) { top.miss = 0; continue; }
      if (ey < fs.at(ex, es) + 0.15 || Math.hypot(gx, gs) > 1.6) continue; // on the rock, not at its foot or under a lip
      const nl = Math.hypot(gx, 1, gs), n = [-gx / nl, 1 / nl, gs / nl], et = pick(rng, S.enc), esc = 0.5 + rng() * 0.5, Re = upTo(n, rng() * TAU), Pe = [ex, ey, es];
      seat(top, et, Re, esc, esc, esc, Pe, n, 0.03);
      if (top.miss) { top.miss = 0; continue; }
      put(ctx, rock, et, Pe[0], Pe[1], Pe[2], Re, esc, esc, esc, tint(rng, ENC, 0.2), 1, { item });
    }
    const col0 = pick(rng, rc.pal), n = 6 + Math.floor(rng() * 8);
    for (let q = 0; q < n; q++) {
      const a = rng() * TAU, rr = Math.sqrt(rng()) * tpl.r * sc * 0.75, cx = Pp[0] + Math.cos(a) * rr, cs = Pp[2] + Math.sin(a) * rr;
      const near0 = Math.abs(cx - pc.x(cs)) < 9, t2 = pick(rng, near0 ? S.dNear : S.dMid), sc2 = 0.8 + Math.pow(rng(), 1.4) * 1.2;
      const cy = top.at(cx, cs), R2 = rotY(rng() * TAU), h2 = t2.maxY * sc2;
      // only on the dome's gentle top: steep flanks and lips would leave the stalk hanging
      const e = 0.2, sl = Math.max(Math.abs(top.at(cx + e, cs) - top.at(cx - e, cs)), Math.abs(top.at(cx, cs + e) - top.at(cx, cs - e))) / (2 * e);
      if (top.miss || sl > 0.9) { top.miss = 0; continue; }
      if (!clearBox(pc, cx, cs, cy, cy + h2, t2.r * sc2, SOLID, 2.0)) continue;
      const P2 = [cx, cy, cs];
      seat(top, t2, R2, sc2, sc2, sc2, P2, null, 0.05);
      const col = rng() < 0.75 ? tint(rng, [col0], 0.12) : tint(rng, rc.pal, 0.18);
      if (top.miss) { top.miss = 0; continue; }
      if (put(ctx, near0 ? near : mid, t2, P2[0], P2[1], P2[2], R2, sc2, sc2, sc2, col, sc2, { item })) placed++;
    }
  }
  // colonies grow in clusters, crowding onto the pinnacles; a few groups stand on the sand between
  for (let k = 0; k < 380 && placed < 520; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s0 = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s0, 'softcoral');
    if (!g) continue;
    const rc = recipeOf(g), side = rng() < 0.5 ? -1 : 1, d0 = 1.8 + Math.pow(rng(), 1.6) * 30, x0 = pc.x(s0) + side * d0;
    const pin = pinAt(g, x0, s0, d0);
    if (rng() > ctx.weightOf(s0, 'softcoral') * rc.dens * (0.12 + sstep(0.2, 2.5, pin))) continue;
    const n = 1 + Math.floor(rng() * (2.5 + 5 * sstep(0.4, 3, pin))), col0 = pick(rng, rc.pal);
    for (let q = 0; q < n; q++) {
      const s = s0 + (rng() - 0.5) * 2.2, x = x0 + (rng() - 0.5) * 2.2, d = Math.abs(x - pc.x(s));
      const isNear = d < 9;
      if (isNear && rng() > lk) continue;
      const tpl = pick(rng, isNear ? S.dNear : S.dMid), sc = (0.85 + Math.pow(rng(), 1.5) * 1.4) * (rng() < 0.03 ? 1.7 : 1);
      const y = fs.at(x, s), nn = [fs.nx, fs.ny, fs.nz];
      if (nn[1] < 0.35) continue;
      const R = upTo(mix3([0, 1, 0], nn, 0.45), rng() * TAU), h = tpl.maxY * sc;
      // soft, but the camera should never fly through a colony's crown
      if (!clearBox(pc, x, s, y, y + h, tpl.r * sc, SOLID, 2.0)) continue;
      const Pp = [x, y, s];
      seat(fs, tpl, R, sc, sc, sc, Pp, nn, 0.03);
      // neighbours share a hue family, as clones of one colony do
      const col = rng() < 0.7 ? tint(rng, [col0], 0.12) : tint(rng, rc.pal, 0.18);
      if (put(ctx, isNear ? near : mid, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, sc)) placed++;
    }
  }  return { batches: [rock, near, mid] };
}

// ---------------------------------------------------------------- chain B: the rest of the garden
export function* layoutSoftB(ctx) {
  const Y = slice();
  if (presence(ctx, 'softcoral') <= 0) return null;
  const bk = budgetK(ctx, 'softcoral'), lk = lowK(ctx);
  const rng = mulberry32(((ctx.s0 * 2246822519) ^ 0x51f8) >>> 0), fs = nbFloor(ctx), pc = pathCache(ctx);
  const st = new Batch(MAT.static, 36000 * bk); st.lod = 'mid';
  const sw = new Batch(MAT.sway, 36000 * bk); sw.lod = 'mid'; sw.soft = true;
  const near = new Batch(MAT.static, 18000 * bk); near.lod = 'mid';
  const labels = [], pois = [], sp = new Space(); // (spacing: nothing grows on top of another colony)
  const place = (b, tpl, x, s, sc, col, follow, kind, tube = 0, embed = 0.03) => {
    const y = fs.at(x, s), n = [fs.nx, fs.ny, fs.nz], rr = tpl.r * sc * 0.75;
    if (!sp.free(x, s, rr)) return null;
    const R = upTo(mix3([0, 1, 0], n, follow), rng() * TAU), h = (tpl.maxY - tpl.minY) * sc;
    if (!clearBox(pc, x, s, y, y + h, tpl.r * sc, kind, tube)) return null;
    const Pp = [x, y, s];
    seat(fs, tpl, R, sc, sc, sc, Pp, n, embed);
    if (!put(ctx, b, tpl, Pp[0], Pp[1], Pp[2], R, sc, sc, sc, col, b === sw ? sc : 1)) return null;
    sp.add(Pp[0], Pp[2], rr);
    return Pp;
  };
  const tables = T.table && T.table.length ? T.table : null, brains = T.brain && T.brain.length ? T.brain : null;
  for (let k = 0; k < 320; k++) {
    if (Y.over()) { yield; Y.reset(); }
    const s = ctx.s0 + rng() * CHUNK, g = segFor(ctx, s, 'softcoral');
    if (!g || rng() > ctx.weightOf(s, 'softcoral')) continue;
    const rc = recipeOf(g), d = 1.5 + Math.pow(rng(), 1.2) * 30, x = pc.x(s) + (rng() < 0.5 ? -1 : 1) * d, pin = pinAt(g, x, s, d);
    const encW = 1.2 + 4 * sstep(0.2, 1.5, pin), u = rng() * (rc.fan + rc.whip + rc.leather + rc.crin * 0.6 + rc.table * 0.7 + encW + 0.5);
    let acc = 0;
    if (u < (acc += rc.fan)) { if (pin > 0.5 || rng() < 0.3) place(sw, pick(rng, S.fan), x, s, 0.8 + rng() * 1.0, tint(rng, FANP, 0.2), 0.2, SOFT, 2.0); }
    else if (u < (acc += rc.whip)) place(sw, pick(rng, S.whip), x, s, 0.8 + rng() * 0.6, tint(rng, [[1.1, 0.35, 0.05], [1.0, 0.1, 0.12], [1.1, 0.8, 0.15]]), 0.3, SOFT, 1.2);
    else if (u < (acc += rc.leather)) place(sw, pick(rng, S.leather), x, s, 0.9 + rng() * 1.0, tint(rng, [[0.95, 0.85, 0.45], [0.7, 0.85, 0.4], [1.0, 0.7, 0.55]]), 0.6, SOLID);
    else if (u < (acc += rc.crin * 0.6)) { if (lk === 1 || rng() < lk) place(sw, pick(rng, S.crin), x, s, 1.0 + rng() * 0.8, tint(rng, [[1.1, 0.85, 0.1], [1.0, 0.35, 0.05], [0.95, 0.1, 0.12], [0.9, 0.9, 0.85], [0.2, 0.2, 0.22]], 0.1), 0.8, SOFT, 0.8, 0.01); }
    else if (u < (acc += rc.table * 0.7)) { if (tables && pin < 1.5) place(st, pick(rng, tables), x, s, 0.8 + rng() * 0.9, tint(rng, [[0.95, 0.55, 0.2], [0.6, 0.78, 0.18], [0.78, 0.3, 0.88]], 0.2), 0.15, SOLID); }
    // encrusting sponges only on rock: the steep flanks of the pinnacles (the bommies get theirs in chain A)
    else if (u < (acc += encW)) { fs.at(x, s); if (fs.ny < 0.7) place(near, pick(rng, S.enc), x, s, 0.6 + rng() * 0.8, tint(rng, ENC, 0.2), 1, SOLID, 0, 0.03); }
    else if (brains) place(st, pick(rng, brains), x, s, 0.4 + rng() * 0.6, tint(rng, [[1.0, 0.5, 0.18], [0.78, 0.28, 0.85], [0.55, 0.8, 0.22]], 0.2), 0.75, SOLID);
  }
  // cleaning station: one coral bommie per segment, beside the path, with a big anemone on top
  for (const g of ctx.segments) {
    if (g.key !== 'softcoral') continue;
    const sC = g.start + (0.25 + 0.5 * sv(g, 15)) * (g.end - g.start);
    if (sC < ctx.s0 || sC >= ctx.s1 || !T.coralMound) continue;
    const side = sv(g, 16) < 0.5 ? -1 : 1;
    for (let tries = 0; tries < 4; tries++) {
      const x = pc.x(sC) + side * (6 + tries * 1.5 + sv(g, 17) * 2);
      const tpl = T.coralMound[(sv(g, 18) * T.coralMound.length) | 0], sc = 1.4;
      const P0 = place(st, tpl, x, sC, sc, [0.95, 0.75, 0.7], 0, SOLID, 0, 0.15); // upright: its top is ray-cast below
      if (!P0) continue;
      const topY = P0[1] + tpl.maxY * sc * 0.85;
      // anemone and soft corals ring the dome: seat each on the mound's real top surface
      const mound = st.items[st.items.length - 1];
      const ring = [[S.anem[0], 0, 0, 1.4, [1, 1, 1]], [pick(rng, S.leather), 0.6, 0.7, 1.1, [0.95, 0.85, 0.45]], [pick(rng, S.crin), -0.6, 0.4, 1.4, [1.1, 0.85, 0.1]]];
      for (const [t2, ox, oz, sc2, col] of ring) {
        const sup = { nx: 0, ny: 1, nz: 0, at: (qx, qs) => moundTop(mound, ctx, qx, qs, fs) };
        const R = rotY(rng() * TAU), Pp = [x + ox, topY, sC + oz];
        seat(sup, t2, R, sc2, sc2, sc2, Pp, null, 0.04);
        put(ctx, sw, t2, Pp[0], Pp[1], Pp[2], R, sc2, sc2, sc2, col, sc2, { item: mound });
      }
      pois.push({ type: 'cleaning-station', x, y: topY + 0.6, s: sC, r: 2.5, data: { name: 'Cleaning station', fact: 'Cleaner wrasse and shrimp pick parasites off fish that queue up for the service' } });
      labels.push(['Cleaning station', x, topY + 0.8, sC, 'Cleaner wrasse and shrimp pick parasites off fish that queue up for the service']);
      break;
    }
  }
  return { batches: [st, sw, near], labels, pois };
}
// exact top of a placed upright mound (vertical ray against its mesh), else the floor
function moundTop(it, ctx, qx, qs, fs) {
  const R = it.R, ox = qx - it.x, oz = -(qs - ctx.s0) - it.z;
  const px = (R[0] * ox + R[6] * oz) / it.sx, pz = (R[2] * ox + R[8] * oz) / it.sz; // yaw-only inverse
  const h = rayY(it.tpl, px, pz, true);
  return h === h ? Math.max(it.y + h * it.sy, fs.at(qx, qs)) : fs.at(qx, qs);
}
