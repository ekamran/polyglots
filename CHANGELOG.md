# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version stays below
1.0, a minor bump may carry a breaking change.

Run `polyglots --version` to see which build you have; the TUI shows it beside its title.

## [Unreleased]

## [0.9.2] - 2026-09-19

### Fixed

- The apostrophe rule flagged ordinary words that merely began with an English
  one. On a real 1,278-entry submission it produced 56 findings and almost none
  concerned a proper noun: `and` made `anda` an offender, `list` made `Liste`
  one, `sun` made `sunt` one. It now produces 2 on the same file, and every
  other rule's output is unchanged.
  - A word is no longer taken for a proper noun on the strength of one capital
    mid-sentence. UI copy capitalises ordinary nouns freely, and that one
    signal had taught `footer`, `header`, `block`, `create`, `new` and `to`.
    The same word written in lower case anywhere in the file now settles it.
  - The rule only considers proper nouns the entry's own source mentions. It
    reads a translated word as "brand plus suffix" on a prefix match, so every
    brand the file had ever mentioned used to be tried against every
    translation in it.
  - The curated brand list is authoritative and is not subject to either check,
    so a source that writes `wordpress` in lower case somewhere cannot disarm
    the rule for the entries that spell it properly.
  - The permissive list of possible proper nouns is kept for the title-case
    rule, which needs the opposite thing: it excuses a capital in a
    translation, and narrowing it made title-case flag `John Smith`, a street
    address and `Lorem Ipsum`. The two rules now read two sets.

## [0.9.1] - 2026-09-19

### Fixed

- The review screen said `0 flagged by rules` on submissions where the rules
  had flagged thousands. It was reporting only entries the rules proved wrong,
  which are error severity, and saying nothing about the ones they doubt.
  `title-case`, `apostrophe`, `untranslated` and `punctuation` are all suspect
  severity, and on a Turkish submission they are most of what fires: one
  9,826-entry file had 5,529 rule findings and not a single error, so the line
  read zero. It now reads `rules: 0 wrong, 5529 suspect`, which are two
  different questions and are kept apart rather than summed.
- A rules-only run (`--no-ai`) reported no suspects at all, whatever the rules
  found. The count was read from the entries waiting on a model, and that run
  leaves none waiting: it decides every entry on the spot. It is now read from
  both places an entry can end up, which is where the flagged count was already
  read from. A `--no-ai` pass over 1,278 real entries reported 0 suspects
  before and reports 591 now.

## [0.9.0] - 2026-09-19

Cut a big catalogue into parts you can finish.

### Added

- `polyglots split <file> --size <n>` writes numbered parts into
  `<name>-split/` beside the source, and the menu has the same thing. Pausing a
  long run already worked, but a review is only worth anything once it is
  finished, so everything still landed at the end. Parts can be checked and
  submitted one at a time while the rest wait.
  - `--size` counts every entry the file holds, translated or not, and the last
    part is whatever is left over: 9,326 entries at 1,000 is ten parts, the
    last of them 326.
  - Splitting costs no repeated work. Draft and verdict keys are derived from
    the source text alone, so a part reuses everything already cached for the
    whole file, and a file re-split differently later reuses it again.
  - The index is padded to the width the part count needs. Unpadded, a name
    sort reads 1, 10, 100, 11, which is the order the picker lists them in.
  - Retired `#~` entries go in the first part alone. gettext-parser holds them
    apart from the translations and re-emits them on compile, so a part built
    from a copy of the source carries every one of them, in all of the parts.
  - The parts carry the source header untouched. A split revises no
    translation, so stamping it would date every part today and name this tool
    as the author of work it only copied.
  - Writing into a folder that already has files in it is refused unless
    `--force` is passed, and even then nothing is deleted. A part left over
    from an earlier, finer split looks exactly like work waiting to be
    submitted, so it is named in the output instead.

## [0.8.0] - 2026-09-19

A second agent to review with.

### Added

