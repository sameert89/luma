import { useId, type ReactNode } from 'react'

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="mx-auto w-full max-w-5xl space-y-4 p-5">
      <div>
        <h2 id={titleId} className="text-2xl font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}
