// Terrain chunks (floor + optional ceiling) streamed along the path, built incrementally
// across frames so generation never causes a hitch. Also maintains the sky-visibility map.
import * as THREE from 'three';
import { BIOMES, sv } from './biomes.js';
import { applyWater, U, waterQuality } from './water.js';
import { mulberry32, noise2, smoothstep, clamp } from './noise.js';
import { obstacles } from './obstacles.js';
import { PRESETS } from './quality.js';

export const CHUNK = 64;          // metres of travel per chunk
const DX = 1.5;                   // lateral grid spacing (globally aligned)
const HALF_W = 165;               // half width of a chunk around the path
const NZ = 43;                    // rows per chunk (spacing 64/42)
const AHEAD = 330, BEHIND = 40;
const NO_CEIL = 60;
// Distance (m ahead of the camera) up to which tagged prop LOD classes are drawn (per GPU tier, see quality.js).
const LOD = { high: { near: 70, mid: 150 }, low: { near: 45, mid: 100 } };

// Encrusting life on the seabed per zone: [amount 0..1, palette 0 tropical .. 0.5 temperate .. 1 bacterial mats].
const LIFE = {
  reef: [1, 0], softcoral: [0.9, 0], wall: [1, 0.05], kelp: [0.8, 0.5], seagrass: [0.45, 0.2], mangrove: [0.35, 0.45],
  sandflat: [0.2, 0.1], pelagic: [0, 0], cave: [0.15, 0.4], wreck: [0.55, 0.35], ruins: [0.6, 0.2], vents: [0.75, 1],
  deepplain: [0.12, 0.85], tidepool: [1, 0.15], abyss: [0, 0], polar: [0.3, 0.6], seamount: [0.85, 0.1],
  sargassum: [0, 0], champagne: [0.65, 0.05], jellylake: [0.4, 0.4], sunkenforest: [0.45, 0.5], anemone: [0.8, 0],
  bluehole: [0.7, 0.05], otterkelp: [0.85, 0.5], whaleshark: [0.15, 0.1], biobay: [0.3, 0.45], iceedge: [0.25, 0.6],
  hadal: [0.08, 0.9],
};
// Colour grade per zone: [saturation, contrast, white balance vs. the water cast, vibrance,
// shadow lift r g b (display-linear, added), highlight gain r g b]. Read by the post composite through U.
const GRADE = {
  reef:         [1.16, 1.12, 0.22, 0.25, 0, 0.004, 0.008, 1.04, 1.01, 0.97],
  softcoral:    [1.2, 1.1, 0.24, 0.28, 0, 0.004, 0.009, 1.04, 1.0, 0.97],
  wall:         [1.14, 1.15, 0.2, 0.2, 0, 0.002, 0.011, 1.03, 1.0, 0.98],
  kelp:         [1.1, 1.13, 0.28, 0.2, 0, 0.006, 0.004, 1.05, 1.02, 0.93],
  seagrass:     [1.14, 1.08, 0.26, 0.24, 0, 0.005, 0.005, 1.04, 1.02, 0.95],
  mangrove:     [1.08, 1.1, 0.24, 0.2, 0.003, 0.004, 0, 1.05, 1.0, 0.92],
  sandflat:     [1.14, 1.1, 0.22, 0.25, 0, 0.004, 0.008, 1.03, 1.01, 0.97],
  pelagic:      [1.15, 1.12, 0.1, 0.15, 0, 0.002, 0.013, 1.0, 1.0, 1.0],
  cave:         [1.08, 1.2, 0.18, 0.15, 0, 0.002, 0.006, 1.02, 1.0, 0.98],
  wreck:        [0.98, 1.17, 0.15, 0.1, 0, 0.006, 0.006, 1.02, 1.0, 0.96],
  ruins:        [1.08, 1.13, 0.2, 0.18, 0, 0.004, 0.007, 1.04, 1.01, 0.96],
  vents:        [1.14, 1.18, 0, 0.3, 0, 0.001, 0.003, 1.02, 1.0, 0.98],
  deepplain:    [1.1, 1.15, 0, 0.25, 0, 0.001, 0.003, 1.0, 1.0, 1.0],
  tidepool:     [1.2, 1.06, 0.3, 0.3, 0, 0.004, 0.005, 1.04, 1.02, 0.96],
  abyss:        [1.15, 1.18, 0, 0.3, 0, 0.001, 0.003, 1.0, 1.0, 1.0],
  polar:        [0.95, 1.1, 0.15, 0.1, 0, 0.004, 0.01, 0.98, 1.0, 1.03],
  seamount:     [1.14, 1.15, 0.18, 0.2, 0, 0.002, 0.011, 1.03, 1.0, 0.98],
  sargassum:    [1.15, 1.1, 0.15, 0.22, 0, 0.003, 0.01, 1.05, 1.02, 0.94],
  champagne:    [1.2, 1.1, 0.22, 0.28, 0, 0.004, 0.008, 1.04, 1.01, 0.97],
  jellylake:    [1.12, 1.08, 0.3, 0.22, 0, 0.006, 0.003, 1.05, 1.03, 0.95],
  sunkenforest: [1.05, 1.14, 0.25, 0.18, 0, 0.005, 0.004, 1.04, 1.02, 0.95],
  anemone:      [1.22, 1.1, 0.22, 0.3, 0, 0.004, 0.008, 1.04, 1.01, 0.97],
  bluehole:     [1.18, 1.15, 0.15, 0.22, 0, 0.002, 0.012, 1.02, 1.0, 0.99],
  otterkelp:    [1.1, 1.12, 0.26, 0.2, 0, 0.006, 0.004, 1.05, 1.02, 0.94],
  whaleshark:   [1.12, 1.08, 0.22, 0.2, 0, 0.004, 0.006, 1.04, 1.02, 0.96],
  biobay:       [1.2, 1.18, 0, 0.35, 0, 0.001, 0.004, 1.0, 1.0, 1.0],
  iceedge:      [0.96, 1.1, 0.15, 0.1, 0, 0.004, 0.01, 0.98, 1.0, 1.03],
  hadal:        [1.1, 1.2, 0, 0.25, 0, 0.001, 0.003, 1.0, 1.0, 1.0],
};
const GRADE_DEFAULT = [1.12, 1.1, 0.2, 0.2, 0, 0.003, 0.006, 1.02, 1.0, 0.98];
const _G = new Float32Array(11);

function floorMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  return applyWater(m, {
    key: 'floor',
    vertexHead: 'attribute vec4 aDetail; varying vec4 vDetail;',
    // values shared between the colour, normal and roughness stages of main()
    fragmentHead: 'varying vec4 vDetail; float fRockH; float fRock; vec4 fN1; vec4 fN2; vec4 fLF; float fSandH;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvDetail = aDetail;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // geometric world normal: sand on the flats, triplanar rock (no stretching) on slopes and walls
            vec3 wNg = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            float steep = 1.0 - abs(wNg.y);
#if WQ >= 1
            vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);
#endif
            // low-frequency field: silt patches and the index of the tiling breakup (no repeating tiles)
            fLF = texture2D(uNoiseTex, vWPos.xz * 0.0078125);
            float k = fLF.r * 14.0;
#if WQ == 0
            // low tier: one lookup per layer, domain-shifted by the low-frequency field (no visible tiling either)
            vec2 wq = fLF.gb - 0.5;
            fN1 = texture2D(uNoiseTex, vWPos.xz * 0.125 + wq * 1.6);
            fN2 = texture2D(uNoiseTex, vWPos.xz * 0.03125 + wq.yx * 0.6);
#else
            fN1 = nrTexK(uNoiseTex, vWPos.xz * 0.125, k);
            fN2 = nrTexK(uNoiseTex, vWPos.xz * 0.03125, k + 3.0);
#endif
            vec4 n3 = texture2D(uNoiseTex, vWPos.xz * 0.5);
            fRock = clamp(max(vDetail.y, smoothstep(0.35, 0.7, steep)), 0.0, 1.0);
            float sandDet = 0.7 + 0.46 * (fN1.r * 0.45 + fN2.g * 0.35 + n3.b * 0.2);
#if WQ == 0
            fSandH = n3.a;
#else
            fSandH = texture2D(uNoiseTex, vWPos.xz * 0.3125 + fN2.ba).a;
#endif
            fSandH *= 1.0 - smoothstep(0.3, 0.6, steep);   // planar grain: it would streak down walls
            vec4 tri = vec4(0.5);
            vec3 bw = pow(abs(wNg), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
#if WQ == 0
            {
              vec3 q = vWPos * 0.25;
              vec2 o = (fLF.gb - 0.5) * 1.6;
              tri = texture2D(uNoiseTex, q.zy + o) * bw.x + texture2D(uNoiseTex, q.xz + o) * bw.y + texture2D(uNoiseTex, q.xy + o) * bw.z;
            }
#else
            if (fRock > 0.01) {
              vec3 q = vWPos * 0.25, gx = dpx * 0.25, gy = dpy * 0.25;
              vec4 c = vec4(0.0); float tw = 0.0;
              if (bw.x > 0.03) { c += nrTexG(uNoiseTex, q.zy, gx.zy, gy.zy, k) * bw.x; tw += bw.x; }
              if (bw.y > 0.03) { c += nrTexG(uNoiseTex, q.xz, gx.xz, gy.xz, k + 5.0) * bw.y; tw += bw.y; }
              if (bw.z > 0.03) { c += nrTexG(uNoiseTex, q.xy, gx.xy, gy.xy, k + 9.0) * bw.z; tw += bw.z; }
              tri = c / max(tw, 1e-4);
            }
#endif
            float rockDet = 0.64 + 0.58 * (tri.r * 0.6 + tri.a * 0.4);
            rockDet *= 1.0 - 0.32 * smoothstep(0.4, 0.18, tri.a);          // dark, damp crevices
            // sedimentary strata on cliffs and walls
            float strata = 0.84 + 0.16 * sin(vWPos.y * 2.6 + tri.g * 6.0) * smoothstep(0.45, 0.85, steep);
            diffuseColor.rgb *= mix(sandDet, rockDet * strata, fRock);
            // large patches of darker silt and paler sand
            diffuseColor.rgb *= 0.86 + 0.28 * fLF.g;
            // encrusting life (coralline algae, turf, sponges; kelp-forest reds; bacterial mats at the vents)
            if (vDetail.z > 0.01) {
              float up = smoothstep(-0.25, 0.65, wNg.y);
              float pm = smoothstep(0.46, 0.64, fN2.b * 0.6 + fN1.a * 0.5) * up * mix(0.4, 1.0, fRock);
              float hk = vDetail.w;
              // palettes: tropical (coralline pink, turf green, sponge orange), temperate (red-brown, olive, lilac),
              // bacterial mats (pale yellow, rust, white)
              float t1 = clamp(hk * 2.0, 0.0, 1.0), t2 = clamp(hk * 2.0 - 1.0, 0.0, 1.0);
              vec3 e1 = mix(mix(vec3(0.36, 0.11, 0.17), vec3(0.24, 0.06, 0.045), t1), vec3(0.62, 0.58, 0.42), t2);
              vec3 e2 = mix(mix(vec3(0.07, 0.13, 0.035), vec3(0.13, 0.12, 0.04), t1), vec3(0.38, 0.16, 0.04), t2);
              vec3 ec = mix(e1, e2, smoothstep(0.42, 0.58, fN2.r));
#if WQ >= 1
              vec3 e3 = mix(mix(vec3(0.42, 0.15, 0.035), vec3(0.28, 0.2, 0.22), t1), vec3(0.7, 0.68, 0.62), t2);
              ec = mix(ec, e3, smoothstep(0.6, 0.72, fN1.b) * 0.85);
#endif
              diffuseColor.rgb = mix(diffuseColor.rgb, ec * (0.7 + 0.55 * n3.g), pm * vDetail.z);
            }
            fRockH = tri.a;
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 q = vWPos.xz;
            // megaripples (~6.5 m) and fine wave ripples (~0.9 m) whose orientation drifts between two sets;
            // all wave vectors are whole multiples of 2 pi / 1024 m, so the floating-origin rebase is seamless
            float ph = q.x * 0.90198 + q.y * 0.34974 + fN2.r * 7.0;
            float c = cos(ph);
            vec3 g = vec3(c * 0.902, 0.0, c * 0.35) * 0.16 * vDetail.x;
#if WQ >= 1
            vec2 k1 = vec2(1050.0, 430.0) * 0.0061359232, k2 = vec2(700.0, 890.0) * 0.0061359232;
            float pa = dot(q, k1) + fN2.g * 9.0, pb = dot(q, k2) + fN2.b * 9.0;
            float fade = 1.0 - smoothstep(0.5, 1.4, max(fwidth(pa), fwidth(pb)));
            float mixAB = smoothstep(0.35, 0.65, fLF.b);
            float amp = vDetail.x * smoothstep(0.3, 0.6, fN1.g) * fade * 0.022 * (1.0 - fRock);
            vec2 rg = k1 * (cos(pa) + 0.35 * cos(2.0 * pa)) * (1.0 - mixAB) + k2 * (cos(pb) + 0.35 * cos(2.0 * pb)) * mixAB;
            g.xz += rg * amp;
#endif
            normal = normalize(normal - mat3(viewMatrix) * g);
            // screen-space bump from the micro-relief: sand grain and triplanar rock height (works at any slope)
            float H = fSandH * 0.07 * (1.0 - fRock) + (fRockH * 0.22 + fSandH * 0.06) * fRock;
            vec2 dH = vec2(dFdx(H), dFdy(H));
            vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1);
            normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.95, 0.55 + 0.3 * fN1.b, fRock);  // slick wet rock catches the light, sand stays matte`);
    },
  });
}

