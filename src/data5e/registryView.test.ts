// Each character's own view of the registry (ADR-002, D3, question 1): the
// shared registry keeps both versions of a changed entry, and a character's
// view gives it the one its own collection switches pick. A character the
// shared registry suits gets the shared registry itself.
import { describe, expect, it } from 'vitest';
import type { PackAppliesTo } from '@/engine/castGuidance';
import { RULE_PACK_TYPE, RULE_SET_TYPE } from '@/engine/castGuidance';
import { writeChange } from '@/features/workshop/copyWriter';
import type { Entity } from './copyMod';
import { type EntityRegistry, type EntityType, mergeHomebrew, normalizeDataset } from './normalize';
import { computeRegistrySignature } from './registry';
import { type DeviceOffFile, registryViewFor, setDeviceOffFiles } from './registryView';

const AID_TEXT = 'Each target’s Hit Point maximum and current Hit Points increase by 5.';

function release(): Map<string, unknown> {
  return new Map<string, unknown>([
    [
      'spells/spells-xphb.json',
      {
        spell: [
          {
            name: 'Aid',
            source: 'XPHB',
            level: 2,
            school: 'A',
            range: { type: 'point', distance: { type: 'feet', amount: 30 } },
            entries: ['Choose up to three creatures within range.', AID_TEXT],
          },
          { name: 'Fireball', source: 'XPHB', edition: 'one', level: 3, entries: ['Boom.'] },
        ],
      },
    ],
    [
      'class/class-barbarian.json',
      {
        class: [{ name: 'Barbarian', source: 'XPHB', edition: 'one' }],
        classFeature: [
          {
            name: 'Rage',
            source: 'XPHB',
            className: 'Barbarian',
            classSource: 'XPHB',
            level: 1,
            entries: ['You can imbue yourself with a primal power called Rage.'],
          },
        ],
      },
    ],
  ]);
}

const BOOK = normalizeDataset(release());
const bookAid = () => structuredClone(BOOK.get('spell', 'Aid', 'XPHB') as Entity);

/** Aid at +10, with the effect + Effect lands, as Change for your table would store it. */
function aidChange(): Entity {
  const aid = bookAid();
  return writeChange('spell', aid, {
    ...aid,
    entries: [(aid.entries as string[])[0], AID_TEXT.replace('5', '10')],
    castGuidance: { v: 1, effects: [{ kind: 'maxHpBonus', amount: 10 }] },
  });
}

const changesFile = (content: Record<string, Entity[]>) => ({
  _meta: { sources: [{ json: 'MyChanges', full: 'Changes to the books' }] },
  ...content,
});

/** A rule pack listing Aid among the entries it replaces. */
const packFile = (code = 'TBL') => ({
  _meta: {
    sources: [{ json: code, full: 'Our Table' }],
    castGuidance: { v: 1, replaces: [{ type: 'spell', name: 'Aid', source: 'XPHB' }] },
  },
  spell: [
    {
      name: 'Aid',
      source: 'XPHB',
      _copy: {
        name: 'Aid',
        source: 'XPHB',
        _mod: { entries: { mode: 'appendArr', items: ['At our table, it lasts a day.'] } },
      },
    },
  ],
});

interface Build {
  changes?: boolean;
  pack?: PackAppliesTo;
  off?: DeviceOffFile[];
}

function shared({ changes = true, pack, off = [] }: Build = {}): EntityRegistry {
  const reg = normalizeDataset(release());
  reg.setRuleSets([{ name: 'Base', source: 'APP' }]);
  // An imported collection's content, after the books', so the official part is not the whole list.
  const files = new Map<string, Record<string, unknown>>([
    [
      'brew',
      { _meta: { sources: [{ json: 'HB' }] }, spell: [{ name: 'Lucky Find', source: 'HB' }] },
    ],
  ]);
  if (pack !== undefined) files.set('pack', packFile());
  if (changes) files.set('changes', changesFile({ spell: [aidChange()] }));
  mergeHomebrew(
    reg,
    files,
    new Map(pack === undefined ? [] : [['pack', { appliesTo: pack }]]),
    new Set(changes ? ['changes'] : []),
  );
  setDeviceOffFiles(reg, off);
  return reg;
}

const hild = { id: 'hild', sourceSwitches: { off: ['MyChanges'] } };
const maren = { id: 'maren' };
const textOf = (reg: EntityRegistry) =>
  (reg.get('spell', 'Aid', 'XPHB')?.entries ?? []) as string[];
const aids = (reg: EntityRegistry) => reg.byType('spell').filter((s) => s.name === 'Aid');

