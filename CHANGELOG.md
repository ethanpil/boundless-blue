# Changelog

All notable changes to Boundless Blue. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
- After an update the page could stay at 0% forever when the browser mixed cached old files with new ones; it now re-fetches and reloads once, then shows the error.
