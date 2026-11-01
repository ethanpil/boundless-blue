// More wreck recipes: schooner / brig, tug, trawler, WWII destroyer, sailing yacht, paddle steamer, tanker and
// container-ship sections, and small boats (rowing boat, longboat, ship's lifeboat, dinghy, outboard skiff).
import { rotX, rotY, rotZ, mul3 } from './core.js';
import { HullForm, livery, paintC, bulkhead, railing, portholes, bilgeKeels } from './wreck_hull.js';
import { house, funnel, mast, rope, derrick, winch, cannonBarrel, carriage, gunMount, aaTub, torpedoTubes, paddleWheel, tyre, bollard, capX, thin } from './wreck_parts.js';
import { cyl, pipe, beam, obox, ring, add, scl } from './wreck_geo.js';
import { sternGear, stateMast, stockAnchors } from './wreck_types.js';

const wood = (S) => [[0.24, 0.19, 0.13], [S.Lv.growth, 0]];
const rig = [0.09, 0.075, 0.06];

// ---------- schooner and brig (19th-century sailing merchantmen / navy brigs) ----------
export function sailship(r, o, brig) {
  const L = r.range(22, 33) * (o.hero ? 1 : 0.9), B = L / (brig ? r.range(3.6, 4) : r.range(4, 4.7)), D = B * r.range(0.46, 0.56);
  const H = new HullForm({
    L, B, D, pmb: [0.38, 0.55], entA: 1.6, entB: 0.8, runA: 1.8, runB: 0.72, tw: brig ? 0.45 : 0.28, nMid: brig ? 2.8 : 2.3, nBow: 1.45, nStern: 1.9,
    riseF: D * 0.3, fLen: 0.18, riseA: D * 0.12, aLen: 0.07, rake: brig ? r.range(1.5, 2.5) : r.range(2.5, 3.6), rakeP: brig ? 1 : 1.8, over: r.range(1.4, 2.4), overP: 1.3,
    sheerF: r.range(0.5, 1.1), sheerA: r.range(0.2, 0.45), tumble: brig ? 0.1 : 0.04, wl: 0.5, bulwark: r.range(0.6, 0.85), deadrise: D * 0.2,
    raised: brig ? [[0, 0.16, 0.9, 0.01]] : [],
  });
  const Lv = livery('wood', r, { paint: r() < 0.6 ? r.pick([[0.45, 0.44, 0.4], [0.04, 0.04, 0.04], [0.06, 0.16, 0.1], [0.05, 0.08, 0.16]]) : null });
  const navy = brig && r() < 0.5, year = brig ? r.int(1790, 1865) : r.int(1850, 1925);
  return {
    kind: brig ? 'brig' : 'schooner', label: brig ? (navy ? 'Navy brig' : 'Brig') : 'Schooner', year, H, Lv, seed: o.seed,
    facts: brig ? ['A brig has two masts, both square-rigged: fast, handy ships for trade and for navies.', 'Copper sheathing kept shipworms out of wooden hulls; green copper plates still cling to old wrecks.']
      : ['Schooners are rigged fore-and-aft, so a small crew could sail them: coasting trade workhorses.', 'Big schooners hauled lumber, coal and ice along the coasts well into the 1900s.'],
    hull: { cell: o.hero ? 1.0 : 1.2, strakes: 10, rowsPer: 1, holeThr: r.range(0.66, 0.78), decay: r.range(0.2, 0.5), frames: 0.85,
      impacts: [{ u: r.range(0.3, 0.7), t: r.range(0.3, 0.8), r: r.range(1.5, 3), k: 0.5, side: r.sign() }] },
    deck: { nx: 7, collapse: r() < 0.6 ? [[r.range(0.3, 0.7), r.range(3, 6), 0.5]] : [], thr: r.range(0.66, 0.78), camber: 0.12 },
    cond: o.cond, brokenStates: ['upright', 'list', 'buried'],
    parts: function* (b, S) {
      const { rng } = S, [wc, wf] = wood(S);
      // two masts (raked aft on schooners), bowsprit with jib boom, booms and gaffs, standing rigging
      const ms = brig ? [[0.68, 1.0, 0.27], [0.36, 1.05, 0.29]] : [[0.66, 0.92, 0.24], [0.37, 1.0, 0.26]];
      for (const [u, hk, rr] of ms) {
        if (!S.ok(u)) continue;
        const a = S.at(u), h = L * hk * (brig ? 0.85 : 0.95), keep = rng() < 0.3 ? 1 : rng.range(0.25, 0.75);
        const yards = brig ? [[0.45, B * 0.7, rng.range(-0.5, 0.5)], [0.68, B * 0.55, rng.range(-0.6, 0.6)], [0.86, B * 0.4, rng.range(-0.6, 0.6)]] : [];
        const m = stateMast(S, { p: [0, S.H.keelY(u) + 0.8, a.z], h, r: rr, keep, lean: [rng.range(-0.06, 0.06), brig ? rng.range(-0.04, 0.04) : rng.range(0.06, 0.12)], col: wc, f: wf, seed: S.d.seed + u * 10, top: brig ? 0.55 : 0, yards });
        if (!m) continue;
        if (keep > 0.4 && Math.abs(S.st.roll) < 0.9) for (let q = 0; q < 6; q++) {
          const side = q % 2 ? 1 : -1, e = S.at(u + (q < 2 ? 0.015 : q < 4 ? 0 : -0.015)), top = m.pt(Math.min(keep, 0.55));
          if (rng() < 0.3) continue;
          rope(b, top, [side * (e.x + 0.2), e.y + 0.5, e.z], 0.15, 0.03, rig, wf);
        }
        if (!brig) { // boom along the deck, gaff fallen beside it
          const v0 = b.vc, ang = rng.range(-0.35, 0.35), Lb = L * 0.32;
          cyl(b, [0, a.y + 1.1, a.z + 0.4], [Math.sin(ang) * Lb, a.y + 0.9 + rng() * 0.4, a.z + Math.cos(ang) * Lb], 0.14, 0.11, 6, wc, wf, 3);
          if (rng() < 0.7) cyl(b, [rng.range(-1, 1), a.y + 0.3, a.z + 1], [rng.range(-2, 2), a.y + 0.2, a.z + Lb * 0.7], 0.11, 0.09, 5, wc, wf, 3);
          thin(b, v0);
        }
      }
      yield;
      if (S.ok(0.97, 0) && Math.abs(S.st.roll) < 1.2) { // bowsprit + jib boom
        const a = S.at(0.965), base = [0, a.y + 0.25, a.z + 0.5], dir = [0, Math.sin(0.22), -Math.cos(0.22)], Lb = L * (brig ? 0.25 : 0.38) * (rng() < 0.4 ? rng.range(0.4, 0.8) : 1);
        cyl(b, base, add(base, scl(dir, Lb)), 0.22, 0.1, 6, wc, wf, 3);
        capX(b, base, add(base, scl(dir, Lb)), 0.35);
      }
      if (S.ok(0.5)) { const a = S.at(rng.range(0.45, 0.55)); house(b, { y: a.y, z: a.z, w: a.x * 0.9, h: 1.4, l: L * 0.1, col: wc, f: wf, seed: S.d.seed + 3, missing: rng.range(0, 0.5), collapse: rng() < 0.3, win: { rows: 1, size: [0.35, 0.3], every: 1.2 }, roof: wc }); }
      if (S.ok(0.06)) { // ship's wheel on its pedestal
        const a = S.at(0.07), p = [0, a.y + 1.0, a.z];
        b.box(0.3, 0.9, 0.3, null, 0, a.y + 0.45, a.z, wc, wf);
        ring(b, p, [0, 0, 1], 0.5, 0.04, 0.06, 10, wc, wf);
        for (let k = 0; k < 8; k++) { const t = k / 8 * 6.283; cyl(b, p, [p[0] + Math.cos(t) * 0.7, p[1] + Math.sin(t) * 0.7, p[2]], 0.03, 0.025, 3, wc, wf); }
        S.feat("Ship's wheel", 'Divers often find the wheel first: its spokes stand out as soon as growth covers the hull.', p);
      }
      if (navy) for (let k = 0; k < 7; k++) { // carronades along the bulwarks
        const u = 0.22 + k * 0.08;
        if (!S.ok(u)) continue;
        for (const side of [-1, 1]) {
          if (rng() < 0.35) continue;
          const a = S.at(u);
          carriage(b, [side * (a.x - 0.9), a.y, a.z], Math.PI / 2, [0.17, 0.13, 0.09], wf);
          cannonBarrel(b, [side * (a.x - 1.4), a.y + 0.7, a.z], [side, 0.05, 0], 1.6, [0.1, 0.09, 0.08], [S.Lv.growth, 4]);
        }
      }
      stockAnchors(S, 0.93, 'admiralty', 0.75);
      if (S.ok(0.01, 0)) b.box(0.18, S.H.sheerY(0) - 0.8, 1.1, rotY(rng.range(-0.4, 0.4)), 0, (S.H.sheerY(0) - 0.8) / 2 + 0.3, S.H.zAt(0, 1) + 0.6, wc, wf);
    },
  };
}

