import { expect, it } from 'vitest'
import { scanCheckpoint, scanRefreshItems } from './scanCheckpoint'
import type { Scan } from './api'

const scan = (over: Partial<Scan>): Scan =>
  ({
    id: 1,
    libraryId: 1,
    state: 'running',
    discovered: 0,
    skipped: 0,
    ready: 0,
    pending: 0,
    processing: 0,
    failed: 0,
    failures: [],
    ...over,
  }) as unknown as Scan

it('does not change on every report a running scan makes', () => {
  const first = scanCheckpoint(scan({ discovered: 10, ready: 4 }))
  expect(scanCheckpoint(scan({ discovered: 20, ready: 9 }))).toBe(first)
  expect(scanCheckpoint(scan({ discovered: 30, ready: 12 }))).toBe(first)
})

it('changes once a scan has found another batch of files', () => {
  const first = scanCheckpoint(scan({ discovered: 10 }))
  expect(scanCheckpoint(scan({ discovered: scanRefreshItems + 10 }))).not.toBe(first)
})

it('changes the moment a scan starts or stops, whatever it got through', () => {
  const running = scanCheckpoint(scan({ state: 'running', discovered: 3, ready: 3 }))
  expect(scanCheckpoint(scan({ state: 'completed', discovered: 3, ready: 3 }))).not.toBe(running)
  // A scan that touched too few files to fill a batch still settles on its exact counts, so the
  // collection is refreshed once at the end rather than never.
  expect(scanCheckpoint(scan({ state: 'completed', discovered: 3, ready: 3 }))).toContain(':3:3')
})

it('tells two scans apart', () => {
  expect(scanCheckpoint(scan({ id: 1 }))).not.toBe(scanCheckpoint(scan({ id: 2 })))
  expect(scanCheckpoint(undefined)).toBeNull()
})
