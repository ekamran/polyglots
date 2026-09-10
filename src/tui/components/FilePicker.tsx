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

export type EntryKind = 'dir' | 'file'

interface Entry {
  path: string
  kind: EntryKind
}

// A matching file stays yellow even while selected: the ❯ indicator and the bold
// weight already mark the cursor, so colour is free to keep meaning "this is the
// thing you came here to pick".
export function itemColor(kind: EntryKind | undefined, isSelected: boolean): string | undefined {
  if (kind === 'file') return 'yellow'
  return isSelected ? 'cyan' : undefined
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

  // Matching files come before directories: a plugin checkout can hold dozens of
  // folders, and listing those first buries the one file the picker exists to find.
  const byName = (a: string, b: string) => a.localeCompare(b)
  for (const name of files.sort(byName)) items.push({ key: name, label: name, value: { path: join(cwd, name), kind: 'file' } })
  for (const name of dirs.sort(byName)) items.push({ key: name, label: `${name}/`, value: { path: join(cwd, name), kind: 'dir' } })
  return { items, error }
}

export function FilePicker({ dir, extensions, onPick, limit = 15 }: FilePickerProps) {
  const [cwd, setCwd] = useState(dir)
  const listing = useMemo(() => list(cwd, extensions), [cwd, extensions])
  const hasFiles = listing.items.some((i) => i.value.kind === 'file')

  // ink-select-input hands its item component only the label, so the kind is
  // looked up by label; a directory's label carries a trailing slash, so a file
  // and a folder of the same name never collide.
  const ItemView = useMemo(() => {
    const kinds = new Map(listing.items.map((i) => [i.label, i.value.kind]))
    return function Item({ isSelected, label }: { isSelected?: boolean; label: string }) {
      const selected = isSelected === true
      return (
        <Text color={itemColor(kinds.get(label), selected)} bold={selected}>
          {label}
        </Text>
      )
    }
  }, [listing])

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
        itemComponent={ItemView}
        limit={limit}
        onSelect={(item) => (item.value.kind === 'dir' ? setCwd(item.value.path) : onPick(item.value.path))}
      />
    </Box>
  )
}
