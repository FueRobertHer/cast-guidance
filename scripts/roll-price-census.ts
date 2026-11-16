/**
 * What the roll prompt offers for each paid die or bonus and each reroll a
 * build's features give, and what paying takes, to prove a move between code
 * and data changes no price (rule pack port phase 3; `docs/rule-sets.md`). A
 * paid extra is priced as the Use of its feature's action (`pricedRollEffects`),
 * and that action's cost often comes from a spend link (`SPEND_LINKS`, a
 * built-in `spend` row): drop the link and the prompt offers nothing. The price
 * is worked out in the prompt, not on the sheet, so `rules-diff.ts` sees it only
 * through the actions it hashes, on fewer builds.
 *
 *   bun --tsconfig-override=tsconfig.app.json scripts/roll-price-census.ts snapshot \
 *     --release <release.json> --out <census.json>
 *   bun --tsconfig-override=tsconfig.app.json scripts/roll-price-census.ts compare \
 *     <a.json> <b.json> [--expect-zero]
 *
 * Builds: every class and subclass at level 20 in its own rules version, the
 * other one, and with the optional class features on; each later usable option
 * of each feature pick in its own version; every optional feature in up to two
 * hosts at 20; every feat on a Fighter 4 and a Wizard 20; every race and
 * subrace on a Fighter 5. Each rider is priced alone, with no use spent, the
 * turn fresh and Inspiration held, so a price is offered whenever the sheet
 * names one. The release is cached in `--release` as `rules-diff.ts` caches it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { withBuiltInRules } from '../src/data5e/builtInRules';
import { DATA_TAG } from '../src/data5e/config';
import type { Entity } from '../src/data5e/copyMod';
import { engineContextFor } from '../src/data5e/engineAdapter';
import { normalizeDataset } from '../src/data5e/normalize';
import { editionOf } from '../src/data5e/rulesVersion';
import { deriveSheet } from '../src/engine/derive';
import type { RollEffects } from '../src/engine/playRules';
import {
  type CharacterDoc,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
} from '../src/engine/types';
import { pricedRollEffects } from '../src/features/sheet/rollPrice';
import { fetchRelease } from './data-release';

/** Per build with a paid or reroll rider: each rider and what the prompt offers for it. */
type Census = Record<string, string[]>;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    release: { type: 'string' },
    out: { type: 'string' },
    'expect-zero': { type: 'boolean', default: false },
  },
});

// ---------------------------------------------------------------- compare

function compare(aPath: string, bPath: string): number {
  const a = JSON.parse(readFileSync(aPath, 'utf8')) as Census;
  const b = JSON.parse(readFileSync(bPath, 'utf8')) as Census;
  const onlyA = Object.keys(a).filter((id) => !(id in b));
  const onlyB = Object.keys(b).filter((id) => !(id in a));
  const changed = Object.keys(a).filter(
    (id) => id in b && JSON.stringify(a[id]) !== JSON.stringify(b[id]),
  );
  const rows = (c: Census) => Object.values(c).reduce((n, r) => n + r.length, 0);
  console.log(`builds with a priced rider: ${Object.keys(a).length} and ${Object.keys(b).length}`);
  console.log(`riders: ${rows(a)} and ${rows(b)}`);
  console.log(
    `changed: ${changed.length}; only in the first: ${onlyA.length}; only in the second: ${onlyB.length}`,
  );
  for (const id of onlyA.slice(0, 20)) console.log(`  only first: ${id}`);
  for (const id of onlyB.slice(0, 20)) console.log(`  only second: ${id}`);
  for (const id of changed.slice(0, 20)) {
    const before = new Set(a[id]);
    const after = new Set(b[id]);
    console.log(`  ${id}`);
    for (const r of a[id] ?? []) if (!after.has(r)) console.log(`    - ${r}`);
    for (const r of b[id] ?? []) if (!before.has(r)) console.log(`    + ${r}`);
  }
  return changed.length + onlyA.length + onlyB.length;
}

// ---------------------------------------------------------------- snapshot

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const refOf = (e: Entity): EntityRef => ({ name: str(e.name), source: str(e.source) });
const uidOf = (r: EntityRef) => `${r.name}|${r.source}`;

async function releaseFiles(file: string): Promise<Map<string, unknown>> {
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(Object.fromEntries((await fetchRelease(DATA_TAG)).files)));
  }
  return new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>));
}

function baseDoc(edition: '2014' | '2024'): CharacterDoc {
  const doc = newCharacterDoc('roll-price-census', 'Roll price census', DATA_TAG);
  doc.rulesVersion = edition;
  doc.abilities = {
    method: 'manual',
    base: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
  } as CharacterDoc['abilities'];
  return doc;
}

