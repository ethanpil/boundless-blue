// Ambient sound (stub; the audio owner replaces this). Procedural WebAudio, no assets.
// main.js calls: new Ambience(env, app); unlock() on the first user gesture; setEnabled(b); setVolume(v); update(dt).
export class Ambience {
  constructor(env, app) { this.env = env; this.app = app; this.active = false; this.enabled = true; this.volume = 0.6; }
  unlock() {}
  setEnabled(b) { this.enabled = !!b; }
  setVolume(v) { this.volume = v; }
  update(dt) {}
}
