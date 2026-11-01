// Feature templates shared by several biomes: natural rock arches (swim-throughs), overhanging ledges,
// retracting tube worms, treasure, ship's bells, bottles, shipping containers, stalked kelp.
import { Builder, T, TAU, vn3, fbm3, sat, sstep, lerp, rotX, rotY, rotZ, mul3 } from './core.js';
import { rockInto, stoneInto } from './shapes.js';
import { mulberry32 } from '../noise.js';

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ---------- natural rock arch spanning the flight path ----------
// Origin = centre of the opening at camera-path height; legs reach `depth` below it into the ground.
// Inner clearance from the origin is >= `clear` everywhere (checked against the actual vertices).
export function rockArch(seed, { clear = 4.6, legR = 2.1, topR = 1.3, depth = 12, col = [0.92, 0.88, 0.8], growth = 1.0 } = {}) {
  const rng = mulberry32(seed * 7717 + 3);
  const amp = 0.3; // rock relief relative to local radius
  const A = clear + legR * (1 + amp) + 0.3 + rng() * 1.6, B = clear + topR * (1 + amp) + 0.2 + rng() * 1.2;
  const b = new Builder(), pts = [], radii = [], N = 26;
  const lean = (rng() - 0.5) * 0.6, wob = rng() * 10;
  for (let k = 0; k <= 5; k++) { const t = k / 5; pts.push([-A - (1 - t) * 0.8, -depth * (1 - t), lean * (1 - t)]); radii.push(legR * (1.35 - 0.35 * t)); }
  for (let k = 1; k < N; k++) {
    const a = Math.PI - (k / N) * Math.PI;
    pts.push([A * Math.cos(a), B * Math.sin(a), 0.35 * Math.sin(a * 3 + wob)]);
    radii.push(lerp(legR, topR, Math.pow(Math.sin(a), 0.8)));
  }
  for (let k = 0; k <= 5; k++) { const t = k / 5; pts.push([A + t * 0.8, -depth * t, -lean * t]); radii.push(legR * (1 + 0.35 * t)); }
  const key = 6.05 + rng() * 0.9, v0 = b.vc;
  b.tube(pts, radii, 14, (v, a, x, y, z, o) => { o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = growth; o[7] = key; });
  // rocky relief: displace along the normal with fbm scaled by the local radius
  for (let i = v0; i < b.vc; i++) {
    const x = b.P[i * 3], y = b.P[i * 3 + 1], z = b.P[i * 3 + 2];
    const r = lerp(topR, legR, sat(1 - y / B));
    const d = r * amp * fbm3(x * 0.45 + seed, y * 0.45, z * 0.45, 3, seed) + 0.25 * vn3(x * 1.7, y * 1.7, z * 1.7, seed + 2);
    b.P[i * 3] += b.N[i * 3] * d; b.P[i * 3 + 1] += b.N[i * 3 + 1] * d; b.P[i * 3 + 2] += b.N[i * 3 + 2] * d;
  }
  b.smooth(v0, 0);
  b.paint(v0, (i, x, y, z, nx, ny, nz, o) => {
    const ao = 0.55 + 0.45 * sstep(-0.5, 0.8, ny) * sstep(-depth * 0.4, 0, y);
    const v = 0.85 + 0.25 * vn3(x * 0.8, y * 0.8, z * 0.8, seed + 5);
    o[0] = col[0] * ao * v; o[1] = col[1] * ao * v; o[2] = col[2] * ao * v; o[3] = growth * sstep(-0.2, 0.7, ny); o[4] = key;
  });
  b.obs = [];
  for (let i = 0; i + 1 < pts.length; i += 2) { const p = pts[i], q = pts[Math.min(pts.length - 1, i + 2)]; b.obs.push([p[0], p[1], p[2], q[0], q[1], q[2], radii[i] * 1.1]); }
  b.label = 'Natural rock arch'; b.fact = 'Arches form where waves and boring animals hollow out a weak layer beneath harder rock.';
  b.support = true;
  const t = b.build();
  t.arch = { A, B, clear, depth };
  return t;
}

