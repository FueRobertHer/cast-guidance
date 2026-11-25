import { Download, FileUp, Link2, Share2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  deleteTheme,
  previewTheme,
  readSavedThemes,
  readThemeChoice,
  resolveTheme,
  restoreTheme,
  type SavedTheme,
  saveTheme,
  type Theme,
  type ThemeChoice,
  TRY_SECONDS,
  useSavedThemes,
  useThemeChoice,
} from '@/lib/theme';
import { useUndoOffer } from '@/lib/useUndoOffer';
import { notify, notifyFailure } from '@/stores/notices';
import { builtInTheme } from '@/theme/builtins';
import { type ParsedTheme, type ParseResult, themeVars } from '@/theme/file';
import { hasThemeHash } from '@/theme/link';
import { Button } from '@/ui/Button';
import { askText } from '@/ui/dialogs';
import { Sheet } from '@/ui/sheet';
import { UndoBar } from '@/ui/UndoBar';
import { ThemeMini } from './ThemePicker';
import {
  downloadTheme,
  readThemeFile,
  readThemeLink,
  shareTheme,
  themeFileOf,
} from './themeTransfer';

function refuse(reason: string): void {
  notify({ title: 'Could not use this theme', detail: reason, tone: 'warn' });
}

/**
 * What came in from a file or a link, before anything is saved: its name,
 * who made it, a preview drawn in it, and what was left out. Trying it saves
 * it to Your themes and draws the page in it, in this tab only, until Keep
 * (ThemeKeepBanner).
 */
