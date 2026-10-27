import { useEffect, useLayoutEffect, useRef } from 'react'

// Native scroll keeps finger tracking and momentum out of React. Only a settled
// snap changes the active item; the three keyed media stages are then re-centred.
export function useReelScroll({
  currentId,
  previousId,
  nextId,
  disabled,
  onSelect,
  onInteractingChange,
}: {
  currentId?: number
  previousId?: number
  nextId?: number
  disabled: boolean
  onSelect: (id: number) => void
  onInteractingChange: (interacting: boolean) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const touching = useRef(false)
  const moving = useRef(false)
  const rebasing = useRef(false)
  const timer = useRef(0)
  const frame = useRef(0)
  function center() {
    const host = viewport.current
    const current = host?.querySelector<HTMLElement>(`[data-reel-id="${currentId}"]`)
    if (!host || !current) return
    rebasing.current = true
    host.style.scrollSnapType = 'none'
    host.scrollTop = current.offsetTop
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      host.style.scrollSnapType = ''
      rebasing.current = false
    })
  }
  useLayoutEffect(() => {
    if (disabled) {
      touching.current = false
      moving.current = false
      onInteractingChange(false)
      window.clearTimeout(timer.current)
    }
    if (!touching.current && (!moving.current || disabled)) center()
  }, [currentId, previousId, nextId, disabled])
  useLayoutEffect(() => {
    moving.current = false
    center()
  }, [currentId])
  useEffect(() => {
    const host = viewport.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!touching.current && !moving.current) center()
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [currentId])
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      cancelAnimationFrame(frame.current)
    },
    [],
  )
  function settle() {
    window.clearTimeout(timer.current)
    const host = viewport.current
    if (!host || disabled || touching.current || rebasing.current || !host.clientHeight) return
    moving.current = false
    onInteractingChange(false)
    const cards = [...host.querySelectorAll<HTMLElement>('[data-reel-id]')]
    const closest = cards.reduce<HTMLElement | null>(
      (best, card) =>
        !best || Math.abs(card.offsetTop - host.scrollTop) < Math.abs(best.offsetTop - host.scrollTop) ? card : best,
      null,
    )
    if (closest && Number(closest.dataset.reelId) !== currentId) onSelect(Number(closest.dataset.reelId))
  }
  function scroll() {
    if (rebasing.current) return
    if (!moving.current) onInteractingChange(true)
    moving.current = true
    window.clearTimeout(timer.current)
    // scrollend is available in current browsers; this also covers older WebViews.
    timer.current = window.setTimeout(settle, 140)
  }
  function navigate(direction: 'next' | 'previous') {
    if (disabled || touching.current) return
    const id = direction === 'next' ? nextId : previousId
    const host = viewport.current
    const target = host?.querySelector<HTMLElement>(`[data-reel-id="${id}"]`)
    if (!host || !target) return
    cancelAnimationFrame(frame.current)
    rebasing.current = false
    host.style.scrollSnapType = ''
    const preference = document.documentElement.dataset.animation
    const reduced =
      preference === 'off' ||
      preference === 'reduced' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    host.scrollTo({ top: target.offsetTop, behavior: reduced ? 'instant' : 'smooth' })
  }
  return {
    viewport,
    navigate,
    events: {
      onScroll: scroll,
      onScrollEnd: settle,
      onTouchStart: () => {
        touching.current = true
        onInteractingChange(true)
      },
      onTouchEnd: () => {
        touching.current = false
        scroll()
      },
      onTouchCancel: () => {
        touching.current = false
        scroll()
      },
    },
  }
}
