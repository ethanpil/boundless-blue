// Structures that span the street: gates in every style, city walls with towers, aqueducts and bridges.
// Local frame: x across the street (the camera path runs through x = 0 along z), y up from the floor at the
// path, z along the path. `hp` is the camera path height above that floor; every opening keeps the flight
// tube (3.5 m + margin around the path line) free, and the capsules are authored around the masonry only.
import { TAU, rotY, rotZ } from './core.js';
import { linePath, scale3, GOLD_MODE } from './ruins_kit.js';
import { prangTop, horns } from './ruins_bld.js';

const CLR = 3.5 + 0.6; // flight-tube radius kept clear by every opening (m)

// ---------- gates ----------
// returns the gate's half-width at the base (city walls continue from there)
export function* genGate(B, kind, hp, Rg) {
  const S = B.S, rng = B.rng, site = B.site;
  const fl0 = Math.min(site.fl(-Rg, 0), site.fl(Rg, 0), site.fl(0, 0)) - 0.6;
  const ys = hp - 0.15; // springing line of round arches: the arch is concentric with the flight tube
  if (kind === 'arch' || kind === 'triumph' || kind === 'gateTower') {
    const tri = kind === 'triumph', tower = kind === 'gateTower';
    const pw = tri ? B.r(3.6, 4.4) : tower ? B.r(5, 7) : B.r(1.7, 2.3), dz = tower ? B.r(5, 6.5) : tri ? B.r(2.4, 3) : B.r(1.6, 2.1);
    const L = 2 * (Rg + pw), th = Math.max(0.55, Rg * 0.12), attic = tri ? B.r(2.4, 3.2) : B.r(1.2, 2);
    const H = ys + Rg + th + attic;
    const open = [{ kind: 'arch', u0: pw, u1: pw + 2 * Rg, v0: fl0, v1: ys + Rg, th }];
    if (tri) for (const u of [0.7, pw + 2 * Rg + 0.7]) { const w = pw - 1.4; open.push({ kind: 'arch', u0: u, u1: u + w, v0: fl0, v1: fl0 + 0.6 + w * 1.6, th: 0.45 }); }
    B.wall(linePath(-L / 2, 0, L / 2, 0), { t: dz, H, top: B.profile(H, H - 3, L, 0, B.decay * 0.5), ch: [S.ch[0] * 1.1, S.ch[1] * 1.15], bl: S.bl, open, noObs: true, fall: 0.3, bev: 0.03 });
    if (tri) { // engaged columns on both faces and an inscription panel on the attic
      for (const sz of [-1, 1]) for (const x of [-(Rg + pw - 0.55), -(Rg + 0.55), Rg + 0.55, Rg + pw - 0.55]) {
        const z = sz * (dz / 2 + 0.35), pt = ys - 0.3;
        B.pier(1.0, 1.0, x, z, pt, null, B.tone(B.trim, 0.04), 0.04, 0.02);
        B.column(x, pt, z, { style: 'corinthian', R: 0.32, H: Rg + th - 0.6, noObs: true });
      }
      for (const sz of [-1, 1]) B.box(2 * Rg * 0.9, attic * 0.6, 0.12, 0, H - attic * 0.5, sz * (dz / 2 + 0.04), null, scale3(B.trim, 0.82), 0, 0.01);
    }
    if (tower && B.decay < 0.6) { // gate-tower pavilion on top (Lion City)
      const ax = Rg + pw * 0.6, az = dz / 2 + 0.6;
      for (const x of [-ax + 0.5, -ax / 3, ax / 3, ax - 0.5]) for (const z of [-az + 0.5, az - 0.5]) B.column(x, H, z, { style: 'pagoda', R: 0.22, H: 3.2, col: [0.36, 0.11, 0.07], noObs: true });
      B.hipRoof(ax + 1.4, az + 1.4, H + 3.4, 2.6, { col: S.roofCol, up: 0.7, curve: 1.7, keep: rng() < 0.5 ? (f, s, v) => rng() > 0.25 : null });
      B.cap(-ax, H + 2, 0, ax, H + 2, 0, az);
    }
    for (const sx of [-1, 1]) B.boxCaps(sx * (Rg + pw / 2), 0, pw, dz, fl0 + 0.6, H);
    B.cap(-Rg * 0.6, H - attic / 2, 0, Rg * 0.6, H - attic / 2, 0, Math.min(attic / 2 + 0.2, dz / 2 + 0.1));
    for (let k = 1; k < 6; k++) { const a = Math.PI * k / 6, rr = Rg + th / 2; B.cap(Math.cos(a) * rr, ys + Math.sin(a) * rr, -dz / 2 + 0.4, Math.cos(a) * rr, ys + Math.sin(a) * rr, dz / 2 - 0.4, th / 2 + 0.25); }
    return Rg + pw;
  }
  if (kind === 'trilithon') {
    const w = B.r(1.4, 1.9), d = B.r(1.3, 1.7), top = hp + CLR + 0.2;
    for (const sx of [-1, 1]) { B.pier(w, d, sx * (Rg + w / 2), 0, top, null, B.tone(B.stone, 0.05), 0.06, 0.05, 0.6); B.boxCaps(sx * (Rg + w / 2), 0, w, d, fl0 + 0.6, top); }
    B.box(2 * Rg + 2 * w - 0.1, 1.4, d * 1.1, 0, top + 0.62, 0, null, B.tone(B.stone, 0.05), 0.06, 0.03); // the lintel lies on both uprights
    B.cap(-Rg - w, top + 0.7, 0, Rg + w, top + 0.7, 0, 0.85);
    return Rg + w;
  }
  if (kind === 'pylon') { // Egyptian temple pylon: two battered towers, a portal between them, cavetto cornices
    const tw = B.r(7, 9.5), td = B.r(4, 5.2), th = hp + CLR + B.r(3, 6), x0 = Rg + 0.9;
    for (const sx of [-1, 1]) {
      const xc = sx * (x0 + tw / 2), n = Math.max(6, Math.round(th / 0.85)), fl = B.minFloor(tw, td, xc, 0, null) - 0.5;
      for (let k = 0; k < n; k++) { // courses battered inward
        const y0 = fl + (th - fl) * k / n, y1 = fl + (th - fl) * (k + 1) / n, f = (k + 0.5) / n;
        const w = tw * (1 - 0.16 * f), d = td * (1 - 0.18 * f), nb = 2 + (k % 2);
        for (let j = 0; j < nb; j++) B.box(w / nb * 1.01, y1 - y0, d, xc - w / 2 + (j + 0.5) * w / nb, (y0 + y1) / 2, 0, null, B.tone(B.stone, 0.07), 0.03, 0.03);
      }
      const wt = tw * 0.84, dt = td * 0.82;
      B.prism([[-0.05, 0], [0.55, 0.65], [0.55, 0.85], [-0.05, 0.85]], wt + 1.2, xc, th, dt / 2 - 0.05, rotY(-Math.PI / 2), B.tone(B.trim, 0.05));
      B.prism([[-0.05, 0], [0.55, 0.65], [0.55, 0.85], [-0.05, 0.85]], wt + 1.2, xc, th, -dt / 2 + 0.05, rotY(Math.PI / 2), B.tone(B.trim, 0.05));
      B.boxCaps(xc, 0, tw * 0.92, td * 0.92, fl + 0.5, th);
    }
    const ph = hp + CLR + 0.4; // portal lintel and cornice
    for (const sx of [-1, 1]) B.pier(1.0, td * 0.75, sx * (Rg + 0.45), 0, ph, null, B.tone(B.trim, 0.05), 0.03, 0.02);
    B.box(2 * Rg + 2.4, 1.2, td * 0.8, 0, ph + 0.6, 0, null, B.tone(B.trim, 0.05), 0.03, 0.02);
    B.prism([[-0.05, 0], [0.5, 0.6], [0.5, 0.8], [-0.05, 0.8]], 2 * Rg + 3, 0, ph + 1.2, td * 0.4, rotY(-Math.PI / 2), B.tone(B.trim, 0.05));
    B.cap(-Rg, ph + 0.7, 0, Rg, ph + 0.7, 0, 0.9);
    return x0 + tw;
  }
  if (kind === 'corbelArch' || kind === 'gopura') { // Maya / Khmer corbel-vaulted passage
    const R2 = Math.max(Rg, 5.7), pw = kind === 'gopura' ? B.r(3.5, 5) : B.r(2.5, 3.5), dz = B.r(2.6, 3.4);
    const L = 2 * (R2 + pw), vs = hp, H = vs + R2 / 0.7 + B.r(1.2, 2.2), crown = B.decay < 0.5; // frieze / tower need the full wall
    B.wall(linePath(-L / 2, 0, L / 2, 0), { t: dz, H, top: B.profile(H, H - 2.5, L, 0, crown ? 0 : B.decay * 0.4), ch: S.ch, bl: S.bl, open: [{ kind: 'corbel', u0: pw, u1: pw + 2 * R2, v0: fl0, v1: 2 * vs - fl0 }], noObs: true, fall: 0.25 });
    if (crown && kind === 'corbelArch') { B.box(L + 0.3, 1.0, dz + 0.3, 0, H - 0.45, 0, null, B.tone(B.trim, 0.06), 0, 0.02); for (let k = 0; k < 7; k++) B.box(0.5, 0.5, 0.2, -L / 2 + 1 + k * (L - 2) / 6, H - 0.45, dz / 2 + 0.2, null, B.tone(B.trim, 0.1), 0.02, 0.01); }
    else if (crown) { // the solid tower mass above the vault, crowned by a lotus-bud tower
      const yc = vs + (R2 - 0.45) / 0.7, rp = Math.min(3.4, R2 * 0.55, dz / 2 + 0.2); // no wider than the mass it stands on
      B.box(2 * rp + 0.2, H - yc + 0.25, dz * 0.98, 0, (yc + H) / 2 - 0.12, 0, null, B.tone(B.stone, 0.05), 0, 0.02);
      prangTop(B, 0, H - 0.05, 0, rp, B.r(4.5, 6.5));
    }
    for (const sx of [-1, 1]) B.boxCaps(sx * (R2 + pw / 2), 0, pw, dz, fl0 + 0.6, H);
    for (const sx of [-1, 1]) B.cap(sx * R2 * 0.75, vs + R2 * 0.55, 0, sx * R2 * 0.2, vs + R2 * 1.25, 0, 1.0);
    B.cap(-R2 * 0.3, H - 1.2, 0, R2 * 0.3, H - 1.2, 0, 1.2);
    return R2 + pw;
  }
  if (kind === 'propylon') { // Minoan columned gateway with a flat roof and horns of consecration
    const ph = hp + CLR + 0.3, dz = 4;
    for (const sx of [-1, 1]) for (const x of [Rg + 0.6, Rg + 3.6]) for (const z of [-dz / 2, dz / 2]) B.column(sx * x, null, z, { style: 'minoan', R: 0.34, H: ph - 0.4 - site.fl(sx * x, z), plinth: true });
    B.box(2 * (Rg + 4.4), 0.7, dz + 1.4, 0, ph + 0.35, 0, null, B.tone(B.trim, 0.05), 0.04, 0.02);
    B.box(2 * (Rg + 4.4) + 0.2, 0.25, dz + 1.6, 0, ph + 0.82, 0, null, [0.45, 0.13, 0.09], 0, 0.01);
    for (let k = -2; k <= 2; k++) horns(B, k * (Rg + 3) / 2.2, ph + 0.95, 0, 0.9, 0);
    for (const sx of [-1, 1]) for (const x of [Rg + 0.6, Rg + 3.6]) B.cap(sx * x, site.fl(sx * x, 0) + 0.5, -dz / 2, sx * x, site.fl(sx * x, 0) + 0.5, dz / 2, 0.55), B.cap(sx * x, ph - 0.6, -dz / 2, sx * x, ph - 0.6, dz / 2, 0.55);
    for (const sx of [-1, 1]) for (const x of [Rg + 0.6, Rg + 3.6]) for (const z of [-dz / 2, dz / 2]) B.cap(sx * x, site.fl(sx * x, z) + 0.5, z, sx * x, ph - 0.5, z, 0.5);
    B.cap(-Rg - 3, ph + 0.5, 0, Rg + 3, ph + 0.5, 0, 0.9);
    return Rg + 4.4;
  }
  if (kind === 'paifang' || kind === 'torii') {
    const ph = hp + CLR + 0.3, pagoda = kind === 'paifang';
    const xs = pagoda ? [Rg + 0.3, Rg + 4.3] : [Rg + 0.4], red = [0.38, 0.11, 0.07];
    for (const x of xs) for (const sx of [-1, 1]) {
      const X = sx * x, hgt = (x > Rg + 1 ? ph - 1.6 : ph) + 0.4;
      if (pagoda) { B.pier(1.1, 1.6, X, 0, B.minFloor(1.1, 1.6, X, 0, null) + 1.2, null, B.tone(B.trim, 0.05), 0.05, 0.02); B.column(X, null, 0, { style: 'octagonal', R: 0.3, H: hgt - site.fl(X, 0), col: B.tone(B.stone, 0.04), noObs: true }); }
      else B.column(X, null, 0, { style: 'pagoda', R: 0.38, H: ph + 1.4 - site.fl(X, 0), col: red, noObs: true });
      B.cap(X, site.fl(X, 0) + 0.5, 0, X, hgt, 0, 0.55);
    }
    if (pagoda) {
      B.box(2 * Rg + 1.6, 0.55, 0.5, 0, ph, 0, null, B.tone(B.stone, 0.05), 0.04, 0.02);
      B.box(2 * Rg + 1.2, 0.9, 0.3, 0, ph + 0.9, 0, null, B.tone(B.trim, 0.06), 0.03, 0.02);
      B.hipRoof(Rg + 1.4, 1.1, ph + 1.55, 1.1, { col: S.roofCol, up: 0.45, curve: 1.6 });
      for (const sx of [-1, 1]) { // the lower side bays with their own small roofs
        B.box(4.4, 0.45, 0.45, sx * (Rg + 2.3), ph - 1.6, 0, null, B.tone(B.stone, 0.05), 0.04, 0.02);
        const m = B.mark();
        B.hipRoof(2.6, 0.9, ph - 1.0, 0.8, { col: S.roofCol, up: 0.35, curve: 1.6, noRidge: true });
        B.shift(m, sx * (Rg + 2.3), 0, 0);
      }
    } else {
      B.box(2 * Rg + 1.6, 0.45, 0.5, 0, ph, 0, null, red, 0.04, 0.02);
      B.box(0.35, 1.2, 0.35, 0, ph + 0.8, 0, null, red, 0.03, 0); // the central strut (gakuzuka) under the top beam
      const top = [], Wd = Rg + 2.6;
      for (let k = 0; k <= 10; k++) { const x = -Wd + 2 * Wd * k / 10, t = Math.abs(x) / Wd; top.push([x, ph + 1.3 + 0.45 * t ** 3, 0]); }
      B.tube(top, top.map((p, k) => 0.42 - 0.08 * Math.abs(k - 5) / 5), 6, [0.1, 0.09, 0.08]);
      B.cap(-Wd + 0.5, ph + 1.3, 0, Wd - 0.5, ph + 1.3, 0, 0.6);
    }
    return xs[xs.length - 1] + 0.6;
  }
  if (kind === 'organic') { // Atlantean parabolic arch: separate twisting ribs of white and sea-green stone, orichalcum bands
    const ya = hp + CLR + B.r(1.8, 2.8), xb = Rg + B.r(2.0, 2.8), nr = 2 + (rng() < 0.6 ? 1 : 0), dz = B.r(2.8, 3.6), tw = B.r(0.2, 0.35);
    const at = (t, z0) => [t * xb, ya * (1 - t * t), z0 + tw * Math.sin(t * Math.PI * 1.5 + z0)];
    for (let k = 0; k < nr; k++) {
      const z0 = -dz / 2 + dz * k / (nr - 1), pts = [];
      for (let q = 0; q <= 18; q++) pts.push(at(-1.12 + 2.24 * q / 18, z0));
      const col = k % 2 ? [0.3, 0.5, 0.52] : B.tone(B.stone, 0.04);
      B.tube(pts, pts.map((p) => 0.32 + 0.26 * (p[1] < hp ? 1 - p[1] / hp : 0)), B.lo ? 6 : 9, col, true);
      if (!B.lo) for (let q = 1; q < 9; q++) { // orichalcum bands around the rib
        const t = -1 + 2 * q / 9, a = at(t - 0.02, z0), b = at(t + 0.02, z0), r = 0.32 + 0.26 * (a[1] < hp ? 1 - a[1] / hp : 0) + 0.02;
        B.tube([a, b], [r, r], 9, [0.75, 0.52, 0.22], true, 0, GOLD_MODE);
      }
    }
    for (let q = 1; q < 8; q += 2) { const t = -1 + 2 * q / 8, a = at(t, -dz / 2), b = at(t, dz / 2); B.tube([a, b], [0.13, 0.13], 6, [0.75, 0.52, 0.22], true, 0, GOLD_MODE); }
    if (nr === 3) B.surf(B.lo ? 10 : 16, B.lo ? 6 : 10, (u, v, o) => { const a = u * TAU, t = (v - 0.5) * Math.PI; o[0] = Math.cos(a) * Math.cos(t) * 0.55; o[2] = Math.sin(a) * Math.cos(t) * 0.55; o[1] = ya + 0.75 + Math.sin(t) * 0.55; }, [0.75, 0.52, 0.22], { f0: 0, f1: GOLD_MODE }); // a golden orb on the middle rib's crown
    for (let q = 0; q < 7; q++) { const t = -1 + 2 * (q + 0.5) / 7, t2 = -1 + 2 * (q + 1.5) / 7; if (t2 > 1.01) break; B.cap(t * xb, ya * (1 - t * t), 0, t2 * xb, ya * (1 - t2 * t2), 0, Math.max(0.65, dz / 2 + 0.3)); }
    return xb + 0.5;
  }
  return Rg;
}

