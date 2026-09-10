import { useState } from 'react'
import { useApp } from 'ink'
import { CommandsProvider, defaultCommands, type TuiCommands } from './commands.js'
import { ActivityProvider, createActivity, type Activity } from './hooks/activity.js'
import { ConfigureKeys } from './screens/ConfigureKeys.js'
import { ImportTm } from './screens/ImportTm.js'
import { Menu, type MenuAction } from './screens/Menu.js'
import { Review } from './screens/Review.js'
import { SyncGlossary } from './screens/SyncGlossary.js'
import { Translate } from './screens/Translate.js'

export interface AppProps {
  commands?: TuiCommands
  cwd?: string
  activity?: Activity
  onExit?: () => void
}

type Screen = 'menu' | MenuAction

export function App({ commands = defaultCommands, cwd = process.cwd(), activity, onExit }: AppProps) {
  const { exit } = useApp()
  const [ownActivity] = useState(createActivity)
  const [screen, setScreen] = useState<Screen>('menu')
  const back = () => setScreen('menu')
  const quit = () => {
    onExit?.()
    exit()
  }

  return (
    <ActivityProvider value={activity ?? ownActivity}>
      <CommandsProvider value={commands}>
        {screen === 'menu' && <Menu onSelect={setScreen} onQuit={quit} />}
        {screen === 'translate' && <Translate cwd={cwd} onBack={back} />}
        {screen === 'review' && <Review cwd={cwd} onBack={back} />}
        {screen === 'import-tm' && <ImportTm cwd={cwd} onBack={back} />}
        {screen === 'sync-glossary' && <SyncGlossary onBack={back} />}
        {screen === 'configure-keys' && <ConfigureKeys onBack={back} />}
      </CommandsProvider>
    </ActivityProvider>
  )
}
