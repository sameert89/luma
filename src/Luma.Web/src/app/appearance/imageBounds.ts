import { t } from '../../lib/i18n'
// Read bounded raster headers before asking the browser to allocate decoded pixels.
// Custom backgrounds use common still formats and are rasterized once, never animated.
export function checkBackgroundDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length))
  const invalid = () => new Error(t('app:imageBounds.chooseAValidJPEGPNGOrStillWebPBackground'))
  const bounds = (width: number, height: number) => {
    if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16000000)
      throw new Error(t('app:imageBounds.chooseAnImageUnder16MegapixelsAnd8192'))
  }
  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 7) === 'PNG\r\n\x1a\n' && text(12, 4) === 'IHDR') {
    bounds(view.getUint32(16), view.getUint32(20))
    return
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2,
      entries = 0
    while (offset + 3 < bytes.length) {
      if (++entries > 4096) throw invalid()
      if (bytes[offset++] !== 0xff) throw invalid()
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) throw invalid()
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (offset + 2 > bytes.length) throw invalid()
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) throw invalid()
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) throw invalid()
        bounds(view.getUint16(offset + 5), view.getUint16(offset + 3))
        return
      }
      offset += length
    }
    throw invalid()
  }
  if (bytes.length >= 20 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    let offset = 12,
      found = false,
      entries = 0
    while (offset + 8 <= bytes.length) {
      if (++entries > 4096) throw invalid()
      const kind = text(offset, 4),
        length = view.getUint32(offset + 4, true),
        data = offset + 8
      if (data + length > bytes.length) throw invalid()
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && bytes[data] & 2))
        throw new Error(t('app:imageBounds.chooseAStillBackgroundImage'))
      if (kind === 'VP8X') {
        if (length < 10) throw invalid()
        const uint24 = (index: number) => bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16)
        bounds(uint24(data + 4) + 1, uint24(data + 7) + 1)
      }
      if (kind === 'VP8 ') {
        if (length < 10 || text(data + 3, 3) !== '\x9d\x01\x2a') throw invalid()
        bounds(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff)
        found = true
      }
      if (kind === 'VP8L') {
        if (length < 5 || bytes[data] !== 0x2f) throw invalid()
        const bits = view.getUint32(data + 1, true)
        bounds((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
        found = true
      }
      offset = data + length + (length % 2)
    }
    if (found) return
  }
  throw invalid()
}
