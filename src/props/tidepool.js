// Tide pools: a rocky trough. Rock benches and boulder clusters line both slopes wherever there is water over
// them, crusted with mussels, barnacles, limpets and coralline algae; green and aggregating anemone carpets,
// purple urchins, ochre and bat stars, turban snails, sea lettuce, surfgrass and sea palms fill the channel.
import { Batch, T, TAU, TUBE, vn3, fbm3, floorSampler, presence, sstep, budgetK, bendSpots, vary, Builder, rotY, tierK, poi, pointsClear, placedPoints } from './core.js';
import { anemone, seastar, urchin, musselBed, barnacles, snail, seaLettuce, tuft, grassPatch, rock, rockSet } from './shapes.js';
import { putFloor, putAt, pickW, tintFrom, bendX, microDetail, clusterer, groundY, microSteps, steps } from './scatter.js';
import { MAT } from './materials.js';
import { noise2, mulberry32 } from '../noise.js';

// a scatter of limpets: low ribbed cones with mottled shells
function limpets(seed) {
  const b = new Builder(), rng = mulberry32(seed * 17), n = 3 + Math.floor(rng() * 10);
  for (let k = 0; k < n; k++) {
    const rr = 0.3 * Math.sqrt(rng()), a = rng() * TAU, R = 0.018 + rng() * 0.025, H = R * (0.4 + rng() * 0.5), ribs = 8 + Math.floor(rng() * 10), v0 = b.vc;
    const c = [0.55 + rng() * 0.3, 0.5 + rng() * 0.25, 0.42 + rng() * 0.2];
    b.lathe(10, 3, (v) => [R * (1 - v) * (1 - 0.15 * v), H * Math.sin(v * Math.PI * 0.5)], (an) => 1 + 0.08 * Math.abs(Math.sin(an * ribs / 2)), (v, an, x, y, z, o) => {
      const m = 0.75 + 0.4 * Math.abs(Math.sin(an * 3 + v * 5)); o[3] = c[0] * m; o[4] = c[1] * m; o[5] = c[2] * m; o[7] = 2;
    });
    b.xform(v0, [1, 0, 0, 0, 1, 0, 0, 0, 1], Math.cos(a) * rr, 0, Math.sin(a) * rr, 1, 1, 0.7 + rng() * 0.4);
  }
  return b.build();
}

export function initTidepool() {
  T.tpRock = rockSet(['boulder', 'angular', 'volcanic', 'sediment', 'undercut'], 3, { detail: 3, growth: 1.0 });
  T.tpAnemGreen = [1, 2, 3, 4, 5].map((k) => anemone(50 + k, { tentacles: 18 + k * 5, tlen: 0.18 + k * 0.03, thick: 0.03 + k * 0.003, body: [0.25, 0.35, 0.2], tent: [0.35, 0.75, 0.4], tipC: [1.3, 1.1, 1.4], disc: 0.16 + k * 0.025, height: 0.08 + k * 0.02, rows: 2 + (k % 2) }));
  T.tpAnemPink = [1, 2, 3, 4].map((k) => anemone(60 + k, { tentacles: 20 + k * 5, tlen: 0.16 + k * 0.03, thick: 0.03, body: [0.45, 0.3, 0.3], tent: [0.85, 0.45, 0.6], tipC: [1.2, 1.3, 1.2], disc: 0.15 + k * 0.03, height: 0.1, rows: 2 + (k % 2) }));
  T.tpStar = [1, 2, 3, 4, 5, 6].map((s) => seastar(60 + s, { arms: s === 6 ? 6 : 5, fat: 1.0 + (s % 3) * 0.35, curl: 0.04 + (s % 3) * 0.04 }));
  T.tpUrchin = [1, 2, 3, 4].map((s) => urchin(70 + s, { len: 0.6 + s * 0.15, spines: 36 + s * 6, body: [0.42, 0.22, 0.5] }));
  // clumps sized for dense placement (a mussel is 80 triangles): many small clumps, not a few giant beds
  T.tpMussel = vary([musselBed(81, { n: 20, r: 0.3 }), musselBed(82, { n: 14, r: 0.24 }), musselBed(83, { n: 9, r: 0.17 })], 3, 81, { disp: 0.08, bend: 0.05, twist: 0.5 });
  T.tpBarnacle = vary([barnacles(91, { n: 20, r: 0.28 }), barnacles(92, { n: 14, r: 0.2 }), barnacles(93, { n: 28, r: 0.4 })], 2, 91, { disp: 0.06, bend: 0, twist: 0.5 });
  T.tpSnail = vary([snail(1), snail(2, { col: [0.15, 0.12, 0.1] }), snail(3, { col: [0.45, 0.3, 0.2] })], 3, 101, { disp: 0.12, bend: 0.1 });
  T.tpLimpet = [1, 2, 3, 4, 5].map(limpets);
  T.tpLettuce = [1, 2, 3, 4, 5, 6].map((k) => seaLettuce(k, { n: 2 + k, s: 0.18 + 0.03 * k }));
  T.tpTuft = [tuft(1), tuft(2, { h: 0.09 })];
  T.tpSurf = [1, 2, 3, 4, 5, 6].map((k) => grassPatch(70 + k, { n: 8 + k * 2, r: 0.2 + 0.04 * k, h: 0.3 + 0.06 * k, w: 0.01 + 0.002 * k, segs: 3, base: [0.1, 0.25, 0.06], mid: [0.25, 0.6, 0.12], tipc: [0.35, 0.7, 0.2], sway: 0.3 }));
  T.tpCrust = [1, 2, 3, 4].map((k) => crust(k, 0.45 + 0.15 * k));
  // small aggregating anemones for dense carpets (a third of the triangles of the big ones)
  T.tpAnemSmall = [1, 2, 3, 4, 5].map((k) => anemone(80 + k, { tentacles: 12 + k * 2, tlen: 0.12 + 0.02 * k, thick: 0.028, tseg: 2, rows: 2, disc: 0.1 + 0.015 * k, height: 0.06,
    body: [0.35, 0.4, 0.25], tent: k % 2 ? [0.55, 0.75, 0.45] : [0.85, 0.55, 0.65], tipC: [1.3, 1.1, 1.35] }));
  for (const t of T.tpAnemSmall) { t.label = 'Aggregating anemone'; t.fact = 'Aggregating anemones clone themselves by splitting in two, carpeting rocks with identical copies.'; }
  T.tpSheet = [1, 2, 3, 4, 5].map((k) => rockSheet(k, 1.1 + 0.2 * k));
}

