// Sunken-city landmarks, plaza monuments, temples and big set pieces, in the vocabulary of each style.
// Local frame as for buildings: x along the street, +z toward the street (the front), y up from the site.
import { T, TAU, lerp, rotY, rotX, rotZ, mul3 } from './core.js';
import { linePath, arcPath, scale3, GOLD_MODE } from './ruins_kit.js';
import { genRect, genRotunda, genTower, genStoa, genShrine, genPavilion, rectBuilding, prangTop, stair, horns } from './ruins_bld.js';
import { makeStatue } from './statues.js';

const GOLD = [0.75, 0.52, 0.22], BRONZE = [0.2, 0.36, 0.3];

// statue templates of a style (falls back to any), picked by the builder's rng
// Statues per kind, generated lazily for the cities that need them (statueSteps) and kept for the session
// (at most PER_KIND variants of each of the ~26 kinds). 'head' means the colossal Olmec-style heads.
const STATUES = new Map(), PER_KIND = 3;
export function statueSteps(kinds, out, seed = 1) {
  for (const k of kinds) {
    if (k === 'head') continue;
    const have = STATUES.get(k) || [];
    for (let i = have.length; i < PER_KIND; i++) out.push(() => {
      const list = STATUES.get(k) || [];
      if (list.length >= PER_KIND) return;
      list.push(makeStatue(k, (seed * 31 + list.length * 977 + k.length * 131) | 0));
      STATUES.set(k, list);
    });
  }
  return out;
}
export function figs(kinds) {
  const out = [];
  for (const k of kinds) { if (k === 'head') { if (T.head) out.push(...T.head); continue; } const c = STATUES.get(k); if (c) out.push(...c); }
  if (out.length) return out;
  const all = T.figure || [], f = all.filter((t) => kinds.includes(t.style)); // startup set while a city's own are made
  return f.length ? f : all;
}
// the statue kinds a city of style S uses (its statuary, monuments and landmarks)
const EXTRA = { greco: ['roman', 'orator', 'bronze', 'poseidon'], egypt: ['pharaoh', 'hapi', 'queen', 'sphinx', 'striding'], maya: ['chacmool', 'jaguar', 'serpent'],
  khmer: ['lion', 'buddha', 'dvarapala'], minoan: ['bull', 'snakegoddess'], pagoda: ['lion', 'buddha', 'guardian'], atlantis: ['poseidon', 'triton', 'seahorse'] };
export const statueKinds = (S) => [...new Set([...S.statues, ...(EXTRA[S.key] || [])])];
const hOf = (t) => t.box[4] - t.box[1];

// a statue embedded in a structure, standing at (x, y, z) facing +z (yaw), scaled to height h
function statueOn(B, list, x, y, z, h, yaw = 0, tint = null) {
  if (!list.length) return 0;
  const t = B.pick(list), s = h / Math.max(0.3, hOf(t));
  B.addTpl(t, rotY(yaw), x, y - 0.05 * s, z, s, t.bronze ? null : tint);
  B.cap(x, y + h * 0.3, z, x, y + h * 0.75, z, Math.max(t.box[3] - t.box[0], t.box[5] - t.box[2]) * s * 0.5 + 0.1);
  return t;
}
// pedestal / plinth (stepped, down into the ground) with its top at yTop
function pedestal(B, x, z, w, yTop, steps = 2) {
  const c = B.tone(B.trim, 0.04);
  for (let k = 0; k < steps; k++) B.pier(w + (steps - 1 - k) * 0.5, w + (steps - 1 - k) * 0.5, x, z, yTop - (steps - 1 - k) * 0.3, null, B.tone(c, 0.03), B.lo ? 0 : 0.04, 0.02);
  B.boxCaps(x, z, w, w, B.minFloor(w, w, x, z, null), yTop);
}
const ground = (B, x, z, w = 1) => B.minFloor(w, w, x, z, null);

// ---------- obelisk ----------
function obelisk(B, x, z, H, o = {}) {
  const W = H * 0.09, base = ground(B, x, z, W * 2.4) - 0.2, y0 = base + 0.5 + (o.base ?? 0.6);
  B.pier(W * 2.4, W * 2.4, x, z, y0, null, B.tone(B.trim, 0.04), 0.04, 0.02);
  const col = o.col || B.tone([0.5, 0.28, 0.23], 0.05), m = B.mark(), v0 = m[0];
  B.lathe(4, 6, (v) => (v < 0.92 ? [W * 0.7071 * (1 - 0.3 * v / 0.92), y0 + v * H] : [W * 0.7071 * 0.7 * (1 - v) / 0.08, y0 + v * H]), null,
    (v) => (v > 0.92 && o.gold ? GOLD : col), B.grow * 0.6, B.key, x, 0, z);
  B.turn(m, Math.PI / 4, x, z);
  if (o.gold) for (let i = v0; i < B.b.vc; i++) if (B.b.P[i * 3 + 1] > y0 + H * 0.9) { B.b.F[i * 2 + 1] = GOLD_MODE; B.b.F[i * 2] = 0; }
  B.cap(x, y0 + W, z, x, y0 + H * 0.92, z, W * 0.75 + 0.1);
  return y0 + H;
}
// a toppled obelisk in three pieces
function fallenObelisk(B, x, z, H, yaw) {
  const W = H * 0.09, R = rotY(yaw), col = B.tone([0.5, 0.28, 0.23], 0.05);
  let d = 0;
  for (let k = 0; k < 3; k++) {
    const L = H * (k === 2 ? 0.24 : 0.36), w = W * (1 - 0.3 * (d + L / 2) / H);
    const cx = x + R[0] * (d + L / 2), cz = z + R[6] * (d + L / 2);
    const fl = B.minFloor(L, w, cx, cz, R);
    B.box(L, w, w, cx, fl + w / 2 - 0.12, cz, mul3(R, rotX(0.05 * k)), col, 0.03, 0.03);
    B.cap(x + R[0] * d, fl + w / 2, z + R[6] * d, x + R[0] * (d + L), fl + w / 2, z + R[6] * (d + L), w * 0.72);
    d += L + 0.3 + B.rng() * 0.6;
  }
}

