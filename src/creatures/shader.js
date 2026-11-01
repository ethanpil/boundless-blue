// Creature materials: one opaque + one translucent (jelly) program shared by every species.
// All per-species / per-individual variation comes from instanced attributes:
//   aG     (geometry) part id, normalised height v, lateral/u/index, flex/w/distance
//   aCol   packed sRGB colours: dorsal, belly, pattern1, fin
//   aCol2  packed: pattern2 colour, accent (iris / fin edge / glow), [finEdge, finRays, iris], [csLevel, csSharp, glowMode]
//   aPat   pattern1 type, scale, param, pattern2 type
//   aPat2  pattern2 scale, param, sheen (alpha for jellies), floor(glow*10)+roughness
//   aMot   animation mode, amplitude, waves per length, envelope base
//   aAnim  (dynamic) phase, amplitude scale, turn bend, fade
import * as THREE from 'three';
import { applyWater } from '../water.js';

const VERT_HEAD = /* glsl */`
attribute vec4 aG;
attribute vec4 aCol;
attribute vec4 aCol2;
attribute vec4 aPat;
attribute vec4 aPat2;
attribute vec4 aMot;
attribute vec4 aAnim;
attribute vec4 aVar;   // individual: seed, girth, fin/tentacle scale, pattern intensity
attribute vec4 aVar2;  // individual: scars & fin nicks, wear/fading, barnacles, fluke-pattern strength
varying vec3 vLoc;
varying vec4 vGv;
flat varying vec4 vCol;
flat varying vec4 vCol2;
flat varying vec4 vPat;
flat varying vec4 vPat2;
flat varying vec4 vMot;
flat varying float vFade;
flat varying float vExc;
flat varying vec4 vVar;
flat varying vec4 vVar2;

void crRotZ(inout vec3 p, inout vec3 n, float x0, float th) {
  float cs = cos(th), sn = sin(th);
  float rx = p.x - x0;
  p.x = x0 + rx * cs;
  p.y += rx * sn;
  n.xy = vec2(n.x * cs - n.y * sn, n.x * sn + n.y * cs);
}

void crDeform(inout vec3 p, inout vec3 n) {
  float mode = aMot.x;
  float part = aG.x;
  float ph = aAnim.x;
  float A = aMot.y * aAnim.y;
  float K = aMot.z * 6.2831853;
  float c0 = aMot.w;
  float bend = aAnim.z;
  float tt = clamp(0.5 - p.z, 0.0, 1.4);
  bool isMedian = part > 0.5 && part < 1.5;
  bool isPaired = part > 1.5 && part < 2.5;
  bool isFlipper = part > 6.5 && part < 7.5;
  bool isArm = part > 5.5 && part < 6.5;
  if (mode < 0.5) {
    // lateral travelling wave (fish, sharks, eels, phocid seals)
    float env = c0 + (1.0 - c0) * tt * tt;
    float denv = 2.0 * (1.0 - c0) * tt;
    float arg = ph - K * tt;
    float s = sin(arg), c = cos(arg);
    float tb = tt - 0.3;
    p.x += A * env * s + bend * tb * tb;
    n.z += (A * (denv * s - env * K * c) + 2.0 * bend * tb) * n.x;
    if (isPaired) p.y += aG.w * 0.035 * sin(ph * 0.7 + 1.3);
    if (isMedian) p.x += aG.w * 0.012 * sin(ph * 1.7 - aG.z * 6.0);
    if (isFlipper) crRotZ(p, n, aG.z, 0.25 * sin(ph * 0.5) * sign(p.x));
  } else if (mode < 1.5) {
    // vertical wave (cetaceans, sirenians)
    float env = c0 + (1.0 - c0) * tt * tt;
    float denv = 2.0 * (1.0 - c0) * tt;
    float arg = ph - K * tt;
    float s = sin(arg), c = cos(arg);
    p.y += A * env * s;
    n.z += A * (denv * s - env * K * c) * n.y;
    float tb = tt - 0.35;
    p.x += bend * tb * tb;
    n.z += 2.0 * bend * tb * n.x;
    if (isFlipper) crRotZ(p, n, aG.z, (0.12 * sin(ph * 0.5 + 0.7) - 0.05) * sign(p.x));
  } else if (mode < 2.5) {
    // rays: a travelling wave runs front-to-back along each pectoral fin (leading edge leads, trailing
    // edge lags), flex grows smoothly toward the tips; the central disc (half-width c0) stays level.
    float ax = abs(p.x), w = max(ax - c0, 0.0);
    float arg = ph - K * tt - 2.0 * w;
    float s = sin(arg), c = cos(arg);
    float f = pow(w, 1.6), df = w > 0.0 ? 1.6 * pow(w, 0.6) : 0.0;
    p.y += A * f * s + A * 0.012 * sin(ph + 1.6) * (tt - 0.25); // gentle pitch bob of the disc
    n.x -= A * (df * s - 2.0 * f * c) * sign(p.x) * n.y;
    n.z -= A * f * c * K * n.y;
    float tail = smoothstep(0.35, 1.0, tt);
    float tb = tt - 0.3;
    p.x += tail * 0.02 * sin(ph * 0.5 - tt * 6.0) + bend * tb * tb;
  } else if (mode < 3.5) {
    // flipper strokes (turtles, penguins, sea lions)
    float tb = tt - 0.4;
    p.x += bend * tb * tb;
    p.y += 0.006 * sin(ph * 2.0 + 1.0);
    if (isFlipper) {
      float sd = sign(p.x);
      crRotZ(p, n, aG.z, A * sin(ph) * sd - 0.1 * sd);
      p.z += abs(p.x - aG.z) * 0.3 * aMot.y * cos(ph);
    }
    if (isPaired) p.y += aG.w * 0.03 * sin(ph + 1.5);
    if (mode > 3.0 && tt > 0.6) { // sea lion / penguin trunk flex
      p.y += 0.02 * aAnim.y * (tt - 0.6) * sin(ph);
    }
  } else if (mode < 4.5) {
    // jellyfish: bell pulse + lagging tentacles (local +y is the bell apex)
    float pc = 0.5 + 0.5 * sin(ph);
    float P = A * pc * pc;
    if (isPaired) { float sd = sign(p.x); crRotZ(p, n, sd * 0.1, sd * (0.55 * sin(ph) - 0.1)); } // dumbo ear fins
    if (isArm) {
      float d = aG.w;
      float pl = 0.5 + 0.5 * sin(ph - d * 2.2);
      p.xz *= 1.0 - A * pl * pl * exp(-d * 2.5);
      p.x += sin(ph * 0.31 - d * 2.2 + aG.z) * d * 0.09;
      p.z += cos(ph * 0.27 - d * 1.9 + aG.z * 1.7) * d * 0.09;
    } else {
      float k = 1.0 - P * (1.0 - clamp(p.y * 2.0, 0.0, 1.0));
      p.xz *= k;
      p.y *= 1.0 + P * 0.3;
    }
  } else if (mode < 5.5) {
    // cephalopods: mantle pulse, fin ripple, trailing arms
    if (part < 0.5) {
      float pulse = A * 0.06 * (0.5 + 0.5 * sin(ph)) * (1.0 - smoothstep(0.45, 0.65, tt));
      p.xy *= 1.0 - pulse;
    }
    if (isMedian) p.y += aG.w * aG.w * 0.022 * sin(ph * 2.3 - aG.z * 12.0); // gentle travelling ripple along the fin
    if (isArm) {
      float d = aG.w;
      p.x += sin(ph * 0.6 - d * 7.0 + aG.z * 1.3) * d * 0.05;
      p.y += cos(ph * 0.5 - d * 6.0 + aG.z * 2.1) * d * 0.04;
    }
    float tb = tt - 0.4;
    p.x += bend * tb * tb;
  } else if (mode < 6.5) {
    // octopus (local +y up): curling / crawling arms, breathing mantle; J = jet (arms stream behind)
    float J = clamp(bend, 0.0, 1.0);
    if (isArm) {
      float d = aG.w;
      float w = sin(ph * 0.35 + aG.z * 1.7 - d * 3.0);
      p.y += d * d * 0.16 * (0.6 + 0.4 * w) * (1.0 - J);
      vec2 dir = normalize(p.xz + vec2(1e-4));
      p.xz += vec2(-dir.y, dir.x) * sin(ph * 0.25 + aG.z * 2.3 - d * 4.0) * d * 0.07 * (1.0 - J);
      float r = length(p.xz);
      vec2 rd = p.xz / max(r, 1e-4);
      p.xz = rd * mix(r, 0.035 + d * 0.07 + 0.02 * sin(ph * 1.6 - d * 7.0 + aG.z), J);
      p.y = mix(p.y, 0.04 - d * 0.95, J);
    } else {
      p *= 1.0 + (0.035 + 0.07 * J) * sin(ph * (0.8 + 1.6 * J)) * smoothstep(0.1, 0.45, p.y);
    }
  } else if (mode < 7.5) {
    // mola: stiff body, big sculling dorsal + anal fins
    float tb = tt - 0.4;
    p.x += 0.012 * sin(ph) * tb + bend * tb * tb;
    if (isMedian) p.x += aG.w * A * sin(ph) * sign(p.y);
    if (isPaired) p.y += aG.w * 0.03 * sin(ph * 2.0);
  } else if (mode < 8.5) {
    // anchored sway: tail fixed (t=1), head free (garden eels, morays in holes)
    float env = (1.0 - min(tt, 1.0));
    env *= env;
    p.x += A * env * sin(ph - K * tt);
    p.y += A * 0.6 * env * cos(ph * 0.71 - K * tt);
  } else if (mode < 9.5) {
    // seahorse: vertical body, gentle rock + fast dorsal flutter
    p.x += 0.02 * sin(ph * 0.4) * (p.y + 0.4);
    if (isMedian) p.x += aG.w * 0.035 * sin(ph * 14.0 - aG.z * 10.0);
    if (isPaired) p.y += aG.w * 0.02 * sin(ph * 12.0);
  } else {
    // walkers (crabs, lobsters, isopods, sea pigs; local +y up): legs step in a metachronal wave
    // (left / right in antiphase), the body bobs with the stride, antennae and papillae sway
    p.y += A * 0.004 * sin(ph * 2.0);
    if (isArm) {
      float idx = aG.z, d = aG.w;
      if (abs(idx) < 9.5) {
        float lp = ph + abs(idx) * 1.9 + (idx < 0.0 ? 3.14159 : 0.0);
        p.z += A * 0.07 * d * sin(lp);
        p.y += A * 0.045 * d * max(0.0, cos(lp)) * (1.0 - 0.3 * d);
      } else {
        p.x += d * d * 0.05 * sin(ph * 0.21 + idx);
        p.y += d * d * 0.04 * cos(ph * 0.17 + idx * 1.3);
      }
    }
  }
}
`;

