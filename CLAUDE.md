# Boundless Blue — notes for developers and LLMs

(Renamed from "Endless Ocean" on 2026-11-01 to avoid clashing with an existing game series; repo `ethanpil/boundless-blue`.)

Static site, no build step. The three.js version is pinned in the `index.html` import map (0.186.1). Deployed with GitHub Pages from `main` (root).

## Invariants (breaking these causes subtle bugs)
- **Coordinates:** travel distance `s` grows forward, and global `z = -s`. Everything that lives in the world is a child of the `world` group, at global coordinates.
- **Floating origin:**
  - `world.position.z = -Oz`, where `Oz` is a multiple of **1024**.
  - Shader-space patterns (caustics, noise texture, ripples) must use periods that divide 1024. Otherwise they jump at each rebase.
  - Never feed absolute global positions to shaders; use `vWPos`, which is render-space.
- **Shader time** `U.uTime` wraps every 4096 s, for float precision. Visible pops once an hour are accepted.
- **Colours:** biome colours are authored in sRGB and converted to linear in `biomes.js`. Vertex colours and uniforms are linear. Forgetting this washes out the image badly; this happened early on.
- **Materials:** every lit material goes through `applyWater(mat, { key })`, and `key` must be unique per shader variant. three caches programs by `customProgramCacheKey`, and a shared key silently reuses the wrong shader.
- **Flight tube rules:**
  - Solid tall objects keep ≥ 3.5 m from the path line (`pathX(s)`, `pathY(s)`).
  - Low props may sit under the path if their top stays ≥ 1.3 m below `pathY`.
  - Swaying vegetation may fill the tube; only a ~0.6 m core around the camera line stays free.
  - Tall "go-around" obstacles sit on the outside of bends (see `pathCurv`), so they appear dead ahead and the camera curves past them.
  - `floorAt` and `ceilingAt` clamp near the path.
- **Chunks:**
  - Chunks are 64 m long and built by generators under a per-frame time budget.
  - Populators must stay at or under about 5 ms.
  - A chunk can be unloaded while its build is still queued; `terrain.update` drops such builds.

## Why things are the way they are
- **Sky-visibility map** (128² texels at 2 m, CPU-computed, camera-local): lets every material and the god rays know whether a cave or ice ceiling is overhead. This costs much less than shadows.
- **ROV lamps** (`uLamp`): the deep zones and caves are physically too dark to watch, so lamps mounted beside the camera light the scene, as in documentary footage.
  - Auto mode (`updateEnvironment` in main.js) also estimates the light reaching the scene (sun and sky through the water above the camera) and switches the lamps on when it is low. The threshold rises with turbidity (`uSigma.y`), so murky mangrove, kelp or bloom water gets lamps at dusk while clear reef water waits for night (`C.lampAdd`).
  - In turbid zones the in-scatter colours (`deep`, `up`) carry most of the frame, so a dark palette there reads as a black screen. Mangrove was 0x2b4a35 and gave a mean luminance of ~40 at 2 m by day.
- **GPU tiers:** integrated and mobile GPUs (regex in `main.js`) get no MSAA, quarter-res shafts with 16 steps, and DPR ≤ 1. Measured on an Intel HD 4600 at 1024×576: about 7.5 ms per frame for the bare scene (no props or creatures). The full scene (2026-10-18) costs 10–15 ms depending on biome: pelagic ~10, reef ~15. Of that, the post pipeline is a fixed ~5 ms and visible triangles are ~0.25–0.6M.
- **Shadows (high tier only):**
  - A 2048² PCF sun shadow covers ±48 m around a point 32 m ahead of the camera, snapped to shadow texels to prevent shimmer.
  - Terrain marks opaque prop meshes as casting and receiving shadows. The floor only receives.
  - Shadow depth ignores vertex sway, so swaying plants cast static shadows. This is an accepted trade-off.
- **Distance softening:** the composite pass mixes in a quarter-res blurred scene by view depth (turbidity).
- **Dev server:** `python -m http.server` let the browser serve stale ES modules, so use a server that sends `Cache-Control: no-store`.

- **Exact terrain sampling:** `shape.floorAt` / `ceilingAt` sample the rendered chunk meshes (same triangle split as the index buffer). This is O(1), allocation-free and exact, so anything placed with it cannot float. `floorExact` / `ceilingExact` are the analytic fallbacks, used before a chunk is built.
- **Per-segment variety:** `seq.weights(s)` entries carry the segment `g`. Biome `floor` / `ceil` receive `(x, s, ad, g, dx)`, and `sv(g, k)` gives deterministic per-segment randoms for shape, water clarity and tint.
- **LOD:** prop meshes tagged `userData.lod = 'near' | 'mid'` are hidden beyond per-tier distances (`LOD` in terrain.js). Untagged meshes are only fog-culled.
- **POIs:** `ctx.addPOI(type, x, y, s, r, data)` registers set pieces that creatures and the camera director use (`terrain.queryPOIs`).
- **Conditions** (`conditions.js`): a day/night cycle and weather produce multipliers that main.js applies. `U.uNight` and `U.uRain` are shared with props and creatures.
- **Camera director** (`camera.js`): critically damped springs for altitude, gaze, focus and speed. Subjects come from `creatures.subjects(out)` and POIs; cooldowns stop it staring at one thing.
- **Frame cap:** 60 fps by default (`?fps=`). The adaptive-resolution thresholds are relative to the cap. The frame delta comes from `THREE.Timer` (`THREE.Clock` is deprecated since r183 and warns on every load).
- **Heightfield walls:** terrain is a 1.5 m grid, so a near-vertical step becomes straight grid-aligned edges over stretched triangles. Cenote skylights (`cave.ceil`) therefore place the rim by the approximate distance to the noise contour, `(o - th) / |grad o|`, and climb at ~65°.
- **Seamount pinnacles:** besides the 70 m lattice in `peaks()`, every seamount segment has path-side spires (`routePeaksOf`: one every 60-80 m, 15-34 m off the path on the outside of the sharpest bend, the first 45 m ahead of the camera via `segs[0].camStart`). `seamountPeaks(g, s0, s1)` lists both kinds; prop code that places summit POIs should use it rather than its own copy of the lattice.
- **Blue hole camera:** a `bluehole` POI counts as near as its rim when the director picks subjects. While it is watched, the gaze moves to a point ~30 m below the rim (pitch about -25° to -35° across the rim), then eases back to level toward the middle.
- **Share link** (`app.shareUrl`): origin + path with only `seed`, `biome` (and `start`). Quality, wake, fps and the time/weather locks are the viewer's own settings.
- **Wake lock:** a `NotAllowedError` on a request made from a user gesture is stored (`app.wakeLockError`) and requests stop until the option is toggled; a refusal on load is retried on the next tap or key. `app.wakeLock` is the *effective* setting (`wanted && !error`), so a blocked lock shows as off in the deck instead of "waiting" forever, and the toggle's tap clears the error and retries.

