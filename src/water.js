// Shared underwater look: global uniforms, procedural textures, and `applyWater`,
// which patches any MeshStandardMaterial (or Physical) with:
//   - depth-dependent sunlight extinction (reds die first)
//   - projected animated caustics with slight chromatic dispersion (no visible tiling)
//   - per-channel water absorption + in-scattering "fog" toward the water colour
//   - a near-field "video light" fill that brings back true colours close to the lens
//   - camera-mounted ROV lamps in the deep / at night
//
// Floating-origin note: the world group is rebased by multiples of 1024 m, so every
// world-space pattern here uses periods that divide 1024 to stay seamless.
import * as THREE from 'three';
import { hash2i } from './noise.js';

// Shader quality for every water-patched material: 0 low, 1 medium, 2 high, 3 ultra.
// quality.js sets it from the GPU tier before any material compiles; it is baked into the shaders as WQ.
let WQ = 1;
export function setWaterQuality(tier) { WQ = { low: 0, medium: 1, high: 2, ultra: 3 }[tier] ?? 1; }
export const waterQuality = () => WQ;

export const U = {
  uTime: { value: 0 },
  uSigma: { value: new THREE.Vector3(0.12, 0.04, 0.03) },      // view-path extinction per metre
  uLightSigma: { value: new THREE.Vector3(0.06, 0.025, 0.02) }, // sunlight-path extinction per metre
  uWaterDeep: { value: new THREE.Color(0x02304a) },  // colour looking down / horizon
  uWaterUp: { value: new THREE.Color(0x1b8fb5) },    // colour looking up
  uSunDir: { value: new THREE.Vector3(0.25, 0.9, -0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.97, 0.9) },
  uSunScatter: { value: 1 },
  uSurfaceY: { value: 0 },
  uCausticStr: { value: 1 },
  uAmbientScale: { value: 1 },
  uCaustics: { value: null },
  uNoiseTex: { value: null },
  uGlow: { value: 0 },          // 0..1 bioluminescence emphasis (deep / night)
  uLamp: { value: 0 },          // camera-mounted ROV lamps (deep / caves / night)
  uFill: { value: 0 },          // near-field white "video light" (set by post.js each frame)
  uNight: { value: 0 },         // 0 = day, 1 = full night (moonlight); creatures/props may react
  uRain: { value: 0 },          // 0..1 rain falling on the surface (rings seen from below)
  uSurge: { value: 0 },         // 0..1 heavy swell (rougher surface, more sway)
  uCloud: { value: 0.3 },       // 0..1 cloud cover seen through Snell's window (set by conditions.js)
  uFloorCol: { value: new THREE.Color(0.3, 0.3, 0.25) }, // lit floor colour, for surface reflections
  uFloorDist: { value: 5 },     // metres from the camera path down to the seabed (terrain.js), for surface reflections
  uCamPos: { value: new THREE.Vector3() },
  // Sky-visibility map (caves / ice): R = how much sunlight reaches this xz column.
  uSkyMap: { value: null },
  uSkyOrigin: { value: new THREE.Vector2(-1e5, -1e5) }, // render-space xz of texel (0,0)
  uSkySize: { value: 256 },
  uSkyActive: { value: 0 },
  // Colour grade of the zone around the camera (written by terrain.js, read by the post composite).
  uGrade: { value: new THREE.Vector4(1, 1, 0, 0) },        // saturation, contrast, white balance, vibrance
  uGradeLift: { value: new THREE.Vector3(0, 0, 0) },      // shadow tint (added, linear)
  uGradeGain: { value: new THREE.Vector3(1, 1, 1) },      // highlight tint (multiplied)
  uGrade2: { value: new THREE.Vector4(0, 0, 0, 0) },       // subject colour restoration, reserved
};

/**
 * Tiling breakup for tileable textures sampled in world space (anti-repetition).
 * Exported for props: every applyWater shader already includes it (WATER_PARS).
 *   float nrIndex(vec2 p)                 low-frequency index field at world xz p (period 128 m)
 *   vec4  nrTexK(sampler2D t, vec2 uv, float k)              uv = worldCoord / tilePeriod
 *   vec4  nrTexG(sampler2D t, vec2 uv, vec2 gx, vec2 gy, float k)   same, explicit uv gradients (use inside branches)
 *   vec4  nrTex(sampler2D t, vec2 p, float P)                world xz p, tile period P (m), own index
 *   vec4  nrTri(vec3 p, vec3 w, float P, float k)            triplanar uNoiseTex with breakup (w = blend weights)
 * Two copies of the texture, each transformed by one of the 8 lattice symmetries plus an offset chosen by
 * the integer part of the index field, are blended by its fractional part (contrast-aware, after Quilez).
 * Lattice symmetries and an index field of period 128 m keep the result seamless under the 1024 m rebase,
 * as long as P divides 1024.
 */
