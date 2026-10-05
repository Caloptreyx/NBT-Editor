export type BlockKind = 'air' | 'solid' | 'transparent' | 'cutout' | 'liquid' | 'plant';
export type Rgb = [number, number, number];
export interface BlockLook {
  color: Rgb; // dominant color as seen from above (used by top-down renders), 0..255
  kind: BlockKind;
  side?: Rgb; // side/bottom faces when they differ from the top (grass, logs, nylium)
  alpha?: number; // opacity for transparent/liquid blocks, 0..1
}

const AIR_NAMES = new Set(['air', 'cave_air', 'void_air', 'light', 'structure_void', 'barrier']);

const SOLID: Record<string, number> = {
  stone: 0x7d7d7d,
  granite: 0x956755,
  polished_granite: 0x9a6a59,
  diorite: 0xbcbcbc,
  polished_diorite: 0xc0c1c2,
  andesite: 0x888889,
  polished_andesite: 0x848685,
  cobblestone: 0x7f7f7f,
  mossy_cobblestone: 0x6e7a5e,
  smooth_stone: 0x9e9e9e,
  stone_bricks: 0x7a7a7a,
  mossy_stone_bricks: 0x737961,
  cracked_stone_bricks: 0x767676,
  chiseled_stone_bricks: 0x777777,
  bedrock: 0x555555,
  deepslate: 0x505053,
  cobbled_deepslate: 0x4d4d51,
  polished_deepslate: 0x48484a,
  deepslate_bricks: 0x464646,
  cracked_deepslate_bricks: 0x434343,
  deepslate_tiles: 0x363637,
  cracked_deepslate_tiles: 0x343434,
  chiseled_deepslate: 0x373737,
  reinforced_deepslate: 0x50534f,
  tuff: 0x6c6d67,
  polished_tuff: 0x626a63,
  tuff_bricks: 0x626660,
  chiseled_tuff: 0x5b5e57,
  chiseled_tuff_bricks: 0x6c6e66,
  calcite: 0xdfe0dd,
  dripstone_block: 0x866b5d,
  smooth_basalt: 0x48484e,
  basalt: 0x515156,
  polished_basalt: 0x636366,
  blackstone: 0x2a2328,
  polished_blackstone: 0x35303b,
  polished_blackstone_bricks: 0x302a31,
  cracked_polished_blackstone_bricks: 0x2c2629,
  chiseled_polished_blackstone: 0x35303b,
  gilded_blackstone: 0x382b26,
  obsidian: 0x0f0b19,
  crying_obsidian: 0x200a3c,
  dirt: 0x866043,
  coarse_dirt: 0x77553b,
  rooted_dirt: 0x90684d,
  podzol: 0x5c3f18,
  mycelium: 0x6f6265,
  grass_block: 0x6a9b3d,
  dirt_path: 0x947a41,
  farmland: 0x5a3a1e,
  mud: 0x3c393d,
  packed_mud: 0x8e6b50,
  mud_bricks: 0x89684f,
  clay: 0xa0a6b3,
  gravel: 0x837f7e,
  suspicious_gravel: 0x817c7b,
  sand: 0xdbcfa3,
  suspicious_sand: 0xd9cba0,
  red_sand: 0xbe6621,
  sandstone: 0xd8cb9b,
  cut_sandstone: 0xd9cd9f,
  chiseled_sandstone: 0xd8ca9b,
  smooth_sandstone: 0xe0d6aa,
  red_sandstone: 0xba631d,
  cut_red_sandstone: 0xbd651f,
  chiseled_red_sandstone: 0xb8611c,
  smooth_red_sandstone: 0xb5621f,
  snow_block: 0xf9fefe,
  snow: 0xf9fefe,
  powder_snow: 0xf8fdfd,
  packed_ice: 0x8db4fa,
  blue_ice: 0x74a8fd,
  moss_block: 0x596d2d,
  moss_carpet: 0x596d2d,
  pale_moss_block: 0x6b706a,
  pale_moss_carpet: 0x6b706a,
  netherrack: 0x622626,
  nether_bricks: 0x2c1519,
  red_nether_bricks: 0x450709,
  cracked_nether_bricks: 0x281417,
  chiseled_nether_bricks: 0x2f171b,
  nether_wart_block: 0x730303,
  warped_wart_block: 0x167879,
  crimson_nylium: 0x831f1f,
  warped_nylium: 0x2b7265,
  soul_sand: 0x513e32,
  soul_soil: 0x4c3a2e,
  glowstone: 0xab8654,
  shroomlight: 0xf19347,
  magma_block: 0x8e3f1f,
  ancient_debris: 0x5f4039,
  quartz_block: 0xece6df,
  smooth_quartz: 0xece6df,
  quartz_bricks: 0xeae5dd,
  quartz_pillar: 0xebe6e0,
  chiseled_quartz_block: 0xe7e2da,
  end_stone: 0xdbde9e,
  end_stone_bricks: 0xdae0a2,
  purpur_block: 0xa97ea9,
  purpur_pillar: 0xab81ab,
  end_portal_frame: 0x5b7861,
  end_portal: 0x0b0d16,
  end_gateway: 0x0b0d16,
  dragon_egg: 0x0c0910,
  chorus_flower: 0x977797,
  coal_ore: 0x6a6a6a,
  iron_ore: 0x88817b,
  copper_ore: 0x7c7d78,
  gold_ore: 0x918e78,
  redstone_ore: 0x8c6e6e,
  emerald_ore: 0x6c8873,
  lapis_ore: 0x6b7790,
  diamond_ore: 0x79918f,
  deepslate_coal_ore: 0x4a4a4c,
  deepslate_iron_ore: 0x6a6563,
  deepslate_copper_ore: 0x5c5d59,
  deepslate_gold_ore: 0x73694f,
  deepslate_redstone_ore: 0x68464a,
  deepslate_emerald_ore: 0x4e6858,
  deepslate_lapis_ore: 0x4f5b77,
  deepslate_diamond_ore: 0x536b6c,
  nether_quartz_ore: 0x75413e,
  nether_gold_ore: 0x73372b,
  coal_block: 0x101010,
  iron_block: 0xdcdcdc,
  gold_block: 0xf6d03d,
  diamond_block: 0x62ede4,
  emerald_block: 0x2acb57,
  lapis_block: 0x1f438c,
  redstone_block: 0xaf1805,
  netherite_block: 0x423d3f,
  copper_block: 0xc06c50,
  exposed_copper: 0xa17e68,
  weathered_copper: 0x6c996e,
  oxidized_copper: 0x52a284,
  cut_copper: 0xbf6b51,
  exposed_cut_copper: 0x9a7965,
  weathered_cut_copper: 0x6d9165,
  oxidized_cut_copper: 0x4f9a7f,
  raw_iron_block: 0xa6876b,
  raw_copper_block: 0x9a6a4f,
  raw_gold_block: 0xdda92e,
  amethyst_block: 0x8562bf,
  budding_amethyst: 0x84609a,
  resin_block: 0xd9671c,
  resin_bricks: 0xce5f1b,
  chiseled_resin_bricks: 0xc9601d,
  prismarine: 0x63a29a,
  prismarine_bricks: 0x63ab9e,
  dark_prismarine: 0x335b4b,
  sea_lantern: 0xacc7be,
  sponge: 0xc3c04a,
  wet_sponge: 0xaab446,
  bricks: 0x976253,
  bookshelf: 0x75603a,
  chiseled_bookshelf: 0x6f5532,
  crafting_table: 0x7f603a,
  cartography_table: 0x685142,
  fletching_table: 0xc5b483,
  smithing_table: 0x393a46,
  loom: 0x8e7656,
  furnace: 0x6e6e6e,
  blast_furnace: 0x6c6b6b,
  smoker: 0x6b5a47,
  chest: 0xa26d26,
  trapped_chest: 0xa26d26,
  barrel: 0x86643b,
  ender_chest: 0x2a3a3c,
  tnt: 0xb54636,
  pumpkin: 0xc67618,
  carved_pumpkin: 0xc06e16,
  jack_o_lantern: 0xd7962c,
  melon: 0x6f9124,
  hay_block: 0xa68a0c,
  bone_block: 0xe1ddc9,
  dried_kelp_block: 0x323b27,
  target: 0xe5b0a8,
  honeycomb_block: 0xe5941e,
  note_block: 0x5e3e2e,
  jukebox: 0x5e3e2e,
  observer: 0x646464,
  dispenser: 0x7a7a7a,
  dropper: 0x7a7a7a,
  piston: 0x8f8167,
  sticky_piston: 0x7f9064,
  crafter: 0x6e6262,
  lodestone: 0x77787c,
  respawn_anchor: 0x3b1f64,
  beehive: 0xb6935a,
  bee_nest: 0xc59f4b,
  composter: 0x7b5a33,
  enchanting_table: 0x812d2f,
  lectern: 0xb18b51,
  redstone_lamp: 0x5f3720,
  daylight_detector: 0x8a7a64,
  command_block: 0xb48a6f,
  chain_command_block: 0x7f9f8f,
  repeating_command_block: 0x7f6fb0,
  structure_block: 0x5a4a5a,
  jigsaw: 0x52465a,
  sculk: 0x0d1e24,
  sculk_catalyst: 0x26343a,
  sculk_shrieker: 0x5a6b5f,
  brown_mushroom_block: 0x957051,
  red_mushroom_block: 0xc72e2d,
  mushroom_stem: 0xcbc4b9,
  shulker_box: 0x8b618b,
  cake: 0xe6d6c6,
  muddy_mangrove_roots: 0x46392f,
  stripped_bamboo_block: 0xc4b04e,
  bamboo_block: 0x7f9032,
  bamboo_planks: 0xc2ad51,
  bamboo_mosaic: 0xbeaa4e,
  petrified_oak_slab: 0xa2834f,
  trial_spawner: 0x3d4a52,
  vault: 0x3f4a51,
  creaking_heart: 0x5e5451,
};

