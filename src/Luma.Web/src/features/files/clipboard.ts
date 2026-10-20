import type { components } from '../../lib/api/generated'
export type FileClipboard = { kind: 'move' | 'copy'; entries: components['schemas']['FileClipboardEntry'][] }
let clipboard: FileClipboard | null = null
const listeners = new Set<() => void>()
export const clipboardSnapshot = () => clipboard
export const subscribeClipboard = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function setClipboard(value: FileClipboard | null) {
  clipboard = value
  for (const listener of listeners) listener()
}
