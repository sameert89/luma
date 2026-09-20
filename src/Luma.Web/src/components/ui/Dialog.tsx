import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { Button } from './Button'

export function Dialog({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactNode
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-11/12 max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-canvas p-6 shadow-lg">
          <DialogPrimitive.Title className="text-xl font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-3 leading-relaxed text-muted">
            {description}
          </DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close asChild>
            <Button className="mt-6">Close</Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
