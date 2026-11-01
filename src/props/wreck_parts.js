// Ship parts for the wrecks, built in the ship frame (x starboard, y up, bow toward -z): deckhouses with
// window rows and missing walls, funnels with company bands, masts with tops and yards, standing rigging,
// derrick posts, cowl ventilators, winches, davits, bollards, propellers, rudders, anchors and chain, guns
// (muzzle-loaders, enclosed mounts, AA tubs, torpedo tubes), paddle wheels, tyres. Thin parts register their
// vertex range in b.skipObs (no obstacle cover) and long ones an explicit capsule in b.obsX.
import { TAU, rotX, rotY, rotZ, mul3 } from './core.js';
import { cyl, pipe, disc, ring, beam, obox, sagLine, norm, sub, cross, add, scl, h01 } from './wreck_geo.js';

export const WIN = [0.025, 0.03, 0.035]; // window / opening darkness
const thin = (b, v0) => { (b.skipObs || (b.skipObs = [])).push([v0, b.vc]); };
const capX = (b, a, e, r) => { (b.obsX || (b.obsX = [])).push([a[0], a[1], a[2], e[0], e[1], e[2], r]); };

// ---------- deckhouse: box walls, window rows, roof with overhang; damage drops walls / tilts the roof ----------
// o: { x, y, z (base centre), w (across), h, l (along z), col, roof, f, win: { rows, size, every }, front: 'flat'|'round',
//      missing (prob per wall), collapse (roof falls in), seed, wt (wall thickness) }
export function house(b, o) {
  const { x = 0, y, z, w, h, l, col, f } = o, wt = o.wt ?? 0.14, sd = o.seed | 0, rc = o.roof || col;
  const v0 = b.vc;
  const miss = (k) => h01(k, 1, 3, sd) < (o.missing ?? 0);
  const win = o.win || { rows: 1, size: [0.55, 0.5], every: 1.3 };
  // walls: front (-z), back (+z), port, starboard
  const walls = [
    { c: [x, y + h / 2, z - l / 2 + wt / 2], d: [w, h, wt], n: [0, 0, -1], span: w },
    { c: [x, y + h / 2, z + l / 2 - wt / 2], d: [w, h, wt], n: [0, 0, 1], span: w },
    { c: [x - w / 2 + wt / 2, y + h / 2, z], d: [wt, h, l], n: [-1, 0, 0], span: l },
    { c: [x + w / 2 - wt / 2, y + h / 2, z], d: [wt, h, l], n: [1, 0, 0], span: l },
  ];
  walls.forEach((wl, k) => {
    if (miss(k)) { // only a ragged lower part of the wall is left
      const hk = h * (0.15 + 0.35 * h01(k, 2, 3, sd));
      b.box(wl.d[0], hk, wl.d[2], null, wl.c[0], y + hk / 2, wl.c[2], col, f);
      return;
    }
    b.box(wl.d[0], wl.d[1], wl.d[2], null, wl.c[0], wl.c[1], wl.c[2], col, f);
    // window rows
    const n = Math.max(1, Math.floor((wl.span - 0.6) / win.every));
    for (let r = 0; r < win.rows; r++) {
      const wy = y + h * (win.rows === 1 ? 0.62 : 0.35 + 0.4 * r / Math.max(1, win.rows - 1));
      for (let q = 0; q < n; q++) {
        if (h01(q, r + k * 7, 5, sd) < (o.blind ?? 0.08)) continue;
        const t = (q + 0.5) / n - 0.5, along = t * (wl.span - 0.6);
        const px = wl.n[0] ? wl.c[0] + wl.n[0] * (wt / 2 + 0.012) : x + along, pz = wl.n[2] ? wl.c[2] + wl.n[2] * (wt / 2 + 0.012) : z + along;
        const sx = wl.n[0] ? 0.02 : win.size[0], sz = wl.n[2] ? 0.02 : win.size[0];
        b.box(sx, win.size[1], sz, null, px, wy, pz, WIN, [0, f[1]]);
      }
    }
  });
  // roof (overhanging), collapsed into the house or missing
  const ov = o.overhang ?? 0.25;
  if (o.collapse) {
    const R = mul3(rotX((h01(9, 1, 1, sd) - 0.5) * 0.7), rotZ((h01(9, 2, 1, sd) - 0.5) * 0.6));
    b.box(w * 0.9, 0.12, l * 0.9, R, x, y + h * (0.3 + 0.3 * h01(9, 3, 1, sd)), z, rc, f);
  } else if (!o.noRoof) {
    b.box(w + ov * 2, 0.14, l + ov * 2, null, x, y + h + 0.07, z, rc, f);
    if (b.attach) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) b.attach.push({ p: [x + sx * w * 0.42, y + h + 0.15, z + sz * l * 0.42], n: [0, 1, 0] });
  }
  if (o.front === 'round') { // rounded bridge front: a half-cylinder of windows
    const fz = z - l / 2, n = 7, v1 = b.vc;
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * (k / n), px = x - Math.cos(a) * w / 2, pz = fz - Math.sin(a) * w * 0.28;
      if (k < n) {
        const a2 = Math.PI * ((k + 1) / n), qx = x - Math.cos(a2) * w / 2, qz = fz - Math.sin(a2) * w * 0.28;
        beam(b, [px, y + h * 0.5, pz], [qx, y + h * 0.5, qz], wt, h, col, f);
        if (h01(k, 4, 6, sd) > 0.15) beam(b, [px + (qx - px) * 0.15, y + h * 0.62, pz + (qz - pz) * 0.15 - 0.05], [px + (qx - px) * 0.85, y + h * 0.62, pz + (qz - pz) * 0.85 - 0.05], 0.03, win.size[1], WIN, [0, f[1]]);
      }
    }
    if (!o.noRoof && !o.collapse) b.box(w + ov * 2, 0.14, w * 0.3 + ov, null, x, y + h + 0.07, fz - w * 0.14, rc, f);
    void v1;
  }
  return v0;
}

