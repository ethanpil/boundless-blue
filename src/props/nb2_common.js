// Shared infrastructure for seamount, blue hole, sunken forest and champagne reef props:
// a weathered-bark material (parametric furrows, end grain, silt dust), shader-driven rising bubble
// streams (wobble, squash, shimmer, fade at the surface), light-shaft beams, per-segment template pools
// on top of rock_gen.js palettes, weighted picking and small placement helpers.
import * as THREE from 'three';
import { applyWater } from '../water.js';
import { Builder, TAU, vn3, sat, sstep, lerp, releaseAfterUpload, CHUNK } from './core.js';
import { paletteOf } from './rock_gen.js';
import { registerNB, finishNB, surfGrid, rayY, basePts } from './nb_common.js';
import { MAT } from './materials.js';
import { mulberry32 } from '../noise.js';
import { crustMaterial } from './nb2_crust.js';

export const NB2 = { mat: {}, stats: {} };
export const pick = (rng, a) => a[(rng() * a.length) | 0];
export const rr = (rng, a, b) => a + (b - a) * rng();
export function pickW(rng, list) { // list of [weight, value]
  let t = 0; for (const e of list) t += e[0];
  let u = rng() * t;
  for (const e of list) { if ((u -= e[0]) <= 0) return e[1]; }
  return list[list.length - 1][1];
}
// tint around a palette colour (linear RGB), keeps hue but varies value / saturation a little
export function tintOf(rng, list, amt = 0.15) {
  const c = list[(rng() * list.length) | 0], k = 1 + (rng() * 2 - 1) * amt;
  return [c[0] * k * (1 + (rng() - 0.5) * amt), c[1] * k * (1 + (rng() - 0.5) * amt), c[2] * k * (1 + (rng() - 0.5) * amt)];
}
export const chunkRng = (ctx, salt) => mulberry32(((Math.floor(ctx.s0) * 2654435761) ^ salt) >>> 0);
// per-segment template pool from the rock_gen palette (fresh shapes for every segment) or a fallback
export function poolOf(g, name, fallback, min = 3) {
  const p = g && paletteOf(g), l = p && p.pools[name];
  return l && l.length >= min ? l : fallback;
}

