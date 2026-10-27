import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export function openPdf(url: string) {
  return getDocument({
    url,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    maxImageSize: 32 * 1024 * 1024,
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
  })
}