describe('a character with Changes to the books off', () => {
  it('gets the book’s Aid, while Maren keeps the change in the shared registry itself', () => {
    const reg = shared();
    const hers = registryViewFor(reg, hild);
    expect(hers).not.toBe(reg);
    expect(textOf(hers)[1]).toBe(AID_TEXT);
    expect(hers.get('spell', 'Aid', 'XPHB')).toBe(
      reg.changeOf(reg.get('spell', 'Aid', 'XPHB') as Entity)?.base,
    );
    expect(hers.changeOf(hers.get('spell', 'Aid', 'XPHB') as Entity)).toBeUndefined();
    expect(aids(hers)).toHaveLength(1);
    expect(registryViewFor(reg, maren)).toBe(reg);
    expect(textOf(reg)[1]).toContain('increase by 10');
  });

  it('is matched by the collection’s source without case', () => {
    const reg = shared();
    const hers = registryViewFor(reg, { id: 'hild', sourceSwitches: { off: ['mychanges'] } });
    expect(textOf(hers)[1]).toBe(AID_TEXT);
  });

  it('another collection switched off leaves her the change', () => {
    const reg = shared();
    expect(registryViewFor(reg, { id: 'hild', sourceSwitches: { off: ['KIB'] } })).toBe(reg);
  });

  it('holds everything else the shared registry holds, as it holds it', () => {
    const reg = shared();
    const hers = registryViewFor(reg, hild);
    const sharedAid = reg.get('spell', 'Aid', 'XPHB');
    expect(hers.counts()).toEqual(reg.counts());
    expect(reg.officialCount('spell')).toBeLessThan(reg.byType('spell').length);
    for (const t of Object.keys(reg.counts()) as EntityType[]) {
      expect(hers.officialCount(t)).toBe(reg.officialCount(t));
      reg.byType(t).forEach((e, i) => {
        if (e !== sharedAid) expect(hers.byType(t)[i]).toBe(e);
      });
    }
    expect(hers.get('spell', 'Fireball', 'XPHB')).toBe(reg.get('spell', 'Fireball', 'XPHB'));
    expect(hers.sourceCounts()).toEqual(reg.sourceCounts());
    expect(hers.rulesBooks).toBe(reg.rulesBooks);
    expect(hers.byType(RULE_PACK_TYPE)).toEqual(reg.byType(RULE_PACK_TYPE));
    expect(hers.byType(RULE_SET_TYPE)).toEqual(reg.byType(RULE_SET_TYPE));
    expect(hers.ruleSetsFailed).toBe(reg.ruleSetsFailed);
    expect(hers.warnings).toEqual(expect.arrayContaining(reg.warnings));
  });
});

describe('a view', () => {
  it('is built once per pick, for every character picking alike, and is its own view', () => {
    const reg = shared();
    const hers = registryViewFor(reg, hild);
    expect(registryViewFor(reg, hild)).toBe(hers);
    expect(registryViewFor(reg, { id: 'osk', sourceSwitches: { off: ['MyChanges'] } })).toBe(hers);
    expect(registryViewFor(hers, hild)).toBe(hers);
    expect(registryViewFor(hers, maren)).toBe(reg);
    expect(registryViewFor(hers, undefined)).toBe(hers);
    expect(registryViewFor(reg, undefined)).toBe(reg);
  });

  it('is new for a new shared registry', () => {
    expect(registryViewFor(shared(), hild)).not.toBe(registryViewFor(shared(), hild));
  });
});

describe('a rule pack’s changes', () => {
  const lasts = 'At our table, it lasts a day.';

  it('reach the characters its Apply to names, under the player’s own change', () => {
    const reg = shared({ pack: { characters: ['maren'] } });
    // Not shared: everyone else's Aid is the player's change alone.
    expect(textOf(reg)).not.toContain(lasts);
    expect(registryViewFor(reg, { id: 'osk' })).toBe(reg);
    const hers = registryViewFor(reg, maren);
    expect(textOf(hers)).toContain(lasts);
    expect(textOf(hers)[1]).toContain('increase by 10');
    const placed = hers.get('spell', 'Aid', 'XPHB') as Entity;
    const record = hers.changeOf(placed);
    expect(record?.placed).toBe(placed);
    expect(record?.layers.map((l) => l.from.kind)).toEqual(['pack', 'changes']);
    expect(aids(hers)).toHaveLength(1);
  });

  it('stay with Changes to the books off', () => {
    const reg = shared({ pack: { characters: ['hild'] } });
    const hers = registryViewFor(reg, hild);
    expect(textOf(hers)).toContain(lasts);
    expect(textOf(hers)[1]).toBe(AID_TEXT);
  });

  it('applied to every character, stay for her, under no change of hers', () => {
    const reg = shared({ pack: { characters: [], appDefault: true } });
    expect(textOf(reg)).toContain(lasts);
    const hers = registryViewFor(reg, hild);
    expect(textOf(hers)).toContain(lasts);
    expect(textOf(hers)[1]).toBe(AID_TEXT);
  });

  it('follow its Apply to, not a switch on its source, as its patches do', () => {
    const reg = shared({ changes: false, pack: { characters: ['hild'] } });
    const hers = registryViewFor(reg, { id: 'hild', sourceSwitches: { off: ['TBL'] } });
    expect(textOf(hers)).toContain(lasts);
  });
});

