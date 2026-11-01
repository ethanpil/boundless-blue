// Particles for the surprise encounters, in one instanced draw call: exhaled / vented bubbles (round
// glints and big wobbling mushroom caps that expand as they rise and vanish at the surface or a cave
// ceiling), lamp flares (re-queued every frame), camera-strobe flashes and puffs of silt.
// Premultiplied-alpha blending lets glowing (additive) and darkening (silt) particles share the call.
// Positions are relative to a floating anchor (float precision on endless journeys). Idle cost: zero
// (the mesh is hidden and update() returns at once when nothing is alive).
import * as THREE from 'three';
import { WATER_PARS } from '../water.js';

export const K = { BUBBLE: 0, CAP: 1, GLOW: 2, SILT: 3 };

const VS = /* glsl */`
uniform float uTime;
attribute vec4 iPos;   // xyz relative to the anchor, size (m)
attribute vec4 iCol;   // rgb, alpha
attribute vec4 iAux;   // kind, wobble phase, wobble amount, -
varying vec2 vUv; varying vec4 vCol; varying float vKind; varying vec3 vWPos;
void main() {
  vUv = position.xy; vCol = iCol; vKind = iAux.x;
  vec3 c = (modelMatrix * vec4(iPos.xyz, 1.0)).xyz;
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 q = position.xy;
  if (iAux.x > 0.5 && iAux.x < 1.5) {
    // mushroom caps stay upright (world up) and wobble as they rise
    r = normalize(vec3(r.x, 0.0, r.z) + vec3(1e-4, 0.0, 0.0)); u = vec3(0.0, 1.0, 0.0);
    float w = sin(uTime * 8.0 + iAux.y) * iAux.z;
    q.x *= 1.0 + w; q.y *= 1.0 - 0.8 * w;
  } else if (iAux.x < 0.5) {
    float w = sin(uTime * 13.0 + iAux.y) * iAux.z;
    q.x *= 1.0 + w; q.y *= 1.0 - w;
  }
  vec3 wp = c + (r * q.x + u * q.y) * iPos.w;
  vWPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FS = /* glsl */`