// ---------- funnel: elliptical, raked, rim, painted bands; optionally fallen / holed ----------
export function funnel(b, o) {
  const { p, r, h, f } = o, rz = o.rz ?? r * 1.35, rake = o.rake ?? 0.12, sd = o.seed | 0;
  const col = o.col, band = o.band, top = o.top || [0.03, 0.03, 0.03];
  const n = 14, rows = 9, v0 = b.vc, t0 = b.I.length;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, y = t * h, cz = y * Math.tan(rake);
    const c = t > 0.88 ? top : band && t > band[0] && t < band[1] ? band[2] : col;
    const dent = 1 - 0.06 * h01(j, 0, 7, sd);
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU;
      const rr = (j === rows ? 1.06 : 1) * dent;
      b.v(p[0] + Math.cos(a) * r * rr, p[1] + y, p[2] + cz + Math.sin(a) * rz * rr, Math.cos(a), 0, Math.sin(a), c[0], c[1], c[2], f[0], f[1]);
    }
  }
  for (let j = 0; j < rows; j++) for (let k = 0; k < n; k++) {
    if (o.holes && h01(j, k, 8, sd) < o.holes && j > 1 && j < rows - 1) continue;
    const a = v0 + j * (n + 1) + k, c = a + n + 1;
    b.t(a, c, a + 1); b.t(a + 1, c, c + 1);
  }
  b.smooth(v0, t0);
  // inner (dark) so the open top reads as a hole
  const v1 = b.vc, t1 = b.I.length;
  for (let k = v0; k < v1; k++) {
    const dx = b.P[k * 3] - p[0], dz = b.P[k * 3 + 2] - p[2] - (b.P[k * 3 + 1] - p[1]) * Math.tan(rake);
    b.v(b.P[k * 3] - dx * 0.06, b.P[k * 3 + 1], b.P[k * 3 + 2] - dz * 0.06, -b.N[k * 3], 0, -b.N[k * 3 + 2], 0.02, 0.02, 0.02, 0, f[1]);
  }
  for (let k = t0; k < t1; k += 3) b.t(b.I[k] - v0 + v1, b.I[k + 2] - v0 + v1, b.I[k + 1] - v0 + v1);
  if (o.pipe !== false) { const v2 = b.vc; cyl(b, [p[0], p[1] + h * 0.2, p[2] + rz + 0.25], [p[0], p[1] + h * 1.05, p[2] + rz + 0.25 + h * Math.tan(rake)], 0.12, 0.12, 5, [0.14, 0.07, 0.04], f); thin(b, v2); }
  capX(b, [p[0], p[1] + r, p[2]], [p[0], p[1] + h - r * 0.5, p[2] + h * Math.tan(rake)], Math.max(r, rz) * 1.02);
  return v0;
}

