import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiAgent } from '../../../api/client'
import { InputToolbar } from './InputToolbar'

const useIsMobileMock = vi.fn()
const useChatViewportMock = vi.fn()
const isTauriMock = vi.fn()
const isTauriMobileMock = vi.fn()
const openMock = vi.fn()
const readFileMock = vi.fn()
const agents: ApiAgent[] = [
  { name: 'build', description: 'Build things', mode: 'primary', permission: [], options: {} },
  { name: 'plan', description: 'Plan work', mode: 'primary', permission: [], options: {} },
]

vi.mock('../../../hooks', () => ({
  useIsMobile: () => useIsMobileMock(),
  useSessionStats: () => ({
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    contextUsed: 0,
    contextLimit: 400000,
    contextPercent: 0,
    contextEstimated: false,
  }),
  useConnectionState: () => 'connected',
  formatTokens: (n: number) => `${n}`,
  formatCost: (n: number) => `$${n.toFixed(2)}`,
}))

vi.mock('../chatViewport', () => ({
  useChatViewport: () => useChatViewportMock(),
}))

vi.mock('../../../utils/tauri', () => ({
  isTauri: () => isTauriMock(),
  isTauriMobile: () => isTauriMobileMock(),
  isTauriAndroid: () => false,
  extToMime: (ext: string) => {
    if (ext === 'png') return 'image/png'
    return 'application/octet-stream'
  },
}))

vi.mock('../../../api/events', () => ({
getConnectionInfo: () => ({ state: 'connected', lastEventTime: 0, reconnectAttempt: 0 }),
subscribeToConnectionState: (fn: (info: { state: string }) => void) => {
fn({ state: 'connected' })
return () => {}
},
}))

vi.mock('../../../constants/api', () => ({
  API_BASE_URL: 'http://localhost:4096',
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openMock(...args),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}))

vi.mock('../../../components/ui', () => ({
  DropdownMenu: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
  MenuItem: ({
    label,
    onClick,
    selectionRole,
    selected,
  }: {
    label: string
    onClick: () => void
    selectionRole?: 'menuitemradio' | 'option'
    selected?: boolean
  }) => {
    const selectionProps =
      selectionRole === 'menuitemradio'
        ? { role: selectionRole, 'aria-checked': selected, tabIndex: selected ? 0 : -1 }
        : selectionRole === 'option'
          ? { role: selectionRole, 'aria-selected': selected, tabIndex: selected ? 0 : -1 }
          : {}

    return (
      <button type="button" onClick={onClick} {...selectionProps}>
        {label}
      </button>
    )
  },
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  AnimatedPresence: ({ show, children }: { show: boolean; children: React.ReactNode }) =>
    show ? <>{children}</> : null,
}))

vi.mock('../ModelSelector', () => ({
ModelSelector: () => null,
}))

vi.mock('../sidebar/ContextDetailsDialog', () => ({
  ContextDetailsDialog: () => null,
}))

describe('InputToolbar', () => {
  beforeEach(() => {
    useIsMobileMock.mockReturnValue(false)
    useChatViewportMock.mockReturnValue({
      presentation: { surfaceVariant: 'desktop', isCompact: false },
    })
    isTauriMock.mockReturnValue(false)
    isTauriMobileMock.mockReturnValue(false)
    openMock.mockReset()
    readFileMock.mockReset()
  })

  it('uses the browser file input on Tauri mobile', () => {
    useIsMobileMock.mockReturnValue(true)
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(true)

    const onFilesSelected = vi.fn()
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')

    const { container } = render(
      <InputToolbar
        agents={[]}
        fileCapabilities={{ image: true, pdf: false, audio: false, video: false }}
        onFilesSelected={onFilesSelected}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
    expect(inputClickSpy).toHaveBeenCalledTimes(1)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(onFilesSelected).toHaveBeenCalledWith([file])
    inputClickSpy.mockRestore()
  })

  it('uses the Tauri native picker on desktop', async () => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    openMock.mockResolvedValue(['/tmp/photo.png'])
    readFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]))

    const onFilesSelected = vi.fn()

    render(
      <InputToolbar
        agents={[]}
        fileCapabilities={{ image: true, pdf: false, audio: false, video: false }}
        onFilesSelected={onFilesSelected}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledTimes(1)
      expect(readFileMock).toHaveBeenCalledWith('/tmp/photo.png')
      expect(onFilesSelected).toHaveBeenCalledTimes(1)
    })

    const [files] = onFilesSelected.mock.calls[0] as [File[]]
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('photo.png')
    expect(files[0].type).toBe('image/png')
  })

  it('keeps the full context usage summary on desktop', () => {
    render(
      <InputToolbar
        agents={[]}
        fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
        onFilesSelected={vi.fn()}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: /Context Usage:/ })

    expect(trigger).toHaveTextContent('0 / 400000')
    expect(trigger).toHaveTextContent('0%')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('collapses context usage to a ring in compact layouts and preserves its summary popover', () => {
    useChatViewportMock.mockReturnValue({
      presentation: { surfaceVariant: 'compact', isCompact: true },
    })

    render(
      <InputToolbar
        agents={[]}
        fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
        onFilesSelected={vi.fn()}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: /Context Usage:/ })

    expect(trigger).toHaveClass('h-8', 'w-8')
    expect(trigger).not.toHaveTextContent('0 / 400000')
    expect(trigger).not.toHaveTextContent('0%')
    expect(trigger.querySelector('svg')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Context Usage' })).toBeInTheDocument()
    expect(screen.getByText('0 / 400000')).toBeInTheDocument()
  })

  it('moves focus into the opened agent menu and exposes menu semantics', async () => {
    render(
      <InputToolbar
        agents={agents}
        selectedAgent="build"
        onAgentChange={vi.fn()}
        fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
        onFilesSelected={vi.fn()}
        canSend={false}
        onSend={vi.fn()}
      />,
    )

    const trigger = screen.getByTitle('build: Build things')

    fireEvent.click(trigger)

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('menuitemradio', { name: 'Build' })).toHaveFocus()
    })
  })

  it('closes the agent menu on Tab and moves focus to the next toolbar control', async () => {
    render(
      <InputToolbar
        agents={agents}
        selectedAgent="build"
        onAgentChange={vi.fn()}
        fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
        canSend={true}
        onFilesSelected={vi.fn()}
        onSend={vi.fn()}
      />,
    )

    const trigger = screen.getByTitle('build: Build things')
    fireEvent.click(trigger)

    const selectedItem = await screen.findByRole('menuitemradio', { name: 'Build' })
    fireEvent.keyDown(selectedItem, { key: 'Tab' })

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByTitle(/Context:/)).toHaveFocus()
    })
  })

  it('returns focus to the composer after selecting an agent', async () => {
    function ToolbarHarness() {
      const containerRef = useRef<HTMLDivElement>(null)

      return (
        <div ref={containerRef}>
          <textarea aria-label="Chat input" />
          <InputToolbar
            agents={agents}
            selectedAgent="build"
            onAgentChange={vi.fn()}
            fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
            onFilesSelected={vi.fn()}
            canSend={false}
            onSend={vi.fn()}
            inputContainerRef={containerRef}
          />
        </div>
      )
    }

    render(<ToolbarHarness />)

    fireEvent.click(screen.getByTitle('build: Build things'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Plan' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Chat input' })).toHaveFocus())
  })
})
