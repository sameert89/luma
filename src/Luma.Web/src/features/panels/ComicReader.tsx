import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Minus, Plus } from 'lucide-react'
import { IconButton, QuietButton, Select, Input } from '../../components/ui/Controls'
import { useReadingSession } from './useReadingSession'
import type { Comic } from './api'

function readerPreferences(settings: string) {
  try {
    const value = JSON.parse(settings)
    return {
      mode: value.mode === 'continuous' ? 'continuous' : 'single',
      fit: ['width', 'height', 'original'].includes(value.fit) ? value.fit : 'screen',
    }
  } catch {
    return { mode: 'single', fit: 'screen' }
  }
}

export function ComicReader({ comic, onExit }: { comic: Comic; onExit: () => void }) {
  const [page, setPage] = useState(comic.pageIndex)
  const [direction, setDirection] = useState(comic.direction)
  const [preferences] = useState(() => readerPreferences(comic.settings))
  const [mode, setMode] = useState(preferences.mode)
  const [fit, setFit] = useState(preferences.fit)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [imageError, setImageError] = useState(false)
  const [controls, setControls] = useState(true)
  const root = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)
  const error = useReadingSession(comic.id, page, direction, { mode, fit })
  const move = (delta: number) => {
    setPage(value => {
      const next = Math.max(0, Math.min(comic.pageCount - 1, value + delta))
      if (mode === 'continuous') virtual.scrollToIndex(next, { align: 'start' })
      return next
    })
    setImageError(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  const virtual = useVirtualizer({
    count: comic.pageCount,
    getScrollElement: () => scroll.current,
    estimateSize: () => 1000,
    overscan: 1,
  })
  useEffect(() => {
    if (mode === 'continuous') virtual.scrollToIndex(page, { align: 'start' })
    // Resume the current page when entering continuous mode.
  }, [mode])
  const pageUrl = (index: number) =>
    `/api/panels/comics/${comic.id}/pages/${index}${fit === 'original' || zoom > 1 ? '?original=true' : ''}`
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen()
        else onExit()
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        move(direction === 'rtl' ? -1 : 1)
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        move(direction === 'rtl' ? 1 : -1)
      }
      if (event.key.toLowerCase() === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void root.current?.requestFullscreen?.()
      }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [direction, onExit, mode])
  useEffect(() => {
    const images = [page - 1, page + 1]
      .filter(index => index >= 0 && index < comic.pageCount)
      .map(index => {
        const image = new Image()
        image.src = `/api/panels/comics/${comic.id}/pages/${index}`
        return image
      })
    return () => {
      for (const image of images) image.src = ''
    }
  }, [comic.id, comic.pageCount, page])
  function down(event: React.PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }
  function pointerMove(event: React.PointerEvent) {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.current) setZoom(value => Math.max(1, Math.min(8, (value * distance) / pinch.current!)))
      pinch.current = distance
    } else if (zoom > 1)
      setPan(value => ({ x: value.x + event.clientX - previous.x, y: value.y + event.clientY - previous.y }))
  }
  const start = useRef<{ x: number; y: number } | null>(null)
  return (
    <div ref={root} className="relative flex min-h-0 flex-1 flex-col bg-canvas text-ink" aria-label="Comic reader">
      <div className="flex shrink-0 items-center gap-2 border-b border-line p-3">
        <IconButton label="Exit reader" onClick={onExit}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{comic.title}</h1>
        <QuietButton onClick={() => setControls(!controls)}>{controls ? 'Hide controls' : 'Show controls'}</QuietButton>
      </div>
      {controls && (
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Select
            aria-label="Reading mode"
            className="w-auto"
            value={mode}
            onChange={event => setMode(event.target.value)}
          >
            <option value="single">Single page</option>
            <option value="continuous">Continuous scroll</option>
          </Select>
          <Select
            aria-label="Reading direction"
            className="w-auto"
            value={direction}
            onChange={event => setDirection(event.target.value)}
          >
            <option value="ltr">Left to right</option>
            <option value="rtl">Right to left</option>
          </Select>
          <Select aria-label="Page fit" className="w-auto" value={fit} onChange={event => setFit(event.target.value)}>
            <option value="screen">Fit screen</option>
            <option value="width">Fit width</option>
            <option value="height">Fit height</option>
            <option value="original">Original resolution</option>
          </Select>
          <IconButton label="Zoom out" onClick={() => setZoom(value => Math.max(1, value - 0.5))}>
            <Minus className="size-4" />
          </IconButton>
          <IconButton label="Zoom in" onClick={() => setZoom(value => Math.min(8, value + 0.5))}>
            <Plus className="size-4" />
          </IconButton>
          <IconButton
            label="Fullscreen"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen()
              else void root.current?.requestFullscreen?.()
            }}
          >
            <Maximize className="size-4" />
          </IconButton>
        </div>
      )}
      {error && (
        <p role="alert" className="px-3 text-sm text-danger">
          Progress could not be saved: {error}
        </p>
      )}
      {imageError && (
        <p role="alert" className="px-3 text-sm text-danger">
          This page could not be loaded. Try another page or rediscover the comic.
        </p>
      )}
      {mode === 'single' ? (
        <div
          role="group"
          aria-label="Comic page gestures"
          className={`relative flex min-h-0 flex-1 ${fit === 'width' || fit === 'original' ? 'items-start overflow-auto' : 'items-center overflow-hidden'} justify-center`}
          style={{ touchAction: zoom === 1 && (fit === 'width' || fit === 'original') ? 'pan-y' : 'none' }}
          onPointerDown={event => {
            start.current = { x: event.clientX, y: event.clientY }
            down(event)
          }}
          onPointerMove={pointerMove}
          onPointerUp={event => {
            const origin = start.current
            pointers.current.delete(event.pointerId)
            pinch.current = null
            if (zoom === 1 && origin && Math.abs(event.clientX - origin.x) > 60)
              move((event.clientX > origin.x ? -1 : 1) * (direction === 'rtl' ? -1 : 1))
            start.current = null
          }}
          onPointerCancel={() => {
            pointers.current.clear()
            pinch.current = null
            start.current = null
          }}
          onDoubleClick={() => {
            setZoom(value => (value === 1 ? 2 : 1))
            setPan({ x: 0, y: 0 })
          }}
          onWheel={event => {
            if (event.ctrlKey) setZoom(value => Math.max(1, Math.min(8, value - event.deltaY / 200)))
          }}
        >
          <img
            key={page}
            src={pageUrl(page)}
            alt={`${comic.title}, page ${page + 1}`}
            draggable={false}
            onError={() => setImageError(true)}
            onLoad={() => setImageError(false)}
            className={`${fit === 'width' ? 'w-full h-auto' : fit === 'height' ? 'h-full w-auto' : fit === 'original' ? 'max-w-none' : 'h-full w-full object-contain'} select-none`}
            style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
          />
        </div>
      ) : (
        <div
          ref={scroll}
          className="min-h-0 flex-1 overflow-auto"
          onScroll={() => {
            const visible = virtual.getVirtualItems().find(item => item.end > (scroll.current?.scrollTop ?? 0))
            if (visible) setPage(visible.index)
          }}
        >
          <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map(item => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtual.measureElement}
                className="absolute left-0 top-0 w-full pb-2"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <img
                  src={pageUrl(item.index)}
                  alt={`${comic.title}, page ${item.index + 1}`}
                  className="h-auto w-full"
                  loading="lazy"
                  onLoad={() => virtual.measure()}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-line pb-safe-2 pt-2">
        <IconButton label="Previous page" disabled={page === 0} onClick={() => move(-1)}>
          <ChevronLeft className="size-5" />
        </IconButton>
        <Input
          aria-label="Go to page"
          type="number"
          min={1}
          max={comic.pageCount}
          className="w-20"
          value={page + 1}
          onChange={event => {
            const index = Math.max(0, Math.min(comic.pageCount - 1, Number(event.target.value) - 1))
            setPage(index)
            if (mode === 'continuous') virtual.scrollToIndex(index)
          }}
        />
        <span className="text-sm text-muted">/ {comic.pageCount}</span>
        <IconButton label="Next page" disabled={page === comic.pageCount - 1} onClick={() => move(1)}>
          <ChevronRight className="size-5" />
        </IconButton>
      </footer>
    </div>
  )
}
