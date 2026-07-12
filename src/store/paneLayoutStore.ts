/**
 * paneLayoutStore — Split-pane layout state management
 *
 * Uses a recursive binary split tree. Each leaf is a chat pane with its own
 * sessionId. Splits can be horizontal (side-by-side) or vertical (top-bottom).
 *
 * Tree structure:
 *   PaneNode = PaneLeaf | PaneSplit
 *   PaneLeaf  = { type: 'leaf', id, sessionId }
 *   PaneSplit  = { type: 'split', id, direction, ratio, first, second }
 */

import { useSyncExternalStore } from 'react'
import { notificationStore } from './notificationStore'

const STORAGE_PREFIX = 'chimera:pane-layout:v1'
const STORAGE_VERSION = 1

// ============================================
// Types
// ============================================

export interface PaneLeaf {
  type: 'leaf'
  id: string
  sessionId: string | null
}

export interface PaneSplit {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  /** 0–1, fraction of space given to `first` child */
  ratio: number
  first: PaneNode
  second: PaneNode
}

export type PaneNode = PaneLeaf | PaneSplit

export interface PaneLayoutSnapshot {
  root: PaneNode
  focusedPaneId: string | null
  focusedSessionId: string | null
  fullscreenPaneId: string | null
  /** Total number of leaves */
  paneCount: number
  /** Whether split mode is active (paneCount > 1) */
  isSplit: boolean
}

// ============================================
// Helpers
// ============================================

let _nextPaneId = 1

function genPaneId(): string {
  return `pane-${_nextPaneId++}`
}

function genSplitId(): string {
  return `split-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function countLeaves(node: PaneNode): number {
  if (node.type === 'leaf') return 1
  return countLeaves(node.first) + countLeaves(node.second)
}

function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  if (node.type === 'leaf') return node.id === paneId ? node : null
  return findLeaf(node.first, paneId) || findLeaf(node.second, paneId)
}

function allLeaves(node: PaneNode): PaneLeaf[] {
  if (node.type === 'leaf') return [node]
  return [...allLeaves(node.first), ...allLeaves(node.second)]
}

function syncNextPaneId(node: PaneNode) {
  const maxPaneId = allLeaves(node).reduce((max, leaf) => {
    const match = /^pane-(\d+)$/.exec(leaf.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  _nextPaneId = maxPaneId + 1
}

function validatePaneNode(value: unknown, ids = new Set<string>()): value is PaneNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<PaneNode>
  if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) return false
  ids.add(node.id)
  if (node.type === 'leaf') return node.sessionId === null || typeof node.sessionId === 'string'
  if (node.type !== 'split') return false
  return (
    (node.direction === 'horizontal' || node.direction === 'vertical') &&
    typeof node.ratio === 'number' &&
    Number.isFinite(node.ratio) &&
    node.ratio > 0 &&
    node.ratio < 1 &&
    validatePaneNode(node.first, ids) &&
    validatePaneNode(node.second, ids)
  )
}

function storageKey(serverID: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(serverID)}`
}

function createInitialRoot(): PaneLeaf {
  return { type: 'leaf', id: genPaneId(), sessionId: null }
}

/**
 * Replace a node in the tree by id, returning a new tree (immutable).
 */
function replaceNode(node: PaneNode, targetId: string, replacement: PaneNode): PaneNode {
  if (node.id === targetId) return replacement
  if (node.type === 'leaf') return node
  return {
    ...node,
    first: replaceNode(node.first, targetId, replacement),
    second: replaceNode(node.second, targetId, replacement),
  }
}

function clearSessionFromNode(node: PaneNode, sessionId: string): { node: PaneNode; changed: boolean } {
  if (node.type === 'leaf') {
    if (node.sessionId !== sessionId) return { node, changed: false }
    return { node: { ...node, sessionId: null }, changed: true }
  }

  const first = clearSessionFromNode(node.first, sessionId)
  const second = clearSessionFromNode(node.second, sessionId)
  if (!first.changed && !second.changed) return { node, changed: false }

  return {
    node: {
      ...node,
      first: first.node,
      second: second.node,
    },
    changed: true,
  }
}

/**
 * Remove a leaf from the tree. The sibling of the removed leaf takes its
 * parent split's place. Returns the new root (or null if tree becomes empty).
 */
function removeLeaf(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'leaf') {
    return node.id === paneId ? null : node
  }

  // Check direct children first (common case)
  if (node.first.type === 'leaf' && node.first.id === paneId) return node.second
  if (node.second.type === 'leaf' && node.second.id === paneId) return node.first

  // Recurse into children
  const newFirst = removeLeaf(node.first, paneId)
  if (newFirst !== node.first) {
    return newFirst === null ? node.second : { ...node, first: newFirst }
  }
  const newSecond = removeLeaf(node.second, paneId)
  if (newSecond !== node.second) {
    return newSecond === null ? node.first : { ...node, second: newSecond }
  }
  return node
}

