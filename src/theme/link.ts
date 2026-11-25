/**
 * A theme as a link (docs/theme-format.md): the file's JSON, deflated and
 * written base64url after `#theme=1.` on the Settings address (`1` is the
 * encoding, apart from the file's own schema version). It lives in the hash,
 * so it never reaches a server, and needs none: the link is the theme.
 *
 * Decoding is for text from anywhere. A payload longer than a 64 KB theme
 * could deflate to is refused before it is decoded, the decompressor is fed
 * 1 KB at a time (browsers inflate a whole input chunk at once, and deflate
 * can expand about a thousandfold), and reading stops as soon as the
 * inflated bytes pass `MAX_THEME_BYTES`.
 */

/** The largest theme file the app reads, as a file or from a link. */
export const MAX_THEME_BYTES = 64 * 1024;

/**
 * The longest payload read: `MAX_THEME_BYTES` that deflate could not shrink,
 * in base64 (4 characters per 3 bytes), and a little over.
 */
const MAX_PAYLOAD_CHARS = 90_000;

const PREFIX = 'theme=';
/** The one encoding so far: deflate-raw, then base64url. */
const ENCODING = '1.';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[\w-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * `bytes` as a stream of `size`-byte chunks, handed over only as the reader
 * pulls, without Blob, whose `stream()` not every runtime has.
 */
function streamOf(bytes: Uint8Array, size = 1024): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(at, at + size));
      at += size;
    },
  });
}

/** Every byte a stream gives, or null past `limit` bytes or on an error. */
async function readAll(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return all;
}

async function deflate(text: string): Promise<Uint8Array> {
  const out = await readAll(
    streamOf(new TextEncoder().encode(text)).pipeThrough(
      new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    ),
    Number.POSITIVE_INFINITY,
  );
  if (out === null) throw new Error('Could not compress the theme.');
  return out;
}

/**
 * Inflates `bytes`, or null past `limit` inflated bytes, on a corrupt
 * stream, or where the browser has no `DecompressionStream`.
 */
async function inflate(bytes: Uint8Array, limit: number): Promise<string | null> {
  if (typeof DecompressionStream !== 'function') return null;
  const all = await readAll(
    streamOf(bytes).pipeThrough(
      new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    ),
    limit,
  );
  if (all === null) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(all);
  } catch {
    return null;
  }
}

/** The hash, without `#`, that carries `file`. */
export async function themeHash(file: unknown): Promise<string> {
  return `${PREFIX}${ENCODING}${toBase64Url(await deflate(JSON.stringify(file)))}`;
}

/** A full link to `file` on this app's Settings page. */
export async function themeLink(file: unknown, origin: string = location.origin): Promise<string> {
  return `${origin}/settings#${await themeHash(file)}`;
}

/** Whether a location hash (with or without `#`) carries a theme. */
export function hasThemeHash(hash: string): boolean {
  return hash.replace(/^#/, '').startsWith(PREFIX);
}

/**
 * The JSON a theme hash carries, parsed but not yet checked as a theme
 * (`parseThemeFile` does that), or null when the hash carries none or it does
 * not decode.
 */
export async function readThemeHash(hash: string): Promise<unknown> {
  const body = hash.replace(/^#/, '');
  if (!body.startsWith(PREFIX)) return null;
  const payload = body.slice(PREFIX.length);
  if (!payload.startsWith(ENCODING) || payload.length > MAX_PAYLOAD_CHARS) return null;
  const bytes = fromBase64Url(payload.slice(ENCODING.length));
  if (bytes === null || bytes.byteLength === 0) return null;
  let text: string | null;
  try {
    text = await inflate(bytes, MAX_THEME_BYTES);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
