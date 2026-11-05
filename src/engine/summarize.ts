import { plainEntryText } from '../data5e/entries/plainText';

/** Flatten a 5etools `entries` array into a plain one-line summary. */
export function summarizeEntries(entries: unknown, maxLen = 160): string {
  const text = firstString(entries);
  if (text === undefined) return '';
  const plain = plainEntryText(text).replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen - 1)}…` : plain;
}

function firstString(node: unknown): string | undefined {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const n of node) {
      const s = firstString(n);
      if (s !== undefined) return s;
    }
    return undefined;
  }
  if (node !== null && typeof node === 'object') {
    const o = node as { entries?: unknown; entry?: unknown };
    return firstString(o.entries ?? o.entry);
  }
  return undefined;
}
