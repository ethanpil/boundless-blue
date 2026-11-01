// Sunken-city building typologies, generated per placement from the construction kit (ruins_kit.js):
// rectangular buildings (houses, apartment blocks, palaces, halls, storerooms, baths, libraries), towers,
// round buildings, porticoes / galleries and small shrines, each in the vocabulary of its city's style.
// Every generator works in the site's local frame (x along the street, +z toward the street) and returns a
// Template (label, fact, obstacle capsules, support surface) or null.
import { TAU, lerp, rotY } from './core.js';
import { linePath, arcPath, scale3, n1, GOLD_MODE } from './ruins_kit.js';
import { pickW } from './ruins_styles.js';

const RED = [0.5, 0.15, 0.1], TERRACOTTA = [0.46, 0.22, 0.15];

// ---------- openings ----------
// regularly spaced openings along a wall of length L (u from 0), avoiding the corners
function rowOf(L, w, gap, margin = 0.9) {
  const out = [], avail = L - 2 * margin;
  if (avail < w) return out;
  const n = Math.max(1, Math.floor((avail + gap) / (w + gap)));
  const span = n * w + (n - 1) * gap, u0 = (L - span) / 2;
  for (let i = 0; i < n; i++) out.push(u0 + i * (w + gap));
  return out;
}
function opening(kind, u, w, v0, h) {
  if (kind === 'moon') { const r = Math.max(w, h) * 0.5; return { kind: 'round', u0: u + w / 2 - r, u1: u + w / 2 + r, v0: v0 - r * 0.15, v1: v0 - r * 0.15 + 2 * r }; }
  if (kind === 'balust') return { kind: 'rect', u0: u, u1: u + w, v0, v1: v0 + h, balust: true };
  if (kind === 'arch') return { kind, u0: u, u1: u + w, v0, v1: v0 + h };
  if (kind === 'para') return { kind, u0: u, u1: u + w, v0, v1: v0 + h * 1.1 };
  if (kind === 'round') { const r = Math.min(w, h) * 0.5; return { kind, u0: u + w / 2 - r, u1: u + w / 2 + r, v0: v0 + h / 2 - r, v1: v0 + h / 2 + r }; }
  return { kind, u0: u, u1: u + w, v0, v1: v0 + h };
}

// Balustered window (Khmer): turned stone colonnettes standing in the opening
function balusters(B, path, p, t) {
  if (!p.ok) return;
  const n = Math.max(3, Math.round(p.w / 0.24)), o = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    path.at(p.u0 + (i + 0.5) * p.w / n, o);
    const h = p.v1 - p.v0;
    B.lathe(B.lo ? 5 : 7, 4, (v) => [0.06 * (1 + 0.45 * Math.sin(v * Math.PI * 3) ** 2), p.v0 + v * h], null, B.tone(B.trim, 0.04), B.grow, B.key, o[0], 0, o[1]);
  }
}

