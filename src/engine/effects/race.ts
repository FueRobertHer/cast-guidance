import { emitCuratedTrait } from '../curated/curatedEffects';
import { type Ability, type DataEntity, type EffectOrigin, type EntityRef, refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, num, str } from './base';
import { proseScanFeature } from './proseScan';
import {
  genericOptions,
  languageOptions,
  readAbilityBlock,
  readProficiencyList,
  readResistList,
  skillOptions,
  toolOptions,
  weaponOptions,
} from './readers';

function raceEntity(col: Collector): { race?: DataEntity; subrace?: DataEntity } {
  const doc = col.doc;
  const race = doc.race ? col.ctx.get('race', doc.race.name, doc.race.source) : undefined;
  if (doc.race && race === undefined) {
    col.warn(`Race not found: ${refUid(doc.race)} (data pack missing or renamed)`);
  }
  const subrace = doc.subrace
    ? col.ctx.get('subrace', doc.subrace.name, doc.subrace.source)
    : undefined;
  if (doc.subrace && subrace === undefined) {
    col.warn(`Subrace not found: ${refUid(doc.subrace)}`);
  }
  return { race, subrace };
}

/**
 * Keys 5etools adds to the race's own rather than replacing them, unless the
 * subrace's `overwrite` object flags the key: ability scores and skills key by
 * key, languages and trait tags beside the race's.
 */
const ADDED_KEYS = new Set(['ability', 'skillProficiencies', 'languageProficiencies', 'traitTags']);

const isEntity = (v: unknown): v is DataEntity => typeof v === 'object' && v !== null;

/** How 5etools matches a trait to the name in `data.overwrite`. */
const traitKey = (name: string) => name.toLowerCase().trim();

/**
 * The race's list with the keys the subrace's entry at the same place sets
 * taken out of the first `places` entries, since 5etools assigns the
 * subrace's over the race's there. Places keep their index, and so their
 * prompt ids.
 */
function lessSubraceKeys(raceList: unknown, subList: unknown, places: number): unknown {
  if (!Array.isArray(raceList) || !Array.isArray(subList)) return raceList;
  return raceList.map((entry, i) => {
    const over: unknown = subList[i];
    if (i >= places || !isEntity(entry) || !isEntity(over)) return entry;
    const kept = { ...entry };
    for (const key of Object.keys(over)) delete kept[key];
    return kept;
  });
}

/**
 * The race as a subrace leaves it. 5etools merges the two into one entity
 * (`Renderer.race._getMergedSubrace` in its render.js); the engine collects
 * them apart, so each keeps its own origin and prompt ids, and takes off the
 * race what that merge would replace:
 * - a subrace trait with `data.overwrite` replaces the race trait of that name
 *   (Mammon's Legacy of Minauros for the Tiefling's Infernal Legacy);
 * - ability scores and the first skill entry take the subrace's value for any
 *   key both set, languages add to the race's, and the subrace's `overwrite`
 *   flag on one of these replaces the race's outright;
 * - every other key the subrace sets replaces the race's, spells included,
 *   and a `null` one removes it (a Winged tiefling casts none of the race's).
 */
export function raceUnderSubrace(race: DataEntity, subrace: DataEntity): DataEntity {
  const view: DataEntity = { ...race };
  const flags = isEntity(subrace.overwrite) ? subrace.overwrite : {};
  for (const [key, value] of Object.entries(subrace)) {
    // An `undefined` key is one the subrace does not set (JSON has no such value).
    if (value === undefined || key === 'name' || key === 'source' || key === 'entries') continue;
    if (value === null || !ADDED_KEYS.has(key) || flags[key] === true) delete view[key];
    else if (key === 'ability') view.ability = lessSubraceKeys(view.ability, value, Infinity);
    else if (key === 'skillProficiencies') {
      view.skillProficiencies = lessSubraceKeys(view.skillProficiencies, value, 1);
    }
  }
  const replaced = new Set<string>();
  for (const entry of asEntityArray(subrace.entries)) {
    const name = isEntity(entry.data) ? str(entry.data.overwrite) : undefined;
    if (name !== undefined) replaced.add(traitKey(name));
  }
  if (replaced.size > 0 && Array.isArray(race.entries)) {
    view.entries = race.entries.filter((entry: unknown) => {
      const name = isEntity(entry) ? str(entry.name) : undefined;
      return name === undefined || !replaced.has(traitKey(name));
    });
  }
  return view;
}

