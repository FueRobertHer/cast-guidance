// @vitest-environment jsdom
/**
 * What every effect card writes (ADR-002, U3's proof). For each card kind, in
 * each place a list of cards sits (an entry's own, in play, in a pick, an
 * item's with charges, beside a class's pools, a copy's prices), every box,
 * tick and button is worked one at a time on a fresh card, and what the list
 * hands its host is recorded, with what each box shows and offers.
 *
 * It runs only with `CARD_WRITES` set to a file to write the record to, and
 * with `CARD_WRITES_BEFORE` set to an earlier record it compares the two:
 *
 *   CARD_WRITES=before.json bunx vitest run src/features/workshop/cards/writes.harness.test.tsx
 *   (change the cards)
 *   CARD_WRITES=after.json CARD_WRITES_BEFORE=before.json bunx vitest run src/features/workshop/cards/writes.harness.test.tsx
 *
 * It takes about four minutes. `CARD_WRITES_HOSTS=entry,inPlay` works those
 * hosts alone. Boxes are found by their names ("Card: Label"), which a new face
 * keeps, so a record taken after a new face is compared box by box: any write
 * that differs fails, and a box, tick or button the earlier record has not is
 * new, and listed. What a box shows and offers, the list read only, and what
 * More asks are listed when they differ, for a person to judge.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { act, cleanup, fireEvent, type RenderResult, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { asked, choice } = vi.hoisted(() => ({
  asked: { current: undefined as unknown },
  choice: { current: undefined as string | undefined },
}));
vi.mock('@/ui/dialogs', () => ({
  askChoice: (o: unknown) => {
    asked.current = o;
    return Promise.resolve(choice.current);
  },
  askConfirm: () => Promise.resolve(true),
  askText: () => Promise.resolve(null),
}));

import { EffectCards, EntryEffects } from '../EffectCards';

type Json = Record<string, unknown>;
type Props = ComponentProps<typeof EffectCards>;

const OUT = process.env.CARD_WRITES;
const BEFORE = process.env.CARD_WRITES_BEFORE;
const ONLY = process.env.CARD_WRITES_HOSTS?.split(',');

/**
 * Two records set side by side: writes that differ (a card writes something
 * else), records only the earlier has (gone) or only the later has (new), and
 * other records that differ (what a box shows, the read-only list, More's ask).
 */
function compareRecords(before: Record<string, unknown>, after: Record<string, unknown>) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const out = {
    writes: [] as string[],
    gone: [] as string[],
    added: [] as string[],
    other: [] as string[],
  };
  for (const [k, was] of Object.entries(before)) {
    if (!(k in after)) out.gone.push(k);
    else if (k.endsWith(' | view')) {
      const now = after[k] as Record<string, unknown>;
      for (const [box, v] of Object.entries(was as Record<string, unknown>)) {
        if (!(box in now)) out.gone.push(`${k} | ${box}`);
        else if (!same(v, now[box])) out.other.push(`${k} | ${box}`);
      }
      for (const box of Object.keys(now)) {
        if (!(box in (was as Record<string, unknown>))) out.added.push(`${k} | ${box}`);
      }
    } else if (!same(was, after[k])) {
      // A click that asks holds the ask beside its writes: a new ask with the
      // same writes is shown or asked differently, not written differently.
      const asked = typeof was === 'object' && was !== null && 'writes' in was;
      const isWrite = asked
        ? !same((was as { writes: unknown }).writes, (after[k] as { writes?: unknown }).writes)
        : Array.isArray(was) && !k.endsWith(' | buttons');
      (isWrite ? out.writes : out.other).push(k);
    }
  }
  for (const k of Object.keys(after)) if (!(k in before)) out.added.push(k);
  return out;
}

const SPELLS = [
  { name: 'Misty Step', source: 'XPHB' },
  { name: 'Fireball', source: 'XPHB' },
];
const KI: Json & { kind: string } = {
  kind: 'resource',
  key: 'ki',
  label: 'Ki',
  max: 2,
  reset: 'short',
};
const CHARGES: Json = { kind: 'charges', max: 7, recharge: 'dawn' };