// ---------- the rectangular building ----------
// o: { W, D, n (storeys), hs, roof, shops, portico, porticoCols, parapet, partition, kq, intact, stepsUp }
export function* rectBuilding(B, o) {
  const S = B.S, rng = B.rng, site = B.site, W = o.W, D = o.D;
  const kq = o.kq ?? Math.min(1.8, Math.max(1, Math.sqrt(((W + D) * 2 * (o.n * o.hs)) / 160)));
  const t = o.t ?? B.r(S.t[0], S.t[1]) * (o.n > 2 ? 1.1 : 1);
  const ch = [S.ch[0] * Math.sqrt(kq) * (B.lo ? 1.15 : 1), S.ch[1] * Math.sqrt(kq) * (B.lo ? 1.15 : 1)];
  const bl = [S.bl[0] * kq * (B.lo ? 1.3 : 1), S.bl[1] * kq * (B.lo ? 1.3 : 1)];
  const [lowF, highF] = site.range(-W / 2, -D / 2, W / 2, D / 2, 3);
  const ft = Math.max(site.fl(0, D / 2), lowF + 0.1); // ground storey level (door sill at the street front)
  const H = ft + o.n * o.hs + (o.parapet ?? 0.5);
  const d = o.intact ? 0 : B.decay, base = lowF + 0.35;
  const doorK = o.doorKind || pickW(rng, S.door), winK = o.winKind || pickW(rng, S.win);
  const dw = doorK === 'moon' ? 2.0 : B.r(1.05, 1.6) * (o.n > 2 ? 1.15 : 1), dh = doorK === 'moon' ? 2.0 : B.r(2.1, 2.7);
  const ww = winK === 'round' ? B.r(0.7, 1.0) : B.r(0.7, 1.15), wh = winK === 'round' ? ww : B.r(1.0, 1.5), sill = B.r(0.9, 1.2);
  const bands = [];
  for (let k = 1; k < o.n; k++) bands.push(ft + k * o.hs - 0.05);
  // band colours: Atlantean tri-colour courses, Roman brick, plain stone
  const colFn = S.bands && rng() < 0.65 ? ((k) => B.tone(S.bands[k % S.bands.length === 0 ? 0 : (k % 5 === 2 ? 1 : k % 5 === 4 ? 2 : 0)], 0.06))
    : S.brick && rng() < 0.3 ? ((k, i) => (k % 7 === 0 ? B.tone(B.trim, 0.05) : B.tone(S.brick, 0.1))) : null;
  const walls = [ // front, right, back, left (perimeter order for a continuous decay profile)
    { p: linePath(-W / 2 - t / 2, D / 2, W / 2 + t / 2, D / 2), side: 'front' },
    { p: linePath(W / 2, D / 2 - t / 2, W / 2, -D / 2 + t / 2), side: 'side' },
    { p: linePath(W / 2 + t / 2, -D / 2, -W / 2 - t / 2, -D / 2), side: 'back' },
    { p: linePath(-W / 2, -D / 2 + t / 2, -W / 2, D / 2 - t / 2), side: 'side' },
  ];
  let phase = 0;
  const res = [];
  for (const wv of walls) {
    const L = wv.p.L, open = [];
    if (wv.side === 'front') {
      if (o.shops) { // shop fronts: a row of wide openings on the ground storey
        const sw = B.r(2.0, 2.8), kind = S.key === 'greco' ? 'arch' : doorK === 'moon' ? 'rect' : doorK;
        for (const u of rowOf(L, sw, B.r(0.9, 1.3), 0.8)) open.push(opening(kind, u, sw, ft, Math.max(dh, sw * 1.05)));
      } else if (o.doors) { // palace range: many doorways
        for (const u of rowOf(L, dw, B.r(1.4, 2.4), 1.0)) open.push(opening(doorK, u, dw, ft, dh));
      } else {
        const u = L / 2 - dw / 2 + (rng() - 0.5) * Math.max(0, L - dw - 3.2);
        open.push(opening(doorK, u, dw, ft, dh));
        if (L > 6.5) for (const uu of rowOf(L, ww, B.r(1.2, 2.2), 1.1)) if (Math.abs(uu + ww / 2 - (u + dw / 2)) > (dw + ww) / 2 + 0.6 && rng() < 0.7) open.push(opening(winK, uu, ww, ft + sill, wh));
      }
      for (let k = 1; k < o.n; k++) for (const uu of rowOf(L, ww, B.r(1.0, 1.8), 1.0)) open.push(opening(winK, uu, ww, ft + k * o.hs + sill, wh));
    } else {
      const ks = wv.side === 'back' ? 0 : 1;
      for (let k = ks; k < o.n; k++) for (const uu of rowOf(L, ww, B.r(1.6, 3.0), 1.2)) if (rng() < 0.8) open.push(opening(winK, uu, ww, ft + k * o.hs + sill + (k === 0 ? 0.3 : 0), wh));
      if (wv.side === 'back' && rng() < 0.4) open.push(opening('rect', L * B.r(0.3, 0.6), dw * 0.85, Math.max(ft, site.fl(0, -D / 2)), dh * 0.92));
    }
    const top = B.profile(H, base, L, phase, d);
    phase += L;
    const built = B.wall(wv.p, { t, H, top, ch, bl, open, bands, col: colFn, bev: o.bev, fall: 0.4 });
    res.push({ p: wv.p, open: built });
    if (B.over()) yield;
  }
  // decorate openings (balustered windows)
  if (S.key === 'khmer') for (const r of res) for (const p of r.open) if (p.balust) balusters(B, r.p, p, t); // between the built sill and lintel
  // interior partition (lower, thinner, with a doorway)
  if (o.partition !== false && W > 8.5 && rng() < 0.75) {
    const x = B.r(-W * 0.2, W * 0.2), L = D - t, hp = Math.min(H, ft + o.hs * B.r(0.8, 1.0));
    const p = linePath(x, D / 2 - t / 2, x, -D / 2 + t / 2);
    B.wall(p, { t: t * 0.75, H: hp, top: B.profile(hp, base, L, phase + 7, Math.min(1, d + 0.2)), ch, bl, open: [opening('rect', L * B.r(0.3, 0.6), 1.0, Math.max(ft, site.fl(x, 0)), 2.1)], fall: 0.3 });
  }
  return { H, ft, t, d, lowF, highF };
}

