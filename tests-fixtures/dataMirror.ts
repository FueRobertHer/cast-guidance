/**
 * The smallest mirror an install will accept: every file a release must hold,
 * each with the list the installer checks for, plus one class and one spell
 * file named by the indexes. Tests that need an install to succeed serve
 * this, and override the one file they are about.
 */

/** A valid body for every path in a minimal complete release. */
export const VALID_BODIES: Readonly<Record<string, unknown>> = {
  'races.json': { race: [{ name: 'Elf', source: 'PHB' }] },
  'backgrounds.json': { background: [{ name: 'Acolyte', source: 'PHB' }] },
  'feats.json': { feat: [{ name: 'Alert', source: 'PHB' }] },
  'items-base.json': { baseitem: [{ name: 'Club', source: 'PHB' }] },
  'optionalfeatures.json': { optionalfeature: [{ name: 'Agonizing Blast', source: 'PHB' }] },
  'skills.json': { skill: [{ name: 'Athletics', source: 'PHB' }] },
  'languages.json': { language: [{ name: 'Common', source: 'PHB' }] },
  'senses.json': { sense: [{ name: 'Darkvision', source: 'PHB' }] },
  'actions.json': { action: [{ name: 'Dash', source: 'PHB' }] },
  'conditionsdiseases.json': { condition: [{ name: 'Blinded', source: 'PHB' }] },
  'class/index.json': { Fighter: 'class-fighter.json' },
  'spells/index.json': { PHB: 'spells-phb.json' },
  'generated/gendata-spell-source-lookup.json': { phb: { fireball: {} } },
  'items.json': { item: [{ name: 'Bag of Holding', source: 'DMG' }] },
  'magicvariants.json': { magicvariant: [{ name: '+1 Weapon', source: 'DMG' }] },
  'variantrules.json': { variantrule: [{ name: 'Flanking', source: 'DMG' }] },
  'books.json': { book: [{ name: "Player's Handbook", id: 'PHB', source: 'PHB' }] },
  'class/class-fighter.json': { class: [{ name: 'Fighter', source: 'PHB' }] },
  'spells/spells-phb.json': { spell: [{ name: 'Fireball', source: 'PHB', level: 3 }] },
};

/** Every path in {@link VALID_BODIES}. */
export const VALID_PATHS: readonly string[] = Object.keys(VALID_BODIES);

/**
 * A `(tag, path) => body` mirror for a mocked source's `fetchFile`. Bodies in
 * `overrides` replace the valid ones path by path; a path neither knows is
 * refused the way a real mirror refuses it.
 */
export function validMirror(
  overrides: Readonly<Record<string, unknown>> = {},
): (tag: string, path: string) => Promise<unknown> {
  return (_tag, path) => {
    if (path in overrides) return Promise.resolve(structuredClone(overrides[path]));
    if (path in VALID_BODIES) return Promise.resolve(structuredClone(VALID_BODIES[path]));
    return Promise.reject(new Error(`HTTP 404 for ${path}`));
  };
}
