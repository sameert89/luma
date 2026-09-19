import { useDeferredValue, useId, useRef, useState, type KeyboardEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Search, Tag as TagIcon, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { tagTone } from '../../components/ui/TagTone'
import { errorMessage, request, type Tag } from '../browse/api'

const sameTag = (a: string, b: string) => a.trim().normalize('NFC').toUpperCase() === b.trim().normalize('NFC').toUpperCase()

export function TagEditor({ mediaIds, tags = [], bulk = false, onChanged }: { mediaIds: number[]; tags?: Tag[]; bulk?: boolean; onChanged?: () => void }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState('add')
  const resultsId = useId()
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLUListElement>(null)
  const client = useQueryClient()
  // Results follow typing without a request per keystroke racing the next one.
  const typed = useDeferredValue(name.trim())
  const suggestions = useQuery({ queryKey: ['tags', typed], queryFn: ({ signal }) => request<Tag[]>(`/api/tags?prefix=${encodeURIComponent(typed)}&limit=8`, signal),
    enabled: typed.length > 0, gcTime: 0, placeholderData: keepPreviousData })
  const update = useMutation({ mutationFn: async ({ id, remove = false }: { id?: number; remove?: boolean }) => {
    if (id === undefined) {
      if (mode === 'remove') {
        const choices = await request<Tag[]>(`/api/tags?prefix=${encodeURIComponent(name)}&limit=50`)
        id = choices.find(x => sameTag(x.name, name))?.id
        if (!id) throw new Error('Choose an existing tag to remove.')
        remove = true
      } else id = (await request<Tag>('/api/tags', undefined, 'POST', { name })).id
    }
    await request('/api/media/tags', undefined, 'POST', { mediaIds, addTagIds: remove ? [] : [id], removeTagIds: remove ? [id] : [] })
  }, onSuccess: async () => {
    setName('')
    input.current?.focus()
    await Promise.all([client.invalidateQueries({ queryKey: ['media'] }), client.invalidateQueries({ queryKey: ['detail'] }), client.invalidateQueries({ queryKey: ['neighbors'] }), client.invalidateQueries({ queryKey: ['tags'] })])
    onChanged?.()
  } })
  const removing = bulk && mode === 'remove'
  const matches = typed ? suggestions.data ?? [] : []
  const applied = new Set(bulk ? [] : tags.map(tag => tag.id))
  const creatable = !removing && !!name.trim() && !matches.some(tag => sameTag(tag.name, name))
  const showResults = !!name.trim() && (matches.length > 0 || creatable)
  function choose(tag: Tag) { if (!applied.has(tag.id)) update.mutate({ id: tag.id, remove: removing }) }
  // Up and Down move between the field and its results; Escape returns to the field.
  function move(event: KeyboardEvent<HTMLElement>) {
    const items = [...(results.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); items[Math.min(index + 1, items.length - 1)].focus() }
    if (event.key === 'ArrowUp' && index >= 0) { event.preventDefault(); if (index === 0) input.current?.focus(); else items[index - 1].focus() }
    if (event.key === 'Escape' && index >= 0) { event.preventDefault(); event.stopPropagation(); input.current?.focus() }
  }
  return <section className="space-y-4" aria-label={bulk ? 'Bulk tag editor' : 'Tag editor'}>
    {!bulk && <div className="flex flex-wrap gap-2">{tags.length === 0 && <p className="text-sm text-muted">No tags yet.</p>}{tags.map(tag => <QuietButton key={tag.id} className="tag-tone gap-2" style={tagTone(tag.name)} disabled={update.isPending} onClick={() => update.mutate({ id: tag.id, remove: true })} aria-label={`Remove tag ${tag.name}`}>
      {tag.name}<X className="size-3" aria-hidden="true" />
    </QuietButton>)}</div>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (name.trim()) update.mutate({}) }}>
      {bulk && <Field label="Operation"><Select value={mode} onChange={event => setMode(event.target.value)}><option value="add">Add a tag</option><option value="remove">Remove a tag</option></Select></Field>}
      <Field label={removing ? 'Tag to remove' : 'Find or create a tag'}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          {/* No browser or keyboard autocomplete: the results below are the suggestions. */}
          <Input ref={input} name="tag" type="search" className="pl-9" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done"
            aria-describedby={showResults ? resultsId : undefined} placeholder={removing ? 'Type a tag on these items' : 'Type to search, Enter to add'}
            value={name} onChange={event => setName(event.target.value)} onKeyDown={move} maxLength={200} />
        </div>
      </Field>
      {showResults && <ul ref={results} id={resultsId} aria-label="Matching tags" className="overflow-hidden rounded-xl border border-line">
        {matches.map(tag => { const on = applied.has(tag.id); return <li key={tag.id} className="border-b border-line last:border-b-0">
          <button type="button" disabled={on || update.isPending} onClick={() => choose(tag)} onKeyDown={move}
            className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm hover:bg-surface focus-visible:ring-inset disabled:cursor-default">
            <TagIcon className="size-4 shrink-0 text-accent" aria-hidden="true" /><span className="tag-tone min-w-0 flex-1 truncate rounded-full border px-2 py-1" style={tagTone(tag.name)}>{tag.name}</span>
            {on ? <span className="flex shrink-0 items-center gap-1 text-xs text-muted"><Check className="size-3" aria-hidden="true" />Added</span>
              : <span className="shrink-0 text-xs text-muted">{removing ? 'Remove' : 'Add'}</span>}
          </button>
        </li> })}
        {creatable && <li><button type="button" disabled={update.isPending} onClick={() => update.mutate({})} onKeyDown={move}
          className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm hover:bg-surface focus-visible:ring-inset">
          <Plus className="size-4 shrink-0 text-accent" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">Create “{name.trim()}”</span><span className="shrink-0 text-xs text-muted">New tag</span>
        </button></li>}
      </ul>}
      {bulk && <Button type="submit" disabled={update.isPending || !name.trim() || mediaIds.length === 0} className="gap-2"><Plus className="size-4" aria-hidden="true" />{update.isPending ? 'Saving…' : `Apply to ${mediaIds.length} items`}</Button>}
    </form>
    {update.isPending && !bulk && <p role="status" className="text-sm text-muted">Saving…</p>}
    {update.isError && <p role="alert" className="text-sm text-danger">{errorMessage(update.error)}</p>}
    {update.isSuccess && <p role="status" className="text-sm text-positive">Tags saved.</p>}
  </section>
}
