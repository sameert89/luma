import type { Scan } from './api'

/**
 * How many newly indexed files a running scan has to get through before the collection is
 * refreshed again.
 *
 * A scan reports progress every few seconds, and refreshing on each report meant re-fetching the
 * gallery and every folder tile that often. Folder tiles are the most expensive thing the server
 * draws, so a long scan spent the whole time rebuilding a view nobody had asked to change, on the
 * same disk the scan itself was reading. Refreshing per batch of work instead keeps a scan's cost
 * proportional to what it found rather than to how long it ran.
 */
export const scanRefreshItems = 250

/**
 * What a scan's progress is worth refreshing for. It changes as soon as the scan starts or
 * finishes, and otherwise only once per batch, so a finished scan always settles on a final
 * refresh however few files it touched.
 */
export function scanCheckpoint(scan?: Scan): string | null {
  if (!scan) return null
  const settled = scan.state !== 'queued' && scan.state !== 'running'
  // A settled scan reports its exact counts, so the last batch is never rounded away.
  const batch = (value: number) => (settled ? value : Math.floor(value / scanRefreshItems))
  return `${scan.id}:${scan.state}:${batch(scan.discovered)}:${batch(scan.ready)}`
}