/** Whether the subrace names this race as the one it belongs to. */
function subraceOf(subrace: DataEntity, race: EntityRef): boolean {
  const same = (a: unknown, b: string) =>
    typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
  return same(subrace.raceName, race.name) && same(subrace.raceSource, race.source);
}

function collectFrom(col: Collector, e: DataEntity, origin: EffectOrigin, idBase: string): void {
  readAbilityBlock(col, e.ability, origin, `${idBase}:ability`);

  const speed = e.speed;
  if (typeof speed === 'number' || typeof speed === 'object') {
    // walk speed handled in calc/speed via raw values on effects? Keep simple:
    // speed is read directly by calc/speed from the entities; nothing emitted here.
  }

  const darkvision = num(e.darkvision);
  if (darkvision !== undefined) {
    col.add({ kind: 'sense', sense: 'darkvision', range: darkvision, origin });
  }
  if (num(e.blindsight) !== undefined) {
    col.add({ kind: 'sense', sense: 'blindsight', range: num(e.blindsight) ?? 0, origin });
  }

  readProficiencyList(
    col,
    e.skillProficiencies,
    origin,
    `${idBase}:skill`,
    'skill',
    'Skill proficiency',
    (name) => col.add({ kind: 'skillProf', skill: name, level: 1, origin }),
    skillOptions,
  );
  readProficiencyList(
    col,
    e.languageProficiencies,
    origin,
    `${idBase}:lang`,
    'language',
    'Language',
    (name) => col.add({ kind: 'language', name, origin }),
    languageOptions,
  );
  readProficiencyList(
    col,
    e.toolProficiencies,
    origin,
    `${idBase}:tool`,
    'tool',
    'Tool proficiency',
    (name) => col.add({ kind: 'toolProf', name, origin }),
    toolOptions,
  );
  readProficiencyList(
    col,
    e.weaponProficiencies,
    origin,
    `${idBase}:weapon`,
    'generic',
    'Weapon proficiency',
    (name) => col.add({ kind: 'weaponProf', name, origin }),
    weaponOptions(col.ctx),
  );
  readProficiencyList(
    col,
    e.armorProficiencies,
    origin,
    `${idBase}:armor`,
    'generic',
    'Armor proficiency',
    (name) => col.add({ kind: 'armorProf', name, origin }),
    genericOptions,
  );
  readResistList(col, e.resist, origin, `${idBase}:resist`);
  collectAdditionalSpells(col, e.additionalSpells, origin, undefined, idBase);

  // Named traits (Relentless Endurance, Breath Weapon, …) carry their mechanics
  // only in prose — curated table first, generic prose scan for the long tail.
  for (const entry of asEntityArray(e.entries)) {
    const traitName = str(entry.name);
    if (traitName === undefined) continue;
    if (!emitCuratedTrait(col, traitName, origin)) {
      proseScanFeature(col, traitName, entry.entries, origin);
    }
  }
}

/**
 * PHB Draconic Ancestry table (curated): the ancestry color fixes the breath
 * weapon's damage type, area, and save. This is a *fallback* for printings
 * whose prose can't be scanned (base PHB Dragonborn names its type via a table;
 * the 2024 XPHB race states a save but no single area to breathe in). Printings
 * that DO state everything inline — every Fizban's (FTD) Chromatic/Metallic/Gem
 * variant, whose `_versions` substitute the real damage type — are left to the
 * prose scanner, so this table must never clobber a value it already produced.
 */
