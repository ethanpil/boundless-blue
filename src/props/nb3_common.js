// Shared infrastructure for the sargassum, jellyfish-lake and anemone-field props: three materials
// (floating sargassum that bobs on the swell and glows golden against the surface, the alpha-cut raft
// canopy sheet, glossy anemone flesh with surge-driven tentacles), a hashed spacing grid that keeps
// organisms from overlapping, and small placement helpers.
import * as THREE from 'three';
import { applyWater } from '../water.js';
import { mulberry32 } from '../noise.js';

export const NB3 = { mat: {} };
export const rr = (rng, a, b) => a + (b - a) * rng();
export const pick = (rng, a) => a[(rng() * a.length) | 0];
export const chunkRng = (ctx, salt) => mulberry32(((Math.floor(ctx.s0) * 2654435761) ^ salt) >>> 0);
export function pickW(rng, list) { // [[weight, value], ...]
  let t = 0; for (const e of list) t += e[0];
  let u = rng() * t;
  for (const e of list) if ((u -= e[0]) <= 0) return e[1];
  return list[list.length - 1][1];
}
// a colour near one of the palette entries (linear RGB)
export function tint(rng, list, amt = 0.12) {
  const c = list[(rng() * list.length) | 0], k = 1 + (rng() * 2 - 1) * amt;
  return [c[0] * k * (1 + (rng() - 0.5) * amt), c[1] * k * (1 + (rng() - 0.5) * amt), c[2] * k * (1 + (rng() - 0.5) * amt)];
}
// sRGB hex -> linear [r, g, b]
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const L = (hex) => [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];

// Phases of the shaders below are dot products with 2*pi*n/1024 (integer n) so the floating-origin
// rebase (1024 m) never makes anything jump.
const K = (n) => ((2 * Math.PI * n) / 1024).toFixed(7);

// ---------------------------------------------------------------- spacing grid
// Circles in (x, s) on a 1 m hash grid: keeps organisms and rocks from interpenetrating (and from
// "blending into each other"). free(x, s, r) tests against every stored circle within reach.
export class Space {
  constructor() { this.m = new Map(); this.maxR = 0.5; this.big = []; }
  key(i, j) { return (i * 73856093) ^ (j * 19349663); }
  free(x, s, r, pad = 0) {
    for (let k = 0; k < this.big.length; k += 3) { // walls, big rocks: few, tested directly
      const dx = this.big[k] - x, ds = this.big[k + 1] - s, m = this.big[k + 2] + r + pad;
      if (dx * dx + ds * ds < m * m) return false;
    }
    const R = r + this.maxR + pad, i0 = Math.floor(x - R), i1 = Math.floor(x + R), j0 = Math.floor(s - R), j1 = Math.floor(s + R);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const c = this.m.get(this.key(i, j));
      if (!c) continue;
      for (let k = 0; k < c.length; k += 3) {
        const dx = c[k] - x, ds = c[k + 1] - s, m = c[k + 2] + r + pad;
        if (dx * dx + ds * ds < m * m) return false;
      }
    }
    return true;
  }
  add(x, s, r) {
    if (r > 1.5) { this.big.push(x, s, r); return; }
    const k = this.key(Math.floor(x), Math.floor(s));
    let c = this.m.get(k);
    if (!c) this.m.set(k, (c = []));
    c.push(x, s, r);
    if (r > this.maxR) this.maxR = r;
  }
}

