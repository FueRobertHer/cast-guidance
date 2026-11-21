/**
 * The Workshop's effect card boxes, found by name in a component test.
 *
 * A card names each of its boxes with `aria-label` ("Reroll: On", from
 * `EffectCards`' fields), which is what a label query matches it by too. A
 * label query also asks every control under its root for its labels, which
 * jsdom works out by walking the whole page, so on an editor's page each one
 * costs about the controls searched times the page's size; the card tests'
 * walks ask over a thousand. These find a box by the attribute alone.
 *
 * Only for boxes named that way: a control named by a `<label>`'s text (a
 * checkbox, a field outside the cards) is not found, so look that one up with
 * `getByLabelText`.
 */
import { fireEvent } from '@testing-library/react';

/** The box named `label` under `root`, if one is there. Two of one name are an error, as in `getByLabelText`. */
export function namedBox(label: string, root: ParentNode = document.body): HTMLElement | undefined {
  const found = [...root.querySelectorAll<HTMLElement>('[aria-label]')].filter(
    (el) => el.getAttribute('aria-label') === label,
  );
  if (found.length > 1) throw new Error(`${found.length} boxes named ${label}`);
  return found[0];
}

/** The box named `label` under `root`; there must be one. */
export function cardBox(label: string, root?: ParentNode): HTMLSelectElement {
  const el = namedBox(label, root);
  if (el === undefined) throw new Error(`no box named ${label}`);
  return el as HTMLSelectElement;
}

/** Whether a box named `label` is under `root`. */
export const hasBox = (label: string, root?: ParentNode): boolean =>
  namedBox(label, root) !== undefined;

/** Choose `value` in the box named `label`, or type it there. */
export const setBox = (label: string, value: string, root?: ParentNode): void => {
  fireEvent.change(cardBox(label, root), { target: { value } });
};

/** The values the box named `label` offers. */
export const boxChoices = (label: string, root?: ParentNode): string[] =>
  [...cardBox(label, root).options].map((o) => o.value);
