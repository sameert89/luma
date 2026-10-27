import { useEffect, useState } from 'react'

const wakeEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const

/**
 * Reports when the person has stopped interacting for `delay` ms while `enabled`, so
 * overlay chrome can step aside. Keyboard focus and a held control keep it up;
 * pointer focus and sticky touchscreen hover must not pin fullscreen controls open.
 */
export function useIdle(enabled: boolean, delay = 3000) {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let timer = 0
    let pressing = false
    let keyboard = false
    function arm() {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (pressing || (keyboard && document.activeElement?.closest('[data-chrome]'))) arm()
        else setIdle(true)
      }, delay)
    }
    function wake(event?: Event) {
      if (event?.type === 'keydown') keyboard = true
      if (event?.type === 'pointerdown') {
        keyboard = false
        pressing = event.target instanceof Element && !!event.target.closest('[data-chrome]')
      }
      setIdle(false)
      arm()
    }
    function release() {
      pressing = false
      wake()
    }
    arm()
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    for (const name of wakeEvents) window.addEventListener(name, wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
      for (const name of wakeEvents) window.removeEventListener(name, wake)
      setIdle(false)
    }
  }, [enabled, delay])
  return enabled && idle
}
