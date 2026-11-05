import type { Entity } from './copyMod';
import type { EntityType } from './normalize';
import {
  defaultTargetType,
  type EditionRef,
  editionOf,
  type RulesVersion,
  reprintTargets,
} from './rulesVersion';

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
  /**
   * The same, but on another printing of the class this subclass sits under
   * (`Life Domain|PHB` on `Cleric|PHB`, reprinted under `Cleric|XPHB`). A class
   * row's picker lists only that printing's subclasses, so the row changes first.
   */
  | { kind: 'reprintedUnderClass'; as: EditionRef; underClass: EditionRef }
  /**
   * The same, but as something this pick cannot become (a subrace reprinted as a
   * feat), so there is nothing to switch it to. `what` says what, in words.
   */
  | { kind: 'reprintedNoSwitch'; as: EditionRef; what: string }
  /**
   * An older class the newer books reprint. The reprint is a row of its own and no
   * control changes a row, so reaching it means removing this one, with its picks.
   */
  | { kind: 'reprintedClass'; as: EditionRef }
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

const AS_A_FEAT = 'a feat';

/** For a reprint that is not in the picker beside the chip. */
const REPRINTED_ELSEWHERE = 'reprinted elsewhere';

/**
 * What a reprint is, in words, when this pick cannot become it, or undefined
 * when it can. A subrace's race is within reach through the species picker, and
 * a subclass on another printing of its class through that class's row. A
 * subclass of a differently named class is not, since that means leaving the
 * class. Feats are the other kind the data has today.
 */
function reprintOutOfReach(
  holderType: EntityType,
  target: EditionRef,
  found: Entity,
  classRow: EditionRef | undefined,
): string | undefined {
  if (
    target.type !== undefined &&
    target.type !== holderType &&
    target.type !== defaultTargetType(holderType)
  ) {
    return target.type === 'feat' ? AS_A_FEAT : 'something else';
  }
  const foundClass = found.className;
  if (
    classRow !== undefined &&
    typeof foundClass === 'string' &&
    foundClass.toLowerCase() !== classRow.name.toLowerCase()
  ) {
    return `a subclass of ${foundClass}`;
  }
  return undefined;
}

/**
 * The printing of its class a subclass's reprint sits on, when that is not the
 * row the character holds the subclass on.
 */
function otherClassPrinting(
  found: Entity,
  classRow: EditionRef | undefined,
): EditionRef | undefined {
  const { className, classSource } = found;
  if (classRow === undefined || typeof className !== 'string' || typeof classSource !== 'string') {
    return undefined;
  }
  return classSource.toLowerCase() === classRow.source.toLowerCase()
    ? undefined
    : { name: className, source: classSource };
}

/**
 * Classify one selection against the version the character is on.
 *
 * A reprint only counts when it is installed *and* is itself this version's
 * content. Both matter: naming a printing that never downloaded sends someone
 * looking for content that is not there, and most 2014 `reprintedAs` chains
 * point at another 2014 book (`Bugbear|VGM` points at `Bugbear|MPMM`), so
 * announcing those as "reprinted for 2024" would be a false claim about the
 * rules and would offer a switch that gains the player nothing.
 *
 * `classRow` is the class a subclass pick sits under on the character. It is the
 * character's row and not the entity's own: a lookup hands back one row per name
 * and source, so `Life Domain|PHB` reads as the row under `Cleric|PHB` even for
 * a character on `Cleric|XPHB`, whose picker already offers the reprint.
 */
