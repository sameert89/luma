import { useEffect, useState } from 'react'

export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    function change() {
      setFullscreen(!!document.fullscreenElement)
    }
    function begin() {
      setFullscreen(true)
    }
    document.addEventListener('fullscreenchange', change)
    // Safari's native video fullscreen does not set document.fullscreenElement.
    document.addEventListener('webkitbeginfullscreen', begin, true)
    document.addEventListener('webkitendfullscreen', change, true)
    return () => {
      document.removeEventListener('fullscreenchange', change)
      document.removeEventListener('webkitbeginfullscreen', begin, true)
      document.removeEventListener('webkitendfullscreen', change, true)
    }
  }, [])
  return fullscreen
}
