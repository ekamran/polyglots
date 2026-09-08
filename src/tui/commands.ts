import { createContext, useContext, useState } from 'react'
import { syncGlossary } from '../commands/glossary-sync.js'
import { importTmx } from '../commands/tm-import.js'
import { translateFile } from '../commands/translate.js'
import { DEFAULT_CONFIG, loadConfig, loadSecrets, saveSecret } from '../config.js'
import type { PolyglotsConfig } from '../types.js'

export interface TuiCommands {
  translateFile: typeof translateFile
  importTmx: typeof importTmx
  syncGlossary: typeof syncGlossary
  loadConfig: typeof loadConfig
  loadSecrets: typeof loadSecrets
  saveSecret: typeof saveSecret
}

export const defaultCommands: TuiCommands = {
  translateFile,
  importTmx,
  syncGlossary,
  loadConfig,
  loadSecrets,
  saveSecret,
}

const CommandsContext = createContext<TuiCommands>(defaultCommands)

export const CommandsProvider = CommandsContext.Provider

export function useCommands(): TuiCommands {
  return useContext(CommandsContext)
}

export interface LoadedConfig {
  config: PolyglotsConfig
  error?: string
}

export function useConfig(): LoadedConfig {
  const commands = useCommands()
  const [loaded] = useState<LoadedConfig>(() => {
    try {
      return { config: commands.loadConfig() }
    } catch (err) {
      return { config: DEFAULT_CONFIG, error: errorMessage(err) }
    }
  })
  return loaded
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
