// ============================================
// useModelSelection - 模型选择逻辑
// ============================================

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react'
import type { ModelInfo } from '../types/ui'
import {
  getModelKey,
  findModelByKey,
  saveModelVariantPref,
  getModelVariantPref,
  getSessionModelSelection,
  saveSessionModelSelection,
} from '../utils/modelUtils'
import { serverStorage } from '../utils/perServerStorage'
import { STORAGE_KEY_SELECTED_MODEL } from '../constants'
import type { SessionModelRef } from '../store/messageStoreTypes'

interface UseModelSelectionOptions {
  models: ModelInfo[]
  sessionId?: string | null
  /** 会话自身默认模型（服务端 session.model，已归一化为 modelID）；子会话优先于本地/全局选择 */
  sessionModel?: SessionModelRef | null
}

interface UseModelSelectionReturn {
  selectedModelKey: string | null
  selectedVariant: string | undefined
  currentModel: ModelInfo | undefined
  handleModelChange: (modelKey: string, model: ModelInfo) => void
  handleVariantChange: (variant: string | undefined) => void
  restoreFromMessage: (
    model: { providerID: string; modelID: string } | null | undefined,
    variant: string | null | undefined,
  ) => void
}

export function useModelSelection({
  models,
  sessionId = null,
  sessionModel = null,
}: UseModelSelectionOptions): UseModelSelectionReturn {
  const sessionSelection = sessionId ? getSessionModelSelection(sessionId) : undefined
  const initialSessionSelection = sessionId ? getSessionModelSelection(sessionId) : undefined
  const initialSessionModelKey = sessionModel ? `${sessionModel.providerID}:${sessionModel.modelID}` : null
  const initialSessionModel = initialSessionModelKey ? findModelByKey(models, initialSessionModelKey) : undefined
  const initialStoredModel = initialSessionSelection ? findModelByKey(models, initialSessionSelection.modelKey) : undefined

  const [{ selectedModelKey, selectedVariant }, setSelection] = useState<{
    selectedModelKey: string | null
    selectedVariant: string | undefined
  }>(() => {
    // 会话自身模型（子会话）优先
    if (initialSessionModelKey && initialSessionModel) {
      return {
        selectedModelKey: initialSessionModelKey,
        selectedVariant: sessionModel?.variant ?? getModelVariantPref(initialSessionModelKey),
      }
    }

    // 其次该会话上次的用户选择
    if (initialSessionSelection && initialStoredModel) {
      return {
        selectedModelKey: initialSessionSelection.modelKey,
        selectedVariant: initialSessionSelection.variant ?? getModelVariantPref(initialSessionSelection.modelKey),
      }
    }

    const initialModelKey = serverStorage.get(STORAGE_KEY_SELECTED_MODEL)

    return {
      selectedModelKey: initialModelKey,
      selectedVariant: initialModelKey ? getModelVariantPref(initialModelKey) : undefined,
    }
  })
  const hydratedSessionRef = useRef<string | null>(initialSessionSelection && !initialStoredModel ? null : sessionId)
  const sessionModelAppliedRef = useRef<string | null>(null)
  const skipPersistenceRef = useRef<string | null>(null)

  const persistedModel = selectedModelKey ? findModelByKey(models, selectedModelKey) : undefined
  const currentModel = useMemo(() => persistedModel ?? models[0], [models, persistedModel])
  const resolvedModelKey = currentModel ? getModelKey(currentModel) : null
  const resolvedSelectedVariant = useMemo(() => {
    if (!resolvedModelKey) return undefined
    if (persistedModel && selectedModelKey === resolvedModelKey) return selectedVariant
    return getModelVariantPref(resolvedModelKey)
  }, [resolvedModelKey, persistedModel, selectedModelKey, selectedVariant])

  useEffect(() => {
    if (!sessionId) {
      hydratedSessionRef.current = null
      return
    }

    if (hydratedSessionRef.current === sessionId) return

    // 会话自身模型（子会话）优先于本地存储与全局选择
    if (sessionModel) {
      const modelKey = `${sessionModel.providerID}:${sessionModel.modelID}`
      const resolvedSessionModel = findModelByKey(models, modelKey)
      if (resolvedSessionModel) {
        setSelection({
          selectedModelKey: modelKey,
          selectedVariant: sessionModel.variant ?? getModelVariantPref(modelKey),
        })
        skipPersistenceRef.current = sessionId
        sessionModelAppliedRef.current = sessionId
        hydratedSessionRef.current = sessionId
        return
      }
      // 模型列表尚未就绪 → 不置位，等 models 到位后由下方 effect 重试
      if (models.length === 0) return
      // 模型存在但当前不可用（被隐藏）→ 退回会话本地选择
    }

    if (!sessionSelection) {
      hydratedSessionRef.current = sessionId
      return
    }

    const restoredModel = findModelByKey(models, sessionSelection.modelKey)
    if (!restoredModel) {
      if (models.length > 0) {
        hydratedSessionRef.current = sessionId
      }
      return
    }

    const nextVariant = sessionSelection.variant ?? getModelVariantPref(sessionSelection.modelKey)
    // Restoring the session-local model needs to happen before persistence runs,
    // otherwise the previous session's selection can be briefly written into the new session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection({
      selectedModelKey: sessionSelection.modelKey,
      selectedVariant: nextVariant,
    })
    skipPersistenceRef.current = sessionId
    hydratedSessionRef.current = sessionId
  }, [models, sessionId, sessionSelection, sessionModel])

  // 会话自身模型可能晚于会话切换到达（getSession 异步）：模型列表就绪后补一次解析，
  // 避免永久停留在全局/上一个会话的模型。
  useEffect(() => {
    if (!sessionId || !sessionModel) return
    if (sessionModelAppliedRef.current === sessionId) return

    const modelKey = `${sessionModel.providerID}:${sessionModel.modelID}`
    if (!findModelByKey(models, modelKey)) {
      // 模型列表已就绪仍无法解析（被隐藏）→ 放弃，避免无限重试
      if (models.length > 0) sessionModelAppliedRef.current = sessionId
      return
    }

    const nextVariant = sessionModel.variant ?? getModelVariantPref(modelKey)
    setSelection(prev =>
      prev.selectedModelKey === modelKey && prev.selectedVariant === nextVariant
        ? prev
        : { selectedModelKey: modelKey, selectedVariant: nextVariant },
    )
    skipPersistenceRef.current = sessionId
    sessionModelAppliedRef.current = sessionId
  }, [models, sessionId, sessionModel])

  useLayoutEffect(() => {
    if (sessionId && sessionSelection && hydratedSessionRef.current !== sessionId) return
    if (sessionId && skipPersistenceRef.current === sessionId) {
      skipPersistenceRef.current = null
      return
    }

    if (resolvedModelKey) {
      serverStorage.set(STORAGE_KEY_SELECTED_MODEL, resolvedModelKey)
      if (sessionId) {
        saveSessionModelSelection(sessionId, resolvedModelKey, resolvedSelectedVariant)
      }
      return
    }

    serverStorage.remove(STORAGE_KEY_SELECTED_MODEL)
  }, [resolvedModelKey, resolvedSelectedVariant, sessionId, sessionSelection])

  // 切换模型
  const handleModelChange = useCallback(
    (modelKey: string, _model: ModelInfo) => {
      // 先保存当前模型的 variant 偏好
      if (resolvedModelKey && resolvedSelectedVariant) {
        saveModelVariantPref(resolvedModelKey, resolvedSelectedVariant)
      }

      // 切换模型
      setSelection({
        selectedModelKey: modelKey,
        selectedVariant: getModelVariantPref(modelKey),
      })
      // 用户显式选择后不再被迟到的 session.model 覆盖
      sessionModelAppliedRef.current = sessionId
    },
    [resolvedModelKey, resolvedSelectedVariant, sessionId],
  )

  // Variant 变化时保存偏好
  const handleVariantChange = useCallback(
    (variant: string | undefined) => {
      setSelection(prev => ({ ...prev, selectedVariant: variant }))
      if (resolvedModelKey) {
        saveModelVariantPref(resolvedModelKey, variant)
      }
    },
    [resolvedModelKey],
  )

  // 从消息中恢复模型选择（仅更新内存状态，不写 storage）
  const restoreFromMessage = useCallback(
    (model: { providerID: string; modelID: string } | null | undefined, variant: string | null | undefined) => {
      if (!model) return

      const modelKey = `${model.providerID}:${model.modelID}`
      const exists = findModelByKey(models, modelKey)

      if (exists) {
        setSelection({
          selectedModelKey: modelKey,
          selectedVariant: variant ?? getModelVariantPref(modelKey),
        })
      }
    },
    [models],
  )

  return {
    selectedModelKey: resolvedModelKey,
    selectedVariant: resolvedSelectedVariant,
    currentModel,
    handleModelChange,
    handleVariantChange,
    restoreFromMessage,
  }
}
