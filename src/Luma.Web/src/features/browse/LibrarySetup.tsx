import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field, QuietButton, Select } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { errorMessage, request, type Library } from './api'
import type { components } from '../../lib/api/generated'

type LibraryRoot = components['schemas']['LibraryRoot']

/** The tag-import choices shared by setup, rescans and library settings. */
export function MetadataModeSelect({ label = 'Tag import', ...props }: { label?: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <Field label={label}><Select value={props.value} disabled={props.disabled} onChange={event => props.onChange(event.target.value)}>
    <option value="none">No tags (index only)</option><option value="embedded">Embedded metadata</option><option value="xmp">Embedded metadata + XMP sidecars</option>
  </Select></Field>
}

/**
 * First visit to a library that was never indexed. Indexing folders as they are opened starts no
 * background work; indexing everything scans the whole library now.
 */
export function LibrarySetup({ library, onClose, onReady }: { library: Library | null; onClose: () => void; onReady: (libraryId: number, rootFolderId?: number) => void }) {
  const client = useQueryClient()
  const [metadataMode, setMetadataMode] = useState('embedded')
  const refresh = () => Promise.all(['tasks', 'indexing', 'libraries'].map(key => client.invalidateQueries({ queryKey: [key] })))
  const scanAll = useMutation({ mutationKey: ['background-task'], mutationFn: (libraryId: number) => request(`/api/libraries/${libraryId}/scans`, undefined, 'POST', { metadataMode }),
    onSuccess: (_, libraryId) => { void refresh(); onReady(libraryId) } })
  const onDemand = useMutation({ mutationFn: async (libraryId: number) => {
    await request(`/api/libraries/${libraryId}/metadata-mode`, undefined, 'PUT', { metadataMode })
    return request<LibraryRoot>(`/api/libraries/${libraryId}/root`, undefined, 'POST')
  }, onSuccess: async (root, libraryId) => { await refresh(); onReady(libraryId, root.folderId) } })
  const busy = scanAll.isPending || onDemand.isPending
  const error = scanAll.error ?? onDemand.error
  return <Modal open={!!library} onOpenChange={open => { if (!open) onClose() }} title="Set up library" description={library?.name ?? ''} sheet>
    <div className="space-y-4 overflow-auto p-5">
      <MetadataModeSelect value={metadataMode} disabled={busy} onChange={setMetadataMode} />
      <p className="text-sm leading-relaxed text-muted">Luma remembers this choice for the library. Change it any time in Settings.</p>
      <div className="space-y-2">
        <Button disabled={busy} onClick={() => onDemand.mutate(library!.id)}>{onDemand.isPending ? 'Opening…' : 'Index folders as I open them'}</Button>
        <p className="text-sm leading-relaxed text-muted">Nothing runs in the background. Each folder is indexed the first time you open it.</p>
      </div>
      <div className="space-y-2">
        <QuietButton disabled={busy} onClick={() => scanAll.mutate(library!.id)}>{scanAll.isPending ? 'Starting…' : 'Index everything now'}</QuietButton>
        <p className="text-sm leading-relaxed text-muted">Scans the whole library in the background. On a large library this can take a long time and use significant disk and CPU.</p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{errorMessage(error)}</p>}
    </div>
  </Modal>
}

/** Each library's tag-import mode, used whenever Luma indexes it or opens a folder missing tags. */
export function LibrarySettings() {
  const client = useQueryClient()
  const libraries = useQuery({ queryKey: ['libraries'], queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal) })
  const update = useMutation({ mutationFn: ({ id, metadataMode }: { id: number; metadataMode: string }) => request(`/api/libraries/${id}/metadata-mode`, undefined, 'PUT', { metadataMode }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['libraries'] }) })
  return <SettingsSection title="Libraries" description="Choose which tags Luma imports when it indexes each library. When you open a folder whose files were indexed without tags, Luma imports them in the background using this choice.">
    {libraries.isPending && <p role="status" className="text-sm text-muted">Loading libraries…</p>}
    {libraries.isError && <p role="alert" className="text-sm text-danger">{errorMessage(libraries.error)}</p>}
    {libraries.data?.length === 0 && <p className="text-sm text-muted">No libraries are configured.</p>}
    {libraries.data?.map(library => <div key={library.id} className="max-w-md">
      <MetadataModeSelect label={`Tag import for ${library.name}`} value={library.metadataMode} disabled={update.isPending} onChange={metadataMode => update.mutate({ id: library.id, metadataMode })} />
    </div>)}
    {update.isError && <p role="alert" className="text-sm text-danger">{errorMessage(update.error)}</p>}
  </SettingsSection>
}
