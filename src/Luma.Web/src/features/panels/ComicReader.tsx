import { t } from '../../lib/i18n'
import { Modal } from '../../components/ui/Modal'
import { readSetting } from '../../app/uiDefaults'
import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Minus, Plus, SlidersHorizontal } from 'lucide-react'
import { IconButton, QuietButton, Select, Input, Range } from '../../components/ui/Controls'
import { useReadingSession } from './useReadingSession'
import type { Comic } from './api'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'

function readerPreferences(settings: string) {
  try {
    const value = JSON.parse(settings === '{}' ? (readSetting('luma-panels-reader-defaults') ?? settings) : settings)
    return {
      direction: value.direction === 'rtl' ? 'rtl' : 'ltr',
      mode: value.mode === 'continuous' ? 'continuous' : 'single',
      fit: ['width', 'height', 'original'].includes(value.fit) ? value.fit : 'screen',
    }
  } catch {
    return { mode: 'single', fit: 'screen', direction: 'ltr' }
  }
}

export function ComicReader({ comic, onExit }: { comic: Comic; onExit: () => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(comic.pageIndex)
  const [preferences] = useState(() => readerPreferences(comic.settings))
  const [direction, setDirection] = useState(comic.settings === '{}' ? preferences.direction : comic.direction)
  const [mode, setMode] = useState(preferences.mode)
  const [fit, setFit] = useState(preferences.fit)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [imageError, setImageError] = useState(false)
  const [controls, setControls] = useState(false)
  const [jump, setJump] = useState(false)
  const root = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)
  const pinched = useRef(false)
  const restoring = useRef(false)
  const resumeTarget = useRef(page)
  const [exiting, setExiting] = useState(false)
  const { error, flush } = useReadingSession(comic.id, page, direction, { mode, fit })
  async function exitReader() {
    if (exiting) return
    setExiting(true)
    await flush()
    onExit()
  }
  useEffect(() => {
    if (comic.format !== 'pdf') return
    let disposed = false
    let task: PDFDocumentLoadingTask | undefined
    void import('./pdf')
      .then(async ({ openPdf }) => {
        if (disposed) return
        if (!comic.documentUrl) throw new Error('Missing PDF document URL')
        task = openPdf(comic.documentUrl)
        const document = await task.promise
        if (document.numPages !== comic.pageCount) throw new Error('PDF page count changed')
        if (!disposed) setPdf(document)
      })
      .catch(() => {
        if (!disposed) setImageError(true)
      })
    return () => {
      disposed = true
      setPdf(null)
      void task?.destroy().catch(() => {})
    }
  }, [comic.id, comic.format, comic.documentUrl, comic.pageCount])
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
    estimateSize: () => Math.max(1, (scroll.current?.clientWidth ?? window.innerWidth) * zoom * 1.5),
    enabled: mode === 'continuous',
    overscan: 1,
  })
  useEffect(() => {
    if (mode === 'continuous') {
      restoring.current = true
      resumeTarget.current = page
      virtual.scrollToIndex(page, { align: 'start' })
    }
    // Resume the current page when entering continuous mode.
  }, [mode])
  const pageUrl = (index: number) =>
    `/api/panels/comics/${comic.id}/pages/${index}${fit === 'original' || zoom > 1 ? '?original=true' : ''}`
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key === 'Escape' && !controls && !jump) {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void exitReader()
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
  }, [direction, onExit, mode, controls, jump])
  useEffect(() => {
    if (comic.format === 'pdf') return
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
  }, [comic.id, comic.format, comic.pageCount, page])
  function down(event: React.PointerEvent) {
    restoring.current = false
    if (pointers.current.size === 0) pinched.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom }
      pinched.current = true
    }
  }
  function pointerMove(event: React.PointerEvent) {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const initial = pinch.current
      if (initial && initial.distance > 0)
        setZoom(Math.max(1, Math.min(8, (initial.zoom * distance) / initial.distance)))
    } else if (mode === 'continuous') {
      event.currentTarget.scrollTop += previous.y - event.clientY
      event.currentTarget.scrollLeft += previous.x - event.clientX
    } else if (zoom > 1) {
      setPan(value => ({ x: value.x + event.clientX - previous.x, y: value.y + event.clientY - previous.y }))
    } else if (fit === 'width' || fit === 'original') event.currentTarget.scrollTop += previous.y - event.clientY
  }

  const start = useRef<{ x: number; y: number } | null>(null)
  return (
    <div
      ref={root}
      className="relative flex min-h-0 flex-1 flex-col bg-canvas text-ink"
      aria-label={t('panels:comicReader.comicReader')}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line p-3">
        <IconButton label={t('panels:comicReader.exitReader')} disabled={exiting} onClick={() => void exitReader()}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{comic.title}</h1>
        <IconButton label={t('panels:comicReader.readerSettings')} onClick={() => setControls(true)}>
          <SlidersHorizontal className="size-5" />
        </IconButton>
      </div>
      <Modal
        open={controls}
        onOpenChange={setControls}
        title={t('panels:comicReader.readerSettings')}
        description={t('panels:comicReader.readingDirectionFitZoomAndDisplay')}
        portalContainer={root.current ?? undefined}
      >
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Select
            aria-label={t('panels:comicReader.readingMode')}
            className="w-auto"
            value={mode}
            onChange={event => {
              setMode(event.target.value)
              setZoom(1)
              setPan({ x: 0, y: 0 })
            }}
          >
            <option value="single">{t('panels:comicReader.singlePage')}</option>
            <option value="continuous">{t('panels:comicReader.continuousScroll')}</option>
          </Select>
          <Select
            aria-label={t('panels:comicReader.readingDirection')}
            className="w-auto"
            value={direction}
            onChange={event => setDirection(event.target.value)}
          >
            <option value="ltr">{t('panels:comicReader.leftToRight')}</option>
            <option value="rtl">{t('panels:comicReader.rightToLeft')}</option>
          </Select>
          <Select
            aria-label={t('panels:comicReader.pageFit')}
            className="w-auto"
            value={fit}
            onChange={event => setFit(event.target.value)}
          >
            <option value="screen">{t('panels:comicReader.fitScreen')}</option>
            <option value="width">{t('panels:comicReader.fitWidth')}</option>
            <option value="height">{t('panels:comicReader.fitHeight')}</option>
            <option value="original">{t('panels:comicReader.originalResolution')}</option>
          </Select>
          <IconButton
            label={t('panels:comicReader.zoomOut')}
            onClick={() => setZoom(value => Math.max(1, value - 0.5))}
          >
            <Minus className="size-4" />
          </IconButton>
          <IconButton label={t('panels:comicReader.zoomIn')} onClick={() => setZoom(value => Math.min(8, value + 0.5))}>
            <Plus className="size-4" />
          </IconButton>
          <IconButton
            label={t('panels:comicReader.fullscreen')}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen()
              else void root.current?.requestFullscreen?.()
            }}
          >
            <Maximize className="size-4" />
          </IconButton>
        </div>
      </Modal>
      {error && (
        <p role="alert" className="px-3 text-sm text-danger">
          {t('panels:comicReader.progressCouldNotBeSaved', { error: error })}
        </p>
      )}
      {imageError && (
        <p role="alert" className="px-3 text-sm text-danger">
          {t('panels:comicReader.thisPageCouldNotBeLoadedTryAnotherPage')}
        </p>
      )}
      {mode === 'single' ? (
        <div
          role="group"
          aria-label={t('panels:comicReader.comicPageGestures')}
          className={`relative flex min-h-0 flex-1 ${fit === 'width' || fit === 'original' ? 'items-start overflow-auto' : 'items-center overflow-hidden'} justify-center`}
          style={{ touchAction: 'none' }}
          onPointerDown={event => {
            start.current = { x: event.clientX, y: event.clientY }
            down(event)
          }}
          onPointerMove={pointerMove}
          onPointerUp={event => {
            const origin = start.current
            pointers.current.delete(event.pointerId)
            pinch.current = null
            if (!pinched.current && zoom === 1 && origin && Math.abs(event.clientX - origin.x) > 60)
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
          {comic.format === 'pdf' ? (
            pdf && (
              <PdfPage
                key={page}
                document={pdf}
                index={page}
                label={`${comic.title}, page ${page + 1}`}
                className={`${fit === 'width' ? 'w-full h-auto' : fit === 'height' ? 'h-full w-auto' : fit === 'original' ? 'max-w-none' : 'h-full w-full object-contain'} select-none`}
                style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
                onError={() => setImageError(true)}
                onLoad={() => setImageError(false)}
              />
            )
          ) : (
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
          )}
        </div>
      ) : (
        <div
          ref={scroll}
          className="min-h-0 flex-1 overflow-auto"
          style={{ touchAction: 'none' }}
          onPointerDown={down}
          onPointerMove={pointerMove}
          onPointerUp={event => {
            pointers.current.delete(event.pointerId)
            pinch.current = null
          }}
          onPointerCancel={() => {
            pointers.current.clear()
            pinch.current = null
          }}
          onWheel={() => {
            restoring.current = false
          }}
          onScroll={() => {
            const visible = virtual.getVirtualItems().find(item => item.end > (scroll.current?.scrollTop ?? 0))
            if (visible && !restoring.current) setPage(visible.index)
          }}
        >
          <div className="relative w-full" style={{ height: virtual.getTotalSize(), width: `${zoom * 100}%` }}>
            {virtual.getVirtualItems().map(item => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtual.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {comic.format === 'pdf' ? (
                  pdf && (
                    <PdfPage
                      document={pdf}
                      index={item.index}
                      label={`${comic.title}, page ${item.index + 1}`}
                      className="block h-auto w-full"
                      onError={() => setImageError(true)}
                      onLoad={canvas => {
                        virtual.measureElement(canvas.parentElement!)
                        if (restoring.current && item.index === resumeTarget.current) {
                          virtual.scrollToIndex(resumeTarget.current, { align: 'start' })
                          requestAnimationFrame(() => {
                            restoring.current = false
                          })
                        }
                      }}
                    />
                  )
                ) : (
                  <img
                    src={pageUrl(item.index)}
                    alt={`${comic.title}, page ${item.index + 1}`}
                    className="block h-auto w-full"
                    style={{ aspectRatio: 'auto 2 / 3' }}
                    loading="lazy"
                    onLoad={event => {
                      virtual.measureElement(event.currentTarget.parentElement!)
                      if (restoring.current && item.index === resumeTarget.current) {
                        virtual.scrollToIndex(resumeTarget.current, { align: 'start' })
                        requestAnimationFrame(() => {
                          restoring.current = false
                        })
                      }
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-line pb-safe-2 pt-2">
        <IconButton label={t('panels:comicReader.previousPage')} disabled={page === 0} onClick={() => move(-1)}>
          <ChevronLeft className="size-5" />
        </IconButton>
        <QuietButton onClick={() => setJump(true)} aria-label={t('panels:comicReader.goToPage')}>
          {page + 1} / {comic.pageCount}
        </QuietButton>
        <IconButton
          label={t('panels:comicReader.nextPage')}
          disabled={page === comic.pageCount - 1}
          onClick={() => move(1)}
        >
          <ChevronRight className="size-5" />
        </IconButton>
      </footer>
      <Modal
        open={jump}
        onOpenChange={setJump}
        title={t('panels:comicReader.goToPage')}
        description={t('panels:comicReader.chooseAPageInThisComic')}
        portalContainer={root.current ?? undefined}
      >
        <div className="flex flex-wrap items-center gap-3 p-5">
          <Input
            aria-label={t('panels:comicReader.goToPage')}
            type="number"
            min={1}
            max={comic.pageCount}
            className="max-w-24 text-center"
            value={page + 1}
            onChange={event => {
              const index = Math.max(0, Math.min(comic.pageCount - 1, Number(event.target.value) - 1))
              setPage(index)
              if (mode === 'continuous') virtual.scrollToIndex(index)
            }}
          />
          <span className="text-sm text-muted">{t('panels:comicReader.of', { count: comic.pageCount })}</span>
          <Range
            aria-label={t('panels:comicReader.pagePosition')}
            className="w-full"
            min={1}
            max={comic.pageCount}
            value={page + 1}
            onChange={event => move(Number(event.target.value) - 1 - page)}
          />
          <QuietButton onClick={() => setJump(false)}>{t('panels:comicReader.done')}</QuietButton>
        </div>
      </Modal>
    </div>
  )
}
