# Working on polyglots

A CLI and TUI that translates and reviews WordPress `.po` files. This file records
the things that are expensive to rediscover, not the things the code already says.

## Before you build

`npm run build` runs `scripts/no-live-run.mjs` first, which refuses while a review
or translate is in flight and names the pid. A running job spawns an MCP server
from `dist/` for every batch, so rewriting `dist/` underneath it can hand a
half-written file to the next spawn. This has happened, two minutes into a
seven-thousand-entry run.

Check before you start work, so a refusal is never a surprise:

```
sqlite3 ~/.local/share/polyglots/jobs.db "SELECT id, command, pid FROM run WHERE state = 'running';"
```

`POLYGLOTS_ALLOW_BUILD=1` exists. Do not reach for it on your own. A long run is
hours of metered API calls, and the person who started it is the only one who gets
to decide it is expendable.

The guard fails open by design. No database, an unbuilt native module, or a schema
older than the `pid` column all allow the build.

## Data you must not break

Two SQLite files under `~/.local/share/polyglots/`, kept apart on purpose:

- `polyglots.db` holds the translation memory and glossary, built from TMX imports
  over months. It cannot be regenerated. Treat it as read-only unless the task is
  explicitly about it.
- `jobs.db` holds run state and caches. Disposable: deleting it costs a re-review.

Never point a test or a scratch script at either. Tests build their own temporary
homes; follow that.

## Scripts

`build`, `typecheck`, `test`, `dev`, `prepare`, `prebuild`. There is no
`npm run lint`. Typecheck covers tests too (`tsconfig.test.json`).

## Language and style

TypeScript ESM with `module: NodeNext`, so relative imports carry a `.js`
extension even from `.ts` sources. `exactOptionalPropertyTypes` is on, which is
why you will see `...(x === undefined ? {} : { x })` instead of `x: x ?? undefined`.

Comments here explain why a decision was made, at length, in prose. They document
the alternative that was rejected and the failure that motivated the choice. Match
that voice. A comment restating what the next line does is noise; a comment saying
why the next line is not the obvious thing is the point.

## Traps that have cost time

**Backticks inside the migrations template literal.** `src/jobs/db.ts` holds the
schema in a JS template literal. A backtick in a SQL comment inside it terminates
the string and the build fails with a confusing `TS1005`. This has happened twice.
Reword instead of escaping.

**The placeholder regex is shared.** `src/draft/placeholders.ts` exports
`PRINTF_PLACEHOLDER` and `BRACE_PLACEHOLDER`. `src/audit/rules/text.ts` imports
them. It used to keep a verbatim copy, and the two drifted. Do not reintroduce a
second definition. The flag set deliberately omits printf's space flag, because
a percent sign followed by a space is ordinary English UI copy.

**Some caches invalidate themselves and some do not.** `auditSrcHash` in
`src/jobs/hash.ts` hashes the rendered rule hints, so changing what a rule reports
changes the key and stale verdicts are never served. Draft keys are source-only
and path-independent, so a file re-downloaded under the same name reuses its
drafts. Before writing an invalidation step, check whether the hash already covers
what changed.

**A cache key must cover everything the prompt renders.** If you add something to
a prompt, add it to the hash in the same commit.

## Semantics worth knowing

**How a run ended is not the same as that it ended.** `state` says only that a run
is terminal. `ended` says which: `stopped` by the operator, `failed` on a throw,
`abandoned` when the reaper found the process gone. Stopping part way to look at
the output and resuming later is ordinary use, and its work is cached, so it must
never be counted beside a crash. `ended` is NULL on rows written before the column
existed, and those are deliberately not counted as faults.

**`byRule` and `byGroup` answer different questions.** `byRule` counts a rule
firing over flagged entries, so an entry both a rule and the model caught appears
twice. `byGroup` counts repaired entries, once per entry per group, so it can be
stated in the same sentence as the repair count without contradicting it.

**A `.po` carries no review status.** GlotPress marks only `fuzzy`. Waiting,
current and changes-requested are properties of the server, not the file, so a
downloaded catalogue cannot be scoped to a subset after the fact. The export URL
filter is what decides it: `?filters[status]=waiting`.

**Fuzzy entries are overwritten unconditionally** on a translate pass. That is the
one data-loss path in the round trip, and the cache has no memory of a human
having rejected a draft.

## Testing

Vitest. `test/` mirrors `src/`. TUI tests use `ink-testing-library` through
`test/tui/helpers.ts`, which has the key codes, a `tick`, and summary factories.
Ink wraps output to the terminal width, so assert against a whitespace-normalised
frame rather than a raw substring that spans a wrap.

Write the failing test first and run it to see it fail. A test added after the
code, that passes on its first run, has proved nothing.

Adding a required field to `ReviewSummary` breaks the factories in
`test/tui/helpers.ts` and `test/cli/main.test.ts`. Typecheck will find them.

## Git

Commit messages are an imperative sentence describing the behaviour change, with
a body explaining why it was worth changing. No conventional-commits prefixes, no
bullet summaries of the diff. Look at recent history before writing one.

Version bumps use
`npm version patch --no-git-tag-version`, and `CHANGELOG.md` follows Keep a
Changelog, in the same prose voice as the code comments.

Verifying, bumping, writing the changelog, building and committing is one
routine, and `/release` is it. The order and the traps are in
`.claude/commands/release.md`; read it rather than reconstructing the steps.
