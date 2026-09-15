import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { ConnectionStatus } from '../features/status/ConnectionStatus'

export function App() {
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:p-3 focus:text-on-accent">Skip to content</a>
      <header className="border-b border-line px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <a href="/" aria-label="Luma home" className="text-2xl font-semibold tracking-tight">luma<span className="text-accent" aria-hidden="true">.</span></a>
          <Dialog trigger={<Button>About Luma</Button>} title="Your media, at home" description="Luma is a private photo and video browser for your existing collection. Your original files stay yours.">
            <p className="mt-4 text-sm leading-relaxed text-muted">This first version establishes the app. Library indexing and browsing are coming next.</p>
          </Dialog>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">Your library</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A home for your memories.</h1>
        <p className="mt-4 max-w-xl leading-relaxed text-muted">Photos, videos, and the moments in between. Browse your collection from one quiet place.</p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <section aria-labelledby="library-heading" className="rounded-lg border border-line p-8 md:col-span-2">
            <svg aria-hidden="true" className="size-12 text-accent" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="8" width="38" height="32" rx="3" /><circle cx="16" cy="19" r="4" /><path d="m6 34 12-10 9 8 7-6 8 8" /></svg>
            <h2 id="library-heading" className="mt-6 text-xl font-semibold">Your collection starts here</h2>
            <p className="mt-3 max-w-md leading-relaxed text-muted">Library setup is coming next. Once it’s available, you’ll be able to connect your folders and browse your photos and videos here.</p>
          </section>
          <aside><ConnectionStatus /></aside>
        </div>
      </main>
      <footer className="mx-auto max-w-6xl px-5 pb-8 text-sm text-muted sm:px-8">Self-hosted. Made for your collection.</footer>
    </div>
  )
}
