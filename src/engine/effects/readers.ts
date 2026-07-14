/**
 * Tolerant readers for the recurring 5etools proficiency/choose shapes:
 *   skillProficiencies: [{ athletics: true, choose: { from: [...], count: 2 }, any: 1 }]
 *   ability: [{ str: 2 }, { choose: { from: [...], count: 2, amount: 1 } }]
 *            [{ choose: { weighted: { from: [...], weights: [2, 1] } } }]
 */
import {
  ABILITIES,
  type Ability,
  type ChoiceOption,
  type ChoicePrompt,
  type EffectOrigin,
  SKILLS,
} from '../types';
import { asEntityArray, type Collector, num } from './base';

const SKILL_BY_LOWER = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s.name]));
const SKILL_ABILITY = new Map(SKILLS.map((s) => [s.name, s.ability]));

/** One-line "what is this for" per skill — decision support for new players. */
const SKILL_USES: Record<string, string> = {
  Acrobatics: 'balance, tumble, slip free',
  'Animal Handling': 'calm or direct animals',
  Arcana: 'recall magic, spells, planes',
  Athletics: 'climb, jump, swim, grapple',
  Deception: 'lie convincingly',
  History: 'recall lore and past events',
  Insight: 'read intentions, spot lies',
  Intimidation: 'threaten, coerce',
  Investigation: 'search for clues, deduce',
  Medicine: 'stabilize the dying, diagnose',
  Nature: 'recall terrain, plants, beasts',
  Perception: 'spot, hear, notice (most-rolled skill)',
  Performance: 'entertain a crowd',
  Persuasion: 'influence with tact',
  Religion: 'recall deities and rites',
  'Sleight of Hand': 'pick pockets, palm objects',
  Stealth: 'sneak, hide',
  Survival: 'track, forage, navigate',
};

function titleCase(s: string): string {
  // Word starts only after whitespace/start — keeps "smith's tools" from
  // becoming "Smith'S Tools".
  return s.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
}

export function skillOptions(from?: readonly unknown[]): ChoiceOption[] {
  const names =
    from !== undefined && from.length > 0
      ? from.map((f) => SKILL_BY_LOWER.get(String(f).toLowerCase()) ?? titleCase(String(f)))
      : SKILLS.map((s) => s.name);
  return names.map((n) => {
    const ability = SKILL_ABILITY.get(n);
    const uses = SKILL_USES[n];
    return {
      id: n,
      label: n,
      description:
        ability !== undefined
          ? `${ability.toUpperCase()}${uses !== undefined ? ` — ${uses}` : ''}`
          : undefined,
    };
  });
}

/** Options straight from the data's `from` list (tools, weapons, damage types…). */
export function genericOptions(from?: readonly unknown[]): ChoiceOption[] {
  return (from ?? []).map((f) => ({ id: String(f), label: titleCase(String(f)) }));
}

/** One-line "what is it" per tool the choice lists commonly offer. */
const TOOL_USES: Record<string, string> = {
  "thieves' tools": 'pick locks, disarm traps',
  "smith's tools": 'forge and repair metal gear',
  "carpenter's tools": 'build and repair wood',
  "alchemist's supplies": 'craft acids, fire, reagents',
  'herbalism kit': 'make potions of healing, antitoxin',
  "poisoner's kit": 'craft and apply poisons',
  'disguise kit': 'alter your appearance',
  'forgery kit': 'fake documents and seals',
  "navigator's tools": 'chart courses, avoid getting lost',
  "cartographer's tools": 'draw and read maps',
  "cook's utensils": 'prepare food on a rest',
  "tinker's tools": 'repair and improvise devices',
  "brewer's supplies": 'brew drinks; know purified water',
  "mason's tools": 'work stone',
  "painter's supplies": 'create art, spot forgeries',
};
const TOOL_CATEGORY: Array<[RegExp, string]> = [
  [/ tools$| supplies$| kit$| utensils$/, "artisan's tools"],
  [/ set$/, 'gaming set'],
  [/^dice set$/, 'gaming set'],
  [/instrument|lute|flute|drum|horn|pipes|viol|lyre|harp/, 'musical instrument'],
];

