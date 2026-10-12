import type { ApiScope } from '../api/scope'

export type ModifierKey = 'ctrl' | 'alt'

export type StickyModifiers = Record<ModifierKey, boolean>

export interface MobileExtraKey {
  data?: string
  label: string
  modifier?: ModifierKey
}

export interface MobileExtraKeysProps {
  onFocusTerminal: () => void
  onSend: (data: string) => void
  onToggleSticky: (modifier: ModifierKey) => void
  stickyModifiers: StickyModifiers
}

export interface TerminalProps {
  ptyId: string
  apiScope: ApiScope
  isActive: boolean
}