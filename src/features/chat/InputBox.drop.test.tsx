import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInternalFileDrop, useTauriDropListeners } from './InputBox.hooks'
import type { DraggedFileInfo } from './InputBox.types'

type DragCallback = () => void
type DropCallback = (event: { payload: { kind: string; file: DraggedFileInfo }; point: { x: number; y: number } }) => void

const dragCore = vi.hoisted(() => ({
  snapshot: { active: null as null | { current: { x: number; y: number }; payload: { kind: string } } },
  inside: false,
  drag: null as DragCallback | null,
  drop: null as DropCallback | null,
}))

vi.mock('../../lib/internalDragCore', () => ({
  getInternalDragSnapshot: () => dragCore.snapshot,
  isPointInsideElement: () => dragCore.inside,
  subscribeInternalDrag: (cb: DragCallback) => {
    dragCore.drag = cb
    return () => {}
  },
  subscribeInternalDrop: (cb: DropCallback) => {
    dragCore.drop = cb
    return () => {}
  },
}))

vi.mock('../../utils/tauri', () => ({
  isTauri: () => false,
  getDesktopPlatform: () => 'linux',
}))

const file: DraggedFileInfo = { type: 'file', path: 'src/a.ts', absolute: '/ws/src/a.ts', name: 'a.ts' }

describe('InputBox drop hooks (batch ④)', () => {
  beforeEach(() => {
    dragCore.snapshot = { active: null }
    dragCore.inside = false
    dragCore.drag = null
    dragCore.drop = null
  })

  it('useInternalFileDrop reports the drag state only while a file-mention is inside the input', () => {
    const { result } = renderHook(() => useInternalFileDrop({ inputContainerRef: { current: null }, onDropFile: vi.fn() }))

    expect(result.current).toBe(false)

    dragCore.snapshot = { active: { current: { x: 1, y: 1 }, payload: { kind: 'file-mention' } } }
    dragCore.inside = true
    act(() => dragCore.drag?.())

    expect(result.current).toBe(true)

    dragCore.inside = false
    act(() => dragCore.drag?.())
    expect(result.current).toBe(false)
  })

  it('useInternalFileDrop forwards an inside drop to onDropFile and ignores outside drops', () => {
    const onDropFile = vi.fn()
    renderHook(() => useInternalFileDrop({ inputContainerRef: { current: null }, onDropFile }))

    act(() => dragCore.drop?.({ payload: { kind: 'file-mention', file }, point: { x: 1, y: 1 } }))
    expect(onDropFile).not.toHaveBeenCalled()

    dragCore.inside = true
    act(() => dragCore.drop?.({ payload: { kind: 'file-mention', file }, point: { x: 1, y: 1 } }))
    expect(onDropFile).toHaveBeenCalledWith(file)
  })

  it('useTauriDropListeners is inert off Tauri (no listeners registered)', () => {
    expect(() => renderHook(() => useTauriDropListeners(vi.fn()))).not.toThrow()
  })
})