// ---------- landmarks ----------
export function* genLandmark(B, kind) {
  const S = B.S, rng = B.rng, site = B.site;
  const label = { lighthouse: 'Lighthouse', colossus: 'Colossus', victoryCol: 'Victory column', obeliskPair: 'Obelisks', colossusPair: 'Colossi', pyramid: 'Pyramid',
    stelaGroup: 'Stelae', observatory: 'Observatory', head: 'Colossal head', faceTower: 'Face tower', prang: 'Prang tower', buddha: 'Colossal Buddha', horns: 'Horns of consecration',
    bull: 'Bronze bull', labrys: 'Double axe (labrys)', pagoda: 'Pagoda', bellTower: 'Bell tower', lionPair: 'Guardian lions', spiralTower: 'Spiral tower', trident: 'Trident of Poseidon', nautilus: 'Nautilus sculpture', tholos: 'Round temple (tholos)' }[kind] || 'Monument';
  const facts = {
    lighthouse: 'The Pharos of Alexandria stood over 100 m tall; its blocks now lie on the harbour floor.',
    colossus: 'The Colossus of Rhodes, a 33 m bronze sun god, stood for only 54 years before an earthquake toppled it.',
    victoryCol: 'Trajan\'s Column in Rome is wrapped in a 190 m spiral frieze of his wars.',
    obeliskPair: 'Obelisks were cut from a single block of granite; the tallest ancient one still standing is about 32 m.',
    colossusPair: 'At sunken Heracleion, divers raised 5 m granite statues of a king, a queen and the Nile god Hapi.',
    pyramid: 'The Great Pyramid was once cased in polished white limestone that shone in the sun.',
    stelaGroup: 'Maya stelae record kings, dates and wars in a calendar that counted days from 3114 BC.',
    observatory: 'The round Caracol of Chichen Itza has windows aligned with the setting points of Venus.',
    head: 'The largest Olmec colossal heads weigh about 40 tonnes, each carved from a single boulder.',
    faceTower: 'The Bayon temple has over 200 serene stone faces gazing out from its towers.',
    prang: 'Khmer temple towers are shaped like lotus buds and stand for the peaks of Mount Meru.',
    buddha: 'The naga king Mucalinda spread his hoods to shelter the meditating Buddha from a storm.',
    horns: 'Stone "horns of consecration", probably bull horns, crowned Minoan shrines.',
    bull: 'Minoan frescoes show acrobats somersaulting over the backs of charging bulls.',
    labrys: 'The double axe was a sacred Minoan symbol; "labyrinth" may mean "house of the double axe".',
    pagoda: 'Pagodas began as Indian stupas built to hold relics of the Buddha.',
    bellTower: 'Bell towers once marked the hours, opening and closing the city gates.',
    lionPair: 'Guardian lions come in pairs: the male rests a paw on a ball, the female on a cub.',
    spiralTower: 'Plato described Atlantis as rings of land and water around a central island.',
    trident: 'The Greeks called Poseidon the Earth-shaker: his trident could raise storms and earthquakes.',
    nautilus: 'A nautilus adds a new, larger chamber to its spiral shell as it grows.',
    tholos: 'A tholos is a round temple ringed by columns; the most famous stands at Delphi.',
  };
  const out = { label, fact: facts[kind] || null, poi: 'giant', h: 6 };
  if (kind === 'lighthouse') {
    const w = B.r(7.5, 9), fl = ground(B, 0, 0, w), t = 1.0;
    let y = fl + B.r(7, 9.5);
    const d1 = Math.min(1, B.decay * 0.7), tiers = rng() < 0.45 + B.decay * 0.4 ? 1 + (rng() < 0.5 ? 1 : 0) : 3;
    const sq = [linePath(-w / 2 - t / 2, w / 2, w / 2 + t / 2, w / 2), linePath(w / 2, w / 2 - t / 2, w / 2, -w / 2 + t / 2), linePath(w / 2 + t / 2, -w / 2, -w / 2 - t / 2, -w / 2), linePath(-w / 2, -w / 2 + t / 2, -w / 2, w / 2 - t / 2)];
    let ph = 0;
    for (let i = 0; i < 4; i++) { const p = sq[i]; B.wall(p, { t, H: y, top: tiers > 1 ? () => y : B.profile(y, fl + 1, p.L, ph, d1), ch: S.ch, bl: S.bl, open: i === 0 ? [{ kind: 'arch', u0: p.L / 2 - 0.8, u1: p.L / 2 + 0.8, v0: fl, v1: fl + 3.2 }] : [{ kind: 'rect', u0: p.L / 2 - 0.3, u1: p.L / 2 + 0.3, v0: y - 3, v1: y - 1.8 }], fall: 0.4 }); ph += p.L; if (B.over()) yield; }
    if (tiers >= 2) { // octagonal middle tier on the base's cornice slab (only on intact base walls)
      B.box(w + t + 0.8, 0.5, w + t + 0.8, 0, y + 0.24, 0, null, B.tone(B.trim, 0.04), 0.04, 0.02);
      const R = w * 0.36, y0 = y + 0.5, H2 = y0 + B.r(5, 7);
      for (let k = 0; k < 8; k++) { const a0 = (k + 0.5) / 8 * TAU, a1 = (k + 1.5) / 8 * TAU, p = linePath(Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R); B.wall(p, { t: 0.7, H: H2, top: tiers > 2 ? () => H2 : B.profile(H2, y0 + 0.5, p.L, k * 3, d1), ch: S.ch, bl: S.bl, floor: y0, open: k % 2 ? [{ kind: 'rect', u0: p.L / 2 - 0.25, u1: p.L / 2 + 0.25, v0: y0 + 2.4, v1: y0 + 3.4 }] : [], fall: 0.3 }); if (B.over()) yield; }
      y = H2;
      if (tiers === 3) B.box(R * 2 + 1.2, 0.4, R * 2 + 1.2, 0, y + 0.19, 0, null, B.tone(B.trim, 0.04), 0.04, 0.02); // on intact walls only
      if (tiers === 3) { // round lantern tier with a dome (short blocks follow the small circle, so the dome's ring is carried)
        const R3 = R * 0.62, y1 = y + 0.4, H3 = y1 + B.r(3.5, 4.5);
        B.wall(arcPath(0, 0, R3, 0, TAU), { t: 0.55, H: H3, ch: S.ch, bl: [0.45, 0.6], floor: y1, lap: 0.55 / R3 * 0.6 + 0.02, open: [0, 1, 2, 3].map((k) => ({ kind: 'arch', u0: R3 * (k * Math.PI / 2 + 0.3), u1: R3 * (k * Math.PI / 2 + 0.3) + 0.8, v0: y1 + 0.8, v1: y1 + 2.6 })), fall: 0.2 });
        B.domeOn(0, H3, 0, R3 + 0.3, { k: 0.9 });
        y = H3 + R3;
        if (S.key === 'greco' || S.key === 'egypt') statueOn(B, figs(S.statues), 0, y - 0.1, 0, 3.2, 0, S.key === 'greco' ? [0.5, 0.75, 0.6] : null);
      }
    }
    out.h = y - fl;
  } else if (kind === 'colossus' || kind === 'buddha') {
    const list = figs(kind === 'buddha' ? ['buddha'] : S.key === 'atlantis' ? ['poseidon', 'triton'] : S.statues.filter((s) => s !== 'fragment' && s !== 'sphinx'));
    const fallen = kind === 'colossus' && rng() < 0.3 && list.length > 0;
    const h = kind === 'buddha' ? B.r(5.5, 8) : B.r(7, 10), pw = kind === 'buddha' ? h * 0.7 : B.r(2.6, 3.6), top = ground(B, 0, 0, pw) + B.r(1.6, 2.6);
    pedestal(B, 0, 0, pw, top, 3);
    if (kind === 'buddha') B.lathe(B.lo ? 12 : 18, 3, (v) => [pw * 0.55 * (0.8 + 0.35 * Math.sin(v * Math.PI * 0.5)), top + v * 0.7], (a) => 1 + 0.08 * Math.abs(Math.cos(a * 8)), B.tone(B.trim, 0.04)); // lotus seat
    if (fallen) { // toppled beside its pedestal, face up (only the feet still stand)
      const t = B.pick(list), s = h / hOf(t), yaw = rng() * TAU, R = mul3(rotY(yaw), rotX(-Math.PI / 2));
      const dx = Math.cos(yaw) * (pw / 2 + 1), dz = -Math.sin(yaw) * (pw / 2 + 1);
      const depth = (t.box[5] - t.box[2]) * s;
      B.addTpl(t, R, dx, B.seatTpl(t, R, dx, dz, s) - 0.15, dz, s); // half sunk in the silt
      B.cap(dx, ground(B, dx, dz) + depth * 0.4, dz, dx - Math.sin(yaw) * h * 0.85, ground(B, dx, dz) + depth * 0.4, dz - Math.cos(yaw) * h * 0.85, depth * 0.55);
      out.label = 'Fallen colossus'; out.h = depth + 2;
    } else { statueOn(B, list, 0, top + (kind === 'buddha' ? 0.6 : 0), 0, h, 0, null); out.h = top + h - ground(B, 0, 0); }
  } else if (kind === 'victoryCol') {
    const pw = B.r(3, 3.8), top = ground(B, 0, 0, pw) + B.r(2.6, 3.4), R = B.r(0.95, 1.2), H = B.r(13, 17);
    pedestal(B, 0, 0, pw, top, 2);
    const brk = rng() < B.decay * 0.6 ? B.r(0.35, 0.75) : 0;
    const ctop = B.column(0, top, 0, { style: 'tuscan', R, H, broken: brk });
    if (!B.lo) { // the spiral frieze band
      const pts = [], hh = (brk ? H * brk : H) - 0.6, turns = hh / 1.9;
      for (let k = 0; k <= turns * 10; k++) { const a = k / 10 * TAU, y = top + 0.5 + k / 10 * 1.9; if (y > top + hh) break; pts.push([Math.cos(a) * R * 1.02, y, Math.sin(a) * R * 1.02]); }
      if (pts.length > 2) B.tube(pts, pts.map(() => 0.1), 4, B.tone(B.trim, 0.05), false);
    }
    if (!brk) statueOn(B, figs(['roman', 'orator', 'bronze']), 0, ctop, 0, 3, 0);
    out.h = (brk ? H * brk : H + 3) + top;
  } else if (kind === 'tholos') { yield* genRotunda(B, true); out.poi = 'statue'; }
  else if (kind === 'obeliskPair' || kind === 'obelisk') {
    const H = B.r(9, 14), gold = rng() < 0.4;
    for (const sx of kind === 'obelisk' ? [0] : [-1, 1]) {
      if (kind === 'obeliskPair' && sx > 0 && rng() < B.decay * 0.7) fallenObelisk(B, 3.4, 0.5, H * 0.95, rng() * TAU);
      else obelisk(B, sx * 3.4, 0, H * (0.92 + rng() * 0.1), { gold });
    }
    out.h = H + 1; out.label = kind === 'obelisk' ? 'Obelisk' : 'Obelisks';
  } else if (kind === 'colossusPair' || kind === 'lionPair') {
    const lion = kind === 'lionPair', list = figs(lion ? ['lion'] : ['pharaoh', 'hapi', 'queen']);
    for (const sx of [-1, 1]) {
      const h = lion ? B.r(2.0, 2.8) : B.r(5.5, 7.5), pw = lion ? 1.8 : 3.0, top = ground(B, sx * 3.4, 0, pw) + (lion ? 1.4 : 1.1);
      pedestal(B, sx * 3.4, 0, pw, top, lion ? 2 : 1);
      if (!lion && rng() < B.decay * 0.5) continue; // one has fallen away
      statueOn(B, list, sx * 3.4, top, 0, h, lion ? sx * 0.15 : 0);
    }
    out.h = lion ? 4 : 8; out.poi = lion ? 'statue' : 'giant';
  } else if (kind === 'pyramid') {
    const base = B.r(14, 19), tiers = 6 + ((rng() * 4) | 0), th = B.r(1.1, 1.5), fl = B.site.range(-base / 2, -base / 2, base / 2, base / 2, 3)[0];
    let y = fl - 0.3;
    for (let k = 0; k < tiers; k++) {
      const w = base * (1 - k / (tiers + 0.6)), y1 = y + th;
      for (const [x, z, ww, dd] of [[0, w / 2 - 0.6, w, 1.2], [0, -w / 2 + 0.6, w, 1.2], [w / 2 - 0.6, 0, 1.2, w - 2.4], [-w / 2 + 0.6, 0, 1.2, w - 2.4]]) B.pier(ww, dd, x, z, y1, null, B.tone(B.stone, 0.06), 0, 0.04);
      if (k > 0) B.box(w - 2.2, 0.4, w - 2.2, 0, y1 - 0.2, 0, null, B.tone(B.stone, 0.06), 0, 0.02);
      y = y1;
      if (B.over()) yield;
    }
    if (S.key === 'egypt') { // remnants of the smooth limestone casing on the lower faces
      for (let f = 0; f < 4; f++) { const m = B.mark(); B.prism([[-base / 2, 0], [base / 2, 0], [base * 0.32, base * 0.18 * 1.3], [-base * 0.32, base * 0.18 * 1.3]], 0.3, 0, fl - 0.3, base / 2 - base * 0.18 * 0.65, rotX(-0.9), B.tone([0.82, 0.78, 0.68], 0.03)); B.turn(m, f * Math.PI / 2); }
    } else stair(B, 0, base / 2 - 0.4, y, 3.4, 0, th / 3.2, 0.42);
    B.boxCaps(0, 0, base * 0.75, base * 0.75, fl, y - th);
    B.cap(0, y - th * 1.5, 0, 0, y, 0, base * 0.3);
    out.h = y - fl; out.label = S.key === 'egypt' ? 'Step pyramid' : 'Temple pyramid';
  } else if (kind === 'stelaGroup' || kind === 'stela') {
    const n = kind === 'stela' ? 1 : 3 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? 0 : (k - (n - 1) / 2) * B.r(2.2, 3), z = (rng() - 0.5) * 1.5, h = B.r(2.6, 4.2), yaw = (rng() - 0.5) * 0.3;
      if (rng() < B.decay * 0.35) { const fl = ground(B, x, z, 1.2); B.box(0.95, 0.5, h, x, fl + 0.13, z - h / 2 + 0.5, rotY(yaw), B.tone(B.stone, 0.05), 0.04, 0.04); continue; } // fallen
      const fl = ground(B, x, z, 1.2) - 0.35, R = mul3(rotY(yaw), rotZ((rng() - 0.5) * 0.08));
      B.box(0.95, h + 0.35, 0.5, x, fl + (h + 0.35) / 2, z, R, B.tone(B.stone, 0.05), 0.05, 0.04);
      if (!B.lo) for (let q = 0; q < 5; q++) B.box(0.75, 0.42, 0.06, x, fl + 0.8 + q * h / 5.5, z + 0.26, R, B.tone(scale3(B.stone, 0.75), 0.08), 0.02, 0.03); // glyph panels
      B.cap(x, fl + 0.6, z, x, fl + h, z, 0.62);
      const az = z + 1.3, afl = ground(B, x, az, 1.4) - 0.2; // round altar
      B.lathe(B.lo ? 10 : 14, 1, (v) => [0.7 * (1 - 0.05 * v), afl + v * 0.85], null, B.tone(B.trim, 0.05), B.grow, B.key, x, 0, az);
    }
    out.h = 4; out.poi = 'statue'; out.label = n === 1 ? 'Stela' : 'Stelae';
  } else if (kind === 'observatory') {
    const fl = ground(B, 0, 0, 12);
    let y = fl - 0.2;
    for (let k = 0; k < 2; k++) { y += 1.6; const w = 12 - k * 3.5; for (const [x, z, ww, dd] of [[0, w / 2 - 0.6, w, 1.2], [0, -w / 2 + 0.6, w, 1.2], [w / 2 - 0.6, 0, 1.2, w - 2.4], [-w / 2 + 0.6, 0, 1.2, w - 2.4]]) B.pier(ww, dd, x, z, y, null, B.tone(B.stone, 0.06), 0, 0.03); B.box(w - 2.3, 0.4, w - 2.3, 0, y - 0.2, 0, null, B.tone(B.stone, 0.05), 0, 0.02); }
    stair(B, 0, 6 - 0.4, y, 2.6, 0);
    const R = 2.6, H = y + B.r(5, 6.5), keep = B.decay < 0.5 && rng() < 0.85 - B.decay; // the dome needs the whole drum
    B.wall(arcPath(0, 0, R, Math.PI / 2, Math.PI / 2 + TAU), { t: 0.75, H, top: B.profile(H, y + 1, TAU * R, 0, keep ? 0 : B.decay * 0.8, false), ch: S.ch, bl: S.bl, floor: y, lap: 0.75 / R * 0.6 + 0.02, open: [{ kind: 'corbel', u0: 0.2, u1: 1.4, v0: y, v1: y + 2.6 }, { kind: 'rect', u0: R * 2.2, u1: R * 2.2 + 0.4, v0: H - 1.6, v1: H - 0.9 }, { kind: 'rect', u0: R * 4.0, u1: R * 4.0 + 0.4, v0: H - 1.6, v1: H - 0.9 }], fall: 0.35 });
    const dO = { k: 0.75, broken: B.r(0.3, 0.7) };
    if (keep) B.domeOn(0, H, 0, R + 0.375, { ...dO, fallen: { floor: () => y, rIn: R - 0.375 } });
    else B.fallenDome(0, 0, R + 0.375, dO.k, { floor: () => y, rIn: R - 0.375 }, dO);
    out.h = H - fl + 2;
  } else if (kind === 'head') {
    const list = T.head || [], t = list.length ? B.pick(list) : null;
    if (t) { const s = B.r(2.2, 3.2), fl = ground(B, 0, 0, 2.5) - 0.3 * s; B.addTpl(t, rotY((rng() - 0.5) * 0.5), 0, fl, 0, s); B.cap(0, fl + 0.9 * s, 0, 0, fl + 1.2 * s, 0, 0.7 * s); out.h = 1.7 * s; }
    out.label = 'Colossal stone head';
  } else if (kind === 'faceTower' || kind === 'prang' || kind === 'prasatSmall') {
    const w = kind === 'prasatSmall' ? B.r(3.6, 4.4) : B.r(5, 6.2), fl = ground(B, 0, 0, w + 3);
    const base = fl + B.r(1.2, 2.2);
    for (let k = 0; k < 3; k++) B.pier(w + 3 - k, w + 3 - k, 0, 0, base - (2 - k) * (base - fl) / 3, null, B.tone(B.stone, 0.06), 0, 0.03);
    const H = base + (kind === 'prasatSmall' ? B.r(3, 4) : B.r(5, 7)), t = 0.8;
    const crown = B.decay < 0.75 && rng() < 1.05 - B.decay; // the crown needs the whole top of the tower walls
    const ws = [linePath(-w / 2 - t / 2, w / 2, w / 2 + t / 2, w / 2), linePath(w / 2, w / 2 - t / 2, w / 2, -w / 2 + t / 2), linePath(w / 2 + t / 2, -w / 2, -w / 2 - t / 2, -w / 2), linePath(-w / 2, -w / 2 + t / 2, -w / 2, w / 2 - t / 2)];
    let ph = 0;
    ws.forEach((p, i) => { B.wall(p, { t, H, top: B.profile(H, base + 0.5, p.L, ph, crown ? 0 : B.decay * 0.5), ch: S.ch, bl: S.bl, floor: base, open: i === 0 ? [{ kind: 'corbel', u0: p.L / 2 - 0.7, u1: p.L / 2 + 0.7, v0: base, v1: base + 3.2 }] : [], fall: 0.3 }); ph += p.L; });
    if (crown) {
      // porches with stacked pediments on the four sides, a capping slab over the walls, the lotus-bud tower on it
      if (kind !== 'prasatSmall') for (let f = 0; f < 4; f++) { const m = B.mark(); B.box(2.4, 0.5, 1.2, 0, H - 0.25, w / 2 + 0.5, null, B.tone(B.trim, 0.04), 0.04, 0.02); B.prism([[-1.3, 0], [1.3, 0], [0.2, 1.4], [-0.2, 1.4]], 0.4, 0, H, w / 2 + 0.7, null, B.tone(B.trim, 0.04)); B.turn(m, f * Math.PI / 2); }
      B.box(w + t, 0.4, w + t, 0, H + 0.19, 0, null, B.tone(B.stone, 0.05), 0, 0.02);
      if (kind === 'faceTower' && T.head && T.head.length) { // a serene face on each side, carved into the tower
        const hy = H + 0.2, s = w * 0.42;
        prangTop(B, 0, H + 0.36, 0, w / 2 + 0.3, B.r(4, 6));
        for (let f = 0; f < 4; f++) { const m = B.mark(); B.addTpl(B.pick(T.head), null, 0, hy, w / 2 - 0.15 * s, s, [1.05, 1.0, 0.92]); B.turn(m, f * Math.PI / 2); }
      } else prangTop(B, 0, H + 0.36, 0, w / 2 + 0.3, B.r(4.5, 7));
    }
    out.h = H - fl + 5; out.label = kind === 'faceTower' ? 'Face tower' : kind === 'prasatSmall' ? 'Prasat tower' : 'Prang tower';
  } else if (kind === 'horns') {
    const fl = ground(B, 0, 0, 5), top = fl + B.r(1.0, 1.6);
    pedestal(B, 0, 0, 4.4, top, 2);
    horns(B, 0, top, 0, B.r(2.6, 3.4), 0);
    B.cap(-1.2, top + 1.2, 0, 1.2, top + 1.2, 0, 1.0);
    out.h = top - fl + 3;
  } else if (kind === 'bull') {
    const fl = ground(B, 0, 0, 3), top = fl + B.r(0.9, 1.3);
    pedestal(B, 0, 0, 2.6, top, 2);
    statueOn(B, figs(['bull']), 0, top, 0, B.r(2.2, 3.0), Math.PI / 2 + (rng() - 0.5) * 0.6);
    out.h = 4; out.poi = 'statue';
  } else if (kind === 'labrys') {
    const fl = ground(B, 0, 0, 2.5), top = fl + 1.2, H = B.r(5, 7), lean = (rng() - 0.5) * 0.25;
    pedestal(B, 0, 0, 2.2, top, 3);
    const tip = [Math.sin(lean) * H, top + Math.cos(lean) * H, 0], hb = [Math.sin(lean) * (H - 1.0), top + Math.cos(lean) * (H - 1.0), 0]; // blades on the pole's axis
    B.tube([[0, top - 0.3, 0], tip], [0.16, 0.13], 8, BRONZE, true, 0.3, 0);
    for (const sd of [-1, 1]) B.prism([[-sd * 0.05, -0.15], [sd * 1.6, -0.9], [sd * 1.75, 0], [sd * 1.6, 0.9], [-sd * 0.05, 0.15]], 0.12, hb[0], hb[1], 0, rotZ(-lean), BRONZE, 0.3, 0);
    B.cap(0, top, 0, tip[0], tip[1], 0, 0.6); B.cap(hb[0] - 1.6, hb[1], 0, hb[0] + 1.6, hb[1], 0, 0.9);
    out.h = H + 1.5;
  } else if (kind === 'pagoda' || kind === 'stupa') {
    const n = kind === 'stupa' ? 0 : 5 + ((rng() * 4) | 0), w0 = B.r(5.5, 7), fl = ground(B, 0, 0, w0 + 2);
    let y = fl + 1.2;
    B.pier(w0 + 2.4, w0 + 2.4, 0, 0, y, null, B.tone(B.trim, 0.05), 0, 0.03);
    if (kind === 'stupa') { // bell-shaped stupa with a ringed spire
      B.lathe(B.lo ? 12 : 18, 6, (v) => [w0 * 0.48 * Math.sin(Math.PI * (0.12 + 0.88 * v)) ** 0.8 * (v < 0.1 ? 1.05 : 1), y + v * w0 * 0.75], null, B.tone(B.stone, 0.04));
      y += w0 * 0.72;
      for (let k = 0; k < 7; k++) B.lathe(10, 1, (v) => [0.55 * (1 - k / 9) * (1 - 0.15 * v), y + k * 0.42 + v * 0.3], null, k % 2 ? GOLD : B.tone(B.trim, 0.04), 0, k % 2 ? GOLD_MODE : B.key);
      B.cap(0, y - w0 * 0.4, 0, 0, y - w0 * 0.3, 0, w0 * 0.48); y += 3;
    } else {
      const lim = rng() < B.decay * 0.8 ? n - 1 - ((rng() * 3) | 0) : n; // the top storeys have fallen
      for (let k = 0; k < lim; k++) {
        const f = 1 - k * 0.075, w = w0 * f, hb = k === 0 ? B.r(3.2, 4) : B.r(1.8, 2.4);
        B.box(w, hb, w, 0, y + hb / 2, 0, null, B.tone(B.stone, 0.04), B.lo ? 0 : 0.04, 0.02);
        if (!B.lo) for (const [x, z] of [[0, w / 2], [0, -w / 2], [w / 2, 0], [-w / 2, 0]]) B.box(x ? 0.12 : 0.8, hb * 0.5, z ? 0.12 : 0.8, x * 1.01, y + hb * 0.55, z * 1.01, null, [0.05, 0.05, 0.05], 0, 0, 0, 0); // dark window niches
        y += hb;
        B.hipRoof(w / 2 + 1.0 * f, w / 2 + 1.0 * f, y, 0.9 * f, { col: S.roofCol, up: 0.5 * f, curve: 1.7, ridge: 0, noRidge: B.lo });
        B.boxCaps(0, 0, w, w, y - hb, y);
        y += 0.5;
        if (B.over()) yield;
      }
      if (lim === n) { for (let k = 0; k < 6; k++) B.lathe(8, 1, (v) => [0.4 * (1 - k / 8), y + k * 0.45 + v * 0.3], null, GOLD, 0, GOLD_MODE); y += 3; }
    }
    out.h = y - fl; out.label = kind === 'stupa' ? 'Stupa' : 'Pagoda';
  } else if (kind === 'bellTower') {
    const r = yield* genTower(B, false); out.h = r.H + 3 - r.lowF;
    if (r.intact) { // the bronze bell hangs from a beam across the top of the walls
      B.box(r.w + 0.6, 0.35, 0.4, 0, r.H - 0.18, 0, null, B.tone(B.trim, 0.04), 0, 0.01);
      B.lathe(B.lo ? 10 : 14, 4, (v) => [0.3 + 0.7 * v * v, r.H - 0.3 - v * 1.8], null, BRONZE, 0.3, 0);
    }
  } else if (kind === 'spiralTower') {
    const R = B.r(2.4, 3.2), H = B.r(13, 19), fl = ground(B, 0, 0, R * 2.5), y0 = fl + 1.0, brk = rng() < B.decay * 0.5 ? B.r(0.45, 0.8) : 1;
    pedestal(B, 0, 0, R * 2.6, y0, 2);
    const lobes = 3 + ((rng() * 3) | 0), tw = B.r(1.5, 3) * TAU;
    B.lathe(B.lo ? 12 : 20, B.lo ? 10 : 18, (v) => [R * (1 - 0.82 * v), y0 + v * H * brk], (a, v) => 1 + 0.22 * Math.cos(a * lobes + v * tw), B.tone(B.stone, 0.04));
    for (let k = 1; k < 5; k++) { const v = k / 5; if (v > brk) break; B.lathe(B.lo ? 10 : 16, 1, (q) => [R * (1 - 0.82 * v) * 1.2, y0 + (v + q * 0.012) * H], null, GOLD, 0, GOLD_MODE); } // orichalcum bands
    B.cap(0, y0 + R, 0, 0, y0 + H * brk * 0.6, 0, R * 1.15); B.cap(0, y0 + H * brk * 0.6, 0, 0, y0 + H * brk, 0, R * 0.6);
    out.h = H * brk + 1;
  } else if (kind === 'trident') {
    const fl = ground(B, 0, 0, 3), top = fl + 1.0, H = kind === 'trident' ? B.r(9, 13) : 6, lean = (rng() - 0.5) * 0.35;
    B.lathe(B.lo ? 12 : 16, 2, (v) => [2.2 - v * 0.6, fl - 0.4 + v * 1.4], null, B.tone(B.trim, 0.04));
    const R = rotZ(lean), up = (x, y) => [R[0] * x + R[1] * y, top + R[3] * x + R[4] * y, 0];
    B.tube([up(0, -0.5), up(0, H)], [0.26, 0.22], 10, GOLD, true, 0, GOLD_MODE);
    B.tube([up(-1.3, H - 0.2), up(-1.1, H + 0.2), up(0, H + 0.4), up(1.1, H + 0.2), up(1.3, H - 0.2)], [0.18, 0.2, 0.22, 0.2, 0.18], 8, GOLD, false, 0, GOLD_MODE);
    for (const x of [-1.3, 0, 1.3]) B.tube([up(x, x === 0 ? H + 0.3 : H - 0.3), up(x * 1.05, H + 2.6)], [0.17, 0.05], 8, GOLD, true, 0, GOLD_MODE);
    B.cap(0, top, 0, up(0, H)[0], up(0, H)[1], 0, 0.5); B.cap(up(-1.3, H + 1)[0], H + top + 1, 0, up(1.3, H + 1)[0], H + top + 1, 0, 0.8);
    out.h = H + 3;
  } else if (kind === 'nautilus') {
    const fl = ground(B, 0, 0, 4), top = fl + 1.0, s = B.r(2.6, 3.4);
    pedestal(B, 0, 0, 3.4, top, 2);
    const pts = [], rad = [], turns = 2.3;
    for (let k = 0; k <= 40; k++) { const a = k / 40 * turns * TAU, r = s * 0.08 * Math.exp(a * 0.18), rr = r * 0.62; pts.push([Math.cos(a) * r * 1.3, top + s * 1.05 + Math.sin(a) * r * 1.3, 0]); rad.push(rr); }
    const v0 = B.b.vc;
    B.tube(pts, rad, B.lo ? 10 : 16, [0.85, 0.82, 0.75], true);
    for (let i = v0; i < B.b.vc; i++) { // tiger stripes of a real nautilus shell
      const x = B.b.P[i * 3], y = B.b.P[i * 3 + 1] - top - s * 1.05, a = Math.atan2(y, x);
      if (Math.sin(a * 9 + Math.hypot(x, y) * 2) > 0.45 && y > -s * 0.2) { B.b.C[i * 3] *= 0.55; B.b.C[i * 3 + 1] *= 0.42; B.b.C[i * 3 + 2] *= 0.32; }
    }
    B.cap(0, top + s, 0, 0, top + s * 1.1, 0, s * 1.05);
    out.h = s * 2.2 + 1;
  }
  return out;
}

