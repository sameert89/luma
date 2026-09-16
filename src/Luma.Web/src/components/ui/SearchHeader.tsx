import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton, Input } from './Controls'

export function SearchHeader({ value, onChange, onSearch, onHome, onFilters, searchRequested }: { value: string; onChange: (value: string) => void; onSearch: () => void; onHome: () => void; onFilters: () => void; searchRequested: boolean }) {
  const [open, setOpen] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 639px)').matches ?? false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (searchRequested && mobile) { setOpen(true); requestAnimationFrame(() => input.current?.focus()) } }, [searchRequested, mobile])
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 639px)')
    if (!query) return
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  function toggle() { setOpen(!open); if (!open) requestAnimationFrame(() => input.current?.focus()) }
  return <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
    <a href="/" className={`shrink-0 text-xl font-semibold tracking-tight ${mobile && open ? 'hidden' : ''}`} aria-label="Luma home" onClick={event => { event.preventDefault(); onHome() }}>luma<span className="text-accent">.</span></a>
    <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
      <form role="search" className="search-reveal max-w-xl" data-open={open || !mobile} inert={mobile && !open} onSubmit={event => { event.preventDefault(); onSearch() }}>
        <div className="min-w-0 overflow-hidden"><Input ref={input} shape="pill" className="focus-visible:ring-inset" aria-label="Search media" placeholder="Search photos, videos and tags" value={value} maxLength={200} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && mobile) { setOpen(false); event.currentTarget.closest('form')?.parentElement?.querySelector<HTMLButtonElement>('button:not([type="submit"])')?.focus() } }} /><button type="submit" className="sr-only" tabIndex={-1}>Submit search</button></div>
      </form>
      <IconButton label={mobile ? open ? 'Close search' : 'Open search' : 'Search'} aria-expanded={mobile ? open : undefined} onClick={mobile ? toggle : onSearch}>{mobile && open ? <X className="size-5" /> : <Search className="size-5" />}</IconButton>
      <IconButton label="Filters" onClick={onFilters}><SlidersHorizontal className="size-5" /></IconButton>
    </div>
  </header>
}
