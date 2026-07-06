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

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function skillOptions(from?: readonly unknown[]): ChoiceOption[] {
  const names =
    from !== undefined && from.length > 0
      ? from.map((f) => SKILL_BY_LOWER.get(String(f).toLowerCase()) ?? titleCase(String(f)))
      : SKILLS.map((s) => s.name);
  return names.map((n) => ({ id: n, label: n }));
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
            options: optionsFor(c.from),
          },
          (selected) => {
            for (const s of selected) grant(s);
          },
        );
      } else if (key === 'any' || key === 'anyStandard' || key === 'anyLanguage') {
        const count = num(value) ?? 1;
        const id = `${promptIdBase}:${chooseIdx++}`;
        col.choice(
          { id, origin, kind, label, count, options: optionsFor(undefined) },
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

/** Race/feat `ability` blocks (2014 style) and XPHB background `ability`. */
export function readAbilityBlock(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  promptIdBase: string,
): void {
  const entries = asEntityArray(raw);
  let chooseIdx = 0;
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

/** `resist: ['fire', { choose: { from: [...] } }]` and similar damage lists. */
export function readResistList(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  promptIdBase: string,
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
      const id = `${promptIdBase}:r${chooseIdx++}`;
      col.choice(
        {
          id,
          origin,
          kind: 'generic',
          label: 'Damage resistance',
          count: c.count ?? 1,
          options: (c.from ?? []).map((f) => ({ id: String(f), label: titleCase(String(f)) })),
        },
        (selected) => {
          for (const s of selected) col.add({ kind: 'resist', damageType: s, origin });
        },
      );
    }
  }
}
