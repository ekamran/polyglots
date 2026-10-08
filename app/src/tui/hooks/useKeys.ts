import { useGlobalInput, useInput, type Key } from '../input.js'
import { KEYS, type BoundId, type Group, type KeyEntry } from '../keys.js'

/**
 * What a key does on this render. Undefined means the key is not live right
 * now, which is how a screen says "only while a run is going" or "not while
 * the name field has focus": the entry stays required, so dropping it from
 * the table still fails typecheck, but it can be switched off. Returning
 * false declines the key, and matching carries on down the table, which is
 * how a menu's letter falls through to a card when it is not a command.
 */
export type KeyHandler = (input: string, key: Key) => void | boolean

export type GroupHandlers<G extends Group> = { [K in BoundId<G>]: KeyHandler | undefined }

/**
 * Handlers for one or more groups of the key table, every bound id of each
 * group required. Groups are matched in the order they are written here, and
 * within a group in the table's order; the first entry that matches and has a
 * live handler takes the key.
 */
export type KeyBindings = { [G in Group]?: GroupHandlers<G> }

/** One key through a set of bindings. True when something took it. */
export function dispatchKeys(bindings: KeyBindings, input: string, key: Key): boolean {
  for (const group of Object.keys(bindings) as Group[]) {
    const handlers = bindings[group] as Record<string, KeyHandler | undefined>
    const entries = KEYS[group] as Record<string, KeyEntry>
    for (const [id, entry] of Object.entries(entries)) {
      if (!('match' in entry)) continue
      const handler = handlers[id]
      if (handler === undefined || !entry.match(input, key)) continue
      if (handler(input, key) !== false) return true
    }
  }
  return false
}

/**
 * Binds keys from the table, behind the input gate. One call is one Ink
 * listener, so keys that used to share a handler and depend on its order
 * share a call; keys that were separate listeners stay separate calls.
 *
 * The groups must be an object literal at the call: the drift test reads them
 * off the source to check each screen binds what it lists.
 */
export function useKeys(bindings: KeyBindings, options: { isActive?: boolean } = {}): void {
  useInput((input, key) => void dispatchKeys(bindings, input, key), options)
}

/** The frame's keys, which no gate closes. Nothing but the frame should use it. */
export function useGlobalKeys(bindings: KeyBindings): void {
  useGlobalInput((input, key) => void dispatchKeys(bindings, input, key))
}
