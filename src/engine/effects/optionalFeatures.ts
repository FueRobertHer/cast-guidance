/**
 * Optional features a class or a feat lets a character pick: invocations,
 * maneuvers, fighting styles, metamagic. Both write them the same way in
 * `optionalfeatureProgression`, and a pick works the same from either.
 */
import { emitCuratedEffects as emitCurated } from '../curated/curatedEffects';
import { linkSpend } from '../curated/spendLinks';
import { summarizeEntries } from '../summarize';
import type { DataEntity, EffectOrigin } from '../types';
import { asEntityArray, type Collector, str } from './base';
import {
  buildPrereqContext,
  meetsPrerequisite,
  requiredLevel,
  summarizePrerequisite,
} from './prerequisites';
import { proseScanFeature } from './proseScan';

/**
 * How many picks a progression gives by `level`: an array indexed by level-1, or
 * levels as keys ({"1": 1, "10": 2}), where a feat's "*" means at any level.
 */
function progressionCount(progression: unknown, level: number): number {
  let count = 0;
  if (Array.isArray(progression)) {
    for (let lvl = 0; lvl < Math.min(level, progression.length); lvl++) {
      const v = progression[lvl];
      if (typeof v === 'number') count = Math.max(count, v);
    }
  } else if (typeof progression === 'object' && progression !== null) {
    for (const [key, v] of Object.entries(progression)) {
      const lvl = key === '*' ? 0 : Number.parseInt(key, 10);
      if (!Number.isNaN(lvl) && lvl <= level && typeof v === 'number') {
        count = Math.max(count, v);
      }
    }
  }
  return count;
}

export interface OptionalFeatureSource {
  /** What the prompt id builds on. */
  idBase: string;
  origin: EffectOrigin;
  /** The level that decides picks by count and options by their level prerequisite. */
  level: number;
  /** Options another pick of the character holds cannot be picked (see `markHeldPicks`). */
  distinct?: boolean;
  /** Why an option cannot be taken, ahead of the level check. */
  blocked?: (option: DataEntity) => string | undefined;
}

/** One prompt per progression in `entity`, whose picks add feature cards and their effects. */
export function readOptionalFeatures(
  col: Collector,
  entity: DataEntity,
  { idBase, origin, level, distinct, blocked }: OptionalFeatureSource,
): void {
  for (const prog of asEntityArray(entity.optionalfeatureProgression)) {
    const name = str(prog.name) ?? 'Optional feature';
    const featureTypes = Array.isArray(prog.featureType) ? prog.featureType.map(String) : [];
    const count = progressionCount(prog.progression, level);
    if (count === 0) continue;

    const prereqCtx = buildPrereqContext(col);
    const options = col.ctx
      .byType('optionalfeature')
      .filter((of) => {
        const types = Array.isArray(of.featureType) ? of.featureType.map(String) : [];
        return types.some((t) => featureTypes.includes(t));
      })
      .map((of) => {
        const prereq = summarizePrerequisite(of.prerequisite);
        const summary = summarizeEntries(of.entries);
        // Level is deterministic from the source, so disable options the
        // character can't take yet. Other gates (ability/race/feat/proficiency/
        // spellcasting) are advisory: flag them but keep the option selectable.
        const need = requiredLevel(of.prerequisite);
        const reason =
          blocked?.(of) ??
          (need !== undefined && level < need ? `Requires level ${need}` : undefined);
        const disabled = reason !== undefined ? { reason } : undefined;
        const unmet =
          disabled === undefined && prereq !== '' && !meetsPrerequisite(of.prerequisite, prereqCtx);
        return {
          id: `${str(of.name)}|${str(of.source)}`.toLowerCase(),
          label: `${str(of.name)} (${str(of.source)})`,
          description: prereq !== '' ? `Prereq: ${prereq}. ${summary}` : summary,
          ...(disabled !== undefined
            ? { disabled }
            : unmet
              ? { advisory: 'You may not meet this prerequisite.' }
              : {}),
        };
      });

    col.choice(
      {
        id: `${idBase}:optfeature:${featureTypes.join('+')}`,
        origin,
        kind: 'optionalfeature',
        label: name,
        count,
        ...(distinct === true ? { distinct } : {}),
        options,
      },
      (selected) => {
        for (const uid of selected) {
          const [ofName, ofSource] = uid.split('|');
          const of =
            ofName !== undefined ? col.ctx.get('optionalfeature', ofName, ofSource) : undefined;
          if (of === undefined) {
            col.warn(`Optional feature not found: ${uid}`);
            continue;
          }
          const ofOrigin: EffectOrigin = {
            label: `${name}: ${str(of.name) ?? uid}`,
            uid,
            type: origin.type,
          };
          col.features.push({ name: ofOrigin.label, origin: ofOrigin, entries: of.entries });
          if (!emitCurated(col, uid, ofOrigin)) {
            proseScanFeature(col, str(of.name) ?? uid, of.entries, ofOrigin);
          }
          linkSpend(col, uid, str(of.name) ?? uid, ofOrigin);
        }
      },
    );
  }
}