const FRAG_HEAD = /* glsl */`
varying vec3 vLoc;
varying vec4 vGv;
flat varying vec4 vCol;
flat varying vec4 vCol2;
flat varying vec4 vPat;
flat varying vec4 vPat2;
flat varying vec4 vMot;
flat varying float vFade;
flat varying float vExc;
flat varying vec4 vVar;
flat varying vec4 vVar2;

vec3 crUnpack(float f) {
  float r = floor(f / 65536.0);
  float g = floor((f - r * 65536.0) / 256.0);
  float b = f - r * 65536.0 - g * 256.0;
  return vec3(r, g, b) / 255.0;
}
vec3 crLin(vec3 c) { return c * c * (0.3 + 0.7 * c); }  // cheap sRGB -> linear
float crHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 crHash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float crNoise(vec2 p) { return texture2D(uNoiseTex, p * 0.125).r; }
float crFbm(vec2 p) { return texture2D(uNoiseTex, p * 0.125).g * 0.65 + texture2D(uNoiseTex, p * 0.31).b * 0.35; }
vec3 crCell(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = crHash2(ip + g);
    vec2 r = g + o - fp;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = crHash(ip + g + 17.0); } else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

// Pattern masks: returns (colour mix amount, darkening (negative = lightening))
vec2 crPat(float ty, vec2 q, float t, float vN, float sc, float pr, float sd, float part) {
  int T = int(ty + 0.5);
  float m = 0.0, e = 0.0;
  if (T == 0) return vec2(0.0);
  if (T == 1) {            // vertical bars
    float x = q.x * sc + 0.12 * sin(q.y * sc * 3.0 + sd);
    float b = 0.5 + 0.5 * cos(x * 6.2831853);
    m = smoothstep(1.0 - pr - 0.1, 1.0 - pr + 0.1, b) * smoothstep(-0.9, -0.35, vN);
  } else if (T == 2) {     // horizontal stripes following the body contour
    float b = 0.5 + 0.5 * cos(vN * sc * 3.14159 + sd);
    m = smoothstep(1.0 - pr - 0.1, 1.0 - pr + 0.1, b);
  } else if (T == 3) {     // spots
    vec3 c = crCell(q * sc + sd);
    float r = pr * (0.55 + 0.6 * c.z);
    m = 1.0 - smoothstep(r - 0.08, r + 0.02, c.x);
  } else if (T == 4) {     // reticulation (network of lines)
    vec3 c = crCell(q * sc + sd);
    m = 1.0 - smoothstep(pr * 0.5, pr * 0.5 + 0.12, c.y - c.x);
  } else if (T == 5) {     // ocellus near the tail
    float d = length(vec2((t - 0.7) * 2.4, vN - 0.2));
    m = 1.0 - smoothstep(pr, pr + 0.04, d);
    e = -0.7 * smoothstep(pr + 0.01, pr + 0.05, d) * (1.0 - smoothstep(pr + 0.09, pr + 0.14, d));
  } else if (T == 6) {     // mottled blotches
    float n = crFbm(q * sc + sd);
    m = smoothstep(pr - 0.07, pr + 0.07, n);
  } else if (T == 7) {     // diagonal wavy lines
    float x = (q.x + q.y * pr) * sc + 0.2 * sin(q.y * sc * 4.0 + sd);
    m = smoothstep(0.55, 0.85, 0.5 + 0.5 * cos(x * 6.2831853));
  } else if (T == 8) {     // vertical band through the eye (sc = centre t, pr = half width)
    m = 1.0 - smoothstep(pr, pr + 0.015, abs(t - sc + 0.03 * vN));
  } else if (T == 9) {     // anemonefish bands with dark margins
    float tc = t + 0.035 * vN * vN;
    float d = min(abs(tc - 0.2), min(abs(tc - 0.47) * 0.85, abs(tc - 0.78) * 1.4));
    m = 1.0 - smoothstep(pr, pr + 0.008, d);
    e = smoothstep(pr + 0.002, pr + 0.008, d) * (1.0 - smoothstep(pr + 0.016, pr + 0.024, d));
  } else if (T == 10) {    // fine dense spots + lines grid (whale shark)
    vec3 c = crCell(q * sc + sd);
    m = 1.0 - smoothstep(pr * 0.45, pr * 0.45 + 0.07, c.x);
    float lx = abs(fract(q.x * sc * 0.5 + 0.1 * sin(q.y * 9.0)) - 0.5);
    m = max(m, (1.0 - smoothstep(0.02, 0.05, lx)) * 0.7) * smoothstep(-0.3, 0.1, vN);
  } else if (T == 11) {    // orca
    float rise = smoothstep(0.5, 0.62, t) * smoothstep(0.84, 0.72, t);
    float thr = -0.28 + 0.5 * rise;
    float b = smoothstep(thr + 0.05, thr - 0.05, vN) * smoothstep(0.02, 0.06, t) * smoothstep(0.86, 0.8, t);
    float ep = length(vec2((t - 0.2) / 0.06, (vN - 0.3) / 0.16));
    m = max(b, 1.0 - smoothstep(0.85, 1.1, ep));
    e = -0.55 * smoothstep(0.6, 0.85, vN) * smoothstep(0.38, 0.46, t) * smoothstep(0.62, 0.53, t);
  } else if (T == 12) {    // single lateral stripe at vN = sc, half-width pr
    m = 1.0 - smoothstep(pr, pr + 0.06, abs(vN - sc));
  } else if (T == 13) {    // photophore rows on the belly
    float x = fract(t * sc) - 0.5;
    float dA = length(vec2(x / sc, (vN + 0.45) * 0.09));
    float dB = length(vec2((fract(t * sc + 0.5) - 0.5) / sc, (vN + 0.78) * 0.09));
    m = 1.0 - smoothstep(pr * 0.6, pr, min(dA, dB));
    m *= smoothstep(0.1, 0.16, t) * smoothstep(0.85, 0.75, t);
  } else if (T == 14) {    // passing clouds (cuttlefish)
    float x = q.x * sc - uTime * pr + 0.6 * crNoise(q * 6.0 + sd);
    m = smoothstep(0.45, 0.85, 0.5 + 0.5 * cos(x * 6.2831853)) * 0.9;
  } else if (T == 15) {    // irregular tiger bars
    float x = q.x * sc + 0.9 * crNoise(q * vec2(2.0, 8.0) + sd);
    m = smoothstep(1.0 - pr - 0.08, 1.0 - pr + 0.08, 0.5 + 0.5 * cos(x * 6.2831853)) * smoothstep(-0.4, 0.2, vN);
  } else if (T == 16) {    // throat grooves (rorquals)
    float b = 0.5 + 0.5 * cos(vN * sc * 3.14159);
    m = smoothstep(0.7, 0.95, b) * smoothstep(-0.15, -0.4, vN) * smoothstep(0.6, 0.48, t) * smoothstep(0.02, 0.1, t);
  } else if (T == 17) {    // radial bands (jelly bell, top view)
    float a = atan(q.y, q.x);
    m = smoothstep(1.0 - pr - 0.1, 1.0 - pr + 0.1, 0.5 + 0.5 * cos(a * sc)) * smoothstep(0.03, 0.15, length(q));
  } else if (T == 18) {    // rim band (jelly)
    m = 1.0 - smoothstep(pr * 0.6, pr, vN);
  } else if (T == 19) {    // moon jelly gonads (four horseshoes)
    float a = atan(q.y, q.x);
    float r = length(q);
    float ang = mod(a + 0.7854, 1.5708) - 0.7854;
    vec2 pp = r * vec2(cos(ang), sin(ang)) - vec2(0.13, 0.0);
    m = 1.0 - smoothstep(0.012, 0.028, abs(length(pp) - 0.055));
  } else if (T == 20) {    // turtle scutes (shell only)
    if (part > 9.5) {
      vec3 c = crCell(q * sc + sd);
      m = 0.25 + 0.75 * smoothstep(0.05, 0.75, c.x);
      e = 0.7 * (1.0 - smoothstep(0.03, 0.09, c.y - c.x));
    }
  } else if (T == 21) {    // dorsal saddles
    float n = crNoise(vec2(q.x * sc, 0.37) + sd);
    m = smoothstep(pr - 0.05, pr + 0.05, n) * smoothstep(-0.1, 0.5, vN);
  } else if (T == 22) {    // front of body different (head / face), boundary at t = sc
    m = 1.0 - smoothstep(sc - 0.02, sc + 0.02, t + 0.06 * vN * pr);
  } else if (T == 23) {    // rear of body different, boundary at t = sc
    m = smoothstep(sc - 0.03, sc + 0.03, t - 0.05 * vN * pr);
  } else if (T == 24) {    // gill slits (sharks)
    float k = (t - sc) / 0.013;
    float fk = abs(fract(k) - 0.5);
    e = (k > 0.0 && k < 5.0) ? (1.0 - smoothstep(0.05, 0.14, fk)) * (1.0 - smoothstep(0.25, 0.5, abs(vN - 0.05))) * 0.55 : 0.0;
  } else if (T == 25) {    // fine speckle (small round dots)
    vec3 c = crCell(q * sc + sd);
    m = (1.0 - smoothstep(0.18, 0.3, c.x)) * step(pr, c.z);
  } else if (T == 26) {    // rosettes / ringed spots
    vec3 c = crCell(q * sc + sd);
    float r = pr * (0.6 + 0.5 * c.z);
    m = smoothstep(r - 0.14, r - 0.06, c.x) * (1.0 - smoothstep(r, r + 0.06, c.x));
  } else if (T == 27) {    // dorsal-only spots (eagle rays, top view)
    vec3 c = crCell(q * sc + sd);
    float r = pr * (0.6 + 0.5 * c.z);
    m = (1.0 - smoothstep(r - 0.08, r, c.x)) * smoothstep(0.0, 0.3, vN);
  } else if (T == 30) {    // animated chromatophores (octopus): drifting, flickering mottle
    vec2 drift = vec2(uTime * 0.05, -uTime * 0.035) * pr;
    float n = crFbm(q * sc + sd + drift);
    float th = 0.5 + 0.1 * sin(uTime * 0.37 + sd);
    m = smoothstep(th - 0.07, th + 0.07, n);
  } else if (T == 28) {    // belly patch / chest blaze (vN < sc)
    m = smoothstep(sc + 0.06, sc - 0.06, vN + 0.15 * sin(t * 9.0 + sd) * pr);
  }
  return vec2(m, e);
}
`;

