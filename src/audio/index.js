// Ambient sound: procedural WebAudio, no audio files. Buffers are generated once in unlock() (a few tens of ms);
// update() steers the mix at 4 Hz and fires rare one-shot calls. main.js: new Ambience(env, app); unlock() on the
// first user gesture; setEnabled(b); setVolume(v); update(dt). `active` is true only while the context runs.
//
// Layers (one bus each, see levels()):
//   base     brown noise -> highpass/lowpass room tone: bright when shallow, ~140 Hz in the deep; two slow swell LFOs
//   wash     pink noise -> bandpass with a wave-period swell, plus wave slaps (fx); shallow and open to the sky only
//   hum      faint 41/62/83 Hz drone in abyss, deep plain, vents, hadal
//   shrimp   snapping-shrimp crackle (two offset loops at different rates) on reefs, seagrass, mangrove, tidepools...
//   vent     brown-noise rumble at vents/champagne; bubbles: a looped generated bubble stream
//   surge    pink-noise whoosh pulsing at ~0.1 Hz (kelp zones, surge weather)
//   rain     muffled drop patter when it rains and the surface is open overhead
//   fx       one-shots: wave slaps, cave drips, ice creaks/groans/pings, kelp creaks
//   life     calls of the nearest calling animal (whale song/moans/clicks, dolphin whistles and click trains, orca
//            calls, seal trills/moans, sea lion barks, beluga chirps, narwhal clicks), diver exhale bubbles, distant song in open water
//   reverb   one generated impulse response; caves and ice send base and fx, distant animals send most of their call
// Mix: buses -> master (volume, enable) -> compressor -> limiter -> out. Disabled or hidden: ramp down, then suspend.

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const R = (a, b) => a + (b - a) * Math.random();
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const LAYERS = ['base', 'wash', 'hum', 'shrimp', 'vent', 'bubbles', 'surge', 'rain', 'fx', 'life', 'reverb'];
const STEERED = LAYERS.slice(0, 8); // buses whose gain follows the zone mix

// Per-zone amounts (0..1), blended by the sequence weights. song/seal: chance of distant calls with no animal near.
const Z0 = { shrimp: 0, kelp: 0, vent: 0, bubbles: 0, ice: 0, cave: 0, hum: 0, song: 0, seal: 0, wash: 1 };
const PROFILE = {
  reef: { shrimp: 0.9 }, softcoral: { shrimp: 0.7 }, wall: { shrimp: 0.4, song: 0.3 }, kelp: { kelp: 1, shrimp: 0.3 },
  seagrass: { shrimp: 0.8 }, mangrove: { shrimp: 1 }, sandflat: { shrimp: 0.4 }, pelagic: { song: 1 }, cave: { cave: 1 },
  wreck: { shrimp: 0.3 }, ruins: { shrimp: 0.3 }, vents: { vent: 1, bubbles: 0.5, hum: 0.5 }, deepplain: { hum: 0.6 },
  tidepool: { shrimp: 0.8, wash: 1.5 }, abyss: { hum: 0.8, song: 0.3 }, polar: { ice: 1, song: 0.3, seal: 0.6 },
  seamount: { shrimp: 0.3, song: 0.6 }, sargassum: { song: 0.5 }, champagne: { bubbles: 1, vent: 0.3, shrimp: 0.4 },
  jellylake: {}, sunkenforest: { kelp: 0.5 }, anemone: { shrimp: 0.7 }, bluehole: { cave: 0.4, song: 0.3 },
  otterkelp: { kelp: 1, shrimp: 0.4, wash: 1.3 }, whaleshark: { song: 0.7 }, biobay: { shrimp: 0.9 },
  iceedge: { ice: 0.8, song: 0.6, seal: 1 }, hadal: { hum: 1 },
};
for (const k in PROFILE) PROFILE[k] = { ...Z0, ...PROFILE[k] };
// species key -> call voice
const CALLS = {
  humpback: 'humpback', blueWhale: 'blue', spermWhale: 'sperm', orca: 'orca', pilotWhale: 'pilot', bottlenose: 'dolphin',
  commonDolphin: 'dolphin', beluga: 'beluga', narwhal: 'narwhal', weddellSeal: 'weddell', leopardSeal: 'leopard', harbourSeal: 'leopard',
  seaLion: 'sealion',
};
// seconds between calls while that animal is near
const GAP = { humpback: [5, 16], blue: [14, 34], sperm: [8, 22], orca: [3, 10], pilot: [3, 9], dolphin: [2.5, 9],
  beluga: [2, 6], narwhal: [4, 10], weddell: [5, 14], leopard: [6, 16], sealion: [3, 10] };

