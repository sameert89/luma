import { BookOpen, Info, Star } from 'lucide-react'
import { QuietButton } from '../../components/ui/Controls'
import type { Comic } from './api'

export function ComicCard({ comic, onOpen, onDetails }: { comic: Comic; onOpen: () => void; onDetails?: () => void }) {
  const read = comic.state === 'unread' ? 0 : comic.pageIndex + 1
  return (
    <article className="rounded-xl border border-line bg-surface p-3 text-left">
      <button type="button" className="w-full text-left" aria-label={`Read ${comic.title}`} onClick={onOpen}>
        <div className="aspect-book overflow-hidden rounded-lg bg-canvas">
          {comic.coverUrl ? (
            <img src={comic.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <BookOpen className="mx-auto my-8 size-12 text-muted" aria-hidden="true" />
          )}
        </div>
        <h2 className="mt-2 truncate font-semibold">{comic.title}</h2>
        {comic.favourite && <Star className="size-4 text-accent" aria-label="Favourite" />}
        <p className="truncate text-sm text-muted">
          {comic.series || comic.format.toUpperCase()} · {comic.pageCount} pages
        </p>
        <progress
          aria-label={`Reading progress for ${comic.title}`}
          className="mt-2 block h-1.5 w-full accent-accent"
          value={read}
          max={comic.pageCount}
        />
        <p className="mt-1 text-xs text-muted">
          {comic.state} · {read} / {comic.pageCount}
        </p>
      </button>
      {onDetails && (
        <QuietButton className="mt-2" onClick={onDetails} aria-label={`Edit details for ${comic.title}`}>
          <Info className="size-4" aria-hidden="true" />
          Details
        </QuietButton>
      )}
    </article>
  )
}
