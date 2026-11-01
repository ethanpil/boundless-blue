// Sunken cities. Every ruins segment is a city in one architectural style (Greco-Roman, Egyptian, Maya,
// Khmer, Minoan, East Asian or Atlantean; see ruins_styles.js) laid out by ruins_plan.js: a paved street
// along the camera path with its own street furniture, houses and blocks set back in rows, plazas with a
// monument, temples, one big set piece, gates and a city wall across the street, an aqueduct or bridge
// overhead and landmarks on the outside of bends. Every building is generated for its site (ruins_bld.js,
// ruins_mon.js, ruins_gate.js on the ruins_kit.js masonry kit), fitted to the terrain, decayed, silted and
// overgrown, so no two are alike. This module keeps the shared startup templates (column orders, drums,
// amphorae, fragments, paving) and runs the per-chunk layout as budgeted continuation steps.
import { Builder, Batch, T, TAU, TUBE, sat, sstep, vn3, fbm3, floorSampler, presence, pointsClear, placedPoints, rotY, rotZ, mul3, orient, budgetK, vary, tierK, poi } from './core.js';
import { stoneInto } from './shapes.js';
import { statueSet } from './statues.js';
import { groundY, putFloor, pickW, tintFrom, spot, clusterer, microSteps, steps as inSteps } from './scatter.js';
import { MAT } from './materials.js';
import { mulberry32, noise1, hash2i } from '../noise.js';
import { Bld, Site } from './ruins_kit.js';
import { STYLES } from './ruins_styles.js';
import { planFor, itemsNear, slice, blocked, SL } from './ruins_plan.js';
import { horns } from './ruins_bld.js';
import { genGate, genCityWall, genWallTowers, genCrossing } from './ruins_gate.js';
import { genLot, genLandmark, genMonument, genTemple, genBig, figs, statueSteps, statueKinds } from './ruins_mon.js';

const STONE = [0.62, 0.58, 0.5];
// marble, sandstone, granite, basalt, limestone, travertine (instance tints over STONE)
const STONES = [[1.35, 1.35, 1.38], [1.25, 1.0, 0.72], [0.95, 0.95, 0.98], [0.52, 0.52, 0.56], [1.15, 1.1, 1.0], [1.2, 1.05, 0.85]];
const GROW = 0.95;
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---------- architecture ----------
const COL_STYLES = {
  doric: { name: 'Doric column', flutes: 20, flute: 0.045, base: 'plinth', cap: 'doric', taper: 0.12, slim: 1 },
  ionic: { name: 'Ionic column', flutes: 24, flute: 0.05, base: 'attic', cap: 'ionic', taper: 0.08, slim: 0.82 },
  corinthian: { name: 'Corinthian column', flutes: 24, flute: 0.05, base: 'attic', cap: 'corinthian', taper: 0.08, slim: 0.75 },
  tuscan: { name: 'Tuscan column', base: 'attic', cap: 'doric', taper: 0.15, slim: 1.05 },
  papyrus: { name: 'Papyrus column', lobes: 8, lobe: 0.09, base: 'disc', cap: 'papyrus', taper: 0.1, slim: 1.25 },
  lotus: { name: 'Lotus-bud column', lobes: 6, lobe: 0.12, base: 'disc', cap: 'lotus', taper: 0.06, slim: 1.2 },
  maya: { name: 'Maya carved pillar', square: true, carved: true, base: 'block', cap: 'block', taper: 0.04, slim: 1.15 },
  minoan: { name: 'Minoan column', base: 'disc', cap: 'cushion', taper: -0.2, slim: 1.05, col: [0.6, 0.24, 0.17] },
  solomonic: { name: 'Solomonic column', flutes: 6, flute: 0.14, twist: 1.6, base: 'attic', cap: 'doric', taper: 0.06, slim: 0.9 },
  octagonal: { name: 'Octagonal pillar', poly: 8, base: 'block', cap: 'block', taper: 0.05, slim: 1 },
  pagoda: { name: 'Lacquered pillar', base: 'disc', cap: 'block', taper: 0.03, slim: 0.85, col: [0.38, 0.11, 0.07] },
  khmer: { name: 'Khmer colonnette', poly: 8, carved: true, base: 'block', cap: 'block', taper: 0.04, slim: 0.8 },
  atlantean: { name: 'Atlantean column', flutes: 6, flute: 0.12, twist: 0.9, base: 'attic', cap: 'cushion', taper: 0.08, slim: 0.95, col: [0.84, 0.84, 0.82] },
};
export const COL_STYLE_KEYS = Object.keys(COL_STYLES);

