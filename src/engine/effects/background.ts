import { type EffectOrigin, refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, num, str } from './base';
import { buildPrereqContext, featChoiceOption } from './class';
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
  collectAdditionalSpells(col, e.additionalSpells, origin, undefined, idBase);

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
        collectFreeFeatChoice(col, origin, `${idBase}:feat`, key, value);
      }
    }
  }

  col.features.push({ name: origin.label, origin, entries: e.entries });
}

/**
 * A background that grants a *free* origin feat ("any" / "anyFromCategory")
 * surfaces a real feat picker that persists to `doc.choices` and collects the
 * chosen feat — rather than a note pointing at a nonexistent "Feats step".
 * `anyFromCategory` narrows the list to a feat category (e.g. Origin feats);
 * `any` offers every feat. The pick's own prerequisites/sub-choices then follow
 * the feat's own rules, exactly like an ASI-chosen feat.
 */
function collectFreeFeatChoice(
  col: Collector,
  origin: EffectOrigin,
  choiceId: string,
  key: string,
  value: unknown,
): void {
  let category: string | undefined;
  let count = 1;
  if (key === 'anyFromCategory') {
    if (typeof value === 'string') {
      category = value;
    } else if (value !== null && typeof value === 'object') {
      category = str((value as { category?: unknown }).category);
      count = num((value as { count?: unknown }).count) ?? 1;
    }
  } else if (typeof value === 'number') {
    count = value; // "any": N
  }
  if (count < 1) count = 1;

  const prereqCtx = buildPrereqContext(col);
  const feats = col.ctx.byType('feat').filter((f) => {
    if (str(f.name) === undefined) return false;
    if (category === undefined) return true;
    return str(f.category)?.toLowerCase() === category.toLowerCase();
  });
  if (feats.length === 0) {
    col.warn(`${origin.label}: grants a free feat, but no matching feats are available.`);
    return;
  }

  col.choice(
    {
      id: choiceId,
      origin,
      kind: 'feat',
      label: `${origin.label}: choose a free feat`,
      count,
      options: feats.map((f) => {
        const uid = `${str(f.name)}|${str(f.source)}`.toLowerCase();
        const alreadyTaken = f.repeatable !== true && col.collectedFeats.has(uid);
        return featChoiceOption(f, prereqCtx, { taken: alreadyTaken });
      }),
    },
    (picked) => {
      for (const uid of picked) {
        const [name, source] = uid.split('|');
        const feat = name !== undefined ? col.ctx.get('feat', name, source) : undefined;
        if (feat === undefined) {
          col.warn(`Chosen feat not found: ${uid}`);
          continue;
        }
        collectFeatEntity(col, feat, uid, origin.uid);
      }
    },
  );
}

/** Feats granted by name (background origin feats) — collected inline. */
function collectGrantedFeat(
  col: Collector,
  name: string,
  source: string,
  parentOrigin: EffectOrigin,
): void {
  // 2024 origin-feat grants can lock a sub-choice with a "; option" suffix, e.g.
  // "magic initiate; cleric" (Acolyte), "; wizard" (Sage), "; druid" (Guide).
  // The registry is keyed by the base feat name, so strip the selector to
  // resolve the feat; without this the whole grant was lost as "not found".
  const [baseName = name, ...optionParts] = name.split(';');
  const featName = baseName.trim();
  const lockedOption = optionParts.join(';').trim();
  const e = col.ctx.get('feat', featName, source);
  if (e === undefined) {
    col.warn(`Origin feat not found: ${featName}|${source}`);
    return;
  }
  collectFeatEntity(col, e, `${featName}|${source}`.toLowerCase(), parentOrigin.uid);
  if (lockedOption !== '') {
    // Surface the locked sub-choice; the feat's own spell/option picks still
    // follow its rules (a full picker for those is tracked separately).
    col.add({
      kind: 'note',
      text: `${str(e.name) ?? featName}: locked to “${lockedOption}” by this origin.`,
      origin: parentOrigin,
    });
  }
}
