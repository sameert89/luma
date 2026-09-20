import { Check, Image, Search } from 'lucide-react'
import { themes, type Theme } from '../../app/themes'

export function ThemePicker({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  return (
    <section className="mx-auto min-h-0 w-full max-w-5xl space-y-4 p-5" aria-label="Theme settings">
      <div>
        <h2 className="text-2xl font-semibold">Theme & appearance</h2>
        <p className="mt-2 text-sm text-muted">Choose how Luma looks on this device.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {themes.map(theme => (
          <button
            key={theme.id}
            type="button"
            aria-pressed={value === theme.id}
            aria-label={theme.name}
            onClick={() => onChange(theme.id)}
            className={`overflow-hidden rounded-2xl border text-left ${value === theme.id ? 'border-accent' : 'border-line'}`}
          >
            <div data-theme={theme.id} className="space-y-2 bg-canvas p-3 text-ink" aria-hidden="true">
              <div className="flex items-center gap-2">
                <span className="font-semibold">
                  luma<span className="text-accent">.</span>
                </span>
                <span className="ml-auto hidden h-7 w-24 sm:flex items-center rounded-full border border-line bg-surface px-2">
                  <Search className="size-3 text-muted" />
                </span>
              </div>
              <div className="flex gap-2">
                {[0, 1, 2].map(item => (
                  <span key={item} className="flex h-10 flex-1 items-center justify-center rounded-lg bg-surface">
                    <Image className="size-5 text-accent" />
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-12 rounded-full bg-accent" />
                <span className="h-2 w-20 rounded-full bg-line" />
              </div>
            </div>
            <div className="border-t border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{theme.name}</span>
                {value === theme.id && <Check className="size-4 text-accent" aria-hidden="true" />}
              </div>
              <p className="mt-1 hidden text-sm text-muted sm:block">{theme.description}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