// ---------- overhanging rock ledge (creatures shelter underneath) ----------
// An undercut outcrop: a squat base, a back mass and a thick cap stratum that overlaps the base's top
// and juts out toward +x (never a thin slab balanced on a ball). t.ledge = { x, y, z } is the shady
// mouth under the lip (template space).
export function rockLedge(seed) {
  const rng = mulberry32(seed * 911 + 7), b = new Builder(), col = [0.9, 0.86, 0.8];
  const H = 2.4 + rng() * 1.8, W = 2.8 + rng() * 1.4, D = 2.6 + rng() * 1.6, lipY = H * (0.55 + rng() * 0.12), lip = 1.3 + rng() * 1.2;
  rockInto(b, seed * 3 + 1, { detail: 4, sx: W / 2, sy: lipY / 1.25, sz: D / 2, rough: 0.38, flat: 0.3, growth: 0.9, col });
  const v1 = b.vc;
  rockInto(b, seed * 3 + 3, { detail: 3, sx: W * 0.42, sy: H * 0.62, sz: D * 0.4, rough: 0.4, flat: 0.25, growth: 0.9, col });
  b.xform(v1, rotY(rng() * TAU), -W * 0.3, 0, (rng() - 0.5) * D * 0.4);
  const v2 = b.vc, capT = 0.65 + rng() * 0.3;
  rockInto(b, seed * 3 + 2, { detail: 4, sx: (W + lip) / 2 * 1.05, sy: capT, sz: D / 2 * 1.08, rough: 0.36, flat: 0.3, growth: 1.0, col });
  b.xform(v2, rotZ(-0.05 - rng() * 0.06), lip * 0.45, lipY - capT * 0.45, 0);
  const key = 6.05 + rng() * 0.9;
  b.paint(0, (i, x, y, z, nx, ny, nz, o) => {
    const under = y < lipY + 0.1 && x > W * 0.25 ? 0.5 + 0.5 * sat((W * 0.25 + 0.6 - x) / 0.6) : 1; // shaded mouth
    o[0] *= under; o[1] *= under; o[2] *= under; o[4] = key;
  });
  b.label = 'Rock overhang'; b.fact = 'Overhangs are prime real estate: lobsters, moray eels and sweepers shelter in the shade.';
  b.support = true;
  b.obs = [[0, H * 0.3, 0, 0, Math.max(H * 0.3, lipY - 0.3), 0, Math.max(W, D) * 0.5], [-W * 0.3, H * 0.35, 0, -W * 0.3, H * 0.6, 0, Math.max(W, D) * 0.42], [W * 0.1, lipY + capT * 0.3, 0, W * 0.5 + lip, lipY + capT * 0.2, 0, capT + 0.3]];
  const t = b.build();
  t.ledge = { x: W * 0.5 + lip * 0.6, y: lipY * 0.45, z: 0 };
  return t;
}

// ---------- christmas-tree worms: pairs of spiral whorls that retract (sway style 5) ----------
export function xmasWorms(seed) {
  const b = new Builder(), rng = mulberry32(seed * 23 + 5), n = 2 + Math.floor(rng() * 5);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, rr = 0.03 + rng() * 0.12, cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, H = 0.035 + rng() * 0.03;
    for (const sd of [-1, 1]) {
      const v0 = b.vc;
      b.lathe(8, 6, (v) => [H * 0.42 * (1 - v) * (0.55 + 0.45 * Math.abs(Math.sin(v * Math.PI * 4.5))) + 0.002, v * H], null, (v, an, x, y, z, o) => {
        const c = 0.75 + 0.35 * Math.abs(Math.sin(v * Math.PI * 4.5)); o[3] = o[4] = o[5] = c; o[6] = H * 1.1 + 0.01; o[7] = 5;
      });
      b.xform(v0, rotZ(sd * 0.12), cx + sd * H * 0.32, 0, cz);
    }
  }
  b.label = 'Christmas tree worms'; b.fact = 'Their "trees" are feathery gills; they vanish into their tubes in a blink when a shadow passes.';
  return b.build();
}

