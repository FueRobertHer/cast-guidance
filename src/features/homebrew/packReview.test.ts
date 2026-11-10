import { describe, expect, it } from 'vitest';
import {
  type PackAppliesTo,
  RULE_PACK_TYPE,
  readTableRules,
  TABLE_RULES,
  type TableRuleChoices,
  type TableRuleId,
} from '@/engine/castGuidance';
import { tableRulesFor } from '@/engine/rules';
import {
  describeConflict,
  describeIncomingConflict,
  type PackInPlay,
  packConflicts,
  packReview,
  RULE_WORDS,
  targetWords,
} from './importPreview';

const every: PackAppliesTo = { characters: [], appDefault: true };
const to = (...characters: string[]): PackAppliesTo => ({ characters });
const pack = (id: string, guidance: Record<string, unknown>, appliesTo?: PackAppliesTo) =>
  ({
    id,
    name: id,
    guidance: { v: 1, ...guidance },
    ...(appliesTo === undefined ? {} : { appliesTo }),
  }) satisfies PackInPlay;
const rest = (value: string) => ({ tableRules: { restLength: value } });

describe('where packs disagree', () => {
  it('the later wins between two alike, and packs that agree are no clash', () => {
    const got = packConflicts([
      pack('Gritty', { tableRules: { restLength: 'gritty', critDamage: 'maxPlusRoll' } }, every),
      pack('Heroic', { tableRules: { restLength: 'heroic', critDamage: 'maxPlusRoll' } }, every),
    ]);
    expect(got.map(describeConflict)).toEqual([
      'Gritty and Heroic both set rest length. Heroic wins: it comes later in your pack order.',
    ]);
  });

  it('a pack applied to the characters wins over one applied to every character', () => {
    const [clash] = packConflicts([
      pack('Chosen', rest('gritty'), to('hild')),
      pack('Everyone', rest('heroic'), every),
    ]);
    expect(clash && describeConflict(clash)).toBe(
      'Chosen and Everyone both set rest length. Chosen wins: it is applied to those characters, over every character.',
    );
  });

  it('packs that reach no character in common, or nobody, do not clash', () => {
    expect(
      packConflicts([
        pack('Hild’s', rest('gritty'), to('hild')),
        pack('Bram’s', rest('heroic'), to('bram')),
        pack('Nobody’s', rest('standard')),
        pack('Empty', rest('standard'), to()),
      ]),
    ).toEqual([]);
  });

  it('two packs replacing one entry clash; adding to it does not', () => {
    const replace = (target: string) => ({ patches: [{ target, effects: [] }] });
    const got = packConflicts([
      pack(
        'One',
        {
          patches: [
            { target: 'Rage|Barbarian', effects: [] },
            { target: 'Alert|PHB', add: [] },
          ],
        },
        every,
      ),
      pack('Two', replace('rage|barbarian'), to('hild')),
      pack('Three', { patches: [{ target: 'Alert|PHB', add: [] }] }, every),
    ]);
    expect(got.map(describeConflict)).toEqual([
      'One and Two both set Rage (Barbarian). Two wins: it comes later in your pack order.',
    ]);
  });

  it('works out the winner character by character, as the engine does', () => {
    const got = packConflicts([
      pack('Gritty', rest('gritty'), to('hild')),
      pack('Heroic', rest('heroic'), to('bram')),
      pack('Standard', rest('standard'), every),
    ]);
    expect(got.map(describeConflict)).toEqual([
      'Gritty and Standard both set rest length. Gritty wins: it is applied to those characters, over every character.',
      'Heroic and Standard both set rest length. Heroic wins: it is applied to those characters, over every character.',
    ]);
    const three = packConflicts([
      pack('A', rest('gritty'), every),
      pack('B', rest('heroic'), to('hild')),
      pack('C', rest('standard'), every),
    ]);
    expect(three.map(describeConflict)).toEqual([
      'A, B and C all set rest length. B wins: it is applied to those characters, over every character.',
      'A and C both set rest length. C wins: it comes later in your pack order.',
    ]);
  });

  it('wins by order over a pack that also names the character', () => {
    const party = pack('Party', rest('standard'), to('hild', 'bram'));
    const everyone = pack('Everyone', rest('gritty'), every);
    const bram = pack('Bram', rest('gritty'), to('bram'));
    expect(packConflicts([party, everyone, bram]).map(describeConflict)).toEqual([
      'Party and Everyone both set rest length. Party wins: it is applied to those characters, over every character.',
      'Party, Everyone and Bram all set rest length. Bram wins: it comes later in your pack order.',
    ]);
    expect(packConflicts([bram, party, everyone]).map(describeConflict)).toEqual([
      'Bram, Party and Everyone all set rest length. Party wins: it comes later in your pack order.',
      'Party and Everyone both set rest length. Party wins: it is applied to those characters, over every character.',
    ]);
  });

  it('names as the winner the rule the engine plays by, for every rule and everyone', () => {
    const everyone = pack(
      'Everyone',
      { tableRules: { critDamage: 'maxPlusRoll', restLength: 'gritty', hpOnLongRest: 'half' } },
      every,
    );
    const also = pack(
      'Also everyone',
      { tableRules: { critDamage: 'doubleDice', hpOnLongRest: 'hitDice' } },
      every,
    );
    const hilds = pack(
      'Hild’s',
      { tableRules: { critDamage: 'doubleTotal', restLength: 'gritty', hpOnLongRest: 'all' } },
      to('hild'),
    );
    const settings = [
      {},
      { critDamage: 'doubleDice' },
      { hpOnLongRest: 'hitDice', flanking: 'advantage' },
      // A value Settings cannot hold is no choice, as the engine reads it.
      { critDamage: 'bogus' },
    ] as Array<Partial<TableRuleChoices>>;
    const orders = [
      [everyone, also, hilds],
      [everyone, hilds, also],
      [also, everyone, hilds],
      [also, hilds, everyone],
      [hilds, everyone, also],
      [hilds, also, everyone],
    ];
    const rulesOf = (p: PackInPlay) => readTableRules(p.guidance.tableRules).rules;
    let checked = 0;
    for (const order of orders) {
      for (const chosen of settings) {
        const clashes = packConflicts(order, chosen);
        const read = readTableRules(chosen).rules;
        // The registry's packs, as `rulePackEntries` hands them to the engine.
        const ctx = {
          byType: (type: string) =>
            type === RULE_PACK_TYPE
              ? order.map((p) => ({
                  name: p.name,
                  castGuidance: p.guidance,
                  appliesTo: p.appliesTo,
                }))
              : [],
          rules: chosen,
        };
        // Hild's sets every rule a pack here sets, so a clash it is in is Hild's, and one it is not in, everyone else's.
        for (const who of ['hild', 'bram']) {
          const played = tableRulesFor({ id: who, rulesVersion: '2024' }, ctx).rules;
          const theirs = clashes.filter((c) => (who === 'hild') === c.ids.includes(hilds.id));
          const clashOn = (id: TableRuleId) =>
            theirs.find((c) => c.what === RULE_WORDS[id].name.toLowerCase());
          for (const id of Object.keys(TABLE_RULES) as TableRuleId[]) {
            const clash = clashOn(id);
            const winner = order.find((p) => p.id === clash?.winnerId);
            if (winner === undefined) continue;
            const where = `${who}, ${id}, ${order.map((p) => p.name).join(' < ')}, ${JSON.stringify(chosen)}`;
            expect(rulesOf(winner)[id], where).toBe(played[id]);
            checked += 1;
          }
          // The every-character packs disagree on crits and HP on a long rest, and Hild's too;
          // a choice in Settings hides only the every-character packs.
          const crits = clashOn('critDamage');
          expect(crits !== undefined, `${who} crits`).toBe(read.critDamage === undefined);
          expect(clashOn('hpOnLongRest') !== undefined, `${who} HP`).toBe(
            read.hpOnLongRest === undefined,
          );
          expect(clashOn('restLength')).toBeUndefined();
          if (who === 'hild') {
            expect(played.critDamage).toBe('doubleTotal');
            expect(crits?.why ?? 'chosen').toBe('chosen');
          }
        }
      }
    }
    // Per order: crits and HP for both under no choice or a bogus one, one of them under each other.
    expect(checked).toBe(orders.length * (4 + 2 + 2 + 4));
  });

  it('keeps everyone else apart from a character, whatever their id', () => {
    const odd = '\u0000anyone else';
    expect(
      packConflicts([
        pack('A', rest('gritty'), every),
        pack('B', rest('heroic'), every),
        pack('C', rest('standard'), to(odd)),
      ]).map(describeConflict),
    ).toEqual([
      'A, B and C all set rest length. C wins: it is applied to those characters, over every character.',
      'A and B both set rest length. B wins: it comes later in your pack order.',
    ]);
  });

  it('a rule chosen in Settings is over every pack applied to every character', () => {
    const settings = { restLength: 'standard' } as const;
    expect(
      packConflicts(
        [pack('Gritty', rest('gritty'), every), pack('Heroic', rest('heroic'), every)],
        settings,
      ),
    ).toEqual([]);
    expect(
      packConflicts(
        [pack('Chosen', rest('gritty'), to('hild')), pack('Everyone', rest('heroic'), every)],
        settings,
      ),
    ).toEqual([]);
    // Packs applied to a character are over Settings, so two of them still clash.
    expect(
      packConflicts(
        [pack('One', rest('gritty'), to('hild')), pack('Two', rest('heroic'), to('hild'))],
        settings,
      ).map(describeConflict),
    ).toEqual(['One and Two both set rest length. Two wins: it comes later in your pack order.']);
  });

  it('leaves out what the engine does not count', () => {
    const unread = (id: string, guidance: Record<string, unknown>) => ({
      ...pack(id, guidance, every),
      guidance: { ...guidance, v: 99 },
    });
    expect(
      packConflicts([pack('Gritty', rest('gritty'), every), unread('Later', rest('heroic'))]),
    ).toEqual([]);
    // A list none of whose effects can be read replaces nothing.
    expect(
      packConflicts([
        pack('One', { patches: [{ target: 'Rage|Barbarian', effects: [] }] }, every),
        pack('Two', { patches: [{ target: 'Rage|Barbarian', effects: [{ kind: 'odd' }] }] }, every),
      ]),
    ).toEqual([]);
  });

  it('keys and names a target whole, however long', () => {
    const long = `${'A very long feature name that runs on'.padEnd(60, 'x')}|Book`;
    const replace = (target: string) => ({ patches: [{ target, effects: [] }] });
    expect(
      packConflicts([
        pack('One', replace(long), every),
        pack('Two', replace(`${long.slice(0, 45)}y|Book`), every),
      ]),
    ).toEqual([]);
    const [clash] = packConflicts([
      pack('One', replace(long), every),
      pack('Two', replace(long), every),
    ]);
    expect(clash?.what).toBe(targetWords(long));
  });

  it('says a clash from the side of a pack coming in', () => {
    const packs = [pack('Gritty', rest('gritty'), every), pack('In', rest('heroic'), every)];
    const [clash] = packConflicts(packs);
    expect(clash && describeIncomingConflict(clash, 'In')).toBe(
      'Sets rest length, which Gritty also sets. In would win, as it goes last in your pack order.',
    );
    const [held] = packConflicts([
      pack('Gritty', rest('gritty'), to('hild')),
      { ...packs[1], appliesTo: every } as PackInPlay,
    ]);
    expect(held && describeIncomingConflict(held, 'In')).toBe(
      'Sets rest length, which Gritty also sets. Gritty would still win, as it is applied to those characters.',
    );
  });
});