const VERT_MAIN = /* glsl */`
vec3 objectNormal = vec3(normal);
vec3 crPos = position;
{ // individual proportions: girth, fin size, tentacle length
  float gi = aVar.y, fs = aVar.z, pt = aG.x, md = aMot.x;
  if (md > 3.5 && md < 4.5) { if (pt > 5.5 && pt < 6.5) crPos.y *= fs; else crPos.xz *= gi; }
  else if (md < 5.5 || md > 6.5 && md < 8.5) {
    if (pt < 0.5 || pt > 9.5 || (pt > 3.5 && pt < 4.5)) crPos.xy *= gi;
    else if (pt > 0.5 && pt < 1.5) crPos.xy *= vec2(gi, gi * fs);
    else if (pt > 1.5 && pt < 2.5 || pt > 6.5 && pt < 7.5) crPos.xy *= gi * mix(1.0, fs, 0.6);
    else if (pt > 2.5 && pt < 3.5) crPos.xy *= fs;
  }
}
crDeform(crPos, objectNormal);
objectNormal = normalize(objectNormal);
vLoc = position; vGv = aG; vCol = aCol; vCol2 = aCol2; vPat = aPat; vPat2 = aPat2; vMot = aMot; vFade = aAnim.w; vExc = aAnim.y; vVar = aVar; vVar2 = aVar2;
`;

