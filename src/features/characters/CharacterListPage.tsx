import { useLiveQuery } from 'dexie-react-hooks';
import { Ellipsis, FileUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DATA_TAG } from '@/data5e/config';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useRegistryState } from '@/data5e/hooks';
import { characterRepo, type ImportSummary } from '@/db/characterRepo';
import { homebrewRepo } from '@/db/homebrewRepo';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { downloadJson } from '@/lib/download';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { notify } from '@/stores/notices';
import { askChoice, askConfirm, askText } from '@/ui/dialogs';
import { homebrewForExport } from './homebrewExport';

/** Report a failed character mutation without losing the user's place. */
function notifyFailure(action: string, err: unknown): void {
  notify({
    title: `${action} failed`,
    detail: err instanceof Error ? err.message : String(err),
    tone: 'warn',
  });
}

async function exportCharacter(doc: CharacterDoc): Promise<void> {
  // Embed only the homebrew this character depends on, as a minimal public DTO
  // (no local-only fields) — keeps exports self-contained without shipping all
  // of the user's unrelated homebrew.
  const homebrew = homebrewForExport(doc, await homebrewRepo.enabled());
  const payload = { $format: CHARACTER_EXPORT_FORMAT, character: doc, homebrew };
  downloadJson(doc.name.replaceAll(/[^\w-]+/g, '_') || 'character', payload);
}

function importSummaryMessage(s: ImportSummary): string {
  const parts = [`Imported ${s.name}`];
  if (s.renamed) parts.push('(renamed — id already existed)');
  if (s.homebrewAdded > 0) parts.push(`· ${s.homebrewAdded} homebrew file(s) added`);
  if (s.homebrewSkipped > 0) parts.push(`· ${s.homebrewSkipped} already present`);
  return parts.join(' ');
}

function classSummary(doc: CharacterDoc): string {
  if (doc.classes.length === 0) return 'No class yet';
  // Defensive: a corrupted class entry (missing ref) must not throw while
  // rendering the list — one bad record cannot take down the page (REL-005).
  return doc.classes
    .map((c) => {
      const name = c.ref?.name ?? 'Unknown class';
      const sub = c.subclass?.name !== undefined ? ` · ${c.subclass.name}` : '';
      return `${name} ${c.levels}${sub}`;
    })
    .join(' / ');
}

/**
 * The row's one action control. Square and 44px because it is the only thing on
 * the row a thumb has to hit precisely; the rest of the row is the character.
 */
const ROW_ACTION =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-2 active:text-ink';

/**
 * The pair of ways into a new character, as one string shared by a `<button>`
 * and a `<Link>`. They are meant to read as twins, and twins written out twice
 * drift apart on the next edit; `text-center` is here because a button centres
 * its text by default and an anchor does not, which only shows once a label
 * wraps, exactly the moment nobody is looking.
 */
const CREATE_OPTION =
  'flex flex-col items-center justify-center gap-0.5 rounded-lg bg-surface-2 px-2 py-3 text-center transition-colors hover:bg-surface-3 active:bg-surface-3';

interface Vitals {
  hp: number;
  maxHp: number;
  ac: number;
}

/**
 * The HP/AC line, at one fixed height whether or not the numbers have arrived.
 *
 * They need the whole compendium, which lands a beat after the names do.
 * Rendering nothing until then made every row grow. Reserving bare space
 * stopped the growth but left the values popping into an empty strip, which
 * still reads as a flash. So the line is always the same shape: the same track
 * element sits there the whole time and the numbers keep their footprint as
 * muted placeholders, leaving only the bar's fill and two short strings to
 * arrive, gently.
 */
function VitalsLine({ v }: { v?: Vitals }) {
  const ratio = v === undefined || v.maxHp <= 0 ? 0 : Math.max(0, Math.min(1, v.hp / v.maxHp));
  const color = ratio > 0.5 ? 'bg-emerald-500' : ratio > 0.25 ? 'bg-amber-400' : 'bg-accent';
  return (
    // Nowrap because the line is a fixed 16px: letting "AC 19" fall to a second
    // line at the narrowest widths spills it out of the space held for it.
    <div className="mt-1 flex h-4 items-center gap-2 text-xs whitespace-nowrap text-ink-muted">
      <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
        {v !== undefined && (
          <span
            className={`block h-full motion-safe:animate-fade-in ${color}`}
            style={{ width: `${ratio * 100}%` }}
          />
        )}
      </span>
      {v === undefined ? (
        <>
          <span className="h-2 w-9 rounded-full bg-surface-2" />
          <span className="h-2 w-7 rounded-full bg-surface-2" />
        </>
      ) : (
        <>
          <span className="font-mono motion-safe:animate-fade-in">
            {v.hp}/{v.maxHp}
          </span>
          <span className="motion-safe:animate-fade-in">AC {v.ac}</span>
        </>
      )}
    </div>
  );
}