// ---------- harbour tug ----------
export function tug(r, o) {
  const L = r.range(21, 31), B = L / r.range(3.2, 3.7), D = B * r.range(0.5, 0.6);
  const H = new HullForm({
    L, B, D, pmb: [0.36, 0.56], entA: 2.1, entB: 0.72, runA: 1.6, runB: 0.6, tw: 0, nMid: 2.8, nBow: 1.8, nStern: 2.0, riseF: D * 0.22, fLen: 0.14,
    riseA: D * 0.5, aLen: 0.13, aExp: 0.8, rake: r.range(0.3, 1), rakeP: 1, over: r.range(0.4, 0.9), overP: 1.5, sheerF: r.range(1.3, 2), sheerA: r.range(0.2, 0.5), flare: 0.15, wl: 0.58, bulwark: r.range(0.75, 0.95), deadrise: D * 0.15,
  });
  const Lv = livery('steel', r, { top: r.pick([[0.06, 0.06, 0.06], [0.25, 0.04, 0.03], [0.04, 0.12, 0.08], [0.05, 0.08, 0.2], [0.35, 0.2, 0.04]]) });
  const band = r.pick([[0.45, 0.06, 0.03], [0.5, 0.48, 0.42], [0.05, 0.12, 0.3], [0.5, 0.35, 0.05]]);
  return {
    kind: 'tug', label: 'Harbour tug', year: r.int(1925, 1985), H, Lv, seed: o.seed,
    facts: ['A harbour tug pulls ships many times its size: what matters is engine power, not size.', 'Tugs hang old tyres along their sides as fenders.'],
    hull: { cell: 1.0, strakes: 6, rowsPer: 2, holeThr: r.range(0.66, 0.78), decay: r.range(0, 0.3) },
    deck: { nx: 6, collapse: [], thr: r.range(0.72, 0.84) },
    cond: o.cond, brokenStates: ['upright', 'list'],
    debris: 'tyre',
    parts: function* (b, S) {
      const { rng } = S, [sc, sf] = paintC(S.Lv, 'top', 0.9), white = [0.42, 0.41, 0.37];
      // deckhouse with portholes, wheelhouse on top, big funnel
      if (S.ok(0.42) && S.ok(0.68)) {
        const a = S.at(0.56), l = L * 0.26;
        house(b, { y: a.y, z: a.z, w: a.x * 1.4, h: 2.2, l, col: white, f: [S.Lv.growth, 4], seed: S.d.seed, missing: rng.range(0, 0.35), win: { rows: 1, size: [0.4, 0.4], every: 1.3 } });
        house(b, { y: a.y + 2.2, z: a.z - l * 0.3, w: a.x * 1.15, h: 2.1, l: l * 0.38, col: white, f: [S.Lv.growth, 4], seed: S.d.seed + 1, missing: rng.range(0, 0.4), collapse: rng() < 0.2, win: { rows: 1, size: [0.7, 0.8], every: 0.95 }, front: rng() < 0.5 ? 'round' : 'flat' });
        S.feat('Wheelhouse', "From the wheelhouse a tug skipper could see all round to nudge ships into their berths.", [0, a.y + 3.5, a.z - l * 0.3]);
        funnel(b, { p: [0, a.y + 2.2, a.z + l * 0.2], r: B * 0.16, rz: B * 0.2, h: D * r.range(0.8, 1.1), rake: rng.range(0.05, 0.15), col: sc, band: [0.55, 0.78, band], f: [S.Lv.growth * 0.6, 4], seed: S.d.seed + 2 });
        stateMast(S, { p: [0, a.y + 4.3, a.z - l * 0.3], h: 3.5, r: 0.12, keep: rng() < 0.5 ? 1 : 0.5, col: sc, f: sf, seed: S.d.seed + 5, yards: [[0.7, 0.8]] });
      }
      yield;
      // towing bitts, towing arches over the aft deck
      for (const u of [0.34, 0.9]) if (S.ok(u)) { const a = S.at(u); bollard(b, [0, a.y, a.z], sc, sf); }
      for (const u of [0.14, 0.22, 0.3]) {
        if (!S.ok(u) || rng() < 0.3) continue;
        const a = S.at(u), pts = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8 * Math.PI; pts.push([-Math.cos(t) * a.x * 0.85, a.y + Math.sin(t) * 1.6, a.z]); }
        pipe(b, pts, 0.09, 5, sc, sf);
      }
      // tyre fenders hanging over the sides, pudding fender on the stem
      const nt = Math.round(L / 1.8);
      for (let k = 0; k < nt; k++) for (const side of [-1, 1]) {
        if (rng() < 0.25) continue;
        const u = 0.12 + (k + 0.5) / nt * 0.76;
        if (!S.ok(u)) continue;
        const sec = S.H.section(u), p = S.H.ptOn(sec, u, 0.93, [0, 0, 0]);
        tyre(b, [side * (p[0] + 0.25), p[1] - 0.2, p[2]], [side, 0.15, 0], 0.42, [0.05, 0.05, 0.05], [0.7, 0]);
      }
      portholes(b, S.info, 0.45, 0.9, { below: 1.0, every: 1.4, r: 0.17 });
      bilgeKeels(b, S.info, 0.36, 0.62, 0.3);
      if (S.ok(0.99, 0)) { const zb = S.H.zAt(1, S.H.sheerY(1) - 1); pipe(b, [[-1.2, S.H.sheerY(0.95) - 0.9, S.H.zAt(0.95, 2)], [0, S.H.sheerY(1) - 0.8, zb - 0.35], [1.2, S.H.sheerY(0.95) - 0.9, S.H.zAt(0.95, 2)]], 0.38, 7, [0.12, 0.1, 0.07], [0.9, 0], 1); }
      stockAnchors(S, 0.94, 'stockless', 0.6);
      sternGear(S, { blades: 4, nozzle: rng() < 0.4, R: D * 0.24, salvaged: 0.1 });
    },
  };
}

