import { t } from '../../lib/i18n'
import { Field, Select } from '../../components/ui/Controls'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { setReelsSort, useReelsSort, type ReelsSortChoice } from './reelsSort'

const options: { id: ReelsSortChoice; name: string }[] = [
  { id: 'library', name: t('browse:reelsSortSettings.sameAsTheLibrary') },
  { id: 'modified', name: t('browse:reelsSortSettings.modifiedDate') },
  { id: 'captured', name: t('browse:reelsSortSettings.capturedDate') },
  { id: 'name', name: t('browse:reelsSortSettings.name') },
  { id: 'type', name: t('browse:reelsSortSettings.type') },
  { id: 'size', name: t('browse:reelsSortSettings.size') },
  { id: 'shuffle', name: t('browse:reelsSortSettings.shuffle') },
]

export function ReelsSortSettings() {
  const value = useReelsSort()
  // Direction means nothing for a shuffle, or when the library's own order is kept.
  const directed = value.sort !== 'library' && value.sort !== 'shuffle'
  return (
    <SettingsSection
      title={t('browse:reelsSortSettings.reels')}
      description={t('browse:reelsSortSettings.chooseTheOrderReelsOpensInOnThisDevice')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('browse:reelsSortSettings.defaultOrder')}>
          <Select
            value={value.sort}
            onChange={event => setReelsSort({ ...value, sort: event.target.value as ReelsSortChoice })}
          >
            {options.map(option => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('browse:reelsSortSettings.defaultDirection')}>
          <Select
            value={value.order}
            disabled={!directed}
            onChange={event => setReelsSort({ ...value, order: event.target.value === 'asc' ? 'asc' : 'desc' })}
          >
            <option value="desc">{t('browse:reelsSortSettings.descending')}</option>
            <option value="asc">{t('browse:reelsSortSettings.ascending')}</option>
          </Select>
        </Field>
      </div>
      <p className="text-sm leading-relaxed text-muted">
        {t('browse:reelsSortSettings.appliesEachTimeYouOpenReelsYouCanStill')}
      </p>
    </SettingsSection>
  )
}
