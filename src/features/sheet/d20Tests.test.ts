// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rollDetail } from '@/dice/format';
import {
  type ActiveCondition,
  conditionSpeed,
  type D20Test,
  d20Effects,
  type Edition,
} from '@/engine/conditions';
import type { RollEffects } from '@/engine/playRules';
import { ABILITIES, type Ability } from '@/engine/types';
import { advModeStore } from '@/stores/advMode';
import { rollTone } from '@/ui/rollTone';
import { conditionLimits } from './conditionEffects';
import {
  conditionWear,
  effectLines,
  noteLines,
  rollD20Test,
  rollWear,
  saveEffectLines,
  useIgnoreOnce,
} from './d20Tests';

/** The faces the next dice show, in order (the roller draws from crypto). */
function nextFaces(...faces: number[]) {
  const queue = [...faces];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
    const face = queue.shift();
    if (face === undefined) throw new Error('rolled more dice than the test set up');
    if (buf instanceof Uint32Array) buf[0] = face - 1;
    return buf;
  });
}

const effects = (ids: ActiveCondition[], edition: Edition, test: D20Test) =>
  d20Effects(ids, edition, test);

beforeEach(() => advModeStore.getState().set('normal'));
afterEach(() => vi.restoreAllMocks());

describe('rollWear: what each roll’s control wears', () => {
  const onRoll = (ids: string[], test: D20Test, edition: Edition = '2014') =>
    rollWear(
      ids.map((id) => ({ id })),
      effects(
        ids.map((id) => ({ id })),
        edition,
        test,
      ),
      false,
    ).looks;

  it('wears a save that fails automatically, only on the abilities the rule reaches', () => {
    for (const id of ['Paralyzed', 'Petrified', 'Stunned', 'Unconscious']) {
      expect(onRoll([id], { kind: 'save', ability: 'str' }), id).toEqual([id]);
      expect(onRoll([id], { kind: 'save', ability: 'dex' }), id).toEqual([id]);
      expect(onRoll([id], { kind: 'save', ability: 'wis' }), id).toEqual([]);
    }
  });

  it('wears Restrained on DEX saves alone', () => {
    expect(onRoll(['Restrained'], { kind: 'save', ability: 'dex' })).toEqual(['Restrained']);
    expect(onRoll(['Restrained'], { kind: 'save', ability: 'str' })).toEqual([]);
  });

  it('wears exhaustion on saves from level 3 in 2014, and any level in 2024', () => {
    const save = (level: number, edition: Edition) =>
      rollWear(
        [{ id: 'Exhaustion', level }],
        effects([{ id: 'Exhaustion', level }], edition, { kind: 'save', ability: 'wis' }),
        false,
      );
    expect(save(2, '2014').looks).toEqual([]);
    expect(save(3, '2014').looks).toEqual(['Exhaustion']);
    expect(save(1, '2024')).toEqual({ looks: ['Exhaustion'], ignored: false, penalty: -2 });
  });

  it('wears checks for what reaches them, and leaves Blinded and Deafened to their notes', () => {
    const check = { kind: 'check', ability: 'str' } as const;
    expect(onRoll(['Poisoned'], check)).toEqual(['Poisoned']);
    expect(onRoll(['Frightened'], check)).toEqual(['Frightened']);
    expect(onRoll(['Blinded'], check)).toEqual([]);
    expect(onRoll(['Deafened'], check)).toEqual([]);
    const exhausted = (level: number, edition: Edition) =>
      rollWear(
        [{ id: 'Exhaustion', level }],
        effects([{ id: 'Exhaustion', level }], edition, check),
        false,
      ).looks;
    expect(exhausted(1, '2014')).toEqual(['Exhaustion']);
    expect(exhausted(1, '2024')).toEqual(['Exhaustion']);
  });

  it('wears initiative by the edition', () => {
    const initiative = { kind: 'initiative' } as const;
    expect(onRoll(['Poisoned'], initiative)).toEqual(['Poisoned']);
    expect(onRoll(['Frightened'], initiative)).toEqual(['Frightened']);
    for (const id of ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious']) {
      expect(onRoll([id], initiative), id).toEqual([]);
      expect(onRoll([id], initiative, '2024'), id).toEqual([id]);
    }
    expect(onRoll(['Invisible'], initiative)).toEqual([]);
    expect(onRoll(['Invisible'], initiative, '2024')).toEqual(['Invisible']);
  });

  it('says Ignore once is armed on a save it reaches, for the ring', () => {
    const paralyzed = [{ id: 'Paralyzed' }];
    expect(
      rollWear(paralyzed, effects(paralyzed, '2014', { kind: 'save', ability: 'dex' }), true),
    ).toEqual({ looks: ['Paralyzed'], ignored: true });
  });
});

