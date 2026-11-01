// Endless Ocean — entry point: renderer, floating origin, biome blending, conditions, frame loop,
// and the `app` control API shared by the keyboard and the touch/mouse control deck (hud.js).
import * as THREE from 'three';
import { U, Caustics, makeNoiseTexture } from './water.js';
import { BIOMES, BIOME_KEYS, BiomeSequence, WorldShape, sv } from './biomes.js';
import { Terrain } from './terrain.js';
import { Background, Surface, MarineSnow } from './env.js';
import { Post } from './post.js';
import { registerProps } from './props/index.js';
import { registerNewBiomeProps } from './props/newbiomes.js';
import { registerNewBiomeProps2 } from './props/newbiomes2.js';
import { registerNewBiomeProps3 } from './props/newbiomes3.js';
import { Creatures } from './creatures/index.js';
import { Surprises } from './surprises/index.js';
import { noise1, mulberry32 } from './noise.js';
import { obstacles } from './obstacles.js';
import { Labels } from './labels.js';
import { Conditions, WEATHER_KEYS, TIME_KEYS } from './conditions.js';
import { CameraDirector } from './camera.js';
import { PRESETS, detectTier, gpuName, AdaptiveResolution } from './quality.js';
import { Hud } from './hud.js';

const qs = new URLSearchParams(location.search);
const SEED = qs.has('seed') ? parseInt(qs.get('seed'), 10) : (Math.random() * 1e9) | 0;
let speed = qs.has('speed') ? parseFloat(qs.get('speed')) : 3.2;
const QUALITY = qs.get('quality') || 'auto'; // auto | low | medium | high | ultra
const FPS_CAP = qs.has('fps') ? Math.max(0, parseFloat(qs.get('fps'))) : 60; // 0 = uncapped

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
const tier = detectTier(renderer, QUALITY);
const Q = PRESETS[tier];
let post = null;
const res = new AdaptiveResolution(renderer, () => post && post.setSize(), Q, FPS_CAP, QUALITY === 'auto');
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
renderer.info.autoReset = false;

const SHADOWS = Q.shadows && qs.get('shadows') !== '0';
renderer.shadowMap.enabled = SHADOWS;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1400);
scene.add(camera);
const world = new THREE.Group();   // everything at global coordinates lives here
scene.add(world);

U.uNoiseTex.value = makeNoiseTexture(256);
const caustics = new Caustics(Q.caustics);

const sun = new THREE.DirectionalLight(0xffffff, 2.5);
const hemi = new THREE.HemisphereLight(0x88ccff, 0x0a2030, 1.0);
scene.add(sun, sun.target, hemi);
if (SHADOWS) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
  const sc = sun.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 260;
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  sun.shadow.intensity = 0.8;
}

// Every load starts somewhere new: a seed-derived zone and a point far along the endless path
// (path/terrain noise is a function of distance, so this randomises their shape too).
const startRng = mulberry32(SEED ^ 0x51ed270b);
const START_KEY = qs.get('biome') || BIOME_KEYS[Math.floor(startRng() * BIOME_KEYS.length)];
const START_S = Math.floor(startRng() * 1e6);
const seq = new BiomeSequence(SEED, START_KEY, START_S);
const shape = new WorldShape(seq);
const terrain = new Terrain(world, shape, seq, tier);
terrain.shadows = SHADOWS;
const env = {
  shape, seq, world, scene, camera, renderer, U, BIOMES, seed: SEED, shadows: SHADOWS, obstacles, tier,
  // points of interest registered by props (set pieces): query(s0, s1, outArray) -> [{type, x, y, s, r, data}]
  pois: { query: (s0, s1, out = []) => terrain.queryPOIs(s0, s1, out) },
  // post a short narrative note at the bottom of the screen (e.g. a surprise encounter)
  note: (text) => note(text),
};
registerProps(terrain, env);
registerNewBiomeProps(terrain, env);
registerNewBiomeProps2(terrain, env);
registerNewBiomeProps3(terrain, env);
const creatures = new Creatures(world, env);
const surprises = new Surprises(world, env);
const labels = new Labels();
labels.add((out) => terrain.labels(out));
labels.add((out) => { if (creatures.labels) creatures.labels(out); });
labels.add((out) => { if (surprises.labels) surprises.labels(out); });

