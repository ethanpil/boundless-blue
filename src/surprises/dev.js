// Dev helpers for the surprise encounters (not loaded by the app). In the console:
//   const d = await import('/src/surprises/dev.js');
//   await d.run('divers', { mode: 'oncoming' })   // run one encounter to the end, report clearances and CPU
//   await d.matrix()                               // every kind / variant that fits the current zone
//   d.look(dist, sideDeg, pitchDeg)                // orbit the debug camera around the active encounter
//   d.free()                                       // give the camera back to the director
// run() steps the simulation with __ocean.advance and skips rendering (fast); clearances are measured
// against the seabed, ceilings / surface and solid obstacles, and the camera distance against body surfaces.

const O = () => window.__ocean;

function hook() {
  const o = O();
  if (o.director._sOrig) return;
  o.director._sOrig = o.director.update;
  o.director.update = function (...a) { const r = this._sOrig(...a); if (window.__sCam) window.__sCam(o.camera); return r; };
}
/** Point the camera at the active encounter from `dist` m, at `side` degrees from its heading. */
export function look(dist = 6, side = 60, pitch = 10, i = 0) {
  hook();
  const o = O();
  window.__sCam = (cam) => {
    const a = o.surprises.active;
    if (!a) return;
    const d = a.divers ? a.divers[i] : a;
    const Oz = -o.world.position.z, yaw = (d.yaw || 0) + (side * Math.PI) / 180, p = (pitch * Math.PI) / 180;
    const tx = d.x, ty = d.y, tz = d.z - Oz;
    cam.position.set(tx + Math.sin(yaw) * Math.cos(p) * dist, ty + Math.sin(p) * dist, tz + Math.cos(yaw) * Math.cos(p) * dist);
    cam.lookAt(tx, ty, tz); cam.updateMatrixWorld();
  };
  o.advance(0.1, 1 / 30);
}
export function free() { window.__sCam = null; }

// body sample spheres [x, y, z (global), r] of the active encounter
function bodies(a) {
  const out = [];
  if (a.divers) for (const d of a.divers) for (let k = 0; k < 4; k++) { const t = k / 3; out.push([d.ax + (d.bx - d.ax) * t, d.ay + (d.by - d.ay) * t, d.az + (d.bz - d.az) * t, k === 1 ? 0.3 : 0.2]); }
  else if (a.pts) for (const p of a.pts) out.push([p.x, p.y, p.z, p.r * 0.85]);
  else if (a.samples && a.toGlobal) for (const sp of a.samples) { const g = {}; a.toGlobal(sp[0], sp[1], sp[2], g); out.push([g.x, g.y, g.z, sp[3]]); }
  return out;
}
// smallest gap between two divers' capsules (personal space)
function diverGap(a) {
  let best = 1e9;
  const D = a.divers;
  for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) {
    for (let k = 0; k <= 6; k++) for (let l = 0; l <= 6; l++) {
      const s = k / 6, t = l / 6, A = D[i], B = D[j];
      const d = Math.hypot(A.ax + (A.bx - A.ax) * s - B.ax - (B.bx - B.ax) * t, A.ay + (A.by - A.ay) * s - B.ay - (B.by - B.ay) * t, A.az + (A.bz - A.az) * s - B.az - (B.bz - B.az) * t);
      best = Math.min(best, d - 0.64);
    }
  }
  return best;
}

/** Run one encounter to its end (or maxSec) and report. opts are passed to trigger(). */
export async function run(kind, opts = {}, maxSec = 420, render = false) {
  const o = O(), S = o.surprises;
  free(); S.stop();
  const pr = o.post.render;
  if (!render) o.post.render = () => {};
  try {
    const r = S.trigger(kind, Object.assign({ sync: true }, opts));
    if (r !== 'ok') return { kind, opts, result: r };
    const a = S.active;
    const st = { kind, variant: a.type || a.form || a.mode || '', frames: 0, minCam: 1e9, minClear: 1e9, viol: 0, maxMs: 0, avgMs: 0, minGap: 1e9, waved: false };
    let sum = 0;
    const up = a.update.bind(a);
    a.update = (dt, t, c) => { const t0 = performance.now(); up(dt, t, c); const ms = performance.now() - t0; st.maxMs = Math.max(st.maxMs, ms); sum += ms; };
    for (let f = 0; f < maxSec * 30 && S.active === a; f++) {
      o.advance(1 / 30, 1 / 30);
      st.frames++;
      const c = S.cam;
      const bs = bodies(a);
      if (bs.some((b) => !b.every(Number.isFinite))) {
        st.nan = { frame: f, state: a.divers ? a.divers.map((d) => ({ x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, yaw: d.yaw, up: d.up, wave: d.wave && d.wave.st })) : { x: a.x, y: a.y, z: a.z, s: a.s } };
        break;
      }
      for (const [x, y, z, r] of bs) {
        st.minCam = Math.min(st.minCam, Math.hypot(x - c.x, y - c.y, z - c.z) - r);
        const cl = S.clear(x, y, -z, r, 0);
        st.minClear = Math.min(st.minClear, cl);
        if (cl < -0.02) st.viol++;
      }
      if (a.divers) { st.minGap = Math.min(st.minGap, diverGap(a)); if (a.divers.some((d) => d.wave)) st.waved = true; }
    }
    st.avgMs = +(sum / st.frames).toFixed(3); st.maxMs = +st.maxMs.toFixed(2);
    st.minCam = +st.minCam.toFixed(2); st.minClear = +st.minClear.toFixed(2); st.minGap = a.divers ? +st.minGap.toFixed(2) : undefined;
    st.secs = Math.round(st.frames / 30); st.ended = S.active !== a;
    if (!a.divers) delete st.waved;
    return st;
  } finally { o.post.render = pr; }
}

/** Run every kind (and its variants) that can be placed here; returns one report per run. */
export async function matrix() {
  const runs = [['divers', { mode: 'oncoming' }], ['divers', { mode: 'ahead' }], ['divers', { mode: 'hover' }], ['sub', { type: 'deep' }], ['sub', { type: 'sphere' }], ['sub', { type: 'tourist' }],
    ['rov', {}], ['glider', {}], ['kaiju', { route: 'cross' }], ['kaiju', { route: 'pass' }]];
  const out = [];
  for (const [k, op] of runs) out.push(await run(k, op));
  return out;
}
