# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version stays below
1.0, a minor bump may carry a breaking change.

Entries say what changed. For why and how, read the commit.

## [Unreleased]

### Added

- Per-locale rules file (`polyglots rules edit|check|copy|path`): switch built-in rules, proper
  nouns, common mistakes, patterns at hint, error or fix level, and guidance for the AI review.
- A "Locale rules" menu entry: built-in rules, glossary match tolerance, proper nouns, common
  mistakes and patterns, with a panel to try them on a sample before saving.
- Translation sets such as `nl/formal`, `pt/ao90` and `sr/latin`, in every wp.org lookup and file name.
- `--locale` accepts WordPress codes (`nl_NL_formal`, `tr_TR`), mapped by a wp.org locale table
  that every build refreshes.
- DeepL drafts for a formal or informal set ask for that register.
- A `control` rule for settings WordPress code reads (`on`/`off` font switches, `ltr`, word count
  type, number separators): checked against the values the translator comment allows.
- `translate` checks its drafts with the review rules: fix patterns applied, findings sent to
  the AI pass, and an entry still failing an error-level check marked fuzzy.

### Changed

- An invalid locale rules file stops `review`, `translate` and `fetch` before they start.
- A locale wp.org does not list is refused, with suggestions, instead of being used as typed.
- Control strings skip the draft engine and every other rule, so `on` is never translated as a word.
- Cached verdicts and draft reviews run again once on the next run.

### Fixed

- The requester link works for plugin readme sub-projects.

## [0.20.1] - 2026-10-03

### Changed

- `fetch` pauses longer between wp.org requests: 1.5 s between pages, 3 s between exports.

### Fixed

- `fetch` waits out a 429 or 503 from wp.org and retries up to 3 times, saying how long it waits.

## [0.20.0] - 2026-10-03

### Added

- An "Export Translation Memory" menu entry: TMX or `.po`, saved to Downloads.

### Fixed

- The menu's TM import picker lists `.po` files, not only `.tmx`.

## [0.19.0] - 2026-10-02

### Added

- `fetch` and a menu entry: take a list of theme and plugin slugs or URLs, download their
  waiting or untranslated strings, and review or translate all of them, up to 8 at once.

### Fixed

- Resuming a paused run released only one of the jobs waiting on it.

## [0.18.0] - 2026-09-30

### Added

- `tm import` reads `.po` exports as well as TMX, which is what translate.wordpress.org
  gives you. The format is chosen by what the file holds, not by its name. Fuzzy and
  untranslated entries are skipped, and a plural entry becomes one row per source form.
- `tm export [file]` writes the memory as TMX or `.po`, `--format` or the file name
  deciding. A `.po` holds one translation per source and context, so alternatives are
  collapsed to the most recent and the count dropped is reported.
- A `line-breaks` rule: the translation has a different number of line breaks than the
  source. Error severity, universal, and not repairable.
- An `ampersand` rule: the translation keeps `&` where Turkish writes the conjunction as a
  word. Entities and query strings are left alone.
- A `number-format` rule: a space between the percent sign and its number.

### Changed

- `punctuation` also reports a sentence-ending stop that one side has and the other does
  not. Presence only: trading `!` for `.` is the locale's own convention.
- Cached verdicts prune once on the next run.

## [0.17.1] - 2026-09-28

### Changed

- The repaired file marks fuzzy the entries no repair was found for, the ones the summary
  counts as "left for you". Repaired entries stay unflagged.

## [0.17.0] - 2026-09-28

### Added

- An `escaping` rule: the translation escapes a quote the source spells plainly, or drops one
  the source carries. Error severity, and universal rather than per locale.

### Changed

- A stray backslash before a quote is repaired mechanically, like whitespace. A lost one is
  left for the model, since nothing can compute where it belonged.
- Cached verdicts prune once on the next run.

## [0.16.3] - 2026-09-28

### Fixed

- Repairs and drafts no longer escape a quote the source leaves plain. Applies to the model's
  fixes, reviewed drafts and repairs written from the memory.

## [0.16.2] - 2026-09-27

### Changed

- The repaired file no longer marks its entries fuzzy. Flags an entry already carried are kept.

## [0.16.1] - 2026-09-26

### Changed

- The translate screen no longer asks for confirmation on any mode.

## [0.16.0] - 2026-09-26

### Added

- Batch size on the translate screen, the same ladder review offers, passed to the run.

### Changed

- A pending translation starts without a second confirmation. `all` still asks.

## [0.15.0] - 2026-09-25

### Changed

- The memory holds every wording the locale approved for a source, not just the last imported.
  A submission matching any of them is approved, and `tm-conflict` fires only when none match.
- A repair from the memory happens only where the alternatives agree.
- `translate` marks a fill from the memory fuzzy when more than one wording was on offer.
- Opening a database written before this rebuilds the `tm` table and its index. No row is dropped.

