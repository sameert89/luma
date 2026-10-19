import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { Toast } from '../../components/ui/Toast'
import { request } from '../browse/api'
import type { components } from '../../lib/api/generated'

export function StorageWarning({ onSettings }: { onSettings: () => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('luma-storage-warning') ?? ''
    } catch {
      return ''
    }
  })
  const status = useQuery({
    queryKey: ['storage-status'],
    queryFn: ({ signal }) => request<components['schemas']['FileStorageReport']>('/api/files/storage-status', signal),
    refetchInterval: 30000,
  })
  const report = status.data
  const warnings = report?.libraries?.filter(item => item.warning) ?? []
  const bootId = report?.bootId ?? ''
  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem('luma-storage-warning', bootId)
    } catch {
      /* Optional browser storage. */
    }
    setDismissed(bootId)
  }, [bootId])
  const visible = !!report && warnings.length > 0 && dismissed !== bootId
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(dismiss, 6000)
    return () => window.clearTimeout(timer)
  }, [visible, dismiss])
  return (
    <Toast
      passThrough
      toast={
        visible
          ? {
              id: 1,
              text: 'Read-only media. Browsing still works.',
              tone: 'info',
            }
          : null
      }
      onDismiss={dismiss}
      action={{
        label: 'Details',
        onClick: () => {
          dismiss()
          onSettings()
        },
      }}
    />
  )
}
