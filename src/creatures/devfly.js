// Dev-only helper (not imported by the app): drive the camera + creatures from the console when the
// page's rAF is throttled. Usage: const { fly } = await import('/src/creatures/devfly.js'); fly(s0, seconds, yaw, pitch)
import * as THREE from 'three';

// Yield to the page between test steps. A MessageChannel task, not setTimeout(0): Chrome throttles chained
// timers in a hidden page to about one per minute, which stalled long audits in a background tab.
const yieldUI = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

// Approximation of main.js updateEnvironment (dev only) so captures are lit like the app.
function env(s) {
  const o = window.__ocean, U = o.U, B = o.BIOMES || null;
  const P = { sigma: [0, 0, 0], lightSigma: [0, 0, 0], deep: [0, 0, 0], up: [0, 0, 0], sun: 0, caustic: 0, shafts: 0, ambient: 0, glow: 0 };
  const BI = env.B;
  if (!BI) return;
  for (const e of o.seq.weights(s + 10)) {
    const b = BI[e.key];
    for (const k of ['sigma', 'lightSigma', 'deep', 'up']) for (let i = 0; i < 3; i++) P[k][i] += b[k][i] * e.w;
    for (const k of ['sun', 'caustic', 'shafts', 'ambient', 'glow']) P[k] += b[k] * e.w;
  }
  U.uSigma.value.set(...P.sigma); U.uLightSigma.value.set(...P.lightSigma);
  U.uWaterDeep.value.setRGB(...P.deep); U.uWaterUp.value.setRGB(...P.up);
  U.uSunScatter.value = P.sun; U.uCausticStr.value = P.caustic; U.uAmbientScale.value = P.ambient; U.uGlow.value = P.glow;
  if (U.uLamp) U.uLamp.value = Math.max(0, Math.min(1, (0.45 - P.sun) / 0.37));
  o.scene.traverse((x) => {
    if (x.isDirectionalLight) { x.intensity = 2.0 * P.sun; x.position.copy(o.camera.position).addScaledVector(U.uSunDir.value, 50); x.target.position.copy(o.camera.position); x.target.updateMatrixWorld(); }
    if (x.isHemisphereLight) { x.color.setRGB(...P.up).multiplyScalar(1.6); x.groundColor.setRGB(...P.deep).multiplyScalar(0.5); x.intensity = 1.1 * P.ambient; }
  });
  o.post.params.shafts = P.shafts * P.sun; o.post.params.depth = Math.max(0, -o.camera.position.y);
  o.post.params.exposure = 1 + 1.4 * P.glow + 0.4 * (1 - Math.min(1, P.sun));
}
export async function initEnv() { env.B = (await import('../biomes.js')).BIOMES; }

// Render one frame and POST the canvas to the dev server (saved under the scratchpad /shots).
export async function snap(name = 'shot.jpg', render = true) {
  const o = window.__ocean, r = o.post.renderer;
  if (render) o.post.render((fly.t || 0) % 4096);
  const url = r.domElement.toDataURL('image/jpeg', 0.85);
  await fetch('/' + name, { method: 'POST', body: url });
  return name;
}
// Point the camera (yaw/pitch relative to the path) at the nearest encounter of `key`.
export function aimAt(key) {
  const o = window.__ocean, c = o.creatures;
  const e = c.enc.filter((x) => !key || x.sp.key === key).sort((a, b) => a.dist - b.dist)[0];
  if (!e) return null;
  const b = e.bounds, s = fly.s || c.ctx.s;
  const dx = b.x - o.shape.pathX(s), dz = (e.anchorZ + b.z) + s, dy = b.y - o.shape.pathY(s);
  const base = Math.atan2(-(o.shape.pathX(s + 16) - o.shape.pathX(s)), 16);
  return { yaw: Math.atan2(-dx, -dz) - base, pitch: dy / Math.hypot(dx, dz), d: Math.hypot(dx, dy, dz) };
}