export const TILE_BREAKUP = /* glsl */`
float nrIndex(vec2 p) { return texture2D(uNoiseTex, p * 0.0078125 + vec2(0.37, 0.71)).r * 14.0; }
vec2 nrOff(float i) { return fract(vec2(0.7548777, 0.5698403) * i + 0.31); }
mat2 nrMat(float i) {
  float r = mod(i, 4.0);
  vec2 c = r < 1.0 ? vec2(1.0, 0.0) : r < 2.0 ? vec2(0.0, 1.0) : r < 3.0 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
  float f = mod(floor(i * 0.25), 2.0) < 1.0 ? 1.0 : -1.0;
  return mat2(c.x, c.y, -c.y * f, c.x * f);
}
vec4 nrTexG(sampler2D t, vec2 uv, vec2 gx, vec2 gy, float k) {
  float i = floor(k), f = fract(k);
  mat2 A = nrMat(i), B = nrMat(i + 1.0);
  vec4 a = textureGrad(t, A * uv + nrOff(i), A * gx, A * gy);
  vec4 b = textureGrad(t, B * uv + nrOff(i + 1.0), B * gx, B * gy);
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * dot(a - b, vec4(1.0))));
}
vec4 nrTexK(sampler2D t, vec2 uv, float k) { return nrTexG(t, uv, dFdx(uv), dFdy(uv), k); }
vec4 nrTex(sampler2D t, vec2 p, float P) { return nrTexK(t, p / P, nrIndex(p)); }
vec4 nrTri(vec3 p, vec3 w, float P, float k) {
  vec3 dx = dFdx(p) / P, dy = dFdy(p) / P, q = p / P;
  vec4 c = vec4(0.0); float tw = 0.0;
  if (w.x > 0.03) { c += nrTexG(uNoiseTex, q.zy, dx.zy, dy.zy, k) * w.x; tw += w.x; }
  if (w.y > 0.03) { c += nrTexG(uNoiseTex, q.xz, dx.xz, dy.xz, k + 5.0) * w.y; tw += w.y; }
  if (w.z > 0.03) { c += nrTexG(uNoiseTex, q.xy, dx.xy, dy.xy, k + 9.0) * w.z; tw += w.z; }
  return c / max(tw, 1e-4);
}
`;

export const WATER_PARS = /* glsl */`
#ifndef WQ
#define WQ 1
#endif
uniform float uTime;
uniform vec3 uSigma;
uniform vec3 uLightSigma;
uniform vec3 uWaterDeep;
uniform vec3 uWaterUp;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunScatter;
uniform float uSurfaceY;
uniform float uCausticStr;
uniform float uAmbientScale;
uniform float uGlow;
uniform float uLamp;
uniform float uFill;
uniform float uNight;
uniform float uRain;
uniform float uSurge;
uniform vec3 uFloorCol;
uniform float uFloorDist;
uniform sampler2D uCaustics;
uniform sampler2D uNoiseTex;
uniform sampler2D uSkyMap;
uniform vec2 uSkyOrigin;
uniform float uSkySize;
uniform float uSkyActive;
${TILE_BREAKUP}
float skyVis(vec3 wp) {
  if (uSkyActive < 0.5) return 1.0;
  vec2 p = wp.xz - uSunDir.xz / max(uSunDir.y, 0.35) * (wp.y - uSurfaceY) * 0.5;
  vec2 uv = (p - uSkyOrigin) / uSkySize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  return texture2D(uSkyMap, uv).r;
}

vec3 waterColor(vec3 dir) {
  float y = dir.y;
  vec3 c = uWaterDeep * (0.45 + 0.55 * smoothstep(-0.9, 0.05, y));
  c = mix(c, uWaterUp, pow(smoothstep(-0.05, 1.0, y), 1.6));
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * uSunScatter * (0.05 * pow(s, 5.0) + 0.22 * pow(s, 36.0));
  return c;
}

// Caustic network projected along the sun direction. Two layers (8 m, and 10.24 m rotated by atan(3/4) so
// that both still tile over 1024 m) are domain-warped and blended by a low-frequency field, so the pattern
// never visibly repeats; it softens with depth below the surface.
vec3 causticRGB(vec3 wp) {
  vec2 p = wp.xz - uSunDir.xz / max(uSunDir.y, 0.35) * (wp.y - uSurfaceY);
  float dB = max(0.0, uSurfaceY - wp.y);
  float lb = clamp(dB * 0.045 - 0.25, 0.0, 1.6);                // mip bias: deeper caustics are softer
  vec4 lf = texture2D(uNoiseTex, p * 0.0078125);
  vec2 w = (lf.rg - 0.5) * 1.8;
  vec2 uv = p * 0.125 + w;
  vec2 d = vec2(0.006, 0.0);
#if WQ == 0
  vec3 c = vec3(texture2D(uCaustics, uv + d).r, texture2D(uCaustics, uv).r, texture2D(uCaustics, uv - d).r);
#else
  float blur = exp2(lb);
  vec2 gx = dFdx(uv) * blur, gy = dFdy(uv) * blur;
  vec3 c = vec3(textureGrad(uCaustics, uv + d, gx, gy).r, textureGrad(uCaustics, uv, gx, gy).r,
                textureGrad(uCaustics, uv - d, gx, gy).r);
  vec2 uv2 = mat2(0.8, 0.6, -0.6, 0.8) * p * 0.09765625 - w.yx;
  vec2 hx = dFdx(uv2) * blur, hy = dFdy(uv2) * blur;
  float kB = smoothstep(0.38, 0.62, lf.b);
  if (kB > 0.001) {
    vec3 c2 = vec3(textureGrad(uCaustics, uv2 + d, hx, hy).r, textureGrad(uCaustics, uv2, hx, hy).r,
                   textureGrad(uCaustics, uv2 - d, hx, hy).r);
    c = mix(c, c2, kB);
  }
#endif
  float m = texture2D(uCaustics, p / 21.333333 + vec2(0.37, 0.61), 2.0).r;
  return c * (0.25 + 1.2 * m) * (0.8 + 0.4 * lf.a);
}

vec3 waterFog(vec3 col, vec3 wp) {
  vec3 toP = wp - cameraPosition;
  float d = length(toP);
  vec3 T = exp(-uSigma * d);
  return col * T + waterColor(toP / max(d, 1e-4)) * (1.0 - T);
}
`;

