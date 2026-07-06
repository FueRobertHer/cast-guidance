import { SOURCES_2024 } from '@/data5e/rulesVersion';

export function SourceBadge({ source }: { source: string }) {
  const is2024 = SOURCES_2024.has(source);
  return (
    <span
      className={`inline-block rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        is2024 ? 'bg-emerald-900/60 text-emerald-300' : 'bg-surface-2 text-ink-muted'
      }`}
      title={is2024 ? `${source} (2024 rules)` : source}
    >
      {source}
    </span>
  );
}
