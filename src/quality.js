// Hardware tiers and quality presets, plus cap-aware adaptive resolution.
// Tiers: low (phones, old integrated GPUs) | medium (modern integrated, tablets) | high (discrete,
// Apple Silicon Macs) | ultra (opt-in or promoted at runtime on very fast GPUs).
// Props and creatures only distinguish 'low' from everything else (env.tier === 'low').

export const PRESETS = {
  low:    { dprMax: 1,    resStart: 0.8, msaa: 0, shaftDiv: 4, shaftSteps: 16, ao: false, fxaa: true,  shadows: false, shadowMap: 0,    caustics: 256, causticHalfRate: true },
  medium: { dprMax: 1.25, resStart: 1,   msaa: 2, shaftDiv: 3, shaftSteps: 20, ao: false, fxaa: false, shadows: false, shadowMap: 0,    caustics: 512, causticHalfRate: false },
  high:   { dprMax: 1.5,  resStart: 1,   msaa: 4, shaftDiv: 2, shaftSteps: 24, ao: true,  fxaa: false, shadows: true,  shadowMap: 2048, caustics: 512, causticHalfRate: false },
  ultra:  { dprMax: 2,    resStart: 1,   msaa: 4, shaftDiv: 2, shaftSteps: 32, ao: true,  fxaa: false, shadows: true,  shadowMap: 4096, caustics: 512, causticHalfRate: false },
};

export function gpuName(renderer) {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
}

export function detectTier(renderer, requested = 'auto') {
  if (PRESETS[requested]) return requested;
  const g = gpuName(renderer), ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS reports a Mac UA
  if (/Android|iPhone|iPod/i.test(ua)) return 'low';
  if (touchMac || /iPad/i.test(ua)) return 'medium';
  if (/SwiftShader|llvmpipe|Mali|Adreno|PowerVR|Intel\(R\) HD|Intel HD|Intel\(R\) UHD|Intel UHD/i.test(g)) return 'low';
  if (/Iris|Intel/i.test(g)) return 'medium';
  return 'high'; // discrete GPUs, Apple Silicon Macs ("Apple GPU" / "Apple M…"), unknown desktop GPUs
}

// Lowers render resolution when frames run long and raises it back when there is headroom.
export class AdaptiveResolution {
  constructor(renderer, onResize, preset, fpsCap, enabled) {
    this.renderer = renderer; this.onResize = onResize;
    this.maxDPR = Math.min(window.devicePixelRatio || 1, preset.dprMax);
    this.scale = preset.resStart;
    this.fpsCap = fpsCap; this.enabled = enabled;
    this.frameAvg = 16; this.timer = 0;
    renderer.setPixelRatio(this.maxDPR * this.scale);
  }
  get fps() { return 1000 / this.frameAvg; }
  update(dt) {
    this.frameAvg = this.frameAvg * 0.95 + dt * 1000 * 0.05;
    if (!this.enabled || document.hidden) return;
    this.timer += dt;
    if (this.timer < 2) return;
    this.timer = 0;
    const target = this.fpsCap > 0 ? Math.max(1000 / this.fpsCap, 16.6) : 16.6;
    let ns = this.scale;
    if (this.frameAvg > target * 1.2) ns = Math.max(0.5, this.scale - 0.08);
    else if (this.frameAvg < target * 1.04) ns = Math.min(1, this.scale + 0.04);
    if (ns !== this.scale) { this.scale = ns; this.renderer.setPixelRatio(this.maxDPR * this.scale); this.onResize(); }
  }
}
