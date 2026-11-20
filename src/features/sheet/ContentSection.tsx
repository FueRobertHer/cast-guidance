import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { EntityRegistry } from '@/data5e/normalize';
import { readSourcePolicy, type SourcePolicy } from '@/data5e/sourceFilter';
import { characterSourceSwitches, hasHomebrewTitle, sourceName } from '@/data5e/sourceNames';
import { homebrewRepo } from '@/db/homebrewRepo';
import { type PackAppliesTo, RULE_PACK_TYPE } from '@/engine/castGuidance';
import type { CharacterDoc } from '@/engine/types';
import {
  deviceOn,
  isChanges,
  reachesRow,
  switchedTo,
} from '@/features/workshop/collectionSwitches';
import { BOOKS_PATH, type Collection, collectionsOf } from '@/features/workshop/collections';
import type { DocUpdater } from '@/stores/characterSession';
import { Button, buttonClass } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { listClass, listRowClass } from '@/ui/surfaces';

/** Where the Workshop keeps rule packs and table rules (ADR-002, D1). */
export const RULES_PATH = '/workshop/rules';

/**
 * What this character's switches change from this device, in words: the
 * Content row's summary ("Changes to the books off"). Read from the switches
 * alone, so the closed row needs no database read. The reader lets off win.
 */
export function contentSummary(raw: unknown): string {
  const { on, off } = characterSourceSwitches(raw);
  const parts = [
    ...off.map((s) => `${sourceName(s)} off`),
    ...on.map((s) => `${sourceName(s)} on`),
  ];
  if (parts.length === 0) return 'As this device';
  return parts.length > 2
    ? `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`
    : parts.join(', ');
}

const reaches = (to: PackAppliesTo | undefined, id: string) =>
  to?.appDefault === true || (Array.isArray(to?.characters) && to.characters.includes(id));

/**
 * The Build page's Content row (ADR-002 board 11, D3): which collections this
 * character picks from, over this device's choice, with a switch for each.
 * Off for a character, a collection leaves its pickers and what is already on
 * its sheet keeps counting (D3, which board 11's "it leaves her sheet" loses
 * to); Changes to the books off gives its sheet the book's version of what
 * they change (E4). Rule packs reach whom their review applies them to, so
 * they show here with a way to the Rules shelf, not a switch.
 */
export function ContentSection({
  doc,
  update,
  registry,
}: {
  doc: CharacterDoc;
  update: DocUpdater;
  registry: EntityRegistry;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group scroll-mt-4 rounded-card bg-surface shadow-card ring-1 ring-line ring-inset"
    >
      <summary className="flex min-h-tap cursor-pointer flex-wrap items-center justify-between gap-x-2 px-4 py-2.5">
        <span className="text-heading">Content</span>
        <span className="flex min-w-0 items-center gap-2 text-caption text-ink-muted wrap-anywhere">
          {contentSummary(doc.sourceSwitches)}
          <ChevronUp size={16} aria-hidden className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-line border-t p-4">
        <p className="text-caption text-ink-muted">
          What {doc.name}&apos;s pickers offer and {doc.name}&apos;s sheet counts, over this
          device&apos;s choice. Off for {doc.name}, a collection leaves {doc.name}&apos;s pickers;
          what is already on the sheet keeps counting.
        </p>
        {/* Read only while open, as the Sources checklist is. */}
        {open && <ContentBody doc={doc} update={update} registry={registry} />}
      </div>
    </details>
  );
}

