import { useQueryClient } from '@tanstack/react-query'
import type { Comic } from './api'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { rememberReadingCheckpoint, confirmReadingCheckpoint } from './readingCheckpoint'
import { shuffleSeed } from '../browse/shuffleSeed'
import { request, errorMessage } from '../browse/api'

export function useReadingSession(id: number, page: number, direction: string, settings: object) {
  const client = useQueryClient()
  const latest = useRef({ page, direction, settings })
  latest.current = { page, direction, settings }
  const flush = useRef<() => Promise<void>>(async () => {})
  const [error, setError] = useState('')
  useEffect(() => {
    const seed = shuffleSeed()
    const sessionId = [
      seed.slice(0, 8),
      seed.slice(8, 12),
      seed.slice(12, 16),
      seed.slice(16, 20),
      seed.slice(20),
    ].join('-')
    let sequence = 0,
      activeSeconds = 0,
      interaction = performance.now(),
      sample = performance.now()
    let visible = !document.hidden,
      queued = false,
      disposed = false
    let inFlight: Promise<void> | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let pending: {
      sessionId: string
      sequence: number
      pageIndex: number
      activeSeconds: number
      direction: string
      settings: string
    } | null = null
    const activity = () => {
      measure()
      interaction = performance.now()
    }
    function measure() {
      const now = performance.now()
      if (visible) activeSeconds += Math.max(0, Math.min(now, interaction + 120000) - sample) / 1000
      sample = now
    }
    async function save(): Promise<void> {
      queued = true
      if (inFlight) return inFlight
      clearTimeout(retry)
      inFlight = (async () => {
        while (queued) {
          queued = false
          measure()
          if (!pending)
            pending = {
              sessionId,
              sequence: ++sequence,
              pageIndex: latest.current.page,
              activeSeconds: Math.min(activeSeconds, 30),
              direction: latest.current.direction,
              settings: JSON.stringify(latest.current.settings),
            }
          const checkpoint = pending
          const controller = new AbortController()
          const deadline = setTimeout(() => controller.abort(), 8000)
          try {
            await request(`/api/panels/comics/${id}/progress`, controller.signal, 'PUT', checkpoint)
            failures = 0
            confirmReadingCheckpoint(id, {
              pageIndex: checkpoint.pageIndex,
              direction: checkpoint.direction,
              settings: checkpoint.settings,
            })
            activeSeconds = Math.max(0, activeSeconds - checkpoint.activeSeconds)
            pending = null
            client.setQueryData<Comic>(['comic', id], previous =>
              previous
                ? {
                    ...previous,
                    pageIndex: checkpoint.pageIndex,
                    direction: checkpoint.direction,
                    settings: checkpoint.settings,
                    state: checkpoint.pageIndex === previous.pageCount - 1 ? 'completed' : 'reading',
                  }
                : previous,
            )
            for (const key of ['comics', 'continue-reading', 'reading-statistics'])
              void client.invalidateQueries({ queryKey: [key], refetchType: 'none' })
            if (!disposed) setError('')
            // Retry a dropped response with its original sequence before draining the latest page.
            if (
              checkpoint.pageIndex !== latest.current.page ||
              checkpoint.direction !== latest.current.direction ||
              checkpoint.settings !== JSON.stringify(latest.current.settings)
            )
              queued = true
          } catch (error) {
            if (!disposed) {
              setError(errorMessage(error))
              retry = setTimeout(() => void save(), Math.min(1000 * 2 ** failures++, 15000))
            }
            break
          } finally {
            clearTimeout(deadline)
          }
        }
      })()
      try {
        await inFlight
      } finally {
        inFlight = null
      }
    }
    const saveOnReturn = () => void save()
    const visibility = () => {
      measure()
      visible = !document.hidden
      void save()
    }
    const pageHide = () => {
      measure()
      visible = false
      void save()
    }
    for (const event of ['pointerdown', 'keydown', 'wheel', 'scroll'])
      window.addEventListener(event, activity, { passive: true, capture: true })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', pageHide)
    window.addEventListener('online', saveOnReturn)
    window.addEventListener('focus', saveOnReturn)
    const timer = setInterval(measure, 1000),
      heartbeat = setInterval(() => void save(), 15000)
    flush.current = save
    void save()
    return () => {
      measure()
      visible = false
      disposed = true
      clearTimeout(retry)
      void save()
      flush.current = async () => {}
      clearInterval(timer)
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', pageHide)
      window.removeEventListener('online', saveOnReturn)
      window.removeEventListener('focus', saveOnReturn)
      for (const event of ['pointerdown', 'keydown', 'wheel', 'scroll'])
        window.removeEventListener(event, activity, true)
    }
  }, [id, client])
  const preferences = JSON.stringify(settings)
  useLayoutEffect(() => {
    rememberReadingCheckpoint(id, { pageIndex: page, direction, settings: preferences })
  }, [id, page, direction, preferences])
  useEffect(() => {
    void flush.current()
  }, [page, direction, preferences])
  return { error, flush: () => flush.current() }
}
