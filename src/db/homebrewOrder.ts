/**
 * The order homebrew files merge in, and so which one wins a tie (IMP-002).
 *
 * The registry adds official data first and keeps the first entity it sees for
 * each `name|source`, so official content always wins. Homebrew merges after
 * it, file by file, in the order `homebrewRepo.enabledSafe()` returns. That
 * order used to be the database's primary key order, which is a content hash
 * (or a random uuid for builder files), so which of two files defining the
 * same `name|source` won was an accident. This puts the earliest import first:
 * the file that was here before keeps its place when another one arrives.
 *
 * Pure, so the import preview can say who wins using the same rule the
 * registry applies.
 */
export interface MergeOrderKey {
  addedAt: number;
  id: string;
}

/**
 * Earliest `addedAt` first, then `id` ascending so a same-millisecond pair
 * (a character import writes several files in one go) still has one answer.
 */
export function compareMergeOrder(a: MergeOrderKey, b: MergeOrderKey): number {
  return a.addedAt - b.addedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
