import { useState } from 'react'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { Field, Input, QuietButton } from '../../components/ui/Controls'
import { mutationHeaders, setMutationToken } from '../../lib/api/mutationAccess'
import { errorMessage, request } from '../browse/api'

export function FileAccess() {
  const [value, setValue] = useState('')
  const [unlocked, setUnlocked] = useState(() => !!mutationHeaders('/api/files/access').Authorization)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function unlock() {
    setBusy(true)
    setError('')
    setMutationToken(value)
    try {
      await request('/api/files/access')
      setValue('')
      setUnlocked(true)
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
        Configure Luma:Files:AccessToken on the server and Writable=true for each writable library. The token stays in
        memory; enter it again after refreshing.
      </p>
      {unlocked ? (
        <QuietButton
          onClick={() => {
            setMutationToken('')
            setUnlocked(false)
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
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
