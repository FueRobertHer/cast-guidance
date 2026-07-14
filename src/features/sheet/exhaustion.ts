/**
 * Exhaustion mechanics for both rules editions. 2014 is the cumulative six-step
 * table (disadvantage → half speed → … → death); 2024 is linear (−2 to every
 * d20 test and −5 ft speed per level, death at 6). Effects that a digital sheet
 * can't force on a roll (disadvantage, halved HP max) are surfaced as advisory
 * lines; speed is computed so the sheet can show the reduced number, and death
 * (level 6) is flagged so the UI can offer a *user-triggered* drop to 0 HP.
 */
export interface ExhaustionInfo {
  level: number;
  /** Level 6 — the UI offers a manual "drop to 0 HP", never automatic. */
  dead: boolean;
  /** Walk speed after exhaustion, given the base speed. */
  speedAfter: (base: number) => number;
  /** Human-readable effect lines for the current level. */
  lines: string[];
}

/** Current exhaustion level (0–6) from the play-state conditions. */
export function exhaustionLevel(conditions: ReadonlyArray<{ id: string; level?: number }>): number {
  const lvl = conditions.find((c) => c.id === 'Exhaustion')?.level ?? 0;
  return Math.max(0, Math.min(6, lvl));
}

export function exhaustionInfo(level: number, edition: '2014' | '2024'): ExhaustionInfo {
  const lvl = Math.max(0, Math.min(6, level));

  if (edition === '2024') {
    const lines: string[] = [];
    if (lvl >= 1 && lvl < 6) {
      lines.push(`−${lvl * 2} to all d20 tests (checks, attacks, saves)`);
      lines.push(`−${lvl * 5} ft speed`);
    }
    if (lvl >= 6) lines.push('Death');
    return {
      level: lvl,
      dead: lvl >= 6,
      speedAfter: (base) => (lvl >= 6 ? 0 : Math.max(0, base - lvl * 5)),
      lines,
    };
  }

  // 2014 cumulative table.
  const lines: string[] = [];
  if (lvl >= 1) lines.push('Disadvantage on ability checks');
  if (lvl >= 2) lines.push('Speed halved');
  if (lvl >= 3) lines.push('Disadvantage on attack rolls and saving throws');
  if (lvl >= 4) lines.push('Hit point maximum halved');
  if (lvl >= 5) lines.push('Speed reduced to 0');
  if (lvl >= 6) lines.push('Death');
  return {
    level: lvl,
    dead: lvl >= 6,
    speedAfter: (base) => (lvl >= 5 ? 0 : lvl >= 2 ? Math.floor(base / 2) : base),
    lines,
  };
}