// roof on intact walls (or the pieces of one)
function roofOn(B, kind, W, D, t, H, o = {}) {
  const S = B.S, ax = W / 2 + t / 2, az = D / 2 + t / 2;
  if (kind === 'flat' || kind === 'corbelRoof') {
    const n = Math.max(2, Math.round(W / 1.6));
    for (let i = 0; i < n; i++) {
      if (o.broken && B.rng() < o.broken) continue;
      const x = -ax + (i + 0.5) * 2 * ax / n;
      B.box(2 * ax / n * 0.99, 0.32, 2 * az + 0.1, x, H + 0.16, 0, null, B.tone(B.stone, 0.06), B.lo ? 0 : 0.03, 0.03);
    }
    B.cap(-ax + 0.4, H + 0.16, 0, ax - 0.4, H + 0.16, 0, Math.min(az, 1.4));
    if (kind === 'corbelRoof') for (let k = 1; k <= 3; k++) B.box(2 * ax * (1 - 0.18 * k), 0.4, 2 * az * (1 - 0.22 * k), 0, H + 0.32 + (k - 0.5) * 0.4, 0, null, B.tone(B.stone, 0.06), 0, 0.03);
    if (S.cornice) { // Egyptian cavetto cornice with a torus moulding
      for (const sz of [-1, 1]) B.prism([[-0.05, 0], [0.45, 0.55], [0.45, 0.7], [-0.05, 0.7]], 2 * ax + 0.9, 0, H - 0.35, sz * (az - 0.05), rotY(sz > 0 ? -Math.PI / 2 : Math.PI / 2), B.tone(B.trim, 0.05));
      for (const sx of [-1, 1]) B.prism([[-0.05, 0], [0.45, 0.55], [0.45, 0.7], [-0.05, 0.7]], 2 * az + 0.9, sx * (ax - 0.05), H - 0.35, 0, rotY(sx > 0 ? 0 : Math.PI), B.tone(B.trim, 0.05));
    }
    if (S.frieze) { // Maya: projecting frieze band and a carved roof comb
      B.box(2 * ax + 0.3, 0.9, 2 * az + 0.3, 0, H - 0.6, 0, null, B.tone(B.trim, 0.08), 0, 0.02);
      if (o.comb) {
        const hc = B.r(2.2, 3.6), wc = 2 * ax * B.r(0.4, 0.7), zc = B.r(-0.2, 0.2) * az; // roof comb: courses stacked on one line
        for (let k = 0; k < 4; k++) B.box(wc * (1 - k * 0.15), hc / 4 + 0.03, 0.45, 0, H + 0.32 + (k + 0.5) * hc / 4 - 0.015, zc, null, B.tone(B.trim, 0.06), 0, 0.01);
        B.cap(-wc / 2, H + 0.3 + hc / 2, 0, wc / 2, H + 0.3 + hc / 2, 0, Math.min(1.1, hc / 2));
      }
    }
    if (S.horns && B.rng() < 0.8) hornsRow(B, ax, az, H + 0.32);
  } else if (kind === 'gable') {
    const h = Math.min(3, az * B.r(0.38, 0.5));
    if (W >= D) B.gableRoof(ax + 0.35, az + 0.35, H, h, { col: S.roofCol || TERRACOTTA, pediment: true, keep: o.broken ? (sd, s, v) => n1(s * 7 + sd * 3, B.seed) > o.broken * 0.8 : null });
    else { // ridge along z (gable to the street)
      const m = B.mark();
      B.gableRoof(az + 0.35, ax + 0.35, H, Math.min(3, ax * B.r(0.38, 0.5)), { col: S.roofCol || TERRACOTTA, pediment: true });
      B.turn(m, Math.PI / 2);
    }
  } else if (kind === 'hip') {
    const ov = B.r(0.9, 1.5), h = Math.min(az + ov, 4.2) * B.r(0.6, 0.85);
    B.hipRoof(ax + ov, az + ov, H, h, { col: S.roofCol, up: S.curvedRoof ? B.r(0.4, 0.8) : 0, curve: S.curvedRoof ? 1.7 : 1, keep: o.broken ? (f, s, v) => n1(s * 6 + f * 3.1 + v * 2, B.seed) > o.broken * 0.75 : null });
    if (S.curvedRoof) B.box(2 * ax + 0.2, 0.3, 2 * az + 0.2, 0, H - 0.15, 0, null, [0.32, 0.12, 0.08], 0, 0.02); // red lacquered beam band
  } else if (kind === 'vault') {
    const r = az, nu = B.lo ? 6 : 10;
    B.surf(nu, 1, (u, v, out) => { const a = u * Math.PI; out[0] = lerp(-ax, ax, v); out[1] = H + Math.sin(a) * r * 0.85; out[2] = Math.cos(a) * r; }, B.tone(B.stone, 0.05), { th: 0.35, keep: o.broken ? (u, v) => n1(u * 5 + v * 3, B.seed) > o.broken : null });
    B.cap(-ax + r * 0.5, H + r * 0.3, 0, ax - r * 0.5, H + r * 0.3, 0, r * 0.9);
  } else if (kind === 'dome' || kind === 'shell') {
    const R = Math.min(ax, az) * 0.98;
    if (Math.abs(ax - az) > 0.6) B.box(2 * ax, 0.35, 2 * az, 0, H + 0.17, 0, null, B.tone(B.stone, 0.05), 0, 0.02);
    B.dome(0, H + 0.3, 0, R, { k: kind === 'shell' ? 1.25 : B.r(0.8, 1.1), ribs: S.gold || kind === 'shell' ? 8 + 4 * ((B.rng() * 3) | 0) : 0, ribGold: S.gold && B.rng() < 0.5, gold: S.gold && B.rng() < 0.25, broken: o.broken || 0, oculus: S.key === 'greco' && B.rng() < 0.5 ? 0.1 : 0 });
  }
}

// Minoan horns of consecration along a roof edge
function hornsRow(B, ax, az, y) {
  const n = Math.max(2, Math.round(ax / 1.4));
  for (let i = 0; i < n; i++) horns(B, -ax + (i + 0.5) * 2 * ax / n, y, az - 0.25, 0.55, 0);
}
export function horns(B, x, y, z, s, yaw) {
  // concave outline built from convex prisms: the base and two upswept horns
  const R = rotY(yaw), c = B.tone(B.trim, 0.04);
  B.prism([[-0.5 * s, 0], [0.5 * s, 0], [0.5 * s, 0.32 * s], [-0.5 * s, 0.32 * s]], 0.3 * s, x, y, z, R, c);
  for (const sd of [-1, 1]) B.prism([[sd * 0.5 * s, 0.3 * s], [sd * 0.28 * s, 0.3 * s], [sd * 0.36 * s, 1.0 * s], [sd * 0.47 * s, 1.02 * s]], 0.26 * s, x, y, z, R, c);
}

// ---------- typologies ----------
function storeys(B, kind) {
  const S = B.S;
  if (kind === 'block') return 2 + ((B.rng() * (S.key === 'greco' ? 3 : 2)) | 0);
  if (kind === 'palace') return 1 + (B.rng() < 0.35 ? 1 : 0);
  if (kind === 'house') return 1 + (B.rng() < (S.key === 'minoan' ? 0.7 : 0.45) ? 1 : 0) + (S.key === 'minoan' && B.rng() < 0.25 ? 1 : 0);
  return 1;
}

