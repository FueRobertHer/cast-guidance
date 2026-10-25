/** What `setFiles` and a file chooser accept for an in-memory file. */
export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** The format tag every character export carries (`CHARACTER_EXPORT_FORMAT`). */
export const EXPORT_FORMAT = 'cast-guidance/character@1';

export function jsonFile(name: string, value: unknown): FilePayload {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) };
}

interface ExportShape {
  $format: string;
  character: Record<string, unknown>;
  homebrew: unknown[];
}

/**
 * Files the importer must refuse, built from a real export so each one is
 * wrong in exactly one way. The message is the start of what the roster says.
 */
export function invalidImports(
  exported: ExportShape,
): Array<{ label: string; file: FilePayload; message: RegExp }> {
  return [
    {
      label: 'a newer character schema',
      file: jsonFile('future.json', {
        ...exported,
        character: { ...exported.character, schemaVersion: 999 },
      }),
      message: /^Import failed: .*newer than this app supports/,
    },
    {
      label: 'a different export format',
      file: jsonFile('wrong-format.json', { ...exported, $format: 'someone-else/character@1' }),
      message: /^Import failed: unsupported format "someone-else\/character@1"/,
    },
    {
      label: 'a file that is not JSON',
      file: {
        name: 'garbage.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{ not json'),
      },
      message: /^Import failed: file is not valid JSON/,
    },
  ];
}