describe('conditionWear: what a control with no cue of its own wears', () => {
  const speed = (conditions: ActiveCondition[], edition: Edition = '2014') =>
    conditionWear(conditions, conditionSpeed(30, conditions, edition).sources);

  it('wears Cast only for what stops casting', () => {
    const cast = (id: string) =>
      conditionWear([{ id }], conditionLimits([{ id }], '2014').noActions).looks;
    for (const id of ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious']) {
      expect(cast(id), id).toEqual([id]);
    }
    for (const id of ['Poisoned', 'Blinded', 'Prone', 'Restrained', 'Frightened', 'Grappled']) {
      expect(cast(id), id).toEqual([]);
    }
  });

  it('wears Speed for what holds it at 0, with Grappled the only roll-free look', () => {
    for (const id of ['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Unconscious']) {
      expect(speed([{ id }]).looks, id).toEqual([id]);
      expect(speed([{ id }], '2024').looks, id).toEqual([id]);
    }
    expect(speed([{ id: 'Stunned' }]).looks).toEqual(['Stunned']);
    expect(speed([{ id: 'Stunned' }], '2024').looks).toEqual([]);
    expect(speed([{ id: 'Poisoned' }]).looks).toEqual([]);
  });

  it('wears exhaustion on Speed once it lowers it, with no tag', () => {
    const at = (level: number, edition: Edition) => speed([{ id: 'Exhaustion', level }], edition);
    expect(at(1, '2014').looks).toEqual([]);
    expect(at(2, '2014')).toEqual({ looks: ['Exhaustion'], ignored: false });
    expect(at(1, '2024')).toEqual({ looks: ['Exhaustion'], ignored: false });
  });
});

describe('rollWear on an attack chip', () => {
  /** As the sheet works it out, from the same effects and warning the cue reads. */
  const wear = (conditions: ActiveCondition[], edition: Edition = '2014', armed = false) =>
    rollWear(
      conditions,
      effects(conditions, edition, { kind: 'attack' }),
      armed,
      conditionLimits(conditions, '2014').noActions,
    );
  const looks = (...ids: string[]) => wear(ids.map((id) => ({ id }))).looks;

  it('wears each condition that changes the roll', () => {
    for (const id of ['Blinded', 'Frightened', 'Poisoned', 'Prone', 'Restrained', 'Invisible']) {
      expect(looks(id), id).toEqual([id]);
    }
  });

  it('wears the ones that only stop actions, through the same warning the tab shows', () => {
    for (const id of ['Paralyzed', 'Stunned', 'Incapacitated', 'Petrified', 'Unconscious']) {
      expect(looks(id), id).toEqual([id]);
    }
  });

  it('stays plain for the conditions that only carry a note, or nothing for attacks', () => {
    expect(looks('Charmed')).toEqual([]);
    expect(looks('Deafened')).toEqual([]);
    expect(looks('Grappled')).toEqual([]);
    expect(wear([{ id: 'Grappled' }], '2024').looks).toEqual([]);
  });

  it('draws exhaustion by the edition: 2014 from level 3, with no tag', () => {
    const at = (level: number) => wear([{ id: 'Exhaustion', level }]);
    expect(at(2)).toEqual({ looks: [], ignored: false });
    expect(at(3)).toEqual({ looks: ['Exhaustion'], ignored: false });
  });

  it('draws exhaustion by the edition: 2024 from level 1, tagged with its penalty', () => {
    expect(wear([{ id: 'Exhaustion', level: 2 }], '2024')).toEqual({
      looks: ['Exhaustion'],
      ignored: false,
      penalty: -4,
    });
    expect(wear([{ id: 'Exhaustion', level: 0 }], '2024')).toEqual({ looks: [], ignored: false });
  });

  it('adds no look for what a condition implies', () => {
    // Prone and Incapacitated come with Unconscious, in the cue and on the chip.
    expect(looks('Unconscious')).toEqual(['Unconscious']);
    expect(looks('Paralyzed')).toEqual(['Paralyzed']);
    expect(looks('Stunned')).toEqual(['Stunned']);
    expect(looks('Petrified')).toEqual(['Petrified']);
    // Set by hand as well, it is a condition of its own.
    expect(looks('Unconscious', 'Prone')).toEqual(['Prone', 'Unconscious']);
  });

  it('adds none for one the rules suppress', () => {
    expect(looks('Poisoned', 'Petrified')).toEqual(['Petrified']);
  });

  it('adds none for one switched off on its sheet', () => {
    expect(wear([{ id: 'Poisoned', ignored: true }]).looks).toEqual([]);
    expect(wear([{ id: 'Paralyzed', ignored: true }]).looks).toEqual([]);
    expect(wear([{ id: 'Exhaustion', level: 3, ignored: true }], '2024')).toEqual({
      looks: [],
      ignored: false,
    });
  });

  it('puts the newest first, the last one added', () => {
    expect(looks('Poisoned', 'Blinded', 'Prone')).toEqual(['Prone', 'Blinded', 'Poisoned']);
  });

  it('shows both when advantage and disadvantage meet: the cue says they cancel', () => {
    expect(looks('Invisible', 'Poisoned')).toEqual(['Poisoned', 'Invisible']);
  });

  it('says Ignore once is armed, keeping the looks for the ring', () => {
    expect(wear([{ id: 'Poisoned' }], '2014', true)).toEqual({
      looks: ['Poisoned'],
      ignored: true,
    });
  });
});