function findReplacementForRemovedLeaf(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === 'leaf') return null

  if (node.first.type === 'leaf' && node.first.id === paneId) return node.second
  if (node.second.type === 'leaf' && node.second.id === paneId) return node.first

  return findReplacementForRemovedLeaf(node.first, paneId) || findReplacementForRemovedLeaf(node.second, paneId)
}

/**
 * Swap the sessionIds of two leaves.
 */
function swapLeafSessions(node: PaneNode, idA: string, idB: string): PaneNode {
  const leafA = findLeaf(node, idA)
  const leafB = findLeaf(node, idB)
  if (!leafA || !leafB) return node

  const sessionA = leafA.sessionId
  const sessionB = leafB.sessionId

  function walk(n: PaneNode): PaneNode {
    if (n.type === 'leaf') {
      if (n.id === idA) return { ...n, sessionId: sessionB }
      if (n.id === idB) return { ...n, sessionId: sessionA }
      return n
    }
    return { ...n, first: walk(n.first), second: walk(n.second) }
  }
  return walk(node)
}

/**
 * Update ratio for a split node by its id.
 */
function updateRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.type === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio }
  return {
    ...node,
    first: updateRatio(node.first, splitId, ratio),
    second: updateRatio(node.second, splitId, ratio),
  }
}

// ============================================
// Store
// ============================================

type Listener = () => void

