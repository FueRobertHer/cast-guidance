/**
 * The lines an effect's detail lists under "On" the character: each part as
 * its sheet says it, marked by what it does for them.
 */
import { AlertTriangle, ChevronsUp, Info, ShieldHalf } from 'lucide-react';
import type { EffectPart } from '@/engine/types';

/** How a part reads on the detail: what helps, protects, warns or only informs. */
export function toneOf(p: EffectPart): 'help' | 'ward' | 'warn' | 'info' {
  switch (p.kind) {
    case 'cue':
      return p.tone;
    case 'resist':
    case 'immune':
    case 'conditionImmune':
      return 'ward';
    case 'vulnerable':
      return 'warn';
    case 'rollAdvantage':
      return p.mode === 'dis' ? 'warn' : 'help';
    default:
      return 'help';
  }
}

export function Line({
  tone,
  children,
}: {
  tone: 'help' | 'ward' | 'warn' | 'info';
  children: string;
}) {
  const icon =
    tone === 'ward' ? (
      <ShieldHalf size={16} aria-hidden="true" className="mt-px shrink-0 text-ward" />
    ) : tone === 'warn' ? (
      <AlertTriangle size={16} aria-hidden="true" className="mt-px shrink-0 text-guide" />
    ) : tone === 'info' ? (
      <Info size={16} aria-hidden="true" className="mt-px shrink-0 text-ink-muted" />
    ) : (
      <ChevronsUp size={16} aria-hidden="true" className="mt-px shrink-0 text-heal" />
    );
  return (
    <li className={`flex gap-1.5 text-caption ${tone === 'info' ? 'text-ink-muted' : 'text-ink'}`}>
      {icon}
      <span>{children}</span>
    </li>
  );
}