// lite: a light version (12-gon, few rows, simpler mouldings) that the kit copies into whole buildings
function column(seed, style = 'doric', { H = 6, broken = 0, capital = true, base = true, lite = false } = {}) {
  const st = COL_STYLES[style], b = new Builder(), rng = mulberry32(seed);
  const R = 0.36 * st.slim * (0.85 + rng() * 0.35);
  const top = broken ? H * broken : H, key = 6.05 + rng() * 0.9;
  const scol = st.col || STONE, f = [GROW, key];
  const paintStone = (c) => (v, a, x, y, z, o) => {
    const k = 0.85 + 0.2 * vn3(x * 3, y * 3, z * 3, seed); o[3] = c[0] * k; o[4] = c[1] * k; o[5] = c[2] * k; o[6] = GROW; o[7] = key;
  };
  const stoneLathe = (nu, nv, prof, rad, c = STONE) => b.lathe(lite ? Math.min(nu, 10) : nu, lite ? Math.min(nv, 2) : nv, prof, rad, paintStone(c));
  let y0 = 0.3;
  if (!base) y0 = 0;
  else if (st.base === 'plinth' || st.base === 'block') { b.box(R * 3, 0.35, R * 3, rotY((rng() - 0.5) * 0.05), 0, 0.175, 0, STONE.map((c) => c * 0.9), f); y0 = 0.35; }
  if (base && st.base === 'attic') { b.box(R * 3, 0.25, R * 3, null, 0, 0.125, 0, STONE.map((c) => c * 0.9), f); stoneLathe(16, 4, (v) => [R * (1.32 - 0.25 * v + 0.1 * Math.sin(v * Math.PI * 2)), 0.25 + v * 0.35]); y0 = 0.6; }
  if (base && st.base === 'disc') { stoneLathe(16, 2, (v) => [R * (1.5 - 0.3 * v), v * 0.3]); y0 = 0.3; }
  const NV = lite ? Math.max(2, Math.round((top - y0) / 1.8)) : Math.max(3, Math.round((top - y0) / 0.55)), NU = lite ? (st.square ? 16 : st.flutes && st.flutes <= 8 ? 12 : st.lobes ? 12 : 10) : st.square ? 24 : 20;
  const v0 = b.vc;
  b.grid(NU, NV, (u, v, i, j, o) => {
    const a = u * TAU, jag = broken ? 0.4 * vn3(Math.cos(a) * 2, Math.sin(a) * 2, seed, seed) + 0.25 * Math.sin(a * 3 + seed) : 0;
    const y = y0 + v * (top - y0 + (j === NV ? jag : 0)), t = y / H;
    let r = R * (1 - st.taper * t + 0.025 * Math.sin(t * Math.PI));
    const aa = a + (st.twist ? st.twist * y : 0);
    if (st.flutes && (!lite || st.flutes * 2 <= NU)) r *= 1 - st.flute * (0.5 + 0.5 * Math.cos(aa * st.flutes));
    if (st.lobes) r *= 1 + st.lobe * Math.abs(Math.sin(aa * st.lobes / 2)) - st.lobe * 0.5 * sstep(0.85, 1, t);
    if (st.square) r *= 0.95 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 8) + Math.pow(Math.abs(Math.sin(a)), 8), 1 / 8);
    if (st.poly) { const sec = TAU / st.poly, m = ((a % sec) + sec) % sec; r *= Math.cos(Math.PI / st.poly) / Math.cos(m - Math.PI / st.poly); }
    const band = ((y * 1.3) % 1 + 1) % 1;
    if (st.carved) r *= band < 0.1 ? 0.92 : 1 - 0.04 * sstep(0.3, 0.7, vn3(a * 2, y * 4, 0, seed));
    r *= 1 + 0.035 * vn3(Math.cos(a) * 3, y * 1.5, Math.sin(a) * 3, seed + 1) - 0.06 * sstep(0.55, 0.8, vn3(Math.cos(a) * 5, y * 2.5, Math.sin(a) * 5, seed + 9));
    o[0] = Math.cos(a) * r; o[1] = y; o[2] = Math.sin(a) * r;
    const c = (0.82 + 0.2 * vn3(o[0] * 3, y * 2, o[2] * 3, seed + 5)) * (st.carved && band < 0.1 ? 0.7 : 1);
    o[3] = scol[0] * c; o[4] = scol[1] * c; o[5] = scol[2] * c; o[6] = GROW * 0.7; o[7] = key;
  }, { wrapU: true });
  const ring = v0 + NU * NV;
  if (broken) {
    let cy = 0; for (let i = 0; i < NU; i++) cy += b.P[(ring + i) * 3 + 1];
    const c = b.v(0, cy / NU - 0.05, 0, 0, 1, 0, STONE[0], STONE[1], STONE[2], GROW, key);
    for (let i = 0; i < NU; i++) b.t(ring + ((i + 1) % NU), ring + i, c);
  } else if (capital) {
    const rt = R * (1 - st.taper);
    if (st.cap === 'doric') { stoneLathe(16, 3, (v) => [rt * (1 + 0.45 * Math.sin(v * Math.PI * 0.5)), top + v * 0.4]); b.box(R * 3, 0.32, R * 3, null, 0, top + 0.56, 0, STONE, f); }
    if (st.cap === 'ionic') {
      stoneLathe(16, 2, (v) => [rt * (1 + 0.25 * v), top + v * 0.25]);
      b.box(R * 2.9, 0.2, R * 2.3, null, 0, top + 0.45, 0, STONE, f);
      for (const sd of [-1, 1]) {
        b.tube([[sd * R * 1.15, top + 0.2, -R * 1.1], [sd * R * 1.15, top + 0.2, R * 1.1]], [R * 0.32, R * 0.32], 8, paintStone(STONE), { cap: true });
        for (const fz of [-1, 1]) {
          const sp = [];
          for (let k = 0; k <= 10; k++) { const th = k / 10 * TAU * 1.6, rr = R * 0.3 * (1 - k / 13); sp.push([sd * R * 1.15 + Math.cos(th) * rr, top + 0.2 + Math.sin(th) * rr, fz * (R * 1.1 - 0.01)]); } // carved into the volute's face
          b.tube(sp, sp.map(() => 0.03), 3, paintStone(STONE.map((c) => c * 0.8)));
        }
      }
    }
    if (st.cap === 'corinthian') {
      stoneLathe(16, 5, (v) => [rt * (1 + 0.45 * v), top + v * R * 2.2], (a, v) => 1 + 0.16 * Math.max(0, Math.sin(a * 8 + (v > 0.5 ? 0.4 : 0))) * Math.sin((v * 2 % 1) * Math.PI));
      b.box(R * 3.1, 0.22, R * 3.1, null, 0, top + R * 2.2 + 0.11, 0, STONE, f);
    }
    if (st.cap === 'papyrus') stoneLathe(16, 4, (v) => [rt * (0.9 + 0.8 * Math.sin(v * Math.PI * 0.5)), top + v * R * 2.2], (a) => 1 + 0.06 * Math.abs(Math.sin(a * 8)));
    if (st.cap === 'lotus') stoneLathe(14, 5, (v) => [rt * (1 + 0.35 * Math.sin(v * Math.PI) - 0.3 * v), top + v * R * 2.4], (a) => 1 + 0.1 * Math.abs(Math.sin(a * 3)));
    if (st.cap === 'block') b.box(R * 2.8, 0.45, R * 2.8, null, 0, top + 0.22, 0, STONE.map((c) => c * 0.95), f);
    if (st.cap === 'cushion') { stoneLathe(16, 4, (v) => [rt * (1 + 0.4 * Math.sin(v * Math.PI)), top + v * 0.45], null, [0.25, 0.2, 0.18]); b.box(R * 2.9, 0.25, R * 2.9, null, 0, top + 0.57, 0, [0.3, 0.25, 0.22], f); }
  }
  const t = b.build();
  t.label = broken ? 'Broken ' + st.name.toLowerCase() : st.name;
  t.colR = R; t.colH = top; t.colStyleCol = scol; // the kit copies these templates into buildings, rescaled
  return t;
}

// a capital broken off and lying on its side
function capitalPiece(seed, style) {
  const t = column(seed, style, { H: 0.9 });
  const b = new Builder();
  b.P = Array.from(t.pos); b.N = Array.from(t.nor); b.C = Array.from(t.col); b.F = Array.from(t.fx); b.I = Array.from(t.idx);
  b.xform(0, rotZ(Math.PI / 2 + 0.25), 0.4, 0.5, 0);
  let mn = 1e9; for (let i = 1; i < b.P.length; i += 3) mn = Math.min(mn, b.P[i]);
  for (let i = 1; i < b.P.length; i += 3) b.P[i] -= mn;
  const c = b.build();
  c.label = 'Fallen ' + t.label.toLowerCase().replace('column', 'capital').replace('pillar', 'capital');
  return c;
}

// a fallen drum lying on its side
function drum(seed, style) {
  const t = column(seed, style, { H: 1.0 + (seed % 3) * 0.35, broken: 1, capital: false, base: false });
  const b = new Builder();
  b.P = Array.from(t.pos); b.N = Array.from(t.nor); b.C = Array.from(t.col); b.F = Array.from(t.fx); b.I = Array.from(t.idx);
  b.xform(0, rotZ(Math.PI / 2), 0.6, 0.35, 0);
  const d = b.build();
  d.label = 'Fallen column drum';
  return d;
}

function stoneBlock(b, rng, sx, sy, sz, R, x, y, z, col = STONE) {
  const v0 = b.vc, k = 0.82 + 0.25 * rng();
  b.box(sx * 0.97, sy * 0.97, sz * 0.97, null, 0, 0, 0, col.map((c) => c * k), [GROW, 0]);
  const j = Math.min(sx, sy, sz) * 0.06, cache = new Map();
  for (let i = v0; i < b.vc; i++) { // same jitter for coincident corners
    const key = b.P.slice(i * 3, i * 3 + 3).map((v) => Math.round(v * 100)).join(',');
    let d = cache.get(key);
    if (!d) { d = [(rng() - 0.5) * j, (rng() - 0.5) * j, (rng() - 0.5) * j]; cache.set(key, d); }
    b.P[i * 3] += d[0]; b.P[i * 3 + 1] += d[1]; b.P[i * 3 + 2] += d[2];
  }
  b.xform(v0, R || I3, x, y, z);
}

function head(seed) {
  const b = new Builder();
  const hr = mulberry32(seed * 31), wk = 0.5 + hr() * 0.25, hk = 0.85 + hr() * 0.4, nk = 0.15 + hr() * 0.25;
  b.blob(5, (x, y, z, o) => {
    let px = x * wk, py = y * hk, pz = z * 0.55;
    if (py < -0.75) py = -0.75 - (py + 0.75) * 0.1;
    if (py > 0.8) py = 0.8 + (py - 0.8) * 0.3; // flat top
    let dark = 0;
    if (z > 0) {
      const f = z;
      pz += 0.12 * f * sstep(0.25, 0.4, y) * sstep(0.62, 0.45, y);            // brow ridge
      const nose = Math.exp(-(x * x) / 0.012) * sstep(-0.05, 0.25, y) * sstep(0.45, 0.3, y);
      pz += nk * nose * f;
      const eye = Math.exp(-((Math.abs(x) - 0.22) ** 2 + (y - 0.25) ** 2) / 0.006);
      pz -= 0.06 * eye; dark += eye * 0.5;
      const mouth = Math.exp(-(x * x) / 0.05) * Math.exp(-((y + 0.18) ** 2) / 0.002);
      pz -= 0.04 * mouth; dark += mouth * 0.4;
      pz += 0.1 * f * sstep(-0.3, -0.45, y) * sstep(-0.7, -0.5, y);           // chin / jaw
    }
    const ear = Math.exp(-((Math.abs(z) - 0.0) ** 2) / 0.02) * sstep(0.5, 0.95, Math.abs(x)) * sstep(-0.2, 0.1, y) * sstep(0.6, 0.4, y);
    px *= 1 + 0.12 * ear;
    const d = 1 + 0.03 * fbm3(x * 4, y * 4, z * 4, 2, seed);
    o[0] = px * d; o[1] = (py + 0.76) * d; o[2] = pz * d;
    const c = (0.8 + 0.15 * vn3(x * 5, y * 5, z * 5, seed)) * (1 - dark);
    o[3] = STONE[0] * c * 0.85; o[4] = STONE[1] * c * 0.85; o[5] = STONE[2] * c * 0.85; o[6] = GROW; o[7] = 0;
  });
  return b.build();
}

