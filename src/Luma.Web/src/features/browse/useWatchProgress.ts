import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { request, type Media } from './api'
import type { components } from '../../lib/api/generated'

type Progress = components['schemas']['WatchState']

export function useWatchProgress(item: Media, video: RefObject<HTMLVideoElement | null>, reels: boolean) {
  const client = useQueryClient()
  const [dismissed, setDismissed] = useState<number | null>(null)
  const latest = useRef<Progress | null>(null)
  const progress = useQuery({ queryKey: ['watch-progress', item.id], queryFn: ({ signal }) => request<Progress>(`/api/media/${item.id}/progress`, signal), enabled: item.mediaType === 'video', initialData: item.watchProgress ?? undefined, gcTime: 0 })
  latest.current = progress.data ?? null
  const resume = !reels && dismissed !== item.id && progress.data?.state === 'in_progress' && progress.data.positionSeconds > 5 ? progress.data.positionSeconds : null
  useEffect(() => {
    const player = video.current
    if (!player || item.mediaType !== 'video') return
    let last = performance.now()
    let playing = !player.paused
    let watched = 0
    let snapshot: { positionSeconds: number; durationSeconds: number } | null = null
    let saving = false
    let flushRequested = false
    function accrue() {
      const now = performance.now()
      if (playing && !player!.seeking && player!.readyState >= 2) watched += Math.min(2, (now - last) / 1000)
      last = now
      if (Number.isFinite(player!.duration) && player!.duration > 0) snapshot = { positionSeconds: Math.min(player!.currentTime, player!.duration), durationSeconds: player!.duration }
    }
    function save() {
      accrue()
      if (saving || !watched || !snapshot) return
      const delta = Math.min(30, watched); watched -= delta
      const body = { ...snapshot, watchedSeconds: delta }
      saving = true
      void (async () => {
        const response = await fetch(`/api/media/${item.id}/progress`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (!response.ok) throw new Error('Could not save playback progress')
        const value = await response.json() as Progress
        if (client.getQueryCache().find({ queryKey: ['watch-progress', item.id] })) client.setQueryData(['watch-progress', item.id], value)
        void client.invalidateQueries({ queryKey: ['media'] })
        void client.invalidateQueries({ queryKey: ['detail', item.id] })
      })().catch(() => { watched += delta }).finally(() => { saving = false; if (flushRequested) { flushRequested = false; save() } })
    }
    function start() { accrue(); playing = true; setDismissed(item.id) }
    function stop() { accrue(); playing = false; save() }
    function pagehide() { save() }
    const tick = window.setInterval(accrue, 1000)
    const timer = window.setInterval(save, 10000)
    player.addEventListener('playing', start)
    player.addEventListener('pause', stop)
    player.addEventListener('ended', stop)
    player.addEventListener('waiting', stop)
    window.addEventListener('pagehide', pagehide)
    return () => { flushRequested = true; save(); window.clearInterval(tick); window.clearInterval(timer); player.removeEventListener('playing', start); player.removeEventListener('pause', stop); player.removeEventListener('ended', stop); player.removeEventListener('waiting', stop); window.removeEventListener('pagehide', pagehide) }
  }, [item.id, item.mediaType, video, client])
  function choose(fromBeginning: boolean) {
    const player = video.current
    if (player) { player.currentTime = fromBeginning ? 0 : latest.current?.positionSeconds ?? 0; void player.play().catch(() => {}) }
    setDismissed(item.id)
  }
  return { resume, choose }
}
