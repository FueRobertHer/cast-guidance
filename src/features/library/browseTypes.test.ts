import { describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { BROWSE_TYPES } from './browseTypes';

describe("the library's browsable sections", () => {
  it('are all counted towards the source list in settings', () => {
    // The invariant `COUNTED_TYPES` documents, asserted from the outside: the
    // library source-filters every type it browses, so a type it browses that
    // settings does not count is a book that can be hidden with nothing on the
    // settings screen to bring it back.
    const reg = new EntityRegistry();
    for (const { type } of BROWSE_TYPES) reg.addAll(type, [{ name: 'Something', source: 'TEST' }]);

    expect(reg.sourceCounts().get('TEST')).toBe(BROWSE_TYPES.length);
  });
});
