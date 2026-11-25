/**
 * The library fonts' faces (fonts.ts), Latin only, as the build emits them:
 * not precached (vite.config.ts leaves out `LIBRARY_FONT_GLOBS`), and only in
 * the chunk libraryFonts.ts loads when a theme names one of them. Importing a
 * file `?url` makes the build copy it to `assets/` under its own name and a
 * content hash, so the service worker's cache-first font route keeps it.
 */

import cinzel400 from '@fontsource/cinzel/files/cinzel-latin-400-normal.woff2?url';
import cinzel600 from '@fontsource/cinzel/files/cinzel-latin-600-normal.woff2?url';
import cinzel700 from '@fontsource/cinzel/files/cinzel-latin-700-normal.woff2?url';
import ebGaramond400 from '@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2?url';
import ebGaramond600 from '@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2?url';
import ebGaramond700 from '@fontsource/eb-garamond/files/eb-garamond-latin-700-normal.woff2?url';
import fraunces400 from '@fontsource/fraunces/files/fraunces-latin-400-normal.woff2?url';
import fraunces600 from '@fontsource/fraunces/files/fraunces-latin-600-normal.woff2?url';
import fraunces700 from '@fontsource/fraunces/files/fraunces-latin-700-normal.woff2?url';
import imFellEnglish400 from '@fontsource/im-fell-english/files/im-fell-english-latin-400-normal.woff2?url';
import jetbrainsMono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';
import jetbrainsMono600 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2?url';
import jetbrainsMono700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url';
import lexend400 from '@fontsource/lexend/files/lexend-latin-400-normal.woff2?url';
import lexend600 from '@fontsource/lexend/files/lexend-latin-600-normal.woff2?url';
import lexend700 from '@fontsource/lexend/files/lexend-latin-700-normal.woff2?url';
import opendyslexic400 from '@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2?url';
import opendyslexic700 from '@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2?url';

export interface LibraryFace {
  /** The `font-weight` range it is drawn at. */
  readonly weight: string;
  readonly url: string;
}

export const LIBRARY_FACES: Readonly<Record<string, readonly LibraryFace[]>> = {
  'eb-garamond': [
    { weight: '400', url: ebGaramond400 },
    { weight: '600', url: ebGaramond600 },
    { weight: '700', url: ebGaramond700 },
  ],
  fraunces: [
    { weight: '400', url: fraunces400 },
    { weight: '600', url: fraunces600 },
    { weight: '700', url: fraunces700 },
  ],
  lexend: [
    { weight: '400', url: lexend400 },
    { weight: '600', url: lexend600 },
    { weight: '700', url: lexend700 },
  ],
  opendyslexic: [
    { weight: '400', url: opendyslexic400 },
    { weight: '700', url: opendyslexic700 },
  ],
  'jetbrains-mono': [
    { weight: '400', url: jetbrainsMono400 },
    { weight: '600', url: jetbrainsMono600 },
    { weight: '700', url: jetbrainsMono700 },
  ],
  cinzel: [
    { weight: '400', url: cinzel400 },
    { weight: '600', url: cinzel600 },
    { weight: '700', url: cinzel700 },
  ],
  // Its one weight, at any weight a theme asks for: the browser would
  // otherwise thicken it for a semibold title, and smear it.
  'im-fell-english': [{ weight: '300 800', url: imFellEnglish400 }],
};
