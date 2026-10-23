import { t } from '../../lib/i18n'
import { useState } from 'react'
import { EllipsisVertical } from 'lucide-react'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { FolderActions } from './FolderActions'
import type { FolderPage } from './api'

export function GalleryActions({
  folder,
  libraryName,
  ancestors,
  onHidden,
  onSlideshow,
  onRefresh,
  filtersVisible,
  onToggleFilters,
  onFilters,
  onClearFilters,
}: {
  folder?: FolderPage['current']
  libraryName?: string
  ancestors?: FolderPage['ancestors']
  onHidden?: () => void
  onSlideshow: () => void
  onRefresh: () => void
  filtersVisible: boolean
  onToggleFilters: () => void
  onFilters: () => void
  onClearFilters: () => void
}) {
  const [open, setOpen] = useState(false)
  function actions(close: () => void) {
    function run(action: () => void) {
      close()
      action()
    }
    return (
      <>
        <QuietButton onClick={() => run(onSlideshow)}>{t('browse:galleryActions.startSlideshow')}</QuietButton>
        <QuietButton onClick={() => run(onRefresh)}>{t('browse:galleryActions.refreshCollection')}</QuietButton>
        <QuietButton onClick={() => run(onFilters)}>{t('browse:galleryActions.editFilters')}</QuietButton>
        <QuietButton onClick={() => run(onToggleFilters)}>
          {filtersVisible ? t('browse:galleryActions.hideFilters') : t('browse:galleryActions.showFilters')}
        </QuietButton>
        <QuietButton onClick={() => run(onClearFilters)}>{t('browse:galleryActions.clearAllFilters')}</QuietButton>
      </>
    )
  }
  if (folder)
    return (
      <FolderActions
        folder={folder}
        libraryName={libraryName}
        ancestors={ancestors}
        onHidden={onHidden}
        extraActions={actions}
      />
    )
  return (
    <>
      <IconButton label={t('browse:galleryActions.galleryActions')} onClick={() => setOpen(true)}>
        <EllipsisVertical className="size-4" />
      </IconButton>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('browse:galleryActions.galleryActions')}
        description={t('browse:galleryActions.slideshowSelectionAndFilters')}
        sheet
      >
        <div className="flex flex-wrap gap-2 p-5">{actions(() => setOpen(false))}</div>
      </Modal>
    </>
  )
}
