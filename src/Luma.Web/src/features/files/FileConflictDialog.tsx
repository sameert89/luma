import { useEffect, useState, useSyncExternalStore } from 'react'
import { Checkbox, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { chooseConflict, conflictSnapshot, subscribeConflicts } from './fileConflicts'

export function FileConflictDialog() {
  const conflicts = useSyncExternalStore(subscribeConflicts, conflictSnapshot)
  const current = conflicts[0]
  const [all, setAll] = useState(false)
  useEffect(() => setAll(false), [current?.id])
  function choose(choice: 'replace' | 'skip') {
    chooseConflict(choice, all)
    setAll(false)
  }
  return (
    <Modal
      open={!!current}
      onOpenChange={open => { if (!open) choose('skip') }}
      title="An item already exists"
      description="Choose how to handle this destination conflict."
    >
      <div className="space-y-4 p-5">
        <p className="break-words text-sm font-medium">{current?.target}</p>
        <p className="text-sm text-muted">
          Replace moves the existing item and its contents to the recycle bin before publishing this item.
          Skip keeps the destination unchanged.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={all} onChange={event => setAll(event.target.checked)} />
          Apply to all remaining conflicts in this batch
        </label>
        <div className="flex flex-wrap gap-2">
          <QuietButton onClick={() => choose('replace')}>Replace</QuietButton>
          <QuietButton onClick={() => choose('skip')}>Skip</QuietButton>
        </div>
      </div>
    </Modal>
  )
}
