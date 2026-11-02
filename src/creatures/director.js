// Encounter director: blended per-biome tables with rarity, cooldowns, novelty and budgets.
// Spawns ahead of the camera at the fog edge (or behind it, out of view, for overtakers).
import { mulberry32, hash2i } from '../noise.js';
import { speciesOf, DIEL } from './species.js';
import { Obstacles } from '../obstacles.js';
import { sargassumCover, blueHoleOf } from '../biomes.js';

// [species key | 'proc:<kind>', weight, cooldown (s)]
// target = desired simultaneous encounters, lat = max lateral offset from the camera path.
// night / dusk lists are blended in by U.uNight (diel vertical migration, nocturnal hunters, dusk feeding).
const NIGHT_REEF = [['whitetipNight', 2.5, 60], ['morayNight', 2.5, 60], ['spinyLobster', 3, 40], ['reefCrab', 3, 40], ['soldierfish', 3, 40],
  ['octopus', 3, 60], ['cuttlefish', 2, 70], ['reefSquid', 2.5, 60], ['combJelly', 2, 80], ['lanternfish', 1.5, 90], ['glowSquid', 1.2, 110], ['sweeper', 2, 60]];
const NIGHT_SAND = [['spinyLobster', 2, 50], ['reefCrab', 2.5, 40], ['octopus', 2.5, 60], ['cuttlefish', 2, 70], ['reefSquid', 2.5, 60],
  ['combJelly', 1.5, 90], ['morayNight', 1, 90], ['flounder', 1.5, 60], ['lanternfish', 1, 100]];
