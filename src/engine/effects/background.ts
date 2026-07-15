import { type EffectOrigin, refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, str } from './base';
import { collectFeatEntity } from './feat';
import {
  languageOptions,
  readAbilityBlock,
  readProficiencyList,
  skillOptions,
  toolOptions,
} from './readers';

export function collectBackground(col: Collector): void {
  const ref = col.doc.background;
  if (ref === undefined) return;
  const e = col.ctx.get('background', ref.name, ref.source);
  if (e === undefined) {
    col.warn(`Background not found: ${refUid(ref)}`);
    return;
  }
  const origin: EffectOrigin = {
    label: str(e.name) ?? ref.name,
    uid: refUid(ref),
    type: 'background',
  };
  const idBase = `background:${origin.uid}`;

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

  // Some backgrounds grant innate/always-prepared spells or widen a spell list
  // (e.g. Strixhaven student backgrounds' spell-level-keyed `expanded` lists);
  // without this those grants and notes were silently dropped.
  collectAdditionalSpells(col, e.additionalSpells, origin);

  // XPHB (2024) backgrounds: weighted ability bonuses + an origin feat.
  readAbilityBlock(col, e.ability, origin, `${idBase}:ability`);
  for (const featEntry of asEntityArray(e.feats)) {
    for (const [key, value] of Object.entries(featEntry)) {
      if (value === true && key.includes('|')) {
        const [name, source] = key.split('|');
        if (name !== undefined && source !== undefined) {
          collectGrantedFeat(col, name, source, origin);
        }
      } else if (key === 'any' || key === 'anyFromCategory') {
        col.add({
          kind: 'note',
          text: 'Grants an origin feat of your choice — pick it in the Feats step.',
          origin,
        });
      }
    }
  }

  col.features.push({ name: origin.label, origin, entries: e.entries });
}

/** Feats granted by name (background origin feats) — collected inline. */
function collectGrantedFeat(
  col: Collector,
  name: string,
  source: string,
  parentOrigin: EffectOrigin,
): void {
  const e = col.ctx.get('feat', name, source);
  if (e === undefined) {
    col.warn(`Origin feat not found: ${name}|${source}`);
    return;
  }
  collectFeatEntity(col, e, `${name}|${source}`.toLowerCase(), parentOrigin.uid);
}