describe('rollD20Test', () => {
  it('is a plain roll when no condition reaches it', () => {
    nextFaces(12);
    const r = rollD20Test('1d20+3', {
      label: 'STR check',
      effects: effects([], '2014', { kind: 'check' }),
    });
    expect(r.total).toBe(15);
    expect(r.meta).toEqual({ d20: { natural: 12 } });
  });

  it("rolls a condition's disadvantage and says so", () => {
    nextFaces(15, 4);
    const r = rollD20Test('1d20+3', {
      label: 'STR check',
      effects: effects([{ id: 'Poisoned' }], '2014', { kind: 'check', ability: 'str' }),
    });
    expect(r.total).toBe(7);
    expect(r.meta).toMatchObject({ advantage: 'dis', cue: 'Disadvantage: Poisoned' });
  });

  it('rolls a single d20 when ignored once, keeping the dock mode', () => {
    nextFaces(15);
    const poisoned = effects([{ id: 'Poisoned' }], '2014', { kind: 'attack' });
    const r = rollD20Test('1d20+5', { label: 'Attack', effects: poisoned, ignored: true });
    expect(r.total).toBe(20);
    expect(r.meta?.advantage).toBeUndefined();
    expect(r.meta?.cue).toBe('Conditions ignored for this roll');

    advModeStore.getState().set('adv');
    nextFaces(3, 17);
    const withDock = rollD20Test('1d20+5', { label: 'Attack', effects: poisoned, ignored: true });
    expect(withDock.meta?.advantage).toBe('adv');
    expect(withDock.total).toBe(22);
  });

  it("cancels the dock's advantage against a condition's disadvantage", () => {
    advModeStore.getState().set('adv');
    nextFaces(9);
    const r = rollD20Test('1d20+5', {
      label: 'Attack',
      effects: effects([{ id: 'Prone' }], '2024', { kind: 'attack' }),
    });
    expect(r.terms[0]).toMatchObject({ rolls: [{ v: 9, kept: true }] });
    expect(r.meta?.advantage).toBeUndefined();
    expect(r.meta?.cue).toBe('Advantage and disadvantage cancel: Prone');
  });

  it('takes the 2024 exhaustion penalty off as a term of its own', () => {
    nextFaces(10);
    const r = rollD20Test('1d20+3', {
      label: 'WIS save',
      effects: effects([{ id: 'Exhaustion', level: 2 }], '2024', { kind: 'save', ability: 'wis' }),
    });
    expect(r.expr).toBe('1d20+3-4');
    expect(r.total).toBe(9);
    expect(r.terms.at(-1)).toEqual({ kind: 'mod', value: -4 });
    expect(r.meta?.cue).toBe('−4: Exhaustion 2');
  });

  it('marks an automatic failure without hiding the dice, even on a natural 20', () => {
    nextFaces(20);
    const r = rollD20Test('1d20+2', {
      label: 'DEX save',
      effects: effects([{ id: 'Stunned' }], '2024', { kind: 'save', ability: 'dex' }),
    });
    expect(r.total).toBe(22);
    expect(r.meta).toMatchObject({
      autoFail: true,
      cue: 'Fails automatically: Stunned',
      d20: { natural: 20 },
    });
    expect(rollTone(r)).toBe('fumble');
  });

  it("keeps a feature's advantage when the conditions are ignored", () => {
    // One die for the cancelled roll, two for the advantage one.
    nextFaces(5, 14, 6);
    const exhausted = effects([{ id: 'Exhaustion', level: 3 }], '2014', {
      kind: 'save',
      ability: 'con',
    });
    const cancelled = rollD20Test('1d20+2', {
      label: 'Concentration',
      effects: exhausted,
      advantageFrom: ['War Caster'],
    });
    expect(cancelled.meta?.cue).toBe('Advantage and disadvantage cancel: War Caster, Exhaustion 3');
    const ignored = rollD20Test('1d20+2', {
      label: 'Concentration',
      effects: exhausted,
      ignored: true,
      advantageFrom: ['War Caster'],
    });
    expect(ignored.meta).toMatchObject({
      advantage: 'adv',
      cue: 'Conditions ignored for this roll · Advantage: War Caster',
    });
  });
});