// ---------- fishing trawler (side trawler or stern trawler) ----------
export function trawler(r, o) {
  const stern = r() < 0.55, L = r.range(20, 34), B = L / r.range(3.9, 4.6), D = B * r.range(0.55, 0.65);
  const H = new HullForm({
    L, B, D, pmb: [0.33, 0.55], entA: 1.7, entB: 0.85, runA: 1.6, runB: stern ? 0.5 : 0.8, tw: stern ? 0.62 : 0, nMid: 3, nBow: 1.6, nStern: stern ? 3.2 : 2.2,
    riseF: D * 0.2, fLen: 0.12, riseA: D * 0.42, aLen: 0.1, aExp: 0.8, rake: r.range(1, 2.2), rakeP: 1.1, over: stern ? 0.2 : 0.6, overP: 1.4,
    sheerF: r.range(1.4, 2.2), sheerA: r.range(0.3, 0.6), flare: 0.28, wl: 0.6, bulwark: r.range(0.9, 1.1), raised: [[0.82, 1, 1.6]],
  });
  const Lv = livery('steel', r, { top: r.pick([[0.06, 0.1, 0.22], [0.3, 0.05, 0.04], [0.05, 0.16, 0.1], [0.06, 0.06, 0.06], [0.4, 0.22, 0.04], [0.32, 0.32, 0.3]]) });
  return {
    kind: 'trawler', label: stern ? 'Stern trawler' : 'Side trawler', year: r.int(1935, 1990), H, Lv, seed: o.seed,
    facts: ['Trawlers drag a cone-shaped net held open by two heavy otter boards.', 'Lost "ghost nets" keep fishing for years, so divers cut them free from wrecks.'],
    hull: { cell: 1.0, strakes: 6, rowsPer: 2, holeThr: r.range(0.66, 0.78), decay: r.range(0, 0.35) },
    deck: { nx: 6, hatches: [[0.42, 0.5, 0.5]], collapse: [], thr: r.range(0.72, 0.84) },
    cond: o.cond, brokenStates: ['upright', 'list', 'side'],
    parts: function* (b, S) {
      const { rng } = S, [sc, sf] = paintC(S.Lv, 'top', 0.9), white = [0.42, 0.41, 0.37], wf = [S.Lv.growth, 4];
      const uW = stern ? 0.66 : 0.24;
      if (S.ok(uW)) {
        const a = S.at(uW);
        house(b, { y: a.y, z: a.z, w: a.x * 1.35, h: 2.2, l: L * 0.14, col: white, f: wf, seed: S.d.seed, missing: rng.range(0, 0.3), win: { rows: 1, size: [0.45, 0.45], every: 1.2 } });
        house(b, { y: a.y + 2.2, z: a.z - 0.4, w: a.x * 1.1, h: 2.0, l: L * 0.09, col: white, f: wf, seed: S.d.seed + 1, missing: rng.range(0, 0.4), win: { rows: 1, size: [0.7, 0.75], every: 0.9 } });
        S.feat('Wheelhouse', 'Trawler skippers watched echo sounders here to find the fish shoals below.', [0, a.y + 3.4, a.z]);
        const m = stateMast(S, { p: [0, a.y + 4.2, a.z + 1], h: 5, r: 0.13, keep: rng() < 0.6 ? 1 : 0.5, col: sc, f: sf, seed: S.d.seed + 4, top: 0.8, yards: [[0.6, 1.2]] });
        if (!stern && S.ok(0.3)) funnel(b, { p: [0, a.y + 2.2, a.z + L * 0.09], r: B * 0.1, rz: B * 0.13, h: D * 0.9, rake: 0.12, col: sc, f: [S.Lv.growth * 0.6, 4], seed: S.d.seed + 3 });
        void m;
      }
      yield;
      if (stern && S.ok(0.03, 0)) { // A-frame gantry over the stern ramp, net drum, trawl doors
        const a = S.at(0.04), y = a.y, z = a.z, h = D * 1.3;
        for (const side of [-1, 1]) cyl(b, [side * a.x * 0.9, y, z], [side * a.x * 0.75, y + h, z + 0.8], 0.22, 0.2, 6, sc, wf);
        cyl(b, [-a.x * 0.8, y + h, z + 0.8], [a.x * 0.8, y + h, z + 0.8], 0.22, 0.22, 6, sc, wf, 3);
        capX(b, [-a.x, y + h * 0.5, z], [a.x, y + h * 0.5, z], 0.6);
        const ad = S.at(0.15);
        cyl(b, [-a.x * 0.7, ad.y + 1.2, ad.z], [a.x * 0.7, ad.y + 1.2, ad.z], 0.9, 0.9, 12, [0.08, 0.1, 0.12], wf, 3);
        for (const side of [-1, 1]) obox(b, [side * a.x * 0.85, y + h * 0.55, z + 0.6], [side, 0, 0], [0, 1, 0], [0, 0, 1], 0.15, 1.3, 2.4, [0.16, 0.08, 0.05], wf);
        S.feat('Trawl gantry', 'The net is hauled up the stern ramp under the A-frame gantry.', [0, y + h, z]);
      } else if (S.ok(0.6)) { // side trawler: gallows on the side, trawl doors hanging
        for (const u of [0.72, 0.3]) if (S.ok(u)) {
          const a = S.at(u), side = 1, pts = [[side * a.x, a.y, a.z - 0.6], [side * (a.x + 0.5), a.y + 2.6, a.z], [side * a.x, a.y, a.z + 0.6]];
          pipe(b, pts, 0.12, 5, sc, wf);
          obox(b, [side * (a.x + 0.6), a.y + 1.0, a.z], [side, 0, 0], [0, 1, 0], [0, 0, 1], 0.15, 1.2, 2.3, [0.16, 0.08, 0.05], wf);
        }
      }
      if (S.ok(0.5)) { const a = S.at(0.55); winch(b, [0, a.y, a.z], sc, sf); }
      if (rng() < 0.6) for (const side of [-1, 1]) { // outrigger booms raised against the mast
        const a = S.at(stern ? 0.6 : 0.3);
        if (!a || !S.ok(stern ? 0.6 : 0.3)) continue;
        const v0 = b.vc, ang = rng.range(0.4, 1.3);
        cyl(b, [side * a.x * 0.5, a.y + 0.5, a.z], [side * (a.x * 0.5 + Math.sin(ang) * L * 0.35), a.y + 0.5 + Math.cos(ang) * L * 0.35, a.z + 1], 0.1, 0.07, 5, sc, wf, 3);
        thin(b, v0);
      }
      stockAnchors(S, 0.94, 'stockless', 0.65);
      sternGear(S, { blades: 4, nozzle: stern && rng() < 0.4, R: D * 0.22, salvaged: 0.1 });
      portholes(b, S.info, 0.84, 0.97, { below: 0.9, every: 1.2, r: 0.16 });
      bilgeKeels(b, S.info, 0.34, 0.64, 0.32);
    },
  };
}