// bedrock showing through the pool's sediment: a draped sheet with knobbly relief (stone texture key,
// coralline and algal growth on its up-facing parts), so the walls read as rock, not a smooth half-pipe
function rockSheet(seed, r) {
  const b = new Builder(), rng = mulberry32(seed * 53 + 11), key = 6.05 + rng() * 0.9;
  const col = [[0.27, 0.25, 0.24], [0.23, 0.23, 0.24], [0.3, 0.26, 0.23]][seed % 3];
  b.grid(16, 4, (u, v, i, j, o) => {
    const a = u * TAU, R = r * (1 + 0.35 * vn3(Math.cos(a) * 1.5, Math.sin(a) * 1.5, seed, seed + 7));
    const rr = Math.pow(v, 0.8) * R, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    o[0] = x; o[2] = z;
    // knobbly ridges and boulders half-buried in the sediment, sinking to nothing at the rim
    o[1] = (0.08 + 0.34 * Math.max(0, fbm3(x * 1.1 + seed, 0.5, z * 1.1, 3, seed))) * (1 - Math.pow(v, 3));
    const c = 0.8 + 0.35 * vn3(x * 2.5, 1, z * 2.5, seed + 2);
    o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[6] = 0.2; o[7] = key; // big flat props: growth <= ~0.25
  }, { wrapU: true, flip: true });
  b.drape = true; b.dLift = 0.01; b.solid = false;
  return b.build();
}

// pink crustose coralline algae painted over the floor: a low lobed draped patch, rugose (polyp texture)
function crust(seed, r) {
  const b = new Builder(), rng = mulberry32(seed * 41 + 3), lob = 4 + Math.floor(rng() * 4), ph = rng() * TAU;
  b.grid(12, 2, (u, v, i, j, o) => {
    const a = u * TAU, R = r * (1 + 0.3 * Math.sin(a * lob + ph) * (0.6 + 0.4 * Math.sin(a * 3 + seed)));
    const rr = v * R;
    o[0] = Math.cos(a) * rr; o[2] = Math.sin(a) * rr; o[1] = (0.012 + 0.03 * Math.max(0, vn3(o[0] * 6, 0, o[2] * 6, seed))) * (1 - v * v);
    const c = 0.8 + 0.3 * vn3(o[0] * 4, 1, o[2] * 4, seed + 3);
    o[3] = 0.6 * c; o[4] = 0.36 * c; o[5] = 0.45 * c; o[6] = 0; o[7] = 2;
  }, { wrapU: true, flip: true });
  b.drape = true; b.dLift = 0.012; b.solid = false;
  b.label = 'Coralline crust'; b.fact = 'Crustose coralline algae build limestone into their cell walls, painting the rocks pink.';
  return b.build();
}

