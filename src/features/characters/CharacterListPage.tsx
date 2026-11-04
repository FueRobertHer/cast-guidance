import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Ellipsis, FileUp, UserPlus } from 'lucide-react';
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DATA_TAG } from '@/data5e/config';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useRegistryState } from '@/data5e/hooks';
import { characterRepo, type PreparedCharacterImport } from '@/db/characterRepo';
import { conditionMaxHp } from '@/engine/conditions';
import { hasMissingData, missingCharacterData } from '@/engine/dataNeeds';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import {
  clearDraft,
  type DraftEnvelope,
  draftName,
  draftSummary,
  isBlankDraft,
  RESUME_STATE,
  readDraft,
  restoreDraft,
} from '@/features/creator/draft';
import { readFileTextBounded } from '@/lib/boundedRead';
import { IMPORT_LIMITS } from '@/lib/guards';
import { relativeTime } from '@/lib/relativeTime';
import { useLongPress } from '@/lib/useLongPress';
import { usePageTitle } from '@/lib/usePageTitle';
import { useUndoOffer } from '@/lib/useUndoOffer';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { useDataStatus } from '@/stores/dataStatus';
import { errorText, notifyFailure } from '@/stores/notices';
import { Button, buttonClass } from '@/ui/Button';
import { askChoice, askText } from '@/ui/dialogs';
import { cardClass } from '@/ui/surfaces';
import { UndoBar } from '@/ui/UndoBar';
import { GettingStarted } from '../onboarding/GettingStarted';
import { confirmDeleteCharacter, deleteCharacter, exportCharacter } from './characterActions';
import type { CharacterPreview } from './importPreview';

/**
 * The import preview, its gathering and its commit, loaded only once an import
 * starts (IMP-002): the roster is the first screen, and most visits never
 * import anything.
 */
const loadImportFlow = () => import('./CharacterImportPreview');
const CharacterImportPreview = lazy(loadImportFlow);

/** A validated import and its preview, waiting for Import or Cancel. */
interface PendingImport {
  prepared: PreparedCharacterImport;
  preview: CharacterPreview;
  sourceSpellingOf: (lower: string) => string;
}

/**
 * The class list, or none: the importer accepts an export with no class list,
 * and the roster must still render it (REL-005).
 */
function classesOf(doc: CharacterDoc): CharacterDoc['classes'] {
  return Array.isArray(doc.classes) ? doc.classes : [];
}

/** "Dwarf Cleric 3", or "Elf, no class yet" before a class is picked. */
function whoSummary(doc: CharacterDoc): string {
  const race = doc.race?.name;
  if (race === undefined) return classSummary(doc);
  return classesOf(doc).length === 0 ? `${race}, no class yet` : `${race} ${classSummary(doc)}`;
}

function classSummary(doc: CharacterDoc): string {
  const classes = classesOf(doc);
  if (classes.length === 0) return 'No class yet';
  // Defensive: a corrupted class entry (missing ref) must not throw while
  // rendering the list: one bad record cannot take down the page (REL-005).
  return classes
    .map((c) => {
      const name = c.ref?.name ?? 'Unknown class';
      const sub = c.subclass?.name !== undefined ? ` · ${c.subclass.name}` : '';
      return `${name} ${c.levels}${sub}`;
    })
    .join(' / ');
}

/**
 * The card's one action control. Square and 44px because it is the only thing
 * on the card a thumb has to hit precisely; the rest of the card is the
 * character. Its hover is a step above the card's own, which the card takes
 * under it. It sits over the slot the link holds for it, clear of the card's
 * padding, the 20px chevron and the gap before it (see `CharacterCard`).
 */
const ROW_ACTION =
  'absolute top-1/2 right-[calc(1.5rem+20px)] flex size-tap -translate-y-1/2 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink active:bg-surface-hover active:text-ink';

/**
 * Up to two initials for the card's monogram (DS-001's character card), in
 * place of a portrait. Decoration: the name beside it is what gets read.
 */
function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return letters === '' ? '?' : letters;
}

interface Vitals {
  hp: number;
  maxHp: number;
}

