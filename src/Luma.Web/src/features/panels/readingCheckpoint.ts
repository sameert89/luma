import type { Comic } from './api'

type Checkpoint = Pick<Comic, 'pageIndex' | 'direction' | 'settings'>
const key = (id: number) => `luma-panels-checkpoint-${id}`

// Only unsaved positions are stored. A confirmed save removes its checkpoint;
// older responses must not remove a newer page that is still waiting to save.
export function rememberReadingCheckpoint(id: number, checkpoint: Checkpoint) {
  try {
    localStorage.setItem(key(id), JSON.stringify(checkpoint))
  } catch {
    // Reading and server saves also work when browser storage is unavailable.
  }
}

export function confirmReadingCheckpoint(id: number, checkpoint: Checkpoint) {
  try {
    if (localStorage.getItem(key(id)) === JSON.stringify(checkpoint)) localStorage.removeItem(key(id))
  } catch {
    // Browser storage may be disabled.
  }
}

export function resumeReadingCheckpoint(comic: Comic): Comic {
  try {
    const checkpoint = JSON.parse(localStorage.getItem(key(comic.id)) ?? 'null')
    const settings = JSON.parse(checkpoint?.settings ?? 'null')
    if (
      checkpoint &&
      Number.isInteger(checkpoint.pageIndex) &&
      checkpoint.pageIndex >= 0 &&
      checkpoint.pageIndex < comic.pageCount &&
      ['ltr', 'rtl'].includes(checkpoint.direction) &&
      typeof checkpoint.settings === 'string' &&
      checkpoint.settings.length <= 4096 &&
      typeof settings === 'object' &&
      settings !== null &&
      !Array.isArray(settings)
    )
      return {
        ...comic,
        pageIndex: checkpoint.pageIndex,
        direction: checkpoint.direction,
        settings: checkpoint.settings,
      }
  } catch {
    // A corrupt or inaccessible checkpoint must not prevent opening a comic.
  }
  return comic
}
