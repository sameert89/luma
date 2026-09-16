import type { ComponentProps, ReactNode } from 'react'
import { Check } from 'lucide-react'

export function Checkbox({ className = '', ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <span className={`relative inline-flex size-11 shrink-0 items-center justify-center ${className}`}>
    <input {...props} type="checkbox" className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-lg focus-visible:ring-2 focus-visible:ring-accent" />
    <span aria-hidden="true" className="pointer-events-none flex size-6 items-center justify-center rounded-md border border-muted bg-surface text-transparent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-on-accent"><Check className="size-4" /></span>
  </span>
}

export function Input({ className = '', shape = 'field', ...props }: ComponentProps<'input'> & { shape?: 'field' | 'pill' }) {
  return <input className={`min-h-11 w-full ${shape === 'pill' ? 'rounded-full' : 'rounded-xl'} border border-line bg-canvas px-3 text-sm text-ink placeholder:text-muted focus-visible:border-accent ${className}`} {...props} />
}
export function Select({ className = '', shape = 'field', ...props }: ComponentProps<'select'> & { shape?: 'field' | 'pill' }) {
  return <select className={`min-h-11 w-full ${shape === 'pill' ? 'rounded-full' : 'rounded-xl'} border border-line bg-canvas px-3 text-sm text-ink focus-visible:border-accent ${className}`} {...props} />
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-2 text-sm font-medium text-muted">{label}{children}</label>
}
export function QuietButton({ className = '', type = 'button', ...props }: ComponentProps<'button'>) {
  return <button type={type} className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface disabled:cursor-default disabled:opacity-40 ${className}`} {...props} />
}
export function QuietLink({ className = '', children, ...props }: ComponentProps<'a'>) {
  return <a className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface ${className}`} {...props}>{children}</a>
}
export function IconButton({ label, children, ...props }: ComponentProps<'button'> & { label: string }) {
  return <QuietButton aria-label={label} title={label} {...props}>{children}</QuietButton>
}