const conditions = new Conditions(SEED, { time: qs.get('time'), weather: qs.get('weather'), dayMinutes: parseFloat(qs.get('day')) || 60 });
const director = new CameraDirector(camera, shape);

const background = new Background(); scene.add(background.mesh);
const surface = new Surface(); scene.add(surface.mesh);
const snow = new MarineSnow(); scene.add(snow.mesh);
post = new Post(renderer, scene, camera, { msaa: Q.msaa, shaftDiv: Q.shaftDiv, shaftSteps: Q.shaftSteps, ao: Q.ao, fxaa: Q.fxaa });
window.__ocean = { scene, camera, terrain, shape, seq, creatures, surprises, post, U, obstacles, labels, conditions, director, renderer, tier, world };

// ---------- blended environment parameters ----------
const P = { sigma: [0, 0, 0], lightSigma: [0, 0, 0], deep: [0, 0, 0], up: [0, 0, 0], sun: 0, caustic: 0, shafts: 0, ambient: 0, glow: 0, snow: 0, cave: 0, tempC: 0 };
function blendParams(s) {
  for (const k of ['sigma', 'lightSigma', 'deep', 'up']) P[k].fill(0);
  P.sun = P.caustic = P.shafts = P.ambient = P.glow = P.snow = P.cave = P.tempC = 0;
  for (const e of seq.weights(s)) {
    const b = BIOMES[e.key];
    // every segment has its own water: clarity and a slight green/blue shift
    const clar = 0.85 + 0.3 * sv(e.g, 10), hue = sv(e.g, 11) - 0.5;
    for (let i = 0; i < 3; i++) {
      P.sigma[i] += b.sigma[i] * clar * e.w;
      P.lightSigma[i] += b.lightSigma[i] * e.w;
      const ht = i === 1 ? 1 + 0.28 * hue : i === 2 ? 1 - 0.14 * hue : 1;
      P.deep[i] += b.deep[i] * ht * e.w;
      P.up[i] += b.up[i] * ht * e.w;
    }
    for (const k of ['sun', 'caustic', 'shafts', 'ambient', 'glow', 'snow']) P[k] += b[k] * e.w;
    P.tempC += (b.tempC ?? 20) * e.w;
    if (e.key === 'cave') P.cave += e.w;
  }
  // drifting turbidity: patches of clearer and murkier water as we travel
  const turb = 1 + 0.16 * noise1(s / 240, 31);
  for (let i = 0; i < 3; i++) P.sigma[i] *= turb;
  return P;
}

// ---------- floating origin ----------
let Oz = 0; // render z = global z - Oz ; Oz is a multiple of 1024 so tiled patterns stay seamless
function rebase(globalZ) {
  const want = Math.ceil(globalZ / 1024) * 1024; // globalZ is negative; keep render z in (-1024, 0]
  if (want !== Oz) { Oz = want; world.position.z = -Oz; }
}

// ---------- camera ----------
let s = START_S + (qs.has('start') ? parseFloat(qs.get('start')) : 0);
let lastV = 0; // actual travel speed (m/s) this frame
const camState = { s: 0, x: 0, y: 0, z: 0, forward: new THREE.Vector3(), camera, Oz: 0 };
const subjectsFn = (out) => {
  if (creatures.subjects) creatures.subjects(out);
  if (surprises.subjects) surprises.subjects(out);
};
const poisFn = (s0, s1, out) => terrain.queryPOIs(s0, s1, out);
function placeCamera(dt, time, C) {
  rebase(-s);
  const r = director.update(dt, time, s, Oz, Math.max(0.005, U.uSigma.value.y), C.surge, subjectsFn, poisFn);
  camState.s = s; camState.x = r.x; camState.y = r.y; camState.z = r.gz; camState.Oz = Oz;
  camera.getWorldDirection(camState.forward);
}

// ---------- captions ----------
const captionEl = document.getElementById('caption');
let showCaptions = qs.get('captions') !== '0', lastSegId = -1, captionTimer = 0;
function updateCaption(dt, C) {
  if (!captionEl) return;
  const g = seq.segs[seq.segAt(s + 40)];
  if (g.id !== lastSegId) {
    lastSegId = g.id; captionTimer = 0;
    const extra = [C.timeLabel, C.weatherLabel].filter(Boolean).join(' · ');
    captionEl.innerHTML = `${BIOMES[g.key].label}<small>${BIOMES[g.key].subtitle || ''}${extra ? ' · ' + extra : ''}</small>`;
  }
  captionTimer += dt;
  captionEl.style.opacity = showCaptions && captionTimer > 2 && captionTimer < 9 ? '0.85' : '0';
}

