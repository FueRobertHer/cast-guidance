import { BookOpen } from 'lucide-react';
import { type ReactNode, useContext, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry } from '@/data5e/hooks';
import type { ChangedEntry, EntityRegistry } from '@/data5e/normalize';
import type { ViewCharacter } from '@/data5e/registryView';
import { sourceName } from '@/data5e/sourceNames';
import { RULE_PACK_TYPE } from '@/engine/castGuidance';
import { headerFacts } from '@/features/library/fmt';
import { RegistryViewContext } from '@/stores/registryViewContext';
import { Badge } from './Badge';
import { Button } from './Button';
import { Sheet, SheetStandIn, useSheetOpenOnMount } from './sheet';

/**
 * The change to the books `entity` is, in the registry a sheet reads: under a
 * character's sheet that is the character's own view (ADR-002, D3), so a
 * character with Changes to the books off gets no record here and the book's
 * entry. Only the changed version answers: the entry below it is the book's.
 */
export function changeIn(
  registry: EntityRegistry | null,
  entity: Entity | undefined,
): ChangedEntry | undefined {
  if (registry === null || entity === undefined) return undefined;
  const record = registry.changeOf(entity);
  return record !== undefined && record.placed === entity && record.base !== entity
    ? record
    : undefined;
}

/**
 * Who gives the version this sheet shows: the top change applied to it. The
 * shared registry lists a pack applied to some characters among the layers
 * without applying it (E3); a character's view keeps only the layers that
 * reach that character, and applies each (E4).
 */
export function changedBy(
  registry: EntityRegistry,
  record: ChangedEntry,
  character?: Pick<ViewCharacter, 'id'>,
): string {
  const applied = record.layers.filter(
    (l) =>
      l.shared ||
      (character !== undefined && l.from.reach?.characters?.includes(character.id) === true),
  );
  const top = applied[applied.length - 1];
  if (top === undefined || top.from.kind === 'changes') return 'Changes to the books';
  const source = top.from.source.toLowerCase();
  const pack = registry
    .byType(RULE_PACK_TYPE)
    .find((p) => String(p.source).toLowerCase() === source);
  return pack === undefined ? 'a rule pack' : `the rule pack ${String(pack.name)}`;
}

/** Whether two versions' text or header facts read the same. */
export const sameWords = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The Changed badge beside a sheet's title. */
export function ChangedBadge() {
  return (
    <Badge tone="outline" className="ml-2 align-middle">
      Changed
    </Badge>
  );
}

/**
 * Whose version a sheet shows, and the one tap to the other (board 11): the
 * table's, which the sheet counts, or the book's (`record.base`, the entry
 * below every change). `same` says the shown text and header facts do not
 * differ, only what the entry does on the sheet.
 */
export function ChangedVersions({
  registry,
  record,
  book,
  same = false,
  onFlip,
}: {
  registry: EntityRegistry;
  record: ChangedEntry;
  book: boolean;
  same?: boolean;
  /** Absent where the sheet shows text its caller wrote, which has no book's version here. */
  onFlip?: () => void;
}) {
  const character = useContext(RegistryViewContext);
  return (
    <div className="mb-3 flex shrink-0 flex-col items-start gap-2">
      <p aria-live="polite" className="rounded-control bg-surface-raised px-3 py-2.5 text-caption">
        {book ? (
          <>
            <strong>The book&apos;s version,</strong> {sourceName(String(record.base.source))}. Your
            table plays the changed one.
          </>
        ) : (
          <>
            <strong>Your table&apos;s version,</strong> from{' '}
            {changedBy(registry, record, character)}. The sheet counts this one.
          </>
        )}
        {same && ' The words are the same: the change is in what it does on the sheet.'}
      </p>
      {onFlip !== undefined && (
        <Button variant="outline" size="sm" onClick={onFlip}>
          <BookOpen size={16} aria-hidden />
          {book ? 'Show your table’s version' : 'Show the book’s version'}
        </Button>
      )}
    </div>
  );
}

/**
 * Full-description bottom sheet for a build option (race, subrace, background,
 * class, subclass, feat). Same in-place popup pattern as attacks/spells on the
 * Play tab, so a player choosing an option can read exactly what it does without
 * leaving the picker. Renders the type's header facts plus the entity's prose;
 * `entriesOverride` supplies text for entities that keep their description
 * elsewhere (a subclass's rules live in its features, not the entity itself).
 */
export interface EntityInfoSheetProps {
  type: string;
  entity: Entity;
  entriesOverride?: unknown;
  subtitle?: string;
  trigger: ReactNode;
}

/**
 * The trigger until the player asks about the option, then the sheet. The
 * pickers and the inventory render one per row, so the unopened case has to
 * stay cheap: `headerFacts` walks the entity, and a `Drawer.Root` brings a
 * `window` scroll listener with it (see {@link SheetStandIn}).
 */
export function EntityInfoSheet(props: EntityInfoSheetProps) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <SheetStandIn trigger={props.trigger} onArm={() => setArmed(true)} />;
  }
  return <EntityInfoSheetContent {...props} />;
}

function EntityInfoSheetContent({
  type,
  entity,
  entriesOverride,
  subtitle,
  trigger,
}: EntityInfoSheetProps) {
  const registry = useRegistry();
  const record = changeIn(registry, entity);
  const [book, setBook] = useState(false);
  // The book's version whole, facts and all, while the player asks for it.
  // Text the caller wrote (a subclass's, from its features) has no book's
  // version here, so that sheet offers none.
  const flips = record !== undefined && entriesOverride === undefined;
  const shown = book && flips ? record.base : entity;
  const facts = headerFacts(type, shown);
  const entries = entriesOverride ?? shown.entries;
  const hasEntries = Array.isArray(entries) && entries.length > 0;

  // Mounted by the press that opens it; see `useSheetOpenOnMount`.
  const [open, setOpen] = useSheetOpenOnMount();
  // Opened again, the sheet shows the version the sheet counts. Reset on
  // opening, not closing, so the closing sheet keeps what it showed.
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setBook(false);
  };

  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Trigger asChild>{trigger}</Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel className="flex max-h-[80dvh] flex-col">
          <Sheet.Heading>
            {String(shown.name ?? '?')}
            {record !== undefined && <ChangedBadge />}
          </Sheet.Heading>
          {subtitle !== undefined && (
            <p className="-mt-2 mb-3 shrink-0 text-caption text-ink-muted">{subtitle}</p>
          )}
          {registry !== null && record !== undefined && (
            <ChangedVersions
              registry={registry}
              record={record}
              book={book}
              same={
                flips &&
                sameWords(record.base.entries, entity.entries) &&
                sameWords(headerFacts(type, record.base), headerFacts(type, entity))
              }
              onFlip={flips ? () => setBook((b) => !b) : undefined}
            />
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {facts.length > 0 && (
              <div className="mb-3 flex flex-col gap-0.5 text-caption">
                {facts.map(([label, value]) => (
                  <div key={label} className="text-ink-muted">
                    <span className="font-semibold text-ink">{label}:</span> {value}
                  </div>
                ))}
              </div>
            )}
            {hasEntries ? (
              <EntriesView entries={entries} />
            ) : (
              // Only worth saying when there is nothing else on screen. Plenty
              // of entries carry no prose because the facts above are the whole
              // story (a battleaxe is its damage and weight), and announcing a
              // missing description over a full stat block reads as a failure.
              facts.length === 0 && (
                <p className="text-ink-muted">No description text in the data for this option.</p>
              )
            )}
          </div>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
