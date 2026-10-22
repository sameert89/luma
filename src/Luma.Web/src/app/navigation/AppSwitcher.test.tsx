import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { AppSwitcher } from './AppSwitcher'
test('only the logo is visible until clicked and globally disabled apps are absent', async () => {
  render(
    <AppSwitcher active="gallery" applications={{ flickEnabled: false, panelsEnabled: true }} onSelect={vi.fn()} />,
  )
  const logo = screen.getByRole('button', { name: 'Switch application, Gallery' })
  expect(logo).toHaveTextContent('luma.')
  expect(logo).not.toHaveTextContent('Gallery')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(logo)
  expect(screen.getByRole('button', { name: 'Gallery' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Panels' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Flick' })).not.toBeInTheDocument()
})