// ---------- WWII destroyer ----------
export function destroyer(r, o) {
  const L = r.range(64, 86) * (o.hero ? 1 : 0.92), B = L / r.range(9.4, 10.4), D = B * r.range(0.6, 0.68);
  const H = new HullForm({
    L, B, D, pmb: [0.36, 0.55], entA: 1.45, entB: 1.15, runA: 1.9, runB: 0.65, tw: 0.5, nMid: 3.2, nBow: 1.15, nStern: 2.8,
    riseF: D * 0.32, fLen: 0.24, riseA: D * 0.06, aLen: 0.06, rake: r.range(2.8, 4.2), rakeP: 1.3, over: 0, sheerF: r.range(2, 2.8), sheerA: r.range(0.2, 0.45),
    flare: 0.42, wl: 0.6, bulwark: 0, deadrise: D * 0.25, raised: [[0.62, 1, r.range(1.8, 2.4), 0.008]],
  });
  const dz = r() < 0.45;
  const Lv = livery('steel', r, { top: [0.2, 0.22, 0.24], bottom: [0.26, 0.06, 0.04], rust: r.range(0.3, 0.75) });
  if (dz) Lv.dazzle = [[0.22, 0.23, 0.25], [0.1, 0.11, 0.13], [0.04, 0.05, 0.08], [0.3, 0.32, 0.33]];
  return {
    kind: 'destroyer', label: 'Destroyer', year: r.int(1941, 1945), H, Lv, seed: o.seed,
    facts: ['WWII destroyers were fast escorts: about 35 knots, with guns, torpedoes and depth charges.', 'Some warships wore "dazzle" camouflage: bold shapes that made their course hard to judge.', 'Destroyers sunk by torpedoes often broke in two where their long, thin hulls were weakest.'],
    hull: { cell: o.hero ? 1.6 : 1.9, strakes: 7, rowsPer: 2, holeThr: r.range(0.66, 0.78), decay: r.range(0, 0.2),
      impacts: [{ u: r.range(0.3, 0.7), t: r.range(0.2, 0.6), r: r.range(3, 6), k: 0.7, side: r.sign() }] },
    deck: { nx: 6, collapse: r() < 0.6 ? [[r.range(0.3, 0.6), r.range(4, 8), 0.5]] : [], thr: r.range(0.74, 0.86), camber: 0.15 },
    cond: o.cond, breakAt: r.range(0.42, 0.6), brokenStates: ['upright', 'list', 'side', 'list'],
    parts: function* (b, S) {
      const { rng } = S, [gc, gf] = paintC(S.Lv, 'top', 1), dark = [0.16, 0.17, 0.19];
      const hs = (u, w, h, l, y0, k, extra = {}) => { if (!S.ok(u)) return null; const a = S.at(u); house(b, { y: a.y + (y0 || 0), z: a.z, w: w ?? a.x * 1.4, h, l, col: gc, f: gf, seed: S.d.seed + k, missing: rng.range(0, 0.3), ...extra }); return a; };
      // bridge superstructure
      const br = hs(0.71, null, 2.4, L * 0.09, 0, 1, { win: { rows: 1, size: [0.4, 0.4], every: 1.8 } });
      if (br) {
        house(b, { y: br.y + 2.4, z: br.z - 0.5, w: br.x * 1.2, h: 2.2, l: L * 0.06, col: gc, f: gf, seed: S.d.seed + 2, missing: rng.range(0, 0.4), front: 'round', win: { rows: 1, size: [0.55, 0.5], every: 0.8 } });
        S.feat('Bridge', 'The open bridge on top let officers see aircraft coming from every direction.', [0, br.y + 4.5, br.z]);
        const m = stateMast(S, { p: [0, br.y + 4.6, br.z + L * 0.035], h: 9, r: 0.22, keep: rng() < 0.5 ? 1 : rng.range(0.3, 0.7), col: gc, f: gf, seed: S.d.seed + 3, yards: [[0.65, 2.4], [0.85, 1.4]] });
        if (m && m.top) { const v0 = b.vc; b.box(1.6, 0.5, 0.4, null, m.top[0], m.top[1] + 0.2, m.top[2], dark, gf); thin(b, v0); }
      }
      yield;
      // funnels, torpedo tubes, AA tubs, after deckhouse
      for (const [u, k] of [[0.555, 4], [0.45, 5]]) {
        if (!S.ok(u) || rng() < 0.1) continue;
        const a = S.at(u);
        b.box(a.x * 0.9, 1.4, L * 0.05, null, 0, a.y + 0.7, a.z, gc, gf);
        funnel(b, { p: [0, a.y + 1.4, a.z], r: B * 0.13, rz: B * 0.22, h: D * r.range(0.85, 1.1), rake: rng.range(0.1, 0.22), col: gc, top: [0.04, 0.04, 0.04], f: [S.Lv.growth * 0.6, 4], seed: S.d.seed + k, holes: rng.range(0, 0.2), pipe: false });
      }
      for (const u of [0.5, 0.385]) if (S.ok(u)) { const a = S.at(u); torpedoTubes(b, [0, a.y, a.z], rng.range(-0.8, 0.8) + (rng() < 0.5 ? Math.PI : 0), gc, gf); S.feat('Torpedo tubes', 'A quintuple mount fired five 21-inch torpedoes; the tubes trained out over the side.', [0, a.y + 1, a.z]); }
      for (const [u, sx] of [[0.6, 1], [0.6, -1], [0.33, 1], [0.33, -1]]) if (S.ok(u) && rng() < 0.7) { const a = S.at(u); aaTub(b, [sx * a.x * 0.6, a.y, a.z], rng() * 6.28, gc, gf); }
      const aft = hs(0.29, null, 2.2, L * 0.07, 0, 6, { win: { rows: 1, size: [0.35, 0.35], every: 2.4 } });
      yield;
      // 5-inch gun mounts: two forward (one superfiring), three aft
      const guns = [[0.87, 0, 0], [0.8, 1.6, 0], [0.27, 2.2, Math.PI], [0.18, 0, Math.PI], [0.09, 0, Math.PI]];
      for (const [u, raise, base] of guns) {
        if (!S.ok(u)) continue;
        const a = S.at(u);
        if (raise && !(u < 0.3 && aft)) b.box(4.2, raise, 4.6, null, 0, a.y + raise / 2, a.z, gc, gf);
        gunMount(b, [0, a.y + raise, a.z], base + rng.range(-1.2, 1.2), 0.85, gc, gf, false, rng.range(0, 0.6));
      }
      S.feat('5-inch gun mount', 'The 5-inch/38 gun could fire at both ships and aircraft: the best dual-purpose gun of the war.', [0, S.at(0.87).y + 1.5, S.at(0.87).z]);
      // depth charge racks at the transom
      if (S.ok(0.02, 0)) for (const sx of [-1, 1]) {
        const a = S.at(0.03);
        for (let k = 0; k < 4; k++) cyl(b, [sx * a.x * 0.55, a.y + 0.35, a.z - k * 0.8], [sx * a.x * 0.55 + 0.01, a.y + 0.35 + 0.6, a.z - k * 0.8], 0.3, 0.3, 8, dark, gf, 3);
        S.feat('Depth charges', 'Depth charges rolled off the stern racks to explode at a set depth near a submarine.', [sx * a.x * 0.55, a.y + 0.8, a.z]);
      }
      railing(b, S.info, rng, { h: 0.95, every: 1.8, gaps: 0.45, col: gc });
      portholes(b, S.info, 0.66, 0.95, { below: 1.1, every: 1.5, r: 0.17 });
      bilgeKeels(b, S.info, 0.32, 0.62, 0.42);
      stockAnchors(S, 0.92, 'stockless', 0.85);
      sternGear(S, { twin: true, blades: 3, R: D * 0.2, salvaged: 0.15, rudders: 2 });
    },
  };
}

