// What a run says on stderr before it starts: the universal-only notice and the
// local model checks. Shared by translate, review and fetch.
//
// These lived in cli.ts as helpers taking the whole Cli, which fetch, with its
// narrower FetchCli, could not call. So fetch said neither: a locale with no
// rules of its own was reviewed in silence, and a missing local model was
// found out by the first batch of the first project, after every download.
// Taking only what they use lets every command that starts a run say the same
// things in the same words.

import type { checkLocalModel, ModelCheck } from '../draft/discover.js'
import { localModelId, type LocalTarget } from '../draft/local-chat.js'
import { engineId } from '../jobs/hash.js'
import { LOCAL_REVIEW_NOTICE, localBatchAdvice } from '../review/local.js'
import { supportNotice } from '../rules/support.js'
import type { Locale } from '../types.js'
import { warnLine } from '../ui/messages.js'
import type { Painter } from '../ui/paint.js'

export interface NoticeCli {
  ui: { err: Painter }
  err(line: string): void
}

export interface ModelNoticeCli extends NoticeCli {
  checkLocalModel: typeof checkLocalModel
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Before the run, on stderr, and never a refusal: the universal checks are
// worth running on their own, but whoever reads the result should know an
// absent finding is not a passed language check.
export function warnUniversalOnly(cli: NoticeCli, locale: Locale): void {
  const notice = supportNotice(locale)
  // The notice is bare text and the glyph marks it. It used to carry a "Note: "
  // prefix that this, its only caller, stripped again with a regex.
  if (notice) cli.err(warnLine(cli.ui.err, notice))
}

export async function warnAboutLocalModel(cli: ModelNoticeCli, target: LocalTarget): Promise<ModelCheck | undefined> {
  try {
    const check = await cli.checkLocalModel(target)
    if (check.state !== 'installed') cli.err(warnLine(cli.ui.err, check.message ?? `${check.model} is ${check.state}`))
    return check
  } catch (error) {
    // A throw here is a bug rather than a probe failure, since a probe never
    // rejects. It still must not be the reason a translate fails.
    cli.err(warnLine(cli.ui.err, `could not check the local model: ${errorMessage(error)}`))
    return undefined
  }
}

/**
 * Before a run with the local reviewer: say it is experimental, check its
 * model, and warn when the batch will not fit the context. The context is the
 * configured one, or failing that what the server's listing reported.
 */
export async function warnAboutLocalReview(
  cli: ModelNoticeCli,
  target: LocalTarget,
  batchSize: number,
  locale: Locale,
  check: 'check' | 'skip-check' = 'check',
): Promise<void> {
  cli.err(warnLine(cli.ui.err, LOCAL_REVIEW_NOTICE))
  const result = check === 'check' ? await warnAboutLocalModel(cli, target) : undefined
  const contextLength = target.contextLength ?? result?.contextLength
  const advice = localBatchAdvice({
    batchSize,
    locale,
    model: engineId(localModelId(target), 'local'),
    kind: target.kind,
    ...(contextLength === undefined ? {} : { contextLength }),
  })
  if (advice) cli.err(warnLine(cli.ui.err, advice))
}
