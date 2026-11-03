import { AlertTriangle, CircleAlert, Plus, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry } from '@/data5e/hooks';
import { pickForVersion } from '@/data5e/rulesVersion';
import type { CharacterDoc } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { Chip, chipClass } from '@/ui/Chip';
import { Sheet } from '@/ui/sheet';
import { CONDITIONS, conditionEffect } from './conditionEffects';
import { ExhaustionStepper } from './ExhaustionStepper';
import { exhaustionLevel, setExhaustionLevel } from './exhaustion';

type Condition = CharacterDoc['play']['conditions'][number];

/** A chip's words: "Poisoned", and exhaustion with its level, "Exhausted 2". */
export function conditionLabel(c: Condition): { name: string; level?: number } {
  if (c.id === 'Exhaustion') return { name: 'Exhausted', level: c.level };
  return { name: c.id, level: c.level };
}

/** Where focus lands when nothing nearer is left: the sheet's title, which takes it. */
const sheetTitle = () => document.getElementById('sheet-title');

/**
 * The condition strip (DS "Conditions"): the active conditions, in sight on
 * every sheet tab, directly under the header and sticky with it.
 *
 * Each is a `surface-raised` chip: its name opens a sheet with what it does
 * (a line on the rolls it changes, then its rules text in the character's
 * edition, and Exhaustion's stepper), and its x removes it. "+ Condition"
 * opens the picker, which holds every condition and the exhaustion stepper.
 * The row scrolls sideways when it overflows. With nothing active it is gone,
 * except on Play (`addable`), where the add chip stays.
 *
 * Both sheets stay mounted here rather than in a chip, so a chip that goes
 * away (its condition removed in the picker, or Exhaustion stepped down to 0
 * in its own sheet) does not take an open sheet with it. Each puts focus back
 * where it was opened from, or the nearest thing still there.
 */
