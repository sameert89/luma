import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'

function fixture(width = 600, height = 900, promise = Promise.resolve()) {
  const task = { promise, cancel: vi.fn() }
  const page = {
    cleanup: vi.fn(),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale })),
    render: vi.fn(() => task),
  }
  const document = { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy
  return { document, page, task }
}

describe('PDF page rendering', () => {
  it('renders one requested page, caps canvas allocation, and releases it on exit', async () => {
    const f = fixture(10_000, 20_000)
    const loaded = vi.fn()
    const { unmount } = render(
      <PdfPage
        document={f.document}
        index={21}
        label="Book, page 22"
        className="w-full"
        onLoad={loaded}
        onError={vi.fn()}
      />,
    )
    await waitFor(() => expect(loaded).toHaveBeenCalledOnce())
    const canvas = screen.getByRole('img') as HTMLCanvasElement
    expect(f.document.getPage).toHaveBeenCalledWith(22)
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000)
    expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(2400)
    unmount()
    await waitFor(() => expect(f.page.cleanup).toHaveBeenCalled())
    expect(f.task.cancel).toHaveBeenCalledOnce()
    expect(canvas.width * canvas.height).toBe(0)
  })

  it('cancels an unfinished render without reporting a page error', async () => {
    let reject!: (reason: Error) => void
    const pending = new Promise<void>((_, fail) => {
      reject = fail
    })
    const f = fixture(600, 900, pending)
    const error = vi.fn()
    const { unmount } = render(<PdfPage document={f.document} index={0} label="Page" className="" onError={error} />)
    await waitFor(() => expect(f.page.render).toHaveBeenCalledOnce())
    unmount()
    await act(async () => {
      reject(new Error('cancelled'))
    })
    expect(error).not.toHaveBeenCalled()
    expect(f.page.cleanup).toHaveBeenCalled()
  })

  it('reports damaged pages', async () => {
    const document = { getPage: vi.fn().mockRejectedValue(new Error('bad PDF')) } as unknown as PDFDocumentProxy
    const error = vi.fn()
    render(<PdfPage document={document} index={0} label="Page" className="" onError={error} />)
    await waitFor(() => expect(error).toHaveBeenCalledOnce())
  })
})
