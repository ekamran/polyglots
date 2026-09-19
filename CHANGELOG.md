# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version stays below
1.0, a minor bump may carry a breaking change.

Run `polyglots --version` to see which build you have; the TUI shows it beside its title.

## [Unreleased]

## [0.7.0] - 2026-09-19

A draft engine that costs nothing.

### Added

- `--draft-engine qwen` drafts against a local Ollama, so a long translate has no
  quota and no bill. Configure it under `ollama` in `config.json`: `baseUrl` and
  `model`, defaulting to a stock install and `qwen3.8:27b-mlx`.
  - Measured on 3,656 short pattern strings: about 1.4s an entry at a batch of 15,
    1.5s at 30, and 4.6s at 60. The engine warns above 30, because a batch size
    chosen for the metered engines quietly triples a local run.
  - It identifies itself as `ollama:<model>`, so switching models invalidates its
    cached drafts instead of serving one model's work as another's.

### Fixed

- Draft engines now identify items by number rather than by gettext key. A key can
  begin with a newline and end in spaces, and a model asked to echo one back
  normalises it; the reply then looks well-formed while naming no entry. This was
  losing whole batches against a local model. The review side has worked this way
  for some time. Every cached draft is invalidated by the change, which is correct:
  they were produced under a different instruction.

## [0.6.0] - 2026-09-19

Say what the reviewing has added up to.

### Added

- `polyglots stats` writes a self-contained HTML page from the run history: how many
  submissions and entries were reviewed, by week and by project, what gets flagged,
  and the median turnaround. Available from the menu as well.
  - The page carries no script and references nothing off the machine, so it opens
    from an email attachment on a computer that has never heard of this tool. The
    charts are hand-built SVG for the same reason.
  - Light, dark and follow-the-system, and English or Turkish, switched in the page
    itself. Both languages ship inside it and CSS shows one, so the switches need no
    script. Numbers are grouped the way each language groups them.
  - A second section covers translation: entries drafted, how many were left fuzzy,
    and what an engine skipped. Kept apart from the review numbers rather than summed,
    because "looks wrong" and "wants a human eye" answer different questions.
  - Both sections compare the engines that did the work. Review rows separate two
    Claude models; translation rows separate DeepL from OpenAI. Each engine gets its
    own median, so a slow one is visible. The table is omitted when only one engine
    ever ran, since a comparison of one thing is a row of numbers pretending.
  - Only finished runs count. One that stopped part way froze no totals, and the
    page says how many did that rather than quietly shrinking the denominator.
  - It states that a flag measures what the tool flagged, not the quality of anyone's
    work. These numbers may be read by the people who volunteered the translations.

### Fixed

- A cached verdict now records which model produced it. Two Claude models answer the
  same question differently and both were stored as `claude`, so one could be served
  the other's judgement.
- An entry whose whitespace was repaired mechanically no longer shares a cache key
  with the same entry submitted already clean. The hash is taken after the repair, and
  the prompt tells the model which of the two it is looking at.
- A `by_category` tally holding something that is not a number now reads as absent
  rather than as a partial tally, so a chart is never drawn from a count with an entry
  silently dropped.

### Changed

- `pruneStaleConfigs` checks its table name against an allow-list at runtime, not only
  through its type.
- The `X-Polyglots-Review` header no longer carries a fingerprint. Nothing reads the
  header back, and computing it meant reading the whole submission a second time on
  every run to fill a field nobody consumes.
- A run row can say `running`, `done` or `stopped`, and nothing else. It previously
  also allowed `paused` and `stopping`, which nothing ever wrote.

## [0.5.0] - 2026-09-18

Run state moved out of the `.po` file and into a database, so the counts, the output
file and the resume point stopped being three things that had to agree.

### Added

- `translate` can resume, which it never could. A re-run reuses the drafts and the
  reviews of them that it already has, so it no longer re-pays the metered draft API
  for work it already did.
- A review that was interrupted picks up where it stopped. Re-run the same command
  and only the entries that were never decided go back to the model; the rest come
  back from what the earlier run already established about that file.
- `translate --fresh` ignores the drafts and reviews kept from an earlier run and
  asks for them again, for when the first answer was not good enough.
- Per-run totals are kept as history, so a reporting command can be written later
  against real numbers rather than starting from the day it ships.

### Changed

- Resume is per entry rather than per file. Editing three strings in a 294-entry
  submission re-reviews three entries instead of all 294.
- A failed batch no longer discards the entries it did judge. Only the ones it could
  not reach are re-attempted.
- Changing the glossary, the rules or the prompt discards every cached verdict for
  that locale, and only that locale. Verdicts formed under different instructions
  cannot be mixed, and reviewing a `de` submission must not throw away the `tr` work.