// one side (sd = -1 / 1) of a city wall from the gate (x0) out to the span, following the terrain, with
// crenellations, decay and breaches; towers are separate templates (genWallTowers)
export function* genCityWall(B, sd, x0, span) {
  const S = B.S, k = S.key;
  const t = k === 'egypt' ? B.r(2.2, 3) : B.r(1.6, 2.3), Hw = k === 'maya' ? B.r(3, 4.5) : B.r(6, 9);
  const seed = B.seed, d = B.decay, o = [0, 0, 0, 0];
  const colFn = S.bands ? ((kk) => B.tone(S.bands[kk % 3], 0.05)) : null;
  const xs = [x0, (x0 + span) / 2, span];
  for (let q = 0; q < 2; q++) { // two sections (separate time slices)
    const p = linePath(sd * xs[q], 0, sd * xs[q + 1], 0), L = p.L;
    const nF = Math.ceil(L / 2) + 1, F = new Float32Array(nF);
    for (let i = 0; i < nF; i++) { p.at(Math.min(L, i * 2), o); F[i] = B.site.fl(o[0], o[1]); }
    const fAt = (u) => { const r = Math.max(0, Math.min(nF - 1.001, u / 2)), i = r | 0, f = r - i; return F[i] + (F[i + 1] - F[i]) * f; };
    let Hmax = -1e9; for (let i = 0; i < nF; i++) Hmax = Math.max(Hmax, F[i] + Hw);
    const top = (u) => { // stepped top following the ground, breached where decay is strong
      const a = xs[q] + u, n = 0.5 + 0.5 * Math.sin(a * 0.13 + seed) * Math.sin(a * 0.051 + seed * 0.7);
      return fAt(u) + Hw * (1 - d * 0.8 * n) - (n > 0.82 && d > 0.45 ? Hw * 0.75 : 0);
    };
    B.wall(p, { t, H: Hmax, top, ch: [S.ch[0] * 1.2, S.ch[1] * 1.3], bl: [S.bl[0] * 1.3, S.bl[1] * 1.5], col: colFn, fall: 0.12 });
    if (k === 'greco' || k === 'pagoda' || k === 'khmer') { // merlons where the wall stands to full height
      for (let u = 1; u < L - 1; u += 2.2) {
        const tp = top(u);
        if (tp < fAt(u) + Hw - 0.2) continue;
        p.at(u, o);
        B.box(1.1, 0.8, t * 0.5, o[0], tp + 0.4, -t * 0.22, null, B.tone(B.stone, 0.06), 0.03, 0.03);
      }
    }
    if (B.over()) yield;
  }
  return { t, Hw };
}
export function* genWallTowers(B, sd, x0, span, t, Hw) {
  const S = B.S, rng = B.rng, k = S.key;
  for (let x = x0 + B.r(14, 20); x < span - 4; x += B.r(16, 24)) {
    const X = sd * x, w = B.r(5, 6.5), fl = B.minFloor(w, w, X, 0, null), H = fl + Hw + B.r(2.5, 4), d = Math.min(1, B.decay + (rng() - 0.5) * 0.4);
    const ws = [linePath(X - w / 2 - 0.4, w / 2, X + w / 2 + 0.4, w / 2), linePath(X + w / 2, w / 2 - 0.4, X + w / 2, -w / 2 + 0.4), linePath(X + w / 2 + 0.4, -w / 2, X - w / 2 - 0.4, -w / 2), linePath(X - w / 2, -w / 2 + 0.4, X - w / 2, w / 2 - 0.4)];
    let ph = 0;
    for (const p of ws) {
      const open = rng() < 0.6 ? [{ kind: 'rect', u0: p.L / 2 - 0.3, u1: p.L / 2 + 0.3, v0: H - 3, v1: H - 1.8 }] : [];
      B.wall(p, { t: 0.8, H, top: B.profile(H, fl + 0.6, p.L, ph, d), ch: [S.ch[0] * 1.2, S.ch[1] * 1.3], bl: [S.bl[0] * 1.2, S.bl[1] * 1.4], open, fall: 0.3 });
      ph += p.L;
      if (B.over()) yield;
    }
    if (k === 'pagoda' && d < 0.3) B.hipRoof(w / 2 + 1.2, w / 2 + 1.2, H, 2.2, { col: S.roofCol, up: 0.6, curve: 1.7, ridge: 0 });
  }
}

