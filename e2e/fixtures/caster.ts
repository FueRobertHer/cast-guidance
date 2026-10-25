import { EXPORT_FORMAT, type FilePayload, jsonFile } from './characterFile.ts';

/**
 * A spellcaster for the specs that need a full Play tab: the suite's data
 * release has one bare Fighter and no caster, so the classes come from a
 * homebrew file the character file carries with it.
 *
 * Sorcerer 13 has spell slots (pips) and 13 sorcery points, past the twelve
 * pips can show, so the pool gets its stepper. Cleric 2 adds Channel
 * Divinity, a pool small enough for pips. Both resources come from the
 * curated table, which keys them by feature and class name, so the
 * homebrew's source does not matter.
 */
export const CASTER_BREW_FILE = 'e2e-casters.json';

export const CASTER_BREW = {
  _meta: {
    sources: [{ json: 'E2EC', abbreviation: 'E2EC', full: 'E2E Casters', version: '1.0.0' }],
  },
  class: [
    {
      name: 'Sorcerer',
      source: 'E2EC',
      hd: { number: 1, faces: 6 },
      proficiency: ['con', 'cha'],
      casterProgression: 'full',
      spellcastingAbility: 'cha',
      classFeatures: ['Font of Magic|Sorcerer|E2EC|2'],
    },
    {
      name: 'Cleric',
      source: 'E2EC',
      hd: { number: 1, faces: 8 },
      proficiency: ['wis', 'cha'],
      casterProgression: 'full',
      spellcastingAbility: 'wis',
      classFeatures: ['Channel Divinity|Cleric|E2EC|2'],
    },
  ],
  classFeature: [
    {
      name: 'Font of Magic',
      source: 'E2EC',
      className: 'Sorcerer',
      classSource: 'E2EC',
      level: 2,
      entries: ['A pool of sorcery points.'],
    },
    {
      name: 'Channel Divinity',
      source: 'E2EC',
      className: 'Cleric',
      classSource: 'E2EC',
      level: 2,
      entries: ['Channel divine energy.'],
    },
  ],
};

/**
 * A character file for the caster, built on a stored blank character (read
 * from IndexedDB, so the document is whatever this build writes) with a new
 * id, the two classes, one level of exhaustion, and the homebrew embedded.
 */
export function casterFile(
  blank: Record<string, unknown>,
  id: string,
  name: string,
): { file: FilePayload; previewTitle: string } {
  const play = blank.play as Record<string, unknown>;
  const character = {
    ...blank,
    id,
    name,
    classes: [
      { ref: { name: 'Sorcerer', source: 'E2EC' }, levels: 13, hp: Array(13).fill('avg') },
      { ref: { name: 'Cleric', source: 'E2EC' }, levels: 2, hp: ['avg', 'avg'] },
    ],
    play: { ...play, conditions: [{ id: 'exhaustion', level: 1 }] },
  };
  return {
    file: jsonFile(`${id}.json`, {
      $format: EXPORT_FORMAT,
      character,
      homebrew: [{ fileName: CASTER_BREW_FILE, json: CASTER_BREW }],
    }),
    previewTitle: `Import ${name}?`,
  };
}
