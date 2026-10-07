# Getting started

polyglots reviews and translates WordPress `.po` files. It is written for the
people who look after a locale on translate.wordpress.org: it checks the
strings contributors submit, repairs what it can, and drafts the strings
nobody has translated yet. Every result is a `.po` file you open in Poedit and
read before anything goes back to GlotPress. polyglots never uploads anything.

## Install

You need Node.js 24 or later.

```
npm install -g polyglots
```

Or run it without installing:

```
npx polyglots
```

Run `polyglots` with no arguments for the interactive menu, or use the
commands below. Every menu screen has a command behind it, so anything you do
in the menu can also be scripted.

## Choose a reviewer

A review or a translation is judged by an AI agent that runs on your machine:
the [Claude Code](https://claude.com/claude-code) CLI (`claude`, the default)
or the Antigravity CLI (`agy`). polyglots runs the agent for you. It does not
call a model API itself, so the agent uses whichever account it is already
signed in to.

Check which agents are installed and ready:

```
polyglots doctor
```

`doctor` sends no prompt. `polyglots doctor --live` also sends one short
prompt to each agent, which counts as a request on a metered plan.

To use antigravity, follow [its setup](antigravity.md) first. To review or
draft with a model on your own machine, see [local models](local-models.md).

## Set your locale

polyglots uses `tr` (Turkish) until you tell it otherwise. Set yours once:

```
polyglots config set defaultLocale de
```

Any WordPress locale works: `de`, `de_DE`, `pt-br`, `nl_NL_formal`. Every
command also takes `--locale` for a single run.

## Download the glossary

A review checks every string against your locale's glossary from
translate.wordpress.org, and refuses to start without one. Download it once,
and again whenever your team changes it:

```
polyglots glossary sync
```

## Review a submission

In GlotPress, filter the project by Waiting and export "only matching the
filter" as `.po`. The file itself carries no review status, so the filter is
what makes it the submission. Then:

```
polyglots review wp-plugins-example-stable-de.po
```

polyglots writes `wp-plugins-example-stable-de-repaired.po` beside it. It
holds only the entries that needed work, with the repairs already made, and
each one carries a note saying what was wrong. Everything else is approvable
as it stands. The run also prints a message you can post to the contributor.
See [Reviewing submissions](review.md).

## Translate untranslated strings

Export the untranslated strings, then:

```
polyglots translate wp-plugins-example-stable-de.po
```

The file is filled in place. Entries polyglots is unsure of are marked fuzzy
for you to check. Drafting needs a DeepL or OpenAI key, or a local model. See
[Translating](translate.md).

## Or let it fetch for you

`fetch` downloads the exports from translate.wordpress.org itself, then
reviews or translates each one:

```
polyglots fetch --get waiting example-plugin another-theme
polyglots fetch --get untranslated example-plugin
```

Names are slugs or translate.wordpress.org URLs. A list can also be piped in,
one per line. The files land in `~/Downloads/polyglots` unless you pass
`--out-dir`.

## Stop, pause, resume

A long run can be paused with `p`, resumed with `r`, and stopped with `q`.
Each takes effect after the batch in progress, so nothing already paid for is
lost. Running the same command again carries on where it stopped: every
verdict and draft is cached, so only the entries that were not reached are
sent again. `--fresh` ignores the cache.

## Where your data lives

| What | Where |
|---|---|
| Settings | `~/.config/polyglots/config.json` |
| API keys | `~/.config/polyglots/.env` |
| Translation memory and glossary | `~/.local/share/polyglots/polyglots.db` |
| Run history and caches | `~/.local/share/polyglots/jobs.db` |

Set `POLYGLOTS_HOME` to keep all of it under one folder instead. Nothing here
is uploaded. The translation memory is built from your own imports and is the
one file worth backing up: `jobs.db` can be deleted, at the cost of
re-reviewing.

## Next

- [Configuration](configuration.md): every setting and key.
- [Locale rules](locale-rules.md): teach the checks your team's conventions.
- [Command reference](https://ada.tools/polyglots/docs/commands/): every
  command and option, also in `polyglots --help`.
