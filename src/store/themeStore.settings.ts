// ============================================
// ThemeStore - Settings slice
// 各偏好读取/写入 + 自定义 CSS 方案管理
// ============================================
import type {
  CompletedAtFormat,
  CustomCSSSnippet,
  DiffStyle,
  ExternalFileDropMode,
  ReasoningDisplayMode,
  StepFinishDisplay,
  ToolCardStyle,
} from './themeStore.types'
import {
  STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID,
  STORAGE_KEY_CODE_BLOCK_THEME_DARK,
  STORAGE_KEY_CODE_BLOCK_THEME_LIGHT,
  STORAGE_KEY_CODE_FONT_SCALE,
  STORAGE_KEY_CODE_WORD_WRAP,
  STORAGE_KEY_COLLAPSE_USER_MESSAGES,
  STORAGE_KEY_COMPACT_INLINE_PERMISSION,
  STORAGE_KEY_COMPLETED_AT_FORMAT,
  STORAGE_KEY_CUSTOM_CSS,
  STORAGE_KEY_CUSTOM_CSS_SNIPPETS,
  STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS,
  STORAGE_KEY_DIFF_STYLE,
  STORAGE_KEY_EXTERNAL_FILE_DROP_MODE,
  STORAGE_KEY_FONT_SCALE,
  STORAGE_KEY_GLASS_EFFECT,
  STORAGE_KEY_IMMERSIVE_MODE,
  STORAGE_KEY_INLINE_TOOL_REQUESTS,
  STORAGE_KEY_MANUAL_TERMINAL_TITLES,
  STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT,
  STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES,
  STORAGE_KEY_REASONING_DISPLAY_MODE,
  STORAGE_KEY_RENDER_USER_MARKDOWN,
  STORAGE_KEY_STEP_FINISH_DISPLAY,
  STORAGE_KEY_TOOL_CARD_STYLE,
  STORAGE_KEY_WIDE_MODE,
  clampFontScale,
} from './themeStore.utils'
import type { ThemeStore } from './themeStore'

export interface SettingsSlice {
  readonly customCSS: string
  readonly customCSSSnippets: CustomCSSSnippet[]
  readonly activeCustomCSSSnippetId: string | null
  readonly collapseUserMessages: boolean
  readonly renderUserMarkdown: boolean
  readonly stepFinishDisplay: StepFinishDisplay
  readonly completedAtFormat: CompletedAtFormat
  readonly reasoningDisplayMode: ReasoningDisplayMode
  readonly wideMode: boolean
  readonly diffStyle: DiffStyle
  readonly descriptiveToolSteps: boolean
  readonly inlineToolRequests: boolean
  readonly codeWordWrap: boolean
  readonly uiFontScale: number
  readonly codeFontScale: number
  readonly toolCardStyle: ToolCardStyle
  readonly immersiveMode: boolean
  readonly compactInlinePermission: boolean
  readonly glassEffect: boolean
  readonly queueFollowupMessages: boolean
  readonly manualTerminalTitles: boolean
  readonly externalFileDropMode: ExternalFileDropMode
  readonly outlineCurrentHighlight: boolean
  readonly codeBlockThemeLight: string
  readonly codeBlockThemeDark: string
  setCustomCSS(css: string): void
  saveCustomCSSSnippet(name: string, css: string): CustomCSSSnippet
  updateCustomCSSSnippet(id: string, updates: Partial<Pick<CustomCSSSnippet, 'name' | 'css'>>): void
  deleteCustomCSSSnippet(id: string): void
  applyCustomCSSSnippet(id: string): void
  clearActiveCustomCSSSnippet(): void
  setCollapseUserMessages(enabled: boolean): void
  setRenderUserMarkdown(enabled: boolean): void
  setStepFinishDisplay(display: Partial<StepFinishDisplay>): void
  setCompletedAtFormat(format: CompletedAtFormat): void
  setReasoningDisplayMode(mode: ReasoningDisplayMode): void
  setWideMode(enabled: boolean): void
  toggleWideMode(): void
  setDiffStyle(style: DiffStyle): void
  setDescriptiveToolSteps(enabled: boolean): void
  setInlineToolRequests(enabled: boolean): void
  setCodeWordWrap(enabled: boolean): void
  setUIFontScale(scale: number): void
  setCodeFontScale(scale: number): void
  setToolCardStyle(style: ToolCardStyle): void
  setImmersiveMode(enabled: boolean): void
  setCompactInlinePermission(enabled: boolean): void
  setGlassEffect(enabled: boolean): void
  setQueueFollowupMessages(enabled: boolean): void
  setManualTerminalTitles(enabled: boolean): void
  setExternalFileDropMode(mode: ExternalFileDropMode): void
  setOutlineCurrentHighlight(enabled: boolean): void
  setCodeBlockThemeLight(id: string): void
  setCodeBlockThemeDark(id: string): void
  persistCustomCSSSnippets(customCSSSnippets: CustomCSSSnippet[]): void
}

