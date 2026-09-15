import type { ComponentProps, ReactNode } from 'react'

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`min-h-11 w-full rounded-md border border-line bg-canvas px-3 text-sm text-ink placeholder:text-muted ${className}`} {...props} />
}
export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select className={`min-h-11 w-full rounded-md border border-line bg-canvas px-3 text-sm text-ink ${className}`} {...props} />
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-2 text-sm font-medium text-muted">{label}{children}</label>
}
export function QuietButton({ className = '', type = 'button', ...props }: ComponentProps<'button'>) {
  return <button type={type} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface disabled:cursor-default disabled:opacity-40 ${className}`} {...props} />
}
export function IconButton({ label, children, ...props }: ComponentProps<'button'> & { label: string }) {
  return <QuietButton aria-label={label} title={label} {...props}>{children}</QuietButton>
}
