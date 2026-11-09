/**
 * An effect the player describes (the buffs canvas, Catalog board: "Describe
 * an effect"), for homebrew, a book the app does not have, or a ruling at the
 * table. Each part is one thing it does, in the kinds the sheet already
 * counts, so a described effect gets its numbers like one from the catalog
 * and is stored the same way.
 *
 * A part narrowed by "Only when" changes no number: the app cannot see the
 * moment (against undead, while raging), so it becomes a line that says it.
 */
import { readActiveEffects } from '@/engine/activeEffects';
import type {
  ActiveEffect,
  EffectDuration,
  EffectPart,
  KeptEffect,
  RollFilter,
} from '@/engine/types';
import { partLine } from './effectsInPlay';

export const NUMBER_TARGETS = [
  'Armor Class',
  'Attacks',
  'Damage',
  'Saves',
  'Checks',
  'Initiative',
  'Speed',
] as const;
export type NumberTarget = (typeof NUMBER_TARGETS)[number];

export const DIE_ROLLS = ['Attacks', 'Damage', 'Saves', 'Checks'] as const;
export type DieRoll = (typeof DIE_ROLLS)[number];

export const D20_ROLLS = ['Attacks', 'Checks', 'Saves'] as const;
export type D20Roll = (typeof D20_ROLLS)[number];

export const DIE_SIDES = [4, 6, 8, 10, 12] as const;

export const DAMAGE_TYPES = [
  'Acid',
  'Bludgeoning',
  'Cold',
  'Fire',
  'Force',
  'Lightning',
  'Necrotic',
  'Piercing',
  'Poison',
  'Psychic',
  'Radiant',
  'Slashing',
  'Thunder',
] as const;

/** The conditions a described effect can keep off: the ones a creature can be immune to. */
export const BLOCKED_CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Frightened',
  'Grappled',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
] as const;

/** One thing a described effect does, as the builder holds it. */
export type DraftPart =
  | { kind: 'num'; targets: NumberTarget[]; n: number; only?: string }
  | { kind: 'die'; count: number; d: number; on: DieRoll[]; when: 'in' | 'wait'; only?: string }
  | { kind: 'adv'; on: D20Roll[]; only?: string }
  | { kind: 'reroll'; on: D20Roll[]; n: number; only?: string }
  | { kind: 'cut'; mode: 'resist' | 'immune'; types: string[]; only?: string }
  | { kind: 'cond'; on: string[]; only?: string }
  | { kind: 'hp'; mode: 'temp' | 'max'; n: number; only?: string }
  | { kind: 'move'; mode: 'faster' | 'fly' | 'climb' | 'swim'; feet: number; only?: string }
  | { kind: 'turn'; what: 'action' | 'bonus' | 'reaction'; only?: string }
  | { kind: 'act'; name: string; dice: string }
  | { kind: 'cost'; text: string }
  | { kind: 'note'; text: string };

export type DraftKind = DraftPart['kind'];

/** When a described effect ends. */
export type DraftEnds = 'you' | 'concentration' | 'short' | 'long';

export interface Draft {
  name: string;
  parts: DraftPart[];
  ends: DraftEnds;
  /** Kept on the character, so its search finds it next time. */
  keep: boolean;
}

/** The kinds a part can be, in the order the builder offers them, each as it starts. */
export const DRAFT_KINDS: ReadonlyArray<{ kind: DraftKind; title: string; make: () => DraftPart }> =
  [
    {
      kind: 'num',
      title: 'Raise a number',
      make: () => ({ kind: 'num', targets: ['Attacks'], n: 1 }),
    },
    {
      kind: 'die',
      title: 'Add a die',
      make: () => ({ kind: 'die', count: 1, d: 4, on: ['Attacks'], when: 'in' }),
    },
    { kind: 'adv', title: 'Give advantage', make: () => ({ kind: 'adv', on: ['Saves'] }) },
    {
      kind: 'reroll',
      title: 'Reroll a d20',
      make: () => ({ kind: 'reroll', on: ['Attacks'], n: 1 }),
    },
    {
      kind: 'cut',
      title: 'Cut damage',
      make: () => ({ kind: 'cut', mode: 'resist', types: ['Fire'] }),
    },
    {
      kind: 'cond',
      title: 'Block a condition',
      make: () => ({ kind: 'cond', on: ['Frightened'] }),
    },
    { kind: 'hp', title: 'Add hit points', make: () => ({ kind: 'hp', mode: 'temp', n: 5 }) },
    {
      kind: 'move',
      title: 'Move faster or another way',
      make: () => ({ kind: 'move', mode: 'faster', feet: 10 }),
    },
    { kind: 'turn', title: 'Give one more action', make: () => ({ kind: 'turn', what: 'action' }) },
    {
      kind: 'act',
      title: 'Add something to do',
      make: () => ({ kind: 'act', name: '', dice: '' }),
    },
    { kind: 'cost', title: 'Note what it costs', make: () => ({ kind: 'cost', text: '' }) },
    { kind: 'note', title: 'Write a note', make: () => ({ kind: 'note', text: '' }) },
  ];