describe('rollD20Test with effects in play', () => {
  const bless = { dice: '1d4', source: 'Bless' };
  const bardic = {
    dice: '1d8',
    source: 'Bardic Inspiration',
    effectId: 'b1',
    once: true,
    ifFailed: false,
  };
  const riders = (over: Partial<RollEffects> = {}): RollEffects => ({
    dice: [],
    offers: [],
    advantage: [],
    disadvantage: [],
    ...over,
  });

  it("rolls Bless's die in and names it in the working", () => {
    nextFaces(11, 3);
    const r = rollD20Test('1d20+7', {
      label: 'Greataxe attack',
      riders: riders({ dice: [bless] }),
    });
    expect(r.total).toBe(21);
    expect(
      rollDetail(r)
        .map((p) => p.text)
        .join(''),
    ).toBe('d20 [11] + 7 + d4 [3] Bless');
  });

  it('says which attack it is, and that a natural 20 crits', () => {
    nextFaces(20);
    const nat20 = rollD20Test('1d20+5', {
      label: 'Longsword attack',
      attack: { by: 'c1', of: 'Longsword' },
      settlesOnNatural: true,
    });
    expect(nat20.meta?.attack).toEqual({ by: 'c1', of: 'Longsword', crit: true });
    nextFaces(19);
    const nat19 = rollD20Test('1d20+5', {
      label: 'Longsword attack',
      attack: { by: 'c1', of: 'Longsword' },
      settlesOnNatural: true,
    });
    expect(nat19.meta?.attack).toEqual({ by: 'c1', of: 'Longsword', crit: false });
    expect(rollTone(nat19)).toBe('d20');
  });

  it("crits inside the character's range, which settles the roll as a natural 20 does", () => {
    nextFaces(19);
    const r = rollD20Test('1d20+5', {
      label: 'Longsword attack',
      attack: { by: 'c1', of: 'Longsword', critFrom: 19 },
      riders: riders({ offers: [bardic] }),
      settlesOnNatural: true,
    });
    expect(r.meta?.attack).toEqual({ by: 'c1', of: 'Longsword', crit: true });
    expect(r.meta?.offers).toBeUndefined();
    expect(rollTone(r)).toBe('crit');
    // The die kept is the one that counts: disadvantage's low 3, not the 20.
    advModeStore.getState().set('dis');
    nextFaces(20, 3);
    const dis = rollD20Test('1d20+5', {
      label: 'Longsword attack',
      attack: { by: 'c1', of: 'Longsword', critFrom: 19 },
      settlesOnNatural: true,
    });
    expect(dis.meta?.attack).toEqual({ by: 'c1', of: 'Longsword', crit: false });
  });

  it('puts the dice on offer on the result, and no die for them yet', () => {
    nextFaces(9);
    const r = rollD20Test('1d20+2', { label: 'DEX save', riders: riders({ offers: [bardic] }) });
    expect(r.total).toBe(11);
    expect(r.meta?.offers).toEqual([bardic]);
  });

  it('offers nothing where nothing could change it', () => {
    nextFaces(20);
    const nat20 = rollD20Test('1d20+7', {
      label: 'Attack',
      riders: riders({ offers: [bardic] }),
      settlesOnNatural: true,
    });
    expect(nat20.meta?.offers).toBeUndefined();
    nextFaces(1);
    const nat1 = rollD20Test('1d20+7', {
      label: 'Attack',
      riders: riders({ offers: [bardic] }),
      settlesOnNatural: true,
    });
    expect(nat1.meta?.offers).toBeUndefined();
    // A save's natural 20 is no success by itself, so the offer stays.
    nextFaces(20);
    expect(
      rollD20Test('1d20', { label: 'WIS save', riders: riders({ offers: [bardic] }) }).meta?.offers,
    ).toEqual([bardic]);
    nextFaces(15);
    const paralyzed = effects([{ id: 'Paralyzed' }], '2014', { kind: 'save', ability: 'dex' });
    const fails = rollD20Test('1d20+2', {
      label: 'DEX save',
      effects: paralyzed,
      riders: riders({ offers: [bardic] }),
    });
    expect(fails.meta?.autoFail).toBe(true);
    expect(fails.meta?.offers).toBeUndefined();
  });

  it('marks the one-use dice to ask about first, whatever the d20 shows', () => {
    const guidance = {
      dice: '1d4',
      source: 'Guidance',
      effectId: 'g1',
      once: true,
      ifFailed: false,
    };
    // 2024 Bardic waits for a failure, and a die that is not one use waits for nothing.
    const failed = { ...bardic, effectId: 'b2', ifFailed: true };
    const every = { dice: '1d4', source: 'Guidance', once: false, ifFailed: false };
    nextFaces(20);
    const nat20 = rollD20Test('1d20+7', {
      label: 'Attack',
      riders: riders({ offers: [bardic, failed, every] }),
      settlesOnNatural: true,
    });
    // Settled after the roll, but asked about before it: a natural 20 must
    // not be told by a roll that does not wait.
    expect(nat20.meta?.offers).toBeUndefined();
    expect(nat20.meta?.askFirst).toEqual({ offers: [bardic], attack: true });
    nextFaces(1);
    const nat1 = rollD20Test('1d20+3', {
      label: 'Athletics check',
      riders: riders({ offers: [guidance, bardic] }),
    });
    expect(nat1.meta?.askFirst).toEqual({ offers: [guidance, bardic], attack: false });
    nextFaces(15);
    const plain = rollD20Test('1d20+3', {
      label: 'Athletics check',
      riders: riders({ offers: [every, failed] }),
    });
    expect(plain.meta?.askFirst).toBeUndefined();
    // An automatic failure is on the cue before the roll: nothing to ask.
    nextFaces(15);
    const paralyzed = effects([{ id: 'Paralyzed' }], '2014', { kind: 'save', ability: 'dex' });
    const fails = rollD20Test('1d20+2', {
      label: 'DEX save',
      effects: paralyzed,
      riders: riders({ offers: [bardic] }),
    });
    expect(fails.meta?.askFirst).toBeUndefined();
  });

  it("rolls an effect's advantage and disadvantage as a feature's", () => {
    nextFaces(15, 4);
    const r = rollD20Test('1d20+3', {
      label: 'Spell attack',
      riders: riders({ advantage: ['Innate Sorcery'] }),
    });
    expect(r.total).toBe(18);
    expect(r.meta?.cue).toBe('Advantage: Innate Sorcery');
    nextFaces(15, 4);
    const both = rollD20Test('1d20+3', {
      label: 'Spell attack',
      effects: effects([{ id: 'Poisoned' }], '2014', { kind: 'attack' }),
      riders: riders({ advantage: ['Innate Sorcery'] }),
    });
    expect(both.meta?.cue).toBe('Advantage and disadvantage cancel: Innate Sorcery, Poisoned');
  });
});

