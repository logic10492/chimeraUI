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