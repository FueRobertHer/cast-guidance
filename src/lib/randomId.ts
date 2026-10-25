/**
 * A random identifier that is unique in practice. `randomUUID` exists only in
 * secure contexts, and a plain-http dev server is not one, so outside them
 * this falls back to the clock and `Math.random`: weaker, but nothing that
 * uses it is a secret, only a token that must not repeat.
 */
export function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36)}`
  );
}
