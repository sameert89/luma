import { useEffect, useState } from 'react'

const wakeEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const

/**
 * Reports when the person has stopped interacting for `delay` ms while `enabled`, so
 * overlay chrome can step aside. Chrome marked `data-chrome` stays up while it is
 * hovered or focused, so controls never vanish from under the pointer or keyboard.
 */
export function useIdle(enabled: boolean, delay = 3000) {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let timer = 0
    function arm() {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (document.querySelector('[data-chrome]:hover, [data-chrome]:focus-within')) arm()
        else setIdle(true)
      }, delay)
    }
    function wake() {
      setIdle(false)
      arm()
    }
    arm()
    for (const name of wakeEvents) window.addEventListener(name, wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const name of wakeEvents) window.removeEventListener(name, wake)
      setIdle(false)
    }
  }, [enabled, delay])
  return enabled && idle
}
