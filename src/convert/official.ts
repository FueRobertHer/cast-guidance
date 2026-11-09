// Where a converted entry's official counterpart lives. The import leaves out
// an entry the installed game data already has, and the converter check
// (`compareOfficial.ts`) sets one beside it. Relative imports only: scripts
// load this under plain Bun.
import type { EntityType } from '../data5e/normalize';
import type { ConvertedKind } from './types';

/** The registry types an entry of each converted kind could already be. */
export const OFFICIAL_TYPES: Record<ConvertedKind, readonly EntityType[]> = {
  spell: ['spell'],
  item: ['item', 'baseitem', 'itemGroup'],
  feat: ['feat'],
  background: ['background'],
  race: ['race'],
};