export function* genRect(B, kind, W, D) {
  const S = B.S, rng = B.rng;
  const roofs = S.roof;
  let roof = pickW(rng, roofs);
  const intact = rng() < Math.max(0, S.roofKeep * 1.6 - B.decay * 0.9);
  const o = { W, D, n: storeys(B, kind), hs: B.r(S.hs[0], S.hs[1]), intact };
  if (kind === 'block') { o.shops = S.key === 'greco' || S.key === 'minoan' || rng() < 0.4; o.parapet = 0.7; }
  if (kind === 'palace') { o.doors = true; o.parapet = 0.4; }
  if (kind === 'magazine') { o.n = 1; o.partition = true; }
  if (kind === 'library') { o.n = 1; o.hs = B.r(3.4, 4.2); roof = 'gableKhmer'; }
  if (kind === 'hall') { o.n = 1; o.hs = B.r(4.2, 5.2); roof = 'hip'; }
  if (kind === 'bath') { o.n = 1; o.hs = B.r(4.5, 5.5); roof = 'dome'; }
  if (S.key === 'pagoda') o.parapet = 0.2;
  const r = yield* rectBuilding(B, o);
  if (B.over()) yield;
  if (intact) {
    if (roof === 'gableKhmer') khmerPediments(B, W, D, r.t, r.H);
    else roofOn(B, roof, W, D, r.t, r.H, { broken: rng() < 0.6 ? B.r(0.15, 0.55) : 0, comb: kind === 'palace' || rng() < 0.3 });
  } else if (roof === 'gableKhmer' && r.d < 0.35) khmerPediments(B, W, D, r.t, r.H - 0.4);
  if (kind === 'hall' || (S.key === 'pagoda' && kind !== 'house')) platformUnder(B, W, D, r);
  if (kind === 'magazine') pithoiRows(B, W, D, r);
  return r;
}

// Khmer library: high pediments (stacked, flame-edged) at both gable ends
function khmerPediments(B, W, D, t, H) {
  for (const sz of [-1, 1]) {
    const w = W * 0.75, h = Math.min(3.2, W * 0.42), c = B.tone(B.trim, 0.05);
    B.prism([[-w / 2, 0], [w / 2, 0], [w * 0.08, h], [-w * 0.08, h]], t * 0.9, 0, H, sz * (D / 2), null, c);
    if (!B.lo) for (const sd of [-1, 1]) B.tube([[sd * w / 2, H + 0.1, sz * (D / 2 + t * 0.5)], [sd * w * 0.28, H + h * 0.55, sz * (D / 2 + t * 0.5)], [sd * 0.2, H + h * 0.98, sz * (D / 2 + t * 0.5)]], [0.12, 0.1, 0.08], 5, c);
  }
  B.cap(0, H + 1.2, D / 2, 0, H + 1.2, -D / 2, Math.min(1.6, W * 0.3));
}

// stone platform with steps toward the street, under halls (East Asian / Khmer)
function platformUnder(B, W, D, r) {
  const ph = Math.max(0.6, r.ft - r.lowF + 0.1), ax = W / 2 + 1.2, az = D / 2 + 1.2;
  if (ph < 0.5) return;
  for (const [x, z, w, d] of [[0, az - 0.6, 2 * ax, 1.2], [0, -az + 0.6, 2 * ax, 1.2], [ax - 0.6, 0, 1.2, 2 * az - 2.4], [-ax + 0.6, 0, 1.2, 2 * az - 2.4]]) B.pier(w, d, x, z, r.ft + 0.05, null, B.tone(B.trim, 0.06), 0, 0.02);
}

// Minoan storerooms: rows of giant jars, some broken
function pithoiRows(B, W, D, r) {
  const n = Math.max(2, Math.round((W - 2) / 1.3)), col = [0.5, 0.33, 0.23];
  for (const z of [-D / 4, D / 4]) for (let i = 0; i < n; i++) {
    if (B.rng() < 0.35) continue;
    const x = -W / 2 + 1 + (i + 0.5) * (W - 2) / n, H = B.r(1.2, 1.7), fl = B.minFloor(0.9, 0.9, x, z, null) - 0.25;
    B.lathe(B.lo ? 8 : 12, 6, (v) => [0.16 + 0.42 * Math.sin(v * Math.PI * 0.92) + 0.025 * Math.sin(v * 28), fl + v * H], null, col, 0.5, 0);
    if (!B.lo) for (let k = 1; k <= 3; k++) B.lathe(10, 1, (v) => [0.17 + 0.42 * Math.sin((k / 4 + v * 0.03) * Math.PI * 0.92) + 0.03, fl + (k / 4 + v * 0.03) * H], null, scale3(col, 0.8), 0.4, 0);
  }
}