const S = {};
function specs() {
  if (S.rock) return S;
  const rockT = tintFrom([[0.5, 0.4, 0.4], [0.45, 0.42, 0.4], [0.55, 0.45, 0.42], [0.4, 0.38, 0.36]]);
  Object.assign(S, {
    // benches: flattened rock shelves; low encrusting growth so the life on them reads
    // set into the steep walls of the pool (uphill side buried), so they are taller than they are wide
    bench: { tpl: T.tpRock, scale: [0.9, 1.9], ys: [0.8, 1.2], xz: 0.6, grow: [0.15, 0.55], follow: 0.5, sink: 0.12, occ: 0.6, embed: true, tint: rockT },
    big: { tpl: T.tpRock, scale: [0.8, 1.6], ys: [1.1, 1.8], xz: 0.5, grow: [0.15, 0.6], follow: 0.4, sink: 0.12, occ: 0.6, embed: true, tint: rockT },
    boulder: { tpl: T.tpRock, scale: [0.35, 0.95], ys: [0.7, 1.3], xz: 0.5, grow: [0.15, 0.6], follow: 0.6, sink: 0.08, embed: true, tint: rockT },
    rock: { tpl: T.tpRock, scale: [0.2, 0.6], ys: [0.6, 1.1], xz: 0.5, grow: [0.1, 0.6], follow: 0.6, tint: rockT },
    anemG: { tpl: T.tpAnemGreen, scale: [0.5, 1.0], follow: 0.85, sway: true, tint: tintFrom([[1, 1, 1]], 0.15) },
    anemP: { tpl: T.tpAnemSmall, scale: [0.7, 1.3], follow: 0.9, sway: true, tint: tintFrom([[1, 1, 1], [1.05, 0.9, 1.0]], 0.12) },
    star: { tpl: T.tpStar, scale: [0.12, 0.22], follow: 1, sink: 0, tint: tintFrom([[0.85, 0.35, 0.05], [0.5, 0.15, 0.55], [0.75, 0.2, 0.35]]) },
    bat: { tpl: T.tpStar, scale: [0.08, 0.13], follow: 1, sink: 0, tint: tintFrom([[0.95, 0.2, 0.1], [1.0, 0.55, 0.12], [0.55, 0.25, 0.6], [0.8, 0.6, 0.25]], 0.12),
      lbl: 'Bat star', fact: 'Bat stars come in red, orange, purple or mottled, and scavenge by pushing their stomach out over food.' },
    urchin: { tpl: T.tpUrchin, scale: [0.05, 0.09], follow: 0.9, tint: tintFrom([[1, 1, 1]], 0.15) },
    mussel: { tpl: T.tpMussel, scale: [0.8, 1.5], follow: 0.95, tint: tintFrom([[1, 1, 1], [0.7, 0.75, 0.95]]) },
    barnacle: { tpl: T.tpBarnacle, scale: [0.8, 1.4], follow: 1, sink: 0, tint: tintFrom([[1, 1, 1]], 0.1) },
    snail: { tpl: T.tpSnail, scale: [0.03, 0.05], follow: 0.8, tint: tintFrom([[1, 1, 1]], 0.2) },
    limpet: { tpl: T.tpLimpet, scale: [0.8, 1.4], follow: 1, sink: 0, tint: tintFrom([[1, 1, 1]], 0.2) },
    lettuce: { tpl: T.tpLettuce, scale: [0.6, 1.3], follow: 0.7, sway: true, tint: tintFrom([[1, 1, 1], [0.8, 1, 0.7]]) },
    tuft: { tpl: T.tpTuft, scale: [0.8, 1.6], follow: 0.7, tint: tintFrom([[0.85, 0.4, 0.5], [0.75, 0.35, 0.55], [0.9, 0.55, 0.6]]) },
    surf: { tpl: T.tpSurf, scale: [0.8, 1.4], follow: 0.8, sway: true, tint: tintFrom([[1, 1, 1]], 0.15) },
    palm: { tpl: T.seaPalm, scale: [0.6, 1.1], follow: 0.4, sway: true, tint: tintFrom([[1, 1, 1], [1.1, 0.95, 0.8]], 0.15), lbl: 'Sea palm',
      fact: 'Sea palms grow only where waves pound hardest, bending like rubber instead of breaking.' },
    crust: { tpl: T.tpCrust, scale: [0.7, 1.4], follow: 1, tint: tintFrom([[1, 1, 1], [1.05, 0.9, 1.0], [0.95, 0.85, 0.8]], 0.08) },
    sheet: { tpl: T.tpSheet, scale: [0.8, 1.5], follow: 1, grow: [0.5, 1.2], tint: tintFrom([[1, 1, 1], [0.9, 0.95, 1.0], [1.08, 1.0, 0.92]], 0.1) },
    surfBed: { tpl: T.tpSurf, scale: [1.2, 2.0], follow: 0.8, sway: true, tint: tintFrom([[1, 1, 1], [0.9, 1.05, 0.85]], 0.12) },
    kelpTuft: { tpl: T.understory, scale: [0.9, 1.5], follow: 0.6, sway: true, tint: tintFrom([[1, 1, 1], [1.1, 0.95, 0.8]], 0.15), lbl: 'Rockweed',
      fact: 'Rockweed can dry out to a crisp at low tide and plump back up when the sea returns.' },
  });
  // shellfish clumps are floor drapes by default; on a rock they seat on its surface instead
  for (const k of ['mussel', 'barnacle', 'limpet']) S[k + 'R'] = { ...S[k], drape: false, sink: 0.02 };
  S.pebbles = { tpl: T.pebbles, scale: [0.8, 1.6], follow: 1, sink: 0.02, tint: tintFrom([[0.6, 0.55, 0.52], [0.5, 0.45, 0.45]], 0.1) };
  S.micro = [{ w: 3, spec: S.pebbles }, { w: 1.5, spec: S.barnacle }, { w: 1.2, spec: S.snail }, { w: 1.6, spec: S.crust }];
  // what grows on and around a rock (zoned: shellfish and coralline on the rock, anemones and urchins at its foot)
  S.onRock = [
    { w: 1.6, k: 'musselR' }, { w: 1.2, k: 'barnacleR' }, { w: 0.8, k: 'limpetR' }, { w: 1.2, k: 'tuft' }, { w: 1.0, k: 'anemG', sway: true }, { w: 1.2, k: 'anemP', sway: true },
    { w: 0.8, k: 'star' }, { w: 0.6, k: 'bat' }, { w: 1.0, k: 'lettuce', sway: true }, { w: 1.0, k: 'surf', sway: true }, { w: 0.8, k: 'palm', sway: true }, { w: 1.0, k: 'kelpTuft', sway: true }, { w: 0.5, k: 'snail' },
  ];
  S.atFoot = [
    { w: 2.2, k: 'urchin' }, { w: 1.8, k: 'anemG', sway: true }, { w: 1.4, k: 'anemP', sway: true }, { w: 1.0, k: 'star' }, { w: 1.0, k: 'bat' }, { w: 1.2, k: 'surf', sway: true },
    { w: 1.0, k: 'lettuce', sway: true }, { w: 0.8, k: 'rock' }, { w: 0.8, k: 'mussel' },
  ];
  S.list = [ // the channel floor between the benches (all low: the camera passes just above); cheap, wide cover first
    { w: 1.4, k: 'rock' }, { w: 1.2, k: 'anemG', sway: true }, { w: 2.4, k: 'anemP', sway: true }, { w: 0.8, k: 'star' }, { w: 0.8, k: 'bat' }, { w: 1.4, k: 'urchin' },
    { w: 0.4, k: 'mussel' }, { w: 0.3, k: 'barnacle' }, { w: 0.4, k: 'snail' }, { w: 1.8, k: 'lettuce', sway: true }, { w: 0.8, k: 'tuft' }, { w: 3.0, k: 'surfBed', sway: true },
    { w: 1.4, k: 'kelpTuft', sway: true }, { w: 2.0, k: 'crust' },
  ];
  return S;
}

