// Shared prop materials (created once). All are MeshStandard/Basic materials patched with applyWater.
//
// Vertex attribute aFx (vec2) drives per-vertex behaviour:
//   static material  : x = amount (growth / glow / ice translucency), y = mode
//                      mode 0 generic (+encrusting growth), 1 brain-coral meanders, 2 polyp texture,
//                      3 hot mineral glow (vents), 4 rusty steel streaks, 5 ice, 6.x rock/stone (texture key),
//                      7 gold (metallic, glints in caustics), 8 giant clam (x>0: mantle sinks, x<0: valve lips
//                      close inward, as the camera comes within ~4 m)
//   all hard props get weathering: sediment dusting on up-facing faces, darker wet crevices
//   sway material    : x = sway amplitude in metres at this vertex, y = style
//                      style 0 gentle (corals, fans), 1 kelp surge, 2 grass waves, 3 tentacle wiggle,
//                      4 gorgonian lattice, 5 retracts when the camera is near (x = retract depth),
//                      6 gentle + soft bioluminescence at night (sea pens)
import * as THREE from 'three';
import { applyWater } from '../water.js';

export const MAT = {};

const V_HEAD = /* glsl */`
attribute vec2 aFx;
varying vec2 vFx;
uniform float uTime;
`;

// all spatial frequencies are 2*pi*n/1024 so floating-origin rebases (1024 m) are seamless
const SWAY = /* glsl */`
vec3 pSway(vec3 wq, vec2 fx) {
  float w = fx.x;
  if (w <= 0.0) return vec3(0.0);
  float t = uTime;
  float ph = dot(wq.xz, vec2(0.2454369, 0.1963495));
  vec3 o;
  if (fx.y < 0.5 || (fx.y > 3.5 && fx.y < 4.5) || fx.y > 5.5) {
    o = vec3(sin(t * 0.8 + ph), 0.0, 0.6 * sin(t * 0.63 + ph * 1.3 + 1.0));
  } else if (fx.y > 4.5) {
    // tube worms / christmas-tree worms: whip back into their tubes as the camera passes close
    float c = 1.0 - smoothstep(2.6, 4.6, distance(wq, cameraPosition));
    o = vec3(sin(t * 1.1 + ph) * 0.05, -c, cos(t * 0.9 + ph) * 0.05);
  } else if (fx.y < 1.5) {
    float surge = sin(t * 0.31 + wq.z * 0.0490874);
    o = vec3(0.65 * surge + 0.35 * sin(t * 0.83 + ph), 0.0, 0.55 * sin(t * 0.41 + ph * 0.7 + 2.0));
  } else if (fx.y < 2.5) {
    float a = t * 1.25 - dot(wq.xz, vec2(0.2454369, 0.3436117));
    float s1 = sin(a), s2 = sin(a * 0.71 + 1.3 + ph * 0.3);
    o = vec3(0.45 + 0.55 * s1, -0.3 * abs(s1) - 0.12, 0.4 * s2);
  } else {
    float p2 = ph * 4.0 + wq.y * 3.0;
    o = vec3(sin(t * 1.9 + p2), 0.45 * sin(t * 1.47 + p2 * 1.3), cos(t * 1.71 + p2 * 0.9));
  }
  return o * w;
}
`;

const SWAY_PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition.xyz += pSway( ( modelMatrix * mvPosition ).xyz, aFx );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

const F_HEAD = /* glsl */`
varying vec2 vFx;
vec3 pTriW(vec3 n) { vec3 w = n * n; w *= w; return w / (w.x + w.y + w.z + 1e-5); }
vec4 pTri(vec3 p, vec3 w, float P) {
  return texture2D(uNoiseTex, p.yz / P) * w.x + texture2D(uNoiseTex, p.xz / P) * w.y + texture2D(uNoiseTex, p.xy / P) * w.z;
}
vec3 pBump(vec3 sp, vec3 sn, vec2 dH, float fd) {
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * sn - g);
}
`;

const COLOR_COMMON = /* glsl */`
#include <color_fragment>
vec3 pN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
vec3 pW = pTriW(pN);
vec4 pA = pTri(vWPos, pW, 4.0);
vec4 pB = pTri(vWPos, pW, 1.0);
float pH = pA.r * 0.5 + pB.g * 0.5;
float pBumpK = 0.035;
float pMode = vFx.y;
diffuseColor.rgb *= 0.7 + 0.6 * (pA.g * 0.55 + pB.r * 0.45);
diffuseColor.rgb *= 1.0 + (pA.rgb - 0.5) * vec3(0.32, 0.22, 0.28);   // natural hue mottling
{
  float pL = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
  float pD = smoothstep(10.0, 38.0, length(vWPos - cameraPosition));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(pL), pD * 0.4);        // distant colour washes out
}
`;

