import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { QuietButton } from '../../components/ui/Controls'
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
  if (!report || !warnings.length || dismissed === report.bootId) return null
  return (
    <aside role="alert" className="shrink-0 border-b border-line bg-surface px-4 py-3 text-sm">
      {warnings.map(item => (
        <p key={item.libraryId}>
          {item.name}: {item.warning}
        </p>
      ))}
      <p>
        To enable file management, configure an access token and a writable :rw library, then enter that token in
        Settings → File management. Browsing and playback remain available.
      </p>
      <div className="mt-2 flex gap-2">
        <QuietButton onClick={onSettings}>Open file management</QuietButton>
        <QuietButton
          onClick={() => {
            try {
              sessionStorage.setItem('luma-storage-warning', report.bootId)
            } catch {
              // Dismiss still works for this session when browser storage is blocked.
            }
            setDismissed(report.bootId)
          }}
        >
          Dismiss
        </QuietButton>
      </div>
    </aside>
  )
}