// ---------------------------------------------------------------- bark tubes
// Generalised cylinder with a duplicated seam column so the bark shader's parametric coordinates wrap
// cleanly. aFx = (u * around, metres along); end caps (broken / cut tops) get aFx = (r from pith, -50).
// rad(j, ang) -> radius; col(j, ang, x, y, z, out) paints rgb. Normals are analytic (frame + taper).
export function barkTube(b, pts, radii, radial, { around = 0, col = null, cap = false, jag = 0, rng = null, along0 = 0, rad = null } = {}) {
  const n = pts.length, T = [], N1 = [], N2 = [], L = [along0];
  for (let j = 0; j < n; j++) {
    const a = pts[Math.max(0, j - 1)], c = pts[Math.min(n - 1, j + 1)];
    let tx = c[0] - a[0], ty = c[1] - a[1], tz = c[2] - a[2];
    const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
    let nx, ny, nz;
    if (j === 0) { if (Math.abs(ty) < 0.9) { nx = tz; ny = 0; nz = -tx; } else { nx = 1; ny = 0; nz = 0; } } else [nx, ny, nz] = N1[j - 1];
    const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz;
    const m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m;
    T.push([tx, ty, tz]); N1.push([nx, ny, nz]); N2.push([ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx]);
    if (j) L.push(L[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1], pts[j][2] - pts[j - 1][2]));
  }
  const ar = around || Math.max(1, Math.round((TAU * radii[0]) / 1.1));
  const v0 = b.vc, cols = radial + 1, o = [1, 1, 1];
  for (let j = 0; j < n; j++) {
    const p = pts[j], A = N1[j], B = N2[j], t = T[j];
    // taper: the surface leans toward the axis, tilting the normal along the tangent
    const dr = j < n - 1 ? (radii[j + 1] - radii[j]) / Math.max(1e-3, L[j + 1] - L[j]) : j ? (radii[j] - radii[j - 1]) / Math.max(1e-3, L[j] - L[j - 1]) : 0;
    for (let i = 0; i < cols; i++) {
      const u = i / radial, ang = u * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
      const r = rad ? rad(j, ang, radii[j]) : radii[j];
      let x = p[0] + r * (ca * A[0] + sa * B[0]), y = p[1] + r * (ca * A[1] + sa * B[1]), z = p[2] + r * (ca * A[2] + sa * B[2]);
      if (jag && j === n - 1 && rng) { const k = jag * (0.3 + 0.7 * Math.abs(Math.sin(ang * 2.5 + 1.3 * vn3(ca, sa, j, 7)))); x += t[0] * k; y += t[1] * k; z += t[2] * k; }
      let nx = ca * A[0] + sa * B[0] - dr * t[0], ny = ca * A[1] + sa * B[1] - dr * t[1], nz = ca * A[2] + sa * B[2] - dr * t[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      o[0] = o[1] = o[2] = 1;
      if (col) col(j, ang, x, y, z, o);
      b.v(x, y, z, nx / l, ny / l, nz / l, o[0], o[1], o[2], u * ar, L[j]);
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < radial; i++) {
    const a = v0 + j * cols + i, c = a + cols;
    b.t(a, c, a + 1); b.t(a + 1, c, c + 1);
  }
  if (cap) { // end grain disc (slightly domed), rings around the pith
    const j = n - 1, p = pts[j], t = T[j], A = N1[j], B = N2[j], r = radii[j], c0 = b.vc;
    o[0] = o[1] = o[2] = 1;
    if (col) col(j, 0, p[0], p[1], p[2], o);
    const k = [o[0] * 1.15, o[1] * 1.1, o[2] * 1.0];
    const ce = b.v(p[0] + t[0] * (jag * 0.4), p[1] + t[1] * (jag * 0.4), p[2] + t[2] * (jag * 0.4), t[0], t[1], t[2], k[0], k[1], k[2], 0, -50);
    for (let i = 0; i < radial; i++) {
      const q = v0 + j * cols + i;
      b.v(b.P[q * 3], b.P[q * 3 + 1], b.P[q * 3 + 2], t[0], t[1], t[2], k[0] * 0.8, k[1] * 0.8, k[2] * 0.8, r, -50);
    }
    for (let i = 0; i < radial; i++) b.t(c0 + 1 + i, c0 + 1 + ((i + 1) % radial), ce);
  }
  return { v0, L: L[n - 1], frames: { T, N1, N2 } };
}

// ---------------------------------------------------------------- materials
const BARK_V = /* glsl */`
attribute vec2 aFx;
varying vec2 vFx;
`;
const BARK_F = /* glsl */`
varying vec2 vFx;
vec3 bBump(vec3 sp, vec3 sn, vec2 dH, float fd) {
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * sn - g);
}
`;
// Weathered drowned wood. Furrows and grain come from the tube's own parametric coordinates (no world
// space, so the pattern never swims under a floating-origin rebase); silt settles on up-facing faces.
function barkMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  return applyWater(m, {
    key: 'nb2-bark', vertexHead: BARK_V, fragmentHead: BARK_F,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          float bH;
          {
            vec2 q = vFx;
            vec3 nW = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            if (q.y < -40.0) {
              // end grain: growth rings around the pith, radial checks, grey weathered surface
              float r = q.x;
              vec4 n = texture2D(uNoiseTex, vWPos.xz * 0.5);
              float ring = abs(fract(r * 16.0 + n.r * 1.4) - 0.5) * 2.0;
              diffuseColor.rgb *= 0.72 + 0.32 * smoothstep(0.15, 0.85, ring);
              float chk = smoothstep(0.86, 0.97, texture2D(uNoiseTex, vec2(atan(n.g - 0.5, n.b - 0.5) * 0.3, r * 0.5)).a);
              diffuseColor.rgb *= 1.0 - 0.45 * chk;
              bH = ring * 0.25 - chk * 0.5;
            } else {
              vec2 tq = vec2(q.x, q.y * 0.3);
              vec4 a = texture2D(uNoiseTex, tq);
              vec4 c = texture2D(uNoiseTex, tq * vec2(2.0, 2.6) + vec2(0.37, 0.11));
              float plate = smoothstep(0.32, 0.72, a.a * 0.65 + c.r * 0.5);       // bark plates between furrows
              float grain = texture2D(uNoiseTex, vec2(q.x * 3.0 + 0.5, q.y * 0.07)).g;
              diffuseColor.rgb *= (0.5 + 0.62 * plate) * (0.88 + 0.24 * grain);
              // pale, sun-bleached crests; dark wet furrows
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.16, 1.12), smoothstep(0.75, 0.95, plate) * 0.5);
              bH = plate * 0.85 + c.g * 0.15;
            }
            // silt dusting and a faint green algal film on up-facing wood (world space, periods divide 1024)
            vec4 w1 = texture2D(uNoiseTex, vWPos.xz * 0.25);
            vec4 w2 = texture2D(uNoiseTex, vWPos.xz * 1.0 + vWPos.y * 0.13);
            float up = smoothstep(0.35, 0.95, nW.y);
            float dust = up * smoothstep(0.3, 0.7, w1.b * 0.7 + w2.r * 0.4) * 0.7;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.44, 0.42, 0.35) * (0.85 + 0.3 * w2.g), dust);
            float film = smoothstep(0.55, 0.8, w1.g * 0.6 + w2.b * 0.5) * (0.35 + 0.4 * up);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 1.05, 0.7), film * 0.6);
            bH += dust * 0.3;
          }`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
          #include <normal_fragment_maps>
          normal = bBump(-vViewPosition, normal, vec2(dFdx(bH), dFdy(bH)) * 0.045, faceDirection);`);
    },
  });
}

