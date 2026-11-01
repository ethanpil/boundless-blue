// Hardware tiers and quality presets, plus the runtime quality controller (resolution + features).
// Tiers: low (phones, old integrated GPUs) | medium (Iris / Iris Xe / Radeon integrated, tablets) |
// high (discrete GPUs, Apple Silicon) | ultra (top discrete GPUs, Apple M Max/Ultra, or ?quality=ultra).
// Props and creatures only distinguish 'low' from everything else (env.tier === 'low').
import { setWaterQuality } from './water.js';

// shaftSteps: god-ray march steps; aoSamples: SSAO taps (0 = off); bloomStart: 0 = half-res bloom, 1 = quarter;
// snow: marine-snow particles; lod: prop LOD draw distances (m ahead).
export const PRESETS = {
  low: {
    dprMax: 1, resStart: 0.8, resMin: 0.5, msaa: 0, fxaa: true, shaftDiv: 4, shaftSteps: 16, ao: false, aoSamples: 0,
    shadows: false, shadowMap: 0, caustics: 256, causticHalfRate: true, bloomStart: 1, snow: 4000, lod: { near: 45, mid: 100 },
  },
  medium: {
    dprMax: 1.25, resStart: 1, resMin: 0.55, msaa: 2, fxaa: false, shaftDiv: 3, shaftSteps: 20, ao: true, aoSamples: 8,
    shadows: false, shadowMap: 0, caustics: 512, causticHalfRate: false, bloomStart: 0, snow: 6000, lod: { near: 60, mid: 125 },
  },
  high: {
    dprMax: 1.5, resStart: 1, resMin: 0.55, msaa: 4, fxaa: false, shaftDiv: 2, shaftSteps: 28, ao: true, aoSamples: 12,
    shadows: true, shadowMap: 2048, caustics: 512, causticHalfRate: false, bloomStart: 0, snow: 8000, lod: { near: 75, mid: 160 },
  },
  ultra: {
    dprMax: 2, resStart: 1, resMin: 0.6, msaa: 4, fxaa: false, shaftDiv: 2, shaftSteps: 40, ao: true, aoSamples: 16,
    shadows: true, shadowMap: 4096, caustics: 512, causticHalfRate: false, bloomStart: 0, snow: 10000, lod: { near: 95, mid: 200 },
  },
};

let TIER = 'medium';
export const currentTier = () => TIER;
export const currentPreset = () => PRESETS[TIER];

export function gpuName(renderer) {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
}

// Top-end discrete GPUs that comfortably run ultra.
const ULTRA = /RTX\s?(30[789]0|40[789]0|50[789]0|A[456]000|[456]000 Ada)|RX\s?(6[89][05]0|7[89]00|90[67]0)|Radeon Pro W7[89]|Apple M\d+ (Max|Ultra)/i;
const PHONE = /Android|iPhone|iPod|Mobile/i;

// Tier from the GPU renderer string (ANGLE strings look like "ANGLE (Intel, Intel(R) HD Graphics 4600 ...)").
export function tierFor(g, ua = '', touchMac = false, cores = 4) {
  if (PHONE.test(ua)) return 'low';                                                // phones
  if (touchMac || /iPad/i.test(ua)) return 'medium';                               // tablets
  if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(g)) return 'low'; // CPU rasterisers
  if (/Mali|Adreno|PowerVR|Tegra|VideoCore|Immortalis/i.test(g)) return 'low';     // ARM laptops, Chromebooks
  if (!g) return cores >= 8 ? 'medium' : 'low';                                     // renderer hidden: be modest
  if (ULTRA.test(g)) return 'ultra';
  if (/Apple/i.test(g)) return 'high';                                              // Apple Silicon ("Apple M2", "Apple GPU")
  if (/Intel/i.test(g)) {
    if (/Arc\(TM\) [AB]\d{3}|Arc [AB]\d{3}/i.test(g)) return 'high';               // discrete Arc A770, B580
    return /Iris|Xe|Arc/i.test(g) ? 'medium' : 'low';                               // Iris / Xe / Arc iGPU vs HD / UHD
  }
  if (/AMD|Radeon|ATI/i.test(g)) {
    if (/RX\s?\d|Pro\s?W?\d{3,4}|R9|Vega\s?(56|64)|Radeon VII/i.test(g)) return 'high'; // discrete
    return 'medium';                                                                  // Vega / 680M / 780M integrated
  }
  if (/NVIDIA|GeForce|Quadro|RTX|GTX|Tesla/i.test(g)) {
    return /MX\s?\d|GT\s?\d{3}|NVS|GeForce \d{3}M?\b|GTX\s?(6|7)\d0M?\b/i.test(g) ? 'medium' : 'high';
  }
  return 'high'; // unknown desktop GPU: the controller steps down if it cannot keep up
}

