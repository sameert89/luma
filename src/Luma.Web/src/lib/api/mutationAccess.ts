// The administrator capability stays in memory. It is never persisted with upload sessions.
let token = ''
export function setMutationToken(value: string) {
  token = value
}
export function mutationHeaders(path: string): Record<string, string> {
  return token && (path.startsWith('/api/files') || path.startsWith('/api/tasks'))
    ? { Authorization: `Bearer ${token}` }
    : {}
}