/** Tool proficiency options with a short use hint (falls back to category). */
export function toolOptions(from?: readonly unknown[]): ChoiceOption[] {
  return (from ?? []).map((f) => {
    const raw = String(f);
    const lower = raw.toLowerCase();
    const use = TOOL_USES[lower] ?? TOOL_CATEGORY.find(([re]) => re.test(lower))?.[1];
    return { id: raw, label: titleCase(raw), description: use };
  });
}

/** Standard + common exotic languages — the fallback for `any`/`anyStandard`. */
export const LANGUAGE_OPTIONS: ChoiceOption[] = [
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
  'Deep Speech',
  'Draconic',
  'Infernal',
  'Primordial',
  'Sylvan',
  'Undercommon',
].map((l) => ({ id: l, label: l }));

/** Language options: explicit `from` list when present, else the standard set. */
export function languageOptions(from?: readonly unknown[]): ChoiceOption[] {
  return from !== undefined && from.length > 0 ? genericOptions(from) : LANGUAGE_OPTIONS;
}

/** Expertise offers skills you're already proficient in (RAW), else all. */
export function expertiseOptions(col: Collector): ChoiceOption[] {
  const prof = col.proficientSkills();
  return prof.length > 0 ? prof.map((n) => ({ id: n, label: n })) : skillOptions();
}

/**
 * Generic reader for `*Proficiencies`-shaped arrays. Emits fixed grants via
 * `grant`, and prompts for `choose`/`any`/`anyStandard` entries.
 */
export function readProficiencyList(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  promptIdBase: string,
  kind: ChoicePrompt['kind'],
  label: string,
  grant: (name: string) => void,
  optionsFor: (from?: readonly unknown[]) => ChoiceOption[],
): void {
  const entries = asEntityArray(raw);
  let chooseIdx = 0;
  // Languages you already speak shouldn't be spent again — disable, don't hide,
  // so the list stays recognizable (Dragonborn + Acolyte can't re-pick Common).
  const withDupesDisabled = (options: ChoiceOption[]): ChoiceOption[] => {
    if (kind !== 'language') return options;
    const known = new Set(
      col.effects.filter((e) => e.kind === 'language').map((e) => e.name.toLowerCase()),
    );
    return options.map((o) =>
      known.has(o.id.toLowerCase())
        ? { ...o, disabled: { reason: `You already speak ${o.label}` } }
        : o,
    );
  };
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'choose') {
        const c = (value ?? {}) as { from?: unknown[]; count?: number };
        const id = `${promptIdBase}:${chooseIdx++}`;
        col.choice(
          {
            id,
            origin,
            kind,
            label,
            count: c.count ?? 1,
            options: withDupesDisabled(optionsFor(c.from)),
          },
          (selected) => {
            for (const s of selected) grant(s);
          },
        );
      } else if (key === 'any' || key === 'anyStandard' || key === 'anyLanguage') {
        const count = num(value) ?? 1;
        const id = `${promptIdBase}:${chooseIdx++}`;
        col.choice(
          { id, origin, kind, label, count, options: withDupesDisabled(optionsFor(undefined)) },
          (selected) => {
            for (const s of selected) grant(s);
          },
        );
      } else if (value === true) {
        grant(titleCase(key));
      } else if (typeof value === 'number' && key !== 'count') {
        // e.g. tool proficiencies with counts — treat as a grant
        grant(titleCase(key));
      }
    }
  }
}

function weightedOf(
  entry: Record<string, unknown>,
): { from: unknown[]; weights: number[] } | undefined {
  const c = entry.choose as { weighted?: { from?: unknown[]; weights?: number[] } } | undefined;
  if (c?.weighted === undefined) return undefined;
  return {
    from: (c.weighted.from ?? ABILITIES) as unknown[],
    weights: Array.isArray(c.weighted.weights) ? c.weighted.weights : [1],
  };
}

