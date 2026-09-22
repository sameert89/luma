/**
 * Swallows the click that follows the pointer gesture now in progress.
 *
 * Anything that closes or chooses on pointer down leaves the click to land on whatever ends up
 * under the finger once it has gone: dismissing a sheet presses the button behind it, and picking
 * a search suggestion presses whatever the list was covering. The click is caught once, in the
 * capture phase, so it never reaches the element underneath.
 *
 * Only for gestures — a keyboard choice is followed by no click, and swallowing one would eat the
 * person's next deliberate tap instead.
 */
export function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    window.clearTimeout(timer)
  }
  const timer = window.setTimeout(() => window.removeEventListener('click', swallow, true), 500)
  window.addEventListener('click', swallow, { capture: true, once: true })
}
