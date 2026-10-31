export type ZoomPoint = { x: number; y: number }

// Keep the content under `from` beneath `to` as its scale changes. Points are
// relative to the untransformed surface's center (or scroll content's origin).
export function zoomPan(pan: ZoomPoint, oldZoom: number, newZoom: number, from: ZoomPoint, to = from): ZoomPoint {
  const ratio = newZoom / oldZoom
  return { x: to.x - (from.x - pan.x) * ratio, y: to.y - (from.y - pan.y) * ratio }
}

// Trackpad pinches arrive as Ctrl+wheel. React's wheel listener is passive, so
// suppress browser-level page zoom with a native listener on the media surface.
export function containWheelZoom(element: HTMLElement | null) {
  if (!element) return
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey && event.target instanceof Element && !event.target.closest('button,input,select,a'))
      event.preventDefault()
  }
  element.addEventListener('wheel', wheel, { passive: false })
  return () => element.removeEventListener('wheel', wheel)
}
