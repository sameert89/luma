import { t } from '../../lib/i18n'
import { useState } from 'react'
import { Shuffle } from 'lucide-react'
import { QuietButton, QuietLink, Input, Field, Select } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { queryString, type Filters } from './api'
export function RandomUrls({ filters }: { filters: Filters }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('image')
  const [copied, setCopied] = useState(false)
  const url = new URL(
    `/api/random?${queryString({ ...filters, mediaType: type, groupBy: undefined, sort: undefined, order: undefined, seed: undefined, limit: undefined, cursor: undefined })}`,
    window.location.href,
  ).href
  return (
    <>
      <QuietButton
        onClick={() => {
          setCopied(false)
          setOpen(true)
        }}
      >
        <Shuffle className="size-4" />
        {t('browse:randomUrls.randomMediaURL')}
      </QuietButton>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('browse:randomUrls.randomMediaURL')}
        description={t('browse:randomUrls.generateAReusableURLFromTheCurrentVisibleFilters')}
        sheet
      >
        <div className="space-y-4 p-5">
          <p className="text-sm text-muted">
            {t('browse:randomUrls.usesTheCurrentFolderTagsSearchAndAdvancedFilters')}
          </p>
          <Field label={t('browse:randomUrls.randomMediaType')}>
            <Select value={type} onChange={event => setType(event.target.value)}>
              <option value="image">{t('browse:randomUrls.photos')}</option>
              <option value="gif">{t('browse:randomUrls.gIFPreviews')}</option>
            </Select>
          </Field>
          <Field label={t('browse:randomUrls.generatedURL')}>
            <Input readOnly value={url} onFocus={event => event.target.select()} />
          </Field>
          <div className="flex gap-3">
            <QuietButton
              onClick={() => {
                void navigator.clipboard
                  .writeText(url)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }}
            >
              {copied ? t('browse:randomUrls.copied') : t('browse:randomUrls.copyURL')}
            </QuietButton>
            <QuietLink href={url} target="_blank" rel="noreferrer">
              {t('browse:randomUrls.openRandomMedia')}
            </QuietLink>
          </div>
        </div>
      </Modal>
    </>
  )
}
