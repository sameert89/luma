import * as Primitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { IconButton } from './Controls'

export function Modal({ open, onOpenChange, title, description, children, wide = false, restoreFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; wide?: boolean; restoreFocus?: () => void
}) {
  const previousFocus = useRef<HTMLElement | null>(null)
  return <Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-black/70" />
      <Primitive.Content onOpenAutoFocus={() => { previousFocus.current = document.activeElement as HTMLElement }} onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus) restoreFocus(); else previousFocus.current?.focus() }}
        className={wide ? 'fixed inset-0 z-50 flex flex-col bg-canvas sm:inset-4 sm:rounded-lg sm:border sm:border-line' : 'fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-5/6 max-w-xl -translate-y-1/2 flex-col rounded-lg border border-line bg-canvas'}>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
          <div className="min-w-0"><Primitive.Title className="truncate text-lg font-semibold">{title}</Primitive.Title><Primitive.Description className="sr-only">{description}</Primitive.Description></div>
          <Primitive.Close asChild><IconButton label="Close"><X className="size-5" /></IconButton></Primitive.Close>
        </header>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>
}
