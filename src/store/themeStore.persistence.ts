// ============================================
// ThemeStore - Persistence slice
// 启动时从 localStorage 恢复主题状态
// ============================================
import { getThemePreset, DEFAULT_THEME_ID } from '../themes'
import type {
  ColorMode,
  CompletedAtFormat,
  DiffStyle,
  ExternalFileDropMode,
  ReasoningDisplayMode,
  ThemeState,
  ToolCardStyle,
} from './themeStore.types'
import {
  DEFAULT_CODE_BLOCK_THEME_DARK,
  DEFAULT_CODE_BLOCK_THEME_LIGHT,
  DEFAULT_CODE_FONT_SCALE,
  DEFAULT_CODE_WORD_WRAP,
  DEFAULT_COMPACT_INLINE_PERMISSION,
  DEFAULT_COMPLETED_AT_FORMAT,
  DEFAULT_DESCRIPTIVE_TOOL_STEPS,
  DEFAULT_DIFF_STYLE,
  DEFAULT_EXTERNAL_FILE_DROP_MODE,
  DEFAULT_GLASS_EFFECT,
  DEFAULT_IMMERSIVE_MODE,
  DEFAULT_INLINE_TOOL_REQUESTS,
  DEFAULT_MANUAL_TERMINAL_TITLES,
  DEFAULT_QUEUE_FOLLOWUP_MESSAGES,
  DEFAULT_REASONING_DISPLAY_MODE,
  DEFAULT_RENDER_USER_MARKDOWN,
  DEFAULT_STEP_FINISH_DISPLAY,
  DEFAULT_TOOL_CARD_STYLE,
  DEFAULT_UI_FONT_SCALE,
  DEFAULT_OUTLINE_CURRENT_HIGHLIGHT,
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
  clampFontScale,
  parseCustomCSSSnippets,
} from './themeStore.utils'