function createPaneLayoutStore() {
  let _root: PaneNode = createInitialRoot()
  let _focusedPaneId: string | null = _root.id
  let _fullscreenPaneId: string | null = null
  let _activeServerID = 'local'
  let _suspendPersistence = false
  const _listeners = new Set<Listener>()

  function _notify() {
    for (const fn of _listeners) fn()
  }

  function _snapshot(): PaneLayoutSnapshot {
    const count = countLeaves(_root)
    const focusedLeaf = _focusedPaneId ? findLeaf(_root, _focusedPaneId) : null
    return {
      root: _root,
      focusedPaneId: _focusedPaneId,
      focusedSessionId: focusedLeaf?.sessionId ?? null,
      fullscreenPaneId: _fullscreenPaneId,
      paneCount: count,
      isSplit: count > 1,
    }
  }

  // Cache snapshot for useSyncExternalStore identity stability
  let _cachedSnapshot = _snapshot()

  function _reportStorageError(error: unknown) {
    notificationStore.pushTransient(
      'error',
      'Pane layout persistence failed',
      error instanceof Error ? error.message : String(error),
    )
  }

  function _persist() {
    if (_suspendPersistence) return
    try {
      localStorage.setItem(
        storageKey(_activeServerID),
        JSON.stringify({
          version: STORAGE_VERSION,
          serverID: _activeServerID,
          root: _root,
          focusedPaneId: _focusedPaneId,
          fullscreenPaneId: _fullscreenPaneId,
        }),
      )
    } catch (error) {
      _reportStorageError(error)
    }
  }

  function _refreshSnapshot() {
    _cachedSnapshot = _snapshot()
    _persist()
    _notify()
  }

  function _activateEmptyServer(serverID: string, error?: unknown) {
    _suspendPersistence = true
    _nextPaneId = 1
    _root = createInitialRoot()
    _focusedPaneId = _root.id
    _fullscreenPaneId = null
    _activeServerID = serverID
    _suspendPersistence = false
    if (error !== undefined) _reportStorageError(error)
    _refreshSnapshot()
  }

  return {
    // ---- useSyncExternalStore API ----
    subscribe(listener: Listener) {
      _listeners.add(listener)
      return () => _listeners.delete(listener)
    },

    getSnapshot(): PaneLayoutSnapshot {
      return _cachedSnapshot
    },

    // ---- Queries ----
    getRoot() {
      return _root
    },

    getFocusedPaneId() {
      return _focusedPaneId
    },

    getFocusedLeaf() {
      return _focusedPaneId ? findLeaf(_root, _focusedPaneId) : null
    },

    getFocusedSessionId() {
      return _focusedPaneId ? (findLeaf(_root, _focusedPaneId)?.sessionId ?? null) : null
    },

    getFullscreenPaneId() {
      return _fullscreenPaneId
    },

    findLeaf(paneId: string) {
      return findLeaf(_root, paneId)
    },

    allLeaves() {
      return allLeaves(_root)
    },

    /** Whether the given pane is the only leaf (i.e. no split active). */
    isSinglePane() {
      return _root.type === 'leaf'
    },

    activateServer(serverID: string) {
      try {
        const raw = localStorage.getItem(storageKey(serverID))
        if (!raw) {
          _activateEmptyServer(serverID)
          return
        }
        const stored = JSON.parse(raw) as {
          version?: number
          serverID?: string
          root?: unknown
          focusedPaneId?: unknown
          fullscreenPaneId?: unknown
        }
        if (stored.version !== STORAGE_VERSION || stored.serverID !== serverID) {
          throw new Error('Unsupported pane layout snapshot version or server scope')
        }
        if (!validatePaneNode(stored.root)) {
          _activateEmptyServer(serverID, new Error('Invalid pane layout snapshot'))
          return
        }

        const focusedPaneId = typeof stored.focusedPaneId === 'string' ? stored.focusedPaneId : null
        const fullscreenPaneId = typeof stored.fullscreenPaneId === 'string' ? stored.fullscreenPaneId : null
        const invalidFocusedPane = focusedPaneId && !findLeaf(stored.root, focusedPaneId)
        const invalidFullscreenPane = fullscreenPaneId && !findLeaf(stored.root, fullscreenPaneId)
        if (invalidFocusedPane || invalidFullscreenPane) {
          _activateEmptyServer(serverID, new Error('Invalid pane layout snapshot'))
          return
        }

        _suspendPersistence = true
        _root = stored.root
        syncNextPaneId(_root)
        _focusedPaneId = focusedPaneId ?? allLeaves(_root)[0]?.id ?? null
        _fullscreenPaneId = fullscreenPaneId
        _activeServerID = serverID
        _suspendPersistence = false
        _refreshSnapshot()
      } catch (error) {
        _activateEmptyServer(serverID, error)
      }
    },

    // ---- Mutations ----

    /**
     * Focus a pane. Only updates if different.
     */
    focusPane(paneId: string) {
      if (_focusedPaneId === paneId) return
      _focusedPaneId = paneId
      _refreshSnapshot()
    },

    enterPaneFullscreen(paneId: string) {
      if (!findLeaf(_root, paneId)) return
      _focusedPaneId = paneId
      _fullscreenPaneId = paneId
      _refreshSnapshot()
    },

    exitPaneFullscreen() {
      if (_fullscreenPaneId === null) return
      _fullscreenPaneId = null
      _refreshSnapshot()
    },

    togglePaneFullscreen(paneId: string) {
      if (_fullscreenPaneId === paneId) {
        this.exitPaneFullscreen()
        return
      }
      this.enterPaneFullscreen(paneId)
    },

    /**
     * Set the sessionId for a leaf pane.
     */
    setPaneSession(paneId: string, sessionId: string | null) {
      const leaf = findLeaf(_root, paneId)
      if (!leaf || leaf.sessionId === sessionId) return
      _root = replaceNode(_root, paneId, { ...leaf, sessionId })
      _refreshSnapshot()
    },

    setFocusedSession(sessionId: string | null) {
      if (!_focusedPaneId) return
      this.setPaneSession(_focusedPaneId, sessionId)
    },

    clearSession(sessionId: string) {
      const result = clearSessionFromNode(_root, sessionId)
      if (!result.changed) return
      _root = result.node
      _refreshSnapshot()
    },

    /**
     * Split a pane into two. The existing pane keeps its session,
     * and a new sibling is created (optionally with a session).
     */
    splitPane(paneId: string, direction: 'horizontal' | 'vertical', newSessionId?: string | null): string | null {
      const leaf = findLeaf(_root, paneId)
      if (!leaf) return null

      const newLeaf: PaneLeaf = { type: 'leaf', id: genPaneId(), sessionId: newSessionId ?? null }
      const split: PaneSplit = {
        type: 'split',
        id: genSplitId(),
        direction,
        ratio: 0.5,
        first: { ...leaf }, // clone existing
        second: newLeaf,
      }

      _root = replaceNode(_root, paneId, split)
      _focusedPaneId = newLeaf.id
      if (_fullscreenPaneId === paneId) {
        _fullscreenPaneId = null
      }
      _refreshSnapshot()
      return newLeaf.id
    },

    /**
     * Split a pane placing the new leaf on a specific side relative to the target.
     * - left/top:  new leaf becomes `first`  (old pane shifts right/down)
     * - right/bottom: new leaf becomes `second` (old pane stays put)
     * Direction is derived from the side.
     * Returns the new pane id, or null if target not found.
     */
    splitPaneToSide(
      targetPaneId: string,
      side: 'top' | 'bottom' | 'left' | 'right',
      newSessionId: string | null,
    ): string | null {
      const leaf = findLeaf(_root, targetPaneId)
      if (!leaf) return null

      const direction: 'horizontal' | 'vertical' = side === 'left' || side === 'right' ? 'horizontal' : 'vertical'
      const newLeaf: PaneLeaf = { type: 'leaf', id: genPaneId(), sessionId: newSessionId }
      const existing: PaneLeaf = { ...leaf }
      const newIsFirst = side === 'left' || side === 'top'

      const split: PaneSplit = {
        type: 'split',
        id: genSplitId(),
        direction,
        ratio: 0.5,
        first: newIsFirst ? newLeaf : existing,
        second: newIsFirst ? existing : newLeaf,
      }

      _root = replaceNode(_root, targetPaneId, split)
      _focusedPaneId = newLeaf.id
      if (_fullscreenPaneId === targetPaneId) {
        _fullscreenPaneId = null
      }
      _refreshSnapshot()
      return newLeaf.id
    },

    /**
     * Close a pane. Its sibling takes its parent's place.
     * If it's the last pane, we exit split mode (root becomes the single leaf).
     */
    closePane(paneId: string) {
      if (_root.type === 'leaf') {
        // Single pane — just clear its session
        _root = { ..._root, sessionId: null }
        _refreshSnapshot()
        return
      }

      const focusReplacement = _focusedPaneId === paneId ? findReplacementForRemovedLeaf(_root, paneId) : null
      const result = removeLeaf(_root, paneId)
      if (!result) return

      _root = result
      if (_fullscreenPaneId === paneId || (_fullscreenPaneId && !findLeaf(_root, _fullscreenPaneId))) {
        _fullscreenPaneId = null
      }

      // Update focus
      if (_focusedPaneId === paneId) {
        const replacementLeaves = focusReplacement ? allLeaves(focusReplacement) : []
        const fallbackLeaves = allLeaves(_root)
        _focusedPaneId = replacementLeaves[0]?.id ?? fallbackLeaves[0]?.id ?? null
      }

      _refreshSnapshot()
    },

    /**
     * Swap sessions between two panes (drag-and-drop).
     */
    swapPanes(paneIdA: string, paneIdB: string) {
      if (paneIdA === paneIdB) return
      _root = swapLeafSessions(_root, paneIdA, paneIdB)
      _refreshSnapshot()
    },

    /**
     * Update the split ratio for a split node.
     */
    setRatio(splitId: string, ratio: number) {
      const clamped = Math.max(0.15, Math.min(0.85, ratio))
      _root = updateRatio(_root, splitId, clamped)
      _refreshSnapshot()
    },

    /**
     * Enter split mode: split the root pane horizontally.
     * The existing pane keeps the current session, a new empty pane is created.
     * Returns the new pane id, or null if already split.
     */
    enterSplitMode(sessionId: string | null): string | null {
      if (_root.type === 'split') return null
      // Set the current session on the root leaf before splitting
      if (_root.type === 'leaf') {
        _root = { ..._root, sessionId }
      }
      return this.splitPane(_root.id, 'horizontal', null)
    },

    /**
     * Exit split mode: collapse to the focused (or first) pane.
     */
    exitSplitMode() {
      if (_root.type === 'leaf') return

      const leaves = allLeaves(_root)
      const focused = _focusedPaneId ? findLeaf(_root, _focusedPaneId) : null
      const survivor = focused || leaves[0]

      _root = { type: 'leaf', id: survivor.id, sessionId: survivor.sessionId }
      _focusedPaneId = survivor.id
      _fullscreenPaneId = null
      _refreshSnapshot()
    },

    /**
     * Reset to single pane with no session.
     */
    reset() {
      _nextPaneId = 1
      _root = createInitialRoot()
      _focusedPaneId = _root.id
      _fullscreenPaneId = null
      _refreshSnapshot()
    },

    /**
     * Focus the next leaf pane (wraps around).
     */
    focusNextPane() {
      const leaves = allLeaves(_root)
      if (leaves.length <= 1) return
      const idx = leaves.findIndex(l => l.id === _focusedPaneId)
      const next = leaves[(idx + 1) % leaves.length]
      this.focusPane(next.id)
    },

    /**
     * Focus the previous leaf pane (wraps around).
     */
    focusPrevPane() {
      const leaves = allLeaves(_root)
      if (leaves.length <= 1) return
      const idx = leaves.findIndex(l => l.id === _focusedPaneId)
      const prev = leaves[(idx - 1 + leaves.length) % leaves.length]
      this.focusPane(prev.id)
    },

    /**
     * Focus a pane by its visible index (0-based).
     */
    focusPaneByIndex(index: number) {
      const leaves = allLeaves(_root)
      if (index >= 0 && index < leaves.length) {
        this.focusPane(leaves[index].id)
      }
    },
  }
}

export const paneLayoutStore = createPaneLayoutStore()

// ============================================
// React Hook
// ============================================

export function usePaneLayout(): PaneLayoutSnapshot {
  return useSyncExternalStore(paneLayoutStore.subscribe, paneLayoutStore.getSnapshot)
}
