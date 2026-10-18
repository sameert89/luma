// The administrator capability stays in memory. It is never persisted with upload sessions.
let token = ''
const listeners = new Set<() => void>()
export const hasMutationAccess = () => !!token
export const subscribeMutationAccess = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function setMutationToken(value: string) {
  token = value
  for (const listener of listeners) listener()
}
export function mutationHeaders(path: string): Record<string, string> {
  return token && (path.startsWith('/api/files') || path.startsWith('/api/tasks') || path.startsWith('/api/panels'))
    ? { Authorization: `Bearer ${token}` }
    : {}
}