export const settingsMethods: SettingsSlice & ThisType<ThemeStore> = {
  get customCSS() {
    return this.state.customCSS
  },
  get customCSSSnippets() {
    return this.state.customCSSSnippets
  },
  get activeCustomCSSSnippetId() {
    return this.state.activeCustomCSSSnippetId
  },
  get collapseUserMessages() {
    return this.state.collapseUserMessages
  },
  get renderUserMarkdown() {
    return this.state.renderUserMarkdown
  },
  get stepFinishDisplay() {
    return this.state.stepFinishDisplay
  },
  get completedAtFormat() {
    return this.state.completedAtFormat
  },
  get reasoningDisplayMode() {
    return this.state.reasoningDisplayMode
  },
  get wideMode() {
    return this.state.wideMode
  },
  get diffStyle() {
    return this.state.diffStyle
  },
  get descriptiveToolSteps() {
    return this.state.descriptiveToolSteps
  },
  get inlineToolRequests() {
    return this.state.inlineToolRequests
  },
  get codeWordWrap() {
    return this.state.codeWordWrap
  },
  get uiFontScale() {
    return this.state.uiFontScale
  },
  get codeFontScale() {
    return this.state.codeFontScale
  },
  get toolCardStyle() {
    return this.state.toolCardStyle
  },
  get immersiveMode() {
    return this.state.immersiveMode
  },
  get compactInlinePermission() {
    return this.state.compactInlinePermission
  },
  get glassEffect() {
    return this.state.glassEffect
  },
  get queueFollowupMessages() {
    return this.state.queueFollowupMessages
  },
  get manualTerminalTitles() {
    return this.state.manualTerminalTitles
  },
  get externalFileDropMode() {
    return this.state.externalFileDropMode
  },
  get outlineCurrentHighlight() {
    return this.state.outlineCurrentHighlight
  },
  get codeBlockThemeLight() {
    return this.state.codeBlockThemeLight
  },
  get codeBlockThemeDark() {
    return this.state.codeBlockThemeDark
  },

  setCustomCSS(css) {
    this.state = { ...this.state, customCSS: css }
    localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, css)
    this.applyCustomCSS()
    this.emit()
  },

  saveCustomCSSSnippet(name, css) {
    const now = Date.now()
    const snippet: CustomCSSSnippet = {
      id: `css-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      css,
      createdAt: now,
      updatedAt: now,
    }

    const customCSSSnippets = [...this.state.customCSSSnippets, snippet]
    this.state = { ...this.state, customCSSSnippets, activeCustomCSSSnippetId: snippet.id }
    this.persistCustomCSSSnippets(customCSSSnippets)
    localStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, snippet.id)
    this.emit()
    return snippet
  },

  updateCustomCSSSnippet(id, updates) {
    const customCSSSnippets = this.state.customCSSSnippets.map(item =>
      item.id === id ? { ...item, ...updates, updatedAt: Date.now() } : item,
    )

    this.state = { ...this.state, customCSSSnippets }
    this.persistCustomCSSSnippets(customCSSSnippets)
    this.emit()
  },

  deleteCustomCSSSnippet(id) {
    const customCSSSnippets = this.state.customCSSSnippets.filter(item => item.id !== id)
    const activeCustomCSSSnippetId =
      this.state.activeCustomCSSSnippetId === id ? null : this.state.activeCustomCSSSnippetId

    this.state = { ...this.state, customCSSSnippets, activeCustomCSSSnippetId }
    this.persistCustomCSSSnippets(customCSSSnippets)

    if (activeCustomCSSSnippetId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, activeCustomCSSSnippetId)
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    }

    this.emit()
  },

  applyCustomCSSSnippet(id) {
    const snippet = this.state.customCSSSnippets.find(item => item.id === id)
    if (!snippet) return

    this.state = {
      ...this.state,
      customCSS: snippet.css,
      activeCustomCSSSnippetId: id,
    }

    localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, snippet.css)
    localStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, id)
    this.applyCustomCSS()
    this.emit()
  },

  clearActiveCustomCSSSnippet() {
    if (this.state.activeCustomCSSSnippetId === null) return
    this.state = { ...this.state, activeCustomCSSSnippetId: null }
    localStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
    this.emit()
  },

  setCollapseUserMessages(enabled) {
    if (this.state.collapseUserMessages === enabled) return
    this.state = { ...this.state, collapseUserMessages: enabled }
    localStorage.setItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(enabled))
    this.emit()
  },

  setRenderUserMarkdown(enabled) {
    if (this.state.renderUserMarkdown === enabled) return
    this.state = { ...this.state, renderUserMarkdown: enabled }
    localStorage.setItem(STORAGE_KEY_RENDER_USER_MARKDOWN, String(enabled))
    this.emit()
  },

  setStepFinishDisplay(display) {
    const next = { ...this.state.stepFinishDisplay, ...display }
    this.state = { ...this.state, stepFinishDisplay: next }
    localStorage.setItem(STORAGE_KEY_STEP_FINISH_DISPLAY, JSON.stringify(next))
    this.emit()
  },

  setCompletedAtFormat(format) {
    if (this.state.completedAtFormat === format) return
    this.state = { ...this.state, completedAtFormat: format }
    localStorage.setItem(STORAGE_KEY_COMPLETED_AT_FORMAT, format)
    this.emit()
  },

  setReasoningDisplayMode(mode) {
    if (this.state.reasoningDisplayMode === mode) return
    this.state = { ...this.state, reasoningDisplayMode: mode }
    localStorage.setItem(STORAGE_KEY_REASONING_DISPLAY_MODE, mode)
    this.emit()
  },

  setWideMode(enabled) {
    if (this.state.wideMode === enabled) return
    this.state = { ...this.state, wideMode: enabled }
    localStorage.setItem(STORAGE_KEY_WIDE_MODE, String(enabled))
    this.emit()
  },

  toggleWideMode() {
    this.setWideMode(!this.state.wideMode)
  },

  setDiffStyle(style) {
    if (this.state.diffStyle === style) return
    this.state = { ...this.state, diffStyle: style }
    localStorage.setItem(STORAGE_KEY_DIFF_STYLE, style)
    this.emit()
  },

  setDescriptiveToolSteps(enabled) {
    if (this.state.descriptiveToolSteps === enabled) return
    this.state = { ...this.state, descriptiveToolSteps: enabled }
    localStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(enabled))
    this.emit()
  },

  setInlineToolRequests(enabled) {
    if (this.state.inlineToolRequests === enabled) return
    this.state = { ...this.state, inlineToolRequests: enabled }
    localStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(enabled))
    this.emit()
  },

  setCodeWordWrap(enabled) {
    if (this.state.codeWordWrap === enabled) return
    this.state = { ...this.state, codeWordWrap: enabled }
    localStorage.setItem(STORAGE_KEY_CODE_WORD_WRAP, String(enabled))
    this.emit()
  },

  setUIFontScale(scale) {
    const clamped = clampFontScale(scale)
    if (this.state.uiFontScale === clamped) return
    this.state = { ...this.state, uiFontScale: clamped }
    localStorage.setItem(STORAGE_KEY_FONT_SCALE, String(clamped))
    this.applyFontScale()
    this.emit()
  },

  setCodeFontScale(scale) {
    const clamped = clampFontScale(scale)
    if (this.state.codeFontScale === clamped) return
    this.state = { ...this.state, codeFontScale: clamped }
    localStorage.setItem(STORAGE_KEY_CODE_FONT_SCALE, String(clamped))
    this.applyFontScale()
    this.emit()
  },

  setToolCardStyle(style) {
    if (this.state.toolCardStyle === style) return
    this.state = { ...this.state, toolCardStyle: style }
    localStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, style)
    this.emit()
  },

  setImmersiveMode(enabled) {
    if (this.state.immersiveMode === enabled) return
    this.state = {
      ...this.state,
      immersiveMode: enabled,
      // 联动四个子功能
      inlineToolRequests: enabled,
      descriptiveToolSteps: enabled,
      toolCardStyle: enabled ? 'compact' : 'classic',
      compactInlinePermission: enabled,
    }
    localStorage.setItem(STORAGE_KEY_IMMERSIVE_MODE, String(enabled))
    localStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(enabled))
    localStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(enabled))
    localStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, enabled ? 'compact' : 'classic')
    localStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(enabled))
    this.emit()
  },

  setCompactInlinePermission(enabled) {
    if (this.state.compactInlinePermission === enabled) return
    this.state = { ...this.state, compactInlinePermission: enabled }
    localStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(enabled))
    this.emit()
  },

  setGlassEffect(enabled) {
    if (this.state.glassEffect === enabled) return
    this.state = { ...this.state, glassEffect: enabled }
    localStorage.setItem(STORAGE_KEY_GLASS_EFFECT, String(enabled))
    this.applyGlassClass()
    this.emit()
  },

  setQueueFollowupMessages(enabled) {
    if (this.state.queueFollowupMessages === enabled) return
    this.state = { ...this.state, queueFollowupMessages: enabled }
    localStorage.setItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES, String(enabled))
    this.emit()
  },

  setManualTerminalTitles(enabled) {
    if (this.state.manualTerminalTitles === enabled) return
    this.state = { ...this.state, manualTerminalTitles: enabled }
    localStorage.setItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES, String(enabled))
    this.emit()
  },

  setExternalFileDropMode(mode) {
    if (this.state.externalFileDropMode === mode) return
    this.state = { ...this.state, externalFileDropMode: mode }
    localStorage.setItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE, mode)
    this.emit()
  },

  setOutlineCurrentHighlight(enabled) {
    if (this.state.outlineCurrentHighlight === enabled) return
    this.state = { ...this.state, outlineCurrentHighlight: enabled }
    localStorage.setItem(STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT, String(enabled))
    this.emit()
  },

  setCodeBlockThemeLight(id) {
    if (this.state.codeBlockThemeLight === id) return
    this.state = { ...this.state, codeBlockThemeLight: id }
    localStorage.setItem(STORAGE_KEY_CODE_BLOCK_THEME_LIGHT, id)
    this.emit()
  },

  setCodeBlockThemeDark(id) {
    if (this.state.codeBlockThemeDark === id) return
    this.state = { ...this.state, codeBlockThemeDark: id }
    localStorage.setItem(STORAGE_KEY_CODE_BLOCK_THEME_DARK, id)
    this.emit()
  },

  persistCustomCSSSnippets(customCSSSnippets) {
    localStorage.setItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS, JSON.stringify(customCSSSnippets))
  },
}