import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry, useTypePacks } from '@/data5e/hooks';
import { pickForVersion, type RulesVersion } from '@/data5e/rulesVersion';
import { headerFacts } from '@/features/library/fmt';
import { useDbLifecycle } from '@/stores/dbLifecycle';
import { PackProblem } from '@/ui/PackProblem';
import { Sheet, SheetStandIn, useSheetOpenOnMount } from '@/ui/sheet';

/**
 * Tap-to-explain bottom sheet for a spell — the same in-place rules popup that
 * weapons and actions use, instead of a link to the library. The lookup is
 * deliberately tolerant: granted/innate spells often carry a blank or wrong
 * source (e.g. "dancing lights" with no source, which broke the old link), so
 * we fall back to a name-only match and load the spell packs lazily on open.
 */
export interface SpellInfoSheetProps {
  name: string;
  source?: string;
  /** Character's rules version — picks the right printing when source misses. */
  version?: RulesVersion;
  subtitle?: string;
  trigger: ReactNode;
  /** Under the rules, outside their scroll: what the player can do with this spell here. */
  footer?: ReactNode;
}

/** Opening focus on the sheet itself, as a screen reader expects of a dialog. */
function focusPanel(event: Event): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}

/**
 * The trigger until the player asks for the spell, then the sheet.
 *
 * The Play tab renders one of these per spell row, so everything below the
 * split is per-row cost on a screen that may list hundreds: a `Drawer.Root`
 * and its `window` scroll listener, a Radix dialog context, a registry
 * subscription, and a lookup that scans every spell when the row's source does
 * not match. None of it is worth paying for a row nobody taps.
 */
export function SpellInfoSheet(props: SpellInfoSheetProps) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <SheetStandIn trigger={props.trigger} onArm={() => setArmed(true)} />;
  }
  return <SpellInfoSheetContent {...props} />;
}

function SpellInfoSheetContent({
  name,
  source,
  version,
  subtitle,
  trigger,
  footer,
}: SpellInfoSheetProps) {
  const registry = useRegistry();
  // Mounted by the press that opens it; see `useSheetOpenOnMount`.
  const [open, setOpen] = useSheetOpenOnMount();
  // Not gated on `open`: this component only mounts on the press that opens
  // it, so the download is still lazy, and `open` starts false for a frame
  // (see `useSheetOpenOnMount`). Gated, the first open render saw a settled
  // hook and said "Couldn't find rules text" before the download had started.
  // The bare `void` this replaces left "Loading spell…" up for good when the
  // download failed (#106).
  const packs = useTypePacks('spell');
  const messageId = useId();
  // Opened again after a failure, try again. Closing the sheet does not
  // unmount this component, so the failure is kept, but it does unmount the
  // panel, the part that retries on reconnect. Without this, a sheet closed
  // offline and reopened online would still say the device is offline. Not
  // on the first opening, which is the download itself however quickly it
  // failed, and not with the database closed, where no retry can work.
  const dbOpen = useDbLifecycle((s) => s.state === 'open');
  const openedBefore = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only an opening asks
  useEffect(() => {
    if (!open) return;
    if (openedBefore.current && dbOpen && packs.status === 'error') packs.retry();
    openedBefore.current = true;
  }, [open]);

  const spell = useMemo((): Entity | undefined => {
    if (registry === null) return undefined;
    const bySource =
      source !== undefined && source !== '' ? registry.get('spell', name, source) : undefined;
    if (bySource !== undefined) return bySource;
    // Blank/wrong source — pick the printing for the character's rules version.
    const cands = registry
      .byType('spell')
      .filter((e) => String(e.name).toLowerCase() === name.toLowerCase());
    return version !== undefined ? pickForVersion(cands, version) : cands[0];
  }, [registry, name, source, version]);

  const facts = spell !== undefined ? headerFacts('spell', spell) : [];
  const higher = spell?.entriesHigherLevel;

  return (
    <Sheet.Root open={open} onOpenChange={setOpen}>
      <Sheet.Trigger asChild>{trigger}</Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel
          // With no spell to show, the line saying why is the sheet's
          // description: focus lands on Retry or the sheet itself, and the
          // line would otherwise go unread.
          aria-describedby={spell === undefined ? messageId : undefined}
          // The sheet is for reading. A footer's control (Remove) is not where
          // focus should land on opening, where a stray Enter would press it.
          onOpenAutoFocus={footer === undefined ? undefined : focusPanel}
          className="flex max-h-[80dvh] flex-col"
        >
          <Sheet.Heading aside={subtitle}>
            <span className="capitalize">{spell !== undefined ? String(spell.name) : name}</span>
          </Sheet.Heading>
          <div className="min-h-0 flex-1 overflow-y-auto text-body">
            {spell === undefined ? (
              packs.status === 'error' ? (
                // Inside the modal the shell's banner is hidden, so this is
                // the one alert about the failure (docs/a11y-audit.md).
                <PackProblem
                  packs={packs}
                  what="this spell's description"
                  alert="always"
                  messageId={messageId}
                />
              ) : (
                <p id={messageId} className="text-ink-muted">
                  {packs.status === 'ready'
                    ? `Couldn’t find rules text for “${name}”.`
                    : 'Loading spell…'}
                </p>
              )
            ) : (
              <>
                {facts.length > 0 && (
                  <div className="mb-3 flex flex-col gap-0.5 text-caption">
                    {facts.map(([label, value]) => (
                      <div key={label} className="text-ink-muted">
                        <span className="font-semibold text-ink">{label}:</span> {value}
                      </div>
                    ))}
                  </div>
                )}
                <EntriesView entries={spell.entries} />
                {Array.isArray(higher) && higher.length > 0 && <EntriesView entries={higher} />}
              </>
            )}
          </div>
          {footer !== undefined && <div className="mt-3 shrink-0">{footer}</div>}
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