// ---------- narrative notes: small moments worth naming ----------
const noteEl = document.getElementById('note');
let noteTimer = 0, lastTime = '', lastWeather = null, lastSpawn = 0;
const noteListeners = [];
const TIME_NOTES = { dawn: 'dawn — light returns to the water', dusk: 'dusk — the light turns gold, then blue',
  night: 'night falls — nocturnal life awakens' };
function note(text) {
  for (const f of noteListeners) { try { f(text); } catch (e) { console.error(e); } }
  if (!showCaptions || !noteEl) return;
  noteEl.textContent = text; noteTimer = 8;
}
function updateNotes(dt, C, spawn) {
  if (C.timeLabel !== lastTime) { if (lastTime && TIME_NOTES[C.timeLabel]) note(TIME_NOTES[C.timeLabel]); lastTime = C.timeLabel; }
  const w = C.weatherLabel;
  if (lastWeather !== null && w !== lastWeather && w) note(w);
  lastWeather = w;
  if (spawn > 0.3 && lastSpawn <= 0.3) note('the corals are spawning — a few nights each year');
  lastSpawn = spawn;
  noteTimer -= dt;
  if (noteEl) noteEl.style.opacity = noteTimer > 0 && noteTimer < 7 && showCaptions ? '0.8' : '0';
}

// ---------- screen wake lock: keep the display awake while the dive is visible ----------
let wakeWanted = qs.get('wake') !== '0', wakeLock = null;
async function acquireWake() {
  if (!wakeWanted || wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { wakeLock = null; } // some browsers only allow it after a user gesture; retried on input
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquireWake(); });
addEventListener('pointerdown', () => acquireWake(), { passive: true });
addEventListener('keydown', () => acquireWake());
acquireWake();

// ---------- sightings log (species seen on this dive) ----------
const sightings = new Map(); // name -> { count, first, last }
const recent = [];           // newest first: { name, t }
const _names = [];
let sightTimer = 0;
function updateSightings(dt) {
  sightTimer += dt;
  if (sightTimer < 1.5) return;
  sightTimer = 0;
  _names.length = 0;
  if (creatures.labels) creatures.labels(_names);
  if (surprises.labels) surprises.labels(_names);
  const cam = camera.position;
  for (const e of _names) {
    const d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - Oz - cam.z);
    if (d > 45) continue;
    const r = sightings.get(e.name);
    if (!r) { sightings.set(e.name, { count: 1, first: simTime, last: simTime }); recent.unshift({ name: e.name, t: simTime, fact: e.fact || '' }); if (recent.length > 30) recent.pop(); }
    else if (simTime - r.last > 20) { r.count++; r.last = simTime; }
    else r.last = simTime;
  }
}

