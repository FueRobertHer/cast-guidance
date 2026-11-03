import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// DS-001: Tailwind finds classes by scanning the source text, and a class
// written flush against an interpolation (`bg-scrim${extra}`) does not read
// as a class to it, so it never makes it into the stylesheet. That left the
// sheets' scrim transparent. A class in a className template ends at a space.
// (One flush after an interpolation, `${base}bg-scrim`, is found, unless
// another interpolation follows it.)

const SRC = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return sources(file);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [file] : [];
  });
}

/**
 * The source of each `className={…}` expression, to its matching brace, so
 * the text after a nested template is read too.
 */
function classExpressions(text: string): string[] {
  return [...text.matchAll(/className=\{/g)].map((m) => {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    return text.slice(start, i - 1);
  });
}

/**
 * A class-shaped token right before `${`, starting after a space, a
 * template's opening or another interpolation.
 */
const GLUED = /(?:^|[\s`}])([\w[\]().%/:!-]*[\w\])%])\$\{/;

describe('class names Tailwind can see (DS-001)', () => {
  it('never writes a class flush against an interpolation', () => {
    const glued = sources(SRC).flatMap((file) =>
      classExpressions(readFileSync(file, 'utf8')).flatMap((expression) => {
        const m = GLUED.exec(expression);
        return m === null ? [] : [`${path.relative(SRC, file)}: ${m[1]}\${`];
      }),
    );
    expect(glued).toEqual([]);
  });

  // Each shape as Tailwind's own scanner (@tailwindcss/oxide) reads it.
  it('catches the shapes Tailwind misses, and passes the ones it finds', () => {
    const missed = [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text to scan, not a template
      'className={`fixed inset-0 bg-scrim${className ? ` ${className}` : ""}`}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text to scan, not a template
      'className={`truncate${extra}`}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text to scan, not a template
      'className={`a ${on ? `b` : ""} text-bg${extra}`}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text to scan, not a template
      'className={`${base}bg-scrim${extra}`}',
    ];
    const found = [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text to scan, not a template
      'className={`fixed inset-0 bg-scrim ${extra}`}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text to scan, not a template
      'className={`${base}${className ? ` ${className}` : ""}`}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text to scan, not a template
      'className={`${base}bg-scrim`}',
    ];
    const caught = (source: string) => classExpressions(source).some((e) => GLUED.test(e));
    expect(missed.filter((s) => !caught(s))).toEqual([]);
    expect(found.filter(caught)).toEqual([]);
  });
});