const PLANT: Record<string, number> = {
  short_grass: 0x5d8a33,
  grass: 0x5d8a33,
  tall_grass: 0x5d8a33,
  fern: 0x597a2f,
  large_fern: 0x597a2f,
  dead_bush: 0x6b4f29,
  short_dry_grass: 0xb59a5a,
  tall_dry_grass: 0xb59a5a,
  bush: 0x4f7a2b,
  firefly_bush: 0x5a6b33,
  leaf_litter: 0x8a5a2a,
  dandelion: 0xe7d33a,
  poppy: 0xc82a1a,
  blue_orchid: 0x2aa5c6,
  allium: 0xb37fda,
  azure_bluet: 0xd8e3e6,
  red_tulip: 0xc7301e,
  orange_tulip: 0xdf7b24,
  white_tulip: 0xe0eadf,
  pink_tulip: 0xebc3e5,
  oxeye_daisy: 0xdbdfd2,
  cornflower: 0x4769cf,
  lily_of_the_valley: 0xe8ebe6,
  wither_rose: 0x252a1c,
  sunflower: 0xe3c22a,
  lilac: 0xb896b8,
  rose_bush: 0x9f2f24,
  peony: 0xe3b8e0,
  torchflower: 0xe5a02a,
  torchflower_crop: 0x6b8a3a,
  pitcher_plant: 0x6b9bb0,
  pitcher_crop: 0x6b8a6a,
  open_eyeblossom: 0xe08a3a,
  closed_eyeblossom: 0x6b6b72,
  pink_petals: 0xea9fc3,
  wildflowers: 0xe9d870,
  sweet_berry_bush: 0x3d5c2e,
  wheat: 0xa99c3d,
  carrots: 0x4f9f33,
  potatoes: 0x4e8b2b,
  beetroots: 0x4f7a2e,
  melon_stem: 0x6b9a2e,
  pumpkin_stem: 0x6b9a2e,
  attached_melon_stem: 0x8a8a2e,
  attached_pumpkin_stem: 0x8a8a2e,
  sugar_cane: 0x95c16a,
  bamboo: 0x5d8c1d,
  bamboo_sapling: 0x5d8c1d,
  cactus: 0x5a8a2a,
  kelp: 0x578b2b,
  kelp_plant: 0x578b2b,
  seagrass: 0x3d7f19,
  tall_seagrass: 0x3d7f19,
  sea_pickle: 0x6b7135,
  lily_pad: 0x208030,
  vine: 0x3e6b17,
  cave_vines: 0x5e6f2b,
  cave_vines_plant: 0x5e6f2b,
  glow_lichen: 0x6f8a7b,
  sculk_vein: 0x0d2a30,
  hanging_roots: 0xa1735c,
  spore_blossom: 0xcf618d,
  small_dripleaf: 0x5f8a2b,
  big_dripleaf: 0x6f9e2f,
  big_dripleaf_stem: 0x5f8a2b,
  azalea: 0x667d2f,
  flowering_azalea: 0x7a7a49,
  brown_mushroom: 0x9a7556,
  red_mushroom: 0xc62b28,
  crimson_fungus: 0x8c2b20,
  warped_fungus: 0x4a6f5c,
  crimson_roots: 0x7d0c1f,
  warped_roots: 0x159388,
  nether_sprouts: 0x15847c,
  twisting_vines: 0x148d82,
  twisting_vines_plant: 0x148d82,
  weeping_vines: 0x7b0a0a,
  weeping_vines_plant: 0x7b0a0a,
  nether_wart: 0x6f1515,
  chorus_plant: 0x5d395d,
  cocoa: 0x8a5a2b,
  mangrove_propagule: 0x5f8a35,
  pointed_dripstone: 0x81685a,
  amethyst_cluster: 0xa47fcf,
  large_amethyst_bud: 0xa47fcf,
  medium_amethyst_bud: 0xa47fcf,
  small_amethyst_bud: 0xa47fcf,
  resin_clump: 0xd9671c,
  pale_hanging_moss: 0x6b706a,
  cobweb: 0xe4e9ea,
  torch: 0xffd75a,
  wall_torch: 0xffd75a,
  soul_torch: 0x61c8cb,
  soul_wall_torch: 0x61c8cb,
  redstone_torch: 0xc62e17,
  redstone_wall_torch: 0xc62e17,
  copper_torch: 0x9fd86a,
  copper_wall_torch: 0x9fd86a,
  rail: 0x7c6c56,
  powered_rail: 0x9a7e41,
  detector_rail: 0x7b6a5a,
  activator_rail: 0x7b5f56,
  redstone_wire: 0x9a0d00,
  lever: 0x6d5b41,
  tripwire: 0xd0d0d0,
  tripwire_hook: 0x8a7a64,
  lantern: 0x4f4a45,
  soul_lantern: 0x3f5a5f,
  chain: 0x3f4552,
  iron_chain: 0x3f4552,
  end_rod: 0xe0dad0,
  lightning_rod: 0xc06c50,
  flower_pot: 0x7c4536,
  candle: 0xe5d4a8,
  frogspawn: 0x6b5a50,
  sniffer_egg: 0x8a4a3a,
  turtle_egg: 0xe4e3c0,
  repeater: 0x9e9e9e,
  comparator: 0x9e9e9e,
};

