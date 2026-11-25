import { CONDITION_HUES } from './vocabulary';

/**
 * Each token's name in the theme editor, as a person would say it: what it
 * colours or shapes, not the code's name. labels.test.ts holds every token of
 * the vocabulary to having one.
 */

const CONDITION_NAMES: Readonly<Record<(typeof CONDITION_HUES)[number], string>> = {
  poisoned: 'Poisoned',
  paralyzed: 'Paralyzed',
  frightened: 'Frightened',
  blinded: 'Blinded',
  prone: 'Prone',
  restrained: 'Restrained',
  grappled: 'Grappled',
  exhaustion: 'Exhaustion',
  invisible: 'Invisible',
  stunned: 'Stunned',
  unconscious: 'Unconscious',
  incapacitated: 'Incapacitated',
  petrified: 'Petrified',
};

export const TOKEN_LABELS: Readonly<Record<string, string>> = {
  bg: 'Page',
  surface: 'Cards',
  'surface-raised': 'Controls on a card',
  'surface-hover': 'Hovered and pressed',
  line: 'Hairlines',
  'line-strong': 'Outlines',
  track: 'Empty meter',
  edge: 'Field edges',
  scrim: 'Behind a sheet',
  ink: 'Text',
  'ink-muted': 'Labels',
  'ink-faint': 'Placeholders',
  brand: 'Action',
  'brand-hover': 'Action, hovered',
  'on-brand': 'Words on the action',
  guide: 'Guidance',
  'guide-soft': 'Guidance tint',
  focus: 'Focus ring',
  danger: 'Danger',
  'danger-fill': 'Destructive buttons',
  'on-danger': 'Words on them',
  'danger-soft': 'Danger tint',
  heal: 'Healing',
  'heal-soft': 'Healing tint',
  ward: 'Temporary HP',
  'ward-soft': 'Temporary HP tint',
  roll: 'Rolls',
  'roll-soft': 'Roll tint',
  arcane: 'Spellcasting',
  'arcane-soft': 'Spellcasting tint',
  'meter-mid': 'A meter half spent',
  'hp-trail': 'HP lost, as it drains',
  'hp-bloom': 'HP gained, as it lands',
  'hp-sheen': 'Temporary HP glint',
  ...Object.fromEntries(
    CONDITION_HUES.flatMap((c) => [
      [`cx-${c}`, CONDITION_NAMES[c]],
      [`cx-${c}-soft`, `${CONDITION_NAMES[c]} tint`],
    ]),
  ),
  'cx-edge-hover': 'A roll chip’s edge, hovered',
  'shadow-card': 'Under cards',
  'shadow-float': 'Under the dice button',
  'shadow-overlay': 'Under sheets and dialogs',
  'font-sans': 'Text font',
  'font-display': 'Title font',
  'weight-normal': 'Regular',
  'weight-semibold': 'Semibold',
  'weight-bold': 'Bold',
  'tracking-display': 'Title letter spacing',
  'radius-chip': 'Chips',
  'radius-control': 'Buttons and fields',
  'radius-card': 'Cards',
  'radius-sheet': 'Sheets',
  'radius-pill': 'Pills and meters',
  border: 'Edges',
  'border-strong': 'Selected edges',
  'icon-stroke': 'Icon lines',
  texture: 'Page texture',
  frame: 'Card frames',
};

/** What a following token follows, as the editor says it: "the page", "Action". */
export function followsLabel(name: string): string {
  return name === 'bg' ? 'the page' : (TOKEN_LABELS[name] ?? name);
}
