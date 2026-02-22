import { computed, ref } from 'vue'
import { api, type AuthContextResponse } from './api'
import type { FeatureKey, LimitKey } from './entitlementKeys'

const authContext = ref<AuthContextResponse | null>(null)
const authContextLoading = ref(false)
const authContextLoaded = ref(false)
const authContextError = ref<string | null>(null)

export function resetAuthContext() {
  authContext.value = null
  authContextLoading.value = false
  authContextLoaded.value = false
  authContextError.value = null
}

export async function loadAuthContext(options?: { force?: boolean }) {
  if (authContextLoading.value) return authContext.value
  if (authContextLoaded.value && !options?.force) return authContext.value

  authContextLoading.value = true
  authContextError.value = null
  try {
    const context = await api.getAuthContext()
    authContext.value = context
    authContextLoaded.value = true
    return context
  } catch (error: any) {
    const message = error?.message || 'AUTH_CONTEXT_FAILED'
    const isNotFound =
      error?.status === 404 || String(message).includes('HTTP 404')
    if (isNotFound) {
      authContextError.value = 'AUTH_CONTEXT_UNSUPPORTED'
      authContextLoaded.value = false
      return null
    }
    authContextError.value = message
    throw error
  } finally {
    authContextLoading.value = false
  }
}

export function useAuthz() {
  const plan = computed(() => authContext.value?.plan ?? null)
  const role = computed(() => authContext.value?.role ?? null)
  const adminAccess = computed(() => authContext.value?.admin_access ?? null)
  const adminAccessAllowed = computed(() => authContext.value?.admin_access?.allowed === true)
  const orgId = computed(() => authContext.value?.org_id ?? null)
  const userId = computed(() => authContext.value?.user_id ?? null)
  const features = computed(() => authContext.value?.features ?? {})
  const limits = computed(() => authContext.value?.limits ?? {})

  const hasFeature = (key: FeatureKey, fallback = false) => {
    const value = features.value[key]
    return value ?? fallback
  }

  const getLimit = (key: LimitKey) => {
    const value = limits.value[key]
    return typeof value === 'number' ? value : null
  }

  return {
    authContext,
    authContextLoaded,
    authContextLoading,
    authContextError,
    plan,
    role,
    adminAccess,
    adminAccessAllowed,
    orgId,
    userId,
    features,
    limits,
    hasFeature,
    getLimit,
    loadAuthContext,
    resetAuthContext,
  }
}
