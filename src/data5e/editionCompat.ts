import type { Entity } from './copyMod';
import type { EntityType } from './normalize';
import { type EditionRef, editionOf, type RulesVersion, reprintTargets } from './rulesVersion';

export type { EditionRef } from './rulesVersion';

/**
 * Where one chosen entity stands against the character's rules version
 * (GAME-003). Picker filtering keeps the lists edition-appropriate; this is
 * about everything after the pick, when a character already holds content from
 * the other edition. Mixing editions is not an error here, so every fit but
 * `match` is a cue, never a refusal.
 */
export type EditionFit =
  | { kind: 'match' }
  /** Older content the newer books reprint, and that reprint is installed. */
  | { kind: 'reprinted'; as: EditionRef }
  /** Older content with no reprint to move to: it carries over unchanged. */
  | { kind: 'carryOver' }
  /** Newer content in an older game: its rules assume books the table isn't using. */
  | { kind: 'newer' };

/**
 * Resolves a reprint target to the entity that is actually installed, or
 * undefined when it is not. It hands back the entity rather than a yes/no
 * because a target has to clear two bars, and only the entity answers both.
 */
export type ReprintResolver = (ref: EditionRef) => Entity | undefined;

/**
 * Classify one selection against the version the character is on.
 *
 * A reprint only counts when it is installed *and* is itself this version's
 * content. Both matter: naming a printing that never downloaded sends someone
 * looking for content that is not there, and most 2014 `reprintedAs` chains
 * point at another 2014 book (`Bugbear|VGM` points at `Bugbear|MPMM`), so
 * announcing those as "reprinted for 2024" would be a false claim about the
 * rules and would offer a switch that gains the player nothing.
 */
export function editionFit(
  entity: Entity,
  type: EntityType,
  version: RulesVersion,
  resolve: ReprintResolver,
): EditionFit {
  const edition = editionOf(entity);
  if (edition === version) return { kind: 'match' };
  if (edition === '2024') return { kind: 'newer' };
  for (const target of reprintTargets(entity, type)) {
    const found = resolve(target);
    if (found === undefined || editionOf(found) !== version) continue;
    // Named from the resolved entity, so the note reads "Life Domain" where the
    // uid carried only the shortName "Life".
    return { kind: 'reprinted', as: { name: String(found.name), source: String(found.source) } };
  }
  return { kind: 'carryOver' };
}

/**
 * The sentence a mismatch is worth, or undefined when there is nothing to say.
 * Each one ends by saying the pick stands, because the cue exists to explain a
 * character, not to ask them to change it.
 */
export function editionFitNote(
  label: string,
  fit: EditionFit,
  version: RulesVersion,
): string | undefined {
  const other = version === '2024' ? '2014' : '2024';
  switch (fit.kind) {
    case 'match':
      return undefined;
    case 'reprinted':
      return `${label}: ${other} content, reprinted for ${version} as ${fit.as.name}. Kept as chosen.`;
    case 'carryOver':
      return `${label}: ${other} content with no ${version} reprint. Kept as chosen.`;
    case 'newer':
      return `${label}: ${other} content in a ${version} game, so its rules assume the ${other} books. Kept as chosen.`;
  }
}

/**
 * Compact text for a chip beside the selection, plus the full sentence as its
 * tooltip. The edition itself is already on screen via the source badge, so the
 * chip says what is not visible: how the pick sits with this character.
 */
export function editionFitChip(
  fit: EditionFit,
  version: RulesVersion,
): { text: string; title: string } | undefined {
  const other = version === '2024' ? '2014' : '2024';
  switch (fit.kind) {
    case 'match':
      return undefined;
    case 'reprinted':
      return {
        text: `reprinted for ${version}`,
        title: `${other} content. The ${version} books reprint it as ${fit.as.name} (${fit.as.source}), which you can switch to. Your pick is kept either way.`,
      };
    case 'carryOver':
      return {
        text: `${other} content`,
        title: `${other} content with no ${version} reprint. It carries over unchanged.`,
      };
    case 'newer':
      return {
        text: `${other} content`,
        title: `${other} content in a ${version} game. Its rules assume the ${other} books. It is kept as chosen.`,
      };
  }
}

/** Counts behind a rules-version switch, for the preview before it applies. */
export interface EditionSwitchPreview {
  /** Selections that are already right for the target version. */
  match: number;
  /** Off-edition selections that have an installed reprint, named. */
  reprinted: Array<{ label: string; as: EditionRef }>;
  /** Off-edition selections with nowhere to move to. */
  carryOver: string[];
  /** Selections from the newer books in an older game. */
  newer: string[];
}

export function emptySwitchPreview(): EditionSwitchPreview {
  return { match: 0, reprinted: [], carryOver: [], newer: [] };
}

/** Fold one classified selection into a preview. */
export function addToPreview(
  preview: EditionSwitchPreview,
  label: string,
  fit: EditionFit,
): EditionSwitchPreview {
  switch (fit.kind) {
    case 'match':
      preview.match += 1;
      break;
    case 'reprinted':
      preview.reprinted.push({ label, as: fit.as });
      break;
    case 'carryOver':
      preview.carryOver.push(label);
      break;
    case 'newer':
      preview.newer.push(label);
      break;
  }
  return preview;
}

/**
 * What to tell someone before the switch happens. Leads with the reassurance
 * that nothing is removed, because that is the question a version switch
 * actually raises, then says which picks will carry a cue afterwards.
 */
export function describeSwitch(
  preview: EditionSwitchPreview,
  version: RulesVersion,
): { summary: string; unchanged: boolean } {
  const off = preview.reprinted.length + preview.carryOver.length + preview.newer.length;
  const total = preview.match + off;

  if (off === 0) {
    return {
      summary:
        total === 0
          ? `Nothing is selected yet, so switching to ${version} only changes which content the pickers offer.`
          : `Every selection already suits ${version}. Nothing is removed and nothing needs changing.`,
      unchanged: true,
    };
  }
  const parts: string[] = [];
  const count = (n: number, singular: string, plural: string) =>
    `${String(n)} ${n === 1 ? singular : plural}`;
  if (preview.reprinted.length > 0) {
    const named = preview.reprinted.map((r) => `${r.label} → ${r.as.name}`).join(', ');
    parts.push(
      `${count(preview.reprinted.length, 'has', 'have')} a ${version} reprint you can switch to afterwards (${named})`,
    );
  }
  if (preview.carryOver.length > 0) {
    parts.push(
      `${count(preview.carryOver.length, 'carries', 'carry')} over with no ${version} reprint (${preview.carryOver.join(', ')})`,
    );
  }
  if (preview.newer.length > 0) {
    parts.push(
      `${count(preview.newer.length, 'comes', 'come')} from the newer books (${preview.newer.join(', ')})`,
    );
  }
  // No total: a pick whose entity is missing is not classified at all (the
  // engine reports that separately), so counting "all N selections" here would
  // be an absolute claim about a number this function cannot see.
  return {
    summary: `Nothing is removed and every selection is kept. ${parts.join('; ')}. Each will carry a note on the sheet.`,
    unchanged: false,
  };
}