// small items: 'near' LOD (heavy for their size: mussel and barnacle clumps, snails, limpets, stars, urchins)
const NEAR = new Set(['mussel', 'barnacle', 'snail', 'limpet', 'musselR', 'barnacleR', 'limpetR', 'urchin', 'star', 'bat']);
const batchFor = (B, k, sway) => (sway ? (NEAR.has(k) ? B.nsw : B.sw) : NEAR.has(k) ? B.near : B.st);

// a rock outcrop (a support) with life seated on its real surface and around its foot.
// Returns continuation steps (the rock, then 2 life items per step); run them in order, back to back.
function outcrop(ctx, fs, st, B, rng, x, s, size, spec = null) {
  const sp = specs(), n = Math.round((6 + 7 * size) * tierK(ctx));
  let domeR = 0;
  const out = [() => {
    const csc = putFloor(ctx, fs, st, spec || sp.big, x, s, rng, size);
    domeR = csc ? T.tpRock[0].r * csc * 0.8 : 0;
  }];
  for (let k0 = 0; k0 < n; k0 += 2) out.push(() => {
    for (let k = k0; k < Math.min(n, k0 + 2); k++) {
      const on = domeR > 0 && rng() < 0.6, e = pickW(rng, on ? sp.onRock : sp.atFoot), a = rng() * TAU;
      const rr = on ? domeR * 0.85 * Math.sqrt(rng()) : domeR * 0.8 + 0.2 + rng() * 0.9;
      putFloor(ctx, fs, batchFor(B, e.k, e.sway), sp[e.k], x + Math.cos(a) * rr, s + Math.sin(a) * rr, rng, 1);
    }
  });
  return out;
}