// towers: square / round / octagonal, slit windows, crenellations or a style roof
export function* genTower(B, round) {
  const S = B.S, rng = B.rng, site = B.site;
  const w = B.r(4.4, 6.2), Hd = B.r(10, 17), t = B.r(0.7, 1.0);
  const [lowF] = site.range(-w / 2, -w / 2, w / 2, w / 2, 3);
  const ft = Math.max(site.fl(0, w / 2), lowF + 0.1), H = ft + Hd;
  const intact = rng() < 0.4 - B.decay * 0.3, d = intact ? 0 : B.decay * 0.85;
  const ch = [S.ch[0] * 1.1, S.ch[1] * 1.15], bl = [S.bl[0] * 1.1, S.bl[1] * 1.25];
  const winK = S.key === 'atlantis' ? 'para' : S.key === 'pagoda' ? 'round' : rng() < 0.5 ? 'rect' : 'arch';
  if (round) {
    const R = w / 2, p = arcPath(0, 0, R, Math.PI / 2, Math.PI / 2 + TAU), L = p.L, open = [];
    open.push(opening(S.key === 'atlantis' ? 'para' : 'arch', L * 0.0 + 0.0 + 0.4, 1.2, ft, 2.4));
    for (let y = ft + 3.2; y < H - 1.5; y += 3.1) open.push(opening(winK, (L * (0.25 + 0.5 * rng())), 0.55, y, 1.1));
    B.wall(p, { t, H, top: B.profile(H, lowF + 0.4, L, 0, d, false), ch, bl, open, lap: t / R * 0.6 + 0.02, fall: 0.45 });
  } else {
    const walls = [linePath(-w / 2 - t / 2, w / 2, w / 2 + t / 2, w / 2), linePath(w / 2, w / 2 - t / 2, w / 2, -w / 2 + t / 2), linePath(w / 2 + t / 2, -w / 2, -w / 2 - t / 2, -w / 2), linePath(-w / 2, -w / 2 + t / 2, -w / 2, w / 2 - t / 2)];
    let ph = 0;
    walls.forEach((p, i) => {
      const open = [];
      if (i === 0) open.push(opening(rng() < 0.5 ? 'arch' : 'rect', p.L / 2 - 0.6, 1.2, ft, 2.4));
      for (let y = ft + 3.4; y < H - 1.5; y += 3.2) if (rng() < 0.75) open.push(opening(winK, p.L / 2 - 0.3 + (rng() - 0.5) * 1.2, 0.6, y, 1.1));
      B.wall(p, { t, H, top: B.profile(H, lowF + 0.4, p.L, ph, d), ch, bl, open, fall: 0.45, bands: S.key === 'pagoda' ? [ft + Hd * 0.5] : null });
      ph += p.L;
    });
  }
  if (B.over()) yield;
  if (intact) {
    const ax = w / 2 + t / 2;
    if (S.key === 'pagoda') B.hipRoof(ax + 1.2, ax + 1.2, H, B.r(2.2, 3.2), { col: S.roofCol, up: 0.6, curve: 1.7, ridge: 0 });
    else if (S.key === 'atlantis' || (S.key === 'greco' && round)) B.dome(0, H, 0, ax, { k: S.key === 'atlantis' ? 1.6 : 0.9, ribs: S.key === 'atlantis' ? 10 : 0, ribGold: S.key === 'atlantis' });
    else if (round && S.key === 'maya') B.dome(0, H, 0, ax * 0.9, { k: 0.7 });
    else { // crenellations
      const n = Math.max(3, Math.round((round ? TAU * ax : 8 * ax) / 1.3));
      for (let i = 0; i < n; i += 2) {
        let x, z, yaw;
        if (round) { const a = i / n * TAU; x = Math.cos(a) * w / 2; z = Math.sin(a) * w / 2; yaw = -a; }
        else { const q = i / n * 4, side = q | 0, f = q - side, e = -ax + 2 * ax * f; [x, z] = side === 0 ? [e, ax - t / 2] : side === 1 ? [ax - t / 2, -e] : side === 2 ? [-e, -ax + t / 2] : [-ax + t / 2, e]; yaw = side % 2 ? Math.PI / 2 : 0; }
        B.box(0.75, 0.8, t * 0.9, x, H + 0.4, z, rotY(yaw), B.tone(B.stone, 0.06), B.lo ? 0 : 0.03, 0.03);
      }
    }
  }
  return { H, lowF, intact, w };
}

// round building: tholos (ring of columns around a cella), Atlantean dome, Maya round tower
export function* genRotunda(B, colRing) {
  const S = B.S, rng = B.rng, site = B.site;
  const R = B.r(3.2, 5.0), Rc = R + B.r(1.6, 2.2), t = B.r(0.55, 0.75);
  const ext = colRing ? Rc + 0.8 : R + 0.5;
  const [lowF] = site.range(-ext, -ext, ext, ext, 3);
  const ft = Math.max(site.fl(0, R), lowF + 0.1);
  const intact = rng() < 0.45 - B.decay * 0.35, d = intact ? 0 : B.decay;
  let ystyl = ft;
  if (colRing) { // stepped circular platform (krepis), every step down to the ground
    const ns = 3;
    ystyl = Math.max(ft, lowF + 0.3) + 0.3 * ns;
    for (let k = 0; k < ns; k++) {
      const rr = Rc + 0.8 - k * 0.45, yTop = ystyl - (ns - 1 - k) * 0.3, n = Math.max(10, Math.round(TAU * rr / 1.4));
      for (let i = 0; i < n; i++) { const a = (i + (k % 2) * 0.5) / n * TAU; B.pier(TAU * rr / n * 1.03, 0.9, Math.cos(a) * (rr - 0.45), Math.sin(a) * (rr - 0.45), yTop, rotY(-a + Math.PI / 2), B.tone(B.trim, 0.05), 0, 0.02); }
    }
  }
  const Hc = (colRing ? ystyl : ft) + B.r(4.5, 6.5);
  const p = arcPath(0, 0, R, Math.PI / 2, Math.PI / 2 + TAU), L = p.L;
  const open = [opening(S.key === 'atlantis' ? 'para' : S.key === 'greco' ? 'rect' : 'arch', 0.3, 1.4, colRing ? ystyl : ft, 2.6)];
  const winK = S.key === 'atlantis' ? 'round' : 'rect';
  for (let k = 1; k < 4; k++) if (rng() < 0.7) open.push(opening(winK, L * k / 4 - 0.4, 0.8, (colRing ? ystyl : ft) + 1.6, 1.1));
  if (B.over()) yield;
  B.wall(p, { t, H: Hc, top: B.profile(Hc, (colRing ? ystyl : lowF) + 0.4, L, 0, d, false), ch: S.ch, bl: S.bl, open, lap: t / R * 0.6 + 0.02, floor: colRing ? ystyl : null, fall: 0.4 });
  if (B.over()) yield;
  let topY = Hc;
  if (colRing) {
    const n = Math.max(8, Math.round(TAU * Rc / 2.0)), cr = B.r(0.26, 0.34), hcol = Hc - ystyl - 0.6;
    const cst = S.col === 'atlantean' ? 'atlantean' : B.pick(S.cols);
    topY = 1e9;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * TAU, x = Math.cos(a) * Rc, z = Math.sin(a) * Rc;
      const f = rng(), brk = intact ? 0 : f < d * 0.55 ? -1 : f < d ? B.r(0.25, 0.75) : 0;
      if (brk < 0) continue;
      const tp = B.column(x, ystyl, z, { style: cst, R: cr, H: hcol, broken: brk });
      if (!brk) topY = Math.min(topY, tp);
      if (i % 4 === 3 && B.over()) yield;
    }
    if (topY > 1e8) topY = Hc;
    if (intact) { // entablature ring and a conical roof / dome
      const ne = n * 2, re = Rc;
      for (let i = 0; i < ne; i++) { const a = i / ne * TAU; B.box(TAU * re / ne * 1.04, 0.55, 0.7, Math.cos(a) * re, topY + 0.27, Math.sin(a) * re, rotY(-a + Math.PI / 2), B.tone(B.trim, 0.04), 0, 0.02); }
      B.dome(0, topY + 0.5, 0, Rc + 0.4, { k: S.key === 'atlantis' ? 1.0 : 0.45, ribs: S.gold ? 12 : 0, ribGold: !!S.gold, gold: !!S.gold && rng() < 0.4 });
    }
  } else if (intact) B.dome(0, Hc, 0, R + t / 2, { k: S.key === 'atlantis' ? B.r(1.1, 1.5) : B.r(0.7, 1.0), ribs: S.gold ? 10 : 0, ribGold: !!S.gold, gold: !!S.gold && rng() < 0.3, broken: rng() < 0.5 ? B.r(0.2, 0.6) : 0 });
  return { H: topY, lowF };
}

