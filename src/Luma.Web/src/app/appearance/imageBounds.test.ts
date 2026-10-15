import { describe, expect, it } from 'vitest'
import { checkBackgroundDimensions } from './imageBounds'
function png(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes.set([73, 72, 68, 82], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
describe('raster preflight', () => {
  it('checks PNG dimensions before decoding even a tiny compressed file', () => {
    expect(() => checkBackgroundDimensions(png(2000, 1000))).not.toThrow()
    expect(() => checkBackgroundDimensions(png(100000, 100000))).toThrow('16 megapixels')
    expect(() => checkBackgroundDimensions(png(0, 100))).toThrow()
  })
  it('rejects truncated and non-raster files without accepting their claimed type', () => {
    expect(() => checkBackgroundDimensions(new TextEncoder().encode('<svg/>'))).toThrow()
    expect(() => checkBackgroundDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 10]))).toThrow()
  })
  it('recognizes bounded JPEG frame headers', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xc0, 0, 8, 8, 0, 100, 0, 200, 1])
    expect(() => checkBackgroundDimensions(bytes)).not.toThrow()
    bytes[13] = 255
    bytes[14] = 255
    expect(() => checkBackgroundDimensions(bytes)).toThrow('16 megapixels')
  })
  it('bounds lossless WebP pages and rejects animated backgrounds', () => {
    const bytes = new Uint8Array(30)
    bytes.set(new TextEncoder().encode('RIFF'), 0)
    bytes.set(new TextEncoder().encode('WEBPVP8L'), 8)
    new DataView(bytes.buffer).setUint32(16, 5, true)
    bytes[20] = 0x2f
    new DataView(bytes.buffer).setUint32(21, 319 | (239 << 14), true)
    expect(() => checkBackgroundDimensions(bytes.slice(0, 26))).not.toThrow()
    new DataView(bytes.buffer).setUint32(21, 8191 | (8191 << 14), true)
    expect(() => checkBackgroundDimensions(bytes.slice(0, 26))).toThrow('16 megapixels')
    bytes.set(new TextEncoder().encode('VP8X'), 12)
    new DataView(bytes.buffer).setUint32(16, 10, true)
    bytes[20] = 2
    expect(() => checkBackgroundDimensions(bytes)).toThrow('still background')
  })
})
