import type { DiceRollDetail, RollResult } from './types';

/** A run of a roll's working: its text, and whether it is a die that was dropped. */
export interface RollDetailPart {
  text: string;
  dropped?: boolean;
}

/**
 * A die group: "d20 [17, 4]", named by how many dice count, so "2d6 [4, 5]".
 * Dice a critical hit set to their maximum (the max-then-roll house rule) say
 * so before the ones rolled: "2d8 [max 8; rolled 3]".
 */
function diceParts(term: DiceRollDetail): RollDetailPart[] {
  const kept = term.rolls.filter((r) => r.kept).length;
  const maxed = term.maxed ?? 0;
  const parts: RollDetailPart[] = [
    { text: `${kept === 1 ? '' : kept}d${term.sides} [${maxed > 0 ? 'max ' : ''}` },
  ];
  term.rolls.forEach((r, i) => {
    if (i > 0) parts.push({ text: maxed > 0 && i === maxed ? '; rolled ' : ', ' });
    parts.push(r.kept ? { text: String(r.v) } : { text: String(r.v), dropped: true });
  });
  parts.push({ text: ']' });
  return parts;
}

/**
 * The working of a roll, as "d20 [17, 4] advantage + 3": every die face in
 * order, the dropped ones marked, the mode that rolled the second d20 in words,
 * then the flat modifiers with a true minus, and a die an effect added named
 * for it. Shown under the total in both the
 * toast and the tray's history (`ui/RollDetail`), which is why it lives here
 * rather than in either of them.
 */
export function rollDetail(result: RollResult): RollDetailPart[] {
  const parts: RollDetailPart[] = [];
  const mode = result.meta?.advantage;
  // A critical hit doubling the total (a house rule) brackets what it doubles,
  // so "(d12 [9] + 4) × 2" never reads as 9 + 8; dice added after it (Savage
  // Attacks) stay outside, undoubled.
  const doubled =
    result.meta?.critRule === 'doubleTotal'
      ? result.terms.findLastIndex((t) => t.kind === 'multiplier')
      : -1;
  if (doubled > 0) parts.push({ text: '(' });
  result.terms.forEach((t, i) => {
    if (i === doubled) parts.push({ text: ')' });
    if (t.kind === 'dice') {
      const sign = t.sign < 0 ? '− ' : i > 0 ? '+ ' : '';
      parts.push({ text: `${i > 0 ? ' ' : ''}${sign}` }, ...diceParts(t));
      // A die an effect added says whose it is: "+ d4 [3] Bless".
      const from = result.meta?.from?.find((f) => f.term === i);
      if (from !== undefined) parts.push({ text: ` ${from.source}` });
      // Adv mode reaches every roll of the tray, and changes only a lone d20.
      if (i === 0 && mode !== undefined && t.sides === 20 && t.rolls.length > 1) {
        parts.push({ text: mode === 'adv' ? ' advantage' : ' disadvantage' });
      }
      // What rerolled the d20, whose dice set aside show dropped: "Luck reroll".
      const rerolled = i === 0 ? (result.meta?.rerolled ?? []) : [];
      if (rerolled.length > 0) parts.push({ text: ` ${rerolled.join(', ')} reroll` });
    } else if (t.kind === 'multiplier') {
      parts.push({ text: ' × ' });
      parts.push(...(t.detail.kind === 'dice' ? diceParts(t.detail) : [{ text: String(t.value) }]));
    } else if (t.value !== 0 || i === 0) {
      // "+ 0" says nothing, and most of a level 1 sheet's modifiers are it.
      const sign = t.value < 0 ? '−' : '+';
      parts.push({ text: `${i > 0 ? ' ' : ''}${sign} ${Math.abs(t.value)}` });
      // A bonus a feature added says whose it is too: "+ 10 Guided Strike".
      const from = result.meta?.from?.find((f) => f.term === i);
      if (from !== undefined) parts.push({ text: ` ${from.source}` });
    }
  });
  return parts.filter((p) => p.text !== '');
}
