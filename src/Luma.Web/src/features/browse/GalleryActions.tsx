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
        <QuietButton onClick={() => run(onSlideshow)}>Start slideshow</QuietButton>
        <QuietButton onClick={() => run(onRefresh)}>Refresh collection</QuietButton>
        <QuietButton onClick={() => run(onFilters)}>Edit filters</QuietButton>
        <QuietButton onClick={() => run(onToggleFilters)}>
          {filtersVisible ? 'Hide filters' : 'Show filters'}
        </QuietButton>
        <QuietButton onClick={() => run(onClearFilters)}>Clear all filters</QuietButton>
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
      <IconButton label="Gallery actions" onClick={() => setOpen(true)}>
        <EllipsisVertical className="size-4" />
      </IconButton>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Gallery actions"
        description="Slideshow, selection and filters."
        sheet
      >
        <div className="flex flex-wrap gap-2 p-5">{actions(() => setOpen(false))}</div>
      </Modal>
    </>
  )
}
