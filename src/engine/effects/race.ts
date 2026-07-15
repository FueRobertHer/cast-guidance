import { emitCuratedTrait } from '../curated/curatedEffects';
import { type Ability, type DataEntity, type EffectOrigin, refUid } from '../types';
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

function collectFrom(
  col: Collector,
  e: DataEntity,
  origin: EffectOrigin,
  idBase: string,
  predeterminedResists: readonly string[] = [],
): void {
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
    genericOptions,
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
  readResistList(col, e.resist, origin, `${idBase}:resist`, predeterminedResists);
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
 * the 2024 XPHB race states a save but not a concrete damage type). Printings
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
  const note = is2024
    ? `${ancestry.type} · 15 ft cone or 30 ft line`
    : `${ancestry.type} · ${ancestry.area}`;
  const targetAbility = is2024 ? ('dex' as const) : ancestry.targetAbility;
  for (const e of col.effects) {
    if (e.kind === 'action' && e.label.toLowerCase() === 'breath weapon') {
      // Fill only gaps: a prose-scanned FTD variant already carries the correct
      // (often different — e.g. a chromatic LINE where this table says cone)
      // damage type, area, and save, and must not be overwritten.
      if (e.note === undefined) e.note = note;
      if (e.save === undefined) e.save = { targetAbility, dcAbility: 'con' };
    }
  }
}

export function collectRace(col: Collector): void {
  const { race, subrace } = raceEntity(col);
  // Resistances the subrace fixes outright (a Dragonborn ancestry's damage
  // type) pre-answer any matching "choose a resistance" on the base race.
  const subraceResists = Array.isArray(subrace?.resist)
    ? subrace.resist.filter((r): r is string => typeof r === 'string')
    : [];
  if (race !== undefined && col.doc.race !== undefined) {
    const origin: EffectOrigin = {
      label: str(race.name) ?? col.doc.race.name,
      uid: refUid(col.doc.race),
      type: 'race',
    };
    collectFrom(col, race, origin, `race:${origin.uid}`, subraceResists);
    col.features.push({ name: origin.label, origin, entries: race.entries });
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