// ---------- sailing yacht (GRP, fin keel; usually lies on its side) ----------
export function yacht(r, o) {
  const L = r.range(9, 15.5), B = L / r.range(2.9, 3.4), D = B * r.range(0.36, 0.44);
  const H = new HullForm({
    L, B, D, pmb: [0.36, 0.5], entA: 1.6, entB: 0.9, runA: 1.5, runB: 0.6, tw: r.range(0.55, 0.75), nMid: 2.2, nBow: 1.35, nStern: 3.6,
    riseF: D * 0.5, fLen: 0.28, riseA: D * 0.32, aLen: 0.3, aExp: 1, rake: r.range(0.6, 1.4), rakeP: 0.8, over: r.range(0.3, 0.9), overP: 1, sheerF: r.range(0.25, 0.5), sheerA: 0.08,
    flare: 0.1, wl: 0.45, deadrise: D * 0.35,
  });
  const Lv = livery('grp', r);
  return {
    kind: 'yacht', label: 'Sailing yacht', year: r.int(1972, 2012), H, Lv, seed: o.seed,
    facts: ['A heavy keel bulb keeps a yacht upright; once sunk, the keel usually tips it onto its side.', 'Fibreglass hardly decays: sunken yachts stay whole for decades while sponges cover them.'],
    hull: { cell: 0.7, strakes: 6, rowsPer: 2, th: 0.05, holeThr: r.range(0.76, 0.86), decay: 0, frames: 0 },
    deck: { nx: 6, collapse: [], thr: 0.85, th: 0.05, color: (x, y, z, c) => { c[0] = c[0] * 0.5 + 0.22; c[1] = c[1] * 0.5 + 0.22; c[2] = c[2] * 0.5 + 0.2; c[4] = 0; } },
    cond: o.cond, brokenStates: ['side'],
    parts: function* (b, S) {
      const { rng } = S, top = paintC(S.Lv, 'top', 1), bot = paintC(S.Lv, 'bottom', 1), ff = [S.Lv.growth, 0];
      // fin keel with bulb, spade rudder
      const zk = S.H.zAt(0.52, 0), kd = D * 1.25, ch = L * 0.13;
      const v0 = b.vc;
      b.box(0.2, kd, ch, rotX(0.18), 0, -kd / 2 + 0.2, zk, bot[0], ff);
      cyl(b, [0, -kd + 0.15, zk - ch * 0.9], [0, -kd + 0.15, zk + ch * 0.9], 0.3, 0.22, 10, [0.15, 0.15, 0.14], ff, 3);
      b.box(0.14, D * 0.9, L * 0.07, rotX(0.1), 0, -D * 0.25, S.H.zAt(0.1, 0), bot[0], ff);
      void v0;
      // cabin top with windows, cockpit coaming
      if (S.ok(0.55)) { const a = S.at(0.55); house(b, { y: a.y, z: a.z, w: a.x * 1.2, h: 0.7, l: L * 0.32, col: top[0], f: ff, seed: S.d.seed, missing: 0, win: { rows: 1, size: [0.8, 0.22], every: 1.3 }, overhang: 0.05 }); }
      if (S.ok(0.2)) { const a = S.at(0.2); for (const s of [-1, 1]) b.box(0.08, 0.35, L * 0.2, null, s * a.x * 0.6, a.y + 0.17, a.z, top[0], ff); }
      railing(b, S.info, rng, { h: 0.65, every: 1.2, gaps: 0.3, col: [0.3, 0.3, 0.3] });
      // the mast: standing, snapped, or lying to the sand
      if (S.ok(0.62)) {
        const a = S.at(0.62);
        stateMast(S, { p: [0, a.y, a.z], h: L * 1.25, r: 0.1, keep: rng() < 0.6 ? 1 : rng.range(0.2, 0.5), col: [0.32, 0.33, 0.33], f: ff, seed: S.d.seed + 2, yards: [[0.6, 0.7]] });
        const v1 = b.vc;
        cyl(b, [0, a.y + 0.9, a.z], [0, a.y + 0.9 + rng.range(-0.2, 0.4), a.z + L * 0.35], 0.07, 0.07, 5, [0.3, 0.3, 0.3], ff, 3);
        thin(b, v1);
      }
      if (S.ok(0.03, 0)) { const a = S.at(0.03); ring(b, [0, a.y + 0.6, a.z], [0, 0, 1], 0.32, 0.03, 0.05, 10, [0.25, 0.25, 0.25], ff); } // wheel
      yield;
    },
  };
}