export function detectTier(renderer, requested = 'auto') {
  let t = requested;
  if (!PRESETS[t]) {
    const ua = navigator.userAgent;
    const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS reports a Mac UA
    t = tierFor(gpuName(renderer), ua, touchMac, navigator.hardwareConcurrency || 4);
  }
  TIER = t;
  setWaterQuality(t); // baked into every water-patched shader as WQ
  return t;
}

// Feature ladder: entry 0 is the preset at full quality; each following entry is a little cheaper, ordered so the
// least visible savings come first. A 'high' tier gets an extra entry in front (ultra-like extras) that is only
// used when GPU timing shows plenty of headroom.
function featureLadder(P, bonus) {
  let f = {
    msaa: P.msaa, shaftSteps: P.shaftSteps, aoSamples: P.ao ? P.aoSamples : 0, bloomStart: P.bloomStart,
    shadowMap: P.shadows ? P.shadowMap : 0, causticHalfRate: P.causticHalfRate,
  };
  const L = [f];
  const push = (ch) => { f = Object.assign({}, f, ch); L.push(f); };
  if (f.shaftSteps > 20) push({ shaftSteps: Math.round(f.shaftSteps * 0.7) });
  if (f.bloomStart === 0) push({ bloomStart: 1 });
  if (f.aoSamples > 8) push({ aoSamples: 8 });
  if (f.shadowMap > 2048) push({ shadowMap: 2048 });
  if (f.msaa > 2) push({ msaa: 2 });
  if (f.shadowMap > 1024) push({ shadowMap: 1024 });
  if (f.aoSamples > 0) push({ aoSamples: 0 });
  if (f.msaa > 0) push({ msaa: 0 });
  if (f.shaftSteps > 12) push({ shaftSteps: 12 });
  if (!f.causticHalfRate) push({ causticHalfRate: true });
  if (bonus) L.unshift(Object.assign({}, L[0], { shaftSteps: 40, aoSamples: 16, shadowMap: P.shadows ? 4096 : 0 }));
  return L;
}

let ACTIVE = null;
// Post registers itself here when it is created, so feature changes reach it.
export function registerPost(post) { if (ACTIVE) ACTIVE.attach(post); }
// The running controller (for stats / the control deck): .scale, .level, .ladder.length, .features, .gpuMs, .fps
export const qualityController = () => ACTIVE;

