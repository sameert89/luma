import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveBackground } from './backgroundStore'
afterEach(() => vi.unstubAllGlobals())
describe('custom background bounds', () => {
  it('rejects active image types and oversized files before decoding', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(saveBackground(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }))).rejects.toThrow(
      'Choose a JPEG',
    )
    await expect(
      saveBackground(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })),
    ).rejects.toThrow('8 MiB')
    expect(decode).not.toHaveBeenCalled()
  })
  it('releases decoded images that exceed the pixel limits', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 20000, height: 4000, close }))
    const file = new File(['data'], 'image.png', { type: 'image/png' })
    const bytes = new Uint8Array(24)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
    bytes.set([73, 72, 68, 82], 12)
    new DataView(bytes.buffer).setUint32(16, 2)
    new DataView(bytes.buffer).setUint32(20, 2)
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
    await expect(saveBackground(file)).rejects.toThrow('16 megapixels')
    expect(close).toHaveBeenCalledOnce()
  })
})
