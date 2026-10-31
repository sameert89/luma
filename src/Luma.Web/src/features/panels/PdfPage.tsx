import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

export function pdfRenderScale(
  width: number,
  height: number,
  cssWidth: number,
  cssHeight: number,
  density: number,
  zoom: number,
) {
  return Math.min(
    Math.min(cssWidth / width, cssHeight / height) * Math.max(1, density) * Math.max(1, zoom),
    6144 / Math.max(width, height),
    Math.sqrt(8_000_000 / (width * height)),
  )
}

export function PdfPage({
  document,
  index,
  label,
  className,
  style,
  zoom = 1,
  original = false,
  onLoad,
  onError,
}: {
  document: PDFDocumentProxy
  index: number
  label: string
  className: string
  style?: React.CSSProperties
  zoom?: number
  original?: boolean
  onLoad?: (canvas: HTMLCanvasElement) => void
  onError: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const callbacks = useRef({ onLoad, onError })
  callbacks.current = { onLoad, onError }
  const resolution = useRef(zoom)
  resolution.current = zoom
  const redraw = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    let disposed = false
    let task: RenderTask | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let observer: ResizeObserver | undefined
    let release: (() => void) | undefined
    let generation = 0
    let rendered = ''
    const element = canvas.current!
    void document
      .getPage(index + 1)
      .then(async page => {
        if (disposed) {
          page.cleanup()
          return
        }
        release = () => {
          page.cleanup()
        }
        const natural = page.getViewport({ scale: 1 })
        // Keep logical layout stable while increasing the canvas's backing resolution.
        element.style.aspectRatio = `${natural.width} / ${natural.height}`
        if (original) {
          element.style.width = `${natural.width}px`
          element.style.height = `${natural.height}px`
        } else {
          element.style.removeProperty('width')
          element.style.removeProperty('height')
        }
        const initialScale = Math.min(
          1,
          6144 / Math.max(natural.width, natural.height),
          Math.sqrt(8_000_000 / (natural.width * natural.height)),
        )
        element.width = Math.max(1, Math.floor(natural.width * initialScale))
        element.height = Math.max(1, Math.floor(natural.height * initialScale))
        const draw = async () => {
          const scale = pdfRenderScale(
            natural.width,
            natural.height,
            element.clientWidth || element.parentElement?.clientWidth || window.innerWidth,
            element.clientHeight || element.parentElement?.clientHeight || window.innerHeight,
            window.devicePixelRatio || 1,
            resolution.current,
          )
          const viewport = page.getViewport({ scale })
          const width = Math.max(1, Math.floor(viewport.width))
          const height = Math.max(1, Math.floor(viewport.height))
          const key = `${width}:${height}`
          if (disposed || key === rendered) return
          const current = ++generation
          task?.cancel()
          if (task) await task.promise.catch(() => {})
          if (disposed || current !== generation) return
          element.width = width
          element.height = height
          task = page.render({ canvas: element, viewport })
          try {
            await task.promise
            if (!disposed && current === generation) {
              rendered = key
              callbacks.current.onLoad?.(element)
            }
          } catch {
            if (!disposed && current === generation) callbacks.current.onError()
          }
        }
        const schedule = () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            void draw().catch(() => {
              if (!disposed) callbacks.current.onError()
            })
          }, 120)
        }
        redraw.current = schedule
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(schedule)
          observer.observe(element)
        }
        window.addEventListener('resize', schedule)
        const cleanup = release
        release = () => {
          window.removeEventListener('resize', schedule)
          cleanup()
        }
        await draw()
      })
      .catch(() => {
        if (!disposed) callbacks.current.onError()
      })
    return () => {
      disposed = true
      generation++
      redraw.current = undefined
      clearTimeout(timer)
      observer?.disconnect()
      task?.cancel()
      if (task) void task.promise.catch(() => {}).finally(() => release?.())
      else release?.()
      element.width = element.height = 0
    }
  }, [document, index, original])
  useEffect(() => {
    redraw.current?.()
  }, [zoom])
  return <canvas ref={canvas} role="img" aria-label={label} className={className} style={style} />
}
