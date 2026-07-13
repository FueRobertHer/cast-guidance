import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';
import type { Entity } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import { pickForVersion, type RulesVersion } from '@/data5e/rulesVersion';
import { headerFacts } from '@/features/library/fmt';

/**
 * Tap-to-explain bottom sheet for a spell — the same in-place rules popup that
 * weapons and actions use, instead of a link to the library. The lookup is
 * deliberately tolerant: granted/innate spells often carry a blank or wrong
 * source (e.g. "dancing lights" with no source, which broke the old link), so
 * we fall back to a name-only match and load the spell packs lazily on open.
 */
export function SpellInfoSheet({
  name,
  source,
  version,
  subtitle,
  trigger,
}: {
  name: string;
  source?: string;
  /** Character's rules version — picks the right printing when source misses. */
  version?: RulesVersion;
  subtitle?: string;
  trigger: ReactNode;
}) {
  const registry = useRegistry();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void ensureTypePacks('spell').then(() => {
      if (alive) setLoaded(true);
    });
    return () => {
      alive = false;
    };
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
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-surface-2" />
          <Drawer.Title className="mb-1 shrink-0 text-base font-semibold capitalize">
            {spell !== undefined ? String(spell.name) : name}
          </Drawer.Title>
          {subtitle !== undefined && (
            <p className="mb-2 shrink-0 text-xs text-ink-muted">{subtitle}</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto text-sm">
            {spell === undefined ? (
              <p className="text-ink-muted">
                {loaded ? `Couldn’t find rules text for “${name}”.` : 'Loading spell…'}
              </p>
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
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
