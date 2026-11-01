// Ship wreck recipes. Each recipe turns a seeded rng into a design (hull form, livery, damage, deck, parts,
// facts); make() builds it as one or two templates (whole, or broken in two) in its resting state. Builds
// are generators: every yield is a ~1-3 ms slice, so the per-segment generation never hitches a frame.
import { Builder, lerp, rotX, rotY, rotZ, mul3 } from './core.js';
import { mulberry32 } from '../noise.js';
import { HullForm, livery, paintC, buildHullG, addDeckG, hullAt, bulkhead, portholes, bilgeKeels, finishWreckG } from './wreck_hull.js';
import { house, funnel, mast, rope, derrick, cowl, winch, davits, propeller, rudder, anchor, chainAlong, cannonBarrel, carriage, bollard, WIN, capX } from './wreck_parts.js';
import { cyl, pipe, beam, obox, ring, xpt, add, scl } from './wreck_geo.js';

export const SAND = [0.3, 0.28, 0.22];

// ---------- resting states ----------
const STATES = {
  upright: (r, d) => ({ roll: r.sign() * r.range(0, 0.1), pitch: r.range(-0.03, 0.03), bury: d.H.D * r.range(0.16, 0.26), fill: r.range(0.5, 1.3) }),
  list: (r, d) => ({ roll: r.sign() * r.range(0.22, 0.6), pitch: r.range(-0.04, 0.04), bury: d.H.D * r.range(0.2, 0.32), fill: r.range(0.6, 1.4) }),
  side: (r, d) => ({ roll: r.sign() * r.range(1.25, 1.62), pitch: r.range(-0.04, 0.04), bury: d.H.B * r.range(0.22, 0.34), fill: r.range(0.5, 1.2) }),
  capsized: (r, d) => ({ roll: Math.PI + r.range(-0.25, 0.25), pitch: r.range(-0.03, 0.03), bury: d.H.D * r.range(0.3, 0.42), fill: r.range(0.4, 0.9) }),
  buried: (r, d) => ({ roll: r.sign() * r.range(0.02, 0.3), pitch: r.range(-0.05, 0.05), bury: d.H.D * r.range(0.42, 0.58), fill: r.range(0.6, 1.0) }),
  skeleton: (r, d) => ({ roll: r.sign() * r.range(0, 0.12), pitch: r.range(-0.02, 0.02), bury: d.H.D * r.range(0.14, 0.22), fill: r.range(0.3, 0.6) }),
};
export function pickCond(r, w) { let t = 0; for (const k in w) t += w[k]; let x = r() * t; for (const k in w) { x -= w[k]; if (x <= 0) return k; } return Object.keys(w)[0]; }

// ---------- ship accessor for parts ----------
function accessor(b, info, d, rng, st) {
  const { cutLo, cutHi } = info, R = mul3(rotX(st.pitch || 0), rotZ(st.roll || 0));
  // sediment plane in the final frame (approximate: hull corners), for parts that must reach the sand
  let lo = 1e9;
  for (const x of [-d.H.B / 2, d.H.B / 2]) for (const y of [0, d.H.D]) lo = Math.min(lo, R[3] * x + R[4] * y);
  const S = {
    b, info, d, rng, Lv: d.Lv, H: d.H, st, R, sandY: lo + (st.bury || 0),
    ok: (u, m = 0.015) => u > cutLo + m && u < cutHi - m,
    at: (u) => { const e = hullAt(info, u); return { x: Math.abs(e.x), y: e.y + 0.06, z: e.z }; },
    feat: (name, fact, p) => b.feats.push({ name, fact, p }),
    attach: (p, n) => b.attach.push({ p, n }),
  };
  return S;
}