- `reviewProvider` chooses which agent CLI judges translations: `claude`, or
  `antigravity` through its `agy` command. It is a setting rather than a per-run
  flag, because it is a standing preference about which subscription to spend.
  Press `p` on the main screen to switch, or
  `polyglots config set reviewProvider antigravity`.
  - antigravity needs its own setup first: the MCP server registered with it,
    and the three lookups permitted in its settings. `docs/antigravity.md` has
    the commands and says why polyglots does not write that configuration
    itself. Without it every tool call is denied and the run fails with
    antigravity's own stderr quoted back.
  - Measured on one 25-entry batch of real strings: 19.6s through Claude
    against 80.9s through antigravity, which over a 400-batch submission is two
    hours against nine. It also reads the source more freely, once deciding an
    English string was a typo and offering a translation of what it thought was
    meant. Useful for a bulk pass, not for a submission about to be approved.
- The agent runner keeps stderr and folds it into the error it raises. Both
  providers have a failure that exits zero and explains itself only there: a
  denied tool, or a quota message that arrives without a non-zero status.

### Changed

- `engineId` names the provider as well as the model, so two agents' verdicts
  coexist instead of one being served as the other's. A row written before
  there was a choice says `claude` and still reads back as the same identity,
  so nothing cached is orphaned.
- The Claude runner moved to `src/agent/`, with the provider differences
  (arguments, and the shape of the envelope each one returns) behind one
  interface. Both put their validated object in `structured_output`, so only
  the failure paths differ. `claude-review.ts` became `draft-review.ts` and its
  errors no longer name Claude, since either agent can raise them.

## [0.7.6] - 2026-09-19

### Fixed

- A local draft is cached under the model that wrote it, not under `qwen`. The
  engine names itself `ollama:<model>` precisely so two models cannot serve each
  other's drafts, but the cache key was built before the engine exists and fell
  back to the chosen engine's name. For `deepl` and `openai` that string is the
  engine id already, so nothing showed; for the local engine every model shared
  one key. Switching the model in `config.json` would have served the previous
  model's drafts, written straight into the `.po`.
  - `run.engine` was recording the same string, so `stats` collapsed every local
    model into one row and could not compare them.
  - The name now comes from `draftEngineId`, derived rather than read off an
    engine. The engine is built only once there is a batch to translate, so a
    fully cached run needs no API key and no reachable Ollama, and constructing
    one just to ask its name would trade that away.
  - Existing rows keep working. A database written before this carries `qwen`,
    and those drafts were produced by whatever model was configured at the time,
    which the row cannot say. Migrating them is a judgement only the person with
    the database can make: `UPDATE draft SET engine = 'ollama:<model>' WHERE
    engine = 'qwen'` is right if the model has not changed since, and wrong
    otherwise.
  - Every translate test injected a draft engine, so the faulty branch was never
    the one under test. There is now a test that runs the real path with nothing
    injected, over a fully translated catalogue so no engine is ever built.

## [0.7.5] - 2026-09-19

Open it where you were going to open it anyway.

### Added

- `o` on either results screen opens the file in whatever the desktop associates
  with `.po`, which on a translator's machine is PoEdit. Review opens the
  repaired file rather than the submission, since the submission on disk is
  unchanged and would show none of the run's work. Translate opens the file it
  rewrote in place.
  - The launcher is detached, so the editor outlives the run and a large
    catalogue loading does not block the screen. Neither screen accepts `o`
    while a run is still going: the catalogue is rewritten after every batch,
    and opening it mid-run shows exactly the half-written state this tool works
    to avoid.

## [0.7.4] - 2026-09-19

### Added

- `CLAUDE.md` in the project root, recording the things about this repository that
  are expensive to rediscover: the build guard, which database holds work that
  cannot be regenerated, the template-literal trap in the migrations, and where a
  cache invalidates itself.

## [0.7.3] - 2026-09-19

Say it in a sentence the requester can read.

### Added