export const kindTitle = (kind: DraftKind) =>
  DRAFT_KINDS.find((k) => k.kind === kind)?.title ?? kind;

/** Whether a part of this kind can be narrowed to a moment: a line or a cost already is one. */
export const narrows = (kind: DraftKind) => kind !== 'act' && kind !== 'cost' && kind !== 'note';

/** A new description: what the search was given as its name, and nothing it does yet. */
export function newDraft(name = ''): Draft {
  return { name, parts: [], ends: 'you', keep: false };
}

const ROLL: Record<D20Roll, RollFilter['rolls'][number]> = {
  Attacks: 'attack',
  Saves: 'save',
  Checks: 'check',
};

const rollsOf = (on: readonly string[]): RollFilter['rolls'] =>
  D20_ROLLS.filter((r) => on.includes(r)).map((r) => ROLL[r]);

/** "an attack roll, an ability check or a saving throw". */
function oneRoll(on: readonly D20Roll[]): string {
  const say: Record<D20Roll, string> = {
    Attacks: 'an attack roll',
    Checks: 'an ability check',
    Saves: 'a saving throw',
  };
  const list = D20_ROLLS.filter((r) => on.includes(r)).map((r) => say[r]);
  return list.length <= 1
    ? (list[0] ?? '')
    : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
}

const EXTRA: Record<'action' | 'bonus' | 'reaction', string> = {
  action: 'action',
  bonus: 'bonus action',
  reaction: 'reaction',
};

/** What one part does as stored parts, and the temporary hit points it gives as it lands. */
function plainParts(p: DraftPart, name: string): { parts: EffectPart[]; tempHp?: number } {
  switch (p.kind) {
    case 'num': {
      const parts: EffectPart[] = [];
      const has = (t: NumberTarget) => p.targets.includes(t);
      if (has('Armor Class')) parts.push({ kind: 'acBonus', amount: p.n });
      if (has('Attacks'))
        parts.push({ kind: 'attackBonus', scope: 'all', amount: p.n, attack: 'any' });
      if (has('Damage')) parts.push({ kind: 'damageBonus', scope: 'all', amount: p.n });
      if (has('Saves')) parts.push({ kind: 'saveBonus', amount: p.n });
      if (has('Checks')) parts.push({ kind: 'checkBonus', amount: p.n, every: true });
      // Initiative is a Dexterity check, so a bonus to every check already reaches it.
      else if (has('Initiative')) parts.push({ kind: 'initiativeBonus', amount: p.n });
      if (has('Speed')) parts.push({ kind: 'speedBonus', amount: p.n * 5 });
      return { parts };
    }
    case 'die': {
      const dice = `${p.count}d${p.d}`;
      const rolls = rollsOf(p.on);
      const parts: EffectPart[] = [];
      if (rolls.length > 0) {
        parts.push(
          p.when === 'wait'
            ? { kind: 'rollOffer', dice, on: { rolls }, once: true }
            : { kind: 'rollDie', dice, on: { rolls } },
        );
      }
      // A damage die rolls in with the hit: it is never offered.
      if (p.when === 'in' && p.on.includes('Damage'))
        parts.push({ kind: 'damageDie', scope: 'all', dice });
      return { parts };
    }
    case 'adv': {
      const rolls = rollsOf(p.on);
      return {
        parts: rolls.length > 0 ? [{ kind: 'rollAdvantage', mode: 'adv', on: { rolls } }] : [],
      };
    }
    case 'reroll':
      return {
        parts:
          p.on.length > 0
            ? [
                {
                  kind: 'cue',
                  tone: 'help',
                  text: `Reroll the d20 of ${oneRoll(p.on)}, ${p.n === 1 ? 'once' : `${p.n} times`}`,
                },
              ]
            : [],
      };
    case 'cut':
      return {
        parts: p.types.map((t) => ({
          kind: p.mode === 'immune' ? 'immune' : 'resist',
          damageType: t.toLowerCase(),
        })),
      };
    case 'cond':
      return { parts: p.on.map((c) => ({ kind: 'conditionImmune', condition: c })) };
    case 'hp':
      return p.mode === 'temp'
        ? { parts: [], tempHp: p.n }
        : { parts: [{ kind: 'maxHpBonus', amount: p.n }] };
    case 'move':
      return {
        parts: [
          p.mode === 'faster'
            ? { kind: 'speedBonus', amount: p.feet }
            : { kind: 'moveSpeed', mode: p.mode, speed: p.mode === 'fly' ? p.feet : 'walk' },
        ],
      };
    case 'turn':
      return {
        parts: [
          {
            kind: 'extraAction',
            label: `${name || 'Its'} ${EXTRA[p.what]}`,
            note: `one more ${EXTRA[p.what]} each turn`,
          },
        ],
      };
    case 'act': {
      const what = p.name.trim();
      const dice = p.dice.trim();
      return {
        parts:
          what === ''
            ? []
            : [{ kind: 'cue', tone: 'help', text: dice === '' ? what : `${what}: ${dice}` }],
      };
    }
    case 'cost':
      return {
        parts: p.text.trim() === '' ? [] : [{ kind: 'cue', tone: 'warn', text: p.text.trim() }],
      };
    case 'note':
      return {
        parts: p.text.trim() === '' ? [] : [{ kind: 'cue', tone: 'info', text: p.text.trim() }],
      };
  }
}

