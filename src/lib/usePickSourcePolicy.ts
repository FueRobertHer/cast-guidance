import { useMemo } from 'react';
import {
  characterSourceList,
  characterSourceSwitches,
  type PolicyScope,
  pickPolicy,
  type SourcePolicy,
  useSourcePolicy,
} from '@/data5e/sourceFilter';

/** One string per list, so equal content gives an equal memo key. */
const keyOf = (list: readonly string[]) => list.join('\0');
const listOf = (key: string) => (key === '' ? [] : key.split('\0'));

/**
 * The source policy for a character's picker: the character's own list when it
 * has one, this device's settings otherwise, with the character's switches
 * over either (see {@link pickPolicy}).
 *
 * The character's list and switches are passed in explicitly rather than read
 * from context, so a picker shows exactly what its caller handed it, and one
 * rendered with no character (the library) cannot pick one up by accident.
 *
 * Memoized on content, not identity: the character store clones the doc on
 * every write, so an HP tick hands over a new but equal array, and keying on
 * that would refilter every list that depends on the result.
 */
export function usePickSourcePolicy(
  characterSources: unknown,
  characterSwitches?: unknown,
): {
  policy: SourcePolicy;
  scope: PolicyScope;
} {
  const device = useSourcePolicy();
  const key = keyOf(characterSourceList(characterSources));
  const switches = characterSourceSwitches(characterSwitches);
  const onKey = keyOf(switches.on);
  const offKey = keyOf(switches.off);
  return useMemo(
    () => pickPolicy(device, listOf(key), { on: listOf(onKey), off: listOf(offKey) }),
    [device, key, onKey, offKey],
  );
}
