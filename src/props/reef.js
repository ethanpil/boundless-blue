// Coral reef: a framework of knolls (low mounds whose surface is a mosaic of encrusting colonies, with raised
// colonies of many growth forms), pavement between them, coral heads (bommies) and scattered life.
import { Builder, Batch, T, TAU, fbm3, vn3, sat, sstep, lerp, floorSampler, presence, budgetK, bendSpots, rotX, rotY, rotZ, mul3, tierK, poi, pointsClear, placedPoints } from './core.js';
import { rockInto, branchesInto, seaFan, tubeSponges, softCoral, leatherCoral, anemone, seaWhips, seastar, urchin } from './shapes.js';
import { putAt, putFloor, pickW, tintFrom, spot, bendX, microDetail, microSteps, steps, clusterer, groundY } from './scatter.js';
import { MAT } from './materials.js';
import { mulberry32, noise2 } from '../noise.js';

// ---------- reef-specific templates ----------
function staghorn(seed) {
  const b = new Builder(), rng = mulberry32(seed), n = 2 + Math.floor(rng() * 5);
  const depth = 2 + Math.floor(rng() * 2.5), spread = 0.4 + rng() * 0.4, up = 0.08 + rng() * 0.14, rad = 0.045 + rng() * 0.025;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rng(), r = k ? 0.1 + rng() * 0.25 : 0;
    branchesInto(b, rng, {
      depth, len: 0.22 + rng() * 0.18, rad, radial: 4, segs: 2, kids: [1, 2 + (rng() < 0.4 ? 1 : 0)], spread, up, wiggle: 0.2 + rng() * 0.25,
      lenK: 0.75 + rng() * 0.2, radK: 0.8, tipK: 0.55, childAt: [0.35 + rng() * 0.25, 1],
      paint(level, v, x, y, z, o) { const t = sat(y / 0.9); o[3] = o[4] = o[5] = 0.45 + 0.6 * t + (level === depth ? 0.3 * v : 0); o[7] = 2; },
    }, [Math.cos(a) * r, 0, Math.sin(a) * r], [Math.cos(a) * (0.2 + rng() * 0.6), 1, Math.sin(a) * (0.2 + rng() * 0.6)]);
  }
  const t = b.build(); t.label = 'Staghorn coral'; return t;
}

function elkhorn(seed) {
  const b = new Builder(), rng = mulberry32(seed);
  for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
    const a = rng() * TAU;
    branchesInto(b, rng, {
      depth: 2, len: 0.35 + rng() * 0.25, rad: 0.09 + rng() * 0.04, radial: 5, segs: 2, kids: [2, 3], spread: 0.6 + rng() * 0.4, up: 0.02, wiggle: 0.3,
      lenK: 0.75, radK: 0.75, tipK: 0.6, childAt: [0.6, 1],
      paint(level, v, x, y, z, o) { const t = sat(y / 0.8); o[3] = o[4] = o[5] = 0.5 + 0.55 * t; o[7] = 2; },
    }, [0, 0, 0], [Math.cos(a), 0.6 + rng() * 0.4, Math.sin(a)]);
  }
  b.xform(0, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0, 0, 0, 1, 0.6, 1); // flattened, antler-like
  const t = b.build(); t.label = 'Elkhorn coral'; return t;
}

function fingerCoral(seed) {
  const b = new Builder(), rng = mulberry32(seed), n = 10 + Math.floor(rng() * 22), R = 0.18 + rng() * 0.2;
  for (let k = 0; k < n; k++) {
    const rr = R * Math.sqrt(rng()), a = rng() * TAU, h = (0.12 + rng() * 0.28) * (1 - 0.5 * rr / R), r = 0.022 + rng() * 0.018;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr, lx = (rng() - 0.5) * 0.08, lz = (rng() - 0.5) * 0.08;
    b.tube([[x, 0, z], [x + lx * 0.5, h * 0.5, z + lz * 0.5], [x + lx, h, z + lz]], [r * 1.1, r, r * 0.9], 5, (v, an, px, py, pz, o) => { o[3] = o[4] = o[5] = 0.55 + 0.55 * v; o[7] = 2; }, { tip: true });
  }
  const t = b.build(); t.label = 'Finger coral'; return t;
}

function pillarCoral(seed) {
  const b = new Builder(), rng = mulberry32(seed), n = 3 + Math.floor(rng() * 7);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, rr = k ? 0.12 + rng() * 0.35 : 0, h = 0.5 + rng() * 1.6, r = 0.07 + rng() * 0.08, v0 = b.vc;
    b.lathe(10, 6, (v) => [r * (v > 0.85 ? Math.sqrt(Math.max(0, 1 - ((v - 0.85) / 0.15) ** 2)) : 1) * (1 + 0.08 * Math.sin(v * 13 + k)), v * h], (an, v) => 1 + 0.07 * vn3(Math.cos(an) * 2, v * 6, Math.sin(an) * 2, seed + k),
      (v, an, x, y, z, o) => { o[3] = o[4] = o[5] = 0.5 + 0.55 * v; o[7] = 2; });
    b.xform(v0, [1, 0, 0, 0, 1, 0, 0, 0, 1], Math.cos(a) * rr, 0, Math.sin(a) * rr);
  }
  const t = b.build(); t.label = 'Pillar coral'; return t;
}

// one plate (top, underside, rim) at height y, tilted. The top carries fine radial ridges (the branchlets of
// a table Acropora) and a raised, paler growing rim tipped violet-blue; the underside is lighter than a
// shadow (light gets under a table). curl > 0 rolls the rim up into a cup or scroll (Turbinaria whorls).
const RIM = [0.78, 0.8, 1.25];
function plate(b, seed, Rmax, y0, dish, tx, tz, ox = 0, oz = 0, curl = 0) {
  // tessellation follows size: small cups need far fewer segments than a 2 m table
  const v0 = b.vc, NU = Rmax < 0.5 ? Math.round(8 + Rmax * 14) : Math.max(14, Math.min(30, Math.round(12 + Rmax * 18))), NT = Rmax < 0.5 ? 3 : 5;
  const nr = 18 + (seed % 9) * 3;
  const R = (a) => Rmax * (1 + 0.18 * vn3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, seed, seed) + 0.05 * Math.sin(a * 9 + seed));
  const Y = (r, a) => dish * r * r + curl * Math.pow(r, 3) * (1 + 0.6 * Math.sin(a * 2 + seed)) + 0.022 * vn3(Math.cos(a) * r * 3, Math.sin(a) * r * 3, 1, seed + 3);
  const relief = (r, a) => 0.012 * r * Math.abs(Math.sin(a * nr + 2.2 * vn3(Math.cos(a) * 2, Math.sin(a) * 2, r * 3, seed + 5))); // radial branchlets
  b.grid(NU, NT, (u, v, i, j, o) => {
    const a = u * TAU, r = v * R(a), lip = sstep(0.82, 1, v);
    o[0] = Math.cos(a) * r; o[1] = Y(v, a) + relief(v, a) + 0.035 * lip * Rmax; o[2] = Math.sin(a) * r;
    // living tissue (mode 2): flat tops in mode 0 caught the full sediment dusting and read as pale doilies
    const c = 0.8 + 0.25 * v; o[3] = c * lerp(1, RIM[0], lip); o[4] = c * lerp(1, RIM[1], lip); o[5] = c * lerp(1, RIM[2], lip); o[7] = 2;
  }, { wrapU: true, flip: true });
  b.grid(NU, 2, (u, v, i, j, o) => { const a = u * TAU, rv = 1 - v, r = rv * R(a); o[0] = Math.cos(a) * r; o[1] = Y(rv, a) - 0.05 * (1 - 0.6 * rv); o[2] = Math.sin(a) * r; o[3] = o[4] = o[5] = 0.5 + 0.18 * rv; o[7] = 2; }, { wrapU: true, flip: true });
  b.grid(NU, 1, (u, v, i, j, o) => { const a = u * TAU, r = R(a); o[0] = Math.cos(a) * r; o[1] = Y(1, a) + 0.035 * Rmax - (0.035 + 0.035 * Rmax) * v; o[2] = Math.sin(a) * r; o[3] = RIM[0]; o[4] = RIM[1]; o[5] = RIM[2]; o[7] = 2; }, { wrapU: true, flip: true });
  b.xform(v0, mul3(rotX(tx), rotZ(tz)), ox, y0, oz);
}

function tableCoral(seed) {
  const b = new Builder(), rng = mulberry32(seed), stalk = 0.16 + rng() * 0.25, tiers = rng() < 0.7 ? 1 : 2;
  // a stout central stalk flaring into the table
  b.lathe(9, 3, (v) => [0.11 + 0.1 * v * v, v * stalk], null, (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.45 + 0.3 * v; });
  for (let k = 0; k < tiers; k++) plate(b, seed * 7 + k, (1.0 - k * 0.3) * (0.8 + rng() * 0.45), stalk + k * (0.16 + rng() * 0.12), 0.06 + rng() * 0.1, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.15 * k, (rng() - 0.5) * 0.15 * k);
  const t = b.build(); t.label = 'Table coral'; return t;
}

function plateCoral(seed) { // whorls of tilted, curling cups and scrolls (Turbinaria, Montipora), spiralling up
  const b = new Builder(), rng = mulberry32(seed), n = 3 + Math.floor(rng() * 4), a0 = rng() * TAU;
  for (let k = 0; k < n; k++) {
    const a = a0 + k * 2.4 + (rng() - 0.5) * 0.5, h = 0.04 + k * 0.07 + rng() * 0.06, lean = 0.35 + rng() * 0.45;
    plate(b, seed * 11 + k, 0.2 + rng() * 0.25, h, 0.3 + rng() * 0.4, Math.cos(a) * lean, Math.sin(a) * lean, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.35 + rng() * 0.6);
  }
  const t = b.build(); t.label = 'Plate coral'; return t;
}

