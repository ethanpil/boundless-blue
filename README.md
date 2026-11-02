# Boundless Blue

Live: https://ethanpil.github.io/boundless-blue/

An endless, procedurally generated underwater journey that runs in the browser. The camera keeps gliding forward through a world that never repeats, past coral reefs, kelp forests, cenote caves, shipwrecks, sunken cities, hydrothermal vents, polar ice and more. Sea life comes and goes along the way. It's meant to be left running for hours.

Built with [three.js](https://threejs.org/). There is no build step and no assets: every texture, mesh and creature is generated in code.

## Run it

Serve the folder with any static file server and open it in a browser. For example:

```bash
python tools/serve.py 8000
```

Then open http://localhost:8000. (`tools/serve.py` disables caching so edited modules always reload; any static server works.)

## Controls

Tap or click anywhere to open the **control deck**: zone, depth gauge, compass, speed, water current, temperature, visibility, clock, weather, sonar, dive log, and buttons for every function below (zones, time, weather, lamps, camera mode, quality, wake lock, share link). It hides itself when idle. Everything works by touch or mouse; the keyboard shortcuts remain. The quick row beside the menu toggles identify mode, lamps, sound and fullscreen. With identify mode on, a tap names whatever is under it, and the deck opens from its handle instead. New-species alerts can be switched off under Systems.

Ambient sound (generated in the browser, no audio files) starts on the first tap or key press, because browsers block autoplay.

The screen is kept awake while the dive is visible (where the browser supports it; `wake=0` turns this off).

The share link reproduces the world (seed and starting zone) without your own settings such as quality, frame cap, wake lock or a locked time and weather.

| Key | Action |
| --- | --- |
| `M` / `Tab` | open the control deck (`Esc` closes it) |
| `H` | toggle zone captions |
| `I` | show names of creatures and objects on screen (with a fun fact for whatever the camera is watching) |
| `T` | skip ahead in time of day |
| `W` | change the weather |
| `F` | fullscreen |
| `S` | stats (fps, draw calls, triangles, biome weights) |
| `Space` | pause |
| `←` / `→` | slower / faster |
| `N` | jump to the next zone |
| `L` | camera lamps: auto / on / off |
| `D` | identify mode: tap or click anything to name it (off by default) |
| `A` | ambient sound on / off |

## URL parameters

| Param | Meaning |
| --- | --- |
| `seed=<int>` | fixed world seed (default: random each load) |
| `biome=<key>` | starting zone: `reef softcoral wall kelp seagrass mangrove sandflat pelagic cave wreck ruins vents deepplain tidepool abyss polar seamount sargassum champagne jellylake sunkenforest anemone bluehole otterkelp whaleshark biobay iceedge hadal` (default: random) |
| `time=<phase>` | starting time of day: `dawn morning day afternoon dusk night` (default: random) |
| `weather=<kind>` | lock the weather: `clear crystal overcast rain plankton surge` |
| `day=<minutes>` | length of a full day/night cycle (default 60) |
| `fps=<n>` | frame-rate cap (default 60; `0` = uncapped) |
| `speed=<m/s>` | cruise speed (default 3.2) |
| `quality=low\|medium\|high\|ultra` | force a quality tier (default: chosen from the GPU, then adjusted at runtime) |
| `wake=0` | let the screen dim and sleep as usual |
| `surprise=<kind>` | trigger a rare encounter soon after load: `divers sub rov glider kaiju` |
| `ruinstyle=<style>` | force a sunken-city style: `greco egypt maya khmer minoan pagoda atlantis` |
| `captions=0` | hide zone captions |
| `start=<metres>` | start further along the path |
| `worker=0` | build the world on the main thread instead of in Web Workers (for A/B tests and debugging) |

## How it works

- **Path first, world second.** A smooth camera path is defined first. Terrain, ceilings and props are then generated around it, so the flight tube is always clear.
- **A documentary camera.** A director picks the most interesting creature or set piece ahead, turns to watch it, slows down for highlights, varies altitude within safe headroom and pulls focus (depth of field).
- **Surprises.** Rare encounters on persistent timers: waving scuba divers, a research submarine, an ROV, an ocean glider, and very rarely something enormous in the murk.
- **Time and weather.** A 60-minute day with golden dusk and a moonlit night dive (lamps on, bioluminescence, coral spawning on some nights), plus crystal-clear, overcast, rain, plankton-bloom and surge weather.
- **Biomes.** A seeded endless sequence of zones, each 450–1100 m long, with cross-fades of about 180 m. Each zone defines water optics, camera depth, terrain shape, props and encounter tables.
- **Water look.** Every material is patched by `applyWater`, which adds:
  - per-channel absorption, so reds die first
  - in-scattering toward the water colour
  - depth-attenuated sunlight
  - projected animated caustics with chromatic dispersion
  - a sky-visibility map, so caves and sea ice cast light correctly
  - camera-mounted lamps in the deep
- **Post.** Volumetric god rays (raymarched through the caustic field and accumulated over frames), dual-filter bloom, ACES tone mapping, grading, vignette and grain.
- **Endless.**
  - **Floating origin:** the world is rebased in steps of 1024 m, so tiled patterns stay seamless.
  - **Shader time:** wraps every 4096 s.
  - **Streaming:** chunks are built over several frames and disposed behind the camera. Their terrain is computed in Web Workers; the main thread adds the props.
  - **Adaptive resolution:** render resolution adjusts to frame time.

## Layout

```
index.html          import map + overlay UI
src/main.js         renderer, camera path, biome blending, frame loop
src/biomes.js       biome catalogue, endless sequence, world shape (path/floor/ceiling)
src/terrain.js      streamed floor/ceiling chunks + sky-visibility map
src/worker/         world-building workers: chunk heightfields and vertex data, sky map, noise texture
src/water.js        shared uniforms, applyWater(), caustics, noise texture
src/env.js          background water, surface from below, marine snow
src/post.js         light shafts, bloom, composite
src/props/          per-biome procedural props and set-pieces
src/creatures/      procedural species, swimming shaders, behaviours, encounter director
```
