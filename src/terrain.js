// Terrain chunks (floor + optional ceiling) streamed along the path, built incrementally
// across frames so generation never causes a hitch. Also maintains the sky-visibility map.
// The heightfields, vertex data and sky map are made by world workers (src/worker/) when there are any; this
// thread wraps them in geometry and runs the prop populators. Without workers the same generators run here.
import * as THREE from 'three';
import { BIOMES, sv } from './biomes.js';
import { applyWater, U, waterQuality } from './water.js';
import { mulberry32 } from './noise.js';
import { obstacles } from './obstacles.js';
import { PRESETS } from './quality.js';
import { CHUNK, DX, NZ, NO_CEIL, rowS, chunkData, skyData } from './worker/terrain_gen.js';

export { CHUNK };
const AHEAD = 330, BEHIND = 40;
// Distance (m ahead of the camera) up to which tagged prop LOD classes are drawn (per GPU tier, see quality.js).
const LOD = { high: { near: 70, mid: 150 }, low: { near: 45, mid: 100 } };
// Builds waiting for workers go ahead here once the pool has stalled this long (ms): a caller running the
// simulation in a synchronous loop (__ocean.advance, devfly), during which no worker message can arrive.
const OVERDUE = 2000;
const WAIT = 'wait'; // yielded by a build that is waiting for a worker
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

