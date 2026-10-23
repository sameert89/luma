import { t } from '../../lib/i18n'
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
    <SettingsSection
      title={t('files:fileAccess.fileManagement')}
      description={t('files:fileAccess.allowUploadsMovesAndDeletionInWritableLibraries')}
    >
      <label htmlFor={toggleId} className="flex items-center gap-2 text-sm">
        <Checkbox
          id={toggleId}
          checked={settings.data?.enabled ?? false}
          disabled={busy || settings.isPending}
          onChange={event => void change(event.target.checked)}
        />
        {t('files:fileAccess.enableFileManagement')}
      </label>
      <p className="text-sm text-muted">{t('files:fileAccess.savedForThisServerLumaFilesEnabledSetsThe')}</p>
      {settings.data?.enabled && (
        <div className="space-y-2">
          <QuietButton disabled={busy} aria-busy={checking} onClick={() => void checkStorage()}>
            {checking && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
            {checking ? t('files:fileAccess.checkingMediaMounts') : t('files:fileAccess.checkMediaMounts')}
          </QuietButton>
          <p className="text-sm text-muted">
            {t('files:fileAccess.recheckWriteAccessAfterChangingMountsOrPermissionsThis')}
          </p>
        </div>
      )}
      <p role="status" className="text-sm text-muted">
        {checking
          ? t('files:fileAccess.checkingLibraryWriteAccess')
          : storage !== null
            ? storage.length === 0
              ? t('files:fileAccess.mountCheckCompleteNoMediaLibrariesAreConfigured')
              : t('files:fileAccess.mountCheckCompleteOfLibrariesAreWritableReadOnly', {
                  value1: storage.filter(item => item.canWrite).length,
                  value2: storage.length,
                })
            : ''}
      </p>
      {storage?.map(item => (
        <p key={item.libraryId} className="text-sm text-muted">
          <strong>
            {item.name}:{' '}
            {item.canWrite
              ? t('files:fileAccess.writable')
              : item.configuredWritable
                ? t('files:fileAccess.writeAccessUnavailable')
                : t('files:fileAccess.configuredReadOnly')}
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