// ---------- feather-duster worms: parchment tube + banded fan crown that retracts ----------
export function featherDusters(seed) {
  const b = new Builder(), rng = mulberry32(seed * 29 + 11), n = 1 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, rr = k ? 0.05 + rng() * 0.12 : 0, cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, H = 0.08 + rng() * 0.12, R = 0.045 + rng() * 0.035;
    const la = [(rng() - 0.5) * 0.2, (rng() - 0.5) * 0.2];
    const top = [cx + la[0] * H, H, cz + la[1] * H];
    b.tube([[cx, 0, cz], [cx + la[0] * H * 0.5, H * 0.5, cz + la[1] * H * 0.5], top], [0.011, 0.01, 0.009], 5, (v, an, x, y, z, o) => {
      const c = 0.6 + 0.3 * v; o[3] = 0.85 * c; o[4] = 0.78 * c; o[5] = 0.62 * c; o[6] = 0.01 * v; o[7] = 0;
    });
    const m = 20 + Math.floor(rng() * 10), dep = H + R * 0.7 + 0.01;
    for (let i = 0; i < m; i++) {
      const th = (i / m) * TAU + rng() * 0.08, d = norm([Math.cos(th) * 0.85, 0.75, Math.sin(th) * 0.85]);
      const side = [-Math.sin(th), 0, Math.cos(th)], w = 0.006;
      const v0 = b.vc;
      for (let j = 0; j <= 3; j++) {
        const t = j / 3, p = [top[0] + d[0] * R * t, top[1] + d[1] * R * t - 0.15 * R * t * t, top[2] + d[2] * R * t];
        const band = Math.sin(t * 14) > 0 ? 1.1 : 0.55;
        b.v(p[0] - side[0] * w, p[1], p[2] - side[2] * w, 0, 1, 0, band, band, band, dep, 5);
        b.v(p[0] + side[0] * w, p[1], p[2] + side[2] * w, 0, 1, 0, band, band, band, dep, 5);
      }
      for (let j = 0; j < 3; j++) { const q = v0 + j * 2; b.t(q, q + 2, q + 1); b.t(q + 1, q + 2, q + 3); }
    }
  }
  b.label = 'Feather duster worms'; b.fact = 'The plume is both gill and fishing net, and it snaps shut faster than you can blink.';
  return b.build();
}