function mushroomCoral(seed) {
  const b = new Builder(), rng = mulberry32(seed), el = 1 + rng() * 0.6, ridges = 24 + Math.floor(rng() * 20);
  b.blob(3, (x, y, z, o) => {
    const th = Math.atan2(z, x), py = y > 0 ? y * 0.22 : y * 0.08;
    const rid = 0.025 * Math.abs(Math.sin(th * ridges / 2)) * Math.max(0, y);
    o[0] = x * el * (1 + rid); o[1] = py + 0.03 + rid * 0.3 - 0.08 * (x * x + z * z) * (y > 0 ? 1 : 0); o[2] = z * (1 + rid);
    const c = y > 0 ? 0.9 + 0.3 * Math.abs(Math.sin(th * ridges / 2)) : 0.4; o[3] = o[4] = o[5] = c; o[7] = 0;
  });
  const t = b.build(); t.label = 'Mushroom coral'; return t;
}

function lettuceCoral(seed) {
  const b = new Builder(), rng = mulberry32(seed), n = 4 + Math.floor(rng() * 6);
  for (let k = 0; k < n; k++) {
    const yaw = rng() * Math.PI, ox = (rng() - 0.5) * 0.5, oz = (rng() - 0.5) * 0.5, H = 0.18 + rng() * 0.25, W = 0.25 + rng() * 0.3, fq = 6 + rng() * 8;
    for (const side of [1, -1]) {
      const v0 = b.vc;
      b.grid(10, 3, (u, v, i, j, o) => {
        const x = (u - 0.5) * W * (1 - 0.3 * v), y = v * H * (1 - 0.4 * Math.abs(u - 0.5));
        const ruffle = 0.05 * Math.sin(u * fq + k) * v + 0.012 * side;
        o[0] = x; o[1] = y; o[2] = ruffle; o[3] = o[4] = o[5] = 0.5 + 0.6 * v; o[7] = 2;
      }, { flip: side < 0 });
      b.xform(v0, rotY(yaw), ox, 0, oz);
    }
  }
  const t = b.build(); t.label = 'Lettuce coral'; return t;
}

function brainCoral(seed) {
  const b = new Builder(), rng = mulberry32(seed), sq = 0.5 + rng() * 0.4, lob = 0.05 + rng() * 0.22, ex = 0.8 + rng() * 0.5, key = 0.62 + rng() * 0.76;
  b.blob(4, (x, y, z, o) => {
    const d = 1 + lob * fbm3(x * 1.4 + seed, y * 1.4, z * 1.4, 2, seed);
    const py = y >= 0 ? y * sq : y * 0.15;
    o[0] = x * d * ex; o[1] = (py + 0.08) * d; o[2] = z * d / Math.sqrt(ex);
    const ao = 0.35 + 0.65 * sstep(-0.15, 0.5, y);
    o[3] = o[4] = o[5] = ao; o[6] = 0; o[7] = key;
  });
  const t = b.build(); t.label = 'Brain coral'; return t;
}

function boulderCoral(seed) {
  const b = new Builder(), rng = mulberry32(seed), lumps = 0.2 + rng() * 0.25, fr = 0.9 + rng() * 1.2, h = 0.6 + rng() * 0.5;
  b.blob(4, (x, y, z, o) => {
    const d = 1 + lumps * fbm3(x * fr + seed, y * fr, z * fr, 3, seed) + 0.08 * vn3(x * 4, y * 4, z * 4, seed + 1);
    let py = y * d; if (py < -0.15) py = -0.15 + (py + 0.15) * 0.15;
    o[0] = x * d * 1.25; o[1] = (py + 0.15) * h; o[2] = z * d * 1.05;
    const ao = 0.35 + 0.65 * sstep(-0.1, 0.6, y);
    o[3] = o[4] = o[5] = ao; o[6] = 0.35; o[7] = 2;
  });
  const t = b.build(); t.label = 'Massive Porites coral'; return t;
}

function barrelSponge(seed) {
  const b = new Builder(), rng = mulberry32(seed), H = 0.8 + rng() * 0.7, w = 0.32 + rng() * 0.14, bul = 0.3 + rng() * 0.4, rid = 5 + Math.floor(rng() * 6), neck = 0.6 + rng() * 0.35;
  const prof = (v) => w * (neck + bul * Math.sin(v * 2.4 + 0.35));
  b.lathe(16, 8, (v) => [prof(v), v * H], (a, v) => 1 + 0.09 * Math.abs(Math.sin(a * rid + v * 0.5)) + 0.06 * vn3(Math.cos(a) * 2, v * 3, Math.sin(a) * 2, seed),
    (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.35 + 0.65 * sstep(0, 0.4, v); o[7] = 2; });
  b.grid(16, 1, (u, v, i, j, o) => { const a = u * TAU, R = lerp(prof(1) * 1.04, prof(1) * 0.78, v); o[0] = Math.cos(a) * R; o[1] = H + 0.01; o[2] = Math.sin(a) * R; o[3] = o[4] = o[5] = 1; }, { wrapU: true });
  b.lathe(16, 2, (v) => [prof(1 - v * 0.7) * 0.78, H * (1 - v * 0.7)], null, (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.45 - 0.38 * v; }, { flip: true });
  const t = b.build(); t.label = 'Giant barrel sponge'; return t;
}

function vaseSponge(seed) {
  const b = new Builder(), rng = mulberry32(seed), H = 0.4 + rng() * 0.5, fl = 1.6 + rng() * 1.6, r0 = 0.05 + rng() * 0.04;
  const prof = (v) => r0 * (1 + fl * v * v);
  b.lathe(14, 6, (v) => [prof(v), v * H], (a, v) => 1 + 0.12 * vn3(Math.cos(a) * 1.5, v * 3, Math.sin(a) * 1.5, seed) * v,
    (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.45 + 0.6 * v; o[7] = 2; });
  b.lathe(14, 3, (v) => [prof(1 - v * 0.8) * 0.85, H * (1 - v * 0.8)], null, (v, a, x, y, z, o) => { o[3] = o[4] = o[5] = 0.5 - 0.35 * v; }, { flip: true });
  b.grid(14, 1, (u, v, i, j, o) => { const a = u * TAU, R = lerp(prof(1), prof(1) * 0.85, v); o[0] = Math.cos(a) * R; o[1] = H; o[2] = Math.sin(a) * R; o[3] = o[4] = o[5] = 1; }, { wrapU: true });
  const t = b.build(); t.label = 'Vase sponge'; return t;
}

function giantClam(seed, mantle) {
  const b = new Builder(), rng = mulberry32(seed), el = 0.42 + rng() * 0.2, ri = 10 + rng() * 6, lipA = 0.025 + rng() * 0.02, th = 0.26 + 0.04 * (seed % 3);
  b.blob(3, (x, y, z, o) => {
    let px = x * el, py = y * 0.24, pz = z * th;
    const lip = 0.1 + lipA * Math.sin(x * 24);
    pz *= 1 + 0.12 * Math.abs(Math.sin(x * ri));
    if (py < -0.12) py = -0.12 + (py + 0.12) * 0.2;
    let c, f = 0;
    if (py > lip) {
      py = lip + (py - lip) * 0.45;
      const sp = vn3(x * 9, y * 9, z * 9, seed) > 0.35 ? 1.6 : 1;
      c = [mantle[0] * sp, mantle[1] * sp, mantle[2] * sp];
      f = 0.075;                                     // mantle withdraws
    } else {
      const ao = 0.45 + 0.55 * sat((py + 0.12) / 0.22);
      c = [0.72 * ao, 0.7 * ao, 0.64 * ao];
      if (py > lip - 0.05) f = -0.07 * sat((py - lip + 0.05) / 0.05); // valve lips close in
    }
    o[0] = px; o[1] = py + 0.12; o[2] = pz; o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = f; o[7] = 8;
  });
  b.label = 'Giant clam'; b.fact = 'Giant clams farm algae in their mantles and can live for over a century.';
  return b.build();
}

