import { createContext, useContext, useEffect } from 'react'

// Which stage a screen is in, for the footer's keys. The frame draws the
// footer and the screen knows its stage, so the screen reports it here: a
// review's footer listed the options form's keys all through the run,
// because the frame had no way to know the form had gone.
const FooterStageContext = createContext<(stage: string | undefined) => void>(() => undefined)

export const FooterStageProvider = FooterStageContext.Provider

/** Reports the screen's stage to the footer while it is mounted. */
export function useFooterStage(stage: string | undefined): void {
  const set = useContext(FooterStageContext)
  useEffect(() => {
    set(stage)
  }, [set, stage])
  useEffect(() => () => set(undefined), [set])
}
