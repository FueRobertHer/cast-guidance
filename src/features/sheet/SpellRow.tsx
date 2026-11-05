import type { ReactNode } from 'react';
import type { RulesVersion } from '@/data5e/rulesVersion';
import { Badge } from '@/ui/Badge';
import { SpellInfoSheet } from './SpellInfoSheet';

/**
 * One of the character's own spells (DS-001 SpellRow): what it is, and the one
 * thing a player does with it.
 *
 * The name opens the spell's rules in place. A square `arcane` C marks
 * concentration, an "Always" badge a spell always prepared. While concentrating
 * the row tints `arcane-soft` and its C fills. The actions drop under the name
 * as one group where both do not fit (large text, several chips on a narrow
 * phone), rather than squeeze the name or push the page sideways (A11Y-003).
 */
export function SpellRow({
  name,
  source,
  version,
  subtitle,
  meta,
  concentrates,
  concentrating,
  always = false,
  muted = false,
  marks,
  actions,
}: {
  name: string;
  source: string;
  version: RulesVersion;
  /** Under the title of the rules sheet: where the spell comes from. */
  subtitle: string;
  /** The one caption line; see `spellMeta`. */
  meta?: string;
  concentrates: boolean;
  concentrating: boolean;
  always?: boolean;
  /** Known but not prepared: there, but quieter. */
  muted?: boolean;
  /** Anything else the title line has to say, such as uses left. */
  marks?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`flex min-h-15 flex-wrap items-center gap-x-2 gap-y-1 py-2 pr-3 pl-4 ${
        concentrating ? 'bg-arcane-soft' : ''
      }`}
    >
      <div className="min-w-0 flex-1 basis-26">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <SpellInfoSheet
            name={name}
            source={source}
            version={version}
            subtitle={subtitle}
            trigger={
              <button
                type="button"
                className={`min-h-6 min-w-0 wrap-anywhere text-left text-body-strong underline decoration-line-strong decoration-dashed underline-offset-4 ${
                  muted ? 'text-ink-muted' : ''
                }`}
              >
                {name}
              </button>
            }
          />
          {concentrates && (
            <span
              title="Concentration"
              className={`inline-flex size-4.5 shrink-0 items-center justify-center rounded-[0.25rem] font-bold text-[0.6875rem] ${
                concentrating ? 'bg-arcane text-surface' : 'bg-arcane-soft text-arcane'
              }`}
            >
              <span aria-hidden="true">C</span>
              <span className="sr-only">Concentration</span>
            </span>
          )}
          {always && <Badge>Always</Badge>}
          {marks}
        </div>
        {meta !== undefined && meta !== '' && (
          <div className="text-caption text-ink-muted">{meta}</div>
        )}
      </div>
      {actions !== undefined && actions !== null && (
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
          {actions}
        </div>
      )}
    </div>
  );
}