// Coral head (shared T.coralMound, also used by other zones): a massive colony or a knot of them. Shapes
// vary (dome, lobed, knobbly twin, flattened shelf, columnar hummock) and so does the surface: polyp
// texture, brain meanders (keys 0.6-1.4) or dead framework (stone keys 6.x) with turf and coralline algae.
function coralHead(sd) {
  const b = new Builder(), rng = mulberry32(sd * 977 + 13), kind = sd % 4;
  const base = { detail: 4, sx: 1.2 + (sd % 3) * 0.15, sy: 0.65 + (sd % 4) * 0.08, sz: 1.0 + (sd % 2) * 0.2, rough: 0.35 + (sd % 3) * 0.06, flat: 0.15, growth: 0, col: [1, 1, 1] };
  if (kind === 1) { // lobed: several massive colonies fused
    rockInto(b, sd, { ...base, detail: 3, sx: base.sx * 0.8, sy: base.sy * 1.1 });
    for (let k = 0; k < 2 + (sd % 2); k++) {
      const v0 = b.vc, a = rng() * TAU, r = 0.55 + rng() * 0.35;
      rockInto(b, sd * 7 + k, { ...base, detail: 3, sx: 0.55 + rng() * 0.3, sy: 0.45 + rng() * 0.3, sz: 0.5 + rng() * 0.3, rough: 0.3 });
      b.xform(v0, rotY(rng() * TAU), Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  } else if (kind === 2) rockInto(b, sd, { ...base, sy: base.sy * 0.6, sx: base.sx * 1.15, flat: 0.25, rough: 0.42 }); // flattened shelf
  else if (kind === 3) rockInto(b, sd, { ...base, sy: base.sy * 1.35, sx: base.sx * 0.8, sz: base.sz * 0.8, rough: 0.28, strata: 0.05 }); // columnar hummock
  else rockInto(b, sd, base);
  const tex = rng(), key = tex < 0.45 ? 2 : tex < 0.7 ? 0.62 + rng() * 0.76 : 6.05 + rng() * 0.9;
  const grow = key > 5 ? 0.32 : key > 1.5 ? 0.3 : 0.1;
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => { o[3] = grow; o[4] = key; });
  const t = b.build();
  if (key > 5) { t.label = 'Reef rock'; t.fact = 'Most of a reef is old coral skeleton, cemented by coralline algae and riddled with burrows.'; }
  return t;
}

// ---------- living reef framework: colonies of contrasting growth form, colour and surface ----------
// A real reef is a mosaic of colonies jostling for space over dead framework, not rock with a few corals
// on it. These builders add one colony to b at (x, z), each with its own colour (linear) and surface mode
// and no encrusting growth (living tissue stays clean). Every colony's base sits at y = -0.03, level with
// the dead-framework pad, so the whole contact band touches the ground and nothing overhangs a gap.
const BASE_Y = -0.03;
const pickC = (rng, pal) => pal[(rng() * pal.length) | 0];
// massive dome (Porites, favids, brain corals): a hemisphere, gently lobed (lump), on a flat base
function domeInto(b, rng, x, z, r, h, detail, col, key, lump = 0.12, freq = 1.3) {
  const sd = (rng() * 9973) | 0, ex = 0.85 + rng() * 0.3;
  return b.blob(detail, (nx, ny, nz, o) => {
    const d = 1 + lump * fbm3(nx * freq + sd, ny * freq, nz * freq, 2, sd);
    const up = ny > 0 ? ny : 0;
    o[0] = x + nx * r * d * ex; o[1] = BASE_Y + up * h * d; o[2] = z + nz * r * d / ex;
    const ao = 0.5 + 0.5 * sstep(0, 0.6, ny);
    o[3] = col[0] * ao; o[4] = col[1] * ao; o[5] = col[2] * ao; o[6] = 0; o[7] = key;
  });
}
// corymbose / bushy colony (Acropora, Pocillopora): a flat-topped cushion of knobs; the surface mode 9
// draws the branch tips, the vertex colour pales (or turns violet / blue) toward the growing tips
function bushInto(b, rng, x, z, r, h, detail, col, tipC) {
  const sd = (rng() * 9973) | 0, f = 2.6 + rng() * 1.4, tipK = rng() * 0.6;
  return b.blob(detail, (nx, ny, nz, o) => {
    const k = 1 + 0.14 * vn3(nx * f + sd, ny * f, nz * f, sd) + 0.07 * vn3(nx * f * 2.3, ny * f * 2.3, nz * f * 2.3, sd + 1);
    const up = ny > 0 ? Math.pow(ny, 0.55) : 0;
    o[0] = x + nx * r * k; o[1] = BASE_Y + up * h * k; o[2] = z + nz * r * k;
    const t = sstep(0.25, 1, ny), ao = 0.55 + 0.45 * sstep(0, 0.5, ny);
    for (let c = 0; c < 3; c++) o[3 + c] = lerp(col[c], tipC[c], t * 0.55) * ao;
    o[6] = 0; o[7] = 9 + tipK * 0.4;
  });
}
// foliose cup or scroll (Turbinaria, foliose Montipora): one tilted, curling plate rising from the surface
// at its centre (y0), its low edge dipping into it, with a paler, violet-tipped growing rim. Anything that
// would reach below the template's base is pressed flat onto it, so the knoll's contact band stays level.
function cupInto(b, rng, x, z, r, y0, col) {
  // plate()'s dish and curl are rim heights in metres: scaled by the radius so a cup stays a vase or a
  // bowl (rim ~0.8-1.4 r up) instead of a tall curled blade standing on edge
  const v0 = b.vc, a = rng() * TAU, lean = 0.15 + rng() * 0.25;
  plate(b, (rng() * 9973) | 0, r, y0 + 0.02, r * (0.5 + rng() * 0.4), Math.cos(a) * lean, Math.sin(a) * lean, x, z, r * (0.3 + rng() * 0.4));
  b.paint(v0, (i, X, Y, Z, nx, ny, nz, o) => { o[0] *= col[0]; o[1] *= col[1]; o[2] *= col[2]; });
  floorClamp(b, v0);
  return v0;
}
// keep everything added since v0 at or above the template's base (the knoll's contact band stays level)
const floorClamp = (b, v0) => { for (let i = v0; i < b.vc; i++) b.P[i * 3 + 1] = Math.max(BASE_Y + 0.005, b.P[i * 3 + 1]); };
// branching colony (staghorn, bottlebrush Acropora): a few thick, tapering antlers rising from the surface
// at y0, paling toward the growing tips (low-poly: the colony list carries the detailed staghorn)
function branchInto(b, rng, x, z, r, h, y0, col, tipC) {
  const v0 = b.vc, n = 2 + Math.floor(rng() * 3), yb = Math.max(BASE_Y + 0.005, y0 - 0.05);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, rr = r * 0.4 * Math.sqrt(rng());
    branchesInto(b, rng, {
      depth: 2, len: h * (0.34 + rng() * 0.12), rad: 0.03 + r * 0.04, radial: 3, segs: 1, kids: [1, 2], spread: 0.5 + rng() * 0.3, up: 0.25, wiggle: 0.25,
      lenK: 0.8, radK: 0.75, tipK: 0.5, childAt: [0.55, 1],
      paint(level, v, X, Y, Z, o) { const t = sat((Y - yb) / h); for (let c = 0; c < 3; c++) o[3 + c] = lerp(col[c], tipC[c], t * 0.6) * (0.55 + 0.5 * t); o[6] = 0; o[7] = 2; },
    }, [x + Math.cos(a) * rr, yb, z + Math.sin(a) * rr], [Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45]);
  }
  floorClamp(b, v0);
  return v0;
}
// small table coral on a short stalk rising from the surface at y0 (small-plate tessellation: R < 0.5)
function tableInto(b, rng, x, z, R, y0, col) {
  const v0 = b.vc, stalk = 0.12 + rng() * 0.14, yb = y0 - 0.04;
  b.lathe(6, 2, (v) => [0.05 + 0.06 * R + 0.05 * v * v, yb + v * (stalk + 0.04)], null, (v, a, X, Y, Z, o) => { const c = 0.45 + 0.3 * v; o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[7] = 2; });
  b.xform(v0, [1, 0, 0, 0, 1, 0, 0, 0, 1], x, 0, z);
  const v1 = b.vc;
  plate(b, (rng() * 9973) | 0, R, y0 + stalk, 0.05 + rng() * 0.06, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12, x, z);
  b.paint(v1, (i, X, Y, Z, nx, ny, nz, o) => { o[0] *= col[0]; o[1] *= col[1]; o[2] *= col[2]; });
  floorClamp(b, v0);
  return v0;
}
// digitate clump (finger Porites, digitate Acropora): short, fat, blunt fingers rising from one base
function digitsInto(b, rng, x, z, r, h, col) {
  const v0 = b.vc, n = 3 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) {
    const rr = r * Math.sqrt(rng()) * 0.8, a = rng() * TAU, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
    const hh = h * (0.55 + 0.45 * rng()) * (1 - 0.35 * rr / r), w = r * (0.13 + 0.07 * rng()), lx = (rng() - 0.5) * 0.3 * hh, lz = (rng() - 0.5) * 0.3 * hh;
    b.tube([[px, BASE_Y, pz], [px + lx * 0.5, BASE_Y + hh * 0.55, pz + lz * 0.5], [px + lx, BASE_Y + hh, pz + lz]], [w * 1.15, w, w * 0.85], 4, (v, an, X, Y, Z, o) => {
      const c = 0.6 + 0.45 * v; o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[6] = 0; o[7] = 2;
    }, { tip: true });
  }
  return v0;
}

// colony palettes (linear; per colony, so neighbours differ): golden-brown, cream, tan, pinkish and lilac
// massive corals (no olive: with the polyp texture it reads as moss); green, tan and cream brains;
// Acropora browns with pale, violet, blue or lime tips
const PORITES = [[0.78, 0.56, 0.26], [0.86, 0.74, 0.5], [0.66, 0.47, 0.3], [0.8, 0.52, 0.46], [0.62, 0.52, 0.7], [0.9, 0.76, 0.36]];
const BRAINP = [[0.6, 0.66, 0.3], [0.78, 0.6, 0.36], [0.54, 0.43, 0.3], [0.84, 0.78, 0.6], [0.68, 0.52, 0.6], [0.52, 0.6, 0.62]];
const ACRO = [[0.62, 0.44, 0.26], [0.84, 0.74, 0.52], [0.62, 0.42, 0.74], [0.5, 0.6, 0.82], [0.66, 0.76, 0.3], [0.86, 0.52, 0.6], [0.86, 0.66, 0.26]];
const ACRO_TIP = [[1.0, 0.95, 0.85], [0.8, 0.7, 1.05], [0.7, 0.9, 1.1], [0.95, 1.0, 0.6]];
const MONTI = [[0.58, 0.36, 0.64], [0.82, 0.5, 0.24], [0.5, 0.62, 0.32], [0.6, 0.44, 0.3], [0.8, 0.58, 0.64], [0.42, 0.54, 0.68]];
const DIGIT = [[0.88, 0.8, 0.56], [0.66, 0.6, 0.8], [0.8, 0.6, 0.35], [0.74, 0.52, 0.56], [0.64, 0.72, 0.42]];
const TURB = [[0.82, 0.74, 0.42], [0.72, 0.6, 0.4], [0.66, 0.6, 0.66], [0.78, 0.64, 0.5]]; // Turbinaria: yellow, tan, grey-lilac
// dead framework under turf and coralline algae: dark olive-brown and dusky pink, so the gaps between
// colonies read as reef pavement, never as pale sand or slabs
const PAD = [[0.3, 0.26, 0.2], [0.34, 0.25, 0.26], [0.27, 0.26, 0.19], [0.32, 0.27, 0.24]];
// encrusting and massive colonies that grow over a knoll's framework, side by side: a shade darker than
// the raised colonies (broad sunlit surfaces glared pale under the caustics) and no olive or green (with
// the polyp texture those cells read as moss)
const MOSAIC = [...PORITES, ...MONTI.filter((c) => c[1] <= c[0]), [0.54, 0.43, 0.3], [0.84, 0.78, 0.6], [0.86, 0.52, 0.6]].map((c) => c.map((v) => v * 0.82));
// big heads stay in warm coral tones (lilac / blue-grey reads as rock at that size, olive as moss)
const HEADP = [[0.78, 0.56, 0.26], [0.86, 0.74, 0.5], [0.66, 0.47, 0.3], [0.8, 0.52, 0.46], [0.9, 0.76, 0.36], [0.56, 0.44, 0.26]];

