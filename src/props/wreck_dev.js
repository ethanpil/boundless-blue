// Dev helpers for the wrecks (not loaded by the app). In the browser console:
//   const w = await import('/src/props/wreck_dev.js');
//   await w.show('freighter', 3, { cond: 'list' });   // builds one design beside the path ahead and frames it
//   w.orbit(0.8, 0.35, 1.2);                          // azimuth (rad), elevation (rad), distance factor
//   w.clear();                                        // remove the preview, give the camera back
//   await w.show('destroyer', 7, { cond: 'capsized', growth: 40 }); // + fans / sponges / anemones as placed in game
import * as THREE from 'three';
import { MAT } from './materials.js';
import { designFor, KINDS, specs } from './wreck.js';
import { make } from './wreck_types.js';
import { groundY, pickW } from './scatter.js';
import { rotY, orient, Batch, TAU } from './core.js';
import { mulberry32 } from '../noise.js';

const st = { meshes: [], cam: null, wrapped: false, center: null, size: 10 };
export { KINDS };

function wrap() {
  if (st.wrapped) return;
  const o = window.__ocean, d = o.director, orig = d.update.bind(d);
  d.update = (...a) => {
    const r = orig(...a);
    if (st.cam && st.center) {
      const wz = o.world.position.z, c = st.center, [az, el, k] = st.cam, R = st.size * k;
      o.camera.position.set(c[0] + Math.sin(az) * Math.cos(el) * R, c[1] + Math.sin(el) * R, c[2] + wz + Math.cos(az) * Math.cos(el) * R);
      o.camera.lookAt(c[0], c[1], c[2] + wz);
      o.camera.updateMatrixWorld();
    }
    return r;
  };
  st.wrapped = true;
}

export function clear() {
  const o = window.__ocean;
  for (const m of st.meshes) { o.world.remove(m); m.geometry.dispose(); }
  st.meshes.length = 0; st.cam = null; st.center = null;
}

// build design `kind` with `seed` and show it ahead of the camera, `ahead` m along the path, `side` m off it
export async function show(kind, seed = 1, opt = {}) {
  clear(); wrap();
  const o = window.__ocean, s0 = o.director.camera ? -(o.camera.position.z - o.world.position.z) : 0;
  const s = s0 + (opt.ahead ?? 45), t0 = performance.now();
  const d = designFor(kind, seed, { cond: opt.cond || 'upright', hero: true, tier: o.tier });
  const g = make(d);
  let r; do r = g.next(); while (!r.done);
  const ms = performance.now() - t0, pieces = r.value;
  let off = 0, c = null, size = 0;
  for (const tpl of pieces) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(tpl.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(tpl.nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(tpl.col, 3));
    geo.setAttribute('aFx', new THREE.BufferAttribute(tpl.fx, 2));
    geo.setIndex(new THREE.BufferAttribute(tpl.idx, 1));
    const m = new THREE.Mesh(geo, MAT.static);
    const ss = s + off, x = o.shape.pathX(ss) + (opt.side ?? 14), yaw = opt.yaw ?? 0.3;
    const fy = o.shape.floorAt(x, ss), R = rotY(yaw);
    const y = groundY({ at: (px, ps) => o.shape.floorAt(px, ps) }, x, ss, tpl, R, 1, 1, 1) - (tpl.sinkK ?? 0.25);
    m.position.set(x, y, -ss);
    m.rotation.y = yaw;
    o.world.add(m); st.meshes.push(m);
    if (opt.growth && tpl.attach.length) { // growth at the attachment points, as growthOn() places it (no tube test)
      const sp = specs(), rng = mulberry32(seed * 7 + 1), bs = new Batch(MAT.static, 60000), bw = new Batch(MAT.sway, 60000), used = new Set(), placed = [];
      for (let k = 0; k < opt.growth; k++) {
        const ai = (rng() * tpl.attach.length) | 0;
        if (used.has(ai)) continue;
        used.add(ai);
        const a = tpl.attach[ai], p = [R[0] * a.p[0] + R[2] * a.p[2] + x, a.p[1] + y, R[6] * a.p[0] + R[8] * a.p[2] - ss];
        if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1.1)) continue;
        placed.push(p);
        const n = [R[0] * a.n[0] + R[2] * a.n[2], a.n[1], R[6] * a.n[0] + R[8] * a.n[2]], l = Math.hypot(n[0], n[1], n[2]) || 1;
        const e = pickW(rng, sp.grow), spec = sp[e.k], gt = spec.tpl[(rng() * spec.tpl.length) | 0];
        const sc = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * rng(), c = spec.tint(rng);
        (e.sway ? bw : bs).add(gt, p[0], p[1] - 0.04 * sc, p[2], orient(n[0] / l, n[1] / l, n[2] / l, e.k === 'fan' ? 0.2 : 0.8, rng() * TAU), sc, sc, sc, c[0], c[1], c[2], sc);
      }
      for (const bb of [bs, bw]) { const gm = bb.build(); if (gm) { gm.updateMatrix(); o.world.add(gm); st.meshes.push(gm); } }
    }
    const bx = tpl.box;
    if (!c) c = [x, fy + (bx[4] - bx[1]) * 0.3, -ss];
    size = Math.max(size, bx[5] - bx[2], bx[3] - bx[0]);
    off += (bx[5] - bx[2]) * 0.6 + 6;
  }
  st.center = c; st.size = size * 0.55;
  st.cam = opt.cam || [-0.9, 0.35, 1.25];
  const tris = pieces.reduce((a, t) => a + t.tris, 0);
  return { ms: +ms.toFixed(1), pieces: pieces.length, tris, verts: pieces.reduce((a, t) => a + t.vc, 0), obs: pieces.map((t) => (t.obs || []).length), labels: pieces.map((t) => t.label), feats: pieces.map((t) => (t.feats || []).map((f) => f.name)) };
}
export function orbit(az, el, k = 1.25) { st.cam = [az, el, k]; }

// frame a placed wreck piece of the current plans: lookSlot(i, k) (slot index i in the first plan, piece k)
export function lookSlot(i = 0, k = 0, cam = [-0.9, 0.35, 1.0], plan = null) {
  wrap();
  const L = plan ?? [...window.__wreckPlans.values()].at(-1), sl = L.slots[i], p = sl && sl.pieces && sl.pieces[k];
  if (!p) return null;
  const bx = p.tpl.box;
  st.center = [p.c[0], p.y + (bx[4] - bx[1]) * 0.3, -p.c[2]]; st.size = Math.max(bx[5] - bx[2], bx[3] - bx[0]) * 0.55; st.cam = cam;
  return { name: sl.name, kind: sl.kind, cond: p.tpl.cond, at: [+p.c[0].toFixed(1), +p.y.toFixed(1), Math.round(p.c[2])] };
}
export function free() { st.cam = null; st.center = null; }
