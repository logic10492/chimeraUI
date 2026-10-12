import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionRequest, QuestionRequest } from '../../types/api/permission'

const { autoApprove, addRulesMock } = vi.hoisted(() => ({
  autoApprove: { enabled: false },
  addRulesMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../components/Icons', () => ({
  PermissionListIcon: () => <span />,
  QuestionIcon: () => <span />,
  UsersIcon: () => <span />,
  CheckIcon: () => <span />,
  ChevronDownIcon: () => <span />,
  ReturnIcon: () => <span />,
}))

vi.mock('../../components/ContentBlock', () => ({
  ContentBlock: ({ label }: { label: string }) => <div data-testid={`block-${label}`} />,
}))

vi.mock('../../store/childSessionStore', () => ({
  childSessionStore: { getSessionInfo: () => ({ title: 'child' }) },
}))

vi.mock('../../store/autoApproveStore', () => ({
  autoApproveStore: {
    get enabled() {
      return autoApprove.enabled
    },
    addRules: addRulesMock,
  },
}))

vi.mock('../../store/themeStore', () => ({
  themeStore: {
    subscribe: () => () => {},
    getSnapshot: (() => {
      const snapshot = { toolCardStyle: 'classic' }
      return () => snapshot
    })(),
  },
}))

vi.mock('../../store/keybindingStore', () => ({
  keybindingStore: { getKey: () => undefined },
  matchesKeybinding: () => false,
}))

vi.mock('../../hooks/usePresence', () => ({
  usePresence: () => ({ shouldRender: true, ref: () => {} }),
}))

vi.mock('./chatViewport', () => ({
  useChatViewport: () => ({ presentation: { isCompact: false } }),
}))

import { InteractionCard } from './InteractionCard'

const permission = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: 'perm-1',
  sessionID: 'session-1',
  permission: 'bash',
  patterns: ['npm test'],
  metadata: {},
  always: [],
  ...overrides,
})

const question = (): QuestionRequest => ({
  id: 'q-1',
  sessionID: 'session-1',
  questions: [
    {
      question: 'Continue?',
      header: 'Question',
      options: [
        { label: 'yes', description: 'continue' },
        { label: 'no', description: 'stop' },
      ],
      multiple: false,
    },
  ],
})

const handlers = () => ({
  onPermissionReply: vi.fn(),
  onQuestionReply: vi.fn(),
  onQuestionReject: vi.fn(),
})

beforeEach(() => {
  autoApprove.enabled = false
  addRulesMock.mockReset()
})

describe('InteractionCard — 统一交互模型的五条路径', () => {
  it('允许一次：点击 Allow once 回传 once（inline 与 stack 同源）', () => {
    const h = handlers()
    const { unmount } = render(
      <InteractionCard variant="inline" permission={permission()} isReplying={false} {...h} />,
    )
    fireEvent.click(screen.getByText('permissionDialog.allowOnce'))
    expect(h.onPermissionReply).toHaveBeenCalledWith('perm-1', 'once')
    unmount()

    const h2 = handlers()
    render(<InteractionCard variant="stack" permission={permission()} isReplying={false} {...h2} />)
    fireEvent.click(screen.getByText('permissionDialog.allowOnce'))
    expect(h2.onPermissionReply).toHaveBeenCalledWith('perm-1', 'once')
  })

  it('拒绝：点击 reject 回传 reject', () => {
    const h = handlers()
    render(<InteractionCard variant="inline" permission={permission()} isReplying={false} {...h} />)
    fireEvent.click(screen.getByText('common:reject'))
    expect(h.onPermissionReply).toHaveBeenCalledWith('perm-1', 'reject')
  })

  it('始终允许：后端模式回传 always；前端模式登记规则并回传 once', () => {
    const h = handlers()
    const { unmount } = render(
      <InteractionCard variant="inline" permission={permission()} isReplying={false} {...h} />,
    )
    fireEvent.click(screen.getByText('permissionDialog.alwaysAllow'))
    expect(h.onPermissionReply).toHaveBeenCalledWith('perm-1', 'always')
    unmount()

    autoApprove.enabled = true
    const h2 = handlers()
    render(<InteractionCard variant="inline" permission={permission()} isReplying={false} {...h2} />)
    fireEvent.click(screen.getByText('permissionDialog.alwaysAllow'))
    expect(addRulesMock).toHaveBeenCalledWith('session-1', 'bash', ['npm test'])
    expect(h2.onPermissionReply).toHaveBeenCalledWith('perm-1', 'once')
  })

  it('问答：选择选项后提交回传答案', () => {
    const h = handlers()
    render(<InteractionCard variant="stack" question={question()} isReplying={false} {...h} />)
    fireEvent.click(screen.getByText('yes'))
    fireEvent.click(screen.getByText('common:submit'))
    expect(h.onQuestionReply).toHaveBeenCalledWith('q-1', [['yes']])
  })

  it('超时/失效：请求从 pending 移除后统一卡片不再渲染', () => {
    const h = handlers()
    const { container, rerender } = render(
      <InteractionCard variant="stack" permission={permission()} isReplying={false} {...h} />,
    )
    expect(container.firstChild).not.toBeNull()
    rerender(<InteractionCard variant="stack" permission={undefined} isReplying={false} {...h} />)
    expect(container.firstChild).toBeNull()
  })
})