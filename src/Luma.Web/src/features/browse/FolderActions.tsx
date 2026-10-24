import { FileToolbar } from '../files/FileToolbar'
import { t } from '../../lib/i18n'
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
      ? t('browse:folderActions.folderInformation')
      : panel === 'import'
        ? t('browse:folderActions.importFolderMetadata')
        : panel === 'hide'
          ? t('browse:folderActions.hideFolder')
          : panel === 'rescan'
            ? root
              ? t('browse:folderActions.rescanLibrary')
              : t('browse:folderActions.rescanFolder')
            : root
              ? t('browse:folderActions.libraryActions')
              : t('browse:folderActions.folderActions')
  return (
    <>
      <IconButton
        label={t('browse:folderActions.folderActionsFor', { value1: folder.name })}
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
          panel === 'import' ? t('browse:folderActions.mergeEXIFXMPTagsFromEveryIndexedPhotoAnd') : folder.name
        }
        sheet
      >
        <div className="space-y-4 overflow-auto p-5">
          {panel === 'actions' && (
            <div className="flex flex-wrap gap-2">
              {extraActions?.(() => setPanel(null))}
              {!root && (
                <FileToolbar
                  compact
                  libraryId={folder.libraryId}
                  selectedFolders={new Set([folder.id])}
                  onClipboard={() => setPanel(null)}
                  onQueued={() => setPanel(null)}
                />
              )}
              <QuietButton onClick={() => setPanel('rescan')}>
                <RefreshCw className="size-4" />
                {root ? t('browse:folderActions.rescanLibrary') : t('browse:folderActions.rescanFolder')}
              </QuietButton>
              <QuietButton onClick={() => setPanel('info')}>
                <Info className="size-4" />
                {t('browse:folderActions.folderInformation')}
              </QuietButton>
              <QuietButton onClick={() => setPanel('import')}>
                <FileInput className="size-4" />
                {t('browse:folderActions.importFolderMetadata')}
              </QuietButton>
              {folder.coverOverride && (
                <QuietButton disabled={resetCover.isPending} onClick={() => resetCover.mutate()}>
                  <ImageMinus className="size-4" />
                  {resetCover.isPending
                    ? t('browse:folderActions.resettingCover')
                    : t('browse:folderActions.resetAlbumCover')}
                </QuietButton>
              )}
              {/* A library root is the library itself; only folders inside it can be hidden. */}
              {!!folder.parentId && (
                <QuietButton onClick={() => setPanel('hide')}>
                  <EyeOff className="size-4" />
                  {t('browse:folderActions.hideFolder')}
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
                  <dt className="text-muted">{t('browse:folderActions.name')}</dt>
                  <dd className="break-words">{folder.name}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t('browse:folderActions.library')}</dt>
                  <dd className="break-words">{libraryName ?? t('browse:folderActions.library')}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t('browse:folderActions.location')}</dt>
                  <dd className="break-words">{[...ancestors, folder].map(item => item.name).join(' / ')}</dd>
                </div>
              </dl>
            </>
          )}
          {panel === 'rescan' &&
            (queued ? (
              <>
                <p role="status" className="text-sm leading-relaxed">
                  {t('browse:folderActions.rescanQueuedFollowItsProgressInBackgroundJobsYou')}
                </p>
                <QuietButton onClick={() => setPanel(null)}>{t('browse:folderActions.done')}</QuietButton>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-muted">
                  {root
                    ? t('browse:folderActions.checksEveryFolderInThisLibraryForNewChanged')
                    : t('browse:folderActions.checksAndEveryFolderInsideItForNewChanged', { value1: folder.name })}
                </p>
                <MetadataModeSelect value={metadataMode} onChange={setChosenMode} />
                <p className="text-sm leading-relaxed text-muted">
                  {t('browse:folderActions.thisControlsTagImportOnlyAndBecomesTheLibrary')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={rescan.isPending} onClick={() => rescan.mutate()}>
                    <RefreshCw className="mr-2 size-4" />
                    {rescan.isPending ? t('browse:folderActions.starting') : t('browse:folderActions.startRescan')}
                  </Button>
                  <QuietButton onClick={() => setPanel('actions')}>{t('browse:folderActions.cancel')}</QuietButton>
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
                {t('browse:folderActions.andEverythingInsideItWillDisappearFromTheLibrary', {
                  folderName: folder.name,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={hide.isPending} onClick={() => hide.mutate()}>
                  <EyeOff className="mr-2 size-4" />
                  {hide.isPending ? t('browse:folderActions.hiding') : t('browse:folderActions.hideFolder')}
                </Button>
                <QuietButton onClick={() => setPanel('actions')}>{t('browse:folderActions.cancel')}</QuietButton>
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
