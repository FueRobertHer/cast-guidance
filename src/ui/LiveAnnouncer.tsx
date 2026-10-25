import { type Politeness, useAnnouncer } from '@/stores/announcer';

function Region({ politeness }: { politeness: Politeness }) {
  const messages = useAnnouncer((s) => s.messages);
  return (
    // Each message is its own line, added to a region that has been in the
    // page since boot, so a screen reader hears the addition and only that.
    // Not aria-atomic: an atomic region would read every line still in it.
    // No role: role="alert" with aria-live doubles up on some readers.
    <div aria-live={politeness} aria-relevant="additions" data-announcer={politeness}>
      {messages
        .filter((m) => m.politeness === politeness)
        .map((m) => (
          <p key={m.id}>{m.text}</p>
        ))}
    </div>
  );
}

/**
 * The regions `announce` speaks through (A11Y-002). Mounted once, in the app
 * shell, before anything can call `announce`, and never unmounted.
 */
export function LiveAnnouncer() {
  return (
    <div className="sr-only">
      <Region politeness="polite" />
      <Region politeness="assertive" />
    </div>
  );
}
