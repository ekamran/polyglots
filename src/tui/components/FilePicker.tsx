import { readdirSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import SelectInput from 'ink-select-input'

export interface FilePickerProps {
  dir: string
  extensions: string[]
  onPick: (path: string) => void
  limit?: number
}

interface Entry {
  path: string
  kind: 'dir' | 'file'
}

interface Listing {
  items: { key: string; label: string; value: Entry }[]
  error?: string
}

function isDirectory(path: string, entry: { isDirectory(): boolean; isSymbolicLink(): boolean }): boolean {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function list(cwd: string, extensions: string[]): Listing {
  const items: Listing['items'] = []
  const parent = dirname(cwd)
  if (parent !== cwd) items.push({ key: '..', label: '..', value: { path: parent, kind: 'dir' } })

  let error: string | undefined
  const dirs: string[] = []
  const files: string[] = []
  try {
    for (const entry of readdirSync(cwd, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(cwd, entry.name)
      if (isDirectory(path, entry)) dirs.push(entry.name)
      else if (extensions.includes(extname(entry.name).toLowerCase())) files.push(entry.name)
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const byName = (a: string, b: string) => a.localeCompare(b)
  for (const name of dirs.sort(byName)) items.push({ key: name, label: `${name}/`, value: { path: join(cwd, name), kind: 'dir' } })
  for (const name of files.sort(byName)) items.push({ key: name, label: name, value: { path: join(cwd, name), kind: 'file' } })
  return { items, error }
}

export function FilePicker({ dir, extensions, onPick, limit = 15 }: FilePickerProps) {
  const [cwd, setCwd] = useState(dir)
  const listing = useMemo(() => list(cwd, extensions), [cwd, extensions])
  const hasFiles = listing.items.some((i) => i.value.kind === 'file')

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>Browsing </Text>
        {cwd}
      </Text>
      {listing.error && <Text color="red">Cannot read directory: {listing.error}</Text>}
      {!hasFiles && <Text dimColor>(no {extensions.join('/')} files here)</Text>}
      <SelectInput
        items={listing.items}
        limit={limit}
        onSelect={(item) => (item.value.kind === 'dir' ? setCwd(item.value.path) : onPick(item.value.path))}
      />
    </Box>
  )
}
