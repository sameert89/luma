import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconButton, QuietButton } from './Controls'

export type ToastTone = 'info' | 'danger'
type Message = { id: number; text: string; tone: ToastTone }
const visibleMs = 6000

/**
 * A message that says its piece and leaves. Something worth keeping on screen belongs in the
 * view it describes; a passing failure does not, and pinning it to a header leaves it behind
 * on every screen visited afterwards.
 */
export function useToast() {
  const [toast, setToast] = useState<Message | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current)
    setToast(null)
  }, [])
  const show = useCallback((text: string, tone: ToastTone = 'info') => {
    window.clearTimeout(timer.current)
    setToast({ id: Date.now(), text, tone })
    timer.current = window.setTimeout(() => setToast(null), visibleMs)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { toast, show, dismiss }
}

export function Toast({
  toast,
  onDismiss,
  action,
  passThrough = false,
}: {
  toast: Message | null
  onDismiss: () => void
  action?: { label: string; onClick: () => void }
  passThrough?: boolean
}) {
  if (!toast) return null
  return (
    <div
      key={toast.id}
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      className={`${passThrough ? 'pointer-events-none' : ''} motion-rise fixed inset-x-4 bottom-20 z-50 flex items-center gap-3 rounded-2xl border bg-surface p-3 shadow-lg sm:inset-x-auto sm:left-1/2 sm:w-96 sm:-translate-x-1/2 md:bottom-6 ${toast.tone === 'danger' ? 'border-danger' : 'border-line'}`}
    >
      <p className={`min-w-0 flex-1 text-sm leading-relaxed ${toast.tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
        {toast.text}
      </p>
      {action && (
        <QuietButton className="pointer-events-auto" onClick={action.onClick}>
          {action.label}
        </QuietButton>
      )}
      <IconButton className="pointer-events-auto" label="Dismiss" onClick={onDismiss}>
        <X className="size-4" />
      </IconButton>
    </div>
  )
}
