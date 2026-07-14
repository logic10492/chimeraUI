export type WebUIColorMode = 'system' | 'light' | 'dark'
export type WebUIReasoningDisplayMode = 'capsule' | 'italic' | 'markdown'

export interface WebUIPreferences {
  appearance?: {
    presetId?: string
    colorMode?: WebUIColorMode
  }
  chat?: {
    collapseUserMessages?: boolean
    renderUserMarkdown?: boolean
    reasoningDisplayMode?: WebUIReasoningDisplayMode
  }
}

export interface WebUIPreferencesSnapshot {
  schemaVersion: 1
  revision: number
  initialized: boolean
  preferences: WebUIPreferences
}

export interface WebUIPreferencesUpdate {
  revision: number
  preferences: WebUIPreferences
}

export interface WebUIPreferencesRevisionConflictData {
  expectedRevision: number
  actualRevision: number
}

export interface WebUIPreferencesRevisionConflictResponse {
  name: 'WebUIPreferencesRevisionConflictError'
  data: WebUIPreferencesRevisionConflictData
}
