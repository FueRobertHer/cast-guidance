/**
 * UTF-8 byte length of a value's JSON form.
 *
 * This is what a cached row actually costs in content terms, as opposed to
 * `navigator.storage.estimate()`, which reports the browser's on-disk
 * footprint, which includes index overhead and space freed by deletes but not
 * yet compacted, so it drifts upward even when nothing was added.
 */
export function jsonByteSize(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string') return 0;
  return new Blob([text]).size;
}