describe('what a pack holds', () => {
  it('names a target as the player reads it', () => {
    expect(targetWords('Rage|Barbarian')).toBe('Rage (Barbarian)');
    expect(targetWords('Rage')).toBe('Rage');
    expect(targetWords('Hunter|Ranger|PHB')).toBe('Hunter (Ranger, PHB)');
  });

  it('lists what it cannot read, and holds nothing the app reads', () => {
    const review = packReview({
      _meta: {
        sources: [{ json: 'Odd' }],
        castGuidance: { v: 1, tables: [], tableRules: { restLength: 'forever' } },
      },
    });
    expect(review?.name).toBe('Odd');
    expect(review?.holds).toBe('Nothing the app reads yet');
    expect(review?.problems).toEqual([
      '"tables" is not part of a rule pack, so it is not read',
      'table rules: restLength is one of standard, gritty, heroic',
    ]);
    expect(packReview({ _meta: { sources: [{ json: 'X' }] }, spell: [] })).toBeUndefined();
  });

  it('shows its words whole', () => {
    const said = 'A long rest needs a safe haven, a warm meal and a watch kept all night.';
    const target = 'Sharpshooter Training of the Far Northern Rangers|Book';
    const review = packReview({
      _meta: {
        sources: [{ json: 'Words' }],
        castGuidance: {
          v: 1,
          patches: [{ target, add: [{ kind: 'initiativeBonus', amount: 1 }] }],
          cues: [{ at: 'longRest', text: said, tone: 'warn' }],
        },
      },
    });
    expect(review?.changes.map((c) => c.key)).toEqual([targetWords(target)]);
    expect(review?.moments.map((m) => m.value)).toEqual([`Says "${said}"`]);
  });
});
