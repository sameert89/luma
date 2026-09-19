import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { Check } from 'lucide-react'

export function Checkbox({ className = '', ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <span className={`relative inline-flex size-11 shrink-0 items-center justify-center ${className}`}>
    <input {...props} type="checkbox" className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-lg focus-visible:ring-2 focus-visible:ring-accent" />
    <span aria-hidden="true" className="pointer-events-none flex size-6 items-center justify-center rounded-md border border-muted bg-surface text-transparent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-on-accent"><Check className="size-4" /></span>
  </span>
}

export function Range({ className = '', ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input {...props} type="range" className={`h-11 min-w-0 accent-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${className}`} />
}

// A video scrubber; `played` and `loaded` are percentages of the duration.
export function SeekRange({ played, loaded, className = '', style, ...props }: Omit<ComponentProps<'input'>, 'type'> & { played: number; loaded: number }) {
  return <input {...props} type="range" style={{ ...style, '--played': `${played}%`, '--loaded': `${loaded}%` } as CSSProperties}
    className={`seek h-11 min-w-0 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${className}`} />
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
export function QuietButton({ className = '', type = 'button', compact = false, ...props }: ComponentProps<'button'> & { compact?: boolean }) {
  return <button type={type} className={`inline-flex ${compact ? 'min-h-7 px-2 py-1 text-xs' : 'min-h-10 px-3 py-2 text-sm'} items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line font-medium text-ink hover:bg-surface disabled:cursor-default disabled:opacity-40 ${className}`} {...props} />
}
export function QuietLink({ className = '', children, ...props }: ComponentProps<'a'>) {
  return <a className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface ${className}`} {...props}>{children}</a>
}
// overlay: sits on top of photos, so it carries its own dark frosted backing in every theme.
const iconTones = { default: 'border-line text-ink hover:bg-surface', overlay: 'border-white/25 bg-black/45 text-white backdrop-blur-sm hover:bg-black/65' }
export function IconButton({ label, className = '', type = 'button', tone = 'default', ...props }: ComponentProps<'button'> & { label: string; tone?: keyof typeof iconTones }) {
  // A fixed square (not QuietButton's text padding) keeps every icon-only control a true circle.
  return <button type={type} aria-label={label} title={label}
    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full border disabled:cursor-default disabled:opacity-40 ${iconTones[tone]} ${className}`}
    {...props} />
}