// water over the bare floor at (x, s) (<= 0: dry rock above the tide)
const depthAt = (ctx, fs, x, s) => ctx.surfaceY - fs.floor(x, s);

// small natural arches beside the path every 300-700 m (fish swim through; the camera passes by)
const segSets = new Map();
function tideSet(seg) {
  let S = segSets.get(seg.id);
  if (S && S.seed === seg.seed) return S;
  const rng = mulberry32(seg.seed ^ 0x71de);
  S = { seed: seg.seed, arches: [] };
  for (let a = seg.start + 120 + rng() * 200; a < seg.end - 80; a += 300 + rng() * 400) S.arches.push({ s: a, k: (rng() * 1e9) | 0 });
  segSets.set(seg.id, S);
  if (segSets.size > 24) segSets.delete(segSets.keys().next().value);
  return S;
}
function smallArch(ctx, fs, st, life, rng, s) {
  const tpl = rng.pick(T.archSmall), side = rng() < 0.5 ? -1 : 1, fl = { at: (x, ss) => fs.floor(x, ss) };
  const yaw = Math.atan2(-(ctx.pathX(s + 3) - ctx.pathX(s - 3)), 6) + (rng() - 0.5) * 0.6, R = rotY(yaw);
  for (let d = TUBE + tpl.arch.A + 2.5; d < TUBE + tpl.arch.A + 9; d += 1) {
    const x = ctx.pathX(s) + side * d;
    const y = groundY(fl, x, s, tpl, R, 1, 1, 1) - (tpl.arch.depth - 0.5); // legs sunk, ~0.5 m of them showing
    if (!pointsClear(ctx, placedPoints(tpl, x, y, s, R, 1, 1, 1, 400), 0.4)) continue;
    if (!st.add(tpl, x, y, -(s - ctx.s0), R, 1, 1, 1, 0.9 + rng() * 0.15, 0.85 + rng() * 0.15, 0.85 + rng() * 0.15, 0.8 + rng() * 0.5)) return;
    const it = st.last;
    it.g = 1; it.lbl = 'Small rock arch';
    fs.addSupport(it, s);
    poi(ctx, 'arch', x, y + tpl.arch.clear * 0.5 + 0.3, s, tpl.arch.A, { kind: 'small rock arch' });
    for (let k = 0; k < 10; k++) { // crusted with life
      const e = pickW(rng, specs().onRock), t = (rng() - 0.5) * 2.2;
      putFloor(ctx, fs, batchFor(life, e.k, e.sway), specs()[e.k], x + Math.cos(yaw) * tpl.arch.A * t, s - Math.sin(yaw) * tpl.arch.A * t + (rng() - 0.5) * 1.2, rng, 1);
    }
    return;
  }
}

