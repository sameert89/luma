import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, type MouseEvent } from 'react'
import { QuietButton } from '../../components/ui/Controls'
import { gestures, guideSections, shortcutGroups, type GuideEntry } from './guide'

const gesturesSection = {
  id: 'gestures',
  title: 'Gestures and keyboard shortcuts',
  summary: 'Touch, mouse and keyboard interactions without a button',
}
const index = [...guideSections, gesturesSection]

// Entries document controls rather than duplicate them: the visual is decorative and the
// readable name beside it carries the meaning.
function ControlVisual({ entry }: { entry: GuideEntry }) {
  if (entry.icons)
    return (
      <span className="flex gap-1" aria-hidden="true">
        {entry.icons.map((Icon, index) => (
          <span
            key={index}
            className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-canvas text-ink"
          >
            <Icon className="size-4" />
          </span>
        ))}
      </span>
    )
  if (entry.progressBar)
    return (
      <span className="relative block h-10 w-16 overflow-hidden rounded-md bg-canvas" aria-hidden="true">
        <span className="absolute bottom-0 left-0 h-1 w-3/5 bg-accent" />
      </span>
    )
  return (
    <span
      className="inline-flex min-h-10 max-w-full items-center rounded-full border border-line bg-canvas px-3 text-sm font-medium text-ink"
      aria-hidden="true"
    >
      {entry.label}
    </span>
  )
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <span key={key} className="flex items-center gap-1">
          {index > 0 && <span className="text-xs text-muted">or</span>}
          <kbd className="inline-flex min-w-7 justify-center rounded-md border border-line bg-canvas px-1.5 py-0.5 text-xs font-semibold text-ink">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  )
}

export function Help({ onBack }: { onBack: () => void }) {
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    title.current?.focus({ preventScroll: true })
  }, [])
  // Section links scroll within Help's own scroller and move focus, without adding hash
  // entries to the history that Back relies on.
  function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault()
    const heading = document.getElementById(`help-${id}`)
    heading?.scrollIntoView?.({ block: 'start' })
    heading?.focus({ preventScroll: true })
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="help-scroll" data-scroll-restore>
      <div className="sticky top-0 z-10 border-b border-line bg-canvas px-5 py-3">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <QuietButton onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </QuietButton>
        </div>
      </div>
      <div className="mx-auto w-full max-w-5xl space-y-10 p-5">
        <header>
          <h1 ref={title} tabIndex={-1} className="text-2xl font-semibold">
            Help
          </h1>
          <p className="mt-2 text-sm text-muted">
            What each button, gesture and shortcut does, grouped by where it appears.
          </p>
        </header>
        <nav aria-label="Help sections">
          <ul className="grid gap-2 sm:grid-cols-2">
            {index.map(section => (
              <li key={section.id}>
                <a
                  href={`#help-${section.id}`}
                  onClick={event => jump(event, section.id)}
                  className="block h-full rounded-2xl border border-line bg-surface p-3 hover:border-accent"
                >
                  <span className="block text-sm font-semibold">{section.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">{section.summary}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {guideSections.map(section => (
          <section key={section.id} aria-labelledby={`help-${section.id}`} className="space-y-5">
            <h2 id={`help-${section.id}`} tabIndex={-1} className="scroll-mt-20 text-2xl font-semibold">
              {section.title}
            </h2>
            {section.groups.map(group => (
              <div key={group.title} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{group.title}</h3>
                <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                  {group.entries.map(entry => (
                    <li key={entry.name} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4">
                      <div className="shrink-0 sm:w-44">
                        <ControlVisual entry={entry} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{entry.name}</p>
                        <p className="text-xs text-muted">{entry.where}</p>
                        <p className="mt-1 text-sm leading-relaxed">{entry.what}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {section.notes && (
              <div className="rounded-2xl border border-line p-4">
                <h3 className="text-sm font-semibold">Good to know</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
                  {section.notes.map(note => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
        <section aria-labelledby="help-gestures" className="space-y-5">
          <h2 id="help-gestures" tabIndex={-1} className="scroll-mt-20 text-2xl font-semibold">
            {gesturesSection.title}
          </h2>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Touch and mouse</h3>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {gestures.map(item => (
                <li key={`${item.gesture}:${item.where}`} className="p-3">
                  <p className="text-sm font-semibold">{item.gesture}</p>
                  <p className="text-xs text-muted">{item.where}</p>
                  <p className="mt-1 text-sm leading-relaxed">{item.result}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Keyboard</h3>
            <p className="text-sm text-muted">Shortcuts pause while you type in a field.</p>
            <div className="grid gap-4 lg:grid-cols-3">
              {shortcutGroups.map(group => (
                <div key={group.title} className="rounded-2xl border border-line bg-surface p-3">
                  <h4 className="text-sm font-semibold">{group.title}</h4>
                  <dl className="mt-2 space-y-2">
                    {group.shortcuts.map(shortcut => (
                      <div key={shortcut.result} className="flex items-start justify-between gap-3">
                        <dt className="shrink-0">
                          <Keys keys={shortcut.keys} />
                        </dt>
                        <dd className="text-right text-sm">{shortcut.result}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
