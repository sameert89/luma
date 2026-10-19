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
      await request('/api/panels/sources', undefined, 'PUT', { locations })
      await Promise.all(
        ['comic-sources', 'comics', 'tasks', 'media', 'folders', 'libraries', 'tags', 'collection-tags'].map(key =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      )
      setMessage('Comic locations saved. Recursive discovery is queued; reading progress is preserved.')
      onSaved?.()
    } catch (error) {
      setMessage(
        `${errorMessage(error)} Check that the library is configured and the folder path is relative to its root. Comic locations work with read-only media mounts and are independent of the file-management switch.`,
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-muted">
        Choose locations inside your server-configured libraries. Each location is scanned recursively for CBZ, CBR, ZIP
        and RAR archives. Image folders are included only when explicitly enabled. You can change these locations later;
        books outside them are hidden and reading progress is retained.
      </p>
      {sources.isError && <p role="alert">{errorMessage(sources.error)}</p>}
      {locations.map((row, index) => (
        <fieldset key={index} className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Comic location {index + 1}</legend>
          <Field label="Library">
            <Select
              value={row.libraryId}
              onChange={event => patch(index, { libraryId: Number(event.target.value), relativePath: '' })}
            >
              <option value={0}>Choose library</option>
              {libraries.data?.map(library => (
                <option key={library.id} value={library.id}>
                  {library.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="break-words text-sm text-muted">{row.relativePath || 'Entire library'}</p>
          <QuietButton disabled={!row.libraryId} onClick={() => setBrowsing(index)}>
            <FolderOpen className="size-4" aria-hidden="true" />
            Choose folder
          </QuietButton>
          <details className="text-sm text-muted">
            <summary>Enter a path manually</summary>
            <Field label="Folder relative to library">
              <Input
                placeholder="Optional relative path"
                value={row.relativePath}
                onChange={event => patch(index, { relativePath: event.target.value })}
              />
            </Field>
          </details>
          <QuietButton onClick={() => setLocations(rows => rows.filter((_, i) => i !== index))}>
            <Trash2 className="size-4" aria-hidden="true" />
            Remove location
          </QuietButton>
          <label htmlFor={`${checkboxId}-${index}`} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${checkboxId}-${index}`}
              checked={row.imageFolders}
              onChange={event => patch(index, { imageFolders: event.target.checked })}
            />
            Treat folders containing images as comics
          </label>
          <label htmlFor={`${checkboxId}-exclude-${index}`} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${checkboxId}-exclude-${index}`}
              checked={row.excludeFromGallery ?? true}
              onChange={event => patch(index, { excludeFromGallery: event.target.checked })}
            />
            Exclude from Gallery
          </label>
          <p className="text-xs text-muted">
            Hides this location and its subfolders from Gallery, tag collections and XMP exports. Existing indexed items
            and tags are preserved. Uncheck to include comic images in Gallery.
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
          Add location
        </QuietButton>
        <QuietButton
          disabled={busy || sources.isPending || locations.some(row => !row.libraryId)}
          onClick={() => void save()}
        >
          <ScanLine className="size-4" aria-hidden="true" />
          {busy ? 'Saving…' : 'Save locations and scan'}
        </QuietButton>
      </div>
      <p className="text-sm text-muted">
        New disks or shares must first be mounted and configured as Luma libraries on the server. Browse folders
        directly, including locations not indexed yet, or search indexed folder names.
      </p>
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
        title="Choose comic folder"
        description="Browse your library folders or search by folder name."
        sheet
      >
        {browsing !== null && locations[browsing] && (
          <div className="space-y-3 p-5">
            <Field label="Choose library">
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
        aria-label="Search folders"
        placeholder="Find folders by name"
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      <p className="break-words text-sm">
        {library?.name} / {path || '(root)'}
      </p>
      <div className="flex flex-wrap gap-2">
        <QuietButton onClick={() => onChoose(path)}>
          <Check className="size-4" aria-hidden="true" />
          Use this folder
        </QuietButton>
        {path && (
          <QuietButton onClick={() => visit(path.split('/').slice(0, -1).join('/'))}>
            <ArrowUp className="size-4" aria-hidden="true" />
            Up one folder
          </QuietButton>
        )}
        {path && (
          <QuietButton onClick={() => visit('')}>
            <Home className="size-4" aria-hidden="true" />
            Library root
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
        <p className="text-sm text-muted">No matching folders. Try a shorter name or browse from the library root.</p>
      )}
      {browse.data?.nextOffset !== null && browse.data?.nextOffset !== undefined && !typed && (
        <QuietButton onClick={() => setOffset(browse.data!.nextOffset!)}>More folders</QuietButton>
      )}
      {(browse.error || matches.error) && <p role="alert">{errorMessage(browse.error || matches.error)}</p>}
    </div>
  )
}