- The review results screen offers the line to post back to whoever submitted the
  translation, and `c` puts it on the clipboard. The tally a review ends with
  answers the reviewer's question; a contributor reads `ai:glossary 23 · glossary
  20` and learns nothing.
  - The link is left as an empty `href`. Only the reviewer knows which
    translations page they mean, and guessing a URL into a message bound for a
    public forum is not a guess worth making.
  - `polyglots review` prints the same sentence rather than copying it. A run
    there may be in a pipe or a script, where reaching for the clipboard is a
    side effect nobody asked for.
  - Clipboard access never throws. A missing helper, a sandbox that blocks
    spawning, or a headless machine is a reported failure with the sentence still
    on screen, so a copy that did not work costs a keystroke rather than the
    run's output.
- `byGroup` on the review summary: the run's findings folded into the few groups
  the message names, counted over repaired entries, once per entry per group.
  `byRule` counts a rule firing, so an entry both a rule and the model caught
  appears in it twice; summing that per group reported 43 glossary problems out
  of 37 entries fixed. Rounding in the sentence is capped by the number it opens
  with, so a group that is nearly the whole run rounds down rather than claiming
  more fixes of one kind than there were fixes at all.

## [0.7.2] - 2026-09-19

### Added

- Each catalogue in the file picker shows how many entries it holds, in a column.
  A 9,826-entry stable export and the 222-entry waiting export next to it are
  otherwise indistinguishable until several minutes into a run. The count is read
  from the file rather than parsed, which agrees with the parser on every export
  translate.wordpress.org produces and is fast enough to redo on every keystroke.
- `s` cycles the picker's order: newest first, name A-Z, name Z-A, oldest first.

### Changed

- The picker orders by modification time, newest first, instead of by name. The
  file a session is about is nearly always the one just downloaded, and a name
  sort puts it wherever the alphabet says. Every order breaks ties on name, so a
  directory a split job wrote in one millisecond cannot reshuffle between renders.
- The selected row in the picker takes the same blue as the pointer. It was
  yellow, as were all the unselected catalogues around it, leaving weight as the
  only thing distinguishing the cursor from its neighbours.
- A run now records how it ended, not only that it did. `done` meant finished;
  `stopped` meant the operator pressed q, or it threw, or a hard kill left a row
  behind, and anything counting "did not finish" counted all three as faults.
  Stopping part way to look at the output and resuming later is ordinary use, so
  the stats page was reporting a working habit as a warning. A nullable `ended`
  column says which: `stopped`, `failed` or `abandoned`. `abandonRun` becomes
  `endRun` and requires the reason rather than defaulting to one, because the
  caller is the only thing that knows.
  - `state` still answers only whether a run is terminal, so no existing reader
    changes. A row written before the column is not counted as a fault: it
    cannot say how it ended, and the commonest way a run stopped was the
    operator stopping it, so treating the unknown as a failure would invent
    crashes that mostly did not happen.

### Fixed

- A literal percent sign is no longer read as a placeholder. The printf flag set
  included the space flag, so `100% satisfaction` parsed as `%s`, `30% off` as
  `%o` and `101% Growth` as `%G`. English puts the sign after the number and
  Turkish puts it before, `%100`, so the phantom was reported lost on every one
  of these, and on the audit side as an error the model had no way to clear.
  Six phantoms gone across the local corpus, 110 real placeholders kept.
  - The space flag is legal printf and asks for a blank where a plus sign would
    go. Nothing in a WordPress UI string wants it. Percent-encoded URLs still
    match, `%2F` reading as a width-2 float, and that is left alone: both sides
    of a translation carry the same URL so the counts cancel, and a draft that
    mangles one deserves the warning.
  - The pattern existed twice, verbatim, in the draft and audit trees, and the
    two had drifted. Now exported from one place.
- A run row left at `running` by a hard kill is cleared at the start of the next
  `translate` or `review`. `kill -9`, a crash or a closed terminal has no ordinary
  stop path, so the row stayed forever and kept its scratch rows with it, and
  `stats` counted it under "did not finish" for good. Applied to the live
  database on release: one row from a pre-0.7.1 kill, carrying 3,585 orphan
  entry rows.
  - The live set comes from `liveRuns` rather than a second pid check, so the two
    cannot disagree. It errs towards leaving rows behind: a pid the operating
    system has recycled reads as alive and is skipped, because a wrong number in
    `stats` costs less than stopping a live run. The sweep does not run in
    `stats`, which documents itself as writing nothing.

## [0.7.1] - 2026-09-19

### Added

- `npm run build` refuses while a review or translate is in flight, and says which
  one. A running job spawns an MCP server from `dist/` for every batch, so
  rebuilding underneath it can hand a half-written file to the next spawn. Set
  `POLYGLOTS_ALLOW_BUILD=1` to override.
- A run records the process that owns it. Without that, a row left saying
  `running` by a hard kill is indistinguishable from a job that is genuinely
  working, and the guard above would refuse to build ever again.

### Changed

- The check fails open. A missing database, a native module that is not built
  yet, or a schema older than the new column all allow the build: a guard that
  can block a legitimate build through its own malfunction is worse than the
  hazard it guards against, and `prepare` runs during `npm install`.

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