/** Race/feat `ability` blocks (2014 style) and XPHB background `ability`. */
export function readAbilityBlock(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  promptIdBase: string,
): void {
  let entries = asEntityArray(raw);
  let chooseIdx = 0;

  // XPHB style: multiple weighted-choose entries are ALTERNATIVE arrangements
  // ("+2/+1" OR "+1/+1/+1") — ask which arrangement first, then read only it.
  if (entries.length > 1 && entries.every((e) => weightedOf(e) !== undefined)) {
    const arrangements = entries.map(
      (e) => weightedOf(e) as { from: unknown[]; weights: number[] },
    );
    let picked: number | undefined;
    col.choice(
      {
        id: `${promptIdBase}:arrangement`,
        origin,
        kind: 'generic',
        label: 'Ability bonus arrangement',
        count: 1,
        options: arrangements.map((a, i) => ({
          id: String(i),
          label: a.weights.map((w) => `+${w}`).join(' / '),
        })),
      },
      (selected) => {
        const idx = Number.parseInt(selected[0] ?? '', 10);
        if (!Number.isNaN(idx) && idx >= 0 && idx < entries.length) picked = idx;
      },
    );
    if (picked === undefined) return; // arrangement not chosen yet
    const pickedEntry = entries[picked];
    entries = pickedEntry !== undefined ? [pickedEntry] : [];
    chooseIdx = picked; // keep follow-up prompt ids distinct per arrangement
  }

  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'choose') {
        const c = (value ?? {}) as {
          from?: unknown[];
          count?: number;
          amount?: number;
          weighted?: { from?: unknown[]; weights?: number[] };
        };
        if (c.weighted !== undefined) {
          const weights = Array.isArray(c.weighted.weights) ? c.weighted.weights : [1];
          const from = (c.weighted.from ?? ABILITIES) as unknown[];
          const id = `${promptIdBase}:w${chooseIdx++}`;
          col.choice(
            {
              id,
              origin,
              kind: 'abilityWeighted',
              label: `Ability bonuses (${weights.map((w) => `+${w}`).join(', ')})`,
              count: weights.length,
              options: from.map((a) => ({ id: String(a), label: String(a).toUpperCase() })),
            },
            (selected) => {
              selected.forEach((abil, i) => {
                const amount = weights[i];
                if (amount !== undefined && (ABILITIES as string[]).includes(abil)) {
                  col.add({ kind: 'abilityBonus', ability: abil as Ability, amount, origin });
                }
              });
            },
          );
        } else {
          const amount = c.amount ?? 1;
          const from = (c.from ?? ABILITIES) as unknown[];
          const id = `${promptIdBase}:c${chooseIdx++}`;
          col.choice(
            {
              id,
              origin,
              kind: 'ability',
              label: `+${amount} to ${c.count ?? 1} ability score${(c.count ?? 1) > 1 ? 's' : ''}`,
              count: c.count ?? 1,
              options: from.map((a) => ({ id: String(a), label: String(a).toUpperCase() })),
            },
            (selected) => {
              for (const abil of selected) {
                if ((ABILITIES as string[]).includes(abil)) {
                  col.add({ kind: 'abilityBonus', ability: abil as Ability, amount, origin });
                }
              }
            },
          );
        }
      } else if ((ABILITIES as string[]).includes(key) && typeof value === 'number') {
        col.add({ kind: 'abilityBonus', ability: key as Ability, amount: value, origin });
      }
    }
  }
}

/**
 * `resist: ['fire', { choose: { from: [...] } }]` and similar damage lists.
 * `predetermined` are resistances another part of the build already fixes
 * (e.g. a Dragonborn subrace's ancestry): a choose prompt whose options cover
 * one of them is already answered, so no prompt is emitted.
 */
export function readResistList(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  promptIdBase: string,
  predetermined: readonly string[] = [],
): void {
  if (!Array.isArray(raw)) return;
  let chooseIdx = 0;
  for (const entry of raw) {
    if (typeof entry === 'string') {
      col.add({ kind: 'resist', damageType: entry, origin });
    } else if (typeof entry === 'object' && entry !== null && 'choose' in entry) {
      const c = ((entry as { choose?: unknown }).choose ?? {}) as {
        from?: unknown[];
        count?: number;
      };
      const from = (c.from ?? []).map(String);
      if (predetermined.some((p) => from.includes(p.toLowerCase()))) continue;
      const id = `${promptIdBase}:r${chooseIdx++}`;
      col.choice(
        {
          id,
          origin,
          kind: 'generic',
          label: 'Damage resistance',
          count: c.count ?? 1,
          options: from.map((f) => ({ id: f, label: titleCase(f) })),
        },
        (selected) => {
          for (const s of selected) col.add({ kind: 'resist', damageType: s, origin });
        },
      );
    }
  }
}
