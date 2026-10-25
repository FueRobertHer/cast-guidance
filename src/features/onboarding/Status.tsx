import { CircleCheck, CircleSlash, Clock, type LucideIcon, TriangleAlert } from 'lucide-react';
import type { PersistState } from '@/lib/persistentStorage';

export type Tone = 'good' | 'wait' | 'warn' | 'off';

const TONE_ICON: Record<Tone, LucideIcon> = {
  good: CircleCheck,
  wait: Clock,
  warn: TriangleAlert,
  off: CircleSlash,
};

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-emerald-300',
  wait: 'text-ink-muted',
  warn: 'text-amber-300',
  off: 'text-ink-muted',
};

/** Icon plus word, so a state never rests on colour alone. */
export function Status({ tone, label }: { tone: Tone; label: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      <Icon size={14} aria-hidden />
      {label}
    </span>
  );
}

const PERSIST_STATUS: Record<PersistState, [Tone, string]> = {
  persisted: ['good', 'Protected'],
  'best-effort': ['warn', 'Not protected yet'],
  denied: ['warn', 'Not protected'],
  unsupported: ['off', 'Not available'],
  checking: ['wait', 'Checking'],
};

/** The persistent-storage answer, worded the same on the card and in Settings. */
export function PersistStatus({ state }: { state: PersistState }) {
  const [tone, label] = PERSIST_STATUS[state];
  return <Status tone={tone} label={label} />;
}

/**
 * Said only after the browser has answered no. Chrome grants or refuses on
 * its own heuristics without asking anyone, so this never blames the user.
 */
export const PERSIST_DENIED_TEXT =
  'Your browser decides this itself; installing the app or using it often helps.';
