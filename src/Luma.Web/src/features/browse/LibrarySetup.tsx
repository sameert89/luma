import { t } from '../../lib/i18n'
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
  label = t('browse:librarySetup.tagImport'),
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
        <option value="none">{t('browse:librarySetup.doNotImportTags')}</option>
        <option value="embedded">{t('browse:librarySetup.tagsEmbeddedInMedia')}</option>
        <option value="xmp">{t('browse:librarySetup.embeddedTagsXMPSidecars')}</option>
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
      <h3 className="font-medium">{t('browse:librarySetup.automaticDiscovery')}</h3>
      <p className="text-sm leading-relaxed text-muted">
        {t('browse:librarySetup.controlsHowLumaDiscoversFilesAddedAfterTheInitial')}
      </p>
      {query.isPending && (
        <p role="status" className="text-sm text-muted">
          {t('browse:librarySetup.loadingRefreshSettings')}
        </p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(query.error)}
        </p>
      )}
      {value && (
        <div className="max-w-md space-y-3">
          <Field label={t('browse:librarySetup.changeDetectionFor', { value1: library.name })}>
            <Select
              value={value.mode}
              disabled={update.isPending}
              onChange={event => change('mode', event.target.value as RefreshSettings['mode'])}
            >
              <option value="watcher">{t('browse:librarySetup.watchFilesystemRecommended')}</option>
              <option value="periodic">{t('browse:librarySetup.periodicFullScan')}</option>
              <option value="off">{t('browse:librarySetup.manualOnly')}</option>
            </Select>
          </Field>
          {value.mode === 'watcher' && (
            <p className="text-sm text-muted">
              {t('browse:librarySetup.eventDrivenNoPollingOrDirectoryReadsWhileThe')}
            </p>
          )}
          {value.mode === 'periodic' && (
            <p className="text-sm text-muted">
              {t('browse:librarySetup.runsACompleteLibraryScanOnTheIntervalIncluding')}
            </p>
          )}
          {value.mode === 'off' && (
            <p className="text-sm text-muted">
              {t('browse:librarySetup.noAutomaticScansRefreshOnOpenAndManualFolder')}
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
              <span className="block font-medium">{t('browse:librarySetup.refreshFoldersWhenOpened')}</span>
              <span className="mt-1 block text-muted">
                {t('browse:librarySetup.checksOneDirectoryTimestampAndShallowScansItOnly')}
              </span>
            </span>
          </label>
          {value.mode === 'watcher' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('browse:librarySetup.eventDebounceSeconds')}>
                <Input
                  type="number"
                  min={1}
                  max={300}
                  value={value.watcherDebounceSeconds}
                  onChange={event => change('watcherDebounceSeconds', Number(event.target.value))}
                />
              </Field>
              <Field label={t('browse:librarySetup.fileStabilityWaitSeconds')}>
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
            <Field label={t('browse:librarySetup.scanIntervalMinutes')}>
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
              {update.isPending ? t('browse:librarySetup.saving') : t('browse:librarySetup.saveDiscoverySettings')}
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
      title={t('browse:librarySetup.setUpLibrary')}
      description={library?.name ?? ''}
      sheet
    >
      <div className="space-y-4 overflow-auto p-5">
        <MetadataModeSelect
          label={t('browse:librarySetup.automaticTagImport')}
          value={metadataMode}
          disabled={busy}
          onChange={setMetadataMode}
        />
        <p className="text-sm leading-relaxed text-muted">
          {t('browse:librarySetup.thisControlsOnlyEXIFIPTCXMPTagImportIt')}
        </p>
        <div className="space-y-2">
          <Button disabled={busy} onClick={() => onDemand.mutate(library!.id)}>
            {onDemand.isPending ? t('browse:librarySetup.opening') : t('browse:librarySetup.indexFoldersAsIOpenThem')}
          </Button>
          <p className="text-sm leading-relaxed text-muted">
            {t('browse:librarySetup.indexesEachFolderWhenFirstOpenedAfterSetupFilesystem')}
          </p>
        </div>
        <div className="space-y-2">
          <QuietButton disabled={busy} onClick={() => scanAll.mutate(library!.id)}>
            {scanAll.isPending ? t('browse:librarySetup.starting') : t('browse:librarySetup.indexEverythingNow')}
          </QuietButton>
          <p className="text-sm leading-relaxed text-muted">
            {t('browse:librarySetup.scansTheWholeLibraryInTheBackgroundOnA')}
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
      title={t('browse:librarySetup.libraries')}
      description={t('browse:librarySetup.configureAutomaticDiscoveryAndTagImportIndependentlyForEach')}
    >
      {libraries.isPending && (
        <p role="status" className="text-sm text-muted">
          {t('browse:librarySetup.loadingLibraries')}
        </p>
      )}
      {libraries.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(libraries.error)}
        </p>
      )}
      {libraries.data?.length === 0 && (
        <p className="text-sm text-muted">{t('browse:librarySetup.noLibrariesAreConfigured')}</p>
      )}
      {libraries.data?.map(library => (
        <div key={library.id} className="max-w-2xl space-y-4">
          <div className="max-w-md">
            <MetadataModeSelect
              label={t('browse:librarySetup.automaticTagImportFor', { value1: library.name })}
              value={library.metadataMode}
              disabled={update.isPending}
              onChange={metadataMode => update.mutate({ id: library.id, metadataMode })}
            />
          </div>
          <p className="text-sm text-muted">
            {t('browse:librarySetup.tagImportAffectsTagsOnlyPreviewAndThumbnailGeneration')}
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