// growth-form mixes per knoll family (a reef community leans on one)
const FAMS = {
  mixed: { dome: 1.8, brain: 1.0, bush: 2.0, cup: 0.8, digits: 1.0, branch: 2.0, table: 1.0 },
  branchy: { bush: 3, digits: 2, branch: 4, dome: 0.8, table: 0.6, cup: 0.3, brain: 0.3 },
  massive: { dome: 3.5, brain: 2.5, bush: 0.8, branch: 0.8, digits: 0.5, cup: 0.4 },
  plating: { cup: 2.5, table: 2.5, bush: 1.2, dome: 1.2, branch: 1, brain: 0.5, digits: 0.5 },
};
const FORM_NAME = {
  dome: ['Massive Porites coral', 'Massive Porites corals grow about a centimetre a year: a head this size can be centuries old.'],
  brain: ['Brain coral', 'Each groove of a brain coral is a valley of polyps that share one long, mouth-lined channel.'],
  bush: ['Corymbose Acropora', 'Acropora, the most diverse reef-building coral genus, grows as bushes, tables and thickets of branches.'],
  cup: ['Turbinaria coral', 'Turbinaria grows as cups and scrolls whose shape follows the light: tight cups in the shallows, broad plates deeper.'],
  digits: ['Finger coral', null],
  branch: ['Staghorn coral', null],
  table: ['Table coral', null],
};
// massive forms make the support surface (supTpl); thin plates, branches and fingers stay out of it, so
// nothing placed later perches on a plate's edge
const SOLID = new Set(['dome', 'brain', 'bush']);
// Knoll: a broad, low mound of reef framework (a support others can rest on, 0.4-0.8 m high and 5-6 m
// across: a patch of reef, not a boulder) whose surface is a mosaic of encrusting / massive colonies in
// their own colours between dark turf and coralline pavement, with 3-4 raised colonies of different growth
// forms on it (lo: 2 cheap ones for the fogged far bands). About 500-700 triangles (lo ~340); a low, broad
// mound with raised colonies hides far more sand per triangle at the camera's grazing view than colonies
// scattered on bare floor.
function knoll(sd, fam, lo = false) {
  const b = new Builder(), rng = mulberry32(sd * 7349 + 11), mix = FAMS[fam];
  const Rx = 2.4 + rng() * 0.8, Rz = 1.8 + rng() * 0.6, pad = new Builder(), padC = pickC(rng, PAD);
  rockInto(pad, sd, { detail: 2, sx: Rx, sy: 0.38 + rng() * 0.22, sz: Rz, rough: 0.5, flat: 0.25, growth: 0, col: [1, 1, 1] });
  // the mosaic: nearest of 5-8 jittered centres; ~1/5 of the cells are bare framework under turf (growth
  // patches: green turf, coralline pink, orange). One surface mode (2, living texture with only a trace
  // of sediment) everywhere, so no other material mode is ever interpolated across a triangle.
  const cells = Array.from({ length: 5 + Math.floor(rng() * 4) }, () => {
    const a = rng() * TAU, q = Math.sqrt(rng()) * 0.85, live = rng() < 0.78;
    return { x: Math.cos(a) * Rx * q, z: Math.sin(a) * Rz * q, live, col: live ? pickC(rng, MOSAIC) : padC };
  });
  pad.paint(0, (i, x, y, z, nx, ny, nz, o) => {
    let best = null, bd = 1e9;
    for (const c of cells) { const d = Math.hypot(x - c.x, z - c.z) * (1 + 0.35 * vn3(x * 1.7, y * 1.7, z * 1.7, sd)); if (d < bd) { bd = d; best = c; } }
    const sh = o[0]; // rockInto's shading (ambient occlusion x mottling) on a white base
    o[0] = best.col[0] * sh; o[1] = best.col[1] * sh; o[2] = best.col[2] * sh;
    o[3] = best.live ? 0 : 0.24 * sstep(0.1, 0.7, ny); o[4] = 2;
  });
  const padT = pad.build(), top = (x, z) => Math.max(0, padT.rayDown(x, z)), sup = new Builder();
  b.append(pad); sup.append(pad);
  // tight obstacle capsules: the pad and each raised colony fitted on their own (one fit over the whole
  // knoll wrapped a flat 6 m mound in two capsules reaching metres above the reef). A pad strip's round
  // section is wider than the mound is thick, so it sinks until its top meets the pad's top: the mound
  // tapers to its edges, which stay inside the lowered circle.
  const obs = padT.capsules(1, 1, 6).list.map((o) => { const c = o.slice(), y = Math.min(c[1], padT.maxY + 0.03 - c[6]); c[1] = c[4] = y; return c; });
  const forms = Object.entries(mix).map(([k, w]) => ({ k, w: lo && !(k === 'dome' || k === 'brain' || k === 'bush') ? 0 : w }));
  const n = lo ? 2 : 3 + (rng() < 0.5 ? 1 : 0), placed = [];
  let main = null, mainR = 0;
  for (let k = 0, tries = 0; k < n && tries < 30; tries++) {
    const r = (k === 0 ? 0.6 + rng() * 0.25 : 0.36 + rng() * 0.3) * (lo ? 1.3 : 1);
    const a = rng() * TAU, q = k === 0 ? rng() * 0.3 : 0.25 + rng() * 0.5, x = Math.cos(a) * Rx * q, z = Math.sin(a) * Rz * q;
    if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < (p[2] + r) * 0.62)) continue; // colonies abut, not merge
    placed.push([x, z, r]); k++;
    const f = pickW(rng, forms).k, t = top(x, z), det = lo || f === 'bush' ? 1 : r > 0.62 ? 2 : 1, c = new Builder();
    if (f === 'dome') domeInto(c, rng, x, z, r, t + r * (0.55 + rng() * 0.45), det, pickC(rng, PORITES), 2, 0.1 + rng() * 0.12, 1.2 + rng() * 1.2);
    else if (f === 'brain') domeInto(c, rng, x, z, r, t + r * (0.5 + rng() * 0.3), det, pickC(rng, BRAINP), 0.62 + rng() * 0.76, 0.04);
    else if (f === 'bush') bushInto(c, rng, x, z, r * 1.1, t + r * (0.45 + rng() * 0.35), det, pickC(rng, ACRO), pickC(rng, ACRO_TIP));
    else if (f === 'cup') cupInto(c, rng, x, z, Math.min(0.48, r * 0.85), t, pickC(rng, TURB)); // < 0.5: small-plate tessellation
    else if (f === 'branch') branchInto(c, rng, x, z, r, 0.55 + r * 0.6, t, pickC(rng, ACRO), pickC(rng, ACRO_TIP));
    else if (f === 'table') tableInto(c, rng, x, z, Math.min(0.48, r * 0.9), t, pickC(rng, TABLE));
    else digitsInto(c, rng, x, z, r, t + r * (0.8 + rng() * 0.6), pickC(rng, DIGIT));
    b.append(c); if (SOLID.has(f)) sup.append(c);
    for (const o of c.build().capsules(1, 1, 2).list) obs.push(o.slice());
    if (r > mainR) { mainR = r; main = f; }
  }
  const t = b.build();
  [t.label, t.fact] = FORM_NAME[main] || FORM_NAME.dome;
  t.support = true; t.supTpl = sup.build(); t.obs = obs;
  return t;
}
// Reef pavement: a draped patch of rubble bound by coralline algae and turf, with a few small encrusting
// colonies (follows the floor vertex by vertex, so it never floats). It fills the bare floor between the
// knolls where the camera looks steeply down, under and beside the path; the grooves keep their sand.
function pavement(sd) {
  const b = new Builder(), rng = mulberry32(sd * 3371 + 9), R0 = 2.0 + rng() * 0.8, el = 0.75 + rng() * 0.5;
  const cells = Array.from({ length: 4 + Math.floor(rng() * 3) }, () => {
    const a = rng() * TAU, q = Math.sqrt(rng()) * 0.8, live = rng() < 0.35;
    return { x: Math.cos(a) * R0 * q * el, z: Math.sin(a) * R0 * q / el, live, col: live ? pickC(rng, MOSAIC) : pickC(rng, PAD) };
  });
  b.grid(16, 5, (u, v, i, j, o) => {
    const a = u * TAU, R = R0 * (1 + 0.3 * vn3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, sd, sd) + 0.1 * Math.sin(a * 5 + sd)), x = Math.cos(a) * v * R * el, z = Math.sin(a) * v * R / el;
    o[0] = x; o[2] = z;
    o[1] = 0.012 + 0.05 * (1 - v * v) * (0.6 + 0.4 * vn3(x * 2.5, 0, z * 2.5, sd + 1)) + 0.015 * vn3(x * 7, 1, z * 7, sd + 2); // low lumpy relief
    let best = cells[0], bd = 1e9;
    for (const c of cells) { const d = Math.hypot(x - c.x, z - c.z) * (1 + 0.35 * vn3(x * 1.7, 0, z * 1.7, sd + 3)); if (d < bd) { bd = d; best = c; } }
    const k = 0.75 + 0.25 * vn3(x * 3, 2, z * 3, sd + 4);
    o[3] = best.col[0] * k; o[4] = best.col[1] * k; o[5] = best.col[2] * k; o[6] = best.live ? 0 : 0.3; o[7] = 2;
  }, { wrapU: true, flip: true });
  const t = b.build();
  t.drape = true; t.label = 'Reef flat';
  t.fact = 'Between the colonies, coralline algae cement dead coral rubble into a pavement where new coral larvae settle.';
  return t;
}
// Reef coral head (bommie core): one great massive colony or a knot of them, coral-shaped (smooth lobed
// domes, brain boulders, columns) and coloured by species rather than rock with algae on it.
function reefHead(sd) {
  const b = new Builder(), rng = mulberry32(sd * 4421 + 5), kind = sd % 4;
  let f = 'dome', sup = null; // sup: the support proxy when a thin part (a foot cup) is added last
  if (kind === 0) { // great Porites dome: a lobed helmet or hummock, with a smaller colony at its foot
    domeInto(b, rng, 0, 0, 1.0 + rng() * 0.15, 0.7 + rng() * 0.35, 3, pickC(rng, HEADP), 2, 0.16 + rng() * 0.1, 1.6 + rng() * 0.8);
    const a = rng() * TAU;
    if (rng() < 0.5) { sup = b.build(); cupInto(b, rng, Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0.4, 0, pickC(rng, TURB)); }
    else bushInto(b, rng, Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0.36, 0.3, 1, pickC(rng, ACRO), pickC(rng, ACRO_TIP));
  } else if (kind === 1) { // brain coral boulder
    f = 'brain';
    domeInto(b, rng, 0, 0, 0.95 + rng() * 0.15, 0.62 + rng() * 0.25, 3, pickC(rng, BRAINP), 0.62 + rng() * 0.76, 0.05);
  } else if (kind === 2) { // a knot of fused colonies, each its own species and colour
    const n = 2 + (rng() < 0.5 ? 1 : 0), a0 = rng() * TAU;
    for (let k = 0; k < n; k++) {
      const a = a0 + k * TAU / n, d = k ? 0.6 : 0.15, r = k ? 0.5 + rng() * 0.15 : 0.75, x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (rng() < 0.6) domeInto(b, rng, x, z, r, r * (0.8 + rng() * 0.3), 2, pickC(rng, PORITES), 2, 0.14, 1.6);
      else domeInto(b, rng, x, z, r, r * (0.7 + rng() * 0.2), 2, pickC(rng, BRAINP), 0.62 + rng() * 0.76, 0.05);
    }
  } else { // columnar massive coral: a clump of fat, blunt, knobbly columns
    const col = pickC(rng, HEADP), n = 6 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU, rr = k ? 0.25 + rng() * 0.6 : 0, h = (0.7 + rng() * 0.8) * (1 - 0.35 * rr), r = 0.16 + rng() * 0.1, v0 = b.vc, s2 = sd * 13 + k;
      b.lathe(8, 3, (v) => [r * (v > 0.8 ? Math.sqrt(Math.max(0, 1 - ((v - 0.8) / 0.2) ** 2)) : 1) * (1 + 0.1 * Math.sin(v * 9 + k)), BASE_Y + v * h],
        (an, v) => 1 + 0.1 * vn3(Math.cos(an) * 2, v * 5, Math.sin(an) * 2, s2), (v, an, x, y, z, o) => {
          const c = 0.55 + 0.5 * v; o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[6] = 0; o[7] = 2;
        });
      b.xform(v0, [1, 0, 0, 0, 1, 0, 0, 0, 1], Math.cos(a) * rr, 0, Math.sin(a) * rr);
    }
  }
  const t = b.build();
  [t.label, t.fact] = FORM_NAME[f];
  t.support = true; if (sup) t.supTpl = sup;
  return t;
}

