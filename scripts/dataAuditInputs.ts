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
 * compiler options, so its `paths` aliases work. Packages are not followed: their
 * versions live in `package.json` and `bun.lock`, which {@link ALWAYS_INPUTS}
 * covers along with the files the audit reads at run time.
 */
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
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

/**
 * The runtime module specifiers in one source file, in source order. A load
 * the walk cannot follow (an `import()` or `require()` of a computed name,
 * `import.meta.glob`, `new URL(..., import.meta.url)`) throws: skipping it
 * would read as "the audit does not depend on this".
 */
export function runtimeSpecifiers(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  const refuse = (node: ts.Node, what: string): never => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    throw new Error(`${fileName}:${line + 1}: ${what} is not followed; load a literal path`);
  };
  const literalArgument = (call: ts.CallExpression, what: string) => {
    const arg = call.arguments[0];
    if (arg === undefined || !ts.isStringLiteralLike(arg)) return refuse(call, what);
    specs.push(arg.text);
  };
  const isImportMeta = (node: ts.Node) =>
    ts.isMetaProperty(node) &&
    node.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === 'meta';
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
    if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (!node.isTypeOnly && ts.isExternalModuleReference(ref)) {
        if (!ts.isStringLiteralLike(ref.expression)) return refuse(node, 'an `import = require()`');
        specs.push(ref.expression.text);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        literalArgument(node, 'an `import()` of a computed name');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        literalArgument(node, 'a `require()` of a computed name');
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        isImportMeta(node.expression.expression)
      ) {
        refuse(node, `\`import.meta.${node.expression.name.text}()\``);
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const second = node.arguments?.[1];
      if (
        node.expression.text === 'URL' &&
        second !== undefined &&
        ts.isPropertyAccessExpression(second) &&
        isImportMeta(second.expression)
      ) {
        refuse(node, 'a file found with `new URL(..., import.meta.url)`');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

/** Node's builtins, which resolve to type declarations or not at all. */
const BUILTINS = new Set(builtinModules);
const isBuiltin = (spec: string) => spec.startsWith('node:') || BUILTINS.has(spec);

/**
 * Every repository file the audit's code is made of, relative to `root` with
 * forward slashes, sorted. Every specifier but a builtin resolves with the
 * app's compiler options (its `paths` aliases, JSON included); one that lands
 * in a package is not followed. One that does not resolve throws: a gap in
 * the closure would read as "the audit does not depend on this" and skip the
 * audit, so it must fail loudly instead.
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
    const where = toPosix(path.relative(root, file));
    for (const spec of runtimeSpecifiers(where, readFileSync(file, 'utf8'))) {
      if (isBuiltin(spec)) continue;
      const resolved = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule;
      if (resolved === undefined || !ts.sys.fileExists(resolved.resolvedFileName)) {
        throw new Error(`${where}: cannot resolve "${spec}"`);
      }
      const target = path.resolve(resolved.resolvedFileName);
      const inside = !path.relative(root, target).startsWith('..');
      if (resolved.isExternalLibraryImport || !inside) continue;
      queue.push(target);
    }
  }
  return [...seen].map((f) => toPosix(path.relative(root, f))).sort();
}

/** The changed files that can change the audit's result. */
export function auditTouches(changed: readonly string[], inputs: ReadonlySet<string>): string[] {
  return changed.filter((f) => inputs.has(f) || ALWAYS_INPUTS.some((re) => re.test(f)));
}
