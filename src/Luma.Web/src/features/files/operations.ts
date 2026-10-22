import type { components } from '../../lib/api/generated'
import { request } from '../browse/api'
export type FileOperation = Required<components['schemas']['FileOperation']>
export type OperationAccepted = components['schemas']['FileOperationAccepted']
export async function waitForOperation(id: string, signal?: AbortSignal) {
  while (true) {
    signal?.throwIfAborted()
    const result = await request<FileOperation>(`/api/files/operations/${id}`, signal)
    if (result.state === 'completed') return result
    if (['needsAttention', 'failed', 'cancelled'].includes(result.state))
      throw new Error(
        `Operation ${result.state}: ${result.failureCode ?? 'inspect the task details before continuing'}`,
      )
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
