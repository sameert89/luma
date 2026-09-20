import { useEffect, useRef, useState, type RefObject } from 'react'

// How far the finger travels before the pull commits, and how far the indicator can stretch.
export const pullThreshold = 72
const pullLimit = 120
// Half the finger's travel, so the gesture feels weighted rather than glued to the touch.
const pullResistance = 0.5

/**
 * Pull down at the top of a scroller to refresh it, the way a phone gallery does. Touch only:
 * a mouse has the actions menu, and starting the gesture requires the scroller to be at the top,
 * so ordinary scrolling is never intercepted.
 */
export function usePullToRefresh(scrollerRef: RefObject<HTMLElement | null>, onRefresh?: () => Promise<unknown> | void) {
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const handler = useRef(onRefresh)
  handler.current = onRefresh
  const enabled = !!onRefresh
  useEffect(() => {
    const element = scrollerRef.current
    if (!element || !enabled) return
    let origin: number | null = null
    let pulled = 0
    let running = false
    function begin(event: TouchEvent) {
      if (running || event.touches.length !== 1 || element!.scrollTop > 0) { origin = null; return }
      origin = event.touches[0].clientY
      pulled = 0
    }
    function move(event: TouchEvent) {
      if (origin === null) return
      const travel = event.touches[0].clientY - origin
      // Scrolling up, or a scroller that has moved away from the top, ends the gesture.
      if (travel <= 0 || element!.scrollTop > 0) { origin = null; pulled = 0; setDistance(0); return }
      pulled = Math.min(pullLimit, travel * pullResistance)
      setDistance(pulled)
      if (event.cancelable) event.preventDefault()
    }
    async function end() {
      if (origin === null) return
      const committed = pulled >= pullThreshold
      origin = null
      pulled = 0
      setDistance(0)
      if (!committed) return
      running = true
      setRefreshing(true)
      try { await handler.current?.() } finally { running = false; setRefreshing(false) }
    }
    // Not passive: a committed pull must be able to stop the browser from scrolling with it.
    element.addEventListener('touchstart', begin, { passive: true })
    element.addEventListener('touchmove', move, { passive: false })
    element.addEventListener('touchend', end)
    element.addEventListener('touchcancel', end)
    return () => {
      element.removeEventListener('touchstart', begin)
      element.removeEventListener('touchmove', move)
      element.removeEventListener('touchend', end)
      element.removeEventListener('touchcancel', end)
    }
  }, [scrollerRef, enabled])
  return { distance, refreshing }
}