// Rising gas bubbles (champagne vents). Each quad is one bubble of a stream: the vertex shader lifts it
// (fract of time: bubbles are born at the vent, rise, wobble along a helix that widens with height, grow
// as the pressure drops, squash and stretch), the fragment shader draws a silvery rim (total internal
// reflection), a sun highlight and a faint lens. Additive; fogged by applyWater; fades near the camera
// and at the surface.
// attributes: position = vent (chunk local), aCorner, aB = (phase, rise speed m/s, rise height m, radius m),
// aW = (wobble amplitude m, wobble rate, seed 0..1, drift)
const BUB_V = /* glsl */`
attribute vec2 aCorner; attribute vec4 aB; attribute vec4 aW;
varying vec2 vC; varying float vT; varying float vS; varying float vCam; varying float vTop; varying float vK;
uniform float uTime;
`;
const BUB_F = /* glsl */`
varying vec2 vC; varying float vT; varying float vS; varying float vCam; varying float vTop; varying float vK;
`;
function bubbleMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  return applyWater(m, {
    key: 'nb2-bubble', additive: true, noLight: true, vertexHead: BUB_V, fragmentHead: BUB_F,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', /* glsl */`
        float rate = aB.y / max(0.5, aB.z);
        float t = fract(uTime * rate + aB.x);
        float h = pow(t, 1.6) * aB.z;   // bubbles speed up as they rise: a dense string at the vent, spreading above
        vec3 c = position;
        c.y += h;
        float ph = aW.z * 6.2831853 + uTime * aW.y;
        float amp = aW.x * (0.25 + 0.75 * sqrt(t));
        c.x += sin(ph + h * 2.3) * amp + aW.w * h * h * 0.02;
        c.z += aW.w * h * h * 0.012;
        c.z += cos(ph * 0.83 + h * 1.9) * amp;
        float sz = aB.w * (0.75 + 0.55 * t);
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        // never smaller than ~1.6 px (assuming ~700 px tall): distant streams stay visible as silver threads
        float minSz = 1.6 * max(0.1, -mvPosition.z) / (projectionMatrix[1][1] * 350.0);
        vK = sz < minSz ? pow(sz / minSz, 1.3) * 0.85 + 0.03 : 1.0;
        sz = max(sz, minSz);
        float wob = sin(uTime * (8.0 + aW.z * 5.0) + aW.z * 40.0);
        vec2 sq = vec2(1.0 + 0.16 * wob, 1.0 - 0.14 * wob);
        mvPosition.xy += aCorner * sq * sz;
        gl_Position = projectionMatrix * mvPosition;
        vC = aCorner; vT = t; vS = aW.z;
        vCam = length(mvPosition.xyz);
        vTop = (modelMatrix * vec4(c, 1.0)).y;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          float r = length(vC);
          if (r > 1.0) discard;
          float rim = smoothstep(0.62, 0.93, r) * (1.0 - smoothstep(0.93, 1.0, r));
          float lens = (1.0 - r) * 0.07;
          vec2 hp = vC - vec2(-0.32, 0.38);
          float hl = exp(-dot(hp, hp) * 38.0);
          vec2 hq = vC - vec2(0.3, -0.42);
          float hl2 = exp(-dot(hq, hq) * 90.0) * 0.35;
          float shim = 0.65 + 0.35 * sin(uTime * 11.0 + vS * 63.0 + vT * 20.0);
          float dB = max(0.0, uSurfaceY - vWPos.y);
          vec3 sunL = uSunColor * uSunScatter * exp(-uLightSigma * dB);
          vec3 amb = uWaterUp * 0.9 + vec3(0.05);
          // tiny (clamped) bubbles: a soft silver dot instead of a ring
          float dot0 = (1.0 - smoothstep(0.0, 1.0, r)) * step(vK, 0.999) * 0.8;
          vec3 col = (sunL * 0.85 + amb * 0.55) * (rim * 0.9 + lens + dot0) + sunL * (hl * 1.8 + hl2) * shim;
          col += vec3(1.0, 0.94, 0.85) * uLamp * (rim * 0.5 + hl * 0.9) * 0.9 / (1.0 + 0.03 * vCam * vCam);
          float life = smoothstep(0.0, 0.035, vT) * (1.0 - smoothstep(-0.6, -0.1, vTop - uSurfaceY));
          float camF = smoothstep(0.35, 1.4, vCam);
          diffuseColor.rgb = col * life * camF * vK;
        }`);
    },
  });
}


// Gorgonian fans: vertex sway (aFx.x = amplitude; spatial phase periods divide 1024) and a reticulated
// net cut from the fan sheet (aFx.y = 1 sheet, 0 solid branches): two scales of ridged noise in the fan's
// own plane (triplanar), with tiny pale polyps on the mesh. Up close it is an open lattice; farther away
// the net closes into a veil instead of shimmering.
const FAN_V = /* glsl */`
attribute vec2 aFx;
varying vec2 vFx;
uniform float uTime;
vec3 fanSway(vec3 wq, float w) {
  if (w <= 0.0) return vec3(0.0);
  float ph = dot(wq.xz, vec2(0.2454369, 0.1963495)) + wq.y * 0.19634954;
  return vec3(sin(uTime * 0.7 + ph), 0.15 * sin(uTime * 0.9 + ph * 1.7), 0.7 * sin(uTime * 0.55 + ph * 1.3 + 1.0)) * w;
}
`;
const FAN_F = /* glsl */`
varying vec2 vFx;
vec3 fTriW(vec3 n) { vec3 w = n * n; w *= w; return w / (w.x + w.y + w.z + 1e-5); }
vec4 fTri(vec3 p, vec3 w, float P) {
  return texture2D(uNoiseTex, p.yz / P) * w.x + texture2D(uNoiseTex, p.xz / P) * w.y + texture2D(uNoiseTex, p.xy / P) * w.z;
}
float fBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float fBayer4(vec2 a) { return fBayer2(0.5 * a) * 0.25 + fBayer2(a); }
`;
function fanMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  return applyWater(m, {
    key: 'nb2-fan', vertexHead: FAN_V, fragmentHead: FAN_F,
    patch(sh) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;')
        .replace('#include <project_vertex>', /* glsl */`
          vec4 mvPosition = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          mvPosition.xyz += fanSway( ( modelMatrix * mvPosition ).xyz, aFx.x );
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          {
            vec3 nW = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            vec3 w = fTriW(nW);
            float dist = length(vWPos - cameraPosition);
            vec4 a = fTri(vWPos, w, 1.0);
            vec4 b = fTri(vWPos + vec3(0.37, 0.11, 0.23), w, 0.5);
            vec3 fw = vec3(fwidth(a.r), fwidth(b.g), fwidth(a.b)); // outside the branch (derivatives)
            if (vFx.y > 0.5) {
              // reticulated net: iso-lines of two noise fields cross into irregular meshes. Every strand
              // stays at least ~2 px wide, so the lace holds up at mid range without sub-pixel shimmer;
              // only far away do the strands thicken until the fan reads as a veil
              float wd = mix(0.02, 0.13, smoothstep(24.0, 48.0, dist));
              float w1 = max(wd, fw.x), w2 = max(wd * 0.8, fw.y * 0.9), w3 = max(wd * 0.6, fw.z * 0.8);
              float l1 = abs(a.r - 0.5), l2 = abs(b.g - 0.5), l3 = abs(a.b - 0.5);
              float line = max(max(1.0 - smoothstep(w1, w1 * 1.7, l1), 1.0 - smoothstep(w2, w2 * 1.75, l2)), 1.0 - smoothstep(w3, w3 * 1.8, l3));
              if (line < 0.5) discard;
              // far away the closed net is a veil, not a sheet: screen-door transparency (stable 4x4
              // pattern), which the distance softening of the composite pass blends into translucency
              if (fBayer4(gl_FragCoord.xy) < 0.5 * smoothstep(14.0, 32.0, dist)) discard;
              diffuseColor.rgb *= 0.75 + 0.35 * line;
            }
            // polyps: tiny pale dots along the mesh, fading with distance
            float pol = smoothstep(0.7, 0.8, texture2D(uNoiseTex, (vWPos.xy + vWPos.z * 0.75) / 0.125).b) * (1.0 - smoothstep(3.0, 9.0, dist));
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + 0.06, pol * 0.6);
            diffuseColor.rgb *= 0.85 + 0.3 * a.g;
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          {
            // thin tissue glows a little when the sun is behind it
            vec3 vd = normalize(vWPos - cameraPosition);
            float tr = pow(max(dot(vd, uSunDir), 0.0), 3.0);
            float dB = max(0.0, uSurfaceY - vWPos.y);
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * uSunScatter * exp(-uLightSigma * dB * 0.8) * skyVis(vWPos) * (0.06 + 0.5 * tr);
            totalEmissiveRadiance += diffuseColor.rgb * uLamp * 0.06;
          }`);
    },
  });
}

export function initNB2Materials() {
  if (NB2.mat.bark) return NB2.mat;
  NB2.mat.bark = barkMaterial();
  NB2.mat.bubble = bubbleMaterial();
  NB2.mat.fan = fanMaterial();
  NB2.mat.crust = crustMaterial();
  return NB2.mat;
}

// ---------------------------------------------------------------- bubble streams
// streams: [{x, y, s, n, rise, speed, size, wob, drift}] (global x, y, s). One mesh per chunk.
export function bubbleMesh(ctx, streams, rng) {
  let total = 0;
  for (const e of streams) total += e.n;
  if (!total) return null;
  const pos = new Float32Array(total * 12), cor = new Float32Array(total * 8), ab = new Float32Array(total * 16), aw = new Float32Array(total * 16);
  const idx = total * 4 > 65535 ? new Uint32Array(total * 6) : new Uint16Array(total * 6);
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  let q = 0;
  for (const e of streams) {
    const z = -(e.s - ctx.s0);
    for (let k = 0; k < e.n; k++, q++) {
      const ph = (k + rng() * 0.6) / e.n, sp = e.speed * (0.8 + 0.4 * rng()), sz = e.size * (0.55 + 0.9 * rng() * rng());
      const seed = rng(), w = e.wob * (0.6 + 0.8 * rng());
      const jx = (rng() - 0.5) * e.spread, jz = (rng() - 0.5) * e.spread;
      for (let c = 0; c < 4; c++) {
        const v = q * 4 + c;
        pos[v * 3] = e.x + jx; pos[v * 3 + 1] = e.y; pos[v * 3 + 2] = z + jz;
        cor[v * 2] = C[c * 2]; cor[v * 2 + 1] = C[c * 2 + 1];
        ab[v * 4] = ph; ab[v * 4 + 1] = sp; ab[v * 4 + 2] = e.rise; ab[v * 4 + 3] = sz;
        aw[v * 4] = w; aw[v * 4 + 1] = 1.5 + 2.5 * seed; aw[v * 4 + 2] = seed; aw[v * 4 + 3] = e.drift;
      }
      const b = q * 4, o = q * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  g.setAttribute('aB', new THREE.BufferAttribute(ab, 4));
  g.setAttribute('aW', new THREE.BufferAttribute(aw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 12;
  releaseAfterUpload(g);
  const m = new THREE.Mesh(g, NB2.mat.bubble);
  m.matrixAutoUpdate = false;
  m.renderOrder = 2;
  m.userData.lod = 'mid';
  return m;
}

// ---------------------------------------------------------------- light shafts
// beams: [{x, s, yTop, yBot, r0, ph}] along the refracted sun direction (global x, s). MAT.shaft look.
export function shaftMesh(ctx, beams, sunDir) {
  if (!beams.length || !MAT.shaft) return null;
  let d = [-sunDir.x * 0.6, -Math.max(0.5, sunDir.y), -sunDir.z * 0.6];
  const l = Math.hypot(d[0], d[1], d[2]); d = d.map((v) => v / l);
  const NR = 12, NL = 3, vpb = NR * (NL + 1);
  const pos = new Float32Array(beams.length * vpb * 3), nor = new Float32Array(beams.length * vpb * 3), fx = new Float32Array(beams.length * vpb * 2);
  const idx = new Uint16Array(beams.length * NR * NL * 6);
  let a = [d[2], 0, -d[0]]; const al = Math.hypot(a[0], a[1], a[2]) || 1; a = a.map((v) => v / al);
  const bb = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  let vi = 0, ii = 0;
  for (const B of beams) {
    const base = vi, L = (B.yTop - B.yBot) / -d[1];
    const top = [B.x, B.yTop, -(B.s - ctx.s0)];
    const r1 = B.r0 * 1.3 + L * 0.025;
    for (let j = 0; j <= NL; j++) {
      const t = j / NL, r = lerp(B.r0, r1, t), c = [top[0] + d[0] * L * t, top[1] + d[1] * L * t, top[2] + d[2] * L * t];
      for (let i = 0; i < NR; i++, vi++) {
        const ang = (i / NR) * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
        const n = [a[0] * ca + bb[0] * sa, a[1] * ca + bb[1] * sa, a[2] * ca + bb[2] * sa];
        pos[vi * 3] = c[0] + n[0] * r; pos[vi * 3 + 1] = c[1] + n[1] * r; pos[vi * 3 + 2] = c[2] + n[2] * r;
        nor[vi * 3] = n[0]; nor[vi * 3 + 1] = n[1]; nor[vi * 3 + 2] = n[2];
        fx[vi * 2] = t; fx[vi * 2 + 1] = B.ph;
      }
    }
    for (let j = 0; j < NL; j++) for (let i = 0; i < NR; i++) {
      const p = base + j * NR + i, q = base + j * NR + ((i + 1) % NR), r = p + NR, s = q + NR;
      idx[ii++] = p; idx[ii++] = q; idx[ii++] = r; idx[ii++] = q; idx[ii++] = s; idx[ii++] = r;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aFx', new THREE.BufferAttribute(fx, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  releaseAfterUpload(g);
  const m = new THREE.Mesh(g, MAT.shaft);
  m.matrixAutoUpdate = false;
  m.renderOrder = 3;
  return m;
}

// ---------------------------------------------------------------- misc helpers
// Attach spots on a template's surface: vertices whose normal passes `test`, farthest-point thinned.
// Returns Float32Array [x, y, z, nx, ny, nz, ...] (template space).
export function surfaceSpots(tpl, max, test, seed = 1) {
  const P = tpl.pos, N = tpl.nor, cand = [];
  for (let i = 0; i < tpl.vc; i++) if (test(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2])) cand.push(i);
  const rng = mulberry32(seed), out = [];
  for (let k = cand.length - 1; k > 0; k--) { const j = (rng() * (k + 1)) | 0; const t = cand[k]; cand[k] = cand[j]; cand[j] = t; }
  const minD = 0.25;
  for (const i of cand) {
    if (out.length >= max * 6) break;
    let ok = true;
    for (let q = 0; q < out.length; q += 6) { const dx = out[q] - P[i * 3], dy = out[q + 1] - P[i * 3 + 1], dz = out[q + 2] - P[i * 3 + 2]; if (dx * dx + dy * dy + dz * dz < minD * minD) { ok = false; break; } }
    if (ok) out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
  }
  return Float32Array.from(out);
}
// Distance from global (x, y) at s to the camera path line (lateral / vertical plane).
export function pathDist(pc, x, y, s) { const dx = x - pc.x(s), dy = y - pc.y(s); return Math.sqrt(dx * dx + dy * dy); }
// Simple 2D occupancy (per chunk) for keeping big items apart: circles in (x, s).
export class Occ {
  constructor() { this.c = []; }
  free(x, s, r) { for (const q of this.c) { const dx = q[0] - x, ds = q[1] - s, m = q[2] + r; if (dx * dx + ds * ds < m * m) return false; } return true; }
  add(x, s, r) { this.c.push([x, s, r]); }
}
export { Builder, vn3, sat, sstep, lerp, TAU, CHUNK };

// ---------------------------------------------------------------- placement
// Hot cells: floor samples on a lateral grid around the path, filtered by test(y - pathY, ny, dx).
// Returns [{x, s, y, ny, rel, dx}] (cell centres) for importance sampling of steep, visible terrain.
export function hotCells(ctx, fs, pc, { W = 50, cell = 4, test }) {
  const it = hotCellsG(ctx, fs, pc, { W, cell, test }, null);
  let r; do r = it.next(); while (!r.done);
  return r.value;
}
// generator form: yields whenever the slice Y (from nb_common.slice) is over
export function* hotCellsG(ctx, fs, pc, { W = 50, cell = 4, test }, Y) {
  const out = [];
  for (let s = ctx.s0 + cell / 2; s < ctx.s1; s += cell) {
    if (Y && Y.over()) { yield; Y.reset(); }
    const px = pc.x(s), py = pc.y(s);
    for (let dx = -W + cell / 2; dx < W; dx += cell) {
      const x = px + dx, y = fs.at(x, s), ny = fs.ny, rel = y - py;
      if (test(rel, ny, dx)) out.push({ x, s, y, ny, rel, dx });
    }
  }
  return out;
}
// floor facet at (x, s): normal n, horizontal outward direction hn (null on flat ground)
export function facet(fs, x, s) {
  const y = fs.at(x, s), n = [fs.nx, fs.ny, fs.nz], hl = Math.hypot(n[0], n[2]);
  return { y, n, hn: hl > 0.05 ? [n[0] / hl, 0, n[2] / hl] : null };
}
// Hang a template (authored base-up: R maps local +y downward) under a support's underside so every base
// point is `embed` m inside it. sup.at(x, s) = underside height. Returns the anchor y or NaN.
export function hangY(sup, B, R, sc, x, y, s, embed = 0.03) {
  let need = -1e9;
  for (let i = 0; i < B.length; i += 3) {
    const lx = B[i] * sc, ly = B[i + 1] * sc, lz = B[i + 2] * sc;
    const ox = R[0] * lx + R[1] * ly + R[2] * lz, oy = R[3] * lx + R[4] * ly + R[5] * lz, oz = R[6] * lx + R[7] * ly + R[8] * lz;
    const h = sup.at(x + ox, s - oz);
    if (!isFinite(h) || Math.abs(h) > 1e8) return NaN;
    need = Math.max(need, h + embed - (y + oy)); // positive: move up
  }
  return y + need;
}

// Decorate a placed batch item: spots on its own surface (template vertices whose normal faces
// outward/upward), transformed with the item. Returns [{x, y, s, n, lny, lr}] for the spots facing within
// `minNy` of up in world space; lny = the spot normal's y in template space, lr = the local wood radius
// (nearest spine point) when the template has a spine. Spots are cached per template.
const SPOTS = new WeakMap();
export function itemSpots(it, ctx, max = 40, minNy = 0.3, filter = null) {
  const t = it.tpl;
  let sp = SPOTS.get(t);
  if (!sp) {
    const raw = surfaceSpots(t, 48, (x, y, z, nx, ny) => ny > -0.6 && y > t.minY + (t.maxY - t.minY) * 0.08, (t.vc * 7) | 0), S = t.spine;
    sp = new Float32Array((raw.length / 6) * 7);
    for (let i = 0, o = 0; i < raw.length; i += 6, o += 7) {
      for (let k = 0; k < 6; k++) sp[o + k] = raw[i + k];
      let lr = 1e3;
      if (S) { let bd = 1e9; for (let q = 0; q < S.length; q += 4) { const d = (S[q] - raw[i]) ** 2 + (S[q + 1] - raw[i + 1]) ** 2 + (S[q + 2] - raw[i + 2]) ** 2; if (d < bd) { bd = d; lr = S[q + 3]; } } }
      sp[o + 6] = lr;
    }
    SPOTS.set(t, sp);
  }
  const R = it.R, out = [], k = Math.min(it.sx, it.sz);
  for (let i = 0; i < sp.length && out.length < max; i += 7) {
    const px = sp[i] * it.sx, py = sp[i + 1] * it.sy, pz = sp[i + 2] * it.sz;
    const a = sp[i + 3] / it.sx, b = sp[i + 4] / it.sy, c = sp[i + 5] / it.sz;
    let nx = R[0] * a + R[1] * b + R[2] * c, ny = R[3] * a + R[4] * b + R[5] * c, nz = R[6] * a + R[7] * b + R[8] * c;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (ny < minNy) continue;
    const x = R[0] * px + R[1] * py + R[2] * pz + it.x, y = R[3] * px + R[4] * py + R[5] * pz + it.y, z = R[6] * px + R[7] * py + R[8] * pz + it.z;
    const q = { x, y, s: ctx.s0 - z, n: [nx, ny, nz], lny: sp[i + 4], lr: sp[i + 6] * k };
    if (!filter || filter(q)) out.push(q);
  }
  return out;
}
// Exact seating of a decoration on the UP-facing surface of a placed item (any rotation): every base
// point of `tpl` (rotation R2, scale sc, anchored at P = [x, y, s]) is measured against the item's top
// surface along the item's own up axis; the decoration moves along that axis until all of them are
// `embed` inside. Returns false when a base point overhangs the item.
export function seatOnItem(it, s0, tpl, R2, sc, P, embed = 0.025) {
  const B = basePts(tpl), R = it.R, ux = R[1], uy = R[4], uz = R[7];
  let worst = -1e9;
  for (let i = 0; i < B.length; i += 3) {
    const bx = B[i] * sc, by = B[i + 1] * sc, bz = B[i + 2] * sc;
    const wx = P[0] + R2[0] * bx + R2[1] * by + R2[2] * bz - it.x, wy = P[1] + R2[3] * bx + R2[4] * by + R2[5] * bz - it.y;
    const wz = -(P[2] - s0) + R2[6] * bx + R2[7] * by + R2[8] * bz - it.z;
    // to template space: R^T, then unscale
    const lx = (R[0] * wx + R[3] * wy + R[6] * wz) / it.sx, ly = (R[1] * wx + R[4] * wy + R[7] * wz) / it.sy, lz = (R[2] * wx + R[5] * wy + R[8] * wz) / it.sz;
    const h = rayY(it.tpl, lx, lz, true);
    if (h !== h || (h - ly) * it.sy > 0.3) return false; // overhangs the edge, or something else is above
    worst = Math.max(worst, (ly - h) * it.sy);
  }
  const d = worst + embed;
  P[0] -= ux * d; P[1] -= uy * d; P[2] += uz * d;
  return true;
}
// Weighted random choice over a list (cumulative table, binary search).
export class WPick {
  constructor(list, wfn) {
    this.list = list; this.cum = new Float64Array(list.length);
    let t = 0;
    for (let i = 0; i < list.length; i++) { t += Math.max(0, wfn(list[i])); this.cum[i] = t; }
    this.tot = t;
  }
  get empty() { return !this.list.length || this.tot <= 0; }
  pick(rng) {
    const u = rng() * this.tot, c = this.cum;
    let lo = 0, hi = c.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < u) lo = m + 1; else hi = m; }
    return this.list[lo];
  }
}
// visibility weight of a cell for props: close to the camera line matters most
export const visW = (c, pc, near = 10) => { const d = Math.hypot(c.x - pc.x(c.s), c.y - pc.y(c.s)); return d < near ? 1 : Math.max(0.05, Math.exp(-(d - near) / near)); };

// ---------------------------------------------------------------- staging
// Same contract as nb_common.stagedNB (layout -> { batches, extra, labels, pois }, possibly a generator
// that yields at its time slices), but with smaller merge jobs so no stage exceeds ~5 ms on weak CPUs.
export function stagedNB2(layout, nBuild = 16, verts = 18000) {
  const cache = new WeakMap();
  const finalize = (ctx, L) => {
    L.jobs = []; L.j = 0;
    for (const b of L.batches) {
      if (!b || !b.items.length) continue;
      const n = Math.max(1, Math.ceil(b.vc / (b.jobVerts || verts)));
      for (let k = 0; k < n; k++) L.jobs.push([b, k, n]);
    }
    // ready-made meshes go out one per stage as well
    if (L.extra) for (const m of L.extra) if (m) L.jobs.push([m]);
    cache.set(ctx.group, L);
    registerNB(ctx, L.batches, L.labels);
    if (L.pois && ctx.addPOI) for (const p of L.pois) ctx.addPOI(p.type, p.x, p.y, p.s, p.r, p.data);
  };
  const buildJobs = (st, last) => {
    const jobs = last ? st.jobs.slice(st.j) : st.jobs.slice(st.j, st.j + 1);
    st.j += jobs.length;
    return jobs.map((j) => {
      if (j.length === 1) return j[0];
      const [b, i, n] = j, m = b.build(i, n, b.pad ?? 1);
      if (m && b.lod) m.userData.lod = b.lod;
      if (m && b.order) m.renderOrder = b.order;
      return m;
    });
  };
  const step = (ctx, last) => {
    const st = cache.get(ctx.group);
    if (!st) return null;
    if (st.gen) {
      let v = st.gen.next();
      if (last) while (!v.done) v = st.gen.next();
      if (!v.done) return null;
      if (!v.value) { cache.delete(ctx.group); return null; }
      finalize(ctx, v.value);
      if (!last) return null; // merges get stages of their own
    }
    const L = cache.get(ctx.group);
    if (!L || !L.jobs || L.j >= L.jobs.length) { cache.delete(ctx.group); return null; }
    const parts = buildJobs(L, last);
    if (L.j >= L.jobs.length) cache.delete(ctx.group);
    return finishNB(parts);
  };
  const pops = [(ctx) => {
    const r = layout(ctx);
    if (!r) return null;
    if (typeof r.next === 'function') { cache.set(ctx.group, { gen: r }); return step(ctx, false); }
    finalize(ctx, r);
    return null;
  }];
  for (let k = 0; k < nBuild; k++) pops.push((ctx) => step(ctx, k === nBuild - 1));
  return pops;
}
// A plan computed incrementally (generator yielding at its slices) and shared by several chains:
// planned(key, gen) -> { get(ctx) (drains if needed), stage(ctx) (a generator layout for a plan stage) }
export function planned(gen) {
  const M = new WeakMap();
  const state = (ctx) => { let st = M.get(ctx.group); if (!st) { st = { P: null, it: gen(ctx) }; M.set(ctx.group, st); } return st; };
  return {
    get(ctx) { const st = state(ctx); if (!st.P) { let r; do r = st.it.next(); while (!r.done); st.P = r.value; } return st.P; },
    *stage(ctx) { const st = state(ctx); if (st.P) return null; let r; while (!(r = st.it.next()).done) yield; st.P = r.value; return null; },
  };
}

// Support surface of a placed (yaw-only) item along a vertical line, choosing the hit nearest to a
// reference height (template space): up = true -> first surface above yRef (a ceiling), else below (a floor).
export function nearSupport(tpl, x, y, s, R, sx, sy, sz, up, yRefL) {
  const c = R[0], sn = R[2], G = surfGrid(tpl), P = tpl.pos, I = tpl.idx;
  return {
    nx: 0, ny: up ? -1 : 1, nz: 0, miss: 0,
    at(qx, qs) {
      const ox = qx - x, oz = -(qs - s);
      const px = (c * ox - sn * oz) / sx, pz = (sn * ox + c * oz) / sz;
      const i = Math.floor((px - G.x0) / G.cell), j = Math.floor((pz - G.z0) / G.cell);
      if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) { this.miss++; return up ? 1e9 : -1e9; }
      let best = NaN, bd = 1e9;
      for (const t of G.cells[j * G.nx + i]) {
        const a = I[t] * 3, b = I[t + 1] * 3, cc = I[t + 2] * 3;
        const ax = P[a], az = P[a + 2], e1x = P[b] - ax, e1z = P[b + 2] - az, e2x = P[cc] - ax, e2z = P[cc + 2] - az;
        const det = e1x * e2z - e2x * e1z;
        if (Math.abs(det) < 1e-12) continue;
        const u = ((px - ax) * e2z - e2x * (pz - az)) / det, v = (e1x * (pz - az) - (px - ax) * e1z) / det;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        const yy = P[a + 1] + u * (P[b + 1] - P[a + 1]) + v * (P[cc + 1] - P[a + 1]), d = up ? yy - yRefL : yRefL - yy;
        if (d >= -0.02 && d < bd) { bd = d; best = yy; }
      }
      if (best !== best) { this.miss++; return up ? 1e9 : -1e9; }
      return y + best * sy;
    },
  };
}

// Place a decoration of template `tpl` (scale sc, rotation R) at an item spot p (from itemSpots):
// up-facing spots seat exactly on the item's top surface; side spots on wood (templates with a spine)
// embed by the curvature sagitta plus the tilt between the decoration's base and the surface.
// Returns the anchor [x, y, s] or null.
const baseR = (t) => t._nbBaseR ?? (basePts(t), t._nbBaseR);
export function decoOn(ctx, it, p, tpl, sc, R) {
  // measured against the host mesh itself (signed closest-point distance), pushed in along -n
  const P = [p.x, p.y, p.s];
  if (it.tpl.spine && p.lr < baseR(tpl) * sc * 1.1) return null;
  return embedOn(it, ctx.s0, tpl, R, sc, P, p.n, 0.025) ? P : null;
}

// ---------------------------------------------------------------- exact contact on any host surface
// Uniform grid of a template's triangles (template space, cached) for signed closest-point queries.
const TGRID = new WeakMap();
function triGrid(t) {
  let G = TGRID.get(t);
  if (G) return G;
  const [x0, y0, z0, x1, y1, z1] = t.box, ext = Math.max(x1 - x0, y1 - y0, z1 - z0), cs = Math.max(0.12, ext / 48);
  const nx = Math.ceil((x1 - x0) / cs) + 1, ny = Math.ceil((y1 - y0) / cs) + 1, nz = Math.ceil((z1 - z0) / cs) + 1, cells = new Map(), P = t.pos, I = t.idx;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const i0 = Math.floor((Math.min(P[a], P[b], P[c]) - x0) / cs), i1 = Math.floor((Math.max(P[a], P[b], P[c]) - x0) / cs);
    const j0 = Math.floor((Math.min(P[a + 1], P[b + 1], P[c + 1]) - y0) / cs), j1 = Math.floor((Math.max(P[a + 1], P[b + 1], P[c + 1]) - y0) / cs);
    const k0 = Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z0) / cs), k1 = Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z0) / cs);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let q = k0; q <= k1; q++) {
      const key = (q * ny + j) * nx + i; let l = cells.get(key);
      if (!l) cells.set(key, (l = [])); l.push(k);
    }
  }
  G = { x0, y0, z0, cs, nx, ny, nz, cells, stamp: new Uint32Array(I.length / 3), cnt: 0 };
  TGRID.set(t, G);
  return G;
}
const _q = [0, 0, 0];
function closestTri(px, py, pz, P, a, b, c, out) { // closest point on triangle (Ericson), into out
  const ax = P[a], ay = P[a + 1], az = P[a + 2], abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = P[b]; out[1] = P[b + 1]; out[2] = P[b + 2]; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return; }
  const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = P[c]; out[1] = P[c + 1]; out[2] = P[c + 2]; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = P[b] + w * (P[c] - P[b]); out[1] = P[b + 1] + w * (P[c + 1] - P[b + 1]); out[2] = P[b + 2] + w * (P[c + 2] - P[b + 2]); return; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}
// Signed distance (template units; negative inside) from template-space point to the template mesh,
// searching `rc` cells around it. NaN when no triangle is that close.
export function tplDist(t, px, py, pz, rc = 1) {
  const G = triGrid(t), P = t.pos, I = t.idx;
  const ci = Math.floor((px - G.x0) / G.cs), cj = Math.floor((py - G.y0) / G.cs), ck = Math.floor((pz - G.z0) / G.cs);
  let best = Infinity, sg = 1;
  const st = G.stamp, mark = (G.cnt = (G.cnt + 1) >>> 0) || (st.fill(0), (G.cnt = 1));
  for (let q = ck - rc; q <= ck + rc; q++) for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
    if (i < 0 || j < 0 || q < 0 || i >= G.nx || j >= G.ny || q >= G.nz) continue;
    const l = G.cells.get((q * G.ny + j) * G.nx + i);
    if (!l) continue;
    for (const k of l) {
      if (st[k / 3] === mark) continue; st[k / 3] = mark;
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      closestTri(px, py, pz, P, a, b, c, _q);
      const dx = px - _q[0], dy = py - _q[1], dz = pz - _q[2], d = dx * dx + dy * dy + dz * dz;
      if (d < best - 1e-12) {
        best = d;
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        sg = dx * nx + dy * ny + dz * nz < 0 ? -1 : 1;
      }
    }
  }
  return best === Infinity ? NaN : sg * Math.sqrt(best);
}
// Signed world distance (approx. for non-uniform scale) from global (x, y, s) to a placed item's mesh.
export function itemDist(it, s0, x, y, s) {
  const R = it.R, wx = x - it.x, wy = y - it.y, wz = -(s - s0) - it.z;
  const lx = (R[0] * wx + R[3] * wy + R[6] * wz) / it.sx, ly = (R[1] * wx + R[4] * wy + R[7] * wz) / it.sy, lz = (R[2] * wx + R[5] * wy + R[8] * wz) / it.sz;
  return tplDist(it.tpl, lx, ly, lz) * Math.min(it.sx, it.sy, it.sz);
}
// Push a decoration (anchor P = [x, y, s], rotation R2, scale sc) along -n until every base point is
// `embed` inside the host item; false if a base point finds no surface nearby (overhang / thin part).
export function embedOn(it, s0, tpl, R2, sc, P, n, embed = 0.02, sy = sc) {
  const B = basePts(tpl);
  for (let it2 = 0; it2 < 3; it2++) {
    let worst = -1e9;
    for (let i = 0; i < B.length; i += 3) {
      const bx = B[i] * sc, by = B[i + 1] * sy, bz = B[i + 2] * sc;
      const d = itemDist(it, s0, P[0] + R2[0] * bx + R2[1] * by + R2[2] * bz, P[1] + R2[3] * bx + R2[4] * by + R2[5] * bz, P[2] - (R2[6] * bx + R2[7] * by + R2[8] * bz));
      if (d !== d) return false;
      if (d > worst) worst = d;
    }
    const m = worst + embed;
    if (m <= 0.003) return true;
    if (m > 0.6) return false;
    P[0] -= n[0] * m; P[1] -= n[1] * m; P[2] += n[2] * m;
  }
  return false;
}