// portico / stoa / gallery: back wall, a row of columns (or piers with arches) and a lean-to roof
export function* genStoa(B, W, D) {
  const S = B.S, rng = B.rng, site = B.site;
  const [lowF] = site.range(-W / 2, -D / 2, W / 2, D / 2, 3);
  const ft = Math.max(site.fl(0, D / 2), lowF + 0.1);
  const hcol = B.r(4.2, 5.6), t = B.r(S.t[0], S.t[1]);
  const intact = rng() < 0.3 - B.decay * 0.2, d = intact ? 0 : B.decay;
  // stylobate: a step along the colonnade line
  const sty = ft + 0.35;
  B.pier(W + 0.6, 1.4, 0, D / 2 - 0.5, sty, null, B.tone(B.trim, 0.05), 0, 0.02);
  const H = sty + hcol + 0.6;
  const back = linePath(W / 2 + t / 2, -D / 2, -W / 2 - t / 2, -D / 2);
  const open = [];
  if (S.key === 'khmer') for (const u of rowOf(back.L, 0.9, 1.4, 1.0)) open.push(opening('balust', u, 0.9, ft + 1.0, 1.4));
  B.wall(back, { t, H, top: B.profile(H, lowF + 0.4, back.L, 0, d), ch: S.ch, bl: S.bl, open, fall: 0.4 });
  if (B.over()) yield;
  for (const sx of [-1, 1]) { const p = linePath(sx * W / 2, -D / 2 + t / 2, sx * W / 2, D / 2 - 1.2); B.wall(p, { t, H: H - 0.3, top: B.profile(H - 0.3, lowF + 0.4, p.L, sx * 9, Math.min(1, d + 0.15)), ch: S.ch, bl: S.bl, fall: 0.3 }); }
  const n = Math.max(3, Math.round(W / B.r(2.6, 3.4))), cr = B.r(0.25, 0.34), cstyle = S.key === 'greco' ? B.pick(S.cols) : S.col;
  let topY = 1e9;
  const tops = [];
  for (let i = 0; i <= n; i++) {
    const x = -W / 2 + 0.3 + i * (W - 0.6) / n, f = rng();
    const brk = intact ? 0 : f < d * 0.5 ? -1 : f < d * 0.95 ? B.r(0.2, 0.8) : 0;
    tops.push(0);
    if (brk < 0) continue;
    const tp = B.column(x, sty, D / 2 - 0.5, { style: cstyle, R: cr, H: hcol, broken: brk });
    if (!brk) { tops[i] = tp; topY = Math.min(topY, tp); }
    if (i % 4 === 3 && B.over()) yield;
  }
  if (topY > 1e8) topY = sty + hcol;
  // architrave beams wherever two neighbouring columns still stand (resting on the lower capital)
  for (let i = 0; i < n; i++) if (tops[i] && tops[i + 1]) {
    const x0 = -W / 2 + 0.3 + i * (W - 0.6) / n, x1 = -W / 2 + 0.3 + (i + 1) * (W - 0.6) / n, y = Math.min(tops[i], tops[i + 1]);
    B.box(x1 - x0 + 0.5, 0.55, 0.75, (x0 + x1) / 2, y + 0.27, D / 2 - 0.5, null, B.tone(B.trim, 0.04), B.lo ? 0 : 0.03, 0.02);
  }
  if (intact) {
    B.surf(4, 1, (u, v, out) => { out[0] = lerp(-W / 2 - 0.4, W / 2 + 0.4, u); out[2] = lerp(D / 2 + 0.2, -D / 2, v); out[1] = topY + 0.55 + v * 1.4; }, S.roofCol || TERRACOTTA, { th: 0.2 });
    B.cap(-W / 2 + 1, topY + 1.2, 0, W / 2 - 1, topY + 1.2, 0, Math.min(D / 2, 1.6));
  }
  return { H: topY, lowF };
}

