import { describe, expect, it, vi } from 'vitest'
import { focusPaneInput, paneFullscreenForViewport } from './paneView'

describe('pane viewport helpers', () => {
  it('uses the focused pane as a render-only fullscreen target on narrow viewports', () => {
    expect(paneFullscreenForViewport(null, 'pane-b', false)).toBe('pane-b')
    expect(paneFullscreenForViewport(null, 'pane-b', true)).toBeNull()
    expect(paneFullscreenForViewport('pane-a', 'pane-b', false)).toBe('pane-a')
  })

  it('focuses the textarea inside the currently focused pane only', () => {
    document.body.innerHTML = `
      <div data-pane-id="pane-a"><div data-input-box><textarea id="a"></textarea></div></div>
      <div data-pane-id="pane-b"><div data-input-box><textarea id="b"></textarea></div></div>
    `
    const focused = vi.spyOn(document.querySelector<HTMLTextAreaElement>('#b')!, 'focus')

    expect(focusPaneInput('pane-b')).toBe(true)
    expect(focused).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(document.querySelector('#b'))
  })
})
