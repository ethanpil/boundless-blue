// Encrusting life as a skin on the rock (seamount pinnacles). A patch is built from the floor mesh's own
// triangles (the exact lattice, optionally split k x k along the same diagonal, so every piece is
// coplanar with the rock: nothing is clipped at the folds of a cliff), lit with the floor's own smoothed
// vertex normals. Its shape is decided per fragment from tangent-plane coordinates around the patch
// centre: a lobed, ragged outline, a mosaic of two colony colours with dark seams, and a surface texture
// per colony kind, so the result is independent of the mesh resolution and never reads as a polygon.
// Attributes:
//   color = colony colour A, aX.rgb = colony colour B, aX.a = kind + variant / 10
//     kind 0 encrusting sponge (pores, oscula, exhalant channels), 1 polyp carpet (jewel anemones /
//     zoanthids: packed discs), 2 hydroid / algal turf, 3 coralline crust (knobbly, pale growth margin),
//     4 veil (thin mottled film of coralline and turf, partly see-through)
//   aFx = tangent-plane coordinates (m) around the centre, aY = (distance along the patch normal, R)
import * as THREE from 'three';
import { applyWater } from '../water.js';
import { Builder, TAU, CHUNK, releaseAfterUpload } from './core.js';
import { mulberry32 } from '../noise.js';

