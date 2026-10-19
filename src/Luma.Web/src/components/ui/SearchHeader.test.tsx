import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
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
  return (
    <SearchHeader
      value={value}
      onChange={setValue}
      onSearch={onSearch}
      onSuggestion={onSuggestion}
      onClear={() => setValue('')}
      onHome={vi.fn()}
      onFilters={vi.fn()}
      searchRequested={false}
    />
  )
}
function renderHeader() {
  const onSearch = vi.fn()
  const onSuggestion = vi.fn()
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(suggestions))))
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <Harness onSearch={onSearch} onSuggestion={onSuggestion} />
    </QueryClientProvider>,
  )
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

// The suggestion list floats over the filter row, and Clear all filters sits directly under it.
// Choosing happens on pointer down, so by the time the click arrives the list has gone and the
// click lands on whatever it was covering -- which cleared the filters instead of picking the
// suggestion, and made any suggestion over that button impossible to choose.
it('does not press what the suggestion list was covering', async () => {
  const onSearch = vi.fn()
  const onSuggestion = vi.fn()
  const clearAllFilters = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(suggestions)))),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <Harness onSearch={onSearch} onSuggestion={onSuggestion} />
      <button type="button" onClick={clearAllFilters}>
        Clear all filters
      </button>
    </QueryClientProvider>,
  )

  await userEvent.type(screen.getByRole('combobox', { name: 'Search media' }), 'bea')
  const option = await screen.findByRole('option', { name: /Beach\s*Tag/ })

  // The gesture as a browser delivers it: the list closes on pointer down, then the click lands
  // on the button now under the finger.
  fireEvent.pointerDown(option)
  fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))

  expect(onSuggestion).toHaveBeenCalledWith(expect.objectContaining({ label: 'Beach' }))
  expect(clearAllFilters).not.toHaveBeenCalled()

  // Only that one click is swallowed: the next deliberate press works.
  fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
  expect(clearAllFilters).toHaveBeenCalledTimes(1)
})

it('keeps search visible with its logo and actions on phones, and hides it on Settings', async () => {
  const client = new QueryClient()
  const ui = (hidden: boolean) => (
    <QueryClientProvider client={client}>
      <SearchHeader
        value="photos"
        onChange={vi.fn()}
        onSearch={vi.fn()}
        onClear={vi.fn()}
        onHome={vi.fn()}
        onFilters={vi.fn()}
        onSettings={vi.fn()}
        searchRequested={false}
        hideSearch={hidden}
        logo={<button>Switch application</button>}
      />
    </QueryClientProvider>
  )
  const { rerender } = render(ui(false))
  expect(screen.getByRole('textbox', { name: 'Search media' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Switch application' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Filters' })).toBeVisible()
  rerender(ui(true))
  expect(screen.queryByRole('search')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull()
})
