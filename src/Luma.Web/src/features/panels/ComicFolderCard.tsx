import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { AlbumCover } from '../browse/AlbumCover'

export function ComicFolderCard({
  name,
  covers = [],
  onOpen,
}: {
  name: string
  covers?: readonly string[] | null
  onOpen: () => void
}) {
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  return (
    <article className="relative w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface hover:border-accent">
      <button
        type="button"
        aria-label={`Open ${name}`}
        title={name}
        className="relative block w-full text-left focus-visible:ring-inset"
        onClick={onOpen}
        onLoadCapture={event => {
          const image = event.target
          if (!(image instanceof HTMLImageElement) || !image.naturalWidth) return
          const url = image.getAttribute('src')!
          setSizes(previous =>
            previous[url]?.width === image.naturalWidth && previous[url]?.height === image.naturalHeight
              ? previous
              : {
                  ...Object.fromEntries(Object.entries(previous).filter(([key]) => covers?.includes(key))),
                  [url]: { width: image.naturalWidth, height: image.naturalHeight },
                },
          )
        }}
      >
        <AlbumCover
          images={(covers ?? []).map(url => ({ url, ...(sizes[url] ?? { width: 2, height: 3 }) }))}
          height="h-32 sm:h-36"
          fallback={
            <div className="flex h-full items-center justify-center pb-6 text-muted">
              <FolderOpen className="size-8 sm:size-10" />
            </div>
          }
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-black/85 via-black/50 to-transparent px-3 pt-8 pb-2.5 text-white"
        >
          <FolderOpen className="size-3.5 shrink-0 opacity-80" />
          <span className="truncate text-sm font-semibold">{name}</span>
        </span>
      </button>
    </article>
  )
}
