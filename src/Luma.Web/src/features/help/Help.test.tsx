import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Help } from './Help'
import { guideSections } from './guide'

function section(name: string) {
  return screen.getByRole('region', { name })
}

describe('Help guide', () => {
  it('indexes every section and documents each control with a location and behaviour', () => {
    render(<Help onBack={() => {}} />)
    const index = screen.getByRole('navigation', { name: 'Help sections' })
    for (const title of ['Libraries, folders and gallery', 'Search, tags and Collections', 'Photo and video viewer', 'Reels', 'Background tasks', 'Settings', 'Gestures and keyboard shortcuts'])
      expect(within(index).getByRole('link', { name: new RegExp(title) })).toBeVisible()
    for (const entry of guideSections.flatMap(item => item.groups.flatMap(group => group.entries))) {
      expect(entry.where).not.toBe('')
      expect(entry.what).not.toBe('')
      expect(!!entry.icons?.length || !!entry.label || !!entry.progressBar).toBe(true)
    }
  })

  it('explains the distinctions users most often confuse', () => {
    render(<Help onBack={() => {}} />)
    const libraries = section('Libraries, folders and gallery')
    expect(libraries).toHaveTextContent('Folders are always sorted by name and follow the selected direction')
    expect(libraries).toHaveTextContent('Refresh collection inside a library is a rescan and always asks first')
    expect(libraries).toHaveTextContent('Hiding the row does not clear anything')
    expect(section('Reels')).toHaveTextContent('no right-side volume swipe')
    expect(section('Background tasks')).toHaveTextContent('It does not delete media, scan history or metadata checkpoints')
    expect(section('Photo and video viewer')).toHaveTextContent('not a per-person account sync')
    expect(section('Gestures and keyboard shortcuts')).toHaveTextContent('Videos in the normal viewer only')
    expect(section('Settings')).toHaveTextContent('It does not serve random videos')
    expect(screen.queryByText(/Install Luma/)).not.toBeInTheDocument()
  })

  it('keeps guide icons decorative and offers a keyboard-reachable Back', async () => {
    const onBack = vi.fn()
    render(<Help onBack={onBack} />)
    expect(screen.getByRole('heading', { name: 'Help', level: 1 })).toHaveFocus()
    // Guide entries document controls; they are not live action buttons.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    screen.getByRole('button', { name: 'Back' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onBack).toHaveBeenCalledOnce()
  })
})