// ---------- generated buffers ----------
// Seamless loop: render len + F samples, then equal-power crossfade the overshoot into the start.
function loopBuffer(ctx, sec, fill, rms = 0.2) {
  const sr = ctx.sampleRate, len = Math.round(sec * sr), F = Math.round(0.25 * sr);
  const x = new Float32Array(len + F); fill(x, sr);
  const buf = ctx.createBuffer(1, len, sr), b = buf.getChannelData(0);
  b.set(x.subarray(0, len));
  for (let i = 0; i < F; i++) { const w = i / F; b[i] = x[i] * Math.sqrt(w) + x[len + i] * Math.sqrt(1 - w); }
  let e = 0; for (let i = 0; i < len; i += 7) e += b[i] * b[i];
  const k = rms / Math.sqrt(e / Math.ceil(len / 7) || 1);
  for (let i = 0; i < len; i++) b[i] *= k;
  return buf;
}
function pink(x) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < x.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
  }
}
function brown(x) { let l = 0; for (let i = 0; i < x.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; x[i] = l; } }
// snapping shrimp: dense broadband snaps, most faint (power-law amplitudes), wrapped around the loop
function crackle(x, sr) {
  const n = x.length, count = Math.round(n / sr * 420);
  for (let k = 0; k < count; k++) {
    const p = (Math.random() * n) | 0, a = (0.1 + 0.9 * Math.random() ** 4) * (Math.random() < 0.5 ? -1 : 1);
    const tau = sr * R(0.00012, 0.0004);
    for (let j = 0; j < 6 * tau; j++) x[(p + j) % n] += a * Math.exp(-j / tau) * (j === 0 ? 1 : Math.random() * 2 - 1);
  }
}
// one bubble: Minnaert ring with the upward chirp of a rising bubble
function bubble(x, i0, f0, amp, sr) {
  const tau = 1 / (Math.PI * f0 * R(0.04, 0.08)) * sr, n = Math.min(x.length - i0, (5 * tau) | 0), chirp = R(0.1, 0.5);
  let ph = 0;
  for (let j = 0; j < n; j++) { ph += 2 * Math.PI * f0 * (1 + chirp * j / tau) / sr; x[i0 + j] += amp * Math.sin(ph) * Math.exp(-j / tau); }
}
function bubbleStream(x, sr) {
  let t = 0;
  while (t < x.length) { // clustered: bursts of a few bubbles, then a pause
    const m = 1 + ((Math.random() * 5) | 0);
    for (let k = 0; k < m && t < x.length; k++) { bubble(x, t, R(500, 2200), R(0.2, 1), sr); t += (sr * R(0.01, 0.05)) | 0; }
    t += (sr * R(0.02, 0.25)) | 0;
  }
}
function rainPatter(x, sr) {
  const n = x.length, count = Math.round(n / sr * 520);
  for (let k = 0; k < count; k++) {
    const p = (Math.random() * n) | 0, f = R(1200, 5200), a = 0.05 + 0.95 * Math.random() ** 3, tau = sr * R(0.002, 0.006);
    x[p] += a * 0.6 * (Math.random() * 2 - 1);
    for (let j = 1; j < 6 * tau; j++) x[(p + j) % n] += a * Math.sin(2 * Math.PI * f * j / sr) * Math.exp(-j / tau);
  }
}
// a diver's exhale: a rush of large bubbles that tapers off
function exhale(ctx) {
  const sr = ctx.sampleRate, len = Math.round(1.6 * sr), buf = ctx.createBuffer(1, len, sr), x = buf.getChannelData(0);
  for (let k = 0; k < 70; k++) {
    const t = Math.random() ** 1.6 * 1.3;
    bubble(x, (t * sr) | 0, R(250, 1100), (1 - t / 1.4) * R(0.15, 0.5), sr);
  }
  return buf;
}
// clicks: 'tick' (dolphin, narwhal) and 'knock' (sperm whale: multi-pulse)
function click(ctx, knock) {
  const sr = ctx.sampleRate, len = Math.round(0.03 * sr), buf = ctx.createBuffer(1, len, sr), x = buf.getChannelData(0);
  const pulses = knock ? 4 : 1, tau = sr * (knock ? 0.0009 : 0.00018);
  for (let p = 0; p < pulses; p++) {
    const i0 = Math.round(p * 0.0045 * sr), a = Math.pow(0.55, p);
    for (let j = 0; i0 + j < len && j < 8 * tau; j++) x[i0 + j] += a * Math.exp(-j / tau) * (Math.random() * 2 - 1);
  }
  return buf;
}
// stereo impulse: early reflections, then a decaying noise tail that darkens with time
function impulse(ctx, sec) {
  const sr = ctx.sampleRate, len = Math.round(sec * sr), buf = ctx.createBuffer(2, len, sr), pre = Math.round(0.008 * sr);
  for (let c = 0; c < 2; c++) {
    const x = buf.getChannelData(c);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr, a = 0.85 - 0.75 * Math.min(1, t / sec);
      y += a * ((Math.random() * 2 - 1) - y);
      x[i] = y * Math.exp(-6.9 * t / sec);
    }
    for (let k = 0; k < 8; k++) x[pre + ((R(0.004, 0.06) * sr) | 0)] += R(-0.6, 0.6);
  }
  return buf;
}

