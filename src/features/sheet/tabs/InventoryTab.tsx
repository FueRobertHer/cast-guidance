import { Plus, Search, Sparkle, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import {
  applySourcePolicy,
  backToSourcesLabel,
  hiddenSourcesLabel,
  policyAllows,
} from '@/data5e/sourceFilter';
import { sourceName } from '@/data5e/sourceNames';
import type { EquipmentEntry } from '@/engine/types';
import { usePickSourcePolicy } from '@/lib/usePickSourcePolicy';
import { Button, buttonClass } from '@/ui/Button';
import { chipClass } from '@/ui/Chip';
import { EntityInfoSheet } from '@/ui/EntityInfoSheet';
import { OutsideSourcesChip } from '@/ui/OutsideSourcesChip';
import { Sheet } from '@/ui/sheet';
import { listClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import type { CharacterSheetState } from '../useCharacterSheet';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');

/**
 * An offer to show what the source settings hide, or to hide it again: an
 * outlined control in `line-strong`, dashed because it changes the list
 * rather than adding anything.
 */
const OFFER =
  'mb-1 min-h-tap rounded-control border border-line-strong border-dashed px-3 py-2 text-left text-caption text-ink-muted transition-colors duration-120 hover:bg-surface-raised hover:text-ink';

/** A section heading inside a screen, as Settings has them. */
const H2 = 'px-1 text-heading';

/**
 * Where Add item puts focus as it opens (A11Y-003). The sheet's first control
 * is its search box, which suits a keyboard; on a touch screen focusing it
 * pops the on-screen keyboard over the list it filters before anyone asked
 * to type. There the sheet itself takes focus instead, as a screen reader
 * expects, and a tap on the box brings the keyboard up. Exported for tests.
 */
export function focusSheetOnTouch(event: Event): void {
  if (!matchMedia('(pointer: coarse)').matches) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}

export function AddItemDrawer({
  onAdd,
  sources,
}: {
  onAdd: (entry: EquipmentEntry) => void;
  /** The character's own `allowedSources`; a non-empty list replaces the device settings. */
  sources?: readonly string[];
}) {
  const registry = useRegistry();
  const [q, setQ] = useState('');
  const [customName, setCustomName] = useState('');
  const [load, setLoad] = useState<'pending' | 'done' | 'failed'>('pending');
  const [showHiddenSources, setShowHiddenSources] = useState(false);
  const { policy, scope } = usePickSourcePolicy(sources);

  const { results, poolSize, sourceHiddenCount } = useMemo(() => {
    if (registry === null) return { results: [], poolSize: 0, sourceHiddenCount: 0 };
    const all = [...registry.byType('baseitem'), ...registry.byType('item')];
    // `poolSize` stays the unfiltered total: it exists to tell "still
    // downloading" apart from "nothing matched", and hidden books are neither.
    const pool = showHiddenSources ? all : applySourcePolicy(all, policy, sourceOf);
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return { results: [], poolSize: all.length, sourceHiddenCount: 0 };
    const matches = (e: Entity) => nameOf(e).toLowerCase().includes(needle);
    return {
      results: pool.filter(matches).slice(0, 30),
      poolSize: all.length,
      sourceHiddenCount: showHiddenSources
        ? 0
        : all.filter((e) => matches(e) && !policyAllows(policy, sourceOf(e))).length,
    };
  }, [registry, q, policy, showHiddenSources]);

  // Mundane gear ships in the essentials pack, but magic items come from
  // `items-full`, which the background drain fetches later. On a slow phone this
  // can open before those arrive. An empty pool is the honest signal: it means
  // nothing is queryable yet, whatever the download plumbing believes.
  const ready = poolSize > 0;

  const loadItems = () => {
    setLoad('pending');
    ensureTypePacks('item').then(
      () => setLoad('done'),
      () => setLoad('failed'),
    );
  };

  return (
    <Sheet.Root
      onOpenChange={(open) => {
        if (open) loadItems();
      }}
    >
      <Sheet.Trigger asChild>
        <button type="button" className={buttonClass({ variant: 'secondary' })}>
          <Plus size={18} aria-hidden="true" /> Add item
        </button>
      </Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel onOpenAutoFocus={focusSheetOnTouch} className="flex max-h-[80dvh] flex-col">
          <Sheet.Heading>Add item</Sheet.Heading>
          <div className="relative mb-2">
            <Search
              size={20}
              aria-hidden="true"
              className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search items"
              placeholder="Search items…"
              className={`${fieldClass} pl-10.5`}
            />
          </div>
          {/* role=status so the shift from "downloading" to a result count, and
              from a count to "no match", is announced rather than silent. */}
          <div role="status" className="px-1 text-body text-ink-muted empty:hidden">
            {!ready && (
              <div className="flex flex-col items-start gap-1 py-3">
                <p>
                  {load === 'failed'
                    ? 'Could not download the item compendium.'
                    : load === 'done'
                      ? 'The item compendium loaded, but it contains no items.'
                      : 'Downloading the item compendium…'}
                </p>
                {load === 'pending' ? (
                  <p>You can still add a custom item below.</p>
                ) : (
                  <button
                    type="button"
                    onClick={loadItems}
                    className="-mx-2 min-h-tap rounded-control px-2 text-body-strong text-ink underline underline-offset-3 hover:bg-surface-raised"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
            {ready && q.trim().length < 2 && (
              <p className="py-3">Type at least two letters to search {poolSize} items.</p>
            )}
            {ready && q.trim().length >= 2 && results.length === 0 && (
              <p className="py-3">No items match “{q.trim()}”.</p>
            )}
          </div>
          {sourceHiddenCount > 0 && (
            <button type="button" onClick={() => setShowHiddenSources(true)} className={OFFER}>
              {hiddenSourcesLabel(sourceHiddenCount, scope)}
            </button>
          )}
          {showHiddenSources && (
            <button type="button" onClick={() => setShowHiddenSources(false)} className={OFFER}>
              {backToSourcesLabel(scope)}
            </button>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {results.map((e) => (
              <Sheet.Close asChild key={`${nameOf(e)}|${sourceOf(e)}`}>
                <button
                  type="button"
                  onClick={() =>
                    onAdd({
                      id: crypto.randomUUID(),
                      ref: { name: nameOf(e), source: sourceOf(e) },
                      qty: 1,
                      equipped: false,
                      attuned: false,
                    })
                  }
                  className="flex min-h-tap w-full items-center justify-between gap-2 border-line border-b px-1 py-2 text-left text-body transition-colors duration-120 last:border-b-0 hover:bg-surface-raised"
                >
                  <span className="truncate">{nameOf(e)}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {/* Only reachable through "show them anyway". */}
                    {scope === 'character' && !policyAllows(policy, sourceOf(e)) && (
                      <OutsideSourcesChip />
                    )}
                    <span className="text-caption text-ink-muted">{sourceOf(e)}</span>
                  </span>
                </button>
              </Sheet.Close>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2 border-line border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (customName.trim() === '') return;
              onAdd({
                id: crypto.randomUUID(),
                custom: { name: customName.trim() },
                qty: 1,
                equipped: false,
                attuned: false,
              });
              setCustomName('');
            }}
          >
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              aria-label="Custom item name"
              placeholder="Or add a custom item…"
              className={`${fieldClass} min-w-0 flex-1`}
            />
            <Button type="submit" variant="brand">
              Add
            </Button>
          </form>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

/**
 * A quantity step: a 28px `surface-raised` square that shows, inside a 32 by
 * 44 target (A11Y-002), as a pip is. The target's edges space the two apart.
 */
const STEP = 'group inline-flex h-tap w-8 items-center justify-center';
const STEP_FACE =
  'flex size-7 items-center justify-center rounded-control bg-surface-raised text-ink transition-colors duration-120 group-hover:bg-surface-hover';

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  const registry = useRegistry();
  if (sheet === null || doc === null) return <p className="text-body text-ink-muted">Deriving…</p>;

  /**
   * The compendium entry behind a carried item, if there is one. Custom items
   * and refs that no longer resolve (a homebrew file was removed, a data
   * version dropped something) return undefined and stay plain text.
   */
  const resolve = (entry: EquipmentEntry): { entity: Entity; type: string } | undefined => {
    if (entry.custom !== undefined || entry.ref === undefined || registry === null)
      return undefined;
    const source = entry.ref.source || undefined;
    for (const type of ['item', 'baseitem', 'itemGroup'] as const) {
      const entity = registry.get(type, entry.ref.name, source);
      // itemGroup has no header-facts case of its own, and reads as an item.
      if (entity !== undefined) return { entity, type: type === 'itemGroup' ? 'item' : type };
    }
    return undefined;
  };

  // Bundle uids arrive lowercased; show the resolved entity's proper name.
  const displayName = (entry: EquipmentEntry): string => {
    if (entry.custom !== undefined) return entry.custom.name;
    if (entry.ref === undefined) return '?';
    const name = resolve(entry)?.entity.name;
    return typeof name === 'string' ? name : entry.ref.name;
  };

  const attunedCount = doc.equipment.filter((e) => e.attuned).length;

  const equipped = doc.equipment.filter((e) => e.equipped);
  const backpack = doc.equipment.filter((e) => !e.equipped);

  // Each control names the item it acts on: the rows repeat the same glyphs.
  // The toggles keep a stable verb, so aria-pressed alone says the state.
  // At a narrow width the trailing controls wrap under the name as one group
  // rather than squeeze it to a few letters.
  const row = (entry: EquipmentEntry) => (
    <div key={entry.id} className="flex flex-wrap items-center gap-x-2 py-1 pr-1 pl-2.5 text-body">
      <button
        type="button"
        aria-label={`Equip ${displayName(entry)}`}
        aria-pressed={entry.equipped}
        onClick={() =>
          update((d) => {
            const it = d.equipment.find((x) => x.id === entry.id);
            if (it !== undefined) it.equipped = !it.equipped;
          })
        }
        className={`shrink-0 ${chipClass('outline')}`}
      >
        {entry.equipped ? 'equipped' : 'equip'}
      </button>
      <div className="min-w-24 flex-1">
        {(() => {
          const label = `${displayName(entry)}${entry.qty > 1 ? ` ×${entry.qty}` : ''}`;
          const found = resolve(entry);
          // Tapping the name reads the item, the same in-place drawer the
          // pickers and the Play tab use. Nothing to open for a custom item.
          if (found === undefined) return <div className="truncate">{label}</div>;
          return (
            <EntityInfoSheet
              type={found.type}
              entity={found.entity}
              subtitle={sourceName(sourceOf(found.entity))}
              trigger={
                <button
                  type="button"
                  title="What does this do?"
                  className="block min-h-6 w-full truncate text-left underline decoration-line-strong decoration-dotted underline-offset-4 hover:decoration-ink"
                >
                  {label}
                </button>
              }
            />
          );
        })()}
        {entry.custom?.note !== undefined && (
          <div className="truncate text-caption text-ink-muted">{entry.custom.note}</div>
        )}
      </div>
      <span className="ml-auto flex shrink-0 items-center">
        <button
          type="button"
          aria-label={`Attune ${displayName(entry)}`}
          aria-pressed={entry.attuned}
          title="Attune"
          onClick={() =>
            update((d) => {
              const it = d.equipment.find((x) => x.id === entry.id);
              if (it !== undefined) it.attuned = !it.attuned;
            })
          }
          // Attunement is a lasting state, as Inspiration is: `guide` and a
          // filled spark when on, an outline in `ink-muted` when off, so the
          // shape says it as well as the colour.
          className={`inline-flex h-tap w-8 items-center justify-center rounded-control transition-colors duration-120 hover:bg-surface-raised ${
            entry.attuned ? 'text-guide' : 'text-ink-muted'
          }`}
        >
          <Sparkle size={16} aria-hidden="true" fill={entry.attuned ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          aria-label={`Decrease ${displayName(entry)} quantity`}
          onClick={() =>
            update((d) => {
              const it = d.equipment.find((x) => x.id === entry.id);
              if (it !== undefined) it.qty = Math.max(1, it.qty - 1);
            })
          }
          className={STEP}
        >
          <span aria-hidden="true" className={STEP_FACE}>
            −
          </span>
        </button>
        <button
          type="button"
          aria-label={`Increase ${displayName(entry)} quantity`}
          onClick={() =>
            update((d) => {
              const it = d.equipment.find((x) => x.id === entry.id);
              if (it !== undefined) it.qty += 1;
            })
          }
          className={STEP}
        >
          <span aria-hidden="true" className={STEP_FACE}>
            +
          </span>
        </button>
        <button
          type="button"
          aria-label={`Remove ${displayName(entry)}`}
          title="Remove"
          onClick={() =>
            update((d) => void (d.equipment = d.equipment.filter((x) => x.id !== entry.id)))
          }
          className="inline-flex h-tap w-8 items-center justify-center rounded-control text-ink-muted transition-colors duration-120 hover:bg-surface-raised hover:text-danger"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className={`flex items-baseline justify-between gap-2 ${H2}`}>
          Equipped
          {/* Over three is allowed and flagged, in the guide's gold. */}
          <span
            className={`text-caption tabular-nums ${
              attunedCount > 3 ? 'font-semibold text-guide' : 'font-normal text-ink-muted'
            }`}
          >
            attunement {attunedCount}/3
          </span>
        </h2>
        <div className={listClass}>
          {equipped.length === 0 && (
            <p className="px-4 py-3 text-body text-ink-muted">Nothing equipped.</p>
          )}
          {equipped.map(row)}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={H2}>Backpack</h2>
        <div className={listClass}>
          {backpack.length === 0 && (
            <p className="px-4 py-3 text-body text-ink-muted">Backpack is empty.</p>
          )}
          {backpack.map(row)}
        </div>
      </section>

      <AddItemDrawer
        sources={doc.allowedSources}
        onAdd={(entry) => update((d) => void d.equipment.push(entry))}
      />

      <section className="flex flex-col gap-2">
        <h2 className={H2}>Currency</h2>
        <div className="grid grid-cols-5 gap-2">
          {COINS.map((coin) => (
            <label
              key={coin}
              className="flex flex-col items-center gap-1 rounded-control bg-surface px-1 pt-2 pb-1 shadow-card ring-1 ring-line ring-inset"
            >
              <span className="text-ink-muted text-overline uppercase">{coin}</span>
              <input
                inputMode="numeric"
                value={doc.play.currency[coin]}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value || '0', 10);
                  if (!Number.isNaN(n))
                    update((d) => void (d.play.currency[coin] = Math.max(0, n)));
                }}
                className="h-8 w-full rounded-chip bg-transparent text-center font-semibold tabular-nums hover:bg-surface-raised"
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
