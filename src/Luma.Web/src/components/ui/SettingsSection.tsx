import type { ReactNode } from 'react'

export function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="mx-auto w-full max-w-5xl space-y-4 p-5"><div><h2 className="text-2xl font-semibold">{title}</h2><p className="mt-2 text-sm text-muted">{description}</p></div>{children}</section>
}
