// Cold-water coral (Lophelia / Desmophyllum pertusum) and the small life of its rubble: the coral colony generator,
// its material, rubble fragments, squat lobsters, brittle stars, pencil urchins and anemones (nb6_coldcoral.js).
//
// A colony grows as a branching tree inside a lumpy "cauliflower" envelope: short zigzag segments (the sympodial
// chain of corallites), splitting two or three ways, each child bent outward and up, until the branch reaches the
// envelope. Living tissue covers the outer shell only (the tips and the crown); inside and below it the branches
// are bare dead skeleton, silted on top and patched with encrusting sponge, as on a real reef where the living
// coral sits on its own dead framework. Dead framework clumps are the same trees with no living shell and with
// broken branches. aFx.x = living tissue (0 dead .. 1 live), aFx.y = 0 (unused).
import * as THREE from 'three';
import { applyWater } from '../water.js';
import { Builder, TAU, vn3 } from './core.js';
import { ground } from './nb_shapes.js';
import { lab, setBase } from './nb_common.js';
import { mulberry32 } from '../noise.js';

// linear vertex colours: the two living colour forms and the bare skeleton
export const LIVE_WHITE = [0.52, 0.47, 0.35], LIVE_ORANGE = [0.64, 0.25, 0.11], DEAD = [0.14, 0.12, 0.092];
const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// rotate v about unit axis k by angle a (Rodrigues)
function rot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c), x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d];
}
const perp = (d, rng) => { const a = rng() * TAU; const t = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const u = nrm(...cross(d, t)), w = cross(d, u); return nrm(u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)); };

