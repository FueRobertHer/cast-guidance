import { ArrowLeft, ChevronDown, Undo2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  customChoice,
  readPreview,
  readThemeChoice,
  resolveTheme,
  type SavedTheme,
  savedTheme,
  saveTheme,
  setThemeChoice,
  updateTheme,
} from '@/lib/theme';
import { notify } from '@/stores/notices';
import { BUILT_IN_THEMES, type BuiltInThemeId, isBuiltInTheme } from '@/theme/builtins';
import {
  commit,
  type Draft,
  draftFile,
  draftFromBuiltIn,
  draftFromTheme,
  dropKeptDraft,
  type History,
  keepDraft,
  readKeptDraft,
  resetToken,
  sameDraft,
  setBase,
  setToken,
  shown,
  startHistory,
  type Tables,
  tablesFrom,
  undo,
} from '@/theme/draft';
import { followsLabel, TOKEN_LABELS } from '@/theme/labels';
import { VOCABULARY } from '@/theme/vocabulary';
import { Button, buttonClass } from '@/ui/Button';
import { askConfirm } from '@/ui/dialogs';
import { fieldClass, TextField } from '@/ui/TextField';
import { CONTROLS, type ControlContext } from './themeEditor/controls';
import { EDITOR_GROUPS } from './themeEditor/groups';
import { ThemeSample } from './themeEditor/ThemeSample';

/**
 * The theme editor (docs/theming-plan.md, phase 4): `/settings/theme` makes a
 * theme from the one in use, `/settings/theme/<id>` edits a saved one. A
 * focused flow, as the Workshop's editors are: its own header, Save at the
 * foot, and Back asks before dropping changes.
 *
 * The draft is drawn only in the sample at the top; the page stays in the
 * theme in use, so nothing the person does to the draft can make the controls
 * unreadable. The draft is kept on the device as it changes (draft.ts), so a
 * tab the phone closed can pick up where it was.
 */

const KIND = new Map(VOCABULARY.map((t) => [t.name, t.kind]));
const ICON = 'tap shrink-0 rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';

/** The draft a visit starts from: the saved theme, or a copy of the theme in use. */
function startingDraft(tables: Tables, target: SavedTheme | undefined): Draft {
  if (target !== undefined) return draftFromTheme(target.file, tables, target.own);
  // The theme on screen: one being tried, else the stored choice.
  const choice = readThemeChoice();
  const id = choice.startsWith('custom:') ? choice.slice('custom:'.length) : null;
  const inUse = readPreview() ?? (id === null ? undefined : savedTheme(id));
  if (inUse === undefined) return draftFromBuiltIn(resolveTheme(choice));
  const copy = draftFromTheme(inUse.file, tables, inUse.own);
  return { ...copy, name: `${copy.name} copy` };
}

function TokenRow({
  name,
  draft,
  tables,
  context,
  onEdit,
  onReset,
}: {
  name: string;
  draft: Draft;
  tables: Tables;
  context: ControlContext;
  onEdit: (name: string, raw: unknown, key?: string) => string | null;
  onReset: (name: string) => void;
}) {
  const labelId = useId();
  const row = useRef<HTMLDivElement>(null);
  // Reset and Set its own take their own button away: focus goes to the
  // row's other action, or its control, rather than falling to the page.
  const refocus = useRef(false);
  const s = shown(draft, tables, name);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    row.current?.querySelector<HTMLElement>('[data-row-action], input, select, button')?.focus();
  });
  const kind = KIND.get(name);
  if (kind === undefined) return null;
  const Control = CONTROLS[kind];
  const label = TOKEN_LABELS[name] ?? name;
  return (
    <div ref={row} data-token-row={name} className="flex flex-col gap-1.5 py-3">
      <div className="flex min-h-tap flex-wrap items-center gap-x-2">
        <span id={labelId} className="text-body-strong">
          {label}
        </span>
        {s.how === 'follows' && s.follows !== undefined && (
          <span className="text-caption text-ink-muted">Follows {followsLabel(s.follows)}</span>
        )}
        <span className="ml-auto">
          {s.how === 'own' ? (
            <Button
              variant="ghost"
              size="sm"
              data-row-action=""
              aria-label={`Reset ${label}`}
              onClick={() => {
                refocus.current = true;
                onReset(name);
              }}
            >
              Reset
            </Button>
          ) : s.how === 'follows' ? (
            <Button
              variant="ghost"
              size="sm"
              data-row-action=""
              aria-label={`Set its own ${label}`}
              onClick={() => {
                refocus.current = true;
                onEdit(name, s.value);
              }}
            >
              Set its own
            </Button>
          ) : null}
        </span>
      </div>
      <Control
        name={name}
        label={label}
        labelId={labelId}
        value={s.value}
        context={context}
        onChange={(raw, key) => onEdit(name, raw, key)}
        onReset={() => onReset(name)}
      />
    </div>
  );
}

