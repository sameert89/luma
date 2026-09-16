import { Check, Image, Search } from 'lucide-react'

export type Theme = 'obsidian' | 'light' | 'catppuccin' | 'crimson' | 'ember' | 'cinema' | 'midnight' | 'oled' | 'forest'
export const themes: Array<{ id: Theme; name: string; description: string }> = [
  { id: 'obsidian', name: 'Dark', description: 'Soft dark surfaces and lavender accents' },
  { id: 'light', name: 'White', description: 'Bright white surfaces and clear blue accents' },
  { id: 'catppuccin', name: 'Catppuccin', description: 'Muted midnight tones and pastel mauve' },
  { id: 'ember', name: 'Orange & black', description: 'Deep black with vivid orange accents' },
  { id: 'crimson', name: 'Red & white', description: 'Light white surfaces with rich red accents' },
  { id: 'cinema', name: 'Cinema red', description: 'Netflix-inspired charcoal with vivid red accents' },
  { id: 'midnight', name: 'Midnight blue', description: 'Prime Video-inspired navy with bright blue accents' },
  { id: 'oled', name: 'OLED black', description: 'Pure black, quiet gray surfaces and crisp white accents' },
  { id: 'forest', name: 'Forest', description: 'Media-player charcoal with fresh green accents' },
]
export function ThemePicker({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  return <section className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-6 overflow-auto p-4 sm:p-6" aria-label="Theme settings">
    <div><h1 className="text-2xl font-semibold">Theme & appearance</h1><p className="mt-2 text-sm text-muted">Choose how Luma looks on this device.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">{themes.map(theme => <button key={theme.id} type="button" aria-pressed={value === theme.id} aria-label={theme.name} onClick={() => onChange(theme.id)} className={`overflow-hidden rounded-2xl border text-left ${value === theme.id ? 'border-accent' : 'border-line'}`}>
      <div data-theme={theme.id} className="space-y-3 bg-canvas p-4 text-ink" aria-hidden="true">
        <div className="flex items-center gap-2"><span className="font-semibold">luma<span className="text-accent">.</span></span><span className="ml-auto flex h-7 w-24 items-center rounded-full border border-line bg-surface px-2"><Search className="size-3 text-muted" /></span></div>
        <div className="flex gap-2">{[0, 1, 2].map(item => <span key={item} className="flex h-16 flex-1 items-center justify-center rounded-lg bg-surface"><Image className="size-5 text-accent" /></span>)}</div>
        <div className="flex items-center gap-2"><span className="h-2 w-12 rounded-full bg-accent" /><span className="h-2 w-20 rounded-full bg-line" /></div>
      </div>
      <div className="border-t border-line bg-surface p-4"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{theme.name}</span>{value === theme.id && <Check className="size-4 text-accent" aria-hidden="true" />}</div><p className="mt-1 text-sm text-muted">{theme.description}</p></div>
    </button>)}</div>
  </section>
}