const COLOR_STATIC = COLOR_COMMON + /* glsl */`
if (pMode > 0.5 && pMode < 1.5) {
  // brain coral: contour lines of smooth noise make meandering grooves
  float gk = pMode - 1.0;
  vec4 pC = pTri(vWPos + vec3(gk * 9.0), pW, gk < -0.13 ? 4.0 : (gk < 0.13 ? 8.0 : 16.0));
  float q = pC.r * (5.0 + 6.0 * fract(gk * 7.3 + 0.5)) + pC.g * 2.5;
  float l = abs(fract(q) - 0.5) * 2.0;
  float groove = 1.0 - smoothstep(0.12, 0.5, l);
  groove = mix(groove, 0.4, smoothstep(0.25, 0.7, fwidth(q)));
  diffuseColor.rgb *= 1.0 - 0.5 * groove;
  pH = -groove * 0.8 + pB.g * 0.2;
  pBumpK = 0.05;
} else if ((pMode > 1.5 && pMode < 2.5) || (pMode > 7.5 && pMode < 8.5)) {
  // massive coral polyps / rough sponge pores / clam mantle spots: two scales of rugosity
  vec4 pC = pTri(vWPos, pW, 0.5);
  float d = smoothstep(0.42, 0.68, pC.a);
  diffuseColor.rgb *= 0.8 + 0.34 * d;
  pH = d * 0.6 + pA.r * 0.3 + pB.a * 0.3;
  pBumpK = 0.045;
} else if (pMode > 3.5 && pMode < 4.5) {
  // rusty steel: vertical rust streaks + scaling
  float st = texture2D(uNoiseTex, vec2((vWPos.x + vWPos.z) * 0.5, vWPos.y / 16.0)).r;
  float st2 = texture2D(uNoiseTex, vec2((vWPos.x - vWPos.z) * 0.25, vWPos.y / 24.0)).g;
  float rust = smoothstep(0.42, 0.7, st * 0.7 + st2 * 0.5 + pA.b * 0.3);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.17, 0.06) * (0.6 + 0.6 * pB.r), rust * 0.85);
  pH = pB.r * 0.7 + rust * 0.3;
} else if (pMode > 4.5 && pMode < 5.5) {
  diffuseColor.rgb *= 0.9 + 0.2 * pB.g;
  pBumpK = 0.05;
} else if (pMode > 6.5 && pMode < 7.5) {
  // gold: smooth metal
  diffuseColor.rgb *= 0.92 + 0.16 * pB.g;
  pH = pB.r * 0.3;
  pBumpK = 0.006;
} else if (pMode > 5.5 && pMode < 6.5) {
  // rock / dressed stone: per-template texture key picks scale, offset and channel mix
  float rk = fract(pMode);
  float P = rk < 0.33 ? 2.0 : (rk < 0.66 ? 4.0 : 8.0);
  vec4 r1 = pTri(vWPos + vec3(rk * 13.0, rk * 5.0, rk * 7.0), pW, P);
  vec3 mw = vec3(fract(rk * 3.1), fract(rk * 5.7), fract(rk * 7.3)) + 0.1;
  float n = dot(r1.rgb, mw) / (mw.x + mw.y + mw.z);
  n = clamp((n - 0.5) * 2.2 + 0.5, 0.0, 1.0); // noise clusters near 0.5: stretch it so rock texture reads
  diffuseColor.rgb *= 0.62 + 0.76 * n;
  float sp = step(0.7, pB.b) * step(fract(rk * 11.0), 0.45);           // granite speckle
  diffuseColor.rgb *= 1.0 + sp * 0.35 - step(pB.a, 0.18) * 0.2;
  float band = sin(vWPos.y * (5.0 + rk * 12.0) + r1.r * 5.0);         // strata
  diffuseColor.rgb *= 1.0 - step(0.55, fract(rk * 2.3)) * 0.13 * band;
  float crack = smoothstep(0.9, 0.975, pTri(vWPos + vec3(rk * 3.0), pW, 2.0).a);
  diffuseColor.rgb *= 1.0 - crack * 0.6;
  pH = n * 0.8 - crack * 0.7 + pB.g * 0.2;
  pBumpK = 0.055;
}
if (pMode < 2.5 || (pMode > 3.5 && pMode < 4.5) || (pMode > 5.5 && pMode < 6.5)) {
  // encrusting growth (algae, coralline, sponges) on up-facing surfaces
  float g = vFx.x * smoothstep(-0.15, 0.6, pN.y + (pA.b - 0.5) * 0.9) * smoothstep(0.4, 0.62, pA.a * 0.75 + pB.b * 0.45);
  g = clamp(g, 0.0, 1.0);
  vec3 gc = mix(vec3(0.17, 0.25, 0.08), vec3(0.6, 0.3, 0.42), smoothstep(0.5, 0.72, pB.a));
  gc = mix(gc, vec3(0.78, 0.55, 0.2), smoothstep(0.66, 0.82, pA.b) * 0.8);
  diffuseColor.rgb = mix(diffuseColor.rgb, gc * (0.6 + 0.7 * pB.r), g);
  pH += g * pB.a;
  // weathering shared by every hard prop: settled sediment on up-facing faces, darker wet crevices
  float dust = smoothstep(0.55, 0.95, pN.y) * smoothstep(0.38, 0.8, pA.b * 0.7 + pB.r * 0.5) * (0.5 - 0.3 * g);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.64, 0.6, 0.52) * (0.85 + 0.3 * pB.g), dust);
  diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.08, 0.5, pH));
}
`;

