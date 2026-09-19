import { afterEach, expect, it, vi } from 'vitest'
import { request } from './api'
import { ApiError } from '../../lib/api/client'

const busy = () => new Response(JSON.stringify({ title: 'Luma is busy. Please try again.', code: 'database_busy' }), { status: 503, headers: { 'Content-Type': 'application/problem+json' } })

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('retries a write while the database is busy instead of failing at once', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const saved = request('/api/media/1/preference', undefined, 'PUT', { preference: 'liked' })
  await vi.runAllTimersAsync()
  await expect(saved).resolves.toBeUndefined()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('reports busy only after its bounded retries are exhausted', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(busy()))
  vi.stubGlobal('fetch', fetch)
  const saved = request<void>('/api/media/tags', undefined, 'POST', {}).catch((error: unknown) => error as ApiError)
  await vi.runAllTimersAsync()
  const error = await saved
  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).message).toBe('Luma is busy. Please try again.')
  expect(fetch).toHaveBeenCalledTimes(3)
})
