// ============================================
// ThemeStore - Theme slice
// 主题预设 / 日夜模式 / 主题应用
// ============================================
import { getThemePreset, themeColorsToCSSVars, builtinThemes } from '../themes'
import type { ThemeColors } from '../themes'
import { STORAGE_KEY_COLOR_MODE, STORAGE_KEY_PRESET, STYLE_ID_THEME } from './themeStore.utils'
import type { ColorMode } from './themeStore.types'
import type { ThemeStore } from './themeStore'

/**
 * 将浏览器 getComputedStyle 返回的任意格式颜色字符串转为 #RRGGBB 十六进制
 *
 * 现代 Chromium WebView 可能返回多种格式：
 * - rgb(29, 36, 50)   — 逗号分隔
 * - rgb(29 36 50)     — 空格分隔 (CSS Color Level 4)
 * - color(srgb 0.11 0.14 0.20) — sRGB 函数
 * - oklch(...)        — OKLab 色彩空间
 *
 * 利用 Canvas 2D 做万能转换，让浏览器自己解析任何合法 CSS 颜色
 */
export function computedColorToHex(cssColor: string): string | null {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = cssColor
    // ctx.fillStyle 会被浏览器标准化为 #rrggbb 或 rgba(...) 格式
    const normalized = ctx.fillStyle
    if (normalized.startsWith('#')) return normalized
    // 如果返回 rgba/rgb 格式，提取数值转 hex
    const match = normalized.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (match) {
      const r = parseInt(match[1], 10)
      const g = parseInt(match[2], 10)
      const b = parseInt(match[3], 10)
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
    }
    return null
  } catch {
    return null
  }
}

export interface ThemeSlice {
  readonly presetId: string
  readonly colorMode: ColorMode
  getPreset(): ReturnType<typeof getThemePreset>
  getAvailablePresets(): { id: string; name: string; description: string }[]
  getResolvedMode(): 'light' | 'dark'
  readonly isDark: boolean
  setPreset(id: string): void
  setColorMode(mode: ColorMode): void
  applyTheme(): void
  injectThemeStyle(colors: ThemeColors): void
  init(): void
}

export const themeMethods: ThemeSlice & ThisType<ThemeStore> = {
  get presetId() {
    return this.state.presetId
  },

  get colorMode() {
    return this.state.colorMode
  },

  /** 获取当前主题预设（内置主题返回对象，自定义返回 undefined） */
  getPreset() {
    return getThemePreset(this.state.presetId)
  },

  /** 获取所有可用主题列表 */
  getAvailablePresets() {
    return builtinThemes.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
    }))
  },

  /** 解析实际生效的暗/亮模式 */
  getResolvedMode() {
    if (this.state.colorMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return this.state.colorMode
  },

  get isDark() {
    return this.getResolvedMode() === 'dark'
  },

  setPreset(id) {
    if (this.state.presetId === id) return
    this.state = { ...this.state, presetId: id }
    localStorage.setItem(STORAGE_KEY_PRESET, id)
    this.applyTheme()
    this.emit()
  },

  setColorMode(mode) {
    if (this.state.colorMode === mode) return
    this.state = { ...this.state, colorMode: mode }
    localStorage.setItem(STORAGE_KEY_COLOR_MODE, mode)
    this.applyTheme()
    this.emit()
  },

  /** 初始化：应用当前主题到 DOM */
  init() {
    this.applyTheme()
    this.applyFontScale()
    this.applyGlassClass()

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', () => {
      if (this.state.colorMode === 'system') {
        this.applyTheme()
        this.emit()
      }
    })
  },

  /** 将主题 CSS 变量注入到 DOM */
  applyTheme() {
    const root = document.documentElement
    const resolvedMode = this.getResolvedMode()

    // 1. 设置 data-mode（驱动 CSS 中日/夜模式相关的非颜色规则，以及 Terminal、Shiki 等联动）
    if (this.state.colorMode === 'system') {
      root.removeAttribute('data-mode')
    } else {
      root.setAttribute('data-mode', this.state.colorMode)
    }

    // 2. 注入主题颜色变量
    const preset = this.getPreset()
    if (preset) {
      const colors: ThemeColors = resolvedMode === 'dark' ? preset.dark : preset.light
      this.injectThemeStyle(colors)
    }

    // 3. 应用自定义 CSS
    this.applyCustomCSS()

    // 4. 更新 meta theme-color
    requestAnimationFrame(() => {
      const bg = getComputedStyle(root).getPropertyValue('--color-bg-100').trim()
      if (!bg) return

      // 将计算后的颜色统一转为 HEX 格式，避免不同浏览器/WebView 返回
      // 不同格式（rgb, oklch, color(srgb ...)）导致 Android 原生端解析失败或色差
      const hex = computedColorToHex(bg)
      if (!hex) return

      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', hex)

      const androidBridge = (
        window as unknown as { __opencode_android?: { setSystemBars?: (mode: string, bg: string) => void } }
      ).__opencode_android
      if (androidBridge?.setSystemBars) {
        androidBridge.setSystemBars(resolvedMode, hex)
      }
    })
  },

  injectThemeStyle(colors) {
    let el = document.getElementById(STYLE_ID_THEME) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID_THEME
      document.head.appendChild(el)
    }

    // 用高优先级选择器覆盖 :root 中的默认值
    // 使用 :root:root 提升特异性，确保覆盖 index.css 中的所有定义
    el.textContent = `:root:root {\n  ${themeColorsToCSSVars(colors)}\n}`
  },
}
