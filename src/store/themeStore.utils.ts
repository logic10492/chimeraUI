import { getThemePreset, DEFAULT_THEME_ID } from '../themes'
import type {
  CompletedAtFormat,
  CustomCSSSnippet,
  DiffStyle,
  ExternalFileDropMode,
  ReasoningDisplayMode,
  StepFinishDisplay,
  ThemeBackup,
  ToolCardStyle,
} from './themeStore.types'

/**
 * 字号偏移范围：-2 ~ +4（相对于基准值的 px 偏移）
 * 0 = 基准值（index.css 中定义的默认值）
 */
export const FONT_SCALE_MIN = -2
export const FONT_SCALE_MAX = 4

export function clampFontScale(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, n)))
}

export const DEFAULT_STEP_FINISH_DISPLAY: StepFinishDisplay = {
  tokens: true,
  cache: true,
  cost: true,
  duration: true,
  turnDuration: true,
  agent: false,
  model: false,
  completedAt: false,
}

export const DEFAULT_COMPLETED_AT_FORMAT: CompletedAtFormat = 'time'

export const DEFAULT_REASONING_DISPLAY_MODE: ReasoningDisplayMode = 'capsule'
export const DEFAULT_RENDER_USER_MARKDOWN = false
export const DEFAULT_DIFF_STYLE: DiffStyle = 'markers'
export const DEFAULT_DESCRIPTIVE_TOOL_STEPS = false
export const DEFAULT_INLINE_TOOL_REQUESTS = false
export const DEFAULT_CODE_WORD_WRAP = false
export const DEFAULT_UI_FONT_SCALE = 0
export const DEFAULT_CODE_FONT_SCALE = 0
export const DEFAULT_TOOL_CARD_STYLE: ToolCardStyle = 'classic'
export const DEFAULT_IMMERSIVE_MODE = false
export const DEFAULT_COMPACT_INLINE_PERMISSION = false
export const DEFAULT_GLASS_EFFECT = true
export const DEFAULT_QUEUE_FOLLOWUP_MESSAGES = false
export const DEFAULT_MANUAL_TERMINAL_TITLES = false
export const DEFAULT_EXTERNAL_FILE_DROP_MODE: ExternalFileDropMode = 'upload-first'
/** Shiki 代码块主题：默认 GitHub，保留现有行为 */
export const DEFAULT_CODE_BLOCK_THEME_LIGHT = 'github-light-default'
export const DEFAULT_CODE_BLOCK_THEME_DARK = 'github-dark-default'
export const DEFAULT_OUTLINE_CURRENT_HIGHLIGHT = true

// ============================================
// Storage Keys
// ============================================

export const STORAGE_KEY_PRESET = 'theme-preset'
export const STORAGE_KEY_COLOR_MODE = 'theme-mode'
export const STORAGE_KEY_CUSTOM_CSS = 'theme-custom-css'
export const STORAGE_KEY_CUSTOM_CSS_SNIPPETS = 'theme-custom-css-snippets'
export const STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID = 'theme-active-custom-css-snippet-id'
export const STORAGE_KEY_COLLAPSE_USER_MESSAGES = 'collapse-user-messages'
export const STORAGE_KEY_RENDER_USER_MARKDOWN = 'render-user-markdown'
export const STORAGE_KEY_STEP_FINISH_DISPLAY = 'step-finish-display'
export const STORAGE_KEY_COMPLETED_AT_FORMAT = 'completed-at-format'
export const STORAGE_KEY_REASONING_DISPLAY_MODE = 'reasoning-display-mode'
export const STORAGE_KEY_WIDE_MODE = 'chat-wide-mode'
export const STORAGE_KEY_DIFF_STYLE = 'diff-style'
export const STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS = 'descriptive-tool-steps'
export const STORAGE_KEY_INLINE_TOOL_REQUESTS = 'inline-tool-requests'
export const STORAGE_KEY_CODE_WORD_WRAP = 'code-word-wrap'
export const STORAGE_KEY_FONT_SCALE = 'font-scale'
export const STORAGE_KEY_CODE_FONT_SCALE = 'code-font-scale'
export const STORAGE_KEY_TOOL_CARD_STYLE = 'tool-card-style'
export const STORAGE_KEY_IMMERSIVE_MODE = 'immersive-mode'
export const STORAGE_KEY_COMPACT_INLINE_PERMISSION = 'compact-inline-permission'
export const STORAGE_KEY_GLASS_EFFECT = 'glass-effect'
export const STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES = 'queue-followup-messages'
export const STORAGE_KEY_MANUAL_TERMINAL_TITLES = 'manual-terminal-titles'
export const STORAGE_KEY_EXTERNAL_FILE_DROP_MODE = 'external-file-drop-mode'
export const STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT = 'outline-current-highlight'
export const STORAGE_KEY_CODE_BLOCK_THEME_LIGHT = 'code-block-theme-light'
export const STORAGE_KEY_CODE_BLOCK_THEME_DARK = 'code-block-theme-dark'

// ============================================
// DOM Style Element IDs
// ============================================

export const STYLE_ID_THEME = 'opencode-theme-vars'
export const STYLE_ID_FONT_SCALE = 'opencode-font-scale'
export const STYLE_ID_CUSTOM = 'opencode-custom-css'