const NIGHT_KELP = [['octopus', 3, 60], ['reefSquid', 2.5, 60], ['combJelly', 2, 80], ['lanternfish', 1.5, 90], ['harbourSeal', 1, 140], ['spinyLobster', 2.5, 50]];
const NIGHT_OPEN = [['lanternfish', 4, 50], ['hatchetfish', 2, 70], ['glowSquid', 2.5, 70], ['combJelly', 2.5, 70], ['pelagia', 2, 80], ['oceanicSquid', 2, 90], ['siphonophore', 0.8, 200]];
const NIGHT_MANGROVE = [['reefCrab', 3, 40], ['spinyLobster', 1, 80], ['lemonShark', 1.5, 90], ['combJelly', 1.5, 80], ['octopus', 1.5, 80], ['tarpon', 1.5, 90]];
const DUSK = [['jack', 3, 60], ['barracuda', 3, 60], ['sardine', 2, 80]];
export const TABLES = {
  reef: { cover: 3, target: 17, lat: 45, list: [
    ['chromis', 6, 25], ['anthias', 6, 25], ['bluetang', 4, 45], ['yellowtang', 4, 45], ['clownfish', 3, 60], ['butterfly', 4, 45],
    ['copperband', 2, 70], ['moorish', 3, 60], ['emperorAngel', 2, 90], ['queenAngel', 2, 90], ['parrotfish', 4, 45], ['lionfish', 2, 90],
    ['puffer', 2, 90], ['boxfish', 2, 100], ['coralGrouper', 2, 70], ['snapper', 3, 60], ['sweetlips', 2, 80], ['picasso', 2, 90],
    ['sergeant', 3, 60], ['napoleon', 1, 200], ['barracuda', 1.5, 150], ['jack', 1.2, 160], ['reefShark', 2, 100], ['whitetip', 1.5, 120],
    ['blacktip', 1.2, 140], ['eagleRay', 1.2, 150], ['bluespotRay', 1.5, 90], ['moray', 2, 60], ['spotMoray', 1.5, 80], ['gardenEel', 2, 90],
    ['splendidEel', 1, 120], ['greenTurtle', 1.8, 120], ['octopus', 2.5, 80], ['cuttlefish', 2, 80], ['reefSquid', 2, 80],
    ['manta', 0.7, 360], ['whaleShark', 0.45, 600], ['bottlenose', 0.4, 500], ['proc:reef', 8, 10], ['rainbowRunner', 0.8, 120],
    ['southernRay', 1.2, 120], ['flounder', 1.5, 90], ['lizardfish', 1.5, 80], ['goatfish', 2, 60], ['nurseShark', 0.8, 160],
  ], night: NIGHT_REEF, dusk: DUSK },
  sandflat: { cover: 3, target: 12, lat: 50, list: [
    ['southernRay', 4, 50], ['bluespotRay', 3, 50], ['eagleRay', 2.5, 90], ['manta', 0.8, 300], ['gardenEel', 3, 60], ['splendidEel', 1.5, 90],
    ['flounder', 3, 45], ['guitarfish', 2, 70], ['lizardfish', 2.5, 50], ['goatfish', 3, 40], ['nurseShark', 1.5, 100], ['greenTurtle', 2, 90],
    ['reefSquid', 1.5, 80], ['cuttlefish', 1.5, 80], ['octopus', 1.5, 90], ['blacktip', 0.8, 150], ['silverside', 2, 60], ['jack', 0.6, 160],
    ['barracuda', 0.6, 150], ['proc:sandflat', 2, 30],
  ], night: NIGHT_SAND, dusk: DUSK },
  kelp: { cover: 3, target: 12, lat: 40, list: [
    ['garibaldi', 5, 40], ['sheephead', 3, 60], ['kelpBass', 4, 45], ['blacksmith', 5, 40], ['senorita', 4, 45], ['opaleye', 3, 60],
    ['giantSeaBass', 1, 220], ['leopardShark', 1.5, 120], ['batRay', 1.5, 120], ['harbourSeal', 1.5, 150], ['seaLion', 1.8, 120],
    ['seaNettle', 2, 90], ['moonJelly', 1.5, 100], ['sardine', 1.2, 150], ['octopus', 2, 90], ['reefSquid', 1.5, 90], ['blueWhale', 0.25, 900], ['proc:kelp', 5, 15],
  ], night: NIGHT_KELP },
  seagrass: { cover: 3, target: 10, lat: 45, list: [
    ['seahorse', 4, 45], ['pipefish', 3, 60], ['silverside', 5, 40], ['filefish', 3, 60], ['greenTurtle', 3, 80], ['cuttlefish', 2.5, 80],
    ['southernRay', 2.5, 80], ['bluespotRay', 1.5, 100], ['puffer', 2, 90], ['manatee', 0.8, 300], ['dugong', 0.6, 360],
    ['moonJelly', 1.5, 100], ['parrotfish', 1.5, 90], ['proc:seagrass', 5, 15], ['flounder', 2, 70], ['goatfish', 1.5, 70], ['reefSquid', 1.5, 90],
    ['eagleRay', 1, 150], ['blacktip', 1, 140], ['snapper', 2, 80],
  ], night: NIGHT_SAND },
  pelagic: { cover: 3, target: 11, lat: 90, list: [
    ['sardine', 4, 70], ['anchovy', 3, 70], ['yellowfin', 3, 80], ['bluefin', 1.5, 140], ['mahi', 2, 100], ['sailfish', 0.8, 240],
    ['oceanicWhitetip', 1.2, 160], ['blueShark', 2, 120], ['greatWhite', 0.5, 420], ['hammerhead', 0.8, 300], ['mola', 1.2, 220],
    ['manta', 0.8, 300], ['whaleShark', 0.7, 420], ['humpback', 0.9, 360], ['blueWhale', 0.5, 600], ['spermWhale', 0.5, 600],
    ['orca', 0.6, 500], ['commonDolphin', 1.6, 200], ['bottlenose', 1, 240], ['pilotWhale', 0.6, 400], ['moonJelly', 2, 90],
    ['pelagia', 1.5, 120], ['seaNettle', 1, 140], ['siphonophore', 0.6, 300], ['greenTurtle', 1, 160], ['oceanicSquid', 2, 120], ['proc:pelagic', 1.5, 40], ['rainbowRunner', 1.5, 90],
  ], night: NIGHT_OPEN, dusk: DUSK },
  cave: { cover: 2.5, target: 7, lat: 4, list: [
    ['tarpon', 4, 50], ['sweeper', 5, 40], ['silverside', 4, 45], ['jack', 1, 150], ['moray', 1.5, 90], ['proc:cave', 3, 25],
    ['blenny', 1.5, 60], ['eelpout', 0.5, 120],
  ] },
  wreck: { cover: 3, target: 10, lat: 45, list: [
    ['barracuda', 3, 80], ['goliath', 2, 120], ['sweeper', 4, 50], ['batfish', 3, 70], ['sandTiger', 2, 120], ['moray', 2, 60],
    ['jack', 2, 100], ['snapper', 3, 60], ['eagleRay', 1.2, 150], ['greenTurtle', 1.2, 150], ['lionfish', 2, 90], ['reefShark', 1.5, 120],
    ['proc:wreck', 4, 15], ['manta', 0.4, 400], ['octopus', 2, 80], ['southernRay', 1.5, 90], ['flounder', 1, 100], ['nurseShark', 1, 130],
  ], night: NIGHT_REEF, dusk: DUSK },
  ruins: { cover: 3, target: 13, lat: 40, list: [
    ['snapper', 3, 60], ['parrotfish', 3, 60], ['napoleon', 1.2, 200], ['coralGrouper', 2, 90], ['goliath', 1, 150], ['jack', 2, 100],
    ['barracuda', 2, 100], ['eagleRay', 1.5, 120], ['southernRay', 1.5, 100], ['octopus', 2.5, 80], ['greenTurtle', 1.5, 120],
    ['moray', 1.5, 80], ['bluetang', 2, 60], ['butterfly', 2, 60], ['moorish', 2, 70], ['chromis', 3, 40], ['anthias', 3, 40],
    ['proc:ruins', 6, 12], ['bottlenose', 0.4, 400], ['manta', 0.4, 400],
  ], night: NIGHT_REEF, dusk: DUSK },
  vents: { cover: 3, target: 9, lat: 30, list: [
    ['eelpout', 4, 40], ['rattail', 3, 60], ['anglerfish', 2.5, 90], ['chimaera', 2, 100], ['helmetJelly', 2, 90], ['atolla', 2, 90],
    ['viperfish', 1.5, 110], ['lanternfish', 2, 90], ['siphonophore', 0.8, 240], ['octopus', 1.5, 120], ['glowSquid', 1, 120], ['proc:vents', 2, 30],
  ] },
  tidepool: { cover: 2.5, target: 7, lat: 3, list: [
    ['sculpin', 4, 40], ['blenny', 4, 40], ['silverside', 4, 40], ['opaleye', 3, 60], ['garibaldi', 2, 80], ['octopus', 1, 150],
    ['proc:tidepool', 3, 25],
  ] },
  // lamp-lit midnight zone: groups pass close to the camera (the lamps reach ~10 m), so the lateral range is narrow
  abyss: { cover: 3.5, target: 11, lat: 30, list: [
    // short cooldowns: the prime spawn uses most of this small cast at once, and the zone must not empty out after it
    ['lanternfish', 5, 25], ['hatchetfish', 4, 30], ['anglerfish', 2.5, 45], ['viperfish', 2.5, 45], ['dragonfish', 2, 50],
    ['atolla', 3, 35], ['combJelly', 3, 35], ['helmetJelly', 2.5, 40], ['pelagia', 2, 40], ['siphonophore', 1.5, 100],
    ['vampireSquid', 1.5, 80], ['giantSquid', 0.35, 700], ['glowSquid', 2.5, 40], ['spermWhale', 0.3, 700], ['proc:abyss', 2, 20],
  ] },
  softcoral: { cover: 3, target: 16, lat: 40, night: NIGHT_REEF, dusk: DUSK, list: [
    ['anthias', 7, 20], ['purpleAnthias', 6, 20], ['glassfish', 4, 40], ['lionfish', 2.5, 70], ['napoleon', 1.2, 160], ['bannerfish', 3, 50],
    ['cleanerWrasse', 1.5, 60], ['butterfly', 3, 50], ['emperorAngel', 1.5, 90], ['bluetang', 2, 60], ['picasso', 1.5, 80], ['coralGrouper', 2, 70],
    ['moray', 1.5, 70], ['octopus', 1.5, 90], ['greenTurtle', 1.2, 140], ['hawksbill', 1, 160], ['manta', 0.5, 360], ['reefShark', 1, 140],
    ['jack', 1, 160], ['barracuda', 1, 150], ['proc:softcoral', 5, 12], ['bottlenose', 0.3, 500], ['sweetlips', 1.5, 80], ['eagleRay', 0.8, 160],
  ] },
  wall: { cover: 3, target: 14, lat: 45, night: NIGHT_REEF, dusk: DUSK, list: [
    ['hammerheadSchool', 1.2, 240], ['eagleRay', 2, 120], ['potatoGrouper', 1.5, 120], ['goliath', 0.8, 180], ['anthias', 6, 20], ['purpleAnthias', 4, 25],
    ['turtleRest', 1, 120], ['hawksbill', 1.2, 120], ['greenTurtle', 1, 140], ['sweetlips', 2, 70], ['reefShark', 2, 100], ['whitetip', 1.2, 120],
    ['napoleon', 1, 180], ['barracuda', 1.5, 120], ['jack', 1.5, 120], ['manta', 0.6, 300], ['bannerfish', 2, 60], ['moray', 1.5, 70],
    ['butterfly', 2, 60], ['proc:wall', 4, 15], ['whaleShark', 0.25, 700], ['oceanicWhitetip', 0.4, 400], ['bottlenose', 0.4, 400],
  ] },
  mangrove: { cover: 3.5, target: 13, lat: 22, night: NIGHT_MANGROVE, list: [
    ['juvSnapper', 5, 30], ['grunt', 5, 30], ['juvBarracuda', 3, 50], ['cassiopea', 3.5, 50], ['lemonShark', 2.5, 90], ['needlefish', 3, 50],
    ['archerfish', 2.5, 60], ['saltwaterCroc', 0.35, 500], ['silverside', 3, 40], ['seahorse', 1, 120], ['southernRay', 1.2, 110], ['moonJelly', 1, 120],
    ['proc:mangrove', 3, 20], ['goatfish', 1, 90], ['reefCrab', 1, 80], ['tarpon', 2.5, 90],
  ] },
  deepplain: { cover: 2.5, target: 9, lat: 40, list: [
    ['tripodFish', 4, 40], ['seaPig', 4, 40], ['dumbo', 1.5, 120], ['rattail', 3, 50], ['giantIsopod', 2, 80], ['chimaera', 2, 90],
    ['glassSquid', 1.5, 100], ['hagfish', 1, 120], ['deepCrab', 2, 70], ['eelpout', 1.5, 80], ['anglerfish', 0.8, 160], ['sleeperShark', 0.3, 500],
    ['atolla', 1, 120], ['helmetJelly', 1, 120], ['proc:deepplain', 1, 40],
  ] },
  polar: { cover: 3, target: 11, lat: 50, ensure: { S: ['adeliePenguin', 'emperorPenguin'], N: ['beluga', 'narwhal', 'harbourSeal'] }, list: [
    ['emperorPenguin', 5, 35], ['adeliePenguin', 6, 25], ['leopardSeal', 1.5, 150], ['weddellSeal', 1.5, 150], ['krill', 3, 60],
    ['icefish', 3, 60], ['toothfish', 1.5, 120], ['orca', 0.6, 400], ['humpback', 0.5, 450],
    ['beluga', 4, 60], ['narwhal', 3, 80], ['arcticCod', 4, 50], ['harbourSeal', 1.5, 150], ['greenlandShark', 0.5, 450],
    ['lionsMane', 1.5, 140], ['moonJelly', 1.5, 100], ['combJelly', 1, 120], ['proc:polar', 1.5, 40],
  ] },
  // ---- seven more oceanscapes ----
  seamount: { cover: 3.2, target: 16, lat: 60, night: NIGHT_REEF, dusk: DUSK, list: [
    ['hammerheadSchool', 2.5, 200], ['jack', 3, 90], ['barracuda', 2.5, 100], ['manta', 1.2, 240], ['eagleRay', 1.5, 140], ['reefShark', 2, 110],
    ['silkyShark', 2, 120], ['potatoGrouper', 1.5, 120], ['coralGrouper', 1.5, 90], ['yellowfin', 1.5, 140], ['rainbowRunner', 1.5, 90],
    ['bluefinTrevally', 2, 80], ['fusilier', 3, 50], ['anthias', 4, 25], ['purpleAnthias', 2, 40], ['bannerfish', 1.5, 70], ['napoleon', 0.8, 200],
    ['whaleShark', 0.3, 600], ['oceanicWhitetip', 0.4, 400], ['bottlenose', 0.4, 400], ['greenTurtle', 0.8, 150], ['moorish', 1, 90], ['proc:seamount', 3, 20],
  ] },
  sargassum: { cover: 3, target: 12, lat: 40, night: NIGHT_OPEN, list: [
    ['sargassumfish', 4, 35], ['juvJack', 4, 40], ['juvTrigger', 3, 50], ['filefish', 2.5, 60], ['mahi', 3, 80], ['loggerheadJuv', 3, 70],
    ['loggerhead', 1, 160], ['flyingFish', 3.5, 50], ['moonJelly', 1.5, 100], ['pelagia', 1, 120], ['rainbowRunner', 1, 120],
    ['oceanicWhitetip', 0.4, 400], ['commonDolphin', 0.6, 300], ['proc:sargassum', 2, 30],
  ] },
  champagne: { cover: 3.2, target: 17, lat: 35, night: NIGHT_REEF, dusk: DUSK, list: [
    ['anthias', 5, 25], ['chromis', 5, 25], ['butterfly', 3, 45], ['moorish', 2, 60], ['bluetang', 2.5, 50], ['yellowtang', 2.5, 50], ['regalAngel', 1.5, 80],
    ['flameAngel', 2, 60], ['clownTrigger', 1.2, 100], ['picasso', 1.5, 80], ['parrotfish', 2.5, 60], ['boxfish', 1.5, 90], ['puffer', 1.5, 90],
    ['trumpetfish', 3, 50], ['seahorse', 2.5, 60], ['octopus', 2.5, 70], ['moray', 2, 60], ['spotMoray', 1.5, 80], ['lionfish', 1.5, 90],
    ['longnoseHawkfish', 1.5, 80], ['cuttlefish', 1.5, 90], ['greenTurtle', 1, 140], ['hawksbill', 0.8, 160], ['gardenEel', 1, 120],
    ['goatfish', 1.5, 70], ['sergeant', 2, 50], ['powderTang', 1.5, 70], ['foxface', 1.2, 90], ['proc:champagne', 6, 12],
  ] },
  jellylake: { cover: 4, target: 12, lat: 30, list: [
    ['goldenJelly', 12, 3], ['moonJelly', 3, 30], ['cardinalfish', 2.5, 40], ['silverside', 1, 80], ['proc:jellylake', 1, 60],
  ] },
  sunkenforest: { cover: 3, target: 13, lat: 40, night: NIGHT_SAND, dusk: DUSK, list: [
    ['silverside', 5, 30], ['snapper', 3, 60], ['sheepshead', 4, 45], ['spadefish', 3, 60], ['barracuda', 2, 100], ['greenTurtle', 1.5, 120],
    ['loggerhead', 1.5, 130], ['goliath', 1, 150], ['jack', 1.2, 140], ['flounder', 1.5, 80], ['southernRay', 1.2, 100], ['octopus', 1.5, 90],
    ['nurseShark', 0.6, 200], ['seaNettle', 1, 120], ['moonJelly', 1, 120], ['sardine', 0.6, 200], ['proc:sunkenforest', 3, 20],
  ] },
  anemone: { cover: 3.2, target: 16, lat: 35, night: NIGHT_REEF, dusk: DUSK, list: [
    ['clownfish', 4, 30], ['pinkSkunkClown', 3, 40], ['tomatoClown', 3, 40], ['blackClown', 2.5, 50], ['clarkClown', 3, 40], ['dominoDamsel', 4, 30],
    ['humbug', 3, 35], ['cleanerShrimp', 2, 50], ['chromis', 3, 40], ['anthias', 2, 40], ['butterfly', 2, 60], ['bluetang', 1.5, 70],
    ['moorish', 1, 90], ['cleanerWrasse', 1.5, 60], ['greenTurtle', 1, 150], ['octopus', 1.2, 100], ['lionfish', 1, 100], ['sweetlips', 1, 100],
    ['flameAngel', 1.2, 80], ['proc:anemone', 4, 15],
  ] },
  bluehole: { cover: 3.2, target: 15, lat: 50, night: NIGHT_REEF, dusk: DUSK, list: [
    ['reefShark', 3, 90], ['blacktip', 1.5, 120], ['potatoGrouper', 2, 100], ['goliath', 1.2, 140], ['coralGrouper', 1.5, 90], ['greenTurtle', 2, 100],
    ['hawksbill', 1.2, 130], ['jack', 3, 80], ['barracuda', 2.5, 90], ['fusilier', 2.5, 60], ['bannerfish', 2, 60], ['bluefinTrevally', 2, 80],
    ['snapper', 2, 70], ['eagleRay', 1.2, 150], ['anthias', 3, 30], ['chromis', 3, 30], ['parrotfish', 2, 70], ['napoleon', 0.8, 200],
    ['manta', 0.5, 300], ['proc:bluehole', 4, 15],
  ] },
  // ---- five more zones ----
  // kelp and rocky reef along the California coast: sea otters rafting at the surface (one with a pup on her chest, one
  // eating an urchin), the kelp-forest fish below, harbour seals passing
  otterkelp: { cover: 3, target: 13, lat: 35, ensure: { N: ['seaOtter'], S: ['seaOtter'] }, night: NIGHT_KELP, list: [
    ['seaOtter', 4, 45], ['seaOtterUrchin', 2, 70], ['seaOtterMom', 1.6, 90], ['garibaldi', 4, 40], ['kelpRockfish', 3.5, 45], ['sheephead', 3, 60],
    ['kelpBass', 3.5, 45], ['senorita', 4, 45], ['blacksmith', 3, 50], ['opaleye', 2, 60], ['harbourSeal', 2, 110], ['batRay', 1, 150],
    ['leopardShark', 0.8, 160], ['giantSeaBass', 0.5, 240], ['seaNettle', 0.8, 140], ['octopus', 0.8, 140], ['proc:otterkelp', 4, 15],
  ] },
  // open blue over sand ~40 m down: whale sharks ram-feeding at the surface (remoras, pilot trevally, cobia), mantas
  // somersaulting through the plankton, bait balls
  whaleshark: { cover: 3, target: 10, lat: 70, ensure: { N: ['whaleSharkFeed'], S: ['whaleSharkFeed'] }, night: NIGHT_OPEN, list: [
    ['whaleSharkFeed', 5, 50], ['mantaFeed', 3, 80], ['sardine', 2.5, 80], ['anchovy', 2, 80], ['rainbowRunner', 1.5, 100], ['cobia', 0.8, 160],
    ['moonJelly', 1, 120], ['pelagia', 0.8, 140], ['yellowfin', 0.5, 220], ['bottlenose', 0.3, 420], ['oceanicWhitetip', 0.25, 420],
  ] },
  // a night-dark mangrove lagoon where every movement lights up the dinoflagellates (Creatures._ambientFx)
  biobay: { cover: 3, target: 11, lat: 20, list: [
    ['combJelly', 4, 35], ['moonJelly', 2.5, 50], ['pelagia', 2, 60], ['needlefish', 3.5, 40], ['mullet', 4, 40], ['silverside', 3, 40],
    ['cassiopea', 2.5, 60], ['tarpon', 1.5, 90], ['southernRay', 1, 100], ['lemonShark', 0.8, 150], ['reefSquid', 1, 90], ['juvSnapper', 1, 70],
  ] },
  // the Arctic pack-ice edge: narwhals (tusked males with females), belugas, a bowhead, ringed and harp seals, Arctic
  // cod hiding under the floes, sea angels
  iceedge: { cover: 3, target: 11, lat: 50, ensure: { N: ['narwhal', 'beluga'], S: ['narwhal', 'beluga'] }, list: [
    ['narwhal', 4, 60], ['beluga', 3.5, 60], ['bowhead', 0.7, 300], ['ringedSeal', 2.5, 80], ['harpSeal', 2.5, 80], ['arcticCodIce', 4, 40],
    ['arcticCod', 0.8, 120], ['seaAngel', 3, 45], ['lionsMane', 1.2, 140], ['combJelly', 1.5, 90], ['moonJelly', 1, 120], ['greenlandShark', 0.35, 420],
  ] },
  // ~8000 m down, lamp-lit and sparse: Mariana snailfish, supergiant amphipods near the floor, cusk-eels
  hadal: { cover: 1.6, target: 7, lat: 16, list: [
    ['snailfish', 5, 20], ['amphipod', 3, 35], ['cuskEel', 2.5, 45],
  ] },
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TAU = Math.PI * 2;
// activity by time of day: diurnal fish thin out after dark, nocturnal ones only come out at night
const dielW = (k, night) => { const d = DIEL[k] ?? (k.startsWith('proc:') ? 'day' : null); return d === 'day' ? 1 - 0.75 * night : d === 'night' ? night : 1; };
const REMORA_HOSTS = { whaleShark: 0.85, whaleSharkFeed: 0.9, mantaFeed: 0.5, manta: 0.6, oceanicWhitetip: 0.6, reefShark: 0.3, blacktip: 0.25, whitetip: 0.2, greatWhite: 0.3,
  hammerhead: 0.25, hammerheadSchool: 0.2, sandTiger: 0.3, lemonShark: 0.25, greenTurtle: 0.2, hawksbill: 0.15, blueShark: 0.2, silkyShark: 0.35, loggerhead: 0.25 };
const CURIOUS = new Set(['greenTurtle', 'hawksbill', 'manatee', 'dugong', 'potatoGrouper', 'napoleon', 'goliath', 'giantSeaBass']);
const PLAY = new Set(['bottlenose', 'commonDolphin', 'seaLion', 'harbourSeal', 'leopardSeal', 'ringedSeal', 'harpSeal']);
const HUNTERS = { pelagic: ['yellowfin', 'sailfish', 'commonDolphin'], kelp: ['seaLion', 'kelpBass'], polar: ['adeliePenguin'],
  reef: ['jack', 'barracuda', 'blacktip'], wall: ['jack', 'barracuda'], softcoral: ['jack', 'barracuda'], sandflat: ['jack', 'barracuda'],
  wreck: ['jack', 'barracuda'], ruins: ['jack', 'barracuda'], seagrass: ['barracuda'], mangrove: ['juvBarracuda', 'tarpon'],
  seamount: ['jack', 'barracuda', 'yellowfin', 'silkyShark', 'bluefinTrevally'], bluehole: ['jack', 'barracuda', 'bluefinTrevally'], sargassum: ['mahi'],
  champagne: ['jack', 'bluefinTrevally'], anemone: ['bluefinTrevally'], sunkenforest: ['barracuda', 'jack'], whaleshark: ['yellowfin', 'rainbowRunner'] };
// zones open enough for a passing blue whale
const WHALE_ZONES = new Set(['pelagic', 'seamount', 'wall', 'bluehole', 'sargassum']);
// lamp-lit deep zones: no shallow-water species once they dominate the blend
const DEEP_ZONES = new Set(['abyss', 'deepplain', 'vents', 'hadal']);
const CLOSE_SKIP = new Set(['strike', 'play', 'lunge', 'circle', 'curious', 'majestic', 'swirl', 'shadow']);
// species a set piece will need (prebuilt in idle time when such a POI is coming up)
const POI_SPECIES = { 'cleaning-station': ['manta', 'cleanerWrasse'], 'whale-fall': ['hagfish', 'rattail', 'deepCrab', 'sleeperShark'],
  'brine-pool': ['eelpout', 'deepCrab'], ledge: ['turtleRest', 'hawksbill', 'nurseShark'], 'wall-overhang': ['sweetlips'], 'amphora-den': ['octopus'],
  wreck: ['glassfish', 'goliath', 'potatoGrouper', 'batfish'], 'kelp-clearing': ['seaLion'], iceberg: ['adeliePenguin', 'emperorPenguin', 'beluga'],
  'garden-eel-field': ['gardenEel', 'splendidEel'], 'cave-opening': ['glassfish', 'sweeper'], 'vent-field': ['eelpout', 'deepCrab'],
  'mangrove-roots': ['juvSnapper', 'grunt', 'juvBarracuda'], statue: ['jack', 'snapper'], giant: ['jack', 'snapper'], arch: ['jack', 'snapper'], treasure: ['moray', 'spotMoray'],
  anemone: ['clownfish', 'pinkSkunkClown', 'tomatoClown', 'blackClown', 'clarkClown', 'cleanerShrimp', 'dominoDamsel'] };
const CLOWNS = ['clownfish', 'pinkSkunkClown', 'tomatoClown', 'blackClown', 'clarkClown'];
const pickW = (rng, obj) => { let t = 0; for (const k in obj) t += obj[k]; let r = rng() * t; for (const k in obj) { r -= obj[k]; if (r <= 0) return k; } return Object.keys(obj)[0]; };

export class Director {
  constructor(sys) {
    this.sys = sys;
    this.rng = mulberry32((sys.seed ^ 0x5eed1234) >>> 0);
    this.clock = 0; this.timer = 0; this.hlTimer = 45 + this.rng() * 40;
    this.cool = new Map(); this.seen = new Map(); this.spCache = new Map();
    this.emptyTime = 0; this.primed = false; this.lastSpawn = -1;
    this.forced = sys.forceSpecies || null;
  }

  // Zone jump: forget everything tied to the old place (set pieces done, the blue hole, close-encounter pacing, spawn
  // cooldowns) and prime a new cast at the next update. The blue-whale and highlight schedules keep running.
  reset() {
    this.primed = false; this.primedEnsure = false; this.timer = 0; this.lastSpawn = -1; this.leadFail = undefined; this.wantLead = false;
    this.cool.clear(); this.emptyTime = 0;
    if (this.poiDone) this.poiDone.clear();
    this.holeDone = undefined; this.poiT = 0; this.holeT = 0; this.dlT = 0; this.ensureT = 0;
    if (this.closeSeen) this.closeNext = this.clock + 6 + this.rng() * 6;
    this._pw = null; this._c = null;
    if (this._pois) this._pois.length = 0;
    if (this._ppw) this._ppw.length = 0;
  }

  species(key) {
    let sp = this.spCache.get(key);
    if (!sp) {
      sp = speciesOf(key);
      if (!sp) return null;
      if (this.spCache.size > 300) this.spCache.delete(this.spCache.keys().next().value);
      this.spCache.set(key, sp);
    }
    return sp;
  }

  update(dt, c) {
    this.clock += dt; this.hlTimer -= dt; this.timer -= dt;
    const sys = this.sys;
    if (!this.primed || c.jumped) { this.prime(c, !this.primed); this.primed = true; return; }
    this._c = c;
    // forget sightings older than their novelty horizon (800 s, 300 s): keys are per region, so these grew all dive long
    if (this.clock > (this._pruneT ?? 0)) {
      this._pruneT = this.clock + 300;
      for (const [k, t] of this.seen) if (this.clock - t > 800) this.seen.delete(k);
      if (this.closeSeen) for (const [k, t] of this.closeSeen) if (this.clock - t > 300) this.closeSeen.delete(k);
    }
    this.delightTick(c);
    if (this.whaleTick(c) || this.holeTick(c)) return;
    this.closeTick(c);
    if (this.poiTick(c)) return;
    // Coverage control: keep enough groups that are (or will soon be) readable inside the forward view.
    if (this.ensureTick(c)) return;
    const cov = this.coverage(c), want = this.coverWant(c);
    // keep a pipeline of lead groups: one swimming ahead of the camera, the next one closing in
    let leads = 0;
    for (const e of sys.enc) if (!e.done && e.route === 'lead' && e.leadT > 4 && -(e.anchorZ + e.bounds.z) - c.s > -2) leads++;
    this.wantLead = leads < 1 && this.clock - (this.leadFail || -99) > 3;
    const urgent = cov < want || this.wantLead;
    if (urgent) { if (this.clock - this.lastSpawn < 0.35 / Math.max(1, c.speed / 4)) return; }
    else if (this.timer > 0) return;
    this.timer = (0.6 + this.rng() * 0.7) / Math.max(1, c.speed / 4);
    if (!urgent && sys.enc.length >= Math.min(this.target(c), sys.maxEnc)) return;
    if (sys.enc.length >= sys.maxEnc) { // make room: retire the least useful group that is out of view
      let worst = null, ws = -1;
      for (const e of sys.enc) {
        if (e.visible || e.done) continue;
        const ahead = -(e.anchorZ + e.bounds.z) - c.s;
        const score = ahead < 0 ? 1e4 - ahead : Math.abs(e.bounds.x - c.x) / (e.readLat + 1);
        if (score > ws) { ws = score; worst = e; }
      }
      if (!worst) return;
      worst.done = true;
    }
    const lead = this.wantLead;
    const e = this.spawnOne(c, urgent, true, false, lead);
    if (e) this.lastSpawn = this.clock;
    else if (lead) this.leadFail = this.clock; // no lead-capable species here right now
  }

  // ---------- set pieces at points of interest registered by props ----------
  poiTick(c) {
    const sys = this.sys, env = sys.env;
    if (!env || !env.pois) return false;
    this.poiT = (this.poiT || 0) - 1;
    if (this.poiT > 0) return false;
    this.poiT = 20;
    if (!this.poiDone) this.poiDone = new Map();
    for (const [k, ps] of this.poiDone) if (ps < c.s - 80) this.poiDone.delete(k);
    const list = env.pois.query(c.s + 20, c.s + Math.min(sys.fogD, 120) + 10, this._pois || (this._pois = []));
    for (const p of list) {
      const key = p.type + ':' + Math.round(p.x) + ':' + Math.round(p.s);
      if (this.poiDone.has(key)) continue;
      this.poiDone.set(key, p.s);
      if (sys.enc.length > sys.maxEnc - 4) continue;
      const cd = this.poiCool || (this.poiCool = {}); // the same kind of set piece at most every ~35 s
      if ((cd[p.type] ?? -1e9) > this.clock - (p.type === 'brine-pool' || p.type === 'ledge' ? 45 : p.type === 'anemone' ? 5 : 25)) continue;
      if (this.setPiece(p, c)) { cd[p.type] = this.clock; return true; } // at most one set piece per tick
    }
    return false;
  }
  spawnAt(key, p, over = {}) {
    const sys = this.sys, sp = this.species(key);
    if (!sp || sys.enc.length >= sys.maxEnc - 1) return null;
    const plan = this.plan(sp, this._c, true, sys.seq.weights(p.s), sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
    if (!plan) return null;
    plan.s0 = p.s; plan.l0 = p.x - sys.shape.pathX(p.s); plan.noSeek = true; plan.fadeIn = true; plan.poi = p;
    Object.assign(plan, over);
    if (plan.n > sys.maxInstances - sys.instances) return null;
    const e = sys.spawn(sp, plan);
    if (e) { this.seen.set(sp.key, this.clock); this.hitchhikers(e); }
    return e;
  }
  setPiece(p, c) {
    const r = this.rng, sh = this.sys.shape, wb = this.sys.seq.weights(p.s)[0].key;
    const rr = (a, b) => a + (b - a) * r();
    switch (p.type) {
      case 'cleaning-station': { // mantas circling slowly overhead while cleaner wrasse work the coral head
        const nM = r() < 0.6 ? 1 : 2;
        for (let k = 0; k < nM; k++) {
          const rad = rr(5, 8), y = Math.max(p.y + 1.5 + k * 1.5, sh.pathY(p.s) + 2.2);
          this.spawnAt('manta', p, { route: 'circle', kind: 'solo', zone: 'mid', n: 1, interest: 0.8,
            orbit: { x: p.x, s: p.s, y, r: rad, w: rr(0.9, 1.2) / rad * (k ? -1 : 1), a0: r() * TAU, T: rr(60, 100) } });
        }
        this.spawnAt('cleanerWrasse', p, { kind: 'hover', homeY: p.y - 2.7, n: 3 + Math.floor(r() * 3) });
        return true;
      }
      case 'whale-fall': // hagfish knotting over the carcass, grenadiers and crabs around it
        this.spawnAt('hagfish', p, { kind: 'hover', homeY: p.y + 0.2, n: 14 + Math.floor(r() * 18), noSeek: true });
        this.spawnAt('rattail', p, { kind: 'hover', n: 2 + Math.floor(r() * 3) });
        this.spawnAt('deepCrab', p, { ring: Math.max(1.5, (p.r || 3) * 0.6), n: 3 + Math.floor(r() * 4) });
        if (r() < 0.3) this.spawnAt('sleeperShark', p, { route: 'crossNear' });
        return true;
      case 'brine-pool': // eels and crabs around the shore of the brine lake
        this.spawnAt('eelpout', p, { kind: 'hover', ring: (p.r || 6) * 0.95, n: 4 + Math.floor(r() * 5) });
        this.spawnAt('deepCrab', p, { ring: (p.r || 6), n: 3 + Math.floor(r() * 4) });
        return true;
      case 'ledge': // a turtle (or a nurse shark) resting on the ledge
        if (r() < 0.75) return !!this.spawnAt(wb === 'wall' || wb === 'softcoral' ? 'hawksbill' : 'turtleRest', p, { restY: p.y, n: 1 });
        return !!this.spawnAt('nurseShark', p, { restY: p.y, n: 1 });
      case 'wall-overhang':
        this.spawnAt('sweetlips', p, { kind: 'shoal', homeY: p.y - 1.4, n: 5 + Math.floor(r() * 8) });
        return true;
      case 'amphora-den': // an octopus peeking out of an amphora
        return !!this.spawnAt('octopus', p, { den: true, restY: p.y, n: 1 });
      case 'wreck': { // a glassfish cloud inside, resident groupers, batfish hanging off the hull
        this.spawnAt('glassfish', p, { kind: 'shoal', homeY: p.y, n: this.cloud(120 + Math.floor(r() * 100)) });
        if (r() < 0.7) this.spawnAt(r() < 0.5 ? 'goliath' : 'potatoGrouper', p, { kind: 'hover', homeY: p.y - 1, n: 1 + Math.floor(r() * 2) });
        if (r() < 0.6) this.spawnAt('batfish', p, { route: 'hold', vs: 0 });
        return true;
      }
      case 'kelp-clearing': // sea lions playing: looping and corkscrewing around the clearing
        return !!this.spawnAt('seaLion', p, { kind: 'pod', route: 'circle', zone: 'mid', n: 2 + Math.floor(r() * 3), spacing: 0.5,
          orbit: { x: p.x, s: p.s, y: Math.min(p.y, -2), r: Math.max(rr(4, 6), this.extentAt(p, 6) + 2), w: rr(0.35, 0.5), a0: r() * TAU, T: rr(40, 60) } });
      case 'iceberg': { // penguins (south) or belugas (north) circling the berg, clear of its underwater bulk
        const south = this.hemi(this.region(p.s)) === 'S';
        return !!this.spawnAt(south ? (r() < 0.6 ? 'adeliePenguin' : 'emperorPenguin') : 'beluga', p, { kind: 'pod', route: 'circle', zone: 'mid',
          orbit: { x: p.x, s: p.s, y: -2.5, r: this.extentAt(p) + rr(3, 6), w: rr(0.25, 0.4), a0: r() * TAU, T: rr(40, 70) } });
      }
      case 'garden-eel-field':
        return !!this.spawnAt(r() < 0.7 ? 'gardenEel' : 'splendidEel', p, { kind: 'colony' });
      case 'cave-opening':
        return !!this.spawnAt(r() < 0.5 ? 'glassfish' : 'sweeper', p, { kind: 'shoal', homeY: p.y, n: this.cloud(80 + Math.floor(r() * 120)) });
      case 'vent-field':
        this.spawnAt('eelpout', p, { kind: 'hover', n: 4 + Math.floor(r() * 6) });
        this.spawnAt('deepCrab', p, { n: 3 + Math.floor(r() * 5) });
        return true;
      case 'mangrove-roots':
        this.spawnAt(r() < 0.5 ? 'juvSnapper' : 'grunt', p, { route: 'hold', vs: 0, zone: 'floor' });
        if (r() < 0.4) this.spawnAt('juvBarracuda', p, { route: 'hold', vs: 0 });
        return true;
      case 'statue': case 'giant': case 'arch': // a school milling around the landmark
        if (r() < 0.55) return !!this.spawnAt(r() < 0.6 ? 'jack' : 'snapper', p, { kind: 'mill', route: 'hold', vs: 0, zone: 'mid', h0: p.y - sh.pathY(p.s), ringMin: this.extentAt(p, 14) + 1.2 });
        return false;
      case 'treasure':
        return !!this.spawnAt(r() < 0.5 ? 'moray' : 'spotMoray', p, { kind: 'peek' });
      case 'anemone': { // a clownfish family nestled in its anemone; cleaner shrimp and damsels sharing it
        const rad = clamp(p.r || 0.6, 0.25, 1.4), want = p.data && p.data.clown;
        const key = CLOWNS.includes(want) ? want : CLOWNS[Math.floor(r() * (wb === 'anemone' ? CLOWNS.length : 3))];
        const fam = this.spawnAt(key, p, { kind: 'hover', homeY: p.y + 0.1, n: 2 + Math.floor(r() * 4), spread: rad * 0.7, altMul: 0.3, noSeek: true });
        if (r() < 0.45) this.spawnAt('cleanerShrimp', p, { ring: rad * 0.95, n: 2 + Math.floor(r() * 3) });
        if (r() < 0.3) this.spawnAt(r() < 0.6 ? 'dominoDamsel' : 'humbug', p, { kind: 'hover', homeY: p.y + 0.25, n: 3 + Math.floor(r() * 6), spread: rad * 1.3 + 0.3, altMul: 0.5, noSeek: true });
        return !!fam;
      }
      default: return false;
    }
  }

  // Size of a set piece's fish cloud (wreck / cave glassfish: 80-220 at full size) for the quality tier: these are
  // the largest groups in the game and every wreck has one, so low tier keeps them at about a third.
  cloud(n) { const k = this.sys.tierScale; return Math.max(24, Math.round(n * (k < 0.7 ? 0.35 : k < 1 ? 0.6 : k > 1 ? 1 : 0.85))); }

  // Horizontal reach of the obstacles making up a set piece (e.g. an iceberg's underwater bulk) around its POI.
  extentAt(p, maxR = 40) {
    const reg = this.sys.env && this.sys.env.obstacles;
    let ext = p.r || 6;
    if (!reg || !reg.count) return ext;
    const q = reg.query(p.x, p.s, Math.min(maxR, (p.r || 6) * 2 + 10), this._qe || (this._qe = []));
    for (const o of q) {
      const da = Math.hypot(o.ax - p.x, o.as - p.s), db = Math.hypot(o.bx - p.x, o.bs - p.s);
      if (Math.min(da, db) - o.r > (p.r || 6) * 1.5 + 4) continue; // something else nearby
      ext = Math.max(ext, da + o.r, db + o.r);
    }
    return Math.min(ext, maxR);
  }

  // Remoras riding sharks, mantas, whale sharks and turtles; a sea otter's pup on her chest; young golden trevally and
  // cobia keeping station on a feeding whale shark or manta; female narwhals travelling with the tusked males.
  hitchhikers(enc) {
    this.escorts(enc);
    const sys = this.sys, pr = REMORA_HOSTS[enc.sp.key];
    if (!pr || enc.kind === 'rest' || enc.n > 6 || this.rng() > pr) return;
    const sp = this.species('remora');
    const n = Math.min(enc.n * 2, 1 + Math.floor(this.rng() * 3));
    if (!sp || sys.instances + n > sys.maxInstances || sys.enc.length >= sys.maxEnc) return;
    sys.spawn(sp, { n, kind: 'attach', host: enc, seed: (this.rng() * 4294967296) >>> 0, variant: (this.rng() * 4294967296) >>> 0,
      s0: -(enc.anchorZ + enc.bounds.z), l0: 0, fadeIn: false });
  }

  escorts(enc) {
    const sys = this.sys, r = this.rng, key = enc.sp.key;
    if (enc.done || sys.enc.length >= sys.maxEnc - 1) return;
    const ride = (k, n, extra) => {
      const sp = this.species(k);
      if (!sp || sys.instances + n > sys.maxInstances) return null;
      return sys.spawn(sp, { n, seed: (r() * 4294967296) >>> 0, variant: (r() * 4294967296) >>> 0, s0: -(enc.anchorZ + enc.bounds.z), l0: 0, fadeIn: enc.plan.fadeIn, ...extra });
    };
    if (enc.sp.beh.pup) { const e = ride('seaOtterPup', enc.n, { kind: 'attach', host: enc }); if (e) e.fade = enc.fade; return; }
    const shadow = (k, n, kind, S) => { // starts right at its station (Encounter route 'shadow'), not inside the host
      const L = enc.SZ[0], fx = enc.F[0], fy = enc.F[1], fz = enc.F[2], fl = Math.hypot(fx, fz) || 1;
      const tx = enc.P[0] + fx * L * S.ahead + (fz / fl) * L * S.side, ty = enc.P[1] + fy * L * S.ahead + L * S.below, tz = enc.P[2] + fz * L * S.ahead - (fx / fl) * L * S.side;
      const s0 = -(enc.anchorZ + tz), l0 = tx - sys.shape.pathX(s0), h0 = ty - sys.shape.pathY(s0);
      const e = ride(k, n, { kind, host: enc, route: 'shadow', shadow: S, zone: 'mid', s0, l0, h0, latMax: 200, interest: 0.5 });
      if (e && enc.fade >= 1) e.fade = 1;
    };
    if (key === 'whaleSharkFeed') {
      if (r() < 0.6) shadow('goldenTrevally', 4 + Math.floor(r() * 6), 'school', { j: 0, ahead: 0.62, below: -0.02, side: 0 });
      if (r() < 0.35) shadow('cobia', 1 + Math.floor(r() * 2), 'pod', { j: 0, ahead: -0.05, below: -0.17, side: r() < 0.5 ? -0.12 : 0.12 });
    } else if (key === 'mantaFeed' && r() < 0.3) shadow('cobia', 1, 'pod', { j: 0, ahead: -0.2, below: -0.45, side: 0 });
    else if (key === 'narwhal' && enc.kind === 'pod' && r() < 0.8) { // a mixed pod: tusked males with the females
      const sp = this.species('narwhalF'), n = Math.min(2 + Math.floor(r() * 5), sys.maxInstances - sys.instances);
      if (sp && n > 0) sys.spawn(sp, { ...enc.plan, n, seed: (r() * 4294967296) >>> 0, mixOf: enc, fadeIn: true });
    }
  }

  // ---------- moments of delight ----------
  delightTick(c) {
    this.dlT = (this.dlT || 0) - 1;
    if (this.dlT > 0) return;
    this.dlT = 30;
    const sys = this.sys, r = this.rng, now = this.clock, cool = this.dcool || (this.dcool = {});
    const ready = (k, cd) => (cool[k] ?? -1e9) + cd < now;
    const biome = sys.seq.weights(c.s + 40)[0].key;
    for (const e of sys.enc) {
      if (e.done || e.event || e.fade < 0.9) continue;
      const key = e.sp.key, ahead = -(e.anchorZ + e.bounds.z) - c.s, flock = e.kind === 'solo' || e.kind === 'pod';
      if (e.plan.calf && e.calfT === undefined && e.visible && e.dist < 50) e.calfT = 0; // the calf loops around its mother
      if (!e.visible) continue;
      if (CURIOUS.has(key) && flock && e.n <= 2 && ahead > 10 && ahead < 40 && ready('curious', 110) && r() < 0.4) { // a curious look
        e.route = 'curious'; e.zone = 'mid'; e.event = { type: 'curious', t: 0, ph: 0, side: r() < 0.5 ? -1 : 1 };
        cool.curious = now; continue;
      }
      if (PLAY.has(key) && e.kind === 'pod' && e.dist < 45 && ahead > -5 && ready('play', 140) && r() < 0.5) { // play around the camera
        e.route = 'play'; e.zone = 'mid';
        e.event = { type: 'play', t: 0, dur: 12 + r() * 6, w: 0.5 + r() * 0.15, ring: key === 'bottlenose' || key === 'commonDolphin' ? 1.5 : 1e9 };
        cool.play = now; continue;
      }
      if ((key === 'mantaFeed' || (key === 'manta' && biome === 'whaleshark')) && e.dist < 45 && ready('flip', 14) && r() < 0.6 && e.startFlip(r)) { cool.flip = now; continue; } // feeding somersaults
      if (key === 'manta' && e.dist < 32 && ready('roll', 35) && r() < 0.35) { e.event = { type: 'roll', t: 0, dur: 3.2 }; cool.roll = now; continue; }
      if (e.kind === 'bait' && !e.hunted && e.dist < 40 && ahead > -5 && ready('strike', 80)) { // hunters strike the bait ball
        e.hunted = true; cool.strike = now;
        const opts = HUNTERS[biome] || HUNTERS.reef;
        const sp = this.species(opts[Math.floor(r() * opts.length)]);
        const plan = sp && this.plan(sp, c, true, sys.seq.weights(c.s + 40), sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
        if (!plan) continue;
        const ps = -(e.anchorZ + e.Cz);
        plan.s0 = ps + 8; plan.l0 = e.Cx - sys.shape.pathX(ps) + (r() < 0.5 ? -6 : 6); plan.route = 'strike'; plan.zone = 'mid';
        plan.n = Math.max(1, Math.min(plan.n, sp.beh.n[1] > 20 ? 14 : 6)); plan.fadeIn = true;
        const h = sys.spawn(sp, plan);
        if (h) { h.event = { type: 'strike', prey: e, t: 0, dur: 22 + r() * 10, a: r() * TAU, w: 0.28 * (r() < 0.5 ? 1 : -1) }; h.route = 'strike'; }
      }
    }
    // rare: humpbacks bubble-net feeding just ahead (rising ring of bubbles, whales lunging up through it)
    if ((biome === 'pelagic' || biome === 'kelp' || (biome === 'polar' && this.hemi(this.region(c.s)) === 'S')) && ready('net', 360) && r() < 0.04 && sys.fx) {
      const sp = this.species('humpback');
      const plan = sp && this.plan(sp, c, true, sys.seq.weights(c.s + 60), sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
      if (plan) {
        const sh = sys.shape, s0 = c.s + 60, x0 = sh.pathX(s0) + (r() < 0.5 ? -1 : 1) * (4 + r() * 6);
        const y0 = Math.max(sh.floorAt(x0, s0) + 9, sh.pathY(s0) - 16);
        if (sh.ceilingAt(x0, s0) < -0.5) { cool.net = now; return; } // only in open water (not under the ice)
        Object.assign(plan, { n: 2 + Math.floor(r() * 2), kind: 'pod', spacing: 0.35, route: 'lunge', zone: 'mid', s0, l0: x0 - sh.pathX(s0), h0: y0 - sh.pathY(s0), fadeIn: true, interest: 1 });
        if (plan.n <= sys.maxInstances - sys.instances) {
          const h = sys.spawn(sp, plan);
          if (h) {
            h.event = { type: 'lunge', t: 0, ph: 0, a: r() * TAU, wait: 7, o: { x: x0, s: s0, y0 } };
            sys.fx.bubbleNet(x0, y0 + 3, -s0, 7, 6.5);
            cool.net = now;
          }
        }
      }
    }
  }

  // Make room for a special spawn: retire the least useful group that is out of view.
  retireOne(c) {
    let worst = null, ws = -1;
    for (const e of this.sys.enc) {
      if (e.visible || e.done || e.route === 'majestic') continue;
      const ahead = -(e.anchorZ + e.bounds.z) - c.s;
      const score = ahead < 0 ? 1e4 - ahead : Math.abs(e.bounds.x - c.x) / (e.readLat + 1);
      if (score > ws) { ws = score; worst = e; }
    }
    if (worst) worst.done = true;
    return !!worst;
  }

  // A blue whale glides past (15-35 m away) about once every 40-55 minutes of open-water travel; the
  // first one comes 8-15 minutes into the journey. It swims slowly toward the camera or is slowly overtaken.
  whaleTick(c) {
    const sys = this.sys, r = this.rng;
    if (this.whaleDue === undefined) this.whaleDue = 480 + r() * 420;
    if (this.clock < this.whaleDue || this.clock - (this.whaleTry ?? -99) < 3) return false;
    this.whaleTry = this.clock;
    const ws = sys.seq.weights(c.s + 120), w0 = ws[0];
    if (!WHALE_ZONES.has(w0.key) || w0.w < 0.6 || sys.seq.weights(c.s)[0].key !== w0.key) return false;
    const sp = this.species('blueWhale');
    if (!sp) return false;
    if (sys.enc.length >= sys.maxEnc && !this.retireOne(c)) return false;
    const plan = this.plan(sp, c, true, ws, sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, false, false);
    if (!plan) return false;
    const sh = sys.shape, rr = (a, b) => a + (b - a) * r();
    // which side is open water? (the wall: away from the face)
    let side = r() < 0.5 ? -1 : 1;
    if (w0.key === 'wall') { const s1 = c.s + 100, px = sh.pathX(s1); side = sh.floorAt(px + 14, s1) > sh.floorAt(px - 14, s1) ? -1 : 1; }
    const oncoming = r() < 0.55;
    const s0 = c.s + (oncoming ? rr(130, 170) : rr(70, 100)), lat = rr(12, 24);
    for (let k = 0; k < 4; k++) {
      const sd = k & 1 ? -side : side, l = sd * (lat + (k >> 1) * 6), x = sh.pathX(s0) + l;
      const fl = sh.floorAt(x, s0), ce = Math.min(sh.ceilingAt(x, s0), 0), py = sh.pathY(s0);
      const y = clamp(py + rr(-7, -1), fl + 6, ce - 4);
      if (ce - fl < 11 || y < fl + 5) continue;
      Object.assign(plan, { n: 1, kind: 'solo', route: 'majestic', zone: 'mid', s0, l0: l, h0: y - py, vs: oncoming ? -rr(1.2, 1.7) : rr(1.1, 1.6), vl: 0,
        latMax: 70, fadeIn: true, interest: 1, wobble: 1.5 });
      const e = sys.spawn(sp, plan);
      if (!e) return false;
      this.seen.set(sp.key, this.clock); this.lastSpawn = this.clock;
      this.whaleDue = this.clock + 2400 + r() * 900;
      this.whaleCount = (this.whaleCount || 0) + 1;
      if (sys.env && typeof sys.env.note === 'function') sys.env.note('A blue whale is passing');
      return true;
    }
    return false;
  }

  // Blue hole: reef sharks circle slowly down inside the sinkhole, a big school mills at its rim and
  // a grouper hangs by the wall, set up once per hole as the camera approaches it.
  holeTick(c) {
    this.holeT = (this.holeT || 0) - 1;
    if (this.holeT > 0) return false;
    this.holeT = 30;
    const sys = this.sys, seq = sys.seq, g = seq.segs[seq.segAt(c.s + 140)];
    if (!g || g.key !== 'bluehole') return false;
    const H = blueHoleOf(g);
    if (!H || this.holeDone === g.seed || H.s - c.s > 180 || H.s - c.s < 25) return false;
    this.holeDone = g.seed;
    const r = this.rng, sh = sys.shape, rr = (a, b) => a + (b - a) * r();
    while (sys.enc.length > sys.maxEnc - 4 && this.retireOne(c));
    const py = sh.pathY(H.s), rad = H.R * rr(0.42, 0.55), y = py - rr(5, 11);
    const p = { type: 'bluehole', x: H.x, y, s: H.s, r: H.R };
    this.spawnAt(r() < 0.8 ? 'reefShark' : 'blacktip', p, { kind: 'pod', route: 'circle', zone: 'mid', n: 2 + Math.floor(r() * 3), spacing: 1.3, interest: 0.85,
      orbit: { x: H.x, s: H.s, y, r: rad, w: rr(0.8, 1.15) / rad * (r() < 0.5 ? -1 : 1), a0: r() * TAU, T: 150 } });
    // the rim school mills over the open hole, not half inside the wall: its centre steps in from the rim until the
    // floor a ring radius (~7 m) further out is below the bottom of its column (~8 m under its centre)
    const a = r() * TAU, ry = py + rr(-2, 0);
    let d = H.R * 0.85;
    for (let k = 0; k < 16 && d > H.R * 0.4 && sh.floorAt(H.x + Math.cos(a) * (d + 7), H.s + Math.sin(a) * (d + 7)) > ry - 8; k++) d -= 1.5;
    const rim = { type: 'bluehole', x: H.x + Math.cos(a) * d, y: ry, s: H.s + Math.sin(a) * d, r: 6 };
    this.spawnAt(r() < 0.55 ? 'jack' : r() < 0.5 ? 'barracuda' : 'fusilier', rim, { kind: r() < 0.6 ? 'mill' : 'school', route: 'hold', vs: 0, zone: 'mid', h0: rim.y - sh.pathY(rim.s) });
    if (r() < 0.7) {
      const b = a + Math.PI * (0.6 + 0.8 * r()), gp = { type: 'bluehole', x: H.x + Math.cos(b) * H.R * 0.8, y: py - rr(1, 4), s: H.s + Math.sin(b) * H.R * 0.8, r: 4 };
      this.spawnAt(r() < 0.5 ? 'potatoGrouper' : 'goliath', gp, { kind: 'solo', route: 'hold', vs: 0, zone: 'mid', h0: gp.y - sh.pathY(gp.s) });
    }
    return true;
  }

  // Close encounters: every 9-19 s one animal or small group (rotating through species) comes to have a
  // look, gliding past the camera 2.5-4 m away. Swimmers get a 'curious' pass; reef fish around the
  // bottom send one individual up to inspect the camera as it passes.
  closeTick(c) {
    const sys = this.sys, r = this.rng;
    if (!this.closeSeen) { this.closeSeen = new Map(); this.closeNext = 6 + r() * 6; }
    if (this.clock < this.closeNext) return;
    let best = null, bs = 0, insp = false;
    for (const e of sys.enc) {
      if (e.done || e.fade < 0.9 || !e.visible || e.event || e.kind === 'attach') continue;
      const ahead = -(e.anchorZ + e.bounds.z) - c.s, sz = e.baseSize;
      if (sz < 0.07 || sz > 5) continue;
      let ok = false, isp = false;
      if ((e.kind === 'solo' || e.kind === 'pod' || (e.kind === 'school' && e.n <= 14)) && !CLOSE_SKIP.has(e.route) && ahead > 12 && ahead < 45) ok = true;
      else if ((e.kind === 'shoal' || (e.kind === 'hover' && (e.sp.beh.speed?.[1] ?? 0) >= 0.15)) && e.inspect < 0 && ahead > 8 && ahead < 32) { ok = true; isp = true; }
      if (!ok) continue;
      const nov = 1 + Math.min(3, (this.clock - (this.closeSeen.get(e.sp.key) ?? -1e4)) / 100);
      const score = nov * (0.4 + r()) * (isp ? 1 : 1.4);
      if (score > bs) { bs = score; best = e; insp = isp; }
    }
    this.closeNext = this.clock + (best ? 9 + r() * 10 : 2.5);
    if (!best) return;
    this.closeSeen.set(best.sp.key, this.clock);
    this.closeCount = (this.closeCount || 0) + 1;
    if (insp) { best.startInspect(c); return; }
    const side = best.ll !== 0 ? Math.sign(best.ll) : r() < 0.5 ? -1 : 1;
    best.route = 'curious'; best.zone = 'mid';
    best.event = { type: 'curious', t: 0, ph: 0, side, lat: 2.5 + r() * 1.3 };
  }

  // Next species likely to be spawned soon whose geometry is not cached yet (or null).
  nextPrewarm(c) {
    const sys = this.sys;
    if (!this._pw || this.clock - this._pwT > 20) { this._pw = new Set(); this._pwT = this.clock; }
    for (const ds of [sys.fogD, sys.fogD + 300]) {
      const s = c.s + ds, region = this.region(s);
      for (const e of sys.seq.weights(s)) {
        const T = TABLES[e.key]; if (!T) continue;
        const L = T.night && sys.U && sys.U.uNight.value > 0.3 ? T.list.concat(T.night) : T.list;
        for (const [key] of L) {
          const keys = key.startsWith('proc:') ? [0, 1, 2].map((k) => `${key}:${(region % 100000) * 16 + k}`) : [key];
          for (const k of keys) {
            if (this._pw.has(k)) continue;
            this._pw.add(k);
            const sp = this.species(k);
            if (sp && !sys.cache.map.has(sp.key)) return sp;
          }
        }
      }
    }
    // hitchhikers, hunters for bait balls, and the cast of set pieces coming up
    const extra = ['remora', 'seaOtterPup', 'goldenTrevally', 'cobia', 'narwhalF', ...(HUNTERS[sys.seq.weights(c.s + 60)[0].key] || [])];
    if (sys.env && sys.env.pois) for (const p of sys.env.pois.query(c.s + 20, c.s + 220, this._ppw || (this._ppw = []))) extra.push(...(POI_SPECIES[p.type] || []));
    for (const k of extra) {
      if (this._pw.has(k)) continue;
      this._pw.add(k);
      const sp = this.species(k);
      if (sp && !sys.cache.map.has(sp.key)) return sp;
    }
    return null;
  }

  // Signature animals that must reliably be present in a biome (e.g. penguins under Antarctic ice):
  // when none is active, spawn one right away, ignoring cooldowns.
  ensureTick(c) {
    const sys = this.sys;
    this.ensureT = (this.ensureT || 0) - 1;
    if (this.ensureT > 0) return false;
    this.ensureT = 20; // checked a few times per second at most
    const s = c.s + 40, w = sys.seq.weights(s)[0];
    const T = TABLES[w.key];
    if (!T || !T.ensure || w.w < 0.6) return false;
    const set = T.ensure[this.hemi(this.region(s))] || [];
    if (!set.length || sys.enc.some((e) => set.includes(e.sp.key) && !e.done && -(e.anchorZ + e.bounds.z) - c.s > -10)) return false;
    if (sys.enc.length >= sys.maxEnc) return false;
    const sp = this.species(set[Math.floor(this.rng() * set.length)]);
    const plan = sp && this.plan(sp, c, true, sys.seq.weights(c.s + 50), sys.maxInstances - sys.instances, sys.maxTris - sys.trisTotal, !this.primedEnsure, false);
    this.primedEnsure = true;
    if (!plan) return false;
    const e = sys.spawn(sp, plan);
    if (e) { this.seen.set(sp.key, this.clock); this.lastSpawn = this.clock; this.hitchhikers(e); return true; }
    return false;
  }

  coverWant(c) {
    let t = 0;
    for (const e of this.sys.seq.weights(c.s + 60)) t += (TABLES[e.key]?.cover ?? 3) * e.w;
    return t * this.density() * 1.35; // more groups readable in (or about to enter) the view
  }
  // more life in view: group targets scale with the tier's budget (low 1.05x, medium 1.15x, high 1.25x, ultra 1.4x)
  density() { const k = this.sys.tierScale; return k < 0.7 ? 1.05 : k < 1 ? 1.15 : k > 1 ? 1.4 : 1.25; }

  // Groups that are readable in view now, or are lined up to pass through the forward view cone.
  coverage(c) {
    const fogD = this.sys.fogD;
    let n = 0;
    for (const e of this.sys.enc) {
      if (e.done) continue;
      const b = e.bounds, ahead = -(e.anchorZ + b.z) - c.s, lat = Math.abs(b.x - c.x);
      if (e.visible && e.dist < Math.min(fogD * 0.6, e.readDist)) { n++; continue; }
      if ((e.route === 'lead' || e.route === 'swirl') && e.leadT > 0 && ahead > -3) { n++; continue; }
      if (e.readDist >= 6 && ahead > 0 && ahead < e.readDist + 25 && lat < e.readDist * 0.5 + 2) { n++; continue; }
      if ((e.route === 'overtake' || e.route === 'escort') && ahead > -60 && ahead < 6) n++;
    }
    return n;
  }

  target(c) {
    let t = 0;
    for (const e of this.sys.seq.weights(c.s + 110)) t += (TABLES[e.key]?.target ?? 8) * e.w;
    return Math.min(this.sys.maxEnc - 3, Math.round(t * this.density()));
  }

  prime(c, first) {
    const t = this.target(c);
    for (let k = 0; k < t + 2 && this.sys.enc.length < this.sys.maxEnc; k++) {
      const e = this.spawnOne(c, true, true, true);
      if (e && first) { e.fade = 1; e.plan.fadeIn = false; } // the loader covers the very first frames
    }
  }

  // Polar segments: ~75% Antarctic (penguins, leopard seals, krill), ~25% Arctic (belugas, narwhals).
  hemi(region) { return hash2i(region, 7, 3) < 0.25 ? 'N' : 'S'; }

  // Region seed for procedural species / colour variants (stable within a biome segment).
  region(s) {
    const seq = this.sys.seq, g = seq.segs[seq.segAt(s)];
    return g ? g.seed >>> 0 : 1;
  }

  spawnOne(c, near, allowHl, prime = false, lead = false) {
    const sys = this.sys, rng = this.rng;
    const sProbe = c.s + (near ? 50 : sys.fogD);
    const ws = sys.seq.weights(sProbe);
    const region = this.region(sProbe);
    const hemi = this.hemi(region);
    const cands = []; let tot = 0;
    const activeCount = new Map();
    for (const e of sys.enc) activeCount.set(e.sp.key, (activeCount.get(e.sp.key) || 0) + 1);
    const instBudget = sys.maxInstances - sys.instances;
    const triBudget = sys.maxTris - sys.trisTotal;
    const addCand = (key, w, cd, bw, small) => {
      let k = key;
      if (key.startsWith('proc:')) k = `${key}:${(region % 100000) * 16 + Math.floor(rng() * 12)}`;
      if (this.forced) k = this.forced;
      const sp = this.species(k); if (!sp) return;
      const ck = key.startsWith('proc:') ? key : sp.key;
      const cooling = (this.cool.get(ck) ?? -1) > this.clock && !this.forced;
      if (cooling && !lead) return; // lead requests may reuse a cooling species (at lower weight) to keep the view alive
      if (sp.hemi && sp.hemi !== hemi && ws.some((x) => x.key === 'polar')) return;
      if (sp.hl && (!allowHl || this.hlTimer > 0) && !this.forced) return;
      if ((activeCount.get(sp.key) || 0) >= (sp.swarm ?? (sp.beh.kind === 'shoal' || key.startsWith('proc:') || small ? 2 : 1)) && !this.forced) return;
      const nMin = sp.beh.n[0];
      if (nMin > instBudget) return;
      const novelty = 1 + Math.min(2, (this.clock - (this.seen.get(ck) ?? -1e4)) / 400);
      const rd = (sp.size[0] + sp.size[1]) * 0.5 * (sp.beh.n[1] >= 20 ? 75 : 24) * (sp.plan === 'jelly' ? 0.6 : sp.plan === 'siphon' ? 0.12 : 1);
      if (lead && (rd < 7 || sp.beh.loose || ['shoal', 'hover', 'drift', 'colony', 'peek', 'octo', 'mill', 'rest', 'otter'].includes(sp.beh.kind) && !(sp.beh.kind === 'shoal' && rd >= 7))) return;
      const ww = w * bw * novelty * (near ? (rd >= 8 ? 3 : 0.4) : 1) * (cooling ? 0.3 : 1);
      cands.push({ sp, ck, ww, cd }); tot += ww;
    };
    const night = sys.U ? sys.U.uNight.value : 0, dusk = clamp(1 - Math.abs(night * 2 - 1) * 1.4, 0, 1);
    let deepW = 0; for (const e of ws) if (DEEP_ZONES.has(e.key)) deepW += e.w;
    for (const e of ws) {
      const T = TABLES[e.key]; if (!T) continue;
      if (deepW >= 0.5 && !DEEP_ZONES.has(e.key)) continue; // no reef / coastal fish over the abyss once it dominates the blend
      for (const [k, w, cd] of T.list) { const wd = w * dielW(k, night); if (wd > 0.01) addCand(k, wd, T.list.length < 10 ? cd * 0.5 : cd, e.w, T.list.length < 10); }
      if (night > 0.05 && T.night) for (const [k, w, cd] of T.night) addCand(k, w * night, cd, e.w, false);
      if (dusk > 0.05 && T.dusk) for (const [k, w, cd] of T.dusk) addCand(k, w * dusk, cd, e.w, false);
    }
    if (!cands.length) return null;
    let r = rng() * tot, pick = cands[0];
    for (const cd of cands) { r -= cd.ww; if (r <= 0) { pick = cd; break; } }
    const plan = this.plan(pick.sp, c, near, ws, instBudget, triBudget, prime, lead);
    if (!plan) return null;
    const enc = sys.spawn(pick.sp, plan);
    if (!enc) return null;
    this.mixWith(enc, pick.sp, plan, c, ws, region);
    this.hitchhikers(enc);
    // (the prime spawn fills the view with most of a table at once: shorter cooldowns, or small casts leave it empty after)
    this.cool.set(pick.ck, this.clock + pick.cd * (0.7 + 0.6 * rng()) * (prime ? 0.35 : 1));
    this.seen.set(pick.ck, this.clock);
    if (pick.sp.hl) this.hlTimer = 70 + rng() * 90;
    return enc;
  }

  // Mixed-species groups: companions share the primary group's path (schools) or patch (shoals),
  // e.g. jacks with rainbow runners, sardines with anchovies, reef shoals of 2-4 species.
  mixWith(enc, sp, plan, c, ws, region) {
    const sys = this.sys, rng = this.rng, kind = enc.kind;
    if (!['school', 'shoal', 'bait', 'mill'].includes(kind) || sp.beh.loose || plan.route === 'swirl' || sys.enc.length > sys.maxEnc - 4 || rng() > 0.45) return;
    const PAIR = { jack: ['rainbowRunner'], rainbowRunner: ['jack'], sardine: ['anchovy'], anchovy: ['sardine'], silverside: ['anchovy'],
      snapper: ['sweetlips', 'proc'], bluetang: ['yellowtang', 'proc'], yellowtang: ['bluetang'], chromis: ['anthias', 'proc'], anthias: ['chromis', 'proc'],
      sergeant: ['proc', 'chromis'], blacksmith: ['senorita'], senorita: ['blacksmith', 'proc'], goatfish: ['proc'], butterfly: ['proc', 'bluetang'] };
    let opts = PAIR[sp.key] || (sp.key.startsWith('proc:') ? ['proc', 'proc'] : null);
    if (!opts) return;
    const extra = 1 + Math.floor(rng() * Math.min(2, opts.length));
    for (let k = 0; k < extra; k++) {
      let key = opts[k % opts.length];
      if (key === 'proc') {
        const t = ws[0] ? ws[0].key : 'reef';
        if (!(TABLES[t]?.list || []).some((e) => e[0] === 'proc:' + t)) continue;
        key = `proc:${t}:${(region % 100000) * 16 + Math.floor(rng() * 12)}`;
      }
      const sp2 = this.species(key);
      if (!sp2 || sp2.key === sp.key) continue;
      const kind2 = sp2.beh.kind === 'shoal' && kind !== 'shoal' ? kind : sp2.beh.kind;
      if (!['school', 'shoal', 'bait', 'mill'].includes(kind2)) continue;
      const n2 = Math.max(1, Math.min(Math.round(plan.n * (0.2 + rng() * 0.6)), sys.maxInstances - sys.instances));
      const tris = sys.cache.map.get(sp2.key)?.tris ?? 1500;
      if (n2 * tris > sys.maxTris - sys.trisTotal) continue;
      const p2 = { ...plan, n: n2, seed: (rng() * 4294967296) >>> 0, variant: (plan.variant ^ (k + 1) * 2654435761) >>> 0, kind: kind === 'shoal' ? undefined : kind, evade: enc.evade, fadeIn: true,
        mixOf: enc }; // same formation: the companion's slots keep clear of the primary's (Encounter._init)
      if (kind === 'shoal') { // same patch: the companions' homes start at the primary's (structure-seeking) spot
        const s0 = -(enc.homeZ + enc.anchorZ); p2.s0 = s0; p2.l0 = enc.homeX - sys.shape.pathX(s0); p2.noSeek = true; p2.kind = 'shoal';
      }
      sys.spawn(sp2, p2);
    }
  }

  plan(sp, c, near, ws, instBudget, triBudget, prime, lead = false) {
    const sys = this.sys, sh = sys.shape, rng = this.rng, beh = sp.beh;
    let lat = 0; for (const e of ws) lat += (TABLES[e.key]?.lat ?? 40) * e.w;
    const fogD = sys.fogD;
    const rr = (a) => a[0] + (a[1] - a[0]) * rng();
    // spawn distance: fog edge normally; closer (with a dithered fade-in) when coverage is short; at the start of a
    // lamp-lit deep dive, inside the lamps' reach (nothing else is visible there)
    let deepW = 0; for (const e of ws) if (DEEP_ZONES.has(e.key)) deepW += e.w;
    const D = prime ? rr(deepW > 0.5 ? [5, 30] : [10, fogD * 0.75]) : near ? rr([fogD * 0.45, fogD * 0.7]) : fogD * rr([0.75, 0.95]);
    let n = Math.round(beh.n[0] + (beh.n[1] - beh.n[0]) * rng());
    // group sizes from singletons / stragglers to occasional huge aggregations
    if (beh.n[1] > 3 && beh.kind !== 'colony') {
      const r = rng();
      if (r < 0.1) n = Math.max(1, Math.round(n * (0.1 + rng() * 0.25)));
      else if (r > 0.93 && sp.size[1] < 2) n = Math.round(n * (1.5 + rng() * 0.7));
    }
    if (sys.tierScale !== 1 && n > 3) n = Math.round(n * sys.tierScale);
    n = Math.max(1, Math.min(n, instBudget, 400));
    const tris = sys.cache.map.get(sp.key)?.tris ?? 1500;
    while (n > 1 && n * tris > triBudget) n = Math.floor(n * 0.7);
    if (n * tris > triBudget && n === 1 && tris > triBudget) return null;
    const side = rng() < 0.5 ? -1 : 1;
    const plan = { n, formation: pickW(rng, { ellipsoid: 3, ball: 1, ribbon: 1.5, wall: 1, loose: 1.5, column: 0.5 }), mood: pickW(rng, { calm: 2, feeding: 1, alert: 1 }), wseed: (rng() * 4294967296) >>> 0, seed: (rng() * 4294967296) >>> 0, variant: (this.region(c.s + D) ^ hash2i(sp.key.length, 3, 9) * 1e9) >>> 0, fadeIn: near || prime, latMax: lat, s0: c.s + D, l0: 0 };
    const speed = beh.speed ? rr(beh.speed) : 0.5;
    const latLim = (x) => Math.max(-lat, Math.min(lat, x));
    // Readable lateral offset: when a group leaves the frame while being passed it should still project
    // to >= ~25 px at 720p (K ~ 600 px/rad): lateral <= size * 16; schools read at about size * 40.
    const sz = (sp.size[0] + sp.size[1]) * 0.5, big = sz > 4;
    const readLat = Math.min(lat, Math.max(1.5, sz * (n >= 20 ? 40 : 16)));
    plan.readLat = readLat;
    const altUp = () => (beh.alt ? beh.alt[0] + (beh.alt[1] - beh.alt[0]) * (0.4 + 0.6 * rng()) : 1.5); // bias toward eye level
    let kind = beh.kind;
    const night = sys.U ? sys.U.uNight.value : 0;
    if (night > 0.55 && dielW(sp.key, 1) < 0.5 && ['school', 'shoal', 'hover', 'solo'].includes(kind)) { // after dark: shelter near the bottom
      plan.sleepy = true; plan.altMul = 0.35;
      if (kind === 'school' || kind === 'solo') { kind = 'shoal'; plan.kind = 'shoal'; plan.zone = 'floor'; }
    }
    if (sp.key === 'humpback' && !lead && rng() < 0.35) { plan.calf = true; plan.n = n = 2; plan.kind = 'pod'; plan.spacing = 0.45; plan.interest = 1; }
    if (sp.key === 'spinyLobster' && rng() < 0.3) { plan.walk = 'queue'; plan.n = n = 5 + Math.floor(rng() * 8); } // migrating in single file
    if (kind === 'shoal' && !plan.sleepy && !beh.loose && sz * (n >= 20 ? 75 : 24) >= 7 && (lead || rng() < 0.55)) { kind = 'school'; plan.kind = 'school'; }
    const eye = () => rr([-1, 0.6]);        // camera height (relative to the path)
    if (kind === 'shoal' || kind === 'hover' || kind === 'colony' || kind === 'peek' || kind === 'octo' || kind === 'rest' || kind === 'walk' || kind === 'bed') {
      // bottom life right under / beside the path: reef fish picking at the bottom, rays on the sand, octopus
      plan.l0 = latLim(side * rr([0, kind === 'rest' && sz > 1.5 ? 5 : 3.5]));
      plan.h0 = eye();
      plan.alt = altUp();
    } else if (kind === 'otter') { // a raft at the surface near the route (beyond ~10 m it is lost in the mirror of the surface)
      plan.l0 = latLim(side * rr([1, 9])); plan.h0 = 0;
    } else if (kind === 'drift') {
      plan.l0 = latLim(side * rr([0, 6]));
      plan.h0 = rr([-2, 2]);
      if (beh.recycle && ws.some((x) => x.key === beh.recycle && x.w > 0.4)) { // a swarm that surrounds the camera (see Encounter._recycle)
        plan.recycle = beh.recycle; plan.s0 = c.s + rr([2, 16]); plan.l0 = rr([-5, 5]); plan.fadeIn = true;
      }
    } else {
      const readDist = sz * (n >= 20 ? 75 : 24);
      const routes = {};
      for (const k in (beh.routes || {})) routes[k] = beh.routes[k] * 0.5;
      if (big) { routes.lead = (routes.lead || 0) + 2; routes.cross = (routes.cross || 0) + 1; routes.oncoming = (routes.oncoming || 0) + 1; }
      else {
        routes.crossNear = (routes.crossNear || 0) + 2.5;
        if (sz < 3) routes.toward = (routes.toward || 0) + 2;
        if (readDist >= 7) routes.lead = (routes.lead || 0) + 2;
        if ((kind === 'school' || kind === 'bait' || kind === 'mill') && n >= 12 && sz <= 1.2) routes.swirl = (routes.swirl || 0) + 1.5;
        if (kind === 'school') routes.hold = (routes.hold || 0) + 1;
      }
      let route = kind === 'bait' ? (rng() < 0.6 ? 'lead' : 'swirl') : kind === 'mill' ? (rng() < 0.5 ? 'swirl' : 'hold') : lead && readDist >= 7 ? 'lead' : pickW(rng, routes);
      if ((route === 'overtake' || route === 'escort') && (beh.speed[1] * 1.7 < c.speed + 1 || near || prime)) route = 'lead';
      const fromFloor = beh.zone === 'floor';
      plan.route = route; plan.speed = speed; plan.alt = altUp(); plan.wobble = 0.6;
      let l = 0;
      if (route === 'lead') {
        const R = kind === 'bait' ? sz * 2.0 * Math.cbrt(n) * 0.75 : 0;
        const A = big ? rr([25, 40]) : kind === 'bait' ? R + rr([2.5, 4]) : Math.max(7, Math.min(28, readDist * rr([0.55, 0.8])));
        plan.leadA = A; plan.leadT = kind === 'bait' ? rr([8, 16]) : rr([12, 35]);
        const fromBehind = !prime && (beh.speed?.[1] ?? 0) * 1.5 > c.speed + 1 && rng() < 0.5;
        plan.s0 = fromBehind ? c.s - rr([15, 30]) : c.s + A + (prime ? rr([0, 10]) : rr([5, 15]));
        plan.fadeIn = !fromBehind;
        plan.vs = fromBehind ? c.speed + 1.5 : c.speed * 0.6;
        l = side * (kind === 'bait' ? rr([0, R * 0.5]) : big ? rr([A * 0.2, A * 0.45]) : rr([0, A * 0.3]));
        plan.h0 = big ? (beh.over ? rr(beh.over) : rr([-6, 0])) : eye();
        if (fromFloor) plan.zone = 'mid';
      } else if (route === 'crossNear' || route === 'cross') {
        // cross the path right in front of the camera, at eye level (big animals: further out)
        const vl = Math.max(0.5, speed * 0.95);
        const L = Math.min(lat, big ? 40 : Math.max(4, Math.min(vl * 7, 18)));
        const T = L / vl;
        const dC = big ? rr([25, 40]) : readDist < 10 ? rr([5, 12]) : rr([8, 30]);
        plan.s0 = c.s + c.speed * T + dC;
        l = -side * L; plan.vl = side * vl; plan.vs = speed * (rng() - 0.5) * 0.3;
        plan.h0 = big ? (beh.over ? rr(beh.over) : rr([-6, 0])) : eye();
        if (sp.mot.mode === 3 && sz >= 0.7) { plan.h0 = -2.5; plan.vh = 3 / T; } // turtles rising across the path
        if (fromFloor) plan.zone = 'mid';
        plan.fadeIn = plan.fadeIn || plan.s0 - c.s < fogD * 0.8;
      } else if (route === 'toward') {
        // swim straight at the camera and part / veer around it
        plan.vs = -speed; l = rr([-1.2, 1.2]); plan.h0 = eye();
        if (fromFloor) plan.zone = 'mid';
      } else if (route === 'swirl') {
        // wait on the path; the camera enters the school and it circles around the camera
        plan.kind = 'mill'; plan.leadT = rr([10, 20]);
        plan.s0 = c.s + rr([14, 26]); l = 0; plan.h0 = rr([-0.5, 0.3]); plan.zone = 'mid'; plan.vs = 0;
        plan.fadeIn = true;
      } else if (route === 'hold') {
        plan.vs = speed * (rng() - 0.5) * 0.6; l = rr([-1.5, 1.5]); plan.h0 = eye();
        if (fromFloor && rng() < 0.6) plan.zone = 'mid';
      } else if (route === 'pace') {
        plan.vs = Math.min(c.speed * rr([0.45, 0.8]), (beh.speed?.[1] ?? 1) * 1.8); l = side * rr([0, 4]); plan.h0 = eye();
      } else {
        const dist = beh.dist || [4, 20];
        l = side * (big ? rr([25, 45]) : rr([0, Math.min(dist[1], 8)]));
        plan.h0 = big ? (beh.over ? rr(beh.over) : rr([-8, 1])) : (beh.over ? rr(beh.over) : eye());
        if (route === 'oncoming') plan.vs = -speed;
        else if (route === 'along') plan.vs = speed;
        else if (route === 'overtake') { plan.s0 = c.s - 30 - rng() * 15; plan.vs = c.speed + 1.5 + rng() * 1.5; }
        else if (route === 'escort') { plan.s0 = c.s - 30 - rng() * 10; plan.vs = c.speed + 2; l = side * rr([4, 8]); }
      }
      plan.l0 = latLim(l);
      if (beh.zone === 'ceiling' && route !== 'hold' && rng() < 0.5) plan.zone = 'mid'; // penguins also swoop past at eye level
    }
    // ice dwellers (Arctic cod) shelter under the pack, not out in the open water of a lead: find ice overhead
    if (beh.zone === 'ceiling' && (kind === 'shoal' || kind === 'hover') && sh.hasCeiling(plan.s0)) {
      for (let k = 0; k < 10; k++) {
        const l = (k & 1 ? -side : side) * (4 + (k >> 1) * 4), x = sh.pathX(plan.s0) + l, ce = sh.ceilingAt(x, plan.s0);
        if (ce < -0.3 && ce - sh.floorAt(x, plan.s0) > 5 && Math.abs(l) <= lat) { plan.l0 = l; break; }
      }
    }
    // the wall: hammerheads out in the blue on the open side, anthias clouds hanging on the wall face
    const wallW = ws.find((x) => x.key === 'wall');
    if (wallW && wallW.w > 0.5) {
      const s0 = plan.s0, px = sh.pathX(s0), side = sh.floorAt(px + 14, s0) > sh.floorAt(px - 14, s0) ? 1 : -1;
      if (beh.open) { plan.l0 = -side * rr([18, 34]); plan.h0 = rr([-7, -1]); }
      if ((sp.key === 'anthias' || sp.key === 'purpleAnthias') && rng() < 0.7) { plan.face = side; plan.noSeek = true; plan.h0 = rr([-2, 2]); }
    }
    // seamount / blue hole: big pelagics patrol out in the blue, off the slope
    const openW = ws.find((x) => x.key === 'seamount' || x.key === 'bluehole');
    if (openW && openW.w > 0.5 && (beh.open || sp.key === 'silkyShark') && !lead) { plan.l0 = side * rr([16, 32]); plan.h0 = rr([-7, -1]); }
    // sargassum: weed dwellers cling to / shelter under the floating mats
    const sarg = ws.find((x) => x.key === 'sargassum');
    if (sarg && sarg.w > 0.5 && sp.mat && (kind === 'hover' || kind === 'shoal')) {
      let best = -1, bl = plan.l0, bs = plan.s0;
      for (let k = 0; k < 12; k++) {
        const l = latLim(side * rr([1, 12])), s = plan.s0 + rr([-15, 15]), cv = sargassumCover(sh.pathX(s) + l, s);
        if (cv > best) { best = cv; bl = l; bs = s; }
      }
      plan.l0 = bl; plan.s0 = bs; plan.homeY = rr([-1.4, -0.35]); plan.noSeek = true; plan.zone = 'mid';
    }
    // jellyfish lake: cardinalfish keep to the shady edges
    if (sp.edge && ws[0].key === 'jellylake') plan.l0 = latLim(side * rr(sp.edge));
    // validate water column at the spawn point; shrink lateral offset if needed
    const reg = sys.env && sys.env.obstacles;
    // floor dwellers find a free spot locally (beside / on top of rocks); only mid-water groups are checked here
    const local = ['shoal', 'hover', 'rest', 'octo', 'colony', 'peek', 'walk', 'bed', 'otter'].includes(plan.kind || beh.kind);
    const OFF = [[0, 0], [1.5, 0], [-1.5, 0], [0, 4], [3, 0], [-3, 0], [0, -4], [4.5, 3]];
    const l0 = plan.l0, s0 = plan.s0;
    for (let k = 0; k < OFF.length; k++) {
      plan.l0 = l0 + OFF[k][0]; plan.s0 = s0 + OFF[k][1];
      const x = sh.pathX(plan.s0) + plan.l0;
      const fl = sh.floorAt(x, plan.s0), ce = Math.min(sh.ceilingAt(x, plan.s0), -0.4);
      if (!(ce - fl > 1.2 + sp.size[1] * (sp.plan === 'jelly' ? 1 : 0.4))) continue;
      if (local || !reg || !reg.count) return plan;
      const y = Math.max(fl + 1, sh.pathY(plan.s0) + (plan.h0 || 0)), need = 0.6 + sp.size[1] * 0.4;
      let ok = true;
      for (const o of reg.query(x, plan.s0, need + 3, this._q || (this._q = []))) if (Obstacles.dist(o, x, y, plan.s0, null) < need) { ok = false; break; }
      if (ok) return plan;
    }
    return null;
  }
}
