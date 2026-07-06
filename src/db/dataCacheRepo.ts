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

  /** Paths already cached under this tag. */
  async cachedPaths(tag: string): Promise<Set<string>> {
    const rows = await db.dataFiles.where('tag').equals(tag).toArray();
    return new Set(rows.map((r) => r.path));
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

  async deleteTag(tag: string): Promise<void> {
    await db.dataFiles.where('tag').equals(tag).delete();
  },
};
