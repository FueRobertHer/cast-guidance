/**
 * Human-readable names for 5etools source abbreviations.
 *
 * A badge reading "PHB" only helps someone who already reads 5etools
 * shorthand, so every surface that shows one can ask here for "Player's
 * Handbook (2014)". This is bibliographic metadata (the titles and categories
 * of published books), not game content, so unlike the compendium it ships
 * with the app: badges have to render before any pack has downloaded, and the
 * app never fetches the files these titles would otherwise come from.
 *
 * Generated from the 5etools mirror's own source table (js/parser.js at
 * v2.33.3), with categories from books.json plus its adventure set. Anything
 * added to the dataset after that falls back to the bare code, which is
 * exactly what the badge showed before this table existed, so a stale table
 * degrades quietly instead of breaking. Regenerate when unknown codes start
 * showing up in the settings source list.
 */

export type SourceGroup = 'core' | 'supplement' | 'setting' | 'adventure' | 'playtest' | 'other';

/** Broad-to-narrow, which is also the order the settings list uses. */
export const SOURCE_GROUPS: readonly SourceGroup[] = [
  'core',
  'supplement',
  'setting',
  'adventure',
  'playtest',
  'other',
];

export const SOURCE_GROUP_LABELS: Record<SourceGroup, string> = {
  core: 'Core rulebooks',
  supplement: 'Rules supplements',
  setting: 'Campaign settings',
  adventure: 'Adventures',
  playtest: 'Playtest material',
  other: 'Everything else',
};

