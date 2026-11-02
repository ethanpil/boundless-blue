// Dome audit for the sunken cities: proves that every dome and prang crown in a generated ruin rests on what
// is built under it, that no piece of a holed dome hangs from nothing, and that every shard of a fallen dome
// lies on the floor. It works on finished templates (the full triangle soup, not the kit's bookkeeping):
//   browser: load with ?biome=ruins&domeaudit=1 (or set window.__ruinsDomeAudit before chunks build), then
//            (await import('/src/props/ruins_audit.js')).auditAll()
//   node:    tools/audit/domes.mjs (every style, several seeds, the real populators and a direct stress test)
import { DOME_LOG } from './ruins_kit.js';

// 2D bucket grid over a template's triangles (xz), for vertical rays
function triGrid(t, cell = 0.5) {
  if (t._dgrid) return t._dgrid;
  const [x0, , z0, x1, , z1] = t.box, nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const cells = new Map(), P = t.pos, I = t.idx;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const i0 = Math.floor((Math.min(P[a], P[b], P[c]) - x0) / cell), i1 = Math.floor((Math.max(P[a], P[b], P[c]) - x0) / cell);
    const j0 = Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z0) / cell), j1 = Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z0) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const q = j * nx + i; let l = cells.get(q); if (!l) cells.set(q, (l = [])); l.push(k); }
  }
  return (t._dgrid = { x0, z0, cell, nx, nz, cells });
}
// highest surface of the template at (x, z) not above yMax, ignoring triangles with index offset in [s0, s1)
function surfBelow(t, x, z, yMax, s0, s1) {
  const G = triGrid(t), i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
  if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return -Infinity;
  const l = G.cells.get(j * G.nx + i);
  if (!l) return -Infinity;
  const P = t.pos, I = t.idx;
  let best = -Infinity;
  for (const k of l) {
    if (k >= s0 && k < s1) continue;
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const xa = P[a], za = P[a + 2], xb = P[b], zb = P[b + 2], xc = P[c], zc = P[c + 2];
    const d = (zb - zc) * (xa - xc) + (xc - xb) * (za - zc);
    if (Math.abs(d) < 1e-12) continue;
    const w0 = ((zb - zc) * (x - xc) + (xc - xb) * (z - zc)) / d, w1 = ((zc - za) * (x - xc) + (xa - xc) * (z - zc)) / d, w2 = 1 - w0 - w1;
    if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
    const y = w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[c + 1];
    if (y <= yMax && y > best) best = y;
  }
  return best;
}
// pieces of a dome shell (front triangles i0 .. mid) that touch no base-ring vertex
function floatingPieces(t, D) {
  const I = t.idx, mid = D.i0 + (D.i1 - D.i0) / 2, par = new Map();
  const f = (v) => {
    if (!par.has(v)) { par.set(v, v); return v; }
    let r = v; while (par.get(r) !== r) r = par.get(r);
    while (v !== r) { const n = par.get(v); par.set(v, r); v = n; }
    return r;
  };
  const uni = (a, b) => { const ra = f(a), rb = f(b); if (ra !== rb) par.set(rb, ra); };
  for (let k = D.i0; k < mid; k += 3) { uni(I[k], I[k + 1]); uni(I[k], I[k + 2]); }
  // the grid repeats its first column at the seam (u = 1): those vertices coincide, so they join
  for (let v = D.v0; v < D.inner; v += D.cols) if (par.has(v) && par.has(v + D.nu)) uni(v, v + D.nu);
  const based = new Set(), roots = new Set();
  for (let k = D.i0; k < mid; k++) { const v = I[k], r = f(v); roots.add(r); if (v >= D.v0 && v < D.v0 + D.cols) based.add(r); }
  let n = 0; for (const r of roots) if (!based.has(r)) n++;
  return n;
}

// Audit one template. Domes and crowns: each base sample (mid-shell for a dome, 0.7 of the radius for a
// prang) needs a surface of the building within `tol` below it (or above it: sunk in). Fallen shards: the
// lowest point of every shard must touch the floor or the building (gap <= tol / 2).
export function domeAudit(t, tol = 0.05) {
  const out = [];
  for (const D of t.domes || []) {
    const P = t.pos, r = { kind: D.kind, n: 0, ok: 0, maxGap: -Infinity, pieces: 0 };
    if (D.kind === 'fallen') {
      let g = Infinity;
      for (let v = D.v0; v < D.v0 + D.n; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        const s = Math.max(t.site ? t.site.fl(x, z) : -Infinity, surfBelow(t, x, z, y + 0.3, D.i0, D.i2));
        g = Math.min(g, y - s);
      }
      r.n = 1; r.ok = g <= tol / 2 ? 1 : 0; r.maxGap = g;
    } else {
      let cx = 0, cz = 0;
      for (let i = 0; i < D.nu; i++) { cx += P[(D.v0 + i) * 3] / D.nu; cz += P[(D.v0 + i) * 3 + 2] / D.nu; }
      for (let i = 0; i < D.nu; i++) {
        const a = (D.v0 + i) * 3;
        let x = P[a], y = P[a + 1], z = P[a + 2];
        if (D.kind === 'dome') { const b = (D.inner + i) * 3; x = (x + P[b]) / 2; y = (y + P[b + 1]) / 2; z = (z + P[b + 2]) / 2; }
        else { x = cx + (x - cx) * D.scale; z = cz + (z - cz) * D.scale; }
        const g = y - surfBelow(t, x, z, y + 0.6, D.i0, D.i2);
        r.n++; if (g <= tol) r.ok++;
        if (g > r.maxGap) r.maxGap = g;
      }
      if (D.kind === 'dome') r.pieces = floatingPieces(t, D);
    }
    r.carried = r.ok / Math.max(1, r.n);
    // a dome passes when >= 95 % of its ring is carried (the kit builds one only when all 72 of its samples are;
    // the audit samples the ring vertices of the finished mesh, which can land on a joint) and nothing hangs loose
    r.pass = D.kind === 'fallen' ? r.ok === 1 : r.carried >= 0.95 && r.pieces === 0;
    out.push(r);
  }
  return out;
}

// Audit every logged template; returns totals and the failures (label, kind, carried share, worst gap)
export function auditAll(list = DOME_LOG, tol = 0.05) {
  const sum = { templates: list.length, dome: 0, prang: 0, fallen: 0, fail: [], minCarried: 1, maxGap: -Infinity };
  for (const t of list) for (const r of domeAudit(t, tol)) {
    sum[r.kind]++;
    if (r.kind !== 'fallen') { sum.minCarried = Math.min(sum.minCarried, r.carried); sum.maxGap = Math.max(sum.maxGap, r.maxGap); }
    if (!r.pass) sum.fail.push({ label: t.label, kind: r.kind, carried: +r.carried.toFixed(2), gap: +r.maxGap.toFixed(3), pieces: r.pieces });
  }
  return sum;
}
