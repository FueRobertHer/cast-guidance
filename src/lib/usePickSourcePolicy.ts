import { useMemo } from 'react';
import {
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
 * with no character (the library) cannot pick one up by accident. Memoized on
 * both inputs so lists that depend on the result do not refilter every render.
 */
export function usePickSourcePolicy(characterSources: unknown): {
  policy: SourcePolicy;
  scope: PolicyScope;
} {
  const device = useSourcePolicy();
  return useMemo(() => pickPolicy(device, characterSources), [device, characterSources]);
}
