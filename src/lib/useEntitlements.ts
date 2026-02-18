import { computed } from 'vue'
import { useAuthz } from './authz'

export function useEntitlements() {
  const { hasFeature, getLimit, authContextError, authContext } = useAuthz()

  const entitlementsSupported = computed(() => authContextError.value !== 'AUTH_CONTEXT_UNSUPPORTED')
  const entitlementsDegraded = computed(() => {
    return Boolean(authContextError.value) && authContextError.value !== 'AUTH_CONTEXT_UNSUPPORTED'
  })

  const hasAppAccess = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return true
    return authContext.value?.enabled !== false
  })

  const canUseAiDetection = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('ai_detection', false)
  })

  const canExport = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('export', false)
  })

  const canUseCatalog = computed(() => {
    if (!entitlementsSupported.value) return true
    if (entitlementsDegraded.value) return false
    return hasFeature('catalog', false)
  })

  const aiMonthlyLimit = computed(() => {
    if (!entitlementsSupported.value || entitlementsDegraded.value) return null
    return getLimit('ai_detection_per_month')
  })

  return {
    entitlementsSupported,
    entitlementsDegraded,
    hasAppAccess,
    canUseAiDetection,
    canExport,
    canUseCatalog,
    aiMonthlyLimit,
  }
}
