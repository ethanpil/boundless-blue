// Lofted bodies for the wrecks that are not ship hulls: the WWII submarine (Type VII style: knife bow,
// saddle tanks, casing with limber holes, conning tower and "wintergarten" flak platform, deck gun, planes,
// twin screws) and aircraft: single-engine fighters (radial or inline engine, straight or inverted-gull wings),
// twin- and four-engine bombers, floatplanes and flying boats. Bodies are thin shells with holes; wings are
// airfoil lofts; props are bent back from the belly landing or the impact.
import { TAU, lerp, sstep, fbm3, rotX, rotY, rotZ } from './core.js';
import { stoneInto } from './shapes.js';
import { shell, shellG, cyl, pipe, disc, ring, obox, beam, h01, add, scl, sub, norm, cross } from './wreck_geo.js';
import { livery, paintAt } from './wreck_hull.js';
import { propeller, rudder, WIN, thin, capX } from './wreck_parts.js';

// ---------- lofted body: sections along z (nose at z0), wrap-around lattice, holes ----------
// o: { len, z0, t0, t1, nu, nt, sec(t) -> [rx, ryTop, ryBot, yc], vee (0..1 V bottom), xmul(t, c) (beam bulge, c = -cos a),
//      th, hole(t, a) -> bool, Lv, wl, seed, open: {i0, i1}, noInner }
export function* loft(b, o) {
  const nu = o.nu, nt = o.nt, W = nu + 1, P = new Float32Array(W * (nt + 1) * 3), T = [], tmp = [];
  for (let i = 0; i <= nu; i++) T.push(lerp(o.t0, o.t1, i / nu));
  for (let i = 0; i <= nu; i++) {
    const t = T[i], [rx, ryT, ryB, yc] = o.sec(t), z = o.z0 + t * o.len;
    for (let j = 0; j <= nt; j++) {
      const a = (j / nt) * TAU, c = -Math.cos(a), sn = Math.sin(a);
      let x = rx * sn, y;
      if (c >= 0) y = yc + ryT * c;
      else { const ell = yc + ryB * c, v = yc - ryB * Math.pow(Math.max(0, 1 - Math.abs(sn)), 1.0); y = lerp(ell, v, o.vee || 0); }
      if (o.xmul) x *= o.xmul(t, c);
      const k = (j * W + i) * 3; P[k] = x; P[k + 1] = y; P[k + 2] = z;
      tmp[j] = c;
    }
  }
  const hole = new Uint8Array(nu * nt);
  if (o.hole) for (let j = 0; j < nt; j++) for (let i = 0; i < nu; i++) hole[j * nu + i] = o.hole((T[i] + T[i + 1]) / 2, ((j + 0.5) / nt) * TAU) ? 1 : 0;
  const strakes = []; for (let j = 0; j <= nt; j += 2) strakes.push(j); if (strakes[strakes.length - 1] !== nt) strakes.push(nt);
  const yc0 = (t) => o.sec(t)[3];
  yield;
  return yield* shellG(b, {
    nu, nt, P, hole, th: o.th ?? 0.06, strakes, seed: o.seed, noInner: o.noInner, latticeNormals: true,
    butts: (k) => { const out = [0]; for (let i = 3 + (k % 2); i < nu; i += 3) out.push(i); out.push(nu); return out; },
    out: (i, j) => { const k = (j * W + i) * 3; return [P[k], P[k + 1] - yc0(T[i]), 0]; },
    lap: (k) => (o.lap ? (k % 2 ? o.lap : 0) : 0), tear: o.tear ?? 0.12,
    color: (i, j, k, m, out) => { const q = (j * W + i) * 3; paintAt(o.Lv, P[q], P[q + 1] - (o.yOff || 0), P[q + 2], h01(k, m, 3, o.seed), o.wl ?? -99, out); if (o.tone) o.tone(P[q], P[q + 1], P[q + 2], out); },
    inner: (i, j, out) => { out[0] = 0.05; out[1] = 0.045; out[2] = 0.04; out[3] = 0.2; out[4] = o.Lv.mode; },
    edge: (i, j, out) => { out[0] = 0.3; out[1] = 0.3; out[2] = 0.28; out[3] = 0.3; out[4] = o.Lv.mode; },
    open: o.open || {},
  });
}

