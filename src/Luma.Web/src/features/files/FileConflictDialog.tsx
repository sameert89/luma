import { t } from '../../lib/i18n'
import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { Checkbox, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { chooseConflict, conflictSnapshot, subscribeConflicts } from './fileConflicts'

export function FileConflictDialog() {
  const conflicts = useSyncExternalStore(subscribeConflicts, conflictSnapshot)
  const current = conflicts[0]
  const [all, setAll] = useState(false)
  const allId = useId()
  useEffect(() => setAll(false), [current?.id])
  function choose(choice: 'replace' | 'skip') {
    chooseConflict(choice, all)
    setAll(false)
  }
  return (
    <Modal
      open={!!current}
      onOpenChange={open => {
        if (!open) choose('skip')
      }}
      title={t('files:fileConflictDialog.anItemAlreadyExists')}
      description={t('files:fileConflictDialog.chooseHowToHandleThisDestinationConflict')}
    >
      <div className="space-y-4 p-5">
        <p className="break-words text-sm font-medium">{current?.target}</p>
        <p className="text-sm text-muted">
          {t('files:fileConflictDialog.replaceMovesTheExistingItemAndItsContentsTo')}
        </p>
        <label htmlFor={allId} className="flex items-center gap-2 text-sm">
          <Checkbox id={allId} checked={all} onChange={event => setAll(event.target.checked)} />
          {t('files:fileConflictDialog.applyToAllRemainingConflictsInThisBatch')}
        </label>
        <div className="flex flex-wrap gap-2">
          <QuietButton onClick={() => choose('replace')}>{t('files:fileConflictDialog.replace')}</QuietButton>
          <QuietButton onClick={() => choose('skip')}>{t('files:fileConflictDialog.skip')}</QuietButton>
        </div>
      </div>
    </Modal>
  )
}