// Wrap chunk vertex data (see gridData in terrain_gen.js) in a geometry.
function gridGeometry(a, isCeil) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(a.nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(a.col, 3));
  if (isCeil) geo.setAttribute('aIce', new THREE.BufferAttribute(a.det, 1));
  else geo.setAttribute('aDetail', new THREE.BufferAttribute(a.det, 4));
  geo.setIndex(new THREE.BufferAttribute(a.idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

export class Terrain {
  // pool: world workers (src/worker/pool.js), or null to build everything on this thread (tools, ?worker=0)
  constructor(world, shape, seq, tier = 'high', pool = null) {
    this.world = world; this.shape = shape; this.seq = seq;
    this.tier = tier;
    this.lod = (PRESETS[tier] && PRESETS[tier].lod) || LOD[tier] || LOD.high;
    this.chunks = new Map();     // index -> chunk
    this.queue = [];             // pending builds {idx, job (worker job or null), it (generator), f (progress 0..1)}
    this.populators = [];        // (ctx) => {object, dispose} | null
    this.pool = pool;
    this.generation = 0;         // bumped by reset(): an older primeAsync stops
    this._sync = false;          // inside prime(): build everything now, on this thread
    this.onBuilt = null;         // (group) => void, once a chunk has all its props (main.js precompiles its shaders)
    this.floorMat = floorMaterial();
    this.ceilMat = ceilingMaterial();
    this.sky = new SkyMap(shape, seq, pool);
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

  // Queue chunk idx. With workers its data is requested at once, so they work ahead while props are built here.
  _queueChunk(idx) {
    const q = { idx, job: null, it: null, f: 0 };
    if (this.pool && !this.pool.failed && !this._sync) {
      // look the rows up here first: the sequence grows (and prunes) exactly as for a build on this thread,
      // and the snapshot then holds every segment the rows touch
      for (let j = -1; j <= NZ; j++) this.seq.weights(rowS(idx, j));
      q.job = this.pool.run({ type: 'chunk', idx, segs: this.seq.snapshot(), surfaceY: U.uSurfaceY.value });
    }
    q.it = this._buildChunk(q);
    return q;
  }

  *_buildChunk(q) {
    const idx = q.idx, s0 = idx * CHUNK, job = q.job;
    let d = null;
    if (job) {
      while (!job.done && !this._sync && !this.pool.stalled(OVERDUE)) yield WAIT;
      d = job.result;
      if (!d) this.pool.cancel(job); // failed, stalled, or prime() wants it now: build it here
    }
    if (!d) d = yield* chunkData(this.shape, this.seq, idx, U.uSurfaceY.value);
    const chunk = { idx, s0, group: new THREE.Group(), floor: null, ceil: null, props: [], obstacles: [], labels: [], pois: [],
      lodNear: [], lodMid: [], grid: { hf: d.hf, hc: d.hc, x0: d.x0, NX: d.NX, W: d.W, anyCeil: d.anyCeil } };
    chunk.group.position.set(0, 0, -s0);
    chunk.floor = new THREE.Mesh(gridGeometry(d.floor, false), this.floorMat);
    chunk.floor.receiveShadow = !!this.shadows;
    chunk.group.add(chunk.floor);
    if (d.ceil) {
      chunk.ceil = new THREE.Mesh(gridGeometry(d.ceil, true), this.ceilMat);
      chunk.group.add(chunk.ceil);
    }
    this.world.add(chunk.group);
    this.chunks.set(idx, chunk);
    // props
    const ctx = this._ctx(chunk, d.x0, d.x0 + (d.NX - 1) * DX);
    for (let k = 0; k < this.populators.length; k++) {
      const pop = this.populators[k];
      q.f = k / this.populators.length;
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
    if (this.onBuilt) this.onBuilt(chunk.group);
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

  // Build everything needed immediately (synchronous, on this thread; prefer primeAsync, which lets the page paint).
  prime(camS) {
    this.update(camS, Infinity);
  }
  // Build what the camera needs at camS in time slices, yielding between them; onProgress(0..1).
  async primeAsync(camS, onProgress, yieldFn) {
    const gen = this.generation;
    this.update(camS, 0);
    const total = Math.max(1, this.queue.length);
    // from here on only build: when the frame loop runs too (zone jumps), its update() keeps the queue in step
    // with the moving camera, and re-queueing chunks for camS here would fight it over the chunk just behind
    while (this.queue.length) {
      this._work(24);
      const q = this.queue[0];
      if (onProgress) onProgress(1 - (this.queue.length - (q ? q.f : 0)) / total);
      // while the next chunk is with a worker, go on as soon as it is back (or after a paint)
      await (q && q.job && !q.job.done ? Promise.race([q.job.promise, yieldFn()]) : yieldFn());
      if (gen !== this.generation) return; // reset meanwhile: the caller of reset() primes the new world
    }
    while (this.sky.job) {
      this.sky.update(camS, 24);
      const j = this.sky.pending;
      await (j && !j.done ? Promise.race([j.promise, yieldFn()]) : yieldFn());
      if (gen !== this.generation) return;
    }
    if (onProgress) onProgress(1);
  }
  // Drop the whole world (zone jump without a page reload); the caller then primes the new start.
  // Worker jobs still queued are cancelled; one already running finishes and its result is discarded.
  reset() {
    this.generation++;
    for (const c of this.chunks.values()) this._disposeChunk(c);
    this.chunks.clear();
    for (const q of this.queue) if (q.job) this.pool.cancel(q.job);
    this.queue.length = 0;
    if (this.sky.pending) this.pool.cancel(this.sky.pending);
    this.sky.job = null; this.sky.pending = null; this.sky.origin = null;
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
    this._sync = budgetMs === Infinity;
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
    this.queue = this.queue.filter((q) => {
      if (q.idx >= first && q.idx <= last + 2) return true;
      if (q.job) this.pool.cancel(q.job);
      return false;
    });
    for (let i = first; i <= last; i++) {
      if (!this.chunks.has(i) && !this.queue.some((q) => q.idx === i)) this.queue.push(this._queueChunk(i));
    }
    this.queue.sort((a, b) => a.idx - b.idx);
    this._work(budgetMs);
    this.sky.update(camS, budgetMs === Infinity ? Infinity : 2);
    this._sync = false;
  }
  // Run the queued builds in order for up to budgetMs.
  _work(budgetMs) {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const r = this.queue[0].it.next();
      if (r.done) this.queue.shift();
      else if (r.value === WAIT) break; // the next chunk in line is still with a worker
    }
  }
}

// ---------- Sky visibility map: 128x128 texels @ 2m, recentred as we travel ----------
class SkyMap {
  constructor(shape, seq, pool) {
    this.shape = shape; this.seq = seq; this.pool = pool;
    this.N = 128; this.cell = 2;
    this.data = new Uint8Array(this.N * this.N * 4).fill(255);
    this.tex = new THREE.DataTexture(this.data, this.N, this.N, THREE.RGBAFormat);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    U.uSkyMap.value = this.tex;
    U.uSkySize.value = this.N * this.cell;
    this.origin = null; // global {x, s} of texel row 0 (s increases with rows)
    this.job = null;     // generator making the next map
    this.pending = null; // its worker job, while one is out
    this.sync = false;   // inside prime(): finish on this thread
  }
  // The map with row 0 at global (ox, os): from a worker when there is one, else time-sliced here.
  *_compute(ox, os) {
    const N = this.N, cell = this.cell, surf = U.uSurfaceY.value;
    let out = null;
    if (this.pool && !this.pool.failed && !this.sync) {
      for (let j = 0; j < N; j++) this.seq.weights(os + j * cell); // grow the sequence as a build here would
      const job = this.pending = this.pool.run({ type: 'sky', segs: this.seq.snapshot(), ox, os, N, cell, surf });
      while (!job.done && !this.sync && !this.pool.stalled(OVERDUE)) yield WAIT;
      this.pending = null;
      out = job.result;
      if (!out) this.pool.cancel(job);
    }
    if (!out) out = yield* skyData(this.shape, this.seq, ox, os, N, cell, surf);
    this.data.set(out);
    this.tex.needsUpdate = true;
    this.origin = { x: ox, s: os };
  }
  update(camS, budgetMs) {
    this.sync = budgetMs === Infinity;
    const active = this.seq.segmentsBetween(camS - 60, camS + 260).some((g) => BIOMES[g.key].ceil || BIOMES[g.key].canopy);
    U.uSkyActive.value = active && this.origin ? 1 : 0;
    if (!active) { // a map still being made is for a region left behind: drop it (primeAsync waits for sky.job)
      this.origin = null;
      if (this.pending) this.pool.cancel(this.pending);
      this.job = null; this.pending = null;
      return;
    }
    const N = this.N, cell = this.cell;
    const wantS = Math.floor((camS - 40) / 32) * 32;
    if (!this.job && (!this.origin || Math.abs(this.origin.s - wantS) >= 32)) {
      const ox = Math.round((this.shape.pathX(camS + 80) - (N * cell) / 2) / cell) * cell;
      this.job = this._compute(ox, wantS);
    }
    if (this.job) {
      const t0 = performance.now();
      while (performance.now() - t0 < budgetMs) {
        const r = this.job.next();
        if (r.done) { this.job = null; break; }
        if (r.value === WAIT) break;
      }
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