export function initReef() {
  const R = (n, f, o = 0) => Array.from({ length: n }, (_, i) => f(100 + i * 17 + o));
  T.stag = R(12, staghorn);
  T.elkhorn = R(6, elkhorn);
  T.finger = R(8, fingerCoral);
  T.pillar = R(6, pillarCoral);
  T.table = R(10, tableCoral);
  T.plateC = R(8, plateCoral);
  T.mushroom = R(8, mushroomCoral);
  T.lettuce = R(6, lettuceCoral);
  T.brain = R(10, brainCoral);
  T.boulder = R(8, boulderCoral);
  T.coralMound = [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52].map(coralHead);
  T.reefHead = Array.from({ length: 16 }, (_, i) => reefHead(201 + i));
  T.knoll = {};
  for (const [f, o] of [['mixed', 300], ['branchy', 400], ['massive', 500], ['plating', 600]]) T.knoll[f] = Array.from({ length: 9 }, (_, i) => knoll(o + i, f));
  T.knollLo = Array.from({ length: 9 }, (_, i) => knoll(700 + i, 'mixed', true)); // far bands: fogged, ~340 triangles
  T.reefPave = Array.from({ length: 8 }, (_, i) => pavement(900 + i));
  T.fan = R(16, (s) => seaFan(s, { h: 0.8 + (s % 5) * 0.2 }));
  T.tubeSp = R(10, (s) => tubeSponges(s, { n: 1 + (s % 8), h: 0.5 + (s % 5) * 0.22, r: 0.07 + (s % 4) * 0.025, rings: 4 }));
  T.barrel = R(8, barrelSponge);
  T.vase = R(6, vaseSponge);
  T.soft = R(14, (s) => softCoral(s, { h: 0.5 + (s % 4) * 0.18 }));
  T.leather = R(6, leatherCoral);
  T.anem = R(12, (k) => anemone(k, k % 2
    ? { tent: [0.75, 0.85, 0.55], tipC: [1.3, 1.2, 1.1], tentacles: 22 + (k % 7) * 4, thick: 0.035 + 0.003 * (k % 4), tlen: 0.32 + 0.05 * (k % 5), tseg: 2 }
    : { tent: [0.85, 0.55, 0.8], tipC: [1.25, 1.1, 1.3], tlen: 0.28 + 0.05 * (k % 5), tentacles: 26 + (k % 6) * 4, thick: 0.036, tseg: 2 }));
  T.whip = R(12, (s) => seaWhips(s, { n: 1 + (s % 8), h: 0.8 + (s % 4) * 0.3 }));
  const M = [[0.08, 0.35, 0.75], [0.06, 0.5, 0.5], [0.35, 0.45, 0.12], [0.4, 0.15, 0.55], [0.6, 0.5, 0.12], [0.15, 0.25, 0.6], [0.3, 0.2, 0.1], [0.05, 0.6, 0.35]];
  T.clam = M.map((m, i) => giantClam(i + 1, m));
  T.star = R(10, (s) => seastar(s, { arms: s % 7 === 0 ? 6 : 5, fat: 1.2 + (s % 5) * 0.4, curl: 0.03 + (s % 4) * 0.03 }));
  T.linckia = R(4, (s) => seastar(s, { arms: 5, fat: 5, thin: 0.6, curl: 0.02, col: [0.25, 0.45, 1.2] }));
  T.cots = R(4, (s) => seastar(s, { arms: 13 + (s % 4), fat: 3.5, thin: 0.8, curl: 0.05, spines: 70, col: [0.65, 0.45, 0.5] }));
  T.urchin = R(8, (s) => urchin(s, { len: 0.6 + (s % 5) * 0.5, spines: 30 + (s % 4) * 10, body: s % 3 ? [0.16, 0.13, 0.17] : [0.32, 0.26, 0.34] }));
}

