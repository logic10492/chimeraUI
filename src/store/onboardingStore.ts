// ============================================
// OnboardingStore - 首启状态机（W2 C.3）
// ============================================
//
// 现状问题：WebUI 首启必须先到 TUI 配置 provider 才能用。
// 后端 API 已就绪，缺的只是首启状态机：
//   零 connected provider → 自动打开 Provider 设置 → 连接成功 → 引导选模型。
//
// 状态：
//   idle          未检测
//   checking      正在检测 provider
//   needs-provider 零 connected provider 且未跳过 → 自动打开 Provider 设置
//   needs-model    刚在首启流程中连接成功 → 引导到模型选择
//   ready          已有 provider / 用户跳过 / 流程完成 → 不再打扰
//
// 「以后再说」出口：skip() 按 server 持久化，之后不再自动弹出。
// 任何 API 失败都退化为 ready，绝不把用户困在首启里。

import { useSyncExternalStore } from 'react'
import { listProviders } from '../api/provider'
import type { ProviderListResponse } from '@opencode-ai/sdk/v2/client'
import type { ApiScopeInput } from '../api/scope'
import { serverStorage } from '../utils/perServerStorage'

export type OnboardingStatus = 'idle' | 'checking' | 'needs-provider' | 'needs-model' | 'ready'

export interface OnboardingState {
  status: OnboardingStatus
  /** 最近一次检测到的「用户已配置」provider 数量（排除内置免费 provider） */
  connectedCount: number
  /** 用户是否已选择「以后再说」 */
  skipped: boolean
}

type Subscriber = () => void

const DISMISSED_KEY = 'onboarding:provider-dismissed'

// 实测（2026-10-12 冷启动，全新配置目录）：本 fork 内置 OpenCode Zen 免费 provider，
// 无任何用户凭据时它以 `id:"opencode" + options.apiKey:"public"` 出现在 connected 里。
// 因此 `connected.length === 0` 永不为真，首启信号必须排除这个内置免费 provider；
// 用户通过 WebUI 连接任意 provider 后（source:"api"/"env"/"config"）才会计入。
function isBuiltinFreeProvider(provider: ProviderListResponse['all'][number] | undefined): boolean {
  return provider?.id === 'opencode' && provider.options?.apiKey === 'public'
}

function countUserProviders(result: ProviderListResponse): number {
  const byId = new Map(result.all.map(provider => [provider.id, provider]))
  return result.connected.filter(id => !isBuiltinFreeProvider(byId.get(id))).length
}

export class OnboardingStore {
  private state: OnboardingState = { status: 'idle', connectedCount: 0, skipped: false }
  private subscribers = new Set<Subscriber>()
  private inflight: Promise<void> | null = null

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  getSnapshot = (): OnboardingState => this.state

  private notify(): void {
    this.subscribers.forEach(callback => callback())
  }

  private setState(next: OnboardingState): void {
    this.state = next
    this.notify()
  }

  private isDismissed(): boolean {
    return serverStorage.get(DISMISSED_KEY) === '1'
  }

  /**
   * 检测当前 server 的 connected provider 数量并推进状态机。
   * 幂等：并发调用共享同一个 in-flight 请求。
   */
  check(input?: ApiScopeInput): Promise<void> {
    if (this.inflight) return this.inflight

    const skipped = this.isDismissed()
    this.setState({ ...this.state, status: 'checking', skipped })

    this.inflight = (async () => {
      try {
        const result = await listProviders(input)
        const connectedCount = countUserProviders(result)
        const status: OnboardingStatus = skipped || connectedCount > 0 ? 'ready' : 'needs-provider'
        this.setState({ status, connectedCount, skipped })
      } catch {
        // 检测失败时不阻塞用户，退化为 ready。
        this.setState({ ...this.state, status: 'ready' })
      } finally {
        this.inflight = null
      }
    })()

    return this.inflight
  }

  /** 首启流程中连接成功 → 引导到模型选择。仅在 needs-provider 阶段生效。 */
  notifyProviderConnected(): void {
    if (this.state.status !== 'needs-provider') return
    this.setState({
      ...this.state,
      status: 'needs-model',
      connectedCount: Math.max(1, this.state.connectedCount),
    })
  }

  /** 「以后再说」：按 server 持久化，之后不再自动弹出。 */
  skip(): void {
    serverStorage.set(DISMISSED_KEY, '1')
    this.setState({ ...this.state, status: 'ready', skipped: true })
  }

  /** 首启流程正常结束（已连接或已选模型）。 */
  complete(): void {
    this.setState({ ...this.state, status: 'ready' })
  }

  /** 重置（测试用）。 */
  reset(): void {
    serverStorage.remove(DISMISSED_KEY)
    this.setState({ status: 'idle', connectedCount: 0, skipped: false })
  }
}

export const onboardingStore = new OnboardingStore()

export function useOnboardingStore(): OnboardingState {
  return useSyncExternalStore(onboardingStore.subscribe, onboardingStore.getSnapshot, onboardingStore.getSnapshot)
}