const CUTOUT: Record<string, number> = {
  mangrove_roots: 0x4b3c27,
  scaffolding: 0xaa8448,
  ladder: 0x7c6239,
  iron_bars: 0x878889,
  hopper: 0x4b4a4b,
  cauldron: 0x4a494a,
  water_cauldron: 0x3f76e4,
  lava_cauldron: 0xd96415,
  powder_snow_cauldron: 0xf8fdfd,
  anvil: 0x444444,
  chipped_anvil: 0x444444,
  damaged_anvil: 0x444444,
  spawner: 0x243444,
  bell: 0xc8a43a,
  campfire: 0x8a5a2b,
  soul_campfire: 0x4a8a8a,
  brewing_stand: 0x7a6a4a,
  grindstone: 0x8e8e8e,
  stonecutter: 0x7a7a7a,
  conduit: 0x9f8b6d,
  decorated_pot: 0x8c4a35,
  heavy_core: 0x4a4e57,
  sculk_sensor: 0x0d4a5a,
  calibrated_sculk_sensor: 0x2a4a6a,
  dried_ghast: 0x8a8080,
  oak_leaves: 0x4a7a2b,
  spruce_leaves: 0x3d5f3d,
  birch_leaves: 0x5f8a3c,
  jungle_leaves: 0x3f8b25,
  acacia_leaves: 0x4a7a22,
  dark_oak_leaves: 0x3d6e1f,
  mangrove_leaves: 0x557d26,
  cherry_leaves: 0xe4b2c6,
  azalea_leaves: 0x5a7329,
  flowering_azalea_leaves: 0x6a7a45,
  pale_oak_leaves: 0x9ba099,
  light_weighted_pressure_plate: 0xf6d03d,
  heavy_weighted_pressure_plate: 0xdcdcdc,
};

