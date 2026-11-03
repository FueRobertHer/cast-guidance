import { conditionSpeed } from '@/engine/conditions';

/**
 * Exhaustion for the stepper, in both rules editions. 2014 is the cumulative
 * six-step table (disadvantage → half speed → … → death); 2024 is linear (−2
 * to every d20 test and −5 ft speed per level, death at 6). The rules
 * themselves are the engine's (`engine/conditions.ts`), which the rolls,
 * speed and HP maximum all read; these lines say the same in words. Death
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

/**
 * Set the exhaustion level (clamped to 0 through 6) in a draft's play-state
 * conditions; 0 removes the condition. Shared by the condition picker and
 * Exhaustion's own sheet.
 */
export function setExhaustionLevel(
  conditions: Array<{ id: string; level?: number }>,
  level: number,
): void {
  const idx = conditions.findIndex((x) => x.id === 'Exhaustion');
  const lvl = Math.max(0, Math.min(6, level));
  if (lvl === 0) {
    if (idx >= 0) conditions.splice(idx, 1);
  } else if (idx >= 0) {
    const e = conditions[idx];
    if (e !== undefined) e.level = lvl;
  } else {
    conditions.push({ id: 'Exhaustion', level: lvl });
  }
}

export function exhaustionInfo(level: number, edition: '2014' | '2024'): ExhaustionInfo {
  const lvl = Math.max(0, Math.min(6, level));
  // The engine holds the rule; this is its view for the stepper.
  const speedAfter = (base: number) =>
    conditionSpeed(base, [{ id: 'Exhaustion', level: lvl }], edition).value;

  if (edition === '2024') {
    const lines: string[] = [];
    if (lvl >= 1 && lvl < 6) {
      lines.push(`−${lvl * 2} to all d20 tests (checks, attacks, saves)`);
      lines.push(`−${lvl * 5} ft speed`);
    }
    if (lvl >= 6) lines.push('Death');
    return { level: lvl, dead: lvl >= 6, speedAfter, lines };
  }

  // 2014 cumulative table.
  const lines: string[] = [];
  if (lvl >= 1) lines.push('Disadvantage on ability checks');
  if (lvl >= 2) lines.push('Speed halved');
  if (lvl >= 3) lines.push('Disadvantage on attack rolls and saving throws');
  if (lvl >= 4) lines.push('Hit point maximum halved');
  if (lvl >= 5) lines.push('Speed reduced to 0');
  if (lvl >= 6) lines.push('Death');
  return { level: lvl, dead: lvl >= 6, speedAfter, lines };
}