// ---------- mast: tapered pole, optional top platform, crosstrees and yards; broken / leaning ----------
// o: { p (foot), h (full height), r, lean: [rx, rz] radians, keep (0..1 standing fraction), col, f, top (y frac), yards: [[yFrac, halfLen]], seed }
export function mast(b, o) {
  const { p, h, r, col, f } = o, keep = o.keep ?? 1, lean = o.lean || [0, 0], sd = o.seed | 0;
  const dir = norm([Math.sin(lean[0]), Math.cos(lean[0]) * Math.cos(lean[1]), Math.sin(lean[1])]);
  const H = h * keep, top = add(p, scl(dir, H));
  const v0 = b.vc;
  cyl(b, p, top, r, r * (1 - 0.35 * keep), 7, col, f, 2);
  if (keep < 1) { // splintered stump end
    const v1 = b.vc;
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + h01(k, 0, 2, sd); cyl(b, top, add(top, [Math.cos(a) * r * 0.5, r * (1.5 + h01(k, 1, 2, sd) * 2), Math.sin(a) * r * 0.5]), r * 0.35, 0.01, 3, col, f); }
    thin(b, v1);
  }
  capX(b, p, top, r * 1.3 + 0.1);
  const pt = (yf) => add(p, scl(dir, h * yf));
  if (o.top && o.top < keep) { // fighting top / crosstrees
    const c = pt(o.top), v1 = b.vc;
    b.box(r * 9, 0.14, r * 7, null, c[0], c[1], c[2], col, f);
    thin(b, v1);
  }
  const yards = [];
  for (const [yf, hl, ang = 0] of o.yards || []) {
    if (yf > keep - 0.02) continue;
    const c = pt(yf), R = rotY(ang), v1 = b.vc;
    const e0 = [c[0] - R[0] * hl, c[1] + (h01(yf * 100, 1, 4, sd) - 0.5) * hl * 0.3, c[2] - R[6] * hl], e1 = [c[0] + R[0] * hl, c[1] - (h01(yf * 100, 2, 4, sd) - 0.5) * hl * 0.3, c[2] + R[6] * hl];
    cyl(b, e0, e1, r * 0.45, r * 0.45, 5, col, f, 3);
    thin(b, v1);
    yards.push([e0, e1]);
  }
  return { top, dir, pt, yards, v0 };
}

// thin line (rope, wire, cable) with sag
export function rope(b, p, q, sag, r, c, f, n = 5) {
  const v0 = b.vc;
  pipe(b, sagLine(p, q, sag, n), r, 3, c, f);
  thin(b, v0);
}

// derrick post (kingpost) with a boom resting at an angle
export function derrick(b, o) {
  const { p, h, col, f } = o, sd = o.seed | 0;
  cyl(b, p, [p[0], p[1] + h, p[2]], 0.26, 0.2, 7, col, f, 2);
  capX(b, p, [p[0], p[1] + h, p[2]], 0.4);
  const v0 = b.vc;
  const a = o.boomAng ?? (h01(1, 1, 1, sd) - 0.5) * 2.5, el = o.boomEl ?? 0.25 + h01(2, 1, 1, sd) * 0.5, L = o.boomLen ?? h * 0.9;
  const foot = [p[0], p[1] + 1.2, p[2]], tip = [foot[0] + Math.sin(a) * Math.cos(el) * L, foot[1] + Math.sin(el) * L, foot[2] + Math.cos(a) * Math.cos(el) * L];
  if (o.boom !== false) cyl(b, foot, tip, 0.14, 0.09, 5, col, f, 3);
  thin(b, v0);
  return tip;
}

