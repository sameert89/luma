import { useState } from 'react'
import { EllipsisVertical, Info } from 'lucide-react'
import { t } from '../../lib/i18n'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MediaInformation } from '../browse/MediaInformation'
import type { Media } from '../browse/api'
import { FileToolbar } from './FileToolbar'

export function MediaFileMenu({ item }: { item: Media }) {
  const [panel, setPanel] = useState<'actions' | 'info' | null>(null)
  return (
    <>
      <IconButton
        tone="overlay"
        label={t('files:mediaMenu.actionsFor', { name: item.fileName })}
        onClick={() => setPanel('actions')}
      >
        <EllipsisVertical className="size-4" />
      </IconButton>
      <Modal
        open={panel !== null}
        onOpenChange={open => {
          if (!open) setPanel(null)
        }}
        title={t(panel === 'info' ? 'files:mediaMenu.properties' : 'files:fileToolbar.fileActions')}
        description={item.fileName}
        sheet
      >
        <div className="space-y-4 p-5">
          {panel === 'info' ? (
            <MediaInformation item={item} />
          ) : (
            <>
              <QuietButton onClick={() => setPanel('info')}>
                <Info className="size-4" />
                {t('files:mediaMenu.properties')}
              </QuietButton>
              <FileToolbar
                compact
                libraryId={item.libraryId}
                selected={new Set([item.id])}
                onClipboard={() => setPanel(null)}
                onQueued={() => setPanel(null)}
              />
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
