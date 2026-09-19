import type { components, paths } from './generated'

export type StatusResponse = paths['/api/status']['get']['responses'][200]['content']['application/json']
type ApiProblem = components['schemas']['ApiProblem']

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly problem?: ApiProblem) {
    super(problem?.title ?? 'Unable to reach Luma. Please try again.')
  }
}

export async function getStatus(signal?: AbortSignal): Promise<StatusResponse> {
  const response = await fetch('/api/status', { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const problem = response.headers.get('content-type')?.includes('application/problem+json')
      ? await response.json() as ApiProblem : undefined
    throw new ApiError(response.status, problem)
  }
  return response.json() as Promise<StatusResponse>
}
