import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import packageJson from '../package.json'

// What's new opens by itself once per release. Tests start past it; the ones about the
// release notes themselves clear this key first.
beforeEach(() => localStorage.setItem('luma-version-seen', packageJson.version))
afterEach(() => {
  // Anything that chooses or closes on pointer down arms a one-shot guard that swallows the click
  // which follows (components/ui/dismiss). A browser always spends that guard: the click lands on
  // whatever is under the pointer once the element has gone, and that element is still in the
  // page. userEvent instead dispatches the click on the node React has already unmounted, and a
  // detached node reaches neither document nor window, so the guard would survive into whatever
  // clicks next. Spend it the way a browser would.
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  cleanup()
  vi.unstubAllGlobals()
})
