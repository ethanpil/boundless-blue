// Time of day and weather: a slow cycle that keeps the same places looking new.
// Pure parameter generator — main.js applies the outputs to lights, water and post.
import { mulberry32, smoothstep } from './noise.js';

const WEATHER = {
  clear:    { w: 0.42, dur: [600, 1500], sun: 1, shafts: 1, caustic: 1, ambient: 1, sigma: [1, 1, 1], tint: [1, 1, 1], snow: 1, rain: 0, surge: 0, label: '' },
  crystal:  { w: 0.16, dur: [420, 1000], sun: 1.05, shafts: 1.25, caustic: 1.15, ambient: 1, sigma: [0.72, 0.64, 0.6], tint: [0.95, 1.0, 1.06], snow: 0.5, rain: 0, surge: 0, label: 'crystal-clear water' },
  overcast: { w: 0.17, dur: [500, 1200], sun: 0.42, shafts: 0.22, caustic: 0.3, ambient: 1.25, sigma: [1.05, 1.05, 1.05], tint: [0.9, 0.94, 0.96], snow: 1, rain: 0, surge: 0, label: 'overcast skies' },
  rain:     { w: 0.09, dur: [300, 800], sun: 0.3, shafts: 0.12, caustic: 0.22, ambient: 1.15, sigma: [1.15, 1.15, 1.15], tint: [0.88, 0.92, 0.96], snow: 1.4, rain: 1, surge: 0.25, label: 'rain on the surface' },
  plankton: { w: 0.11, dur: [400, 1000], sun: 0.95, shafts: 1.35, caustic: 0.8, ambient: 1, sigma: [1.1, 1.35, 1.95], tint: [0.86, 1.12, 0.78], snow: 2.6, rain: 0, surge: 0, label: 'a plankton bloom' },
  surge:    { w: 0.05, dur: [240, 600], sun: 1, shafts: 1.1, caustic: 1.25, ambient: 1, sigma: [1.2, 1.2, 1.2], tint: [1, 1, 1], snow: 2.2, rain: 0, surge: 1, label: 'a heavy surge' },
};
export const WEATHER_KEYS = Object.keys(WEATHER);
export const TIME_KEYS = ['dawn', 'morning', 'day', 'afternoon', 'dusk', 'night'];
const NUM = ['sun', 'shafts', 'caustic', 'ambient', 'snow', 'rain', 'surge'];
const TRANSITION = 90; // seconds to cross-fade weather

// Day phase p in [0,1): dawn ~0.97-0.05, day 0.05-0.68, dusk 0.68-0.80, night 0.80-0.97 (~11 min/hour).
const PHASES = { dawn: 0.975, morning: 0.12, day: 0.3, afternoon: 0.52, dusk: 0.72, night: 0.86 };

function daylightAt(p) {
  if (p >= 0.05 && p <= 0.68) return 1;
  if (p > 0.68 && p < 0.8) return 1 - smoothstep(0.68, 0.8, p);
  if (p >= 0.8 && p <= 0.97) return 0;
  return smoothstep(0.97, 1.05, p < 0.5 ? p + 1 : p);
}

export class Conditions {
  constructor(seed, opts = {}) {
    this.rng = mulberry32((seed ^ 0xc0ffee) >>> 0);
    this.cycle = Math.max(120, (opts.dayMinutes || 60) * 60);
    const start = opts.time && PHASES[opts.time] != null ? PHASES[opts.time] : this.rng() * 0.8 + 0.02;
    this.t = start * this.cycle;
    this.fixedWeather = opts.weather && WEATHER[opts.weather] ? opts.weather : null;
    this.cur = this.fixedWeather || this._pick(null);
    this.prev = this.cur;
    this.fade = 1;                       // 0 -> 1 while cross-fading prev -> cur
    this.timer = this._duration(this.cur);
    this.moonPhase = 0.35 + 0.65 * this.rng();
    this.out = {
      daylight: 1, night: 0, warmth: 0, elevAir: 1, azimuth: 0,
      sunMul: 1, sunColor: [1, 1, 1], ambientMul: 1, shaftMul: 1, causticMul: 1,
      sigmaMul: [1, 1, 1], tint: [1, 1, 1], snowMul: 1, rain: 0, surge: 0,
      glowAdd: 0, lampAdd: 0, exposureAdd: 0, timeLabel: '', weatherLabel: '',
    };
  }
  _pick(exclude) {
    let tot = 0;
    for (const k of WEATHER_KEYS) if (k !== exclude) tot += WEATHER[k].w;
    let r = this.rng() * tot;
    for (const k of WEATHER_KEYS) { if (k === exclude) continue; r -= WEATHER[k].w; if (r <= 0) return k; }
    return 'clear';
  }
  _duration(k) { const d = WEATHER[k].dur; return d[0] + (d[1] - d[0]) * this.rng(); }
  nextWeather() {
    this.prev = this.cur; this.cur = this._pick(this.cur); this.fade = 0; this.timer = this._duration(this.cur);
  }
  skipTime(fraction) { this.t += fraction * this.cycle; }
  // Jump to a named part of the day (dawn, morning, day, afternoon, dusk, night), keeping the day count.
  setPhase(name) {
    if (PHASES[name] == null) return;
    const day = Math.floor(this.t / this.cycle), p = PHASES[name];
    this.t = (day + (p < this.phase ? 1 : 0)) * this.cycle + p * this.cycle;
  }
  setWeather(key) {
    if (!WEATHER[key] || key === this.cur) return;
    this.prev = this.cur; this.cur = key; this.fade = 0; this.timer = this._duration(key);
  }
  // Clock time (hours, 0..24) for the current phase: night 20:00-05:00, dawn 05:00-06:30, day to 18:30, dusk to 20:00.
  get clockHours() {
    const p = this.phase;
    const seg = (a, b, h0, h1, x) => h0 + (h1 - h0) * ((x - a) / (b - a));
    if (p >= 0.05 && p < 0.68) return seg(0.05, 0.68, 6.5, 18.5, p);
    if (p >= 0.68 && p < 0.8) return seg(0.68, 0.8, 18.5, 20, p);
    if (p >= 0.8 && p < 0.97) return (seg(0.8, 0.97, 20, 29, p)) % 24;
    const q = p < 0.5 ? p + 1 : p;
    return seg(0.97, 1.05, 5, 6.5, q);
  }
  get phase() { return ((this.t / this.cycle) % 1 + 1) % 1; }

