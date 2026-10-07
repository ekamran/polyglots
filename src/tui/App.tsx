import { useEffect, useState } from 'react'
import { useApp } from 'ink'
import { CommandsProvider, defaultCommands, errorMessage, type TuiCommands } from './commands.js'
import type { AgentStatus } from '../agent/discover.js'
import { DEFAULT_PROVIDER } from '../agent/providers.js'
import type { ReviewProvider } from '../types.js'
import { ActivityProvider, createActivity, type Activity } from './hooks/activity.js'
import { Agents } from './screens/Agents.js'
import { ConfigureKeys } from './screens/ConfigureKeys.js'
import { Fetch } from './screens/Fetch.js'
import { ExportTm } from './screens/ExportTm.js'
import { ImportTm } from './screens/ImportTm.js'
import { LocaleRules } from './screens/LocaleRules.js'
import { Menu, type MenuAction } from './screens/Menu.js'
import { Review } from './screens/Review.js'
import { Split } from './screens/Split.js'
import { Stats } from './screens/Stats.js'
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
  // Held here rather than read by the menu, so the menu stays a screen that can
  // be rendered without touching the user's config, and so the injected
  // commands are what a test drives.
  const [provider, setProvider] = useState<ReviewProvider>(() => {
    try {
      return commands.loadConfig().reviewProvider
    } catch {
      return DEFAULT_PROVIDER
    }
  })
  const [configured] = useState(provider)
  const [providerError, setProviderError] = useState<string | undefined>(undefined)
  // Discovery is held here, not in the menu or the agents screen, so a re-check
  // on one is what the other shows. It never blocks: the menu renders at once
  // and treats "not known yet" as "every provider is a candidate".
  const [agents, setAgents] = useState<AgentStatus[] | undefined>(undefined)
  const [checking, setChecking] = useState(true)
  const [agentsError, setAgentsError] = useState<string | undefined>(undefined)
  const check = (refresh: boolean) => {
    setChecking(true)
    let wanted = true
    commands
      .discoverAgents(refresh ? { refresh: true } : undefined)
      .then(
        (result) => {
          if (!wanted) return
          setAgents(result)
          setAgentsError(undefined)
        },
        // A failed discovery falls back to the menu as it was before discovery
        // existed. Clearing the last answer would be wrong: it was true when
        // read, and a failed re-check does not make it less so.
        (err: unknown) => wanted && setAgentsError(errorMessage(err)),
      )
      .finally(() => wanted && setChecking(false))
    return () => {
      wanted = false
    }
  }
  useEffect(() => check(false), [])
  // The display only moves once the setting is written. A run reads the saved
  // config, so showing a provider that failed to save would name an agent no
  // review is going to use.
  const switchProvider = (next: ReviewProvider) => {
    try {
      commands.saveConfig({ reviewProvider: next })
      setProvider(next)
      setProviderError(undefined)
    } catch (err) {
      setProviderError(errorMessage(err))
    }
  }
  const back = () => setScreen('menu')
  const quit = () => {
    onExit?.()
    exit()
  }

  return (
    <ActivityProvider value={activity ?? ownActivity}>
      <CommandsProvider value={commands}>
        {screen === 'menu' && (
          <Menu
            onSelect={setScreen}
            onQuit={quit}
            provider={provider}
            onProvider={switchProvider}
            {...(providerError === undefined ? {} : { providerError })}
            {...(agents === undefined ? {} : { agents })}
            checking={checking}
            configured={configured}
          />
        )}
        {screen === 'agents' && (
          <Agents
            {...(agents === undefined ? {} : { agents })}
            checking={checking}
            {...(agentsError === undefined ? {} : { error: agentsError })}
            onRecheck={() => check(true)}
            onBack={back}
          />
        )}
        {screen === 'translate' && <Translate cwd={cwd} onBack={back} />}
        {screen === 'review' && <Review cwd={cwd} onBack={back} />}
        {screen === 'fetch' && <Fetch onBack={back} />}
        {screen === 'split' && <Split cwd={cwd} onBack={back} />}
        {screen === 'import-tm' && <ImportTm cwd={cwd} onBack={back} />}
        {screen === 'export-tm' && <ExportTm onBack={back} />}
        {screen === 'stats' && <Stats cwd={cwd} onBack={back} />}
        {screen === 'sync-glossary' && <SyncGlossary onBack={back} />}
        {screen === 'locale-rules' && <LocaleRules onBack={back} />}
        {screen === 'configure-keys' && <ConfigureKeys onBack={back} />}
      </CommandsProvider>
    </ActivityProvider>
  )
}
