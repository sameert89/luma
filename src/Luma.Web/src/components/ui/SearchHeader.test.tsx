import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { SearchHeader } from './SearchHeader'

const suggestions = [
  { kind: 'tag', label: 'Beach', id: 4 },
  { kind: 'folder', label: 'Beach trip', id: 30, detail: 'Photos / 2025', libraryId: 1 },
  { kind: 'file', label: 'beach-sunset.jpg', id: 12, detail: 'Trips/2025' },
]

function Harness({ onSearch, onSuggestion }: { onSearch: () => void; onSuggestion: (value: unknown) => void }) {
  const [value, setValue] = useState('')
  return <SearchHeader value={value} onChange={setValue} onSearch={onSearch} onSuggestion={onSuggestion} onClear={() => setValue('')} onHome={vi.fn()} onFilters={vi.fn()} searchRequested={false} />
}
function renderHeader() {
  const onSearch = vi.fn()
  const onSuggestion = vi.fn()
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(suggestions))))
  vi.stubGlobal('fetch', fetch)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><Harness onSearch={onSearch} onSuggestion={onSuggestion} /></QueryClientProvider>)
  return { onSearch, onSuggestion, fetch, field: screen.getByRole('combobox', { name: 'Search media' }) }
}

it('autocompletes and says whether each suggestion is a tag, a folder or a file', async () => {
  const { field, fetch } = renderHeader()
  await userEvent.type(field, 'bea')
  const tag = await screen.findByRole('option', { name: /Beach\s*Tag/ })
  const file = screen.getByRole('option', { name: /beach-sunset\.jpg\s*Trips\/2025\s*File/ })
  expect(tag).toBeVisible()
  expect(screen.getByRole('option', { name: /Beach trip\s*Photos \/ 2025\s*Folder/ })).toBeVisible()
  expect(file).toBeVisible()
  expect(field).toHaveAttribute('aria-expanded', 'true')
  expect(fetch).toHaveBeenLastCalledWith('/api/search/suggestions?q=bea&limit=8', expect.anything())
})

it('picks a suggestion with the arrow keys and Enter, and searches the typed text otherwise', async () => {
  const { field, onSearch, onSuggestion } = renderHeader()
  await userEvent.type(field, 'bea')
  await screen.findByRole('option', { name: /Beach\s*Tag/ })
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
  expect(screen.getByRole('option', { name: /beach-sunset/ })).toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{Enter}')
  expect(onSuggestion).toHaveBeenCalledWith(suggestions[2])
  expect(onSearch).not.toHaveBeenCalled()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

  await userEvent.type(field, 'c')
  await screen.findByRole('listbox')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  expect(onSearch).toHaveBeenCalledTimes(1)
})

it('chooses a suggestion by tapping it', async () => {
  const { field, onSuggestion } = renderHeader()
  await userEvent.type(field, 'bea')
  await userEvent.click(await screen.findByRole('option', { name: /Beach\s*Tag/ }))
  expect(onSuggestion).toHaveBeenCalledWith(suggestions[0])
})

it('closes an expanded phone search field when nothing was searched and the view changes', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  function Harness({ scope }: { scope: string }) {
    const [value, setValue] = useState('')
    return <SearchHeader value={value} onChange={setValue} onSearch={vi.fn()} onClear={() => setValue('')} onHome={vi.fn()} onFilters={vi.fn()} searchRequested={false} scope={scope} />
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const shell = (scope: string) => <QueryClientProvider client={client}><Harness scope={scope} /></QueryClientProvider>
  const { rerender } = render(shell('library:'))
  await userEvent.click(screen.getByRole('button', { name: 'Open search' }))
  const field = screen.getByRole('search')
  expect(field).toHaveAttribute('data-open', 'true')

  // Still open while the caret is in it: clearing a query leaves the field ready for the next one.
  await userEvent.click(screen.getByRole('textbox', { name: 'Search media' }))
  rerender(shell('library:folderId=2'))
  expect(field).toHaveAttribute('data-open', 'true')

  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  rerender(shell('search:q=beach'))
  expect(screen.getByRole('search')).toHaveAttribute('data-open', 'false')
})