function amphora(seed) {
  const b = new Builder(), rng = mulberry32(seed * 41);
  const col = [[0.5, 0.3, 0.2], [0.58, 0.38, 0.24], [0.42, 0.25, 0.18], [0.6, 0.45, 0.32]][seed % 4];
  const H = 0.75 + rng() * 0.35, belly = 0.16 + rng() * 0.12, bp = 0.5 + rng() * 0.2, neck = 0.05 + rng() * 0.04;
  const prof = (v) => {
    if (v < 0.1) return [0.04 + v * 0.5 * (1 + rng() * 0), v * H];
    if (v < bp + 0.1) return [0.08 + belly * Math.sin(((v - 0.1) / bp) * Math.PI * 0.85), v * H];
    if (v < 0.9) return [neck + 0.06 * (1 - (v - bp - 0.1) / (0.8 - bp)), v * H];
    return [neck + 0.015, v * H];
  };
  b.lathe(10, 12, prof, null, (v, a, x, y, z, o) => { const c = 0.7 + 0.3 * v; o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[6] = 0.4; });
  for (const sd of [-1, 1]) {
    const pts = [[sd * 0.08, 0.78, 0], [sd * 0.19, 0.76, 0], [sd * 0.2, 0.62, 0], [sd * 0.15, 0.54, 0]];
    b.tube(pts, [0.02, 0.02, 0.02, 0.02], 4, (v, a, x, y, z, o) => { o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0.4; });
  }
  return b.build();
}

// wide-mouthed urn with a lip and a fallen lid
function urn(seed) {
  const b = new Builder(), rng = mulberry32(seed * 43), col = [0.55, 0.42, 0.3], H = 0.5 + rng() * 0.3, W = 0.2 + rng() * 0.1;
  b.lathe(12, 8, (v) => [W * (0.55 + 0.5 * Math.sin(v * Math.PI * 0.95)) + (v > 0.92 ? 0.03 : 0), v * H], null, (v, a, x, y, z, o) => { const c = 0.7 + 0.35 * v; o[3] = col[0] * c; o[4] = col[1] * c; o[5] = col[2] * c; o[6] = 0.5; });
  b.lathe(12, 2, (v) => [W * 0.7 * (1 - v * 0.6), H - v * H * 0.4], null, (v, a, x, y, z, o) => { o[3] = 0.12; o[4] = 0.09; o[5] = 0.07; }, { flip: true });
  const t = b.build(); t.label = 'Urn'; return t;
}
// big storage jar, half buried
function pithos(seed) {
  const b = new Builder(), col = [0.52, 0.34, 0.24], H = 1.4 + (seed % 2) * 0.4;
  b.lathe(16, 10, (v) => [0.18 + 0.4 * Math.sin(v * Math.PI * 0.9) + 0.03 * Math.sin(v * 30), v * H], (a, v) => 1 + 0.03 * vn3(Math.cos(a) * 2, v * 4, Math.sin(a) * 2, seed),
    (v, a, x, y, z, o) => { const band = Math.abs(Math.sin(v * 30)) > 0.92 ? 0.8 : 1; o[3] = col[0] * band; o[4] = col[1] * band; o[5] = col[2] * band; o[6] = 0.7; });
  const t = b.build(); t.label = 'Storage jar (pithos)'; return t;
}
// fragment of a monumental stair
function steps(seed) {
  const b = new Builder(), rng = mulberry32(seed * 47), n = 3 + Math.floor(rng() * 5), W = 2.5 + rng() * 3;
  for (let k = 0; k < n; k++) {
    for (let x = -W / 2; x < W / 2; x += 0.8 + rng() * 0.6) {
      if (rng() < 0.12) continue;
      const h = 0.32 * (k + 1);
      stoneBlock(b, rng, 0.75 + rng() * 0.4, h, 0.7, rotY((rng() - 0.5) * 0.04), x + 0.4, h / 2, -k * 0.6 + (rng() - 0.5) * 0.05);
    }
  }
  const t = b.build(); t.label = 'Temple steps'; return t;
}

function slab(seed, w, d) {
  const b = new Builder(), rng = mulberry32(seed);
  stoneBlock(b, rng, w, 0.25, d, null, 0, 0.04, 0, STONE.map((c) => c * 0.95));
  return b.build();
}

