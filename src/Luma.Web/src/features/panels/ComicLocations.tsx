import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Checkbox, Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request, type Library, type FolderPage } from '../browse/api'
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
      await Promise.all(['comic-sources', 'comics', 'tasks'].map(key => client.invalidateQueries({ queryKey: [key] })))
      setMessage('Comic locations saved. Recursive discovery is queued; reading progress is preserved.')
      onSaved?.()
    } catch (error) {
      setMessage(
        `${errorMessage(error)} Check that the library is configured and the folder path is relative to its root. Comic locations work with read-only media mounts and do not require file-management unlock.`,
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
          <Field label="Folder relative to library">
            <Input
              placeholder="Comics/Manga (empty means library root)"
              value={row.relativePath}
              onChange={event => patch(index, { relativePath: event.target.value })}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <QuietButton disabled={!row.libraryId} onClick={() => setBrowsing(index)}>
              Browse indexed folders
            </QuietButton>
            <QuietButton onClick={() => setLocations(rows => rows.filter((_, i) => i !== index))}>
              Remove location
            </QuietButton>
          </div>
          <label htmlFor={`${checkboxId}-${index}`} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${checkboxId}-${index}`}
              checked={row.imageFolders}
              onChange={event => patch(index, { imageFolders: event.target.checked })}
            />
            Treat folders containing images as comics
          </label>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <QuietButton
          disabled={locations.length >= 32}
          onClick={() =>
            setLocations(rows => [
              ...rows,
              { libraryId: libraries.data?.[0]?.id ?? 0, relativePath: '', imageFolders: false },
            ])
          }
        >
          Add location
        </QuietButton>
        <QuietButton
          disabled={busy || sources.isPending || locations.some(row => !row.libraryId)}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save locations and scan'}
        </QuietButton>
      </div>
      <p className="text-sm text-muted">
        New disks or shares must first be mounted and configured as Luma libraries on the server. Folder browsing uses
        the existing index; enter a relative path directly if it has not been indexed yet.
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
        description="Browse indexed folders or choose the library root."
        sheet
      >
        {browsing !== null && locations[browsing] && (
          <FolderPicker
            library={libraries.data?.find(item => item.id === locations[browsing].libraryId)}
            onChoose={relativePath => {
              patch(browsing, { relativePath })
              setBrowsing(null)
            }}
          />
        )}
      </Modal>
    </div>
  )
}
function FolderPicker({ library, onChoose }: { library?: Library; onChoose: (path: string) => void }) {
  const [folder, setFolder] = useState(library?.rootFolderId),
    [path, setPath] = useState(''),
    [cursor, setCursor] = useState<string>()
  const query = useQuery({
    queryKey: ['comic-folder-picker', library?.id, folder, cursor],
    queryFn: ({ signal }) =>
      request<FolderPage>(
        `/api/folders?libraryId=${library!.id}&parentId=${folder}&limit=48${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        signal,
      ),
    enabled: !!folder,
  })
  return (
    <div className="space-y-3 p-5">
      <p className="break-words text-sm">
        {library?.name} / {path || '(root)'}
      </p>
      <QuietButton onClick={() => onChoose(path)}>Use this folder</QuietButton>
      <QuietButton
        onClick={() => {
          setFolder(library?.rootFolderId)
          setPath('')
          setCursor(undefined)
        }}
      >
        Library root
      </QuietButton>
      {query.data?.items.map(item => (
        <QuietButton
          key={item.id}
          className="w-full justify-start"
          onClick={() => {
            setFolder(item.id)
            setPath([path, item.name].filter(Boolean).join('/'))
            setCursor(undefined)
          }}
        >
          {item.name}
        </QuietButton>
      ))}
      {query.data?.nextCursor && (
        <QuietButton onClick={() => setCursor(query.data!.nextCursor!)}>More folders</QuietButton>
      )}
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
    </div>
  )
}
