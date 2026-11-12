import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULE_SET_TYPE } from '@/engine/castGuidance';
import { CURATED } from '@/engine/curated/curatedEffects';
import { readRuleSet } from '@/engine/effects/mechanics';
import { BUILT_IN_RULE_SETS } from '../../tests-fixtures/testWorld';
import { attachBuiltInRules, loadBuiltInRules, withBuiltInRules } from './builtInRules';
import { engineContextFor } from './engineAdapter';
import { EntityRegistry } from './normalize';

const RULES_DIR = path.resolve(__dirname, '../rules');

function shippedFiles(dir = RULES_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? shippedFiles(path.join(dir, d.name))
      : d.name.endsWith('.json')
        ? [path.join(dir, d.name)]
        : [],
  );
}

describe('the built-in rule sets', () => {
  it('loads every file under src/rules, once', async () => {
    const rules = await loadBuiltInRules();
    expect(rules.failed).toBe(false);
    const files = shippedFiles().map((f) => JSON.parse(readFileSync(f, 'utf8')) as unknown);
    expect(files.length).toBeGreaterThan(0);
    expect(rules.sets).toHaveLength(files.length);
    for (const file of files) expect(rules.sets).toContainEqual(file);
    expect(await loadBuiltInRules()).toBe(rules);
    // The test world holds the same sets, so tests read the rows the app reads.
    expect(BUILT_IN_RULE_SETS).toEqual(rules.sets);
  });

  it('reads each one with nothing left out', async () => {
    for (const set of (await loadBuiltInRules()).sets) {
      const read = readRuleSet(set);
      expect({ name: read.name, problems: read.problems }).toEqual({
        name: read.name,
        problems: [],
      });
    }
  });

  it('keeps no curated row also in CURATED, which it stands in for', async () => {
    const keys = (await loadBuiltInRules()).sets.flatMap((set) =>
      readRuleSet(set).rows.flatMap((r) => (r.part === 'curated' ? r.keys : [])),
    );
    expect(keys.filter((k) => Object.hasOwn(CURATED, k))).toEqual([]);
  });

  it('reach the engine through the registry', async () => {
    const reg = await withBuiltInRules(new EntityRegistry());
    const ctx = engineContextFor(reg, {});
    expect(ctx.byType(RULE_SET_TYPE)).toEqual((await loadBuiltInRules()).sets);
    expect(ctx.ruleSetsFailed).toBeUndefined();
    // Not content: no list of a content type holds them.
    expect(reg.byType('feat')).toEqual([]);
  });

  it('tells the engine when they did not load', () => {
    const reg = new EntityRegistry();
    attachBuiltInRules(reg, { sets: [], failed: true });
    const ctx = engineContextFor(reg, {});
    expect(ctx.ruleSetsFailed).toBe(true);
    expect(ctx.byType(RULE_SET_TYPE)).toEqual([]);
  });
});
