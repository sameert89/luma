import { describe, expect, it, vi } from 'vitest'
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import { openPdf } from './pdf'

describe('PDF loading', () => {
  it('uses a local worker and assets, and avoids eager whole-document fetching', () => {
    openPdf('/api/panels/comics/42/document?revision=3')
    expect(GlobalWorkerOptions.workerSrc).toContain('pdf.worker.min.mjs')
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/panels/comics/42/document?revision=3',
        disableAutoFetch: true,
        disableStream: true,
        enableXfa: false,
        cMapUrl: '/pdfjs/cmaps/',
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
      }),
    )
  })
})