export function layoutTidepool(ctx) {
  if (presence(ctx, 'tidepool') <= 0) return null;
  const sp = specs(), rng = ctx.rng, fs = floorSampler(ctx), bk = budgetK(ctx, 'tidepool'), tk = tierK(ctx);
  const st = new Batch(MAT.static, 48000 * bk);                                                              // benches, boulders, arches
  const B = {
    st: new Batch(MAT.static, 40000 * bk * tk, 'mid'), sw: new Batch(MAT.sway, 62000 * bk * tk, 'mid'),
    near: new Batch(MAT.static, 44000 * bk * tk, 'near'), nsw: new Batch(MAT.sway, 6000 * bk * tk, 'near'),
  };
  const sheets = new Batch(MAT.static, 22000 * bk, 'mid');
  const idx = Math.floor(ctx.s0 / 64), more = [];
  for (const seg of ctx.segments) {
    if (seg.key !== 'tidepool') continue;
    for (const a of tideSet(seg).arches) if (Math.floor(a.s / 64) === idx) more.push(() => smallArch(ctx, fs, st, B, mulberry32(a.k), a.s));
  }
  // the channel floor: cobbles, anemone carpets, urchin clusters, surfgrass, sea lettuce, stars
  const nextP = clusterer(ctx, rng, 0, 6.5, 1.0, { r: [0.4, 1.8], n: [3, 12], single: 0.15, patch: 9, seed: 23 });
  more.push(...steps(Math.round(480 * tk), 8, () => {
    const p = nextP();
    if (!p) return;
    const w = ctx.weightOf(p.s, 'tidepool') * (0.65 + 0.35 * noise2(p.x / 5, p.s / 5, 811));
    if (rng() > w || depthAt(ctx, fs, p.x, p.s) < 0.4) return;
    const e = pickW(rng, sp.list);
    putFloor(ctx, fs, batchFor(B, e.k, e.sway), sp[e.k], p.x, p.s, rng, 1.05);
  }));
  // rock benches and boulder clusters all along both slopes of the pool, where there is water over them
  // (the pool is a trough: beyond ~8 m the floor rises out of the water); each sized to the depth there
  for (const side of [-1, 1]) for (let s = ctx.s0 + rng() * 3; s < ctx.s1; s += 2.4 + rng() * 2.2) {
    if (rng() > ctx.weightOf(s, 'tidepool')) continue;
    const u = rng(), cl = rng(), kind = rng();
    more.push(() => {
      // the camera's clearance tube fills most of a narrow pool: a rock may only be as wide as the gap
      // between its spot and the tube allows (radius <= d - 4.1), and as tall as the water over it
      const px = ctx.pathX(s), ok = [];
      for (let d = 5; d <= 15; d += 0.5) { const h = depthAt(ctx, fs, px + side * d, s); if (h > 0.45 && h < 3.4) ok.push(d); }
      if (!ok.length) return;
      const d = ok[Math.floor(u * ok.length)] + (rng() - 0.5) * 0.4, x = px + side * d;
      const fit = Math.max(0.3, Math.min(1.25, (d - 4.1) / 2.7));
      more.unshift(...outcrop(ctx, fs, st, B, rng, x, s, fit, kind < 0.5 ? sp.bench : sp.big), () => {
        for (let k = 0, n = Math.floor(cl * 2.6); k < n; k++) { // satellite boulders
          const a = rng() * TAU, r = 1.2 + rng() * 1.6;
          putFloor(ctx, fs, st, sp.boulder, x + Math.cos(a) * r, s + Math.sin(a) * r, rng);
        }
      });
    });
  }
  // bedrock sheets over the walls (and here and there the floor) of the pool, wherever there is water over them
  for (let r0 = 0; r0 < 64; r0 += 16) more.push(() => {
    for (let s = ctx.s0 + r0 + 1.2; s < ctx.s0 + r0 + 16; s += 2.6) {
      const w = ctx.weightOf(s, 'tidepool'), px = ctx.pathX(s);
      if (w <= 0) continue;
      for (const side of [-1, 1]) for (let d = 0.6 + rng(); d < 11; d += 2.2 + rng() * 1.2) { // mostly the walls; patches of bedrock on the floor
        const ss = s + (rng() - 0.5) * 2, x = px + side * d;
        if (rng() > w * (d < 3.5 ? 0.35 : 0.6) || depthAt(ctx, fs, x, ss) < 0.15) continue;
        putFloor(ctx, fs, sheets, sp.sheet, x, ss, rng);
      }
    }
  });
  for (const b of bendSpots(ctx)) if (rng() < ctx.weightOf(b.s, 'tidepool') * 0.8) { const x = bendX(ctx, b, 2.4, rng, 1.0); more.push(...outcrop(ctx, fs, st, B, rng, x, b.s, 1.1)); }
  more.push(...microSteps(ctx, fs, B.near, rng, 'tidepool', sp.micro, 110, 12, 12));
  return { batches: [st, sheets, B.st, B.sw, B.near, B.nsw], more };
}
