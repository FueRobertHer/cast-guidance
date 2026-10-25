import { ChevronRight, ChevronUp } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useRegistry } from '@/data5e/hooks';
import {
  characterSourceList,
  isPolicyNarrowed,
  SOURCE_PRESETS,
  type SourcePolicy,
  useSourcePolicy,
} from '@/data5e/sourceFilter';
import { SOURCE_GROUP_LABELS, SOURCE_GROUPS, sourceGroup, sourceName } from '@/data5e/sourceNames';
import type { CharacterDoc, DerivedSheet } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { outOfPolicyPicks } from './sourceCues';

const sorted = (list: Iterable<string>) => [...list].sort();
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((s, i) => s === b[i]);

/**
 * The presets as a character list. "Everything" is no restriction here, which
 * is the empty list rather than a list of every book: a table that allows
 * everything should keep allowing books that arrive later.
 */
const PRESETS: ReadonlyArray<{ id: string; label: string; sources: () => string[] }> =
  SOURCE_PRESETS.map((p) => ({
    id: p.id,
    label: p.id === 'all' ? 'No restriction' : p.label,
    sources: () => {
      const policy = p.policy();
      return policy.mode === 'only' ? sorted(policy.sources) : [];
    },
  }));

/**
 * The device settings as a character list. "All except" becomes every book on
 * this device minus the exceptions; a device that hides nothing becomes no
 * restriction, for the same reason as the "Everything" preset.
 */
function fromDevice(device: SourcePolicy, onDevice: readonly string[]): string[] {
  if (!isPolicyNarrowed(device)) return [];
  if (device.mode === 'only') return sorted(device.sources);
  return sorted(onDevice.filter((s) => !device.except.includes(s)));
}

/**
 * One character's own book list, on its Build page: the books its table
 * allows. A non-empty list replaces this device's source settings in this
 * character's pickers; it never removes a pick, so anything already on the
 * character from another book is named here and left alone.
 */
export function CharacterSourcesSection({
  doc,
  sheet,
  update,
}: {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  update: DocUpdater;
}) {
  const [open, setOpen] = useState(false);
  const list = useMemo(() => sorted(characterSourceList(doc.allowedSources)), [doc.allowedSources]);
  const outside = useMemo(
    () => outOfPolicyPicks(doc, sheet.resolvedChoices),
    [doc, sheet.resolvedChoices],
  );
  const write = (next: string[]) => {
    if (sameList(next, list)) return;
    update((d) => {
      d.allowedSources = next;
    });
  };
  const active = PRESETS.find((p) => sameList(p.sources(), list));

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group scroll-mt-4 rounded-lg bg-surface"
    >
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5">
        <span className="text-sm font-semibold">Sources</span>
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          {list.length === 0
            ? 'No restriction'
            : `${list.length} book${list.length === 1 ? '' : 's'}`}
          <ChevronUp size={14} className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-surface-2/40 p-3">
        <p className="text-xs text-ink-muted">
          The books this character&apos;s table allows. With a list here, this character&apos;s
          pickers show only these books instead of this device&apos;s source settings. Nothing
          already on the character is removed.
        </p>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Source presets</legend>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={active?.id === p.id}
              onClick={() => write(p.sources())}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                active?.id === p.id
                  ? 'border-accent bg-accent-deep/40'
                  : 'border-surface-2 text-ink-muted hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </fieldset>
        {list.length > 0 && (
          <p className="text-xs text-ink-muted">
            A list is fixed: books added later and homebrew imported afterwards are not on it until
            you add them.
          </p>
        )}
        {outside.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-surface-2 p-2.5 text-xs">
            <span className="font-semibold text-ink-muted">
              Already on this character from books outside its sources ({outside.length})
            </span>
            <p>{outside.map((p) => `${p.label} (${sourceName(p.source)})`).join(', ')}.</p>
            <p className="text-ink-muted">These stay. The list only narrows what you pick next.</p>
          </div>
        )}
        {/* The full checklist only renders while the section is open: it can
            run to a couple of hundred books, and it needs the registry. */}
        {open && <SourceChecklist list={list} onChange={write} />}
      </div>
    </details>
  );
}

