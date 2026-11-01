// Sonar scope for the control deck: heading-up plan view of app.contacts() with a rotating sweep.
// Draws at <= 20 fps (4 fps with reduced motion) only while the deck is open; no per-draw allocations
// (the background and the sweep wedge are pre-rendered when the size or range changes).
const RANGES = [30, 60, 90];
const SWEEP_MS = 3200;
const COL = { animal: '#62f0dc', school: '#62f0dc', big: '#ffb54a', poi: '#f1d38a', rare: '#ff6fae' };
const TAU = Math.PI * 2;

export class Sonar {
  constructor(canvas, app, reduced) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.reduced = reduced;            // MediaQueryList
    this.range = 60;
    this.list = [];
    this.count = 0;
    this.size = 0; this.dpr = 1;
    this.bg = document.createElement('canvas');
    this.wedge = document.createElement('canvas');
    this.nextDraw = 0; this.nextFetch = 0;
  }
  // Reads layout: call on open and on resize only.
  resize() {
    const css = this.cv.clientWidth;
    if (!css) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), px = Math.round(css * dpr);
    const aspect = innerWidth / Math.max(1, innerHeight);
    if (px === this.size && Math.abs(aspect - (this.aspect || 0)) < 0.01) return;
    this.size = px; this.dpr = dpr; this.aspect = aspect;
    this.cv.width = this.cv.height = px;
    this.bg.width = this.bg.height = px;
    this.wedge.width = this.wedge.height = px;
    this._background();
    this._wedge();
    this.nextDraw = 0;
  }
  cycleRange() {
    this.range = RANGES[(RANGES.indexOf(this.range) + 1) % RANGES.length];
    if (this.size) this._background();
    this.nextDraw = 0;
    return this.range;
  }
  _background() {
    const g = this.bg.getContext('2d'), s = this.size, c = s / 2, d = this.dpr, R = c - 1.5 * d;
    g.clearRect(0, 0, s, s);
    const rg = g.createRadialGradient(c, c, 0, c, c, R);
    rg.addColorStop(0, '#0a3a40'); rg.addColorStop(0.7, '#05252c'); rg.addColorStop(1, '#021418');
    g.fillStyle = rg; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
    // camera field of view (heading up)
    const hf = Math.atan(Math.tan(31 * Math.PI / 180) * this.aspect);
    g.fillStyle = 'rgba(98,240,220,0.07)';
    g.beginPath(); g.moveTo(c, c); g.arc(c, c, R, -Math.PI / 2 - hf, -Math.PI / 2 + hf); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(98,240,220,0.22)'; g.lineWidth = d;
    g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(-hf) * R, c - Math.cos(hf) * R);
    g.moveTo(c, c); g.lineTo(c + Math.sin(hf) * R, c - Math.cos(hf) * R); g.stroke();
    // range rings and cross
    g.strokeStyle = 'rgba(98,240,220,0.26)';
    for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(c, c, R * i / 3, 0, TAU); g.stroke(); }
    g.strokeStyle = 'rgba(98,240,220,0.14)';
    g.beginPath(); g.moveTo(c - R, c); g.lineTo(c + R, c); g.moveTo(c, c - R); g.lineTo(c, c + R); g.stroke();
    // bearing ticks
    g.strokeStyle = 'rgba(98,240,220,0.5)';
    for (let a = 0; a < 360; a += 10) {
      const r = a % 30 === 0 ? R - 5 * d : R - 2.5 * d, t = a * Math.PI / 180;
      g.beginPath(); g.moveTo(c + Math.sin(t) * r, c - Math.cos(t) * r); g.lineTo(c + Math.sin(t) * R, c - Math.cos(t) * R); g.stroke();
    }
    // ring labels
    g.fillStyle = 'rgba(160,250,238,0.55)';
    g.font = `${Math.round(8.5 * d)}px ui-monospace, Menlo, Consolas, monospace`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let i = 1; i <= 3; i++) g.fillText(String(Math.round(this.range * i / 3)), c + 2.5 * d, c + R * i / 3 - 5.5 * d);
    // own boat
    g.fillStyle = '#62f0dc';
    g.beginPath(); g.moveTo(c, c - 5 * d); g.lineTo(c + 3.6 * d, c + 3.8 * d); g.lineTo(c, c + 2 * d); g.lineTo(c - 3.6 * d, c + 3.8 * d); g.closePath(); g.fill();
  }
  _wedge() {
    // trailing glow behind a leading edge that points straight up (rotated per draw)
    const g = this.wedge.getContext('2d'), s = this.size, c = s / 2, R = c - 1.5 * this.dpr;
    g.clearRect(0, 0, s, s);
    const N = 36, span = 1.1;
    for (let i = 0; i < N; i++) {
      const a1 = -Math.PI / 2 - (i / N) * span, a0 = -Math.PI / 2 - ((i + 1) / N) * span;
      g.fillStyle = `rgba(98,240,220,${(0.2 * (1 - i / N) ** 2).toFixed(3)})`;
      g.beginPath(); g.moveTo(c, c); g.arc(c, c, R, a0, a1 + 0.004); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(160,255,240,0.75)'; g.lineWidth = 1.2 * this.dpr;
    g.beginPath(); g.moveTo(c, c); g.lineTo(c, c - R); g.stroke();
  }
  draw(now) {
    if (!this.size || now < this.nextDraw) return;
    const still = this.reduced.matches;
    this.nextDraw = now + (still ? 250 : 50);
    if (now >= this.nextFetch) { this.nextFetch = now + 100; this.app.contacts(this.list); }
    const g = this.ctx, s = this.size, c = s / 2, d = this.dpr, R = c - 1.5 * d, k = R / this.range;
    const th = still ? 0 : ((now % SWEEP_MS) / SWEEP_MS) * TAU;
    g.clearRect(0, 0, s, s);
    g.drawImage(this.bg, 0, 0);
    if (!still) {
      g.save(); g.translate(c, c); g.rotate(th); g.drawImage(this.wedge, -c, -c); g.restore();
    }
    let n = 0;
    const list = this.list, pulse = (now % 1400) / 1400;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const dist = Math.hypot(e.dx, e.dz);
      if (dist > this.range) continue;
      n++;
      const x = c + e.dx * k, y = c - e.dz * k;
      let a = Math.atan2(e.dx, e.dz); if (a < 0) a += TAU;
      let age = (th - a) / TAU; age -= Math.floor(age);
      const al = still ? 0.9 : 0.28 + 0.72 * (1 - age) * (1 - age);
      g.globalAlpha = al;
      const kind = e.kind;
      g.fillStyle = g.strokeStyle = COL[kind] || COL.animal;
      if (kind === 'poi') {
        const r = Math.max(3.2 * d, Math.min(9 * d, e.r * k));
        g.lineWidth = 1.3 * d;
        g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.stroke();
      } else if (kind === 'school') {
        const r = Math.max(2.6 * d, Math.min(11 * d, e.r * k));
        g.globalAlpha = al * 0.32; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.globalAlpha = al; g.lineWidth = d; g.stroke();
      } else if (kind === 'big' || kind === 'rare') {
        const r = Math.max(2.8 * d, Math.min(7 * d, e.r * k));
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        if (kind === 'rare' || !still) {
          g.globalAlpha = al * (1 - pulse) * (kind === 'rare' ? 1 : 0.5);
          g.lineWidth = 1.2 * d; g.beginPath(); g.arc(x, y, r + (3 + 7 * pulse) * d, 0, TAU); g.stroke();
        }
      } else {
        g.beginPath(); g.arc(x, y, 1.6 * d, 0, TAU); g.fill();
      }
    }
    g.globalAlpha = 1;
    this.count = n;
  }
}