const TRANSPARENT: Record<string, [number, number]> = {
  glass: [0xc3dfe5, 0.3],
  glass_pane: [0xc3dfe5, 0.3],
  tinted_glass: [0x2c2730, 0.85],
  ice: [0x91b7fd, 0.65],
  frosted_ice: [0x8cb4fb, 0.65],
  slime_block: [0x6fc05b, 0.75],
  honey_block: [0xfbb935, 0.75],
  beacon: [0x76ddd7, 0.7],
  nether_portal: [0x5a0fd0, 0.6],
};

const LIQUID: Record<string, [number, number]> = {
  water: [0x3f76e4, 0.6],
  bubble_column: [0x3f76e4, 0.6],
  lava: [0xd96415, 1],
};

const SIDE_COLORS: Record<string, number> = {
  grass_block: 0x86704a,
  podzol: 0x7a5539,
  mycelium: 0x85735f,
  dirt_path: 0x866043,
  farmland: 0x866043,
  crimson_nylium: 0x622626,
  warped_nylium: 0x622626,
};

// [bark, stripped, planks]
const WOODS: Record<string, [number, number, number]> = {
  oak: [0x6d5533, 0xb0894f, 0xa2834f],
  spruce: [0x3a2614, 0x755a34, 0x735532],
  birch: [0xd8d7d2, 0xc4b07a, 0xc0af79],
  jungle: [0x55441b, 0xab8455, 0xa07351],
  acacia: [0x676157, 0xae5d3b, 0xa85a32],
  dark_oak: [0x3c2e1a, 0x4b3a24, 0x432b14],
  mangrove: [0x54432b, 0x783631, 0x773631],
  cherry: [0x37202a, 0xd79d95, 0xe2b3ac],
  pale_oak: [0x5e5451, 0xf5ebe9, 0xe3d9d6],
  crimson: [0x5c1a1e, 0x893a56, 0x653047],
  warped: [0x3a3a4d, 0x3a9690, 0x2b6963],
};