### Fixed

- A submission left in English is no longer approved because the memory holds the same English.

## [0.14.0] - 2026-09-21

### Changed

- Entries the memory can settle no longer go to the model: an exact match is approved, a
  case-only difference is approved as written, and one left in English is repaired from it.
  On a 1,359-entry theme, 265 entries settled and the run sent 11 batches instead of 14.
- The progress line says how many entries the memory settled.

### Fixed

- The resume line counts down, says "1 batch" rather than "1 batches", and waits for a batch
  count before claiming one.

## [0.13.0] - 2026-09-20

### Added

- The requester message links to the reviewer's own translations. Set it up once with
  `polyglots config set wporgUsername <your wp.org login>`. Plugin, theme and patterns exports
  are understood; anything else keeps an empty `href`.

### Fixed

- A batch the agent refuses is attempted twice again, undoing the change made in 0.12.0.
- A refused batch reports that it produced no output, instead of blaming malformed JSON.
- `p` and `q` are acknowledged the moment they are pressed, on every surface.
- Translate's progress screen reports pause and resume at all.

## [0.12.0] - 2026-09-20

### Changed

- A review driven by antigravity records the model from its settings, as
  `antigravity:Gemini 3.8 Flash (Medium)`.
- Cached verdicts prune once on the next run.

### Fixed

- The prompt states how many entries a batch holds, and that there is no shell or filesystem.
- A refused batch is no longer attempted twice. (Reverted in 0.13.0.)

## [0.11.0] - 2026-09-20

### Changed

- An entry states how its exact source was translated and approved before, so the agent no
  longer looks it up. The memory joins the verdict key.
- Cached verdicts prune once on the next run.

## [0.10.0] - 2026-09-20

### Changed

- `/release` chooses the bump size when the caller does not name one.
- Corrects 0.9.9, which was cut as a patch and should have been a minor.

## [0.9.9] - 2026-09-20

### Added

- A `tm-conflict` rule: the memory holds a different translation of this exact source. Suspect
  severity, and differences of case, spacing or a trailing stop are not reported.

### Changed

- An entry states the glossary terms its source contains, so the agent no longer looks them up.
- Timeouts are per provider: five minutes for Claude, twenty for antigravity, which is given its
  own deadline just inside the caller's.
- The review screen and `polyglots review` warn when a batch is too small for antigravity.
- Cached verdicts prune once on the next run.

## [0.9.8] - 2026-09-20

### Changed

- Every screen that starts or reports a job names the provider it will use.

### Fixed

- A review that named `antigravity` spawned `claude`. Verdicts cached before this are Claude's,
  filed under antigravity.

## [0.9.7] - 2026-09-20

### Changed

- A resumed review says so, counting the inherited batches into the bar instead of starting
  from zero.

## [0.9.6] - 2026-09-19

### Added

- `docs/ideas.md`, and a backlog entry for moving to the next split part from the results screen.

### Changed

- Em dashes removed from the prose in comments, documents and messages.

## [0.9.5] - 2026-09-19

### Added

- `/release` for Claude Code sessions in this repository: verify, bump, changelog, build, commit.

## [0.9.4] - 2026-09-19

### Fixed

- Corrected the antigravity timings in `docs/antigravity.md` and in the 0.8.0 entry. The two
  providers are close rather than four times apart.

## [0.9.3] - 2026-09-19

### Added

- The statistics screen chooses where the page goes, with Tab, and `o` opens it.

### Changed

- The file picker can choose a folder as well as a file.

## [0.9.2] - 2026-09-19

### Fixed

- The apostrophe rule flagged ordinary words that began with an English one: 56 findings on a
  1,278-entry submission became 2.

## [0.9.1] - 2026-09-19

### Fixed

- The review screen said `0 flagged by rules` where the rules had flagged thousands. It now
  reads `rules: N wrong, N suspect`.
- A rules-only run reported no suspects at all.

## [0.9.0] - 2026-09-19

### Added

- `polyglots split <file> --size <n>` writes numbered parts into `<name>-split/`, and the menu
  has the same. Parts reuse whatever is already cached for the whole file.

## [0.8.0] - 2026-09-19

### Added

- `reviewProvider` chooses the agent that judges translations: `claude`, or `antigravity`
  through its `agy` command. Press `p` on the main screen to switch. Setup is in
  `docs/antigravity.md`, and antigravity needs it before it will work at all.
- The agent runner keeps stderr and folds it into the error it raises.

### Changed

- `engineId` names the provider as well as the model, so two agents' verdicts coexist.
- The Claude runner moved to `src/agent/`; `claude-review.ts` became `draft-review.ts`.

## [0.7.6] - 2026-09-19

### Fixed

- A local draft is cached under `ollama:<model>` rather than under `qwen`, so two models cannot
  serve each other's drafts. Rows written before this say `qwen`.

