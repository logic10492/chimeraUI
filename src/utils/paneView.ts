export function paneFullscreenForViewport(
  fullscreenPaneId: string | null,
  focusedPaneId: string | null,
  splitPaneEnabled: boolean,
): string | null {
  if (fullscreenPaneId || splitPaneEnabled) return fullscreenPaneId
  return focusedPaneId
}

export function focusPaneInput(paneId: string | null, root: ParentNode = document): boolean {
  if (!paneId) return false
  const escapedPaneId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(paneId) : paneId.replace(/["\\]/g, '\\$&')
  const input = root.querySelector<HTMLTextAreaElement>(`[data-pane-id="${escapedPaneId}"] [data-input-box] textarea`)
  input?.focus()
  return !!input
}