export class Ambience {
  constructor(env, app) {
    this.env = env; this.app = app;
    this.active = false; this.enabled = true; this.volume = 0.6;
    this.ctx = null; this.unlocked = false;
    this.voices = 0; this.cap = env && env.tier === 'low' ? 8 : 12;
    this.Z = { ...Z0 };   // blended zone amounts
    this.mix = {};        // latest bus targets (debug)
    this.near = { kind: '', d: 1e9, pan: 0 };
    this.diverD = 1e9; this.diverPan = 0;
    this._next = 0; this._scan = 0; this._susT = 0; this._lifeFar = true;
    this._due = { slap: 0, drip: 0, ice: 0, kelp: 0, life: 0, diver: 0 };
    this._curve = new Float32Array(16); // reused frequency contours (setValueCurveAtTime copies it)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => (document.hidden ? this._suspend() : this._resume()));
  }

  unlock() {
    if (!AC) return;
    if (!this.ctx) { try { this._build(); } catch (e) { this.ctx = null; return; } }
    this.unlocked = true;
    this._resume();
  }
  setEnabled(b) { this.enabled = !!b; if (this.enabled) this._resume(); else this._suspend(); }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    if (this.ctx && this.enabled) this.master.gain.setTargetAtTime(this._level(), this.ctx.currentTime, 0.15);
  }
  _level() { return 0.9 * Math.pow(this.volume, 1.6); }
  _resume() {
    const c = this.ctx;
    if (!c || !this.unlocked || !this.enabled || c.state === 'closed' || (typeof document !== 'undefined' && document.hidden)) return;
    clearTimeout(this._susT);
    if (c.state !== 'running') c.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(c.currentTime);
    this.master.gain.setTargetAtTime(this._level(), c.currentTime, 0.5);
  }
  _suspend() {
    const c = this.ctx;
    if (!c || c.state === 'closed') return;
    this.master.gain.cancelScheduledValues(c.currentTime);
    this.master.gain.setTargetAtTime(0, c.currentTime, 0.06);
    clearTimeout(this._susT);
    this._susT = setTimeout(() => {
      if (!this.enabled || (typeof document !== 'undefined' && document.hidden)) c.suspend().catch(() => {});
    }, 400);
  }

  // ---------- graph ----------
  _build() {
    const c = this.ctx = new AC({ latencyHint: 'playback' });
    c.onstatechange = () => { this.active = c.state === 'running'; };
    this.buf = {
      pink: loopBuffer(c, 5.3, pink), brown: loopBuffer(c, 6.1, brown), shrimp: loopBuffer(c, 4.7, crackle, 0.15),
      bubbles: loopBuffer(c, 5.9, bubbleStream, 0.15), rain: loopBuffer(c, 3.9, rainPatter, 0.15),
      exhale: [exhale(c), exhale(c)], tick: click(c, false), knock: click(c, true),
    };
    const g = (v, to) => { const n = c.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
    const f = (type, hz, q, to) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = hz; n.Q.value = q; if (to) n.connect(to); return n; };
    const src = (b, rate = 1) => { const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * b.duration); return s; };
    const lfo = (hz, depth, param) => { const o = c.createOscillator(); o.frequency.value = hz; o.connect(g(depth, param)); o.start(); return o; };

    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.12;
    lim.connect(c.destination);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.03; comp.release.value = 0.4;
    comp.connect(lim);
    this.master = g(0, comp);
    const bus = this.bus = {};
    for (const k of LAYERS) bus[k] = g(k === 'fx' || k === 'life' || k === 'reverb' ? 1 : 0, this.master);

    // reverb (shorter impulse on the low tier)
    this.conv = c.createConvolver(); this.conv.buffer = impulse(c, this.env && this.env.tier === 'low' ? 1.5 : 2.6);
    this.revIn = g(1, this.conv); this.conv.connect(bus.reverb);

    const brownS = src(this.buf.brown), pinkS = src(this.buf.pink);
    // base: brown -> highpass 35 -> lowpass (depth) -> swell -> bus
    const swell = g(1, bus.base);
    this.baseLP = f('lowpass', 800, 0.4, swell);
    brownS.connect(f('highpass', 35, 0.7, this.baseLP));
    lfo(0.043, 0.22, swell.gain); lfo(0.0291, 0.16, swell.gain);
    this.baseRev = g(0, this.revIn); bus.base.connect(this.baseRev);
    // wash: pink -> bandpass, wave swell
    const wsw = g(1, bus.wash);
    pinkS.connect(f('bandpass', 520, 0.7, wsw));
    lfo(0.11, 0.6, wsw.gain);
    // hum
    for (const [hz, a] of [[41.2, 1], [61.9, 0.55], [82.6, 0.3]]) { const o = c.createOscillator(); o.frequency.value = hz; o.connect(g(a, bus.hum)); o.start(); lfo(R(0.02, 0.05), 0.6, o.detune); }
    // shrimp: two offset loops at different rates never line up
    const shp = f('highpass', 1800, 0.6, f('lowpass', 7000, 0.5, bus.shrimp));
    src(this.buf.shrimp, 1).connect(shp); src(this.buf.shrimp, 0.93).connect(shp);
    // vent rumble + bubble stream
    const vsw = g(1, bus.vent);
    brownS.connect(f('lowpass', 110, 1.2, vsw)); lfo(0.17, 0.35, vsw.gain);
    src(this.buf.bubbles, 1).connect(f('lowpass', 3500, 0.5, bus.bubbles));
    // surge: pink -> lowpass, slow pulsing
    const ssw = g(1, bus.surge);
    pinkS.connect(f('lowpass', 420, 0.6, ssw)); lfo(0.09, 0.9, ssw.gain);
    // rain: muffled from above
    this.rainLP = f('lowpass', 2000, 0.5, bus.rain);
    src(this.buf.rain, 1).connect(this.rainLP);
    this.fxRev = g(0.3, this.revIn); bus.fx.connect(this.fxRev);
  }

  // ---------- 4 Hz control ----------
  update() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    if (now < this._next) return;
    this._next = now + 0.25;
    this._steer(now);
    if (now >= this._scan) { this._scan = now + 1; this._look(); }
    this._events(now);
  }

  _steer(now) {
    const env = this.env, cam = env.camera.position, O = window.__ocean || {}, C = (O.conditions && O.conditions.out) || {};
    const Oz = -env.world.position.z, s = -(cam.z + Oz);
    const Z = this.Z; for (const k in Z0) Z[k] = 0;
    let off = 0;
    const offs = (this.app && this.app.depthOffsets) || {};
    for (const e of env.seq.weights(s)) {
      const p = PROFILE[e.key] || Z0;
      for (const k in Z0) Z[k] += p[k] * e.w;
      off += (offs[e.key] || 0) * e.w;
    }
    const camD = Math.max(0, -cam.y), D = camD + off;
    const head = env.shape.ceilingAt(cam.x, s) - cam.y;           // ice, cave roof or rock overhead
    const cover = clamp01((60 - head) / 50), open = 1 - cover;
    const night = C.night || 0, rain = C.rain || 0, surge = C.surge || 0;
    const shallow = Math.exp(-camD / 9), bright = Math.exp(-D / 45);
    Z.wash *= shallow * open; Z.iceAmt = Z.ice * (0.4 + 0.6 * cover); Z.caveAmt = Z.cave * cover;
    const m = this.mix;
    m.base = 0.5 * (0.35 + 0.65 * Math.exp(-D / 600));
    m.wash = 0.3 * Z.wash;
    m.hum = 0.022 * Z.hum;
    m.shrimp = 0.38 * Z.shrimp * (0.8 + 0.5 * night) * Math.exp(-camD / 70);
    m.vent = 0.4 * Z.vent;
    m.bubbles = 0.35 * Z.bubbles;
    m.surge = 0.35 * Math.min(1, 0.5 * Z.kelp + surge) * Math.exp(-camD / 30);
    m.rain = 0.4 * rain * Math.exp(-camD / 20) * open;
    for (const k of STEERED) this.bus[k].gain.setTargetAtTime(m[k], now, 0.8);
    this.baseLP.frequency.setTargetAtTime(140 + 1100 * bright, now, 1);
    this.rainLP.frequency.setTargetAtTime(500 + 1800 * Math.exp(-camD / 15), now, 1);
    this.baseRev.gain.setTargetAtTime(0.5 * (Z.caveAmt + 0.6 * Z.iceAmt), now, 1);
    this.fxRev.gain.setTargetAtTime(0.25 + 0.6 * Math.max(Z.caveAmt, Z.iceAmt), now, 1);
  }

  // nearest calling animal and nearest diver (once a second; reads encounter state, allocates nothing)
  _look() {
    const O = window.__ocean || {}, cam = this.env.camera.position, Oz = -this.env.world.position.z;
    const me = this.env.camera.matrixWorld.elements, rx = me[0], ry = me[1], rz = me[2]; // camera right
    const n = this.near; n.kind = ''; n.d = 1e9;
    const enc = O.creatures && O.creatures.enc;
    if (enc) for (const e of enc) {
      const kind = !e.done && e.fade > 0.3 && e.sp && CALLS[e.sp.key];
      if (!kind || e.dist > 90 || e.dist >= n.d) continue;
      const b = e.bounds, dx = b.x - cam.x, dy = b.y - cam.y, dz = e.anchorZ + b.z - Oz - cam.z;
      n.kind = kind; n.d = e.dist; n.pan = 0.8 * Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / (Math.hypot(dx, dy, dz) || 1)));
    }
    this.diverD = 1e9;
    const a = O.surprises && O.surprises.active;
    if (a && !a.done && a.kind === 'divers' && a.divers) for (const d of a.divers) {
      const dx = d.x - cam.x, dy = d.y - cam.y, dz = d.z - Oz - cam.z, dd = Math.hypot(dx, dy, dz);
      if (dd < this.diverD) { this.diverD = dd; this.diverPan = 0.8 * Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / (dd || 1))); }
    }
  }

  _events(now) {
    const Z = this.Z, due = this._due, full = this.voices >= this.cap;
    const fire = (k, amt, lo, hi, fn) => {
      if (now < due[k]) return;
      if (amt < 0.08) { due[k] = now + R(lo, hi); return; }
      if (!full) fn(now + R(0.05, 0.3), amt);
      due[k] = now + R(lo, hi) / Math.min(1, amt + 0.15);
    };
    fire('slap', Z.wash, 1.5, 6, (t, a) => this._slap(t, a));
    fire('drip', Z.caveAmt, 0.8, 5, (t, a) => this._drip(t, a));
    fire('ice', Z.iceAmt, 3, 14, (t, a) => { const r = Math.random(); r < 0.45 ? this._creak(t, a, false) : r < 0.75 ? this._groan(t, a) : this._ping(t, a); });
    fire('kelp', Z.kelp, 4, 15, (t, a) => this._creak(t, a * 0.6, true));
    if (now >= due.diver) {
      due.diver = now + R(4, 7);
      if (this.diverD < 45 && !full) this._exhale(now + 0.05, this.diverD, this.diverPan);
    }
    // an animal arriving cuts short the long wait that follows a distant call
    if (this.near.kind && this._lifeFar) { this._lifeFar = false; due.life = Math.min(due.life, now + R(1, 4)); }
    if (now >= due.life) {
      const n = this.near;
      this._lifeFar = !n.kind;
      if (n.kind) {
        if (!full) this._call(n.kind, now + 0.1, n.d, n.pan);
        const gp = GAP[n.kind]; due.life = now + R(gp[0], gp[1]);
      } else { // far away, unseen: whale song in open water, seals under the ice
        const r = Math.random();
        if (!full && r < 0.5 * Z.song) this._call(pick(['humpback', 'humpback', 'blue', 'sperm']), now + 0.1, R(250, 600), R(-0.7, 0.7));
        else if (!full && r > 1 - 0.5 * Z.seal) this._call(pick(['weddell', 'weddell', 'leopard']), now + 0.1, R(120, 300), R(-0.7, 0.7));
        due.life = now + R(30, 100);
      }
    }
  }

  // ---------- one-shot helpers ----------
  // voice output: gain -> lowpass -> pan -> bus, plus a reverb send. Returns the input gain.
  _out(pan, lp, gain, wet, bus) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter();
    g.gain.value = gain; f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5;
    g.connect(f);
    let o = f;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; f.connect(p); o = p; }
    o.connect(bus);
    if (wet > 0) { const w = c.createGain(); w.gain.value = wet; o.connect(w); w.connect(this.revIn); }
    return g;
  }
  // a call heard from d metres: quieter, darker and wetter with distance
  _far(d, pan, level, lpMax = 9000) {
    return this._out(pan, Math.min(lpMax, 500 + 9000 * Math.exp(-d / 35)), level / (1 + d / 25), Math.min(0.9, 0.15 + d / 120), this.bus.life);
  }
  // count a voice until its last source ends, then drop its chain
  _hold(src, head) { this.voices++; src.onended = () => { this.voices--; head.disconnect(); }; }
  _env(param, t, a, peak, hold, rel) {
    param.setValueAtTime(0, t); param.linearRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + a + hold); param.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    return t + a + hold + rel;
  }
  _osc(type, hz, to) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = hz; if (to) o.connect(to); return o; }
  _gain(v, to) { const g = this.ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  _shot(buf, t, rate, to, offset = 0, dur) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.connect(to);
    if (dur) s.start(t, offset, dur); else s.start(t, offset);
    return s;
  }
  // smooth random contour between lo and hi into this._curve
  _contour(lo, hi) {
    const k = this._curve, p = R(0.5, 2), ph = R(0, 6.28), tr = R(-0.6, 0.6), mid = Math.sqrt(lo * hi), span = Math.log2(hi / lo) / 2;
    for (let i = 0; i < 16; i++) { const u = i / 15; k[i] = mid * Math.pow(2, Math.max(-span, Math.min(span, span * (0.8 * Math.sin(ph + u * p * Math.PI) + tr * (u - 0.5))))); }
    return k;
  }

  // ---------- environment one-shots ----------
  _slap(t, a) {
    const head = this._out(R(-0.6, 0.6), 3000, 0.5 * a, 0, this.bus.fx), c = this.ctx;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = R(250, 700); bp.Q.value = 0.9;
    const e = this._gain(0, head); bp.connect(e);
    const end = this._env(e.gain, t, R(0.03, 0.08), 1, 0.05, R(0.3, 0.8));
    const s = this._shot(this.buf.pink, t, R(0.8, 1.2), bp, R(0, 4)); s.stop(end + 0.05); this._hold(s, head);
  }
  _drip(t, a) {
    const head = this._out(R(-0.7, 0.7), 4500, 0.2 * Math.min(1, a), 0.85, this.bus.fx);
    for (let i = Math.random() < 0.25 ? 2 : 1; i > 0; i--) {
      const f0 = R(700, 2200), e = this._gain(0, head), o = this._osc('sine', f0, e);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(1.3, 2), t + 0.03);
      const end = this._env(e.gain, t, 0.002, 1, 0, R(0.08, 0.2));
      o.start(t); o.stop(end + 0.02);
      if (i === 1) this._hold(o, head);
      t += R(0.1, 0.4);
    }
  }
  // stick-slip creak: a jittery low sawtooth through a resonant band (ice: high and sharp; kelp/wood: low and soft)
  _creak(t, a, soft) {
    const c = this.ctx, head = this._out(R(-0.8, 0.8), soft ? 1500 : 4000, (soft ? 0.25 : 0.3) * Math.min(1, a), soft ? 0.2 : 0.5, this.bus.fx);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = soft ? R(180, 520) : R(500, 1800); bp.Q.value = soft ? 5 : 7;
    const e = this._gain(0, head); bp.connect(e);
    const o = this._osc('sawtooth', 10, bp), dur = soft ? R(0.6, 1.6) : R(1, 3);
    o.frequency.setValueCurveAtTime(this._contour(soft ? 3 : 6, soft ? 14 : 35), t, dur);
    const end = this._env(e.gain, t, 0.15, 1, dur - 0.4, 0.25);
    o.start(t); o.stop(end + 0.02); this._hold(o, head);
  }
  _groan(t, a) {
    const c = this.ctx, head = this._out(R(-0.8, 0.8), 600, 0.35 * Math.min(1, a), 0.6, this.bus.fx);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = R(250, 450); lp.Q.value = 5;
    const e = this._gain(0, head); lp.connect(e);
    const f0 = R(35, 80), dur = R(2, 5), o = this._osc('sawtooth', f0, lp);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(0.7, 1.4), t + dur);
    const end = this._env(e.gain, t, 0.6, 1, dur - 1.4, 0.8);
    o.start(t); o.stop(end + 0.02); this._hold(o, head);
  }
  _ping(t, a) {
    const head = this._out(R(-0.8, 0.8), 8000, 0.08 * Math.min(1, a), 0.8, this.bus.fx);
    const f0 = R(1500, 4500), e = this._gain(0, head), o = this._osc('sine', f0, e), dur = R(1, 2.5);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.97, t + dur);
    const end = this._env(e.gain, t, 0.003, 1, 0, dur);
    o.start(t); o.stop(end + 0.02); this._hold(o, head);
  }
  _exhale(t, d, pan) {
    const head = this._out(pan, 600 + 7000 * Math.exp(-d / 15), 0.5 / (1 + d / 8), 0.2, this.bus.life);
    const s = this._shot(pick(this.buf.exhale), t, R(0.85, 1.15), head); this._hold(s, head);
  }

  // ---------- animal calls ----------
  _call(kind, t, d, pan) {
    const c = this.ctx;
    if (kind === 'humpback') { // song phrase: 3-7 units with glides, some growled (FM)
      const head = this._far(d, pan, 0.5, 3000), base = R(110, 380);
      let last = null;
      for (let i = 3 + ((Math.random() * 5) | 0); i > 0; i--) {
        const f0 = base * Math.pow(2, R(-1, 1.2)), dur = R(0.5, 2), e = this._gain(0, head);
        const o = this._osc(Math.random() < 0.6 ? 'sine' : 'triangle', f0, e), m = this._osc('sine', f0 * pick([0.5, 1, 1.5, 2, 3]));
        const fp = o.frequency, sh = (Math.random() * 4) | 0;
        fp.setValueAtTime(f0 * [1, 1.6, 0.8, 1][sh], t);
        if (sh === 2) { fp.exponentialRampToValueAtTime(f0 * 1.5, t + dur / 2); fp.exponentialRampToValueAtTime(f0 * 0.9, t + dur); }
        else fp.exponentialRampToValueAtTime(f0 * [R(1.4, 2.5), 0.5, 1, 1.05][sh], t + dur);
        m.connect(this._gain(f0 * (Math.random() < 0.4 ? R(0.3, 1.5) : R(0, 0.15)), fp));
        const end = this._env(e.gain, t, 0.12, R(0.5, 1), Math.max(0, dur - 0.4), 0.3);
        o.start(t); m.start(t); o.stop(end); m.stop(end); last = o;
        t = end + R(0.15, 1.2);
      }
      this._hold(last, head);
    } else if (kind === 'blue') { // long low downsweep with its harmonics (the fundamental alone is below most speakers)
      const head = this._far(d, pan, 0.5, 800), e = this._gain(0, head), f0 = R(48, 55), dur = R(7, 12);
      const end = this._env(e.gain, t, 1.5, 1, dur - 3.5, 2);
      let last = null;
      for (const [h, a] of [[1, 1], [2, 0.6], [3, 0.35]]) {
        const o = this._osc('sine', f0 * h, this._gain(a, e));
        o.frequency.setValueAtTime(f0 * h, t); o.frequency.exponentialRampToValueAtTime(f0 * h * R(0.8, 0.88), t + dur);
        o.start(t); o.stop(end); last = o;
      }
      this._hold(last, head);
    } else if (kind === 'sperm') { // slow regular clicks, or a quick coda
      const head = this._far(d, pan, 0.7, 4000), coda = Math.random() < 0.4, n = coda ? 3 + ((Math.random() * 5) | 0) : 6 + ((Math.random() * 9) | 0);
      const gap = coda ? R(0.1, 0.25) : R(0.5, 1.2);
      let s = null;
      for (let i = 0; i < n; i++) { s = this._shot(this.buf.knock, t, R(0.9, 1.1), this._gain(R(0.6, 1), head)); t += gap * R(0.9, 1.1); }
      this._hold(s, head);
    } else if (kind === 'dolphin' || kind === 'pilot') {
      const lo = kind === 'pilot' ? 2500 : 4500, hi = kind === 'pilot' ? 8000 : 13000;
      if (Math.random() < 0.55) { // whistles, sometimes two animals overlapping
        const head = this._far(d, pan, 0.18);
        let last = null, lastEnd = 0;
        for (let i = Math.random() < 0.35 ? 2 : 1; i > 0; i--) {
          const dur = R(0.4, 1.4), e = this._gain(0, head), o = this._osc('sine', lo, e);
          o.frequency.setValueCurveAtTime(this._contour(lo, hi), t, dur);
          const end = this._env(e.gain, t, 0.04, 1, dur - 0.12, 0.08);
          o.start(t); o.stop(end + 0.02);
          if (end > lastEnd) { last = o; lastEnd = end; } // the chain lives until the later whistle ends
          t += R(0.2, 0.9);
        }
        this._hold(last, head);
      } else { // echolocation train, often closing into a buzz
        const head = this._far(d, pan, 0.3), n = 15 + ((Math.random() * 25) | 0), buzz = Math.random() < 0.6;
        let ici = R(0.04, 0.09), s = null;
        for (let i = 0; i < n; i++) { s = this._shot(this.buf.tick, t, R(0.8, 1.3), this._gain(R(0.5, 1), head)); t += ici; if (buzz) ici = Math.max(0.006, ici * 0.9); }
        this._hold(s, head);
      }
    } else if (kind === 'orca') { // pulsed call: harsh tone with a pitch step
      const head = this._far(d, pan, 0.12, 3000), e = this._gain(0, head), f0 = R(700, 1400), dur = R(0.6, 1.5);
      const o = this._osc('sawtooth', f0, e);
      o.frequency.setValueAtTime(f0, t); o.frequency.setValueAtTime(f0 * R(1.2, 1.6), t + dur * R(0.3, 0.6));
      o.frequency.exponentialRampToValueAtTime(f0 * R(0.8, 1.1), t + dur);
      const end = this._env(e.gain, t, 0.05, 1, dur - 0.15, 0.1);
      o.start(t); o.stop(end + 0.02); this._hold(o, head);
    } else if (kind === 'beluga') { // bursts of short chirps
      const head = this._far(d, pan, 0.16);
      let last = null;
      for (let i = 3 + ((Math.random() * 6) | 0); i > 0; i--) {
        const f0 = R(1000, 4000), dur = R(0.08, 0.3), e = this._gain(0, head), o = this._osc('sine', f0, e);
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? R(1.3, 2) : R(0.5, 0.8)), t + dur);
        const end = this._env(e.gain, t, 0.01, 1, dur - 0.04, 0.03);
        o.start(t); o.stop(end + 0.02); last = o;
        t = end + R(0.05, 0.25);
      }
      this._hold(last, head);
    } else if (kind === 'narwhal') { // slower click train with a low knock now and then
      const head = this._far(d, pan, 0.35), n = 10 + ((Math.random() * 20) | 0), ici = R(0.03, 0.12);
      let s = null;
      for (let i = 0; i < n; i++) { s = this._shot(Math.random() < 0.1 ? this.buf.knock : this.buf.tick, t, R(0.6, 0.8), this._gain(R(0.5, 1), head)); t += ici * R(0.85, 1.15); }
      this._hold(s, head);
    } else if (kind === 'weddell') { // descending trills, each starting lower
      const head = this._far(d, pan, 0.2, 7000);
      let f0 = R(2500, 5000), last = null;
      for (let i = 1 + ((Math.random() * 3) | 0); i > 0; i--) {
        const dur = R(2, 5), e = this._gain(0, head), am = this._gain(0.5, e), o = this._osc('sine', f0, am), l = this._osc('sine', R(8, 22));
        l.connect(this._gain(0.5, am.gain));
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(R(200, 500), t + dur);
        const end = this._env(e.gain, t, 0.2, 1, dur - 0.5, 0.3);
        o.start(t); l.start(t); o.stop(end + 0.02); l.stop(end + 0.02); last = o;
        t = end + R(0.3, 1.5); f0 *= R(0.6, 0.9);
      }
      this._hold(last, head);
    } else if (kind === 'leopard') { // low moan with a slow vibrato
      const head = this._far(d, pan, 0.25, 2500), e = this._gain(0, head), f0 = R(150, 320), dur = R(3, 6);
      const o = this._osc('triangle', f0, e), v = this._osc('sine', R(3, 6));
      v.connect(this._gain(f0 * 0.03, o.frequency));
      o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * R(0.85, 1.1), t + dur);
      const end = this._env(e.gain, t, 0.8, 1, dur - 1.6, 0.8);
      o.start(t); v.start(t); o.stop(end + 0.02); v.stop(end + 0.02); this._hold(o, head);
    } else if (kind === 'sealion') { // a few short buzzy barks, each sagging in pitch
      const head = this._far(d, pan, 0.14, 3500);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = R(500, 900); bp.Q.value = 1.2; bp.connect(head);
      let last = null;
      for (let i = 2 + ((Math.random() * 4) | 0); i > 0; i--) {
        const f0 = R(180, 420), dur = R(0.1, 0.25), e = this._gain(0, bp), o = this._osc('sawtooth', f0, e);
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * R(0.7, 0.9), t + dur);
        const end = this._env(e.gain, t, 0.015, 1, dur - 0.06, 0.045);
        o.start(t); o.stop(end + 0.02); last = o;
        t = end + R(0.12, 0.4);
      }
      this._hold(last, head);
    }
  }

  // Debug: RMS level (dBFS) per bus; analysers are created on first call only.
  levels() {
    if (!this.ctx) return null;
    if (!this._an) {
      this._an = {}; this._ab = new Float32Array(2048);
      for (const k of [...LAYERS, 'master']) { const a = this.ctx.createAnalyser(); a.fftSize = 2048; (k === 'master' ? this.master : this.bus[k]).connect(a); this._an[k] = a; }
    }
    const o = {};
    for (const k in this._an) {
      this._an[k].getFloatTimeDomainData(this._ab);
      let e = 0; for (let i = 0; i < 2048; i++) e += this._ab[i] * this._ab[i];
      o[k] = Math.round(10 * Math.log10(e / 2048 + 1e-12) * 10) / 10;
    }
    return o;
  }
}
