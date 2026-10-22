import { Trans } from 'react-i18next'
import { t } from '../../lib/i18n'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, LayoutGrid, Crop } from 'lucide-react'
import { SettingsSection } from '../../components/ui/SettingsSection'
import {
  coverLayout,
  foregroundBox,
  setCoverRenderingMode,
  useCoverRenderingMode,
  type CoverImage,
  type CoverRenderingMode,
} from './coverLayout'

// Cards are sized by CSS; until measured, assume a typical wide card.
const assumedAspect = 16 / 9

function useCardSize() {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ aspect: number; width?: number }>({ aspect: assumedAspect })
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width > 0 && height > 0) setSize({ aspect: width / height, width })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [box, size] as const
}

function Picture({ image, className = '', style }: { image: CoverImage; className?: string; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false)
  return (
    <img
      src={image.url}
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      className={`${className} ${failed ? 'invisible' : ''}`}
      style={style}
      onError={() => setFailed(true)}
    />
  )
}

/** A folder or library cover drawn in the person's chosen rendering mode. */
export function AlbumCover({
  images,
  override = false,
  height,
  fallback,
}: {
  images?: readonly CoverImage[] | null
  override?: boolean
  height: string
  fallback: ReactNode
}) {
  const mode = useCoverRenderingMode()
  const [box, { aspect, width }] = useCardSize()
  const layout = coverLayout({ images: images ?? [], override, mode, containerAspect: aspect, containerWidth: width })
  return (
    <div
      ref={box}
      data-cover={layout?.kind === 'mosaic' ? `mosaic-${layout.tiles.length}` : layout?.fit}
      className={`relative overflow-hidden bg-canvas ${height}`}
    >
      {!layout ? (
        fallback
      ) : layout.kind === 'mosaic' ? (
        <div
          className={`grid h-full gap-0.5 ${layout.tiles.length === 3 ? 'grid-cols-[2fr_1fr]' : 'grid-cols-[2fr_1fr_1fr]'} grid-rows-2`}
        >
          {layout.tiles.map((image, index) => (
            <Picture
              key={image.url}
              image={image}
              className={`h-full w-full object-cover ${index === 0 ? 'row-span-2' : ''} ${layout.tiles.length === 4 && index === 3 ? 'col-span-2' : ''}`}
            />
          ))}
        </div>
      ) : layout.fit === 'cover' ? (
        <Picture image={layout.image} className="h-full w-full object-cover" />
      ) : (
        <>
          {/* The same thumbnail, blurred and darkened, fills the card behind the foreground: never a bare letterbox. */}
          <Picture
            image={layout.image}
            className={`absolute inset-0 h-full w-full scale-110 object-cover blur-lg ${layout.fit === 'blurred-foreground' ? 'brightness-50' : 'brightness-75'}`}
          />
          <Picture
            image={layout.image}
            className="absolute max-w-none shadow-lg"
            style={(() => {
              const position = foregroundBox(layout.image.width / layout.image.height, aspect, layout.scale)
              return {
                width: `${position.width}%`,
                height: `${position.height}%`,
                left: `${position.left}%`,
                top: `${position.top}%`,
              }
            })()}
          />
        </>
      )}
    </div>
  )
}

const modes: Array<{ id: CoverRenderingMode; name: string; description: string; icon: ReactNode }> = [
  {
    id: 'smart',
    name: t('browse:albumCover.smartAlbumCovers'),
    icon: <LayoutGrid className="size-5" />,
    description: t('browse:albumCover.albumsWithThreeOrMorePhotosShowAMosaic'),
  },
  {
    id: 'cropped',
    name: t('browse:albumCover.croppedAlbumCovers'),
    icon: <Crop className="size-5" />,
    description: t('browse:albumCover.onePhotoFillsTheWholeCardCroppedToFit'),
  },
]

export function AlbumCoverSettings() {
  const mode = useCoverRenderingMode()
  return (
    <SettingsSection
      title={t('browse:albumCover.albumCovers')}
      description={t('browse:albumCover.chooseHowLumaDrawsAutomaticAlbumAndFolderCovers')}
    >
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('browse:albumCover.albumCoverStyle')}>
        {modes.map(option => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            onClick={() => setCoverRenderingMode(option.id)}
            className={`rounded-2xl border bg-surface p-4 text-left ${mode === option.id ? 'border-accent' : 'border-line'}`}
          >
            <span className="flex items-center gap-2 font-semibold">
              <span className="text-accent">{option.icon}</span>
              {option.name}
              {mode === option.id && <Check className="ml-auto size-4 text-accent" aria-hidden="true" />}
            </span>
            <span className="mt-2 block text-sm leading-relaxed text-muted">{option.description}</span>
          </button>
        ))}
      </div>
      <p className="text-sm leading-relaxed text-muted">
        <Trans i18nKey="browse:albumCover.coverDefaultHelp" components={{ action: <span className="text-ink" /> }} />
      </p>
    </SettingsSection>
  )
}