export function fly(s0, secs, yaw = 0, pitch = 0, speed = 3.2, step = 1 / 30) {
  const o = window.__ocean, c = o.creatures, world = c.world;
  let t = fly.t || 0, s = s0;
  const up = new THREE.Vector3(0, 1, 0), f = new THREE.Vector3();
  const n = Math.max(1, Math.round(secs / step));
  for (let k = 0; k < n; k++, s += speed * step) {
    const Oz = Math.ceil(-s / 1024) * 1024; world.position.z = -Oz;
    const x = o.shape.pathX(s), y = o.shape.pathY(s);
    o.camera.position.set(x, y, -s - Oz);
    const d = new THREE.Vector3(o.shape.pathX(s + 16) - x, o.shape.pathY(s + 16) - y, -16).normalize().applyAxisAngle(up, yaw);
    d.y += pitch; d.normalize();
    o.camera.lookAt(o.camera.position.clone().add(d));
    o.camera.updateMatrixWorld();
    if (k % 10 === 0 || k === n - 1) o.terrain.update(s);
    o.camera.getWorldDirection(f);
    t += step;
    o.U.uTime.value = t % 4096;
    c.update(step, t % 4096, { s, x, y, z: -s, forward: f, camera: o.camera, Oz });
  }
  fly.t = t; fly.s = s;
  o.U.uCamPos.value.copy(o.camera.position);
  env(s);
  o.terrain.sky.syncUniforms(Math.ceil(-s / 1024) * 1024);
  o.post.render(t % 4096);
  return c.enc.filter((e) => e.visible).map((e) => `${e.sp.key}x${e.n}@${Math.round(e.dist)}`).join(' ');
}

// Stop the app's own frame loop (so captures are deterministic) and load biome data.
export async function boot() {
  await new Promise((r) => setTimeout(r, 2000));
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = () => 0;
  await new Promise((r) => setTimeout(r, 1500));
  window.requestAnimationFrame = raf;
  await initEnv();
  fly.t = 0;
}

// On-screen presence metric over `secs` of simulated time using the core's __ocean.advance hook.
export async function measure(secs = 180) {
  await new Promise((r) => setTimeout(r, 1500));
  window.__crMetric = {};
  const t0 = performance.now();
  for (let t = 0; t < secs; t += 10) window.__ocean.advance(10);
  const M = window.__crMetric; window.__crMetric = null;
  if (measure.shot) { window.__ocean.advance(0.4); await snap(measure.shot, false); }
  const out = {};
  for (const k in M) out[k] = `${((100 * M[k].hit) / M[k].f).toFixed(0)}% ray ${((100 * M[k].ray) / M[k].f).toFixed(0)}% ceph ${((100 * M[k].ceph) / M[k].f).toFixed(0)}% peng ${((100 * (M[k].peng || 0)) / M[k].f).toFixed(0)}% (${M[k].f}f)`;
  out.secs = ((performance.now() - t0) / 1000).toFixed(0) + 's';
  return out;
}

// Miss diagnosis: run `secs` in 2.5 s chunks and describe the groups at frames that missed.
export async function diagnose(secs = 120, maxLogs = 6) {
  await new Promise((r) => setTimeout(r, 1500));
  const o = window.__ocean, c = o.creatures, THREE = await import('three');
  const logs = [], spawns = []; let miss = 0, tot = 0;
  const os = c.spawn.bind(c); c.spawn = (sp, p) => { spawns.push(`${sp.key}/${p.kind || sp.beh.kind}/${p.route || '-'}`); return os(sp, p); };
  for (let k = 0; k < secs / 2.5; k++) {
    window.__crMetric = {}; o.advance(2.5); const M = window.__crMetric; window.__crMetric = null;
    const key = Object.keys(M)[0]; tot++;
    if (M[key].hit / M[key].f >= 0.5) continue;
    miss++;
    if (logs.length >= maxLogs) continue;
    logs.push(`t${k} ${key} lead? ${c.director.wantLead} :: ` + c.enc.map((e) => {
      const b = e.bounds, ahead = -(e.anchorZ + b.z) - c.ctx.s;
      const v = new THREE.Vector3(b.x, b.y, e.anchorZ + b.z - c.ctx.Oz).project(o.camera);
      return `${e.sp.key}x${e.n}[${e.kind}/${e.route}${e.route === 'lead' ? ':' + e.leadT.toFixed(0) : ''}] a${ahead.toFixed(0)} l${(b.x - c.ctx.x).toFixed(0)} dy${(b.y - c.ctx.y).toFixed(1)} rd${e.readDist.toFixed(0)} ndc${v.x.toFixed(1)},${v.y.toFixed(1)}${e.visible ? ' V' : ''}`;
    }).join(' | '));
  }
  c.spawn = os;
  return { miss, tot, spawns: spawns.join(' '), logs };
}