const FRAG_COLOR = /* glsl */`
if (vFade < 0.995) {
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (ign > vFade) discard;
}
float crPart = floor(vGv.x + 0.5);
float crMode = floor(vMot.x + 0.5);
vec3 cD = crLin(crUnpack(vCol.x)), cB = crLin(crUnpack(vCol.y)), cP = crLin(crUnpack(vCol.z)), cF = crLin(crUnpack(vCol.w));
vec3 cP2 = crLin(crUnpack(vCol2.x)), cA = crLin(crUnpack(vCol2.y));
vec3 pk = crUnpack(vCol2.z);
vec3 pk2 = crUnpack(vCol2.w);
float crGm = floor(pk2.z * 255.0 + 0.5);
float crNoGill = step(7.5, crGm);          // +8: no bony gill cover (sharks, rays, seals, eels...)
float glowMode = crGm - 8.0 * crNoGill;
float crT = 0.5 - vLoc.z;
float vN = vGv.y;
vec2 q = vec2(-vLoc.z, vLoc.y);
if (crMode == 2.0 || crMode == 4.0 || crMode == 6.0) q = vec2(vLoc.x, -vLoc.z);
if (crMode == 9.0) q = vec2(vLoc.y, vLoc.z);
if (crMode == 1.0 || crMode == 3.0) q = vec2(-vLoc.z, vLoc.y + abs(vLoc.x)); // wrap over the back (no lateral streaking from above)
if (crMode == 10.0) q = vec2(-vLoc.z + vLoc.y * 0.5, vLoc.x + vLoc.y * 0.5);   // walkers: mostly seen from above
vec2 qw = vec2(-vLoc.z, vLoc.y + abs(vLoc.x));                                 // wrapped coords for marks on top surfaces
float sd = fract(vPat.y * 7.31 + vPat2.x * 3.17) * 50.0 + vVar.x * 97.0;  // per-individual pattern seed / phase
q.x += (vVar.x - 0.5) * 0.06;  // pattern offset along the body
float csL = pk2.x * 2.0 - 1.0;
float csS = 1.0 + pk2.y * 40.0;
float dors = clamp((vN - csL) * csS * 0.5 + 0.5, 0.0, 1.0);
dors = dors * dors * (3.0 - 2.0 * dors);
vec3 crCol = mix(cB, cD, dors);
vec2 m1 = crPat(vPat.x, q, crT, vN, vPat.y, vPat.z, sd, crPart);
vec2 m2 = crPat(vPat.w, q, crT, vN, vPat2.x, vPat2.y, sd + 3.1, crPart);
m1 *= vVar.w; m2 *= mix(1.0, vVar.w, 0.6); // individual pattern intensity
bool crFin = (crPart > 0.5 && crPart < 3.5) || (crPart > 6.5 && crPart < 7.5);
float crRough = fract(vPat2.w);
float crGlowAmt = floor(vPat2.w) * 0.1;
float crSheen = vPat2.z;
vec3 crGlow = vec3(0.0);
if (crFin) {
  float fu = vGv.z, fw = vGv.w;
  if (vVar2.x > 0.25 && (crPart == 1.0 || crPart == 3.0) && fw > 0.55) {
    float nk = crNoise(vec2(fu * 7.0 + vVar.x * 31.0, vVar.x * 9.0));
    if (nk > 0.8 - 0.12 * vVar2.x && fw > 1.0 - (nk - 0.68) * 2.2) discard;
  }
  vec3 fc = cF;
  fc = mix(fc, cP, m1.x * 0.55);
  fc = mix(fc, cP2, m2.x * 0.85);
  fc *= 1.0 - pk.y * 0.35 * (0.5 + 0.5 * cos(fu * 34.0)) * fw;
  fc = mix(fc, cA, pk.x * smoothstep(0.72, 0.93, fw));
  fc = mix(fc, fc * 1.3 + 0.025, smoothstep(0.7, 1.0, fw) * 0.55 * (1.0 - pk.x)); // thin membrane edge
  crCol = mix(mix(crCol, cP, m1.x), fc, smoothstep(0.02, 0.3, fw));
  crSheen *= 0.35;
  crRough = max(crRough, 0.42);
} else {
  crCol = mix(crCol, cP, m1.x);
  crCol *= 1.0 - m1.y * 0.85;
  crCol = mix(crCol, cP2, m2.x);
  crCol *= 1.0 - m2.y * 0.85;
  crSheen *= 1.0 - 0.6 * max(m1.x, m2.x);
}
if (crPart == 4.0) {            // eye: glossy black pupil, iris ring
  float c = vGv.y;
  vec3 iris = cA * (0.15 + 0.85 * pk.z);
  crCol = mix(iris, vec3(0.004), smoothstep(0.76, 0.82, c));
  crCol = mix(cD * 0.35, crCol, smoothstep(0.42, 0.52, c));
  crRough = 0.05; crSheen = 0.5;
} else if (crPart == 5.0) {     // light organ
  crCol = cA * 0.4;
  float fl = 0.85 + 0.15 * sin(uTime * 2.3 + vPat.y * 3.0) * sin(uTime * 0.71);
  crGlow += cA * (0.25 + 3.5 * uGlow) * fl * max(crGlowAmt, 0.3);
  crRough = 0.2;
} else if (crPart == 8.0) {     // teeth / tusk / bill
  crCol = mix(vec3(0.75, 0.72, 0.64), cF, 0.25);
  crRough = 0.3; crSheen = 0.2;
} else if (crPart == 9.0) {     // beak / feet / claws
  crCol = cA;
  crRough = 0.4; crSheen = 0.1;
} else if (crPart == 6.0) {     // tentacles / arms
  crCol = mix(cF, cP, vGv.y);
  crCol = mix(crCol, cP, m1.x * 0.5);
}
// faint scale / skin micro-variation
crCol *= 0.93 + 0.14 * crNoise(q * 23.0 + sd);
if (crMode == 0.0 && crPart == 0.0 && vPat2.z > 0.12) {
  vec2 sq = qw * vec2(68.0, 92.0);
  float scl = abs(sin(sq.x + sq.y * 0.5)) * abs(sin(sq.x - sq.y * 0.5));
  crCol *= 0.95 + 0.07 * scl;
  crSheen *= 0.75 + 0.5 * scl;
  float lline = (1.0 - smoothstep(0.0, 0.022, abs(vN - (0.32 - 0.16 * crT)))) * smoothstep(0.12, 0.2, crT) * smoothstep(0.86, 0.76, crT);
  crCol = mix(crCol, crCol * 1.3 + 0.015, lline * 0.35);
}
if (crMode == 0.0 && crPart == 0.0 && crNoGill < 0.5) { // gill cover: a fine curved edge behind the eye, the cheek a touch lighter
  float tg = 0.205 + 0.04 * vN * vN;
  float gEdge = (1.0 - smoothstep(0.0025, 0.008, abs(crT - tg))) * (1.0 - smoothstep(0.55, 0.85, abs(vN)));
  crCol *= 1.0 - 0.3 * gEdge;
  crCol = mix(crCol, crCol * 1.1 + 0.006, (1.0 - smoothstep(tg - 0.07, tg - 0.01, crT)) * smoothstep(0.03, 0.08, crT) * 0.35 * (1.0 - smoothstep(0.5, 0.8, abs(vN))));
}
if (crMode == 6.0) { // blanching when alarmed; a dark flush of the chromatophores at the moment of the startle
  crCol = mix(crCol, cB * 1.15, clamp(vExc - 1.0, 0.0, 1.0) * 0.55);
  crCol = mix(crCol, cP * 0.45, clamp(vExc - 2.4, 0.0, 1.0) * 0.85);
}
if (vVar2.x > 0.01 && (crPart == 0.0 || crPart == 10.0)) { // healed scratches and scars
  // thin wiggly scratches along a noise contour, sparse and individual
  float cn = crNoise(qw * vec2(5.0, 9.0) + vVar.x * 40.0);
  float sc2 = (1.0 - smoothstep(0.0, 0.012, abs(cn - 0.5))) * smoothstep(0.62, 0.7, crNoise(qw * 1.7 + vVar.x * 23.0));
  crCol = mix(crCol, crCol * 1.45 + 0.05, sc2 * vVar2.x * 0.55);
}
if (vVar2.z > 0.01 && (crPart == 10.0 || (crMode == 1.0 && crPart == 0.0 && vN > -0.3 && crT < 0.35))) { // barnacles
  vec3 bc = crCell(qw * 42.0 + vVar.x * 13.0);
  float bb = (1.0 - smoothstep(0.12, 0.24, bc.x)) * step(1.0 - vVar2.z, bc.z);
  crCol = mix(crCol, vec3(0.62, 0.6, 0.53), bb * 0.85); crRough = mix(crRough, 0.9, bb);
}
if (vVar2.w > 0.01 && crPart == 3.0) { // fluke pattern unique to the individual (photo-ID)
  float fp = crFbm(q * 3.2 + vVar.x * 61.0) + 0.25 * crNoise(q * 11.0 + vVar.x * 7.0);
  crCol = mix(crCol, mix(cD * 0.5, vec3(0.82, 0.83, 0.82), smoothstep(0.55, 0.62, fp)), vVar2.w);
}
if (vVar2.y > 0.01) { // faded / worn individuals
  float l = dot(crCol, vec3(0.3, 0.5, 0.2));
  crCol = mix(crCol, vec3(l) * 1.05, vVar2.y * 0.5);
}
if (glowMode == 1.0) crGlow += cA * m1.x * (0.05 + 3.0 * uGlow) * max(crGlowAmt, 0.2);
if (glowMode == 2.0) crGlow += cA * (0.03 + 1.6 * uGlow) * crGlowAmt * (crPart == 6.0 ? 0.6 : 1.0);
if (glowMode == 3.0) crGlow += cA * (0.02 + 2.5 * uGlow) * crGlowAmt * max(m1.x, m2.x);
if (glowMode == 4.0) {          // ctenophore comb rows: travelling rainbow
  float a = atan(vLoc.z, vLoc.x) * 1.2732395;
  float row = 1.0 - smoothstep(0.04, 0.12, abs(fract(a) - 0.5));
  vec3 rb = 0.5 + 0.5 * cos(6.2831853 * (vLoc.y * 5.0 - uTime * 1.7 + vec3(0.0, 0.33, 0.67)));
  crGlow += rb * row * (0.35 + 1.4 * uGlow) * crGlowAmt;
  crCol = mix(crCol, rb, row * 0.5);
}
diffuseColor.rgb = crCol;
`;