// ---------- plaza monuments ----------
export function* genMonument(B, kind) {
  const S = B.S, rng = B.rng;
  if (kind === 'fountain') {
    const R = B.r(2.6, 3.6), fl = ground(B, 0, 0, R * 2), poly = rng() < 0.5 ? 8 : 0, top = fl + 0.85;
    const ring = poly ? null : arcPath(0, 0, R, 0, TAU);
    if (poly) for (let k = 0; k < 8; k++) { const a0 = k / 8 * TAU, a1 = (k + 1) / 8 * TAU; B.wall(linePath(Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R), { t: 0.45, H: top, ch: [0.4, 0.5], bl: [1.2, 2], noObs: true, fall: 0 }); }
    else B.wall(ring, { t: 0.45, H: top, ch: [0.4, 0.5], bl: [1.0, 1.6], lap: 0.45 / R * 0.6 + 0.02, noObs: true, fall: 0 });
    B.box(0.1, 0.1, 0.1, 0, fl - 1, 0, null, [0, 0, 0], 0, 0); // (keeps the template's base below the ground)
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; B.cap(Math.cos(a) * R, top - 0.4, Math.sin(a) * R, Math.cos(a + TAU / 8) * R, top - 0.4, Math.sin(a + TAU / 8) * R, 0.45); }
    const ped = top + B.r(0.6, 1.2);
    pedestal(B, 0, 0, 1.2, ped, 2);
    if (S.key === 'atlantis' || rng() < 0.4) { // a shell basin on a column
      B.lathe(B.lo ? 10 : 16, 3, (v) => [0.3 + 1.1 * v * v, ped + 1.2 + v * 0.5], (a) => 1 + 0.07 * Math.abs(Math.cos(a * 6)), B.tone(B.trim, 0.04));
      B.column(0, ped, 0, { style: S.col === 'atlantean' ? 'atlantean' : 'tuscan', R: 0.22, H: 1.25, noObs: true });
    } else statueOn(B, figs(S.statues.filter((x) => x !== 'fragment')), 0, ped, 0, B.r(1.9, 2.6), rng() * TAU);
    return { label: 'Fountain', fact: 'Roman towns piped water to public fountains on almost every street corner.', h: 4 };
  }
  if (kind === 'statue' || kind === 'chacmool' || kind === 'buddha' || kind === 'lion' || kind === 'bull') {
    const list = figs(kind === 'statue' ? S.statues.filter((x) => x !== 'fragment') : [kind]);
    const fl = ground(B, 0, 0, 2.4), top = fl + (kind === 'chacmool' ? 0.6 : B.r(1.4, 2.4));
    pedestal(B, 0, 0, kind === 'chacmool' ? 3 : 2.2, top, 2);
    const t = statueOn(B, list, 0, top, 0, kind === 'chacmool' ? 1.4 : B.r(2.4, 3.4), (rng() - 0.5) * 0.6);
    return { label: t && t.label ? t.label : 'Statue', fact: null, h: 5, poi: 'statue' };
  }
  if (kind === 'naos') {
    const fl = ground(B, 0, 0, 3), w = B.r(1.8, 2.4), h = B.r(2.6, 3.4), c = B.tone([0.25, 0.25, 0.27], 0.05);
    pedestal(B, 0, 0, w + 0.8, fl + 0.6, 1);
    B.box(w, h, w * 0.9, 0, fl + 0.6 + h / 2, 0, null, c, 0.04, 0.02);
    B.box(w * 0.55, h * 0.6, 0.1, 0, fl + 0.6 + h * 0.4, w * 0.45, null, [0.04, 0.04, 0.04], 0, 0, 0, 0);
    B.prism([[-w / 2 - 0.1, 0], [w / 2 + 0.1, 0], [0, 0.7]], w * 0.9, 0, fl + 0.6 + h, 0, null, c);
    B.boxCaps(0, 0, w, w * 0.9, fl, fl + h + 1.2);
    return { label: 'Granite shrine (naos)', fact: 'A naos was a granite shrine that housed the god\'s statue in the darkest heart of the temple.', h: h + 1 };
  }
  if (kind === 'pithoi') {
    const n = 5 + ((rng() * 4) | 0), col = [0.52, 0.34, 0.23];
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + rng() * 0.4, rr = 1.1 + rng() * 1.4, x = Math.cos(a) * rr, z = Math.sin(a) * rr, H = B.r(1.3, 1.9), fl = ground(B, x, z, 1) - 0.3;
      const broken = rng() < 0.3;
      B.lathe(B.lo ? 8 : 12, 6, (v) => [0.16 + 0.44 * Math.sin(v * Math.PI * 0.92) + 0.025 * Math.sin(v * 28), fl + v * H * (broken ? 0.55 : 1)], null, col, 0.5, 0, x, 0, z);
      B.cap(x, fl + 0.5, z, x, fl + H * 0.6, z, 0.55);
    }
    return { label: 'Giant storage jars (pithoi)', fact: 'The storerooms of Knossos held giant pithoi, some taller than a person, for oil, wine and grain.', h: 2.5 };
  }
  if (kind === 'lantern') {
    const fl = ground(B, 0, 0, 2), H = B.r(3.2, 4.4), c = B.tone(B.stone, 0.05);
    B.pier(1.6, 1.6, 0, 0, fl + 0.5, null, c, 0.05, 0.02);
    B.lathe(B.lo ? 6 : 8, 2, (v) => [0.3 - 0.05 * v, fl + 0.5 + v * H * 0.45], null, c);
    const y = fl + 0.5 + H * 0.45;
    B.box(1.3, 0.3, 1.3, 0, y + 0.15, 0, null, c, 0.04, 0.02);
    B.box(0.9, 0.85, 0.9, 0, y + 0.72, 0, null, c, 0.04, 0.02);
    for (const [x, z] of [[0, 0.46], [0, -0.46], [0.46, 0], [-0.46, 0]]) B.box(x ? 0.04 : 0.45, 0.45, z ? 0.04 : 0.45, x, y + 0.75, z, null, [0.04, 0.04, 0.04], 0, 0, 0, 0);
    B.hipRoof(0.95, 0.95, y + 1.15, 0.6, { col: c, up: 0.18, curve: 1.6, ridge: 0, noRidge: true, th: 0.12 });
    B.lathe(6, 2, (v) => [0.16 * (1 - v * 0.6), y + 1.75 + v * 0.45], null, c);
    B.cap(0, fl + 0.6, 0, 0, y + 1.6, 0, 0.75);
    return { label: 'Stone lantern', fact: 'Stone lanterns lined temple paths in China and Japan; their light was an offering to the Buddha.', h: H + 1 };
  }
  if (kind === 'orb') {
    const fl = ground(B, 0, 0, 2), R = B.r(0.9, 1.4), top = fl + B.r(2.2, 3.2);
    pedestal(B, 0, 0, 1.8, fl + 0.5, 1);
    B.column(0, fl + 0.5, 0, { style: 'atlantean', R: 0.32, H: top - fl - 0.9, noObs: true });
    B.surf(B.lo ? 12 : 18, B.lo ? 8 : 12, (u, v, o) => { const a = u * TAU, t = (v - 0.5) * Math.PI; o[0] = Math.cos(a) * Math.cos(t) * R; o[2] = Math.sin(a) * Math.cos(t) * R; o[1] = top + R + Math.sin(t) * R; }, GOLD, { f0: 0, f1: GOLD_MODE });
    B.cap(0, fl + 0.6, 0, 0, top, 0, 0.5); B.cap(0, top + R, 0, 0, top + R, 0, R + 0.05);
    return { label: 'Orichalcum orb', fact: 'Plato said the inner wall of Atlantis was clad in orichalcum, which glittered like fire.', h: top - fl + 2 * R };
  }
  if (kind === 'head' || kind === 'trident' || kind === 'obelisk' || kind === 'stela' || kind === 'horns' || kind === 'lionPair' || kind === 'stupa' || kind === 'prasatSmall') return yield* genLandmark(B, kind);
  return yield* genMonument(B, 'statue');
}

