# Changelog

All notable changes to Boundless Blue. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2026-11-16]

### Added
- Drag to look: drag the view with the mouse or one finger to turn it, like a video game (1:1 with the pointer, up to 150° either way). The craft keeps flying its route; the view eases back a few seconds after you let go, or stays if you choose Hold. Double-tap or double-click recentres. Setting under More.
- With Identify on, a tap on the name card dismisses it at once (left alone, it still fades by itself).

### Changed
- Scenery no longer stops a few metres from the route. Every seabed zone's own corals, kelp, grass, rocks, sponges, chimneys and wreckage carry on to where the water hides them, in gardens and bare stretches that do not follow the route; the sunken city has streets of walls and columns fading into the haze, and wrecks have other hulls in the distance. The world is kept behind the camera too, for when you look back.
- Turns feel like riding a small submersible instead of a camera pan: the heading eases into and out of bends, ignores the route's small wiggles and banks into turns (up to about 12°), and the camera's looks at animals are slower, eased head turns.
- Sound, more variety in the same muffled style. Every zone family has its own water: lapping and small breakers in the shallows, a heavy swell with shifting sand on reefs, creaks and knocks in kelp, hollow glugs in caves, a wide rumble with distant booms in open water, squeaks of trapped air under ice, near silence in the deep, gas streams at Champagne Reef. Calmer and busier spells come and go, and nights are calmer.
- New water sounds tied to what is on screen: bubble curtains and belches, the wake of a big animal passing, splashes and breach thumps from the surface, strikes, and the tearing and thrashing at the whale fall.
- Animals have several call types, their own pitch, signature whistles and pod dialects, and answer each other. Soldierfish, Picasso triggerfish and Arctic cod now call.

### Removed
- The Deep Whale Fall zone (the daytime Whale Fall stays).

## [2026-11-15]

### Added
- New zone: **Whale Fall**, in daylight. A short, slow zone off Hawaii: a very large whale carcass on a lava flat, different every time and always showing bone, with a feeding crowd all around it. Tiger sharks and oceanic whitetips (6 to 12 at once) bite with their snouts on the flesh and shake for 15-20 seconds, chunks come free in a cloud of scraps, bigger sharks displace smaller ones, new sharks arrive from the blue and sweep through clouds of snapper; trevally, mahi-mahi and crabs; now and then a very large white shark. Facts and sources are in `docs/SOURCES.md`.

### Changed
- Big animals swim through their turns instead of rotating like rigid models. The spine bends along an arc with the head leading and the tail following; otters, seals, sea lions and sharks curl into a deep C, while whales, whale sharks, tuna, turtles and rays turn in wide banked arcs. No turning on the spot and no sliding sideways.
- Whales and other big animals no longer slide sideways when the camera passes: they dive under or rise over its path and pass 4-10 m from the lens. Sea otters duck-dive with an arched, undulating body.
- Sound: the hissy, static-like bed is replaced by a muffled, liquid one, like a head under water with plugged ears: a low rumble, sloshing surges, and bubble trails and glugs in every zone. In the reef, energy above 2 kHz is 34 dB lower at about the same loudness.
- Animal calls are louder (4-10 dB), heard from further away and more frequent, and up to five nearby animals call on their own timers. 18 new voices, each from a published description: sea otters cracking shells on a stone, harbour, harp and ringed seals, bowhead, manatee, dugong, goliath grouper and giant sea bass booms, clownfish, damselfish, garibaldi, grunts, parrotfish crunching coral, spiny lobster rasps, seahorse clicks, kelp rockfish, and a night chorus of sweepers on reefs.

### Fixed
- A failed sound start leaked an audio context on every later tap.

## [2026-11-14]