// ---------- palettes (saturated so colour survives blue water) ----------
const HARD = [[0.88, 0.66, 0.42], [0.72, 0.6, 0.38], [0.8, 0.6, 0.64], [0.6, 0.66, 0.9], [0.92, 0.8, 0.55], [0.62, 0.72, 0.5], [0.85, 0.5, 0.35]];
const VIVID = [[0.72, 0.12, 0.98], [0.98, 0.14, 0.62], [1.1, 0.42, 0.05], [1.1, 0.86, 0.08], [0.98, 0.06, 0.08], [0.05, 0.88, 0.78]];
const FANS = [[0.72, 0.1, 0.9], [1.0, 0.08, 0.16], [1.1, 0.45, 0.06], [1.05, 0.85, 0.12], [0.95, 0.15, 0.6]];
// massive and brain corals: tan, brown, olive, cream and yellow-brown, an occasional dusky pink or violet
const MASSIVE = [[0.82, 0.64, 0.4], [0.66, 0.5, 0.32], [0.62, 0.62, 0.36], [0.86, 0.78, 0.56], [0.8, 0.62, 0.3], [0.74, 0.54, 0.5], [0.58, 0.5, 0.6], [0.55, 0.62, 0.42]];
const SOFTC = [[0.86, 0.56, 0.62], [0.9, 0.84, 0.68], [0.62, 0.64, 0.42], [0.82, 0.62, 0.52], [0.7, 0.52, 0.62], [0.95, 0.72, 0.6]];
const BARREL = [[0.58, 0.24, 0.2], [0.5, 0.3, 0.22], [0.66, 0.38, 0.36], [0.46, 0.26, 0.24], [0.62, 0.42, 0.34]];
const TABLE = [[0.66, 0.52, 0.34], [0.56, 0.46, 0.32], [0.72, 0.62, 0.44], [0.58, 0.54, 0.38], [0.64, 0.48, 0.42]];
const NEUTRAL = [[1, 1, 1], [1.04, 0.99, 0.93], [0.96, 0.98, 1.04], [1.02, 0.96, 1.0]];
export const REEF = {};
function specs() {
  if (REEF.stag) return REEF;
  Object.assign(REEF, {
    stag: { tpl: T.stag, scale: [0.8, 2.3], follow: 0.3, tint: tintFrom(HARD, 0.2) },
    elkhorn: { tpl: T.elkhorn, scale: [1.0, 2.2], follow: 0.2, tint: tintFrom([[0.95, 0.65, 0.3], [0.85, 0.6, 0.35], [0.9, 0.75, 0.45]], 0.2), giant: 0.02 },
    finger: { tpl: T.finger, scale: [0.8, 1.8], follow: 0.5, tint: tintFrom([[0.85, 0.7, 0.45], [0.75, 0.45, 0.85], [0.95, 0.85, 0.4]], 0.2) },
    pillar: { tpl: T.pillar, scale: [0.8, 1.6], follow: 0.1, tint: tintFrom([[0.95, 0.8, 0.55], [0.8, 0.75, 0.5]], 0.15), giant: 0.03 },
    plateC: { tpl: T.plateC, scale: [0.9, 2.2], follow: 0.3, tint: tintFrom([[0.76, 0.66, 0.42], [0.6, 0.62, 0.38], [0.7, 0.56, 0.5], [0.66, 0.6, 0.62]], 0.15) },
    mushroom: { tpl: T.mushroom, scale: [0.12, 0.28], follow: 0.95, sink: 0, tint: tintFrom([[0.95, 0.75, 0.55], [0.8, 0.6, 0.9], [0.6, 0.85, 0.6]], 0.2) },
    lettuce: { tpl: T.lettuce, scale: [0.9, 2.0], follow: 0.4, tint: tintFrom([[0.75, 0.65, 0.35], [0.6, 0.7, 0.35], [0.8, 0.55, 0.45]], 0.2) },
    vase: { tpl: T.vase, scale: [0.9, 2.0], follow: 0.3, tint: tintFrom([[0.45, 0.6, 1.1], [0.95, 0.35, 0.7], [1.0, 0.6, 0.15], [0.7, 0.3, 0.9]], 0.18), giant: 0.03 },
    linckia: { tpl: T.linckia, scale: [0.12, 0.2], follow: 1, sink: 0, tint: tintFrom([[1, 1, 1]], 0.15) },
    cots: { tpl: T.cots, scale: [0.14, 0.24], follow: 1, sink: 0, tint: tintFrom([[1, 1, 1], [1.1, 0.8, 0.9]], 0.15) },
    table: { tpl: T.table, scale: [0.8, 1.8], follow: 0.15, tint: tintFrom(TABLE, 0.12), sink: 0, giant: 0.02 },
    brain: { tpl: T.brain, scale: [0.4, 1.3], follow: 0.75, tint: tintFrom(MASSIVE, 0.12), giant: 0.03 },
    boulder: { tpl: T.boulder, scale: [1.0, 2.4], follow: 0.6, tint: tintFrom(MASSIVE) },
    fan: { tpl: T.fan, scale: [0.7, 2.1], follow: 0.15, sway: true, tint: tintFrom(FANS, 0.2), giant: 0.03 },
    tubeSp: { tpl: T.tubeSp, scale: [1.0, 2.0], follow: 0.4, tint: tintFrom(VIVID) },
    barrel: { tpl: T.barrel, scale: [0.8, 1.9], follow: 0.3, giant: 0.04, tint: tintFrom(BARREL, 0.1) },
    soft: { tpl: T.soft, scale: [0.9, 1.9], follow: 0.4, sway: true, tint: tintFrom(SOFTC, 0.12) },
    leather: { tpl: T.leather, scale: [0.9, 1.9], follow: 0.6, sway: true, tint: tintFrom([[0.95, 0.85, 0.45], [0.7, 0.85, 0.4], [1.0, 0.7, 0.55]]) },
    anem: { tpl: T.anem, scale: [1.0, 1.8], follow: 0.7, sway: true, tint: tintFrom([[1.05, 1.0, 1.0], [1.1, 0.8, 1.0]], 0.12) },
    whip: { tpl: T.whip, scale: [0.9, 1.7], follow: 0.2, sway: true, tint: tintFrom([[1.1, 0.4, 0.06], [1.0, 0.1, 0.12], [1.1, 0.85, 0.15]]) },
    clam: { tpl: T.clam, scale: [0.5, 1.15], follow: 0.8, fxScale: true, grow: [1, 1], giant: 0.04, tint: tintFrom([[1.1, 1.1, 1.1]], 0.1) }, // fx = closing distance, scales with size
    star: { tpl: T.star, scale: [0.1, 0.18], follow: 0.95, tint: tintFrom([[1.15, 0.35, 0.05], [1.0, 0.08, 0.08], [0.7, 0.25, 0.95], [0.25, 0.4, 1.1]]), sink: 0 },
    urchin: { tpl: T.urchin, scale: [0.06, 0.11], follow: 0.8, tint: tintFrom([[0.7, 0.45, 0.8], [0.45, 0.35, 0.5]]) },
    // coral heads and the framework knolls carry their colonies' colours in the template: instance tints
    // only shift them a little (random yaw: knolls must never line up in rows)
    mound: { tpl: T.reefHead, scale: [1.3, 2.3], follow: 0.3, grow: [1, 1], tint: tintFrom(NEUTRAL, 0.1), sink: 0.12, support: true, occ: 0.85 },
    pave: { tpl: T.reefPave, scale: [1.0, 1.5], follow: 1, sink: 0, grow: [0.8, 1.1], tint: tintFrom(NEUTRAL, 0.1), drape: true, occ: 0.6, layer: 3 },
    knollLo: { tpl: T.knollLo, scale: [1.5, 2.3], ys: [0.75, 1.15], xz: 0.3, follow: 0.3, grow: [0.8, 1.1], tint: tintFrom(NEUTRAL, 0.1), sink: 0.06, support: true, occ: 0.35, layer: 2, straddle: 0.7 },
    ...Object.fromEntries(Object.keys(FAMS).map((f) => ['knoll_' + f,
      { tpl: T.knoll[f], scale: [1.2, 1.8], ys: [0.8, 1.25], xz: 0.3, follow: 0.3, grow: [0.8, 1.1], tint: tintFrom(NEUTRAL, 0.1), sink: 0.06, support: true, occ: 0.35, layer: 2, straddle: 0.7 }])),
    // the worm tufts sit on coral heads, whose tops are bumpy (columns, fused domes): seat on the whole band
    xmas: { tpl: T.xmas, scale: [1.4, 2.4], follow: 0.9, sway: true, fullFoot: true, grow: [1, 1], tint: tintFrom([[1.1, 0.25, 0.15], [1.1, 0.7, 0.1], [0.2, 0.5, 1.1], [1.0, 1.0, 1.0], [0.8, 0.2, 0.9], [0.2, 0.9, 0.6]], 0.15) },
    duster: { tpl: T.duster, scale: [1.0, 1.8], follow: 0.8, sway: true, fullFoot: true, grow: [1, 1], tint: tintFrom([[1.0, 0.55, 0.45], [0.95, 0.85, 0.6], [0.7, 0.45, 0.9], [1.0, 1.0, 0.95]], 0.15) },
  });
  REEF.topList = [
    { w: 1.2, k: 'elkhorn' }, { w: 1.2, k: 'finger' }, { w: 0.7, k: 'pillar' }, { w: 1.4, k: 'plateC' }, { w: 1, k: 'lettuce' }, { w: 0.9, k: 'vase' },
    { w: 3, k: 'stag' }, { w: 2.6, k: 'table' }, { w: 1.4, k: 'brain' }, { w: 2.4, k: 'fan', sway: true },
    { w: 2.4, k: 'soft', sway: true }, { w: 0.9, k: 'leather', sway: true }, { w: 1.4, k: 'tubeSp' }, { w: 1.1, k: 'barrel' },
    { w: 0.9, k: 'anem', sway: true }, { w: 0.9, k: 'whip', sway: true }, { w: 0.6, k: 'boulder' },
  ];
  Object.assign(REEF, {
    rubble: { tpl: T.rubble, scale: [0.8, 1.6], follow: 1, sink: 0.02, tint: tintFrom([[1, 0.95, 0.88], [0.9, 0.85, 0.82], [0.95, 0.8, 0.85]], 0.1) },
    grit: { tpl: T.grit, scale: [0.8, 1.5], follow: 1, sink: 0.01, tint: tintFrom([[1, 0.96, 0.9]], 0.06) },
    algae: { tpl: T.algae, scale: [0.6, 1.5], follow: 1, sink: 0.01, tint: tintFrom([[0.75, 0.85, 0.6], [1.0, 0.7, 0.75], [0.8, 0.7, 0.5]], 0.12) },
    lump: { tpl: T.spongeLump, scale: [0.7, 1.6], follow: 0.7, tint: tintFrom(VIVID) },
  });
  REEF.micro = [{ w: 3, spec: REEF.rubble }, { w: 2, spec: REEF.grit }, { w: 1.6, spec: REEF.algae }, { w: 1.6, spec: REEF.lump }];
  REEF.smallList = [
    { w: 1.6, k: 'star' }, { w: 0.5, k: 'linckia' }, { w: 0.3, k: 'cots' }, { w: 1.4, k: 'mushroom' }, { w: 2, k: 'urchin' }, { w: 1.4, k: 'clam' }, { w: 1.6, k: 'anem', sway: true }, { w: 1.4, k: 'brain' }, { w: 0.8, k: 'soft', sway: true },
  ];
  return REEF;
}