// ---------- airfoil wing / tailplane / fin ----------
// o: { root (leading edge at the root), sdir (span unit), cdir (chord unit, LE -> TE), span, c0, c1, th (thickness/chord),
//      sweep (m of LE aft at the tip), keep (span fraction left), twist, colTop, colBot, f, gull: [knee, angle] }
const AF = [1, 0.75, 0.5, 0.28, 0.12, 0.03, 0, 0.03, 0.12, 0.28, 0.5, 0.75, 1];
export function wing(b, o) {
  const K = o.K ?? 6, keep = o.keep ?? 1, n = norm(cross(o.cdir, o.sdir)), M = AF.length - 1;
  const st = [];
  for (let k = 0; k <= K; k++) {
    const s = (k / K) * keep, c = lerp(o.c0, o.c1, s);
    let base = add(o.root, scl(o.sdir, s * o.span));
    if (o.gull) { const [kn, ang] = o.gull, d = s < kn ? s * o.span * Math.sin(ang) : kn * o.span * Math.sin(ang) - (s - kn) * o.span * Math.sin(ang) * 0.35; base = add(base, scl(n, d)); }
    base = add(base, scl(o.cdir, o.sweep * s));
    st.push({ base, c, s });
  }
  const W = K + 1, P = new Float32Array(W * (M + 1) * 3);
  for (let k = 0; k <= K; k++) for (let j = 0; j <= M; j++) {
    const x = AF[j], upper = j < M / 2, yt = 5 * o.th * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4) * st[k].c;
    const p = add(add(st[k].base, scl(o.cdir, x * st[k].c)), scl(n, upper ? yt + 0.02 * st[k].c : -yt + 0.02 * st[k].c));
    const q = (j * W + k) * 3; P[q] = p[0]; P[q + 1] = p[1]; P[q + 2] = p[2];
  }
  const hole = new Uint8Array(K * M);
  if (o.holes) for (let j = 0; j < M; j++) for (let k = 1; k < K; k++) hole[j * K + k] = h01(j, k, 7, o.seed | 0) < o.holes ? 1 : 0;
  const strakes = [0, M / 2, M];
  shell(b, {
    nu: K, nt: M, P, hole, th: 0, noInner: true, strakes, seed: o.seed | 0,
    butts: () => { const out = [0]; for (let i = 2; i < K; i += 2) out.push(i); out.push(K); return out; },
    out: (i, j) => (j < M / 2 ? n : scl(n, -1)), tear: 0,
    color: (i, j, k, m, out) => { const c = j < M / 2 ? o.colTop : o.colBot, v = 0.85 + 0.3 * h01(k, m, i, o.seed | 0); out[0] = c[0] * v; out[1] = c[1] * v; out[2] = c[2] * v; out[3] = o.f[0]; out[4] = o.f[1]; },
    inner: () => {}, edge: () => {},
  });
  // tip cap (or the torn end with the spar poking out)
  const last = st[K];
  if (keep >= 0.999) {
    const cc = add(last.base, scl(o.cdir, last.c * 0.4)), v0 = b.vc, s0 = v0 + 1;
    b.v(cc[0], cc[1], cc[2], o.sdir[0], o.sdir[1], o.sdir[2], o.colTop[0], o.colTop[1], o.colTop[2], o.f[0], o.f[1]);
    for (let j = 0; j < M; j++) { const q = (j * W + K) * 3; b.v(P[q], P[q + 1], P[q + 2], o.sdir[0], o.sdir[1], o.sdir[2], o.colTop[0], o.colTop[1], o.colTop[2], o.f[0], o.f[1]); }
    const tri = [];
    for (let j = 0; j < M; j++) tri.push([v0, s0 + j, s0 + ((j + 1) % M)]);
    const a = b.P.slice(v0 * 3, v0 * 3 + 3), p1 = b.P.slice((s0) * 3, s0 * 3 + 3), p2 = b.P.slice((s0 + 1) * 3, (s0 + 1) * 3 + 3);
    const nn = cross(sub(p1, a), sub(p2, a)), flip = nn[0] * o.sdir[0] + nn[1] * o.sdir[1] + nn[2] * o.sdir[2] < 0;
    for (const [x, y, z] of tri) flip ? b.t(x, z, y) : b.t(x, y, z);
  } else {
    const sp = add(last.base, scl(o.cdir, last.c * 0.3));
    cyl(b, sp, add(sp, scl(o.sdir, 0.5 + h01(1, 2, 3, o.seed | 0))), 0.07, 0.05, 4, [0.35, 0.35, 0.33], o.f, 2);
  }
  return st;
}

// radial engine: cowling ring, cylinders behind a dark face, nacelle; prop with blades bent back
function radial(b, p, ax, R, col, f, sd, blades = 3, bent = 1) {
  ring(b, p, scl(ax, -1), R, 0.07, R * 0.9, 16, col, f);
  disc(b, add(p, scl(ax, 0.25)), scl(ax, -1), R * 0.95, 14, [0.08, 0.08, 0.07], f);
  for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, u = norm(cross(ax, [0, 1, 0])), w = cross(ax, u); obox(b, add(add(p, scl(ax, 0.2)), add(scl(u, Math.cos(a) * R * 0.62), scl(w, Math.sin(a) * R * 0.62))), u, w, ax, 0.16, 0.16, 0.25, [0.12, 0.11, 0.1], f); }
  cyl(b, add(p, scl(ax, -0.15)), add(p, scl(ax, -0.5)), R * 0.2, R * 0.15, 8, [0.15, 0.15, 0.14], f, 1);
  propeller(b, add(p, scl(ax, -0.45)), ax, R * 2.0, blades, [0.12, 0.12, 0.11], f, sd, bent);
}
function bubble(b, p, rx, ry, rz, f) {
  const v0 = b.vc;
  b.blob(2, (x, y, z, o) => { o[0] = p[0] + x * rx; o[1] = p[1] + Math.max(-0.05, y) * ry; o[2] = p[2] + z * rz; o[3] = 0.04; o[4] = 0.05; o[5] = 0.06; o[6] = 0; o[7] = 0; });
  for (const k of [-0.5, 0, 0.5]) { const pts = []; for (let q = 0; q <= 6; q++) { const a = q / 6 * Math.PI; pts.push([p[0] + Math.cos(a) * rx * 1.02, p[1] + Math.sin(a) * ry * 1.02 * Math.sqrt(1 - k * k), p[2] + k * rz]); } pipe(b, pts, 0.025, 3, [0.3, 0.3, 0.28], f); }
  return v0;
}

