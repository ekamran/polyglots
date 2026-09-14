# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version stays below
1.0, a minor bump may carry a breaking change.

Run `polyglots --version` to see which build you have; the TUI shows it beside its title.

## [Unreleased]

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
