import type { Collector } from '../effects/base';
import { num } from '../effects/base';
import type { CharacterDoc, DerivedValue, EffectInput } from '../types';
import { effectsOf, withOverride } from './core';

export function calcMaxHp(
  doc: CharacterDoc,
  col: Collector,
  effects: readonly EffectInput[],
  conMod: number,
): { maxHp: DerivedValue; hitDice: Record<string, number>; totalLevel: number } {
  const parts: Array<{ label: string; amount: number }> = [];
  const hitDice: Record<string, number> = {};
  let totalLevel = 0;

  doc.classes.forEach((entry, classIndex) => {
    const cls = col.ctx.get('class', entry.ref.name, entry.ref.source);
    const hd = (cls?.hd ?? {}) as { number?: number; faces?: number };
    const faces = num(hd.faces) ?? 8;
    const die = `d${faces}`;
    hitDice[die] = (hitDice[die] ?? 0) + entry.levels;
    totalLevel += entry.levels;

    const method = doc.hpMethod ?? 'average';
    let classHp = 0;
    for (let lvl = 0; lvl < entry.levels; lvl++) {
      const isVeryFirstLevel = classIndex === 0 && lvl === 0;
      const rolled = entry.hp[lvl];
      if (isVeryFirstLevel || method === 'max') {
        classHp += faces; // level 1 is always the max die; 'max' rule applies it throughout
      } else if (method === 'rolled' && typeof rolled === 'number') {
        classHp += Math.max(1, Math.min(faces, rolled));
      } else {
        classHp += Math.floor(faces / 2) + 1; // average, rounded up
      }
    }
    parts.push({ label: `${entry.ref.name} levels (${die}, ${method})`, amount: classHp });
  });

  if (totalLevel > 0 && conMod !== 0) {
    parts.push({ label: 'CON modifier × level', amount: conMod * totalLevel });
  }
  for (const e of effectsOf(effects, 'hpPerLevel')) {
    parts.push({ label: `${e.origin.label} × level`, amount: e.amount * totalLevel });
  }

  const base = Math.max(
    totalLevel > 0 ? 1 : 0,
    parts.reduce((s, p) => s + p.amount, 0),
  );
  return {
    maxHp: withOverride({ value: base, base, overridden: false, parts }, doc.overrides.maxHp),
    hitDice,
    totalLevel,
  };
}