// cowl ventilator: vertical trunk + elbow + flared bell mouth facing `ang`
export function cowl(b, p, h, r, ang, col, f) {
  const v0 = b.vc;
  const d = [Math.sin(ang), 0, Math.cos(ang)], pts = [p, [p[0], p[1] + h * 0.75, p[2]]];
  for (let k = 1; k <= 3; k++) { const a = (k / 3) * Math.PI / 2; pts.push([p[0] + d[0] * r * 1.2 * (1 - Math.cos(a)), p[1] + h * 0.75 + r * 1.2 * Math.sin(a), p[2] + d[2] * r * 1.2 * (1 - Math.cos(a))]); }
  pipe(b, pts, r, 7, col, f);
  const m = pts[pts.length - 1], mouth = add(m, scl(d, r * 0.7));
  cyl(b, m, mouth, r, r * 1.55, 7, col, f);
  disc(b, add(m, scl(d, r * 0.3)), d, r * 1.2, 7, WIN, [0, f[1]]);
  return v0;
}

export function bollard(b, p, col, f) { for (const dz of [-0.35, 0.35]) cyl(b, [p[0], p[1], p[2] + dz], [p[0], p[1] + 0.55, p[2] + dz], 0.16, 0.16, 6, col, f, 2); b.box(0.4, 0.12, 1.1, null, p[0], p[1] + 0.06, p[2], col, f); }

export function winch(b, p, col, f) {
  b.box(1.4, 0.6, 1.0, null, p[0], p[1] + 0.3, p[2], col, f);
  cyl(b, [p[0] - 0.9, p[1] + 0.75, p[2]], [p[0] + 0.9, p[1] + 0.75, p[2]], 0.32, 0.32, 8, col, f, 3);
}

// curved lifeboat davit arm (pair)
export function davits(b, p, side, gap, col, f, bent = 0) {
  const v0 = b.vc;
  for (const dz of [-gap / 2, gap / 2]) {
    const pts = [];
    for (let k = 0; k <= 5; k++) { const t = k / 5, a = t * Math.PI * 0.55; pts.push([p[0] + side * (Math.sin(a) * 1.3 + bent * t * t), p[1] + Math.sin(Math.min(1, t * 1.4) * Math.PI / 2) * 2.4 - bent * t * t * 1.5, p[2] + dz]); }
    pipe(b, pts, 0.09, 5, col, f, 1);
  }
  thin(b, v0);
}

