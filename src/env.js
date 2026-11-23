// Ambient environment: water-volume background, the surface seen from below (Snell's window),
// and drifting marine snow / bioluminescent motes.
import * as THREE from 'three';
import { U, WATER_PARS, SWELL_GLSL, waterQuality } from './water.js';
import { currentPreset } from './quality.js';

const WORLD_VERT = /* glsl */`
varying vec3 vWPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export class Background {
  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: WORLD_VERT,
      fragmentShader: /* glsl */`
        varying vec3 vWPos;
        ${WATER_PARS}
        void main() {
          vec3 dir = normalize(vWPos - cameraPosition);
          gl_FragColor = vec4(waterColor(dir), 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16), mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }
  update(camera) { this.mesh.position.copy(camera.position); }
}

export class Surface {
  constructor() {
    this.uniforms = Object.assign({}, U, {
      uBoat: { value: new THREE.Vector4(0, 0, 1, 0) },    // render x, z, heading cos, sin
      uBoatDim: { value: new THREE.Vector3(5, 1.4, 0) },  // half length, half width, opacity
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: { WQ: waterQuality() },
      vertexShader: WORLD_VERT,
      fragmentShader: /* glsl */`
        varying vec3 vWPos;
        uniform vec4 uBoat;
        uniform vec3 uBoatDim;
        ${WATER_PARS}
        // expanding raindrop rings on the surface (cells of 0.8 m; 1024 / 0.8 is whole, so seamless)
        vec2 rainGrad(vec2 q, float t) {
          vec2 g = vec2(0.0);
          vec2 cell = floor(q / 0.8);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 c = cell + vec2(float(i), float(j));
            vec2 h = fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453);
            vec2 center = (c + h) * 0.8;
            float ph = fract(t * 0.85 + h.x * 7.0 + h.y * 3.0);
            vec2 dv = q - center;
            float d = length(dv), r = ph * 0.45;
            float ring = exp(-pow((d - r) / 0.04, 2.0)) * (1.0 - ph) * (1.0 - ph);
            g += dv / max(d, 1e-3) * ring * sin((d - r) * 55.0);
          }
          return g;
        }
        void main() {
          vec3 V = normalize(vWPos - cameraPosition);
          vec2 q = vWPos.xz;
          float t = uTime;
          // swell, chop and ripples; the middle octave is rotated (atan 3/4, still 1024 m periodic) so layers never align
          vec2 g1 = (texture2D(uNoiseTex, q / 32.0 + vec2(t * 0.011, t * 0.007)).rg - 0.5) * 1.3;
          vec2 g2 = (texture2D(uNoiseTex, mat2(0.8, 0.6, -0.6, 0.8) * q * 0.09765625 - vec2(t * 0.023, -t * 0.017)).ba - 0.5) * 0.7;
          float rough = 1.0 + 1.6 * uSurge;
          vec2 g3 = texture2D(uNoiseTex, q / 2.0 + vec2(-t * 0.05, t * 0.04)).rg - 0.5;
          vec2 g = (g1 + g2 + g3 * 0.25) * rough;
          float dist = length(vWPos - cameraPosition);
          float distFade = exp(-dist * 0.012);
          vec2 gr = vec2(0.0);
          if (uRain > 0.01) { gr = rainGrad(q, t) * 0.9 * uRain * exp(-dist * 0.03); g += gr; }
          vec3 N = normalize(vec3(g.x * 0.55 * distFade, -1.0, g.y * 0.55 * distFade));
          vec3 R = reflect(V, N);
          // total internal reflection mirrors the lit seabed in shallow water
          float shallow = exp(-max(0.0, -cameraPosition.y) * 0.12) * smoothstep(45.0, 10.0, uFloorDist);
          vec3 refl = mix(waterColor(R), uFloorCol, shallow * smoothstep(-0.05, -0.5, R.y) * 0.8);
          refl *= 0.75 + 0.6 * (g.x + 0.5 * g.y);
          // Silver sheen: ripple faces tilted toward the bright water above (and the window) catch light, so the
          // mirror reads as a moving, rippled ceiling instead of flat blue. It fades with distance like the ripples.
          float sheen = smoothstep(0.1, 0.55, g.x * 0.8 + g.y * 0.6) * distFade;
#if WQ > 0
          // medium and up: the crests of the coarse caustic network sharpen it into bright filaments
          sheen *= 0.6 + 1.2 * texture2D(uCaustics, q * 0.125 + g * 0.05).g;
#endif
          refl += (uWaterUp * 0.7 + uSunColor * 0.25) * uSunScatter * sheen * 0.35;
          // glitter: small ripple facets tipped toward the sun flash, mostly looking toward it; none under cloud
          vec2 sd = normalize(uSunDir.xz + vec2(1e-4));
          float glint = pow(clamp(dot(g3 + 0.3 * g2, sd) * 2.6, 0.0, 1.0), 10.0)
            * (0.35 + 0.65 * max(dot(normalize(V.xz + vec2(1e-4)), sd), 0.0)) * distFade * (1.0 - 0.85 * uCloud);
          refl += uSunColor * uSunScatter * glint * 2.5;
          vec3 col = refl;
          // Snell's window: the sky squeezed into a 97 degree cone (critical angle 48.6 deg, cos 0.6614).
          // Its rim follows the smoothed waves (swell and half the chop) and fades over ~5 degrees, so the
          // ripples cannot cut it into hard-edged patches. Transmission is the Schlick term on the air side.
          // rain rings make the rim jitter, and a storm's chop breaks it up further (both already computed above)
          vec2 gw = (g1 + 0.5 * g2 + 0.5 * uSurge * g3) * rough * 0.55 * distFade + gr * 0.5;
          float ciW = -dot(V, normalize(vec3(gw.x, -1.0, gw.y)));
          float ctW = sqrt(max(0.0, 1.0 - 1.777 * (1.0 - ciW * ciW)));   // cos of the air-side angle, 0 at the rim
          float win = smoothstep(0.6614, 0.712 + 2.0 * fwidth(ciW), ciW) * (0.98 - 0.98 * pow(1.0 - ctW, 5.0));
          if (win > 0.001) {
            // the full wave normal steers what is seen through the window; through total internal reflection the
            // direction stays continuous (it grazes the surface), so the sky content never tears
            float ci = -dot(V, N);
            float ct = sqrt(max(0.0, 1.0 - 1.777 * (1.0 - ci * ci)));
            vec3 Tg = normalize(1.333 * V + (1.333 * ci - ct) * N);
            vec3 sA = vec3(uSunDir.x * 1.333, 0.0, uSunDir.z * 1.333);   // the sun's direction in the air
            sA.y = sqrt(max(0.0, 1.0 - dot(sA.xz, sA.xz)));
            float hy = clamp(Tg.y, 0.0, 1.0);
            // kept below white so the window reads as blue sky with white clouds and the sun's glitter on top
            vec3 sky = mix(vec3(0.5, 0.7, 0.92), vec3(0.08, 0.27, 0.72), sqrt(hy)) * 0.85;
            sky = mix(sky, sky * uSunColor * 1.25, 0.6);    // warm skies at dusk, silver under the moon
            sky *= 1.0 - 0.8 * uNight;                      // a moonlit sky is a dim one: moon and stars carry it
            // clouds drifting across the window (direction based: they sit at infinity)
            vec2 cu = Tg.xz / max(Tg.y, 0.12) * 0.3 + vec2(t * 0.0035, t * 0.002);
            float cn = texture2D(uNoiseTex, cu).g * 0.7 + texture2D(uNoiseTex, cu * 2.7 + 0.31).b * 0.45;
            float cl = smoothstep(0.62 - 0.3 * uCloud, 0.86 - 0.2 * uCloud, cn) * smoothstep(0.02, 0.25, Tg.y);
            vec3 cloudC = mix(vec3(1.0), vec3(0.55, 0.58, 0.63), max(uRain, uCloud * 0.6)) * mix(vec3(1.0), uSunColor, 0.7) * 1.45;
            sky = mix(sky, cloudC * (1.0 - 0.75 * uNight), cl * 0.9);
            float sunD = max(dot(Tg, sA), 0.0);
            sky += uSunColor * (pow(sunD, 900.0) * 80.0 + pow(sunD, 24.0) * 1.4) * (1.0 - 0.85 * cl);
            // a few stars on clear nights, twinkling through the waves
            if (uNight > 0.3) {
              vec2 sc = Tg.xz / max(Tg.y, 0.15) * 70.0, sid = floor(sc);
              float h = fract(sin(dot(sid, vec2(127.1, 311.7))) * 43758.5453);
              float st = step(0.985, h) * smoothstep(0.42, 0.1, length(fract(sc) - 0.5));
              sky += vec3(0.8, 0.85, 1.0) * st * (uNight - 0.3) * 2.5 * (1.0 - cl) * (0.6 + 0.4 * sin(t * 3.0 + h * 90.0));
            }
            // the ripples still dim the window softly where they tilt toward total internal reflection
            col = mix(refl, sky * uSunScatter, win * (0.6 + 0.4 * smoothstep(0.0, 0.3, ct)));
          }
          // a boat passing overhead: dark hull silhouette and a churning white wake behind it
          if (uBoatDim.z > 0.001) {
            vec2 bd = vWPos.xz - uBoat.xy;
            float u = dot(bd, uBoat.zw), v = dot(bd, vec2(-uBoat.w, uBoat.z));
            float L = uBoatDim.x, W = uBoatDim.y;
            float taper = 1.0 - smoothstep(0.15, 1.0, u / L) * 0.85;
            float hull = 1.0 - smoothstep(0.85, 1.05, length(vec2(u / L, v / (W * taper))));
            float behind = max(0.0, -u - L * 0.8);
            float wakeW = 0.9 + behind * 0.09;
            float wn = texture2D(uNoiseTex, vWPos.xz / 4.0 + vec2(t * 0.15, 0.0)).r;
            float wake = exp(-v * v / (wakeW * wakeW)) * exp(-behind / 45.0) * step(0.0, behind) * (0.5 + wn);
            col = mix(col, vec3(0.92, 0.97, 1.0) * uSunScatter * 1.8, clamp(wake * 0.8, 0.0, 1.0) * uBoatDim.z);
            col = mix(col, waterColor(R) * 0.12, hull * uBoatDim.z);
          }
          gl_FragColor = vec4(waterFog(col, vWPos), 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600, 1, 1), mat);
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.frustumCulled = false;
  }
  // allowBoat: open sky and shallow enough to see the surface. Oz: floating-origin offset.
  update(camera, dt = 0, allowBoat = false, Oz = 0) {
    this.mesh.position.set(camera.position.x, U.uSurfaceY.value, camera.position.z);
    this.mesh.visible = camera.position.y > -110;
    // occasional boat crossing overhead (a little moment of life from the world above)
    if (this.boatTimer === undefined) { this.boatTimer = 90 + Math.random() * 150; this.boat = null; this._f = new THREE.Vector3(); }
    const ub = this.uniforms.uBoat.value, dim = this.uniforms.uBoatDim.value;
    if (!this.boat) {
      this.boatTimer -= dt;
      dim.z = 0;
      if (this.boatTimer <= 0) {
        if (allowBoat) {
          const f = camera.getWorldDirection(this._f); f.y = 0; f.normalize();
          const side = Math.random() < 0.5 ? -1 : 1, rx = -f.z * side, rz = f.x * side;
          const L = 6 + Math.random() * 9, sp = 3.5 + Math.random() * 3;
          this.boat = { x: camera.position.x + f.x * 35 + rx * 75, gz: camera.position.z + Oz + f.z * 35 + rz * 75,
            dx: -rx + f.x * 0.25, dz: -rz + f.z * 0.25, sp, L, W: L * 0.17, life: 150 / sp, age: 0 };
          const n = Math.hypot(this.boat.dx, this.boat.dz); this.boat.dx /= n; this.boat.dz /= n;
        }
        this.boatTimer = 200 + Math.random() * 360;
      }
    } else {
      const b = this.boat;
      b.x += b.dx * b.sp * dt; b.gz += b.dz * b.sp * dt; b.age += dt;
      if (b.age > b.life) this.boat = null;
      else {
        ub.set(b.x, b.gz - Oz, b.dx, b.dz);
        dim.set(b.L * 0.5, b.W, Math.min(1, b.age / 3, (b.life - b.age) / 3) * (allowBoat ? 1 : 0));
      }
    }
  }
}

export class MarineSnow {
  // count: particles in the 64 m box around the camera (default: per quality tier, see quality.js)
  constructor(count = currentPreset().snow || 6000) {
    const B = 64;
    // plus a few motes in an 8 m box around the lens: soft out-of-focus discs that give the water depth
    const nNear = Math.round(count / 60), total = count + nNear;
    const pos = new Float32Array(total * 3), rnd = new Float32Array(total * 4), near = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const b = i < count ? B : 8;
      pos[i * 3] = Math.random() * b; pos[i * 3 + 1] = Math.random() * b; pos[i * 3 + 2] = Math.random() * b;
      for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();
      near[i] = i < count ? 0 : 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    geo.setAttribute('aNear', new THREE.BufferAttribute(near, 1));
    this.uniforms = Object.assign({}, U, {
      uBox: { value: B }, uDensity: { value: 0.6 }, uGlowAmt: { value: 0 }, uPx: { value: 800 }, uCamR: { value: new THREE.Vector3() },
      uSpawn: { value: 0 }, uCamSpeed: { value: 3 }, uSizeK: { value: Math.min(1, Math.sqrt(6000 / count)) },
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: { WQ: waterQuality() },
      vertexShader: /* glsl */`
        uniform sampler2D uCaustics, uSkyMap;
        uniform vec2 uSkyOrigin;
        uniform float uSkySize, uSkyActive;
        attribute vec4 aRand;
        attribute float aNear;
        uniform float uBox, uDensity, uGlowAmt, uPx, uTime, uSpawn, uCamSpeed, uNight, uLamp, uSizeK;
        uniform vec3 uCamR, uSigma, uLightSigma, uSunColor, uWaterUp, uSunDir;
        uniform float uSunScatter, uSurfaceY, uSurge, uCloud;
        ${SWELL_GLSL}
        varying vec4 vCol;
        varying vec3 vShape;   // flake rotation (cos, sin) and elongation; z < 0: an out-of-focus disc
        // how far a view-space point sits inside the two lamp beams (the lamps of the surface lighting in water.js)
        float lampBeams(vec3 v) {
          float b = 0.0;
          for (int k = 0; k < 2; k++) {
            vec3 lp = vec3(k == 0 ? -0.8 : 0.8, -0.3, 0.0);
            float ca = dot(normalize(v - lp), normalize(vec3(-lp.x * 0.04, 0.02, -1.0)));
            b += smoothstep(0.6, 0.92, ca) * 0.75 + smoothstep(0.88, 0.99, ca) * 0.5;
          }
          return b;
        }
        void main() {
          // Surge: in the shallows the swell's orbital motion rocks all the suspended matter back and forth
          // together (same 11 s beat as the swaying plants), fading out by ~25 m; a heavy swell rocks it further.
          float kSg = (1.0 - smoothstep(6.0, 25.0, uSurfaceY - uCamR.y)) * (0.3 + 0.5 * uSurge);
          vec3 surge = vec3(sin(uTime * 0.55), 0.35 * sin(uTime * 0.55 + 1.4), 0.5 * cos(uTime * 0.55)) * kSg;
          if (aNear > 0.5) {
            // Near motes, 0.4-3 m from the lens, far out of focus: dim soft discs carried by a slow current
            // (one drift for all, so they move together). More of them in turbid water (uDensity).
            vec3 p = position + surge + vec3(0.11, -0.025, 0.06) * uTime
              + vec3(sin(uTime * 0.21 + aRand.x * 6.28), sin(uTime * 0.17 + aRand.z * 6.28), cos(uTime * 0.19 + aRand.y * 6.28)) * 0.15;
            vec3 r = mod(p - uCamR, 8.0) - 4.0;   // 8 m divides the 1024 m rebase: no jump
            p = r + uCamR;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float d = -mv.z;
            vec3 ar = abs(r);
            float vis = step(aRand.y, uDensity * 0.85) * smoothstep(3.6, 2.6, max(ar.x, max(ar.y, ar.z)))
              * smoothstep(0.35, 0.8, d) * (1.0 - 0.7 * uNight);
            gl_PointSize = clamp((0.05 + 0.05 * aRand.x) * uPx / max(d, 0.1), 1.0, 48.0);
            // invisible ones are moved off screen so they cost no fill
            gl_Position = vis > 0.004 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
            float dB = max(0.0, uSurfaceY - p.y);
            vec3 lit = uSunColor * uSunScatter * exp(-uLightSigma * dB) * swellFocus(p.xz, dB) * 0.7 + uWaterUp * 0.5;
            // a mote drifting through a lamp beam right in front of the port flares (classic ROV backscatter)
            if (uLamp > 0.001) lit += vec3(1.0, 0.94, 0.85) * uLamp * (0.5 + 1.4 * lampBeams(mv.xyz)) / (1.0 + 0.2 * d * d);
            vCol = vec4(lit * exp(-uSigma * d), vis * 0.09);
            vShape = vec3(1.0, 0.0, -1.0);
            if (aRand.w > 0.85) {
              // Some are small air bubbles rising past the lens now and then (more often as the craft speeds up):
              // 0.2-0.3 m/s with a quick zigzag, flattened, silvery (they mirror the light around them). They live in
              // a 4 m box (divides 1024) just ahead of the lens, so the few there are can be seen.
              p = position + surge + vec3(0.11, 0.0, 0.06) * uTime
                + vec3(0.02 * sin(uTime * 9.0 + aRand.x * 40.0), uTime * (0.2 + 0.1 * aRand.x), 0.02 * cos(uTime * 8.0 + aRand.y * 40.0));
              vec3 bc = uCamR - vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) * 2.2;
              r = mod(p - bc, 4.0) - 2.0;
              p = r + bc;
              mv = modelViewMatrix * vec4(p, 1.0);
              d = -mv.z;
              ar = abs(r);
              float cyc = fract(uTime * 0.025 + aRand.z * 7.0), on = clamp(0.1 + 0.08 * uCamSpeed, 0.1, 0.6);
              vis = smoothstep(0.0, 0.04, cyc) * smoothstep(on, on - 0.04, cyc) * smoothstep(1.95, 1.5, max(ar.x, max(ar.y, ar.z)))
                * smoothstep(0.35, 0.8, d) * step(p.y, uSurfaceY - 0.3);
              // none under a roof (cave, ice, overhang): the sky-visibility map is ~0 there; kelp canopy keeps some
              if (uSkyActive > 0.5 && vis > 0.004) {
                vec2 su = (p.xz - uSkyOrigin) / uSkySize;
                if (su.x > 0.0 && su.y > 0.0 && su.x < 1.0 && su.y < 1.0) vis *= smoothstep(0.05, 0.2, textureLod(uSkyMap, su, 0.0).r);
              }
              gl_PointSize = clamp((0.016 + 0.012 * aRand.y) * uPx / max(d, 0.1), 2.0, 28.0);
              gl_Position = vis > 0.004 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
              vCol = vec4((lit * 1.3 + uWaterUp * 0.4) * exp(-uSigma * d), vis * 0.5);
              float wob = 0.15 * sin(uTime * 11.0 + aRand.z * 30.0);
              vShape = vec3(cos(wob), sin(wob), -2.0);
            }
            return;
          }
          bool spawn = aRand.w > 1.0 - 0.3 * uSpawn;     // coral-spawning bundles rise instead of sink
          vec3 p = position + surge + vec3(sin(uTime * 0.13 + aRand.x * 6.28) * 0.6,
                                   spawn ? uTime * 0.11 * (0.5 + aRand.y) : -uTime * 0.04 * (0.4 + aRand.y),
                                   cos(uTime * 0.11 + aRand.z * 6.28) * 0.6);
          p = mod(p - uCamR, uBox) - uBox * 0.5 + uCamR;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          bool glow = aRand.w < uGlowAmt * 0.22;
          float size = spawn ? 0.03 + aRand.x * 0.025 : glow ? 0.05 + aRand.x * 0.05 : (0.012 + aRand.x * aRand.x * 0.05) * uSizeK;
          // out-of-focus motes right in front of the lens grow into soft discs
          float bokeh = smoothstep(1.6, 0.35, d);
          size *= 1.0 + bokeh * 2.5;
          gl_PointSize = clamp(size * uPx / max(d, 0.1), 1.0, 48.0);
          gl_Position = projectionMatrix * mv;
          float edge = smoothstep(uBox * 0.5, uBox * 0.3, length(p - uCamR));
          float near = smoothstep(0.15, 0.6, d);
          float vis = step(aRand.y, uDensity) * edge * near;
          vec3 T = exp(-uSigma * d);
          float dB = max(0.0, uSurfaceY - p.y);
          vec3 sunL = uSunColor * uSunScatter * exp(-uLightSigma * dB) * swellFocus(p.xz, dB);   // as the seabed
#if WQ > 0
          // medium and up: flakes inside a sun shaft catch its light and those in the shade between shafts dim,
          // from the same focusing bands (caustics B, 16 m) and the same contrast fade as the god rays in post.js
          {
            vec2 qs = p.xz - uSunDir.xz / max(uSunDir.y, 0.35) * (p.y - uSurfaceY);
            float b = textureLod(uCaustics, qs / 16.0, 1.5).b;
            float kb = exp(-dB * 0.045) * clamp(1.2 - 0.95 * uCloud, 0.15, 1.0) * 0.6;
            sunL *= max(1.0 + (b * b * b * 3.7 - 1.0) * kb, 0.35);   // flakes in the shade stay visible
          }
#endif
          // particles glow when backlit by the sun (strong forward scattering), like dust in a sunbeam
          vec3 vdir = normalize(p - cameraPosition);
          float fwd = pow(max(dot(vdir, uSunDir), 0.0), 6.0);
          vec3 lit = sunL * (0.9 + 2.2 * fwd) + uWaterUp * 0.6;
          // flakes differ in make-up and reflect differently: a spread of brightness at the same mean
          vec3 c = lit * T * (0.3 + 0.4 * fract(aRand.y * 13.7));
          // ROV lamps: specks in the beams light up (backscatter), the classic night-dive snowfall
          if (uLamp > 0.001) c += vec3(1.0, 0.94, 0.85) * uLamp * lampBeams(mv.xyz) * 1.05 * exp(-dot(uSigma, vec3(0.66)) * d) / (1.0 + 0.09 * d * d);
          if (glow) {
            float tw = 0.5 + 0.5 * sin(uTime * (0.7 + aRand.z * 2.0) + aRand.x * 40.0);
            c = mix(vec3(0.2, 0.9, 1.0), vec3(0.3, 1.0, 0.6), aRand.z) * 2.5 * tw * tw * exp(-uSigma * d * 0.6);
            vis = edge * near;
          }
          // night: plankton flashes blue-green as the camera disturbs the water around it
          float stir = uNight * smoothstep(3.2, 0.9, d) * clamp(uCamSpeed / 3.0, 0.2, 1.6);
          if (stir > 0.01 && aRand.z < 0.35) {
            float fl = pow(0.5 + 0.5 * sin(uTime * (3.0 + aRand.x * 5.0) + aRand.y * 50.0), 6.0);
            c += vec3(0.25, 0.95, 1.0) * 4.0 * stir * fl;
            vis = max(vis, edge * near * step(0.001, stir));
          }
          if (spawn) {
            vec3 lampLit = vec3(1.0, 0.95, 0.85) * (uLamp * 1.6 * exp(-d * 0.15) + 0.15);
            c = vec3(1.0, 0.5, 0.55) * (lit * 0.6 + lampLit) * T;
            vis = edge * near;
          }
          // big out-of-focus motes are dimmer per pixel (their light spreads over the disc)
          vCol = vec4(c, vis / (1.0 + bokeh * 7.0));
          float a = aRand.z * 6.2831853 + uTime * (0.2 + aRand.y * 0.3);
          vShape = vec3(cos(a), sin(a), (glow || spawn) ? 1.0 : 1.0 + 1.4 * aRand.w * aRand.w * (1.0 - bokeh));
        }`,
      fragmentShader: /* glsl */`
        varying vec4 vCol;
        varying vec3 vShape;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          c = vec2(c.x * vShape.x - c.y * vShape.y, c.x * vShape.y + c.y * vShape.x);   // tumbling flakes
          if (vShape.z < -1.5) {
            // bubble: flattened (wider than tall), a bright rim and a small highlight, nearly clear inside
            c.y *= 1.35;
            float rb = length(c);
            float ab = smoothstep(0.5, 0.42, rb) * (0.2 + 0.8 * smoothstep(0.22, 0.4, rb))
              + 0.8 * smoothstep(0.12, 0.0, length(c - vec2(-0.1, -0.12)));
            if (vCol.a * ab < 0.004) discard;
            gl_FragColor = vec4(vCol.rgb * ab * vCol.a, 1.0);
            return;
          }
          c.x *= abs(vShape.z);
          float rr = length(c);
          // flakes: a soft dot; out-of-focus discs: flat with a slightly brighter rim, like a lens bokeh
          float a = vShape.z < 0.0 ? smoothstep(0.5, 0.2, rr) * (0.8 + 0.25 * smoothstep(0.1, 0.38, rr))
                                   : smoothstep(0.5, 0.05, rr);
          if (vCol.a * a < 0.004) discard;
          gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }
  setDensity(snow, glow, spawn = 0, camSpeed = 3) {
    this.uniforms.uDensity.value = Math.min(1, 0.25 + snow * 0.45);
    this.uniforms.uGlowAmt.value = glow;
    this.uniforms.uSpawn.value = spawn;
    this.uniforms.uCamSpeed.value = camSpeed;
  }
  update(camera, dt, renderer) {
    this.uniforms.uCamR.value.copy(camera.position);
    const h = window.innerHeight * (renderer ? renderer.getPixelRatio() : 1);
    this.uniforms.uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
