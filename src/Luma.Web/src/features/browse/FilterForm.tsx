import { t } from '../../lib/i18n'
import { useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { shuffleSeed } from './shuffleSeed'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { tagTone } from '../../components/ui/TagTone'
import { queryString, request, type Filters, type Tag, type Library } from './api'

// Order-independent: two filter sets are the same when they browse to the same place.
const fingerprint = (value: Filters) =>
  [...new URLSearchParams(queryString(value))]
    .map(([key, item]) => `${key}=${item}`)
    .sort()
    .join('&')

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="pb-2 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  )
}

export function FilterForm({ value, onApply }: { value: Filters; onApply: (filters: Filters) => void }) {
  const [draft, setDraft] = useState<Filters>(value)
  const [tag, setTag] = useState('')
  const recursiveId = useId()
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal),
  })
  const suggestions = useQuery({
    queryKey: ['tags', 'filter', tag],
    queryFn: ({ signal }) => request<Tag[]>(`/api/tags?prefix=${encodeURIComponent(tag)}`, signal),
    enabled: !!tag.trim(),
    gcTime: 0,
  })
  function set(key: keyof Filters, val: string | number | boolean | undefined) {
    setDraft(old => ({ ...old, [key]: val }))
  }
  const number = (key: keyof Filters, label: string, min = 0, step = '1') => (
    <Field key={key} label={label}>
      <Input
        type="number"
        min={min}
        step={step}
        value={String(draft[key] ?? '')}
        onChange={event => set(key, event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </Field>
  )
  const text = (key: keyof Filters, label: string, placeholder?: string) => (
    <Field key={key} label={label}>
      <Input
        maxLength={200}
        placeholder={placeholder}
        value={String(draft[key] ?? '')}
        onChange={event => set(key, event.target.value || undefined)}
      />
    </Field>
  )
  const twoColumns = 'grid grid-cols-1 gap-3 sm:grid-cols-2'
  // Until something changes the buttons sit at the end of the form. The first edit lifts them
  // to the bottom edge, where they stay in reach until the form is scrolled to its end.
  const changed = fingerprint(draft) !== fingerprint(value)
  return (
    <form
      className="flex min-h-0 min-w-0 flex-col"
      onSubmit={event => {
        event.preventDefault()
        onApply(draft)
      }}
    >
      <div className="min-w-0 space-y-6 p-5">
        <FilterSection title={t('browse:filterForm.orderAndGrouping')}>
          <div className={twoColumns}>
            <Field label={t('browse:filterForm.sortBy')}>
              <Select
                value={draft.sort ?? 'modified'}
                onChange={event =>
                  setDraft(old => ({
                    ...old,
                    sort: event.target.value,
                    seed: event.target.value === 'shuffle' ? (old.seed ?? shuffleSeed()) : undefined,
                  }))
                }
              >
                <option value="modified">{t('browse:filterForm.modifiedDate')}</option>
                <option value="captured">{t('browse:filterForm.capturedDate')}</option>
                <option value="name">{t('browse:filterForm.name')}</option>
                <option value="type">{t('browse:filterForm.type')}</option>
                <option value="size">{t('browse:filterForm.size')}</option>
                <option value="shuffle">{t('browse:filterForm.shuffle')}</option>
              </Select>
            </Field>
            <Field label={t('browse:filterForm.sortDirection')}>
              <Select
                value={draft.order ?? 'desc'}
                onChange={event => set('order', event.target.value)}
                disabled={draft.sort === 'shuffle'}
              >
                <option value="desc">{t('browse:filterForm.descending')}</option>
                <option value="asc">{t('browse:filterForm.ascending')}</option>
              </Select>
            </Field>
            <Field label={t('browse:filterForm.groupBy')}>
              <Select value={draft.groupBy ?? 'none'} onChange={event => set('groupBy', event.target.value)}>
                <option value="none">{t('browse:filterForm.noGrouping')}</option>
                <option value="tag">{t('browse:filterForm.tags')}</option>
                <option value="folder">{t('browse:filterForm.folder')}</option>
                <option value="date">{t('browse:filterForm.date')}</option>
                <option value="type">{t('browse:filterForm.type')}</option>
              </Select>
            </Field>
            {draft.sort === 'shuffle' && (
              <QuietButton onClick={() => set('seed', shuffleSeed())}>{t('browse:filterForm.reshuffle')}</QuietButton>
            )}
          </div>
          <p className="mt-2 text-sm text-muted">{t('browse:filterForm.foldersAreSortedByNameAndFollowTheSelected')}</p>
        </FilterSection>
        <FilterSection title={t('browse:filterForm.media')}>
          <div className={twoColumns}>
            <Field label={t('browse:filterForm.mediaType')}>
              <Select
                value={draft.mediaType ?? ''}
                onChange={event => set('mediaType', event.target.value || undefined)}
              >
                <option value="">{t('browse:filterForm.photosAndVideos')}</option>
                <option value="image">{t('browse:filterForm.photos')}</option>
                <option value="video">{t('browse:filterForm.videos')}</option>
                <option value="gif">{t('browse:filterForm.gIFs')}</option>
                <option value="motion">{t('browse:filterForm.videosAndGIFs')}</option>
              </Select>
            </Field>
            <Field label={t('browse:filterForm.orientation')}>
              <Select
                value={draft.orientation ?? ''}
                onChange={event => set('orientation', event.target.value || undefined)}
              >
                <option value="">{t('browse:filterForm.anyOrientation')}</option>
                <option value="landscape">{t('browse:filterForm.landscape')}</option>
                <option value="portrait">{t('browse:filterForm.portrait')}</option>
                <option value="square">{t('browse:filterForm.square')}</option>
              </Select>
            </Field>
            <Field label={t('browse:filterForm.favouriteState')}>
              <Select
                value={draft.preference ?? ''}
                onChange={event => set('preference', event.target.value || undefined)}
              >
                <option value="">{t('browse:filterForm.anyItem')}</option>
                <option value="liked">{t('browse:filterForm.favourites')}</option>
                <option value="disliked">{t('browse:filterForm.hidden')}</option>
                <option value="neutral">{t('browse:filterForm.unrated')}</option>
              </Select>
            </Field>
            <Field label={t('browse:filterForm.availability')}>
              <Select
                value={draft.availability ?? 'present'}
                onChange={event => set('availability', event.target.value)}
              >
                <option value="present">{t('browse:filterForm.present')}</option>
                <option value="missing">{t('browse:filterForm.missing')}</option>
                <option value="all">{t('browse:filterForm.allRecords')}</option>
              </Select>
            </Field>
            <Field label={t('browse:filterForm.tagState')}>
              <Select
                value={draft.tagged === undefined ? '' : String(draft.tagged)}
                onChange={event => set('tagged', event.target.value === '' ? undefined : event.target.value === 'true')}
              >
                <option value="">{t('browse:filterForm.anyItem')}</option>
                <option value="true">{t('browse:filterForm.tagged')}</option>
                <option value="false">{t('browse:filterForm.untagged')}</option>
              </Select>
            </Field>
          </div>
        </FilterSection>
        <FilterSection title={t('browse:filterForm.locationAndName')}>
          {draft.folderId && (
            <p className="text-sm text-muted">
              {t('browse:filterForm.folderScope')}
              {draft.folderId}{' '}
              <QuietButton onClick={() => set('folderId', undefined)}>
                {t('browse:filterForm.clearFolderScope')}
              </QuietButton>
            </p>
          )}
          <div className={twoColumns}>
            <Field label={t('browse:filterForm.library')}>
              <Select
                value={draft.libraryId ?? ''}
                onChange={event =>
                  setDraft(old => ({
                    ...old,
                    libraryId: event.target.value ? Number(event.target.value) : undefined,
                    folderId: undefined,
                  }))
                }
              >
                <option value="">{t('browse:filterForm.allLibraries')}</option>
                {libraries.data?.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            {text('path', t('browse:filterForm.pathContains'))}
            {text('startsWith', t('browse:filterForm.nameStartsWith'))}
            {text('endsWith', t('browse:filterForm.nameEndsWith'))}
            <Field label={t('browse:filterForm.extensions')}>
              <Input
                value={draft.extension?.join(', ') ?? ''}
                placeholder={t('browse:filterForm.extensionsExample')}
                onChange={event =>
                  setDraft(old => ({
                    ...old,
                    extension: event.target.value
                      .split(',')
                      .map(x => x.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </Field>
          </div>
          <label htmlFor={recursiveId} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-muted">
            <Checkbox
              id={recursiveId}
              checked={draft.recursive ?? false}
              onChange={event => set('recursive', event.target.checked)}
            />
            {t('browse:filterForm.includeSubfolders')}
          </label>
        </FilterSection>
        <FilterSection title={t('browse:filterForm.date')}>
          <div className={twoColumns}>
            <Field label={t('browse:filterForm.fromUTC')}>
              <Input
                type="datetime-local"
                value={draft.dateFrom?.slice(0, 16) ?? ''}
                onChange={event => set('dateFrom', event.target.value ? `${event.target.value}:00Z` : undefined)}
              />
            </Field>
            <Field label={t('browse:filterForm.beforeUTC')}>
              <Input
                type="datetime-local"
                value={draft.dateTo?.slice(0, 16) ?? ''}
                onChange={event => set('dateTo', event.target.value ? `${event.target.value}:00Z` : undefined)}
              />
            </Field>
          </div>
        </FilterSection>
        <details className="rounded-2xl bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold">{t('browse:filterForm.sizeAndDimensions')}</summary>
          <div className={`mt-4 ${twoColumns}`}>
            {number('minSizeBytes', t('browse:filterForm.minimumSizeBytes'))}
            {number('maxSizeBytes', t('browse:filterForm.maximumSizeBytes'))}
            {number('minWidth', t('browse:filterForm.minimumWidth'), 1)}
            {number('minHeight', t('browse:filterForm.minimumHeight'), 1)}
            {number('width', t('browse:filterForm.exactWidth'), 1)}
            {number('height', t('browse:filterForm.exactHeight'), 1)}
            {number('minAspectRatio', t('browse:filterForm.minimumAspectRatio'), 0.01, 'any')}
            {number('maxAspectRatio', t('browse:filterForm.maximumAspectRatio'), 0.01, 'any')}
          </div>
        </details>
        <FilterSection title={t('browse:filterForm.tags')}>
          <Field label={t('browse:filterForm.matchTags')}>
            <Select value={draft.tagMode ?? 'all'} onChange={event => set('tagMode', event.target.value)}>
              <option value="all">{t('browse:filterForm.allSelectedTags')}</option>
              <option value="any">{t('browse:filterForm.anySelectedTag')}</option>
            </Select>
          </Field>
          <Field label={t('browse:filterForm.findATag')}>
            <Input
              value={tag}
              onChange={event => setTag(event.target.value)}
              placeholder={t('browse:filterForm.searchExistingTags')}
            />
          </Field>
          {tag && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('browse:filterForm.matchingTags')}>
              {suggestions.data?.map(item => (
                <li key={item.id}>
                  <QuietButton
                    className="tag-tone min-h-9"
                    style={tagTone(item.name)}
                    onClick={() => {
                      setDraft(old => ({
                        ...old,
                        tagged: undefined,
                        tag: [...new Set([...(old.tag ?? []), item.name])],
                      }))
                      setTag('')
                    }}
                  >
                    {item.name}
                  </QuietButton>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {draft.tag?.map(name => (
              <QuietButton
                key={name}
                className="tag-tone min-h-9"
                style={tagTone(name)}
                aria-label={t('browse:filterForm.removeFilterTag', { value1: name })}
                onClick={() => setDraft(old => ({ ...old, tag: old.tag?.filter(x => x !== name) }))}
              >
                {name} ×
              </QuietButton>
            ))}
          </div>
        </FilterSection>
      </div>
      <div
        data-testid="filter-actions"
        className={`flex shrink-0 gap-3 border-t border-line bg-canvas px-5 py-4 ${changed ? 'motion-rise sticky bottom-0 z-10 shadow-lg' : ''}`}
      >
        <Button type="submit">{t('browse:filterForm.applyFilters')}</Button>
        <QuietButton onClick={() => onApply({})}>{t('browse:filterForm.resetFilters')}</QuietButton>
      </div>
    </form>
  )
}