// Obstacle test: optionally add synthetic pillars / boulders along the path, run `secs` with
// __ocean.advance and report the worst body penetration over every creature instance.
export async function obstacleTest(secs = 120, synthetic = true, detail = false) {
  await new Promise((r) => setTimeout(r, 1500));
  const o = window.__ocean, c = o.creatures, reg = o.obstacles, sh = o.shape;
  const { mulberry32 } = await import('../noise.js');
  const rng = mulberry32(99), added = [];
  let genS = c.ctx.s;
  const gen = (toS) => {
    for (; genS < toS; genS += 6) {
      const x = sh.pathX(genS) + (rng() - 0.5) * 24, fl = sh.floorAt(x, genS);
      if (Math.abs(x - sh.pathX(genS)) < 3.5) continue; // keep the camera tube clear
      if (rng() < 0.5) { const h = 2 + rng() * 6, r = 0.5 + rng() * 1.2; added.push(reg.add({ ax: x, ay: fl - 1, as: genS, bx: x, by: fl + h, bs: genS, r })); }
      else { const r = 0.8 + rng() * 2.2; added.push(reg.add({ ax: x, ay: fl + r * 0.3, as: genS, bx: x, by: fl + r * 0.3, bs: genS, r })); }
    }
  };
  let worst = 0, worstKey = '', samples = 0, deep = 0;
  const q = [], log = [];
  for (let t = 0; t < secs; t += 0.5) {
    if (synthetic) gen(c.ctx.s + 260);
    o.advance(0.5);
    for (const e of c.enc) {
      if (e.kind === 'colony' || e.kind === 'peek') continue;
      for (let i = 0; i < e.n; i++) {
        const x = e.P[i * 3], s = -(e.anchorZ + e.P[i * 3 + 2]);
        reg.query(x, s, 6 + e.SZ[i], q);
        if (!q.length) continue;
        samples++;
        const d = e._clear(i, e.P[i * 3], e.P[i * 3 + 1], e.P[i * 3 + 2], 3, q) + 0.05 + 0.03 * e.SZ[i]; // vs body radius, without the margin
        if (d < worst) { worst = d; worstKey = e.sp.key + '/' + e.kind; }
        if (d < -0.05) {
          deep++;
          if (detail && log.length < 400) log.push({ t, key: e.sp.key + '/' + e.kind, uid: e.uid, i, route: e.route, ev: e.event ? e.event.type : '', pen: +d.toFixed(2),
            x: +x.toFixed(1), y: +e.P[i * 3 + 1].toFixed(2), s: +s.toFixed(1), clr: +e.CLR[i].toFixed(2), nObs: e.obs.length, sz: +e.SZ[i].toFixed(2) });
        }
      }
    }
    await yieldUI();
  }
  if (synthetic) for (const a of added) reg.remove(a);
  const res = { registered: reg.count, synthetic: added.length, samples, worstPenetration: +worst.toFixed(3), worstKey, over5cm: deep, avgMs: c.stats.ms.toFixed(2) };
  if (detail) res.log = log.sort((a, b) => a.pen - b.pen).slice(0, 30);
  return res;
}

