// Dev helpers for looking at props up close (not loaded by the app). In the console:
//   const d = await import('/src/props/rock_dev.js'); d.install();
//   const t = __goto(/^Flange chimney$/); __view(t, 12, 0.7, 1, 1);   // camera override, floors hidden
//   __view(null);                                                      // back to the normal camera
//   d.paletteStats()                                                   // per-segment palettes (rock_gen)
export function install() {
  const o = window.__ocean;
  if (!o.post.__orig) {
    o.post.__orig = o.post.render.bind(o.post);
    o.post.render = (t) => {
      const c = window.__camOv;
      if (c) { o.camera.position.set(c[0], c[1], c[2]); o.camera.lookAt(c[3], c[4], c[5]); o.camera.updateMatrixWorld(); o.U.uCamPos.value.copy(o.camera.position); }
      o.post.__orig(t);
    };
  }
  window.__floors = (v) => { for (const c of o.terrain.chunks.values()) if (c.floor) c.floor.visible = v; };
  window.__items = (re) => { const out = []; for (const c of o.terrain.chunks.values()) for (const l of c.labels) if (re.test(l.name)) out.push(l); return out.sort((a, b) => b.z - a.z); };
  window.__camS = () => -(o.camera.position.z - o.world.position.z);
  // advance the simulation until a labelled prop matching re is ~30 m ahead; returns its label record
  window.__goto = (re, idx = 0) => {
    window.__camOv = null;
    const ahead = () => __items(re).filter((q) => -q.z > __camS() + 8)[idx];
    let l = ahead();
    for (let k = 0; !l && k < 40; k++) { o.advance(6, 1 / 15); l = ahead(); }
    if (!l) return null;
    for (let k = 0; k < 40 && __camS() < -l.z - 30; k++) o.advance(2, 1 / 15);
    return l;
  };
  window.__view = (l, dist = 14, yaw = 0.7, up = 1, aimDy = 0, floors = false) => {
    if (!l) { window.__camOv = null; __floors(true); return 'normal camera'; }
    const s = -l.z, cx = l.x + Math.sin(yaw) * dist, cs = s - Math.cos(yaw) * dist, wz = o.world.position.z;
    const cy = floors ? Math.max(l.y + up, o.shape.floorAt(cx, cs) + 1.0) : l.y + up; // stay above the floor when it is drawn
    window.__camOv = [cx, cy, -cs + wz, l.x, l.y + aimDy, -s + wz];
    __floors(floors);
    o.advance(0.1, 1 / 30);
    return JSON.stringify({ name: l.name, camS: __camS().toFixed(0), s: s.toFixed(0) });
  };
  window.__CH = /^(Flange chimney|Black smoker|Chimney cluster|Candelabra chimney|Beehive diffuser|Toppled chimney|Extinct chimney|Carbonate tower|White smoker|White smoker cluster|Oxidised chimney|Dead chimney cluster|Extinct flange chimney|Extinct candelabra|Carbonate spires|Dead carbonate tower|Fallen carbonate spire)$/;
  return 'installed: __goto(re, i), __view(label, dist, yaw, up, aimDy, floors), __floors(v), __items(re), __CH';
}
export function paletteStats() {
  const g = window.__rockGen;
  if (!g) return null;
  return { stats: g.stats, queue: g.queue.length, palettes: [...g.palettes.values()].map((p) => ({ key: p.seg.key, id: p.seg.id, left: p.left, pools: Object.fromEntries(Object.entries(p.pools).map(([k, v]) => [k, v.length])) })) };
}

// Show n fresh templates of a biome pool in a row in front of the camera (chunk props hidden), under the
// current water and lighting. tint: the biome spec's rock tint. Returns a cleanup function.
//   const off = await d.lineup('kelp', 'rocks', 6); ... off();
export async function lineup(biome, pool, n = 6, { tint = [0.45, 0.43, 0.4], seed = 1, gap = 3.6, dist = 9, tier = 'high', specs = null } = {}) {
  const THREE = await import('three');
  const { GEO } = await import('./rock_gen.js');
  const { rockJob, drain, tiered } = await import('./rock_recipes.js');
  const { Inst, rotY } = await import('./core.js');
  const { MAT } = await import('./materials.js');
  const o = window.__ocean, list = specs || GEO[biome][pool];
  const g = new THREE.Group(), cam = o.camera, f = new THREE.Vector3();
  cam.getWorldDirection(f); f.y = 0; f.normalize();
  const side = new THREE.Vector3(-f.z, 0, f.x), c = cam.position.clone().addScaledVector(f, dist);
  const y = cam.position.y - 2.2;
  for (let k = 0; k < n; k++) {
    const spec = list[k % list.length][1] || list[k % list.length];
    const t = drain(rockJob(tiered(spec, tier), (seed * 7919 + k * 104729) >>> 0));
    const sc = 1.1 / Math.max(0.6, t.r) * (spec.big ? 1.6 : 1);
    const p = c.clone().addScaledVector(side, (k - (n - 1) / 2) * gap);
    const I = new Inst(t, MAT.static, 1);
    I.add(p.x, y, p.z, rotY(k * 1.3), sc, sc, sc, tint[0], tint[1], tint[2]);
    const m = I.build();
    m.userData.label = t.label;
    g.add(m);
  }
  o.scene.add(g);
  // hide chunk props and floors from the camera (render layers: the terrain resets .visible every tick)
  const hidden = [];
  for (const ch of o.terrain.chunks.values()) ch.group.traverse((m) => { if (m.isMesh && m.layers.mask) { hidden.push([m, m.layers.mask]); m.layers.mask = 0; } });
  const look = c.clone(); look.y = y + 0.6;
  window.__camOv = [cam.position.x, cam.position.y, cam.position.z, look.x, look.y, look.z];
  o.advance(0.05, 1 / 30);
  return () => { o.scene.remove(g); for (const m of g.children) m.dispose(); for (const [m, k] of hidden) m.layers.mask = k; window.__camOv = null; };
}
