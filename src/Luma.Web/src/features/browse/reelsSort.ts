import { useSyncExternalStore } from 'react'
import type { Filters } from './api'
import { shuffleSeed } from './shuffleSeed'

/**
 * The order Reels opens in, chosen in Settings on this device.
 *
 * `library` keeps what Reels has always done: carry on in whatever order the library was sorted.
 * Anything else replaces the sort when Reels is opened from the navigation, so a feed can open
 * shuffled while the library stays newest first. Watch on Reels is unaffected: it continues from
 * the item being viewed, which only makes sense in the order it was reached.
 */
export type ReelsSortChoice = 'library' | 'modified' | 'captured' | 'name' | 'type' | 'size' | 'shuffle'
export type ReelsSort = { sort: ReelsSortChoice; order: 'desc' | 'asc' }

const storageKey = 'luma-reels-sort'
const choices: ReelsSortChoice[] = ['library', 'modified', 'captured', 'name', 'type', 'size', 'shuffle']
const fallback: ReelsSort = { sort: 'library', order: 'desc' }
const listeners = new Set<() => void>()

function read(): ReelsSort {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<ReelsSort> | null
    if (!stored || !choices.includes(stored.sort as ReelsSortChoice)) return fallback
    return { sort: stored.sort as ReelsSortChoice, order: stored.order === 'asc' ? 'asc' : 'desc' }
  } catch {
    return fallback
  }
}
let current = read()

export function setReelsSort(value: ReelsSort) {
  current = value
  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    /* the choice still applies to this visit */
  }
  for (const listener of listeners) listener()
}
export function useReelsSort() {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => current,
  )
}
export const reelsSort = () => current

export type SortFields = Pick<Filters, 'sort' | 'order' | 'seed'>

/**
 * The sort fields Reels should open with, given the filters it is being opened from.
 *
 * The library's own default (modified, newest first) is written as no sort at all, the way the
 * library writes it, so choosing it adds no Sort or Direction chip to the filter row. Shuffle
 * draws a fresh seed each time, so every visit is a new feed rather than the same random order.
 */
export function reelsSortFields(choice: ReelsSort, from: Filters): SortFields {
  if (choice.sort === 'library') return { sort: from.sort, order: from.order, seed: from.seed }
  if (choice.sort === 'shuffle') return { sort: 'shuffle', order: undefined, seed: shuffleSeed() }
  if (choice.sort === 'modified' && choice.order === 'desc') return { sort: undefined, order: undefined, seed: undefined }
  return { sort: choice.sort, order: choice.order, seed: undefined }
}

export const sameSort = (a: SortFields, b: SortFields) => a.sort === b.sort && a.order === b.order && a.seed === b.seed
