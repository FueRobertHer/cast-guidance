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
  /** More dice against some creatures (2014 Divine Smite's d8 against a fiend or undead). */
  against?: { dice: string; who: string };
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
      ...(bySlot && againstOf(text) !== undefined ? { against: againstOf(text) } : {}),
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

/** The damage types a spell's text names after its dice. */
const DAMAGE_TYPE =
  /^\s*(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b/i;

/** The sentences of a spell's text, its higher-level text aside. */
function sentencesOf(entries: unknown): string[] {
  return entriesText(entries)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** The first `{@damage X}` in a sentence: its dice, and the type named after it. */
function damageIn(sentence: string): { dice: string; damageType?: string } | undefined {
  const m = /\{@damage ([^}|]+)(?:\|[^}]*)?\}(.*)$/i.exec(sentence);
  const dice = m?.[1]?.replaceAll(' ', '').replace(/^d/i, '1d');
  if (dice === undefined) return undefined;
  const type = DAMAGE_TYPE.exec(m?.[2] ?? '')?.[1]?.toLowerCase();
  return type === undefined ? { dice } : { dice, damageType: type };
}

/** More dice against some creatures: Divine Smite's d8 against a Fiend or an Undead. */
export function againstOf(text: string): { dice: string; who: string } | undefined {
  const m =
    /\bincreases by (?:\{@damage )?(\d*d\d+)\}?[^.]*?\b(?:an? )?(undead or a fiend|fiend or (?:an )?undead)\b/i.exec(
      text,
    );
  if (m?.[1] === undefined) return undefined;
  return { dice: m[1].replace(/^d/i, '1d'), who: 'a Fiend or Undead' };
}

/** A spell that adds damage to a weapon's hit. */
export interface HitSpell {
  /**
   * `cast`: cast as the hit lands (a 2024 smite, the 2024 Divine Smite).
   * `running`: adds while the character concentrates on it (Hex, Hunter's
   * Mark, a 2014 smite cast before the attack).
   */
  how: 'cast' | 'running';
  /** It adds to every hit while it runs (Hex), not the next one alone (a 2014 smite). */
  every: boolean;
  /**
   * On to start: it runs on the character (Divine Favor) or on the target
   * they marked (Hex). One bound to a weapon or an ally (Holy Weapon) is
   * theirs to put on.
   */
  on: boolean;
  /** The weapons it needs: a melee weapon or an Unarmed Strike, a ranged one, or any. */
  need: 'melee' | 'ranged' | 'any';
  /** Its on-hit dice at its own level, and the type the text names. */
  dice: string;
  damageType?: string;
  /** More dice against some creatures (Divine Smite's d8 against a Fiend or Undead). */
  against?: { dice: string; who: string };
  /** When it holds, which the app cannot see: "Only against the spell's target". */
  note?: string;
}

/**
 * Does a spell add damage to a weapon's hit, and how? Cast as the hit lands
 * when its casting time says so (2024: "which you take immediately after
 * hitting a target"), or while `running` (the character concentrates on it)
 * when a sentence of its text deals "extra" damage on a hit. A spell whose
 * extra damage comes later, or to others, adds none (Ensnaring Strike, Hail of
 * Thorns).
 */
