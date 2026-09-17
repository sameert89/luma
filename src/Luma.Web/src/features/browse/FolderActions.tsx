import { EllipsisVertical, FileInput, Info } from 'lucide-react'
import { useState } from 'react'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MetadataExchange } from '../tags/MetadataExchange'
import { ScanControls } from './ScanControls'
import type { FolderPage } from './api'

export function FolderActions({ folder, libraryName, ancestors = [] }: {
  folder: FolderPage['current']; libraryName?: string; ancestors?: FolderPage['ancestors']
}) {
  const [panel, setPanel] = useState<'actions' | 'info' | 'import' | null>(null)
  const title = panel === 'info' ? 'Folder information' : panel === 'import' ? 'Import folder metadata' : 'Folder actions'
  return <>
    <IconButton label={`Folder actions for ${folder.name}`} onClick={() => setPanel('actions')}><EllipsisVertical className="size-4" /></IconButton>
    <Modal open={panel !== null} onOpenChange={open => { if (!open) setPanel(null) }} title={title}
      description={panel === 'import' ? 'Merge EXIF/XMP tags from every indexed photo and video directly in this folder, regardless of the current filters. Originals stay unchanged.' : folder.name} sheet>
      <div className="space-y-4 overflow-auto p-5">
        {panel === 'actions' && <div className="flex flex-wrap gap-2">
          <QuietButton onClick={() => setPanel('info')}><Info className="size-4" />Folder information</QuietButton>
          <QuietButton onClick={() => setPanel('import')}><FileInput className="size-4" />Import folder metadata</QuietButton>
        </div>}
        {panel === 'info' && <><dl className="space-y-3 text-sm">
          <div><dt className="text-muted">Name</dt><dd className="break-words">{folder.name}</dd></div>
          <div><dt className="text-muted">Library</dt><dd className="break-words">{libraryName ?? 'Library'}</dd></div>
          <div><dt className="text-muted">Location</dt><dd className="break-words">{[...ancestors, folder].map(item => item.name).join(' / ')}</dd></div>
        </dl><ScanControls libraryId={folder.libraryId} /></>}
        {panel === 'import' && <MetadataExchange key={folder.id} filters={{ libraryId: folder.libraryId, folderId: folder.id }} exports={false} />}
      </div>
    </Modal>
  </>
}
