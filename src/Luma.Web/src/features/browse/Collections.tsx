import { t } from '../../lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { EllipsisVertical, Heart, Tag } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Field, IconButton, Input, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { tagTone } from '../../components/ui/TagTone'
import { errorMessage, request, type Filters } from './api'
import type { components } from '../../lib/api/generated'

type TagSummary = components['schemas']['TagSummary']

// A long press is a shortcut for the same action the manage button reaches, so
// keyboard and pointer users always have a way in without relying on the gesture.
const longPressMs = 500

function TagManager({ tag, onClose }: { tag: TagSummary; onClose: () => void }) {
  const [name, setName] = useState(tag.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const client = useQueryClient()
  function invalidated<T>(result: T) {
    for (const queryKey of [['collection-tags'], ['tags'], ['media'], ['detail']])
      void client.invalidateQueries({ queryKey })
    onClose()
    return result
  }
  const rename = useMutation({
    mutationFn: () => request<TagSummary>(`/api/tags/${tag.id}`, undefined, 'PUT', { name }),
    onSuccess: invalidated,
  })
  const remove = useMutation({
    mutationFn: () => request(`/api/tags/${tag.id}`, undefined, 'DELETE'),
    onSuccess: invalidated,
  })
  const trimmed = name.trim()
  return (
    <Modal
      open
      onOpenChange={value => {
        if (!value) onClose()
      }}
      title={t('browse:collections.manage', { value1: tag.name })}
      description={t('browse:collections.renameOrRemoveThisTag')}
      sheet
    >
      <form
        className="space-y-4 p-5"
        onSubmit={event => {
          event.preventDefault()
          if (trimmed && trimmed !== tag.name) rename.mutate()
        }}
      >
        <Field label={t('browse:collections.tagName')}>
          <Input value={name} maxLength={200} onChange={event => setName(event.target.value)} />
        </Field>
        <p className="text-xs text-muted">{t('browse:collections.renamingToAnotherTagSSpellingMergesTheTwo')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={rename.isPending || !trimmed || trimmed === tag.name}>
            {rename.isPending ? t('browse:collections.saving') : t('browse:collections.saveName')}
          </Button>
          {confirmingDelete ? (
            <>
              <span className="text-sm text-danger">{t('browse:collections.removeFromEveryItem')}</span>
              <QuietButton
                className="border-danger text-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? t('browse:collections.removing') : t('browse:collections.confirm')}
              </QuietButton>
              <QuietButton onClick={() => setConfirmingDelete(false)}>{t('browse:collections.cancel')}</QuietButton>
            </>
          ) : (
            <QuietButton className="text-danger" onClick={() => setConfirmingDelete(true)}>
              {t('browse:collections.deleteTag')}
            </QuietButton>
          )}
        </div>
        {(rename.isError || remove.isError) && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(rename.error ?? remove.error)}
          </p>
        )}
      </form>
    </Modal>
  )
}

function TagChip({ tag, onChoose, onManage }: { tag: TagSummary; onChoose: () => void; onManage: () => void }) {
  const pressTimer = useRef(0)
  const pressed = useRef(false)
  function startPress() {
    pressed.current = false
    pressTimer.current = window.setTimeout(() => {
      pressed.current = true
      onManage()
    }, longPressMs)
  }
  function cancelPress() {
    window.clearTimeout(pressTimer.current)
  }
  const tone = tagTone(tag.name)
  return (
    <div className="flex items-center gap-1">
      <QuietButton
        className="tag-tone"
        style={tone}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onClick={() => {
          if (!pressed.current) onChoose()
        }}
      >
        <Tag className="size-4" />
        {tag.name}
      </QuietButton>
      <IconButton
        label={t('browse:collections.manageTag', { value1: tag.name })}
        className="tag-tone"
        style={tone}
        onClick={onManage}
      >
        <EllipsisVertical className="size-4" />
      </IconButton>
    </div>
  )
}

export function Collections({ onChoose }: { onChoose: (filters: Filters) => void }) {
  const [cursor, setCursor] = useState<string>()
  const [managing, setManaging] = useState<TagSummary | null>(null)
  const tags = useQuery({
    queryKey: ['collection-tags', cursor],
    queryFn: ({ signal }) =>
      request<components['schemas']['CollectionTagPage']>(
        `/api/collections/tags${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        signal,
      ),
    gcTime: 0,
  })
  return (
    <div className="space-y-6 overflow-auto p-5" data-scroll-restore>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('browse:collections.favourites')}</h2>
        <QuietButton onClick={() => onChoose({ preference: 'liked' })}>
          <Heart className="size-4" />
          {t('browse:collections.openFavourites')}
        </QuietButton>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('browse:collections.tags')}</h2>
        {tags.isPending && <p role="status">{t('browse:collections.loadingTags')}</p>}
        {tags.isError && (
          <p role="alert" className="text-danger">
            {errorMessage(tags.error)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {tags.data?.items.map(tag => (
            <TagChip
              key={tag.id}
              tag={tag}
              onChoose={() => onChoose({ tag: [tag.name] })}
              onManage={() => setManaging(tag)}
            />
          ))}
        </div>
        {tags.data?.items.length === 0 && (
          <p className="text-sm text-muted">{t('browse:collections.noTagsYetAddThemFromAMediaViewer')}</p>
        )}
        <nav aria-label={t('browse:collections.tagPages')} className="flex gap-3">
          <QuietButton
            disabled={!tags.data?.previousCursor}
            onClick={() => setCursor(tags.data?.previousCursor ?? undefined)}
          >
            {t('browse:collections.previousTags')}
          </QuietButton>
          <QuietButton disabled={!tags.data?.nextCursor} onClick={() => setCursor(tags.data?.nextCursor ?? undefined)}>
            {t('browse:collections.nextTags')}
          </QuietButton>
        </nav>
      </section>
      {managing && <TagManager tag={managing} onClose={() => setManaging(null)} />}
    </div>
  )
}