// small shrine / chapel, in the style of the city
export function* genShrine(B) {
  const S = B.S, rng = B.rng, site = B.site, k = S.key;
  if (k === 'greco' || k === 'atlantis' || k === 'minoan') { // prostyle temple: porch columns + cella on a podium
    const W = B.r(5.5, 7.5), D = B.r(7.5, 10), [lowF] = site.range(-W / 2 - 1, -D / 2 - 1, W / 2 + 1, D / 2 + 1, 3);
    const pod = Math.max(site.fl(0, D / 2 + 0.6), lowF) + B.r(0.9, 1.6);
    for (let i = 0; i < 3; i++) { const w = W + 1.6 - i * 0.5, dd = D + 1.6 - i * 0.5; B.pier(w, dd, 0, 0, pod - (2 - i) * 0.3, null, B.tone(B.trim, 0.05), B.lo ? 0 : 0.03, 0.02); }
    const intact = rng() < 0.35 - B.decay * 0.25, d = intact ? 0 : B.decay;
    const H = pod + B.r(4.5, 5.5), t = 0.6, cz = -D * 0.12, cd = D * 0.7;
    const walls = [linePath(W / 2, cz + cd / 2, W / 2, cz - cd / 2), linePath(W / 2 + t / 2, cz - cd / 2, -W / 2 - t / 2, cz - cd / 2), linePath(-W / 2, cz - cd / 2, -W / 2, cz + cd / 2), linePath(-W / 2 - t / 2, cz + cd / 2, W / 2 + t / 2, cz + cd / 2)];
    let ph = 0;
    walls.forEach((p, i) => {
      const open = i === 3 ? [opening(k === 'atlantis' ? 'para' : 'rect', p.L / 2 - 0.8, 1.6, pod, 3.0)] : [];
      B.wall(p, { t, H, top: B.profile(H, pod + 0.3, p.L, ph, d), ch: S.ch, bl: S.bl, open, floor: pod, fall: 0.35 });
      ph += p.L;
    });
    if (B.over()) yield;
    const nc = 4, cr = 0.32, hc = H - pod - 0.7, cst = k === 'atlantis' ? 'atlantean' : k === 'minoan' ? 'minoan' : B.pick(S.cols);
    let top = 1e9;
    const stand = [];
    for (let i = 0; i < nc; i++) {
      const x = -W / 2 + 0.4 + i * (W - 0.8) / (nc - 1), f = rng(), brk = intact ? 0 : f < d * 0.4 ? -1 : f < d ? B.r(0.25, 0.8) : 0;
      stand.push(brk === 0);
      if (brk >= 0) { const tp = B.column(x, pod, D / 2 - 0.2, { style: cst, R: cr, H: hc, broken: brk }); if (!brk) top = Math.min(top, tp); }
    }
    if (top > 1e8) top = H;
    if (intact) {
      B.box(W + 0.8, 0.6, D + 0.4, 0, top + 0.3, 0, null, B.tone(B.trim, 0.04), 0, 0.02);
      if (k === 'minoan') hornsRow(B, W / 2, D / 2, top + 0.6);
      else { // pediment facing the street: the ridge runs front to back
        const m = B.mark();
        B.gableRoof(D / 2 + 0.3, W / 2 + 0.4, top + 0.6, 1.6, { col: k === 'atlantis' ? [0.7, 0.5, 0.22] : TERRACOTTA, pediment: true });
        B.turn(m, Math.PI / 2);
      }
    } else for (let i = 0; i < nc - 1; i++) if (stand[i] && stand[i + 1]) { const x0 = -W / 2 + 0.4 + i * (W - 0.8) / (nc - 1), x1 = x0 + (W - 0.8) / (nc - 1); B.box(x1 - x0 + 0.5, 0.5, 0.7, (x0 + x1) / 2, top + 0.25, D / 2 - 0.2, null, B.tone(B.trim, 0.04), 0, 0.02); }
    return { H: top };
  }
  if (k === 'egypt') { // naos-like chapel with battered walls, cavetto cornice and a torus moulding
    const W = B.r(4.5, 6), D = B.r(5, 7), r = yield* rectBuilding(B, { W, D, n: 1, hs: B.r(3.6, 4.4), intact: rng() < 0.5, doorKind: 'rect', winKind: 'rect', partition: false, parapet: 0.3 });
    if (r.d < 0.15) roofOn(B, 'flat', W, D, r.t, r.H);
    return r;
  }
  if (k === 'maya' || k === 'khmer') { // small temple on a stepped platform with a stair to the street
    const w = B.r(7, 10), [lowF] = site.range(-w / 2, -w / 2, w / 2, w / 2 + 2.5, 3), tiers = 2 + ((rng() * 3) | 0), th = B.r(0.9, 1.3);
    let y = Math.max(lowF, site.fl(0, w / 2)) - 0.1;
    for (let i = 0; i < tiers; i++) { y += th; const ww = w * (1 - i * 0.16); B.pier(ww, ww, 0, 0, y, null, B.tone(B.stone, 0.06), 0, 0.03); if (k === 'maya') B.box(ww + 0.12, 0.3, ww + 0.12, 0, y - 0.15, 0, null, B.tone(B.trim, 0.06), 0, 0.02); }
    stair(B, 0, w / 2, y, 2.4, 0);
    const W = w * (1 - (tiers - 1) * 0.16) * 0.62, D = W * B.r(0.7, 0.95);
    const H = y + B.r(2.8, 3.6), t = 0.6, intact = rng() < 0.45 - B.decay * 0.3, d = intact ? 0 : B.decay;
    const walls = [linePath(-W / 2 - t / 2, D / 2, W / 2 + t / 2, D / 2), linePath(W / 2, D / 2 - t / 2, W / 2, -D / 2 + t / 2), linePath(W / 2 + t / 2, -D / 2, -W / 2 - t / 2, -D / 2), linePath(-W / 2, -D / 2 + t / 2, -W / 2, D / 2 - t / 2)];
    let ph = 0;
    walls.forEach((p, i) => {
      const open = i === 0 ? [opening(k === 'maya' ? 'corbel' : 'rect', p.L / 2 - 0.65, 1.3, y, 2.4)] : [];
      B.wall(p, { t, H, top: B.profile(H, y + 0.3, p.L, ph, d), ch: S.ch, bl: S.bl, open, floor: y, fall: 0.25 });
      ph += p.L;
    });
    if (intact) {
      if (k === 'maya') roofOn(B, 'flat', W, D, t, H, { comb: true });
      else prangTop(B, 0, H, 0, W / 2 + 0.3, B.r(3, 4.5));
    }
    return { H };
  }
  if (k === 'pagoda') return yield* genPavilion(B);
  return null;
}