## Agent-built subsystems (conventions to keep)
- **Props** (`src/props/`):
  - Layouts run as continuation stages, each ≤ ~5 ms, and merge into batches. LOD is per mesh slice (`userData.lod` plus `THREE.LOD`).
  - Every placement seats on its support through `groundY` / `Ground` in core.js.
  - The new-zone modules (`nb_*.js`, `mangrove.js`, `wall.js`, `softcoral.js`, `deepplain.js`) use `nbFloor` and `seat()` in `nb_common.js`.
  - Registering obstacles, labels with facts, and POIs is mandatory for solid or notable items.
- **Creatures** (`src/creatures/`):
  - `subjects(out)` ids are `uid*1000+i` (animal) or `+999` (group).
  - Night tables blend by `U.uNight`, and POI set pieces have per-type cooldowns.
  - Encounters keep a single hidden class, which matters for V8 speed.
- **Control deck** (`hud.js`, `src/hud/`): talks only to `window.__ocean.app` (main.js). DOM writes are cached and refreshed at ≤ 5 Hz (heading) or 1 Hz slices; sonar and compass are canvases at ≤ 20 fps. No CSS transitions on gauges: restarting them cost 1–2 ms per refresh on the HD 4600.
- **Quality** (`quality.js`):
  - Tiers are low, medium, high and ultra, set by `tierFor()` from the GPU string. The `WQ` macro bakes the tier into every water shader.
  - At runtime, `AdaptiveResolution` steps features first and then resolution, with hysteresis. It uses GPU timer queries when available (`post.gpuMs`).
  - Explicit `?quality=` disables adaptation.
- **Anti-repetition:** `water.js` exports tiling-breakup samplers (`nrTex*`, `nrTri`). Use them instead of a plain `texture2D(uNoiseTex, …)` for large surfaces.
- **Rock pools:** `rock_gen.js` regenerates `T.rocks`, `T.mound`, `T.pinnacle`, `T.bigRocks`, `T.tpRock` and `T.ventRock`, plus vent chimneys, per biome segment. It runs lazily in ≤ 2 ms slices. Always reference these pools live (`tpl: T.rocks`), never as copies (`[...T.rocks]`).
- **Creatures:**
  - `sep.js` separates every pair of animals each frame using geometry-derived capsules, sweep-and-prune, and cross-group checks only where boxes overlap.
  - `_terrainFix` checks 8 body extremities against the floor, ceiling and surface.
  - Test tools in devfly.js: `spacingTest`, `terrainTest`, `presenceTest`.
  - The blue whale is scheduled by `director.whaleTick`.
- **Surprises** (`src/surprises/`):
  - One encounter at a time, on persistent timers stored in localStorage key `boundlessBlue.surprises.v1` (falls back to the old `endlessOcean.surprises.v1`).
  - Builds are stepped and use `compileAsync`. Bodies are registered as moving obstacles (`o.sur = true`).
  - Debug: `__ocean.surprises.trigger(kind)`, `list()`.
- **Wrecks and ruins** are generated per segment:
  - wrecks: hulls are lofted in `wreck_types*.js`; time-sliced jobs look 460 m ahead
  - ruins: city plans, building kits and styles live in the `ruins_*.js` files
  - Big flat props should keep encrusting growth `aFx.x` ≤ ~0.25, or it reads as camouflage.
- **New-zone props:**
  - `nb2_*.js` covers seamount, bluehole, sunkenforest and champagne. Its encrusting skin is `nb2_crust.js`.
  - `nb3_*.js` covers sargassum, jellylake and anemone.
  - Anemone hosts register `anemone` POIs, where the creatures place clownfish families.
- **Audits:** run them before shipping prop or creature changes, because they catch floating and penetration regressions.
  - `window.__propsAudit` (in-browser ground-gap audit)
  - `(await import('/src/creatures/devfly.js')).obstacleTest(60, false)` (creature-in-rock check)
  - `(await import('/src/creatures/prof.js')).prof(30)` (creature CPU)
  - `tools/` (Node harnesses)

## Debugging
- `__ocean.advance(seconds)` steps the simulation without rAF (the preview pane throttles rAF). `__ocean.bench(w, h, n)` measures GPU ms per frame at a fixed size. Benchmarks are unreliable while other tabs render the app.
- `window.__ocean` exposes the scene, camera, terrain, shape, seq, creatures, post and U.
- `window.__props` holds per-populator timings and triangle counts.
- `?cr=<species>&crstats=1` forces a creature species and logs creature stats.