// ---------- aqueducts and bridges across the street ----------
// The arch over the street is concentric with the flight tube; the rest of the arcade steps up the terrain.
export function* genCrossing(B, kind, hp, span) {
  const S = B.S, rng = B.rng, site = B.site;
  const Rg = B.r(5.2, 6.2), ys = hp - 0.1, th = 0.7;
  const deckY = ys + Rg + th + (kind === 'aqueduct' ? 0.4 : 0.6);
  const dz = kind === 'aqueduct' ? B.r(2.2, 2.8) : B.r(3.6, 4.6);
  if (kind === 'moonBridge') return yield* moonBridge(B, hp, Rg, ys, dz);
  // arcade bays: the central one over the street, then bays outward until the ground reaches the deck
  const bays = [[-Rg, Rg]];
  const pierW = kind === 'moonBridge' ? 0 : B.r(1.5, 2.1), small = B.r(2.4, 3.2);
  for (const sd of [-1, 1]) {
    let x = Rg;
    while (x < span) {
      const a = x + pierW, b = a + 2 * small;
      const g = Math.max(site.fl(sd * a, 0), site.fl(sd * b, 0));
      if (g > deckY - 2.2) break;
      bays.push(sd > 0 ? [a, b] : [-b, -a]);
      x = b;
    }
  }
  bays.sort((p, q) => p[0] - q[0]);
  const x0 = bays[0][0] - pierW - 1, x1 = bays[bays.length - 1][1] + pierW + 1;
  const L = x1 - x0;
  // the arcade: a wall along x with an arched opening per bay (no capsules over the street)
  const open = bays.map(([a, b]) => ({ kind: S.key === 'atlantis' ? 'para' : 'arch', u0: a - x0, u1: b - x0, v0: Math.min(site.fl(a, 0), site.fl(b, 0)) - 0.6, v1: Math.abs(a + b) < 0.1 ? ys + Rg : Math.max(site.fl(a, 0), site.fl(b, 0)) + 0.4 + (b - a) * 1.1, th: Math.abs(a + b) < 0.1 ? th : 0.5 }));
  // in sections (west, the arch over the street, east): each its own time slice, decay continuous across them
  const cuts = [x0, -Rg - pierW / 2, Rg + pierW / 2, x1].filter((v, i, A) => i === 0 || v > A[i - 1] + 0.5);
  const top = B.profile(deckY, deckY - 3, L, 0, B.decay * 0.45);
  for (let q = 0; q + 1 < cuts.length; q++) {
    const xa = cuts[q], xb = cuts[q + 1];
    const op = open.filter((p) => p.u0 + x0 >= xa - 0.01 && p.u1 + x0 <= xb + 0.01).map((p) => ({ ...p, u0: p.u0 + x0 - xa, u1: p.u1 + x0 - xa }));
    B.wall(linePath(xa, 0, xb, 0), { t: dz, H: deckY, top: (u) => top(u + xa - x0), ch: [S.ch[0] * 1.15, S.ch[1] * 1.2], bl: S.bl, open: op, noObs: true, fall: 0.3 });
    if (B.over()) yield;
  }
  // deck furniture only where the arcade still stands to the deck
  const standing = (xa, xb) => top(xa - x0) >= deckY - 0.04 && top(xb - x0) >= deckY - 0.04 && top((xa + xb) / 2 - x0) >= deckY - 0.04;
  if (kind === 'aqueduct') { // the water channel (specus) with its cover slabs
    const n = Math.max(4, Math.round(L / 2.4));
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * L / n;
      if (rng() < B.decay * 0.35 || !standing(x - L / n / 2, x + L / n / 2)) continue;
      for (const sz of [-1, 1]) B.box(L / n * 1.01, 1.0, 0.45, x, deckY + 0.5, sz * (dz / 2 - 0.22), null, B.tone(B.stone, 0.06), 0.02, 0.03);
      if (rng() < 0.6) B.box(L / n * 0.98, 0.25, dz, x, deckY + 1.12, 0, null, B.tone(B.trim, 0.05), 0.02, 0.03);
    }
  } else { // bridge deck parapets (naga balustrade on Khmer bridges)
    for (const sz of [-1, 1]) {
      if (S.key === 'khmer') { // naga bodies on posts, in runs over the standing deck
        let run = [];
        const flush = () => { if (run.length > 2) { B.tube(run, run.map(() => 0.24), 7, B.tone(B.trim, 0.05)); for (let i = 0; i < run.length; i += 2) B.box(0.3, 0.95, 0.3, run[i][0], deckY + 0.45, run[i][2], null, B.tone(B.trim, 0.05), 0.02, 0.01); } run = []; };
        for (let i = 0; i <= 24; i++) {
          const x = x0 + 0.5 + (L - 1) * i / 24;
          if (!standing(x - 0.3, x + 0.3)) { flush(); continue; }
          run.push([x, deckY + 0.9 + 0.08 * Math.sin(i * 0.85), sz * (dz / 2 - 0.25)]);
        }
        flush();
      } else for (let x = x0 + 0.6; x < x1 - 0.6; x += 2.2) if (rng() > B.decay * 0.4 && standing(x, x + 2.18)) B.box(2.18, 1.0, 0.35, x + 1.1, deckY + 0.5, sz * (dz / 2 - 0.18), null, B.tone(B.trim, 0.05), 0.02, 0.03);
    }
  }
  // capsules: piers between bays, the deck band, the ring over the street
  for (let i = 0; i <= bays.length; i++) {
    const xa = i === 0 ? x0 : bays[i - 1][1], xb = i === bays.length ? x1 : bays[i][0], xm = (xa + xb) / 2, w = Math.max(0.6, xb - xa);
    if (Math.abs(xm) < Rg) continue;
    B.cap(xm, site.fl(xm, 0) + 0.5, 0, xm, deckY - 1, 0, Math.max(w, dz) / 2 + 0.1);
  }
  const rd = Math.min(1.2, dz / 2 + 0.1), zs = dz / 2 + 0.1 > 1.2 ? [-(dz / 2 - 1.05), dz / 2 - 1.05] : [0];
  for (let x = x0 + 1.2; x < x1 - 1.2; x += 2.6) for (const z of zs) B.cap(x, deckY + 0.2, z, Math.min(x1 - 1.2, x + 2.6), deckY + 0.2, z, rd);
  return { L };
}
// East Asian hump-backed bridge: one high semicircular arch, stepped ramps, a light balustrade
function* moonBridge(B, hp, Rg, ys, dz) {
  const R = Rg + 0.3, cx = 0, nR = 15;
  for (let k = 0; k < nR; k++) {
    const a0 = Math.PI * k / nR, a1 = Math.PI * (k + 1) / nR, am = (a0 + a1) / 2, rr = R + 0.45;
    const x = Math.cos(am) * rr, y = ys + Math.sin(am) * rr;
    B.box(Math.PI * rr / nR * 1.02, 0.9, dz, cx + x, y, 0, rotZ(am + Math.PI / 2), B.tone(B.stone, 0.05), 0.03, 0.02);
  }
  for (const sd of [-1, 1]) { // ramps of steps down to the ground on both sides
    let x = R + 0.6, y = ys + 0.5;
    for (let i = 0; i < 40; i++) {
      const g = B.minFloor(0.9, dz, sd * x, 0, null);
      if (y < g + 0.2) break;
      B.pier(0.9, dz, sd * x, 0, y, null, B.tone(B.trim, 0.04), 0.02, 0.02);
      x += 0.85; y -= 0.38;
    }
    const zs = dz > 2.6 ? [-dz / 4, dz / 4] : [0];
    for (const z of zs) B.cap(sd * (R + 0.6), ys - 0.2, z, sd * Math.max(R + 0.6, x - 0.85), Math.max(B.site.fl(sd * x, 0) + 0.3, y), z, Math.min(1.3, dz / (2 * zs.length) + 0.15));
  }
  for (let k = 1; k < nR; k++) { // balustrade posts standing on the back of the arch (where it is not too steep)
    const a = Math.PI * k / nR, rr = R + 0.75;
    if (Math.sin(a) < 0.55) continue;
    for (const sz of [-1, 1]) B.box(0.18, 0.95, 0.18, Math.cos(a) * rr, ys + Math.sin(a) * rr + 0.4, sz * (dz / 2 - 0.1), null, B.tone(B.trim, 0.05), 0.02, 0);
  }
  for (let k = 1; k < 6; k++) { const a = Math.PI * k / 6, rr = R + 0.5; B.cap(Math.cos(a) * rr, ys + Math.sin(a) * rr, -dz / 2 + 0.5, Math.cos(a) * rr, ys + Math.sin(a) * rr, dz / 2 - 0.5, 0.9); }
  return { L: 2 * R };
}