interface Row {
  source: string;
  name: string;
  onDevice: boolean;
}

function SourceChecklist({
  list,
  onChange,
}: {
  list: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const registry = useRegistry();
  const device = useSourcePolicy();
  const lastHintId = useId();
  const onDevice = useMemo(() => sorted(registry?.sourceCounts().keys() ?? []), [registry]);

  const rows: Row[] = useMemo(() => {
    const here = new Set(onDevice);
    return sorted(new Set([...onDevice, ...list]))
      .map((source) => ({ source, name: sourceName(source), onDevice: here.has(source) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [onDevice, list]);

  const restricted = list.length > 0;
  const isOn = (source: string) => !restricted || list.includes(source);

  const toggle = (source: string, enabled: boolean) => {
    // From no restriction, unticking one book means "every book here but
    // this one", written out as a list.
    const base = restricted ? list : onDevice;
    const next = new Set(base);
    if (enabled) next.add(source);
    else next.delete(source);
    onChange(sorted(next));
  };

  const fromDeviceList = fromDevice(device, onDevice);
  const missing = rows.filter((r) => !r.onDevice);

  const checkbox = (r: Row) => {
    // Unticking the only book would leave an empty list, which means no
    // restriction at all: the opposite of what the tap asked for.
    const last = restricted && list.length === 1 && list[0] === r.source;
    return (
      <label key={r.source} className="flex items-center gap-2.5 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={isOn(r.source)}
          disabled={last}
          aria-describedby={last ? lastHintId : undefined}
          onChange={(e) => toggle(r.source, e.target.checked)}
          className="size-4 shrink-0 accent-accent"
        />
        <span className={`min-w-0 flex-1 truncate ${isOn(r.source) ? '' : 'text-ink-muted'}`}>
          {r.name}
        </span>
        {!r.onDevice && (
          <span className="shrink-0 text-[10px] text-ink-muted">Not on this device</span>
        )}
        <span className="shrink-0 font-mono text-[10px] uppercase text-ink-muted">{r.source}</span>
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onChange(fromDeviceList)}
        disabled={sameList(fromDeviceList, list)}
        className="self-start rounded-lg border border-surface-2 px-3 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
      >
        Copy this device&apos;s settings
      </button>
      {restricted && list.length === 1 && (
        <p id={lastHintId} className="text-xs text-ink-muted">
          A list needs at least one book. Choose No restriction to clear it.
        </p>
      )}
      {rows.length === 0 && (
        <p className="text-sm text-ink-muted">Waiting for game data to download.</p>
      )}
      {missing.length > 0 && (
        <div className="flex flex-col rounded-lg bg-surface-2/40">{missing.map(checkbox)}</div>
      )}
      {SOURCE_GROUPS.map((group) => {
        const inGroup = rows.filter((r) => r.onDevice && sourceGroup(r.source) === group);
        if (inGroup.length === 0) return null;
        const on = inGroup.filter((r) => isOn(r.source)).length;
        return (
          <details key={group} open={group === 'core'} className="group/books">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-surface-2/40 px-3 py-2 text-sm font-semibold">
              <ChevronRight
                aria-hidden
                size={14}
                className="shrink-0 text-ink-muted transition-transform group-open/books:rotate-90"
              />
              <span className="min-w-0 flex-1 truncate">{SOURCE_GROUP_LABELS[group]}</span>
              <span className="shrink-0 text-xs font-normal text-ink-muted">
                {on}/{inGroup.length}
              </span>
            </summary>
            <div className="mt-1 flex flex-col">{inGroup.map(checkbox)}</div>
          </details>
        );
      })}
    </div>
  );
}
