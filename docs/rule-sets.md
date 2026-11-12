# Built-in rule sets

A built-in rule set is data the app ships in place of code: rows of effects
that stand in for the engine's hard-coded mechanics tables. Today it holds one
part, `curated`, which stands in for `CURATED` (`src/engine/curated/curatedEffects.ts`).
The files live in `src/rules/`, and no rows have moved yet: this is the format,
the loader and the seam they plug into. (Source of truth: `readRuleSet` and
`mechanicsOf` in `src/engine/effects/mechanics.ts`, `src/data5e/builtInRules.ts`.)

## A file

```jsonc
{
  "type": "ruleSet",
  "v": 1,                      // the Cast Guidance version, as a rule pack's
  "name": "Built-in rules",
  "edition": "both",           // "2014", "2024" or "both"; optional
  "rows": [
    {
      "part": "curated",                // the code table it stands in for
      "keys": ["stunning strike|monk"], // the keys it is found under
      "scan": "replace",                // or "keep"; "replace" when absent
      "effects": [ /* the stored effects a rule pack's patch holds */ ]
    }
  ]
}
```

- **`keys`** are the keys the code table uses, matched without case. A key
  already taken by an earlier row of the same part in the same file is left
  out, and the reader says so.
- **`scan`**: `replace` turns the prose scan off for the entry, as a `CURATED`
  row does; `keep` runs the scan beside the row.
- **`effects`** read exactly as a rule pack's (`readStoredEffects`), formulas
  and `while` included.
- A row the reader cannot read is left out, and the rest still count. What it
  left out goes to the console once, not the sheet: the files are the app's, so
  a problem in one is a bug its tests catch, not something a player can fix.
- At most 5,000 rows a file and 16 keys a row (`RULE_SET_LIMITS`).

## Keys by call site

| Call site | Key | Example |
| --- | --- | --- |
| Class or subclass feature | `name\|class` for each name and class or subclass label tried | `stunning strike\|monk` |
| Class row | `class:` and the class uid | `class:monk\|phb` |
| Feat | its uid, then the uid of the feat it copies | `alert\|phb` |
| Optional feature | its uid, then the uid of the one it copies | `defense\|phb` |
| Race trait | `trait:` and the trait name | `trait:relentless endurance` |

The first key with a row wins, in the order the call site tried `CURATED`, and
across both tables: while rows are moving, a `CURATED` row under an earlier key
is still the one read (`inCode`). Items have no keys yet, and a subclass has no
row of its own.

## Where a row sits

A row is the curated row of the entry it is found for (layer 3 of the seam,
ADR-001), so it keeps every rule a `CURATED` row has:

1. A player's rule pack patch that replaces the entry wins over it; a pack's
   `add` sits beside it.
2. The entry's own `castGuidance` comes first; its `drop` reaches the row's
   effects, and its `replace: true` leaves the row out.
3. The row is emitted in place of `CURATED`, with the entry's own origin
   object, which spend links find actions by. The rest of layer 3 (standing
   rows, roll tables, spend links) runs as before.

A later file's row wins over an earlier one's under the same part and key.

## Loading

Each file is a dynamic `import()` listed in `src/data5e/builtInRules.ts`, so the
build gives it a chunk of its own, `assets/rule-set-*.js` (`chunkFileNames` in
`vite.config.ts`). The service worker precaches it like any other chunk, so it
works offline, and the bundle budget measures it on a line of its own
(`rulesBytes`, `rulesGzipBytes`). The registry loads them beside the release
and hands them to every engine context (`byType('ruleSet')`).

If a file fails to load, none counts and every sheet says so ("The built-in
rules did not load ... Reload to try again"). A reload always tries again; the
next registry build in the same page does too, though a browser may keep the
failed chunk until the page reloads.

A built-in formula never spends the player's per-derive formula budget, so the
rows the app ships cannot crowd out a player's pack.

## Adding a file

Add it under `src/rules/` and list it in `FILES` in `builtInRules.ts`; the tests
fail on a file not listed. They also fail on a row the reader leaves anything
out of, and on a `curated` key that `CURATED` still has (the row would never be
the one read, or the code row would be dead).

## Checking a change on real data

`scripts/rules-diff.ts` derives about 8,500 builds over the pinned release
(every class and subclass across levels in both editions, every feat, race,
background, optional feature and magic item, and some multiclasses) and
records a hash of each sheet field. Moving rows out of code must change none:

```bash
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts snapshot --release <cache.json> --out before.json
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts snapshot --release <cache.json> --out after.json
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts compare before.json after.json --expect-zero
```

`--release` caches the release in that file on the first run, so both sides
read the same data. Take `before.json` in a checkout of the base commit (with
this script copied in when the base has none). `compare` names the builds that
changed, field by field, and with `--expect-zero` exits 1 when any did.
