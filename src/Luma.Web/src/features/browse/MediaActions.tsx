import { useId, type ReactNode } from 'react'
import { EllipsisVertical, Heart, HeartCrack, X } from 'lucide-react'
import { IconButton } from '../../components/ui/Controls'

export const actionButton = 'border-transparent bg-canvas/85'

/**
 * The one action row shared by the viewer (photos and videos) and Reels: Like and
 * Dislike beside a menu toggle at the right end, directly above any player bar. The
 * menu opens upward, so every secondary action lives in the same place in every mode.
 * Callers position the row; its contents and order never change.
 */
export function MediaActions({ preference, onPreference, menuOpen, onMenuOpenChange, menuLabel, faded = false, className = '', children }: {
  preference: string; onPreference: (value: 'liked' | 'disliked' | 'neutral') => void
  menuOpen: boolean; onMenuOpenChange: (open: boolean) => void; menuLabel: string; faded?: boolean; className?: string; children: ReactNode
}) {
  const menuId = useId()
  const liked = preference === 'liked'
  const disliked = preference === 'disliked'
  // Faded (an idle slideshow) also stops the row taking clicks, so nothing invisible is hit.
  const interactive = faded ? '' : 'pointer-events-auto'
  return <div data-chrome className={`pointer-events-none absolute right-3 z-10 flex flex-col items-end gap-2 transition-opacity duration-200 sm:right-5 ${faded ? 'opacity-0' : ''} ${className}`}>
    <div id={menuId} className={`motion-drop ${interactive}`} data-open={menuOpen} inert={!menuOpen}>
      {/* Short landscape screens scroll the menu rather than pushing it off the top. */}
      <div className="flex max-h-[calc(100dvh-15rem)] min-h-0 flex-col items-end gap-2 overflow-y-auto overflow-x-hidden pb-0.5 no-scrollbar">{children}</div>
    </div>
    <div className={`flex items-center gap-2 ${interactive}`}>
      <IconButton label="Like" aria-pressed={liked} className={actionButton} onClick={() => onPreference(liked ? 'neutral' : 'liked')}><Heart className={`size-4 ${liked ? 'fill-accent text-accent' : ''}`} /></IconButton>
      {/* The broken heart stays an outline: filled, its crack disappears and it reads as a like. */}
      <IconButton label="Dislike" aria-pressed={disliked} className={actionButton} onClick={() => onPreference(disliked ? 'neutral' : 'disliked')}><HeartCrack className={`size-4 ${disliked ? 'text-danger' : ''}`} /></IconButton>
      <IconButton label={menuOpen ? `Close ${menuLabel.toLowerCase()}` : menuLabel} aria-expanded={menuOpen} aria-controls={menuId} className={actionButton} onClick={() => onMenuOpenChange(!menuOpen)}>{menuOpen ? <X className="size-4" /> : <EllipsisVertical className="size-4" />}</IconButton>
    </div>
  </div>
}
