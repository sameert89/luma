import { waitForFileSlot } from './fileConflicts'
import { t } from '../../lib/i18n'
import type { components } from '../../lib/api/generated'
import { request } from '../browse/api'
export type FileOperation = Required<components['schemas']['FileOperation']>
export type OperationAccepted = components['schemas']['FileOperationAccepted']
export async function waitForOperation(id: string, signal?: AbortSignal) {
  while (true) {
    signal?.throwIfAborted()
    const result = await waitForFileSlot(() => request<FileOperation>(`/api/files/operations/${id}`, signal), signal)
    if (result.state === 'completed') return result
    if (['needsAttention', 'failed', 'cancelled'].includes(result.state))
      throw new Error(
        t('files:operations.operation', {
          value1: result.state,
          value2: result.failureCode ?? t('files:operations.inspectTheTaskDetailsBeforeContinuing'),
        }),
      )
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