/** Every kind a card has today, each with the file-given values a box shows as written. */
const SEEDS: ReadonlyArray<readonly [string, Json[]]> = [
  ['abilityBonus', [{ kind: 'abilityBonus', ability: 'str', amount: 1 }]],
  ['abilityBonus formula', [{ kind: 'abilityBonus', ability: 'con', amount: { f: 'prof' } }]],
  [
    'abilityBonus byLevel',
    [{ kind: 'abilityBonus', ability: 'str', amount: { byLevel: { 1: 1, 11: 2 } } }],
  ],
  ['abilityBonus off-list', [{ kind: 'abilityBonus', ability: 'luck', amount: 1 }]],
  ['abilityBonus edition', [{ kind: 'abilityBonus', ability: 'str', amount: 1, edition: '2014' }]],
  [
    'abilityBonus odd edition',
    [{ kind: 'abilityBonus', ability: 'str', amount: 1, edition: '5.5' }],
  ],
  ['abilityMin', [{ kind: 'abilityMin', ability: 'str', min: 19 }]],
  [
    'abilityMin byLevel',
    [{ kind: 'abilityMin', ability: 'dex', min: { byLevel: { 1: 13, 5: 15 } } }],
  ],
  ['acBonus', [{ kind: 'acBonus', amount: 1 }]],
  ['acBonus while', [{ kind: 'acBonus', amount: 1, while: 'bloodied' }]],
  ['acBonus while effect', [{ kind: 'acBonus', amount: 2, while: { effect: 'Rage' } }]],
  ['acBonus while many', [{ kind: 'acBonus', amount: 1, while: ['zeroHp', 'shield'] }]],
  ['initiativeBonus', [{ kind: 'initiativeBonus', amount: 1 }]],
  ['initiativeBonus prof', [{ kind: 'initiativeBonus', profBonus: true }]],
  ['speedBonus', [{ kind: 'speedBonus', amount: 5 }]],
  ['speedBonus noArmor', [{ kind: 'speedBonus', amount: 10, while: 'noArmor' }]],
  ['moveSpeed walk', [{ kind: 'moveSpeed', mode: 'fly', speed: 'walk' }]],
  ['moveSpeed feet', [{ kind: 'moveSpeed', mode: 'swim', speed: 30 }]],
  ['moveSpeed off-list', [{ kind: 'moveSpeed', mode: 'burrow', speed: 10 }]],
  ['sense', [{ kind: 'sense', sense: 'darkvision', range: 60 }]],
  ['sense off-list', [{ kind: 'sense', sense: 'xray', range: 30 }]],
  ['maxHpBonus', [{ kind: 'maxHpBonus', amount: 1 }]],
  ['maxHpBonus bloodied', [{ kind: 'maxHpBonus', amount: 1, while: 'bloodied' }]],
  ['hpPerLevel', [{ kind: 'hpPerLevel', amount: 1 }]],
  ['saveBonus', [{ kind: 'saveBonus', amount: 1 }]],
  ['saveBonus some', [{ kind: 'saveBonus', amount: 1, abilities: ['dex', 'con'] }]],
  ['saveBonus odd', [{ kind: 'saveBonus', amount: 1, abilities: ['dex', 'luck'] }]],
  ['skillProf', [{ kind: 'skillProf', skill: 'Perception', level: 1 }]],
  ['skillProf expertise', [{ kind: 'skillProf', skill: 'Stealth', level: 2 }]],
  ['skillProf off-list', [{ kind: 'skillProf', skill: 'Underwater Basketry', level: 1 }]],
  ['saveProf', [{ kind: 'saveProf', ability: 'wis' }]],
  ['language', [{ kind: 'language', name: 'Elvish' }]],
  ['toolProf', [{ kind: 'toolProf', name: "Thieves' Tools" }]],
  ['weaponProf', [{ kind: 'weaponProf', name: 'longsword' }]],
  ['resist', [{ kind: 'resist', damageType: 'fire' }]],
  ['immune', [{ kind: 'immune', damageType: 'poison' }]],
  ['vulnerable', [{ kind: 'vulnerable', damageType: 'cold' }]],
  ['resist byAnswer', [{ kind: 'resist', damageType: { byAnswer: 'ancestry' } }]],
  ['resist off-list', [{ kind: 'resist', damageType: 'sonic' }]],
  ['conditionImmune', [{ kind: 'conditionImmune', condition: 'Frightened' }]],
  ['conditionImmune off-list', [{ kind: 'conditionImmune', condition: 'Dazed' }]],
  ['rollAdvantage', [{ kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'] } }]],
  [
    'rollAdvantage when',
    [
      {
        kind: 'rollAdvantage',
        mode: 'adv',
        on: { rolls: ['save'], abilities: ['wis'] },
        when: 'Against charm',
      },
    ],
  ],
  ['rollAdvantage dis', [{ kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['attack'] } }]],
  [
    'rollAdvantage concentration',
    [{ kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'], save: 'concentration' } }],
  ],
  [
    'rollAdvantage as written',
    [{ kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check'], skills: ['Stealth'] } }],
  ],
  [
    'rollAdvantage several',
    [{ kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check'], abilities: ['str', 'dex'] } }],
  ],
  ['rollDie', [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'] } }]],
  [
    'rollDie initiative',
    [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['check'], initiative: true } }],
  ],
  ['rollPaid', [{ kind: 'rollPaid', on: { rolls: ['check'] }, dice: '1d4', ifFailed: true }]],
  ['rollPaid poolDie', [{ kind: 'rollPaid', on: { rolls: ['attack'] }, poolDie: true }]],
  [
    'rollPaid advantage',
    [{ kind: 'rollPaid', on: { rolls: ['save'] }, advantage: true, reaction: true }],
  ],
  [
    'rollPaid bonus',
    [{ kind: 'rollPaid', on: { rolls: ['check'] }, bonus: 2, after: true, inspiration: true }],
  ],
  [
    'rollPaid bonus byLevel',
    [
      {
        kind: 'rollPaid',
        on: { rolls: ['check'] },
        bonus: { byLevel: { 1: 1, 9: 2 } },
        after: true,
      },
    ],
  ],
  [
    'rollPaid back',
    [
      {
        kind: 'rollPaid',
        on: { rolls: ['attack'] },
        dice: '1d6',
        ifFailed: true,
        spentOnSuccess: true,
        reaction: false,
        when: 'On your turn',
      },
    ],
  ],
  [
    'rollPaid initiative',
    [{ kind: 'rollPaid', on: { rolls: ['check'], initiative: true }, dice: '1d4', ifFailed: true }],
  ],
  ['rollPaid death', [{ kind: 'rollPaid', on: { rolls: ['save'], save: 'death' }, dice: '1d4' }]],
  ['rollReroll', [{ kind: 'rollReroll', on: { rolls: ['save'] }, ifFailed: true }]],
  [
    'rollReroll one',
    [{ kind: 'rollReroll', on: { rolls: ['attack'] }, die: 'one', atMost: 2, free: true }],
  ],
  [
    'rollReroll one auto',
    [
      {
        kind: 'rollReroll',
        on: { rolls: ['attack'] },
        die: 'one',
        atMost: 1,
        auto: true,
        free: true,
      },
    ],
  ],
  [
    'rollReroll extra',
    [{ kind: 'rollReroll', on: { rolls: ['check'] }, die: 'extra', inspiration: true }],
  ],
  [
    'rollReroll low',
    [{ kind: 'rollReroll', on: { rolls: ['attack'] }, die: 'low', auto: true, free: true }],
  ],
  [
    'rollReroll to',
    [{ kind: 'rollReroll', on: { rolls: ['check'] }, to: 10, auto: true, free: true }],
  ],
  ['rollReroll to odd', [{ kind: 'rollReroll', on: { rolls: ['check'] }, to: 25 }]],
  [
    'rollReroll floor',
    [
      {
        kind: 'rollReroll',
        on: { rolls: ['check'], abilities: ['str'] },
        floorScore: 'str',
        auto: true,
        free: true,
      },
    ],
  ],
  [
    'rollReroll bonus',
    [{ kind: 'rollReroll', on: { rolls: ['save'] }, bonus: 1, reaction: true, free: true }],
  ],
  [
    'rollReroll initiative',
    [{ kind: 'rollReroll', on: { rolls: ['check'], initiative: true }, ifFailed: true }],
  ],
  ['attackBonus spell', [{ kind: 'attackBonus', amount: 1, attack: 'spell' }]],
  ['attackBonus all', [{ kind: 'attackBonus', amount: 1, scope: 'all' }]],
  ['attackBonus melee', [{ kind: 'attackBonus', amount: 2, scope: 'melee' }]],
  ['attackBonus every', [{ kind: 'attackBonus', amount: 1, scope: 'all', attack: 'any' }]],
  ['attackBonus every no scope', [{ kind: 'attackBonus', amount: 1, attack: 'any' }]],
  ['attackBonus any melee', [{ kind: 'attackBonus', amount: 1, scope: 'melee', attack: 'any' }]],
  [
    'attackBonus scope byLevel',
    [{ kind: 'attackBonus', amount: 1, scope: { byLevel: { 1: 'melee' } } }],
  ],
  ['attackBonus weapon', [{ kind: 'attackBonus', amount: 1, attack: 'weapon' }]],
  ['spellDcBonus', [{ kind: 'spellDcBonus', amount: 1 }]],
  ['grantSpell', [{ kind: 'grantSpell', spell: '' }]],
  [
    'grantSpell prepared',
    [{ kind: 'grantSpell', spell: 'Misty Step|XPHB', usage: 'prepared', ability: 'wis' }],
  ],
  [
    'grantSpell uses',
    [KI, { kind: 'grantSpell', spell: 'Fireball|XPHB', resourceKey: 'ki', usage: '1/rest' }],
  ],
  [
    'grantSpell elsewhere',
    [{ kind: 'grantSpell', spell: 'Fireball|XPHB', resourceKey: 'sorcery', usage: '1/day' }],
  ],
  ['grantSpell ownClass', [{ kind: 'grantSpell', spell: 'Misty Step|XPHB', ownClass: true }]],
  [
    'grantSpell odd ability',
    [{ kind: 'grantSpell', spell: 'Misty Step|XPHB', ability: 'spellcasting' }],
  ],
  ['damageBonus', [{ kind: 'damageBonus', amount: 1, scope: 'all' }]],
  ['damageBonus ranged', [{ kind: 'damageBonus', amount: 2, scope: 'ranged' }]],
  ['resource', [{ kind: 'resource', key: 'uses', label: 'Uses', max: 1, reset: 'long' }]],
  ['resource short', [KI]],
  [
    'resource byLevel',
    [
      {
        kind: 'resource',
        key: 'flare',
        label: { byLevel: { 1: 'Flare', 5: 'Blaze' } },
        max: { byLevel: { 1: 2, 5: 3 } },
        reset: { byLevel: { 1: 'long', 5: 'short' } },
      },
    ],
  ],
  [
    'resource ownClass',
    [{ kind: 'resource', key: 'embers', label: 'Embers', max: 2, reset: 'long', ownClass: true }],
  ],
  [
    'resource beside',
    [
      {
        kind: 'resource',
        key: 'embers',
        label: 'Embers',
        max: 2,
        reset: 'long',
        ownClassBeside: ['Paladin', 'Cleric'],
      },
    ],
  ],
  [
    'resource formula',
    [
      {
        kind: 'resource',
        key: 'grit',
        label: 'Grit',
        max: { f: 'max(1, mod.wis)' },
        reset: 'short',
        edition: '2024',
      },
    ],
  ],
  [
    'resource twins',
    [
      { kind: 'resource', key: 'ki', label: 'Ki', max: 2, reset: 'short', edition: '2014' },
      { kind: 'resource', key: 'ki', label: 'Focus', max: 2, reset: 'short', edition: '2024' },
    ],
  ],
  ['action', [{ kind: 'action', economy: 'action', label: 'New action' }]],
  ['action none', [{ kind: 'action', economy: 'none', label: 'Rider' }]],
  [
    'action pool',
    [
      KI,
      { kind: 'action', economy: 'bonus', label: 'Flurry', cost: { resource: 'ki', amount: 1 } },
    ],
  ],
  [
    'action pool varies',
    [
      KI,
      {
        kind: 'action',
        economy: 'action',
        label: 'Burst',
        cost: { resource: 'ki', amount: 'varies', optional: true },
      },
    ],
  ],
  [
    'action slot',
    [
      {
        kind: 'action',
        economy: 'action',
        label: 'Smite',
        cost: { resource: 'slot', amount: 1, minLevel: 3, slotDice: '1d8' },
      },
    ],
  ],
  [
    'action pact',
    [
      {
        kind: 'action',
        economy: 'action',
        label: 'Pact',
        cost: { resource: 'slot', amount: 1, pactOnly: true },
      },
    ],
  ],
  [
    'action hitDie',
    [
      {
        kind: 'action',
        economy: 'bonus',
        label: 'Mend',
        cost: { resource: 'hitDie', amount: 1, hitDieHeals: 'rollPlusCon' },
      },
    ],
  ],
  [
    'action buyBack',
    [
      KI,
      {
        kind: 'action',
        economy: 'reaction',
        label: 'Ward',
        cost: { resource: 'ki', amount: 1 },
        buyBack: { resource: 'slot', amount: 1, own: 'ki' },
      },
    ],
  ],
  [
    'action buyBack pool',
    [
      KI,
      { kind: 'action', economy: 'action', label: 'Rally', buyBack: { resource: 'ki', amount: 2 } },
    ],
  ],
  [
    'action odd cost',
    [{ kind: 'action', economy: 'action', label: 'Odd', cost: { resource: 'sorcery', amount: 3 } }],
  ],
  [
    'action beside',
    [{ kind: 'action', economy: 'bonus', label: 'Kindle', ownClassBeside: ['Paladin'] }],
  ],
  [
    'action byLevel',
    [{ kind: 'action', economy: 'bonus', label: { byLevel: { 1: 'Flare', 5: 'Blaze' } } }],
  ],
  ['cue', [{ kind: 'cue', tone: 'info', text: 'Remember to' }]],
  [
    'pick skill',
    [
      {
        kind: 'pick',
        id: 'choice',
        ask: 'skill',
        gives: [{ kind: 'skillProf', skill: '{pick}', level: 1 }],
      },
    ],
  ],
  [
    'pick save',
    [
      {
        kind: 'pick',
        id: 'gift',
        ask: 'save',
        count: 2,
        gives: [{ kind: 'saveProf', ability: '{pick}' }],
      },
    ],
  ],
  [
    'pick damage',
    [
      {
        kind: 'pick',
        id: 'gift',
        ask: 'damage',
        gives: [{ kind: 'resist', damageType: '{pick}' }],
      },
    ],
  ],
  [
    'pick spell',
    [
      {
        kind: 'pick',
        id: 'gift',
        ask: 'spell',
        spells: { levels: [0] },
        gives: [{ kind: 'grantSpell', spell: '{pick}' }],
      },
    ],
  ],
  [
    'pick option',
    [
      {
        kind: 'pick',
        id: 'gift',
        ask: 'option',
        options: [
          { id: 'option-1', name: 'Bold', gives: [{ kind: 'acBonus', amount: 1 }] },
          { id: 'option-2', name: 'Swift', gives: [{ kind: 'speedBonus', amount: 5 }] },
        ],
      },
    ],
  ],
  [
    'pick tool',
    [
      {
        kind: 'pick',
        id: 'gift',
        ask: 'tool',
        gives: [
          { kind: 'toolProf', name: '{pick}' },
          { kind: 'resource', key: 'sig-{pick.slug}', label: '{pick}', max: 1, reset: 'long' },
        ],
      },
    ],
  ],
  [
    'pick weapon',
    [
      {
        kind: 'pick',
        id: 'gift',
        ask: 'weapon',
        weapons: { filter: 'type=martial weapon' },
        gives: [{ kind: 'weaponProf', name: '{pick}' }],
      },
    ],
  ],
  ['pick mastery', [{ kind: 'pick', id: 'gift', ask: 'weaponMastery', count: 2 }]],
  ['unknown kind', [{ kind: 'mysteryKind', amount: 1 }]],
  [
    'pool rename',
    [
      KI,
      { kind: 'action', economy: 'bonus', label: 'Flurry', cost: { resource: 'ki', amount: 1 } },
      { kind: 'grantSpell', spell: 'Misty Step|XPHB', resourceKey: 'ki', usage: '1/rest' },
    ],
  ],
];

const AMEND: Json[] = [
  { cost: { amount: 2 } },
  {
    label: 'Flurry of Blows',
    cost: { resource: 'ki', amount: 1 },
    buyBack: { resource: 'slot', amount: 1 },
  },
  { cost: { resource: 'hitDie', amount: 1 } },
];

interface Host {
  name: string;
  props: Partial<Props>;
  /** The seeds it is worked on, all when absent. */
  seeds?: (name: string, effects: Json[]) => boolean;
  /** What it puts in the list beside a seed. */
  around?: (effects: Json[]) => Json[];
}

const has = (kinds: readonly string[]) => (_: string, effects: Json[]) =>
  effects.some((e) => kinds.includes(String(e.kind)));

const HOSTS: readonly Host[] = [
  { name: 'entry', props: {} },
  { name: 'spells', props: { spells: SPELLS }, seeds: has(['grantSpell', 'pick']) },
  { name: 'inPlay', props: { inPlay: true } },
  {
    name: 'pools',
    props: { resources: [KI], spells: SPELLS },
    seeds: has(['grantSpell', 'action', 'resource']),
  },
  {
    name: 'charges',
    props: { holdsCharges: true, hide: (e) => e.kind === 'charges' },
    seeds: has(['action']),
    around: (effects) => [CHARGES, ...effects],
  },
  {
    name: 'pick',
    props: {
      prefix: 'Each pick gives: ',
      addLabel: 'Add to each',
      fills: [{ pick: 'Stealth', slug: 'stealth', title: 'Stealth' }],
      picked: 'skill',
    },
    seeds: (name) => !name.startsWith('pick') && !name.startsWith('pool'),
  },
  {
    name: 'pickDamage',
    props: {
      prefix: 'Each pick gives: ',
      addLabel: 'Add to each',
      fills: [{ pick: 'fire' }],
      picked: 'damage',
    },
    seeds: has(['resist', 'immune', 'vulnerable', 'saveProf', 'abilityBonus']),
  },
  {
    name: 'amend',
    props: { inherits: 'Monk', amend: AMEND, resources: [KI] },
    seeds: (name) => name === 'action pool' || name === 'resource',
  },
  {
    name: 'amendReplaced',
    props: { inherits: 'Monk', replace: true, amend: AMEND },
    seeds: (n) => n === 'acBonus',
  },
];

/**
 * Entries' own `castGuidance` as a feat's editor holds it (`EntryEffects`),
 * with moments of every shape: what the cards draw and what they must keep as
 * written, beside what else the guidance holds (`drop`, `basedOn`).
 */
const ENTRY_DRAFTS: ReadonlyArray<readonly [string, Json]> = [
  ['plain', { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] }],
  ['nothing', { v: 1 }],
  [
    'condition at zero',
    {
      v: 1,
      effects: [{ kind: 'acBonus', amount: 1 }],
      moments: [{ at: 'zeroHp', do: [{ kind: 'addCondition', condition: 'Exhaustion' }] }],
    },
  ],
  [
    'effect at long rest',
    {
      v: 1,
      moments: [
        {
          at: 'longRest',
          do: [
            { kind: 'addEffect', name: 'Rested', effects: [{ kind: 'speedBonus', amount: 10 }] },
          ],
        },
      ],
    },
  ],
  [
    'effect on a natural 20, a minute',
    {
      v: 1,
      effects: [{ kind: 'skillProf', skill: 'stealth' }],
      moments: [
        {
          at: 'natural20',
          rolls: ['attack'],
          do: [
            {
              kind: 'addEffect',
              name: 'Fury',
              effects: [{ kind: 'damageBonus', amount: 2, scope: 'all' }],
              lasts: { minutes: 1 },
            },
          ],
        },
      ],
    },
  ],
  [
    'two outcomes',
    {
      v: 1,
      moments: [
        {
          at: 'turnStart',
          do: [
            {
              kind: 'addEffect',
              name: 'Wary',
              effects: [{ kind: 'initiativeBonus', amount: 2 }],
              lasts: { rest: 'short', concentration: true },
            },
            { kind: 'cue', text: 'Roar', tone: 'warn' },
          ],
        },
      ],
    },
  ],
  [
    'cast at level, two effects',
    {
      v: 1,
      drop: [{ kind: 'resist' }],
      basedOn: 'Alert|XPHB',
      basedOnFingerprint: 'abc',
      moments: [
        {
          at: 'castAtLevel',
          level: 3,
          do: [
            {
              kind: 'addEffect',
              name: 'Surge',
              effects: [
                { kind: 'acBonus', amount: 1 },
                { kind: 'resist', damageType: 'fire' },
              ],
              lasts: { minutes: 10, endsWhen: 'incapacitated' },
            },
          ],
        },
      ],
    },
  ],
  [
    'when frightened, beside one kept',
    {
      v: 1,
      effects: [{ kind: 'speedBonus', amount: 5 }],
      moments: [
        { at: 'shortRest', do: [{ kind: 'regain', resource: 'ki', amount: 1 }] },
        {
          at: 'conditionAdded',
          condition: 'frightened',
          do: [{ kind: 'addEffect', name: 'Bold', effects: [{ kind: 'saveBonus', amount: 1 }] }],
        },
      ],
    },
  ],
  [
    'a moment the reader refuses',
    {
      v: 1,
      moments: [
        {
          at: 'zeroHp',
          do: [
            {
              kind: 'addEffect',
              name: 'Odd',
              effects: [{ kind: 'acBonus', amount: 1, while: 'bloodied' }],
            },
          ],
        },
      ],
    },
  ],
];

const SAMPLES = [
  '',
  '3',
  '-1',
  'mod.wis',
  'walk',
  'Ki Points',
  '1d6',
  'misty step',
  'Paladin, Cleric',
];

type Write = unknown[];

/** The list on screen as `host` holds it, with `effects`, recording what it writes. */
function mount(host: Host, effects: Json[], writes: Write[]) {
  const props: Props = {
    effects,
    readOnly: false,
    ...host.props,
    onChange: (next, amend) =>
      writes.push(amend === undefined ? ['effects', next] : ['effects', next, 'amend', amend]),
    ...(host.props.inherits !== undefined
      ? {
          onAmend: (next: Json[]) => writes.push(['amend', next]),
          onReplace: (r: boolean) => writes.push(['replace', r]),
        }
      : {}),
  } as Props;
  return render(<EffectCards {...props} />);
}

/** A control's name: its own label, or the label it sits in, or its words. */
function nameOf(el: Element): string {
  const own = el.getAttribute('aria-label');
  if (own !== null) return own;
  const label = el.closest('label');
  if (label !== null) return `label:${(label.textContent ?? '').trim()}`;
  return `text:${(el.textContent ?? '').trim()}`;
}

interface Control {
  key: string;
  tag: string;
  type: string;
}

function controlsIn(root: HTMLElement): Control[] {
  const seen = new Map<string, number>();
  return [...root.querySelectorAll('select, input, textarea, button')].map((el) => {
    const name = `${el.tagName.toLowerCase()}|${nameOf(el)}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return {
      key: n === 0 ? name : `${name}#${n}`,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') ?? '',
    };
  });
}

function find(root: HTMLElement, key: string): Element | undefined {
  const seen = new Map<string, number>();
  for (const el of root.querySelectorAll('select, input, textarea, button')) {
    const name = `${el.tagName.toLowerCase()}|${nameOf(el)}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if ((n === 0 ? name : `${name}#${n}`) === key) return el;
  }
  return undefined;
}

/** What a control shows and offers. */
function viewOf(el: Element): unknown {
  if (el instanceof HTMLSelectElement) {
    return { value: el.value, options: [...el.options].map((o) => [o.value, o.textContent]) };
  }
  if (el instanceof HTMLInputElement) {
    return el.type === 'checkbox'
      ? { checked: el.checked, disabled: el.disabled }
      : { value: el.value, placeholder: el.placeholder };
  }
  return { disabled: (el as HTMLButtonElement).disabled };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Each way of working a control, one at a time. */
function actionsFor(el: Element): string[] {
  if (el instanceof HTMLSelectElement) return [...el.options].map((o) => `pick:${o.value}`);
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return ['tick'];
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return SAMPLES.map((s) => `type:${s}`);
  }
  return ['click'];
}

async function work(el: Element, action: string) {
  const [how, ...rest] = action.split(':');
  const v = rest.join(':');
  if (how === 'pick' || how === 'type') fireEvent.change(el, { target: { value: v } });
  else fireEvent.click(el);
  await flush();
}

/**
 * One list's record under `at`: what each control shows and offers, the list
 * read only, and what working each control one at a time on a fresh list writes.
 */
async function recordList(
  record: Record<string, unknown>,
  at: string,
  show: (writes: Write[], readOnly: boolean) => RenderResult,
) {
  const first = show([], false);
  const controls = controlsIn(first.container);
  const views: Record<string, unknown> = {};
  for (const c of controls) {
    const el = find(first.container, c.key);
    if (el !== undefined) views[c.key] = viewOf(el);
  }
  // Read back: the line a Remove names, and the list read only.
  cleanup();
  const shown = show([], true);
  record[`${at} | read only`] = shown.container.textContent;
  cleanup();
  record[`${at} | view`] = views;
  for (const c of controls) {
    const probe = show([], false);
    const el = find(probe.container, c.key);
    const actions = el === undefined ? [] : actionsFor(el);
    cleanup();
    for (const action of actions) {
      const writes: Write[] = [];
      asked.current = undefined;
      choice.current = undefined;
      const r = show(writes, false);
      const target = find(r.container, c.key);
      if (target !== undefined) await work(target, action);
      record[`${at} | ${c.key} | ${action}`] = {
        writes,
        ...(asked.current !== undefined ? { asked: asked.current } : {}),
      };
      cleanup();
    }
  }
}

describe.skipIf(OUT === undefined)('what every effect card writes', () => {
  afterEach(cleanup);

  it('records every box, tick and button, and the add list', { timeout: 600_000 }, async () => {
    const record: Record<string, unknown> = {};
    for (const host of HOSTS) {
      if (ONLY !== undefined && !ONLY.includes(host.name)) continue;
      for (const [seed, base] of SEEDS) {
        if (host.seeds !== undefined && !host.seeds(seed, base)) continue;
        const effects = host.around?.(base) ?? base;
        await recordList(record, `${host.name} | ${seed}`, (writes, readOnly) =>
          mount(
            readOnly ? { ...host, props: { ...host.props, readOnly: true } } : host,
            effects,
            writes,
          ),
        );
      }
      // The add list: what each add button adds, and what More offers and adds.
      for (const start of [[], [{ kind: 'pick', id: 'choice', ask: 'skill' }]] as Json[][]) {
        const at = `${host.name} | add | ${start.length}`;
        const probe = mount(host, start, []);
        const adds = [...probe.container.querySelectorAll('button')]
          .map((b) => nameOf(b))
          .filter((n) => !n.startsWith('Remove'));
        cleanup();
        record[`${at} | buttons`] = adds;
        for (const name of adds) {
          asked.current = undefined;
          choice.current = undefined;
          const r = mount(host, start, []);
          const b = [...r.container.querySelectorAll('button')].find((x) => nameOf(x) === name);
          if (b !== undefined) fireEvent.click(b);
          await flush();
          const offer = asked.current as
            | { title?: string; options?: Array<{ id: string }> }
            | undefined;
          cleanup();
          if (offer?.options === undefined) {
            const writes: Write[] = [];
            const again = mount(host, start, writes);
            const b2 = [...again.container.querySelectorAll('button')].find(
              (x) => nameOf(x) === name,
            );
            if (b2 !== undefined) fireEvent.click(b2);
            await flush();
            record[`${at} | ${name}`] = writes;
            cleanup();
            continue;
          }
          record[`${at} | ${name} | asks`] = offer;
          for (const o of offer.options) {
            const writes: Write[] = [];
            choice.current = o.id;
            const again = mount(host, start, writes);
            const b2 = [...again.container.querySelectorAll('button')].find(
              (x) => nameOf(x) === name,
            );
            if (b2 !== undefined) fireEvent.click(b2);
            await flush();
            record[`${at} | ${name} | ${o.id}`] = writes;
            cleanup();
          }
        }
      }
    }
    // A feat's editor, whose guidance holds moments: what it hands `change`.
    if (ONLY === undefined || ONLY.includes('entryDraft')) {
      for (const [name, g] of ENTRY_DRAFTS) {
        await recordList(record, `entryDraft | ${name}`, (writes, readOnly) =>
          render(
            <EntryEffects
              draft={{ name: 'Fury Feat', source: 'Mine', castGuidance: structuredClone(g) }}
              change={(patch) => writes.push(['change', patch])}
              readOnly={readOnly}
            />,
          ),
        );
      }
    }
    if (OUT !== undefined) writeFileSync(OUT, `${JSON.stringify(record, null, 1)}\n`);
    expect(Object.keys(record).length).toBeGreaterThan(ONLY === undefined ? 1000 : 10);
    if (BEFORE === undefined) return;
    const all = JSON.parse(readFileSync(BEFORE, 'utf8')) as Record<string, unknown>;
    // With some hosts alone, the earlier record's other hosts are not compared.
    const before = Object.fromEntries(
      Object.entries(all).filter(
        ([k]) => ONLY === undefined || ONLY.includes(k.split(' | ')[0] ?? ''),
      ),
    );
    const diff = compareRecords(before, record);
    const say = (title: string, keys: string[]) =>
      `${title}: ${keys.length}${keys.length > 0 ? `\n  ${keys.slice(0, 40).join('\n  ')}` : ''}`;
    console.log(
      [
        say('Writes that differ', diff.writes),
        say('Gone', diff.gone),
        say('New', diff.added),
        say('Shown or asked differently', diff.other),
      ].join('\n'),
    );
    expect(diff.writes).toEqual([]);
    expect(diff.gone).toEqual([]);
  });
});
