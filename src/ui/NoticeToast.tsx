import { useEffect, useRef, useState } from 'react';
import { type Notice, useNotices } from '@/stores/notices';

const TONE: Record<Notice['tone'], string> = {
  info: 'border-surface-2',
  good: 'border-emerald-300/60',
  warn: 'border-accent/60',
};

const ICON: Record<Notice['tone'], string> = { info: '›', good: '✓', warn: '!' };

/**
 * App-wide snackbar for one-shot notices (rest summaries, imports, …).
 * Sits just above the roll toast so both can coexist briefly.
 */
export function NoticeToast() {
  const seq = useNotices((s) => s.seq);
  const notice = useNotices((s) => s.notice);
  const [visible, setVisible] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (seq === 0 || notice === null) return;
    setVisible(notice);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(null), 3600);
    return () => clearTimeout(timer.current);
  }, [seq, notice]);

  if (visible === null) return null;

  return (
    <output
      className={`fixed inset-x-4 bottom-28 z-30 flex items-start gap-3 rounded-lg border ${TONE[visible.tone]} bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur lg:left-auto lg:right-6 lg:w-80`}
      aria-live="polite"
    >
      <span className="shrink-0 text-lg leading-6 text-ink-muted">{ICON[visible.tone]}</span>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{visible.title}</div>
        {visible.detail !== undefined && (
          <div className="text-xs text-ink-muted">{visible.detail}</div>
        )}
      </div>
    </output>
  );
}