describe('cue lines', () => {
  it('says each kind of effect once, with its sources', () => {
    expect(
      effectLines(effects([{ id: 'Poisoned' }, { id: 'Prone' }], '2014', { kind: 'attack' })),
    ).toEqual(['Disadvantage: Poisoned, Prone']);
    expect(
      effectLines(effects([{ id: 'Invisible' }, { id: 'Poisoned' }], '2024', { kind: 'attack' })),
    ).toEqual(['Advantage (Invisible) and disadvantage (Poisoned) cancel']);
    expect(
      effectLines(
        effects([{ id: 'Exhaustion', level: 1 }, { id: 'Invisible' }], '2024', {
          kind: 'initiative',
        }),
      ),
    ).toEqual(['Advantage: Invisible', '−2: Exhaustion 1']);
    expect(effectLines(effects([], '2024', { kind: 'attack' }))).toEqual([]);
  });

  it("names a feature's advantage beside the conditions, and alone is no cue", () => {
    const exhausted = effects([{ id: 'Exhaustion', level: 3 }], '2014', {
      kind: 'save',
      ability: 'con',
    });
    expect(effectLines(exhausted, ['War Caster'])).toEqual([
      'Advantage (War Caster) and disadvantage (Exhaustion 3) cancel',
    ]);
    expect(effectLines(effects([], '2014', { kind: 'save' }), ['War Caster'])).toEqual([]);
  });

  it('gives notes their source', () => {
    expect(noteLines(effects([{ id: 'Blinded' }], '2024', { kind: 'check' }))).toEqual([
      'Blinded: you fail checks that need sight',
    ]);
  });

  it('names the saves a source reaches unless it reaches all six', () => {
    const per = (ids: ActiveCondition[], edition: Edition) =>
      Object.fromEntries(
        ABILITIES.map((a) => [a, effects(ids, edition, { kind: 'save', ability: a })]),
      ) as Record<Ability, ReturnType<typeof effects>>;
    expect(saveEffectLines(per([{ id: 'Stunned' }, { id: 'Restrained' }], '2014'))).toEqual([
      'STR and DEX saves fail automatically: Stunned',
      'Disadvantage on DEX saves: Restrained',
    ]);
    expect(
      saveEffectLines(per([{ id: 'Exhaustion', level: 3 }, { id: 'Restrained' }], '2014')),
    ).toEqual(['Disadvantage: Exhaustion 3', 'Disadvantage on DEX saves: Restrained']);
    expect(saveEffectLines(per([{ id: 'Exhaustion', level: 2 }], '2024'))).toEqual([
      '−4: Exhaustion 2',
    ]);
    expect(saveEffectLines(per([{ id: 'Poisoned' }], '2024'))).toEqual([]);
  });
});