// ---------- spacing & terrain audits ----------
const _shapes = new Map();
async function shapeOf(sp) {
  let s = _shapes.get(sp.key);
  if (!s) {
    const { buildSpecies } = await import('./build.js'), { bodyShape } = await import('./sep.js');
    const g = buildSpecies(sp, 0), sh = bodyShape(sp, g);
    // 26 extreme points of the actual geometry (jelly tentacles excluded) for the terrain test
    const pos = g.pos, ga = g.g, nv = pos.length / 3, pts = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue;
      let best = -1e9, bi = 0;
      for (let v = 0; v < nv; v++) {
        const part = ga[v * 4];
        if (part === 5 || (part === 6 && (sp.plan === 'jelly' || sp.plan === 'siphon'))) continue;
        const d = pos[v * 3] * dx + pos[v * 3 + 1] * dy + pos[v * 3 + 2] * dz;
        if (d > best) { best = d; bi = v; }
      }
      pts.push(pos[bi * 3], pos[bi * 3 + 1], pos[bi * 3 + 2]);
    }
    s = { ...sh, pts };
    _shapes.set(sp.key, s);
  }
  return s;
}
function instM(e, i) { // instance matrix of agent i (relative to the encounter anchor), or null
  const M = e.mesh.instanceMatrix.array, o = i * 16;
  if (M[o + 15] === 1) return [M, o];
  if (e.nearCount) for (let k = 0; k < e.nearCount; k++) if (e.nearIdx[k] === i) return [e.nearCopy, k * 16];
  return null;
}