### Removed

- The `X-Polyglots-Review` resume marker. It is still written, because it is useful
  to read in the file, but nothing reads it back. A marker written by 0.2.0 through
  0.4.0 is ignored with a message saying so, and the review starts from the top.

## [0.4.0] - 2026-09-14

Pause a long run, and have it stop itself when the subscription runs out.

### Added

- `p` pauses a translate or review run, `r` resumes it, `q` stops it and keeps what is done.
  Works on both the TUI and the CLI. The pause takes effect at a batch boundary, never inside
  one, so the call already paid for finishes and saves first.
- Both commands give up after three consecutive failed batches rather than grinding through
  the rest of the file. Each batch already retries once, so that is six failed calls: past any
  transient blip and into something systemic, which in practice means an exhausted quota.
- The review summary reports `pending`, the entries a stopped run never looked at, and says
  `Stopped early with N entries not reviewed. Re-run the same command to carry on.`

### Fixed

- A failing `claude` call now reports whichever stream actually said something. It prints its
  usage-limit notice on stdout and exits non-zero, and only stderr was being kept, so an
  exhausted quota appeared as `exit code 1; stderr:` with nothing after it.
- A failed batch no longer advances the resume marker. A run that failed its way to the end
  recorded itself as complete, so re-running it started again from the first batch instead of
  resuming.
- `approvable` could go negative. Entries in a failed streak were counted both as problems and
  as pending, and subtracted twice.
- A stopped run no longer claims the submission "looks approvable" while also reporting
  entries it never reviewed.
- The CLI no longer puts a non-terminal stdin into raw mode, which would break a piped or
  scheduled run. Where raw mode is used, Ctrl+C is recognised by hand and handed back, since
  raw mode swallows the signal.

## [0.3.0] - 2026-09-12

Review stopped merely judging a submission and started repairing it.

### Added

- Review returns corrected translations, not just verdicts, and writes `<name>-repaired.po`.
- Faults that need no judgment are repaired before the rules pass judgment. Today that is
  whitespace, the one rule whose correct output is computable from the source.
- Entries the rules condemn now go to the model to be repaired. Their verdict is settled
  first, so the model supplies a fix rather than an opinion and cannot clear a mechanical
  fact.
- Every proposed fix is re-run through the deterministic rules and refused if it introduces a
  new error, so a repair that restores one placeholder while dropping another never ships. A
  refused fix is recorded in the file rather than dropped silently.
- `repaired` and `written` counts in the summary, and a closing line saying how much is left
  to do by hand.

### Changed

- `<name>-problems.po` is now written only by `--no-ai` runs, which have no model to repair
  with. The file name says whether anything could have been repaired.
- The resume marker format is at version 2. Markers written by earlier builds are rejected, so
  a review started before this upgrade restarts rather than resuming from a short count.

### Fixed

- A repaired translation could be silently reverted on resume. The output file is rebuilt from
  the untouched source every save, so a repair exists nowhere else, and the resume path
  recovered only the comments. Closed structurally: anything written can now be read back.
- The TUI told the user to run `translate` over the repaired file, which re-selects fuzzy
  entries and would have undone every repair.
- `npm run typecheck` now covers the tests as well as `src`, via `tsconfig.test.json`. The
  build still emits only `src`.

## [0.2.0] - 2026-09-11

Made a multi-hour run possible to watch, interrupt and pick up again.

### Added

- An estimated finish time in the progress line, from the first batch onward: a guess at a
  default pace until a batch has been timed, then the median of the last five.
- An elapsed clock per batch on both translate and review, so a call that takes minutes is
  visibly alive rather than apparently wedged.
- Review can resume an interrupted run from a marker in the output file's header. A
  fingerprint over the submission, glossary, rules, prompt and batch size means a resume is
  refused, with a reason, rather than mixing verdicts from two different runs. `--fresh`
  ignores the marker.
- Batch size is selectable per run in the TUI, and both surfaces take their default from
  `config.json`.

### Changed

- One progress bar across every surface, drawn as `▰▱`. The last cell stays empty until the
  work is genuinely finished, because a full bar on a run with entries left reads as a hang.
- The review progress line shows one counter instead of two that contradicted each other.

### Fixed

- Review wrote its output only at the end, so a several-hour run interrupted at any point lost
  everything. It now writes after every batch.
- The progress bar drew as full before the first batch had started.

## [0.1.0] - 2026-09-10

First working version: `translate` drafts and reviews `.po` entries, `review` audits a
contributor's submission against the WordPress glossary and a set of per-locale rules, with a
TUI over both, an MCP server for glossary, consistency and TM lookups, and a local SQLite
translation memory fed from PoEdit TMX exports.
