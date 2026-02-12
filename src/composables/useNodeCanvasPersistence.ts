import { computed, ref } from 'vue'
import { api, type NodeCanvasState } from '@/lib/api'

interface UseNodeCanvasPersistenceOptions {
  debounceMs?: number
}

function cloneState(state: NodeCanvasState): NodeCanvasState {
  return JSON.parse(JSON.stringify(state)) as NodeCanvasState
}

function formatErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; status?: unknown }
    if (candidate.status === 413) return 'Payload too large'
    if (candidate.status === 422) return 'Invalid canvas payload'
    if (candidate.status === 403 || candidate.message === 'AUTH_FORBIDDEN') return 'Read-only (admin required)'
    if (candidate.message) return String(candidate.message)
  }
  return 'Save failed'
}

function isForbidden(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { message?: unknown; status?: unknown }
  return candidate.message === 'AUTH_FORBIDDEN' || candidate.status === 403
}

export function useNodeCanvasPersistence(options: UseNodeCanvasPersistenceOptions = {}) {
  const debounceMs = options.debounceMs ?? 600

  const isLoading = ref(false)
  const isSaving = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const dirty = ref(false)
  const error = ref<string | null>(null)
  const readOnly = ref(false)
  const isHydrating = ref(false)

  const canPersistToBackend = computed(() => !readOnly.value)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pendingState: NodeCanvasState | null = null
  let lastAttemptedState: NodeCanvasState | null = null

  const clearTimer = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  const persist = async (state: NodeCanvasState) => {
    lastAttemptedState = cloneState(state)

    if (readOnly.value) {
      dirty.value = true
      return
    }

    isSaving.value = true
    error.value = null

    try {
      const response = await api.putNodeCanvas(state)
      dirty.value = false
      lastSavedAt.value = response.data.updatedAt ?? new Date().toISOString()
    } catch (err) {
      if (isForbidden(err)) {
        readOnly.value = true
        error.value = 'Read-only (admin required)'
      } else {
        error.value = formatErrorMessage(err)
      }
      dirty.value = true
    } finally {
      isSaving.value = false
    }
  }

  const load = async (): Promise<NodeCanvasState | null> => {
    isLoading.value = true
    error.value = null

    try {
      const response = await api.getNodeCanvas()
      readOnly.value = false

      if (response.data?.updatedAt) {
        lastSavedAt.value = response.data.updatedAt
      }

      return response.data
    } catch (err) {
      if (isForbidden(err)) {
        readOnly.value = true
        error.value = 'Read-only (admin required)'
        return null
      }
      error.value = formatErrorMessage(err)
      return null
    } finally {
      isLoading.value = false
    }
  }

  const scheduleSave = (nextState: NodeCanvasState) => {
    if (isHydrating.value) return

    pendingState = cloneState(nextState)
    dirty.value = true
    error.value = null

    clearTimer()
    debounceTimer = setTimeout(async () => {
      if (!pendingState) return
      const stateToSave = pendingState
      pendingState = null
      await persist(stateToSave)
    }, debounceMs)
  }

  const saveNow = async (nextState: NodeCanvasState) => {
    if (isHydrating.value) return
    clearTimer()
    pendingState = null
    dirty.value = true
    error.value = null
    await persist(cloneState(nextState))
  }

  const retry = async () => {
    const stateToRetry = pendingState ?? lastAttemptedState
    if (!stateToRetry) return
    clearTimer()
    pendingState = null
    await persist(cloneState(stateToRetry))
  }

  const setHydrating = (value: boolean) => {
    isHydrating.value = value
  }

  const dispose = () => {
    clearTimer()
  }

  return {
    isLoading,
    isSaving,
    lastSavedAt,
    dirty,
    error,
    readOnly,
    isHydrating,
    canPersistToBackend,
    load,
    scheduleSave,
    saveNow,
    retry,
    setHydrating,
    dispose,
  }
}