// ---------- temples ----------
export function* genTemple(B, kind, W, D) {
  const S = B.S, rng = B.rng, site = B.site;
  const [lowF, highF] = site.range(-W / 2, -D / 2, W / 2, D / 2 + 3, 4);
  if (kind === 'greek') { // peripteral temple on a stepped crepidoma; columns stand, lean or lie in drums
    const st = lowF + Math.max(0.9, Math.min(2.2, highF - lowF + 0.5)), steps = 3;
    for (let k = 0; k < steps; k++) {
      const w = W - k * 0.9, d = D - k * 0.9, y = st - (steps - 1 - k) * 0.42;
      for (const [x, z, ww, dd] of [[0, d / 2 - 0.5, w, 1], [0, -d / 2 + 0.5, w, 1], [w / 2 - 0.5, 0, 1, d - 2], [-w / 2 + 0.5, 0, 1, d - 2]]) B.pier(ww, dd, x, z, y, null, B.tone(B.trim, 0.04), B.lo ? 0 : 0.03, 0.02);
    }
    B.pier(W - 2.6, D - 2.6, 0, 0, st - 0.05, null, B.tone(B.trim, 0.04), 0, 0.02);
    B.boxCaps(0, 0, W - 1, D - 1, lowF, st);
    if (B.over()) yield;
    const cs = B.pick(S.cols.filter((c) => c !== 'tuscan')), R = B.r(0.36, 0.46), H = B.r(5.6, 7.2), intact = rng() < 0.25 - B.decay * 0.2;
    const nW = Math.max(4, Math.round((W - 2.4) / 2.6)), nD = Math.max(5, Math.round((D - 2.4) / 2.6));
    const ring = [];
    for (let i = 0; i <= nW; i++) for (const sd of [-1, 1]) ring.push([lerp(-W / 2 + 1.3, W / 2 - 1.3, i / nW), sd * (D / 2 - 1.3)]);
    for (let j = 1; j < nD; j++) for (const sd of [-1, 1]) ring.push([sd * (W / 2 - 1.3), lerp(-D / 2 + 1.3, D / 2 - 1.3, j / nD)]);
    const stand = new Map();
    for (const [x, z] of ring) {
      const f = rng();
      if (!intact && f < B.decay * 0.45) { // toppled: drums lying in a row on the stylobate / ground
        const a = rng() * TAU, n = 3 + ((rng() * 2) | 0);
        for (let q = 0; q < n; q++) { const dd = 1.0 + q * 1.15, px = x + Math.cos(a) * dd, pz = z + Math.sin(a) * dd, fl = Math.max(B.minFloor(1.1, 1.1, px, pz, null), Math.abs(px) < W / 2 - 1 && Math.abs(pz) < D / 2 - 1 ? st - 0.05 : -1e9); B.box(1.05, R * 2, R * 2, px, fl + R - 0.08, pz, mul3(rotY(-a), rotX(rng())), B.tone(B.stone, 0.05), 0.08, 0.03); }
        continue;
      }
      const brk = intact ? 0 : f < B.decay * 0.9 ? B.r(0.2, 0.8) : 0;
      const tp = B.column(x, st, z, { style: cs, R, H, broken: brk, full: ring.length < 26 });
      if (!brk) stand.set(x.toFixed(1) + ',' + z.toFixed(1), tp);
      if (B.over()) yield;
    }
    // architrave where neighbours both stand (resting on the lower of the two capitals)
    let roofY = 1e9;
    for (let i = 0; i < nW; i++) for (const sd of [-1, 1]) {
      const xa = lerp(-W / 2 + 1.3, W / 2 - 1.3, i / nW), xb = lerp(-W / 2 + 1.3, W / 2 - 1.3, (i + 1) / nW), z = sd * (D / 2 - 1.3);
      const ta = stand.get(xa.toFixed(1) + ',' + z.toFixed(1)), tb = stand.get(xb.toFixed(1) + ',' + z.toFixed(1));
      if (ta && tb) { const y = Math.min(ta, tb); roofY = Math.min(roofY, y); B.box(xb - xa + 0.6, 0.7, 0.9, (xa + xb) / 2, y + 0.35, z, null, B.tone(B.trim, 0.04), 0.03, 0.02); }
    }
    // the cella inside
    const cw = W - 6.5, cd = D - 7.5, t = 0.7, Hc = st + H * 0.9;
    const walls = [linePath(cw / 2, cd / 2, cw / 2, -cd / 2), linePath(cw / 2 + t / 2, -cd / 2, -cw / 2 - t / 2, -cd / 2), linePath(-cw / 2, -cd / 2, -cw / 2, cd / 2), linePath(-cw / 2 - t / 2, cd / 2, cw / 2 + t / 2, cd / 2)];
    let ph = 0;
    for (let i = 0; i < 4; i++) { const p = walls[i]; B.wall(p, { t, H: Hc, top: B.profile(Hc, st + 0.4, p.L, ph, Math.min(1, B.decay + 0.15)), ch: S.ch, bl: S.bl, floor: st, open: i === 3 ? [{ kind: 'rect', u0: p.L / 2 - 1.1, u1: p.L / 2 + 1.1, v0: st, v1: st + 4.2 }] : [], fall: 0.35 }); ph += p.L; if (B.over()) yield; }
    statueOn(B, figs(S.statues.filter((x) => x !== 'fragment')), 0, st, -cd / 4, B.r(2.4, 3.4), 0);
    stair(B, 0, D / 2 + 0.1, st, W * 0.4, 0, 0.42, 0.45);
    if (intact && roofY < 1e8) { const m = B.mark(); B.gableRoof(D / 2 - 0.6, W / 2 - 0.6, roofY + 0.7, Math.min(2.6, W * 0.16), { col: [0.46, 0.22, 0.15], pediment: true }); B.turn(m, Math.PI / 2); }
    return { label: B.pick(['Temple of Poseidon', 'Temple of Athena', 'Temple of Apollo', 'Temple of Aphrodite', 'Temple of the Nereids']), fact: 'Greek temples were painted in bright colours; the pure white marble look came much later.', h: H + 2, poi: 'statue' };
  }
  if (kind === 'egypt') { // pylon front, a hall of papyrus columns, the sanctuary at the back
    const pt = B.r(4.2, 5.2), ph = B.r(10, 13), tw = (W - 4) / 2, zf = D / 2 - pt / 2;
    for (const sx of [-1, 1]) {
      const xc = sx * (2 + tw / 2), fl = B.minFloor(tw, pt, xc, zf, null) - 0.4, n = Math.max(6, Math.round((ph) / 0.9)), top = lowF + ph;
      for (let k = 0; k < n; k++) { const y0 = fl + (top - fl) * k / n, y1 = fl + (top - fl) * (k + 1) / n, f = (k + 0.5) / n, w = tw * (1 - 0.15 * f), d = pt * (1 - 0.2 * f); for (let j = 0; j < 2; j++) B.box(w / 2 * 1.01, y1 - y0, d, xc - w / 4 + j * w / 2, (y0 + y1) / 2, zf, null, B.tone(B.stone, 0.07), 0.03, 0.03); }
      B.prism([[-0.05, 0], [0.55, 0.65], [0.55, 0.85], [-0.05, 0.85]], tw * 0.88, xc, top, zf + pt * 0.4, rotY(-Math.PI / 2), B.tone(B.trim, 0.05));
      B.boxCaps(xc, zf, tw, pt, fl + 0.5, top);
      if (B.over()) yield;
    }
    const gy = lowF + 5.5; B.box(4.6, 1.0, pt * 0.7, 0, gy + 0.5, zf, null, B.tone(B.trim, 0.05), 0.03, 0.02); for (const sx of [-1, 1]) B.pier(0.9, pt * 0.7, sx * 1.75, zf, gy, null, B.tone(B.trim, 0.05), 0.03, 0.02);
    const nx = 4, nz = Math.max(2, Math.round((D - pt - 6) / 3.4)), R = B.r(0.7, 0.9), H = B.r(6.5, 8);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = lerp(-W / 2 + 2.4, W / 2 - 2.4, i / (nx - 1)), z = D / 2 - pt - 2.2 - j * 3.4, f = rng();
      if (f < B.decay * 0.3) continue;
      B.column(x, null, z, { style: B.pick(S.cols), R, H, broken: f < B.decay * 0.75 ? B.r(0.3, 0.8) : 0, col: B.tone(B.stone, 0.05) });
      if (B.over()) yield;
    }
    const zb = -D / 2 + 2.2, p = linePath(-W / 4, zb, W / 4, zb); // the sanctuary's back wall
    B.wall(p, { t: 1.2, H: lowF + 6, top: B.profile(lowF + 6, lowF + 0.5, p.L, 0, B.decay), ch: S.ch, bl: S.bl, fall: 0.3 });
    return { label: 'Temple of Amun', fact: 'The great hypostyle hall at Karnak has 134 columns, the tallest about 21 m.', h: ph, poi: 'giant' };
  }
  if (kind === 'maya') { // stepped pyramid with a front stair and a temple with a roof comb
    const tiers = 4 + ((rng() * 4) | 0), base = Math.min(W, D) - 1, th = B.r(1.5, 2.2);
    let y = lowF - 0.3;
    for (let k = 0; k < tiers; k++) {
      const w = base * (1 - k / (tiers + 1.2)), y1 = y + th;
      for (const [x, z, ww, dd] of [[0, w / 2 - 0.7, w, 1.4], [0, -w / 2 + 0.7, w, 1.4], [w / 2 - 0.7, 0, 1.4, w - 2.8], [-w / 2 + 0.7, 0, 1.4, w - 2.8]]) B.pier(ww, dd, x, z, y1, null, B.tone(B.stone, 0.06), 0, 0.04);
      B.box(w - 2.6, 0.5, w - 2.6, 0, y1 - 0.25, 0, null, B.tone(B.stone, 0.05), 0, 0.02);
      B.box(w + 0.15, 0.32, w + 0.15, 0, y1 - 0.5, 0, null, B.tone(B.trim, 0.08), 0, 0.02); // apron moulding
      y = y1;
      if (B.over()) yield;
    }
    stair(B, 0, base / 2 - 0.2, y, 3.6, 0, th / 4, 0.45);
    for (const sx of [-1, 1]) B.tube([[sx * 2.0, y, base / (2 * (tiers + 1.2)) + 0.5], [sx * 2.0, lowF + 0.6, base / 2 + 1.2]], [0.32, 0.32], 6, B.tone(B.trim, 0.06)); // balustrades
    const tw = base * (1 - (tiers - 1) / (tiers + 1.2)) * 0.72, td = tw * 0.7, H = y + B.r(3, 3.8), t = 0.7;
    const walls = [linePath(-tw / 2 - t / 2, td / 2, tw / 2 + t / 2, td / 2), linePath(tw / 2, td / 2 - t / 2, tw / 2, -td / 2 + t / 2), linePath(tw / 2 + t / 2, -td / 2, -tw / 2 - t / 2, -td / 2), linePath(-tw / 2, -td / 2 + t / 2, -tw / 2, td / 2 - t / 2)];
    let ph = 0;
    const intact = rng() < 0.55 - B.decay * 0.4;
    walls.forEach((p, i) => { B.wall(p, { t, H, top: B.profile(H, y + 0.3, p.L, ph, intact ? 0 : B.decay), ch: S.ch, bl: S.bl, floor: y, open: i === 0 ? [{ kind: 'corbel', u0: p.L / 2 - 0.75, u1: p.L / 2 + 0.75, v0: y, v1: y + 2.6 }] : [], fall: 0.2 }); ph += p.L; });
    if (intact) {
      B.box(tw + 1, 1.0, td + 1, 0, H + 0.5, 0, null, B.tone(B.trim, 0.06), 0, 0.02);
      const hc = B.r(3, 4.5);
      for (let k = 0; k < 4; k++) B.box(tw * (0.85 - k * 0.12), hc / 4, 0.6, 0, H + 1 + (k + 0.5) * hc / 4, 0, null, B.tone(B.trim, 0.06), 0, 0.03);
      B.cap(-tw / 3, H + 1 + hc / 2, 0, tw / 3, H + 1 + hc / 2, 0, 1.0);
    }
    B.boxCaps(0, 0, base * 0.8, base * 0.8, lowF, y - th * 0.5);
    return { label: B.pick(['Temple of the Jaguar', 'Temple of the Feathered Serpent', 'Temple of the Rain God', 'Temple of the Inscriptions']), fact: 'Maya pyramids were often built over older ones, like nesting dolls.', h: H - lowF + 4, poi: 'giant' };
  }
  if (kind === 'khmer') { // temple mountain: laterite terraces, steep stairs, five towers in a quincunx
    const tiers = 3, base = Math.min(W, D) - 1, th = B.r(1.6, 2.2);
    let y = lowF - 0.3;
    for (let k = 0; k < tiers; k++) {
      const w = base * (1 - k * 0.24), y1 = y + th;
      for (const [x, z, ww, dd] of [[0, w / 2 - 0.7, w, 1.4], [0, -w / 2 + 0.7, w, 1.4], [w / 2 - 0.7, 0, 1.4, w - 2.8], [-w / 2 + 0.7, 0, 1.4, w - 2.8]]) B.pier(ww, dd, x, z, y1, null, B.tone(k ? B.stone : [0.48, 0.27, 0.17], 0.06), 0, 0.04);
      B.box(w - 2.6, 0.5, w - 2.6, 0, y1 - 0.25, 0, null, B.tone(B.stone, 0.05), 0, 0.02);
      y = y1;
    }
    stair(B, 0, base / 2 - 0.2, y, 2.4, 0, th / 3.5, 0.42);
    const tw = base * (1 - (tiers - 1) * 0.24) * 0.9;
    for (const [x, z, big] of [[0, 0, 1], [-tw / 3, -tw / 3, 0], [tw / 3, -tw / 3, 0], [-tw / 3, tw / 3, 0], [tw / 3, tw / 3, 0]]) {
      if (!big && rng() < B.decay * 0.5) continue;
      const w = big ? 4.2 : 3, H = y + (big ? 4.5 : 3.2);
      B.pier(w, w, x, z, H, null, B.tone(B.stone, 0.05), 0, 0.03);
      B.box(1.0, 2.2, 0.15, x, y + 1.1, z + w / 2, null, [0.05, 0.05, 0.05], 0, 0, 0, 0);
      if (rng() > B.decay * 0.6) prangTop(B, x, H, z, w / 2 + 0.2, big ? B.r(6, 8) : B.r(4, 5.5));
      B.boxCaps(x, z, w, w, y, H);
      if (B.over()) yield;
    }
    B.boxCaps(0, 0, base * 0.8, base * 0.8, lowF, y - th * 0.5);
    return { label: B.pick(['Temple mountain', 'Prasat of the Sea Naga', 'Temple of the Churning Ocean']), fact: 'Angkor Wat is the largest religious monument in the world.', h: y - lowF + 9, poi: 'giant' };
  }
  if (kind === 'minoan') { // palace wings around a court open to the street, red-columned portico, grand stair
    const wing = function* (w, d, dx, dz, n) {
      const m = B.mark(), restore = B.offsetSite(dx, dz);
      let r;
      try { r = yield* rectBuilding(B, { W: w, D: d, n, hs: B.r(3.1, 3.5), intact: false, kq: 1.15 }); } finally { restore(); }
      B.shift(m, dx, 0, dz);
      return r;
    };
    const db = D * 0.38, ws = W * 0.24, ds = D * 0.5;
    const back = yield* wing(W, db, 0, -D / 2 + db / 2, 2 + (rng() < 0.4 ? 1 : 0));
    if (B.over()) yield;
    for (const sx of [-1, 1]) { if (rng() < 0.85) yield* wing(ws, ds, sx * (W / 2 - ws / 2), -D / 2 + db + ds / 2 + 0.6, 1 + (rng() < 0.5 ? 1 : 0)); if (B.over()) yield; }
    const zc = -D / 2 + db + 1.4; // the portico along the court face of the back wing
    for (let i = 0; i < 6; i++) { const x = lerp(-W / 2 + ws + 1.0, W / 2 - ws - 1.0, i / 5); if (rng() < B.decay * 0.4) continue; B.column(x, null, zc, { style: 'minoan', R: 0.32, H: 3.2, broken: rng() < B.decay * 0.5 ? B.r(0.3, 0.8) : 0 }); }
    stair(B, -W / 5, zc + 0.2, back.ft + back.t + 2.8, 2.4, 0);
    horns(B, W / 6, B.minFloor(2, 1, W / 6, D * 0.1, null) - 0.05, D * 0.1, 1.4, 0);
    return { label: 'Palace of Minos', fact: 'Minoan palaces had light wells, drains and running water centuries before Rome.', h: 9 };
  }
  if (kind === 'pagoda') { // temple hall on a high platform with a double roof
    const ph = B.r(1.4, 2.2), fl = lowF;
    B.pier(W, D * 0.8, 0, -D * 0.05, fl + ph, null, B.tone(B.trim, 0.05), 0, 0.03);
    B.boxCaps(0, -D * 0.05, W, D * 0.8, fl, fl + ph);
    stair(B, 0, D * 0.35, fl + ph, 4, 0);
    const w = W - 3, d = D * 0.8 - 3, hc = B.r(4.5, 5.5), intact = rng() < 0.6 - B.decay * 0.4;
    for (let i = 0; i < 6; i++) for (const sz of [-1, 1]) { const x = lerp(-w / 2, w / 2, i / 5); B.column(x, fl + ph, -D * 0.05 + sz * d / 2, { style: 'pagoda', R: 0.3, H: hc, col: [0.36, 0.11, 0.07], broken: !intact && rng() < B.decay * 0.6 ? B.r(0.3, 0.8) : 0 }); }
    const wall = linePath(w / 2, -D * 0.05 - d / 2 + 0.5, -w / 2, -D * 0.05 - d / 2 + 0.5);
    B.wall(wall, { t: 0.5, H: fl + ph + hc, ch: S.ch, bl: S.bl, floor: fl + ph, top: B.profile(fl + ph + hc, fl + ph + 0.4, wall.L, 0, intact ? 0 : B.decay), fall: 0.2 });
    if (intact) {
      const y = fl + ph + hc + 0.4;
      B.box(w + 0.6, 0.6, d + 0.6, 0, y - 0.3, -D * 0.05, null, [0.3, 0.1, 0.07], 0, 0.02);
      const m = B.mark();
      B.hipRoof(w / 2 + 2, d / 2 + 2, y, 1.6, { col: S.roofCol, up: 0.8, curve: 1.6, ridge: w / 2 - d / 2 + 1, noRidge: true });
      B.box(w * 0.7, 1.4, d * 0.6, 0, y + 1.6 + 0.7, 0, null, B.tone([0.3, 0.1, 0.07], 0.05), 0, 0.02);
      B.hipRoof(w * 0.35 + 1.6, d * 0.3 + 1.6, y + 3.0, 2.4, { col: S.roofCol, up: 0.7, curve: 1.7, ridge: w * 0.35 - d * 0.3 + 0.5 });
      B.shift(m, 0, 0, -D * 0.05);
    }
    return { label: B.pick(['Hall of the Dragon King', 'Temple of the Sea Goddess', 'Hall of Great Compassion']), fact: 'In Japanese legend, the fisherman Urashima Taro visited Ryugu-jo, the Dragon King\'s palace under the sea.', h: hc + 6, poi: 'giant' };
  }
  if (kind === 'atlantis') { // round temple of Poseidon on ring terraces, twisted columns, a golden ribbed dome
    const R0 = Math.min(W, D) / 2 - 0.5, fl = lowF;
    let y = fl - 0.2;
    for (let k = 0; k < 3; k++) {
      const rr = R0 - k * 1.6, n = Math.max(12, Math.round(TAU * rr / 1.6)); y += 0.8;
      for (let i = 0; i < n; i++) { const a = (i + 0.5 * (k % 2)) / n * TAU; B.pier(TAU * rr / n * 1.03, 1.6, Math.cos(a) * (rr - 0.8), Math.sin(a) * (rr - 0.8), y, rotY(-a + Math.PI / 2), B.tone(k % 2 ? [0.84, 0.84, 0.82] : [0.3, 0.5, 0.52], 0.04), 0, 0.02); }
      B.lathe(B.lo ? 16 : 24, 1, (v) => [(rr - 1.6) * v, y - 0.02], null, B.tone(B.trim, 0.03));
      if (B.over()) yield;
    }
    B.podium(R0 - 4.8, y); // solid core inside the terraces: the columns and the statue stand on stone
    B.boxCaps(0, 0, R0 * 1.4, R0 * 1.4, fl, y);
    const Rc = R0 - 5.6, n = Math.max(8, Math.round(TAU * Rc / 2.2)), H = B.r(5.5, 7);
    let top = -1e9, standing = 0;
    for (let i = 0; i < n; i++) { const a = i / n * TAU, brk = rng() < B.decay * 0.6 ? B.r(0.3, 0.8) : 0, tp = B.column(Math.cos(a) * Rc, y, Math.sin(a) * Rc, { style: 'atlantean', R: 0.34, H, broken: brk }); if (!brk) { standing++; top = Math.max(top, tp); } if (i % 4 === 3 && B.over()) yield; }
    const dO = { k: 0.85, ribs: 12, ribGold: true, gold: rng() < 0.5, broken: rng() < 0.5 ? B.r(0.2, 0.5) : 0 };
    if (standing === n) {
      for (let i = 0, ne = n * 2; i < ne; i++) { const a = i / ne * TAU; B.box(TAU * Rc / ne * 1.14, 0.55, 0.9, Math.cos(a) * Rc, top + 0.27, Math.sin(a) * Rc, rotY(-a + Math.PI / 2), B.tone(B.trim, 0.04), 0, 0.02); }
      B.domeOn(0, top + 0.5, 0, Rc + 0.4, { ...dO, fallen: { floor: () => y, rIn: Rc - 0.6, avoid: [[0, 0, 1.8]] } });
    } else if (rng() < 0.75) B.fallenDome(0, 0, Rc + 0.4, dO.k, { floor: () => y, rIn: Rc - 0.6, avoid: [[0, 0, 1.8]] }, dO);
    statueOn(B, figs(['poseidon']), 0, y, 0, B.r(3.5, 4.8), 0, [1.0, 0.85, 0.55]);
    return { label: 'Temple of Poseidon', fact: 'In Plato\'s tale, the temple of Poseidon held a gold statue of the god driving six winged horses.', h: H + 5, poi: 'giant' };
  }
  yield* genRect(B, 'block', W, D);
  return { label: 'Temple' };
}

