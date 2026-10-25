import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry, useTypePacks } from '@/data5e/hooks';
import { pickForVersion, type RulesVersion } from '@/data5e/rulesVersion';
import { headerFacts } from '@/features/library/fmt';
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

function SpellInfoSheetContent({ name, source, version, subtitle, trigger }: SpellInfoSheetProps) {
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
  // Opened again after a failure, try again. Once armed this stays mounted
  // through a close, and its panel, which retries on reconnect, only while
  // the sheet is open, so a sheet closed offline would otherwise reopen online
  // still saying the device is offline. Not on the first opening, which is
  // the download itself, however quickly it failed.
  const openedBefore = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only an opening asks
  useEffect(() => {
    if (!open) return;
    if (openedBefore.current && packs.status === 'error') packs.retry();
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
        <Sheet.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Sheet.Content
          // With no spell to show, the line saying why is the sheet's
          // description: focus lands on Retry or the sheet itself, and the
          // line would otherwise go unread.
          aria-describedby={spell === undefined ? messageId : undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-surface-2" />
          <Sheet.Title className="mb-1 shrink-0 text-base font-semibold capitalize">
            {spell !== undefined ? String(spell.name) : name}
          </Sheet.Title>
          {subtitle !== undefined && (
            <p className="mb-2 shrink-0 text-xs text-ink-muted">{subtitle}</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto text-sm">
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
                  <div className="mb-3 flex flex-col gap-0.5 text-xs">
                    {facts.map(([label, value]) => (
                      <div key={label} className="text-ink-muted">
                        <span className="font-medium text-ink">{label}:</span> {value}
                      </div>
                    ))}
                  </div>
                )}
                <EntriesView entries={spell.entries} />
                {Array.isArray(higher) && higher.length > 0 && <EntriesView entries={higher} />}
              </>
            )}
          </div>
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