const DYES = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
] as const;

// Per dye in DYES order.
const DYE_COLORS = [
  0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97, 0x169c9c, 0x8932b8,
  0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21,
];
const WOOL_COLORS = [
  0xe9ecec, 0xf07613, 0xbd44b3, 0x3aafd9, 0xf8c527, 0x70b919, 0xed8dac, 0x3e4447, 0x8e8e86, 0x158991, 0x792aac,
  0x35399d, 0x724728, 0x546d1b, 0xa12722, 0x141519,
];
const CONCRETE_COLORS = [
  0xcfd5d6, 0xe06100, 0xa9309f, 0x2389c6, 0xf0af15, 0x5ea818, 0xd5658e, 0x36393d, 0x7d7d73, 0x157788, 0x64209c,
  0x2c2e8f, 0x603b1f, 0x495b24, 0x8e2020, 0x080a0f,
];
const POWDER_COLORS = [
  0xe1e3e3, 0xe3831f, 0xc053b9, 0x4aa4d5, 0xe8c736, 0x7dbd29, 0xe499b5, 0x4c5154, 0x9a9a94, 0x249499, 0x8337b1,
  0x4649a6, 0x7d5435, 0x61772c, 0xa83632, 0x191a1f,
];
const TERRACOTTA_COLORS = [
  0xd1b2a1, 0xa15325, 0x95576c, 0x716c89, 0xba8523, 0x677534, 0xa14e4e, 0x392a23, 0x876a61, 0x575b5b, 0x764656,
  0x4a3b5b, 0x4d3323, 0x4c532a, 0x8f3d2e, 0x251610,
];
const GLAZED_COLORS = [
  0xbcd4ca, 0x9a935b, 0xd064bf, 0x5ea4d0, 0xeac058, 0xa2c537, 0xeb9ab5, 0x535a5d, 0x90a6a7, 0x34767d, 0x6d3098,
  0x2f408b, 0x7c5d3d, 0x758e43, 0xb53b35, 0x431e20,
];

const toRgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

const TABLE = new Map<string, BlockLook>();

function define(name: string, hex: number, kind: BlockKind, alpha?: number) {
  const look: BlockLook = { color: toRgb(hex), kind };
  if (alpha !== undefined) look.alpha = alpha;
  TABLE.set(name, look);
}

for (const [name, hex] of Object.entries(SOLID)) define(name, hex, 'solid');
for (const [name, hex] of Object.entries(PLANT)) define(name, hex, 'plant');
for (const [name, hex] of Object.entries(CUTOUT)) define(name, hex, 'cutout');
for (const [name, [hex, alpha]] of Object.entries(TRANSPARENT)) define(name, hex, 'transparent', alpha);
for (const [name, [hex, alpha]] of Object.entries(LIQUID)) define(name, hex, 'liquid', alpha);

for (const [wood, [bark, stripped, planks]] of Object.entries(WOODS)) {
  const nether = wood === 'crimson' || wood === 'warped';
  const log = nether ? 'stem' : 'log';
  const block = nether ? 'hyphae' : 'wood';
  TABLE.set(`${wood}_${log}`, { color: toRgb(stripped), side: toRgb(bark), kind: 'solid' });
  TABLE.set(`stripped_${wood}_${log}`, { color: toRgb(planks), side: toRgb(stripped), kind: 'solid' });
  define(`${wood}_${block}`, bark, 'solid');
  define(`stripped_${wood}_${block}`, stripped, 'solid');
  define(`${wood}_planks`, planks, 'solid');
  if (!nether) define(`${wood}_sapling`, CUTOUT[`${wood}_leaves`] ?? bark, 'plant');
}

DYES.forEach((dye, i) => {
  define(`${dye}_wool`, WOOL_COLORS[i], 'solid');
  define(`${dye}_carpet`, WOOL_COLORS[i], 'solid');
  define(`${dye}_concrete`, CONCRETE_COLORS[i], 'solid');
  define(`${dye}_concrete_powder`, POWDER_COLORS[i], 'solid');
  define(`${dye}_terracotta`, TERRACOTTA_COLORS[i], 'solid');
  define(`${dye}_glazed_terracotta`, GLAZED_COLORS[i], 'solid');
  define(`${dye}_stained_glass`, DYE_COLORS[i], 'transparent', 0.5);
  define(`${dye}_stained_glass_pane`, DYE_COLORS[i], 'transparent', 0.5);
  define(`${dye}_shulker_box`, DYE_COLORS[i], 'solid');
  define(`${dye}_bed`, DYE_COLORS[i], 'cutout');
  define(`${dye}_banner`, DYE_COLORS[i], 'cutout');
  define(`${dye}_wall_banner`, DYE_COLORS[i], 'cutout');
  define(`${dye}_candle`, DYE_COLORS[i], 'plant');
});
define('terracotta', 0x985e43, 'solid');

