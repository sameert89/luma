import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Checkbox } from '../../components/ui/Controls'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { errorMessage, request } from './api'
import type { components } from '../../lib/api/generated'

type SourceVerificationSetting = components['schemas']['SourceVerificationSetting']

export function SourceVerificationSettings() {
  const client = useQueryClient()
  const setting = useQuery({ queryKey: ['source-verification-setting'], queryFn: ({ signal }) => request<SourceVerificationSetting>('/api/settings/source-verification', signal) })
  const update = useMutation({ mutationFn: (enabled: boolean) => request<void>('/api/settings/source-verification', undefined, 'PUT', { enabled }),
    onSuccess: (_, enabled) => client.setQueryData<SourceVerificationSetting>(['source-verification-setting'], { enabled }) })
  return <SettingsSection title="Missing-file checks" description="Choose whether Luma regularly checks indexed files on disk between scans.">
    {setting.isPending && <p role="status" className="text-sm text-muted">Loading missing-file setting…</p>}
    {setting.isError && <p role="alert" className="text-sm text-danger">{errorMessage(setting.error)}</p>}
    {setting.data && <label htmlFor="source-verification-enabled" className="flex max-w-2xl items-start gap-3 text-sm">
      <Checkbox id="source-verification-enabled" aria-label="Check indexed files for deletions" checked={setting.data.enabled} disabled={update.isPending} onChange={event => update.mutate(event.target.checked)} />
      <span className="pt-2"><span className="block font-medium">Check indexed files for deletions</span><span className="mt-1 block text-muted">Off by default. When enabled, Luma checks known file paths in small background batches and hides files that were deleted from an available library. Manual rescans still reconcile deletions while this is off.</span></span>
    </label>}
    {update.isError && <p role="alert" className="text-sm text-danger">{errorMessage(update.error)}</p>}
  </SettingsSection>
}