// One coral head: a massive-coral mound with colonies over its dome and around its foot.
// ---------- per-segment communities: dominant species, palette, density, arrangement ----------
// kn: weights of the framework knoll families (FAMS) the community grows on
const COMMUNITIES = [
  { name: 'staghorn thicket', w: { stag: 5, elkhorn: 2 }, rows: 1.1, tint: [1.0, 1.0, 1.0], kn: { branchy: 3, mixed: 1 } },
  { name: 'table-coral terraces', w: { table: 5, plateC: 3 }, rows: 1.0, tint: [1.04, 1.0, 0.95], kn: { plating: 2, mixed: 2 } },
  { name: 'massive boulder reef', w: { brain: 3, boulder: 4, pillar: 1.5 }, mound: 1.3, rows: 0.9, tint: [1.05, 0.98, 0.9], kn: { massive: 3, mixed: 1 } },
  { name: 'sponge garden', w: { tubeSp: 4, barrel: 3, vase: 3 }, rows: 1.0, tint: [0.95, 0.98, 1.06], kn: { mixed: 2, massive: 1 } },
  { name: 'partly bleached reef', bleach: 0.45, rows: 0.95, tint: [1.0, 1.0, 1.0], kn: { mixed: 2, branchy: 1 } },
  { name: 'gorgonian fan forest', w: { fan: 5, whip: 3, soft: 2 }, rows: 1.05, tint: [1.0, 0.95, 1.05], kn: { mixed: 2, plating: 1 } },
  { name: 'mixed reef', rows: 1.0, tint: [1.0, 1.0, 1.0], kn: { mixed: 2, branchy: 1, massive: 1, plating: 1 } },
];
function knollList(comm) {
  if (!comm._kn) comm._kn = Object.entries(comm.kn).map(([f, w]) => ({ w, k: 'knoll_' + f }));
  return comm._kn;
}
export function reefCommunity(ctx) {
  const seg = ctx.segments.find((g) => g.key === 'reef');
  if (!seg) return COMMUNITIES[6];
  return COMMUNITIES[Math.floor(mulberry32(seg.seed ^ 0x2eef)() * COMMUNITIES.length)];
}
function listFor(comm) {
  const R = specs();
  if (!comm || !comm.w) return R.topList;
  if (!comm._list) comm._list = R.topList.map((e) => ({ ...e, w: e.w * (comm.w[e.k] || 0.6) }));
  return comm._list;
}
// colony tint through the community palette, sometimes bleached white
function commTint(spec, comm, rng) {
  const c = spec.tint ? spec.tint(rng) : [1, 1, 1];
  if (comm && comm.bleach && rng() < comm.bleach) { const k = 0.85 + rng() * 0.25, p = rng() < 0.3 ? [1.0, 0.8, 0.9] : [1, 1, 1]; return [p[0] * k, p[1] * k, p[2] * k]; }
  const m = comm ? comm.tint : [1, 1, 1];
  return [c[0] * m[0], c[1] * m[1], c[2] * m[2]];
}

let headR0 = 0;
const headR = () => headR0 || (headR0 = T.reefHead.reduce((a, t) => a + t.r, 0) / T.reefHead.length); // mean reef-head radius

// small, delicate species are 'near' LOD (gone beyond ~70 m, where fog makes them sub-pixel smudges);
// structural colonies (tables, plates, staghorn, brains, barrels...) stay 'mid'
const SMALL = new Set(['soft', 'fan', 'whip', 'finger', 'lettuce', 'anem', 'mushroom', 'leather', 'clam', 'star', 'urchin', 'linckia', 'cots']);
// One coral head: a massive-coral mound (a support) with colonies seated on its real surface and around
// its foot. opts: { mid: {st, sw} colony batches, near: {st, sw} small-life batches (worms too), comm }
// Returns continuation steps (the mound, then 3 colonies per step); run them in order, back to back.
export function bommie(ctx, fs, st, sw, rng, x, s, moundK, n, coralK, list, opts = {}) {
  const R = specs(), comm = opts.comm, nr = opts.near;
  const cst = opts.mid ? opts.mid.st : st, csw = opts.mid ? opts.mid.sw : sw;
  const L = list || listFor(comm);
  let csc = 0, domeR = 0.6;
  n = Math.max(1, Math.round(n * tierK(ctx)));
  const out = [() => {
    csc = putFloor(ctx, fs, st, R.mound, x, s, rng, moundK * (comm && comm.mound || 1));
    if (csc) domeR = headR() * csc * 0.9;
  }];
  for (let k0 = 0; k0 < n; k0 += 3) out.push(() => {
    for (let k = k0; k < Math.min(n, k0 + 3); k++) {
      const e = pickW(rng, L), sp = R[e.k];
      const a = rng() * TAU, rr = (domeR + 1.0) * Math.sqrt(rng());
      const ix = x + Math.cos(a) * rr, is = s + Math.sin(a) * rr;
      const spec = comm ? { ...sp, tint: (r) => commTint(sp, comm, r), occ: 0.55, layer: 1 } : { ...sp, occ: 0.55, layer: 1 };
      const small = nr && SMALL.has(e.k);
      putFloor(ctx, fs, e.sway ? (small ? nr.sw : csw) : small ? nr.st : cst, spec, ix, is, rng, coralK);
    }
  });
  // tiny delights on the coral head: christmas-tree worms and feather dusters (retract when you come close)
  if (nr) out.push(() => {
    if (!csc) return;
    for (let k = 0; k < 1 + Math.floor(rng() * 3); k++) {
      const a = rng() * TAU, rr = domeR * 0.55 * Math.sqrt(rng()); // the upper dome: its flanks are steep
      putFloor(ctx, fs, nr.sw, rng() < 0.65 ? R.xmas : R.duster, x + Math.cos(a) * rr, s + Math.sin(a) * rr, rng);
    }
  });
  return out;
}

// Coral heads stand on the framework on both sides of the valley, densest near the path.
// (the knolls carry the cover, so the heads stand apart as landmarks rather than a field of domes)
const ROWS = [
  { d: [0, 5.0], step: 12, m: 0.45, n: 3, k: 0.85 },
  { d: [5.0, 8.5], step: 10, m: 0.65, n: 6, k: 1.0 },
  { d: [8.5, 15], step: 11, m: 0.85, n: 5, k: 1.05 },
  { d: [15, 25], step: 12, m: 1.05, n: 3, k: 1.1 },
  { d: [25, 36], step: 16, m: 1.2, n: 1, k: 1.1 },
];
// Reef framework, spur-and-groove: knolls of living colonies over dead framework fuse into near-continuous
// cover; bare sand stays in narrow grooves (~16 % of the floor) that wander out across the valley.
// Knolls are low enough to pass under the camera (propClear scales them down there).
const FRAME_BANDS = [
  { d: [0.5, 4], cell: 4.2, k: 0.8, col: 2 }, { d: [4, 12], cell: 4.8, k: 1.0, col: 3 },
  { d: [12, 22], cell: 6.0, k: 1.0, col: 1, lo: true }, { d: [22, 34], cell: 7.4, k: 1.15, col: 0, lo: true },
];
function spurs(x, s) { // > 0 on a spur; crests run across the valley about every 11 m, wandering
  const w = noise2(x / 30, s / 30, 913) * 6;
  return Math.sin((s + w) * TAU / 11 + noise2(x / 17, s / 9, 911) * 2.2) * 0.6 + noise2(x / 7, s / 7, 912) * 0.9;
}
const REEF_SPUR_THR = -0.55;
const pathYaw = (ctx, s) => Math.atan2(-(ctx.pathX(s + 3) - ctx.pathX(s - 3)), 6);

// per-segment set pieces: one cleaning station, natural arches every 300-700 m (deterministic)
const segSets = new Map();
function reefSet(seg) {
  let S = segSets.get(seg.id);
  if (S && S.seed === seg.seed) return S;
  const rng = mulberry32(seg.seed ^ 0xc1ea), len = seg.end - seg.start;
  S = { seed: seg.seed, station: seg.start + 140 + rng() * Math.max(10, len - 280), side: rng() < 0.5 ? -1 : 1, arches: [] };
  for (let a = seg.start + 160 + rng() * 200; a < seg.end - 160; a += 300 + rng() * 400) S.arches.push({ s: a, k: (rng() * 1e9) | 0 });
  segSets.set(seg.id, S);
  if (segSets.size > 24) segSets.delete(segSets.keys().next().value);
  return S;
}

// natural rock arch spanning the path, crowned with colonies
export function placeArch(ctx, gnd, st, mid, rng, s, list, label = null) {
  const tpl = list[(rng() * list.length) | 0], R = rotY(pathYaw(ctx, s) + (rng() - 0.5) * 0.2);
  const x = ctx.pathX(s), y = ctx.pathY(s) - 0.1;
  // both legs' contact bands must sit well inside the floor (they end tpl.arch.depth below the path)
  if (groundY({ at: (px, ps) => gnd.floor(px, ps) }, x, s, tpl, R, 1, 1, 1) < y + 0.3) return null;
  const A = tpl.arch.A;
  if (!pointsClear(ctx, placedPoints(tpl, x, y, s, R, 1, 1, 1, 600), 0.45)) return null;
  if (!st.add(tpl, x, y, -(s - ctx.s0), R, 1, 1, 1, 0.95 + rng() * 0.1, 0.92 + rng() * 0.1, 0.9 + rng() * 0.1, 0.7 + rng() * 0.6)) return null;
  const it = st.last;
  it.g = 1;
  if (label) it.lbl = label;
  gnd.addSupport(it, s);
  for (const sd of [-1, 1]) gnd.occupy(x + sd * A * Math.cos(pathYaw(ctx, s)), s, 2.5, 0);
  poi(ctx, 'arch', x, y, s, A, { kind: 'rock arch' });
  return it;
}