// Colony job (generator: yields between groups of branches). o: h height (m), live (0..1 living shell), col the
// living colour, broken (0..1 chance a branch is snapped off), detail (0: 3-sided branches, 1: 4-sided), maxSeg.
export function* colonyJob(seed, o = {}) {
  const { h = 1, live = 1, col = LIVE_WHITE, broken = 0, detail = 0, maxSeg = 90, spread = 1 } = o;
  const rng = mulberry32((seed * 7919 + 3) >>> 0), b = new Builder(), radial = detail ? 4 : 3;
  const r = h * (0.42 + 0.22 * rng()) * spread, cy = h * (0.3 + 0.1 * rng()), sd = seed % 997;
  // envelope value (< 1 inside): a dome over a narrower foot, with cauliflower lobes
  const env = (x, y, z) => {
    const lob = 1 + 0.24 * vn3(x * 3.2 / h + sd, y * 3.2 / h, z * 3.2 / h, sd) + 0.1 * vn3(x * 8 / h, y * 8 / h + sd, z * 8 / h, sd + 1);
    const rr = r * lob * (y < cy ? 0.45 + 0.55 * Math.max(0, y) / cy : 1), ey = y > cy ? (y - cy) / ((h - cy) * lob) : 0;
    return Math.hypot(x / rr, ey, z / rr);
  };
  // (branches a little stouter than life: at 1-2 cm they thinned to sub-pixel lines a few metres away)
  const L = h * (0.075 + 0.02 * rng()), r0 = Math.min(0.045, 0.03 * Math.sqrt(h) + 0.008);
  const paint = (v, a, x, y, z, out) => {
    const k = live * Math.min(1, Math.max(0, (env(x, y, z) - 0.6) / 0.28)) * Math.min(1, Math.max(0, (y - 0.12 * h) / (0.2 * h)));
    const n = 0.88 + 0.24 * vn3(x * 9, y * 9, z * 9, sd + 7);
    out[3] = (DEAD[0] + (col[0] - DEAD[0]) * k) * n; out[4] = (DEAD[1] + (col[1] - DEAD[1]) * k) * n; out[5] = (DEAD[2] + (col[2] - DEAD[2]) * k) * n;
    out[6] = k; out[7] = 0;
  };
  // a knobbly cluster of calices at a branch end (20 triangles): the crown reads as a lumpy cauliflower with a
  // fuzzy edge instead of bare antlers; aFx.y = 1 selects the clustered-tip texture in the material
  const knob = (p, d, rad) => {
    const R = rad * (1.8 + 0.9 * rng()), ks = sd + segs;
    b.blob(0, (x, y, z, o) => {
      const s = 1 + 0.45 * vn3(x * 2 + ks, y * 2, z * 2, ks), al = x * d[0] + y * d[1] + z * d[2];
      o[0] = p[0] + (x + d[0] * al * 0.5) * R * s; o[1] = p[1] + (y + d[1] * al * 0.5) * R * s; o[2] = p[2] + (z + d[2] * al * 0.5) * R * s;
      paint(0, 0, o[0], o[1], o[2], o); o[7] = 1;
    });
  };
  const queue = [], nT = 4 + ((rng() * 3) | 0); // several fused stems, as in a bush grown from fallen fragments
  for (let k = 0; k < nT; k++) {
    const a = rng() * TAU, d0 = r * 0.22 * Math.sqrt(rng());
    queue.push({ p: [Math.cos(a) * d0, -0.03, Math.sin(a) * d0], d: nrm(Math.cos(a) * 0.35 * (rng() + 0.3), 1, Math.sin(a) * 0.35 * (rng() + 0.3)), rad: r0 * (0.85 + 0.3 * rng()), depth: 0 });
  }
  let segs = 0;
  while (queue.length && segs < maxSeg) {
    const br = queue.shift();
    let q = br.p, d = br.d, out = false, side = rng() < 0.5 ? -1 : 1;
    // near the envelope the segments shorten and split more: the crown is a dense mass of short twigs
    const e0 = env(q[0], q[1], q[2]), shell = e0 > 0.68, pts = [q], ax = perp(d, rng), n = br.depth < 2 ? 3 : shell ? 1 : 2;
    for (let k = 0; k < n; k++) {
      // zigzag: each corallite buds the next at an angle, alternating side
      d = rot(d, ax, side * (0.28 + 0.12 * rng())); side = -side;
      const len = Math.hypot(q[0], q[2]) || 1, ob = 0.12;
      d = nrm(d[0] + (q[0] / len) * ob, d[1] + 0.06, d[2] + (q[2] / len) * ob);
      q = [q[0] + d[0] * L, q[1] + d[1] * L, q[2] + d[2] * L];
      if (q[1] < 0.01) q[1] = 0.01;
      pts.push(q);
      if (env(q[0], q[1], q[2]) > 1) { out = true; break; }
    }
    const snapped = !out && br.depth > 1 && rng() < broken;
    const radii = pts.map((_, i) => br.rad * (1 - 0.12 * i / pts.length));
    b.tube(pts, radii, radial, paint, { tip: out && live > 0, cap: snapped || (out && live <= 0) });
    if ((out && rng() < 0.75) || (shell && rng() < 0.25)) knob(q, d, br.rad);
    segs++;
    if (!out && !snapped && br.depth < 9) {
      const nc = rng() < (shell ? 0.5 : 0.25) ? 3 : rng() < 0.92 ? 2 : 1;
      for (let c = 0; c < nc; c++) {
        const ca = perp(d, rng), dc = rot(d, ca, 0.4 + 0.45 * rng());
        queue.push({ p: q, d: nrm(dc[0], dc[1] + 0.05, dc[2]), rad: Math.max(r0 * 0.5, br.rad * 0.87), depth: br.depth + 1 });
      }
    }
    if (segs % 14 === 0) yield;
  }
  const t = ground(b).build();
  t.solid = true; t.nbR = r;
  return t;
}
// Low-poly bush for the instanced thicket fields (120 triangles): six zigzag branches ending in knobbly tip
// clusters, living colour over the top of the dome, bare skeleton underneath. Many of
// these, touching and overlapping, make the crown of a mound; the full colonyJob trees are the hero layer near the
// path. Template units: about 1 m across, 0.7 m tall before scaling.
export function bush(seed, col) {
  const b = new Builder(), rng = mulberry32((seed * 2477 + 19) >>> 0), sd = seed % 997, W = 0.42 + 0.1 * rng(), H = 0.55 + 0.15 * rng();
  const paint = (x, y, z, o, k0 = 1) => {
    const live = k0 * Math.min(1, Math.max(0, (y - H * 0.22) / (H * 0.35))), n = 0.8 + 0.3 * vn3(x * 7, y * 7, z * 7, sd + 2);
    o[3] = (DEAD[0] + (col[0] - DEAD[0]) * live) * n; o[4] = (DEAD[1] + (col[1] - DEAD[1]) * live) * n; o[5] = (DEAD[2] + (col[2] - DEAD[2]) * live) * n;
    o[6] = live; o[7] = 1;
  };
  // six zigzag branches fanning up and out to a dome (their bases hide in the framework tangle), each ending in a knobbly calice cluster
  // (an octahedron, 8 triangles): a branching bush at a few metres, a speckled crown from afar
  const knob = (p, r) => {
    const v0 = b.vc, D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const d of D) { const s = r * (0.8 + 0.5 * rng()), o = [0, 0, 0, 0, 0, 0, 0, 0]; paint(p[0], p[1], p[2], o); b.v(p[0] + d[0] * s, p[1] + d[1] * s * 0.8, p[2] + d[2] * s, d[0], d[1], d[2], o[3], o[4], o[5], o[6], 1); }
    for (const [a, c, e] of [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]) b.t(v0 + a, v0 + c, v0 + e);
  };
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + rng() * 0.6, e = k === 5 ? 1.45 : 0.25 + 0.75 * rng();
    const d = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)], L = 0.55 + 0.2 * rng();
    const p0 = [d[0] * W * 0.2, H * 0.25 + d[1] * H * 0.1, d[2] * W * 0.2];
    const p1 = [p0[0] + d[0] * W * L * 0.5 + (rng() - 0.5) * 0.06, p0[1] + d[1] * H * L * 0.5 + 0.03, p0[2] + d[2] * W * L * 0.5 + (rng() - 0.5) * 0.06];
    const p2 = [p0[0] + d[0] * W * L, p0[1] + d[1] * H * L + 0.05, p0[2] + d[2] * W * L];
    b.tube([p0, p1, p2], [0.04, 0.034, 0.028], 3, (v, an, x, y, z, o) => paint(x, y, z, o));
    knob(p2, W * (0.13 + 0.06 * rng()));
  }
  const t = b.build();
  // seated by the lowest points of the lumps (the dome rests on its lower shoulder)
  t.solid = false;
  return t;
}
export const drainJob = (it) => { let v; do v = it.next(); while (!v.done); return v.value; };

