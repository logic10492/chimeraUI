// ============================================
// Tauri 平台检测 & 工具
// ============================================

export type RuntimePlatform = 'web' | 'tauri-desktop' | 'tauri-android' | 'tauri-ios'

type RuntimeWindow = Window & {
  __CHIMERA_RUNTIME_PLATFORM__?: RuntimePlatform
}

/**
 * Detect the application runtime. Native shells may inject an authoritative
 * platform marker; older shells fall back conservatively to their WebView UA.
 */
export function getRuntimePlatform(): RuntimePlatform {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return 'web'

  const declared = (window as RuntimeWindow).__CHIMERA_RUNTIME_PLATFORM__
  if (declared && declared !== 'web') return declared
  if (typeof navigator === 'undefined') return 'tauri-desktop'

  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'tauri-android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'tauri-ios'
  return 'tauri-desktop'
}

export function isTauri(): boolean {
  return getRuntimePlatform() !== 'web'
}

export function isTauriMobile(): boolean {
  const platform = getRuntimePlatform()
  return platform === 'tauri-android' || platform === 'tauri-ios'
}

export function isTauriDesktop(): boolean {
  return getRuntimePlatform() === 'tauri-desktop'
}

export function isTauriAndroid(): boolean {
  return getRuntimePlatform() === 'tauri-android'
}

export function isTauriIOS(): boolean {
  return getRuntimePlatform() === 'tauri-ios'
}

export type DesktopPlatform = 'windows' | 'macos' | 'linux' | 'other'

export function getDesktopPlatform(): DesktopPlatform {
  if (!isTauriDesktop() || typeof navigator === 'undefined') return 'other'

  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'other'
}

export function usesCustomDesktopTitlebar(): boolean {
  const platform = getDesktopPlatform()
  return platform === 'windows' || platform === 'macos'
}

/** 文件扩展名 → MIME 类型映射 */
export function extToMime(ext: string): string {
  const map: Record<string, string> = {
    // image
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    // pdf
    pdf: 'application/pdf',
    // audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    // video
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
  }
  return map[ext] || 'application/octet-stream'
}
