/**
 * 主题状态管理 Store（内核）
 *
 * 管理：
 * - 主题风格选择（内置预设）
 * - 日夜模式（system / light / dark）
 * - 自定义 CSS 覆盖（可用于覆盖字体等）
 * - CSS 变量注入
 *
 * 本文件只保留共享状态骨架（state / 订阅 / emit / DOM 样式注入）与模块级 API；
 * 职责方法按 slice 拆分到同目录文件，通过 prototype 混入：
 *   - themeStore.theme.ts       主题预设 / 日夜模式 / 主题应用
 *   - themeStore.settings.ts    各偏好读写 + 自定义 CSS 方案管理
 *   - themeStore.persistence.ts 启动时状态恢复
 * slice 之间不互相 import；共享类型见 themeStore.types.ts，纯函数见 themeStore.utils.ts。
 */
import { getThemePreset, DEFAULT_THEME_ID } from '../themes'
import type { WebUIPreferences } from '../types/api/preferences'
import {
  DEFAULT_REASONING_DISPLAY_MODE,
  DEFAULT_RENDER_USER_MARKDOWN,
  STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID,
  STORAGE_KEY_CODE_BLOCK_THEME_DARK,
  STORAGE_KEY_CODE_BLOCK_THEME_LIGHT,
  STORAGE_KEY_CODE_FONT_SCALE,
  STORAGE_KEY_CODE_WORD_WRAP,
  STORAGE_KEY_COLLAPSE_USER_MESSAGES,
  STORAGE_KEY_COMPACT_INLINE_PERMISSION,
  STORAGE_KEY_COMPLETED_AT_FORMAT,
  STORAGE_KEY_COLOR_MODE,
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
  STORAGE_KEY_PRESET,
  STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES,
  STORAGE_KEY_REASONING_DISPLAY_MODE,
  STORAGE_KEY_RENDER_USER_MARKDOWN,
  STORAGE_KEY_STEP_FINISH_DISPLAY,
  STORAGE_KEY_TOOL_CARD_STYLE,
  STORAGE_KEY_WIDE_MODE,
  STYLE_ID_CUSTOM,
  STYLE_ID_FONT_SCALE,
  normalizeThemeBackup,
} from './themeStore.utils'
import type { ColorMode, ThemeBackup, ThemeState } from './themeStore.types'
import { themeMethods, type ThemeSlice } from './themeStore.theme'
import { settingsMethods, type SettingsSlice } from './themeStore.settings'
import { restoreThemeState } from './themeStore.persistence'

export type {
  ColorMode,
  CustomCSSSnippet,
  StepFinishDisplay,
  CompletedAtFormat,
  ReasoningDisplayMode,
  DiffStyle,
  ToolCardStyle,
  ExternalFileDropMode,
  ThemeState,
  ThemeBackup,
} from './themeStore.types'
export { FONT_SCALE_MIN, FONT_SCALE_MAX } from './themeStore.utils'

// ============================================
// Store Implementation
// ============================================

export interface ThemeStore extends ThemeSlice, SettingsSlice {}

export class ThemeStore {
  state: ThemeState
  private listeners = new Set<() => void>()

  constructor() {
    this.state = restoreThemeState()
  }

  // ---- Getters ----

  getState(): ThemeState {
    return this.state
  }

  getWebUIPreferences(): WebUIPreferences {
    return {
      appearance: {
        presetId: this.state.presetId,
        colorMode: this.state.colorMode,
      },
      chat: {
        collapseUserMessages: this.state.collapseUserMessages,
        renderUserMarkdown: this.state.renderUserMarkdown,
        reasoningDisplayMode: this.state.reasoningDisplayMode,
      },
    }
  }

