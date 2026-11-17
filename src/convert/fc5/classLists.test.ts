import { describe, expect, it } from 'vitest';
import { type ListFeature, textLists } from './classLists';
import { readText } from './text';

/** A feature as the host reads it, from the file's `<text>` lines. */
const at = (level: number, name: string, ...lines: string[]): ListFeature => ({
  name,
  level,
  entries: readText(lines).entries,
});

const lists = (className: string, features: ListFeature[], offered: string[] = []) =>
  textLists(className, features, new Set(offered));

describe('textLists', () => {
  it("reads the 2014 warlock's table, not its prose or its Additional Invocation features as well", () => {
    const features = [
      at(
        2,
        'Eldritch Invocations',
        'At 2nd level, you gain two eldritch invocations of your choice. You gain an additional invocation at 5th, 7th, 9th, 12th, 15th, and 18th warlock level.',
        '',
        'Level | Invocations Known',
        ...[2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8].map(
          (n, i) => `${i + 2} | ${n}`,
        ),
      ),
      ...[5, 7, 9, 12, 15, 18].map((l) =>
        at(
          l,
          'Additional Invocation',
          `At ${l}th level, you learn an additional Eldritch Invocation.`,
        ),
      ),
    ];
    expect(lists('Warlock', features)).toEqual([
      {
        name: 'Eldritch Invocations',
        featureType: ['EI'],
        progression: { 2: 2, 5: 3, 7: 4, 9: 5, 12: 6, 15: 7, 18: 8 },
      },
    ]);
  });

  it("reads the 2024 sorcerer's words, its typo and the last level before a full stop", () => {
    const features = [
      at(
        2,
        'Metamagic',
        'you gain two Meta magic options of your choice from "Metamagic Options" later in this class\'s description (added as spells in the Metamagic Options spell list).',
        "Whenever you gain a Sorcerer level, you can replace one of your Metamagic options with one you don't know. You gain two more options at Sorcerer level 10 and two more at Sorcerer level 17.",
      ),
    ];
    expect(lists('Sorcerer', features)).toEqual([
      { name: 'Metamagic', featureType: ['MM'], progression: { 2: 2, 10: 4, 17: 6 } },
    ]);
  });

  it('counts the features that add more, and leaves the first one’s words for later levels alone then', () => {
    const features = [
      at(
        3,
        'Combat Superiority (Battle Master)',
        'Maneuvers: You learn three maneuvers of your choice.',
        'You learn two additional maneuvers of your choice at 7th, 10th, and 15th level.',
      ),
      ...[7, 10, 15].map((l) =>
        at(
          l,
          'Additional Maneuvers (Battle Master)',
          'You learn two additional Combat Superiority maneuvers.',
        ),
      ),
      at(
        10,
        'Improved Combat Superiority (Battle Master)',
        'Your superiority dice turn into d10s.',
      ),
    ];
    expect(lists('Fighter', features)).toEqual([
      { name: 'Maneuvers', featureType: ['MV:B'], progression: { 3: 3, 7: 5, 10: 7, 15: 9 } },
    ]);
  });

  it('reads later levels a class reaches, and not more of something else', () => {
    const features = [
      at(
        3,
        'Combat Superiority',
        'Maneuvers. You learn three maneuvers of your choice from the "Maneuver Options" section.',
        'You learn two additional maneuvers of your choice when you reach Fighter levels 7, 10, and 15.',
        'Superiority Dice. You have four Superiority Dice. You gain an additional Superiority Die when you reach Fighter level 7.',
      ),
    ];
    expect(lists('Fighter', features)).toEqual([
      { name: 'Maneuvers', featureType: ['MV:B'], progression: { 3: 3, 7: 5, 10: 7, 15: 9 } },
    ]);
  });

  it('reads the levels a class lists after a colon', () => {
    const features = [
      at(
        3,
        'Arcane Shot (Arcane Archer)',
        'When you gain this feature, you learn two Arcane Shot options of your choice.',
        'You gain an additional Arcane Shot option of your choice when you reach certain levels in this class: 7th, 10th, 15th, and 18th level.',
      ),
    ];
    expect(lists('Fighter', features)).toEqual([
      {
        name: 'Arcane Shots',
        featureType: ['AS'],
        progression: { 3: 2, 7: 3, 10: 4, 15: 5, 18: 6 },
      },
    ]);
  });

  it("reads a table's ordinal levels", () => {
    const features = [
      at(
        3,
        'Rune Carver (Rune Knight)',
        'You learn two runes of your choice. When you reach certain levels in this class, you learn additional runes, as shown in the Runes Known table.',
        '',
        'Fighter Level | Number of Runes',
        '3rd | 2',
        '7th | 3',
        '10th | 4',
        '15th | 5',
      ),
      at(15, 'Master of Runes (Rune Knight)', 'You can invoke each rune you know twice.'),
    ];
    expect(lists('Fighter', features)).toEqual([
      { name: 'Runes', featureType: ['RN'], progression: { 3: 2, 7: 3, 10: 4, 15: 5 } },
    ]);
  });

  it('counts the option a feature names beside the ones it picks', () => {
    const features = [
      at(
        3,
        'Disciplines of the Element (Way of the Four Elements)',
        'You know the Elemental Attunement discipline and one other elemental discipline of your choice.',
      ),
      ...[6, 11, 17].map((l) =>
        at(
          l,
          'Additional Elemental Discipline (Way of the Four Elements)',
          `At ${l}th level, you learn an additional elemental discipline of your choice.`,
        ),
      ),
    ];
    expect(lists('Monk', features)).toEqual([
      {
        name: 'Elemental Disciplines',
        featureType: ['ED'],
        progression: { 3: 2, 6: 3, 11: 4, 17: 5 },
      },
    ]);
  });

  it("offers the official list to a subclass that picks from the Battle Master's", () => {
    const features = [
      at(
        3,
        'Adaptable Superiority',
        'Maneuvers You learn three Maneuvers of your choice from those available to the Battle Master. You learn another Maneuver of your choice at 7th, 10th, and 15th level in this class.',
      ),
    ];
    expect(lists('Fighter', features)).toEqual([
      { name: 'Maneuvers', featureType: ['MV:B'], progression: { 3: 3, 7: 4, 10: 5, 15: 6 } },
    ]);
  });

  it("leaves a homebrew class's own lists alone", () => {
    expect(
      lists('Fighter', [
        at(
          3,
          'Gun Mastery',
          'You learn two burst maneuvers of your choice, which are detailed below.',
        ),
        at(3, 'Master Runes', 'You learn five master runes; Ild (fire), Kalt (frost).'),
      ]),
    ).toEqual([]);
    expect(
      lists('Monk', [at(17, 'Master of Ferocity', 'You gain one of the disciplines below.')]),
    ).toEqual([]);
  });

  it("offers a list only to its class, and only when the class's progression does not", () => {
    const maneuvers = [at(3, 'Ember Tactics', 'You learn three maneuvers of your choice.')];
    expect(lists('Ember Knight', maneuvers)).toEqual([]);
    expect(lists('Fighter', maneuvers, ['mv:b'])).toEqual([]);
    expect(lists('Fighter', maneuvers)).toHaveLength(1);
  });

  it('gives nothing for a list it names without a count', () => {
    expect(
      lists('Warlock', [
        at(
          3,
          'Pact Boon',
          'If you have the Book of Ancient Secrets invocation, you know more rituals.',
        ),
      ]),
    ).toEqual([]);
  });
});