const NORMAL_BUMP = /* glsl */`
#include <normal_fragment_maps>
normal = pBump(-vViewPosition, normal, vec2(dFdx(pH), dFdy(pH)) * pBumpK, faceDirection);
`;

const EMISSIVE_STATIC = /* glsl */`
#include <emissivemap_fragment>
if (pMode > 6.5 && pMode < 7.5) {
  // gold glints where caustics dance across it
  float dB = max(0.0, uSurfaceY - vWPos.y);
  vec3 ca = causticRGB(vWPos);
  float spark = pow(clamp(ca.g * 1.25 - 0.3, 0.0, 1.0), 2.0) * (0.55 + 0.45 * sin(uTime * 6.0 + pB.r * 40.0));
  totalEmissiveRadiance += diffuseColor.rgb * (0.1 + 2.6 * spark * uCausticStr) * uSunScatter * exp(-uLightSigma * dB * 0.6);
} else if (pMode > 2.5 && pMode < 3.5) {
  float fl = 0.78 + 0.22 * sin(uTime * 2.1 + vWPos.y * 2.7 + pA.r * 9.0);
  totalEmissiveRadiance += vec3(1.0, 0.22, 0.03) * vFx.x * fl * (0.35 + 1.2 * pB.r * pB.r) * 1.6;
} else if (pMode > 4.5 && pMode < 5.5) {
  float dB = max(0.0, uSurfaceY - vWPos.y);
  totalEmissiveRadiance += vec3(0.22, 0.52, 0.66) * uSunColor * uSunScatter * exp(-uLightSigma * dB * 0.5) * (0.9 + 1.8 * pB.r + 1.2 * smoothstep(-4.0, -0.8, vWPos.y)) * vFx.x;
}
`;

const ROUGH_STATIC = /* glsl */`
#include <roughnessmap_fragment>
if (pMode > 4.5 && pMode < 5.5) roughnessFactor = 0.3;
else if (pMode > 3.5 && pMode < 4.5) roughnessFactor = 0.7;
else if (pMode > 6.5 && pMode < 7.5) roughnessFactor = 0.26;
`;

// style 4: gorgonian fan sheet cut into a net with ridged noise
const LATTICE = /* glsl */`
pBumpK = 0.015;
if (pMode > 3.5 && pMode < 4.5) {
  float net = pTri(vWPos, pW, 0.5).a * 0.65 + pTri(vWPos, pW, 0.25).a * 0.35;
  float thr = mix(0.6, 0.47, smoothstep(4.0, 22.0, length(vWPos - cameraPosition)));
  if (net < thr) discard;
  diffuseColor.rgb *= 0.75 + 0.5 * smoothstep(thr, thr + 0.2, net);
}
`;

// thin vegetation glows when backlit by the sun
const EMISSIVE_SWAY = /* glsl */`
#include <emissivemap_fragment>
{
  vec3 vd = normalize(vWPos - cameraPosition);
  float tr = pow(max(dot(vd, uSunDir), 0.0), 3.0);
  float dB = max(0.0, uSurfaceY - vWPos.y);
  float kelpK = (pMode > 0.5 && pMode < 1.5) ? 2.6 : 1.0;
  totalEmissiveRadiance += diffuseColor.rgb * uSunColor * uSunScatter * exp(-uLightSigma * dB * 0.8) * skyVis(vWPos) * (0.1 + 0.6 * tr) * kelpK;
  // sea pens: soft green bioluminescent pulses at night
  if (pMode > 5.5 && pMode < 6.5) totalEmissiveRadiance += vec3(0.22, 0.95, 0.72) * uNight * (0.4 + 0.35 * sin(uTime * 1.3 + dot(vWPos.xz, vec2(0.6135923, 0.4908739))));
}
`;

