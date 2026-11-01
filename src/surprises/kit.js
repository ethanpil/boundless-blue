// Shared building blocks for the surprise encounters: a small geometry builder (merges three.js
// primitives and lofts into one indexed geometry with linear vertex colours, per-vertex glow / roughness
// and optional rigid or blended skinning), the lit materials (all through applyWater), fake volumetric
// light cones and lamp-lit pools of light draped over the seabed. No real lights are ever added: a new
// light would recompile every material in the scene.
import * as THREE from 'three';
import { applyWater, WATER_PARS, U } from '../water.js';

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

const _col = new THREE.Color();
// sRGB hex -> linear [r, g, b] (vertex colours and uniforms are linear)
export function lin(hex) { _col.set(hex); return [_col.r, _col.g, _col.b]; }
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// Scratch versions for per-vertex colour functions (no garbage): valid until the next call.
const _c3 = [0, 0, 0];
export const mulS = (a, k) => { _c3[0] = a[0] * k; _c3[1] = a[1] * k; _c3[2] = a[2] * k; return _c3; };
export const mixMulS = (a, b, t, k) => {
  _c3[0] = (a[0] + (b[0] - a[0]) * t) * k; _c3[1] = (a[1] + (b[1] - a[1]) * t) * k; _c3[2] = (a[2] + (b[2] - a[2]) * t) * k; return _c3;
};

// Cheap deterministic 3D value noise in [0, 1) for baked grime, streaks and mottling.
function h3(x, y, z) {
  let n = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2246822519)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = lerp(lerp(h3(ix, iy, iz), h3(ix + 1, iy, iz), u), lerp(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), u), v);
  const b = lerp(lerp(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), u), lerp(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), u), v);
  return lerp(a, b, w);
}
export const fbm = (x, y, z) => vnoise(x, y, z) * 0.55 + vnoise(x * 2.03, y * 2.03, z * 2.03) * 0.3 + vnoise(x * 4.1, y * 4.1, z * 4.1) * 0.15;

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _t = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
// Transform: translate, rotate (XYZ Euler, radians), scale.
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'XYZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_t.set(x, y, z), _q, _s.set(sx, sy, sz));
}
// A transform that maps a unit-height primitive centred on the origin along Y (three.js cylinders and
// boxes) onto the segment a -> b (struts, limbs), scaling x/z by w.
export function seg(ax, ay, az, bx, by, bz, w = 1) {
  _a.set(bx - ax, by - ay, bz - az);
  const l = _a.length() || 1e-6;
  _q.setFromUnitVectors(_up, _a.divideScalar(l));
  return new THREE.Matrix4().compose(_t.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(w, l, w));
}

const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();

/**
 * Accumulates transformed primitives into one geometry.
 * add(geo, matrix, col, opts): geo is consumed (disposed); col = [r, g, b] (linear) or
 * (x, y, z, nx, ny, nz) => [r, g, b] evaluated on transformed positions; opts.bone = index or
 * (x, y, z) => [b0, b1, w1] for blended skinning; opts.glow = emissive gain (>= 100: blinking strobe,
 * gain = glow - 100); opts.rough = per-vertex roughness (0 = the material's).
 */
