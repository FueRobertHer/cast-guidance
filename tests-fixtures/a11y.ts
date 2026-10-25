/**
 * Accessible-name guard for component tests (A11Y-001).
 *
 * The accessible-name algorithm falls back to `title`, so a Testing Library
 * query like `getByRole('button', { name: 'Dice tray' })` passes for an
 * icon-only button whose only text is a tooltip. iOS VoiceOver does not read
 * `title`, so these helpers compute the name with every `title` removed.
 */
import { computeAccessibleName } from 'dom-accessibility-api';

const CONTROLS = [
  'button',
  'a[href]',
  'input:not([type="hidden"]):not([type="file"])',
  'select',
  'textarea',
].join(', ');

/** True when a name has nothing a screen reader would speak as a word or number. */
const isBlank = (name: string) => !/[\p{L}\p{N}]/u.test(name);

/** Runs `fn` with every `title` in the document lifted, then puts them back. */
function withoutTitles<T>(doc: Document, fn: () => T): T {
  const titled = [...doc.querySelectorAll('[title]')].map(
    (node) => [node, node.getAttribute('title') ?? ''] as const,
  );
  for (const [node] of titled) node.removeAttribute('title');
  try {
    return fn();
  } finally {
    for (const [node, title] of titled) node.setAttribute('title', title);
  }
}

/** The accessible name of `el`, ignoring `title` everywhere. */
export function spokenName(el: Element): string {
  return withoutTitles(el.ownerDocument, () => computeAccessibleName(el));
}

/**
 * The `outerHTML` of every control under `root` whose spoken name is blank
 * (empty, or only glyphs like "✕", "−" or "+"). Pass `document.body` so
 * portaled sheet content is swept too. An empty array means every control
 * has a name.
 */
export function namelessControls(root: Element = document.body): string[] {
  const nameless = withoutTitles(root.ownerDocument, () =>
    [...root.querySelectorAll(CONTROLS)].filter((el) => isBlank(computeAccessibleName(el))),
  );
  // Read after the titles are back, so a failure shows the tooltip too.
  return nameless.map((el) => el.outerHTML);
}