// Minimum surface clearance (capsule model derived from each species' geometry) between any two animals,
// sampled every 0.5 s over `secs` of simulated time. Target: >= 0 everywhere.
export async function spacingTest(secs = 60) {
  await new Promise((r) => setTimeout(r, 1500));
  const o = window.__ocean, c = o.creatures;
  const { segSegDist } = await import('./sep.js');
  let worst = 1e9, worstKey = '', samples = 0, neg = 0, neg5 = 0, pairs = 0, worstSame = 1e9;
  const nn = [], byKey = {};
  const caps = (e, sh) => {
    const out = new Float32Array(e.n * 8), up = e.kind === 'colony' || (sh.ya && ['seahorse', 'cassiopea', 'octopus'].includes(e.sp.plan));
    for (let i = 0; i < e.n; i++) {
      const s = e.SZ[i], i3 = i * 3;
      const ax = up ? 0 : e.F[i3], ay = up ? 1 : e.F[i3 + 1], az = up ? 0 : e.F[i3 + 2];
      const cx = e.P[i3] + ax * sh.c * s, cy = e.P[i3 + 1] + ay * sh.c * s, cz = e.anchorZ + e.P[i3 + 2] + az * sh.c * s, h = sh.h * s;
      out.set([cx - ax * h, cy - ay * h, cz - az * h, cx + ax * h, cy + ay * h, cz + az * h, sh.r * s, s], i * 8);
    }
    return out;
  };
  for (let t = 0; t < secs; t += 0.5) {
    o.advance(0.5);
    // shapes first (a new species' first build awaits a module import, during which other code may advance the
    // simulation), then every capsule from one consistent snapshot
    for (let e; (e = c.enc.find((x) => !_shapes.has(x.sp.key))); ) await shapeOf(e.sp);
    const E = c.enc.filter((e) => !e.done && e.kind !== 'attach');
    const C = [];
    for (const e of E) C.push(caps(e, _shapes.get(e.sp.key)));
    samples++;
    for (let a = 0; a < E.length; a++) for (let b = a; b < E.length; b++) {
      const ea = E[a], eb = E[b], A = C[a], B = C[b];
      if (a !== b) {
        const ba = ea.bounds, bb = eb.bounds, dx = ba.x - bb.x, dy = ba.y - bb.y, dz = ea.anchorZ + ba.z - eb.anchorZ - bb.z;
        if (Math.hypot(dx, dy, dz) > ba.r + bb.r + 2) continue;
      }
      for (let i = 0; i < ea.n; i++) {
        let nearest = 1e9;
        for (let j = 0; j < eb.n; j++) {
          if (a === b && j === i) continue;
          const p = i * 8, q = j * 8;
          const mx = (A[p] + A[p + 3]) * 0.5 - (B[q] + B[q + 3]) * 0.5, my = (A[p + 1] + A[p + 4]) * 0.5 - (B[q + 1] + B[q + 4]) * 0.5, mz = (A[p + 2] + A[p + 5]) * 0.5 - (B[q + 2] + B[q + 5]) * 0.5;
          const cd = Math.hypot(mx, my, mz);
          if (a === b && cd < nearest) nearest = cd;
          if (a === b && j < i) continue;
          const reach = Math.hypot(A[p + 3] - A[p], A[p + 4] - A[p + 1], A[p + 5] - A[p + 2]) * 0.5 + Math.hypot(B[q + 3] - B[q], B[q + 4] - B[q + 1], B[q + 5] - B[q + 2]) * 0.5 + A[p + 6] + B[q + 6];
          if (cd > reach + 0.5) continue;
          pairs++;
          const d = segSegDist(A[p], A[p + 1], A[p + 2], A[p + 3], A[p + 4], A[p + 5], B[q], B[q + 1], B[q + 2], B[q + 3], B[q + 4], B[q + 5]) - A[p + 6] - B[q + 6];
          if (d < 0) { neg++; const k = `${ea.sp.key}/${ea.kind} ${eb.sp.key}/${eb.kind}`; byKey[k] = Math.min(byKey[k] ?? 0, +d.toFixed(3)); }
          if (d < -0.05) neg5++;
          if (a === b && d < worstSame) worstSame = d;
          if (d < worst) { worst = d; worstKey = `${ea.sp.key}/${ea.kind}${ea.MODE ? ':' + ea.MODE[i] : ''} vs ${eb.sp.key}/${eb.kind}${eb.MODE ? ':' + eb.MODE[j] : ''} @${Math.round(ea.dist)}m`; }
        }
        if (a === b && ea.n >= 8 && (ea.kind === 'school' || ea.kind === 'bait' || ea.kind === 'mill' || ea.kind === 'shoal') && nearest < 1e8) nn.push(nearest / ea.SZ[i]);
      }
    }
    await yieldUI();
  }
  nn.sort((x, y) => x - y);
  const q = (f) => (nn.length ? +nn[Math.floor(nn.length * f)].toFixed(2) : null);
  return { samples, pairs, minClearance: +worst.toFixed(3), worstKey, minWithinGroup: +worstSame.toFixed(3), negPairs: neg, over5cm: neg5,
    schoolNN_bodyLengths: { p10: q(0.1), median: q(0.5), p90: q(0.9) }, byKey, sepMs: c.sep ? c.sep.stats.ms.toFixed(3) : '-', crMs: c.stats.ms.toFixed(2) };
}

