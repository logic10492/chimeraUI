import type { MobileExtraKey, StickyModifiers } from './Terminal.types'

export const TERMINAL_FONT_FALLBACK =
  "'Fira Code', 'Noto Sans Mono CJK SC', 'JetBrains Mono', 'Cascadia Code', 'SFMono-Regular', 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Noto Sans Mono', 'Ubuntu Mono', 'WenQuanYi Micro Hei Mono', 'DejaVu Sans Mono', 'Noto Sans CJK SC', ui-monospace, monospace"

export function createStickyModifiers(): StickyModifiers {
  return { ctrl: false, alt: false }
}

export const MOBILE_EXTRA_KEY_ROWS: MobileExtraKey[][] = [
  [
    { label: 'ESC', data: '\x1b' },
    { label: '/', data: '/' },
    { label: '-', data: '-' },
    { label: 'HOME', data: '\x1b[H' },
    { label: '↑', data: '\x1b[A' },
    { label: 'END', data: '\x1b[F' },
    { label: 'PGUP', data: '\x1b[5~' },
  ],
  [
    { label: 'TAB', data: '\t' },
    { label: 'CTRL', modifier: 'ctrl' },
    { label: 'ALT', modifier: 'alt' },
    { label: '←', data: '\x1b[D' },
    { label: '↓', data: '\x1b[B' },
    { label: '→', data: '\x1b[C' },
    { label: 'PGDN', data: '\x1b[6~' },
  ],
]

export function toCtrlSequence(data: string): string {
  if (data.length !== 1) return data

  const upper = data.toUpperCase()
  if (upper >= 'A' && upper <= 'Z') {
    return String.fromCharCode(upper.charCodeAt(0) - 64)
  }

  switch (data) {
    case ' ':
    case '@':
    case '`':
      return '\x00'
    case '[':
      return '\x1b'
    case '\\':
      return '\x1c'
    case ']':
      return '\x1d'
    case '^':
      return '\x1e'
    case '_':
    case '/':
      return '\x1f'
    case '?':
      return '\x7f'
    default:
      return data
  }
}

export function hasStickyModifier(sticky: StickyModifiers): boolean {
  return sticky.ctrl || sticky.alt
}

export function isNativePasteShortcut(event: KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v'
}

export function applyStickyModifiers(data: string, sticky: StickyModifiers): string {
  let output = data
  if (sticky.ctrl) output = toCtrlSequence(output)
  if (sticky.alt) output = `\x1b${output}`
  return output
}

// ============================================
// 终端主题 - 与应用主题配合
// ============================================

// 获取 CSS 变量的实际 HSL 值并转换为 hex
export function getHSLColor(varName: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!value) return ''

  // CSS 变量格式是 "h s% l%" 或 "h s l"
  const parts = value.split(/\s+/)
  if (parts.length < 3) return ''

  const h = parseFloat(parts[0])
  const s = parseFloat(parts[1]) / 100
  const l = parseFloat(parts[2]) / 100

  // HSL to RGB
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function getTerminalTheme(isDark: boolean) {
  const fgColor = getHSLColor('--text-100') || (isDark ? '#e8e0d5' : '#2d2a26')
  // 背景色需要设为实际颜色（而非透明），因为 xterm 在处理反转视频（\e[7m）时
  // 会用 theme.background 作为反转后的前景色。如果设为 #00000000，
  // 反转视频的文字会变成黑色，且反转背景也会出现黑框。
  // 实际的透明效果由 CSS `.xterm-viewport { background-color: transparent !important }` 实现。
  const bgColor = getHSLColor('--bg-100') || (isDark ? '#1a1a1a' : '#f5f3ef')

  if (isDark) {
    return {
      background: bgColor,
      foreground: fgColor,
      cursor: '#e8e0d5',
      cursorAccent: '#1a1a1a',
      selectionBackground: '#4a4540',
      selectionForeground: '#e8e0d5',
      selectionInactiveBackground: '#3a3530',
      // ANSI colors - 暖色调适配
      black: '#1a1a1a',
      red: '#e55561',
      green: '#8cc265',
      yellow: '#d4a656',
      blue: '#6cb6ff',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#ff6b7a',
      brightGreen: '#a8e075',
      brightYellow: '#e5b567',
      brightBlue: '#82cfff',
      brightMagenta: '#de8ef0',
      brightCyan: '#70d0dc',
      brightWhite: '#ffffff',
    }
  } else {
    return {
      background: bgColor,
      foreground: fgColor,
      cursor: '#2d2a26',
      cursorAccent: '#f5f3ef',
      selectionBackground: '#d5d0c8',
      selectionForeground: '#2d2a26',
      selectionInactiveBackground: '#e5e0d8',
      // ANSI colors - 浅色模式
      // 注意：在浅色背景下，white/brightWhite 需要是深色，
      // 因为 PowerShell 等 shell 会用这些 ANSI 颜色渲染用户输入文本
      black: '#f5f3ef',
      red: '#c9514a',
      green: '#4a9f4a',
      yellow: '#b58900',
      blue: '#3a7fc9',
      magenta: '#a04a9f',
      cyan: '#3a9f9f',
      white: '#655f58',
      brightBlack: '#6b6560',
      brightRed: '#e55561',
      brightGreen: '#6ab56a',
      brightYellow: '#d4a020',
      brightBlue: '#5a9fe0',
      brightMagenta: '#c06abf',
      brightCyan: '#5abfbf',
      brightWhite: '#2d2a26',
    }
  }
}

export function isDarkMode(): boolean {
  const mode = document.documentElement.getAttribute('data-mode')
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}