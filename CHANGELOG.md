# Changelog

All notable changes to Boundless Blue. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2026-11-14]

### Added
- Two new zones, built from published descriptions: **Lost City** (white carbonate towers on the Atlantis Massif, with a Poseidon-like landmark, mirror-like flange pools, wreckfish and cut-throat eels) and **Cold-Water Coral Reef** (Lophelia mounds in the twilight zone, with redfish, ling and tusk, and a trawl-scar set piece).
- Four rare wildlife events, staged so the camera slows and holds: sperm whales resting upright at the surface, a scalloped hammerhead school over seamount pinnacles by day, schools of Munk's devil rays, and the Octopus Garden on the deep plain (`?event=`).
- `docs/SOURCES.md`: every fact added or corrected in this release, with the source that was read. Facts for 31 species that had none.
- `G` key and More > Instruments for the full instrument cockpit.
- `tools/shot.cjs`, a headless capture script.

### Changed
- Calmer controls: one tap shows a single labelled bar (zone, what is next, pause, next zone, zones, time, weather, sound, identify, fullscreen, More). The instrument cockpit is optional and remembered. Cockpit labels use plain words, settings are grouped with one-line explanations, and the zone picker is grouped.
- The coral reef is far more colourful and varied (lavender, gold, pink and blue corals, staghorn thickets with pale tips, table terraces, tower bommies as showpieces, a new local character every 60-110 m), with about 11% fewer triangles than before.
- Water and light: finer caustics in the shallows that soften with depth; distinct sun shafts that slant at dusk and fade under cloud; a rippling surface and blue Snell's window seen from below; soft out-of-focus motes near the lens; no dark tunnel at the frame edges.
- Lighter on low-end GPUs: 17-30% fewer triangles per frame in the wall, soft-coral, mangrove and seamount zones with no visible change; better GPU detection (Snapdragon X, old Iris and AMD APUs, Intel Macs); resolution follows the window between screens and no longer oscillates.
- The share link carries the zone you are in after a zone jump.

### Fixed
- 21 facts that were wrong or misleading (for example flying fish gliding "50 m above the waves" was a distance, not a height; depth records for snailfish and cusk-eels; giant clam and barrel sponge ages).
- A phone that put the page in the background could come back to a frozen picture (lost WebGL context); it now reloads into the same seed and zone.
- `speed=abc`, `seed=abc` or `start=abc` in the URL blacked out the world; unknown `quality` and `biome` values are ignored.
- The title card could stay stuck after a failed start or when a worker never answered.
- After a zone jump the first wrecks were placed behind the camera, and the trip distance went negative.
- On low-end devices the kelp forest left 20-30 m of bare sand along the path.
- Sun shafts were a flat glow because of a texture-sampling bug.

## [2026-11-02]

### Added
- Five new zones: Otter Coast, Whale Shark Grounds, Bioluminescent Bay, Ice Edge (narwhals) and Hadal Trench (snailfish), with their own props and 17 new species (e17b7af, 768cc9d, 060ccfc).
- Procedural ambient sound that reacts to depth, zone, weather and nearby whales, dolphins and seals (1bf3438).
- Quick toolbar with fullscreen, lamps, sound and identify mode; labelled helm buttons, including Next zone (5dd7f17).
- Identify mode (off by default, key `D`): tap or click anything to get its name (5dd7f17, 578a810).
- Settings for new-species alerts, sound and volume (key `A`) (5dd7f17).
- Progress bar on the title card while the world is built (e17b7af, 6193e98).

### Changed
- Zone jumps and Next zone rebuild the world in place under a fade instead of reloading the page (e17b7af, 83af293).
- Terrain, sky map and noise texture are built in Web Workers; `?worker=0` builds on the main thread (83af293).
- Large animals turn smoothly: they bank, and the head turns before the tail (060ccfc).
- Octopuses rest and crawl calmly, swim with jet pulses, and have matte skin (ee79542).

### Fixed
- Sunken-city domes no longer float: each rests on a full ring of support or lies broken on the floor (b33d2ad).
- A zone jump could hang forever or land in the wrong zone (93da93e, 6193e98).
- Audio nodes leaked; shaders were warmed for the wrong render target and stalled first draws (6193e98).
- Manta tap targets were far larger than the animal; some labels read "Giant giant" (578a810).
- Black squares with white halos on phones: invalid (NaN/overflowing) pixels are now replaced before fog, bloom and the final image.
- After an update the page could stay at 0% forever when the browser mixed cached old files with new ones; it now re-fetches and reloads once, then shows the error.
