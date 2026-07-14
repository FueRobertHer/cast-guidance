import { emitCuratedEffects } from '../curated/curatedEffects';
import { type DataEntity, type EffectOrigin, refUid, SKILLS } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, num, str } from './base';
import { proseScanFeature } from './proseScan';
import {
  expertiseOptions,
  genericOptions,
  languageOptions,
  readAbilityBlock,
  readProficiencyList,
  readResistList,
  skillOptions,
  toolOptions,
} from './readers';

/** Collect one feat entity. `instanceId` keeps repeatable feats' choices apart. */
export function collectFeatEntity(
  col: Collector,
  e: DataEntity,
  uid: string,
  instanceId: string,
): void {
  const origin: EffectOrigin = { label: str(e.name) ?? uid, uid, type: 'feat' };
  const idBase = `feat:${uid}:${instanceId}`;

  readAbilityBlock(col, e.ability, origin, `${idBase}:ability`);
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

  // expertise: [{ anyProficientSkill: 1 }] — options limited at prompt-render
  // time is complex; offer all skills and validate visually via prof dots.
  for (const entry of asEntityArray(e.expertise)) {
    const count = num(entry.anyProficientSkill) ?? num(entry.any) ?? 0;
    if (count > 0) {
      col.choice(
        {
          id: `${idBase}:expertise`,
          origin,
          kind: 'expertise',
          label: 'Expertise',
          count,
          options: expertiseOptions(col),
        },
        (selected) => {
          for (const s of selected) col.add({ kind: 'skillProf', skill: s, level: 2, origin });
        },
      );
    }
    for (const [key, value] of Object.entries(entry)) {
      if (value === true) {
        const skill = SKILLS.find((s) => s.name.toLowerCase() === key.toLowerCase());
        if (skill) col.add({ kind: 'skillProf', skill: skill.name, level: 2, origin });
      }
    }
  }

  const senses = asEntityArray(e.senses);
  for (const s of senses) {
    for (const [key, value] of Object.entries(s)) {
      if (typeof value === 'number') col.add({ kind: 'sense', sense: key, range: value, origin });
    }
  }

  collectAdditionalSpells(col, e.additionalSpells, origin);

  col.features.push({ name: origin.label, origin, entries: e.entries });
  if (!emitCuratedEffects(col, uid, origin)) {
    proseScanFeature(col, origin.label, e.entries, origin);
  }
}

export function collectFeats(col: Collector): void {
  for (const { ref, instanceId } of col.doc.feats) {
    const e = col.ctx.get('feat', ref.name, ref.source);
    if (e === undefined) {
      col.warn(`Feat not found: ${refUid(ref)}`);
      continue;
    }
    collectFeatEntity(col, e, refUid(ref), instanceId);
  }
}