// ---------- WWII submarine ----------
export function submarine(r, o) {
  const len = r.range(52, 67) * (o.hero ? 1 : 0.94), R = r.range(2.5, 3.0), z0 = -len / 2;
  const Lv = livery('steel', r, { top: [0.16, 0.17, 0.18], bottom: [0.12, 0.12, 0.12], rust: r.range(0.35, 0.8) });
  const sec = (t) => {
    if (t < 0.14) { const e = t / 0.14; return [R * (0.08 + 0.92 * Math.pow(e, 0.7)), R * (0.78 + 0.22 * Math.pow(e, 0.5)), R * (0.5 + 0.5 * Math.pow(e, 0.6)), R * (1.05 + 0.15 * (1 - e))]; }
    if (t > 0.72) { const e = (t - 0.72) / 0.28; return [R * (1 - 0.86 * Math.pow(e, 1.4)), R * (1 - 0.62 * Math.pow(e, 1.2)), R * (1 - 0.78 * Math.pow(e, 1.1)), R * (1.05 + 0.25 * e)]; }
    return [R, R, R * 1.03, R * 1.05];
  };
  const bump = (t) => sstep(0.26, 0.34, t) * (1 - sstep(0.62, 0.7, t));
  const imp = { t: r.range(0.45, 0.7), a: r.range(1, 5), k: r() < 0.6 ? 0.6 : 0 };
  return {
    kind: 'submarine', label: 'Type VII U-boat', year: r.int(1940, 1945), H: { L: len, B: R * 2.3, D: R * 2.2 }, Lv, seed: o.seed,
    facts: ['Over 700 Type VII U-boats were built, more than any other submarine class.', 'Limber holes along the casing let water in and out as the U-boat dived and surfaced.', 'A Type VII carried 14 torpedoes and a crew of about 50 in a hull 6 m wide.'],
    cond: o.cond, breakAt: r.range(0.55, 0.7), brokenStates: ['upright', 'list'], partNames: ['bow section', 'stern section'],
    stateMod: (st) => { st.bury = Math.min(st.bury, R * (0.35 + 0.3 * Math.abs(Math.sin(st.roll || 0)))); },
    cover: { cx: 2.6, cy: 2.6, cz: 6, maxN: 24 },
    build: function* (b, rng, st, cutLo, cutHi) {
      const f = [Lv.growth, 4], [cc] = [[0.16, 0.16, 0.17]];
      const inT = (t) => t > cutLo + 0.01 && t < cutHi - 0.01, zt = (t) => z0 + t * len;
      yield* loft(b, {
        len, z0, t0: cutLo, t1: cutHi, nu: Math.max(4, Math.round((cutHi - cutLo) * len / 1.4)), nt: 20, sec, vee: 0.15, Lv, seed: o.seed, th: 0.08, lap: 0.02,
        xmul: (t, c) => 1 + 0.17 * bump(t) * sstep(0.45, -0.5, c),
        hole: (t, a) => { const c = -Math.cos(a); let h = 0.5 + 0.5 * fbm3(t * len / 5, a * 1.3, 3, 2, o.seed); h += 0.3 * c; if (imp.k) h += imp.k * sstep(0.12, 0.02, Math.hypot((t - imp.t) * len / 10, (a - imp.a) / 2)); if (cutLo > 0) h += 0.5 * sstep(0.06, 0, t - cutLo); if (cutHi < 1) h += 0.5 * sstep(0.06, 0, cutHi - t); return h > 0.86; },
        open: { i0: cutLo > 0, i1: cutHi < 1 }, tear: 0.2,
      });
      yield;
      // casing (free-flooding deck) with limber holes; some plating gone
      const top = (t) => { const s = sec(t); return s[3] + s[1]; };
      for (let t = Math.max(0.05, cutLo); t < Math.min(0.9, cutHi); t += 2.2 / len) {
        if (h01(Math.floor(t * 999), 1, 1, o.seed) < 0.18) continue;
        const z = zt(t + 1.1 / len), y = top(t + 1.1 / len) + 0.05, w = Math.min(R * 0.38, sec(t)[0] * 0.55);
        b.box(w * 2, 0.08, 2.2, null, 0, y + 0.55, z, cc, f);
        for (const sx of [-1, 1]) { b.box(0.06, 0.75, 2.2, rotZ(sx * 0.35), sx * (w + 0.1), y + 0.2, z, cc, f); for (const dz of [-0.6, 0, 0.6]) b.box(0.05, 0.12, 0.42, rotZ(sx * 0.35), sx * (w + 0.15), y + 0.12, z + dz, WIN, [0, 4]); }
      }
      // conning tower, periscope standards, flak platform, deck gun
      const tT = 0.36;
      if (inT(tT)) {
        const z = zt(tT), y = top(tT) + 0.6, v0 = b.vc;
        stoneInto(b, { sx: 2.0, sy: 3.8, sz: 6.4, p: 3.2, rough: 0.01, seed: o.seed, detail: 3, col: [0.17, 0.17, 0.18], growth: Lv.growth, mode: 4 });
        b.xform(v0, [1, 0, 0, 0, 1, 0, 0, 0, 1], 0, y + 1.6, z);
        ring(b, [0, y + 3.05, z - 0.6], [0, 1, 0], 1.0, 0.08, 0.6, 12, cc, f);
        const v1 = b.vc;
        for (const [dz, h] of [[0.4, 3.2], [1.1, 4.6]]) { const ang = rng() < 0.4 ? rng.range(-0.6, 0.6) : 0; cyl(b, [0, y + 2.6, z + dz], [Math.sin(ang) * h * 0.4, y + 2.6 + h * Math.cos(ang * 0.4), z + dz + Math.sin(ang) * h * 0.3], 0.16, 0.1, 6, cc, f, 2); }
        thin(b, v1);
        b.box(2.4, 0.12, 3.0, null, 0, y + 2.5, z + 3.8, cc, f); // wintergarten
        const v2 = b.vc;
        for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI; cyl(b, [Math.cos(a) * 1.2, y + 2.5, z + 3.8 + Math.sin(a) * 1.4], [Math.cos(a) * 1.2, y + 3.4, z + 3.8 + Math.sin(a) * 1.4], 0.03, 0.03, 3, cc, f); }
        cyl(b, [-0.15, y + 3.2, z + 4.0], [-0.15, y + 3.6 + 0.6, z + 4.0 - 1.7], 0.05, 0.04, 4, cc, f); cyl(b, [0.15, y + 3.2, z + 4.0], [0.15, y + 3.6 + 0.6, z + 4.0 - 1.7], 0.05, 0.04, 4, cc, f);
        thin(b, v2);
        capX(b, [0, y + 1.5, z - 2.2], [0, y + 1.5, z + 2.2], 1.9);
        b.feats.push({ name: 'Conning tower', fact: 'The bridge on top of the conning tower was the only place on a U-boat with fresh air.', p: [0, y + 3, z] });
      }
      if (inT(0.27) && rng() < 0.7) {
        const z = zt(0.27), y = top(0.27) + 0.65, ang = rng.range(-0.5, 0.5);
        cyl(b, [0, y, z], [0, y + 1.0, z], 0.35, 0.3, 8, cc, f, 2);
        b.box(0.9, 0.6, 1.4, rotY(ang), 0, y + 1.25, z, cc, f);
        cyl(b, [0, y + 1.35, z], [-Math.sin(ang) * 4.2, y + 1.35 + rng.range(-0.3, 0.4), z - Math.cos(ang) * 4.2], 0.11, 0.08, 6, cc, f, 2);
        b.feats.push({ name: '88 mm deck gun', fact: 'U-boats used the deck gun to sink small ships without wasting a torpedo.', p: [0, y + 1.3, z] });
      }
      // bow planes, stern planes, rudders, twin screws
      for (const sx of [-1, 1]) {
        if (inT(0.08)) b.box(2.0, 0.12, 1.2, rotZ(sx * rng.range(-0.3, 0.3)), sx * (sec(0.08)[0] + 0.9), sec(0.08)[3] - 0.6, zt(0.08), cc, f);
        if (inT(0.94)) b.box(2.4, 0.12, 1.5, null, sx * (sec(0.94)[0] + 1.0), sec(0.94)[3], zt(0.94), cc, f);
        if (cutHi >= 1) {
          const y = sec(0.95)[3] - R * 0.15, z = zt(0.985) + 0.5;
          propeller(b, [sx * R * 0.5, y, z], [0, 0, 1], R * 0.42, 3, [0.3, 0.22, 0.1], [Lv.growth * 0.6, 0], rng() * 6, 0.3);
          cyl(b, [sx * R * 0.4, y, zt(0.93)], [sx * R * 0.5, y, z], 0.1, 0.1, 5, cc, f);
          rudder(b, [sx * R * 0.5, y + R * 0.5, z + 0.8], 1.1, R * 1.0, rng.range(-0.5, 0.5), cc, f);
        }
      }
      if (cutHi >= 1) b.feats.push({ name: 'Twin propellers', fact: 'On the surface a U-boat ran on diesels; submerged, on batteries and electric motors.', p: [0, R, zt(0.98)] });
      // growth attachment points along the casing top
      for (let t = Math.max(0.08, cutLo); t < Math.min(0.88, cutHi); t += 3 / len) b.attach.push({ p: [rng.range(-0.6, 0.6), top(t) + 0.95, zt(t)], n: [0, 1, 0] });
    },
  };
}