// a monumental stair (blocks stepping down from yTop toward +z, every step reaching the ground)
export function stair(B, x, z0, yTop, w, yaw, rise = 0.32, run = 0.42) {
  const R = rotY(yaw), c = B.tone(B.trim, 0.05);
  let y = yTop, z = z0;
  for (let k = 0; k < 60; k++) {
    const lx = x + R[2] * (z + run / 2), lz = R[8] * (z + run / 2);
    const fl = B.minFloor(w, run, lx, lz, R);
    if (y < fl + 0.05) break;
    B.pier(w, run, lx, lz, y, R, B.tone(c, 0.04), B.lo ? 0 : 0.02, 0.015, 0.2);
    y -= rise; z += run;
  }
  return z;
}

// Khmer prang top: stacked receding tiers with redented corners and a lotus-bud finial
export function prangTop(B, x, y, z, R, H) {
  const tiers = 4 + ((B.rng() * 2) | 0), c = B.tone(B.stone, 0.05);
  const red = (a) => { const s = Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)); return 0.82 + 0.1 * Math.abs(Math.cos(a * 4)) + 0.08 * (s - 1); };
  B.lathe(B.lo ? 12 : 16, tiers * 2, (v) => {
    const k = Math.floor(v * tiers), f = v * tiers - k, rr = R * (1 - 0.75 * Math.pow(v, 1.3)) * (f < 0.35 ? 1.06 : 0.97);
    return [rr, y + v * H];
  }, red, c, B.grow, B.key, x, 0, z);
  B.lathe(B.lo ? 8 : 10, 4, (v) => [R * 0.28 * Math.sin(Math.PI * (0.15 + 0.85 * v)) * (1 - v * 0.3), y + H + v * R * 0.9], null, c, B.grow, B.key, x, 0, z);
  B.cap(x, y + H * 0.3, z, x, y + H * 0.8, z, R * 0.85);
}

// East Asian pavilion: hexagonal / square, columns on a platform, pyramidal curved roof
export function* genPavilion(B) {
  const S = B.S, rng = B.rng, site = B.site;
  const n = rng() < 0.6 ? 6 : 4, R = B.r(2.6, 3.6);
  const [lowF] = site.range(-R - 1, -R - 1, R + 1, R + 1, 3);
  const ft = Math.max(site.fl(0, R), lowF) + B.r(0.5, 0.9);
  const nb = Math.max(n * 2, Math.round(TAU * (R + 0.6) / 1.4));
  for (let i = 0; i < nb; i++) { const a = (i + 0.5) / nb * TAU; B.pier(TAU * (R + 0.6) / nb * 1.04, 1.4, Math.cos(a) * (R + 0.1), Math.sin(a) * (R + 0.1), ft, rotY(-a + Math.PI / 2), B.tone(B.trim, 0.05), 0, 0.02); }
  B.pier(2 * R * 0.8, 2 * R * 0.8, 0, 0, ft, null, B.tone(B.trim, 0.05), 0, 0.02);
  const intact = rng() < 0.55 - B.decay * 0.35, hc = B.r(3.0, 3.8);
  let top = ft + hc;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * TAU, x = Math.cos(a) * R * 0.92, z = Math.sin(a) * R * 0.92;
    const brk = intact ? 0 : rng() < B.decay * 0.6 ? B.r(0.2, 0.7) : 0;
    top = Math.max(top, B.column(x, ft, z, { style: 'pagoda', R: 0.2, H: hc, broken: brk, col: [0.36, 0.11, 0.07] }) - 0.45);
    pts.push(brk === 0);
  }
  if (intact) {
    const rr = R * 0.92 + 1.3, h = B.r(1.8, 2.6), y = ft + hc + 0.3;
    for (let f = 0; f < n; f++) {
      const a0 = (f + 0.5) / n * TAU, a1 = (f + 1.5) / n * TAU;
      B.surf(B.lo ? 4 : 7, B.lo ? 3 : 5, (s, v, out) => {
        const cx = lerp(Math.cos(a0), Math.cos(a1), s) * rr, cz = lerp(Math.sin(a0), Math.sin(a1), s) * rr;
        out[0] = cx * (1 - v); out[2] = cz * (1 - v);
        out[1] = y + h * Math.pow(v, 1.7) + 0.55 * Math.pow(Math.abs(2 * s - 1), 5) * (1 - v) * (1 - v);
      }, S.roofCol, { th: 0.15 });
    }
    B.lathe(8, 3, (v) => [0.22 * (1 - v * 0.7), y + h - 0.1 + v * 1.1], null, [0.72, 0.5, 0.2], 0, GOLD_MODE);
    B.cap(0, y + h * 0.35, 0, 0, y + h * 0.35, 0, rr * 0.75);
  }
  return { H: top };
}
