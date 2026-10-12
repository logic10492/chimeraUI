// ============================================
// useChatSessionAgents - agent 列表加载与选中状态（含持久化）
// ============================================

import { useCallback, useEffect, useState } from 'react'
import { getSelectableAgents } from '../api/agent'
import { serverStorage } from '../utils/perServerStorage'
import { createErrorHandler } from '../utils'
import { STORAGE_KEY_SELECTED_AGENT } from '../constants'
import type { Agent as ApiAgent } from '../types/api/agent'

const handleError = createErrorHandler('session')

export function useChatSessionAgents(paneId: string, currentDirectory: string | undefined) {
  const [agents, setAgents] = useState<ApiAgent[]>([])
  const [selectedAgent, setSelectedAgentRaw] = useState<string>(
    () => serverStorage.get(`${STORAGE_KEY_SELECTED_AGENT}:${paneId}`) || '',
  )

  const setSelectedAgent = useCallback(
    (agentName: string) => {
      setSelectedAgentRaw(agentName)
      serverStorage.set(`${STORAGE_KEY_SELECTED_AGENT}:${paneId}`, agentName)
    },
    [paneId],
  )

  // Load agents
  useEffect(() => {
    getSelectableAgents(currentDirectory)
      .then(setAgents)
      .catch(err => handleError('fetch agents', err))
  }, [currentDirectory])

  // agents 列表加载后，校验当前选中的 agent 是否存在于列表中
  useEffect(() => {
    if (agents.length === 0) return
    const primaryAgents = agents.filter(a => a.mode !== 'subagent' && !a.hidden)
    if (primaryAgents.length === 0) return

    // 当前选中的 agent 在列表中存在就不动
    if (selectedAgent && primaryAgents.some(a => a.name === selectedAgent)) return

    // 否则选第一个 primary agent
    const frameId = requestAnimationFrame(() => {
      setSelectedAgent(primaryAgents[0].name)
    })

    return () => cancelAnimationFrame(frameId)
  }, [agents, selectedAgent, setSelectedAgent])

  // Toggle agent (cycle through primary agents only, matching toolbar display)
  const handleToggleAgent = useCallback(() => {
    const primaryAgents = agents.filter(a => a.mode !== 'subagent' && !a.hidden)
    if (primaryAgents.length <= 1) return
    const currentIndex = primaryAgents.findIndex(a => a.name === selectedAgent)
    const nextIndex = (currentIndex + 1) % primaryAgents.length
    setSelectedAgent(primaryAgents[nextIndex].name)
  }, [agents, selectedAgent, setSelectedAgent])

  // 从消息中恢复 agent 选择（用于切换 session 时）
  const restoreAgentFromMessage = useCallback(
    (agentName: string | null | undefined) => {
      if (!agentName) return
      // 只有当 agent 存在于列表中时才恢复
      const exists = agents.some(a => a.name === agentName && a.mode !== 'subagent' && !a.hidden)
      if (exists) {
        setSelectedAgent(agentName)
      }
    },
    [agents, setSelectedAgent],
  )

  return { agents, setAgents, selectedAgent, setSelectedAgent, handleToggleAgent, restoreAgentFromMessage }
}