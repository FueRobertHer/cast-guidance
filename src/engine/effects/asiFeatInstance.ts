import { type CharacterDoc, type ClassLevelEntry, refUid } from '../types';

function pickedFeat(doc: CharacterDoc, entry: ClassLevelEntry, level: number, featUid: string) {
  const picked = doc.choices[`class:${refUid(entry.ref)}:asi:${level}:feat`];
  const list = Array.isArray(picked) ? picked : [picked];
  return list.some((v) => String(v).toLowerCase() === featUid.toLowerCase());
}

/**
 * The instance a feat taken at a class's ASI keeps its sub-choices under, the
 * middle of `feat:<featUid>:<instance>:…`, read by the engine and by
 * `pruneClass` alike so they agree on whose picks are whose.
 *
 * It is `asi<level>` for the first class in `doc.classes` that picked that feat at
 * that level, which is the key every saved character already uses, and
 * `asi<level>@<classUid>` for any later class. A class that has picks under its
 * own `@` key keeps using it even once it comes first, because the classes ahead
 * of it can be removed or can change feat, and its picks must not change hands.
 *
 * A class levelled down past its ASI still counts: its pick stays saved and comes
 * back with the level, so levels never move a copy to another key.
 *
 * Nothing records who answered under `asi<level>`, so whichever class comes first
 * reads what is there. A class ahead in the list that takes the feat after one
 * behind it takes over that class's picks, which then go if it is removed or
 * changes feat, and the class behind is asked again. Changing feat prunes the old
 * feat's picks (`pruneAsiFeatPicks`), but
 * a character saved before that can still have some there, for a copy with no
 * picks of its own to pick up.
 */
export function asiFeatInstance(
  doc: CharacterDoc,
  classUid: string,
  level: number,
  featUid: string,
): string {
  const own = `asi${level}@${classUid}`;
  const prefix = `feat:${featUid}:${own}:`;
  if (Object.keys(doc.choices).some((key) => key.startsWith(prefix))) return own;
  const first = doc.classes.find((entry) => pickedFeat(doc, entry, level, featUid));
  return first === undefined || refUid(first.ref) === classUid ? `asi${level}` : own;
}
