import { fontFamily, themeFont } from './fonts';

/**
 * Library fonts (fonts.ts) on demand: their faces are added to the document
 * only when a theme names one, and loaded at once, so a theme drawn while
 * online is whole offline afterwards (the service worker keeps each face).
 * Their list is a chunk of its own, so the app's first load carries none of
 * it.
 */

/** Faces added so far, by font id. */
const added = new Map<string, FontFace[]>();

function supported(): boolean {
  return typeof FontFace !== 'undefined' && typeof document !== 'undefined' && !!document.fonts;
}

/** The library fonts among these ids (others come with the app or the device). */
export function libraryFontIds(ids: Iterable<unknown>): string[] {
  return [...new Set(ids)].filter(
    (id): id is string => typeof id === 'string' && themeFont(id)?.source === 'library',
  );
}

/**
 * Adds these fonts' faces to the document (once each) and loads them.
 * Resolves true when every face is on this device, false when one could not
 * be fetched (offline, the first time). A face that failed is dropped, so the
 * next call tries it again. Where the browser has no font loading API there
 * is nothing to do, and it resolves true.
 */
export async function loadThemeFonts(ids: Iterable<unknown>): Promise<boolean> {
  const wanted = libraryFontIds(ids);
  if (wanted.length === 0 || !supported()) return true;
  const { LIBRARY_FACES } = await import('./libraryFaces');
  const faces = wanted.flatMap((id) => {
    const font = themeFont(id);
    if (font === undefined) return [];
    let own = (added.get(id) ?? []).filter((face) => {
      if (face.status !== 'error') return true;
      document.fonts.delete(face);
      return false;
    });
    if (own.length === 0) {
      own = (LIBRARY_FACES[id] ?? []).map(
        (face) =>
          new FontFace(fontFamily(font), `url("${face.url}") format("woff2")`, {
            weight: face.weight,
            display: 'swap',
          }),
      );
      for (const face of own) document.fonts.add(face);
    }
    added.set(id, own);
    return own;
  });
  const loaded = await Promise.allSettled(faces.map((face) => face.load()));
  return loaded.every((r) => r.status === 'fulfilled');
}
