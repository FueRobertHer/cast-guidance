import { CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NOTICE_MS, type Notice, useNotices } from '@/stores/notices';
import { snackbarDetailClass, snackbarProps } from './Snackbar';

// In the snackbar's own ink, like its text: the theme's hues fall under 3:1 on
// an inverted ground (WCAG 1.4.11), and the title says the rest.
const ICON: Record<Notice['tone'], LucideIcon> = {
  info: Info,
  good: CircleCheck,
  warn: CircleAlert,
};

/**
 * App-wide snackbar for one-shot notices (rest summaries, imports, …), in the
 * snackbar's inverted style (DS-001). Sits just above the roll toast so both
 * can coexist briefly.
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
    timer.current = setTimeout(() => setVisible(null), NOTICE_MS);
    return () => clearTimeout(timer.current);
  }, [seq, notice]);

  if (visible === null) return null;

  const Icon = ICON[visible.tone];
  const snackbar = snackbarProps(false);
  return (
    // A plain visual: `notify` says the notice through the announcer, since
    // an <output> that mounts with its text is announced unreliably.
    // `data-testid` is the toast's stable handle for tests: its element and
    // live-region attributes are free to change, the handle is not.
    <div
      data-testid="notice-toast"
      {...snackbar}
      className={`${snackbar.className} fixed inset-x-4 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] z-30 lg:left-auto lg:right-6 lg:w-80`}
    >
      <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0 self-start" />
      <div className="min-w-0">
        <div className="font-semibold">{visible.title}</div>
        {visible.detail !== undefined && (
          <div className={snackbarDetailClass}>{visible.detail}</div>
        )}
      </div>
    </div>
  );
}