const CRUST_V = /* glsl */`
attribute vec2 aFx;
attribute vec4 aX;
attribute vec2 aY;
varying vec2 vL;
varying vec4 vX;
varying vec2 vY;
`;
const CRUST_F = /* glsl */`
varying vec2 vL;
varying vec4 vX;
varying vec2 vY;
float cH;
vec3 cTriW(vec3 n) { vec3 w = n * n; w *= w; return w / (w.x + w.y + w.z + 1e-5); }
// triplanar lookup that skips planes with negligible weight (explicit gradients: safe inside branches)
vec4 cTri(vec3 p, vec3 w, float P) {
  vec3 q = p / P, gx = dFdx(q), gy = dFdy(q);
  vec4 c = vec4(0.0); float tw = 0.0;
  if (w.x > 0.03) { c += textureGrad(uNoiseTex, q.yz, gx.yz, gy.yz) * w.x; tw += w.x; }
  if (w.y > 0.03) { c += textureGrad(uNoiseTex, q.xz, gx.xz, gy.xz) * w.y; tw += w.y; }
  if (w.z > 0.03) { c += textureGrad(uNoiseTex, q.xy, gx.xy, gy.xy) * w.z; tw += w.z; }
  return c / max(tw, 1e-4);
}
vec3 cBump(vec3 sp, vec3 sn, vec2 dH, float fd) {
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * sn - g);
}
`;
// Patch-local lookups use vL (fixed per vertex); world-space lookups use periods dividing 1024.
const CRUST_COLOR = /* glsl */`
#include <color_fragment>
{
  float R = vY.y, kind = floor(vX.w + 0.01), vr = fract(vX.w + 0.01) * 10.0;
  vec2 vo = vec2(0.37, 0.61) * vr + vec2(0.13, 0.29) * kind;
  float d = length(vL);
  vec2 dir = vL / max(d, 1e-4);
  // outline: lobes around the rim, blobby irregularity, a ragged fringe
  float nA = texture2D(uNoiseTex, dir * 0.1 + vo).r;
  float nB = texture2D(uNoiseTex, vL / R * 0.2 + vo.yx).g;
  float nC = texture2D(uNoiseTex, vL * 1.2 + vo).b;
  float Rm = R * (0.8 + 0.5 * (nA - 0.5) + 0.36 * (nB - 0.5));
  float nD = texture2D(uNoiseTex, vL * 4.0 + vo.yx).g;
  float dd = d + (nC - 0.5) * min(0.16, 0.14 * R) + (nD - 0.5) * 0.06;
  float soft = kind > 3.5 ? 0.25 * R : (kind > 1.5 && kind < 2.5 ? 0.08 : 0.02);
  float A = 1.0 - smoothstep(Rm - soft, Rm + soft, dd);
  float Rc = kind > 3.5 ? 1.55 * R : 1.3 * R + 0.12;                      // footprint the mesh covers
  A *= 1.0 - smoothstep(0.88 * Rc, Rc, d);
  A *= 1.0 - smoothstep(0.2 * R + 0.12, 0.45 * R + 0.3, abs(vY.x));     // not over a ridge
  float fr = 1.0, fC = 0.5;
  if (kind > 3.5) {
    // veil: dappled freckles of coralline, sponge and turf with the rock showing between them
    float fA = texture2D(uNoiseTex, vL * 1.6 + vo).g, fB = texture2D(uNoiseTex, vL * 0.45 + vo.yx).r;
    fC = texture2D(uNoiseTex, vL * 5.0 + vo).a;
    fr = smoothstep(0.4, 0.68, fA * 0.55 + fB * 0.4 + fC * 0.15);
    A *= fr;
  }
  if (A < 0.004) discard;                                                  // outside: skip the texturing
  // colony mosaic: two colours split along a noise iso-line, darker seams where they meet
  float mz = texture2D(uNoiseTex, vL * 0.2 + vo * 1.7).a;
  float side = smoothstep(0.47, 0.53, mz), seam = 1.0 - smoothstep(0.0, 0.03, abs(mz - 0.5));
  vec3 col = mix(diffuseColor.rgb, vX.rgb, side);
  vec3 nW = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  vec3 w = cTriW(nW);
  vec3 o = vec3(0.37, 0.21, 0.53) * vr;
  float dist = length(vWPos - cameraPosition);
  vec4 a = cTri(vWPos + o, w, 2.0);
  vec4 b = cTri(vWPos + o.zxy, w, 0.5);
  float fine = 1.0 - smoothstep(4.0, 14.0, dist);
  vec4 c = fine > 0.0 ? cTri(vWPos + o.yzx, w, 0.125) : vec4(0.5);        // fine detail: near only
  col *= 0.84 + 0.32 * a.g;
  cH = b.r * 0.4;
  if (kind < 0.5) {
    // encrusting sponge: lumpy skin, fine pores, a few oscula, branching exhalant channels
    float pores = smoothstep(0.64, 0.72, c.b) * fine;
    float osc = smoothstep(0.79, 0.85, b.a);
    float chan = (1.0 - smoothstep(0.0, 0.035, abs(a.b - 0.5))) * smoothstep(0.35, 0.6, b.g);
    float lump = smoothstep(0.3, 0.75, b.r * 0.6 + a.a * 0.5);
    col *= (0.62 + 0.62 * lump) * (1.0 - 0.3 * pores) * (1.0 - 0.6 * osc) * (1.0 - 0.3 * chan);
    col *= 1.0 - 0.4 * seam;
    cH = lump * 0.9 - pores * 0.25 - osc * 0.6 - chan * 0.4 - seam * 0.5;
  } else if (kind < 1.5) {
    // polyp carpet: discs packed on a jittered 1/32 m lattice (dominant triplanar plane), pale knobbed
    // rims, dark mouths and dark gaps; fades to the mean colour once a cell is smaller than a pixel
    vec2 pq = w.x > max(w.y, w.z) ? vWPos.zy : (w.y > w.z ? vWPos.xz : vWPos.xy);
    vec2 q = pq * 32.0 + o.xy * 8.0;
    vec2 ci = floor(q), f = fract(q);
    float det = 1.0 - smoothstep(0.3, 0.7, length(fwidth(q)));
    vec4 h = det > 0.0 ? textureLod(uNoiseTex, (ci + 0.5) / 128.0, 0.0) : vec4(0.5);
    vec2 j = vec2(fract(h.r * 17.0), fract(h.g * 23.0)) - 0.5;
    float rad = 0.22 + 0.18 * fract(h.b * 13.0), r = length(f - 0.5 - j * (0.46 - rad) * 1.4); // jitter within the cell
    float disc = (1.0 - smoothstep(rad - 0.05, rad + 0.04, r)) * step(0.14, fract(h.a * 11.0)); // some cells empty
    float rim = smoothstep(rad - 0.14, rad - 0.05, r) * disc;
    float mouth = 1.0 - smoothstep(0.04, 0.09, r);
    vec3 pat = mix(col * 0.3, col * (0.95 + 0.25 * fract(h.a * 7.0)), disc);
    pat = mix(pat, pat * 1.35 + 0.025, rim * 0.7) * (1.0 - 0.55 * mouth);
    col = mix(col * 0.8, pat, det) * (1.0 - 0.5 * seam);
    cH = mix(0.5, disc * 0.8 + rim * 0.3 - mouth * 0.4, det) - seam * 0.4;
  } else if (kind < 2.5) {
    // hydroid / algal turf: fuzzy, low contrast, clumped, olive shading, pale tufts
    float tuft = smoothstep(0.62, 0.8, c.r) * fine;
    float clump = smoothstep(0.3, 0.72, b.b * 0.7 + a.r * 0.4);
    col *= (0.72 + 0.5 * mix(0.5, c.g, fine)) * (0.55 + 0.75 * clump);
    col = mix(col, col * vec3(0.85, 0.95, 0.7), smoothstep(0.4, 0.7, a.a) * 0.5);
    col = mix(col, col * 1.4 + 0.02, tuft * 0.6);
    A *= 0.55 + 0.45 * clump;
    cH = mix(0.5, c.g, fine) * 0.6 + clump * 0.6;
  } else if (kind < 3.5) {
    // coralline crust: knobbly, faint growth ridges, a pale growing margin along the outline
    float knob = smoothstep(0.55, 0.8, c.a) * fine;
    float ridge = (1.0 - smoothstep(0.0, 0.08, abs(fract(b.r * 6.0) - 0.5) - 0.38)) * 0.5;
    col *= (0.88 + 0.22 * knob) * (1.0 - 0.12 * ridge) * (1.0 - 0.3 * seam);
    col = mix(col, col * 1.5 + 0.03, smoothstep(Rm - 0.12, Rm - 0.01, dd) * 0.8);
    cH = knob * 0.6 + b.r * 0.3 - ridge * 0.2;
  } else {
    // veil (freckle mask applied above)
    col *= (0.7 + 0.5 * b.b) * (0.85 + 0.3 * fC);
    col = mix(col, vec3(0.5, 0.47, 0.4) * (0.8 + 0.3 * c.g), smoothstep(0.6, 0.8, b.a) * 0.35);
    A *= 0.35 + 0.3 * smoothstep(0.3, 0.7, a.a);
    cH = fr * 0.6 + b.b * 0.3 + c.g * 0.3 * fine;
  }
  {
    // distant colour washes out like the other props
    float pL = dot(col, vec3(0.3, 0.55, 0.15));
    col = mix(col, vec3(pL), smoothstep(10.0, 38.0, dist) * 0.4);
  }
  diffuseColor.rgb = col;
  diffuseColor.a *= A;
}
`;
const CRUST_NORMAL = /* glsl */`
#include <normal_fragment_maps>
normal = cBump(-vViewPosition, normal, vec2(dFdx(cH), dFdy(cH)) * 0.055, faceDirection);
`;
export function crustMaterial() {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.86, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
  return applyWater(m, {
    key: 'nb2-crust', vertexHead: CRUST_V, fragmentHead: CRUST_F,
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvL = aFx; vX = aX; vY = aY;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', CRUST_COLOR)
        .replace('#include <normal_fragment_maps>', CRUST_NORMAL);
    },
  });
}

