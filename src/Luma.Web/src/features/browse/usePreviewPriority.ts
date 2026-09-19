import { useEffect, useRef, useState } from 'react'
import { request, type Media } from './api'

// The endpoint accepts a bounded batch and prepares it in the order it is given.
const batchLimit = 200
const settleMs = 300
const retryMs = 3000
const retryLimit = 3

/**
 * Asks the server to prepare the thumbnails the person is actually looking at.
 * Callers pass items in the order they are displayed, starting at the top of the
 * viewport, so preparation arrives in that same order instead of by media ID.
 * With `previews`, open photos also get their large preview, which indexing skips.
 */
export function usePreviewPriority(items: readonly (Media | null | undefined)[], previews = false) {
  const requested = useRef('')
  const [attempt, setAttempt] = useState(0)
  const signature = items
    .filter(item => item && (item.thumbnail.status === 'pending'
      || previews && item.mediaType === 'image' && item.preview.status !== 'ready' && item.preview.status !== 'failed'))
    .slice(0, batchLimit).map(item => item!.id).join(',')
  useEffect(() => {
    if (!signature || signature === requested.current) return
    // Scrolling re-orders the batch on every frame; send the settled order only.
    const timer = window.setTimeout(() => {
      requested.current = signature
      void request('/api/media/priority', undefined, 'POST', { ids: signature.split(',').map(Number), previews })
        .then(() => setAttempt(value => value === 0 ? value : 0))
        .catch(() => { if (attempt < retryLimit) { requested.current = ''; setAttempt(value => value + 1) } })
    }, attempt === 0 ? settleMs : retryMs)
    return () => window.clearTimeout(timer)
  }, [signature, attempt, previews])
}
