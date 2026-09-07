import { homedir } from 'node:os'
import { join } from 'node:path'

function overrideRoot(): string | undefined {
  const value = process.env.POLYGLOTS_HOME
  return value && value.length > 0 ? value : undefined
}

export function configDir(): string {
  const root = overrideRoot()
  return root ? join(root, 'config') : join(homedir(), '.config', 'polyglots')
}

export function dataDir(): string {
  const root = overrideRoot()
  return root ? join(root, 'data') : join(homedir(), '.local', 'share', 'polyglots')
}

export function configFile(): string {
  return join(configDir(), 'config.json')
}

export function secretsFile(): string {
  return join(configDir(), '.env')
}

export function dbFile(): string {
  return join(dataDir(), 'polyglots.db')
}
