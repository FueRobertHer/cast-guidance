/**
 * What each kind of entry is called where a person reads it: one and many,
 * so a count never shows a raw list key ("3 subclassFeature") or a singular
 * after a number ("2 spell"). One table for previews, counts, toasts and the
 * Workshop's rows; React-free, so any layer can use it.
 */

const KINDS: Readonly<Record<string, readonly [one: string, many: string]>> = {
  action: ['Action', 'Actions'],
  background: ['Background', 'Backgrounds'],
  baseitem: ['Equipment', 'Equipment'],
  book: ['Book', 'Books'],
  class: ['Class', 'Classes'],
  classFeature: ['Class feature', 'Class features'],
  condition: ['Condition', 'Conditions'],
  disease: ['Disease', 'Diseases'],
  feat: ['Feat', 'Feats'],
  item: ['Item', 'Items'],
  itemGroup: ['Item group', 'Item groups'],
  language: ['Language', 'Languages'],
  magicvariant: ['Magic item variant', 'Magic item variants'],
  optionalfeature: ['Optional feature', 'Optional features'],
  race: ['Species', 'Species'],
  sense: ['Sense', 'Senses'],
  skill: ['Skill', 'Skills'],
  spell: ['Spell', 'Spells'],
  status: ['Status', 'Statuses'],
  subclass: ['Subclass', 'Subclasses'],
  subclassFeature: ['Subclass feature', 'Subclass features'],
  subrace: ['Subrace', 'Subraces'],
  variantrule: ['Rule', 'Rules'],
};

/** A key the table does not know, in words: `deityGroup` as "Deity group". */
function spelled(type: string): readonly [string, string] {
  const words = type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  const one = words === '' ? 'Entry' : words.charAt(0).toUpperCase() + words.slice(1);
  return [one, /s$/.test(one) ? one : `${one}s`];
}

const namesOf = (type: string) =>
  (Object.hasOwn(KINDS, type) ? KINDS[type] : undefined) ?? spelled(type);

/** "Subclass feature", or with a count other than one, "Subclass features". */
export function kindName(type: string, count = 1): string {
  const [one, many] = namesOf(type);
  return count === 1 ? one : many;
}

/** A kind as a sentence uses it, after a number: "3 subclass features", "1 species". */
export function kindCount(type: string, count: number): string {
  return `${count} ${kindName(type, count).toLowerCase()}`;
}