function Editor({
  tables,
  target,
  initial,
}: {
  tables: Tables;
  target: SavedTheme | undefined;
  initial: Draft;
}) {
  const navigate = useNavigate();
  const [history, setHistory] = useState<History>(() => startHistory(initial));
  const [kept, setKept] = useState<Draft | null>(() => {
    const k = readKeptDraft(target?.id ?? null);
    return k !== null && !sameDraft(k, initial) ? k : null;
  });
  const [folded, setFolded] = useState(false);
  const draft = history.present;
  const dirty = !sameDraft(draft, initial);
  const file = useMemo(() => draftFile(draft, tables), [draft, tables]);

  // Kept as it changes, once there is anything to keep; dropped when undone
  // back to where it started. A draft offered for resuming is left alone
  // until the person answers.
  // Whether this visit kept a draft, so undoing back to the start drops it.
  const keptHere = useRef(false);
  useEffect(() => {
    if (kept !== null) return;
    if (dirty) {
      keepDraft(target?.id ?? null, draft);
      keptHere.current = true;
    } else if (keptHere.current) {
      dropKeptDraft();
      keptHere.current = false;
    }
  }, [draft, dirty, kept, target]);

  // Each change applies to the latest draft, not the one last drawn, so two
  // edits between renders both land. The check against the drawn draft is
  // only for saying at once why an entry is refused.
  const onEdit = (name: string, raw: unknown, key?: string): string | null => {
    const probe = setToken(draft, tables, name, raw);
    if ('error' in probe) return probe.error;
    setHistory((h) => {
      const result = setToken(h.present, tables, name, raw);
      return 'error' in result ? h : commit(h, result.draft, key);
    });
    return null;
  };
  const change = (next: (d: Draft) => Draft, key?: string) =>
    setHistory((h) => commit(h, next(h.present), key));

  const context: ControlContext = {
    bodyFont: String(shown(draft, tables, 'font-sans').value),
    bg: String(shown(draft, tables, 'bg').value),
    ink: String(shown(draft, tables, 'ink').value),
    lineStrong: String(shown(draft, tables, 'line-strong').value),
  };

  const leave = async () => {
    if (dirty) {
      const ok = await askConfirm({
        title: 'Leave without saving?',
        detail: 'The theme you were making is lost.',
        confirmLabel: 'Leave',
        danger: true,
      });
      if (!ok) return;
      dropKeptDraft();
    }
    navigate('/settings');
  };

  const save = (asCopy: boolean) => {
    const own = Object.keys(draft.own);
    const unsaved = {
      title: 'This theme could not be saved on this device',
      detail: 'It lasts until this tab closes.',
      tone: 'warn' as const,
    };
    // In place, unless the theme went meanwhile (deleted in another tab):
    // then it is saved as a new one, not lost.
    const inPlace = target !== undefined && !asCopy ? updateTheme(target.id, file, own) : null;
    if (target !== undefined && inPlace !== null) {
      setThemeChoice(customChoice(target.id));
      notify(
        inPlace
          ? { title: `Saved ${file.name}`, detail: 'The app is drawn in it now.', tone: 'good' }
          : unsaved,
      );
    } else {
      const { theme, stored, existing } = saveTheme(file, own, { copy: asCopy });
      setThemeChoice(customChoice(theme.id));
      notify(
        !stored
          ? unsaved
          : existing
            ? {
                title: `${theme.file.name} was already in your themes`,
                detail: 'It is the one in use now.',
                tone: 'info',
              }
            : { title: `Saved ${file.name}`, detail: 'The app is drawn in it now.', tone: 'good' },
      );
    }
    dropKeptDraft();
    navigate('/settings');
  };

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-3 pb-6">
        <header className="flex items-start gap-1">
          <button
            type="button"
            aria-label="Back"
            onClick={() => void leave()}
            className={`-ml-3 ${ICON}`}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 pt-1.5">
            <h1 className="font-display text-title-page break-words">
              {target === undefined ? 'Make a theme' : 'Edit theme'}
            </h1>
          </div>
          <button
            type="button"
            aria-label="Undo"
            disabled={history.past.length === 0}
            onClick={() => setHistory(undo)}
            className={`-mr-3 ${ICON} disabled:opacity-40`}
          >
            <Undo2 size={20} aria-hidden="true" />
          </button>
        </header>

        {kept !== null && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-control bg-guide-soft px-3 py-2 text-caption text-ink"
          >
            <p>You were making a theme here before, and did not save it.</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setHistory((h) => commit(h, kept));
                  setKept(null);
                }}
              >
                Pick it up
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  dropKeptDraft();
                  setKept(null);
                }}
              >
                Start over
              </Button>
            </div>
          </div>
        )}

        <div className="sticky top-0 z-10 -mx-2 bg-bg px-2 pt-1 pb-2">
          <ThemeSample file={file} folded={folded} onFold={() => setFolded((f) => !f)} />
        </div>

        <div className="flex flex-col gap-3">
          <TextField
            label="Name"
            value={draft.name}
            maxLength={60}
            onChange={(e) => {
              const name = e.target.value;
              change((d) => ({ ...d, name }), 'name');
            }}
          />
          <TextField
            label="Made by (optional)"
            value={draft.author}
            maxLength={60}
            onChange={(e) => {
              const author = e.target.value;
              change((d) => ({ ...d, author }), 'author');
            }}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-ink">Start from</span>
            <select
              value={draft.base}
              onChange={(e) => {
                if (isBuiltInTheme(e.target.value)) {
                  const base = e.target.value as BuiltInThemeId;
                  change((d) => setBase(d, base, tables));
                }
              }}
              className={fieldClass}
            >
              {BUILT_IN_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="text-caption text-ink-muted">
              Everything you have not set comes from it. What you set stays as you change it.
            </span>
          </label>
        </div>

        {EDITOR_GROUPS.map((group) => (
          <details
            key={group.id}
            open={group.id === 'start'}
            className="cg-card group rounded-card bg-surface shadow-card ring ring-line ring-inset"
          >
            <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 px-4 py-3">
              <span className="flex-1 text-heading">{group.title}</span>
              <ChevronDown
                size={18}
                aria-hidden="true"
                className="text-ink-muted group-open:rotate-180"
              />
            </summary>
            <div className="flex flex-col divide-y divide-line px-4 pb-2">
              {group.hint !== undefined && (
                <p className="pb-2 text-caption text-ink-muted">{group.hint}</p>
              )}
              {group.tokens.map((name) => (
                <TokenRow
                  key={name}
                  name={name}
                  draft={draft}
                  tables={tables}
                  context={context}
                  onEdit={onEdit}
                  onReset={(n) => change((d) => resetToken(d, n, tables))}
                />
              ))}
              {group.more !== undefined && (
                <details className="group/more py-2">
                  <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-body-strong">
                    <span className="flex-1">{group.more.title}</span>
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className="text-ink-muted group-open/more:rotate-180"
                    />
                  </summary>
                  <div className="flex flex-col divide-y divide-line">
                    {group.more.tokens.map((name) => (
                      <TokenRow
                        key={name}
                        name={name}
                        draft={draft}
                        tables={tables}
                        context={context}
                        onEdit={onEdit}
                        onReset={(n) => change((d) => resetToken(d, n, tables))}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </details>
        ))}
      </div>
      <footer className="sticky bottom-0 z-10 border-line border-t bg-bg">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-end gap-3 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {target !== undefined && (
            <Button variant="secondary" size="lg" onClick={() => save(true)}>
              Save as a copy
            </Button>
          )}
          <button
            type="button"
            onClick={() => save(false)}
            className={buttonClass({ variant: 'brand', size: 'lg' })}
          >
            Save
          </button>
        </div>
      </footer>
    </main>
  );
}

export function Component() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tables, setTables] = useState<Tables | null>(null);
  const target = id === undefined ? undefined : savedTheme(id);

  useEffect(() => {
    let live = true;
    void import('@/styles/themes.css?raw').then((m) => {
      if (live) setTables(tablesFrom(m.default));
    });
    return () => {
      live = false;
    };
  }, []);

  const initial = useMemo(
    () => (tables === null ? null : startingDraft(tables, target)),
    [tables, target],
  );

  if (id !== undefined && target === undefined) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 pt-5">
        <h1 className="font-display text-title-page">Theme not found</h1>
        <p className="text-ink-muted">This theme is not saved on this device.</p>
        <Button variant="outline" onClick={() => navigate('/settings')}>
          Back to Settings
        </Button>
      </main>
    );
  }
  if (tables === null || initial === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-ink-muted">
        <p role="status">Opening the editor…</p>
      </main>
    );
  }
  return <Editor tables={tables} target={target} initial={initial} />;
}