interface FeaturePick {
  id: string;
  count: number;
  options: string[];
}

/** As `rules-diff.ts` does: answer every open prompt with its first usable options. */
function settle(doc: CharacterDoc, ctx: EngineContext, picks: FeaturePick[] = []): DerivedSheet {
  let sheet = deriveSheet(doc, ctx);
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const p of sheet.pending) {
      if (doc.choices[p.id] !== undefined || p.options.length === 0) continue;
      const usable = p.options.filter((o) => o.disabled === undefined);
      const pool = usable.length > 0 ? usable : p.options;
      const n = Math.max(1, Math.min(p.count, pool.length));
      if (p.kind === 'feature' && usable.length > n) {
        picks.push({ id: p.id, count: n, options: usable.map((o) => o.id) });
      }
      doc.choices[p.id] = pool.slice(0, n).map((o) => o.id);
      changed = true;
    }
    if (!changed) break;
    sheet = deriveSheet(doc, ctx);
  }
  return sheet;
}

/** One rider as the roll prompt gets it (`rollEffects`), alone. */
function ridersOf(r: DerivedSheet['rollRiders'][number]): RollEffects | undefined {
  const base: RollEffects = {
    dice: [],
    offers: [],
    advantage: [],
    disadvantage: [],
    test: 'check',
  };
  if (r.kind === 'paid') {
    const { kind: _kind, on: _on, origin, effectId: _effectId, ...rest } = r;
    return { ...base, paid: [{ source: origin, ...rest }] };
  }
  if (r.kind === 'reroll') {
    const { kind: _kind, on: _on, origin, effectId: _effectId, ...rest } = r;
    return { ...base, rerolls: [{ source: origin, ...rest }] };
  }
  return undefined;
}

/** Each paid or reroll rider of a sheet, and what the prompt offers for it. */
function prices(sheet: DerivedSheet, doc: CharacterDoc): string[] {
  const play = { ...doc.play, inspiration: true };
  const out: string[] = [];
  for (const r of sheet.rollRiders) {
    const riders = ridersOf(r);
    if (riders === undefined) continue;
    const { dice: _dice, test: _test, ...priced } = pricedRollEffects(riders, sheet, play);
    const offered = Object.fromEntries(
      Object.entries(priced).filter(([, v]) => !Array.isArray(v) || v.length > 0),
    );
    out.push(
      `${r.kind} ${r.origin} on ${JSON.stringify(r.on)}: ${
        Object.keys(offered).length > 0 ? JSON.stringify(offered) : 'not offered'
      }`,
    );
  }
  return out;
}

