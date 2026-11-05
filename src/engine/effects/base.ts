import type {
  Ability,
  CharacterDoc,
  ChoicePrompt,
  DataEntity,
  EffectInput,
  EngineContext,
  FeatureCard,
} from '../types';

/** Shared mutable state threaded through all collectors. */
export class Collector {
  readonly doc: CharacterDoc;
  readonly ctx: EngineContext;
  readonly effects: EffectInput[] = [];
  readonly pending: ChoicePrompt[] = [];
  readonly resolved: Array<{ prompt: ChoicePrompt; selected: string[] }> = [];
  readonly features: FeatureCard[] = [];
  readonly warnings: string[] = [];
  /** uids of non-repeatable feats already collected, to prevent double-apply. */
  readonly collectedFeats = new Set<string>();
  /**
   * The prompt id whose stored pick added each effect, so a pick can tell its
   * own grants apart from the rest of the build (see `noteSkillSources`).
   */
  readonly pickOf = new Map<EffectInput, string>();
  /** The ability each feat's `additionalSpells` entry settled on, by lowercase feat name. */
  readonly spellAbilities: Array<{ feat: string; branch?: string; ability: Ability }> = [];
  /** Grants that cast with another feat's ability (see `settleInheritedAbilities`). */
  readonly inheritingGrants: Array<{
    grants: Array<Extract<EffectInput, { kind: 'grantSpell' }>>;
    fromFeats: readonly string[];
    branch?: string;
  }> = [];

  constructor(doc: CharacterDoc, ctx: EngineContext) {
    this.doc = doc;
    this.ctx = ctx;
  }

  add(e: EffectInput): void {
    this.effects.push(e);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  /** Skills the character is already proficient in (for expertise choices). */
  proficientSkills(): string[] {
    const out = new Set<string>();
    for (const e of this.effects) {
      if (e.kind === 'skillProf' && e.level >= 1) out.add(e.skill);
    }
    return [...out];
  }

  /**
   * Resolve a choice from doc.choices or surface the prompt. When resolved,
   * `apply` receives only canonical option ids. Unknown/corrupt ids never grant
   * effects; disabled picks remain usable as an explicitly warned override.
   */
  choice(prompt: ChoicePrompt, apply: (selected: string[]) => void): void {
    const stored = this.doc.choices[prompt.id];
    if (stored === undefined) {
      this.pending.push(prompt);
      return;
    }
    const rawSelected = Array.isArray(stored) ? stored.map(String) : [String(stored)];
    const byId = new Map(prompt.options.map((o) => [o.id.toLowerCase(), o]));
    const selected: string[] = [];
    const seen = new Set<string>();
    let invalid = false;
    for (const raw of rawSelected) {
      const option = byId.get(raw.toLowerCase());
      if (option === undefined) {
        invalid = true;
        this.warn(
          `${prompt.origin.label}: saved ${prompt.label.toLowerCase()} choice “${raw}” is no longer available; choose again.`,
        );
        continue;
      }
      const key = option.id.toLowerCase();
      if (prompt.allowRepeat !== true && seen.has(key)) {
        invalid = true;
        this.warn(
          `${prompt.origin.label}: ${option.label} was selected more than once for ${prompt.label.toLowerCase()}; choose distinct options.`,
        );
        continue;
      }
      if (selected.length >= prompt.count) {
        invalid = true;
        this.warn(
          `${prompt.origin.label}: ${prompt.label} has more than ${prompt.count} saved pick${prompt.count === 1 ? '' : 's'}; extra choices were ignored.`,
        );
        break;
      }
      seen.add(key);
      selected.push(option.id);
      if (option.disabled !== undefined) {
        this.warn(
          `${prompt.origin.label}: ${option.label} is an unusual ${prompt.label.toLowerCase()} choice: ${option.disabled.reason}.`,
        );
      }
    }
    // Apply what's chosen so far, but a multi-pick that isn't full yet stays
    // pending so the UI keeps showing it (fixes "closes after one" on Rogue).
    const before = this.effects.length;
    apply(selected);
    // A pick nested in this one (an ASI's feat, that feat's skills) has tagged
    // its own effects already; those stay its own.
    for (const e of this.effects.slice(before)) {
      if (!this.pickOf.has(e)) this.pickOf.set(e, prompt.id);
    }
    if (invalid || selected.length < prompt.count) {
      this.pending.push(prompt);
    } else {
      this.resolved.push({ prompt, selected });
    }
  }
}

export function asEntityArray(v: unknown): DataEntity[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is DataEntity => typeof e === 'object' && e !== null);
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
