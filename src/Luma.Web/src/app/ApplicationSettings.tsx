import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Checkbox } from '../components/ui/Controls'
import { SettingsSection } from '../components/ui/SettingsSection'
import { request, errorMessage } from '../features/browse/api'
import type { components } from '../lib/api/generated'

export function ApplicationSettings() {
  const client = useQueryClient()
  const config = useQuery({
    queryKey: ['ui-configuration'],
    queryFn: ({ signal }) => request<components['schemas']['UiConfigurationResponse']>('/api/ui-configuration', signal),
    staleTime: Infinity,
  })
  const flags = config.data?.applications
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function change(key: 'flickEnabled' | 'panelsEnabled', enabled: boolean) {
    setBusy(true)
    setError('')
    try {
      await request('/api/files/applications', undefined, 'PUT', {
        flickEnabled: flags?.flickEnabled ?? true,
        panelsEnabled: flags?.panelsEnabled ?? true,
        [key]: enabled,
      })
      await client.invalidateQueries({ queryKey: ['ui-configuration'] })
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsSection
      title="Applications"
      description="Enable or hide applications for everyone using this server. Saved choices override deployment environment defaults."
    >
      {(['flickEnabled', 'panelsEnabled'] as const).map(key => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={flags?.[key] ?? true}
            disabled={busy || !flags}
            onChange={event => void change(key, event.target.checked)}
          />
          Enable {key === 'flickEnabled' ? 'Flick' : 'Panels'}
        </label>
      ))}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