// ---------- aircraft ----------
const AIRCOL = { olive: [[0.11, 0.12, 0.07], [0.3, 0.31, 0.3]], navy: [[0.06, 0.08, 0.13], [0.33, 0.34, 0.35]], green: [[0.08, 0.12, 0.08], [0.32, 0.34, 0.33]], grey: [[0.27, 0.28, 0.28], [0.36, 0.37, 0.36]], silver: [[0.4, 0.41, 0.4], [0.38, 0.39, 0.38]] };
function airDesign(r, o, kind, label, facts, spec) {
  const pal = AIRCOL[r.pick(spec.paints)], Lv = livery('alu', r, { top: pal[0] });
  Lv.under = pal[1];
  const d = {
    kind, label, year: r.int(1941, 1945), Lv, seed: o.seed, facts, cond: o.cond, air: true,
    H: { L: spec.len, B: spec.R * 2, D: spec.R * 2 }, breakAt: spec.breakAt ?? 0.62, brokenStates: ['upright', 'list'],
    cover: { cx: 2.2, cy: 2.2, cz: 4, maxN: 20 },
    partNames: ['forward fuselage', 'tail section'],
    // aircraft never lie on their side: a dug-in wing at most, or upside down
    stateMod: (st, rng, cond) => {
      if (cond === 'list' || cond === 'side') st.roll = Math.sign(st.roll || 1) * rng.range(0.1, 0.3);
      if (cond === 'capsized') st.bury = Math.min(st.bury, spec.R * 0.9);
    },
  };
  return d;
}
const tone = (Lv) => (x, y, z, o) => { if (y < Lv._yc) { const u = Lv.under; o[0] = (o[0] + u[0]) * 0.5; o[1] = (o[1] + u[1]) * 0.5; o[2] = (o[2] + u[2]) * 0.5; } };

