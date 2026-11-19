/**
 * What a weapon's damage prompt says and offers beside the weapon's own dice
 * (`stores/heldRoll` `DamageAsk`): the modifiers in words, and what the
 * character may add to a hit. Pure: the sheet turns each add into an extra
 * with what paying for it does.
 */
import type { RollEffects } from '@/engine/playRules';
import { type AttackRow, type DerivedSheet, SLOT_COST } from '@/engine/types';
import { signed } from '@/lib/signed';
import { findFeatureInfo } from '@/ui/FeatureInfoSheet';

type Action = DerivedSheet['actions'][number];

/** Every string in a feature's entries, joined: the text the rules below read. */
export function entriesText(entries: unknown): string {
  if (typeof entries === 'string') return entries;
  if (Array.isArray(entries)) return entries.map(entriesText).join(' ');
  if (entries !== null && typeof entries === 'object') {
    const o = entries as { entries?: unknown; items?: unknown; entry?: unknown };
    return [entriesText(o.entries), entriesText(o.items), entriesText(o.entry)].join(' ');
  }
  return '';
}

/**
 * Does the text hold its feature to once a turn ("Once per turn", "once on
 * each of your turns", "only once per turn")? Sneak Attack, Divine Strike and
 * Colossus Slayer do; Divine Smite does not.
 */
export function oncePerTurn(text: string): boolean {
  return /\bonce (?:per turn|each turn|on (?:each of )?your turns?|during (?:each of )?your turns?)\b/i.test(
    text,
  );
}

/**
 * The weapons a feature's damage needs, from its text: a finesse or ranged
 * weapon (Sneak Attack), a melee weapon attack (2014 Divine Smite), or any.
 */
export function weaponNeed(text: string): 'finesseOrRanged' | 'melee' | 'any' {
  if (/\bfinesse or (?:a )?ranged weapon\b/i.test(text)) return 'finesseOrRanged';
  if (/\bmelee weapon\b/i.test(text) && !/\branged\b/i.test(text)) return 'melee';
  return 'any';
}

/** Does an attack row meet what a feature's damage needs? */
function meets(need: ReturnType<typeof weaponNeed>, a: AttackRow): boolean {
  if (need === 'finesseOrRanged') return a.ranged === true || a.properties.includes('finesse');
  if (need === 'melee') return a.ranged !== true;
  return true;
}

/** The flat modifiers of a damage expression ("1d8+3" is 3). */
function flatOf(expr: string): number {
  const terms = expr.replace(/\s+/g, '').match(/[+-]?[^+-]+/g) ?? [];
  return terms.reduce((n, t) => (/d/i.test(t) ? n : n + (Number(t) || 0)), 0);
}

/**
 * What a weapon's damage modifiers are, in words: "STR +3 · Magic +1 · Rage
 * +2". The ability's and the weapon's own bonus come first, then what effects
 * and features add (`damageFrom`), together. '' for a custom attack, whose
 * number the player typed.
 */
export function damageParts(
  a: AttackRow,
  expr: string,
  abilities: DerivedSheet['abilities'],
): string {
  if (a.ability === undefined) return '';
  const mod = abilities[a.ability].mod;
  const magic = a.toHit.parts.find((p) => p.label === 'Magic bonus')?.amount ?? 0;
  const rest = flatOf(expr) - mod - magic;
  const from = a.damageFrom ?? [];
  const parts = [`${a.ability.toUpperCase()} ${signed(mod)}`];
  if (magic !== 0) parts.push(`Magic ${signed(magic)}`);
  if (from.length > 0 && rest !== 0) {
    const names =
      from.length < 2 ? from.join('') : `${from.slice(0, -1).join(', ')} and ${from.at(-1)}`;
    parts.push(`${names} ${signed(rest)}`);
  }
  return parts.join(' · ');
}

/** Something the character may add to a weapon's hit, before the sheet prices it. */
export interface DamageAdd {
  /** What marks it used this turn: the action's row key, or the effect's id. */
  key: string;
  source: string;
  /** Its dice: none for one paid with a slot, whose dice the tile picked sets. */
  dice?: string;
  /** `action`: a damage action (Sneak Attack); `slot`: one paid with a slot (2014 Divine Smite); `effect`: a die an effect in play gives (Bardic Inspiration). */
  kind: 'action' | 'slot' | 'effect';
  oncePerTurn: boolean;
  /** When it holds, which the app cannot see. */
  note?: string;
  /** The action it is, for `action` and `slot`. */
  action?: Action;
  /** The effect it spends, for `effect`. */
  effectId?: string;
}

/** An action's row key on the Play tab, which its Use and the damage prompt both mark. */
export function actionKey(a: Pick<Action, 'origin' | 'label' | 'economy'>): string {
  return `${a.origin}:${a.label}:${a.economy}`;
}

/** Combat Inspiration, the College of Valor's: a Bardic Inspiration die on a weapon's damage. */
const VALOR_NOTE = 'only from a College of Valor bard (Combat Inspiration)';

/**
 * What the character may add to a hit with the weapon `a`: their damage
 * actions with no save (Sneak Attack, Divine Strike), those paid with a spell
 * slot (2014 Divine Smite), and a Bardic Inspiration die in play, which a
 * College of Valor bard's lets them add to damage. An action whose text needs
 * a finesse or ranged weapon, or a melee weapon attack, is offered only on one.
 * `offers` are the one-use dice the effects in play bring to the attack.
 */
export function damageAdds(
  sheet: Pick<DerivedSheet, 'actions' | 'features'>,
  a: AttackRow,
  offers: RollEffects['offers'],
): DamageAdd[] {
  const out: DamageAdd[] = [];
  for (const act of sheet.actions) {
    if (act.save !== undefined || act.heals === true || act.plainDice === true) continue;
    const slotDice = act.cost?.resource === SLOT_COST ? act.cost.slotDice : undefined;
    const bySlot = slotDice !== undefined && slotDice.heals !== true && slotDice.plain !== true;
    if (act.roll === undefined && !bySlot) continue;
    const text = entriesText(findFeatureInfo(sheet.features, act.label, act.origin)?.entries);
    if (!meets(weaponNeed(text), a)) continue;
    out.push({
      key: actionKey(act),
      source: act.label,
      ...(bySlot || act.roll === undefined ? {} : { dice: act.roll }),
      kind: bySlot ? 'slot' : 'action',
      oncePerTurn: oncePerTurn(text),
      action: act,
    });
  }
  for (const o of offers) {
    if (!o.once || o.effectId === undefined || o.source !== 'Bardic Inspiration') continue;
    out.push({
      key: o.effectId,
      source: o.source,
      dice: o.dice,
      kind: 'effect',
      oncePerTurn: false,
      note: VALOR_NOTE,
      effectId: o.effectId,
    });
  }
  return out;
}
