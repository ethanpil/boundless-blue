// Compass tape for the control deck, drawn on a canvas so it can glide smoothly between the 5 Hz heading
// readings without any DOM/style work (a CSS-transitioned strip cost ~1-2 ms of style per update on weak GPUs).
// Draws at <= 20 fps while the deck is open (4 fps and no easing with reduced motion); no per-draw allocations.
const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const NUM = [];
for (let d = 0; d < 360; d += 15) NUM[d] = CARD[d] || String(d).padStart(3, '0');

export class CompassTape {
  constructor(canvas, reduced) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.reduced = reduced;          // MediaQueryList
    this.w = 0; this.hgt = 0; this.dpr = 1; this.ppd = 3;
    this.h = null; this.target = 0;
    this.nextDraw = 0; this.last = 0; this.drawnH = NaN;
  }
  // Reads layout: call on open and on resize only.
  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr; this.w = Math.round(w * dpr); this.hgt = Math.round(h * dpr);
    this.cv.width = this.w; this.cv.height = this.hgt;
    this.ppd = Math.max(2.3, Math.min(3.4, w / 115)) * dpr;   // ~115 degrees visible
    const sans = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    this.f1 = `700 ${13 * dpr}px ${sans}`; this.f2 = `700 ${10.5 * dpr}px ${sans}`;
    this.fn = `500 ${9.5 * dpr}px ui-monospace, Menlo, Consolas, monospace`;
    this.drawnH = NaN; this.nextDraw = 0;
  }
  set(heading) {
    this.target = heading;
    if (this.h === null) this.h = heading;
  }
  draw(now) {
    if (!this.w || this.h === null || now < this.nextDraw) return;
    const still = this.reduced.matches;
    this.nextDraw = now + (still ? 250 : 50);
    const dt = Math.min(0.25, (now - (this.last || now)) / 1000); this.last = now;
    let d = this.target - this.h; d -= 360 * Math.round(d / 360);
    this.h = still ? this.target : this.h + d * (1 - Math.exp(-dt * 7));
    this.h = ((this.h % 360) + 360) % 360;
    if (Math.abs(this.h - this.drawnH) < 0.05) return;   // nothing moved: keep the last frame
    this.drawnH = this.h;
    const g = this.ctx, W = this.w, H = this.hgt, k = this.dpr, ppd = this.ppd, cx = W / 2;
    g.clearRect(0, 0, W, H);
    const span = cx / ppd + 8, lo = Math.ceil((this.h - span) / 5) * 5, hi = this.h + span;
    g.lineWidth = Math.max(1, Math.round(k));
    // ticks in two batched paths (minor every 5 degrees, major every 15), then the labels
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (let a = lo; a <= hi; a += 5) {
        const n = ((a % 360) + 360) % 360;
        if ((n % 15 === 0) !== (pass === 1)) continue;
        const x = Math.round(cx + (a - this.h) * ppd) + 0.5;
        g.moveTo(x, H); g.lineTo(x, H - (pass ? 11 : 6) * k);
      }
      g.strokeStyle = pass ? 'rgba(170,250,238,0.85)' : 'rgba(170,250,238,0.4)';
      g.stroke();
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let a = Math.ceil((this.h - span) / 15) * 15; a <= hi; a += 15) {
      const x = Math.round(cx + (a - this.h) * ppd), n = ((a % 360) + 360) % 360;
      const card = CARD[n];
      if (card) {
        g.font = card.length === 1 ? this.f1 : this.f2;
        g.fillStyle = n === 0 ? '#ff7a5c' : card.length === 1 ? '#f2fffd' : 'rgba(230,255,250,0.85)';
        g.fillText(card, x, (card.length === 1 ? 3 : 4) * k);
      } else if (W / k > 200) {
        g.font = this.fn;
        g.fillStyle = 'rgba(190,250,240,0.72)';
        g.fillText(NUM[n], x, 5 * k);
      }
    }
  }
}
