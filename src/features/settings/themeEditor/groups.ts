import { CONDITION_HUES } from '@/theme/vocabulary';

/**
 * The theme editor's groups, in order (docs/theming-plan.md, phase 4): what
 * most themes change first, then everything by what it is. A token appears in
 * one group only; groups.test.ts holds them to the whole vocabulary.
 */

export interface EditorGroup {
  readonly id: string;
  readonly title: string;
  /** A line under the title. */
  readonly hint?: string;
  readonly tokens: readonly string[];
  /** Tucked away under the group's own fold, closed at first. */
  readonly more?: { readonly title: string; readonly tokens: readonly string[] };
}

export const EDITOR_GROUPS: readonly EditorGroup[] = [
  {
    id: 'start',
    title: 'Start here',
    hint: 'The colours and fonts most themes change first. Borders, tints and labels follow them.',
    tokens: ['bg', 'surface', 'ink', 'brand', 'font-sans', 'font-display', 'radius-card'],
  },
  {
    id: 'grounds',
    title: 'Page and surfaces',
    tokens: ['surface-raised', 'surface-hover', 'line', 'line-strong', 'track', 'edge', 'scrim'],
  },
  { id: 'text', title: 'Text', tokens: ['ink-muted', 'ink-faint'] },
  {
    id: 'roles',
    title: 'Actions and roles',
    tokens: [
      'brand-hover',
      'on-brand',
      'roll',
      'roll-soft',
      'guide',
      'guide-soft',
      'focus',
      'danger',
      'danger-fill',
      'on-danger',
      'danger-soft',
      'heal',
      'heal-soft',
      'ward',
      'ward-soft',
      'arcane',
      'arcane-soft',
      'meter-mid',
      'hp-trail',
      'hp-bloom',
      'hp-sheen',
    ],
  },
  {
    id: 'conditions',
    title: 'Conditions',
    hint: 'The colour each condition wears on the rolls it changes.',
    tokens: [...CONDITION_HUES.map((c) => `cx-${c}`), 'cx-edge-hover'],
    more: { title: 'Their tints', tokens: CONDITION_HUES.map((c) => `cx-${c}-soft`) },
  },
  { id: 'type', title: 'Type', tokens: ['weight-normal', 'weight-semibold', 'weight-bold'] },
  {
    id: 'shape',
    title: 'Shape',
    tokens: [
      'radius-chip',
      'radius-control',
      'radius-sheet',
      'radius-pill',
      'border',
      'border-strong',
    ],
  },
  { id: 'shadows', title: 'Shadows', tokens: ['shadow-card', 'shadow-float', 'shadow-overlay'] },
  { id: 'icons', title: 'Icons', tokens: ['icon-stroke'] },
  {
    id: 'decor',
    title: 'Decor',
    hint: 'A texture behind the page, and a frame around cards.',
    tokens: ['texture', 'frame'],
  },
];
