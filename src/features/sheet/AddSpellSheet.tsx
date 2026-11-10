import { ArrowLeft, ChevronRight, Info, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { useRegistry, useTypePacks } from '@/data5e/hooks';
import { filterByRulesVersion } from '@/data5e/rulesVersion';
import {
  applySourcePolicy,
  backToSourcesLabel,
  hiddenSourcesLabel,
  policyAllows,
} from '@/data5e/sourceFilter';
import { addedSpellPoolKey, addedSpellsOf } from '@/engine/effects/addedSpells';
import type { Ability, AddedSpell, CharacterDoc, DerivedSheet } from '@/engine/types';
import { signed } from '@/lib/signed';
import { usePickSourcePolicy } from '@/lib/usePickSourcePolicy';
import type { DocUpdater } from '@/stores/characterSession';
import { Badge } from '@/ui/Badge';
import { Button, buttonClass } from '@/ui/Button';
import { OutsideSourcesChip } from '@/ui/OutsideSourcesChip';
import { PackProblem } from '@/ui/PackProblem';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { focusSheetOnTouch, Sheet } from '@/ui/sheet';
import { fieldClass } from '@/ui/TextField';
import { ordinal } from './castResources';
import { spellMeta } from './spellMeta';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');
const lower = (s: string) => s.toLowerCase();

/** The abilities a spell can be cast with, as the table usually picks one. */
const CASTING: readonly Ability[] = ['int', 'wis', 'cha'];

const USES = [
  { value: 'long', label: 'Long rest', name: 'Once per long rest' },
  { value: 'short', label: 'Short rest', name: 'Once per short rest' },
  { value: 'will', label: 'At will' },
] as const satisfies ReadonlyArray<{ value: AddedSpell['uses']; label: string; name?: string }>;

/** As the dice tray's offers: dashed, since it changes the list rather than adding to it. */
const OFFER =
  'mb-1 min-h-tap rounded-control border border-line-strong border-dashed px-3 py-2 text-left text-caption text-ink-muted transition-colors duration-120 hover:bg-surface-raised hover:text-ink';

/** Every spell this character has already, by name, so the list offers only new ones. */
export function spellsOnSheet(doc: CharacterDoc, sheet: DerivedSheet): Set<string> {
  const names = new Set<string>();
  for (const state of Object.values(doc.spellcasting)) {
    for (const ref of [...state.known, ...state.prepared]) names.add(lower(ref.name));
  }
  for (const g of sheet.grantedSpells) names.add(lower(g.name));
  for (const a of addedSpellsOf(doc)) names.add(lower(a.spell.name));
  return names;
}

/** Takes an added spell off the sheet, with its pool's uses. */
/**
 * The stored list as it is. Adding and removing leave alone what this build
 * cannot read (an entry a newer one wrote), for the build that can.
 */
function storedAddedSpells(doc: CharacterDoc): unknown[] {
  return Array.isArray(doc.addedSpells) ? doc.addedSpells : [];
}

const storedName = (entry: unknown): string | undefined => {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const spell: unknown = (entry as { spell?: unknown }).spell;
  if (typeof spell !== 'object' || spell === null) return undefined;
  const name: unknown = (spell as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
};

export function removeAddedSpell(doc: CharacterDoc, name: string): void {
  const rest = storedAddedSpells(doc).filter(
    (a) => lower(storedName(a) ?? '') !== lower(name),
  ) as AddedSpell[];
  if (rest.length === 0) delete doc.addedSpells;
  else doc.addedSpells = rest;
  const key = addedSpellPoolKey(name);
  doc.play.resources = doc.play.resources.filter((r) => r.key !== key);
}

/** The rules sheet's way to take an added spell off; History keeps the version before. */
export function RemoveAddedSpell({ name, update }: { name: string; update: DocUpdater }) {
  return (
    <Sheet.Close asChild>
      <Button
        variant="outline"
        block
        onClick={() => update((d) => removeAddedSpell(d, name), `Removed ${name}`)}
      >
        <Trash2 size={18} aria-hidden="true" /> Remove {name}
      </Button>
    </Sheet.Close>
  );
}

/** The ability an added spell starts on: the character's own casting ability, else its best. */
function startingAbility(sheet: DerivedSheet): Ability {
  const own = sheet.spellcasting[0]?.ability;
  if (own !== undefined && CASTING.includes(own)) return own;
  return CASTING.reduce((best, a) =>
    sheet.abilities[a].mod > sheet.abilities[best].mod ? a : best,
  );
}

function usesHint(uses: AddedSpell['uses'], level: number): string {
  const at = `cast at ${ordinal(level)} level with no slot`;
  if (uses === 'long') return `Once per long rest, ${at}.`;
  if (uses === 'short') return `Once per short or long rest, ${at}.`;
  return `As often as you like, ${at}. Your table's call.`;
}

/**
 * Adds a spell nothing in the build grants (rolls and casting plan, phase 6):
 * a gift or a curse from the DM, on any character. Search every spell the
 * character's sources allow, pick one, then choose the ability it casts with
 * and how often. The sheet keeps it apart from the class's own and marks it
 * "Outside your class".
 */
export function AddSpellSheet({
  doc,
  sheet,
  update,
}: {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  update: DocUpdater;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <Sheet.Trigger asChild>
        <button type="button" className={buttonClass({ variant: 'outline', block: true })}>
          <Plus size={18} aria-hidden="true" /> Add a spell
        </button>
      </Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel onOpenAutoFocus={focusSheetOnTouch} className="flex max-h-[85dvh] flex-col">
          {open && (
            <AddSpellPanel doc={doc} sheet={sheet} update={update} done={() => setOpen(false)} />
          )}
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

function AddSpellPanel({
  doc,
  sheet,
  update,
  done,
}: {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  update: DocUpdater;
  done: () => void;
}) {
  const registry = useRegistry();
  const packs = useTypePacks('spell');
  const { policy, scope } = usePickSourcePolicy(doc.allowedSources);
  const [q, setQ] = useState('');
  const [showHiddenSources, setShowHiddenSources] = useState(false);
  const [picked, setPicked] = useState<Entity | null>(null);

  const { results, poolSize, searchable, sourceHiddenCount } = useMemo(() => {
    if (registry === null) {
      return { results: [], poolSize: 0, searchable: 0, sourceHiddenCount: 0 };
    }
    const taken = spellsOnSheet(doc, sheet);
    const all = filterByRulesVersion([...registry.byType('spell')], doc.rulesVersion).filter(
      (e) => !taken.has(lower(nameOf(e))),
    );
    const pool = showHiddenSources ? all : applySourcePolicy(all, policy, sourceOf);
    const needle = q.trim().toLowerCase();
    // `poolSize` tells "still downloading" from "nothing matched"; `searchable`
    // is what the search can find, without the books the sources hide.
    if (needle.length < 2) {
      return { results: [], poolSize: all.length, searchable: pool.length, sourceHiddenCount: 0 };
    }
    const matches = (e: Entity) => lower(nameOf(e)).includes(needle);
    return {
      results: pool
        .filter(matches)
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
        .slice(0, 30),
      poolSize: all.length,
      searchable: pool.length,
      sourceHiddenCount: showHiddenSources
        ? 0
        : all.filter((e) => matches(e) && !policyAllows(policy, sourceOf(e))).length,
    };
  }, [registry, doc, sheet, q, policy, showHiddenSources]);

  if (picked !== null) {
    return (
      <SpellSettings
        doc={doc}
        sheet={sheet}
        spell={picked}
        back={() => setPicked(null)}
        add={(added) => {
          update((d) => {
            d.addedSpells = [...(storedAddedSpells(d) as AddedSpell[]), added];
          }, `Added ${added.spell.name}`);
          done();
        }}
      />
    );
  }

  const ready = poolSize > 0;
  return (
    <>
      <Sheet.Heading>Add a spell</Sheet.Heading>
      <PackProblem packs={packs} what="the spell list" />
      <div className="relative mb-2">
        <Search
          size={20}
          aria-hidden="true"
          className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search every spell"
          placeholder="Search every spell"
          className={`${fieldClass} pl-10.5`}
        />
      </div>
      {/* role=status so "downloading", a count and "no match" are announced. */}
      <div role="status" className="px-1 text-body text-ink-muted empty:hidden">
        {!ready && packs.status === 'loading' && <p className="py-3">Downloading the spells…</p>}
        {ready && q.trim().length < 2 && (
          <p className="py-3">Type at least two letters to search {searchable} spells.</p>
        )}
        {ready && q.trim().length >= 2 && results.length === 0 && (
          <p className="py-3">No spells match “{q.trim()}”.</p>
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
          <button
            key={`${nameOf(e)}|${sourceOf(e)}`}
            type="button"
            onClick={() => setPicked(e)}
            className="flex min-h-tap w-full items-center justify-between gap-2 border-line border-b px-1 py-2 text-left transition-colors duration-120 last:border-b-0 hover:bg-surface-raised"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-body-strong">{nameOf(e)}</span>
              <span className="text-caption text-ink-muted">
                {spellMeta(e, { withLevel: true })}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {scope === 'character' && !policyAllows(policy, sourceOf(e)) && (
                <OutsideSourcesChip />
              )}
              <span className="text-caption text-ink-muted">{sourceOf(e)}</span>
              <ChevronRight size={16} aria-hidden="true" className="text-ink-muted" />
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function SpellSettings({
  doc,
  sheet,
  spell,
  back,
  add,
}: {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  spell: Entity;
  back: () => void;
  add: (added: AddedSpell) => void;
}) {
  const [ability, setAbility] = useState<Ability>(() => startingAbility(sheet));
  const [uses, setUses] = useState<AddedSpell['uses']>('long');
  const name = nameOf(spell);
  const level = typeof spell.level === 'number' ? spell.level : 1;
  const cantrip = level === 0;
  const modifier = sheet.profBonus.value + sheet.abilities[ability].mod;
  const who = doc.name.trim() === '' ? 'This character' : doc.name.trim();
  return (
    <>
      <button
        type="button"
        onClick={back}
        className="-mt-1 mb-1 inline-flex min-h-tap items-center gap-1.5 self-start rounded-control pr-2 text-body text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={18} aria-hidden="true" /> Back to the list
      </button>
      <Sheet.Heading>{name}</Sheet.Heading>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-1">
        <p className="text-caption text-ink-muted">{spellMeta(spell, { withLevel: true })}</p>
        <div className="flex flex-col gap-1.5">
          <span className="text-label">Casts with</span>
          <SegmentedControl<Ability>
            label="Spellcasting ability"
            options={CASTING.map((a) => ({
              value: a,
              label: `${a.toUpperCase()} ${signed(sheet.abilities[a].mod)}`,
            }))}
            value={ability}
            onChange={setAbility}
            block
          />
          <span className="flex flex-wrap gap-1.5">
            <Badge tone="arcane">Spell attack {signed(modifier)}</Badge>
            <Badge tone="arcane">Save DC {8 + modifier}</Badge>
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-label">How often</span>
          {cantrip ? (
            <p className="text-caption text-ink-muted">
              A cantrip is at will, and its damage grows with your level as any cantrip&apos;s does.
            </p>
          ) : (
            <>
              <SegmentedControl<AddedSpell['uses']>
                label="How often"
                options={USES}
                value={uses}
                onChange={setUses}
                block
              />
              <p className="text-caption text-ink-muted">{usesHint(uses, level)}</p>
            </>
          )}
        </div>
        <p className="flex items-start gap-2 rounded-control bg-guide-soft px-3 py-2 text-caption text-ink">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-guide" />
          <span>
            {who}&apos;s class and feats don&apos;t give this spell. It is your table&apos;s call:
            the sheet keeps it and marks it Outside your class.
          </span>
        </p>
      </div>
      <Button
        variant="brand"
        size="lg"
        block
        className="mt-3"
        onClick={() =>
          add({
            spell: { name, source: sourceOf(spell) },
            ability,
            uses: cantrip ? 'will' : uses,
          })
        }
      >
        Add {name}
      </Button>
    </>
  );
}
