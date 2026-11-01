// Small particle effects for the creatures: bubble rings, ink clouds, bubble nets, bioluminescent
// sparks and eye-shine. One instanced draw call; premultiplied-alpha blending lets glowing (additive)
// and darkening (ink) particles share it. Positions are kept relative to a floating anchor.
import * as THREE from 'three';
import { WATER_PARS } from '../water.js';

const MAX = 1024;
export const FXK = { GLOW: 0, INK: 1, BUBBLE: 2, RING: 3, GLINT: 4 };

const VS = /* glsl */`
attribute vec4 iPos;   // x, y, z (relative to the fx anchor), size (m)
attribute vec4 iCol;   // rgb, alpha
attribute vec4 iDir;   // ring axis xyz, kind
varying vec2 vUv; varying vec4 vCol; varying float vKind; varying vec3 vWPos;
void main() {
  vUv = position.xy; vCol = iCol; vKind = iDir.w;
  vec3 c = (modelMatrix * vec4(iPos.xyz, 1.0)).xyz;
  vec3 wp;
  if (iDir.w > 2.5 && iDir.w < 3.5) { // ring: a quad across its direction of travel
    vec3 n = normalize(iDir.xyz + vec3(1e-4, 0.0, 0.0));
    vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    wp = c + (t1 * position.x + cross(n, t1) * position.y) * iPos.w;
  } else { // camera-facing
    vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = c + (r * position.x + u * position.y) * iPos.w;
  }
  vWPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FS = /* glsl */`