// ---------------------------------------------------------------- material
// Living tissue: fine polyp texture (period 0.25 m, eased to its mean once polyps shrink to a few pixels) and
// translucent tentacles that catch the lamps as a soft rim. Dead skeleton: grey-brown, silt settled on up-facing
// faces, sparse pale encrusting sponge (coverage kept low: a thicker skin read as camouflage on big surfaces).
export function lopheliaMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  return applyWater(m, {
    key: 'nb6-lophelia',
    vertexHead: 'attribute vec2 aFx; varying vec2 vFx; uniform float uTime;',
    fragmentHead: 'varying vec2 vFx; float lpH;\nvec3 lpW(vec3 n) { vec3 w = n * n; w *= w; return w / (w.x + w.y + w.z + 1e-5); }',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;');
      // living polyps breathe: the clustered tips swell and settle a few millimetres, out of phase across the reef
      // (spatial frequencies 2 pi n / 1024, so the floating-origin rebase is seamless)
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aFx.x > 0.05 && aFx.y > 0.5) {
          vec3 wq = (modelMatrix * vec4(transformed, 1.0)).xyz;
          transformed += objectNormal * aFx.x * 0.012 * sin(uTime * 0.9 + dot(wq, vec3(3.0679616, 2.4543693, 2.7611654)));
        }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          float lpLive = clamp(vFx.x, 0.0, 1.0), lpPol;
          lpH = 0.0;
          {
            vec3 pN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            vec3 pW = lpW(pN);
            float ik = nrIndex(vWPos.xz);
            vec4 a = nrTri(vWPos, pW, 0.25, ik);
            vec4 c = nrTri(vWPos, pW, 2.0, ik + 3.0);
            float fine = 1.0 - smoothstep(0.012, 0.05, length(fwidth(vWPos)));
            lpPol = mix(0.45, smoothstep(0.48, 0.66, a.a), fine);
            vec3 liveC = diffuseColor.rgb * (0.8 + 0.25 * lpPol);
            if (vFx.y > 0.5) { // clustered tips: rounded calices and twigs, deep shadowed gaps between them
              vec4 kt = nrTri(vWPos, pW, 1.0, ik + 7.0), kt2 = nrTri(vWPos, pW, 2.0, ik + 11.0);
              // fine knobs ease out first, then the 1 m clumps and their shadowed gaps; the 2 m mottling stays, so a
              // crown reads as a mottled bush mass from afar, not as a smooth sheet
              // (eased out before a period spans ~6 pixels: the texture has no mipmaps worth trusting at this scale)
              float fw = length(fwidth(vWPos)), far = smoothstep(0.03, 0.1, fw), far2 = smoothstep(0.1, 0.3, fw);
              vec4 kt3 = nrTri(vWPos, pW, 4.0, ik + 13.0);
              float tp = mix(mix(smoothstep(0.32, 0.66, kt.g * 0.6 + kt2.r * 0.4), smoothstep(0.3, 0.7, kt2.r), far), 0.55, far2);
              float gap = 1.0 - smoothstep(0.25, 0.5, mix(kt2.b * 0.7 + kt.a * 0.3, kt2.b * 0.6 + kt3.g * 0.4, far));
              float gk = 1.0 - far2;
              liveC *= (0.45 + 0.7 * tp) * (1.0 - 0.55 * gap * gk) * (0.8 + 0.4 * kt3.r);
              diffuseColor.rgb *= (0.6 + 0.6 * tp) * (1.0 - 0.5 * gap * gk);
              lpPol = max(lpPol, tp);
              lpH = (tp - gap * 0.6) * (1.0 - far);
            }
            float silt = smoothstep(0.3, 0.9, pN.y) * smoothstep(0.35, 0.72, c.b * 0.7 + a.r * 0.4);
            vec3 deadC = diffuseColor.rgb * (0.78 + 0.4 * c.g);
            deadC = mix(deadC, vec3(0.2, 0.19, 0.165) * (0.9 + 0.2 * a.g), silt * 0.7); // silt the tone of the rubble floor
            float sp = smoothstep(0.64, 0.7, c.r * 0.65 + a.b * 0.45) * 0.85;
            deadC = mix(deadC, mix(vec3(0.36, 0.31, 0.2), vec3(0.4, 0.39, 0.35), step(0.5, c.a)) * (0.8 + 0.3 * a.g), sp);
            diffuseColor.rgb = mix(deadC, liveC, lpLive);
          }`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
          #include <normal_fragment_maps>
          if (vFx.y > 0.5) { // relief of the clustered tips (screen-space bump, as in the prop materials)
            vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1);
            vec2 dH = vec2(dFdx(lpH), dFdy(lpH)) * 0.06;
            normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          if (lpLive > 0.01) {
            vec3 vd = normalize(vWPos - cameraPosition);
            vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            float rim = pow(1.0 - abs(dot(wN, vd)), 2.0);
            float d = length(vViewPosition);
            // a faint translucent fringe, capped so near colonies stay lit, not glowing (below the bloom threshold)
            vec3 lampK = min(uLamp * exp(-uSigma * d) / (1.0 + 0.05 * d * d), vec3(0.5));
            totalEmissiveRadiance += diffuseColor.rgb * lpLive * lampK * (0.04 + 0.25 * rim) * (0.6 + 0.5 * lpPol) * 0.3;
          }`);
    },
  });
}

