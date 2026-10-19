import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { Checkbox, QuietButton } from '../../components/ui/Controls'
import { errorMessage, request } from '../browse/api'
import type { components } from '../../lib/api/generated'

export function FileAccess() {
  const toggleId = useId()
  const client = useQueryClient()
  const settings = useQuery({
    queryKey: ['file-settings'],
    queryFn: ({ signal }) => request<components['schemas']['FileManagementSettings']>('/api/files/settings', signal),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [storage, setStorage] = useState<components['schemas']['FileStorageStatus'][]>([])
  async function checkStorage() {
    setBusy(true)
    setError('')
    try {
      setStorage(
        await request<components['schemas']['FileStorageStatus'][]>('/api/files/storage-check', undefined, 'POST'),
      )
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      await Promise.all(
        ['file-capabilities', 'storage-status'].map(key => client.invalidateQueries({ queryKey: [key] })),
      )
      setBusy(false)
    }
  }
  async function change(enabled: boolean) {
    setBusy(true)
    setError('')
    try {
      await request('/api/files/settings', undefined, 'PUT', { enabled })
      await Promise.all(
        ['file-settings', 'file-capabilities'].map(key => client.invalidateQueries({ queryKey: [key] })),
      )
      if (enabled) await checkStorage()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsSection title="File management" description="Allow uploads, moves and deletion in writable libraries.">
      <label htmlFor={toggleId} className="flex items-center gap-2 text-sm">
        <Checkbox
          id={toggleId}
          checked={settings.data?.enabled ?? false}
          disabled={busy || settings.isPending}
          onChange={event => void change(event.target.checked)}
        />
        Enable file management
      </label>
      <p className="text-sm text-muted">
        Saved for this server. Luma__Files__Enabled sets the initial default. Each editable library also needs
        Writable=true and a :rw mount. Read-only libraries keep browsing and playback available.
      </p>
      {settings.data?.enabled && (
        <QuietButton disabled={busy} onClick={() => void checkStorage()}>
          Check media mounts
        </QuietButton>
      )}
      {storage
        .filter(item => item.warning)
        .map(item => (
          <p key={item.libraryId} className="text-sm text-muted">
            {item.name}: {item.warning}
          </p>
        ))}
      {(error || settings.isError) && (
        <p role="alert" className="text-sm text-danger">
          {error || errorMessage(settings.error)}
        </p>
      )}
    </SettingsSection>
  )
}
