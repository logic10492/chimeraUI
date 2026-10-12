export type ColorMode = 'system' | 'light' | 'dark'

export interface CustomCSSSnippet {
  id: string
  name: string
  css: string
  createdAt: number
  updatedAt: number
}

/** step-finish 信息栏各项显示开关 */
export interface StepFinishDisplay {
  tokens: boolean
  cache: boolean
  cost: boolean
  duration: boolean
  turnDuration: boolean
  agent: boolean
  model: boolean
  completedAt: boolean
}

export type CompletedAtFormat = 'time' | 'dateTime'

export type ReasoningDisplayMode = 'capsule' | 'italic' | 'markdown'

export type ExternalFileDropMode = 'upload-first' | 'mention'

/** Diff 行标记风格：markers = 传统 +/- 符号, changeBars = 行号左侧彩色竖条 */
export type DiffStyle = 'markers' | 'changeBars'

/** 工具输出渲染风格：classic = 经典（input+output 分离），compact = 精简（只展示 output，header 更矮） */
export type ToolCardStyle = 'classic' | 'compact'

export interface ThemeState {
  /** 当前选中的主题风格 ID */
  presetId: string
  /** 日夜模式 */
  colorMode: ColorMode
  /** 用户自定义 CSS（覆盖 CSS 变量） */
  customCSS: string
  /** 已保存的自定义 CSS 方案 */
  customCSSSnippets: CustomCSSSnippet[]
  /** 当前选中的已保存方案 ID；仅用于切换/保存，不直接决定渲染 */
  activeCustomCSSSnippetId: string | null
  /** 是否自动折叠长用户消息 */
  collapseUserMessages: boolean
  /** 是否将用户消息渲染为 Markdown */
  renderUserMarkdown: boolean
  /** step-finish 信息栏显示开关 */
  stepFinishDisplay: StepFinishDisplay
  /** 完成时刻显示格式 */
  completedAtFormat: CompletedAtFormat
  /** 思考内容展示样式 */
  reasoningDisplayMode: ReasoningDisplayMode
  /** 宽模式 */
  wideMode: boolean
  /** Diff 行标记风格 */
  diffStyle: DiffStyle
  /** 是否启用带工具描述的 steps 摘要 */
  descriptiveToolSteps: boolean
  /** 是否在工具下方内嵌权限/提问请求 */
  inlineToolRequests: boolean
  /** 代码块/diff 自动换行 */
  codeWordWrap: boolean
  /** UI 字号偏移 (px)，0 = 基准 */
  uiFontScale: number
  /** 代码 / diff / 终端字号偏移 (px)，0 = 基准 */
  codeFontScale: number
  /** 工具输出渲染风格 */
  toolCardStyle: ToolCardStyle
  /** 沉浸模式 */
  immersiveMode: boolean
  /** 内嵌权限精简模式：ToolBody 有内容时只显示操作按钮 */
  compactInlinePermission: boolean
  /** 毛玻璃效果开关（backdrop-filter blur） */
  glassEffect: boolean
  /** 忙碌时后续消息是否进入队列 */
  queueFollowupMessages: boolean
  /** 终端标签是否改为手动命名模式 */
  manualTerminalTitles: boolean
  /** 外部文件拖入输入框时的处理方式 */
  externalFileDropMode: ExternalFileDropMode
  /** 是否在对话历史导航中高亮当前对话位置 */
  outlineCurrentHighlight: boolean
  /** 代码块语法高亮主题（亮色模式），Shiki theme id */
  codeBlockThemeLight: string
  /** 代码块语法高亮主题（暗色模式），Shiki theme id */
  codeBlockThemeDark: string
}

export type ThemeBackup = ThemeState