// Append template `t` transformed (rotation R, uniform scale sc, chunk-local position x, y, z, colour
// multiplier col) into a per-chunk Builder: small decorations ride along in one mesh with their host.
export function bakeInto(b, t, x, y, z, R, sc, col = [1, 1, 1], fa = 1) {
  const off = b.vc, P = t.pos, N = t.nor, C = t.col, F = t.fx;
  for (let i = 0; i < t.vc; i++) {
    const px = P[i * 3] * sc, py = P[i * 3 + 1] * sc, pz = P[i * 3 + 2] * sc, nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    b.P.push(R[0] * px + R[1] * py + R[2] * pz + x, R[3] * px + R[4] * py + R[5] * pz + y, R[6] * px + R[7] * py + R[8] * pz + z);
    b.N.push(R[0] * nx + R[1] * ny + R[2] * nz, R[3] * nx + R[4] * ny + R[5] * nz, R[6] * nx + R[7] * ny + R[8] * nz);
    b.C.push(C[i * 3] * col[0], C[i * 3 + 1] * col[1], C[i * 3 + 2] * col[2]);
    b.F.push(F[i * 2] * fa, F[i * 2 + 1]);
  }
  for (let i = 0; i < t.idx.length; i++) b.I.push(t.idx[i] + off);
}

