import type { Entity } from '@/data5e/copyMod';
import { SCHOOLS, spellDuration, spellRange } from '@/features/library/fmt';
import { castingEconomy } from './castResources';

/** The abilities a spell's save is made with, as the table says them: "DEX". */
export function spellSaves(entity: Entity | undefined): string[] {
  const saves = entity?.savingThrow;
  if (!Array.isArray(saves)) return [];
  return saves.filter((s) => typeof s === 'string').map((s) => s.slice(0, 3).toUpperCase());
}

/**
 * A spell row's one caption line (DS-001 SpellRow): school and range, then what
 * matters at the table where it applies. An action to cast and an instantaneous
 * duration are the usual case, and go unsaid. `withLevel` is for a list that is
 * not already grouped by level.
 */
export function spellMeta(
  entity: Entity | undefined,
  {
    withLevel = false,
    concentrating = false,
  }: { withLevel?: boolean; concentrating?: boolean } = {},
): string {
  if (entity === undefined) return 'Level unknown: not in the downloaded data';
  const parts: string[] = [];
  if (withLevel) {
    if (entity.level === 0) parts.push('Cantrip');
    else if (typeof entity.level === 'number') parts.push(`Level ${entity.level}`);
  }
  const school = SCHOOLS[String(entity.school)];
  if (school !== undefined) parts.push(school);
  const range = spellRange(entity.range);
  if (range !== '?') parts.push(range.replace(/\bfeet\b/, 'ft'));
  const economy = castingEconomy(entity);
  if (economy === 'bonus') parts.push('bonus action');
  else if (economy === 'reaction') parts.push('reaction');
  const saves = spellSaves(entity);
  if (saves.length > 0) parts.push(`${saves.join(' or ')} save`);
  if (concentrating) parts.push('concentrating');
  else {
    const duration = spellDuration(entity.duration).replace(/^Concentration, /, '');
    if (!['?', 'Instantaneous', 'Special'].includes(duration)) parts.push(duration);
  }
  return parts.join(' · ');
}
