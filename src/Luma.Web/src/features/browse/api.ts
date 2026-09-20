import type { components, operations } from '../../lib/api/generated'
import { ApiError } from '../../lib/api/client'

export type Media = components['schemas']['MediaSummary']
export type MediaPage = components['schemas']['MediaPage']
export type Filters = NonNullable<operations['GetMedia']['parameters']['query']>
export type Tag = components['schemas']['TagSummary']
export type Library = components['schemas']['LibrarySummary']
export type FolderPage = components['schemas']['FolderPage']
export type Neighbors = components['schemas']['MediaNeighbors']
export type IndexingStatus = components['schemas']['IndexingStatus']
export type Scan = components['schemas']['ScanProgress']

// The server already retries interactive writes briefly; these cover a lock that outlasts that,
// so background work never surfaces as an error unless the database stays locked.
const busyRetryMs = [300, 1000]

export async function request<T>(path: string, signal?: AbortSignal, method = 'GET', body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(path, {
      signal,
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const problem = response.headers.get('content-type')?.includes('application/problem+json')
        ? await response.json()
        : undefined
      if (
        method !== 'GET' &&
        response.status === 503 &&
        problem?.code === 'database_busy' &&
        attempt < busyRetryMs.length
      ) {
        await new Promise(resolve => setTimeout(resolve, busyRetryMs[attempt]))
        signal?.throwIfAborted()
        continue
      }
      throw new ApiError(response.status, problem)
    }
    return (response.status === 204 ? undefined : await response.json()) as T
  }
}
export function queryString(filters: Filters) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item))
  }
  return params.toString()
}
export const mediaPage = (filters: Filters, cursor: string | undefined, signal?: AbortSignal) =>
  request<MediaPage>(`/api/media?${queryString({ ...filters, limit: 60, cursor })}`, signal)
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'
// GIFs are indexed as images, but only their original animates.
export const isGif = (item: Pick<Media, 'extension'>) => item.extension?.toLowerCase() === '.gif'
// Indexing prepares thumbnails only; an image's large preview is prepared when it is first opened.
// Until then the viewer shows the original, which browsers decode directly for these formats.
const browserImages = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
export const originalStandsIn = (item: Pick<Media, 'mediaType' | 'extension' | 'preview'>) =>
  item.mediaType === 'image' &&
  item.preview.status !== 'ready' &&
  browserImages.has(item.extension?.toLowerCase() ?? '')
/** The URL the viewer shows for a photo, or null while a preview it cannot do without is prepared. */
export const imageUrl = (item: Pick<Media, 'id' | 'mediaType' | 'extension' | 'preview'>) =>
  isGif(item) || originalStandsIn(item)
    ? `/api/media/${item.id}/original`
    : item.preview.status === 'ready'
      ? item.preview.url
      : null
