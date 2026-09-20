import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import packageJson from '../package.json'

// What's new opens by itself once per release. Tests start past it; the ones about the
// release notes themselves clear this key first.
beforeEach(() => localStorage.setItem('luma-version-seen', packageJson.version))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
