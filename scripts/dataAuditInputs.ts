/**
 * Which files the data audit (`scripts/data-audit.ts`) depends on, so the
 * Data audit workflow can run it on exactly the PRs that could change its
 * verdict. The list used to be a hand-kept pattern in the workflow, and it
 * fell behind: it missed the built-in rule data in `src/rules/` and about a
 * dozen engine files the audit imports.
 *
 * The inputs are the audit's runtime import closure, followed the way Bun
 * runs it: static imports and re-exports, `import()` with a literal
 * specifier, JSON included, `import type` and `export type` left out (they
 * are erased before the code runs). Specifiers resolve with the app's own
 * compiler options, so the `@/` alias works. Packages are not followed: their
 * versions live in `package.json` and `bun.lock`, which {@link ALWAYS_INPUTS}
 * covers along with the files the audit reads at run time.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** The audit's entry point, relative to the repository root. */
export const AUDIT_ENTRY = 'scripts/data-audit.ts';

/**
 * Inputs that are not imports: the workflow itself, the files the audit and
 * the judge read or write (`scripts/data-audit-budget.json`,
 * `scripts/data-judgments.json`), this file and its CLI, the toolchain, and
 * the compiler options the closure resolves with.
 */
export const ALWAYS_INPUTS: readonly RegExp[] = [
  /^\.github\/workflows\/data-audit\.yml$/,
  /^scripts\/data-/,
  /^scripts\/dataAuditInputs(\.test)?\.ts$/,
  /^package\.json$/,
  /^bun\.lock$/,
  /^\.bun-version$/,
  /^tsconfig(\.app)?\.json$/,
];

const toPosix = (p: string) => p.split(path.sep).join('/');

/** Compiler options for resolution: the app's, which hold the `@/` alias. */
function resolutionOptions(root: string): ts.CompilerOptions {
  const configPath = path.join(root, 'tsconfig.app.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  }
  return ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath).options;
}

/** The runtime module specifiers in one source file, in source order. */
export function runtimeSpecifiers(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        specs.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specs.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

/** Bare package names and `node:` builtins, which the closure does not follow. */
const isPackage = (spec: string) => !spec.startsWith('.') && !spec.startsWith('@/');

/**
 * Every repository file the audit's code is made of, relative to `root` with
 * forward slashes, sorted. Throws when a relative or `@/` specifier does not
 * resolve: a gap in the closure would read as "the audit does not depend on
 * this" and skip the audit, so it must fail loudly instead.
 */
export function auditInputs(root: string, entry: string = AUDIT_ENTRY): string[] {
  const options = resolutionOptions(root);
  const seen = new Set<string>();
  const queue = [path.resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.json')) continue;
    for (const spec of runtimeSpecifiers(file, readFileSync(file, 'utf8'))) {
      if (isPackage(spec)) continue;
      let resolved: string | undefined;
      if (spec.endsWith('.json')) {
        resolved = path.resolve(path.dirname(file), spec);
      } else {
        resolved = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule
          ?.resolvedFileName;
      }
      if (!resolved || !ts.sys.fileExists(resolved)) {
        throw new Error(`${toPosix(path.relative(root, file))}: cannot resolve "${spec}"`);
      }
      queue.push(path.resolve(resolved));
    }
  }
  return [...seen].map((f) => toPosix(path.relative(root, f))).sort();
}

/** The changed files that can change the audit's result. */
export function auditTouches(changed: readonly string[], inputs: ReadonlySet<string>): string[] {
  return changed.filter((f) => inputs.has(f) || ALWAYS_INPUTS.some((re) => re.test(f)));
}