export function editionFit(
  entity: Entity,
  type: EntityType,
  version: RulesVersion,
  resolve: ReprintResolver,
  classRow?: EditionRef,
): EditionFit {
  const edition = editionOf(entity);
  if (edition === version) return { kind: 'match' };
  if (edition === '2024') return { kind: 'newer' };
  // Both held back, because each is a claim about every target: "replace the class"
  // and "nothing to switch to" are false if another target is within reach.
  let afterClass: EditionFit | undefined;
  let noSwitch: EditionFit | undefined;
  for (const target of reprintTargets(entity, type)) {
    const found = resolve(target);
    if (found === undefined || editionOf(found) !== version) continue;
    // Named from the resolved entity, so the note reads "Life Domain" where the
    // uid carried only the shortName "Life".
    const as = { name: String(found.name), source: String(found.source) };
    const what = reprintOutOfReach(type, target, found, classRow);
    if (what !== undefined) {
      noSwitch ??= { kind: 'reprintedNoSwitch', as, what };
      continue;
    }
    const underClass = otherClassPrinting(found, classRow);
    if (underClass !== undefined) {
      afterClass ??= { kind: 'reprintedUnderClass', as, underClass };
      continue;
    }
    return type === 'class' ? { kind: 'reprintedClass', as } : { kind: 'reprinted', as };
  }
  return afterClass ?? noSwitch ?? { kind: 'carryOver' };
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
    case 'reprintedClass':
      return `${label}: ${other} content, reprinted for ${version} as a separate class, ${fit.as.name} (${fit.as.source}). Kept as chosen.`;
    case 'reprintedUnderClass':
      return `${label}: ${other} content, reprinted for ${version} as ${fit.as.name}, under ${fit.underClass.name} (${fit.underClass.source}) rather than your class. Kept as chosen.`;
    case 'reprintedNoSwitch':
      return `${label}: ${other} content, reprinted for ${version} as ${fit.what}, ${fit.as.name}. Kept as chosen.`;
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
    case 'reprintedClass':
      // The text stands: no picker sits beside a class row to go hunting through.
      // The title gives the route because a class can only be removed from level 1.
      // "Any" because this does not see the character: the confirm counts their picks.
      return {
        text: `reprinted for ${version}`,
        title: `${other} content. The ${version} books reprint it as a separate class, ${fit.as.name} (${fit.as.source}). To switch, take this class down to level 1, remove it, then add that one, which starts at level 1. Removing it clears any subclass, picks and spell list it has. This class stays until you do.`,
      };
    case 'reprintedUnderClass':
      // Not "kept either way": a class row has no control that changes it, so
      // reaching this reprint means removing the row and the pick.
      return {
        text: REPRINTED_ELSEWHERE,
        title: `${other} content. The ${version} books reprint it as ${fit.as.name} (${fit.as.source}), under ${fit.underClass.name} (${fit.underClass.source}). To switch, take this class down to level 1, remove it, then add that one. Removing it clears this pick, which stays until you do.`,
      };
    case 'reprintedNoSwitch':
      // Said in the text, not only the title: a phone never shows a title, and
      // this is what stops someone hunting the picker for the reprint. A feat is
      // the only kind named, because the chip does not wrap and a class name
      // pushes the page wider at 200% text. The Mixed editions note names the rest.
      return {
        text: fit.what === AS_A_FEAT ? `reprinted as ${AS_A_FEAT}` : REPRINTED_ELSEWHERE,
        title: `${other} content. The ${version} books reprint it as ${fit.what}, ${fit.as.name} (${fit.as.source}), so there is nothing to switch this pick to. Your pick is kept either way.`,
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
  /** Off-edition classes, whose reprint means replacing the class row. */
  reprintedClass: Array<{ label: string; as: EditionRef }>;
  /** Off-edition subclasses whose reprint needs their class row changed first. */
  reprintedUnderClass: Array<{ label: string; as: EditionRef; underClass: EditionRef }>;
  /** Off-edition selections reprinted as something they cannot become. */
  reprintedNoSwitch: Array<{ label: string; as: EditionRef; what: string }>;
  /** Off-edition selections with nowhere to move to. */
  carryOver: string[];
  /** Selections from the newer books in an older game. */
  newer: string[];
}

export function emptySwitchPreview(): EditionSwitchPreview {
  return {
    match: 0,
    reprinted: [],
    reprintedClass: [],
    reprintedUnderClass: [],
    reprintedNoSwitch: [],
    carryOver: [],
    newer: [],
  };
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
    case 'reprintedClass':
      preview.reprintedClass.push({ label, as: fit.as });
      break;
    case 'reprintedUnderClass':
      preview.reprintedUnderClass.push({ label, as: fit.as, underClass: fit.underClass });
      break;
    case 'reprintedNoSwitch':
      preview.reprintedNoSwitch.push({ label, as: fit.as, what: fit.what });
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
  const off =
    preview.reprinted.length +
    preview.reprintedClass.length +
    preview.reprintedUnderClass.length +
    preview.reprintedNoSwitch.length +
    preview.carryOver.length +
    preview.newer.length;
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
  // One sentence for both: they come to the same thing, and a character with a
  // subclass usually has one of each.
  const behindClass = [
    ...preview.reprintedClass.map((r) => `${r.label} → ${r.as.name} (${r.as.source})`),
    ...preview.reprintedUnderClass.map(
      (r) => `${r.label} → ${r.as.name} under ${r.underClass.name} (${r.underClass.source})`,
    ),
  ];
  if (behindClass.length > 0) {
    parts.push(
      `${count(behindClass.length, 'has', 'have')} a ${version} reprint you can only reach by replacing a class (${behindClass.join(', ')})`,
    );
  }
  if (preview.reprintedNoSwitch.length > 0) {
    const named = preview.reprintedNoSwitch
      .map((r) => `${r.label} → ${r.as.name} as ${r.what}`)
      .join(', ');
    parts.push(
      `${count(preview.reprintedNoSwitch.length, 'has', 'have')} a ${version} reprint of another kind, with nothing to switch to (${named})`,
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