// street furniture built once at startup on a flat site (seated per placement): Roman basalt paving
// polygons, kerbs, stone lanterns, stelae with altars, orichalcum orbs, horned parapets
const FLAT = { fl: () => 0, range: () => [0, 0] };
function furniture(kind, seed, S) {
  const B = new Bld(FLAT, seed, S, { tier: 'high', decay: 0.1, grow: 0.8, silt: 0 });
  const it = genMonument(B, kind);
  let r = it.next();
  while (!r.done) r = it.next();
  const info = r.value || {};
  return B.finish(info.label || kind, info.fact || null, { support: false });
}
function polySlab(seed) {
  const b = new Builder(), rng = mulberry32(seed * 97 + 5), n = 5 + ((rng() * 3) | 0), R = 0.42 + rng() * 0.18, pts = [];
  for (let i = 0; i < n; i++) { const a = (i + rng() * 0.6) / n * TAU, r = R * (0.75 + rng() * 0.4); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const col = [0.24, 0.24, 0.26], top = b.vc;
  b.v(0, 0.2, 0, 0, 1, 0, col[0], col[1], col[2], 0.5, 6.35);
  for (const p of pts) b.v(p[0] * 0.94, 0.17, p[1] * 0.94, 0, 1, 0, col[0] * 0.95, col[1] * 0.95, col[2] * 0.95, 0.5, 6.35);
  for (let i = 0; i < n; i++) b.t(top, top + 1 + ((i + 1) % n), top + 1 + i);
  const s0 = b.vc;
  for (const p of pts) { b.v(p[0] * 0.94, 0.17, p[1] * 0.94, p[0], 0.4, p[1], col[0], col[1], col[2], 0.3, 6.35); b.v(p[0], -0.05, p[1], p[0], 0, p[1], col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 0.2, 6.35); }
  for (let i = 0; i < n; i++) { const a = s0 + i * 2, c = s0 + ((i + 1) % n) * 2; b.t(a, c + 1, a + 1); b.t(a, c, c + 1); }
  b.smooth(0, 0);
  return b.build();
}

export function initRuins() {
  T.colStyle = {};
  let sd = 1;
  for (const k of COL_STYLE_KEYS) {
    T.colStyle[k] = {
      intact: [column(sd++, k, { H: 5.5 + (sd % 3) }), column(sd++, k, { H: 6.5 + (sd % 4) * 0.6 })],
      broken: [0.25, 0.45, 0.7].map((f) => column(sd++, k, { H: 6.5, broken: f + ((sd * 0.13) % 0.12) })),
      drum: [drum(sd++, k), drum(sd++, k), drum(sd++, k)],
      cap: [capitalPiece(sd++, k)],
    };
    T.colStyle[k].lite = {
      intact: [column(sd++, k, { H: 6, lite: true }), column(sd++, k, { H: 6.8, lite: true })],
      broken: [0.3, 0.55].map((f) => column(sd++, k, { H: 6.5, broken: f, lite: true })),
    };
  }
  T.column = COL_STYLE_KEYS.flatMap((k) => T.colStyle[k].intact);
  T.columnBroken = COL_STYLE_KEYS.flatMap((k) => T.colStyle[k].broken);
  T.drum = COL_STYLE_KEYS.flatMap((k) => T.colStyle[k].drum);
  T.head = vary([1, 2, 3, 4, 5, 6].map(head), 2, 81, { disp: 0.04, bend: 0.04, twist: 0.1 });
  T.figure = statueSet();
  T.amphora = [1, 2, 3, 4, 5, 6].map(amphora);
  T.amphoraLying = T.amphora.map(lyingAmphora);
  T.urn = [1, 2, 3].map(urn);
  T.pithos = [1, 2].map(pithos);
  T.steps = [1, 2, 3, 4].map(steps);
  T.pave = [slab(1, 1.1, 0.8), slab(2, 0.8, 0.8), slab(3, 1.4, 0.7), slab(4, 1.25, 0.9), slab(5, 0.95, 0.95)]; // unlabelled: no overlay noise
  T.polySlab = [1, 2, 3, 4, 5, 6].map(polySlab);
  T.kerb = [1, 2, 3].map((s) => slab(10 + s, 1.3 + s * 0.15, 0.32));
  T.block = [1, 2].map((sd) => { const b = new Builder(); stoneInto(b, { sx: 1.2, sy: 0.7, sz: 0.9, p: 5, rough: 0.08, seed: sd, detail: 2, col: STONE, growth: GROW }); b.xform(0, I3, 0, 0.3, 0); return b.build(); });
  T.ruinsFurniture = {
    lantern: [1, 2, 3].map((s) => furniture('lantern', s, STYLES.pagoda)),
    stela: [1, 2, 3, 4].map((s) => furniture('stela', s * 7, STYLES.maya)),
    orb: [1, 2].map((s) => furniture('orb', s * 5, STYLES.atlantis)),
    horns: [1, 2].map((s) => { const B = new Bld(FLAT, s, STYLES.minoan, { tier: 'high', decay: 0, grow: 0.8, silt: 0 }); B.pier(2.4, 0.7, 0, 0, 0.9, null, B.tone(B.stone, 0.05), 0.03, 0.02); horns(B, 0, 0.9, 0, 1.0 + s * 0.15, 0); B.cap(-1, 0.6, 0, 1, 0.6, 0, 0.55); return B.finish('Horns of consecration', 'Stone "horns of consecration", probably bull horns, crowned Minoan shrines.', { support: false }); }),
  };
}

// ---------- layout ----------
const S = {};
function specs() {
  if (S.rock) return S;
  const st = tintFrom(STONES, 0.1);
  Object.assign(S, {
    rock: { tpl: T.rocks, scale: [0.4, 1.4], ys: [0.7, 1.35], xz: 0.5, grow: [0.1, 1.5], follow: 0.5, tint: tintFrom([[0.55, 0.52, 0.47]]) },
    block: { tpl: T.block, scale: [0.7, 1.4], follow: 0.7, tilt: 0.5, sink: 0.15, tint: st },
    drum: { tpl: T.drum, scale: [0.9, 1.1], follow: 0.9, sink: 0.12, tint: st },
    urn: { tpl: [...T.urn, ...T.pithos], scale: [0.9, 1.3], follow: 0.6, tilt: 0.5, sink: 0.25, tint: tintFrom([[1, 1, 1], [0.85, 0.9, 1]]) },
    steps: { tpl: T.steps, scale: [0.9, 1.2], follow: 0.8, sink: 0.12, occ: 0.8, tint: tintFrom([[1, 1, 1], [1.2, 1.0, 0.75], [0.6, 0.6, 0.65]]) },
    amphora: { tpl: T.amphora, scale: [0.9, 1.3], follow: 0.6, tilt: 0.6, sink: 0.15, tint: tintFrom([[1, 1, 1], [0.8, 0.85, 0.9]]) },
    colB: { tpl: T.columnBroken, scale: [0.9, 1.1], follow: 0.05, tint: st },
    head: { tpl: T.head, scale: [1.6, 2.6], follow: 0.3, tilt: 0.25, sink: 0.15, occ: 0.8, layer: 1, tint: st },
    figure: { tpl: T.figure, scale: [0.9, 1.5], follow: 0.1, occ: 0.8, layer: 1, tint: st },
    sponge: { tpl: T.tubeSp, scale: [0.5, 1.1], follow: 0.5, tint: tintFrom([[0.65, 0.3, 0.12], [0.5, 0.18, 0.5], [0.7, 0.6, 0.15]]) },
    soft: { tpl: T.soft, scale: [0.5, 1.1], follow: 0.4, sway: true, tint: tintFrom([[0.75, 0.25, 0.4], [0.75, 0.38, 0.1]]) },
    fan: { tpl: T.fan, scale: [0.6, 1.4], follow: 0.2, sway: true, tint: tintFrom([[0.5, 0.15, 0.55], [0.7, 0.1, 0.12], [0.75, 0.55, 0.12]]) },
    anem: { tpl: T.anem, scale: [0.7, 1.2], follow: 0.7, sway: true, tint: tintFrom([[0.8, 0.8, 0.8]]) },
    urchin: { tpl: T.urchin, scale: [0.06, 0.1], follow: 0.8, tint: tintFrom([[0.4, 0.3, 0.45]]) },
    brain: { tpl: T.brain, scale: [0.3, 0.8], follow: 0.7, tint: tintFrom([[0.45, 0.4, 0.25], [0.35, 0.42, 0.25]]) },
  });
  Object.assign(S, {
    rubble: { tpl: T.rubble, scale: [0.9, 1.8], follow: 1, sink: 0.02, tint: tintFrom([[0.75, 0.72, 0.65], [0.65, 0.62, 0.56]], 0.1) },
    algae: { tpl: T.algae, scale: [0.6, 1.5], follow: 1, sink: 0.01, tint: tintFrom([[0.6, 0.7, 0.4], [0.75, 0.55, 0.45]], 0.12) },
    lump: { tpl: T.spongeLump, scale: [0.8, 1.6], follow: 0.7, tint: tintFrom([[0.85, 0.5, 0.15], [0.7, 0.25, 0.55], [0.8, 0.75, 0.2]]) },
  });
  // overgrowth on walls and roofs (small, seated on the building's top surfaces)
  S.growth = [
    { w: 2, spec: { ...S.lump, scale: [0.5, 1.0], follow: 0.2 } }, { w: 1.6, spec: { ...S.sponge, scale: [0.35, 0.7], follow: 0.2 } }, { w: 1.5, spec: { ...S.soft, scale: [0.35, 0.7], follow: 0.2 }, sway: true },
    { w: 1.0, spec: { ...S.fan, scale: [0.4, 0.75] }, sway: true }, { w: 0.8, spec: { ...S.anem, scale: [0.4, 0.7], follow: 0.3 }, sway: true }, { w: 1.2, spec: { ...S.brain, scale: [0.2, 0.4], follow: 0.3 } },
  ];
  S.micro = [{ w: 3, spec: S.rubble }, { w: 1.6, spec: S.algae }, { w: 1.2, spec: S.lump }];
  S.scatter = [
    { w: 2.5, k: 'block' }, { w: 0.9, k: 'urn' }, { w: 0.5, k: 'steps' }, { w: 1.2, k: 'drum' }, { w: 2, k: 'amphora' }, { w: 1.2, k: 'rock' }, { w: 1.5, k: 'sponge' },
    { w: 1.2, k: 'soft', sway: true }, { w: 1.2, k: 'fan', sway: true }, { w: 0.8, k: 'anem', sway: true }, { w: 1, k: 'urchin' }, { w: 1, k: 'brain' },
    { w: 0.25, k: 'head' }, { w: 0.35, k: 'figure' },
  ];
  return S;
}

const tag = (n, f) => { f.tag = n; return f; }; // step names for profiling (window.__stageTrace / tools)
const PAVE = { poly: [1.3, 1.1], slab: [1.25, 0.95], sacbe: [1.5, 1.15], laterite: [1.05, 0.8], granite: [0.95, 1.9], rings: [1.2, 1.2] };
const pathYaw = (ctx, s) => Math.atan2(-(ctx.pathX(s + 3) - ctx.pathX(s - 3)), 6);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const now = () => performance.now();

// a statue of the city's style on the ground or on whatever support is there; registers a POI
function statueAt(ctx, fs, st, list, x, s, rng, head = false, yaw = undefined) {
  if (s < ctx.s0 || s >= ctx.s1 || !list.length) return null; // occupancy is per chunk: keep statues inside their own chunk
  const sp = specs(), t = rng.pick(list); // bronze keeps its own patina; stone takes the city's stone tints
  const spec = head ? sp.head : { ...sp.figure, tpl: t, yaw, yawJ: 0.5, tint: t.bronze ? tintFrom([[1, 1, 1]], 0.05) : sp.figure.tint };
  if (!putFloor(ctx, fs, st, spec, x, s, rng)) return null;
  const it = st.last, h = (it.tpl.box[4] - it.tpl.box[1]) * it.sy;
  poi(ctx, 'statue', it.x, it.y + h * 0.6, s, Math.max(1.5, h * 0.7), { name: it.tpl.label });
  return it;
}

// an octopus den: a spill of amphorae lying on their sides, one with its mouth toward the open water
// amphora lying on its belly, built that way (its template base is the side it rests on)
function lyingAmphora(t) {
  const b = new Builder(), a = Math.PI / 2 - 0.12, R = rotZ(a);
  b.P = Array.from(t.pos); b.N = Array.from(t.nor); b.C = Array.from(t.col); b.F = Array.from(t.fx); b.I = Array.from(t.idx);
  b.xform(0, R, 0, 0, 0);
  let mn = 1e9; for (let i = 1; i < b.P.length; i += 3) mn = Math.min(mn, b.P[i]);
  for (let i = 1; i < b.P.length; i += 3) b.P[i] -= mn;
  const L = b.build();
  L.label = t.label; L.fact = t.fact;
  L.mouth = [R[1] * t.maxY, R[4] * t.maxY - mn, R[7] * t.maxY]; // template top (the neck) after the turn
  return L;
}

function amphoraDen(ctx, fs, st, rng, items) {
  const p = spot(ctx, rng, 5, 16, 1);
  if (rng() > ctx.weightOf(p.s, 'ruins') || blocked(items, p.x, p.s, 2.5, true)) return;
  const n = 3 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) {
    const tpl = rng.pick(T.amphoraLying), yaw = rng() * TAU, sc = 0.95 + rng() * 0.3;
    const R = rotY(yaw), x = p.x + (rng() - 0.5) * 2.5, s = p.s + (rng() - 0.5) * 2.5;
    if (s < ctx.s0 || s >= ctx.s1) continue;
    const y = groundY(fs, x, s, tpl, R, sc, sc, sc) - 0.06 * sc;
    if (!st.add(tpl, x, y, -(s - ctx.s0), R, sc, sc, sc, 0.9 + rng() * 0.2, 0.9 + rng() * 0.15, 0.9 + rng() * 0.15, 0.6 + rng())) return;
    const it = st.last;
    it.g = 1;
    if (k === 0) { // the den: its mouth, where an octopus peers out
      const m = tpl.mouth, mx = x + (R[0] * m[0] + R[2] * m[2]) * sc, ms = s - (R[6] * m[0] + R[8] * m[2]) * sc;
      it.lbl = 'Amphora (octopus den)'; it.fact = 'Octopuses move into empty amphorae; fishermen once caught them with strings of clay pots.';
      poi(ctx, 'amphora-den', mx, y + m[1] * sc, ms, 1.2, { dir: [R[0] * m[0] + R[2] * m[2], -(R[6] * m[0] + R[8] * m[2])] });
    }
  }
}