const VERT_HEAD = /* glsl */`
varying vec3 vWPos;
`;
const FRAG_HEAD = /* glsl */`
varying vec3 vWPos;
${WATER_PARS}
`;

const LIGHT_PATCH = /* glsl */`
#include <lights_fragment_end>
{
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float dB = max(0.0, uSurfaceY - vWPos.y);
  float sky = skyVis(vWPos);
  vec3 Tl = exp(-uLightSigma * dB) * sky;
  vec3 ca = vec3(0.0);
  if (uCausticStr > 0.001) ca = causticRGB(vWPos) * uCausticStr * smoothstep(-0.25, 0.7, wN.y) * exp(-dB * 0.035);
  reflectedLight.directDiffuse *= Tl * (0.45 + 2.0 * ca);
  reflectedLight.directSpecular *= Tl * (0.6 + 1.5 * ca);
  reflectedLight.indirectDiffuse *= mix(Tl, vec3(1.0), 0.45) * uAmbientScale * mix(0.4, 1.0, sky);
  reflectedLight.indirectSpecular *= Tl * 0.5;
  vec3 wV = normalize(vViewPosition);
  if (uLamp > 0.001) {
    // two lamps either side of the camera, aimed forward (view space): a bright core and a soft skirt
    for (int k = 0; k < 2; k++) {
      vec3 lp = vec3(k == 0 ? -0.8 : 0.8, -0.3, 0.0);
      vec3 toL = lp + vViewPosition;
      float d = length(toL);
      vec3 L = toL / d;
      float ca2 = dot(-L, normalize(vec3(-lp.x * 0.04, 0.02, -1.0)));
      float cone = smoothstep(0.6, 0.92, ca2) * 0.75 + smoothstep(0.88, 0.99, ca2) * 0.5;
      float ndl = max(dot(normal, L), 0.0);
      vec3 irr = vec3(1.0, 0.94, 0.85) * uLamp * 14.0 * cone * ndl * exp(-uSigma * d) / (1.0 + 0.04 * d * d)
        * (d * d / (d * d + 5.0)); // near-field shoulder: close surfaces don't blow out to white
      reflectedLight.directDiffuse += irr * BRDF_Lambert(material.diffuseColor);
      reflectedLight.directSpecular += irr * 0.08 * pow(max(dot(normal, normalize(L + wV)), 0.0), 40.0);
    }
  }
  if (uFill > 0.001) {
    // wide, soft white fill from just above the lens (a diver's video light): true colours return up close
    float fd = length(vViewPosition);
    vec3 fL = normalize(vec3(0.0, 0.4, 0.0) + vViewPosition);
    float fn = max(dot(normal, fL), 0.0) * 0.75 + 0.25;
    vec3 fI = vec3(1.0, 0.95, 0.88) * uFill * fn * exp(-uSigma * fd * 1.6) / (1.0 + 0.1 * fd * fd);
    reflectedLight.directDiffuse += fI * BRDF_Lambert(material.diffuseColor);
  }
}
`;

