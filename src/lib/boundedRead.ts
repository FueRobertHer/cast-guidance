/**
 * Byte-bounded reads of untrusted bodies (remote responses, picked files).
 *
 * `res.json()` and `file.text()` buffer the whole body before anything can
 * look at it, so a hostile or broken server could hand the app a gigabyte of
 * JSON and the tab would spend its memory parsing it before any structural
 * check ran. These read at most `maxBytes` and refuse the rest unread.
 */

export class ResponseTooLargeError extends Error {
  readonly limit: number;
  /** What had arrived when the read stopped, or what the server declared. */
  readonly received?: number;

  constructor(limit: number, received?: number, what = 'response') {
    super(
      received === undefined
        ? `${what} is larger than the ${limit} byte limit`
        : `${what} is larger than the ${limit} byte limit (${received} bytes)`,
    );
    this.name = 'ResponseTooLargeError';
    this.limit = limit;
    this.received = received;
  }
}

/** The declared body size, when the server sent a usable one. */
function declaredLength(res: Response): number | undefined {
  const raw = res.headers.get('content-length');
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Read a response body as UTF-8 text, refusing it once it passes `maxBytes`.
 *
 * The count is taken over what the reader yields, which is the body after the
 * browser has undone any Content-Encoding: the decoded size is what costs
 * memory and parse time, so it is the right thing to limit.
 */
export async function readTextBounded(res: Response, maxBytes: number): Promise<string> {
  return (await readTextBoundedSized(res, maxBytes)).text;
}

/**
 * {@link readTextBounded}, plus the UTF-8 byte count it metered on the way, so
 * a caller that reports the size does not encode the text a second time.
 */
export async function readTextBoundedSized(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number }> {
  // An early refusal before a byte is read. Content-Length is CORS-safelisted,
  // so cross-origin mirrors expose it. With a Content-Encoding it is the
  // compressed size. Gzip or Brotli can only grow text that does not compress
  // by a few bytes of framing, and JSON compresses well, so a value over the
  // limit is still a safe reason to refuse; a value under it
  // proves nothing, and the streaming count below still applies.
  const declared = declaredLength(res);
  if (declared !== undefined && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(maxBytes, declared);
  }

  const body = res.body;
  if (body === null) {
    // No stream to meter (some polyfills, some test doubles): read it whole
    // and still refuse it before anyone parses it.
    const text = await res.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) throw new ResponseTooLargeError(maxBytes, bytes);
    return { text, bytes };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Tell the source to stop sending: without this the connection keeps
      // filling a buffer nobody will read.
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(maxBytes, total);
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return { text: parts.join(''), bytes: total };
}

/** {@link readTextBounded}, then parse. */
export async function readJsonBounded(res: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readTextBounded(res, maxBytes)) as unknown;
}

/**
 * A picked file's text, refused by its size before any of it is read. A
 * `File` knows its size up front, so nothing needs streaming here.
 */
export async function readFileTextBounded(file: Blob, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) throw new ResponseTooLargeError(maxBytes, file.size, 'file');
  return file.text();
}
