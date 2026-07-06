import { migrateCharacter } from '@/engine/migrate';
import type { CharacterDoc } from '@/engine/types';
import { db } from './db';

/** Persistence seam for characters (cloud sync slots in behind this). */
export const characterRepo = {
  async list(): Promise<CharacterDoc[]> {
    const rows = await db.characters.orderBy('updatedAt').reverse().toArray();
    return rows.map((r) => migrateCharacter(r));
  },

  async get(id: string): Promise<CharacterDoc | undefined> {
    const row = await db.characters.get(id);
    return row === undefined ? undefined : migrateCharacter(row);
  },

  async put(doc: CharacterDoc): Promise<void> {
    await db.characters.put({ ...doc, updatedAt: new Date().toISOString() });
  },

  async delete(id: string): Promise<void> {
    await db.characters.delete(id);
  },

  async duplicate(id: string): Promise<CharacterDoc | undefined> {
    const doc = await this.get(id);
    if (doc === undefined) return undefined;
    const copy: CharacterDoc = {
      ...structuredClone(doc),
      id: crypto.randomUUID(),
      name: `${doc.name} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.characters.put(copy);
    return copy;
  },
};
