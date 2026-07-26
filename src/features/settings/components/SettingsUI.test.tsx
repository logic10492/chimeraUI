import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SegmentedControl } from './SettingsUI'

function Harness() {
  const [value, setValue] = useState('alpha')
  return (
    <SegmentedControl
      value={value}
      ariaLabel="Delivery mode"
      options={[
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
        { value: 'gamma', label: 'Gamma' },
      ]}
      onChange={setValue}
    />
  )
}

describe('SegmentedControl', () => {
  it('exposes a named radiogroup with non-submit 44px targets', () => {
    render(<Harness />)

    expect(screen.getByRole('radiogroup', { name: 'Delivery mode' })).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('type', 'button')
      expect(radio).toHaveClass('min-h-11')
    }
  })

  it('keeps selection and DOM focus synchronized for arrows, Home, and End', () => {
    render(<Harness />)
    const alpha = screen.getByRole('radio', { name: 'Alpha' })
    const beta = screen.getByRole('radio', { name: 'Beta' })
    const gamma = screen.getByRole('radio', { name: 'Gamma' })

    alpha.focus()
    fireEvent.keyDown(alpha, { key: 'ArrowRight' })
    expect(beta).toHaveFocus()
    expect(beta).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(beta, { key: 'ArrowDown' })
    expect(gamma).toHaveFocus()
    expect(gamma).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(gamma, { key: 'ArrowLeft' })
    expect(beta).toHaveFocus()
    expect(beta).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(beta, { key: 'ArrowUp' })
    expect(alpha).toHaveFocus()
    expect(alpha).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(alpha, { key: 'End' })
    expect(gamma).toHaveFocus()
    expect(gamma).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(gamma, { key: 'Home' })
    expect(alpha).toHaveFocus()
    expect(alpha).toHaveAttribute('aria-checked', 'true')
  })

  it('supports an accessible name from an external label', () => {
    render(
      <>
        <span id="delivery-mode-label">Delivery mode label</span>
        <SegmentedControl
          value="alpha"
          ariaLabelledBy="delivery-mode-label"
          options={[
            { value: 'alpha', label: 'Alpha' },
            { value: 'beta', label: 'Beta' },
          ]}
          onChange={() => undefined}
        />
      </>,
    )

    expect(screen.getByRole('radiogroup', { name: 'Delivery mode label' })).toBeInTheDocument()
  })
})
