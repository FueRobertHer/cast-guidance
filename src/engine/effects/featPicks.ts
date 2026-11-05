/**
 * The feat picks that need more than a generic reader. A few feats ask for a pick
 * only in their prose, with no field in the data, so a table names them. Those
 * picks change no number on the sheet, so the feat's card says what was picked.
 */
import type { ChoiceOption, ChoicePrompt, DataEntity, EffectOrigin } from '../types';
import { type Collector, str } from './base';
import { readOptionalFeatures } from './optionalFeatures';
import { weaponMasteryOptions } from './readers';

const DAMAGE_TYPES: ChoiceOption[] = ['Acid', 'Cold', 'Fire', 'Lightning', 'Thunder'].map(
  (label) => ({ id: label.toLowerCase(), label }),
);
const CASTING_ABILITIES: ChoiceOption[] = ['int', 'wis', 'cha'].map((id) => ({
  id,
  label: id.toUpperCase(),
}));

type ProsePick = 'damageType' | 'weaponMastery' | 'castingAbility';

const PROSE_PICKS: Record<string, ProsePick> = {
  'elemental adept|phb': 'damageType',
  'elemental adept|xphb': 'damageType',
  'weapon master|xphb': 'weaponMastery',
  'eldritch adept|tce': 'castingAbility',
};

/** Feats whose prose lets them be taken again where the data has no `repeatable`. */
const REPEATABLE_IN_PROSE = new Set(['elemental adept|phb']);

/** Feats whose options with a prerequisite are only for a member of this class. */
const PREREQUISITES_NEED_CLASS: Record<string, string> = { 'eldritch adept|tce': 'warlock' };

/** Whether a feat can be taken more than once, by its data or by its prose. */
export function isRepeatableFeat(e: DataEntity): boolean {
  return (
    e.repeatable === true ||
    REPEATABLE_IN_PROSE.has(`${str(e.name)}|${str(e.source)}`.toLowerCase())
  );
}

type Offer = Pick<ChoicePrompt, 'kind' | 'label' | 'options' | 'distinct'>;

function offerFor(col: Collector, pick: ProsePick, origin: EffectOrigin): Offer {
  switch (pick) {
    case 'damageType':
      return { kind: 'damageType', label: 'Damage type', distinct: true, options: DAMAGE_TYPES };
    case 'weaponMastery':
      return { kind: 'generic', label: 'Weapon mastery', options: weaponMasteryOptions(col.ctx) };
    case 'castingAbility':
      return {
        kind: 'ability',
        label: `${origin.label}: spellcasting ability`,
        options: CASTING_ABILITIES,
      };
  }
}

/**
 * The prompt for a pick only the prose asks for, if this feat has one. Returns
 * what was picked, for its card, once it has been.
 */
export function readProsePick(
  col: Collector,
  uid: string,
  origin: EffectOrigin,
  idBase: string,
): string | undefined {
  const pick = PROSE_PICKS[uid];
  if (pick === undefined) return undefined;
  const offer = offerFor(col, pick, origin);
  let shown: string | undefined;
  col.choice({ ...offer, id: `${idBase}:${pick}`, origin, count: 1 }, (selected) => {
    shown = offer.options.find((o) => o.id === selected[0])?.label;
  });
  return shown;
}

/** A feat's optional feature picks, which must differ from any the character holds. */
export function readFeatOptionalFeatures(
  col: Collector,
  e: DataEntity,
  uid: string,
  origin: EffectOrigin,
  idBase: string,
): void {
  const needClass = PREREQUISITES_NEED_CLASS[uid];
  const levels = col.doc.classes.filter(
    (c) => needClass === undefined || c.ref.name.toLowerCase() === needClass,
  );
  const level = levels.reduce((sum, c) => sum + c.levels, 0);
  readOptionalFeatures(col, e, {
    idBase,
    origin,
    level,
    distinct: true,
    blocked: (option) =>
      needClass !== undefined && level === 0 && option.prerequisite !== undefined
        ? `Has a prerequisite, so only a ${needClass} who meets it can take this`
        : undefined,
  });
}