// Runtime quality: lowers features and render resolution when frames run long and raises them back when there is
// headroom. GPU time comes from timer queries (post.gpuMs) when the browser offers them; otherwise from the frame
// interval. Decisions need a sustained condition, and a step up that soon proves too costly doubles the wait before
// the next try (hysteresis). Features change without popping: AO fades, shafts and bloom keep their brightness.
// Phones keep the low feature set but start at 1 CSS px per pixel, and with headroom the scale climbs past 1 toward
// the screen's own density (at most DPR 2); above 1 it is the first thing given back when frames run long.
export class AdaptiveResolution {
  constructor(renderer, onResize, preset, fpsCap, enabled) {
    this.renderer = renderer; this.onResize = onResize; this.preset = preset;
    const dpr = window.devicePixelRatio || 1, phone = preset === PRESETS.low && PHONE.test(navigator.userAgent);
    this.baseDPR = Math.min(dpr, phone ? 1 : preset.dprMax);   // pixel ratio at scale 1
    this.scaleMax = phone && enabled ? Math.max(1, Math.min(dpr, 2) / this.baseDPR) : 1;
    this.scale = phone ? 1 : preset.resStart;
    this.resMin = preset.resMin ?? 0.5;
    this.fpsCap = fpsCap; this.enabled = enabled;
    this.frameAvg = 16; this.timer = 0; this.age = 0;
    this.bonus = preset === PRESETS.high && enabled;
    this.ladder = featureLadder(preset, this.bonus);
    this.minLevel = this.bonus ? 1 : 0;            // the bonus entry unlocks once GPU timing is known to work
    this.level = this.minLevel;
    this.features = this.ladder[this.level];
    this.post = null; this.sun = null;
    this.slowFor = 0; this.roomFor = 0; this.sinceUp = 1e9; this.stableFor = 0; this.backoff = 0;
    this.lastDown = 'res'; this.lastUp = 'feat';
    renderer.setPixelRatio(this.baseDPR * this.scale);
    ACTIVE = this;
  }
  get fps() { return 1000 / this.frameAvg; }
  get gpuMs() { return this.post && this.post.gpuValid ? this.post.gpuMs : 0; }
  attach(post) {
    this.post = post;
    post.scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) this.sun = o; });
    this._apply();
  }
  _apply() {
    const f = this.features;
    if (this.post) this.post.setFeatures(f);
    this.preset.causticHalfRate = f.causticHalfRate;            // read by main.js every frame
    if (this.sun && f.shadowMap && this.sun.shadow.mapSize.x !== f.shadowMap) {
      const sh = this.sun.shadow;
      sh.mapSize.set(f.shadowMap, f.shadowMap);
      if (sh.map) { sh.map.dispose(); sh.map = null; }            // re-created at the new size on the next render
      sh.radius = 4 * f.shadowMap / 2048;                        // same softness in metres
      this.preset.shadowMap = f.shadowMap;                       // main.js snaps the shadow frustum to these texels
    }
  }
  _setScale(s) {
    this.scale = s;
    this.renderer.setPixelRatio(this.baseDPR * s);
    this.onResize();
  }
  _down() {
    const canF = this.level < this.ladder.length - 1, canR = this.scale > this.resMin + 1e-3, hi = this.scale > 1 + 1e-3;
    // density above scale 1 goes first; then mild resolution drops (down to 0.76) alternate with feature drops,
    // and deeper drops come only once features are gone
    const res = canR && (hi || !canF || (this.scale > 0.77 && this.lastDown === 'feat'));
    if (res) { this._setScale(Math.max(this.resMin, +(this.scale - (hi ? 0.1 : 0.08)).toFixed(2))); this.lastDown = 'res'; }
    else if (canF) { this.features = this.ladder[++this.level]; this._apply(); this.lastDown = 'feat'; }
    if (this.sinceUp < 12) this.backoff = Math.min(5, this.backoff + 1); // the last step up was too optimistic
    this.stableFor = 0;
  }
  _up() {
    const canF = this.level > this.minLevel, canR = this.scale < this.scaleMax - 1e-3, hi = this.scale > 1 - 1e-3;
    // past scale 1 (phones) only once every feature is back
    const res = canR && (this.scale < 0.76 || !canF || (this.lastUp === 'feat' && !hi));
    if (res) { this._setScale(Math.min(hi ? this.scaleMax : 1, +(this.scale + (hi ? 0.1 : 0.04)).toFixed(2))); this.lastUp = 'res'; }
    else if (canF) { this.features = this.ladder[--this.level]; this._apply(); this.lastUp = 'feat'; }
    else return;
    this.sinceUp = 0;
  }
  update(dt) {
    this.frameAvg = this.frameAvg * 0.95 + dt * 1000 * 0.05;
    if (!this.enabled || document.hidden) { this.slowFor = this.roomFor = 0; return; }
    this.age += dt; this.sinceUp += dt; this.stableFor += dt;
    this.timer += dt;
    if (this.timer < 0.5) return;
    const win = this.timer; this.timer = 0;
    if (this.age < 5) return; // shader compiles and the first chunk builds
    if (this.stableFor > 90 && this.backoff > 0) { this.backoff--; this.stableFor = 0; }
    const target = this.fpsCap > 0 ? Math.max(1000 / this.fpsCap, 16.6) : 16.6;
    const gpu = this.gpuMs;
    if (gpu && this.bonus && this.minLevel > 0) this.minLevel = 0;
    // slow: frames miss the cap (and, when GPU time is known, the GPU is the reason); room: clear headroom
    const slow = gpu ? gpu > target * 0.92 && this.frameAvg > target * 1.05 : this.frameAvg > target * 1.1;
    let room = gpu ? gpu < target * 0.62 && this.frameAvg < target * 1.08 : this.frameAvg < target * 1.03;
    if (this.level === 1 && this.minLevel === 0 && this.scale >= 1) room = room && gpu < target * 0.4; // bonus extras
    this.slowFor = slow ? this.slowFor + win : 0;
    this.roomFor = room ? this.roomFor + win : 0;
    const resStep = this.scale < 0.76 || this.level <= this.minLevel || this.lastUp === 'feat';
    const wait = (resStep ? 2 : 4) * 2 ** this.backoff;
    if (this.slowFor >= 2) { this._down(); this.slowFor = this.roomFor = 0; }
    else if (this.roomFor >= wait) { this._up(); this.roomFor = 0; }
  }
}