// Terrain penetration of body extremities: 26 extreme points of each species' geometry, transformed by the
// instance matrix, against the rendered floor / ceiling (and the sea surface) every 0.5 s.
// Every kind is checked against ceilings (cave roofs, ice); animals that sit on or in the floor by design
// (resting, walking, beds, garden eels, morays in their holes, remoras) are exempt from the floor check.
const SWIM = new Set(['school', 'bait', 'mill', 'solo', 'pod', 'shoal', 'hover', 'drift']);
export async function terrainTest(secs = 60, detail = false) {
  await new Promise((r) => setTimeout(r, 1500));
  const o = window.__ocean, c = o.creatures, sh = o.shape;
  let worstC = 0, worstCKey = '', worstF = 0, worstFKey = '', overC = 0, overF = 0, agents = 0, surf = 0;
  const log = [], byKind = {}; // detail: the worst violations with their group state (route, zone, event)
  for (let t = 0; t < secs; t += 0.5) {
    o.advance(0.5);
    const zone = o.seq.weights(c.ctx.s)[0].key;
    for (const e of c.enc) {
      if (e.done) continue;
      const S = await shapeOf(e.sp), pts = S.pts, mixed = e.kind === 'rest' || e.kind === 'octo';
      for (let i = 0; i < e.n; i++) {
        const floorBound = mixed ? e.MODE[i] === 0 : !SWIM.has(e.kind); // lying on the sand / in a burrow by design
        const m = instM(e, i); if (!m) continue;
        const M = m[0], b = m[1];
        agents++;
        let pc = -1e9, pf = -1e9, ps = -1e9;
        for (let k = 0; k < pts.length; k += 3) {
          const lx = pts[k], ly = pts[k + 1], lz = pts[k + 2];
          const x = M[b] * lx + M[b + 4] * ly + M[b + 8] * lz + M[b + 12];
          const y = M[b + 1] * lx + M[b + 5] * ly + M[b + 9] * lz + M[b + 13];
          const s = -(M[b + 2] * lx + M[b + 6] * ly + M[b + 10] * lz + M[b + 14] + e.anchorZ);
          const ce = sh.ceilingAt(x, s), fl = sh.floorAt(x, s);
          if (ce < 0 && y - ce > pc) pc = y - ce;
          if (fl - y > pf) pf = fl - y;
          if (y > ps) ps = y;
        }
        const key = `${e.sp.key}/${e.kind} ${zone}`;
        const bk = byKind[e.kind] || (byKind[e.kind] = { n: 0, ceil: 0, floor: 0 });
        bk.n++; if (pc > bk.ceil) bk.ceil = +pc.toFixed(3); if (!floorBound && pf > bk.floor) bk.floor = +pf.toFixed(3);
        if (pc > worstC) { worstC = pc; worstCKey = key; }
        if (pc > 0.05) overC++;
        if (!floorBound) { if (pf > worstF) { worstF = pf; worstFKey = key; } if (pf > 0.05) overF++; }
        if (ps > 0.05 && !e.sp.beh.skim && e.sp.mot.mode !== 1) surf++;
        if (detail && (pc > 0.05 || (!floorBound && pf > 0.05)) && log.length < 400) {
          const x = e.P[i * 3], s = -(e.P[i * 3 + 2] + e.anchorZ);
          log.push({ t, key, uid: e.uid, i, route: e.route, zone: e.zone, ev: e.event ? e.event.type : '', floor: +pf.toFixed(2), ceil: +pc.toFixed(2),
            y: +e.P[i * 3 + 1].toFixed(2), fl: +sh.floorAt(x, s).toFixed(2), ce: +sh.ceilingAt(x, s).toFixed(2), terrainOn: e.terrainOn, open: e.openWater, tcl: +e.TCL[i].toFixed(2) });
        }
      }
    }
    await yieldUI();
  }
  const res = { agentSamples: agents, worstCeiling: +worstC.toFixed(3), worstCeilingKey: worstCKey, ceilOver5cm: overC,
    worstFloorWall: +worstF.toFixed(3), worstFloorKey: worstFKey, floorOver5cm: overF, aboveSurface: surf, byKind, crMs: c.stats.ms.toFixed(2) };
  if (detail) res.log = log.sort((a, b) => Math.max(b.floor, b.ceil) - Math.max(a.floor, a.ceil)).slice(0, 30);
  return res;
}