export class GeoBuilder {
  constructor(skinned = false) {
    this.skinned = skinned;
    this.cap = 0; this.icap = 0; this.nv = 0; this.ni = 0;
    this._grow(4096, 8192);
  }
  // growable typed buffers (less garbage than JS arrays while building)
  _grow(nv, ni) {
    if (nv > this.cap) {
      const c = Math.max(nv, this.cap * 2), cp = (a, k) => { const b = new Float32Array(c * k); if (a) b.set(a.subarray(0, this.nv * k)); return b; };
      this.P = cp(this.P, 3); this.N = cp(this.N, 3); this.C = cp(this.C, 3); this.S = cp(this.S, 2);
      if (this.skinned) { const k = new Uint16Array(c * 4); if (this.K) k.set(this.K.subarray(0, this.nv * 4)); this.K = k; this.W = cp(this.W, 4); }
      this.cap = c;
    }
    if (ni > this.icap) {
      const c = Math.max(ni, this.icap * 2), b = new Uint32Array(c);
      if (this.I) b.set(this.I.subarray(0, this.ni));
      this.I = b; this.icap = c;
    }
  }
  add(geo, m, col, opts = {}) {
    const bone = opts.bone ?? 0, glow = opts.glow ?? 0, rough = opts.rough ?? 0;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count, v0 = this.nv;
    const nIdx = geo.index ? geo.index.count : n;
    this._grow(v0 + n, this.ni + nIdx);
    if (m) _nm.getNormalMatrix(m);
    const cf = typeof col === 'function', bf = typeof bone === 'function';
    const P = this.P, N = this.N, C = this.C, S = this.S, K = this.K, W = this.W;
    for (let i = 0; i < n; i++) {
      _p.fromBufferAttribute(pos, i); _n.fromBufferAttribute(nor, i);
      if (m) { _p.applyMatrix4(m); _n.applyMatrix3(_nm).normalize(); }
      const v = v0 + i, v3 = v * 3;
      P[v3] = _p.x; P[v3 + 1] = _p.y; P[v3 + 2] = _p.z; N[v3] = _n.x; N[v3 + 1] = _n.y; N[v3 + 2] = _n.z;
      const c = cf ? col(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z) : col;
      C[v3] = c[0]; C[v3 + 1] = c[1]; C[v3 + 2] = c[2];
      S[v * 2] = glow; S[v * 2 + 1] = rough;
      if (this.skinned) {
        const v4 = v * 4;
        if (bf) { const b = bone(_p.x, _p.y, _p.z); K[v4] = b[0]; K[v4 + 1] = b[1]; K[v4 + 2] = 0; K[v4 + 3] = 0; W[v4] = 1 - b[2]; W[v4 + 1] = b[2]; W[v4 + 2] = 0; W[v4 + 3] = 0; }
        else { K[v4] = bone; K[v4 + 1] = 0; K[v4 + 2] = 0; K[v4 + 3] = 0; W[v4] = 1; W[v4 + 1] = 0; W[v4 + 2] = 0; W[v4 + 3] = 0; }
      }
    }
    const I = this.I;
    if (geo.index) { const ix = geo.index.array; for (let i = 0; i < ix.length; i++) I[this.ni + i] = ix[i] + v0; }
    else for (let i = 0; i < n; i++) I[this.ni + i] = v0 + i;
    this.ni += nIdx; this.nv += n;
    geo.dispose();
    return this;
  }
  get tris() { return this.ni / 3; }
  build() {
    const g = new THREE.BufferGeometry(), nv = this.nv;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, nv * 3), 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(this.S.slice(0, nv * 2), 2));
    if (this.skinned) {
      g.setAttribute('skinIndex', new THREE.BufferAttribute(this.K.slice(0, nv * 4), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(this.W.slice(0, nv * 4), 4));
    }
    const idx = nv > 65535 ? this.I.slice(0, this.ni) : Uint16Array.from(this.I.subarray(0, this.ni));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    this.P = this.N = this.C = this.S = this.K = this.W = this.I = null;
    return g;
  }
}

// Superellipse point (e = 2 ellipse, e > 2 rounded rectangle).
const se = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), 2 / e);

/**
 * Loft through elliptical (or superelliptical) rings. axis 'y': rings [y, rx, rz, cx = 0, cz = 0];
 * axis 'z': rings [z, rx, ry, cx = 0, cy = 0]. Rings must be ordered along the axis. Caps close both ends.
 */