// propeller: hub + blades around axis ax (unit), at p; R tip radius; nb blades; bent blades for some
export function propeller(b, p, ax, R, nb, col, f, sd = 0, bent = 0) {
  const v0 = b.vc;
  const hubL = R * 0.55;
  cyl(b, add(p, scl(ax, -hubL * 0.5)), add(p, scl(ax, hubL * 0.5)), R * 0.2, R * 0.12, 9, col, f, 3);
  let u = Math.abs(ax[1]) < 0.9 ? norm([ax[2], 0, -ax[0]]) : norm([0, -ax[2], ax[1]]);
  const w = cross(ax, u);
  for (let k = 0; k < nb; k++) {
    const a0 = (k / nb) * TAU + sd;
    const bk = h01(k, 3, 3, sd) < bent ? 0.6 * h01(k, 4, 3, sd) : 0;
    const vb = b.vc, tb = b.I.length, rows = 5, cols = 4;
    for (const face of [1, -1]) for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const s = 0.18 + 0.82 * (j / rows), chord = R * (0.28 + 0.35 * Math.sin(Math.min(1, j / rows * 1.15) * Math.PI) * (1 - 0.3 * j / rows));
      const c = (i / cols - 0.5) * chord, pitch = 0.75 - 0.35 * (j / rows), skew = 0.25 * (j / rows) * (j / rows);
      const a = a0 + skew + (c / (s * R + 0.01)) * Math.cos(pitch) * 0.6;
      const rr = s * R, ca = Math.cos(a), sa = Math.sin(a);
      const ofs = c * Math.sin(pitch) + face * 0.025 * R * (1 - Math.abs(i / cols - 0.5) * 2) + bk * rr * rr / R;
      b.v(p[0] + (u[0] * ca + w[0] * sa) * rr + ax[0] * ofs, p[1] + (u[1] * ca + w[1] * sa) * rr + ax[1] * ofs, p[2] + (u[2] * ca + w[2] * sa) * rr + ax[2] * ofs, 0, 1, 0, col[0], col[1], col[2], f[0], f[1]);
    }
    const per = (rows + 1) * (cols + 1);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = vb + j * (cols + 1) + i, c2 = a + cols + 1;
      b.t(a, a + 1, c2); b.t(a + 1, c2 + 1, c2);
      const a2 = a + per, d2 = a2 + cols + 1;
      b.t(a2, d2, a2 + 1); b.t(a2 + 1, d2, d2 + 1);
    }
    b.smooth(vb, tb);
  }
  capX(b, add(p, scl(ax, -hubL * 0.5)), add(p, scl(ax, hubL * 0.5)), R * 1.02);
  return v0;
}

// rudder: tapered plate hanging from a stock at p (top), chord c, height h, turned by ang about y
export function rudder(b, p, c, h, ang, col, f, aft = 1) {
  const R = rotY(ang), v0 = b.vc;
  b.box(0.22, h, c, R, p[0] + R[2] * c * 0.5 * aft, p[1] - h / 2, p[2] + R[8] * c * 0.5 * aft, col, f);
  cyl(b, [p[0], p[1] + 0.6, p[2]], [p[0], p[1] - h, p[2]], 0.12, 0.12, 6, col, f);
  return v0;
}

// stockless anchor (steel ships) or admiralty anchor (stocked), shank along -y from the ring at p; R rotation
export function anchor(b, p, Rm, size, kind, col, f) {
  const v0 = b.vc, s = size;
  if (kind === 'stockless') {
    cyl(b, [0, 0, 0], [0, -1.9 * s, 0], 0.11 * s, 0.13 * s, 6, col, f, 3);
    b.box(1.1 * s, 0.32 * s, 0.32 * s, null, 0, -2.0 * s, 0, col, f); // crown
    for (const sd of [-1, 1]) b.box(0.28 * s, 1.0 * s, 0.4 * s, rotZ(sd * 0.55), sd * 0.62 * s, -1.65 * s, 0, col, f); // flukes
    ring(b, [0, 0.12 * s, 0], [0, 0, 1], 0.16 * s, 0.05 * s, 0.1 * s, 7, col, f);
  } else {
    cyl(b, [0, 0, 0], [0, -2.6 * s, 0], 0.09 * s, 0.11 * s, 6, col, f);
    const arm = [];
    for (let k = 0; k <= 6; k++) { const a = -Math.PI * 0.15 - (Math.PI * 0.7) * (k / 6); arm.push([Math.cos(a) * 1.0 * s, -2.6 * s - Math.sin(a) * 0.9 * s - 0.9 * s, 0]); }
    pipe(b, arm, 0.08 * s, 5, col, f, 1);
    for (const sd of [-1, 1]) b.box(0.5 * s, 0.4 * s, 0.07 * s, rotZ(sd * 0.7), sd * 0.95 * s, -2.2 * s, 0, col, f);
    b.box(0.14 * s, 0.14 * s, 2.6 * s, null, 0, -0.35 * s, 0, [0.16, 0.12, 0.08], [f[0], 0]); // wooden stock
    ring(b, [0, 0.12 * s, 0], [1, 0, 0], 0.15 * s, 0.04 * s, 0.08 * s, 7, col, f);
  }
  b.xform(v0, Rm, p[0], p[1], p[2]);
  return v0;
}