const DRACONIC_ANCESTRY: Record<string, { type: string; area: string; targetAbility: Ability }> = {
  black: { type: 'acid', area: '5 by 30 ft line', targetAbility: 'dex' },
  blue: { type: 'lightning', area: '5 by 30 ft line', targetAbility: 'dex' },
  brass: { type: 'fire', area: '5 by 30 ft line', targetAbility: 'dex' },
  bronze: { type: 'lightning', area: '5 by 30 ft line', targetAbility: 'dex' },
  copper: { type: 'acid', area: '5 by 30 ft line', targetAbility: 'dex' },
  gold: { type: 'fire', area: '15 ft cone', targetAbility: 'dex' },
  green: { type: 'poison', area: '15 ft cone', targetAbility: 'con' },
  red: { type: 'fire', area: '15 ft cone', targetAbility: 'dex' },
  silver: { type: 'cold', area: '15 ft cone', targetAbility: 'con' },
  white: { type: 'cold', area: '15 ft cone', targetAbility: 'con' },
};

function linkDraconicAncestry(col: Collector): void {
  const raceName = col.doc.race?.name.toLowerCase() ?? '';
  if (!raceName.includes('dragonborn')) return;
  // The ancestry color lives in the subrace name (2014 PHB) or the race name
  // itself (2024 XPHB versioned races like "Dragonborn (Blue)").
  const hay = `${raceName} ${col.doc.subrace?.name.toLowerCase() ?? ''}`;
  const color = hay.match(/\b(black|blue|brass|bronze|copper|gold|green|red|silver|white)\b/)?.[1];
  const ancestry = color !== undefined ? DRACONIC_ANCESTRY[color] : undefined;
  if (ancestry === undefined) return;
  // 2024 breath weapon is a DEX save and the player picks cone or line each
  // use; 2014 fixes the shape and save per ancestry.
  const is2024 = col.doc.rulesVersion === '2024';
  const eitherShape = `${ancestry.type} · 15 ft cone or 30 ft line`;
  const note = is2024 ? eitherShape : `${ancestry.type} · ${ancestry.area}`;
  const targetAbility = is2024 ? ('dex' as const) : ancestry.targetAbility;
  for (const e of col.effects) {
    if (e.kind === 'action' && e.label.toLowerCase() === 'breath weapon') {
      // Fill only gaps: a prose-scanned FTD variant already carries the correct
      // (often different — e.g. a chromatic LINE where this table says cone)
      // damage type, area, and save, and must not be overwritten. A note holding
      // only the type this table already knows still has a gap, and that means
      // the XPHB printing: it names the type but lets the player pick the shape
      // ("in either a 15-foot cone or a 30-foot line"), which the scanner does
      // not read as one area. That holds on a character switched to 2014 rules,
      // who keeps the race.
      if (e.note === undefined) e.note = note;
      else if (e.note === ancestry.type) e.note = eitherShape;
      if (e.save?.dcAbility === undefined) e.save = { targetAbility, ...e.save, dcAbility: 'con' };
    }
  }
}

export function collectRace(col: Collector): void {
  const { race, subrace } = raceEntity(col);
  if (race !== undefined && col.doc.race !== undefined) {
    const origin: EffectOrigin = {
      label: str(race.name) ?? col.doc.race.name,
      uid: refUid(col.doc.race),
      type: 'race',
    };
    // A Dragonborn ancestry's fixed resistance replaces the race's choice here.
    // Only a subrace of this race reshapes it: two races can each have a
    // subrace of the same name and source, and the lookup above can return
    // the other one.
    const own =
      subrace !== undefined && subraceOf(subrace, col.doc.race)
        ? raceUnderSubrace(race, subrace)
        : race;
    collectFrom(col, own, origin, `race:${origin.uid}`);
    // A subrace that replaces every trait (Keldon's Human) leaves no card.
    const emptied = Array.isArray(own.entries) && own.entries.length === 0 && own !== race;
    if (!emptied) col.features.push({ name: origin.label, origin, entries: own.entries });
  }
  if (subrace !== undefined && col.doc.subrace !== undefined) {
    const origin: EffectOrigin = {
      label: str(subrace.name) ?? col.doc.subrace.name,
      uid: refUid(col.doc.subrace),
      type: 'race',
    };
    collectFrom(col, subrace, origin, `subrace:${origin.uid}`);
    if (subrace.entries !== undefined) {
      col.features.push({ name: origin.label, origin, entries: subrace.entries });
    }
  }
  linkDraconicAncestry(col);
}
