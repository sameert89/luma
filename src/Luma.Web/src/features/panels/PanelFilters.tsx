import { useId, useState } from 'react'
import { t } from '../../lib/i18n'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, QuietButton, Select } from '../../components/ui/Controls'

export type PanelFilterValue = {
  sort: 'title' | 'added' | 'modified'
  order: 'asc' | 'desc'
  state: string
  series: string
  tag: string
  favourite: boolean
}

export function PanelFilters({
  value,
  onApply,
}: {
  value: PanelFilterValue
  onApply: (value: PanelFilterValue) => void
}) {
  const [draft, setDraft] = useState(value)
  const favouritesId = useId()
  const changed = JSON.stringify(draft) !== JSON.stringify(value)
  return (
    <form
      className="flex min-h-0 min-w-0 flex-col"
      onSubmit={event => {
        event.preventDefault()
        onApply(draft)
      }}
    >
      <div className="min-w-0 space-y-6 p-5">
        <fieldset className="space-y-3">
          <legend className="pb-2 text-sm font-semibold text-ink">{t('panels:panels.order')}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('panels:panels.sortBy')}>
              <Select
                value={draft.sort}
                onChange={event => setDraft({ ...draft, sort: event.target.value as PanelFilterValue['sort'] })}
              >
                <option value="title">{t('panels:panels.title')}</option>
                <option value="added">{t('panels:panels.dateAdded')}</option>
                <option value="modified">{t('panels:panels.modifiedDate')}</option>
              </Select>
            </Field>
            <Field label={t('panels:panels.sortDirection')}>
              <Select
                value={draft.order}
                onChange={event => setDraft({ ...draft, order: event.target.value as PanelFilterValue['order'] })}
              >
                <option value="asc">{t('panels:panels.ascending')}</option>
                <option value="desc">{t('panels:panels.descending')}</option>
              </Select>
            </Field>
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="pb-2 text-sm font-semibold text-ink">{t('panels:panels.filterComics')}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('panels:panels.readingStatus')}>
              <Select value={draft.state} onChange={event => setDraft({ ...draft, state: event.target.value })}>
                <option value="">{t('panels:panels.allComics')}</option>
                <option value="reading">{t('panels:panels.continueReading')}</option>
                <option value="unread">{t('panels:panels.unread')}</option>
                <option value="completed">{t('panels:panels.completed')}</option>
              </Select>
            </Field>
            <Field label={t('panels:panels.series')}>
              <Input
                value={draft.series}
                aria-label={t('panels:panels.seriesFilter')}
                placeholder={t('panels:panels.series')}
                onChange={event => setDraft({ ...draft, series: event.target.value })}
              />
            </Field>
            <Field label={t('panels:panels.comicTag')}>
              <Input
                value={draft.tag}
                aria-label={t('panels:panels.comicTagFilter')}
                placeholder={t('panels:panels.comicTag')}
                onChange={event => setDraft({ ...draft, tag: event.target.value })}
              />
            </Field>
          </div>
          <label htmlFor={favouritesId} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={favouritesId}
              checked={draft.favourite}
              onChange={event => setDraft({ ...draft, favourite: event.target.checked })}
            />
            {t('panels:panels.favouritesOnly')}
          </label>
        </fieldset>
      </div>
      <div
        className={`flex shrink-0 gap-3 border-t border-line bg-canvas px-5 py-4 ${changed ? 'motion-rise sticky bottom-0 z-10 shadow-lg' : ''}`}
      >
        <Button type="submit">{t('browse:filterForm.applyFilters')}</Button>
        <QuietButton
          onClick={() => onApply({ sort: 'title', order: 'asc', state: '', series: '', tag: '', favourite: false })}
        >
          {t('browse:filterForm.resetFilters')}
        </QuietButton>
      </div>
    </form>
  )
}