describe('useIgnoreOnce', () => {
  const poisonedCheck = effects([{ id: 'Poisoned' }], '2014', { kind: 'check' });

  it('arms a group, is spent by the next roll in it, and leaves the others', () => {
    const { result } = renderHook(() => useIgnoreOnce('[]'));
    act(() => result.current.toggle('check'));
    expect(result.current.armed('check')).toBe(true);
    expect(result.current.armed('save')).toBe(false);
    let taken = false;
    act(() => {
      taken = result.current.take('check', poisonedCheck);
    });
    expect(taken).toBe(true);
    expect(result.current.armed('check')).toBe(false);
    act(() => {
      taken = result.current.take('check', poisonedCheck);
    });
    expect(taken).toBe(false);
  });

  it('stays armed through a roll no condition reaches', () => {
    const save = (ability: Ability) =>
      effects([{ id: 'Restrained' }], '2014', { kind: 'save', ability });
    const { result } = renderHook(() => useIgnoreOnce('[]'));
    act(() => result.current.toggle('save'));
    let taken = true;
    act(() => {
      taken = result.current.take('save', save('wis'));
    });
    expect(taken).toBe(false);
    expect(result.current.armed('save')).toBe(true);
    act(() => {
      taken = result.current.take('save', save('dex'));
    });
    expect(taken).toBe(true);
  });

  it('can be pressed again to disarm', () => {
    const { result } = renderHook(() => useIgnoreOnce('[]'));
    act(() => result.current.toggle('attack'));
    act(() => result.current.toggle('attack'));
    expect(result.current.armed('attack')).toBe(false);
  });

  it('lets go when the conditions change', () => {
    const { result, rerender } = renderHook(({ key }) => useIgnoreOnce(key), {
      initialProps: { key: '[{"id":"Poisoned"}]' },
    });
    act(() => result.current.toggle('attack'));
    rerender({ key: '[{"id":"Prone"}]' });
    expect(result.current.armed('attack')).toBe(false);
  });
});
