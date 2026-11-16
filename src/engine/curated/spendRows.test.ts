/**
 * Built-in `spend` rows on paths the pinned release cannot show (rule pack port
 * 3b): a Workshop copy renamed, an entry's `replace` and `drop`, and a buy-back
 * whose target is found by its label. Rows and entries are invented, except the
 * shipped keys of the four links that name another feature's action, whose
 * feature and action names are rule facts.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { Collector } from '../effects/base';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { linkSpend } from './spendLinks';

function world(extra: Record<string, DataEntity[]>): EngineContext {
  const base = makeTestContext();
  return {
    get(type, name, source) {
      const hit = (extra[type] ?? []).find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      );
      return hit ?? base.get(type, name, source);
    },
    byType: (type) => [...base.byType(type), ...(extra[type] ?? [])],
  };
}

const spendSet = (rows: unknown[]) =>
  ({ type: RULE_SET_TYPE, v: 1, name: 'Homebrew spend links', rows }) as DataEntity;

/** A Hit Point Die price, which every build with a class can pay, so the sheet shows it. */
const DIE_PRICE = {
  cost: { resource: 'hit-die', amount: 1, hitDieHeals: 'roll' },
  economy: 'bonus',
};

/** The actions priced with a Hit Point Die: label, economy and what gives them. */
const priced = (sheet: ReturnType<typeof deriveSheet>) =>
  sheet.actions
    .filter((a) => a.cost?.resource === 'hit-die')
    .map((a) => [a.label, a.economy, a.origin]);

/** A Warrior (TST) 4, who takes one Combat Stance (`FS:T`). */
const warrior = (edit: (d: CharacterDoc) => void = () => {}): CharacterDoc => {
  const doc = newCharacterDoc('hero', 'Hero', 'test');
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: Array(4).fill('avg') }];
  edit(doc);
  return doc;
};

describe('a built-in spend row on a homebrew feat', () => {
  const lantern: DataEntity = { name: 'Lantern', source: 'HB', entries: ['Placeholder.'] };
  const copy = (castGuidance: Record<string, unknown> = {}): DataEntity => ({
    name: 'Bright Lantern',
    source: 'HB',
    entries: ['Placeholder.'],
    castGuidance: { v: 1, basedOn: 'Lantern|HB', ...castGuidance },
  });
  const sheetOf = (feat: DataEntity) =>
    deriveSheet(
      warrior((d) => {
        d.feats = [{ ref: { name: String(feat.name), source: 'HB' }, instanceId: 'f0' }];
      }),
      world({
        feat: [lantern, feat],
        [RULE_SET_TYPE]: [spendSet([{ part: 'spend', keys: ['lantern|hb'], links: [DIE_PRICE] }])],
      }),
    );
  it('prices the feat it is keyed under', () => {
    expect(priced(sheetOf(lantern))).toEqual([['Lantern', 'bonus', 'Lantern']]);
  });

  it("prices a renamed Workshop copy, its chip under the copy's name", () => {
    // Roll prices look an action up by its source's name first, so the chip
    // must carry the name the sheet shows, not the official one.
    expect(priced(sheetOf(copy()))).toEqual([['Bright Lantern', 'bonus', 'Bright Lantern']]);
  });

  it('is dropped by an entry that drops actions, of any label or of its own', () => {
    expect(priced(sheetOf(copy({ drop: [{ kind: 'action' }] })))).toEqual([]);
    expect(priced(sheetOf(copy({ drop: [{ kind: 'action', label: 'Bright Lantern' }] })))).toEqual(
      [],
    );
    expect(priced(sheetOf(copy({ drop: [{ kind: 'action', label: 'Another' }] })))).toHaveLength(1);
  });

  it('is skipped by an entry that replaces what it inherits', () => {
    const replaced = copy({ replace: true, effects: [{ kind: 'cue', text: 'Lit' }] });
    const sheet = sheetOf(replaced);
    expect(priced(sheet)).toEqual([]);
    expect(sheet.cues.map((c) => c.text)).toContain('Lit');
  });
});