// In-frame penetration: terrainTest / obstacleTest sample the state after every correction, so a body that got deep
// into rock and was lifted out within the frame (a visible pop) never shows there. This wraps the corrections and
// reports how far they moved bodies (= how deep they were): _terrainFix (floor, walls, roofs) and _pushOut (rocks).
export async function fixTest(secs = 60, detail = false) {
  await new Promise((r) => setTimeout(r, 1500));
  const o = window.__ocean, c = o.creatures, sh = o.shape, { Encounter } = await import('./encounter.js'), E = Encounter.prototype;
  const tf = E._terrainFix, po = E._pushOut, st = { tf: { n: 0, over10cm: 0, over50cm: 0, worst: 0, worstKey: '' }, po: { n: 0, over10cm: 0, over50cm: 0, worst: 0, worstKey: '' } }, log = [];
  const wrap = (f, k) => function (i, ...a) {
    const P = this.P, i3 = i * 3, x = P[i3], y = P[i3 + 1], z = P[i3 + 2], r = f.call(this, i, ...a);
    const d = Math.hypot(P[i3] - x, P[i3 + 1] - y, P[i3 + 2] - z), S = st[k];
    S.n++; if (d > 0.1) S.over10cm++; if (d > 0.5) S.over50cm++;
    if (d > S.worst) { S.worst = +d.toFixed(3); S.worstKey = `${this.sp.key}/${this.kind}/${this.route}`; }
    if (detail && d > 0.25 && log.length < 200) {
      const s = -(z + this.anchorZ), at = new Error().stack.split('\n').slice(2, 4).map((l) => l.trim().replace(/^at /, '').replace(/\s\(.*\//, ' (')).join(' < ');
      log.push({ k, t: +c.director.clock.toFixed(1), key: `${this.sp.key}/${this.kind}`, route: this.route, i, d: +d.toFixed(2), y: +y.toFixed(2), fl: +sh.floorAt(x, s).toFixed(2), ny: +P[i3 + 1].toFixed(2), sz: +this.SZ[i].toFixed(2), age: +this.age.toFixed(1), at });
    }
    return r;
  };
  E._terrainFix = wrap(tf, 'tf'); E._pushOut = wrap(po, 'po');
  try { for (let t = 0; t < secs; t += 0.5) { o.advance(0.5); await yieldUI(); } } finally { E._terrainFix = tf; E._pushOut = po; }
  const res = { ...st, crMs: c.stats.ms.toFixed(2) };
  if (detail) res.log = log.sort((a, b) => b.d - a.d).slice(0, 30);
  return res;
}

// On-screen life: per 0.25 s sample, animals readable in the frame (>= 8 px and >= 25 px at 1280x720), distinct
// species readable, and close passes: animals inside the view frustum that come within 6 m of the lens
// (counted once per animal; distinct species). Also the smallest lens-to-body-surface distance seen.
export async function presenceTest(secs = 120) {
  await new Promise((r) => setTimeout(r, 1500));
  const o = window.__ocean, c = o.creatures, THREE = await import('three');
  const v = new THREE.Vector3(), cam = o.camera;
  let samples = 0, read8 = 0, read25 = 0, species = 0, minSurf = 1e9, minKey = '', empty = 0;
  const close = new Map(), closeSp = new Set(), closeBySp = {};
  for (let t = 0; t < secs; t += 0.25) {
    o.advance(0.25);
    const K = 360 / Math.tan((cam.fov * Math.PI) / 360), cp = cam.position, fr = c.frustum, Oz = c.ctx.Oz, maxD = c.fogD * 0.6;
    let n8 = 0, n25 = 0; const sp = new Set();
    for (const e of c.enc) {
      if (e.done || e.fade < 0.3) continue;
      const pl = e.sp.plan, vis = pl === 'siphon' ? 0.12 : pl === 'jelly' ? 0.6 : 1;
      for (let i = 0; i < e.n; i++) {
        v.set(e.P[i * 3], e.P[i * 3 + 1], e.anchorZ + e.P[i * 3 + 2] - Oz);
        const d = v.distanceTo(cp), surf = d - e.SZ[i] * 0.5;
        if (surf < minSurf && e.kind !== 'attach') { minSurf = surf; minKey = `${e.sp.key}/${e.kind}/${e.route}`; }
        if (d > maxD || !fr.containsPoint(v)) continue;
        const px = (e.SZ[i] * vis * K) / Math.max(d, 0.5);
        if (px >= 8) { n8++; sp.add(e.sp.key); }
        if (px >= 25) n25++;
        if (d < 6 && e.SZ[i] >= 0.07 && e.kind !== 'attach') {
          const k = e.uid * 1000 + i;
          if (!close.has(k)) { close.set(k, d); closeSp.add(e.sp.key); closeBySp[e.sp.key] = (closeBySp[e.sp.key] || 0) + 1; }
          else if (d < close.get(k)) close.set(k, d);
        }
      }
    }
    samples++; read8 += n8; read25 += n25; species += sp.size; if (!n8) empty++;
    if (samples % 20 === 0) await yieldUI();
  }
  const ds = [...close.values()].sort((a, b) => a - b);
  const mins = secs / 60;
  return { samples, readable8px: +(read8 / samples).toFixed(1), readable25px: +(read25 / samples).toFixed(1), speciesInView: +(species / samples).toFixed(2),
    emptyFrames: `${((100 * empty) / samples).toFixed(1)}%`, closePassesPerMin: +(close.size / mins).toFixed(1), closeSpecies: closeSp.size,
    closeDist: ds.length ? { min: +ds[0].toFixed(2), median: +ds[Math.floor(ds.length / 2)].toFixed(2) } : null,
    closeBySpecies: closeBySp, minLensToBody: +minSurf.toFixed(2), minKey, crMs: c.stats.ms.toFixed(2), groups: c.enc.length, inst: c.instances };
}

// Terrain + spacing audit in one go (stores the result in window.__audit as well).
export async function audit(secs = 60) {
  const t = await terrainTest(secs), s = await spacingTest(secs * 0.5);
  const zone = window.__ocean.seq.weights(window.__ocean.creatures.ctx.s)[0].key;
  return (window.__audit = { zone, terrain: t, spacing: s });
}

// Visual QA: spawn  (unless one is already around) ahead of the camera, stop the app loop, pose the
// camera beside one animal (dist metres, elevation, yaw offset in radians) and show the render in an overlay.
export async function look(key, dist = 4, elev = 0.4, yaw = 0, spawn = true) {
  const o = window.__ocean, c = o.creatures, THREE = await import('three');
  if (!look.booted) { await boot(); look.booted = true; }
  let e = c.enc.find((x) => x.sp.key === key && !x.done);
  if (!e && spawn) {
    const s = c.ctx.s + 25, sh = o.shape;
    e = c.director.spawnAt(key, { type: 'qa', x: sh.pathX(s) + 3, y: Math.max(sh.pathY(s), sh.floorAt(sh.pathX(s) + 3, s) + 1.5), s, r: 3 }, { fadeIn: false });
    if (!e) return 'spawn failed';
    e.fade = 1;
    for (let k = 0; k < 20; k++) c.update(1 / 30, o.U.uTime.value, { s: c.ctx.s, x: c.ctx.x, y: c.ctx.y, z: c.ctx.z, forward: o.camera.getWorldDirection(new THREE.Vector3()), camera: o.camera, Oz: c.ctx.Oz });
  }
  if (!e) return 'none';
  const Oz = c.ctx.Oz, i = 0, t = new THREE.Vector3(e.P[0], e.P[1], e.anchorZ + e.P[2] - Oz);
  const f = new THREE.Vector3(e.F[0], 0, e.F[2]).normalize(), side = new THREE.Vector3(f.z, 0, -f.x).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const cam = o.camera;
  cam.position.copy(t).addScaledVector(side, dist + e.SZ[i] * 0.5).add(new THREE.Vector3(0, elev, 0));
  cam.lookAt(t); cam.updateMatrixWorld(); o.U.uCamPos.value.copy(cam.position);
  c.update(0, o.U.uTime.value, { s: c.ctx.s, x: cam.position.x, y: cam.position.y, z: cam.position.z + Oz, forward: cam.getWorldDirection(new THREE.Vector3()), camera: cam, Oz });
  o.post.render(o.U.uTime.value);
  const url = o.renderer.domElement.toDataURL('image/jpeg', 0.9);
  let img = document.getElementById('__shot');
  if (!img) { img = document.createElement('img'); img.id = '__shot'; img.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;object-fit:contain;background:#000'; document.body.appendChild(img); }
  img.src = url; await new Promise((r) => { img.onload = r; });
  return key + ' ' + e.kind + ' n' + e.n + ' size ' + e.SZ[i].toFixed(2) + 'm';
}