// ---------------------------------------------------------------- patches
// floor lattice (terrain.js: DX, NZ rows per chunk; rows of every chunk line up)
const DXG = 1.5, DZG = CHUNK / 42;

// The crust mesh of one chunk, in typed arrays that grow by doubling (plain JS arrays of this size made
// the collector pause for tens of ms), plus scratch space for the patch builder.
export class Crust {
  constructor(cap = 4096) {
    this.vc = 0; this.ic = 0;
    this.P = new Float32Array(cap * 3); this.N = new Float32Array(cap * 3); this.C = new Float32Array(cap * 3);
    this.F = new Float32Array(cap * 2); this.X = new Float32Array(cap * 4); this.Y = new Float32Array(cap * 2); this.I = new Uint32Array(cap * 6);
    this.map = new Int32Array(0); this.G = null; this.T = new Float32Array(8); this.NC = new Float32Array(0); this.i0 = 0; this.j0 = 0; this.nw = 0;
  }
  v(x, y, z, nx, ny, nz, r, g, b, lu, lv, br, bg, bb, fy, dn, R) {
    if (this.vc * 3 >= this.P.length) for (const k of ['P', 'N', 'C', 'F', 'X', 'Y']) { const a = new Float32Array(this[k].length * 2); a.set(this[k]); this[k] = a; }
    const i = this.vc++, i3 = i * 3, i2 = i * 2, i4 = i * 4;
    this.P[i3] = x; this.P[i3 + 1] = y; this.P[i3 + 2] = z; this.N[i3] = nx; this.N[i3 + 1] = ny; this.N[i3 + 2] = nz;
    this.C[i3] = r; this.C[i3 + 1] = g; this.C[i3 + 2] = b; this.F[i2] = lu; this.F[i2 + 1] = lv;
    this.X[i4] = br; this.X[i4 + 1] = bg; this.X[i4 + 2] = bb; this.X[i4 + 3] = fy; this.Y[i2] = dn; this.Y[i2 + 1] = R;
    return i;
  }
  t(a, b, c) {
    if (this.ic + 3 > this.I.length) { const n = new Uint32Array(this.I.length * 2); n.set(this.I); this.I = n; }
    this.I[this.ic++] = a; this.I[this.ic++] = b; this.I[this.ic++] = c;
  }
  mesh(mat, lod = null) {
    if (!this.ic) return null;
    const g = new THREE.BufferGeometry(), n = this.vc;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, n * 3), 3));
    g.setAttribute('aFx', new THREE.BufferAttribute(this.F.slice(0, n * 2), 2));
    g.setAttribute('aX', new THREE.BufferAttribute(this.X.slice(0, n * 4), 4));
    g.setAttribute('aY', new THREE.BufferAttribute(this.Y.slice(0, n * 2), 2));
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? this.I.slice(0, this.ic) : Uint16Array.from(this.I.subarray(0, this.ic)), 1));
    g.computeBoundingSphere();
    releaseAfterUpload(g);
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    if (lod) m.userData.lod = lod;
    return m;
  }
}