/**
 * Patch a MeshStandardMaterial / MeshPhysicalMaterial / MeshLambertMaterial-like
 * material with the underwater look.
 * opts.key       REQUIRED unique string per distinct shader variant (program cache key)
 * opts.uniforms  extra uniforms merged in
 * opts.vertexHead / opts.fragmentHead  GLSL injected after <common>
 * opts.patch(shader)  further string replacements (runs after the water patch)
 * opts.additive  true for additive/glow materials (fog only attenuates, no in-scatter)
 * opts.noLight   true to skip the lighting/caustic patch (e.g. MeshBasicMaterial)
 * The shader quality level is available to patches as the macro WQ (0 low .. 3 ultra).
 */
export function applyWater(material, opts = {}) {
  if (!opts.key) throw new Error('applyWater: opts.key required');
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, opts.uniforms || {});
    const def = '#define WQ ' + WQ + '\n';
    shader.vertexShader = def + shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD + (opts.vertexHead || ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);');
    let fs = def + shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD + (opts.fragmentHead || ''));
    if (!opts.noLight) fs = fs.replace('#include <lights_fragment_end>', LIGHT_PATCH);
    const fog = opts.additive
      ? `{ float d_ = length(vWPos - cameraPosition); outgoingLight *= exp(-uSigma * d_); }`
      : `outgoingLight = waterFog(outgoingLight, vWPos);`;
    fs = fs.replace('#include <opaque_fragment>', fog + '\n#include <opaque_fragment>');
    shader.fragmentShader = fs;
    if (opts.patch) opts.patch(shader);
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => 'water:' + opts.key;
  return material;
}

// ---------- Procedural tileable noise texture (RGBA: 3 fbm + ridged) ----------
function periodicNoise(x, y, P, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const h = (a, b) => hash2i(((a % P) + P) % P, ((b % P) + P) % P, seed);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    for (let ch = 0; ch < 4; ch++) {
      let s = 0, amp = 0.5, P = 8, tot = 0;
      for (let k = 0; k < 5; k++) {
        let n = periodicNoise((x / size) * P, (y / size) * P, P, ch * 101 + k * 7);
        if (ch === 3) n = 1 - Math.abs(n * 2 - 1);
        s += n * amp; tot += amp; amp *= 0.5; P *= 2;
      }
      data[o + ch] = Math.max(0, Math.min(255, (s / tot) * 255));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // sharper seabed detail at grazing angles on GPUs that can afford it (three clamps to the device maximum)
  tex.anisotropy = [1, 4, 8, 16][WQ] || 1;
  tex.needsUpdate = true;
  return tex;
}

// ---------- Animated tileable caustics rendered to a small target each frame ----------
export class Caustics {
  constructor(size = 512) {
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        varying vec2 vUv; uniform float t;
        vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float edge(vec2 uv, float N, float tt){
          vec2 p = uv * N, ip = floor(p), fp = fract(p);
          float f1 = 8.0, f2 = 8.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = h2(mod(ip + g, N) + N * 13.0);
            o = 0.5 + 0.42 * sin(tt * (0.5 + o.yx * 0.6) + 6.2831 * o);
            vec2 r = g + o - fp; float d = dot(r, r);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
          }
          return sqrt(f2) - sqrt(f1);
        }
        void main(){
          vec2 uv = vUv;
          vec2 w = vec2(sin(6.2831853 * 2.0 * uv.y + t * 0.5), sin(6.2831853 * 2.0 * uv.x + t * 0.43)) * 0.06
            + vec2(sin(6.2831853 * 5.0 * uv.y - t * 0.7), sin(6.2831853 * 4.0 * uv.x + t * 0.6)) * 0.015;
          float e1 = edge(uv + w, 5.0, t * 0.9);
          float e2 = edge(uv - w * 0.8 + 0.5, 8.0, t * 1.2);
          float c = pow(1.0 - smoothstep(0.0, 0.3, e1), 3.5) * 0.85 + pow(1.0 - smoothstep(0.0, 0.26, e2), 3.0) * 0.45;
          gl_FragColor = vec4(vec3(c), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.scene.add(q);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    U.uCaustics.value = this.rt.texture;
  }
  update(renderer, time) {
    this.mat.uniforms.t.value = time;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }
}
