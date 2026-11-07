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
    expect(durationOf('cx-snap 2.4s cubic-bezier(0.3, 0, 0.2, 1) infinite')).toBe(2400);
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
    for (const part of ['cx-mat', 'cx-over', 'cx-p', 'cx-tag', 'cx-strip']) {
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

  it('holds Restrained’s chains to the edges, clear of the number on the smallest chip', () => {
    // A chain is 8px tall at 80%, which ink could not read over. On the 34px chip
    // the digits sit in the middle 14px, so each chain stays within 10px of its
    // edge, and further from the number with larger text and on taller controls.
    const rule = (selector: string) =>
      new RegExp(`^${selector} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? '';
    const px = (body: string, pattern: RegExp) => Number(pattern.exec(body)?.[1]);
    const upper = rule('\\.cx-chain');
    const lower = rule('\\.cx-chain2');
    const height = px(upper, /\bheight: (\d+)px/);
    expect(height).toBe(8);
    expect(px(upper, /\btop: (\d+)px/) + height).toBeLessThanOrEqual(10);
    expect(lower).toContain('top: auto');
    expect(px(lower, /\bbottom: (\d+)px/) + height).toBeLessThanOrEqual(10);
    // A taller cell has room for them a little further in, and no further.
    const cell = rule('\\.cx-at-cell \\.cx-chain');
    expect(px(cell, /\btop: (\d+)px/) + height).toBeLessThanOrEqual(10);
  });

  it('rattles Restrained’s chains in place, and only in the moment of the jolt', () => {
    const shake = keyframes().get('cx-shake') as string;
    // Still until 63%, and stopped dead from 82%, as Paralyzed's jolt is.
    expect(shake).toMatch(/0%,\s*63%,\s*82%,\s*100% \{\s*transform: none;/);
    // At most 1.5px either way: they never travel.
    const moves = [...shake.matchAll(/\* (-?[\d.]+)px/g)].map((m) => Math.abs(Number(m[1])));
    expect(moves.length).toBeGreaterThan(0);
    expect(Math.max(...moves)).toBeLessThanOrEqual(1.5);
  });

  it('keeps Grappled’s moving pieces to its prongs, with its joint on the number’s line', () => {
    expect(CSS).toMatch(/^\.cx-prong \{[^}]*animation: cx-snap 2\.4s/m);
    // The joint is the cell's padding and half its stat line, in rem, so the claws
    // stay on the number at 200% text.
    expect(CSS).toMatch(/^\.cx-prong \{[^}]*top: calc\(1\.5rem - 1\.25rem\);/m);
    expect(CSS).toMatch(/^\.cx-prong \{[^}]*width: 44%;/m);
    // Their wrists hold still, and a wider or taller cell can't lift the number off them.
    expect(CSS).toMatch(/\.cx-mat > \.cx-grappled::before/);
    expect(CSS).toMatch(/:has\(\.cx-grappled\) \.cx-face \{\s*justify-content: flex-start;/);
  });

  it('moves only the number on a tile, which holds buttons of its own', () => {
    expect(CSS).toMatch(/^\.cx-at-tile \.cx-body-cower \{\s*scale: none;\s*animation: none;/m);
    expect(CSS).toMatch(/\.cx-body-cower,\s*\.cx-at-tile \.cx-body-cower \.cx-move \{/);
  });

  it('floods the whole card, and keeps the flash and the motion in its strip', () => {
    expect(CSS).toMatch(/^\.cx-at-card\.cx-arrive \.cx-strip > \.cx-mat \{\s*animation: none;/m);
    expect(CSS).toMatch(/^\.cx-strip > \.cx-mat > \.cx-layer \{\s*background: none;/m);
  });

  it('keeps a cell’s marks and tags inside it, because the stat strip clips', () => {
    for (const piece of ['cx-tag', 'cx-star', 'cx-z']) {
      const rule = new RegExp(`^\\.cx-at-cell \\.${piece} \\{\\s*top: ([\\d.]+)`, 'm').exec(CSS);
      expect(rule, piece).not.toBeNull();
      expect(Number(rule?.[1]), piece).toBeGreaterThan(0);
    }
  });

  it('parks Unconscious’s Z’s above a cell’s digits when they hold still', () => {
    // The digits start about 20px down a cell, at any text size. In a still pose
    // for good, a Z on them would sit in front of the number.
    const rule = (selector: string) =>
      new RegExp(`^${selector} \\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? '';
    const top = Number(/\btop: (\d+)px/.exec(rule('\\.cx-at-cell \\.cx-z'))?.[1]);
    const tallest = 11 * 1.2;
    for (const z of ['cx-z', 'cx-z2', 'cx-z3']) {
      const lift = /translate(?:Y\(|\(\d+px, )(-\d+)px\)/.exec(rule(`\\.cx-at-cell \\.${z}`))?.[1];
      expect(lift, z).toBeDefined();
      expect(top + Number(lift) + tallest, z).toBeLessThanOrEqual(17);
    }
  });

  it('hangs a tile’s tags off its corners, clear of a label that grows with the text', () => {
    expect(CSS).not.toMatch(/^\.cx-at-tile \.cx-(?:tag|more) \{/m);
  });

  it('gives Invisible’s ring the chip’s corners, through the layer it sits in', () => {
    const rule = (name: string) => new RegExp(`^\\.${name} \\{[^}]*border-radius: inherit;`, 'm');
    expect(CSS).toMatch(rule('cx-mat'));
    expect(CSS).toMatch(rule('cx-layer'));
    expect(CSS).toMatch(rule('cx-ghost'));
  });

  it('floods over its plain colour, but holds none under Invisible, which has no tint', () => {
    expect(CSS).toMatch(
      /^\.cx-arrive:not\(:has\(\.cx-invisible\)\) \.cx-face \{\s*background: var\(--cx-plain\);/m,
    );
    expect(CSS).not.toMatch(/^\.cx-arrive \.cx-face \{/m);
  });

  it('is roll blue when plain, unless a chip has its own tone or a surface its own ground', () => {
    expect(CSS).toMatch(/^\.cx \{\s*--cx-plain: var\(--cg-roll-soft\);/m);
    expect(CSS).toMatch(/^\.cx-tone-danger \{\s*--cx-plain: var\(--cg-danger-soft\);/m);
    expect(CSS).toMatch(/^\.cx-tone-heal \{\s*--cx-plain: var\(--cg-heal-soft\);/m);
    expect(CSS).toMatch(
      /\.cx-at-cast,\s*\.cx-at-save,\s*\.cx-at-cell,\s*\.cx-at-tile,\s*\.cx-at-card \{\s*--cx-plain: transparent;/,
    );
  });

  it('plays Prone’s fall when Prone arrived, not when something joins it', () => {
    expect(CSS).toMatch(/^\.cx-arrive\.cx-prone \.cx-body-fallen \{\s*animation: cx-fall/m);
    expect(CSS).not.toMatch(/^\.cx-arrive \.cx-body-fallen \{/m);
  });

  it('stops every piece and whatever moves when switched off in Settings', () => {
    expect(CSS).toMatch(
      /\.cx-still \.cx-strip,\s*\.cx-still \.cx-body-cower \.cx-move,\s*\.cx-still \.cx-p,\s*\.cx-still \.cx-liquid::before,\s*\.cx-still \.cx-face \{\s*animation: none;/,
    );
  });

  it('keeps Poisoned’s own box inside its control, with the wider wave a pseudo-element', () => {
    // axe reads a piece's box, clipped or not, as behind the next control's text.
    expect(CSS).toMatch(/^\.cx-liquid \{[^}]*\n\s*width: 100%;/m);
    expect(CSS).toMatch(/^\.cx-liquid::before \{[^}]*\n\s*width: 200%;/m);
    expect(CSS).toMatch(/\.cx-ig \.cx-liquid::before \{\s*animation: none;/);
  });
});
