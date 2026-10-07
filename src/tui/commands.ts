import { createContext, useContext, useState } from 'react'
import { discoverAgents } from '../agent/discover.js'
import { checkOllamaModel, discoverModels } from '../draft/discover.js'
import { fetchProjects, resolveProjects } from '../commands/fetch.js'
import { syncGlossary } from '../commands/glossary-sync.js'
import { exportTm } from '../commands/tm-export.js'
import { importTmx } from '../commands/tm-import.js'
import { reviewFile } from '../commands/review.js'
import { splitPo } from '../commands/split.js'
import { writeStats } from '../commands/stats.js'
import { translateFile } from '../commands/translate.js'
import { DEFAULT_CONFIG, loadConfig, saveConfig, loadSecrets, saveSecret } from '../config.js'
import type { Locale, PolyglotsConfig, ReviewEvent, ReviewSummary } from '../types.js'

export type ReviewFile = typeof reviewFile
export type ReviewFileOptions = Parameters<ReviewFile>[0]

export interface TuiCommands {
  translateFile: typeof translateFile
  importTmx: typeof importTmx
  exportTm: typeof exportTm
  syncGlossary: typeof syncGlossary
  reviewFile: typeof reviewFile
  splitPo: typeof splitPo
  writeStats: typeof writeStats
  resolveProjects: typeof resolveProjects
  fetchProjects: typeof fetchProjects
  loadConfig: typeof loadConfig
  saveConfig: typeof saveConfig
  loadSecrets: typeof loadSecrets
  saveSecret: typeof saveSecret
  discoverAgents: typeof discoverAgents
  discoverModels: typeof discoverModels
  checkOllamaModel: typeof checkOllamaModel
}

export const defaultCommands: TuiCommands = {
  translateFile,
  importTmx,
  exportTm,
  syncGlossary,
  reviewFile,
  splitPo,
  writeStats,
  resolveProjects,
  fetchProjects,
  loadConfig,
  saveConfig,
  loadSecrets,
  saveSecret,
  discoverAgents,
  discoverModels,
  checkOllamaModel,
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