// fighter: radial (Hellcat / Zero / Corsair) or inline (Mustang / Spitfire) engine
export function fighter(r, o) {
  const rad = r() < 0.6, gull = rad && r() < 0.3, len = r.range(8.6, 10.3), R = rad ? r.range(0.68, 0.8) : r.range(0.55, 0.66), span = r.range(10.4, 12.6);
  const label = gull ? 'F4U Corsair fighter' : rad ? r.pick(['F6F Hellcat fighter', 'A6M Zero fighter', 'Fw 190 fighter']) : r.pick(['P-51 Mustang fighter', 'Spitfire fighter', 'P-40 Warhawk fighter']);
  const d = airDesign(r, o, 'fighter', label, ['Hundreds of WWII aircraft lie on reefs and lagoons in the Pacific, many ditched near their carriers.', 'Belly-landed planes bend their propeller blades back as they hit the water.', 'Aluminium corrodes slowly in seawater, so 80-year-old aircraft wrecks are still recognisable.'],
    { len, R, paints: rad ? ['navy', 'green', 'olive', 'grey'] : ['olive', 'silver', 'grey', 'green'], breakAt: 0.64 });
  const z0 = -len / 2;
  const sec = (t) => {
    let k;
    if (t < 0.12) k = rad ? 0.94 + 0.06 * t / 0.12 : Math.pow(Math.sin(Math.PI / 2 * t / 0.16), 0.65) * 0.9 + 0.05;
    else if (t < 0.45) k = 1;
    else k = 1 - 0.8 * Math.pow((t - 0.45) / 0.55, 1.3);
    const rr = R * k, rise = t > 0.5 ? 0.35 * Math.pow((t - 0.5) / 0.5, 2) : 0;
    return [rr * 0.95, rr * 1.08, rr, R + 0.05 + rise];
  };
  d.build = function* (b, rng, st, cutLo, cutHi) {
    const Lv = d.Lv, f = [Lv.growth, 0], top = Lv.top, und = Lv.under;
    Lv._yc = R + 0.05;
    yield* loft(b, { len, z0, t0: cutLo, t1: cutHi, nu: Math.max(3, Math.round((cutHi - cutLo) * len / 0.6)), nt: 12, sec, Lv, seed: o.seed, th: 0.03, tone: tone(Lv),
      hole: (t, a) => h01(Math.floor(t * 30), Math.floor(a * 2), 1, o.seed) < 0.06 || (cutLo > 0 && t < cutLo + 0.04) || (cutHi < 1 && t > cutHi - 0.04), open: { i0: cutLo > 0, i1: cutHi < 1 } });
    const zt = (t) => z0 + t * len, inT = (t) => t >= cutLo && t <= cutHi;
    if (inT(0.02)) {
      if (rad) radial(b, [0, R + 0.05, zt(0.0)], [0, 0, 1], R * 0.92, top, f, rng() * 6, 3, 1);
      else { const p = [0, R + 0.05, zt(0.0)]; cyl(b, add(p, [0, 0, 0.3]), add(p, [0, 0, -0.35]), R * 0.35, 0.05, 8, [0.1, 0.1, 0.1], f, 2); propeller(b, add(p, [0, 0, -0.1]), [0, 0, 1], 1.6, rng() < 0.5 ? 3 : 4, [0.1, 0.1, 0.1], f, rng() * 6, 1); if (rng() < 0.6) b.box(0.8, 0.5, 2.2, null, 0, R * 0.25, zt(0.5), top, f); }
      b.feats.push({ name: rad ? 'Radial engine' : 'Propeller', fact: rad ? 'A radial engine arranges its cylinders in a star around the crankshaft, cooled by the air.' : 'The propeller blades curled back when the aircraft hit the water.', p: [0, R, zt(0.02)] });
    }
    if (inT(0.4)) bubble(b, [0, R * 2 + 0.05, zt(0.42)], R * 0.6, R * 0.75, R * 1.5, f);
    yield;
    if (inT(0.3)) for (const sx of [-1, 1]) {
      const keep = rng() < 0.25 ? rng.range(0.35, 0.75) : 1;
      wing(b, { root: [sx * R * 0.7, R * 0.55, zt(0.24)], sdir: norm([sx, 0.08, 0]), cdir: [0, 0, 1], span: span / 2 - R * 0.7, c0: 2.4, c1: 1.15, th: 0.13, sweep: 0.35, keep, colTop: top, colBot: und, f, seed: o.seed + sx, gull: gull ? [0.33, -0.45] : null, holes: 0.08 });
    }
    if (inT(0.93)) {
      for (const sx of [-1, 1]) wing(b, { root: [sx * 0.25, sec(0.9)[3] + 0.05, zt(0.88)], sdir: [sx, 0.02, 0], cdir: [0, 0, 1], span: 2.0, c0: 1.3, c1: 0.6, th: 0.1, sweep: 0.3, colTop: top, colBot: und, f, seed: o.seed + 9 + sx, K: 3 });
      wing(b, { root: [0, sec(0.88)[3] + 0.2, zt(0.84)], sdir: norm([0, 1, 0.25]), cdir: [0, 0, 1], span: 1.7, c0: 1.6, c1: 0.7, th: 0.1, sweep: 0.5, colTop: top, colBot: top, f, seed: o.seed + 7, K: 3 });
    }
    b.attach.push({ p: [0, R * 2 + 0.1, zt(0.6)], n: [0, 1, 0] }, { p: [span * 0.3, R * 0.65, zt(0.3)], n: [0, 1, 0] }, { p: [-span * 0.3, R * 0.65, zt(0.3)], n: [0, 1, 0] });
  };
  return d;
}

