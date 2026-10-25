<!-- Keep this short. Delete sections that don't apply. -->

## What & why

<!-- One or two sentences. Link the FUTURE_WORK item id if there is one (e.g. REL-003). -->

## How it was verified

<!-- Tick what you actually ran. CI runs all of these on push. -->

- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] Manual/browser check (describe below)
- [ ] DATA_TAG bump or parser change: the `Data audit` workflow is green, and `scripts/data-audit-budget.json` has the new or updated entry (`bun run data:audit -- --write-budget`)

## Notes for the reviewer

<!-- Trade-offs, follow-ups, anything intentionally out of scope. -->
