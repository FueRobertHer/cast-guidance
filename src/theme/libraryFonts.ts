import { FONT_CACHE, fontFamily, themeFont } from './fonts';

/**
 * Library fonts (fonts.ts) on demand: their faces are added to the document
 * only when a theme names one, and loaded at once, so a theme drawn while
 * online is whole offline afterwards (the service worker keeps each face).
 * Their list is a chunk of its own, so the app's first load carries none of
 * it.
 */

/** Faces added so far: by font id, then by the weight each is drawn at. */
const added = new Map<string, Map<string, FontFace>>();
/** Face files this page has put in the font cache itself (`keepForOffline`). */
const kept = new Set<string>();

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
 * A page the service worker does not control yet (the first visit, before a
 * reload) fetches past its font route, so nothing would keep these faces for
 * offline: it puts them in that route's cache itself.
 */
function keepForOffline(urls: string[]): void {
  const fresh = urls.filter((url) => !kept.has(url));
  if (fresh.length === 0 || typeof caches === 'undefined') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (navigator.serviceWorker.controller !== null) return;
  for (const url of fresh) kept.add(url);
  void caches
    .open(FONT_CACHE)
    .then((cache) => cache.addAll(fresh))
    .catch(() => {
      for (const url of fresh) kept.delete(url);
    });
}

/**
 * Adds these fonts' faces to the document (once each) and loads them.
 * Resolves true when every face is on this device, false when one could not
 * be fetched (offline, the first time). A face that failed is replaced, so
 * the next call tries it again. Where the browser has no font loading API
 * there is nothing to do, and it resolves true.
 */
export async function loadThemeFonts(ids: Iterable<unknown>): Promise<boolean> {
  const wanted = libraryFontIds(ids);
  if (wanted.length === 0 || !supported()) return true;
  const { LIBRARY_FACES } = await import('./libraryFaces');
  const urls = new Map<FontFace, string>();
  for (const id of wanted) {
    const font = themeFont(id);
    if (font === undefined) continue;
    const own = added.get(id) ?? new Map<string, FontFace>();
    added.set(id, own);
    for (const { weight, url } of LIBRARY_FACES[id] ?? []) {
      let face = own.get(weight);
      if (face?.status === 'error') document.fonts.delete(face);
      if (face === undefined || face.status === 'error') {
        face = new FontFace(fontFamily(font), `url("${url}") format("woff2")`, {
          weight,
          display: 'swap',
        });
        document.fonts.add(face);
        own.set(weight, face);
      }
      urls.set(face, url);
    }
  }
  const faces = [...urls.keys()];
  const loaded = await Promise.allSettled(faces.map((face) => face.load()));
  keepForOffline(
    faces.filter((_, i) => loaded[i]?.status === 'fulfilled').map((f) => urls.get(f) ?? ''),
  );
  return loaded.every((r) => r.status === 'fulfilled');
}
