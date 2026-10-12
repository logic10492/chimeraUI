// ============================================
// LayoutStore - File preview slice
// 文件预览标签（打开/激活/关闭/排序）
// ============================================
import type { PanelPosition, PanelTab, PreviewFile } from './layoutStore.types'
import type { LayoutStore } from './layoutStore'

export interface FileSlice {
  openFilePreview(file: PreviewFile, position?: PanelPosition): void
  activateFilePreview(tabId: string, path: string): void
  closeFilePreview(tabId: string, path?: string): void
  closeAllFilePreviews(tabId: string): void
  reorderFilePreviews(tabId: string, draggedPath: string, targetPath: string): void
  getTargetFilesTab(position?: PanelPosition): PanelTab | null
}

export const fileMethods: FileSlice & ThisType<LayoutStore> = {
  openFilePreview(file, position) {
    const targetTab = this.getTargetFilesTab(position)
    if (!targetTab) return

    const previewFiles = targetTab.previewFiles ?? []
    const existingIndex = previewFiles.findIndex(item => item.path === file.path)
    const nextPreviewFiles =
      existingIndex === -1 ? [...previewFiles, file] : previewFiles.map(item => (item.path === file.path ? file : item))

    targetTab.previewFiles = nextPreviewFiles
    targetTab.previewFile = file
    this.state.activeTabId[targetTab.position] = targetTab.id
    this.setPanelOpen(targetTab.position, true)
    this.notify()
  },

  activateFilePreview(tabId, path) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const file = tab?.previewFiles?.find(item => item.path === path)
    if (!tab || !file) return
    tab.previewFile = file
    this.notify()
  },

  closeFilePreview(tabId, path) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const previewFiles = tab?.previewFiles
    const targetPath = path ?? tab?.previewFile?.path
    if (!tab || !previewFiles || !targetPath) return

    const index = previewFiles.findIndex(item => item.path === targetPath)
    if (index === -1) return

    const isActive = tab.previewFile?.path === targetPath
    const nextPreviewFiles = previewFiles.filter(item => item.path !== targetPath)

    tab.previewFiles = nextPreviewFiles

    if (nextPreviewFiles.length === 0) {
      tab.previewFile = null
    } else if (isActive) {
      const nextIndex = Math.min(index, nextPreviewFiles.length - 1)
      tab.previewFile = nextPreviewFiles[nextIndex] ?? null
    }

    this.notify()
  },

  closeAllFilePreviews(tabId) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    if (!tab) return
    tab.previewFile = null
    tab.previewFiles = []
    this.notify()
  },

  reorderFilePreviews(tabId, draggedPath, targetPath) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const previewFiles = tab?.previewFiles
    if (!tab || !previewFiles) return

    const draggedIndex = previewFiles.findIndex(item => item.path === draggedPath)
    const targetIndex = previewFiles.findIndex(item => item.path === targetPath)

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return

    const nextPreviewFiles = [...previewFiles]
    const [dragged] = nextPreviewFiles.splice(draggedIndex, 1)
    nextPreviewFiles.splice(targetIndex, 0, dragged)
    tab.previewFiles = nextPreviewFiles
    this.notify()
  },

  getTargetFilesTab(position) {
    if (position) {
      const activeId = this.state.activeTabId[position]
      const activeFilesTab = this.state.panelTabs.find(
        t => t.id === activeId && t.type === 'files' && t.position === position,
      )
      if (activeFilesTab) return activeFilesTab

      const filesTab = this.state.panelTabs.find(t => t.type === 'files' && t.position === position)
      if (filesTab) return filesTab

      const id = this.addFilesTab(position)
      return this.state.panelTabs.find(t => t.id === id) ?? null
    }

    const preferred = (['right', 'bottom'] as const)
      .map(pos =>
        this.state.panelTabs.find(
          t => t.id === this.state.activeTabId[pos] && t.type === 'files' && t.position === pos,
        ),
      )
      .find(Boolean)
    if (preferred) return preferred

    return this.state.panelTabs.find(t => t.type === 'files') ?? null
  },
}