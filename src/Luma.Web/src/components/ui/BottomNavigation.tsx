import type { LucideIcon } from 'lucide-react'

export type NavigationItem = { id: string; label: string; icon: LucideIcon }

export function BottomNavigation({
  items,
  active,
  onChange,
}: {
  items: NavigationItem[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <nav
      aria-label="Primary navigation"
      className="relative z-30 flex shrink-0 border-t border-line bg-canvas px-2 pb-safe-2 pt-2 md:hidden"
    >
      {items.map(item => {
        const Icon = item.icon
        const selected = item.id === active
        return (
          <button
            key={item.id}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onChange(item.id)}
            className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium ${selected ? 'bg-surface text-accent' : 'text-muted hover:text-ink'}`}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
