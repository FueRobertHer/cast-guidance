/** Short human labels for character history snapshots. */
import type { CharacterDoc } from '@/engine/types';

export function historyLabel(prev: CharacterDoc | undefined, next: CharacterDoc): string {
  if (prev === undefined) return 'Snapshot';
  const labels: string[] = [];

  if (prev.name !== next.name) labels.push(`Renamed to ${next.name}`);
  if (prev.rulesVersion !== next.rulesVersion) labels.push(`Rules → ${next.rulesVersion}`);

  // Classes: level changes / additions / removals / subclass
  const prevByUid = new Map(prev.classes.map((c) => [`${c.ref.name}|${c.ref.source}`, c]));
  for (const c of next.classes) {
    const uid = `${c.ref.name}|${c.ref.source}`;
    const p = prevByUid.get(uid);
    if (p === undefined) labels.push(`Added ${c.ref.name}`);
    else {
      if (p.levels !== c.levels)
        labels.push(
          c.levels > p.levels
            ? `Level up: ${c.ref.name} ${c.levels}`
            : `${c.ref.name} → ${c.levels}`,
        );
      if (p.subclass?.name !== c.subclass?.name)
        labels.push(c.subclass !== undefined ? `Subclass: ${c.subclass.name}` : 'Subclass cleared');
      prevByUid.delete(uid);
    }
  }
  for (const [, p] of prevByUid) labels.push(`Removed ${p.ref.name}`);

  if (prev.race?.name !== next.race?.name) labels.push(`Race: ${next.race?.name ?? 'none'}`);
  if (prev.subrace?.name !== next.subrace?.name)
    labels.push(`Subrace: ${next.subrace?.name ?? 'none'}`);
  if (prev.background?.name !== next.background?.name)
    labels.push(`Background: ${next.background?.name ?? 'none'}`);
  if ((prev.hpMethod ?? 'average') !== (next.hpMethod ?? 'average'))
    labels.push(`HP rule: ${next.hpMethod ?? 'average'}`);

  if (JSON.stringify(prev.abilities) !== JSON.stringify(next.abilities))
    labels.push('Ability scores');
  if (Object.keys(prev.choices).length !== Object.keys(next.choices).length) labels.push('Choices');
  else if (JSON.stringify(prev.choices) !== JSON.stringify(next.choices)) labels.push('Choices');
  if (JSON.stringify(prev.equipment) !== JSON.stringify(next.equipment)) labels.push('Equipment');
  if (JSON.stringify(prev.spellcasting) !== JSON.stringify(next.spellcasting))
    labels.push('Spells');
  if (JSON.stringify(prev.overrides) !== JSON.stringify(next.overrides)) labels.push('Overrides');
  if (JSON.stringify(prev.customEffects) !== JSON.stringify(next.customEffects))
    labels.push('Modifiers');
  if (prev.notes !== next.notes) labels.push('Notes');

  // Play state — most frequent; keep it specific for HP
  if (prev.play.currentHp !== next.play.currentHp)
    labels.push(`HP ${prev.play.currentHp}→${next.play.currentHp}`);
  else if (JSON.stringify(prev.play) !== JSON.stringify(next.play)) labels.push('Play state');

  if (labels.length === 0) return 'Edited';
  return labels.slice(0, 3).join(' · ') + (labels.length > 3 ? ' · …' : '');
}
