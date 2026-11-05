import { asiFeatInstance } from '@/engine/effects/asiFeatInstance';
import type { CharacterDoc, ClassLevelEntry, EntityRef } from '@/engine/types';
import { refUid } from '@/engine/types';

/** Delete every choice whose key passes `test`, and say which ones went. */
function pruneKeys(doc: CharacterDoc, test: (key: string) => boolean): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(doc.choices)) {
    if (!test(key)) continue;
    delete doc.choices[key];
    removed.push(key);
  }
  return removed;
}

/** The key itself or anything under it, so `elf|phb` never claims `elf|phbx`. */
const under = (key: string, prefix: string) => key === prefix || key.startsWith(`${prefix}:`);

/**
 * Drop choices whose ids belong to an origin the character no longer has.
 * Choice ids are namespaced `<originType>:<name|source>:…`, so swapping a
 * race/background/subrace leaves orphaned picks behind unless we sweep them.
 * Returns the keys it removed, so a caller can say how many picks went.
 */
export function pruneChoicesFor(doc: CharacterDoc, originType: string, ref: EntityRef): string[] {
  const prefix = `${originType}:${refUid(ref)}`;
  return pruneKeys(doc, (key) => under(key, prefix));
}

/**
 * Drop the sub-choices of one feat instance. A feat's own picks are stored as
 * `feat:<featUid>:<instance>:…`, where the instance names whatever granted it
 * (`asi4` or `asi4@<classUid>` for a class ASI, the background's uid for an
 * origin feat), so they carry no origin prefix that {@link pruneChoicesFor} could
 * find. `asi4` does not claim `asi4@<classUid>`.
 *
 * Pass `featUid` to limit it to one feat; without it every feat under that
 * instance goes.
 */
export function pruneFeatInstances(
  doc: CharacterDoc,
  instance: string,
  featUid?: string,
): string[] {
  // With the feat known, match it whole: a homebrew feat name can hold a ':'.
  if (featUid !== undefined)
    return pruneKeys(doc, (key) => under(key, `feat:${featUid}:${instance}`));
  return pruneKeys(doc, (key) => {
    if (!key.startsWith('feat:')) return false;
    const rest = key.slice('feat:'.length);
    const sep = rest.indexOf(':');
    if (sep < 0) return false;
    return under(rest.slice(sep + 1), instance);
  });
}

/**
 * Drop an origin's picks when it is swapped or cleared. A background also takes
 * the sub-choices of the feats it granted or let the player pick, which are
 * stored under the feat rather than under the background.
 */
export function pruneOrigin(
  doc: CharacterDoc,
  originType: 'race' | 'subrace' | 'background',
  ref: EntityRef,
): string[] {
  const removed = pruneChoicesFor(doc, originType, ref);
  if (originType === 'background') removed.push(...pruneFeatInstances(doc, refUid(ref)));
  return removed;
}

const stringsOf = (value: CharacterDoc['choices'][string] | undefined) =>
  (Array.isArray(value) ? value : [value]).filter((v) => typeof v === 'string');

/** `class:<uid>:asi:<N>:feat` and the feats picked there, as [N, featUid]. */
function asiFeats(doc: CharacterDoc, classUid: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const prefix = `class:${classUid}:asi:`;
  for (const [key, value] of Object.entries(doc.choices)) {
    if (!key.startsWith(prefix) || !key.endsWith(':feat')) continue;
    const level = Number(key.slice(prefix.length, -':feat'.length));
    if (!Number.isInteger(level)) continue;
    for (const v of stringsOf(value)) out.push([level, v]);
  }
  return out;
}

/**
 * Drop the sub-choices of the feat an ASI prompt holds, for when that prompt's
 * answer is about to change: `class:<uid>:asi:<N>` turning away from a feat, or
 * `class:<uid>:asi:<N>:feat` picking another. They live under the feat rather than
 * under the prompt, so a sweep of the prompt's own keys does not reach them. Left
 * behind, they would come back with the feat, or pass to another class's copy of
 * it. Call it before writing the new answer, which says which feat these are for.
 * Any other choice id is left alone.
 */
export function pruneAsiFeatPicks(doc: CharacterDoc, promptId: string): string[] {
  const match = /^class:(.+):asi:(\d+)(?::feat)?$/.exec(promptId);
  if (match === null) return [];
  const [, classUid = '', digits = ''] = match;
  const level = Number(digits);
  const picked = doc.choices[`class:${classUid}:asi:${level}:feat`];
  return stringsOf(picked).flatMap((feat) =>
    pruneFeatInstances(doc, asiFeatInstance(doc, classUid, level, feat), feat),
  );
}

/**
 * Drop everything a removed class leaves behind: its own picks, its subclass's
 * picks, the sub-choices of feats it took at an ASI, and its spell list.
 *
 * Call it with the class still in `doc.classes`, then take it out. Two classes
 * taking one feat at one level keep separate sub-choices, with the first of them
 * under the plain `asi<level>` key (see {@link asiFeatInstance}), and only the
 * class's place in the list says which copy is its own. A class already gone
 * counts as behind the others, so it never takes a copy that stays.
 *
 * Returns the choice keys it removed. The spell list is not a choice; read it
 * before calling if you need to describe it.
 */
export function pruneClass(doc: CharacterDoc, entry: ClassLevelEntry): string[] {
  const uid = refUid(entry.ref);
  const removed: string[] = [];
  for (const [level, feat] of asiFeats(doc, uid)) {
    removed.push(...pruneFeatInstances(doc, asiFeatInstance(doc, uid, level, feat), feat));
  }
  removed.push(...pruneChoicesFor(doc, 'class', entry.ref));
  if (entry.subclass !== undefined) {
    removed.push(...pruneChoicesFor(doc, 'subclass', entry.subclass));
  }
  delete doc.spellcasting[uid];
  return removed;
}