// point on the floor mesh under tangent-plane coordinates (lu, lv) of frame F, projected along F.n
// (Newton steps on the exact mesh, as in seat(); vertical where n runs along the surface)
function onFloor(fs, F, lu, lv, out) {
  const { n, t1, t2 } = F;
  let px = F.x + t1[0] * lu + t2[0] * lv, py = F.y + t1[1] * lu + t2[1] * lv, pz = -F.s + t1[2] * lu + t2[2] * lv;
  for (let it = 0; it < 5; it++) {
    const h = fs.at(px, -pz), d = py - h;
    if (Math.abs(d) < 0.003) break;
    const rate = (n[0] * fs.nx + n[1] * fs.ny + n[2] * fs.nz) / Math.max(0.05, fs.ny);
    if (rate < 0.25 || it === 4) { py = h; break; }
    const del = Math.max(-2, Math.min(2, -d / rate));
    px += n[0] * del; py += n[1] * del; pz += n[2] * del;
  }
  out[0] = px; out[1] = fs.at(px, -pz); out[2] = -pz;
  return out;
}

// smoothed normal of floor node (i, j) (central differences, as terrain.js shades the floor), into o at k;
// cached per patch in C.NC (cells of the footprint plus a ring)
function nodeN(C, fs, i, j, o, k) {
  const q = ((j - C.j0 + 1) * C.nw + (i - C.i0 + 1)) * 3, NC = C.NC;
  if (NC[q + 1] === 0) {
    const gx = (fs.node(i + 1, j) - fs.node(i - 1, j)) / (2 * DXG), gs = (fs.node(i, j + 1) - fs.node(i, j - 1)) / (2 * DZG);
    const l = Math.hypot(gx, 1, gs);
    NC[q] = -gx / l; NC[q + 1] = 1 / l; NC[q + 2] = gs / l;
  }
  o[k] = NC[q]; o[k + 1] = NC[q + 1]; o[k + 2] = NC[q + 2];
}
const NN = new Float32Array(12), P3 = [0, 0, 0];

