import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

export function PdfPage({
  document,
  index,
  label,
  className,
  style,
  onLoad,
  onError,
}: {
  document: PDFDocumentProxy
  index: number
  label: string
  className: string
  style?: React.CSSProperties
  onLoad?: (canvas: HTMLCanvasElement) => void
  onError: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const callbacks = useRef({ onLoad, onError })
  callbacks.current = { onLoad, onError }
  useEffect(() => {
    let disposed = false
    let task: RenderTask | undefined
    let release: (() => void) | undefined
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
        // Bound decoded canvas memory independently of page dimensions and device pixel ratio.
        const scale = Math.min(
          2,
          2400 / Math.max(natural.width, natural.height),
          Math.sqrt(4_000_000 / (natural.width * natural.height)),
        )
        const viewport = page.getViewport({ scale })
        element.width = Math.max(1, Math.floor(viewport.width))
        element.height = Math.max(1, Math.floor(viewport.height))
        task = page.render({ canvas: element, viewport })
        await task.promise
        if (!disposed) callbacks.current.onLoad?.(element)
      })
      .catch(() => {
        if (!disposed) callbacks.current.onError()
      })
      .finally(() => {
        if (disposed) release?.()
      })
    return () => {
      disposed = true
      task?.cancel()
      if (task) void task.promise.catch(() => {}).finally(() => release?.())
      element.width = element.height = 0
    }
  }, [document, index])
  return <canvas ref={canvas} role="img" aria-label={label} className={className} style={style} />
}