for (const [name, hex] of Object.entries(SIDE_COLORS)) {
  const look = TABLE.get(name);
  if (look) look.side = toRgb(hex);
}

const SHAPE_SUFFIXES: [string, BlockKind | null][] = [
  ['_wall_hanging_sign', 'cutout'],
  ['_hanging_sign', 'cutout'],
  ['_wall_sign', 'cutout'],
  ['_sign', 'cutout'],
  ['_fence_gate', 'cutout'],
  ['_fence', 'cutout'],
  ['_pressure_plate', 'cutout'],
  ['_button', 'cutout'],
  ['_trapdoor', 'cutout'],
  ['_door', 'cutout'],
  ['_stairs', null],
  ['_slab', null],
  ['_wall', null],
  ['_carpet', null],
  ['_pane', null],
];

const PLANT_WORDS = [
  'sapling',
  'flower',
  'tulip',
  'fern',
  'bush',
  'roots',
  'vine',
  'sprouts',
  'petals',
  'torch',
  'rail',
  'crop',
  'propagule',
  'fungus',
  'candle',
  'grass',
];

const MEMO = new Map<string, BlockLook>();

/** Visual description of a block id ("minecraft:oak_log" or "oak_log"), memoized. */
export function blockLook(name: string): BlockLook {
  const cached = MEMO.get(name);
  if (cached) return cached;
  const colon = name.indexOf(':');
  const id = (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
  const look = resolve(id, 0);
  MEMO.set(name, look);
  return look;
}

function withKind(look: BlockLook, kind: BlockKind): BlockLook {
  if (look.kind === kind) return look;
  return { color: look.color, kind, side: look.side };
}

function exactBase(base: string): BlockLook | null {
  for (const candidate of [base, `${base}s`, `${base}_planks`, `${base}_block`]) {
    const look = TABLE.get(candidate);
    if (look) return look;
  }
  return null;
}

function resolve(id: string, depth: number): BlockLook {
  if (AIR_NAMES.has(id)) return { color: [0, 0, 0], kind: 'air' };
  const exact = TABLE.get(id);
  if (exact) return exact;
  if (depth > 4) return fallback(id);

  for (const prefix of ['waxed_', 'infested_']) {
    if (id.startsWith(prefix)) return resolve(id.slice(prefix.length), depth + 1);
  }
  if (id.startsWith('potted_')) return withKind(resolve(id.slice(7), depth + 1), 'plant');

  for (const [suffix, kind] of SHAPE_SUFFIXES) {
    if (!id.endsWith(suffix) || id.length === suffix.length) continue;
    const base = id.slice(0, -suffix.length);
    const look = exactBase(base) ?? resolve(base, depth + 1);
    if (look.kind === 'air') break;
    return kind ? withKind(look, kind) : look;
  }

  const keyword = keywordLook(id);
  if (keyword) return keyword;
  return fallback(id);
}

function dyeIndex(id: string): number {
  // light_blue/light_gray must win over blue/gray
  let best = -1;
  let bestLength = 0;
  DYES.forEach((dye, i) => {
    if ((id === dye || id.startsWith(`${dye}_`) || id.includes(`_${dye}_`)) && dye.length > bestLength) {
      best = i;
      bestLength = dye.length;
    }
  });
  return best;
}

function copperLook(id: string, cut: boolean): BlockLook {
  const stage = id.includes('oxidized')
    ? 'oxidized_'
    : id.includes('weathered')
      ? 'weathered_'
      : id.includes('exposed')
        ? 'exposed_'
        : '';
  const look = TABLE.get(cut ? `${stage}cut_copper` : stage ? `${stage}copper` : 'copper_block');
  return look ?? { color: toRgb(0xc06c50), kind: 'solid' };
}

function keywordLook(id: string): BlockLook | null {
  const has = (word: string) => id.includes(word);
  const solid = (hex: number): BlockLook => ({ color: toRgb(hex), kind: 'solid' });

  const dye = dyeIndex(id);
  if (dye >= 0) {
    const hex = DYE_COLORS[dye];
    if (has('glass')) return { color: toRgb(hex), kind: 'transparent', alpha: 0.5 };
    if (has('wool') || has('carpet')) return solid(WOOL_COLORS[dye]);
    if (has('concrete')) return solid(CONCRETE_COLORS[dye]);
    if (has('terracotta')) return solid(TERRACOTTA_COLORS[dye]);
    if (has('candle')) return { color: toRgb(hex), kind: 'plant' };
    if (has('bed') || has('banner')) return { color: toRgb(hex), kind: 'cutout' };
    return solid(hex);
  }

  if (has('glass')) return { color: toRgb(0xc3dfe5), kind: 'transparent', alpha: 0.3 };
  if (has('leaves')) return { color: toRgb(0x4a7a2b), kind: 'cutout' };
  if (has('coral')) {
    const hex = has('tube')
      ? 0x3157d0
      : has('brain')
        ? 0xcf5b9f
        : has('bubble')
          ? 0xa418a2
          : has('fire')
            ? 0xa4232f
            : has('horn')
              ? 0xd8c742
              : 0x857c78;
    return { color: toRgb(has('dead') ? 0x857c78 : hex), kind: id.endsWith('_block') ? 'solid' : 'plant' };
  }
  if (has('mushroom') && !has('block') && !has('stem')) return { color: toRgb(0x9a7556), kind: 'plant' };
  if (has('head') || has('skull')) return { color: toRgb(0x6b6b6b), kind: 'cutout' };
  if (PLANT_WORDS.some(has)) return { color: toRgb(0x5d8a33), kind: 'plant' };

  for (const [wood, [bark, stripped, planks]] of Object.entries(WOODS)) {
    if (!has(wood)) continue;
    if (has('stripped')) return solid(stripped);
    if (has('log') || has('wood') || has('stem') || has('hyphae')) return solid(bark);
    return solid(planks);
  }

  if (has('copper')) return copperLook(id, has('cut') || has('chiseled') || has('grate') || has('bulb'));
  if (id.endsWith('_ore')) {
    const base = has('deepslate') ? 0x505053 : has('nether') ? 0x622626 : 0x7d7d7d;
    const tint = hashName(id);
    return solid(mix(base, hslHex(tint % 360, 0.5, 0.5), 0.25));
  }

  const MATERIAL_WORDS: [string, number][] = [
    ['deepslate', 0x48484a],
    ['blackstone', 0x302a31],
    ['red_sandstone', 0xba631d],
    ['sandstone', 0xd8cb9b],
    ['end_stone', 0xdae0a2],
    ['stone', 0x7d7d7d],
    ['nether_brick', 0x2c1519],
    ['mud_brick', 0x89684f],
    ['brick', 0x976253],
    ['quartz', 0xece6df],
    ['prismarine', 0x63a29a],
    ['purpur', 0xa97ea9],
    ['nether', 0x622626],
    ['terracotta', 0x985e43],
    ['concrete', 0xcfd5d6],
    ['wool', 0xe9ecec],
    ['tuff', 0x6c6d67],
    ['amethyst', 0x8562bf],
    ['basalt', 0x515156],
    ['resin', 0xd9671c],
    ['sand', 0xdbcfa3],
    ['dirt', 0x866043],
    ['mud', 0x3c393d],
    ['snow', 0xf9fefe],
    ['iron', 0xdcdcdc],
    ['gold', 0xf6d03d],
  ];
  for (const [word, hex] of MATERIAL_WORDS) {
    if (has(word)) return solid(hex);
  }
  if (has('ice')) return { color: toRgb(0x91b7fd), kind: 'transparent', alpha: 0.65 };
  return null;
}

function hashName(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslHex(hue: number, saturation: number, lightness: number): number {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

function mix(a: number, b: number, t: number): number {
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function fallback(id: string): BlockLook {
  const h = hashName(id);
  return { color: toRgb(hslHex(h % 360, 0.22, 0.42 + ((h >>> 9) % 16) / 100)), kind: 'solid' };
}
