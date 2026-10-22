import { t } from '../../lib/i18n'
import { FolderOpen, FolderPlus, Trash2, ScanLine, Check, ArrowUp, Home } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useId, useRef, useState } from 'react'
import { Checkbox, Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request, type Library } from '../browse/api'
import type { components } from '../../lib/api/generated'

type Location = components['schemas']['PanelSourceLocation']
export function ComicLocations({ onSaved }: { onSaved?: () => void }) {
  const checkboxId = useId()
  const sources = useQuery({
    queryKey: ['comic-sources'],
    queryFn: ({ signal }) => request<components['schemas']['PanelSourceConfiguration']>('/api/panels/sources', signal),
  })
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal),
  })
  const [locations, setLocations] = useState<Location[]>([])
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [browsing, setBrowsing] = useState<number | null>(null)
  const initialized = useRef(false)
  const client = useQueryClient()
  useEffect(() => {
    if (sources.data && !initialized.current) {
      setLocations(sources.data.locations ?? [])
      initialized.current = true
    }
  }, [sources.data])
  function patch(index: number, value: Partial<Location>) {
    setLocations(rows => rows.map((row, i) => (i === index ? { ...row, ...value } : row)))
  }
  async function save() {
    setBusy(true)
    setMessage('')
    try {
      await request('/api/panels/sources', undefined, 'PUT', {
        locations: locations.map(({ libraryId, relativePath, imageFolders, excludeFromGallery }) => ({
          libraryId,
          relativePath,
          imageFolders,
          excludeFromGallery,
        })),
      })
      await Promise.all(
        ['comic-sources', 'comics', 'tasks', 'media', 'folders', 'libraries', 'tags', 'collection-tags'].map(key =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      )
      setMessage(t('panels:comicLocations.comicLocationsSavedRecursiveDiscoveryIsQueuedReadingProgress'))
      onSaved?.()
    } catch (error) {
      setMessage(
        t('panels:comicLocations.checkThatTheLibraryIsConfiguredAndTheFolder', { value1: errorMessage(error) }),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4 p-5">
      <p className="whitespace-pre-line text-sm text-muted">
        {t('panels:comicLocations.chooseLocationsInsideYourServerConfiguredLibrariesEachLocation')}
      </p>
      {sources.isError && <p role="alert">{errorMessage(sources.error)}</p>}
      {locations.map((row, index) => (
        <fieldset key={index} className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">
            {t('panels:comicLocations.comicLocation', { number: index + 1 })}
          </legend>
          <Field label={t('panels:comicLocations.library')}>
            <Select
              value={row.libraryId}
              onChange={event => patch(index, { libraryId: Number(event.target.value), relativePath: '' })}
            >
              <option value={0}>{t('panels:comicLocations.chooseLibrary')}</option>
              {libraries.data?.map(library => (
                <option key={library.id} value={library.id}>
                  {library.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="break-words text-sm text-muted">
            {row.relativePath || t('panels:comicLocations.entireLibrary')}
          </p>
          <QuietButton disabled={!row.libraryId} onClick={() => setBrowsing(index)}>
            <FolderOpen className="size-4" aria-hidden="true" />
            {t('panels:comicLocations.chooseFolder')}
          </QuietButton>
          <details className="text-sm text-muted">
            <summary>{t('panels:comicLocations.enterAPathManually')}</summary>
            <Field label={t('panels:comicLocations.folderRelativeToLibrary')}>
              <Input
                placeholder={t('panels:comicLocations.optionalRelativePath')}
                value={row.relativePath}
                onChange={event => patch(index, { relativePath: event.target.value })}
              />
            </Field>
          </details>
          <QuietButton onClick={() => setLocations(rows => rows.filter((_, i) => i !== index))}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('panels:comicLocations.removeLocation')}
          </QuietButton>
          <label htmlFor={`${checkboxId}-${index}`} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${checkboxId}-${index}`}
              checked={row.imageFolders}
              onChange={event => patch(index, { imageFolders: event.target.checked })}
            />
            {t('panels:comicLocations.treatFoldersContainingImagesAsComics')}
          </label>
          <label htmlFor={`${checkboxId}-exclude-${index}`} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${checkboxId}-exclude-${index}`}
              checked={row.excludeFromGallery ?? true}
              onChange={event => patch(index, { excludeFromGallery: event.target.checked })}
            />
            {t('panels:comicLocations.excludeFromGallery')}
          </label>
          <p className="text-xs text-muted">
            {t('panels:comicLocations.hidesThisLocationAndItsSubfoldersFromGalleryTag')}
          </p>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <QuietButton
          disabled={locations.length >= 32 || libraries.isPending}
          onClick={() => {
            setLocations(rows => [
              ...rows,
              {
                libraryId: libraries.data?.[0]?.id ?? 0,
                relativePath: '',
                imageFolders: false,
                excludeFromGallery: true,
              },
            ])
            setBrowsing(locations.length)
          }}
        >
          <FolderPlus className="size-4" aria-hidden="true" />
          {t('panels:comicLocations.addLocation')}
        </QuietButton>
        <QuietButton
          disabled={busy || sources.isPending || locations.some(row => !row.libraryId)}
          onClick={() => void save()}
        >
          <ScanLine className="size-4" aria-hidden="true" />
          {busy ? t('panels:comicLocations.saving') : t('panels:comicLocations.saveLocationsAndScan')}
        </QuietButton>
      </div>
      <p className="text-sm text-muted">{t('panels:comicLocations.newDisksOrSharesMustFirstBeMountedAnd')}</p>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Modal
        open={browsing !== null}
        onOpenChange={open => {
          if (!open) setBrowsing(null)
        }}
        title={t('panels:comicLocations.chooseComicFolder')}
        description={t('panels:comicLocations.browseYourLibraryFoldersOrSearchByFolderName')}
        sheet
      >
        {browsing !== null && locations[browsing] && (
          <div className="space-y-3 p-5">
            <Field label={t('panels:comicLocations.chooseLibrary')}>
              <Select
                value={locations[browsing].libraryId}
                onChange={event => patch(browsing, { libraryId: Number(event.target.value), relativePath: '' })}
              >
                {libraries.data?.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <FolderPicker
              key={locations[browsing].libraryId}
              library={libraries.data?.find(item => item.id === locations[browsing].libraryId)}
              onChoose={relativePath => {
                patch(browsing, { relativePath })
                setBrowsing(null)
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
function FolderPicker({ library, onChoose }: { library?: Library; onChoose: (path: string) => void }) {
  const [path, setPath] = useState(''),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0)
  const typed = useDeferredValue(search.trim())
  const browse = useQuery({
    queryKey: ['comic-source-folders', library?.id, path, offset],
    queryFn: ({ signal }) =>
      request<components['schemas']['SourceFolderPage']>(
        `/api/panels/source-folders?libraryId=${library!.id}&path=${encodeURIComponent(path)}&offset=${offset}`,
        signal,
      ),
    enabled: !!library,
  })
  const matches = useQuery({
    queryKey: ['comic-folder-search', library?.id, typed],
    queryFn: ({ signal }) =>
      request<components['schemas']['SourceFolderPage']>(
        `/api/panels/source-folders?libraryId=${library!.id}&q=${encodeURIComponent(typed)}`,
        signal,
      ),
    enabled: !!library && !!typed,
  })
  const rows = new Map<string, components['schemas']['SourceFolderChoice']>()
  for (const item of browse.data?.items ?? [])
    if (!typed || item.name.toLowerCase().includes(typed.toLowerCase())) rows.set(item.relativePath, item)
  if (typed) for (const item of matches.data?.items ?? []) rows.set(item.relativePath, item)
  function visit(next: string) {
    setPath(next)
    setSearch('')
    setOffset(0)
  }
  return (
    <div className="space-y-3">
      <Input
        aria-label={t('panels:comicLocations.searchFolders')}
        placeholder={t('panels:comicLocations.findFoldersByName')}
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      <p className="break-words text-sm">
        {library?.name} / {path || '(root)'}
      </p>
      <div className="flex flex-wrap gap-2">
        <QuietButton onClick={() => onChoose(path)}>
          <Check className="size-4" aria-hidden="true" />
          {t('panels:comicLocations.useThisFolder')}
        </QuietButton>
        {path && (
          <QuietButton onClick={() => visit(path.split('/').slice(0, -1).join('/'))}>
            <ArrowUp className="size-4" aria-hidden="true" />
            {t('panels:comicLocations.upOneFolder')}
          </QuietButton>
        )}
        {path && (
          <QuietButton onClick={() => visit('')}>
            <Home className="size-4" aria-hidden="true" />
            {t('panels:comicLocations.libraryRoot')}
          </QuietButton>
        )}
      </div>
      <div className="max-h-72 space-y-2 overflow-auto">
        {[...rows.values()].map(item => (
          <QuietButton
            key={item.relativePath}
            className="w-full justify-start text-left"
            onClick={() => visit(item.relativePath)}
          >
            <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate">{item.name}</span>
              {typed && <span className="block break-words text-xs text-muted">{item.relativePath}</span>}
            </span>
          </QuietButton>
        ))}
      </div>
      {!browse.isPending && rows.size === 0 && (
        <p className="text-sm text-muted">{t('panels:comicLocations.noMatchingFoldersTryAShorterNameOrBrowse')}</p>
      )}
      {browse.data?.nextOffset !== null && browse.data?.nextOffset !== undefined && !typed && (
        <QuietButton onClick={() => setOffset(browse.data!.nextOffset!)}>
          {t('panels:comicLocations.moreFolders')}
        </QuietButton>
      )}
      {(browse.error || matches.error) && <p role="alert">{errorMessage(browse.error || matches.error)}</p>}
    </div>
  )
}