export function ConditionStrip({
  doc,
  update,
  addable,
}: {
  doc: CharacterDoc;
  update: DocUpdater;
  addable: boolean;
}) {
  const conditions = doc.play.conditions;
  const edition = doc.rulesVersion;
  const registry = useRegistry();
  const list = useRef<HTMLUListElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const names = useRef(new Map<string, HTMLButtonElement>());
  // The condition whose sheet is open, kept while it closes.
  const [shown, setShown] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // A removed chip's place: focus goes to the chip now there, the one before
  // it if it was the last, the add chip if none is left, then the title.
  const refocus = useRef<number | null>(null);

  useLayoutEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const next =
      list.current?.querySelectorAll<HTMLButtonElement>('[data-remove]')[
        Math.min(at, conditions.length - 1)
      ];
    (next ?? add.current ?? sheetTitle())?.focus();
  }, [conditions]);

  const toggle = (id: string) =>
    update((d) => {
      const idx = d.play.conditions.findIndex((x) => x.id === id);
      if (idx === -1) d.play.conditions.push({ id });
      else d.play.conditions.splice(idx, 1);
    });
  const remove = (id: string, index: number) => {
    refocus.current = index;
    update((d) => {
      d.play.conditions = d.play.conditions.filter((x) => x.id !== id);
    });
  };
  const setExhaustion = (level: number) =>
    update((d) => setExhaustionLevel(d.play.conditions, level));
  const applyDeath = () => {
    update((d) => {
      d.play.hpInitialized = true; // deliberate 0 HP must stick (no auto-fill)
      d.play.currentHp = 0;
      d.play.tempHp = 0;
      d.play.concentratingOn = undefined;
    });
    // The 0 HP it sets is on the page behind the sheet, so close it to show
    // what was done rather than leave the button looking unpressed.
    setInfoOpen(false);
    setPickerOpen(false);
  };

  // Condition/status rules text for the character's edition: Exhaustion in
  // particular reads very differently between 2014 and 2024.
  const rules = (id: string): unknown => {
    if (registry === null) return undefined;
    const cands = [...registry.byType('condition'), ...registry.byType('status')].filter(
      (e) => String(e.name).toLowerCase() === id.toLowerCase(),
    );
    return pickForVersion(cands, edition)?.entries;
  };

  const exhaustion = (
    <ExhaustionStepper
      level={exhaustionLevel(conditions)}
      edition={edition}
      onSet={setExhaustion}
      onDeath={applyDeath}
    />
  );
  const effect = shown === null ? undefined : conditionEffect(shown, edition);
  const entries = shown === null ? undefined : rules(shown);

  return (
    <>
      {(conditions.length > 0 || addable) && (
        // Padded so the chips' 44px targets, wider than the 32px pills, fit
        // inside the scrolling row instead of being clipped by it. The scroll
        // padding does the same for a chip scrolled to (by focus, say): it
        // stops clear of the edge, not flush with it and a fraction cut off.
        <div className="flex basis-full scroll-px-3 items-center gap-2 overflow-x-auto px-3 py-1.5 [scrollbar-width:none]">
          {conditions.length > 0 && (
            <ul
              ref={list}
              aria-label="Active conditions"
              className="flex shrink-0 items-center gap-2"
            >
              {conditions.map((c, i) => {
                const { name, level } = conditionLabel(c);
                return (
                  <li
                    key={c.id}
                    className="flex h-8 shrink-0 items-center rounded-full bg-surface-raised"
                  >
                    <button
                      type="button"
                      ref={(el) => {
                        if (el === null) names.current.delete(c.id);
                        else names.current.set(c.id, el);
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={infoOpen && shown === c.id}
                      onClick={() => {
                        setShown(c.id);
                        setInfoOpen(true);
                      }}
                      className="-my-1.5 flex min-h-tap items-center gap-1.5 whitespace-nowrap rounded-l-full pl-3 text-ink text-label underline-offset-2 [--tap-inset:0.375rem] hover:underline"
                    >
                      <CircleAlert size={16} aria-hidden="true" className="shrink-0" />
                      {/* One run of text, so its name has the space: "Exhausted 2". */}
                      <span>
                        {name}
                        {level !== undefined && (
                          <>
                            {' '}
                            <span className="font-normal text-ink-muted tabular-nums">{level}</span>
                          </>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-remove=""
                      aria-label={`Remove ${c.id}`}
                      onClick={() => remove(c.id, i)}
                      className="tap -my-1.5 -mr-1.5 rounded-full text-ink-muted [--tap-inset:0.625rem] hover:text-ink"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            ref={add}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen(true)}
            className={`${chipClass('outline')} -my-1.5 shrink-0 px-3`}
          >
            <Plus size={16} aria-hidden="true" />
            Condition
          </button>
        </div>
      )}

      <Sheet.Root open={infoOpen} onOpenChange={setInfoOpen}>
        <Sheet.Portal>
          <Sheet.Scrim />
          <Sheet.Panel
            aria-describedby={undefined}
            className="flex max-h-[80dvh] flex-col"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const name = shown === null ? undefined : names.current.get(shown);
              (name?.isConnected ? name : (add.current ?? sheetTitle()))?.focus();
            }}
          >
            <Sheet.Heading>{shown}</Sheet.Heading>
            <div className="min-h-0 flex-1 overflow-y-auto text-body">
              {shown === 'Exhaustion' ? (
                <div className="mb-3">{exhaustion}</div>
              ) : (
                effect !== undefined && (
                  <p className="mb-3 flex gap-1 text-caption text-guide">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {effect}
                  </p>
                )
              )}
              {entries !== undefined && <EntriesView entries={entries} />}
            </div>
          </Sheet.Panel>
        </Sheet.Portal>
      </Sheet.Root>

      <Sheet.Root open={pickerOpen} onOpenChange={setPickerOpen}>
        <Sheet.Portal>
          <Sheet.Scrim />
          <Sheet.Panel
            aria-describedby={undefined}
            className="flex max-h-[85dvh] flex-col"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              (add.current ?? sheetTitle())?.focus();
            }}
          >
            <Sheet.Heading>Conditions</Sheet.Heading>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Chips pad themselves to 44px with a 6px clear border, so the
                  row needs no gap of its own. */}
              <div className="-mx-1.5 flex flex-wrap">
                {CONDITIONS.map((c) => (
                  <Chip
                    key={c}
                    pressed={conditions.some((x) => x.id === c)}
                    onClick={() => toggle(c)}
                  >
                    {c}
                  </Chip>
                ))}
              </div>
              <div className="mt-2 border-line border-t pt-3">{exhaustion}</div>
            </div>
          </Sheet.Panel>
        </Sheet.Portal>
      </Sheet.Root>
    </>
  );
}
