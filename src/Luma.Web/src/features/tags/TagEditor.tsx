import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { errorMessage, request, type Tag } from '../browse/api'

export function TagEditor({ mediaIds, tags = [], bulk = false, onChanged }: { mediaIds: number[]; tags?: Tag[]; bulk?: boolean; onChanged?: () => void }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState('add')
  const suggestionsId = useId()
  const client = useQueryClient()
  const suggestions = useQuery({ queryKey: ['tags', name], queryFn: ({ signal }) => request<Tag[]>(`/api/tags?prefix=${encodeURIComponent(name)}&limit=20`, signal), enabled: name.trim().length > 0, gcTime: 0 })
  const update = useMutation({ mutationFn: async ({ id, remove = false }: { id?: number; remove?: boolean }) => {
    if (id === undefined) {
      if (mode === 'remove') {
        const choices = await request<Tag[]>(`/api/tags?prefix=${encodeURIComponent(name)}&limit=50`)
        id = choices.find(x => x.name.normalize('NFC').toUpperCase() === name.trim().normalize('NFC').toUpperCase())?.id
        if (!id) throw new Error('Choose an existing tag to remove.')
        remove = true
      } else id = (await request<Tag>('/api/tags', undefined, 'POST', { name })).id
    }
    await request('/api/media/tags', undefined, 'POST', { mediaIds, addTagIds: remove ? [] : [id], removeTagIds: remove ? [id] : [] })
  }, onSuccess: async () => {
    setName('')
    await Promise.all([client.invalidateQueries({ queryKey: ['media'] }), client.invalidateQueries({ queryKey: ['detail'] }), client.invalidateQueries({ queryKey: ['neighbors'] }), client.invalidateQueries({ queryKey: ['tags'] })])
    onChanged?.()
  } })
  return <section className="space-y-4" aria-label={bulk ? 'Bulk tag editor' : 'Tag editor'}>
    {!bulk && <div className="flex flex-wrap gap-2">{tags.length === 0 && <p className="text-sm text-muted">No tags yet.</p>}{tags.map(tag => <QuietButton key={tag.id} className="gap-2" disabled={update.isPending} onClick={() => update.mutate({ id: tag.id, remove: true })} aria-label={`Remove tag ${tag.name}`}>
      {tag.name}<X className="size-3" aria-hidden="true" />
    </QuietButton>)}</div>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (name.trim()) update.mutate({}) }}>
      {bulk && <Field label="Operation"><Select value={mode} onChange={event => setMode(event.target.value)}><option value="add">Add a tag</option><option value="remove">Remove a tag</option></Select></Field>}
      <Field label="Tag name"><Input name="tag" autoComplete="off" list={suggestionsId} placeholder="Type a tag, then press Enter" value={name} onChange={event => setName(event.target.value)} maxLength={200} /></Field>
      <datalist id={suggestionsId}>{suggestions.data?.map(tag => <option key={tag.id} value={tag.name} />)}</datalist>
      <Button type="submit" disabled={update.isPending || !name.trim() || mediaIds.length === 0} className="gap-2"><Plus className="size-4" aria-hidden="true" />{update.isPending ? 'Saving…' : bulk ? `Apply to ${mediaIds.length} items` : 'Add tag'}</Button>
    </form>
    {update.isError && <p role="alert" className="text-sm text-danger">{errorMessage(update.error)}</p>}
    {update.isSuccess && <p role="status" className="text-sm text-positive">Tags saved.</p>}
  </section>
}
