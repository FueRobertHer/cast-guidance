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
 * (`asi4` for a class ASI, the background's uid for an origin feat), so they
 * carry no origin prefix that {@link pruneChoicesFor} could find.
 *
 * Pass `featUid` to limit it to one feat; without it every feat under that
 * instance goes.
 */
export function pruneFeatInstances(
  doc: CharacterDoc,
  instance: string,
  featUid?: string,
): string[] {
  return pruneKeys(doc, (key) => {
    if (!key.startsWith('feat:')) return false;
    const rest = key.slice('feat:'.length);
    const sep = rest.indexOf(':');
    if (sep < 0) return false;
    if (featUid !== undefined && rest.slice(0, sep) !== featUid) return false;
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

/** `class:<uid>:asi:<N>:feat` and the feats picked there, as [N, featUid]. */
function asiFeats(doc: CharacterDoc, classUid: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const prefix = `class:${classUid}:asi:`;
  for (const [key, value] of Object.entries(doc.choices)) {
    if (!key.startsWith(prefix) || !key.endsWith(':feat')) continue;
    const level = Number(key.slice(prefix.length, -':feat'.length));
    if (!Number.isInteger(level)) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === 'string') out.push([level, v]);
    }
  }
  return out;
}

/**
 * Drop everything a removed class leaves behind: its own picks, its subclass's
 * picks, the sub-choices of feats it took at an ASI, and its spell list. Call
 * it with the class already gone from `doc.classes`, so a class that stays is
 * never stripped of a feat instance it shares (two classes taking the same feat
 * at the same level store its sub-choices under one key).
 *
 * Returns the choice keys it removed. The spell list is not a choice; read it
 * before calling if you need to describe it.
 */
export function pruneClass(doc: CharacterDoc, entry: ClassLevelEntry): string[] {
  const uid = refUid(entry.ref);
  const kept = new Set<string>();
  for (const c of doc.classes) {
    const other = refUid(c.ref);
    if (other === uid) continue;
    for (const [level, feat] of asiFeats(doc, other)) kept.add(`${level}|${feat}`);
  }
  const removed: string[] = [];
  for (const [level, feat] of asiFeats(doc, uid)) {
    if (kept.has(`${level}|${feat}`)) continue;
    removed.push(...pruneFeatInstances(doc, `asi${level}`, feat));
  }
  removed.push(...pruneChoicesFor(doc, 'class', entry.ref));
  if (entry.subclass !== undefined) {
    removed.push(...pruneChoicesFor(doc, 'subclass', entry.subclass));
  }
  delete doc.spellcasting[uid];
  return removed;
}