// ---------- the control API (used by the keyboard handler below and by hud.js) ----------
let paused = false, statsOn = false, lampMode = 'auto';
const statsEl = document.getElementById('stats'), helpEl = document.getElementById('help');
let helpTimer = 0;
const reloadWith = (params) => {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(params)) { if (v === null) u.searchParams.delete(k); else u.searchParams.set(k, v); }
  location.href = u.toString();
};
const _info = {}, _cands = [], _pois = [];
let watchName = '', watchTimer = 0;
const app = {
  zones: BIOME_KEYS.map((k) => ({ key: k, label: BIOMES[k].label, subtitle: BIOMES[k].subtitle })),
  weathers: WEATHER_KEYS, times: TIME_KEYS,
  get paused() { return paused; }, get speed() { return speed; }, get labelsOn() { return labels.on; },
  get captionsOn() { return showCaptions; }, get statsOn() { return statsOn; }, get lampMode() { return lampMode; },
  get curiosity() { return director.curiosity; }, get wakeLock() { return wakeWanted; }, get wakeLockActive() { return !!wakeLock; },
  get tier() { return tier; }, get quality() { return QUALITY; }, get seed() { return SEED; },
  get fullscreen() { return !!document.fullscreenElement; },
  sightings, recent,
  onNote(fn) { noteListeners.push(fn); },
  togglePause() { paused = !paused; }, setPaused(v) { paused = !!v; },
  faster() { speed = Math.min(40, speed * 1.4); }, slower() { speed = Math.max(0.5, speed / 1.4); },
  setSpeed(v) { speed = Math.min(40, Math.max(0.5, v)); },
  nextZone() { const g = seq.segs[seq.segAt(s)]; s = g.end - 60; terrain.prime(s); },
  jumpTo(key) { reloadWith({ biome: key, seed: (Math.random() * 1e9) | 0, start: null }); },
  skipTime(f = 1 / 8) { conditions.skipTime(f); }, setTime(name) { conditions.setPhase(name); },
  nextWeather() { conditions.nextWeather(); }, setWeather(k) { conditions.setWeather(k); },
  toggleLabels() { labels.toggle(); }, setLabels(v) { if (labels.on !== !!v) labels.toggle(); },
  toggleCaptions() { showCaptions = !showCaptions; }, setCaptions(v) { showCaptions = !!v; },
  toggleStats() { statsOn = !statsOn; if (statsEl) statsEl.style.display = statsOn ? 'block' : 'none'; },
  toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); },
  setLamp(mode) { lampMode = mode; },              // 'auto' | 'on' | 'off'
  setCuriosity(v) { director.curiosity = Math.max(0, Math.min(1, v)); },
  setWakeLock(v) { wakeWanted = !!v; if (wakeWanted) acquireWake(); else if (wakeLock) { wakeLock.release(); wakeLock = null; } },
  setQuality(t) { reloadWith({ quality: t === 'auto' ? null : t }); },
  shareUrl() { const u = new URL(location.href); u.searchParams.set('seed', SEED); u.searchParams.set('biome', START_KEY); return u.toString(); },
  // Live readings for the control deck. Values are approximate where real instruments would be (compass, current).
  info() {
    const o = _info, g = seq.segs[seq.segAt(s)], b = BIOMES[g.key];
    const ng = seq.segs[seq.segAt(g.end + 1)];
    const depth = Math.max(0, -camera.position.y), floorY = shape.floorAt(camState.x, s);
    const f = camState.forward;
    o.zoneKey = g.key; o.zone = b.label; o.subtitle = b.subtitle || '';
    o.nextZone = BIOMES[ng.key].label; o.zoneProgress = Math.min(1, Math.max(0, (s - g.start) / (g.end - g.start)));
    o.metresToNext = Math.max(0, g.end - s);
    o.depth = depth; o.seabed = floorY > -250 ? -floorY : null; o.altitude = floorY > -250 ? camera.position.y - floorY : null;
    o.speed = lastV; o.speedKnots = lastV * 1.94384; o.speedSetting = speed;
    // faux compass: a slowly wandering base heading plus where the camera actually points
    const base = 180 + 170 * noise1(s / 4000, 501) + 80 * noise1(s / 1300, 502);
    o.heading = (((base + Math.atan2(f.x, -f.z) * 180 / Math.PI) % 360) + 360) % 360;
    o.pitch = Math.asin(Math.max(-1, Math.min(1, f.y))) * 180 / Math.PI;
    o.currentDir = (((base + 140 * noise1(s / 900 + simTime / 500, 503)) % 360) + 360) % 360;
    o.currentKnots = 0.2 + 0.7 * Math.abs(noise1(simTime / 300, 504)) + C.surge * 1.3;
    const deep = P.tempC <= 6;
    o.tempC = deep ? P.tempC : P.tempC - Math.max(0, depth - 8) * 0.06 - 0.4 * C.night;
    o.visibility = Math.min(80, 3 / Math.max(0.005, U.uSigma.value.y));
    o.light = Math.min(1, U.uSunScatter.value * Math.exp(-U.uLightSigma.value.y * depth) / 1.15);
    o.lamps = U.uLamp.value > 0.05;
    o.timeLabel = C.timeLabel; o.clockHours = conditions.clockHours;
    o.weather = C.weatherLabel || 'clear water'; o.weatherKey = conditions.cur; o.night = C.night;
    o.distanceKm = (s - START_S) / 1000; o.diveTime = simTime;
    o.seed = SEED; o.tier = tier; o.gpu = gpuName(renderer); o.fps = res.fps; o.res = res.scale;
    o.species = sightings.size;
    o.watching = watchName;
    o.paused = paused;
    return o;
  },
  // Sonar contacts relative to the camera heading: dx right, dz ahead (m), dy up; kind 'big' | 'animal' | 'poi'.
  contacts(out) {
    out.length = 0;
    const cam = camera.position, f = camState.forward;
    const fl = Math.hypot(f.x, f.z) || 1, fx = f.x / fl, fz = f.z / fl;
    _cands.length = 0; subjectsFn(_cands);
    for (const e of _cands) {
      const rx = e.x - cam.x, rz = (e.z - Oz) - cam.z;
      if (rx * rx + rz * rz > 90 * 90) continue;
      out.push({ dx: rx * -fz + rz * fx, dz: rx * fx + rz * fz, dy: e.y - cam.y, r: e.r || 1, kind: e.interest >= 0.7 ? 'big' : 'animal' });
    }
    terrain.queryPOIs(s - 30, s + 90, _pois);
    for (const p of _pois) {
      const rx = p.x - cam.x, rz = (-p.s - Oz) - cam.z;
      out.push({ dx: rx * -fz + rz * fx, dz: rx * fx + rz * fz, dy: p.y - cam.y, r: p.r || 3, kind: 'poi', type: p.type });
    }
    return out;
  },
};
window.__ocean.app = app;

addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  helpTimer = 4;
  const k = e.key.toLowerCase();
  if (k === 'h') app.toggleCaptions();
  else if (k === 'f') app.toggleFullscreen();
  else if (k === 's') app.toggleStats();
  else if (e.key === ' ') { e.preventDefault(); app.togglePause(); }
  else if (k === 'i') app.toggleLabels();
  else if (k === 't') app.skipTime();
  else if (k === 'w') app.nextWeather();
  else if (e.key === 'ArrowRight') app.faster();
  else if (e.key === 'ArrowLeft') app.slower();
  else if (k === 'n') app.nextZone();
  else if (k === 'l') app.setLamp(lampMode === 'auto' ? 'on' : lampMode === 'on' ? 'off' : 'auto');
});
addEventListener('mousemove', () => { helpTimer = 3; document.body.style.cursor = 'default'; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); post.setSize();
});

// ---------- per-frame environment ----------
let envSpawn = 0;
function updateEnvironment(C) {
  const p = blendParams(s + 10);
  const depth = Math.max(0, -camera.position.y);
  U.uSigma.value.set(p.sigma[0] * C.sigmaMul[0], p.sigma[1] * C.sigmaMul[1], p.sigma[2] * C.sigmaMul[2]);
  U.uLightSigma.value.set(p.lightSigma[0] * C.sigmaMul[0], p.lightSigma[1] * C.sigmaMul[1], p.lightSigma[2] * C.sigmaMul[2]);
  // the water's own colour follows the light that reaches it (time of day, weather, plankton)
  const lightLevel = 0.06 + 0.94 * Math.min(1, C.sunMul + 0.25 * C.ambientMul);
  U.uWaterDeep.value.setRGB(p.deep[0] * C.tint[0] * lightLevel, p.deep[1] * C.tint[1] * lightLevel, p.deep[2] * C.tint[2] * lightLevel);
  U.uWaterUp.value.setRGB(p.up[0] * C.tint[0] * lightLevel, p.up[1] * C.tint[1] * lightLevel, p.up[2] * C.tint[2] * lightLevel);
  // sun (or moon) direction underwater: refraction keeps it within ~48 degrees of vertical
  const elevAir = C.night > 0.5 ? 0.9 : Math.max(0.06, C.elevAir);
  const sinW = Math.cos(elevAir) / 1.333, elevW = Math.PI / 2 - Math.asin(sinW);
  U.uSunDir.value.set(Math.cos(C.azimuth) * Math.cos(elevW), Math.sin(elevW), Math.sin(C.azimuth) * Math.cos(elevW)).normalize();
  U.uSunColor.value.setRGB(C.sunColor[0], C.sunColor[1], C.sunColor[2]);
  U.uSunScatter.value = p.sun * C.sunMul;
  U.uCausticStr.value = p.caustic * C.causticMul;
  U.uAmbientScale.value = p.ambient * C.ambientMul;
  U.uGlow.value = Math.min(1, p.glow + C.glowAdd);
  U.uNight.value = C.night;
  U.uRain.value = C.rain;
  U.uSurge.value = C.surge;
  const deepDark = Math.min(1, Math.max(0, (0.45 - p.sun) / 0.37));
  const autoLamp = Math.max(deepDark, p.cave * 0.55, C.lampAdd);
  U.uLamp.value = lampMode === 'on' ? Math.max(0.85, autoLamp) : lampMode === 'off' ? 0 : autoLamp;
  sun.color.setRGB(C.sunColor[0], C.sunColor[1], C.sunColor[2]);
  sun.intensity = 3.0 * p.sun * C.sunMul;
  placeSun();
  hemi.color.setRGB(p.up[0] * C.tint[0], p.up[1] * C.tint[1], p.up[2] * C.tint[2]).multiplyScalar(1.6);
  hemi.groundColor.setRGB(...p.deep).multiplyScalar(0.5);
  hemi.intensity = 0.7 * p.ambient * C.ambientMul;
  U.uCamPos.value.copy(camera.position);
  { // approximate lit seabed colour for the surface's mirror reflection
    let r = 0, g = 0, b = 0;
    for (const e of seq.weights(s)) { const c = BIOMES[e.key].sand; r += c[0] * e.w; g += c[1] * e.w; b += c[2] * e.w; }
    const l = p.sun * C.sunMul * 0.9, ls = U.uLightSigma.value;
    U.uFloorCol.value.setRGB(r * l * Math.exp(-ls.x * depth * 2), g * l * Math.exp(-ls.y * depth * 2), b * l * Math.exp(-ls.z * depth * 2));
  }
  const sg = U.uSigma.value.y;
  post.params.shafts = p.shafts * p.sun * C.sunMul * C.shaftMul;
  post.params.softStart = 0.45 / sg;
  post.params.softEnd = 2.8 / sg;
  post.params.depth = depth;
  post.params.exposure = 1 + 1.4 * p.glow + 0.4 * (1 - Math.min(1, p.sun)) + C.exposureAdd;
  post.params.focus = director.focus.x;
  post.params.night = C.night;
  // some nights on the reef the corals spawn: bundles of eggs drift up toward the moon
  const dayIndex = Math.floor(conditions.t / conditions.cycle);
  const spawnNight = ((dayIndex * 2654435761) >>> 0) % 100 < 40 ? 1 : 0;
  const reefy = seq.weightOf(s + 10, 'reef') + seq.weightOf(s + 10, 'softcoral');
  const spawn = spawnNight * reefy * C.night * (conditions.phase < 0.9 ? 1 : 0);
  snow.setDensity(Math.min(2.5, p.snow * C.snowMul), U.uGlow.value, spawn, speed * director.speedMul.x);
  envSpawn = spawn;
  post.params.aperture = 1.6 + 0.8 * C.night;
}

