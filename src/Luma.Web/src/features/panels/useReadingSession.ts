import { useEffect, useRef, useState } from 'react'
import { request, errorMessage } from '../browse/api'

export function useReadingSession(id: number, page: number, direction: string, settings: object) {
  const latest = useRef({ page, direction, settings })
  latest.current = { page, direction, settings }
  const flush = useRef<() => void>(() => {})
  const [error, setError] = useState('')
  useEffect(() => {
    const sessionId = crypto.randomUUID()
    let sequence = 0,
      activeSeconds = 0,
      interaction = performance.now(),
      sample = performance.now()
    let visible = !document.hidden,
      sending = false,
      queued = false,
      disposed = false
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
    async function save() {
      measure()
      if (sending) {
        queued = true
        return
      }
      if (!pending)
        pending = {
          sessionId,
          sequence: ++sequence,
          pageIndex: latest.current.page,
          activeSeconds: Math.min(activeSeconds, 30),
          direction: latest.current.direction,
          settings: JSON.stringify(latest.current.settings),
        }
      sending = true
      let succeeded = false
      try {
        await request(`/api/panels/comics/${id}/progress`, undefined, 'PUT', pending)
        activeSeconds = Math.max(0, activeSeconds - pending.activeSeconds)
        pending = null
        succeeded = true
        if (!disposed) setError('')
      } catch (error) {
        if (!disposed) setError(errorMessage(error))
      } finally {
        sending = false
        // Drain changes received during a request. Failed requests keep their exact sequence and body for retry.
        if (queued && succeeded) {
          queued = false
          void save()
        }
      }
    }
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
    const timer = setInterval(measure, 1000),
      heartbeat = setInterval(() => void save(), 15000)
    flush.current = () => void save()
    void save()
    return () => {
      measure()
      visible = false
      disposed = true
      void save()
      flush.current = () => {}
      clearInterval(timer)
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', pageHide)
      for (const event of ['pointerdown', 'keydown', 'wheel', 'scroll'])
        window.removeEventListener(event, activity, true)
    }
  }, [id])
  const preferences = JSON.stringify(settings)
  useEffect(() => {
    flush.current()
  }, [page, direction, preferences])
  return error
}