// twin-engine medium bomber (B-25 style) or four-engine heavy bomber (B-17 style)
export function bomber(r, o) {
  const four = r() < 0.4, len = four ? r.range(20.5, 23) : r.range(15, 16.8), R = four ? r.range(1.2, 1.4) : r.range(0.92, 1.1), span = four ? r.range(29, 32) : r.range(19.5, 21);
  const d = airDesign(r, o, 'bomber', four ? 'B-17 Flying Fortress bomber' : r.pick(['B-25 Mitchell bomber', 'B-26 Marauder bomber', 'Ju 88 bomber']),
    four ? ['A B-17 carried a crew of ten and up to 13 machine guns; ditched ones still lie on the seabed in one piece.', 'Bomber crews trained to ditch: the plane could float for a minute or two while they climbed out.']
      : ['Medium bombers like the B-25 skip-bombed ships at mast height over the Pacific.', 'Bomber crews trained to ditch: the plane could float for a minute or two while they climbed out.'],
    { len, R, paints: ['olive', 'silver', 'grey', 'green'], breakAt: 0.6 });
  const z0 = -len / 2;
  const sec = (t) => {
    let k;
    if (t < 0.14) k = 0.3 + 0.7 * Math.pow(Math.sin(Math.PI / 2 * t / 0.14), 0.6);
    else if (t < 0.55) k = 1;
    else k = 1 - 0.78 * Math.pow((t - 0.55) / 0.45, 1.25);
    const rr = R * k, rise = t > 0.6 ? 0.45 * Math.pow((t - 0.6) / 0.4, 2) : 0;
    return [rr * 0.92, rr * 1.06, rr, R + 0.05 + rise];
  };
  d.build = function* (b, rng, st, cutLo, cutHi) {
    const Lv = d.Lv, f = [Lv.growth, 0], top = Lv.top, und = Lv.under;
    Lv._yc = R + 0.05;
    yield* loft(b, { len, z0, t0: cutLo, t1: cutHi, nu: Math.max(3, Math.round((cutHi - cutLo) * len / 0.8)), nt: 14, sec, Lv, seed: o.seed, th: 0.04, tone: tone(Lv),
      hole: (t, a) => h01(Math.floor(t * 40), Math.floor(a * 2.4), 1, o.seed) < 0.1 || (cutLo > 0 && t < cutLo + 0.04) || (cutHi < 1 && t > cutHi - 0.04), open: { i0: cutLo > 0, i1: cutHi < 1 } });
    const zt = (t) => z0 + t * len, inT = (t) => t >= cutLo && t <= cutHi;
    if (inT(0.03)) { bubble(b, [0, R * 1.05, zt(0.045)], R * 0.6, R * 0.55, R * 0.9, f); b.feats.push({ name: 'Glazed nose', fact: "The bombardier lay in the glazed nose with the bomb sight.", p: [0, R, zt(0.04)] }); }
    if (inT(0.2)) bubble(b, [0, R * 2, zt(0.2)], R * 0.55, R * 0.4, R * 0.9, f);
    if (inT(0.35)) bubble(b, [0, R * 2.05, zt(0.36)], R * 0.45, R * 0.45, R * 0.45, f);
    yield;
    if (inT(0.32)) {
      const wy = four ? R * 0.65 : R * 1.6, wz = zt(0.3), engines = four ? [0.22, 0.48] : [0.32];
      for (const sx of [-1, 1]) {
        const keep = rng() < 0.3 ? rng.range(0.3, 0.7) : 1, sp = span / 2 - R * 0.8;
        wing(b, { root: [sx * R * 0.8, wy, wz], sdir: norm([sx, four ? 0.07 : 0.05, 0]), cdir: [0, 0, 1], span: sp, c0: four ? 5.2 : 3.6, c1: four ? 2.2 : 1.7, th: 0.14, sweep: four ? 0.8 : 0.4, keep, colTop: top, colBot: und, f, seed: o.seed + sx, holes: 0.1 });
        for (const ef of engines) {
          if (ef > keep * 0.95) continue;
          const ex = sx * (R * 0.8 + ef * sp), ey = wy + (four ? 0.07 : 0.05) * ef * sp - (four ? 0.1 : 0.35), p = [ex, ey, wz - 0.9];
          cyl(b, add(p, [0, 0, 0.6]), add(p, [0, -0.1, 3.4]), 0.75, 0.35, 10, top, f, 2);
          radial(b, p, [0, 0, 1], four ? 0.72 : 0.75, top, f, rng() * 6, 3, rng() < 0.7 ? 1 : 0.4);
        }
      }
      b.feats.push({ name: 'Engine and propeller', fact: 'Bent propeller blades show the engine was still turning when the bomber hit the water.', p: [R * 0.8 + engines[0] * (span / 2), wy, wz - 1] });
    }
    yield;
    if (inT(0.94)) {
      const ty = sec(0.92)[3] + 0.2, tz = zt(0.88);
      for (const sx of [-1, 1]) wing(b, { root: [sx * 0.3, ty, tz], sdir: [sx, 0.05, 0], cdir: [0, 0, 1], span: four ? 4.8 : 3.0, c0: four ? 3.0 : 2.0, c1: four ? 1.4 : 1.2, th: 0.1, sweep: four ? 0.8 : 0.2, colTop: top, colBot: und, f, seed: o.seed + 11 + sx, K: 3 });
      if (four) wing(b, { root: [0, ty + 0.4, zt(0.74)], sdir: norm([0, 1, 0.55]), cdir: [0, 0, 1], span: 5.0, c0: 5.0, c1: 1.6, th: 0.08, sweep: 1.4, colTop: top, colBot: top, f, seed: o.seed + 13, K: 4 });
      else for (const sx of [-1, 1]) wing(b, { root: [sx * 3.1, ty - 0.9, tz + 0.2], sdir: [0, 1, 0], cdir: [0, 0, 1], span: 2.6, c0: 1.6, c1: 1.2, th: 0.08, sweep: 0.15, colTop: top, colBot: top, f, seed: o.seed + 15 + sx, K: 3 });
    }
    b.attach.push({ p: [0, R * 2 + 0.1, zt(0.5)], n: [0, 1, 0] }, { p: [0, R * 2.1, zt(0.25)], n: [0, 1, 0] });
  };
  return d;
}