function ThemeImportSheet({
  incoming,
  onClose,
  builtIn,
}: {
  incoming: ParsedTheme | null;
  onClose: () => void;
  /** While a theme of one's own is in use, the built-in to draw in, as Appearance is. */
  builtIn: Theme | undefined;
}) {
  // Kept while the sheet closes, so it does not empty under its own animation.
  const [shown, setShown] = useState(incoming);
  if (incoming !== null && incoming !== shown) setShown(incoming);
  const file = shown?.file;

  const tryIt = () => {
    if (incoming === null) return;
    const { theme, stored } = saveTheme(incoming.file);
    if (!stored) {
      notify({
        title: 'This theme could not be saved on this device',
        detail: 'It lasts until this tab closes.',
        tone: 'warn',
      });
    }
    onClose();
    previewTheme(theme);
  };

  return (
    <Sheet.Root open={incoming !== null} onOpenChange={(open) => !open && onClose()}>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel
          data-theme={builtIn}
          className={
            builtIn === undefined
              ? 'flex max-h-[85dvh] flex-col'
              : 'flex max-h-[85dvh] flex-col font-sans text-ink'
          }
        >
          <Sheet.Heading close>
            {file === undefined ? 'Theme' : `Try “${file.name}”?`}
          </Sheet.Heading>
          {file !== undefined && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <div className="flex items-start gap-3">
                <div className="w-28 shrink-0">
                  <ThemeMini theme={file.base} vars={themeVars(file)} />
                </div>
                <div className="flex min-w-0 flex-col gap-1 text-caption text-ink-muted">
                  {file.author !== undefined && <p className="text-ink">By {file.author}</p>}
                  <p>
                    Built on {builtInTheme(file.base).label}. It changes{' '}
                    {Object.keys(file.tokens).length === 1
                      ? '1 value'
                      : `${Object.keys(file.tokens).length} values`}
                    .
                  </p>
                  <p>
                    You will see the app in it, and it goes back by itself after {TRY_SECONDS}{' '}
                    seconds unless you keep it.
                  </p>
                </div>
              </div>
              {shown !== null && shown.dropped.length > 0 && (
                <div className="flex flex-col gap-1 text-caption">
                  <p className="font-semibold text-ink">Left out, as this app cannot use them:</p>
                  <ul className="list-disc pl-5 text-ink-muted">
                    {shown.dropped.map((line) => (
                      <li key={line} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Button variant="brand" size="lg" block onClick={tryIt}>
                  Try this theme
                </Button>
                <Button variant="secondary" size="lg" block onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <Sheet.CloseButton />
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

interface ThemesState {
  themes: readonly SavedTheme[];
  choice: ThemeChoice;
}

/**
 * Theme files in and out (docs/theme-format.md), under the picker: import a
 * file, paste a link, export the theme in use, and share or delete one of the
 * player's own. A theme link opened on this page (`#theme=…`) lands here too,
 * and comes off the address once read.
 */
export function ThemeFiles() {
  const choice = useThemeChoice();
  const saved = useSavedThemes();
  const [incoming, setIncoming] = useState<ParsedTheme | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const take = (result: ParseResult) => {
    if (result.ok) setIncoming(result.theme);
    else refuse(result.reason);
  };

  // A theme link opened here: read once, then off the address, so a reload
  // or Back does not offer it again.
  useEffect(() => {
    if (!hasThemeHash(location.hash)) return;
    const hash = location.hash;
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
    void readThemeLink(hash).then((r) => (r.ok ? setIncoming(r.theme) : refuse(r.reason)));
  }, [location.hash, location.pathname, location.search, navigate]);

  const current = choice.startsWith('custom:')
    ? saved.find((t) => `custom:${t.id}` === choice)
    : undefined;

  const removedRef = useRef<ReturnType<typeof deleteTheme>>(null);
  const undo = useUndoOffer<ThemesState>({
    current: { themes: saved, choice },
    // By content, not identity: Undo writes a new list with the same themes,
    // and the bar must still say what it undid.
    same: (a, b) =>
      a.choice === b.choice &&
      a.themes.map((t) => t.id).join() === b.themes.map((t) => t.id).join(),
    restore: () => {
      if (removedRef.current !== null) restoreTheme(removedRef.current);
      removedRef.current = null;
    },
  });

  const remove = (theme: SavedTheme) => {
    const before: ThemesState = { themes: saved, choice };
    const removed = deleteTheme(theme.id);
    if (removed === null) return;
    removedRef.current = removed;
    undo.offer(
      before,
      { themes: readSavedThemes(), choice: readThemeChoice() },
      'Theme deleted',
      theme.file.name,
    );
  };

  const pasteLink = async () => {
    const text = await askText({
      title: 'Paste a theme link',
      placeholder: 'https://…/settings#theme=…',
    });
    if (text !== null && text.trim() !== '') take(await readThemeLink(text));
  };

  const exportCurrent = async () => {
    try {
      downloadTheme(await themeFileOf(choice));
    } catch (err) {
      notifyFailure('Export', err);
    }
  };

  const share = async (theme: SavedTheme) => {
    try {
      const how = await shareTheme(theme.file);
      if (how === 'copied') {
        notify({
          title: 'Theme link copied',
          detail: 'Anyone who opens it can try the theme.',
          tone: 'good',
        });
      }
    } catch (err) {
      notifyFailure('Share', err);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <FileUp size={18} aria-hidden="true" />
          Import a theme
        </Button>
        <Button variant="outline" size="sm" onClick={() => void pasteLink()}>
          <Link2 size={18} aria-hidden="true" />
          Paste a theme link
        </Button>
        <Button variant="outline" size="sm" onClick={() => void exportCurrent()}>
          <Download size={18} aria-hidden="true" />
          Export this theme
        </Button>
        {current !== undefined && (
          <>
            <Button variant="outline" size="sm" onClick={() => void share(current)}>
              <Share2 size={18} aria-hidden="true" />
              Share this theme
            </Button>
            <Button variant="outline" size="sm" onClick={() => remove(current)}>
              <Trash2 size={18} aria-hidden="true" />
              Delete this theme
            </Button>
          </>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) void readThemeFile(f).then(take);
          e.target.value = '';
        }}
      />
      <UndoBar pending={undo.pending} undone={undo.undone} onUndo={() => undo.run()} />
      <ThemeImportSheet
        incoming={incoming}
        onClose={() => setIncoming(null)}
        builtIn={choice.startsWith('custom:') ? resolveTheme(choice) : undefined}
      />
    </div>
  );
}
