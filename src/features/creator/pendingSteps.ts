import { type CharacterDoc, type ChoicePrompt, type EffectOrigin, refUid } from '@/engine/types';
import { STEPS, type Step } from './steps';

/**
 * The wizard step that shows picks from `origin`: the class and its subclass
 * on Class, the species on Species, the background on Background, and the
 * rest (feats, a class's optional features, items) on Choices.
 */
export function stepForOrigin(doc: CharacterDoc, origin: EffectOrigin): Step {
  switch (origin.type) {
    case 'race':
      return 'species';
    case 'background':
      return 'background';
    case 'class':
      return doc.classes.some((c) => refUid(c.ref) === origin.uid) ? 'class' : 'choices';
    case 'subclass':
      return doc.classes.some((c) => c.subclass !== undefined && refUid(c.subclass) === origin.uid)
        ? 'class'
        : 'choices';
    default:
      return 'choices';
  }
}

/**
 * The steps with picks still to make, in wizard order, and how many each
 * has. The pending count and Review's fixes lead to these: they used to lead
 * to Choices, which shows only the picks no other step does, so a class's
 * skills or a species' languages pending sent the player to an empty page.
 */
export function pendingSteps(
  doc: CharacterDoc,
  pending: readonly ChoicePrompt[],
): Array<{ step: Step; count: number }> {
  const counts = new Map<Step, number>();
  for (const p of pending) {
    const step = stepForOrigin(doc, p.origin);
    counts.set(step, (counts.get(step) ?? 0) + 1);
  }
  return STEPS.flatMap((step) => {
    const count = counts.get(step);
    return count !== undefined ? [{ step, count }] : [];
  });
}
