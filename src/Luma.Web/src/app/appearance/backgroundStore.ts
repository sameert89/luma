import { t } from '../../lib/i18n'
import { checkBackgroundDimensions } from './imageBounds'
function asset(write: boolean, blob?: Blob | null): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      if (write) reject(new Error(t('app:backgroundStore.thisBrowserCannotSaveCustomBackgrounds')))
      else resolve(null)
      return
    }
    let abandoned = false
    const open = indexedDB.open('luma-appearance-v2', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('assets')
    open.onblocked = () => {
      abandoned = true
      reject(new Error(t('app:backgroundStore.closeOtherLumaTabsAndTrySavingTheBackground')))
    }
    open.onerror = () => reject(new Error(t('app:backgroundStore.couldNotOpenBackgroundStorage')))
    open.onsuccess = () => {
      const db = open.result
      if (abandoned) {
        db.close()
        return
      }
      db.onversionchange = () => db.close()
      const tx = db.transaction('assets', write ? 'readwrite' : 'readonly')
      const store = tx.objectStore('assets')
      const request = write
        ? blob
          ? store.put(blob, 'background')
          : store.delete('background')
        : store.get('background')
      let result: Blob | null = null
      request.onsuccess = () => {
        if (!write && request.result instanceof Blob) result = request.result
      }
      tx.oncomplete = () => {
        db.close()
        resolve(result)
      }
      tx.onabort = tx.onerror = () => {
        db.close()
        reject(new Error(t('app:backgroundStore.couldNotSaveTheCustomBackgroundCheckAvailableBrowser')))
      }
    }
  })
}
export const loadBackground = () => asset(false)
export const removeBackground = () => asset(true, null)
export async function saveBackground(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw new Error(t('app:backgroundStore.chooseAJPEGPNGOrStillWebPImageUp'))
  if (typeof createImageBitmap !== 'function')
    throw new Error(t('app:backgroundStore.thisBrowserCannotPrepareCustomBackgroundsChooseABuilt'))
  checkBackgroundDimensions(new Uint8Array(await file.arrayBuffer()))
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 16000000 || bitmap.width > 8192 || bitmap.height > 8192)
      throw new Error(t('app:backgroundStore.chooseAnImageUnder16MegapixelsAnd8192'))
    const ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error(t('app:backgroundStore.thisBrowserCouldNotPrepareTheImage'))
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        value => (value ? resolve(value) : reject(new Error(t('app:backgroundStore.couldNotPrepareTheBackground')))),
        'image/webp',
        0.85,
      ),
    )
    await asset(true, blob)
    return blob
  } finally {
    bitmap.close()
  }
}