export function layoutReef(ctx) {
  const pres = presence(ctx, 'reef');
  if (pres <= 0) return null;
  const R = specs(), rng = ctx.rng, fs = floorSampler(ctx), bk = budgetK(ctx, 'reef'), tk = tierK(ctx), comm = reefCommunity(ctx);
  const st = new Batch(MAT.static, 26000 * bk);                       // coral heads, arches, ledges
  const frame = new Batch(MAT.static, 56000 * bk, 'mid');            // reef framework knolls
  const ck = Math.sqrt(tk); // colonies are the reef: low tiers thin them less than other props
  const mid = { st: new Batch(MAT.static, 64000 * bk * ck, 'mid'), sw: new Batch(MAT.sway, 42000 * bk * tk, 'mid') };
  const near = { st: new Batch(MAT.static, 30000 * bk * tk, 'near'), sw: new Batch(MAT.sway, 36000 * bk * tk, 'near') }; // small life, worms
  const idx = Math.floor(ctx.s0 / 64), head = { mid, near, comm }, more = [];
  // set pieces anchored to the segment (each a small continuation step)
  for (const seg of ctx.segments) {
    if (seg.key !== 'reef') continue;
    const S = reefSet(seg);
    for (const a of S.arches) if (Math.floor((a.s + 3) / 64) === idx) {
      const arch = {}, ar2 = mulberry32(a.k + 1);
      more.push(() => { arch.it = placeArch(ctx, fs, st, mid, mulberry32(a.k), a.s, T.arch); });
      for (let half = 0; half < 2; half++) more.push(() => { // colonies on the crown
        if (!arch.it) return;
        const A = arch.it.tpl.arch.A, yaw = pathYaw(ctx, a.s);
        for (let k = 0; k < 9; k++) {
          const t = (ar2() - 0.5) * 1.3, ox = Math.cos(yaw) * A * t, os = Math.sin(yaw) * A * t + (ar2() - 0.5) * 1.2;
          const e = pickW(ar2, listFor(comm)), small = SMALL.has(e.k);
          putFloor(ctx, fs, e.sway ? (small ? near.sw : mid.sw) : small ? near.st : mid.st, { ...R[e.k], tint: (r) => commTint(R[e.k], comm, r) }, ctx.pathX(a.s) + ox, a.s + os, ar2, 0.9);
        }
      });
    }
    if (Math.floor(S.station / 64) === idx) { // cleaning station: a big, busy coral head
      const xs = ctx.pathX(S.station) + S.side * (8 + rng() * 3);
      more.push(...bommie(ctx, fs, st, mid.sw, rng, xs, S.station, 1.5, 14, 1.15, null, head), () => {
        const top = fs.at(xs, S.station);
        poi(ctx, 'cleaning-station', xs, top + 3, S.station, 7, { comm: comm.name });
        if (ctx.addLabel) ctx.addLabel('Cleaning station', xs, top + 1.5, S.station, 'Mantas and groupers queue here while cleaner wrasse and shrimp pick off parasites.');
      });
    }
  }
  // the framework first (coral heads and colonies then stand on it); one step per band row. Knolls take a
  // random yaw (lobes aligned across the valley read as rows of boulders)
  for (const band of FRAME_BANDS) for (const side of [-1, 1]) {
    for (let s0 = ctx.s0 + rng() * band.cell; s0 < ctx.s1; s0 += band.cell) more.push(() => {
      for (let d = band.d[0] + rng() * band.cell * 0.5; d < band.d[1]; d += band.cell * (0.8 + 0.4 * rng())) {
        const s = s0 + (rng() - 0.5) * band.cell * 0.8, x = ctx.pathX(s) + side * d;
        if (rng() > ctx.weightOf(s, 'reef') || spurs(x, s) < REEF_SPUR_THR) continue;
        const spec = band.lo ? R.knollLo : R[pickW(rng, knollList(comm)).k];
        const sc = putFloor(ctx, fs, frame, { ...spec, tint: (r) => commTint(spec, comm, r) }, x, s, rng, band.k);
        if (!sc || !band.col) continue;
        // a colony or two on the knoll (more near the path)
        for (let k = 0, n = Math.round((band.col - 0.5 + rng()) * ck); k < n; k++) {
          const e = pickW(rng, listFor(comm)), a = rng() * TAU, rr = sc * 2.2 * Math.sqrt(rng()), small = SMALL.has(e.k);
          // colonies grow out of the lumpy framework: they may set into it (embed) rather than balance on a crest
          putFloor(ctx, fs, e.sway ? (small ? near.sw : mid.sw) : small ? near.st : mid.st, { ...R[e.k], tint: (r) => commTint(R[e.k], comm, r), occ: 0.55, layer: 1, embed: true }, x + Math.cos(a) * rr, s + Math.sin(a) * rr, rng, band.k * 0.9);
        }
      }
    });
  }
  // reef pavement between the knolls near the path, where the camera looks steeply down (bare floor only:
  // a patch whose centre lands on a knoll is skipped; the grooves keep their sand)
  for (const side of [-1, 1]) for (let s0 = ctx.s0 + rng() * 4; s0 < ctx.s1; s0 += 4) more.push(() => {
    for (let d = rng() * 2; d < 8; d += 3.2 + rng() * 1.6) {
      const s = s0 + (rng() - 0.5) * 3, x = ctx.pathX(s) + side * d;
      if (rng() > ctx.weightOf(s, 'reef') || spurs(x, s) < REEF_SPUR_THR) continue;
      putFloor(ctx, fs, frame, { ...R.pave, tint: (r) => commTint(R.pave, comm, r) }, x, s, rng);
    }
  });
  // coral banks: a few steps per coral head (its parameters are drawn now, so the draw order is fixed)
  for (const row of ROWS) for (const side of [-1, 1]) {
    for (let s = ctx.s0 + rng() * row.step; s < ctx.s1; s += row.step * (0.75 + 0.5 * rng()) / (comm.rows || 1)) {
      if (rng() > ctx.weightOf(s, 'reef')) continue;
      const x = ctx.pathX(s) + side * lerp(row.d[0], row.d[1], rng()), m = row.m * (0.8 + 0.4 * rng()), n = row.n + (rng() < 0.5 ? 1 : 0);
      more.push(...bommie(ctx, fs, st, mid.sw, rng, x, s, m, n, row.k, null, head));
    }
  }
  // coral heads on the outside of bends: seen dead ahead, the camera curves past
  for (const b of bendSpots(ctx)) {
    if (rng() > ctx.weightOf(b.s, 'reef') * 0.85) continue;
    const x = bendX(ctx, b, headR() * 2.4, rng, 1.2);
    more.push(...bommie(ctx, fs, st, mid.sw, rng, x, b.s, 1.25, 10, 1.1, null, head));
  }
  // an overhanging ledge now and then (lobsters and sweepers shelter beneath)
  if (rng() < 0.45 * pres) more.push(...placeLedge(ctx, fs, st, rng, T.ledge));
  return { batches: [st, frame, mid.st, mid.sw, near.st, near.sw], more };
}

// rock overhang beside the path, lip facing the camera. Returns continuation steps (one candidate spot each).
export function placeLedge(ctx, gnd, st, rng, list) {
  const s = ctx.s0 + 8 + rng() * 48, side = rng() < 0.5 ? -1 : 1, tpl = list[(rng() * list.length) | 0], sc = 0.85 + rng() * 0.4;
  const yaw = (side > 0 ? Math.PI : 0) + pathYaw(ctx, s) + (rng() - 0.5) * 0.4, R = rotY(yaw), out = [];
  let done = false;
  for (let d = 4.2 + tpl.r * sc; d < 10 + tpl.r * sc; d += 0.8) out.push(() => {
    if (done) return;
    const x = ctx.pathX(s) + side * d;
    if (!gnd.free(x, s, tpl.r * sc * 0.6, 0)) return;
    const y = groundY(gnd, x, s, tpl, R, sc, sc, sc) - 0.15;
    if (!pointsClear(ctx, placedPoints(tpl, x, y, s, R, sc, sc, sc, 400), 0.45)) return;
    done = true;
    if (!st.add(tpl, x, y, -(s - ctx.s0), R, sc, sc, sc, 1, 1, 1, 0.8 + rng() * 0.5)) return;
    const it = st.last;
    it.g = 1;
    gnd.addSupport(it, s);
    gnd.occupy(x, s, tpl.r * sc * 0.6, 0);
    const m = tpl.ledge, wx = x + (R[0] * m.x + R[2] * m.z) * sc, ws = s - (R[6] * m.x + R[8] * m.z) * sc;
    poi(ctx, 'ledge', wx, y + m.y * sc, ws, 2.5 * sc);
  });
  return out;
}

// second layout chain: floor micro detail + small life (incl. under the camera), drawn near only
export function layoutReefMicro(ctx) {
  if (presence(ctx, 'reef') <= 0) return null;
  const R = specs(), rng = mulberry32((ctx.s0 * 2654435761) ^ 0x51f), fs = floorSampler(ctx), bk = budgetK(ctx, 'reef'), tk = tierK(ctx);
  const st = new Batch(MAT.static, 24000 * bk * tk, 'near'), sw = new Batch(MAT.sway, 8000 * bk * tk, 'near');
  const more = microSteps(ctx, fs, st, rng, 'reef', R.micro, 130, 26, 26);
  // small life everywhere, also under the camera
  const nextP = clusterer(ctx, rng, 0, 14, 1);
  more.push(...steps(Math.round(90 * tk), 23, () => {
    const p = nextP();
    if (!p || rng() > ctx.weightOf(p.s, 'reef') * 0.8) return;
    const e = pickW(rng, R.smallList);
    putFloor(ctx, fs, e.sway ? sw : st, R[e.k], p.x, p.s, rng, 0.8);
  }));
  return { batches: [st, sw], more };
}
