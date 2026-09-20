import { useQuery } from '@tanstack/react-query'
import { CircleFadingArrowUp, RefreshCw, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { getStatus } from '../../lib/api/client'
import { currentRelease, releases } from '../help/changelog'
import packageJson from '../../../package.json'

/** The release this tab is running; the server reports its own from /api/status. */
export const appVersion = packageJson.version
const seenKey = 'luma-version-seen'
const offeredKey = 'luma-update-offered'

/**
 * A self-hosted update is finished when the server restarts on the new build; a tab opened
 * before that keeps running the old one until it reloads. Comparing the two releases is all
 * the signal needed, and works the same whether Luma was updated by hand or by a container pull.
 */
export function useServerRelease() {
  const status = useQuery({ queryKey: ['status'], queryFn: ({ signal }) => getStatus(signal), staleTime: 60_000, refetchInterval: 300_000, retry: false })
  const serverVersion = status.data?.version
  return { serverVersion, updateAvailable: !!serverVersion && serverVersion !== appVersion }
}

function update() { window.location.reload() }

/**
 * Offers the update once per server release, quietly and out of the way. Closing it keeps the
 * offer in Settings, so the choice to stay on this version lasts until the person asks for it.
 */
export function UpdateNotice() {
  const { serverVersion, updateAvailable } = useServerRelease()
  const [offered, setOffered] = useState(() => localStorage.getItem(offeredKey))
  if (!updateAvailable || offered === serverVersion) return null
  function dismiss() { localStorage.setItem(offeredKey, serverVersion!); setOffered(serverVersion!) }
  return <div role="status" className="fixed inset-x-4 bottom-20 z-40 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg sm:inset-x-auto sm:right-6 sm:max-w-sm md:bottom-6">
    <CircleFadingArrowUp className="size-5 shrink-0 text-accent" aria-hidden="true" />
    <p className="min-w-0 flex-1 text-sm leading-relaxed">Luma {serverVersion} is ready. Refresh to update.</p>
    <Button className="min-h-10 shrink-0 px-3" onClick={() => { dismiss(); update() }}>Refresh</Button>
    <IconButton label="Not now" onClick={dismiss}><X className="size-4" /></IconButton>
  </div>
}

/** Settings' first section: the release this tab runs, and the update when the server has a newer one. */
export function UpdateSettings({ onWhatsNew }: { onWhatsNew: () => void }) {
  const { serverVersion, updateAvailable } = useServerRelease()
  return <SettingsSection title="Updates" description="Which release this device is running, and whether the server has a newer one.">
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${updateAvailable ? 'border-accent bg-surface' : 'border-line'}`}>
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${updateAvailable ? 'bg-accent' : 'bg-positive'}`} />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">{updateAvailable
        ? <>Luma <span className="font-semibold">{serverVersion}</span> is installed on the server. Refresh to start using it; nothing is lost.</>
        : <>Luma <span className="font-semibold">v{appVersion}</span> is up to date.</>}</p>
      {updateAvailable && <Button className="min-h-10 shrink-0" onClick={update}><RefreshCw className="mr-2 size-4" aria-hidden="true" />Refresh to update</Button>}
      <QuietButton className="shrink-0" onClick={onWhatsNew}><Sparkles className="size-4" aria-hidden="true" />What’s new</QuietButton>
    </div>
  </SettingsSection>
}

/**
 * True once per release: the version a tab loads is recorded as seen, so What's new opens by
 * itself right after an update and never again for that release.
 */
export function unseenRelease() {
  if (localStorage.getItem(seenKey) === appVersion) return false
  localStorage.setItem(seenKey, appVersion)
  return true
}

export function WhatsNew({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Modal open={open} onOpenChange={onOpenChange} title={`What’s new in Luma v${currentRelease.version}`} description="Changes in this release." sheet>
    <div className="space-y-6 p-5">
      {releases.map(release => <section key={release.version} className="space-y-3" aria-label={`Luma v${release.version}`}>
        <div>
          <h3 className="font-semibold">{release.headline}</h3>
          <p className="mt-1 text-sm text-muted">v{release.version} · {release.date}</p>
        </div>
        <ul className="space-y-2 text-sm leading-relaxed">
          {release.changes.map(change => <li key={change} className="flex gap-2"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />{change}</li>)}
        </ul>
      </section>)}
      <Button onClick={() => onOpenChange(false)}>Continue</Button>
    </div>
  </Modal>
}
