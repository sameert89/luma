import type { components } from '../../lib/api/generated'
import { BookOpen, Clapperboard, Images } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { QuietButton } from '../../components/ui/Controls'
export type Experience = 'gallery' | 'flick' | 'panels'
const experiences = [
  { id: 'gallery' as const, name: 'Gallery', icon: Images, description: 'Photos, videos and library management' },
  { id: 'flick' as const, name: 'Flick', icon: Clapperboard, description: 'Immersive motion feed' },
  { id: 'panels' as const, name: 'Panels', icon: BookOpen, description: 'Comics and manga' },
]
export function AppSwitcher({
  active,
  onSelect,
  applications,
}: {
  active: Experience
  onSelect: (value: Experience) => void
  applications?: components['schemas']['ApplicationFlags']
}) {
  const [open, setOpen] = useState(false)
  const current = experiences.find(item => item.id === active)!
  const name = current.name
  const Icon = current.icon
  return (
    <>
      <button
        type="button"
        className="relative inline-flex min-h-11 shrink-0 items-center rounded-xl pl-1 pr-5 text-sm font-semibold"
        aria-label={`Switch application, ${name}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="text-xl tracking-tight">
          luma<span className="text-accent">.</span>
        </span>
        <Icon className="absolute right-0 top-1 size-3.5 text-accent" aria-hidden="true" />
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Luma applications"
        description="One library, three media experiences."
        sheet
      >
        <div className="space-y-2 p-5">
          {experiences
            .filter(
              item =>
                item.id === 'gallery' ||
                (item.id === 'flick' ? applications?.flickEnabled !== false : applications?.panelsEnabled !== false),
            )
            .map(item => {
              const Icon = item.icon
              return (
                <QuietButton
                  key={item.id}
                  aria-label={item.name}
                  aria-current={active === item.id ? 'page' : undefined}
                  className={`w-full justify-start rounded-xl ${active === item.id ? 'bg-surface text-accent' : ''}`}
                  onClick={() => {
                    onSelect(item.id)
                    setOpen(false)
                  }}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  <span className="text-left">
                    <span className="block">{item.name}</span>
                    <span className="block whitespace-normal text-xs font-normal text-muted">{item.description}</span>
                  </span>
                </QuietButton>
              )
            })}
        </div>
      </Modal>
    </>
  )
}