### Added
- Two new zones, built from published descriptions: **Lost City** (white carbonate towers on the Atlantis Massif, with a Poseidon-like landmark, mirror-like flange pools, wreckfish and cut-throat eels) and **Cold-Water Coral Reef** (Lophelia mounds in the twilight zone, with redfish, ling and tusk, and a trawl-scar set piece).
- Four rare wildlife events, staged so the camera slows and holds: sperm whales resting upright at the surface, a scalloped hammerhead school over seamount pinnacles by day, schools of Munk's devil rays, and the Octopus Garden on the deep plain (`?event=`).
- Signature moments: tarpon hunting in the bioluminescent bay's glow at night, silverside curtains parting around the camera in cenote light, slow tilts up into sun shafts (kelp, caves, sunken forest, blue hole), a lamps-off moment in the deep when glowing animals are near, and a composed camera arc through Jellyfish Lake.
- `docs/SOURCES.md`: every fact added or corrected in this release, with the source that was read. Facts for 31 species that had none.
- `G` key and More > Instruments for the full instrument cockpit.
- `tools/shot.cjs`, a headless capture script.

### Changed
- Calmer controls: one tap shows a single labelled bar (zone, what is next, pause, next zone, zones, time, weather, sound, identify, fullscreen, More). The instrument cockpit is optional and remembered. Cockpit labels use plain words, settings are grouped with one-line explanations, and the zone picker is grouped.
- The coral reef is far more colourful and varied (lavender, gold, pink and blue corals, staghorn thickets with pale tips, table terraces, tower bommies as showpieces, a new local character every 60-110 m), with about 11% fewer triangles than before.
- Kelp Forest: groves along an aisle, a canopy that breaks the sun into shafts, green-gold water, golden backlit fronds, red seaweed understory and urchin barrens; five stand types for variety, at lower triangle cost per stand.
- The documentary camera no longer fixates on one species (in the cave, sweepers held it 58% of the time; now 31%). It turns to hunts, play and curious passes and slows for them: it used to be watching only a quarter of the hunts. A pacing governor brings a highlight forward when a zone has gone quiet, using that zone's own animals. Tarpon now hunt silversides in caves and the bioluminescent bay, and barracuda and jacks strike schools in seagrass, sand flats and mangroves.
- Sunken Wrecks: clear blue water and pale sand, wrecks every ~60 m with growth-covered wreckage trails between them, fans and soft corals on hulls, varied resting states, and a camera that lingers on the big ships. Stretches with little in view went from over half of a flight to almost none.
- Water and light: finer caustics in the shallows that soften with depth; distinct sun shafts that slant at dusk and fade under cloud; a rippling surface and blue Snell's window seen from below; soft out-of-focus motes near the lens; no dark tunnel at the frame edges.
- Lighter on low-end GPUs: 17-30% fewer triangles per frame in the wall, soft-coral, mangrove and seamount zones with no visible change; better GPU detection (Snapdragon X, old Iris and AMD APUs, Intel Macs); resolution follows the window between screens and no longer oscillates.
- Low-tier animals draw about half the triangles (49-73% fewer in the reef, wall, seamount, soft-coral and open-ocean zones) with the same or more animals on screen: schools pick their detail from the nearest visible member, and fish only a few pixels long become simple specks. Creature code allocates about 40% less memory per frame.
- The share link carries the zone you are in after a zone jump.

### Fixed
- 21 facts that were wrong or misleading (for example flying fish gliding "50 m above the waves" was a distance, not a height; depth records for snailfish and cusk-eels; giant clam and barrel sponge ages).
- A phone that put the page in the background could come back to a frozen picture (lost WebGL context); it now reloads into the same seed and zone.
- `speed=abc`, `seed=abc` or `start=abc` in the URL blacked out the world; unknown `quality` and `biome` values are ignored.
- The title card could stay stuck after a failed start or when a worker never answered.
- After a zone jump the first wrecks were placed behind the camera, and the trip distance went negative.
- On low-end devices the kelp forest left 20-30 m of bare sand along the path.
- Sun shafts were a flat glow because of a texture-sampling bug.
- Hunters slid sideways during strikes; they now face where they lunge.

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