## [0.7.5] - 2026-09-19

### Added

- `o` on either results screen opens the file in PoEdit.

## [0.7.4] - 2026-09-19

### Added

- `CLAUDE.md` in the project root.

## [0.7.3] - 2026-09-19

### Added

- The review results screen offers a one-line message for the requester, and `c` copies it.
  `polyglots review` prints the same sentence.
- `byGroup` on the review summary, counted over repaired entries.

## [0.7.2] - 2026-09-19

### Added

- The file picker shows how many entries each catalogue holds, and `s` cycles the sort order.

### Changed

- The picker orders by modification time, newest first, and the selected row takes the
  pointer's blue.
- A run records how it ended: `stopped`, `failed` or `abandoned`.

### Fixed

- A literal percent sign is no longer read as a placeholder.
- A run row left at `running` by a hard kill is cleared at the start of the next run.

## [0.7.1] - 2026-09-19

### Added

- `npm run build` refuses while a review or translate is in flight, and says which.
  `POLYGLOTS_ALLOW_BUILD=1` overrides it.
- A run records the process that owns it.

### Changed

- The build guard fails open: no database, an unbuilt native module or an older schema all
  allow the build.

## [0.7.0] - 2026-09-19

### Added

- `--draft-engine qwen` drafts against a local Ollama, configured under `ollama` in
  `config.json`. It identifies itself as `ollama:<model>`.

### Fixed

- Draft engines identify items by number rather than by gettext key. Every cached draft is
  invalidated.

## [0.6.0] - 2026-09-19

### Added

- `polyglots stats` writes a self-contained HTML page from the run history, also available from
  the menu. No script, nothing off the machine, light and dark, English and Turkish.

### Changed

- `pruneStaleConfigs` checks its table name against an allow-list at runtime.
- The `X-Polyglots-Review` header no longer carries a fingerprint.
- A run row says `running`, `done` or `stopped`, and nothing else.

### Fixed

- A cached verdict records which model produced it.
- An entry whose whitespace was repaired no longer shares a cache key with one submitted clean.
- A `by_category` tally holding something that is not a number reads as absent.

## [0.5.0] - 2026-09-18

Run state moved out of the `.po` file and into a database.

### Added

- `translate` resumes, reusing the drafts and reviews it already has.
- An interrupted review picks up where it stopped.
- `translate --fresh` ignores both and asks again.
- Per-run totals are kept as history.

### Changed

- Resume is per entry rather than per file.
- A failed batch keeps the entries it did judge.
- Changing the glossary, the rules or the prompt discards cached verdicts for that locale only.

### Removed

- The `X-Polyglots-Review` marker is still written but never read back. One written by 0.2.0
  through 0.4.0 is ignored, and the review starts from the top.

## [0.4.0] - 2026-09-14

### Added

- `p` pauses a run, `r` resumes it, `q` stops it and keeps what is done, on both surfaces. It
  takes effect at a batch boundary.
- Both commands give up after three consecutive failed batches.
- The review summary reports `pending`, the entries a stopped run never looked at.

### Fixed

- A failing `claude` call reports whichever stream actually said something.
- A failed batch no longer advances the resume marker.
- `approvable` could go negative.
- A stopped run no longer claims the submission looks approvable while reporting entries it
  never reviewed.
- The CLI no longer puts a non-terminal stdin into raw mode.

## [0.3.0] - 2026-09-12

### Added

- Review returns corrected translations and writes `<name>-repaired.po`.
- Whitespace is repaired before the rules pass judgment.
- Entries the rules condemn go to the model for a fix, which is re-run through the rules and
  refused if it introduces a new error.
- `repaired` and `written` counts in the summary.

### Changed

- `<name>-problems.po` is written only by `--no-ai` runs.
- The resume marker format is at version 2; markers from earlier builds are rejected.

### Fixed

- A repaired translation could be silently reverted on resume.
- The TUI told the user to run `translate` over the repaired file, which would have undone
  every repair.
- `npm run typecheck` covers the tests as well as `src`.

## [0.2.0] - 2026-09-11

### Added

- An estimated finish time in the progress line, and an elapsed clock per batch.
- Review resumes an interrupted run from a marker in the output file's header. `--fresh`
  ignores it.
- Batch size is selectable per run in the TUI.

### Changed

- One progress bar across every surface.
- The review progress line shows one counter instead of two that contradicted each other.

### Fixed

- Review writes after every batch instead of only at the end.
- The progress bar drew as full before the first batch had started.

## [0.1.0] - 2026-09-10

First working version: `translate` drafts and reviews `.po` entries, `review` audits a
submission against the WordPress glossary and per-locale rules, with a TUI over both, an MCP
server for glossary, consistency and TM lookups, and a local SQLite memory fed from PoEdit TMX
exports.
