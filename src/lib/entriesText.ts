/**
 * Plain-text ⇄ 5etools `entries` conversion for the homebrew builder.
 * Paragraphs are blank-line separated; lines starting "- " form bullet lists.
 * Inline {@dice ...}/{@spell ...} tags pass through as written.
 */

export function textToEntries(text: string): unknown[] {
  const blocks = text
    .replaceAll('\r\n', '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== '');
  const out: unknown[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim());
    if (lines.every((l) => l.startsWith('- '))) {
      out.push({ type: 'list', items: lines.map((l) => l.slice(2)) });
    } else {
      out.push(lines.join(' '));
    }
  }
  return out;
}

export function entriesToText(entries: unknown): string {
  if (!Array.isArray(entries)) return '';
  const blocks: string[] = [];
  for (const node of entries) {
    if (typeof node === 'string') {
      blocks.push(node);
    } else if (
      typeof node === 'object' &&
      node !== null &&
      (node as { type?: unknown }).type === 'list' &&
      Array.isArray((node as { items?: unknown }).items)
    ) {
      blocks.push(
        ((node as { items: unknown[] }).items ?? [])
          .map((i) => `- ${typeof i === 'string' ? i : JSON.stringify(i)}`)
          .join('\n'),
      );
    } else {
      // Block we don't round-trip (tables etc.) — keep as raw JSON line.
      blocks.push(JSON.stringify(node));
    }
  }
  return blocks.join('\n\n');
}