// ---------- treasure chest spilling gold (static mode 7 glints in caustics) ----------
export function treasureChest(seed) {
  const b = new Builder(), rng = mulberry32(seed * 53 + 1);
  const wood = [0.36, 0.26, 0.16], iron = [0.12, 0.1, 0.09], gold = [1.0, 0.76, 0.3];
  const L = 0.85, Dp = 0.5, Hb = 0.42;
  // body: planks with dark joins
  for (let k = 0; k < 4; k++) b.box(L, Hb / 4 - 0.008, Dp, null, 0, (k + 0.5) * Hb / 4, 0, wood.map((c) => c * (0.85 + 0.25 * rng())), [0.6, 0]);
  for (const sx of [-1, 1]) b.box(0.05, Hb + 0.02, Dp + 0.02, null, sx * (L / 2 - 0.08), Hb / 2, 0, iron, [0.2, 4]);
  // lid: half cylinder, hinged open at the back
  const lv = b.vc;
  b.grid(8, 1, (u, v, i, j, o) => {
    const a = u * Math.PI; o[0] = (v - 0.5) * L; o[1] = Math.sin(a) * Dp * 0.5; o[2] = Math.cos(a) * Dp * 0.5;
    o[3] = wood[0]; o[4] = wood[1]; o[5] = wood[2]; o[6] = 0.6; o[7] = 0;
  }, { flip: false });
  b.grid(8, 1, (u, v, i, j, o) => {
    const a = u * Math.PI; o[0] = (v - 0.5) * L; o[1] = Math.sin(a) * Dp * 0.47; o[2] = Math.cos(a) * Dp * 0.47;
    o[3] = wood[0] * 0.5; o[4] = wood[1] * 0.5; o[5] = wood[2] * 0.5;
  }, { flip: true });
  const open = 1.9 + rng() * 0.5;
  b.xform(lv, rotX(-open), 0, Hb, -Dp * 0.5);
  // gold heaped inside (the spill on the sand is a separate draped patch, T.coinSpill)
  for (let k = 0; k < 16; k++) coinInto(b, (rng() - 0.5) * (L - 0.15), Hb - 0.04 + rng() * 0.06, (rng() - 0.5) * (Dp - 0.12), (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6, gold);
  b.label = 'Treasure chest'; b.fact = 'Spanish "pieces of eight" were the first global currency, minted from New World silver.';
  b.band = 0.03; // the bottom planks
  const t = b.build();
  t.front = Dp * 0.5; // the spill starts at the front face (+z)
  return t;
}
function coinInto(b, x, y, z, tx, tz, gold) {
  const v0 = b.vc;
  b.lathe(7, 4, (v) => [v < 0.25 ? 0.03 * v * 4 : v < 0.75 ? 0.03 : 0.03 * (1 - v) * 4, v < 0.25 ? 0 : v < 0.75 ? (v - 0.25) * 0.012 : 0.006], null,
    (v, a, px, py, pz, o) => { o[3] = gold[0]; o[4] = gold[1]; o[5] = gold[2]; o[7] = 7; });
  b.xform(v0, mul3(rotX(tx), rotZ(tz)), x, y, z);
}
// coins and a few gems spilled across the sand: a draped patch (every coin lies on the real floor)
export function coinSpill(seed) {
  const b = new Builder(), rng = mulberry32(seed * 57 + 3), gold = [1.0, 0.76, 0.3];
  for (let k = 0; k < 34; k++) {
    const r = 0.05 + Math.pow(rng(), 0.7) * 0.75, a = (rng() - 0.5) * 2.2;
    coinInto(b, Math.sin(a) * r * 1.1, 0, Math.cos(a) * r * 0.8, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08, gold);
  }
  for (let k = 0; k < 4; k++) { // a few gems
    const v0 = b.vc, c = [[0.1, 0.8, 0.3], [0.85, 0.08, 0.1], [0.15, 0.3, 0.95], [0.9, 0.85, 0.95]][k];
    b.blob(0, (x, y, z, o) => { o[0] = x * 0.03; o[1] = Math.max(-0.3, y) * 0.025 + 0.0075; o[2] = z * 0.03; o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[7] = 7; });
    b.xform(v0, [1, 0, 0, 0, 1, 0, 0, 0, 1], (rng() - 0.5) * 0.6, 0, 0.1 + rng() * 0.4);
  }
  b.label = 'Spilled gold coins'; b.fact = 'Gold does not corrode, so coins from wrecks centuries old can still shine.';
  b.drape = true; b.dLift = 0.011; // lie on the sand, not in it
  return b.build();
}

// ---------- ship's bell (bronze with verdigris) ----------
export function shipBell(seed) {
  const b = new Builder(), rng = mulberry32(seed * 61 + 9), col = [0.32, 0.5, 0.4];
  b.lathe(14, 8, (v) => [0.12 + 0.13 * Math.pow(v, 2.2) + (v > 0.93 ? 0.02 : 0), 0.42 - v * 0.42], null, (v, a, x, y, z, o) => {
    const p = 0.75 + 0.35 * Math.sin(a * 3 + v * 9); o[3] = col[0] * p; o[4] = col[1] * p; o[5] = col[2] * p; o[6] = 0.4; o[7] = 2;
  }, { flip: true });
  b.lathe(14, 1, (v) => [0.255 - v * 0.05, 0.0 + v * 0.03], null, (v, a, x, y, z, o) => { o[3] = 0.1; o[4] = 0.12; o[5] = 0.1; });
  b.tube([[-0.05, 0.42, 0], [0, 0.5, 0], [0.05, 0.42, 0]], [0.02, 0.022, 0.02], 5, (v, a, x, y, z, o) => { o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[7] = 2; });
  // lying on its side on the sand
  b.xform(0, mul3(rotZ(Math.PI / 2 - 0.15), rotY(rng())), 0.25, 0.22, 0);
  b.label = "Ship's bell"; b.fact = "A ship's bell is cast with her name: often the one find that identifies a wreck.";
  return b.build();
}

// ---------- message in a bottle, half buried ----------
export function bottle(seed) {
  const b = new Builder(), glass = [0.16, 0.38, 0.22];
  b.lathe(10, 8, (v) => {
    if (v < 0.6) return [0.045, v * 0.32];
    if (v < 0.8) return [0.045 - (v - 0.6) * 0.15, v * 0.32];
    return [0.016, v * 0.32];
  }, null, (v, a, x, y, z, o) => { o[3] = glass[0]; o[4] = glass[1]; o[5] = glass[2]; o[7] = 5; o[6] = 0.6; });
  b.lathe(6, 1, (v) => [0.014, 0.32 + v * 0.025], null, (v, a, x, y, z, o) => { o[3] = 0.55; o[4] = 0.42; o[5] = 0.28; });
  b.lathe(6, 1, (v) => [0.03, 0.04 + v * 0.14], null, (v, a, x, y, z, o) => { o[3] = 0.9; o[4] = 0.85; o[5] = 0.7; });
  b.xform(0, rotZ(Math.PI / 2 - 0.25), 0.16, 0.0, 0);
  b.label = 'Message in a bottle'; b.fact = 'The oldest known one was found in 2018, 132 years after it was thrown overboard.';
  return b.build();
}

// ---------- shipping container: corrugated steel box, doors, faded paint, rust ----------
export function container(seed, color) {
  const b = new Builder(), rng = mulberry32(seed * 67 + 13), L = rng() < 0.6 ? 6.1 : 12.2, W = 2.44, H = 2.6;
  const col = color || [[0.55, 0.12, 0.08], [0.1, 0.25, 0.45], [0.12, 0.35, 0.2], [0.7, 0.4, 0.08], [0.45, 0.45, 0.45]][seed % 5];
  for (const sd of [-1, 1]) b.grid(Math.round(L * 4), 2, (u, v, i, j, o) => {
    o[0] = (u - 0.5) * L; o[1] = v * H; o[2] = sd * (W / 2 + 0.03 * Math.abs(Math.sin(u * L * 12.5)));
    o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0.6; o[7] = 4;
  }, { flip: sd > 0 });
  b.box(L + 0.06, 0.08, W + 0.1, null, 0, H, 0, col, [0.9, 4]); // roof rail lip: a stacked box always lands on it
  b.box(0.08, H, W, null, -L / 2, H / 2, 0, col.map((c) => c * 0.8), [0.6, 4]);
  b.box(0.08, H, W, null, L / 2, H / 2, 0, col.map((c) => c * 0.75), [0.6, 4]);
  for (const sd of [-1, 1]) b.box(0.1, H - 0.2, 0.05, null, L / 2 + 0.05, H / 2, sd * 0.25, [0.15, 0.13, 0.12], [0.3, 4]);
  b.label = 'Shipping container'; b.fact = 'Hundreds of containers are lost at sea each year; on the seafloor sponges and anemones move in.';
  b.support = true;
  return b.build();
}

// ---------- stalked kelp / sea palm: woody stipe with a crown of drooping blades (sway style 1) ----------
export function seaPalm(seed) {
  const b = new Builder(), rng = mulberry32(seed * 71 + 5), H = 0.8 + rng() * 1.2, lean = [(rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3];
  const top = [lean[0] * H, H, lean[1] * H], sw = (y) => 0.25 * Math.pow(sat(y / H), 1.4) * H;
  b.tube([[0, 0, 0], [lean[0] * H * 0.5 + 0.03, H * 0.5, lean[1] * H * 0.5], top], [0.035, 0.03, 0.025], 5, (v, a, x, y, z, o) => {
    o[3] = 0.25; o[4] = 0.18; o[5] = 0.07; o[6] = sw(y); o[7] = 1;
  });
  const n = 10 + Math.floor(rng() * 10);
  for (let k = 0; k < n; k++) {
    const az = (k / n) * TAU + rng() * 0.3, L = 0.35 + rng() * 0.45, W = 0.035 + rng() * 0.03;
    let d = norm([Math.cos(az), 0.4 + rng() * 0.4, Math.sin(az)]), q = top.slice();
    const side = [-Math.sin(az), 0, Math.cos(az)], v0 = b.vc;
    for (let j = 0; j <= 3; j++) {
      const t = j / 3, w = W * Math.sin(Math.min(1, t * 0.9 + 0.1) * Math.PI) + 0.004, c = 0.8 + 0.35 * t;
      b.v(q[0] - side[0] * w, q[1], q[2] - side[2] * w, 0, 1, 0, 0.55 * c, 0.42 * c, 0.12 * c, sw(H) + 0.1 * t, 1);
      b.v(q[0] + side[0] * w, q[1], q[2] + side[2] * w, 0, 1, 0, 0.55 * c, 0.42 * c, 0.12 * c, sw(H) + 0.1 * t, 1);
      d = norm([d[0], d[1] - 0.45, d[2]]);
      q = [q[0] + d[0] * L / 3, q[1] + d[1] * L / 3, q[2] + d[2] * L / 3];
    }
    for (let j = 0; j < 3; j++) { const q2 = v0 + j * 2; b.t(q2, q2 + 2, q2 + 1); b.t(q2 + 1, q2 + 2, q2 + 3); }
  }
  b.label = 'Stalked kelp'; b.fact = 'Stalked kelp stands upright on a woody stipe like a tiny palm tree in the understory.';
  return b.build();
}

export function initFeatures() {
  T.arch = [1, 2, 3, 4, 5, 6].map((s) => rockArch(s, { legR: 1.8 + (s % 3) * 0.3, topR: 1.1 + (s % 2) * 0.35 }));
  T.archSmall = [11, 12, 13].map((s) => rockArch(s, { clear: 1.4, legR: 0.8, topR: 0.55, depth: 4 }));
  T.ledge = [1, 2, 3, 4, 5].map(rockLedge);
  T.xmas = [1, 2, 3, 4, 5, 6].map(xmasWorms);
  T.duster = [1, 2, 3, 4, 5].map(featherDusters);
  T.chest = [1, 2, 3].map(treasureChest);
  T.coinSpill = [1, 2, 3].map(coinSpill);
  T.bell = [1, 2].map(shipBell);
  T.bottle = [1].map(bottle);
  T.container = [1, 2, 3, 4, 5, 6].map((s) => container(s));
  T.seaPalm = [1, 2, 3, 4, 5, 6, 7, 8].map(seaPalm);
}