export function Component() {
  const navigate = useNavigate();
  const { registry, status: registryStatus } = useRegistryState(['essentials']);
  const result = useLiveQuery(() => characterRepo.listSafe(), []);
  const characters = result?.characters ?? [];
  const readErrors = result?.errors ?? [];
  const importInput = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string>();

  // At-a-glance vitals per character (few characters → deriving all is cheap).
  const vitals = useMemo(() => {
    const map = new Map<string, Vitals>();
    if (registry === null) return map;
    const ctx = engineContextFor(registry);
    for (const c of characters) {
      if (c.classes.length === 0) continue;
      try {
        const sheet = deriveSheet(c, ctx);
        map.set(c.id, { hp: c.play.currentHp, maxHp: sheet.maxHp.value, ac: sheet.ac.value });
      } catch {
        // skip a character that can't derive (e.g. missing homebrew)
      }
    }
    return map;
  }, [characters, registry]);

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

  const rename = async (c: CharacterDoc) => {
    const name = await askText({ title: 'Rename hero', initial: c.name });
    if (name === null || name.trim() === '') return;
    try {
      await characterRepo.put({ ...c, name: name.trim(), updatedAt: new Date().toISOString() });
    } catch (err) {
      notifyFailure('Rename', err);
    }
  };

  const remove = async (c: CharacterDoc) => {
    const ok = await askConfirm({
      title: `Delete ${c.name}?`,
      detail: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await characterRepo.delete(c.id);
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
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Characters</h1>
      </header>

      {characters.length === 0 && result !== undefined && readErrors.length === 0 && (
        <p className="text-sm text-ink-muted">No characters yet — create your first hero.</p>
      )}

      {readErrors.length > 0 && (
        <p className="rounded-lg bg-accent-deep px-3 py-2 text-xs" role="alert">
          {readErrors.length} character{readErrors.length > 1 ? 's' : ''} could not be read and{' '}
          {readErrors.length > 1 ? 'are' : 'is'} hidden. The rest are safe to use.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {characters.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-lg bg-surface p-3">
            <Link to={`/c/${c.id}`} className="min-w-0 flex-1">
              <div className="truncate font-semibold">{c.name}</div>
              <div className="truncate text-xs text-ink-muted">
                {classSummary(c)}
                {c.race !== undefined ? ` · ${c.race.name}` : ''}
                {` · ${c.rulesVersion}`}
              </div>
              {/* Nothing to wait for on a classless character, and nothing
                  coming if the compendium failed to load. */}
              {(vitals.get(c.id) !== undefined ||
                (registryStatus === 'loading' && c.classes.length > 0)) && (
                <VitalsLine v={vitals.get(c.id)} />
              )}
            </Link>
            {/* `title` for the mouse, `aria-label` for the screen reader: four
                rows of "More" otherwise announce identically, with nothing to
                say which character each one belongs to. */}
            <button
              type="button"
              title="More"
              aria-label={`Actions for ${c.name}`}
              aria-haspopup="dialog"
              onClick={() => void rowActions(c)}
              className={ROW_ACTION}
            >
              <Ellipsis size={18} />
            </button>
          </div>
        ))}
      </div>

      {/*
       * Two ways to make a character, side by side at one size, because they
       * are the same decision approached differently: pick the door that suits
       * how you like to work. They used to sit on separate rows at roughly
       * triple the size difference, which read as one real option and one
       * afterthought, while Import shared a row with the wizard as though the
       * two were siblings. Importing is not a third way to make a character, it
       * is bringing in one that already exists, so it sits apart and quieter.
       *
       * The heading is what names the outcome. Calling one button "New
       * character" made the other look like it did something else, when both
       * make exactly the same thing, so the shared result is said once above
       * and the buttons are left to say only how they differ. Each still spells
       * it out through `aria-label`, where there is no heading nearby to lean
       * on and "Blank sheet" alone would be a riddle.
       *
       * One treatment across the pair, because there is no default here. The
       * accent on one of them read as a recommendation the app has no basis to
       * make: which door suits you depends on how you like to work, not on
       * which is better. They lift off the page together instead, a step
       * brighter than the roster above and the import row below, which is
       * where the hierarchy on this page actually lives.
       */}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold text-ink-muted">New character</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-label="New character from a blank sheet"
            onClick={() => void createBlank()}
            className={CREATE_OPTION}
          >
            <span className="text-sm font-semibold whitespace-nowrap">Blank sheet</span>
            {/* Short enough to keep its padding at 320px, which is why the
                longer sell lives in the heading and the aria-label. */}
            <span className="text-[11px] whitespace-nowrap text-ink-muted">change anything</span>
          </button>
          <Link
            to="/create"
            aria-label="New character with the guided wizard"
            className={CREATE_OPTION}
          >
            <span className="text-sm font-semibold whitespace-nowrap">Guided wizard</span>
            <span className="text-[11px] whitespace-nowrap text-ink-muted">step by step</span>
          </Link>
        </div>
      </section>
      <button
        type="button"
        onClick={() => importInput.current?.click()}
        className="flex items-center justify-center gap-2 rounded-lg bg-surface px-4 py-2.5 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-2 active:text-ink"
      >
        <FileUp size={15} aria-hidden /> Import from a file
      </button>
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) {
            f.text()
              .then((text) => characterRepo.importFromText(text))
              .then((summary) => setImportStatus(importSummaryMessage(summary)))
              .catch((err: unknown) =>
                setImportStatus(
                  `Import failed: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
          }
          e.target.value = '';
        }}
      />
      {importStatus !== undefined && <p className="text-xs text-amber-300">{importStatus}</p>}
    </main>
  );
}
