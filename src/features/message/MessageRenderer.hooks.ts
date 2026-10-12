import { useRef, useLayoutEffect } from 'react'
import { animate } from 'motion/mini'

// ============================================
// 入场生长动画 hook — 新消息作为对话流的延续，从 height 0 平滑展开
// ============================================

export function useEntryGrowAnimation(created: number) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || Date.now() - created > 3000) return
    // 始终把 DOM 还原干净：StrictMode 开发期会双调用 effect（mount→cleanup→mount），
    // 第一次的 WAAPI 动画若不被真正 cancel，会在后台跑完并把固定 height 写回 DOM
    const clear = () => {
      el.style.height = ''
      el.style.clipPath = ''
    }
    const targetHeight = el.scrollHeight
    el.style.height = '0px'
    el.style.clipPath = 'inset(0 -100% 0 -100%)'
    const controls = animate(el, { height: `${targetHeight}px` }, { duration: 0.2, ease: 'easeOut' })
    controls.then(clear)
    return () => {
      // 真停掉动画，避免后台残留写入；再兜底清一次 DOM
      controls.stop()
      clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}