async function snapshot(): Promise<void> {
  if (values.release === undefined || values.out === undefined) {
    console.error('Usage: roll-price-census.ts snapshot --release <release.json> --out <file>');
    process.exit(1);
  }
  const reg = normalizeDataset(await releaseFiles(values.release));
  await withBuiltInRules(reg);
  if (reg.ruleSetsFailed) throw new Error('The built-in rule sets did not load.');
  const ctx = engineContextFor(reg, {});
  const census: Census = {};
  let builds = 0;
  let threw = 0;

  const one = (id: string, doc: CharacterDoc, picks?: FeaturePick[]): void => {
    builds++;
    let sheet: DerivedSheet;
    try {
      sheet = settle(doc, ctx, picks);
    } catch (err) {
      threw++;
      census[id] = [`throws ${String(err).slice(0, 200)}`];
      return;
    }
    const rows = prices(sheet, doc);
    if (rows.length > 0) census[id] = rows;
  };

  const edition = (e: Entity) => editionOf(e);
  const classes = reg.byType('class');
  const subclasses = reg.byType('subclass');
  for (const cls of classes) {
    const own = edition(cls);
    const ref = refOf(cls);
    const subs = subclasses.filter(
      (s) =>
        str(s.className).toLowerCase() === ref.name.toLowerCase() &&
        str(s.classSource).toLowerCase() === ref.source.toLowerCase(),
    );
    for (const sub of [undefined, ...subs]) {
      const subRef = sub === undefined ? undefined : refOf(sub);
      const id = `class ${uidOf(ref)} / ${subRef ? uidOf(subRef) : '-'}`;
      for (const [version, optional] of [
        [own, false],
        [own === '2014' ? '2024' : '2014', false],
        [own, true],
      ] as const) {
        const doc = baseDoc(version);
        doc.classes = [{ ref, ...(subRef ? { subclass: subRef } : {}), levels: 20, hp: [] }];
        if (optional) doc.optionalClassFeatures = true;
        const start = structuredClone(doc);
        const picks: FeaturePick[] = [];
        const at = `${id} @20 ${version}${optional ? ' [optional]' : ''}`;
        one(at, doc, picks);
        if (version !== own) continue;
        for (const pick of picks) {
          for (const option of pick.options.slice(pick.count)) {
            const others = pick.options.filter((o) => o !== option).slice(0, pick.count - 1);
            const branch = structuredClone(start);
            branch.choices[pick.id] = [option, ...others];
            one(`${at} | ${pick.id} = ${option}`, branch);
          }
        }
      }
    }
  }

  for (const of of reg.byType('optionalfeature')) {
    const types = Array.isArray(of.featureType) ? of.featureType.map(String) : [];
    const uid = uidOf(refOf(of)).toLowerCase();
    let hosts = 0;
    for (const host of [...classes, ...subclasses]) {
      if (hosts >= 2) break;
      const progressions = Array.isArray(host.optionalfeatureProgression)
        ? (host.optionalfeatureProgression as Array<{ featureType?: unknown }>)
        : [];
      for (const prog of progressions) {
        const offered = Array.isArray(prog.featureType) ? prog.featureType.map(String) : [];
        if (!types.some((t) => offered.includes(t))) continue;
        const isSub = host.className !== undefined;
        const cls = isSub
          ? classes.find(
              (c) => str(c.name) === str(host.className) && str(c.source) === str(host.classSource),
            )
          : host;
        if (cls === undefined) continue;
        const clsRef = refOf(cls);
        const subRef = isSub ? refOf(host) : undefined;
        const doc = baseDoc(edition(cls));
        doc.classes = [
          { ref: clsRef, ...(subRef ? { subclass: subRef } : {}), levels: 20, hp: [] },
        ];
        const idBase = subRef
          ? `subclass:${uidOf(subRef).toLowerCase()}`
          : `class:${uidOf(clsRef).toLowerCase()}`;
        doc.choices[`${idBase}:optfeature:${offered.join('+')}`] = [uid];
        one(`optfeature ${uid} in ${uidOf(clsRef)}${subRef ? ` / ${uidOf(subRef)}` : ''}`, doc);
        hosts++;
        break;
      }
    }
  }

  const classOf = (name: string, version: '2014' | '2024', levels: number) => ({
    ref: { name, source: version === '2024' ? 'XPHB' : 'PHB' },
    levels,
    hp: [],
  });
  for (const f of reg.byType('feat')) {
    const version = edition(f);
    for (const [name, levels] of [
      ['Fighter', 4],
      ['Wizard', 20],
    ] as const) {
      const doc = baseDoc(version);
      doc.classes = [classOf(name, version, levels)];
      doc.feats = [{ ref: refOf(f), instanceId: 'roll-price-census' }];
      one(`feat ${uidOf(refOf(f))} on ${name} ${levels}`, doc);
    }
  }
  for (const race of reg.byType('race')) {
    const doc = baseDoc(edition(race));
    doc.classes = [classOf('Fighter', edition(race), 5)];
    doc.race = refOf(race);
    one(`race ${uidOf(refOf(race))}`, doc);
  }
  for (const sr of reg.byType('subrace')) {
    const race = reg.get('race', str(sr.raceName), str(sr.raceSource));
    if (race === undefined) continue;
    const doc = baseDoc(edition(race));
    doc.classes = [classOf('Fighter', edition(race), 5)];
    doc.race = refOf(race);
    doc.subrace = refOf(sr);
    one(`subrace ${uidOf(refOf(sr))} of ${uidOf(refOf(race))}`, doc);
  }

  const rows = Object.values(census).flat();
  const sources = (match: (row: string) => boolean) =>
    new Set(rows.filter(match).map((r) => r.slice(0, r.indexOf(' on ')))).size;
  writeFileSync(values.out, JSON.stringify(census, null, 1));
  console.log(
    `builds: ${builds}; threw: ${threw}; with a priced rider: ${Object.keys(census).length}`,
  );
  console.log(
    `riders: ${rows.length}; sources offered: ${sources((r) => !r.endsWith('not offered'))}; sources not offered: ${sources((r) => r.endsWith('not offered'))}`,
  );
}

if (positionals[0] === 'compare') {
  const [, a, b] = positionals;
  if (a === undefined || b === undefined) {
    console.error('Usage: roll-price-census.ts compare <a.json> <b.json> [--expect-zero]');
    process.exit(1);
  }
  const differences = compare(a, b);
  if (values['expect-zero'] && differences > 0) process.exit(1);
} else if (positionals[0] === 'snapshot') {
  await snapshot();
} else {
  console.error('Usage: roll-price-census.ts snapshot|compare ...');
  process.exit(1);
}
