import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadingSpinner } from './SessionListLoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders a medium spinner by default', () => {
    const { container } = render(<LoadingSpinner />)
    const svg = container.querySelector('svg')

    expect(svg).not.toBeNull()
    expect(svg).toHaveClass('animate-spin', 'text-text-400', 'w-5', 'h-5')
  })

  it('renders a small spinner when size is "sm"', () => {
    const { container } = render(<LoadingSpinner size="sm" />)
    const svg = container.querySelector('svg')

    expect(svg).not.toBeNull()
    expect(svg).toHaveClass('animate-spin', 'text-text-400', 'w-3', 'h-3')
  })
})