const SOURCES: Record<string, readonly [name: string, group: SourceGroup]> = {
  // core
  DMG: ["Dungeon Master's Guide (2014)", 'core'],
  MM: ['Monster Manual (2014)', 'core'],
  PHB: ["Player's Handbook (2014)", 'core'],
  XDMG: ["Dungeon Master's Guide (2024)", 'core'],
  XMM: ['Monster Manual (2025)', 'core'],
  XPHB: ["Player's Handbook (2024)", 'core'],

  // supplement
  AATM: ['Adventure Atlas: The Mortuary', 'supplement'],
  ABH: ["Astarion's Book of Hungers", 'supplement'],
  AI: ['Acquisitions Incorporated', 'supplement'],
  AWM: ['Adventure with Muk', 'supplement'],
  BGG: ['Bigby Presents: Glory of the Giants', 'supplement'],
  BMT: ['The Book of Many Things', 'supplement'],
  DMTCRG: ['The Deck of Many Things: Card Reference Guide', 'supplement'],
  DoD: ['Domains of Delight', 'supplement'],
  FTD: ["Fizban's Treasury of Dragons", 'supplement'],
  'HAT-TG': ["Honor Among Thieves: Thieves' Gallery", 'supplement'],
  MaBJoV: ["Minsc and Boo's Journal of Villainy", 'supplement'],
  MCV1SC: ['Monstrous Compendium Volume 1: Spelljammer Creatures', 'supplement'],
  MCV4EC: ['Monstrous Compendium Volume 4: Eldraine Creatures', 'supplement'],
  MGELFT: ["Muk's Guide To Everything He Learned From Tasha", 'supplement'],
  MPMM: ['Mordenkainen Presents: Monsters of the Multiverse', 'supplement'],
  MTF: ["Mordenkainen's Tome of Foes", 'supplement'],
  OGA: ['One Grung Above', 'supplement'],
  RMR: ['Dungeons & Dragons vs. Rick and Morty: Basic Rules', 'supplement'],
  TCE: ["Tasha's Cauldron of Everything", 'supplement'],
  TD: ['Tarot Deck', 'supplement'],
  VGM: ["Volo's Guide to Monsters", 'supplement'],
  XGE: ["Xanathar's Guide to Everything", 'supplement'],

  // setting
  AAG: ["Astral Adventurer's Guide", 'setting'],
  BAM: ["Boo's Astral Menagerie", 'setting'],
  EFA: ['Eberron: Forge of the Artificer', 'setting'],
  EGW: ["Explorer's Guide to Wildemount", 'setting'],
  ERLW: ['Eberron: Rising from the Last War', 'setting'],
  FRAiF: ['Forgotten Realms: Adventures in Faerûn', 'setting'],
  FRHoF: ['Forgotten Realms: Heroes of Faerûn', 'setting'],
  GGR: ["Guildmasters' Guide to Ravnica", 'setting'],
  LFL: ['Lorwyn: First Light', 'setting'],
  MOT: ['Mythic Odysseys of Theros', 'setting'],
  MPP: ["Morte's Planar Parade", 'setting'],
  NF: ["Netheril's Fall", 'setting'],
  PSA: ['Plane Shift: Amonkhet', 'setting'],
  PSD: ['Plane Shift: Dominaria', 'setting'],
  PSI: ['Plane Shift: Innistrad', 'setting'],
  PSK: ['Plane Shift: Kaladesh', 'setting'],
  PSX: ['Plane Shift: Ixalan', 'setting'],
  PSZ: ['Plane Shift: Zendikar', 'setting'],
  RHW: ['Ravenloft: The Horrors Within', 'setting'],
  SatO: ['Sigil and the Outlands', 'setting'],
  SCAG: ["Sword Coast Adventurer's Guide", 'setting'],
  SCC: ['Strixhaven: A Curriculum of Chaos', 'setting'],
  VRGR: ["Van Richten's Guide to Ravenloft", 'setting'],

  // adventure
  AitFR: ['Adventures in the Forgotten Realms', 'adventure'],
  'AitFR-AVT': ['Adventures in the Forgotten Realms: A Verdant Tomb', 'adventure'],
  'AitFR-DN': ['Adventures in the Forgotten Realms: Deepest Night', 'adventure'],
  'AitFR-FCD': ['Adventures in the Forgotten Realms: From Cyan Depths', 'adventure'],
  'AitFR-ISF': ['Adventures in the Forgotten Realms: In Scarlet Flames', 'adventure'],
  'AitFR-THP': ['Adventures in the Forgotten Realms: The Hidden Page', 'adventure'],
  AZfyT: ['A Zib for your Thoughts', 'adventure'],
  BGDIA: ["Baldur's Gate: Descent Into Avernus", 'adventure'],
  BQGT: ['Borderlands Quest: Goblin Trouble', 'adventure'],
  CM: ['Candlekeep Mysteries', 'adventure'],
  CoA: ['Chains of Asmodeus', 'adventure'],
  CoS: ['Curse of Strahd', 'adventure'],
  CRCotN: ['Critical Role: Call of the Netherdeep', 'adventure'],
  DC: ['Divine Contention', 'adventure'],
  DD: ['Dangerous Designs', 'adventure'],
  DIP: ['Dragon of Icespire Peak', 'adventure'],
  DitLCoT: ['Descent into the Lost Caverns of Tsojcanth', 'adventure'],
  DoSI: ['Dragons of Stormwreck Isle', 'adventure'],
  DrDe: ['Dragon Delves', 'adventure'],
  'DrDe-ACfaS': ['A Copper for a Song', 'adventure'],
  'DrDe-BD': ["Baker's Doesn't", 'adventure'],
  'DrDe-BtS': ['Before the Storm', 'adventure'],
  'DrDe-DaS': ['Death at Sunset', 'adventure'],
  'DrDe-DotSC': ['Dragons of the Sandstone City', 'adventure'],
  'DrDe-FWtVC': ['For Whom the Void Calls', 'adventure'],
  'DrDe-SD': ['Shivering Death', 'adventure'],
  'DrDe-TDoN': ['The Dragon of Najkir', 'adventure'],
  'DrDe-TFV': ['The Forbidden Vale', 'adventure'],
  'DrDe-TWoO': ['The Will of Orcus', 'adventure'],
  DSotDQ: ['Dragonlance: Shadow of the Dragon Queen', 'adventure'],
  EFR: ['Eberron: Forgotten Relics', 'adventure'],
  FFotR: ['Fated Flight of the Recluse', 'adventure'],
  FS: ['Frozen Sick', 'adventure'],
  GoS: ['Ghosts of Saltmarsh', 'adventure'],
  GotSF: ['Giants of the Star Forge', 'adventure'],
  HBTD: ['Hold Back The Dead', 'adventure'],
  HFStCM: ["Heroes' Feast: Saving the Children's Menu", 'adventure'],
  HftT: ['Hunt for the Thessalhydra', 'adventure'],
  HoL: ['The House of Lament', 'adventure'],
  HotB: ['Heroes of the Borderlands', 'adventure'],
  HotDQ: ['Hoard of the Dragon Queen', 'adventure'],
  IDRotF: ['Icewind Dale: Rime of the Frostmaiden', 'adventure'],
  IMR: ['Infernal Machine Rebuild', 'adventure'],
  JttRC: ['Journeys through the Radiant Citadel', 'adventure'],
  KftGV: ['Keys from the Golden Vault', 'adventure'],
  KKW: ["Krenko's Way", 'adventure'],
  LK: ['Lightning Keep', 'adventure'],
  LLK: ['Lost Laboratory of Kwalish', 'adventure'],
  LMoP: ['Lost Mine of Phandelver', 'adventure'],
  LoX: ['Light of Xaryxis', 'adventure'],
  LR: ['Locathah Rising', 'adventure'],
  LRDT: ["Red Dragon's Tale: A LEGO Adventure", 'adventure'],
  NRH: ['NERDS Restoring Harmony', 'adventure'],
  'NRH-ASS': ['NERDS Restoring Harmony: A Sticky Situation', 'adventure'],
  'NRH-AT': ['NERDS Restoring Harmony: Adventure Together', 'adventure'],
  'NRH-AVitW': ['NERDS Restoring Harmony: A Voice in the Wilderness', 'adventure'],
  'NRH-AWoL': ['NERDS Restoring Harmony: A Web of Lies', 'adventure'],
  'NRH-CoI': ['NERDS Restoring Harmony: Circus of Illusions', 'adventure'],
  'NRH-TCMC': ['NERDS Restoring Harmony: The Candy Mountain Caper', 'adventure'],
  'NRH-TLT': ['NERDS Restoring Harmony: The Lost Tomb', 'adventure'],
  OotA: ['Out of the Abyss', 'adventure'],
  OoW: ['The Orrery of the Wanderer', 'adventure'],
  PaBTSO: ['Phandelver and Below: The Shattered Obelisk', 'adventure'],
  PiP: ['Peril in Pinebrook', 'adventure'],
  PotA: ['Princes of the Apocalypse', 'adventure'],
  RMBRE: ['The Lost Dungeon of Rickedness: Big Rick Energy', 'adventure'],
  RoT: ['The Rise of Tiamat', 'adventure'],
  RoTOS: ['The Rise of Tiamat Online Supplement', 'adventure'],
  RtG: ['Return to Glory', 'adventure'],
  'SCC-ARiR': ['A Reckoning in Ruins', 'adventure'],
  'SCC-CK': ['Campus Kerfuffle', 'adventure'],
  'SCC-HfMT': ['Hunt for Mage Tower', 'adventure'],
  'SCC-TMM': ["The Magister's Masquerade", 'adventure'],
  ScoEE: ['Scions of Elemental Evil', 'adventure'],
  SDW: ["Sleeping Dragon's Wake", 'adventure'],
  SjA: ['Spelljammer Academy', 'adventure'],
  SKT: ["Storm King's Thunder", 'adventure'],
  SLW: ["Storm Lord's Wrath", 'adventure'],
  TftYP: ['Tales from the Yawning Portal', 'adventure'],
  'TftYP-AtG': ['Tales from the Yawning Portal: Against the Giants', 'adventure'],
  'TftYP-DiT': ['Tales from the Yawning Portal: Dead in Thay', 'adventure'],
  'TftYP-TFoF': ['Tales from the Yawning Portal: The Forge of Fury', 'adventure'],
  'TftYP-THSoT': ['Tales from the Yawning Portal: The Hidden Shrine of Tamoachan', 'adventure'],
  'TftYP-ToH': ['Tales from the Yawning Portal: Tomb of Horrors', 'adventure'],
  'TftYP-TSC': ['Tales from the Yawning Portal: The Sunless Citadel', 'adventure'],
  'TftYP-WPM': ['Tales from the Yawning Portal: White Plume Mountain', 'adventure'],
  TLK: ['The Lost Kenku', 'adventure'],
  ToA: ['Tomb of Annihilation', 'adventure'],
  ToR: ['Tide of Retribution', 'adventure'],
  TTP: ['The Tortle Package', 'adventure'],
  US: ['Unwelcome Spirits', 'adventure'],
  UtHftLH: ['Uni and the Hunt for the Lost Horn', 'adventure'],
  VNotEE: ['Vecna: Nest of the Eldritch Eye', 'adventure'],
  WBtW: ['The Wild Beyond the Witchlight', 'adventure'],
  WDH: ['Waterdeep: Dragon Heist', 'adventure'],
  WDMM: ['Waterdeep: Dungeon of the Mad Mage', 'adventure'],
  WttHC: ['Stranger Things: Welcome to the Hellfire Club', 'adventure'],
  XMtS: ['X Marks the Spot', 'adventure'],

  // playtest
  UATheMysticClass: ['Unearthed Arcana: The Mystic Class', 'playtest'],

  // other
  AL: ["Adventurers' League", 'other'],
  BQDD: ['Borderlands Quest: Dagger Danger!', 'other'],
  CaBoMP: ['Crochet: A Book of Many Patterns', 'other'],
  EEPC: ["Elemental Evil Player's Companion", 'other'],
  EET: ['Elemental Evil: Trinkets', 'other'],
  ESK: ['Essentials Kit', 'other'],
  'HAT-LMI': ['Honor Among Thieves: Legendary Magic Items', 'other'],
  HF: ["Heroes' Feast", 'other'],
  HFDoMM: ["Heroes' Feast: The Deck of Many Morsels", 'other'],
  HFFotM: ["Heroes' Feast: Flavors of the Multiverse", 'other'],
  MCV2DC: ['Monstrous Compendium Volume 2: Dragonlance Creatures', 'other'],
  MCV3MC: ['Monstrous Compendium Volume 3: Minecraft Creatures', 'other'],
  MFF: ["Mordenkainen's Fiendish Folio", 'other'],
  MisMV1: ['Misplaced Monsters: Volume 1', 'other'],
  PaF: ['Puncheons and Flagons', 'other'],
  PAitM: ['Planescape: Adventures in the Multiverse', 'other'],
  QftIS: ['Quests from the Infinite Staircase', 'other'],
  SAC: ['Sage Advice Compendium (5e/2014)', 'other'],
  SADS: ['Sapphire Anniversary Dice Set', 'other'],
  SAiS: ['Spelljammer: Adventures in Space', 'other'],
  Screen: ["Dungeon Master's Screen", 'other'],
  ScreenDungeonKit: ["Dungeon Master's Screen: Dungeon Kit", 'other'],
  ScreenSpelljammer: ["Dungeon Master's Screen: Spelljammer", 'other'],
  ScreenWildernessKit: ["Dungeon Master's Screen: Wilderness Kit", 'other'],
  ToD: ['Tyranny of Dragons', 'other'],
  ToFW: ["Turn of Fortune's Wheel", 'other'],
  VD: ['Vecna Dossier', 'other'],
  VEoR: ['Vecna: Eve of Ruin', 'other'],
  XSAC: ['Sage Advice Compendium (2025)', 'other'],
  XScreen: ["Dungeon Master's Screen (2024)", 'other'],
  XScreenRHW: ["Dungeon Master's Screen; Ravenloft: The Horrors Within", 'other'],
};

/**
 * Own-property lookup only. A plain object literal inherits from
 * Object.prototype, so a homebrew source calling itself "constructor" or
 * "toString" would otherwise read as a known book.
 */
function entryFor(source: string): readonly [name: string, group: SourceGroup] | undefined {
  return Object.hasOwn(SOURCES, source) ? SOURCES[source] : undefined;
}

/**
 * Full title for a source code, or the code itself when it isn't one we know.
 * Homebrew and any book added after this table was generated fall through to
 * the code, which is no worse than what the badge already showed.
 */
export function sourceName(source: string): string {
  return entryFor(source)?.[0] ?? source;
}

/** Whether the code has a real title, i.e. whether {@link sourceName} added anything. */
export function isKnownSource(source: string): boolean {
  return entryFor(source) !== undefined;
}

/** Category a source belongs to; unrecognized codes are grouped as 'other'. */
export function sourceGroup(source: string): SourceGroup {
  return entryFor(source)?.[1] ?? 'other';
}

/** Every source code in the table, for the presets and for tests. */
export function knownSources(): string[] {
  return Object.keys(SOURCES);
}