const FRAG_SHEEN = /* glsl */`
#include <aomap_fragment>
{
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 vd = normalize(vWPos - cameraPosition);
  vec3 rd = reflect(vd, wN);
  float nv = clamp(dot(-vd, wN), 0.0, 1.0);
  float fr = pow(1.0 - nv, 4.0);
  float dB = max(0.0, uSurfaceY - vWPos.y);
  float sk = skyVis(vWPos);
  vec3 env = waterColor(rd) * exp(-uLightSigma * dB * 0.6) * (0.35 + 0.65 * uAmbientScale) * sk;
  // the bright surface / Snell's window above: silvery flanks flash as they tilt toward it
  float up = clamp(rd.y, 0.0, 1.0);
  env += uSunColor * uSunScatter * (0.6 * up * up * up + 0.45 * pow(max(dot(rd, uSunDir), 0.0), 8.0)) * exp(-uLightSigma * dB) * sk;
  vec3 irid = 0.88 + 0.12 * cos(6.2831853 * (nv * 1.4 + vec3(0.0, 0.33, 0.67)));
  reflectedLight.indirectSpecular += env * irid * crSheen * (0.3 + 0.7 * fr) * 1.5;
}
`;

function patchShader(shader, jelly) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <beginnormal_vertex>', VERT_MAIN)
    .replace('#include <begin_vertex>', 'vec3 transformed = crPos;');
  let fs = shader.fragmentShader
    .replace('#include <color_fragment>', FRAG_COLOR)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = crRough;')
    .replace('#include <aomap_fragment>', FRAG_SHEEN);
  const finT = `if (crFin) {
      vec3 vdir = normalize(vWPos - cameraPosition);
      float bl = pow(max(dot(vdir, uSunDir), 0.0), 3.0);
      float dB = max(0.0, uSurfaceY - vWPos.y);
      crGlow += diffuseColor.rgb * (uSunColor * uSunScatter * bl * 0.55 * exp(-uLightSigma * dB) * skyVis(vWPos) + 0.05 * uAmbientScale);
    }
  `;
  const emis = finT + (jelly
    ? `totalEmissiveRadiance += crGlow;
       {
         float fres = 1.0 - abs(dot(normalize(vViewPosition), normal));
         float baseA = vPat2.z;
         float a = (crPart == 6.0) ? baseA * 1.3 : baseA * (0.3 + 0.9 * fres * fres);
         a = max(a, max(m1.x, m2.x) * baseA * 1.4);
         diffuseColor.a = clamp(a + dot(crGlow, vec3(0.3)) * 0.5, 0.0, 0.95);
       }`
    : 'totalEmissiveRadiance += crGlow;');
  fs = fs.replace('#include <emissivemap_fragment>', emis);
  if (jelly) fs = fs.replace('float crSheen = vPat2.z;', 'float crSheen = 0.35;');
  shader.fragmentShader = fs;
}

export function makeMaterials() {
  const opaque = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 });
  applyWater(opaque, {
    key: 'creature-v1',
    vertexHead: VERT_HEAD,
    fragmentHead: FRAG_HEAD,
    patch: (sh) => patchShader(sh, false),
  });
  const jelly = new THREE.MeshStandardMaterial({
    roughness: 0.3, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  applyWater(jelly, {
    key: 'creature-jelly-v1',
    vertexHead: VERT_HEAD,
    fragmentHead: FRAG_HEAD,
    patch: (sh) => patchShader(sh, true),
  });
  return { opaque, jelly };
}
