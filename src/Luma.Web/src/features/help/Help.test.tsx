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
    for (const title of [
      'Libraries, folders and gallery',
      'Search, tags and Collections',
      'Photo and video viewer',
      'Flick',
      'Background jobs',
      'Settings',
      'Gestures and keyboard shortcuts',
    ])
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
    expect(libraries).toHaveTextContent('Date sorts use the folder’s last-change date')
    expect(libraries).toHaveTextContent('To check for file changes on disk, choose Rescan folder or Rescan library')
    expect(libraries).toHaveTextContent('To stop filtering your results, use Clear all filters instead')
    expect(section('Flick')).toHaveTextContent('Vertical swipes move between reels')
    expect(section('Background jobs')).toHaveTextContent('without affecting your files or scan history')
    expect(section('Photo and video viewer')).toHaveTextContent(
      'Watch progress is shared by everyone using this Luma server',
    )
    expect(section('Gestures and keyboard shortcuts')).toHaveTextContent('Videos in the normal viewer only')
    expect(section('Settings')).toHaveTextContent('Videos aren’t included')
    expect(section('Photo and video viewer')).toHaveTextContent('Captions use plain text, without custom fonts')
    expect(section('Photo and video viewer')).toHaveTextContent('Turn on CC and pick a track')
    expect(section('Luma 2.0 applications and files')).toHaveTextContent(
      'each app remembers its own search and filters',
    )
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