// ---------------------------------------------------------------- rubble and small life
// A scatter of broken branch pieces lying on the seabed (instanced)
export function rubble(seed) {
  const b = new Builder(), rng = mulberry32((seed * 613 + 11) >>> 0), n = 4 + ((rng() * 4) | 0);
  const paint = (v, a, x, y, z, o) => { const k = 0.8 + 0.4 * vn3(x * 12, y * 12, z * 12, seed); o[3] = DEAD[0] * 1.15 * k; o[4] = DEAD[1] * 1.15 * k; o[5] = DEAD[2] * 1.15 * k; o[6] = 0; o[7] = 0; };
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d0 = 0.2 * Math.sqrt(rng()), len = 0.07 + rng() * 0.12, yaw = rng() * TAU, rr = 0.009 + rng() * 0.007, bend = (rng() - 0.5) * 0.6;
    const p0 = [Math.cos(a) * d0, rr * 0.7, Math.sin(a) * d0], pts = [p0];
    for (let i = 1; i <= 2; i++) { const yw = yaw + bend * i; pts.push([p0[0] + Math.cos(yw) * len * i / 2, rr * 0.7 + (rng() - 0.3) * rr, p0[2] + Math.sin(yw) * len * i / 2]); }
    b.tube(pts, [rr, rr * 0.95, rr * 0.85], 3, paint, { cap: true });
  }
  const t = ground(b).build();
  t.solid = false;
  return t;
}
// Squat lobster (Munida): orange-red, long slender claws held forward, perched on the coral
export function squatLobster(seed) {
  const b = new Builder(), rng = mulberry32((seed * 331 + 5) >>> 0), S = 0.9 + rng() * 0.3, col = [0.78, 0.2 + rng() * 0.06, 0.08];
  const pc = (k) => (v, a, x, y, z, o) => { o[3] = col[0] * k; o[4] = col[1] * k; o[5] = col[2] * k; o[6] = 0; o[7] = 0; };
  b.blob(1, (x, y, z, o) => { o[0] = x * 0.022 * S; o[1] = 0.016 * S + y * 0.011 * S; o[2] = z * 0.016 * S; const k = 0.85 + 0.25 * y; o[3] = col[0] * k; o[4] = col[1] * k; o[5] = col[2] * k; o[6] = 0; o[7] = 0; });
  // tucked abdomen
  b.tube([[-0.018 * S, 0.014 * S, 0], [-0.03 * S, 0.01 * S, 0], [-0.034 * S, 0.004 * S, 0]], [0.011 * S, 0.009 * S, 0.006 * S], 3, pc(0.9));
  const base = [];
  for (const sd of [-1, 1]) {
    // claws: long, forward, slightly spread
    const sh = [0.016 * S, 0.014 * S, sd * 0.01 * S], el = [0.05 * S, 0.02 * S, sd * 0.03 * S], tp = [0.1 * S, 0.012 * S, sd * 0.034 * S];
    b.tube([sh, el, tp], [0.0035 * S, 0.003 * S, 0.0018 * S], 3, pc(1.05), { tip: true });
    for (let k = 0; k < 3; k++) {
      const x = (0.008 - k * 0.012) * S, p = [x, 0.014 * S, sd * 0.012 * S], kn = [x + 0.004 * S, 0.02 * S, sd * 0.03 * S], ft = [x - 0.002 * S, 0, sd * 0.042 * S];
      b.tube([p, kn, ft], [0.0025 * S, 0.002 * S, 0.0014 * S], 3, pc(0.95));
      base.push(ft[0], 0, ft[2]);
    }
  }
  const t = b.build();
  setBase(t, base); t.solid = false;
  return t;
}
// Brittle star: small disc, five long thin arms curling over the rubble
export function brittleStar(seed) {
  const b = new Builder(), rng = mulberry32((seed * 197 + 9) >>> 0), Ra = 0.07 + rng() * 0.05, col = [[0.7, 0.62, 0.55], [0.75, 0.42, 0.28], [0.55, 0.5, 0.48]][(rng() * 3) | 0];
  b.blob(1, (x, y, z, o) => { o[0] = x * 0.012; o[1] = 0.005 + y * 0.004; o[2] = z * 0.012; o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0; o[7] = 0; });
  const base = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + rng() * 0.3, cu = (rng() - 0.5) * 1.6, pts = [];
    for (let i = 0; i <= 3; i++) { const t = i / 3, aa = a + cu * t * t; pts.push([Math.cos(aa) * (0.008 + Ra * t), 0.003 + 0.006 * Math.sin(t * 3.1) * rng(), Math.sin(aa) * (0.008 + Ra * t)]); }
    b.tube(pts, pts.map((_, i) => 0.0028 * (1 - i / 4.5)), 3, (v, an, x, y, z, o) => { const bnd = Math.floor(v * 10) % 2 ? 0.85 : 1; o[3] = col[0] * bnd; o[4] = col[1] * bnd; o[5] = col[2] * bnd; o[6] = 0; o[7] = 0; }, { tip: true });
    base.push(pts[3][0], 0, pts[3][2], pts[1][0], 0, pts[1][2]);
  }
  const t = ground(b).build();
  setBase(t, base); t.solid = false;
  return t;
}
// Pencil urchin (Cidaris): a small test with a few long, thick, blunt spines
export function pencilUrchin(seed) {
  const b = new Builder(), rng = mulberry32((seed * 571 + 1) >>> 0), Rt = 0.026 + rng() * 0.008, tc = [0.5, 0.26, 0.17], sc = [0.62, 0.56, 0.46];
  b.blob(1, (x, y, z, o) => { o[0] = x * Rt; o[1] = Rt * 0.8 + y * Rt * 0.8; o[2] = z * Rt; o[3] = tc[0]; o[4] = tc[1]; o[5] = tc[2]; o[6] = 0; o[7] = 0; });
  const base = [];
  for (let k = 0; k < 11; k++) {
    const u = rng() * 2 - 1, a = rng() * TAU, w = Math.sqrt(1 - u * u), dir = [Math.cos(a) * w, u * 0.8 + 0.1, Math.sin(a) * w], L = Rt * (1.8 + rng() * 1.2);
    const p0 = [dir[0] * Rt, Rt * 0.8 + dir[1] * Rt * 0.8, dir[2] * Rt], p1 = [p0[0] + dir[0] * L, Math.max(0.002, p0[1] + dir[1] * L), p0[2] + dir[2] * L];
    b.tube([p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], p1], [0.0035, 0.003, 0.0028], 3, (v, an, x, y, z, o) => { const bnd = Math.floor(v * 6) % 2 ? 0.9 : 1.05; o[3] = sc[0] * bnd; o[4] = sc[1] * bnd; o[5] = sc[2] * bnd; o[6] = 0; o[7] = 0; }, { cap: true });
    if (p1[1] < 0.01) base.push(p1[0], 0, p1[2]);
  }
  const t = ground(b).build();
  if (base.length >= 9) setBase(t, base);
  t.solid = false;
  return t;
}
// Sea anemone on rubble: a short column and a crown of tentacles (sway material, style 3 wiggle)
export function anemone(seed) {
  const b = new Builder(), rng = mulberry32((seed * 89 + 17) >>> 0), Rc = 0.025 + rng() * 0.02, Hc = 0.04 + rng() * 0.04;
  const col = [[0.85, 0.78, 0.7], [0.9, 0.45, 0.25], [0.8, 0.6, 0.55]][(rng() * 3) | 0];
  b.lathe(8, 3, (v) => [Rc * (1 + 0.25 * v), -0.01 + v * (Hc + 0.01)], null, (v, a, x, y, z, o) => { o[3] = col[0] * 0.8; o[4] = col[1] * 0.8; o[5] = col[2] * 0.8; o[6] = 0; o[7] = 3; });
  const nT = 14 + ((rng() * 8) | 0);
  for (let k = 0; k < nT; k++) {
    const a = (k / nT) * TAU, rr = Rc * (0.6 + 0.6 * (k % 2)), Lt = Rc * (1.3 + rng() * 0.8), p0 = [Math.cos(a) * rr, Hc, Math.sin(a) * rr];
    const p1 = [Math.cos(a) * (rr + Lt * 0.5), Hc + Lt * 0.6, Math.sin(a) * (rr + Lt * 0.5)], p2 = [Math.cos(a) * (rr + Lt), Hc + Lt * 0.45, Math.sin(a) * (rr + Lt)];
    b.tube([p0, p1, p2], [0.0035, 0.0028, 0.0015], 3, (v, an, x, y, z, o) => { o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0.006 * v; o[7] = 3; }, { tip: true });
  }
  const t = b.build();
  setBase(t, [Rc, -0.01, 0, -Rc, -0.01, 0, 0, -0.01, Rc, 0, -0.01, -Rc]); t.solid = false;
  return t;
}
export { lab };