describe('a collection switched off on the device', () => {
  const kibbles = (): DeviceOffFile => ({
    id: 'kib',
    json: {
      _meta: { sources: [{ json: 'KIB', full: 'Kibbles’ Compendium' }] },
      feat: [{ name: 'Ogre’s Grip', source: 'KIB', entries: ['You grip.'] }],
      spell: [{ name: 'Kindly Aid', source: 'KIB', _copy: { name: 'Aid', source: 'XPHB' } }],
    },
  });
  const osk = { id: 'osk', sourceSwitches: { on: ['kib'] } };

  it('reaches only the character that turns it on', () => {
    const reg = shared({ off: [kibbles()] });
    expect(reg.get('feat', 'Ogre’s Grip', 'KIB')).toBeUndefined();
    expect(registryViewFor(reg, maren)).toBe(reg);
    const his = registryViewFor(reg, osk);
    expect(his.get('feat', 'Ogre’s Grip', 'KIB')?.entries).toEqual(['You grip.']);
    expect(his.byType('feat').filter((f) => f.source === 'KIB')).toHaveLength(1);
    // Its copies resolve against his view, the player's change included.
    expect((his.get('spell', 'Kindly Aid', 'KIB')?.entries as string[])[1]).toContain(
      'increase by 10',
    );
    expect(his.sourceCounts().get('KIB')).toBe(2);
    // The changes it picks as the shared registry does are the shared registry's own.
    expect(his.get('spell', 'Aid', 'XPHB')).toBe(reg.get('spell', 'Aid', 'XPHB'));
    expect(his.officialCount('spell')).toBe(reg.officialCount('spell'));
  });

  it('is read again for each view, so a second one resolves as the first did', () => {
    const reg = shared({ off: [kibbles()] });
    registryViewFor(reg, osk);
    const both = registryViewFor(reg, {
      id: 'osk',
      sourceSwitches: { on: ['KIB'], off: ['MyChanges'] },
    });
    expect((both.get('spell', 'Kindly Aid', 'KIB')?.entries as string[])[1]).toBe(AID_TEXT);
    expect(both.get('feat', 'Ogre’s Grip', 'KIB')).toBeDefined();
  });

  it('keeps the device’s rule packs first, and lists its own after them', () => {
    const offPack: DeviceOffFile = {
      id: 'offpack',
      json: packFile('OFF'),
      pack: { appliesTo: { characters: ['osk'] } },
    };
    const reg = shared({ pack: { characters: ['maren'] }, off: [offPack] });
    const his = registryViewFor(reg, { id: 'osk', sourceSwitches: { on: ['OFF'] } });
    expect(his.byType(RULE_PACK_TYPE).map((p) => p.source)).toEqual(['TBL', 'OFF']);
  });

  it('as Changes to the books, places its changes rather than adding a second Aid', () => {
    const off: DeviceOffFile = {
      id: 'changes',
      json: changesFile({ spell: [aidChange()] }),
      role: 'changes',
    };
    const reg = shared({ changes: false, off: [off] });
    expect(textOf(reg)[1]).toBe(AID_TEXT);
    const his = registryViewFor(reg, { id: 'osk', sourceSwitches: { on: ['MyChanges'] } });
    expect(textOf(his)[1]).toContain('increase by 10');
    expect(aids(his)).toHaveLength(1);
  });
});

describe('the registry signature', () => {
  const on = [{ id: 'a', rev: 1 }];

  it('is what it was for a device with nothing switched off', () => {
    expect(computeRegistrySignature('t', ['x.json'], on)).toBe('t|x.json|hb:a@1');
    expect(computeRegistrySignature('t', ['x.json'], on, [])).toBe('t|x.json|hb:a@1');
  });

  it('moves with a file switched off, and with its edits', () => {
    const one = computeRegistrySignature('t', ['x.json'], on, [{ id: 'kib', rev: 1 }]);
    expect(one).not.toBe(computeRegistrySignature('t', ['x.json'], on));
    expect(one).not.toBe(computeRegistrySignature('t', ['x.json'], on, [{ id: 'kib', rev: 2 }]));
    // A file moving between the lists moves it too.
    expect(one).not.toBe(computeRegistrySignature('t', ['x.json'], [...on, { id: 'kib', rev: 1 }]));
  });
});