// plans of every ruins city touching the chunk (cross-fade chunks may see two)
function plansOf(ctx) {
  const out = [];
  const add = (g) => { if (g && g.key === 'ruins' && !out.some((p) => p.seg === g)) out.push(planFor(g)); };
  for (const g of ctx.segments) add(g);
  for (const s of [ctx.s0, ctx.s0 + 32, ctx.s1]) for (const e of ctx.weights(s)) add(e.g);
  return out;
}

const GATE_NAMES = { arch: 'Roman arch', triumph: 'Triumphal arch', trilithon: 'Trilithon gate', pylon: 'Temple pylon', corbelArch: 'Corbel arch', gopura: 'Gopura (gate tower)', propylon: 'Propylon', paifang: 'Paifang (memorial archway)', torii: 'Torii gate', gateTower: 'Gate tower', organic: 'Atlantean arch' };
const GATE_FACTS = {
  arch: 'The wedge-shaped keystone locks a Roman arch: every stone leans on its neighbours.',
  triumph: 'Roman triumphal arches celebrated victories; generals paraded through them with their spoils.',
  trilithon: 'Two uprights and a lintel: the oldest way to frame a doorway in stone.',
  pylon: 'A temple pylon imitates the hieroglyph for horizon: two hills with the sun rising between them.',
  corbelArch: 'The Maya never used the true arch: their vaults step inward course by course until a capstone closes the gap.',
  gopura: 'Khmer gate towers were crowned with lotus-bud towers, or with giant faces gazing in four directions.',
  propylon: 'A propylon is a monumental columned gateway into a sacred precinct or palace.',
  paifang: 'A paifang is a ceremonial archway, often raised to honour a person or mark the gate of a town.',
  torii: 'A torii marks the threshold between the everyday world and sacred ground.',
  gateTower: 'Shi Cheng, China\'s "Lion City", was flooded for a reservoir in 1959; its gate towers still stand underwater.',
  organic: 'Plato said the inner wall of Atlantis was clad in orichalcum, which glittered like fire.',
};
const CROSS = { aqueduct: ['Aqueduct', 'Roman aqueducts ran on gravity alone, some dropping only about 25 cm per kilometre.'], bridge: ['Stone bridge', 'Some Roman stone bridges still carry traffic after nearly 2,000 years.'], moonBridge: ['Moon bridge', 'Hump-backed moon bridges are so steep that with their reflection they make a full circle.'] };

