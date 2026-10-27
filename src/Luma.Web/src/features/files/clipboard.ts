import type { components } from '../../lib/api/generated'
export type FileClipboard = { kind: 'move' | 'copy'; entries: components['schemas']['FileClipboardEntry'][] }
let clipboard: FileClipboard | null = null
let paste: AbortController | null = null
const listeners = new Set<() => void>()
export const clipboardSnapshot = () => clipboard
export const pasteSnapshot = () => paste
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

// A paste belongs to the clipboard, rather than a toolbar that can remount while
// browsing. Claim synchronously so rapid clicks and shortcuts cannot duplicate it.
export function beginPaste(expected: FileClipboard) {
  if (paste || clipboard !== expected) return null
  paste = new AbortController()
  for (const listener of listeners) listener()
  return paste
}
export function finishPaste(controller: AbortController) {
  if (paste !== controller) return
  paste = null
  for (const listener of listeners) listener()
}