// ---------- big set pieces ----------
export function* genBig(B, kind, Rr) {
  const S = B.S, rng = B.rng, site = B.site;
  if (kind === 'theatre' || kind === 'theatral') { // seating rows climbing away from the street around an orchestra
    const rows = kind === 'theatral' ? 8 : 12 + ((rng() * 6) | 0), R0 = kind === 'theatral' ? 5 : B.r(5, 6.5), dr = 0.85, rise = 0.42;
    const span = kind === 'theatral' ? Math.PI * 0.5 : Math.PI * B.r(1.0, 1.15), a0 = -Math.PI / 2 - span / 2, cz = Rr * 0.45;
    const fl0 = B.minFloor(R0 * 2, R0 * 2, 0, cz, null);
    let y = fl0 + 0.2;
    for (let k = 0; k < rows; k++) {
      const r = R0 + k * dr, n = Math.max(6, Math.round(span * r / (B.lo ? 3.2 : 2.2)));
      y += rise;
      for (let i = 0; i < n; i++) {
        if (rng() < B.decay * 0.18 * (k / rows + 0.3)) continue;
        const a = a0 + (i + 0.5) / n * span, x = Math.cos(a) * (r + dr / 2), z = cz + Math.sin(a) * (r + dr / 2);
        B.pier(span * r / n * 1.04, dr * 1.02, x, z, y, rotY(-a - Math.PI / 2), B.tone(B.stone, 0.05), 0, 0.02);
      }
      if (k % 4 === 3) for (let i = 1; i < 4; i++) { const a = a0 + span * i / 4; B.box(0.9, rise * 0.5, dr * 0.9, Math.cos(a) * (r + dr / 2), y + 0.1, cz + Math.sin(a) * (r + dr / 2), rotY(-a - Math.PI / 2), B.tone(B.trim, 0.04), 0, 0.02); }
      if (B.over()) yield;
    }
    for (let k = 0; k < rows; k += 3) { const r = R0 + (k + 1.5) * dr; for (let q = 0; q < 4; q++) { const aa = a0 + span * q / 4, ab = a0 + span * (q + 1) / 4; B.cap(Math.cos(aa) * r, fl0 + (k + 1.5) * rise, cz + Math.sin(aa) * r, Math.cos(ab) * r, fl0 + (k + 1.5) * rise, cz + Math.sin(ab) * r, 1.4); } }
    B.lathe(B.lo ? 16 : 24, 1, (v) => [R0 * v, fl0 + 0.25], null, B.tone(B.trim, 0.03)); // orchestra floor
    B.pier(0.1, 0.1, 0, cz, fl0 + 0.2, null, B.tone(B.trim, 0.03));
    if (kind === 'theatre') { // stage building: a columned facade on the street side
      const sw = R0 * 2.6, zs = cz + R0 + 1.8, p = linePath(-sw / 2, zs, sw / 2, zs), Hs = fl0 + B.r(6, 8);
      B.wall(p, { t: 1.2, H: Hs, top: B.profile(Hs, fl0 + 0.8, p.L, 0, B.decay), ch: S.ch, bl: S.bl, open: [-1, 0, 1].map((k) => ({ kind: 'arch', u0: sw / 2 + k * sw / 4 - 0.9, u1: sw / 2 + k * sw / 4 + 0.9, v0: fl0, v1: fl0 + 3.6 })), fall: 0.35 });
      for (let i = 0; i < 6; i++) if (rng() > B.decay * 0.5) B.column(lerp(-sw / 2 + 1, sw / 2 - 1, i / 5), null, zs + 1.3, { style: B.pick(S.cols), R: 0.3, H: 4.2, broken: rng() < B.decay * 0.5 ? B.r(0.3, 0.8) : 0, plinth: true });
    }
    return { label: kind === 'theatral' ? 'Theatral area' : 'Theatre', fact: kind === 'theatral' ? 'Minoan "theatral areas" were broad stepped courts where crowds watched rituals and processions.' : 'In a Greek theatre the curved stone seats carry a whisper from the stage to the back row.', h: rows * rise + 2, poi: 'giant' };
  }
  if (kind === 'ballcourt') { // two long sloped walls with stone rings high on their faces
    const L = Rr * 1.6, gap = B.r(7, 9), H = B.r(5, 6.5);
    for (const sx of [-1, 1]) {
      const x = sx * (gap / 2 + 2.5), fl = B.minFloor(5, L, x, 0, null) - 0.3;
      for (let k = 0; k < 6; k++) { const y0 = fl + k * (H + 0.3) / 6, y1 = y0 + (H + 0.3) / 6, w = 5 - k * 0.55; B.box(w, y1 - y0, L, x + sx * (5 - w) / 2, (y0 + y1) / 2, 0, null, B.tone(B.stone, 0.05), 0, 0.03); }
      B.box(1.2, 0.8, L, x - sx * 2.0, fl + 0.7, 0, rotZ(sx * 0.6), B.tone(B.trim, 0.06), 0, 0.02); // sloping bench
      B.boxCaps(x, 0, 5, L, fl, fl + H);
      const ry = fl + H * 0.8;
      if (rng() > B.decay * 0.5) { // a stone ring set into the wall face, facing across the court
        const m = B.mark();
        B.lathe(B.lo ? 10 : 16, 4, (v) => [0.75 + 0.18 * Math.cos(v * TAU), Math.sin(v * TAU) * 0.2], null, B.tone(B.trim, 0.05));
        const kk = Math.min(5, Math.floor((ry - fl) / ((H + 0.3) / 6))), wk = 5 - kk * 0.55, face = x + sx * ((5 - wk) / 2 - wk / 2); // the wall's inner face there
        B.xform(m, rotZ(Math.PI / 2), face - sx * 0.08, ry, 0);
        B.cap(face - sx * 0.1, ry, 0, face - sx * 0.1, ry, 0, 1.0);
      }
    }
    return { label: 'Ball court', fact: 'In the Maya ball game players kept a heavy rubber ball in play with their hips; stone rings served as goals.', h: H, poi: 'giant' };
  }
  if (kind === 'hypostyle') return yield* genTemple(B, 'egypt', Rr * 1.5, Rr * 1.6);
  if (kind === 'terrace') { // Khmer terrace of the elephants: a long platform with elephant trunks down its face
    const L = Rr * 1.7, d = B.r(6, 8), fl = B.minFloor(L, d, 0, 0, null), H = fl + B.r(2.8, 3.6);
    B.pier(L, d, 0, 0, H, null, B.tone(B.stone, 0.05), 0, 0.03);
    for (let x = -L / 2 + 2; x < L / 2 - 1; x += 3.2) {
      const z = d / 2 + 0.4;
      B.box(2.6, H - fl - 0.4, 0.8, x, (H + fl) / 2 - 0.1, z - 0.2, null, B.tone(B.stone, 0.05), 0.05, 0.03);
      const gt = site.fl(x + 0.35, z + 0.9); // the trunk curls onto the ground in front of the terrace
      B.tube([[x, H - 0.6, z + 0.2], [x, H - 1.6, z + 0.7], [x + 0.1, gt + 0.45, z + 0.6], [x + 0.35, gt + 0.1, z + 0.9]], [0.42, 0.34, 0.26, 0.2], 7, B.tone(B.stone, 0.05));
      for (const sd of [-1, 1]) B.tube([[x + sd * 0.32, H - 1.3, z + 0.05], [x + sd * 0.55, H - 1.9, z + 0.9]], [0.1, 0.05], 5, [0.75, 0.72, 0.62]); // tusks, rooted in the carved face
    }
    stair(B, 0, d / 2, H, 3, 0);
    for (const sx of [-1, 1]) statueOn(B, figs(['lion', 'dvarapala']), sx * 2.6, H, d / 2 - 0.8, B.r(1.6, 2.2));
    B.boxCaps(0, 0, L, d, fl, H);
    return { label: 'Terrace of the Elephants', fact: 'Angkor\'s Terrace of the Elephants was a 350 m long royal viewing stand.', h: 4, poi: 'giant' };
  }
  if (kind === 'hallCourt') { // walled courtyard with a moon gate and a hall at the back
    const W = Rr * 1.5, D = Rr * 1.2, t = 0.5, fl = B.site.range(-W / 2, -D / 2, W / 2, D / 2, 3)[0], Hw = fl + B.r(3.2, 4);
    const walls = [linePath(-W / 2, D / 2, W / 2, D / 2), linePath(W / 2, D / 2, W / 2, -D / 2), linePath(-W / 2, -D / 2, -W / 2, D / 2)];
    let ph = 0;
    for (let i = 0; i < 3; i++) { const p = walls[i]; B.wall(p, { t, H: Hw, top: B.profile(Hw, fl + 0.4, p.L, ph, B.decay * 0.8), ch: S.ch, bl: S.bl, open: i === 0 ? [{ kind: 'round', u0: p.L / 2 - 1.3, u1: p.L / 2 + 1.3, v0: Math.max(fl, site.fl(0, D / 2)) - 0.3, v1: Math.max(fl, site.fl(0, D / 2)) + 2.3 }] : [], fall: 0.3 }); ph += p.L; if (B.over()) yield; }
    const m = B.mark(), restore = B.offsetSite(0, -D * 0.28);
    try { yield* genRect(B, 'hall', W * 0.6, D * 0.35); } finally { restore(); }
    B.shift(m, 0, 0, -D * 0.28);
    return { label: 'Walled temple court', fact: 'A moon gate is a round doorway in a garden wall, framing the view beyond like a painting.', h: 6 };
  }
  if (kind === 'rings') { // Atlantis in miniature: concentric ring walls with gaps, a shrine on the central island
    const fl = B.site.range(-Rr, -Rr, Rr, Rr, 4)[0];
    for (const [rr, H] of [[Rr - 1, 2.6], [Rr * 0.66, 3.4], [Rr * 0.34, 4.2]]) {
      const n = 3, gapA = 0.35;
      for (let k = 0; k < n; k++) {
        const a0 = k / n * TAU + gapA / 2 + rr, a1 = (k + 1) / n * TAU - gapA / 2 + rr;
        B.wall(arcPath(0, 0, rr, a0, a1), { t: 0.8, H: fl + H, top: B.profile(fl + H, fl + 0.4, (a1 - a0) * rr, k * 20, B.decay * 0.7, false), ch: S.ch, bl: S.bl, lap: 0.8 / rr * 0.6 + 0.02, col: (kk) => B.tone(S.bands ? S.bands[kk % 3] : B.stone, 0.05), fall: 0.25 });
        if (B.over()) yield;
      }
    }
    yield* genRotunda(B, false); // the shrine on the central island
    return { label: 'Ring city', fact: 'Plato described Atlantis as rings of land and water around a central island.', h: 6, poi: 'giant' };
  }
  return { label: 'Ruins', h: 3 };
}

