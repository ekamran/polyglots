import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name)
    if (d.isDirectory()) return sources(path)
    return /\.tsx?$/.test(d.name) ? [path] : []
  })
}

// A literal NUL byte in a source file behaves like the escape it stands for,
// so nothing fails, but grep then treats the whole file as binary and returns
// nothing from it. A search that silently skips a file is how a rule or a
// shared regex gets missed during a refactor. Write '\0' instead.
describe('source files', () => {
  it('contain no literal NUL bytes', () => {
    const offenders = sources(join(root, 'src')).filter((file) => readFileSync(file).includes(0))
    expect(offenders.map((file) => relative(root, file))).toEqual([])
  })
})