// Shadow frustum follows the camera (centred ~32 m ahead), snapped to shadow texels to avoid shimmer.
const sunU = new THREE.Vector3(), sunV = new THREE.Vector3(), sunC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function placeSun() {
  const L = U.uSunDir.value;
  sunC.copy(camera.position).addScaledVector(camState.forward, 32);
  if (SHADOWS) {
    const texel = 96 / Q.shadowMap;
    sunU.crossVectors(L, UP).normalize(); sunV.crossVectors(sunU, L);
    const cu = Math.round(sunC.dot(sunU) / texel) * texel, cv = Math.round(sunC.dot(sunV) / texel) * texel, cl = sunC.dot(L);
    sunC.copy(sunU).multiplyScalar(cu).addScaledVector(sunV, cv).addScaledVector(L, cl);
  }
  sun.target.position.copy(sunC);
  sun.position.copy(sunC).addScaledVector(L, 130);
  sun.target.updateMatrixWorld();
}

// ---------- boot ----------
let C = conditions.update(0);
blendParams(s);
placeCamera(0, 0, C);
terrain.prime(s);
const hud = new Hud(app);
const clock = new THREE.Clock();
let time = 0, simTime = 0, lastFrame = 0, causticFrame = 0;
setTimeout(() => { const l = document.getElementById('loader'); if (l) l.style.opacity = 0; }, 900);
setTimeout(() => { const l = document.getElementById('loader'); if (l) l.remove(); }, 3600);

