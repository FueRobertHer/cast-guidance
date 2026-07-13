import Dexie, { type EntityTable } from "dexie";
import type { CharacterDoc } from "@/engine/types";

export interface DataFileRow {
  /** `${tag}:${path}` */
  key: string;
  tag: string;
  path: string;
  pack: string;
  /** Parsed JSON, stored via structured clone — no re-parse on boot. */
  json: unknown;
  bytes: number;
  fetchedAt: number;
}

export interface DataMetaRow {
  id: "installed";
  tag: string;
  completedPacks: string[];
  installedAt: number;
}

export interface HomebrewFileRow {
  /** SHA-256 of the file content. */
  id: string;
  fileName: string;
  url?: string;
  json: unknown;
  enabled: boolean;
  /** Files created by the in-app builder can be edited. */
  editable: boolean;
  sourceIds: string[];
  counts: Record<string, number>;
  addedAt: number;
}

export interface SearchIndexRow {
  /** `${tag}|${homebrewRev}|${scope}` */
  key: string;
  json: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface RollLogRow {
  id: string;
  charId?: string;
  at: number;
  result: unknown;
}

/** One point-in-time snapshot of a character (version history). */
export interface CharacterHistoryRow {
  id: string;
  charId: string;
  at: number;
  label: string;
  doc: CharacterDoc;
}

export const db = new Dexie("cast-guidance") as Dexie & {
  dataFiles: EntityTable<DataFileRow, "key">;
  dataMeta: EntityTable<DataMetaRow, "id">;
  characters: EntityTable<CharacterDoc, "id">;
  homebrewFiles: EntityTable<HomebrewFileRow, "id">;
  searchIndexes: EntityTable<SearchIndexRow, "key">;
  settings: EntityTable<SettingRow, "key">;
  rollLog: EntityTable<RollLogRow, "id">;
  characterHistory: EntityTable<CharacterHistoryRow, "id">;
};

db.version(1).stores({
  dataFiles: "key, tag, pack",
  dataMeta: "id",
  characters: "id, name, updatedAt",
  homebrewFiles: "id, enabled, addedAt",
  searchIndexes: "key",
  settings: "key",
  rollLog: "id, at, charId",
});

db.version(2).stores({
  characterHistory: "id, charId, at",
});
