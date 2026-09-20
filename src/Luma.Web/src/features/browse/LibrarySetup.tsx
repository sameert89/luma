import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { errorMessage, request, type Library } from './api'
import type { components } from '../../lib/api/generated'

type LibraryRoot = components['schemas']['LibraryRoot']

/** The tag-import choices shared by setup, rescans and library settings. */
export function MetadataModeSelect({
  label = 'Tag import',
  ...props
}: {
  label?: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <Select value={props.value} disabled={props.disabled} onChange={event => props.onChange(event.target.value)}>
        <option value="none">Do not import tags</option>
        <option value="embedded">Tags embedded in media</option>
        <option value="xmp">Embedded tags + XMP sidecars</option>
      </Select>
    </Field>
  )
}

type RefreshSettings = components['schemas']['LibraryRefreshSettings'] & { mode: 'off' | 'watcher' | 'periodic' }

function LibraryRefreshSettings({ library }: { library: Library }) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['library-refresh-settings', library.id],
    queryFn: ({ signal }) => request<RefreshSettings>(`/api/libraries/${library.id}/refresh-settings`, signal),
  })
  const [draft, setDraft] = useState<RefreshSettings | null>(null)
  const value = draft ?? query.data
  const update = useMutation({
    mutationFn: (settings: RefreshSettings) =>
      request<void>(`/api/libraries/${library.id}/refresh-settings`, undefined, 'PUT', settings),
    onSuccess: (_, settings) => {
      client.setQueryData(['library-refresh-settings', library.id], settings)
      setDraft(null)
    },
  })
  const change = <K extends keyof RefreshSettings>(key: K, next: RefreshSettings[K]) =>
    setDraft({ ...value!, [key]: next })
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <h3 className="font-medium">Automatic discovery</h3>
      <p className="text-sm leading-relaxed text-muted">
        Controls how Luma discovers files added after the initial index. Discovered media still uses the normal bounded
        metadata and preview queues.
      </p>
      {query.isPending && (
        <p role="status" className="text-sm text-muted">
          Loading refresh settings…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(query.error)}
        </p>
      )}
      {value && (
        <div className="max-w-md space-y-3">
          <Field label={`Change detection for ${library.name}`}>
            <Select
              value={value.mode}
              disabled={update.isPending}
              onChange={event => change('mode', event.target.value as RefreshSettings['mode'])}
            >
              <option value="watcher">Watch filesystem (recommended)</option>
              <option value="periodic">Periodic full scan</option>
              <option value="off">Manual only</option>
            </Select>
          </Field>
          {value.mode === 'watcher' && (
            <p className="text-sm text-muted">
              Event-driven: no polling or directory reads while the filesystem is idle. After a change, Luma scans only
              the affected folder or newly added subtree.
            </p>
          )}
          {value.mode === 'periodic' && (
            <p className="text-sm text-muted">
              Runs a complete library scan on the interval, including while nobody is using Luma. Use this only when the
              mount does not reliably forward filesystem events.
            </p>
          )}
          {value.mode === 'off' && (
            <p className="text-sm text-muted">
              No automatic scans. Refresh-on-open and manual folder/library rescans remain available.
            </p>
          )}
          <label htmlFor={`refresh-on-open-${library.id}`} className="flex items-start gap-3 text-sm">
            <Checkbox
              id={`refresh-on-open-${library.id}`}
              checked={value.refreshOnOpen}
              disabled={update.isPending}
              onChange={event => change('refreshOnOpen', event.target.checked)}
            />
            <span className="pt-2">
              <span className="block font-medium">Refresh folders when opened</span>
              <span className="mt-1 block text-muted">
                Checks one directory timestamp, and shallow-scans it only when it changed.
              </span>
            </span>
          </label>
          {value.mode === 'watcher' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Event debounce (seconds)">
                <Input
                  type="number"
                  min={1}
                  max={300}
                  value={value.watcherDebounceSeconds}
                  onChange={event => change('watcherDebounceSeconds', Number(event.target.value))}
                />
              </Field>
              <Field label="File stability wait (seconds)">
                <Input
                  type="number"
                  min={1}
                  max={3600}
                  value={value.fileStabilitySeconds}
                  onChange={event => change('fileStabilitySeconds', Number(event.target.value))}
                />
              </Field>
            </div>
          )}
          {value.mode === 'periodic' && (
            <Field label="Scan interval (minutes)">
              <Input
                type="number"
                min={5}
                max={10080}
                value={value.periodicIntervalMinutes}
                onChange={event => change('periodicIntervalMinutes', Number(event.target.value))}
              />
            </Field>
          )}
          {draft && (
            <Button disabled={update.isPending} onClick={() => update.mutate(draft)}>
              {update.isPending ? 'Saving…' : 'Save discovery settings'}
            </Button>
          )}
          {update.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(update.error)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * First visit to a library that was never indexed. Lazy setup avoids an initial full scan;
 * later changes use the library's independently configurable automatic-discovery mode.
 */
export function LibrarySetup({
  library,
  onClose,
  onReady,
}: {
  library: Library | null
  onClose: () => void
  onReady: (libraryId: number, rootFolderId?: number) => void
}) {
  const client = useQueryClient()
  const [metadataMode, setMetadataMode] = useState('embedded')
  const refresh = () =>
    Promise.all(['tasks', 'indexing', 'libraries'].map(key => client.invalidateQueries({ queryKey: [key] })))
  const scanAll = useMutation({
    mutationKey: ['background-task'],
    mutationFn: (libraryId: number) =>
      request(`/api/libraries/${libraryId}/scans`, undefined, 'POST', { metadataMode }),
    onSuccess: (_, libraryId) => {
      void refresh()
      onReady(libraryId)
    },
  })
  const onDemand = useMutation({
    mutationFn: async (libraryId: number) => {
      await request(`/api/libraries/${libraryId}/metadata-mode`, undefined, 'PUT', { metadataMode })
      return request<LibraryRoot>(`/api/libraries/${libraryId}/root`, undefined, 'POST')
    },
    onSuccess: async (root, libraryId) => {
      await refresh()
      onReady(libraryId, root.folderId)
    },
  })
  const busy = scanAll.isPending || onDemand.isPending
  const error = scanAll.error ?? onDemand.error
  return (
    <Modal
      open={!!library}
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title="Set up library"
      description={library?.name ?? ''}
      sheet
    >
      <div className="space-y-4 overflow-auto p-5">
        <MetadataModeSelect
          label="Automatic tag import"
          value={metadataMode}
          disabled={busy}
          onChange={setMetadataMode}
        />
        <p className="text-sm leading-relaxed text-muted">
          This controls only EXIF/IPTC/XMP tag import. It does not disable indexing, thumbnails, video posters or
          on-demand previews. Luma remembers it for this library.
        </p>
        <div className="space-y-2">
          <Button disabled={busy} onClick={() => onDemand.mutate(library!.id)}>
            {onDemand.isPending ? 'Opening…' : 'Index folders as I open them'}
          </Button>
          <p className="text-sm leading-relaxed text-muted">
            Indexes each folder when first opened. After setup, filesystem watching keeps changed folders current by
            default; configure or disable it in Settings.
          </p>
        </div>
        <div className="space-y-2">
          <QuietButton disabled={busy} onClick={() => scanAll.mutate(library!.id)}>
            {scanAll.isPending ? 'Starting…' : 'Index everything now'}
          </QuietButton>
          <p className="text-sm leading-relaxed text-muted">
            Scans the whole library in the background. On a large library this can take a long time and use significant
            disk and CPU.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(error)}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** Each library's tag-import mode, used whenever Luma indexes it or opens a folder missing tags. */
export function LibrarySettings() {
  const client = useQueryClient()
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal),
  })
  const update = useMutation({
    mutationFn: ({ id, metadataMode }: { id: number; metadataMode: string }) =>
      request(`/api/libraries/${id}/metadata-mode`, undefined, 'PUT', { metadataMode }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['libraries'] }),
  })
  return (
    <SettingsSection
      title="Libraries"
      description="Configure automatic discovery and tag import independently for each library."
    >
      {libraries.isPending && (
        <p role="status" className="text-sm text-muted">
          Loading libraries…
        </p>
      )}
      {libraries.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(libraries.error)}
        </p>
      )}
      {libraries.data?.length === 0 && <p className="text-sm text-muted">No libraries are configured.</p>}
      {libraries.data?.map(library => (
        <div key={library.id} className="max-w-2xl space-y-4">
          <div className="max-w-md">
            <MetadataModeSelect
              label={`Automatic tag import for ${library.name}`}
              value={library.metadataMode}
              disabled={update.isPending}
              onChange={metadataMode => update.mutate({ id: library.id, metadataMode })}
            />
          </div>
          <p className="text-sm text-muted">
            Tag import affects tags only; preview and thumbnail generation is unchanged.
          </p>
          <LibraryRefreshSettings library={library} />
        </div>
      ))}
      {update.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(update.error)}
        </p>
      )}
    </SettingsSection>
  )
}