  update(dt) {
    this.t += dt;
    if (!this.fixedWeather) {
      this.timer -= dt;
      if (this.timer <= 0) this.nextWeather();
    }
    this.fade = Math.min(1, this.fade + dt / TRANSITION);
    const o = this.out, p = this.phase;

    // ---- sun / moon ----
    const daylight = daylightAt(p);
    const q = ((p - 0.97 + 1) % 1) / 0.83;                  // 0 at dawn start -> 1 at dusk end
    const elevAir = q <= 1 ? 0.06 + 1.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, q))) : 0.06;
    const warmth = smoothstep(0.5, 0.08, elevAir) * daylight;
    const sunI = daylight * (0.35 + 0.65 * Math.sin(Math.max(0.06, elevAir)));
    const moonI = (1 - daylight) * 0.11 * this.moonPhase;
    o.daylight = daylight; o.night = 1 - daylight; o.warmth = warmth; o.elevAir = elevAir;
    o.azimuth = Math.PI * 0.2 + Math.PI * Math.min(1, Math.max(0, q));
    o.sunMul = sunI + moonI;
    const wr = [1.0, 0.6, 0.32], wh = [1, 0.98, 0.93], mn = [0.55, 0.66, 0.92];
    for (let i = 0; i < 3; i++) {
      const day = wh[i] + (wr[i] - wh[i]) * warmth * 0.85;
      o.sunColor[i] = (day * sunI + mn[i] * moonI) / Math.max(1e-4, sunI + moonI);
    }

    // ---- weather blend ----
    const A = WEATHER[this.prev], B = WEATHER[this.cur], f = this.fade;
    const mix = (k) => A[k] + (B[k] - A[k]) * f;
    const wv = {};
    for (const k of NUM) wv[k] = mix(k);
    for (let i = 0; i < 3; i++) {
      o.sigmaMul[i] = A.sigma[i] + (B.sigma[i] - A.sigma[i]) * f;
      // night: deep indigo water; dusk: a touch of warmth in the light from above
      const nightTint = [0.5, 0.68, 1.25][i], duskTint = [1.12, 0.97, 0.84][i];
      const wt = A.tint[i] + (B.tint[i] - A.tint[i]) * f;
      o.tint[i] = wt * (1 + (duskTint - 1) * warmth) * (1 + (nightTint - 1) * o.night);
    }
    o.sunMul *= wv.sun;
    o.shaftMul = wv.shafts;
    o.causticMul = wv.caustic * (0.25 + 0.75 * daylight);
    o.ambientMul = wv.ambient * (0.07 + 0.93 * daylight) + 0.03 * this.moonPhase * o.night;
    o.snowMul = wv.snow;
    o.rain = wv.rain;
    o.surge = wv.surge;
    o.glowAdd = 0.65 * o.night;
    o.lampAdd = smoothstep(0.35, 0.85, o.night);
    o.exposureAdd = 1.1 * o.night + 0.25 * (1 - wv.sun);

    o.timeLabel = p < 0.06 || p >= 0.95 ? 'dawn' : p < 0.25 ? 'morning' : p < 0.42 ? 'midday' : p < 0.64 ? 'afternoon'
      : p < 0.8 ? 'dusk' : 'night';
    o.weatherLabel = (f > 0.5 ? B : A).label;
    return o;
  }
}
