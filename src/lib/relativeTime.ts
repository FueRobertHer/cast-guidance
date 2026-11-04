/**
 * When something happened, as a player says it: "just now", "2 min ago",
 * "3 h ago", and past a day `clock`, the caller's own way of writing the moment
 * (a roll's time of day, a character's date).
 */
export function relativeTime(at: number, now: number, clock: string): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : clock;
}