${WATER_PARS}
varying vec2 vUv; varying vec4 vCol; varying float vKind; varying vec3 vWPos;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  int k = int(vKind + 0.5);
  vec3 rgb; float a; // premultiplied colour; alpha = how much of what is behind gets covered
  vec3 sky = waterColor(vec3(0.0, 1.0, 0.0));
  // bubbles are silvery mirrors of the light around them: white-ish by day, dim at night (a little lamp glint near the lens)
  float lit = clamp(uSunScatter * exp(-uLightSigma.g * max(0.0, uSurfaceY - vWPos.y)) + 0.3 * uLamp * exp(-0.15 * length(vWPos - cameraPosition)), 0.0, 1.0);
  vec3 silver = mix(sky, vec3(0.85, 0.9, 0.95) * lit, 0.6);
  if (k == 0) {         // soft glow (bioluminescence)
    rgb = vCol.rgb * exp(-r * r * 5.0) * vCol.a; a = 0.0;
  } else if (k == 1) {  // ink: soft, lumpy, darkening
    float g = smoothstep(1.0, 0.15, r) * (0.75 + 0.25 * sin(vUv.x * 5.0 + vUv.y * 4.0 + vCol.a * 7.0));
    a = vCol.a * g; rgb = vCol.rgb * a;
  } else if (k == 2) {  // bubble: bright rim and a highlight, nearly clear inside
    float rim = smoothstep(0.6, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
    vec2 h = vUv - vec2(-0.35, 0.4);
    float sp = exp(-dot(h, h) * 30.0);
    rgb = silver * (rim * 0.55 + sp * 0.9) * vCol.a; a = rim * 0.15 * vCol.a;
  } else if (k == 3) {  // bubble ring (torus seen through its quad)
    float d = abs(r - 0.72), tube = 1.0 - smoothstep(0.07, 0.19, d);
    float hl = (1.0 - smoothstep(0.0, 0.07, d)) * (0.55 + 0.45 * vUv.y);
    rgb = silver * 0.9 * (tube * 0.4 + hl * 0.7) * vCol.a; a = tube * 0.1 * vCol.a;
  } else {              // eye-shine glint
    rgb = vCol.rgb * (exp(-r * r * 40.0) + 0.25 * exp(-r * r * 6.0)) * vCol.a; a = 0.0;
  }
  vec3 toP = vWPos - cameraPosition; float dist = length(toP);
  vec3 T = exp(-uSigma * dist);
  if (k == 1) rgb = rgb * T + waterColor(toP / max(dist, 1e-4)) * (1.0 - T) * a;
  else { rgb *= T; a *= dot(T, vec3(0.3333)); }
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class FX {
  constructor(world, U) {
    this.world = world;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = mk('iPos'); this.aCol = mk('iCol'); this.aDir = mk('iDir');
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const m = new THREE.Mesh(g, this.mat);
    m.frustumCulled = false; m.renderOrder = 4; m.name = 'creature-fx';
    m.matrixAutoUpdate = false;
    this.mesh = m; world.add(m);
    this.anchorZ = 0; this.n = 0;
    // particle state (struct of arrays)
    this.P = new Float32Array(MAX * 3); this.V = new Float32Array(MAX * 3);
    this.T = new Float32Array(MAX * 4);   // age, life, size0, size1
    this.C = new Float32Array(MAX * 4);   // r, g, b, alpha
    this.D = new Float32Array(MAX * 4);   // axis xyz, kind
    this.M = new Float32Array(MAX * 2);   // drag, buoyancy
    this.emitters = [];
    this._seed = 1;
  }
  rnd() { this._seed = (this._seed * 16807) % 2147483647; return this._seed / 2147483647; }

  // ---------- emission (global coordinates, z = -s) ----------
  emit(kind, x, y, z, vx, vy, vz, s0, s1, life, r, g, b, a, drag = 0, buoy = 0, ax = 0, ay = 1, az = 0) {
    if (this.n >= MAX) return;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.P[i3] = x; this.P[i3 + 1] = y; this.P[i3 + 2] = z - this.anchorZ;
    this.V[i3] = vx; this.V[i3 + 1] = vy; this.V[i3 + 2] = vz;
    this.T[i4] = 0; this.T[i4 + 1] = life; this.T[i4 + 2] = s0; this.T[i4 + 3] = s1;
    this.C[i4] = r; this.C[i4 + 1] = g; this.C[i4 + 2] = b; this.C[i4 + 3] = a;
    this.D[i4] = ax; this.D[i4 + 1] = ay; this.D[i4 + 2] = az; this.D[i4 + 3] = kind;
    this.M[i * 2] = drag; this.M[i * 2 + 1] = buoy;
  }
  glow(x, y, z, size, life, r, g, b, a = 1, vx = 0, vy = 0, vz = 0) { this.emit(FXK.GLOW, x, y, z, vx, vy, vz, size, size * 1.3, life, r, g, b, a, 1.5); }
  glint(x, y, z, size, life, r, g, b) { this.emit(FXK.GLINT, x, y, z, 0, 0, 0, size, size, life, r, g, b, 1); }
  ink(x, y, z, size) { // a puff of ink: a dozen dark blobs spreading and thinning out
    for (let k = 0; k < 14; k++) {
      const a = this.rnd() * 6.283, e = (this.rnd() - 0.5) * 2, sp = 0.15 + this.rnd() * 0.5;
      this.emit(FXK.INK, x + (this.rnd() - 0.5) * size * 0.2, y + (this.rnd() - 0.5) * size * 0.2, z + (this.rnd() - 0.5) * size * 0.2,
        Math.cos(a) * sp, e * sp * 0.6 + 0.05, Math.sin(a) * sp, size * (0.15 + this.rnd() * 0.1), size * (0.9 + this.rnd() * 0.9), 4 + this.rnd() * 3,
        0.03, 0.022, 0.016, 0.85, 0.9, 0.02);
    }
  }
  ring(x, y, z, ax, ay, az) { // a dolphin's bubble ring: drifts forward, rises and widens
    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    this.emit(FXK.RING, x, y, z, ax * 0.7, 0.25, az * 0.7, 0.12, 0.55, 5, 1, 1, 1, 1, 0.35, 0.05, ax, ay * 0.3 + 0.7, az);
  }
  bubbles(x, y, z, n, spread, rise = 0.8) {
    for (let k = 0; k < n; k++) {
      const s = 0.012 + this.rnd() * 0.03;
      this.emit(FXK.BUBBLE, x + (this.rnd() - 0.5) * spread, y + (this.rnd() - 0.5) * spread, z + (this.rnd() - 0.5) * spread,
        0, rise * (0.6 + this.rnd() * 0.6), 0, s, s * 1.4, 10 + this.rnd() * 6, 1, 1, 1, 1, 0.2, 0.04);
    }
  }
  // humpback bubble net: a ring of rising bubble curtains blown in a spiral from below
  bubbleNet(x, y, z, r, dur) { this.emitters.push({ type: 'net', x, y, z, r, t: 0, dur, acc: 0 }); }

  // ---------- simulation ----------
  update(dt, camS) {
    const want = Math.round(-camS / 64) * 64;
    if (Math.abs(want - this.anchorZ) > 128) { // re-anchor (precision)
      const d = this.anchorZ - want;
      for (let i = 0; i < this.n; i++) this.P[i * 3 + 2] += d;
      this.anchorZ = want;
    }
    this.mesh.position.z = this.anchorZ; this.mesh.updateMatrix();
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      e.t += dt; e.acc += dt * 40;
      while (e.acc >= 1) { // the whale circles and blows: bubbles appear along the growing spiral
        e.acc -= 1;
        const a = (e.t / e.dur) * 6.283 * 1.15 + this.rnd() * 0.15, rr = e.r * (0.85 + this.rnd() * 0.2);
        for (let k = 0; k < 2; k++) { // clouds of fine bubbles (each sprite stands for many)
          const sz = 0.08 + this.rnd() * 0.2;
          this.emit(FXK.BUBBLE, e.x + Math.cos(a) * rr + (this.rnd() - 0.5) * 0.8, e.y + (this.rnd() - 0.5) * 0.8, e.z + Math.sin(a) * rr + (this.rnd() - 0.5) * 0.8,
            0, 0.7 + this.rnd() * 0.5, 0, sz, sz * 1.8, 12 + this.rnd() * 5, 1, 1, 1, 0.8, 0.2, 0.03);
        }
      }
      if (e.t >= e.dur) this.emitters.splice(k, 1);
    }
    if (dt <= 0 && !this.n) { this.geo.instanceCount = 0; return; }
    const P = this.P, V = this.V, T = this.T, C = this.C, D = this.D, M = this.M;
    const AP = this.aPos.array, AC = this.aCol.array, AD = this.aDir.array;
    let i = 0;
    while (i < this.n) {
      const i3 = i * 3, i4 = i * 4;
      T[i4] += dt;
      if (T[i4] >= T[i4 + 1]) { this._kill(i); continue; }
      const drag = 1 - Math.min(1, M[i * 2] * dt);
      V[i3] *= drag; V[i3 + 1] = V[i3 + 1] * drag + M[i * 2 + 1] * dt; V[i3 + 2] *= drag;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      const kind = D[i4 + 3], f = T[i4] / T[i4 + 1];
      if (kind === FXK.BUBBLE) { const w = T[i4] * 7 + i; P[i3] += Math.sin(w) * 0.05 * dt; P[i3 + 2] += Math.cos(w * 0.9) * 0.05 * dt; if (P[i3 + 1] > -0.05) { this._kill(i); continue; } }
      const env = kind === FXK.GLOW ? Math.sin(Math.PI * Math.min(1, f * 1.4)) * (1 - f * 0.4)
        : kind === FXK.INK ? (1 - f) * (1 - f) * Math.min(1, T[i4] * 4)
        : kind === FXK.GLINT ? Math.min(1, T[i4] * 3) * Math.min(1, (T[i4 + 1] - T[i4]) * 2) * (0.85 + 0.15 * Math.sin(T[i4] * 9 + i))
        : (1 - f) * Math.min(1, T[i4] * 3);
      const size = T[i4 + 2] + (T[i4 + 3] - T[i4 + 2]) * Math.sqrt(f);
      AP[i4] = P[i3]; AP[i4 + 1] = P[i3 + 1]; AP[i4 + 2] = P[i3 + 2]; AP[i4 + 3] = size;
      AC[i4] = C[i4]; AC[i4 + 1] = C[i4 + 1]; AC[i4 + 2] = C[i4 + 2]; AC[i4 + 3] = C[i4 + 3] * env;
      AD[i4] = D[i4]; AD[i4 + 1] = D[i4 + 1]; AD[i4 + 2] = D[i4 + 2]; AD[i4 + 3] = kind;
      i++;
    }
    this.geo.instanceCount = this.n;
    for (const a of [this.aPos, this.aCol, this.aDir]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; }
    this.mesh.visible = this.n > 0;
  }
  _kill(i) { // swap-remove
    const j = --this.n;
    if (i === j) return;
    this.P.copyWithin(i * 3, j * 3, j * 3 + 3); this.V.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.T.copyWithin(i * 4, j * 4, j * 4 + 4); this.C.copyWithin(i * 4, j * 4, j * 4 + 4); this.D.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.M.copyWithin(i * 2, j * 2, j * 2 + 2);
  }
  dispose() { this.world.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
}