${WATER_PARS}
varying vec2 vUv; varying vec4 vCol; varying float vKind; varying vec3 vWPos;
void main() {
  vec2 p = vUv; float r = length(p);
  int k = int(vKind + 0.5);
  vec3 sky = waterColor(vec3(0.0, 1.0, 0.0));
  vec3 rgb; float a;
  if (k == 0) {          // small bubble: a silvery rim (total internal reflection) and a highlight
    if (r > 1.0) discard;
    float rim = smoothstep(0.5, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
    vec2 h = p - vec2(-0.3, 0.38); float sp = exp(-dot(h, h) * 26.0);
    rgb = (sky * 1.6 + vec3(0.1)) * (rim * 0.8 + sp * 1.2 + 0.06) * vCol.a; a = (rim * 0.3 + 0.06) * vCol.a;
  } else if (k == 1) {   // spherical-cap bubble: domed top, flat wavy base
    vec2 q = vec2(p.x, p.y * 1.3 + 0.12); float rr = length(q);
    float base = -0.38 + 0.07 * cos(p.x * 6.0 + vCol.r * 9.0);
    if (rr > 1.0 || p.y < base) discard;
    float rim = smoothstep(0.62, 0.95, rr) + 0.8 * (1.0 - smoothstep(0.0, 0.08, p.y - base));
    vec2 h = p - vec2(-0.25, 0.45); float sp = exp(-dot(h, h) * 18.0);
    rgb = (sky * 1.5 + vec3(0.1)) * (clamp(rim, 0.0, 1.0) * 0.75 + sp * 1.1 + 0.05) * vCol.a; a = (rim * 0.25 + 0.05) * vCol.a;
  } else if (k == 2) {   // soft additive glow (lamp flares, strobe flashes)
    rgb = vCol.rgb * (exp(-r * r * 7.0) + 0.18 * exp(-r * r * 1.6)) * vCol.a; a = 0.0;
  } else {               // silt: a soft lumpy cloud that darkens and takes the water colour
    float g = smoothstep(1.0, 0.1, r) * (0.75 + 0.25 * sin(p.x * 5.0 + p.y * 4.0 + vCol.r * 30.0));
    a = vCol.a * g; rgb = vCol.rgb * a;
  }
  vec3 toP = vWPos - cameraPosition; float dist = length(toP);
  vec3 T = exp(-uSigma * dist);
  if (k == 3) rgb = rgb * T + waterColor(toP / max(dist, 1e-4)) * (1.0 - T) * a;
  else { rgb *= T; a *= dot(T, vec3(0.3333)); }
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SurpriseFX {
  constructor(world, U, max = 900) {
    this.world = world; this.MAX = max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = mk('iPos'); this.aCol = mk('iCol'); this.aAux = mk('iAux');
    this._attrs = [this.aPos, this.aCol, this.aAux];
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const m = new THREE.Mesh(g, this.mat);
    m.frustumCulled = false; m.renderOrder = 5; m.name = 'surprise-fx'; m.matrixAutoUpdate = false; m.visible = false;
    this.mesh = m; world.add(m);
    this.anchorZ = 0; this.n = 0;
    this.P = new Float32Array(max * 3); this.V = new Float32Array(max * 3);
    this.T = new Float32Array(max * 4);   // age, life, size0, size1
    this.C = new Float32Array(max * 4);   // r, g, b, alpha
    this.A = new Float32Array(max * 4);   // kind, wobble phase, wobble amount, kill height (global y)
    this.M = new Float32Array(max * 2);   // drag, rise speed (bubbles) / buoyancy
    this.flares = new Float32Array(64 * 8); this.nf = 0;
    this._seed = 7;
  }
  rnd() { this._seed = (this._seed * 16807) % 2147483647; return this._seed / 2147483647; }
  get busy() { return this.n > 0 || this.nf > 0; }

  // ---------- emission (GLOBAL coordinates, z = -s) ----------
  emit(kind, x, y, z, vx, vy, vz, s0, s1, life, r, g, b, a, drag, rise, wob, killY) {
    if (this.n >= this.MAX) return;
    if (this.n === 0 && this.nf === 0) this.anchorZ = Math.round(z / 64) * 64;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.P[i3] = x; this.P[i3 + 1] = y; this.P[i3 + 2] = z - this.anchorZ;
    this.V[i3] = vx; this.V[i3 + 1] = vy; this.V[i3 + 2] = vz;
    this.T[i4] = 0; this.T[i4 + 1] = life; this.T[i4 + 2] = s0; this.T[i4 + 3] = s1;
    this.C[i4] = r; this.C[i4 + 1] = g; this.C[i4 + 2] = b; this.C[i4 + 3] = a;
    this.A[i4] = kind; this.A[i4 + 1] = this.rnd() * 6.283; this.A[i4 + 2] = wob; this.A[i4 + 3] = killY;
    this.M[i * 2] = drag; this.M[i * 2 + 1] = rise;
  }
  /**
   * A breath / vent burst at (x, y, z): n bubbles plus a few big caps. killY = the height where they
   * vanish (water surface, or the cave / ice ceiling above the source). vx/vz = drift of the source.
   */
  burst(x, y, z, n, spread, killY, caps = 2, vx = 0, vz = 0, scale = 1) {
    for (let k = 0; k < n; k++) {
      const s = (0.008 + Math.pow(this.rnd(), 2.0) * 0.024) * scale;
      this.emit(K.BUBBLE, x + (this.rnd() - 0.5) * spread, y + (this.rnd() - 0.5) * spread, z + (this.rnd() - 0.5) * spread,
        vx * 0.5 + (this.rnd() - 0.5) * 0.25, 0.15 + this.rnd() * 0.25, vz * 0.5 + (this.rnd() - 0.5) * 0.25,
        s, s, 40, 1, 1, 1, 0.9, 1.6, 0.18 + s * 9 + this.rnd() * 0.12, 0.12, killY);
    }
    for (let k = 0; k < caps; k++) {
      const s = (0.03 + this.rnd() * 0.045) * scale;
      this.emit(K.CAP, x + (this.rnd() - 0.5) * spread, y + (this.rnd() - 0.5) * spread * 0.5, z + (this.rnd() - 0.5) * spread,
        vx * 0.5, 0.2, vz * 0.5, s, s, 40, this.rnd(), 1, 1, 1, 1.2, 0.32 + s * 4 + this.rnd() * 0.1, 0.16, killY);
    }
  }
  silt(x, y, z, n, spread, r = 0.16, g = 0.14, b = 0.11) {
    for (let k = 0; k < n; k++) {
      const a = this.rnd() * 6.283, sp = 0.1 + this.rnd() * 0.35;
      this.emit(K.SILT, x + (this.rnd() - 0.5) * spread, y + this.rnd() * spread * 0.3, z + (this.rnd() - 0.5) * spread,
        Math.cos(a) * sp, 0.05 + this.rnd() * 0.12, Math.sin(a) * sp, spread * 0.25, spread * (0.9 + this.rnd()), 5 + this.rnd() * 4,
        r, g, b, 0.55, 0.9, 0, 0, 1e9);
    }
  }
  flash(x, y, z, size, r = 1, g = 1, b = 1, life = 0.16) { this.emit(K.GLOW, x, y, z, 0, 0, 0, size, size * 1.3, life, r, g, b, 1, 0, 0, 0, 1e9); }
  // a glow drawn this frame only (lamp heads, viewports, eyes): call every frame while it should show
  flare(x, y, z, size, r, g, b, a = 1) {
    if (this.nf >= 64 || a <= 0.002) return;
    if (this.n === 0 && this.nf === 0) this.anchorZ = Math.round(z / 64) * 64;
    const f = this.flares, o = this.nf++ * 8;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = size; f[o + 4] = r; f[o + 5] = g; f[o + 6] = b; f[o + 7] = a;
  }

  // ---------- simulation ----------
  update(dt, camZ) {
    if (this.n === 0 && this.nf === 0) { if (this.mesh.visible) { this.mesh.visible = false; this.geo.instanceCount = 0; } return; }
    const want = Math.round(camZ / 64) * 64;
    if (Math.abs(want - this.anchorZ) > 128) { // re-anchor (precision)
      const d = this.anchorZ - want;
      for (let i = 0; i < this.n; i++) this.P[i * 3 + 2] += d;
      this.anchorZ = want;
    }
    this.mesh.position.z = this.anchorZ; this.mesh.updateMatrix();
    const P = this.P, V = this.V, T = this.T, C = this.C, A = this.A, M = this.M;
    const AP = this.aPos.array, AC = this.aCol.array, AA = this.aAux.array;
    let i = 0;
    while (i < this.n) {
      const i3 = i * 3, i4 = i * 4;
      T[i4] += dt;
      const kind = A[i4];
      if (T[i4] >= T[i4 + 1] || P[i3 + 1] >= A[i4 + 3]) { this._kill(i); continue; }
      const drag = 1 - Math.min(1, M[i * 2] * dt);
      V[i3] *= drag; V[i3 + 2] *= drag;
      if (kind <= K.CAP) {
        // bubbles accelerate to their rise speed, zig-zag, and grow as the pressure drops
        V[i3 + 1] += (M[i * 2 + 1] - V[i3 + 1]) * Math.min(1, dt * 2.5);
        const w = T[i4] * (kind === K.CAP ? 2.2 : 5.5) + A[i4 + 1];
        P[i3] += Math.sin(w) * (kind === K.CAP ? 0.07 : 0.05) * dt * 3;
        P[i3 + 2] += Math.cos(w * 0.87) * (kind === K.CAP ? 0.07 : 0.05) * dt * 3;
        const g = 1 + V[i3 + 1] * dt / (3 * (10 + Math.max(0, -P[i3 + 1]))); // r ~ (p0 / p)^(1/3)
        T[i4 + 2] *= g; T[i4 + 3] *= g;
      } else V[i3 + 1] = V[i3 + 1] * drag + M[i * 2 + 1] * dt;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      const f = T[i4] / T[i4 + 1];
      const env = kind === K.GLOW ? (1 - f) * (1 - f)
        : kind === K.SILT ? (1 - f) * Math.min(1, T[i4] * 3)
        : Math.min(1, T[i4] * 6) * (1 - Math.max(0, (f - 0.85) / 0.15)) * Math.min(1, (A[i4 + 3] - P[i3 + 1]) * 4 + 0.2);
      const size = kind <= K.CAP ? T[i4 + 2] : T[i4 + 2] + (T[i4 + 3] - T[i4 + 2]) * Math.sqrt(f);
      AP[i4] = P[i3]; AP[i4 + 1] = P[i3 + 1]; AP[i4 + 2] = P[i3 + 2]; AP[i4 + 3] = size;
      AC[i4] = C[i4]; AC[i4 + 1] = C[i4 + 1]; AC[i4 + 2] = C[i4 + 2]; AC[i4 + 3] = C[i4 + 3] * env;
      AA[i4] = kind; AA[i4 + 1] = A[i4 + 1]; AA[i4 + 2] = A[i4 + 2]; AA[i4 + 3] = 0;
      i++;
    }
    // this frame's flares after the simulated particles
    let n = this.n;
    const F = this.flares;
    for (let k = 0; k < this.nf && n < this.MAX; k++, n++) {
      const o = k * 8, i4 = n * 4;
      AP[i4] = F[o]; AP[i4 + 1] = F[o + 1]; AP[i4 + 2] = F[o + 2] - this.anchorZ; AP[i4 + 3] = F[o + 3];
      AC[i4] = F[o + 4]; AC[i4 + 1] = F[o + 5]; AC[i4 + 2] = F[o + 6]; AC[i4 + 3] = F[o + 7];
      AA[i4] = K.GLOW; AA[i4 + 1] = 0; AA[i4 + 2] = 0; AA[i4 + 3] = 0;
    }
    this.nf = 0;
    this.geo.instanceCount = n;
    for (let k = 0; k < 3; k++) { const a = this._attrs[k]; a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    this.mesh.visible = n > 0;
  }
  _kill(i) { // swap-remove
    const j = --this.n;
    if (i === j) return;
    this.P.copyWithin(i * 3, j * 3, j * 3 + 3); this.V.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.T.copyWithin(i * 4, j * 4, j * 4 + 4); this.C.copyWithin(i * 4, j * 4, j * 4 + 4); this.A.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.M.copyWithin(i * 2, j * 2, j * 2 + 2);
  }
  clear() { this.n = 0; this.nf = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
  dispose() { this.world.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
}
