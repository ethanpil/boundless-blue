// A small delight in open water (about every 45 minutes): an autonomous ocean glider — a yellow
// torpedo with swept wings, a tail fin with its antenna and a blinking status light — gliding past in a
// slow sawtooth. Gliders have no propeller: they shift their buoyancy to sink and climb for months.
import * as THREE from 'three';
import { GeoBuilder, loft, box, cyl, sph, T, lin, mulS, fbm, surMat, clamp } from './kit.js';
import { Vehicle } from './parts.js';

const NAMES = ['SG-221 "Petrel"', 'Glider "Wanderer"', 'Glider "Ruth"', 'SG-409 "Tern"', 'Glider "Nansen"'];
const FACT = 'it has no propeller: it shifts its buoyancy to sink and climb in a slow sawtooth, sampling the sea for months on one battery.';
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

function* buildGlider(g, rng, low) {
  const hull = lin(pick(rng, [0xf2c21b, 0xf2c21b, 0xf06a1d, 0xe9ebe6])), dark = lin(0x1c1d20), white = lin(0xeceee9);
  const S = low ? 14 : 22;
  // a slim torpedo with a rounded nose and a tapered tail cone
  const rings = [[-0.95, 0.03], [-0.85, 0.07], [-0.65, 0.105], [0.6, 0.11], [0.78, 0.1], [0.9, 0.07], [0.96, 0.03]];
  const hullC = (x, y, z) => mulS(z > 0.72 ? white : z < -0.62 ? dark : hull, 0.9 + 0.15 * fbm(x * 9, y * 9, z * 9) - (Math.abs(z - 0.2) < 0.006 ? 0.3 : 0));
  g.add(loft(rings.map(([z, r]) => [z, r, r]), S, { axis: 'z' }), null, hullC, { rough: 0.35 });
  yield;
  // swept wings and the tail fin with its antenna; a sensor puck and the status light
  for (const sx of [1, -1]) {
    const w = new THREE.BufferGeometry();
    const p = [0, 0, 0.12, sx * 0.62, 0, -0.18, sx * 0.62, 0, -0.32, 0, 0, -0.18];
    w.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const w2 = w.clone();
    w.setIndex(sx > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);  // upper face
    w2.setIndex(sx > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]); // lower face
    g.add(w, T(0, -0.02, 0), dark, { rough: 0.5 });
    g.add(w2, T(0, -0.026, 0), dark, { rough: 0.5 });
  }
  g.add(box(0.012, 0.22, 0.2), T(0, 0.15, -0.82, 0.35, 0, 0), dark, { rough: 0.5 });
  g.add(cyl(0.012, 0.012, 0.75, 6), T(0, 0.55, -0.98, -0.5, 0, 0), dark, { rough: 0.5 });
  g.add(cyl(0.035, 0.035, 0.05, 10), T(0, 0.11, 0.35), dark, { rough: 0.4 });
  g.add(sph(0.016, 8, 6), T(0, 0.86, -1.18), lin(0x9effa0), { rough: 0.1, glow: 106 });
}

export class Glider extends Vehicle {
  constructor(sys, rng) { super(sys, rng, 'glider'); this.lab.name = 'Ocean glider'; }

  plan(cam, force) {
    const sys = this.sys, rng = this.rng, o = this.opts || {};
    this.len = 2.0; this.rad = 0.35; this.top = 0.9; this.bot = 0.2;
    this.samples = [[0, 0, 0, 0.7]];
    this.camMin = 4.8;
    this.dir = o.dir || (rng() < 0.5 ? -1 : 1);
    this.speed = 0.3 + rng() * 0.12;
    this.alt = 3 + rng() * 4; this.maxBelow = 4;
    // the sawtooth: a long gentle dive and climb (about 1 m of depth per 4 m travelled)
    this.saw = 6 + rng() * 6; this.sawLen = 60 + rng() * 40; this.sawPh = rng();
    this.wantY = (s) => sys.shape.pathY(s) - 1.5 - this.saw * Math.abs(((s / this.sawLen + this.sawPh) % 1) * 2 - 1);
    this.pitchK = 1.6; this.pitchMax = 0.42;
    const fog = sys.fogD();
    this.ahead = clamp(fog * 0.6, 30, 55);
    const s0 = cam.s + (this.dir < 0 ? this.ahead : this.ahead * 0.6);
    const lats = [6.5, 8, 10, 12];
    const lane = this.dir < 0 ? this.lane(cam.s - 8, s0 + 2, lats, force) : this.lane(s0 - 2, s0 + 25, lats, force);
    if (!lane) return false;
    this.side = lane.side; this.lat = lane.lat;
    this.vessel = pick(rng, NAMES);
    this.lab.fact = `${this.vessel} — ${FACT}`;
    this.sub.id = 'sur:glider'; this.sub.r = 0.9; this.sub.interest = 1.2;
    return true;
  }

  *build() {
    const g = new GeoBuilder(false);
    yield* buildGlider(g, this.rng, this.sys.low);
    const mesh = new THREE.Mesh(g.build(), surMat('vehicle-rigid', { rough: 0.45 }));
    this.root.add(mesh);
    this.mesh = mesh;
    this.samples = [[0, 0, 0.5, 0.25], [0, 0, -0.5, 0.25], [0, 0.4, -0.9, 0.25], [0.45, 0, -0.15, 0.2], [-0.45, 0, -0.15, 0.2]];
    this.lamps = [];
  }

  start(cam) {
    this.s = cam.s + (this.dir < 0 ? this.ahead : this.ahead * 0.6);
    this.place(cam); this.speedNow = this.speed;
    return this.settle();
  }

  update(dt, time, cam) {
    if (dt <= 0) return;
    this.age += dt;
    this.move(dt, cam, this.speed);
    this.register(dt, 0.9);
    const behind = (cam.s - this.s) > 25, far = Math.abs(this.s - cam.s) > 200;
    if (behind || far || this.age > 500) this.done = true;
  }

  dispose() { this.disposeLights(); }
}