// Tileable cellular (Worley) texture for dissolution scallops on cave roofs and the underside of ice, 128 px with
// 8 x 8 cells per tile (8 m tile: ~1 m dishes). R = F1 (distance to the nearest cell point; 1 = about a crest),
// G = F2 - F1 (0 on the crests between dishes), B = random value per dish, A = F1 of a 16 x 16 set (~0.5 m dishes).
// Cells are a little elongated along u, like scallops drawn out by the flow that dissolved them.
let cellTex = null;
function cellTexture(size = 128) {
  if (cellTex) return cellTex;
  const rng = mulberry32(0x5ca1105);
  const set = (N) => { const p = new Float32Array(N * N * 3); for (let i = 0; i < p.length; i++) p[i] = i % 3 === 2 ? rng() : 0.1 + 0.8 * rng(); return p; };
  const A = set(8), B = set(16);
  const worley = (P, N, u, v, out) => {
    const cx = Math.floor(u), cy = Math.floor(v);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j, k = (((gy % N) + N) % N) * N + (((gx % N) + N) % N);
      const d = Math.hypot((gx + P[k * 3] - u) * 0.8, gy + P[k * 3 + 1] - v);
      if (d < f1) { f2 = f1; f1 = d; id = k; } else if (d < f2) f2 = d;
    }
    out[0] = f1; out[1] = f2 - f1; out[2] = P[id * 3 + 2];
  };
  const data = new Uint8Array(size * size * 4), w = [0, 0, 0];
  const q = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4, u = (x + 0.5) / size, v = (y + 0.5) / size;
    worley(A, 8, u * 8, v * 8, w);
    data[o] = q(w[0] / 0.6); data[o + 1] = q(w[1] / 0.45); data[o + 2] = q(w[2]);
    worley(B, 16, u * 16, v * 16, w);
    data[o + 3] = q(w[0] / 0.6);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = [1, 4, 8, 16][waterQuality()] || 1;
  t.needsUpdate = true;
  return (cellTex = t);
}

function ceilingMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.FrontSide });
  return applyWater(m, {
    key: 'ceiling',
    uniforms: { uCellTex: { value: cellTexture() } },
    vertexHead: 'attribute float aIce; varying float vIce;',
    fragmentHead: `varying float vIce; float fCeilH; float fCeilK;
      uniform sampler2D uCellTex;
      // triplanar uCellTex with the tiling breakup (as nrTri in water.js)
      vec4 cellTri(vec3 p, vec3 w, float P, float k) {
        vec3 dx = dFdx(p) / P, dy = dFdy(p) / P, q = p / P;
        vec4 c = vec4(0.0); float tw = 0.0;
        if (w.x > 0.03) { c += nrTexG(uCellTex, q.zy, dx.zy, dy.zy, k) * w.x; tw += w.x; }
        if (w.y > 0.03) { c += nrTexG(uCellTex, q.xz, dx.xz, dy.xz, k + 5.0) * w.y; tw += w.y; }
        if (w.z > 0.03) { c += nrTexG(uCellTex, q.xy, dx.xy, dy.xy, k + 9.0) * w.z; tw += w.z; }
        return c / max(tw, 1e-4);
      }`,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvIce = aIce;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vWPos.y > uSurfaceY + 0.05) discard;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // limestone roof (or the underside of ice): dissolution scallops, ~1 m dishes with sharp crests and
            // ~0.5 m ones inside them, over smooth blotchy tone. Everything is triplanar (no smears on shaft walls)
            // and goes through the tiling breakup (no repeating tiles, no ripple bands).
            vec3 wNg = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
            vec3 bw = pow(abs(wNg), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
            fCeilK = nrIndex(vWPos.xz);
#if WQ == 0
            vec3 q = vWPos * 0.0625 + vec3(sin(fCeilK * 0.5), 0.0, cos(fCeilK * 0.4)) * 0.4;   // low tier: one tap per plane
            vec4 n = texture2D(uNoiseTex, q.zy) * bw.x + texture2D(uNoiseTex, q.xz) * bw.y + texture2D(uNoiseTex, q.xy) * bw.z;
#else
            vec4 n = nrTri(vWPos, bw, 16.0, fCeilK);
#endif
            vec4 c = cellTri(vWPos, bw, 8.0, fCeilK + 3.0);
            float crest = 1.0 - smoothstep(0.0, 0.3, c.g);
            diffuseColor.rgb *= (0.74 + 0.42 * n.g) * mix((0.86 + 0.24 * c.b) * (0.9 + 0.16 * crest), 1.0, 0.6 * vIce);
            fCeilH = 0.09 * c.r * c.r + 0.03 * c.a * c.a + 0.2 * n.r;   // dishes recessed, crests toward the viewer
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            float H = fCeilH * (1.0 - 0.7 * vIce);
            vec2 dH = vec2(dFdx(H), dFdy(H));
            vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1);
            normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (vIce > 0.001) {   // light glowing through sea ice (rock roofs skip these taps)
#if WQ == 0
            vec4 n = texture2D(uNoiseTex, vWPos.xz * 0.0625);
#else
            vec4 n = nrTexK(uNoiseTex, vWPos.xz * 0.0625, fCeilK + 2.0);
#endif
            float thin = smoothstep(-9.0, -0.8, vWPos.y);
            totalEmissiveRadiance += vIce * vec3(0.3, 0.62, 0.78) * (0.55 + 0.8 * n.r + 1.2 * thin * thin) * uSunColor * uSunScatter;
          }`);
    },
  });
}

const TINT = new Float32Array(6);

export class Terrain {
  constructor(world, shape, seq, tier = 'high') {
    this.world = world; this.shape = shape; this.seq = seq;
    this.tier = tier;
    this.lod = (PRESETS[tier] && PRESETS[tier].lod) || LOD[tier] || LOD.high;
    this.chunks = new Map();     // index -> chunk
    this.queue = [];             // pending build generators
    this.populators = [];        // (ctx) => {object, dispose} | null
    this.floorMat = floorMaterial();
    this.ceilMat = ceilingMaterial();
    this.sky = new SkyMap(shape, seq);
    // Exact samplers over built meshes: O(1), allocation-free, identical to what is rendered.
    shape.gridFloor = (x, s) => this._sample(x, s, false);
    shape.gridCeil = (x, s) => this._sample(x, s, true);
  }

  // Height of the rendered floor (or ceiling) mesh at global (x, s); undefined if not built.
  _sample(x, s, ceil) {
    const c = this.chunks.get(Math.floor(s / CHUNK));
    if (!c || !c.grid) return undefined;
    const G = c.grid;
    const u = (x - G.x0) / DX, i = Math.floor(u);
    if (i < 0 || i >= G.NX - 1) return undefined;
    if (ceil && !G.anyCeil) return NO_CEIL;
    const v = (s - c.s0) / (CHUNK / (NZ - 1)), j = Math.min(NZ - 2, Math.floor(v));
    const fu = u - i, fv = v - j, W = G.W, h = ceil ? G.hc : G.hf;
    const a = (j + 1) * W + (i + 1);
    const ha = h[a], hb = h[a + 1], hc = h[a + W], hd = h[a + W + 1];
    // same triangle split as the index buffer: (a, b, c) and (b, d, c)
    return fu + fv <= 1 ? ha + (hb - ha) * fu + (hc - ha) * fv : hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv);
  }

  // Row data depends only on s; cache per build.
  _row(s) {
    const ws = this.seq.weights(s);
    return { s, ws, px: this.shape.pathX(s), py: this.shape.pathY(s), hasCeil: ws.some((e) => BIOMES[e.key].ceil) };
  }

  *_buildChunk(idx) {
    const s0 = idx * CHUNK;
    const rows = [];
    for (let j = -1; j <= NZ; j++) rows.push(this._row(s0 + (j * CHUNK) / (NZ - 1)));
    const pxMid = rows[(NZ / 2) | 0].px;
    const x0 = Math.floor((pxMid - HALF_W) / DX) * DX;
    const NX = Math.round((2 * HALF_W) / DX) + 1;
    const W = NX + 2, H = NZ + 2;
    const hf = new Float32Array(W * H);
    const hc = new Float32Array(W * H);
    let anyCeil = false, minCeil = 1e9;
    const shape = this.shape;
    for (let j = 0; j < H; j++) {
      const r = rows[j];
      for (let i = 0; i < W; i++) {
        const x = x0 + (i - 1) * DX;
        const dx = x - r.px, ad = Math.abs(dx);
        let h = 0;
        for (const e of r.ws) { const b = BIOMES[e.key]; h += (r.py - b.clearance + b.floor(x, r.s, ad, e.g, dx)) * e.w; }
        hf[j * W + i] = Math.min(h, r.py - 2.2 + Math.max(0, ad - 4) * 2.5);
        if (r.hasCeil) {
          let c = 0;
          for (const e of r.ws) { const b = BIOMES[e.key]; c += (b.ceil ? r.py + b.ceil(x, r.s, ad, e.g, dx) : NO_CEIL) * e.w; }
          c = Math.max(c, r.py + 2.4 - Math.max(0, ad - 4) * 2.5);
          hc[j * W + i] = c; anyCeil = true; if (c < minCeil) minCeil = c;
        } else hc[j * W + i] = NO_CEIL;
      }
      if ((j & 7) === 7) yield;
    }
    const chunk = { idx, s0, group: new THREE.Group(), floor: null, ceil: null, props: [], obstacles: [], labels: [], pois: [],
      lodNear: [], lodMid: [], grid: { hf, hc, x0, NX, W, anyCeil } };
    chunk.group.position.set(0, 0, -s0);
    chunk.floor = new THREE.Mesh(this._gridGeometry(hf, rows, x0, NX, false), this.floorMat);
    chunk.floor.receiveShadow = !!this.shadows;
    chunk.group.add(chunk.floor);
    yield;
    if (anyCeil && minCeil < U.uSurfaceY.value + 0.5) {
      chunk.ceil = new THREE.Mesh(this._gridGeometry(hc, rows, x0, NX, true), this.ceilMat);
      chunk.group.add(chunk.ceil);
      yield;
    }
    this.world.add(chunk.group);
    this.chunks.set(idx, chunk);
    // props
    const ctx = this._ctx(chunk, x0, x0 + (NX - 1) * DX);
    for (const pop of this.populators) {
      yield;
      if (this.chunks.get(idx) !== chunk) return; // chunk was unloaded mid-build
      try {
        const r = pop(ctx);
        if (r && r.object) {
          if (this.shadows) r.object.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
          r.object.traverse((o) => {
            if (o.userData.lod === 'near') chunk.lodNear.push(o);
            else if (o.userData.lod === 'mid') chunk.lodMid.push(o);
          });
          chunk.lodNearVis = chunk.lodMidVis = undefined; // re-apply LOD visibility next update
          chunk.group.add(r.object); chunk.props.push(r);
        }
      } catch (e) { console.error('populator failed', e); }
    }
  }

  _ctx(chunk, xMin, xMax) {
    const sh = this.shape, seq = this.seq;
    return {
      s0: chunk.s0, s1: chunk.s0 + CHUNK, xMin, xMax,
      rng: mulberry32((chunk.idx * 2654435761) ^ seq.seed),
      group: chunk.group, // local frame: x global, y global, z = -(s - s0)
      floorAt: (x, s) => sh.floorAt(x, s),
      floorNormal: (x, s) => sh.floorNormal(x, s),
      ceilingAt: (x, s) => sh.ceilingAt(x, s),
      pathX: (s) => sh.pathX(s), pathY: (s) => sh.pathY(s),
      weights: (s) => seq.weights(s),
      weightOf: (s, k) => seq.weightOf(s, k),
      segments: seq.segmentsBetween(chunk.s0, chunk.s0 + CHUNK),
      surfaceY: U.uSurfaceY.value,
      // Register a solid capsule (GLOBAL x/y and travel distance s) that creatures must avoid.
      // Pass a = b for a sphere. Removed automatically when the chunk unloads.
      addObstacle: (ax, ay, as, bx, by, bs, r) => { chunk.obstacles.push(obstacles.add({ ax, ay, as, bx, by, bs, r })); },
      // Name shown by the "i" overlay, anchored at GLOBAL (x, y, s).
      addLabel: (name, x, y, s, fact) => { chunk.labels.push({ name, x, y, z: -s, fact }); },
      // Point of interest (set piece) that creatures and the camera director can use. GLOBAL (x, y, s);
      // r = rough radius (m); data = optional extra info. Removed when the chunk unloads.
      addPOI: (type, x, y, s, r = 5, data = null) => { chunk.pois.push({ type, x, y, s, r, data }); },
      tier: this.tier,
    };
  }

  _gridGeometry(hgt, rows, x0, NX, isCeil) {
    const W = NX + 2;
    const n = NX * NZ;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const det = isCeil ? new Float32Array(n) : new Float32Array(n * 4);
    const dz = CHUNK / (NZ - 1);
    const s0 = rows[1].s;
    let k = 0;
    for (let j = 0; j < NZ; j++) {
      const r = rows[j + 1];
      for (let i = 0; i < NX; i++, k++) {
        const g = (j + 1) * W + (i + 1);
        const h = hgt[g];
        const x = x0 + i * DX;
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -(r.s - s0);
        // normal from central differences (z = -s)
        const hx = hgt[g + 1] - hgt[g - 1];
        const hs = hgt[g + W] - hgt[g - W];
        let nx = -hx / (2 * DX), ny = 1, nz = hs / (2 * dz);
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        if (isCeil) { nx = -nx; ny = -ny; nz = -nz; }
        nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
        // occlusion from local concavity
        const mean = (hgt[g + 1] + hgt[g - 1] + hgt[g + W] + hgt[g - W]) * 0.25;
        const conc = isCeil ? h - mean : mean - h;
        const ao = clamp(1 - conc * 0.35, 0.45, 1.1);
        // colour blend across biomes
        const slope = 1 - Math.abs(ny);
        const nn = noise2(x / 7, r.s / 7, 5);
        const rocky = smoothstep(0.2, 0.5, slope + nn * 0.12);
        let cr = 0, cg = 0, cb = 0, ice = 0, rip = 0, life = 0, hue = 0;
        for (const e of r.ws) {
          const b = BIOMES[e.key];
          if (isCeil) {
            if (b.iceCeiling) { cr += 0.72 * e.w; cg += 0.86 * e.w; cb += 0.95 * e.w; ice += e.w; }
            else { cr += b.rock[0] * 0.8 * e.w; cg += b.rock[1] * 0.8 * e.w; cb += b.rock[2] * 0.8 * e.w; }
            continue;
          }
          // biome seabed colours plus its optional tint (see floorTint in biomes.js)
          const T = TINT;
          T[0] = b.sand[0]; T[1] = b.sand[1]; T[2] = b.sand[2]; T[3] = b.rock[0]; T[4] = b.rock[1]; T[5] = b.rock[2];
          if (b.floorTint) b.floorTint(x, r.s, nn, T);
          cr += (T[0] + (T[3] - T[0]) * rocky) * e.w;
          cg += (T[1] + (T[4] - T[1]) * rocky) * e.w;
          cb += (T[2] + (T[5] - T[2]) * rocky) * e.w;
          rip += (b.ripple ?? 1) * e.w;
          const L = LIFE[e.key];
          if (L) { life += L[0] * (0.65 + 0.7 * sv(e.g, 21)) * e.w; hue += L[1] * e.w; }
        }
        const v = 0.9 + 0.2 * nn;
        col[k * 3] = cr * ao * v; col[k * 3 + 1] = cg * ao * v; col[k * 3 + 2] = cb * ao * v;
        if (isCeil) det[k] = ice;
        else {
          det[k * 4] = rip * (1 - rocky) * smoothstep(0.08, 0.0, slope - 0.05); det[k * 4 + 1] = rocky;
          det[k * 4 + 2] = Math.min(1, life); det[k * 4 + 3] = hue;
        }
      }
    }
    const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
    let t = 0;
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      // rows advance toward -z; winding chosen so floor faces +y
      if (!isCeil) { idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c; }
      else { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (isCeil) geo.setAttribute('aIce', new THREE.BufferAttribute(det, 1));
    else geo.setAttribute('aDetail', new THREE.BufferAttribute(det, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  _disposeChunk(c) {
    this.world.remove(c.group);
    c.floor.geometry.dispose();
    if (c.ceil) c.ceil.geometry.dispose();
    for (const p of c.props) { try { p.dispose && p.dispose(); } catch (e) { console.error(e); } }
    for (const o of c.obstacles) obstacles.remove(o);
    c.obstacles.length = 0; c.labels.length = 0; c.pois.length = 0;
    c.lodNear.length = 0; c.lodMid.length = 0; c.grid = null;
  }

  // Points of interest with s in [s0, s1].
  queryPOIs(s0, s1, out) {
    out.length = 0;
    for (const c of this.chunks.values()) {
      if (c.s0 > s1 || c.s0 + CHUNK < s0) continue;
      for (const p of c.pois) if (p.s >= s0 && p.s <= s1) out.push(p);
    }
    return out;
  }

  // Label provider for the "i" overlay.
  labels(out) { for (const c of this.chunks.values()) for (const l of c.labels) out.push(l); }

  // Build everything needed immediately (synchronous; prefer primeAsync, which lets the page paint).
  prime(camS) {
    this.update(camS, Infinity);
  }
  // Build what the camera needs at camS in time slices, yielding between them; onProgress(0..1).
  async primeAsync(camS, onProgress, yieldFn) {
    this.update(camS, 0);
    const total = Math.max(1, this.queue.length);
    while (this.queue.length) {
      this.update(camS, 24);
      if (onProgress) onProgress(1 - this.queue.length / total);
      await yieldFn();
    }
    while (this.sky.job) { this.sky.update(camS, 24); await yieldFn(); }
    if (onProgress) onProgress(1);
  }
  // Drop the whole world (zone jump without a page reload); the caller then primes the new start.
  reset() {
    for (const c of this.chunks.values()) this._disposeChunk(c);
    this.chunks.clear();
    this.queue.length = 0;
    this.sky.job = null; this.sky.origin = null;
  }

  // Colour grade of the zone around the camera, blended across cross-fades (read by the post composite),
  // and the depth of the seabed below the path (the surface mirrors it only when it is close).
  _grade(camS) {
    _G.fill(0);
    for (const e of this.seq.weights(camS + 10)) {
      const G = GRADE[e.key] || GRADE_DEFAULT, v = 0.94 + 0.12 * sv(e.g, 31); // every segment a little different
      for (let i = 0; i < 11; i++) _G[i] += (i === 0 ? G[i] * v : (G[i] ?? 0.5)) * e.w;
    }
    U.uGrade.value.set(_G[0], _G[1], _G[2], _G[3]);
    U.uGradeLift.value.set(_G[4], _G[5], _G[6]);
    U.uGradeGain.value.set(_G[7], _G[8], _G[9]);
    U.uGrade2.value.x = _G[10];
    const sh = this.shape;
    U.uFloorDist.value = Math.max(0, sh.pathY(camS) - sh.floorAt(sh.pathX(camS), camS));
  }

  update(camS, budgetMs = 4, visDist = AHEAD) {
    this._grade(camS);
    // props in chunks entirely beyond the fog's visibility are hidden (terrain stays: it's cheap)
    for (const c of this.chunks.values()) {
      const d = Math.max(0, c.s0 - camS);
      const vis = d < visDist;
      for (const p of c.props) p.object.visible = vis;
      // level of detail: small detail only near the camera, medium props at mid range
      const nearVis = d < Math.min(this.lod.near, visDist), midVis = d < Math.min(this.lod.mid, visDist);
      if (c.lodNearVis !== nearVis) { c.lodNearVis = nearVis; for (const o of c.lodNear) o.visible = nearVis; }
      if (c.lodMidVis !== midVis) { c.lodMidVis = midVis; for (const o of c.lodMid) o.visible = midVis; }
    }
    const first = Math.floor((camS - BEHIND) / CHUNK), last = Math.floor((camS + AHEAD) / CHUNK);
    for (const [i, c] of this.chunks) if (i < first || i > last + 2) { this._disposeChunk(c); this.chunks.delete(i); }
    this.queue = this.queue.filter((q) => q.idx >= first && q.idx <= last + 2);
    for (let i = first; i <= last; i++) {
      if (!this.chunks.has(i) && !this.queue.some((q) => q.idx === i)) this.queue.push({ idx: i, gen: this._buildChunk(i) });
    }
    this.queue.sort((a, b) => a.idx - b.idx);
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const q = this.queue[0];
      if (q.gen.next().done) this.queue.shift();
    }
    this.sky.update(camS, budgetMs === Infinity ? Infinity : 2);
  }
}

// ---------- Sky visibility map: 128x128 texels @ 2m, recentred as we travel ----------
class SkyMap {
  constructor(shape, seq) {
    this.shape = shape; this.seq = seq;
    this.N = 128; this.cell = 2;
    this.data = new Uint8Array(this.N * this.N * 4).fill(255);
    this.tex = new THREE.DataTexture(this.data, this.N, this.N, THREE.RGBAFormat);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    U.uSkyMap.value = this.tex;
    U.uSkySize.value = this.N * this.cell;
    this.origin = null; // global {x, s} of texel row 0 (s increases with rows)
    this.job = null;
  }
  *_compute(ox, os) {
    const N = this.N, cell = this.cell, buf = new Float32Array(N * N);
    const surf = U.uSurfaceY.value;
    for (let j = 0; j < N; j++) {
      const s = os + j * cell;
      const ws = this.seq.weights(s);
      const hasCeil = ws.some((e) => BIOMES[e.key].ceil);
      const hasCanopy = ws.some((e) => BIOMES[e.key].canopy);
      const iceT = ws.reduce((a, e) => a + (BIOMES[e.key].iceLight || 0) * e.w, 0); // light through sea ice
      for (let i = 0; i < N; i++) {
        let v = 1;
        if (hasCeil) {
          const c = this.shape.ceilingExact(ox + i * cell, s);
          v = Math.max(smoothstep(-1.2, 0.6, c - surf), iceT + 0.03);
        }
        if (hasCanopy) v *= this.shape.canopyAt(ox + i * cell, s);
        buf[j * N + i] = v;
      }
      if ((j & 15) === 15) yield;
    }
    // 3x3 blur for soft light pools
    const out = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let a = 0, n = 0;
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
        const ii = i + x, jj = j + y;
        if (ii >= 0 && jj >= 0 && ii < N && jj < N) { a += buf[jj * N + ii]; n++; }
      }
      // texel (i, j): u -> x, v -> render z. Row j is at s = os + j*cell, i.e. z = -s,
      // so store rows flipped so that v increases with z.
      const o = ((N - 1 - j) * N + i) * 4;
      out[o] = out[o + 1] = out[o + 2] = (a / n) * 255; out[o + 3] = 255;
    }
    this.data.set(out);
    this.tex.needsUpdate = true;
    this.origin = { x: ox, s: os };
  }
  update(camS, budgetMs) {
    const active = this.seq.segmentsBetween(camS - 60, camS + 260).some((g) => BIOMES[g.key].ceil || BIOMES[g.key].canopy);
    U.uSkyActive.value = active && this.origin ? 1 : 0;
    if (!active) { this.origin = null; return; }
    const N = this.N, cell = this.cell;
    const wantS = Math.floor((camS - 40) / 32) * 32;
    if (!this.job && (!this.origin || Math.abs(this.origin.s - wantS) >= 32)) {
      const ox = Math.round((this.shape.pathX(camS + 80) - (N * cell) / 2) / cell) * cell;
      this.job = this._compute(ox, wantS);
    }
    if (this.job) {
      const t0 = performance.now();
      while (performance.now() - t0 < budgetMs) { if (this.job.next().done) { this.job = null; break; } }
    }
  }
  // Called each frame with the floating origin offset (render = global - O)
  syncUniforms(Oz) {
    if (!this.origin) return;
    const N = this.N, cell = this.cell;
    // texel v=0 corresponds to the farthest row: s = os + (N-1)*cell -> z = -s
    const zFar = -(this.origin.s + (N - 1) * cell);
    U.uSkyOrigin.value.set(this.origin.x - cell * 0.5, zFar - Oz - cell * 0.5);
  }
}
