# Content and attribution notice

> **DRAFT for the owner's legal review, not legal advice.** This page describes
> what the app does with game content, as far as the code shows, and sets out
> options. It decides nothing. Whether any of it is permitted is a question for
> the owner and, where needed, counsel. Tracked in
> [#111](https://github.com/FueRobertHer/cast-guidance/issues/111) (LEGAL-001).

## Scope of the code license

Cast Guidance's original source code is released under the [MIT License](../LICENSE).
That license covers the code the owner wrote and nothing else. It does not grant
any right in:

- the book titles in `src/data5e/sourceNames.ts`;
- the names, terms and rules text in `src/engine/curated/curatedEffects.ts`;
- any game content the app downloads at runtime;
- any trademark, including "Dungeons & Dragons" and "D&D".

Bundled open source code keeps its own licenses, listed in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md), which is generated from the
production build (`bun run notices`).

## Where the game data comes from

The repository and the built app contain no compendium. The game data is
downloaded at runtime, on the user's device:

- **Source.** The 5etools dataset, from the community mirror
  [`5etools-mirror-3/5etools-src`](https://github.com/5etools-mirror-3/5etools-src).
- **Which release.** On a fresh install the app asks GitHub's API
  (`api.github.com/repos/5etools-mirror-3/5etools-src/tags`) for the mirror's
  release tags and installs the newest one compatible with this build (same major
  version as the build's `DATA_TAG`, see `isCompatibleTag` in
  `src/data5e/config.ts`). If the list does not arrive within
  `BOOT_TAG_RESOLVE_TIMEOUT_MS` (3 seconds), it installs `DATA_TAG` itself
  (`v2.32.0` today), which is the fallback, not a fixed pin. Later
  releases are offered as updates the user can accept or decline.
- **How.** Files come through jsDelivr
  (`cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-src@<tag>/data/`), with
  `raw.githubusercontent.com` as the fallback.
- **Where it is kept.** Only in the browser's IndexedDB on that device. The app
  has no server of its own that stores or serves the data.

**What the mirror contains.** The mirror republishes the text of published
books, including content that is not part of any System Reference Document
(SRD). The app fetches and displays whatever the installed release contains. It
does not filter to SRD content. Whether an app that fetches this material, as
opposed to hosting it, falls within the Wizards of the Coast Fan Content Policy,
or any other permission, is not settled by this draft and should be reviewed by
counsel.

## What does ship with the app

These are in the repository and in the built JavaScript, so they need a
decision even though the compendium does not ship:

- **Book titles.** `src/data5e/sourceNames.ts` maps about 180 5etools source codes
  to full book titles and a category (for example "Player's Handbook (2014)"), so
  source badges can render before any data has downloaded. Its header says it was
  generated from the mirror's `js/parser.js` at v2.33.3. That is not a mismatch
  with `DATA_TAG`: the app installs the newest compatible release, and an unknown
  code falls back to the bare abbreviation.
- **Curated mechanics.** `src/engine/curated/curatedEffects.ts` hand-codes the
  numbers of 46 common features whose values exist only in prose (for example
  Alert's +5 initiative, Lay on Hands as 5 times paladin level, Rage uses by
  level), with short notes that paraphrase what each feature grants. Some refer
  to non-SRD books by source code (for example TCE and XPHB). The file's own
  comment calls these "facts of the game rules"; that is the author's view, to be
  confirmed in review.
- **Descriptions.** The web app manifest and the README describe the app as a
  "D&D 5e character creator and play sheet".
- **Test fixtures** in `tests-fixtures/` are synthetic entities that only mimic
  the JSON schema; they contain no book text.

## User homebrew

Users can import 5etools-format homebrew from a file or from a URL they supply.
URL imports are limited to `raw.githubusercontent.com`,
`gist.githubusercontent.com` and `cdn.jsdelivr.net` (see
`src/features/homebrew/homebrewUrl.ts` and the CSP in `vercel.json`). The app
stores imported homebrew only on the device and does not publish it. The user who
imports a file is responsible for having the right to use it; a line saying so
could be added near the import controls.

## Trademark disclaimer (draft wording)

> Cast Guidance is unofficial fan software. It is not affiliated with, endorsed,
> sponsored or approved by Wizards of the Coast LLC. Dungeons & Dragons and D&D
> are trademarks of Wizards of the Coast LLC. Game data is downloaded at runtime
> from a third-party community mirror and is not part of this software or its
> license.

Where it could appear: the README, this page, and the About section in Settings.
If the owner adopts the Fan Content Policy, that policy prescribes its own notice
text, which would replace or extend this one.

## Options for the owner

1. **Rely on the Fan Content Policy.** Keep fetching the mirror and present the
   app as free, unofficial fan content with the policy's required notice. Open
   questions for counsel: whether the policy covers software that fetches
   republished book text, and whether the shipped titles and curated mechanics
   are fine under it.
2. **Restrict to an SRD.** Limit the data to SRD 5.1 or SRD 5.2, both released
   under CC-BY-4.0, which permits reuse with attribution. That needs a data
   source (or a filter) that contains only SRD content, the CC-BY-4.0
   attribution statement that each SRD specifies, and a review of the shipped
   titles and curated mechanics against the SRD.
3. **Keep the mirror as it is.** Change nothing in how data is fetched, add the
   trademark disclaimer, and accept the remaining risk knowingly.

These can be combined, for example an SRD-only default with the full mirror as
an explicit user choice; that is a product decision as much as a legal one.

## Owner checklist

Open on #111 until the owner signs off:

- [ ] Legal review of this notice and of the trademark disclaimer wording.
- [ ] Approve the short trademark line in the README ("Game data & copyright"),
      which is marked as draft wording until then.
- [ ] Choose the content approach: Fan Content Policy, SRD only, or the mirror as
      it is (or a combination).
- [ ] Decide whether the shipped book titles (`sourceNames.ts`) and curated
      mechanics (`curatedEffects.ts`) are acceptable.
- [ ] Settings says "Nothing ships with the app itself" under the game data
      section, but the book titles and curated mechanics do ship. Decide whether
      to reword it. (Not changed in this draft.)
- [ ] Settings says "Nothing is sent to a server", but `<Analytics />` from
      `@vercel/analytics` is always mounted in `src/app/AppShell.tsx` and sends
      page views to Vercel, including the page path, which contains the character
      id (`/c/<id>/...`). The data, release list and homebrew fetches also reach
      jsDelivr and GitHub. Decide whether to reword the copy, drop or configure
      the analytics, or both. (Not changed in this draft.)
- [ ] Confirm the copyright holder in `LICENSE`: "Fue Her" (commits also come
      from the GitHub account FueRobertHer).
- [ ] Confirm the repository is public: the About links in Settings point at
      GitHub blob URLs, which only open for a public repository.
- [ ] Decide whether `THIRD_PARTY_NOTICES.md` should also carry esbuild's MIT
      license text (Copyright (c) 2020 Evan Wallace) for Rolldown's runtime
      helpers. Rolldown's own THIRD-PARTY-LICENSE credits esbuild and Rollup,
      and its LICENSE points there; the notices list only Rolldown's MIT
      license today. (Not added in this draft.)
- [ ] Approve the final wording of this page, then drop the DRAFT banner.