// floatplane (Kingfisher style: central float + wingtip floats) or flying boat (PBY Catalina style)
export function seaplane(r, o) {
  const boat = r() < 0.5;
  if (!boat) {
    const d = fighter(r, o), inner = d.build, len = d.H.L, R = d.H.B / 2;
    d.kind = 'seaplane'; d.label = r.pick(['OS2U Kingfisher floatplane', 'Arado Ar 196 floatplane', 'E13A floatplane']);
    d.facts = ['Floatplanes were launched by catapult from cruisers and battleships to spot for the guns.', 'A floatplane lands on its floats; sunk, it often rests on them, propped above the sand.'];
    d.build = function* (b, rng, st, cutLo, cutHi) {
      yield* inner(b, rng, st, cutLo, cutHi);
      if (cutLo > 0) return;
      const f = [d.Lv.growth, 0], c = d.Lv.under, z0 = -len / 2, fl = len * 0.78;
      const v0 = b.vc;
      b.lathe(12, 8, (v) => [0.48 * Math.pow(Math.sin(Math.min(1, v * 1.2 + 0.03) * Math.PI * 0.62), 0.8) * (1 - 0.6 * sstep(0.6, 1, v)) + 0.03, v * fl], null, (v, a, x, y, z, oo) => { oo[3] = c[0]; oo[4] = c[1]; oo[5] = c[2]; oo[6] = f[0]; oo[7] = 0; });
      b.xform(v0, rotX(Math.PI / 2), 0, -1.35, z0 + 0.6);
      for (const dz of [0.3, 0.45]) cyl(b, [0, -1.2, z0 + dz * len], [0, 0.25, z0 + dz * len + 0.3], 0.06, 0.06, 4, c, f);
      for (const sx of [-1, 1]) { const tx = sx * 5.0, v1 = b.vc; b.lathe(8, 5, (v) => [0.22 * Math.sin(Math.min(1, v * 1.1 + 0.05) * Math.PI * 0.7) + 0.02, v * 2.0], null, (v, a, x, y, z, oo) => { oo[3] = c[0]; oo[4] = c[1]; oo[5] = c[2]; oo[6] = f[0]; }); b.xform(v1, rotX(Math.PI / 2), tx, -0.1, z0 + len * 0.27); cyl(b, [tx, -0.05, z0 + len * 0.33], [tx, R * 0.7, z0 + len * 0.33], 0.04, 0.04, 4, c, f); }
      b.feats.push({ name: 'Main float', fact: 'The big central float held the plane up; small floats under the wingtips kept it level.', p: [0, -1.3, z0 + len * 0.4] });
      void R;
    };
    d.H.D += 1.5;
    return d;
  }
  const len = r.range(18.5, 20), rx = 1.05, span = r.range(29, 32);
  const d = airDesign(r, o, 'seaplane', 'PBY Catalina flying boat', ['The PBY Catalina could stay aloft for over 20 hours, hunting submarines and rescuing downed airmen.', 'A flying boat lands on its own boat-shaped hull, with floats under the wingtips.'], { len, R: 1.5, paints: ['navy', 'grey', 'silver'], breakAt: 0.62 });
  d.H.D = 6;
  const z0 = -len / 2;
  const sec = (t) => {
    let k;
    if (t < 0.12) k = 0.45 + 0.55 * Math.pow(Math.sin(Math.PI / 2 * t / 0.12), 0.6);
    else if (t < 0.55) k = 1;
    else k = 1 - 0.75 * Math.pow((t - 0.55) / 0.45, 1.2);
    const rise = t > 0.5 ? 1.2 * Math.pow((t - 0.5) / 0.5, 1.5) : 0;
    return [rx * k, 1.15 * k, 1.45 * k * (t > 0.5 ? 1 - 0.45 * (t - 0.5) / 0.5 : 1), 1.5 + rise];
  };
  d.build = function* (b, rng, st, cutLo, cutHi) {
    const Lv = d.Lv, f = [Lv.growth, 0], top = Lv.top, und = Lv.under;
    Lv._yc = 1.0;
    yield* loft(b, { len, z0, t0: cutLo, t1: cutHi, nu: Math.max(3, Math.round((cutHi - cutLo) * len / 0.8)), nt: 14, sec, vee: 0.6, Lv, seed: o.seed, th: 0.04, tone: tone(Lv),
      hole: (t, a) => h01(Math.floor(t * 40), Math.floor(a * 2.4), 1, o.seed) < 0.1 || (cutLo > 0 && t < cutLo + 0.04) || (cutHi < 1 && t > cutHi - 0.04), open: { i0: cutLo > 0, i1: cutHi < 1 } });
    const zt = (t) => z0 + t * len, inT = (t) => t >= cutLo && t <= cutHi;
    if (inT(0.03)) bubble(b, [0, 2.4, zt(0.05)], 0.5, 0.5, 0.6, f);
    if (inT(0.2)) bubble(b, [0, 2.6, zt(0.2)], 0.8, 0.45, 1.2, f);
    if (inT(0.62)) for (const sx of [-1, 1]) bubble(b, [sx * 0.95, 2.4, zt(0.62)], 0.4, 0.6, 0.9, f);
    yield;
    if (inT(0.36)) {
      const wy = 4.6, wz = zt(0.33);
      b.box(0.9, 2.0, 4.0, null, 0, 3.5, wz + 2.2, top, f); // pylon
      for (const sx of [-1, 1]) {
        const keep = rng() < 0.3 ? rng.range(0.35, 0.75) : 1;
        wing(b, { root: [0, wy, wz], sdir: [sx, 0.015, 0], cdir: [0, 0, 1], span: span / 2, c0: 4.6, c1: 2.6, th: 0.14, sweep: 0.3, keep, colTop: top, colBot: und, f, seed: o.seed + sx, K: 8, holes: 0.1 });
        const p = [sx * 3.6, wy - 0.15, wz - 1.0];
        cyl(b, add(p, [0, 0, 0.6]), add(p, [0, -0.1, 3.6]), 0.75, 0.4, 10, top, f, 2);
        radial(b, p, [0, 0, 1], 0.72, top, f, rng() * 6, 3, rng() < 0.6 ? 1 : 0.3);
        if (keep > 0.98) { const tx = sx * span * 0.47, v1 = b.vc; b.lathe(8, 5, (v) => [0.3 * Math.sin(Math.min(1, v * 1.1 + 0.05) * Math.PI * 0.7) + 0.02, v * 2.6], null, (v, a, x, y, z, oo) => { oo[3] = und[0]; oo[4] = und[1]; oo[5] = und[2]; oo[6] = f[0]; }); b.xform(v1, rotX(Math.PI / 2), tx, wy - 1.6, wz); cyl(b, [tx, wy - 1.4, wz + 1.2], [tx, wy, wz + 1.2], 0.05, 0.05, 4, und, f); }
      }
      // struts from the hull to the wing
      for (const sx of [-1, 1]) cyl(b, [sx * 0.8, 2.6, wz + 2], [sx * 4.5, wy - 0.1, wz + 2], 0.07, 0.07, 4, top, f);
      b.feats.push({ name: 'Parasol wing', fact: "The Catalina's wing sat on a pylon high above the hull, keeping the engines clear of spray.", p: [0, wy, wz] });
    }
    if (inT(0.93)) {
      const ty = sec(0.95)[3] + 1.3, tz = zt(0.86);
      wing(b, { root: [0, sec(0.86)[3] + 0.6, zt(0.8)], sdir: norm([0, 1, 0.2]), cdir: [0, 0, 1], span: 3.6, c0: 3.4, c1: 1.6, th: 0.1, sweep: 0.8, colTop: top, colBot: top, f, seed: o.seed + 7, K: 4 });
      for (const sx of [-1, 1]) wing(b, { root: [sx * 0.2, ty, tz], sdir: [sx, 0.02, 0], cdir: [0, 0, 1], span: 3.8, c0: 2.4, c1: 1.3, th: 0.1, sweep: 0.3, colTop: top, colBot: und, f, seed: o.seed + 9 + sx, K: 3 });
    }
    b.attach.push({ p: [0, 2.7, zt(0.45)], n: [0, 1, 0] }, { p: [5, 4.8, zt(0.35)], n: [0, 1, 0] }, { p: [-5, 4.8, zt(0.35)], n: [0, 1, 0] });
  };
  return d;
}
