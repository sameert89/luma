import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EllipsisVertical, EyeOff, FileInput, ImageMinus, Info, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MetadataExchange } from '../tags/MetadataExchange'
import { hiddenFolderQueries } from './HiddenFolders'
import { MetadataModeSelect } from './LibrarySetup'
import { errorMessage, request, type FolderPage, type Library } from './api'

export function FolderActions({
  folder,
  libraryName,
  ancestors = [],
  onHidden,
  extraActions,
  tone,
}: {
  folder: FolderPage['current']
  libraryName?: string
  ancestors?: FolderPage['ancestors']
  onHidden?: () => void
  extraActions?: (close: () => void) => ReactNode
  tone?: 'overlay'
}) {
  const [panel, setPanel] = useState<'actions' | 'info' | 'import' | 'hide' | 'rescan' | null>(null)
  const [chosenMode, setChosenMode] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  const client = useQueryClient()
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal),
    enabled: panel === 'rescan',
  })
  // A rescan starts from the library's current setting until the person picks another.
  const metadataMode =
    chosenMode ?? libraries.data?.find(item => item.id === folder.libraryId)?.metadataMode ?? 'embedded'
  // A library's root folder is the library itself, so rescanning it rescans the whole library.
  const root = !folder.parentId
  const rescan = useMutation({
    mutationKey: ['background-task'],
    mutationFn: () => request(`/api/folders/${folder.id}/scans`, undefined, 'POST', { metadataMode }),
    onSuccess: async () => {
      setQueued(true)
      await Promise.all(['tasks', 'indexing', 'scan'].map(key => client.invalidateQueries({ queryKey: [key] })))
    },
  })
  const hide = useMutation({
    mutationFn: () => request(`/api/folders/${folder.id}/hidden`, undefined, 'PUT', { hidden: true }),
    onSuccess: () => {
      setPanel(null)
      onHidden?.()
      for (const queryKey of hiddenFolderQueries) void client.invalidateQueries({ queryKey })
    },
  })
  // Clears only the folder's manual cover choice; automatic selection and the Settings style apply again.
  const resetCover = useMutation({
    mutationFn: () => request(`/api/folders/${folder.id}/cover`, undefined, 'PUT', { mediaId: null }),
    onSuccess: async () => {
      setPanel(null)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['folders'] }),
        client.invalidateQueries({ queryKey: ['libraries'] }),
      ])
    },
  })
  const title =
    panel === 'info'
      ? 'Folder information'
      : panel === 'import'
        ? 'Import folder metadata'
        : panel === 'hide'
          ? 'Hide folder'
          : panel === 'rescan'
            ? root
              ? 'Rescan library'
              : 'Rescan folder'
            : root
              ? 'Library actions'
              : 'Folder actions'
  return (
    <>
      <IconButton
        label={`Folder actions for ${folder.name}`}
        tone={tone}
        onClick={() => {
          setPanel('actions')
          setQueued(false)
          setChosenMode(null)
          rescan.reset()
        }}
      >
        <EllipsisVertical className="size-4" />
      </IconButton>
      <Modal
        open={panel !== null}
        onOpenChange={open => {
          if (!open) setPanel(null)
        }}
        title={title}
        description={
          panel === 'import'
            ? 'Merge EXIF/XMP tags from every indexed photo and video in this folder and the folders inside it, regardless of the current filters. Originals stay unchanged.'
            : folder.name
        }
        sheet
      >
        <div className="space-y-4 overflow-auto p-5">
          {panel === 'actions' && (
            <div className="flex flex-wrap gap-2">
              {extraActions?.(() => setPanel(null))}
              <QuietButton onClick={() => setPanel('rescan')}>
                <RefreshCw className="size-4" />
                {root ? 'Rescan library' : 'Rescan folder'}
              </QuietButton>
              <QuietButton onClick={() => setPanel('info')}>
                <Info className="size-4" />
                Folder information
              </QuietButton>
              <QuietButton onClick={() => setPanel('import')}>
                <FileInput className="size-4" />
                Import folder metadata
              </QuietButton>
              {folder.coverOverride && (
                <QuietButton disabled={resetCover.isPending} onClick={() => resetCover.mutate()}>
                  <ImageMinus className="size-4" />
                  {resetCover.isPending ? 'Resetting cover…' : 'Reset album cover'}
                </QuietButton>
              )}
              {/* A library root is the library itself; only folders inside it can be hidden. */}
              {!!folder.parentId && (
                <QuietButton onClick={() => setPanel('hide')}>
                  <EyeOff className="size-4" />
                  Hide folder
                </QuietButton>
              )}
            </div>
          )}
          {panel === 'actions' && resetCover.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(resetCover.error)}
            </p>
          )}
          {panel === 'info' && (
            <>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Name</dt>
                  <dd className="break-words">{folder.name}</dd>
                </div>
                <div>
                  <dt className="text-muted">Library</dt>
                  <dd className="break-words">{libraryName ?? 'Library'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Location</dt>
                  <dd className="break-words">{[...ancestors, folder].map(item => item.name).join(' / ')}</dd>
                </div>
              </dl>
            </>
          )}
          {panel === 'rescan' &&
            (queued ? (
              <>
                <p role="status" className="text-sm leading-relaxed">
                  Rescan queued. Follow its progress in Background jobs; you can keep browsing meanwhile.
                </p>
                <QuietButton onClick={() => setPanel(null)}>Done</QuietButton>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-muted">
                  {root
                    ? 'Checks every folder in this library for new, changed or removed photos and videos. On a large library this can take a long time and use significant disk and CPU.'
                    : `Checks “${folder.name}” and every folder inside it for new, changed or removed photos and videos.`}
                </p>
                <MetadataModeSelect value={metadataMode} onChange={setChosenMode} />
                <p className="text-sm leading-relaxed text-muted">
                  This controls tag import only and becomes the library’s automatic tag-import setting. Thumbnail,
                  poster and preview behavior is unchanged.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={rescan.isPending} onClick={() => rescan.mutate()}>
                    <RefreshCw className="mr-2 size-4" />
                    {rescan.isPending ? 'Starting…' : 'Start rescan'}
                  </Button>
                  <QuietButton onClick={() => setPanel('actions')}>Cancel</QuietButton>
                </div>
                {rescan.isError && (
                  <p role="alert" className="text-sm text-danger">
                    {errorMessage(rescan.error)}
                  </p>
                )}
              </>
            ))}
          {panel === 'import' && (
            <MetadataExchange
              key={folder.id}
              filters={{ libraryId: folder.libraryId, folderId: folder.id, recursive: true }}
              exports={false}
            />
          )}
          {panel === 'hide' && (
            <>
              <p className="text-sm leading-relaxed text-muted">
                “{folder.name}” and everything inside it will disappear from the library, search, reels and slideshows,
                and will no longer be indexed. Nothing is deleted; show it again from Settings at any time.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={hide.isPending} onClick={() => hide.mutate()}>
                  <EyeOff className="mr-2 size-4" />
                  {hide.isPending ? 'Hiding…' : 'Hide folder'}
                </Button>
                <QuietButton onClick={() => setPanel('actions')}>Cancel</QuietButton>
              </div>
              {hide.isError && (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(hide.error)}
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