/** When the character last changed; nothing for a record with no readable date. */
function lastChanged(doc: CharacterDoc): string | undefined {
  const at = Date.parse(doc.updatedAt);
  if (Number.isNaN(at)) return undefined;
  const date = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return relativeTime(at, Date.now(), date);
}

/**
 * The HP line, at one fixed height whether or not the numbers have arrived.
 *
 * They need the whole compendium, which lands a beat after the names do.
 * Rendering nothing until then made every row grow. Reserving bare space
 * stopped the growth but left the values popping into an empty strip, which
 * still reads as a flash. So the line is always the same shape: the same track
 * element sits there the whole time and the numbers keep their footprint as
 * a muted placeholder, leaving only the bar's fill and one short string to
 * arrive, gently.
 */
function VitalsLine({ v }: { v?: Vitals }) {
  const ratio = v === undefined || v.maxHp <= 0 ? 0 : Math.max(0, Math.min(1, v.hp / v.maxHp));
  // The sheet's HP bar colours (DS-001): healthy, then the mid range, then low.
  const color = ratio > 0.5 ? 'bg-heal' : ratio > 0.25 ? 'bg-meter-mid' : 'bg-danger';
  return (
    // Nowrap because the line is a fixed 16px: letting "19 / 27 HP" fall to a
    // second line at the narrowest widths spills it out of the space held for it.
    <div className="mt-1.5 flex h-4 items-center gap-2 text-xs whitespace-nowrap text-ink-muted tabular-nums">
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-track">
        {v !== undefined && (
          <span
            className={`block h-full motion-safe:animate-fade-in ${color}`}
            style={{ width: `${ratio * 100}%` }}
          />
        )}
      </span>
      {v === undefined ? (
        <span className="h-2 w-16 rounded-full bg-track" />
      ) : (
        <span className="motion-safe:animate-fade-in">
          {v.hp} / {v.maxHp} HP
        </span>
      )}
    </div>
  );
}

/**
 * One character on the roster (DS-001's character card). The whole card is the
 * link, and the chevron says so. Its actions open from the ⋯ button or from a
 * long press on the card; the button is the way that can be seen and reached
 * by keyboard, so it stays, beside the link rather than inside it (a button in
 * a link is two controls in one, which neither a click nor a screen reader can
 * tell apart). The link holds an empty slot that the button is laid over.
 */
