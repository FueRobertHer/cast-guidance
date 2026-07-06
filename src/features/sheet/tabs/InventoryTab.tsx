import { Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router';
import { Drawer } from 'vaul';
import type { Entity } from '@/data5e/copyMod';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import type { EquipmentEntry } from '@/engine/types';
import type { CharacterSheetState } from '../useCharacterSheet';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');

function AddItemDrawer({ onAdd }: { onAdd: (entry: EquipmentEntry) => void }) {
  const registry = useRegistry();
  const [q, setQ] = useState('');
  const [customName, setCustomName] = useState('');

  const results = useMemo(() => {
    if (registry === null || q.trim().length < 2) return [];
    const needle = q.trim().toLowerCase();
    const pool = [...registry.byType('baseitem'), ...registry.byType('item')];
    return pool.filter((e) => nameOf(e).toLowerCase().includes(needle)).slice(0, 30);
  }, [registry, q]);

  return (
    <Drawer.Root
      onOpenChange={(open) => {
        if (open) void ensureTypePacks('item');
      }}
    >
      <Drawer.Trigger asChild>
        <button
          type="button"
          className="flex items-center justify-center gap-2 rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold"
        >
          <Plus size={16} /> Add item
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-2" />
          <Drawer.Title className="mb-2 text-base font-semibold">Add item</Drawer.Title>
          <label className="mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
            <Search size={16} className="shrink-0 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search items…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-muted"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {results.map((e) => (
              <Drawer.Close asChild key={`${nameOf(e)}|${sourceOf(e)}`}>
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
                  className="flex w-full items-center justify-between border-b border-surface-2/40 px-1 py-2.5 text-left text-sm last:border-b-0"
                >
                  <span className="truncate">{nameOf(e)}</span>
                  <span className="text-xs text-ink-muted">{sourceOf(e)}</span>
                </button>
              </Drawer.Close>
            ))}
          </div>
          <form
            className="mt-2 flex gap-1.5 border-t border-surface-2 pt-3"
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
              placeholder="Or add a custom item…"
              className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
            />
            <button
              type="submit"
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
            >
              Add
            </button>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  const registry = useRegistry();
  if (sheet === null || doc === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  // Bundle uids arrive lowercased; show the resolved entity's proper name.
  const displayName = (entry: EquipmentEntry): string => {
    if (entry.custom !== undefined) return entry.custom.name;
    if (entry.ref === undefined) return '?';
    const e =
      registry?.get('item', entry.ref.name, entry.ref.source || undefined) ??
      registry?.get('baseitem', entry.ref.name, entry.ref.source || undefined) ??
      registry?.get('itemGroup', entry.ref.name, entry.ref.source || undefined);
    return typeof e?.name === 'string' ? e.name : entry.ref.name;
  };

  const attunedCount = doc.equipment.filter((e) => e.attuned).length;

  const equipped = doc.equipment.filter((e) => e.equipped);
  const backpack = doc.equipment.filter((e) => !e.equipped);

  const row = (entry: EquipmentEntry) => (
    <div
      key={entry.id}
      className="flex items-center gap-2 border-b border-surface-2/40 px-3 py-2.5 text-sm last:border-b-0"
    >
      <button
        type="button"
        onClick={() =>
          update((d) => {
            const it = d.equipment.find((x) => x.id === entry.id);
            if (it !== undefined) it.equipped = !it.equipped;
          })
        }
        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
          entry.equipped ? 'border-accent text-accent' : 'border-surface-2 text-ink-muted'
        }`}
      >
        {entry.equipped ? 'equipped' : 'equip'}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {displayName(entry)}
          {entry.qty > 1 ? ` ×${entry.qty}` : ''}
        </div>
        {entry.custom?.note !== undefined && (
          <div className="truncate text-xs text-ink-muted">{entry.custom.note}</div>
        )}
      </div>
      <button
        type="button"
        title="Attune"
        onClick={() =>
          update((d) => {
            const it = d.equipment.find((x) => x.id === entry.id);
            if (it !== undefined) it.attuned = !it.attuned;
          })
        }
        className={`shrink-0 text-xs ${entry.attuned ? 'text-amber-300' : 'text-ink-muted/50'}`}
      >
        ✦
      </button>
      <div className="flex shrink-0 items-center gap-0.5 text-xs text-ink-muted">
        <button
          type="button"
          onClick={() =>
            update((d) => {
              const it = d.equipment.find((x) => x.id === entry.id);
              if (it !== undefined) it.qty = Math.max(1, it.qty - 1);
            })
          }
          className="rounded bg-surface-2 px-1.5 py-0.5"
        >
          −
        </button>
        <button
          type="button"
          onClick={() =>
            update((d) => {
              const it = d.equipment.find((x) => x.id === entry.id);
              if (it !== undefined) it.qty += 1;
            })
          }
          className="rounded bg-surface-2 px-1.5 py-0.5"
        >
          +
        </button>
      </div>
      <button
        type="button"
        title="Remove"
        onClick={() =>
          update((d) => void (d.equipment = d.equipment.filter((x) => x.id !== entry.id)))
        }
        className="shrink-0 text-ink-muted hover:text-accent"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <h2 className="flex items-baseline justify-between text-sm font-semibold text-ink-muted">
          Equipped
          <span className={`text-xs ${attunedCount > 3 ? 'text-accent' : ''}`}>
            attunement {attunedCount}/3
          </span>
        </h2>
        <div className="flex flex-col rounded-lg bg-surface">
          {equipped.length === 0 && (
            <p className="px-3 py-2.5 text-sm text-ink-muted">Nothing equipped.</p>
          )}
          {equipped.map(row)}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold text-ink-muted">Backpack</h2>
        <div className="flex flex-col rounded-lg bg-surface">
          {backpack.length === 0 && (
            <p className="px-3 py-2.5 text-sm text-ink-muted">Backpack is empty.</p>
          )}
          {backpack.map(row)}
        </div>
      </section>

      <AddItemDrawer onAdd={(entry) => update((d) => void d.equipment.push(entry))} />

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold text-ink-muted">Currency</h2>
        <div className="grid grid-cols-5 gap-1.5">
          {COINS.map((coin) => (
            <label
              key={coin}
              className="flex flex-col items-center gap-1 rounded-lg bg-surface p-2"
            >
              <span className="text-[10px] font-semibold uppercase text-ink-muted">{coin}</span>
              <input
                inputMode="numeric"
                value={doc.play.currency[coin]}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value || '0', 10);
                  if (!Number.isNaN(n))
                    update((d) => void (d.play.currency[coin] = Math.max(0, n)));
                }}
                className="w-full bg-transparent text-center text-sm font-semibold outline-none"
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