// ---------- paddle steamer (side-wheeler with walking beam) ----------
export function paddle(r, o) {
  const L = r.range(40, 58) * (o.hero ? 1 : 0.92), B = L / r.range(7, 8), D = B * r.range(0.4, 0.48), iron = r() < 0.5;
  const H = new HullForm({
    L, B, D, pmb: [0.3, 0.65], entA: 1.7, entB: 1, runA: 1.6, runB: 0.9, tw: 0.42, nMid: 5, nBow: 1.5, nStern: 2.2, riseF: D * 0.25, fLen: 0.1,
    riseA: D * 0.2, aLen: 0.06, rake: r.range(0.8, 1.6), rakeP: 1.6, over: r.range(0.6, 1.2), overP: 1, sheerF: r.range(0.5, 1.0), sheerA: r.range(0.2, 0.4), wl: 0.5, bulwark: 0.5,
  });
  const Lv = livery(iron ? 'steel' : 'wood', r, iron ? { top: [0.08, 0.08, 0.08], bottom: [0.25, 0.06, 0.04] } : {});
  return {
    kind: 'paddle', label: 'Paddle steamer', year: r.int(1840, 1905), H, Lv, seed: o.seed,
    facts: ['Paddle steamers drove two big wheels with a "walking beam" that rocked up and down above the deck.', 'Paddle wheels were placed amidships, inside curved boxes that kept the spray off the passengers.'],
    hull: { cell: 1.4, strakes: iron ? 6 : 10, rowsPer: iron ? 2 : 1, holeThr: r.range(0.64, 0.76), decay: r.range(0.1, 0.45) },
    deck: { nx: 7, collapse: [[r.range(0.3, 0.7), r.range(4, 8), 0.5]], thr: r.range(0.68, 0.8) },
    cond: o.cond, brokenStates: ['upright', 'list'],
    parts: function* (b, S) {
      const { rng } = S, wc = [0.32, 0.29, 0.24], wf = [S.Lv.growth, 0], ic = [0.15, 0.08, 0.05], iff = [S.Lv.growth, 4];
      // paddle boxes and wheels amidships, the guard deck over them
      if (S.ok(0.46) && S.ok(0.56)) {
        const a = S.at(0.51), Rw = D * 1.05, wdt = B * 0.32;
        for (const side of [-1, 1]) {
          const cx = side * (a.x + wdt / 2 + 0.4), cy = a.y - D * 0.25;
          paddleWheel(b, [cx, cy, a.z], Rw, wdt, ic, iff, rng() * 6, rng.range(0.1, 0.5));
          if (rng() < 0.75) { // the curved paddle box (outer wall + arched cover), half rotted away
            const pts = [];
            for (let k = 0; k <= 9; k++) { const t = k / 9 * Math.PI; pts.push([cx + side * wdt * 0.55, cy + Math.sin(t) * (Rw + 0.4), a.z + Math.cos(t) * (Rw + 0.4)]); }
            pipe(b, pts, 0.12, 4, wc, wf);
            for (let k = 0; k < 9; k++) if (rng() > 0.35) { const p = pts[k], q = pts[k + 1]; obox(b, [(p[0] + q[0]) / 2 - side * wdt * 0.5, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], wdt * 1.05, 0.08, Math.hypot(p[1] - q[1], p[2] - q[2]) + 0.05, wc, wf); }
          }
          // guard deck slab along the side
          b.box(wdt * 1.1, 0.16, L * 0.5, null, side * (a.x + wdt * 0.55), a.y - 0.1, a.z, wc, wf);
        }
        S.feat('Paddle wheel', 'Each float of the paddle wheel dipped in turn, pushing the steamer along like a giant water mill.', [a.x + wdt, a.y, a.z]);
      }
      yield;
      // saloon deckhouse with many windows, pilot house, twin tall funnels, walking beam
      const roll = Math.abs(S.st.roll) > 0.9;
      if (S.ok(0.3) && S.ok(0.75)) {
        const a = S.at(0.52), l = L * 0.42;
        house(b, { y: a.y, z: a.z, w: a.x * 1.7, h: 2.4, l, col: wc, f: wf, seed: S.d.seed, missing: rng.range(0.2, 0.6), collapse: rng() < 0.4, win: { rows: 1, size: [0.5, 0.9], every: 1.1 } });
        if (!roll && rng() < 0.7) house(b, { y: a.y + 2.5, z: a.z - l * 0.38, w: 2.6, h: 2.0, l: 2.6, col: wc, f: wf, seed: S.d.seed + 1, missing: 0.3, win: { rows: 1, size: [0.6, 0.7], every: 0.8 } });
        for (const sx of [-1, 1]) {
          if (rng() < 0.2) continue;
          const h = L * r.range(0.18, 0.26), keep = rng() < 0.5 ? 1 : rng.range(0.3, 0.7);
          const m = stateMast(S, { p: [sx * 1.3, a.y + 2.4, a.z - l * 0.12], h, r: 0.42, keep, col: [0.06, 0.05, 0.05], f: iff, seed: S.d.seed + sx });
          if (m && keep === 1 && !roll) ring(b, m.top, [0, 1, 0], 0.6, 0.12, 0.3, 10, [0.06, 0.05, 0.05], iff);
        }
        if (!roll) { // walking beam on its A-frame
          const zb = a.z + l * 0.02, yb = a.y + 2.4 + 4.5, ang = rng.range(-0.3, 0.3), half = 3.4;
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(b, [sx * 0.9, a.y + 2.4, zb + sz * 2.2], [0, yb, zb], 0.12, 0.1, 5, ic, iff);
          const e0 = [0, yb - Math.sin(ang) * half, zb - Math.cos(ang) * half], e1 = [0, yb + Math.sin(ang) * half, zb + Math.cos(ang) * half];
          pipe(b, [e0, [0, yb + 0.6, zb], e1, [0, yb - 0.6, zb], e0], 0.1, 4, ic, iff);
          capX(b, e0, e1, 0.8);
          S.feat('Walking beam', 'The rocking walking beam turned the steam piston’s push into the turning of the paddle shaft.', [0, yb, zb]);
        }
      }
      sternGear(S, { blades: 0, salvaged: 1 });
      stockAnchors(S, 0.94, 'admiralty', 0.75);
    },
  };
}