// ---------------------------------------------------------------- materials
// Floating sargassum. aFx.x = sway amplitude of dangling parts (m), aFx.y = part (0 stem, 1 blade,
// 2 air bladder, 3 epiphyte-crusted old stem, 4 flotsam (no translucency)). Whole rafts ride the swell
// together; strands hanging below lag behind and sway.
const SG_V = /* glsl */`
attribute vec2 aFx;
varying vec2 vFx;
uniform float uTime;
uniform float uSurge;
vec3 sgMove(vec3 wq, float w) {
  float k = 1.0 + 1.5 * uSurge;
  float p1 = dot(wq.xz, vec2(${K(32)}, ${K(12)}));
  float p2 = dot(wq.xz, vec2(${K(-10)}, ${K(26)}));
  float p3 = dot(wq.xz, vec2(${K(21)}, ${K(-17)}));
  vec3 o = vec3(0.05 * sin(uTime * 0.55 + p2), 0.05 * sin(uTime * 0.7 + p1) + 0.025 * sin(uTime * 1.13 + p3), 0.04 * cos(uTime * 0.6 + p3)) * k;
  if (w > 0.0) {
    float ph = dot(wq.xz, vec2(${K(120)}, ${K(90)})) + wq.y * 2.3;
    float ph2 = dot(wq.xz, vec2(${K(156)}, ${K(117)})) + wq.y * 3.1;
    o += vec3(sin(uTime * 0.9 + ph), 0.12 * sin(uTime * 1.3 + ph2), 0.7 * sin(uTime * 0.73 + ph2 + 1.0)) * w * k;
  }
  return o;
}
`;
const SG_F = /* glsl */`
varying vec2 vFx;
`;
const SG_PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition.xyz += sgMove( ( modelMatrix * mvPosition ).xyz, aFx.x );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
function sargMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  return applyWater(m, {
    key: 'nb3-sarg', vertexHead: SG_V, fragmentHead: SG_F,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;')
        .replace('#include <project_vertex>', SG_PROJECT);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          float sgPart = vFx.y;
          {
            vec4 a = texture2D(uNoiseTex, vWPos.xz * 2.0 + vec2(vWPos.y * 0.7));
            vec4 b = texture2D(uNoiseTex, vWPos.xz * 0.25 + vec2(vWPos.y * 0.13));
            diffuseColor.rgb *= 0.8 + 0.4 * a.g;
            if (sgPart < 3.5) {
              // older growth darkens; pale bryozoan / hydroid crusts on the old stems and some blades
              float old = smoothstep(0.55, 0.8, b.r) * (sgPart < 0.5 || sgPart > 2.5 ? 1.0 : 0.35);
              diffuseColor.rgb *= 1.0 - 0.28 * old;
              float epi = smoothstep(0.7, 0.8, a.a) * (sgPart > 2.5 ? 0.9 : 0.25 + 0.5 * old) * step(sgPart, 3.5) * (1.0 - step(1.5, sgPart) * step(sgPart, 2.5));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.5), epi * 0.55);
            }
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          if (sgPart < 3.5) {
            // thin weed transmits the light behind it: golden against the bright surface, a glow toward the sun
            vec3 vd = normalize(vWPos - cameraPosition);
            float dB = max(0.0, uSurfaceY - vWPos.y);
            vec3 Tl = exp(-uLightSigma * dB);
            float sun = pow(max(dot(vd, uSunDir), 0.0), 3.0);
            float up = smoothstep(-0.1, 0.55, vd.y);
            float th = sgPart > 1.5 && sgPart < 2.5 ? 1.35 : (sgPart > 0.5 && sgPart < 1.5 ? 1.0 : 0.4);
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.1, 0.94, 0.72) * Tl * uSunColor * uSunScatter * (0.12 + 1.1 * up + 1.5 * sun) * th * (1.0 - uNight);
          }
          totalEmissiveRadiance += diffuseColor.rgb * uLamp * 0.12;`);
    },
  });
}

// Raft canopy: the matted body of big rafts, a sheet just under the surface cut into tangled weed by
// noise. aFx.x = density (cover), aFx.y = layer (0 top, 1 lower). Transparent flag only so the core does
// not make it cast a (solid, uncut) shadow; it is alpha-tested and writes depth.
function matMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, transparent: true });
  return applyWater(m, {
    key: 'nb3-sargmat', vertexHead: SG_V, fragmentHead: SG_F,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;')
        .replace('#include <project_vertex>', SG_PROJECT.replace('aFx.x', '0.0'));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          float sgFine, sgThick;
          {
            vec2 q = vWPos.xz + vec2(vFx.y * 3.5, vFx.y * 1.75);
            vec4 c1 = texture2D(uNoiseTex, q / 16.0);
            vec4 c2 = texture2D(uNoiseTex, q / 2.0);
            vec4 c3 = texture2D(uNoiseTex, q * 2.0);
            vec4 c4 = texture2D(uNoiseTex, q * 8.0);
            float fw = length(fwidth(q));
            // tangled fronds: ridge lines of the noise at three scales, each fading to its mean once it would alias
            float k4 = 1.0 - smoothstep(0.015, 0.05, fw), k3 = 1.0 - smoothstep(0.06, 0.2, fw), k2 = 1.0 - smoothstep(0.25, 0.8, fw);
            sgFine = k4;
            float weed = max(max(mix(0.67, c3.a, k3), mix(0.67, c4.a, k4)), mix(0.67, c2.a, k2) - 0.05);
            float cov = vFx.x * (0.5 + 0.65 * c1.r);
            // (layer 2 is the sagging underlayer: sparser, ragged tangles; every layer keeps some gaps)
            float thr = max(0.56, 0.98 - 0.4 * cov) + (vFx.y > 1.5 ? 0.1 : vFx.y > 0.5 ? 0.05 : 0.0);
            if (weed < thr) discard;
            float edge = smoothstep(0.0, 0.1, weed - thr);
            sgThick = smoothstep(0.45, 1.0, cov) * (0.55 + 0.45 * c2.r) * edge;
            diffuseColor.rgb *= (0.75 + 0.4 * c2.g) * (0.85 + 0.3 * mix(0.5, c4.r, k4));
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.8, 0.55), sgThick * 0.6);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.58, 0.48), smoothstep(0.8, 0.88, c4.b) * k4 * 0.35);
          }`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          {
            vec3 vd = normalize(vWPos - cameraPosition);
            float sun = pow(max(dot(vd, uSunDir), 0.0), 3.0);
            float up = smoothstep(-0.1, 0.55, vd.y);
            float th = mix(1.0, 0.25, sgThick) * (1.0 - 0.3 * min(vFx.y, 2.0)); // thin edges glow, thick cores stay dark
            // light filtering through the weed is warm (the blades absorb blue), and there is none at night
            vec3 warm = diffuseColor.rgb * vec3(1.12, 0.92, 0.68);
            float dB = max(0.0, uSurfaceY - vWPos.y);
            totalEmissiveRadiance += warm * exp(-uLightSigma * dB) * uSunColor * uSunScatter * (0.12 + 0.95 * up + 1.4 * sun) * th * (1.0 - uNight) + diffuseColor.rgb * uLamp * 0.1;
          }`);
    },
  });
}

// Anemone flesh: glossy, faintly translucent, tentacles swaying with the surge (all together) plus a
// small individual wiggle. aFx.x = sway amplitude (m); aFx.y = part + fraction:
// [0,1) column / disc (fraction = height), [1,2) tentacle (fraction = along, 0 base .. 1 tip),
// [2,3) carpet-anemone disc (fraction = radius; short sticky tentacles drawn as nubs),
// [3,4) mushroom-anemone disc (fraction = radius; radial ridges),
// [4,5) magnificent-anemone tentacle pile (impostor of the finger carpet; fraction = radius).
const AN_V = /* glsl */`
attribute vec2 aFx;
varying vec2 vFx;
uniform float uTime;
uniform float uSurge;
vec3 anSway(vec3 wq, float w) {
  if (w <= 0.0) return vec3(0.0);
  float pl = dot(wq.xz, vec2(${K(8)}, ${K(5)}));
  float pl2 = dot(wq.xz, vec2(${K(-6)}, ${K(9)}));
  float surge = sin(uTime * 0.55 + pl) * (1.0 + 1.3 * uSurge);
  float ph = dot(wq.xz, vec2(${K(1485)}, ${K(1142)})) + wq.y * 31.0;
  float ph2 = dot(wq.xz, vec2(${K(-1203)}, ${K(1377)})) + wq.y * 23.0;
  return vec3(0.8 * surge + 0.32 * sin(uTime * 1.6 + ph), 0.12 * sin(uTime * 1.3 + ph2), 0.45 * cos(uTime * 0.47 + pl2) + 0.32 * cos(uTime * 1.37 + ph2)) * w;
}
`;
const AN_F = /* glsl */`
varying vec2 vFx;
vec3 anBump(vec3 sp, vec3 sn, vec2 dH, float fd) {
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * sn - g);
}
`;
function anemMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
  return applyWater(m, {
    key: 'nb3-anem', vertexHead: AN_V, fragmentHead: AN_F,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;')
        .replace('#include <project_vertex>', SG_PROJECT.replace('sgMove', 'anSway'));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          float anPart = floor(vFx.y + 0.001), anT = vFx.y - anPart, anH = 0.0, anK = 0.0;
          {
            vec4 n1 = texture2D(uNoiseTex, vWPos.xz * 4.0 + vec2(vWPos.y * 2.0));
            diffuseColor.rgb *= 0.86 + 0.28 * n1.g;
            if (anPart > 3.5) {
              // magnificent-anemone finger pile (impostor of the tentacle carpet): blunt finger tips packed
              // in staggered rows (~2.8 cm apart; 36 cells per metre divides the 1024 m rebase), dark gaps
              // between them, pale tips; fades to its mean colour before it would alias
              vec2 q = vWPos.xz * 36.0;
              q.x += 0.5 * floor(q.y);
              vec2 id = floor(q);
              vec4 h = texture2D(uNoiseTex, (id + 0.5) / 256.0);
              // (each cell its own finger: jittered centre, own size, own tilt of the pale tip; not a polka-dot grid)
              vec2 f = fract(q) - 0.5 + (h.xy - 0.5) * 0.55;
              float fw = length(fwidth(q));
              float fade = 1.0 - smoothstep(0.35, 0.9, fw);
              float sz = 0.75 + 0.5 * h.w, rr = length(f) / sz;
              float nub = 1.0 - smoothstep(0.1, 0.46, rr);
              vec3 tipc = mix(diffuseColor.rgb * 1.6, vec3(dot(diffuseColor.rgb, vec3(0.33))) * 1.6 + 0.05, 0.3);
              vec3 c = mix(diffuseColor.rgb * 0.5, diffuseColor.rgb * (0.85 + 0.3 * h.z), smoothstep(0.5, 0.2, rr));
              c = mix(c, tipc, smoothstep(0.24, 0.0, length(f + (h.zw - 0.5) * 0.12) / sz) * (0.35 + 0.35 * h.y));
              diffuseColor.rgb = mix(diffuseColor.rgb * 0.88 + tipc * 0.1, c, fade);
              anH = nub * fade; anK = 0.022;
            } else if (anPart > 1.5 && anPart < 2.5) {
              // carpet anemone: thousands of short sticky tentacles, tips paler (a dotted pile)
              vec2 q = vWPos.xz * 64.0 + vec2(vWPos.y * 41.0);
              vec2 f = fract(q) - 0.5;
              float fw = length(fwidth(q));
              float nub = (1.0 - smoothstep(0.18, 0.34, length(f))) * (1.0 - smoothstep(0.35, 0.9, fw));
              vec4 n2 = texture2D(uNoiseTex, vWPos.xz * 0.5);
              diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.3, 0.7, n2.b));
              vec3 tipc = mix(diffuseColor.rgb * 1.7, vec3(dot(diffuseColor.rgb, vec3(0.33))) * 1.6 + 0.04, 0.35);
              diffuseColor.rgb = mix(diffuseColor.rgb * 0.82, tipc, nub * 0.85);
              anH = nub; anK = 0.012;
            } else if (anPart > 2.5) {
              // mushroom anemone: radial ridges and a dimpled mouth
              vec4 n3 = texture2D(uNoiseTex, vWPos.xz * 16.0);
              float rid = n3.a;
              diffuseColor.rgb *= 0.85 + 0.3 * rid;
              anH = rid * smoothstep(0.1, 0.4, anT); anK = 0.01;
            } else if (anPart > 0.5) {
              diffuseColor.rgb *= 0.92 + 0.16 * n1.r;
            } else {
              // column: verrucae (sticky warts) as a fine bump
              vec4 n4 = texture2D(uNoiseTex, vWPos.xz * 16.0 + vec2(vWPos.y * 16.0));
              anH = smoothstep(0.55, 0.75, n4.r); anK = 0.008;
              diffuseColor.rgb *= 0.9 + 0.15 * anH;
            }
          }`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
          #include <normal_fragment_maps>
          if (anK > 0.0) normal = anBump(-vViewPosition, normal, vec2(dFdx(anH), dFdy(anH)) * anK, faceDirection);`)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          {
            vec3 vd = normalize(vWPos - cameraPosition);
            vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            float dB = max(0.0, uSurfaceY - vWPos.y);
            vec3 Tl = exp(-uLightSigma * dB) * skyVis(vWPos);
            float back = pow(max(dot(vd, uSunDir), 0.0), 2.0);
            float rim = pow(1.0 - abs(dot(wN, vd)), 2.0);
            float tk = anPart > 0.5 && anPart < 1.5 ? 1.0 : anPart > 3.5 ? 0.7 : 0.35;
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * uSunScatter * Tl * (0.05 + 0.35 * rim + 0.8 * back) * tk;
            // tentacle tips fluoresce faintly under the lamps and at night
            float tip = anPart > 0.5 && anPart < 1.5 ? anT * anT : anPart > 3.5 ? anH * 0.5 : 0.0;
            totalEmissiveRadiance += diffuseColor.rgb * tip * (uLamp * 0.35 + uNight * 0.06);
          }`);
    },
  });
}

export function initNB3Materials() {
  if (NB3.mat.sarg) return NB3.mat;
  NB3.mat.sarg = sargMaterial();
  NB3.mat.mat = matMaterial();
  NB3.mat.anem = anemMaterial();
  return NB3.mat;
}