// giant clams close as the camera approaches: mantle sinks, valve lips move in (merged meshes are in
// world-aligned chunk space, so the horizontal normal points out of the valve)
const CLAM_VERTEX = /* glsl */`
#include <begin_vertex>
if (aFx.y > 7.5 && aFx.y < 8.5 && aFx.x != 0.0) {
  vec3 wq = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float c = 1.0 - smoothstep(2.6, 5.5, distance(wq, cameraPosition));
  if (aFx.x > 0.0) transformed.y -= c * aFx.x;
  else { vec2 hn = objectNormal.xz; float l = length(hn); if (l > 1e-3) transformed.xz -= hn / l * c * (-aFx.x); }
}
`;

function propMaterial(key, sway) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: sway ? 0.75 : 0.88, metalness: 0,
    side: sway ? THREE.DoubleSide : THREE.FrontSide,
  });
  return applyWater(m, {
    key,
    vertexHead: V_HEAD + (sway ? SWAY : ''),
    fragmentHead: F_HEAD,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFx = aFx;');
      if (sway) sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', SWAY_PROJECT);
      else sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', CLAM_VERTEX);
      if (!sway) sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (vFx.y > 6.5 && vFx.y < 7.5) metalnessFactor = 0.85;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', sway ? COLOR_COMMON + LATTICE : COLOR_STATIC)
        .replace('#include <normal_fragment_maps>', sway ? NORMAL_BUMP + 'if (pMode > 1.5 && pMode < 2.5) normal = normalize(vNormal);' : NORMAL_BUMP)
        .replace('#include <emissivemap_fragment>', sway ? EMISSIVE_SWAY : EMISSIVE_STATIC);
      if (!sway) sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', ROUGH_STATIC);
    },
  });
}