// ---------- tanker / container-ship midship sections ----------
export function section(r, o, cont) {
  const B = cont ? r.range(16, 20) : r.range(17, 22), Lf = B * (cont ? 7 : 7.5), D = B * (cont ? r.range(0.55, 0.62) : r.range(0.6, 0.66));
  const len = r.range(22, 32), u0 = 0.5 - len / Lf / 2;
  const H = new HullForm({ L: Lf, B, D, pmb: [0.2, 0.75], nMid: 12, riseF: 1, riseA: 1, rake: 0, over: 0, sheerF: 0.3, sheerA: 0.2, wl: 0.6, bulwark: cont ? 0 : 1.0 });
  const Lv = livery('steel', r, { top: cont ? r.pick([[0.04, 0.12, 0.2], [0.3, 0.05, 0.04], [0.06, 0.06, 0.06], [0.05, 0.14, 0.08]]) : r.pick([[0.06, 0.06, 0.06], [0.25, 0.06, 0.04], [0.2, 0.21, 0.22]]) });
  return {
    kind: cont ? 'container' : 'tanker', label: cont ? 'Container ship section' : 'Tanker section', year: cont ? r.int(1975, 2015) : r.int(1955, 1995), H, Lv, seed: o.seed,
    facts: cont ? ['A container ship carries thousands of steel boxes; in storms whole stacks can topple overboard.', 'Lost containers become reefs: sponges and anemones move in within months.']
      : ['Big tankers are divided into many tanks by steel bulkheads, so one hole cannot flood the whole ship.', 'Wrecked tankers have their oil pumped out first; the empty hull then becomes a reef.'],
    hull: { cell: 2.0, strakes: 8, rowsPer: 2, holeThr: r.range(0.66, 0.76), decay: 0.1, frames: 2.6 },
    deck: { nx: 8, hatches: [], collapse: cont ? [] : [[0.5, r.range(3, 6), 0.4]], thr: r.range(0.74, 0.84) },
    cutLo: u0, cutHi: u0 + len / Lf, part: '',
    cond: o.cond === 'broken' ? 'list' : o.cond,
    debris: cont ? 'containers' : null,
    parts: function* (b, S) {
      const { rng } = S, [sc, sf] = paintC(S.Lv, 'top', 0.85), info = S.info, um = (info.cutLo + info.cutHi) / 2;
      // internal structure at the torn ends: longitudinal bulkheads and web frames (the cellular look of a big hull)
      const a = S.at(um), zA = S.at(info.cutLo + 0.004).z, zB = S.at(info.cutHi - 0.004).z, dk = [0.14, 0.065, 0.04];
      for (const x of cont ? [-B * 0.42, B * 0.42] : [-B / 6, B / 6]) for (let z = Math.min(zA, zB) + 1; z < Math.max(zA, zB) - 1; z += 4.2) if (rng() > 0.2) obox(b, [x, D * 0.52, z + 2.1], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.12, D * 0.9, 4.1, dk, sf);
      for (let k = 1; k < 4; k++) { const i = Math.round(info.nu * k / 4); if (rng() < 0.7) bulkhead(b, info, i, rng, 0.35); }
      bilgeKeels(b, info, 0, 1, 0.6);
      yield;
      if (!cont) { // pipelines, catwalk, manifold
        for (let k = -2; k <= 2; k++) if (rng() > 0.15) cyl(b, [k * 0.7, a.y + 0.5, zA + 0.5], [k * 0.7, a.y + 0.5, zB - 0.5], 0.22, 0.22, 7, [0.2, 0.09, 0.05], sf);
        for (let z = Math.min(zA, zB) + 2; z < Math.max(zA, zB) - 1; z += 3) { cyl(b, [2.6, a.y, z], [2.6, a.y + 2.2, z], 0.08, 0.08, 4, sc, sf); }
        b.box(1.2, 0.12, Math.abs(zB - zA) - 1, null, 2.6, a.y + 2.25, (zA + zB) / 2, sc, sf);
        for (const sx of [-1, 1]) { cyl(b, [sx * 3.6, a.y, a.z], [sx * 3.6, a.y + 1.4, a.z], 0.35, 0.35, 8, sc, sf); cyl(b, [sx * 3.6, a.y + 1.2, a.z], [sx * (a.x - 0.5), a.y + 1.2, a.z], 0.3, 0.3, 8, sc, sf); }
        S.feat('Cargo manifold', 'Hoses at the manifold loaded and discharged the oil; pipes run to every tank.', [3.6, a.y + 1.2, a.z]);
        if (rng() < 0.7) derrick(b, { p: [0, a.y, a.z + 3], h: 5, col: sc, f: sf, seed: S.d.seed, boomLen: 9 });
      } else { // container stacks, some toppled; cell guides in the hold
        const cols = [[0.05, 0.25, 0.45], [0.55, 0.12, 0.08], [0.1, 0.35, 0.18], [0.65, 0.42, 0.08], [0.45, 0.45, 0.45], [0.55, 0.3, 0.1], [0.12, 0.15, 0.35]];
        const n = Math.floor(a.x * 2 / 2.5), tiers = 2 + Math.floor(rng() * 3), bays = Math.floor(Math.abs(zB - zA) / 13);
        for (let bay = 0; bay < bays; bay++) for (let c = 0; c < n; c++) {
          const ht = tiers - Math.floor(rng() * (tiers + 1));
          for (let t = 0; t < ht; t++) {
            const toppled = t > 0 && rng() < 0.25, z = Math.min(zA, zB) + 7 + bay * 13;
            const R = toppled ? mul3(rotZ(rng.range(-0.6, 0.6)), rotY(rng.range(-0.3, 0.3))) : null;
            boxContainer(b, [(c - (n - 1) / 2) * 2.5, a.y + 0.6 + t * 2.6, z], R, 12.2, cols[(rng() * cols.length) | 0], sf);
          }
        }
        for (let z = Math.min(zA, zB) + 2; z < Math.max(zA, zB) - 2; z += 6.3) for (const sx of [-1, 1]) obox(b, [sx * a.x * 0.8, a.y - D * 0.4, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.2, D * 0.8, 0.2, sc, sf);
        S.feat('Container stacks', 'Containers are locked to each other with twist-locks at their corners.', [0, a.y + 3, a.z]);
      }
    },
  };
}
// a corrugated 20' / 40' box container (cheap), base centred at p, axis along z, optional rotation
export function boxContainer(b, p, R, L, col, f) {
  const v0 = b.vc, W = 2.44, Hh = 2.6, n = Math.round(L * 1.6);
  for (const sx of [-1, 1]) {
    const s0 = b.vc;
    for (let k = 0; k <= n; k++) { const z = (k / n - 0.5) * L, dx = (k % 2 ? 0.035 : 0); for (const y of [0, Hh]) b.v(sx * (W / 2 + dx), y, z, sx, 0, 0, col[0], col[1], col[2], f[0], 4); }
    for (let k = 0; k < n; k++) { const a = s0 + k * 2; if (sx > 0) { b.t(a, a + 2, a + 1); b.t(a + 1, a + 2, a + 3); } else { b.t(a, a + 1, a + 2); b.t(a + 1, a + 3, a + 2); } }
    b.smooth(s0, b.I.length - n * 6);
  }
  b.box(W + 0.07, 0.08, L, null, 0, Hh, 0, col, [f[0], 4]);
  b.box(W, Hh, 0.06, null, 0, Hh / 2, -L / 2, col.map((c) => c * 0.8), [f[0], 4]);
  b.box(W, Hh, 0.06, null, 0, Hh / 2, L / 2, col.map((c) => c * 0.7), [f[0], 4]);
  b.xform(v0, R || [1, 0, 0, 0, 1, 0, 0, 0, 1], p[0], p[1], p[2]);
}

// ---------- small boats ----------
// kind: 'rowboat' (clinker, transom), 'longboat' (ship's boat), 'lifeboat' (double-ended), 'dinghy' (GRP), 'skiff' (outboard)
export function smallBoat(r, o, kind) {
  const P = {
    rowboat: { L: [3.6, 5], LB: 3.1, DB: 0.42, tw: 0.5, mat: 'wood', name: 'Rowing boat' },
    longboat: { L: [6.5, 9], LB: 3.4, DB: 0.4, tw: 0.45, mat: 'wood', name: "Ship's longboat" },
    lifeboat: { L: [6.5, 8.5], LB: 2.9, DB: 0.45, tw: 0, mat: r() < 0.5 ? 'steel' : 'wood', name: "Ship's lifeboat" },
    dinghy: { L: [2.6, 3.6], LB: 2.3, DB: 0.4, tw: 0.75, mat: 'grp', name: 'Dinghy' },
    skiff: { L: [4.2, 6], LB: 2.6, DB: 0.38, tw: 0.8, mat: 'grp', name: 'Outboard skiff' },
  }[kind];
  const L = r.range(P.L[0], P.L[1]), B = L / P.LB, D = B * P.DB * 1.6;
  const H = new HullForm({ L, B, D, pmb: [0.4, 0.55], entA: 1.7, entB: 0.85, runA: 1.6, runB: 0.7, tw: P.tw, nMid: P.mat === 'grp' ? 3 : 2.2, nBow: 1.4, nStern: P.tw ? 2.5 : 1.5,
    riseF: D * 0.3, fLen: 0.2, riseA: D * 0.12, aLen: 0.1, rake: L * 0.06, rakeP: 1.2, over: P.tw ? 0.05 : L * 0.04, sheerF: D * 0.35, sheerA: D * 0.2, wl: 0.5, deadrise: D * 0.25 });
  const Lv = livery(P.mat, r, P.mat === 'wood' ? { paint: r() < 0.5 ? r.pick([[0.45, 0.44, 0.4], [0.06, 0.16, 0.1], [0.1, 0.18, 0.35], [0.4, 0.08, 0.05]]) : null } : P.mat === 'steel' ? { top: [0.45, 0.25, 0.05], rust: 0.6 } : {});
  return {
    kind, label: P.name, year: null, H, Lv, seed: o.seed, small: true,
    facts: kind === 'lifeboat' ? ["Ship's lifeboats are double-ended so they handle waves from behind as well as ahead.", 'Air tanks under the seats kept lifeboats afloat even when swamped.']
      : kind === 'longboat' ? ["A sailing ship's longboat carried anchors, water casks and crew between ship and shore."]
        : kind === 'rowboat' ? ['Clinker boats are built of overlapping planks riveted together: light and strong.'] : ['Small boats are the most common wrecks of all: thousands sink at their moorings every year.'],
    hull: { cell: 0.45, strakes: P.mat === 'wood' ? 7 : 4, rowsPer: P.mat === 'wood' ? 1 : 2, th: P.mat === 'grp' ? 0.035 : 0.05, lap: 0.02, holeThr: r.range(0.7, 0.86), decay: P.mat === 'wood' ? r.range(0, 0.4) : 0, frames: P.mat === 'wood' ? 0.45 : 0 },
    deck: null, cond: o.cond,
    parts: function* (b, S) {
      const { rng } = S, wc = P.mat === 'grp' ? [0.4, 0.4, 0.38] : [0.26, 0.2, 0.14], wf = [S.Lv.growth, 0];
      // thwarts (seats) across the boat, oars
      for (let k = 0; k < Math.max(2, Math.round(L / 1.5)); k++) {
        const u = 0.2 + (k + 0.5) / Math.max(2, Math.round(L / 1.5)) * 0.6, a = S.at(u);
        if (rng() < 0.15) continue;
        b.box(a.x * 2 - 0.1, 0.05, 0.24, null, 0, a.y - D * 0.35, a.z, wc, wf);
      }
      if (kind === 'skiff' && S.ok(0.01, 0)) { const a = S.at(0.02); b.box(0.35, 0.5, 0.45, null, 0, a.y + 0.2, a.z + 0.35, [0.1, 0.1, 0.1], wf); cyl(b, [0, a.y, a.z + 0.4], [0, a.y - D - 0.3, a.z + 0.45], 0.06, 0.06, 5, [0.1, 0.1, 0.1], wf); S.feat('Outboard motor', 'Two-stroke outboards made small boats fast and cheap from the 1950s on.', [0, a.y, a.z + 0.4]); }
      if (P.mat === 'wood' && rng() < 0.6) { const a = S.at(0.5), v0 = b.vc; cyl(b, [-a.x * 0.5, a.y - D * 0.3, a.z - L * 0.3], [a.x * 0.3, a.y - D * 0.25, a.z + L * 0.25], 0.035, 0.035, 4, wc, wf, 3); thin(b, v0); }
      yield;
    },
  };
}