// One patch at floor point (x, s) into crust C (chunk-local coordinates). colA / colB: colony colours
// (linear); kind: see the header. Writes up to maxPts seat points (x, y, s, nx, ny, nz) inside the patch
// into pts and returns how many.
export function crustPatch(C, fs, ctx, rng, x, s, { R = 1.2, ell = 1, colA, colB, kind = 0, pts = null, maxPts = 0 } = {}) {
  const s0 = ctx.s0, y = fs.at(x, s);
  // facet frame from the smoothed slope over about the patch size, random yaw; ell squeezes one axis
  const hS = Math.min(2, Math.max(0.75, R * 0.5));
  const gx = (fs.at(x + hS, s) - fs.at(x - hS, s)) / (2 * hS), gs = (fs.at(x, s + hS) - fs.at(x, s - hS)) / (2 * hS);
  const ln = Math.hypot(gx, 1, gs), n = [-gx / ln, 1 / ln, gs / ln];
  const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let t1 = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const l1 = Math.hypot(t1[0], t1[1], t1[2]); t1 = [t1[0] / l1, t1[1] / l1, t1[2] / l1];
  let t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
  const ya = rng() * TAU, ca = Math.cos(ya), sa = Math.sin(ya);
  const u1 = [t1[0] * ca + t2[0] * sa, t1[1] * ca + t2[1] * sa, t1[2] * ca + t2[2] * sa];
  t2 = [t2[0] * ca - t1[0] * sa, t2[1] * ca - t1[1] * sa, t2[2] * ca - t1[2] * sa]; t1 = u1;
  const F = { x, y, s, n, t1, t2 };
  // footprint on the lattice: the projected outline (Rc covers every lobe, the fringe and the soft edge;
  // the shader fades to zero inside it, so the mesh border never shows)
  const Rc = kind === 4 ? 1.55 * R : 1.3 * R + 0.12;
  let x0 = 1e9, x1 = -1e9, sA = 1e9, sB = -1e9;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    onFloor(fs, F, Math.cos(a) * Rc, Math.sin(a) * Rc * ell, P3);
    x0 = Math.min(x0, P3[0]); x1 = Math.max(x1, P3[0]); sA = Math.min(sA, P3[2]); sB = Math.max(sB, P3[2]);
  }
  const i0 = Math.floor(x0 / DXG), j0 = Math.floor((sA - s0) / DZG);
  const ni = Math.min(14, Math.floor(x1 / DXG) - i0 + 1), nj = Math.min(14, Math.floor((sB - s0) / DZG) - j0 + 1);
  // sub-cells about R/2 across in 3D (cells on a cliff are tall slivers), so the footprint hugs the outline
  const ic = Math.floor(x / DXG), jc = Math.floor((s - s0) / DZG), hc = fs.node(ic, jc);
  const e3 = Math.max(Math.hypot(DXG, fs.node(ic + 1, jc) - hc), Math.hypot(DZG, fs.node(ic, jc + 1) - hc), Math.hypot(DXG, DZG, fs.node(ic + 1, jc + 1) - hc));
  const k = Math.max(2, Math.min(6, Math.ceil(e3 / (0.5 * R)))), W = ni * k + 1, H = nj * k + 1;
  if (C.map.length < W * H) { C.map = new Int32Array(W * H * 2); C.G = new Float32Array(W * H * 6); }
  const map = C.map, G = C.G; map.fill(-1, 0, W * H);
  C.i0 = i0; C.j0 = j0; C.nw = ni + 3;
  const nn = (ni + 3) * (nj + 3) * 3;
  if (C.NC.length < nn) C.NC = new Float32Array(nn * 2);
  C.NC.fill(0, 0, nn);
  const fy = kind + Math.floor(rng() * 10) / 10, ie = 1 / ell;
  // every sub-grid point once: height and tangent-plane coordinates
  for (let c = 0, id = 0; c < H; c++) for (let a = 0; a < W; a++, id++) {
    const px = (i0 + a / k) * DXG, ps = s0 + (j0 + c / k) * DZG, py = fs.at(px, ps), dx = px - x, dy = py - y, dz = -(ps - s);
    G[id * 3] = py; G[id * 3 + 1] = dx * t1[0] + dy * t1[1] + dz * t1[2]; G[id * 3 + 2] = (dx * t2[0] + dy * t2[1] + dz * t2[2]) * ie;
  }
  // vertex (a, c) of the sub-grid, created on first use
  const vert = (a, c) => {
    const id = c * W + a;
    if (map[id] >= 0) return map[id];
    const ci = Math.floor(a / k), cj = Math.floor(c / k), I = i0 + Math.min(ci, ni - 1), J = j0 + Math.min(cj, nj - 1);
    const fu = a / k - (I - i0), fv = c / k - (J - j0);
    const px = (i0 + a / k) * DXG, ps = s0 + (j0 + c / k) * DZG, py = G[id * 3];
    // the floor's vertex normals, interpolated on the same triangle split as its index buffer
    let w0, w1, w2, w3;
    if (fu + fv <= 1) { w0 = 1 - fu - fv; w1 = fu; w2 = fv; w3 = 0; } else { w0 = 0; w1 = 1 - fv; w2 = 1 - fu; w3 = fu + fv - 1; }
    nodeN(C, fs, I, J, NN, 0); nodeN(C, fs, I + 1, J, NN, 3); nodeN(C, fs, I, J + 1, NN, 6); nodeN(C, fs, I + 1, J + 1, NN, 9);
    let nx = NN[0] * w0 + NN[3] * w1 + NN[6] * w2 + NN[9] * w3, ny = NN[1] * w0 + NN[4] * w1 + NN[7] * w2 + NN[10] * w3, nz = NN[2] * w0 + NN[5] * w1 + NN[8] * w2 + NN[11] * w3;
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const dx = px - x, dy = py - y, dz = -(ps - s);
    const lu = G[id * 3 + 1], lv = G[id * 3 + 2], dn = dx * n[0] + dy * n[1] + dz * n[2];
    const L = 0.004; // a few mm off the rock; the material's polygon offset does the rest
    map[id] = C.v(px + nx * L, py + ny * L, -(ps - s0) + nz * L, nx, ny, nz, colA[0], colA[1], colA[2], lu, lv, colB[0], colB[1], colB[2], fy, dn, R);
    return map[id];
  };
  const loc = (a, c, o, q) => { const id = (c * W + a) * 3; o[q] = G[id + 1]; o[q + 1] = G[id + 2]; };
  const T = C.T, r2 = Rc * Rc;
  for (let c = 0; c < H - 1; c++) for (let a = 0; a < W - 1; a++) {
    // corners A (a, c), B (a+1, c), Cc (a, c+1), D (a+1, c+1); triangles (A, B, Cc) and (B, D, Cc)
    loc(a, c, T, 0); loc(a + 1, c, T, 2); loc(a, c + 1, T, 4); loc(a + 1, c + 1, T, 6);
    if (triNear(T, 0, 2, 4, r2)) C.t(vert(a, c), vert(a + 1, c), vert(a, c + 1));
    if (triNear(T, 2, 6, 4, r2)) C.t(vert(a + 1, c), vert(a + 1, c + 1), vert(a, c + 1));
  }
  // seat points for small 3D growths, well inside the patch
  let np = 0;
  if (pts) for (let q = 0; q < maxPts * 2 && np < maxPts; q++) {
    const a = rng() * TAU, rr = R * 0.55 * Math.sqrt(rng());
    onFloor(fs, F, Math.cos(a) * rr, Math.sin(a) * rr * ell, P3);
    const dx = P3[0] - x, dy = P3[1] - y, dz = -(P3[2] - s);
    if (Math.abs(dx * n[0] + dy * n[1] + dz * n[2]) > 0.2 * R) continue;
    fs.at(P3[0], P3[2]);
    const o = np * 6; pts[o] = P3[0]; pts[o + 1] = P3[1]; pts[o + 2] = P3[2]; pts[o + 3] = fs.nx; pts[o + 4] = fs.ny; pts[o + 5] = fs.nz; np++;
  }
  return np;
}
// does the 2D triangle (T[a], T[b], T[c]) come within sqrt(r2) of the origin?
function triNear(T, a, b, c, r2) {
  const ax = T[a], ay = T[a + 1], bx = T[b], by = T[b + 1], cx = T[c], cy = T[c + 1];
  const s1 = (bx - ax) * (0 - ay) - (by - ay) * (0 - ax), s2 = (cx - bx) * (0 - by) - (cy - by) * (0 - bx), s3 = (ax - cx) * (0 - cy) - (ay - cy) * (0 - cx);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true;
  return segD2(ax, ay, bx, by) < r2 || segD2(bx, by, cx, cy) < r2 || segD2(cx, cy, ax, ay) < r2;
}
function segD2(ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay, l = ex * ex + ey * ey, t = l > 0 ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / l)) : 0;
  const qx = ax + ex * t, qy = ay + ey * t;
  return qx * qx + qy * qy;
}