// A monumental stairway climbing the terrace behind the street: steps follow the ground's rise, with low
// parapets and a landing; where the slope is too gentle it is a short flight up to a paved terrace edge.
function genStairway(B, W, D) {
  const site = B.site, rng = B.rng, z0 = D / 2, z1 = -D / 2, f0 = site.fl(0, z0), f1 = Math.max(site.fl(0, z1), f0 + 1.2);
  const n = Math.max(4, Math.round((f1 - f0) / B.r(0.28, 0.36))), run = (z0 - z1) / n, c = B.tone(B.trim, 0.04);
  let top = f0;
  for (let k = 0; k < n; k++) {
    const y = f0 + (k + 1) * (f1 - f0) / n, z = z0 - (k + 0.5) * run;
    if (rng() < B.decay * 0.12) continue; // a few steps have gone
    B.pier(W, run * 1.02, 0, z, y, null, B.tone(c, 0.05), B.lo ? 0 : 0.02, 0.015);
    top = y;
  }
  for (const sx of [-1, 1]) { // parapets stepping up with the flight
    for (let k = 0; k < n; k += 2) {
      if (rng() < B.decay * 0.4) continue;
      const y = f0 + (k + 1) * (f1 - f0) / n, z = z0 - (k + 1) * run;
      B.pier(0.45, run * 2.02, sx * (W / 2 + 0.22), z, y + 0.7, null, B.tone(B.stone, 0.05), 0, 0.02);
    }
  }
  B.boxCaps(0, 0, W + 0.9, D, f0, top);
  return { label: 'Monumental stairway', fact: 'Stairs climbed the terraces of hillside cities, with landings where people rested and talked.' };
}

// ---------- extra lot kinds ----------
export function* genLot(B, kind, W, D) {
  const S = B.S;
  if (kind === 'stairway') return genStairway(B, W, D);
  if (kind === 'tower') return yield* genTower(B, S.key === 'maya' || S.key === 'atlantis' || (S.key === 'pagoda' && B.rng() < 0.3));
  if (kind === 'rotunda') return yield* genRotunda(B, S.key === 'greco');
  if (kind === 'dome') return yield* genRotunda(B, false);
  if (kind === 'stoa' || kind === 'gallery') return yield* genStoa(B, W, D);
  if (kind === 'shrine' || kind === 'platform') return yield* genShrine(B);
  if (kind === 'pavilion') return yield* genPavilion(B);
  if (kind === 'prasat') return yield* genLandmark(B, 'prasatSmall');
  if (kind === 'spire') return yield* genLandmark(B, 'spiralTower');
  if (kind === 'shell') { const r = yield* genRotunda(B, false); return r; }
  if (kind === 'courtyard') return yield* genBig(B, 'hallCourt', Math.min(W, D) * 0.75);
  return yield* genRect(B, kind, W, D);
}
