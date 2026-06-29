/** API 基础地址 - 优先使用环境变量；开发模式连本地后端；嵌入 Chimera 时默认同源 */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:4096' : window.location.origin)
