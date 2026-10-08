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

// Tab, line feed and carriage return are text. Every other C0 control byte,
// and DEL, is not.
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

// A literal NUL byte in a source file behaves like the escape it stands for,
// so nothing fails, but grep then treats the whole file as binary and returns
// nothing from it. A search that silently skips a file is how a rule or a
// shared regex gets missed during a refactor.
//
// The other control bytes do not blind grep, but they are invisible: a literal
// Ctrl-C reads as const CTRL_C = '' in an editor and in a diff, and file(1)
// calls the source "data". Tests are held to the same rule because their
// helpers are where key codes and the msgctxt separator are spelled out.
// Write the escape instead: '\0', '\x03', '\x04', '\x1b'.
describe('source files', () => {
  it('contain no literal control bytes', () => {
    const files = [...sources(join(root, 'src')), ...sources(join(root, 'test'))]
    const offenders = files.filter((file) => CONTROL.test(readFileSync(file, 'utf8')))
    expect(offenders.map((file) => relative(root, file))).toEqual([])
  })
})