  applyWebUIPreferences(preferences: WebUIPreferences, colorModeOverride?: ColorMode) {
    const presetId =
      typeof preferences.appearance?.presetId === 'string' && getThemePreset(preferences.appearance.presetId)
        ? preferences.appearance.presetId
        : DEFAULT_THEME_ID
    const sharedColorMode = preferences.appearance?.colorMode
    const colorMode =
      colorModeOverride ??
      (sharedColorMode === 'light' || sharedColorMode === 'dark' || sharedColorMode === 'system' ? sharedColorMode : 'system')
    const collapseUserMessages = preferences.chat?.collapseUserMessages ?? true
    const renderUserMarkdown = preferences.chat?.renderUserMarkdown ?? DEFAULT_RENDER_USER_MARKDOWN
    const reasoningDisplayMode =
      preferences.chat?.reasoningDisplayMode === 'italic' || preferences.chat?.reasoningDisplayMode === 'markdown'
        ? preferences.chat.reasoningDisplayMode
        : DEFAULT_REASONING_DISPLAY_MODE

    if (
      this.state.presetId === presetId &&
      this.state.colorMode === colorMode &&
      this.state.collapseUserMessages === collapseUserMessages &&
      this.state.renderUserMarkdown === renderUserMarkdown &&
      this.state.reasoningDisplayMode === reasoningDisplayMode
    ) {
      return
    }

    const themeChanged = this.state.presetId !== presetId || this.state.colorMode !== colorMode
    this.state = {
      ...this.state,
      presetId,
      colorMode,
      collapseUserMessages,
      renderUserMarkdown,
      reasoningDisplayMode,
    }
    localStorage.setItem(STORAGE_KEY_PRESET, presetId)
    localStorage.setItem(STORAGE_KEY_COLOR_MODE, colorMode)
    localStorage.setItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(collapseUserMessages))
    localStorage.setItem(STORAGE_KEY_RENDER_USER_MARKDOWN, String(renderUserMarkdown))
    localStorage.setItem(STORAGE_KEY_REASONING_DISPLAY_MODE, reasoningDisplayMode)
    if (themeChanged) this.applyTheme()
    this.emit()
  }

  // ---- DOM 样式注入 ----

  /**
   * 字号偏移覆盖。
   * 两个维度均为 0 时不注入覆盖，直接用 index.css :root 里的默认值。
   * 非零时通过 :root:root 高优先级覆盖 --fs-* 变量。
   *
   * 基准值（偏移 0）：
   *   UI:   xxs=11  xs=12  sm=13  md=13  base=14  lg=16
   *         heading-3=16  heading-2=18  heading-1=20
   *   Code: code=13  code-line-height=24  terminal=13  terminal-line-height=1.4
   */
  applyFontScale() {
    const { uiFontScale: ui, codeFontScale: code } = this.state
    let el = document.getElementById(STYLE_ID_FONT_SCALE) as HTMLStyleElement | null

    if (ui === 0 && code === 0) {
      if (el) el.remove()
      return
    }

    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_FONT_SCALE
      document.head.appendChild(el)
    }

    const vars: string[] = []

    if (ui !== 0) {
      vars.push(
        `--fs-xxs: ${11 + ui}px`,
        `--fs-xs: ${12 + ui}px`,
        `--fs-sm: ${13 + ui}px`,
        `--fs-md: ${13 + ui}px`,
        `--fs-base: ${14 + ui}px`,
        `--fs-lg: ${16 + ui}px`,
        `--fs-heading-3: ${16 + ui}px`,
        `--fs-heading-2: ${18 + ui}px`,
        `--fs-heading-1: ${20 + ui}px`,
      )
    }

    if (code !== 0) {
      const codePx = 13 + code
      // 行高 = 基准 24 + 偏移 * 2（每 1px 字号对应 2px 行高增量）
      const lineH = 24 + code * 2
      const termPx = 13 + code
      const termLH = Math.round((1.4 + code * 0.05) * 100) / 100
      vars.push(
        `--fs-code: ${codePx}px`,
        `--fs-code-line-height: ${lineH}px`,
        `--fs-terminal: ${termPx}px`,
        `--fs-terminal-line-height: ${termLH}`,
      )
    }

    el.textContent = `:root:root {\n  ${vars.join(';\n  ')};\n}`
  }

  applyCustomCSS() {
    const css = this.state.customCSS.trim()
    let el = document.getElementById(STYLE_ID_CUSTOM) as HTMLStyleElement | null

    if (!css) {
      if (el) el.remove()
      return
    }

    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_CUSTOM
      document.head.appendChild(el)
    }
    el.textContent = css
  }

  /** 毛玻璃开关：data-glass 属性驱动 CSS */
  applyGlassClass() {
    const root = document.documentElement
    if (this.state.glassEffect) {
      root.setAttribute('data-glass', '')
    } else {
      root.removeAttribute('data-glass')
    }
  }

  // ---- Subscription (useSyncExternalStore compatible) ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ThemeState => {
    return this.state
  }

  emit() {
    this.listeners.forEach(fn => fn())
  }
}