function* makePiece(d, rng, cutLo, cutHi, st, part) {
  const b = new Builder();
  b.skipObs = []; b.obsX = []; b.feats = []; b.attach = [];
  let info = null;
  if (d.tier === 'low' && d.hull && !d.hull.lowDone) d.hull = { ...d.hull, cell: (d.hull.cell ?? 1.6) * 1.25, lowDone: true };
  if (d.build) { // custom-built body (submarine, aircraft)
    const g = d.build(b, rng, st, cutLo, cutHi, part);
    if (g && g.next) yield* g;
  } else {
    const dk = typeof d.deck === 'function' ? null : d.deck, openU = [];
    if (dk) { for (const h of dk.hatches || []) openU.push([h[0], h[1]]); for (const c of dk.collapse || []) openU.push([c[0] - c[1] / d.H.L, c[0] + c[1] / d.H.L]); }
    info = yield* buildHullG(b, d.H, d.Lv, rng, { ...d.hull, cutLo, cutHi, seed: d.seed + part.length * 7, deckOpen: !d.deck, openU });
    yield;
    if (d.deck) yield* addDeckG(b, info, rng, typeof d.deck === 'function' ? d.deck(info) : d.deck);
    yield;
    const S = accessor(b, info, d, rng, st);
    if (d.parts) { const g = d.parts(b, S, part); if (g && g.next) yield* g; }
    // sheer-line attachment points for growth (top edge of the hull, every few metres)
    for (let i = 0; i <= info.nu; i += 2) for (const side of [-1, 1]) {
      const j = info.nt, q = (j * info.W + i) * 3, hl = info.holes[side];
      if (hl[(info.nt - 1) * info.nu + Math.min(info.nu - 1, i)]) continue;
      b.attach.push({ p: [side * info.PS[q], info.PS[q + 1] + 0.02, info.PS[q + 2]], n: [side * 0.3, 1, 0] });
    }
    // hull-skin attachment points (plating away from holes and the end gear): growth spreads over whatever
    // faces up once the hull lists hard, lies on its side or capsizes, instead of a bare slab of plates
    const { nu, W, PS, NS, holes, jDeck, U } = info;
    for (let i = 1; i < nu; i += 2) {
      if (U[i] < 0.1 || U[i] > 0.92) continue;
      for (let j = 1; j < jDeck; j += 2) for (const side of [-1, 1]) {
        const hl = holes[side];
        if (hl[j * nu + i] || hl[j * nu + i - 1] || hl[(j - 1) * nu + i] || hl[(j - 1) * nu + i - 1]) continue;
        const q = (j * W + i) * 3, n = [side * NS[q], NS[q + 1], NS[q + 2]];
        b.attach.push({ p: [side * PS[q] + n[0] * 0.03, PS[q + 1] + n[1] * 0.03, PS[q + 2] + n[2] * 0.03], n, skin: true });
      }
    }
  }
  yield;
  const fin = yield* finishWreckG(b, info, { ...st, sand: SAND, cover: d.cover });
  const T0 = [0, 0, 0];
  const feats = b.feats.map((f) => ({ ...f, p: xpt(fin.R, T0, f.p) })).filter((f) => f.p[1] > fin.yCut + 0.2);
  const attach = b.attach.map((a) => ({ p: xpt(fin.R, T0, a.p), n: xpt(fin.R, T0, a.n), skin: !!a.skin })).filter((a) => a.p[1] > fin.yCut + 0.3 && a.n[1] > 0.2);
  yield;
  // deck level (template space) for the set-piece point above the wreck: median of the up-facing attachment points
  const ys = attach.map((q) => q.p[1]).sort((p, q) => p - q);
  const tpl = b.build();
  tpl.deckY = ys.length ? ys[ys.length >> 1] : (tpl.box[1] + tpl.box[4]) / 2;
  tpl.label = part ? `${d.label} ${part}` : d.label;
  tpl.fact = d.facts[0];
  tpl.feats = feats; tpl.attach = attach; tpl.sinkK = st.sink ?? 0.25;
  tpl.skin = attach.reduce((n, a) => n + (a.skin ? 1 : 0), 0); // up-facing plating: more growth (wreck.js)
  tpl.cond = st.cond; tpl.kind = d.kind;
  return tpl;
}

// a design -> pieces (generator). Returns [tpl...]; each tpl.cutEnd = z sign of its broken end (0 = whole).
// Ship hulls run stern (u = 0, +z) to bow (u = 1, -z); lofted bodies (d.build) run nose (t = 0, -z) to tail.
export function* make(d) {
  const rng = mulberry32(d.seed ^ 0x9e3779b1);
  const pieces = [];
  if (d.cond === 'broken') {
    const at = d.breakAt ?? rng.range(0.38, 0.62), gap = 0.01, loft = !!d.build;
    const sa = STATES[rng.pick(d.brokenStates || ['upright', 'list', 'list', 'side'])](rng, d), sb = STATES[rng.pick(d.brokenStates || ['upright', 'list', 'buried'])](rng, d);
    if (d.stateMod) { d.stateMod(sa, rng, 'list'); d.stateMod(sb, rng, 'list'); }
    const names = loft ? (d.partNames || ['forward section', 'tail section']) : ['stern section', 'bow section'];
    const a = yield* makePiece(d, rng, 0, at - gap, { ...sa, cond: 'broken' }, names[0]);
    const b = yield* makePiece(d, rng, at + gap, 1, { ...sb, cond: 'broken' }, names[1]);
    a.cutEnd = loft ? 1 : -1; b.cutEnd = loft ? -1 : 1;
    a.part = names[0]; b.part = names[1];
    pieces.push(a, b);
  } else if (d.cond === 'scattered' && !d.build) { // the middle of the hull has collapsed into a debris field
    const lo = rng.range(0.12, 0.2), hi = rng.range(0.74, 0.84);
    const sa = STATES.buried(rng, d), sb = STATES[rng.pick(['list', 'buried', 'upright'])](rng, d);
    const a = yield* makePiece(d, rng, 0, lo, { ...sa, cond: 'scattered' }, 'stern section');
    const b = yield* makePiece(d, rng, hi, 1, { ...sb, cond: 'scattered' }, 'bow section');
    a.cutEnd = -1; b.cutEnd = 1; a.part = 'stern section'; b.part = 'bow section';
    pieces.push(a, b);
    pieces.gap = (hi - lo) * d.H.L;
  } else {
    const st = STATES[d.cond] ? STATES[d.cond](rng, d) : STATES.upright(rng, d);
    if (d.stateMod) d.stateMod(st, rng, d.cond);
    const t = yield* makePiece(d, rng, d.cutLo ?? 0, d.cutHi ?? 1, { ...st, cond: d.cond }, d.part || '');
    t.part = 'whole'; t.cutEnd = 0;
    pieces.push(t);
  }
  return pieces;
}

