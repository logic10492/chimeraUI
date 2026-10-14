/**
 * StreamingPreview 视觉走查 playground（仅 dev：vite 通过 /playground.html 提供服务，
 * `bun run build` 默认只打包 index.html，不会把本页发布进 dist）。
 *
 * 完全离线渲染：只复用 app 的全局样式 / i18n / 主题注入（与 main.tsx 相同的前置步骤），
 * 不导入 serverStore、SSE、messageStore 等任何会联网或读会话数据的模块。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '../index.css'
import '../i18n'
import { themeStore, type ColorMode } from '../store/themeStore'
import { FullscreenProvider } from '../contexts/FullscreenContext'
import { StreamingPreview } from '../features/message/tools/renderers/StreamingPreview'
import type { StreamingHunk } from '../types/message'

// 与 main.tsx 一致：React 渲染前把主题变量 / data-mode / glass class 注入 DOM
themeStore.init()

// 视觉走查便捷参数:?theme=light|dark 固定主题，避免跟随截图环境的系统偏好漂移
const themeParam = new URLSearchParams(window.location.search).get('theme')
if (themeParam === 'light' || themeParam === 'dark') themeStore.setColorMode(themeParam)

// ============================================
// Fixtures：Cart 类 3 个 edit op（pos 锚点风格与真实 hashline 一致）
// ============================================

const CART_FILE = 'src/domain/cart.ts'

const HUNK_TOTAL: StreamingHunk = {
  index: 0,
  op: 'replace',
  filePath: CART_FILE,
  pos: '18#RQ',
  before: [
    '  get total(): number {',
    '    return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0)',
    '  }',
  ].join('\n'),
  after: [
    '  get total(): number {',
    '    const subtotal = this.items.reduce((sum, i) => sum + i.price * i.quantity, 0)',
    '    return roundCents(subtotal * (1 - this.discount))',
    '  }',
  ].join('\n'),
}

const HUNK_DISCOUNT: StreamingHunk = {
  index: 1,
  op: 'append',
  filePath: CART_FILE,
  pos: '42#VX',
  before: ['  remove(index: number): void {', '    this.items.splice(index, 1)', '  }'].join('\n'),
  after: [
    '  remove(index: number): void {',
    '    this.items.splice(index, 1)',
    '  }',
    '',
    '  applyDiscount(percent: number): void {',
    '    if (percent < 0 || percent > 100) throw new RangeError(`bad discount: ${percent}`)',
    '  }',
  ].join('\n'),
}

const HUNK_FIELD: StreamingHunk = {
  index: 2,
  op: 'append',
  filePath: CART_FILE,
  pos: '7#KP',
  before: ['export class Cart {', '  private items: CartItem[] = []'].join('\n'),
  after: ['export class Cart {', '  private items: CartItem[] = []', '  private discount = 0'].join('\n'),
}

const WRITE_FILE = 'src/utils/money.ts'

const WRITE_GROWING = [
  'export const CENT_FACTOR = 100',
  '',
  'export function roundCents(value: number): number {',
  '  return Math.round(value * CENT_FACTOR) / CENT_FACTOR',
  '}',
  '',
  'export function formatCents(cents: number, currency = "CNY"): string {',
  '  const amount = (cents / CENT_FACTOR).toFixed(2)',
  '  return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format',
].join('\n')

// ============================================
// 冻结状态网格
// ============================================

function FrozenCard({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-200/40 bg-bg-100/60 p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium text-text-200">{title}</h3>
        <p className="text-[length:var(--fs-xs)] text-text-500">{desc}</p>
      </div>
      {children}
    </div>
  )
}

interface FrozenState {
  key: string
  title: string
  desc: string
  node: ReactNode
}

function frozenStates(): FrozenState[] {
  return [
    {
      key: 'a',
      title: '① 仅增长文本（正在打字）',
      desc: '第一个 op 的参数还在流式生成，还没有任何已完成 hunk',
      node: (
        <StreamingPreview
          previewText={[
            '  applyDiscount(percent: number): void {',
            '    if (percent < 0 || percent > 100) throw new RangeE',
          ].join('\n')}
          filePath={CART_FILE}
          stateBaseKey="playground:frozen-a"
          fullscreenBaseId="playground:frozen-a"
        />
      ),
    },
    {
      key: 'b',
      title: '② 1 个已完成 hunk + 增长文本',
      desc: 'op1 已完成（diff 卡片落定），op2 正在逐行生成',
      node: (
        <StreamingPreview
          hunks={[HUNK_TOTAL]}
          previewText={[
            '  remove(index: number): void {',
            '    this.items.splice(index, 1)',
            '  }',
            '',
            '  applyDiscount(percent: number): void {',
            '    if (percent < 0 ||',
          ].join('\n')}
          filePath={CART_FILE}
          stateBaseKey="playground:frozen-b"
          fullscreenBaseId="playground:frozen-b"
        />
      ),
    },
    {
      key: 'c',
      title: '③ 3 个已完成 hunks，无增长文本（即将完成）',
      desc: '所有 op 都已推送完毕，最后一个 op 的参数也落定，等待工具执行',
      node: (
        <StreamingPreview
          hunks={[HUNK_TOTAL, HUNK_DISCOUNT, HUNK_FIELD]}
          filePath={CART_FILE}
          stateBaseKey="playground:frozen-c"
          fullscreenBaseId="playground:frozen-c"
        />
      ),
    },
    {
      key: 'd',
      title: '④ write 工具：长内容仅增长文本',
      desc: 'write 的 content 参数在流式生成，整段新文件文本挂在一个 Preview 卡片下',
      node: (
        <StreamingPreview
          previewText={WRITE_GROWING}
          filePath={WRITE_FILE}
          language="typescript"
          stateBaseKey="playground:frozen-d"
          fullscreenBaseId="playground:frozen-d"
        />
      ),
    },
  ]
}

function FrozenGrid() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {frozenStates().map(state => (
        <FrozenCard key={state.key} title={state.title} desc={state.desc}>
          {state.node}
        </FrozenCard>
      ))}
    </div>
  )
}

// ============================================
// 实时自动播放（确定性时间线：preview 逐行增长 → op 完成 → hunk 弹出）
// ============================================

const TICK_MS = 120

type StreamEvent = { kind: 'line'; line: string } | { kind: 'hunk'; hunk: StreamingHunk }

function opTimeline(hunk: StreamingHunk): StreamEvent[] {
  return [...hunk.after.split('\n').map(line => ({ kind: 'line', line }) as StreamEvent), { kind: 'hunk', hunk }]
}

const STREAM_TIMELINE: StreamEvent[] = [...opTimeline(HUNK_TOTAL), ...opTimeline(HUNK_DISCOUNT), ...opTimeline(HUNK_FIELD)]

function projectTimeline(cursor: number) {
  const hunks: StreamingHunk[] = []
  let lines: string[] = []

  for (let i = 0; i < cursor && i < STREAM_TIMELINE.length; i++) {
    const event = STREAM_TIMELINE[i]
    if (event.kind === 'hunk') {
      hunks.push(event.hunk)
      lines = []
    } else {
      lines.push(event.line)
    }
  }

  return { hunks, previewText: lines.join('\n') }
}

function LiveStream() {
  const [cursor, setCursor] = useState(0)
  const finished = cursor >= STREAM_TIMELINE.length

  useEffect(() => {
    if (finished) return
    const timer = setTimeout(() => setCursor(current => current + 1), TICK_MS)
    return () => clearTimeout(timer)
  }, [cursor, finished])

  const { hunks, previewText } = projectTimeline(cursor)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[length:var(--fs-xs)] font-mono ${
            finished ? 'bg-success-100/15 text-success-100' : 'bg-accent-main-100/15 text-accent-main-100'
          }`}
        >
          {finished ? '完成' : '流式生成中…'}
        </span>
        <span className="text-[length:var(--fs-xs)] text-text-500">
          {Math.min(cursor, STREAM_TIMELINE.length)}/{STREAM_TIMELINE.length} tick · {TICK_MS}ms/tick
        </span>
        <button
          type="button"
          onClick={() => setCursor(0)}
          className="rounded-md border border-border-200/40 bg-bg-200/60 px-3 py-1 text-[length:var(--fs-xs)] text-text-300 hover:bg-bg-200"
        >
          重播
        </button>
      </div>
      <StreamingPreview
        hunks={hunks}
        previewText={previewText || undefined}
        filePath={CART_FILE}
        stateBaseKey="playground:live"
        fullscreenBaseId="playground:live"
      />
    </div>
  )
}

// ============================================
// 页面
// ============================================

const COLOR_MODES: Array<{ mode: ColorMode; label: string }> = [
  { mode: 'system', label: '跟随系统' },
  { mode: 'light', label: '亮色' },
  { mode: 'dark', label: '暗色' },
]

function Playground() {
  // ?only=a|b|c|d|live 时单状态全宽渲染，便于确定性截图走查
  const only = new URLSearchParams(window.location.search).get('only')
  const single = only ? frozenStates().find(state => state.key === only) : undefined

  if (single) {
    return (
      <div className="min-h-screen bg-bg-000 text-text-300">
        <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
          <FrozenCard title={single.title} desc={single.desc}>
            {single.node}
          </FrozenCard>
        </main>
      </div>
    )
  }

  if (only === 'live') {
    return (
      <div className="min-h-screen bg-bg-000 text-text-300">
        <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
          <LiveStream />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-000 text-text-300">
      <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-[length:var(--fs-heading-2)] font-semibold text-text-100">
            StreamingPreview 视觉走查
          </h1>
          <p className="text-[length:var(--fs-sm)] text-text-400">
            工具参数流式生成期间的预览卡片（已完成 op 的逐 hunk diff + 正在增长的 Preview）。
            本页仅 dev 可用：<code className="font-mono text-text-300">/playground.html</code>
            ，不连接任何后端服务。
          </p>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[length:var(--fs-xs)] text-text-500">主题</span>
            {COLOR_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => themeStore.setColorMode(mode)}
                className="rounded-md border border-border-200/40 bg-bg-100 px-2.5 py-0.5 text-[length:var(--fs-xs)] text-text-300 hover:bg-bg-200"
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-[length:var(--fs-heading-3)] font-medium text-text-100">冻结状态</h2>
          <FrozenGrid />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-[length:var(--fs-heading-3)] font-medium text-text-100">实时流式模拟</h2>
          <LiveStream />
        </section>
      </main>
    </div>
  )
}

createRoot(document.getElementById('playground-root')!).render(
  <FullscreenProvider>
    <Playground />
  </FullscreenProvider>,
)
