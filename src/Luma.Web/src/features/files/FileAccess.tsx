import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { Field, Input, QuietButton } from '../../components/ui/Controls'
import { mutationHeaders, setMutationToken } from '../../lib/api/mutationAccess'
import { errorMessage, request } from '../browse/api'
import type { components } from '../../lib/api/generated'

export function FileAccess() {
  const client = useQueryClient()
  const [value, setValue] = useState('')
  const [unlocked, setUnlocked] = useState(() => !!mutationHeaders('/api/files/access').Authorization)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [storage, setStorage] = useState<components['schemas']['FileStorageStatus'][]>([])
  const [checking, setChecking] = useState(false)
  const [storageError, setStorageError] = useState('')
  async function checkStorage() {
    setChecking(true)
    setStorageError('')
    try {
      setStorage(
        (await request<components['schemas']['FileStorageStatus'][]>('/api/files/storage-check', undefined, 'POST')) ??
          [],
      )
    } catch (error) {
      setStorageError(`Storage check failed: ${errorMessage(error)} Browsing remains available.`)
    } finally {
      await client.invalidateQueries({ queryKey: ['file-capabilities'] })
      setChecking(false)
    }
  }
  async function unlock() {
    setBusy(true)
    setError('')
    setMutationToken(value)
    try {
      await request('/api/files/access')
      setValue('')
      setUnlocked(true)
      await checkStorage()
    } catch (error) {
      setMutationToken('')
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsSection
      title="File management"
      description="Unlock explicitly writable libraries for this tab. Read-only libraries stay protected."
    >
      <p className="text-sm text-muted">
        Administrator setup: set Luma__Files__AccessToken to a secret of at least 32 characters in Docker environment,
        enable Luma__Indexing__Libraries__0__Writable=true and mount that library with :rw. Restart Luma, then paste the
        same secret below and select Unlock file management. The token is never shown or stored by Luma.
      </p>
      <p className="text-sm text-muted">
        The access token stays in this tab. Unlock file management again after refreshing. Existing Docker installations
        must change the media mount from :ro to :rw and enable Writable to use uploads, moves or deletion. A failed
        mount check disables file changes for that library until a successful recheck. Browsing, playback, captions and
        tag editing continue to work.
      </p>
      {unlocked ? (
        <QuietButton
          onClick={() => {
            setMutationToken('')
            setUnlocked(false)
            setStorage([])
            setStorageError('')
          }}
        >
          Lock file management
        </QuietButton>
      ) : (
        <form
          className="space-y-3"
          onSubmit={event => {
            event.preventDefault()
            void unlock()
          }}
        >
          <Field label="Administrator access token">
            <Input type="password" autoComplete="off" value={value} onChange={event => setValue(event.target.value)} />
          </Field>
          <QuietButton type="submit" disabled={busy || !value}>
            {busy ? 'Checking…' : 'Unlock file management'}
          </QuietButton>
        </form>
      )}
      {unlocked && (
        <QuietButton disabled={checking} onClick={() => void checkStorage()}>
          {checking ? 'Checking media mounts…' : 'Check media mounts'}
        </QuietButton>
      )}
      {storage
        .filter(item => item.warning)
        .map(item => (
          <p key={item.libraryId} role="alert" className="text-sm text-danger">
            {item.name}: {item.warning}
          </p>
        ))}
      {storageError && (
        <p role="alert" className="text-sm text-danger">
          {storageError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