// Small cluster of tube sponges standing out of a crust patch: tubes of different heights, leaning apart,
// dark lumen, a slightly flared lip. Base at y = 0; static material mode 2 (pores).
export function tubeCluster(seed, { n = 3, h = 0.18 } = {}) {
  const b = new Builder(), rng = mulberry32(seed * 733 + 17);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = k ? 0.03 + rng() * 0.05 : 0, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const hh = h * (0.5 + rng() * 0.7), r = 0.016 + rng() * 0.014, lean = 0.15 + rng() * 0.3, la = a + (rng() - 0.5) * 0.6;
    const v0 = b.vc;
    b.lathe(7, 4, (v) => [r * (0.9 + 0.2 * v + 0.12 * Math.sin(v * 9 + k)), v * hh], null, (v, an, px, py, pz, o) => { const ao = 0.55 + 0.45 * v; o[3] = o[4] = o[5] = ao; o[6] = 0; o[7] = 2; });
    b.lathe(7, 1, (v) => [r * (1.18 - v * 0.45), hh - v * hh * 0.35], null, (v, an, px, py, pz, o) => { o[3] = o[4] = o[5] = 0.12; o[6] = 0; o[7] = 2; }, { flip: true });
    for (let i = v0; i < b.vc; i++) { // lean the tube away from the cluster centre, then offset it
      const y = b.P[i * 3 + 1], t = y / hh;
      b.P[i * 3] += x + Math.cos(la) * lean * t * y; b.P[i * 3 + 2] += z + Math.sin(la) * lean * t * y;
    }
  }
  const t = b.build();
  t.solid = false;
  t.label = 'Tube sponges'; t.fact = 'Tube sponges pump water in through tiny pores and out through the open top, filtering out bacteria.';
  return t;
}