// chain of links along a polyline (alternating link planes), link length ll
export function chainAlong(b, pts, ll, col, f) {
  const v0 = b.vc;
  let k = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1], d = sub(c, a), L = Math.hypot(d[0], d[1], d[2]), dn = scl(d, 1 / (L || 1));
    const n = Math.max(1, Math.round(L / (ll * 0.8)));
    for (let q = 0; q < n; q++, k++) {
      const m = add(a, scl(d, (q + 0.5) / n));
      let up = k % 2 ? [0, 1, 0] : cross(dn, [0, 1, 0]);
      if (Math.hypot(up[0], up[1], up[2]) < 0.1) up = [1, 0, 0];
      up = norm(up);
      const side = cross(dn, up);
      // link = two thin bars + rounded ends approximated by a flat ring box
      obox(b, add(m, scl(up, ll * 0.17)), dn, up, side, ll * 0.95, ll * 0.1, ll * 0.1, col, f);
      obox(b, add(m, scl(up, -ll * 0.17)), dn, up, side, ll * 0.95, ll * 0.1, ll * 0.1, col, f);
    }
  }
  thin(b, v0);
  return v0;
}

// muzzle-loading cannon barrel from p pointing along d (unit)
export function cannonBarrel(b, p, d, L, col, f) {
  const v0 = b.vc;
  pipe(b, [add(p, scl(d, -0.12)), p, add(p, scl(d, L * 0.35)), add(p, scl(d, L * 0.36)), add(p, scl(d, L))], [0.13, 0.22, 0.19, 0.2, 0.15], 8, col, f, 1);
  disc(b, add(p, scl(d, L + 0.01)), d, 0.08, 6, WIN, [0, f[1]]);
  return v0;
}
// truck carriage under a cannon
export function carriage(b, p, yaw, col, f) {
  const R = rotY(yaw);
  b.box(0.9, 0.5, 1.4, R, p[0], p[1] + 0.3, p[2], col, f);
  for (const s of [-1, 1]) for (const e of [-1, 1]) {
    const q = [p[0] + R[0] * s * 0.48 + R[2] * e * 0.5, p[1] + 0.18, p[2] + R[6] * s * 0.48 + R[8] * e * 0.5];
    cyl(b, [q[0] - R[0] * 0.06, q[1], q[2] - R[6] * 0.06], [q[0] + R[0] * 0.06, q[1], q[2] + R[6] * 0.06], 0.18, 0.18, 7, col, f, 3);
  }
}