/** The line for temporary hit points an effect gives as it lands. */
export const tempLine = (n: number) => `${n} temporary hit points now, gone when it ends`;

/** "against undead" from "Only against undead" or "only against undead". */
const momentOf = (only: string) => only.trim().replace(/^only\s+/i, '');

/**
 * What one part does as stored parts. Narrowed to a moment the app cannot
 * see, it is a line that says what it does and when, and changes no number.
 */
export function partsOf(p: DraftPart, name: string): { parts: EffectPart[]; tempHp?: number } {
  const plain = plainParts(p, name);
  const only = 'only' in p && p.only !== undefined ? momentOf(p.only) : '';
  if (only === '' || !narrows(p.kind)) return plain;
  const said = plain.parts.map((x) => partLine(x));
  if (plain.tempHp !== undefined) said.push(`${plain.tempHp} temporary hit points`);
  if (said.length === 0) return { parts: [] };
  return { parts: [{ kind: 'cue', tone: 'help', text: `${said.join(', ')}, only ${only}` }] };
}

const LASTS: Record<DraftEnds, EffectDuration | undefined> = {
  you: undefined,
  concentration: { concentration: true },
  short: { rest: 'short' },
  long: { rest: 'long' },
};

/** The effect a description lands as, with the temporary hit points it gives. */
export function describedEffect(
  draft: Draft,
  id: string,
): { effect: ActiveEffect; tempHp?: number } {
  const name = draft.name.trim();
  const parts: EffectPart[] = [];
  let tempHp: number | undefined;
  for (const p of draft.parts) {
    const got = partsOf(p, name);
    parts.push(...got.parts);
    // Temporary hit points never add up: the most counts.
    if (got.tempHp !== undefined) tempHp = Math.max(tempHp ?? 0, got.tempHp);
  }
  const lasts = LASTS[draft.ends];
  const effect: ActiveEffect = {
    id,
    name,
    parts,
    ...(lasts !== undefined ? { lasts: { ...lasts } } : {}),
  };
  return tempHp !== undefined ? { effect, tempHp } : { effect };
}

/** Why a description cannot land yet, or nothing when it can. */
export function notReady(draft: Draft): string | undefined {
  if (draft.name.trim() === '') return 'Name it to add it';
  const { effect, tempHp } = describedEffect(draft, '');
  if (effect.parts.length === 0 && tempHp === undefined) return 'Say what it does to add it';
  return undefined;
}

/** A description kept on the character, for its search next time. */
export function keptFrom(draft: Draft, id: string): KeptEffect {
  const { effect, tempHp } = describedEffect(draft, id);
  return {
    id,
    name: effect.name,
    parts: effect.parts,
    ...(effect.lasts !== undefined ? { lasts: effect.lasts } : {}),
    ...(tempHp !== undefined ? { tempHp } : {}),
  };
}

/**
 * The kept descriptions a stored document holds, checked as effects in play
 * are. One this version cannot read in full (a newer app's kind of part) is
 * left out, rather than offered without what it cannot read; the document is
 * not changed, so the app that kept it still has it whole.
 */
export function keptEffects(raw: unknown): KeptEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: KeptEffect[] = [];
  // The first readable one of an id holds it, as for effects in play.
  const ids = new Set<string>();
  // Read one entry at a time, so each effect is compared with the entry it
  // came from, never an unreadable one that shares its id.
  for (const item of raw) {
    const [e] = readActiveEffects([item]).effects;
    if (e === undefined || ids.has(e.id)) continue;
    ids.add(e.id);
    // Read, so an object with a parts list.
    const stored = item as { parts: unknown[]; tempHp?: unknown };
    if (e.parts.length !== stored.parts.length) continue;
    const temp = stored.tempHp;
    out.push({
      id: e.id,
      name: e.name,
      parts: e.parts,
      ...(e.lasts !== undefined ? { lasts: e.lasts } : {}),
      ...(Number.isInteger(temp) && (temp as number) > 0 ? { tempHp: temp as number } : {}),
    });
  }
  return out;
}
