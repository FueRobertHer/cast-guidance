import { EXPORT_FORMAT, type FilePayload, jsonFile } from './characterFile.ts';

/**
 * A Cleric 7 whose Blessed Strikes is shaped as the pinned release (v2.39.1)
 * has the 2024 one: a counted `options` node over two class-feature refs, so
 * Build asks which one the character takes. The suite's release has no
 * Cleric, so the class comes as homebrew the character file carries, with
 * placeholder rules text.
 */
export const PICK_ONE_BREW_FILE = 'e2e-pick-one.json';

const CLERIC = 'Cleric';
const SOURCE = 'E2EP';

const feature = (name: string, level: number, entries: unknown[]) => ({
  name,
  source: SOURCE,
  className: CLERIC,
  classSource: SOURCE,
  level,
  entries,
});

const PICK_ONE_BREW = {
  _meta: {
    sources: [{ json: SOURCE, abbreviation: SOURCE, full: 'E2E Pick One', version: '1.0.0' }],
  },
  class: [
    {
      name: CLERIC,
      source: SOURCE,
      hd: { number: 1, faces: 8 },
      proficiency: ['wis', 'cha'],
      casterProgression: 'full',
      spellcastingAbility: 'wis',
      classFeatures: [`Blessed Strikes|${CLERIC}|${SOURCE}|7`],
    },
  ],
  classFeature: [
    feature('Blessed Strikes', 7, [
      'Divine power infuses you in battle. You gain one of the following options of your choice.',
      {
        type: 'entries',
        entries: [
          {
            type: 'options',
            count: 1,
            entries: [
              { type: 'refClassFeature', classFeature: `Divine Strike|${CLERIC}|${SOURCE}|7` },
              {
                type: 'refClassFeature',
                classFeature: `Potent Spellcasting|${CLERIC}|${SOURCE}|7`,
              },
            ],
          },
        ],
      },
    ]),
    feature('Divine Strike', 7, [
      'Once on each of your turns when you hit a creature with a weapon, you can deal an extra {@damage 1d8} radiant damage.',
    ]),
    feature('Potent Spellcasting', 7, [
      'Add your Wisdom modifier to the damage you deal with any Cleric cantrip.',
    ]),
  ],
};

/**
 * A character file for the Cleric, built on a stored blank character (so the
 * document is whatever this build writes) with a new id and the homebrew
 * embedded. `pick` stores a Blessed Strikes branch, as a save made after the
 * pick would hold it.
 */
export function pickOneClericFile(
  blank: Record<string, unknown>,
  id: string,
  name: string,
  { pick }: { pick?: 'divine strike' | 'potent spellcasting' } = {},
): { file: FilePayload; previewTitle: string } {
  const character = {
    ...blank,
    id,
    name,
    rulesVersion: '2024',
    classes: [{ ref: { name: CLERIC, source: SOURCE }, levels: 7, hp: Array(7).fill('avg') }],
    choices: {
      ...(blank.choices as Record<string, unknown> | undefined),
      ...(pick !== undefined && { 'class:cleric|e2ep:feature:blessed strikes:7': [pick] }),
    },
  };
  return {
    file: jsonFile(`${id}.json`, {
      $format: EXPORT_FORMAT,
      character,
      homebrew: [{ fileName: PICK_ONE_BREW_FILE, json: PICK_ONE_BREW }],
    }),
    previewTitle: `Import ${name}?`,
  };
}