// enclosed gun mount (WWII destroyer 5-inch style): base ring, gunhouse with sloped front, 1 or 2 barrels
export function gunMount(b, p, yaw, s, col, f, twin = false, elev = 0) {
  const R = rotY(yaw), v0 = b.vc;
  cyl(b, [p[0], p[1], p[2]], [p[0], p[1] + 0.5 * s, p[2]], 1.6 * s, 1.6 * s, 12, col, f, 2);
  const g = b.vc;
  b.box(3.0 * s, 2.0 * s, 4.2 * s, null, 0, 1.5 * s, 0.4 * s, col, f);
  b.box(3.0 * s, 1.2 * s, 1.4 * s, rotX(-0.55), 0, 1.25 * s, -1.9 * s, col, f);
  for (const k of twin ? [-0.45, 0.45] : [0]) {
    const e = [k * s, 1.4 * s, -2.4 * s], dir = [0, Math.sin(elev), -Math.cos(elev)];
    cyl(b, e, add(e, scl(dir, 5.2 * s)), 0.17 * s, 0.13 * s, 7, col, f, 2);
  }
  b.xform(g, R, p[0], p[1], p[2]);
  capX(b, [p[0], p[1] + 1.4 * s, p[2]], [p[0] - R[2] * 2.4 * s, p[1] + 1.4 * s, p[2] - R[8] * 2.4 * s], 2.2 * s);
  return v0;
}
// open AA gun tub with twin barrels
export function aaTub(b, p, yaw, col, f) {
  const v0 = b.vc;
  ring(b, [p[0], p[1], p[2]], [0, 1, 0], 1.25, 0.06, 1.0, 12, col, f);
  const R = rotY(yaw), e = [p[0], p[1] + 0.9, p[2]];
  b.box(0.8, 0.6, 0.9, R, e[0], e[1], e[2], col, f);
  for (const k of [-0.22, 0.22]) {
    const q = [e[0] + R[0] * k, e[1] + 0.1, e[2] + R[6] * k], d = [-R[2] * Math.cos(0.5), Math.sin(0.5), -R[8] * Math.cos(0.5)];
    cyl(b, q, add(q, scl(d, 2.0)), 0.06, 0.05, 5, col, f, 2);
  }
  thin(b, v0);
  capX(b, [p[0], p[1] + 0.5, p[2]], [p[0], p[1] + 0.6, p[2]], 1.4);
}
// quintuple torpedo tube mount
export function torpedoTubes(b, p, yaw, col, f) {
  const R = rotY(yaw), v0 = b.vc;
  cyl(b, p, [p[0], p[1] + 0.6, p[2]], 1.0, 1.0, 10, col, f, 2);
  const g = b.vc;
  for (let k = 0; k < 5; k++) cyl(b, [(k - 2) * 0.62, 0.95, 3.2], [(k - 2) * 0.62, 0.95, -3.6], 0.29, 0.29, 8, col, f, 3);
  b.xform(g, R, p[0], p[1], p[2]);
  capX(b, [p[0] + R[2] * 3.2, p[1] + 1, p[2] + R[8] * 3.2], [p[0] - R[2] * 3.6, p[1] + 1, p[2] - R[8] * 3.6], 1.7);
  return v0;
}

// side paddle wheel: rim rings, spokes and floats around axis x at p
export function paddleWheel(b, p, R, wdt, col, f, sd = 0, broken = 0.2) {
  const v0 = b.vc, n = 10;
  for (const dx of [-wdt / 2, wdt / 2]) {
    ring(b, [p[0] + dx, p[1], p[2]], [1, 0, 0], R, 0.07, 0.12, 18, col, f);
    ring(b, [p[0] + dx, p[1], p[2]], [1, 0, 0], R * 0.55, 0.06, 0.1, 14, col, f);
  }
  cyl(b, [p[0] - wdt / 2 - 0.4, p[1], p[2]], [p[0] + wdt / 2 + 0.4, p[1], p[2]], 0.25, 0.25, 8, col, f, 3);
  for (let k = 0; k < n; k++) {
    if (h01(k, 1, 9, sd) < broken) continue;
    const a = (k / n) * TAU + sd, cy = Math.cos(a), sz = Math.sin(a);
    for (const dx of [-wdt / 2, wdt / 2]) cyl(b, [p[0] + dx, p[1], p[2]], [p[0] + dx, p[1] + cy * R, p[2] + sz * R], 0.05, 0.05, 4, col, f);
    const q = [p[0], p[1] + cy * R * 0.88, p[2] + sz * R * 0.88];
    obox(b, q, [1, 0, 0], [0, cy, sz], [0, -sz, cy], wdt * 0.95, R * 0.3, 0.1, [0.2, 0.15, 0.1], [f[0], 0]);
  }
  thin(b, v0);
  capX(b, [p[0] - wdt / 2, p[1], p[2]], [p[0] + wdt / 2, p[1], p[2]], R * 1.02);
}

// car / tug tyre fender: a short torus
export function tyre(b, p, nrm, r, col, f) { ring(b, p, nrm, r, r * 0.38, r * 0.5, 10, col, f); }
export { thin, capX };