function CharacterCard({
  c,
  vitals,
  vitalsDue,
  onActions,
}: {
  c: CharacterDoc;
  vitals?: Vitals;
  /** The numbers are on their way, so the line holds their place. */
  vitalsDue: boolean;
  onActions: () => void;
}) {
  const actions = useRef<HTMLButtonElement>(null);
  const changed = lastChanged(c);
  const hold = useLongPress(() => {
    // The sheet hands focus back to whatever had it when it opened, so give
    // it to the button this hold stands in for, as a tap on it would.
    actions.current?.focus();
    onActions();
  });
  return (
    <div className="group @container relative">
      {/* Not draggable and no callout, so a held finger opens the actions
          instead of picking the link up or showing the browser's own menu. */}
      <Link
        to={`/c/${c.id}`}
        draggable={false}
        {...hold}
        className="flex items-center gap-3 rounded-card bg-surface py-3 pr-3 pl-4 shadow-card ring-1 ring-line ring-inset transition-colors select-none [-webkit-touch-callout:none] group-hover:bg-surface-raised"
      >
        {/* Decoration, so it is the first thing to go when a large text size
            leaves the card narrow (under 15rem, so measured in text): the
            actions slot and the chevron hold their width, and the name
            needs the rest. */}
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-raised font-display text-title-sheet ring-1 ring-line ring-inset @max-[15rem]:hidden"
        >
          {initials(c.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-title-card">{c.name}</div>
          <div className="truncate text-caption text-ink-muted">
            {whoSummary(c)}
            {changed !== undefined ? ` · ${changed}` : ''}
          </div>
          {(vitals !== undefined || vitalsDue) && <VitalsLine v={vitals} />}
        </div>
        <span aria-hidden="true" className="w-tap shrink-0 self-stretch" />
        <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-faint" />
      </Link>
      {/* `title` for the mouse, `aria-label` for the screen reader: four
          rows of "More" otherwise announce identically, with nothing to
          say which character each one belongs to. */}
      <button
        ref={actions}
        type="button"
        title="More"
        aria-label={`Actions for ${c.name}`}
        aria-haspopup="dialog"
        onClick={onActions}
        className={ROW_ACTION}
      >
        <Ellipsis size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Component() {
  usePageTitle('Characters');
  const navigate = useNavigate();
  const { registry, status: registryStatus } = useRegistryState(['essentials']);
  const phase = useDataStatus((s) => s.phase);
  const result = useLiveQuery(() => characterRepo.listSafe(), []);
  const characters = result?.characters ?? [];
  const readErrors = result?.errors ?? [];
  const importInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [importStatus, setImportStatusText] = useState<string>();
  /**
   * The import line, on screen and said (A11Y-002): the line below is a plain
   * visual and each message goes through the announcer once, the check in
   * progress and then its outcome. Each answers something the person did, so
   * the same words twice (the same file imported twice) are said twice. The
   * check has a key of its own, so its answer is not held behind it by the
   * outcome key's throttle.
   */
  const setImportStatus = (text: string | undefined, key = 'import') => {
    setImportStatusText(text);
    // An outcome replaces the check, so a check still waiting on its throttle
    // is not heard after its own answer.
    if (key !== 'import-check') cancelAnnouncement('import-check');
    if (text !== undefined) announce(text, { key, repeat: true });
  };
  const [pendingImport, setPendingImport] = useState<PendingImport>();
  const [checking, setChecking] = useState(false);
  // Which check is the latest: a slow one must not land after a newer one
  // and swap its preview in, or Import would store a file nobody was shown.
  const latestImport = useRef(0);

  /**
   * Validate the file and show what importing it would do; nothing is written
   * until Import. Refused by size before it is read: the text-length check in
   * `prepareImport` only runs once the whole file is in memory.
   */
  const previewImport = async (file: File) => {
    latestImport.current += 1;
    const request = latestImport.current;
    setImportStatus(`Checking "${file.name}"…`, 'import-check');
    setChecking(true);
    try {
      const prepared = await characterRepo.prepareImport(
        await readFileTextBounded(file, IMPORT_LIMITS.maxImportBytes),
      );
      const flow = await loadImportFlow();
      const preview = await flow.buildCharacterPreview(prepared);
      if (request !== latestImport.current) return;
      setImportStatus(undefined);
      // The dialog's title answers the check.
      cancelAnnouncement('import-check');
      setPendingImport({ prepared, preview, sourceSpellingOf: flow.spellingLookup(prepared) });
    } catch (err) {
      // Validation and the preview write nothing, so this is never a storage
      // failure: the error's own message says what went wrong.
      if (request === latestImport.current) setImportStatus(`Import failed: ${errorText(err)}`);
    } finally {
      if (request === latestImport.current) setChecking(false);
    }
  };

  const confirmImport = async () => {
    const p = pendingImport;
    if (p === undefined) return;
    setPendingImport(undefined);
    setImportStatus(await (await loadImportFlow()).commitCharacterImport(p.prepared));
  };

  const cancelImport = () => {
    setPendingImport(undefined);
    setImportStatus('Import canceled. Nothing was added.');
  };

  // The wizard's unfinished draft, read once: it lives in this tab's
  // sessionStorage, and nothing else writes it while the roster is open.
  // Wrapped, so "no draft" after a discard is a state the undo can anchor to.
  const [stored, setStored] = useState<{ draft: DraftEnvelope | null }>(() => {
    const draft = readDraft();
    return { draft: draft !== null && !isBlankDraft(draft) ? draft : null };
  });
  // The undo line is mounted only on a roster that showed a draft, so it is
  // in place, empty, before a discard fills it.
  const [hadDraft] = useState(() => stored.draft !== null);
  const draftUndo = useUndoOffer<{ draft: DraftEnvelope | null }>({
    current: stored,
    same: (a, b) => a.draft === b.draft,
    restore: (before) => {
      if (before.draft !== null) restoreDraft(before.draft);
      setStored(before);
    },
  });
  // Discard unmounts the card it sits on, so focus moves to the Undo button.
  const [undoFocus, setUndoFocus] = useState(0);
  const discardDraft = () => {
    const before = stored;
    if (before.draft === null) return;
    clearDraft();
    const after = { draft: null };
    setStored(after);
    draftUndo.offer(before, after, `Discarded draft ${draftName(before.draft.doc)}`);
    setUndoFocus((n) => n + 1);
  };
  const unfinished = stored.draft;

  // At-a-glance vitals per character (few characters → deriving all is cheap).
  const vitals = useMemo(() => {
    const map = new Map<string, Vitals>();
    if (registry === null) return map;
    const ctx = engineContextFor(registry);
    for (const c of characters) {
      if (classesOf(c).length === 0) continue;
      try {
        // No numbers from files that have not arrived (see `missingCharacterData`).
        // Once the whole compendium is here, what is still missing is not coming,
        // and the row says what the sheet says.
        if (phase !== 'done' && hasMissingData(missingCharacterData(c, ctx))) continue;
        const sheet = deriveSheet(c, ctx);
        // The maximum in play, as the sheet shows it (2014 exhaustion halves it).
        const maxHp = conditionMaxHp(sheet.maxHp.value, c.play.conditions, c.rulesVersion).value;
        map.set(c.id, { hp: c.play.currentHp, maxHp });
      } catch {
        // skip a character that can't derive (e.g. missing homebrew)
      }
    }
    return map;
  }, [characters, registry, phase]);

  // New characters open straight in the Build page (the primary editor).
  const createBlank = async () => {
    const doc = newCharacterDoc(crypto.randomUUID(), 'New hero', DATA_TAG);
    try {
      await characterRepo.put(doc);
    } catch (err) {
      notifyFailure('Create', err);
      return;
    }
    void navigate(`/c/${doc.id}/build`);
  };

  /**
   * The screen's one primary action (DS-001), and behind it the two ways to
   * make a character. They are the same decision approached differently, so
   * neither is picked for you: which suits you depends on how you like to
   * work, not on which is better. Asked in a sheet rather than shown as two
   * buttons, so the page keeps one primary action and both ways stay a tap
   * apart with room to say how they differ.
   */
  const newCharacter = async () => {
    const how = await askChoice({
      title: 'New character',
      options: [
        { id: 'wizard', label: 'Guided wizard', hint: 'Step by step' },
        { id: 'blank', label: 'Blank sheet', hint: 'Change anything' },
      ],
    });
    if (how === 'wizard') void navigate('/create');
    else if (how === 'blank') await createBlank();
  };

  const rename = async (c: CharacterDoc) => {
    const name = await askText({ title: 'Rename hero', initial: c.name });
    if (name === null || name.trim() === '') return;
    try {
      // The name alone: writing this list's copy of the whole character would
      // undo anything a tab with it open saved since the list last read it.
      await characterRepo.rename(c.id, name.trim());
    } catch (err) {
      notifyFailure('Rename', err);
    }
  };

  const remove = async (c: CharacterDoc) => {
    if (!(await confirmDeleteCharacter(c.name))) return;
    try {
      await deleteCharacter(c.id);
    } catch (err) {
      notifyFailure('Delete', err);
    }
  };

  /**
   * Everything you can do *to* a character, one sheet behind one control.
   *
   * These four used to sit in the row as 32px icons: below the size a thumb can
   * reliably hit, four of them eating 152px of a 343px row, and Delete one
   * mis-tap away from Duplicate. They are all occasional next to the thing this
   * row is actually for, which is opening the character, so the row keeps the
   * name and one full-size control, and the actions get room to be labelled in
   * words instead of guessed from a glyph.
   *
   * The sheet is titled with the character, because by the time it opens the
   * row that summoned it is behind an overlay.
   */
  const rowActions = async (c: CharacterDoc) => {
    const picked = await askChoice({
      title: c.name,
      options: [
        { id: 'rename', label: 'Rename' },
        { id: 'duplicate', label: 'Duplicate' },
        { id: 'export', label: 'Export', hint: 'JSON file' },
        { id: 'delete', label: 'Delete', danger: true },
      ],
    });
    switch (picked) {
      case 'rename':
        await rename(c);
        break;
      case 'duplicate':
        try {
          await characterRepo.duplicate(c.id);
        } catch (err) {
          notifyFailure('Duplicate', err);
        }
        break;
      case 'export':
        try {
          await exportCharacter(c);
        } catch (err) {
          notifyFailure('Export', err);
        }
        break;
      case 'delete':
        await remove(c);
        break;
      default:
        break;
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      {/* Wraps, so at a large text size Import drops under the title rather
          than pushing the page sideways. */}
      <header className="flex flex-wrap items-center justify-between gap-x-2">
        {/* Focusable so hiding the getting-started card hands focus back here
            instead of dropping it to the page body. */}
        <h1 ref={heading} tabIndex={-1} className="font-display text-title-page outline-none">
          Characters
        </h1>
        {/* Bringing in a character that already exists, not a way to make
            one, so it sits apart from New character and quieter. Its glyph
            lines up with the gutter. aria-disabled rather than disabled while
            a file is checked, so it keeps focus: the preview hands focus back
            to it. */}
        <button
          type="button"
          title="Import a character file"
          aria-label="Import a character file"
          onClick={() => {
            if (!checking) importInput.current?.click();
          }}
          aria-disabled={checking}
          aria-busy={checking}
          className={`-mr-3 ${buttonClass({ variant: 'ghost', size: 'icon' })}`}
        >
          <FileUp size={20} aria-hidden />
        </button>
      </header>
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) void previewImport(f);
          e.target.value = '';
        }}
      />
      {/* Under the button it answers. A plain visual: `setImportStatus` says
          each outcome through the announcer, so a live role here would say it
          twice. */}
      <p data-import-status="" className="text-caption text-guide empty:hidden">
        {importStatus}
      </p>

      {characters.length === 0 && result !== undefined && readErrors.length === 0 && (
        <p className="text-body text-ink-muted">No characters yet. Create your first hero.</p>
      )}

      {readErrors.length > 0 && (
        <p className="rounded-control bg-danger-soft px-3 py-2 text-caption" role="alert">
          {readErrors.length} character{readErrors.length > 1 ? 's' : ''} could not be read and{' '}
          {readErrors.length > 1 ? 'are' : 'is'} hidden. The rest are safe to use.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {characters.map((c) => (
          <CharacterCard
            key={c.id}
            c={c}
            vitals={vitals.get(c.id)}
            // Nothing to wait for on a classless character, and nothing
            // coming if the compendium failed to load.
            vitalsDue={
              classesOf(c).length > 0 && (registryStatus === 'loading' || phase === 'working')
            }
            onActions={() => void rowActions(c)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {/* The explicit choice point for a draft left in the wizard: Resume
            goes back to the step it was left on, Discard drops it with an
            undo. The guided wizard behind New character still continues it,
            and says so. */}
        {unfinished !== null && (
          <div className={`${cardClass} flex items-center gap-2`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body-strong">
                Unfinished character: {draftSummary(unfinished.doc)}
              </div>
              <div className="text-caption text-ink-muted">
                Kept in this tab until you create it or close the tab.
              </div>
            </div>
            <Link
              to={unfinished.step !== undefined ? `/create?step=${unfinished.step}` : '/create'}
              state={RESUME_STATE}
              className={`shrink-0 ${buttonClass({ size: 'sm' })}`}
            >
              Resume
            </Link>
            <Button variant="ghost" size="sm" onClick={discardDraft} className="shrink-0">
              Discard
            </Button>
          </div>
        )}
        {hadDraft && (
          <UndoBar
            pending={draftUndo.pending}
            undone={draftUndo.undone}
            onUndo={() => void draftUndo.run()}
            focusRequest={undoFocus}
          />
        )}
        <Button
          variant="brand"
          size="lg"
          block
          aria-haspopup="dialog"
          onClick={() => void newCharacter()}
        >
          <UserPlus size={18} aria-hidden /> New character
        </Button>
      </div>
      {pendingImport !== undefined && (
        <Suspense fallback={null}>
          <CharacterImportPreview
            preview={pendingImport.preview}
            sourceSpellingOf={pendingImport.sourceSpellingOf}
            onImport={() => void confirmImport()}
            onCancel={cancelImport}
          />
        </Suspense>
      )}
      {/* Last, under the ways to make a character, so the characters and New
          character stay above the fold on a phone. */}
      {result !== undefined && <GettingStarted onDismiss={() => heading.current?.focus()} />}
    </main>
  );
}