// Soft volumetric light shafts (additive). aFx.x = 0 at top .. 1 at bottom, aFx.y = phase.
function shaftMaterial() {
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
  return applyWater(m, {
    key: 'props-shaft', additive: true, noLight: true,
    uniforms: { uShaftColor: { value: new THREE.Color(0.5, 0.78, 0.82) } },
    vertexHead: 'attribute vec2 aFx; varying vec2 vFx; varying vec3 vSN;',
    fragmentHead: 'varying vec2 vFx; varying vec3 vSN; uniform vec3 uShaftColor;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>',
        '#include <uv_vertex>\nvFx = aFx; vSN = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          vec3 vd = normalize(vWPos - cameraPosition);
          float edge = pow(abs(dot(vd, normalize(vSN))), 1.7);
          float al = vFx.x;
          float ends = smoothstep(0.0, 0.1, al) * (1.0 - smoothstep(0.45, 1.0, al));
          float st = texture2D(uNoiseTex, vec2((vWPos.x + vWPos.z) * 0.125 + vFx.y, al * 0.35 - uTime * 0.012)).r;
          float fl = 0.6 + 0.4 * sin(uTime * (0.35 + 0.2 * vFx.y) + vFx.y * 6.2831);
          float camF = smoothstep(2.5, 10.0, length(vWPos - cameraPosition));
          diffuseColor.rgb = uShaftColor * uSunColor * uSunScatter * edge * ends * fl * (0.25 + 1.4 * st * st) * camF * 0.55;
        }`);
    },
  });
}

// Billboard particles: rising vent smoke (alpha) or glow halos (additive).
// attributes: position = emitter, aCorner (vec2), aP = (phase, rate, rise height, size)
function billboardMaterial(halo, white = false) {
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false,
    blending: halo ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
  });
  if (halo) m.defines = { HALO: 1 };
  else if (white) m.defines = { WHITE: 1 };
  return applyWater(m, {
    key: halo ? 'props-halo' : white ? 'props-plume-white' : 'props-plume', additive: halo, noLight: true,
    vertexHead: 'attribute vec2 aCorner; attribute vec4 aP; varying vec2 vC; varying float vT; varying float vPh; uniform float uTime;',
    fragmentHead: 'varying vec2 vC; varying float vT; varying float vPh;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', /* glsl */`
        #ifdef HALO
          float t = 0.5;
          vec3 c = position;
          float sz = aP.w * (0.85 + 0.15 * sin(uTime * 1.3 + aP.x * 40.0));
        #else
          float t = fract(uTime * aP.y + aP.x);
          float hgt = t * aP.z;
          vec3 c = position;
          c.y += hgt;
          float sw = 0.25 + hgt * 0.1;
          c.x += sin(aP.x * 37.0 + hgt * 0.31 + uTime * 0.21) * sw + hgt * hgt * 0.006;
          c.z += cos(aP.x * 23.0 + hgt * 0.27 + uTime * 0.17) * sw;
          float sz = aP.w * (0.55 + 2.3 * sqrt(t));
        #endif
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        float ang = aP.x * 50.0 + uTime * 0.25 * (fract(aP.x * 13.0) - 0.5);
        float cs = cos(ang), sn = sin(ang);
        mvPosition.xy += vec2(cs * aCorner.x - sn * aCorner.y, sn * aCorner.x + cs * aCorner.y) * sz;
        gl_Position = projectionMatrix * mvPosition;
        vC = aCorner; vT = t; vPh = aP.x;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */`
        {
          float r = length(vC);
          vec4 n = texture2D(uNoiseTex, vC * 0.3 + vec2(vPh * 7.0, vT * 0.5 + vPh));
          #ifdef HALO
            float a = pow(max(0.0, 1.0 - r), 2.4);
            diffuseColor.rgb = vec3(1.0, 0.3, 0.06) * a * (0.55 + 0.6 * n.r) * 0.45;
          #else
            float puff = 1.0 - smoothstep(0.2, 1.0, r + (n.r - 0.5) * 0.8);
            float life = smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.5, 1.0, vT));
            float camF = smoothstep(1.5, 6.0, length(vWPos - cameraPosition));
            diffuseColor.a = puff * life * camF * (0.4 + 0.35 * n.g);
            #ifdef WHITE
              // white smoker: cooler fluid, milky barite / anhydrite / silica particles, no hot glow
              diffuseColor.a *= 0.75;
              vec3 smoke = mix(vec3(0.17, 0.18, 0.18), vec3(0.36, 0.37, 0.35), n.b);
            #else
              vec3 smoke = mix(vec3(0.012, 0.011, 0.01), vec3(0.05, 0.045, 0.04), n.b);
              smoke += vec3(1.0, 0.4, 0.1) * (1.0 - smoothstep(0.0, 0.1, vT)) * 0.5;
            #endif
            diffuseColor.rgb = smoke;
          #endif
        }`);
    },
  });
}

export function initMaterials() {
  if (MAT.static) return MAT;
  MAT.static = propMaterial('props-static', false);
  MAT.sway = propMaterial('props-sway', true);
  MAT.shaft = shaftMaterial();
  MAT.plume = billboardMaterial(false);
  MAT.plumeWhite = billboardMaterial(false, true);
  MAT.halo = billboardMaterial(true);
  return MAT;
}

// Build a billboard particle mesh from emitters [{x,y,z, n, rise, size, speed}] (chunk-local coords)
export function billboardMesh(emitters, material, rng) {
  let total = 0;
  for (const e of emitters) total += e.n;
  if (!total) return null;
  const pos = new Float32Array(total * 12), cor = new Float32Array(total * 8), ap = new Float32Array(total * 16);
  const idx = new Uint16Array(total * 6);
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  let q = 0;
  for (const e of emitters) for (let k = 0; k < e.n; k++, q++) {
    const ph = (k + rng()) / e.n;
    const rate = e.speed / Math.max(1, e.rise);
    for (let c = 0; c < 4; c++) {
      const v = q * 4 + c;
      pos[v * 3] = e.x + (rng() - 0.5) * 0.0; pos[v * 3 + 1] = e.y; pos[v * 3 + 2] = e.z;
      cor[v * 2] = C[c * 2]; cor[v * 2 + 1] = C[c * 2 + 1];
      ap[v * 4] = ph + e.phase; ap[v * 4 + 1] = rate * (0.85 + 0.3 * ((k * 7919) % 13) / 13); ap[v * 4 + 2] = e.rise; ap[v * 4 + 3] = e.size;
    }
    const b = q * 4, o = q * 6;
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  g.setAttribute('aP', new THREE.BufferAttribute(ap, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 40;
  const m = new THREE.Mesh(g, material);
  m.matrixAutoUpdate = false;
  m.renderOrder = 2;
  return m;
}