export function layoutRuins(ctx) {
  if (presence(ctx, 'ruins') <= 0) return null;
  const sp = specs(), rng = ctx.rng, fs = floorSampler(ctx), bk = budgetK(ctx, 'ruins'), tk = tierK(ctx), lo = ctx.tier === 'low';
  const st = new Batch(MAT.static, (lo ? 110000 : 170000) * bk);                                          // architecture, statues
  const mid = new Batch(MAT.static, 42000 * bk * tk, 'mid'), msw = new Batch(MAT.sway, 20000 * bk * tk, 'mid'); // scatter, growth
  const near = new Batch(MAT.static, 18000 * bk * tk, 'near');                                            // floor micro detail
  const idx = Math.floor(ctx.s0 / 64), plans = plansOf(ctx), items = [], more = [], placed = [];
  for (const P of plans) itemsNear(P, ctx, ctx.s0 - 1, ctx.s1 + 1, items);
  const P0 = plans[0] || null, S0 = P0 ? P0.S : STYLES.greco;
  // the city's statues are made first (one per step), so every structure below can use them
  if (P0) for (const f of statueSteps(statueKinds(S0), [], P0.seed)) more.push(tag('statue', f));
  const statues0 = () => figs(S0.statues);
  // ---- structures owned by this chunk: one continuation step each (a few for city walls)
  const place = (it, P, B, info, cross) => {
    if (!B.b.vc) { B.release(); return null; }
    const tpl = B.finish(info.label, info.fact ?? null);
    const site = B.site;
    if (!pointsClear(ctx, placedPoints(tpl, it.x, site.y0, it.s, site.R, 1, 1, 1, cross ? 2400 : 900), cross ? 0.3 : 0.4)) return null;
    if (!st.add(tpl, it.x, site.y0, -(it.s - ctx.s0), site.R, 1, 1, 1, 1, 1, 1, 1)) return null;
    const item = st.last;
    item.g = 1;
    if (tpl.supProxy) fs.addSupport({ tpl: tpl.supProxy, x: item.x, y: item.y, R: item.R, sx: 1, sy: 1, sz: 1 }, it.s); // top surfaces only
    placed.push({ it, tpl, site, P });
    return item;
  };
  const bld = (it, P, salt, coarse = false) => {
    const site = new Site(fs, it.x, it.s, it.yaw);
    const h = mulberry32((it.seed ^ salt) >>> 0);
    const decay = clamp01(P.decay + it.decayK + (h() - 0.5) * 0.55);
    const show = (ctx.tier === 'high' || ctx.tier === 'ultra') && it.gen === 'gate' && salt === 3; // the gates the camera passes through
    const big = it.gen === 'crossing' || it.gen === 'big' || salt >= 10; // long arcades, city walls, towers: big blocks
    return new Bld(site, it.seed + salt, it.S, { tier: ctx.tier, decay, grow: P.grow * (0.6 + 0.8 * h()), silt: P.silt, coarse: coarse || big, bev: show ? 0.055 : 0 });
  };
  // A structure is built by a resumable generator: one step per time slice (the step re-queues itself in
  // front until done), then finished and placed. start() returns [Bld, iterator] or null to skip.
  const drive = (name, start, done) => {
    let B = null, iter = null, res = null;
    const step = tag(name, () => {
      if (!res) {
        if (!iter) { const r = start(); if (!r) return; [B, iter] = r; }
        B.t0 = now();
        const r = iter.next();
        if (!r.done) { B.detach(); more.unshift(step); return; }
        res = r.value || {};
      } else B.t0 = now();
      if (!B.prep(2.5) || B.over(1.0)) { B.detach(); more.unshift(step); return; } // silt and growth colouring, resumable
      done(B, res); // template, clearance and placement
    });
    return step;
  };
  for (const it of items) {
    if (Math.floor(it.s / 64) !== idx) continue;
    const P = it.plan, S = it.S, w0 = it.cross ? 0.45 : 0.3;
    const ok = () => ctx.weightOf(it.s, 'ruins') >= w0;
    if (it.gen === 'lot') more.push(drive('lot:' + it.kind, () => {
      if (!ok()) return null;
      const B = bld(it, P, 1, it.row === 2 || (lo && it.row === 1 && it.W * it.D > 150));
      return [B, genLot(B, it.kind, it.W, it.D)];
    }, (B, info) => {
      const item = place(it, P, B, { label: info.label || (S.names && S.names[it.kind]) || 'Ruined building', fact: info.fact || (S.facts && S.facts[it.kind]) || null });
      if (item && rng() < 0.12) poi(ctx, 'treasure', it.x + (rng() - 0.5) * it.W * 0.6, B.site.y0 + 0.4, it.s + (rng() - 0.5) * 2, 2, { ruin: true });
    }));
    else if (it.gen === 'landmark' || it.gen === 'monument' || it.gen === 'temple' || it.gen === 'big') more.push(drive(it.gen + ':' + it.kind, () => {
      if (!ok()) return null;
      const B = bld(it, P, 2);
      return [B, it.gen === 'landmark' ? genLandmark(B, it.kind) : it.gen === 'monument' ? genMonument(B, it.kind) : it.gen === 'temple' ? genTemple(B, it.kind, it.W, it.D) : genBig(B, it.kind, it.W / 2)];
    }, (B, info) => {
      const item = place(it, P, B, info);
      if (item) { // in open water in front of it (toward the street), where a school can mill without entering the stone
        const lat = it.side * Math.max(TUBE + 1, it.off - (it.D || 6) / 2 - 1.8), y = B.site.y0 + Math.min(6, Math.max(2, (info.h || 4) * 0.45));
        poi(ctx, info.poi || 'giant', ctx.pathX(it.s) + lat, y, it.s, Math.max(2, Math.min(9, (info.h || 4) * 0.45)), { name: info.label });
      }
    }));
    else if (it.gen === 'gate' || it.gen === 'citywall') {
      const hp = () => ctx.pathY(it.s) - fs.floor(it.x, it.s);
      const g = { x0: -1 };
      const name = it.gen === 'citywall' ? 'City gate of ' + P.city : GATE_NAMES[it.gate] || 'Gate';
      more.push(drive('gate:' + it.gate, () => {
        if (!ok()) return null;
        const B = bld(it, P, 3);
        B.decay *= 0.6;
        return [B, genGate(B, it.gate, hp(), it.Rg)];
      }, (B, x0) => {
        const item = place(it, P, B, { label: name, fact: it.gen === 'citywall' ? S.facts.city : GATE_FACTS[it.gate] }, true);
        if (item) { poi(ctx, 'arch', it.x, B.site.y0 + hp(), it.s, 5, { kind: name }); g.x0 = x0; }
      }));
      if (it.gen === 'citywall') for (const sd of [-1, 1]) {
        const w = {};
        more.push(drive('citywall', () => {
          if (g.x0 < 0) return null;
          const B = bld(it, P, 10 + sd);
          return [B, genCityWall(B, sd, g.x0 - 0.3, it.span)];
        }, (B, r) => { Object.assign(w, r); place(it, P, B, { label: 'City wall', fact: 'City gates were the weak point of a wall, so they were flanked by towers.' }, true); }));
        more.push(drive('walltowers', () => {
          if (g.x0 < 0 || !w.t) return null;
          const B = bld(it, P, 20 + sd);
          return [B, genWallTowers(B, sd, g.x0, it.span, w.t, w.Hw)];
        }, (B) => place(it, P, B, { label: 'Wall tower', fact: null }, true)));
      }
    } else if (it.gen === 'crossing') {
      const [label, fact] = CROSS[it.kind] || ['Bridge', null];
      more.push(drive('crossing:' + it.kind, () => {
        if (!ok()) return null;
        const B = bld(it, P, 4);
        B.decay *= 0.6;
        return [B, genCrossing(B, it.kind, ctx.pathY(it.s) - B.site.y0, it.span)];
      }, (B) => {
        const item = place(it, P, B, { label, fact }, true);
        if (item) poi(ctx, 'arch', it.x, B.site.y0 + ctx.pathY(it.s) - B.site.y0, it.s, 5, { kind: label });
      }));
    }
  }
  // ---- the street: paving (per style), kerbs, avenue furniture; plazas widen the paving
  const step = 4.0;
  const styleAt = (s) => { for (const P of plans) if (s >= P.seg.start - 90 && s < P.seg.end + 90) return P; return P0; };
  const paving = (s) => {
    const P = styleAt(s);
    if (!P || ctx.weightOf(s, 'ruins') < 0.25 || noise1(s / 140, 713) < -0.45) return;
    const yaw = pathYaw(ctx, s), half = P.streetHalf, kind = P.S.paving, L = slice(P, ctx, Math.floor((s - P.seg.start) / SL));
    const pl = L && L.plaza && Math.abs(s - L.plaza.s) < L.plaza.half ? L.plaza : null;
    const ext = pl ? pl.x0 + 2 : half, dense = (kind === 'sacbe' ? 1.08 : 1) - 0.35 * sat((P.decay - 0.4) * 2);
    // cells across (cx) and along (cs) the street: running-bond rows of slabs that fill their cells
    const lk = lo ? 1.3 : 1, [cx, cs] = (PAVE[kind] || PAVE.slab).map((v) => v * lk), poly = kind === 'poly';
    const col = kind === 'sacbe' ? [1.3, 1.27, 1.16] : kind === 'laterite' ? [0.85, 0.55, 0.4] : kind === 'granite' ? [0.85, 0.86, 0.9] : kind === 'rings' ? null : [1.05, 1.0, 0.92];
    const ys = kind === 'sacbe' ? 1.9 : kind === 'laterite' ? 1.4 : 1;
    for (let q = 0; q < step / cs; q++) {
      const ss = s + (q + 0.5) * cs + (poly ? (rng() - 0.5) * 0.12 : 0);
      if (ss < ctx.s0 || ss >= ctx.s1) continue;
      const px = ctx.pathX(ss), row = Math.floor(ss / cs);
      for (let x = -ext + cx / 2 + (row % 2) * cx * 0.5; x < ext; x += cx) {
        if (rng() > dense * (0.92 - 0.25 * sat((Math.abs(x) - half + 0.5) / 3))) continue; // gaps: silt and lost stones
        const wx = px + x;
        if (blocked(items, wx, ss, 0.5)) continue;
        fs.at(wx, ss);
        if (fs.onSupport(wx, ss)) continue;
        const tpl = rng.pick(poly ? T.polySlab : T.pave), R = orient(fs.nx, fs.ny, fs.nz, 1, yaw + (poly ? rng() * TAU : (rng() - 0.5) * 0.05), (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.04);
        const b = tpl.box, sx = poly ? cx * (1.05 + rng() * 0.2) : cx * 0.99 / (b[3] - b[0]), sz = poly ? sx : cs * 0.99 / (b[5] - b[2]);
        const gy = groundY(fs, wx, ss, tpl, R, sx, ys, sz) - 0.05;
        const c = col || P.S.bands[(row >> 1) % 3].map((v) => v * 1.25);
        const k = 0.85 + rng() * 0.25;
        if (st.add(tpl, wx, gy, -(ss - ctx.s0), R, sx, ys, sz, c[0] * k, c[1] * k, c[2] * k, 0.4 + rng() * 0.6)) st.last.g = 1;
      }
    }
    if (pl) return;
    for (const sd of [-1, 1]) { // kerbs
      if (rng() < 0.25 + P.decay * 0.3) continue;
      const ss = s + rng() * 1.5, x = ctx.pathX(ss) + sd * (half + 0.2);
      if (blocked(items, x, ss, 0.4) || ss >= ctx.s1) continue;
      putFloor(ctx, fs, st, { tpl: T.kerb, scale: [1, 1.15], ys: [1.4, 2], yaw: yaw + Math.PI / 2, yawJ: 0.06, follow: 0.9, tilt: 0.04, sink: 0.12, tint: tintFrom([col || [1, 1, 1]], 0.05) }, x, ss, rng);
    }
  };
  const avenue = (s, sd) => {
    const P = styleAt(s);
    if (!P || ctx.weightOf(s, 'ruins') < 0.4 || s < ctx.s0 || s >= ctx.s1) return;
    const kind = P.S.avenue, half = P.streetHalf, yaw = pathYaw(ctx, s);
    const L = slice(P, ctx, Math.floor((s - P.seg.start) / SL));
    if (L && L.plaza && Math.abs(s - L.plaza.s) < L.plaza.half) return;
    const x = ctx.pathX(s) + sd * (half + 1.1);
    if (blocked(items, x, s, 1.2)) return;
    const face = yaw - sd * Math.PI / 2;
    if (kind === 'colonnade') return colonnade(ctx, fs, st, mid, P, s, sd, x, yaw, rng, items);
    if (kind === 'sphinx') return statueAt(ctx, fs, st, figs(['sphinx']), x, s, rng, false, face); // dromos: sphinxes facing the street
    const F = T.ruinsFurniture;
    const spec = kind === 'lantern' ? F.lantern : kind === 'stela' ? F.stela : kind === 'orb' ? F.orb : kind === 'horns' ? F.horns : null;
    if (spec) putFloor(ctx, fs, st, { tpl: spec, scale: [0.9, 1.15], yaw: face, yawJ: 0.2, follow: 0.1, tilt: 0.04, sink: 0.25, occ: 0.6, tint: tintFrom([[1, 1, 1]], 0.06) }, x, s, rng);
  };
  const aStep = { colonnade: 4.6, sphinx: 7, naga: 64, lantern: 11, stela: 17, orb: 12, horns: 9 }[(P0 && P0.S.avenue) || 'colonnade'] || 8;
  for (let s = Math.ceil(ctx.s0 / step) * step; s < ctx.s1; s += step) more.push(tag('paving', () => paving(s)));
  if (P0 && P0.S.avenue === 'naga') more.push(tag('naga', () => nagaRails(ctx, fs, st, P0, items)));
  else for (let s = Math.ceil(ctx.s0 / aStep) * aStep; s < ctx.s1; s += aStep) more.push(tag('avenue', () => { avenue(s + rng() * 1.5, -1); avenue(s + rng() * 1.5, 1); }));
  // ---- life and debris: statues, amphorae, fallen blocks, corals and sponges between the buildings
  more.push(() => { if (rng() < 0.3 * presence(ctx, 'ruins')) amphoraDen(ctx, fs, st, rng, items); });
  more.push(...microSteps(ctx, fs, near, rng, 'ruins', sp.micro, 140, 30, 28));
  const nextP = clusterer(ctx, rng, 0, 42, 1.2);
  more.push(...inSteps(Math.round(130 * tk), 13, () => {
    const p = nextP();
    if (!p || rng() > ctx.weightOf(p.s, 'ruins')) return;
    const e = pickW(rng, sp.scatter);
    if (blocked(items, p.x, p.s, e.k === 'figure' || e.k === 'head' ? 1.4 : 0.8, true)) return;
    if (e.k === 'steps' && Math.abs(p.x - ctx.pathX(p.s)) < (P0 ? P0.streetHalf : 3) + 1) return; // stair fragments lie beside the street, not across it
    if (e.k === 'head' || e.k === 'figure') { if (S0.key === 'maya' || e.k === 'figure') statueAt(ctx, fs, st, statues0(), p.x, p.s, rng, e.k === 'head'); return; }
    putFloor(ctx, fs, e.sway ? msw : mid, sp[e.k], p.x, p.s, rng);
  }));
  // ---- overgrowth on the buildings placed above (runs after them)
  more.push(tag('growth', () => { for (const pl of placed) growthSteps(ctx, fs, mid, msw, pl, rng, more); }));
  return { batches: [st, mid, msw, near], more };
}

// corals, sponges and algae seated on a building's wall tops, cornices and roofs
function growthSteps(ctx, fs, mid, msw, pl, rng, more) {
  const sp = specs(), it = pl.it, P = pl.P, n = Math.round(Math.min(18, Math.max(3, (it.W || 8) * (it.D || 8) / 9)) * P.grow * tierK(ctx));
  const hx = (it.cross ? it.span : it.W / 2) + 0.5, hz = (it.cross ? it.depth / 2 : it.D / 2) + 0.5;
  more.push(tag('growth1', () => {
    let got = 0;
    for (let k = 0; k < n * 3 && got < n; k++) {
      const lx = (rng() * 2 - 1) * hx, lz = (rng() * 2 - 1) * hz;
      const x = pl.site.wx(lx, lz), s = pl.site.ws(lx, lz);
      if (s < ctx.s0 || s >= ctx.s1 || !fs.onSupport(x, s, 0.3)) continue;
      const y0 = fs.h(x, s); // only on flat tops (wall crowns, roofs, steps), never astride an edge
      if (Math.abs(fs.h(x + 0.35, s) - y0) > 0.06 || Math.abs(fs.h(x - 0.35, s) - y0) > 0.06 || Math.abs(fs.h(x, s + 0.35) - y0) > 0.06 || Math.abs(fs.h(x, s - 0.35) - y0) > 0.06) continue;
      const e = pickW(rng, sp.growth);
      if (putFloor(ctx, fs, e.sway ? msw : mid, e.spec, x, s, rng)) got++;
    }
  }));
}

// Greek / Roman colonnaded street: a column per slot, standing, leaning, broken or toppled into drums
function colonnade(ctx, fs, st, mid, P, s, sd, x, yaw, rng, items) {
  const sp = specs(), w = ctx.weightOf(s, 'ruins');
  if (rng() > w || noise1(s / 160, 711) <= -0.25) return;
  const h = noise1(s / 7.3 + sd * 11, 712);
  if (h < -0.55) return;
  const blk = Math.floor(s / 24), keys = P.S.cols.filter((k) => COL_STYLES[k]);
  const set = T.colStyle[keys[((rng() < 0.35 ? rng() : hash2i(blk, 0, 715)) * keys.length) | 0]];
  const sc = P.S.stones[((rng() < 0.3 ? rng() : hash2i(blk, 1, 716)) * P.S.stones.length) | 0];
  const k = 0.95 + rng() * 0.25, hs = 0.75 + rng() * 0.5, ws = 0.8 + rng() * 0.45, tint = tintFrom([[sc[0] / 0.62 * k, sc[1] / 0.58 * k, sc[2] / 0.5 * k]], 0.08);
  const fate = rng() + P.decay * 0.25 - 0.1;
  if (fate < 0.32) { // toppled: 2-4 drums in a line along the fall, capital lying apart
    const fa = yaw + sd * Math.PI / 2 + (rng() - 0.5) * 1.6 + (rng() < 0.3 ? Math.PI / 2 : 0), n = 2 + Math.floor(rng() * 3);
    let d = 0.6;
    for (let q = 0; q < n; q++) {
      const dt = rng.pick(set.drum), L = (dt.box[3] - dt.box[0]) * ws;
      d += L * 0.5;
      const px2 = x + Math.cos(fa) * d, ps2 = s + Math.sin(fa) * d;
      d += L * 0.5 + 0.05 + rng() * 0.6;
      if (!blocked(items, px2, ps2, 0.6)) putFloor(ctx, fs, st, { tpl: dt, scale: [ws, ws], ys: [0.95, 1.05], xz: 0.1, yaw: fa, yawJ: 0.35, follow: 0.85, tilt: 0.06, sink: 0.12 + rng() * 0.12, tint, grow: [0.3, 1.6] }, px2, ps2, rng);
    }
    putFloor(ctx, fs, st, { tpl: set.cap, scale: [ws, ws], yaw: rng() * TAU, follow: 0.8, tilt: 0.2, sink: 0.1, tint, grow: [0.3, 1.6] }, x + Math.cos(fa) * (d + 0.8), s + Math.sin(fa) * (d + 0.8), rng);
    putFloor(ctx, fs, st, { tpl: rng.pick(set.broken), scale: [ws, ws], ys: [0.25, 0.45], follow: 0.1, tilt: 0.05, tint }, x, s, rng); // stump
    return;
  }
  const tpl = h > 0.1 || fate < 0.45 ? rng.pick(set.intact) : rng.pick(set.broken);
  let R = rotY(yaw + (rng() - 0.5) * 0.4), sink = 0.15;
  if (fate < 0.45) { // leaning 10-30 deg, away from the path, partly sunk
    R = mul3(rotY(yaw + (rng() - 0.5) * 0.3), rotZ(-sd * (0.17 + rng() * 0.35)));
    sink = 0.3 + rng() * 0.5;
  }
  const gy = groundY(fs, x, s, tpl, R, ws, hs, ws) - sink;
  if (!pointsClear(ctx, placedPoints(tpl, x, gy, s, R, ws, hs, ws, 120), 0.4)) return;
  const c = tint(rng);
  if (!st.add(tpl, x, gy, -(s - ctx.s0), R, ws, hs, ws, c[0], c[1], c[2], rng() * 1.6)) return;
  st.last.g = 1;
  fs.occupy(x, s, 0.7 * ws, 0);
  if (h < 0.1 && rng() < 0.5) putFloor(ctx, fs, mid, sp.drum, x + sd * (1.5 + rng() * 2), s + (rng() - 0.5) * 3, rng);
}

// a seven-headed naga rearing at the end of a balustrade: neck, hood fan facing the approach, heads on its rim
function nagaHead(B, end, nxt) {
  let nx = nxt[0] - end[0], nz = nxt[2] - end[2];
  const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
  const fx = -nx, fz = -nz, lx = fz, lz = -fx, col = B.tone(B.trim, 0.05); // (lat, up, f) is right-handed
  const top = [end[0] + fx * 0.25, end[1] + 1.25, end[2] + fz * 0.25];
  B.tube([[end[0] - fx * 0.3, end[1], end[2] - fz * 0.3], [end[0], end[1] + 0.35, end[2]], [top[0], top[1], top[2]]], [0.25, 0.24, 0.21], 7, col, false);
  const rad = 1.05, c = [top[0] + fx * 0.05, top[1] + 0.45, top[2] + fz * 0.05];
  const R = [lx, 0, fx, 0, 1, 0, lz, 0, fz];
  const fan = [];
  for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + Math.PI * k / 8; fan.push([Math.sin(a) * rad, Math.cos(a) * rad * 0.95]); }
  B.prism(fan, 0.2, c[0], c[1], c[2], R, col);
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI * 0.42 + Math.PI * 0.84 * k / 6, u = Math.sin(a) * rad * 0.95, v = Math.cos(a) * rad * 0.9;
    const p = [c[0] + lx * u + fx * 0.05, c[1] + v, c[2] + lz * u + fz * 0.05];
    const o = [Math.sin(a) * 0.12, Math.cos(a) * 0.12];
    B.tube([p, [p[0] + fx * 0.42 + lx * o[0], p[1] + o[1] + 0.04, p[2] + fz * 0.42 + lz * o[0]]], [0.13, 0.1], 6, col, true);
  }
  B.cap(c[0], c[1] - 0.6, c[2], c[0], c[1] + 0.4, c[2], rad + 0.15);
}