Object.defineProperties(ThemeStore.prototype, Object.getOwnPropertyDescriptors(themeMethods))
Object.defineProperties(ThemeStore.prototype, Object.getOwnPropertyDescriptors(settingsMethods))

// Singleton
export const themeStore = new ThemeStore()

export function exportThemeBackup(): ThemeBackup {
  const state = themeStore.getState()
  return {
    ...state,
    customCSSSnippets: state.customCSSSnippets.map(item => ({ ...item })),
    stepFinishDisplay: { ...state.stepFinishDisplay },
  }
}

export function importThemeBackup(raw: unknown): void {
  const backup = normalizeThemeBackup(raw)
  localStorage.setItem(STORAGE_KEY_PRESET, backup.presetId)
  localStorage.setItem(STORAGE_KEY_COLOR_MODE, backup.colorMode)
  localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, backup.customCSS)
  localStorage.setItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS, JSON.stringify(backup.customCSSSnippets))
  if (backup.activeCustomCSSSnippetId) {
    localStorage.setItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID, backup.activeCustomCSSSnippetId)
  } else {
    localStorage.removeItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
  }
  localStorage.setItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES, String(backup.collapseUserMessages))
  localStorage.setItem(STORAGE_KEY_RENDER_USER_MARKDOWN, String(backup.renderUserMarkdown))
  localStorage.setItem(STORAGE_KEY_STEP_FINISH_DISPLAY, JSON.stringify(backup.stepFinishDisplay))
  localStorage.setItem(STORAGE_KEY_COMPLETED_AT_FORMAT, backup.completedAtFormat)
  localStorage.setItem(STORAGE_KEY_REASONING_DISPLAY_MODE, backup.reasoningDisplayMode)
  localStorage.setItem(STORAGE_KEY_WIDE_MODE, String(backup.wideMode))
  localStorage.setItem(STORAGE_KEY_DIFF_STYLE, backup.diffStyle)
  localStorage.setItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS, String(backup.descriptiveToolSteps))
  localStorage.setItem(STORAGE_KEY_INLINE_TOOL_REQUESTS, String(backup.inlineToolRequests))
  localStorage.setItem(STORAGE_KEY_CODE_WORD_WRAP, String(backup.codeWordWrap))
  localStorage.setItem(STORAGE_KEY_FONT_SCALE, String(backup.uiFontScale))
  localStorage.setItem(STORAGE_KEY_CODE_FONT_SCALE, String(backup.codeFontScale))
  localStorage.setItem(STORAGE_KEY_TOOL_CARD_STYLE, backup.toolCardStyle)
  localStorage.setItem(STORAGE_KEY_IMMERSIVE_MODE, String(backup.immersiveMode))
  localStorage.setItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION, String(backup.compactInlinePermission))
  localStorage.setItem(STORAGE_KEY_GLASS_EFFECT, String(backup.glassEffect))
  localStorage.setItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES, String(backup.queueFollowupMessages))
  localStorage.setItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES, String(backup.manualTerminalTitles))
  localStorage.setItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE, backup.externalFileDropMode)
  localStorage.setItem(STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT, String(backup.outlineCurrentHighlight))
  localStorage.setItem(STORAGE_KEY_CODE_BLOCK_THEME_LIGHT, backup.codeBlockThemeLight)
  localStorage.setItem(STORAGE_KEY_CODE_BLOCK_THEME_DARK, backup.codeBlockThemeDark)
}