function ContentBody({
  doc,
  update,
  registry,
}: {
  doc: CharacterDoc;
  update: DocUpdater;
  registry: EntityRegistry;
}) {
  // The device's choice as read, never `useSourcePolicy`'s default while it
  // loads (every book): a tap then would write the wrong switches (U6).
  const device = useLiveQuery(() => readSourcePolicy(), []);
  const meta = useLiveQuery(() => homebrewRepo.listMetaSafe(), []);
  if (device === undefined || meta === undefined) {
    return <p className="text-body text-ink-muted">Loading…</p>;
  }

  const packs = registry.byType(RULE_PACK_TYPE);
  const packSources = new Set(packs.map((p) => String(p.source).toLowerCase()));
  // A rule pack has no switch per character: its review's Apply to is its reach.
  const isPack = (c: Collection) =>
    c.rows.some(
      (r) => r.pack !== undefined || r.sourceIds.some((s) => packSources.has(s.toLowerCase())),
    );
  // A file is named by its book's full name where the registry has one for
  // its source, as the summary above names it; else as the shelf does.
  const names = new Map(
    meta.files.flatMap((r) => {
      const [s] = r.sourceIds;
      return s !== undefined && hasHomebrewTitle(s) ? [[r.id, sourceName(s)] as const] : [];
    }),
  );
  const all = collectionsOf(meta.files, names).filter((c) => !isPack(c));
  const collections = [
    ...all.filter((c) => c.rows.some(isChanges)),
    ...all.filter((c) => !c.rows.some(isChanges)),
  ];

  const write = (rows: Collection['rows'], on: boolean | 'device') => (d: CharacterDoc) => {
    const next = switchedTo(d, rows, device, on);
    // No switches left is no field, so the character keys as before it had any.
    if (next === undefined) delete d.sourceSwitches;
    else d.sourceSwitches = next;
  };
  const { on, off } = characterSourceSwitches(doc.sourceSwitches);
  const switched = [...on, ...off].map((s) => s.toLowerCase());
  const anySwitched = collections.some((c) =>
    c.rows.some((r) => r.sourceIds.some((s) => switched.includes(s.toLowerCase()))),
  );

  return (
    <>
      <section aria-labelledby="content-collections" className="flex flex-col gap-1.5">
        <h3 id="content-collections" className="text-body-strong">
          Collections
        </h3>
        {collections.length === 0 ? (
          <p className="text-caption text-ink-muted">
            No collections yet. Make or import one in the Workshop.
          </p>
        ) : (
          <ul className={listClass}>
            {collections.map((c) => (
              <CollectionRow
                key={c.id}
                c={c}
                doc={doc}
                device={device}
                // Named for history as the restore preview names it (docDiff):
                // the history's own labels have no word for a switch.
                onPress={(next) =>
                  update(write(c.rows, next), `Collections: ${c.name} ${next ? 'on' : 'off'}`)
                }
              />
            ))}
          </ul>
        )}
        {anySwitched && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              update((d) => {
                for (const c of collections) write(c.rows, 'device')(d);
              }, 'Collections: as this device')
            }
          >
            Every collection as this device
          </Button>
        )}
      </section>

      {packs.length > 0 && (
        <section aria-labelledby="content-packs" className="flex flex-col gap-1.5">
          <h3 id="content-packs" className="text-body-strong">
            Rule packs
          </h3>
          <ul className={listClass}>
            {packs.map((p) => (
              <li
                key={`${String(p.name)}|${String(p.source)}`}
                className={`${listRowClass} flex-wrap`}
              >
                <span className="min-w-0 flex-1 basis-40 break-words">{String(p.name)}</span>
                <span className="shrink-0 text-caption text-ink-muted">
                  {reaches(p.appliesTo as PackAppliesTo | undefined, doc.id)
                    ? `On for ${doc.name}`
                    : `Not for ${doc.name}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-muted">
            A rule pack reaches the characters its review applies it to.
          </p>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Link to={RULES_PATH} className={buttonClass({ variant: 'outline', size: 'sm' })}>
          Rules shelf
        </Link>
        <Link to={BOOKS_PATH} className={buttonClass({ variant: 'outline', size: 'sm' })}>
          The books
        </Link>
      </div>
      <p className="text-caption text-ink-muted">
        Rule packs and table rules are on the Workshop&apos;s Rules shelf. The books says which
        books show on this device; {doc.name}&apos;s own list is under Sources below.
      </p>
    </>
  );
}

function CollectionRow({
  c,
  doc,
  device,
  onPress,
}: {
  c: Collection;
  doc: CharacterDoc;
  device: SourcePolicy;
  onPress: (on: boolean) => void;
}) {
  const on = c.rows.some((r) => reachesRow(doc, r, device));
  const here = c.rows.some((r) => deviceOn(r, device));
  const changes = c.rows.some(isChanges);
  const holds = c.entries === 1 ? '1 entry' : `${c.entries} entries`;
  return (
    <li className="flex flex-col">
      <div className={`${listRowClass} flex-wrap`}>
        <span className="flex min-w-0 flex-1 basis-40 flex-col">
          <span className="break-words text-body-strong">{c.name}</span>
          <span className="text-caption text-ink-muted">
            {holds}. {here ? 'On' : 'Off'} on this device
          </span>
        </span>
        <Chip
          tone="outline"
          pressed={on}
          aria-label={`${c.name} for ${doc.name}`}
          onClick={() => onPress(!on)}
          className="-my-1 shrink-0"
        >
          {on ? 'On' : 'Off'}
        </Chip>
      </div>
      {!on && (
        <p className="px-4 pb-2 text-caption text-guide">
          {changes
            ? `Off: ${doc.name}'s sheet uses the book's version of each entry it changes.`
            : `Off: it leaves ${doc.name}'s pickers. What is already on ${doc.name}'s sheet keeps counting.`}
        </p>
      )}
    </li>
  );
}