// ---------- shared part helpers ----------
// a mast or pole for this resting state: standing (upright / listing), or fallen so its top rests on the sand
// (on its side), or snapped off short (capsized). Returns the mast() result or null.
export function stateMast(S, o) {
  const roll = Math.abs(S.st.roll || 0);
  if (roll > 2.2) return mast(S.b, { ...o, keep: Math.min(o.keep ?? 1, 0.12 + S.rng() * 0.12) });
  if (roll < 0.9) return mast(S.b, o);
  // lean the mast in the transverse plane toward the low side until its top meets the sediment
  const R = S.R, sgn = Math.sign(S.st.roll), keep = o.keep ?? 1, h = o.h * keep;
  let best = o.lean ? o.lean[0] : 0;
  for (let k = 0; k <= 16; k++) {
    const a = -sgn * (k / 16) * 1.2, dir = [Math.sin(a), Math.cos(a), 0], tip = [o.p[0] + dir[0] * h, o.p[1] + dir[1] * h, o.p[2]];
    best = a;
    if (R[3] * tip[0] + R[4] * tip[1] + R[5] * tip[2] < S.sandY + 0.2) break;
  }
  return mast(S.b, { ...o, lean: [best, (o.lean ? o.lean[1] : 0) * 0.3] });
}
const steelC = (S, v = 1) => paintC(S.Lv, 'top', v);
export function stockAnchors(S, uA, kind, size) { // anchors at the bow: one stowed, one let go with its chain
  const { b, rng } = S;
  if (!S.ok(uA)) return;
  const a = S.at(uA), col = [0.16, 0.08, 0.05], f = [S.Lv.growth, 4];
  for (const side of [-1, 1]) {
    const p = [side * (a.x + 0.15), a.y - 1.0, a.z];
    if (side > 0 || rng() < 0.5) anchor(b, p, mul3(rotY(side * 0.3), rotZ(side * 0.35)), size, kind, col, f);
    else { // let go: chain from the hawse down below the hull bottom
      const pts = [p, [p[0] + side * 0.6, p[1] - 2, p[2] - 0.6], [p[0] + side * 1.4, -1.5, p[2] - 2.5]];
      chainAlong(b, pts, 0.32 * size, col, f);
    }
  }
  S.feat(kind === 'stockless' ? 'Stockless anchor' : 'Admiralty anchor', kind === 'stockless' ? 'Stockless anchors stow snugly in the hawse pipe; their flukes pivot to dig in.' : 'Old anchors had a stock across the shank, so one fluke always dug into the seabed.', [a.x, a.y - 1.5, a.z]);
}
// Stern gear. Single screw: deadwood down to the keel line, sternpost, propeller in the aperture of the
// stern cutaway, rudder on the sole piece behind it. Twin screws: shafts on A-brackets under a flat run.
export function sternGear(S, o) {
  const { b, rng, H } = S;
  if (!S.ok(0.02, 0.005)) return;
  const col = o.bronze ? [0.32, 0.22, 0.09] : [0.16, 0.08, 0.05], f = [S.Lv.growth * 0.7, o.bronze ? 0 : 4], hc = [0.17, 0.08, 0.05], hf = [S.Lv.growth, 4];
  const salv = rng() < (o.salvaged ?? 0.12), ang = rng.range(-0.6, 0.6);
  if (!o.twin) {
    const uP = 0.04, zP = H.zAt(uP, 0), ka = H.keelY(uP), zE = H.zAt(0, 0);
    // deadwood plate (keel to the cutaway) and sternpost
    const v0 = b.vc, pts = [];
    for (let k = 0; k <= 6; k++) { const u = lerp(H.aLen, uP, k / 6); pts.push([H.zAt(u, 0), H.keelY(u)]); }
    for (const sd of [-1, 1]) {
      const c = b.v(sd * 0.14, 0, (H.zAt(H.aLen, 0) + zP) / 2, sd, 0, 0, hc[0], hc[1], hc[2], hf[0], hf[1]), s0 = b.vc;
      for (const [z, y] of pts) b.v(sd * 0.14, y + 0.05, z, sd, 0, 0, hc[0], hc[1], hc[2], hf[0], hf[1]);
      b.v(sd * 0.14, 0, zP, sd, 0, 0, hc[0], hc[1], hc[2], hf[0], hf[1]); b.v(sd * 0.14, 0, H.zAt(H.aLen, 0), sd, 0, 0, hc[0], hc[1], hc[2], hf[0], hf[1]);
      for (let k = 0; k < pts.length + 1; k++) sd > 0 ? b.t(c, s0 + k, s0 + k + 1) : b.t(c, s0 + k + 1, s0 + k);
    }
    void v0;
    beam(b, [0, -0.2, zP + 0.15], [0, ka + 0.3, zP + 0.15], 0.34, 0.4, hc, hf, [0, 0, 1]);
    // sole piece under the rudder, rudder post
    const zR = zE + 0.6, yTop = H.keelY(0.0) + 0.2;
    beam(b, [0, 0.2, zP], [0, 0.2, zR + 0.4], 0.3, 0.4, hc, hf);
    const R = o.R ?? Math.min(ka * 0.42, H.D * 0.24), y = 0.2 + R + 0.15, zp = (zP + zR) / 2 - 0.1;
    cyl(b, [0, y, zP - 0.5], [0, y, zp], R * 0.12, R * 0.11, 7, col, f);
    if (!salv) propeller(b, [0, y, zp], [0, 0, 1], R, o.blades ?? 4, col, f, rng() * 6, o.bent ?? 0.25);
    else cyl(b, [0, y, zp], [0, y, zp - 0.4], R * 0.18, R * 0.16, 8, col, f, 2);
    S.feat(salv ? 'Propeller shaft (the propeller was salvaged)' : o.bronze ? 'Bronze propeller' : 'Propeller', o.bronze || salv ? 'Bronze propellers are often the first thing salvagers take from a wreck.' : 'Ship propellers are cast in one piece and can weigh tens of tonnes.', [0, y, zp]);
    rudder(b, [0, yTop, zR], o.rudderC ?? Math.max(1.2, R * 1.2), yTop - 0.3, ang, hc, hf);
    capX(b, [0, y, zP], [0, y, zR + 1], R + 0.2);
    return;
  }
  const uP = 0.075, zP = H.zAt(uP, 0) + 0.5;
  for (const sx of [-1, 1]) {
    const x = sx * H.B * 0.2, kb = H.keelY(0.12) + 0.2, R = o.R ?? H.D * 0.2, y = Math.max(R + 0.25, kb - R * 0.2), zb = H.zAt(0.18, 0);
    cyl(b, [x, Math.max(y, H.keelY(0.2)) + 0.3, zb], [x, y, zP + 0.6], R * 0.1, R * 0.1, 6, col, f);
    beam(b, [x, y, zP - 0.8], [x * 0.4, H.keelY(uP) + 0.4, zP - 0.8], 0.16, 0.5, hc, hf); // A-bracket
    beam(b, [x, y, zP - 0.8], [x * 1.6, H.keelY(uP) + 0.6, zP - 0.8], 0.16, 0.5, hc, hf);
    if (rng() > (o.salvaged ?? 0.12)) propeller(b, [x, y, zP], [0, 0, 1], R, o.blades ?? 3, col, f, rng() * 6, o.bent ?? 0.25);
    const zr = zP + R + 0.7, top = H.keelY(0.02) + 0.3;
    if (o.rudders !== 1 || sx > 0) rudder(b, [o.rudders === 1 ? 0 : x, top, H.zAt(0.04, top)], o.rudderC ?? R * 1.3, Math.max(1, top - y + R * 0.8), ang, hc, hf);
    void zr;
    if (o.nozzle) ring(b, [x, y, zP - 0.1], [0, 0, 1], R * 1.08, 0.1, R * 0.7, 16, hc, hf);
    capX(b, [x, y, zP - 0.5], [x, y, zP + 0.5], R + 0.2);
  }
  S.feat('Twin propellers', 'Warships and tugs often have two screws for speed and manoeuvrability.', [0, H.D * 0.2, zP]);
}
export function holdCargo(S, ua, ub, kind) { // cargo left in a hold: crates, drums or lorries on the hold floor
  const { b, rng, H, info } = S;
  if (!S.ok(ua) || !S.ok(ub)) return;
  const y0 = H.keelY((ua + ub) / 2) + info.th + 0.3, n = 3 + Math.floor(rng() * 5);
  for (let k = 0; k < n; k++) {
    const u = lerp(ua, ub, rng()), a = S.at(u), x = (rng() - 0.5) * a.x * 1.1;
    if (kind === 'drums') cyl(b, [x, y0 + 0.45, a.z], [x + 0.4, y0 + 0.45, a.z + 0.7], 0.3, 0.3, 8, [0.22, 0.1, 0.06], [S.Lv.growth, 4], 3);
    else if (kind === 'lorry') lorry(b, [x, y0, a.z], rng.range(-0.4, 0.4) + (rng() < 0.5 ? Math.PI : 0), rng);
    else b.box(rng.range(1, 1.8), rng.range(0.8, 1.5), rng.range(1, 2.2), rotY(rng() * 0.6), x, y0 + 0.6 + (k % 3) * 0.5, a.z, [0.24, 0.18, 0.12], [S.Lv.growth, 0]);
  }
  if (kind === 'lorry') S.feat('Lorries in the hold', 'Wartime freighters carried lorries, motorbikes and rifles, still in their holds today.', [0, y0 + 1.5, S.at((ua + ub) / 2).z]);
}
// a WWII lorry: cab + bed + wheels (cargo in a hold)
export function lorry(b, p, yaw, rng) {
  const R = rotY(yaw), v0 = b.vc, c = [0.14, 0.13, 0.09], f = [0.8, 4];
  b.box(2.1, 1.2, 1.8, null, 0, 1.3, -2.2, c, f); // cab
  b.box(1.9, 0.7, 1.1, null, 0, 2.0, -2.0, c, f);
  b.box(1.4, 0.5, 0.05, null, 0, 1.95, -2.56, WIN, [0, 4]);
  b.box(2.2, 0.15, 4.0, null, 0, 0.85, 0.6, c, f); // bed
  for (const s of [-1, 1]) b.box(0.08, 0.6, 4.0, null, s * 1.05, 1.2, 0.6, c, f);
  for (const z of [-2.2, 0.0, 1.6]) for (const s of [-1, 1]) cyl(b, [s * 0.95, 0.48, z], [s * 1.25, 0.48, z], 0.46, 0.46, 9, [0.05, 0.05, 0.05], [0.5, 0], 3);
  b.xform(v0, R, p[0], p[1], p[2]);
  void rng;
}

