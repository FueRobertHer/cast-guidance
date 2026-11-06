import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The rules chipFace.css promises in its header, held to the file itself. They
// are what makes reduced motion and the Settings switch land on the still pose,
// and what keeps a screen of afflicted chips cheap on a phone.

const CSS = readFileSync(path.join(import.meta.dirname, 'chipFace.css'), 'utf8');

/** Every `@keyframes`, by name, with its body. */
function keyframes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of CSS.matchAll(/@keyframes ([\w-]+) \{/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let end = start;
    while (depth > 0) {
      const ch = CSS[end];
      if (ch === undefined) throw new Error(`unclosed @keyframes ${m[1]}`);
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      end += 1;
    }
    found.set(m[1] as string, CSS.slice(start, end - 1));
  }
  return found;
}

/** Every `animation` shorthand in use, one entry each, leaving out `none`. */
const ANIMATIONS = [...CSS.matchAll(/\banimation:\s*([^;]+);/g)]
  .flatMap((m) => (m[1] as string).split(/,(?![^(]*\))/))
  .map((entry) => entry.trim())
  .filter((entry) => entry !== 'none');

const nameOf = (entry: string) => /\bcx-[\w-]+/.exec(entry)?.[0];

/** A CSS time in ms: "2.4s" as 2400. Rounded, as 2.4 * 1000 is not quite 2400. */
function ms(time: string): number {
  const value = Number.parseFloat(time);
  return Math.round(time.endsWith('ms') ? value : value * 1000);
}

const durationOf = (entry: string) => {
  const time = /(?<![\w.-])\d*\.?\d+m?s\b/.exec(entry)?.[0];
  if (time === undefined) throw new Error(`no duration in: ${entry}`);
  return ms(time);
};

describe('chipFace.css', () => {
  it('reads the file it means to: every kind of animation is found', () => {
    const names = ANIMATIONS.map(nameOf);
    expect(names).toEqual(
      expect.arrayContaining(['cx-slosh', 'cx-flood', 'cx-tremble', 'cx-fade']),
    );
    expect(keyframes().size).toBeGreaterThan(15);
    expect(ms('2.4s')).toBe(2400);
    expect(durationOf('cx-flood 480ms cubic-bezier(0.16, 1, 0.3, 1) both')).toBe(480);
    expect(durationOf('cx-strain 2.4s cubic-bezier(0.3, 0, 0.2, 1) infinite')).toBe(2400);
  });

  it('runs no loop with a fill, or it would freeze away from the still pose', () => {
    const loops = ANIMATIONS.filter((entry) => entry.includes('infinite'));
    expect(loops.length).toBeGreaterThan(10);
    expect(loops.filter((entry) => /\b(forwards|both)\b/.test(entry))).toEqual([]);
    expect(CSS).not.toContain('animation-fill-mode');
  });

  it('keeps every loop to whole 800ms beats, Frightened’s tremble aside', () => {
    const loops = ANIMATIONS.filter((entry) => entry.includes('infinite'));
    const off = loops.filter((entry) => durationOf(entry) % 800 !== 0).map(nameOf);
    expect(off).toEqual(['cx-tremble']);
    expect(durationOf(loops.find((entry) => nameOf(entry) === 'cx-tremble') as string)).toBe(130);
    // A longer band of fog sets only its duration.
    for (const m of CSS.matchAll(/animation-duration:\s*([^;]+);/g)) {
      expect(ms(m[1] as string) % 800, m[0]).toBe(0);
    }
  });

  it('plays each moment in the one time it has: 480ms, or 200ms to leave', () => {
    const moments = ANIMATIONS.filter((entry) => !entry.includes('infinite'));
    expect(moments.map((entry) => [nameOf(entry), durationOf(entry)]).sort()).toEqual([
      ['cx-fade', 200],
      ['cx-fall', 480],
      ['cx-flood', 480],
      ['cx-rise', 200],
      ['cx-surge', 480],
    ]);
  });

  it('animates only transform, opacity, translate and scale', () => {
    const allowed = new Set([
      'transform',
      'opacity',
      'translate',
      'scale',
      'animation-timing-function',
    ]);
    const others = [...keyframes()].flatMap(([name, body]) =>
      [...body.matchAll(/([a-z-]+)\s*:/g)]
        .map((m) => m[1] as string)
        .filter((property) => !allowed.has(property))
        .map((property) => `${name}: ${property}`),
    );
    expect(others).toEqual([]);
  });

  it('names only keyframes it has, and has none it does not use', () => {
    const used = new Set(ANIMATIONS.map(nameOf));
    for (const m of CSS.matchAll(/animation-name:\s*([\w-]+);/g)) used.add(m[1]);
    expect([...used].sort()).toEqual([...keyframes().keys()].sort());
  });

  it('lets a tap through every piece, the ones past the chip’s edge above all', () => {
    for (const part of ['cx-mat', 'cx-over', 'cx-p', 'cx-tag']) {
      const rule = new RegExp(`^\\.${part} \\{[^}]*pointer-events: none;`, 'm');
      expect(CSS, part).toMatch(rule);
    }
  });

  it('keeps two conditions apart, so their layers never stack behind the number', () => {
    const clipped = CSS.match(
      /^\.cx-two \.cx-mat > \.cx-layer(?: \+ \.cx-layer)? \{\s*clip-path:/gm,
    );
    expect(clipped).toHaveLength(2);
  });

  it('parks Paralyzed’s bolts clear of the number when they hold still', () => {
    // A bolt is 12px tall, and a bolt behind the digits for good would leave them
    // at 1.5:1. They stay at least 10px in from each edge of the 34px chip, and
    // further with larger text, so each bolt holds to its own edge.
    const rule = (name: string) =>
      new RegExp(`^\\.${name} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? '';
    const px = (body: string, pattern: RegExp) => Number(pattern.exec(body)?.[1]);
    const shift = /translateY\((-?\d+)px\)/;
    const upper = rule('cx-bolt');
    const lower = rule('cx-bolt2');
    expect(px(upper, /\btop: (-?\d+)px/) + px(upper, shift) + 12).toBeLessThanOrEqual(10);
    expect(lower).toContain('top: auto');
    expect(px(lower, /\bbottom: (-?\d+)px/) - px(lower, shift) + 12).toBeLessThanOrEqual(10);
  });

  it('gives Invisible’s ring the chip’s corners, through the layer it sits in', () => {
    const rule = (name: string) => new RegExp(`^\\.${name} \\{[^}]*border-radius: inherit;`, 'm');
    expect(CSS).toMatch(rule('cx-mat'));
    expect(CSS).toMatch(rule('cx-layer'));
    expect(CSS).toMatch(rule('cx-ghost'));
  });

  it('floods over plain blue, but holds no blue under Invisible, which has no tint', () => {
    expect(CSS).toMatch(
      /^\.cx-arrive:not\(:has\(\.cx-invisible\)\) \.cx-face \{\s*background: var\(--cg-roll-soft\);/m,
    );
    expect(CSS).not.toMatch(/^\.cx-arrive \.cx-face \{/m);
  });

  it('plays Prone’s fall when Prone arrived, not when something joins it', () => {
    expect(CSS).toMatch(/^\.cx-arrive\.cx-prone \.cx-body-fallen \{\s*animation: cx-fall/m);
    expect(CSS).not.toMatch(/^\.cx-arrive \.cx-body-fallen \{/m);
  });

  it('stops every piece and the face itself when switched off in Settings', () => {
    expect(CSS).toMatch(/\.cx-still \.cx-p,\s*\.cx-still \.cx-face \{\s*animation: none;/);
  });
});
