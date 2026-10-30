export type ZoomPoint = { x: number; y: number }

// Keep the content under `from` beneath `to` as its scale changes. Points are
// relative to the untransformed surface's center (or scroll content's origin).
export function zoomPan(pan: ZoomPoint, oldZoom: number, newZoom: number, from: ZoomPoint, to = from): ZoomPoint {
  const ratio = newZoom / oldZoom
  return { x: to.x - (from.x - pan.x) * ratio, y: to.y - (from.y - pan.y) * ratio }
}