function frame(now) {
  requestAnimationFrame(frame);
  // frame cap: a calm 60 fps is plenty for a slow glide and halves the work on 120/144 Hz screens
  if (FPS_CAP > 0 && now - lastFrame < 1000 / FPS_CAP - 1.5) return;
  lastFrame = now;
  tick(Math.min(clock.getDelta(), 0.1), true);
}
// Debug: advance the simulation without rAF (hidden tabs throttle it).
window.__ocean.advance = (seconds, step = 1 / 30) => {
  for (let t = 0; t < seconds; t += step) tick(step, t + step * 12 >= seconds);
};
// Debug: GPU benchmark at a fixed size (ms per rendered frame, synchronous).
window.__ocean.bench = (w = 1280, h = 720, n = 20) => {
  res.enabled = false; renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix(); post.setSize();
  const gl = renderer.getContext(), px = new Uint8Array(4);
  const run = (k) => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now();
    for (let i = 0; i < k; i++) { renderer.info.reset(); post.render(time); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / k; };
  run(3);
  return { ms: +run(n).toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
};
function tick(dt, draw) {
  renderer.info.reset();
  C = conditions.update(paused ? 0 : dt);
  lastV = 0;
  if (!paused) {
    simTime += dt;
    lastV = speed * (1 + 0.12 * noise1(simTime / 40, 77)) * director.speedMul.x;
    s += lastV * dt;
  }
  time = simTime % 4096; // shader time wraps to keep float precision
  U.uTime.value = time;
  placeCamera(paused ? 0 : dt, simTime, C);
  terrain.update(s, 4, Math.min(330, Math.max(90, 4.5 / Math.min(U.uSigma.value.y, U.uSigma.value.z))));
  terrain.sky.syncUniforms(Oz);
  updateEnvironment(C);
  // the caustic pattern moves slowly: weak GPUs refresh it at half rate
  if (!Q.causticHalfRate || (causticFrame++ & 1) === 0) caustics.update(renderer, time);
  background.update(camera);
  surface.update(camera, paused ? 0 : dt, camera.position.y > -16 && !shape.hasCeiling(s + 30) && C.night < 0.6, Oz);
  snow.update(camera, dt, renderer);
  creatures.update(paused ? 0 : dt, time, camState);
  surprises.update(paused ? 0 : dt, time, camState);
  updateCaption(dt, C);
  updateNotes(dt, C, envSpawn);
  updateSightings(dt);
  // name of what the camera is watching (for the control deck), refreshed twice a second
  watchTimer -= dt;
  if (watchTimer <= 0) {
    watchTimer = 0.5; watchName = '';
    if (director.hasSubject) {
      const fp = director.focusPos; let bd = 49;
      _names.length = 0; labels.providers.forEach((p) => p(_names));
      for (const e of _names) { const d2 = (e.x - fp.x) ** 2 + (e.y - fp.y) ** 2 + (e.z - fp.z) ** 2; if (d2 < bd) { bd = d2; watchName = e.name; } }
    }
  }
  labels.focus = director.hasSubject ? director.focusPos : null;
  labels.update(dt, camera, Oz);
  hud.update(dt);
  helpTimer -= dt;
  if (helpEl) helpEl.style.opacity = helpTimer > 0 ? '0.7' : '0';
  if (helpTimer < 0) document.body.style.cursor = 'none';
  if (!draw) return;
  post.render(time);
  res.update(dt);
  if (statsOn && statsEl) {
    const i = renderer.info;
    statsEl.textContent = `fps ${res.fps.toFixed(0)}  res ${res.scale.toFixed(2)}  cap ${FPS_CAP || 'off'}\n` +
      `calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\n` +
      `s ${s.toFixed(0)} m  depth ${(-camera.position.y).toFixed(1)} m  ${C.timeLabel} ${C.weatherLabel}\n` +
      seq.weights(s).map((e) => `${e.key} ${e.w.toFixed(2)}`).join('  ') +
      `\ngeo ${i.memory.geometries} tex ${i.memory.textures}  seed ${SEED}  ${tier}`;
  }
}
requestAnimationFrame(frame);
