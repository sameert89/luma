import { useMutation, useQueryClient } from '@tanstack/react-query'
import { EllipsisVertical, EyeOff, FileInput, Info } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MetadataExchange } from '../tags/MetadataExchange'
import { ScanControls } from './ScanControls'
import { hiddenFolderQueries } from './HiddenFolders'
import { errorMessage, request, type FolderPage } from './api'

export function FolderActions({ folder, libraryName, ancestors = [], onHidden }: {
  folder: FolderPage['current']; libraryName?: string; ancestors?: FolderPage['ancestors']; onHidden?: () => void
}) {
  const [panel, setPanel] = useState<'actions' | 'info' | 'import' | 'hide' | null>(null)
  const client = useQueryClient()
  const hide = useMutation({ mutationFn: () => request(`/api/folders/${folder.id}/hidden`, undefined, 'PUT', { hidden: true }),
    onSuccess: () => { setPanel(null); onHidden?.(); for (const queryKey of hiddenFolderQueries) void client.invalidateQueries({ queryKey }) } })
  const title = panel === 'info' ? 'Folder information' : panel === 'import' ? 'Import folder metadata' : panel === 'hide' ? 'Hide folder' : 'Folder actions'
  return <>
    <IconButton label={`Folder actions for ${folder.name}`} onClick={() => setPanel('actions')}><EllipsisVertical className="size-4" /></IconButton>
    <Modal open={panel !== null} onOpenChange={open => { if (!open) setPanel(null) }} title={title}
      description={panel === 'import' ? 'Merge EXIF/XMP tags from every indexed photo and video directly in this folder, regardless of the current filters. Originals stay unchanged.' : folder.name} sheet>
      <div className="space-y-4 overflow-auto p-5">
        {panel === 'actions' && <div className="flex flex-wrap gap-2">
          <QuietButton onClick={() => setPanel('info')}><Info className="size-4" />Folder information</QuietButton>
          <QuietButton onClick={() => setPanel('import')}><FileInput className="size-4" />Import folder metadata</QuietButton>
          {/* A library root is the library itself; only folders inside it can be hidden. */}
          {!!folder.parentId && <QuietButton onClick={() => setPanel('hide')}><EyeOff className="size-4" />Hide folder</QuietButton>}
        </div>}
        {panel === 'info' && <><dl className="space-y-3 text-sm">
          <div><dt className="text-muted">Name</dt><dd className="break-words">{folder.name}</dd></div>
          <div><dt className="text-muted">Library</dt><dd className="break-words">{libraryName ?? 'Library'}</dd></div>
          <div><dt className="text-muted">Location</dt><dd className="break-words">{[...ancestors, folder].map(item => item.name).join(' / ')}</dd></div>
        </dl><ScanControls libraryId={folder.libraryId} /></>}
        {panel === 'import' && <MetadataExchange key={folder.id} filters={{ libraryId: folder.libraryId, folderId: folder.id }} exports={false} />}
        {panel === 'hide' && <>
          <p className="text-sm leading-relaxed text-muted">“{folder.name}” and everything inside it will disappear from the library, search, reels and slideshows, and will no longer be indexed. Nothing is deleted; show it again from Settings at any time.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={hide.isPending} onClick={() => hide.mutate()}><EyeOff className="mr-2 size-4" />{hide.isPending ? 'Hiding…' : 'Hide folder'}</Button>
            <QuietButton onClick={() => setPanel('actions')}>Cancel</QuietButton>
          </div>
          {hide.isError && <p role="alert" className="text-sm text-danger">{errorMessage(hide.error)}</p>}
        </>}
      </div>
    </Modal>
  </>
}
