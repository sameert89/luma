import { LoaderCircle } from 'lucide-react'
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
  const [checking, setChecking] = useState(false)
  const [storage, setStorage] = useState<components['schemas']['FileStorageStatus'][] | null>(null)
  async function checkStorage() {
    setBusy(true)
    setChecking(true)
    setStorage(null)
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
      setChecking(false)
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
        <div className="space-y-2">
          <QuietButton disabled={busy} aria-busy={checking} onClick={() => void checkStorage()}>
            {checking && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
            {checking ? 'Checking media mounts…' : 'Check media mounts'}
          </QuietButton>
          <p className="text-sm text-muted">
            Recheck write access after changing mounts or permissions. This does not change the mount configuration.
          </p>
        </div>
      )}
      <p role="status" className="text-sm text-muted">
        {checking
          ? 'Checking library write access…'
          : storage !== null
            ? storage.length === 0
              ? 'Mount check complete. No media libraries are configured.'
              : `Mount check complete. ${storage.filter(item => item.canWrite).length} of ${storage.length} libraries are writable. Read-only libraries keep browsing and playback available.`
            : ''}
      </p>
      {storage?.map(item => (
        <p key={item.libraryId} className="text-sm text-muted">
          <strong>
            {item.name}:{' '}
            {item.canWrite ? 'Writable' : item.configuredWritable ? 'Write access unavailable' : 'Configured read-only'}
            .
          </strong>
          {item.warning && ` ${item.warning}`}
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