describe('a built-in spend row on a homebrew optional feature', () => {
  const stance: DataEntity = {
    name: 'Lantern Stance',
    source: 'HB',
    featureType: ['FS:T'],
    entries: ['Placeholder.'],
  };
  const copy: DataEntity = {
    name: 'Bright Stance',
    source: 'HB',
    featureType: ['FS:T'],
    entries: ['Placeholder.'],
    castGuidance: { v: 1, basedOn: 'Lantern Stance|HB' },
  };
  const sheetOf = (picked: string) => {
    const ctx = world({
      optionalfeature: [stance, copy],
      [RULE_SET_TYPE]: [
        spendSet([{ part: 'spend', keys: ['lantern stance|hb'], links: [DIE_PRICE] }]),
      ],
    });
    const doc = warrior();
    const prompt = deriveSheet(doc, ctx).pending.find((p) => p.kind === 'optionalfeature');
    if (prompt === undefined) throw new Error('no Combat Stance pick');
    doc.choices[prompt.id] = [picked];
    return deriveSheet(doc, ctx);
  };

  it("names the action it adds for the option alone, as roll prices look it up, and a copy's for the copy", () => {
    // The host's pick names the origin ("Combat Stance: Lantern Stance").
    expect(priced(sheetOf('lantern stance|hb'))).toEqual([
      ['Lantern Stance', 'bonus', 'Combat Stance: Lantern Stance'],
    ]);
    expect(priced(sheetOf('bright stance|hb'))).toEqual([
      ['Bright Stance', 'bonus', 'Combat Stance: Bright Stance'],
    ]);
  });
});

describe("a shipped buy-back finds another feature's action by its label", () => {
  // The four shipped links that name another feature's action land only on
  // that exact label.
  const LINKS = [
    {
      key: 'sorcery incarnate|sorcerer|xphb',
      target: 'Innate Sorcery',
      buyBack: { resource: 'sorcery-points', amount: 2 },
    },
    {
      key: 'totems|shaman|wow',
      target: 'Primal Knowledge Totem',
      buyBack: { resource: 'rage', amount: 1 },
    },
    {
      key: 'font of inspiration|bard|xphb',
      target: 'Bardic Inspiration',
      buyBack: { resource: 'spell-slot', amount: 1, own: 'bardic-inspiration' },
    },
    {
      key: 'wild resurgence|druid|xphb',
      target: 'Wild Shape',
      buyBack: { resource: 'spell-slot', amount: 1, own: 'wild-shape' },
    },
  ] as const;
  const own: EffectOrigin = { label: 'Linker', uid: 'linker|hb', type: 'class' };
  const other: EffectOrigin = { label: 'Target', uid: 'target|hb', type: 'class' };

  /** The actions after the key links, with the target action under `label`. */
  const linked = (key: string, label: string) => {
    const col = new Collector(newCharacterDoc('hero', 'Hero', 'test'), makeTestContext());
    col.add({ kind: 'action', economy: 'bonus', label, origin: other });
    linkSpend(col, [key], 'Linker', own);
    return col.effects.flatMap((e) =>
      e.kind === 'action' ? [{ label: e.label, buyBack: e.buyBack, mine: e.origin === own }] : [],
    );
  };

  for (const { key, target, buyBack } of LINKS) {
    const bySlot = buyBack.resource === 'spell-slot';

    it(`${key}: lands on ${target}`, () => {
      expect(linked(key, target)).toEqual([{ label: target, buyBack, mine: false }]);
    });

    it(`${key}: misses a renamed or class-named ${target}${bySlot ? ', adding nothing' : ', adding its own chip'}`, () => {
      for (const label of [`Bright ${target}`, `${target} (Homebrew)`]) {
        expect(linked(key, label)).toEqual([
          { label, buyBack: undefined, mine: false },
          ...(bySlot ? [] : [{ label: target, buyBack, mine: true }]),
        ]);
      }
    });
  }
});
