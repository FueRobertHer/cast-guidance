import { type DataFileRow, type DataMetaRow, db } from './db';

/** Thin persistence seam over the data cache tables. */
export const dataCacheRepo = {
  key(tag: string, path: string): string {
    return `${tag}:${path}`;
  },

  async getFile(tag: string, path: string): Promise<DataFileRow | undefined> {
    return db.dataFiles.get(this.key(tag, path));
  },

  async putFile(row: DataFileRow): Promise<void> {
    await db.dataFiles.put(row);
  },

  /**
   * Paths already cached under this tag, read from primary keys alone.
   *
   * The key is `${tag}:${path}`, so the answer is entirely in the index and no
   * row body needs touching. Reading the rows instead deserialized every cached
   * `json` blob (megabytes) to collect a list of strings, and `ensurePack` asks
   * this question once per pack: roughly thirty full deserializations of the
   * whole compendium on a boot that has nothing left to download. Same reason
   * `bytes` got its own index in schema v3.
   */
  async cachedPaths(tag: string): Promise<Set<string>> {
    const prefix = this.key(tag, '');
    const keys = await db.dataFiles.where('key').startsWith(prefix).primaryKeys();
    return new Set(keys.map((k) => k.slice(prefix.length)));
  },

  /** All cached rows for a tag (registry hydration). */
  async filesByTag(tag: string): Promise<DataFileRow[]> {
    return db.dataFiles.where('tag').equals(tag).toArray();
  },

  async getMeta(): Promise<DataMetaRow | undefined> {
    return db.dataMeta.get('installed');
  },

  async setMeta(meta: DataMetaRow): Promise<void> {
    await db.dataMeta.put(meta);
  },

  async markPackComplete(tag: string, pack: string): Promise<void> {
    const meta = (await this.getMeta()) ?? {
      id: 'installed' as const,
      tag,
      completedPacks: [],
      installedAt: Date.now(),
    };
    if (meta.tag !== tag) {
      // A different tag is being installed; start a fresh completedPacks list.
      await this.setMeta({ id: 'installed', tag, completedPacks: [pack], installedAt: Date.now() });
      return;
    }
    if (!meta.completedPacks.includes(pack)) {
      meta.completedPacks.push(pack);
      await this.setMeta(meta);
    }
  },

  /**
   * Drop every cached file of these packs, so the next `ensurePack` fetches
   * them again. `ensurePack` decides what is missing from the cached paths
   * rather than the completion mark, so removing the files is what makes a
   * re-download happen; a file that is present but wrong is otherwise
   * indistinguishable from one that is right, and is skipped forever.
   */
  async deletePacks(tag: string, packs: readonly string[]): Promise<number> {
    if (packs.length === 0) return 0;
    return db.dataFiles
      .where('pack')
      .anyOf([...packs])
      .and((row) => row.tag === tag)
      .delete();
  },

  async deleteTag(tag: string): Promise<void> {
    await db.dataFiles.where('tag').equals(tag).delete();
  },

  /** Drop every cached file that doesn't belong to `tag` (stale-tag sweep). */
  async deleteOtherTags(tag: string): Promise<number> {
    return db.dataFiles.where('tag').notEqual(tag).delete();
  },

  /**
   * Total content size of every cached data file. Walks the `bytes` index, so
   * it never loads the `json` blobs it is measuring.
   */
  async totalBytes(): Promise<number> {
    const sizes = (await db.dataFiles.orderBy('bytes').keys()) as number[];
    return sizes.reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
  },
};