// ---------- steam freighter (three-island or engines-aft) ----------
export function freighter(r, o) {
  const L = r.range(54, 74) * (o.hero ? 1 : 0.9), B = L / r.range(7, 8.2), D = B * r.range(0.66, 0.78), aft = r() < 0.3;
  const year = aft ? r.int(1950, 1985) : r.int(1898, 1945);
  const H = new HullForm({
    L, B, D, pmb: [0.26, 0.6], entA: 1.8, entB: 0.95, runA: 1.6, runB: 0.85, tw: 0, nMid: r.range(7, 11), nBow: 1.5, nStern: 2.4,
    riseF: D * 0.18, fLen: 0.1, riseA: D * 0.5, aLen: 0.08, aExp: 0.6, rake: aft ? r.range(2, 4) : r.range(0.3, 2), rakeP: 1, over: aft ? r.range(0.8, 1.6) : r.range(2.2, 3.4), overP: 2,
    sheerF: r.range(0.7, 1.7), sheerA: r.range(0.3, 0.8), flare: 0.2, wl: 0.62, bulwark: r.range(0.9, 1.1),
    raised: aft ? [[0.9, 1, 2.3], [0, 0.17, 2.4]] : [[0.88, 1, 2.3], [0, 0.13, 2.2], [0.43, 0.57, 2.3]],
  });
  const Lv = livery('steel', r, { rust: r.range(0.35, 0.9) });
  const hatches = aft ? [[0.27, 0.35, 0.62], [0.42, 0.5, 0.62], [0.57, 0.65, 0.62], [0.72, 0.8, 0.62]] : [[0.17, 0.24, 0.6], [0.29, 0.37, 0.6], [0.63, 0.7, 0.6], [0.75, 0.83, 0.6]];
  const collapse = [];
  for (let k = r.int(0, 2); k > 0; k--) collapse.push([r.range(0.2, 0.8), r.range(4, 9), r.range(0.3, 0.6)]);
  const cargo = r.pick(['crates', 'drums', 'lorry', 'crates']);
  const funnelCol = Lv.top, band = r() < 0.7 ? [0.55, 0.72, r.pick([[0.35, 0.05, 0.03], [0.5, 0.45, 0.4], [0.05, 0.1, 0.25], [0.45, 0.3, 0.05]])] : null;
  return {
    kind: 'freighter', label: aft ? 'Motor cargo ship' : 'Steam freighter', year, H, Lv, seed: o.seed,
    facts: aft ? ['Many ships are scuttled on purpose to become artificial reefs and dive sites.', 'Within a few years of sinking, a steel hull is covered in sponges, corals and sea fans.']
      : ['Three-island freighters have a raised forecastle, bridge deck and poop: the classic tramp steamer.', 'Steel wrecks turn into reefs within a few years as corals and sponges settle on the plating.', 'Riveted hulls were built from overlapping plates: you can still see every seam on old wrecks.'],
    hull: { cell: o.hero ? 1.5 : 1.8, strakes: 7, rowsPer: 2, holeThr: r.range(0.64, 0.76), decay: r.range(0, 0.25), impacts: r() < 0.6 ? [{ u: r.range(0.3, 0.75), t: r.range(0.2, 0.7), r: r.range(2.5, 5), k: 0.55, side: r.sign() }] : [] },
    deck: { hatches, collapse, thr: r.range(0.72, 0.82), coaming: 0.85 },
    cond: o.cond, brokenStates: ['upright', 'list', 'side'],
    parts: function* (b, S) {
      const { rng } = S, [sc, sf] = steelC(S, 0.9), white = [[0.42, 0.41, 0.38], [S.Lv.growth, 4]];
      const struct = rng() < 0.6 ? white : [sc, sf];
      const uB = aft ? 0.115 : 0.525, uF = aft ? 0.085 : 0.46, lenB = (aft ? 0.12 : 0.07) * H.L;
      let topY = 0;
      if (S.ok(uB - 0.05) && S.ok(uB + 0.05)) { // bridge / accommodation block
        const a = S.at(uB), tiers = aft ? 4 : rng.int(2, 3);
        let y = a.y;
        for (let t = 0; t < tiers; t++) {
          const w = a.x * 2 * (0.9 - t * 0.1), l = lenB * (1 - t * 0.14), h = 2.4;
          house(b, { y, z: a.z + t * 0.3, w, h, l, col: struct[0], f: struct[1], seed: S.d.seed + t, missing: rng.range(0, 0.45), collapse: t === tiers - 1 && rng() < 0.2, win: { rows: 1, size: [0.5, 0.45], every: t === tiers - 1 ? 0.9 : 1.6 }, front: t === tiers - 1 && rng() < 0.4 ? 'round' : 'flat' });
          if (t === tiers - 1) { // bridge wings
            for (const s of [-1, 1]) b.box(a.x * 0.45, 0.12, 1.6, null, s * (w / 2 + a.x * 0.2), y + h - 0.1, a.z - l / 2 + 1, struct[0], struct[1]);
            S.feat('Bridge', 'The wheelhouse held the helm, compass and engine telegraph; often the first part to collapse.', [0, y + h, a.z]);
          }
          y += h;
        }
        topY = y;
        capX(b, [0, a.y + 1.5, a.z - lenB / 2 + 1.5], [0, a.y + 1.5, a.z + lenB / 2 - 1.5], a.x);
      }
      yield;
      if (S.ok(uF)) { // engine casing + funnel aft of the bridge
        const a = S.at(uF), zf = aft ? a.z + lenB * 0.25 : a.z, yb = aft ? a.y + 2 * 2.4 : a.y + 2.4;
        if (!aft) house(b, { y: a.y, z: zf, w: a.x * 1.1, h: 2.4, l: H.L * 0.06, col: sc, f: sf, seed: S.d.seed + 9, missing: 0.2, win: { rows: 1, size: [0.4, 0.4], every: 2.4 }, noRoof: true });
        if (rng() < 0.82) funnel(b, { p: [0, yb, zf], r: H.B * 0.11, rz: H.B * 0.15, h: H.D * r.range(0.8, 1.15), rake: rng.range(0.05, 0.2), col: funnelCol, band, f: [S.Lv.growth * 0.6, 4], seed: S.d.seed, holes: rng.range(0, 0.25) });
        for (let k = 0; k < 4; k++) cowl(b, [(k % 2 ? 1 : -1) * H.B * 0.22, yb, zf + (k < 2 ? -2.2 : 2.2)], 1.5 + rng(), 0.3, rng() * 6.28, sc, sf);
        S.feat('Funnel', 'Coal-fired steamers burned tens of tonnes of coal a day; stokers fed the furnaces by hand.', [0, yb + 3, zf]);
      }
      void topY;
      for (const [u, h] of [[aft ? 0.54 : 0.735, H.D * r.range(1.6, 2.4)], [aft ? 0.69 : 0.265, H.D * r.range(1.4, 2.1)]]) {
        if (!S.ok(u)) continue;
        const a = S.at(u), keep = rng() < 0.35 ? rng.range(0.25, 0.7) : 1;
        if (aft) { // deck crane
          cyl(b, [0, a.y, a.z], [0, a.y + 3.5, a.z], 0.9, 0.8, 10, sc, sf, 2);
          b.box(1.6, 1.4, 2.2, null, 0, a.y + 4.2, a.z, sc, sf);
          const ang = rng.range(-1, 1), el = rng.range(-0.2, 0.6), Lj = h * 0.8;
          cyl(b, [0, a.y + 4.4, a.z], [Math.sin(ang) * Lj * Math.cos(el), a.y + 4.4 + Math.sin(el) * Lj, a.z - Math.cos(ang) * Lj * Math.cos(el)], 0.35, 0.18, 6, sc, sf, 3);
          capX(b, [0, a.y, a.z], [0, a.y + 4.5, a.z], 1.2);
          continue;
        }
        const m = stateMast(S, { p: [0, a.y, a.z], h, r: 0.32, keep, lean: [rng.range(-0.08, 0.08), rng.range(-0.06, 0.06)], col: sc, f: sf, seed: S.d.seed + u * 100, yards: [[0.8, 2.2]] });
        if (keep > 0.5) for (const s of [-1, 1]) rope(b, m.pt(0.75), [s * a.x, a.y + 0.9, a.z + 1.5], 0.4, 0.035, [0.1, 0.07, 0.05], sf);
        for (const dz of [-1, 1]) derrick(b, { p: [dz * 0.9, a.y, a.z + dz * 1.4], h: 2.5, col: sc, f: sf, seed: S.d.seed + dz + u * 50, boomAng: dz > 0 ? rng.range(-0.5, 0.5) : Math.PI + rng.range(-0.5, 0.5), boomLen: H.L * 0.13, boomEl: rng.range(0.05, 0.5), boom: rng() < 0.7 });
        winch(b, [0, a.y, a.z + (u > 0.5 ? -2.6 : 2.6)], sc, sf);
      }
      yield;
      // boat deck davits (lifeboats long gone), cowls, bollards, rails on the bridge deck
      if (S.ok(uB)) { const a = S.at(uF); for (const s of [-1, 1]) davits(b, [s * a.x * 0.8, a.y + (aft ? 7.2 : 0), a.z], s, 4.5, sc, sf, rng() < 0.3 ? rng.range(0.4, 1.5) : 0); }
      for (const u of [0.95, 0.06]) if (S.ok(u)) { const a = S.at(u); for (const s of [-1, 1]) bollard(b, [s * a.x * 0.7, a.y, a.z], sc, sf); }
      for (const [ua, ub] of hatches) if (rng() < 0.6) { holdCargo(S, ua, ub, cargo); break; }
      stockAnchors(S, 0.955, 'stockless', 1.0 + H.L / 120);
      sternGear(S, { blades: 4, bronze: rng() < 0.35, salvaged: 0.25 });
      for (const [ua, ub] of H.raised.map((q) => [Math.max(0.02, q[0]), Math.min(0.97, q[1])])) portholes(b, S.info, ua + 0.01, ub - 0.01, { below: 1.25, every: 1.7 });
      bilgeKeels(b, S.info, 0.3, 0.68, 0.45 + H.B * 0.012);
      // bulkheads between holds
      for (const [ua] of hatches) { const i = hullAt(S.info, ua - 0.015).i; if (i > 0 && i < S.info.nu && rng() < 0.5) bulkhead(b, S.info, i, rng, 0.3); }
    },
  };
}

