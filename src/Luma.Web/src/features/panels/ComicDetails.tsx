import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Checkbox, Field, Input, QuietButton, Textarea } from '../../components/ui/Controls'
import { errorMessage, request } from '../browse/api'
import type { Comic, ComicMetadataUpdate } from './api'

export function ComicDetails({ id, onSaved }: { id: number; onSaved: () => void }) {
  const detail = useQuery({
    queryKey: ['comic', id],
    queryFn: ({ signal }) => request<Comic>(`/api/panels/comics/${id}`, signal),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  if (detail.error)
    return (
      <p role="alert" className="p-5 text-danger">
        {errorMessage(detail.error)}
      </p>
    )
  if (!detail.data || !detail.isFetchedAfterMount)
    return (
      <p role="status" className="p-5 text-muted">
        Loading comic details…
      </p>
    )
  return <MetadataForm comic={detail.data} onSaved={onSaved} />
}

function MetadataForm({ comic, onSaved }: { comic: Comic; onSaved: () => void }) {
  const [draft, setDraft] = useState<ComicMetadataUpdate>({
    title: comic.title,
    series: comic.series,
    author: comic.author,
    description: comic.description,
    favourite: comic.favourite,
    coverPage: comic.coverPage,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const favouriteId = useId()
  const client = useQueryClient()
  async function save() {
    setBusy(true)
    setError('')
    try {
      await request(`/api/panels/comics/${comic.id}/metadata`, undefined, 'PUT', draft)
      for (const key of ['comics', 'comic', 'tasks']) void client.invalidateQueries({ queryKey: [key] })
      onSaved()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-4 p-5"
      onSubmit={event => {
        event.preventDefault()
        void save()
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        <Field label="Title">
          <Input
            required
            maxLength={500}
            value={draft.title}
            onChange={event => setDraft({ ...draft, title: event.target.value })}
          />
        </Field>
        <Field label="Series">
          <Input
            maxLength={500}
            value={draft.series}
            onChange={event => setDraft({ ...draft, series: event.target.value })}
          />
        </Field>
        <Field label="Author">
          <Input
            maxLength={500}
            value={draft.author}
            onChange={event => setDraft({ ...draft, author: event.target.value })}
          />
        </Field>
        <Field label="Description">
          <Textarea
            maxLength={4096}
            rows={4}
            value={draft.description}
            onChange={event => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>
        <label htmlFor={favouriteId} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={favouriteId}
            checked={draft.favourite}
            onChange={event => setDraft({ ...draft, favourite: event.target.checked })}
          />
          Favourite
        </label>
        <Field label="Cover page">
          <Input
            type="number"
            required
            min={1}
            max={comic.pageCount}
            step={1}
            value={Number.isNaN(draft.coverPage) ? '' : draft.coverPage + 1}
            onChange={event => setDraft({ ...draft, coverPage: event.target.valueAsNumber - 1 })}
          />
        </Field>
        <p className="text-sm text-muted">
          Changing the cover queues background preparation. The source archive or folder stays unchanged.
        </p>
        <QuietButton
          type="submit"
          disabled={
            !draft.title.trim() ||
            !Number.isInteger(draft.coverPage) ||
            draft.coverPage < 0 ||
            draft.coverPage >= comic.pageCount
          }
        >
          {busy ? 'Saving…' : 'Save comic details'}
        </QuietButton>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
