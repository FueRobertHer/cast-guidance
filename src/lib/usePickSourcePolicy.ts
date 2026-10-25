import { useMemo } from 'react';
import {
  characterSourceList,
  type PolicyScope,
  pickPolicy,
  type SourcePolicy,
  useSourcePolicy,
} from '@/data5e/sourceFilter';

/**
 * The source policy for a character's picker: the character's own list when it
 * has one, this device's settings otherwise (see {@link pickPolicy}).
 *
 * The character's list is passed in explicitly rather than read from context,
 * so a picker shows exactly the list its caller handed it, and one rendered
 * with no character (the library) cannot pick one up by accident.
 *
 * Memoized on the list's content, not its identity: the character store clones
 * the doc on every write, so an HP tick hands over a new but equal array, and
 * keying on that would refilter every list that depends on the result.
 */
export function usePickSourcePolicy(characterSources: unknown): {
  policy: SourcePolicy;
  scope: PolicyScope;
} {
  const device = useSourcePolicy();
  const key = characterSourceList(characterSources).join('\0');
  return useMemo(() => pickPolicy(device, key === '' ? [] : key.split('\0')), [device, key]);
}