export function loft(rings, seg = 12, { axis = 'y', e = 2, caps = true, phase = 0 } = {}) {
  const nr = rings.length, P = [], I = [];
  for (let j = 0; j < nr; j++) {
    const [h, ra, rb, ca = 0, cb = 0, ee = e] = rings[j];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU + phase, c = se(Math.cos(a), ee), s = se(Math.sin(a), ee);
      if (axis === 'y') P.push(ca + ra * c, h, cb + rb * s);
      else P.push(ca + ra * c, cb + rb * s, h);
    }
  }
  const row = seg + 1, nSide = nr * row;
  const flip = axis === 'y';
  for (let j = 0; j < nr - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    if (flip) I.push(a, c, b, b, c, d); else I.push(a, b, c, b, d, c);
  }
  // caps use their own copies of the end rings so the side keeps smooth normals
  const capTris = [];
  if (caps) {
    for (const [j, dir] of [[0, -1], [nr - 1, 1]]) {
      const r = rings[j], v0 = P.length / 3;
      for (let i = 0; i < row; i++) P.push(P[(j * row + i) * 3], P[(j * row + i) * 3 + 1], P[(j * row + i) * 3 + 2]);
      const ci = P.length / 3;
      if (axis === 'y') P.push(r[3] || 0, r[0], r[4] || 0); else P.push(r[3] || 0, r[4] || 0, r[0]);
      const fwd = (dir > 0) === flip;
      for (let i = 0; i < seg; i++) { const a = v0 + i, b = a + 1; if (fwd) capTris.push(ci, b, a); else capTris.push(ci, a, b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I.concat(capTris));
  g.computeVertexNormals();
  // weld the seam normals (first and last column of each ring)
  const N = g.attributes.normal.array;
  for (let j = 0; j < nr; j++) {
    const a = (j * row) * 3, b = (j * row + seg) * 3;
    const x = N[a] + N[b], y = N[a + 1] + N[b + 1], z = N[a + 2] + N[b + 2], l = Math.hypot(x, y, z) || 1;
    N[a] = N[b] = x / l; N[a + 1] = N[b + 1] = y / l; N[a + 2] = N[b + 2] = z / l;
  }
  // flat cap normals
  if (caps) for (let v = nSide; v < P.length / 3; v++) {
    const capEnd = v >= nSide + row + 1 ? 1 : -1, s = axis === 'y' ? 1 : 2;
    N[v * 3] = 0; N[v * 3 + 1] = 0; N[v * 3 + 2] = 0; N[v * 3 + s] = capEnd;
  }
  return g;
}

// A tube along a smooth curve through points (arrays [x, y, z]).
export function hose(pts, r, tubular = 16, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  return new THREE.TubeGeometry(curve, tubular, r, radial, false);
}

// Turn a geometry inside out (reverse the winding and the normals), e.g. the inner wall of a duct.
export function flip(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const ix = geo.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  const n = geo.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return geo;
}

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
export const torus = (R, r, rs = 6, ts = 16, arc = TAU) => new THREE.TorusGeometry(R, r, rs, ts, arc);

// ---------- lit materials ----------
const MATS = new Map();
/**
 * Shared lit material for every surprise mesh (kept for the session: tiny, and re-creating it would
 * recompile its program). Vertex attribute aSurf = (glow, roughness): glow adds the vertex colour as
 * emission (x material uniform uSurGlow); glow >= 100 blinks like a strobe.
 */
export function surMat(key, { rough = 0.6, metal = 0, transparent = false, opacity = 1, side = THREE.FrontSide } = {}) {
  let m = MATS.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, transparent, opacity, side, depthWrite: !transparent });
  m.userData.glow = { value: 1 };
  applyWater(m, {
    key: 'sur-' + key,
    uniforms: { uSurGlow: m.userData.glow },
    vertexHead: 'attribute vec2 aSurf; varying vec2 vSurf;',
    fragmentHead: 'varying vec2 vSurf; uniform float uSurGlow;',
    patch(sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvSurf = aSurf;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (vSurf.y > 0.0) roughnessFactor = vSurf.y;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float g = vSurf.x;
            if (g >= 99.5) g = (g - 100.0) * step(0.94, fract(uTime * 0.75 + vColor.g * 7.0));
            totalEmissiveRadiance += vColor.rgb * g * uSurGlow;
          }`);
    },
  });
  MATS.set(key, m);
  return m;
}

// ---------- volumetric light cones ----------
// The cone mesh only marks the pixels a beam can cover. Each fragment intersects its view ray with the
// cone analytically, clips the segment at the seabed (a plane at the height where the beam meets it, so
// beams fade softly into the floor instead of ending on a hard line) and integrates the in-scattered
// lamp light along it: soft angular edge, inverse-square falloff and water extinction on both paths.
const BEAM_VS = /* glsl */`
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BEAM_FS = /* glsl */`
${WATER_PARS}
uniform vec3 uColor; uniform float uInt; uniform float uLen; uniform float uCos;
uniform vec3 uApex; uniform vec3 uAxis; uniform float uFloorY; uniform float uInside;
varying vec3 vWPos;
void main() {
  vec3 O = cameraPosition, toF = vWPos - O;
  float tf = length(toF);
  vec3 D = toF / tf;
  // march from where the view ray enters the beam mesh (or from the camera when it is inside the beam)
  // to where it leaves the beam's bounding sphere, stopping at the seabed
  float t0 = tf, t1;
  if (!gl_FrontFacing) { if (uInside < 0.5) discard; t0 = 0.0; }
  float tn = sqrt(max(1e-4, 1.0 - uCos * uCos)) / max(uCos, 0.2);
  float R = 0.5 * uLen * sqrt(1.0 + 4.0 * tn * tn) * 1.05;
  vec3 OM = O - (uApex + uAxis * (uLen * 0.5));
  float b = dot(OM, D), c = dot(OM, OM) - R * R, disc = b * b - c;
  if (disc <= 0.0) discard;
  t1 = -b + sqrt(disc);
  if (!gl_FrontFacing) t1 = min(t1, tf);
  if (D.y < -1e-4) t1 = min(t1, (uFloorY - O.y) / D.y);
  if (O.y + D.y * t0 < uFloorY || t1 <= t0) discard;
  vec3 CO = O - uApex;
  float sum = 0.0, dt = (t1 - t0) / float(STEPS), sg = dot(uSigma, vec3(0.3333));
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < STEPS; i++) {
    float t = t0 + dt * (float(i) + jit);
    vec3 X = CO + D * t;
    float l = length(X), h = dot(X, uAxis);
    if (h <= 0.0) continue;
    float edge = smoothstep(uCos, mix(uCos, 1.0, 0.6), h / max(l, 1e-4));
    sum += edge * exp(-sg * (l + t)) / (1.0 + l * l * 0.22) * smoothstep(uLen, uLen * 0.45, h) * smoothstep(0.0, 0.4, l);
  }
  vec3 col = uColor * uInt * sum * dt * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
let _beamGeo = null;
function beamGeometry() {
  if (_beamGeo) return _beamGeo;
  // unit-length open cone along +Z from the origin; the far radius is 1 (scaled per beam); slightly
  // longer and wider than the beam so the analytic volume is never cut by the mesh
  const g = new THREE.CylinderGeometry(0.02, 1, 1, 18, 1, true);
  g.translate(0, -0.5, 0); g.rotateX(-Math.PI / 2);
  _beamGeo = g; return g;
}
const _bv = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bz = new THREE.Vector3(0, 0, 1);
/**
 * A volumetric light cone along local +Z: len (m), half angle (rad), linear colour, intensity.
 * Call update(shape, Oz) each frame (after the parent moved) so the analytic cone follows the mesh.
 */
export class Beam {
  constructor(len, half, color = [1, 0.95, 0.85], intensity = 0.25, steps = 8) {
    this.mat = new THREE.ShaderMaterial({
      defines: { STEPS: steps },
      uniforms: Object.assign({}, U, {
        uColor: { value: new THREE.Color(color[0], color[1], color[2]) }, uInt: { value: intensity }, uLen: { value: len }, uCos: { value: Math.cos(half) },
        uApex: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(0, 0, 1) }, uFloorY: { value: -1e4 }, uInside: { value: 0 },
      }),
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const r = Math.tan(half * 1.15) * len * 1.2;
    this.mesh = new THREE.Mesh(beamGeometry(), this.mat);
    this.mesh.scale.set(r, r, len * 1.2);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    this.base = intensity; this.len = len; this.half = half;
  }
  set(k) { this.mat.uniforms.uInt.value = this.base * k; this.mesh.visible = k > 0.002; }
  /** Sync the analytic cone with the mesh (render space) and find where it meets the seabed. */
  update(shape, camera, Oz) {
    if (!this.mesh.visible) return;
    const m = this.mesh, u = this.mat.uniforms;
    m.updateWorldMatrix(true, false);
    u.uApex.value.setFromMatrixPosition(m.matrixWorld);
    m.matrixWorld.decompose(_bv, _bq, _bv);
    u.uAxis.value.copy(_bz).applyQuaternion(_bq).normalize();
    // the seabed under the beam: march the axis (global coords: z + Oz, s = -z)
    const A = u.uApex.value, X = u.uAxis.value;
    let fy = -1e4;
    for (let t = 0.5; t <= this.len; t += 1) {
      const x = A.x + X.x * t, y = A.y + X.y * t, gz = A.z + X.z * t + Oz, f = shape.floorAt(x, -gz);
      if (f >= y) { fy = f; break; }
      if (t + 1 > this.len) fy = Math.max(fy, f);
    }
    u.uFloorY.value = fy;
    // camera inside the cone?
    const cx = camera.position.x - A.x, cy = camera.position.y - A.y, cz = camera.position.z - A.z, cl = Math.hypot(cx, cy, cz) || 1;
    u.uInside.value = (cx * X.x + cy * X.y + cz * X.z) / cl > u.uCos.value && cl < this.len * 1.2 ? 1 : 0;
  }
  dispose() { this.mat.dispose(); }
}

// How dark the water is around a point (0 = bright sunlit shallows, 1 = night / deep): beams and lamp
// glows scale with it, as real artificial light only stands out where daylight is weak.
export function darkness(y) {
  const l = U.uSunScatter.value * Math.exp(-U.uLightSigma.value.y * Math.max(0, -y));
  return clamp(1 - l / 0.3, 0, 1);
}

// ---------- lamp-lit pool of light on the seabed ----------
const POOL_VS = /* glsl */`
attribute float aI;
varying float vI; varying vec3 vWPos;
void main() {
  vI = aI;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const POOL_FS = /* glsl */`
${WATER_PARS}
uniform vec3 uAlbedo;
varying float vI; varying vec3 vWPos;
void main() {
  float d = length(vWPos - cameraPosition);
  vec3 c = uAlbedo * vI * exp(-uSigma * d);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
/**
 * Light from a vehicle's lamps where it falls on the seabed: a small grid draped on floorAt, with the
 * irradiance of each lamp (cone, inverse square, water extinction) evaluated per vertex on the CPU.
 * Positions are kept relative to the mesh (anchored at the grid centre) for float precision.
 */
export class LightPool {
  constructor(N = 13) {
    this.N = N;
    const g = new THREE.PlaneGeometry(1, 1, N - 1, N - 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('aI', new THREE.BufferAttribute(new Float32Array(N * N), 1));
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { uAlbedo: { value: new THREE.Color(0.6, 0.58, 0.5) } }),
      vertexShader: POOL_VS, fragmentShader: POOL_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }
  /**
   * lamps: array of { x, y, z, dx, dy, dz, cos0, k } in GLOBAL coords (z = -s); cos0 = cosine of the cone
   * half angle, k = strength. shape: WorldShape. Centre (cx, cz) and half size h of the area to cover.
   */
  update(shape, lamps, n, cx, cz, h, gain) {
    const N = this.N, pos = this.geo.attributes.position.array, I = this.geo.attributes.aI.array;
    const sig = U.uSigma.value;
    const sg = (sig.x + sig.y + sig.z) / 3;
    let any = 0;
    const y0 = shape.floorAt(cx, -cz);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = cx + (i / (N - 1) - 0.5) * 2 * h, z = cz + (j / (N - 1) - 0.5) * 2 * h;
      const y = shape.floorAt(x, -z) + 0.05;
      pos[k * 3] = x - cx; pos[k * 3 + 1] = y - y0; pos[k * 3 + 2] = z - cz;
      let e = 0;
      for (let l = 0; l < n; l++) {
        const L = lamps[l], vx = x - L.x, vy = y - L.y, vz = z - L.z, d2 = vx * vx + vy * vy + vz * vz, d = Math.sqrt(d2) || 1e-3;
        const c = (vx * L.dx + vy * L.dy + vz * L.dz) / d;
        if (c <= L.cos0) continue;
        const cone = sstep(L.cos0, L.cos0 + (1 - L.cos0) * 0.6, c);
        e += L.k * cone * Math.max(0.15, -vy / d) * Math.exp(-sg * d) / (1 + 0.12 * d2);
      }
      // fade the grid edge so the pool never shows a border
      const ex = Math.abs(i / (N - 1) - 0.5) * 2, ez = Math.abs(j / (N - 1) - 0.5) * 2;
      e *= 1 - sstep(0.7, 1, Math.max(ex, ez));
      I[k] = e * gain; any = Math.max(any, e);
    }
    this.mesh.position.set(cx, y0, cz);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aI.needsUpdate = true;
    this.mesh.visible = any * gain > 0.004;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// ---------- skinned rigs ----------
/** Bones from [name, parentIndex, x, y, z] (bind positions are ABSOLUTE in the mesh frame). */
export function makeBones(spec) {
  const bones = [];
  for (const [name, parent, x, y, z] of spec) {
    const b = new THREE.Bone(); b.name = name;
    b.userData.abs = [x, y, z];
    if (parent >= 0) {
      const pa = bones[parent].userData.abs;
      b.position.set(x - pa[0], y - pa[1], z - pa[2]);
      bones[parent].add(b);
    } else b.position.set(x, y, z);
    bones.push(b);
  }
  return bones;
}
/** SkinnedMesh bound to bones (bind pose = current pose); a fixed bounding sphere avoids per-vertex work. */
export function skinned(geo, mat, bones, radius) {
  const m = new THREE.SkinnedMesh(geo, mat);
  m.add(bones[0]);
  m.updateMatrixWorld(true);
  m.bind(new THREE.Skeleton(bones));
  m.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
  m.frustumCulled = true;
  return m;
}

// Dispose every geometry under an object (materials are shared and kept, beams/pools dispose themselves).
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && o.geometry !== _beamGeo && !o.userData.keepGeo) o.geometry.dispose();
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
  });
}
