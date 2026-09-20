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
        Random media URL
      </QuietButton>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Random media URL"
        description="Generate a reusable URL from the current visible filters."
        sheet
      >
        <div className="space-y-4 p-5">
          <p className="text-sm text-muted">
            Uses the current folder, tags, search and advanced filters. Configure them with Filters. This content
            endpoint serves cached photos or GIF previews.
          </p>
          <Field label="Random media type">
            <Select value={type} onChange={event => setType(event.target.value)}>
              <option value="image">Photos</option>
              <option value="gif">GIF previews</option>
            </Select>
          </Field>
          <Field label="Generated URL">
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
              {copied ? 'Copied' : 'Copy URL'}
            </QuietButton>
            <QuietLink href={url} target="_blank" rel="noreferrer">
              Open random media
            </QuietLink>
          </div>
        </div>
      </Modal>
    </>
  )
}
