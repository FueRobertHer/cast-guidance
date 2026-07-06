import { type DataEntity, type EffectOrigin, refUid } from '../types';
import { type Collector, num, str } from './base';
import {
  genericOptions,
  readAbilityBlock,
  readProficiencyList,
  readResistList,
  skillOptions,
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
    (from) => (from !== undefined && from.length > 0 ? genericOptions(from) : LANGUAGE_OPTIONS),
  );
  readProficiencyList(
    col,
    e.toolProficiencies,
    origin,
    `${idBase}:tool`,
    'tool',
    'Tool proficiency',
    (name) => col.add({ kind: 'toolProf', name, origin }),
    genericOptions,
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
  readResistList(col, e.resist, origin, `${idBase}:resist`);

  if (e.additionalSpells !== undefined) {
    col.add({
      kind: 'note',
      text: 'Grants innate spells — see the racial trait text. (Automated in M4.)',
      origin,
    });
  }
}

const LANGUAGE_OPTIONS = [
  'Common',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
  'Abyssal',
  'Celestial',
  'Draconic',
  'Deep Speech',
  'Infernal',
  'Primordial',
  'Sylvan',
  'Undercommon',
].map((l) => ({ id: l, label: l }));

export function collectRace(col: Collector): void {
  const { race, subrace } = raceEntity(col);
  if (race !== undefined && col.doc.race !== undefined) {
    const origin: EffectOrigin = {
      label: str(race.name) ?? col.doc.race.name,
      uid: refUid(col.doc.race),
      type: 'race',
    };
    collectFrom(col, race, origin, `race:${origin.uid}`);
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
}
