import { t, stateLabel } from '../../lib/i18n'
import { BookOpen, Info, Star } from 'lucide-react'
import { IconButton } from '../../components/ui/Controls'
import { tagTone } from '../../components/ui/TagTone'
import type { Comic } from './api'

export function ComicCard({ comic, onOpen, onDetails }: { comic: Comic; onOpen: () => void; onDetails?: () => void }) {
  const read =
    comic.state === 'completed'
      ? comic.pageCount
      : comic.state === 'unread'
        ? 0
        : Math.min(comic.pageCount, comic.pageIndex + 1)
  const tags = comic.tags?.slice(0, 2) ?? []
  const extra = Math.max(0, (comic.tagCount ?? comic.tags?.length ?? 0) - tags.length)
  return (
    <article className="relative flex h-full flex-col rounded-xl border border-line bg-surface p-2 text-left">
      <button
        type="button"
        className="block w-full text-left"
        aria-label={t('panels:comicCard.read', { value1: comic.title })}
        onClick={onOpen}
      >
        <div className="aspect-book overflow-hidden rounded-lg bg-canvas">
          {comic.coverUrl ? (
            <img src={comic.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <BookOpen className="mx-auto my-8 size-12 text-muted" aria-hidden="true" />
          )}
        </div>
        <h2 className="mt-2 line-clamp-2 h-10 text-sm font-semibold leading-5" title={comic.title}>
          {comic.title}
        </h2>
        <p className="truncate text-xs text-muted">
          {t('panels:comicCard.pages', { series: comic.format.toUpperCase(), count: comic.pageCount })}
        </p>
      </button>
      {onDetails && (
        <IconButton
          label={t('panels:comicCard.editDetailsFor', { value1: comic.title })}
          tone="overlay"
          className="absolute right-3 top-3"
          onClick={onDetails}
        >
          <Info className="size-5" aria-hidden="true" />
        </IconButton>
      )}
      {comic.favourite && (
        <Star
          className="absolute left-3 top-3 size-5 fill-accent text-accent"
          aria-label={t('panels:comicCard.favourite')}
        />
      )}
      <div
        className="mt-2 flex h-7 min-w-0 items-center gap-1 overflow-hidden"
        aria-label={tags.length ? t('panels:comicCard.tags') : undefined}
      >
        {tags.map(tag => (
          <span
            key={tag.id}
            title={tag.name}
            style={tagTone(tag.name)}
            className="tag-tone min-w-0 max-w-1/2 flex-1 truncate rounded-full border px-2 py-0.5 text-xs"
          >
            {tag.name}
          </span>
        ))}
        {extra > 0 && (
          <span
            className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted"
            aria-label={t('panels:comicCard.moreTags', { count: extra })}
          >
            +{extra}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={t('panels:comicCard.readingProgressFor', { value1: comic.title })}
        aria-valuenow={read}
        aria-valuemin={0}
        aria-valuemax={comic.pageCount}
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${comic.pageCount ? (read / comic.pageCount) * 100 : 0}%` }}
        />
      </div>
      <p className="mt-1 truncate text-xs text-muted">
        {stateLabel(comic.state)} · {read} / {comic.pageCount}
      </p>
    </article>
  )
}
