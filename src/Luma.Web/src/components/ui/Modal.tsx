import * as Primitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { IconButton } from './Controls'

let markerSeed = 0
// A closing modal leaves its history entry with an asynchronous history.back(). A modal that
// opens before that traversal lands (a slideshow opening the viewer right after its menu
// closes) must wait for it, or the traversal would pop the new modal's entry and close it.
let leaving: Promise<void> | null = null
function leaveEntry() {
  const done = new Promise<void>(resolve => {
    const finish = () => { window.removeEventListener('popstate', finish); clearTimeout(fallback); if (leaving === done) leaving = null; resolve() }
    const fallback = setTimeout(finish, 1000)
    window.addEventListener('popstate', finish)
  })
  leaving = done
  window.history.back()
}
function createHistoryMarker() {
  markerSeed += 1
  return `luma-modal-${Date.now().toString(36)}-${markerSeed.toString(36)}`
}

export function Modal({ open, onOpenChange, title, description, children, wide = false, sheet = false, hideHeader = false, restoreFocus, onClosed }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; wide?: boolean; sheet?: boolean; hideHeader?: boolean; restoreFocus?: () => void; onClosed?: () => void
}) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const change = useRef(onOpenChange)
  const historyMarker = useRef<string | null>(null)
  const historyCleanup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  change.current = onOpenChange
  useEffect(() => {
    if (!open) return
    clearTimeout(historyCleanup.current)
    let active = true
    function back() { if (window.history.state?.lumaModal !== historyMarker.current) change.current(false) }
    function attach() {
      if (!active) return
      if (!historyMarker.current || window.history.state?.lumaModal !== historyMarker.current) {
        historyMarker.current = createHistoryMarker()
        window.history.pushState({ ...window.history.state, lumaModal: historyMarker.current }, '', window.location.href)
      }
      window.addEventListener('popstate', back)
    }
    if (leaving) void leaving.then(attach)
    else attach()
    return () => {
      active = false
      window.removeEventListener('popstate', back)
      const marker = historyMarker.current
      // Delay disposal so StrictMode's immediate setup can retain the same entry.
      historyCleanup.current = setTimeout(() => {
        if (marker && window.history.state?.lumaModal === marker) leaveEntry()
        historyMarker.current = null
      }, 0)
    }
  }, [open])
  return <Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Portal>{open && <>
      <Primitive.Overlay className="motion-overlay fixed inset-0 z-40 bg-black/70" />
      <Primitive.Content data-motion={wide ? 'viewer' : sheet ? 'sheet' : 'dialog'} tabIndex={-1}
        onOpenAutoFocus={event => { event.preventDefault(); previousFocus.current = document.activeElement as HTMLElement; (event.currentTarget as HTMLElement).focus({ preventScroll: true }) }}
        onCloseAutoFocus={event => { event.preventDefault(); onClosed?.(); if (restoreFocus) restoreFocus(); else previousFocus.current?.focus({ preventScroll: true }) }}
        onPointerDown={event => { if (!wide && event.target === event.currentTarget) onOpenChange(false) }}
        className={wide ? 'fixed inset-0 z-50 flex h-dvh w-full flex-col bg-canvas' : 'fixed inset-0 z-50 flex h-dvh w-full items-end justify-center sm:items-center sm:p-4'}>
        {wide ? <>
          {hideHeader ? <><Primitive.Title className="sr-only">{title}</Primitive.Title><Primitive.Description className="sr-only">{description}</Primitive.Description></> : null}
          {!hideHeader && <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
            <div className="min-w-0"><Primitive.Title className="truncate text-lg font-semibold">{title}</Primitive.Title><Primitive.Description className="sr-only">{description}</Primitive.Description></div>
            <Primitive.Close asChild><IconButton label="Close"><X className="size-5" /></IconButton></Primitive.Close>
          </header>}
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </> : <div data-motion-panel="true" className={sheet ? 'flex max-h-dvh w-full min-h-0 flex-col overflow-hidden rounded-t-3xl border border-line bg-canvas sm:max-w-xl sm:rounded-2xl' : 'flex max-h-dvh w-full min-h-0 flex-col overflow-hidden rounded-t-3xl border border-line bg-canvas sm:max-w-xl sm:rounded-2xl'}>
          {!hideHeader && <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
            <div className="min-w-0"><Primitive.Title className="truncate text-lg font-semibold">{title}</Primitive.Title><Primitive.Description className="sr-only">{description}</Primitive.Description></div>
            <Primitive.Close asChild><IconButton label="Close"><X className="size-5" /></IconButton></Primitive.Close>
          </header>}
          {hideHeader && <><Primitive.Title className="sr-only">{title}</Primitive.Title><Primitive.Description className="sr-only">{description}</Primitive.Description></>}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>
        </div>}
      </Primitive.Content>
    </>}</Primitive.Portal>
  </Primitive.Root>
}
