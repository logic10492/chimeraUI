import { useEffect, useRef } from 'react'
import { reportPresence } from '../api/presence'
import { activeDirectoriesKey } from '../utils/activeScope'

/** 服务端 presence TTL 为 90s；30s 周期允许连丢两个心跳仍有保护余量。 */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000

/**
 * WebUI 在场心跳（性能战役 W1）：每 30s 将 activeDirectories 上报到
 * POST /global/presence，刷新服务端实例的 presence pin，使「UI 还开着」
 * 成为实例回收的消费者信号（空闲 TTL / 内存压力驱逐都不动在场的实例）。
 *
 * - effect 依赖用内容 key（activeDirectoriesKey）：内容不变时引用抖动
 *   不会重置定时器（App 的 useStableDirectories 已保证引用稳定，这是双保险）。
 * - 内容变化立即补报一次并重置定时器，新目录马上获得保护。
 * - 心跳失败静默：服务端按 TTL 自然回收，页面关闭后 pin 自然过期，
 *   不需要（也不应该）在 UI 上打扰用户。
 */
export function usePresenceHeartbeat(directories: string[]): void {
  const key = activeDirectoriesKey(directories)
  const directoriesRef = useRef(directories)

  useEffect(() => {
    directoriesRef.current = directories
  })

  useEffect(() => {
    const send = () => {
      void reportPresence(directoriesRef.current).catch(() => {
        // 静默：下个周期自动重试
      })
    }
    send()
    const timer = setInterval(send, PRESENCE_HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [key])
}