/** 从 localStorage 恢复主题状态（构造器初始化） */
export function restoreThemeState(): ThemeState {
  const savedPreset = localStorage.getItem(STORAGE_KEY_PRESET) || DEFAULT_THEME_ID
  const normalizedPreset = getThemePreset(savedPreset) ? savedPreset : DEFAULT_THEME_ID
  const savedMode = (localStorage.getItem(STORAGE_KEY_COLOR_MODE) as ColorMode) || 'system'
  const savedCSS = localStorage.getItem(STORAGE_KEY_CUSTOM_CSS) || ''
  const customCSSSnippets = parseCustomCSSSnippets(localStorage.getItem(STORAGE_KEY_CUSTOM_CSS_SNIPPETS))
  const savedActiveCustomCSSSnippetId = localStorage.getItem(STORAGE_KEY_ACTIVE_CUSTOM_CSS_SNIPPET_ID)
  const activeCustomCSSSnippetId = customCSSSnippets.some(item => item.id === savedActiveCustomCSSSnippetId)
    ? savedActiveCustomCSSSnippetId
    : null
  const savedCollapse = localStorage.getItem(STORAGE_KEY_COLLAPSE_USER_MESSAGES)
  const collapseUserMessages = savedCollapse === null ? true : savedCollapse === 'true'
  const savedRenderUserMarkdown = localStorage.getItem(STORAGE_KEY_RENDER_USER_MARKDOWN)
  const renderUserMarkdown =
    savedRenderUserMarkdown === null ? DEFAULT_RENDER_USER_MARKDOWN : savedRenderUserMarkdown === 'true'
  const savedReasoningDisplay = localStorage.getItem(STORAGE_KEY_REASONING_DISPLAY_MODE)
  const reasoningDisplayMode: ReasoningDisplayMode =
    savedReasoningDisplay === 'italic' || savedReasoningDisplay === 'markdown'
      ? savedReasoningDisplay
      : DEFAULT_REASONING_DISPLAY_MODE

  let stepFinishDisplay = DEFAULT_STEP_FINISH_DISPLAY
  try {
    const saved = localStorage.getItem(STORAGE_KEY_STEP_FINISH_DISPLAY)
    if (saved) stepFinishDisplay = { ...DEFAULT_STEP_FINISH_DISPLAY, ...JSON.parse(saved) }
  } catch {
    /* ignore */
  }

  const savedCompletedAtFormat = localStorage.getItem(STORAGE_KEY_COMPLETED_AT_FORMAT)
  const completedAtFormat: CompletedAtFormat =
    savedCompletedAtFormat === 'dateTime' ? 'dateTime' : DEFAULT_COMPLETED_AT_FORMAT

  const savedWideMode = localStorage.getItem(STORAGE_KEY_WIDE_MODE) === 'true'
  const savedDiffStyle = localStorage.getItem(STORAGE_KEY_DIFF_STYLE) as DiffStyle | null
  const diffStyle: DiffStyle = savedDiffStyle === 'changeBars' ? 'changeBars' : DEFAULT_DIFF_STYLE

  const savedDescriptiveToolSteps = localStorage.getItem(STORAGE_KEY_DESCRIPTIVE_TOOL_STEPS)
  const descriptiveToolSteps =
    savedDescriptiveToolSteps === null ? DEFAULT_DESCRIPTIVE_TOOL_STEPS : savedDescriptiveToolSteps === 'true'

  const savedInlineToolRequests = localStorage.getItem(STORAGE_KEY_INLINE_TOOL_REQUESTS)
  const inlineToolRequests =
    savedInlineToolRequests === null ? DEFAULT_INLINE_TOOL_REQUESTS : savedInlineToolRequests === 'true'

  const savedCodeWordWrap = localStorage.getItem(STORAGE_KEY_CODE_WORD_WRAP)
  const codeWordWrap = savedCodeWordWrap === 'true' ? true : DEFAULT_CODE_WORD_WRAP

  const savedFontScale = localStorage.getItem(STORAGE_KEY_FONT_SCALE)
  const uiFontScale = savedFontScale !== null ? clampFontScale(Number(savedFontScale)) : DEFAULT_UI_FONT_SCALE

  const savedCodeFontScale = localStorage.getItem(STORAGE_KEY_CODE_FONT_SCALE)
  const codeFontScale =
    savedCodeFontScale !== null ? clampFontScale(Number(savedCodeFontScale)) : DEFAULT_CODE_FONT_SCALE

  const savedToolCardStyle = localStorage.getItem(STORAGE_KEY_TOOL_CARD_STYLE) as ToolCardStyle | null
  const toolCardStyle: ToolCardStyle =
    savedToolCardStyle === 'classic' || savedToolCardStyle === 'compact'
      ? savedToolCardStyle
      : DEFAULT_TOOL_CARD_STYLE

  const savedImmersiveMode = localStorage.getItem(STORAGE_KEY_IMMERSIVE_MODE)
  const immersiveMode = savedImmersiveMode === 'true' ? true : DEFAULT_IMMERSIVE_MODE

  const savedCompactInlinePermission = localStorage.getItem(STORAGE_KEY_COMPACT_INLINE_PERMISSION)
  const compactInlinePermission =
    savedCompactInlinePermission === null
      ? DEFAULT_COMPACT_INLINE_PERMISSION
      : savedCompactInlinePermission === 'true'

  const savedGlassEffect = localStorage.getItem(STORAGE_KEY_GLASS_EFFECT)
  const glassEffect = savedGlassEffect === null ? DEFAULT_GLASS_EFFECT : savedGlassEffect === 'true'

  const savedQueueFollowupMessages = localStorage.getItem(STORAGE_KEY_QUEUE_FOLLOWUP_MESSAGES)
  const queueFollowupMessages =
    savedQueueFollowupMessages === null ? DEFAULT_QUEUE_FOLLOWUP_MESSAGES : savedQueueFollowupMessages === 'true'

  const savedManualTerminalTitles = localStorage.getItem(STORAGE_KEY_MANUAL_TERMINAL_TITLES)
  const manualTerminalTitles =
    savedManualTerminalTitles === null ? DEFAULT_MANUAL_TERMINAL_TITLES : savedManualTerminalTitles === 'true'

  const savedExternalFileDropMode = localStorage.getItem(STORAGE_KEY_EXTERNAL_FILE_DROP_MODE)
  const externalFileDropMode: ExternalFileDropMode =
    savedExternalFileDropMode === 'mention' ? 'mention' : DEFAULT_EXTERNAL_FILE_DROP_MODE

  const savedOutlineCurrentHighlight = localStorage.getItem(STORAGE_KEY_OUTLINE_CURRENT_HIGHLIGHT)
  const outlineCurrentHighlight =
    savedOutlineCurrentHighlight === null
      ? DEFAULT_OUTLINE_CURRENT_HIGHLIGHT
      : savedOutlineCurrentHighlight === 'true'

  const savedCodeBlockThemeLight = localStorage.getItem(STORAGE_KEY_CODE_BLOCK_THEME_LIGHT)
  const codeBlockThemeLight = savedCodeBlockThemeLight || DEFAULT_CODE_BLOCK_THEME_LIGHT
  const savedCodeBlockThemeDark = localStorage.getItem(STORAGE_KEY_CODE_BLOCK_THEME_DARK)
  const codeBlockThemeDark = savedCodeBlockThemeDark || DEFAULT_CODE_BLOCK_THEME_DARK

  return {
    presetId: normalizedPreset,
    colorMode: savedMode,
    customCSS: savedCSS,
    customCSSSnippets,
    activeCustomCSSSnippetId,
    collapseUserMessages,
    renderUserMarkdown,
    stepFinishDisplay,
    completedAtFormat,
    reasoningDisplayMode,
    wideMode: savedWideMode,
    diffStyle,
    descriptiveToolSteps,
    inlineToolRequests,
    codeWordWrap,
    uiFontScale,
    codeFontScale,
    toolCardStyle,
    immersiveMode,
    compactInlinePermission,
    glassEffect,
    queueFollowupMessages,
    manualTerminalTitles,
    externalFileDropMode,
    outlineCurrentHighlight,
    codeBlockThemeLight,
    codeBlockThemeDark,
  }
}