import { Text } from 'ink'

export function Hint({ children }: { children: string }) {
  return <Text dimColor>{children}</Text>
}

export const BACK_HINT = 'esc/q back to menu'
export const DONE_HINT = 'enter/q back to menu'