// Khmer causeway: naga serpents along both sides of the street, their bodies on short posts, rearing up in
// a fan of seven hooded heads at each end of a run
function nagaRails(ctx, fs, st, P, items) {
  const S = P.S;
  for (const sd of [-1, 1]) {
    const x0 = ctx.pathX(ctx.s0), site = new Site(fs, x0, ctx.s0, 0);
    const B = new Bld(site, P.seed + sd * 31 + Math.floor(ctx.s0), S, { tier: ctx.tier, decay: P.decay * 0.6, grow: P.grow, silt: P.silt });
    const off = P.streetHalf + 0.9, runs = [];
    let cur = [];
    for (let s = ctx.s0; s <= ctx.s1; s += 2) {
      const x = ctx.pathX(s) + sd * off, ok = ctx.weightOf(s, 'ruins') > 0.45 && !blocked(items, x, s, 1.2);
      const L = slice(P, ctx, Math.floor((s - P.seg.start) / SL));
      const brk = !ok || (L && L.plaza && Math.abs(s - L.plaza.s) < L.plaza.half) || noise1(s / 23 + sd * 5, 911) < -0.35 + P.decay * 0.3;
      if (brk) { if (cur.length > 3) runs.push(cur); cur = []; continue; }
      cur.push([x - x0, s]);
    }
    if (cur.length > 3) runs.push(cur);
    for (const run of runs) {
      const pts = run.map(([lx, s]) => [lx, site.fl(lx, -(s - ctx.s0)) + 1.0, -(s - ctx.s0)]);
      B.tube(pts, pts.map(() => 0.24), B.lo ? 6 : 8, B.tone(B.trim, 0.05), true);
      for (let i = 0; i < pts.length; i += 1) { const p = pts[i]; B.pier(0.4, 0.4, p[0], p[2], p[1] - 0.15, null, B.tone(B.trim, 0.05), 0.02, 0.02); }
      for (let i = 0; i + 4 < pts.length; i += 4) B.cap(pts[i][0], pts[i][1] - 0.4, pts[i][2], pts[i + 4][0], pts[i + 4][1] - 0.4, pts[i + 4][2], 0.6);
      if (run[0][1] > ctx.s0 + 1) nagaHead(B, pts[0], pts[1]); // the serpent rears up where its run begins
    }
    if (!B.b.vc) { B.release(); continue; }
    const tpl = B.finish('Naga balustrade', 'The many-headed naga serpents along Khmer causeways form a rainbow bridge between the world of humans and the gods.', { support: false });
    if (st.add(tpl, x0, site.y0, 0, site.R, 1, 1, 1, 1, 1, 1, 1)) st.last.g = 1;
  }
}