export function hitSpell(entity: unknown, running: boolean): HitSpell | undefined {
  if (entity === null || typeof entity !== 'object') return undefined;
  const e = entity as { time?: unknown; entries?: unknown; range?: unknown };
  const time = Array.isArray(e.time)
    ? (e.time[0] as { condition?: unknown } | undefined)
    : undefined;
  const condition = typeof time?.condition === 'string' ? time.condition : '';
  const castOnHit = /\bimmediately after hitting\b/i.test(condition);
  if (!castOnHit && !running) return undefined;
  const sentences = sentencesOf(e.entries);
  const hit = sentences.find(
    (s) =>
      /\bextra\b/i.test(s) &&
      /\{@damage /i.test(s) &&
      (castOnHit || /\b(?:hit|hits|attack|attacks)\b/i.test(s)),
  );
  const damage = hit === undefined ? undefined : damageIn(hit);
  if (hit === undefined || damage === undefined) return undefined;
  const reach = castOnHit ? condition : hit;
  const need = /\bmelee\b/i.test(reach) ? 'melee' : /\branged\b/i.test(reach) ? 'ranged' : 'any';
  const text = sentences.join(' ');
  const against = againstOf(text);
  if (castOnHit) {
    return {
      how: 'cast',
      every: false,
      on: false,
      need,
      ...damage,
      ...(against ? { against } : {}),
    };
  }
  const every = !/\bnext time\b/i.test(hit);
  const range = e.range as { distance?: { type?: unknown } } | undefined;
  const self = range?.distance?.type === 'self';
  const marked = /\bto the target whenever you hit it\b/i.test(hit);
  const near = /\bwithin (\d+) feet of you\b/i.exec(hit)?.[1];
  const note = marked
    ? "Only against the spell's target"
    : near !== undefined
      ? `Only against a creature within ${near} feet of you`
      : undefined;
  return {
    how: 'running',
    every,
    on: every && (self || marked),
    need,
    ...damage,
    ...(against ? { against } : {}),
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * A feat that changes a weapon's damage, read from its text:
 * - `power`: a −5 to hit for +10 damage, claimed in the attack prompt (2014
 *   Great Weapon Master with a heavy melee weapon, Sharpshooter with a ranged
 *   one), with a weapon the character is proficient with.
 * - `heavyMastery`: the Proficiency Bonus as extra damage with a Heavy weapon
 *   as part of the Attack action (2024 Great Weapon Master).
 * - `savage`: once a turn, the weapon's damage dice rolled twice and either
 *   used (Savage Attacker; 2014, melee weapon attacks only).
 */
export interface WeaponFeat {
  kind: 'power' | 'heavyMastery' | 'savage';
  source: string;
  need: 'heavyMelee' | 'heavy' | 'ranged' | 'melee' | 'any';
  /** Decided once the damage shows (2014 Savage Attacker's reroll), not before it is rolled. */
  after?: true;
}

/** The feats among the character's features that change a weapon's damage. */
export function weaponFeats(features: readonly { name: string; entries: unknown }[]): WeaponFeat[] {
  const out: WeaponFeat[] = [];
  for (const f of features) {
    const text = entriesText(f.entries);
    const source = f.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (
      /[-−]\s?5 penalty to the attack roll/i.test(text) &&
      /\+10 to the attack's damage/i.test(text)
    ) {
      const need = /\bheavy weapon\b/i.test(text)
        ? 'heavyMelee'
        : /\branged weapon\b/i.test(text)
          ? 'ranged'
          : 'any';
      out.push({ kind: 'power', source, need });
    } else if (
      /\bheavy\b/i.test(text) &&
      /\bextra damage (?:equals|equal to) your proficiency bonus\b/i.test(text)
    ) {
      out.push({ kind: 'heavyMastery', source, need: 'heavy' });
    }
    if (/\b(?:roll|reroll) the weapon's damage dice(?: twice)? and use either\b/i.test(text)) {
      // 2014 rerolls once the damage shows; 2024 rolls twice as it is made.
      const reroll = /\breroll the weapon's damage dice\b/i.test(text);
      out.push({
        kind: 'savage',
        source,
        need: weaponNeed(text) === 'melee' ? 'melee' : 'any',
        ...(reroll ? { after: true as const } : {}),
      });
    }
  }
  return out;
}

/** Does a weapon feat reach this attack: its weapon, and for a −5 claim the character's proficiency? */
export function featReaches(f: WeaponFeat, a: AttackRow): boolean {
  const heavy = a.properties.includes('heavy');
  if (f.kind === 'power' && !a.toHit.parts.some((p) => p.label === 'Proficiency')) return false;
  switch (f.need) {
    case 'heavyMelee':
      return heavy && a.ranged !== true;
    case 'heavy':
      return heavy;
    case 'ranged':
      return a.ranged === true;
    case 'melee':
      return a.ranged !== true;
    default:
      return true;
  }
}

/**
 * A spell that, once cast, puts extra damage on the character's weapon hits
 * for its duration with no concentration to hold (2024 Divine Favor: "your
 * attacks with weapons deal an extra 1d4 Radiant damage on a hit"): its dice,
 * their type, and how many minutes it lasts. A concentration spell adds while
 * it is held instead (`hitSpell`).
 */
export function castBuff(
  entity: unknown,
): { dice: string; damageType?: string; minutes?: number } | undefined {
  if (entity === null || typeof entity !== 'object') return undefined;
  const e = entity as { entries?: unknown; range?: unknown; duration?: unknown };
  const duration = Array.isArray(e.duration)
    ? (e.duration[0] as
        | { concentration?: unknown; duration?: { type?: unknown; amount?: unknown } }
        | undefined)
    : undefined;
  if (duration?.concentration === true) return undefined;
  const range = e.range as { distance?: { type?: unknown } } | undefined;
  if (range?.distance?.type !== 'self') return undefined;
  const sentence = sentencesOf(e.entries).find(
    (s) =>
      /\buntil the spell ends\b/i.test(s) &&
      /\bextra\b/i.test(s) &&
      /\bweapons?\b/i.test(s) &&
      /\bhits?\b/i.test(s) &&
      /\{@damage /i.test(s),
  );
  const damage = sentence === undefined ? undefined : damageIn(sentence);
  if (damage === undefined) return undefined;
  const amount = typeof duration?.duration?.amount === 'number' ? duration.duration.amount : 1;
  const unit = duration?.duration?.type;
  const minutes = unit === 'minute' ? amount : unit === 'hour' ? amount * 60 : undefined;
  return { ...damage, ...(minutes === undefined ? {} : { minutes }) };
}
