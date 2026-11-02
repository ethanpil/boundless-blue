// Post pipeline: HDR scene -> low-res volumetric light shafts -> SSAO (medium+) -> dual-filter bloom -> composite
// (AO, focus pull + turbidity softening, white balance against the water cast, contrast, tone mapping, per-zone and
// time-of-day grade, mesopic night vision, vignette, chromatic aberration or FXAA, grain).
// Features (MSAA, shaft steps, AO samples, bloom resolution) can change at runtime (quality.js) without recompiling.
import * as THREE from 'three';
import { U, WATER_PARS, waterQuality } from './water.js';
import { registerPost } from './quality.js';

const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const MAX_SHAFT_STEPS = 48, MAX_AO = 16;

// v = luminance-normalised gains that partly neutralise a colour cast (r, g, b relative to its luminance)
const wbF = (x, e) => Math.min(4, Math.max(0.08, x)) ** -e;
function wbGain(v, r, g, b, e) {
  v.set(wbF(r, e), wbF(g, e), wbF(b, e));
  v.multiplyScalar(1 / (0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z));
}

function rt(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, Object.assign({
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, generateMipmaps: false,
  }, opts));
}

export class Post {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.opts = Object.assign({ msaa: 4, shaftDiv: 2, shaftSteps: 24, ao: false, fxaa: false, aoSamples: 12, bloomStart: 0 }, opts);
    this.params = { shafts: 1, depth: 10, exposure: 1, softStart: 12, softEnd: 70, focus: 12, aperture: 1.8, night: 0 };
    this.bloomStart = this.opts.bloomStart;
    this.aoTarget = this.opts.ao ? 1 : 0; this.aoAmt = this.aoTarget;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const WQ = { WQ: waterQuality() };

    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, {
        tDepth: { value: null }, tHist: { value: null }, uHist: { value: 0 }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uCamR: { value: new THREE.Vector3() }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uStrength: { value: 1 }, uFrame: { value: 0 },
        uSteps: { value: this.opts.shaftSteps },
      }),
      defines: Object.assign({ MAX_STEPS: MAX_SHAFT_STEPS }, WQ),
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform sampler2D tDepth, tHist;
        uniform float uHist;
        uniform mat4 uProjInv, uCamWorld;
        uniform vec3 uCamR;
        uniform float uStrength, uFrame;
        uniform int uSteps;
        ${WATER_PARS}
        float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        void main() {
          float z = texture2D(tDepth, vUv).x;
          vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
          vp.xyz /= vp.w;
          vec3 dir = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
          float dist = z >= 0.99999 ? 75.0 : min(length(vp.xyz), 110.0);
          float stepL = dist / float(uSteps);
          float j = hash(vec3(gl_FragCoord.xy, uFrame));
          vec3 acc = vec3(0.0);
          float cosT = dot(dir, uSunDir);
          float g = 0.55;
          float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.3 + 0.04;
          for (int i = 0; i < MAX_STEPS; i++) {
            if (i >= uSteps) break;
            float t = (float(i) + j) * stepL;
            vec3 p = uCamR + dir * t;
            float dB = uSurfaceY - p.y;
            if (dB < 0.0) break;
            vec2 q = p.xz - uSunDir.xz / max(uSunDir.y, 0.35) * (p.y - uSurfaceY);
            float c = texture2D(uCaustics, q / 16.0, 3.0).r;
            float c2 = texture2D(uCaustics, q / 42.666667 + vec2(0.37, 0.61), 4.0).r;
            float sh = pow(c * (0.4 + c2) * 2.0, 3.0) + 0.008;
            vec3 Tl = exp(-uLightSigma * dB);
            acc += sh * Tl * exp(-uSigma * t) * skyVis(p) * stepL;
          }
          vec3 cur = acc * uSunColor * phase * uStrength * 0.13;
          if (uLamp > 0.001) {
            // forward-scattered lamp beams (camera-space cone around the view axis)
            vec3 fwd = normalize((uCamWorld * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
            float cone = smoothstep(0.55, 1.0, dot(dir, fwd));
            float L = 0.0;
            float ld = min(dist, 40.0), st = ld / 8.0;
            for (int i = 0; i < 8; i++) {
              float t = (float(i) + j) * st + 0.3;
              L += exp(-dot(uSigma, vec3(0.33)) * 2.0 * t) / (1.0 + 0.15 * t * t) * st;
            }
            cur += vec3(0.0025, 0.0045, 0.005) * L * cone * uLamp;
          }
          gl_FragColor = vec4(mix(cur, texture2D(tHist, vUv).rgb, uHist), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */`
        varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
        // a NaN/Inf scene pixel (phone GPUs) must not bloom into a glowing block: comparisons are false for NaN
        vec3 fin(vec3 c) { return c.r < 1e4 && c.g < 1e4 && c.b < 1e4 && c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0 ? c : vec3(0.0); }
        void main() {
          vec3 c = vec3(0.0);
          c += fin(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
          c += fin(texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb);
          c += fin(texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb);
          c += fin(texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb);
          c *= 0.25;
          float l = max(c.r, max(c.g, c.b));
          float k = smoothstep(0.75, 2.0, l);
          gl_FragColor = vec4(min(c * k, vec3(30.0)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.downMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */`
        varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
          c += texture2D(tSrc, vUv - uTexel).rgb;
          c += texture2D(tSrc, vUv + uTexel).rgb;
          c += texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
          c += texture2D(tSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
          gl_FragColor = vec4(c / 8.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */`
        varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
        void main() {
          vec2 o = uTexel;
          vec3 c = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb;
          c += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0;
          c += texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb;
          c += texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb * 2.0;
          c += texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb;
          c += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0;
          c += texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb;
          c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
          gl_FragColor = vec4(c / 12.0, 1.0);
        }`,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
    });
    // Screen-space ambient occlusion (medium+): half-res, up to 16 hemisphere samples, view-space radius.
    // Output: R = occlusion, G = view depth (for the bilateral blur in the composite).
    const kernel = [];
    for (let i = 0; i < MAX_AO; i++) {
      const a = i * 2.399963, z = 0.12 + 0.86 * (((i * 7) % MAX_AO) + 0.5) / MAX_AO, r = Math.sqrt(1 - z * z);
      const sc = 0.2 + 0.8 * ((i + 0.5) / MAX_AO) ** 2;
      kernel.push(new THREE.Vector3(Math.cos(a) * r * sc, Math.sin(a) * r * sc, z * sc));
    }
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
        uKernel: { value: kernel }, uRadius: { value: 0.9 }, uFrame: { value: 0 }, uSamples: { value: this.opts.aoSamples },
      },
      defines: { MAX_AO },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform sampler2D tDepth;
        uniform mat4 uProj, uProjInv;
        uniform vec3 uKernel[MAX_AO];
        uniform float uRadius, uFrame;
        uniform int uSamples;
        vec3 viewPos(vec2 uv) {
          float z = texture2D(tDepth, uv).x;
          vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
          return p.xyz / p.w;
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uFrame * 0.618) * 43758.5453); }
        void main() {
          float z0 = texture2D(tDepth, vUv).x;
          if (z0 >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
          vec3 P = viewPos(vUv);
          if (-P.z > 45.0) { gl_FragColor = vec4(1.0, -P.z, 0.0, 1.0); return; }
          vec3 N = normalize(cross(dFdx(P), dFdy(P)));
          if (dot(N, P) > 0.0) N = -N;
          float a = hash(gl_FragCoord.xy) * 6.2831853;
          vec3 rv = vec3(cos(a), sin(a), 0.0);
          vec3 T = normalize(rv - N * dot(rv, N)), B = cross(N, T);
          float occ = 0.0;
          float R = uRadius * (1.0 + 0.012 * -P.z);   // a little wider far away: big forms still read
          for (int i = 0; i < MAX_AO; i++) {
            if (i >= uSamples) break;
            vec3 k = uKernel[i];
            vec3 sp = P + (T * k.x + B * k.y + N * k.z) * R;
            vec4 q = uProj * vec4(sp, 1.0);
            vec2 suv = q.xy / q.w * 0.5 + 0.5;
            float sz = viewPos(suv).z;
            float range = smoothstep(0.0, 1.0, R / max(1e-3, abs(P.z - sz)));
            occ += (sz >= sp.z + 0.03 ? 1.0 : 0.0) * range;
          }
          float ao = 1.0 - occ / float(uSamples);
          gl_FragColor = vec4(pow(clamp(ao, 0.0, 1.0), 1.4), -P.z, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.compMat = new THREE.ShaderMaterial({
      defines: Object.assign({}, WQ, this.opts.ao ? { AO: 1 } : {}),
      // shared water uniforms (U) plus the composite's own; uNight / uTime here are post-local copies
      uniforms: Object.assign({}, U, {
        tScene: { value: null }, tShafts: { value: null }, tBloom: { value: null }, tSoft: { value: null }, tDepth: { value: null },
        uNear: { value: 0.1 }, uFar: { value: 1400 }, uSoft: { value: new THREE.Vector2(12, 70) },
        tSoftA: { value: null }, tAO: { value: null }, uFocus: { value: 12 }, uAperture: { value: 1.8 }, uNight: { value: 0 },
        uTexel: { value: new THREE.Vector2() }, uAOTexel: { value: new THREE.Vector2() },
        uShaftTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uTime: { value: 0 }, uAspect: { value: 1 },
        uFxaa: { value: this.opts.fxaa ? 1 : 0 }, uAOAmt: { value: 0 },
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uWbNear: { value: new THREE.Vector3(1, 1, 1) }, uWbFar: { value: new THREE.Vector3(1, 1, 1) },
      }),
      // vRay: world-space view ray per metre of view depth (pixel offset from the lens = vRay * depth)
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vRay;
        uniform mat4 uProjInv, uCamWorld;
        void main() {
          vUv = uv;
          vec4 v = uProjInv * vec4(position.xy, 1.0, 1.0);
          vRay = mat3(uCamWorld) * (v.xyz / -v.z);
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying vec3 vRay;
        uniform sampler2D tScene, tShafts, tBloom, tSoft, tDepth, tSoftA, tAO;
        uniform float uNear, uFar, uFocus, uAperture, uFxaa, uAOAmt;
        uniform vec2 uSoft, uTexel, uAOTexel, uShaftTexel;
        uniform float uExposure, uAspect;
        uniform mat4 uProjInv, uCamWorld;
        uniform vec4 uGrade;          // saturation, contrast, white balance, vibrance
        uniform vec4 uGrade2;         // subject colour restoration, -, -, -
        uniform vec3 uGradeLift, uGradeGain, uWbNear, uWbFar;
        ${WATER_PARS}
        // the water's veil colour along a view direction (a cheaper twin of waterColor)
        vec3 veil(vec3 dir) {
          vec3 c = uWaterDeep * (0.45 + 0.55 * smoothstep(-0.9, 0.05, dir.y));
          float u = smoothstep(-0.05, 1.0, dir.y);
          c = mix(c, uWaterUp, u * sqrt(u));
          float s = max(dot(dir, uSunDir), 0.0), s2 = s * s;
          return c + uSunColor * uSunScatter * 0.05 * s2 * s2 * s;
        }
        float luma(vec3 c) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return l / (1.0 + l); }
        float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        // Filmic curve on the brightest channel keeps hues and colour purity; a share of the per-channel curve
        // lets very bright light (sun, lamps, bloom) roll off naturally toward white.
        vec3 tonemap(vec3 x) {
          float m = max(x.r, max(x.g, x.b));
          vec3 hp = x * (aces(vec3(m)).r / max(m, 1e-5));
          return mix(hp, aces(x), 0.4 + 0.5 * smoothstep(0.25, 2.0, m));
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main() {
          vec2 uv = vUv;
          vec2 cc = uv - 0.5;
          float r2 = dot(cc * vec2(uAspect, 1.0), cc * vec2(uAspect, 1.0));
          vec3 col;
          if (uFxaa > 0.5) {
            // FXAA-lite on the HDR scene (no MSAA): blend along the local edge direction
            vec3 rgbM = texture2D(tScene, uv).rgb;
            float lM = luma(rgbM);
            float lN = luma(texture2D(tScene, uv + vec2(0.0, uTexel.y)).rgb), lS = luma(texture2D(tScene, uv - vec2(0.0, uTexel.y)).rgb);
            float lE = luma(texture2D(tScene, uv + vec2(uTexel.x, 0.0)).rgb), lW = luma(texture2D(tScene, uv - vec2(uTexel.x, 0.0)).rgb);
            float lMin = min(lM, min(min(lN, lS), min(lE, lW))), lMax = max(lM, max(max(lN, lS), max(lE, lW)));
            col = rgbM;
            if (lMax - lMin > max(0.03, lMax * 0.12)) {
              vec2 dir = vec2(-(lN - lS), lE - lW);
              float red = max((lN + lS + lE + lW) * 0.03125, 1.0 / 128.0);
              dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -6.0, 6.0) * uTexel;
              vec3 A = 0.5 * (texture2D(tScene, uv - dir / 6.0).rgb + texture2D(tScene, uv + dir / 6.0).rgb);
              vec3 Bc = A * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
              float lB = luma(Bc);
              col = (lB < lMin || lB > lMax) ? A : Bc;
            }
          } else {
            // subtle radial chromatic aberration (housing port)
            vec2 ca = cc * r2 * 0.012;
            col.r = texture2D(tScene, uv - ca).r;
            col.g = texture2D(tScene, uv).g;
            col.b = texture2D(tScene, uv + ca).b;
          }
          // a NaN/Inf scene pixel (phone GPUs) would show as a black block: use the blurred surroundings instead
          if (!(col.r < 1e4 && col.g < 1e4 && col.b < 1e4 && col.r >= 0.0 && col.g >= 0.0 && col.b >= 0.0)) {
            col = texture2D(tSoft, uv).rgb;
            if (!(col.r < 1e4 && col.g < 1e4 && col.b < 1e4 && col.r >= 0.0 && col.g >= 0.0 && col.b >= 0.0)) col = vec3(0.0);
          }
          float zd = texture2D(tDepth, uv).x * 2.0 - 1.0;
          float vz = 2.0 * uNear * uFar / (uFar + uNear - zd * (uFar - uNear));
          float Tv = exp(-dot(uSigma, vec3(0.3333)) * min(vz, 400.0));   // how much of the subject survives the haze
#ifdef AO
          if (uAOAmt > 0.001) {
            // depth-aware (bilateral) blur of the half-res occlusion: no dark halos around silhouettes
            float tol = 0.06 * vz + 0.05, ao = 0.0, ws = 0.0;
            vec2 s0 = texture2D(tAO, uv).rg;
            float w0 = 0.4 * exp(-abs(s0.g - vz) / tol); ao += s0.r * w0; ws += w0;
            vec2 s1 = texture2D(tAO, uv + uAOTexel * vec2(1.0, 0.5)).rg; float w1 = 0.15 * exp(-abs(s1.g - vz) / tol); ao += s1.r * w1; ws += w1;
            vec2 s2 = texture2D(tAO, uv - uAOTexel * vec2(1.0, 0.5)).rg; float w2 = 0.15 * exp(-abs(s2.g - vz) / tol); ao += s2.r * w2; ws += w2;
            vec2 s3 = texture2D(tAO, uv + uAOTexel * vec2(-0.5, 1.0)).rg; float w3 = 0.15 * exp(-abs(s3.g - vz) / tol); ao += s3.r * w3; ws += w3;
            vec2 s4 = texture2D(tAO, uv - uAOTexel * vec2(-0.5, 1.0)).rg; float w4 = 0.15 * exp(-abs(s4.g - vz) / tol); ao += s4.r * w4; ws += w4;
            ao = ws > 1e-3 ? ao / ws : 1.0;
            // occlusion darkens surfaces, not the water haze in front of them
            col *= mix(1.0, ao, 0.85 * Tv * uAOAmt);
          }
#endif
          // focus pull (thin-lens circle of confusion) + turbidity softening of distant detail
          {
            float coc = clamp(abs(1.0 / uFocus - 1.0 / max(vz, 0.05)) * uAperture, 0.0, 1.0);
            float kd = smoothstep(0.1, 0.55, coc);
            float kt = smoothstep(uSoft.x, uSoft.y, vz) * 0.6;
            vec3 blurA = texture2D(tSoftA, uv).rgb, blurB = texture2D(tSoft, uv).rgb;
            vec3 blur = mix(blurA, blurB, smoothstep(0.45, 1.0, max(coc, kt)));
            col = mix(col, blur, max(kd, kt));
          }
          // subject colour restoration (after Sea-thru): undo part of the veil and the per-channel absorption
          // between the lens and subjects a few metres to a few tens of metres away, so they show truer colours
          if (uGrade2.x > 0.001) {
            vec3 vv = vRay * vz;
            float dist = length(vv);
            vec3 vdir = vv / max(dist, 1e-4);
            vec3 Tc = exp(-uSigma * dist);
            vec3 Tl = Tc * mix(vec3(1.0), Tc, uLamp);       // lamp-lit subjects lose colour both ways
            // veil removed, then the per-channel loss undone at the same luminance (colour, not brightness)
            vec3 Tk = max(Tl, vec3(0.28));
            vec3 J = max(col - veil(vdir) * (1.0 - Tc), vec3(0.0)) * (lum(Tk) / Tk);
            float kr = uGrade2.x * smoothstep(0.8, 3.0, vz) * (1.0 - smoothstep(0.12, 0.02, Tv)) * (1.0 + 0.4 * uLamp);
            kr *= smoothstep(uSurfaceY - 0.15, uSurfaceY - 1.2, uCamWorld[3].y + vv.y);   // not the surface seen from below
            col = mix(col, J, kr);
          }
#if WQ == 0
          vec3 sh = texture2D(tShafts, uv).rgb * 0.2;
          sh += texture2D(tShafts, uv + uShaftTexel * vec2(1.8, 0.8)).rgb * 0.2;
          sh += texture2D(tShafts, uv - uShaftTexel * vec2(1.8, 0.8)).rgb * 0.2;
          sh += texture2D(tShafts, uv + uShaftTexel * vec2(-0.8, 1.8)).rgb * 0.2;
          sh += texture2D(tShafts, uv - uShaftTexel * vec2(-0.8, 1.8)).rgb * 0.2;
#else
          vec3 sh = texture2D(tShafts, uv).rgb * 0.2;
          sh += texture2D(tShafts, uv + uShaftTexel * vec2(2.5, 1.0)).rgb * 0.1;
          sh += texture2D(tShafts, uv - uShaftTexel * vec2(2.5, 1.0)).rgb * 0.1;
          sh += texture2D(tShafts, uv + uShaftTexel * vec2(-1.0, 2.5)).rgb * 0.1;
          sh += texture2D(tShafts, uv - uShaftTexel * vec2(-1.0, 2.5)).rgb * 0.1;
          sh += texture2D(tShafts, uv + uShaftTexel * vec2(1.2, 1.2)).rgb * 0.1;
          sh += texture2D(tShafts, uv - uShaftTexel * vec2(1.2, 1.2)).rgb * 0.1;
          sh += texture2D(tShafts, uv + uShaftTexel * vec2(1.2, -1.2)).rgb * 0.1;
          sh += texture2D(tShafts, uv - uShaftTexel * vec2(1.2, -1.2)).rgb * 0.1;
#endif
          col += sh;
          col += texture2D(tBloom, uv).rgb * 0.55;
          col *= uExposure;

          // ---- grade (scene-referred) ----
          // white balance against the water's colour cast, like a camera set on the water: strongest on
          // subjects, gentler on the open water so it stays blue
          col *= mix(uWbFar, uWbNear, Tv);
          // contrast around mid grey (luminance only, so hues are kept)
          float L = max(lum(col), 1e-6);
          float Lc = 0.18 * pow(L / 0.18, uGrade.y);
          col *= Lc / L;
          // night: mesopic vision, dim parts lose colour and shift blue; lamp-lit subjects keep theirs
          col = mix(col, vec3(Lc) * vec3(0.7, 0.92, 1.28), uNight * (1.0 - smoothstep(0.012, 0.16, Lc)) * 0.65);
          // vignette (a soft port vignette, a touch stronger at night)
          col *= mix(1.0, smoothstep(1.05, 0.15, r2 * 1.6), 0.7 + 0.15 * uNight);
          col = tonemap(col * 1.05);
          col = mix(col, col * col * (3.0 - 2.0 * col), 0.14);   // gentle filmic S-curve: shafts and highlights pop
          // ---- grade (display-referred) ----
          float Ld = lum(col);
          float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
          float s0 = (mx - mn) / max(mx, 1e-4);
          col = max(vec3(Ld) + (col - Ld) * (uGrade.x + uGrade.w * (1.0 - s0) * (1.0 - s0)), vec3(0.0));
          // split toning: shadows toward the zone's tint, highlights warmed by the sun (golden at dawn and dusk)
          col += uGradeLift * (1.0 - Ld) * (1.0 - Ld);
          vec3 sunT = uSunColor / max(lum(uSunColor), 1e-3);
          vec3 hl = uGradeGain * mix(vec3(1.0), sunT, 0.3 * (1.0 - uNight));
          col *= mix(vec3(1.0), hl, smoothstep(0.2, 0.85, Ld));
          col = toSRGB(clamp(col, 0.0, 1.0));
          float n = hash(uv * 1000.0 + fract(uTime * 13.37) * 100.0) - 0.5;
          col += n * (0.01 + 0.012 * (1.0 - dot(col, vec3(0.333)))) * (1.0 + 0.8 * uNight);
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.frame = 0;
    this._initTimer();
    this.setSize();
    registerPost(this);
  }

  // Runtime feature changes from the quality controller (quality.js).
  setFeatures(f) {
    const msaa = f.msaa | 0, resize = msaa !== this.opts.msaa;
    this.opts.msaa = msaa;
    this.shaftMat.uniforms.uSteps.value = Math.max(4, Math.min(MAX_SHAFT_STEPS, f.shaftSteps | 0));
    this.aoTarget = this.opts.ao && f.aoSamples > 0 ? 1 : 0;
    if (f.aoSamples > 0) this.aoMat.uniforms.uSamples.value = Math.min(MAX_AO, f.aoSamples | 0);
    this.bloomStart = f.bloomStart ? 1 : 0;
    this.compMat.uniforms.uFxaa.value = this.opts.fxaa || msaa === 0 ? 1 : 0;
    if (resize && this.sceneRT) this.setSize();
  }

  // GPU time per frame from timer queries (EXT_disjoint_timer_query_webgl2) where available: post.gpuMs.
  _initTimer() {
    const gl = this.renderer.getContext();
    this.tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuMs = 0; this.gpuValid = false;
    this._q = []; this._qHead = 0; this._qCount = 0;
    if (this.tq) for (let i = 0; i < 4; i++) this._q.push(gl.createQuery());
  }
  _pollTimer(gl) {
    while (this._qCount > 0) {
      const q = this._q[this._qHead];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      this._qHead = (this._qHead + 1) % this._q.length; this._qCount--;
      if (gl.getParameter(this.tq.GPU_DISJOINT_EXT)) continue;
      const ms = ns / 1e6;
      this.gpuMs = this.gpuValid ? this.gpuMs * 0.9 + ms * 0.1 : ms; this.gpuValid = true;
    }
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, size.x | 0), h = Math.max(2, size.y | 0);
    if (this.sceneRT) {
      this.sceneRT.depthTexture.dispose();
      this.sceneRT.dispose(); this.shaftRT.dispose(); this.shaftRT2.dispose(); this.softA.dispose(); this.softB.dispose();
      if (this.aoRT) this.aoRT.dispose();
      for (const t of this.mips) t.dispose();
    }
    this.sceneRT = rt(w, h, { depthBuffer: true, samples: this.opts.msaa });
    this.sceneRT.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    const d = this.opts.shaftDiv;
    this.shaftRT = rt(Math.ceil(w / d), Math.ceil(h / d));
    this.shaftRT2 = rt(Math.ceil(w / d), Math.ceil(h / d));
    this.histValid = false;
    this.softA = rt(Math.ceil(w / 2), Math.ceil(h / 2));
    this.softB = rt(Math.ceil(w / 4), Math.ceil(h / 4));
    this.aoRT = this.opts.ao ? rt(Math.ceil(w / 2), Math.ceil(h / 2)) : null;
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) { mw = Math.max(1, Math.ceil(mw / 2)); mh = Math.max(1, Math.ceil(mh / 2)); this.mips.push(rt(mw, mh)); }
    this.w = w; this.h = h;
    this.compMat.uniforms.uAspect.value = w / h;
  }

  // White-balance gains against the water's colour cast (luminance kept), for near subjects and for the open water.
  // Lamp light is already white, so at night and in the deep the correction backs off.
  _whiteBalance(near, far) {
    const up = U.uWaterUp.value, dp = U.uWaterDeep.value;
    const r = Math.max(1e-4, up.r + dp.r), g = Math.max(1e-4, up.g + dp.g), b = Math.max(1e-4, up.b + dp.b);
    const L = Math.max(1e-4, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    const k = U.uGrade.value.z * (1 - 0.8 * Math.max(U.uNight.value, U.uLamp.value));
    wbGain(near, r / L, g / L, b / L, k);
    wbGain(far, r / L, g / L, b / L, k * 0.4);
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(time) {
    const r = this.renderer, cam = this.camera, gl = r.getContext();
    this.frame++;
    // the near-field fill light: a soft white video light in daylight; off when the ROV lamps take over
    const day = Math.min(1.2, U.uSunScatter.value) * (1 - U.uNight.value);
    U.uFill.value = this.params.fill ?? 0.9 * day * (1 - Math.min(1, U.uLamp.value * 1.6));
    if (this.tq) this._pollTimer(gl);
    const timing = this.tq && this._qCount < this._q.length;
    if (timing) gl.beginQuery(this.tq.TIME_ELAPSED_EXT, this._q[(this._qHead + this._qCount) % this._q.length]);

    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, cam);

    // light shafts
    const su = this.shaftMat.uniforms;
    if (this.params.shafts > 0.01 || U.uLamp.value > 0.001) {
      su.tDepth.value = this.sceneRT.depthTexture;
      su.uProjInv.value.copy(cam.projectionMatrixInverse);
      su.uCamWorld.value.copy(cam.matrixWorld);
      su.uCamR.value.copy(cam.position);
      su.uStrength.value = this.params.shafts;
      su.uFrame.value = this.frame % 1024;
      const tmp = this.shaftRT; this.shaftRT = this.shaftRT2; this.shaftRT2 = tmp;
      su.tHist.value = this.shaftRT2.texture;
      su.uHist.value = this.histValid ? 0.82 : 0;
      this._pass(this.shaftMat, this.shaftRT);
      this.histValid = true;
    } else {
      r.setRenderTarget(this.shaftRT); r.setClearColor(0x000000, 1); r.clear();
      this.histValid = false;
    }

    // bloom: bright-pass into the first level (half or quarter res), downsample chain, additive upsample back
    const m = this.mips, b0 = this.bloomStart;
    this.brightMat.uniforms.tSrc.value = this.sceneRT.texture;
    this.brightMat.uniforms.uTexel.value.set((b0 ? 1.5 : 0.5) / this.w, (b0 ? 1.5 : 0.5) / this.h);
    this._pass(this.brightMat, m[b0]);
    for (let i = b0 + 1; i < m.length; i++) {
      this.downMat.uniforms.tSrc.value = m[i - 1].texture;
      this.downMat.uniforms.uTexel.value.set(1 / m[i - 1].width, 1 / m[i - 1].height);
      this._pass(this.downMat, m[i]);
    }
    for (let i = m.length - 1; i > b0; i--) {
      this.upMat.uniforms.tSrc.value = m[i].texture;
      this.upMat.uniforms.uTexel.value.set(0.5 / m[i].width, 0.5 / m[i].height);
      this.quad.material = this.upMat;
      r.setRenderTarget(m[i - 1]);
      r.autoClear = false;
      r.render(this.quadScene, this.quadCam);
      r.autoClear = true;
    }

    // quarter-res blurred copy of the scene for distance softening
    this.downMat.uniforms.tSrc.value = this.sceneRT.texture;
    this.downMat.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this._pass(this.downMat, this.softA);
    this.downMat.uniforms.tSrc.value = this.softA.texture;
    this.downMat.uniforms.uTexel.value.set(1 / this.softA.width, 1 / this.softA.height);
    this._pass(this.downMat, this.softB);

    // ambient occlusion fades in and out over ~1.5 s when the quality controller switches it
    this.aoAmt += Math.sign(this.aoTarget - this.aoAmt) * Math.min(Math.abs(this.aoTarget - this.aoAmt), 0.011);
    if (this.aoRT && this.aoAmt > 0.001) {
      const au = this.aoMat.uniforms;
      au.tDepth.value = this.sceneRT.depthTexture;
      au.uProj.value.copy(cam.projectionMatrix);
      au.uProjInv.value.copy(cam.projectionMatrixInverse);
      au.uFrame.value = this.frame % 64;
      this._pass(this.aoMat, this.aoRT);
    }

    const cu = this.compMat.uniforms;
    cu.tSoft.value = this.softB.texture;
    cu.tSoftA.value = this.softA.texture;
    cu.tAO.value = this.aoRT ? this.aoRT.texture : null;
    cu.uAOAmt.value = this.aoRT ? this.aoAmt : 0;
    cu.uFocus.value = Math.max(0.5, this.params.focus);
    cu.uAperture.value = this.params.aperture;
    cu.uNight.value = this.params.night;
    cu.uTexel.value.set(1 / this.w, 1 / this.h);
    if (this.aoRT) cu.uAOTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
    cu.tDepth.value = this.sceneRT.depthTexture;
    cu.uNear.value = cam.near; cu.uFar.value = cam.far;
    cu.uSoft.value.set(this.params.softStart, this.params.softEnd);
    cu.tScene.value = this.sceneRT.texture;
    cu.tShafts.value = this.shaftRT.texture;
    cu.tBloom.value = m[b0].texture;
    cu.uShaftTexel.value.set(1 / this.shaftRT.width, 1 / this.shaftRT.height);
    cu.uExposure.value = this.params.exposure;
    cu.uTime.value = time;
    cu.uProjInv.value.copy(cam.projectionMatrixInverse);
    cu.uCamWorld.value.copy(cam.matrixWorld);
    this._whiteBalance(cu.uWbNear.value, cu.uWbFar.value);
    this._pass(this.compMat, null);
    if (timing) { gl.endQuery(this.tq.TIME_ELAPSED_EXT); this._qCount++; }
  }
}
