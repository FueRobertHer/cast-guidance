import type { DiceRollDetail, RollResult } from './types';

/** A run of a roll's working: its text, and whether it is a die that was dropped. */
export interface RollDetailPart {
  text: string;
  dropped?: boolean;
}

/** A die group: "d20 [17, 4]", named by how many dice count, so "2d6 [4, 5]". */
function diceParts(term: DiceRollDetail): RollDetailPart[] {
  const kept = term.rolls.filter((r) => r.kept).length;
  const parts: RollDetailPart[] = [{ text: `${kept === 1 ? '' : kept}d${term.sides} [` }];
  term.rolls.forEach((r, i) => {
    if (i > 0) parts.push({ text: ', ' });
    parts.push(r.kept ? { text: String(r.v) } : { text: String(r.v), dropped: true });
  });
  parts.push({ text: ']' });
  return parts;
}

/**
 * The working of a roll, as "d20 [17, 4] advantage + 3": every die face in
 * order, the dropped ones marked, the mode that rolled the second d20 in words,
 * then the flat modifiers with a true minus. Shown under the total in both the
 * toast and the tray's history (`ui/RollDetail`), which is why it lives here
 * rather than in either of them.
 */
export function rollDetail(result: RollResult): RollDetailPart[] {
  const parts: RollDetailPart[] = [];
  const mode = result.meta?.advantage;
  result.terms.forEach((t, i) => {
    if (t.kind === 'dice') {
      const sign = t.sign < 0 ? '− ' : i > 0 ? '+ ' : '';
      parts.push({ text: `${i > 0 ? ' ' : ''}${sign}` }, ...diceParts(t));
      // Adv mode reaches every roll of the tray, and changes only a lone d20.
      if (i === 0 && mode !== undefined && t.sides === 20 && t.rolls.length > 1) {
        parts.push({ text: mode === 'adv' ? ' advantage' : ' disadvantage' });
      }
    } else if (t.kind === 'multiplier') {
      parts.push({ text: ' × ' });
      parts.push(...(t.detail.kind === 'dice' ? diceParts(t.detail) : [{ text: String(t.value) }]));
    } else if (t.value !== 0 || i === 0) {
      // "+ 0" says nothing, and most of a level 1 sheet's modifiers are it.
      const sign = t.value < 0 ? '−' : '+';
      parts.push({ text: `${i > 0 ? ' ' : ''}${sign} ${Math.abs(t.value)}` });
    }
  });
  return parts.filter((p) => p.text !== '');
}