export function parseCustomCSSSnippets(raw: string | null): CustomCSSSnippet[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (item): item is CustomCSSSnippet =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.css === 'string' &&
        typeof item.createdAt === 'number' &&
        typeof item.updatedAt === 'number',
    )
  } catch {
    return []
  }
}

export function normalizeThemeBackup(raw: unknown): ThemeBackup {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const customCSSSnippets = parseCustomCSSSnippets(
    JSON.stringify(Array.isArray(parsed?.customCSSSnippets) ? parsed.customCSSSnippets : []),
  )
  const activeCustomCSSSnippetId =
    typeof parsed?.activeCustomCSSSnippetId === 'string' &&
    customCSSSnippets.some(item => item.id === parsed.activeCustomCSSSnippetId)
      ? parsed.activeCustomCSSSnippetId
      : null

  return {
    presetId:
      typeof parsed?.presetId === 'string' && getThemePreset(parsed.presetId) ? parsed.presetId : DEFAULT_THEME_ID,
    colorMode: parsed?.colorMode === 'light' || parsed?.colorMode === 'dark' ? parsed.colorMode : 'system',
    customCSS: typeof parsed?.customCSS === 'string' ? parsed.customCSS : '',
    customCSSSnippets,
    activeCustomCSSSnippetId,
    collapseUserMessages: typeof parsed?.collapseUserMessages === 'boolean' ? parsed.collapseUserMessages : true,
    renderUserMarkdown:
      typeof parsed?.renderUserMarkdown === 'boolean' ? parsed.renderUserMarkdown : DEFAULT_RENDER_USER_MARKDOWN,
    stepFinishDisplay:
      parsed?.stepFinishDisplay && typeof parsed.stepFinishDisplay === 'object'
        ? { ...DEFAULT_STEP_FINISH_DISPLAY, ...(parsed.stepFinishDisplay as Partial<StepFinishDisplay>) }
        : DEFAULT_STEP_FINISH_DISPLAY,
    completedAtFormat: parsed?.completedAtFormat === 'dateTime' ? 'dateTime' : DEFAULT_COMPLETED_AT_FORMAT,
    reasoningDisplayMode:
      parsed?.reasoningDisplayMode === 'italic' || parsed?.reasoningDisplayMode === 'markdown'
        ? parsed.reasoningDisplayMode
        : DEFAULT_REASONING_DISPLAY_MODE,
    wideMode: parsed?.wideMode === true,
    diffStyle: parsed?.diffStyle === 'changeBars' ? 'changeBars' : DEFAULT_DIFF_STYLE,
    descriptiveToolSteps:
      typeof parsed?.descriptiveToolSteps === 'boolean' ? parsed.descriptiveToolSteps : DEFAULT_DESCRIPTIVE_TOOL_STEPS,
    inlineToolRequests:
      typeof parsed?.inlineToolRequests === 'boolean' ? parsed.inlineToolRequests : DEFAULT_INLINE_TOOL_REQUESTS,
    codeWordWrap: typeof parsed?.codeWordWrap === 'boolean' ? parsed.codeWordWrap : DEFAULT_CODE_WORD_WRAP,
    uiFontScale: clampFontScale(typeof parsed?.uiFontScale === 'number' ? parsed.uiFontScale : DEFAULT_UI_FONT_SCALE),
    codeFontScale: clampFontScale(
      typeof parsed?.codeFontScale === 'number' ? parsed.codeFontScale : DEFAULT_CODE_FONT_SCALE,
    ),
    toolCardStyle:
      parsed?.toolCardStyle === 'classic' || parsed?.toolCardStyle === 'compact'
        ? parsed.toolCardStyle
        : DEFAULT_TOOL_CARD_STYLE,
    immersiveMode: typeof parsed?.immersiveMode === 'boolean' ? parsed.immersiveMode : DEFAULT_IMMERSIVE_MODE,
    compactInlinePermission:
      typeof parsed?.compactInlinePermission === 'boolean'
        ? parsed.compactInlinePermission
        : DEFAULT_COMPACT_INLINE_PERMISSION,
    glassEffect: typeof parsed?.glassEffect === 'boolean' ? parsed.glassEffect : DEFAULT_GLASS_EFFECT,
    queueFollowupMessages:
      typeof parsed?.queueFollowupMessages === 'boolean'
        ? parsed.queueFollowupMessages
        : DEFAULT_QUEUE_FOLLOWUP_MESSAGES,
    manualTerminalTitles:
      typeof parsed?.manualTerminalTitles === 'boolean'
        ? parsed.manualTerminalTitles
        : DEFAULT_MANUAL_TERMINAL_TITLES,
    externalFileDropMode: parsed?.externalFileDropMode === 'mention' ? 'mention' : DEFAULT_EXTERNAL_FILE_DROP_MODE,
    outlineCurrentHighlight:
      typeof parsed?.outlineCurrentHighlight === 'boolean'
        ? parsed.outlineCurrentHighlight
        : DEFAULT_OUTLINE_CURRENT_HIGHLIGHT,
    codeBlockThemeLight:
      typeof parsed?.codeBlockThemeLight === 'string' && parsed.codeBlockThemeLight
        ? parsed.codeBlockThemeLight
        : DEFAULT_CODE_BLOCK_THEME_LIGHT,
    codeBlockThemeDark:
      typeof parsed?.codeBlockThemeDark === 'string' && parsed.codeBlockThemeDark
        ? parsed.codeBlockThemeDark
        : DEFAULT_CODE_BLOCK_THEME_DARK,
  }
}