// ---------- galleon (16th-18th century) ----------
const GALLEON = ['San Telmo', 'Nuestra Señora de la Luz', 'Santa Rosalía', 'San Ignacio', 'Santo Cristo de Burgos', 'Concepción', 'San Felipe', 'Santa Clara', 'El Rosario', 'San José y las Ánimas', 'La Trinidad', 'San Isidro', 'Nuestra Señora del Carmen', 'San Martín', 'Santa Ana', 'Espíritu Santo'];
export function galleon(r, o) {
  const L = r.range(32, 44) * (o.hero ? 1 : 0.9), B = L / r.range(3.5, 4.1), D = B * r.range(0.5, 0.6);
  const H = new HullForm({
    L, B, D, pmb: [0.35, 0.52], entA: 1.7, entB: 0.75, runA: 1.6, runB: 0.7, tw: r.range(0.55, 0.7), nMid: r.range(2.6, 3.4), nBow: 1.6, nStern: 2.0,
    riseF: D * 0.25, fLen: 0.14, riseA: D * 0.08, aLen: 0.05, rake: r.range(2.5, 4), rakeP: 0.75, over: r.range(1.2, 2.2), overP: 1.2,
    sheerF: r.range(1, 1.8), sheerA: r.range(1.2, 2.2), flare: 0, tumble: r.range(0.14, 0.24), wl: 0.5, bulwark: r.range(0.8, 1.1),
    raised: [[0.84, 1, r.range(1.4, 1.9), 0.01], [0, 0.34, r.range(1.5, 2), 0.01], [0, 0.15, r.range(1.3, 1.8), 0.01]],
  });
  const Lv = livery('wood', r);
  const name = GALLEON[(r() * GALLEON.length) | 0], year = r.int(1550, 1760);
  const skeleton = o.cond === 'skeleton';
  return {
    kind: 'galleon', label: 'Galleon', name, year, H, Lv, seed: o.seed,
    facts: ['Spanish treasure fleets shipped New World silver home for over two centuries.', 'Shipworms, which are really clams, eat wooden hulls until mostly ballast and cannons remain.', 'A galleon carried hundreds of tonnes of stone ballast low in its hull to stay upright.'],
    hull: { cell: o.hero ? 1.15 : 1.4, strakes: skeleton ? 9 : 12, rowsPer: 1, holeThr: skeleton ? 0.45 : r.range(0.7, 0.8), decay: skeleton ? 1 : r.range(0.25, 0.6), frames: 0.9, skeleton,
      impacts: [{ u: r.range(0.3, 0.7), t: r.range(0.4, 0.9), r: r.range(2, 4), k: 0.5, side: r.sign() }] },
    deck: skeleton ? null : { nx: 9, collapse: [[r.range(0.35, 0.65), r.range(5, 10), 0.5]], thr: r.range(0.62, 0.76), camber: 0.18 },
    cond: o.cond, brokenStates: ['upright', 'list', 'buried'],
    parts: function* (b, S) {
      const { rng } = S, wc = [0.2, 0.15, 0.1], wf = [S.Lv.growth, 0], dark = [0.06, 0.05, 0.04];
      const info = S.info;
      // wales: heavy dark strakes along the hull at two heights
      if (!skeleton) for (const t of [0.62, 0.8]) for (const side of [-1, 1]) {
        let run = [];
        const flush = () => { if (run.length > 1) pipe(b, run, 0.13, 4, dark, wf); run = []; };
        for (let i = 0; i <= info.nu; i++) {
          const jj = Math.round(t * (info.jDeck)), q = (jj * info.W + i) * 3, hole = info.holes[side][Math.min(info.nt - 1, jj) * info.nu + Math.min(info.nu - 1, i)];
          if (hole) { flush(); continue; }
          run.push([side * (info.PS[q] + 0.1), info.PS[q + 1], info.PS[q + 2]]);
        }
        flush();
      }
      yield;
      // gunports with cannon muzzles poking out, two decks
      if (!skeleton) for (const [t, n] of [[0.55, 9], [0.78, 7]]) for (let k = 0; k < n; k++) {
        const u = 0.2 + (k + 0.5) / n * 0.6;
        if (!S.ok(u, 0.03)) continue;
        for (const side of [-1, 1]) {
          const sec = S.H.section(u), p = S.H.ptOn(sec, u, t, [0, 0, 0]);
          const i = hullAt(info, u).i, jj = Math.round(t * info.jDeck);
          if (info.holes[side][Math.min(info.nt - 1, jj) * info.nu + Math.min(info.nu - 1, i)]) continue;
          obox(b, [side * (p[0] + 0.05), p[1], p[2]], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.1, 0.62, 0.66, dark, [0, 0]);
          if (rng() < 0.45) cannonBarrel(b, [side * (p[0] - 0.5), p[1], p[2]], [side, rng.range(-0.25, 0.05), rng.range(-0.1, 0.1)], 1.4, [0.1, 0.09, 0.08], [S.Lv.growth, 4]);
        }
      }
      // stern: gallery windows on the transom and quarter galleries
      if (!skeleton && S.ok(0.03, 0)) {
        const zs = S.H.zAt(0, S.H.sheerY(0)) + 0.05, ys = S.H.sheerY(0), wd = S.H.w(0) * 0.85;
        for (let row = 0; row < 2; row++) for (let k = -2; k <= 2; k++) if (rng() > 0.2) b.box(0.55, 0.7, 0.08, null, k * wd / 2.6, ys - 1.1 - row * 1.3, zs + 0.04, WIN, [0, 0]);
        b.box(wd * 2.1, 0.25, 0.4, null, 0, ys - 0.35, zs - 0.1, wc, wf); // taffrail
        for (const side of [-1, 1]) b.box(0.9, 2.2, 2.2, null, side * (S.H.w(0.06) + 0.25), ys - 1.4, S.H.zAt(0.06, ys - 1.4), wc, wf);
        S.feat('Stern gallery', "The captain's cabin had a gallery of windows across the stern.", [0, ys - 1, zs]);
      }
      yield;
      // masts (mostly broken), bowsprit, rigging remnants
      const ms = [[0.78, 1.25, 0.3], [0.52, 1.5, 0.36], [0.24, 1.05, 0.26]];
      for (const [u, hk, rr] of ms) {
        if (!S.ok(u) || (skeleton && rng() < 0.6)) continue;
        const a = S.at(u), base = [0, S.H.keelY(u) + 1.0, a.z], h = S.H.D * 2.6 * hk, keep = skeleton ? rng.range(0.25, 0.4) : rng() < 0.85 ? rng.range(0.28, 0.7) : 1;
        const m = stateMast(S, { p: base, h, r: rr, keep, lean: [rng.range(-0.12, 0.12), rng.range(-0.1, 0.1)], col: wc, f: wf, seed: S.d.seed + u * 10, top: 0.62, yards: rng() < 0.5 ? [[0.5, S.H.B * 0.75, rng.range(-0.4, 0.4)], [0.82, S.H.B * 0.55, rng.range(-0.5, 0.5)]] : [] });
        if (!skeleton && keep > 0.45) for (let q = 0; q < 4; q++) {
          const side = q % 2 ? 1 : -1, uu = u + (q < 2 ? -0.02 : 0.02), e = S.at(uu), cut = rng() < 0.4 ? rng.range(0.3, 0.8) : 1;
          const top = m.pt(Math.min(keep, 0.6) * 0.95), end = [side * (e.x + 0.3), e.y + 0.4, e.z];
          rope(b, top, [lerp(top[0], end[0], cut), lerp(top[1], end[1], cut) - (cut < 1 ? 0.8 : 0), lerp(top[2], end[2], cut)], 0.3, 0.035, [0.1, 0.08, 0.06], wf);
        }
      }
      if (!skeleton && S.ok(0.985, 0)) { // bowsprit
        const a = S.at(0.96), base = [0, a.y + 0.2, a.z + 1], dir = [0, Math.sin(0.35), -Math.cos(0.35)], Lb = S.H.L * 0.28 * (rng() < 0.5 ? rng.range(0.4, 0.8) : 1);
        cyl(b, base, add(base, scl(dir, Lb)), 0.3, 0.16, 6, wc, wf, 3);
        capX(b, base, add(base, scl(dir, Lb)), 0.45);
      }
      // cannons and a capstan on deck
      if (!skeleton) for (let k = 0; k < 4; k++) {
        const u = rng.range(0.25, 0.8);
        if (!S.ok(u)) continue;
        const a = S.at(u), x = (rng() - 0.5) * a.x * 1.2;
        const yaw = rng() * 6.28;
        carriage(b, [x, a.y, a.z], yaw, [0.17, 0.13, 0.09], wf);
        cannonBarrel(b, [x, a.y + 0.75, a.z], [Math.sin(yaw), 0.05, Math.cos(yaw)], 2.2, [0.1, 0.09, 0.08], [S.Lv.growth, 4]);
      }
      if (!skeleton && S.ok(0.42)) { const a = S.at(0.42); cyl(b, [0, a.y, a.z], [0, a.y + 1.1, a.z], 0.45, 0.5, 8, wc, wf, 2); for (let k = 0; k < 4; k++) { const an = k * Math.PI / 4; beam(b, [Math.cos(an) * 1.5, a.y + 0.9, a.z + Math.sin(an) * 1.5], [-Math.cos(an) * 1.5, a.y + 0.9, a.z - Math.sin(an) * 1.5], 0.1, 0.1, wc, wf); } S.feat('Capstan', 'Sailors walked the capstan bars round to haul up the anchors.', [0, a.y + 1, a.z]); }
      // ballast stones in the bilge (they survive when the hull rots away)
      if (S.ok(0.5)) {
        const a = S.at(0.5), y0 = skeleton ? S.sandY + 0.05 : S.H.keelY(0.5) + S.info.th + 0.25;
        for (let k = 0; k < (skeleton ? 26 : 12); k++) {
          const u = rng.range(0.25, 0.75);
          if (!S.ok(u)) continue;
          const z = S.at(u).z, x = (rng() - 0.5) * a.x * 0.9, s = rng.range(0.25, 0.5);
          b.box(s * 1.3, s * 0.8, s, mul3(rotY(rng() * 3), rotX(rng() * 0.4)), x, y0 + rng() * 0.8, z, [0.3, 0.29, 0.26], [S.Lv.growth, 0]);
        }
        S.feat('Ballast stones', 'Ballast stones from far-off river beds often outlast the ship that carried them.', [0, y0 + 0.5, a.z]);
      }
      stockAnchors(S, 0.93, 'admiralty', 1.1);
      if (S.ok(0.01, 0) && !skeleton) rudder(b, [0, S.H.sheerY(0) - 1, S.H.zAt(0, 1) + 0.25], 1.6, S.H.sheerY(0) - 1.2, rng.range(-0.4, 0.4), wc, wf);
    },
  };
}
export { STATES };
